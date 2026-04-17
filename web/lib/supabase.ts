/**
 * Browser Supabase client - used only for auth-session reads and public
 * buckets. All sensitive operations (Google API proxy, storage writes) go
 * through the FastAPI server.
 */

"use client";

import { createClient, type SupabaseClient } from "@supabase/supabase-js";

let cached: SupabaseClient | null = null;

export function getSupabaseBrowser(): SupabaseClient {
  if (cached) return cached;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) {
    throw new Error(
      "Supabase env vars not set. Add NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY to web/.env.local",
    );
  }
  cached = createClient(url, key, { auth: { persistSession: true } });
  return cached;
}
