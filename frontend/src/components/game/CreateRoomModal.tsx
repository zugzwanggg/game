import { Globe, Lock, X } from 'lucide-react'
import { useEffect, useState } from 'react'
import Button from '../ui/Button'

type CreateRoomModalProps = {
  open: boolean
  onClose: () => void
  gameTitle: string
  /** Called with whether the room should be private (invite link only). */
  onConfirm: (isPrivate: boolean) => void
}

export function CreateRoomModal({
  open,
  onClose,
  gameTitle,
  onConfirm,
}: CreateRoomModalProps) {
  const [isPrivate, setIsPrivate] = useState(true)

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
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-labelledby="create-room-title"
    >
      <button
        type="button"
        className="absolute inset-0 cursor-default"
        aria-label="Close dialog"
        onClick={onClose}
      />

      <div className="glass relative z-[1] w-full max-w-md rounded-2xl p-6 shadow-card">
        <div className="mb-5 flex items-start justify-between gap-3">
          <div>
            <h2
              id="create-room-title"
              className="text-lg font-extrabold text-text"
            >
              Create a room
            </h2>
            <p className="mt-1 text-sm text-muted">
              {gameTitle} — choose who can find this lobby.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-1.5 text-muted transition-colors hover:bg-white/5 hover:text-text"
          >
            <X size={18} />
          </button>
        </div>

        <p className="mb-3 text-xs font-semibold uppercase tracking-wider text-muted">
          Visibility
        </p>
        <div className="mb-6 grid gap-3">
          <button
            type="button"
            onClick={() => setIsPrivate(true)}
            className={`flex w-full items-start gap-3 rounded-xl border p-4 text-left transition-all ${
              isPrivate
                ? 'border-accent bg-accent/10 shadow-glow-accent'
                : 'border-border bg-surface hover:border-border hover:bg-card'
            }`}
          >
            <div
              className={`mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg ${
                isPrivate ? 'bg-accent text-white' : 'bg-card text-muted'
              }`}
            >
              <Lock size={18} />
            </div>
            <div>
              <p className="text-sm font-semibold text-text">Private</p>
              <p className="mt-0.5 text-xs leading-relaxed text-muted">
                Only people with the invite link can join. Best for friends.
              </p>
            </div>
          </button>

          <button
            type="button"
            onClick={() => setIsPrivate(false)}
            className={`flex w-full items-start gap-3 rounded-xl border p-4 text-left transition-all ${
              !isPrivate
                ? 'border-accent bg-accent/10 shadow-glow-accent'
                : 'border-border bg-surface hover:border-border hover:bg-card'
            }`}
          >
            <div
              className={`mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg ${
                !isPrivate ? 'bg-accent text-white' : 'bg-card text-muted'
              }`}
            >
              <Globe size={18} />
            </div>
            <div>
              <p className="text-sm font-semibold text-text">Public</p>
              <p className="mt-0.5 text-xs leading-relaxed text-muted">
                Listed for others to discover and join from matchmaking.
              </p>
            </div>
          </button>
        </div>

        <div className="flex gap-3">
          <Button
            type="button"
            variant="ghost"
            size="md"
            className="flex-1 justify-center"
            onClick={onClose}
          >
            Cancel
          </Button>
          <Button
            type="button"
            variant="primary"
            size="md"
            className="flex-1 justify-center"
            onClick={() => {
              onConfirm(isPrivate)
              onClose()
            }}
          >
            Create room
          </Button>
        </div>
      </div>
    </div>
  )
}
