import { User } from 'lucide-react'
import { useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import Button from '../components/ui/Button'
import { useAuth } from '../context/AuthProvider'
import { apiFetch } from '../lib/api'
import { playPathForRoom } from '../lib/roomPlayRedirect'
import { addRecentRoom } from '../lib/recentRooms'
import { getSocket } from '../lib/socket'

export default function JoinRoom() {
  const { code } = useParams()
  const navigate = useNavigate()
  const { principal, guest } = useAuth()
  const [nickname, setNickname] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  return (
    <div className="relative flex min-h-[100dvh] items-center justify-center overflow-hidden bg-base px-4 pt-[max(0px,env(safe-area-inset-top))] pb-[max(0px,env(safe-area-inset-bottom))]">
      <div
        className="glow-orb -left-20 -top-20 h-96 w-96"
        style={{ background: 'rgba(123,97,255,0.4)' }}
      />
      <div
        className="glow-orb bottom-0 right-0 h-80 w-80"
        style={{ background: 'rgba(224,64,251,0.3)' }}
      />

      <div className="relative w-full max-w-sm">
        <h1 className="mb-8 text-center text-2xl font-extrabold tracking-tight text-text sm:text-3xl">
          unplyd
        </h1>

        <div className="glass rounded-2xl p-7">
          <p className="mb-1 text-center text-xs font-semibold uppercase tracking-wider text-muted">
            You&apos;re invited
          </p>
          <h2 className="mb-1 text-center text-2xl font-extrabold text-text">
            Join Room
          </h2>
          <div className="mb-6 text-center">
            <span className="font-mono text-lg font-bold tracking-widest text-accent">
              {code ?? '------'}
            </span>
          </div>

          <label className="mb-1.5 block text-xs font-semibold text-muted">
            Your nickname
          </label>
          <div className="relative mb-5">
            <User
              size={15}
              className="absolute left-3.5 top-1/2 -translate-y-1/2 text-muted"
            />
            <input
              placeholder="Enter nickname"
              maxLength={20}
              value={nickname}
              onChange={(e) => setNickname(e.target.value)}
              className="w-full rounded-xl border border-border bg-surface py-3 pl-10 pr-4 text-sm text-text outline-none transition-colors placeholder:text-muted focus:border-accent/60"
            />
          </div>

          <Button
            variant="primary"
            size="lg"
            className="w-full justify-center"
            disabled={loading}
            onClick={() => {
              void (async () => {
                if (!code) return
                setError(null)
                const nick = nickname.trim().slice(0, 20)
                if (!principal) {
                  try {
                    await guest({
                      displayName: nick || undefined,
                    })
                  } catch (e: any) {
                    setError(e?.data?.error ?? 'Could not start guest session')
                    return
                  }
                }
                setLoading(true)
                try {
                  const socket = getSocket()
                  if (!socket.connected) socket.connect()
                  socket.emit(
                    'room:join',
                    { code, nickname: nick || undefined },
                    (res: any) => {
                      if (!res?.ok) {
                        setError(res?.error ?? 'Failed to join')
                        setLoading(false)
                        return
                      }
                      void (async () => {
                        try {
                          const roomRes = await apiFetch<{
                            room: { game?: string; matchActive?: boolean }
                          }>(`/rooms/${code}`)
                          const g = roomRes.room.game
                          const gameKey =
                            g === 'meme' ? 'meme' : 'drawing'
                          addRecentRoom({
                            code,
                            game: gameKey,
                            joinedAt: Date.now(),
                            role: 'player',
                          })
                          if (
                            roomRes.room.matchActive &&
                            (gameKey === 'drawing' || gameKey === 'meme')
                          ) {
                            void navigate(playPathForRoom(code, gameKey), {
                              replace: true,
                            })
                          } else {
                            void navigate(
                              `/room/${encodeURIComponent(code)}?game=${encodeURIComponent(gameKey)}`,
                            )
                          }
                        } catch {
                          addRecentRoom({
                            code,
                            game: 'drawing',
                            joinedAt: Date.now(),
                            role: 'player',
                          })
                          void navigate(
                            `/room/${encodeURIComponent(code)}?game=drawing`,
                          )
                        } finally {
                          setLoading(false)
                        }
                      })()
                    },
                  )
                } catch (e: any) {
                  setError(e?.data?.error ?? 'Failed to join')
                  setLoading(false)
                }
              })()
            }}
          >
            {loading ? 'Joining…' : 'Join room'}
          </Button>

          {error && (
            <p className="mt-4 text-center text-xs font-medium text-red-400">
              {error}
            </p>
          )}

          <p className="mt-4 text-center text-xs text-muted">
            No account needed. You join as a guest.
          </p>
        </div>
      </div>
    </div>
  )
}
