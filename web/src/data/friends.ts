// Friends and shared timetables. The database enforces the privacy rules:
// requests by friend code only, nothing shared until accepted, and sharing
// your timetable is a separate opt-in that only accepted friends can read.

import { useCallback, useEffect, useState } from "react";
import type { CourseChoice } from "../state/useSchedule";
import { requireSupabase } from "./supabase";

export interface Friend {
  friendship_id: string;
  friend_id: string;
  email: string;
  status: "pending" | "accepted";
  incoming: boolean; // they asked you
  sharing: boolean; // they share their timetable (accepted friends only)
}

export async function myFriendCode(userId: string): Promise<string> {
  const { data, error } = await requireSupabase().from("profiles").select("friend_code").eq("user_id", userId).single();
  if (error) throw new Error(`Couldn't load your friend code: ${error.message}`);
  return (data.friend_code as string) ?? "";
}

export async function listFriends(): Promise<Friend[]> {
  const { data, error } = await requireSupabase().rpc("my_friends");
  if (error) throw new Error(`Couldn't load friends: ${error.message}`);
  return (data ?? []) as Friend[];
}

export async function addFriend(code: string): Promise<void> {
  const { error } = await requireSupabase().rpc("add_friend", { code: code.trim().toUpperCase() });
  if (error) throw new Error(error.message);
}

export async function acceptFriend(friendshipId: string): Promise<void> {
  const { error } = await requireSupabase().from("friendships").update({ status: "accepted" }).eq("id", friendshipId);
  if (error) throw new Error(`Couldn't accept: ${error.message}`);
}

export async function removeFriend(friendshipId: string): Promise<void> {
  const { error } = await requireSupabase().from("friendships").delete().eq("id", friendshipId);
  if (error) throw new Error(`Couldn't remove: ${error.message}`);
}

// ---- Sharing your timetable ----

export interface SharedChoice {
  code: string;
  picks: Record<string, number>;
}

export async function amISharing(userId: string): Promise<boolean> {
  const { data, error } = await requireSupabase().from("shared_schedules").select("user_id").eq("user_id", userId).maybeSingle();
  if (error) throw new Error(error.message);
  return !!data;
}

/** Publish (or refresh) your chosen sections for your friends. */
export async function shareTimetable(choices: CourseChoice[]): Promise<void> {
  const shared: SharedChoice[] = choices.map((c) => ({ code: c.code, picks: c.picks }));
  const { error } = await requireSupabase().from("shared_schedules").upsert({ choices: shared }, { onConflict: "user_id" });
  if (error) throw new Error(`Couldn't share your timetable: ${error.message}`);
}

export async function stopSharing(userId: string): Promise<void> {
  const { error } = await requireSupabase().from("shared_schedules").delete().eq("user_id", userId);
  if (error) throw new Error(error.message);
}

/** A friend's shared sections (the database refuses unless you're accepted friends). */
export async function friendTimetable(friendId: string): Promise<SharedChoice[] | null> {
  const { data, error } = await requireSupabase().from("shared_schedules").select("choices").eq("user_id", friendId).maybeSingle();
  if (error) throw new Error(error.message);
  return data ? (data.choices as SharedChoice[]) : null;
}


/**
 * Whether you share your timetable, kept in sync: while sharing is on, any
 * change to your courses is re-published (a second after you stop editing).
 */
export function useSharing(userId: string, choices: CourseChoice[]) {
  const [sharing, setSharingState] = useState<boolean | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    amISharing(userId).then(setSharingState).catch(() => setSharingState(false));
  }, [userId]);

  useEffect(() => {
    if (!sharing) return;
    const t = window.setTimeout(() => {
      shareTimetable(choices).catch((e: Error) => setError(e.message));
    }, 1000);
    return () => window.clearTimeout(t);
  }, [sharing, choices]);

  const setSharing = useCallback(async (on: boolean) => {
    setError(null);
    try {
      if (on) await shareTimetable(choices);
      else await stopSharing(userId);
      setSharingState(on);
    } catch (e) {
      setError((e as Error).message);
    }
  }, [choices, userId]);

  return { sharing, setSharing, error };
}

export type SharingApi = ReturnType<typeof useSharing>;
