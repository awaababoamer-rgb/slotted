import { useEffect, useState } from "react";
import type { Session } from "@supabase/supabase-js";
import { SignIn } from "./auth/SignIn";
import { useSession } from "./auth/useSession";
import { CalendarIcon } from "./components/icons";
import { PlanBar } from "./components/PlanBar";
import { loadCatalog, type Catalog } from "./data/catalog";
import { useMyEvents } from "./data/myEvents";
import { loadProfile, type Profile } from "./data/profile";
import { allProfessorRatings, type Ratings } from "./data/reviews";
import { supabase, supabaseConfigured } from "./data/supabase";
import { formatDate, TERM_LABELS } from "./lib/format";
import type { Preferences } from "@slotted/engine";
import { PrioritiesDialog } from "./components/PrioritiesDialog";
import type { WeekOption } from "./lib/weekOptions";
import { Builder } from "./pages/Builder";
import { Admin } from "./pages/Admin";
import { Clubs } from "./pages/Clubs";
import { CoursePage } from "./pages/CoursePage";
import { Events } from "./pages/Events";
import { FindCourses } from "./pages/FindCourses";
import { Programs } from "./pages/Programs";
import { Reviews } from "./pages/Reviews";
import { Compare } from "./pages/Compare";
import { storageKeyFor, useSchedule } from "./state/useSchedule";

type GridTerm = "first_term" | "second_term";

function Centered({ children }: { children: React.ReactNode }) {
  return <div className="grid min-h-screen place-items-center p-8 text-center">{children}</div>;
}

/** Branded loading screen. */
function Loading({ text }: { text: string }) {
  return (
    <Centered>
      <div role="status" className="flex flex-col items-center gap-4">
        <span className="grid size-12 animate-pulse place-items-center rounded-xl bg-brand-700 text-white motion-reduce:animate-none">
          <CalendarIcon className="size-6" />
        </span>
        <p className="font-display text-lg font-semibold">Slotted</p>
        <p className="text-sm text-muted">{text}</p>
      </div>
    </Centered>
  );
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
  if (loading) return <Loading text="Getting things ready…" />;
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
  if (!catalog || !profile) return <Loading text="Loading courses…" />;
  return <Shell catalog={catalog} session={session} profile={profile} />;
}

type Page = "builder" | "compare" | "programs" | "find" | "events" | "clubs" | "reviews" | "course" | "admin";

function pageFromHash(): Page {
  const hash = window.location.hash;
  if (hash === "#compare") return "compare";
  if (hash === "#programs") return "programs";
  if (hash === "#find") return "find";
  if (hash === "#events") return "events";
  if (hash === "#clubs") return "clubs";
  if (hash === "#reviews") return "reviews";
  if (hash.startsWith("#course/")) return "course";
  if (hash === "#admin") return "admin";
  return "builder";
}

function Shell({ catalog, session, profile }: { catalog: Catalog; session: Session; profile: Profile }) {
  const schedule = useSchedule(catalog.courses, storageKeyFor(session.user.id));
  const myEvents = useMyEvents();
  // Professor averages for the Builder. Refreshed whenever you come back to the Builder.
  const [profRatings, setProfRatings] = useState<Map<string, Ratings>>(new Map());
  const [term, setTerm] = useState<GridTerm>("first_term");
  const [page, setPage] = useState<Page>(pageFromHash);
  const [hash, setHash] = useState(window.location.hash);
  useEffect(() => {
    const titles: Record<Page, string> = {
      builder: "Builder", compare: "Compare weeks", programs: "Programs", find: "Find courses", events: "Club events",
      reviews: "Course reviews", course: decodeURIComponent(hash.slice("#course/".length)) || "Course",
      clubs: "Clubs", admin: "Admin",
    };
    document.title = `${titles[page]} · Slotted`;
  }, [page, hash]);
  useEffect(() => {
    if (page === "builder") allProfessorRatings().then(setProfRatings).catch(() => undefined);
  }, [page]);
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
      setHash(window.location.hash);
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

  const tab = (target: Page, label: string) => {
    const active = page === target || (target === "reviews" && page === "course");
    return (
      <a
        href={`#${target}`}
        aria-current={active ? "page" : undefined}
        className={`border-b-2 px-3 pb-2.5 pt-1 text-sm whitespace-nowrap transition-colors ${
          active ? "border-brand-700 font-semibold text-brand-700" : "border-transparent text-muted hover:text-ink"
        }`}
      >
        {label}
      </a>
    );
  };

  return (
    <div className="flex min-h-screen flex-col">
      <header className="sticky top-0 z-30 border-b border-line bg-white/95 backdrop-blur">
        <div className="mx-auto flex max-w-[1400px] items-center gap-3 px-4 pt-3">
          <a href="#builder" className="flex items-center gap-2.5" aria-label="Slotted home">
            <span className="grid size-9 place-items-center rounded-lg bg-brand-700 text-white"><CalendarIcon /></span>
            <span className="font-display text-xl font-bold">Slotted</span>
          </a>
          <div className="ml-auto flex items-center gap-2">
            <label className="flex items-center gap-2 text-sm text-muted">
              <span className="hidden sm:inline">Term</span>
              <select
                value={term}
                onChange={(e) => setTerm(e.target.value as GridTerm)}
                aria-label="Term"
                className="rounded-lg border border-line bg-white px-2.5 py-1.5 text-ink"
              >
                <option value="first_term">{TERM_LABELS.first_term}</option>
                <option value="second_term">{TERM_LABELS.second_term}</option>
              </select>
            </label>
            <button
              type="button"
              onClick={() => setPrioritiesOpen(true)}
              aria-haspopup="dialog"
              className="rounded-lg border border-line px-3 py-1.5 text-sm font-semibold hover:border-brand-200 hover:text-brand-700"
            >
              Priorities
            </button>
            <details className="relative">
              <summary
                aria-label={`Account: ${session.user.email}`}
                className="grid size-9 cursor-pointer list-none place-items-center rounded-full bg-brand-100 text-sm font-bold text-brand-700 uppercase [&::-webkit-details-marker]:hidden"
              >
                {(session.user.email ?? "?").slice(0, 1)}
              </summary>
              <div className="absolute right-0 z-40 mt-2 w-64 rounded-xl border border-line bg-white p-3 text-sm shadow-lg">
                <p className="text-xs text-muted">Signed in as</p>
                <p className="truncate font-semibold" title={session.user.email}>{session.user.email}</p>
                {profile.is_admin && <p className="mt-1 text-xs font-semibold text-brand-700">Admin</p>}
                <button
                  type="button"
                  onClick={() => void supabase?.auth.signOut()}
                  className="mt-3 w-full rounded-lg border border-line px-3 py-1.5 font-semibold hover:border-conflict-200 hover:text-conflict-700"
                >
                  Sign out
                </button>
              </div>
            </details>
          </div>
        </div>
        <nav aria-label="Main" className="mx-auto flex max-w-[1400px] gap-1 overflow-x-auto px-4 pt-2 [scrollbar-width:none]">
          {tab("builder", "Builder")}
          {tab("compare", "Compare")}
          {tab("programs", "Programs")}
          {tab("find", "Find courses")}
          {tab("events", "Events")}
          {tab("reviews", "Reviews")}
          {tab("clubs", "Clubs")}
          {profile.is_admin && tab("admin", "Admin")}
        </nav>
      </header>
      <PlanBar schedule={schedule} userId={session.user.id} />

      <main className="flex-1">
        {page === "admin" ? (
          <Admin profile={profile} courses={catalog.courses} />
        ) : page === "programs" ? (
          <Programs courses={catalog.courses} schedule={schedule} userId={session.user.id} />
        ) : page === "find" ? (
          <FindCourses courses={catalog.courses} schedule={schedule} term={term} />
        ) : page === "events" ? (
          <Events userId={session.user.id} picks={schedule.picks} myEvents={myEvents} />
        ) : page === "reviews" ? (
          <Reviews courses={catalog.courses} myCodes={schedule.state.choices.map((c) => c.code)} />
        ) : page === "course" ? (
          <CoursePage
            key={hash}
            course={catalog.courses.find((c) => c.code === decodeURIComponent(hash.slice("#course/".length)))}
          />
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
            myEvents={myEvents}
            profRatings={profRatings}
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
