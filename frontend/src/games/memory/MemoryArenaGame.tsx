import { ArrowLeft } from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link, Navigate, useSearchParams } from 'react-router-dom'
import Avatar from '../../components/ui/Avatar'
import Button from '../../components/ui/Button'
import { RoomPresenceBanner } from '../../components/ui/RoomPresenceBanner'
import { SpectatorBanner } from '../../components/ui/SpectatorBanner'
import { RoomVoiceDock } from '../../components/voice/RoomVoiceDock'
import { useRoomPresenceNotification } from '../../hooks/useRoomPresenceNotification'
import { joinRoom } from '../../lib/roomJoin'
import { removeRecentRoom } from '../../lib/recentRooms'
import { getSocket } from '../../lib/socket'
import { playMemoryErrorSfx, playMemoryTileSfx, playMemoryWinSfx } from '../../lib/synthSfx'

const TILE_COUNT = 9

/** Per-tile palette: idle, playback glow, hover (input), click pulse. */
const TILE_STYLES: readonly {
  idle: string
  glow: string
  hover: string
  tap: string
}[] = [
  {
    idle: 'border-red-600/50 bg-red-950/35',
    glow: 'border-red-500 bg-red-600/50 shadow-[0_0_26px_rgba(220,38,38,0.5)]',
    hover: 'hover:border-red-500/90 hover:bg-red-900/45 hover:shadow-[0_0_18px_rgba(220,38,38,0.35)]',
    tap: 'ring-2 ring-red-400/90 ring-offset-2 ring-offset-base scale-[0.97]',
  },
  {
    idle: 'border-orange-500/45 bg-orange-950/35',
    glow: 'border-orange-400 bg-orange-500/50 shadow-[0_0_26px_rgba(251,146,60,0.55)]',
    hover: 'hover:border-orange-400/80 hover:bg-orange-900/45 hover:shadow-[0_0_18px_rgba(251,146,60,0.35)]',
    tap: 'ring-2 ring-orange-300/95 ring-offset-2 ring-offset-base scale-[0.97]',
  },
  {
    idle: 'border-amber-500/45 bg-amber-950/35',
    glow: 'border-amber-400 bg-amber-500/50 shadow-[0_0_26px_rgba(245,158,11,0.55)]',
    hover: 'hover:border-amber-400/80 hover:bg-amber-900/45 hover:shadow-[0_0_18px_rgba(245,158,11,0.35)]',
    tap: 'ring-2 ring-amber-200/95 ring-offset-2 ring-offset-base scale-[0.97]',
  },
  {
    idle: 'border-lime-500/45 bg-lime-950/30',
    glow: 'border-lime-400 bg-lime-500/45 shadow-[0_0_26px_rgba(163,230,53,0.5)]',
    hover: 'hover:border-lime-400/80 hover:bg-lime-900/40 hover:shadow-[0_0_18px_rgba(163,230,53,0.35)]',
    tap: 'ring-2 ring-lime-200/95 ring-offset-2 ring-offset-base scale-[0.97]',
  },
  {
    idle: 'border-emerald-500/45 bg-emerald-950/35',
    glow: 'border-emerald-400 bg-emerald-500/50 shadow-[0_0_26px_rgba(52,211,153,0.55)]',
    hover: 'hover:border-emerald-400/80 hover:bg-emerald-900/45 hover:shadow-[0_0_18px_rgba(52,211,153,0.35)]',
    tap: 'ring-2 ring-emerald-300/95 ring-offset-2 ring-offset-base scale-[0.97]',
  },
  {
    idle: 'border-cyan-500/45 bg-cyan-950/30',
    glow: 'border-cyan-400 bg-cyan-500/50 shadow-[0_0_26px_rgba(34,211,238,0.55)]',
    hover: 'hover:border-cyan-400/80 hover:bg-cyan-900/40 hover:shadow-[0_0_18px_rgba(34,211,238,0.35)]',
    tap: 'ring-2 ring-cyan-200/95 ring-offset-2 ring-offset-base scale-[0.97]',
  },
  {
    idle: 'border-sky-500/45 bg-sky-950/35',
    glow: 'border-sky-400 bg-sky-500/50 shadow-[0_0_26px_rgba(56,189,248,0.55)]',
    hover: 'hover:border-sky-400/80 hover:bg-sky-900/45 hover:shadow-[0_0_18px_rgba(56,189,248,0.35)]',
    tap: 'ring-2 ring-sky-300/95 ring-offset-2 ring-offset-base scale-[0.97]',
  },
  {
    idle: 'border-violet-500/45 bg-violet-950/35',
    glow: 'border-violet-400 bg-violet-500/50 shadow-[0_0_26px_rgba(167,139,250,0.55)]',
    hover: 'hover:border-violet-400/80 hover:bg-violet-900/45 hover:shadow-[0_0_18px_rgba(167,139,250,0.35)]',
    tap: 'ring-2 ring-violet-300/95 ring-offset-2 ring-offset-base scale-[0.97]',
  },
  {
    idle: 'border-indigo-500/45 bg-indigo-950/35',
    glow: 'border-indigo-400 bg-indigo-600/45 shadow-[0_0_26px_rgba(99,102,241,0.5)]',
    hover: 'hover:border-indigo-400/80 hover:bg-indigo-900/45 hover:shadow-[0_0_18px_rgba(99,102,241,0.35)]',
    tap: 'ring-2 ring-indigo-300/95 ring-offset-2 ring-offset-base scale-[0.97]',
  },
]

type MemoryPublic = {
  matchId: number
  status: 'lobby' | 'countdown' | 'playback' | 'input' | 'winner'
  countdownReason: 'match_start' | 'next_round' | null
  round: number
  sequenceLength: number
  alive: Record<string, boolean>
  highlightTile: number | null
  phaseEndsAt: number | null
  inputEndsAt: number | null
  inputProgress: Record<string, number>
  winnerId: string | null
  lastEliminatedPlayerId: string | null
}

export default function MemoryArenaGame() {
  const [searchParams] = useSearchParams()
  const roomCode = searchParams.get('room')
  const isOnline = Boolean(roomCode)

  const [playerId, setPlayerId] = useState<string | null>(null)
  const [players, setPlayers] = useState<{ id: string; displayName: string; spectator?: boolean }[]>([])
  const [createdByUserId, setCreatedByUserId] = useState<string | null>(null)
  const [memory, setMemory] = useState<MemoryPublic | null>(null)
  const [timers, setTimers] = useState<{
    memoryPlaybackSecLeft?: number
    memoryInputSecLeft?: number
    memoryCountdownSecLeft?: number
  }>({})
  const [countdownSecShown, setCountdownSecShown] = useState(0)
  const [pressedTile, setPressedTile] = useState<number | null>(null)
  const pressClearRef = useRef<ReturnType<typeof window.setTimeout> | null>(null)

  const lastPlaybackSoundKeyRef = useRef<string | null>(null)
  const lastElimKeyRef = useRef<string | null>(null)
  const lastWinKeyRef = useRef<string | null>(null)

  const backTarget = '/games/memory'

  const { payload: presencePayload, handlePlayersSnapshot, dismiss: dismissPresence } =
    useRoomPresenceNotification(isOnline && roomCode ? roomCode : null)

  const nameById = useMemo(() => {
    const m = new Map<string, string>()
    for (const p of players) m.set(p.id, p.displayName)
    return m
  }, [players])

  const isHost = Boolean(playerId && createdByUserId && playerId === createdByUserId)

  const isSpectator = Boolean(
    playerId && players.some((p) => p.id === playerId && p.spectator),
  )

  const aliveSelf = Boolean(
    playerId && memory?.alive[playerId] && !isSpectator,
  )

  const myProgress = playerId && memory?.inputProgress ? memory.inputProgress[playerId] ?? 0 : 0

  const leaveRoomSocket = () => {
    if (!roomCode) return
    const socket = getSocket()
    if (socket.connected) socket.emit('room:leave')
    removeRecentRoom(roomCode)
  }

  useEffect(() => {
    if (!isOnline || !roomCode) return
    const socket = getSocket()
    if (!socket.connected) socket.connect()

    void joinRoom(roomCode).then(({ player }) => {
      if (player?.id) setPlayerId(String(player.id))
    })

    const onState = (state: any) => {
      if (String(state?.code ?? '').toUpperCase() !== roomCode.toUpperCase()) return
      if (Array.isArray(state?.players)) {
        const next = (state.players as any[]).map((p) => ({
          id: String(p.id),
          displayName: String(p.displayName ?? 'Player'),
          spectator: Boolean(p.spectator),
        }))
        setPlayers(next)
        handlePlayersSnapshot(next.map(({ id, displayName }) => ({ id, displayName })))
      }
      if (typeof state.createdByUserId === 'string') setCreatedByUserId(state.createdByUserId)
      setMemory(state.memoryGame ?? null)
      setTimers({
        memoryPlaybackSecLeft: state.timers?.memoryPlaybackSecLeft ?? 0,
        memoryInputSecLeft: state.timers?.memoryInputSecLeft ?? 0,
        memoryCountdownSecLeft: state.timers?.memoryCountdownSecLeft ?? 0,
      })
    }

    socket.on('room:state', onState)
    return () => {
      socket.off('room:state', onState)
    }
  }, [isOnline, roomCode, handlePlayersSnapshot])

  useEffect(() => {
    return () => {
      if (pressClearRef.current) window.clearTimeout(pressClearRef.current)
    }
  }, [])

  /** Smooth countdown display from server end timestamp (5s / 2s). */
  useEffect(() => {
    if (memory?.status !== 'countdown' || memory.phaseEndsAt == null) {
      setCountdownSecShown(0)
      return
    }
    const end = memory.phaseEndsAt
    const tick = () => {
      const ms = Math.max(0, end - Date.now())
      setCountdownSecShown(Math.ceil(ms / 1000))
    }
    tick()
    const id = window.setInterval(tick, 100)
    return () => window.clearInterval(id)
  }, [memory?.status, memory?.phaseEndsAt, memory?.matchId])

  /** Playback: each highlight pulse → tone (deduped by server phase end time). */
  useEffect(() => {
    if (!memory || memory.status !== 'playback') {
      lastPlaybackSoundKeyRef.current = null
      return
    }
    const h = memory.highlightTile
    if (h == null || h < 0 || h >= TILE_COUNT || memory.phaseEndsAt == null) return
    const key = `${memory.matchId}-${memory.phaseEndsAt}-${h}`
    if (lastPlaybackSoundKeyRef.current === key) return
    lastPlaybackSoundKeyRef.current = key
    playMemoryTileSfx(h)
  }, [memory?.status, memory?.highlightTile, memory?.phaseEndsAt, memory?.matchId])

  /** Wrong tap / timeout elimination. */
  useEffect(() => {
    const id = memory?.lastEliminatedPlayerId
    if (!id || !memory) return
    const key = `${memory.matchId}-${memory.round}-${id}-${memory.status}`
    if (lastElimKeyRef.current === key) return
    lastElimKeyRef.current = key
    if (id === playerId) playMemoryErrorSfx()
  }, [memory?.lastEliminatedPlayerId, memory?.matchId, memory?.round, memory?.status, playerId])

  /** Winner. */
  useEffect(() => {
    const w = memory?.winnerId
    if (!w || !memory) return
    const key = `${memory.matchId}-${w}`
    if (lastWinKeyRef.current === key) return
    lastWinKeyRef.current = key
    playMemoryWinSfx()
  }, [memory?.winnerId, memory?.matchId])

  const tapTile = useCallback(
    (tileIndex: number) => {
      if (!roomCode || isSpectator || !aliveSelf || memory?.status !== 'input') return
      if (pressClearRef.current) window.clearTimeout(pressClearRef.current)
      setPressedTile(tileIndex)
      pressClearRef.current = window.setTimeout(() => {
        setPressedTile(null)
        pressClearRef.current = null
      }, 105)
      const socket = getSocket()
      if (!socket.connected) socket.connect()
      playMemoryTileSfx(tileIndex)
      socket.emit('game:memory:tap', { tileIndex })
    },
    [roomCode, isSpectator, aliveSelf, memory?.status],
  )

  const startNewMatch = () => {
    if (!isHost || !roomCode) return
    const socket = getSocket()
    if (!socket.connected) socket.connect()
    socket.emit('game:memory:start')
  }

  const phaseLabel = useMemo(() => {
    if (!memory || memory.status === 'lobby') return 'Lobby'
    if (memory.status === 'countdown') {
      return memory.countdownReason === 'next_round' ? 'Next round' : 'Get ready'
    }
    if (memory.status === 'playback') return 'Watch the sequence'
    if (memory.status === 'input') return 'Repeat the sequence'
    if (memory.status === 'winner') return 'Winner'
    return ''
  }, [memory])

  const countdownTitle = useMemo(() => {
    if (!memory || memory.status !== 'countdown') return ''
    return memory.countdownReason === 'next_round' ? 'Next sequence in' : 'Match starts in'
  }, [memory])

  const aliveCount = useMemo(() => {
    if (!memory?.alive) return 0
    return Object.values(memory.alive).filter(Boolean).length
  }, [memory?.alive])

  if (!roomCode) {
    return <Navigate to="/games/memory" replace />
  }

  return (
    <div className="relative flex h-dvh max-h-dvh min-h-0 flex-1 flex-col overflow-hidden bg-base pb-[env(safe-area-inset-bottom,0px)] pt-[env(safe-area-inset-top,0px)]">
      <RoomPresenceBanner
        message={presencePayload?.text ?? null}
        kind={presencePayload?.kind ?? null}
        onDismiss={dismissPresence}
      />

      <header className="flex shrink-0 items-center justify-between gap-3 border-b border-border px-3 py-2 sm:px-4">
        <div className="flex min-w-0 items-center gap-2">
          <Link
            to={backTarget}
            onClick={leaveRoomSocket}
            className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-muted transition-colors hover:bg-white/5 hover:text-text"
            aria-label="Back"
          >
            <ArrowLeft size={18} />
          </Link>
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold text-text">Memory Arena</p>
            {roomCode && (
              <p className="truncate font-mono text-[11px] text-muted">{roomCode}</p>
            )}
          </div>
        </div>
        {memory && memory.status !== 'lobby' && (
          <div className="flex items-center gap-2 text-xs text-muted">
            <span className="hidden sm:inline">Round {memory.round}</span>
            <span className="rounded-md bg-white/5 px-2 py-1 font-mono text-[11px] text-text">
              {aliveCount} alive
            </span>
          </div>
        )}
      </header>

      {isSpectator && <SpectatorBanner />}

      <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-6 px-4 py-6">
        {!memory || memory.status === 'lobby' ? (
          <div className="flex max-w-md flex-col items-center gap-4 text-center">
            <p className="text-lg font-semibold text-text">Memory Arena</p>
            <p className="text-sm text-muted">
              See the pattern, then repeat it. Wrong tile or out of time: you lose. Last player wins.
            </p>
            {isHost ? (
              <Button
                variant="teal"
                size="lg"
                type="button"
                disabled={players.length < 2}
                onClick={startNewMatch}
              >
                {players.length < 2 ? 'Need 2+ players' : 'Start match'}
              </Button>
            ) : (
              <p className="text-sm text-muted">Waiting for host.</p>
            )}
          </div>
        ) : memory.status === 'winner' ? (
          <div className="flex w-full min-h-0 flex-1 flex-col items-center justify-center gap-8">
            <div className="text-center">
              <p className="text-xs font-semibold uppercase tracking-wider text-muted">{phaseLabel}</p>
              {memory.winnerId && (
                <p className="mt-3 text-2xl font-bold text-teal sm:text-3xl">
                  {nameById.get(memory.winnerId) ?? 'Winner'} wins!
                </p>
              )}
            </div>
            {isHost && (
              <Button variant="teal" size="lg" type="button" className="min-w-[12rem]" onClick={startNewMatch}>
                Play again
              </Button>
            )}
            <div className="w-full max-w-md space-y-2">
              <p className="text-center text-[11px] font-semibold uppercase tracking-wider text-muted">Players</p>
              <div className="flex flex-wrap justify-center gap-2">
                {players.map((p) => (
                  <div
                    key={p.id}
                    className={`flex items-center gap-2 rounded-full border px-2 py-1 pr-3 text-xs ${
                      p.id === memory.winnerId
                        ? 'border-teal/60 bg-teal/15'
                        : p.id === playerId
                          ? 'border-teal/50 bg-teal/10'
                          : 'border-border bg-white/[0.03]'
                    }`}
                  >
                    <Avatar name={p.displayName} size="sm" />
                    <span className="max-w-[120px] truncate">{p.displayName}</span>
                    {p.id === memory.winnerId && (
                      <span className="text-[10px] font-semibold text-teal">winner</span>
                    )}
                  </div>
                ))}
              </div>
            </div>
          </div>
        ) : (
          <>
            <div className="text-center">
              <p className="text-xs font-semibold uppercase tracking-wider text-muted">{phaseLabel}</p>
              {memory.status === 'playback' && (
                <p className="mt-1 font-mono text-sm text-teal">{timers.memoryPlaybackSecLeft ?? 0}s</p>
              )}
              {memory.status === 'input' && (
                <p className="mt-1 font-mono text-sm text-amber-300">
                  {timers.memoryInputSecLeft ?? 0}s
                  {aliveSelf && (
                    <span className="ml-2 text-muted">
                      · {myProgress}/{memory.sequenceLength}
                    </span>
                  )}
                </p>
              )}
            </div>

            <div className="relative w-full max-w-sm sm:max-w-md">
              <div
                className={[
                  'grid w-full grid-cols-3 gap-3 sm:gap-4',
                  memory.status === 'countdown' ? 'pointer-events-none opacity-35' : '',
                ].join(' ')}
                style={{ aspectRatio: '1' }}
              >
                {Array.from({ length: TILE_COUNT }, (_, i) => {
                  const style = TILE_STYLES[i]!
                  const lit =
                    memory.status === 'playback' &&
                    memory.highlightTile !== null &&
                    memory.highlightTile === i
                  const canTap =
                    memory.status === 'input' && aliveSelf && !isSpectator
                  const clicked = pressedTile === i
                  return (
                    <button
                      key={i}
                      type="button"
                      disabled={!canTap}
                      onClick={() => tapTile(i)}
                      className={[
                        'relative rounded-2xl border-2 transition-[transform,box-shadow] duration-100',
                        lit ? `scale-[1.03] ${style.glow}` : style.idle,
                        canTap && !lit ? `cursor-pointer ${style.hover}` : '',
                        clicked ? style.tap : '',
                        !canTap && memory.status === 'input' ? 'opacity-60' : '',
                      ].join(' ')}
                      aria-label={`Tile ${i + 1}`}
                    />
                  )
                })}
              </div>
              {memory.status === 'countdown' && (
                <div
                  className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center rounded-3xl bg-base/60 backdrop-blur-sm"
                  aria-live="polite"
                >
                  <p className="mb-3 max-w-[16rem] text-center text-sm font-semibold text-sky-200/95">
                    {countdownTitle}
                  </p>
                  <span className="font-mono text-7xl font-bold tabular-nums text-sky-100 drop-shadow-[0_0_24px_rgba(56,189,248,0.45)] sm:text-8xl">
                    {Math.max(0, countdownSecShown || timers.memoryCountdownSecLeft || 0)}
                  </span>
                  <p className="mt-2 text-xs font-medium uppercase tracking-widest text-muted">seconds</p>
                </div>
              )}
            </div>

            <div className="w-full max-w-md space-y-2">
              <p className="text-center text-[11px] font-semibold uppercase tracking-wider text-muted">Players</p>
              <div className="flex flex-wrap justify-center gap-2">
                {players
                  .filter((p) => !p.spectator)
                  .map((p) => {
                    const alive = memory.alive[p.id]
                    const done =
                      memory.status === 'input' &&
                      alive &&
                      (memory.inputProgress[p.id] ?? 0) >= memory.sequenceLength
                    return (
                      <div
                        key={p.id}
                        className={`flex items-center gap-2 rounded-full border px-2 py-1 pr-3 text-xs ${
                          p.id === playerId ? 'border-teal/50 bg-teal/10' : 'border-border bg-white/[0.03]'
                        } ${alive ? '' : 'opacity-40 line-through'}`}
                      >
                        <Avatar name={p.displayName} size="sm" />
                        <span className="max-w-[120px] truncate">{p.displayName}</span>
                        {memory.status === 'input' && alive && (
                          <span className="font-mono text-[10px] text-muted">
                            {done ? '✓' : `${memory.inputProgress[p.id] ?? 0}/${memory.sequenceLength}`}
                          </span>
                        )}
                      </div>
                    )
                  })}
              </div>
            </div>

          </>
        )}
      </div>

      {roomCode && (
        <div className="shrink-0 border-t border-border px-2 pb-2 pt-1">
          <RoomVoiceDock
            roomCode={roomCode}
            myPlayerId={playerId}
            players={players.map((p) => ({ id: p.id, displayName: p.displayName }))}
          />
        </div>
      )}
    </div>
  )
}
