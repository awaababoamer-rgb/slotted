import { useEffect, useId, useState } from "react";
import type { Course } from "@slotted/engine";
import {
  addRequirement, createProgram, deleteProgram, deleteRequirement, listPrograms, updateProgram, updateRequirement,
  type Program, type ProgramInput, type Requirement,
} from "../data/programs";
import { CoursePicker } from "./CoursePicker";

const input = "mt-1 block w-full rounded-lg border border-line px-3 py-1.5 text-sm";

function RequirementEditor({ req, courses, onChange }: { req: Requirement; courses: Course[]; onChange: () => Promise<void> }) {
  const [error, setError] = useState<string | null>(null);
  const save = async (patch: Partial<Requirement>) => {
    try {
      await updateRequirement(req.id, patch);
      await onChange();
    } catch (e) {
      setError((e as Error).message);
    }
  };

  return (
    <li className="rounded-xl border border-line p-3">
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${req.kind === "required" ? "bg-brand-100 text-brand-700" : "bg-[#fdf3d6] text-[#7a5300]"}`}>
          {req.kind === "required" ? "Required" : `Choose ${req.choose_count}`}
        </span>
        <input aria-label="Group title" defaultValue={req.title} placeholder={req.kind === "required" ? "e.g. Core courses" : "e.g. One statistics course"}
          onBlur={(e) => e.target.value !== req.title && void save({ title: e.target.value })}
          className="min-w-0 flex-1 rounded-lg border border-line px-2 py-1" />
        {req.kind === "choose" && (
          <label className="flex items-center gap-1 text-xs">
            pick
            <input type="number" min={1} max={10} defaultValue={req.choose_count}
              onBlur={(e) => Number(e.target.value) !== req.choose_count && void save({ choose_count: Number(e.target.value) })}
              className="w-14 rounded-lg border border-line px-2 py-1" />
          </label>
        )}
        <button type="button" onClick={() => window.confirm("Delete this group?") && void deleteRequirement(req.id).then(onChange)}
          className="text-xs font-semibold text-conflict-700 hover:underline">Delete group</button>
      </div>
      <ul className="mt-2 flex flex-wrap gap-1.5">
        {req.course_codes.map((code) => (
          <li key={code} className="flex items-center gap-1 rounded-full bg-page px-2.5 py-0.5 text-xs font-semibold">
            {code}
            <button type="button" aria-label={`Remove ${code}`} onClick={() => void save({ course_codes: req.course_codes.filter((c) => c !== code) })}
              className="text-muted hover:text-conflict-700">×</button>
          </li>
        ))}
        {req.course_codes.length === 0 && <li className="text-xs text-muted">No courses yet.</li>}
      </ul>
      <div className="mt-2">
        <CoursePicker courses={courses} exclude={req.course_codes} onPick={(code) => void save({ course_codes: [...req.course_codes, code] })} />
      </div>
      {error && <p role="alert" className="mt-1 text-xs text-conflict-700">{error}</p>}
    </li>
  );
}

function ProgramCard({ program, courses, onChange }: { program: Program; courses: Course[]; onChange: () => Promise<void> }) {
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function run(work: () => Promise<unknown>) {
    setError(null);
    try {
      await work();
      await onChange();
    } catch (e) {
      setError((e as Error).message);
    }
  }

  const nextOrder = program.requirements.length;
  return (
    <li className="rounded-xl border border-line bg-white p-4">
      <div className="flex flex-wrap items-center gap-2">
        <button type="button" onClick={() => setOpen((o) => !o)} aria-expanded={open} className="min-w-0 flex-1 text-left">
          <span className="font-semibold">{program.short_name || program.name}</span>{" "}
          <span className="text-sm text-muted">· Year {program.year} · {program.requirements.length} groups</span>
        </button>
        <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${program.published ? "bg-good-50 text-good-700" : "bg-page text-muted"}`}>
          {program.published ? "Published" : "Draft"}
        </span>
        <button type="button" onClick={() => void run(() => updateProgram(program.id, { published: !program.published }))}
          className="text-xs font-semibold text-brand-700 hover:underline">
          {program.published ? "Unpublish" : "Publish"}
        </button>
        <button type="button" onClick={() => window.confirm(`Delete "${program.name}" (Year ${program.year})?`) && void run(() => deleteProgram(program.id))}
          className="text-xs font-semibold text-conflict-700 hover:underline">Delete</button>
      </div>
      {open && (
        <div className="mt-3 space-y-3">
          <div className="grid gap-2 sm:grid-cols-2">
            <label className="text-xs font-semibold">Full name
              <input defaultValue={program.name} onBlur={(e) => e.target.value !== program.name && void run(() => updateProgram(program.id, { name: e.target.value }))} className={input} />
            </label>
            <label className="text-xs font-semibold">Calendar link
              <input defaultValue={program.calendar_url} placeholder="https://www.westerncalendar.uwo.ca/..." onBlur={(e) => e.target.value !== program.calendar_url && void run(() => updateProgram(program.id, { calendar_url: e.target.value.trim() }))} className={input} />
            </label>
            <label className="text-xs font-semibold sm:col-span-2">Description
              <input defaultValue={program.description} onBlur={(e) => e.target.value !== program.description && void run(() => updateProgram(program.id, { description: e.target.value }))} className={input} />
            </label>
          </div>
          <ul className="space-y-2">
            {program.requirements.map((r) => <RequirementEditor key={r.id} req={r} courses={courses} onChange={onChange} />)}
          </ul>
          <div className="flex flex-wrap gap-2">
            <button type="button" onClick={() => void run(() => addRequirement(program.id, { kind: "required", title: "", choose_count: 1, course_codes: [], sort_order: nextOrder }))}
              className="rounded-lg border border-line px-3 py-1.5 text-sm font-semibold hover:border-brand-200">+ Required courses</button>
            <button type="button" onClick={() => void run(() => addRequirement(program.id, { kind: "choose", title: "", choose_count: 1, course_codes: [], sort_order: nextOrder }))}
              className="rounded-lg border border-line px-3 py-1.5 text-sm font-semibold hover:border-brand-200">+ "Choose from" group</button>
          </div>
        </div>
      )}
      {error && <p role="alert" className="mt-2 text-sm text-conflict-700">{error}</p>}
    </li>
  );
}

/** Admin page section: enter programs by hand from the Academic Calendar. */
export function ProgramsAdmin({ courses }: { courses: Course[] }) {
  const [programs, setPrograms] = useState<Program[] | null>(null);
  const [draft, setDraft] = useState<ProgramInput>({ name: "", short_name: "", year: 2, description: "", calendar_url: "", published: false });
  const [error, setError] = useState<string | null>(null);
  const id = useId();

  const refresh = async () => {
    try {
      setPrograms(await listPrograms());
    } catch (e) {
      setError((e as Error).message);
    }
  };
  useEffect(() => void refresh(), []);

  async function create(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      await createProgram({ ...draft, name: draft.name.trim(), short_name: draft.short_name.trim() });
      setDraft({ ...draft, name: "", short_name: "", description: "", calendar_url: "" });
      await refresh();
    } catch (err) {
      setError((err as Error).message);
    }
  }

  return (
    <section className="mt-8 rounded-2xl border border-line bg-white p-5 shadow-sm">
      <h2 className="font-display text-lg font-semibold">Programs</h2>
      <p className="mt-1 text-sm text-muted">
        Enter programs by hand from Western's Academic Calendar (we don't scrape it). Students only see <b>published</b> programs.
        Always add the calendar link so students can check the official wording.
      </p>

      <ul className="mt-3 space-y-2">
        {programs === null ? <li className="text-sm text-muted" role="status">Loading…</li>
          : programs.length === 0 ? <li className="text-sm text-muted">No programs yet.</li>
          : programs.map((p) => <ProgramCard key={p.id} program={p} courses={courses} onChange={refresh} />)}
      </ul>

      <form onSubmit={create} className="mt-4 grid gap-2 rounded-xl bg-page p-3 sm:grid-cols-[2fr_1fr_6rem_auto] sm:items-end">
        <label htmlFor={`${id}-name`} className="text-xs font-semibold">Full program name
          <input id={`${id}-name`} required placeholder="Honours Specialization in Computer Science" value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} className={input} />
        </label>
        <label htmlFor={`${id}-short`} className="text-xs font-semibold">Short name
          <input id={`${id}-short`} placeholder="Computer Science" value={draft.short_name} onChange={(e) => setDraft({ ...draft, short_name: e.target.value })} className={input} />
        </label>
        <label htmlFor={`${id}-year`} className="text-xs font-semibold">Year
          <select id={`${id}-year`} value={draft.year} onChange={(e) => setDraft({ ...draft, year: Number(e.target.value) })} className={input}>
            {[1, 2, 3, 4].map((y) => <option key={y} value={y}>Year {y}</option>)}
          </select>
        </label>
        <button type="submit" className="rounded-lg bg-brand-700 px-4 py-1.5 text-sm font-semibold text-white hover:bg-brand-800">Add program</button>
      </form>
      {error && <p role="alert" className="mt-2 text-sm text-conflict-700">{error}</p>}
    </section>
  );
}
