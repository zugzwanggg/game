import {
  ArrowLeft,
  ChevronDown,
  Clock,
  Users,
} from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { AuthChoiceModal } from '../components/auth/AuthChoiceModal'
import { CreateRoomModal } from '../components/game/CreateRoomModal'
import { GameCover } from '../components/game/GameCover'
import Badge from '../components/ui/Badge'
import Button from '../components/ui/Button'
import { useAuth } from '../context/AuthProvider'
import { apiFetch } from '../lib/api'
import { addRecentRoom } from '../lib/recentRooms'
import { joinRoom } from '../lib/roomJoin'
import { getGame } from '../games'

function randomRoomCode(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
  let s = ''
  for (let i = 0; i < 6; i++) {
    s += chars.charAt(Math.floor(Math.random() * chars.length))
  }
  return s
}

export default function GameRoom() {
  const { gameId } = useParams()
  const navigate = useNavigate()
  const game = getGame(gameId)
  const { principal, guest } = useAuth()
  const [menuOpen, setMenuOpen] = useState(false)
  const [createRoomModalOpen, setCreateRoomModalOpen] = useState(false)
  const [createRoomModalKey, setCreateRoomModalKey] = useState(0)
  const menuRef = useRef<HTMLDivElement>(null)
  const [authModalOpen, setAuthModalOpen] = useState(false)
  const [matchmakingError, setMatchmakingError] = useState<string | null>(null)

  const joinRandomRoom = async () => {
    setMatchmakingError(null)
    if (!game) return
    // Require either signed-in or explicit guest choice.
    if (!principal) {
      setAuthModalOpen(true)
      return
    }
    try {
      const res = await apiFetch<{
        created?: boolean
        room: { code: string; game?: string }
      }>(
        `/rooms/random?game=${encodeURIComponent(game.id)}`,
        { method: 'GET' },
      )
      const code = res.room.code
      const roomGame = (res.room.game ?? game.id) as string
      addRecentRoom({
        code,
        game: roomGame,
        joinedAt: Date.now(),
        role: res.created ? 'host' : 'player',
      })
      void navigate(`/room/${code}?game=${encodeURIComponent(roomGame)}`)
    } catch (e: any) {
      if (e?.data?.error === 'no_public_rooms') {
        setMatchmakingError('No public rooms are open right now. Ask a friend to start one.')
      } else {
        setMatchmakingError('Could not join a random room.')
      }
    }
  }

  useEffect(() => {
    if (!menuOpen) return
    const onDoc = (e: MouseEvent) => {
      if (menuRef.current?.contains(e.target as Node)) return
      setMenuOpen(false)
    }
    document.addEventListener('click', onDoc)
    return () => document.removeEventListener('click', onDoc)
  }, [menuOpen])

  if (!game) {
    return (
      <div className="flex h-full items-center justify-center text-muted">
        Game not found
      </div>
    )
  }

  return (
    <>
    <AuthChoiceModal
      open={authModalOpen}
      onClose={() => setAuthModalOpen(false)}
      onContinueGuest={(name) => {
        void (async () => {
          await guest({ displayName: name })
          // After guest session is created, try again.
          await joinRandomRoom()
        })()
      }}
    />
    <div className="relative isolate min-h-full overflow-x-hidden px-4 py-6 sm:px-8 sm:py-8">
      <div
        className="glow-orb -right-20 top-0 h-96 w-96"
        style={{ background: game.glowColor }}
      />

      <button
        type="button"
        onClick={() => void navigate('/games')}
        className="mb-8 flex items-center gap-2 text-sm text-muted transition-colors hover:text-text"
      >
        <ArrowLeft size={15} /> Back to games
      </button>

      <div className="relative grid grid-cols-1 gap-8 lg:grid-cols-5">
        <div className="space-y-6 lg:col-span-3">
          <div>
            <div className="mb-5 overflow-hidden rounded-2xl border border-border">
              <GameCover game={game} variant="detail" />
            </div>
            <h1 className="mb-2 flex flex-wrap items-center gap-2 text-2xl font-extrabold text-text sm:text-3xl">
              {game.label}
              {game.beta && <Badge color="muted">Beta</Badge>}
            </h1>
            <p className="mb-4 text-lg font-medium text-accent">
              {game.tagline}
            </p>
            <p className="max-w-lg text-sm leading-relaxed text-muted">
              {game.description}
            </p>
          </div>

          <div className="flex flex-wrap gap-3">
            <div className="flex items-center gap-2 rounded-xl border border-border bg-card px-4 py-2.5">
              <Users size={15} className="text-accent" />
              <span className="text-sm font-medium text-text">
                {game.players}
              </span>
            </div>
            <div className="flex items-center gap-2 rounded-xl border border-border bg-card px-4 py-2.5">
              <Clock size={15} className="text-fuchsia" />
              <span className="text-sm font-medium text-text">
                {game.duration}
              </span>
            </div>
          </div>

          <div className="flex flex-wrap gap-2">
            {game.tags.map((tag) => (
              <Badge key={tag} color="accent">
                {tag}
              </Badge>
            ))}
          </div>

          {game.id === 'drawing' && (
            <p className="text-sm text-muted">
              <Link
                to="/games/drawing/play"
                className="font-medium text-accent hover:text-accent/80"
              >
                Open local drawing round (sandbox)
              </Link>
            </p>
          )}
        </div>

        <div className="lg:col-span-2">
          <div
            ref={menuRef}
            className="rounded-2xl border border-border bg-card p-5 lg:sticky lg:top-8"
          >
            <p className="mb-1 text-sm font-semibold text-text">Ready?</p>
            <p className="mb-5 text-xs leading-relaxed text-muted">
              Start a private lobby or drop into matchmaking with other players.
            </p>

            <div className="relative">
              <Button
                variant="teal"
                size="lg"
                type="button"
                className="w-full justify-center gap-2"
                onClick={(e) => {
                  e.stopPropagation()
                  setMenuOpen((o) => !o)
                }}
              >
                Start Game
                <ChevronDown
                  size={18}
                  className={`transition-transform duration-200 ${menuOpen ? 'rotate-180' : ''}`}
                />
              </Button>

              {menuOpen && (
                <div className="absolute left-0 right-0 top-full z-10 mt-2 overflow-hidden rounded-xl border border-border bg-surface shadow-card">
                  <button
                    type="button"
                    className="flex w-full items-center px-4 py-3 text-left text-sm font-semibold text-text transition-colors hover:bg-card"
                    onClick={() => {
                      setMenuOpen(false)
                      setCreateRoomModalKey((k) => k + 1)
                      setCreateRoomModalOpen(true)
                    }}
                  >
                    Create a room
                  </button>
                  <div className="mx-3 border-t border-border" />
                  <button
                    type="button"
                    className="flex w-full items-center px-4 py-3 text-left text-sm font-semibold text-text transition-colors hover:bg-card"
                    onClick={() => {
                      setMenuOpen(false)
                      void joinRandomRoom()
                    }}
                  >
                    Join a random room
                  </button>
                </div>
              )}
            </div>

            {matchmakingError && (
              <p className="mt-3 text-center text-xs font-medium text-red-400">
                {matchmakingError}
              </p>
            )}

            <div className="mt-6 border-t border-border pt-6">
              <p className="mb-4 text-sm font-semibold text-text">How to play</p>
              <ol className="space-y-3">
                {[
                  'Press Start Game, then pick Create a room or Join a random room.',
                  'In a private room, share your link so friends can join as guests.',
                  'When everyone is ready, the host starts the match.',
                ].map((step, i) => (
                  <li
                    key={step}
                    className="flex items-start gap-3 text-sm text-muted"
                  >
                    <span
                      className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-xs font-bold text-white"
                      style={{ backgroundColor: game.accentColor }}
                    >
                      {i + 1}
                    </span>
                    {step}
                  </li>
                ))}
              </ol>
            </div>
          </div>
        </div>
      </div>
    </div>

    <CreateRoomModal
      key={createRoomModalKey}
      open={createRoomModalOpen}
      onClose={() => setCreateRoomModalOpen(false)}
      gameTitle={game.label}
      onConfirm={(isPrivate) => {
        void (async () => {
          if (!game) return
          // Only authenticated users can create rooms.
          if (!principal || principal.kind !== 'user') {
            void navigate('/login', { state: { from: `/games/${gameId ?? ''}` } })
            return
          }

          try {
            const res = await apiFetch<{ room: { code: string; game?: string } }>('/rooms', {
              method: 'POST',
              body: JSON.stringify({ game: game.id, isPrivate }),
            })
            const code = res.room.code
            const roomGame = (res.room.game ?? game.id) as string
            addRecentRoom({ code, game: roomGame, joinedAt: Date.now(), role: 'host' })
            // Ensure the creator is added to the room immediately (prevents empty-room edge cases).
            await joinRoom(code)
            void navigate(`/room/${code}?game=${encodeURIComponent(roomGame)}`, {
              state: { isPrivate },
            })
          } catch {
            // Fallback for UI demo
            const code = randomRoomCode()
            const gid = gameId ?? ''
            void navigate(`/room/${code}?game=${encodeURIComponent(gid)}`, {
              state: { isPrivate },
            })
          }
        })()
      }}
    />
    </>
  )
}
