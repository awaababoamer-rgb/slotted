-- Let students from other Ontario universities sign in (decided 2026-11-17).
-- Run once in Supabase: SQL Editor -> New query -> paste -> Run. Safe to re-run.
--
-- Accounts are only allowed for email domains in public.allowed_email_domains
-- (subdomains count too, e.g. mail.utoronto.ca). Admins edit the list on the
-- Admin page. Still enforced by the database, not just the website.

create table if not exists public.allowed_email_domains (
  domain      text primary key check (domain = lower(domain) and domain ~ '^[a-z0-9.-]+\.[a-z]{2,}$'),
  school_name text not null check (char_length(school_name) between 2 and 80),
  added_at    timestamptz not null default now()
);

insert into public.allowed_email_domains (domain, school_name) values
  ('uwo.ca', 'Western University'),
  ('uwaterloo.ca', 'University of Waterloo'),
  ('utoronto.ca', 'University of Toronto'),
  ('mcmaster.ca', 'McMaster University'),
  ('yorku.ca', 'York University'),
  ('queensu.ca', 'Queen''s University'),
  ('uottawa.ca', 'University of Ottawa'),
  ('carleton.ca', 'Carleton University'),
  ('uoguelph.ca', 'University of Guelph'),
  ('wlu.ca', 'Wilfrid Laurier University'),
  ('mylaurier.ca', 'Wilfrid Laurier University'),
  ('brocku.ca', 'Brock University'),
  ('torontomu.ca', 'Toronto Metropolitan University'),
  ('ontariotechu.net', 'Ontario Tech University'),
  ('ontariotechu.ca', 'Ontario Tech University'),
  ('trentu.ca', 'Trent University'),
  ('uwindsor.ca', 'University of Windsor'),
  ('laurentian.ca', 'Laurentian University'),
  ('lakeheadu.ca', 'Lakehead University'),
  ('nipissingu.ca', 'Nipissing University'),
  ('algomau.ca', 'Algoma University'),
  ('ocadu.ca', 'OCAD University')
on conflict (domain) do nothing;

alter table public.allowed_email_domains enable row level security;
revoke all on table public.allowed_email_domains from anon, authenticated;
-- The sign-in screen shows the list before anyone signs in; it isn't secret.
grant select on table public.allowed_email_domains to anon, authenticated;
grant insert, delete on table public.allowed_email_domains to authenticated;

drop policy if exists "Anyone can read the allowed schools" on public.allowed_email_domains;
create policy "Anyone can read the allowed schools" on public.allowed_email_domains
  for select to anon, authenticated using (true);
drop policy if exists "Admins add schools" on public.allowed_email_domains;
create policy "Admins add schools" on public.allowed_email_domains
  for insert to authenticated with check (public.is_admin());
drop policy if exists "Admins remove schools (never Western)" on public.allowed_email_domains;
create policy "Admins remove schools (never Western)" on public.allowed_email_domains
  for delete to authenticated using (public.is_admin() and domain <> 'uwo.ca');

-- Is this email from an allowed school? (exact domain or a subdomain of one)
create or replace function public.email_allowed(email text)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.allowed_email_domains d
    where split_part(lower(email), '@', 2) = d.domain
       or split_part(lower(email), '@', 2) like '%.' || d.domain
  ) and lower(email) ~ '^[^@[:space:]]+@[a-z0-9.-]+$';
$$;

-- Replace the old @uwo.ca-only rule with the allowed-schools rule.
create or replace function public.enforce_allowed_email()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.email is null or not public.email_allowed(new.email) then
    raise exception 'Slotted accounts are only for university email addresses on our list'
      using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

drop trigger if exists enforce_uwo_email on auth.users;
drop trigger if exists enforce_allowed_email on auth.users;
create trigger enforce_allowed_email
  before insert or update of email on auth.users
  for each row execute function public.enforce_allowed_email();
