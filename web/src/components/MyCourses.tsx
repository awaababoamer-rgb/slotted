import { courseCredits, hasKnownTimes, type Course, type Section } from "@slotted/engine";
import type { Ratings } from "../data/reviews";
import { colorFor } from "../lib/colors";
import { courseHref } from "../pages/Reviews";
import { formatCredits, formatMeetings, plural, sectionLabel, termTag } from "../lib/format";
import type { ScheduleApi } from "../state/useSchedule";
import { CloseIcon, LockIcon } from "./icons";

const COMPONENT_ORDER = ["LEC", "LAB", "TUT"];

function sectionSummary(section: Section): string {
  if (section.meetings.length === 0) {
    return hasKnownTimes(section) ? "Online – no fixed meeting time" : "Times not available yet";
  }
  return formatMeetings(section.meetings);
}

function optionLabel(section: Section): string {
  const bits = [sectionLabel(section), sectionSummary(section)];
  if (section.full) bits.push("FULL");
  return bits.join(" · ");
}

function Tag({ tone, children }: { tone: "conflict" | "full" | "info"; children: React.ReactNode }) {
  const styles = {
    conflict: "bg-conflict-50 text-conflict-700 ring-conflict-200",
    full: "bg-[#fdf3d6] text-[#7a5300] ring-[#efd9a0]",
    info: "bg-brand-50 text-brand-700 ring-brand-200",
  }[tone];
  return <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ring-1 ${styles}`}>{children}</span>;
}

function SectionRow({
  course, component, section, schedule, isMoved, previewing, profRatings,
}: {
  course: Course; component: string; section: Section; schedule: ScheduleApi;
  isMoved: boolean; previewing: boolean; profRatings: Map<string, Ratings>;
}) {
  const locked = schedule.state.locked.includes(section.class_number);
  const conflict = !previewing && schedule.conflictedClassNumbers.has(section.class_number);
  const others = course.sections.filter((s) => s.component === component && hasKnownTimes(s));
  const instructorList = (section.instructors as string[] | undefined) ?? [];
  const waitlist = typeof section.waitlist === "number" ? section.waitlist : null;
  const selectId = `sec-${section.class_number}`;

  return (
    <div className="flex items-start gap-3 py-2">
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="text-sm font-semibold">{sectionLabel(section)}</span>
          {conflict && <Tag tone="conflict">Conflict</Tag>}
          {isMoved && <Tag tone="info">Moved</Tag>}
          {section.full && <Tag tone="full">Full</Tag>}
          {waitlist !== null && waitlist > 0 && <Tag tone="info">{waitlist} on waitlist</Tag>}
        </div>
        <div className="text-xs text-muted">{sectionSummary(section)}</div>
        <div className="text-xs text-muted">
          {instructorList.map((name, i) => {
            const r = profRatings.get(`${course.code}|${name}`);
            return (
              <span key={name}>
                {i > 0 ? ", " : ""}
                {name}
                {r && (
                  <a
                    href={courseHref(course.code)}
                    title={`${name} in ${course.code}: ${r.overall.toFixed(1)}/5 from ${r.review_count} review${r.review_count === 1 ? "" : "s"}`}
                    className="ml-1 font-semibold text-[#9a6b00] hover:underline"
                  >
                    ★ {r.overall.toFixed(1)} ({r.review_count})
                  </a>
                )}
              </span>
            );
          })}
        </div>
        {others.length > 1 && (
          <>
            <label htmlFor={selectId} className="sr-only">
              Change {course.code} {component} section
            </label>
            <select
              id={selectId}
              value={section.class_number}
              disabled={locked || previewing}
              onChange={(e) => schedule.changeSection(course.code, component, Number(e.target.value))}
              className="mt-1.5 w-full max-w-full truncate rounded-md border border-line bg-white px-2 py-1 text-xs disabled:opacity-60"
            >
              {others.map((s) => (
                <option key={s.class_number} value={s.class_number}>{optionLabel(s)}</option>
              ))}
            </select>
          </>
        )}
      </div>
      <button
        type="button"
        onClick={() => schedule.toggleLock(section.class_number)}
        aria-pressed={locked}
        aria-label={`${locked ? "Unlock" : "Lock"} ${course.code} ${sectionLabel(section)}`}
        title={locked ? "Locked: Smart Resolve will never move this" : "Lock this section"}
        className={`grid size-9 shrink-0 place-items-center rounded-lg border transition ${
          locked ? "border-brand-700 bg-brand-700 text-white" : "border-line text-muted hover:border-brand-200 hover:text-brand-700"
        }`}
      >
        <LockIcon open={!locked} />
      </button>
    </div>
  );
}

interface Props {
  schedule: ScheduleApi;
  /** While previewing a fix: "COURSE|COMPONENT" -> the section it would move to. */
  previewSections?: Map<string, Section>;
  /** Class numbers a fix moved (or would move). */
  moved?: Set<number>;
  /** Professor averages, keyed "COURSE|Professor". */
  profRatings?: Map<string, Ratings>;
}

export function MyCourses({ schedule, previewSections = new Map(), moved = new Set(), profRatings = new Map() }: Props) {
  const { choices } = schedule.state;
  const previewing = previewSections.size > 0;

  return (
    <section className="rounded-2xl border border-line bg-white p-4 shadow-sm">
      <div className="flex items-baseline justify-between">
        <h2 className="font-display text-lg font-semibold">My courses</h2>
        <span className="text-xs text-muted">{plural(choices.length, "course")}</span>
      </div>
      <div className="mt-2 border-b border-line" />

      {choices.length === 0 && (
        <p className="py-6 text-center text-sm text-muted">Add a course above to start building your week.</p>
      )}

      <ul className="divide-y divide-line">
        {choices.map((choice) => {
          const course = schedule.byCode.get(choice.code);
          if (!course) return null;
          const color = colorFor(choice.colorIndex);
          const components = [...new Set(course.sections.map((s) => s.component))].sort(
            (a, b) => COMPONENT_ORDER.indexOf(a) - COMPONENT_ORDER.indexOf(b),
          );
          return (
            <li key={choice.code} className="py-3">
              <div className="flex items-start gap-2">
                <span
                  className="mt-1.5 size-2.5 shrink-0 rounded-sm border"
                  style={{ background: color.bg, borderColor: color.text }}
                  aria-hidden
                />
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-baseline gap-x-2">
                    <h3 className="text-sm font-bold">
                      <a href={courseHref(course.code)} className="hover:text-brand-700 hover:underline" title="Reviews">{course.code}</a>
                    </h3>
                    <span className="text-[11px] text-muted">{termTag(course.term)} · {formatCredits(courseCredits(course))} credit</span>
                  </div>
                  <p className="truncate text-xs text-muted">{String(course.title ?? "")}</p>
                </div>
                <button
                  type="button"
                  onClick={() => schedule.removeCourse(course.code)}
                  aria-label={`Remove ${course.code}`}
                  className="grid size-7 place-items-center rounded-md text-muted hover:bg-page hover:text-ink"
                >
                  <CloseIcon />
                </button>
              </div>

              <div className="pl-4.5">
                {components.map((component) => {
                  const classNumber = choice.picks[component];
                  const section =
                    previewSections.get(`${course.code}|${component}`) ??
                    course.sections.find((s) => s.class_number === classNumber);
                  if (!section) {
                    return (
                      <div key={component} className="py-2">
                        <span className="text-sm font-semibold">{component}</span>
                        <p className="text-xs font-medium text-conflict-700">
                          Times not available yet, so this can't go on the grid.
                        </p>
                      </div>
                    );
                  }
                  return (
                    <SectionRow
                      key={component}
                      course={course}
                      component={component}
                      section={section}
                      schedule={schedule}
                      isMoved={moved.has(section.class_number)}
                      previewing={previewing}
                      profRatings={profRatings}
                    />
                  );
                })}
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
