import { createContext, useContext, useEffect, useMemo, useState } from 'react'
import { apiFetch } from '../lib/api'
import { clearStoredAuthToken, setStoredAuthToken } from '../lib/authToken'
import { resetSocket } from '../lib/socket'

export type Principal =
  | null
  | { kind: 'guest'; id: string; displayName: string }
  | { kind: 'user'; id: string; email: string; displayName: string }

type AuthContextValue = {
  principal: Principal
  ready: boolean
  refresh: () => Promise<void>
  login: (args: { email: string; password: string }) => Promise<void>
  signup: (args: { email: string; password: string; displayName: string }) => Promise<void>
  guest: (args: { displayName?: string }) => Promise<void>
  logout: () => void
}

const AuthContext = createContext<AuthContextValue | null>(null)

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [principal, setPrincipal] = useState<Principal>(null)
  const [ready, setReady] = useState(false)

  const refresh = async () => {
    try {
      const data = await apiFetch<{ principal: Principal }>('/me', { method: 'GET' })
      setPrincipal(data.principal)
    } catch {
      setPrincipal(null)
    } finally {
      setReady(true)
    }
  }

  const login = async (args: { email: string; password: string }) => {
    const data = await apiFetch<{ user: any; token?: string }>('/auth/login', {
      method: 'POST',
      body: JSON.stringify(args),
    })
    if (data.token) setStoredAuthToken(data.token)
    resetSocket()
    await refresh()
  }

  const signup = async (args: { email: string; password: string; displayName: string }) => {
    const data = await apiFetch<{ user: any; token?: string }>('/auth/signup', {
      method: 'POST',
      body: JSON.stringify(args),
    })
    if (data.token) setStoredAuthToken(data.token)
    resetSocket()
    await refresh()
  }

  const guest = async (args: { displayName?: string }) => {
    const data = await apiFetch<{ guest: any; token?: string }>('/auth/guest', {
      method: 'POST',
      body: JSON.stringify(args),
    })
    if (data.token) setStoredAuthToken(data.token)
    resetSocket()
    await refresh()
  }

  const logout = () => {
    clearStoredAuthToken()
    resetSocket()
    void apiFetch('/auth/logout', { method: 'POST' }).catch(() => {})
    setPrincipal(null)
  }

  useEffect(() => {
    void (async () => {
      const params = new URLSearchParams(window.location.search)
      if (params.get('oauth') === 'success') {
        try {
          const data = await apiFetch<{ token: string }>('/auth/sync-session', { method: 'POST' })
          if (data.token) setStoredAuthToken(data.token)
          resetSocket()
        } catch {
          /* cookie-only session may still work for /me */
        }
        const url = new URL(window.location.href)
        url.searchParams.delete('oauth')
        window.history.replaceState({}, '', url.pathname + url.search + url.hash)
      }
      await refresh()
    })()
  }, [])

  const value = useMemo<AuthContextValue>(() => ({ principal, ready, refresh, login, signup, guest, logout }), [
    principal,
    ready,
  ])

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth() {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used within AuthProvider')
  return ctx
}

