import { blocksOf, blocksOverlap, hasKnownTimes, termsOverlap, toTime } from "./time";
import type { Conflict, ConflictReport, Pick } from "./types";

/**
 * Find every time conflict among the selected sections.
 *
 * Two sections conflict if their terms overlap and any of their meetings
 * overlap on the same day. Sections whose times are not available are
 * returned separately; they are never treated as free.
 */
export function findConflicts(selectedSections: Pick[]): ConflictReport {
  const timesNotAvailable = selectedSections.filter((p) => !hasKnownTimes(p.section));
  const placed = selectedSections.filter((p) => hasKnownTimes(p.section));
  const conflicts: Conflict[] = [];

  for (let i = 0; i < placed.length; i++) {
    for (let j = i + 1; j < placed.length; j++) {
      const a = placed[i];
      const b = placed[j];
      if (!termsOverlap(a.term, b.term)) continue;
      for (const x of blocksOf(a.section)) {
        for (const y of blocksOf(b.section)) {
          if (blocksOverlap(x, y)) {
            conflicts.push({
              a,
              b,
              day: x.day,
              start: toTime(Math.max(x.start, y.start)),
              end: toTime(Math.min(x.end, y.end)),
            });
          }
        }
      }
    }
  }
  return { conflicts, timesNotAvailable };
}
