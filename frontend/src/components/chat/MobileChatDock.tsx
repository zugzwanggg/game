import { ChevronDown, ChevronUp, MessageCircle, X } from 'lucide-react'
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from 'react'
import { useVisualViewportKeyboard } from '../../hooks/useVisualViewportKeyboard'

const COLLAPSED_DRAG_OPEN_PX = 44
const SHEET_DRAG_CLOSE_PX = 72
const SHEET_DRAG_STRETCH_PX = 52

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
  /** Shown inside the bottom bar, absolute right (e.g. room voice). Only visible below `lg`. */
  endAccessory?: ReactNode
  /**
   * Expanded panel height on mobile. `half` keeps ~half the screen for the canvas (e.g. drawing game).
   * @default 'full'
   */
  expandedSheet?: 'full' | 'half'
}

type DragSession = {
  pointerId: number
  startY: number
  mode: 'collapsed' | 'sheet'
}

/**
 * Mobile-only bottom chat: composer always visible; expand opens an overlay so the game
 * stays visible (light tint only — no backdrop blur). Drag the handle up to open; drag the
 * sheet header down to close; half mode: drag up on the header to grow the sheet.
 */
export function MobileChatDock({
  title,
  subtitle,
  expanded,
  onExpandedChange,
  messages,
  composer,
  scrollToBottomKey,
  endAccessory,
  expandedSheet = 'full',
}: MobileChatDockProps) {
  const listRef = useRef<HTMLDivElement>(null)
  const vv = useVisualViewportKeyboard()
  const [dragY, setDragY] = useState(0)
  const [halfTall, setHalfTall] = useState(false)
  const dragSession = useRef<DragSession | null>(null)

  useLayoutEffect(() => {
    if (!expanded) return
    const el = listRef.current
    if (!el) return
    el.scrollTop = el.scrollHeight
  }, [scrollToBottomKey, expanded])

  useEffect(() => {
    if (!expanded) return
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.body.style.overflow = prev
    }
  }, [expanded])

  useEffect(() => {
    if (!expanded) {
      setDragY(0)
      setHalfTall(false)
      dragSession.current = null
    }
  }, [expanded])

  const onCollapsedPointerDown = useCallback((e: ReactPointerEvent<HTMLDivElement>) => {
    if (e.pointerType === 'mouse' && e.button !== 0) return
    dragSession.current = { pointerId: e.pointerId, startY: e.clientY, mode: 'collapsed' }
    e.currentTarget.setPointerCapture(e.pointerId)
    setDragY(0)
  }, [])

  const onCollapsedPointerMove = useCallback((e: ReactPointerEvent<HTMLDivElement>) => {
    const s = dragSession.current
    if (!s || s.mode !== 'collapsed' || s.pointerId !== e.pointerId) return
    const dy = e.clientY - s.startY
    if (dy < 0) setDragY(Math.max(dy, -140))
    else setDragY(0)
  }, [])

  const onCollapsedPointerUp = useCallback(
    (e: ReactPointerEvent<HTMLDivElement>) => {
      const s = dragSession.current
      if (!s || s.mode !== 'collapsed' || s.pointerId !== e.pointerId) return
      try {
        e.currentTarget.releasePointerCapture(e.pointerId)
      } catch {
        /* ignore */
      }
      const dy = e.clientY - s.startY
      dragSession.current = null
      setDragY(0)
      if (dy < -COLLAPSED_DRAG_OPEN_PX) onExpandedChange(true)
    },
    [onExpandedChange],
  )

  const onSheetHandlePointerDown = useCallback((e: ReactPointerEvent<HTMLDivElement>) => {
    if ((e.target as HTMLElement).closest('button')) return
    if (e.pointerType === 'mouse' && e.button !== 0) return
    dragSession.current = { pointerId: e.pointerId, startY: e.clientY, mode: 'sheet' }
    e.currentTarget.setPointerCapture(e.pointerId)
    setDragY(0)
  }, [])

  const onSheetHandlePointerMove = useCallback(
    (e: ReactPointerEvent<HTMLDivElement>) => {
      const s = dragSession.current
      if (!s || s.mode !== 'sheet' || s.pointerId !== e.pointerId) return
      const dy = e.clientY - s.startY
      if (expandedSheet === 'half') {
        setDragY(Math.min(220, Math.max(dy, -160)))
      } else {
        setDragY(Math.min(220, Math.max(dy, 0)))
      }
    },
    [expandedSheet],
  )

  const onSheetHandlePointerUp = useCallback(
    (e: ReactPointerEvent<HTMLDivElement>) => {
      const s = dragSession.current
      if (!s || s.mode !== 'sheet' || s.pointerId !== e.pointerId) return
      try {
        e.currentTarget.releasePointerCapture(e.pointerId)
      } catch {
        /* ignore */
      }
      const dy = e.clientY - s.startY
      dragSession.current = null
      setDragY(0)

      if (dy > SHEET_DRAG_CLOSE_PX) {
        onExpandedChange(false)
        setHalfTall(false)
        return
      }
      if (expandedSheet === 'half') {
        setHalfTall((tall) => {
          if (dy < -SHEET_DRAG_STRETCH_PX) return true
          if (tall && dy > SHEET_DRAG_STRETCH_PX) return false
          return tall
        })
      }
    },
    [expandedSheet, onExpandedChange],
  )

  const dockInner = (
    <div
      className={`mx-auto flex max-w-lg items-end gap-2 ${endAccessory ? 'max-lg:pr-[3.25rem]' : ''}`}
    >
      <button
        type="button"
        onClick={() => onExpandedChange(!expanded)}
        className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-white/30 bg-white/70 text-zinc-800 shadow-sm transition-colors hover:bg-white/85 active:scale-[0.98] dark:border-white/15 dark:bg-zinc-900/65 dark:text-zinc-100 dark:hover:bg-zinc-900/80"
        aria-expanded={expanded}
        aria-controls="mobile-chat-sheet"
        title={expanded ? 'Hide messages' : 'Show messages'}
      >
        {expanded ? (
          <ChevronDown size={20} strokeWidth={2} />
        ) : (
          <ChevronUp size={20} strokeWidth={2} />
        )}
      </button>
      <div className="min-w-0 flex-1">{composer}</div>
    </div>
  )

  const dockBar = (
    <div className="pointer-events-auto relative z-[2] border-t border-white/25 bg-white/80 px-2 pb-[max(0.5rem,env(safe-area-inset-bottom))] pt-2 shadow-[0_-10px_40px_rgba(0,0,0,0.07)] dark:border-white/10 dark:bg-zinc-950/80">
      {dockInner}
      {endAccessory ? (
        <div className="pointer-events-auto absolute right-2 top-1/2 z-[1] -translate-y-1/2 lg:hidden">
          {endAccessory}
        </div>
      ) : null}
    </div>
  )

  const collapsedDockStyle: CSSProperties = {
    bottom: vv.bottomInset,
  }

  const expandedShellStyle: CSSProperties = {
    top: vv.overlayTop,
    left: vv.overlayLeft,
    width: vv.overlayWidth,
    height: vv.overlayHeight,
  }

  const sheetTransformStyle: CSSProperties = {
    transform: dragY !== 0 ? `translateY(${dragY}px)` : undefined,
    transition: dragY !== 0 ? 'none' : 'transform 0.22s ease-out',
  }

  const halfSheetHeightClass = halfTall
    ? 'h-[min(78dvh,78svh,36rem)] max-h-[min(78dvh,78svh,36rem)]'
    : 'h-[min(50dvh,50svh,28rem)] max-h-[min(50dvh,50svh,28rem)]'

  if (!expanded) {
    return (
      <div
        className="pointer-events-none fixed inset-x-0 z-[45] lg:hidden"
        style={collapsedDockStyle}
      >
        <div className="pointer-events-auto" style={sheetTransformStyle}>
          <div
            className="flex cursor-grab touch-none select-none items-center justify-center rounded-t-xl border-x border-t border-white/25 bg-white/85 py-2.5 active:cursor-grabbing dark:border-white/10 dark:bg-zinc-950/85"
            onPointerDown={onCollapsedPointerDown}
            onPointerMove={onCollapsedPointerMove}
            onPointerUp={onCollapsedPointerUp}
            onPointerCancel={onCollapsedPointerUp}
            aria-label="Drag up to open chat"
          >
            <span className="h-1.5 w-14 shrink-0 rounded-full bg-zinc-400/80 dark:bg-zinc-500/80" />
          </div>
          {dockBar}
        </div>
      </div>
    )
  }

  const sheetRootClass =
    expandedSheet === 'half'
      ? 'pointer-events-auto flex max-h-full min-h-0 w-full flex-col overflow-hidden rounded-t-[1.35rem] border border-white/35 bg-white/88 shadow-[0_8px_48px_rgba(0,0,0,0.12)] dark:border-white/12 dark:bg-zinc-950/88'
      : 'pointer-events-auto flex min-h-0 w-full flex-1 flex-col overflow-hidden rounded-t-[1.35rem] border border-white/35 bg-white/88 shadow-[0_8px_48px_rgba(0,0,0,0.12)] dark:border-white/12 dark:bg-zinc-950/88'

  const sheetBody = (
    <div
      id="mobile-chat-sheet"
      role="dialog"
      aria-modal="true"
      aria-label={title}
      className={sheetRootClass}
    >
      <div className="relative flex shrink-0 flex-col border-b border-white/20 dark:border-white/10">
        <div
          className="flex cursor-grab touch-none select-none flex-col items-center gap-1 px-3 pb-2 pt-2 active:cursor-grabbing"
          onPointerDown={onSheetHandlePointerDown}
          onPointerMove={onSheetHandlePointerMove}
          onPointerUp={onSheetHandlePointerUp}
          onPointerCancel={onSheetHandlePointerUp}
        >
          <span className="h-1 w-10 shrink-0 rounded-full bg-zinc-400/50 dark:bg-zinc-500/50" aria-hidden />
          <div className="flex w-full items-start gap-2.5 pr-10">
            <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-accent/15 text-accent">
              <MessageCircle size={17} strokeWidth={2} />
            </span>
            <div className="min-w-0 flex-1">
              <div className="truncate text-sm font-bold tracking-tight text-zinc-900 dark:text-zinc-50">
                {title}
              </div>
              {subtitle ? (
                <div className="mt-0.5 line-clamp-2 text-[11px] leading-snug text-zinc-600 dark:text-zinc-400">
                  {subtitle}
                </div>
              ) : null}
            </div>
          </div>
        </div>
        <button
          type="button"
          onClick={() => {
            setHalfTall(false)
            onExpandedChange(false)
          }}
          className="absolute right-2 top-2 inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-white/35 bg-white/85 text-zinc-700 shadow-sm transition-colors hover:bg-white dark:border-white/15 dark:bg-zinc-900/75 dark:text-zinc-200 dark:hover:bg-zinc-800/90"
          aria-label="Close"
        >
          <X size={18} />
        </button>
      </div>

      <div
        ref={listRef}
        className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-3 py-3 [scrollbar-gutter:stable]"
      >
        {messages}
      </div>

      <div className="relative shrink-0 border-t border-white/30 bg-white/80 pb-[max(0.35rem,env(safe-area-inset-bottom))] pt-2 dark:border-white/10 dark:bg-zinc-950/80">
        <div className="px-2">{dockInner}</div>
        {endAccessory ? (
          <div className="pointer-events-auto absolute right-2 top-1/2 z-[1] -translate-y-1/2 lg:hidden">
            {endAccessory}
          </div>
        ) : null}
      </div>
    </div>
  )

  if (expandedSheet === 'half') {
    return (
      <div
        className="pointer-events-none fixed z-[45] flex flex-col justify-end lg:hidden min-h-0"
        style={expandedShellStyle}
      >
        <button
          type="button"
          className="pointer-events-auto absolute inset-0 z-0 bg-zinc-950/[0.06] transition-colors hover:bg-zinc-950/[0.1] dark:bg-white/[0.04] dark:hover:bg-white/[0.07]"
          aria-label="Close messages"
          onClick={() => {
            setHalfTall(false)
            onExpandedChange(false)
          }}
        />
        <div
          className={`relative z-[1] flex min-h-0 w-full flex-col px-2 pb-[max(0.25rem,env(safe-area-inset-bottom))] ${halfSheetHeightClass}`}
          style={sheetTransformStyle}
        >
          {sheetBody}
        </div>
      </div>
    )
  }

  return (
    <div
      className="pointer-events-none fixed z-[45] flex flex-col lg:hidden min-h-0"
      style={expandedShellStyle}
    >
      <button
        type="button"
        className="pointer-events-auto relative z-0 min-h-[min(14vh,6.5rem)] shrink-0 border-b border-white/10 bg-zinc-950/[0.05] transition-colors hover:bg-zinc-950/[0.09] dark:bg-white/[0.04] dark:hover:bg-white/[0.07]"
        aria-label="Close messages"
        onClick={() => onExpandedChange(false)}
      />

      <div className="relative z-[1] flex min-h-0 flex-1 flex-col px-2 pb-0" style={sheetTransformStyle}>
        {sheetBody}
      </div>
    </div>
  )
}

/** Reserve space so the fixed dock does not cover game controls (mobile). */
/** Includes extra space for the collapsed drag handle above the composer bar. */
export const MOBILE_CHAT_DOCK_PAD_CLASS =
  'max-lg:pb-[calc(6.5rem+env(safe-area-inset-bottom,0px))]'
