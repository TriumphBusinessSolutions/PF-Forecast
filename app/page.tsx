"use client";

import React, { useMemo, useState, useEffect } from "react";
import type { Session } from "@supabase/supabase-js";
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

const Button: React.FC<React.ButtonHTMLAttributes<HTMLButtonElement>> = ({
  className = "",
  disabled,
  ...p
}) => (
  <button
    {...p}
    disabled={disabled}
    className={`px-3 py-2 rounded-lg text-sm font-medium border border-slate-300 transition-colors ${
      disabled ? "opacity-60 cursor-not-allowed bg-slate-100" : "bg-white hover:bg-slate-50"
    } ${className}`}
  />
);

const AppScaffold: React.FC<React.PropsWithChildren> = ({ children }) => (
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
    {children}
  </main>
);

const AuthView: React.FC = () => {
  const [mode, setMode] = useState<"sign-in" | "sign-up">("sign-in");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<{ type: "error" | "success"; text: string } | null>(null);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setMessage(null);
    setLoading(true);
    try {
      if (mode === "sign-in") {
        const { error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) throw error;
      } else {
        const { error } = await supabase.auth.signUp({ email, password });
        if (error) throw error;
        setMessage({
          type: "success",
          text: "Check your email to confirm your account before signing in.",
        });
      }
    } catch (err) {
      const text = err instanceof Error ? err.message : "Something went wrong. Please try again.";
      setMessage({ type: "error", text });
    } finally {
      setLoading(false);
    }
  }

  const switchMode = (nextMode: "sign-in" | "sign-up") => {
    setMode(nextMode);
    setMessage(null);
  };

  return (
    <div className="relative flex min-h-screen items-center justify-center overflow-hidden bg-slate-950 px-6 py-16">
      <div className="pointer-events-none absolute inset-0">
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_top,_rgba(37,99,235,0.35),_transparent_60%)]" />
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_bottom,_rgba(16,185,129,0.25),_transparent_55%)]" />
        <div className="absolute inset-0 bg-[linear-gradient(120deg,_rgba(148,163,184,0.18)_1px,_transparent_0)] bg-[length:40px_40px] opacity-20" />
        <svg
          viewBox="0 0 600 400"
          className="absolute -right-24 top-16 w-[520px] text-sky-400/35"
          aria-hidden="true"
        >
          <path
            d="M0 320L60 260L120 280L180 210L240 240L300 150L360 210L420 120L480 190L540 110L600 160"
            fill="none"
            stroke="currentColor"
            strokeWidth="8"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          {[60, 120, 180, 240, 300, 360, 420, 480, 540].map((x, i) => (
            <g key={x}>
              <rect
                x={x - 6}
                y={i % 2 === 0 ? 200 : 140}
                width="12"
                height={i % 2 === 0 ? 90 : 120}
                rx="3"
                fill="currentColor"
                opacity="0.4"
              />
              <circle cx={x} cy={i % 2 === 0 ? 260 : 150} r="7" fill="currentColor" />
            </g>
          ))}
        </svg>
        <div className="absolute -left-20 top-12 h-64 w-64 rounded-full bg-emerald-500/30 blur-3xl" />
        <div className="absolute bottom-0 left-1/2 h-48 w-[140%] -translate-x-1/2 bg-gradient-to-t from-slate-950 via-slate-950/40 to-transparent" />
      </div>

      <div className="relative z-10 w-full max-w-lg">
        <div className="rounded-[32px] border border-white/20 bg-white/90 p-10 text-slate-900 shadow-[0_40px_90px_-30px_rgba(15,23,42,0.85)] backdrop-blur-xl">
          <div className="space-y-3 text-center">
            <p className="text-xs font-semibold uppercase tracking-[0.45em] text-slate-500">Profit First Forecast</p>
            <h1 className="text-3xl font-semibold text-slate-900">
              {mode === "sign-in" ? "Welcome back" : "Create your account"}
            </h1>
            <p className="text-sm text-slate-600">
              {mode === "sign-in"
                ? "Sign in to review client performance and update allocations."
                : "Set up your workspace so you can start onboarding clients."}
            </p>
          </div>

          <form className="mt-8 space-y-5" onSubmit={handleSubmit}>
            <div className="space-y-2">
              <label htmlFor="authEmail" className="text-sm font-medium text-slate-700">
                Email
              </label>
              <input
                id="authEmail"
                type="email"
                required
                autoComplete="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="w-full rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-800 shadow-sm focus:border-sky-400 focus:outline-none focus:ring-2 focus:ring-sky-200"
              />
            </div>
            <div className="space-y-2">
              <label htmlFor="authPassword" className="text-sm font-medium text-slate-700">
                Password
              </label>
              <input
                id="authPassword"
                type="password"
                required
                minLength={6}
                autoComplete={mode === "sign-in" ? "current-password" : "new-password"}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-800 shadow-sm focus:border-sky-400 focus:outline-none focus:ring-2 focus:ring-sky-200"
              />
            </div>
            {message && (
              <p
                className={`text-sm ${
                  message.type === "error" ? "text-red-600" : "text-emerald-600"
                }`}
              >
                {message.text}
              </p>
            )}
            <Button
              type="submit"
              disabled={loading}
              className="mt-2 w-full !rounded-xl !border-transparent !bg-sky-500 !py-3 !text-base !font-semibold !text-white hover:!bg-sky-600"
            >
              {loading ? "Working..." : mode === "sign-in" ? "Sign in" : "Create account"}
            </Button>
            <p className="text-center text-sm text-slate-500">
              {mode === "sign-in" ? (
                <>
                  Don&apos;t have an account?{" "}
                  <button
                    type="button"
                    onClick={() => switchMode("sign-up")}
                    className="font-medium text-sky-600 hover:text-sky-700"
                  >
                    Sign up
                  </button>
                </>
              ) : (
                <>
                  Already have an account?{" "}
                  <button
                    type="button"
                    onClick={() => switchMode("sign-in")}
                    className="font-medium text-sky-600 hover:text-sky-700"
                  >
                    Sign in
                  </button>
                </>
              )}
            </p>
          </form>
        </div>
      </div>
    </div>
  );
};

type ClientSelectorProps = {
  clients: ClientRow[];
  loading: boolean;
  error: string | null;
  onSelect: (clientId: string) => void;
  onCreate: (name: string) => Promise<ClientRow>;
  onSignOut: () => Promise<void> | void;
  userEmail?: string | null;
};

const ClientSelector: React.FC<ClientSelectorProps> = ({
  clients,
  loading,
  error,
  onSelect,
  onCreate,
  onSignOut,
  userEmail,
}) => {
  const [newName, setNewName] = useState("");
  const [creating, setCreating] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const trimmed = newName.trim();
    if (!trimmed) {
      setLocalError("Please enter a client name.");
      return;
    }
    setCreating(true);
    setLocalError(null);
    try {
      const created = await onCreate(trimmed);
      setNewName("");
      onSelect(created.id);
    } catch (err) {
      const text = err instanceof Error ? err.message : "Unable to create client.";
      setLocalError(text);
    } finally {
      setCreating(false);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center px-4 py-12">
      <div className="w-full max-w-2xl space-y-6">
        <Card title="Select a client workspace">
          <div className="space-y-4">
            <p className="text-sm text-slate-600">
              Choose an existing client or add a new one to start forecasting.
            </p>
            {loading ? (
              <p className="text-sm text-slate-500">Loading clients...</p>
            ) : clients.length ? (
              <ul className="space-y-2">
                {clients.map((client) => (
                  <li key={client.id}>
                    <Button
                      type="button"
                      onClick={() => onSelect(client.id)}
                      className="flex w-full items-center justify-between text-left"
                    >
                      <span className="font-medium text-slate-800">{client.name}</span>
                      <span className="text-xs text-slate-500">Open</span>
                    </Button>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-slate-500">
                You don&apos;t have any clients yet. Add one below to get started.
              </p>
            )}
            {error && <p className="text-sm text-red-600">{error}</p>}
          </div>
        </Card>
        <Card title="Add a new client">
          <form className="space-y-4" onSubmit={handleSubmit}>
            <div className="space-y-1">
              <label htmlFor="newClientName" className="text-sm font-medium text-slate-700">
                Client name
              </label>
              <input
                id="newClientName"
                type="text"
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                placeholder="e.g. Acme Agency"
              />
            </div>
            {localError && <p className="text-sm text-red-600">{localError}</p>}
            <div className="flex flex-col gap-3 md:flex-row md:items-center">
              <Button
                type="submit"
                disabled={creating}
                className="!bg-[#004aad] !text-white !border-[#004aad] hover:!bg-[#003b8a]"
              >
                {creating ? "Creating..." : "Add client"}
              </Button>
              <p className="text-xs text-slate-500">
                Subscription-based client limits are coming soon. All plans are unlimited during preview.
              </p>
            </div>
          </form>
        </Card>
        <div className="text-center text-sm text-slate-500">
          <p>
            Signed in as{" "}
            <span className="font-medium text-slate-700">{userEmail ?? "unknown user"}</span>.
          </p>
          <div className="mt-3">
            <Button type="button" onClick={onSignOut}>
              Sign out
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
};

// ------------------ page ------------------
export default function Page() {
  // auth
  const [session, setSession] = useState<Session | null>(null);
  const [checkingSession, setCheckingSession] = useState(true);

  // clients
  const [clients, setClients] = useState<ClientRow[]>([]);
  const [clientId, setClientId] = useState<string | null>(null);
  const [clientsLoading, setClientsLoading] = useState(false);
  const [clientsError, setClientsError] = useState<string | null>(null);

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

  // ------------ auth & client bootstrap ------------
  useEffect(() => {
    let active = true;
    supabase.auth.getSession().then(({ data }) => {
      if (!active) return;
      setSession(data.session);
      setCheckingSession(false);
    });
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      if (!active) return;
      setSession(nextSession);
      setCheckingSession(false);
    });
    return () => {
      active = false;
      subscription.unsubscribe();
    };
  }, []);

  useEffect(() => {
    if (!session) {
      setClientId(null);
      setClients([]);
      setClientsError(null);
      setClientsLoading(false);
    }
  }, [session]);

  useEffect(() => {
    if (!session?.user?.id) return;
    let active = true;
    setClientsLoading(true);
    setClientsError(null);
    setClientId(null);
    const loadClients = async () => {
      try {
        const { data, error } = await supabase.from("clients").select("id, name").order("created_at");
        if (!active) return;
        if (error) {
          setClients([]);
          setClientsError("Unable to load clients. Please check your access permissions.");
        } else {
          setClients(data ?? []);
        }
      } catch (_err) {
        if (!active) return;
        setClients([]);
        setClientsError("Unable to load clients. Please check your access permissions.");
      } finally {
        if (active) setClientsLoading(false);
      }
    };
    loadClients();
    return () => {
      active = false;
    };
  }, [session?.user?.id]);

  async function handleCreateClient(name: string): Promise<ClientRow> {
    if (!session) {
      throw new Error("You must be signed in to create clients.");
    }
    const trimmed = name.trim();
    if (!trimmed) {
      throw new Error("Client name is required.");
    }
    const ownerId = session.user?.id;
    if (!ownerId) {
      throw new Error("Unable to determine the current user. Please sign in again.");
    }
    const { data, error } = await supabase
      .from("clients")
      .insert({ name: trimmed, owner_id: ownerId })
      .select()
      .single();
    if (error || !data) {
      throw new Error(error?.message ?? "Could not add client. Check your access policies.");
    }
    const clientRow = data as ClientRow;
    setClients((prev) => {
      const withoutNew = prev.filter((c) => c.id !== clientRow.id);
      return [...withoutNew, clientRow];
    });
    const coreAccounts = [
      { slug: "operating", name: "Operating", sort_order: 10, color: "#64748b" },
      { slug: "profit", name: "Profit", sort_order: 20, color: "#fa9100" },
      { slug: "owners_pay", name: "Owner's Pay", sort_order: 30, color: "#10b981" },
      { slug: "tax", name: "Tax", sort_order: 40, color: "#ef4444" },
      { slug: "vault", name: "Vault", sort_order: 50, color: "#8b5cf6" },
    ];
    try {
      await supabase
        .from("pf_accounts")
        .insert(coreAccounts.map((acc) => ({ client_id: clientRow.id, ...acc })));
    } catch (seedError) {
      console.error("Failed to seed default PF accounts", seedError);
    }
    return clientRow;
  }

  // ------------ load data for a client ------------
  useEffect(() => {
    if (!clientId || !session) return;
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

  const metadataEmail = session?.user?.user_metadata?.email;
  const userEmail = session?.user?.email ?? (typeof metadataEmail === "string" ? metadataEmail : null);

  async function handleSignOut() {
    await supabase.auth.signOut();
  }

  return (
    <AppScaffold>
      {checkingSession ? (
        <div className="flex min-h-screen items-center justify-center px-4 py-12">
          <p className="text-sm text-slate-500">Checking your session…</p>
        </div>
      ) : !session ? (
        <AuthView />
      ) : !clientId ? (
        <ClientSelector
          clients={clients}
          loading={clientsLoading}
          error={clientsError}
          onSelect={(id) => setClientId(id)}
          onCreate={handleCreateClient}
          onSignOut={handleSignOut}
          userEmail={userEmail}
        />
      ) : (
        <div className="max-w-[1200px] mx-auto px-4 py-4">
          {/* top bar */}
          <div className="mb-2 flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-3">
              <select
                value={clientId ?? ""}
                onChange={(e) => setClientId(e.target.value)}
                className="rounded-lg border border-slate-300 bg-white px-3 py-2"
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
                  try {
                    const created = await handleCreateClient(name);
                    setClientId(created.id);
                  } catch (err) {
                    alert(err instanceof Error ? err.message : "Could not add client. Check policies.");
                  }
                }}
              >
                + Add Client
              </Button>
            </div>

            <div className="flex items-center gap-3 text-sm text-slate-600">
              {userEmail && (
                <span className="hidden sm:inline">
                  Signed in as <span className="font-medium text-slate-800">{userEmail}</span>
                </span>
              )}
              <Button onClick={handleSignOut}>Sign out</Button>
            </div>
          </div>

          {/* controls */}
          <div className="flex flex-wrap items-center gap-2">
            <label className="text-sm text-slate-700">Horizon</label>
            <select
              value={horizon}
              onChange={(e) => setHorizon(Number(e.target.value))}
              className="rounded-md border border-slate-300 bg-white px-2 py-1"
            >
              {[6, 9, 12, 18, 24].map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
            </select>
            <label className="ml-2 text-sm text-slate-700">Start</label>
            <input
              type="month"
              value={startMonth}
              onChange={(e) => setStartMonth(e.target.value)}
              className="rounded-md border border-slate-300 bg-white px-2 py-1"
            />
            <label className="ml-3 text-sm text-slate-700">Mode</label>
            <select
              value={mode}
              onChange={(e) => setMode(e.target.value as any)}
              className="rounded-md border border-slate-300 bg-white px-2 py-1"
            >
              <option value="total">Total balance</option>
              <option value="accounts">Individual accounts</option>
            </select>
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
                        <th key={m} className="whitespace-nowrap px-3 py-2 text-right font-semibold">
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
                              className="cursor-pointer px-3 py-2 text-right"
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
                        <th key={m} className="whitespace-nowrap px-3 py-2 text-right font-semibold">
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
                              className="cursor-pointer px-3 py-2 text-right"
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
              <p className="mt-2 text-xs text-slate-500">
                Beginning balance + Net activity = Ending balance.
              </p>
            </Card>
          </div>

          {/* settings (minimal — allocations only, dynamic) */}
          <div className="mt-6">
            <Card title="Settings — Allocation Targets">
              <div className="mb-3 flex items-center gap-3">
                <span className="text-sm text-slate-700">Effective date</span>
                <input
                  type="date"
                  className="rounded-md border border-slate-300 bg-white px-2 py-1"
                  value={allocDate}
                  onChange={(e) => setAllocDate(e.target.value)}
                />
                <span
                  className={`ml-auto rounded px-2 py-1 text-xs font-semibold ${
                    allocOk ? "bg-emerald-100 text-emerald-700" : "bg-orange-100 text-orange-700"
                  }`}
                >
                  Total: {(allocTotal * 100).toFixed(1)}%
                </span>
              </div>

              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 md:grid-cols-4 lg:grid-cols-5">
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
                      className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2"
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
                  className={`!border-transparent !bg-[${BRAND.blue}] !text-white hover:opacity-90 ${
                    !allocOk ? "opacity-60 cursor-not-allowed" : ""
                  }`}
                >
                  Save Allocations
                </Button>
                <Button
                  className="!border-slate-200"
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

          {/* drill panel */}
          {drill && (
            <div className="fixed inset-0 z-40">
              <div className="absolute inset-0 bg-black/30" onClick={() => setDrill(null)} />
              <div className="absolute right-0 top-0 h-full w-full overflow-y-auto bg-white p-6 shadow-2xl sm:w-[520px]">
                <div className="mb-3 flex items-center justify-between">
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
        </div>
      )}
    </AppScaffold>
  );

}

// -------- helper components / functions --------
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
