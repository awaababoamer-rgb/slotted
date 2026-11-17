// Clubs: requests from students, approval by admins, and who runs each club.
// Every rule is enforced by the database (row-level security); this file just asks.

import { requireSupabase } from "./supabase";

export const CATEGORIES = ["academic", "social", "sports", "cultural", "career", "other"] as const;
export type Category = (typeof CATEGORIES)[number];
export const CATEGORY_LABELS: Record<Category, string> = {
  academic: "Academic", social: "Social", sports: "Sports", cultural: "Cultural", career: "Career", other: "Other",
};

export type ClubStatus = "pending" | "approved" | "rejected";

export interface Club {
  id: string;
  name: string;
  description: string;
  category: Category;
  status: ClubStatus;
  requested_by: string;
  requester_role: string;
  review_note: string;
  reviewed_at: string | null;
  created_at: string;
}

const COLUMNS = "id,name,description,category,status,requested_by,requester_role,review_note,reviewed_at,created_at";

function friendly(error: { code?: string; message: string }): Error {
  if (error.code === "23505") return new Error("A club with that name already exists (or was already requested).");
  return new Error(error.message);
}

/** Approved clubs everyone can see, plus the caller's own requests. */
export async function listVisibleClubs(): Promise<Club[]> {
  const { data, error } = await requireSupabase().from("clubs").select(COLUMNS).order("name");
  if (error) throw new Error(`Couldn't load clubs: ${error.message}`);
  return (data ?? []) as Club[];
}

export async function requestClub(input: {
  name: string; description: string; category: Category; requester_role: string;
}): Promise<Club> {
  const { data, error } = await requireSupabase()
    .from("clubs")
    .insert({ ...input, name: input.name.trim(), description: input.description.trim(), requester_role: input.requester_role.trim() })
    .select(COLUMNS)
    .single();
  if (error) throw friendly(error);
  return data as Club;
}

/** Clubs the signed-in student is an exec of (and that are approved). */
export async function myExecClubIds(userId: string): Promise<Set<string>> {
  const { data, error } = await requireSupabase().from("club_execs").select("club_id").eq("user_id", userId);
  if (error) throw new Error(`Couldn't load your clubs: ${error.message}`);
  return new Set((data ?? []).map((r) => r.club_id as string));
}

// ---- Admin ----

export interface ClubRequest extends Club {
  requester_email: string | null;
}

/** All clubs (admins only). The database refuses this for non-admins. */
export async function listAllClubs(): Promise<ClubRequest[]> {
  const db = requireSupabase();
  const [{ data: clubs, error }, { data: profiles }] = await Promise.all([
    db.from("clubs").select(COLUMNS).order("created_at", { ascending: false }),
    db.from("profiles").select("user_id,email"),
  ]);
  if (error) throw new Error(`Couldn't load club requests: ${error.message}`);
  const emails = new Map((profiles ?? []).map((p) => [p.user_id as string, p.email as string]));
  return ((clubs ?? []) as Club[]).map((c) => ({ ...c, requester_email: emails.get(c.requested_by) ?? null }));
}

export async function reviewClub(id: string, status: "approved" | "rejected", note: string): Promise<void> {
  const { error } = await requireSupabase()
    .from("clubs")
    .update({ status, review_note: note.trim() })
    .eq("id", id);
  if (error) throw new Error(`Couldn't update the club: ${error.message}`);
}
