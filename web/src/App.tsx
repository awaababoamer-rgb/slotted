import { useEffect, useState } from "react";
import { CalendarIcon } from "./components/icons";
import { loadCatalog, type Catalog } from "./data/catalog";
import { formatDate, TERM_LABELS } from "./lib/format";
import { Builder } from "./pages/Builder";
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

function Shell({ catalog }: { catalog: Catalog }) {
  const schedule = useSchedule(catalog.courses);
  const [term, setTerm] = useState<GridTerm>("first_term");

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
            <a href="#builder" aria-current="page" className="rounded-lg bg-brand-100 px-3 py-1.5 text-sm font-semibold text-brand-700">Builder</a>
            <span className="cursor-not-allowed rounded-lg px-3 py-1.5 text-sm text-muted/60" title="Coming in a later step">Compare fixes</span>
            <span className="cursor-not-allowed rounded-lg px-3 py-1.5 text-sm text-muted/60" title="Coming in a later step">Priorities</span>
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

      <main id="builder" className="flex-1">
        <Builder courses={catalog.courses} schedule={schedule} term={term} />
      </main>

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
