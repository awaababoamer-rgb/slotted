// Admin-only reads. The database refuses these for non-admins (row-level security),
// so hiding the Admin tab is only a convenience, not the protection.

import { requireSupabase } from "./supabase";

export interface AdminCounts {
  pendingClubs: number;
  approvedClubs: number;
  openReports: number;
}

async function count(table: string, filter: (q: any) => any): Promise<number> {
  const query = requireSupabase().from(table).select("*", { count: "exact", head: true });
  const { count: n, error } = await filter(query);
  if (error) throw new Error(`Couldn't read ${table}: ${error.message}`);
  return n ?? 0;
}

export async function loadAdminCounts(): Promise<AdminCounts> {
  const [pendingClubs, approvedClubs, openReports] = await Promise.all([
    count("clubs", (q) => q.eq("status", "pending")),
    count("clubs", (q) => q.eq("status", "approved")),
    count("review_reports", (q) => q.is("resolved_at", null)),
  ]);
  return { pendingClubs, approvedClubs, openReports };
}

// ---- Team admins ----

export interface AdminUser {
  user_id: string;
  email: string;
}

export async function listAdmins(): Promise<AdminUser[]> {
  const { data, error } = await requireSupabase()
    .from("profiles")
    .select("user_id,email")
    .eq("is_admin", true)
    .order("email");
  if (error) throw new Error(`Couldn't load admins: ${error.message}`);
  return data ?? [];
}

/** Calls the database function that checks you're an admin before changing anything. */
export async function setAdmin(email: string, makeAdmin: boolean): Promise<void> {
  const { error } = await requireSupabase().rpc("set_admin", { target_email: email.trim(), make_admin: makeAdmin });
  if (error) throw new Error(error.message);
}
