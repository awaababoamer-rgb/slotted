import type { Conflict } from "@slotted/engine";
import { formatRange, plural, sectionLabel } from "../lib/format";
import { CheckCircleIcon, WarningIcon } from "./icons";

const name = (c: Conflict["a"]) => `${c.courseCode} ${sectionLabel(c.section)}`;

/** One entry per pair of clashing sections, listing every day they overlap. */
export function groupConflicts(conflicts: Conflict[]) {
  const pairs = new Map<string, { a: Conflict["a"]; b: Conflict["b"]; when: string[] }>();
  for (const c of conflicts) {
    const key = [c.a.section.class_number, c.b.section.class_number].sort().join("-");
    if (!pairs.has(key)) pairs.set(key, { a: c.a, b: c.b, when: [] });
    pairs.get(key)!.when.push(`${c.day} ${formatRange(c.start, c.end)}`);
  }
  return [...pairs.values()];
}

export type BannerMode =
  | { kind: "normal" }
  | { kind: "preview"; fixNumber: number; remaining: number; onCancel: () => void; onApply: () => void }
  | { kind: "applied"; name: string };

interface Props {
  conflicts: Conflict[];
  courseCount: number;
  mode: BannerMode;
}

export function ConflictBanner({ conflicts, courseCount, mode }: Props) {
  if (courseCount === 0) return null;
  const pairs = groupConflicts(conflicts);

  if (mode.kind === "preview") {
    return (
      <div role="status" className="flex flex-wrap items-center gap-3 rounded-2xl border border-brand-200 bg-brand-50 px-4 py-3 text-brand-800">
        <p className="min-w-0 flex-1 text-sm">
          <b>
            Previewing Fix {mode.fixNumber}:{" "}
            {mode.remaining === 0 ? "no conflicts left." : `${plural(mode.remaining, "conflict")} left.`}
          </b>{" "}
          Dashed outlines show what moves; faded outlines show where it was.
        </p>
        <div className="flex gap-2">
          <button type="button" onClick={mode.onCancel} className="rounded-lg border border-line bg-white px-3 py-2 text-sm font-semibold text-ink">
            Cancel
          </button>
          <button type="button" onClick={mode.onApply} className="rounded-lg bg-brand-700 px-3 py-2 text-sm font-semibold text-white hover:bg-brand-800">
            Apply this fix
          </button>
        </div>
      </div>
    );
  }

  if (pairs.length === 0) {
    const text =
      mode.kind === "applied"
        ? `${mode.name} applied. No conflicts, all ${plural(courseCount, "course")} kept.`
        : `No time conflicts. All ${plural(courseCount, "course")} fit.`;
    return (
      <div role="status" className="flex items-center gap-2 rounded-2xl border border-good-200 bg-good-50 px-4 py-3 text-sm font-medium text-good-700 transition-colors duration-500">
        <CheckCircleIcon />
        {text}
      </div>
    );
  }

  return (
    <div role="alert" className="rounded-2xl border border-conflict-200 bg-conflict-50 px-4 py-3 text-conflict-700 transition-colors duration-500">
      <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-1">
        <div className="flex items-center gap-2">
          <WarningIcon />
          <h2 className="font-display font-semibold">
            {plural(pairs.length, "time conflict")} in your schedule
          </h2>
        </div>
        <a href="#smart-resolve" className="text-sm font-semibold underline-offset-2 hover:underline">
          Pick a fix <span className="lg:hidden">below</span><span className="hidden lg:inline">on the right</span>
        </a>
      </div>
      <ul className="mt-1 space-y-0.5 pl-7 text-sm">
        {pairs.map((p) => (
          <li key={`${p.a.section.class_number}-${p.b.section.class_number}`}>
            {name(p.a)} overlaps {name(p.b)} · {p.when.join(", ")}
          </li>
        ))}
      </ul>
    </div>
  );
}
