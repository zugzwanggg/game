import { useEffect, useRef, useState } from 'react'
import { useVisualViewportKeyboard } from '../../hooks/useVisualViewportKeyboard'

export type MobileChatFloatingMessage = {
  id: string
  author: string
  text: string
  variant?: string
}

type MobileChatFloatingToastsProps = {
  messages: MobileChatFloatingMessage[]
  /** When true (full chat open), floats are hidden and new messages are not queued. */
  expanded: boolean
  /**
   * When false, nothing is shown and new messages are not queued (e.g. Guess the Drawing: hide for the
   * drawer so bubbles do not cover the canvas).
   * @default true
   */
  enabled?: boolean
  /** How long each bubble stays visible (ms). */
  ttlMs?: number
  /** Max bubbles stacked at once (oldest dropped first). */
  maxVisible?: number
  /**
   * `shell` — theme tokens (Mafia / Spy).
   * `light` — white / zinc, for Guess the Drawing canvas area.
   */
  theme?: 'shell' | 'light'
  /** Return true to show a message as a float. Default: not system. */
  shouldFloat?: (m: MobileChatFloatingMessage) => boolean
}

function defaultShouldFloat(m: MobileChatFloatingMessage) {
  return m.variant !== 'system'
}

function bubbleClasses(theme: 'shell' | 'light', variant?: string) {
  if (theme === 'light' && variant === 'correct') {
    return 'border border-teal-200/90 bg-teal-50/95 text-teal-900 shadow-md backdrop-blur-sm'
  }
  if (theme === 'light') {
    return 'border border-zinc-200/90 bg-white/95 text-zinc-800 shadow-md backdrop-blur-sm'
  }
  return 'border border-border/80 bg-surface/95 text-text shadow-lg backdrop-blur-sm'
}

function authorClasses(theme: 'shell' | 'light', variant?: string) {
  if (theme === 'light' && variant === 'correct') {
    return 'font-semibold text-teal-700'
  }
  if (theme === 'light') {
    return 'font-semibold text-zinc-900'
  }
  return 'font-semibold text-accent'
}

/**
 * Mobile-only: when the chat dock is collapsed, new non-system messages appear as short-lived bubbles
 * above the dock so players still see activity on the canvas / board.
 */
export function MobileChatFloatingToasts({
  messages,
  expanded,
  enabled = true,
  ttlMs = 6500,
  maxVisible = 4,
  theme = 'shell',
  shouldFloat = defaultShouldFloat,
}: MobileChatFloatingToastsProps) {
  const vv = useVisualViewportKeyboard()
  const [items, setItems] = useState<MobileChatFloatingMessage[]>([])
  const prevCountRef = useRef<number | null>(null)
  const timeoutsRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map())

  useEffect(() => {
    if (expanded || !enabled) {
      for (const t of timeoutsRef.current.values()) clearTimeout(t)
      timeoutsRef.current.clear()
      prevCountRef.current = messages.length
      setItems([])
      return
    }

    if (messages.length < (prevCountRef.current ?? 0)) {
      prevCountRef.current = messages.length
      for (const t of timeoutsRef.current.values()) clearTimeout(t)
      timeoutsRef.current.clear()
      setItems([])
      return
    }

    if (prevCountRef.current === null) {
      prevCountRef.current = messages.length
      return
    }

    if (messages.length > prevCountRef.current) {
      const added = messages.slice(prevCountRef.current)
      prevCountRef.current = messages.length
      const toAdd = added.filter(shouldFloat)
      if (toAdd.length === 0) return

      setItems((prev) => {
        const next = [...prev, ...toAdd]
        return next.length > maxVisible ? next.slice(-maxVisible) : next
      })

      for (const m of toAdd) {
        const id = m.id
        const existing = timeoutsRef.current.get(id)
        if (existing) clearTimeout(existing)
        const handle = setTimeout(() => {
          setItems((prev) => prev.filter((x) => x.id !== id))
          timeoutsRef.current.delete(id)
        }, ttlMs)
        timeoutsRef.current.set(id, handle)
      }
    }
  }, [messages, expanded, enabled, ttlMs, maxVisible, shouldFloat])

  useEffect(() => {
    return () => {
      for (const t of timeoutsRef.current.values()) clearTimeout(t)
      timeoutsRef.current.clear()
    }
  }, [])

  if (!enabled || items.length === 0) return null

  return (
    <div
      className="pointer-events-none fixed inset-x-0 z-40 flex flex-col items-stretch justify-end gap-2 px-3 lg:hidden"
      style={{
        bottom: `calc(7rem + env(safe-area-inset-bottom, 0px) + ${vv.bottomInset}px)`,
      }}
      aria-hidden
    >
      {items.map((m) => (
        <div
          key={m.id}
          className={`mx-auto w-full max-w-md rounded-xl px-3 py-2 text-sm leading-snug transition-opacity duration-200 ${bubbleClasses(theme, m.variant)}`}
        >
          <span className={authorClasses(theme, m.variant)}>{m.author}:</span>{' '}
          <span className="wrap-break-word">{m.text}</span>
        </div>
      ))}
    </div>
  )
}
