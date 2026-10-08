/**
 * Simple admin login: credentials come only from env (ADMIN_EMAIL / ADMIN_PASSWORD).
 * No Better Auth email signup — Google users still use Better Auth social login.
 */

import { timingSafeEqual } from 'crypto'
import { eq } from 'drizzle-orm'
import type { Db } from '@/lib/db/client'
import { baUser, users } from '@/lib/db/schema'
import { ensureUsersRow } from '@/lib/auth/ensure-user'
import { generateSecureToken } from '@/lib/utils'

export function getEnvAdminCredentials(cfEnv: Record<string, string> = {}) {
  const email = (
    process.env.ADMIN_EMAIL ||
    cfEnv.ADMIN_EMAIL ||
    process.env.ADMIN_LOGIN_EMAIL ||
    cfEnv.ADMIN_LOGIN_EMAIL ||
    ''
  )
    .trim()
    .toLowerCase()

  const password =
    process.env.ADMIN_PASSWORD ||
    cfEnv.ADMIN_PASSWORD ||
    process.env.ADMIN_LOGIN_PASSWORD ||
    cfEnv.ADMIN_LOGIN_PASSWORD ||
    ''

  return { email, password }
}

function safeEqualString(a: string, b: string): boolean {
  const ba = Buffer.from(a)
  const bb = Buffer.from(b)
  if (ba.length !== bb.length) return false
  return timingSafeEqual(ba, bb)
}

/** True only when submitted email/password match env (case-insensitive email). */
export function verifyEnvAdminLogin(
  submittedEmail: string,
  submittedPassword: string,
  cfEnv: Record<string, string> = {}
): boolean {
  const { email, password } = getEnvAdminCredentials(cfEnv)
  if (!email || password.length < 6) return false
  const normalized = submittedEmail.trim().toLowerCase()
  if (normalized !== email) return false
  return safeEqualString(submittedPassword, password)
}

function isSuperAdminEmail(email: string, cfEnv: Record<string, string>): boolean {
  const list = (
    process.env.SUPER_ADMIN_EMAILS ||
    cfEnv.SUPER_ADMIN_EMAILS ||
    getEnvAdminCredentials(cfEnv).email ||
    ''
  )
    .split(',')
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean)
  return list.includes(email)
}

/** Resolve stable user id for dashboard/projects — never deletes existing users. */
export async function resolveUserForEnvAdminLogin(
  db: Db,
  email: string,
  cfEnv: Record<string, string> = {}
): Promise<{ userId: string; email: string }> {
  const normalized = email.trim().toLowerCase()

  const [existingBa] = await db
    .select({ id: baUser.id, email: baUser.email })
    .from(baUser)
    .where(eq(baUser.email, normalized))
    .limit(1)

  if (existingBa) {
    return { userId: existingBa.id, email: existingBa.email }
  }

  const [legacy] = await db
    .select({ id: users.id, email: users.email, createdAt: users.createdAt })
    .from(users)
    .where(eq(users.email, normalized))
    .limit(1)

  const userId = legacy?.id ?? generateSecureToken(16)
  const now = new Date()
  const role = isSuperAdminEmail(normalized, cfEnv) ? 'superadmin' : 'admin'
  const name = normalized.split('@')[0] || 'Admin'

  await db.insert(baUser).values({
    id: userId,
    name,
    email: normalized,
    emailVerified: true,
    image: null,
    role,
    status: 'active',
    createdAt: now,
    updatedAt: now,
  })

  await ensureUsersRow(db, { id: userId, email: normalized, name })

  return { userId, email: normalized }
}
