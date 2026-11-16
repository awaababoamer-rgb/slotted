// Small helpers for times, terms and sections.

import type { Day, Pick, Section, Term } from "./types";

/** A meeting with times converted to minutes since midnight. */
export interface Block {
  day: Day;
  start: number;
  end: number;
}

/** "09:30" -> 570 */
export function toMinutes(time: string): number {
  const [hours, minutes] = time.split(":").map(Number);
  return hours * 60 + minutes;
}

/** 570 -> "09:30" */
export function toTime(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

/**
 * Can two terms have classes in the same week?
 * First and second term never overlap. Everything else might:
 * full-year courses run in both terms, and for Y/Z courses ("other_session")
 * we don't know the dates, so we play safe and say yes.
 */
export function termsOverlap(a: Term, b: Term): boolean {
  if (a === "first_term" && b === "second_term") return false;
  if (a === "second_term" && b === "first_term") return false;
  return true;
}

/** A section's meetings as blocks. Meetings without a day or time are skipped. */
export function blocksOf(section: Section): Block[] {
  const blocks: Block[] = [];
  for (const m of section.meetings) {
    if (m.day && m.start && m.end) {
      blocks.push({ day: m.day, start: toMinutes(m.start), end: toMinutes(m.end) });
    }
  }
  return blocks;
}

/**
 * Do we know when this section meets?
 * - It has meetings: yes.
 * - No meetings but the data came from DMS: yes, it is an online section
 *   with no fixed time (it can be placed and never conflicts).
 * - No meetings and only public data: NO. Times are not available.
 */
export function hasKnownTimes(section: Section): boolean {
  return blocksOf(section).length > 0 || section.data_source === "dms";
}

const RESTRICTED_NOTE =
  /OPEN WHEN ALL OTHER|CANNOT REGISTER IN ANY OTHER|RESERVED FOR REPEATING STUDENTS/i;

/** Overflow / reserved sections that normal students shouldn't be put in. */
export function isRestricted(section: Section): boolean {
  return RESTRICTED_NOTE.test(section.notes ?? "");
}

/** Sections to avoid unless nothing else works. */
export function isAvoided(section: Section): boolean {
  return section.full || isRestricted(section);
}

/** Two sections with the same signature meet at exactly the same times. */
export function timeSignature(section: Section): string {
  return blocksOf(section)
    .map((b) => `${b.day}${b.start}-${b.end}`)
    .sort()
    .join("|");
}

export function blocksOverlap(a: Block, b: Block): boolean {
  // Back-to-back classes (one ends 10:30, next starts 10:30) do NOT overlap.
  return a.day === b.day && a.start < b.end && b.start < a.end;
}

export function picksConflict(a: Pick, b: Pick): boolean {
  if (!termsOverlap(a.term, b.term)) return false;
  const blocksB = blocksOf(b.section);
  return blocksOf(a.section).some((x) => blocksB.some((y) => blocksOverlap(x, y)));
}

export const DAYS: Day[] = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

export const DAY_NAMES: Record<Day, string> = {
  Mon: "Monday", Tue: "Tuesday", Wed: "Wednesday", Thu: "Thursday",
  Fri: "Friday", Sat: "Saturday", Sun: "Sunday",
};
