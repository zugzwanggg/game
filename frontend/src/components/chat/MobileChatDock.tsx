import { ChevronDown, ChevronUp, X } from 'lucide-react'
import { useLayoutEffect, useRef, type ReactNode } from 'react'

type MobileChatDockProps = {
  title: string
  subtitle?: string
  expanded: boolean
  onExpandedChange: (open: boolean) => void
  /** Scrollable message list (same content as desktop chat). */
  messages: ReactNode
  /** Always visible row: input + send, or hints when input disabled. */
  composer: ReactNode
  /** Bumps when chat updates (e.g. `${messages.length}:${lastId}`) to auto-scroll the sheet. */
  scrollToBottomKey: string | number
}

/**
 * Mobile-only bottom chat: composer always visible; tap chevron to expand message history.
 * Desktop should use the normal inline chat panel (`lg:hidden` on this component).
 */
export function MobileChatDock({
  title,
  subtitle,
  expanded,
  onExpandedChange,
  messages,
  composer,
  scrollToBottomKey,
}: MobileChatDockProps) {
  const listRef = useRef<HTMLDivElement>(null)

  useLayoutEffect(() => {
    if (!expanded) return
    const el = listRef.current
    if (!el) return
    el.scrollTop = el.scrollHeight
  }, [scrollToBottomKey, expanded])

  return (
    <>
      {expanded && (
        <button
          type="button"
          className="fixed inset-0 z-[35] bg-zinc-900/45 lg:hidden"
          aria-label="Close messages"
          onClick={() => onExpandedChange(false)}
        />
      )}
      <div className="pointer-events-none fixed inset-x-0 bottom-0 z-[45] flex flex-col-reverse lg:hidden">
        {expanded && (
          <div
            id="mobile-chat-sheet"
            role="dialog"
            aria-modal="true"
            aria-label={title}
            className="pointer-events-auto mx-2 mb-2 flex max-h-[min(50svh,22rem)] flex-col overflow-hidden rounded-t-2xl border border-zinc-200/90 bg-white shadow-xl sm:mx-4"
          >
            <div className="flex shrink-0 items-center justify-between gap-2 border-b border-zinc-200 px-3 py-2.5">
              <div className="min-w-0">
                <div className="truncate text-sm font-semibold text-zinc-900">{title}</div>
                {subtitle ? <div className="truncate text-[10px] text-zinc-500">{subtitle}</div> : null}
              </div>
              <button
                type="button"
                onClick={() => onExpandedChange(false)}
                className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-zinc-200 text-zinc-600 transition-colors hover:bg-zinc-50"
                aria-label="Close"
              >
                <X size={18} />
              </button>
            </div>
            <div
              ref={listRef}
              className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-3 py-2 [scrollbar-gutter:stable]"
            >
              {messages}
            </div>
          </div>
        )}
        <div className="pointer-events-auto border-t border-zinc-200/90 bg-white/98 px-2 pb-[max(0.5rem,env(safe-area-inset-bottom))] pt-2 shadow-[0_-8px_28px_rgba(0,0,0,0.12)] backdrop-blur-md">
          <div className="mx-auto flex max-w-lg items-end gap-2">
            <button
              type="button"
              onClick={() => onExpandedChange(!expanded)}
              className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-zinc-200 bg-white text-zinc-700 shadow-sm transition-colors hover:bg-zinc-50 active:scale-[0.98]"
              aria-expanded={expanded}
              aria-controls="mobile-chat-sheet"
              title={expanded ? 'Hide messages' : 'Show messages'}
            >
              {expanded ? <ChevronDown size={20} strokeWidth={2} /> : <ChevronUp size={20} strokeWidth={2} />}
            </button>
            <div className="min-w-0 flex-1">{composer}</div>
          </div>
        </div>
      </div>
    </>
  )
}

/** Reserve space so the fixed dock does not cover game controls (mobile). */
export const MOBILE_CHAT_DOCK_PAD_CLASS = 'max-lg:pb-[calc(5.25rem+env(safe-area-inset-bottom,0px))]'
