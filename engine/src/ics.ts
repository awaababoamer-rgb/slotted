// Build an .ics calendar file (Google Calendar, Outlook, Apple Calendar) from a schedule.
// Each class meeting becomes a weekly repeating event between the term's first and
// last day of classes, in Toronto time. Club events are single events.

import type { Day, Pick } from "./types";

export interface IcsTerm {
  /** First day of classes, "2026-09-08" */
  start: string;
  /** Last day of classes, "2026-12-08" */
  end: string;
  /** Optional days with no classes (e.g. reading week), "2026-11-02" ... */
  skipDates?: string[];
}

export interface IcsEvent {
  id: string;
  title: string;
  date: string; // "2026-10-05"
  start: string; // "17:00"
  end: string;
  location?: string;
  description?: string;
}

const DAY_INDEX: Record<Day, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
const RRULE_DAY: Record<Day, string> = { Sun: "SU", Mon: "MO", Tue: "TU", Wed: "WE", Thu: "TH", Fri: "FR", Sat: "SA" };

function parseDate(iso: string): Date {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d));
}

function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/** First date on or after `from` that falls on `day`. */
export function firstWeekdayOnOrAfter(from: string, day: Day): string {
  const d = parseDate(from);
  const diff = (DAY_INDEX[day] - d.getUTCDay() + 7) % 7;
  d.setUTCDate(d.getUTCDate() + diff);
  return isoDate(d);
}

const compact = (date: string, time: string) => `${date.replaceAll("-", "")}T${time.slice(0, 5).replace(":", "")}00`;

/** Escape text for .ics (commas, semicolons, backslashes, newlines). */
function esc(text: string): string {
  return text.replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\r?\n/g, "\\n");
}

/** .ics lines must be at most 75 characters; longer ones continue with a leading space. */
function fold(line: string): string {
  if (line.length <= 75) return line;
  const parts: string[] = [];
  for (let i = 0; i < line.length; i += 74) parts.push((i === 0 ? "" : " ") + line.slice(i, i + 74));
  return parts.join("\r\n");
}

const TORONTO = [
  "BEGIN:VTIMEZONE", "TZID:America/Toronto",
  "BEGIN:DAYLIGHT", "TZOFFSETFROM:-0500", "TZOFFSETTO:-0400", "TZNAME:EDT",
  "DTSTART:19700308T020000", "RRULE:FREQ=YEARLY;BYMONTH=3;BYDAY=2SU", "END:DAYLIGHT",
  "BEGIN:STANDARD", "TZOFFSETFROM:-0400", "TZOFFSETTO:-0500", "TZNAME:EST",
  "DTSTART:19701101T020000", "RRULE:FREQ=YEARLY;BYMONTH=11;BYDAY=1SU", "END:STANDARD",
  "END:VTIMEZONE",
];

export function buildIcs(picks: Pick[], term: IcsTerm, events: IcsEvent[] = [], stamp = new Date()): string {
  const dtstamp = stamp.toISOString().replace(/[-:]/g, "").slice(0, 15) + "Z";
  const lines = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//Slotted//Course schedule//EN", "CALSCALE:GREGORIAN", ...TORONTO];
  const until = `${term.end.replaceAll("-", "")}T235959`;

  for (const pick of picks) {
    const s = pick.section;
    s.meetings.forEach((m, i) => {
      if (!m.day || !m.start || !m.end) return;
      const first = firstWeekdayOnOrAfter(term.start, m.day);
      if (first > term.end) return;
      const skips = (term.skipDates ?? []).filter((d) => parseDate(d).getUTCDay() === DAY_INDEX[m.day!]);
      const who = ((s.instructors as string[] | undefined) ?? []).join(", ");
      lines.push(
        "BEGIN:VEVENT",
        `UID:slotted-${s.class_number}-${i}@slotted`,
        `DTSTAMP:${dtstamp}`,
        `SUMMARY:${esc(`${pick.courseCode} ${s.component} ${s.section}`)}`,
        `DTSTART;TZID=America/Toronto:${compact(first, m.start)}`,
        `DTEND;TZID=America/Toronto:${compact(first, m.end)}`,
        `RRULE:FREQ=WEEKLY;BYDAY=${RRULE_DAY[m.day]};UNTIL=${until}`,
        ...skips.map((d) => `EXDATE;TZID=America/Toronto:${compact(d, m.start!)}`),
        ...(m.location ? [`LOCATION:${esc(m.location)}`] : []),
        `DESCRIPTION:${esc([`Class ${s.class_number}`, who].filter(Boolean).join(" · "))}`,
        "END:VEVENT",
      );
    });
  }

  for (const ev of events) {
    lines.push(
      "BEGIN:VEVENT",
      `UID:slotted-event-${ev.id}@slotted`,
      `DTSTAMP:${dtstamp}`,
      `SUMMARY:${esc(ev.title)}`,
      `DTSTART;TZID=America/Toronto:${compact(ev.date, ev.start)}`,
      `DTEND;TZID=America/Toronto:${compact(ev.date, ev.end)}`,
      ...(ev.location ? [`LOCATION:${esc(ev.location)}`] : []),
      ...(ev.description ? [`DESCRIPTION:${esc(ev.description)}`] : []),
      "END:VEVENT",
    );
  }

  lines.push("END:VCALENDAR");
  return lines.map(fold).join("\r\n") + "\r\n";
}
