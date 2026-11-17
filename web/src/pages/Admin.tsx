import { useEffect, useState } from "react";
import { loadAdminCounts, type AdminCounts } from "../data/admin";
import { CATEGORY_LABELS, listAllClubs, reviewClub, type ClubRequest } from "../data/clubs";
import type { Profile } from "../data/profile";
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
export function Admin({ profile }: { profile: Profile }) {
  const [counts, setCounts] = useState<AdminCounts | null>(null);
  const [clubs, setClubs] = useState<ClubRequest[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refresh = async () => {
    try {
      const [c, all] = await Promise.all([loadAdminCounts(), listAllClubs()]);
      setCounts(c);
      setClubs(all);
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
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="mt-8 rounded-2xl border border-line bg-white p-5 shadow-sm">
        <h2 className="font-display text-lg font-semibold">Reported reviews</h2>
        <p className="mt-1 text-3xl font-bold">{counts ? counts.openReports : "–"}</p>
        <p className="text-sm text-muted">open reports · moderation arrives with the reviews build step</p>
      </section>
    </div>
  );
}
