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
