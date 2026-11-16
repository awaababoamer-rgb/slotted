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

## 3. Sign-in by emailed code (no passwords)

Students type their @uwo.ca email, get a **6-digit code** by email, and type it into Slotted.
We use codes, not links, because Western's Outlook scans links before students click them, which "uses up" one-time links.

### 3a. Connect an email sender (Brevo, free)

Supabase's built-in email sender only sends ~2 emails per hour and won't let you edit the email text, so connect your own:

1. Sign up at **brevo.com** with the team address (`slotted.team@gmail.com`).
2. **Senders & IP** → **Senders** → add `slotted.team@gmail.com` and confirm it from the email Brevo sends.
3. **SMTP & API** → **SMTP**: note the server (`smtp-relay.brevo.com`), port (`587`) and **login**, and **generate an SMTP key**.
   The SMTP key is a password: never put it in git, a project file, or a chat.
4. Supabase: **Authentication** → **Emails** → **SMTP Settings** → **Enable custom SMTP**:
   host `smtp-relay.brevo.com`, port `587`, username = the Brevo **login**, password = the **SMTP key**,
   sender email `slotted.team@gmail.com`, sender name `Slotted` → **Save**. Wait ~2 minutes before testing.
5. **Authentication** → **Rate Limits** → raise **emails sent per hour** (e.g. 100). Brevo's free plan allows 300/day.

(Gmail SMTP also works, but needs 2-Step Verification and an "app password", which new Google accounts may not offer.)

### 3b. Sign-in settings and email templates

1. **Authentication** → **Sign In / Providers**: **Email** enabled, **Confirm email** ON, **Allow new users to sign up** ON,
   **anonymous sign-ins** OFF, **Phone** and all other providers OFF.
2. **Authentication** → **Emails** → **Templates**: edit **both** "Confirm signup" and "Magic Link":
   - **Subject:** `Your Slotted sign-in code`
   - **Body:**
     ```html
     <h2>Your Slotted sign-in code</h2>
     <p>Enter this code in Slotted to sign in:</p>
     <p style="font-size:28px;font-weight:bold;letter-spacing:4px">{{ .Token }}</p>
     <p>If you didn't ask for this, you can ignore this email.</p>
     ```
   - **Save** each. `{{ .Token }}` is where the code goes. (New users get "Confirm signup"; returning users get "Magic Link".)
3. **Authentication** → **URL Configuration** → **Site URL**: the published address (e.g. `https://slotted-planner.vercel.app`).
   Codes don't use redirects, but this keeps any Supabase email pointing at the real site, not `localhost`.

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
