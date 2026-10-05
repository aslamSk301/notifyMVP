# Deploy NotifyMVP on your Cloudflare account

Self-host a OneSignal-style push dashboard on **Cloudflare Workers + D1** (Firebase credentials encrypted in D1). **R2 is optional** — only for upgrading old installs that still stored JSON in a bucket.

No NotifyMVP cloud bill. You pay only what Cloudflare and Firebase already give you on their free tiers (or your existing paid plans).

If this helped your startup, **star the repo**: [github.com/aslamSk301/notifyMVP](https://github.com/aslamSk301/notifyMVP).

---

## What you get

| Piece | Role |
|---|---|
| **Cloudflare Worker** | Dashboard + public device/register + send APIs |
| **D1** | SQLite database (users, projects, devices, topics) — **not** a bucket |
| **R2** (optional) | Legacy only: old installs kept Firebase JSON in a bucket; new uploads go to **D1** |
| **Admin env login + Google** | Dashboard auth: `ADMIN_EMAIL`/`ADMIN_PASSWORD` + Google (Better Auth) |
| **Firebase FCM** | Actual push delivery (topics + tokens) |

---

## What you need

1. A [Cloudflare](https://dash.cloudflare.com/sign-up) account
2. Node.js 20+ and npm
3. [Wrangler](https://developers.cloudflare.com/workers/wrangler/install-and-update/) (`npx wrangler` is enough)
4. A free [Google Cloud](https://console.cloud.google.com/) OAuth client (Web application)
5. A [Firebase](https://console.firebase.google.com/) project with Cloud Messaging enabled, plus a **service account JSON**

Optional: a custom domain on Cloudflare.

---

## 1. Clone and install

```bash
git clone https://github.com/aslamSk301/notifyMVP.git
cd notifyMVP/my-app
cp wrangler.jsonc.example wrangler.jsonc
npm install
npx wrangler login
```

Edit `wrangler.jsonc` (this file is **gitignored** — your real `database_id` and URL stay on your machine only). The repo ships `wrangler.jsonc.example` with placeholders for forks.

---

## 2. Create the D1 database

D1 is Cloudflare's SQLite database. Create one, then copy the `database_id`.

```bash
npx wrangler d1 create notifymvp-db
```

Example output:

```text
database_name = "notifymvp-db"
database_id = "xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
```

Replace `YOUR-D1-DATABASE-ID` in your local `wrangler.jsonc` → `d1_databases[0].database_id` with **your** id from the command above.

Keep the binding name as `DB`. The app reads `env.DB`.

---

## 3. R2 bucket (optional — skip for new installs)

**New users:** you do **not** need Cloudflare R2. When you upload Firebase service-account JSON in the dashboard, it is **AES-256-GCM encrypted and stored in D1** (`projects.firebase_credentials`).

**When you might need R2:**

- You deployed an **older** NotifyMVP version that saved JSON only in R2 (`firebase_json_path` set in D1).
- The app can **lazy-migrate** those files into D1 on first use (send/register) if R2 is still bound.

If that is not you, **skip this section** and leave `r2_buckets` out of `wrangler.jsonc`.

Legacy setup (only if upgrading):

```bash
npx wrangler r2 bucket create firebase-credentials
```

Add to `wrangler.jsonc`:

```jsonc
"r2_buckets": [
  { "binding": "R2", "bucket_name": "firebase-credentials" }
]
```

Keep the bucket **private**. After all projects show credentials in D1 and `firebase_json_path` is empty, you may remove the R2 binding and bucket.

---

## 4. Edit `wrangler.jsonc`

Update these three things before the first deploy:

```jsonc
{
  "name": "notifymvp",
  "d1_databases": [
    {
      "binding": "DB",
      "database_name": "notifymvp-db",
      "database_id": "YOUR-D1-DATABASE-ID"
    }
  ],
  "vars": {
    "NEXT_PUBLIC_APP_URL": "https://YOUR-WORKER.YOUR-SUBDOMAIN.workers.dev"
  }
}
```

`NEXT_PUBLIC_APP_URL` must be the public URL of the Worker (or your custom domain). After the first deploy Wrangler prints a `*.workers.dev` URL — put that here and deploy once more.

---

## 5. Run D1 migrations (in order)

Run **once** against the remote database. Do not skip files.

```bash
npx wrangler d1 execute notifymvp-db --remote --file=drizzle/0000_initial.sql
npx wrangler d1 execute notifymvp-db --remote --file=drizzle/0001_enhanced_devices_topics.sql
npx wrangler d1 execute notifymvp-db --remote --file=drizzle/0002_topics_description.sql
npx wrangler d1 execute notifymvp-db --remote --file=drizzle/0003_device_topics.sql
npx wrangler d1 execute notifymvp-db --remote --file=drizzle/0004_onesignal_architecture.sql
npx wrangler d1 execute notifymvp-db --remote --file=drizzle/0005_fix_campaigns_columns.sql
npx wrangler d1 execute notifymvp-db --remote --file=drizzle/0006_add_missing_campaign_columns.sql
npx wrangler d1 execute notifymvp-db --remote --file=drizzle/0007_fix_devices_missing_columns.sql
npx wrangler d1 execute notifymvp-db --remote --file=drizzle/0008_better_auth_tables.sql
npx wrangler d1 execute notifymvp-db --remote --file=drizzle/0009_super_admin_roles.sql
npx wrangler d1 execute notifymvp-db --remote --file=drizzle/0010_encrypted_firebase_credentials.sql
```

`0008` creates Better Auth tables (`ba_user`, `ba_session`, `ba_account`, `ba_verification`). Login will fail without it.

`0009` adds `role` and `status` on `ba_user` (needed for `/dashboard/admin`). It also sets `contact.earnslash@gmail.com` to `superadmin` — change that email in the SQL file before you run it on your own account.

`0010` adds `projects.firebase_credentials`. **Create project fails without it** (the insert includes that column). Firebase JSON uploads are stored here, encrypted.

**Already deployed?** Do not start over. Apply only the files you have not run — see **[DB_MIGRATE.md](./DB_MIGRATE.md)**. Create project fails with `Failed query: insert into "projects" ... firebase_credentials` until `0010` is applied.

If an `ALTER TABLE ... ADD COLUMN` says the column already exists, that file was already applied — continue.

---

## 6. Authentication — what to put where

Dashboard login uses two paths:

| Path | Who | What you configure |
|---|---|---|
| **Env admin** | Platform owner | `ADMIN_EMAIL` + `ADMIN_PASSWORD` on `/login` (checked by `/api/auth/env-login`; session cookie via `JWT_SECRET`) |
| **Google** | Other users | Google OAuth + `BETTER_AUTH_SECRET` (Better Auth social sign-in / register) |

Better Auth **requires** `BETTER_AUTH_SECRET` in production. Google credentials are **recommended** so teammates can use **Continue with Google**; without them, only env admin login works.

### 6a. Admin email login (env)

```bash
npx wrangler secret put ADMIN_EMAIL
npx wrangler secret put ADMIN_PASSWORD   # minimum 6 characters
npx wrangler secret put JWT_SECRET       # openssl rand -base64 32
```

Use the same email/password on the login form. This does not delete existing Google users in D1.

### 6b. Generate a Better Auth secret

```bash
openssl rand -base64 32
```

Then store it on the Worker (do not commit this):

```bash
npx wrangler secret put BETTER_AUTH_SECRET
```

Paste the random string when prompted.

### 6c. Google Cloud OAuth

1. Open [Google Cloud Console](https://console.cloud.google.com/) → your project (or create one).
2. **APIs & Services → OAuth consent screen** — External, app name e.g. `NotifyMVP`, your email.
3. **APIs & Services → Credentials → Create credentials → OAuth client ID → Web application**.
4. Authorized JavaScript origins:

   ```text
   http://localhost:3000
   https://YOUR-WORKER.YOUR-SUBDOMAIN.workers.dev
   https://your-custom-domain.com
   ```

5. Authorized redirect URIs (add **all** you will use):

   ```text
   http://localhost:3000/api/auth/google/callback
   http://localhost:3000/api/auth/callback/google
   https://YOUR-WORKER.YOUR-SUBDOMAIN.workers.dev/api/auth/google/callback
   https://YOUR-WORKER.YOUR-SUBDOMAIN.workers.dev/api/auth/callback/google
   https://your-custom-domain.com/api/auth/google/callback
   https://your-custom-domain.com/api/auth/callback/google
   ```

   `/api/auth/google/callback` is the custom Google route. `/api/auth/callback/google` is Better Auth's default. Add both so login does not 400.

6. Copy the Client ID and Client Secret into Worker secrets:

```bash
npx wrangler secret put GOOGLE_CLIENT_ID
npx wrangler secret put GOOGLE_CLIENT_SECRET
```

### 6d. App URL for auth cookies

```bash
npx wrangler secret put BETTER_AUTH_URL
```

Use the same origin as `NEXT_PUBLIC_APP_URL` (no trailing slash), e.g. `https://notify.yourdomain.com`.

### 6e. Optional secrets

| Secret | Required? | What it is |
|---|---|---|
| `SUPER_ADMIN_EMAILS` | Recommended | Comma-separated emails for `/dashboard/admin` |
| `BETTER_AUTH_API_KEY` | No | Better Auth dashboard plugin (`ba_...`) if you use it |
| `RESEND_API_KEY` / `EMAIL_FROM` | No | Only if you later wire transactional email |

**Adding users:** Super admins can create email/password users in **`/dashboard/admin`** without changing env. See [README — Dashboard sign-in](./README.md#dashboard-sign-in).

---

## Code deploy vs environment secrets

> **For AI assistants:** Follow this section when the user asks to deploy NotifyMVP, set up login, or configure production. Do **not** assume `.env` on disk is deployed to Cloudflare. Production secrets are **only** Wrangler secrets + non-secret `vars` in `wrangler.jsonc`.

### What goes where

| Kind | Where it lives | How it gets to production |
|---|---|---|
| **Secrets** (passwords, API keys) | Cloudflare Worker encrypted bindings | `npx wrangler secret put NAME` from `my-app/` (interactive paste). **Not** in git. |
| **Public config** | `wrangler.jsonc` → `vars` | Committed in repo; applied on `npm run deploy` (e.g. `NEXT_PUBLIC_APP_URL`) |
| **Local dev only** | `.env`, `.env.local` | Used by `next dev` / local build. **Never uploaded** by `npm run deploy`. |

### Secret names (production login)

Set these with `npx wrangler secret put <NAME>` (run from `my-app/` after `npx wrangler login`):

| Secret | Required for | Notes |
|---|---|---|
| `BETTER_AUTH_SECRET` | Google login (Better Auth) | `openssl rand -base64 32` |
| `JWT_SECRET` | Env admin login session cookie | `openssl rand -base64 32` |
| `ADMIN_EMAIL` | Owner email/password login | Same email as existing Google user → same D1 account |
| `ADMIN_PASSWORD` | Owner login | Min 6 characters; login form must match exactly |
| `GOOGLE_CLIENT_ID` | Google button | Optional only if you skip Google entirely |
| `GOOGLE_CLIENT_SECRET` | Google button | Pair with client ID |
| `BETTER_AUTH_URL` | Auth cookies | Same origin as site, no trailing slash |
| `SUPER_ADMIN_EMAILS` | `/dashboard/admin` | Comma-separated emails; recommended |

Optional: `BETTER_AUTH_API_KEY`, `RESEND_API_KEY`, `EMAIL_FROM`.

### When to run what

**A) First time on Cloudflare (full setup)**

1. D1 create + migrations (sections 2–5 above).
2. Set **all** required secrets (section 6 + table above) via `wrangler secret put`.
3. `npm run deploy`.
4. Open Worker URL → `/login` → test env admin and/or Google.

**B) Code or UI change only**

```bash
cd my-app
npm run deploy
```

Do **not** re-run `wrangler secret put` unless values changed.

**C) Change admin password or OAuth credentials only**

```bash
cd my-app
npx wrangler secret put ADMIN_PASSWORD   # or whichever secret changed
```

No redeploy required; the Worker picks up the new secret on the next request. (Redeploy is still fine but not mandatory.)

**D) Change public site URL**

1. Update `wrangler.jsonc` → `vars.NEXT_PUBLIC_APP_URL`.
2. `npx wrangler secret put BETTER_AUTH_URL` (same URL).
3. Update Google OAuth redirect URIs in Google Cloud Console.
4. `npm run deploy`.

### Common mistakes (avoid)

- Putting secrets in `wrangler.jsonc` `vars` or committing `.env` to git.
- Expecting local `.env` to configure production after `npm run deploy`.
- Using a different `ADMIN_EMAIL` than the Google account you want to keep — that creates or uses a **different** user in D1.
- Forgetting `JWT_SECRET` on production — env admin login sets a cookie signed with this secret.

### Verify production auth (optional)

```bash
curl -s "https://YOUR-WORKER-ORIGIN/api/auth/config"
```

Expect JSON like `{ "googleEnabled": true, "envEmailLoginEnabled": true }` (booleans depend on which secrets are set). No secret values are returned.

---

## 7. Deploy the Worker

From `my-app/`:

```bash
npm run deploy
```

That runs OpenNext (`opennextjs-cloudflare build`) then `wrangler deploy`. This deploys **application code and `wrangler.jsonc` vars only** — not your local `.env` file. Secrets must already be set on the Worker (see [Code deploy vs environment secrets](#code-deploy-vs-environment-secrets)).

You should see something like:

```text
https://notifymvp.YOUR-SUBDOMAIN.workers.dev
```

Open that URL → `/login`.

If `NEXT_PUBLIC_APP_URL` still points at someone else's domain, update `wrangler.jsonc` `vars` and deploy again.

---

## 8. Custom domain (optional)

Cloudflare Dashboard → **Workers & Pages** → `notifymvp` → **Settings → Domains & Routes** → add `notify.yourdomain.com`.

Then:

1. Set `vars.NEXT_PUBLIC_APP_URL` to `https://notify.yourdomain.com`
2. `npx wrangler secret put BETTER_AUTH_URL` → same URL
3. Add that origin + both callback URLs in Google OAuth
4. `npm run deploy` again

---

## 9. First-run product setup (Firebase)

1. Register / log in on your Worker URL.
2. **Projects** → create an app (you get `appId` + `apiKey`).
3. Firebase Console → Project settings → **Service accounts** → Generate new private key (JSON).
4. Upload that JSON on the NotifyMVP project card. It is **encrypted and stored in D1** (not in git). R2 is not used for new uploads.
5. Install an SDK — links and one-liners are in [README.md → SDKs](./README.md#sdks--kahan-se-download--install). Set `baseUrl` to your Worker origin.

   - React Native (npm): https://www.npmjs.com/package/@notifymvp/react-native-sdk

6. (Optional) Send / list from your own backend / custom dashboard via REST:

```bash
# All users
curl -X POST "https://YOUR-WORKER/api/v1/notifications" \
  -H "Authorization: Bearer YOUR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"title":"Hello","body":"Broadcast","target":"all"}'

# One user by External User ID + Rich Push (Big Picture)
curl -X POST "https://YOUR-WORKER/api/v1/notifications" \
  -H "Authorization: Bearer YOUR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "title":"Hello",
    "body":"For you",
    "include_external_user_ids":["USER_ID"],
    "imageUrl":"https://cdn.example.com/banner.jpg",
    "iconUrl":"https://cdn.example.com/icon.png",
    "url":"https://example.com/sale"
  }'

# Send Rich Push to a TOPIC (name from GET /api/v1/topics → topics[].name)
curl -X POST "https://YOUR-WORKER/api/v1/notifications" \
  -H "Authorization: Bearer YOUR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "title":"Flash sale",
    "body":"For promo subscribers",
    "target":"topic:promo_offers",
    "imageUrl":"https://cdn.example.com/banner.jpg",
    "iconUrl":"https://cdn.example.com/icon.png"
  }'

# Same with include_topics alias
curl -X POST "https://YOUR-WORKER/api/v1/notifications" \
  -H "Authorization: Bearer YOUR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "title":"Flash sale",
    "body":"For promo subscribers",
    "include_topics":["promo_offers"],
    "imageUrl":"https://cdn.example.com/banner.jpg"
  }'

# List devices (custom dashboard — 20 per page)
curl "https://YOUR-WORKER/api/v1/devices?limit=20&page=1" \
  -H "Authorization: Bearer YOUR_API_KEY"

# List topics
curl "https://YOUR-WORKER/api/v1/topics" \
  -H "Authorization: Bearer YOUR_API_KEY"
```

Send body fields: `title`, `body`, `target` / `include_external_user_ids`, optional `url`, **`imageUrl`** (Rich Push), **`iconUrl`**, `data`.

Full snippets: dashboard → **API Keys & Docs** → **Devices & Topics**.

Devices register at:

```text
POST https://YOUR-ORIGIN/api/device/register
```

On register, the backend subscribes the FCM token to system topics (`all_…`, `os_…`, `country_…`, `language_…`, `version_…`).

---

## 10. Local development

```bash
cp .env.local.example .env.local
```

Fill at least:

```env
NEXT_PUBLIC_APP_URL=http://localhost:3000
BETTER_AUTH_URL=http://localhost:3000
BETTER_AUTH_SECRET=a-long-random-string-at-least-32-chars
GOOGLE_CLIENT_ID=...
GOOGLE_CLIENT_SECRET=...
CLOUDFLARE_ACCOUNT_ID=...
CLOUDFLARE_D1_DATABASE_ID=...
CLOUDFLARE_API_TOKEN=...   # D1 Edit
```

`CLOUDFLARE_*` is only for `next dev` talking to remote D1 over HTTP. For bindings that match production:

```bash
npm run preview
# or
npm run dev:cf
```

Apply the same SQL files locally with `--local` if you use local D1.

---

## Cloudflare checklist (short)

**Workers**

- [ ] Worker name `notifymvp` (or change `wrangler.jsonc` `name`)
- [ ] `nodejs_compat` + `compatibility_date` already in config
- [ ] Secrets: `BETTER_AUTH_SECRET`, `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `BETTER_AUTH_URL`
- [ ] Var: `NEXT_PUBLIC_APP_URL`

**D1**

- [ ] Database `notifymvp-db` created
- [ ] `database_id` in `wrangler.jsonc`
- [ ] Binding name `DB`
- [ ] Migrations `0000` … `0010` applied `--remote` (`0010` = `projects.firebase_credentials`)

**R2 (optional — legacy only)**

- [ ] Skip if this is a fresh install
- [ ] Or: bucket + `R2` binding only when migrating old R2-stored JSON

**Firebase credentials**

- [ ] Service account JSON uploaded from the dashboard (stored encrypted in D1)

**Google Cloud**

- [ ] OAuth Web client
- [ ] Consent screen configured
- [ ] Redirect URIs for Worker URL + localhost (both callback paths)

**Firebase**

- [ ] Cloud Messaging enabled
- [ ] Service account JSON uploaded in NotifyMVP → Project

---

## Troubleshooting

| Symptom | Check |
|---|---|
| Login says Google is not configured | `wrangler secret list` — `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` / `BETTER_AUTH_SECRET` |
| Google 400 / redirect_uri_mismatch | Exact callback URL in Google Console, including `https` and no trailing slash |
| Dashboard empty / DB errors | Migrations, especially `0008_better_auth_tables.sql` |
| Create project shows `Failed query: insert into "projects" ... firebase_credentials` | Migration `0010_encrypted_firebase_credentials.sql` was not applied. Run it `--remote`, then retry. No redeploy needed. |
| “No Firebase credentials” | Upload Firebase JSON on the project card (D1). Legacy: R2 binding only if `firebase_json_path` still set |
| Devices register but Topics = — | Open the app once after a successful deploy; register writes `device_topics` |
| Worker URL works, custom domain does not | Update `NEXT_PUBLIC_APP_URL` + `BETTER_AUTH_URL` + Google origins |

---

## Cost note

Cloudflare Workers and D1 have a free tier that is enough for early-stage apps (R2 only if you use the legacy path). Firebase Cloud Messaging has no per-notification fee for the usual mobile use case. You are not paying NotifyMVP — there is no hosted billing.

OneSignal and similar products are moving toward paid plans that are hard on pre-revenue startups. This repo is **clone → configure Cloudflare → upload Firebase JSON → send**.

---

## License

[MIT](./LICENSE) — use it, fork it, ship it.

---

## Contribute

See [README.md](./README.md#contribute).
