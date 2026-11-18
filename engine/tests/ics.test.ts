import { describe, expect, it } from "vitest";
import { buildIcs, firstWeekdayOnOrAfter } from "../src/index";
import { pick } from "./helpers";

// COMPSCI 1020A LEC 001: Mon 09:30-11:30, Wed 09:30-10:30, room NSC-1
const cs1020 = pick("COMPSCI 1020A", "LEC", "001");
const fall = { start: "2026-09-08", end: "2026-12-08" }; // Tue Sep 8 .. Tue Dec 8
const STAMP = new Date("2026-11-17T12:00:00Z");

describe("buildIcs", () => {
  it("finds the first class day on or after the term start", () => {
    expect(firstWeekdayOnOrAfter("2026-09-08", "Tue")).toBe("2026-09-08");
    expect(firstWeekdayOnOrAfter("2026-09-08", "Mon")).toBe("2026-09-14");
    expect(firstWeekdayOnOrAfter("2026-09-08", "Wed")).toBe("2026-09-09");
  });

  it("makes one weekly repeating event per meeting, in Toronto time", () => {
    const ics = buildIcs([cs1020], fall, [], STAMP);
    expect(ics.startsWith("BEGIN:VCALENDAR\r\n")).toBe(true);
    expect(ics.trimEnd().endsWith("END:VCALENDAR")).toBe(true);
    expect(ics.match(/BEGIN:VEVENT/g)).toHaveLength(2); // Monday + Wednesday
    expect(ics).toContain("DTSTART;TZID=America/Toronto:20260914T093000"); // first Monday
    expect(ics).toContain("DTEND;TZID=America/Toronto:20260914T113000"); // 2 hours on Monday
    expect(ics).toContain("DTSTART;TZID=America/Toronto:20260909T093000"); // first Wednesday
    expect(ics).toContain("DTEND;TZID=America/Toronto:20260909T103000"); // 1 hour on Wednesday
    expect(ics).toContain("RRULE:FREQ=WEEKLY;BYDAY=MO;UNTIL=20261208T235959");
    expect(ics).toContain("SUMMARY:COMPSCI 1020A LEC 001");
    expect(ics).toContain("LOCATION:NSC-1");
    expect(ics).toContain("BEGIN:VTIMEZONE");
  });

  it("skips no-class days only on the matching weekday", () => {
    const ics = buildIcs([cs1020], { ...fall, skipDates: ["2026-11-02", "2026-11-04", "2026-11-03"] }, [], STAMP);
    expect(ics).toContain("EXDATE;TZID=America/Toronto:20261102T093000"); // Monday
    expect(ics).toContain("EXDATE;TZID=America/Toronto:20261104T093000"); // Wednesday
    expect(ics).not.toContain("20261103"); // a Tuesday: no class to skip
  });

  it("adds club events as single events and escapes special characters", () => {
    const ics = buildIcs([], fall, [{
      id: "e1", title: "Hack Night; pizza, games", date: "2026-10-08", start: "17:00", end: "19:00", location: "UCC 56",
    }], STAMP);
    expect(ics).toContain("SUMMARY:Hack Night\\; pizza\\, games");
    expect(ics).toContain("DTSTART;TZID=America/Toronto:20261008T170000");
    expect(ics).not.toContain("RRULE:FREQ=WEEKLY"); // the event itself doesn't repeat
  });

  it("leaves out online sections with no meeting time", () => {
    const online = pick("COMPSCI 1026A", "LEC", "650");
    expect(buildIcs([online], fall, [], STAMP)).not.toContain("BEGIN:VEVENT");
  });

  it("keeps every line within 75 characters", () => {
    const ics = buildIcs([cs1020], fall, [{
      id: "e2", title: "A".repeat(200), date: "2026-10-08", start: "17:00", end: "19:00",
    }], STAMP);
    for (const line of ics.split("\r\n")) expect(line.length).toBeLessThanOrEqual(75);
  });
});
