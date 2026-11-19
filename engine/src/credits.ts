// Course credits and the per-term credit load.
//
// Western's course codes end in a letter that says how much the course is worth
// and when it runs:
//   none, E      1.0 credit, full year (counted as 0.5 in Fall + 0.5 in Winter)
//   A, F         0.5 credit, Fall          B, G   0.5 credit, Winter
//   Y            0.5 credit, full year (0.25 + 0.25)
//   Z            0.5 credit, outside the regular Fall/Winter terms
//   Q, R         0.25 credit, Fall halves  S, T   0.25 credit, Winter halves
//   U            0.25 credit, outside the regular terms
//   W, X         1.0 credit accelerated (W in Fall, X in Winter)
// When the timetable lists a course's credit value, that number wins.

import type { Course, Preferences } from "./types";

/** A typical full-time term: 2.5 credits (5.0 over Fall + Winter). Students can change it. */
export const DEFAULT_MAX_CREDITS_PER_TERM = 2.5;

type Where = "first_term" | "second_term" | "full_year" | "other_session";

const SUFFIX: Record<string, { credits: number; where: Where }> = {
  "": { credits: 1.0, where: "full_year" },
  E: { credits: 1.0, where: "full_year" },
  A: { credits: 0.5, where: "first_term" },
  F: { credits: 0.5, where: "first_term" },
  B: { credits: 0.5, where: "second_term" },
  G: { credits: 0.5, where: "second_term" },
  Y: { credits: 0.5, where: "full_year" },
  Z: { credits: 0.5, where: "other_session" },
  Q: { credits: 0.25, where: "first_term" },
  R: { credits: 0.25, where: "first_term" },
  S: { credits: 0.25, where: "second_term" },
  T: { credits: 0.25, where: "second_term" },
  U: { credits: 0.25, where: "other_session" },
  W: { credits: 1.0, where: "first_term" },
  X: { credits: 1.0, where: "second_term" },
};

/** "COMPSCI 2210A" -> "A"; "PSYCHOL 1000" -> "" ; anything odd -> null. */
export function codeSuffix(code: string): string | null {
  const m = code.trim().match(/^[A-Z]+\s+\d{4}([A-Z]?)$/);
  return m ? m[1] : null;
}

/** How many credits a course is worth. */
export function courseCredits(course: Course): number {
  // The timetable's own value, when it gives one (e.g. "0.50", "1.50").
  const listed = course.sections
    .map((s) => Number.parseFloat(String(s.credit_units ?? "")))
    .filter((n) => Number.isFinite(n) && n > 0);
  if (listed.length > 0) return Math.max(...listed);
  const suffix = codeSuffix(course.code);
  return suffix !== null && SUFFIX[suffix] ? SUFFIX[suffix].credits : 0.5;
}

export interface TermCredits {
  first_term: number;
  second_term: number;
  /** Courses outside the regular Fall/Winter terms (Z, U). */
  other_session: number;
}

/** Where a course's credits count. Full-year courses count half in each term. */
export function creditSplit(course: Course): TermCredits {
  const credits = courseCredits(course);
  const suffix = codeSuffix(course.code);
  const where: Where = suffix !== null && SUFFIX[suffix]
    ? SUFFIX[suffix].where
    : course.term === "unknown" ? "other_session" : course.term;
  if (where === "full_year") return { first_term: credits / 2, second_term: credits / 2, other_session: 0 };
  if (where === "first_term") return { first_term: credits, second_term: 0, other_session: 0 };
  if (where === "second_term") return { first_term: 0, second_term: credits, other_session: 0 };
  return { first_term: 0, second_term: 0, other_session: credits };
}

/** Total credits per term for a list of courses. */
export function termCredits(courses: Course[]): TermCredits {
  const total: TermCredits = { first_term: 0, second_term: 0, other_session: 0 };
  for (const course of courses) {
    const split = creditSplit(course);
    total.first_term += split.first_term;
    total.second_term += split.second_term;
    total.other_session += split.other_session;
  }
  // Round away floating-point dust (0.1 + 0.2 style).
  for (const key of Object.keys(total) as (keyof TermCredits)[]) total[key] = Math.round(total[key] * 100) / 100;
  return total;
}

export interface CreditCheck {
  limit: number;
  credits: TermCredits;
  /** Fall/Winter terms over the limit, with by how much. */
  over: { term: "first_term" | "second_term"; credits: number; by: number }[];
}

/** Compare each term's credits with the student's limit (default 2.5). */
export function checkCredits(courses: Course[], prefs: Preferences = {}): CreditCheck {
  const limit = prefs.maxCreditsPerTerm ?? DEFAULT_MAX_CREDITS_PER_TERM;
  const credits = termCredits(courses);
  const over = (["first_term", "second_term"] as const)
    .filter((term) => credits[term] > limit + 1e-9)
    .map((term) => ({ term, credits: credits[term], by: Math.round((credits[term] - limit) * 100) / 100 }));
  return { limit, credits, over };
}
