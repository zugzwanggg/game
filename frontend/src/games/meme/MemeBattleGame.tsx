import { ArrowLeft, Check, Crown, Search, ThumbsUp } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { RoomPresenceBanner } from '../../components/ui/RoomPresenceBanner'
import { useRoomPresenceNotification } from '../../hooks/useRoomPresenceNotification'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import Avatar from '../../components/ui/Avatar'
import Badge from '../../components/ui/Badge'
import Button from '../../components/ui/Button'
import { RoomVoiceDock } from '../../components/voice/RoomVoiceDock'
import { removeRecentRoom } from '../../lib/recentRooms'
import { joinRoom } from '../../lib/roomJoin'
import { playMemeSubmitSfx, playMemeVoteSfx } from '../../lib/synthSfx'
import { getSocket } from '../../lib/socket'
import { searchGifs, trendingGifs, type KlipyGif } from './klipy'

type MemeGameWire = {
  matchId: number
  status: string
  round: number
  maxRounds: number
  seed: string
  prompts: [string, string]
  contextVotes: Record<string, 0 | 1>
  winningPromptIndex: 0 | 1 | null
  submissions: Record<string, { promptIndex: 0 | 1; gif: KlipyGif }>
  gifVotes: Record<string, string>
  scores: Record<string, number>
}

type TimersWire = {
  memePhaseSecLeft?: number
  memeRevealSecLeft?: number
  memeLeaderboardSecLeft?: number
  memeRoundBreakSecLeft?: number
}

function formatClock(sec: number) {
  const s = Math.max(0, Math.floor(sec))
  const m = Math.floor(s / 60)
  const r = s % 60
  return `${m}:${r.toString().padStart(2, '0')}`
}

export default function MemeBattleGame() {
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const roomCode = searchParams.get('room')
  const isOnline = Boolean(roomCode)

  const [playerId, setPlayerId] = useState<string | null>(null)
  const [players, setPlayers] = useState<{ id: string; displayName: string }[]>([])
  const [createdByUserId, setCreatedByUserId] = useState<string | null>(null)
  const [meme, setMeme] = useState<MemeGameWire | null>(null)
  const [timers, setTimers] = useState<TimersWire>({})

  const isHost =
    Boolean(playerId && createdByUserId && playerId === createdByUserId)

  const [gifQuery, setGifQuery] = useState('')
  const [gifLoading, setGifLoading] = useState(false)
  const [gifError, setGifError] = useState<string | null>(null)
  const [gifResults, setGifResults] = useState<KlipyGif[]>([])
  const [pickedGif, setPickedGif] = useState<KlipyGif | null>(null)
  const [revealIndex, setRevealIndex] = useState(0)
  const [autoReveal, setAutoReveal] = useState(true)

  const minPlayersMet = players.length >= 2
  /** Leave the match lobby entirely — do not open `/room/...` or we re-join and bounce back into play. */
  const backTarget = '/games/meme'

  const { payload: presencePayload, handlePlayersSnapshot, dismiss: dismissPresence } =
    useRoomPresenceNotification(isOnline && roomCode ? roomCode : null)

  const status = meme?.status ?? 'lobby'
  const maxRounds = meme?.maxRounds ?? 3

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
        }))
        setPlayers(next)
        handlePlayersSnapshot(next)
      }
      if (typeof state?.createdByUserId === 'string') setCreatedByUserId(state.createdByUserId)
      setMeme(state.memeGame ?? null)
      setTimers((state.timers ?? {}) as TimersWire)
    }

    socket.on('room:state', onState)
    return () => {
      socket.off('room:state', onState)
    }
  }, [isOnline, roomCode])

  useEffect(() => {
    if (status !== 'gif_pick') return
    if (gifResults.length) return
    void loadTrending()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status])

  const contextVoteCount = useMemo(() => {
    let c0 = 0
    let c1 = 0
    if (!meme) return { c0, c1 }
    for (const p of players) {
      const v = meme.contextVotes[p.id]
      if (v === 0) c0++
      else if (v === 1) c1++
    }
    return { c0, c1 }
  }, [meme, players])

  const mySubmission = playerId && meme?.submissions?.[playerId]
  const myGifVote = playerId && meme?.gifVotes?.[playerId]

  const leaderboard = useMemo(() => {
    const entries = players.map((p) => ({
      id: p.id,
      name: p.displayName,
      score: meme?.scores?.[p.id] ?? 0,
    }))
    entries.sort((a, b) => b.score - a.score || a.name.localeCompare(b.name))
    return entries
  }, [players, meme?.scores])

  async function loadTrending() {
    setGifError(null)
    setGifLoading(true)
    try {
      const res = await trendingGifs({ perPage: 18 })
      setGifResults(res)
    } catch (e: unknown) {
      setGifError(e instanceof Error ? e.message : 'Failed to load GIFs')
    } finally {
      setGifLoading(false)
    }
  }

  async function runSearch(q: string) {
    setGifError(null)
    setGifLoading(true)
    try {
      const res = await searchGifs(q, { perPage: 18 })
      setGifResults(res)
    } catch (e: unknown) {
      setGifError(e instanceof Error ? e.message : 'Search failed')
    } finally {
      setGifLoading(false)
    }
  }

  const leaveRoomSocket = () => {
    if (!roomCode) return
    const socket = getSocket()
    if (socket.connected) socket.emit('room:leave')
    removeRecentRoom(roomCode)
  }

  const startMatch = () => {
    if (!roomCode) return
    const socket = getSocket()
    if (!socket.connected) socket.connect()
    socket.emit('game:meme:start')
  }

  const castContextVote = (promptIndex: 0 | 1) => {
    if (!roomCode) return
    getSocket().emit('game:meme:context_vote', { promptIndex })
  }

  const submitGif = () => {
    if (!roomCode || !pickedGif) return
    playMemeSubmitSfx()
    getSocket().emit('game:meme:submit_gif', { gif: pickedGif })
    setPickedGif(null)
  }

  const castGifVote = (targetPlayerId: string) => {
    if (!roomCode || !playerId || targetPlayerId === playerId) return
    playMemeVoteSfx()
    getSocket().emit('game:meme:gif_vote', { targetPlayerId })
  }

  const phaseLabel = () => {
    switch (status) {
      case 'lobby':
        return 'Lobby'
      case 'context_vote':
        return 'Vote on context'
      case 'context_result':
        return 'Result'
      case 'gif_pick':
        return 'Pick a GIF'
      case 'reveal':
        return 'Reveal'
      case 'gif_vote':
        return 'Vote best GIF'
      case 'round_break':
        return 'Next round'
      case 'leaderboard':
        return 'Leaderboard'
      default:
        return status
    }
  }

  const timerSec =
    status === 'reveal'
      ? timers.memeRevealSecLeft ?? 0
      : status === 'leaderboard'
        ? timers.memeLeaderboardSecLeft ?? 0
        : status === 'round_break'
          ? timers.memeRoundBreakSecLeft ?? 0
          : timers.memePhaseSecLeft ?? 0

  const revealOrder = useMemo(() => {
    if (!meme?.submissions) return []
    return players.filter((p) => meme.submissions[p.id])
  }, [players, meme?.submissions])

  useEffect(() => {
    if (status !== 'reveal') return
    setRevealIndex(0)
  }, [status, meme?.round])

  useEffect(() => {
    if (status !== 'reveal') return
    if (!autoReveal) return
    if (revealOrder.length <= 1) return

    const id = window.setInterval(() => {
      setRevealIndex((i) => Math.min(revealOrder.length - 1, i + 1))
    }, 2500)
    return () => window.clearInterval(id)
  }, [status, autoReveal, revealOrder.length])

  return (
    <div className="relative flex flex-1 flex-col px-4 py-4 sm:px-6 sm:py-5 lg:min-h-0 lg:overflow-hidden gw-enter">
      <RoomPresenceBanner
        message={presencePayload?.text ?? null}
        kind={presencePayload?.kind ?? null}
        onDismiss={dismissPresence}
      />
      <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex flex-wrap items-center gap-3">
          <Link
            to={backTarget}
            className="gw-focus-ring inline-flex items-center gap-2 rounded-xl border border-[color:var(--gw-border)] bg-[color:var(--gw-panel)] px-3 py-2 text-sm text-muted shadow-card transition-all hover:-translate-y-0.5 hover:text-text hover:shadow-[0_0_0_1px_var(--gw-border),0_14px_50px_rgba(0,0,0,0.35)]"
            onClick={(e) => {
              if (roomCode) {
                e.preventDefault()
                leaveRoomSocket()
                void navigate(backTarget)
              }
            }}
          >
            <ArrowLeft size={16} /> Back
          </Link>
          <div className="flex items-center gap-2">
            <div className="text-sm font-semibold text-text">Meme Battle</div>
            {roomCode && (
              <div className="uppercase tracking-wider">
                <Badge color="accent">{roomCode}</Badge>
              </div>
            )}
            {isHost && (
              <div className="uppercase tracking-wider">
                <Badge color="accent">
                  <Crown size={12} className="mr-1 inline-block" /> host
                </Badge>
              </div>
            )}
          </div>
        </div>
        {status !== 'lobby' && status !== 'leaderboard' && (
          <div className="flex items-center gap-3 text-sm">
            <span className="text-muted">Time</span>
            <span className="font-mono font-semibold text-text">{formatClock(timerSec)}</span>
          </div>
        )}
      </div>

      {roomCode && (
        <div className="mb-4 max-w-2xl">
          <RoomVoiceDock
            roomCode={roomCode}
            myPlayerId={playerId}
            players={players.map((p) => ({ id: p.id, displayName: p.displayName }))}
          />
        </div>
      )}

      <div className="flex min-h-0 flex-1 flex-col gap-4 lg:flex-row">
        <div className="gw-panel flex min-h-0 flex-1 flex-col rounded-2xl p-4">
          {status === 'lobby' && (
            <div className="flex flex-1 flex-col items-center justify-center text-center">
              <div className="mb-2 text-lg font-semibold text-text">Ready to battle?</div>
              <div className="mb-6 max-w-md text-sm text-muted">
                Everyone votes on a context, then picks a GIF. After each round, vote for the funniest GIF. The server
                runs the timers and scoring. {maxRounds} rounds per match.
              </div>
              {isHost ? (
                <Button
                  variant="teal"
                  size="lg"
                  type="button"
                  disabled={!minPlayersMet}
                  onClick={startMatch}
                  className="justify-center"
                >
                  {!minPlayersMet ? 'Need 2+ players' : 'Start match'}
                </Button>
              ) : (
                <div className="text-sm text-muted">Waiting for the host to start…</div>
              )}
            </div>
          )}

          {(status === 'context_vote' || status === 'context_result') && meme && (
            <div className="flex min-h-0 flex-1 flex-col">
              <div className="mb-3 flex items-center justify-between gap-3">
                <div>
                  <div className="text-xs font-semibold uppercase tracking-wider text-muted">Round</div>
                  <div className="text-lg font-semibold text-text">
                    {meme.round} / {maxRounds}
                  </div>
                </div>
                <div className="text-right">
                  <div className="text-xs font-semibold uppercase tracking-wider text-muted">Phase</div>
                  <div className="text-sm font-semibold text-text">{phaseLabel()}</div>
                </div>
              </div>

              {status === 'context_vote' && (
                <>
                  <p className="mb-4 text-sm text-muted">
                    Majority wins (ties break fairly). Timer can end the vote early.
                  </p>
                  <div className="mb-4 grid grid-cols-1 gap-3 md:grid-cols-2">
                    {[0, 1].map((idx) => {
                      const i = idx as 0 | 1
                      const mine = playerId ? meme.contextVotes[playerId] === i : false
                      const count = i === 0 ? contextVoteCount.c0 : contextVoteCount.c1
                      return (
                        <button
                          key={i}
                          type="button"
                          onClick={() => castContextVote(i)}
                          className={[
                            'rounded-2xl border p-4 text-left transition-all',
                            mine
                              ? 'border-teal/60 bg-teal/10'
                              : 'border-border bg-surface hover:border-accent/40',
                          ].join(' ')}
                        >
                          <p className="leading-relaxed text-text">{meme.prompts[i]}</p>
                          <div className="mt-3 flex items-center justify-between gap-2 text-xs text-muted">
                            <span>
                              {mine && (
                                <Check size={14} className="mr-1 inline-block align-middle text-teal" />
                              )}
                              {mine ? 'Your vote' : 'Tap to vote'}
                            </span>
                            <span>
                              {count} vote{count === 1 ? '' : 's'}
                            </span>
                          </div>
                        </button>
                      )
                    })}
                  </div>
                  <div className="text-sm text-muted">
                    Votes in:{' '}
                    <span className="font-semibold text-text">
                      {Object.keys(meme.contextVotes).length} / {players.length}
                    </span>
                  </div>
                </>
              )}

              {status === 'context_result' && meme.winningPromptIndex !== null && (
                <div className="rounded-2xl border border-teal/30 bg-teal/10 p-6 text-center">
                  <p className="text-lg font-medium leading-relaxed text-text">
                    {meme.prompts[meme.winningPromptIndex]}
                  </p>
                </div>
              )}
            </div>
          )}

          {status === 'gif_pick' && meme && (
            <div className="flex min-h-0 flex-1 flex-col">
              <div className="mb-3 flex items-center justify-between gap-3">
                <div>
                  <div className="text-xs font-semibold uppercase tracking-wider text-muted">Round</div>
                  <div className="text-lg font-semibold text-text">
                    {meme.round} / {maxRounds}
                  </div>
                </div>
                <div className="text-right text-sm text-muted">
                  GIF time {formatClock(timers.memePhaseSecLeft ?? 0)}
                </div>
              </div>
              <div className="mb-3 rounded-xl border border-teal/30 bg-teal/10 px-4 py-3">
                <p className="leading-relaxed text-text">
                  {meme.winningPromptIndex !== null ? meme.prompts[meme.winningPromptIndex] : '—'}
                </p>
              </div>
              <div className="mb-3 text-xs font-semibold uppercase tracking-wider text-muted">
                Search and select a GIF
              </div>

              <form
                className="mb-3 flex flex-wrap items-center gap-2"
                onSubmit={(e) => {
                  e.preventDefault()
                  void runSearch(gifQuery)
                }}
              >
                <div className="relative min-w-0 flex-1">
                  <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted" />
                  <input
                    value={gifQuery}
                    onChange={(e) => setGifQuery(e.target.value)}
                    placeholder="Search GIFs"
                    className="gw-focus-ring w-full rounded-xl border border-[color:var(--gw-border)] bg-[color:var(--gw-panel)] px-10 py-2.5 text-sm text-text placeholder:text-muted outline-none focus:border-[color:var(--gw-accent)]"
                  />
                </div>
                <Button type="submit" variant="ghost" disabled={gifLoading}>
                  Search
                </Button>
                <Button type="button" variant="ghost" disabled={gifLoading} onClick={() => void loadTrending()}>
                  Trending
                </Button>
              </form>

              {gifError && (
                <div className="mb-3 rounded-xl border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-200">
                  {gifError}
                </div>
              )}

              <div className="min-h-0 flex-1 overflow-hidden rounded-2xl border border-[color:var(--gw-border)]">
                <div className="max-h-[min(52vh,28rem)] overflow-y-auto overscroll-contain p-3 [scrollbar-gutter:stable]">
                  {gifLoading ? (
                    <div className="py-8 text-center text-sm text-muted">Loading GIFs…</div>
                  ) : gifResults.length ? (
                    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
                      {gifResults.map((g) => {
                        const active = pickedGif?.id === g.id
                        return (
                          <button
                            type="button"
                            key={g.id}
                            className={[
                              'group overflow-hidden rounded-xl border transition-all',
                              active
                                ? 'border-[color:var(--gw-accent)] shadow-[0_0_0_1px_var(--gw-border),0_0_35px_var(--gw-glow)]'
                                : 'border-[color:var(--gw-border)] hover:border-[color:var(--gw-accent)]',
                            ].join(' ')}
                            onClick={() => setPickedGif(g)}
                          >
                            <div className="relative aspect-video bg-base">
                              <img
                                src={g.previewUrl ?? g.url}
                                alt={g.title ?? 'gif'}
                                className="h-full w-full object-cover"
                                loading="lazy"
                              />
                              {active && (
                                <div className="absolute left-2 top-2 rounded-lg bg-teal/90 px-2 py-1 text-[10px] font-semibold text-black">
                                  Selected
                                </div>
                              )}
                            </div>
                          </button>
                        )
                      })}
                    </div>
                  ) : (
                    <div className="py-8 text-center text-sm text-muted">No GIFs yet.</div>
                  )}
                </div>
              </div>

              <div className="mt-4 flex items-center justify-between gap-3">
                <div className="text-sm text-muted">
                  Submitted:{' '}
                  <span className="font-semibold text-text">
                    {Object.keys(meme.submissions ?? {}).length} / {players.length}
                  </span>
                </div>
                <Button
                  type="button"
                  variant="teal"
                  disabled={!pickedGif || Boolean(mySubmission)}
                  onClick={submitGif}
                >
                  {mySubmission ? 'Submitted' : 'Submit GIF'}
                </Button>
              </div>
            </div>
          )}

          {(status === 'reveal' || status === 'gif_vote') && meme && (
            <div className="flex min-h-0 flex-1 flex-col">
              <div className="mb-3 flex items-center justify-between">
                <div className="text-xs font-semibold uppercase tracking-wider text-muted">
                  {status === 'reveal' ? 'Submissions' : 'Vote'}
                </div>
                <div className="text-sm text-muted">
                  {status === 'gif_vote' ? (
                    <>
                      Votes:{' '}
                      <span className="font-semibold text-text">
                        {Object.keys(meme.gifVotes ?? {}).length} / {players.length}
                      </span>
                    </>
                  ) : (
                    <>Reveal {formatClock(timers.memeRevealSecLeft ?? 0)}</>
                  )}
                </div>
              </div>
              <div className="mb-3 rounded-xl border border-teal/30 bg-teal/10 px-4 py-3">
                <p className="leading-relaxed text-text">
                  {meme.winningPromptIndex !== null ? meme.prompts[meme.winningPromptIndex] : '—'}
                </p>
              </div>

              {status === 'reveal' ? (
                <div className="min-h-0 flex-1 overflow-hidden rounded-2xl border border-[color:var(--gw-border)] bg-[color:var(--gw-panel-strong)] p-3">
                  {revealOrder.length === 0 ? (
                    <div className="py-10 text-center text-sm text-muted">No submissions yet.</div>
                  ) : (
                    <>
                      <div className="mb-2 flex items-center justify-between gap-2">
                        <div className="text-xs font-medium text-muted">
                          Showing {Math.min(revealIndex + 1, revealOrder.length)} of {revealOrder.length}
                        </div>
                        <button
                          type="button"
                          onClick={() => setAutoReveal((v) => !v)}
                          className="gw-focus-ring rounded-lg border border-[color:var(--gw-border)] bg-[color:var(--gw-panel)] px-2.5 py-1 text-xs font-semibold text-text hover:border-[color:var(--gw-accent)]"
                        >
                          {autoReveal ? 'Auto: on' : 'Auto: off'}
                        </button>
                      </div>

                      {(() => {
                        const p = revealOrder[Math.min(revealIndex, revealOrder.length - 1)]
                        const sub = p ? meme.submissions?.[p.id] : null
                        if (!p || !sub) return null
                        return (
                          <div className="overflow-hidden rounded-2xl border border-border bg-base">
                            <img
                              src={sub.gif.url}
                              alt=""
                              className="aspect-video w-full object-cover"
                              loading="lazy"
                            />
                          </div>
                        )
                      })()}

                      <div className="mt-3 flex items-center justify-between gap-3">
                        <Button
                          type="button"
                          variant="ghost"
                          disabled={revealIndex <= 0}
                          onClick={() => setRevealIndex((i) => Math.max(0, i - 1))}
                        >
                          Prev
                        </Button>
                        <Button
                          type="button"
                          variant="ghost"
                          disabled={revealIndex >= revealOrder.length - 1}
                          onClick={() => setRevealIndex((i) => Math.min(revealOrder.length - 1, i + 1))}
                        >
                          Next
                        </Button>
                      </div>
                    </>
                  )}
                </div>
              ) : (
                <div className="min-h-0 flex-1 overflow-auto rounded-2xl border border-[color:var(--gw-border)] p-3">
                  <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                    {revealOrder.map((p, idx) => {
                      const sub = meme.submissions![p.id]
                      if (!sub) return null
                      const votedFor = playerId ? myGifVote === p.id : false
                      const cantVoteSelf = playerId === p.id
                      return (
                        <div
                          key={p.id}
                          className="relative overflow-hidden rounded-2xl border border-[color:var(--gw-border)] bg-[color:var(--gw-panel)]"
                        >
                          <div className="overflow-hidden rounded-xl">
                            <img
                              src={sub.gif.url}
                              alt=""
                              className="aspect-video w-full object-cover"
                              loading="lazy"
                            />
                          </div>
                          <div className="flex items-center justify-between gap-2 border-t border-border px-3 py-2">
                            <span className="text-xs font-medium text-muted">#{idx + 1}</span>
                            <Button
                              type="button"
                              variant="ghost"
                              size="sm"
                              disabled={!playerId || cantVoteSelf}
                              onClick={() => castGifVote(p.id)}
                              className={votedFor ? 'text-teal' : ''}
                              title={cantVoteSelf ? undefined : 'Vote for this GIF'}
                            >
                              <ThumbsUp size={16} className="mr-2" />
                              {cantVoteSelf ? '—' : votedFor ? 'Voted' : 'Vote'}
                            </Button>
                          </div>
                        </div>
                      )
                    })}
                  </div>
                </div>
              )}
              <div className="mt-4 text-center text-sm text-muted">
                {status === 'reveal'
                  ? 'Viewing submissions…'
                  : `Pick your favorite GIF · ${formatClock(timers.memePhaseSecLeft ?? 0)} left`}
              </div>
            </div>
          )}

          {status === 'round_break' && meme && (
            <div className="flex min-h-0 flex-1 flex-col py-6">
              <h3 className="mb-1 text-center text-lg font-semibold text-text">
                Points after round {meme.round}
              </h3>
              <p className="mb-4 text-center text-sm text-muted">Running total — votes from each round add up</p>
              <div className="mx-auto mb-8 w-full max-w-md space-y-2">
                {leaderboard.map((e, idx) => (
                  <div
                    key={e.id}
                    className="flex items-center justify-between rounded-xl border border-border bg-base px-3 py-2.5"
                  >
                    <div className="flex min-w-0 items-center gap-3">
                      <span className="w-6 shrink-0 text-sm font-semibold text-muted">{idx + 1}</span>
                      <Avatar name={e.name} size="sm" />
                      <span className="truncate text-sm font-semibold text-text">{e.name}</span>
                    </div>
                    <span className="shrink-0 text-sm font-semibold text-text">{e.score} pts</span>
                  </div>
                ))}
              </div>
              <div className="mt-auto text-center">
                <div className="mb-1 text-lg font-semibold text-text">Round {meme.round + 1} up next</div>
                <div className="text-sm text-muted">Context vote in {formatClock(timerSec)}</div>
              </div>
            </div>
          )}

          {status === 'leaderboard' && meme && (
            <div className="flex min-h-0 flex-1 flex-col">
              <div className="mb-3 text-center">
                <div className="text-lg font-semibold text-text">Overall total</div>
                <div className="text-sm text-muted">Final points after {maxRounds} rounds</div>
              </div>
              <div className="mb-3 flex items-center justify-between">
                <div className="text-xs font-semibold uppercase tracking-wider text-muted">Match over</div>
              </div>
              <div className="min-h-0 flex-1 overflow-auto rounded-2xl border border-border p-3">
                <div className="space-y-2">
                  {leaderboard.map((e, idx) => (
                    <div
                      key={e.id}
                      className="flex items-center justify-between rounded-xl border border-border bg-base px-3 py-2"
                    >
                      <div className="flex items-center gap-3">
                        <div className="w-6 text-sm font-semibold text-muted">{idx + 1}</div>
                        <Avatar name={e.name} size="sm" />
                        <div className="text-sm font-semibold text-text">{e.name}</div>
                        {idx === 0 && e.score > 0 && <Badge color="accent">winner</Badge>}
                      </div>
                      <div className="text-sm font-semibold text-text">
                        {e.score} <span className="text-muted">pts</span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
              <div className="mt-6 flex flex-col items-center gap-3 text-center">
                {isHost ? (
                  <Button
                    variant="teal"
                    size="lg"
                    type="button"
                    disabled={!minPlayersMet}
                    onClick={startMatch}
                    className="justify-center"
                  >
                    {!minPlayersMet ? 'Need 2+ players' : 'Start another match'}
                  </Button>
                ) : (
                  <div className="text-sm text-muted">Waiting for the host to start the next match…</div>
                )}
              </div>
            </div>
          )}
        </div>

        <div className="gw-panel w-full rounded-2xl p-4 lg:w-90 lg:flex-none">
          <div className="mb-3 flex items-center justify-between">
            <div>
              <div className="text-xs font-semibold uppercase tracking-wider text-muted">Players</div>
              <div className="text-lg font-semibold text-text">{players.length}</div>
            </div>
          </div>

          {status !== 'lobby' && (
            <div className="mb-4 border-b border-[color:var(--gw-border)] pb-4">
              <div className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted">
                Total points
              </div>
              <p className="mb-2 text-[11px] leading-snug text-muted">
                +1 per vote on your GIF. Updates after each round&apos;s vote.
              </p>
              <div className="space-y-1.5">
                {leaderboard.map((e, idx) => (
                  <div
                    key={e.id}
                    className="flex items-center justify-between gap-2 rounded-lg border border-[color:var(--gw-border)] bg-[color:var(--gw-panel)] px-2.5 py-1.5 text-sm"
                  >
                    <div className="flex min-w-0 items-center gap-2">
                      <span className="w-4 shrink-0 text-xs font-semibold text-muted">{idx + 1}</span>
                      <span className="truncate font-medium text-text">{e.name}</span>
                    </div>
                    <span className="shrink-0 font-semibold tabular-nums text-text">{e.score}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          <div className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted">Status</div>
          <div className="space-y-2">
            {players.map((p) => {
              const ctxV = meme?.contextVotes?.[p.id]
              const ctxDone = ctxV === 0 || ctxV === 1
              const sub = Boolean(meme?.submissions?.[p.id])
              const gv = meme?.gifVotes?.[p.id]
              const pts = meme?.scores?.[p.id] ?? 0
              return (
                <div
                  key={p.id}
                  className="rounded-xl border border-[color:var(--gw-border)] bg-[color:var(--gw-panel)] px-3 py-2"
                >
                  <div className="flex items-center gap-3">
                    <Avatar name={p.displayName} size="sm" />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center justify-between gap-2">
                        <span className="truncate text-sm font-semibold text-text">{p.displayName}</span>
                        {status !== 'lobby' && (
                          <span className="shrink-0 text-xs tabular-nums text-muted">{pts} pts</span>
                        )}
                      </div>
                      <div className="mt-1 flex flex-wrap items-center gap-1">
                        {createdByUserId && p.id === createdByUserId && (
                          <Badge color="accent">host</Badge>
                        )}
                        {status === 'context_vote' && (
                          <Badge color={ctxDone ? 'accent' : 'muted'}>{ctxDone ? 'voted' : '…'}</Badge>
                        )}
                        {status === 'gif_pick' && (
                          <Badge color={sub ? 'accent' : 'muted'}>{sub ? 'ready' : '…'}</Badge>
                        )}
                        {status === 'gif_vote' && (
                          <Badge color={gv ? 'accent' : 'muted'}>{gv ? 'voted' : '…'}</Badge>
                        )}
                      </div>
                    </div>
                  </div>
                </div>
              )
            })}
          </div>

          {!minPlayersMet && (
            <div className="mt-4 rounded-xl border border-amber-400/30 bg-amber-400/10 px-3 py-2 text-sm text-amber-100">
              Need at least 2 players to start.
            </div>
          )}

          <div className="mt-4">
            <Button
              type="button"
              variant="ghost"
              className="w-full justify-center"
              onClick={() => {
                leaveRoomSocket()
                void navigate(backTarget)
              }}
            >
              Quit room
            </Button>
          </div>
        </div>
      </div>
    </div>
  )
}
