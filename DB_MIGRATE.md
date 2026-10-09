# Upgrade an existing NotifyMVP database

Use this if the project is **already deployed** and D1 already has data. Do not create a new database. Do not drop tables. Apply only the SQL files you have not run yet.

Fresh install (empty database): follow **[DEPLOY.md § 5](./DEPLOY.md#5-run-d1-migrations-in-order)** and run `0000` through `0011` once.

Latest migration: **`0011_hot_path_indexes.sql`**.

Run every command from `my-app/` after `npx wrangler login`. These commands change the **remote** database. Schema-only updates do not need `npm run deploy`.

---

## 1. See what you already have

```bash
npx wrangler d1 execute notifymvp-db --remote --command "PRAGMA table_info(projects);"
npx wrangler d1 execute notifymvp-db --remote --command "PRAGMA table_info(ba_user);"
```

| If this is missing | You still need |
|---|---|
| `ba_user` table | `0008`, then `0009`, then `0010` |
| `ba_user.role` or `ba_user.status` | `0009`, then `0010` |
| `projects.firebase_credentials` | `0010`, then `0011` |
| `projects_api_key_idx` | `0011` only |

Most installs that worked before admin roles and encrypted Firebase JSON stopped at `0008`. Those need **`0009`**, **`0010`**, and **`0011`**.

---

## 2. Apply the missing files (in order)

**Stopped at `0008` (typical):**

```bash
npx wrangler d1 execute notifymvp-db --remote --file=drizzle/0009_super_admin_roles.sql
npx wrangler d1 execute notifymvp-db --remote --file=drizzle/0010_encrypted_firebase_credentials.sql
npx wrangler d1 execute notifymvp-db --remote --file=drizzle/0011_hot_path_indexes.sql
```

**Only Create project is broken** (`Failed query: insert into "projects" ... firebase_credentials`):

```bash
npx wrangler d1 execute notifymvp-db --remote --file=drizzle/0010_encrypted_firebase_credentials.sql
npx wrangler d1 execute notifymvp-db --remote --file=drizzle/0011_hot_path_indexes.sql
```

**Database already has `firebase_credentials`:**

```bash
npx wrangler d1 execute notifymvp-db --remote --file=drizzle/0011_hot_path_indexes.sql
```

**Older than `0008`:** run every file from the first one you skipped, in order, from [DEPLOY.md § 5](./DEPLOY.md#5-run-d1-migrations-in-order). Do not skip a number.

`duplicate column name` means that file was already applied. Continue with the next file.

---

## What the new files do

| File | Change |
|---|---|
| `0009_super_admin_roles.sql` | Adds `role` (default `user`) and `status` (default `active`) on `ba_user`. Without these, `/dashboard/admin` breaks. The file also sets `contact.earnslash@gmail.com` to `superadmin`. If that is not your email, edit that `UPDATE` line before you run it, or ignore it — it changes nothing when that address is not in your database. Set your own admin with `SUPER_ADMIN_EMAILS` or: `UPDATE ba_user SET role = 'superadmin' WHERE email = 'you@example.com';` |
| `0010_encrypted_firebase_credentials.sql` | Adds nullable `projects.firebase_credentials`. New Firebase JSON uploads are AES-256-GCM encrypted into this column. **Create project fails until this column exists**, because the insert always includes it. |
| `0011_hot_path_indexes.sql` | Adds indexes for `projects.api_key`, campaign lists, active devices, external user lookup, FCM token cleanup, notification logs, events, and segment rules. Safe to re-run. No Worker redeploy. |

`0010` does not move old R2 files. Existing `firebase_json_path` rows stay as they are. The app copies a legacy R2 file into D1 the next time that project sends or registers a device, if the `R2` binding is still on the Worker.

---

## After it succeeds

1. Refresh the dashboard.
2. **Projects → New Project** again. No Worker redeploy.
3. Confirm the column:

```bash
npx wrangler d1 execute notifymvp-db --remote --command "PRAGMA table_info(projects);"
```

`firebase_credentials` should be in the list (`cid` 7 on databases that started from `0000`).

---

## Symptom → file

| What you see | Run |
|---|---|
| Create project: `Failed query: insert into "projects"` and the SQL mentions `firebase_credentials` | `0010` |
| Admin page errors on `role` / `status` | `0009` |
| Login / session errors, no `ba_user` table | `0008`, then `0009`, then `0010` |
| `duplicate column name: firebase_credentials` | `0010` is already applied. Continue with `0011` if `projects_api_key_idx` is missing. |
| API and dashboard reads scan whole tables | `0011` |
