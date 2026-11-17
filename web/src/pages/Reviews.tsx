import { useId, useMemo, useState } from "react";
import type { Course } from "@slotted/engine";
import { termTag } from "../lib/format";
import { searchCourses } from "../lib/search";

export const courseHref = (code: string) => `#course/${encodeURIComponent(code)}`;

/** Find a course to read or write reviews for. */
export function Reviews({ courses, myCodes }: { courses: Course[]; myCodes: string[] }) {
  const [query, setQuery] = useState("");
  const id = useId();
  const results = useMemo(() => searchCourses(courses, query, 20), [courses, query]);

  return (
    <div className="mx-auto max-w-3xl px-4 py-6">
      <h1 className="font-display text-2xl font-bold sm:text-3xl">Course reviews</h1>
      <p className="mt-1 text-muted">Anonymous reviews from Western students. Find a course to read or write one.</p>

      <label htmlFor={id} className="mt-5 block text-sm font-semibold">Search courses</label>
      <input
        id={id}
        autoFocus
        placeholder="e.g. CS 2210B, calculus, data structures"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        className="mt-1 w-full rounded-lg border border-line px-3 py-2.5"
      />

      {query.trim().length >= 2 ? (
        results.length === 0 ? (
          <p className="mt-4 text-sm text-muted">No course matches "{query.trim()}".</p>
        ) : (
          <ul className="mt-4 divide-y divide-line rounded-2xl border border-line bg-white">
            {results.map((c) => (
              <li key={c.code}>
                <a href={courseHref(c.code)} className="flex items-baseline justify-between gap-3 px-4 py-3 hover:bg-brand-50">
                  <span>
                    <b>{c.code}</b> <span className="text-sm text-muted">{String(c.title ?? "")}</span>
                  </span>
                  <span className="shrink-0 text-xs text-muted">{termTag(c.term)}</span>
                </a>
              </li>
            ))}
          </ul>
        )
      ) : myCodes.length > 0 ? (
        <section className="mt-6">
          <h2 className="font-display text-lg font-semibold">Your courses</h2>
          <ul className="mt-2 flex flex-wrap gap-2">
            {myCodes.map((code) => (
              <li key={code}>
                <a href={courseHref(code)} className="inline-block rounded-lg border border-line bg-white px-3 py-1.5 text-sm font-semibold hover:border-brand-200 hover:text-brand-700">
                  {code}
                </a>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}
