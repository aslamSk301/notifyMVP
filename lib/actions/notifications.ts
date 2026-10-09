'use server'

import { revalidatePath } from 'next/cache'
import { eq, inArray, desc } from 'drizzle-orm'
import { z } from 'zod'
import { getDb } from '@/lib/db/client'
import { projects, notifications, topics } from '@/lib/db/schema'
import { requireSession } from '@/lib/auth/session'
import { dashboardStatsCacheKey, invalidateReadCache } from '@/lib/cache/read-cache'
import { sendNotificationCore } from '@/lib/send-notification-core'

const sendSchema = z.object({
  projectId:      z.string().min(1, 'Project is required'),
  title:          z.string().min(1, 'Title is required').max(100),
  body:           z.string().min(1, 'Body is required').max(500),
  target:         z.string().min(1).default('all'),
  url:            z.string().url('Action Link must be a valid URL').optional().or(z.literal('')),
  imageUrl:       z.string().url('Image URL must be a valid URL').optional().or(z.literal('')),
  iconUrl:        z.string().url('Icon URL must be a valid URL').optional().or(z.literal('')),
  externalUserId: z.string().optional(),
})

/** Fetch all notifications across all user projects */
export async function getAllNotifications() {
  try {
    const session = await requireSession()
    const db = await getDb()

    // Step 1 — get user project IDs + names
    const userProjects = await db
      .select({ id: projects.id, name: projects.name })
      .from(projects)
      .where(eq(projects.userId, session.userId))

    if (userProjects.length === 0) return { notifications: [] }

    const projectIds = userProjects.map((p) => p.id)
    const projectMap = Object.fromEntries(userProjects.map((p) => [p.id, p.name]))

    // Step 2 — fetch notifications (latest 100, paginated on client)
    const rows = await db
      .select()
      .from(notifications)
      .where(inArray(notifications.projectId, projectIds))
      .orderBy(desc(notifications.createdAt))
      .limit(100)

    const enriched = rows.map((n) => ({
      ...n,
      projects: { name: projectMap[n.projectId] ?? '—' },
    }))

    return { notifications: enriched }
  } catch (e) {
    return { notifications: [], error: (e as Error).message }
  }
}

/** Fetch notifications for a single project */
export async function getNotifications(projectId: string) {
  try {
    const session = await requireSession()
    const db = await getDb()

    // Verify ownership
    const [project] = await db
      .select({ id: projects.id })
      .from(projects)
      .where(eq(projects.id, projectId))
      .limit(1)

    if (!project) return { notifications: [], error: 'Project not found' }

    const rows = await db
      .select()
      .from(notifications)
      .where(eq(notifications.projectId, projectId))
      .orderBy(desc(notifications.createdAt))
      .limit(100)

    return { notifications: rows }
  } catch (e) {
    return { notifications: [], error: (e as Error).message }
  }
}

/** Fetch all topics for a project */
export async function getProjectTopics(projectId: string) {
  try {
    const session = await requireSession()
    const db = await getDb()

    const [project] = await db
      .select({ id: projects.id })
      .from(projects)
      .where(eq(projects.id, projectId))
      .limit(1)

    if (!project) return { topics: [] }

    const rows = await db
      .select()
      .from(topics)
      .where(eq(topics.projectId, projectId))
      .orderBy(topics.name)

    return { topics: rows }
  } catch (e) {
    return { topics: [], error: (e as Error).message }
  }
}

/** Send a push notification */
export async function sendNotification(_prev: unknown, formData: FormData) {
  const raw = {
    projectId:      formData.get('projectId') as string,
    title:          formData.get('title') as string,
    body:           formData.get('body') as string,
    target:         (formData.get('target') as string) || 'all',
    url:            (formData.get('url') as string) || undefined,
    imageUrl:       (formData.get('imageUrl') as string) || undefined,
    iconUrl:        (formData.get('iconUrl') as string) || undefined,
    externalUserId: (formData.get('externalUserId') as string) || undefined,
  }

  const parsed = sendSchema.safeParse(raw)
  if (!parsed.success) return { error: parsed.error.issues[0].message }

  try {
    const session = await requireSession()
    const db      = await getDb()

    const [project] = await db
      .select({
        id: projects.id,
        firebaseJsonPath: projects.firebaseJsonPath,
        firebaseCredentials: projects.firebaseCredentials,
      })
      .from(projects)
      .where(eq(projects.id, parsed.data.projectId))
      .limit(1)

    if (!project) return { error: 'Project not found' }
    if (!project.firebaseCredentials && !project.firebaseJsonPath) {
      return { error: 'No Firebase credentials uploaded for this project.' }
    }

    // Handle "send to specific user" target
    if (parsed.data.target === 'user') {
      if (!parsed.data.externalUserId?.trim()) {
        return { error: 'External User ID is required for "Send to User" target' }
      }

      const { eq: eqOp, and: andOp } = await import('drizzle-orm')
      const { devices: devicesTable } = await import('@/lib/db/schema')
      const { getProjectCredentials } = await import('@/lib/firebase/credentials-loader')
      const { sendMulticastNotification, validateFirebaseCredentials } = await import('@/lib/firebase/admin')

      const userDevices = await db
        .select({ fcmToken: devicesTable.fcmToken })
        .from(devicesTable)
        .where(andOp(
          eqOp(devicesTable.projectId, parsed.data.projectId),
          eqOp(devicesTable.externalUserId, parsed.data.externalUserId!),
        ))

      if (userDevices.length === 0) {
        return { error: `No devices found for user "${parsed.data.externalUserId}"` }
      }

      const credentials = await getProjectCredentials(project)
      if (!credentials) return { error: 'Failed to load Firebase credentials' }

      const v = validateFirebaseCredentials(credentials as unknown as Record<string, unknown>)
      if (!v.valid) return { error: v.error }

      const tokens = userDevices.map((d) => d.fcmToken).filter(Boolean)
      const result = await sendMulticastNotification(
        credentials as unknown as Parameters<typeof sendMulticastNotification>[0],
        tokens,
        parsed.data.title,
        parsed.data.body,
        {
          url: parsed.data.url,
          imageUrl: parsed.data.imageUrl,
          iconUrl: parsed.data.iconUrl,
        }
      )

      revalidatePath('/dashboard/notifications')
      await invalidateReadCache(dashboardStatsCacheKey(session.userId))
      return { success: true, recipientCount: result.successCount }
    }

    const result = await sendNotificationCore(
      session.userId,
      parsed.data.projectId,
      parsed.data.title,
      parsed.data.body,
      parsed.data.target,
      {
        url: parsed.data.url,
        imageUrl: parsed.data.imageUrl,
        iconUrl: parsed.data.iconUrl,
      }
    )

    if (!result.success) return { error: result.error ?? 'Failed to send notification' }

    revalidatePath('/dashboard/notifications')
    await invalidateReadCache(dashboardStatsCacheKey(session.userId))
    return { success: true, recipientCount: result.recipientCount ?? 0 }
  } catch (e) {
    return { error: (e as Error).message }
  }
}
