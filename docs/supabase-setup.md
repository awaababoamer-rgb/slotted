# Supabase setup for Slotted

One person on the team does this once. It takes about 15 minutes.
Supabase's dashboard changes now and then; if a button has moved, look for the same words nearby.

## 1. Create the project

1. Go to **supabase.com** → **Start your project** → sign in (GitHub sign-in is easiest).
2. Click **New project**.
   - **Name:** `slotted`
   - **Database password:** click **Generate a password** and save it in a password manager. Slotted itself never needs it.
   - **Region:** **Canada (Central)**
   - **Plan:** Free
3. Click **Create new project** and wait a minute or two until it's ready.

## 2. Create the tables and security rules

1. In the left sidebar, open **SQL Editor** → **New query**.
2. Open `supabase/migrations/20261116000000_slotted_setup.sql` from this repo, copy **all of its contents** (not the file name), and paste them into the editor.
3. Click **Run**. You should see "Success. No rows returned."
4. Check: **Table Editor** now lists `courses`, `sections`, `catalog_meta`, `saved_schedules`, with no red "Unrestricted" label.

## 3. Sign-in by email link (no passwords)

Students type their @uwo.ca email and get a one-time **sign-in link**. Supabase's built-in emails already send that link, so no email templates or custom sender are needed for testing.

1. **Authentication** → **Sign In / Providers**:
   - **Email**: enabled. **Confirm email**: ON.
   - **Allow new users to sign up**: ON.
   - **Allow anonymous sign-ins**: OFF. **Phone** and all other providers: OFF.
2. **Authentication** → **URL Configuration** (tells Supabase where the link should send people back to):
   - **Site URL:** `http://localhost:5173`
   - **Redirect URLs** → **Add URL**: `http://localhost:5173/**`
   - When the site is published, add its real address here too (e.g. `https://slotted.vercel.app/**`).
   - **Save**.

The @uwo.ca rule is enforced by the database (the SQL in step 2), so other addresses are rejected even if someone skips the website.

**Limits of Supabase's built-in email sender** (fine for testing, not for real students):
- It sends only a few emails per hour.
- It may only deliver to email addresses of your Supabase **team** members. If sign-in emails don't arrive, invite each tester's @uwo.ca address: **Organization settings** → **Team** → **Invite**.
- Western's uwo.ca mail (Outlook) may scan links before the student opens them, which can "use up" the one-time link. If students often see "link expired", switch to sign-in **codes** (below).

### Later: a custom email sender (needed for real students, or for sign-in codes)

Supabase only lets you edit email templates once you connect your own sender (SMTP). For the competition, a **team Gmail account** works (not anyone's personal one):

1. In that Gmail account: **myaccount.google.com** → **Security** → turn on **2-Step Verification**.
2. **myaccount.google.com/apppasswords** → name it `Supabase Slotted` → **Create**. Google shows a 16-letter **app password**. Never put it in git, a project file, or a chat. If it leaks, delete it there and make a new one.
3. Supabase: **Authentication** → **Emails** → **SMTP Settings** → **Enable custom SMTP**: sender email and username = the team Gmail address, sender name `Slotted`, host `smtp.gmail.com`, port `587`, password = the app password. **Save**.

Gmail allows ~500 emails/day. For a real launch, a sender like **Resend** with your own domain looks more official. Switching to codes also needs a small code change in `web/src/auth/SignIn.tsx` (git history has a code version).

## 4. Copy the keys into local files (never into git or chat)

**Project Settings** → **API Keys** (the project URL is under **Project Settings** → **Data API**, or the **Connect** button at the top).

| Value | Starts with | Goes in | Who needs it |
|---|---|---|---|
| Project URL | `https://….supabase.co` | `web/.env.local` and `.env` | everyone running the site; whoever uploads data |
| **Publishable** key | `sb_publishable_` | `web/.env.local` | everyone running the site |
| **Secret** key | `sb_secret_` | `.env` only | only whoever uploads course data |

- `web/.env.local`: copy from `web/.env.example`, fill in URL and publishable key.
- `.env` (top folder): copy from `.env.example`, fill in URL and secret key.
- Use the URL **without** `/rest/v1/` at the end.
- Save the files (Ctrl+S). In Windows 11 Notepad, a `*` or dot on the tab means not saved yet.
- Both files are git-ignored. **Never** put the secret key in `web/`, in git, or in a chat. If it leaks, delete it in **API Keys** and create a new one.
- Older projects show "anon" and "service_role" keys instead: anon = publishable, service_role = secret.

Share the URL and publishable key with teammates privately (e.g. a direct message), not in the repo.

## 5. Upload the course data

From the top project folder:

```
C:\Users\<you>\.venvs\slotted\Scripts\python.exe scraper\upload_to_supabase.py
```

Run it again after every scrape. Then restart the website (`npm.cmd run dev` in `web/`).
