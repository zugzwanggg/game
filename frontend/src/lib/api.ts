/** Backend mounts REST under `/api` (see backend `app.use('/api', ...)`). */
export function getApiBase(): string {
  const raw = import.meta.env.VITE_API_URL?.replace(/\/+$/, '') ?? ''
  if (!raw) return 'http://localhost:3000/api'
  if (raw.endsWith('/api')) return raw
  return `${raw}/api`
}

const API_BASE = getApiBase()

export type ApiError = { error: string }

export async function apiFetch<T>(
  path: string,
  init: RequestInit = {},
): Promise<T> {
  const headers = new Headers(init.headers)
  headers.set('content-type', 'application/json')

  const res = await fetch(`${API_BASE}${path}`, {
    ...init,
    headers,
    credentials: 'include',
  })
  const text = await res.text()
  const data = text ? (JSON.parse(text) as any) : null
  if (!res.ok) {
    throw Object.assign(new Error('api_error'), { status: res.status, data })
  }
  return data as T
}

