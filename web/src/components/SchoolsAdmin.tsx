import { useEffect, useId, useState } from "react";
import { addSchool, listSchools, removeSchool, type School } from "../data/schools";

/** Admin page section: which universities' email addresses can sign in. */
export function SchoolsAdmin() {
  const [schools, setSchools] = useState<School[] | null>(null);
  const [domain, setDomain] = useState("");
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ tone: "ok" | "error"; text: string } | null>(null);
  const ids = { domain: useId(), name: useId() };

  const refresh = () => listSchools().then(setSchools).catch((e: Error) => setMessage({ tone: "error", text: e.message }));
  useEffect(() => void refresh(), []);

  async function run(work: () => Promise<void>, ok: string) {
    setBusy(true);
    setMessage(null);
    try {
      await work();
      setMessage({ tone: "ok", text: ok });
      await refresh();
    } catch (e) {
      setMessage({ tone: "error", text: (e as Error).message });
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="mt-8 rounded-2xl border border-line bg-white p-5 shadow-sm">
      <h2 className="font-display text-lg font-semibold">Schools</h2>
      <p className="mt-1 text-sm text-muted">
        Students with an email at one of these domains (or a subdomain, like mail.utoronto.ca) can create an account.
        Removing a school stops new sign-ups from it; existing accounts keep working.
      </p>

      <ul className="mt-3 max-h-72 divide-y divide-line overflow-y-auto rounded-xl border border-line text-sm">
        {schools === null ? (
          <li className="px-4 py-2 text-muted" role="status">Loading…</li>
        ) : (
          schools.map((s) => (
            <li key={s.domain} className="flex items-center justify-between gap-3 px-4 py-2">
              <span className="min-w-0 truncate">
                {s.school_name} <span className="text-muted">@{s.domain}</span>
              </span>
              {s.domain !== "uwo.ca" && (
                <button type="button" disabled={busy}
                  onClick={() => window.confirm(`Stop new sign-ups from @${s.domain}?`) && void run(() => removeSchool(s.domain), `Removed @${s.domain}.`)}
                  className="shrink-0 text-xs font-semibold text-conflict-700 hover:underline disabled:opacity-50">
                  Remove
                </button>
              )}
            </li>
          ))
        )}
      </ul>

      <form className="mt-3 flex flex-wrap items-end gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          void run(async () => {
            await addSchool(domain, name);
            setDomain("");
            setName("");
          }, `Added @${domain.trim().toLowerCase().replace(/^@/, "")}.`);
        }}>
        <label htmlFor={ids.domain} className="text-sm">
          <span className="font-semibold">Email domain</span>
          <input id={ids.domain} placeholder="uwaterloo.ca" value={domain} onChange={(e) => setDomain(e.target.value)}
            className="mt-1 block w-44 rounded-lg border border-line px-3 py-1.5" />
        </label>
        <label htmlFor={ids.name} className="min-w-0 flex-1 text-sm">
          <span className="font-semibold">School name</span>
          <input id={ids.name} placeholder="University of Waterloo" value={name} onChange={(e) => setName(e.target.value)}
            className="mt-1 block w-full rounded-lg border border-line px-3 py-1.5" />
        </label>
        <button type="submit" disabled={busy || !domain.trim() || name.trim().length < 2}
          className="rounded-lg bg-brand-700 px-4 py-1.5 text-sm font-semibold text-white hover:bg-brand-800 disabled:opacity-50">
          Add school
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
