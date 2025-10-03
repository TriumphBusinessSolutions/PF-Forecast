"use client";

import React, { useMemo, useState, useEffect } from "react";
import Head from "next/head";
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from "recharts";

// ✅ You already have this client in your repo
import { supabase } from "../lib/supabase";

/**
 * Profit First Cash Flow Projection – LIVE (Multi‑Client)
 * ------------------------------------------------------
 * Full page component. Paste this whole file into app/page.tsx.
 *
 * New: Client selector (dropdown) + Add Client button.
 * All data loads/saves for the chosen client.
 */

// ------------------------------
// Brand Tokens
// ------------------------------
const BRAND = {
  blue: "#004aad",
  orange: "#fa9100",
  blueDark: "#00337a",
};

// ------------------------------
// Helpers
// ------------------------------
const fmtCurrency = (n: number) =>
  new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(n || 0);

const shortMonth = (ym: string) => {
  const dt = new Date(ym + "-01");
  return dt.toLocaleDateString("en-US", { month: "short", year: "2-digit" }).replace(" ", "-");
};

// ------------------------------
// Types from our views
// ------------------------------

type PFAccountKey = "Operating" | "Profit" | "OwnersPay" | "Tax" | "Vault";

interface ClientRow { id: string; name: string }

// Ending balances view
interface BalRow {
  client_id: string;
  ym: string; // YYYY-MM
  month_start: string; // date
  operating_end: number;
  profit_end: number;
  owners_pay_end: number;
  tax_end: number;
  vault_end: number;
}

// Monthly activity view
interface ActivityRow {
  client_id: string;
  ym: string; // YYYY-MM
  income: number;
  materials: number;
  direct_subs: number;
  direct_wages: number;
  operating: number;
  profit: number;
  owners_pay: number;
  tax: number;
  vault: number;
}

// Real revenue view
interface RealRevRow {
  client_id: string;
  ym: string;
  real_revenue: number;
}

// COA basic (for drill-down labeling)
interface CoaRow { id: string; group_key: string; name?: string }

// Occurrence rows for drill-down
interface OccRow {
  client_id: string;
  month_start: string; // date
  coa_account_id: string;
  kind: string;
  name: string;
  amount: number;
}

// Settings – Profit
interface ProfitSettings {
  profit_next_distribution_date: string; // YYYY-MM-DD
  profit_distribution_pct: number; // 0..1
  profit_remainder_to_vault_pct: number; // 0..1
  profit_distribution_anchor: "quarter_start" | "rolling_3mo";
}

// Settings – Tax
interface TaxSettings {
  tax_blended_rate: number;
  tax_adjustment_pct: number;
  tax_use_equal_installments: boolean;
  tax_first_applicable_year: number;
}

// Allocation settings
interface AllocationSettings {
  Operating: number; Profit: number; OwnersPay: number; Tax: number; Vault: number;
}

// ------------------------------
// Tiny UI atoms
// ------------------------------
const Card: React.FC<React.PropsWithChildren<{ title?: string; className?: string }>> = ({ title, className, children }) => (
  <div className={`rounded-2xl shadow-lg bg-white border border-slate-100 ${className || ""}`} style={{ background: "linear-gradient(180deg, #ffffff 0%, #f8faff 100%)" }}>
    {title && (
      <div className="px-5 py-3 rounded-t-2xl text-white font-semibold" style={{ backgroundColor: BRAND.blue }}>
        {title}
      </div>
    )}
    <div className="p-5">{children}</div>
  </div>
);

const Badge: React.FC<{ label: string; tone?: "blue" | "orange" | "slate" }> = ({ label, tone = "blue" }) => {
  const bg = tone === "orange" ? BRAND.orange : tone === "slate" ? "#e2e8f0" : BRAND.blue;
  const txt = tone === "slate" ? "#0f172a" : "#ffffff";
  return (
    <span className="inline-block text-xs font-semibold px-2.5 py-1 rounded-full" style={{ backgroundColor: bg, color: txt }}>
      {label}
    </span>
  );
};

const Tabs: React.FC<{ tabs: { id: string; label: string }[]; value: string; onChange: (id: string) => void; }> = ({ tabs, value, onChange }) => (
  <div className="flex gap-2 flex-wrap">
    {tabs.map((t) => (
      <button
        key={t.id}
        onClick={() => onChange(t.id)}
        className={`px-4 py-2 rounded-full text-sm font-medium border transition shadow-sm ${value === t.id ? "bg-[var(--brand-blue)] text-white" : "bg-white text-slate-800 hover:bg-slate-50"}`}
        style={{ borderColor: value === t.id ? BRAND.blue : "#e2e8f0", backgroundColor: value === t.id ? BRAND.blue : undefined }}
      >
        {t.label}
      </button>
    ))}
  </div>
);

const SlideOver: React.FC<{ open: boolean; title: string; onClose: () => void; children: React.ReactNode; }> = ({ open, title, onClose, children }) => {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-40">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />
      <div className="absolute right-0 top-0 h-full w-full sm:w-[520px] bg-white shadow-2xl p-6 overflow-y-auto">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-xl font-semibold" style={{ color: BRAND.blue }}>{title}</h3>
          <button className="text-slate-600 hover:text-slate-900" onClick={onClose}>✕</button>
        </div>
        {children}
      </div>
    </div>
  );
};

// ------------------------------
// Page Component – LIVE Multi‑Client
// ------------------------------
export default function Page() {
  // Clients
  const [clients, setClients] = useState<ClientRow[]>([]);
  const [clientId, setClientId] = useState<string | null>(null);

  // Tabs & chart toggle
  const [tab, setTab] = useState("dashboard");
  const [showSeries, setShowSeries] = useState<"total" | "accounts">("total");

  // Drill-down
  const [drillAccount, setDrillAccount] = useState<PFAccountKey | null>(null);
  const [drillMonth, setDrillMonth] = useState<string | null>(null);

  // LIVE state
  const [months, setMonths] = useState<string[]>([]);
  const [activity, setActivity] = useState<ActivityRow[]>([]);
  const [balances, setBalances] = useState<BalRow[]>([]);
  const [realRev, setRealRev] = useState<RealRevRow[]>([]);
  const [coa, setCoa] = useState<Record<string, CoaRow>>({});
  const [occRows, setOccRows] = useState<OccRow[]>([]);

  // Settings (defaults; real ones load from DB)
  const [profitSettings, setProfitSettings] = useState<ProfitSettings>({
    profit_next_distribution_date: "2025-10-31",
    profit_distribution_pct: 0.5,
    profit_remainder_to_vault_pct: 0.0,
    profit_distribution_anchor: "rolling_3mo",
  });
  const [taxSettings, setTaxSettings] = useState<TaxSettings>({
    tax_blended_rate: 0.3,
    tax_adjustment_pct: 0.05,
    tax_use_equal_installments: true,
    tax_first_applicable_year: new Date().getFullYear(),
  });
  const [alloc, setAlloc] = useState<AllocationSettings>({ Operating: 0.45, Profit: 0.1, OwnersPay: 0.3, Tax: 0.1, Vault: 0.05 });

  // Allocation validation
  const allocTotal = alloc.Operating + alloc.Profit + alloc.OwnersPay + alloc.Tax + alloc.Vault;
  const allocValid = Math.abs(allocTotal - 1) < 0.0001;

  // -------- Load clients once --------
  useEffect(() => {
    (async () => {
      const { data, error } = await supabase.from("clients").select("id, name").order("created_at");
      if (error) {
        console.error("clients load error", error);
        return;
      }
      setClients(data ?? []);
      if (!clientId && data && data.length > 0) setClientId(data[0].id);
    })();
  }, []);

  // -------- Load COA (per client) --------
  useEffect(() => {
    if (!clientId) return;
    (async () => {
      const { data } = await supabase.from("coa_accounts").select("id, group_key, name").eq("client_id", clientId);
      const map: Record<string, CoaRow> = {};
      (data ?? []).forEach((r: any) => (map[r.id] = { id: r.id, group_key: r.group_key, name: r.name }));
      setCoa(map);
    })();
  }, [clientId]);

  // -------- Load dashboard data when client changes --------
  useEffect(() => {
    if (!clientId) return;
    (async () => {
      const { data: act, error: e1 } = await supabase
        .from("v_monthly_activity").select("*")
        .eq("client_id", clientId).order("ym");
      if (e1) console.error("v_monthly_activity error", e1);

      const { data: end, error: e2 } = await supabase
        .from("v_pf_balances").select("*")
        .eq("client_id", clientId).order("month_start");
      if (e2) console.error("v_pf_balances error", e2);

      const { data: rr, error: e3 } = await supabase
        .from("v_real_revenue").select("*")
        .eq("client_id", clientId).order("ym");
      if (e3) console.error("v_real_revenue error", e3);

      const ymList = (act ?? []).map((r: any) => r.ym);
      setMonths(ymList);
      setActivity((act ?? []) as ActivityRow[]);
      setBalances((end ?? []) as BalRow[]);
      setRealRev((rr ?? []) as RealRevRow[]);

      // Settings
      const { data: pd } = await supabase
        .from("profit_distributions").select("*")
        .eq("client_id", clientId).limit(1).single();
      if (pd) setProfitSettings({
        profit_next_distribution_date: pd.next_distribution_date ?? "2025-10-31",
        profit_distribution_pct: Number(pd.distribution_pct ?? 0.5),
        profit_remainder_to_vault_pct: Number(pd.remainder_to_vault_pct ?? 0.0),
        profit_distribution_anchor: (pd.anchor ?? "rolling_3mo"),
      });

      const { data: ts } = await supabase
        .from("tax_settings").select("*")
        .eq("client_id", clientId).limit(1).single();
      if (ts) setTaxSettings({
        tax_blended_rate: Number(ts.blended_rate ?? 0.3),
        tax_adjustment_pct: Number(ts.adjustment_pct ?? 0.05),
        tax_use_equal_installments: !!ts.use_equal_installments,
        tax_first_applicable_year: Number(ts.first_applicable_year ?? new Date().getFullYear()),
      });

      const { data: ap } = await supabase
        .from("allocation_plans").select("*")
        .eq("client_id", clientId).order("effective_date", { ascending: false }).limit(1);
      if (ap && ap[0]) setAlloc({
        Operating: Number(ap[0].operating_pct ?? 0.45),
        Profit: Number(ap[0].profit_pct ?? 0.1),
        OwnersPay: Number(ap[0].owners_pay_pct ?? 0.3),
        Tax: Number(ap[0].tax_pct ?? 0.1),
        Vault: Number(ap[0].vault_pct ?? 0.05),
      });
    })();
  }, [clientId]);

  // -------- Build chart/table inputs from live state --------
  const pfAccounts: PFAccountKey[] = ["Operating", "Profit", "OwnersPay", "Tax", "Vault"];

  const chartData = useMemo(() => {
    return months.map((ym) => {
      const b = balances.find((x) => x.ym === ym);
      const Operating = b?.operating_end ?? 0;
      const Profit = b?.profit_end ?? 0;
      const OwnersPay = b?.owners_pay_end ?? 0;
      const Tax = b?.tax_end ?? 0;
      const Vault = b?.vault_end ?? 0;
      return { month: ym, label: shortMonth(ym), Operating, Profit, OwnersPay, Tax, Vault, Total: Operating + Profit + OwnersPay + Tax + Vault };
    });
  }, [months, balances]);

  const realRevenue = useMemo(() => months.map((ym) => ({ month: ym, RealRevenue: realRev.find((r) => r.ym === ym)?.real_revenue ?? 0 })), [months, realRev]);

  const activityRows = useMemo(() => months.map((ym) => {
    const r = activity.find((a) => a.ym === ym);
    return {
      month: ym,
      Income: r?.income ?? 0,
      Materials: r?.materials ?? 0,
      DirectSubs: r?.direct_subs ?? 0,
      DirectWages: r?.direct_wages ?? 0,
      Operating: r?.operating ?? 0,
      Profit: r?.profit ?? 0,
      OwnersPay: r?.owners_pay ?? 0,
      Tax: r?.tax ?? 0,
      Vault: r?.vault ?? 0,
    };
  }), [months, activity]);

  // -------- Drill-down: click a PF row and month to see inflows/outflows --------
  async function openDrill(pfAccount: PFAccountKey, ym: string) {
    if (!clientId) return;
    setDrillAccount(pfAccount);
    setDrillMonth(ym);

    const monthStart = ym + "-01";
    const { data, error } = await supabase
      .from("v_proj_occurrences")
      .select("client_id, month_start, coa_account_id, kind, name, amount")
      .eq("client_id", clientId)
      .eq("month_start", monthStart);

    if (error) {
      console.error("v_proj_occurrences error", error);
      setOccRows([]);
      return;
    }

    const filtered = (data ?? []).filter((row: any) => coa[row.coa_account_id]?.group_key === pfAccount);
    setOccRows(filtered as OccRow[]);
  }

  // ------------------------------
  // UI
  // ------------------------------
  return (
    <main className="min-h-screen bg-slate-50">
      <Head>
        <link href="https://fonts.googleapis.com/css2?family=Rubik:wght@300;400;500;600;700;800&display=swap" rel="stylesheet" />
        <title>Cash Flow Projection – Profit First</title>
      </Head>

      <style jsx global>{`
        :root { --brand-blue: ${BRAND.blue}; --brand-orange: ${BRAND.orange}; }
        html, body { font-family: 'Rubik', system-ui, -apple-system, Segoe UI, Roboto, 'Helvetica Neue', Arial; }
      `}</style>

      <div className="max-w-[1200px] mx-auto px-4 py-8">
        <header className="mb-6">
          <div className="flex items-center justify-between gap-4 flex-wrap">
            <h1 className="text-2xl md:text-3xl font-extrabold tracking-tight" style={{ color: BRAND.blue }}>
              Profit First Cash Flow Projection
            </h1>
            <Tabs tabs={[{ id: "dashboard", label: "Dashboard" }, { id: "settings", label: "Settings" }]} value={tab} onChange={setTab} />
          </div>
          <p className="text-slate-600 mt-2">Pick a client, then the numbers dance. Add a client to make a new sandbox.</p>

          {/* Client Picker */}
          <div className="mt-4 flex items-center gap-3">
            <select
              value={clientId ?? ""}
              onChange={(e) => setClientId(e.target.value)}
              className="border rounded-lg px-3 py-2 bg-white"
            >
              {clients.map((c) => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </select>
            <button
              className="px-3 py-2 rounded-lg text-white"
              style={{ backgroundColor: BRAND.blue }}
              onClick={async () => {
                const name = prompt("New client name?");
                if (!name) return;
                const { data, error } = await supabase.from("clients").insert({ name }).select().single();
                if (error) { alert("Could not add client."); return; }
                setClients((prev) => [...prev, data as ClientRow]);
                setClientId((data as any).id);
              }}
            >
              + Add Client
            </button>
          </div>
        </header>

        {/* DASHBOARD */}
        {tab === "dashboard" && (
          <div className="space-y-6">
            {/* Top Chart */}
            <Card title="Balances Over Time">
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-2">
                  <Badge label="Triumph" />
                  <Badge label={showSeries === "total" ? "Total" : "Accounts"} tone="orange" />
                </div>
                <div className="flex items-center gap-2">
                  <label className="inline-flex items-center gap-2 text-sm">
                    <input type="radio" name="series" value="total" checked={showSeries === "total"} onChange={() => setShowSeries("total")} />
                    Total Only
                  </label>
                  <label className="inline-flex items-center gap-2 text-sm">
                    <input type="radio" name="series" value="accounts" checked={showSeries === "accounts"} onChange={() => setShowSeries("accounts")} />
                    Individual Accounts
                  </label>
                </div>
              </div>

              <div className="h-[320px]">
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={chartData} margin={{ top: 10, right: 24, bottom: 10, left: 24 }}>
                    <defs>
                      <linearGradient id="gTotal" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor={BRAND.blue} stopOpacity={0.35} />
                        <stop offset="95%" stopColor={BRAND.blue} stopOpacity={0.05} />
                      </linearGradient>
                      <linearGradient id="gOp" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="#64748b" stopOpacity={0.35} />
                        <stop offset="95%" stopColor="#64748b" stopOpacity={0.05} />
                      </linearGradient>
                      <linearGradient id="gProfit" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor={BRAND.orange} stopOpacity={0.35} />
                        <stop offset="95%" stopColor={BRAND.orange} stopOpacity={0.05} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis dataKey="label" />
                    <YAxis tickFormatter={(v) => fmtCurrency(Number(v))} width={80} />
                    <Tooltip formatter={(v: any) => fmtCurrency(Number(v))} />
                    <Legend />

                    {showSeries === "total" ? (
                      <Area type="monotone" dataKey="Total" stroke={BRAND.blue} fill="url(#gTotal)" name="Total" />
                    ) : (
                      <>
                        <Area type="monotone" dataKey="Operating" stroke="#64748b" fill="url(#gOp)" />
                        <Area type="monotone" dataKey="Profit" stroke={BRAND.orange} fill="url(#gProfit)" />
                        <Area type="monotone" dataKey="OwnersPay" stroke="#10b981" fillOpacity={0.1} />
                        <Area type="monotone" dataKey="Tax" stroke="#ef4444" fillOpacity={0.1} />
                        <Area type="monotone" dataKey="Vault" stroke="#8b5cf6" fillOpacity={0.1} />
                      </>
                    )}
                  </AreaChart>
                </ResponsiveContainer>
              </div>
            </Card>

            {/* Ending Balances Table */}
            <Card title="Ending Balances (Roll-Forward)">
              <div className="overflow-x-auto">
                <table className="min-w-full text-sm">
                  <thead>
                    <tr style={{ backgroundColor: BRAND.blue }} className="text-white">
                      <th className="px-3 py-2 text-left font-semibold">Account</th>
                      {months.map((m) => (
                        <th key={m} className="px-3 py-2 text-right font-semibold whitespace-nowrap">{shortMonth(m)}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {pfAccounts.map((acc) => (
                      <tr key={acc} className="hover:bg-slate-50">
                        <td className="px-3 py-2 font-medium text-slate-800">{acc}</td>
                        {months.map((m) => {
                          const b = balances.find((x) => x.ym === m);
                          const val = acc === "Operating" ? b?.operating_end
                            : acc === "Profit" ? b?.profit_end
                            : acc === "OwnersPay" ? b?.owners_pay_end
                            : acc === "Tax" ? b?.tax_end
                            : b?.vault_end;
                          return (
                            <td key={m} className="px-3 py-2 text-right text-slate-700 cursor-pointer" onClick={() => openDrill(acc, m)}>
                              {fmtCurrency(val ?? 0)}
                            </td>
                          );
                        })}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <p className="text-xs text-slate-500 mt-3">Ending balance = Prior ending + Net activity.</p>
            </Card>

            {/* Monthly Activity Table */}
            <Card title="Monthly Activity (Net Movement)">
              <div className="overflow-x-auto">
                <table className="min-w-full text-sm">
                  <thead>
                    <tr style={{ backgroundColor: BRAND.blue }} className="text-white">
                      <th className="px-3 py-2 text-left font-semibold">Row</th>
                      {months.map((m) => (
                        <th key={m} className="px-3 py-2 text-right font-semibold whitespace-nowrap">{shortMonth(m)}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    <tr className="hover:bg-slate-50">
                      <td className="px-3 py-2 font-medium text-slate-800">Income (gross)</td>
                      {activityRows.map((r) => (
                        <td key={r.month} className="px-3 py-2 text-right">{fmtCurrency(r.Income)}</td>
                      ))}
                    </tr>
                    <tr className="hover:bg-slate-50">
                      <td className="px-3 py-2 text-slate-700">Materials</td>
                      {activityRows.map((r) => (
                        <td key={r.month} className="px-3 py-2 text-right">{fmtCurrency(r.Materials)}</td>
                      ))}
                    </tr>
                    <tr className="hover:bg-slate-50">
                      <td className="px-3 py-2 text-slate-700">Direct Subcontractors</td>
                      {activityRows.map((r) => (
                        <td key={r.month} className="px-3 py-2 text-right">{fmtCurrency(r.DirectSubs)}</td>
                      ))}
                    </tr>
                    <tr className="hover:bg-slate-50">
                      <td className="px-3 py-2 text-slate-700">Direct Wages</td>
                      {activityRows.map((r) => (
                        <td key={r.month} className="px-3 py-2 text-right">{fmtCurrency(r.DirectWages)}</td>
                      ))}
                    </tr>
                    <tr className="hover:bg-slate-50 font-medium">
                      <td className="px-3 py-2 text-slate-800">Real Revenue</td>
                      {realRevenue.map((r) => (
                        <td key={r.month} className="px-3 py-2 text-right">{fmtCurrency(r.RealRevenue)}</td>
                      ))}
                    </tr>
                    {pfAccounts.map((acc) => (
                      <tr key={acc} className="hover:bg-slate-50">
                        <td className="px-3 py-2 font-medium text-slate-800">{acc} (net)</td>
                        {activityRows.map((r) => (
                          <td key={r.month} className="px-3 py-2 text-right cursor-pointer" onClick={() => openDrill(acc, r.month)}>
                            {fmtCurrency((r as any)[acc])}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <p className="text-xs text-slate-500 mt-3">For each month: Beginning + Net activity = Ending balance.</p>
            </Card>
          </div>
        )}

        {/* SETTINGS */}
        {tab === "settings" && (
          <div className="space-y-6">
            {/* Allocations */}
            <Card title="Allocation Targets">
              <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-5 gap-4">
                {pfAccounts.map((acc) => (
                  <div key={acc} className="space-y-1">
                    <label className="text-sm font-medium text-slate-700">{acc}</label>
                    <input type="number" step="0.01" min={0} max={1} value={(alloc as any)[acc]} onChange={(e) => setAlloc((prev) => ({ ...prev, [acc]: Number(e.target.value) }))} className="w-full border rounded-lg px-3 py-2" />
                  </div>
                ))}
              </div>
              <div className="mt-3 flex items-center justify-between">
                <div><Badge label={`Total: ${(allocTotal * 100).toFixed(1)}%`} tone={allocValid ? "blue" : "orange"} /></div>
                {!allocValid && <span className="text-sm font-medium text-orange-600">Allocations must total 100%.</span>}
              </div>
            </Card>

            {/* Profit Distributions */}
            <Card title="Profit Distributions">
              <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-4">
                <div className="space-y-1">
                  <label className="text-sm font-medium text-slate-700">Next Distribution Date</label>
                  <input type="date" value={profitSettings.profit_next_distribution_date} onChange={(e) => setProfitSettings((s) => ({ ...s, profit_next_distribution_date: e.target.value }))} className="w-full border rounded-lg px-3 py-2" />
                </div>
                <div className="space-y-1">
                  <label className="text-sm font-medium text-slate-700">Distribution % (to Owner)</label>
                  <input type="number" min={0} max={1} step={0.01} value={profitSettings.profit_distribution_pct} onChange={(e) => setProfitSettings((s) => ({ ...s, profit_distribution_pct: Number(e.target.value) }))} className="w-full border rounded-lg px-3 py-2" />
                </div>
                <div className="space-y-1">
                  <label className="text-sm font-medium text-slate-700">Remainder → Vault %</label>
                  <input type="number" min={0} max={1} step={0.01} value={profitSettings.profit_remainder_to_vault_pct} onChange={(e) => setProfitSettings((s) => ({ ...s, profit_remainder_to_vault_pct: Number(e.target.value) }))} className="w-full border rounded-lg px-3 py-2" />
                </div>
                <div className="space-y-1">
                  <label className="text-sm font-medium text-slate-700">Anchor (future)</label>
                  <select value={profitSettings.profit_distribution_anchor} onChange={(e) => setProfitSettings((s) => ({ ...s, profit_distribution_anchor: e.target.value as any }))} className="w-full border rounded-lg px-3 py-2">
                    <option value="rolling_3mo">Rolling 3 Months</option>
                    <option value="quarter_start">Quarter Start</option>
                  </select>
                </div>
              </div>
              <p className="text-sm text-slate-600 mt-3">
                On each distribution date: pay <strong>{(profitSettings.profit_distribution_pct * 100).toFixed(0)}%</strong> from Profit to Owner. From the remainder, move <strong>{(profitSettings.profit_remainder_to_vault_pct * 100).toFixed(0)}%</strong> into Vault.
              </p>
            </Card>

            {/* Tax Settings */}
            <Card title="Tax Estimates (Safe Harbor)">
              <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-4">
                <div className="space-y-1">
                  <label className="text-sm font-medium text-slate-700">Blended Rate</label>
                  <input type="number" min={0} max={1} step={0.01} value={taxSettings.tax_blended_rate} onChange={(e) => setTaxSettings((s) => ({ ...s, tax_blended_rate: Number(e.target.value) }))} className="w-full border rounded-lg px-3 py-2" />
                </div>
                <div className="space-y-1">
                  <label className="text-sm font-medium text-slate-700">Adjustment Buffer</label>
                  <input type="number" min={0} max={1} step={0.01} value={taxSettings.tax_adjustment_pct} onChange={(e) => setTaxSettings((s) => ({ ...s, tax_adjustment_pct: Number(e.target.value) }))} className="w-full border rounded-lg px-3 py-2" />
                </div>
                <div className="space-y-1">
                  <label className="text-sm font-medium text-slate-700">Equal Installments?</label>
                  <select value={taxSettings.tax_use_equal_installments ? "yes" : "no"} onChange={(e) => setTaxSettings((s) => ({ ...s, tax_use_equal_installments: e.target.value === "yes" }))} className="w-full border rounded-lg px-3 py-2">
                    <option value="yes">Yes</option>
                    <option value="no">No</option>
                  </select>
                </div>
                <div className="space-y-1">
                  <label className="text-sm font-medium text-slate-700">First Year</label>
                  <input type="number" value={taxSettings.tax_first_applicable_year} onChange={(e) => setTaxSettings((s) => ({ ...s, tax_first_applicable_year: Number(e.target.value) }))} className="w-full border rounded-lg px-3 py-2" />
                </div>
              </div>

              <div className="mt-4 overflow-x-auto">
                <table className="min-w-full text-sm">
                  <thead>
                    <tr style={{ backgroundColor: BRAND.blue }} className="text-white">
                      <th className="px-3 py-2 text-left font-semibold">Month</th>
                      <th className="px-3 py-2 text-right font-semibold">Taxable YTD (rough)</th>
                      <th className="px-3 py-2 text-right font-semibold">Projected Tax YTD</th>
                    </tr>
                  </thead>
                  <tbody>
                    {months.map((ym) => {
                      const aIdx = months.findIndex((m) => m === ym);
                      const ytdSlice = activity.slice(0, aIdx + 1);
                      const taxableYTD = ytdSlice.reduce((s, x) => s + (x.income || 0), 0)
                        - ytdSlice.reduce((s, x) => s + Math.abs(x.materials || 0) + Math.abs(x.direct_subs || 0) + Math.abs(x.direct_wages || 0) + Math.abs(Math.min(0, x.operating || 0)), 0);
                      const taxableAdj = taxableYTD * (1 + (taxSettings.tax_adjustment_pct || 0));
                      const projTaxYTD = taxableAdj * (taxSettings.tax_blended_rate || 0);
                      return (
                        <tr key={ym} className="odd:bg-white even:bg-slate-50">
                          <td className="px-3 py-2">{shortMonth(ym)}</td>
                          <td className="px-3 py-2 text-right">{fmtCurrency(taxableAdj)}</td>
                          <td className="px-3 py-2 text-right">{fmtCurrency(projTaxYTD)}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>

              <div className="flex gap-3 mt-4">
                <button
                  disabled={!clientId}
                  onClick={async () => {
                    if (!clientId) return;
                    await supabase.from("profit_distributions").upsert({
                      client_id: clientId,
                      next_distribution_date: profitSettings.profit_next_distribution_date,
                      distribution_pct: profitSettings.profit_distribution_pct,
                      remainder_to_vault_pct: profitSettings.profit_remainder_to_vault_pct,
                      anchor: profitSettings.profit_distribution_anchor,
                    }, { onConflict: "client_id" });

                    await supabase.from("tax_settings").upsert({
                      client_id: clientId,
                      blended_rate: taxSettings.tax_blended_rate,
                      adjustment_pct: taxSettings.tax_adjustment_pct,
                      use_equal_installments: taxSettings.tax_use_equal_installments,
                      first_applicable_year: taxSettings.tax_first_applicable_year,
                    }, { onConflict: "client_id" });

                    await supabase.from("allocation_plans").insert({
                      client_id: clientId,
                      effective_date: new Date().toISOString().slice(0, 10),
                      operating_pct: alloc.Operating,
                      profit_pct: alloc.Profit,
                      owners_pay_pct: alloc.OwnersPay,
                      tax_pct: alloc.Tax,
                      vault_pct: alloc.Vault,
                    });

                    alert("Settings saved.");
                  }}
                  className={`px-4 py-2 rounded-lg font-semibold text-white shadow ${!clientId ? "opacity-60 cursor-not-allowed" : ""}`}
                  style={{ backgroundColor: BRAND.blue }}
                >
                  Save Settings
                </button>

                <button
                  onClick={() => location.reload()}
                  className="px-4 py-2 rounded-lg font-semibold text-white shadow"
                  style={{ backgroundColor: BRAND.orange }}
                >
                  Recalculate
                </button>
              </div>
            </Card>
          </div>
        )}
      </div>

      {/* Drill-Down SlideOver */}
      <SlideOver open={!!drillAccount} title={`Drill-Down: ${drillAccount ?? ""} • ${drillMonth ? shortMonth(drillMonth) : ""}`} onClose={() => { setDrillAccount(null); setDrillMonth(null); setOccRows([]); }}>
        <div className="space-y-4">
          <Card title="Inflows">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-slate-500">
                  <th className="text-left py-1">Name</th>
                  <th className="text-right py-1">Amount</th>
                </tr>
              </thead>
              <tbody>
                {occRows.filter((r) => r.amount > 0).map((r, i) => (
                  <tr key={i} className="border-b last:border-0">
                    <td className="py-1">{r.name}</td>
                    <td className="py-1 text-right">{fmtCurrency(r.amount)}</td>
                  </tr>
                ))}
                {occRows.filter((r) => r.amount > 0).length === 0 && (
                  <tr><td className="py-2 text-slate-500" colSpan={2}>No inflows</td></tr>
                )}
              </tbody>
            </table>
          </Card>
          <Card title="Outflows">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-slate-500">
                  <th className="text-left py-1">Name</th>
                  <th className="text-right py-1">Amount</th>
                </tr>
              </thead>
              <tbody>
                {occRows.filter((r) => r.amount < 0).map((r, i) => (
                  <tr key={i} className="border-b last:border-0">
                    <td className="py-1">{r.name}</td>
                    <td className="py-1 text-right">{fmtCurrency(r.amount)}</td>
                  </tr>
                ))}
                {occRows.filter((r) => r.amount < 0).length === 0 && (
                  <tr><td className="py-2 text-slate-500" colSpan={2}>No outflows</td></tr>
                )}
              </tbody>
            </table>
          </Card>
        </div>
      </SlideOver>
    </main>
  );
}
