'use server'

import { revalidatePath } from 'next/cache'
import { eq, and, sql } from 'drizzle-orm'
import { z } from 'zod'
import { getDb } from '@/lib/db/client'
import { baUser, projects } from '@/lib/db/schema'
import { requireSession } from '@/lib/auth/session'
import { ensureUsersRow } from '@/lib/auth/ensure-user'
import { dashboardStatsCacheKey, invalidateReadCache } from '@/lib/cache/read-cache'
import { deleteFromR2 } from '@/lib/r2/client'
import { generateAppId, generateSecureToken } from '@/lib/utils'
import { encryptText } from '@/lib/crypto/encryption'

const createSchema = z.object({
  name: z.string().min(1, 'Project name is required').max(80),
})

const updateSchema = z.object({
  id:   z.string().min(1),
  name: z.string().min(1, 'Project name is required').max(80),
})

// ── Read ──────────────────────────────────────────────────────────────────────

export async function getProjects() {
  try {
    const session = await requireSession()
    const db = await getDb()
    const rows = await db
      .select()
      .from(projects)
      .where(eq(projects.userId, session.userId))
      .orderBy(projects.createdAt)
    return { projects: rows, error: undefined }
  } catch (e) {
    return { projects: [], error: (e as Error).message }
  }
}

export async function getProject(id: string) {
  try {
    const session = await requireSession()
    const db = await getDb()
    const [row] = await db
      .select()
      .from(projects)
      .where(and(eq(projects.id, id), eq(projects.userId, session.userId)))
      .limit(1)
    return { project: row ?? null, error: undefined }
  } catch (e) {
    return { project: null, error: (e as Error).message }
  }
}

// ── Create ────────────────────────────────────────────────────────────────────

export async function createProject(_prev: unknown, formData: FormData) {
  try {
    const session = await requireSession()
    const parsed = createSchema.safeParse({ name: formData.get('name') })
    if (!parsed.success) return { error: parsed.error.issues[0].message }

    const db = await getDb()
    const projectId = generateSecureToken(16)

    const [authUser] = await db
      .select({ name: baUser.name })
      .from(baUser)
      .where(eq(baUser.id, session.userId))
      .limit(1)

    await ensureUsersRow(db, {
      id: session.userId,
      email: session.email,
      name: authUser?.name,
    })

    // Handle optional Firebase JSON upload
    const firebaseFile = formData.get('firebaseJson') as File | null
    let firebaseCredentials: string | null = null

    if (firebaseFile && firebaseFile.size > 0) {
      const uploadResult = await validateAndEncryptFirebaseJson(firebaseFile)
      if (uploadResult.error) return { error: uploadResult.error }
      firebaseCredentials = uploadResult.encrypted ?? null
    }

    const appId = generateAppId()
    const apiKey = generateSecureToken(32)

    const [created] = await db
      .insert(projects)
      .values({
        id:                  projectId,
        userId:              session.userId,
        name:                parsed.data.name,
        appId,
        apiKey,
        firebaseJsonPath:    null,
        firebaseCredentials,
      })
      .returning()

    const resultProject = created ?? {
      id: projectId,
      userId: session.userId,
      name: parsed.data.name,
      appId,
      apiKey,
      firebaseJsonPath: null,
      firebaseCredentials,
      createdAt: new Date().toISOString(),
    }

    revalidatePath('/dashboard/projects')
    await invalidateReadCache(dashboardStatsCacheKey(session.userId))
    return { success: true, project: resultProject }
  } catch (e) {
    return { error: projectError(e) }
  }
}

function projectError(e: unknown): string {
  const err = e instanceof Error ? e : new Error(String(e))
  const cause = (err as Error & { cause?: unknown }).cause
  const causeMsg = cause instanceof Error ? cause.message : ''
  if (err.message && !err.message.startsWith('Failed query:')) return err.message
  if (causeMsg && !causeMsg.startsWith('Failed query:')) return causeMsg
  return 'Could not create the project. Please try again.'
}

// ── Update ────────────────────────────────────────────────────────────────────

export async function updateProject(_prev: unknown, formData: FormData) {
  try {
    const session = await requireSession()
    const parsed = updateSchema.safeParse({
      id:   formData.get('id'),
      name: formData.get('name'),
    })
    if (!parsed.success) return { error: parsed.error.issues[0].message }

    const db = await getDb()
    await db
      .update(projects)
      .set({ name: parsed.data.name })
      .where(and(eq(projects.id, parsed.data.id), eq(projects.userId, session.userId)))

    revalidatePath('/dashboard/projects')
    return { success: true }
  } catch (e) {
    return { error: (e as Error).message }
  }
}

// ── Firebase JSON upload ──────────────────────────────────────────────────────

export async function updateFirebaseJson(projectId: string, file: File) {
  try {
    const session = await requireSession()
    const db = await getDb()

    // Verify ownership
    const [project] = await db
      .select()
      .from(projects)
      .where(and(eq(projects.id, projectId), eq(projects.userId, session.userId)))
      .limit(1)

    if (!project) return { error: 'Project not found' }

    // Delete old R2 file if exists
    if (project.firebaseJsonPath) {
      try {
        await deleteFromR2(project.firebaseJsonPath)
      } catch {}
    }

    const result = await validateAndEncryptFirebaseJson(file)
    if (result.error) return { error: result.error }

    await db
      .update(projects)
      .set({
        firebaseCredentials: result.encrypted,
        firebaseJsonPath: null,
      })
      .where(eq(projects.id, projectId))

    revalidatePath('/dashboard/projects')
    return { success: true }
  } catch (e) {
    return { error: (e as Error).message }
  }
}

// ── Delete ────────────────────────────────────────────────────────────────────

export async function deleteProject(projectId: string) {
  try {
    const session = await requireSession()
    const db = await getDb()

    const [project] = await db
      .select({ firebaseJsonPath: projects.firebaseJsonPath })
      .from(projects)
      .where(and(eq(projects.id, projectId), eq(projects.userId, session.userId)))
      .limit(1)

    if (!project) return { error: 'Project not found' }

    await db
      .delete(projects)
      .where(and(eq(projects.id, projectId), eq(projects.userId, session.userId)))

    // Cleanup legacy R2 file if exists
    if (project.firebaseJsonPath) {
      try {
        await deleteFromR2(project.firebaseJsonPath)
      } catch {}
    }

    revalidatePath('/dashboard/projects')
    await invalidateReadCache(dashboardStatsCacheKey(session.userId))
    return { success: true }
  } catch (e) {
    return { error: (e as Error).message }
  }
}

// ── Internal helper ───────────────────────────────────────────────────────────

async function validateAndEncryptFirebaseJson(
  file: File
): Promise<{ encrypted?: string; error?: string }> {
  if (!file.name.endsWith('.json') && file.type !== 'application/json') {
    return { error: 'Firebase credentials must be a .json file' }
  }
  if (file.size > 100 * 1024) {
    return { error: 'Firebase JSON must be under 100 KB' }
  }

  const text = await file.text()

  try {
    const json = JSON.parse(text)
    if (json.type !== 'service_account') {
      return { error: 'Invalid Firebase service account JSON — missing "type: service_account"' }
    }
  } catch {
    return { error: 'Invalid JSON file' }
  }

  const encrypted = await encryptText(text)
  return { encrypted }
}

