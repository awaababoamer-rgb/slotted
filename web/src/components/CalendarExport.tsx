import { useId, useState } from "react";
import { buildIcs, termForDate, termsOverlap, type Pick } from "@slotted/engine";
import type { ClubEvent } from "../data/events";
import { TERM_LABELS } from "../lib/format";

type GridTerm = "first_term" | "second_term";

// Best guesses; students should check Western's official sessional dates.
const DEFAULT_DATES: Record<GridTerm, { start: string; end: string }> = {
  first_term: { start: "2026-09-08", end: "2026-12-08" },
  second_term: { start: "2027-01-06", end: "2027-04-07" },
};

/** Monday–Friday of the week starting on (or containing) `date`. */
function weekdaysOf(date: string): string[] {
  const [y, m, d] = date.split("-").map(Number);
  const start = new Date(Date.UTC(y, m - 1, d));
  start.setUTCDate(start.getUTCDate() - ((start.getUTCDay() + 6) % 7)); // back to Monday
  return Array.from({ length: 5 }, (_, i) => {
    const day = new Date(start);
    day.setUTCDate(start.getUTCDate() + i);
    return day.toISOString().slice(0, 10);
  });
}

function download(filename: string, text: string) {
  const url = URL.createObjectURL(new Blob([text], { type: "text/calendar;charset=utf-8" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

/** "Export to calendar": download this term's classes (and added club events) as an .ics file. */
export function CalendarExport({ picks, term, addedEvents }: { picks: Pick[]; term: GridTerm; addedEvents: ClubEvent[] }) {
  const [open, setOpen] = useState(false);
  const [dates, setDates] = useState(DEFAULT_DATES);
  const [breakWeek, setBreakWeek] = useState<Record<GridTerm, string>>({ first_term: "", second_term: "" });
  const [withEvents, setWithEvents] = useState(true);
  const [done, setDone] = useState<string | null>(null);
  const id = useId();

  const termPicks = picks.filter((p) => termsOverlap(p.term, term) && p.section.meetings.some((m) => m.day));
  const termEvents = addedEvents.filter((e) => termForDate(e.event_date) === term);
  const { start, end } = dates[term];

  function exportNow() {
    const ics = buildIcs(
      termPicks,
      { start, end, skipDates: breakWeek[term] ? weekdaysOf(breakWeek[term]) : [] },
      withEvents
        ? termEvents.map((e) => ({ id: e.id, title: e.title, date: e.event_date, start: e.start_time, end: e.end_time, location: e.location, description: `${e.club_name}${e.description ? `\n${e.description}` : ""}` }))
        : [],
    );
    const label = TERM_LABELS[term].toLowerCase().replace(" ", "-");
    download(`slotted-${label}.ics`, ics);
    setDone(`Downloaded slotted-${label}.ics. Open it, or import it into Google Calendar, Outlook or Apple Calendar.`);
  }

  if (!open) {
    return (
      <button type="button" onClick={() => setOpen(true)} disabled={termPicks.length === 0 && termEvents.length === 0}
        className="inline-flex items-center gap-2 rounded-lg border border-line bg-white px-3 py-2 text-sm font-semibold hover:border-brand-200 hover:text-brand-700 disabled:opacity-50">
        Export to calendar
      </button>
    );
  }

  return (
    <section className="w-full rounded-2xl border border-line bg-white p-4 shadow-sm sm:w-96">
      <div className="flex items-baseline justify-between">
        <h2 className="font-semibold">Export {TERM_LABELS[term]} to your calendar</h2>
        <button type="button" onClick={() => setOpen(false)} className="text-sm text-muted hover:text-ink">Close</button>
      </div>
      <p className="mt-1 text-xs text-muted">
        Classes repeat weekly between these dates. Check them against Western's official sessional dates.
      </p>
      <div className="mt-3 grid grid-cols-2 gap-2 text-sm">
        <label htmlFor={`${id}-start`} className="font-semibold">First day of classes
          <input id={`${id}-start`} type="date" value={start}
            onChange={(e) => setDates({ ...dates, [term]: { start: e.target.value, end } })}
            className="mt-1 block w-full rounded-lg border border-line px-2 py-1 font-normal" />
        </label>
        <label htmlFor={`${id}-end`} className="font-semibold">Last day of classes
          <input id={`${id}-end`} type="date" value={end}
            onChange={(e) => setDates({ ...dates, [term]: { start, end: e.target.value } })}
            className="mt-1 block w-full rounded-lg border border-line px-2 py-1 font-normal" />
        </label>
        <label htmlFor={`${id}-break`} className="col-span-2 font-semibold">Reading week (optional, any day in it)
          <input id={`${id}-break`} type="date" value={breakWeek[term]}
            onChange={(e) => setBreakWeek({ ...breakWeek, [term]: e.target.value })}
            className="mt-1 block w-full rounded-lg border border-line px-2 py-1 font-normal" />
        </label>
      </div>
      {termEvents.length > 0 && (
        <label className="mt-3 flex items-center gap-2 text-sm">
          <input type="checkbox" checked={withEvents} onChange={(e) => setWithEvents(e.target.checked)} className="size-4 accent-brand-700" />
          Include {termEvents.length} club event{termEvents.length === 1 ? "" : "s"} you added
        </label>
      )}
      <button type="button" onClick={exportNow} disabled={!start || !end || end < start}
        className="mt-3 w-full rounded-lg bg-brand-700 px-3 py-2 text-sm font-semibold text-white hover:bg-brand-800 disabled:opacity-50">
        Download .ics file
      </button>
      {done && <p role="status" className="mt-2 text-xs text-good-700">{done}</p>}
      <p className="mt-2 text-xs text-muted">
        Google Calendar: Settings → Import & export → Import. Outlook: Add calendar → Upload from file.
      </p>
    </section>
  );
}
