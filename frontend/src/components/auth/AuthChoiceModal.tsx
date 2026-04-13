import { X } from 'lucide-react'
import { useEffect, useState } from 'react'
import { Link, useLocation } from 'react-router-dom'
import Button from '../ui/Button'

type AuthChoiceModalProps = {
  open: boolean
  title?: string
  subtitle?: string
  allowGuest?: boolean
  defaultNickname?: string
  onClose: () => void
  onContinueGuest?: (nickname?: string) => void
}

export function AuthChoiceModal({
  open,
  title = 'Play with an account?',
  subtitle = 'Sign in to create rooms and save stats, or continue as a guest.',
  allowGuest = true,
  defaultNickname = '',
  onClose,
  onContinueGuest,
}: AuthChoiceModalProps) {
  const location = useLocation()
  const [nickname, setNickname] = useState(defaultNickname)

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [open, onClose])

  useEffect(() => {
    if (!open) return
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.body.style.overflow = prev
    }
  }, [open])

  if (!open) return null

  return (
    <div
      className="fixed inset-0 z-200 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-labelledby="auth-choice-title"
    >
      <button
        type="button"
        className="absolute inset-0 cursor-default"
        aria-label="Close dialog"
        onClick={onClose}
      />

      <div className="glass relative z-1 w-full max-w-md rounded-2xl p-6 shadow-card">
        <div className="mb-5 flex items-start justify-between gap-3">
          <div>
            <h2 id="auth-choice-title" className="text-lg font-extrabold text-text">
              {title}
            </h2>
            <p className="mt-1 text-sm text-muted">{subtitle}</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-1.5 text-muted transition-colors hover:bg-white/5 hover:text-text"
          >
            <X size={18} />
          </button>
        </div>

        {allowGuest && (
          <div className="mb-4">
            <label className="mb-1.5 block text-xs font-semibold text-muted">
              Nickname (guest)
            </label>
            <input
              value={nickname}
              onChange={(e) => setNickname(e.target.value)}
              placeholder="Optional"
              maxLength={20}
              className="w-full rounded-xl border border-border bg-surface px-3 py-3 text-sm text-text outline-none transition-colors placeholder:text-muted focus:border-accent/60"
            />
          </div>
        )}

        <div className="grid gap-2">
          <Link
            to="/login"
            state={{ from: location.pathname + location.search }}
            className="block"
            onClick={onClose}
          >
            <Button type="button" variant="primary" size="md" className="w-full justify-center">
              Sign in
            </Button>
          </Link>
          <Link
            to="/signup"
            state={{ from: location.pathname + location.search }}
            className="block"
            onClick={onClose}
          >
            <Button type="button" variant="ghost" size="md" className="w-full justify-center">
              Create account
            </Button>
          </Link>

          {allowGuest && (
            <Button
              type="button"
              variant="teal"
              size="md"
              className="w-full justify-center"
              onClick={() => {
                onContinueGuest?.(nickname.trim() || undefined)
                onClose()
              }}
            >
              Continue as guest
            </Button>
          )}
        </div>
      </div>
    </div>
  )
}

