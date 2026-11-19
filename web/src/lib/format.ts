import type { Day, Meeting, Section, Term } from "@slotted/engine";

/** "13:30" -> "1:30 PM" */
export function formatTime(time: string): string {
  const [h, m] = time.split(":").map(Number);
  const suffix = h >= 12 ? "PM" : "AM";
  const hour = h % 12 === 0 ? 12 : h % 12;
  return `${hour}:${String(m).padStart(2, "0")} ${suffix}`;
}

/** "09:30","10:30" -> "9:30–10:30 AM";  "11:30","12:30" -> "11:30 AM–12:30 PM" */
export function formatRange(start: string, end: string): string {
  const a = formatTime(start);
  const b = formatTime(end);
  if (a.slice(-2) === b.slice(-2)) return `${a.slice(0, -3)}–${b}`;
  return `${a}–${b}`;
}

export const DAY_LONG: Record<Day, string> = {
  Mon: "Monday", Tue: "Tuesday", Wed: "Wednesday", Thu: "Thursday", Fri: "Friday", Sat: "Saturday", Sun: "Sunday",
};

const DAY_ORDER: Day[] =["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

/** Meetings grouped by time: "Tue/Thu 10:30–11:30 AM, Fri 1:30–2:30 PM". */
export function formatMeetings(meetings: Meeting[]): string {
  const groups = new Map<string, Day[]>();
  for (const m of meetings) {
    if (!m.day || !m.start || !m.end) continue;
    const key = `${m.start}|${m.end}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(m.day);
  }
  return [...groups.entries()]
    .sort((a, b) => DAY_ORDER.indexOf(a[1][0]) - DAY_ORDER.indexOf(b[1][0]))
    .map(([key, days]) => {
      const [start, end] = key.split("|");
      return `${days.join("/")} ${formatRange(start, end)}`;
    })
    .join(", ");
}

/** Distinct rooms, e.g. "NSC-1" or "MC-110, UCC-58". Empty rooms become "Room TBA". */
export function formatRooms(meetings: Meeting[]): string {
  const rooms = [...new Set(meetings.filter((m) => m.day).map((m) => m.location || "Room TBA"))];
  return rooms.join(", ");
}

export function sectionLabel(section: Section): string {
  return `${section.component} ${section.section}`;
}

export const TERM_LABELS: Record<"first_term" | "second_term", string> = {
  first_term: "Fall 2026",
  second_term: "Winter 2027",
};

export function termTag(term: Term): string {
  switch (term) {
    case "first_term": return "Fall";
    case "second_term": return "Winter";
    case "full_year": return "Full year";
    case "other_session": return "Term unclear";
    default: return "Term unknown";
  }
}

export function formatDate(iso: string | null): string {
  if (!iso) return "unknown";
  return new Date(iso).toLocaleDateString("en-CA", { year: "numeric", month: "short", day: "numeric" });
}

/** Credits as Western writes them: 0.5, 1.0, 2.25. */
export function formatCredits(n: number): string {
  return Number.isInteger(n * 2) ? n.toFixed(1) : n.toFixed(2);
}

export function plural(n: number, word: string, many = `${word}s`): string {
  return `${n} ${n === 1 ? word : many}`;
}
