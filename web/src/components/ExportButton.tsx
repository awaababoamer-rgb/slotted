import { useState } from "react";
import type { Pick } from "@slotted/engine";
import { plural, sectionLabel } from "../lib/format";
import { CopyIcon } from "./icons";

async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    // Older browsers / blocked clipboard: fall back to a hidden textarea.
    const area = document.createElement("textarea");
    area.value = text;
    area.style.position = "fixed";
    area.style.opacity = "0";
    document.body.appendChild(area);
    area.select();
    const ok = document.execCommand("copy");
    area.remove();
    return ok;
  }
}

/** Copies the class numbers of the chosen sections, one per line, for pasting into Student Center. */
export function ExportButton({
  picks, conflictCount, leftOut,
}: { picks: Pick[]; conflictCount: number; leftOut: string[] }) {
  const [status, setStatus] = useState<string | null>(null);
  const [manualText, setManualText] = useState<string | null>(null);

  async function handleCopy() {
    const lines = picks.map((p) => `${p.section.class_number}  ${p.courseCode} ${sectionLabel(p.section)}`);
    const ok = await copyText(lines.join("\n"));
    if (!ok) {
      // Show the text so it can be selected and copied by hand.
      setManualText(lines.join("\n"));
      setStatus("Your browser blocked copying. Select the text below and copy it.");
      return;
    }
    setManualText(null);
    const warning = conflictCount > 0 ? ` Heads up: ${plural(conflictCount, "conflict")} still in your schedule.` : "";
    const skipped = leftOut.length > 0 ? ` Not included (times not available yet): ${leftOut.join(", ")}.` : "";
    setStatus(`Copied ${plural(picks.length, "class number")}.${warning}${skipped}`);
    setTimeout(() => setStatus(null), 6000);
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <button
        type="button"
        onClick={handleCopy}
        disabled={picks.length === 0}
        className="inline-flex items-center gap-2 rounded-lg border border-line bg-white px-3 py-2 text-sm font-semibold hover:border-brand-200 hover:text-brand-700 disabled:opacity-50"
      >
        <CopyIcon />
        Copy class numbers
      </button>
      <span role="status" className="max-w-xs text-right text-xs text-muted">{status}</span>
      {manualText && (
        <textarea
          readOnly
          aria-label="Class numbers to copy"
          value={manualText}
          rows={Math.min(8, manualText.split("\n").length)}
          onFocus={(e) => e.currentTarget.select()}
          className="w-72 max-w-full rounded-lg border border-line bg-white p-2 font-mono text-xs"
        />
      )}
    </div>
  );
}
