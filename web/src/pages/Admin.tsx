import { useEffect, useState } from "react";
import { loadAdminCounts, type AdminCounts } from "../data/admin";
import type { Profile } from "../data/profile";

/**
 * Admin page: approve club requests and moderate reported reviews.
 * Only admins can open it, and the database refuses the data to anyone else.
 */
export function Admin({ profile }: { profile: Profile }) {
  const [counts, setCounts] = useState<AdminCounts | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    loadAdminCounts().then(setCounts).catch((e: Error) => setError(e.message));
  }, []);

  if (!profile.is_admin) {
    return (
      <div className="mx-auto max-w-3xl px-4 py-10 text-center">
        <h1 className="font-display text-2xl font-bold">Admins only</h1>
        <p className="mt-2 text-muted">This page is for the Slotted team.</p>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-5xl px-4 py-6">
      <h1 className="font-display text-2xl font-bold sm:text-3xl">Admin</h1>
      <p className="mt-1 text-muted">Signed in as {profile.email} (admin).</p>
      {error && <p role="alert" className="mt-4 rounded-xl bg-conflict-50 px-4 py-3 text-sm text-conflict-700">{error}</p>}

      <div className="mt-6 grid gap-4 sm:grid-cols-2">
        <section className="rounded-2xl border border-line bg-white p-5 shadow-sm">
          <h2 className="font-display text-lg font-semibold">Club requests</h2>
          <p className="mt-1 text-3xl font-bold">{counts ? counts.pendingClubs : "–"}</p>
          <p className="text-sm text-muted">waiting for approval · {counts?.approvedClubs ?? "–"} clubs approved</p>
          <p className="mt-3 text-xs text-muted">Approve and reject requests here (next build step).</p>
        </section>
        <section className="rounded-2xl border border-line bg-white p-5 shadow-sm">
          <h2 className="font-display text-lg font-semibold">Reported reviews</h2>
          <p className="mt-1 text-3xl font-bold">{counts ? counts.openReports : "–"}</p>
          <p className="text-sm text-muted">open reports</p>
          <p className="mt-3 text-xs text-muted">Keep or remove reported reviews here (reviews build step).</p>
        </section>
      </div>
    </div>
  );
}
