'use client';

import React, { useEffect, useMemo, useState } from 'react';
import dayjs from 'dayjs';
import isoWeek from 'dayjs/plugin/isoWeek';
import { createClient } from '@supabase/supabase-js';

/* recharts (client safe because this file is a client component) */
import {
  AreaChart, Area, LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend,
} from 'recharts';

dayjs.extend(isoWeek);

/* ---------- Supabase ---------- */
const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
if (!url || !key) console.warn('Supabase env vars missing; dashboard will run without remote data.');
const supabase = createClient(url || 'https://example.invalid', key || 'anon-key-missing');

/* ---------- Types ---------- */
type CoaGroup = 'income' | 'materials' | 'direct_subs' | 'direct_wages' | 'expense' | 'loan_debt';
type LineKind = 'income' | 'expense';
type PeriodKey = string;
type Scale = 'monthly' | 'weekly';

type CoaAccount = { id: string; name: string; group_key: CoaGroup };
type ProjLine = {
  id: string;
  client_id: string;
  coa_account_id: string;
  kind: LineKind;
  name: string;
  amount: number;
  recurrence: 'one_off' | 'daily' | 'weekly' | 'biweekly' | 'monthly' | 'quarterly' | 'semiannual' | 'annual';
  every_n: number | null;
  start_date: string;
  end_date: string | null;
  pct_of_link: number | null;
  linked_to: string | null;
  increase_pct: number | null;
  increase_interval: 'weeks' | 'months' | null;
  group_key: CoaGroup;
};

type Alloc = { pct_profit: number; pct_owners: number; pct_tax: number; pct_operating: number; pct_vault?: number };
type Bal = { operating: number; profit: number; owners: number; tax: number; vault: number };
type Totals = { income: number; materials: number; direct_subs: number; direct_wages: number; expense: number; loan_debt: number };
type PerTotals = Record<PeriodKey, Totals>;

/* ---------- Helpers ---------- */
const nz = (v: any, d = 0) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : d;
};
const formatCurrency = (value: number | string) => {
  if (value === null || value === undefined || value === '') return '$0.00';
  const num = typeof value === 'string' ? parseFloat(value) : value;
  const safe = Number.isFinite(num) ? num : 0;
  return safe.toLocaleString('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
};
const mmmYY = (ym: string) => {
  // ym may be 'YYYY-MM' or a week label; we only reformat YYYY-MM here
  if (/^\d{4}-\d{2}$/.test(ym)) return dayjs(`${ym}-01`).format('MMM-YY');
  return ym;
};

const ym = (d: dayjs.Dayjs) => d.format('YYYY-MM');

function weeksInMonthShort(year: number, month1to12: number) {
  const first = dayjs(`${year}-${String(month1to12).padStart(2, '0')}-01`);
  const last = first.endOf('month');
  let mon = first.isoWeekday() === 1 ? first : first.isoWeekday(8);
  if (mon.month() !== first.month()) mon = mon.add(1, 'week');
  const out: { label: string; mon: dayjs.Dayjs; sun: dayjs.Dayjs }[] = [];
  while (mon.isBefore(last) || mon.isSame(last, 'day')) {
    let sun = mon.add(6, 'day');
    if (sun.month() !== first.month()) sun = last;
    const label = `${mon.format('MMM D')}–${sun.format(mon.month() === sun.month() ? 'D' : 'MMM D')}`;
    out.push({ label, mon, sun });
    mon = mon.add(1, 'week');
  }
  return out;
}

function buildPeriods(scale: Scale, startYM: string, months: number): PeriodKey[] {
  if (scale === 'monthly') {
    const start = dayjs(`${startYM}-01`);
    return Array.from({ length: months }, (_, i) => start.add(i, 'month').format('YYYY-MM'));
  }
  const [y0, m0] = startYM.split('-').map(Number);
  let y = y0, m = m0;
  const out: string[] = [];
  for (let i = 0; i < months; i++) {
    weeksInMonthShort(y, m).forEach((w) => out.push(w.label));
    m++;
    if (m > 12) { m = 1; y++; }
  }
  return out;
}

function step(d: dayjs.Dayjs, recur: ProjLine['recurrence'], every: number) {
  switch (recur) {
    case 'daily': return d.add(every, 'day');
    case 'weekly': return d.add(7 * every, 'day');
    case 'biweekly': return d.add(14 * every, 'day');
    case 'monthly': return d.add(every, 'month');
    case 'quarterly': return d.add(3 * every, 'month');
    case 'semiannual': return d.add(6 * every, 'month');
    case 'annual': return d.add(12 * every, 'month');
    default: return d;
  }
}

/* ---------- Forecast core ---------- */
function runForecast(per: PerTotals, periods: PeriodKey[], alloc: Alloc, start: Bal) {
  const snaps: Record<PeriodKey, { operating: number; profit: number; owners: number; tax: number; vault: number }> = {};
  const realRevenue: Record<PeriodKey, number> = {};

  const bal = { ...start };

  for (const p of periods) {
    const g = per[p] || { income: 0, materials: 0, direct_subs: 0, direct_wages: 0, expense: 0, loan_debt: 0 };

    // flows for this period
    const rr = Math.max(0, nz(g.income) - (nz(g.materials) + nz(g.direct_subs) + nz(g.direct_wages)));
    realRevenue[p] = rr;

    const inflow = {
      profit: rr * nz(alloc.pct_profit),
      owners: rr * nz(alloc.pct_owners),
      tax: rr * nz(alloc.pct_tax),
      operating: rr * nz(alloc.pct_operating),
      vault: rr * nz(alloc.pct_vault),
    };

    const outflowOperating = nz(g.materials) + nz(g.direct_subs) + nz(g.direct_wages) + nz(g.expense) + nz(g.loan_debt);

    // roll-forward per account
    const next = {
      operating: bal.operating + nz(inflow.operating) - outflowOperating,
      profit:    bal.profit    + nz(inflow.profit),
      owners:    bal.owners    + nz(inflow.owners),
      tax:       bal.tax       + nz(inflow.tax),
      vault:     bal.vault     + nz(inflow.vault),
    };

    bal.operating = next.operating;
    bal.profit    = next.profit;
    bal.owners    = next.owners;
    bal.tax       = next.tax;
    bal.vault     = next.vault;

    snaps[p] = next;
  }

  return { snaps, realRevenue };
}

/* ---------- Page ---------- */
export default function Page() {
  const [tab, setTab] = useState<'dashboard' | 'accounts' | 'settings'>('dashboard');

  // active client (hard-coded for now)
  const [clientId] = useState('88c1a8d7-2d1d-4e21-87f8-e4bc4202939e');
  const [clientName, setClientName] = useState('Test Client');

  const [scale, setScale] = useState<Scale>('monthly');
  const [months, setMonths] = useState(9);
  const [startYM, setStartYM] = useState(dayjs().format('YYYY-MM'));

  // allocations (decimals)
  const [alloc, setAlloc] = useState<Alloc>({ pct_profit: 0.05, pct_owners: 0.30, pct_tax: 0.18, pct_operating: 0.47, pct_vault: 0 });
  const allocTotal = (nz(alloc.pct_profit) + nz(alloc.pct_owners) + nz(alloc.pct_tax) + nz(alloc.pct_operating) + nz(alloc.pct_vault)) * 100;

  // starting balances
  const [balances, setBalances] = useState<Bal>({ operating: 0, profit: 0, owners: 0, tax: 0, vault: 0 });

  // demo color customization for chart
  const [colors, setColors] = useState({
    total: '#1f77b4',
    operating: '#1f77b4',
    profit: '#2ca02c',
    owners: '#9467bd',
    tax: '#d62728',
    vault: '#8c564b',
  });
  const [chartMode, setChartMode] = useState<'total' | 'accounts'>('total');

  const [coa, setCoa] = useState<CoaAccount[]>([]);
  const [lines, setLines] = useState<ProjLine[]>([]);

  // load client name + basic data (if present)
  useEffect(() => {
    (async () => {
      try {
        const { data: c } = await supabase.from('clients').select('name').eq('id', clientId).maybeSingle();
        if (c?.name) setClientName(c.name);
      } catch {/* ignore */}
      const { data: coaRows } = await supabase
        .from('coa_accounts').select('id,name,group_key')
        .eq('client_id', clientId).order('group_key', { ascending: true }).order('name', { ascending: true });
      setCoa(coaRows || []);

      const { data: lineRows } = await supabase
        .from('proj_lines')
        .select(`
          id, client_id, coa_account_id, kind, name, amount, recurrence, every_n, start_date, end_date, pct_of_link, linked_to, increase_pct, increase_interval,
          coa_accounts!inner ( group_key, name )
        `)
        .eq('client_id', clientId);

      const mapped = (lineRows || []).map((r: any) => ({
        ...r,
        group_key: (r.coa_accounts?.group_key || 'expense') as CoaGroup,
        amount: nz(r.amount),
        every_n: r.every_n ?? 1,
        start_date: r.start_date || dayjs().format('YYYY-MM-01'),
      }));
      setLines(mapped);
    })();
  }, [clientId]);

  /* periods */
  const periods = useMemo(() => buildPeriods(scale, startYM, months), [scale, startYM, months]);

  /* build per-period totals from projection lines */
  const EMPTY: Totals = { income: 0, materials: 0, direct_subs: 0, direct_wages: 0, expense: 0, loan_debt: 0 };
  const perTotals: PerTotals = useMemo(() => {
    const per: PerTotals = {};
    for (const p of periods) per[p] = { ...EMPTY };

    const ensure = (k: PeriodKey) => { if (!per[k]) per[k] = { ...EMPTY }; };

    const startBoundary = dayjs(`${startYM}-01`);
    const endBoundary = startBoundary.add(months, 'month').endOf('month');
    const inRange = (d: dayjs.Dayjs) => d.isAfter(startBoundary.subtract(1, 'day')) && d.isBefore(endBoundary.add(1, 'day'));

    for (const ln of lines) {
      const every = ln.every_n || 1;
      let d = dayjs(ln.start_date);
      if (!d.isValid()) continue;
      const stop = ln.end_date ? dayjs(ln.end_date) : endBoundary;
      if (!stop.isValid()) continue;

      const bump = (k: PeriodKey) => {
        ensure(k);
        (per[k] as any)[ln.group_key] = nz((per[k] as any)[ln.group_key]) + nz(ln.amount);
      };

      if (ln.recurrence === 'one_off') {
        if (inRange(d)) bump(scale === 'monthly' ? ym(d) : d.format('MMM D'));
        continue;
      }

      let guard = 0;
      while (d.isBefore(stop) || d.isSame(stop, 'day')) {
        if (inRange(d)) bump(scale === 'monthly' ? ym(d) : d.format('MMM D'));
        d = step(d, ln.recurrence, every);
        if (++guard > 2000) break;
      }
    }
    return per;
  }, [lines, periods, scale, startYM, months]);

  /* forecast (roll-forward) */
  const forecast = useMemo(() => runForecast(perTotals, periods, alloc, balances), [perTotals, periods, alloc, balances]);

  /* chart data */
  const chartData = useMemo(() => {
    return periods.map((p) => {
      const s = forecast.snaps[p] || { operating: 0, profit: 0, owners: 0, tax: 0, vault: 0 };
      const total = s.operating + s.profit + s.owners + s.tax + s.vault;
      return {
        name: mmmYY(p),
        Total: total,
        Operating: s.operating,
        Profit: s.profit,
        Owners: s.owners,
        Tax: s.tax,
        Vault: s.vault,
      };
    });
  }, [periods, forecast]);

  /* table rows (ending balances only) */
  const endingTable = useMemo(() => {
    return periods.map((p) => {
      const s = forecast.snaps[p] || { operating: 0, profit: 0, owners: 0, tax: 0, vault: 0 };
      return {
        period: mmmYY(p),
        opEnd: s.operating,
        profitEnd: s.profit,
        ownersEnd: s.owners,
        taxEnd: s.tax,
        vaultEnd: s.vault,
      };
    });
  }, [periods, forecast]);

  return (
    <div style={{ maxWidth: 1200, margin: '0 auto', padding: 16 }}>
      {/* Top Bar */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
        <div>
          <div style={{ fontSize: 18, fontWeight: 700 }}>{clientName} — Profit First Forecast</div>
          <div style={{ fontSize: 12, color: '#666' }}>
            View:{' '}
            <select value={scale} onChange={(e) => setScale(e.target.value as Scale)} style={inpt}>
              <option value="monthly">Monthly</option>
              <option value="weekly">Weekly (Mon–Sun)</option>
            </select>
            &nbsp; • Horizon:&nbsp;
            <select value={months} onChange={(e) => setMonths(parseInt(e.target.value, 10))} style={inpt}>
              <option value={9}>9</option><option value={12}>12</option><option value={18}>18</option><option value={24}>24</option>
            </select>
            &nbsp; • Start&nbsp;
            <input type="month" value={startYM} onChange={(e) => setStartYM(e.target.value)} style={inpt} />
          </div>
        </div>

        <div style={{ display: 'flex', gap: 8 }}>
          {['dashboard', 'accounts', 'settings'].map((t) => (
            <button key={t} onClick={() => setTab(t as any)} style={{ ...btn, background: tab === t ? '#111' : '#fff', color: tab === t ? '#fff' : '#111' }}>
              {t[0].toUpperCase() + t.slice(1)}
            </button>
          ))}
        </div>
      </div>

      {/* DASHBOARD */}
      {tab === 'dashboard' && (
        <>
          {/* Chart card with toggle + color pickers */}
          <div style={card}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
              <div style={{ fontWeight: 600 }}>Projected Ending Balances</div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <label style={{ fontSize: 12 }}>
                  Mode:&nbsp;
                  <select value={chartMode} onChange={(e) => setChartMode(e.target.value as any)} style={{ ...inpt, padding: '4px 6px' }}>
                    <option value="total">Total balance</option>
                    <option value="accounts">Individual accounts</option>
                  </select>
                </label>
                {/* quick color pickers */}
                {chartMode === 'accounts' && (
                  <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                    {(['operating','profit','owners','tax','vault'] as const).map(k => (
                      <label key={k} style={{ fontSize: 11, display: 'flex', alignItems: 'center', gap: 4 }}>
                        {k[0].toUpperCase()+k.slice(1)} <input type="color" value={(colors as any)[k]} onChange={(e) => setColors(c => ({ ...c, [k]: e.target.value }))} />
                      </label>
                    ))}
                  </div>
                )}
              </div>
            </div>

            <div style={{ width: '100%', height: 280 }}>
              <ResponsiveContainer>
                {chartMode === 'total' ? (
                  <AreaChart data={chartData}>
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis dataKey="name" tickFormatter={(v) => v} />
                    <YAxis tickFormatter={(v) => formatCurrency(v)} />
                    <Tooltip formatter={(v:any) => formatCurrency(v)} />
                    <Area type="monotone" dataKey="Total" stroke={colors.total} fill={colors.total + '22'} />
                  </AreaChart>
                ) : (
                  <LineChart data={chartData}>
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis dataKey="name" />
                    <YAxis tickFormatter={(v) => formatCurrency(v)} />
                    <Tooltip formatter={(v:any) => formatCurrency(v)} />
                    <Legend />
                    <Line type="monotone" dataKey="Operating" stroke={colors.operating} dot={false} />
                    <Line type="monotone" dataKey="Profit"    stroke={colors.profit}    dot={false} />
                    <Line type="monotone" dataKey="Owners"    stroke={colors.owners}    dot={false} />
                    <Line type="monotone" dataKey="Tax"       stroke={colors.tax}       dot={false} />
                    <Line type="monotone" dataKey="Vault"     stroke={colors.vault}     dot={false} />
                  </LineChart>
                )}
              </ResponsiveContainer>
            </div>
          </div>

          {/* Ending balances table */}
          <div style={card}>
            <div style={{ fontWeight: 600, marginBottom: 8 }}>Ending Bank Balances (roll-forward)</div>
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                <thead>
                  <tr>
                    <th style={th}>Row</th>
                    {endingTable.map((r) => (
                      <th key={r.period} style={{ ...th, textAlign: 'right' }}>{r.period}</th>
                    ))}
                    <th style={th}></th>
                  </tr>
                </thead>
                <tbody>
                  {[
                    ['Operating (End)', 'opEnd'] as const,
                    ['Profit (End)', 'profitEnd'] as const,
                    ["Owner's (End)", 'ownersEnd'] as const,
                    ['Tax (End)', 'taxEnd'] as const,
                    ['Vault (End)', 'vaultEnd'] as const,
                  ].map(([label, key]) => (
                    <tr key={key}>
                      <td style={{ ...td, fontWeight: 700 }}>{label}</td>
                      {endingTable.map((r) => (
                        <td key={r.period} style={{ ...td, textAlign: 'right' }}>
                          {formatCurrency((r as any)[key])}
                        </td>
                      ))}
                      <td style={td}></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}

      {/* ACCOUNTS placeholder (we'll wire drill-down next) */}
      {tab === 'accounts' && (
        <div style={card}>
          <div style={{ fontWeight: 600, marginBottom: 6 }}>Accounts</div>
          <div style={{ color: '#555', fontSize: 13 }}>
            This tab will host the **drill-down view** you described: Beginning Balance → Inflows (allocations & custom inflows) → Outflows (line items) → Ending Balance,
            with the chart focusing on the selected account and the forecast working monthly or weekly.
          </div>
        </div>
      )}

      {/* SETTINGS (allocations + balances) */}
      {tab === 'settings' && (
        <div style={card}>
          <div style={{ fontWeight: 600, marginBottom: 8 }}>Allocations (% of Real Revenue)</div>
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'flex-end' }}>
            {[
              ['pct_profit', 'Profit'],
              ['pct_owners', "Owner's"],
              ['pct_tax', 'Tax'],
              ['pct_operating', 'Operating'],
              ['pct_vault', 'Vault'],
            ].map(([k, label]) => (
              <label key={k} style={{ display: 'flex', flexDirection: 'column', fontSize: 12 }}>
                {label}
                <input
                  style={{ ...inpt, width: 90 }}
                  type="number"
                  step="0.01"
                  value={Math.round(nz((alloc as any)[k]) * 10000) / 100}
                  onChange={(e) => {
                    const pct = Math.max(0, nz(e.target.value) / 100);
                    setAlloc((a) => ({ ...a, [k]: pct } as any));
                  }}
                />
              </label>
            ))}
            <div style={{ fontSize: 12, fontWeight: 600, padding: '6px 10px', borderRadius: 6, background: allocTotal === 100 ? '#e8f8f1' : '#fff5f5', border: '1px solid #eee' }}>
              Total: {allocTotal.toFixed(2)}%
              {allocTotal !== 100 && <span style={{ color: '#b91c1c' }}> — should equal 100%</span>}
            </div>
          </div>

          <div style={{ marginTop: 14 }}>
            <div style={{ fontWeight: 600, marginBottom: 6 }}>Starting Balances</div>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              {(['operating', 'profit', 'owners', 'tax', 'vault'] as const).map((k) => (
                <label key={k} style={{ display: 'flex', flexDirection: 'column', fontSize: 12 }}>
                  {k}
                  <input
                    style={{ ...inpt, width: 130 }}
                    type="number"
                    step="0.01"
                    value={nz((balances as any)[k]).toString()}
                    onChange={(e) => setBalances((b) => ({ ...b, [k]: nz(e.target.value) }))}
                  />
                </label>
              ))}
            </div>
          </div>

          <div style={{ marginTop: 16, display: 'flex', gap: 12, flexWrap: 'wrap' }}>
            <label style={{ fontSize: 12 }}>Total color <input type="color" value={colors.total} onChange={(e) => setColors(c => ({ ...c, total: e.target.value }))} /></label>
          </div>
        </div>
      )}
    </div>
  );
}

/* ---------- styles ---------- */
const inpt: React.CSSProperties = { border: '1px solid #e5e7eb', borderRadius: 6, padding: '6px 8px', background: '#fff' };
const btn: React.CSSProperties = { border: '1px solid #111', background: '#111', color: '#fff', borderRadius: 8, padding: '8px 12px', cursor: 'pointer' };
const card: React.CSSProperties = { background: '#fff', border: '1px solid #e5e7eb', borderRadius: 12, padding: 12, marginBottom: 12 };
const th: React.CSSProperties = { textAlign: 'left', padding: '8px 10px', borderBottom: '1px solid #eee', fontWeight: 600, fontSize: 12, whiteSpace: 'nowrap' };
const td: React.CSSProperties = { padding: '8px 10px', borderBottom: '1px solid #f2f2f2', whiteSpace: 'nowrap' };
