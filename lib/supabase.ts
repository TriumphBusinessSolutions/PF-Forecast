import { createClient, type SupabaseClient } from "@supabase/supabase-js";

let cachedClient: SupabaseClient | null = null;
let warnedAboutMissingEnv = false;

export function getSupabaseClient(): SupabaseClient | null {
  if (cachedClient) return cachedClient;

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!url || !anonKey) {
    if (!warnedAboutMissingEnv) {
      warnedAboutMissingEnv = true;
      if (process.env.NODE_ENV !== "production") {
        console.warn(
          "Supabase environment variables are not configured. Set NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY to enable data access.",
        );
      }
    }
    return null;
  }

  cachedClient = createClient(url, anonKey);
  return cachedClient;
}
