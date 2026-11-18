-- Friends and shared timetables ("find a course to take together").
-- Run once in Supabase: SQL Editor -> New query -> paste -> Run. Safe to re-run.
--
-- Privacy:
--  * You add a friend with their friend CODE (no searching by email).
--  * Nothing is shared until the other person accepts.
--  * Sharing your timetable is a separate opt-in; friends only ever see your
--    chosen sections (course + class numbers), nothing else.

-- 1. Friend codes (8 letters/digits, no look-alikes like 0/O or 1/I).
alter table public.profiles add column if not exists friend_code text unique;

create or replace function public.new_friend_code()
returns text language plpgsql volatile set search_path = '' as $$
declare
  alphabet constant text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  code text;
begin
  loop
    code := '';
    for i in 1..8 loop
      code := code || substr(alphabet, 1 + floor(random() * length(alphabet))::int, 1);
    end loop;
    exit when not exists (select 1 from public.profiles where friend_code = code);
  end loop;
  return code;
end;
$$;

update public.profiles set friend_code = public.new_friend_code() where friend_code is null;

create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  insert into public.profiles (user_id, email, friend_code) values (new.id, new.email, public.new_friend_code())
  on conflict (user_id) do nothing;
  return new;
end;
$$;

-- 2. Friendships
create table if not exists public.friendships (
  id         uuid primary key default gen_random_uuid(),
  requester  uuid not null references auth.users(id) on delete cascade,
  addressee  uuid not null references auth.users(id) on delete cascade,
  status     text not null default 'pending' check (status in ('pending', 'accepted')),
  created_at timestamptz not null default now(),
  check (requester <> addressee)
);
-- One friendship per pair, whichever direction it was sent in.
create unique index if not exists friendships_pair_unique
  on public.friendships (least(requester, addressee), greatest(requester, addressee));

alter table public.friendships enable row level security;
revoke all on table public.friendships from anon, authenticated;
grant select, update, delete on table public.friendships to authenticated;  -- inserts go through add_friend()

drop policy if exists "See your own friendships" on public.friendships;
create policy "See your own friendships" on public.friendships
  for select to authenticated using ((select auth.uid()) in (requester, addressee));
drop policy if exists "Only the person asked can accept" on public.friendships;
create policy "Only the person asked can accept" on public.friendships
  for update to authenticated
  using (addressee = (select auth.uid()) and status = 'pending')
  with check (addressee = (select auth.uid()) and status = 'accepted');
drop policy if exists "Either person can remove a friendship" on public.friendships;
create policy "Either person can remove a friendship" on public.friendships
  for delete to authenticated using ((select auth.uid()) in (requester, addressee));

create or replace function public.are_friends(a uuid, b uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.friendships
    where status = 'accepted'
      and ((requester = a and addressee = b) or (requester = b and addressee = a))
  );
$$;

-- Send a friend request using someone's friend code.
create or replace function public.add_friend(code text)
returns void language plpgsql security definer set search_path = '' as $$
declare
  target uuid;
begin
  if auth.uid() is null then
    raise exception 'Sign in first' using errcode = 'insufficient_privilege';
  end if;
  select user_id into target from public.profiles where friend_code = upper(trim(code));
  if target is null then
    raise exception 'No one has that friend code. Check it and try again.' using errcode = 'no_data_found';
  end if;
  if target = auth.uid() then
    raise exception 'That''s your own code.' using errcode = 'check_violation';
  end if;
  insert into public.friendships (requester, addressee) values (auth.uid(), target);
exception when unique_violation then
  raise exception 'You''re already friends, or a request is already waiting.' using errcode = 'unique_violation';
end;
$$;
revoke all on function public.add_friend(text) from public, anon;
grant execute on function public.add_friend(text) to authenticated;

-- 3. Shared timetables (opt-in): just your chosen sections.
create table if not exists public.shared_schedules (
  user_id    uuid primary key default auth.uid() references auth.users(id) on delete cascade,
  choices    jsonb not null default '[]',   -- [{ code, picks: { LEC: 12345, LAB: 67890 } }]
  updated_at timestamptz not null default now()
);
drop trigger if exists shared_schedules_touch on public.shared_schedules;
create trigger shared_schedules_touch before update on public.shared_schedules
  for each row execute function public.touch_updated_at();

alter table public.shared_schedules enable row level security;
revoke all on table public.shared_schedules from anon, authenticated;
grant select, insert, update, delete on table public.shared_schedules to authenticated;

drop policy if exists "Read your own or accepted friends' shared timetables" on public.shared_schedules;
create policy "Read your own or accepted friends' shared timetables" on public.shared_schedules
  for select to authenticated
  using (user_id = (select auth.uid()) or public.are_friends((select auth.uid()), user_id));
drop policy if exists "Share your own timetable" on public.shared_schedules;
create policy "Share your own timetable" on public.shared_schedules
  for insert to authenticated with check (user_id = (select auth.uid()));
drop policy if exists "Update your own shared timetable" on public.shared_schedules;
create policy "Update your own shared timetable" on public.shared_schedules
  for update to authenticated using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
drop policy if exists "Stop sharing your timetable" on public.shared_schedules;
create policy "Stop sharing your timetable" on public.shared_schedules
  for delete to authenticated using (user_id = (select auth.uid()));

-- Your friends and requests, with the other person's email (only for people you're connected to).
create or replace function public.my_friends()
returns table (friendship_id uuid, friend_id uuid, email text, status text, incoming boolean, sharing boolean)
language sql stable security definer set search_path = '' as $$
  select f.id,
         case when f.requester = auth.uid() then f.addressee else f.requester end,
         p.email,
         f.status,
         f.addressee = auth.uid(),
         f.status = 'accepted' and exists (
           select 1 from public.shared_schedules s
           where s.user_id = case when f.requester = auth.uid() then f.addressee else f.requester end)
  from public.friendships f
  join public.profiles p on p.user_id = case when f.requester = auth.uid() then f.addressee else f.requester end
  where auth.uid() in (f.requester, f.addressee)
  order by f.status, p.email;
$$;

revoke all on function public.my_friends() from public, anon;
grant execute on function public.my_friends() to authenticated;
