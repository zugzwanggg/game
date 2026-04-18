import { ArrowLeft, Crosshair } from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import Avatar from '../../components/ui/Avatar'
import Button from '../../components/ui/Button'
import { RoomPresenceBanner } from '../../components/ui/RoomPresenceBanner'
import { SpectatorBanner } from '../../components/ui/SpectatorBanner'
import { RoomVoiceDock } from '../../components/voice/RoomVoiceDock'
import { useRoomPresenceNotification } from '../../hooks/useRoomPresenceNotification'
import { joinRoom } from '../../lib/roomJoin'
import { removeRecentRoom } from '../../lib/recentRooms'
import { getSocket } from '../../lib/socket'
import {
  playLiarBangSfx,
  playLiarCallSfx,
  playLiarCardPlaySfx,
  playLiarClickSfx,
  playLiarFlipSfx,
  playLiarSpinSfx,
} from '../../lib/synthSfx'

type LiarCard = {
  id: string
  rank: string
  suit: 'S' | 'H' | 'D' | 'C'
}

const LIAR_RANKS = ['A', 'K', 'Q', 'J', '10'] as const

type LiarPublic = {
  matchId: number
  status: 'lobby' | 'playing' | 'finished'
  phase: 'turn' | 'bluff' | 'resolving' | 'between_rounds'
  round: number
  order: string[]
  turnIndex: number
  activePlayerId: string | null
  declarerId: string | null
  handSizes: Record<string, number>
  pileCardCount: number
  lastPlay: {
    playerId: string
    playedCount: number
    claimedRank: string
    claimedCount: number
  } | null
  bluffEndsAt: number | null
  resolving: {
    accuserId: string
    wasLying: boolean
    shooterId: string
    revealedCards: LiarCard[]
    claimedRank: string
    claimedCount: number
    endsAt: number
  } | null
  shotResult: {
    playerId: string
    outcome: 'click' | 'bang'
    endsAt: number
  } | null
  revolvers: Record<
    string,
    {
      pullCount: number
      eliminated: boolean
      immune: boolean
      pullHistory: ('click' | 'bang')[]
    }
  >
  stats: Record<
    string,
    {
      bluffsDeclared: number
      timesCaughtLying: number
      successfulBluffs: number
      wrongAccusations: number
      pullsSurvived: number
    }
  >
  winnerId: string | null
  log: { ts: number; text: string }[]
}

function suitSymbol(s: LiarCard['suit']) {
  switch (s) {
    case 'H':
    case 'D':
      return s === 'H' ? '♥' : '♦'
    default:
      return s === 'S' ? '♠' : '♣'
  }
}

function suitColor(s: LiarCard['suit']) {
  return s === 'H' || s === 'D' ? 'text-rose-400' : 'text-slate-200'
}

function seatAngle(i: number, n: number) {
  if (n <= 0) return 0
  return -90 + (360 / n) * i
}

export default function LiarsRevolverGame() {
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const roomCode = searchParams.get('room')
  const isOnline = Boolean(roomCode)

  const [playerId, setPlayerId] = useState<string | null>(null)
  const [players, setPlayers] = useState<{ id: string; displayName: string; spectator?: boolean }[]>([])
  const [createdByUserId, setCreatedByUserId] = useState<string | null>(null)
  const [liar, setLiar] = useState<LiarPublic | null>(null)
  const [myHand, setMyHand] = useState<LiarCard[]>([])
  const [timers, setTimers] = useState<{ liarBluffSecLeft?: number }>({})
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [claimedRank, setClaimedRank] = useState<string>('A')
  const [claimedCount, setClaimedCount] = useState<1 | 2 | 3>(1)
  const [shake, setShake] = useState(false)
  const [flash, setFlash] = useState<'bang' | 'click' | null>(null)
  const lastShotRef = useRef<string | null>(null)
  const lastResolveKeyRef = useRef<string | null>(null)

  const backTarget = '/games/liar'

  const { payload: presencePayload, handlePlayersSnapshot, dismiss: dismissPresence } =
    useRoomPresenceNotification(isOnline && roomCode ? roomCode : null)

  const nameById = useMemo(() => {
    const m = new Map<string, string>()
    for (const p of players) m.set(p.id, p.displayName)
    return m
  }, [players])

  const alivePlayers = useMemo(() => {
    if (!liar) return players
    return players.filter((p) => !liar.revolvers[p.id]?.eliminated)
  }, [players, liar])

  /** After the match ends, show every seat (winner + eliminated). */
  const tablePlayers = liar?.status === 'finished' ? players : alivePlayers

  const [viewportW, setViewportW] = useState(() =>
    typeof window !== 'undefined' ? window.innerWidth : 1024,
  )
  useEffect(() => {
    const onResize = () => setViewportW(window.innerWidth)
    onResize()
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [])

  const seatRadiusPct = useMemo(() => {
    const n = tablePlayers.length
    let base =
      viewportW >= 1024 ? 44 : viewportW >= 640 ? 42 : viewportW >= 480 ? 36 : 32
    if (n >= 6) base -= 3
    else if (n === 5) base -= 2
    return Math.max(28, Math.min(base, 44))
  }, [tablePlayers.length, viewportW])

  const isHost = Boolean(playerId && createdByUserId && playerId === createdByUserId)

  const isSpectator = Boolean(
    playerId && players.some((p) => p.id === playerId && p.spectator),
  )

  const leaveRoomSocket = () => {
    if (!roomCode) return
    const socket = getSocket()
    if (socket.connected) socket.emit('room:leave')
    removeRecentRoom(roomCode)
  }

  const toggleCard = useCallback((id: string) => {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else {
        if (next.size >= 3) return prev
        next.add(id)
      }
      return next
    })
  }, [])

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
      setLiar(state.liarGame ?? null)
      setTimers({ liarBluffSecLeft: state.timers?.liarBluffSecLeft ?? 0 })
    }

    const onHand = (payload: { cards?: LiarCard[] }) => {
      setMyHand(Array.isArray(payload?.cards) ? payload.cards : [])
    }

    socket.on('room:state', onState)
    socket.on('game:liar:hand', onHand)
    return () => {
      socket.off('room:state', onState)
      socket.off('game:liar:hand', onHand)
    }
  }, [isOnline, roomCode, handlePlayersSnapshot])

  useEffect(() => {
    const r = liar?.resolving
    if (!r) return
    const key = `${r.accuserId}-${r.endsAt}`
    if (lastResolveKeyRef.current === key) return
    lastResolveKeyRef.current = key
    playLiarFlipSfx()
  }, [liar?.resolving])

  useEffect(() => {
    const sr = liar?.shotResult
    if (!sr) return
    const key = `${sr.playerId}-${sr.outcome}-${sr.endsAt}`
    if (lastShotRef.current === key) return
    lastShotRef.current = key
    playLiarSpinSfx()
    window.setTimeout(() => {
      if (sr.outcome === 'bang') {
        playLiarBangSfx()
        setFlash('bang')
        setShake(true)
        window.setTimeout(() => setShake(false), 600)
        window.setTimeout(() => setFlash(null), 900)
      } else {
        playLiarClickSfx()
        setFlash('click')
        window.setTimeout(() => setFlash(null), 500)
      }
    }, 180)
  }, [liar?.shotResult])

  const bluffSec = timers.liarBluffSecLeft ?? 0
  const canPlay =
    !isSpectator &&
    liar?.status === 'playing' &&
    liar.phase === 'turn' &&
    playerId &&
    liar.activePlayerId === playerId

  const canCall =
    !isSpectator &&
    liar?.status === 'playing' &&
    liar.phase === 'bluff' &&
    playerId &&
    liar.lastPlay &&
    liar.lastPlay.playerId !== playerId &&
    bluffSec > 0

  const showMyHand = Boolean(
    !isSpectator &&
      playerId &&
      liar?.status === 'playing' &&
      !liar.revolvers[playerId]?.eliminated,
  )
  const showActionRails = Boolean(
    !isSpectator && playerId && liar?.status === 'playing',
  )

  const playCards = () => {
    if (!canPlay || selected.size < 1) return
    const socket = getSocket()
    playLiarCardPlaySfx()
    socket.emit('game:liar:play', {
      cardIds: [...selected],
      claimedRank,
      claimedCount,
    })
    setSelected(new Set())
  }

  const callLiar = () => {
    if (isSpectator) return
    if (!canCall) return
    const socket = getSocket()
    playLiarCallSfx()
    socket.emit('game:liar:call_liar')
  }

  const n = Math.max(tablePlayers.length, 1)

  const startNewMatch = () => {
    if (!isHost) return
    const socket = getSocket()
    if (!socket.connected) socket.connect()
    socket.emit('game:liar:start')
  }

  return (
    <div
      className={`relative flex h-dvh max-h-dvh min-h-0 flex-1 flex-col overflow-hidden bg-base pb-[env(safe-area-inset-bottom,0px)] pt-[env(safe-area-inset-top,0px)] ${shake ? 'animate-[shake_0.5s_ease-in-out]' : ''}`}
    >
      <style>{`
        @keyframes shake {
          0%, 100% { transform: translateX(0); }
          20% { transform: translateX(-6px); }
          40% { transform: translateX(6px); }
          60% { transform: translateX(-4px); }
          80% { transform: translateX(4px); }
        }
      `}</style>
      {flash === 'bang' && (
        <div className="pointer-events-none fixed inset-0 z-200 bg-red-600/35 mix-blend-screen" />
      )}
      {flash === 'click' && (
        <div className="pointer-events-none fixed inset-0 z-200 bg-amber-400/15" />
      )}

      <RoomPresenceBanner
        message={presencePayload?.text ?? null}
        kind={presencePayload?.kind ?? null}
        onDismiss={dismissPresence}
      />

      {isSpectator ? (
        <div className="shrink-0 px-3 pb-2 sm:px-4">
          <SpectatorBanner />
        </div>
      ) : null}

      <div className="flex shrink-0 flex-col gap-2 border-b border-border px-3 py-2.5 sm:flex-row sm:items-center sm:justify-between sm:gap-3 sm:px-4 sm:py-3">
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          <Link
            to={backTarget}
            className="flex min-h-[44px] min-w-0 items-center gap-2 rounded-lg px-1 text-sm text-muted touch-manipulation [-webkit-tap-highlight-color:transparent] active:bg-white/5 hover:text-text"
            onClick={(e) => {
              if (roomCode) {
                e.preventDefault()
                leaveRoomSocket()
                void navigate(backTarget)
              }
            }}
          >
            <ArrowLeft size={16} /> Games
          </Link>
          {roomCode && (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="min-h-[44px] shrink-0 touch-manipulation px-3"
              onClick={() => {
                leaveRoomSocket()
                void navigate('/games')
              }}
            >
              Quit room
            </Button>
          )}
          {roomCode && (
            <span className="inline-flex items-center rounded-full border border-border bg-white/5 px-2.5 py-0.5 font-mono text-[11px] font-medium text-muted">
              {roomCode}
            </span>
          )}
        </div>
        {liar?.status === 'playing' && (
          <div className="text-[10px] leading-snug text-muted sm:w-auto sm:text-right sm:text-xs">
            Round {liar.round}
          </div>
        )}
      </div>

      {liar?.status === 'finished' && liar.winnerId && (
        <div className="flex shrink-0 flex-col items-stretch gap-3 border-b border-border bg-card/90 px-3 py-3 sm:flex-row sm:items-center sm:justify-between sm:px-4">
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-widest text-muted">Winner</p>
            <p className="text-lg font-extrabold text-text">
              {nameById.get(liar.winnerId) ?? 'Player'}
            </p>
          </div>
          {isHost && (
            <Button
              type="button"
              variant="teal"
              size="md"
              className="min-h-[48px] w-full shrink-0 touch-manipulation sm:min-h-0 sm:w-auto"
              onClick={startNewMatch}
            >
              Start new match
            </Button>
          )}
        </div>
      )}

      <div className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto overscroll-contain p-2 sm:gap-3 sm:p-3 lg:flex-row lg:gap-4 lg:overflow-hidden lg:p-4">
        <section className="relative flex min-h-0 min-w-0 max-w-full flex-1 flex-col overflow-visible rounded-2xl border border-border bg-surface/80 p-2 sm:p-3 lg:min-h-0 lg:overflow-hidden">
          {/* Table row: on phone, Play / Call Liar sit beside the felt. */}
          <div className="mb-1 flex flex-row items-center gap-1 sm:mb-2 sm:gap-2 lg:mb-2 lg:block">
            {showActionRails && (
              <div className="flex w-[3.75rem] shrink-0 flex-col justify-center gap-2 lg:hidden">
                <Button
                  type="button"
                  variant="primary"
                  size="sm"
                  disabled={!canPlay || selected.size < 1 || selected.size > 3}
                  onClick={playCards}
                  className="min-h-[44px] w-full touch-manipulation px-1.5 py-2 text-[11px] leading-tight"
                >
                  <span className="flex flex-col items-center gap-0.5">
                    <span>Play</span>
                    <span className="font-normal opacity-90">
                      {selected.size > 0 ? `${selected.size} card${selected.size === 1 ? '' : 's'}` : 'cards'}
                    </span>
                  </span>
                </Button>
              </div>
            )}
            {/* Square viewport so % left / % top share one scale (circle, not ellipse). */}
            <div className="relative mx-auto mb-0 aspect-square min-w-0 w-full max-h-[min(52vh,520px)] max-w-[640px] flex-1 sm:max-h-[min(46vh,460px)] lg:mb-1 lg:max-h-[min(52vh,520px)] lg:flex-none">
            {/* Table */}
            <div className="absolute inset-[20%] rounded-full border-2 border-border/80 bg-base/90 shadow-[inset_0_0_40px_rgba(0,0,0,0.35)] sm:inset-[18%]" />

            {tablePlayers.map((p, i) => {
              const ang = seatAngle(i, n)
              const rad = (ang * Math.PI) / 180
              const r = seatRadiusPct
              const x = 50 + r * Math.cos(rad)
              const y = 50 + r * Math.sin(rad)
              const rev = liar?.revolvers[p.id]
              const isMe = p.id === playerId
              const isTurn = liar?.activePlayerId === p.id
              const isDecl = liar?.declarerId === p.id && liar?.phase === 'bluff'

              return (
                <div
                  key={p.id}
                  className="absolute z-10 flex w-[min(5.25rem,24vw)] max-w-[96px] -translate-x-1/2 -translate-y-1/2 flex-col items-center gap-0.5 sm:w-[130px] sm:max-w-[34vw] sm:gap-1"
                  style={{ left: `${x}%`, top: `${y}%` }}
                >
                  <div
                    className={`flex w-full flex-col items-center rounded-lg border px-1.5 py-1.5 text-center sm:rounded-xl sm:px-2 sm:py-2 ${
                      rev?.eliminated
                        ? 'border-border/40 bg-black/40 opacity-50'
                        : isTurn || isDecl
                          ? 'border-accent/60 bg-accent/10'
                          : 'border-border bg-card'
                    }`}
                  >
                    <div className="flex items-center gap-0.5 sm:gap-1">
                      <Avatar name={p.displayName} size="sm" />
                      <span className="max-w-[4.5rem] truncate text-[10px] font-semibold leading-tight text-text sm:max-w-[7rem] sm:text-xs">
                        {p.displayName}
                        {isMe ? ' (you)' : ''}
                      </span>
                    </div>
                    <div className="mt-0.5 flex items-center gap-0.5 text-[9px] text-muted sm:mt-1 sm:gap-1 sm:text-[10px]">
                      <Crosshair size={11} className="shrink-0 sm:h-3 sm:w-3" />
                      {rev?.eliminated ? (
                        <span className="text-rose-400">Out</span>
                      ) : (
                        <span>
                          {rev?.pullCount ?? 0} / 6 pulls
                          {rev?.immune ? ' · immune' : ''}
                        </span>
                      )}
                    </div>
                    <div className="mt-0.5 flex justify-center gap-px sm:mt-1 sm:gap-0.5">
                      {Array.from({ length: 6 }).map((_, ci) => {
                        const tail = rev?.pullHistory.slice(-6) ?? []
                        const h = tail[ci]
                        return (
                          <span
                            key={ci}
                            className={`h-1.5 w-1.5 rounded-full sm:h-2 sm:w-2 ${
                              h === 'bang'
                                ? 'bg-red-500'
                                : h === 'click'
                                  ? 'bg-amber-400'
                                  : 'bg-zinc-700'
                            }`}
                            title={h ?? 'empty'}
                          />
                        )
                      })}
                    </div>
                  </div>
                </div>
              )
            })}

            {/* Center pile */}
            <div className="absolute left-1/2 top-1/2 z-20 flex max-w-[calc(100%-0.5rem)] -translate-x-1/2 -translate-y-1/2 flex-col items-center gap-1.5 px-1 sm:gap-2">
              <div className="relative flex h-20 w-[4.5rem] items-center justify-center rounded-lg border border-border bg-card shadow-lg sm:h-24 sm:w-20">
                <div className="absolute inset-0 rounded-lg bg-gradient-to-br from-accent/25 to-fuchsia-500/10" />
                <span className="relative text-2xl font-black text-text/90 sm:text-3xl">
                  {liar?.pileCardCount ?? 0}
                </span>
                <span className="absolute bottom-1 text-[10px] font-semibold uppercase tracking-wider text-muted">
                  pile
                </span>
              </div>

              {/* Mobile/desktop: show ONE status panel at a time so text never overlaps. */}
              {liar?.resolving ? (
                <div className="max-w-[min(240px,calc(100vw-2.5rem))] rounded-xl border border-sky-500/40 bg-sky-500/10 px-2 py-2 text-center text-[11px] leading-snug text-sky-50 sm:max-w-[min(320px,90vw)] sm:px-3 sm:text-xs">
                  <p className="mb-1 text-[10px] text-sky-200/90">
                    Claimed {liar.resolving.claimedCount} × {liar.resolving.claimedRank}
                  </p>
                  <p className="mb-2 font-semibold">
                    {liar.resolving.wasLying ? 'Caught lying!' : 'Wrong accusation!'}
                  </p>
                  <div className="flex flex-wrap justify-center gap-1">
                    {liar.resolving.revealedCards.map((c) => (
                      <span
                        key={c.id}
                        className={`rounded border border-border bg-base px-2 py-1 font-mono text-sm font-bold ${suitColor(c.suit)}`}
                      >
                        {c.rank}
                        {suitSymbol(c.suit)}
                      </span>
                    ))}
                  </div>
                </div>
              ) : liar?.phase === 'bluff' && liar.lastPlay ? (
                <div className="max-w-[min(260px,calc(100vw-2.5rem))] rounded-lg border border-amber-500/40 bg-amber-500/10 px-2 py-1.5 text-center text-[11px] leading-snug text-amber-50 sm:max-w-[min(360px,90vw)] sm:px-3 sm:py-2 sm:text-xs">
                  <p className="font-semibold">
                    {nameById.get(liar.lastPlay.playerId) ?? 'Player'} claims{' '}
                    <span className="text-amber-200">
                      {liar.lastPlay.claimedCount} × {liar.lastPlay.claimedRank}
                    </span>
                  </p>
                  <p className="mt-1 text-[10px] text-amber-100/90">
                    Bluff window: {bluffSec}s · played {liar.lastPlay.playedCount} card
                    {liar.lastPlay.playedCount === 1 ? '' : 's'} face down
                  </p>
                </div>
              ) : liar?.shotResult ? (
                <div
                  className={`rounded-lg px-3 py-2 text-center text-sm font-bold ${
                    liar.shotResult.outcome === 'bang'
                      ? 'bg-red-600/30 text-red-100'
                      : 'bg-zinc-800/80 text-teal-200'
                  }`}
                >
                  {liar.shotResult.outcome === 'bang' ? 'BANG' : 'CLICK'} ·{' '}
                  {nameById.get(liar.shotResult.playerId) ?? 'Player'}
                </div>
              ) : null}
            </div>
          </div>
            {showActionRails && (
              <div className="flex w-[3.75rem] shrink-0 flex-col justify-center gap-2 lg:hidden">
                <Button
                  type="button"
                  variant="teal"
                  size="sm"
                  disabled={!canCall}
                  onClick={callLiar}
                  className="min-h-[44px] w-full touch-manipulation px-1.5 py-2 text-[11px] leading-tight"
                >
                  <span className="flex flex-col items-center gap-0.5">
                    <span>Call</span>
                    <span>Liar!</span>
                  </span>
                </Button>
              </div>
            )}
          </div>

          {/* Desktop minimal action row (keeps PC buttons visible even if the hand panel is scrolled away). */}
          {showActionRails && (
            <div className="mt-2 hidden items-center justify-center gap-2 lg:flex">
              <Button
                type="button"
                variant="primary"
                size="md"
                disabled={!canPlay || selected.size < 1 || selected.size > 3}
                onClick={playCards}
              >
                Play
              </Button>
              <Button type="button" variant="teal" size="md" disabled={!canCall} onClick={callLiar}>
                Call Liar!
              </Button>
            </div>
          )}

          {/* My hand */}
          {showMyHand && (
            <div className="mt-2 shrink-0 border-t border-border pt-3 sm:mt-auto">
              {/* Minimal: no instruction text */}
              <div className="mb-3 flex flex-col items-stretch gap-3 sm:flex-row sm:items-center sm:justify-center sm:gap-4">
                <div className="flex flex-col gap-1">
                  <span className="sr-only">Claim rank</span>
                  <div className="flex flex-wrap justify-center gap-1.5 sm:gap-1">
                    {LIAR_RANKS.map((r) => (
                      <button
                        key={r}
                        type="button"
                        disabled={!canPlay}
                        onClick={() => canPlay && setClaimedRank(r)}
                        className={`min-h-[44px] min-w-[40px] touch-manipulation rounded-lg border px-2.5 py-2 text-sm font-bold transition-colors [-webkit-tap-highlight-color:transparent] active:scale-[0.98] sm:min-h-0 sm:min-w-0 sm:py-1.5 ${
                          claimedRank === r
                            ? 'border-accent bg-accent/25 text-text'
                            : 'border-border bg-card text-muted hover:border-accent/40'
                        } ${!canPlay ? 'opacity-50' : ''}`}
                      >
                        {r}
                      </button>
                    ))}
                  </div>
                </div>
                <div className="flex flex-col gap-1">
                  <span className="sr-only">Claim count</span>
                  <div className="flex justify-center gap-2 sm:gap-1">
                    {([1, 2, 3] as const).map((c) => (
                      <button
                        key={c}
                        type="button"
                        disabled={!canPlay}
                        onClick={() => canPlay && setClaimedCount(c)}
                        className={`min-h-[44px] min-w-[48px] touch-manipulation rounded-lg border px-3 py-2 text-sm font-bold transition-colors [-webkit-tap-highlight-color:transparent] active:scale-[0.98] sm:min-h-0 sm:min-w-0 sm:py-1.5 ${
                          claimedCount === c
                            ? 'border-accent bg-accent/25 text-text'
                            : 'border-border bg-card text-muted hover:border-accent/40'
                        } ${!canPlay ? 'opacity-50' : ''}`}
                      >
                        {c}
                      </button>
                    ))}
                  </div>
                </div>
              </div>
              <div className="flex flex-wrap justify-center gap-2 pb-1">
                {myHand.map((c) => {
                  const on = selected.has(c.id)
                  return (
                    <button
                      key={c.id}
                      type="button"
                      disabled={!canPlay}
                      onClick={() => canPlay && toggleCard(c.id)}
                      className={`relative min-h-[52px] min-w-[48px] touch-manipulation rounded-lg border px-3 py-3 font-mono text-lg font-bold transition-all [-webkit-tap-highlight-color:transparent] active:scale-[0.97] select-none sm:min-h-0 sm:min-w-0 ${
                        on
                          ? 'border-accent bg-accent/20 ring-2 ring-accent/50'
                          : 'border-border bg-card hover:border-accent/40'
                      } ${!canPlay ? 'cursor-not-allowed opacity-60' : ''} ${suitColor(c.suit)}`}
                    >
                      <span className="block text-2xl leading-none">{c.rank}</span>
                      <span className="text-sm">{suitSymbol(c.suit)}</span>
                    </button>
                  )
                })}
              </div>

              {/* Desktop buttons should always be visible when you have a hand. */}
              <div className="mt-3 hidden w-full flex-col gap-2 lg:flex lg:flex-row lg:flex-wrap lg:items-center lg:justify-center">
                <Button
                  type="button"
                  variant="primary"
                  size="md"
                  disabled={!canPlay || selected.size < 1 || selected.size > 3}
                  onClick={playCards}
                  className="min-h-[48px] w-full touch-manipulation sm:min-h-0 sm:w-auto sm:min-w-[8rem]"
                >
                  Play {selected.size > 0 ? `${selected.size} ` : ''}card
                  {selected.size === 1 ? '' : 's'}
                </Button>
                <Button
                  type="button"
                  variant="teal"
                  size="md"
                  disabled={!canCall}
                  onClick={callLiar}
                  className="min-h-[48px] w-full touch-manipulation sm:min-h-0 sm:w-auto sm:min-w-[8rem]"
                >
                  Call Liar!
                </Button>
              </div>
            </div>
          )}
        </section>

        <aside className="hidden max-h-[min(32vh,220px)] min-h-0 w-full shrink-0 flex-col overflow-hidden rounded-2xl border border-border bg-card sm:max-h-[40vh] lg:flex lg:max-h-none lg:w-[300px]">
          <div className="border-b border-border px-3 py-2 text-sm font-semibold text-text">Log</div>
          <div className="min-h-0 flex-1 space-y-1 overflow-y-auto overflow-x-hidden px-3 py-2 text-xs text-muted [-webkit-overflow-scrolling:touch]">
            {(liar?.log ?? []).map((e, i) => (
              <p key={`${e.ts}-${i}`} className="leading-snug">
                {e.text}
              </p>
            ))}
            {(!liar?.log || liar.log.length === 0) && (
              <p className="text-[11px] text-muted/80">Events appear here as you play.</p>
            )}
          </div>
        </aside>
      </div>

      {roomCode && (
        <div className="shrink-0 border-t border-border px-2 py-2 sm:px-3">
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
