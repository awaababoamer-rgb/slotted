// Events a student added to their week ("Add to my week"), saved to their account.
// Row-level security: each student only sees and changes their own rows.
// Guests (not signed in) keep their added events in this browser instead.

import { useCallback, useEffect, useMemo, useState } from "react";
import { listEvents, type ClubEvent } from "./events";
import { requireSupabase } from "./supabase";

export function todayISO(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

const GUEST_KEY = "slotted:myEvents:v1:guest";

function guestIds(): Set<string> {
  try {
    return new Set(JSON.parse(window.localStorage.getItem(GUEST_KEY) ?? "[]") as string[]);
  } catch {
    return new Set();
  }
}

function saveGuestIds(ids: Set<string>) {
  try {
    window.localStorage.setItem(GUEST_KEY, JSON.stringify([...ids]));
  } catch {
    // Storage blocked: the change lasts until the page is closed.
  }
}

async function listMyEventIds(userId: string | null): Promise<Set<string>> {
  if (!userId) return guestIds();
  const { data, error } = await requireSupabase().from("my_events").select("event_id");
  if (error) throw new Error(`Couldn't load your events: ${error.message}`);
  return new Set((data ?? []).map((r) => r.event_id as string));
}

/** Upcoming events + which ones the student added, shared by the Builder and Events pages. */
export function useMyEvents(userId: string | null) {
  const [events, setEvents] = useState<ClubEvent[] | null>(null);
  const [addedIds, setAddedIds] = useState<Set<string>>(new Set());
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const [ev, ids] = await Promise.all([listEvents({ fromDate: todayISO() }), listMyEventIds(userId)]);
      setEvents(ev);
      setAddedIds(ids);
    } catch (e) {
      setError((e as Error).message);
    }
  }, [userId]);
  useEffect(() => void refresh(), [refresh]);

  const toggle = useCallback(async (eventId: string) => {
    const adding = !addedIds.has(eventId);
    if (!userId) {
      const next = new Set(addedIds);
      if (adding) next.add(eventId);
      else next.delete(eventId);
      setAddedIds(next);
      saveGuestIds(next);
      return;
    }
    const db = requireSupabase();
    // Update the screen straight away; undo if the database says no.
    setAddedIds((prev) => {
      const next = new Set(prev);
      if (adding) next.add(eventId);
      else next.delete(eventId);
      return next;
    });
    const { error } = adding
      ? await db.from("my_events").insert({ event_id: eventId })
      : await db.from("my_events").delete().eq("event_id", eventId);
    if (error && error.code !== "23505") {
      setError(`Couldn't ${adding ? "add" : "remove"} the event: ${error.message}`);
      await refresh();
    }
  }, [addedIds, refresh, userId]);

  const added = useMemo(() => (events ?? []).filter((e) => addedIds.has(e.id)), [events, addedIds]);

  return { events, addedIds, added, toggle, refresh, error };
}

export type MyEventsApi = ReturnType<typeof useMyEvents>;
