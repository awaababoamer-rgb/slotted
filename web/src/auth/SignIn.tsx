import { useEffect, useId, useState } from "react";
import { CalendarIcon } from "../components/icons";
import { requireSupabase } from "../data/supabase";
import { emailAllowed, listSchools, type School } from "../data/schools";

const RESEND_SECONDS = 60;

/** Turn Supabase's error messages into plain language. */
function explain(message: string): string {
  if (/database error|only for university email|check_violation/i.test(message)) {
    return "Slotted accounts are only for university email addresses on our list.";
  }
  if (/rate limit|too many|security purposes/i.test(message)) {
    return "Too many codes requested. Wait a minute, then try again.";
  }
  if (/expired|invalid/i.test(message)) return "That code didn't work. Check it, or send a new one.";
  return message;
}

/**
 * Sign in with a one-time code emailed to a university address (Western, Waterloo, ...). No passwords.
 * Slotted's own design: it does not look like Western's login page.
 */
export function SignIn({ onBack }: { onBack?: () => void }) {
  const [step, setStep] = useState<"email" | "code">("email");
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [resendIn, setResendIn] = useState(0);
  const [schools, setSchools] = useState<School[]>([]);

  useEffect(() => {
    // If this fails, the database still enforces the list; we just skip the early check.
    listSchools().then(setSchools).catch(() => setSchools([]));
  }, []);
  const emailId = useId();
  const codeId = useId();

  useEffect(() => {
    if (resendIn <= 0) return;
    const t = setTimeout(() => setResendIn((s) => s - 1), 1000);
    return () => clearTimeout(t);
  }, [resendIn]);

  async function sendCode() {
    const clean = email.trim().toLowerCase();
    if (schools.length > 0 && !emailAllowed(clean, schools)) {
      setError("Use your university email address. Click \"Which schools?\" to see the list.");
      return;
    }
    setBusy(true);
    setError(null);
    const { error } = await requireSupabase().auth.signInWithOtp({
      email: clean,
      options: { shouldCreateUser: true },
    });
    setBusy(false);
    if (error) {
      setError(explain(error.message));
      return;
    }
    setEmail(clean);
    setStep("code");
    setResendIn(RESEND_SECONDS);
  }

  async function verify() {
    const token = code.replace(/\s/g, "");
    if (!/^\d{6,10}$/.test(token)) {
      setError("Enter the code from the email (numbers only).");
      return;
    }
    setBusy(true);
    setError(null);
    const { error } = await requireSupabase().auth.verifyOtp({ email, token, type: "email" });
    setBusy(false);
    if (error) setError(explain(error.message));
    // On success, the session listener in App switches to the planner.
  }

  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-page px-4 py-10">
      <div className="w-full max-w-md">
        <div className="mb-6 flex items-center justify-center gap-2.5">
          <span className="grid size-11 place-items-center rounded-xl bg-brand-700 text-white"><CalendarIcon className="size-6" /></span>
          <span className="font-display text-3xl font-bold">Slotted</span>
        </div>

        <main className="rounded-2xl border border-line bg-white p-6 shadow-sm sm:p-8">
          {step === "email" ? (
            <form onSubmit={(e) => { e.preventDefault(); void sendCode(); }} noValidate>
              <h1 className="font-display text-2xl font-bold">Plan your week, minus the clashes</h1>
              <p className="mt-2 text-sm text-muted">
                Sign in with your <b className="text-ink">university email</b> (Western, Waterloo, Toronto and other Ontario
                universities). We'll send you a one-time code. No password needed.
              </p>
              <label htmlFor={emailId} className="mt-6 block text-sm font-semibold">Your university email</label>
              <input
                id={emailId}
                type="email"
                inputMode="email"
                autoComplete="email"
                autoFocus
                placeholder="you@uwo.ca or you@uwaterloo.ca"
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
                {busy ? "Sending…" : "Email me a code"}
              </button>
              {schools.length > 0 && (
                <details className="mt-4 text-sm">
                  <summary className="cursor-pointer font-semibold text-brand-700">Which schools?</summary>
                  <ul className="mt-2 grid grid-cols-1 gap-x-4 gap-y-0.5 text-xs text-muted sm:grid-cols-2">
                    {[...new Map(schools.map((s) => [s.school_name, s])).values()].map((s) => (
                      <li key={s.school_name}>
                        {s.school_name}{" "}
                        <span className="text-muted/80">
                          ({schools.filter((x) => x.school_name === s.school_name).map((x) => `@${x.domain}`).join(", ")})
                        </span>
                      </li>
                    ))}
                  </ul>
                </details>
              )}
            </form>
          ) : (
            <form onSubmit={(e) => { e.preventDefault(); void verify(); }} noValidate>
              <h1 className="font-display text-2xl font-bold">Check your email</h1>
              <p className="mt-2 text-sm text-muted">
                We sent a code to <b className="text-ink">{email}</b>. It can take a minute to arrive; check your junk folder too.
              </p>
              <label htmlFor={codeId} className="mt-6 block text-sm font-semibold">Code</label>
              <input
                id={codeId}
                inputMode="numeric"
                autoComplete="one-time-code"
                autoFocus
                maxLength={12}
                placeholder="123456"
                value={code}
                onChange={(e) => { setCode(e.target.value); setError(null); }}
                aria-invalid={!!error}
                aria-describedby={error ? `${codeId}-err` : undefined}
                className="mt-1.5 w-full rounded-lg border border-line px-3 py-2.5 text-center font-mono text-2xl tracking-[0.4em] placeholder:text-muted/40 focus:border-brand-600"
              />
              {error && <p id={`${codeId}-err`} role="alert" className="mt-2 text-sm text-conflict-700">{error}</p>}
              <button
                type="submit"
                disabled={busy}
                className="mt-5 w-full rounded-lg bg-brand-700 px-4 py-2.5 font-semibold text-white hover:bg-brand-800 disabled:opacity-60"
              >
                {busy ? "Checking…" : "Sign in"}
              </button>
              <div className="mt-4 flex justify-between text-sm">
                <button type="button" onClick={() => { setStep("email"); setCode(""); setError(null); }} className="text-muted hover:text-ink">
                  ← Use a different email
                </button>
                <button
                  type="button"
                  disabled={resendIn > 0 || busy}
                  onClick={() => void sendCode()}
                  className="font-semibold text-brand-700 disabled:text-muted disabled:font-normal"
                >
                  {resendIn > 0 ? `Resend in ${resendIn}s` : "Send a new code"}
                </button>
              </div>
            </form>
          )}
        </main>

        {onBack && (
          <p className="mt-4 text-center">
            <button type="button" onClick={onBack} className="text-sm font-semibold text-brand-700 hover:underline">
              ← Keep using Slotted as a guest
            </button>
          </p>
        )}

        <p className="mt-6 text-center text-xs text-muted">
          Slotted is an independent student project, not affiliated with Western University.
          <br />
          Slotted never asks for your Western password.
        </p>
      </div>
    </div>
  );
}
