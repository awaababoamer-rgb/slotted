import { useEffect, useId, useMemo, useState } from "react";
import type { Course } from "@slotted/engine";
import {
  courseRatings, createReview, deleteReview, listReviews, rateMyProfessorsUrl, recentTerms, reportReview, updateReview,
  type Ratings, type Review, type ReviewInput,
} from "../data/reviews";
import { useAccount } from "../auth/account";
import { formatDate, plural, termTag } from "../lib/format";

const OTHER = "__other__";

function Stars({ value }: { value: number }) {
  const rounded = Math.round(value);
  return (
    <span aria-label={`${value.toFixed(1)} out of 5`} className="text-[#d49b00]">
      {"★".repeat(rounded)}
      <span className="text-line">{"★".repeat(5 - rounded)}</span>
    </span>
  );
}

function Scale({ label, value, onChange, low, high }: {
  label: string; value: number; onChange: (n: number) => void; low: string; high: string;
}) {
  const name = useId();
  return (
    <fieldset>
      <legend className="text-sm font-semibold">{label}</legend>
      <div className="mt-1 flex items-center gap-2 text-xs text-muted">
        <span className="w-16 text-right">{low}</span>
        <div className="flex gap-1">
          {[1, 2, 3, 4, 5].map((n) => (
            <label key={n} className={`grid size-9 cursor-pointer place-items-center rounded-lg border text-sm font-semibold has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-brand-600 ${
              value === n ? "border-brand-700 bg-brand-700 text-white" : "border-line text-ink hover:border-brand-200"
            }`}>
              <input type="radio" name={name} value={n} checked={value === n} onChange={() => onChange(n)} className="sr-only" />
              {n}
            </label>
          ))}
        </div>
        <span className="w-16">{high}</span>
      </div>
    </fieldset>
  );
}

function ReviewForm({ course, professors, editing, onDone, onCancel }: {
  course: Course; professors: string[]; editing: Review | null; onDone: () => void; onCancel: () => void;
}) {
  const terms = recentTerms();
  const [form, setForm] = useState<ReviewInput>(() => editing ? {
    course_code: editing.course_code, professor: editing.professor, term_taken: editing.term_taken, overall: editing.overall,
    difficulty: editing.difficulty, workload: editing.workload, would_take_again: editing.would_take_again, comment: editing.comment,
  } : {
    course_code: course.code, professor: professors[0] ?? "", term_taken: terms[1] ?? terms[0], overall: 0,
    difficulty: 0, workload: 0, would_take_again: true, comment: "",
  });
  const [profChoice, setProfChoice] = useState(professors.includes(form.professor) ? form.professor : (form.professor ? OTHER : professors[0] ?? OTHER));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const id = useId();
  const set = (patch: Partial<ReviewInput>) => setForm((f) => ({ ...f, ...patch }));

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const professor = (profChoice === OTHER ? form.professor : profChoice).trim();
    if (professor.length < 2) return setError("Choose or type the professor's name.");
    if (!form.overall || !form.difficulty || !form.workload) return setError("Give all three ratings (1–5).");
    setBusy(true);
    setError(null);
    try {
      const input = { ...form, professor, comment: form.comment.trim() };
      if (editing) await updateReview(editing.id, input);
      else await createReview(input);
      onDone();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="rounded-2xl border border-line bg-white p-5 shadow-sm">
      <h2 className="font-display text-lg font-semibold">{editing ? "Edit your review" : `Review ${course.code}`}</h2>
      <p className="mt-1 text-sm text-muted">Other students see your review anonymously. Be honest and fair; reviews can be reported.</p>
      <div className="mt-4 grid gap-4 sm:grid-cols-2">
        <div>
          <label htmlFor={`${id}-prof`} className="text-sm font-semibold">Professor</label>
          <select id={`${id}-prof`} value={profChoice} onChange={(e) => setProfChoice(e.target.value)}
            className="mt-1 w-full rounded-lg border border-line px-3 py-2 text-sm">
            {professors.map((p) => <option key={p} value={p}>{p}</option>)}
            <option value={OTHER}>Someone else…</option>
          </select>
          {profChoice === OTHER && (
            <input aria-label="Professor's name" placeholder="e.g. J. Smith" maxLength={80} value={form.professor}
              onChange={(e) => set({ professor: e.target.value })} className="mt-2 w-full rounded-lg border border-line px-3 py-2 text-sm" />
          )}
        </div>
        <div>
          <label htmlFor={`${id}-term`} className="text-sm font-semibold">Term you took it</label>
          <select id={`${id}-term`} value={form.term_taken} onChange={(e) => set({ term_taken: e.target.value })}
            className="mt-1 w-full rounded-lg border border-line px-3 py-2 text-sm">
            {[...new Set([form.term_taken, ...terms])].map((t) => <option key={t} value={t}>{t}</option>)}
          </select>
        </div>
        <div className="space-y-3 sm:col-span-2">
          <Scale label="Overall" value={form.overall} onChange={(n) => set({ overall: n })} low="Poor" high="Excellent" />
          <Scale label="Difficulty" value={form.difficulty} onChange={(n) => set({ difficulty: n })} low="Easy" high="Very hard" />
          <Scale label="Workload" value={form.workload} onChange={(n) => set({ workload: n })} low="Light" high="Heavy" />
        </div>
        <fieldset className="sm:col-span-2">
          <legend className="text-sm font-semibold">Would you take it again?</legend>
          <div className="mt-1 flex gap-2">
            {[true, false].map((v) => (
              <label key={String(v)} className={`cursor-pointer rounded-lg border px-4 py-1.5 text-sm font-semibold ${
                form.would_take_again === v ? "border-brand-700 bg-brand-700 text-white" : "border-line"
              }`}>
                <input type="radio" name={`${id}-again`} checked={form.would_take_again === v} onChange={() => set({ would_take_again: v })} className="sr-only" />
                {v ? "Yes" : "No"}
              </label>
            ))}
          </div>
        </fieldset>
        <div className="sm:col-span-2">
          <label htmlFor={`${id}-comment`} className="text-sm font-semibold">Comments</label>
          <textarea id={`${id}-comment`} rows={4} maxLength={3000} value={form.comment} onChange={(e) => set({ comment: e.target.value })}
            placeholder="What should other students know? Assessments, teaching style, tips…"
            className="mt-1 w-full rounded-lg border border-line px-3 py-2 text-sm" />
        </div>
      </div>
      {error && <p role="alert" className="mt-3 text-sm text-conflict-700">{error}</p>}
      <div className="mt-4 flex justify-end gap-2">
        <button type="button" onClick={onCancel} className="rounded-lg border border-line px-4 py-2 text-sm font-semibold">Cancel</button>
        <button type="submit" disabled={busy} className="rounded-lg bg-brand-700 px-4 py-2 text-sm font-semibold text-white disabled:opacity-60">
          {busy ? "Saving…" : editing ? "Save changes" : "Post review"}
        </button>
      </div>
    </form>
  );
}

function RatingTile({ label, value, suffix }: { label: string; value: string; suffix?: string }) {
  return (
    <div className="rounded-xl bg-page px-3 py-2">
      <dt className="text-xs text-muted">{label}</dt>
      <dd className="text-xl font-bold">{value}<span className="text-sm font-normal text-muted">{suffix}</span></dd>
    </div>
  );
}

/** A course's reviews: averages, filters by professor and term, and the reviews themselves. */
export function CoursePage({ course }: { course: Course | undefined }) {
  const { userId, signIn } = useAccount();
  const [reviews, setReviews] = useState<Review[] | null>(null);
  const [ratings, setRatings] = useState<Ratings | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [profFilter, setProfFilter] = useState("");
  const [termFilter, setTermFilter] = useState("");
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<Review | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const refresh = async () => {
    if (!course) return;
    try {
      const [r, a] = await Promise.all([listReviews(course.code), courseRatings(course.code)]);
      setReviews(r);
      setRatings(a);
    } catch (e) {
      setError((e as Error).message);
    }
  };
  useEffect(() => void refresh(), [course?.code]);

  const professors = useMemo(() => {
    const fromSections = (course?.sections ?? []).flatMap((s) => (s.instructors as string[] | undefined) ?? []);
    const fromReviews = (reviews ?? []).map((r) => r.professor);
    return [...new Set([...fromSections, ...fromReviews])].sort();
  }, [course, reviews]);
  const terms = [...new Set((reviews ?? []).map((r) => r.term_taken))];

  if (!course) {
    return (
      <div className="mx-auto max-w-3xl px-4 py-10 text-center">
        <h1 className="font-display text-2xl font-bold">Course not found</h1>
        <a href="#reviews" className="mt-4 inline-block font-semibold text-brand-700">← Search courses</a>
      </div>
    );
  }

  const shown = (reviews ?? []).filter((r) => (!profFilter || r.professor === profFilter) && (!termFilter || r.term_taken === termFilter));
  const mine = (reviews ?? []).filter((r) => r.is_mine);
  const sectionProfs = [...new Set(course.sections.flatMap((s) => (s.instructors as string[] | undefined) ?? []))];

  async function remove(r: Review) {
    if (!window.confirm("Delete your review? This can't be undone.")) return;
    try {
      await deleteReview(r.id);
      await refresh();
    } catch (e) {
      setError((e as Error).message);
    }
  }

  async function report(r: Review) {
    const reason = window.prompt("Why are you reporting this review? (e.g. offensive, personal attack, spam)");
    if (reason === null) return;
    try {
      await reportReview(r.id, reason);
      setNotice("Thanks. The Slotted team will take a look.");
    } catch (e) {
      setNotice((e as Error).message);
    }
  }

  return (
    <div className="mx-auto max-w-4xl px-4 py-6">
      <a href="#reviews" className="text-sm font-semibold text-brand-700 hover:underline">← All courses</a>
      <div className="mt-2 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="font-display text-2xl font-bold sm:text-3xl">{course.code}</h1>
          <p className="text-muted">{String(course.title ?? "")} · {termTag(course.term)}</p>
        </div>
        {!formOpen && (
          <button type="button" onClick={() => (userId ? (setEditing(null), setFormOpen(true)) : signIn())}
            className="rounded-lg bg-brand-700 px-4 py-2 text-sm font-semibold text-white hover:bg-brand-800">
            {userId ? "Write a review" : "Sign in to write a review"}
          </button>
        )}
      </div>

      {error && <p role="alert" className="mt-4 rounded-xl bg-conflict-50 px-4 py-3 text-sm text-conflict-700">{error}</p>}
      {notice && <p role="status" className="mt-4 rounded-xl bg-good-50 px-4 py-3 text-sm text-good-700">{notice}</p>}

      <section className="mt-5 rounded-2xl border border-line bg-white p-5 shadow-sm">
        {ratings && ratings.review_count > 0 ? (
          <>
            <p className="text-sm text-muted">Average of {plural(ratings.review_count, "review")}</p>
            <dl className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-4">
              <RatingTile label="Overall" value={ratings.overall.toFixed(1)} suffix=" / 5" />
              <RatingTile label="Difficulty" value={ratings.difficulty.toFixed(1)} suffix=" / 5" />
              <RatingTile label="Workload" value={ratings.workload.toFixed(1)} suffix=" / 5" />
              <RatingTile label="Would take again" value={`${ratings.would_take_again_pct}`} suffix="%" />
            </dl>
          </>
        ) : (
          <p className="text-sm text-muted">{reviews === null ? "Loading…" : "No reviews yet. Be the first to review this course."}</p>
        )}
        {sectionProfs.length > 0 && (
          <p className="mt-3 text-xs text-muted">
            This term's instructors on Rate My Professors:{" "}
            {sectionProfs.map((p, i) => (
              <span key={p}>
                {i > 0 && ", "}
                <a href={rateMyProfessorsUrl(p)} target="_blank" rel="noreferrer" className="font-semibold text-brand-700 hover:underline">{p} ↗</a>
              </span>
            ))}
          </p>
        )}
      </section>

      {formOpen && (
        <div className="mt-5">
          <ReviewForm
            key={editing?.id ?? "new"}
            course={course}
            professors={professors}
            editing={editing}
            onCancel={() => { setFormOpen(false); setEditing(null); }}
            onDone={() => { setFormOpen(false); setEditing(null); void refresh(); }}
          />
        </div>
      )}

      {(reviews?.length ?? 0) > 0 && (
        <div className="mt-5 flex flex-wrap items-end gap-3">
          <label className="text-sm">
            <span className="font-semibold">Professor</span>
            <select value={profFilter} onChange={(e) => setProfFilter(e.target.value)} className="mt-1 block rounded-lg border border-line px-3 py-1.5">
              <option value="">All</option>
              {[...new Set((reviews ?? []).map((r) => r.professor))].sort().map((p) => <option key={p} value={p}>{p}</option>)}
            </select>
          </label>
          <label className="text-sm">
            <span className="font-semibold">Term</span>
            <select value={termFilter} onChange={(e) => setTermFilter(e.target.value)} className="mt-1 block rounded-lg border border-line px-3 py-1.5">
              <option value="">All</option>
              {terms.map((t) => <option key={t} value={t}>{t}</option>)}
            </select>
          </label>
          <span className="py-1.5 text-sm text-muted">{plural(shown.length, "review")}</span>
        </div>
      )}

      {mine.length > 0 && !formOpen && (
        <p className="mt-3 text-xs text-muted">Your reviews are marked "You". Only you can see that; others see them anonymously.</p>
      )}

      <ul className="mt-4 space-y-3">
        {shown.map((r) => (
          <li key={r.id} className="rounded-2xl border border-line bg-white p-4 shadow-sm">
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
              <Stars value={r.overall} />
              <b className="text-sm">{r.professor}</b>
              <span className="text-xs text-muted">{r.term_taken}</span>
              {r.is_mine && <span className="rounded-full bg-brand-50 px-2 py-0.5 text-[11px] font-semibold text-brand-700">You</span>}
              <span className="ml-auto text-xs text-muted">{formatDate(r.created_at)}</span>
            </div>
            <p className="mt-1 text-xs text-muted">
              Difficulty {r.difficulty}/5 · Workload {r.workload}/5 · {r.would_take_again ? "Would take again" : "Wouldn't take again"}
            </p>
            {r.comment && <p className="mt-2 text-sm whitespace-pre-line">{r.comment}</p>}
            <div className="mt-3 flex gap-3 text-xs font-semibold">
              {r.is_mine ? (
                <>
                  <button type="button" onClick={() => { setEditing(r); setFormOpen(true); window.scrollTo({ top: 0, behavior: "smooth" }); }} className="text-brand-700 hover:underline">Edit</button>
                  <button type="button" onClick={() => void remove(r)} className="text-conflict-700 hover:underline">Delete</button>
                </>
              ) : userId ? (
                <button type="button" onClick={() => void report(r)} className="text-muted hover:text-conflict-700">Report</button>
              ) : null}
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
