-- Let admins make other team members admins (or remove them) from the website.
-- Run once in Supabase: SQL Editor -> New query -> paste -> Run. Safe to re-run.
--
-- Students still can't change profiles directly. The only way in is this
-- function, which checks inside the database that the caller is an admin.

create or replace function public.set_admin(target_email text, make_admin boolean)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  target uuid;
begin
  if not public.is_admin() then
    raise exception 'Only admins can change who is an admin' using errcode = 'insufficient_privilege';
  end if;

  select user_id into target from public.profiles where lower(email) = lower(trim(target_email));
  if target is null then
    raise exception 'No Slotted account with that email. They need to sign in once first.' using errcode = 'no_data_found';
  end if;

  if not make_admin then
    if target = auth.uid() then
      raise exception 'You can''t remove your own admin access. Ask another admin.' using errcode = 'check_violation';
    end if;
    if (select count(*) from public.profiles where is_admin) <= 1 then
      raise exception 'Slotted must always have at least one admin.' using errcode = 'check_violation';
    end if;
  end if;

  update public.profiles set is_admin = make_admin where user_id = target;
end;
$$;

revoke all on function public.set_admin(text, boolean) from public, anon;
grant execute on function public.set_admin(text, boolean) to authenticated;
