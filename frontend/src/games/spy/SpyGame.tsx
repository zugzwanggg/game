import { ArrowLeft, Crown, Send, Timer } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { MobileChatFloatingToasts } from '../../components/chat/MobileChatFloatingToasts'
import { MobileChatDock, MOBILE_CHAT_DOCK_PAD_CLASS } from '../../components/chat/MobileChatDock'
import { chatListScrollKey, useChatScrollToBottom } from '../../hooks/useChatScrollToBottom'
import { useMediaQueryLg } from '../../hooks/useMediaQueryLg'
import Avatar from '../../components/ui/Avatar'
import Badge from '../../components/ui/Badge'
import Button from '../../components/ui/Button'
import { RoomPresenceBanner } from '../../components/ui/RoomPresenceBanner'
import { SpectatorBanner } from '../../components/ui/SpectatorBanner'
import { RoomVoiceDock } from '../../components/voice/RoomVoiceDock'
import { useRoomPresenceNotification } from '../../hooks/useRoomPresenceNotification'
import { removeRecentRoom } from '../../lib/recentRooms'
import { getSocket } from '../../lib/socket'
import { playSpyCallVoteSfx } from '../../lib/synthSfx'
import { joinRoom } from '../../lib/roomJoin'

function uid() {
  try {
    return typeof crypto !== 'undefined' && 'randomUUID' in crypto
      ? crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(16).slice(2)}`
  } catch {
    return `${Date.now()}-${Math.random().toString(16).slice(2)}`
  }
}

type SpyRole = { role: 'spy' } | { role: 'agent'; word: string } | { role: 'spectator' }

type ChatMessage = {
  id: string
  author: string
  text: string
  variant: 'chat' | 'system'
}

type SpyGameWire =
  | {
      status: 'lobby' | 'discussion' | 'voting' | 'spy_guess'
      matchId: number
      discussionEndsAt?: number | null
      votingEndsAt?: number | null
      spyGuessEndsAt?: number | null
      earlyVoteYesCount?: number
      voteCount?: number
    }
  | {
      status: 'reveal'
      matchId: number
      revealedSpyPlayerId: string | null
      revealedWord: string | null
      winner: 'spy' | 'agents' | null
      selectedPlayerId: string | null
      tie: boolean
      spyGuessedCorrectly: boolean | null
      votes: Record<string, string>
    }

type TimersWire = {
  spyDiscussionSecLeft?: number
  spyVoteSecLeft?: number
  spyGuessSecLeft?: number
}

function formatClock(sec: number) {
  const s = Math.max(0, Math.floor(sec))
  const m = Math.floor(s / 60)
  const r = s % 60
  return `${m}:${r.toString().padStart(2, '0')}`
}

export default function SpyGame() {
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const roomCode = searchParams.get('room')
  const isOnline = Boolean(roomCode)

  const [playerId, setPlayerId] = useState<string | null>(null)
  const [players, setPlayers] = useState<{ id: string; displayName: string; spectator?: boolean }[]>([])
  const [createdByUserId, setCreatedByUserId] = useState<string | null>(null)
  const [spy, setSpy] = useState<SpyGameWire | null>(null)
  const [timers, setTimers] = useState<TimersWire>({})
  const [role, setRole] = useState<SpyRole | null>(null)
  const [myVote, setMyVote] = useState<string | null>(null)
  const [spyGuessText, setSpyGuessText] = useState('')
  const [chatInput, setChatInput] = useState('')
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [mobileTab, setMobileTab] = useState<'round' | 'players'>('round')
  const [mobileChatOpen, setMobileChatOpen] = useState(false)
  const [voteNudgeUntil, setVoteNudgeUntil] = useState<number>(0)

  const isHost = Boolean(playerId && createdByUserId && playerId === createdByUserId)
  const minPlayersMet = players.length >= 3 && players.length <= 10

  const backTarget = '/games/spy'

  const { payload: presencePayload, handlePlayersSnapshot, dismiss: dismissPresence } =
    useRoomPresenceNotification(isOnline && roomCode ? roomCode : null)

  const status = spy?.status ?? 'lobby'
  const discussionSec = timers.spyDiscussionSecLeft ?? 0
  const voteSec = timers.spyVoteSecLeft ?? 0
  const guessSec = timers.spyGuessSecLeft ?? 0
  const voteNudgeActive = voteNudgeUntil > Date.now()

  const isSpectator = Boolean(
    playerId && players.some((p) => p.id === playerId && p.spectator),
  )

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
      if (typeof state?.createdByUserId === 'string') setCreatedByUserId(state.createdByUserId)
      const nextSpy = (state.spyGame ?? null) as SpyGameWire | null
      setSpy(nextSpy)
      if (!nextSpy || nextSpy.status === 'lobby') setRole(null)
      setTimers((state.timers ?? {}) as TimersWire)
      if (Array.isArray(state?.chat)) {
        setMessages(
          state.chat.map((m: any) => ({
            id: String(m.id ?? uid()),
            author: String(m.author ?? 'Player'),
            text: String(m.text ?? ''),
            variant: m.variant === 'system' || String(m.author ?? '') === 'Game' ? 'system' : 'chat',
          })),
        )
      }
    }

    const onRole = (p: any) => {
      if (p?.role === 'spectator') {
        setRole({ role: 'spectator' })
        return
      }
      const r = p?.role === 'spy' ? ({ role: 'spy' } as const) : ({ role: 'agent', word: String(p?.word ?? '') } as const)
      setRole(r)
    }

    socket.on('room:state', onState)
    socket.on('game:spy:role', onRole)

    const onChat = (m: any) => {
      const variant = m.variant === 'system' || m.author === 'Game' ? 'system' : 'chat'
      const text = String(m.text ?? '')
      if (variant === 'system' && /called a vote/i.test(text)) {
        playSpyCallVoteSfx()
        setVoteNudgeUntil(Date.now() + 1200)
      }
      setMessages((prev) => [
        ...prev,
        {
          id: String(m.id ?? uid()),
          author: String(m.author ?? 'Player'),
          text,
          variant,
        },
      ])
    }
    const onChatClear = () => setMessages([])
    socket.on('chat:message', onChat)
    socket.on('chat:clear', onChatClear)

    // If the match started before this page mounted, request role info explicitly.
    // (Prevents missing the initial event during navigation.)
    socket.emit('game:spy:role:request')

    return () => {
      socket.off('room:state', onState)
      socket.off('game:spy:role', onRole)
      socket.off('chat:message', onChat)
      socket.off('chat:clear', onChatClear)
    }
  }, [isOnline, roomCode, handlePlayersSnapshot])

  useEffect(() => {
    // If we still don't have a role but the match is running, retry once we know our player id.
    if (!roomCode) return
    if (role) return
    if (!spy || spy.status === 'lobby') return
    const socket = getSocket()
    if (!socket.connected) socket.connect()
    socket.emit('game:spy:role:request')
  }, [roomCode, role, spy?.status])

  useEffect(() => {
    // Reset local per-round UI bits when match changes.
    if (!spy?.matchId) return
    setMyVote(null)
    setSpyGuessText('')
  }, [spy?.matchId])

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
    socket.emit('game:spy:start')
  }

  const requestVote = () => {
    if (isSpectator) return
    if (!roomCode) return
    playSpyCallVoteSfx()
    setVoteNudgeUntil(Date.now() + 1200)
    getSocket().emit('game:spy:request_vote')
  }

  const castVote = (targetPlayerId: string) => {
    if (isSpectator) return
    if (!roomCode || !playerId) return
    if (targetPlayerId === playerId) return
    setMyVote(targetPlayerId)
    getSocket().emit('game:spy:vote', { targetPlayerId })
  }

  const submitSpyGuess = () => {
    if (isSpectator) return
    if (!roomCode || role?.role !== 'spy') return
    const guess = spyGuessText.trim()
    if (!guess) return
    getSocket().emit('game:spy:guess', { guess })
  }

  const sendChat = (e: React.FormEvent) => {
    e.preventDefault()
    if (isSpectator) return
    if (!roomCode) return
    const text = chatInput.trim()
    if (!text) return
    getSocket().emit('chat:message', { text })
    setChatInput('')
  }

  const nameById = useMemo(() => {
    const m = new Map<string, string>()
    for (const p of players) m.set(p.id, p.displayName)
    return m
  }, [players])

  const spyChatMessageList = useMemo(
    () =>
      messages.length ? (
        messages.map((m) => (
          <div
            key={m.id}
            className={`rounded-lg px-3 py-2 text-sm ${
              m.variant === 'system'
                ? 'border border-border/60 bg-surface/80 text-muted'
                : 'bg-surface text-text'
            }`}
          >
            <span className="text-xs font-semibold text-muted">{m.author}</span>
            <p className="mt-0.5 wrap-break-word">{m.text}</p>
          </div>
        ))
      ) : (
        <div className="py-6 text-center text-sm text-muted">No messages yet.</div>
      ),
    [messages],
  )

  const spyChatScrollKey = useMemo(() => chatListScrollKey(messages), [messages])
  const spyDesktopChatRef = useChatScrollToBottom(spyChatScrollKey)
  const lgUp = useMediaQueryLg()

  if (!isOnline || !roomCode) {
    return (
      <div className="flex flex-1 items-center justify-center text-muted">
        Spy is room-only. Create or join a room to play.
      </div>
    )
  }

  return (
    <div
      className={`relative flex h-full min-h-0 flex-1 flex-col overflow-hidden px-4 py-4 sm:px-6 sm:py-5 lg:min-h-0 ${MOBILE_CHAT_DOCK_PAD_CLASS}`}
    >
      <RoomPresenceBanner
        message={presencePayload?.text ?? null}
        kind={presencePayload?.kind ?? null}
        onDismiss={dismissPresence}
      />

      {isSpectator ? (
        <div className="mb-4">
          <SpectatorBanner />
        </div>
      ) : null}

      <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex flex-wrap items-center gap-3">
          <Link
            to={backTarget}
            className="inline-flex items-center gap-2 rounded-xl border border-border bg-surface px-3 py-2 text-sm text-muted hover:text-text"
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
          {roomCode && (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="shrink-0"
              onClick={() => {
                leaveRoomSocket()
                void navigate('/games')
              }}
            >
              Quit room
            </Button>
          )}
          <div className="flex items-center gap-2">
            <div className="text-sm font-semibold text-text">Spy</div>
            <div className="uppercase tracking-wider">
              <Badge color="accent">{roomCode}</Badge>
            </div>
            {isHost && (
              <div className="uppercase tracking-wider">
                <Badge color="accent">
                  <Crown size={12} className="mr-1 inline-block" /> host
                </Badge>
              </div>
            )}
          </div>
        </div>

        {status !== 'lobby' && (
          <div className="flex items-center gap-3 text-sm">
            <span className="text-muted">Time</span>
            <span className="font-mono font-semibold text-text">
              {status === 'discussion'
                ? formatClock(discussionSec)
                : status === 'voting'
                  ? formatClock(voteSec)
                  : status === 'spy_guess'
                    ? formatClock(guessSec)
                    : '-'}
            </span>
          </div>
        )}
      </div>

      {lgUp ? (
        <div className="mb-4 max-w-2xl">
          <RoomVoiceDock
            roomCode={roomCode}
            myPlayerId={playerId}
            players={players.map((p) => ({ id: p.id, displayName: p.displayName }))}
          />
        </div>
      ) : null}

      <div className="mb-3 flex gap-2 lg:hidden">
        {[
          { id: 'round' as const, label: 'Round' },
          { id: 'players' as const, label: 'Players' },
        ].map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => setMobileTab(t.id)}
            className={[
              'flex-1 rounded-xl border px-3 py-2.5 text-sm font-semibold transition-colors',
              mobileTab === t.id ? 'border-accent bg-accent/10 text-text' : 'border-border bg-surface text-muted',
            ].join(' ')}
          >
            {t.label}
          </button>
        ))}
      </div>

      <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-hidden lg:flex-row lg:min-h-0 lg:items-stretch">
        <div
          className={[
            'min-h-0 w-full flex-col overflow-hidden rounded-2xl border border-border bg-surface p-4',
            mobileTab === 'players' ? 'flex' : 'hidden',
            'lg:order-3 lg:flex lg:w-72 lg:flex-none lg:shrink-0',
          ].join(' ')}
        >
          <div className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted">Players</div>
          <div className="space-y-2">
            {players.map((p) => (
              <div key={p.id} className="rounded-xl border border-border bg-base px-3 py-2">
                <div className="flex items-center gap-3">
                  <Avatar name={p.displayName} size="sm" />
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-semibold text-text">{p.displayName}</div>
                    <div className="mt-1 flex flex-wrap items-center gap-1">
                      {createdByUserId && p.id === createdByUserId && <Badge color="accent">host</Badge>}
                      {playerId && p.id === playerId && <Badge color="muted">you</Badge>}
                    </div>
                  </div>
                </div>
              </div>
            ))}
          </div>

          {!minPlayersMet && (
            <div className="mt-4 rounded-xl border border-amber-400/30 bg-amber-400/10 px-3 py-2 text-sm text-amber-100">
              Need 3-10 players to play Spy.
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

        <div className="hidden min-h-0 w-full flex-col lg:order-2 lg:flex lg:w-90 lg:flex-none lg:shrink-0">
          <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-2xl border border-border bg-card lg:max-h-full">
            <div className="shrink-0 border-b border-border px-4 py-3">
              <h2 className="text-sm font-semibold text-text">Chat</h2>
              <p className="text-xs text-muted">Talk freely. Don’t say the word directly.</p>
            </div>
            <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
              <div
                ref={spyDesktopChatRef}
                className="min-h-0 flex-1 space-y-2 overflow-y-auto overscroll-contain px-4 py-3 [scrollbar-gutter:stable]"
              >
                {messages.length ? (
                  messages.map((m) => (
                    <div
                      key={m.id}
                      className={`rounded-lg px-3 py-2 text-sm ${
                        m.variant === 'system'
                          ? 'border border-border/60 bg-surface/80 text-muted'
                          : 'bg-surface text-text'
                      }`}
                    >
                      <span className="text-xs font-semibold text-muted">{m.author}</span>
                      <p className="mt-0.5 wrap-break-word">{m.text}</p>
                    </div>
                  ))
                ) : (
                  <div className="py-6 text-center text-sm text-muted">No messages yet.</div>
                )}
              </div>
              <form onSubmit={sendChat} className="shrink-0 border-t border-border p-3">
                <div className="flex gap-2">
                  <input
                    value={chatInput}
                    onChange={(e) => setChatInput(e.target.value)}
                    placeholder="Type a message…"
                    disabled={isSpectator}
                    className="min-w-0 flex-1 rounded-xl border border-border bg-surface px-3 py-2.5 text-sm text-text outline-none placeholder:text-muted focus:border-accent/60 disabled:opacity-50"
                    autoComplete="off"
                  />
                  <Button type="submit" variant="primary" size="md" className="shrink-0 px-4" disabled={isSpectator}>
                    Send
                  </Button>
                </div>
              </form>
            </div>
          </div>
        </div>

        <div
          className={[
            'min-h-0 flex-1 flex-col rounded-2xl border border-border bg-surface p-4',
            mobileTab === 'round' ? 'flex' : 'hidden',
            'lg:order-1 lg:flex lg:min-w-0',
          ].join(' ')}
        >
          {status === 'lobby' && (
            <div className="flex flex-1 flex-col items-center justify-center text-center">
              <div className="mb-2 text-lg font-semibold text-text">Ready to play Spy?</div>
              <div className="mb-6 max-w-md text-sm text-muted">
                1 Spy doesn’t know the word. Everyone else shares the same word and gives hints without saying it. Then vote. If you tie, Spy wins instantly.
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
                  {!minPlayersMet ? 'Need 3-10 players' : 'Start round'}
                </Button>
              ) : (
                <div className="text-sm text-muted">Waiting for the host to start…</div>
              )}
            </div>
          )}

          {status !== 'lobby' && (
            <div className="mb-4 rounded-2xl border border-border bg-base p-4">
              <div className="mb-1 text-xs font-semibold uppercase tracking-wider text-muted">Your role</div>
              {role?.role === 'spectator' || isSpectator ? (
                <div className="text-lg font-semibold text-text">Spectator. Watch until the next match.</div>
              ) : role?.role === 'spy' ? (
                <div className="text-lg font-semibold text-text">You are the Spy.</div>
              ) : role?.role === 'agent' ? (
                <div className="text-lg font-semibold text-text">
                  Secret word: <span className="text-teal">{role.word}</span>
                </div>
              ) : (
                <div className="text-sm text-muted">Loading…</div>
              )}
              <div className="mt-2 text-xs text-muted">
                Agents: don’t say the word directly. Spy: blend in and figure it out.
              </div>
            </div>
          )}

          {status === 'discussion' && spy && (
            <div className="flex flex-1 flex-col">
              <div className="mb-3 flex items-center justify-between gap-3">
                <div className="text-xs font-semibold uppercase tracking-wider text-muted">Discussion</div>
                <div className="text-sm text-muted">
                  <Timer size={14} className="mr-1 inline-block align-middle" />
                  {formatClock(discussionSec)}
                </div>
              </div>

              <div className="mb-4 rounded-2xl border border-border bg-base p-4 text-sm text-muted">
                Talk freely. Give hints without revealing the word. Anyone can call for an early vote; it starts when a majority agrees.
              </div>

              <div
                className={[
                  'mt-auto flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border bg-surface px-3 py-2.5 transition-all',
                  voteNudgeActive ? 'border-amber-400/40 bg-amber-400/10 shadow-glow-accent' : '',
                ].join(' ')}
              >
                <div className="text-sm text-muted">
                  Early vote: <span className="font-semibold text-text">{(spy as any).earlyVoteYesCount ?? 0}</span> /{' '}
                  <span className="font-semibold text-text">{players.length}</span> agreed
                </div>
                <Button
                  type="button"
                  variant="ghost"
                  onClick={requestVote}
                  disabled={!playerId || isSpectator}
                  className={voteNudgeActive ? 'animate-pulse' : ''}
                >
                  Call vote
                </Button>
              </div>
            </div>
          )}

          {status === 'voting' && (
            <div className="flex min-h-0 flex-1 flex-col">
              <div className="mb-3 flex items-center justify-between gap-3">
                <div className="text-xs font-semibold uppercase tracking-wider text-muted">Voting</div>
                <div className="text-sm text-muted">{formatClock(voteSec)}</div>
              </div>
              <div className="mb-4 text-sm text-muted">
                Vote for who you think is the Spy. Voting is anonymous. You can’t vote for yourself.
              </div>

              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                {players.map((p) => {
                  const disabled = !playerId || p.id === playerId
                  const active = myVote === p.id
                  return (
                    <button
                      key={p.id}
                      type="button"
                      disabled={disabled}
                      onClick={() => castVote(p.id)}
                      className={[
                        'flex items-center gap-3 rounded-xl border px-3 py-2.5 text-left transition-all',
                        disabled ? 'cursor-not-allowed opacity-60' : 'hover:border-accent/40',
                        active ? 'border-teal/60 bg-teal/10' : 'border-border bg-base',
                      ].join(' ')}
                    >
                      <Avatar name={p.displayName} size="sm" />
                      <div className="min-w-0">
                        <div className="truncate text-sm font-semibold text-text">{p.displayName}</div>
                        <div className="text-xs text-muted">{active ? 'Your vote' : 'Tap to vote'}</div>
                      </div>
                    </button>
                  )
                })}
              </div>

              <div className="mt-auto pt-4 text-center text-xs text-muted">
                Votes cast: {(spy as any)?.voteCount ?? 0} / {players.length}
              </div>
            </div>
          )}

          {spy?.status === 'spy_guess' && (
            <div className="flex flex-1 flex-col">
              <div className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted">Final step</div>
              <div className="mb-4 text-sm text-muted">
                The Spy was selected. The Spy gets one chance to guess the word.
              </div>

              {role?.role === 'spy' ? (
                <div className="mt-auto">
                  <div className="mb-2 text-sm font-semibold text-text">Spy guess</div>
                  <div className="flex flex-wrap items-center gap-2">
                    <input
                      value={spyGuessText}
                      onChange={(e) => setSpyGuessText(e.target.value)}
                      placeholder="Type the secret word"
                      className="min-w-0 flex-1 rounded-xl border border-border bg-base px-3 py-2.5 text-sm text-text placeholder:text-muted outline-none focus:border-accent/60"
                    />
                    <Button type="button" variant="teal" onClick={submitSpyGuess} disabled={!spyGuessText.trim()}>
                      Submit
                    </Button>
                  </div>
                  <div className="mt-2 text-xs text-muted">Time left: {formatClock(guessSec)}</div>
                </div>
              ) : (
                <div className="mt-auto text-center text-sm text-muted">Waiting for the Spy’s guess…</div>
              )}
            </div>
          )}

          {spy?.status === 'reveal' && (
            <div className="flex min-h-0 flex-1 flex-col">
              <div className="mb-3 text-xs font-semibold uppercase tracking-wider text-muted">Round result</div>
              <div className="mb-4 rounded-2xl border border-border bg-base p-4">
                <div className="text-sm text-muted">Spy</div>
                <div className="text-lg font-semibold text-text">
                  {spy.revealedSpyPlayerId ? nameById.get(spy.revealedSpyPlayerId) ?? 'Unknown' : '-'}
                </div>
                <div className="mt-2 text-sm text-muted">Secret word</div>
                <div className="text-lg font-semibold text-text">{spy.revealedWord ?? '-'}</div>
                <div className="mt-3 text-sm">
                  Winner:{' '}
                  <span className={spy.winner === 'agents' ? 'font-semibold text-teal' : 'font-semibold text-amber-300'}>
                    {spy.winner === 'agents' ? 'Non-spies' : 'Spy'}
                  </span>
                  {spy.tie && <span className="ml-2 text-xs text-muted">(tie → Spy wins)</span>}
                  {spy.spyGuessedCorrectly === true && (
                    <span className="ml-2 text-xs text-muted">(Spy guessed correctly)</span>
                  )}
                </div>
              </div>

              <div className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted">Votes (revealed)</div>
              <div className="min-h-0 flex-1 overflow-auto rounded-2xl border border-border bg-base p-3">
                <div className="space-y-2">
                  {Object.keys(spy.votes ?? {}).length === 0 ? (
                    <div className="py-6 text-center text-sm text-muted">No votes recorded.</div>
                  ) : (
                    Object.entries(spy.votes).map(([voterId, targetId]) => (
                      <div key={voterId} className="flex items-center justify-between rounded-xl border border-border bg-surface px-3 py-2">
                        <div className="min-w-0">
                          <div className="truncate text-sm font-semibold text-text">
                            {nameById.get(voterId) ?? voterId}
                          </div>
                          <div className="truncate text-xs text-muted">voted</div>
                        </div>
                        <div className="truncate text-sm font-semibold text-text">
                          {nameById.get(targetId) ?? targetId}
                        </div>
                      </div>
                    ))
                  )}
                </div>
              </div>

              <div className="mt-4 flex justify-center">
                {isHost ? (
                  <Button type="button" variant="teal" onClick={startMatch} disabled={!minPlayersMet}>
                    Start another round
                  </Button>
                ) : (
                  <div className="text-sm text-muted">Waiting for the host…</div>
                )}
              </div>
            </div>
          )}
        </div>
      </div>

      <MobileChatFloatingToasts messages={messages} expanded={mobileChatOpen} enabled={!isSpectator} theme="shell" />

      <MobileChatDock
        title="Chat"
        subtitle="Tap ↑ for history"
        expanded={mobileChatOpen}
        onExpandedChange={setMobileChatOpen}
        scrollToBottomKey={spyChatScrollKey}
        endAccessory={
          lgUp ? undefined : (
            <RoomVoiceDock
              roomCode={roomCode}
              myPlayerId={playerId}
              players={players.map((p) => ({ id: p.id, displayName: p.displayName }))}
            />
          )
        }
        messages={<div className="space-y-2">{spyChatMessageList}</div>}
        composer={
          isSpectator ? (
            <div className="rounded-xl border border-border bg-base px-2 py-2 text-center text-[10px] leading-snug text-muted">
              Spectating. Chat when the next match starts.
            </div>
          ) : (
            <form className="flex w-full gap-2" onSubmit={sendChat}>
              <input
                value={chatInput}
                onChange={(e) => setChatInput(e.target.value)}
                placeholder="Type a message…"
                className="min-w-0 flex-1 rounded-xl border border-border bg-surface px-3 py-2.5 text-sm text-text outline-none placeholder:text-muted focus:border-accent/60"
                autoComplete="off"
              />
              <Button type="submit" variant="primary" size="md" className="shrink-0 px-3">
                <Send size={16} />
              </Button>
            </form>
          )
        }
      />
    </div>
  )
}

