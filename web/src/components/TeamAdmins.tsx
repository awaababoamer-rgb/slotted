import { useEffect, useId, useState } from "react";
import { listAdmins, setAdmin, type AdminUser } from "../data/admin";

/** Admin page section: see who's an admin, add a teammate by email, or remove one. */
export function TeamAdmins({ myUserId }: { myUserId: string }) {
  const [admins, setAdmins] = useState<AdminUser[] | null>(null);
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ tone: "ok" | "error"; text: string } | null>(null);
  const id = useId();

  const refresh = () => listAdmins().then(setAdmins).catch((e: Error) => setMessage({ tone: "error", text: e.message }));
  useEffect(() => void refresh(), []);

  async function change(target: string, makeAdmin: boolean) {
    if (!makeAdmin && !window.confirm(`Remove admin access for ${target}?`)) return;
    setBusy(true);
    setMessage(null);
    try {
      await setAdmin(target, makeAdmin);
      setMessage({ tone: "ok", text: makeAdmin ? `${target} is now an admin.` : `${target} is no longer an admin.` });
      if (makeAdmin) setEmail("");
      await refresh();
    } catch (e) {
      setMessage({ tone: "error", text: (e as Error).message });
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="mt-8 rounded-2xl border border-line bg-white p-5 shadow-sm">
      <h2 className="font-display text-lg font-semibold">Team admins</h2>
      <p className="mt-1 text-sm text-muted">
        Admins can approve clubs, moderate reviews and manage other admins. Teammates must sign in to Slotted once before you can add them.
      </p>

      <ul className="mt-3 divide-y divide-line rounded-xl border border-line text-sm">
        {admins === null ? (
          <li className="px-4 py-2 text-muted" role="status">Loading…</li>
        ) : (
          admins.map((a) => (
            <li key={a.user_id} className="flex items-center justify-between gap-3 px-4 py-2">
              <span className="truncate">
                {a.email}
                {a.user_id === myUserId && <span className="ml-2 text-xs text-muted">(you)</span>}
              </span>
              {a.user_id !== myUserId && (
                <button type="button" disabled={busy} onClick={() => void change(a.email, false)}
                  className="shrink-0 text-xs font-semibold text-conflict-700 hover:underline disabled:opacity-50">
                  Remove admin
                </button>
              )}
            </li>
          ))
        )}
      </ul>

      <form className="mt-3 flex flex-wrap items-end gap-2" onSubmit={(e) => { e.preventDefault(); if (email.trim()) void change(email, true); }}>
        <label htmlFor={id} className="min-w-0 flex-1 text-sm">
          <span className="font-semibold">Add an admin</span>
          <input id={id} type="email" placeholder="teammate@uwo.ca" value={email} onChange={(e) => setEmail(e.target.value)}
            className="mt-1 block w-full rounded-lg border border-line px-3 py-1.5" />
        </label>
        <button type="submit" disabled={busy || !email.trim()}
          className="rounded-lg bg-brand-700 px-4 py-1.5 text-sm font-semibold text-white hover:bg-brand-800 disabled:opacity-50">
          Make admin
        </button>
      </form>
      {message && (
        <p role={message.tone === "error" ? "alert" : "status"}
          className={`mt-2 text-sm ${message.tone === "error" ? "text-conflict-700" : "text-good-700"}`}>
          {message.text}
        </p>
      )}
    </section>
  );
}
