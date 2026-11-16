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

export function ConflictBanner({ conflicts, courseCount }: { conflicts: Conflict[]; courseCount: number }) {
  if (courseCount === 0) return null;
  const pairs = groupConflicts(conflicts);

  if (pairs.length === 0) {
    return (
      <div role="status" className="flex items-center gap-2 rounded-2xl border border-[#bcd7f4] bg-ok-50 px-4 py-3 text-sm font-medium text-ok-700">
        <CheckCircleIcon />
        No time conflicts. All {plural(courseCount, "course")} fit.
      </div>
    );
  }

  return (
    <div role="alert" className="rounded-2xl border border-conflict-200 bg-conflict-50 px-4 py-3 text-conflict-700">
      <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-1">
        <div className="flex items-center gap-2">
          <WarningIcon />
          <h2 className="font-display font-semibold">
            {plural(pairs.length, "time conflict")} in your schedule
          </h2>
        </div>
        <span className="text-sm font-medium">Smart Resolve can fix this (coming next)</span>
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
