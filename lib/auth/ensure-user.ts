import { sql } from 'drizzle-orm'
import type { Db } from '@/lib/db/client'
import { users } from '@/lib/db/schema'

/**
 * projects.user_id references users(id).
 *
 * Production D1 rebuilt `users` as a Better Auth-shaped table:
 * id, name, email, email_verified, image, created_at, updated_at (unix ms).
 * Login writes the account to `ba_user` only. Inserting through the Drizzle
 * `users` model (password_hash) fails on that table, and project create then
 * dies on the foreign key.
 */
export async function ensureUsersRow(
  db: Db,
  input: { id: string; email: string; name?: string | null }
): Promise<void> {
  const email = input.email.trim().toLowerCase()
  const name = (input.name?.trim() || email.split('@')[0] || 'User').slice(0, 80)
  const now = Date.now()

  try {
    await db.run(sql`
      INSERT INTO users (id, name, email, email_verified, created_at, updated_at)
      VALUES (${input.id}, ${name}, ${email}, 1, ${now}, ${now})
      ON CONFLICT(id) DO NOTHING
    `)
  } catch (e) {
    const message = errorText(e)
    // Local databases that still have the original 0000 users table.
    if (/no such column:\s*(name|email_verified|updated_at)/i.test(message)) {
      await db
        .insert(users)
        .values({
          id: input.id,
          email,
          passwordHash: 'better-auth',
        })
        .onConflictDoNothing()
      return
    }
    if (/UNIQUE constraint failed: users\.email/i.test(message)) {
      throw new Error(
        'This email is already linked to a different account, so a project cannot be created for this login.'
      )
    }
    throw e
  }
}

function errorText(e: unknown): string {
  if (!(e instanceof Error)) return String(e)
  const cause = (e as Error & { cause?: unknown }).cause
  const causeMsg = cause instanceof Error ? cause.message : ''
  return `${e.message} ${causeMsg}`
}
