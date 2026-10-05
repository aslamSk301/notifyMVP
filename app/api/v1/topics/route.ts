import { NextRequest } from 'next/server'
import { and, eq, inArray, sql } from 'drizzle-orm'
import { deviceTopics, topics } from '@/lib/db/schema'
import { authenticateV1Project, v1Json } from '@/lib/api/v1-auth'
import { systemTopicColumns } from '@/lib/utils/topic-normalizer'

export async function OPTIONS() {
  return v1Json({}, 200)
}

/**
 * GET /api/v1/topics
 *
 * List topics for the authenticated project (custom dashboard).
 *
 * Auth: Authorization: Bearer <apiKey>  OR  x-api-key: <apiKey>
 *
 * Query (optional):
 *   type=system|custom
 *   active=true|false|all (default: true)
 *   limit=100 (max 200)
 *   offset=0
 */
export async function GET(req: NextRequest) {
  try {
    const auth = await authenticateV1Project(req)
    if ('error' in auth && auth.error) return auth.error

    const { project, db } = auth
    const sp = req.nextUrl.searchParams

    const type = sp.get('type')?.trim()
    const activeParam = sp.get('active')?.trim() ?? 'true'
    const limit = Math.min(Math.max(parseInt(sp.get('limit') || '100', 10) || 100, 1), 200)
    const offset = Math.max(parseInt(sp.get('offset') || '0', 10) || 0, 0)

    const conditions = [eq(topics.projectId, project.id)]

    if (type === 'system' || type === 'custom') {
      conditions.push(eq(topics.type, type))
    }
    if (activeParam === 'true') {
      conditions.push(eq(topics.isActive, true))
    } else if (activeParam === 'false') {
      conditions.push(eq(topics.isActive, false))
    }

    const whereClause = and(...conditions)

    const [countRow] = await db
      .select({ total: sql<number>`count(*)` })
      .from(topics)
      .where(whereClause)

    const total = Number(countRow?.total ?? 0)

    const rows = await db
      .select({
        id: topics.id,
        name: topics.name,
        type: topics.type,
        description: topics.description,
        isActive: topics.isActive,
        createdAt: topics.createdAt,
      })
      .from(topics)
      .where(whereClause)
      .orderBy(topics.name)
      .limit(limit)
      .offset(offset)

    const topicIds = rows.map((t) => t.id)
    const counts: Record<string, number> = {}

    if (topicIds.length > 0) {
      const countRows = await db
        .select({
          topicId: deviceTopics.topicId,
          count: sql<number>`count(*)`,
        })
        .from(deviceTopics)
        .where(inArray(deviceTopics.topicId, topicIds))
        .groupBy(deviceTopics.topicId)

      for (const c of countRows) {
        counts[c.topicId] = Number(c.count ?? 0)
      }
    }

    return v1Json({
      success: true,
      project: { id: project.id, name: project.name, appId: project.appId },
      total,
      limit,
      offset,
      topics: rows.map((t) => {
        const meta = systemTopicColumns(t.name, project.appId)
        return {
        id: t.id,
        name: t.name,
        type: t.type,
        category: meta.category,
        value: meta.value,
        description: t.description,
        isActive: t.isActive,
        deviceCount: counts[t.id] ?? 0,
        createdAt: t.createdAt,
        }
      }),
    })
  } catch (err) {
    return v1Json(
      { success: false, error: err instanceof Error ? err.message : 'Internal Server Error' },
      500
    )
  }
}
