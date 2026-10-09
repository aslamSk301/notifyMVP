/**
 * Session helpers — works with both Better Auth sessions and legacy JWT cookies.
 * Server Components, Server Actions, and Route Handlers.
 */

import { cache } from 'react'
import { cookies } from 'next/headers'
import { COOKIE_NAME, verifySessionToken, type SessionPayload } from './jwt'
import { getCachedJson } from '@/lib/cache/read-cache'

const COOKIE_OPTIONS = {
  httpOnly:  true,
  secure:    process.env.NODE_ENV === 'production',
  sameSite:  'lax' as const,
  path:      '/',
  maxAge:    60 * 60 * 24 * 7, // 7 days
}

/** Get the current session from either Better Auth or legacy JWT cookie. */
export const getSession = cache(async function getSession(): Promise<SessionPayload | null> {
  // ── 1. Try Better Auth session ────────────────────────────────────────────
  try {
    const { getAuth } = await import('@/lib/auth')
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const auth = await getAuth() as any
    const cookieStore = await cookies()
    const cookieHeader = cookieStore
      .getAll()
      .map((c) => `${c.name}=${c.value}`)
      .join('; ')

    const session = await auth.api.getSession({
      headers: new Headers({ cookie: cookieHeader }),
    })

    if (session?.user?.id && session.user.email) {
      return { userId: session.user.id, email: session.user.email }
    }
  } catch {
    // Better Auth not available or no session — fall through to legacy
  }

  // ── 2. Fallback: legacy JWT cookie ────────────────────────────────────────
  try {
    const cookieStore = await cookies()
    const token = cookieStore.get(COOKIE_NAME)?.value
    if (!token) return null
    return verifySessionToken(token)
  } catch {
    return null
  }
})

/** Set the legacy session cookie (used by email/password login action) */
export async function setSessionCookie(token: string): Promise<void> {
  const cookieStore = await cookies()
  cookieStore.set(COOKIE_NAME, token, COOKIE_OPTIONS)
}

/** Clear all session cookies on logout */
export async function clearSessionCookie(): Promise<void> {
  const cookieStore = await cookies()
  // Clear legacy JWT cookie
  cookieStore.set(COOKIE_NAME, '', { ...COOKIE_OPTIONS, maxAge: 0 })
  // Clear Better Auth cookie
  cookieStore.set('better-auth.session_token', '', { ...COOKIE_OPTIONS, maxAge: 0 })
}

/** Get session or throw — use in protected Server Actions */
export async function requireSession(): Promise<SessionPayload> {
  const session = await getSession()
  if (!session) throw new Error('Not authenticated')
  return session
}

/** Check if an email has Super Admin privileges */
export async function isSuperAdmin(email?: string | null): Promise<boolean> {
  if (!email) return false
  const normalized = email.toLowerCase().trim()

  // 1. Check environment variables
  let cfEnv: Record<string, string> = {}
  try {
    const { getCloudflareContext } = await import('@opennextjs/cloudflare')
    const { env } = await getCloudflareContext({ async: true })
    cfEnv = (env as Record<string, string>) || {}
  } catch {}

  const envList = (
    process.env.SUPER_ADMIN_EMAILS ||
    cfEnv.SUPER_ADMIN_EMAILS ||
    process.env.ADMIN_EMAIL ||
    cfEnv.ADMIN_EMAIL ||
    'contact.earnslash@gmail.com'
  )
    .split(',')
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean)

  if (envList.includes(normalized)) {
    return true
  }

  // 2. Check database role in ba_user. Cached so every dashboard refresh
  // does not read ba_user again. Role changes show up within a minute.
  try {
    return await getCachedJson(`superadmin:${normalized}`, 60, async () => {
      const { getDb } = await import('@/lib/db/client')
      const { baUser } = await import('@/lib/db/schema')
      const { eq } = await import('drizzle-orm')

      const db = await getDb()
      const [user] = await db
        .select({ role: baUser.role })
        .from(baUser)
        .where(eq(baUser.email, normalized))
        .limit(1)

      return user?.role === 'superadmin' || user?.role === 'admin'
    })
  } catch {
    return false
  }
}

/** Get session and ensure Super Admin access or throw */
export async function requireSuperAdminSession(): Promise<SessionPayload & { isSuperAdmin: true }> {
  const session = await requireSession()
  const isAdmin = await isSuperAdmin(session.email)
  if (!isAdmin) {
    throw new Error('Access denied: Super Admin privileges required')
  }
  return { ...session, isSuperAdmin: true }
}
