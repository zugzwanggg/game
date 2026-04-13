const DEFAULT_DEV_ORIGIN = 'http://localhost:5173'


export function getCorsOrigins(): string | string[] {
  const raw = process.env.CLIENT_ORIGIN?.trim()
  if (!raw) return DEFAULT_DEV_ORIGIN
  const list = raw
    .split(',')
    .map((o) => o.trim())
    .filter(Boolean)
  if (list.length === 0) return DEFAULT_DEV_ORIGIN
  if (list.length === 1) return list[0]
  return list
}
