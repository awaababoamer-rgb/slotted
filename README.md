# Slotted

Slotted is a course schedule planner for Western University (UWO) students, built by a small student team for a student competition.

> Slotted is an independent student project and is not affiliated with or endorsed by Western University.

Live site: https://slotted-planner.vercel.app

Students add the courses they need, and the app:
- shows their week as a timetable
- flags time conflicts
- suggests fixes (for example, moving a lab to a different section)
- lets them compare different conflict-free versions of their week
- shows a club events board with events that fit their schedule
- hosts course reviews

## Getting started

- **Python** (scrapers): create a virtual environment outside the project, e.g. `C:\Users\<you>\.venvs\slotted`, then `pip install -r scraper/requirements.txt` and run scripts with that environment's `python.exe`. The Draft My Schedule scripts use Microsoft Edge through Playwright (`channel="msedge"`).
- **Engine:** `cd engine`, `npm install`, `npm test`.
- **Website:** `cd web`, `npm install`, `npm run dev`, then open http://localhost:5173.
- If PowerShell says "running scripts is disabled on this system", use `npm.cmd` instead of `npm` (e.g. `npm.cmd run dev`). There's no need to change the execution policy.
- **Keys:** copy `web/.env.example` to `web/.env.local` (website) and `.env.example` to `.env` (upload scripts). See `docs/supabase-setup.md`.

## Folder map

| Folder | Purpose |
|---|---|
| `scraper/` | Python scrapers and upload scripts |
| `data/` | Scraper output (`courses.json`, git-ignored; uploaded to Supabase) |
| `engine/` | TypeScript schedule logic + tests |
| `web/` | React website |
| `supabase/` | Database schema (SQL migrations) and permission tests |
| `.github/workflows/` | Scheduled scraper + deploy automation |
| `docs/` | Notes, decisions, diagrams |
| `design/` | PNG exports of the team's Figma designs |

## Architecture

1. **Scraper** (`scraper/`, Python): pulls course data from Western's public undergraduate timetable into `data/courses.json`. A second, manually run script fills in meeting times from Draft My Schedule (see "Course data sources").
2. **Schedule engine** (`engine/`, TypeScript): takes course data as input (it never reads files) and does conflict checking, fix suggestions and ranking. Pure logic with no UI, so it is easy to test.
3. **Website** (`web/`): React + Vite + TypeScript + Tailwind. Uses the engine.
4. **Supabase** (`supabase/`, free plan): accounts, saved schedules, course data, clubs, events, reviews, programs and friends.
5. **Automation:** GitHub Actions (`.github/workflows/`) was meant to re-run the public scraper a few times a day. **On hold** because the public timetable now has a CAPTCHA (see below).
6. **Hosting:** Vercel, building from `main` with root directory `web`. The site URL must be listed in Supabase → URL Configuration.

## Course data sources

Western's **public timetable** (`studentservices.uwo.ca/secure/Timetables/mastertt/ttindex.cfm`) gives course code, title, term, section, component, class number, status and notes, but **no days, times, rooms or instructors**.

Those come from **Draft My Schedule (DMS)** (`draftmyschedule.uwo.ca`), which shows them to any logged-in student. Our competition allows using data that Western provides to all students. Sections are matched to `data/courses.json` by **class number**, and filled-in sections get `"data_source": "dms"`.

Rules for the DMS scripts:
- **The student logs in themselves.** Playwright opens a *visible* browser window, the student logs in by hand, and the script continues only after they confirm (by creating `.dms-logs/GO`). Never ask for, type or store a Western password.
- **Never commit session data.** Browser profiles, cookies, storage state and network logs live in git-ignored folders (see `.gitignore`).
- **Course section data only.** Collect times, days, rooms and instructors. Never collect anything from the student's personal account (their schedule, name, student number, enrolments).
- **Wait 2 seconds between requests.**
- **Run manually only.** Never on a schedule or in GitHub Actions.

### The public timetable has a CAPTCHA

During the first all-subjects run, after 8 subjects (2 s apart), the public timetable started returning a CAPTCHA page that says it was added to combat bot attacks. So:
- **Never solve, bypass or work around a CAPTCHA**, and don't try to dodge detection (slower requests, new IPs, different User-Agents).
- `public_timetable.py` stops at the first CAPTCHA and never overwrites `data/courses.json` with a much smaller result.
- The scheduled scraper is on hold until Western gives permission or a data feed. The CAPTCHA page lists a contact for questions.
- Because of this, `data/courses.json` has only some subjects (24 at the moment).

### Western's Academic Calendar: do not scrape

`westerncalendar.uwo.ca/robots.txt` blocks crawlers from the whole site, so it is never scraped. Program requirements are entered by the team by hand, imported from program pages a student browses in DMS (see "Programs"), or come from Western directly if they provide a feed.

### Which subjects have times

The DMS script is run only for these 16 subjects, to keep the number of logged-in requests small:
BIOLOGY, CHEM, PHYSICS, MATH, CALCULUS, STATS, COMPSCI, PSYCHOL, ECONOMIC, SOCIOLOG, PHILOSOP, WRITING, HEALTSCI, KINESIOL, BIOCHEM, PHYSIOL.

Most other courses have **no times**, and the engine and website handle that.

### Showing sections without times

| `data_source` | `meetings` | Show | Conflict checking |
|---|---|---|---|
| `"public"` | `[]` | **"Times not available yet"** | Skipped; the student is told it wasn't checked |
| `"dms"` | `[]` | **"Online – no fixed meeting time"** | Never conflicts |
| `"dms"` | not empty | The days/times on the calendar | Checked normally |

"No times" is never silently treated as "no conflict". Courses that can't be drawn on the week grid (online, other term, no times) are listed above and below the grid.

## Supabase

Setup steps (dashboard clicks, keys, email templates): **`docs/supabase-setup.md`**. Schema: `supabase/migrations/`. Permission tests: `supabase/tests/permissions_test.sql` (run in the SQL editor as the default postgres role; rolls itself back).

- **Sign-in:** a 6-digit one-time code emailed to the student, no passwords. Emails go through Brevo (custom SMTP). Codes are used instead of links because Outlook's link scanner uses up one-time links. **Only university email domains on the allowed list** can sign up, enforced by a database trigger on `auth.users`. The sign-in screen is Slotted's own design and never looks like Western's login page. Slotted never asks for a Western password.
- **Who can sign in:** students from any school in `allowed_email_domains` (Western plus Ontario universities), with full access. Admins edit the list on the Admin page; Western can't be removed.
- **Course data needs sign-in.** Tables `courses`, `sections` and `catalog_meta` are readable only by signed-in users; signed-out visitors have no access. Only the upload script (secret key) can write. The website never bundles course data; it loads it in `web/src/data/catalog.ts` after sign-in.
- **`data/courses.json` is never committed.** After each scrape, run `scraper/upload_to_supabase.py`.
- **Saved schedules:** table `saved_schedules` with named plans ("Plan A"). Each student can only read and change their own rows.
- **Keys:** `web/.env.local` has the URL and the **publishable** key (safe in a browser because of row-level security). The **secret** key lives only in the top-level `.env` for the upload scripts and must never be in `web/`, in git, or shared. Both files are git-ignored.
- **Engine tests** read `data/courses.json` locally, so teammates without that file can't run them yet.

## Clubs, events and reviews

- **Admins:** `profiles.is_admin`, set in the SQL editor or by another admin on the Admin page.
- **Clubs:** students request (`status` forced to `pending`); admins approve/reject; approval makes the requester a club exec. Only execs of approved clubs can manage that club's events. Students see events of approved clubs only.
- **`my_events`:** events a student added to their week.
- **Reviews:** one per student per course per term, anonymous to other students (`reviews_public` has no `user_id`). Averages in `course_ratings` and `professor_ratings`. Reports are moderated by admins.
- **Rate My Professors:** never imported (no API, and their terms forbid scraping). Only a "See on RateMyProfessors" search link.
- **Event filtering** ("Fits" / "Join late" / hidden) lives in the engine so it can be unit-tested. Events never count as conflicts.
- **Event media:** Supabase Storage bucket `event-media` (25 MB max, photos/videos, at most 4 photos + 1 video per event).
- All permissions are enforced by row-level security; hiding buttons is only a convenience.

## Schedule engine rules

- **Terms:** first and second term never conflict. Full-year courses conflict with both. Y/Z courses (term unknown) are treated as conflicting with both.
- **Strict rules:** locked sections never change, and "only move labs and tutorials" never moves a lecture.
- **Soft preferences** (ranking only): earliest start, light day, minimize gaps, lunch hour, labs on the same day as their lecture.
- **Avoided sections:** full and overflow/reserved sections are used only when nothing else works, and are always flagged.
- **Fixes:** at most 3 changes per fix, and the top 3 must differ in which components they move.
- **Result cap:** `generateSchedules` groups same-time sections and returns the best schedules up to a limit, with a `truncated` flag.

### Course recommender ("Find courses")

`engine/src/recommend.ts`: `fitCourse` finds the best conflict-free sections of a course around the current week; `findFittingCourses` checks the catalog for a term; `rankCourses` sorts by added schedule cost minus a review bonus. Reviews use a Bayesian average (pulled toward 3/5 with weight 3). Prerequisites and breadth are not checked.

### Known limitations

- **Lecture–lab pairing is not modelled.** Any lecture can go with any lab or tutorial of the same course.
- **"Alternates with" sections** (meeting every other week) are treated as meeting every week.
- **Courses numbered below 1000** are missing from the data.
- **Campus travel time** (Main, King's, Huron) is ignored for now.

## Features

- **Builder, Smart Resolve, Compare, Priorities:** the main planner screens.
- **Programs:** optional "Pick a program" page with required and "choose N from" groups. Every course has a checkbox (required ones start ticked), then "Add to my week". Students only see published programs. Programs can be entered by admins on the Admin page, or imported: a student browses program pages in DMS while `scraper/dms_investigate.py` records (keeping only the program section, with personal details removed, in git-ignored `.dms-logs/`), then `scraper/import_programs.py --upload` adds them as unpublished drafts for admins to check. A course offered in either term ("2208A/B") is stored as `"COMPSCI 2208A|COMPSCI 2208B"`, and the page adds the version that fits the student's week.
- **Ask Slotted (chat assistant):** a chat window on every page, powered by Google Gemini. The Gemini key lives only in a Supabase Edge Function (`supabase/functions/chat`, secrets `GEMINI_API_KEY` and `GEMINI_MODEL` (gemini-3.1-flash-lite: about 1 s per step; gemini-3.5-flash was far slower on the free tier)), never in the website, and only signed-in users can call it. The bot can't read the database: it asks the website to run tools (`web/src/lib/chatTools.ts`: search courses, course details, courses that fit your week via the engine), so facts come from our data. Schedule changes are only proposed; the student confirms with a button. It sees the student's courses and priorities, never their name or email. To redeploy: put `SUPABASE_ACCESS_TOKEN` in `.env`, then `npx supabase functions deploy chat --remote=<project ref> --use-api`.
- **Calendar export:** .ics download of a term's classes and added club events.
- **Friends:** add by 8-character friend code; timetable sharing is opt-in. "Courses together" finds courses with the same sections free for both.

## Team guidelines

1. **Keep it simple.** Explain changes in plain language so everyone on the team can follow.
2. **Work in small steps.** One change at a time.
3. **Run and test code after writing it.** Say honestly if something failed.
4. **Never commit passwords or keys.** Secrets go in `.env` files or GitHub Secrets. Only the Supabase publishable key may be used in the website.
5. **Keep scraping polite.** Clear User-Agent, delays between requests, cache results, respect robots.txt and Western's terms.
6. **Never imitate Western's branding or login pages.** No Western logos or official colours, and never ask users for their Western credentials.
