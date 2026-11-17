import { useEffect, useId, useMemo, useState } from "react";
import { findFittingCourses, rankCourses, type Course, type Recommendation } from "@slotted/engine";
import { allCourseRatings, type Ratings } from "../data/reviews";
import { formatMeetings, plural, sectionLabel, TERM_LABELS } from "../lib/format";
import type { ScheduleApi } from "../state/useSchedule";
import { courseHref } from "./Reviews";

type GridTerm = "first_term" | "second_term";
const PAGE = 25;

function RecommendationCard({ rec, onAdd }: { rec: Recommendation; onAdd: () => void }) {
  const r = rec.rating;
  return (
    <li className="rounded-2xl border border-line bg-white p-4 shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <a href={courseHref(rec.course.code)} className="font-display text-lg font-semibold hover:text-brand-700 hover:underline">
            {rec.course.code}
          </a>
          <p className="text-sm text-muted">{String(rec.course.title ?? "")}</p>
        </div>
        <button type="button" onClick={onAdd}
          className="shrink-0 rounded-lg bg-brand-700 px-3 py-1.5 text-sm font-semibold text-white hover:bg-brand-800">
          Add to my courses
        </button>
      </div>

      <ul className="mt-2 space-y-0.5 text-sm">
        {rec.sections.map((p) => (
          <li key={p.section.class_number}>
            <b>{sectionLabel(p.section)}</b>{" "}
            <span className="text-muted">
              {formatMeetings(p.section.meetings) || "Online, no fixed time"}
              {((p.section.instructors as string[] | undefined) ?? []).length > 0 && ` · ${(p.section.instructors as string[]).join(", ")}`}
            </span>
            {p.section.full && <span className="ml-1 text-xs font-semibold text-[#7a5300]">Full</span>}
          </li>
        ))}
      </ul>

      <div className="mt-2 flex flex-wrap gap-1.5">
        {r && r.review_count > 0 ? (
          <span className="rounded-full bg-[#fdf3d6] px-2 py-0.5 text-[11px] font-semibold text-[#7a5300]">
            ★ {r.overall.toFixed(1)} · {plural(r.review_count, "review")} · {r.would_take_again_pct}% would take again
          </span>
        ) : (
          <span className="rounded-full bg-page px-2 py-0.5 text-[11px] font-semibold text-muted">No reviews yet</span>
        )}
        {r && r.review_count > 0 && (
          <span className="rounded-full bg-page px-2 py-0.5 text-[11px] font-semibold text-muted">
            Workload {r.workload.toFixed(1)}/5 · Difficulty {r.difficulty.toFixed(1)}/5
          </span>
        )}
        {rec.addedCost === 0 && (
          <span className="rounded-full bg-good-50 px-2 py-0.5 text-[11px] font-semibold text-good-700">No extra gaps</span>
        )}
        {rec.usesFullSection && (
          <span className="rounded-full bg-conflict-50 px-2 py-0.5 text-[11px] font-semibold text-conflict-700">Only full sections fit</span>
        )}
      </div>
    </li>
  );
}

/** "Courses that fit your schedule", ranked by fit and reviews. */
export function FindCourses({ courses, schedule, term }: { courses: Course[]; schedule: ScheduleApi; term: GridTerm }) {
  const [ratings, setRatings] = useState<Map<string, Ratings>>(new Map());
  const [subject, setSubject] = useState("");
  const [level, setLevel] = useState("");
  const [lighter, setLighter] = useState(false);
  const [hideFull, setHideFull] = useState(true);
  const [shown, setShown] = useState(PAGE);
  const [added, setAdded] = useState<string | null>(null);
  const ids = { subject: useId(), level: useId() };

  useEffect(() => {
    allCourseRatings().then(setRatings).catch(() => undefined);
  }, []);
  useEffect(() => setShown(PAGE), [subject, level, lighter, hideFull, term]);

  // Only subjects that have meeting times can be checked.
  const subjects = useMemo(() => {
    const withTimes = courses.filter((c) => c.sections.some((s) => s.data_source === "dms"));
    return [...new Set(withTimes.map((c) => c.code.split(" ")[0]))].sort();
  }, [courses]);

  const ranked = useMemo(() => {
    const fits = findFittingCourses(courses, schedule.picks, schedule.state.prefs, {
      term, subject: subject || undefined, level: level || undefined, hideFull,
    });
    return rankCourses(fits, ratings, { preferLighter: lighter });
  }, [courses, schedule.picks, schedule.state.prefs, term, subject, level, hideFull, ratings, lighter]);

  function add(rec: Recommendation) {
    schedule.addCourse(rec.course.code, Object.fromEntries(rec.sections.map((p) => [p.section.component, p.section.class_number])));
    setAdded(rec.course.code);
    window.setTimeout(() => setAdded(null), 5000);
  }

  return (
    <div className="mx-auto max-w-4xl px-4 py-6">
      <h1 className="font-display text-2xl font-bold sm:text-3xl">Find courses</h1>
      <p className="mt-1 text-muted">
        Courses with sections that fit around your {TERM_LABELS[term]} week, ranked by how well they fit and what students say.
        Switch term at the top.
      </p>

      <div className="mt-5 flex flex-wrap items-end gap-3 rounded-2xl border border-line bg-white p-4 shadow-sm">
        <label htmlFor={ids.subject} className="text-sm">
          <span className="font-semibold">Subject</span>
          <select id={ids.subject} value={subject} onChange={(e) => setSubject(e.target.value)} className="mt-1 block rounded-lg border border-line px-3 py-1.5">
            <option value="">All with times</option>
            {subjects.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
        </label>
        <label htmlFor={ids.level} className="text-sm">
          <span className="font-semibold">Level</span>
          <select id={ids.level} value={level} onChange={(e) => setLevel(e.target.value)} className="mt-1 block rounded-lg border border-line px-3 py-1.5">
            <option value="">Any</option>
            {["1000", "2000", "3000", "4000"].map((l) => <option key={l} value={l}>{l}-level</option>)}
          </select>
        </label>
        <label className="flex items-center gap-2 py-1.5 text-sm">
          <input type="checkbox" checked={lighter} onChange={(e) => setLighter(e.target.checked)} className="size-4 accent-brand-700" />
          Prefer lighter workload
        </label>
        <label className="flex items-center gap-2 py-1.5 text-sm">
          <input type="checkbox" checked={hideFull} onChange={(e) => setHideFull(e.target.checked)} className="size-4 accent-brand-700" />
          Hide courses where only full sections fit
        </label>
      </div>

      <p className="mt-3 text-xs text-muted">
        Only courses with known meeting times are checked. Reviews count more once a course has a few of them.
        Check prerequisites and program rules in the course details before enrolling.
      </p>
      {added && (
        <p role="status" className="mt-3 rounded-xl bg-good-50 px-4 py-2 text-sm text-good-700">
          Added {added} to your courses. <a href="#builder" className="font-semibold underline">See your week →</a>
        </p>
      )}

      <p className="mt-4 text-sm font-semibold">{plural(ranked.length, "course")} fit your week</p>
      <ul className="mt-2 space-y-3">
        {ranked.slice(0, shown).map((rec) => <RecommendationCard key={rec.course.code} rec={rec} onAdd={() => add(rec)} />)}
      </ul>
      {ranked.length > shown && (
        <button type="button" onClick={() => setShown((n) => n + PAGE)}
          className="mt-4 w-full rounded-lg border border-line bg-white px-4 py-2 text-sm font-semibold hover:border-brand-200">
          Show more ({ranked.length - shown} left)
        </button>
      )}
    </div>
  );
}
