import { describe, expect, it } from "vitest";
import { findConflicts, termsOverlap } from "../src/index";
import { pick, times } from "./helpers";

// COMPSCI 1020A meets at different times on different days:
// Monday for 2 hours, Wednesday for 1 hour.
const cs1020A = pick("COMPSCI 1020A", "LEC", "001");
const cs1020B = pick("COMPSCI 1020B", "LEC", "001"); // same times, second term

describe("findConflicts", () => {
  it("uses the real COMPSCI 1020A times this test relies on", () => {
    expect(times(cs1020A)).toBe("Mon 09:30-11:30, Wed 09:30-10:30");
    expect(times(cs1020B)).toBe("Mon 09:30-11:30, Wed 09:30-10:30");
  });

  it("catches a clash with only the second hour of a 2-hour Monday lecture", () => {
    // MATH 1600A LEC 002 is Mon/Wed/Fri 10:30-11:30.
    // Monday overlaps 1020A's second hour. Wednesday is back-to-back (1020A ends 10:30): no clash.
    const math = pick("MATH 1600A", "LEC", "002");
    expect(times(math)).toBe("Mon 10:30-11:30, Wed 10:30-11:30, Fri 10:30-11:30");

    const { conflicts } = findConflicts([cs1020A, math]);
    expect(conflicts).toHaveLength(1);
    expect(conflicts[0]).toMatchObject({ day: "Mon", start: "10:30", end: "11:30" });
  });

  it("reports one conflict per overlapping meeting", () => {
    // COMPSCI 2214A LEC 001 has exactly the same times as 1020A.
    const { conflicts } = findConflicts([cs1020A, pick("COMPSCI 2214A", "LEC", "001")]);
    expect(conflicts.map((c) => c.day)).toEqual(["Mon", "Wed"]);
  });

  it("finds no conflict between non-overlapping sections", () => {
    const { conflicts } = findConflicts([cs1020A, pick("MATH 1600A", "LEC", "003")]);
    expect(conflicts).toHaveLength(0);
  });

  it("does not conflict first-term with second-term sections at the same time", () => {
    // BIOLOGY 3660B LEC 001 (second term) is Mon/Wed/Fri 09:30-10:30.
    const bio = pick("BIOLOGY 3660B", "LEC", "001");
    expect(findConflicts([cs1020A, bio]).conflicts).toHaveLength(0);
    // ...but it does clash with 1020B, which is also second term.
    expect(findConflicts([cs1020B, bio]).conflicts.length).toBeGreaterThan(0);
  });

  it("conflicts a full-year course with both terms", () => {
    // PHYSIOL 3120 (full year) is Mon/Wed/Fri 10:30-11:30.
    const physiol = pick("PHYSIOL 3120", "LEC", "001");
    expect(physiol.term).toBe("full_year");
    expect(findConflicts([cs1020A, physiol]).conflicts).toHaveLength(1);
    expect(findConflicts([cs1020B, physiol]).conflicts).toHaveLength(1);
    // One schedule holding both terms: 1020A and 1020B don't clash with each other.
    expect(findConflicts([cs1020A, cs1020B, physiol]).conflicts).toHaveLength(2);
  });

  it("treats Y/Z courses as conflicting with both terms", () => {
    // COMPSCI 3380Z is Mon 08:30-09:30; MATH 1600A LEC 001 (first term) starts Mon 08:30.
    const project = pick("COMPSCI 3380Z", "LEC", "001");
    expect(project.term).toBe("other_session");
    expect(findConflicts([project, pick("MATH 1600A", "LEC", "001")]).conflicts).toHaveLength(1);
    expect(termsOverlap("other_session", "second_term")).toBe(true);
    expect(termsOverlap("first_term", "second_term")).toBe(false);
  });

  it("reports sections without times as 'times not available', not as free", () => {
    // ANTHRO has public data only, so no meeting times.
    const anthro = pick("ANTHRO 1022A", "LEC", "001");
    const report = findConflicts([cs1020A, anthro]);
    expect(report.conflicts).toHaveLength(0);
    expect(report.timesNotAvailable).toEqual([anthro]);
  });

  it("treats an online section with no fixed time as placed and conflict-free", () => {
    // COMPSCI 1026A LEC 650 is online: DMS data, no meetings.
    const online = pick("COMPSCI 1026A", "LEC", "650");
    const report = findConflicts([cs1020A, online]);
    expect(report.conflicts).toHaveLength(0);
    expect(report.timesNotAvailable).toHaveLength(0);
  });
});
