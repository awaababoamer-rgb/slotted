// THE ONLY FILE THAT KNOWS WHERE COURSE DATA COMES FROM.
//
// Course data lives in Supabase (tables: courses, sections, catalog_meta) and can
// only be read by signed-in @uwo.ca users. It is NOT bundled into the website and
// NOT in git, because the times/rooms/instructors come from Draft My Schedule.

import type { Course, Meeting, Section, Term } from "@slotted/engine";
import { fetchAll, requireSupabase } from "./supabase";

export interface Catalog {
  courses: Course[];
  /** When the public timetable was last scraped (ISO date), if known. */
  lastUpdated: string | null;
  /** When meeting times were last collected from Draft My Schedule, if known. */
  timesLastUpdated: string | null;
}

interface CourseRow {
  code: string; subject: string; number: string; suffix: string;
  title: string; term: Term; description: string;
}

interface SectionRow {
  class_number: number; course_code: string; section: string; component: string;
  full: boolean; status: string; campus: string; delivery: string; notes: string;
  requisites: string; instructors: string[]; meetings: Meeting[];
  credit_units: string | null; waitlist: number | null;
  data_source: "public" | "dms"; dms_updated: string | null;
}

export async function loadCatalog(): Promise<Catalog> {
  const [courseRows, sectionRows, meta] = await Promise.all([
    fetchAll<CourseRow>("courses", "code,subject,number,suffix,title,term,description", "code"),
    fetchAll<SectionRow>("sections", "*", "class_number"),
    requireSupabase().from("catalog_meta").select("last_updated,dms_last_updated").maybeSingle(),
  ]);
  if (meta.error) throw new Error(`Couldn't read catalog info: ${meta.error.message}`);

  const byCode = new Map<string, Course>();
  for (const row of courseRows) byCode.set(row.code, { ...row, sections: [] });
  for (const row of sectionRows) {
    const course = byCode.get(row.course_code);
    if (!course) continue;
    const { course_code: _code, credit_units, waitlist, dms_updated, ...rest } = row;
    const section: Section = { ...rest };
    if (credit_units !== null) section.credit_units = credit_units;
    if (waitlist !== null) section.waitlist = waitlist;
    if (dms_updated !== null) section.dms_updated = dms_updated;
    course.sections.push(section);
  }

  return {
    courses: [...byCode.values()],
    lastUpdated: meta.data?.last_updated ?? null,
    timesLastUpdated: meta.data?.dms_last_updated ?? null,
  };
}
