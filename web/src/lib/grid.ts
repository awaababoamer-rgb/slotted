import type { Day, Pick } from "@slotted/engine";

/** One meeting of one chosen section, ready to draw. */
export interface GridBlock {
  pick: Pick;
  day: Day;
  start: number; // minutes since midnight
  end: number;
  startText: string; // "09:30"
  endText: string;
  location: string;
}

const toMin = (t: string) => {
  const [h, m] = t.split(":").map(Number);
  return h * 60 + m;
};

/** A section with different times on different days becomes several blocks. */
export function blocksOfPick(pick: Pick): GridBlock[] {
  return pick.section.meetings
    .filter((m) => m.day && m.start && m.end)
    .map((m) => ({
      pick,
      day: m.day!,
      start: toMin(m.start!),
      end: toMin(m.end!),
      startText: m.start!,
      endText: m.end!,
      location: m.location,
    }));
}

/**
 * Overlapping blocks (conflicts) are drawn side by side.
 * Returns each block with its lane and how many lanes its group needs.
 */
export function layoutDay(blocks: GridBlock[]): { block: GridBlock; lane: number; lanes: number }[] {
  const sorted = [...blocks].sort((a, b) => a.start - b.start || b.end - a.end);
  const result: { block: GridBlock; lane: number; lanes: number }[] = [];
  let group: { block: GridBlock; lane: number }[] = [];
  let groupEnd = -1;

  const flush = () => {
    const lanes = Math.max(1, ...group.map((g) => g.lane + 1));
    for (const g of group) result.push({ ...g, lanes });
    group = [];
  };

  for (const block of sorted) {
    if (block.start >= groupEnd && group.length > 0) flush();
    const laneEnds: number[] = [];
    for (const g of group) laneEnds[g.lane] = Math.max(laneEnds[g.lane] ?? 0, g.block.end);
    let lane = laneEnds.findIndex((end) => end <= block.start);
    if (lane === -1) lane = laneEnds.length;
    group.push({ block, lane });
    groupEnd = Math.max(groupEnd, block.end);
  }
  if (group.length > 0) flush();
  return result;
}
