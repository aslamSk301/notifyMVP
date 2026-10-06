/**
 * Keep FCM topic membership in sync with device attributes.
 * D1 device_topics is a dashboard mirror — send path uses FCM topics, not this table.
 */

import { and, eq, inArray } from 'drizzle-orm'
import { getDb } from '@/lib/db/client'
import { deviceTopics, topics } from '@/lib/db/schema'
import { getProjectCredentials } from '@/lib/firebase/credentials-loader'
import {
  subscribeTokensToTopic,
  unsubscribeTokensFromTopic,
  type FirebaseCredentials,
} from '@/lib/firebase/admin'
import { generateSecureToken } from '@/lib/utils'
import {
  buildSystemTopicNames,
  systemTopicColumns,
  type DeviceTopicAttrs,
} from '@/lib/utils/topic-normalizer'

function isUsableToken(token?: string | null): token is string {
  return !!token && !token.startsWith('pending_')
}

async function ensureSystemTopic(
  projectId: string,
  appId: string,
  name: string
): Promise<string> {
  const db = await getDb()
  const meta = systemTopicColumns(name, appId)
  const [existing] = await db
    .select({ id: topics.id })
    .from(topics)
    .where(and(eq(topics.projectId, projectId), eq(topics.name, name)))
    .limit(1)

  if (existing?.id) {
    return existing.id
  }

  const id = generateSecureToken(16)
  await db
    .insert(topics)
    .values({
      id,
      projectId,
      name,
      kind: 'system',
      description: meta.description,
      isActive: true,
    })
    .onConflictDoNothing()

  const [row] = await db
    .select({ id: topics.id })
    .from(topics)
    .where(and(eq(topics.projectId, projectId), eq(topics.name, name)))
    .limit(1)

  return row?.id ?? id
}

export async function syncDeviceSystemTopics(opts: {
  projectId: string
  appId: string
  dbDeviceId: string
  fcmToken?: string | null
  previousToken?: string | null
  firebaseJsonPath?: string | null
  firebaseCredentials?: string | null
  next: DeviceTopicAttrs
  previous?: DeviceTopicAttrs | null
}): Promise<string[]> {
  const nextNames = buildSystemTopicNames(opts.appId, opts.next)
  const prevNames = opts.previous
    ? buildSystemTopicNames(opts.appId, opts.previous)
    : []

  const toUnsubscribe = prevNames.filter((n) => !nextNames.includes(n))

  const db = await getDb()

  // Pre-fetch existing device topics to avoid issuing duplicate INSERT writes to D1
  const existingRows = await db
    .select({ topicId: deviceTopics.topicId })
    .from(deviceTopics)
    .where(eq(deviceTopics.deviceId, opts.dbDeviceId))
  const existingTopicIds = new Set(existingRows.map((r) => r.topicId))

  for (const name of nextNames) {
    try {
      const topicId = await ensureSystemTopic(opts.projectId, opts.appId, name)
      if (!existingTopicIds.has(topicId)) {
        await db
          .insert(deviceTopics)
          .values({
            id: generateSecureToken(16),
            deviceId: opts.dbDeviceId,
            topicId,
            assignedBy: 'system',
          })
          .onConflictDoNothing()
        existingTopicIds.add(topicId)
      }
    } catch (err) {
      console.error('[Topics] Failed to persist system topic', name, err)
    }
  }

  if (toUnsubscribe.length > 0) {
    try {
      const stale = await db
        .select({ id: topics.id, name: topics.name })
        .from(topics)
        .where(and(eq(topics.projectId, opts.projectId), inArray(topics.name, toUnsubscribe)))

      const staleIds = stale.map((t) => t.id)
      if (staleIds.length > 0) {
        await db
          .delete(deviceTopics)
          .where(and(eq(deviceTopics.deviceId, opts.dbDeviceId), inArray(deviceTopics.topicId, staleIds)))
      }
    } catch (err) {
      console.error('[Topics] Failed to drop stale device topics', err)
    }
  }

  try {
    const creds = (await getProjectCredentials({
      id: opts.projectId,
      firebaseCredentials: opts.firebaseCredentials,
      firebaseJsonPath: opts.firebaseJsonPath,
    })) as unknown as FirebaseCredentials | null
    const nextToken = isUsableToken(opts.fcmToken) ? opts.fcmToken : null
    const oldToken =
      isUsableToken(opts.previousToken) && opts.previousToken !== nextToken
        ? opts.previousToken
        : null

    if (creds && oldToken && prevNames.length > 0) {
      await Promise.allSettled(
        prevNames.map((topic) => unsubscribeTokensFromTopic(creds, [oldToken], topic))
      )
    }

    if (creds && nextToken) {
      if (toUnsubscribe.length > 0) {
        await Promise.allSettled(
          toUnsubscribe.map((topic) => unsubscribeTokensFromTopic(creds, [nextToken], topic))
        )
      }

      await Promise.allSettled(
        nextNames.map((topic) => subscribeTokensToTopic(creds, [nextToken], topic))
      )
    }
  } catch (err) {
    console.error('[Topics] FCM topic subscribe failed (D1 already saved):', err)
  }

  return nextNames
}
