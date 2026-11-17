import { useEffect, useId, useState } from "react";
import { CATEGORIES, CATEGORY_LABELS, listVisibleClubs, requestClub, type Category, type Club } from "../data/clubs";
import { formatDate } from "../lib/format";

const inputClass = "mt-1 w-full rounded-lg border border-line px-3 py-2 text-sm focus:border-brand-600";

function StatusTag({ status }: { status: Club["status"] }) {
  const styles = {
    pending: "bg-[#fdf3d6] text-[#7a5300]",
    approved: "bg-good-50 text-good-700",
    rejected: "bg-conflict-50 text-conflict-700",
  }[status];
  return <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${styles}`}>{status}</span>;
}

/** Club directory + "Register a club" request form. */
export function Clubs({ userId }: { userId: string }) {
  const [clubs, setClubs] = useState<Club[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ name: "", description: "", category: "other" as Category, requester_role: "" });
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const ids = { name: useId(), desc: useId(), cat: useId(), role: useId() };

  const refresh = () => listVisibleClubs().then(setClubs).catch((e: Error) => setError(e.message));
  useEffect(() => void refresh(), []);

  const approved = (clubs ?? []).filter((c) => c.status === "approved");
  const mine = (clubs ?? []).filter((c) => c.requested_by === userId && c.status !== "approved");

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (form.name.trim().length < 2) return setFormError("Give the club a name.");
    if (!form.requester_role.trim()) return setFormError("Tell us your role in the club (e.g. President).");
    setBusy(true);
    setFormError(null);
    try {
      await requestClub(form);
      setForm({ name: "", description: "", category: "other", requester_role: "" });
      setShowForm(false);
      await refresh();
    } catch (err) {
      setFormError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mx-auto max-w-5xl px-4 py-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="font-display text-2xl font-bold sm:text-3xl">Clubs</h1>
          <p className="mt-1 text-muted">Approved clubs can post events to the board. Run a club? Register it here.</p>
        </div>
        <button
          type="button"
          onClick={() => setShowForm((s) => !s)}
          className="rounded-lg bg-brand-700 px-4 py-2 text-sm font-semibold text-white hover:bg-brand-800"
        >
          {showForm ? "Close" : "Register a club"}
        </button>
      </div>

      {error && <p role="alert" className="mt-4 rounded-xl bg-conflict-50 px-4 py-3 text-sm text-conflict-700">{error}</p>}

      {showForm && (
        <form onSubmit={submit} className="mt-5 rounded-2xl border border-line bg-white p-5 shadow-sm">
          <h2 className="font-display text-lg font-semibold">Register a club</h2>
          <p className="mt-1 text-sm text-muted">
            The Slotted team checks each request. Once approved, you can post your club's events.
          </p>
          <div className="mt-4 grid gap-4 sm:grid-cols-2">
            <div className="sm:col-span-2">
              <label htmlFor={ids.name} className="text-sm font-semibold">Club name</label>
              <input id={ids.name} maxLength={80} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} className={inputClass} />
            </div>
            <div className="sm:col-span-2">
              <label htmlFor={ids.desc} className="text-sm font-semibold">What does the club do?</label>
              <textarea id={ids.desc} rows={3} maxLength={2000} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} className={inputClass} />
            </div>
            <div>
              <label htmlFor={ids.cat} className="text-sm font-semibold">Category</label>
              <select id={ids.cat} value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value as Category })} className={inputClass}>
                {CATEGORIES.map((c) => <option key={c} value={c}>{CATEGORY_LABELS[c]}</option>)}
              </select>
            </div>
            <div>
              <label htmlFor={ids.role} className="text-sm font-semibold">Your role in the club</label>
              <input id={ids.role} maxLength={80} placeholder="e.g. President" value={form.requester_role} onChange={(e) => setForm({ ...form, requester_role: e.target.value })} className={inputClass} />
            </div>
          </div>
          {formError && <p role="alert" className="mt-3 text-sm text-conflict-700">{formError}</p>}
          <div className="mt-4 flex justify-end gap-2">
            <button type="button" onClick={() => setShowForm(false)} className="rounded-lg border border-line px-4 py-2 text-sm font-semibold">Cancel</button>
            <button type="submit" disabled={busy} className="rounded-lg bg-brand-700 px-4 py-2 text-sm font-semibold text-white disabled:opacity-60">
              {busy ? "Sending…" : "Send request"}
            </button>
          </div>
        </form>
      )}

      {mine.length > 0 && (
        <section className="mt-6">
          <h2 className="font-display text-lg font-semibold">Your requests</h2>
          <ul className="mt-2 space-y-2">
            {mine.map((c) => (
              <li key={c.id} className="rounded-xl border border-line bg-white px-4 py-3 text-sm">
                <div className="flex flex-wrap items-center gap-2">
                  <b>{c.name}</b> <StatusTag status={c.status} />
                  <span className="text-xs text-muted">requested {formatDate(c.created_at)}</span>
                </div>
                {c.status === "pending" && <p className="mt-1 text-muted">Waiting for the Slotted team to review it.</p>}
                {c.status === "rejected" && (
                  <p className="mt-1 text-muted">Not approved{c.review_note ? `: ${c.review_note}` : "."}</p>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="mt-6">
        <h2 className="font-display text-lg font-semibold">Approved clubs</h2>
        {clubs === null ? (
          <p className="mt-2 text-sm text-muted" role="status">Loading…</p>
        ) : approved.length === 0 ? (
          <p className="mt-2 text-sm text-muted">No clubs yet. Be the first to register one.</p>
        ) : (
          <ul className="mt-2 grid gap-3 sm:grid-cols-2">
            {approved.map((c) => (
              <li key={c.id} className="rounded-xl border border-line bg-white p-4">
                <div className="flex items-start justify-between gap-2">
                  <h3 className="font-semibold">{c.name}</h3>
                  <span className="shrink-0 rounded-full bg-brand-50 px-2 py-0.5 text-[11px] font-semibold text-brand-700">{CATEGORY_LABELS[c.category]}</span>
                </div>
                {c.description && <p className="mt-1 text-sm text-muted">{c.description}</p>}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
