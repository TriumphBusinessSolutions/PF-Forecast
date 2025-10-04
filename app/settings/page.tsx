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

type PercentMap = Record<string, string>;

type RolloutRow = {
  quarter: number;
  values: PercentMap;
};

const clampPercent = (value: number) => Math.max(0, Math.min(100, value));

const formatPercentNumber = (value: number) => {
  if (!Number.isFinite(value)) return "";
  const clean = clampPercent(value);
  const rounded = Math.round(clean * 10) / 10;
  if (Math.abs(rounded - Math.round(rounded)) < 0.0001) {
    return String(Math.round(rounded));
  }
  return rounded.toFixed(1).replace(/\.0$/, "");
};

const decimalToPercentString = (decimal?: number | null) => {
  if (decimal === null || decimal === undefined) return "";
  return formatPercentNumber(decimal * 100);
};

const percentStringToDecimal = (value?: string) => {
  if (!value) return 0;
  const num = parseFloat(value);
  return Number.isFinite(num) ? clampPercent(num) / 100 : 0;
};

const percentStringToNumber = (value?: string) => {
  if (!value) return 0;
  const num = parseFloat(value);
  return Number.isFinite(num) ? clampPercent(num) : 0;
};

const generateRolloutRows = (
  current: Record<string, number>,
  target: Record<string, number>,
  quarters: number,
  slugs: string[]
) => {
  const safeQuarters = Math.max(1, quarters);
  const rows: RolloutRow[] = [];
  for (let idx = 1; idx <= safeQuarters; idx += 1) {
    const values: PercentMap = {};
    slugs.forEach((slug) => {
      const currentPct = current[slug] ?? 0;
      const targetPct = target[slug] ?? 0;
      const interpolated = currentPct + ((targetPct - currentPct) * idx) / safeQuarters;
      values[slug] = formatPercentNumber(interpolated);
    });
    rows.push({ quarter: idx, values });
  }
  return rows;
};

const recalcRolloutRows = (
  rows: RolloutRow[],
  changedIndex: number,
  slug: string,
  target: Record<string, number>
) => {
  const total = rows.length;
  if (!rows[changedIndex]) return rows;
  const updated = rows.map((row) => ({
    quarter: row.quarter,
    values: { ...row.values },
  }));
  const changedValue = percentStringToNumber(updated[changedIndex].values[slug]);
  if (!Number.isFinite(changedValue)) return updated;
  const remaining = total - (changedIndex + 1);
  const targetValue = target[slug] ?? changedValue;
  if (remaining <= 0) {
    updated[total - 1].values[slug] = formatPercentNumber(targetValue);
    return updated;
  }
  for (let idx = changedIndex + 1; idx < total; idx += 1) {
    const progress = idx - changedIndex;
    const nextValue = changedValue + ((targetValue - changedValue) * progress) / remaining;
    updated[idx].values[slug] = formatPercentNumber(nextValue);
  }
  updated[total - 1].values[slug] = formatPercentNumber(targetValue);
  return updated;
};

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
  const [allocInputs, setAllocInputs] = useState<PercentMap>({});
  const [currentAllocInputs, setCurrentAllocInputs] = useState<PercentMap>({});
  const [allocDate, setAllocDate] = useState<string>(() => new Date().toISOString().slice(0, 10));

  const [allocationSettings, setAllocationSettings] = useState({
    cadence: "weekly" as "weekly" | "semi_monthly" | "monthly",
    weekDay: "friday",
    semiMonthlyDays: [10, 25],
    monthlyDay: 1,
  });
  const [rolloutPlan, setRolloutPlan] = useState({ quarters: 4 });
  const [rolloutRows, setRolloutRows] = useState<RolloutRow[]>([]);
  const [rolloutHydrated, setRolloutHydrated] = useState(false);
  const [profitSettings, setProfitSettings] = useState({
    bonusPct: "50",
    vaultPct: "50",
    nextDistribution: new Date().toISOString().slice(0, 10),
  });
  const [taxSettings, setTaxSettings] = useState({
    mode: "calculation" as "flat" | "calculation",
    flatAmount: "",
    taxRate: "10",
    estimatedPaid: "",
    vaultPct: "",
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
      const toPercentInput = (value: unknown) => {
        if (value === null || value === undefined) return "";
        if (typeof value === "string") return value;
        if (typeof value === "number") {
          if (value >= 0 && value <= 1) {
            return formatPercentNumber(value * 100);
          }
          return formatPercentNumber(value);
        }
        return "";
      };
      const toText = (value: unknown) => {
        if (value === null || value === undefined) return "";
        return String(value);
      };
      if (parsed.allocationSettings) setAllocationSettings(parsed.allocationSettings);
      if (parsed.rolloutPlan) setRolloutPlan(parsed.rolloutPlan);
      if (parsed.profitSettings) {
        setProfitSettings((prev) => ({
          bonusPct: toPercentInput(parsed.profitSettings.bonusPct ?? prev.bonusPct),
          vaultPct: toPercentInput(parsed.profitSettings.vaultPct ?? prev.vaultPct),
          nextDistribution: parsed.profitSettings.nextDistribution ?? prev.nextDistribution,
        }));
      }
      if (parsed.taxSettings) {
        setTaxSettings((prev) => ({
          mode: parsed.taxSettings.mode ?? prev.mode,
          flatAmount: toText(parsed.taxSettings.flatAmount ?? prev.flatAmount),
          taxRate: toPercentInput(parsed.taxSettings.taxRate ?? prev.taxRate),
          estimatedPaid: toText(parsed.taxSettings.estimatedPaid ?? prev.estimatedPaid),
          vaultPct: toPercentInput(parsed.taxSettings.vaultPct ?? prev.vaultPct),
        }));
      }
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
      const targetMap: PercentMap = {};
      (arows ?? []).forEach((row: any) => {
        targetMap[row.pf_slug] = decimalToPercentString(Number(row.pct));
      });
      setAllocInputs(targetMap);

      let currentMap: PercentMap = {};
      const { data: currentRows, error: currentError } = await client
        .from("allocation_current")
        .select("pf_slug, pct")
        .eq("client_id", id);
      if (currentError) {
        if (currentError.code && currentError.code === "42P01") {
          console.warn("allocation_current table missing; defaulting to targets", currentError);
        } else {
          throw currentError;
        }
      }
      (currentRows ?? []).forEach((row: any) => {
        currentMap[row.pf_slug] = decimalToPercentString(Number(row.pct));
      });
      if (Object.keys(currentMap).length === 0) {
        currentMap = { ...targetMap };
      } else {
        Object.keys(targetMap).forEach((slug) => {
          if (currentMap[slug] === undefined) {
            currentMap[slug] = targetMap[slug];
          }
        });
      }
      setCurrentAllocInputs(currentMap);

      const { data: rolloutData, error: rolloutError } = await client
        .from("allocation_rollout_steps")
        .select("quarter_index, pf_slug, pct")
        .eq("client_id", id)
        .order("quarter_index", { ascending: true })
        .order("pf_slug", { ascending: true });
      if (rolloutError) {
        if (rolloutError.code && rolloutError.code === "42P01") {
          console.warn("allocation_rollout_steps table missing; rollout plan will be generated", rolloutError);
          setRolloutRows([]);
          setRolloutHydrated(false);
        } else {
          throw rolloutError;
        }
      } else if ((rolloutData ?? []).length) {
        const grouped = new Map<number, PercentMap>();
        (rolloutData ?? []).forEach((row: any) => {
          if (!grouped.has(row.quarter_index)) {
            grouped.set(row.quarter_index, {});
          }
          grouped.get(row.quarter_index)![row.pf_slug] = decimalToPercentString(Number(row.pct));
        });
        const allSlugs = Array.from(
          new Set([...Object.keys(targetMap), ...Object.keys(currentMap)])
        );
        const rows: RolloutRow[] = Array.from(grouped.entries())
          .sort((a, b) => a[0] - b[0])
          .map(([quarter, values]) => {
            const filled: PercentMap = {};
            allSlugs.forEach((slug) => {
              filled[slug] = values[slug] ?? targetMap[slug] ?? currentMap[slug] ?? "";
            });
            return { quarter, values: filled };
          });
        setRolloutRows(rows);
        setRolloutPlan({ quarters: rows.length });
        setRolloutHydrated(true);
      } else {
        setRolloutRows([]);
        setRolloutHydrated(false);
      }
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

  const allocationAccounts = useMemo(
    () => displayAccounts.filter((acc) => acc.source !== "derived" && acc.slug !== "income"),
    [displayAccounts]
  );

  const accountSlugs = useMemo(() => allocationAccounts.map((acc) => acc.slug), [allocationAccounts]);

  const targetPercentages = useMemo(() => {
    const map: Record<string, number> = {};
    accountSlugs.forEach((slug) => {
      map[slug] = percentStringToNumber(allocInputs[slug]);
    });
    return map;
  }, [accountSlugs, allocInputs]);

  const currentPercentages = useMemo(() => {
    const map: Record<string, number> = {};
    accountSlugs.forEach((slug) => {
      const source = currentAllocInputs[slug] ?? allocInputs[slug];
      map[slug] = percentStringToNumber(source);
    });
    return map;
  }, [accountSlugs, allocInputs, currentAllocInputs]);

  useEffect(() => {
    if (rolloutHydrated) return;
    if (!allocationAccounts.length) return;
    const generated = generateRolloutRows(currentPercentages, targetPercentages, rolloutPlan.quarters, accountSlugs);
    setRolloutRows(generated);
    setRolloutHydrated(true);
  }, [accountSlugs, allocationAccounts.length, currentPercentages, rolloutHydrated, rolloutPlan.quarters, targetPercentages]);

  const allocTotalPct = accountSlugs.reduce((sum, slug) => sum + targetPercentages[slug], 0);
  const allocOk = Math.abs(allocTotalPct - 100) < 0.1;
  const customAccountsRemaining = Math.max(0, CUSTOM_ACCOUNT_LIMIT - customAccounts.length);

  const currentTotalPct = accountSlugs.reduce(
    (sum, slug) => sum + percentStringToNumber(currentAllocInputs[slug] ?? allocInputs[slug]),
    0
  );
  const currentAllocOk = Math.abs(currentTotalPct - 100) < 0.1;

  const rolloutTotals = rolloutRows.map((row) =>
    accountSlugs.reduce((sum, slug) => sum + percentStringToNumber(row.values[slug]), 0)
  );
  const rolloutValidity = rolloutTotals.map((total) => Math.abs(total - 100) < 0.1);
  const rolloutHasError = rolloutValidity.some((valid) => !valid);

  const handleRolloutCellChange = useCallback(
    (quarterIndex: number, slug: string, value: string) => {
      setRolloutRows((prev) => {
        const next = prev.map((row) => ({
          quarter: row.quarter,
          values: { ...row.values },
        }));
        if (!next[quarterIndex]) return prev;
        next[quarterIndex].values[slug] = value;
        return recalcRolloutRows(next, quarterIndex, slug, targetPercentages);
      });
    },
    [targetPercentages]
  );

  const allocationSummary = describeAllocationCadence(allocationSettings);
  const profitDistributionLabel = formatLongDate(profitSettings.nextDistribution);
  const taxRateDecimal = percentStringToDecimal(taxSettings.taxRate);
  const estimatedPaidNumber = Number(taxSettings.estimatedPaid || 0);
  const flatAmountNumber = Number(taxSettings.flatAmount || 0);
  const taxSummaryLabel =
    taxSettings.mode === "calculation"
      ? `Calculated at ${(taxRateDecimal * 100).toFixed(1)}% less $${estimatedPaidNumber.toLocaleString()} paid`
      : `Flat $${flatAmountNumber.toLocaleString()} split quarterly`;
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
                        Total: {allocTotalPct.toFixed(1)}%
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
                            <span className="text-xs text-slate-500">{`${allocInputs[account.slug] || "0"}%`}</span>
                          </div>
                          <div className="mt-2 flex items-center gap-2">
                            <input
                              type="number"
                              inputMode="decimal"
                              step={0.1}
                              min={0}
                              max={100}
                              value={allocInputs[account.slug] ?? ""}
                              onChange={(e) =>
                                setAllocInputs((prev) => ({
                                  ...prev,
                                  [account.slug]: e.target.value,
                                }))
                              }
                              className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
                            />
                            {account.source === "custom" && (
                              <button
                                type="button"
                                onClick={async () => {
                                  if (!clientId) return;
                                  if (!supabase) {
                                    alert(
                                      "Supabase is not configured. Add NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY to delete accounts."
                                    );
                                    return;
                                  }
                                  const proceed = confirm(
                                    `Delete custom account "${account.name}"? This will remove its allocations and rollout entries.`
                                  );
                                  if (!proceed) return;
                                  const client = supabase;
                                  try {
                                    const { error: deleteError } = await client
                                      .from("pf_accounts")
                                      .delete()
                                      .eq("client_id", clientId)
                                      .eq("slug", account.slug);
                                    if (deleteError) throw deleteError;
                                    setAccounts((prev) => prev.filter((row) => row.slug !== account.slug));
                                    setAllocInputs((prev) => {
                                      const next = { ...prev };
                                      delete next[account.slug];
                                      return next;
                                    });
                                    setCurrentAllocInputs((prev) => {
                                      const next = { ...prev };
                                      delete next[account.slug];
                                      return next;
                                    });
                                    setRolloutRows((prev) =>
                                      prev.map((row) => ({
                                        quarter: row.quarter,
                                        values: Object.keys(row.values).reduce<PercentMap>((accum, slug) => {
                                          if (slug !== account.slug) {
                                            accum[slug] = row.values[slug];
                                          }
                                          return accum;
                                        }, {}),
                                      }))
                                    );
                                    setRolloutHydrated(false);
                                  } catch (error) {
                                    console.error("Unable to delete custom account", error);
                                    alert("Failed to delete account. Check Supabase policies and try again.");
                                  }
                                }}
                                className="rounded-lg border border-rose-200 px-2 py-2 text-xs font-semibold uppercase tracking-wide text-rose-600 hover:bg-rose-50"
                              >
                                Delete
                              </button>
                            )}
                          </div>
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
                              allocationAccounts.map(async (account) => {
                                const { error: upsertError } = await client
                                  .from("allocation_targets")
                                  .upsert(
                                    {
                                      client_id: clientId,
                                      effective_date: allocDate,
                                      pf_slug: account.slug,
                                      pct: percentStringToDecimal(allocInputs[account.slug]),
                                    },
                                    { onConflict: "client_id, effective_date, pf_slug" }
                                  );
                                if (upsertError) throw upsertError;
                              })
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
                                <div className="flex gap-2">
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
                                    className="w-full rounded-lg border border-slate-300 px-3 py-2"
                                  />
                                  <select
                                    value={day}
                                    onChange={(e) =>
                                      setAllocationSettings((prev) => {
                                        const days = [...prev.semiMonthlyDays];
                                        days[idx] = Number(e.target.value);
                                        return { ...prev, semiMonthlyDays: days };
                                      })
                                    }
                                    className="w-full rounded-lg border border-slate-300 px-3 py-2"
                                  >
                                    {Array.from({ length: 31 }, (_, optionIdx) => optionIdx + 1).map((option) => (
                                      <option key={option} value={option}>
                                        {option}
                                      </option>
                                    ))}
                                  </select>
                                </div>
                              </label>
                            ))}
                          </div>
                        )}

                        {allocationSettings.cadence === "monthly" && (
                          <label className="flex flex-col gap-1">
                            <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">Day of month</span>
                            <div className="flex gap-2">
                              <input
                                type="number"
                                min={1}
                                max={31}
                                value={allocationSettings.monthlyDay}
                                onChange={(e) =>
                                  setAllocationSettings((prev) => ({ ...prev, monthlyDay: Number(e.target.value) }))
                                }
                                className="w-full rounded-lg border border-slate-300 px-3 py-2"
                              />
                              <select
                                value={allocationSettings.monthlyDay}
                                onChange={(e) =>
                                  setAllocationSettings((prev) => ({ ...prev, monthlyDay: Number(e.target.value) }))
                                }
                                className="w-full rounded-lg border border-slate-300 px-3 py-2"
                              >
                                {Array.from({ length: 31 }, (_, optionIdx) => optionIdx + 1).map((option) => (
                                  <option key={option} value={option}>
                                    {option}
                                  </option>
                                ))}
                              </select>
                            </div>
                          </label>
                        )}

                        <div className="rounded-2xl bg-slate-100 p-3 text-xs text-slate-600">{allocationSummary}</div>
                      </div>
                    </Card>
                  </section>

                  <section id="rollout" className="col-span-1">
                    <Card title="Rollout plan" subtitle="Ease into target allocations over several quarters.">
                      <div className="space-y-6 text-sm text-slate-600">
                        <p>
                          Transition from current to target allocations over a defined number of quarters. Adjustments start evenly but you can
                          fine-tune each period.
                        </p>
                        <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
                          <label className="flex flex-col gap-1">
                            <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">Quarters</span>
                            <select
                              value={rolloutPlan.quarters}
                              onChange={(e) => {
                                const next = Number(e.target.value);
                                if (!Number.isFinite(next) || next < 1) return;
                                setRolloutPlan({ quarters: next });
                                const generated = generateRolloutRows(
                                  currentPercentages,
                                  targetPercentages,
                                  next,
                                  accountSlugs
                                );
                                setRolloutRows(generated);
                                setRolloutHydrated(true);
                              }}
                              className="rounded-lg border border-slate-300 px-3 py-2"
                            >
                              {Array.from({ length: 8 }, (_, idx) => idx + 1).map((option) => (
                                <option key={option} value={option}>
                                  {option} {option === 1 ? "quarter" : "quarters"}
                                </option>
                              ))}
                            </select>
                          </label>
                          <div className="flex flex-wrap items-center gap-2">
                            <span
                              className={`rounded-full px-3 py-1 text-xs font-semibold ${
                                currentAllocOk ? "bg-emerald-100 text-emerald-700" : "bg-orange-100 text-orange-700"
                              }`}
                            >
                              Current total: {currentTotalPct.toFixed(1)}%
                            </span>
                            <span
                              className={`rounded-full px-3 py-1 text-xs font-semibold ${
                                rolloutRows.length === 0
                                  ? "bg-slate-100 text-slate-600"
                                  : rolloutHasError
                                  ? "bg-orange-100 text-orange-700"
                                  : "bg-emerald-100 text-emerald-700"
                              }`}
                            >
                              {rolloutRows.length === 0
                                ? "No rollout generated"
                                : rolloutHasError
                                ? "Rollout totals need attention"
                                : "Rollout totals balance at 100%"}
                            </span>
                            <Button
                              onClick={() => {
                                const generated = generateRolloutRows(
                                  currentPercentages,
                                  targetPercentages,
                                  rolloutPlan.quarters,
                                  accountSlugs
                                );
                                setRolloutRows(generated);
                                setRolloutHydrated(true);
                              }}
                            >
                              Recalculate plan
                            </Button>
                          </div>
                        </div>

                        <div className="space-y-2">
                          <div className="flex items-center justify-between">
                            <h3 className="text-sm font-semibold text-slate-700">Current allocation baseline</h3>
                            <span
                              className={`rounded-full px-3 py-1 text-xs font-semibold ${
                                currentAllocOk ? "bg-emerald-100 text-emerald-700" : "bg-orange-100 text-orange-700"
                              }`}
                            >
                              Total: {currentTotalPct.toFixed(1)}%
                            </span>
                          </div>
                          <p className="text-xs text-slate-500">
                            Update the starting percentages for each account, then recalculate to rebuild the rollout plan.
                          </p>
                          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
                            {allocationAccounts.map((account) => (
                              <div key={account.slug} className="rounded-2xl border border-slate-200 bg-white p-3 shadow-sm">
                                <div className="flex items-center justify-between text-sm font-medium text-slate-700">
                                  <span>{account.name}</span>
                                  <span className="text-xs text-slate-500">
                                    {`${currentAllocInputs[account.slug] ?? allocInputs[account.slug] ?? "0"}%`}
                                  </span>
                                </div>
                                <input
                                  type="number"
                                  inputMode="decimal"
                                  step={0.1}
                                  min={0}
                                  max={100}
                                  value={currentAllocInputs[account.slug] ?? ""}
                                  onChange={(e) => {
                                    const value = e.target.value;
                                    setCurrentAllocInputs((prev) => ({ ...prev, [account.slug]: value }));
                                  }}
                                  className="mt-2 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
                                />
                              </div>
                            ))}
                          </div>
                        </div>

                        <div className="space-y-3">
                          <div className="flex items-center justify-between">
                            <h3 className="text-sm font-semibold text-slate-700">Quarterly rollout</h3>
                            {rolloutHasError && (
                              <span className="text-xs font-semibold text-rose-600">
                                Totals must equal 100% each quarter.
                              </span>
                            )}
                          </div>
                          {rolloutRows.length ? (
                            <div className="overflow-x-auto">
                              <table className="min-w-full table-fixed border-separate border-spacing-y-2">
                                <thead>
                                  <tr>
                                    <th className="px-3 py-2 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">
                                      Account
                                    </th>
                                    {rolloutRows.map((row, idx) => (
                                      <th
                                        key={row.quarter}
                                        className="px-3 py-2 text-center text-xs font-semibold uppercase tracking-wide text-slate-500"
                                      >
                                        Q{idx + 1}
                                      </th>
                                    ))}
                                  </tr>
                                </thead>
                                <tbody>
                                  {allocationAccounts.map((account) => (
                                    <tr key={account.slug}>
                                      <th
                                        scope="row"
                                        className="whitespace-nowrap px-3 py-2 text-left text-sm font-medium text-slate-700"
                                      >
                                        {account.name}
                                      </th>
                                      {rolloutRows.map((row, rowIdx) => (
                                        <td key={`${account.slug}-${row.quarter}`} className="px-3 py-2">
                                          <input
                                            type="number"
                                            inputMode="decimal"
                                            step={0.1}
                                            min={0}
                                            max={100}
                                            value={row.values[account.slug] ?? ""}
                                            onChange={(e) => handleRolloutCellChange(rowIdx, account.slug, e.target.value)}
                                            className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
                                          />
                                        </td>
                                      ))}
                                    </tr>
                                  ))}
                                </tbody>
                                <tfoot>
                                  <tr>
                                    <th className="px-3 py-2 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">
                                      Totals
                                    </th>
                                    {rolloutRows.map((row, idx) => (
                                      <td key={`total-${row.quarter}`} className="px-3 py-2 text-center">
                                        <div
                                          className={`inline-flex items-center justify-center gap-1 rounded-lg border px-2 py-1 text-xs font-semibold ${
                                            rolloutValidity[idx]
                                              ? "border-emerald-200 bg-emerald-50 text-emerald-700"
                                              : "border-rose-200 bg-rose-50 text-rose-600"
                                          }`}
                                        >
                                          {rolloutTotals[idx].toFixed(1)}%
                                          {rolloutValidity[idx] ? "✔" : "!"}
                                        </div>
                                      </td>
                                    ))}
                                  </tr>
                                </tfoot>
                              </table>
                            </div>
                          ) : (
                            <div className="rounded-2xl border border-dashed border-slate-300 px-4 py-6 text-center text-xs text-slate-500">
                              Configure quarters to generate a rollout plan.
                            </div>
                          )}
                        </div>

                        <div className="flex flex-wrap items-center gap-3">
                          <Button
                            disabled={!clientId || !currentAllocOk || rolloutHasError}
                            onClick={async () => {
                              if (!clientId || !supabase) {
                                alert(
                                  "Supabase is not configured. Add NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY to save the rollout plan."
                                );
                                return;
                              }
                              if (!currentAllocOk) {
                                alert("Current allocations must total 100% before saving the rollout plan.");
                                return;
                              }
                              if (rolloutHasError) {
                                alert("Each quarter must total 100% before saving.");
                                return;
                              }
                              const client = supabase;
                              try {
                                const { error: currentError } = await client
                                  .from("allocation_current")
                                  .upsert(
                                    accountSlugs.map((slug) => ({
                                      client_id: clientId,
                                      pf_slug: slug,
                                      pct: percentStringToDecimal(currentAllocInputs[slug] ?? allocInputs[slug]),
                                    })),
                                    { onConflict: "client_id,pf_slug" }
                                  );
                                if (currentError) throw currentError;

                                const { error: deleteError } = await client
                                  .from("allocation_rollout_steps")
                                  .delete()
                                  .eq("client_id", clientId);
                                if (deleteError) throw deleteError;

                                if (rolloutRows.length) {
                                  const { error: insertError } = await client
                                    .from("allocation_rollout_steps")
                                    .insert(
                                      rolloutRows.flatMap((row, idx) =>
                                        accountSlugs.map((slug) => ({
                                          client_id: clientId,
                                          quarter_index: idx + 1,
                                          pf_slug: slug,
                                          pct: percentStringToDecimal(row.values[slug]),
                                        }))
                                      )
                                    );
                                  if (insertError) throw insertError;
                                }

                                alert("Rollout plan saved.");
                              } catch (error: any) {
                                console.error("Unable to save rollout plan", error);
                                if (error?.code === "42P01") {
                                  alert(
                                    "Run the latest Supabase migration to add allocation_current and allocation_rollout_steps tables."
                                  );
                                } else {
                                  alert("Failed to save rollout plan. Check Supabase policies and try again.");
                                }
                              }
                            }}
                            className={`border-blue-600 bg-blue-600 text-white hover:bg-blue-500 ${
                              !clientId || !currentAllocOk || rolloutHasError ? "cursor-not-allowed opacity-60" : ""
                            }`}
                          >
                            Save rollout plan
                          </Button>
                          <Button onClick={() => clientId && loadClientData(clientId)}>Refresh rollout data</Button>
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
                              value={profitSettings.bonusPct}
                              onChange={(e) =>
                                setProfitSettings((prev) => ({ ...prev, bonusPct: e.target.value }))
                              }
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
                              value={profitSettings.vaultPct}
                              onChange={(e) =>
                                setProfitSettings((prev) => ({ ...prev, vaultPct: e.target.value }))
                              }
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
                                value={taxSettings.taxRate}
                                onChange={(e) =>
                                  setTaxSettings((prev) => ({ ...prev, taxRate: e.target.value }))
                                }
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
                                onChange={(e) =>
                                  setTaxSettings((prev) => ({ ...prev, estimatedPaid: e.target.value }))
                                }
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
                              onChange={(e) =>
                                setTaxSettings((prev) => ({ ...prev, flatAmount: e.target.value }))
                              }
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
                            value={taxSettings.vaultPct}
                            onChange={(e) =>
                              setTaxSettings((prev) => ({ ...prev, vaultPct: e.target.value }))
                            }
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
