// Saved schedules ("Plan A", "Plan B", ...) in Supabase.
// Row-level security in the database makes sure each student only ever sees
// and changes their own rows; the website doesn't have to filter by user.

import { keepUnset, type ScheduleState } from "../state/useSchedule";
import { requireSupabase } from "./supabase";

export interface SavedPlanSummary {
  id: string;
  name: string;
  updated_at: string;
}

export async function listPlans(): Promise<SavedPlanSummary[]> {
  const { data, error } = await requireSupabase()
    .from("saved_schedules")
    .select("id,name,updated_at")
    .order("updated_at", { ascending: false });
  if (error) throw new Error(`Couldn't load your saved plans: ${error.message}`);
  return data ?? [];
}

export async function loadPlan(id: string): Promise<{ id: string; name: string; state: ScheduleState }> {
  const { data, error } = await requireSupabase()
    .from("saved_schedules")
    .select("id,name,choices,locked,prefs")
    .eq("id", id)
    .single();
  if (error) throw new Error(`Couldn't open that plan: ${error.message}`);
  return { id: data.id, name: data.name, state: { choices: data.choices, locked: data.locked, prefs: data.prefs } };
}

function friendly(error: { code?: string; message: string }): Error {
  if (error.code === "23505") return new Error("You already have a plan with that name. Pick another name.");
  return new Error(error.message);
}

/** Save over an existing plan (id given) or create a new one. Returns the plan's id and name. */
export async function savePlan(
  plan: { id?: string; name: string },
  state: ScheduleState,
): Promise<{ id: string; name: string }> {
  const db = requireSupabase();
  // keepUnset: "no preference" choices are saved as null so they survive the round trip.
  const body = { name: plan.name.trim(), choices: state.choices, locked: state.locked, prefs: JSON.parse(JSON.stringify(state.prefs, keepUnset)) };
  const query = plan.id
    ? db.from("saved_schedules").update(body).eq("id", plan.id).select("id,name").single()
    : db.from("saved_schedules").insert(body).select("id,name").single();
  const { data, error } = await query;
  if (error) throw friendly(error);
  return data;
}

export async function deletePlan(id: string): Promise<void> {
  const { error } = await requireSupabase().from("saved_schedules").delete().eq("id", id);
  if (error) throw new Error(`Couldn't delete that plan: ${error.message}`);
}
