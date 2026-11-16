import { findConflicts } from "./conflicts";
import { buildGroups } from "./generate";
import { scoreSchedule } from "./score";
import {
  blocksOf, DAY_NAMES, hasKnownTimes, isAvoided, picksConflict, termsOverlap, timeSignature,
} from "./time";
import type { Course, Day, Fix, FixResult, Move, Pick, Preferences, ScheduleScore } from "./types";

export const MAX_CHANGES_PER_FIX = 3;
export const MAX_FIXES = 3;
const MAX_CANDIDATES = 5000; // safety limit on how many possible fixes we examine

interface Candidate {
  moves: Move[];
  schedule: Pick[];
  score: ScheduleScore;
  /** Which course components move, e.g. "COMPSCI 2208A LAB". Used to keep fixes different. */
  slotKey: string;
  /** Which days the moved sections land on. */
  dayKey: string;
}

/** All ways to choose `size` items from `items`. */
function combinations<T>(items: T[], size: number): T[][] {
  if (size === 0) return [[]];
  const result: T[][] = [];
  items.forEach((item, i) => {
    for (const rest of combinations(items.slice(i + 1), size - 1)) result.push([item, ...rest]);
  });
  return result;
}

function classesOnDay(schedule: Pick[], day: Day): number {
  const count = (term: "first_term" | "second_term") =>
    schedule
      .filter((p) => termsOverlap(p.term, term))
      .reduce((n, p) => n + blocksOf(p.section).filter((b) => b.day === day).length, 0);
  return Math.max(count("first_term"), count("second_term"));
}

function baseLabel(moves: Move[]): string {
  const components = new Set(moves.map((m) => m.component));
  if (!components.has("LEC")) {
    if (components.size === 1 && components.has("LAB")) return "Only moves labs";
    if (components.size === 1 && components.has("TUT")) return "Only moves tutorials";
    return "Only moves labs and tutorials";
  }
  if (components.size === 1) return moves.length === 1 ? "Moves one lecture" : `Moves ${moves.length} lectures`;
  return `Moves ${moves.length} sections, including a lecture`;
}

/** Add what makes each fix stand out compared with the others, e.g. "Fewest gaps, lightest Friday". */
function addLabels(fixes: Fix[], lightDay: Day): void {
  const strictlyBest = (values: number[], i: number) =>
    values.every((v, j) => j === i || values[i] < v);

  const gaps = fixes.map((f) => f.score.overall.gapHours);
  const dayLoad = fixes.map((f) => classesOnDay(f.schedule, lightDay));
  const days = fixes.map((f) => f.score.overall.daysOnCampus);
  // Later start is better, so compare negatives.
  const start = fixes.map((f) => -Number((f.score.overall.earliestStart ?? "00:00").replace(":", "")));

  fixes.forEach((fix, i) => {
    const extras: string[] = [];
    if (fixes.length > 1) {
      if (strictlyBest(gaps, i)) extras.push("fewest gaps");
      if (strictlyBest(dayLoad, i)) extras.push(`lightest ${DAY_NAMES[lightDay]}`);
      if (strictlyBest(days, i)) extras.push("fewest days on campus");
      if (strictlyBest(start, i)) extras.push("latest start");
    }
    let label = baseLabel(fix.moves);
    if (extras.length > 0) {
      const text = extras.slice(0, 2).join(", ");
      label += ` · ${text[0].toUpperCase()}${text.slice(1)}`;
    }
    if (fix.usesAvoidedSection) label += " · Uses a full or restricted section";
    fix.label = label;
  });
}

/**
 * Given a schedule with conflicts, suggest up to 3 fixes that change as few
 * sections as possible (never more than 3 per fix).
 *
 * STRICT rules: locked sections never move, and with onlyMoveLabsAndTutorials
 * lectures never move. Full/restricted sections are only used if no fix
 * exists without them, and such fixes are flagged.
 */
export function suggestFixes(
  catalog: Course[],
  currentSelection: Pick[],
  preferences: Preferences = {},
): FixResult {
  const current = currentSelection;
  const timesNotAvailable = current.filter((p) => !hasKnownTimes(p.section));

  if (findConflicts(current).conflicts.length === 0) {
    return { fixes: [], alreadyConflictFree: true, timesNotAvailable };
  }

  // Which pairs of picks (by position) conflict?
  const conflictPairs: [number, number][] = [];
  for (let i = 0; i < current.length; i++) {
    for (let j = i + 1; j < current.length; j++) {
      if (picksConflict(current[i], current[j])) conflictPairs.push([i, j]);
    }
  }

  const locked = new Set(preferences.lockedClassNumbers ?? []);
  const courseOf = (pick: Pick) => catalog.find((c) => c.code === pick.courseCode);
  const movable = current
    .map((pick, i) => ({ pick, i }))
    .filter(({ pick }) => {
      if (locked.has(pick.section.class_number)) return false;
      if (preferences.onlyMoveLabsAndTutorials && pick.section.component === "LEC") return false;
      return courseOf(pick) !== undefined;
    })
    .map(({ i }) => i);

  const stuck = conflictPairs.find(([a, b]) => !movable.includes(a) && !movable.includes(b));
  if (stuck) {
    const name = (i: number) => `${current[i].courseCode} ${current[i].section.component} ${current[i].section.section}`;
    return {
      fixes: [], alreadyConflictFree: false, timesNotAvailable,
      reason: `${name(stuck[0])} and ${name(stuck[1])} conflict, and neither is allowed to move (locked, or lectures can't move).`,
    };
  }

  /** Other sections this pick could move to (one per distinct time). */
  function alternatives(i: number, allowAvoided: boolean): Pick[] {
    const pick = current[i];
    const sameComponent = courseOf(pick)!.sections.filter(
      (s) =>
        s.component === pick.section.component &&
        s.class_number !== pick.section.class_number &&
        hasKnownTimes(s),
    );
    const ownTimes = timeSignature(pick.section);
    return buildGroups(sameComponent)
      .filter((g) => timeSignature(g.rep) !== ownTimes) // same time = same conflict
      .filter((g) => allowAvoided || !g.avoided)
      .map((g) => ({ courseCode: pick.courseCode, term: pick.term, section: g.rep }));
  }

  function search(allowAvoided: boolean): Candidate[] {
    const candidates: Candidate[] = [];
    const slotKeys = new Set<string>();

    for (let size = 1; size <= MAX_CHANGES_PER_FIX; size++) {
      for (const subset of combinations(movable, size)) {
        // Every conflict needs at least one of its two sections to move.
        if (!conflictPairs.every(([a, b]) => subset.includes(a) || subset.includes(b))) continue;

        const fixed = current.filter((_, i) => !subset.includes(i));
        const options = subset.map((i) =>
          alternatives(i, allowAvoided).filter((alt) => !fixed.some((f) => picksConflict(alt, f))),
        );
        if (options.some((o) => o.length === 0)) continue;

        const chosen: Pick[] = [];
        const tryNext = (depth: number): void => {
          if (candidates.length >= MAX_CANDIDATES) return;
          if (depth === subset.length) {
            const schedule = current.map((p, i) => {
              const at = subset.indexOf(i);
              return at === -1 ? p : chosen[at];
            });
            // Skip fixes with a pointless move (the fix works without it).
            const pointless = subset.some((i) => {
              if (subset.length === 1) return false;
              return !schedule.some((other, j) => j !== i && picksConflict(current[i], other));
            });
            if (pointless) return;
            const moves: Move[] = subset.map((i, at) => ({
              courseCode: current[i].courseCode,
              component: current[i].section.component,
              from: current[i].section,
              to: chosen[at].section,
            }));
            const slotKey = moves.map((m) => `${m.courseCode} ${m.component}`).sort().join(" + ");
            const days = new Set(chosen.flatMap((p) => blocksOf(p.section).map((b) => b.day)));
            slotKeys.add(slotKey);
            candidates.push({
              moves, schedule, slotKey,
              dayKey: [...days].sort().join(","),
              score: scoreSchedule(schedule, preferences),
            });
            return;
          }
          for (const alt of options[depth]) {
            if (chosen.slice(0, depth).some((c) => picksConflict(alt, c))) continue;
            chosen[depth] = alt;
            tryNext(depth + 1);
          }
        };
        tryNext(0);
      }
      // Fewest changes first: only look at bigger fixes if we still need
      // more variety to fill the top 3.
      if (slotKeys.size >= MAX_FIXES) break;
    }
    return candidates;
  }

  let candidates = search(false);
  if (candidates.length === 0) candidates = search(true); // last resort: full/restricted sections
  if (candidates.length === 0) {
    return {
      fixes: [], alreadyConflictFree: false, timesNotAvailable,
      reason: `No fix found within ${MAX_CHANGES_PER_FIX} changes.`,
    };
  }

  candidates.sort((a, b) => a.moves.length - b.moves.length || a.score.cost - b.score.cost);

  // Keep the top 3 meaningfully different:
  // first, fixes that move different course components...
  const picked: Candidate[] = [];
  for (const c of candidates) {
    if (picked.length >= MAX_FIXES) break;
    if (!picked.some((p) => p.slotKey === c.slotKey)) picked.push(c);
  }
  // ...then, if there's room, the same move landing on different days.
  for (const c of candidates) {
    if (picked.length >= MAX_FIXES) break;
    if (picked.includes(c)) continue;
    if (!picked.some((p) => p.slotKey === c.slotKey && p.dayKey === c.dayKey)) picked.push(c);
  }
  picked.sort((a, b) => a.moves.length - b.moves.length || a.score.cost - b.score.cost);

  const fixes: Fix[] = picked.map((c) => ({
    moves: c.moves,
    label: "",
    schedule: c.schedule,
    score: c.score,
    usesAvoidedSection: c.moves.some((m) => isAvoided(m.to)),
  }));
  addLabels(fixes, preferences.lightDay ?? "Fri");

  return { fixes, alreadyConflictFree: false, timesNotAvailable };
}
