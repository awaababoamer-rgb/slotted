import { termForDate, termsOverlap, weekdayOf, type Fix, type Pick } from "@slotted/engine";
import type { GridEvent } from "../components/WeekGrid";
import type { ClubEvent } from "../data/events";
import { formatRange } from "./format";

const toMin = (t: string) => {
  const [h, m] = t.slice(0, 5).split(":").map(Number);
  return h * 60 + m;
};

export function shortDate(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(y, m - 1, d).toLocaleDateString("en-CA", { weekday: "short", month: "short", day: "numeric" });
}

/** Added events that fall in the term shown on the grid (Fall = Sept–Dec, Winter = Jan–Apr). */
export function eventsForGrid(events: ClubEvent[], gridTerm: "first_term" | "second_term"): GridEvent[] {
  return events
    .filter((e) => termForDate(e.event_date) === gridTerm)
    .map((e) => ({
      id: e.id,
      day: weekdayOf(e.event_date),
      start: toMin(e.start_time),
      end: toMin(e.end_time),
      title: e.title,
      detail: [shortDate(e.event_date), formatRange(e.start_time, e.end_time), e.location].filter(Boolean).join(" · "),
    }));
}

/**
 * Events never count as conflicts, but if a fix would MOVE a class on top of an
 * event the student added, say so: "Overlaps your event: Hack Night (Thu Oct 8, 5–7 PM)".
 */
export function fixEventWarnings(fix: Fix, added: ClubEvent[], termOf: (courseCode: string) => Pick["term"]): string[] {
  const warnings: string[] = [];
  for (const move of fix.moves) {
    const term = termOf(move.courseCode);
    for (const meeting of move.to.meetings) {
      if (!meeting.day || !meeting.start || !meeting.end) continue;
      const ms = toMin(meeting.start);
      const me = toMin(meeting.end);
      for (const ev of added) {
        const evTerm = termForDate(ev.event_date);
        if (!evTerm || !termsOverlap(term, evTerm)) continue;
        if (weekdayOf(ev.event_date) !== meeting.day) continue;
        if (ms < toMin(ev.end_time) && toMin(ev.start_time) < me) {
          warnings.push(
            `${move.courseCode} ${move.component} would overlap your event: ${ev.title} (${shortDate(ev.event_date)}, ${formatRange(ev.start_time, ev.end_time)})`,
          );
        }
      }
    }
  }
  return [...new Set(warnings)];
}
