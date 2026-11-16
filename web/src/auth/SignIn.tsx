import { useEffect, useId, useState } from "react";
import { CalendarIcon } from "../components/icons";
import { requireSupabase } from "../data/supabase";
import { UWO_EMAIL } from "./useSession";

const RESEND_SECONDS = 60;

/** Turn Supabase's error messages into plain language. */
function explain(message: string): string {
  if (/database error|only for @uwo\.ca|check_violation/i.test(message)) {
    return "Slotted accounts are only for @uwo.ca email addresses.";
  }
  if (/rate limit|too many|security purposes/i.test(message)) {
    return "Too many sign-in emails requested. Wait a few minutes, then try again.";
  }
  if (/expired|invalid/i.test(message)) {
    return "That sign-in link has expired or was already used. Send yourself a new one.";
  }
  return message;
}

/** If the student arrived from an expired/used link, Supabase puts the reason in the address. */
function errorFromAddress(): string | null {
  const params = new URLSearchParams(window.location.hash.slice(1) || window.location.search.slice(1));
  const description = params.get("error_description");
  if (!description) return null;
  window.history.replaceState(null, "", window.location.pathname); // tidy the address bar
  return explain(description.replaceAll("+", " "));
}

/**
 * Sign in with a one-time link emailed to an @uwo.ca address. No passwords.
 * Slotted's own design: it does not look like Western's login page.
 */
export function SignIn() {
  const [sent, setSent] = useState(false);
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(errorFromAddress);
  const [resendIn, setResendIn] = useState(0);
  const emailId = useId();

  useEffect(() => {
    if (resendIn <= 0) return;
    const t = setTimeout(() => setResendIn((s) => s - 1), 1000);
    return () => clearTimeout(t);
  }, [resendIn]);

  async function sendLink() {
    const clean = email.trim().toLowerCase();
    if (!UWO_EMAIL.test(clean)) {
      setError("Use your @uwo.ca email address.");
      return;
    }
    setBusy(true);
    setError(null);
    const { error } = await requireSupabase().auth.signInWithOtp({
      email: clean,
      // Where the link sends them back to: this site.
      options: { shouldCreateUser: true, emailRedirectTo: window.location.origin },
    });
    setBusy(false);
    if (error) {
      setError(explain(error.message));
      return;
    }
    setEmail(clean);
    setSent(true);
    setResendIn(RESEND_SECONDS);
  }

  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-page px-4 py-10">
      <div className="w-full max-w-md">
        <div className="mb-6 flex items-center justify-center gap-2.5">
          <span className="grid size-11 place-items-center rounded-xl bg-brand-700 text-white"><CalendarIcon className="size-6" /></span>
          <span className="font-display text-3xl font-bold">Slotted</span>
        </div>

        <main className="rounded-2xl border border-line bg-white p-6 shadow-sm sm:p-8">
          {!sent ? (
            <form onSubmit={(e) => { e.preventDefault(); void sendLink(); }} noValidate>
              <h1 className="font-display text-2xl font-bold">Plan your week, minus the clashes</h1>
              <p className="mt-2 text-sm text-muted">
                Sign in with your <b className="text-ink">@uwo.ca</b> email. We'll email you a sign-in link. No password needed.
              </p>
              <label htmlFor={emailId} className="mt-6 block text-sm font-semibold">Your @uwo.ca email</label>
              <input
                id={emailId}
                type="email"
                inputMode="email"
                autoComplete="email"
                autoFocus
                placeholder="you@uwo.ca"
                value={email}
                onChange={(e) => { setEmail(e.target.value); setError(null); }}
                aria-invalid={!!error}
                aria-describedby={error ? `${emailId}-err` : undefined}
                className="mt-1.5 w-full rounded-lg border border-line px-3 py-2.5 placeholder:text-muted/70 focus:border-brand-600"
              />
              {error && <p id={`${emailId}-err`} role="alert" className="mt-2 text-sm text-conflict-700">{error}</p>}
              <button
                type="submit"
                disabled={busy}
                className="mt-5 w-full rounded-lg bg-brand-700 px-4 py-2.5 font-semibold text-white hover:bg-brand-800 disabled:opacity-60"
              >
                {busy ? "Sending…" : "Email me a sign-in link"}
              </button>
            </form>
          ) : (
            <div role="status">
              <h1 className="font-display text-2xl font-bold">Check your email</h1>
              <p className="mt-2 text-sm text-muted">
                We sent a sign-in link to <b className="text-ink">{email}</b>. Click it to open Slotted, signed in.
              </p>
              <ul className="mt-4 list-disc space-y-1 pl-5 text-sm text-muted">
                <li>It can take a minute. Check your <b className="text-ink">Junk</b> folder too.</li>
                <li>The link works once. If it says it expired, send a new one.</li>
              </ul>
              {error && <p role="alert" className="mt-3 text-sm text-conflict-700">{error}</p>}
              <div className="mt-6 flex justify-between text-sm">
                <button type="button" onClick={() => { setSent(false); setError(null); }} className="text-muted hover:text-ink">
                  ← Use a different email
                </button>
                <button
                  type="button"
                  disabled={resendIn > 0 || busy}
                  onClick={() => void sendLink()}
                  className="font-semibold text-brand-700 disabled:font-normal disabled:text-muted"
                >
                  {resendIn > 0 ? `Resend in ${resendIn}s` : "Send a new link"}
                </button>
              </div>
            </div>
          )}
        </main>

        <p className="mt-6 text-center text-xs text-muted">
          Slotted is an independent student project, not affiliated with Western University.
          <br />
          Slotted never asks for your Western password.
        </p>
      </div>
    </div>
  );
}
