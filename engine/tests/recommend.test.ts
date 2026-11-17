import { describe, expect, it } from "vitest";
import {
  adjustedRating, findConflicts, findFittingCourses, fitCourse, rankCourses,
  type CourseFit, type CourseRatingSummary,
} from "../src/index";
import { catalog, pick } from "./helpers";

const course = (code: string) => {
  const c = catalog.find((x) => x.code === code);
  if (!c) throw new Error(`missing ${code}`);
  return c;
};

// COMPSCI 1020A LEC 001 (Fall): Mon 09:30-11:30, Wed 09:30-10:30
const current = [pick("COMPSCI 1020A", "LEC", "001")];

describe("fitCourse", () => {
  it("rejects a course whose only lecture clashes", () => {
    // COMPSCI 2214A LEC 001 has exactly the same times as 1020A.
    expect(fitCourse(course("COMPSCI 2214A"), current)).toEqual({ fits: false, reason: "no sections fit" });
  });

  it("picks a section that fits (never the clashing one)", () => {
    // MATH 1600A LEC 002 is Mon/Wed/Fri 10:30-11:30, which clashes on Monday.
    const result = fitCourse(course("MATH 1600A"), current);
    expect(result.fits).toBe(true);
    if (!result.fits) return;
    expect(result.fit.sections.map((p) => p.section.section)).not.toContain("002");
    expect(findConflicts([...current, ...result.fit.sections]).conflicts).toEqual([]);
  });

  it("picks one section per component", () => {
    const result = fitCourse(course("COMPSCI 2208A"), current);
    expect(result.fits).toBe(true);
    if (!result.fits) return;
    expect(result.fit.sections.map((p) => p.section.component).sort()).toEqual(["LAB", "LEC", "TUT"]);
  });

  it("allows a second-term course at the same times", () => {
    expect(fitCourse(course("COMPSCI 1020B"), current).fits).toBe(true);
  });

  it("skips courses without times and courses already chosen", () => {
    expect(fitCourse(course("ANTHRO 1022A"), current)).toEqual({ fits: false, reason: "times not available" });
    expect(fitCourse(course("COMPSCI 1020A"), current)).toEqual({ fits: false, reason: "already in schedule" });
  });
});

describe("rankCourses", () => {
  const fake = (code: string, addedCost: number): CourseFit => ({
    course: course(code), sections: [], addedCost, usesFullSection: false,
  });
  const rating = (overall: number, count: number, workload = 3, difficulty = 3): CourseRatingSummary => ({
    overall, review_count: count, workload, difficulty, would_take_again_pct: 50,
  });

  it("pulls a few reviews toward 3/5 so one 5-star review doesn't win", () => {
    expect(adjustedRating(5, 1)).toBe(3.5);
    expect(adjustedRating(4.5, 10)).toBeCloseTo(4.15, 2);
    const ranked = rankCourses(
      [fake("MATH 1600A", 0), fake("CALCULUS 1000A", 0)],
      new Map([["MATH 1600A", rating(5, 1)], ["CALCULUS 1000A", rating(4.5, 10)]]),
    );
    expect(ranked.map((r) => r.course.code)).toEqual(["CALCULUS 1000A", "MATH 1600A"]);
  });

  it("a much better fit beats a slightly better rating", () => {
    const ranked = rankCourses(
      [fake("MATH 1600A", 0), fake("CALCULUS 1000A", 180)],
      new Map([["MATH 1600A", rating(3.5, 5)], ["CALCULUS 1000A", rating(4, 5)]]),
    );
    expect(ranked[0].course.code).toBe("MATH 1600A");
  });

  it("'prefer lighter' favours lower workload", () => {
    const fits = [fake("MATH 1600A", 0), fake("CALCULUS 1000A", 0)];
    const ratings = new Map([["MATH 1600A", rating(4, 8, 5, 5)], ["CALCULUS 1000A", rating(4, 8, 1, 1)]]);
    expect(rankCourses(fits, ratings)[0].course.code).toBe("CALCULUS 1000A"); // tie broken by code
    expect(rankCourses(fits, ratings, { preferLighter: true })[0].course.code).toBe("CALCULUS 1000A");
    const reversed = new Map([["MATH 1600A", rating(4, 8, 1, 1)], ["CALCULUS 1000A", rating(4, 8, 5, 5)]]);
    expect(rankCourses(fits, reversed, { preferLighter: true })[0].course.code).toBe("MATH 1600A");
  });

  it("explains why", () => {
    const [r] = rankCourses([fake("MATH 1600A", 0)], new Map([["MATH 1600A", rating(4.4, 12)]]));
    expect(r.reasons).toEqual(["Fits with no extra gaps", "Rated 4.4 by 12 students"]);
  });
});

describe("findFittingCourses", () => {
  it("searches the whole Fall catalog quickly and only returns conflict-free fits", () => {
    const week = [
      pick("COMPSCI 1020A", "LEC", "001"),
      pick("MATH 1600A", "LEC", "003"),
      pick("COMPSCI 2208A", "LEC", "001"),
      pick("COMPSCI 2208A", "LAB", "005"),
      pick("COMPSCI 2208A", "TUT", "002"),
    ];
    const started = performance.now();
    const fits = findFittingCourses(catalog, week, { minimizeGaps: true }, { term: "first_term" });
    const ms = performance.now() - started;
    console.log(`Fall search: ${fits.length} courses fit, ${ms.toFixed(0)} ms`);
    expect(fits.length).toBeGreaterThan(20);
    for (const f of fits.slice(0, 50)) expect(findConflicts([...week, ...f.sections]).conflicts).toEqual([]);
    expect(fits.every((f) => f.course.term !== "second_term")).toBe(true);
    expect(ms).toBeLessThan(3000);
  });

  it("filters by subject and level", () => {
    const fits = findFittingCourses(catalog, current, {}, { term: "first_term", subject: "COMPSCI", level: "2000" });
    expect(fits.length).toBeGreaterThan(0);
    expect(fits.every((f) => /^COMPSCI 2\d{3}/.test(f.course.code))).toBe(true);
  });
});
