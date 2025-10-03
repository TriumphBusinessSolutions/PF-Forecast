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
import { supabase } from "../lib/supabase";

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
  new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(
    n || 0
  );

const shortMonth = (ym: string) => {
  const dt = new Date(ym + "-01");
  return dt.toLocaleDateString("en-US", { month: "short", year: "2-digit" }).replace(" ", "-");
};

const toSlug = (name: string) =>
  name.trim().toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "");

// ------------------------------
// Types
// ------------------------------
type PFAccount = {
  slug: string; // 'operating', 'owners_pay', 'truck', ...
  name: string; // 'Operating', "Owner's Pay", 'Truck'
  sort_order: number | null;
  color?: string | null;
  is_core?: boolean | null;
};

type ClientRow = { id: string; name: string };

type ActivityLong = {
  client_id: string;
  ym: string; // YYYY-MM
  pf_slug: string; // matches pf_accounts.slug
  net_amount: number;
};

type BalanceLong = {
  client_id: string;
  ym: string; // YYYY-MM
  pf_slug: string;
  ending_balance: number;
};

type OccRow = {
  client_id: string;
  month_start: string; // date
  coa_account_id: string;
  kind: string;
  name: string;
  amount: number;
};

// ------------------------------
// Tiny UI atoms
// ------------------------------
const Card: React.FC<React.PropsWithChildren<{ title?: string; className?: string }>> = ({
  title,
  className,
  children,
}) => (
  <div
    className={`rounded-2xl shadow-lg bg-white border border-slate-100 ${className || ""}`}
    style={{ background: "linear-gradient(180deg, #ffffff 0%, #f8faff 100%)" }}
  >
    {title && (
      <div
        className="px-5 py-3 rounded-t-2xl text-white font-semibold"
        style={{ backgroundColor: BRAND.blue }}
      >
        {title}
      </div>
    )}
    <div className="p-5">{children}</div>
  </div>
);

const Badge: React.FC<{ label: string; tone?: "blue" | "orange" | "slate" }> = ({
  label,
  tone = "blue",
}) => {
  const bg = tone === "orange" ? BRAND.orange : tone === "slate" ? "#e2e8f0" : BRAND.blue;
  const txt = tone === "slate" ? "#0f172a" : "#ffffff";
  return (
    <span
      className="inline-block text-xs font-semibold px-2.5 py-1 rounded-full"
      style={{ backgroundColor: bg, color: txt }}
    >
      {label}
    </span>
  );
};

const Tabs: React.FC<{
  tabs: { id: string; label: string }[];
  value: string;
  onChange: (id: string) => void;
}> = ({ tabs, value, onChange }) => (
  <div className="flex gap-2 flex-wrap">
    {tabs.map((t) => (
      <button
        key={t.id}
        onClick={() => onChange(t.id)}
        className={`px-4 py-2 rounded-full text-sm font-medium border transition shadow-sm ${
          value === t.id
            ? "bg-[var(--brand-blue)] text-white"
            : "bg-white text-slate-800 hover:bg-slate-50"
        }`}
        style={{
          borderColor: value === t.id ? BRAND.blue : "#e2e8f0",
          backgroundColor: value === t.id ? BRAND.blue : undefined,
        }}
      >
        {t.label}
      </button>
    ))}
  </div>
);

const SlideOver: React.FC<{
  open: boolean;
  title: string;
  onClose: () => void;
  children: React.ReactNode;
}> = ({ open, title, onClose, children }) => {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-40">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />
      <div className="absolute right-0 top-0 h-full w-full sm:w-[560px] bg-white shadow-2xl p-6 overflow-y-auto">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-xl font-semibold" style={{ color: BRAND.blue }}>
            {title}
          </h3>
          <button className="text-slate-600 hover:text-slate-900" onClick={onClose}>
            ✕
          </button>
        </div>
        {children}
      </div>
    </div>
  );
};

// ------------------------------
// Page Component – Dynamic PF (core + custom)
// ------------------------------
export default function Page() {
  // Clients
  const [clients, setClients] = useState<ClientRow[]>([]);
  const [clientId, setClientId] = useState<string | null>(null);

  // Tabs & chart toggle
  const [tab, setTab] = useState("dashboard");
  const [showSeries, setShowSeries] = useState<"total" | "accounts">("total");

  // Dynamic PF accounts
  const [accounts, setAccounts] = useState<PFAccount[]>([]);

  // Data
  const [months, setMonths] = useState<string[]>([]);
  const [activityLong, setActivityLong] = useState<ActivityLong[]>([]);
  const [balancesLong, setBalancesLong] = useState<BalanceLong[]>([]);

  // Allocations (% per slug)
  const [alloc, setAlloc] = useState<Record<string, number>>({}); // slug -> pct
  const [allocDate, setAllocDate] = useState<string>(() => new Date().toISOString().slice(0, 10));

  // Drill-down
  const [drillSlug, setDrillSlug] = useState<string | null>(null);
  const [drillMonth, setDrillMonth] = useState<string | null>(null);
  const [occRows, setOccRows] = useState<OccRow[]>([]);
  const [coaMap, setCoaMap] = useState<Record<string, string>>({}); // coa_account_id -> pf_slug

  // Allocation validation
  const allocTotal = useMemo(
    () => accounts.reduce((s, a) => s + (alloc[a.slug] || 0), 0),
    [accounts, alloc]
  );
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

  // -------- When client changes: load PF accounts, mapping, allocations, data --------
  useEffect(() => {
    if (!clientId) return;
    (async () => {
      // PF accounts list (core + custom)
      const { data: paf } = await supabase
        .from("pf_accounts")
        .select("slug, name, sort_order, color, is_core")
        .eq("client_id", clientId)
        .order("is_core", { ascending: false })
        .order("sort_order", { ascending: true })
        .order("name", { ascending: true });
      setAccounts((paf ?? []) as PFAccount[]);

      // COA → PF mapping
      const { data: mapRows } = await supabase
        .from("coa_to_pf_map")
        .select("coa_account_id, pf_slug")
        .eq("client_id", clientId);
      const cmap: Record<string, string> = {};
      (mapRows ?? []).forEach((r: any) => (cmap[r.coa_account_id] = r.pf_slug));
      setCoaMap(cmap);

      // Latest allocations (grab the most recent effective_date)
      const { data: latestDate } = await supabase
        .from("allocation_targets")
        .select("effective_date")
        .eq("client_id", clientId)
        .order("effective_date", { ascending: false })
        .limit(1);
      const activeDate = latestDate?.[0]?.effective_date ?? allocDate;
      setAllocDate(activeDate);

      const { data: allocRows } = await supabase
        .from("allocation_targets")
        .select("pf_slug, pct")
        .eq("client_id", clientId)
        .eq("effective_date", activeDate);
      const allocMap: Record<string, number> = {};
      (allocRows ?? []).forEach((r: any) => (allocMap[r.pf_slug] = Number(r.pct || 0)));
      setAlloc(allocMap);

      // Activity + Balances (long views)
      const { data: act } = await supabase
        .from("v_monthly_activity_long")
        .select("*")
        .eq("client_id", clientId)
        .order("ym");
      setActivityLong((act ?? []) as ActivityLong[]);

      const { data: bal } = await supabase
        .from("v_pf_balances_long")
        .select("*")
        .eq("client_id", clientId)
        .order("ym");
      setBalancesLong((bal ?? []) as BalanceLong[]);

      // Month list
      const ymList = Array.from(new Set((act ?? []).map((r: any) => r.ym)));
      setMonths(ymList);
    })();
  }, [clientId]);

  // -------- Pivots for rendering --------
  // map ym -> { slug -> net_amount }
  const actByMonth = useMemo(() => {
    const m = new Map<string, Record<string, number>>();
    activityLong.forEach((r) => {
      if (!m.has(r.ym)) m.set(r.ym, {});
      m.get(r.ym)![r.pf_slug] = Number(r.net_amount || 0);
    });
    return m;
  }, [activityLong]);

  // map ym -> { slug -> ending_balance }
  const balByMonth = useMemo(() => {
    const m = new Map<string, Record<string, number>>();
    balancesLong.forEach((r) => {
      if (!m.has(r.ym)) m.set(r.ym, {});
      m.get(r.ym)![r.pf_slug] = Number(r.ending_balance || 0);
    });
    return m;
  }, [balancesLong]);

  // Chart data (dynamic series)
  const chartData = useMemo(() => {
    return months.map((ym) => {
      const row = balByMonth.get(ym) || {};
      const series: any = { month: ym, label: shortMonth(ym) };
      let total = 0;
      accounts.forEach((a) => {
        const val = row[a.slug] || 0;
        series[a.name] = val;
        total += val;
      });
      series.Total = total;
      return series;
    });
  }, [months, balByMonth, accounts]);

  // -------- Drill-down --------
  async function openDrill(pfSlug: string, ym: string) {
    if (!clientId) return;
    setDrillSlug(pfSlug);
    setDrillMonth(ym);
    const monthStart = ym + "-01";
    const { data, error } = await supabase
      .from("v_proj_occurrences")
      .select("client_id, month_start, coa_account_id, kind, name, amount")
      .eq("client_id", clientId)
      .eq("month_start", monthStart);
    if (error) {
      console.error(error);
      setOccRows([]);
      return;
    }
    const filtered = (data ?? []).filter((d: any) => coaMap[d.coa_account_id] === pfSlug);
    setOccRows(filtered as OccRow[]);
  }

  // ------------------------------
  // UI
  // ------------------------------
  return (
    <main className="min-h-screen bg-slate-50">
      <Head>
        <link
          href="https://fonts.googleapis.com/css2?family=Rubik:wght@300;400;500;600;700;800&display=swap"
          rel="stylesheet"
        />
        <title>Cash Flow Projection – Profit First (Dynamic)</title>
      </Head>

      <style jsx global>{`
        :root {
          --brand-blue: ${BRAND.blue};
          --brand-orange: ${BRAND.orange};
        }
        html,
        body {
          font-family: "Rubik", system-ui, -apple-system, Segoe UI, Roboto, "Helvetica Neue", Arial;
        }
      `}</style>

      {/* Dark header like your screenshot */}
      <div
        className="w-full"
        style={{
          background: `linear-gradient(180deg, ${BRAND.blueDark} 0%, ${BRAND.blue} 100%)`,
        }}
      >
        <div className="max-w-[1200px] mx-auto px-4 py-5 text-white">
          <div className="flex items-center justify-between gap-4 flex-wrap">
            <h1 className="text-2xl md:text-3xl font-extrabold tracking-tight">
              Profit First Forecast
            </h1>
            <Tabs
              tabs={[
                { id: "dashboard", label: "Dashboard" },
                { id: "settings", label: "Settings" },
              ]}
              value={tab}
              onChange={setTab}
            />
          </div>

          <div className="mt-4 flex items-center gap-3">
            <select
              value={clientId ?? ""}
              onChange={(e) => setClientId(e.target.value)}
              className="px-3 py-2 rounded-lg text-slate-900"
            >
              {clients.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
            <button
              className="px-3 py-2 rounded-lg font-semibold"
              style={{ backgroundColor: BRAND.orange, color: "white" }}
              onClick={async () => {
                const name = prompt("New client name?");
                if (!name) return;
                const { data, error } = await supabase
                  .from("clients")
                  .insert({ name })
                  .select()
                  .single();
                if (error) {
                  alert("Could not add client (check RLS policies).");
                  return;
                }
                setClients((prev) => [...prev, data as ClientRow]);
                setClientId((data as any).id);

                // also seed pf_accounts core rows for this new client (nice-to-have)
                const core = [
                  { slug: "operating", name: "Operating", sort_order: 10, color: "#64748b" },
                  { slug: "profit", name: "Profit", sort_order: 20, color: "#fa9100" },
                  { slug: "owners_pay", name: "Owner's Pay", sort_order: 30, color: "#10b981" },
                  { slug: "tax", name: "Tax", sort_order: 40, color: "#ef4444" },
                  { slug: "vault", name: "Vault", sort_order: 50, color: "#8b5cf6" },
                ];
                await supabase.from("pf_accounts").insert(
                  core.map((r) => ({
                    client_id: (data as any).id,
                    ...r,
                    is_core: true,
                  }))
                );
              }}
            >
              + Add Client
            </button>
          </div>

          <p className="text-slate-200 mt-2 text-sm">
            Pick a client. Add accounts like “Truck.” Everything updates automatically.
          </p>
        </div>
      </div>

      <div className="max-w-[1200px] mx-auto px-4 py-6">
        {/* DASHBOARD */}
        {tab === "dashboard" && (
          <div className="space-y-6">
            {/* Chart */}
            <Card title="Balances Over Time">
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-2">
                  <Badge label="Triumph" />
                  <Badge
                    label={showSeries === "total" ? "Total" : "Accounts"}
                    tone="orange"
                  />
                </div>
                <div className="flex items-center gap-2">
                  <label className="inline-flex items-center gap-2 text-sm">
                    <input
                      type="radio"
                      name="series"
                      value="total"
                      checked={showSeries === "total"}
                      onChange={() => setShowSeries("total")}
                    />
                    Total Only
                  </label>
                  <label className="inline-flex items-center gap-2 text-sm">
                    <input
                      type="radio"
                      name="series"
                      value="accounts"
                      checked={showSeries === "accounts"}
                      onChange={() => setShowSeries("accounts")}
                    />
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
                        {accounts.map((a) => (
                          <Area
                            key={a.slug}
                            type="monotone"
                            dataKey={a.name}
                            stroke={a.color || "#64748b"}
                            fillOpacity={0.12}
                          />
                        ))}
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
                    <tr style={{ backgroundColor: BRAND.blue }} className="text-white sticky top-0">
                      <th className="px-3 py-2 text-left font-semibold">Account</th>
                      {months.map((m) => (
                        <th key={m} className="px-3 py-2 text-right font-semibold whitespace-nowrap">
                          {shortMonth(m)}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {accounts.map((acc) => (
                      <tr key={acc.slug} className="hover:bg-slate-50">
                        <td className="px-3 py-2 font-medium text-slate-800">{acc.name}</td>
                        {months.map((m) => {
                          const row = balByMonth.get(m) || {};
                          const val = row[acc.slug] || 0;
                          return (
                            <td
                              key={m}
                              className="px-3 py-2 text-right text-slate-700 cursor-pointer"
                              onClick={() => openDrill(acc.slug, m)}
                            >
                              {fmtCurrency(val)}
                            </td>
                          );
                        })}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <p className="text-xs text-slate-500 mt-3">
                Ending balance = Prior ending + Net activity.
              </p>
            </Card>

            {/* Monthly Activity Table */}
            <Card title="Monthly Activity (Net Movement)">
              <div className="overflow-x-auto">
                <table className="min-w-full text-sm">
                  <thead>
                    <tr style={{ backgroundColor: BRAND.blue }} className="text-white sticky top-0">
                      <th className="px-3 py-2 text-left font-semibold">Account (net)</th>
                      {months.map((m) => (
                        <th key={m} className="px-3 py-2 text-right font-semibold whitespace-nowrap">
                          {shortMonth(m)}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {accounts.map((acc) => (
                      <tr key={acc.slug} className="hover:bg-slate-50">
                        <td className="px-3 py-2 font-medium text-slate-800">{acc.name}</td>
                        {months.map((m) => {
                          const row = actByMonth.get(m) || {};
                          const val = row[acc.slug] || 0;
                          return (
                            <td
                              key={m}
                              className="px-3 py-2 text-right cursor-pointer"
                              onClick={() => openDrill(acc.slug, m)}
                            >
                              {fmtCurrency(val)}
                            </td>
                          );
                        })}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <p className="text-xs text-slate-500 mt-3">
                Each cell is that month’s net movement (not cumulative).
              </p>
            </Card>
          </div>
        )}

        {/* SETTINGS */}
        {tab === "settings" && (
          <div className="space-y-6">
            <Card title="Accounts & Allocations">
              {/* Add Account */}
              <div className="flex items-center gap-3 mb-4">
                <button
                  className="px-3 py-2 rounded-lg text-white"
                  style={{ backgroundColor: BRAND.blue }}
                  onClick={async () => {
                    if (!clientId) return;
                    const name = prompt("New PF Account name (e.g., Truck)?");
                    if (!name) return;
                    const slug = toSlug(name);
                    const color = "#8b5cf6";
                    const { error } = await supabase.from("pf_accounts").insert({
                      client_id: clientId,
                      slug,
                      name,
                      sort_order: 100,
                      is_core: false,
                      color,
                    });
                    if (error) {
                      alert("Could not add account (check RLS or unique slug).");
                      return;
                    }
                    // Reload accounts
                    const { data: paf } = await supabase
                      .from("pf_accounts")
                      .select("slug, name, sort_order, color, is_core")
                      .eq("client_id", clientId)
                      .order("is_core", { ascending: false })
                      .order("sort_order", { ascending: true })
                      .order("name", { ascending: true });
                    setAccounts((paf ?? []) as PFAccount[]);
                    // Initialize allocation to 0
                    setAlloc((prev) => ({ ...prev, [slug]: 0 }));
                  }}
                >
                  + Add Account
                </button>

                <div className="ml-auto flex items-center gap-2">
                  <label className="text-sm text-slate-700">Effective Date</label>
                  <input
                    type="date"
                    className="border rounded-lg px-3 py-2"
                    value={allocDate}
                    onChange={(e) => setAllocDate(e.target.value)}
                  />
                </div>
              </div>

              {/* Allocations grid */}
              <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 lg:grid-cols-5 gap-4">
                {accounts.map((acc) => (
                  <div key={acc.slug} className="space-y-1">
                    <label className="text-sm font-medium text-slate-700">{acc.name}</label>
                    <input
                      type="number"
                      step={0.01}
                      min={0}
                      max={1}
                      value={alloc[acc.slug] ?? 0}
                      onChange={(e) =>
                        setAlloc((prev) => ({ ...prev, [acc.slug]: Number(e.target.value) }))
                      }
                      className="w-full border rounded-lg px-3 py-2"
                    />
                  </div>
                ))}
              </div>

              <div className="mt-3 flex items-center justify-between">
                <div>
                  <Badge
                    label={`Total: ${(allocTotal * 100).toFixed(1)}%`}
                    tone={allocValid ? "blue" : "orange"}
                  />
                </div>
                {!allocValid && (
                  <span className="text-sm font-medium text-orange-600">
                    Allocations must total 100%.
                  </span>
                )}
              </div>

              <div className="flex gap-3 mt-4">
                <button
                  disabled={!clientId || !allocValid}
                  onClick={async () => {
                    if (!clientId || !allocValid) return;
                    // Upsert one row per account slug
                    await Promise.all(
                      accounts.map((a) =>
                        supabase.from("allocation_targets").upsert(
                          {
                            client_id: clientId,
                            effective_date: allocDate,
                            pf_slug: a.slug,
                            pct: alloc[a.slug] || 0,
                          },
                          { onConflict: "client_id, effective_date, pf_slug" }
                        )
                      )
                    );
                    alert("Allocations saved.");
                  }}
                  className={`px-4 py-2 rounded-lg font-semibold text-white shadow ${
                    !clientId || !allocValid ? "opacity-60 cursor-not-allowed" : ""
                  }`}
                  style={{ backgroundColor: BRAND.blue }}
                >
                  Save Allocations
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

            <Card title="COA Mapping (where activity lands)">
              <p className="text-sm text-slate-600 mb-3">
                Map your Chart of Accounts lines to PF accounts so activity flows into the right
                buckets. Add more COA → PF rows in the DB as needed.
              </p>
              <div className="text-sm text-slate-500">
                (For now, this is informational—editing UI can be added later. Current mappings are
                used in the drill-down and monthly activity.)
              </div>
            </Card>
          </div>
        )}
      </div>

      {/* Drill-Down SlideOver */}
      <SlideOver
        open={!!drillSlug}
        title={`Drill-Down: ${accounts.find((a) => a.slug === drillSlug)?.name ?? ""} • ${
          drillMonth ? shortMonth(drillMonth) : ""
        }`}
        onClose={() => {
          setDrillSlug(null);
          setDrillMonth(null);
          setOccRows([]);
        }}
      >
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
                {occRows
                  .filter((r) => r.amount > 0)
                  .map((r, i) => (
                    <tr key={i} className="border-b last:border-0">
                      <td className="py-1">{r.name}</td>
                      <td className="py-1 text-right">{fmtCurrency(r.amount)}</td>
                    </tr>
                  ))}
                {occRows.filter((r) => r.amount > 0).length === 0 && (
                  <tr>
                    <td className="py-2 text-slate-500" colSpan={2}>
                      No inflows
                    </td>
                  </tr>
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
                {occRows
                  .filter((r) => r.amount < 0)
                  .map((r, i) => (
                    <tr key={i} className="border-b last:border-0">
                      <td className="py-1">{r.name}</td>
                      <td className="py-1 text-right">{fmtCurrency(r.amount)}</td>
                    </tr>
                  ))}
                {occRows.filter((r) => r.amount < 0).length === 0 && (
                  <tr>
                    <td className="py-2 text-slate-500" colSpan={2}>
                      No outflows
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </Card>
        </div>
      </SlideOver>
    </main>
  );
}
