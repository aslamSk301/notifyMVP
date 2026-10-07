# NotifyMVP

Open-source push notifications for startups that cannot pay OneSignal prices.

Clone it. Deploy it on **your** Cloudflare account. Plug in **your** Firebase project. That is the product.

If this is useful, **star the repo** — it is the only “pricing page” we have.

[GitHub](https://github.com/aslamSk301/notifyMVP) · [Deploy on Cloudflare](./DEPLOY.md) · [Upgrade an existing database](./DB_MIGRATE.md) · [MIT License](./LICENSE) · [LinkedIn](https://www.linkedin.com/in/aslam-shahmadar-editbysk/)

---

## Why this exists

OneSignal-class tools are going paid. For a startup that is still finding users, a monthly push bill is the wrong bill.

NotifyMVP is a dashboard + device SDK + FCM topic fan-out you host yourself:

- Cloudflare **Workers** (app)
- Cloudflare **D1** (database + **AES-256 encrypted Firebase credentials** — no R2 required for new installs)
- **Firebase Cloud Messaging** (delivery)

No vendor lock on the notification SaaS. You already have Cloudflare and Firebase, or you can create both for free.

---

## Features

- Register Android / iOS / Flutter / React Native devices
- System FCM topics: all users, OS, country, language, app version (major + exact)
- Dashboard: send to all, platform, topic, or a single external user id
- **Dashboard sign-in:** optional, configurable — env admin + Google out of the box, or your own auth if you fork (see below)
- **Super Admin Portal (`/dashboard/admin`):** Full multi-tenant user management, role assignments, account suspension, and safe cascading deletion
- **AES-256-GCM Encrypted Credentials:** Firebase service account JSON is securely encrypted at rest in your D1 database (with zero-downtime fallback migration for legacy R2)

---

## Quick start

```bash
git clone https://github.com/aslamSk301/notifyMVP.git
cd notifyMVP/my-app
npm install
npx wrangler login
```

Then follow **[DEPLOY.md](./DEPLOY.md)** for D1, migrations, and `npm run deploy` (R2 optional — legacy only). Configure dashboard login when you need it — see **Dashboard sign-in** below.

After deploy:

1. Log in (admin env credentials or Google — see **Dashboard sign-in**)
2. Create a project (copy `appId` + `apiKey`)
3. Upload the Firebase service-account JSON
4. Install an SDK from the table below. Set `baseUrl` to **your** Worker URL (`https://notifymvp.<account>.workers.dev` or your custom domain)

---

## SDKs — kahan se download / install

`baseUrl` = **tumhara** Cloudflare Worker URL. `appId` + `apiKey` dashboard → Projects se.

| Platform | Download / install | Repo / package |
|---|---|---|
| **Android** | [JitPack — aslamSk301/notify-android-sdk](https://jitpack.io/#aslamSk301/notify-android-sdk) | [github.com/aslamSk301/notify-android-sdk](https://github.com/aslamSk301/notify-android-sdk) |
| **iOS** | Xcode → Add Package | [github.com/aslamSk301/notify-ios-sdk](https://github.com/aslamSk301/notify-ios-sdk) |
| **Flutter** | [pub.dev/packages/notify_mvp](https://pub.dev/packages/notify_mvp) | package name: `notify_mvp` |
| **React Native** | https://www.npmjs.com/package/@notifymvp/react-native-sdk | `npm i @notifymvp/react-native-sdk` |

### Android (JitPack)

```kotlin
// settings.gradle.kts
maven { url = uri("https://jitpack.io") }

// app/build.gradle.kts
implementation("com.github.aslamSk301:notify-android-sdk:1.1.1")
implementation(platform("com.google.firebase:firebase-bom:33.1.0"))
implementation("com.google.firebase:firebase-messaging-ktx")
```

Docs: [notify_android_sdk/README.md](https://github.com/aslamSk301/notify-android-sdk#readme)

### iOS (Swift Package Manager)

```text
https://github.com/aslamSk301/notify-ios-sdk.git
```

Xcode → File → Add Package Dependencies… → paste URL. Docs: [notify-ios-sdk README](https://github.com/aslamSk301/notify-ios-sdk#readme)

### Flutter (pub.dev)

```yaml
dependencies:
  notify_mvp: ^1.0.3
```

```bash
flutter pub add notify_mvp
```

Package: [pub.dev/packages/notify_mvp](https://pub.dev/packages/notify_mvp)

### React Native (npm)

Package URL: https://www.npmjs.com/package/@notifymvp/react-native-sdk

```bash
npm install @notifymvp/react-native-sdk @react-native-firebase/app @react-native-firebase/messaging
```

Monorepo clone (source, not the store): `notify_android_sdk/`, `notify_ios_sdk/`, `notify_flutter_sdk/`, `notify_rn_sdk/` inside this repo.

---

## Dashboard sign-in

**Apni zaroorat ke hisaab se:** yeh repo default dashboard auth deta hai (neeche). Production mein secrets se on/off kar sakte ho, ya fork karke Cloudflare Access, SSO, ya apna login flow laga sakte ho — deploy guide auth ko force nahi karti; pehle Worker ship karo, baad mein lock down karo.

**[DEPLOY.md](./DEPLOY.md)** sirf D1 + deploy par focus karti hai. Poori auth checklist (Google OAuth URLs, Wrangler secrets, local `.env`) yahan hai.

Built-in paths — simple by design:

| Who | How |
|---|---|
| **You (platform owner / admin)** | Set `ADMIN_EMAIL` + `ADMIN_PASSWORD` in env or Wrangler secrets. On `/login`, enter **exactly** those values. No separate “Better Auth signup” for this — the server checks env via `POST /api/auth/env-login`. |
| **Other dashboard users** | **Continue with Google** on `/login` or `/register` (Better Auth + D1 `ba_user`). |

### Required secrets (summary)

```bash
# Always
npx wrangler secret put BETTER_AUTH_SECRET
npx wrangler secret put JWT_SECRET          # signs the admin session cookie
npx wrangler secret put ADMIN_EMAIL
npx wrangler secret put ADMIN_PASSWORD      # min 6 characters

# For Google login (recommended for your team)
npx wrangler secret put GOOGLE_CLIENT_ID
npx wrangler secret put GOOGLE_CLIENT_SECRET
npx wrangler secret put BETTER_AUTH_URL     # e.g. https://notify.yourdomain.com
```

Local dev: copy `.env.local.example` → `.env.local` (or use `.env` if your setup loads it) and fill the same keys. **Local files are not uploaded when you deploy.**

### Production: code deploy vs secrets (no separate “env deploy”)

| Action | Command | When |
|---|---|---|
| **Ship code changes** | `cd my-app && npm run deploy` | After you change app code, UI, or `wrangler.jsonc` **vars** (e.g. `NEXT_PUBLIC_APP_URL`) |
| **Set / change passwords & API keys on Cloudflare** | `npx wrangler secret put SECRET_NAME` | **First production setup**, or when you rotate `ADMIN_PASSWORD`, Google OAuth, etc. |
| **Local only** | Edit `.env` / `.env.local` | `npm run dev` on your machine — **does not** configure production |

Rules:

1. **There is no second “env deploy” step.** Production auth uses **Wrangler secrets** stored on the Worker. Once set, they stay until you change them with `wrangler secret put` again.
2. **Every code release does not require re-entering secrets.** Run `npm run deploy` only; existing secrets keep working.
3. **Never commit** `.env`, `.env.local`, Firebase JSON, or secret values to git.
4. **Do not put** `ADMIN_PASSWORD`, `GOOGLE_CLIENT_SECRET`, or `BETTER_AUTH_SECRET` in `wrangler.jsonc` `vars` — use `wrangler secret put` only.

Full checklist (for you or an AI assistant): **[DEPLOY.md → Code deploy vs secrets](./DEPLOY.md#code-deploy-vs-environment-secrets)**.

### Existing users

- **Google accounts already in D1** are not removed or migrated away. They keep signing in with Google.
- If your `ADMIN_EMAIL` is the **same** address as an existing Google user, env login attaches to that user’s `ba_user` row (same `userId` → same projects).
- Sessions last about **7 days** of inactivity; sign in again when the cookie expires. Accounts and projects stay in D1.

### Adding more dashboard users

You do **not** need public email/password registration for everyone:

1. **Google (easiest):** Share your Worker URL → users open **Register** or **Login** → **Continue with Google**.
2. **Super Admin panel:** After you have super-admin access, go to **`/dashboard/admin`** → create users with email + password, assign roles, suspend, or delete. That is the right place to **add** teammates who should not use env admin credentials.
3. **More env admins:** The login form only accepts the single `ADMIN_EMAIL` / `ADMIN_PASSWORD` pair. For additional fixed admins, use the admin panel or Google — or change env to another owner email (existing Google users are unaffected).

### Google OAuth (optional — team ke liye)

Google **Continue with Google** ke liye chahiye; sirf `ADMIN_EMAIL` / `ADMIN_PASSWORD` se owner login chal sakta hai.

1. [Google Cloud Console](https://console.cloud.google.com/) → OAuth consent screen (External) → Credentials → **OAuth client ID** → Web application.
2. **Authorized JavaScript origins:** `http://localhost:3000`, tumhara Worker URL, custom domain (agar hai).
3. **Authorized redirect URIs** (dono add karo — mismatch par 400 aata hai):

   ```text
   https://YOUR-ORIGIN/api/auth/google/callback
   https://YOUR-ORIGIN/api/auth/callback/google
   ```

   Localhost ke liye bhi same paths with `http://localhost:3000`.

4. Client ID / secret → `npx wrangler secret put GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET`.
5. `BETTER_AUTH_URL` = site origin, trailing slash ke bina (same as `NEXT_PUBLIC_APP_URL`).

---

## REST API (custom dashboard)

Auth: `Authorization: Bearer <apiKey>` (or `x-api-key`).

| Goal | Method | Path |
|---|---|---|
| Send (all / OS / user / topic) | `POST` | `/api/v1/notifications` |
| List devices | `GET` | `/api/v1/devices` |
| List topics | `GET` | `/api/v1/topics` |
| Stats (total count) | `GET` | `/api/v1/stats` |

### Send notification body

| Field | Required | Notes |
|---|---|---|
| `title`, `body` | yes | Notification text |
| `target` | no* | `"all"` \| `"android"` \| `"ios"` \| `"topic:NAME"` \| `"segment:ID"` \| `"user:USER_ID"` |
| `include_topics` / `topics` | no* | `["promo_offers"]` — same as `"target": "topic:promo_offers"` (Rich Push OK) |
| `include_external_user_ids` | no* | `["USER_ID"]` — send to one/many users (SDK must have linked the id) |
| `url` | no | Click / deep link |
| `imageUrl` or `image` | no | **Rich Push** Big Picture — public HTTPS URL |
| `iconUrl` or `largeIcon` | no | Circular large icon — public HTTPS URL |
| `data` | no | Extra key/values passed to the app |

\* Use either `target` **or** `include_external_user_ids`.

**Send to one user:** `"include_external_user_ids": ["USER_ID"]` or `"target": "user:USER_ID"`.

**Send to a topic (with Rich Push):**

1. `GET /api/v1/topics` → use `topics[].name`
2. `POST /api/v1/notifications` with topic target **and** `imageUrl`

```bash
# List topics
curl "https://YOUR-WORKER/api/v1/topics" \
  -H "Authorization: Bearer YOUR_API_KEY"

# Rich Push to topic — Option A: target prefix
curl -X POST "https://YOUR-WORKER/api/v1/notifications" \
  -H "Authorization: Bearer YOUR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "title": "Flash sale",
    "body": "For promo subscribers",
    "target": "topic:promo_offers",
    "imageUrl": "https://cdn.example.com/banner.jpg",
    "iconUrl": "https://cdn.example.com/icon.png"
  }'

# Rich Push to topic — Option B: include_topics alias
curl -X POST "https://YOUR-WORKER/api/v1/notifications" \
  -H "Authorization: Bearer YOUR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "title": "Flash sale",
    "body": "For promo subscribers",
    "include_topics": ["promo_offers"],
    "imageUrl": "https://cdn.example.com/banner.jpg"
  }'
```

Shortcuts (same as system topics): `"target": "all"` · `"android"` · `"ios"` — no need to invent the full `all_<appId>` name yourself. Rich Push (`imageUrl`) works on these too.

**Rich Push example (user):**

```bash
curl -X POST "https://YOUR-WORKER/api/v1/notifications" \
  -H "Authorization: Bearer YOUR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "title": "Flash sale",
    "body": "50% off ends tonight",
    "include_external_user_ids": ["USER_ID"],
    "imageUrl": "https://cdn.example.com/banner.jpg",
    "iconUrl": "https://cdn.example.com/icon.png",
    "url": "https://example.com/sale"
  }'
```

**Devices filters:** `platform`, `status`, `externalUserId`, `country`, `language`, `appVersion`, `limit`, `page` (20 per page). FCM tokens are masked.

**Topics filters:** `type=system|custom`, `active=true|false|all`.

Copy-paste examples: dashboard → **API Keys & Docs** → **Devices & Topics** tab (list + send helpers).

### Rich Push by platform (current)

Server + dashboard send `imageUrl` / `iconUrl` (and optional `data.actions` for buttons). Rich Android payloads use **data-only** + `notifymvp_rich=1` so the client SDK can render Big Picture in the background.

| Platform | SDK | Rich image (Big Picture / attachment) | Action buttons | Docs |
|---|---|---|---|---|
| **Flutter** | `notify_mvp` **1.0.3+** | Yes — foreground + background (`notifyMvpFirebaseBackgroundHandler`) | Yes — `data.actions` JSON | [notify_flutter_sdk/README.md](../notify_flutter_sdk/README.md) |
| **Android (Kotlin)** | JitPack **1.1.2+** | Big Picture + actions — data-only rich in fg/bg via `NotifyMvpMessagingService` | Up to 3 (`data.actions` or `action1_title`) | [notify_android_sdk/README.md](../notify_android_sdk/README.md) |
| **iOS (Swift)** | `notify-ios-sdk` | **System / FCM** — server sets `apns` + `fcm_options.image`; optional Notification Service Extension | Via payload / app code | [notify_ios_sdk/README.md](../notify_ios_sdk/README.md) |
| **React Native** | `@notifymvp/react-native-sdk` **1.1.0+** + **Notifee** | Big Picture fg/bg via `notifyMvpFirebaseBackgroundHandler` | Notifee actions when `data.actions` set | [notify_rn_sdk/README.md](../notify_rn_sdk/README.md) |
| **Web** | FCM `webpush` | Image in `webpush.notification` when rich fields sent | — | REST examples above |

**Recommendation:** **Flutter 1.0.3+**, **Android SDK 1.1.2+**, or **RN 1.1.0+ with Notifee** for full Android rich in all app states. **iOS:** test image attachments on a real device (FCM/APNs).

Deploy the Worker after server changes: `cd my-app && npm run deploy`.

---

## Super Admin & User Management

NotifyMVP comes with a built-in Super Admin panel located at `/dashboard/admin` for platform owners and administrators.

### Features
- **User Directory:** View all registered accounts, their linked auth providers (Google, credential/email from admin), created projects, status, and join dates.
- **Role Management:** Assign roles (`user`, `admin`, `superadmin`).
- **Create & Manage Users:** **You can add users here** — create accounts with email/password, reset passwords, and toggle status (`active` vs `suspended`). Use this when you want teammates without sharing `ADMIN_EMAIL` / `ADMIN_PASSWORD`.
- **Cascading Cleanup on Deletion:** Deleting a user safely purges projects, devices, topics, campaigns, logs, and clears credentials from D1 (and legacy R2 objects if any remain).

### Setting up Super Admin Access

You can grant Super Admin access using either method:

#### 1. Environment Variable / Secret (Recommended)
Add comma-separated emails to `SUPER_ADMIN_EMAILS`:

```bash
# In .env.local (for local development):
SUPER_ADMIN_EMAILS="admin@example.com,owner@yourdomain.com"
```

For production deployment on Cloudflare Workers:
```bash
npx wrangler secret put SUPER_ADMIN_EMAILS
```

#### 2. D1 Database Role (SQL)
Run D1 migration `0009_super_admin_roles.sql` and update your user record:

```bash
npx wrangler d1 execute notifymvp-db --command="UPDATE ba_user SET role = 'superadmin' WHERE email = 'your-email@example.com';"
```

*(Note: If no custom email is set, `contact.earnslash@gmail.com` is configured as the default fallback super admin).*

---

## Like / follow

- Star this GitHub repo if you deploy it or fork it
- Follow on LinkedIn: [https://www.linkedin.com/in/aslam-shahmadar-editbysk/](https://www.linkedin.com/in/aslam-shahmadar-editbysk/)

---

## Contribute

This is free software. Help is welcome.

1. Fork the repo
2. Create a branch: `git checkout -b fix/your-change`
3. Keep the change small (one bug or one feature)
4. Do not commit `.env`, Firebase JSON, or `wrangler` secrets
5. Open a pull request that says **why**, not only what

Useful contributions:

- Docs and deploy-guide fixes
- Dashboard UX
- SDK bugs (Android / iOS / Flutter / RN)
- D1 migration safety
- Tests around topic naming and register

Questions and bugs: GitHub Issues.

---

## License

[MIT](./LICENSE). Use it commercially. Attribution is the license notice in copies of the Software.

---

## Repo layout

```text
my-app/                 ← this dashboard (deploy this Worker)
notify_android_sdk/     ← JitPack: aslamSk301/notify-android-sdk
notify_ios_sdk/         ← SPM: github.com/aslamSk301/notify-ios-sdk
notify_flutter_sdk/     ← pub.dev: notify_mvp
notify_rn_sdk/          ← npm: @notifymvp/react-native-sdk
```

Full Cloudflare + auth + Firebase walkthrough: **[DEPLOY.md](./DEPLOY.md)**.
