-- Guest mode: visitors who aren't signed in ("anon") can READ the public parts of Slotted.
-- Western confirmed timetable information is not sensitive, so course data is now public.
-- Guests can never write anything: every insert/update/delete policy stays "to authenticated".
-- Still private: profiles, saved schedules, added events, friends, shared timetables,
-- review reports, unpublished programs and pending clubs.

-- Course data
grant select on table public.courses, public.sections, public.catalog_meta to anon;

drop policy if exists "Guests can read courses" on public.courses;
create policy "Guests can read courses" on public.courses for select to anon using (true);

drop policy if exists "Guests can read sections" on public.sections;
create policy "Guests can read sections" on public.sections for select to anon using (true);

drop policy if exists "Guests can read catalog info" on public.catalog_meta;
create policy "Guests can read catalog info" on public.catalog_meta for select to anon using (true);

-- Reviews: only the anonymous view and the averages (never the reviews table, which has user_id).
-- is_mine is always false for guests, because auth.uid() is null.
grant select on public.reviews_public, public.course_ratings, public.professor_ratings to anon;

-- Approved clubs and their events (the events board). Column-level grants: guests never see
-- who requested or created something, or admins' review notes.
grant select (id, name, description, category, status, created_at) on table public.clubs to anon;
grant select (id, club_id, title, description, category, location, event_date, start_time, end_time, media, created_at, updated_at)
  on table public.events to anon;

drop policy if exists "Guests read approved clubs" on public.clubs;
create policy "Guests read approved clubs" on public.clubs
  for select to anon using (status = 'approved');

drop policy if exists "Guests read events of approved clubs" on public.events;
create policy "Guests read events of approved clubs" on public.events
  for select to anon
  using (exists (select 1 from public.clubs c where c.id = club_id and c.status = 'approved'));

-- Published programs
grant select on table public.programs, public.program_requirements to anon;

drop policy if exists "Guests read published programs" on public.programs;
create policy "Guests read published programs" on public.programs
  for select to anon using (published);

drop policy if exists "Guests read requirements of published programs" on public.program_requirements;
create policy "Guests read requirements of published programs" on public.program_requirements
  for select to anon
  using (exists (select 1 from public.programs p where p.id = program_id and p.published));
