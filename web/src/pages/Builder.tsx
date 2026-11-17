import { useEffect, useMemo, useState } from "react";
import {
  findConflicts, hasKnownTimes, scoreSchedule, suggestFixes, termsOverlap,
  type Course, type Fix, type Pick, type Preferences,
} from "@slotted/engine";
import { ConflictBanner, groupConflicts, type BannerMode } from "../components/ConflictBanner";
import { CourseSearch } from "../components/CourseSearch";
import { ExportButton } from "../components/ExportButton";
import { MyCourses } from "../components/MyCourses";
import { FitsPanel } from "../components/FitsPanel";
import { SmartResolve } from "../components/SmartResolve";
import { WeekGrid } from "../components/WeekGrid";
import { DAY_LONG, formatTime, sectionLabel, TERM_LABELS } from "../lib/format";
import type { MyEventsApi } from "../data/myEvents";
import { eventsForGrid, fixEventWarnings } from "../lib/eventGrid";
import { blocksOfPick } from "../lib/grid";
import type { ScheduleApi } from "../state/useSchedule";

type GridTerm = "first_term" | "second_term";

interface Props {
  courses: Course[];
  schedule: ScheduleApi;
  term: GridTerm;
  onEditPriorities: () => void;
  myEvents: MyEventsApi;
}

function hoursText(hours: number) {
  return Number.isInteger(hours) ? `${hours}h` : `${hours.toFixed(1)}h`;
}

export function priorityLines(prefs: Preferences): string[] {
  const lines: string[] = [];
  if (prefs.earliestStart && prefs.earliestStart > "08:30") lines.push(`No classes before ${formatTime(prefs.earliestStart)}`);
  if (prefs.minimizeGaps) lines.push("Minimize downtime between classes");
  if (prefs.lightDay) lines.push(`Keep ${DAY_LONG[prefs.lightDay]} light`);
  if (prefs.onlyMoveLabsAndTutorials) lines.push("Only move labs and tutorials");
  if (prefs.lunchHour) {
    lines.push(`Free hour between ${formatTime(prefs.lunchHour.start)} and ${formatTime(prefs.lunchHour.end)}`);
  }
  if (prefs.labsSameDayAsLecture) lines.push("Labs on the same day as lecture");
  return lines.length > 0 ? lines : ["No priorities set"];
}

function PrioritiesCard({ prefs, onEdit, className }: { prefs: Preferences; onEdit: () => void; className: string }) {
  return (
    <section className={`rounded-2xl border border-line bg-white p-4 shadow-sm ${className}`}>
      <div className="flex items-baseline justify-between">
        <h2 className="font-display text-lg font-semibold">Your priorities</h2>
        <button type="button" onClick={onEdit} className="text-sm font-semibold text-brand-700 hover:underline">
          Edit
        </button>
      </div>
      <ul className="mt-2 list-disc space-y-1 pl-5 text-sm">
        {priorityLines(prefs).map((l) => <li key={l}>{l}</li>)}
      </ul>
    </section>
  );
}

export function Builder({ courses, schedule, term, onEditPriorities, myEvents }: Props) {
  const { picks, conflictReport, state } = schedule;
  const [previewIndex, setPreviewIndex] = useState<number | null>(null);

  // ---- Smart Resolve ----
  const fixResult = useMemo(
    () => suggestFixes(courses, picks, { ...state.prefs, lockedClassNumbers: state.locked }),
    [courses, picks, state.prefs, state.locked],
  );
  // How many fixes the locks are hiding: ask again without locks and count fixes that move a locked section.
  const hiddenByLocks = useMemo(() => {
    if (state.locked.length === 0 || fixResult.alreadyConflictFree) return 0;
    const locked = new Set(state.locked);
    return suggestFixes(courses, picks, { ...state.prefs, lockedClassNumbers: [] }).fixes.filter((f) =>
      f.moves.some((m) => locked.has(m.from.class_number)),
    ).length;
  }, [courses, picks, state.prefs, state.locked, fixResult.alreadyConflictFree]);

  // If there are no fixes, would relaxing the strict rules help at all?
  const fixableWithoutRules = useMemo(() => {
    if (fixResult.fixes.length > 0 || fixResult.alreadyConflictFree) return true;
    return suggestFixes(courses, picks, { ...state.prefs, lockedClassNumbers: [], onlyMoveLabsAndTutorials: false }).fixes.length > 0;
  }, [courses, picks, state.prefs, fixResult]);

  // Any change to the schedule ends a preview.
  useEffect(() => setPreviewIndex(null), [fixResult]);
  const appliedValid = schedule.applied;

  const preview = previewIndex !== null ? fixResult.fixes[previewIndex] : undefined;
  const shownPicks = preview ? preview.schedule : picks;
  const shownConflicts = preview ? findConflicts(preview.schedule).conflicts : conflictReport.conflicts;
  const shownConflicted = useMemo(() => {
    const set = new Set<number>();
    for (const c of shownConflicts) {
      set.add(c.a.section.class_number);
      set.add(c.b.section.class_number);
    }
    return set;
  }, [shownConflicts]);
  const activeFix = preview ?? appliedValid?.fix;
  const moved = new Set(activeFix?.moves.map((m) => m.to.class_number) ?? []);
  const ghosts: Pick[] = preview
    ? preview.moves.map((m) => ({ courseCode: m.courseCode, term: schedule.byCode.get(m.courseCode)!.term, section: m.from }))
    : [];

  function showWeekOnSmallScreens() {
    if (window.innerWidth < 1024) document.getElementById("week-view")?.scrollIntoView({ behavior: "smooth" });
  }

  function applyFix(index: number) {
    const fix = fixResult.fixes[index];
    if (!fix) return;
    schedule.applyChange(fix, `Fix ${index + 1}`);
    setPreviewIndex(null);
    showWeekOnSmallScreens();
  }

  const bannerMode: BannerMode = preview
    ? {
        kind: "preview",
        fixNumber: previewIndex! + 1,
        remaining: groupConflicts(shownConflicts).length,
        onCancel: () => setPreviewIndex(null),
        onApply: () => applyFix(previewIndex!),
      }
    : appliedValid
      ? { kind: "applied", name: appliedValid.name }
      : { kind: "normal" };

  // ---- Week view ----
  // Only this term's classes go on the grid (full-year courses show in both).
  const termPicks = shownPicks.filter((p) => termsOverlap(p.term, term) && p.section.meetings.length > 0);
  const termGhosts = ghosts.filter((p) => termsOverlap(p.term, term));
  const stats = scoreSchedule(termPicks)[term === "first_term" ? "firstTerm" : "secondTerm"];
  const classHours = termPicks.flatMap(blocksOfPick).reduce((sum, b) => sum + (b.end - b.start) / 60, 0);

  // Things the grid can't show.
  const online = picks.filter((p) => p.section.meetings.length === 0 && hasKnownTimes(p.section));
  const noTimes = state.choices
    .filter((c) => Object.keys(c.picks).length === 0)
    .map((c) => schedule.byCode.get(c.code))
    .filter((c): c is Course => !!c);
  const otherTermCourses = [...new Set(picks.filter((p) => !termsOverlap(p.term, term)).map((p) => p.courseCode))];

  const colorOf = (code: string) => state.choices.find((c) => c.code === code)?.colorIndex ?? 0;
  const locked = new Set(state.locked);
  const previewMoves = new Map(preview?.moves.map((m) => [`${m.courseCode}|${m.component}`, m.to]) ?? []);

  return (
    <div className="mx-auto grid max-w-[1400px] grid-cols-[minmax(0,1fr)] gap-4 px-4 py-4 lg:grid-cols-[minmax(260px,320px)_minmax(0,1fr)_minmax(280px,360px)] lg:items-start">
      {/* Left: add + my courses + priorities */}
      <div className="min-w-0 space-y-4">
        <CourseSearch
          courses={courses}
          addedCodes={new Set(state.choices.map((c) => c.code))}
          onAdd={schedule.addCourse}
        />
        <MyCourses schedule={schedule} previewSections={previewMoves} moved={moved} />
        <PrioritiesCard prefs={state.prefs} onEdit={onEditPriorities} className="hidden lg:block" />
      </div>

      {/* Middle: banner + week */}
      <div className="min-w-0 space-y-4">
        <ConflictBanner conflicts={shownConflicts} courseCount={state.choices.length} mode={bannerMode} />

        <section id="week-view" className="scroll-mt-4 rounded-2xl border border-line bg-white shadow-sm">
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
            <WeekGrid
              picks={termPicks}
              colorOf={colorOf}
              conflicted={shownConflicted}
              locked={locked}
              moved={moved}
              ghosts={termGhosts}
              events={eventsForGrid(myEvents.added, term)}
            />
          </div>
        </section>

        <div className="flex flex-wrap items-start justify-between gap-3">
          <ul className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted" aria-label="Legend">
            <li className="flex items-center gap-1.5"><span className="h-3 w-5 rounded border-2 border-conflict-600 bg-[#fff4ec]" />Time conflict</li>
            <li className="flex items-center gap-1.5"><span className="h-3 w-5 rounded border-2 border-dashed border-brand-700" />Moved by a fix</li>
            <li className="flex items-center gap-1.5"><span className="h-3 w-5 rounded border-2 border-dashed border-brand-600/40" />Where it was</li>
            <li className="flex items-center gap-1.5"><span className="h-3 w-5 rounded bg-brand-700" />Locked section</li>
            <li className="flex items-center gap-1.5"><span className="h-3 w-5 rounded border-2 border-dashed border-good-700 bg-good-50" />Your club event</li>
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

      {/* Right: Smart Resolve */}
      <aside className="min-w-0 space-y-4">
        <SmartResolve
          result={fixResult}
          hiddenByLocks={hiddenByLocks}
          fixableWithoutRules={fixableWithoutRules}
          current={picks}
          gridTerm={term}
          previewIndex={previewIndex}
          applied={appliedValid}
          onPreview={(i) => {
            setPreviewIndex(i);
            if (i !== null) showWeekOnSmallScreens();
          }}
          onApply={applyFix}
          onUndo={schedule.undoApplied}
          warningsFor={(fix) => fixEventWarnings(fix, myEvents.added, (code) => schedule.byCode.get(code)?.term ?? "unknown")}
        />
        {fixResult.fixes.length > 0 && (
          <a
            href="#compare"
            className="flex items-center justify-between rounded-2xl border border-line bg-white px-4 py-3 text-sm font-semibold text-brand-700 shadow-sm hover:border-brand-200"
          >
            Compare every fix as a full week <span aria-hidden>→</span>
          </a>
        )}
        <FitsPanel picks={picks} myEvents={myEvents} />
        <PrioritiesCard prefs={state.prefs} onEdit={onEditPriorities} className="lg:hidden" />
      </aside>
    </div>
  );
}
