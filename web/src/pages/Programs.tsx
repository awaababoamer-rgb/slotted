import { useEffect, useMemo, useState } from "react";
import type { Course } from "@slotted/engine";
import { listPrograms, type Program, type Requirement } from "../data/programs";
import { termTag } from "../lib/format";
import { entryLabel, entryVariants, resolveEntry } from "../lib/programEntry";
import { courseHasTimes, type ScheduleApi } from "../state/useSchedule";
import { courseHref } from "./Reviews";

function CourseStatus({ course, added }: { course: Course | undefined; added: boolean }) {
  if (!course) return <span className="text-xs text-muted">Not offered this year</span>;
  if (added) return <span className="text-xs font-semibold text-good-700">✓ In your courses</span>;
  if (!courseHasTimes(course)) return <span className="text-xs text-conflict-700">Times not available yet</span>;
  return <span className="text-xs text-muted">{termTag(course.term)}</span>;
}

function ProgramCard({ program, onPick }: { program: Program; onPick: () => void }) {
  const codes = program.requirements.flatMap((r) => r.course_codes);
  return (
    <button type="button" onClick={onPick}
      className="flex flex-col rounded-2xl border border-line bg-white p-5 text-left shadow-sm transition hover:border-brand-600 hover:ring-2 hover:ring-brand-200">
      <span className="text-xs font-semibold text-brand-700">Year {program.year}</span>
      <span className="mt-1 font-display text-xl font-semibold">{program.short_name || program.name}</span>
      {program.short_name && <span className="text-sm text-muted">{program.name}</span>}
      {program.description && <span className="mt-2 text-sm">{program.description}</span>}
      <span className="mt-3 flex flex-wrap gap-1.5">
        {codes.slice(0, 6).map((c) => (
          <span key={c} className="rounded-md bg-page px-2 py-0.5 text-[11px] font-semibold">{entryLabel(c).replace(/^COMPSCI /, "CS ")}</span>
        ))}
        {codes.length > 6 && <span className="text-[11px] text-muted">+{codes.length - 6} more</span>}
      </span>
    </button>
  );
}

/** Optional: pick your program and year, then add its courses to your week. */
export function Programs({ courses, schedule, userId }: { courses: Course[]; schedule: ScheduleApi; userId: string }) {
  const storageKey = `slotted:program:v1:${userId}`;
  const [programs, setPrograms] = useState<Program[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [programId, setProgramId] = useState<string | null>(() => {
    try { return localStorage.getItem(storageKey); } catch { return null; }
  });
  const [chosen, setChosen] = useState<Record<string, string[]>>({}); // requirement id -> picked codes
  // Required courses start ticked; a student can untick the ones they aren't taking this year.
  const [skipped, setSkipped] = useState<Set<string>>(new Set()); // "requirement id|entry"
  const [added, setAdded] = useState<string[] | null>(null);

  useEffect(() => {
    listPrograms().then(setPrograms).catch((e: Error) => setError(e.message));
  }, []);
  useEffect(() => {
    try {
      if (programId) localStorage.setItem(storageKey, programId);
      else localStorage.removeItem(storageKey);
    } catch {
      // Remembering the program is only a convenience.
    }
  }, [programId, storageKey]);

  const byCode = useMemo(() => new Map(courses.map((c) => [c.code, c])), [courses]);
  const mine = useMemo(() => new Set(schedule.state.choices.map((c) => c.code)), [schedule.state.choices]);
  const program = programs?.find((p) => p.id === programId) ?? null;

  // Each entry may list alternatives (2208A or 2208B): pick the one that fits your week.
  const resolved = useMemo(() => {
    const map = new Map<string, Course | undefined>();
    for (const req of program?.requirements ?? []) {
      for (const entry of req.course_codes) {
        if (!map.has(entry)) map.set(entry, resolveEntry(entry, byCode, mine, schedule.picks, schedule.state.prefs));
      }
    }
    return map;
  }, [program, byCode, mine, schedule.picks, schedule.state.prefs]);

  function toggleChoice(req: Requirement, code: string) {
    setChosen((prev) => {
      const current = prev[req.id] ?? [];
      if (current.includes(code)) return { ...prev, [req.id]: current.filter((c) => c !== code) };
      // Keep at most choose_count; picking another replaces the oldest pick.
      const next = [...current, code].slice(-req.choose_count);
      return { ...prev, [req.id]: next };
    });
  }

  function toggleRequired(req: Requirement, code: string) {
    const key = `${req.id}|${code}`;
    setSkipped((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  const toAdd = program
    ? [...new Set([
        ...program.requirements.filter((r) => r.kind === "required")
          .flatMap((r) => r.course_codes.filter((code) => !skipped.has(`${r.id}|${code}`))),
        ...program.requirements.filter((r) => r.kind === "choose").flatMap((r) => chosen[r.id] ?? []),
      ])]
        .filter((entry) => !entryVariants(entry).some((c) => mine.has(c)))
        .map((entry) => resolved.get(entry)?.code)
        .filter((code): code is string => !!code)
    : [];

  function addAll() {
    for (const code of toAdd) schedule.addCourse(code);
    setAdded(toAdd);
  }

  // ---- Step 1: pick a program ----
  if (!program) {
    return (
      <div className="mx-auto max-w-5xl px-4 py-6">
        <h1 className="font-display text-2xl font-bold sm:text-3xl">Pick a program</h1>
        <p className="mt-1 text-muted">
          Optional. Choose your program and year to add its courses in one go, or{" "}
          <a href="#builder" className="font-semibold text-brand-700 hover:underline">skip and add courses yourself</a>.
        </p>
        {error && <p role="alert" className="mt-4 rounded-xl bg-conflict-50 px-4 py-3 text-sm text-conflict-700">{error}</p>}
        {programs === null ? (
          <p className="mt-6 text-sm text-muted" role="status">Loading programs…</p>
        ) : programs.length === 0 ? (
          <p className="mt-6 text-sm text-muted">No programs have been added yet. Use the Builder to add courses yourself.</p>
        ) : (
          <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {programs.map((p) => <ProgramCard key={p.id} program={p} onPick={() => { setProgramId(p.id); setChosen({}); setSkipped(new Set()); setAdded(null); }} />)}
          </div>
        )}
        <p className="mt-6 text-xs text-muted">
          Programs are entered by the Slotted team from Western's Academic Calendar. Always confirm with the calendar or an academic counsellor.
        </p>
      </div>
    );
  }

  // ---- Step 2: required courses + choices ----
  return (
    <div className="mx-auto max-w-3xl px-4 py-6">
      <button type="button" onClick={() => setProgramId(null)} className="text-sm font-semibold text-brand-700 hover:underline">
        ← Choose a different program
      </button>
      <h1 className="mt-2 font-display text-2xl font-bold sm:text-3xl">{program.short_name || program.name}</h1>
      <p className="text-muted">
        {program.name} · Year {program.year}
        {program.calendar_url && (
          <> · <a href={program.calendar_url} target="_blank" rel="noreferrer" className="font-semibold text-brand-700 hover:underline">Academic Calendar ↗</a></>
        )}
      </p>

      <p className="mt-3 text-sm text-muted">
        Tick the courses you're taking this year, then press <b className="text-ink">Add to my week</b>. Required courses start ticked; untick any you're taking later.
      </p>

      <div className="mt-4 space-y-4">
        {program.requirements.map((req) => (
          <section key={req.id} className="rounded-2xl border border-line bg-white p-4 shadow-sm">
            <h2 className="font-display font-semibold">
              {req.title || (req.kind === "required" ? "Required" : "Choose")}{" "}
              <span className={`ml-1 rounded-full px-2 py-0.5 align-middle text-[11px] font-semibold ${req.kind === "required" ? "bg-brand-100 text-brand-700" : "bg-[#fdf3d6] text-[#7a5300]"}`}>
                {req.kind === "required" ? "Required" : `Choose ${req.choose_count}`}
              </span>
            </h2>
            <ul className="mt-2 divide-y divide-line">
              {req.course_codes.map((code) => {
                const course = resolved.get(code);
                const isMine = entryVariants(code).some((c) => mine.has(c));
                const picked = req.kind === "required"
                  ? !skipped.has(`${req.id}|${code}`)
                  : (chosen[req.id] ?? []).includes(code);
                const label = entryLabel(code);
                return (
                  <li key={code} className="flex items-center gap-3 py-2">
                    <input type="checkbox" checked={isMine || (picked && !!course)} disabled={isMine || !course}
                      onChange={() => (req.kind === "required" ? toggleRequired(req, code) : toggleChoice(req, code))}
                      aria-label={`Add ${label}`} className="size-4 accent-brand-700" />
                    <div className="min-w-0 flex-1">
                      <a href={courseHref(course?.code ?? entryVariants(code)[0])} className="text-sm font-semibold hover:text-brand-700 hover:underline">{label}</a>
                      <p className="truncate text-xs text-muted">{String(course?.title ?? "")}</p>
                    </div>
                    <CourseStatus course={course} added={isMine} />
                  </li>
                );
              })}
            </ul>
          </section>
        ))}
      </div>

      <div className="sticky bottom-0 mt-5 rounded-2xl border border-line bg-white/95 p-4 shadow-lg backdrop-blur">
        {added ? (
          <p className="text-sm" role="status">
            Added {added.length} course{added.length === 1 ? "" : "s"}.{" "}
            <a href="#builder" className="font-semibold text-brand-700 hover:underline">See your week →</a>{" "}
            Smart Resolve will help if anything clashes.
          </p>
        ) : (
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-sm text-muted">
              {toAdd.length === 0 ? "Everything you've chosen is already in your courses." : `${toAdd.length} course${toAdd.length === 1 ? "" : "s"} to add.`}
            </p>
            <div className="flex gap-2">
              <a href="#builder" className="rounded-lg border border-line px-4 py-2 text-sm font-semibold">Skip</a>
              <button type="button" disabled={toAdd.length === 0} onClick={addAll}
                className="rounded-lg bg-brand-700 px-4 py-2 text-sm font-semibold text-white hover:bg-brand-800 disabled:opacity-50">
                Add to my week
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
