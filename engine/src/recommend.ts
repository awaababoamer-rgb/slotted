// "Courses that fit your schedule": find courses with sections that fit around
// the student's current week, then rank them by how well they fit and by reviews.
// Pure logic: the website passes in the catalog, the current picks and ratings.

import { buildGroups, type Group } from "./generate";
import { scoreSchedule } from "./score";
import { hasKnownTimes, isAvoided, picksConflict, termsOverlap } from "./time";
import type { Course, Pick, Preferences, Term } from "./types";

/** How many section combinations to try per course (keeps the search fast). */
const MAX_COMBOS = 80;

export interface CourseFit {
  course: Course;
  /** The best sections found: one per component (LEC/LAB/TUT). */
  sections: Pick[];
  /** How much worse your week gets by adding it (lower is better; 0 = no change). */
  addedCost: number;
  /** True if the only sections that fit are full or restricted. */
  usesFullSection: boolean;
}

export type FitResult =
  | { fits: true; fit: CourseFit }
  | { fits: false; reason: "times not available" | "no sections fit" | "already in schedule" };

/** Find the best conflict-free sections of `course` to add to `current`. */
export function fitCourse(course: Course, current: Pick[], prefs: Preferences = {}): FitResult {
  if (current.some((p) => p.courseCode === course.code)) return { fits: false, reason: "already in schedule" };

  const components = [...new Set(course.sections.map((s) => s.component))];
  const slots: Group[][] = [];
  for (const component of components) {
    const sections = course.sections.filter((s) => s.component === component && hasKnownTimes(s));
    if (sections.length === 0) return { fits: false, reason: "times not available" };
    // Only keep section times that don't clash with what you already have.
    const groups = buildGroups(sections).filter(
      (g) => !current.some((p) => picksConflict(p, { courseCode: course.code, term: course.term, section: g.rep })),
    );
    if (groups.length === 0) return { fits: false, reason: "no sections fit" };
    slots.push(groups);
  }

  const baseCost = scoreSchedule(current, prefs).cost;
  let best: { picks: Pick[]; cost: number } | null = null;
  let tried = 0;
  const chosen: Pick[] = [];

  const search = (depth: number): void => {
    if (tried >= MAX_COMBOS) return;
    if (depth === slots.length) {
      tried++;
      const cost = scoreSchedule([...current, ...chosen], prefs).cost;
      if (!best || cost < best.cost) best = { picks: [...chosen], cost };
      return;
    }
    for (const group of slots[depth]) {
      const pick: Pick = { courseCode: course.code, term: course.term, section: group.rep };
      if (chosen.some((c) => picksConflict(c, pick))) continue;
      chosen.push(pick);
      search(depth + 1);
      chosen.pop();
      if (tried >= MAX_COMBOS) return;
    }
  };
  search(0);

  if (!best) return { fits: false, reason: "no sections fit" };
  const found = best as { picks: Pick[]; cost: number };
  return {
    fits: true,
    fit: {
      course,
      sections: found.picks,
      addedCost: Math.max(0, found.cost - baseCost),
      usesFullSection: found.picks.some((p) => isAvoided(p.section)),
    },
  };
}

// ---------------- Ranking with reviews ----------------

export interface CourseRatingSummary {
  review_count: number;
  overall: number; // 1–5
  workload: number; // 1–5
  difficulty: number; // 1–5
  would_take_again_pct: number; // 0–100
}

/**
 * Reviews are pulled toward a neutral 3/5 until there are a few of them
 * (a "Bayesian average"), so one lucky 5-star review doesn't beat ten 4.5s.
 */
export const REVIEW_PRIOR = { value: 3, weight: 3 };

export function adjustedRating(avg: number, count: number): number {
  return (count * avg + REVIEW_PRIOR.weight * REVIEW_PRIOR.value) / (count + REVIEW_PRIOR.weight);
}

export interface RankOptions {
  /** Favour lighter workload and easier courses. */
  preferLighter?: boolean;
}

export interface Recommendation extends CourseFit {
  rating: CourseRatingSummary | null;
  /** Lower is better. */
  rankCost: number;
  /** Short reasons to show, e.g. ["Fits with no extra gaps", "Rated 4.4 by 12 students"]. */
  reasons: string[];
}

/** Rank fitting courses: fit cost, minus a bonus for good (and enough) reviews. */
export function rankCourses(
  fits: CourseFit[],
  ratings: Map<string, CourseRatingSummary>,
  options: RankOptions = {},
): Recommendation[] {
  return fits
    .map((fit) => {
      const rating = ratings.get(fit.course.code) ?? null;
      let bonus = 0;
      const reasons: string[] = [];
      if (fit.addedCost === 0) reasons.push("Fits with no extra gaps");
      if (rating && rating.review_count > 0) {
        const overall = adjustedRating(rating.overall, rating.review_count);
        bonus += (overall - 3) * 60; // each star above average is worth an hour of annoyance
        if (options.preferLighter) {
          bonus += (3 - adjustedRating(rating.workload, rating.review_count)) * 30;
          bonus += (3 - adjustedRating(rating.difficulty, rating.review_count)) * 20;
        }
        reasons.push(`Rated ${rating.overall.toFixed(1)} by ${rating.review_count} student${rating.review_count === 1 ? "" : "s"}`);
      }
      if (fit.usesFullSection) reasons.push("Only full sections fit");
      return { ...fit, rating, rankCost: fit.addedCost - bonus, reasons };
    })
    .sort((a, b) => a.rankCost - b.rankCost || a.course.code.localeCompare(b.course.code));
}

export interface RecommendFilters {
  term: Exclude<Term, "unknown">;
  subject?: string;
  /** "1000", "2000", ... */
  level?: string;
  hideFull?: boolean;
}

/** Every course matching the filters that fits around `current`, best fit first (before reviews). */
export function findFittingCourses(
  catalog: Course[],
  current: Pick[],
  prefs: Preferences,
  filters: RecommendFilters,
): CourseFit[] {
  const results: CourseFit[] = [];
  for (const course of catalog) {
    if (!termsOverlap(course.term, filters.term)) continue;
    if (course.term === "other_session" || course.term === "unknown") continue;
    if (filters.subject && !course.code.startsWith(`${filters.subject} `)) continue;
    if (filters.level && course.code.split(" ")[1]?.[0] !== filters.level[0]) continue;
    const result = fitCourse(course, current, prefs);
    if (!result.fits) continue;
    if (filters.hideFull && result.fit.usesFullSection) continue;
    results.push(result.fit);
  }
  return results.sort((a, b) => a.addedCost - b.addedCost);
}
