# Deploying Returns & Exchanges — Git + Vercel + Neon/Supabase

This walks through taking the app from your local folder to a live,
installable Shopify app hosted on Vercel, with Postgres on Neon or
Supabase. Follow it top to bottom the first time; after that, "deploying"
is just `git push`.

---

## 0. What you need before you start

| Account | Why | Link |
|---|---|---|
| Shopify Partner account | Create the app, get API credentials, install on a dev store | partners.shopify.com |
| A Shopify **dev store** | To install and test the app | Created from your Partner Dashboard |
| GitHub (or GitLab/Bitbucket) account | Host the code, connect to Vercel | github.com |
| Vercel account | Hosts the app (serverless) | vercel.com |
| Neon **or** Supabase account | Managed Postgres database | neon.tech / supabase.com |
| Node.js 18.20+ installed locally | Run the app locally, run CLI commands | nodejs.org |
| Shopify CLI (`npm i -g @shopify/cli`) | Link the app config, register webhooks/scopes | — |

You do **not** need to buy a domain — Vercel gives you a free
`your-app.vercel.app` HTTPS URL, and Shopify apps work fine on it.

---

## 1. Create the app in the Shopify Partner Dashboard

1. Go to **partners.shopify.com** → **Apps** → **Create app** → **Create app manually**.
2. Name it (e.g. "Returns & Exchanges"). Choose **Public** or **Custom**
   distribution depending on whether this is for one store or the App
   Store — for your own store, pick **Custom app** distribution for now;
   you can change this later.
3. Once created, open **Client credentials** and copy:
   - **Client ID** (this is your `SHOPIFY_API_KEY`)
   - **Client secret** (this is your `SHOPIFY_API_SECRET`)

   Keep this tab open — you'll paste these into Vercel in step 4.

4. Under **Configuration**, leave the App URL and redirect URLs blank for
   now — we'll fill them in once we know the Vercel URL (step 4.6).

5. Create a **dev store**: Partner Dashboard → **Stores** → **Add store** →
   **Development store**. This is where you'll install and test the app.

---

## 2. Push the code to GitHub

From the project folder (the one you downloaded from this chat):

```bash
cd return-prime-clone
git init
git add .
git commit -m "Initial commit: returns/exchange/cancellation/RTO/replacement app"
```

Create an empty repo on GitHub (no README/gitignore — you already have
them), then:

```bash
git remote add origin https://github.com/<your-username>/<your-repo>.git
git branch -M main
git push -u origin main
```

`.gitignore` is already set up to exclude `node_modules`, `.env`, and the
local SQLite file, so none of that gets committed.

---

## 3. Create the Postgres database

Pick **one** — Neon and Supabase both work identically with Prisma here.

### Option A — Neon

1. neon.tech → **New Project**. Pick a region close to where your Vercel
   functions will run (match Vercel's region if you can, to cut latency).
2. Once created, go to **Connection Details**. Neon gives you two strings:
   - **Pooled connection** (host contains `-pooler`) → this is your
     `DATABASE_URL`
   - **Direct connection** → this is your `DIRECT_URL`
3. Copy both. They look like:
   ```
   postgresql://user:password@ep-xxx-pooler.region.aws.neon.tech/neondb?sslmode=require
   postgresql://user:password@ep-xxx.region.aws.neon.tech/neondb?sslmode=require
   ```

### Option B — Supabase

1. supabase.com → **New project**. Set a database password (save it).
2. Once created, go to **Project Settings → Database → Connection string**.
3. You need two variants:
   - **Connection pooling** (transaction mode, port `6543`) → `DATABASE_URL`,
     add `?pgbouncer=true` to the end if it isn't already there
   - **Direct connection** (port `5432`) → `DIRECT_URL`
4. They look like:
   ```
   postgresql://postgres:[password]@aws-0-region.pooler.supabase.com:6543/postgres?pgbouncer=true
   postgresql://postgres:[password]@db.[project-ref].supabase.co:5432/postgres
   ```

**Why two URLs?** Serverless functions (Vercel) open a new DB connection
per invocation, which exhausts Postgres's connection limit fast. The
pooled URL (PgBouncer) handles that at runtime. But `prisma migrate
deploy` needs a real session, which the pooler's transaction mode doesn't
support — so migrations use the direct URL instead. The Prisma schema is
already set up for this (`url` = pooled, `directUrl` = direct).

---

## 4. Deploy to Vercel

1. vercel.com → **Add New → Project** → **Import** your GitHub repo.
2. Vercel will detect it as a Remix app (there's a `vercel.json` in the
   repo pinning `framework: remix` and the build command, so this should
   be automatic).
3. **Before the first deploy**, open **Environment Variables** and add:

   | Key | Value |
   |---|---|
   | `SHOPIFY_API_KEY` | from step 1 |
   | `SHOPIFY_API_SECRET` | from step 1 |
   | `SCOPES` | `read_orders,write_orders,read_products,write_draft_orders,read_customers,read_fulfillments,write_inventory` |
   | `SHOPIFY_APP_URL` | leave blank for now, come back after first deploy |
   | `DATABASE_URL` | pooled connection string from step 3 |
   | `DIRECT_URL` | direct connection string from step 3 |

   Set all of these for **Production**, and duplicate them for **Preview**
   if you want preview deployments (PRs) to also work against the same DB
   (fine for a solo project; use a separate DB for Preview if multiple
   people are pushing branches).

4. Click **Deploy**. First deploy will run `vercel-build`, which does:
   ```
   prisma generate && prisma migrate deploy && remix vite:build
   ```
   `prisma migrate deploy` needs migration files to exist — see step 5
   below if this is your very first deploy and you haven't created any
   migrations yet.

5. Once deployed, copy your Vercel URL, e.g. `https://returns-app.vercel.app`.

6. **Go back and fill in `SHOPIFY_APP_URL`** in Vercel's env vars with that
   exact URL, then redeploy (Vercel → Deployments → ⋯ → Redeploy) so the
   app picks it up.

---

## 5. Run the first Prisma migration

If you haven't created a migration yet (the repo ships the schema but not
committed migration SQL), do this **locally**, pointed at your real
database, then commit the result — don't try to run `migrate dev` from
inside Vercel's build (it's non-interactive and `migrate dev` expects a
prompt).

```bash
cd return-prime-clone
npm install

# Use the DIRECT (non-pooled) URL for this — migrate dev needs a real session
export DATABASE_URL="postgresql://...direct-connection-string..."
export DIRECT_URL="$DATABASE_URL"

npx prisma migrate dev --name init
```

This creates a `prisma/migrations/` folder with SQL files. Commit and push
it:

```bash
git add prisma/migrations
git commit -m "Add initial Postgres migration"
git push
```

Vercel will redeploy automatically on push, and this time `prisma migrate
deploy` in `vercel-build` will find the migration and apply it to your
production database.

For any future schema changes: edit `prisma/schema.prisma`, run
`npx prisma migrate dev --name <description>` locally against a dev
database (or the same one, if you're solo), commit the new migration
file, push — Vercel applies it on deploy automatically.

---

## 6. Point the Shopify app at your Vercel URL

Back in your local project, edit `shopify.app.toml`:

```toml
client_id = "<paste your Client ID>"
application_url = "https://returns-app.vercel.app"

[auth]
redirect_urls = [
  "https://returns-app.vercel.app/auth/callback",
  "https://returns-app.vercel.app/auth/shopify/callback",
  "https://returns-app.vercel.app/api/auth/callback"
]

[app_proxy]
url = "https://returns-app.vercel.app/proxy"
```

Then link and push this config to Shopify:

```bash
shopify app config link
```

This will ask you to select the app you created in step 1 — confirm it,
and it'll sync your local `shopify.app.toml` with the Partner Dashboard
(or push your local values up, depending on which is source of truth —
follow the CLI prompts).

Deploy the app config (scopes, webhooks, app proxy) to Shopify:

```bash
shopify app deploy
```

This registers your webhook subscriptions and scopes with Shopify — it
does **not** touch Vercel; your code is already live there from step 4.

---

## 7. Install the app on your dev store

1. Partner Dashboard → your app → **Test on development store** (or use
   the install link the CLI prints after `shopify app deploy`).
2. Approve the requested scopes.
3. You should land on the embedded app inside Shopify admin, showing the
   **Returns & Exchanges** dashboard with all-zero KPIs — that means auth,
   session storage, and the database connection are all working.

If this fails, check the **Troubleshooting** section below before
anything else.

---

## 8. Verify each piece is actually live

| Check | How |
|---|---|
| Database connected | Dashboard loads without a 500 error |
| Sessions persisting | Refresh the embedded app — you shouldn't be asked to re-auth every time |
| Settings save | Go to **Automation Rules**, toggle something, save, refresh — it should stick |
| Webhooks registered | Partner Dashboard → app → **Webhooks** (or `shopify app webhook trigger` to test one locally-equivalent) |
| App proxy reachable | Visit `https://<your-dev-store>.myshopify.com/apps/returns/submit` — a `POST`-only route, so a GET should return a method-not-allowed rather than a 404 |

---

## 9. Environment variable summary (copy-paste checklist)

Set these in **Vercel → Project → Settings → Environment Variables**:

```
SHOPIFY_API_KEY=<from Partner Dashboard>
SHOPIFY_API_SECRET=<from Partner Dashboard>
SCOPES=read_orders,write_orders,read_products,write_draft_orders,read_customers,read_fulfillments,write_inventory
SHOPIFY_APP_URL=https://<your-vercel-domain>
DATABASE_URL=<pooled Postgres connection string>
DIRECT_URL=<direct Postgres connection string>
```

Never commit real values for these — `.env` is gitignored; only
`.env.example` (with blanks) is tracked.

---

## 10. Ongoing workflow, once this is all set up

- **Code change:** `git push` → Vercel auto-deploys.
- **Schema change:** edit `schema.prisma` → `npx prisma migrate dev --name
  <desc>` locally → commit `prisma/migrations/` → `git push` → Vercel
  applies it via `vercel-build`.
- **Scope/webhook/app-proxy change:** edit `shopify.app.toml` →
  `shopify app deploy`.
- **Custom domain (optional):** Vercel → Project → **Domains** → add your
  domain → update `SHOPIFY_APP_URL`, `application_url`, and
  `redirect_urls` to match → `shopify app deploy` again.

---

## Troubleshooting

**"Oauth error / invalid_request" on install**
Your `redirect_urls` in `shopify.app.toml` don't match `SHOPIFY_APP_URL`
exactly (including `https://`, no trailing slash mismatches). Re-run
`shopify app deploy` after fixing.

**500 error on first load, logs show a Prisma connection error**
Almost always means `DATABASE_URL` is pointed at the **direct** connection
instead of the **pooled** one, and you've exceeded Postgres's connection
limit under serverless load. Double-check `DATABASE_URL` uses the pooler
host (`-pooler` for Neon, port `6543` + `pgbouncer=true` for Supabase).

**`prisma migrate deploy` fails during Vercel build**
Usually means `DIRECT_URL` isn't set in Vercel's env vars, or no
migrations exist yet in `prisma/migrations/` (see step 5 — migrations
must be generated locally and committed; Vercel only *applies* them, it
doesn't generate them).

**App loads outside Shopify admin but not embedded (blank iframe)**
Check the browser console for a CSP / frame-ancestors error — this
usually means `SHOPIFY_APP_URL` in Vercel doesn't match what's registered
in the Partner Dashboard. They must be identical.

**Webhook HMAC validation failures**
`SHOPIFY_API_SECRET` in Vercel doesn't match the Partner Dashboard's
current client secret (e.g. it was rotated). Copy it again from
**Client credentials** and redeploy.

**Changes to `shopify.app.toml` don't seem to take effect**
You edited the file but forgot to run `shopify app deploy` — editing the
TOML locally doesn't push anything to Shopify by itself.
