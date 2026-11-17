import { useId, useRef, useState } from "react";
import { CATEGORIES, CATEGORY_LABELS, type Category, type Club } from "../data/clubs";
import {
  checkMediaFile, createEvent, MEDIA_LIMITS, mediaUrl, removeMedia, updateEvent, uploadMedia,
  type ClubEvent, type EventInput, type MediaItem,
} from "../data/events";

const inputClass = "mt-1 w-full rounded-lg border border-line px-3 py-2 text-sm focus:border-brand-600";

function todayISO(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

interface Props {
  clubs: Club[]; // clubs the student is an exec of
  editing: ClubEvent | null;
  onDone: () => void;
  onCancel: () => void;
}

/** Create or edit a club event, with up to 4 photos and 1 video. */
export function EventForm({ clubs, editing, onDone, onCancel }: Props) {
  const [form, setForm] = useState<EventInput>(() =>
    editing
      ? {
          club_id: editing.club_id, title: editing.title, description: editing.description, category: editing.category,
          location: editing.location, event_date: editing.event_date, start_time: editing.start_time,
          end_time: editing.end_time, media: editing.media,
        }
      : {
          club_id: clubs[0]?.id ?? "", title: "", description: "", category: clubs[0]?.category ?? "other",
          location: "", event_date: todayISO(), start_time: "17:00", end_time: "18:00", media: [],
        },
  );
  // Files uploaded during this edit (deleted again if you cancel) and saved files you removed.
  const uploadedNow = useRef<string[]>([]);
  const [removed, setRemoved] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const id = useId();
  const set = (patch: Partial<EventInput>) => setForm((f) => ({ ...f, ...patch }));

  async function addFiles(files: FileList | null) {
    if (!files || files.length === 0) return;
    setError(null);
    setUploading(true);
    let media = [...form.media];
    try {
      for (const file of Array.from(files)) {
        const problem = checkMediaFile(file, media);
        if (problem) {
          setError(problem);
          continue;
        }
        const item = await uploadMedia(form.club_id, file);
        uploadedNow.current.push(item.path);
        media = [...media, item];
        set({ media });
      }
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setUploading(false);
    }
  }

  function removeItem(item: MediaItem) {
    set({ media: form.media.filter((m) => m.path !== item.path) });
    if (uploadedNow.current.includes(item.path)) {
      uploadedNow.current = uploadedNow.current.filter((p) => p !== item.path);
      void removeMedia([item.path]);
    } else {
      setRemoved((r) => [...r, item.path]);
    }
  }

  async function cancel() {
    await removeMedia(uploadedNow.current); // don't leave unused uploads behind
    onCancel();
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (form.title.trim().length < 2) return setError("Give the event a title.");
    if (form.end_time <= form.start_time) return setError("The end time must be after the start time.");
    setBusy(true);
    setError(null);
    try {
      const input = { ...form, title: form.title.trim(), description: form.description.trim(), location: form.location.trim() };
      if (editing) await updateEvent(editing.id, input);
      else await createEvent(input);
      await removeMedia(removed);
      onDone();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const photos = form.media.filter((m) => m.type === "image").length;
  const videos = form.media.filter((m) => m.type === "video").length;

  return (
    <form onSubmit={submit} className="rounded-2xl border border-line bg-white p-5 shadow-sm">
      <h2 className="font-display text-lg font-semibold">{editing ? "Edit event" : "Post an event"}</h2>
      <div className="mt-4 grid gap-4 sm:grid-cols-2">
        <div>
          <label htmlFor={`${id}-club`} className="text-sm font-semibold">Club</label>
          <select id={`${id}-club`} value={form.club_id} disabled={!!editing || form.media.length > 0}
            onChange={(e) => set({ club_id: e.target.value })} className={inputClass}>
            {clubs.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </div>
        <div>
          <label htmlFor={`${id}-cat`} className="text-sm font-semibold">Category</label>
          <select id={`${id}-cat`} value={form.category} onChange={(e) => set({ category: e.target.value as Category })} className={inputClass}>
            {CATEGORIES.map((c) => <option key={c} value={c}>{CATEGORY_LABELS[c]}</option>)}
          </select>
        </div>
        <div className="sm:col-span-2">
          <label htmlFor={`${id}-title`} className="text-sm font-semibold">Title</label>
          <input id={`${id}-title`} maxLength={120} value={form.title} onChange={(e) => set({ title: e.target.value })} className={inputClass} />
        </div>
        <div className="sm:col-span-2">
          <label htmlFor={`${id}-desc`} className="text-sm font-semibold">Description</label>
          <textarea id={`${id}-desc`} rows={3} maxLength={3000} value={form.description} onChange={(e) => set({ description: e.target.value })} className={inputClass} />
        </div>
        <div className="sm:col-span-2">
          <label htmlFor={`${id}-loc`} className="text-sm font-semibold">Location</label>
          <input id={`${id}-loc`} maxLength={200} placeholder="e.g. UCC 56" value={form.location} onChange={(e) => set({ location: e.target.value })} className={inputClass} />
        </div>
        <div>
          <label htmlFor={`${id}-date`} className="text-sm font-semibold">Date</label>
          <input id={`${id}-date`} type="date" value={form.event_date} onChange={(e) => set({ event_date: e.target.value })} className={inputClass} />
        </div>
        <div className="grid grid-cols-2 gap-2">
          <div>
            <label htmlFor={`${id}-start`} className="text-sm font-semibold">Start</label>
            <input id={`${id}-start`} type="time" value={form.start_time} onChange={(e) => set({ start_time: e.target.value })} className={inputClass} />
          </div>
          <div>
            <label htmlFor={`${id}-end`} className="text-sm font-semibold">End</label>
            <input id={`${id}-end`} type="time" value={form.end_time} onChange={(e) => set({ end_time: e.target.value })} className={inputClass} />
          </div>
        </div>

        <div className="sm:col-span-2">
          <label htmlFor={`${id}-media`} className="text-sm font-semibold">Photos and video</label>
          <p className="text-xs text-muted">
            Up to {MEDIA_LIMITS.maxPhotos} photos (5 MB each) and {MEDIA_LIMITS.maxVideos} video (25 MB). {photos}/{MEDIA_LIMITS.maxPhotos} photos, {videos}/{MEDIA_LIMITS.maxVideos} video.
          </p>
          <input
            id={`${id}-media`}
            type="file"
            multiple
            accept={[...MEDIA_LIMITS.photoTypes, ...MEDIA_LIMITS.videoTypes].join(",")}
            disabled={uploading || !form.club_id}
            onChange={(e) => { void addFiles(e.target.files); e.target.value = ""; }}
            className="mt-2 block text-sm"
          />
          {uploading && <p className="mt-1 text-xs text-muted" role="status">Uploading…</p>}
          {form.media.length > 0 && (
            <ul className="mt-3 flex flex-wrap gap-2">
              {form.media.map((m) => (
                <li key={m.path} className="relative">
                  {m.type === "image" ? (
                    <img src={mediaUrl(m.path)} alt="" className="size-24 rounded-lg object-cover" />
                  ) : (
                    <video src={mediaUrl(m.path)} className="size-24 rounded-lg bg-ink object-cover" muted />
                  )}
                  <button type="button" onClick={() => removeItem(m)} aria-label="Remove this file"
                    className="absolute top-1 right-1 rounded-full bg-white/90 px-1.5 text-xs font-bold shadow">×</button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
      {error && <p role="alert" className="mt-3 text-sm text-conflict-700">{error}</p>}
      <div className="mt-4 flex justify-end gap-2">
        <button type="button" onClick={() => void cancel()} className="rounded-lg border border-line px-4 py-2 text-sm font-semibold">Cancel</button>
        <button type="submit" disabled={busy || uploading} className="rounded-lg bg-brand-700 px-4 py-2 text-sm font-semibold text-white disabled:opacity-60">
          {busy ? "Saving…" : editing ? "Save changes" : "Post event"}
        </button>
      </div>
    </form>
  );
}
