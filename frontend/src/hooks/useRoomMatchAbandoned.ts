import { useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import toast from 'react-hot-toast'
import { removeRecentRoom } from '../lib/recentRooms'
import { getSocket } from '../lib/socket'

type AbandonedPayload = { reason?: string; message?: string }

/**
 * When everyone else leaves during a match, the server deletes the room and emits `room:match_abandoned`.
 */
export function useRoomMatchAbandoned(roomCode: string | null, gameId?: string) {
  const navigate = useNavigate()

  useEffect(() => {
    if (!roomCode) return
    const socket = getSocket()

    const onAbandoned = (p: AbandonedPayload) => {
      socket.emit('room:leave')
      removeRecentRoom(roomCode)
      const msg =
        typeof p?.message === 'string' && p.message.trim()
          ? p.message
          : 'Everyone else left. Match cancelled.'
      toast.error(msg, { duration: 5000 })
      void navigate(gameId ? `/games/${gameId}` : '/games', { replace: true })
    }

    socket.on('room:match_abandoned', onAbandoned)
    return () => {
      socket.off('room:match_abandoned', onAbandoned)
    }
  }, [roomCode, navigate, gameId])
}
