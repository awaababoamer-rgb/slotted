import { fitCourse, type Course, type Pick, type Preferences } from "@slotted/engine";
import { courseHasTimes } from "../state/useSchedule";

// A program lists a course that runs in either term ("Computer Science 2208A/B") as
// one entry with alternatives: "COMPSCI 2208A|COMPSCI 2208B". Students take ONE of them.

export function entryVariants(entry: string): string[] {
  return entry.split("|").map((c) => c.trim()).filter(Boolean);
}

/** "COMPSCI 2208A|COMPSCI 2208B" -> "COMPSCI 2208A/B" */
export function entryLabel(entry: string): string {
  const [first, ...rest] = entryVariants(entry);
  if (!first) return entry;
  const base = first.slice(0, -1);
  if (rest.every((c) => c.slice(0, -1) === base)) return [first, ...rest.map((c) => c.slice(-1))].join("/");
  return [first, ...rest].join(" or ");
}

/**
 * Which variant to use: one you already have; else one offered that fits your week
 * (no clashes); else one with known times; else any offered. Undefined if none is offered.
 */
export function resolveEntry(
  entry: string,
  byCode: Map<string, Course>,
  mine: Set<string>,
  picks: Pick[],
  prefs: Preferences = {},
): Course | undefined {
  const offered = entryVariants(entry).map((c) => byCode.get(c)).filter((c): c is Course => !!c);
  return (
    offered.find((c) => mine.has(c.code)) ??
    offered.find((c) => fitCourse(c, picks, prefs).fits) ??
    offered.find(courseHasTimes) ??
    offered[0]
  );
}
