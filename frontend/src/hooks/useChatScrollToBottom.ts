import { useLayoutEffect, useRef } from 'react'

export function chatListScrollKey(messages: readonly { id: string }[]): string | number {
  if (messages.length === 0) return 0
  const last = messages[messages.length - 1]
  return `${messages.length}:${last?.id ?? ''}`
}

/**
 * Ref for a scrollable chat list; pins to bottom when `scrollKey` changes (e.g. new message)
 * or when `active` flips true (e.g. mobile sheet opened).
 */
export function useChatScrollToBottom(scrollKey: string | number, active = true) {
  const ref = useRef<HTMLDivElement>(null)

  useLayoutEffect(() => {
    if (!active) return
    const el = ref.current
    if (!el) return
    el.scrollTop = el.scrollHeight
  }, [scrollKey, active])

  return ref
}
