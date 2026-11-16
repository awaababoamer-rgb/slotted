import {
  blocksOf, DAY_NAMES, DAYS, hasKnownTimes, isRestricted, termsOverlap, toMinutes, toTime,
  type Block,
} from "./time";
import type {
  BrokenPreference, Day, Pick, Preferences, ScheduleScore, SectionFlag, TermStats,
} from "./types";

/** A "light" day has at most this many hours of class. */
export const LIGHT_DAY_MAX_HOURS = 2;

// How much each thing costs when ranking (in "minutes of annoyance"). Lower total = better.
const COST_PER_DAY_ON_CAMPUS = 30;
const GAP_WEIGHT = 1;
const GAP_WEIGHT_WHEN_MINIMIZING = 3;
const COST_EARLY_START = 60; // plus the minutes before the preferred start
const COST_LUNCH_BROKEN = 90;
const COST_AVOIDED_SECTION = 1000; // full / restricted sections sink to the bottom

const COST_LAB_OTHER_DAY = 45;

/** The longest stretch with no class inside [from, to). Blocks must be sorted by start. */
function longestFreeStretch(blocks: Block[], from: number, to: number): number {
  let longest = 0;
  let cursor = from;
  for (const b of blocks) {
    if (b.end <= cursor) continue;
    if (b.start >= to) break;
    longest = Math.max(longest, Math.min(b.start, to) - cursor);
    cursor = Math.max(cursor, b.end);
  }
  return Math.max(longest, to - cursor);
}

/**
 * "Labs on the same day as lecture": each lab/tutorial meeting should fall on
 * a day when that course already has a lecture (fewer trips to campus).
 */
function labsOnOtherDays(schedule: Pick[]): { broken: BrokenPreference[]; cost: number } {
  const broken: BrokenPreference[] = [];
  const lectureDays = new Map<string, Set<Day>>();
  for (const p of schedule) {
    if (p.section.component !== "LEC") continue;
    const days = lectureDays.get(p.courseCode) ?? new Set<Day>();
    for (const b of blocksOf(p.section)) days.add(b.day);
    lectureDays.set(p.courseCode, days);
  }
  for (const p of schedule) {
    if (p.section.component === "LEC") continue;
    const days = lectureDays.get(p.courseCode);
    if (!days || days.size === 0) continue; // online or no lecture: nothing to match
    for (const b of blocksOf(p.section)) {
      if (days.has(b.day)) continue;
      broken.push({
        preference: "labsSameDay",
        term: p.term === "second_term" ? "second_term" : "first_term",
        day: b.day,
        detail: `${p.courseCode} ${p.section.component} ${p.section.section} is on ${DAY_NAMES[b.day]}, but its lecture isn't`,
      });
    }
  }
  return { broken, cost: broken.length * COST_LAB_OTHER_DAY };
}

interface TermResult {
  stats: TermStats;
  broken: BrokenPreference[];
  cost: number;
}

function scoreTerm(
  picks: Pick[],
  term: "first_term" | "second_term",
  prefs: Preferences,
): TermResult {
  // Group this term's meetings by day.
  const byDay = new Map<Day, Block[]>();
  for (const pick of picks) {
    if (!termsOverlap(pick.term, term)) continue;
    for (const block of blocksOf(pick.section)) {
      if (!byDay.has(block.day)) byDay.set(block.day, []);
      byDay.get(block.day)!.push(block);
    }
  }

  const broken: BrokenPreference[] = [];
  let gapMinutes = 0;
  let earliest: number | null = null;
  let latest: number | null = null;
  let cost = 0;

  const earliestOk = prefs.earliestStart ? toMinutes(prefs.earliestStart) : null;
  const lunch = prefs.lunchHour
    ? {
        start: toMinutes(prefs.lunchHour.start),
        end: toMinutes(prefs.lunchHour.end),
        // How long the free stretch must be (default 1 hour, never longer than the window).
        need: Math.min(prefs.lunchHour.minutes ?? 60, toMinutes(prefs.lunchHour.end) - toMinutes(prefs.lunchHour.start)),
      }
    : null;

  for (const day of DAYS) {
    const blocks = byDay.get(day);
    if (!blocks) continue;
    blocks.sort((a, b) => a.start - b.start);

    const dayStart = blocks[0].start;
    let dayEnd = blocks[0].end;
    let classMinutes = 0;
    for (const block of blocks) {
      if (block.start > dayEnd) gapMinutes += block.start - dayEnd;
      dayEnd = Math.max(dayEnd, block.end);
      classMinutes += block.end - block.start;
    }
    earliest = earliest === null ? dayStart : Math.min(earliest, dayStart);
    latest = latest === null ? dayEnd : Math.max(latest, dayEnd);

    if (earliestOk !== null && dayStart < earliestOk) {
      broken.push({
        preference: "earliestStart", term, day,
        detail: `Starts at ${toTime(dayStart)} on ${DAY_NAMES[day]}, before ${prefs.earliestStart}`,
      });
      cost += COST_EARLY_START + (earliestOk - dayStart);
    }
    if (prefs.lightDay === day) {
      cost += classMinutes;
      if (classMinutes > LIGHT_DAY_MAX_HOURS * 60) {
        broken.push({
          preference: "lightDay", term, day,
          detail: `${(classMinutes / 60).toFixed(1)} hours of class on ${DAY_NAMES[day]}`,
        });
      }
    }
    if (lunch && longestFreeStretch(blocks, lunch.start, lunch.end) < lunch.need) {
      broken.push({
        preference: "lunchHour", term, day,
        detail: `No free ${lunch.need} minutes between ${prefs.lunchHour!.start} and ${prefs.lunchHour!.end} on ${DAY_NAMES[day]}`,
      });
      cost += COST_LUNCH_BROKEN;
    }
  }

  cost += byDay.size * COST_PER_DAY_ON_CAMPUS;
  cost += gapMinutes * (prefs.minimizeGaps ? GAP_WEIGHT_WHEN_MINIMIZING : GAP_WEIGHT);

  return {
    stats: {
      daysOnCampus: byDay.size,
      gapHours: gapMinutes / 60,
      earliestStart: earliest === null ? null : toTime(earliest),
      latestEnd: latest === null ? null : toTime(latest),
      fridayClasses: byDay.get("Fri")?.length ?? 0,
    },
    broken,
    cost,
  };
}

function earlier(a: string | null, b: string | null): string | null {
  if (a === null) return b;
  if (b === null) return a;
  return a < b ? a : b;
}

function later(a: string | null, b: string | null): string | null {
  if (a === null) return b;
  if (b === null) return a;
  return a > b ? a : b;
}

/**
 * Stats for ranking a schedule, plus which soft preferences it breaks.
 *
 * Stats are worked out per term, because a student's first-term week and
 * second-term week are different weeks. Full-year and Y/Z courses count
 * in both.
 */
export function scoreSchedule(schedule: Pick[], preferences: Preferences = {}): ScheduleScore {
  const first = scoreTerm(schedule, "first_term", preferences);
  const second = scoreTerm(schedule, "second_term", preferences);
  const labs = preferences.labsSameDayAsLecture ? labsOnOtherDays(schedule) : { broken: [], cost: 0 };

  const flags: SectionFlag[] = [];
  for (const pick of schedule) {
    const name = `${pick.courseCode} ${pick.section.component} ${pick.section.section}`;
    if (pick.section.full) {
      flags.push({ pick, reason: "full", detail: `${name} is full` });
    } else if (isRestricted(pick.section)) {
      flags.push({ pick, reason: "restricted", detail: `${name}: ${pick.section.notes}` });
    }
  }

  return {
    firstTerm: first.stats,
    secondTerm: second.stats,
    overall: {
      daysOnCampus: Math.max(first.stats.daysOnCampus, second.stats.daysOnCampus),
      gapHours: first.stats.gapHours + second.stats.gapHours,
      earliestStart: earlier(first.stats.earliestStart, second.stats.earliestStart),
      latestEnd: later(first.stats.latestEnd, second.stats.latestEnd),
      fridayClasses: Math.max(first.stats.fridayClasses, second.stats.fridayClasses),
    },
    brokenPreferences: [...first.broken, ...second.broken, ...labs.broken],
    flags,
    timesNotAvailable: schedule.filter((p) => !hasKnownTimes(p.section)),
    cost: first.cost + second.cost + labs.cost + flags.length * COST_AVOIDED_SECTION,
  };
}
