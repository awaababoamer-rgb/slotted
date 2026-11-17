import { describe, expect, it } from "vitest";
import { classifyEvent, termForDate, weekdayOf } from "../src/index";
import { pick } from "./helpers";

// COMPSCI 1020A LEC 001 (Fall): Mon 09:30-11:30, Wed 09:30-10:30
// MATH 1600A LEC 002 (Fall):    Mon/Wed/Fri 10:30-11:30
const cs1020 = pick("COMPSCI 1020A", "LEC", "001");
const math = pick("MATH 1600A", "LEC", "002");
const FALL_MONDAY = "2026-10-05";
const WINTER_MONDAY = "2027-01-11";

describe("classifyEvent", () => {
  it("knows the term and weekday of a date", () => {
    expect(weekdayOf(FALL_MONDAY)).toBe("Mon");
    expect(termForDate(FALL_MONDAY)).toBe("first_term");
    expect(termForDate(WINTER_MONDAY)).toBe("second_term");
    expect(termForDate("2026-07-06")).toBeNull();
  });

  it("Fits: no class overlaps", () => {
    expect(classifyEvent({ date: FALL_MONDAY, start: "12:00", end: "13:00" }, [cs1020]).kind).toBe("fits");
  });

  it("Fits: starts exactly when the class ends (back-to-back)", () => {
    expect(classifyEvent({ date: FALL_MONDAY, start: "11:30", end: "12:30" }, [cs1020]).kind).toBe("fits");
  });

  it("Join late: class overlaps but 90 minutes remain after it", () => {
    const fit = classifyEvent({ date: FALL_MONDAY, start: "11:00:00", end: "13:00:00" }, [cs1020]);
    expect(fit).toMatchObject({ kind: "join_late", joinFrom: "11:30", minutesLeft: 90 });
  });

  it("Join late: waits for the LAST overlapping class", () => {
    const fit = classifyEvent({ date: FALL_MONDAY, start: "09:00", end: "12:30" }, [cs1020, math]);
    expect(fit).toMatchObject({ kind: "join_late", joinFrom: "11:30", minutesLeft: 60 });
  });

  it("Exactly 30 minutes left still counts as Join late", () => {
    const fit = classifyEvent({ date: FALL_MONDAY, start: "11:00", end: "12:00" }, [cs1020]);
    expect(fit).toMatchObject({ kind: "join_late", minutesLeft: 30 });
  });

  it("Hidden: under 30 minutes left after class", () => {
    const fit = classifyEvent({ date: FALL_MONDAY, start: "10:00", end: "11:50" }, [cs1020]);
    expect(fit).toMatchObject({ kind: "hidden", reason: "too_little_left" });
  });

  it("Hidden: fully covered by a class", () => {
    const fit = classifyEvent({ date: FALL_MONDAY, start: "09:30", end: "11:30" }, [cs1020]);
    expect(fit).toMatchObject({ kind: "hidden", reason: "covered" });
  });

  it("Fall classes don't affect a Winter event at the same time", () => {
    expect(classifyEvent({ date: WINTER_MONDAY, start: "10:00", end: "11:00" }, [cs1020]).kind).toBe("fits");
  });

  it("Weekends and summer fit", () => {
    expect(classifyEvent({ date: "2026-10-10", start: "10:00", end: "11:00" }, [cs1020]).kind).toBe("fits");
    expect(classifyEvent({ date: "2026-07-06", start: "10:00", end: "11:00" }, [cs1020]).kind).toBe("fits");
  });

  it("Online sections with no meeting time never block an event", () => {
    const online = pick("COMPSCI 1026A", "LEC", "650");
    expect(classifyEvent({ date: FALL_MONDAY, start: "10:00", end: "11:00" }, [online]).kind).toBe("fits");
  });
});
