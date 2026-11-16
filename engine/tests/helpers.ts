// Test helpers. The TESTS read data/courses.json; the engine itself never does.
//
// These tests use real courses as they were scraped on 2026-11-16. If the data
// is re-scraped and Western has changed a time, a test may fail for that
// reason. Each test names the times it relies on.

import { readFileSync } from "node:fs";
import type { Course, Pick } from "../src/types";

const file = new URL("../../data/courses.json", import.meta.url);
export const catalog: Course[] = JSON.parse(readFileSync(file, "utf-8")).courses;

/** Look up a real section, e.g. pick("COMPSCI 1020A", "LEC", "001"). */
export function pick(courseCode: string, component: string, section: string): Pick {
  const course = catalog.find((c) => c.code === courseCode);
  if (!course) throw new Error(`Course not in data: ${courseCode}`);
  const found = course.sections.find((s) => s.component === component && s.section === section);
  if (!found) throw new Error(`Section not in data: ${courseCode} ${component} ${section}`);
  return { courseCode, term: course.term, section: found };
}

/** "Mon 09:30-11:30, Wed 09:30-10:30" */
export function times(p: Pick): string {
  return p.section.meetings.map((m) => `${m.day} ${m.start}-${m.end}`).join(", ");
}
