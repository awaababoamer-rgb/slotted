// The signed-in student's profile (email + whether they're an admin).
// is_admin can only be changed in the Supabase SQL editor, never from the website.

import { requireSupabase } from "./supabase";

export interface Profile {
  user_id: string;
  email: string;
  is_admin: boolean;
}

export async function loadProfile(userId: string): Promise<Profile> {
  // Admins can see every profile, so ask for this account's row only.
  const { data, error } = await requireSupabase()
    .from("profiles")
    .select("user_id,email,is_admin")
    .eq("user_id", userId)
    .maybeSingle();
  if (error) throw new Error(`Couldn't load your profile: ${error.message}`);
  if (!data) throw new Error("Your profile is missing. Run the latest SQL migration in Supabase.");
  return data;
}
