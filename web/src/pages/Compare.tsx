import { useMemo } from "react";
import { findConflicts, termsOverlap, type Course, type Fix, type Pick } from "@slotted/engine";
import { groupConflicts } from "../components/ConflictBanner";
import { MiniWeek } from "../components/MiniWeek";
import { formatTime, plural, sectionLabel, TERM_LABELS } from "../lib/format";
import { fixTerm, moveTimes, termStats } from "../lib/fixText";
import { blocksOfPick } from "../lib/grid";
import { buildWeekOptions, type WeekOption } from "../lib/weekOptions";
import type { ScheduleApi } from "../state/useSchedule";

type GridTerm = "first_term" | "second_term";

interface Props {
  courses: Course[];
  schedule: ScheduleApi;
  term: GridTerm;
  onUseWeek: (option: WeekOption) => void;
  onEditPriorities: () => void;
}

const hours = (h: number) => (Number.isInteger(h) ? `${h}h` : `${h.toFixed(1)}h`);
const MINI_HEIGHT = 240;

function Stat({ label, value, tone }: { label: string; value: string; tone?: "bad" | "good" }) {
  const color = tone === "bad" ? "text-conflict-700" : tone === "good" ? "text-ok-700" : "";
  return (
    <div>
      <dt className="text-xs text-muted">{label}</dt>
      <dd className={`text-base font-semibold ${color}`}>{value}</dd>
    </div>
  );
}

export function Compare({ courses, schedule, term, onUseWeek, onEditPriorities }: Props) {
  const { picks, state } = schedule;
  const { kind, options, reason } = useMemo(
    () => buildWeekOptions(courses, picks, state.prefs, state.locked, term),
    [courses, picks, state.prefs, state.locked, term],
  );

  // Which term to draw: the one the changes are in (fall back to the header's term).
  const shownTerm: GridTerm = options[0] ? fixTerm(options[0].fix, term) : term;
  const inTerm = (ps: Pick[]) => ps.filter((p) => termsOverlap(p.term, shownTerm) && p.section.meetings.length > 0);

  const weeks: { key: string; schedule: Pick[] }[] = [
    { key: "current", schedule: picks },
    ...options.map((o) => ({ key: o.name, schedule: o.fix.schedule })),
  ];

  // Sections that are in every week are "the same" (faded). The rest are what differ.
  const different = useMemo(() => {
    const sets = weeks.map((w) => new Set(w.schedule.map((p) => p.section.class_number)));
    const all = new Set(sets.flatMap((s) => [...s]));
    return new Set([...all].filter((n) => !sets.every((s) => s.has(n))));
  }, [weeks]);

  // Shared hour range so all mini-weeks line up.
  const allBlocks = weeks.flatMap((w) => inTerm(w.schedule).flatMap(blocksOfPick));
  const first = Math.floor(Math.min(9 * 60, ...allBlocks.map((b) => b.start)) / 60) * 60;
  const last = Math.ceil(Math.max(18 * 60, ...allBlocks.map((b) => b.end)) / 60) * 60;

  const colorOf = (code: string) => state.choices.find((c) => c.code === code)?.colorIndex ?? 0;
  const courseCount = state.choices.length;
  const currentPairs = groupConflicts(findConflicts(picks).conflicts);
  const currentConflicted = new Set(currentPairs.flatMap((p) => [p.a.section.class_number, p.b.section.class_number]));
  const numberLegend = [...new Set(picks.map((p) => p.courseCode))]
    .map((code) => `${code.split(" ")[1].slice(0, 4)} = ${code}`)
    .join(", ");

  if (courseCount === 0) {
    return (
      <div className="mx-auto max-w-3xl px-4 py-10 text-center">
        <h1 className="font-display text-2xl font-bold">Compare weeks</h1>
        <p className="mt-2 text-muted">Add some courses in the Builder first.</p>
        <a href="#builder" className="mt-4 inline-block rounded-lg bg-brand-700 px-4 py-2 font-semibold text-white">Go to Builder</a>
      </div>
    );
  }

  function card(option: WeekOption | null, index: number) {
    const fix: Fix | null = option?.fix ?? null;
    const schedule = fix ? fix.schedule : picks;
    const stats = termStats(schedule, shownTerm);
    const pairs = fix ? groupConflicts(findConflicts(schedule).conflicts) : currentPairs;
    const moved = new Set(fix?.moves.map((m) => m.to.class_number) ?? []);
    const best = option?.best ?? false;
    return (
      <article
        key={option?.name ?? "current"}
        className={`flex flex-col rounded-2xl border bg-white p-4 shadow-sm ${best ? "border-brand-600 ring-2 ring-brand-200" : "border-line"}`}
      >
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs font-semibold tracking-wide text-muted uppercase">{option?.name ?? "Your picks"}</span>
          {!option && pairs.length > 0 && (
            <span className="rounded-full bg-conflict-50 px-2 py-0.5 text-[11px] font-semibold text-conflict-700 ring-1 ring-conflict-200">
              {plural(pairs.length, "conflict")}
            </span>
          )}
          {best && <span className="rounded-full bg-brand-700 px-2 py-0.5 text-[11px] font-semibold text-white">Best match</span>}
        </div>
        <h2 className="mt-1 font-display text-lg font-semibold">
          {option ? option.title : "As you built it"}
        </h2>
        {option && option.notes.length > 0 && (
          <ul className="mt-1 flex flex-wrap gap-1">
            {option.notes.map((n) => (
              <li key={n} className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${n.startsWith("Uses a full") ? "bg-[#fdf3d6] text-[#7a5300]" : "bg-brand-50 text-brand-700"}`}>{n}</li>
            ))}
          </ul>
        )}

        <div className="mt-3">
          <MiniWeek
            picks={inTerm(schedule)}
            first={first}
            last={last}
            height={MINI_HEIGHT}
            colorOf={colorOf}
            conflicted={fix ? new Set() : currentConflicted}
            different={different}
            moved={moved}
            label={`${option?.name ?? "Your picks"} week, ${TERM_LABELS[shownTerm]}`}
          />
        </div>

        <dl className="mt-3 grid grid-cols-2 gap-x-3 gap-y-2">
          <Stat label="Conflicts" value={String(pairs.length)} tone={pairs.length > 0 ? "bad" : "good"} />
          <Stat label="Downtime / week" value={hours(stats.gapHours)} />
          <Stat label="Done by" value={stats.latestEnd ? formatTime(stats.latestEnd) : "–"} />
          <Stat label="Friday" value={plural(stats.fridayClasses, "class", "classes")} />
        </dl>

        <div className="mt-3 flex-1 text-sm">
          {option ? (
            <>
              <h3 className="font-semibold">What moves</h3>
              <ul className="mt-1 space-y-0.5 text-muted">
                {fix!.moves.map((m) => (
                  <li key={m.from.class_number}>
                    {m.courseCode} {m.component} {m.from.section} → {m.to.section}{" "}
                    <span className="whitespace-nowrap">({moveTimes(m).to})</span>
                    {m.to.full && <b className="ml-1 text-[#7a5300]">Full</b>}
                  </li>
                ))}
              </ul>
            </>
          ) : pairs.length > 0 ? (
            <>
              <h3 className="font-semibold">Overlapping right now</h3>
              <ul className="mt-1 space-y-0.5 text-muted">
                {pairs.map((p) => (
                  <li key={`${p.a.section.class_number}-${p.b.section.class_number}`}>
                    {p.a.courseCode} {sectionLabel(p.a.section)} and {p.b.courseCode} {sectionLabel(p.b.section)} ({p.when.map((w) => w.split(" ")[0]).join(", ")})
                  </li>
                ))}
              </ul>
            </>
          ) : (
            <p className="text-muted">Your current week. No conflicts.</p>
          )}
        </div>

        <div className="mt-4">
          {option ? (
            <button
              type="button"
              onClick={() => onUseWeek(option)}
              className={`w-full rounded-lg px-3 py-2.5 text-sm font-semibold ${
                best ? "bg-brand-700 text-white hover:bg-brand-800" : "border border-brand-200 text-brand-700 hover:bg-brand-50"
              }`}
            >
              Use this week
            </button>
          ) : (
            <a href="#builder" className="block w-full rounded-lg border border-line px-3 py-2.5 text-center text-sm font-semibold hover:border-brand-200">
              Back to builder
            </a>
          )}
        </div>
      </article>
    );
  }

  return (
    <div className="mx-auto max-w-[1400px] px-4 py-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="max-w-3xl">
          <h1 className="font-display text-2xl font-bold sm:text-3xl">Compare conflict-free weeks</h1>
          <p className="mt-1 text-muted">
            {kind === "fixes"
              ? `Every fix keeps all ${plural(courseCount, "course")}. They only differ in which sections you land in, so pick the week that fits your life.`
              : `Your week has no conflicts. Here are other conflict-free weeks with the same ${plural(courseCount, "course")}, in case one suits you better.`}{" "}
            Showing your {TERM_LABELS[shownTerm]} week.
          </p>
        </div>
        <button
          type="button"
          onClick={onEditPriorities}
          aria-haspopup="dialog"
          className="rounded-lg border border-line bg-white px-3 py-2 text-sm font-semibold hover:border-brand-200 hover:text-brand-700"
        >
          Change ranking priorities
        </button>
      </div>

      {reason && options.length === 0 && (
        <p className="mt-4 rounded-xl bg-conflict-50 px-4 py-3 text-sm text-conflict-700">{reason}</p>
      )}

      <div className="mt-5 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {card(null, 0)}
        {options.map((o, i) => card(o, i + 1))}
      </div>

      <ul className="mt-4 flex flex-wrap gap-x-5 gap-y-1 text-xs text-muted" aria-label="Legend">
        <li className="flex items-center gap-1.5"><span className="h-3 w-5 rounded border-2 border-conflict-600 bg-[#fff4ec]" />Time conflict</li>
        <li className="flex items-center gap-1.5"><span className="h-3 w-5 rounded border-2 border-dashed border-brand-700" />Section that moves</li>
        <li className="flex items-center gap-1.5"><span className="h-3 w-5 rounded border border-line bg-brand-100 opacity-35" />Same in every week</li>
        <li>Blocks are labelled by course number: {numberLegend}.</li>
      </ul>
    </div>
  );
}
