/**
 * Topic Management Service
 * Manages system and custom FCM topic configurations.
 * Note: Millions of subscribers are managed by Firebase FCM, NOT stored in D1.
 */

import { eq, and, desc } from 'drizzle-orm'
import { getDb } from '@/lib/db/client'
import { topics } from '@/lib/db/schema'
import { validateTopicName } from '@/lib/utils/topic-normalizer'
import { generateSecureToken } from '@/lib/utils'

export interface CreateTopicInput {
  projectId:   string
  name:        string
  type?:       'system' | 'custom'
  description?: string
}

/** Get all topics for a project */
export async function getTopics(projectId: string) {
  const db = await getDb()
  const rows = await db
    .select()
    .from(topics)
    .where(and(eq(topics.projectId, projectId), eq(topics.isActive, true)))
    .orderBy(desc(topics.createdAt))

  return rows
}

/** Create a new topic configuration */
export async function createTopic(input: CreateTopicInput) {
  if (!validateTopicName(input.name)) {
    throw new Error('Invalid topic name format. Allowed: alphanumeric, -, _, ., ~, %')
  }

  const db  = await getDb()

  // Check if topic already exists for project
  const [existing] = await db
    .select()
    .from(topics)
    .where(and(eq(topics.projectId, input.projectId), eq(topics.name, input.name)))
    .limit(1)

  if (existing) {
    if (!existing.isActive) {
      await db.update(topics).set({ isActive: true }).where(eq(topics.id, existing.id))
      return { ...existing, isActive: true }
    }
    return existing
  }

  const newTopic = {
    id:          generateSecureToken(16),
    projectId:   input.projectId,
    name:        input.name,
    type:        input.type ?? 'custom',
    description: input.description ?? null,
    isActive:    true,
    createdAt:   new Date().toISOString(),
  }

  await db.insert(topics).values(newTopic)
  return newTopic
}

/** Soft delete / deactivate a topic */
export async function deleteTopic(topicId: string, projectId: string) {
  const db  = await getDb()

  await db.update(topics).set({
    isActive:  false,
  }).where(and(eq(topics.id, topicId), eq(topics.projectId, projectId)))

  return { success: true }
}
