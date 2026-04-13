import type { ReactNode } from 'react'
import { Navigate, useLocation } from 'react-router-dom'
import { useAuth } from '../../context/AuthProvider'
import { AuthChoiceModal } from './AuthChoiceModal'

export function RequireAnon({ children }: { children: ReactNode }) {
  const { principal, ready } = useAuth()
  if (!ready) return null
  if (principal?.kind === 'user') return <Navigate to="/games" replace />
  return <>{children}</>
}

export function RequireIdentity({ children }: { children: ReactNode }) {
  const { principal, ready, guest } = useAuth()
  const location = useLocation()

  if (!ready) return null
  if (principal) return <>{children}</>

  return (
    <>
      <AuthChoiceModal
        open
        onClose={() => {}}
        title="Join the fun"
        subtitle="Sign in, create an account, or continue as a guest to enter rooms and play."
        onContinueGuest={(name) => {
          void guest({ displayName: name })
        }}
      />
      <div className="flex min-h-screen items-center justify-center bg-base px-4">
        <p className="text-sm text-muted">
          Redirecting… ({location.pathname})
        </p>
      </div>
    </>
  )
}

