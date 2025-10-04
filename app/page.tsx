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

// ------------------ brand + helpers ------------------
const BRAND = { blue: "#004aad", orange: "#fa9100" };

const money = (n: number) =>
  new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(n || 0);

const shortYM = (ym: string) => {
  const dt = new Date(ym + "-01");
  return dt.toLocaleDateString("en-US", { month: "short", year: "2-digit" }).replace(" ", "-");
};

const toSlug = (s: string) =>
  s.trim().toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "");

type AllocationTargets = {
  profit: number;
  owners_pay: number;
  tax: number;
  operating_expenses: number;
};

type AllocationBracket = {
  label: string;
  min: number;
  max: number;
  targets: AllocationTargets;
};

const ALLOCATION_BRACKETS: AllocationBracket[] = [
  {
    label: "$0 – $250K",
    min: 0,
    max: 250_000,
    targets: { profit: 0.05, owners_pay: 0.5, tax: 0.15, operating_expenses: 0.3 },
  },
  {
    label: "$250K – $500K",
    min: 250_000,
    max: 500_000,
    targets: { profit: 0.1, owners_pay: 0.35, tax: 0.15, operating_expenses: 0.4 },
  },
  {
    label: "$500K – $1M",
    min: 500_000,
    max: 1_000_000,
    targets: { profit: 0.15, owners_pay: 0.2, tax: 0.15, operating_expenses: 0.5 },
  },
  {
    label: "$1M – $5M",
    min: 1_000_000,
    max: 5_000_000,
    targets: { profit: 0.1, owners_pay: 0.1, tax: 0.15, operating_expenses: 0.65 },
  },
  {
    label: "$5M – $10M",
    min: 5_000_000,
    max: 10_000_000,
    targets: { profit: 0.15, owners_pay: 0.05, tax: 0.1, operating_expenses: 0.7 },
  },
  {
    label: "$10M – $50M",
    min: 10_000_000,
    max: 50_000_000,
    targets: { profit: 0.2, owners_pay: 0, tax: 0.05, operating_expenses: 0.75 },
  },
];

const getAllocationBracket = (revenue: number | null | undefined) => {
  if (!revenue || revenue < 0) return null;
  return (
    ALLOCATION_BRACKETS.find((b) => revenue >= b.min && revenue < b.max) ??
    ALLOCATION_BRACKETS[ALLOCATION_BRACKETS.length - 1] ??
    null
  );
};


// ------------------ types ------------------
type ClientRow = { id: string; name: string };
type PFAccount = { slug: string; name: string; color?: string | null; sort_order?: number | null };

type ActLong = { client_id: string; ym: string; pf_slug: string; net_amount: number };
type BalLong = { client_id: string; ym: string; pf_slug: string; ending_balance: number };

type OccRow = {
  client_id: string;
  month_start: Date;
  coa_account_id: string;
  kind: string;
  name: string;
  amount: number;
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
  const [horizon, setHorizon] = useState<number>(9);
  const [startMonth, setStartMonth] = useState<string>(() => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
  });

  // dynamic accounts + data
  const [accounts, setAccounts] = useState<PFAccount[]>([]);
  const [months, setMonths] = useState<string[]>([]);
  const [activity, setActivity] = useState<ActLong[]>([]);
  const [balances, setBalances] = useState<BalLong[]>([]);

  // allocations (settings)
  const [alloc, setAlloc] = useState<Record<string, number>>({});
  const [allocDate, setAllocDate] = useState<string>(() => new Date().toISOString().slice(0, 10));
  const [autoBucket, setAutoBucket] = useState<string | null>(null);

  // drill
  const [drill, setDrill] = useState<{ slug: string; ym: string } | null>(null);
  const [occ, setOcc] = useState<OccRow[]>([]);
  const [coaMap, setCoaMap] = useState<Record<string, string>>({}); // coa_id -> pf_slug

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
    setAutoBucket(null);
    setActivity([]);
    setBalances([]);
    setMonths([]);
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

  const slugMatches = useMemo(() => {
    const findSlug = (predicate: (a: PFAccount) => boolean) =>
      accounts.find(predicate)?.slug ?? null;
    return {
      profit: findSlug((a) => a.slug === "profit" || /profit/i.test(a.name)),
      owners_pay: findSlug((a) => a.slug === "owners_pay" || /owner/i.test(a.name)),
      tax: findSlug((a) => a.slug === "tax" || /tax/i.test(a.name)),
      operating: findSlug((a) =>
        a.slug === "operating" || /operat/i.test(a.slug) || /operat/i.test(a.name)
      ),
      realRevenue: findSlug(
        (a) => a.slug === "real_revenue" || (/real/i.test(a.name) && /rev/i.test(a.name))
      ),
    };
  }, [accounts]);

  const realRevenueSlug = slugMatches.realRevenue;

  const trailingRevenue = useMemo(() => {
    if (!realRevenueSlug) return null;
    const relevant = activity.filter((r) => r.pf_slug === realRevenueSlug);
    if (!relevant.length) return null;
    const sorted = [...relevant].sort((a, b) => (a.ym > b.ym ? 1 : a.ym < b.ym ? -1 : 0));
    const last12 = sorted.slice(-12);
    return last12.reduce((sum, r) => sum + Number(r.net_amount || 0), 0);
  }, [activity, realRevenueSlug]);

  const recommendedAlloc = useMemo(() => {
    const bracket = getAllocationBracket(trailingRevenue);
    if (!bracket) return null;
    const mapping: Record<string, number> = {};
    accounts.forEach((a) => {
      let pct = alloc[a.slug] ?? 0;
      if (slugMatches.profit && a.slug === slugMatches.profit) pct = bracket.targets.profit;
      if (slugMatches.owners_pay && a.slug === slugMatches.owners_pay)
        pct = bracket.targets.owners_pay;
      if (slugMatches.tax && a.slug === slugMatches.tax) pct = bracket.targets.tax;
      if (slugMatches.operating && a.slug === slugMatches.operating)
        pct = bracket.targets.operating_expenses;
      mapping[a.slug] = pct;
    });
    return { bracket, mapping };
  }, [accounts, alloc, slugMatches, trailingRevenue]);

  useEffect(() => {
    if (!clientId || !allocDate || !recommendedAlloc || !accounts.length) return;
    if (autoBucket === recommendedAlloc.bracket.label) return;

    const nextMapping = { ...recommendedAlloc.mapping };
    const changed = accounts.some((a) =>
      Math.abs((alloc[a.slug] ?? 0) - (nextMapping[a.slug] ?? 0)) > 0.0001
    );

    setAutoBucket(recommendedAlloc.bracket.label);
    if (!changed) return;

    setAlloc(nextMapping);
    (async () => {
      try {
        await Promise.all(
          accounts.map((a) =>
            supabase.from("allocation_targets").upsert(
              {
                client_id: clientId,
                effective_date: allocDate,
                pf_slug: a.slug,
                pct: nextMapping[a.slug] ?? 0,
              },
              { onConflict: "client_id, effective_date, pf_slug" }
            )
          )
        );
      } catch (err) {
        console.error("Failed to auto-update allocation targets", err);
      }
    })();
  }, [accounts, alloc, allocDate, autoBucket, clientId, recommendedAlloc]);

  const chartData = useMemo(() => {
    return months.map((ym) => {
      const row = balByMonth.get(ym) || {};
      const d: any = { month: ym, label: shortYM(ym) };
      let total = 0;
      accounts.forEach((a) => {
        const v = row[a.slug] || 0;
        d[a.name] = v;
        total += v;
      });
      d.Total = total;
      return d;
    });
  }, [months, accounts, balByMonth]);

  // ------------ drill ------------
  async function openDrill(slug: string, ym: string) {
    if (!clientId) return;
    setDrill({ slug, ym });
    const occurrences = await fetchOccurrencesFor(clientId, ym, slug, coaMap);
    setOcc(occurrences);
  }

  // ------------ render ------------
  const allocTotal = accounts.reduce((s, a) => s + (alloc[a.slug] || 0), 0);
  const allocOk = Math.abs(allocTotal - 1) < 0.0001;

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

      <div className="max-w-[1200px] mx-auto px-4 py-4">
        {/* top bar */}
        <div className="flex items-center justify-between gap-3 flex-wrap mb-2">
          <div className="flex items-center gap-3">
            <select
              value={clientId ?? ""}
              onChange={(e) => setClientId(e.target.value)}
              className="px-3 py-2 rounded-lg border bg-white"
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
                const rangeMenu = ALLOCATION_BRACKETS.map(
                  (b, idx) => `${idx + 1}) ${b.label}`
                ).join("\n");
                const rangeSelection = prompt(
                  `Select the client's real revenue range (1-${ALLOCATION_BRACKETS.length}):\n${rangeMenu}`
                );
                if (rangeSelection === null) return;
                const rangeIndex = Number(rangeSelection.trim()) - 1;
                const selectedBracket = ALLOCATION_BRACKETS[rangeIndex];
                if (!selectedBracket) {
                  alert("Invalid range selected. Client was not created.");
                  return;
                }
                const { data, error } = await supabase.from("clients").insert({ name }).select().single();
                if (error) return alert("Could not add client. Check policies.");
                setClients((p) => [...p, data as ClientRow]);
                setClientId((data as any).id);
                // seed core PF accounts for this client so UI works instantly
                const core = [
                  { slug: "operating", name: "Operating", sort_order: 10, color: "#64748b" },
                  { slug: "profit", name: "Profit", sort_order: 20, color: "#fa9100" },
                  { slug: "owners_pay", name: "Owner's Pay", sort_order: 30, color: "#10b981" },
                  { slug: "tax", name: "Tax", sort_order: 40, color: "#ef4444" },
                  { slug: "vault", name: "Vault", sort_order: 50, color: "#8b5cf6" },
                ];
                const clientIdCreated = (data as any).id;
                await supabase
                  .from("pf_accounts")
                  .insert(core.map((r) => ({ client_id: clientIdCreated, ...r })));
                const today = new Date().toISOString().slice(0, 10);
                const defaultAlloc: Record<string, number> = {
                  operating: selectedBracket.targets.operating_expenses,
                  profit: selectedBracket.targets.profit,
                  owners_pay: selectedBracket.targets.owners_pay,
                  tax: selectedBracket.targets.tax,
                  vault: 0,
                };
                await supabase.from("allocation_targets").upsert(
                  core.map((acc) => ({
                    client_id: clientIdCreated,
                    effective_date: today,
                    pf_slug: acc.slug,
                    pct: defaultAlloc[acc.slug] ?? 0,
                  })),
                  { onConflict: "client_id, effective_date, pf_slug" }
                );
                setAllocDate(today);
                setAlloc(defaultAlloc);
              }}
            >
              + Add Client
            </Button>
            <Button
              className="bg-red-600 text-white border-0 hover:bg-red-700"
              onClick={async () => {
                if (!clientId) return;
                const clientName = clients.find((c) => c.id === clientId)?.name ?? "this client";
                if (
                  !window.confirm(
                    `Delete ${clientName}? This will permanently remove the client and all associated data.`
                  )
                )
                  return;

                const tables = ["allocation_targets", "pf_accounts", "coa_to_pf_map"];
                for (const table of tables) {
                  const { error } = await supabase.from(table).delete().eq("client_id", clientId);
                  if (error) {
                    console.error(error);
                    alert(`Could not delete client data from ${table}. Check policies.`);
                    return;
                  }
                }

                const { error } = await supabase.from("clients").delete().eq("id", clientId);
                if (error) {
                  console.error(error);
                  alert("Could not delete client. Check policies.");
                  return;
                }

                const currentIndex = clients.findIndex((c) => c.id === clientId);
                const remainingClients = clients.filter((c) => c.id !== clientId);
                setClients(remainingClients);
                const nextClientId =
                  remainingClients[currentIndex]?.id ??
                  remainingClients[currentIndex - 1]?.id ??
                  remainingClients[0]?.id ??
                  null;
                setClientId(nextClientId);

                if (!nextClientId) {
                  const today = new Date().toISOString().slice(0, 10);
                  setAccounts([]);
                  setActivity([]);
                  setBalances([]);
                  setMonths([]);
                  setAlloc({});
                  setAllocDate(today);
                  setCoaMap({});
                  setDrill(null);
                  setOcc([]);
                }
              }}
            >
              Delete Client
            </Button>
          </div>

        {/* controls like your first screenshot */}
          <div className="flex items-center gap-2">
            <label className="text-sm text-slate-700">Horizon</label>
            <select
              value={horizon}
              onChange={(e) => setHorizon(Number(e.target.value))}
              className="px-2 py-1 rounded-md border bg-white"
            >
              {[6, 9, 12, 18, 24].map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
            </select>
            <label className="text-sm text-slate-700 ml-2">Start</label>
            <input
              type="month"
              value={startMonth}
              onChange={(e) => setStartMonth(e.target.value)}
              className="px-2 py-1 rounded-md border bg-white"
            />
            <label className="text-sm text-slate-700 ml-3">Mode</label>
            <select
              value={mode}
              onChange={(e) => setMode(e.target.value as any)}
              className="px-2 py-1 rounded-md border bg-white"
            >
              <option value="total">Total balance</option>
              <option value="accounts">Individual accounts</option>
            </select>
          </div>
        </div>

        {/* chart */}
        <Card title="Projected Ending Balances">
          <div className="h-[320px]">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={chartData} margin={{ top: 12, right: 24, bottom: 12, left: 24 }}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="label" />
                <YAxis tickFormatter={(v) => money(Number(v))} width={90} />
                <Tooltip formatter={(v: any) => money(Number(v))} />
                <Legend />
                {mode === "total" ? (
                  <Area type="monotone" dataKey="Total" stroke={BRAND.blue} fillOpacity={0.15} />
                ) : (
                  accounts.map((a) => (
                    <Area
                      key={a.slug}
                      type="monotone"
                      dataKey={a.name}
                      stroke={a.color || "#64748b"}
                      fillOpacity={0.1}
                    />
                  ))
                )}
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </Card>

        {/* ending balances table */}
        <div className="mt-4">
          <Card title="Ending Bank Balances (roll-forward)">
            <div className="overflow-x-auto">
              <table className="min-w-full text-sm">
                <thead>
                  <tr className="bg-slate-50">
                    <th className="px-3 py-2 text-left font-semibold">Row</th>
                    {months.map((m) => (
                      <th key={m} className="px-3 py-2 text-right font-semibold whitespace-nowrap">
                        {shortYM(m)}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {accounts.map((acc) => (
                    <tr key={acc.slug} className="hover:bg-slate-50">
                      <td className="px-3 py-2 font-medium text-slate-800">{acc.name} (End)</td>
                      {months.map((m) => {
                        const row = balByMonth.get(m) || {};
                        const val = row[acc.slug] || 0;
                        return (
                          <td
                            key={m}
                            className="px-3 py-2 text-right cursor-pointer"
                            onClick={() => openDrill(acc.slug, m)}
                          >
                            {money(val)}
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
        </div>

        {/* monthly activity table */}
        <div className="mt-4">
          <Card title="Monthly Activity (net movement)">
            <div className="overflow-x-auto">
              <table className="min-w-full text-sm">
                <thead>
                  <tr className="bg-slate-50">
                    <th className="px-3 py-2 text-left font-semibold">Account (net)</th>
                    {months.map((m) => (
                      <th key={m} className="px-3 py-2 text-right font-semibold whitespace-nowrap">
                        {shortYM(m)}
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
                            {money(val)}
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="text-xs text-slate-500 mt-2">
              Beginning balance + Net activity = Ending balance.
            </p>
          </Card>
        </div>

        {/* settings (minimal — allocations only, dynamic) */}
        <div className="mt-6">
          <Card title="Settings — Allocation Targets">
            <div className="flex items-center gap-3 mb-3">
              <span className="text-sm text-slate-700">Effective date</span>
              <input
                type="date"
                className="border rounded-md px-2 py-1 bg-white"
                value={allocDate}
                onChange={(e) => setAllocDate(e.target.value)}
              />
              <span
                className={`ml-auto text-xs font-semibold px-2 py-1 rounded ${
                  allocOk ? "bg-emerald-100 text-emerald-700" : "bg-orange-100 text-orange-700"
                }`}
              >
                Total: {(allocTotal * 100).toFixed(1)}%
              </span>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 lg:grid-cols-5 gap-3">
              {accounts.map((a) => (
                <div key={a.slug} className="space-y-1">
                  <label className="text-sm font-medium text-slate-700">{a.name}</label>
                  <input
                    type="number"
                    step={0.01}
                    min={0}
                    max={1}
                    value={alloc[a.slug] ?? 0}
                    onChange={(e) =>
                      setAlloc((prev) => ({ ...prev, [a.slug]: Number(e.target.value) }))
                    }
                    className="w-full border rounded-lg px-3 py-2 bg-white"
                  />
                </div>
              ))}
            </div>

            <div className="mt-4 flex gap-3">
              <Button
                disabled={!clientId || !allocOk}
                onClick={async () => {
                  if (!clientId || !allocOk) return;
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
                className={`bg-[${BRAND.blue}] text-white border-none hover:opacity-90 ${
                  !allocOk ? "opacity-60 cursor-not-allowed" : ""
                }`}
              >
                Save Allocations
              </Button>
              <Button
                className="bg-[color:var(--white)]"
                onClick={() => location.reload()}
              >
                Recalculate
              </Button>
              <Button
                onClick={async () => {
                  if (!clientId) return;
                  const name = prompt("Add PF account (example: Truck)");
                  if (!name) return;
                  const slug = toSlug(name);
                  const { error } = await supabase.from("pf_accounts").insert({
                    client_id: clientId,
                    slug,
                    name,
                    sort_order: 100,
                    color: "#8b5cf6",
                  });
                  if (error) return alert("Could not add account. Check RLS.");
                  // reload accounts
                  const { data: paf } = await supabase
                    .from("pf_accounts")
                    .select("slug, name, color, sort_order")
                    .eq("client_id", clientId)
                    .order("sort_order", { ascending: true })
                    .order("name", { ascending: true });
                  setAccounts((paf ?? []) as PFAccount[]);
                  setAlloc((p) => ({ ...p, [slug]: 0 }));
                }}
              >
                + Add Account
              </Button>
            </div>
          </Card>
        </div>
      </div>

      {/* drill panel */}
      {drill && (
        <div className="fixed inset-0 z-40">
          <div className="absolute inset-0 bg-black/30" onClick={() => setDrill(null)} />
          <div className="absolute right-0 top-0 h-full w-full sm:w-[520px] bg-white shadow-2xl p-6 overflow-y-auto">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-lg font-semibold text-slate-800">
                {accounts.find((a) => a.slug === drill.slug)?.name} • {shortYM(drill.ym)}
              </h3>
              <button className="text-slate-600" onClick={() => setDrill(null)}>
                ✕
              </button>
            </div>

            {/* load occurrences for this account/month */}
            <DrillTable
              clientId={clientId!}
              ym={drill.ym}
              slug={drill.slug}
              setOcc={setOcc}
              occ={occ}
              coaMap={coaMap}
            />
          </div>
        </div>
      )}
    </main>
  );
}

// -------- helper components / functions --------
async function fetchOccurrencesFor(
  clientId: string,
  ym: string,
  slug: string,
  coaMap: Record<string, string>
): Promise<OccRow[]> {
  const ymDate = `${ym}-01`;
  const { data } = await supabase
    .from("v_proj_occurrences")
    .select("client_id, month_start, coa_account_id, kind, name, amount")
    .eq("client_id", clientId)
    .eq("month_start", ymDate);

  return (data ?? [])
    .filter((row: any) => coaMap[row.coa_account_id] === slug)
    .map((row: any) => {
      const raw = row.month_start;
      const monthStart =
        raw instanceof Date ? raw : typeof raw === "string" ? new Date(raw) : null;
      if (!monthStart || Number.isNaN(monthStart.getTime())) return null;

      return {
        client_id: row.client_id,
        month_start: monthStart,
        coa_account_id: row.coa_account_id,
        kind: row.kind,
        name: row.name,
        amount: Number(row.amount ?? 0),
      };
    })
    .filter((row): row is OccRow => Boolean(row));
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

function DrillTable({
  clientId,
  ym,
  slug,
  setOcc,
  occ,
  coaMap,
}: {
  clientId: string;
  ym: string;
  slug: string;
  setOcc: (r: OccRow[]) => void;
  occ: OccRow[];
  coaMap: Record<string, string>;
}) {
  useEffect(() => {
    (async () => {
      const occurrences = await fetchOccurrencesFor(clientId, ym, slug, coaMap);
      setOcc(occurrences);
    })();
  }, [clientId, ym, slug, coaMap]);

  const inflows = occ.filter((r) => r.amount > 0);
  const outflows = occ.filter((r) => r.amount < 0);

  return (
    <div className="space-y-6">
      <Card title="Inflows">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-slate-500">
              <th className="text-left py-1">Name</th>
              <th className="text-right py-1">Amount</th>
            </tr>
          </thead>
          <tbody>
            {inflows.length === 0 ? (
              <tr>
                <td className="py-2 text-slate-500" colSpan={2}>
                  No inflows
                </td>
              </tr>
            ) : (
              inflows.map((r, i) => (
                <tr key={i} className="border-b last:border-0">
                  <td className="py-1">{r.name}</td>
                  <td className="py-1 text-right">{money(r.amount)}</td>
                </tr>
              ))
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
            {outflows.length === 0 ? (
              <tr>
                <td className="py-2 text-slate-500" colSpan={2}>
                  No outflows
                </td>
              </tr>
            ) : (
              outflows.map((r, i) => (
                <tr key={i} className="border-b last:border-0">
                  <td className="py-1">{r.name}</td>
                  <td className="py-1 text-right">{money(r.amount)}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </Card>
    </div>
  );
}
