// The public face of the engine. The website imports from here.
export { findConflicts } from "./conflicts";
export { generateSchedules } from "./generate";
export { suggestFixes, MAX_CHANGES_PER_FIX, MAX_FIXES } from "./fixes";
export { scoreSchedule, LIGHT_DAY_MAX_HOURS } from "./score";
export { hasKnownTimes, isAvoided, isRestricted, termsOverlap } from "./time";
export { classifyEvent, termForDate, weekdayOf, MIN_MINUTES_LEFT } from "./events";
export type { EventFit, EventTime } from "./events";
export { adjustedRating, findFittingCourses, fitCourse, rankCourses, REVIEW_PRIOR } from "./recommend";
export type { CourseFit, CourseRatingSummary, FitResult, RankOptions, Recommendation, RecommendFilters } from "./recommend";
export { buildIcs, firstWeekdayOnOrAfter } from "./ics";
export type { IcsEvent, IcsTerm } from "./ics";
export type * from "./types";
