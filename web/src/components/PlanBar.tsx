import { useCallback, useEffect, useId, useState } from "react";
import { deletePlan, listPlans, loadPlan, savePlan, type SavedPlanSummary } from "../data/schedules";
import { DEFAULT_PREFS, type ScheduleApi, type ScheduleState } from "../state/useSchedule";

interface CurrentPlan {
  id: string;
  name: string;
  /** What was last saved, to show "Unsaved changes". */
  savedJson: string;
}

const snapshot = (s: ScheduleState) => JSON.stringify({ c: s.choices, l: s.locked, p: s.prefs });

/**
 * Save the schedule as named plans ("Plan A", "Plan B") in your account,
 * and open them again on any device.
 */
export function PlanBar({ schedule, userId }: { schedule: ScheduleApi; userId: string }) {
  const currentKey = `slotted:currentPlan:v1:${userId}`;
  const [plans, setPlans] = useState<SavedPlanSummary[] | null>(null);
  const [current, setCurrent] = useState<CurrentPlan | null>(() => {
    try {
      const raw = localStorage.getItem(currentKey);
      return raw ? (JSON.parse(raw) as CurrentPlan) : null;
    } catch {
      return null;
    }
  });
  const [naming, setNaming] = useState(false);
  const [newName, setNewName] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ tone: "ok" | "error"; text: string } | null>(null);
  const selectId = useId();
  const nameId = useId();

  const refresh = useCallback(async () => {
    try {
      setPlans(await listPlans());
    } catch (e) {
      setMessage({ tone: "error", text: (e as Error).message });
    }
  }, []);
  useEffect(() => void refresh(), [refresh]);

  useEffect(() => {
    try {
      if (current) localStorage.setItem(currentKey, JSON.stringify(current));
      else localStorage.removeItem(currentKey);
    } catch {
      // Ignore.
    }
  }, [current, currentKey]);

  // If the open plan was deleted on another device, forget it.
  useEffect(() => {
    if (plans && current && !plans.some((p) => p.id === current.id)) setCurrent(null);
  }, [plans, current]);

  const dirty = current ? snapshot(schedule.state) !== current.savedJson : schedule.state.choices.length > 0;

  function flash(tone: "ok" | "error", text: string) {
    setMessage({ tone, text });
    if (tone === "ok") setTimeout(() => setMessage(null), 3000);
  }

  async function run(work: () => Promise<void>) {
    setBusy(true);
    setMessage(null);
    try {
      await work();
    } catch (e) {
      flash("error", (e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const save = () =>
    run(async () => {
      if (!current) return;
      const saved = await savePlan({ id: current.id, name: current.name }, schedule.state);
      setCurrent({ ...saved, savedJson: snapshot(schedule.state) });
      await refresh();
      flash("ok", `Saved “${saved.name}”.`);
    });

  const saveAsNew = () =>
    run(async () => {
      const name = newName.trim();
      if (!name) throw new Error("Give the plan a name, like “Plan A”.");
      const saved = await savePlan({ name }, schedule.state);
      setCurrent({ ...saved, savedJson: snapshot(schedule.state) });
      setNaming(false);
      setNewName("");
      await refresh();
      flash("ok", `Saved “${saved.name}”.`);
    });

  const open = (id: string) =>
    run(async () => {
      if (dirty && !window.confirm("You have unsaved changes. Open the other plan anyway?")) return;
      const plan = await loadPlan(id);
      schedule.replaceState(plan.state);
      setCurrent({ id: plan.id, name: plan.name, savedJson: snapshot({ ...plan.state, prefs: { ...DEFAULT_PREFS, ...plan.state.prefs } }) });
      flash("ok", `Opened “${plan.name}”.`);
    });

  const remove = () =>
    run(async () => {
      if (!current) return;
      if (!window.confirm(`Delete “${current.name}” from your account? This can't be undone.`)) return;
      await deletePlan(current.id);
      flash("ok", `Deleted “${current.name}”. Your courses are still on screen.`);
      setCurrent(null);
      await refresh();
    });

  return (
    <div className="border-b border-line bg-white/70">
      <div className="mx-auto flex max-w-[1400px] flex-wrap items-center gap-x-3 gap-y-2 px-4 py-2 text-sm">
        <label htmlFor={selectId} className="font-semibold">Plan</label>
        <select
          id={selectId}
          value={current?.id ?? ""}
          disabled={busy || plans === null}
          onChange={(e) => e.target.value && void open(e.target.value)}
          className="max-w-[12rem] rounded-lg border border-line bg-white px-2 py-1.5"
        >
          <option value="">{current ? "—" : "Unsaved schedule"}</option>
          {(plans ?? []).map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
        </select>
        <span className={`text-xs ${dirty ? "text-conflict-700" : "text-muted"}`} aria-live="polite">
          {current ? (dirty ? "Unsaved changes" : "All changes saved") : plans && plans.length === 0 ? "No saved plans yet" : ""}
        </span>

        <div className="ml-auto flex flex-wrap items-center gap-2">
          {current && (
            <button type="button" onClick={() => void save()} disabled={busy || !dirty}
              className="rounded-lg bg-brand-700 px-3 py-1.5 font-semibold text-white hover:bg-brand-800 disabled:opacity-50">
              Save
            </button>
          )}
          {naming ? (
            <form className="flex items-center gap-1.5" onSubmit={(e) => { e.preventDefault(); void saveAsNew(); }}>
              <label htmlFor={nameId} className="sr-only">New plan name</label>
              <input id={nameId} autoFocus maxLength={60} placeholder="Plan A" value={newName}
                onChange={(e) => setNewName(e.target.value)}
                className="w-32 rounded-lg border border-line px-2 py-1.5" />
              <button type="submit" disabled={busy} className="rounded-lg bg-brand-700 px-3 py-1.5 font-semibold text-white disabled:opacity-50">Save</button>
              <button type="button" onClick={() => setNaming(false)} className="px-2 py-1.5 text-muted">Cancel</button>
            </form>
          ) : (
            <button type="button" onClick={() => { setNaming(true); setNewName(""); }} disabled={busy}
              className={`rounded-lg px-3 py-1.5 font-semibold ${current ? "border border-line hover:border-brand-200" : "bg-brand-700 text-white hover:bg-brand-800"}`}>
              {current ? "Save as new…" : "Save plan…"}
            </button>
          )}
          {current && (
            <button type="button" onClick={() => void remove()} disabled={busy} className="px-2 py-1.5 text-muted hover:text-conflict-700">
              Delete
            </button>
          )}
        </div>
        {message && (
          <p role={message.tone === "error" ? "alert" : "status"}
            className={`w-full text-xs ${message.tone === "error" ? "text-conflict-700" : "text-good-700"}`}>
            {message.text}
          </p>
        )}
      </div>
    </div>
  );
}
