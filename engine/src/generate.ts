import { scoreSchedule } from "./score";
import {
  blocksOf, blocksOverlap, hasKnownTimes, isAvoided, termsOverlap, timeSignature, type Block,
} from "./time";
import type {
  Course, GeneratedSchedule, GenerateOptions, GenerateResult, Pick, Preferences, Section, Term,
  UnplacedCourse,
} from "./types";

/**
 * Sections that meet at exactly the same times. For scheduling they are one
 * choice, which shrinks the search a lot (e.g. 69 biology labs -> far fewer).
 */
export interface Group {
  /** The section we show. A non-full one if the group has any. */
  rep: Section;
  members: Section[];
  blocks: Block[];
  /** True only if every member is full or restricted. */
  avoided: boolean;
}

export function buildGroups(sections: Section[]): Group[] {
  const bySignature = new Map<string, Section[]>();
  for (const section of sections) {
    const key = timeSignature(section);
    if (!bySignature.has(key)) bySignature.set(key, []);
    bySignature.get(key)!.push(section);
  }
  return [...bySignature.values()].map((members) => {
    const rep = members.find((s) => !isAvoided(s)) ?? members[0];
    return { rep, members, blocks: blocksOf(rep), avoided: isAvoided(rep) };
  });
}

/** One thing the student must pick: e.g. "a LAB for COMPSCI 2208A". */
interface Slot {
  index: number;
  courseCode: string;
  term: Term;
  component: string;
  groups: Group[];
}

function groupsClash(a: Group, termA: Term, b: Group, termB: Term): boolean {
  if (!termsOverlap(termA, termB)) return false;
  return a.blocks.some((x) => b.blocks.some((y) => blocksOverlap(x, y)));
}

/**
 * Build conflict-free schedules for a list of course codes, choosing one
 * section of each component (lecture, lab, tutorial) the course has.
 *
 * `catalog` is the course data (from the JSON file today, Supabase later).
 * Courses whose times are not available are listed in `unplaced` and left
 * out of the schedules; they are never treated as free time.
 */
export function generateSchedules(
  catalog: Course[],
  courseCodes: string[],
  preferences: Preferences = {},
  options: GenerateOptions = {},
): GenerateResult {
  const limit = options.limit ?? 200;
  const maxSchedules = options.maxSchedules ?? 20000;
  const locked = new Set(preferences.lockedClassNumbers ?? []);

  const unplaced: UnplacedCourse[] = [];
  const slots: Slot[] = [];

  for (const code of new Set(courseCodes)) {
    const course = catalog.find((c) => c.code === code);
    if (!course) {
      unplaced.push({ courseCode: code, component: null, reason: "course not found" });
      continue;
    }
    const components = [...new Set(course.sections.map((s) => s.component))];
    const courseSlots: Slot[] = [];
    let placeable = true;
    for (const component of components) {
      let candidates = course.sections.filter(
        (s) => s.component === component && hasKnownTimes(s),
      );
      if (candidates.length === 0) {
        unplaced.push({ courseCode: code, component, reason: "times not available" });
        placeable = false;
        continue;
      }
      // STRICT: a locked section is the only choice for its slot.
      const lockedHere = candidates.filter((s) => locked.has(s.class_number));
      if (lockedHere.length > 0) candidates = [lockedHere[0]];

      const groups = buildGroups(candidates);
      // Try the most promising choices first, so that if we must stop early
      // we have already seen the good schedules.
      const standalone = new Map(
        groups.map((g) => [
          g,
          scoreSchedule([{ courseCode: code, term: course.term, section: g.rep }], preferences).cost,
        ]),
      );
      groups.sort((a, b) => standalone.get(a)! - standalone.get(b)!);
      courseSlots.push({ index: 0, courseCode: code, term: course.term, component, groups });
    }
    if (placeable) slots.push(...courseSlots);
  }

  if (slots.length === 0) {
    return { schedules: [], totalFound: 0, truncated: false, unplaced };
  }
  slots.forEach((slot, i) => (slot.index = i));

  // Search the slots with the fewest choices first: dead ends show up sooner.
  const order = [...slots].sort((a, b) => a.groups.length - b.groups.length);
  const chosen: Group[] = new Array(slots.length);
  const found: { cost: number; schedule: GeneratedSchedule }[] = [];
  let truncated = false;

  function search(depth: number): void {
    if (truncated) return;
    if (depth === order.length) {
      const sections: Pick[] = slots.map((slot) => ({
        courseCode: slot.courseCode,
        term: slot.term,
        section: chosen[slot.index].rep,
      }));
      const sameTimeAlternatives: Record<number, Section[]> = {};
      for (const slot of slots) {
        const group = chosen[slot.index];
        if (group.members.length > 1) {
          sameTimeAlternatives[group.rep.class_number] = group.members.filter((s) => s !== group.rep);
        }
      }
      const score = scoreSchedule(sections, preferences);
      found.push({ cost: score.cost, schedule: { sections, score, sameTimeAlternatives } });
      if (found.length >= maxSchedules) truncated = true;
      return;
    }
    const slot = order[depth];
    for (const group of slot.groups) {
      let clash = false;
      for (let d = 0; d < depth; d++) {
        const other = order[d];
        if (groupsClash(group, slot.term, chosen[other.index], other.term)) {
          clash = true;
          break;
        }
      }
      if (clash) continue; // abandon this branch straight away
      chosen[slot.index] = group;
      search(depth + 1);
      if (truncated) return;
    }
  }
  search(0);

  found.sort((a, b) => a.cost - b.cost);
  return {
    schedules: found.slice(0, limit).map((f) => f.schedule),
    totalFound: found.length,
    truncated,
    unplaced,
  };
}
