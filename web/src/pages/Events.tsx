import { useEffect, useId, useMemo, useState } from "react";
import { classifyEvent, hasKnownTimes, type EventFit, type Pick } from "@slotted/engine";
import { EventForm } from "../components/EventForm";
import { CATEGORIES, CATEGORY_LABELS, listVisibleClubs, myExecClubIds, type Category, type Club } from "../data/clubs";
import { deleteEvent, listEvents, mediaUrl, type ClubEvent } from "../data/events";
import { formatRange, formatTime } from "../lib/format";

function todayISO(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function longDate(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(y, m - 1, d).toLocaleDateString("en-CA", { weekday: "short", month: "short", day: "numeric" });
}

function FitBadge({ fit }: { fit: EventFit }) {
  if (fit.kind === "fits") {
    return <span className="rounded-full bg-good-50 px-2 py-0.5 text-[11px] font-semibold text-good-700">Fits your schedule</span>;
  }
  if (fit.kind === "join_late") {
    return (
      <span className="rounded-full bg-[#fdf3d6] px-2 py-0.5 text-[11px] font-semibold text-[#7a5300]">
        Join from {formatTime(fit.joinFrom)}
      </span>
    );
  }
  return <span className="rounded-full bg-conflict-50 px-2 py-0.5 text-[11px] font-semibold text-conflict-700">Clashes with class</span>;
}

function EventCard({ event, fit, canManage, onEdit, onDelete }: {
  event: ClubEvent; fit: EventFit; canManage: boolean; onEdit: () => void; onDelete: () => void;
}) {
  return (
    <article className="flex flex-col rounded-2xl border border-line bg-white p-4 shadow-sm">
      <div className="flex flex-wrap items-center gap-2">
        <FitBadge fit={fit} />
        <span className="rounded-full bg-brand-50 px-2 py-0.5 text-[11px] font-semibold text-brand-700">{CATEGORY_LABELS[event.category]}</span>
      </div>
      <h3 className="mt-2 font-display text-lg font-semibold">{event.title}</h3>
      <p className="text-sm font-medium text-brand-700">{event.club_name}</p>
      <p className="mt-1 text-sm">
        {longDate(event.event_date)} · {formatRange(event.start_time, event.end_time)}
        {event.location && <> · {event.location}</>}
      </p>
      {fit.kind === "join_late" && (
        <p className="mt-1 text-xs text-muted">
          You're in {fit.clashesWith.map((p) => p.courseCode).join(", ")} until {formatTime(fit.joinFrom)}, then {fit.minutesLeft} min left.
        </p>
      )}
      {event.description && <p className="mt-2 text-sm whitespace-pre-line text-muted">{event.description}</p>}
      {event.media.length > 0 && (
        <div className="mt-3 grid grid-cols-2 gap-2">
          {event.media.map((m) =>
            m.type === "image" ? (
              <img key={m.path} src={mediaUrl(m.path)} alt={`Photo for ${event.title}`} loading="lazy" className="aspect-video w-full rounded-lg object-cover" />
            ) : (
              <video key={m.path} src={mediaUrl(m.path)} controls preload="metadata" className="col-span-2 w-full rounded-lg bg-ink" />
            ),
          )}
        </div>
      )}
      {canManage && (
        <div className="mt-3 flex gap-3 border-t border-line pt-3 text-sm">
          <button type="button" onClick={onEdit} className="font-semibold text-brand-700 hover:underline">Edit</button>
          <button type="button" onClick={onDelete} className="font-semibold text-conflict-700 hover:underline">Delete</button>
        </div>
      )}
    </article>
  );
}

/** The club events board: events filtered against the student's schedule. */
export function Events({ userId, picks }: { userId: string; picks: Pick[] }) {
  const [events, setEvents] = useState<ClubEvent[] | null>(null);
  const [clubs, setClubs] = useState<Club[]>([]);
  const [execIds, setExecIds] = useState<Set<string>>(new Set());
  const [error, setError] = useState<string | null>(null);
  const [category, setCategory] = useState<"all" | Category>("all");
  const [date, setDate] = useState("");
  const [search, setSearch] = useState("");
  const [showHidden, setShowHidden] = useState(false);
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<ClubEvent | null>(null);
  const ids = { cat: useId(), date: useId(), search: useId() };

  const refresh = async () => {
    try {
      const [ev, cl, ex] = await Promise.all([listEvents({ fromDate: todayISO() }), listVisibleClubs(), myExecClubIds(userId)]);
      setEvents(ev);
      setClubs(cl);
      setExecIds(ex);
    } catch (e) {
      setError((e as Error).message);
    }
  };
  useEffect(() => void refresh(), []);

  const myClubs = clubs.filter((c) => c.status === "approved" && execIds.has(c.id));
  const unchecked = picks.filter((p) => !hasKnownTimes(p.section)).map((p) => p.courseCode);

  const rows = useMemo(() => {
    const q = search.trim().toLowerCase();
    return (events ?? [])
      .filter((e) => category === "all" || e.category === category)
      .filter((e) => !date || e.event_date === date)
      .filter((e) => !q || e.club_name.toLowerCase().includes(q))
      .map((e) => ({ event: e, fit: classifyEvent({ date: e.event_date, start: e.start_time, end: e.end_time }, picks) }));
  }, [events, category, date, search, picks]);
  const shown = rows.filter((r) => showHidden || r.fit.kind !== "hidden");
  const hiddenCount = rows.length - rows.filter((r) => r.fit.kind !== "hidden").length;

  async function remove(event: ClubEvent) {
    if (!window.confirm(`Delete "${event.title}"? This can't be undone.`)) return;
    try {
      await deleteEvent(event);
      await refresh();
    } catch (e) {
      setError((e as Error).message);
    }
  }

  return (
    <div className="mx-auto max-w-6xl px-4 py-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="font-display text-2xl font-bold sm:text-3xl">Club events</h1>
          <p className="mt-1 text-muted">Upcoming events, checked against the classes in your current schedule.</p>
        </div>
        {myClubs.length > 0 && !formOpen && (
          <button type="button" onClick={() => { setEditing(null); setFormOpen(true); }}
            className="rounded-lg bg-brand-700 px-4 py-2 text-sm font-semibold text-white hover:bg-brand-800">
            Post an event
          </button>
        )}
      </div>

      {error && <p role="alert" className="mt-4 rounded-xl bg-conflict-50 px-4 py-3 text-sm text-conflict-700">{error}</p>}

      {formOpen && (
        <div className="mt-5">
          <EventForm
            key={editing?.id ?? "new"}
            clubs={myClubs}
            editing={editing}
            onCancel={() => { setFormOpen(false); setEditing(null); }}
            onDone={() => { setFormOpen(false); setEditing(null); void refresh(); }}
          />
        </div>
      )}

      <div className="mt-5 flex flex-wrap items-end gap-3 rounded-2xl border border-line bg-white p-4 shadow-sm">
        <label htmlFor={ids.search} className="text-sm">
          <span className="font-semibold">Club</span>
          <input id={ids.search} placeholder="Search club name" value={search} onChange={(e) => setSearch(e.target.value)}
            className="mt-1 block w-48 rounded-lg border border-line px-3 py-1.5" />
        </label>
        <label htmlFor={ids.cat} className="text-sm">
          <span className="font-semibold">Category</span>
          <select id={ids.cat} value={category} onChange={(e) => setCategory(e.target.value as "all" | Category)}
            className="mt-1 block rounded-lg border border-line px-3 py-1.5">
            <option value="all">All</option>
            {CATEGORIES.map((c) => <option key={c} value={c}>{CATEGORY_LABELS[c]}</option>)}
          </select>
        </label>
        <label htmlFor={ids.date} className="text-sm">
          <span className="font-semibold">Date</span>
          <input id={ids.date} type="date" min={todayISO()} value={date} onChange={(e) => setDate(e.target.value)}
            className="mt-1 block rounded-lg border border-line px-3 py-1.5" />
        </label>
        {(search || category !== "all" || date) && (
          <button type="button" onClick={() => { setSearch(""); setCategory("all"); setDate(""); }} className="py-1.5 text-sm text-muted hover:text-ink">
            Clear filters
          </button>
        )}
      </div>

      {unchecked.length > 0 && (
        <p className="mt-3 text-xs text-muted">
          Not checked against {[...new Set(unchecked)].join(", ")}: times not available yet.
        </p>
      )}
      {picks.length === 0 && (
        <p className="mt-3 text-xs text-muted">Add courses in the Builder to see which events fit your week.</p>
      )}

      {events === null ? (
        <p className="mt-6 text-sm text-muted" role="status">Loading events…</p>
      ) : shown.length === 0 ? (
        <p className="mt-6 text-sm text-muted">
          {rows.length === 0 ? "No upcoming events match." : "Every matching event clashes with your classes."}
        </p>
      ) : (
        <div className="mt-5 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {shown.map(({ event, fit }) => (
            <EventCard
              key={event.id}
              event={event}
              fit={fit}
              canManage={execIds.has(event.club_id)}
              onEdit={() => { setEditing(event); setFormOpen(true); window.scrollTo({ top: 0, behavior: "smooth" }); }}
              onDelete={() => void remove(event)}
            />
          ))}
        </div>
      )}

      {hiddenCount > 0 && (
        <p className="mt-4 text-sm text-muted">
          {hiddenCount} {hiddenCount === 1 ? "event is" : "events are"} hidden because {hiddenCount === 1 ? "it clashes" : "they clash"} with your
          classes (or leave under 30 minutes after class).{" "}
          <button type="button" onClick={() => setShowHidden((s) => !s)} className="font-semibold text-brand-700 hover:underline">
            {showHidden ? "Hide them" : "Show them anyway"}
          </button>
        </p>
      )}
    </div>
  );
}
