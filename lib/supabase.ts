import { createClient, type SupabaseClient } from "@supabase/supabase-js";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

export const isSupabaseConfigured = Boolean(url && anonKey);

let client: SupabaseClient | null = null;

if (isSupabaseConfigured && url && anonKey) {
  client = createClient(url, anonKey);
} else if (typeof window !== "undefined") {
  console.warn(
    "Supabase environment variables are not configured. Dashboard data will be unavailable until NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY are provided."
  );
}

export const supabase = client;
