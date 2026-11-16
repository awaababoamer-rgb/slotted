import { scoreSchedule, type Fix, type Move, type Pick, type TermStats } from "@slotted/engine";
import { formatMeetings, formatTime } from "./format";

const COMPONENT_NAMES: Record<string, string> = { LEC: "lecture", LAB: "lab", TUT: "tutorial" };

export function componentName(component: string): string {
  return COMPONENT_NAMES[component] ?? component.toLowerCase();
}

export function moveTimes(move: Move): { from: string; to: string } {
  return {
    from: formatMeetings(move.from.meetings) || "no fixed time",
    to: formatMeetings(move.to.meetings) || "no fixed time",
  };
}

/** Split the engine's label ("Only moves labs · Fewest gaps · Uses a full…") into a title and extra notes. */
export function splitLabel(label: string): { title: string; notes: string[] } {
  const parts = label.split(" · ");
  return { title: parts[0], notes: parts.slice(1) };
}

type GridTerm = "first_term" | "second_term";

/** Which term's week a fix mostly changes (used for its stats). */
export function fixTerm(fix: Fix, fallback: GridTerm): GridTerm {
  const term = fix.schedule.find((p) => p.section === fix.moves[0]?.to)?.term;
  return term === "first_term" || term === "second_term" ? term : fallback;
}

export function termStats(schedule: Pick[], term: GridTerm): TermStats {
  const score = scoreSchedule(schedule);
  return term === "first_term" ? score.firstTerm : score.secondTerm;
}

const hours = (h: number) => (Number.isInteger(h) ? `${h}h` : `${h.toFixed(1)}h`);

/** One or two plain sentences: what moves, and what gets better or worse. */
export function explainFix(fix: Fix, current: Pick[], term: GridTerm): string {
  const sentences = fix.moves.map((m) => {
    const { from, to } = moveTimes(m);
    return `${m.courseCode} ${componentName(m.component)} moves from ${from} to ${to}.`;
  });

  const before = termStats(current, term);
  const after = termStats(fix.schedule, term);
  const changes: string[] = [];
  if (after.gapHours !== before.gapHours) {
    changes.push(`downtime ${after.gapHours < before.gapHours ? "drops" : "rises"} from ${hours(before.gapHours)} to ${hours(after.gapHours)}`);
  }
  if (after.fridayClasses !== before.fridayClasses) {
    changes.push(`Friday goes from ${before.fridayClasses} to ${after.fridayClasses} ${after.fridayClasses === 1 ? "class" : "classes"}`);
  }
  if (after.latestEnd && before.latestEnd && after.latestEnd !== before.latestEnd) {
    changes.push(`you're done by ${formatTime(after.latestEnd)}`);
  }
  if (changes.length > 0) {
    const text = changes.join(", ");
    sentences.push(`${text[0].toUpperCase()}${text.slice(1)}.`);
  }
  return sentences.join(" ");
}
