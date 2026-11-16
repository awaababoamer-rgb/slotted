import { useCallback, useEffect, useMemo, useState } from "react";
import {
  findConflicts, generateSchedules, hasKnownTimes,
  type Course, type Pick, type Preferences, type Section,
} from "@slotted/engine";

/** Starting priorities (same as the team's design). Editable in the Priorities dialog. */
export const DEFAULT_PREFS: Preferences = {
  earliestStart: "09:30",
  minimizeGaps: true,
  lightDay: "Fri",
  onlyMoveLabsAndTutorials: true,
};

/** One course the student added, and which section they picked for each component. */
export interface CourseChoice {
  code: string;
  colorIndex: number;
  /** component ("LEC", "LAB", "TUT") -> class number */
  picks: Record<string, number>;
}

export interface ScheduleState {
  choices: CourseChoice[];
  locked: number[];
  prefs: Preferences;
}

const STORAGE_KEY = "slotted:schedule:v1";

function loadSaved(): ScheduleState {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<ScheduleState>;
      if (Array.isArray(parsed.choices) && Array.isArray(parsed.locked)) {
        return { choices: parsed.choices, locked: parsed.locked, prefs: { ...DEFAULT_PREFS, ...parsed.prefs } };
      }
    }
  } catch {
    // Private window or blocked storage: start empty.
  }
  return { choices: [], locked: [], prefs: DEFAULT_PREFS };
}

/** Everything the screens need about the student's schedule. */
export function useSchedule(catalog: Course[]) {
  const [state, setState] = useState<ScheduleState>(loadSaved);

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch {
      // Ignore: saving is a convenience only.
    }
  }, [state]);

  const byCode = useMemo(() => new Map(catalog.map((c) => [c.code, c])), [catalog]);

  /** The chosen sections as engine "picks" (only sections that exist in the data). */
  const picks: Pick[] = useMemo(() => {
    const result: Pick[] = [];
    for (const choice of state.choices) {
      const course = byCode.get(choice.code);
      if (!course) continue;
      for (const classNumber of Object.values(choice.picks)) {
        const section = course.sections.find((s) => s.class_number === classNumber);
        if (section) result.push({ courseCode: course.code, term: course.term, section });
      }
    }
    return result;
  }, [state.choices, byCode]);

  const conflictReport = useMemo(() => findConflicts(picks), [picks]);

  const conflictedClassNumbers = useMemo(() => {
    const set = new Set<number>();
    for (const c of conflictReport.conflicts) {
      set.add(c.a.section.class_number);
      set.add(c.b.section.class_number);
    }
    return set;
  }, [conflictReport]);

  /**
   * Add a course, picking sections that fit around what's already chosen.
   * If nothing fits, it still adds the course (with clashes) so Smart Resolve can help.
   */
  const addCourse = useCallback(
    (code: string) => {
      setState((prev) => {
        if (prev.choices.some((c) => c.code === code)) return prev;
        const course = byCode.get(code);
        if (!course) return prev;

        const current = prev.choices.flatMap((c) => Object.values(c.picks));
        const codes = [...prev.choices.map((c) => c.code), code];
        let best = generateSchedules(catalog, codes, { lockedClassNumbers: current }, { limit: 1, maxSchedules: 2000 })
          .schedules[0];
        if (!best) {
          best = generateSchedules(catalog, [code], {}, { limit: 1, maxSchedules: 2000 }).schedules[0];
        }
        const picks: Record<string, number> = {};
        for (const p of best?.sections ?? []) {
          if (p.courseCode === code) picks[p.section.component] = p.section.class_number;
        }

        const usedColors = new Set(prev.choices.map((c) => c.colorIndex));
        let colorIndex = 0;
        while (usedColors.has(colorIndex)) colorIndex++;
        return { ...prev, choices: [...prev.choices, { code, colorIndex, picks }] };
      });
    },
    [byCode, catalog],
  );

  const removeCourse = useCallback((code: string) => {
    setState((prev) => {
      const removed = prev.choices.find((c) => c.code === code);
      const removedNumbers = new Set(Object.values(removed?.picks ?? {}));
      return {
        ...prev,
        choices: prev.choices.filter((c) => c.code !== code),
        locked: prev.locked.filter((n) => !removedNumbers.has(n)),
      };
    });
  }, []);

  const changeSection = useCallback((code: string, component: string, classNumber: number) => {
    setState((prev) => ({
      ...prev,
      choices: prev.choices.map((c) => {
        if (c.code !== code) return c;
        return { ...c, picks: { ...c.picks, [component]: classNumber } };
      }),
      // A changed section is no longer the locked one.
      locked: prev.locked.filter((n) => n !== prev.choices.find((c) => c.code === code)?.picks[component]),
    }));
  }, []);

  const toggleLock = useCallback((classNumber: number) => {
    setState((prev) => ({
      ...prev,
      locked: prev.locked.includes(classNumber)
        ? prev.locked.filter((n) => n !== classNumber)
        : [...prev.locked, classNumber],
    }));
  }, []);

  /** Replace several sections at once (used by Smart Resolve fixes later). */
  const replaceSections = useCallback((changes: { code: string; component: string; classNumber: number }[]) => {
    setState((prev) => ({
      ...prev,
      choices: prev.choices.map((c) => {
        const mine = changes.filter((ch) => ch.code === c.code);
        if (mine.length === 0) return c;
        const picks = { ...c.picks };
        for (const ch of mine) picks[ch.component] = ch.classNumber;
        return { ...c, picks };
      }),
    }));
  }, []);

  const setPrefs = useCallback((prefs: Preferences) => {
    setState((prev) => ({ ...prev, prefs }));
  }, []);

  return {
    state, byCode, picks, conflictReport, conflictedClassNumbers,
    addCourse, removeCourse, changeSection, toggleLock, replaceSections, setPrefs,
  };
}

export type ScheduleApi = ReturnType<typeof useSchedule>;

/** Does this course have any sections we can put on the grid? */
export function courseHasTimes(course: Course): boolean {
  return course.sections.some((s: Section) => hasKnownTimes(s));
}
