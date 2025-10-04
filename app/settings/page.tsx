"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import Head from "next/head";
import Link from "next/link";
import { supabase } from "../../lib/supabase";

const CUSTOM_ACCOUNT_LIMIT = 15;

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

const toSlug = (s: string) => s.trim().toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "");

// ------------------ types ------------------
type ClientRow = { id: string; name: string };
type PFAccount = { slug: string; name: string; color?: string | null; sort_order?: number | null };

type DisplayAccount = {
  slug: string;
  name: string;
  color: string;
  source: "core" | "derived" | "custom";
  sortOrder: number;
  configured: boolean;
};

// ------------------ small UI atoms ------------------
const cn = (...classes: Array<string | false | null | undefined>) => classes.filter(Boolean).join(" ");

const Card: React.FC<React.PropsWithChildren<{ title?: string; subtitle?: string }>> = ({
  title,
  subtitle,
  children,
}) => (
  <div className="rounded-2xl border border-slate-200 bg-white shadow-sm">
    {(title || subtitle) && (
      <div className="border-b border-slate-200 px-4 py-3">
        {title && <h2 className="text-base font-semibold text-slate-800">{title}</h2>}
        {subtitle && <p className="text-sm text-slate-500">{subtitle}</p>}
      </div>
    )}
    <div className="p-4">{children}</div>
  </div>
);

const Button: React.FC<React.ButtonHTMLAttributes<HTMLButtonElement>> = ({ className, ...p }) => (
  <button
    {...p}
    className={
      "px-3 py-2 rounded-lg text-sm font-medium bg-white border border-slate-300 hover:border-blue-400 hover:text-blue-600 " +
      (className || "")
    }
  />
);

const SETTINGS_STORAGE_KEY = "pf-forecast-settings";

export default function SettingsPage() {
  const [clients, setClients] = useState<ClientRow[]>([]);
  const [clientId, setClientId] = useState<string | null>(null);
  const [accounts, setAccounts] = useState<PFAccount[]>([]);
  const [alloc, setAlloc] = useState<Record<string, number>>({});
  const [allocDate, setAllocDate] = useState<string>(() => new Date().toISOString().slice(0, 10));

  const [allocationSettings, setAllocationSettings] = useState({
    cadence: "weekly" as "weekly" | "semi_monthly" | "monthly",
    weekDay: "friday",
    semiMonthlyDays: [10, 25],
    monthlyDay: 1,
  });
  const [rolloutPlan, setRolloutPlan] = useState({ quarters: 4 });
  const [profitSettings, setProfitSettings] = useState({
    bonusPct: 0.5,
    vaultPct: 0.5,
    nextDistribution: new Date().toISOString().slice(0, 10),
  });
  const [taxSettings, setTaxSettings] = useState({
    mode: "calculation" as "flat" | "calculation",
    flatAmount: 0,
    taxRate: 0.1,
    estimatedPaid: 0,
    vaultPct: 0,
  });
  const [activeSection, setActiveSection] = useState("allocations");
  const [isLoading, setIsLoading] = useState(false);
  const [dataError, setDataError] = useState<string | null>(null);

  // persist settings locally so changes survive navigation
  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      const raw = window.localStorage.getItem(SETTINGS_STORAGE_KEY);
      if (!raw) return;
      const parsed = JSON.parse(raw);
      if (parsed.allocationSettings) setAllocationSettings(parsed.allocationSettings);
      if (parsed.rolloutPlan) setRolloutPlan(parsed.rolloutPlan);
      if (parsed.profitSettings) setProfitSettings(parsed.profitSettings);
      if (parsed.taxSettings) setTaxSettings(parsed.taxSettings);
    } catch (err) {
      console.warn("Unable to load saved settings", err);
    }
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const payload = { allocationSettings, rolloutPlan, profitSettings, taxSettings };
    window.localStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(payload));
  }, [allocationSettings, rolloutPlan, profitSettings, taxSettings]);

  useEffect(() => {
    if (!supabase) {
      setDataError(
        "Supabase environment variables are missing. Provide NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY to load settings."
      );
      return;
    }

    let cancelled = false;
    const client = supabase;

    (async () => {
      try {
        const { data, error } = await client.from("clients").select("id, name").order("created_at");
        if (cancelled) return;
        if (error) throw error;
        setClients(data ?? []);
        if (data && data.length) {
          setClientId((prev) => prev ?? data[0].id);
        }
        setDataError(null);
      } catch (err) {
        if (cancelled) return;
        console.error("Unable to load clients", err);
        setDataError(err instanceof Error ? err.message : "Unable to load clients from Supabase.");
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  const loadClientData = useCallback(async (id: string) => {
    if (!supabase) {
      setDataError(
        "Supabase environment variables are missing. Provide NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY to manage settings."
      );
      return;
    }

    setIsLoading(true);
    setDataError(null);

    try {
      const client = supabase;
      const { data: paf, error: accountError } = await client
        .from("pf_accounts")
        .select("slug, name, color, sort_order")
        .eq("client_id", id)
        .order("sort_order", { ascending: true })
        .order("name", { ascending: true });
      if (accountError) throw accountError;
      setAccounts((paf ?? []) as PFAccount[]);

      const { data: latest, error: latestError } = await client
        .from("allocation_targets")
        .select("effective_date")
        .eq("client_id", id)
        .order("effective_date", { ascending: false })
        .limit(1);
      if (latestError) throw latestError;
      const fallback = new Date().toISOString().slice(0, 10);
      const eff = latest?.[0]?.effective_date ?? fallback;
      setAllocDate(eff);

      const { data: arows, error: allocError } = await client
        .from("allocation_targets")
        .select("pf_slug, pct")
        .eq("client_id", id)
        .eq("effective_date", eff);
      if (allocError) throw allocError;
      const map: Record<string, number> = {};
      (arows ?? []).forEach((row: any) => {
        map[row.pf_slug] = Number(row.pct || 0);
      });
      setAlloc(map);
    } catch (err) {
      console.error("Unable to load client configuration", err);
      setDataError(
        err instanceof Error ? err.message : "Unable to load client configuration from Supabase."
      );
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!clientId) return;
    loadClientData(clientId);
  }, [clientId, loadClientData]);

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

  const allocTotal = allocationAccounts.reduce((sum, acc) => sum + (alloc[acc.slug] || 0), 0);
  const allocOk = Math.abs(allocTotal - 1) < 0.0001;
  const customAccountsRemaining = Math.max(0, CUSTOM_ACCOUNT_LIMIT - customAccounts.length);

  const allocationSummary = describeAllocationCadence(allocationSettings);
  const profitDistributionLabel = formatLongDate(profitSettings.nextDistribution);
  const taxSummaryLabel =
    taxSettings.mode === "calculation"
      ? `Calculated at ${(taxSettings.taxRate * 100).toFixed(1)}% less $${taxSettings.estimatedPaid.toLocaleString()} paid`
      : `Flat $${taxSettings.flatAmount.toLocaleString()} split quarterly`;
  const menuSections = useMemo(
    () => [
      { id: "allocations", label: "Allocation targets", description: "Bucket percentages" },
      { id: "cadence", label: "Allocation cadence", description: "Automation schedule" },
      { id: "rollout", label: "Rollout plan", description: "Quarterly adjustments" },
      { id: "profit", label: "Profit distribution", description: "Owner bonuses" },
      { id: "tax", label: "Tax strategy", description: "Quarterly estimates" },
    ],
    []
  );

  const handleMenuClick = useCallback((id: string) => {
    setActiveSection(id);
    if (typeof document !== "undefined") {
      const el = document.getElementById(id);
      if (el) {
        el.scrollIntoView({ behavior: "smooth", block: "start" });
      }
      if (window && window.history && window.location) {
        const url = new URL(window.location.href);
        url.hash = id;
        window.history.replaceState({}, "", url.toString());
      }
    }
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const hash = window.location.hash.replace("#", "");
    if (hash && menuSections.some((section) => section.id === hash)) {
      setActiveSection(hash);
    }
  }, [menuSections]);

  return (
    <main className="min-h-screen bg-slate-100">
      <Head>
        <title>Settings • Profit First Forecast</title>
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
          <div className="mx-auto flex w-full max-w-7xl flex-wrap items-end justify-between gap-4 px-6 py-4">
            <div>
              <p className="text-xs uppercase tracking-wide text-slate-500">Settings</p>
              <h1 className="text-2xl font-semibold text-slate-900">Client configuration</h1>
              <p className="mt-1 text-sm text-slate-500">
                Control allocation targets, cadence, profit distributions, and tax plans for each client.
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-3">
              <div className="flex items-center gap-2">
                <select
                  value={clientId ?? ""}
                  onChange={(e) => setClientId(e.target.value)}
                  className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-700 shadow-sm focus:border-blue-500 focus:outline-none"
                >
                  {clients.map((client) => (
                    <option key={client.id} value={client.id}>
                      {client.name}
                    </option>
                  ))}
                </select>
                <Button
                  onClick={async () => {
                    const name = prompt("New client name?");
                    if (!name) return;
                    if (!supabase) {
                      alert(
                        "Supabase is not configured. Add NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY to create clients."
                      );
                      return;
                    }
                    const client = supabase;
                    const { data, error } = await client
                      .from("clients")
                      .insert({ name })
                      .select()
                      .single();
                    if (error) {
                      alert("Could not add client. Check policies.");
                      return;
                    }
                    setClients((prev) => [...prev, data as ClientRow]);
                    setClientId((data as any).id);
                    const core = [
                      { slug: "income", name: "Income", sort_order: 1, color: "#0284c7" },
                      { slug: "operating", name: "Operating", sort_order: 10, color: "#64748b" },
                      { slug: "profit", name: "Profit", sort_order: 20, color: "#fa9100" },
                      { slug: "owners_pay", name: "Owner's Pay", sort_order: 30, color: "#10b981" },
                      { slug: "tax", name: "Tax", sort_order: 40, color: "#ef4444" },
                      { slug: "vault", name: "Vault", sort_order: 50, color: "#8b5cf6" },
                    ];
                    await client
                      .from("pf_accounts")
                      .insert(core.map((row) => ({ client_id: (data as any).id, ...row })));
                    loadClientData((data as any).id);
                  }}
                >
                  + Client
                </Button>
              </div>
              <Link
                href="/"
                className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-700 shadow-sm transition hover:border-blue-400 hover:text-blue-600"
              >
                Back to dashboard
              </Link>
            </div>
          </div>
        </header>

        <div className="flex-1">
          <div className="mx-auto w-full max-w-7xl px-6 py-8">
            <div className="grid gap-8 lg:grid-cols-[260px,1fr]">
              <aside className="space-y-4">
                <nav className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
                  <ul className="divide-y divide-slate-100">
                    {menuSections.map((section) => (
                      <li key={section.id}>
                        <button
                          type="button"
                          onClick={() => handleMenuClick(section.id)}
                          className={cn(
                            "flex w-full flex-col items-start gap-1 px-4 py-3 text-left transition",
                            activeSection === section.id
                              ? "bg-blue-50 text-blue-700"
                              : "text-slate-600 hover:bg-slate-50"
                          )}
                        >
                          <span className="text-sm font-semibold">{section.label}</span>
                          <span className="text-xs text-slate-500">{section.description}</span>
                        </button>
                      </li>
                    ))}
                  </ul>
                </nav>
                <div className="rounded-2xl border border-slate-200 bg-white p-4 text-xs text-slate-500 shadow-sm">
                  Settings are saved to Supabase and mirrored locally so you can experiment without losing progress.
                </div>
              </aside>
              <div className="space-y-8">
                {dataError && (
                  <div className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700 shadow-sm">
                    {dataError}
                  </div>
                )}
                {isLoading && (
                  <div className="rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-500 shadow-sm">
                    Loading client configuration…
                  </div>
                )}

                <section id="allocations" className="space-y-4">
                  <Card
                    title="Allocation targets"
                    subtitle="Set the target percentages for Profit First buckets. Totals must equal 100%."
                  >
                    <div className="flex flex-wrap items-center gap-3">
                      <label className="flex items-center gap-2 text-sm text-slate-600">
                        Effective date
                        <input
                          type="date"
                          className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm"
                          value={allocDate}
                          onChange={(e) => setAllocDate(e.target.value)}
                        />
                      </label>
                      <span
                        className={`rounded-full px-3 py-1 text-xs font-semibold ${
                          allocOk ? "bg-emerald-100 text-emerald-700" : "bg-orange-100 text-orange-700"
                        }`}
                      >
                        Total: {(allocTotal * 100).toFixed(1)}%
                      </span>
                      <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold text-slate-600">
                        Custom accounts remaining: {customAccountsRemaining}
                      </span>
                    </div>

                    <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4">
                      {allocationAccounts.map((account) => (
                        <div key={account.slug} className="rounded-2xl border border-slate-200 bg-white p-3 shadow-sm">
                          <div className="flex items-center justify-between text-sm font-medium text-slate-700">
                            <span>{account.name}</span>
                            <span className="text-xs text-slate-500">{((alloc[account.slug] ?? 0) * 100).toFixed(1)}%</span>
                          </div>
                          <input
                            type="number"
                            step={0.01}
                            min={0}
                            max={1}
                            value={alloc[account.slug] ?? 0}
                            onChange={(e) => setAlloc((prev) => ({ ...prev, [account.slug]: Number(e.target.value) }))}
                            className="mt-2 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
                          />
                        </div>
                      ))}
                    </div>

                    <div className="mt-6 flex flex-wrap items-center gap-3">
                      <Button
                        disabled={!clientId || !allocOk}
                        onClick={async () => {
                          if (!clientId || !allocOk) return;
                          if (!supabase) {
                            alert(
                              "Supabase is not configured. Add NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY to save allocations."
                            );
                            return;
                          }
                          const client = supabase;
                          try {
                            await Promise.all(
                              allocationAccounts.map((account) =>
                                client.from("allocation_targets").upsert(
                                  {
                                    client_id: clientId,
                                    effective_date: allocDate,
                                    pf_slug: account.slug,
                                    pct: alloc[account.slug] || 0,
                                  },
                                  { onConflict: "client_id, effective_date, pf_slug" }
                                )
                              )
                            );
                            alert("Allocations saved.");
                          } catch (err) {
                            console.error("Unable to save allocations", err);
                            alert("Failed to save allocations. Check Supabase policies and try again.");
                          }
                        }}
                        className={`border-blue-600 bg-blue-600 text-white hover:bg-blue-500 ${
                          !allocOk ? "cursor-not-allowed opacity-60" : ""
                        }`}
                      >
                        Save allocations
                      </Button>
                      <Button onClick={() => clientId && loadClientData(clientId)}>Refresh data</Button>
                      <Button
                        onClick={async () => {
                          if (!clientId) return;
                          if (customAccountsRemaining <= 0) {
                            alert(`Custom account limit of ${CUSTOM_ACCOUNT_LIMIT} reached.`);
                            return;
                          }
                          const name = prompt("Add PF account (example: Vault Reserve)");
                          if (!name) return;
                          const slug = toSlug(name);
                          if (!supabase) {
                            alert(
                              "Supabase is not configured. Add NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY to add accounts."
                            );
                            return;
                          }
                          const client = supabase;
                          const { error } = await client.from("pf_accounts").insert({
                            client_id: clientId,
                            slug,
                            name,
                            sort_order: 100,
                            color: "#8b5cf6",
                          });
                          if (error) {
                            alert("Could not add account. Check RLS policies.");
                            return;
                          }
                          loadClientData(clientId);
                        }}
                      >
                        + Add account
                      </Button>
                    </div>
                  </Card>
                </section>

                <div className="grid gap-6 lg:grid-cols-2">
                  <section id="cadence" className="col-span-1">
                    <Card title="Allocation cadence" subtitle="Choose the schedule used when automating allocations.">
                      <div className="space-y-4 text-sm text-slate-600">
                        <label className="flex flex-col gap-1">
                          <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">Cadence</span>
                          <select
                            value={allocationSettings.cadence}
                            onChange={(e) =>
                              setAllocationSettings((prev) => ({
                                ...prev,
                                cadence: e.target.value as "weekly" | "semi_monthly" | "monthly",
                              }))
                            }
                            className="rounded-lg border border-slate-300 px-3 py-2"
                          >
                            <option value="weekly">Weekly</option>
                            <option value="semi_monthly">10th &amp; 25th</option>
                            <option value="monthly">Monthly</option>
                          </select>
                        </label>

                        {allocationSettings.cadence === "weekly" && (
                          <label className="flex flex-col gap-1">
                            <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">Weekday</span>
                            <select
                              value={allocationSettings.weekDay}
                              onChange={(e) =>
                                setAllocationSettings((prev) => ({ ...prev, weekDay: e.target.value }))
                              }
                              className="rounded-lg border border-slate-300 px-3 py-2"
                            >
                              {["monday", "tuesday", "wednesday", "thursday", "friday"].map((day) => (
                                <option key={day} value={day}>
                                  {capitalize(day)}
                                </option>
                              ))}
                            </select>
                          </label>
                        )}

                        {allocationSettings.cadence === "semi_monthly" && (
                          <div className="grid grid-cols-2 gap-3">
                            {allocationSettings.semiMonthlyDays.map((day, idx) => (
                              <label key={idx} className="flex flex-col gap-1">
                                <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                                  {idx === 0 ? "First" : "Second"} day
                                </span>
                                <input
                                  type="number"
                                  min={1}
                                  max={31}
                                  value={day}
                                  onChange={(e) =>
                                    setAllocationSettings((prev) => {
                                      const days = [...prev.semiMonthlyDays];
                                      days[idx] = Number(e.target.value);
                                      return { ...prev, semiMonthlyDays: days };
                                    })
                                  }
                                  className="rounded-lg border border-slate-300 px-3 py-2"
                                />
                              </label>
                            ))}
                          </div>
                        )}

                        {allocationSettings.cadence === "monthly" && (
                          <label className="flex flex-col gap-1">
                            <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">Day of month</span>
                            <input
                              type="number"
                              min={1}
                              max={31}
                              value={allocationSettings.monthlyDay}
                              onChange={(e) =>
                                setAllocationSettings((prev) => ({ ...prev, monthlyDay: Number(e.target.value) }))
                              }
                              className="rounded-lg border border-slate-300 px-3 py-2"
                            />
                          </label>
                        )}

                        <div className="rounded-2xl bg-slate-100 p-3 text-xs text-slate-600">{allocationSummary}</div>
                      </div>
                    </Card>
                  </section>

                  <section id="rollout" className="col-span-1">
                    <Card title="Rollout plan" subtitle="Ease into target allocations over several quarters.">
                      <div className="space-y-4 text-sm text-slate-600">
                        <p>
                          Transition from current to target allocations over a defined number of quarters. Adjustments are split evenly
                          across the plan.
                        </p>
                        <label className="flex flex-col gap-1">
                          <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">Quarters</span>
                          <input
                            type="number"
                            min={1}
                            max={8}
                            value={rolloutPlan.quarters}
                            onChange={(e) => setRolloutPlan({ quarters: Number(e.target.value) })}
                            className="rounded-lg border border-slate-300 px-3 py-2"
                          />
                        </label>
                        <div className="rounded-2xl bg-slate-100 p-3 text-xs text-slate-600">
                          Each quarter we increase allocations by approximately {((1 / Math.max(1, rolloutPlan.quarters)) * 100).toFixed(1)}%
                          until targets are met.
                        </div>
                      </div>
                    </Card>
                  </section>

                  <section id="profit" className="col-span-1">
                    <Card title="Profit distribution" subtitle="Plan quarterly bonuses and vault sweeps.">
                      <div className="space-y-4 text-sm text-slate-600">
                        <div className="grid gap-3 md:grid-cols-2">
                          <label className="flex flex-col gap-1">
                            <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">Bonus %</span>
                            <input
                              type="number"
                              min={0}
                              max={100}
                              step={1}
                              value={Math.round(profitSettings.bonusPct * 100)}
                              onChange={(e) => setProfitSettings((prev) => ({ ...prev, bonusPct: Number(e.target.value) / 100 }))}
                              className="rounded-lg border border-slate-300 px-3 py-2"
                            />
                          </label>
                          <label className="flex flex-col gap-1">
                            <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">Vault % of remainder</span>
                            <input
                              type="number"
                              min={0}
                              max={100}
                              step={1}
                              value={Math.round(profitSettings.vaultPct * 100)}
                              onChange={(e) => setProfitSettings((prev) => ({ ...prev, vaultPct: Number(e.target.value) / 100 }))}
                              className="rounded-lg border border-slate-300 px-3 py-2"
                            />
                          </label>
                        </div>
                        <label className="flex flex-col gap-1">
                          <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">Next distribution</span>
                          <input
                            type="date"
                            value={profitSettings.nextDistribution}
                            onChange={(e) => setProfitSettings((prev) => ({ ...prev, nextDistribution: e.target.value }))}
                            className="rounded-lg border border-slate-300 px-3 py-2"
                          />
                        </label>
                        <div className="rounded-2xl bg-slate-100 p-3 text-xs text-slate-600">
                          Next distribution scheduled for {profitDistributionLabel}. Remaining funds stay in Profit or sweep to the vault
                          based on your percentages.
                        </div>
                      </div>
                    </Card>
                  </section>

                  <section id="tax" className="col-span-1">
                    <Card title="Tax strategy" subtitle="Estimate quarterly tax needs and vault sweeps.">
                      <div className="space-y-4 text-sm text-slate-600">
                        <div className="flex gap-4">
                          <label className="flex items-center gap-2 text-xs font-semibold text-slate-600">
                            <input
                              type="radio"
                              name="tax-mode"
                              value="calculation"
                              checked={taxSettings.mode === "calculation"}
                              onChange={(e) =>
                                setTaxSettings((prev) => ({ ...prev, mode: e.target.value as "calculation" | "flat" }))
                              }
                            />
                            Calculation
                          </label>
                          <label className="flex items-center gap-2 text-xs font-semibold text-slate-600">
                            <input
                              type="radio"
                              name="tax-mode"
                              value="flat"
                              checked={taxSettings.mode === "flat"}
                              onChange={(e) =>
                                setTaxSettings((prev) => ({ ...prev, mode: e.target.value as "calculation" | "flat" }))
                              }
                            />
                            Flat estimate
                          </label>
                        </div>

                        {taxSettings.mode === "calculation" ? (
                          <div className="grid gap-3 md:grid-cols-2">
                            <label className="flex flex-col gap-1">
                              <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                                Estimated tax rate %
                              </span>
                              <input
                                type="number"
                                min={0}
                                max={100}
                                step={0.5}
                                value={taxSettings.taxRate * 100}
                                onChange={(e) => setTaxSettings((prev) => ({ ...prev, taxRate: Number(e.target.value) / 100 }))}
                                className="rounded-lg border border-slate-300 px-3 py-2"
                              />
                            </label>
                            <label className="flex flex-col gap-1">
                              <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                                Taxes already paid ($)
                              </span>
                              <input
                                type="number"
                                min={0}
                                value={taxSettings.estimatedPaid}
                                onChange={(e) => setTaxSettings((prev) => ({ ...prev, estimatedPaid: Number(e.target.value) }))}
                                className="rounded-lg border border-slate-300 px-3 py-2"
                              />
                            </label>
                          </div>
                        ) : (
                          <label className="flex flex-col gap-1">
                            <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">Annual tax estimate ($)</span>
                            <input
                              type="number"
                              min={0}
                              value={taxSettings.flatAmount}
                              onChange={(e) => setTaxSettings((prev) => ({ ...prev, flatAmount: Number(e.target.value) }))}
                              className="rounded-lg border border-slate-300 px-3 py-2"
                            />
                          </label>
                        )}

                        <label className="flex flex-col gap-1">
                          <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">Vault sweep of excess %</span>
                          <input
                            type="number"
                            min={0}
                            max={100}
                            step={1}
                            value={Math.round(taxSettings.vaultPct * 100)}
                            onChange={(e) => setTaxSettings((prev) => ({ ...prev, vaultPct: Number(e.target.value) / 100 }))}
                            className="rounded-lg border border-slate-300 px-3 py-2"
                          />
                        </label>
                        <div className="rounded-2xl bg-slate-100 p-3 text-xs text-slate-600">{taxSummaryLabel}</div>
                      </div>
                    </Card>
                  </section>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </main>
  );
}

function describeAllocationCadence(settings: {
  cadence: "weekly" | "semi_monthly" | "monthly";
  weekDay: string;
  semiMonthlyDays: number[];
  monthlyDay: number;
}) {
  switch (settings.cadence) {
    case "weekly": {
      const label = capitalize(settings.weekDay);
      return `Weekly on ${label}`;
    }
    case "semi_monthly": {
      const [first, second] = settings.semiMonthlyDays;
      return `10/25 cadence on ${ordinal(first)} & ${ordinal(second || first)}`;
    }
    case "monthly":
    default:
      return `Monthly on the ${ordinal(settings.monthlyDay)}`;
  }
}

function formatLongDate(value?: string) {
  if (!value) return "—";
  const dt = new Date(value);
  if (Number.isNaN(dt.getTime())) return value;
  return dt.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

function capitalize(input: string) {
  if (!input) return "";
  return input.charAt(0).toUpperCase() + input.slice(1);
}

function ordinal(n: number) {
  const s = ["th", "st", "nd", "rd"];
  const v = n % 100;
  return `${n}${s[(v - 20) % 10] || s[v] || s[0]}`;
}
