import { describe, expect, it } from "vitest";
import { findConflicts, generateSchedules } from "../src/index";
import { catalog } from "./helpers";

describe("generateSchedules", () => {
  it("picks one section of every component and never returns a conflict", () => {
    // COMPSCI 2208A has LEC + TUT + LAB; COMPSCI 1026A has LEC + LAB.
    const result = generateSchedules(catalog, ["COMPSCI 2208A", "COMPSCI 1026A"]);
    expect(result.schedules.length).toBeGreaterThan(0);
    expect(result.unplaced).toEqual([]);

    for (const schedule of result.schedules) {
      const chosen = schedule.sections.map((p) => `${p.courseCode} ${p.section.component}`).sort();
      expect(chosen).toEqual([
        "COMPSCI 1026A LAB", "COMPSCI 1026A LEC",
        "COMPSCI 2208A LAB", "COMPSCI 2208A LEC", "COMPSCI 2208A TUT",
      ]);
      expect(findConflicts(schedule.sections).conflicts).toEqual([]);
    }
  });

  it("returns the best schedules first, with full sections at the bottom", () => {
    const result = generateSchedules(catalog, ["COMPSCI 2208A", "COMPSCI 1026A"]);
    const costs = result.schedules.map((s) => s.score.cost);
    expect(costs).toEqual([...costs].sort((a, b) => a - b));
    expect(result.schedules[0].score.flags).toEqual([]); // best one uses no full section
  });

  it("returns no schedules when two required lectures always clash", () => {
    // COMPSCI 1020A and COMPSCI 2214A each have one lecture, at the same time.
    const result = generateSchedules(catalog, ["COMPSCI 1020A", "COMPSCI 2214A"]);
    expect(result.schedules).toEqual([]);
    expect(result.totalFound).toBe(0);
  });

  it("reports a course without times as unplaced and still schedules the rest", () => {
    const result = generateSchedules(catalog, ["COMPSCI 1020A", "ANTHRO 1022A", "NOPE 9999"]);
    // ANTHRO 1022A has a lecture and a tutorial; neither has times.
    expect(result.unplaced).toEqual([
      { courseCode: "ANTHRO 1022A", component: "LEC", reason: "times not available" },
      { courseCode: "ANTHRO 1022A", component: "TUT", reason: "times not available" },
      { courseCode: "NOPE 9999", component: null, reason: "course not found" },
    ]);
    expect(result.schedules).toHaveLength(1);
    expect(result.schedules[0].sections.map((p) => p.courseCode)).toEqual(["COMPSCI 1020A"]);
  });

  it("keeps a locked section in every schedule", () => {
    const lockedLab = 11716; // COMPSCI 2208A LAB 006
    const result = generateSchedules(catalog, ["COMPSCI 2208A", "COMPSCI 1026A"], {
      lockedClassNumbers: [lockedLab],
    });
    expect(result.schedules.length).toBeGreaterThan(0);
    for (const schedule of result.schedules) {
      expect(schedule.sections.map((p) => p.section.class_number)).toContain(lockedLab);
    }
  });

  it("uses the earliest-start preference to rank, without hiding other schedules", () => {
    // CALCULUS 1000A has 08:30 lectures and later ones.
    const result = generateSchedules(catalog, ["CALCULUS 1000A"], { earliestStart: "09:30" });
    expect(result.schedules[0].score.brokenPreferences).toEqual([]);
    expect(result.schedules[0].score.overall.earliestStart! >= "09:30").toBe(true);
    // The 08:30 options are still offered, lower down (soft preference).
    expect(result.schedules.some((s) => s.score.overall.earliestStart === "08:30")).toBe(true);
  });

  it("groups sections that meet at the same time", () => {
    // BIOLOGY 1001A has 69 labs but far fewer distinct lab times.
    const result = generateSchedules(catalog, ["BIOLOGY 1001A"]);
    expect(result.totalFound).toBeLessThan(4 * 69);
    const withAlternatives = result.schedules.filter(
      (s) => Object.keys(s.sameTimeAlternatives).length > 0,
    );
    expect(withAlternatives.length).toBeGreaterThan(0);
  });

  it("stays fast for 5 large courses", () => {
    const codes = ["BIOLOGY 1001A", "PSYCHOL 1002A", "CHEM 1301A", "CALCULUS 1000A", "COMPSCI 1026A"];
    const started = performance.now();
    const result = generateSchedules(catalog, codes, { minimizeGaps: true, earliestStart: "09:30" });
    const ms = performance.now() - started;
    console.log(
      `5 courses: ${ms.toFixed(0)} ms, found ${result.totalFound} schedules` +
        `${result.truncated ? " (stopped early)" : ""}, returned ${result.schedules.length}`,
    );
    expect(result.schedules.length).toBeGreaterThan(0);
    expect(findConflicts(result.schedules[0].sections).conflicts).toEqual([]);
    expect(ms).toBeLessThan(1000);
  });
});
