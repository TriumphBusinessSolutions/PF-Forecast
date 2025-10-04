'use client';

import React, { useCallback, useEffect, useMemo, useState } from 'react';

type PFAccount = { slug: string; name: string };

const CREATE_NEW_ACCOUNT_VALUE = '__create_new__';
const BUILT_IN_MAIN_ACCOUNT_NAMES = [
  'Income',
  'Materials',
  'Direct Labor',
  'Operating Expenses',
  "Owner's Pay",
  'Profit',
  'Tax',
];

const SUGGESTION_RULES: { test: RegExp; slug: string; kind?: 'inflow' | 'outflow' }[] = [
  { test: /(income|revenue|sales|fees|receipt|deposit)/i, slug: slugify('Income'), kind: 'inflow' },
  { test: /(material|inventory|cogs|cost of goods|suppl(ies|y)|parts?)/i, slug: slugify('Materials'), kind: 'outflow' },
  { test: /(labor|payroll|wages|contractor|subcontract|technician|crew|staff)/i, slug: slugify('Direct Labor'), kind: 'outflow' },
  { test: /(owner|member|partner|draw|distribution|equity)/i, slug: slugify("Owner's Pay"), kind: 'outflow' },
  { test: /(tax|irs)/i, slug: slugify('Tax') },
  { test: /(profit|retained)/i, slug: slugify('Profit'), kind: 'inflow' },
  {
    test: /(rent|utilit|insurance|office|subscription|software|marketing|travel|expense|maintenance|suppl(ies|y))/i,
    slug: slugify('Operating Expenses'),
    kind: 'outflow',
  },
];

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
  const [accountOptions, setAccountOptions] = useState<PFAccount[]>(() =>
    mergeAccountLists(accounts, buildDefaultAccounts())
  );

  useEffect(() => {
    setAccountOptions((prev) => mergeAccountLists(accounts, prev, buildDefaultAccounts()));
  }, [accounts]);

  const parseAndSet = useCallback(
    (input: string) => {
      const parsed = parseStatement(input);
      if (parsed.rows.length === 0 || parsed.months.length === 0) {
        setError(
          parsed.warnings[0] ??
            'No rows were detected. Please provide a CSV/TSV cash-basis P&L with at least one account.'
        );
        setStatement(null);
        return false;
      }
      setError(null);
      setStatement(parsed);
      return true;
    },
    []
  );

  // seed defaults whenever the parsed statement changes
  useEffect(() => {
    if (!statement) return;
    const nextAssignments: Record<string, string> = {};
    const nextKinds: Record<string, 'inflow' | 'outflow'> = {};
    const income = accountOptions.find((a) => /income/i.test(a.slug) || /income/i.test(a.name));
    const operating = accountOptions.find((a) => /operat/i.test(a.slug) || /operat/i.test(a.name));

    statement.rows.forEach((row) => {
      const def = row.total >= 0 ? 'inflow' : 'outflow';
      nextKinds[row.name] = def;
      const suggestion = suggestAccountSlug(row.name, def, accountOptions);
      if (suggestion) {
        nextAssignments[row.name] = suggestion;
        return;
      }
      if (accountOptions.length) {
        // Heuristic fallback: inflows map to Income if present, outflows to Operating if present
        nextAssignments[row.name] = def === 'inflow'
          ? income?.slug ?? accountOptions[0]?.slug ?? ''
          : operating?.slug ?? accountOptions[0]?.slug ?? '';
      } else {
        nextAssignments[row.name] = '';
      }
    });
    setAssignments(nextAssignments);
    setKinds(nextKinds);
    setProjectionOverrides({});
  }, [statement, accountOptions]);

  const handleParse = () => {
    parseAndSet(rawInput);
  };

  const handleFileUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    const text = await file.text();
    setRawInput(text);
    parseAndSet(text);
    event.target.value = '';
  };

  const handleAssignmentChange = useCallback(
    (row: string, slug: string) => {
      if (slug === CREATE_NEW_ACCOUNT_VALUE) {
        const name = window.prompt('Name the new main account');
        const trimmed = name?.trim();
        if (!trimmed) {
          return;
        }
        setAccountOptions((prev) => {
          const nextSlug = ensureUniqueSlug(slugify(trimmed), prev);
          const newAccount: PFAccount = { slug: nextSlug, name: trimmed };
          const merged = mergeAccountLists(prev, [newAccount]);
          setAssignments((prevAssignments) => ({ ...prevAssignments, [row]: nextSlug }));
          return merged;
        });
        return;
      }
      setAssignments((prev) => ({ ...prev, [row]: slug }));
    },
    []
  );

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
            <label
              htmlFor="plUpload"
              className="mt-3 inline-flex items-center gap-2 text-sm font-medium text-[color:var(--pf-blue,#004aad)] cursor-pointer"
            >
              <input
                id="plUpload"
                type="file"
                accept=".csv,.tsv,.txt,text/csv,text/tab-separated-values,application/vnd.ms-excel"
                className="hidden"
                onChange={handleFileUpload}
              />
              <span className="inline-flex items-center gap-2 rounded-lg border border-current px-3 py-2 text-xs uppercase tracking-wide">
                Upload statement
              </span>
              <span className="text-xs font-normal text-slate-500">
                Select a CSV/TSV file and we will populate the statement above.
              </span>
            </label>
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
                accounts={accountOptions}
                statement={statement}
                assignments={assignments}
                kinds={kinds}
                onKindChange={(row, kind) => setKinds((prev) => ({ ...prev, [row]: kind }))}
                onAssignmentChange={handleAssignmentChange}
              />

              <MappedSummary
                accounts={accountOptions}
                statement={statement}
                monthAssignments={monthAssignments}
              />

              <ProjectionEditor
                accounts={accountOptions}
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
        <span className="block mt-1">Need a different bucket? Select “Create new main account” from the dropdown.</span>
      </p>
      <div className="overflow-x-auto">
        <table className="min-w-full text-sm">
          <thead>
            <tr className="bg-slate-50">
              <th className="px-3 py-2 text-left font-semibold">Account</th>
              <th className="px-3 py-2 text-left font-semibold">Type</th>
              <th className="px-3 py-2 text-left font-semibold">Assign to</th>
              {statement.months.map((ym) => (
                <th key={ym} className="px-3 py-2 text-right font-semibold whitespace-nowrap">
                  {formatMonth(ym)}
                </th>
              ))}
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
                      <option value={CREATE_NEW_ACCOUNT_VALUE}>+ Create new main account</option>
                    </select>
                  </td>
                  {statement.months.map((ym) => (
                    <td key={ym} className="px-3 py-2 text-right">
                      {formatMoney(normaliseValue(row.monthly[ym], kind))}
                    </td>
                  ))}
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

function buildDefaultAccounts(): PFAccount[] {
  return BUILT_IN_MAIN_ACCOUNT_NAMES.map((name) => ({ slug: slugify(name), name }));
}

function mergeAccountLists(...lists: (PFAccount[] | undefined)[]): PFAccount[] {
  const result: PFAccount[] = [];
  const seenByCanonical = new Set<string>();
  const seenBySlug = new Set<string>();
  lists.forEach((list) => {
    (list ?? []).forEach((acc) => {
      const normalised = normaliseAccount(acc);
      if (!normalised) return;
      const canonical = canonicalName(normalised.name);
      if (seenByCanonical.has(canonical) || seenBySlug.has(normalised.slug)) {
        return;
      }
      result.push(normalised);
      seenByCanonical.add(canonical);
      seenBySlug.add(normalised.slug);
    });
  });
  return result.sort((a, b) => a.name.localeCompare(b.name));
}

function normaliseAccount(acc: PFAccount): PFAccount | null {
  const name = acc.name?.trim() || acc.slug?.trim();
  if (!name) return null;
  const slugSource = acc.slug?.trim() || name;
  const slug = slugify(slugSource);
  if (!slug) return null;
  return { slug, name };
}

function slugify(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .replace(/_+/g, '_');
}

function canonicalName(value: string): string {
  return value
    .toLowerCase()
    .replace(/&/g, 'and')
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\b([a-z]+) s\b/g, '$1s')
    .replace(/\s+/g, ' ')
    .trim();
}

function ensureUniqueSlug(base: string, existing: PFAccount[]): string {
  const safeBase = base || 'account';
  const used = new Set(existing.map((acc) => acc.slug));
  let candidate = safeBase;
  let i = 2;
  while (used.has(candidate)) {
    candidate = `${safeBase}_${i}`;
    i += 1;
  }
  return candidate;
}

function parseStatement(raw: string): ParsedStatement {
  const warnings: string[] = [];
  const trimmed = raw.trim();
  if (!trimmed) {
    return { months: [], rows: [], warnings };
  }

  const lines = trimmed.split(/\r?\n/).filter((ln) => ln.trim().length > 0);
  if (lines.length < 2) {
    warnings.push('The uploaded statement does not contain any rows.');
    return { months: [], rows: [], warnings };
  }

  let headerIndex = -1;
  let delimiter = ',';
  let rawMonthHeaders: string[] = [];
  let monthHeaders: (string | null)[] = [];

  for (let i = 0; i < lines.length; i++) {
    const candidateDelimiter = selectDelimiter(lines[i]);
    const parts = splitDelimited(lines[i], candidateDelimiter).map((h) => h.trim());
    if (parts.length < 2) continue;
    const rawMonths = parts.slice(1);
    const normalised = rawMonths.map((m) => normaliseMonth(m));
    const valid = normalised.filter((m): m is string => Boolean(m));
    if (valid.length >= 3) {
      headerIndex = i;
      delimiter = candidateDelimiter;
      rawMonthHeaders = rawMonths;
      monthHeaders = normalised;
      break;
    }
  }

  if (headerIndex === -1) {
    warnings.push('Could not find a header row with monthly columns. Please ensure the report includes month headings.');
    return { months: [], rows: [], warnings };
  }

  if (headerIndex > 0) {
    warnings.push('Skipped heading rows before the data table.');
  }

  const validMonthHeaders = monthHeaders.filter((m): m is string => Boolean(m));

  if (validMonthHeaders.length === 0) {
    warnings.push('No month columns detected.');
    return { months: [], rows: [], warnings };
  }

  if (validMonthHeaders.length !== rawMonthHeaders.length) {
    warnings.push('Some columns were skipped because the month could not be understood.');
  }

  const months: string[] = [];
  validMonthHeaders.forEach((m) => {
    if (!months.includes(m)) {
      months.push(m);
    }
  });

  if (months.length > 12) {
    warnings.push('More than 12 months detected. Using the most recent twelve.');
  }

  const limitedMonths = months
    .slice(-12)
    .sort((a, b) => monthSort(a) - monthSort(b));
  const dataLines = lines.slice(headerIndex + 1);
  const rows: ParsedRow[] = [];

  dataLines.forEach((line) => {
    const parts = splitDelimited(line, delimiter);
    if (!parts.length) return;
    const name = parts[0]?.trim();
    if (!name) return;

    const monthly: Record<string, number> = {};
    parts.slice(1).forEach((value, idx) => {
      const month = monthHeaders[idx];
      if (!month) return;
      if (!limitedMonths.includes(month)) return;
      const num = parseCurrency(value);
      if (!Number.isFinite(num)) return;
      monthly[month] = num;
    });

    if (Object.keys(monthly).length === 0) {
      return;
    }

    if (isAggregateRow(name)) {
      return;
    }

    const total = limitedMonths.reduce((sum, month) => sum + (monthly[month] ?? 0), 0);
    rows.push({ name, monthly, total });
  });

  if (rows.length === 0) {
    warnings.push('No account rows with values were detected.');
  }

  return { months: limitedMonths, rows, warnings };
}

function parseCurrency(value: string): number {
  const raw = value.trim();
  if (!raw) return 0;
  const negativeByParens = /^\(.*\)$/.test(raw);
  const negativeBySuffix = /-$/.test(raw);
  const cleaned = raw.replace(/[\s,]/g, '').replace(/[()]/g, '');
  const normalized = negativeBySuffix ? cleaned.replace(/-$/, '') : cleaned;
  if (normalized === '' || normalized === '-' || normalized === '.') return 0;
  let num = Number(normalized);
  if (!Number.isFinite(num)) return 0;
  if (negativeByParens || negativeBySuffix) {
    num = -Math.abs(num);
  }
  return num;
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
    if (month >= 1 && month <= 12 && year >= 2000 && year <= 2100) {
      return `${year}-${String(month).padStart(2, '0')}`;
    }
  }

  const parsed = new Date(trimmed);
  if (!Number.isNaN(parsed.valueOf())) {
    const year = parsed.getFullYear();
    if (year >= 2000 && year <= 2100) {
      return `${year}-${String(parsed.getMonth() + 1).padStart(2, '0')}`;
    }
  }

  return null;
}

function normaliseValue(value: number | undefined, kind: 'inflow' | 'outflow'): number {
  const safe = Number(value ?? 0);
  if (Number.isNaN(safe)) return 0;
  const abs = Math.abs(safe);
  return kind === 'outflow' ? -abs : abs;
}

function isAggregateRow(name: string): boolean {
  const normalized = name.trim().toLowerCase();
  if (!normalized) return true;
  if (/^total\b/.test(normalized)) return true;
  if (/(net|gross) (income|profit|loss)/.test(normalized)) return true;
  if (/operating (income|profit)/.test(normalized)) return true;
  if (/^income total$/.test(normalized)) return true;
  if (/^expense(s)? total$/.test(normalized)) return true;
  if (/^total other (income|expense)/.test(normalized)) return true;
  if (/^total expenses$/.test(normalized)) return true;
  if (/^total operating expenses$/.test(normalized)) return true;
  return false;
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

function suggestAccountSlug(
  rowName: string,
  kind: 'inflow' | 'outflow',
  options: PFAccount[]
): string | undefined {
  const lower = rowName.toLowerCase();
  for (const rule of SUGGESTION_RULES) {
    if (rule.kind && rule.kind !== kind) continue;
    if (rule.test.test(lower)) {
      const match = resolveSuggestedSlug(rule.slug, options);
      if (match) return match;
    }
  }
  return undefined;
}

function resolveSuggestedSlug(preferredSlug: string, options: PFAccount[]): string | undefined {
  const canonicalPreferred = canonicalName(preferredSlug);
  for (const option of options) {
    if (option.slug === preferredSlug) return option.slug;
  }
  for (const option of options) {
    if (canonicalName(option.slug) === canonicalPreferred) return option.slug;
  }
  for (const option of options) {
    if (canonicalName(option.name) === canonicalPreferred) return option.slug;
  }
  return undefined;
}

function formatMonth(ym: string): string {
  const [year, month] = ym.split('-').map(Number);
  const date = new Date(year, month - 1, 1);
  return date.toLocaleDateString('en-US', { month: 'short', year: 'numeric' });
}

