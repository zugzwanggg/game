import { getApiBase } from '../../lib/api'
import type { KlipyGif } from './klipyTypes'

export type { KlipyGif } from './klipyTypes'

/** GIF search/trending go through our backend so the browser is not blocked by Klipy CORS. */
function klipyUrl(path: string, params: Record<string, string | number | undefined>) {
  const u = new URL(`${getApiBase()}/klipy${path}`)
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined) continue
    u.searchParams.set(k, String(v))
  }
  return u.toString()
}

function extractGifArray(json: unknown): unknown[] {
  if (!json || typeof json !== 'object') return []
  const j = json as Record<string, unknown>
  if (j.result === false) return []

  const d = j.data
  if (Array.isArray(d)) return d
  if (d && typeof d === 'object') {
    const inner = (d as Record<string, unknown>).data
    if (Array.isArray(inner)) return inner
    const items = (d as Record<string, unknown>).items
    if (Array.isArray(items)) return items
  }
  if (Array.isArray(j.items)) return j.items
  return []
}

function firstHttpUrl(obj: unknown, depth = 0): string | undefined {
  if (depth > 8 || obj === null || obj === undefined) return undefined
  if (typeof obj === 'string' && /^https?:\/\//i.test(obj)) return obj
  if (typeof obj !== 'object') return undefined
  for (const v of Object.values(obj as Record<string, unknown>)) {
    const u = firstHttpUrl(v, depth + 1)
    if (u) return u
  }
  return undefined
}

function pickFileUrl(files: unknown): { url?: string; width?: number; height?: number } {
  if (!files || typeof files !== 'object') return {}
  const f = files as Record<string, unknown>
  const candidates = ['gif', 'medium_gif', 'downsized_gif', 'tiny_gif', 'mp4', 'webp', 'original']
  for (const k of candidates) {
    const block = f[k]
    if (block && typeof block === 'object') {
      const url = (block as { url?: string }).url
      if (typeof url === 'string' && url.startsWith('http')) {
        return {
          url,
          width: typeof (block as { width?: number }).width === 'number' ? (block as { width: number }).width : undefined,
          height: typeof (block as { height?: number }).height === 'number' ? (block as { height: number }).height : undefined,
        }
      }
    }
  }
  const anyUrl = firstHttpUrl(files)
  return anyUrl ? { url: anyUrl } : {}
}

function mapGif(item: unknown): KlipyGif | null {
  if (!item || typeof item !== 'object') return null
  const o = item as Record<string, unknown>
  const id = o.id != null ? String(o.id) : o.slug != null ? String(o.slug) : ''
  const { url, width, height } = pickFileUrl(o.files)
  const fallbackUrl = firstHttpUrl(o)
  const finalUrl = url ?? fallbackUrl
  if (!id || !finalUrl) return null

  const preview = pickFileUrl(o.preview_files).url ?? pickFileUrl(o.preview).url
  return {
    id,
    url: finalUrl,
    previewUrl: preview,
    width,
    height,
    title: typeof o.title === 'string' ? o.title : undefined,
  }
}

async function fetchKlipyJson(path: string, params: Record<string, string | number | undefined>) {
  const res = await fetch(klipyUrl(path, params), {
    credentials: 'include',
    headers: { accept: 'application/json' },
  })
  const text = await res.text()
  let json: unknown = null
  try {
    json = text ? JSON.parse(text) : null
  } catch {
    throw new Error('Invalid JSON from Klipy proxy')
  }
  if (!res.ok) {
    const err = (json as { message?: string; error?: string })?.message ?? (json as { error?: string })?.error
    throw new Error(typeof err === 'string' ? err : `Klipy proxy error (${res.status})`)
  }
  return json
}

export async function searchGifs(
  query: string,
  opts?: { page?: number; perPage?: number; locale?: string },
) {
  const q = query.trim()
  if (!q) return [] as KlipyGif[]
  const json = await fetchKlipyJson('/gifs/search', {
    q,
    page: opts?.page ?? 1,
    per_page: Math.min(50, Math.max(8, opts?.perPage ?? 24)),
    locale: opts?.locale,
  })
  const arr = extractGifArray(json)
  return arr.map(mapGif).filter(Boolean) as KlipyGif[]
}

export async function trendingGifs(opts?: { page?: number; perPage?: number; locale?: string }) {
  const json = await fetchKlipyJson('/gifs/trending', {
    page: opts?.page ?? 1,
    per_page: Math.min(50, Math.max(8, opts?.perPage ?? 24)),
    locale: opts?.locale,
  })
  const arr = extractGifArray(json)
  return arr.map(mapGif).filter(Boolean) as KlipyGif[]
}
