-- Permission tests: run this in the Supabase SQL Editor AFTER the migrations.
-- It pretends to be two students (Alice and Bob) and an admin, tries things
-- they should and shouldn't be able to do, and prints PASS/FAIL for each.
-- Everything happens inside a transaction that is rolled back: no data is kept.

begin;

-- Pretend accounts (exist only inside this transaction).
insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at)
values
  ('00000000-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'alice-test@uwo.ca', '', now(), now(), now()),
  ('00000000-0000-0000-0000-00000000000b', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'bob-test@uwo.ca', '', now(), now(), now()),
  ('00000000-0000-0000-0000-00000000000c', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'admin-test@uwo.ca', '', now(), now(), now());
update public.profiles set is_admin = true where user_id = '00000000-0000-0000-0000-00000000000c';

create temp table pg_temp.results (n serial, test text, outcome text);
-- The pretend students must be allowed to write to the scoreboard.
grant insert, select on pg_temp.results to authenticated;
grant usage on sequence pg_temp.results_n_seq to authenticated;

-- Helper: become a user (the way Supabase's API does it).
create or replace function pg_temp.become(uid text) returns void language plpgsql as $$
begin
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claim.sub', uid, true);
  perform set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated')::text, true);
end $$;

create or replace function pg_temp.check(name text, expected_ok boolean, sql text) returns void language plpgsql as $$
declare ok boolean := true;
begin
  begin
    execute sql;
  exception when others then
    ok := false;
  end;
  insert into pg_temp.results (test, outcome)
  values (name, case when ok = expected_ok then 'PASS' else 'FAIL (' || case when ok then 'was allowed' else 'was blocked' end || ')' end);
end $$;

-- A helper that fails if a SELECT returns no rows (so "can't see it" can be tested).
create or replace function pg_temp.check_rows(name text, expected_rows int, sql text) returns void language plpgsql as $$
declare n int;
begin
  -- "with" works for both plain selects and update/delete ... returning.
  execute 'with q as (' || sql || ') select count(*) from q' into n;
  insert into pg_temp.results (test, outcome)
  values (name, case when n = expected_rows then 'PASS' else 'FAIL (got ' || n || ' rows, expected ' || expected_rows || ')' end);
end $$;

-- ---------- Alice requests a club ----------
select pg_temp.become('00000000-0000-0000-0000-00000000000a');
select pg_temp.check('Alice can request a club', true,
  $q$ insert into public.clubs (name, description, category, requester_role) values ('Test Robotics Club', 'd', 'academic', 'President') $q$);
select pg_temp.check_rows('Alice''s request is pending, not approved (trigger)', 1,
  $q$ select 1 from public.clubs where name = 'Test Robotics Club' and status = 'pending' $q$);
select pg_temp.check('Alice cannot approve her own club', false,
  $q$ update public.clubs set status = 'approved' where name = 'Test Robotics Club' $q$);
select pg_temp.check('Alice cannot post an event for an unapproved club', false,
  $q$ insert into public.events (club_id, title, category, event_date, start_time, end_time)
      select id, 'Kickoff', 'social', current_date, '15:00', '17:00' from public.clubs where name = 'Test Robotics Club' $q$);

-- ---------- Bob can't see Alice's pending request ----------
select pg_temp.become('00000000-0000-0000-0000-00000000000b');
select pg_temp.check_rows('Bob cannot see Alice''s pending request', 0,
  $q$ select 1 from public.clubs where name = 'Test Robotics Club' $q$);

-- ---------- Admin approves ----------
select pg_temp.become('00000000-0000-0000-0000-00000000000c');
select pg_temp.check_rows('Admin can see the pending request', 1,
  $q$ select 1 from public.clubs where name = 'Test Robotics Club' $q$);
select pg_temp.check('Admin can approve the club', true,
  $q$ update public.clubs set status = 'approved', review_note = 'ok' where name = 'Test Robotics Club' $q$);
select pg_temp.check_rows('Approval made Alice an exec (trigger)', 1,
  $q$ select 1 from public.club_execs e join public.clubs c on c.id = e.club_id
      where c.name = 'Test Robotics Club' and e.user_id = '00000000-0000-0000-0000-00000000000a' $q$);

-- ---------- Events: exec vs non-exec ----------
select pg_temp.become('00000000-0000-0000-0000-00000000000a');
select pg_temp.check('Alice (exec) can post an event', true,
  $q$ insert into public.events (club_id, title, category, event_date, start_time, end_time)
      select id, 'Kickoff', 'social', current_date, '15:00', '17:00' from public.clubs where name = 'Test Robotics Club' $q$);
select pg_temp.check('Event with end before start is rejected', false,
  $q$ insert into public.events (club_id, title, category, event_date, start_time, end_time)
      select id, 'Bad', 'social', current_date, '17:00', '15:00' from public.clubs where name = 'Test Robotics Club' $q$);

select pg_temp.become('00000000-0000-0000-0000-00000000000b');
select pg_temp.check_rows('Bob can see the approved club''s event', 1,
  $q$ select 1 from public.events where title = 'Kickoff' $q$);
select pg_temp.check('Bob (not an exec) cannot post an event', false,
  $q$ insert into public.events (club_id, title, category, event_date, start_time, end_time)
      select id, 'Bob''s party', 'social', current_date, '15:00', '17:00' from public.clubs where name = 'Test Robotics Club' $q$);
select pg_temp.check_rows('Bob cannot edit Alice''s event (0 rows changed)', 0,
  $q$ update public.events set title = 'Hijacked' where title = 'Kickoff' returning 1 $q$);
select pg_temp.check_rows('Bob cannot delete Alice''s event (0 rows deleted)', 0,
  $q$ delete from public.events where title = 'Kickoff' returning 1 $q$);
select pg_temp.check('Bob can add the event to his week', true,
  $q$ insert into public.my_events (event_id) select id from public.events where title = 'Kickoff' $q$);
select pg_temp.check('Bob cannot add an event to Alice''s week', false,
  $q$ insert into public.my_events (user_id, event_id) select '00000000-0000-0000-0000-00000000000a', id from public.events where title = 'Kickoff' $q$);

-- ---------- Reviews ----------
select pg_temp.become('00000000-0000-0000-0000-00000000000a');
select pg_temp.check('Alice can post a review', true,
  $q$ insert into public.reviews (course_code, professor, term_taken, overall, difficulty, workload, would_take_again, comment)
      values ('COMPSCI 1020A', 'M. Mollahajiaghaei', 'Fall 2025', 5, 3, 3, true, 'Great') $q$);
select pg_temp.check('Alice cannot post a second review for the same course and term', false,
  $q$ insert into public.reviews (course_code, professor, term_taken, overall, difficulty, workload, would_take_again, comment)
      values ('COMPSCI 1020A', 'M. Mollahajiaghaei', 'Fall 2025', 1, 1, 1, false, 'Again') $q$);
select pg_temp.check('A rating of 6 is rejected', false,
  $q$ insert into public.reviews (course_code, professor, term_taken, overall, difficulty, workload, would_take_again)
      values ('COMPSCI 1020A', 'X', 'Winter 2026', 6, 3, 3, true) $q$);
select pg_temp.check('Students cannot read the reviews table directly (author hidden)', false,
  $q$ select user_id from public.reviews $q$);
select pg_temp.check_rows('Alice can edit her own review (1 row changed)', 1,
  $q$ update public.reviews set comment = 'Great' where comment = 'Great' returning 1 $q$);
select pg_temp.check_rows('Alice sees her review as hers in the anonymous view', 1,
  $q$ select 1 from public.reviews_public where comment = 'Great' and is_mine $q$);

select pg_temp.become('00000000-0000-0000-0000-00000000000b');
select pg_temp.check_rows('Bob sees Alice''s review but not as his', 1,
  $q$ select 1 from public.reviews_public where comment = 'Great' and not is_mine $q$);
select pg_temp.check_rows('Bob cannot edit Alice''s review (0 rows changed)', 0,
  $q$ update public.reviews set comment = 'Hacked' where comment = 'Great' returning 1 $q$);
select pg_temp.check_rows('Bob cannot delete Alice''s review (0 rows deleted)', 0,
  $q$ delete from public.reviews where comment = 'Great' returning 1 $q$);
select pg_temp.check('Bob can report Alice''s review', true,
  $q$ insert into public.review_reports (review_id, reason) select id, 'rude' from public.reviews_public where comment = 'Great' $q$);
select pg_temp.check_rows('Course average is visible', 1,
  $q$ select 1 from public.course_ratings where course_code = 'COMPSCI 1020A' and review_count = 1 $q$);

select pg_temp.become('00000000-0000-0000-0000-00000000000c');
select pg_temp.check_rows('Admin sees the report', 1,
  $q$ select 1 from public.review_reports where reason = 'rude' $q$);
select pg_temp.check_rows('Admin can remove the reported review', 1,
  $q$ delete from public.reviews where comment = 'Great' returning 1 $q$);

-- ---------- Profiles ----------
select pg_temp.become('00000000-0000-0000-0000-00000000000b');
select pg_temp.check('Bob cannot make himself admin', false,
  $q$ update public.profiles set is_admin = true where user_id = '00000000-0000-0000-0000-00000000000b' $q$);
select pg_temp.check_rows('Bob cannot see other profiles', 1,
  $q$ select 1 from public.profiles $q$);

-- ---------- Managing admins ----------
select pg_temp.become('00000000-0000-0000-0000-00000000000b');
select pg_temp.check('Bob (not admin) cannot make himself admin via set_admin', false,
  $q$ select public.set_admin('bob-test@uwo.ca', true) $q$);

select pg_temp.become('00000000-0000-0000-0000-00000000000c');
select pg_temp.check('Admin can make Bob an admin', true,
  $q$ select public.set_admin('bob-test@uwo.ca', true) $q$);
select pg_temp.check_rows('Bob is now an admin', 1,
  $q$ select 1 from public.profiles where email = 'bob-test@uwo.ca' and is_admin $q$);
select pg_temp.check('Admin cannot remove their own admin access', false,
  $q$ select public.set_admin('admin-test@uwo.ca', false) $q$);
select pg_temp.check('Unknown email is rejected', false,
  $q$ select public.set_admin('nobody-here@uwo.ca', true) $q$);
select pg_temp.check('Admin can remove Bob''s admin access', true,
  $q$ select public.set_admin('bob-test@uwo.ca', false) $q$);
select pg_temp.check_rows('Bob is no longer an admin', 1,
  $q$ select 1 from public.profiles where email = 'bob-test@uwo.ca' and not is_admin $q$);

-- ---------- Results ----------
reset role;
-- The editor shows the LAST result: one line per test, failures first.
select case when outcome = 'PASS' then 'PASS  ' else 'FAIL  ' end || test ||
       case when outcome = 'PASS' then '' else '  -> ' || outcome end as result
from pg_temp.results order by (outcome = 'PASS'), n;

rollback;  -- throw away every test row
