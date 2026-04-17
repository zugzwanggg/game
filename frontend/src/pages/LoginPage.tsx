import { Lock, Mail } from 'lucide-react'
import { type FormEvent, useEffect, useState } from 'react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import { AuthChrome } from '../components/auth/AuthChrome'
import {
  AuthOAuthDivider,
  GoogleOAuthButton,
} from '../components/auth/GoogleOAuthButton'
import Button from '../components/ui/Button'
import { useAuth } from '../context/AuthProvider'

export default function LoginPage() {
  const navigate = useNavigate()
  const location = useLocation()
  const { login } = useAuth()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    const params = new URLSearchParams(location.search)
    if (params.get('oauth') === 'error') {
      setError('Google sign-in failed. Please try again.')
      const url = new URL(window.location.href)
      url.searchParams.delete('oauth')
      url.searchParams.delete('reason')
      window.history.replaceState({}, '', url.pathname + url.search + url.hash)
    }
  }, [location.search])

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    setError(null)
    setLoading(true)
    try {
      await login({ email, password })
      const next = (location.state as any)?.from ?? '/games'
      void navigate(next, { replace: true })
    } catch (e: any) {
      setError(e?.data?.error ?? 'Login failed')
    } finally {
      setLoading(false)
    }
  }

  return (
    <AuthChrome>
      <div className="glass rounded-2xl p-7">
        <p className="mb-1 text-center text-xs font-semibold uppercase tracking-wider text-muted">
          Welcome back
        </p>
        <h1 className="mb-6 text-center text-2xl font-extrabold text-text">
          Log in
        </h1>

        <GoogleOAuthButton action="login" />
        <AuthOAuthDivider />

        <form className="space-y-4" onSubmit={handleSubmit}>
          <div>
            <label
              htmlFor="login-email"
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
                id="login-email"
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
            <div className="mb-1.5 flex items-center justify-between">
              <label
                htmlFor="login-password"
                className="text-xs font-semibold text-muted"
              >
                Password
              </label>
              <button
                type="button"
                className="text-xs font-medium text-accent hover:text-accent/80"
              >
                Forgot?
              </button>
            </div>
            <div className="relative">
              <Lock
                size={15}
                className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-muted"
              />
              <input
                id="login-password"
                type="password"
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••"
                className="w-full rounded-xl border border-border bg-surface py-3 pl-10 pr-4 text-sm text-text outline-none transition-colors placeholder:text-muted focus:border-accent/60"
                required
                minLength={8}
              />
            </div>
          </div>

          <Button
            type="submit"
            variant="primary"
            size="lg"
            className="w-full justify-center"
            disabled={loading}
          >
            {loading ? 'Signing in…' : 'Sign in'}
          </Button>
        </form>

        {error && (
          <p className="mt-4 text-center text-xs font-medium text-red-400">
            {error}
          </p>
        )}

        <p className="mt-6 text-center text-sm text-muted">
          No account?{' '}
          <Link
            to="/signup"
            className="font-semibold text-accent hover:text-accent/80"
          >
            Sign up
          </Link>
        </p>
      </div>
    </AuthChrome>
  )
}
