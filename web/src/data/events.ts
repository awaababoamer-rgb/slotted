// Club events and their photos/videos.
// The database decides who may create/edit/delete (only execs of approved clubs);
// this file just asks, and checks sizes before uploading so students get a clear message.

import type { Category } from "./clubs";
import { requireSupabase } from "./supabase";

export const MEDIA_BUCKET = "event-media";
export const MEDIA_LIMITS = {
  maxPhotos: 4,
  maxVideos: 1,
  photoBytes: 5 * 1024 * 1024,
  videoBytes: 25 * 1024 * 1024,
  photoTypes: ["image/jpeg", "image/png", "image/webp", "image/gif"],
  videoTypes: ["video/mp4", "video/webm"],
};

export interface MediaItem {
  path: string;
  type: "image" | "video";
}

export interface ClubEvent {
  id: string;
  club_id: string;
  club_name: string;
  club_category: Category;
  title: string;
  description: string;
  category: Category;
  location: string;
  event_date: string; // "2026-10-05"
  start_time: string; // "15:00"
  end_time: string;
  media: MediaItem[];
}

export type EventInput = Omit<ClubEvent, "id" | "club_name" | "club_category">;

interface EventRow extends Omit<ClubEvent, "club_name" | "club_category"> {
  clubs: { name: string; category: Category } | null;
}

const COLUMNS = "id,club_id,title,description,category,location,event_date,start_time,end_time,media,clubs(name,category)";

function fromRow(row: EventRow): ClubEvent {
  const { clubs, ...rest } = row;
  return {
    ...rest,
    start_time: rest.start_time.slice(0, 5),
    end_time: rest.end_time.slice(0, 5),
    media: Array.isArray(rest.media) ? rest.media : [],
    club_name: clubs?.name ?? "Unknown club",
    club_category: clubs?.category ?? "other",
  };
}

/** Events from today on (or all, for an exec managing their club). */
export async function listEvents(options: { fromDate?: string } = {}): Promise<ClubEvent[]> {
  let query = requireSupabase().from("events").select(COLUMNS).order("event_date").order("start_time");
  if (options.fromDate) query = query.gte("event_date", options.fromDate);
  const { data, error } = await query;
  if (error) throw new Error(`Couldn't load events: ${error.message}`);
  return ((data ?? []) as unknown as EventRow[]).map(fromRow);
}

function friendly(error: { code?: string; message: string }): Error {
  if (error.code === "42501" || /row-level security/i.test(error.message)) {
    return new Error("Only execs of an approved club can post or change its events.");
  }
  if (/events_media_limits/.test(error.message)) {
    return new Error(`At most ${MEDIA_LIMITS.maxPhotos} photos and ${MEDIA_LIMITS.maxVideos} video per event.`);
  }
  if (/end_time/.test(error.message)) return new Error("The end time must be after the start time.");
  return new Error(error.message);
}

export async function createEvent(input: EventInput): Promise<void> {
  const { error } = await requireSupabase().from("events").insert(input);
  if (error) throw friendly(error);
}

export async function updateEvent(id: string, input: EventInput): Promise<void> {
  const { data, error } = await requireSupabase().from("events").update(input).eq("id", id).select("id");
  if (error) throw friendly(error);
  if (!data || data.length === 0) throw new Error("Only execs of this club can edit its events.");
}

export async function deleteEvent(event: ClubEvent): Promise<void> {
  const { data, error } = await requireSupabase().from("events").delete().eq("id", event.id).select("id");
  if (error) throw friendly(error);
  if (!data || data.length === 0) throw new Error("Only execs of this club can delete its events.");
  await removeMedia(event.media.map((m) => m.path));
}

// ---- Photos and videos ----

export function mediaUrl(path: string): string {
  return requireSupabase().storage.from(MEDIA_BUCKET).getPublicUrl(path).data.publicUrl;
}

/** Returns an error message if the file breaks a limit, or null if it's fine. */
export function checkMediaFile(file: File, current: MediaItem[]): string | null {
  const isPhoto = MEDIA_LIMITS.photoTypes.includes(file.type);
  const isVideo = MEDIA_LIMITS.videoTypes.includes(file.type);
  const mb = (bytes: number) => `${Math.round(bytes / 1024 / 1024)} MB`;
  if (!isPhoto && !isVideo) return `${file.name}: only JPG, PNG, WebP, GIF photos or MP4/WebM videos.`;
  if (isPhoto && file.size > MEDIA_LIMITS.photoBytes) return `${file.name} is ${mb(file.size)}. Photos must be ${mb(MEDIA_LIMITS.photoBytes)} or less.`;
  if (isVideo && file.size > MEDIA_LIMITS.videoBytes) return `${file.name} is ${mb(file.size)}. Videos must be ${mb(MEDIA_LIMITS.videoBytes)} or less.`;
  const photos = current.filter((m) => m.type === "image").length;
  const videos = current.filter((m) => m.type === "video").length;
  if (isPhoto && photos >= MEDIA_LIMITS.maxPhotos) return `At most ${MEDIA_LIMITS.maxPhotos} photos per event.`;
  if (isVideo && videos >= MEDIA_LIMITS.maxVideos) return `At most ${MEDIA_LIMITS.maxVideos} video per event.`;
  return null;
}

export async function uploadMedia(clubId: string, file: File): Promise<MediaItem> {
  const ext = (file.name.split(".").pop() ?? "bin").toLowerCase().replace(/[^a-z0-9]/g, "");
  const path = `${clubId}/${crypto.randomUUID()}.${ext}`;
  const { error } = await requireSupabase().storage.from(MEDIA_BUCKET).upload(path, file, {
    contentType: file.type,
    cacheControl: "31536000",
  });
  if (error) {
    if (/row-level security|unauthorized/i.test(error.message)) throw new Error("Only execs of this club can upload media.");
    if (/exceeded|too large|size/i.test(error.message)) throw new Error(`${file.name} is too large.`);
    throw new Error(`Upload failed: ${error.message}`);
  }
  return { path, type: file.type.startsWith("video/") ? "video" : "image" };
}

export async function removeMedia(paths: string[]): Promise<void> {
  if (paths.length === 0) return;
  await requireSupabase().storage.from(MEDIA_BUCKET).remove(paths);
}
