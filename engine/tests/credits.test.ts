import { describe, expect, it } from "vitest";
import { checkCredits, codeSuffix, courseCredits, creditSplit, termCredits, type Course } from "../src/index";
import { catalog } from "./helpers";

/** A made-up course with no listed credit value, so the suffix decides. */
const fake = (code: string, term: Course["term"] = "first_term", credit_units?: string): Course => ({
  code, term, sections: [{ section: "001", component: "LEC", class_number: 1, full: false, meetings: [], data_source: "dms", ...(credit_units ? { credit_units } : {}) }],
});

describe("credits from the course code", () => {
  it("reads the suffix", () => {
    expect(codeSuffix("COMPSCI 2210A")).toBe("A");
    expect(codeSuffix("PSYCHOL 1000")).toBe("");
    expect(codeSuffix("not a code")).toBeNull();
  });

  it("gives each suffix its credit value", () => {
    const credits = (code: string) => courseCredits(fake(code));
    expect(credits("TEST 1000")).toBe(1);
    expect(credits("TEST 1000E")).toBe(1);
    expect(credits("TEST 1000A")).toBe(0.5);
    expect(credits("TEST 1000B")).toBe(0.5);
    expect(credits("TEST 1000F")).toBe(0.5);
    expect(credits("TEST 1000G")).toBe(0.5);
    expect(credits("TEST 1000Y")).toBe(0.5);
    expect(credits("TEST 1000Z")).toBe(0.5);
    expect(credits("TEST 1000Q")).toBe(0.25);
    expect(credits("TEST 1000U")).toBe(0.25);
    expect(credits("TEST 1000W")).toBe(1);
  });

  it("uses the timetable's own credit value when it has one", () => {
    expect(courseCredits(fake("TEST 2205W", "first_term", "1.50"))).toBe(1.5);
    expect(courseCredits(fake("TEST 1000A", "first_term", "0"))).toBe(0.5); // 0 = not listed
  });
});

describe("credits per term", () => {
  it("counts full-year courses half in each term, and Z outside both", () => {
    expect(creditSplit(fake("TEST 1000", "full_year"))).toEqual({ first_term: 0.5, second_term: 0.5, other_session: 0 });
    expect(creditSplit(fake("TEST 1000Y", "other_session"))).toEqual({ first_term: 0.25, second_term: 0.25, other_session: 0 });
    expect(creditSplit(fake("TEST 1000Z", "other_session"))).toEqual({ first_term: 0, second_term: 0, other_session: 0.5 });
    expect(creditSplit(fake("TEST 1000G", "second_term"))).toEqual({ first_term: 0, second_term: 0.5, other_session: 0 });
  });

  it("adds a week's courses up", () => {
    const week = [fake("A 1000A"), fake("A 1001A"), fake("A 1002F"), fake("A 1003B", "second_term"), fake("A 1004", "full_year")];
    expect(termCredits(week)).toEqual({ first_term: 2, second_term: 1, other_session: 0 });
  });

  it("works on real courses", () => {
    const real = ["COMPSCI 1020A", "COMPSCI 1020B", "PSYCHOL 1000"].map((code) => catalog.find((c) => c.code === code)!);
    expect(termCredits(real)).toEqual({ first_term: 1, second_term: 1, other_session: 0 });
  });
});

describe("credit limit", () => {
  const six = ["A 1000A", "A 1001A", "A 1002A", "A 1003A", "A 1004A", "A 1005F"].map((c) => fake(c));

  it("warns when a term goes over the default 2.5", () => {
    const check = checkCredits(six);
    expect(check.limit).toBe(2.5);
    expect(check.over).toEqual([{ term: "first_term", credits: 3, by: 0.5 }]);
  });

  it("follows the student's own limit", () => {
    expect(checkCredits(six, { maxCreditsPerTerm: 3 }).over).toEqual([]);
    expect(checkCredits(six.slice(0, 5)).over).toEqual([]); // exactly 2.5 is fine
  });
});
