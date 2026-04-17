import { ArrowLeft, Copy, Link2, UserPlus, Wifi } from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { AuthChoiceModal } from '../components/auth/AuthChoiceModal'
import Avatar from '../components/ui/Avatar'
import Badge from '../components/ui/Badge'
import Button from '../components/ui/Button'
import { useAuth } from '../context/AuthProvider'
import { getGame } from '../games'
import { apiFetch } from '../lib/api'
import { matchInProgressFromSocketState, playPathForRoom } from '../lib/roomPlayRedirect'
import { removeRecentRoom } from '../lib/recentRooms'
import { getSocket } from '../lib/socket'
import { RoomPresenceBanner } from '../components/ui/RoomPresenceBanner'
import { RoomVoiceDock } from '../components/voice/RoomVoiceDock'
import { useRoomPresenceNotification } from '../hooks/useRoomPresenceNotification'
import { joinRoom } from '../lib/roomJoin'

function buildInviteUrl(code: string) {
  const origin =
    typeof window !== 'undefined' ? window.location.origin : ''
  return `${origin}/join/${code}`
}

export default function RoomPage() {
  const { roomCode } = useParams()
  const [searchParams] = useSearchParams()
  const navigate = useNavigate()
  const gameId = searchParams.get('game') ?? undefined
  const game = getGame(gameId)
  const { principal, guest, ready } = useAuth()

  const [players, setPlayers] = useState<{ id: string; displayName: string; kind: string }[]>([])
  const [authModalOpen, setAuthModalOpen] = useState(false)
  const [isPrivate, setIsPrivate] = useState<boolean | null>(null)
  const [createdByUserId, setCreatedByUserId] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)
  const [localPlayer, setLocalPlayer] = useState<{ id: string; displayName: string } | null>(null)
  const playRedirectDoneRef = useRef(false)
  const { payload: presencePayload, handlePlayersSnapshot, dismiss: dismissPresence } =
    useRoomPresenceNotification(roomCode ?? null)

  useEffect(() => {
    playRedirectDoneRef.current = false
  }, [roomCode])

  const goToPlayIfMatch = useCallback(
    (game: 'drawing' | 'meme' | 'spy' | 'mafia' | 'liar') => {
      if (!roomCode || playRedirectDoneRef.current) return
      playRedirectDoneRef.current = true
      void navigate(playPathForRoom(roomCode, game), { replace: true })
    },
    [roomCode, navigate],
  )

  const isHost =
    principal?.kind === 'user' &&
    createdByUserId !== null &&
    principal.id === createdByUserId

  const inviteUrl = useMemo(
    () => (roomCode ? buildInviteUrl(roomCode) : ''),
    [roomCode],
  )

  useEffect(() => {
    if (!roomCode) return
    let mounted = true
    void (async () => {
      try {
        const res = await apiFetch<{
          room: {
            players: any[]
            isPrivate?: boolean
            createdByUserId?: string
            game?: string
            matchActive?: boolean
          }
        }>(`/rooms/${roomCode}`)
        if (!mounted) return
        setPlayers(res.room.players ?? [])
        setIsPrivate(Boolean(res.room.isPrivate))
        if (res.room.createdByUserId) setCreatedByUserId(res.room.createdByUserId)
        if (
          res.room.matchActive &&
          (res.room.game === 'drawing' ||
            res.room.game === 'meme' ||
            res.room.game === 'spy' ||
            res.room.game === 'mafia' ||
            res.room.game === 'liar')
        ) {
          goToPlayIfMatch(res.room.game as 'drawing' | 'meme' | 'spy' | 'mafia' | 'liar')
        }
      } catch {
        // ignore; socket will hydrate if possible
      }
    })()
    return () => {
      mounted = false
    }
  }, [roomCode, goToPlayIfMatch])

  useEffect(() => {
    if (!roomCode) return
    const socket = getSocket()
    if (!socket.connected) socket.connect()

    const onState = (state: any) => {
      if (String(state?.code ?? '').toUpperCase() !== roomCode.toUpperCase()) return
      const nextPlayers = (state.players ?? []) as { id: string; displayName: string; kind: string }[]
      setPlayers(nextPlayers)
      if (typeof state.createdByUserId === 'string') setCreatedByUserId(state.createdByUserId)

      if (matchInProgressFromSocketState(state)) {
        const gRaw =
          (state.game as string | undefined) ??
          gameId ??
          (state?.drawingGame
            ? 'drawing'
            : state?.memeGame
              ? 'meme'
              : state?.spyGame
                ? 'spy'
                : state?.mafiaGame
                  ? 'mafia'
                  : state?.liarGame
                    ? 'liar'
                    : undefined)
        if (
          gRaw === 'drawing' ||
          gRaw === 'meme' ||
          gRaw === 'spy' ||
          gRaw === 'mafia' ||
          gRaw === 'liar'
        )
          goToPlayIfMatch(gRaw)
      }

      handlePlayersSnapshot(
        nextPlayers.map((p) => ({ id: p.id, displayName: p.displayName })),
      )
    }
    const onGameStarted = (payload: { code?: string; game?: string }) => {
      if (String(payload?.code ?? '').toUpperCase() !== roomCode.toUpperCase()) return
      if (payload?.game !== 'drawing') return
      void navigate(`/games/drawing/play?room=${encodeURIComponent(roomCode)}`)
    }
    const onMemeStarted = (payload: { code?: string; game?: string }) => {
      if (String(payload?.code ?? '').toUpperCase() !== roomCode.toUpperCase()) return
      if (payload?.game !== 'meme') return
      void navigate(`/games/meme/play?room=${encodeURIComponent(roomCode)}`)
    }
    const onSpyStarted = (payload: { code?: string; game?: string }) => {
      if (String(payload?.code ?? '').toUpperCase() !== roomCode.toUpperCase()) return
      if (payload?.game !== 'spy') return
      void navigate(`/games/spy/play?room=${encodeURIComponent(roomCode)}`)
    }
    const onMafiaStarted = (payload: { code?: string; game?: string }) => {
      if (String(payload?.code ?? '').toUpperCase() !== roomCode.toUpperCase()) return
      if (payload?.game !== 'mafia') return
      void navigate(`/games/mafia/play?room=${encodeURIComponent(roomCode)}`)
    }
    const onLiarStarted = (payload: { code?: string; game?: string }) => {
      if (String(payload?.code ?? '').toUpperCase() !== roomCode.toUpperCase()) return
      if (payload?.game !== 'liar') return
      void navigate(`/games/liar/play?room=${encodeURIComponent(roomCode)}`)
    }
    socket.on('room:state', onState)
    socket.on('game:drawing:started', onGameStarted)
    socket.on('game:meme:started', onMemeStarted)
    socket.on('game:spy:started', onSpyStarted)
    socket.on('game:mafia:started', onMafiaStarted)
    socket.on('game:liar:started', onLiarStarted)

    if (!ready) return
    if (!principal) {
      setAuthModalOpen(true)
      return
    }
    void joinRoom(roomCode).then((res) => {
      if (res.player?.id) {
        setLocalPlayer({
          id: String(res.player.id),
          displayName: String(res.player.displayName ?? 'Player'),
        })
      }
    })

    return () => {
      socket.off('room:state', onState)
      socket.off('game:drawing:started', onGameStarted)
      socket.off('game:meme:started', onMemeStarted)
      socket.off('game:spy:started', onSpyStarted)
      socket.off('game:mafia:started', onMafiaStarted)
      socket.off('game:liar:started', onLiarStarted)
    }
  }, [roomCode, principal, ready, navigate, goToPlayIfMatch, handlePlayersSnapshot])

  if (!roomCode) {
    return (
      <div className="flex h-full items-center justify-center text-muted">
        Invalid room
      </div>
    )
  }

  return (
    <div className="relative min-h-full overflow-x-hidden px-4 py-6 sm:px-8 sm:py-8">
      <RoomPresenceBanner
        message={presencePayload?.text ?? null}
        kind={presencePayload?.kind ?? null}
        onDismiss={dismissPresence}
      />
      <AuthChoiceModal
        open={authModalOpen}
        onClose={() => setAuthModalOpen(false)}
        onContinueGuest={() => {
          void (async () => {
            await guest({})
            if (!roomCode) return
            const socket = getSocket()
            if (!socket.connected) socket.connect()
            socket.emit('room:join', { code: roomCode }, () => {})
          })()
        }}
      />
      <button
        type="button"
        onClick={() => void navigate('/games')}
        className="mb-8 flex items-center gap-2 text-sm text-muted transition-colors hover:text-text"
      >
        <ArrowLeft size={15} /> Back to games
      </button>

      <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-2">
          <Badge color="teal">
            {players.length}
            {game?.maxPlayers ? ` / ${game.maxPlayers}` : ''} players
          </Badge>
        </div>
        <div className="flex sm:justify-end">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="min-h-10 w-full justify-center sm:w-auto"
            onClick={() => {
              const socket = getSocket()
              socket.emit('room:leave')
              removeRecentRoom(roomCode)
              void navigate('/games')
            }}
          >
            Quit room
          </Button>
        </div>
      </div>

      <div className="mx-auto max-w-2xl">
        <div className="mb-2 flex flex-wrap items-center gap-2">
          {game ? (
            <>
              <Link
                to={`/games/${game.id}`}
                className="text-sm font-medium text-accent hover:text-accent/80"
              >
                {game.label}
              </Link>
              {game.beta && <Badge color="muted">Beta</Badge>}
            </>
          ) : (
            <span className="text-sm text-muted">Room</span>
          )}
          <span className="text-muted">·</span>
          <span className="font-mono text-sm font-bold tracking-widest text-text">
            {roomCode}
          </span>
          {isPrivate !== null && (
            <>
              <span className="text-muted">·</span>
              <Badge color={isPrivate ? 'muted' : 'teal'}>
                {isPrivate ? 'Private' : 'Public'}
              </Badge>
            </>
          )}
        </div>

        <div className="mb-6 flex items-center gap-1.5">
          <Wifi size={14} className="text-teal" />
          <span className="text-sm font-medium text-teal">Live</span>
        </div>

        <div className="mb-6">
          <RoomVoiceDock
            roomCode={roomCode}
            myPlayerId={localPlayer?.id ?? null}
            players={players.map((p) => ({ id: p.id, displayName: p.displayName }))}
          />
        </div>

        <div className="rounded-2xl border border-border bg-card p-6">
          <div className="mb-4 flex items-center justify-between">
            <p className="text-sm font-semibold text-text">Invite link</p>
            <Badge color="teal">
              {game
                ? `${players.length} / ${game.maxPlayers}`
                : players.length}
            </Badge>
          </div>

          <div className="mb-6 flex items-center gap-2 rounded-xl bg-surface p-3">
            <Link2 size={14} className="shrink-0 text-accent" />
            <span className="min-w-0 flex-1 truncate font-mono text-xs text-muted">
              {inviteUrl}
            </span>
            <button
              type="button"
              className={`inline-flex min-h-10 min-w-10 shrink-0 items-center justify-center rounded-lg transition-colors ${
                copied
                  ? 'bg-teal/15 text-teal'
                  : 'text-muted hover:bg-white/5 hover:text-text'
              }`}
              title={copied ? 'Copied' : 'Copy link'}
              onClick={() => {
                void navigator.clipboard.writeText(inviteUrl)
                setCopied(true)
                window.setTimeout(() => setCopied(false), 900)
              }}
            >
              <Copy size={15} className={copied ? 'animate-pulse' : ''} />
            </button>
            {copied && (
              <span className="text-[10px] font-semibold text-teal">
                Copied!
              </span>
            )}
          </div>

          <p className="mb-3 text-xs font-semibold uppercase tracking-wider text-muted">
            Players
          </p>
          <div className="mb-6 space-y-2">
            {players.map((p) => (
              <div key={p.id} className="flex items-center gap-3">
                <Avatar name={p.displayName} size="sm" />
                <span className="flex-1 text-sm text-text">{p.displayName}</span>
                {createdByUserId && p.id === createdByUserId && (
                  <Badge color="accent">host</Badge>
                )}
                <div className="h-2 w-2 rounded-full bg-teal" />
              </div>
            ))}
          </div>

          <button
            type="button"
            className="mb-6 flex w-full items-center justify-center gap-2 rounded-xl border border-dashed border-border py-2.5 text-sm text-muted transition-all hover:border-accent/40 hover:text-text"
          >
            <UserPlus size={14} /> Invite more players
          </button>

          {game?.id === 'drawing' ? (
            isHost ? (
              <Button
                variant="teal"
                size="lg"
                className="w-full justify-center"
                type="button"
                disabled={players.length < 2}
                onClick={() => {
                  const socket = getSocket()
                  if (!socket.connected) socket.connect()
                  socket.emit('game:drawing:start')
                }}
              >
                {players.length < 2 ? 'Need 2+ players' : 'Start match'}
              </Button>
            ) : (
              <p className="text-center text-sm text-muted">
                {principal?.kind === 'user'
                  ? 'Only the room host can start the match.'
                  : 'Sign in as the host to start the match, or wait for the host.'}
              </p>
            )
          ) : game?.id === 'meme' ? (
            isHost ? (
              <Button
                variant="teal"
                size="lg"
                className="w-full justify-center"
                type="button"
                disabled={players.length < 2}
                onClick={() => {
                  const socket = getSocket()
                  if (!socket.connected) socket.connect()
                  socket.emit('game:meme:start')
                  void navigate(`/games/meme/play?room=${encodeURIComponent(roomCode ?? '')}`)
                }}
              >
                {players.length < 2 ? 'Need 2+ players' : 'Start match'}
              </Button>
            ) : (
              <p className="text-center text-sm text-muted">
                Only the room host can start the match.
              </p>
            )
          ) : (
            game?.id === 'spy' ? (
              isHost ? (
                <Button
                  variant="teal"
                  size="lg"
                  className="w-full justify-center"
                  type="button"
                  disabled={players.length < 3 || players.length > 10}
                  onClick={() => {
                    const socket = getSocket()
                    if (!socket.connected) socket.connect()
                    socket.emit('game:spy:start')
                    void navigate(`/games/spy/play?room=${encodeURIComponent(roomCode ?? '')}`)
                  }}
                >
                  {players.length < 3
                    ? 'Need 3+ players'
                    : players.length > 10
                      ? 'Max 10 players'
                      : 'Start match'}
                </Button>
              ) : (
                <p className="text-center text-sm text-muted">
                  Only the room host can start the match.
                </p>
              )
            ) : game?.id === 'mafia' ? (
              isHost ? (
                <Button
                  variant="teal"
                  size="lg"
                  className="w-full justify-center"
                  type="button"
                  disabled={players.length < 5 || players.length > 12}
                  onClick={() => {
                    const socket = getSocket()
                    if (!socket.connected) socket.connect()
                    socket.emit('game:mafia:start')
                    void navigate(`/games/mafia/play?room=${encodeURIComponent(roomCode ?? '')}`)
                  }}
                >
                  {players.length < 5
                    ? 'Need 5+ players'
                    : players.length > 12
                      ? 'Max 12 players'
                      : 'Start match'}
                </Button>
              ) : (
                <p className="text-center text-sm text-muted">
                  Only the room host can start the match.
                </p>
              )
            ) : game?.id === 'liar' ? (
              isHost ? (
                <Button
                  variant="teal"
                  size="lg"
                  className="w-full justify-center"
                  type="button"
                  disabled={players.length < 2 || players.length > 6}
                  onClick={() => {
                    const socket = getSocket()
                    if (!socket.connected) socket.connect()
                    socket.emit('game:liar:start')
                    void navigate(`/games/liar/play?room=${encodeURIComponent(roomCode ?? '')}`)
                  }}
                >
                  {players.length < 2
                    ? 'Need 2+ players'
                    : players.length > 6
                      ? 'Max 6 players'
                      : 'Start match'}
                </Button>
              ) : (
                <p className="text-center text-sm text-muted">
                  Only the room host can start the match.
                </p>
              )
            ) : (
              <Button variant="teal" size="lg" className="w-full justify-center">
                Start match
              </Button>
            )
          )}
        </div>
      </div>
    </div>
  )
}
