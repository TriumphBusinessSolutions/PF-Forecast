'use client'
import { useEffect, useMemo, useState } from 'react'
import { supabase } from '@/lib/supabase'
import dayjs from 'dayjs'
import isoWeek from 'dayjs/plugin/isoWeek'
dayjs.extend(isoWeek)

type CoaGroup = 'income'|'materials'|'direct_subs'|'direct_wages'|'expense'|'loan_debt'
type LineKind = 'income'|'expense'
type Scale = 'monthly'|'weekly'
type PeriodKey = string

type CoaAccount = {
  id: string
  name: string
  group_key: CoaGroup
}
type ProjLine = {
  id: string
  client_id: string
  coa_account_id: string
  kind: LineKind
  name: string
  amount: number
  recurrence: 'one_off'|'daily'|'weekly'|'biweekly'|'monthly'|'quarterly'|'semiannual'|'annual'
  every_n: number | null
  start_date: string
  end_date: string | null
  pct_of_link: number | null
  linked_to: string | null
  increase_pct: number | null
  increase_interval: 'weeks'|'months'|null
}

const GROUP_LABELS: Record<CoaGroup,string> = {
  income: 'Income',
  materials: 'Materials',
  direct_subs: 'Direct Subcontractors',
  direct_wages: 'Direct Wages',
  expense: 'Operating Expenses',
  loan_debt: 'Loan/Debt'
}

// ---------- Helpers for weekly/monthly periods ----------
const ym = (d: dayjs.Dayjs)=> d.format('YYYY-MM')
function weeksInMonth(year:number, month1to12:number){
  const first = dayjs(`${year}-${String(month1to12).padStart(2,'0')}-01`)
  const last = first.endOf('month')
  let mon = first.isoWeekday() === 1 ? first : first.isoWeekday(8) // Monday on/after 1st
  if(mon.month() !== first.month()) mon = mon.add(1,'week')
  const out: {label:string, mon:dayjs.Dayjs, sun:dayjs.Dayjs}[] = []
  while(mon.isBefore(last) || mon.isSame(last,'day')){
    let sun = mon.add(6,'day')
    if(sun.month() !== first.month()) sun = last
    out.push({ label: `${mon.format('YYYY-MM-DD')} — ${sun.format('YYYY-MM-DD')}`, mon, sun })
    mon = mon.add(1,'week')
  }
  return out
}
function buildPeriods(scale:Scale, startYM:string, months:number): PeriodKey[] {
  if(scale==='monthly'){
    const start = dayjs(`${startYM}-01`)
    return Array.from({length: months}, (_,i)=> start.add(i,'month').format('YYYY-MM'))
  }
  const [y0,m0] = startYM.split('-').map(Number)
  let y=y0, m=m0
  const out: string[] = []
  for(let i=0;i<months;i++){
    weeksInMonth(y,m).forEach(w=> out.push(w.label))
    m++; if(m>12){m=1;y++}
  }
  return out
}
function weekLabelForDate(d: dayjs.Dayjs){
  const mon = d.isoWeekday() === 1 ? d : d.isoWeekday(8)
  const sun = mon.add(6,'day')
  return `${mon.format('YYYY-MM-DD')} — ${sun.format('YYYY-MM-DD')}`
}

// ---------- Forecast math ----------
type PerTotals = Record<PeriodKey, {
  income: number, materials: number, direct_subs: number, direct_wages: number, expense: number, loan_debt: number
}>
function expand(lines: ProjLine[], scale:Scale, startYM:string, months:number): PerTotals {
  const start = dayjs(`${startYM}-01`)
  const end = start.add(months,'month').endOf('month')
  const per: PerTotals = {}
  const ensure = (k:PeriodKey)=>{ per[k] ??= {income:0, materials:0, direct_subs:0, direct_wages:0, expense:0, loan_debt:0} }
  buildPeriods(scale, startYM, months).forEach(ensure)

  // simple recurrence expansion
  for(const ln of lines){
    const step = (d:dayjs.Dayjs)=> {
      switch(ln.recurrence){
        case 'daily': return d.add(ln.every_n||1,'day')
        case 'weekly': return d.add(7*(ln.every_n||1),'day')
        case 'biweekly': return d.add(14*(ln.every_n||1),'day')
        case 'monthly': return d.add(ln.every_n||1,'month')
        case 'quarterly': return d.add(3*(ln.every_n||1),'month')
        case 'semiannual': return d.add(6*(ln.every_n||1),'month')
        case 'annual': return d.add(12*(ln.every_n||1),'month')
        default: return d
      }
    }

    if(ln.recurrence==='one_off'){
      const dt = dayjs(ln.start_date)
      if(dt.isBefore(start) || dt.isAfter(end)) continue
      const k = scale==='monthly' ? ym(dt) : weekLabelForDate(dt)
      ensure(k)
      per[k][accountGroupOf(ln)] += ln.amount
      continue
    }

    let dt = dayjs(ln.start_date)
    const stop = ln.end_date ? dayjs(ln.end_date) : end
    let guard=0
    while((dt.isBefore(stop) || dt.isSame(stop,'day')) && dt.isBefore(end.add(1,'day'))){
      if(dt.isAfter(start) || dt.isSame(start,'day')){
        const k = scale==='monthly' ? ym(dt) : weekLabelForDate(dt)
        ensure(k)
        per[k][accountGroupOf(ln)] += ln.amount
      }
      dt = step(dt)
      if(++guard>1000) break
    }
  }
  return per

  function accountGroupOf(ln:ProjLine): CoaGroup {
    // We only have group_key on the COA; since we only have the line row here, we handle by kind + expected COA:
    // For the MVP, treat all income lines as 'income' and all expense lines as their actual COA group by join in fetch step.
    // In this page we will fetch with a join to include group_key in the line.
    return 'income' // placeholder, replaced at fetch time via mappedLines
  }
}

type Alloc = { pct_profit:number; pct_owners:number; pct_tax:number; pct_operating:number; pct_vault?:number }
type Bal = { operating:number; profit:number; owners:number; tax:number; vault:number }
function runForecast(per: PerTotals, periods:PeriodKey[], alloc:Alloc, start:Bal){
  const realRevenue: Record<PeriodKey, number> = {}
  const allocations: Record<PeriodKey, Bal> = {}
  const snaps: Record<PeriodKey, {operating:any; profit:any; owners:any; tax:any; vault:any}> = {}
  const bal = { ...start }

  for(const p of periods){
    const g = per[p] || {income:0, materials:0, direct_subs:0, direct_wages:0, expense:0, loan_debt:0}
    const rr = Math.max(0, g.income - (g.materials + g.direct_subs + g.direct_wages))
    realRevenue[p] = rr

    const a = {
      profit: rr * alloc.pct_profit,
      owners: rr * alloc.pct_owners,
      tax: rr * alloc.pct_tax,
      operating: rr * alloc.pct_operating,
      vault: rr * (alloc.pct_vault ?? 0)
    }
    allocations[p] = a as Bal

    const out = {
      operating: g.materials + g.direct_subs + g.direct_wages + g.expense + g.loan_debt,
      profit: 0, owners: 0, tax: 0, vault: 0
    }

    const s:any = {}
    ;(['operating','profit','owners','tax','vault'] as const).forEach(acc=>{
      const begin = (bal as any)[acc]
      const inflows = (a as any)[acc] || 0
      const outflows = (out as any)[acc] || 0
      const end = begin + inflows - outflows
      (bal as any)[acc] = end
      s[acc] = { begin, inflows, outflows, end }
    })
    snaps[p] = s
  }
  return { realRevenue, allocations, snaps }
}

// ---------- UI ----------
export default function Page(){
  // prefill with your client ID so you don’t have to hunt for it
  const [clientId, setClientId] = useState('88c1a8d7-2d1d-4e21-87f8-e4bc4202939e')
  const [scale, setScale] = useState<Scale>('monthly')
  const [months, setMonths] = useState(9)
  const [startYM, setStartYM] = useState(dayjs().format('YYYY-MM'))

  const [coa, setCoa] = useState<CoaAccount[]>([])
  const [lines, setLines] = useState<(ProjLine & {group_key: CoaGroup})[]>([])
  const [alloc, setAlloc] = useState({ pct_profit:0.05, pct_owners:0.30, pct_tax:0.18, pct_operating:0.47, pct_vault:0 })
  const [balances, setBalances] = useState<Bal>({ operating:0, profit:0, owners:0, tax:0, vault:0 })

  // Load COA + Lines (with a join to get group_key on each line)
  useEffect(()=>{
    if(!clientId) return
    ;(async()=>{
      const { data: coaRows } = await supabase
        .from('coa_accounts')
        .select('id,name,group_key')
        .eq('client_id', clientId)
        .order('group_key', { ascending: true })
        .order('name', { ascending: true })
      setCoa(coaRows||[])

      const { data: lineRows } = await supabase
        .from('proj_lines')
        .select(`
          id, client_id, coa_account_id, kind, name, amount, recurrence, every_n, start_date, end_date, pct_of_link, linked_to, increase_pct, increase_interval,
          coa_accounts!inner ( group_key )
        `)
        .eq('client_id', clientId)
      const mapped = (lineRows||[]).map((r:any)=> ({...r, group_key: r.coa_accounts.group_key as CoaGroup}))
      setLines(mapped)
    })()
  }, [clientId])

  // Compute forecast table
  const table = useMemo(()=>{
    const periods = buildPeriods(scale, startYM, months)
    // Expand per period using each line's *COA group*:
    const per: PerTotals = {}
    const ensure = (k:PeriodKey)=>{ per[k] ??= {income:0, materials:0, direct_subs:0, direct_wages:0, expense:0, loan_debt:0} }
    periods.forEach(ensure)

    // very small, readable expansion similar to expand()
    for(const ln of lines){
      const add = (k:PeriodKey, grp:CoaGroup, amt:number)=>{ ensure(k); (per[k] as any)[grp]+=amt }
      const recur = ln.recurrence
      const every = ln.every_n || 1
      const start = dayjs(ln.start_date)
      const end = ln.end_date ? dayjs(ln.end_date) : dayjs(`${startYM}-01`).add(months,'month').endOf('month')
      const inRange=(d:dayjs.Dayjs)=> (d.isAfter(dayjs(`${startYM}-01`).subtract(1,'day')) && d.isBefore(end.add(1,'day')))

      if(recur==='one_off'){
        if(inRange(start)){
          const k = scale==='monthly' ? ym(start) : weekLabelForDate(start)
          add(k, ln.group_key, ln.amount)
        }
      } else {
        let d = start
        let guard = 0
        while(d.isBefore(end) || d.isSame(end,'day')){
          if(inRange(d)){
            const k = scale==='monthly' ? ym(d) : weekLabelForDate(d)
            add(k, ln.group_key, ln.amount)
          }
          d = step(d, recur, every)
          if(++guard>1000) break
        }
      }
    }

    const f = runForecast(per, periods, alloc, balances)
    return periods.map(p=>({
      period:p,
      realRevenue: f.realRevenue[p]||0,
      operating: f.snaps[p].operating.end,
      profit: f.snaps[p].profit.end,
      owners: f.snaps[p].owners.end,
      tax: f.snaps[p].tax.end,
      vault: f.snaps[p].vault.end
    }))
  }, [lines, scale, months, startYM, alloc, balances])

  return (
    <div className="max-w-6xl mx-auto p-4 space-y-4">
      <h1 className="text-xl font-semibold">PF Forecast — First Draft</h1>

      {/* Controls */}
      <div className="flex flex-wrap gap-3 items-end">
        <label className="flex flex-col text-sm">
          Client ID
          <input className="border rounded px-2 py-1" value={clientId} onChange={e=>setClientId(e.target.value)} />
        </label>
        <label className="flex flex-col text-sm">
          View
          <select className="border rounded px-2 py-1" value={scale} onChange={e=>setScale(e.target.value as Scale)}>
            <option value="monthly">Monthly</option>
            <option value="weekly">Weekly (Mon→Sun)</option>
          </select>
        </label>
        <label className="flex flex-col text-sm">
          Horizon (months)
          <select className="border rounded px-2 py-1" value={months} onChange={e=>setMonths(parseInt(e.target.value))}>
            <option value={9}>9</option>
            <option value={12}>12</option>
            <option value={18}>18</option>
            <option value={24}>24</option>
          </select>
        </label>
        <label className="flex flex-col text-sm">
          Start month
          <input className="border rounded px-2 py-1" type="month" value={startYM} onChange={e=>setStartYM(e.target.value)} />
        </label>

        {/* Allocation %s */}
        <div className="flex gap-3 items-end">
          <span className="text-sm font-semibold">Allocations (% of Real Revenue):</span>
          {(['pct_profit','pct_owners','pct_tax','pct_operating'] as const).map(k=>{
            const label = {pct_profit:'Profit', pct_owners:\"Owner's\", pct_tax:'Tax', pct_operating:'Operating'}[k]
            return (
              <label key={k} className="flex flex-col text-sm">
                {label}
                <input className="border rounded px-2 py-1 w-20"
                  type="number" step="0.01" value={(alloc as any)[k]*100}
                  onChange={e=>setAlloc(a=>({...a, [k]: (parseFloat(e.target.value||'0')/100)}))}
                />
              </label>
            )
          })}
        </div>

        {/* Starting balances */}
        <div className="flex gap-3 items-end">
          <span className="text-sm font-semibold">Starting balances:</span>
          {(['operating','profit','owners','tax','vault'] as const).map(k=>(
            <label key={k} className="flex flex-col text-sm">
              {k}
              <input className="border rounded px-2 py-1 w-24" type="number"
                value={(balances as any)[k]}
                onChange={e=>setBalances(b=>({...b, [k]: parseFloat(e.target.value||'0')}))}
              />
            </label>
          ))}
        </div>
      </div>

      {/* COA Manager (view + add) */}
      <div className="bg-white rounded shadow p-3">
        <div className="flex items-center justify-between mb-2">
          <div className="font-semibold">Chart of Accounts (custom names)</div>
          <AddAccount clientId={clientId} onAdded={acc=> setCoa(prev=> [...prev, acc])} />
        </div>
        <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
          {(['income','materials','direct_subs','direct_wages','expense','loan_debt'] as CoaGroup[]).map(g=>{
            const items = coa.filter(c=> c.group_key===g)
            return (
              <div key={g}>
                <div className="text-sm font-semibold mb-1">{GROUP_LABELS[g]}</div>
                <ul className="text-sm list-disc ml-5">
                  {items.map(i=> <li key={i.id}>{i.name}</li>)}
                  {items.length===0 && <li className="text-gray-400">None yet</li>}
                </ul>
              </div>
            )
          })}
        </div>
      </div>

      {/* Projections (view + add) */}
      <div className="bg-white rounded shadow p-3">
        <div className="flex items-center justify-between mb-2">
          <div className="font-semibold">Projection Lines</div>
          <AddLine clientId={clientId} coa={coa} onAdded={ln=> setLines(prev=> [...prev, ln])} />
        </div>
        <div className="overflow-auto">
          <table className="min-w-full text-sm">
            <thead>
              <tr>
                <th className="text-left p-2">Account</th>
                <th className="text-left p-2">Name</th>
                <th className="text-left p-2">Kind</th>
                <th className="text-left p-2">Recurrence</th>
                <th className="text-right p-2">Amount</th>
                <th className="text-left p-2">Start</th>
              </tr>
            </thead>
            <tbody>
              {lines.map(l=>{
                const acc = coa.find(c=> c.id===l.coa_account_id)
                return (
                  <tr key={l.id}>
                    <td className="p-2">{acc?.name||'—'} <span className="text-gray-400">({GROUP_LABELS[l.group_key]})</span></td>
                    <td className="p-2">{l.name}</td>
                    <td className="p-2">{l.kind}</td>
                    <td className="p-2">{l.recurrence}{l.every_n ? ` / ${l.every_n}`:''}</td>
                    <td className="p-2 text-right">{l.amount.toLocaleString()}</td>
                    <td className="p-2">{l.start_date}</td>
                  </tr>
                )
              })}
              {lines.length===0 && <tr><td className="p-2 text-gray-500" colSpan={6}>No lines yet</td></tr>}
            </tbody>
          </table>
        </div>
      </div>

      {/* Ledger */}
      <div className="bg-white rounded shadow p-3">
        <div className="font-semibold mb-2">Ledger (periods across columns)</div>
        <div className="overflow-auto">
          <table className="min-w-full text-sm">
            <thead>
              <tr>
                <th className="text-left p-2">Row</th>
                {table.map(r=> <th key={r.period} className="text-right p-2">{r.period}</th>)}
              </tr>
            </thead>
            <tbody>
              {[
                {k:'realRevenue', label:'Real Revenue'},
                {k:'operating', label:'Operating (End)'},
                {k:'profit', label:'Profit (End)'},
                {k:'owners', label:\"Owner's (End)\"},
                {k:'tax', label:'Tax (End)'},
                {k:'vault', label:'Vault (End)'},
              ].map(row=>(
                <tr key={row.k}>
                  <td className="p-2 font-semibold">{row.label}</td>
                  {table.map(r=> <td key={r.period} className="text-right p-2">{(r as any)[row.k].toLocaleString()}</td>)}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )

  function step(d:dayjs.Dayjs, recur:ProjLine['recurrence'], every:number){
    switch(recur){
      case 'daily': return d.add(every,'day')
      case 'weekly': return d.add(7*every,'day')
      case 'biweekly': return d.add(14*every,'day')
      case 'monthly': return d.add(every,'month')
      case 'quarterly': return d.add(3*every,'month')
      case 'semiannual': return d.add(6*every,'month')
      case 'annual': return d.add(12*every,'month')
      default: return d
    }
  }
}

// ----- Small components to add COA accounts & lines -----
function AddAccount({ clientId, onAdded }:{ clientId:string, onAdded:(a:CoaAccount)=>void }){
  const [name,setName]=useState('')
  const [group_key,setGroup]=useState<CoaGroup>('income')
  const save=async()=>{
    if(!name) return
    const { data, error } = await supabase.from('coa_accounts').insert({ client_id:clientId, name, group_key }).select('id,name,group_key').single()
    if(error){ alert(error.message); return }
    onAdded(data as any); setName('')
  }
  return (
    <div className="flex gap-2">
      <select className="border rounded px-2 py-1" value={group_key} onChange={e=>setGroup(e.target.value as CoaGroup)}>
        <option value="income">Income</option>
        <option value="materials">Materials</option>
        <option value="direct_subs">Direct Subs</option>
        <option value="direct_wages">Direct Wages</option>
        <option value="expense">Expense</option>
        <option value="loan_debt">Loan/Debt</option>
      </select>
      <input className="border rounded px-2 py-1" placeholder="Account name" value={name} onChange={e=>setName(e.target.value)} />
      <button className="border rounded px-3 py-1" onClick={save}>Add</button>
    </div>
  )
}

function AddLine({ clientId, coa, onAdded }:{ clientId:string, coa:CoaAccount[], onAdded:(l:any)=>void }){
  const [coaId,setCoaId]=useState('')
  const [name,setName]=useState('')
  const [kind,setKind]=useState<LineKind>('income')
  const [amount,setAmount]=useState<number>(0)
  const [recurrence,setRecurrence]=useState<'one_off'|'monthly'|'weekly'|'biweekly'|'quarterly'|'semiannual'|'annual'>('monthly')
  const [every_n,setEvery]=useState<number>(1)
  const [start_date,setStart]=useState<string>(dayjs().format('YYYY-MM-01'))

  const save=async()=>{
    if(!coaId || !name || !amount) return
    const { data, error } = await supabase.from('proj_lines').insert({
      client_id: clientId, coa_account_id: coaId, kind, name, amount,
      recurrence, every_n, start_date
    }).select(`
      id, client_id, coa_account_id, kind, name, amount, recurrence, every_n, start_date, end_date, pct_of_link, linked_to, increase_pct, increase_interval,
      coa_accounts ( group_key )
    `).single()
    if(error){ alert(error.message); return }
    const mapped = { ...data, group_key: (data as any).coa_accounts.group_key }
    onAdded(mapped); setName(''); setAmount(0)
  }

  return (
    <div className="flex flex-wrap gap-2">
      <select className="border rounded px-2 py-1 w-56" value={coaId} onChange={e=>setCoaId(e.target.value)}>
        <option value="">Select account…</option>
        {coa.map(c=> <option key={c.id} value={c.id}>{c.name} ({GROUP_LABELS[c.group_key]})</option>)}
      </select>
      <input className="border rounded px-2 py-1" placeholder="Line name" value={name} onChange={e=>setName(e.target.value)} />
      <select className="border rounded px-2 py-1" value={kind} onChange={e=>setKind(e.target.value as LineKind)}>
        <option value="income">Income</option>
        <option value="expense">Expense</option>
      </select>
      <input className="border rounded px-2 py-1 w-28" type="number" placeholder="Amount" value={amount} onChange={e=>setAmount(parseFloat(e.target.value||'0'))} />
      <select className="border rounded px-2 py-1" value={recurrence} onChange={e=>setRecurrence(e.target.value as any)}>
        <option value="one_off">One-off</option>
        <option value="monthly">Monthly</option>
        <option value="weekly">Weekly</option>
        <option value="biweekly">Bi-weekly</option>
        <option value="quarterly">Quarterly</option>
        <option value="semiannual">Semi-annual</option>
        <option value="annual">Annual</option>
      </select>
      <input className="border rounded px-2 py-1 w-20" type="number" value={every_n} onChange={e=>setEvery(parseInt(e.target.value||'1'))} />
      <input className="border rounded px-2 py-1" type="date" value={start_date} onChange={e=>setStart(e.target.value)} />
      <button className="border rounded px-3 py-1" onClick={save}>Add Line</button>
    </div>
  )
}
