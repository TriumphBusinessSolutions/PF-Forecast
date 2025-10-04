'use client';

import React, { useEffect, useMemo, useState } from 'react';

type PFAccount = { slug: string; name: string };

type ParsedRow = {
  name: string;
  monthly: Record<string, number>;
  total: number;
};

type ParsedStatement = {
  months: string[];
  rows: ParsedRow[];
  warnings: string[];
};

type ProjectionMatrix = Record<string, Record<string, number>>;

type ImporterToolProps = {
  accounts: PFAccount[];
};

/**
 * Importer tool for cash-basis Profit & Loss statements.
 *
 * The component accepts a 12 month P&L (CSV/TSV) and lets the user
 * map each source line to one of the main PF accounts. A simple
 * trend projection is created for the next 6 months that can be
 * edited inline by the user.
 */
export default function ImporterTool({ accounts }: ImporterToolProps) {
  const [rawInput, setRawInput] = useState('');
  const [statement, setStatement] = useState<ParsedStatement | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [assignments, setAssignments] = useState<Record<string, string>>({});
  const [kinds, setKinds] = useState<Record<string, 'inflow' | 'outflow'>>({});
  const [futureCount, setFutureCount] = useState<number>(6);
  const [projectionOverrides, setProjectionOverrides] = useState<Record<string, number>>({});

  // seed defaults whenever the parsed statement changes
  useEffect(() => {
    if (!statement) return;
    const nextAssignments: Record<string, string> = {};
    const nextKinds: Record<string, 'inflow' | 'outflow'> = {};
    statement.rows.forEach((row) => {
      const def = row.total >= 0 ? 'inflow' : 'outflow';
      nextKinds[row.name] = def;
      if (accounts.length) {
        // Heuristic: inflows map to first account, outflows to Operating if present
        const operating = accounts.find((a) => /operat/i.test(a.slug) || /operat/i.test(a.name));
        nextAssignments[row.name] = def === 'inflow'
          ? accounts[0]?.slug ?? ''
          : operating?.slug ?? accounts[0]?.slug ?? '';
      } else {
        nextAssignments[row.name] = '';
      }
    });
    setAssignments(nextAssignments);
    setKinds(nextKinds);
    setProjectionOverrides({});
  }, [statement, accounts]);

  const handleParse = () => {
    const parsed = parseStatement(rawInput);
    if (parsed.rows.length === 0) {
      setError('No rows were detected. Please paste a CSV/TSV cash-basis P&L with at least one account.');
      setStatement(null);
      return;
    }
    setError(null);
    setStatement(parsed);
  };

  const monthAssignments = useMemo(() => {
    if (!statement) return null;
    const matrix: ProjectionMatrix = {};
    statement.rows.forEach((row) => {
      const slug = assignments[row.name];
      if (!slug) return;
      if (!matrix[slug]) matrix[slug] = {};
      const kind = kinds[row.name] ?? (row.total >= 0 ? 'inflow' : 'outflow');
      statement.months.forEach((ym) => {
        const amt = normaliseValue(row.monthly[ym], kind);
        matrix[slug][ym] = (matrix[slug][ym] ?? 0) + amt;
      });
    });
    return matrix;
  }, [statement, assignments, kinds]);

  const futureMonths = useMemo(() => {
    if (!statement || !statement.months.length) return [];
    const last = statement.months[statement.months.length - 1];
    return buildFutureMonths(last, futureCount);
  }, [statement, futureCount]);

  const projections = useMemo(() => {
    if (!statement || !monthAssignments) return {} as ProjectionMatrix;
    const result: ProjectionMatrix = {};
    Object.entries(monthAssignments).forEach(([slug, monthValues]) => {
      const series = statement.months.map((ym) => monthValues[ym] ?? 0);
      const projectedSeries = trendSeries(series, futureCount);
      result[slug] = {};
      futureMonths.forEach((ym, idx) => {
        const key = `${slug}:${ym}`;
        const override = projectionOverrides[key];
        result[slug][ym] = override ?? projectedSeries[idx] ?? 0;
      });
    });
    return result;
  }, [monthAssignments, statement, futureMonths, futureCount, projectionOverrides]);

  const reset = () => {
    setRawInput('');
    setStatement(null);
    setAssignments({});
    setKinds({});
    setProjectionOverrides({});
    setError(null);
  };

  return (
    <div className="mt-6">
      <div className="rounded-xl border border-slate-200 bg-white shadow-sm">
        <div className="px-4 py-3 border-b bg-slate-50 rounded-t-xl">
          <h2 className="text-lg font-semibold text-slate-800">Import cash-basis P&amp;L</h2>
          <p className="text-sm text-slate-600 mt-1">
            Paste a cash-basis Profit &amp; Loss statement covering the trailing twelve months.
            Columns should be months and rows should be revenue/expense accounts.
          </p>
        </div>
        <div className="p-4 space-y-4">
          <div>
            <label htmlFor="plInput" className="block text-sm font-medium text-slate-700 mb-1">
              Statement (CSV or TSV)
            </label>
            <textarea
              id="plInput"
              value={rawInput}
              onChange={(e) => setRawInput(e.target.value)}
              rows={8}
              placeholder="Account,2023-07,2023-08,...,2024-06\nSales,12500,11800,..."
              className="w-full rounded-lg border px-3 py-2 font-mono text-xs bg-slate-50 focus:bg-white focus:outline-none focus:ring focus:ring-slate-200"
            />
            <div className="flex gap-3 mt-2">
              <button
                type="button"
                onClick={handleParse}
                className="px-3 py-2 rounded-lg text-sm font-medium bg-[color:var(--pf-blue,#004aad)] text-white hover:opacity-90"
              >
                Parse statement
              </button>
              <button
                type="button"
                onClick={reset}
                className="px-3 py-2 rounded-lg text-sm font-medium border border-slate-300 bg-white hover:bg-slate-50"
              >
                Clear
              </button>
            </div>
            {error && <p className="text-sm text-rose-600 mt-2">{error}</p>}
            {statement?.warnings?.length ? (
              <ul className="text-xs text-amber-600 mt-2 list-disc list-inside space-y-1">
                {statement.warnings.map((w, idx) => (
                  <li key={idx}>{w}</li>
                ))}
              </ul>
            ) : null}
          </div>

          {statement && (
            <div className="space-y-6">
              <AssignmentTable
                accounts={accounts}
                statement={statement}
                assignments={assignments}
                kinds={kinds}
                onKindChange={(row, kind) => setKinds((prev) => ({ ...prev, [row]: kind }))}
                onAssignmentChange={(row, slug) => setAssignments((prev) => ({ ...prev, [row]: slug }))}
              />

              <MappedSummary
                accounts={accounts}
                statement={statement}
                monthAssignments={monthAssignments}
              />

              <ProjectionEditor
                accounts={accounts}
                monthAssignments={monthAssignments}
                futureMonths={futureMonths}
                projections={projections}
                onFutureCountChange={setFutureCount}
                futureCount={futureCount}
                onOverride={(slug, ym, value) =>
                  setProjectionOverrides((prev) => ({ ...prev, [`${slug}:${ym}`]: value }))
                }
              />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function AssignmentTable({
  accounts,
  statement,
  assignments,
  kinds,
  onKindChange,
  onAssignmentChange,
}: {
  accounts: PFAccount[];
  statement: ParsedStatement;
  assignments: Record<string, string>;
  kinds: Record<string, 'inflow' | 'outflow'>;
  onKindChange: (row: string, kind: 'inflow' | 'outflow') => void;
  onAssignmentChange: (row: string, slug: string) => void;
}) {
  return (
    <div>
      <h3 className="text-base font-semibold text-slate-800 mb-2">Review imported rows</h3>
      <p className="text-xs text-slate-500 mb-3">
        Identify whether each row is an inflow or outflow and choose which Profit First account it should roll into.
      </p>
      <div className="overflow-x-auto">
        <table className="min-w-full text-sm">
          <thead>
            <tr className="bg-slate-50">
              <th className="px-3 py-2 text-left font-semibold">Account</th>
              <th className="px-3 py-2 text-left font-semibold">Type</th>
              <th className="px-3 py-2 text-left font-semibold">Assign to</th>
              <th className="px-3 py-2 text-right font-semibold">12 mo total</th>
            </tr>
          </thead>
          <tbody>
            {statement.rows.map((row) => {
              const kind = kinds[row.name] ?? (row.total >= 0 ? 'inflow' : 'outflow');
              const total = statement.months.reduce((sum, ym) => sum + normaliseValue(row.monthly[ym], kind), 0);
              return (
                <tr key={row.name} className="border-b last:border-0">
                  <td className="px-3 py-2 font-medium text-slate-800">{row.name}</td>
                  <td className="px-3 py-2">
                    <div className="flex items-center gap-3">
                      <label className="flex items-center gap-1 text-xs uppercase tracking-wide text-slate-600">
                        <input
                          type="radio"
                          name={`kind-${row.name}`}
                          checked={kind === 'inflow'}
                          onChange={() => onKindChange(row.name, 'inflow')}
                        />
                        Inflow
                      </label>
                      <label className="flex items-center gap-1 text-xs uppercase tracking-wide text-slate-600">
                        <input
                          type="radio"
                          name={`kind-${row.name}`}
                          checked={kind === 'outflow'}
                          onChange={() => onKindChange(row.name, 'outflow')}
                        />
                        Outflow
                      </label>
                    </div>
                  </td>
                  <td className="px-3 py-2">
                    <select
                      className="border rounded-md px-2 py-1 text-sm bg-white"
                      value={assignments[row.name] ?? ''}
                      onChange={(e) => onAssignmentChange(row.name, e.target.value)}
                    >
                      <option value="">Unassigned</option>
                      {accounts.map((acc) => (
                        <option key={acc.slug} value={acc.slug}>
                          {acc.name}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td className="px-3 py-2 text-right font-medium">
                    {formatMoney(total)}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function MappedSummary({
  accounts,
  statement,
  monthAssignments,
}: {
  accounts: PFAccount[];
  statement: ParsedStatement;
  monthAssignments: ProjectionMatrix | null;
}) {
  if (!monthAssignments) {
    return (
      <div className="rounded-lg border border-dashed border-slate-300 p-4 text-sm text-slate-500">
        Assign rows to Profit First accounts to see the combined monthly activity.
      </div>
    );
  }

  const rows = accounts.filter((acc) => monthAssignments[acc.slug]);

  if (!rows.length) {
    return (
      <div className="rounded-lg border border-dashed border-slate-300 p-4 text-sm text-slate-500">
        No mapped activity yet.
      </div>
    );
  }

  return (
    <div>
      <h3 className="text-base font-semibold text-slate-800 mb-2">Mapped inflow &amp; outflow totals</h3>
      <div className="overflow-x-auto">
        <table className="min-w-full text-sm">
          <thead>
            <tr className="bg-slate-50">
              <th className="px-3 py-2 text-left font-semibold">Account</th>
              {statement.months.map((ym) => (
                <th key={ym} className="px-3 py-2 text-right font-semibold whitespace-nowrap">
                  {formatMonth(ym)}
                </th>
              ))}
              <th className="px-3 py-2 text-right font-semibold">Total</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((acc) => {
              const values = statement.months.map((ym) => monthAssignments[acc.slug]?.[ym] ?? 0);
              const sum = values.reduce((a, b) => a + b, 0);
              return (
                <tr key={acc.slug} className="border-b last:border-0">
                  <td className="px-3 py-2 font-medium text-slate-800">{acc.name}</td>
                  {values.map((v, idx) => (
                    <td key={idx} className="px-3 py-2 text-right">
                      {formatMoney(v)}
                    </td>
                  ))}
                  <td className="px-3 py-2 text-right font-medium">{formatMoney(sum)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function ProjectionEditor({
  accounts,
  monthAssignments,
  futureMonths,
  projections,
  futureCount,
  onFutureCountChange,
  onOverride,
}: {
  accounts: PFAccount[];
  monthAssignments: ProjectionMatrix | null;
  futureMonths: string[];
  projections: ProjectionMatrix;
  futureCount: number;
  onFutureCountChange: (n: number) => void;
  onOverride: (slug: string, ym: string, value: number) => void;
}) {
  if (!monthAssignments || Object.keys(monthAssignments).length === 0) return null;

  const rows = accounts.filter((acc) => monthAssignments[acc.slug]);

  if (!rows.length) return null;

  return (
    <div>
      <div className="flex items-center gap-3 mb-3">
        <h3 className="text-base font-semibold text-slate-800">Future trend &amp; projections</h3>
        <label className="text-sm text-slate-600 flex items-center gap-2 ml-auto">
          Project months
          <select
            value={futureCount}
            onChange={(e) => onFutureCountChange(Number(e.target.value))}
            className="border rounded-md px-2 py-1 text-sm bg-white"
          >
            {[3, 6, 9, 12].map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </select>
        </label>
      </div>
      <div className="overflow-x-auto">
        <table className="min-w-full text-sm">
          <thead>
            <tr className="bg-slate-50">
              <th className="px-3 py-2 text-left font-semibold">Account</th>
              {futureMonths.map((ym) => (
                <th key={ym} className="px-3 py-2 text-right font-semibold whitespace-nowrap">
                  {formatMonth(ym)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((acc) => (
              <tr key={acc.slug} className="border-b last:border-0">
                <td className="px-3 py-2 font-medium text-slate-800">{acc.name}</td>
                {futureMonths.map((ym) => (
                  <td key={ym} className="px-3 py-2 text-right">
                    <input
                      type="number"
                      className="w-28 border rounded-md px-2 py-1 text-right bg-white"
                      value={Number(projections[acc.slug]?.[ym] ?? 0).toFixed(2)}
                      onChange={(e) => onOverride(acc.slug, ym, Number(e.target.value))}
                    />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="text-xs text-slate-500 mt-2">
        Projections are based on a simple trend of the trailing twelve months. Adjust any figure to refine the plan.
      </p>
    </div>
  );
}

// ---------- helpers ----------

function parseStatement(raw: string): ParsedStatement {
  const warnings: string[] = [];
  const trimmed = raw.trim();
  if (!trimmed) {
    return { months: [], rows: [], warnings };
  }

  const lines = trimmed.split(/\r?\n/).filter((ln) => ln.trim().length > 0);
  if (lines.length < 2) {
    return { months: [], rows: [], warnings };
  }

  const headerLine = lines[0];
  const delimiter = selectDelimiter(headerLine);
  const header = splitDelimited(headerLine, delimiter).map((h) => h.trim());
  const rawMonthHeaders = header.slice(1);
  const monthHeaders = rawMonthHeaders.map((m) => normaliseMonth(m));
  const validMonthHeaders = monthHeaders.filter((m): m is string => Boolean(m));

  if (validMonthHeaders.length === 0) {
    return { months: [], rows: [], warnings: ['No month columns detected.'] };
  }

  if (validMonthHeaders.length !== rawMonthHeaders.length) {
    warnings.push('Some columns were skipped because the month could not be understood.');
  }

  const uniqueMonths = Array.from(new Set(validMonthHeaders)).sort((a, b) => monthSort(a) - monthSort(b));
  if (uniqueMonths.length > 12) {
    warnings.push('More than 12 months detected. Using the most recent twelve.');
  }
  const months = uniqueMonths.slice(-12);

  const rows: ParsedRow[] = [];

  for (let i = 1; i < lines.length; i++) {
    const parts = splitDelimited(lines[i], delimiter);
    if (!parts.length) continue;
    const name = parts[0]?.trim();
    if (!name) continue;

    const monthly: Record<string, number> = {};
    parts.slice(1).forEach((value, idx) => {
      const month = monthHeaders[idx];
      if (!month) return;
      const num = parseCurrency(value);
      if (!Number.isFinite(num)) return;
      monthly[month] = num;
    });

    const total = months.reduce((sum, month) => sum + (monthly[month] ?? 0), 0);
    rows.push({ name, monthly, total });
  }

  return { months, rows, warnings };
}

function parseCurrency(value: string): number {
  const cleaned = value.replace(/[^0-9\-\.]/g, '');
  if (cleaned === '' || cleaned === '-' || cleaned === '.') return 0;
  const num = Number(cleaned);
  return Number.isFinite(num) ? num : 0;
}

function selectDelimiter(line: string): string {
  const comma = splitDelimited(line, ',');
  const tab = splitDelimited(line, '\t');
  return tab.length > comma.length ? '\t' : ',';
}

function splitDelimited(line: string, delimiter: string): string[] {
  const result: string[] = [];
  let current = '';
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    if (char === '"') {
      if (inQuotes && line[i + 1] === '"') {
        current += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }

    if (char === delimiter && !inQuotes) {
      result.push(current);
      current = '';
    } else {
      current += char;
    }
  }

  result.push(current);
  return result;
}

function normaliseMonth(input: string): string | null {
  const trimmed = input.trim();
  if (!trimmed) return null;

  const isoMatch = trimmed.match(/^(\d{4})[-\/.](\d{1,2})$/);
  if (isoMatch) {
    const year = Number(isoMatch[1]);
    const month = Number(isoMatch[2]);
    if (month >= 1 && month <= 12) {
      return `${year}-${String(month).padStart(2, '0')}`;
    }
  }

  const parsed = new Date(trimmed);
  if (!Number.isNaN(parsed.valueOf())) {
    return `${parsed.getFullYear()}-${String(parsed.getMonth() + 1).padStart(2, '0')}`;
  }

  return null;
}

function normaliseValue(value: number | undefined, kind: 'inflow' | 'outflow'): number {
  const safe = Number(value ?? 0);
  if (Number.isNaN(safe)) return 0;
  const abs = Math.abs(safe);
  return kind === 'outflow' ? -abs : abs;
}

function monthSort(ym: string): number {
  const [y, m] = ym.split('-').map(Number);
  return y * 12 + (m - 1);
}

function buildFutureMonths(start: string, count: number): string[] {
  const [y, m] = start.split('-').map(Number);
  const list: string[] = [];
  let year = y;
  let month = m;
  for (let i = 0; i < count; i++) {
    month += 1;
    if (month > 12) {
      month = 1;
      year += 1;
    }
    list.push(`${year}-${String(month).padStart(2, '0')}`);
  }
  return list;
}

function trendSeries(values: number[], future: number): number[] {
  if (values.length === 0) return Array(future).fill(0);
  const xs = values.map((_, idx) => idx + 1);
  const ys = values;
  const n = xs.length;
  const sumX = xs.reduce((a, b) => a + b, 0);
  const sumY = ys.reduce((a, b) => a + b, 0);
  const sumXY = xs.reduce((sum, x, idx) => sum + x * ys[idx], 0);
  const sumXX = xs.reduce((sum, x) => sum + x * x, 0);
  const denom = n * sumXX - sumX * sumX;
  const slope = denom === 0 ? 0 : (n * sumXY - sumX * sumY) / denom;
  const intercept = (sumY - slope * sumX) / n;

  const projections: number[] = [];
  for (let i = 1; i <= future; i++) {
    const x = n + i;
    const val = intercept + slope * x;
    projections.push(Number.isFinite(val) ? val : 0);
  }
  return projections;
}

function formatMoney(value: number): string {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(value || 0);
}

function formatMonth(ym: string): string {
  const [year, month] = ym.split('-').map(Number);
  const date = new Date(year, month - 1, 1);
  return date.toLocaleDateString('en-US', { month: 'short', year: 'numeric' });
}

