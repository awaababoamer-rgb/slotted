import type { Course } from "@slotted/engine";

// Short names students actually type -> subject codes in the data.
const ALIASES: Record<string, string> = {
  CS: "COMPSCI", COMPSCI: "COMPSCI", STAT: "STATS", STATS: "STATS",
  BIO: "BIOLOGY", BIOL: "BIOLOGY", CHEM: "CHEM", PHYS: "PHYSICS", MATH: "MATH",
  CALC: "CALCULUS", PSYCH: "PSYCHOL", PSYC: "PSYCHOL", ECON: "ECONOMIC", SOC: "SOCIOLOG",
  PHIL: "PHILOSOP", WRIT: "WRITING", HS: "HEALTSCI", KIN: "KINESIOL", BIOCHEM: "BIOCHEM",
  PHYSIO: "PHYSIOL", PHYSIOL: "PHYSIOL",
};

/**
 * Find courses matching what the student typed, best matches first.
 * Accepts "CS 2210B", "cs2210", "2210", "data structures", "COMPSCI 1020A".
 */
export function searchCourses(courses: Course[], query: string, limit = 8): Course[] {
  const q = query.trim().toUpperCase().replace(/\s+/g, " ");
  if (q.length < 2) return [];

  // Split "CS2210B" or "CS 2210B" into subject + number.
  const match = q.match(/^([A-Z]+)\s*(\d{1,4}[A-Z]?)?$/);
  const subject = match ? (ALIASES[match[1]] ?? match[1]) : null;
  const number = match?.[2] ?? (/^\d{1,4}[A-Z]?$/.test(q) ? q : null);

  const scored: { course: Course; rank: number }[] = [];
  for (const course of courses) {
    const [courseSubject, courseNumber] = course.code.split(" ");
    let rank = -1;
    if (subject && match?.[2]) {
      if (courseSubject === subject && courseNumber.startsWith(match[2])) rank = 0;
    } else if (number && /^\d/.test(q)) {
      if (courseNumber.startsWith(number)) rank = 1;
    } else if (subject && courseSubject.startsWith(subject)) {
      rank = 2;
    }
    if (rank === -1 && q.length >= 3 && String(course.title ?? "").toUpperCase().includes(q)) rank = 3;
    if (rank !== -1) scored.push({ course, rank });
  }
  scored.sort((a, b) => a.rank - b.rank || a.course.code.localeCompare(b.course.code));
  return scored.slice(0, limit).map((s) => s.course);
}
