import type { MemeGif } from '../../rooms/types.js'

export function sanitizeMemeGif(raw: unknown): MemeGif | null {
  if (!raw || typeof raw !== 'object') return null
  const g = raw as Record<string, unknown>
  const id = String(g.id ?? '').trim().slice(0, 120)
  const url = String(g.url ?? '').trim().slice(0, 2000)
  if (!id || !url.startsWith('http')) return null
  const previewUrl =
    typeof g.previewUrl === 'string' ? g.previewUrl.trim().slice(0, 2000) : undefined
  const title = typeof g.title === 'string' ? g.title.trim().slice(0, 200) : undefined
  const width = typeof g.width === 'number' && Number.isFinite(g.width) ? g.width : undefined
  const height = typeof g.height === 'number' && Number.isFinite(g.height) ? g.height : undefined
  return { id, url, previewUrl, title, width, height }
}
