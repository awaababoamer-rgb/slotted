import { classifyEvent, type Pick } from "@slotted/engine";
import type { MyEventsApi } from "../data/myEvents";
import { shortDate } from "../lib/eventGrid";
import { formatRange, formatTime } from "../lib/format";

const SHOW = 4;

/** Builder side panel: the next few club events that fit (or that you can join late). */
export function FitsPanel({ picks, myEvents }: { picks: Pick[]; myEvents: MyEventsApi }) {
  const upcoming = (myEvents.events ?? [])
    .map((e) => ({ e, fit: classifyEvent({ date: e.event_date, start: e.start_time, end: e.end_time }, picks) }))
    .filter((r) => r.fit.kind !== "hidden")
    .slice(0, SHOW);

  return (
    <section className="rounded-2xl border border-line bg-white p-4 shadow-sm">
      <div className="flex items-baseline justify-between">
        <h2 className="font-display text-lg font-semibold">Fits your schedule</h2>
        <a href="#events" className="text-sm font-semibold text-brand-700 hover:underline">All events →</a>
      </div>
      {myEvents.events === null ? (
        <p className="mt-2 text-sm text-muted" role="status">Loading…</p>
      ) : upcoming.length === 0 ? (
        <p className="mt-2 text-sm text-muted">No upcoming club events fit around your classes yet.</p>
      ) : (
        <ul className="mt-2 divide-y divide-line">
          {upcoming.map(({ e, fit }) => {
            const added = myEvents.addedIds.has(e.id);
            return (
              <li key={e.id} className="flex items-start gap-2 py-2.5">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-semibold">{e.title}</p>
                  <p className="truncate text-xs text-muted">{e.club_name}</p>
                  <p className="text-xs">
                    {shortDate(e.event_date)} · {formatRange(e.start_time, e.end_time)}
                    {fit.kind === "join_late" && (
                      <span className="ml-1 font-semibold text-[#7a5300]">· join from {formatTime(fit.joinFrom)}</span>
                    )}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => void myEvents.toggle(e.id)}
                  aria-pressed={added}
                  aria-label={added ? `Remove ${e.title} from your week` : `Add ${e.title} to your week`}
                  className={`shrink-0 rounded-lg px-2.5 py-1 text-xs font-semibold ${
                    added ? "bg-good-50 text-good-700" : "border border-brand-200 text-brand-700 hover:bg-brand-50"
                  }`}
                >
                  {added ? "✓ Added" : "+ Add"}
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
