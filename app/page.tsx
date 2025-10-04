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
      const allMonths = collectMonths((act ?? []) as ActLong[], (bal ?? []) as BalLong[]);
      setMonths(filterMonths(allMonths, startMonth, horizon));
      setActivity((act ?? []) as ActLong[]);
      setBalances((bal ?? []) as BalLong[]);
    })();
  }, [clientId]);

  // re-filter months when controls change
  useEffect(() => {
    const all = collectMonths(activity, balances);
    setMonths(filterMonths(all, startMonth, horizon));
  }, [startMonth, horizon, activity, balances]);

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
    const { data } = await supabase
      .from("v_proj_occurrences")
      .select("client_id, month_start, coa_account_id, kind, name, amount")
      .eq("client_id", clientId)
      .eq("month_start", ym + "-01");
    const filtered = (data ?? []).filter((r: any) => coaMap[r.coa_account_id] === slug);
    setOcc(filtered as OccRow[]);
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
                await supabase.from("pf_accounts").insert(
                  core.map((r) => ({ client_id: (data as any).id, ...r }))
                );
              }}
            >
              + Add Client
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
function collectMonths(activity: ActLong[], balances: BalLong[]) {
  const set = new Set<string>();
  activity.forEach((r) => set.add(r.ym));
  balances.forEach((r) => set.add(r.ym));
  return Array.from(set);
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
      const { data } = await supabase
        .from("v_proj_occurrences")
        .select("client_id, month_start, coa_account_id, kind, name, amount")
        .eq("client_id", clientId)
        .eq("month_start", ym + "-01");
      const filtered = (data ?? []).filter((r: any) => coaMap[r.coa_account_id] === slug);
      setOcc(filtered as OccRow[]);
    })();
  }, [clientId, ym, slug]);

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
