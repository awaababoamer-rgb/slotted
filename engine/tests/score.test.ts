import { describe, expect, it } from "vitest";
import { scoreSchedule } from "../src/index";
import { pick } from "./helpers";

// COMPSCI 1020A LEC 001: Mon 09:30-11:30, Wed 09:30-10:30
// MATH 1600A LEC 003:    Mon/Wed/Fri 12:30-13:30
const schedule = [pick("COMPSCI 1020A", "LEC", "001"), pick("MATH 1600A", "LEC", "003")];

describe("scoreSchedule", () => {
  it("reports the ranking stats for the term the classes are in", () => {
    const score = scoreSchedule(schedule);
    expect(score.firstTerm).toEqual({
      daysOnCampus: 3, // Mon, Wed, Fri
      gapHours: 3, // Mon 11:30-12:30 (1h) + Wed 10:30-12:30 (2h)
      earliestStart: "09:30",
      latestEnd: "13:30",
      fridayClasses: 1,
    });
    // Nothing is scheduled in second term.
    expect(score.secondTerm.daysOnCampus).toBe(0);
    expect(score.secondTerm.earliestStart).toBeNull();
    expect(score.brokenPreferences).toEqual([]);
  });

  it("counts a full-year course in both terms", () => {
    const score = scoreSchedule([...schedule, pick("PHYSIOL 3120", "LEC", "001")]);
    expect(score.firstTerm.fridayClasses).toBe(2);
    expect(score.secondTerm.daysOnCampus).toBe(3);
  });

  it("reports a broken earliest-start preference, per day", () => {
    const score = scoreSchedule(schedule, { earliestStart: "10:00" });
    const broken = score.brokenPreferences.filter((b) => b.preference === "earliestStart");
    expect(broken.map((b) => b.day)).toEqual(["Mon", "Wed"]); // Friday starts 12:30: fine
    expect(broken[0].detail).toBe("Starts at 09:30 on Monday, before 10:00");
  });

  it("reports a broken lunch hour", () => {
    const score = scoreSchedule(schedule, { lunchHour: { start: "12:30", end: "13:30" } });
    expect(score.brokenPreferences.map((b) => `${b.preference} ${b.day}`)).toEqual([
      "lunchHour Mon", "lunchHour Wed", "lunchHour Fri",
    ]);
  });

  it("keeps lunch protected if there is a free hour anywhere in the window", () => {
    // Window 11:30–1:30. Monday: 1020A ends 11:30, MATH starts 12:30, so 11:30–12:30 is free.
    // Wednesday: 1020A ends 10:30, so 10:30–12:30 is free. Friday: free until 12:30.
    const score = scoreSchedule(schedule, { lunchHour: { start: "11:30", end: "13:30" } });
    expect(score.brokenPreferences).toEqual([]);
  });

  it("breaks lunch when the whole window is booked", () => {
    // COMPSCI 2210A LEC 002 is Wed 11:30–12:30; COMPSCI 2208A LAB 004 is Wed 12:30–1:30.
    const busy = [pick("COMPSCI 2210A", "LEC", "002"), pick("COMPSCI 2208A", "LAB", "004")];
    const broken = scoreSchedule(busy, { lunchHour: { start: "11:30", end: "13:30" } }).brokenPreferences;
    expect(broken.map((b) => `${b.preference} ${b.day}`)).toEqual(["lunchHour Wed"]);
    expect(broken[0].detail).toBe("No free 60 minutes between 11:30 and 13:30 on Wednesday");
  });

  it("reports labs that aren't on a lecture day", () => {
    // COMPSCI 2208A: lecture Tue/Thu, tutorial Thu (fine), lab Wed (not a lecture day).
    const course = [
      pick("COMPSCI 2208A", "LEC", "001"),
      pick("COMPSCI 2208A", "TUT", "002"),
      pick("COMPSCI 2208A", "LAB", "004"),
    ];
    const off = scoreSchedule(course).brokenPreferences;
    expect(off).toEqual([]); // preference not switched on
    const on = scoreSchedule(course, { labsSameDayAsLecture: true });
    expect(on.brokenPreferences).toHaveLength(1);
    expect(on.brokenPreferences[0]).toMatchObject({ preference: "labsSameDay", day: "Wed" });
    expect(on.cost).toBeGreaterThan(scoreSchedule(course).cost);
  });

  it("reports a light day as broken only when it has more than 2 hours of class", () => {
    // Friday has 1 hour: fine. Monday has 3 hours: broken.
    expect(scoreSchedule(schedule, { lightDay: "Fri" }).brokenPreferences).toEqual([]);
    const monday = scoreSchedule(schedule, { lightDay: "Mon" }).brokenPreferences;
    expect(monday).toHaveLength(1);
    expect(monday[0]).toMatchObject({ preference: "lightDay", day: "Mon" });
  });

  it("ranks a schedule that breaks preferences worse than one that doesn't", () => {
    const plain = scoreSchedule(schedule).cost;
    const withBrokenPrefs = scoreSchedule(schedule, { earliestStart: "10:00" }).cost;
    expect(withBrokenPrefs).toBeGreaterThan(plain);
    // Minimizing gaps makes this gappy schedule cost more too.
    expect(scoreSchedule(schedule, { minimizeGaps: true }).cost).toBeGreaterThan(plain);
  });

  it("flags full sections and unknown times", () => {
    const full = pick("COMPSCI 2208A", "LAB", "003"); // full
    const restricted = pick("COMPSCI 1027A", "LAB", "010"); // "OPEN WHEN ALL OTHER LABS ARE FULL."
    const unknown = pick("ANTHRO 1022A", "LEC", "001"); // public data only, and also full
    const score = scoreSchedule([full, restricted, unknown]);
    expect(score.flags.map((f) => f.reason)).toEqual(["full", "restricted", "full"]);
    expect(score.timesNotAvailable).toEqual([unknown]);
  });
});
