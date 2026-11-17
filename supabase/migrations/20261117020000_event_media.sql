-- Photos and videos for club events, with size limits.
-- Run once in Supabase: SQL Editor -> New query -> paste -> Run. Safe to re-run.
--
-- Limits (free plan has ~1 GB storage in total):
--   photos: jpg/png/webp/gif, up to 5 MB each, at most 4 per event
--   video:  mp4/webm, up to 25 MB, at most 1 per event
-- Server-enforced: the bucket refuses files over 25 MB or of other types, and the
-- events table refuses more than 4 photos / 1 video. The 5 MB photo limit is
-- checked in the browser (Supabase doesn't allow triggers on its storage tables).

-- 1. Which files belong to an event: [{ "path": "...", "type": "image" | "video" }]
alter table public.events add column if not exists media jsonb not null default '[]';

create or replace function public.valid_event_media(media jsonb)
returns boolean language sql immutable as $$
  select jsonb_typeof(media) = 'array'
     and (select count(*) from jsonb_array_elements(media) m where m->>'type' = 'image') <= 4
     and (select count(*) from jsonb_array_elements(media) m where m->>'type' = 'video') <= 1
     and not exists (select 1 from jsonb_array_elements(media) m where m->>'type' not in ('image', 'video'));
$$;

alter table public.events drop constraint if exists events_media_limits;
alter table public.events add constraint events_media_limits check (public.valid_event_media(media));

-- 2. The storage bucket. Files live at  <club id>/<random name>.<ext>
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('event-media', 'event-media', true, 26214400,
        array['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'video/mp4', 'video/webm'])
on conflict (id) do update
  set public = excluded.public,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

-- Folder name -> club id, without erroring on junk names.
create or replace function public.club_id_from_path(path text)
returns uuid language plpgsql immutable as $$
begin
  return split_part(path, '/', 1)::uuid;
exception when others then
  return null;
end;
$$;

drop policy if exists "Execs upload media for their club" on storage.objects;
create policy "Execs upload media for their club" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'event-media' and public.is_exec_of(public.club_id_from_path(name)));

drop policy if exists "Execs or admins delete their club media" on storage.objects;
create policy "Execs or admins delete their club media" on storage.objects
  for delete to authenticated
  using (bucket_id = 'event-media'
         and (public.is_exec_of(public.club_id_from_path(name)) or public.is_admin()));
