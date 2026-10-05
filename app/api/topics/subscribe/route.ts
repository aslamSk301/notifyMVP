import { NextRequest, NextResponse } from 'next/server'
import { eq, and } from 'drizzle-orm'
import { z } from 'zod'
import { getDb } from '@/lib/db/client'
import { projects, devices, topics, deviceTopics } from '@/lib/db/schema'
import { subscribeTokensToTopic } from '@/lib/firebase/admin'
import { getProjectCredentials } from '@/lib/firebase/credentials-loader'
import { generateSecureToken } from '@/lib/utils'
import type { FirebaseCredentials } from '@/lib/firebase/admin'

/**
 * POST /api/topics/subscribe
 *
 * Subscribe a device to a topic.
 * Auth: appId + apiKey
 */

const schema = z.object({
  appId:    z.string().min(1),
  apiKey:   z.string().min(1),
  fcmToken: z.string().min(1),
  topic:    z.string().min(1).regex(/^[a-zA-Z0-9_-]+$/, 'Topic name must be alphanumeric'),
})

export async function POST(request: NextRequest) {
  let body: unknown
  try { body = await request.json() }
  catch { return NextResponse.json({ success: false, error: 'Invalid JSON body' }, { status: 400 }) }

  const parsed = schema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ success: false, error: parsed.error.issues[0].message }, { status: 400 })
  }

  const { appId, apiKey, fcmToken, topic } = parsed.data
  const db = await getDb()

  const [project] = await db
    .select()
    .from(projects)
    .where(and(eq(projects.appId, appId), eq(projects.apiKey, apiKey)))
    .limit(1)

  if (!project) {
    return NextResponse.json({ success: false, error: 'Invalid appId or apiKey' }, { status: 401 })
  }

  const credentials = (await getProjectCredentials(project)) as unknown as FirebaseCredentials | null
  if (!credentials) {
    return NextResponse.json({ success: false, error: 'No Firebase credentials configured' }, { status: 422 })
  }

  // Subscribe via FCM IID API
  const result = await subscribeTokensToTopic(credentials, [fcmToken], topic)

  // Save topic + link this device so the dashboard Topics column is not empty.
  const [existingTopic] = await db
    .select({ id: topics.id })
    .from(topics)
    .where(and(eq(topics.projectId, project.id), eq(topics.name, topic)))
    .limit(1)

  let topicId = existingTopic?.id
  if (!topicId) {
    topicId = generateSecureToken(16)
    await db.insert(topics).values({
      id:        topicId,
      projectId: project.id,
      name:      topic,
      type:      'custom',
    }).onConflictDoNothing()

    const [row] = await db
      .select({ id: topics.id })
      .from(topics)
      .where(and(eq(topics.projectId, project.id), eq(topics.name, topic)))
      .limit(1)
    topicId = row?.id ?? topicId
  }

  const [device] = await db
    .select({ id: devices.id })
    .from(devices)
    .where(and(eq(devices.projectId, project.id), eq(devices.fcmToken, fcmToken)))
    .limit(1)

  if (device) {
    await db.insert(deviceTopics).values({
      id:         generateSecureToken(16),
      deviceId:   device.id,
      topicId,
      assignedBy: 'sdk',
    }).onConflictDoNothing()
  }

  return NextResponse.json({
    success:      result.successCount > 0,
    successCount: result.successCount,
    failureCount: result.failureCount,
  })
}
