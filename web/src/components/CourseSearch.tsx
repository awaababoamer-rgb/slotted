import { useId, useMemo, useState } from "react";
import type { Course } from "@slotted/engine";
import { termTag } from "../lib/format";
import { searchCourses } from "../lib/search";
import { courseHasTimes } from "../state/useSchedule";

interface Props {
  courses: Course[];
  addedCodes: Set<string>;
  onAdd: (code: string) => void;
}

/** "Add a course" box with suggestions as you type. Keyboard: ↑ ↓ Enter Esc. */
export function CourseSearch({ courses, addedCodes, onAdd }: Props) {
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const [message, setMessage] = useState<string | null>(null);
  const listId = useId();

  const results = useMemo(() => searchCourses(courses, query), [courses, query]);

  function add(course: Course | undefined) {
    if (!course) {
      setMessage(query.trim() ? `No course matches "${query.trim()}".` : null);
      return;
    }
    if (addedCodes.has(course.code)) {
      setMessage(`${course.code} is already in your courses.`);
      return;
    }
    onAdd(course.code);
    setMessage(
      courseHasTimes(course)
        ? null
        : `${course.code} added. Times not available yet, so it can't go on the grid.`,
    );
    setQuery("");
    setOpen(false);
    setActive(0);
  }

  return (
    <section className="rounded-2xl border border-line bg-white p-4 shadow-sm">
      <label htmlFor={`${listId}-input`} className="text-sm font-semibold">Add a course</label>
      <form
        className="relative mt-2 flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          add(results[active] ?? results[0]);
        }}
      >
        <input
          id={`${listId}-input`}
          role="combobox"
          aria-expanded={open && results.length > 0}
          aria-controls={listId}
          aria-autocomplete="list"
          autoComplete="off"
          placeholder="e.g. CS 2210B"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setOpen(true);
            setActive(0);
            setMessage(null);
          }}
          onFocus={() => setOpen(true)}
          onBlur={() => setTimeout(() => setOpen(false), 150)}
          onKeyDown={(e) => {
            if (e.key === "ArrowDown") { e.preventDefault(); setActive((a) => Math.min(a + 1, results.length - 1)); }
            if (e.key === "ArrowUp") { e.preventDefault(); setActive((a) => Math.max(a - 1, 0)); }
            if (e.key === "Escape") setOpen(false);
          }}
          className="min-w-0 flex-1 rounded-lg border border-line px-3 py-2.5 text-sm placeholder:text-muted/70 focus:border-brand-600"
        />
        <button type="submit" className="rounded-lg bg-brand-700 px-4 text-sm font-semibold text-white hover:bg-brand-800">
          Add
        </button>

        {open && results.length > 0 && (
          <ul
            id={listId}
            role="listbox"
            className="absolute top-full right-0 left-0 z-20 mt-1 max-h-80 overflow-auto rounded-xl border border-line bg-white py-1 shadow-lg"
          >
            {results.map((course, i) => {
              const hasTimes = courseHasTimes(course);
              const added = addedCodes.has(course.code);
              return (
                <li
                  key={course.code}
                  role="option"
                  aria-selected={i === active}
                  onMouseDown={(e) => { e.preventDefault(); add(course); }}
                  onMouseEnter={() => setActive(i)}
                  className={`cursor-pointer px-3 py-2 ${i === active ? "bg-brand-50" : ""}`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-sm font-semibold">{course.code}</span>
                    <span className="shrink-0 text-xs text-muted">{termTag(course.term)}</span>
                  </div>
                  <div className="truncate text-xs text-muted">{String(course.title ?? "")}</div>
                  {!hasTimes && <div className="mt-0.5 text-xs font-medium text-conflict-700">Times not available yet</div>}
                  {added && <div className="mt-0.5 text-xs font-medium text-brand-700">Already added</div>}
                </li>
              );
            })}
          </ul>
        )}
      </form>
      {message && <p role="status" className="mt-2 text-xs text-muted">{message}</p>}
    </section>
  );
}
