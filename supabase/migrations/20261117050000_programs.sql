-- Programs (degree modules) for the optional "Pick a program" chooser.
-- Entered by the team by hand from the Academic Calendar (we don't scrape it).
-- Run once in Supabase: SQL Editor -> New query -> paste -> Run. Safe to re-run.

create table if not exists public.programs (
  id           uuid primary key default gen_random_uuid(),
  name         text not null check (char_length(name) between 2 and 120),   -- "Honours Specialization in Computer Science"
  short_name   text not null default '' check (char_length(short_name) <= 40), -- "Computer Science"
  year         smallint not null check (year between 1 and 5),
  description  text not null default '' check (char_length(description) <= 1000),
  calendar_url text not null default '' check (calendar_url = '' or calendar_url ~ '^https://'),
  published    boolean not null default false,   -- students only see published programs
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  unique (name, year)
);

create table if not exists public.program_requirements (
  id           uuid primary key default gen_random_uuid(),
  program_id   uuid not null references public.programs(id) on delete cascade,
  kind         text not null check (kind in ('required', 'choose')),
  title        text not null default '' check (char_length(title) <= 160), -- "Statistics" / "Choose one elective"
  choose_count smallint not null default 1 check (choose_count between 1 and 10), -- for 'choose' groups
  course_codes text[] not null default '{}',   -- e.g. {"COMPSCI 2210A","COMPSCI 2210B"}
  sort_order   smallint not null default 0,
  created_at   timestamptz not null default now()
);
create index if not exists program_requirements_program_idx on public.program_requirements(program_id);

drop trigger if exists programs_touch on public.programs;
create trigger programs_touch before update on public.programs
  for each row execute function public.touch_updated_at();

alter table public.programs enable row level security;
alter table public.program_requirements enable row level security;
revoke all on table public.programs, public.program_requirements from anon, authenticated;
grant select, insert, update, delete on table public.programs, public.program_requirements to authenticated;

drop policy if exists "Students read published programs; admins read all" on public.programs;
create policy "Students read published programs; admins read all" on public.programs
  for select to authenticated using (published or public.is_admin());
drop policy if exists "Admins add programs" on public.programs;
create policy "Admins add programs" on public.programs
  for insert to authenticated with check (public.is_admin());
drop policy if exists "Admins edit programs" on public.programs;
create policy "Admins edit programs" on public.programs
  for update to authenticated using (public.is_admin()) with check (public.is_admin());
drop policy if exists "Admins delete programs" on public.programs;
create policy "Admins delete programs" on public.programs
  for delete to authenticated using (public.is_admin());

drop policy if exists "Read requirements of visible programs" on public.program_requirements;
create policy "Read requirements of visible programs" on public.program_requirements
  for select to authenticated
  using (exists (select 1 from public.programs p where p.id = program_id and (p.published or public.is_admin())));
drop policy if exists "Admins add requirements" on public.program_requirements;
create policy "Admins add requirements" on public.program_requirements
  for insert to authenticated with check (public.is_admin());
drop policy if exists "Admins edit requirements" on public.program_requirements;
create policy "Admins edit requirements" on public.program_requirements
  for update to authenticated using (public.is_admin()) with check (public.is_admin());
drop policy if exists "Admins delete requirements" on public.program_requirements;
create policy "Admins delete requirements" on public.program_requirements
  for delete to authenticated using (public.is_admin());
