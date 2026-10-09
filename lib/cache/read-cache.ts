/**
 * Short-lived read cache for dashboard aggregates.
 * OpenNext incremental cache is disabled in this app, so Next.js
 * unstable_cache does not survive a refresh on Cloudflare.
 */

type Entry = { expiresAt: number; value: unknown }

const memory = new Map<string, Entry>()
const MAX_ENTRIES = 200

function cacheRequest(key: string): Request {
  return new Request(`https://cache.internal/${encodeURIComponent(key)}`)
}

function cloudflareCache(): Cache | null {
  const cachesGlobal = (globalThis as { caches?: { default?: Cache } }).caches
  return cachesGlobal?.default ?? null
}

function memoryGet<T>(key: string): T | undefined {
  const hit = memory.get(key)
  if (!hit) return undefined
  if (hit.expiresAt <= Date.now()) {
    memory.delete(key)
    return undefined
  }
  return hit.value as T
}

function memorySet(key: string, value: unknown, ttlSeconds: number) {
  if (memory.size >= MAX_ENTRIES) {
    const oldest = memory.keys().next().value
    if (oldest) memory.delete(oldest)
  }
  memory.set(key, { expiresAt: Date.now() + ttlSeconds * 1000, value })
}

export async function getCachedJson<T>(
  key: string,
  ttlSeconds: number,
  load: () => Promise<T>
): Promise<T> {
  const fromMemory = memoryGet<T>(key)
  if (fromMemory !== undefined) return fromMemory

  const cache = cloudflareCache()
  if (cache) {
    try {
      const hit = await cache.match(cacheRequest(key))
      if (hit) {
        const value = (await hit.json()) as T
        memorySet(key, value, ttlSeconds)
        return value
      }
    } catch {
      // Cache API is unavailable outside the Workers runtime.
    }
  }

  const value = await load()
  memorySet(key, value, ttlSeconds)

  if (cache) {
    try {
      await cache.put(
        cacheRequest(key),
        new Response(JSON.stringify(value), {
          headers: { 'Cache-Control': `s-maxage=${ttlSeconds}` },
        })
      )
    } catch {
      // A failed cache write still leaves the in-isolate copy.
    }
  }

  return value
}

export async function invalidateReadCache(key: string): Promise<void> {
  memory.delete(key)
  const cache = cloudflareCache()
  if (!cache) return
  try {
    await cache.delete(cacheRequest(key))
  } catch {
    // Ignore. The TTL still expires the entry.
  }
}

export function dashboardStatsCacheKey(userId: string): string {
  return `dashboard-stats:${userId}`
}
