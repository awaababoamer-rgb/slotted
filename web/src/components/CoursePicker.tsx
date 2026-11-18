import { useId, useMemo, useState } from "react";
import type { Course } from "@slotted/engine";
import { searchCourses } from "../lib/search";

/** A small "type to find a course" box that hands back the chosen course code. */
export function CoursePicker({ courses, onPick, exclude = [], label = "Add a course" }: {
  courses: Course[]; onPick: (code: string) => void; exclude?: string[]; label?: string;
}) {
  const [query, setQuery] = useState("");
  const id = useId();
  const results = useMemo(
    () => searchCourses(courses, query, 8).filter((c) => !exclude.includes(c.code)),
    [courses, query, exclude],
  );

  return (
    <div className="relative">
      <label htmlFor={id} className="sr-only">{label}</label>
      <input
        id={id}
        placeholder={`${label} (e.g. CS 2210B)`}
        value={query}
        autoComplete="off"
        onChange={(e) => setQuery(e.target.value)}
        className="w-full rounded-lg border border-line px-3 py-1.5 text-sm"
      />
      {query.trim().length >= 2 && results.length > 0 && (
        <ul className="absolute right-0 left-0 z-20 mt-1 max-h-64 overflow-auto rounded-lg border border-line bg-white py-1 text-sm shadow-lg">
          {results.map((c) => (
            <li key={c.code}>
              <button type="button" onClick={() => { onPick(c.code); setQuery(""); }}
                className="block w-full px-3 py-1.5 text-left hover:bg-brand-50">
                <b>{c.code}</b> <span className="text-muted">{String(c.title ?? "")}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
