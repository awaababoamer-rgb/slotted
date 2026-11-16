import type { Pick } from "@slotted/engine";
import { colorFor } from "../lib/colors";
import { formatRange, sectionLabel } from "../lib/format";
import { blocksOfPick, layoutDay } from "../lib/grid";

const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri"] as const;
const DAY_WIDTH = 100 / DAYS.length;

interface Props {
  picks: Pick[];
  /** Shared hour range so every card lines up. */
  first: number;
  last: number;
  height: number;
  colorOf: (courseCode: string) => number;
  conflicted: Set<number>;
  /** Sections that differ between weeks (shown strongly). Everything else is faded. */
  different: Set<number>;
  /** Sections this week moves compared with your picks (dashed). */
  moved: Set<number>;
  label: string;
}

/** A small Mon–Fri week. Blocks show only the course number (e.g. "2208"). */
export function MiniWeek({ picks, first, last, height, colorOf, conflicted, different, moved, label }: Props) {
  const scale = height / (last - first);
  const blocks = picks.flatMap(blocksOfPick);
  const hourMarks = [];
  for (let h = first; h < last; h += 120) hourMarks.push(h);

  return (
    <div className="rounded-xl border border-line bg-page/60 p-2" role="img" aria-label={label}>
      <div className="grid grid-cols-[1.5rem_repeat(5,1fr)] pb-1 text-center text-[11px] font-semibold text-muted">
        <span />
        {DAYS.map((d) => <span key={d}>{d[0]}</span>)}
      </div>
      <div className="relative" style={{ height }}>
        {hourMarks.map((h) => (
          <span
            key={h}
            className="absolute left-0 w-6 -translate-y-1/2 text-[10px] text-muted"
            style={{ top: (h - first) * scale }}
          >
            {((Math.floor(h / 60) + 11) % 12) + 1}
          </span>
        ))}
        <div className="absolute inset-y-0 right-0 left-6 grid grid-cols-5" aria-hidden>
          {DAYS.map((d) => <div key={d} className="border-l border-line/80" />)}
        </div>
        <div className="absolute inset-y-0 right-0 left-6">
          {DAYS.flatMap((day, dayIndex) =>
            layoutDay(blocks.filter((b) => b.day === day)).map(({ block, lane, lanes }) => {
              const n = block.pick.section.class_number;
              const color = colorFor(colorOf(block.pick.courseCode));
              const isConflict = conflicted.has(n);
              const isMoved = moved.has(n);
              const faded = !different.has(n) && !isConflict;
              return (
                <div
                  key={`${n}-${block.day}-${block.start}`}
                  title={`${block.pick.courseCode} ${sectionLabel(block.pick.section)} · ${block.day} ${formatRange(block.startText, block.endText)}`}
                  className={`absolute overflow-hidden rounded px-0.5 text-[10px] leading-tight font-semibold ${
                    isConflict ? "border-2 border-conflict-600" : isMoved ? "border-2 border-dashed border-brand-700" : "border"
                  } ${faded ? "opacity-35" : ""}`}
                  style={{
                    top: (block.start - first) * scale + 1,
                    height: Math.max((block.end - block.start) * scale - 2, 8),
                    left: `calc(${(dayIndex + lane / lanes) * DAY_WIDTH}% + 1.5px)`,
                    width: `calc(${DAY_WIDTH / lanes}% - 3px)`,
                    background: isConflict ? "#fff4ec" : color.bg,
                    borderColor: isConflict || isMoved ? undefined : color.border,
                    color: color.text,
                  }}
                >
                  {block.pick.courseCode.split(" ")[1].slice(0, 4)}
                </div>
              );
            }),
          )}
        </div>
      </div>
    </div>
  );
}
