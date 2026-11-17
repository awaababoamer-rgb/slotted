import type { Pick } from "@slotted/engine";
import { colorFor } from "../lib/colors";
import { formatRange, sectionLabel } from "../lib/format";
import { blocksOfPick, layoutDay, type GridBlock } from "../lib/grid";
import { LockIcon } from "./icons";

const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri"] as const;
const PX_PER_MIN = 0.9; // 54px per hour
const DAY_WIDTH = 100 / DAYS.length; // % of the blocks layer

interface Props {
  picks: Pick[];
  colorOf: (courseCode: string) => number;
  conflicted: Set<number>;
  locked: Set<number>;
  /** Sections that a fix moves (drawn with a dashed outline). */
  moved?: Set<number>;
  /** Where moved sections used to be (drawn as a faded outline). */
  ghosts?: Pick[];
  /** Club events the student added. Drawn dashed, never counted as conflicts. */
  events?: GridEvent[];
}

export interface GridEvent {
  id: string;
  day: string; // "Mon"
  start: number; // minutes since midnight
  end: number;
  title: string;
  /** e.g. "Thu Oct 8 · 5:00–7:00 PM · UCC 56" */
  detail: string;
}

function hourLabel(minutes: number) {
  const h = Math.floor(minutes / 60);
  return `${h % 12 === 0 ? 12 : h % 12} ${h >= 12 ? "PM" : "AM"}`;
}

/**
 * A stable id for a meeting block. It stays the same when a fix swaps the
 * section (e.g. LAB 004 -> LAB 005), so React moves the same element and the
 * CSS transition makes it slide to its new spot, even to another day.
 */
function blockKey(block: GridBlock, index: number) {
  return `${block.pick.courseCode}|${block.pick.section.component}|${index}`;
}

/** Monday–Friday week grid. Each meeting is its own block, so a 2-hour Monday and 1-hour Wednesday both show correctly. */
export function WeekGrid({ picks, colorOf, conflicted, locked, moved = new Set(), ghosts = [], events = [] }: Props) {
  const blocks: { block: GridBlock; key: string }[] = picks.flatMap((p) =>
    blocksOfPick(p).map((block, i) => ({ block, key: blockKey(block, i) })),
  );
  const ghostBlocks = ghosts.flatMap(blocksOfPick);

  // Show 9 AM–6 PM at least, growing to fit early or late classes.
  const all: { start: number; end: number }[] = [...blocks.map((b) => b.block), ...ghostBlocks, ...events];
  const earliest = Math.min(9 * 60, ...all.map((b) => b.start));
  const latest = Math.max(18 * 60, ...all.map((b) => b.end));
  const first = Math.floor(earliest / 60) * 60;
  const last = Math.ceil(latest / 60) * 60;
  const hours = Array.from({ length: (last - first) / 60 }, (_, i) => first + i * 60);
  const height = (last - first) * PX_PER_MIN;

  // Lay out each day (overlapping classes go side by side).
  const keyOf = new Map(blocks.map((b) => [b.block, b.key]));
  const placed = DAYS.flatMap((day, dayIndex) =>
    layoutDay(blocks.filter((b) => b.block.day === day).map((b) => b.block)).map((p) => ({ ...p, dayIndex })),
  );

  return (
    <div className="overflow-x-auto">
      <div className="min-w-[560px]">
        <div className="grid grid-cols-[3.25rem_repeat(5,1fr)] border-b border-line pb-2 text-center text-sm font-semibold">
          <span />
          {DAYS.map((d) => <span key={d}>{d}</span>)}
        </div>

        <div className="relative" style={{ height }}>
          {/* Hour labels and lines */}
          {hours.map((h) => (
            <div key={h} aria-hidden>
              <span
                className="absolute left-0 w-[3.25rem] -translate-y-1/2 pr-2 text-right text-[11px] text-muted"
                style={{ top: (h - first) * PX_PER_MIN }}
              >
                {hourLabel(h)}
              </span>
              <div className="absolute right-0 left-[3.25rem] border-t border-line" style={{ top: (h - first) * PX_PER_MIN }} />
            </div>
          ))}
          {/* Day column lines */}
          <div className="absolute inset-y-0 right-0 left-[3.25rem] grid grid-cols-5" aria-hidden>
            {DAYS.map((d) => <div key={d} className="border-l border-line" />)}
          </div>

          {/* All class blocks share one layer, so they can slide between days. */}
          <div className="absolute inset-y-0 right-0 left-[3.25rem]" role="list" aria-label="Classes this week">
            {ghostBlocks.map((block) => (
              <div
                key={`ghost-${block.pick.section.class_number}-${block.day}-${block.start}`}
                aria-hidden
                className="absolute rounded-lg border-2 border-dashed border-brand-600/40 bg-white/40"
                style={{
                  top: (block.start - first) * PX_PER_MIN + 1,
                  height: (block.end - block.start) * PX_PER_MIN - 2,
                  left: `calc(${DAYS.indexOf(block.day as (typeof DAYS)[number]) * DAY_WIDTH}% + 3px)`,
                  width: `calc(${DAY_WIDTH}% - 6px)`,
                }}
              />
            ))}

            {placed.map(({ block, lane, lanes, dayIndex }) => {
              const section = block.pick.section;
              const color = colorFor(colorOf(block.pick.courseCode));
              const isConflict = conflicted.has(section.class_number);
              const isLocked = locked.has(section.class_number);
              const isMoved = moved.has(section.class_number);
              const top = (block.start - first) * PX_PER_MIN;
              const blockHeight = (block.end - block.start) * PX_PER_MIN;
              const room = block.location || "Room TBA";
              const who = (section.instructors ?? []).join(", ");
              const description = [
                `${block.pick.courseCode} ${sectionLabel(section)}`,
                `${block.day} ${formatRange(block.startText, block.endText)}`,
                room, who, section.full ? "Full" : "",
                isConflict ? "Time conflict" : "", isLocked ? "Locked" : "", isMoved ? "Moved by a fix" : "",
              ].filter(Boolean);

              const border = isConflict
                ? "border-2 border-conflict-600"
                : isMoved
                  ? "border-2 border-dashed border-brand-700"
                  : "border";
              return (
                <div
                  key={keyOf.get(block)}
                  role="listitem"
                  title={description.join("\n")}
                  aria-label={description.join(", ")}
                  className={`absolute overflow-hidden rounded-lg px-1.5 py-1 text-[11px] leading-tight shadow-sm transition-[top,left,width,height] duration-700 ease-in-out motion-reduce:transition-none ${border}`}
                  style={{
                    top: top + 1,
                    height: blockHeight - 2,
                    left: `calc(${(dayIndex + lane / lanes) * DAY_WIDTH}% + 3px)`,
                    width: `calc(${DAY_WIDTH / lanes}% - 6px)`,
                    background: isConflict ? "#fff4ec" : color.bg,
                    borderColor: isConflict || isMoved ? undefined : color.border,
                    color: color.text,
                  }}
                >
                  <div className="flex items-start justify-between gap-1">
                    <span className="font-bold">{block.pick.courseCode.replace(/^COMPSCI /, "CS ")}</span>
                    {isLocked && <LockIcon className="size-3 shrink-0" />}
                  </div>
                  <div>{sectionLabel(section)}</div>
                  {blockHeight > 44 && <div>{formatRange(block.startText, block.endText)}</div>}
                  {blockHeight > 58 && <div className="truncate opacity-80">{room}</div>}
                </div>
              );
            })}
          </div>

          {/* Added club events: on top, along the right edge of the day, dashed. */}
          <div className="pointer-events-none absolute inset-y-0 right-0 left-[3.25rem]" role="list" aria-label="Your club events">
            {events.map((ev) => {
              const dayIndex = DAYS.indexOf(ev.day as (typeof DAYS)[number]);
              if (dayIndex === -1) return null;
              const h = (ev.end - ev.start) * PX_PER_MIN;
              return (
                <div
                  key={ev.id}
                  role="listitem"
                  title={`${ev.title}
${ev.detail}`}
                  aria-label={`Club event: ${ev.title}, ${ev.detail}`}
                  className="pointer-events-auto absolute overflow-hidden rounded-lg border-2 border-dashed border-good-700 bg-good-50/90 px-1.5 py-1 text-[11px] leading-tight text-good-700 shadow-sm"
                  style={{
                    top: (ev.start - first) * PX_PER_MIN + 1,
                    height: h - 2,
                    left: `calc(${(dayIndex + 0.55) * DAY_WIDTH}% + 1px)`,
                    width: `calc(${DAY_WIDTH * 0.45}% - 4px)`,
                  }}
                >
                  <div className="font-bold">★ {ev.title}</div>
                  {h > 40 && <div className="opacity-80">{ev.detail.split(" · ")[1]}</div>}
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}
