const DEFAULT_DEV_ORIGIN = 'http://localhost:5173'

/** Strip trailing slashes so `https://app.vercel.app/` matches browser `Origin: https://app.vercel.app`. */
export function normalizeOrigin(raw: string): string {
  return raw.trim().replace(/\/+$/, '')
}

/** Parsed allowlist (always a list; normalized). */
export function getCorsOriginsList(): string[] {
  const raw = process.env.CLIENT_ORIGIN?.trim()
  if (!raw) return [normalizeOrigin(DEFAULT_DEV_ORIGIN)]
  const list = raw
    .split(',')
    .map((o) => normalizeOrigin(o))
    .filter(Boolean)
  if (list.length === 0) return [normalizeOrigin(DEFAULT_DEV_ORIGIN)]
  return list
}

/**
 * `CLIENT_ORIGIN`: one URL, or comma-separated (prod + preview).
 * Used by `cors` and Socket.IO — must stay in sync.
 */
export function getCorsOrigins(): string | string[] {
  const list = getCorsOriginsList()
  if (list.length === 1) return list[0]
  return list
}
