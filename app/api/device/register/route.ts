import { NextRequest, NextResponse } from 'next/server'
import { eq, and } from 'drizzle-orm'
import { z } from 'zod'
import { getDb } from '@/lib/db/client'
import { projects, devices, deviceTopics } from '@/lib/db/schema'
import { generateSecureToken } from '@/lib/utils'
import { countryFromRequest, buildSystemTopicNames } from '@/lib/utils/topic-normalizer'
import { syncDeviceSystemTopics } from '@/lib/services/topic-sync'

/**
 * POST /api/device/register
 *
 * Public endpoint — appId + apiKey.
 * Subscribes the FCM token to system topics (all / OS / country / language / version).
 */

const schema = z.object({
  appId:          z.string().min(1, 'appId is required'),
  apiKey:         z.string().min(1, 'apiKey is required'),
  fcmToken:       z.string().optional().default(''),
  platform:       z.enum(['android', 'ios', 'flutter', 'react-native']),
  deviceId:       z.string().min(1, 'deviceId is required'),
  appVersion:     z.string().optional(),
  deviceModel:    z.string().optional(),
  deviceOs:       z.string().optional(),
  language:       z.string().optional(),
  timezone:       z.string().optional(),
  country:        z.string().optional(),
  externalUserId: z.string().optional(),
  sdkVersion:     z.string().optional(),
})

export async function POST(request: NextRequest) {
  try {
    let body: unknown
    try { body = await request.json() }
    catch { return NextResponse.json({ success: false, error: 'Invalid JSON body' }, { status: 400 }) }

    const parsed = schema.safeParse(body)
    if (!parsed.success) {
      return NextResponse.json(
        { success: false, error: parsed.error.issues[0].message },
        { status: 400 }
      )
    }

    const {
      appId, apiKey, fcmToken, platform, deviceId,
      appVersion, deviceModel, deviceOs, language,
      timezone, externalUserId, sdkVersion,
    } = parsed.data

    const country = countryFromRequest(request.headers, parsed.data.country)

    const db = await getDb()

    const [project] = await db
      .select({
        id: projects.id,
        appId: projects.appId,
        firebaseJsonPath: projects.firebaseJsonPath,
        firebaseCredentials: projects.firebaseCredentials,
      })
      .from(projects)
      .where(and(eq(projects.appId, appId), eq(projects.apiKey, apiKey)))
      .limit(1)

    if (!project) {
      return NextResponse.json({ success: false, error: 'Invalid appId or apiKey' }, { status: 401 })
    }

    const now = new Date().toISOString()

    const [existing] = await db
      .select()
      .from(devices)
      .where(and(eq(devices.projectId, project.id), eq(devices.deviceId, deviceId)))
      .limit(1)

    const oldToken = existing?.fcmToken
    const activeToken = fcmToken || oldToken || `pending_${deviceId}`
    const targetDbDeviceId = existing?.id || generateSecureToken(16)
    const linkedUserId = externalUserId ?? existing?.externalUserId ?? existing?.userId ?? null

    const topicAttrsChanged =
      !existing ||
      existing.country !== country ||
      (language !== undefined && existing.language !== language) ||
      (appVersion !== undefined && existing.appVersion !== appVersion) ||
      (deviceOs !== undefined && (existing.deviceOs ?? existing.osVersion) !== deviceOs) ||
      oldToken !== activeToken

    const lastUpdated = existing?.updatedAt ? new Date(existing.updatedAt).getTime() : 0
    const isRecent = Date.now() - lastUpdated < 60 * 60 * 1000 // 1 hour
    const sameUser =
      existing &&
      (existing.userId === (externalUserId ?? linkedUserId) ||
        existing.externalUserId === (externalUserId ?? linkedUserId))

    const nextAttrs = {
      platform,
      deviceOs:   deviceOs ?? existing?.deviceOs,
      country:    country ?? existing?.country,
      language:   language ?? existing?.language,
      appVersion: appVersion ?? existing?.appVersion,
    }

    // Same device, same attributes: skip the device-row write.
    // Flutter / RN devices that already have topic rows stay on this path.
    // A device with zero topic rows (older Android register) gets one backfill.
    if (existing && !topicAttrsChanged && sameUser) {
      // Registration happens at app launch. Refresh activity even on the
      // fast path so the scheduled dormant-device cleanup never deactivates a
      // user who is actively opening the app.
      await db
        .update(devices)
        .set({
          status: 'active',
          subscriptionStatus: 'subscribed',
          lastOpen: now,
          lastActive: now,
          inactiveAt: null,
          updatedAt: now,
        })
        .where(eq(devices.id, targetDbDeviceId))

      let topicNames = buildSystemTopicNames(project.appId, nextAttrs)
      const [linked] = await db
        .select({ id: deviceTopics.id })
        .from(deviceTopics)
        .where(eq(deviceTopics.deviceId, targetDbDeviceId))
        .limit(1)

      if (!linked) {
        try {
          topicNames = await syncDeviceSystemTopics({
            projectId:        project.id,
            appId:            project.appId,
            dbDeviceId:       targetDbDeviceId,
            fcmToken:         activeToken,
            previousToken:    oldToken,
            firebaseJsonPath:    project.firebaseJsonPath,
            firebaseCredentials: project.firebaseCredentials,
            next:             nextAttrs,
            previous:         null,
          })
        } catch (topicErr) {
          console.error('[Topics] Backfill failed:', topicErr)
        }
      }

      return NextResponse.json({
        success: true,
        message: 'Device already registered and up to date',
        subscriptionId: targetDbDeviceId,
        data: {
          deviceId,
          platform,
          subscriptionId: targetDbDeviceId,
          topics: topicNames,
          externalUserId: linkedUserId,
        },
      })
    }

    try {
      if (existing) {
        await db
          .update(devices)
          .set({
            fcmToken:           activeToken,
            platform,
            appVersion:         appVersion     ?? undefined,
            deviceModel:        deviceModel    ?? undefined,
            deviceOs:           deviceOs       ?? undefined,
            language:           language       ?? undefined,
            timezone:           timezone       ?? undefined,
            country:            country        ?? undefined,
            // NEVER wipe external user link on plain re-register / sync.
            ...(externalUserId
              ? { userId: externalUserId, externalUserId }
              : linkedUserId
                ? { userId: linkedUserId, externalUserId: linkedUserId }
                : {}),
            sdkVersion:         sdkVersion     ?? undefined,
            subscriptionStatus: 'subscribed',
            status:             'active',
            lastOpen:            now,
            lastActive:         now,
            inactiveAt:          null,
            updatedAt:          now,
          })
          .where(and(eq(devices.projectId, project.id), eq(devices.deviceId, deviceId)))
      } else {
        await db.insert(devices).values({
          id:                     targetDbDeviceId,
          projectId:              project.id,
          deviceId,
          fcmToken:               activeToken,
          platform,
          appVersion:             appVersion     ?? null,
          deviceModel:            deviceModel    ?? null,
          deviceOs:               deviceOs       ?? null,
          language:               language       ?? null,
          timezone:               timezone       ?? null,
          country:                country        ?? null,
          userId:                 externalUserId ?? null,
          externalUserId:         externalUserId ?? null,
          sdkVersion:             sdkVersion     ?? null,
          subscriptionStatus:     'subscribed',
          notificationPermission: 'granted',
          status:                 'active',
          lastOpen:               now,
          lastActive:             now,
          createdAt:              now,
          updatedAt:              now,
        })
      }
    } catch (writeErr) {
      console.warn('[Device Register] D1 write failed (temporary block or error):', writeErr)
      if (existing) {
        return NextResponse.json({
          success: true,
          message: 'Device already registered (cached)',
          subscriptionId: targetDbDeviceId,
          data: {
            deviceId,
            platform,
            subscriptionId: targetDbDeviceId,
            topics: buildSystemTopicNames(project.appId, nextAttrs),
            externalUserId: linkedUserId,
          },
        })
      }
      throw writeErr
    }

    const previousAttrs = existing
      ? {
          platform:   existing.platform,
          deviceOs:   existing.deviceOs,
          country:    existing.country,
          language:   existing.language,
          appVersion: existing.appVersion,
        }
      : null

    let topicNames: string[] = []
    if (topicAttrsChanged) {
      try {
        topicNames = await syncDeviceSystemTopics({
          projectId:        project.id,
          appId:            project.appId,
          dbDeviceId:       targetDbDeviceId,
          fcmToken:         activeToken,
          previousToken:    oldToken,
          firebaseJsonPath:    project.firebaseJsonPath,
          firebaseCredentials: project.firebaseCredentials,
          next:             nextAttrs,
          previous:         previousAttrs,
        })
      } catch (topicErr) {
        console.error('[Topics] System topic sync failed:', topicErr)
        topicNames = buildSystemTopicNames(project.appId, nextAttrs)
      }
    } else {
      topicNames = buildSystemTopicNames(project.appId, nextAttrs)
    }

    const finalExternalUserId = externalUserId ?? existing?.externalUserId ?? existing?.userId ?? null

    return NextResponse.json({
      success: true,
      message: 'Device registered successfully',
      subscriptionId: targetDbDeviceId,
      data: {
        deviceId,
        platform,
        subscriptionId: targetDbDeviceId,
        topics: topicNames,
        externalUserId: finalExternalUserId,
      },
    })
  } catch (err: unknown) {
    console.error('[Device Register Error]', err)
    const message = err instanceof Error ? err.message : 'Internal Server Error'
    return NextResponse.json(
      { success: false, error: message },
      { status: 500 }
    )
  }
}
