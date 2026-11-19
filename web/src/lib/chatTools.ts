// The tools Slotted's assistant can ask the website to run. They read the course
// catalog already loaded in the browser and use the schedule engine, so the
// assistant's facts come from our data, not from the AI's memory.

import {
  adjustedRating, checkCredits, courseCredits, findFittingCourses, fitCourse, hasKnownTimes, rankCourses, termsOverlap,
  type Course, type Day,
} from "@slotted/engine";
import type { Ratings } from "../data/reviews";
import type { ScheduleApi } from "../state/useSchedule";
import { formatCredits, formatMeetings, formatRooms, sectionLabel, termTag, TERM_LABELS } from "./format";

export interface Proposal {
  kind: "add" | "remove";
  code: string;
  reason: string;
}

export interface ToolEnv {
  courses: Course[];
  byCode: Map<string, Course>;
  schedule: ScheduleApi;
  ratings: Map<string, Ratings>;
  /** The term tab the student is looking at, used when they don't name one. */
  term: "first_term" | "second_term";
}

/** "fall" / "winter" (or the older "first_term" / "second_term") -> the engine's term. */
function toTerm(value: unknown): "first_term" | "second_term" | undefined {
  const v = String(value ?? "").toLowerCase();
  if (v === "fall" || v === "first_term") return "first_term";
  if (v === "winter" || v === "second_term") return "second_term";
  return undefined;
}

const ratingText = (r: Ratings | undefined) =>
  r && r.review_count > 0
    ? `${r.overall.toFixed(1)}/5 from ${r.review_count} review${r.review_count === 1 ? "" : "s"} (workload ${r.workload.toFixed(1)}, difficulty ${r.difficulty.toFixed(1)})`
    : "no reviews yet";

const hasTimes = (c: Course) => c.sections.some(hasKnownTimes);

/** "COMPSCI 2210" -> the actual course codes ("COMPSCI 2210A", "COMPSCI 2210B"). */
function lookup(env: ToolEnv, code: string): Course[] {
  const wanted = code.trim().toUpperCase().replace(/\s+/g, " ");
  const exact = env.byCode.get(wanted);
  if (exact) return [exact];
  return env.courses.filter((c) => c.code.startsWith(wanted)).slice(0, 4);
}

function searchCourses(env: ToolEnv, args: { query?: string; term?: string }) {
  const q = String(args.query ?? "").trim().toUpperCase();
  if (!q) return { results: [] };
  const words = q.split(/\s+/);
  const matches = env.courses.filter((c) => {
    const wanted = toTerm(args.term);
    if (wanted && !termsOverlap(c.term, wanted)) return false;
    const hay = `${c.code} ${String(c.title ?? "")}`.toUpperCase();
    return words.every((w) => hay.includes(w));
  });
  // Courses with times and reviews first: those are the ones Slotted can really help with.
  matches.sort((a, b) => Number(hasTimes(b)) - Number(hasTimes(a)) || (env.ratings.get(b.code)?.review_count ?? 0) - (env.ratings.get(a.code)?.review_count ?? 0));
  return {
    total_matches: matches.length,
    results: matches.slice(0, 10).map((c) => ({
      code: c.code,
      title: c.title,
      term: termTag(c.term),
      credits: courseCredits(c),
      times_known: hasTimes(c),
      rating: ratingText(env.ratings.get(c.code)),
      in_my_week: env.schedule.state.choices.some((ch) => ch.code === c.code),
    })),
  };
}

function getCourse(env: ToolEnv, args: { code?: string }) {
  const found = lookup(env, String(args.code ?? ""));
  if (found.length === 0) return { error: `No course matching "${args.code}" in Slotted's data.` };
  return {
    courses: found.map((c) => ({
      code: c.code,
      title: c.title,
      term: termTag(c.term),
      rating: ratingText(env.ratings.get(c.code)),
      in_my_week: env.schedule.state.choices.some((ch) => ch.code === c.code),
      sections: c.sections.slice(0, 25).map((s) => ({
        section: sectionLabel(s),
        class_number: s.class_number,
        times: s.data_source === "public" ? "times not available yet" : formatMeetings(s.meetings) || "online, no fixed meeting time",
        rooms: s.meetings.length ? formatRooms(s.meetings) : undefined,
        instructors: s.instructors?.join(", ") || undefined,
        full: s.full || undefined,
        notes: s.notes ? String(s.notes).slice(0, 120) : undefined,
      })),
    })),
  };
}

function findFitting(env: ToolEnv, args: {
  term?: string; subject?: string; level?: string; prefer_lighter?: boolean; free_day?: string; not_before?: string;
}) {
  const term = toTerm(args.term) ?? env.term;
  const fits = findFittingCourses(env.courses, env.schedule.picks, env.schedule.state.prefs, {
    term,
    subject: args.subject ? args.subject.toUpperCase() : undefined,
    level: args.level,
    hideFull: true,
  }).filter((fit) =>
    fit.sections.every((p) =>
      p.section.meetings.every((m) =>
        (!args.free_day || m.day !== (args.free_day as Day)) && (!args.not_before || !m.start || m.start >= args.not_before),
      ),
    ),
  );
  const ranked = rankCourses(fits, env.ratings, { preferLighter: !!args.prefer_lighter }).slice(0, 8);
  return {
    term: TERM_LABELS[term],
    found: fits.length,
    top: ranked.map((r) => ({
      code: r.course.code,
      title: r.course.title,
      term: termTag(r.course.term),
      sections: r.sections.map((p) => `${sectionLabel(p.section)} ${formatMeetings(p.section.meetings) || "online"}`).join("; "),
      rating: ratingText(env.ratings.get(r.course.code)),
      why: r.reasons.join("; ") || undefined,
    })),
  };
}

function topRated(env: ToolEnv, args: { term?: string; subject?: string; level?: string; only_fitting?: boolean }) {
  const wanted = toTerm(args.term);
  const reviewed = [...env.ratings.values()].filter((r) => r.review_count > 0);
  const rows = reviewed
    .map((r) => ({ r, course: env.byCode.get(r.course_code) }))
    .filter((x): x is { r: Ratings; course: Course } => !!x.course)
    .filter(({ course }) => !wanted || termsOverlap(course.term, wanted))
    .filter(({ course }) => !args.subject || course.code.startsWith(`${args.subject.toUpperCase()} `))
    .filter(({ course }) => !args.level || course.code.split(" ")[1]?.[0] === args.level[0])
    .map(({ r, course }) => {
      const fit = fitCourse(course, env.schedule.picks, env.schedule.state.prefs);
      return {
        course, r, score: adjustedRating(r.overall, r.review_count),
        fits: fit.fits ? "fits your week" : fit.reason === "already in schedule" ? "already in your week" : `doesn't fit (${fit.reason})`,
      };
    })
    .filter((x) => !args.only_fitting || x.fits === "fits your week")
    .sort((a, b) => b.score - a.score);
  return {
    courses_with_reviews_in_slotted: reviewed.length,
    matching: rows.length,
    note: rows.length === 0 ? "No courses matching this request have reviews yet." : undefined,
    results: rows.slice(0, 8).map(({ course, r, fits }) => ({
      code: course.code,
      title: course.title,
      term: termTag(course.term),
      credits: courseCredits(course),
      rating: ratingText(r),
      fits,
    })),
  };
}

/** Run one tool. Proposals are collected so the chat can show confirm buttons. */
export function runTool(env: ToolEnv, name: string, args: Record<string, unknown>, proposals: Proposal[]): unknown {
  switch (name) {
    case "search_courses":
      return searchCourses(env, args);
    case "get_course":
      return getCourse(env, args);
    case "find_fitting_courses":
      return findFitting(env, args);
    case "top_rated_courses":
      return topRated(env, args);
    case "propose_add_course":
    case "propose_remove_course": {
      const kind = name === "propose_add_course" ? "add" : "remove";
      const [course] = lookup(env, String(args.code ?? ""));
      if (!course) return { error: `No course "${args.code}" in Slotted's data, so it can't be ${kind === "add" ? "added" : "removed"}.` };
      const mine = env.schedule.state.choices.some((c) => c.code === course.code);
      if (kind === "add" && mine) return { error: `${course.code} is already in the student's week.` };
      if (kind === "remove" && !mine) return { error: `${course.code} isn't in the student's week.` };
      proposals.push({ kind, code: course.code, reason: String(args.reason ?? "").slice(0, 200) });
      return { status: "A button was shown to the student. They decide; it is not done yet." };
    }
    default:
      return { error: `Unknown tool ${name}` };
  }
}

/** What the assistant knows about the student: only their week and priorities, never their name or email. */
export function describeStudent(env: ToolEnv, term: "first_term" | "second_term"): string {
  const { schedule } = env;
  const lines = [`Today is ${new Date().toDateString()}. The student is looking at ${TERM_LABELS[term]}.`];
  if (schedule.state.choices.length === 0) lines.push("Their week is empty so far.");
  for (const choice of schedule.state.choices) {
    const course = env.byCode.get(choice.code);
    const picks = schedule.picks.filter((p) => p.courseCode === choice.code);
    const parts = picks.map((p) => `${sectionLabel(p.section)} ${p.section.data_source === "public" ? "(times not available)" : formatMeetings(p.section.meetings) || "(online)"}`);
    lines.push(`- ${choice.code} ${course?.title ?? ""} [${course ? termTag(course.term) : "?"}]: ${parts.join("; ") || "no sections picked"}`);
  }
  const conflicts = schedule.conflictReport.conflicts;
  lines.push(conflicts.length === 0 ? "No time conflicts." : `Conflicts: ${conflicts.slice(0, 8).map((c) => `${c.a.courseCode} ${sectionLabel(c.a.section)} vs ${c.b.courseCode} ${sectionLabel(c.b.section)} on ${c.day} ${c.start}-${c.end}`).join("; ")}`);
  const credits = checkCredits(schedule.state.choices.map((c) => env.byCode.get(c.code)).filter((c): c is Course => !!c), schedule.state.prefs);
  lines.push(`Credits: Fall ${formatCredits(credits.credits.first_term)}, Winter ${formatCredits(credits.credits.second_term)} (their limit is ${formatCredits(credits.limit)} per term; mention it if a suggestion would go over).`);
  const p = schedule.state.prefs;
  lines.push(`Priorities: ${[
    p.earliestStart && `classes after ${p.earliestStart}`,
    p.lightDay && `light ${p.lightDay}`,
    p.minimizeGaps && "few gaps",
    p.lunchHour && "a lunch hour",
  ].filter(Boolean).join(", ") || "none set"}.`);
  return lines.join("\n");
}
