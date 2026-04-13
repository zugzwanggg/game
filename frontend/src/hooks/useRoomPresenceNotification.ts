import { useCallback, useEffect, useRef, useState } from 'react'
import { playRoomJoinSfx, playRoomLeaveSfx } from '../lib/synthSfx'

type Player = { id: string; displayName: string }

export type PresenceKind = 'join' | 'leave'

export function useRoomPresenceNotification(roomKey: string | null) {
  const [payload, setPayload] = useState<{ text: string; kind: PresenceKind } | null>(null)
  const prevRef = useRef<Player[]>([])
  const hydratedRef = useRef(false)

  useEffect(() => {
    hydratedRef.current = false
    prevRef.current = []
  }, [roomKey])

  const handlePlayersSnapshot = useCallback((next: Player[]) => {
    const list = next.map((p) => ({
      id: String(p.id),
      displayName: String(p.displayName ?? 'Player'),
    }))
    if (!hydratedRef.current) {
      hydratedRef.current = true
      prevRef.current = list
      return
    }
    const prev = prevRef.current
    const left = prev.filter((p) => !list.some((n) => n.id === p.id))
    const joined = list.filter((p) => !prev.some((o) => o.id === p.id))
    if (left.length) {
      playRoomLeaveSfx()
      setPayload({ text: `${left[0].displayName} left the room`, kind: 'leave' })
    } else if (joined.length) {
      playRoomJoinSfx()
      setPayload({ text: `${joined[0].displayName} joined the room`, kind: 'join' })
    }
    prevRef.current = list
  }, [])

  useEffect(() => {
    if (!payload) return
    const id = window.setTimeout(() => setPayload(null), 4000)
    return () => window.clearTimeout(id)
  }, [payload])

  const dismiss = useCallback(() => setPayload(null), [])

  return { payload, handlePlayersSnapshot, dismiss }
}
