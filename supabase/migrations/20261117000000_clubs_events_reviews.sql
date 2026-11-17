-- Slotted: profiles/admins, clubs, events, "my events", course reviews and reports.
-- Run the whole file ONCE in Supabase: SQL Editor -> New query -> paste -> Run.
-- Safe to run again (if not exists / or replace / drop policy if exists).

-- ============================================================
-- 1. Profiles and admins
-- ============================================================
create table if not exists public.profiles (
  user_id    uuid primary key references auth.users(id) on delete cascade,
  email      text not null,
  is_admin   boolean not null default false,
  created_at timestamptz not null default now()
);

-- Create a profile row automatically for every new account.
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  insert into public.profiles (user_id, email) values (new.id, new.email)
  on conflict (user_id) do nothing;
  return new;
end;
$$;
drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users for each row execute function public.handle_new_user();

-- Profiles for accounts that already exist.
insert into public.profiles (user_id, email)
select id, email from auth.users where email is not null
on conflict (user_id) do nothing;

-- "Am I an admin?" Used by the security rules below.
create or replace function public.is_admin()
returns boolean language sql stable security definer set search_path = '' as $$
  select coalesce((select is_admin from public.profiles where user_id = auth.uid()), false);
$$;

alter table public.profiles enable row level security;
revoke all on table public.profiles from anon, authenticated;
grant select on table public.profiles to authenticated;
-- No insert/update/delete for the website: is_admin can only be changed in the SQL editor.
drop policy if exists "Users read their own profile" on public.profiles;
create policy "Users read their own profile" on public.profiles
  for select to authenticated using ((select auth.uid()) = user_id or public.is_admin());

-- ============================================================
-- 2. Clubs
-- ============================================================
create table if not exists public.clubs (
  id             uuid primary key default gen_random_uuid(),
  name           text not null check (char_length(name) between 2 and 80),
  description    text not null default '' check (char_length(description) <= 2000),
  category       text not null check (category in ('academic','social','sports','cultural','career','other')),
  status         text not null default 'pending' check (status in ('pending','approved','rejected')),
  requested_by   uuid not null default auth.uid() references auth.users(id) on delete cascade,
  requester_role text not null default '' check (char_length(requester_role) <= 80),
  review_note    text not null default '' check (char_length(review_note) <= 500),
  reviewed_by    uuid references auth.users(id) on delete set null,
  reviewed_at    timestamptz,
  created_at     timestamptz not null default now()
);
create unique index if not exists clubs_name_unique on public.clubs (lower(name));

create table if not exists public.club_execs (
  club_id    uuid not null references public.clubs(id) on delete cascade,
  user_id    uuid not null references auth.users(id) on delete cascade,
  role       text not null default '' check (char_length(role) <= 80),
  created_at timestamptz not null default now(),
  primary key (club_id, user_id)
);

-- "Am I an exec of this (approved) club?"
create or replace function public.is_exec_of(club uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.club_execs e
    join public.clubs c on c.id = e.club_id
    where e.club_id = club and e.user_id = auth.uid() and c.status = 'approved'
  );
$$;

-- Students can't choose the status; a new request is always pending.
-- When an admin approves a request, the requester becomes the club's first exec.
create or replace function public.clubs_guard()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'INSERT' then
    new.status := 'pending';
    new.requested_by := auth.uid();
    new.reviewed_by := null;
    new.reviewed_at := null;
    new.review_note := '';
    return new;
  end if;
  -- UPDATE
  if not public.is_admin() then
    -- Requesters may only edit the text of their own pending request.
    if old.requested_by <> auth.uid() or old.status <> 'pending' then
      raise exception 'Only admins can change this club' using errcode = 'insufficient_privilege';
    end if;
    new.status := old.status; new.requested_by := old.requested_by;
    new.reviewed_by := old.reviewed_by; new.reviewed_at := old.reviewed_at; new.review_note := old.review_note;
    return new;
  end if;
  if new.status <> old.status then
    new.reviewed_by := auth.uid();
    new.reviewed_at := now();
    if new.status = 'approved' then
      insert into public.club_execs (club_id, user_id, role)
      values (new.id, new.requested_by, new.requester_role)
      on conflict do nothing;
    end if;
  end if;
  return new;
end;
$$;
drop trigger if exists clubs_guard on public.clubs;
create trigger clubs_guard before insert or update on public.clubs
  for each row execute function public.clubs_guard();

alter table public.clubs enable row level security;
alter table public.club_execs enable row level security;
revoke all on table public.clubs, public.club_execs from anon, authenticated;
grant select, insert, update on table public.clubs to authenticated;
grant select, insert, delete on table public.club_execs to authenticated;

drop policy if exists "Read approved clubs, own requests, or all as admin" on public.clubs;
create policy "Read approved clubs, own requests, or all as admin" on public.clubs
  for select to authenticated
  using (status = 'approved' or requested_by = (select auth.uid()) or public.is_admin());

drop policy if exists "Signed-in students can request a club" on public.clubs;
create policy "Signed-in students can request a club" on public.clubs
  for insert to authenticated with check (true);  -- the trigger forces pending + requester

drop policy if exists "Admins or the requester (while pending) can update" on public.clubs;
create policy "Admins or the requester (while pending) can update" on public.clubs
  for update to authenticated
  using (public.is_admin() or (requested_by = (select auth.uid()) and status = 'pending'))
  with check (public.is_admin() or requested_by = (select auth.uid()));

drop policy if exists "Everyone signed in can see club execs" on public.club_execs;
create policy "Everyone signed in can see club execs" on public.club_execs
  for select to authenticated using (true);
drop policy if exists "Admins manage execs" on public.club_execs;
create policy "Admins manage execs" on public.club_execs
  for insert to authenticated with check (public.is_admin());
drop policy if exists "Admins remove execs" on public.club_execs;
create policy "Admins remove execs" on public.club_execs
  for delete to authenticated using (public.is_admin());

-- ============================================================
-- 3. Events
-- ============================================================
create table if not exists public.events (
  id          uuid primary key default gen_random_uuid(),
  club_id     uuid not null references public.clubs(id) on delete cascade,
  title       text not null check (char_length(title) between 2 and 120),
  description text not null default '' check (char_length(description) <= 3000),
  category    text not null check (category in ('academic','social','sports','cultural','career','other')),
  location    text not null default '' check (char_length(location) <= 200),
  event_date  date not null,
  start_time  time not null,
  end_time    time not null check (end_time > start_time),
  created_by  uuid not null default auth.uid() references auth.users(id) on delete set null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index if not exists events_date_idx on public.events (event_date);
create index if not exists events_club_idx on public.events (club_id);

drop trigger if exists events_touch on public.events;
create trigger events_touch before update on public.events
  for each row execute function public.touch_updated_at();

alter table public.events enable row level security;
revoke all on table public.events from anon, authenticated;
grant select, insert, update, delete on table public.events to authenticated;

drop policy if exists "Signed-in students read events of approved clubs" on public.events;
create policy "Signed-in students read events of approved clubs" on public.events
  for select to authenticated
  using (exists (select 1 from public.clubs c where c.id = club_id and c.status = 'approved') or public.is_admin());

drop policy if exists "Execs create events for their club" on public.events;
create policy "Execs create events for their club" on public.events
  for insert to authenticated with check (public.is_exec_of(club_id));

drop policy if exists "Execs edit their club's events" on public.events;
create policy "Execs edit their club's events" on public.events
  for update to authenticated using (public.is_exec_of(club_id)) with check (public.is_exec_of(club_id));

drop policy if exists "Execs or admins delete events" on public.events;
create policy "Execs or admins delete events" on public.events
  for delete to authenticated using (public.is_exec_of(club_id) or public.is_admin());

-- Events a student added to their week.
create table if not exists public.my_events (
  user_id    uuid not null default auth.uid() references auth.users(id) on delete cascade,
  event_id   uuid not null references public.events(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, event_id)
);
alter table public.my_events enable row level security;
revoke all on table public.my_events from anon, authenticated;
grant select, insert, delete on table public.my_events to authenticated;
drop policy if exists "Students manage their own added events (read)" on public.my_events;
create policy "Students manage their own added events (read)" on public.my_events
  for select to authenticated using (user_id = (select auth.uid()));
drop policy if exists "Students manage their own added events (add)" on public.my_events;
create policy "Students manage their own added events (add)" on public.my_events
  for insert to authenticated with check (user_id = (select auth.uid()));
drop policy if exists "Students manage their own added events (remove)" on public.my_events;
create policy "Students manage their own added events (remove)" on public.my_events
  for delete to authenticated using (user_id = (select auth.uid()));

-- ============================================================
-- 4. Course reviews
-- ============================================================
create table if not exists public.reviews (
  id               uuid primary key default gen_random_uuid(),
  user_id          uuid not null default auth.uid() references auth.users(id) on delete cascade,
  course_code      text not null check (char_length(course_code) between 5 and 20),
  professor        text not null check (char_length(professor) between 2 and 80),
  term_taken       text not null check (term_taken ~ '^(Fall|Winter|Summer) 20[0-9]{2}$'),
  overall          smallint not null check (overall between 1 and 5),
  difficulty       smallint not null check (difficulty between 1 and 5),
  workload         smallint not null check (workload between 1 and 5),
  would_take_again boolean not null,
  comment          text not null default '' check (char_length(comment) <= 3000),
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  unique (user_id, course_code, term_taken)
);
create index if not exists reviews_course_idx on public.reviews (course_code);

-- Students can't change who wrote a review.
create or replace function public.reviews_guard()
returns trigger language plpgsql set search_path = '' as $$
begin
  if tg_op = 'INSERT' then new.user_id := auth.uid();
  else new.user_id := old.user_id; new.updated_at := now();
  end if;
  return new;
end;
$$;
drop trigger if exists reviews_guard on public.reviews;
create trigger reviews_guard before insert or update on public.reviews
  for each row execute function public.reviews_guard();

alter table public.reviews enable row level security;
revoke all on table public.reviews from anon, authenticated;
-- The website only ever reads reviews through the anonymous view below, so the
-- base table gets NO select grant: user_id can never be fetched by a student.
grant insert, update, delete on table public.reviews to authenticated;

drop policy if exists "Students post reviews" on public.reviews;
create policy "Students post reviews" on public.reviews
  for insert to authenticated with check (true);  -- trigger sets user_id
drop policy if exists "Students edit their own reviews" on public.reviews;
create policy "Students edit their own reviews" on public.reviews
  for update to authenticated using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
drop policy if exists "Students delete their own reviews; admins any" on public.reviews;
create policy "Students delete their own reviews; admins any" on public.reviews
  for delete to authenticated using (user_id = (select auth.uid()) or public.is_admin());

-- Anonymous view: everything except user_id, plus "is this mine?".
-- security_definer: the view can read the base table even though students can't.
create or replace view public.reviews_public
with (security_invoker = false) as
  select id, course_code, professor, term_taken, overall, difficulty, workload,
         would_take_again, comment, created_at, updated_at,
         (user_id = auth.uid()) as is_mine
  from public.reviews;
revoke all on public.reviews_public from anon;
grant select on public.reviews_public to authenticated;

create or replace view public.course_ratings with (security_invoker = false) as
  select course_code,
         count(*)::int as review_count,
         round(avg(overall), 2) as overall,
         round(avg(difficulty), 2) as difficulty,
         round(avg(workload), 2) as workload,
         round(avg(case when would_take_again then 1 else 0 end) * 100) as would_take_again_pct
  from public.reviews group by course_code;
revoke all on public.course_ratings from anon;
grant select on public.course_ratings to authenticated;

create or replace view public.professor_ratings with (security_invoker = false) as
  select course_code, professor,
         count(*)::int as review_count,
         round(avg(overall), 2) as overall,
         round(avg(difficulty), 2) as difficulty,
         round(avg(workload), 2) as workload,
         round(avg(case when would_take_again then 1 else 0 end) * 100) as would_take_again_pct
  from public.reviews group by course_code, professor;
revoke all on public.professor_ratings from anon;
grant select on public.professor_ratings to authenticated;

-- Reports
create table if not exists public.review_reports (
  id          uuid primary key default gen_random_uuid(),
  review_id   uuid not null references public.reviews(id) on delete cascade,
  reporter_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  reason      text not null default '' check (char_length(reason) <= 500),
  resolved_at timestamptz,
  created_at  timestamptz not null default now(),
  unique (review_id, reporter_id)
);
alter table public.review_reports enable row level security;
revoke all on table public.review_reports from anon, authenticated;
grant select, insert, update on table public.review_reports to authenticated;
drop policy if exists "Students report a review" on public.review_reports;
create policy "Students report a review" on public.review_reports
  for insert to authenticated with check (reporter_id = (select auth.uid()));
drop policy if exists "Reporters see their reports; admins see all" on public.review_reports;
create policy "Reporters see their reports; admins see all" on public.review_reports
  for select to authenticated using (reporter_id = (select auth.uid()) or public.is_admin());
drop policy if exists "Admins resolve reports" on public.review_reports;
create policy "Admins resolve reports" on public.review_reports
  for update to authenticated using (public.is_admin()) with check (public.is_admin());

-- Admins need to read the reported review's text (with its author hidden).
-- Admin page uses reviews_public joined to review_reports, so no extra grant is needed.
