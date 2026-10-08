'use server'

import { revalidatePath } from 'next/cache'
import { eq, and, sql, desc, inArray } from 'drizzle-orm'
import { z } from 'zod'
import { hashPassword } from '@better-auth/utils/password'
import { getDb } from '@/lib/db/client'
import {
  baUser,
  baAccount,
  baSession,
  users,
  projects,
  devices,
  topics,
  segments,
  segmentRules,
  notificationCampaigns,
  notificationLogs,
  notificationEvents,
} from '@/lib/db/schema'
import { requireSuperAdminSession } from '@/lib/auth/session'
import { ensureUsersRow } from '@/lib/auth/ensure-user'
import { generateSecureToken } from '@/lib/utils'
import { deleteFromR2 } from '@/lib/r2/client'

// ── Validation Schemas ────────────────────────────────────────────────────────

const createUserSchema = z.object({
  name: z.string().min(1, 'Name is required').max(100),
  email: z.string().email('Invalid email address'),
  password: z.string().min(6, 'Password must be at least 6 characters'),
  role: z.enum(['user', 'admin', 'superadmin']).default('user'),
})

const updateUserSchema = z.object({
  userId: z.string().min(1, 'User ID is required'),
  name: z.string().min(1, 'Name is required').max(100).optional(),
  email: z.string().email('Invalid email address').optional(),
  role: z.enum(['user', 'admin', 'superadmin']).optional(),
  status: z.enum(['active', 'suspended']).optional(),
  password: z.string().min(6, 'Password must be at least 6 characters').optional().or(z.literal('')),
})

export interface AdminUserData {
  id: string
  name: string
  email: string
  image: string | null
  role: string
  status: string
  emailVerified: boolean
  providers: string[]
  projectCount: number
  createdAt: string
  updatedAt: string
}

// ── Read Users ────────────────────────────────────────────────────────────────

export async function getAdminUsers(): Promise<{
  users: AdminUserData[]
  stats: {
    total: number
    googleCount: number
    credentialCount: number
    superAdminCount: number
    activeCount: number
  }
  error?: string
}> {
  try {
    await requireSuperAdminSession()
    const db = await getDb()

    // 1. Fetch all users from ba_user
    const allBaUsers = await db
      .select()
      .from(baUser)
      .orderBy(desc(baUser.createdAt))

    if (!allBaUsers.length) {
      return {
        users: [],
        stats: { total: 0, googleCount: 0, credentialCount: 0, superAdminCount: 0, activeCount: 0 },
      }
    }

    const userIds = allBaUsers.map((u) => u.id)

    // 2. Fetch associated accounts to detect auth providers
    const accounts = await db
      .select({
        userId: baAccount.userId,
        providerId: baAccount.providerId,
      })
      .from(baAccount)
      .where(inArray(baAccount.userId, userIds))

    const providersByUserId: Record<string, string[]> = {}
    for (const acc of accounts) {
      if (!providersByUserId[acc.userId]) providersByUserId[acc.userId] = []
      if (!providersByUserId[acc.userId].includes(acc.providerId)) {
        providersByUserId[acc.userId].push(acc.providerId)
      }
    }

    // 3. Count projects per user
    const projectRows = await db
      .select({
        userId: projects.userId,
        count: sql<number>`count(${projects.id})`,
      })
      .from(projects)
      .where(inArray(projects.userId, userIds))
      .groupBy(projects.userId)

    const projectCountByUserId: Record<string, number> = {}
    for (const p of projectRows) {
      projectCountByUserId[p.userId] = Number(p.count) || 0
    }

    // 4. Map into rich AdminUserData objects
    let googleCount = 0
    let credentialCount = 0
    let superAdminCount = 0
    let activeCount = 0

    const formattedUsers: AdminUserData[] = allBaUsers.map((u) => {
      const userProviders = providersByUserId[u.id] || []
      if (userProviders.includes('google')) googleCount++
      if (userProviders.includes('credential')) credentialCount++
      if (u.role === 'superadmin' || u.role === 'admin') superAdminCount++
      if (u.status !== 'suspended') activeCount++

      return {
        id: u.id,
        name: u.name,
        email: u.email,
        image: u.image,
        role: u.role || 'user',
        status: u.status || 'active',
        emailVerified: Boolean(u.emailVerified),
        providers: userProviders.length ? userProviders : ['unknown'],
        projectCount: projectCountByUserId[u.id] || 0,
        createdAt: String(u.createdAt),
        updatedAt: String(u.updatedAt),
      }
    })

    return {
      users: formattedUsers,
      stats: {
        total: formattedUsers.length,
        googleCount,
        credentialCount,
        superAdminCount,
        activeCount,
      },
    }
  } catch (err) {
    console.error('[getAdminUsers] error:', err)
    return {
      users: [],
      stats: { total: 0, googleCount: 0, credentialCount: 0, superAdminCount: 0, activeCount: 0 },
      error: (err as Error).message,
    }
  }
}

// ── Create User ───────────────────────────────────────────────────────────────

export async function createAdminUser(raw: {
  name: string
  email: string
  password: string
  role?: string
}) {
  try {
    await requireSuperAdminSession()

    const parsed = createUserSchema.safeParse(raw)
    if (!parsed.success) {
      return { error: parsed.error.issues[0]?.message ?? 'Invalid input data' }
    }

    const { name, email, password, role } = parsed.data
    const normalizedEmail = email.trim().toLowerCase()
    const db = await getDb()

    // Check if email already exists in ba_user or users
    const [existingBaUser] = await db
      .select({ id: baUser.id })
      .from(baUser)
      .where(eq(baUser.email, normalizedEmail))
      .limit(1)

    if (existingBaUser) {
      return { error: 'A user with this email address already exists.' }
    }

    const userId = generateSecureToken(16)
    const accountId = generateSecureToken(16)
    const hashedPassword = await hashPassword(password)
    const now = new Date()

    // 1. Insert into ba_user
    await db.insert(baUser).values({
      id: userId,
      name: name.trim(),
      email: normalizedEmail,
      emailVerified: true,
      image: null,
      role,
      status: 'active',
      createdAt: now,
      updatedAt: now,
    })

    // 2. Insert into ba_account (credential provider)
    await db.insert(baAccount).values({
      id: accountId,
      accountId: userId,
      providerId: 'credential',
      userId,
      password: hashedPassword,
      createdAt: now,
      updatedAt: now,
    })

    await ensureUsersRow(db, {
      id: userId,
      email: normalizedEmail,
      name: name.trim(),
    })

    revalidatePath('/dashboard/admin')
    return {
      success: true,
      user: { id: userId, name, email: normalizedEmail, role },
    }
  } catch (err) {
    console.error('[createAdminUser] error:', err)
    return { error: (err as Error).message || 'Failed to create user' }
  }
}

// ── Update User ───────────────────────────────────────────────────────────────

export async function updateAdminUser(raw: {
  userId: string
  name?: string
  email?: string
  role?: 'user' | 'admin' | 'superadmin'
  status?: 'active' | 'suspended'
  password?: string
}) {
  try {
    await requireSuperAdminSession()

    const parsed = updateUserSchema.safeParse(raw)
    if (!parsed.success) {
      return { error: parsed.error.issues[0]?.message ?? 'Invalid input data' }
    }

    const { userId, name, email, role, status, password } = parsed.data
    const db = await getDb()

    // Check user exists
    const [existing] = await db
      .select()
      .from(baUser)
      .where(eq(baUser.id, userId))
      .limit(1)

    if (!existing) {
      return { error: 'User not found in database' }
    }

    const updates: Partial<typeof baUser.$inferInsert> = {
      updatedAt: new Date(),
    }

    if (name) updates.name = name.trim()

    let newEmail = existing.email
    if (email && email.toLowerCase().trim() !== existing.email) {
      newEmail = email.toLowerCase().trim()
      // Ensure unique email
      const [duplicate] = await db
        .select({ id: baUser.id })
        .from(baUser)
        .where(eq(baUser.email, newEmail))
        .limit(1)

      if (duplicate && duplicate.id !== userId) {
        return { error: 'Another user already uses this email address' }
      }
      updates.email = newEmail
    }

    if (role) updates.role = role
    if (status) updates.status = status

    // Update ba_user
    await db.update(baUser).set(updates).where(eq(baUser.id, userId))

    // Update users mirror table
    try {
      await db
        .update(users)
        .set({ email: newEmail })
        .where(eq(users.id, userId))
    } catch {}

    // Handle Password Update / Reset
    if (password && password.trim().length >= 6) {
      const hashedPassword = await hashPassword(password.trim())
      const now = new Date()
      const nowIso = now.toISOString()

      // Check if user has an existing credential account
      const [existingCredentialAcc] = await db
        .select()
        .from(baAccount)
        .where(
          and(
            eq(baAccount.userId, userId),
            eq(baAccount.providerId, 'credential')
          )
        )
        .limit(1)

      if (existingCredentialAcc) {
        await db
          .update(baAccount)
          .set({
            password: hashedPassword,
            updatedAt: now,
          })
          .where(eq(baAccount.id, existingCredentialAcc.id))
      } else {
        // Link new credential account (e.g. user was Google-only before)
        await db.insert(baAccount).values({
          id: generateSecureToken(16),
          accountId: userId,
          providerId: 'credential',
          userId,
          password: hashedPassword,
          createdAt: now,
          updatedAt: now,
        })
      }

      // Update mirror users table passwordHash
      try {
        await db
          .update(users)
          .set({ passwordHash: hashedPassword })
          .where(eq(users.id, userId))
      } catch {}
    }

    // If suspended, revoke all active sessions immediately
    if (status === 'suspended') {
      await db.delete(baSession).where(eq(baSession.userId, userId))
    }

    revalidatePath('/dashboard/admin')
    return { success: true }
  } catch (err) {
    console.error('[updateAdminUser] error:', err)
    return { error: (err as Error).message || 'Failed to update user' }
  }
}

// ── Delete User ───────────────────────────────────────────────────────────────

export async function deleteAdminUser(userId: string) {
  try {
    const session = await requireSuperAdminSession()

    if (session.userId === userId) {
      return { error: 'You cannot delete your own Super Admin account' }
    }

    const db = await getDb()

    // 1. Fetch user projects to clean up any R2 Firebase service account files
    const userProjects = await db
      .select({ id: projects.id, firebaseJsonPath: projects.firebaseJsonPath })
      .from(projects)
      .where(eq(projects.userId, userId))

    for (const proj of userProjects) {
      if (proj.firebaseJsonPath) {
        try {
          await deleteFromR2(proj.firebaseJsonPath)
        } catch (r2Err) {
          console.warn('[deleteAdminUser] R2 cleanup warning:', r2Err)
        }
      }
    }

    const projectIds = userProjects.map((p) => p.id)

    // 2. Cascade delete project sub-entities if projects exist
    if (projectIds.length > 0) {
      // Find campaigns
      const campaigns = await db
        .select({ id: notificationCampaigns.id })
        .from(notificationCampaigns)
        .where(inArray(notificationCampaigns.projectId, projectIds))

      const campaignIds = campaigns.map((c) => c.id)

      if (campaignIds.length > 0) {
        await db.delete(notificationEvents).where(inArray(notificationEvents.campaignId, campaignIds))
        await db.delete(notificationLogs).where(inArray(notificationLogs.campaignId, campaignIds))
        await db.delete(notificationCampaigns).where(inArray(notificationCampaigns.id, campaignIds))
      }

      // Find segments
      const userSegments = await db
        .select({ id: segments.id })
        .from(segments)
        .where(inArray(segments.projectId, projectIds))

      const segmentIds = userSegments.map((s) => s.id)
      if (segmentIds.length > 0) {
        await db.delete(segmentRules).where(inArray(segmentRules.segmentId, segmentIds))
        await db.delete(segments).where(inArray(segments.id, segmentIds))
      }

      await db.delete(topics).where(inArray(topics.projectId, projectIds))
      await db.delete(devices).where(inArray(devices.projectId, projectIds))
      await db.delete(projects).where(inArray(projects.id, projectIds))
    }

    // 3. Delete auth sessions, accounts, and user records
    await db.delete(baSession).where(eq(baSession.userId, userId))
    await db.delete(baAccount).where(eq(baAccount.userId, userId))
    await db.delete(baUser).where(eq(baUser.id, userId))
    try {
      await db.delete(users).where(eq(users.id, userId))
    } catch {}

    revalidatePath('/dashboard/admin')
    return { success: true }
  } catch (err) {
    console.error('[deleteAdminUser] error:', err)
    return { error: (err as Error).message || 'Failed to delete user' }
  }
}
