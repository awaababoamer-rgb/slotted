// The shapes of the data the engine works with.
// Course, Section and Meeting match data/courses.json exactly.

export type Day = "Mon" | "Tue" | "Wed" | "Thu" | "Fri" | "Sat" | "Sun";

export type Term = "first_term" | "second_term" | "full_year" | "other_session" | "unknown";

export interface Meeting {
  day: Day | null;
  start: string | null; // "09:30" (24-hour clock)
  end: string | null;
  location: string;
}

export interface Section {
  section: string; // "001"
  component: string; // "LEC", "LAB" or "TUT"
  class_number: number;
  full: boolean;
  notes?: string;
  meetings: Meeting[];
  /** "public" = no times collected yet. "dms" = times are known (may be none, for online courses). */
  data_source: "public" | "dms";
  instructors?: string[];
  [extra: string]: unknown;
}

export interface Course {
  code: string; // "COMPSCI 1020A"
  title?: string;
  term: Term;
  sections: Section[];
  [extra: string]: unknown;
}

/** One chosen section, together with the course it belongs to. */
export interface Pick {
  courseCode: string;
  term: Term;
  section: Section;
}

export interface Preferences {
  /** Soft: classes should not start before this time, e.g. "09:30". */
  earliestStart?: string;
  /** Soft: a day to keep light (at most LIGHT_DAY_MAX_HOURS of class). */
  lightDay?: Day;
  /** Soft: rank schedules with fewer gaps higher. */
  minimizeGaps?: boolean;
  /** Soft: an hour to keep free every day, e.g. { start: "12:30", end: "13:30" }. */
  lunchHour?: { start: string; end: string };
  /** STRICT (fixes only): never move a lecture. */
  onlyMoveLabsAndTutorials?: boolean;
  /** STRICT: class numbers the student does not want changed. */
  lockedClassNumbers?: number[];
}

export interface Conflict {
  a: Pick;
  b: Pick;
  day: Day;
  /** The overlapping time window. */
  start: string;
  end: string;
}

export interface ConflictReport {
  conflicts: Conflict[];
  /** Sections whose times are not available. They were NOT checked. */
  timesNotAvailable: Pick[];
}

export interface TermStats {
  daysOnCampus: number;
  gapHours: number;
  earliestStart: string | null;
  latestEnd: string | null;
  fridayClasses: number;
}

export interface BrokenPreference {
  preference: "earliestStart" | "lightDay" | "lunchHour";
  term: "first_term" | "second_term";
  day: Day;
  detail: string;
}

export interface SectionFlag {
  pick: Pick;
  /** "full" = the section is full. "restricted" = overflow/reserved section. */
  reason: "full" | "restricted";
  detail: string;
}

export interface ScheduleScore {
  firstTerm: TermStats;
  secondTerm: TermStats;
  /** Worst case across the two terms (gap hours are added together). */
  overall: TermStats;
  brokenPreferences: BrokenPreference[];
  flags: SectionFlag[];
  timesNotAvailable: Pick[];
  /** Lower is better. Used only for ranking. */
  cost: number;
}

export interface GeneratedSchedule {
  sections: Pick[];
  score: ScheduleScore;
  /**
   * Other sections that meet at exactly the same times as a chosen one,
   * keyed by the chosen section's class number. Swapping to one of these
   * gives an identical week.
   */
  sameTimeAlternatives: Record<number, Section[]>;
}

export interface UnplacedCourse {
  courseCode: string;
  component: string | null;
  reason: "times not available" | "course not found";
}

export interface GenerateOptions {
  /** How many schedules to return (best first). Default 200. */
  limit?: number;
  /** Stop searching after this many valid schedules. Default 20000. */
  maxSchedules?: number;
}

export interface GenerateResult {
  schedules: GeneratedSchedule[];
  /** How many valid schedules were found before stopping. */
  totalFound: number;
  /** True if the search stopped early, so more schedules exist. */
  truncated: boolean;
  /** Courses that could not be placed. They are NOT treated as free time. */
  unplaced: UnplacedCourse[];
}

export interface Move {
  courseCode: string;
  component: string;
  from: Section;
  to: Section;
}

export interface Fix {
  moves: Move[];
  label: string;
  schedule: Pick[];
  score: ScheduleScore;
  /** True if this fix uses a full or restricted section (see score.flags). */
  usesAvoidedSection: boolean;
}

export interface FixResult {
  fixes: Fix[];
  alreadyConflictFree: boolean;
  /** Why no fixes were found, if none were. */
  reason?: string;
  timesNotAvailable: Pick[];
}
