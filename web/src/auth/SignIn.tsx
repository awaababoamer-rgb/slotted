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
    return "Too many codes requested. Wait a minute, then try again.";
  }
  if (/expired|invalid/i.test(message)) return "That code didn't work. Check it, or send a new one.";
  return message;
}

/**
 * Sign in with a one-time code emailed to an @uwo.ca address. No passwords.
 * Slotted's own design: it does not look like Western's login page.
 */
export function SignIn() {
  const [step, setStep] = useState<"email" | "code">("email");
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [resendIn, setResendIn] = useState(0);
  const emailId = useId();
  const codeId = useId();

  useEffect(() => {
    if (resendIn <= 0) return;
    const t = setTimeout(() => setResendIn((s) => s - 1), 1000);
    return () => clearTimeout(t);
  }, [resendIn]);

  async function sendCode() {
    const clean = email.trim().toLowerCase();
    if (!UWO_EMAIL.test(clean)) {
      setError("Use your @uwo.ca email address.");
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
                Sign in with your <b className="text-ink">@uwo.ca</b> email. We'll send you a one-time code. No password needed.
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
                {busy ? "Sending…" : "Email me a code"}
              </button>
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

        <p className="mt-6 text-center text-xs text-muted">
          Slotted is an independent student project, not affiliated with Western University.
          <br />
          Slotted never asks for your Western password.
        </p>
      </div>
    </div>
  );
}
