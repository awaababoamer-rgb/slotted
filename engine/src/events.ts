// Does a club event fit around the student's classes?
//
//   "fits"       no class meeting overlaps the event
//   "join_late"  a class overlaps, but the event is still running after the
//                class ends, with at least MIN_MINUTES_LEFT to go ("Join from 3:30")
//   "hidden"     fully covered by classes, or under MIN_MINUTES_LEFT left after class
//
// Pure logic, no network: the website passes in the student's chosen sections.

import { blocksOf, termsOverlap, toMinutes, toTime } from "./time";
import type { Day, Pick, Term } from "./types";

export const MIN_MINUTES_LEFT = 30;

export interface EventTime {
  /** "2026-10-05" */
  date: string;
  /** "15:00" (seconds, if present, are ignored) */
  start: string;
  end: string;
}

export type EventFit =
  | { kind: "fits" }
  | { kind: "join_late"; joinFrom: string; minutesLeft: number; clashesWith: Pick[] }
  | { kind: "hidden"; reason: "covered" | "too_little_left"; clashesWith: Pick[] };

const DAYS: Day[] = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"] as unknown as Day[];

/** Which term's classes run on this date (Western's Fall = Sept–Dec, Winter = Jan–Apr). */
export function termForDate(date: string): Exclude<Term, "full_year" | "other_session" | "unknown"> | null {
  const month = Number(date.slice(5, 7));
  if (month >= 9 && month <= 12) return "first_term";
  if (month >= 1 && month <= 4) return "second_term";
  return null; // summer: no fall/winter classes
}

export function weekdayOf(date: string): Day {
  const [y, m, d] = date.split("-").map(Number);
  return DAYS[new Date(y, m - 1, d).getDay()];
}

const hhmm = (t: string) => t.slice(0, 5);

export function classifyEvent(event: EventTime, schedule: Pick[]): EventFit {
  const term = termForDate(event.date);
  if (!term) return { kind: "fits" };
  const day = weekdayOf(event.date);
  const start = toMinutes(hhmm(event.start));
  const end = toMinutes(hhmm(event.end));

  // Class meetings that day, in that term, overlapping the event.
  const overlapping: { pick: Pick; start: number; end: number }[] = [];
  for (const pick of schedule) {
    if (!termsOverlap(pick.term, term)) continue;
    for (const b of blocksOf(pick.section)) {
      if (b.day === day && b.start < end && start < b.end) overlapping.push({ pick, start: b.start, end: b.end });
    }
  }
  if (overlapping.length === 0) return { kind: "fits" };

  const clashesWith = [...new Set(overlapping.map((o) => o.pick))];
  // You can join once your last overlapping class is over.
  const joinFrom = Math.max(...overlapping.map((o) => o.end));
  const minutesLeft = end - joinFrom;
  if (minutesLeft <= 0) return { kind: "hidden", reason: "covered", clashesWith };
  if (minutesLeft < MIN_MINUTES_LEFT) return { kind: "hidden", reason: "too_little_left", clashesWith };
  return { kind: "join_late", joinFrom: toTime(joinFrom), minutesLeft, clashesWith };
}
