import { useEffect, useState } from "react";
import { loadAdminCounts, type AdminCounts } from "../data/admin";
import { CATEGORY_LABELS, deleteClub, listAllClubs, reviewClub, type ClubRequest } from "../data/clubs";
import type { Profile } from "../data/profile";
import { keepReview, listReportedReviews, removeReview, type ReportedReview } from "../data/reviews";
import type { Course } from "@slotted/engine";
import { ProgramsAdmin } from "../components/ProgramsAdmin";
import { SchoolsAdmin } from "../components/SchoolsAdmin";
import { TeamAdmins } from "../components/TeamAdmins";
import { courseHref } from "./Reviews";
import { formatDate } from "../lib/format";

function RequestCard({ club, onDone }: { club: ClubRequest; onDone: () => Promise<void> }) {
  const [note, setNote] = useState(club.review_note);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function decide(status: "approved" | "rejected") {
    if (status === "rejected" && !note.trim() && !window.confirm("Reject without a note for the requester?")) return;
    setBusy(true);
    setError(null);
    try {
      await reviewClub(club.id, status, note);
      await onDone();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <li className="rounded-xl border border-line bg-white p-4">
      <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
        <h3 className="font-semibold">{club.name}</h3>
        <span className="rounded-full bg-brand-50 px-2 py-0.5 text-[11px] font-semibold text-brand-700">{CATEGORY_LABELS[club.category]}</span>
        <span className="text-xs text-muted">requested {formatDate(club.created_at)}</span>
      </div>
      <p className="mt-1 text-sm text-muted">
        By <b className="text-ink">{club.requester_email ?? "unknown"}</b>, {club.requester_role || "role not given"}
      </p>
      {club.description && <p className="mt-2 text-sm">{club.description}</p>}
      <label className="mt-3 block text-xs font-semibold text-muted">
        Note to the requester (optional)
        <input
          value={note}
          onChange={(e) => setNote(e.target.value)}
          maxLength={500}
          className="mt-1 w-full rounded-lg border border-line px-3 py-1.5 text-sm font-normal text-ink"
        />
      </label>
      {error && <p role="alert" className="mt-2 text-sm text-conflict-700">{error}</p>}
      <div className="mt-3 flex gap-2">
        <button type="button" disabled={busy} onClick={() => void decide("approved")}
          className="rounded-lg bg-good-700 px-3 py-1.5 text-sm font-semibold text-white disabled:opacity-60">
          Approve
        </button>
        <button type="button" disabled={busy} onClick={() => void decide("rejected")}
          className="rounded-lg border border-conflict-200 px-3 py-1.5 text-sm font-semibold text-conflict-700 disabled:opacity-60">
          Reject
        </button>
      </div>
    </li>
  );
}

/**
 * Admin page: approve club requests and moderate reported reviews.
 * Only admins can open it, and the database refuses the data to anyone else.
 */
export function Admin({ profile, courses }: { profile: Profile; courses: Course[] }) {
  const [counts, setCounts] = useState<AdminCounts | null>(null);
  const [clubs, setClubs] = useState<ClubRequest[] | null>(null);
  const [reported, setReported] = useState<ReportedReview[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refresh = async () => {
    try {
      const [c, all, reports] = await Promise.all([loadAdminCounts(), listAllClubs(), listReportedReviews()]);
      setCounts(c);
      setClubs(all);
      setReported(reports);
    } catch (e) {
      setError((e as Error).message);
    }
  };
  useEffect(() => void refresh(), []);

  if (!profile.is_admin) {
    return (
      <div className="mx-auto max-w-3xl px-4 py-10 text-center">
        <h1 className="font-display text-2xl font-bold">Admins only</h1>
        <p className="mt-2 text-muted">This page is for the Slotted team.</p>
      </div>
    );
  }

  async function remove(c: ClubRequest) {
    if (!window.confirm(`Remove "${c.name}"? Its events and exec access are deleted too. This can't be undone.`)) return;
    try {
      await deleteClub(c.id);
      await refresh();
    } catch (e) {
      setError((e as Error).message);
    }
  }

  async function revoke(c: ClubRequest) {
    if (!window.confirm(`Revoke approval for "${c.name}"? Its execs lose posting access; existing events are kept but hidden.`)) return;
    try {
      await reviewClub(c.id, "rejected", c.review_note || "Approval revoked");
      await refresh();
    } catch (e) {
      setError((e as Error).message);
    }
  }

  async function moderate(action: () => Promise<void>) {
    try {
      await action();
      await refresh();
    } catch (e) {
      setError((e as Error).message);
    }
  }

  const pending = (clubs ?? []).filter((c) => c.status === "pending");
  const decided = (clubs ?? []).filter((c) => c.status !== "pending");

  return (
    <div className="mx-auto max-w-5xl px-4 py-6">
      <h1 className="font-display text-2xl font-bold sm:text-3xl">Admin</h1>
      <p className="mt-1 text-muted">Signed in as {profile.email} (admin).</p>
      {error && <p role="alert" className="mt-4 rounded-xl bg-conflict-50 px-4 py-3 text-sm text-conflict-700">{error}</p>}

      <section className="mt-6">
        <h2 className="font-display text-lg font-semibold">
          Club requests <span className="text-sm font-normal text-muted">· {pending.length} waiting</span>
        </h2>
        {clubs === null ? (
          <p className="mt-2 text-sm text-muted" role="status">Loading…</p>
        ) : pending.length === 0 ? (
          <p className="mt-2 text-sm text-muted">Nothing waiting. New requests show up here.</p>
        ) : (
          <ul className="mt-3 space-y-3">
            {pending.map((c) => <RequestCard key={c.id} club={c} onDone={refresh} />)}
          </ul>
        )}
      </section>

      {decided.length > 0 && (
        <section className="mt-8">
          <h2 className="font-display text-lg font-semibold">Decided</h2>
          <ul className="mt-2 divide-y divide-line rounded-xl border border-line bg-white text-sm">
            {decided.map((c) => (
              <li key={c.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-2">
                <b>{c.name}</b>
                <span className={c.status === "approved" ? "text-good-700" : "text-conflict-700"}>{c.status}</span>
                <span className="text-muted">{c.requester_email}</span>
                {c.review_note && <span className="text-muted">· {c.review_note}</span>}
                <span className="ml-auto text-xs text-muted">{formatDate(c.reviewed_at)}</span>
                {c.status === "approved" && (
                  <button type="button" onClick={() => void revoke(c)} className="text-xs font-semibold text-muted hover:text-conflict-700">
                    Revoke approval
                  </button>
                )}
                <button type="button" onClick={() => void remove(c)} className="text-xs font-semibold text-conflict-700 hover:underline">
                  Remove club
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="mt-8">
        <h2 className="font-display text-lg font-semibold">
          Reported reviews <span className="text-sm font-normal text-muted">· {counts?.openReports ?? "–"} open reports</span>
        </h2>
        {reported === null ? (
          <p className="mt-2 text-sm text-muted" role="status">Loading…</p>
        ) : reported.length === 0 ? (
          <p className="mt-2 text-sm text-muted">Nothing reported.</p>
        ) : (
          <ul className="mt-3 space-y-3">
            {reported.map(({ review: r, reasons, reportIds }) => (
              <li key={r.id} className="rounded-xl border border-line bg-white p-4">
                <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1 text-sm">
                  <a href={courseHref(r.course_code)} className="font-semibold text-brand-700 hover:underline">{r.course_code}</a>
                  <span>{r.professor}</span>
                  <span className="text-muted">{r.term_taken} · overall {r.overall}/5</span>
                </div>
                {r.comment && <p className="mt-2 rounded-lg bg-page px-3 py-2 text-sm whitespace-pre-line">{r.comment}</p>}
                <p className="mt-2 text-xs text-muted">
                  Reported {reasons.length} {reasons.length === 1 ? "time" : "times"}: {reasons.join(" · ")}
                </p>
                <div className="mt-3 flex gap-2">
                  <button type="button" onClick={() => void moderate(() => keepReview(reportIds))}
                    className="rounded-lg border border-line px-3 py-1.5 text-sm font-semibold">
                    Keep
                  </button>
                  <button type="button"
                    onClick={() => window.confirm("Remove this review for everyone? This can't be undone.") && void moderate(() => removeReview(r.id))}
                    className="rounded-lg border border-conflict-200 px-3 py-1.5 text-sm font-semibold text-conflict-700">
                    Remove review
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      <TeamAdmins myUserId={profile.user_id} />
      <ProgramsAdmin courses={courses} />
      <SchoolsAdmin />
    </div>
  );
}
