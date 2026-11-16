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
2. Open `supabase/migrations/20261116000000_slotted_setup.sql` from this repo, copy **all** of it, and paste it into the editor.
3. Click **Run**. You should see "Success. No rows returned."
4. Check: **Table Editor** now lists `courses`, `sections`, `catalog_meta`, `saved_schedules`, each with a "RLS enabled" label (no "unrestricted" warning).

## 3. Turn on email-code sign-in (no passwords)

1. **Authentication** → **Sign In / Providers**:
   - **Email**: enabled. **Confirm email**: ON.
   - **Allow new users to sign up**: ON.
   - **Allow anonymous sign-ins**: OFF. **Phone** and all other providers: OFF.
2. **Authentication** → **Emails** → **Templates**. Edit **both** "Confirm signup" and "Magic Link" so they send a code instead of a link:
   - **Subject:** `Your Slotted sign-in code`
   - **Body:**
     ```html
     <h2>Your Slotted sign-in code</h2>
     <p>Enter this code in Slotted to sign in:</p>
     <p style="font-size:28px;font-weight:bold;letter-spacing:4px">{{ .Token }}</p>
     <p>If you didn't ask for this, you can ignore this email.</p>
     ```
   - Click **Save** on each.
3. **Email sending limits.** Supabase's built-in email service is only for testing: it sends just a few emails per hour, and may only send to the email addresses of your project's team members (the dashboard shows a warning if so). For testing, invite each teammate's @uwo.ca address to your Supabase organization (**Organization settings** → **Team** → **Invite**). Before real students use Slotted, set up a free custom email sender under **Authentication** → **Emails** → **SMTP Settings** (for example Resend).

The @uwo.ca rule is enforced by the database (the SQL in step 2), so other addresses are rejected even if someone skips the website.

## 4. Copy the keys into local files (never into git or chat)

**Project Settings** → **API Keys** (the project URL is under **Project Settings** → **Data API**, or the **Connect** button at the top).

| Value | Starts with | Goes in | Who needs it |
|---|---|---|---|
| Project URL | `https://….supabase.co` | `web/.env.local` and `.env` | everyone running the site; whoever uploads data |
| **Publishable** key | `sb_publishable_` | `web/.env.local` | everyone running the site |
| **Secret** key | `sb_secret_` | `.env` only | only whoever uploads course data |

- `web/.env.local`: copy from `web/.env.example`, fill in URL and publishable key.
- `.env` (top folder): copy from `.env.example`, fill in URL and secret key.
- Both files are git-ignored. **Never** put the secret key in `web/`, in git, or in a chat. If it leaks, delete it in **API Keys** and create a new one.
- Older projects show "anon" and "service_role" keys instead: anon = publishable, service_role = secret.

Share the URL and publishable key with teammates privately (e.g. a direct message), not in the repo.

## 5. Upload the course data

From the top project folder:

```
C:\Users\<you>\.venvs\slotted\Scripts\python.exe scraper\upload_to_supabase.py
```

Run it again after every scrape. Then restart the website (`npm.cmd run dev` in `web/`).
