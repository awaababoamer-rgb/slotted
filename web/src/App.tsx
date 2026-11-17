import { useEffect, useState } from "react";
import type { Session } from "@supabase/supabase-js";
import { SignIn } from "./auth/SignIn";
import { useSession } from "./auth/useSession";
import { CalendarIcon } from "./components/icons";
import { PlanBar } from "./components/PlanBar";
import { loadCatalog, type Catalog } from "./data/catalog";
import { loadProfile, type Profile } from "./data/profile";
import { supabase, supabaseConfigured } from "./data/supabase";
import { formatDate, TERM_LABELS } from "./lib/format";
import type { Preferences } from "@slotted/engine";
import { PrioritiesDialog } from "./components/PrioritiesDialog";
import type { WeekOption } from "./lib/weekOptions";
import { Builder } from "./pages/Builder";
import { Admin } from "./pages/Admin";
import { Clubs } from "./pages/Clubs";
import { Compare } from "./pages/Compare";
import { storageKeyFor, useSchedule } from "./state/useSchedule";

type GridTerm = "first_term" | "second_term";

function Centered({ children }: { children: React.ReactNode }) {
  return <div className="grid min-h-screen place-items-center p-8 text-center">{children}</div>;
}

export function App() {
  const { session, loading } = useSession();

  if (!supabaseConfigured) {
    return (
      <Centered>
        <div className="max-w-md">
          <h1 className="font-display text-2xl font-bold">Slotted isn't connected yet</h1>
          <p className="mt-2 text-muted">
            Create <code>web/.env.local</code> from <code>web/.env.example</code> with your Supabase URL and
            publishable key, then restart the dev server.
          </p>
        </div>
      </Centered>
    );
  }
  if (loading) return <Centered><p className="text-muted" role="status">Loading…</p></Centered>;
  if (!session) return <SignIn />;
  // key: a different person signing in gets a completely fresh app.
  return <SignedIn key={session.user.id} session={session} />;
}

/** Course data is only fetched after sign-in; the database refuses it otherwise. */
function SignedIn({ session }: { session: Session }) {
  const [catalog, setCatalog] = useState<Catalog | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    Promise.all([loadCatalog(), loadProfile(session.user.id)])
      .then(([c, p]) => { setCatalog(c); setProfile(p); })
      .catch((e: unknown) => setError(e instanceof Error ? e.message : String(e)));
  }, []);

  if (error) {
    return (
      <Centered>
        <div className="max-w-md">
          <p className="text-conflict-700">Couldn't load course data: {error}</p>
          <button type="button" onClick={() => void supabase?.auth.signOut()} className="mt-4 rounded-lg border border-line px-4 py-2 font-semibold">
            Sign out
          </button>
        </div>
      </Centered>
    );
  }
  if (!catalog || !profile) return <Centered><p className="text-muted" role="status">Loading courses…</p></Centered>;
  return <Shell catalog={catalog} session={session} profile={profile} />;
}

type Page = "builder" | "compare" | "clubs" | "admin";

function pageFromHash(): Page {
  const hash = window.location.hash;
  if (hash === "#compare") return "compare";
  if (hash === "#clubs") return "clubs";
  if (hash === "#admin") return "admin";
  return "builder";
}

function Shell({ catalog, session, profile }: { catalog: Catalog; session: Session; profile: Profile }) {
  const schedule = useSchedule(catalog.courses, storageKeyFor(session.user.id));
  const [term, setTerm] = useState<GridTerm>("first_term");
  const [page, setPage] = useState<Page>(pageFromHash);
  const [prioritiesOpen, setPrioritiesOpen] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  function savePriorities(prefs: Preferences) {
    schedule.setPrefs(prefs);
    setPrioritiesOpen(false);
    setNotice("Priorities saved. Fixes and weeks are re-ranked.");
    window.setTimeout(() => setNotice(null), 4000);
  }

  // Simple page switching with #builder / #compare in the address bar (back button works).
  useEffect(() => {
    const onHash = () => {
      setPage(pageFromHash());
      if (window.location.hash !== "#smart-resolve") window.scrollTo(0, 0);
    };
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);

  /** "Use this week" on Compare: go back to the Builder, then apply so the classes visibly slide. */
  function chooseWeek(option: WeekOption) {
    window.location.hash = "#builder";
    window.setTimeout(() => schedule.applyChange(option.fix, option.name), 350);
  }

  const tab = (target: Page, label: string) => (
    <a
      href={`#${target}`}
      aria-current={page === target ? "page" : undefined}
      className={`rounded-lg px-3 py-1.5 text-sm whitespace-nowrap ${
        page === target ? "bg-brand-100 font-semibold text-brand-700" : "text-muted hover:text-ink"
      }`}
    >
      {label}
    </a>
  );

  return (
    <div className="flex min-h-screen flex-col">
      <header className="border-b border-line bg-white">
        <div className="mx-auto flex max-w-[1400px] flex-wrap items-center gap-x-6 gap-y-2 px-4 py-3">
          <div className="flex items-center gap-2.5">
            <span className="grid size-9 place-items-center rounded-lg bg-brand-700 text-white"><CalendarIcon /></span>
            <span className="font-display text-xl font-bold">Slotted</span>
            <span className="hidden rounded-full bg-brand-100 px-2 py-0.5 text-xs font-semibold text-brand-700 sm:inline">
              Smart Resolve
            </span>
          </div>
          <nav aria-label="Main" className="order-3 flex w-full gap-1 overflow-x-auto sm:order-none sm:w-auto">
            {tab("builder", "Builder")}
            {tab("compare", "Compare weeks")}
            {tab("clubs", "Clubs")}
            {profile.is_admin && tab("admin", "Admin")}
            <button
              type="button"
              onClick={() => setPrioritiesOpen(true)}
              aria-haspopup="dialog"
              className={`rounded-lg px-3 py-1.5 text-sm whitespace-nowrap ${
                prioritiesOpen ? "bg-brand-100 font-semibold text-brand-700" : "text-muted hover:text-ink"
              }`}
            >
              Priorities
            </button>
          </nav>
          <label className="ml-auto flex items-center gap-2 text-sm text-muted">
            Term
            <select
              value={term}
              onChange={(e) => setTerm(e.target.value as GridTerm)}
              className="rounded-lg border border-line bg-white px-3 py-1.5 text-ink"
            >
              <option value="first_term">{TERM_LABELS.first_term}</option>
              <option value="second_term">{TERM_LABELS.second_term}</option>
            </select>
          </label>
          <div className="flex items-center gap-2 text-sm">
            <span className="hidden max-w-[14rem] truncate text-muted md:inline" title={session.user.email}>{session.user.email}</span>
            <button
              type="button"
              onClick={() => void supabase?.auth.signOut()}
              className="rounded-lg border border-line px-3 py-1.5 font-semibold hover:border-brand-200"
            >
              Sign out
            </button>
          </div>
        </div>
      </header>
      <PlanBar schedule={schedule} userId={session.user.id} />

      <main className="flex-1">
        {page === "admin" ? (
          <Admin profile={profile} />
        ) : page === "clubs" ? (
          <Clubs userId={session.user.id} />
        ) : page === "compare" ? (
          <Compare
            courses={catalog.courses}
            schedule={schedule}
            term={term}
            onUseWeek={chooseWeek}
            onEditPriorities={() => setPrioritiesOpen(true)}
          />
        ) : (
          <Builder
            courses={catalog.courses}
            schedule={schedule}
            term={term}
            onEditPriorities={() => setPrioritiesOpen(true)}
          />
        )}
      </main>

      <PrioritiesDialog
        open={prioritiesOpen}
        prefs={schedule.state.prefs}
        onSave={savePriorities}
        onClose={() => setPrioritiesOpen(false)}
      />
      <div
        role="status"
        aria-live="polite"
        className={`fixed bottom-4 left-1/2 z-30 -translate-x-1/2 rounded-xl bg-ink px-4 py-2.5 text-sm text-white shadow-lg transition-opacity ${
          notice ? "opacity-100" : "pointer-events-none opacity-0"
        }`}
      >
        {notice}
      </div>

      <footer className="border-t border-line bg-white">
        <div className="mx-auto flex max-w-[1400px] flex-wrap justify-between gap-2 px-4 py-3 text-xs text-muted">
          <span>
            Data last updated: course list {formatDate(catalog.lastUpdated)}, class times{" "}
            {formatDate(catalog.timesLastUpdated)}. Always confirm in Student Center.
          </span>
          <span>Slotted is an independent student project, not affiliated with Western University.</span>
        </div>
      </footer>
    </div>
  );
}
