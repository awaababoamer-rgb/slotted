-- Slotted database setup.
-- Run this whole file ONCE in the Supabase dashboard: SQL Editor -> New query -> paste -> Run.
-- It is safe to run again: everything uses "if not exists" / "or replace".
--
-- What it creates:
--   1. A rule that only @uwo.ca email addresses can have an account (enforced by the database).
--   2. Course tables (courses, sections, catalog_meta) readable ONLY by signed-in users.
--   3. A saved_schedules table where each student can only see and change their own rows.

-- ============================================================
-- 1. Only @uwo.ca accounts
-- ============================================================
-- A trigger on Supabase's own users table. It runs inside the database for every
-- new account and every email change, so it can't be skipped from the website or the API.
create or replace function public.enforce_uwo_email()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.email is null or lower(new.email) !~ '^[^@[:space:]]+@uwo\.ca$' then
    raise exception 'Slotted accounts are only for @uwo.ca email addresses'
      using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

drop trigger if exists enforce_uwo_email on auth.users;
create trigger enforce_uwo_email
  before insert or update of email on auth.users
  for each row execute function public.enforce_uwo_email();

-- ============================================================
-- 2. Course data (signed-in users can read; only the upload script can write)
-- ============================================================
create table if not exists public.courses (
  code        text primary key,          -- "COMPSCI 1020A"
  subject     text not null,
  number      text not null,
  suffix      text not null default '',
  title       text not null default '',
  term        text not null,             -- first_term | second_term | full_year | other_session | unknown
  description text not null default ''
);

create table if not exists public.sections (
  class_number integer primary key,
  course_code  text not null references public.courses(code) on delete cascade,
  section      text not null,
  component    text not null,            -- LEC | LAB | TUT
  "full"       boolean not null default false,
  status       text not null default '',
  campus       text not null default '',
  delivery     text not null default '',
  notes        text not null default '',
  requisites   text not null default '',
  instructors  text[] not null default '{}',
  meetings     jsonb not null default '[]',  -- [{day, start, end, location}]
  credit_units text,
  waitlist     integer,
  data_source  text not null default 'public',  -- public | dms
  dms_updated  timestamptz
);
create index if not exists sections_course_code_idx on public.sections(course_code);

create table if not exists public.catalog_meta (
  id               integer primary key default 1 check (id = 1),  -- a single row
  last_updated     timestamptz,
  dms_last_updated timestamptz
);

alter table public.courses      enable row level security;
alter table public.sections     enable row level security;
alter table public.catalog_meta enable row level security;

-- Signed-out visitors ("anon") get no access at all, not even an empty answer.
revoke all on table public.courses, public.sections, public.catalog_meta from anon;
-- Signed-in users may only read.
revoke all on table public.courses, public.sections, public.catalog_meta from authenticated;
grant select on table public.courses, public.sections, public.catalog_meta to authenticated;

drop policy if exists "Signed-in users can read courses" on public.courses;
create policy "Signed-in users can read courses" on public.courses
  for select to authenticated using (true);

drop policy if exists "Signed-in users can read sections" on public.sections;
create policy "Signed-in users can read sections" on public.sections
  for select to authenticated using (true);

drop policy if exists "Signed-in users can read catalog info" on public.catalog_meta;
create policy "Signed-in users can read catalog info" on public.catalog_meta
  for select to authenticated using (true);
-- No insert/update/delete policies: only the upload script (secret key) can change course data.

-- ============================================================
-- 3. Saved schedules (each student sees only their own)
-- ============================================================
create table if not exists public.saved_schedules (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null default auth.uid() references auth.users(id) on delete cascade,
  name       text not null check (char_length(name) between 1 and 60),
  choices    jsonb not null default '[]',  -- courses + chosen sections
  locked     jsonb not null default '[]',  -- locked class numbers
  prefs      jsonb not null default '{}',  -- priorities
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, name)
);
create index if not exists saved_schedules_user_idx on public.saved_schedules(user_id);

create or replace function public.touch_updated_at()
returns trigger language plpgsql set search_path = '' as $$
begin
  new.updated_at = now();
  return new;
end;
$$;
drop trigger if exists saved_schedules_touch on public.saved_schedules;
create trigger saved_schedules_touch
  before update on public.saved_schedules
  for each row execute function public.touch_updated_at();

alter table public.saved_schedules enable row level security;
revoke all on table public.saved_schedules from anon;
grant select, insert, update, delete on table public.saved_schedules to authenticated;

drop policy if exists "Students read their own schedules" on public.saved_schedules;
create policy "Students read their own schedules" on public.saved_schedules
  for select to authenticated using ((select auth.uid()) = user_id);

drop policy if exists "Students add their own schedules" on public.saved_schedules;
create policy "Students add their own schedules" on public.saved_schedules
  for insert to authenticated with check ((select auth.uid()) = user_id);

drop policy if exists "Students change their own schedules" on public.saved_schedules;
create policy "Students change their own schedules" on public.saved_schedules
  for update to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

drop policy if exists "Students delete their own schedules" on public.saved_schedules;
create policy "Students delete their own schedules" on public.saved_schedules
  for delete to authenticated using ((select auth.uid()) = user_id);
