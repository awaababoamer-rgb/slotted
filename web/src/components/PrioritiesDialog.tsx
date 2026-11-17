import { useEffect, useId, useRef, useState } from "react";
import { LIGHT_DAY_MAX_HOURS, type Day, type Preferences } from "@slotted/engine";
import { DAY_LONG, formatTime } from "../lib/format";

/** The lunch window from the design: at least one free hour between 11:30 AM and 1:30 PM. */
export const LUNCH_WINDOW = { start: "11:30", end: "13:30", minutes: 60 };

interface Props {
  open: boolean;
  prefs: Preferences;
  onSave: (prefs: Preferences) => void;
  onClose: () => void;
}

function Segmented<T extends string>({
  label, options, value, onChange,
}: { label: string; options: { value: T; label: string }[]; value: T; onChange: (v: T) => void }) {
  const name = useId();
  return (
    <fieldset>
      <legend className="text-sm font-semibold">{label}</legend>
      <div className="mt-2 grid grid-flow-col auto-cols-fr rounded-xl bg-page p-1">
        {options.map((o) => (
          <label
            key={o.value}
            className={`cursor-pointer rounded-lg px-2 py-2 text-center text-sm transition has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-brand-600 ${
              value === o.value ? "bg-white font-semibold text-brand-700 shadow-sm" : "text-muted hover:text-ink"
            }`}
          >
            <input
              type="radio"
              name={name}
              value={o.value}
              checked={value === o.value}
              onChange={() => onChange(o.value)}
              className="sr-only"
            />
            {o.label}
          </label>
        ))}
      </div>
    </fieldset>
  );
}

// Slider steps: 8:30 (any time) up to 12:30, every 30 minutes.
const SLIDER_TIMES = ["08:30", "09:00", "09:30", "10:00", "10:30", "11:00", "11:30", "12:00", "12:30"];

function EarliestSlider({ value, onChange }: { value: string | undefined; onChange: (v: string | undefined) => void }) {
  const id = useId();
  const index = Math.max(0, SLIDER_TIMES.indexOf(value ?? "08:30"));
  const text = index === 0 ? "Any time" : `No classes before ${formatTime(SLIDER_TIMES[index])}`;
  return (
    <div>
      <div className="flex items-baseline justify-between">
        <label htmlFor={id} className="text-sm font-semibold">Earliest class I'll take</label>
        <span className="text-sm font-semibold text-brand-700" aria-hidden>{text}</span>
      </div>
      <input
        id={id}
        type="range"
        min={0}
        max={SLIDER_TIMES.length - 1}
        step={1}
        value={index}
        aria-valuetext={text}
        onChange={(e) => {
          const i = Number(e.target.value);
          onChange(i === 0 ? undefined : SLIDER_TIMES[i]);
        }}
        className="mt-3 w-full accent-brand-700"
      />
      <div className="mt-1 flex justify-between text-[11px] text-muted" aria-hidden>
        <span>Any time</span>
        <span>10:30 AM</span>
        <span>12:30 PM</span>
      </div>
    </div>
  );
}

function Toggle({
  title, description, checked, onChange,
}: { title: string; description: string; checked: boolean; onChange: (v: boolean) => void }) {
  const id = useId();
  return (
    <div className="flex items-center justify-between gap-4 border-b border-line py-3 last:border-b-0">
      <div>
        <div id={`${id}-t`} className="text-sm font-semibold">{title}</div>
        <div id={`${id}-d`} className="text-xs text-muted">{description}</div>
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        aria-label={title}
        aria-describedby={`${id}-d`}
        onClick={() => onChange(!checked)}
        className={`relative h-6 w-11 shrink-0 rounded-full transition ${checked ? "bg-brand-700" : "bg-[#cfccda]"}`}
      >
        <span
          className={`absolute top-0.5 left-0.5 size-5 rounded-full bg-white shadow transition-transform motion-reduce:transition-none ${
            checked ? "translate-x-5" : ""
          }`}
        />
      </button>
    </div>
  );
}

/** "What should fixes protect?" — the preferences that rank fixes and other weeks. */
export function PrioritiesDialog({ open, prefs, onSave, onClose }: Props) {
  const [draft, setDraft] = useState<Preferences>(prefs);
  const dialogRef = useRef<HTMLDialogElement>(null);
  const titleId = useId();

  // Start from the saved settings each time it opens.
  useEffect(() => {
    if (open) setDraft(prefs);
  }, [open, prefs]);

  // Use the browser's built-in <dialog>: it traps focus, blocks the page behind, and closes on Esc.
  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);

  // Esc: the browser fires "cancel" first. We handle it ourselves (so the app's
  // state always knows the dialog closed) instead of letting the browser close it.
  // "close" is kept as a backup in case the dialog is closed some other way.
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    const onCancel = (e: Event) => {
      e.preventDefault();
      onCloseRef.current();
    };
    const onClosed = () => onCloseRef.current();
    dialog.addEventListener("cancel", onCancel);
    dialog.addEventListener("close", onClosed);
    return () => {
      dialog.removeEventListener("cancel", onCancel);
      dialog.removeEventListener("close", onClosed);
    };
  }, []);

  const set = (patch: Partial<Preferences>) => setDraft((d) => ({ ...d, ...patch }));
  const lightDay = (draft.lightDay ?? "none") as "none" | Day;

  return (
    <dialog
      ref={dialogRef}
      aria-labelledby={titleId}
      onClick={(e) => {
        if (e.target === dialogRef.current) onClose(); // click on the dark backdrop
      }}
      className="m-0 h-full max-h-none w-full max-w-none bg-white p-0 text-ink backdrop:bg-ink/40 sm:m-auto sm:h-auto sm:max-h-[90vh] sm:max-w-lg sm:rounded-2xl sm:shadow-xl"
    >
      <form
        method="dialog"
        className="flex h-full flex-col"
        onSubmit={(e) => {
          e.preventDefault();
          onSave(draft);
        }}
      >
        <div className="border-b border-line px-6 pt-6 pb-4">
          <h2 id={titleId} className="font-display text-2xl font-bold">What should fixes protect?</h2>
          <p className="mt-1 text-sm text-muted">
            Smart Resolve ranks fixes by these. Sections you lock in My courses are never moved, no matter what.
          </p>
        </div>

        <div className="flex-1 space-y-5 overflow-y-auto px-6 py-5">
          <EarliestSlider value={draft.earliestStart} onChange={(v) => set({ earliestStart: v })} />
          <Segmented
            label="Keep one day light"
            value={lightDay}
            onChange={(v) => set({ lightDay: v === "none" ? undefined : v })}
            options={[
              { value: "none", label: "None" },
              { value: "Mon", label: "Mon" },
              { value: "Tue", label: "Tue" },
              { value: "Wed", label: "Wed" },
              { value: "Thu", label: "Thu" },
              { value: "Fri", label: "Fri" },
            ]}
          />
          {draft.lightDay && (
            <p className="-mt-3 text-xs text-muted">
              Fixes and weeks with at most {LIGHT_DAY_MAX_HOURS} hours of class on {DAY_LONG[draft.lightDay]} rank higher.
            </p>
          )}

          <fieldset>
            <legend className="text-sm font-semibold">Ranking rules</legend>
            <div className="mt-1">
              <Toggle
                title="Minimize downtime between classes"
                description="Prefer weeks with fewer empty hours on campus."
                checked={!!draft.minimizeGaps}
                onChange={(v) => set({ minimizeGaps: v })}
              />
              <Toggle
                title="Only move labs and tutorials"
                description="Lecture sections stay as you picked them."
                checked={!!draft.onlyMoveLabsAndTutorials}
                onChange={(v) => set({ onlyMoveLabsAndTutorials: v })}
              />
              <Toggle
                title="Protect a lunch hour"
                description="Keep at least one free hour between 11:30 AM and 1:30 PM."
                checked={!!draft.lunchHour}
                onChange={(v) => set({ lunchHour: v ? LUNCH_WINDOW : undefined })}
              />
              <Toggle
                title="Labs on the same day as lecture"
                description="Fewer trips to campus for one class."
                checked={!!draft.labsSameDayAsLecture}
                onChange={(v) => set({ labsSameDayAsLecture: v })}
              />
            </div>
          </fieldset>
        </div>

        <div className="flex justify-end gap-2 border-t border-line px-6 py-4">
          <button type="button" onClick={onClose} className="rounded-lg border border-line px-4 py-2.5 text-sm font-semibold hover:border-brand-200">
            Cancel
          </button>
          <button type="submit" className="rounded-lg bg-brand-700 px-4 py-2.5 text-sm font-semibold text-white hover:bg-brand-800">
            Save and re-rank fixes
          </button>
        </div>
      </form>
    </dialog>
  );
}
