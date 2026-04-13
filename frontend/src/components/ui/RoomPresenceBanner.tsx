import { UserMinus, UserPlus, X } from 'lucide-react'
import type { PresenceKind } from '../../hooks/useRoomPresenceNotification'

type RoomPresenceBannerProps = {
  message: string | null
  kind: PresenceKind | null
  onDismiss?: () => void
  className?: string
}

export function RoomPresenceBanner({
  message,
  kind,
  onDismiss,
  className = '',
}: RoomPresenceBannerProps) {
  if (!message || !kind) return null

  const leave = kind === 'leave'

  return (
    <div
      role="status"
      aria-live="polite"
      className={`pointer-events-auto fixed left-1/2 top-[max(1rem,env(safe-area-inset-top))] z-100 flex max-w-[min(92vw,24rem)] -translate-x-1/2 transition-opacity duration-200 ${className}`}
    >
      <div
        className={`flex items-center gap-3 rounded-xl border px-4 py-3 shadow-lg backdrop-blur-sm ${
          leave
            ? 'border-amber-500/35 bg-amber-500/15 text-amber-50'
            : 'border-teal/40 bg-teal/15 text-text'
        }`}
      >
        <div
          className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg ${
            leave ? 'bg-amber-500/25 text-amber-100' : 'bg-teal/25 text-teal'
          }`}
        >
          {leave ? <UserMinus size={18} aria-hidden /> : <UserPlus size={18} aria-hidden />}
        </div>
        <p className="min-w-0 flex-1 text-sm font-medium leading-snug">{message}</p>
        {onDismiss && (
          <button
            type="button"
            onClick={onDismiss}
            className="shrink-0 rounded-lg p-1 text-muted opacity-80 transition-colors hover:bg-white/10 hover:text-text hover:opacity-100"
            aria-label="Dismiss"
          >
            <X size={16} />
          </button>
        )}
      </div>
    </div>
  )
}
