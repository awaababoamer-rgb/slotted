import { describe, expect, it } from "vitest";
import { findConflicts, isAvoided, suggestFixes } from "../src/index";
import type { Fix } from "../src/index";
import { catalog, pick } from "./helpers";

// A real clash: COMPSCI 2208A LAB 004 (Wed 12:30-13:30) vs MATH 1600A LEC 003 (Mon/Wed/Fri 12:30-13:30).
const lab004 = pick("COMPSCI 2208A", "LAB", "004");
const clashing = [
  pick("COMPSCI 2208A", "LEC", "001"), // Tue 13:30-15:30, Thu 13:30-14:30
  pick("COMPSCI 2208A", "TUT", "002"), // Thu 14:30-15:30
  lab004,
  pick("MATH 1600A", "LEC", "003"),
];

const describeMoves = (fix: Fix) =>
  fix.moves.map((m) => `${m.courseCode} ${m.component} ${m.from.section}->${m.to.section}`);

describe("suggestFixes", () => {
  it("starts from a schedule that really has one conflict", () => {
    expect(findConflicts(clashing).conflicts).toHaveLength(1);
  });

  it("says so when there is nothing to fix", () => {
    const result = suggestFixes(catalog, [pick("COMPSCI 1020A", "LEC", "001")]);
    expect(result).toMatchObject({ fixes: [], alreadyConflictFree: true });
  });

  it("suggests fixes that are conflict-free, small, and different from each other", () => {
    const { fixes } = suggestFixes(catalog, clashing);
    console.log(fixes.map((f) => `${f.label}  [${describeMoves(f).join("; ")}]`).join("\n"));

    expect(fixes.length).toBeGreaterThanOrEqual(2);
    expect(fixes.length).toBeLessThanOrEqual(3);
    for (const fix of fixes) {
      expect(findConflicts(fix.schedule).conflicts).toEqual([]);
      expect(fix.moves.length).toBeLessThanOrEqual(3);
      expect(fix.usesAvoidedSection).toBe(false); // open sections exist, so full ones aren't used
    }
    // Fewest changes first: both one-move fixes exist here.
    expect(fixes[0].moves).toHaveLength(1);

    // Not three versions of the same lab swap: each fix moves something different,
    // or lands on different days.
    const kinds = fixes.map((f) => {
      const what = f.moves.map((m) => `${m.courseCode} ${m.component}`).sort().join("+");
      const days = f.moves.flatMap((m) => m.to.meetings.map((x) => x.day)).sort().join(",");
      return `${what} @ ${days}`;
    });
    expect(new Set(kinds).size).toBe(fixes.length);
    expect(kinds.some((k) => k.startsWith("COMPSCI 2208A LAB"))).toBe(true);
    expect(kinds.some((k) => k.startsWith("MATH 1600A LEC"))).toBe(true);
  });

  it("lists exactly which section moves from where to where", () => {
    const { fixes } = suggestFixes(catalog, clashing, { onlyMoveLabsAndTutorials: true });
    const move = fixes[0].moves[0];
    expect(move.courseCode).toBe("COMPSCI 2208A");
    expect(move.from.class_number).toBe(lab004.section.class_number);
    expect(move.to.component).toBe("LAB");
    expect(move.to.class_number).not.toBe(move.from.class_number);
  });

  it("never moves a lecture when only labs and tutorials may move", () => {
    const { fixes } = suggestFixes(catalog, clashing, { onlyMoveLabsAndTutorials: true });
    expect(fixes.length).toBeGreaterThan(0);
    for (const fix of fixes) {
      expect(fix.moves.every((m) => m.component !== "LEC")).toBe(true);
      expect(fix.label.startsWith("Only moves labs")).toBe(true);
    }
  });

  it("never moves a locked section", () => {
    const { fixes } = suggestFixes(catalog, clashing, {
      lockedClassNumbers: [lab004.section.class_number],
    });
    expect(fixes.length).toBeGreaterThan(0);
    for (const fix of fixes) {
      expect(fix.schedule).toContain(lab004);
      expect(fix.moves.every((m) => m.courseCode === "MATH 1600A")).toBe(true);
    }
  });

  it("explains why when the strict rules leave nothing to move", () => {
    const result = suggestFixes(catalog, clashing, {
      onlyMoveLabsAndTutorials: true,
      lockedClassNumbers: [lab004.section.class_number],
    });
    expect(result.fixes).toEqual([]);
    expect(result.reason).toContain("neither is allowed to move");
  });

  it("uses full sections only when nothing else works, and flags them", () => {
    // COMPSCI 1027A LAB 003 (Fri 12:30) clashes with MATH 1600A LEC 003 (Fri 12:30).
    // The only other open, unrestricted lab is 011 (Thu 14:30), and that clashes
    // with COMPSCI 2208A TUT 002 (Thu 14:30). Every other lab is full or overflow.
    const stuck = [
      pick("COMPSCI 1027A", "LAB", "003"),
      pick("MATH 1600A", "LEC", "003"),
      pick("COMPSCI 2208A", "TUT", "002"),
    ];
    const { fixes } = suggestFixes(catalog, stuck, { onlyMoveLabsAndTutorials: true });
    console.log(fixes.map((f) => `${f.label}  [${describeMoves(f).join("; ")}]`).join("\n"));

    expect(fixes.length).toBeGreaterThan(0);
    for (const fix of fixes) {
      expect(findConflicts(fix.schedule).conflicts).toEqual([]);
      expect(fix.usesAvoidedSection).toBe(true);
      expect(fix.moves.every((m) => isAvoided(m.to))).toBe(true);
      expect(fix.label).toContain("Uses a full or restricted section");
      expect(fix.score.flags.length).toBeGreaterThan(0);
    }
  });

  it("prefers the open lab when one is free", () => {
    // Same as above without the tutorial in the way: LAB 011 is open, so use it.
    const stuck = [pick("COMPSCI 1027A", "LAB", "003"), pick("MATH 1600A", "LEC", "003")];
    const { fixes } = suggestFixes(catalog, stuck, { onlyMoveLabsAndTutorials: true });
    expect(describeMoves(fixes[0])).toEqual(["COMPSCI 1027A LAB 003->011"]);
    expect(fixes.every((f) => !f.usesAvoidedSection)).toBe(true);
  });
});
