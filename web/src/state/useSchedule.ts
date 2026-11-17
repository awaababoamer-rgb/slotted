import { useCallback, useEffect, useMemo, useState } from "react";
import {
  findConflicts, generateSchedules, hasKnownTimes,
  type Course, type Fix, type Pick, type Preferences, type Section,
} from "@slotted/engine";

/** A fix (or another week from Compare) that was just put on the schedule. */
export interface AppliedChange {
  fix: Fix;
  /** e.g. "Fix 1" or "Week 2" */
  name: string;
}

/** A schedule's fingerprint: its class numbers, sorted. */
export const fingerprint = (picks: Pick[]) =>
  picks.map((p) => p.section.class_number).sort((a, b) => a - b).join(",");

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

/**
 * JSON drops `undefined`, so "no preference" (e.g. no light day) would come back
 * as the default after a reload. Save it as null instead; null means "none".
 */
export const keepUnset = (_key: string, value: unknown) => (value === undefined ? null : value);

/** The working copy is kept per signed-in user, so people sharing a computer don't see each other's. */
export function storageKeyFor(userId: string) {
  return `slotted:schedule:v1:${userId}`;
}

export const EMPTY_STATE: ScheduleState = { choices: [], locked: [], prefs: DEFAULT_PREFS };

function loadSaved(storageKey: string): ScheduleState {
  try {
    const raw = localStorage.getItem(storageKey);
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<ScheduleState>;
      if (Array.isArray(parsed.choices) && Array.isArray(parsed.locked)) {
        return { choices: parsed.choices, locked: parsed.locked, prefs: { ...DEFAULT_PREFS, ...parsed.prefs } };
      }
    }
  } catch {
    // Private window or blocked storage: start empty.
  }
  return EMPTY_STATE;
}

/** Everything the screens need about the student's schedule. */
export function useSchedule(catalog: Course[], storageKey: string) {
  const [state, setState] = useState<ScheduleState>(() => loadSaved(storageKey));

  useEffect(() => {
    try {
      localStorage.setItem(storageKey, JSON.stringify(state, keepUnset));
    } catch {
      // Ignore: saving is a convenience only.
    }
  }, [state, storageKey]);

  /** Replace everything at once (opening a saved plan). */
  const replaceState = useCallback((next: ScheduleState) => {
    setState({
      choices: Array.isArray(next.choices) ? next.choices : [],
      locked: Array.isArray(next.locked) ? next.locked : [],
      prefs: { ...DEFAULT_PREFS, ...next.prefs },
    });
  }, []);

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
    /** `chosen`: exact sections to use (component -> class number), e.g. from Find courses. */
    (code: string, chosen?: Record<string, number>) => {
      setState((prev) => {
        if (prev.choices.some((c) => c.code === code)) return prev;
        const course = byCode.get(code);
        if (!course) return prev;
        if (chosen) {
          const usedColors = new Set(prev.choices.map((c) => c.colorIndex));
          let colorIndex = 0;
          while (usedColors.has(colorIndex)) colorIndex++;
          return { ...prev, choices: [...prev.choices, { code, colorIndex, picks: { ...chosen } }] };
        }

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

  // ---- Applying a fix (or another week) ----
  // Not saved across reloads: it's only there to show the green "applied" note and Undo.
  const [appliedRaw, setAppliedRaw] = useState<AppliedChange | null>(null);
  // The note only holds while the schedule is still exactly that week.
  const applied = appliedRaw && fingerprint(appliedRaw.fix.schedule) === fingerprint(picks) ? appliedRaw : null;

  const applyChange = useCallback(
    (fix: Fix, name: string) => {
      replaceSections(fix.moves.map((m) => ({ code: m.courseCode, component: m.component, classNumber: m.to.class_number })));
      setAppliedRaw({ fix, name });
    },
    [replaceSections],
  );

  const undoApplied = useCallback(() => {
    if (!applied) return;
    replaceSections(applied.fix.moves.map((m) => ({ code: m.courseCode, component: m.component, classNumber: m.from.class_number })));
    setAppliedRaw(null);
  }, [applied, replaceSections]);

  return {
    state, byCode, picks, conflictReport, conflictedClassNumbers,
    addCourse, removeCourse, changeSection, toggleLock, replaceSections, setPrefs,
    applied, applyChange, undoApplied, replaceState,
  };
}

export type ScheduleApi = ReturnType<typeof useSchedule>;

/** Does this course have any sections we can put on the grid? */
export function courseHasTimes(course: Course): boolean {
  return course.sections.some((s: Section) => hasKnownTimes(s));
}
