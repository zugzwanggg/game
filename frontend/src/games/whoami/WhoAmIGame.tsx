import { Send } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { MobileChatFloatingToasts } from '../../components/chat/MobileChatFloatingToasts'
import { MobileChatDock, MOBILE_CHAT_DOCK_PAD_CLASS } from '../../components/chat/MobileChatDock'
import { chatListScrollKey, useChatScrollToBottom } from '../../hooks/useChatScrollToBottom'
import { useMediaQueryLg } from '../../hooks/useMediaQueryLg'
import Avatar from '../../components/ui/Avatar'
import Button from '../../components/ui/Button'
import { RoomPresenceBanner } from '../../components/ui/RoomPresenceBanner'
import { SpectatorBanner } from '../../components/ui/SpectatorBanner'
import { RoomVoiceDock } from '../../components/voice/RoomVoiceDock'
import { useAuth } from '../../context/AuthProvider'
import { useRoomPresenceNotification } from '../../hooks/useRoomPresenceNotification'
import { removeRecentRoom } from '../../lib/recentRooms'
import { getSocket } from '../../lib/socket'
import { joinRoom } from '../../lib/roomJoin'
import { whoAmILargeImageUrl } from '../../lib/whoamiImage'
import { ensureAudioReady, playWhoamiCorrect, playWhoamiWrong } from '../../lib/sfx'

function uid() {
  try {
    return typeof crypto !== 'undefined' && 'randomUUID' in crypto
      ? crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(16).slice(2)}`
  } catch {
    return `${Date.now()}-${Math.random().toString(16).slice(2)}`
  }
}

type ChatMessage = {
  id: string
  author: string
  text: string
  variant: 'chat' | 'system'
}

type WhoAmIView = {
  matchId: number
  mode: 'player' | 'spectator'
  others: { playerId: string; name: string; imageUrl: string | null }[]
}

type GuessAck = { ok?: boolean; correct?: boolean }

type WhoAmICategory = 'character' | 'person' | 'mixed'

export default function WhoAmIGame() {
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const roomCode = searchParams.get('room')
  const isOnline = Boolean(roomCode)
  const { principal } = useAuth()
  const lgUp = useMediaQueryLg()

  const [playerId, setPlayerId] = useState<string | null>(null)
  const [createdByUserId, setCreatedByUserId] = useState<string | null>(null)
  const [players, setPlayers] = useState<{ id: string; displayName: string; spectator?: boolean }[]>([])
  const [whoami, setWhoami] = useState<{
    status: string
    matchId: number
    categoryFilter: WhoAmICategory | null
    solved: Record<string, boolean>
  } | null>(null)
  const [view, setView] = useState<WhoAmIView | null>(null)
  const [chatInput, setChatInput] = useState('')
  const [guessInput, setGuessInput] = useState('')
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [guessHint, setGuessHint] = useState<string | null>(null)
  const [guessShakeKey, setGuessShakeKey] = useState(0)
  const [mobileChatOpen, setMobileChatOpen] = useState(false)

  const scrollKey = useMemo(() => chatListScrollKey(messages), [messages])
  const desktopChatRef = useChatScrollToBottom(scrollKey)

  const whoamiChatMessageList = useMemo(
    () =>
      messages.length ? (
        messages.map((m) => (
          <div
            key={m.id}
            className={[
              'rounded-xl px-3 py-2 text-sm',
              m.variant === 'system' ? 'bg-base text-muted' : 'bg-base text-text',
            ].join(' ')}
          >
            {m.variant === 'system' ? (
              m.text
            ) : (
              <>
                <span className="font-semibold text-accent">{m.author}:</span> {m.text}
              </>
            )}
          </div>
        ))
      ) : (
        <div className="py-6 text-center text-sm text-muted">No messages yet.</div>
      ),
    [messages],
  )

  const isSpectator = Boolean(
    playerId && players.some((p) => p.id === playerId && p.spectator),
  )

  const isHost = Boolean(
    principal?.kind === 'user' &&
      createdByUserId &&
      playerId &&
      principal.id === createdByUserId,
  )

  const status = whoami?.status ?? 'lobby'
  const playing = status === 'playing'
  const mySolved = playerId && whoami?.solved ? Boolean(whoami.solved[playerId]) : false

  const canStartRound =
    Boolean(whoami?.categoryFilter) && players.length >= 2 && players.length <= 12

  const nameById = useMemo(
    () => Object.fromEntries(players.map((p) => [p.id, p.displayName])),
    [players],
  )

  const { payload: presencePayload, handlePlayersSnapshot, dismiss: dismissPresence } =
    useRoomPresenceNotification(isOnline && roomCode ? roomCode : null)

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
      if (typeof state?.createdByUserId === 'string') {
        setCreatedByUserId(state.createdByUserId)
      }
      const wg = state.whoamiGame
      const cf = wg?.categoryFilter
      setWhoami(
        wg
          ? {
              status: String(wg.status ?? 'lobby'),
              matchId: Number(wg.matchId ?? 0),
              categoryFilter:
                cf === 'character' || cf === 'person' || cf === 'mixed' ? cf : null,
              solved: (wg.solved ?? {}) as Record<string, boolean>,
            }
          : null,
      )
      if (!wg || String(wg.status ?? 'lobby') === 'lobby') {
        setView(null)
      }
      if (Array.isArray(state?.chat)) {
        setMessages(
          state.chat.map((m: any) => ({
            id: String(m.id ?? uid()),
            author: String(m.author ?? 'Player'),
            text: String(m.text ?? ''),
            variant:
              m.variant === 'system' || String(m.author ?? '') === 'Game' ? 'system' : 'chat',
          })),
        )
      }
    }

    const onView = (p: any) => {
      if (!p?.others || !Array.isArray(p.others)) return
      setView({
        matchId: Number(p.matchId ?? 0),
        mode: p.mode === 'spectator' ? 'spectator' : 'player',
        others: p.others.map((o: any) => ({
          playerId: String(o.playerId ?? ''),
          name: String(o.name ?? ''),
          imageUrl: o.imageUrl == null ? null : String(o.imageUrl),
        })),
      })
    }

    socket.on('room:state', onState)
    socket.on('game:whoami:view', onView)

    const onChat = (m: any) => {
      const variant = m.variant === 'system' || m.author === 'Game' ? 'system' : 'chat'
      setMessages((prev) => [
        ...prev,
        {
          id: String(m.id ?? uid()),
          author: String(m.author ?? 'Player'),
          text: String(m.text ?? ''),
          variant,
        },
      ])
    }
    const onChatClear = () => setMessages([])
    socket.on('chat:message', onChat)
    socket.on('chat:clear', onChatClear)

    socket.emit('game:whoami:view:request')

    return () => {
      socket.off('room:state', onState)
      socket.off('game:whoami:view', onView)
      socket.off('chat:message', onChat)
      socket.off('chat:clear', onChatClear)
    }
  }, [isOnline, roomCode, handlePlayersSnapshot])

  useEffect(() => {
    if (!roomCode) return
    if (!playing) return
    const socket = getSocket()
    socket.emit('game:whoami:view:request')
  }, [roomCode, playing, whoami?.matchId])

  useEffect(() => {
    if (playing) return
    setGuessHint(null)
    setGuessShakeKey(0)
  }, [playing])

  const sendChat = () => {
    const t = chatInput.trim()
    if (!t || !roomCode || isSpectator) return
    const socket = getSocket()
    socket.emit('chat:message', { text: t })
    setChatInput('')
  }

  const sendGuess = () => {
    const t = guessInput.trim()
    if (!t || !roomCode || isSpectator || mySolved) return
    const socket = getSocket()
    if (!socket.connected) socket.connect()
    void ensureAudioReady()
    socket.emit('game:whoami:guess', { guess: t }, (res: GuessAck) => {
      if (res?.correct) {
        playWhoamiCorrect()
        setGuessInput('')
        setGuessHint(null)
        return
      }
      if (res?.ok === true && res.correct === false) {
        playWhoamiWrong()
        setGuessHint(`Not "${t}". Keep digging.`)
        setGuessShakeKey((k) => k + 1)
        window.setTimeout(() => setGuessHint(null), 4800)
        setGuessInput('')
        return
      }
      setGuessInput('')
    })
  }

  if (!roomCode) {
    return (
      <div className="flex min-h-[50dvh] flex-col items-center justify-center gap-3 px-4 text-muted">
        <p>Open this screen from your room link.</p>
        <Link to="/games/whoami" className="text-accent hover:underline">
          Who Am I home
        </Link>
      </div>
    )
  }

  return (
    <div className="relative flex h-dvh max-h-dvh min-h-0 flex-col overflow-hidden bg-[#0a0c14] text-text">
      <RoomPresenceBanner
        message={presencePayload?.text ?? null}
        kind={presencePayload?.kind ?? null}
        onDismiss={dismissPresence}
      />

      <header className="grid shrink-0 grid-cols-[1fr_auto_1fr] items-center gap-2 border-b border-white/[0.06] px-3 py-3 sm:px-5">
        <button
          type="button"
          onClick={() => {
            const socket = getSocket()
            socket.emit('room:leave')
            removeRecentRoom(roomCode)
            void navigate('/games/whoami')
          }}
          className="justify-self-start text-left text-sm text-muted transition-colors hover:text-text"
        >
          Leave
        </button>
        <h1 className="text-center text-sm font-semibold tracking-tight text-text/95">Who Am I</h1>
        <span className="justify-self-end font-mono text-[11px] font-medium uppercase tracking-[0.2em] text-muted">
          {roomCode}
        </span>
      </header>

      <div
        className={`relative flex min-h-0 flex-1 flex-col overflow-hidden lg:flex-row ${MOBILE_CHAT_DOCK_PAD_CLASS}`}
      >
        <section className="relative flex min-h-0 min-w-0 flex-[2] flex-col border-b border-white/[0.06] lg:border-b-0 lg:border-r">
          {!playing && (
            <div
              className="pointer-events-none absolute inset-0 opacity-40"
              style={{
                background:
                  'radial-gradient(ellipse 80% 50% at 50% -20%, rgba(168,85,247,0.22), transparent 55%)',
              }}
            />
          )}
          {playing && (
            <div
              className="pointer-events-none absolute inset-0 opacity-30"
              style={{
                background:
                  'radial-gradient(ellipse 70% 45% at 50% 0%, rgba(123,97,255,0.2), transparent 50%), radial-gradient(ellipse 50% 40% at 100% 100%, rgba(0,212,170,0.08), transparent 45%)',
              }}
            />
          )}

          {isSpectator ? (
            <div className="relative z-[1] shrink-0 p-3">
              <SpectatorBanner />
            </div>
          ) : null}

          {lgUp ? (
            <div className="relative z-[1] shrink-0 border-b border-white/[0.06] p-3 sm:p-4">
              <RoomVoiceDock
                roomCode={roomCode}
                myPlayerId={playerId}
                players={players.map((p) => ({ id: p.id, displayName: p.displayName }))}
              />
            </div>
          ) : null}

          <div className="relative z-[1] min-h-0 flex-1 overflow-y-auto">
            {!playing ? (
              <div className="mx-auto max-w-2xl space-y-8 px-4 py-8 sm:py-10">
                <div className="space-y-2 text-center">
                  <p className="text-lg font-semibold tracking-tight text-text sm:text-xl">
                    Before the cards hit the table
                  </p>
                  <p className="text-sm leading-relaxed text-muted">
                    Pick what kind of names you want in the mix. When you start, everyone sees the
                    room except their own card. Chat is fair game.
                  </p>
                </div>

                {isHost && !isSpectator ? (
                  <>
                    <div className="grid gap-3 sm:grid-cols-3">
                      {(
                        [
                          {
                            key: 'character' as const,
                            title: 'Fiction',
                            sub: 'Heroes, villains, mascots',
                          },
                          {
                            key: 'person' as const,
                            title: 'Real life',
                            sub: 'Athletes, artists, public faces',
                          },
                          {
                            key: 'mixed' as const,
                            title: 'Mixed',
                            sub: 'Both in one round',
                          },
                        ] as const
                      ).map(({ key, title, sub }) => {
                        const selected = whoami?.categoryFilter === key
                        return (
                          <button
                            key={key}
                            type="button"
                            onClick={() => {
                              const socket = getSocket()
                              if (!socket.connected) socket.connect()
                              socket.emit('game:whoami:set_config', { category: key })
                            }}
                            className={`rounded-2xl border px-5 py-5 text-left transition-all duration-200 ${
                              selected
                                ? 'border-teal/50 bg-teal/[0.08] shadow-[0_0_0_1px_rgba(0,212,170,0.15)]'
                                : 'border-white/[0.08] bg-card/80 hover:border-white/[0.14]'
                            }`}
                          >
                            <p className="text-base font-semibold text-text">{title}</p>
                            <p className="mt-1.5 text-xs leading-relaxed text-muted">{sub}</p>
                          </button>
                        )
                      })}
                    </div>

                    <Button
                      type="button"
                      variant="teal"
                      size="lg"
                      className="w-full justify-center rounded-2xl py-6 text-base font-semibold shadow-glow-teal"
                      disabled={!canStartRound}
                      onClick={() => {
                        const socket = getSocket()
                        if (!socket.connected) socket.connect()
                        socket.emit('game:whoami:start')
                      }}
                    >
                      {!whoami?.categoryFilter
                        ? 'Pick a deck first'
                        : players.length < 2
                          ? 'Need at least two people'
                          : players.length > 12
                            ? 'Twelve players max'
                            : 'Start the round'}
                    </Button>
                  </>
                ) : (
                  <div className="rounded-2xl border border-white/[0.08] bg-card/60 px-6 py-8 text-center backdrop-blur-sm">
                    <p className="text-sm leading-relaxed text-muted">
                      {isSpectator
                        ? 'You are watching. The host picks the deck and starts when the group is ready.'
                        : 'Hang tight. The host picks the deck and starts the round.'}
                    </p>
                  </div>
                )}
              </div>
            ) : (
              <div className="mx-auto max-w-5xl space-y-6 px-3 pb-8 pt-5 sm:px-5 sm:pt-6">
                <p className="text-center text-sm leading-relaxed text-muted">
                  {view?.mode === 'spectator'
                    ? 'You can see every card on the table.'
                    : 'Your card is the only one you cannot see here.'}
                </p>
                <div className="grid gap-5 sm:grid-cols-2">
                  {(view?.others ?? []).map((o) => {
                    const solved = Boolean(whoami?.solved?.[o.playerId])
                    const bigSrc = whoAmILargeImageUrl(o.imageUrl)
                    return (
                      <article
                        key={o.playerId}
                        className="overflow-hidden rounded-3xl border border-white/[0.08] bg-card/90 shadow-card backdrop-blur-sm"
                      >
                        <div className="relative flex h-[min(56dvh,32rem)] w-full items-center justify-center bg-[#05060a] p-4 sm:h-[min(50dvh,36rem)] sm:p-6">
                          {bigSrc ? (
                            <img
                              src={bigSrc}
                              alt=""
                              className="max-h-full max-w-full object-contain object-center"
                            />
                          ) : (
                            <div className="flex w-full items-center justify-center px-6 py-16 text-center">
                              <span className="text-2xl font-bold tracking-tight text-muted sm:text-3xl">
                                {o.name}
                              </span>
                            </div>
                          )}
                          {solved && (
                            <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/80 to-transparent px-4 pb-3 pt-10">
                              <p className="text-center text-xs font-medium text-teal">They found it</p>
                            </div>
                          )}
                        </div>
                        <div className="flex items-start gap-3 border-t border-white/[0.06] p-4 sm:p-5">
                          <Avatar name={nameById[o.playerId] ?? '?'} size="md" />
                          <div className="min-w-0 flex-1">
                            <p className="text-xs font-medium text-muted">{nameById[o.playerId] ?? 'Player'}</p>
                            <p className="mt-0.5 text-xl font-bold leading-snug tracking-tight sm:text-2xl">
                              {o.name}
                            </p>
                          </div>
                        </div>
                      </article>
                    )
                  })}
                </div>

                {!isSpectator && (
                  <div
                    key={guessShakeKey}
                    className={`rounded-3xl border border-white/[0.08] bg-card/90 p-4 sm:p-5 ${guessShakeKey ? 'animate-whoami-shake' : ''}`}
                  >
                    {guessHint && (
                      <div className="mb-3 rounded-2xl border border-amber-500/25 bg-amber-500/[0.09] px-4 py-3 text-sm text-amber-100/95">
                        {guessHint}
                      </div>
                    )}
                    {mySolved ? (
                      <div className="rounded-2xl border border-teal/25 bg-teal/[0.08] px-4 py-3 text-sm text-teal">
                        You got it. Wait for everyone else to land theirs.
                      </div>
                    ) : (
                      <div className="flex flex-col gap-3 sm:flex-row sm:items-stretch">
                        <input
                          value={guessInput}
                          onChange={(e) => setGuessInput(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') sendGuess()
                          }}
                          placeholder="Type who you think you are"
                          maxLength={80}
                          className="min-h-[48px] min-w-0 flex-1 rounded-2xl border border-white/[0.1] bg-[#0a0c14] px-4 text-sm text-text outline-none ring-teal/0 transition-shadow placeholder:text-muted focus:border-teal/35 focus:ring-2 focus:ring-teal/20"
                        />
                        <Button
                          type="button"
                          variant="teal"
                          className="h-12 shrink-0 rounded-2xl px-6 sm:h-auto sm:self-stretch"
                          onClick={sendGuess}
                        >
                          Guess
                        </Button>
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}
          </div>
        </section>

        <aside className="hidden min-h-0 w-full shrink-0 flex-col border-t border-border bg-surface lg:flex lg:w-[min(100%,380px)] lg:border-l lg:border-t-0">
          <div className="shrink-0 border-b border-border px-4 py-3 text-xs font-semibold uppercase tracking-wider text-muted">
            Chat
          </div>
          <div
            ref={desktopChatRef}
            className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-3 py-3 [scrollbar-gutter:stable]"
            data-scroll-key={scrollKey}
          >
            <div className="space-y-2">{whoamiChatMessageList}</div>
          </div>
          {!isSpectator && (
            <form
              onSubmit={(e) => {
                e.preventDefault()
                sendChat()
              }}
              className="shrink-0 border-t border-border p-3"
            >
              <div className="flex gap-2">
                <input
                  value={chatInput}
                  onChange={(e) => setChatInput(e.target.value)}
                  placeholder="Message the room…"
                  maxLength={240}
                  autoComplete="off"
                  className="min-w-0 flex-1 rounded-xl border border-border bg-base px-3 py-2.5 text-sm text-text placeholder:text-muted outline-none focus:border-accent/60"
                />
                <Button type="submit" variant="teal" disabled={!chatInput.trim()} className="shrink-0 px-3">
                  <Send size={16} />
                </Button>
              </div>
            </form>
          )}
        </aside>
      </div>

      <MobileChatFloatingToasts
        messages={messages}
        expanded={mobileChatOpen}
        enabled={!isSpectator}
        theme="shell"
      />

      <MobileChatDock
        title="Chat"
        subtitle="Tap ↑ for history"
        expanded={mobileChatOpen}
        onExpandedChange={setMobileChatOpen}
        scrollToBottomKey={scrollKey}
        endAccessory={
          lgUp ? undefined : (
            <RoomVoiceDock
              roomCode={roomCode}
              myPlayerId={playerId}
              players={players.map((p) => ({ id: p.id, displayName: p.displayName }))}
            />
          )
        }
        messages={<div className="space-y-2">{whoamiChatMessageList}</div>}
        composer={
          isSpectator ? (
            <div className="rounded-xl border border-border bg-base px-2 py-2 text-center text-[10px] leading-snug text-muted">
              Spectating. Chat when the next match starts.
            </div>
          ) : (
            <form
              className="flex w-full gap-2"
              onSubmit={(e) => {
                e.preventDefault()
                sendChat()
              }}
            >
              <input
                value={chatInput}
                onChange={(e) => setChatInput(e.target.value)}
                placeholder="Message the room…"
                maxLength={240}
                autoComplete="off"
                className="min-w-0 flex-1 rounded-xl border border-border bg-base px-3 py-2.5 text-sm text-text placeholder:text-muted outline-none focus:border-accent/60"
              />
              <Button type="submit" variant="teal" size="md" className="shrink-0 px-3" disabled={!chatInput.trim()}>
                <Send size={16} />
              </Button>
            </form>
          )
        }
      />
    </div>
  )
}
