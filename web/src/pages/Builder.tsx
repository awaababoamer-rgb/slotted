import { hasKnownTimes, scoreSchedule, termsOverlap, type Course } from "@slotted/engine";
import { ConflictBanner, groupConflicts } from "../components/ConflictBanner";
import { CourseSearch } from "../components/CourseSearch";
import { ExportButton } from "../components/ExportButton";
import { ShuffleIcon } from "../components/icons";
import { MyCourses } from "../components/MyCourses";
import { WeekGrid } from "../components/WeekGrid";
import { blocksOfPick } from "../lib/grid";
import { formatTime, sectionLabel, TERM_LABELS } from "../lib/format";
import type { ScheduleApi } from "../state/useSchedule";

type GridTerm = "first_term" | "second_term";

interface Props {
  courses: Course[];
  schedule: ScheduleApi;
  term: GridTerm;
}

function hoursText(hours: number) {
  return Number.isInteger(hours) ? `${hours}h` : `${hours.toFixed(1)}h`;
}

export function Builder({ courses, schedule, term }: Props) {
  const { picks, conflictReport, state } = schedule;

  // Only this term's classes go on the grid (full-year courses show in both).
  const termPicks = picks.filter((p) => termsOverlap(p.term, term) && p.section.meetings.length > 0);
  const stats = scoreSchedule(termPicks)[term === "first_term" ? "firstTerm" : "secondTerm"];
  const classHours = termPicks.flatMap(blocksOfPick).reduce((sum, b) => sum + (b.end - b.start) / 60, 0);

  // Things the grid can't show.
  const online = picks.filter((p) => p.section.meetings.length === 0 && hasKnownTimes(p.section));
  const noTimes = state.choices
    .map((c) => schedule.byCode.get(c.code))
    .filter((c): c is Course => !!c)
    .filter((c) => Object.keys(state.choices.find((x) => x.code === c.code)!.picks).length === 0);
  const otherTerm = picks.filter((p) => !termsOverlap(p.term, term));
  const otherTermCourses = [...new Set(otherTerm.map((p) => p.courseCode))];

  const colorOf = (code: string) => state.choices.find((c) => c.code === code)?.colorIndex ?? 0;
  const locked = new Set(state.locked);

  return (
    <div className="mx-auto grid max-w-[1400px] grid-cols-[minmax(0,1fr)] gap-4 px-4 py-4 lg:grid-cols-[minmax(260px,320px)_minmax(0,1fr)_minmax(260px,340px)] lg:items-start">
      {/* Left: add + my courses */}
      <div className="min-w-0 space-y-4">
        <CourseSearch
          courses={courses}
          addedCodes={new Set(state.choices.map((c) => c.code))}
          onAdd={schedule.addCourse}
        />
        <MyCourses schedule={schedule} />
      </div>

      {/* Middle: banner + week */}
      <div className="min-w-0 space-y-4">
        <ConflictBanner conflicts={conflictReport.conflicts} courseCount={state.choices.length} />

        <section className="rounded-2xl border border-line bg-white shadow-sm">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-4 py-3">
            <h2 className="font-display text-lg font-semibold">
              Week view <span className="text-sm font-normal text-muted">· {TERM_LABELS[term]}</span>
            </h2>
            <dl className="flex flex-wrap gap-x-4 gap-y-1 text-sm text-muted">
              <div><dt className="sr-only">Class time</dt><dd><b className="text-ink">{hoursText(classHours)}</b> of class</dd></div>
              <div><dt className="sr-only">Downtime</dt><dd><b className="text-ink">{hoursText(stats.gapHours)}</b> downtime</dd></div>
              <div><dt className="sr-only">Done by</dt><dd>Done by <b className="text-ink">{stats.latestEnd ? formatTime(stats.latestEnd) : "–"}</b></dd></div>
            </dl>
          </div>
          <div className="p-3">
            <WeekGrid picks={termPicks} colorOf={colorOf} conflicted={schedule.conflictedClassNumbers} locked={locked} />
          </div>
        </section>

        <div className="flex flex-wrap items-start justify-between gap-3">
          <ul className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted" aria-label="Legend">
            <li className="flex items-center gap-1.5"><span className="h-3 w-5 rounded border-2 border-conflict-600 bg-[#fff4ec]" />Time conflict</li>
            <li className="flex items-center gap-1.5"><span className="h-3 w-5 rounded border-2 border-dashed border-brand-600" />Moved by a fix</li>
            <li className="flex items-center gap-1.5"><span className="h-3 w-5 rounded bg-brand-700" />Locked section</li>
          </ul>
          <ExportButton
            picks={picks}
            conflictCount={groupConflicts(conflictReport.conflicts).length}
            leftOut={noTimes.map((c) => c.code)}
          />
        </div>

        {(noTimes.length > 0 || online.length > 0 || otherTermCourses.length > 0) && (
          <section className="rounded-2xl border border-line bg-white p-4 text-sm shadow-sm">
            <h2 className="font-semibold">Not on this grid</h2>
            <ul className="mt-1 space-y-1 text-muted">
              {noTimes.map((c) => (
                <li key={c.code}><b className="text-ink">{c.code}</b>: Times not available yet. Not checked for conflicts.</li>
              ))}
              {online.map((p) => (
                <li key={p.section.class_number}>
                  <b className="text-ink">{p.courseCode} {sectionLabel(p.section)}</b>: Online, no fixed meeting time.
                </li>
              ))}
              {otherTermCourses.length > 0 && (
                <li>
                  <b className="text-ink">{otherTermCourses.join(", ")}</b>: in{" "}
                  {TERM_LABELS[term === "first_term" ? "second_term" : "first_term"]}. Switch term at the top to see them.
                </li>
              )}
            </ul>
          </section>
        )}
      </div>

      {/* Right: Smart Resolve (next step) */}
      <aside className="min-w-0 space-y-4">
        <section className="rounded-2xl border border-line bg-white p-4 shadow-sm">
          <div className="flex items-center gap-2">
            <span className="grid size-8 place-items-center rounded-lg bg-brand-50 text-brand-700"><ShuffleIcon /></span>
            <h2 className="font-display text-lg font-semibold">Smart Resolve</h2>
          </div>
          <p className="mt-2 text-sm text-muted">
            {conflictReport.conflicts.length > 0
              ? "Suggested fixes will appear here in the next build step."
              : "When sections overlap, suggested fixes will appear here."}
          </p>
        </section>
        <section className="rounded-2xl border border-line bg-white p-4 shadow-sm">
          <h2 className="font-display text-lg font-semibold">Your priorities</h2>
          <ul className="mt-2 list-disc space-y-1 pl-5 text-sm">
            <li>No classes before 9:30 AM</li>
            <li>Minimize downtime between classes</li>
            <li>Keep Friday light</li>
            <li>Only move labs and tutorials</li>
          </ul>
          <p className="mt-2 text-xs text-muted">Editable in a later step.</p>
        </section>
      </aside>
    </div>
  );
}
