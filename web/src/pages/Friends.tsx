import { useEffect, useId, useMemo, useState } from "react";
import { findCoursesTogether, rankCourses, type Course, type Pick } from "@slotted/engine";
import {
  acceptFriend, addFriend, friendTimetable, listFriends, myFriendCode, removeFriend,
  type Friend, type SharedChoice, type SharingApi,
} from "../data/friends";
import { allCourseRatings, type Ratings } from "../data/reviews";
import { formatMeetings, plural, sectionLabel, TERM_LABELS } from "../lib/format";
import type { ScheduleApi } from "../state/useSchedule";
import { courseHref } from "./Reviews";

type GridTerm = "first_term" | "second_term";

function toPicks(shared: SharedChoice[], byCode: Map<string, Course>): Pick[] {
  const picks: Pick[] = [];
  for (const choice of shared) {
    const course = byCode.get(choice.code);
    if (!course) continue;
    for (const classNumber of Object.values(choice.picks)) {
      const section = course.sections.find((s) => s.class_number === classNumber);
      if (section) picks.push({ courseCode: course.code, term: course.term, section });
    }
  }
  return picks;
}

function Together({ friend, courses, schedule, term }: { friend: Friend; courses: Course[]; schedule: ScheduleApi; term: GridTerm }) {
  const [shared, setShared] = useState<SharedChoice[] | null | undefined>(undefined);
  const [ratings, setRatings] = useState<Map<string, Ratings>>(new Map());
  const [subject, setSubject] = useState("");
  const [added, setAdded] = useState<string | null>(null);
  const byCode = useMemo(() => new Map(courses.map((c) => [c.code, c])), [courses]);

  useEffect(() => {
    friendTimetable(friend.friend_id).then(setShared).catch(() => setShared(null));
    allCourseRatings().then(setRatings).catch(() => undefined);
  }, [friend.friend_id]);

  const subjects = useMemo(
    () => [...new Set(courses.filter((c) => c.sections.some((s) => s.data_source === "dms")).map((c) => c.code.split(" ")[0]))].sort(),
    [courses],
  );

  const results = useMemo(() => {
    if (!shared) return [];
    const theirs = toPicks(shared, byCode);
    const fits = findCoursesTogether(courses, schedule.picks, theirs, schedule.state.prefs, { term, subject: subject || undefined, hideFull: true });
    return rankCourses(fits, ratings).slice(0, 20);
  }, [shared, byCode, courses, schedule.picks, schedule.state.prefs, term, subject, ratings]);

  if (shared === undefined) return <p className="mt-3 text-sm text-muted" role="status">Loading their timetable…</p>;
  if (shared === null) {
    return <p className="mt-3 text-sm text-muted">{friend.email} isn't sharing their timetable. Ask them to turn on sharing on their Friends page.</p>;
  }

  return (
    <div className="mt-3">
      <div className="flex flex-wrap items-end gap-3">
        <label className="text-sm">
          <span className="font-semibold">Subject</span>
          <select value={subject} onChange={(e) => setSubject(e.target.value)} className="mt-1 block rounded-lg border border-line px-3 py-1.5">
            <option value="">All with times</option>
            {subjects.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
        </label>
        <p className="py-1.5 text-sm text-muted">
          {plural(results.length, "course")} in {TERM_LABELS[term]} with the same sections free for both of you{results.length === 20 ? " (top 20)" : ""}.
        </p>
      </div>
      {added && (
        <p role="status" className="mt-2 rounded-xl bg-good-50 px-3 py-2 text-sm text-good-700">
          Added {added} to your courses. Tell {friend.email} the class numbers so they can add the same sections.
        </p>
      )}
      <ul className="mt-3 space-y-2">
        {results.map((rec) => (
          <li key={rec.course.code} className="rounded-xl border border-line bg-white p-3">
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div>
                <a href={courseHref(rec.course.code)} className="font-semibold hover:text-brand-700 hover:underline">{rec.course.code}</a>
                <span className="ml-2 text-sm text-muted">{String(rec.course.title ?? "")}</span>
                {rec.rating && rec.rating.review_count > 0 && (
                  <span className="ml-2 text-xs font-semibold text-[#9a6b00]">★ {rec.rating.overall.toFixed(1)} ({rec.rating.review_count})</span>
                )}
              </div>
              <button type="button"
                onClick={() => {
                  schedule.addCourse(rec.course.code, Object.fromEntries(rec.sections.map((p) => [p.section.component, p.section.class_number])));
                  setAdded(rec.course.code);
                }}
                className="rounded-lg bg-brand-700 px-3 py-1 text-xs font-semibold text-white hover:bg-brand-800">
                Add to my courses
              </button>
            </div>
            <ul className="mt-1 text-xs text-muted">
              {rec.sections.map((p) => (
                <li key={p.section.class_number}>
                  <b className="text-ink">{sectionLabel(p.section)}</b> (class {p.section.class_number}) · {formatMeetings(p.section.meetings) || "Online, no fixed time"}
                </li>
              ))}
            </ul>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** Friends: add by code, accept requests, share your timetable, find courses to take together. */
export function Friends({ userId, courses, schedule, term, sharing }: {
  userId: string; courses: Course[]; schedule: ScheduleApi; term: GridTerm; sharing: SharingApi;
}) {
  const [code, setCode] = useState("");
  const [myCode, setMyCode] = useState("");
  const [friends, setFriends] = useState<Friend[] | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const [message, setMessage] = useState<{ tone: "ok" | "error"; text: string } | null>(null);
  const [copied, setCopied] = useState(false);
  const id = useId();

  const refresh = () => listFriends().then(setFriends).catch((e: Error) => setMessage({ tone: "error", text: e.message }));
  useEffect(() => {
    void refresh();
    myFriendCode(userId).then(setMyCode).catch(() => undefined);
  }, [userId]);

  async function run(work: () => Promise<void>, ok?: string) {
    setMessage(null);
    try {
      await work();
      if (ok) setMessage({ tone: "ok", text: ok });
      await refresh();
    } catch (e) {
      setMessage({ tone: "error", text: (e as Error).message });
    }
  }

  const incoming = (friends ?? []).filter((f) => f.status === "pending" && f.incoming);
  const outgoing = (friends ?? []).filter((f) => f.status === "pending" && !f.incoming);
  const accepted = (friends ?? []).filter((f) => f.status === "accepted");

  return (
    <div className="mx-auto max-w-4xl px-4 py-6">
      <h1 className="font-display text-2xl font-bold sm:text-3xl">Friends</h1>
      <p className="mt-1 text-muted">Find courses you and a friend can take together, in the same sections.</p>

      <div className="mt-5 grid gap-4 sm:grid-cols-2">
        <section className="rounded-2xl border border-line bg-white p-4 shadow-sm">
          <h2 className="font-semibold">Your friend code</h2>
          <p className="mt-1 text-xs text-muted">Give it to a friend so they can send you a request.</p>
          <div className="mt-2 flex items-center gap-2">
            <code className="rounded-lg bg-page px-3 py-1.5 font-mono text-lg font-bold tracking-widest">{myCode || "…"}</code>
            <button type="button" disabled={!myCode}
              onClick={() => { void navigator.clipboard?.writeText(myCode).then(() => { setCopied(true); setTimeout(() => setCopied(false), 2000); }); }}
              className="rounded-lg border border-line px-3 py-1.5 text-sm font-semibold hover:border-brand-200">
              {copied ? "Copied" : "Copy"}
            </button>
          </div>
          <label className="mt-4 flex items-start gap-2 text-sm">
            <input type="checkbox" className="mt-0.5 size-4 accent-brand-700" checked={!!sharing.sharing} disabled={sharing.sharing === null}
              onChange={(e) => void sharing.setSharing(e.target.checked)} />
            <span>
              <b>Share my timetable with friends</b>
              <span className="block text-xs text-muted">Friends see only your chosen sections, and it stays up to date as you change them. Turn off any time.</span>
            </span>
          </label>
          {sharing.error && <p role="alert" className="mt-1 text-xs text-conflict-700">{sharing.error}</p>}
        </section>

        <section className="rounded-2xl border border-line bg-white p-4 shadow-sm">
          <h2 className="font-semibold">Add a friend</h2>
          <form className="mt-2 flex gap-2" onSubmit={(e) => { e.preventDefault(); if (code.trim()) void run(async () => { await addFriend(code); setCode(""); }, "Request sent."); }}>
            <label htmlFor={id} className="sr-only">Friend code</label>
            <input id={id} value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} placeholder="Their 8-letter code" maxLength={8}
              className="min-w-0 flex-1 rounded-lg border border-line px-3 py-1.5 font-mono tracking-widest" />
            <button type="submit" disabled={code.trim().length < 8} className="rounded-lg bg-brand-700 px-4 py-1.5 text-sm font-semibold text-white disabled:opacity-50">
              Send
            </button>
          </form>
          {message && <p role={message.tone === "error" ? "alert" : "status"} className={`mt-2 text-sm ${message.tone === "error" ? "text-conflict-700" : "text-good-700"}`}>{message.text}</p>}
        </section>
      </div>

      {incoming.length > 0 && (
        <section className="mt-6">
          <h2 className="font-display text-lg font-semibold">Requests for you</h2>
          <ul className="mt-2 space-y-2">
            {incoming.map((f) => (
              <li key={f.friendship_id} className="flex flex-wrap items-center gap-3 rounded-xl border border-line bg-white px-4 py-2 text-sm">
                <span className="flex-1">{f.email}</span>
                <button type="button" onClick={() => void run(() => acceptFriend(f.friendship_id), `You and ${f.email} are now friends.`)}
                  className="rounded-lg bg-brand-700 px-3 py-1 font-semibold text-white">Accept</button>
                <button type="button" onClick={() => void run(() => removeFriend(f.friendship_id))} className="text-muted hover:text-ink">Decline</button>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="mt-6">
        <h2 className="font-display text-lg font-semibold">Your friends</h2>
        {friends === null ? (
          <p className="mt-2 text-sm text-muted" role="status">Loading…</p>
        ) : accepted.length === 0 ? (
          <p className="mt-2 text-sm text-muted">No friends yet. Share your code, or add someone else's.</p>
        ) : (
          <ul className="mt-2 space-y-3">
            {accepted.map((f) => (
              <li key={f.friendship_id} className="rounded-2xl border border-line bg-white p-4 shadow-sm">
                <div className="flex flex-wrap items-center gap-3">
                  <span className="flex-1 font-semibold">{f.email}</span>
                  <span className={`text-xs ${f.sharing ? "text-good-700" : "text-muted"}`}>{f.sharing ? "Sharing timetable" : "Not sharing"}</span>
                  <button type="button" onClick={() => setOpen(open === f.friendship_id ? null : f.friendship_id)} aria-expanded={open === f.friendship_id}
                    className="rounded-lg border border-line px-3 py-1 text-sm font-semibold hover:border-brand-200">
                    {open === f.friendship_id ? "Hide" : "Courses together"}
                  </button>
                  <button type="button" onClick={() => window.confirm(`Remove ${f.email} as a friend?`) && void run(() => removeFriend(f.friendship_id))}
                    className="text-xs text-muted hover:text-conflict-700">Remove</button>
                </div>
                {open === f.friendship_id && <Together friend={f} courses={courses} schedule={schedule} term={term} />}
              </li>
            ))}
          </ul>
        )}
        {outgoing.length > 0 && (
          <p className="mt-3 text-xs text-muted">
            Waiting for: {outgoing.map((f) => f.email).join(", ")}.{" "}
            {outgoing.map((f) => (
              <button key={f.friendship_id} type="button" onClick={() => void run(() => removeFriend(f.friendship_id))} className="underline">
                Cancel {f.email}
              </button>
            ))}
          </p>
        )}
      </section>
    </div>
  );
}
