// Which universities' email addresses can use Slotted.
// The database enforces this list when an account is created; the website
// only uses it to give a friendly message before sending a code.

import { requireSupabase } from "./supabase";

export interface School {
  domain: string;
  school_name: string;
}

export async function listSchools(): Promise<School[]> {
  const { data, error } = await requireSupabase()
    .from("allowed_email_domains")
    .select("domain,school_name")
    .order("school_name");
  if (error) throw new Error(`Couldn't load the list of schools: ${error.message}`);
  return data ?? [];
}

/** Same rule as the database: the exact domain or a subdomain of an allowed one. */
export function emailAllowed(email: string, schools: School[]): boolean {
  const domain = email.trim().toLowerCase().split("@")[1] ?? "";
  if (!/^[^@\s]+@[a-z0-9.-]+$/i.test(email.trim())) return false;
  return schools.some((s) => domain === s.domain || domain.endsWith(`.${s.domain}`));
}

export function schoolFor(email: string, schools: School[]): School | undefined {
  const domain = email.trim().toLowerCase().split("@")[1] ?? "";
  return schools.find((s) => domain === s.domain || domain.endsWith(`.${s.domain}`));
}

export async function addSchool(domain: string, schoolName: string): Promise<void> {
  const clean = domain.trim().toLowerCase().replace(/^@/, "");
  const { error } = await requireSupabase().from("allowed_email_domains").insert({ domain: clean, school_name: schoolName.trim() });
  if (error) {
    if (error.code === "23505") throw new Error(`${clean} is already on the list.`);
    if (error.code === "23514") throw new Error("That doesn't look like an email domain (e.g. uwaterloo.ca).");
    throw new Error(error.message);
  }
}

export async function removeSchool(domain: string): Promise<void> {
  const { data, error } = await requireSupabase().from("allowed_email_domains").delete().eq("domain", domain).select("domain");
  if (error) throw new Error(error.message);
  if (!data || data.length === 0) throw new Error(domain === "uwo.ca" ? "Western can't be removed." : "Only admins can remove schools.");
}
