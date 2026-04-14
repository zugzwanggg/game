/** Mirrors httpOnly cookie auth when cross-site cookies fail (common on mobile Safari / Chrome). */
const KEY = 'gamemaxxing_auth_token'

export function getStoredAuthToken(): string | null {
  try {
    return localStorage.getItem(KEY)
  } catch {
    return null
  }
}

export function setStoredAuthToken(token: string): void {
  try {
    localStorage.setItem(KEY, token)
  } catch {
    // private mode / quota
  }
}

export function clearStoredAuthToken(): void {
  try {
    localStorage.removeItem(KEY)
  } catch {
    // ignore
  }
}
