import { createContext, useContext, useEffect, useMemo, useState } from 'react'
import { apiFetch } from '../lib/api'

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
    await apiFetch<{ user: any }>('/auth/login', {
      method: 'POST',
      body: JSON.stringify(args),
    })
    await refresh()
  }

  const signup = async (args: { email: string; password: string; displayName: string }) => {
    await apiFetch<{ user: any }>('/auth/signup', {
      method: 'POST',
      body: JSON.stringify(args),
    })
    await refresh()
  }

  const guest = async (args: { displayName?: string }) => {
    await apiFetch<{ guest: any }>('/auth/guest', {
      method: 'POST',
      body: JSON.stringify(args),
    })
    await refresh()
  }

  const logout = () => {
    void apiFetch('/auth/logout', { method: 'POST' }).catch(() => {})
    setPrincipal(null)
  }

  useEffect(() => {
    void refresh()
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

