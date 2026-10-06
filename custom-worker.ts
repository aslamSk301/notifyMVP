// OpenNext generates the request handler during `npm run build:cf`.
// Keep this thin wrapper so the Worker can also receive Cloudflare cron events.
// @ts-ignore .open-next/worker.js is generated at build time.
import { default as handler } from './.open-next/worker.js'

type Env = {
  DB: D1Database
}

const INACTIVITY_DAYS = 90

/**
 * A dormant device is safe to reactivate: every normal SDK registration sets it
 * back to `active`. We deliberately do not remove its FCM topic memberships;
 * topic membership is owned by the app attributes, while this status powers
 * direct/segment targeting and dashboard hygiene.
 */
async function deactivateDormantDevices(db: D1Database) {
  const result = await db.prepare(`
    UPDATE devices
    SET status = 'inactive',
        inactive_at = datetime('now'),
        updated_at = datetime('now')
    WHERE status = 'active'
      AND julianday(last_open) < julianday('now', ?)
  `).bind(`-${INACTIVITY_DAYS} days`).run()

  console.log(`[Device cleanup] marked ${result.meta.changes ?? 0} devices inactive after ${INACTIVITY_DAYS} days`)
}

export default {
  fetch: handler.fetch,

  async scheduled(_controller: ScheduledController, env: Env, ctx: ExecutionContext) {
    ctx.waitUntil(deactivateDormantDevices(env.DB))
  },
} satisfies ExportedHandler<Env>
