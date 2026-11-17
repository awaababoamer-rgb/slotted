// Events a student added to their week ("Add to my week"), saved to their account.
// Row-level security: each student only sees and changes their own rows.

import { useCallback, useEffect, useMemo, useState } from "react";
import { listEvents, type ClubEvent } from "./events";
import { requireSupabase } from "./supabase";

export function todayISO(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

async function listMyEventIds(): Promise<Set<string>> {
  const { data, error } = await requireSupabase().from("my_events").select("event_id");
  if (error) throw new Error(`Couldn't load your events: ${error.message}`);
  return new Set((data ?? []).map((r) => r.event_id as string));
}

/** Upcoming events + which ones the student added, shared by the Builder and Events pages. */
export function useMyEvents() {
  const [events, setEvents] = useState<ClubEvent[] | null>(null);
  const [addedIds, setAddedIds] = useState<Set<string>>(new Set());
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const [ev, ids] = await Promise.all([listEvents({ fromDate: todayISO() }), listMyEventIds()]);
      setEvents(ev);
      setAddedIds(ids);
    } catch (e) {
      setError((e as Error).message);
    }
  }, []);
  useEffect(() => void refresh(), [refresh]);

  const toggle = useCallback(async (eventId: string) => {
    const db = requireSupabase();
    const adding = !addedIds.has(eventId);
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
  }, [addedIds, refresh]);

  const added = useMemo(() => (events ?? []).filter((e) => addedIds.has(e.id)), [events, addedIds]);

  return { events, addedIds, added, toggle, refresh, error };
}

export type MyEventsApi = ReturnType<typeof useMyEvents>;
