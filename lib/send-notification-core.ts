/**
 * Core notification send — OneSignal-style FCM topic fan-out.
 *
 * Broadcasts (all / OS / country / version / named topic) → one FCM topic call.
 * Segments and explicit token lists still walk D1.
 */

import { eq, and, or, inArray } from 'drizzle-orm'
import { getDb } from '@/lib/db/client'
import { projects, devices, notifications } from '@/lib/db/schema'
import { getProjectCredentials } from '@/lib/firebase/credentials-loader'
import {
  sendMulticastNotification,
  sendToTopic,
  validateFirebaseCredentials,
  type FirebaseCredentials,
} from '@/lib/firebase/admin'
import { generateSecureToken } from '@/lib/utils'
import { resolveAudienceTarget } from '@/lib/utils/topic-normalizer'
import { querySegmentDeviceTokens } from '@/lib/services/segment-service'

export interface SendResult {
  success:         boolean
  notificationId?: string
  recipientCount?: number
  failureCount?:   number
  matchedDevices?: number
  status?:         'sent' | 'failed'
  error?:          string
}

export interface SendNotificationOptions {
  url?: string
  imageUrl?: string
  iconUrl?: string
  data?: Record<string, string>
  saveToDb?: boolean
  tokens?: string[]
}

/**
 * @param target  'all' | 'android' | 'ios' | 'version:2' | 'country:IN'
 *                | 'topic:{name}' | 'segment:{id}' | 'tokens'
 */
export async function sendNotificationCore(
  userId:    string,
  projectId: string,
  title:     string,
  body:      string,
  target:    string = 'all',
  options?:  SendNotificationOptions
): Promise<SendResult> {
  const db = await getDb()

  const [project] = await db
    .select()
    .from(projects)
    .where(eq(projects.id, projectId))
    .limit(1)

  if (!project || project.userId !== userId) {
    return { success: false, error: 'Project not found' }
  }

  const credentials = (await getProjectCredentials(project)) as unknown as FirebaseCredentials | null
  if (!credentials) {
    return { success: false, error: 'No Firebase credentials configured for this project' }
  }

  const validation = validateFirebaseCredentials(credentials as unknown as Record<string, unknown>)
  if (!validation.valid) {
    return { success: false, error: `Invalid Firebase credentials: ${validation.error}` }
  }

  const shouldSaveToDb = options?.saveToDb !== false
  const audience = resolveAudienceTarget(project.appId, target)
  const notificationId = generateSecureToken(16)
  const targetType =
    options?.tokens && options.tokens.length > 0 ? 'device' :
    audience.kind === 'segment' ? 'segment' :
    audience.kind === 'user' ? 'device' : 'topic'
  const targetValue =
    options?.tokens && options.tokens.length > 0 ? `${options.tokens.length} direct tokens` :
    audience.kind === 'topic' ? audience.topic :
    audience.kind === 'segment' ? audience.segmentId :
    audience.kind === 'user' ? audience.userId :
    target

  if (shouldSaveToDb) {
    await db.insert(notifications).values({
      id: notificationId,
      projectId,
      name: title,
      title,
      body,
      url: options?.url ?? null,
      imageUrl: options?.imageUrl ?? null,
      target,
      targetType,
      targetValue,
      status: 'pending',
      recipientCount: 0,
    })
  }

  const fcmSendOptions = {
    url: options?.url,
    imageUrl: options?.imageUrl,
    iconUrl: options?.iconUrl,
    data: options?.data,
  }

  let successCount = 0
  let failureCount = 0
  let finalStatus: 'completed' | 'failed' = 'failed'

  try {
    if (options?.tokens && options.tokens.length > 0) {
      const directTokens = options.tokens.filter(Boolean)
      const result = await sendMulticastNotification(credentials, directTokens, title, body, fcmSendOptions)
      successCount = result.successCount
      failureCount = result.failureCount
      finalStatus  = successCount > 0 || directTokens.length === 0 ? 'completed' : 'failed'
      if (result.deadTokens.length > 0) {
        await db
          .update(devices)
          .set({ status: 'inactive', inactiveAt: new Date().toISOString() })
          .where(inArray(devices.fcmToken, result.deadTokens))
      }
    } else if (audience.kind === 'topic') {
      const result = await sendToTopic(
        credentials,
        audience.topic,
        title,
        body,
        fcmSendOptions,
      )
      if (!result.success) {
        if (shouldSaveToDb) {
          await db.update(notifications)
            .set({ status: 'failed', sentAt: new Date().toISOString() })
            .where(eq(notifications.id, notificationId))
        }
        return {
          success: false,
          error: result.error || 'FCM topic send failed',
          notificationId: shouldSaveToDb ? notificationId : undefined,
        }
      }
      // FCM topic delivery does not need a subscriber count. Counting devices
      // or device_topics here scanned D1 on every country-topic send.
      successCount = 0
      finalStatus = 'completed'
    } else if (audience.kind === 'segment') {
      const targetDevices = await querySegmentDeviceTokens(projectId, audience.segmentId)
      const tokens = targetDevices.map((d) => d.fcmToken).filter(Boolean)
      const result = await sendMulticastNotification(credentials, tokens, title, body, fcmSendOptions)
      successCount = result.successCount
      failureCount = result.failureCount
      finalStatus  = successCount > 0 || tokens.length === 0 ? 'completed' : 'failed'
      if (result.deadTokens.length > 0) {
        await db
          .update(devices)
          .set({ status: 'inactive', inactiveAt: new Date().toISOString() })
          .where(inArray(devices.fcmToken, result.deadTokens))
      }
    } else if (audience.kind === 'user') {
      if (!audience.userId) {
        return { success: false, error: 'User id is required' }
      }

      // D1 read replicas can be stale after a recent device register/link.
      // Retry once after a short delay so the replica catches up.
      const MAX_USER_LOOKUP_ATTEMPTS = 2
      const REPLICA_LAG_DELAY_MS     = 1500
      let tokens: string[] = []
      let rawDeviceCount = 0

      for (let attempt = 1; attempt <= MAX_USER_LOOKUP_ATTEMPTS; attempt++) {
        const deviceRows = await db
          .select({ fcmToken: devices.fcmToken })
          .from(devices)
          .where(and(
            eq(devices.projectId, projectId),
            eq(devices.status, 'active'),
            or(
              eq(devices.externalUserId, audience.userId),
              eq(devices.userId, audience.userId),
            ),
          ))
        rawDeviceCount = deviceRows.length
        tokens = deviceRows
          .map((d) => d.fcmToken)
          .filter((t): t is string => Boolean(t) && !String(t).startsWith('pending_'))

        if (tokens.length > 0) break

        // If no active devices found, also try without status filter (device
        // may still be 'active' but column never written on older rows).
        if (rawDeviceCount === 0) {
          const fallbackRows = await db
            .select({ fcmToken: devices.fcmToken })
            .from(devices)
            .where(and(
              eq(devices.projectId, projectId),
              or(
                eq(devices.externalUserId, audience.userId),
                eq(devices.userId, audience.userId),
              ),
            ))
          rawDeviceCount = fallbackRows.length
          tokens = fallbackRows
            .map((d) => d.fcmToken)
            .filter((t): t is string => Boolean(t) && !String(t).startsWith('pending_'))
          if (tokens.length > 0) break
        }

        if (attempt < MAX_USER_LOOKUP_ATTEMPTS) {
          console.log(
            `[Send] 0 devices for user "${audience.userId}" (attempt ${attempt}) — ` +
            `retrying after ${REPLICA_LAG_DELAY_MS}ms (D1 replica lag)…`
          )
          await new Promise(r => setTimeout(r, REPLICA_LAG_DELAY_MS))
        }
      }

      if (tokens.length === 0) {
        if (shouldSaveToDb) {
          await db.update(notifications)
            .set({ status: 'failed', sentAt: new Date().toISOString(), recipientCount: 0 })
            .where(eq(notifications.id, notificationId))
        }
        return {
          success: false,
          error: `No devices linked to external user "${audience.userId}"`,
          notificationId: shouldSaveToDb ? notificationId : undefined,
          recipientCount: 0,
          matchedDevices: rawDeviceCount,
        }
      }

      const result = await sendMulticastNotification(credentials, tokens, title, body, fcmSendOptions)
      successCount = result.successCount
      failureCount = result.failureCount
      finalStatus  = successCount > 0 ? 'completed' : 'failed'

      if (result.deadTokens.length > 0) {
        await db
          .update(devices)
          .set({ status: 'inactive', inactiveAt: new Date().toISOString() })
          .where(inArray(devices.fcmToken, result.deadTokens))
      }

      if (successCount === 0) {
        if (shouldSaveToDb) {
          await db.update(notifications)
            .set({ status: 'failed', sentAt: new Date().toISOString(), recipientCount: 0 })
            .where(eq(notifications.id, notificationId))
        }
        return {
          success: false,
          error: `Linked devices found (${tokens.length}) but FCM delivered to 0`,
          notificationId: shouldSaveToDb ? notificationId : undefined,
          recipientCount: 0,
          matchedDevices: tokens.length,
          failureCount,
        }
      }
    } else {
      const deviceRows = await db
        .select({ fcmToken: devices.fcmToken })
        .from(devices)
        .where(eq(devices.projectId, projectId))
      const tokens = deviceRows.map((d) => d.fcmToken).filter(Boolean)
      const result = await sendMulticastNotification(credentials, tokens, title, body, fcmSendOptions)
      successCount = result.successCount
      failureCount = result.failureCount
      finalStatus  = successCount > 0 || tokens.length === 0 ? 'completed' : 'failed'
    }
  } catch (err) {
    console.error('[Send] Error:', err)
    return {
      success: false,
      error: err instanceof Error ? err.message : 'Send failed',
    }
  }

  if (shouldSaveToDb) {
    await db
      .update(notifications)
      .set({ status: finalStatus, sentAt: new Date().toISOString(), recipientCount: successCount })
      .where(eq(notifications.id, notificationId))
  }

  return {
    success: true,
    notificationId: shouldSaveToDb ? notificationId : undefined,
    recipientCount: successCount,
    failureCount,
    status: finalStatus === 'completed' ? 'sent' : 'failed',
  }
}
