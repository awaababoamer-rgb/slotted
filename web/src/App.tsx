import { useEffect, useState } from "react";
import { CalendarIcon } from "./components/icons";
import { loadCatalog, type Catalog } from "./data/catalog";
import { formatDate, TERM_LABELS } from "./lib/format";
import type { Preferences } from "@slotted/engine";
import { PrioritiesDialog } from "./components/PrioritiesDialog";
import type { WeekOption } from "./lib/weekOptions";
import { Builder } from "./pages/Builder";
import { Compare } from "./pages/Compare";
import { useSchedule } from "./state/useSchedule";

type GridTerm = "first_term" | "second_term";

export function App() {
  const [catalog, setCatalog] = useState<Catalog | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    loadCatalog().then(setCatalog).catch((e: unknown) => setError(String(e)));
  }, []);

  if (error) {
    return <p className="p-8 text-conflict-700">Couldn't load course data: {error}</p>;
  }
  if (!catalog) {
    return <p className="p-8 text-muted" role="status">Loading courses…</p>;
  }
  return <Shell catalog={catalog} />;
}

type Page = "builder" | "compare";

function pageFromHash(): Page {
  return window.location.hash === "#compare" ? "compare" : "builder";
}

function Shell({ catalog }: { catalog: Catalog }) {
  const schedule = useSchedule(catalog.courses);
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
        </div>
      </header>

      <main className="flex-1">
        {page === "compare" ? (
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
