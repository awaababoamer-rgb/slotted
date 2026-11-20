// Who is using Slotted right now: a signed-in student, or a guest (userId = null).
// Pages read this to hide things only accounts can do (write reviews, join clubs, friends).

import { createContext, useContext } from "react";

export interface Account {
  /** null = browsing as a guest. */
  userId: string | null;
  /** Open the sign-in screen. */
  signIn: () => void;
}

const AccountContext = createContext<Account>({ userId: null, signIn: () => undefined });

export const AccountProvider = AccountContext.Provider;

export function useAccount(): Account {
  return useContext(AccountContext);
}

/** Where a guest's week is kept in this browser. */
export const GUEST_ID = "guest";

/** Shown instead of a page that needs an account (Friends, Clubs). */
export function SignInNeeded({ title, what }: { title: string; what: string }) {
  const { signIn } = useAccount();
  return (
    <div className="mx-auto max-w-xl px-4 py-12 text-center">
      <h1 className="font-display text-2xl font-bold">{title}</h1>
      <p className="mt-2 text-muted">{what}</p>
      <p className="mt-1 text-sm text-muted">This part needs a free account with your university email (no password, we email you a code).</p>
      <button type="button" onClick={signIn}
        className="mt-5 rounded-lg bg-brand-700 px-5 py-2 font-semibold text-white hover:bg-brand-800">
        Sign in
      </button>
    </div>
  );
}
