import {
  generateSchedules, isAvoided, scoreSchedule, suggestFixes,
  type Course, type Fix, type Move, type Pick, type Preferences,
} from "@slotted/engine";
import { termStats } from "./fixText";

/** One week to show on the Compare page (a fix, or another conflict-free week). */
export interface WeekOption {
  name: string; // "Fix 1" / "Week 2"
  title: string; // "Only moves labs"
  notes: string[];
  /** Ranked best AND better than what you have now. */
  best: boolean;
  fix: Fix;
}

type GridTerm = "first_term" | "second_term";

const sameTimes = (a: Pick["section"], b: Pick["section"]) =>
  JSON.stringify(a.meetings.map((m) => [m.day, m.start, m.end])) ===
  JSON.stringify(b.meetings.map((m) => [m.day, m.start, m.end]));

/** Turn a generated schedule into a "fix": the list of sections that differ from the current picks. */
function asFix(current: Pick[], schedule: Pick[], prefs: Preferences): Fix {
  const moves: Move[] = [];
  const result = schedule.map((p) => {
    const mine = current.find((c) => c.courseCode === p.courseCode && c.section.component === p.section.component);
    if (!mine || mine.section.class_number === p.section.class_number) return mine ?? p;
    // Same times as what you already have? Keep yours: it isn't a real change.
    if (sameTimes(mine.section, p.section)) return mine;
    moves.push({ courseCode: p.courseCode, component: p.section.component, from: mine.section, to: p.section });
    return p;
  });
  return { moves, label: "", schedule: result, score: scoreSchedule(result, prefs), usesAvoidedSection: false };
}

const COMPONENT_WORDS: Record<string, [string, string]> = {
  LEC: ["lecture", "lectures"], LAB: ["lab", "labs"], TUT: ["tutorial", "tutorials"],
};

/** "Moves 1 lab" / "Moves 2 labs and a tutorial" */
function whatMoves(fix: Fix): string {
  const counts = new Map<string, number>();
  for (const m of fix.moves) counts.set(m.component, (counts.get(m.component) ?? 0) + 1);
  const parts = [...counts.entries()].map(([c, n]) => {
    const [one, many] = COMPONENT_WORDS[c] ?? [c.toLowerCase(), `${c.toLowerCase()}s`];
    return n === 1 ? `1 ${one}` : `${n} ${many}`;
  });
  return `Moves ${parts.join(" and ")}`;
}

const hrs = (h: number) => (Number.isInteger(h) ? `${h}h` : `${h.toFixed(1)}h`);

/** What gets better or worse compared with the current week. */
function changesVsCurrent(fix: Fix, current: Pick[], term: GridTerm): string[] {
  const before = termStats(current, term);
  const after = termStats(fix.schedule, term);
  const notes: string[] = [];
  const gap = after.gapHours - before.gapHours;
  if (gap !== 0) notes.push(gap < 0 ? `${hrs(-gap)} less downtime` : `${hrs(gap)} more downtime`);
  if (after.fridayClasses !== before.fridayClasses) {
    notes.push(after.fridayClasses < before.fridayClasses ? "Lighter Friday" : "Busier Friday");
  }
  if (after.daysOnCampus < before.daysOnCampus) notes.push("Fewer days on campus");
  if (after.latestEnd && before.latestEnd && after.latestEnd !== before.latestEnd) {
    notes.push(after.latestEnd < before.latestEnd ? "Done earlier" : "Done later");
  }
  if (after.earliestStart && before.earliestStart && after.earliestStart > before.earliestStart) notes.push("Later start");
  if (notes.length === 0) notes.push("Same hours, different sections");
  return notes;
}

/**
 * The weeks to compare.
 * - Conflicts now: the Smart Resolve fixes.
 * - No conflicts: up to 3 other conflict-free weeks that keep every course,
 *   each changing different sections where possible.
 */
export function buildWeekOptions(
  courses: Course[],
  current: Pick[],
  prefs: Preferences,
  locked: number[],
  term: GridTerm,
): { kind: "fixes" | "alternatives"; options: WeekOption[]; reason?: string } {
  const strict = { ...prefs, lockedClassNumbers: locked };
  const fixes = suggestFixes(courses, current, strict);

  if (!fixes.alreadyConflictFree) {
    return {
      kind: "fixes",
      reason: fixes.fixes.length === 0 ? fixes.reason : undefined,
      options: fixes.fixes.map((fix, i) => {
        const [title, ...notes] = fix.label.split(" · ");
        return { name: `Fix ${i + 1}`, title, notes, best: i === 0, fix };
      }),
    };
  }

  // Already conflict-free: look for other weeks. Locked sections stay put, and so do
  // lectures if "only move labs and tutorials" is on (same strict rules as fixes).
  const keep = new Set(locked);
  if (prefs.onlyMoveLabsAndTutorials) {
    for (const p of current) if (p.section.component === "LEC") keep.add(p.section.class_number);
  }
  const codes = [...new Set(current.map((p) => p.courseCode))];
  const generated = generateSchedules(courses, codes, { ...prefs, lockedClassNumbers: [...keep] }, { limit: 60 });

  const candidates = generated.schedules
    .map((s) => asFix(current, s.sections, prefs))
    .filter((f) => f.moves.length > 0);

  // Prefer weeks that change different things from each other.
  const picked: Fix[] = [];
  const changeKey = (f: Fix) => f.moves.map((m) => `${m.courseCode}|${m.component}|${m.to.class_number}`).sort().join(",");
  const whatKey = (f: Fix) => f.moves.map((m) => `${m.courseCode}|${m.component}`).sort().join(",");
  for (const f of candidates) {
    if (picked.length >= 3) break;
    if (!picked.some((p) => whatKey(p) === whatKey(f))) picked.push(f);
  }
  for (const f of candidates) {
    if (picked.length >= 3) break;
    if (!picked.some((p) => changeKey(p) === changeKey(f))) picked.push(f);
  }

  const currentCost = scoreSchedule(current, prefs).cost;
  return {
    kind: "alternatives",
    reason: picked.length === 0 ? "No other conflict-free weeks with these courses and rules." : undefined,
    options: picked.map((fix, i) => {
      // Only warn if this week moves you INTO a full or restricted section.
      const usesAvoided = fix.moves.some((m) => isAvoided(m.to));
      const notes = changesVsCurrent(fix, current, term);
      if (usesAvoided) notes.push("Uses a full or restricted section");
      const title = whatMoves(fix);
      return {
        name: `Week ${i + 1}`,
        title,
        notes,
        best: i === 0 && fix.score.cost < currentCost,
        fix: { ...fix, label: title, usesAvoidedSection: usesAvoided },
      };
    }),
  };
}
