"use client";

import React, { useMemo, useState, useEffect, useCallback } from "react";
import Head from "next/head";
import Link from "next/link";
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

// ------------------ brand + helpers ------------------
const BRAND = { blue: "#004aad", orange: "#fa9100" };

const CORE_ACCOUNT_LAYOUT: Array<{
  slug: string;
  name: string;
  color: string;
  kind: "actual" | "derived";
}> = [
  { slug: "income", name: "Income", color: "#0284c7", kind: "actual" },
  { slug: "direct_costs_total", name: "Direct Costs Total", color: "#7c3aed", kind: "derived" },
  { slug: "real_revenue", name: "Real Revenue", color: "#16a34a", kind: "derived" },
  { slug: "profit", name: "Profit", color: "#fa9100", kind: "actual" },
  { slug: "owners_pay", name: "Owner's Pay", color: "#10b981", kind: "actual" },
  { slug: "tax", name: "Tax", color: "#ef4444", kind: "actual" },
  { slug: "operating", name: "Operating Expenses", color: "#334155", kind: "actual" },
  { slug: "vault", name: "Vault", color: "#8b5cf6", kind: "actual" },
];

const DIRECT_COST_SLUGS = ["materials", "direct_labor", "direct_costs", "cogs"];
const CUSTOM_ACCOUNT_LIMIT = 15;

const money = (n: number) =>
  new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(n || 0);

const shortYM = (ym: string) => {
  const dt = new Date(ym + "-01");
  return dt.toLocaleDateString("en-US", { month: "short", year: "2-digit" }).replace(" ", "-");
};

const toSlug = (s: string) =>
  s.trim().toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "");

// ------------------ types ------------------
type ClientRow = { id: string; name: string };
type PFAccount = { slug: string; name: string; color?: string | null; sort_order?: number | null };

type ActLong = { client_id: string; ym: string; pf_slug: string; net_amount: number };
type BalLong = { client_id: string; ym: string; pf_slug: string; ending_balance: number };

type OccRow = {
  client_id: string;
  month_start: string;
  coa_account_id: string;
  kind: string;
  name: string;
  amount: number;
};

type DisplayAccount = {
  slug: string;
  name: string;
  color: string;
  source: "core" | "derived" | "custom";
  sortOrder: number;
  configured: boolean;
};

type Period = {
  key: string;
  label: string;
  month: string;
  weekIndex?: number;
  weeksInMonth?: number;
};

type FrequencyOption = "daily" | "weekly" | "monthly" | "annual" | "custom";

type CustomProjection = {
  id: string;
  slug: string;
  period: string;
  granularity: "monthly" | "weekly";
  name: string;
  amount: number;
  direction: "inflow" | "outflow";
  frequency: FrequencyOption;
  escalation: "standard" | "custom";
  escalationValue: number;
  startDate: string;
};

// ------------------ small UI atoms ------------------
const Card: React.FC<React.PropsWithChildren<{ title?: string }>> = ({ title, children }) => (
  <div className="rounded-xl border border-slate-200 bg-white shadow-sm">
    {title && (
      <div className="px-4 py-2 text-sm font-semibold text-slate-800 border-b bg-slate-50 rounded-t-xl">
        {title}
      </div>
    )}
    <div className="p-4">{children}</div>
  </div>
);

const Button: React.FC<React.ButtonHTMLAttributes<HTMLButtonElement>> = ({ className, ...p }) => (
  <button
    {...p}
    className={
      "px-3 py-2 rounded-lg text-sm font-medium bg-white border border-slate-300 hover:bg-slate-50 " +
      (className || "")
    }
  />
);

// ------------------ page ------------------
export default function Page() {
  // clients
  const [clients, setClients] = useState<ClientRow[]>([]);
  const [clientId, setClientId] = useState<string | null>(null);

  // controls
  const [mode, setMode] = useState<"total" | "accounts">("total");
  const [granularity, setGranularity] = useState<"monthly" | "weekly">("monthly");
  const [horizon, setHorizon] = useState<number>(9);
  const [startMonth, setStartMonth] = useState<string>(() => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
  });
  const [scenarioName, setScenarioName] = useState<string>("Base Case");

  // dynamic accounts + data
  const [accounts, setAccounts] = useState<PFAccount[]>([]);
  const [months, setMonths] = useState<string[]>([]);
  const [activity, setActivity] = useState<ActLong[]>([]);
  const [balances, setBalances] = useState<BalLong[]>([]);

  // allocations (settings)
  const [alloc, setAlloc] = useState<Record<string, number>>({});
  const [allocDate, setAllocDate] = useState<string>(() => new Date().toISOString().slice(0, 10));

  // drill
  const [drill, setDrill] = useState<
    | {
        slug: string;
        period: string;
        label: string;
        granularity: "monthly" | "weekly";
        month: string;
        weekIndex?: number;
        weeksInMonth?: number;
      }
    | null
  >(null);
  const [occ, setOcc] = useState<OccRow[]>([]);
  const [coaMap, setCoaMap] = useState<Record<string, string>>({}); // coa_id -> pf_slug
  const [customProjections, setCustomProjections] = useState<CustomProjection[]>([]);

  // ------------ bootstrap clients ------------
  useEffect(() => {
    (async () => {
      const { data } = await supabase.from("clients").select("id, name").order("created_at");
      setClients(data ?? []);
      if (!clientId && data && data.length) setClientId(data[0].id);
    })();
  }, []);

  // ------------ load data for a client ------------
  useEffect(() => {
    if (!clientId) return;
    (async () => {
      // accounts
      const { data: paf } = await supabase
        .from("pf_accounts")
        .select("slug, name, color, sort_order")
        .eq("client_id", clientId)
        .order("sort_order", { ascending: true })
        .order("name", { ascending: true });
      setAccounts((paf ?? []) as PFAccount[]);

      // mapping for drill
      const { data: mapRows } = await supabase
        .from("coa_to_pf_map")
        .select("coa_account_id, pf_slug")
        .eq("client_id", clientId);
      const cmap: Record<string, string> = {};
      (mapRows ?? []).forEach((r: any) => (cmap[r.coa_account_id] = r.pf_slug));
      setCoaMap(cmap);

      // allocations – most recent
      const { data: latest } = await supabase
        .from("allocation_targets")
        .select("effective_date")
        .eq("client_id", clientId)
        .order("effective_date", { ascending: false })
        .limit(1);
      const eff = latest?.[0]?.effective_date ?? allocDate;
      setAllocDate(eff);
      const { data: arows } = await supabase
        .from("allocation_targets")
        .select("pf_slug, pct")
        .eq("client_id", clientId)
        .eq("effective_date", eff);
      const aMap: Record<string, number> = {};
      (arows ?? []).forEach((r: any) => (aMap[r.pf_slug] = Number(r.pct || 0)));
      setAlloc(aMap);

      // activity + balances (long)
      const { data: act } = await supabase
        .from("v_monthly_activity_long")
        .select("*")
        .eq("client_id", clientId)
        .order("ym");
      const { data: bal } = await supabase
        .from("v_pf_balances_long")
        .select("*")
        .eq("client_id", clientId)
        .order("ym");
      const allMonths = Array.from(new Set((act ?? []).map((r: any) => r.ym)));
      setMonths(filterMonths(allMonths, startMonth, horizon));
      setActivity((act ?? []) as ActLong[]);
      setBalances((bal ?? []) as BalLong[]);
    })();
  }, [clientId]);

  // re-filter months when controls change
  useEffect(() => {
    const all = Array.from(new Set(activity.map((r) => r.ym)));
    setMonths(filterMonths(all, startMonth, horizon));
  }, [startMonth, horizon, activity]);

  useEffect(() => {
    if (granularity === "weekly" && horizon !== 13) {
      setHorizon(13);
    }
    if (granularity === "monthly" && horizon === 13) {
      setHorizon(9);
    }
  }, [granularity, horizon]);

  // ------------ pivots ------------
  const actByMonth = useMemo(() => {
    const m = new Map<string, Record<string, number>>();
    activity.forEach((r) => {
      if (!m.has(r.ym)) m.set(r.ym, {});
      m.get(r.ym)![r.pf_slug] = Number(r.net_amount || 0);
    });
    return m;
  }, [activity]);

  const balByMonth = useMemo(() => {
    const m = new Map<string, Record<string, number>>();
    balances.forEach((r) => {
      if (!m.has(r.ym)) m.set(r.ym, {});
      m.get(r.ym)![r.pf_slug] = Number(r.ending_balance || 0);
    });
    return m;
  }, [balances]);

  const sumDirectCostsBalance = useCallback(
    (ym: string) =>
      DIRECT_COST_SLUGS.reduce((sum, slug) => sum + (balByMonth.get(ym)?.[slug] || 0), 0),
    [balByMonth]
  );

  const sumDirectCostsActivity = useCallback(
    (ym: string) =>
      DIRECT_COST_SLUGS.reduce((sum, slug) => sum + (actByMonth.get(ym)?.[slug] || 0), 0),
    [actByMonth]
  );

  const monthlyBalanceForSlug = useCallback(
    (ym: string, slug: string): number => {
      if (!ym) return 0;
      if (slug === "direct_costs_total") {
        return sumDirectCostsBalance(ym);
      }
      if (slug === "real_revenue") {
        const income = monthlyBalanceForSlug(ym, "income");
        const direct = monthlyBalanceForSlug(ym, "direct_costs_total");
        return income - direct;
      }
      return balByMonth.get(ym)?.[slug] || 0;
    },
    [balByMonth, sumDirectCostsBalance]
  );

  const monthlyActivityForSlug = useCallback(
    (ym: string, slug: string): number => {
      if (!ym) return 0;
      if (slug === "direct_costs_total") {
        return sumDirectCostsActivity(ym);
      }
      if (slug === "real_revenue") {
        const income = monthlyActivityForSlug(ym, "income");
        const direct = monthlyActivityForSlug(ym, "direct_costs_total");
        return income - direct;
      }
      return actByMonth.get(ym)?.[slug] || 0;
    },
    [actByMonth, sumDirectCostsActivity]
  );

  const pfAccountMap = useMemo(() => {
    const map = new Map<string, PFAccount>();
    accounts.forEach((acc) => map.set(acc.slug, acc));
    return map;
  }, [accounts]);

  const mainAccounts = useMemo<DisplayAccount[]>(() => {
    return CORE_ACCOUNT_LAYOUT.map((core, idx) => {
      const actual = pfAccountMap.get(core.slug);
      return {
        slug: core.slug,
        name: actual?.name ?? core.name,
        color: actual?.color ?? core.color,
        source: core.kind === "derived" ? "derived" : "core",
        sortOrder: idx,
        configured: core.kind === "derived" ? true : Boolean(actual),
      } satisfies DisplayAccount;
    });
  }, [pfAccountMap]);

  const customAccounts = useMemo<DisplayAccount[]>(() => {
    return accounts
      .filter((acc) => !CORE_ACCOUNT_LAYOUT.some((core) => core.slug === acc.slug))
      .map((acc, idx) => ({
        slug: acc.slug,
        name: acc.name,
        color: acc.color || "#64748b",
        source: "custom" as const,
        sortOrder: 100 + idx,
        configured: true,
      }));
  }, [accounts]);

  const displayAccounts = useMemo<DisplayAccount[]>(() => {
    return [...mainAccounts, ...customAccounts].sort((a, b) => a.sortOrder - b.sortOrder);
  }, [mainAccounts, customAccounts]);

  const allocationAccounts = useMemo(() => displayAccounts.filter((acc) => acc.source !== "derived"), [displayAccounts]);

  const periods = useMemo<Period[]>(() => {
    if (granularity === "monthly") {
      return months.map((ym) => ({ key: ym, month: ym, label: shortYM(ym) }));
    }
    return buildWeeklyPeriods(startMonth, horizon);
  }, [granularity, months, startMonth, horizon]);

  const chartData = useMemo(() => {
    return periods.map((period) => {
      const ym = period.month;
      const d: Record<string, any> = { period: period.key, label: period.label };
      let total = 0;
      displayAccounts.forEach((acc) => {
        const ending = monthlyBalanceForSlug(ym, acc.slug);
        const net = monthlyActivityForSlug(ym, acc.slug);
        const value =
          granularity === "weekly" && period.weekIndex !== undefined && period.weeksInMonth
            ? estimateWeeklyBalance(ending, net, period.weekIndex, period.weeksInMonth)
            : ending;
        d[acc.name] = value;
        total += value;
      });
      d.Total = total;
      return d;
    });
  }, [periods, displayAccounts, monthlyBalanceForSlug, monthlyActivityForSlug, granularity]);

  // ------------ drill ------------
  function openDrill(slug: string, period: Period) {
    if (!clientId) return;
    setDrill({
      slug,
      period: period.key,
      label: period.label,
      granularity,
      month: period.month,
      weekIndex: period.weekIndex,
      weeksInMonth: period.weeksInMonth,
    });
  }

  useEffect(() => {
    if (!drill || !clientId) return;
    (async () => {
      const { data } = await supabase
        .from("v_proj_occurrences")
        .select("client_id, month_start, coa_account_id, kind, name, amount")
        .eq("client_id", clientId)
        .eq("month_start", drill.month + "-01");
      const filtered = (data ?? []).filter((r: any) => coaMap[r.coa_account_id] === drill.slug);
      setOcc(filtered as OccRow[]);
    })();
  }, [drill, clientId, coaMap]);

  // ------------ render ------------
  const allocTotal = allocationAccounts.reduce((s, a) => s + (alloc[a.slug] || 0), 0);
  const allocOk = Math.abs(allocTotal - 1) < 0.0001;
  const drillAccount = drill ? displayAccounts.find((a) => a.slug === drill.slug) : null;
  const activeClient = clients.find((c) => c.id === clientId);
  const horizonChoices = granularity === "weekly" ? [13] : [9, 12, 18, 24];
  const currentPeriod = periods[0];
  const finalPeriod = periods[periods.length - 1];
  const describePeriodValue = (period?: Period) => {
    if (!period) return 0;
    return displayAccounts.reduce((sum, acc) => {
      const ending = monthlyBalanceForSlug(period.month, acc.slug);
      const net = monthlyActivityForSlug(period.month, acc.slug);
      const value =
        granularity === "weekly" && period.weekIndex !== undefined && period.weeksInMonth
          ? estimateWeeklyBalance(ending, net, period.weekIndex, period.weeksInMonth)
          : ending;
      return sum + value;
    }, 0);
  };
  const currentTotalBalance = describePeriodValue(currentPeriod);
  const endingTotalBalance = describePeriodValue(finalPeriod);
  const projectedChange = endingTotalBalance - currentTotalBalance;
  const realRevenueProjection = periods.reduce((sum, period) => {
    const net = monthlyActivityForSlug(period.month, "real_revenue");
    if (granularity === "weekly" && period.weekIndex !== undefined && period.weeksInMonth) {
      return sum + net / (period.weeksInMonth || 1);
    }
    return sum + net;
  }, 0);
  const directCostProjection = periods.reduce((sum, period) => {
    const cost = monthlyActivityForSlug(period.month, "direct_costs_total");
    if (granularity === "weekly" && period.weekIndex !== undefined && period.weeksInMonth) {
      return sum + cost / (period.weeksInMonth || 1);
    }
    return sum + cost;
  }, 0);
  const getAccountColor = useCallback(
    (slug: string) => displayAccounts.find((a) => a.slug === slug)?.color || "#64748b",
    [displayAccounts]
  );
  const profitTargetPct = (alloc["profit"] ?? 0) * 100;
  const taxTargetPct = (alloc["tax"] ?? 0) * 100;
  const ownersPayTargetPct = (alloc["owners_pay"] ?? 0) * 100;
  const operatingTargetPct = (alloc["operating"] ?? 0) * 100;
  const vaultTargetPct = (alloc["vault"] ?? 0) * 100;
  const averageRealRevenue = periods.length ? realRevenueProjection / periods.length : 0;
  const averageDirectCosts = periods.length ? directCostProjection / periods.length : 0;
  const netRealRevenueAvg = averageRealRevenue - averageDirectCosts;
  const averageNetChange = periods.length ? projectedChange / periods.length : 0;
  const timelineLabel = granularity === "weekly" ? "Weekly" : "Monthly";
  const periodCountLabel = periods.length
    ? `${periods.length} ${timelineLabel.toLowerCase()}${periods.length === 1 ? "" : "s"}`
    : "No periods";
  const periodRangeLabel =
    currentPeriod && finalPeriod ? `${currentPeriod.label} – ${finalPeriod.label}` : "Forecast unavailable";

  return (
    <main className="min-h-screen bg-slate-100">
      <Head>
        <title>Profit First Forecast</title>
        <link
          href="https://fonts.googleapis.com/css2?family=Rubik:wght@300;400;500;600;700;800&display=swap"
          rel="stylesheet"
        />
      </Head>
      <style jsx global>{`
        html, body { font-family: Rubik, system-ui, -apple-system, Segoe UI, Roboto, Arial; }
      `}</style>

      <div className="flex min-h-screen flex-col">
        <header className="border-b border-slate-200 bg-white/90 backdrop-blur">
          <div className="mx-auto flex w-full max-w-7xl flex-wrap items-center gap-4 px-6 py-4">
            <div className="flex flex-1 flex-wrap items-end gap-6">
              <div>
                <p className="text-xs uppercase tracking-wide text-slate-500">Scenario</p>
                <input
                  value={scenarioName}
                  onChange={(e) => setScenarioName(e.target.value)}
                  className="mt-1 w-full min-w-[200px] rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-900 shadow-sm focus:border-blue-500 focus:outline-none"
                />
              </div>
              <div>
                <p className="text-xs uppercase tracking-wide text-slate-500">Client</p>
                <div className="mt-1 flex items-center gap-2">
                  <select
                    value={clientId ?? ""}
                    onChange={(e) => setClientId(e.target.value)}
                    className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-700 shadow-sm focus:border-blue-500 focus:outline-none"
                  >
                    {clients.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name}
                      </option>
                    ))}
                  </select>
                  <Button
                    onClick={async () => {
                      const name = prompt("New client name?");
                      if (!name) return;
                      const { data, error } = await supabase.from("clients").insert({ name }).select().single();
                      if (error) return alert("Could not add client. Check policies.");
                      setClients((p) => [...p, data as ClientRow]);
                      setClientId((data as any).id);
                      const core = [
                        { slug: "income", name: "Income", sort_order: 1, color: "#0284c7" },
                        { slug: "operating", name: "Operating", sort_order: 10, color: "#64748b" },
                        { slug: "profit", name: "Profit", sort_order: 20, color: "#fa9100" },
                        { slug: "owners_pay", name: "Owner's Pay", sort_order: 30, color: "#10b981" },
                        { slug: "tax", name: "Tax", sort_order: 40, color: "#ef4444" },
                        { slug: "vault", name: "Vault", sort_order: 50, color: "#8b5cf6" },
                      ];
                      await supabase
                        .from("pf_accounts")
                        .insert(core.map((r) => ({ client_id: (data as any).id, ...r })));
                    }}
                  >
                    + Client
                  </Button>
                </div>
              </div>
              <div>
                <p className="text-xs uppercase tracking-wide text-slate-500">Starting period</p>
                <input
                  type="month"
                  value={startMonth}
                  onChange={(e) => setStartMonth(e.target.value)}
                  className="mt-1 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-700 shadow-sm focus:border-blue-500 focus:outline-none"
                />
              </div>
              <div>
                <p className="text-xs uppercase tracking-wide text-slate-500">View</p>
                <div className="mt-1 flex overflow-hidden rounded-lg border border-slate-200 bg-slate-50">
                  <button
                    onClick={() => setGranularity("monthly")}
                    className={`px-3 py-2 text-sm font-medium transition ${
                      granularity === "monthly"
                        ? "bg-white text-blue-600 shadow-inner"
                        : "text-slate-500 hover:text-slate-700"
                    }`}
                  >
                    Monthly
                  </button>
                  <button
                    onClick={() => setGranularity("weekly")}
                    className={`px-3 py-2 text-sm font-medium transition ${
                      granularity === "weekly"
                        ? "bg-white text-blue-600 shadow-inner"
                        : "text-slate-500 hover:text-slate-700"
                    }`}
                  >
                    13-week
                  </button>
                </div>
              </div>
              <div>
                <p className="text-xs uppercase tracking-wide text-slate-500">Horizon</p>
                <select
                  value={String(horizon)}
                  onChange={(e) => setHorizon(Number(e.target.value))}
                  className="mt-1 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-700 shadow-sm focus:border-blue-500 focus:outline-none"
                >
                  {horizonChoices.map((choice) => (
                    <option key={choice} value={choice}>
                      {choice} {granularity === "weekly" ? "weeks" : "months"}
                    </option>
                  ))}
                </select>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <Link
                href="/settings"
                className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-700 shadow-sm transition hover:border-blue-400 hover:text-blue-600"
              >
                Settings
              </Link>
            </div>
          </div>
        </header>

        <div className="flex flex-1 flex-col">
          <div className="mx-auto flex w-full max-w-7xl flex-1 flex-col gap-6 px-6 py-6 xl:flex-row">
            <aside className="w-full space-y-6 xl:max-w-sm">
              <Card>
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <p className="text-xs uppercase tracking-wide text-slate-500">{timelineLabel} outlook</p>
                    <h2 className="mt-2 text-3xl font-semibold text-slate-900">{money(currentTotalBalance)}</h2>
                    <p className="mt-2 text-sm text-slate-500">
                      Current balance across Profit First accounts for {activeClient?.name ?? "your client"}.
                    </p>
                  </div>
                  <span
                    className={`rounded-full px-3 py-1 text-xs font-semibold ${
                      projectedChange >= 0 ? "bg-emerald-50 text-emerald-600" : "bg-rose-50 text-rose-600"
                    }`}
                  >
                    {projectedChange >= 0 ? "+" : ""}
                    {money(projectedChange)}
                  </span>
                </div>
                <dl className="mt-6 space-y-4 text-sm">
                  <div className="flex items-center justify-between">
                    <dt className="text-slate-500">Forecast window</dt>
                    <dd className="font-semibold text-slate-700">{periodRangeLabel}</dd>
                  </div>
                  <div className="flex items-center justify-between">
                    <dt className="text-slate-500">Periods</dt>
                    <dd className="font-semibold text-slate-700">{periodCountLabel}</dd>
                  </div>
                  <div className="flex items-center justify-between">
                    <dt className="text-slate-500">Net change</dt>
                    <dd className={`font-semibold ${projectedChange >= 0 ? "text-emerald-600" : "text-rose-600"}`}>
                      {projectedChange >= 0 ? "+" : ""}
                      {money(projectedChange)}
                    </dd>
                  </div>
                  <div className="flex items-center justify-between">
                    <dt className="text-slate-500">Average net</dt>
                    <dd className="font-semibold text-slate-700">{money(averageNetChange)}</dd>
                  </div>
                </dl>
              </Card>

              <Card>
                <h3 className="text-sm font-semibold text-slate-700">Revenue &amp; costs</h3>
                <dl className="mt-4 space-y-3 text-sm">
                  <div className="flex items-center justify-between">
                    <dt className="text-slate-500">Avg real revenue</dt>
                    <dd className="font-semibold text-slate-800">{money(averageRealRevenue)}</dd>
                  </div>
                  <div className="flex items-center justify-between">
                    <dt className="text-slate-500">Avg direct costs</dt>
                    <dd className="font-semibold text-slate-800">{money(averageDirectCosts)}</dd>
                  </div>
                  <div className="flex items-center justify-between">
                    <dt className="text-slate-500">Avg net revenue</dt>
                    <dd className={`font-semibold ${netRealRevenueAvg >= 0 ? "text-emerald-600" : "text-rose-600"}`}>
                      {money(netRealRevenueAvg)}
                    </dd>
                  </div>
                </dl>
                <p className="mt-4 text-xs text-slate-500">
                  Real revenue subtracts direct costs (materials and direct labor) from income to follow Profit First guidance.
                </p>
              </Card>

              <Card>
                <div className="flex items-center justify-between">
                  <h3 className="text-sm font-semibold text-slate-700">Allocation targets</h3>
                  <Link href="/settings" className="text-xs font-semibold text-blue-600 hover:underline">
                    Edit
                  </Link>
                </div>
                <ul className="mt-4 space-y-3 text-sm">
                  {[
                    { slug: "profit", label: "Profit", value: profitTargetPct },
                    { slug: "owners_pay", label: "Owner's Pay", value: ownersPayTargetPct },
                    { slug: "tax", label: "Tax", value: taxTargetPct },
                    { slug: "operating", label: "Operating Expenses", value: operatingTargetPct },
                    { slug: "vault", label: "Vault", value: vaultTargetPct },
                  ].map((row) => (
                    <li key={row.slug} className="flex items-center justify-between gap-3">
                      <div className="flex items-center gap-2">
                        <span
                          className="inline-block h-2.5 w-2.5 rounded-full"
                          style={{ backgroundColor: getAccountColor(row.slug) }}
                        />
                        <span className="text-slate-600">{row.label}</span>
                      </div>
                      <div className="flex items-center gap-2">
                        <div className="h-2 w-24 overflow-hidden rounded-full bg-slate-200">
                          <div
                            className="h-full rounded-full"
                            style={{
                              width: `${Math.min(row.value, 100)}%`,
                              backgroundColor: getAccountColor(row.slug),
                            }}
                          />
                        </div>
                        <span className="font-semibold text-slate-800">{row.value.toFixed(1)}%</span>
                      </div>
                    </li>
                  ))}
                </ul>
                <p className="mt-4 text-xs text-slate-500">
                  Targets update from the latest allocation saved in your Supabase workspace.
                </p>
              </Card>
            </aside>

            <section className="flex-1 space-y-6">
              <Card>
                <div className="flex flex-wrap items-start justify-between gap-4">
                  <div>
                    <p className="text-xs uppercase tracking-wide text-slate-500">{timelineLabel} cash flow</p>
                    <h2 className="mt-1 text-2xl font-semibold text-slate-900">
                      {activeClient?.name ?? "Client"} forecast
                    </h2>
                    <p className="mt-2 text-sm text-slate-500">
                      {periodRangeLabel}. Toggle totals or individual accounts to explore the projection.
                    </p>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <div className="flex overflow-hidden rounded-lg border border-slate-200 bg-slate-50">
                      <button
                        onClick={() => setMode("total")}
                        className={`px-3 py-2 text-sm font-medium transition ${
                          mode === "total"
                            ? "bg-white text-blue-600 shadow-inner"
                            : "text-slate-500 hover:text-slate-700"
                        }`}
                      >
                        Totals
                      </button>
                      <button
                        onClick={() => setMode("accounts")}
                        className={`px-3 py-2 text-sm font-medium transition ${
                          mode === "accounts"
                            ? "bg-white text-blue-600 shadow-inner"
                            : "text-slate-500 hover:text-slate-700"
                        }`}
                      >
                        Accounts
                      </button>
                    </div>
                  </div>
                </div>
                <div className="mt-6 h-[360px] w-full">
                  <ResponsiveContainer width="100%" height="100%">
                    <AreaChart data={chartData} margin={{ top: 10, right: 20, left: 0, bottom: 0 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                      <XAxis dataKey="label" stroke="#475569" fontSize={12} />
                      <YAxis
                        stroke="#475569"
                        fontSize={12}
                        tickFormatter={(value) => `$${(value / 1000).toFixed(0)}k`}
                      />
                      <Tooltip formatter={(value: number) => money(value)} />
                      <Legend />
                      {mode === "total" ? (
                        <Area
                          type="monotone"
                          dataKey="Total"
                          stroke={BRAND.blue}
                          fillOpacity={0.15}
                          fill={BRAND.blue}
                        />
                      ) : (
                        displayAccounts.map((a) => (
                          <Area
                            key={a.slug}
                            type="monotone"
                            dataKey={a.name}
                            stroke={a.color || "#64748b"}
                            fillOpacity={0.1}
                            fill={a.color || "#64748b"}
                          />
                        ))
                      )}
                    </AreaChart>
                  </ResponsiveContainer>
                </div>
                <p className="mt-4 text-xs text-slate-500">
                  Chart values display projected ending balances. Switch to weekly mode to view 13-week allocations.
                </p>
              </Card>

              <Card title={`Ending balances (${granularity === "weekly" ? "weekly roll-forward" : "month end"})`}>
                <p className="mb-3 text-xs text-slate-500">
                  Click any value to open the detailed account drill-down.
                </p>
                <div className="overflow-x-auto">
                  <table className="min-w-full table-fixed text-sm">
                    <thead>
                      <tr className="bg-slate-50">
                        <th className="sticky left-0 z-10 bg-slate-50 px-3 py-2 text-left font-semibold">Account</th>
                        {periods.map((period) => (
                          <th key={period.key} className="px-3 py-2 text-right font-semibold whitespace-nowrap">
                            {period.label}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {displayAccounts.map((acc) => (
                        <tr key={acc.slug} className="border-b border-slate-100 last:border-0 hover:bg-slate-50">
                          <td className="sticky left-0 z-10 bg-white px-3 py-2 font-medium text-slate-800">
                            <div className="flex items-center gap-2">
                              <span className="inline-block h-2 w-2 rounded-full" style={{ backgroundColor: acc.color }} />
                              <span>{acc.name}</span>
                              {!acc.configured && (
                                <span className="ml-2 rounded-full bg-orange-100 px-2 py-0.5 text-xs text-orange-700">
                                  Not linked
                                </span>
                              )}
                            </div>
                          </td>
                          {periods.map((period) => {
                            const ending = monthlyBalanceForSlug(period.month, acc.slug);
                            const net = monthlyActivityForSlug(period.month, acc.slug);
                            const value =
                              granularity === "weekly" && period.weekIndex !== undefined && period.weeksInMonth
                                ? estimateWeeklyBalance(ending, net, period.weekIndex, period.weeksInMonth)
                                : ending;
                            return (
                              <td
                                key={period.key}
                                className="px-3 py-2 text-right font-medium text-slate-700 transition hover:bg-blue-50 hover:text-blue-600"
                                onClick={() => openDrill(acc.slug, period)}
                              >
                                {money(value)}
                              </td>
                            );
                          })}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </Card>

              <Card title={`${granularity === "weekly" ? "Weekly" : "Monthly"} net activity`}>
                <p className="mb-3 text-xs text-slate-500">
                  Net activity shows inflows minus outflows for each account. Ending balance equals beginning balance plus net activity.
                </p>
                <div className="overflow-x-auto">
                  <table className="min-w-full table-fixed text-sm">
                    <thead>
                      <tr className="bg-slate-50">
                        <th className="sticky left-0 z-10 bg-slate-50 px-3 py-2 text-left font-semibold">Account</th>
                        {periods.map((period) => (
                          <th key={period.key} className="px-3 py-2 text-right font-semibold whitespace-nowrap">
                            {period.label}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {displayAccounts.map((acc) => (
                        <tr key={acc.slug} className="border-b border-slate-100 last:border-0 hover:bg-slate-50">
                          <td className="sticky left-0 z-10 bg-white px-3 py-2 font-medium text-slate-800">{acc.name}</td>
                          {periods.map((period) => {
                            const net = monthlyActivityForSlug(period.month, acc.slug);
                            const value =
                              granularity === "weekly" && period.weekIndex !== undefined && period.weeksInMonth
                                ? net / (period.weeksInMonth || 1)
                                : net;
                            return (
                              <td
                                key={period.key}
                                className="px-3 py-2 text-right font-medium text-slate-700 transition hover:bg-blue-50 hover:text-blue-600"
                                onClick={() => openDrill(acc.slug, period)}
                              >
                                {money(value)}
                              </td>
                            );
                          })}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </Card>
            </section>
          </div>
        </div>
      </div>
      {/* drill panel */}
      {drill && (
        <div className="fixed inset-0 z-40 flex items-center justify-center px-4 py-6">
          <div className="absolute inset-0 bg-slate-900/50" onClick={() => setDrill(null)} />
          <div className="relative z-10 w-full max-w-6xl overflow-hidden rounded-2xl bg-white shadow-2xl">
            <div className="flex flex-wrap items-start justify-between gap-4 border-b border-slate-200 px-6 py-4">
              <div>
                <p className="text-xs uppercase tracking-wide text-slate-500">Account detail</p>
                <h3 className="text-xl font-semibold text-slate-800">
                  {drillAccount?.name ?? drill.slug} •
                  {" "}
                  {drill.granularity === "weekly" ? `Week of ${drill.label}` : drill.label}
                </h3>
                {!drillAccount?.configured && (
                  <p className="mt-1 text-sm text-orange-600">
                    This account is not yet linked to ledger activity. Configure it in settings to unlock
                    allocations.
                  </p>
                )}
              </div>
              <button
                className="rounded-full border border-slate-200 px-3 py-1 text-sm text-slate-600 hover:bg-slate-100"
                onClick={() => setDrill(null)}
              >
                Close
              </button>
            </div>
            <div className="max-h-[80vh] overflow-y-auto px-6 py-6">
              <AccountDetailPanel
                account={
                  drillAccount || {
                    slug: drill.slug,
                    name: drill.slug,
                    color: "#64748b",
                    source: "custom",
                    sortOrder: 999,
                    configured: true,
                  }
                }
                drill={drill}
                occ={occ}
                customProjections={customProjections}
                setCustomProjections={setCustomProjections}
                monthlyBalanceForSlug={monthlyBalanceForSlug}
                monthlyActivityForSlug={monthlyActivityForSlug}
              />
            </div>
          </div>
        </div>
      )}
    </main>
  );
}

// -------- helper components / functions --------
function buildWeeklyPeriods(startYM: string, count: number): Period[] {
  const [y, m] = startYM.split("-").map(Number);
  const base = new Date(y, (m ?? 1) - 1, 1);
  const firstWeekStart = startOfWeek(base);
  const periods: Period[] = [];
  for (let i = 0; i < count; i++) {
    const d = new Date(firstWeekStart);
    d.setDate(firstWeekStart.getDate() + i * 7);
    const month = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
    const weekIndex = periods.filter((p) => p.month === month).length;
    const weeksInMonth = countWeeksInMonth(d.getFullYear(), d.getMonth());
    periods.push({
      key: d.toISOString().slice(0, 10),
      label: shortWeek(d),
      month,
      weekIndex,
      weeksInMonth,
    });
  }
  return periods;
}

function startOfWeek(date: Date) {
  const d = new Date(date);
  const day = d.getDay();
  const diff = (day + 6) % 7; // Monday as first day
  d.setDate(d.getDate() - diff);
  d.setHours(0, 0, 0, 0);
  return d;
}

function countWeeksInMonth(year: number, monthIndex: number) {
  const first = startOfWeek(new Date(year, monthIndex, 1));
  const last = startOfWeek(new Date(year, monthIndex + 1, 0));
  const diff = Math.round((last.getTime() - first.getTime()) / (7 * 24 * 60 * 60 * 1000));
  return diff + 1;
}

function shortWeek(date: Date) {
  return date.toLocaleDateString("en-US", { month: "2-digit", day: "2-digit" });
}

function estimateWeeklyBalance(ending: number, net: number, weekIndex: number, weeksInMonth: number) {
  const safeWeeks = weeksInMonth || 4;
  const beginning = ending - net;
  const steps = Math.min(Math.max(weekIndex + 1, 0), safeWeeks);
  const progress = steps / safeWeeks;
  return beginning + progress * net;
}

function filterMonths(all: string[], startYM: string, horizon: number) {
  const [y, m] = startYM.split("-").map(Number);
  const start = new Date(y, m - 1, 1);
  const list = all
    .map((ym) => new Date(ym + "-01"))
    .filter((d) => d >= start)
    .sort((a, b) => a.getTime() - b.getTime())
    .slice(0, horizon);
  return list.map((d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`);
}

function AccountDetailPanel({
  account,
  drill,
  occ,
  customProjections,
  setCustomProjections,
  monthlyBalanceForSlug,
  monthlyActivityForSlug,
}: {
  account: DisplayAccount;
  drill: {
    slug: string;
    period: string;
    label: string;
    granularity: "monthly" | "weekly";
    month: string;
    weekIndex?: number;
    weeksInMonth?: number;
  };
  occ: OccRow[];
  customProjections: CustomProjection[];
  setCustomProjections: React.Dispatch<React.SetStateAction<CustomProjection[]>>;
  monthlyBalanceForSlug: (ym: string, slug: string) => number;
  monthlyActivityForSlug: (ym: string, slug: string) => number;
}) {
  const [newItem, setNewItem] = useState<{
    name: string;
    amount: number;
    direction: "inflow" | "outflow";
    frequency: FrequencyOption;
    escalation: "standard" | "custom";
    escalationValue: number;
    startDate: string;
  }>(() => ({
    name: "",
    amount: 0,
    direction: "outflow",
    frequency: "monthly",
    escalation: "standard",
    escalationValue: 0,
    startDate: drill.granularity === "monthly" ? `${drill.month}-01` : drill.period,
  }));

  useEffect(() => {
    setNewItem((prev) => ({
      ...prev,
      startDate: drill.granularity === "monthly" ? `${drill.month}-01` : drill.period,
    }));
  }, [drill]);

  const isWeekly = drill.granularity === "weekly";
  const weeks = drill.weeksInMonth ?? 4;
  const baseEnding = monthlyBalanceForSlug(drill.month, account.slug);
  const baseNet = monthlyActivityForSlug(drill.month, account.slug);
  const beginning = isWeekly
    ? estimateWeeklyBalance(baseEnding, baseNet, (drill.weekIndex ?? 0) - 1, weeks)
    : baseEnding - baseNet;
  const endingBase = isWeekly
    ? estimateWeeklyBalance(baseEnding, baseNet, drill.weekIndex ?? 0, weeks)
    : baseEnding;
  const netBase = endingBase - beginning;
  const scale = isWeekly && weeks ? 1 / weeks : 1;

  const inflowRowsSystem = occ
    .filter((r) => r.amount > 0)
    .map((r, idx) => ({
      id: `sys-in-${idx}`,
      name: r.name,
      amount: r.amount * scale,
      source: "system" as const,
      frequency: r.kind as FrequencyOption | undefined,
    }));

  const outflowRowsSystem = occ
    .filter((r) => r.amount < 0)
    .map((r, idx) => ({
      id: `sys-out-${idx}`,
      name: r.name,
      amount: Math.abs(r.amount * scale),
      source: "system" as const,
      frequency: r.kind as FrequencyOption | undefined,
    }));

  const customForPeriod = customProjections.filter(
    (item) =>
      item.slug === account.slug &&
      item.period === drill.period &&
      item.granularity === drill.granularity
  );

  const inflowRowsCustom = customForPeriod
    .filter((item) => item.direction === "inflow")
    .map((item) => ({
      id: item.id,
      name: item.name,
      amount: item.amount,
      source: "custom" as const,
      frequency: item.frequency,
      escalation: item.escalation,
    }));

  const outflowRowsCustom = customForPeriod
    .filter((item) => item.direction === "outflow")
    .map((item) => ({
      id: item.id,
      name: item.name,
      amount: item.amount,
      source: "custom" as const,
      frequency: item.frequency,
      escalation: item.escalation,
    }));

  const inflowRows = [...inflowRowsSystem, ...inflowRowsCustom];
  const outflowRows = [...outflowRowsSystem, ...outflowRowsCustom];

  const totalInflows = inflowRows.reduce((sum, row) => sum + row.amount, 0);
  const totalOutflows = outflowRows.reduce((sum, row) => sum + row.amount, 0);
  const netAfterCustom = totalInflows - totalOutflows;
  const endingAfterCustom = beginning + netAfterCustom;
  const customDelta = netAfterCustom - netBase;

  const formatFrequency = (freq?: FrequencyOption) => {
    if (!freq) return isWeekly ? "Weekly estimate" : "Projection";
    switch (freq) {
      case "daily":
        return "Daily";
      case "weekly":
        return "Weekly";
      case "monthly":
        return "Monthly";
      case "annual":
        return "Annual";
      case "custom":
      default:
        return "Custom";
    }
  };

  const handleAddCustom = () => {
    if (!newItem.name.trim()) {
      alert("Please name the custom flow.");
      return;
    }
    if (!newItem.amount || Number.isNaN(newItem.amount)) {
      alert("Amount must be greater than zero.");
      return;
    }
    const id = typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `custom-${Date.now()}`;
    const entry: CustomProjection = {
      id,
      slug: account.slug,
      period: drill.period,
      granularity: drill.granularity,
      name: newItem.name,
      amount: Math.abs(newItem.amount),
      direction: newItem.direction,
      frequency: newItem.frequency,
      escalation: newItem.escalation,
      escalationValue: newItem.escalation === "custom" ? newItem.escalationValue : 0,
      startDate: newItem.startDate,
    };
    setCustomProjections((prev) => [...prev, entry]);
    setNewItem({
      name: "",
      amount: 0,
      direction: "outflow",
      frequency: "monthly",
      escalation: "standard",
      escalationValue: 0,
      startDate: drill.granularity === "monthly" ? `${drill.month}-01` : drill.period,
    });
  };

  const handleRemoveCustom = (id: string) => {
    setCustomProjections((prev) => prev.filter((item) => item.id !== id));
  };

  const weeklyNote =
    isWeekly &&
    "Weekly values are spread evenly across the month. Adjust custom flows to fine-tune the projection.";

  return (
    <div className="space-y-8">
      <div className="grid grid-cols-1 gap-4 md:grid-cols-4">
        <div className="rounded-2xl border border-slate-200 bg-slate-50/70 p-4">
          <p className="text-xs uppercase tracking-wide text-slate-500">Beginning balance</p>
          <p className="mt-1 text-lg font-semibold text-slate-800">{money(beginning)}</p>
        </div>
        <div className="rounded-2xl border border-slate-200 bg-emerald-50/60 p-4">
          <p className="text-xs uppercase tracking-wide text-emerald-600">Total inflows</p>
          <p className="mt-1 text-lg font-semibold text-emerald-700">{money(totalInflows)}</p>
        </div>
        <div className="rounded-2xl border border-slate-200 bg-rose-50/60 p-4">
          <p className="text-xs uppercase tracking-wide text-rose-600">Total outflows</p>
          <p className="mt-1 text-lg font-semibold text-rose-600">{money(totalOutflows)}</p>
        </div>
        <div className="rounded-2xl border border-slate-200 bg-slate-50/70 p-4">
          <p className="text-xs uppercase tracking-wide text-slate-500">Ending balance</p>
          <p className="mt-1 text-lg font-semibold text-slate-800">{money(endingAfterCustom)}</p>
        </div>
      </div>

      <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
        <h4 className="text-sm font-semibold text-slate-700">Net activity</h4>
        <dl className="mt-3 grid grid-cols-1 gap-3 md:grid-cols-3">
          <div className="rounded-xl bg-slate-50 px-3 py-2">
            <dt className="text-xs uppercase tracking-wide text-slate-500">Base projection</dt>
            <dd className="text-sm font-semibold text-slate-800">{money(netBase)}</dd>
          </div>
          <div className="rounded-xl bg-slate-50 px-3 py-2">
            <dt className="text-xs uppercase tracking-wide text-slate-500">Custom adjustments</dt>
            <dd className={`text-sm font-semibold ${customDelta >= 0 ? "text-emerald-600" : "text-rose-600"}`}>
              {money(customDelta)}
            </dd>
          </div>
          <div className="rounded-xl bg-slate-50 px-3 py-2">
            <dt className="text-xs uppercase tracking-wide text-slate-500">Net this period</dt>
            <dd className="text-sm font-semibold text-slate-800">{money(netAfterCustom)}</dd>
          </div>
        </dl>
        {weeklyNote && <p className="mt-3 text-xs text-slate-500">{weeklyNote}</p>}
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
          <div className="flex items-center justify-between">
            <h4 className="text-sm font-semibold text-slate-700">Inflows</h4>
            <span className="text-xs text-slate-500">{inflowRows.length} items</span>
          </div>
          <table className="mt-3 w-full text-sm">
            <thead>
              <tr className="text-slate-500">
                <th className="py-2 text-left">Name</th>
                <th className="py-2 text-left">Frequency</th>
                <th className="py-2 text-right">Amount</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {inflowRows.length === 0 ? (
                <tr>
                  <td className="py-3 text-slate-500" colSpan={4}>
                    No inflows yet.
                  </td>
                </tr>
              ) : (
                inflowRows.map((row) => (
                  <tr key={row.id} className="border-b last:border-0">
                    <td className="py-2 font-medium text-slate-700">
                      {row.name}
                      {row.source === "custom" && (
                        <span className="ml-2 rounded-full bg-indigo-50 px-2 py-0.5 text-xs text-indigo-600">
                          Custom
                        </span>
                      )}
                    </td>
                    <td className="py-2 text-slate-500">{formatFrequency(row.frequency)}</td>
                    <td className="py-2 text-right font-semibold text-emerald-600">{money(row.amount)}</td>
                    <td className="py-2 text-right">
                      {row.source === "custom" && (
                        <button
                          onClick={() => handleRemoveCustom(row.id)}
                          className="text-xs font-medium text-rose-600 hover:underline"
                        >
                          Remove
                        </button>
                      )}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
          <div className="flex items-center justify-between">
            <h4 className="text-sm font-semibold text-slate-700">Outflows</h4>
            <span className="text-xs text-slate-500">{outflowRows.length} items</span>
          </div>
          <table className="mt-3 w-full text-sm">
            <thead>
              <tr className="text-slate-500">
                <th className="py-2 text-left">Name</th>
                <th className="py-2 text-left">Frequency</th>
                <th className="py-2 text-right">Amount</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {outflowRows.length === 0 ? (
                <tr>
                  <td className="py-3 text-slate-500" colSpan={4}>
                    No outflows yet.
                  </td>
                </tr>
              ) : (
                outflowRows.map((row) => (
                  <tr key={row.id} className="border-b last:border-0">
                    <td className="py-2 font-medium text-slate-700">
                      {row.name}
                      {row.source === "custom" && (
                        <span className="ml-2 rounded-full bg-indigo-50 px-2 py-0.5 text-xs text-indigo-600">
                          Custom
                        </span>
                      )}
                    </td>
                    <td className="py-2 text-slate-500">{formatFrequency(row.frequency)}</td>
                    <td className="py-2 text-right font-semibold text-rose-600">{money(row.amount)}</td>
                    <td className="py-2 text-right">
                      {row.source === "custom" && (
                        <button
                          onClick={() => handleRemoveCustom(row.id)}
                          className="text-xs font-medium text-rose-600 hover:underline"
                        >
                          Remove
                        </button>
                      )}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      <div className="rounded-2xl border border-dashed border-slate-300 bg-slate-50/60 p-4">
        <h4 className="text-sm font-semibold text-slate-700">Add custom inflow or outflow</h4>
        <div className="mt-3 grid grid-cols-1 gap-3 md:grid-cols-2 lg:grid-cols-3">
          <label className="text-xs font-medium text-slate-600">
            Name
            <input
              type="text"
              className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
              value={newItem.name}
              onChange={(e) => setNewItem((prev) => ({ ...prev, name: e.target.value }))}
            />
          </label>
          <label className="text-xs font-medium text-slate-600">
            Amount
            <input
              type="number"
              className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
              value={newItem.amount}
              min={0}
              step={0.01}
              onChange={(e) => setNewItem((prev) => ({ ...prev, amount: Number(e.target.value) }))}
            />
          </label>
          <label className="text-xs font-medium text-slate-600">
            Direction
            <select
              className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
              value={newItem.direction}
              onChange={(e) => setNewItem((prev) => ({ ...prev, direction: e.target.value as "inflow" | "outflow" }))}
            >
              <option value="inflow">Inflow</option>
              <option value="outflow">Outflow</option>
            </select>
          </label>
          <label className="text-xs font-medium text-slate-600">
            Frequency
            <select
              className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
              value={newItem.frequency}
              onChange={(e) => setNewItem((prev) => ({ ...prev, frequency: e.target.value as FrequencyOption }))}
            >
              <option value="daily">Daily</option>
              <option value="weekly">Weekly</option>
              <option value="monthly">Monthly</option>
              <option value="annual">Annual</option>
              <option value="custom">Custom</option>
            </select>
          </label>
          <label className="text-xs font-medium text-slate-600">
            Start date
            <input
              type="date"
              className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
              value={newItem.startDate}
              onChange={(e) => setNewItem((prev) => ({ ...prev, startDate: e.target.value }))}
            />
          </label>
          <label className="text-xs font-medium text-slate-600">
            Escalation
            <select
              className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
              value={newItem.escalation}
              onChange={(e) => setNewItem((prev) => ({ ...prev, escalation: e.target.value as "standard" | "custom" }))}
            >
              <option value="standard">Standard increase</option>
              <option value="custom">Custom</option>
            </select>
          </label>
          {newItem.escalation === "custom" && (
            <label className="text-xs font-medium text-slate-600">
              Escalation amount (%)
              <input
                type="number"
                className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                value={newItem.escalationValue}
                step={0.5}
                onChange={(e) =>
                  setNewItem((prev) => ({ ...prev, escalationValue: Number(e.target.value) }))
                }
              />
            </label>
          )}
        </div>
        <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
          <p className="text-xs text-slate-500">
            Custom flows roll into the forecast on the selected cadence. Escalations apply each renewal.
          </p>
          <button
            onClick={handleAddCustom}
            className="rounded-lg px-4 py-2 text-sm font-semibold text-white shadow-sm hover:opacity-90"
            style={{ backgroundColor: BRAND.blue }}
          >
            Add custom flow
          </button>
        </div>
      </div>
    </div>
  );
}
