# Command-by-Command Setup Guide (Windows / PowerShell)

Run these **one at a time**, in order. After each one, check the "Expected
output" — if what you see doesn't roughly match, stop and paste it back
before continuing to the next command.

This assumes: you're on Windows, using **PowerShell** (not Git Bash / WSL —
if you're actually using one of those, say so, since a few commands below
differ), and you have the `return-prime-clone` folder unzipped somewhere,
e.g. `C:\Users\<you>\Projects\return-prime-clone`.

---

## PART A — Check your tools are installed

### A1. Check Node.js

```powershell
node --version
```
**Expected:** `v18.20.x`, `v20.x.x`, or `v22.x.x` (anything ≥18.20).

**If you get** `node : The term 'node' is not recognized...` → Node isn't
installed. Download the LTS installer from **nodejs.org**, run it, **close
and reopen PowerShell**, then retry.

### A2. Check npm

```powershell
npm --version
```
**Expected:** a version number like `10.x.x`. This comes bundled with
Node, so if A1 worked, this should too.

### A3. Check Git

```powershell
git --version
```
**Expected:** `git version 2.x.x`.

**If not recognized:** install from **git-scm.com/download/win**, accept
the defaults during install, reopen PowerShell, retry.

### A4. Check/install the Shopify CLI

```powershell
npm install -g @shopify/cli
```
Then:
```powershell
shopify version
```
**Expected:** a version number.

**If `npm install -g` fails with an EACCES/permission error** on Windows,
run PowerShell **as Administrator** (right-click PowerShell → Run as
Administrator) and retry the install command.

### A5. Install the Vercel CLI

```powershell
npm install -g vercel
```
```powershell
vercel --version
```
**Expected:** a version number like `Vercel CLI 37.x.x`.

---

## PART B — Git: get the project into a repo

Open PowerShell **inside the project folder**:

```powershell
cd C:\Users\<you>\Projects\return-prime-clone
```
(replace the path with wherever you unzipped it — you can also just type
`cd ` with a trailing space, then drag the folder into the PowerShell
window, then press Enter)

### B1. Initialize git

```powershell
git init
```
**Expected:** `Initialized empty Git repository in C:/.../return-prime-clone/.git/`

### B2. Configure your identity (skip if you've already done this on this PC before)

```powershell
git config --global user.name "Your Name"
git config --global user.email "you@example.com"
```
No output means it worked.

### B3. Stage all files

```powershell
git add .
```
No output means it worked. To double check what's staged:
```powershell
git status
```
**Expected:** a list of files in green under "Changes to be committed" —
should include `app/`, `prisma/`, `package.json`, etc. `node_modules`
should **not** appear (it's excluded by `.gitignore`, and doesn't exist
yet anyway since we haven't run `npm install`).

### B4. First commit

```powershell
git commit -m "Initial commit: returns, exchange, cancellation, RTO, replacement app"
```
**Expected:** a summary line like `X files changed, Y insertions(+)`.

### B5. Create the GitHub repo

Go to **github.com/new** in your browser:
- Repository name: e.g. `return-prime-clone`
- **Do not** check "Add a README" or ".gitignore" (you already have
  these — checking them causes a conflict in the next step)
- Click **Create repository**
- GitHub will show you a page with commands — **ignore those**, use the
  ones below instead (yours already has commits)

### B6. Connect your local repo to GitHub

```powershell
git remote add origin https://github.com/<your-username>/<your-repo>.git
```
Replace `<your-username>` and `<your-repo>` with your actual values. No
output means it worked. Verify:
```powershell
git remote -v
```
**Expected:** two lines showing `origin` with your GitHub URL (fetch and push).

### B7. Push

```powershell
git branch -M main
git push -u origin main
```
**First time only:** a browser window may pop up asking you to log into
GitHub — sign in and authorize. After that, expect output ending in
something like:
```
branch 'main' set up to track 'origin/main'.
```

**Possible errors:**

| Error | Fix |
|---|---|
| `remote: Repository not found` | Typo in the URL from B6, or the repo is private and you're not authenticated — re-check the URL matches exactly what GitHub shows you |
| `fatal: Authentication failed` | Your GitHub credentials/token expired — a browser login prompt should appear; if not, run `git push` again |
| `error: failed to push some refs` + mentions "fetch first" | Only happens if you *did* let GitHub create a README — go to GitHub, delete the repo, recreate it **without** the README/gitignore checkboxes, then redo B6–B7 |

From now on, whenever you make changes, it's just:
```powershell
git add .
git commit -m "describe what changed"
git push
```

---

## PART C — Database: create Postgres on Neon (or Supabase) and get connection strings

Pick **one**. Steps below are for Neon; Supabase equivalent is noted after.

### C1. Create the Neon project

1. Go to **neon.tech**, sign up/log in.
2. Click **New Project**. Name it (e.g. `returns-app-db`), pick a region,
   click **Create project**.
3. You'll land on a page showing a **Connection string**. Click the
   dropdown that says **Pooled connection** (or a toggle) — you need
   **both** the pooled and direct versions. Look for a host containing
   `-pooler` (pooled) vs. one without it (direct).

4. Copy both — you'll paste them in Part D. They look like:
   ```
   postgresql://neondb_owner:AbC123@ep-cool-forest-12345-pooler.us-east-2.aws.neon.tech/neondb?sslmode=require
   postgresql://neondb_owner:AbC123@ep-cool-forest-12345.us-east-2.aws.neon.tech/neondb?sslmode=require
   ```
   (first = pooled = `DATABASE_URL`, second = direct = `DIRECT_URL`)

**Supabase equivalent:** New project at **supabase.com** → set a DB
password → **Project Settings → Database → Connection string** → copy
**Connection pooling** (port `6543`, append `?pgbouncer=true` if missing)
as `DATABASE_URL`, and **direct connection** (port `5432`) as `DIRECT_URL`.

---

## PART D — Install dependencies and run the SQL migration locally

Back in PowerShell, still inside `return-prime-clone`:

### D1. Install packages

```powershell
npm install
```
This takes a minute or two. **Expected:** ends with something like
`added 800 packages in 45s`, no red "error" lines (warnings in yellow are
fine).

**Possible errors:**

| Error | Fix |
|---|---|
| `npm ERR! code ERESOLVE` | Peer dependency conflict — run `npm install --legacy-peer-deps` instead |
| `npm ERR! network` | Check your internet connection / VPN / firewall, retry |

### D2. Create your local `.env` file

```powershell
Copy-Item .env.example .env
```
(This is the PowerShell equivalent of `cp` — `Copy-Item` is the real
command name; `cp` also works in PowerShell as an alias, either is fine.)

### D3. Open `.env` and fill it in

```powershell
notepad .env
```
This opens Notepad. Fill in the values you have so far:
```
SHOPIFY_API_KEY=<from Partner Dashboard, once you've created the app>
SHOPIFY_API_SECRET=<from Partner Dashboard>
SCOPES=read_orders,write_orders,read_products,write_draft_orders,read_customers,read_fulfillments,write_inventory
SHOPIFY_APP_URL=
DATABASE_URL=<pooled connection string from Part C>
DIRECT_URL=<direct connection string from Part C>
```
Save (Ctrl+S) and close Notepad.

### D4. Set environment variables for this PowerShell session

Prisma reads `.env` automatically for most commands, but to be safe (and
because this is the step people most often get wrong on Windows), also
set them directly in the session before running migrate:

```powershell
$env:DATABASE_URL = "<paste your DIRECT connection string here>"
$env:DIRECT_URL = "<paste the same direct connection string here>"
```

Note the PowerShell syntax: `$env:VARNAME = "value"` — **not**
`export VARNAME=value` (that's bash syntax and won't work in PowerShell).

Use the **direct** (non-pooled) URL for both here — migrations need a
real session, not a pooled one.

### D5. Run the SQL migration

```powershell
npx prisma migrate dev --name init
```

This is the actual SQL step: Prisma reads `prisma/schema.prisma`,
generates the SQL `CREATE TABLE` statements for every model (`Shop`,
`AutomationRule`, `ReturnRequest`, `ReturnLineItem`, `CancellationRequest`,
`RTOShipment`, `ReplacementOrder`, `ReplacementLineItem`, `Session`), and
runs them against your Neon/Supabase database.

**Expected output**, roughly:
```
Environment variables loaded from .env
Prisma schema loaded from prisma\schema.prisma
Datasource "db": PostgreSQL database "neondb", schema "public" at "ep-...neon.tech"

Applying migration `20250115120000_init`

The following migration(s) have been created and applied from new schema changes:

migrations/
  └─ 20250115120000_init/
    └─ migration.sql

Your database is now in sync with your schema.

✔ Generated Prisma Client
```

**Possible errors:**

| Error | Fix |
|---|---|
| `Error: P1001: Can't reach database server` | Wrong connection string, or you copied the pooled one instead of direct, or a typo/missing character when pasting. Re-copy from Neon/Supabase exactly. |
| `Error: P1000: Authentication failed` | Wrong password in the connection string — usually means you edited/retyped it instead of copy-pasting the whole string |
| `Environment variable not found: DATABASE_URL` | D4 wasn't run in the same PowerShell window you're now running D5 in — `$env:` variables only last for the current window. Re-run D4 then D5 in the same window, or make sure `.env` (from D3) is filled in correctly since Prisma also reads that file directly |
| It hangs for a long time then times out | Usually a firewall/VPN blocking the outbound Postgres port — try a different network, or check Neon/Supabase's dashboard shows the project as "active" not "sleeping" (free-tier databases can idle) |

### D6. Verify the tables were created (optional but reassuring)

```powershell
npx prisma studio
```
This opens a browser tab at `localhost:5555` showing every table as a
spreadsheet-like UI — empty rows, but you should see all 9 tables listed
on the left. Close the PowerShell window (or Ctrl+C in it) when done to
stop it.

### D7. Commit the migration file

The SQL migration Prisma just generated needs to be pushed to GitHub so
Vercel can apply it too:

```powershell
git add prisma/migrations
git commit -m "Add initial Postgres migration"
git push
```

---

## PART E — Vercel: create and deploy the project

You can do this via the **website** (simplest) or the **CLI** (if you
want everything scriptable from PowerShell). Both are shown — pick one.

### E — Option 1: Vercel website (recommended, fewer surprises)

1. Go to **vercel.com**, sign in (GitHub login is easiest, since it also
   grants repo access automatically).
2. **Add New… → Project**.
3. Find `<your-repo>` in the list (if it's not there, click **Adjust
   GitHub App Permissions** and grant access to it) → **Import**.
4. Vercel should detect **Framework Preset: Remix** automatically (there's
   a `vercel.json` in the repo that pins this). If it shows something
   else, manually change the Framework Preset dropdown to **Remix**.
5. Expand **Environment Variables** and add these one at a time (Name /
   Value pairs):

   ```
   SHOPIFY_API_KEY       = <from Partner Dashboard>
   SHOPIFY_API_SECRET    = <from Partner Dashboard>
   SCOPES                = read_orders,write_orders,read_products,write_draft_orders,read_customers,read_fulfillments,write_inventory
   SHOPIFY_APP_URL       = https://placeholder.vercel.app
   DATABASE_URL          = <pooled connection string>
   DIRECT_URL             = <direct connection string>
   ```
   (`SHOPIFY_APP_URL` is a placeholder for now — you'll fix it in E4 once
   you know your real Vercel URL.)

6. Click **Deploy**.

**Expected:** a build log streams in the browser, ending in "Congratulations!
Your project has been successfully deployed" with a preview screenshot.

**Possible errors during build (shown in the Vercel log):**

| Error in log | Fix |
|---|---|
| `Error: P1001: Can't reach database server` during `prisma migrate deploy` | `DIRECT_URL` env var is missing or wrong in Vercel's settings — go to Project → Settings → Environment Variables, fix it, then **Deployments → ⋯ → Redeploy** |
| `No migration found` / `Database schema is not empty` | You skipped Part D (the migration must be generated locally and committed **before** Vercel can apply it) |
| `Module not found: @vercel/remix` | `npm install` wasn't run cleanly locally before committing, or `package.json`/`package-lock.json` are out of sync — locally run `npm install` again, commit `package-lock.json` if it changed, push |
| Build succeeds but visiting the URL shows a blank page or 500 | Usually `SHOPIFY_API_KEY`/`SHOPIFY_API_SECRET` missing or wrong — double check Environment Variables, redeploy |

### E4. Fix the placeholder URL

Once deployed, copy your real URL from the top of the Vercel project page,
e.g. `https://return-prime-clone.vercel.app`.

Go to **Settings → Environment Variables**, edit `SHOPIFY_APP_URL` to this
real value, save, then **Deployments → (latest) → ⋯ → Redeploy**.

---

### E — Option 2: Vercel CLI (from PowerShell)

If you'd rather do it from the terminal:

```powershell
vercel login
```
Follow the prompt (opens a browser to confirm).

```powershell
vercel link
```
Answer the prompts: "Set up and deploy?" → **Y** first time creates it;
if it already exists on Vercel, choose "link to existing project".

Add each environment variable (you'll be prompted to paste the value,
then choose which environments — select **Production**):
```powershell
vercel env add SHOPIFY_API_KEY
vercel env add SHOPIFY_API_SECRET
vercel env add SCOPES
vercel env add SHOPIFY_APP_URL
vercel env add DATABASE_URL
vercel env add DIRECT_URL
```

Deploy to production:
```powershell
vercel --prod
```
**Expected:** ends with a line like
`✅ Production: https://return-prime-clone.vercel.app`

Same error table as Option 1 applies — the CLI just streams the same
build log into your PowerShell window instead of the browser.

---

## PART F — Connect the Shopify app to your live URL

Back in PowerShell, in the project folder:

### F1. Edit `shopify.app.toml`

```powershell
notepad shopify.app.toml
```
Update:
```toml
client_id = "<your Client ID from Partner Dashboard>"
application_url = "https://<your-real-vercel-url>"
```
and inside `[auth]`:
```toml
redirect_urls = [
  "https://<your-real-vercel-url>/auth/callback",
  "https://<your-real-vercel-url>/auth/shopify/callback",
  "https://<your-real-vercel-url>/api/auth/callback"
]
```
and inside `[app_proxy]`:
```toml
url = "https://<your-real-vercel-url>/proxy"
```
Save, close Notepad.

### F2. Link the CLI to your app

```powershell
shopify app config link
```
Follow the prompts — select the app you created in the Partner Dashboard.

**Expected:** confirmation that `shopify.app.toml` is linked, may ask to
overwrite/keep values — keep your local file's values (the ones you just
edited) as source of truth.

### F3. Deploy the app configuration (scopes, webhooks, app proxy)

```powershell
shopify app deploy
```
**Expected:** a summary of what's being registered (scopes, webhook
topics, app proxy) and a confirmation prompt — type `y` / press Enter to
confirm.

**Possible errors:**

| Error | Fix |
|---|---|
| `You are not authorized` | Run `shopify auth logout` then retry `shopify app deploy`, log in again when prompted |
| Validation error mentioning `application_url` | Double, triple check there's no trailing slash mismatch and it's exactly your Vercel URL with `https://` |

### F4. Commit the updated toml

```powershell
git add shopify.app.toml
git commit -m "Point app config at production Vercel URL"
git push
```

---

## PART G — Install and test

1. Partner Dashboard → your app → click **Select store** / **Test on
   development store** (or use the install link the CLI printed after F3).
2. Approve scopes.
3. You should land on the embedded dashboard inside Shopify admin, all
   metrics at 0.

If anything here fails, paste me:
- the exact command you ran
- the exact error text
- which part (A–G) you were on

and I'll help you debug it from there.
