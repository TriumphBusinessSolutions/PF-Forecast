'use client';

import { useEffect, useMemo, useState } from 'react';
import dayjs from 'dayjs';
import isoWeek from 'dayjs/plugin/isoWeek';
import { createClient } from '@supabase/supabase-js';
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Area, AreaChart,
} from 'recharts';
import dynamic from 'next/dynamic';
const ChartBlock = dynamic(() => import('./ChartBlock'), { ssr: false });

dayjs.extend(isoWeek);

/* ---------- Supabase ---------- */
const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
if (!url || !key) {
  console.warn('Supabase env vars missing; dashboard will run without data.');
}
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
type PerTotals = Record<
  PeriodKey,
  { income: number; materials: number; direct_subs: number; direct_wages: number; expense: number; loan_debt: number }
>;

const GROUP_LABELS: Record<CoaGroup, string> = {
  income: 'Income',
  materials: 'Materials',
  direct_subs: 'Direct Subcontractors',
  direct_wages: 'Direct Wages',
  expense: 'Operating Expenses',
  loan_debt: 'Loan/Debt',
};

/* ---------- Helpers ---------- */
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
function weekLabelShortForDate(d: dayjs.Dayjs) {
  const mon = d.isoWeekday() === 1 ? d : d.isoWeekday(8);
  const sun = mon.add(6, 'day');
  return `${mon.format('MMM D')}–${sun.format(mon.month() === sun.month() ? 'D' : 'MMM D')}`;
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
  const realRevenue: Record<PeriodKey, number> = {};
  const snaps: Record<PeriodKey, { operating: any; profit: any; owners: any; tax: any; vault: any }> = {};

  const bal = { ...start };
  const accounts = ['operating', 'profit', 'owners', 'tax', 'vault'] as const;

  for (const p of periods) {
    const g = per[p] || { income: 0, materials: 0, direct_subs: 0, direct_wages: 0, expense: 0, loan_debt: 0 };

    const rr = Math.max(0, g.income - (g.materials + g.direct_subs + g.direct_wages));
    realRevenue[p] = rr;

    const a = {
      profit: rr * (alloc.pct_profit || 0),
      owners: rr * (alloc.pct_owners || 0),
      tax: rr * (alloc.pct_tax || 0),
      operating: rr * (alloc.pct_operating || 0),
      vault: rr * (alloc.pct_vault || 0),
    };

    const out = {
      operating: g.materials + g.direct_subs + g.direct_wages + g.expense + g.loan_debt,
      profit: 0,
      owners: 0,
      tax: 0,
      vault: 0,
    };

    const s: any = {};
    for (const acc of accounts) {
      const begin = (bal as any)[acc];
      const inflows = (a as any)[acc] ?? 0;
      const outflows = (out as any)[acc] ?? 0;
      const end = begin + inflows - outflows;
      (bal as any)[acc] = end;
      s[acc] = { begin, inflows, outflows, end };
    }
    snaps[p] = s;
  }

  return { realRevenue, snaps };
}
// Simple client-side error boundary so the UI never white-screens
import React from 'react';
class ErrorBoundary extends React.Component<{ children: React.ReactNode }, { hasError: boolean; msg?: string }> {
  constructor(props: any) {
    super(props);
    this.state = { hasError: false };
  }
  static getDerivedStateFromError(error: any) {
    return { hasError: true, msg: String(error?.message || error) };
  }
  componentDidCatch(error: any, info: any) {
    // optional: send to logging later
    console.error('Client error:', error, info);
  }
  render() {
    if (this.state.hasError) {
      return (
        <div style={{ padding: 12, border: '1px solid #fee2e2', background: '#fef2f2', color: '#991b1b', borderRadius: 8 }}>
          <div style={{ fontWeight: 700, marginBottom: 6 }}>Something went wrong rendering this section.</div>
          <div style={{ fontSize: 12 }}>{this.state.msg}</div>
        </div>
      );
    }
    return this.props.children as any;
  }
}

/* ---------- Component ---------- */
export default function Page() {
  const [tab, setTab] = useState<'dashboard' | 'accounts' | 'settings'>('dashboard');

  // You can store the active client UUID in URL later; for now keep state here
  const [clientId, setClientId] = useState('88c1a8d7-2d1d-4e21-87f8-e4bc4202939e');
  const [clientName, setClientName] = useState<string>('Client');

  const [scale, setScale] = useState<Scale>('monthly');
  const [months, setMonths] = useState(9);
  const [startYM, setStartYM] = useState(dayjs().format('YYYY-MM'));

  // allocations, with robust numeric inputs
  const [alloc, setAlloc] = useState<Alloc>({ pct_profit: 0.05, pct_owners: 0.30, pct_tax: 0.18, pct_operating: 0.47, pct_vault: 0 });
  const allocTotal = (alloc.pct_profit + alloc.pct_owners + alloc.pct_tax + alloc.pct_operating + (alloc.pct_vault || 0)) * 100;

  const [balances, setBalances] = useState<Bal>({ operating: 0, profit: 0, owners: 0, tax: 0, vault: 0 });

  const [coa, setCoa] = useState<CoaAccount[]>([]);
  const [lines, setLines] = useState<ProjLine[]>([]);

  const [showAddModal, setShowAddModal] = useState<{ open: boolean; targetGroup?: CoaGroup }>({ open: false });
  const [detail, setDetail] = useState<{ open: boolean; account?: CoaAccount }>({ open: false });

  /* load client name, COA, and lines */
  useEffect(() => {
    (async () => {
      if (!clientId) return;

      // client name (fallback to 'Client' if table not present yet)
      try {
        const { data: c } = await supabase.from('clients').select('name').eq('id', clientId).maybeSingle();
        if (c?.name) setClientName(c.name);
      } catch {
        setClientName('Client');
      }

      const { data: coaRows } = await supabase
        .from('coa_accounts')
        .select('id,name,group_key')
        .eq('client_id', clientId)
        .order('group_key', { ascending: true })
        .order('name', { ascending: true });

      setCoa(coaRows || []);

      const { data: lineRows } = await supabase
        .from('proj_lines')
        .select(`
          id, client_id, coa_account_id, kind, name, amount, recurrence, every_n, start_date, end_date, pct_of_link, linked_to, increase_pct, increase_interval,
          coa_accounts!inner ( group_key, name )
        `)
        .eq('client_id', clientId);

      const mapped = (lineRows || []).map((r: any) => ({ ...r, group_key: r.coa_accounts.group_key as CoaGroup }));
      setLines(mapped);
    })();
  }, [clientId]);

  /* compute period table */
  const periods = useMemo(() => buildPeriods(scale, startYM, months), [scale, startYM, months]);

  const perTotals: PerTotals = useMemo(() => {
    const per: PerTotals = {};
    const ensure = (k: PeriodKey) => { per[k] ??= { income: 0, materials: 0, direct_subs: 0, direct_wages: 0, expense: 0, loan_debt: 0 }; };
    periods.forEach(ensure);

    for (const ln of lines) {
      const every = ln.every_n || 1;
      const start = dayjs(ln.start_date);
      const end = ln.end_date ? dayjs(ln.end_date) : dayjs(`${startYM}-01`).add(months, 'month').endOf('month');
      const inRange = (d: dayjs.Dayjs) => d.isAfter(dayjs(`${startYM}-01`).subtract(1, 'day')) && d.isBefore(end.add(1, 'day'));

      if (ln.recurrence === 'one_off') {
        if (inRange(start)) {
          const k = scale === 'monthly' ? ym(start) : weekLabelShortForDate(start);
          (per[k] as any)[ln.group_key] += ln.amount;
        }
      } else {
        let d = start; let guard = 0;
        while (d.isBefore(end) || d.isSame(end, 'day')) {
          if (inRange(d)) {
            const k = scale === 'monthly' ? ym(d) : weekLabelShortForDate(d);
            (per[k] as any)[ln.group_key] += ln.amount;
          }
          d = step(d, ln.recurrence, every);
          if (++guard > 1000) break;
        }
      }
    }
    return per;
  }, [lines, periods, scale, startYM, months]);

  const EMPTY: { income: number; materials: number; direct_subs: number; direct_wages: number; expense: number; loan_debt: number } = {
  income: 0,
  materials: 0,
  direct_subs: 0,
  direct_wages: 0,
  expense: 0,
  loan_debt: 0,
};

const forecastRows = useMemo(() => {
  // Always have a row object for every period key
  const f = runForecast(perTotals, periods, alloc, balances);

  return periods.map((p) => {
    const g = perTotals[p] ?? EMPTY; // <-- defensive default
    const income = g.income || 0;
    const materials = g.materials || 0;
    const direct = (g.direct_subs || 0) + (g.direct_wages || 0);
    const expense = (g.expense || 0) + (g.loan_debt || 0);

    return {
      period: p,
      income,
      materials,
      direct,
      expense,
      realRevenue: f.realRevenue[p] ?? Math.max(0, income - (materials + direct)),
      opEnd: f.snaps[p]?.operating?.end ?? 0,
      profitEnd: f.snaps[p]?.profit?.end ?? 0,
      ownersEnd: f.snaps[p]?.owners?.end ?? 0,
      taxEnd: f.snaps[p]?.tax?.end ?? 0,
      vaultEnd: f.snaps[p]?.vault?.end ?? 0,
    };
  });
}, [perTotals, periods, alloc, balances]);


  const chartData = useMemo(
    () => forecastRows.map((r) => ({ name: r.period, Operating: r.opEnd, Profit: r.profitEnd, Owners: r.ownersEnd, Tax: r.taxEnd, Vault: r.vaultEnd })),
    [forecastRows]
  );

  /* ---------- UI ---------- */
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
            <select value={months} onChange={(e) => setMonths(parseInt(e.target.value))} style={inpt}>
              <option value={9}>9</option><option value={12}>12</option><option value={18}>18</option><option value={24}>24</option>
            </select>
            &nbsp; • Start&nbsp;
            <input type="month" value={startYM} onChange={(e) => setStartYM(e.target.value)} style={inpt} />
          </div>
        </div>

        {/* Tabs */}
        <div style={{ display: 'flex', gap: 8 }}>
          {['dashboard', 'accounts', 'settings'].map((t) => (
            <button key={t} onClick={() => setTab(t as any)} style={{ ...btn, background: tab === t ? '#111' : '#fff', color: tab === t ? '#fff' : '#111' }}>
              {t[0].toUpperCase() + t.slice(1)}
            </button>
          ))}
        </div>
      </div>

      {/* Settings (Current vs Target, Allocations) */}
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
                  value={((alloc as any)[k] || 0) * 100}
                  onChange={(e) => {
                    const v = Math.max(0, parseFloat(e.target.value || '0')) / 100;
                    setAlloc((a) => ({ ...a, [k]: v }));
                  }}
                />
              </label>
            ))}
            <div style={{ fontSize: 12, fontWeight: 600, padding: '6px 10px', borderRadius: 6, background: allocTotal === 100 ? '#e8f8f1' : '#fff5f5', border: '1px solid #eee' }}>
              Total: {allocTotal.toFixed(2)}%
              {allocTotal !== 100 && <span style={{ color: '#b91c1c' }}> — should equal 100%</span>}
            </div>
          </div>

          <div style={{ marginTop: 14, fontSize: 12, color: '#444' }}>
            <strong>Current vs Target</strong> — Add target TAPs here later; for now this panel stores the live allocation % used by the forecast.
          </div>

          <div style={{ marginTop: 14 }}>
            <div style={{ fontWeight: 600, marginBottom: 6 }}>Starting Balances</div>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              {(['operating', 'profit', 'owners', 'tax', 'vault'] as const).map((k) => (
                <label key={k} style={{ display: 'flex', flexDirection: 'column', fontSize: 12 }}>
                  {k}
                  <input
                    style={{ ...inpt, width: 110 }}
                    type="number"
                    value={(balances as any)[k]}
                    onChange={(e) => setBalances((b) => ({ ...b, [k]: parseFloat(e.target.value || '0') }))}
                  />
                </label>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Accounts (COA manager) */}
      {tab === 'accounts' && (
        <div style={card}>
          <div style={{ fontWeight: 600, marginBottom: 8 }}>Chart of Accounts</div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,minmax(0,1fr))', gap: 12 }}>
            {(['income', 'materials', 'direct_subs', 'direct_wages', 'expense', 'loan_debt'] as CoaGroup[]).map((g) => {
              const items = coa.filter((c) => c.group_key === g);
              return (
                <div key={g}>
                  <div style={{ fontSize: 12, fontWeight: 700, marginBottom: 6 }}>{GROUP_LABELS[g]}</div>
                  <ul style={{ fontSize: 13, marginLeft: 18 }}>
                    {items.map((i) => <li key={i.id}>{i.name}</li>)}
                    {items.length === 0 && <li style={{ color: '#999' }}>None yet</li>}
                  </ul>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Dashboard */}
      {tab === 'dashboard' && (
        <>
         {/* Graph */}
<div style={card}>
  <div style={{ fontWeight: 600, marginBottom: 8 }}>Projected Ending Balances</div>
  <ChartBlock data={chartData as any} />
</div>


          {/* Ledger-like table with groups & add buttons */}
          <div style={card}>
            <div style={{ fontWeight: 600, marginBottom: 8 }}>Forecast Table</div>
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                <thead>
                  <tr>
                    <th style={th}>Row</th>
                    {forecastRows.map((r) => (
                      <th key={r.period} style={{ ...th, textAlign: 'right' }}>{r.period}</th>
                    ))}
                    <th style={th}></th>
                  </tr>
                </thead>
                <tbody>
                  {/* Starting balances row */}
                  <tr>
                    <td style={{ ...td, fontWeight: 600 }}>Starting Balances</td>
                    {forecastRows.map((_, i) => (
                      <td key={i} style={{ ...td, textAlign: 'right', color: '#666' }}>
                        {i === 0 ? Object.values(balances).reduce((a, b) => a + (b || 0), 0).toLocaleString(undefined, { style: 'currency', currency: 'USD' }) : '—'}
                      </td>
                    ))}
                    <td style={td}></td>
                  </tr>

                  {/* Income */}
                  {renderGroup('Income', 'income', (p) => p.income)}

                  {/* Direct Costs (materials + subs + wages) */}
                  {renderGroup('Direct Costs', 'directCosts', (p) => p.materials + p.direct)}

                  {/* Real Revenue */}
                  <tr>
                    <td style={{ ...td, fontWeight: 700 }}>Real Revenue</td>
                    {forecastRows.map((r) => <td key={r.period} style={{ ...td, textAlign: 'right' }}>{r.realRevenue.toLocaleString(undefined, { style: 'currency', currency: 'USD' })}</td>)}
                    <td style={td}></td>
                  </tr>

                  {/* Operating Expenses (incl. loan/debt) */}
                  {renderGroup('Operating Expenses', 'expense', (p) => p.expense)}

                  {/* Ending balances by PF accounts */}
                  {[
                    ['Operating (End)', 'opEnd'] as const,
                    ['Profit (End)', 'profitEnd'] as const,
                    ["Owner's (End)", 'ownersEnd'] as const,
                    ['Tax (End)', 'taxEnd'] as const,
                    ['Vault (End)', 'vaultEnd'] as const,
                  ].map(([label, key]) => (
                    <tr key={key}>
                      <td style={{ ...td, fontWeight: 700 }}>{label}</td>
                      {forecastRows.map((r) => <td key={r.period} style={{ ...td, textAlign: 'right' }}>{(r as any)[key].toLocaleString(undefined, { style: 'currency', currency: 'USD' })}</td>)}
                      <td style={td}></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}

      {/* Add Line Modal */}
      {showAddModal.open && (
        <AddLineModal
          clientId={clientId}
          group={showAddModal.targetGroup}
          coa={coa}
          onClose={() => setShowAddModal({ open: false })}
          onAdded={(ln) => setLines((prev) => [...prev, ln])}
        />
      )}

      {/* Account Detail Modal */}
      {detail.open && detail.account && (
        <AccountDetailModal
          account={detail.account}
          lines={lines.filter((l) => l.coa_account_id === detail.account!.id)}
          onClose={() => setDetail({ open: false })}
        />
      )}
    </div>
  );

  /* ---- local render helpers ---- */
  function renderGroup(label: string, key: 'income' | 'directCosts' | 'expense', picker: (r: any) => number) {
    return (
      <tr>
        <td style={{ ...td, fontWeight: 700 }}>
          {label}
          <button
            title={`Add to ${label}`}
            onClick={() =>
              setShowAddModal({
                open: true,
                targetGroup:
                  key === 'income' ? 'income' :
                    key === 'expense' ? 'expense' :
                      'materials' /* default under direct costs; user can change in modal */,
              })
            }
            style={{ marginLeft: 8, ...btnGhost }}
          >+</button>
        </td>
        {forecastRows.map((r) => (
          <td key={r.period} style={{ ...td, textAlign: 'right' }}>
            {picker(r).toLocaleString(undefined, { style: 'currency', currency: 'USD' })}
          </td>
        ))}
        <td style={td}></td>
      </tr>
    );
  }
}

/* ---------- Small components ---------- */

function AddLineModal({
  clientId, group, coa, onClose, onAdded,
}: {
  clientId: string;
  group?: CoaGroup;
  coa: CoaAccount[];
  onClose: () => void;
  onAdded: (l: ProjLine) => void;
}) {
  const [coaId, setCoaId] = useState('');
  const [name, setName] = useState('');
  const [kind, setKind] = useState<LineKind>('income');
  const [amount, setAmount] = useState<number>(0);
  const [recurrence, setRecurrence] = useState<'one_off' | 'monthly' | 'weekly' | 'biweekly' | 'quarterly' | 'semiannual' | 'annual'>('monthly');
  const [every_n, setEvery] = useState<number>(1);
  const [start_date, setStart] = useState<string>(dayjs().format('YYYY-MM-01'));

  useEffect(() => {
    if (group) {
      const first = coa.find((c) => c.group_key === group);
      if (first) setCoaId(first.id);
      setKind(group === 'income' ? 'income' : 'expense');
    }
  }, [group, coa]);

  const save = async () => {
    if (!coaId || !name) { alert('Pick an account and name'); return; }
    const { data, error } = await supabase.from('proj_lines').insert({
      client_id: clientId, coa_account_id: coaId, kind, name, amount, recurrence, every_n, start_date,
    }).select(`
      id, client_id, coa_account_id, kind, name, amount, recurrence, every_n, start_date, end_date, pct_of_link, linked_to, increase_pct, increase_interval,
      coa_accounts ( group_key )
    `).single();
    if (error) { alert(error.message); return; }
    const mapped = { ...(data as any), group_key: (data as any).coa_accounts.group_key as CoaGroup } as ProjLine;
    onAdded(mapped);
    onClose();
  };

  return (
    <div style={modalBackdrop}>
      <div style={modalBody}>
        <div style={{ fontWeight: 700, marginBottom: 8 }}>Add Projection Line</div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
          <label style={lab}>Account
            <select style={inpt} value={coaId} onChange={(e) => setCoaId(e.target.value)}>
              <option value="">Select…</option>
              {coa.map((c) => <option key={c.id} value={c.id}>{c.name} ({GROUP_LABELS[c.group_key]})</option>)}
            </select>
          </label>
          <label style={lab}>Kind
            <select style={inpt} value={kind} onChange={(e) => setKind(e.target.value as LineKind)}>
              <option value="income">Income</option>
              <option value="expense">Expense</option>
            </select>
          </label>
          <label style={lab}>Name <input style={inpt} value={name} onChange={(e) => setName(e.target.value)} /></label>
          <label style={lab}>Amount <input style={inpt} type="number" value={amount} onChange={(e) => setAmount(parseFloat(e.target.value || '0'))} /></label>
          <label style={lab}>Recurrence
            <select style={inpt} value={recurrence} onChange={(e) => setRecurrence(e.target.value as any)}>
              <option value="one_off">One-off</option>
              <option value="monthly">Monthly</option>
              <option value="weekly">Weekly</option>
              <option value="biweekly">Bi-weekly</option>
              <option value="quarterly">Quarterly</option>
              <option value="semiannual">Semi-annual</option>
              <option value="annual">Annual</option>
            </select>
          </label>
          <label style={lab}>Every N <input style={inpt} type="number" value={every_n} onChange={(e) => setEvery(parseInt(e.target.value || '1'))} /></label>
          <label style={lab}>Start Date <input style={inpt} type="date" value={start_date} onChange={(e) => setStart(e.target.value)} /></label>
        </div>
        <div style={{ display: 'flex', gap: 8, marginTop: 10, justifyContent: 'flex-end' }}>
          <button style={btnGhost} onClick={onClose}>Cancel</button>
          <button style={btn} onClick={save}>Save</button>
        </div>
      </div>
    </div>
  );
}

function AccountDetailModal({
  account, lines, onClose,
}: { account: CoaAccount; lines: ProjLine[]; onClose: () => void }) {
  return (
    <div style={modalBackdrop}>
      <div style={modalBody}>
        <div style={{ fontWeight: 700, marginBottom: 8 }}>{account.name} — Details</div>
        <div style={{ maxHeight: 360, overflow: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
            <thead>
              <tr>
                <th style={th}>Name</th><th style={th}>Kind</th><th style={th}>Recurrence</th><th style={{ ...th, textAlign: 'right' }}>Amount</th><th style={th}>Start</th>
              </tr>
            </thead>
            <tbody>
              {lines.map((l) => (
                <tr key={l.id}>
                  <td style={td}>{l.name}</td>
                  <td style={td}>{l.kind}</td>
                  <td style={td}>{l.recurrence}{l.every_n ? ` / ${l.every_n}` : ''}</td>
                  <td style={{ ...td, textAlign: 'right' }}>{l.amount.toLocaleString(undefined, { style: 'currency', currency: 'USD' })}</td>
                  <td style={td}>{l.start_date}</td>
                </tr>
              ))}
              {lines.length === 0 && <tr><td style={{ ...td, color: '#777' }} colSpan={5}>No projections yet</td></tr>}
            </tbody>
          </table>
        </div>
        <div style={{ display: 'flex', gap: 8, marginTop: 10, justifyContent: 'flex-end' }}>
          <button style={btn} onClick={onClose}>Close</button>
        </div>
      </div>
    </div>
  );
}

/* ---------- styles ---------- */
const inpt: React.CSSProperties = { border: '1px solid #e5e7eb', borderRadius: 6, padding: '6px 8px', background: '#fff' };
const btn: React.CSSProperties = { border: '1px solid #111', background: '#111', color: '#fff', borderRadius: 8, padding: '8px 12px', cursor: 'pointer' };
const btnGhost: React.CSSProperties = { border: '1px solid #e5e7eb', background: '#fff', color: '#111', borderRadius: 8, padding: '6px 10px', cursor: 'pointer' };
const card: React.CSSProperties = { background: '#fff', border: '1px solid #e5e7eb', borderRadius: 12, padding: 12, marginBottom: 12 };
const th: React.CSSProperties = { textAlign: 'left', padding: '8px 10px', borderBottom: '1px solid #eee', fontWeight: 600, fontSize: 12, whiteSpace: 'nowrap' };
const td: React.CSSProperties = { padding: '8px 10px', borderBottom: '1px solid #f2f2f2', whiteSpace: 'nowrap' };
const lab: React.CSSProperties = { display: 'flex', flexDirection: 'column', fontSize: 12, gap: 4 };
const modalBackdrop: React.CSSProperties = { position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.2)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 50 };
const modalBody: React.CSSProperties = { background: '#fff', border: '1px solid #e5e7eb', borderRadius: 12, padding: 12, minWidth: 620 };
