import type { Fix, FixResult, Pick } from "@slotted/engine";
import { formatTime, plural, TERM_LABELS } from "../lib/format";
import { explainFix, fixTerm, moveTimes, splitLabel, termStats } from "../lib/fixText";
import { LockIcon, ShuffleIcon } from "./icons";

type GridTerm = "first_term" | "second_term";

interface Props {
  result: FixResult;
  /** Fixes left out because they would move a locked section. */
  hiddenByLocks: number;
  /** False if no fix exists even with locks and "only move labs" turned off. */
  fixableWithoutRules: boolean;
  current: Pick[];
  gridTerm: GridTerm;
  previewIndex: number | null;
  applied: { fix: Fix; index: number } | null;
  onPreview: (index: number | null) => void;
  onApply: (index: number) => void;
  onUndo: () => void;
}

const hours = (h: number) => (Number.isInteger(h) ? `${h}h` : `${h.toFixed(1)}h`);

function FixCard({
  fix, index, current, gridTerm, previewing, applied, onPreview, onApply,
}: {
  fix: Fix; index: number; current: Pick[]; gridTerm: GridTerm;
  previewing: boolean; applied: boolean;
  onPreview?: () => void; onApply?: () => void;
}) {
  const { title, notes } = splitLabel(fix.label);
  const term = fixTerm(fix, gridTerm);
  const stats = termStats(fix.schedule, term);
  const highlight = previewing ? "border-brand-600 ring-2 ring-brand-200" : applied ? "border-ok-700 ring-2 ring-[#bcd7f4]" : "border-line";

  return (
    <article className={`rounded-xl border bg-white p-3.5 ${highlight}`} aria-label={`Fix ${index + 1}: ${title}`}>
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs font-semibold tracking-wide text-muted">FIX {index + 1}</span>
        {index === 0 && (
          <span className="rounded-full bg-brand-700 px-2 py-0.5 text-[11px] font-semibold text-white">
            Best match for your priorities
          </span>
        )}
      </div>
      <h3 className="mt-1 font-display font-semibold">{title}</h3>
      {notes.length > 0 && (
        <ul className="mt-1 flex flex-wrap gap-1">
          {notes.map((n) => (
            <li
              key={n}
              className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${
                n.startsWith("Uses a full") ? "bg-[#fdf3d6] text-[#7a5300]" : "bg-brand-50 text-brand-700"
              }`}
            >
              {n}
            </li>
          ))}
        </ul>
      )}

      <ul className="mt-2 space-y-1.5">
        {fix.moves.map((m) => {
          const { from, to } = moveTimes(m);
          return (
            <li key={m.from.class_number} className="rounded-lg bg-page px-2.5 py-2">
              <div className="text-sm font-semibold">
                {m.courseCode} {m.component} {m.from.section} → {m.to.section}
                {m.to.full && <span className="ml-1.5 text-[11px] font-semibold text-[#7a5300]">Full</span>}
              </div>
              <div className="text-xs text-muted">{from} → {to}</div>
            </li>
          );
        })}
      </ul>

      <dl className="mt-2.5 grid grid-cols-3 gap-2 text-xs">
        <div><dt className="text-muted">Downtime</dt><dd className="text-sm font-semibold">{hours(stats.gapHours)}</dd></div>
        <div><dt className="text-muted">Done by</dt><dd className="text-sm font-semibold">{stats.latestEnd ? formatTime(stats.latestEnd) : "–"}</dd></div>
        <div><dt className="text-muted">Friday</dt><dd className="text-sm font-semibold">{plural(stats.fridayClasses, "class", "classes")}</dd></div>
      </dl>
      <p className="mt-1 text-[11px] text-muted">Stats for your {TERM_LABELS[term]} week.</p>
      <p className="mt-2 text-xs text-muted">{explainFix(fix, current, term)}</p>

      {(onPreview || onApply) && (
        <div className="mt-3 grid grid-cols-2 gap-2">
          <button
            type="button"
            onClick={onPreview}
            aria-pressed={previewing}
            className="rounded-lg border border-line px-3 py-2 text-sm font-semibold hover:border-brand-200"
          >
            {previewing ? "Stop preview" : "Preview"}
          </button>
          <button
            type="button"
            onClick={onApply}
            className="rounded-lg bg-brand-700 px-3 py-2 text-sm font-semibold text-white hover:bg-brand-800"
          >
            Apply fix
          </button>
        </div>
      )}
    </article>
  );
}

export function SmartResolve(props: Props) {
  const { result, hiddenByLocks, current, gridTerm, previewIndex, applied } = props;
  const conflictCount = result.fixes.length > 0 || !result.alreadyConflictFree;

  return (
    <section id="smart-resolve" className="scroll-mt-4 rounded-2xl border border-line bg-white p-4 shadow-sm">
      <div className="flex items-center gap-2">
        <span className="grid size-8 place-items-center rounded-lg bg-brand-50 text-brand-700"><ShuffleIcon /></span>
        <h2 className="font-display text-lg font-semibold">Smart Resolve</h2>
      </div>

      {applied && result.alreadyConflictFree ? (
        <>
          <div className="mt-3 flex items-center justify-between gap-2 rounded-xl bg-ok-50 px-3 py-2.5">
            <span className="text-sm font-medium text-ok-700">Fix {applied.index + 1} is on your schedule.</span>
            <button
              type="button"
              onClick={props.onUndo}
              className="rounded-lg border border-[#bcd7f4] bg-white px-3 py-1.5 text-sm font-semibold text-ok-700"
            >
              Undo
            </button>
          </div>
          <div className="mt-3">
            <FixCard fix={applied.fix} index={applied.index} current={current} gridTerm={gridTerm} previewing={false} applied />
          </div>
        </>
      ) : result.alreadyConflictFree ? (
        <p className="mt-2 text-sm text-muted">No overlaps right now. If two sections clash, fixes will appear here.</p>
      ) : (
        <>
          <p className="mt-2 text-sm text-muted">
            Sections in your picks overlap. Each fix below swaps to other sections of the same courses,
            so you keep every course and nothing needs re-adding.
          </p>
          {hiddenByLocks > 0 && (
            <p className="mt-2 flex items-center gap-1.5 text-xs text-muted">
              <LockIcon className="size-3.5" />
              {plural(hiddenByLocks, "fix", "fixes")} hidden because {hiddenByLocks === 1 ? "it moves" : "they move"} a locked section.
            </p>
          )}
          {result.fixes.length === 0 && conflictCount && (
            <p className="mt-3 rounded-xl bg-conflict-50 px-3 py-2.5 text-sm text-conflict-700">
              {props.fixableWithoutRules
                ? `${result.reason ?? "No fix found."} Try unlocking a section or turning off "Only move labs and tutorials" in your priorities.`
                : "These sections have no other times that fit together, even if every section could move. You may need to drop one of these courses or take it in another term."}
            </p>
          )}
          <div className="mt-3 space-y-3">
            {result.fixes.map((fix, i) => (
              <FixCard
                key={i}
                fix={fix}
                index={i}
                current={current}
                gridTerm={gridTerm}
                previewing={previewIndex === i}
                applied={false}
                onPreview={() => props.onPreview(previewIndex === i ? null : i)}
                onApply={() => props.onApply(i)}
              />
            ))}
          </div>
        </>
      )}
    </section>
  );
}
