"use client";

import { Suspense, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";

import ImporterTool from "../components/ImporterTool";
import { supabase } from "../../lib/supabase";

type PFAccount = { slug: string; name: string };

type SupabaseAccountRow = { slug: string; name: string };

export default function ImportPage() {
  return (
    <Suspense fallback={<ImportPageSkeleton />}>
      <ImportPageContent />
    </Suspense>
  );
}

function ImportPageContent() {
  const searchParams = useSearchParams();
  const clientId = searchParams.get("clientId");
  const [accounts, setAccounts] = useState<PFAccount[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!clientId) {
      setAccounts([]);
      setError(null);
      setLoading(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    (async () => {
      try {
        const { data, error: queryError } = await supabase
          .from("pf_accounts")
          .select("slug, name")
          .eq("client_id", clientId)
          .order("sort_order", { ascending: true })
          .order("name", { ascending: true });
        if (queryError) throw queryError;
        if (!cancelled) {
          setAccounts((data as SupabaseAccountRow[] | null) ?? []);
          setError(null);
        }
      } catch (err) {
        console.warn("Failed to load Profit First accounts for importer", err);
        if (!cancelled) {
          setError("Could not load client accounts. You can still create new main accounts during import.");
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [clientId]);

  const helperMessage = useMemo(() => {
    if (clientId) return null;
    return "Provide a clientId in the URL query (?clientId=...) to preload that client's Profit First accounts.";
  }, [clientId]);

  return (
    <div className="min-h-screen bg-slate-50">
      <div className="mx-auto max-w-6xl px-4 py-10 space-y-6">
        <header className="space-y-2">
          <p className="text-xs uppercase tracking-[0.2em] text-slate-500">Importer</p>
          <h1 className="text-2xl font-semibold text-slate-900">Import Profit &amp; Loss activity</h1>
          <p className="text-sm text-slate-600 max-w-2xl">
            Upload a cash-basis trailing twelve month Profit &amp; Loss statement. We will detect individual account activity,
            map it to your Profit First buckets, and create editable projections.
          </p>
          {helperMessage && <p className="text-xs text-slate-500">{helperMessage}</p>}
          {clientId && (
            <p className="text-xs text-slate-500">
              Loading Profit First accounts for client <span className="font-medium text-slate-600">{clientId}</span>
              {loading ? "…" : "."}
            </p>
          )}
          {error && <p className="text-xs text-rose-600">{error}</p>}
        </header>

        <ImporterTool accounts={accounts} />
      </div>
    </div>
  );
}

function ImportPageSkeleton() {
  return (
    <div className="min-h-screen bg-slate-50">
      <div className="mx-auto max-w-6xl px-4 py-10">
        <div className="h-6 w-36 animate-pulse rounded bg-slate-200" />
        <div className="mt-4 h-10 w-64 animate-pulse rounded bg-slate-200" />
      </div>
    </div>
  );
}
