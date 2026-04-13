import { Lock, Mail, UserRound } from 'lucide-react'
import { type FormEvent, useState } from 'react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import { AuthChrome } from '../components/auth/AuthChrome'
import {
  AuthOAuthDivider,
  GoogleOAuthButton,
} from '../components/auth/GoogleOAuthButton'
import Button from '../components/ui/Button'
import { useAuth } from '../context/AuthProvider'

export default function SignUpPage() {
  const navigate = useNavigate()
  const location = useLocation()
  const { signup } = useAuth()
  const [displayName, setDisplayName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    setError(null)
    if (password !== confirm) {
      setError('Passwords do not match.')
      return
    }
    setLoading(true)
    try {
      await signup({ email, password, displayName })
      const next = (location.state as any)?.from ?? '/games'
      void navigate(next, { replace: true })
    } catch (e: any) {
      setError(e?.data?.error ?? 'Signup failed')
    } finally {
      setLoading(false)
    }
  }

  return (
    <AuthChrome>
      <div className="glass rounded-2xl p-7">
        <p className="mb-1 text-center text-xs font-semibold uppercase tracking-wider text-muted">
          Join the lobby
        </p>
        <h1 className="mb-6 text-center text-2xl font-extrabold text-text">
          Create account
        </h1>

        <GoogleOAuthButton action="signup" />
        <AuthOAuthDivider />

        <form className="space-y-4" onSubmit={handleSubmit}>
          <div>
            <label
              htmlFor="signup-name"
              className="mb-1.5 block text-xs font-semibold text-muted"
            >
              Display name
            </label>
            <div className="relative">
              <UserRound
                size={15}
                className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-muted"
              />
              <input
                id="signup-name"
                type="text"
                autoComplete="nickname"
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                placeholder="How others see you"
                maxLength={32}
                className="w-full rounded-xl border border-border bg-surface py-3 pl-10 pr-4 text-sm text-text outline-none transition-colors placeholder:text-muted focus:border-accent/60"
                required
              />
            </div>
          </div>

          <div>
            <label
              htmlFor="signup-email"
              className="mb-1.5 block text-xs font-semibold text-muted"
            >
              Email
            </label>
            <div className="relative">
              <Mail
                size={15}
                className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-muted"
              />
              <input
                id="signup-email"
                type="email"
                autoComplete="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@example.com"
                className="w-full rounded-xl border border-border bg-surface py-3 pl-10 pr-4 text-sm text-text outline-none transition-colors placeholder:text-muted focus:border-accent/60"
                required
              />
            </div>
          </div>

          <div>
            <label
              htmlFor="signup-password"
              className="mb-1.5 block text-xs font-semibold text-muted"
            >
              Password
            </label>
            <div className="relative">
              <Lock
                size={15}
                className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-muted"
              />
              <input
                id="signup-password"
                type="password"
                autoComplete="new-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="At least 8 characters"
                className="w-full rounded-xl border border-border bg-surface py-3 pl-10 pr-4 text-sm text-text outline-none transition-colors placeholder:text-muted focus:border-accent/60"
                required
                minLength={8}
              />
            </div>
          </div>

          <div>
            <label
              htmlFor="signup-confirm"
              className="mb-1.5 block text-xs font-semibold text-muted"
            >
              Confirm password
            </label>
            <div className="relative">
              <Lock
                size={15}
                className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-muted"
              />
              <input
                id="signup-confirm"
                type="password"
                autoComplete="new-password"
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
                placeholder="Repeat password"
                className="w-full rounded-xl border border-border bg-surface py-3 pl-10 pr-4 text-sm text-text outline-none transition-colors placeholder:text-muted focus:border-accent/60"
                required
                minLength={8}
              />
            </div>
          </div>

          {error && (
            <p className="text-center text-xs font-medium text-red-400">
              {error}
            </p>
          )}

          <Button
            type="submit"
            variant="primary"
            size="lg"
            className="w-full justify-center"
            disabled={loading}
          >
            {loading ? 'Creating…' : 'Create account'}
          </Button>
        </form>

        <p className="mt-6 text-center text-sm text-muted">
          Already have an account?{' '}
          <Link
            to="/login"
            className="font-semibold text-accent hover:text-accent/80"
          >
            Log in
          </Link>
        </p>
      </div>
    </AuthChrome>
  )
}
