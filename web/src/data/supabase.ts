// The one Supabase connection the website uses.
// Values come from web/.env.local (never committed). Only the PUBLISHABLE key belongs here:
// it's safe in a browser because row-level security in the database decides what it can read.

import { createClient, type SupabaseClient } from "@supabase/supabase-js";

const url = import.meta.env.VITE_SUPABASE_URL;
const key = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;

export const supabaseConfigured = Boolean(url && key);

export const supabase: SupabaseClient | null = supabaseConfigured
  ? createClient(url!, key!, {
      // detectSessionInUrl: when a student clicks the sign-in link in their email,
      // Supabase sends them back here with the session in the address; this reads it.
      auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true, flowType: "implicit" },
    })
  : null;

export function requireSupabase(): SupabaseClient {
  if (!supabase) throw new Error("Supabase isn't set up. Add web/.env.local (see web/.env.example).");
  return supabase;
}

/** Supabase returns at most 1000 rows per request, so read big tables page by page. */
export async function fetchAll<T>(table: string, columns: string, orderBy: string): Promise<T[]> {
  const db = requireSupabase();
  const rows: T[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await db.from(table).select(columns).order(orderBy).range(from, from + 999);
    if (error) throw new Error(`Couldn't read ${table}: ${error.message}`);
    rows.push(...((data ?? []) as T[]));
    if (!data || data.length < 1000) return rows;
  }
}
