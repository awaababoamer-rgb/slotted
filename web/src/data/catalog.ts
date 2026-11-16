// THE ONLY FILE THAT KNOWS WHERE COURSE DATA COMES FROM.
//
// Today it reads data/courses.json from the repo. Later we'll swap the inside
// of loadCatalog() for a Supabase query. Nothing else in the website should
// need to change, as long as it still returns a Catalog.

import type { Course } from "@slotted/engine";

export interface Catalog {
  courses: Course[];
  /** When the public timetable was last scraped (ISO date), if known. */
  lastUpdated: string | null;
  /** When meeting times were last collected from Draft My Schedule, if known. */
  timesLastUpdated: string | null;
}

interface CoursesFile {
  courses: Course[];
  last_updated?: string;
  dms_last_updated?: string;
}

export async function loadCatalog(): Promise<Catalog> {
  // A dynamic import keeps the (large) course file out of the first page load.
  const file = (await import("../../../data/courses.json")).default as unknown as CoursesFile;
  return {
    courses: file.courses,
    lastUpdated: file.last_updated ?? null,
    timesLastUpdated: file.dms_last_updated ?? null,
  };
}
