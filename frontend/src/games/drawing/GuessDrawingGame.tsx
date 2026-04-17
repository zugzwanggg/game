import { ArrowLeft, Eraser, Send, Undo2 } from 'lucide-react'
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { MobileChatDock, MOBILE_CHAT_DOCK_PAD_CLASS } from '../../components/chat/MobileChatDock'
import Button from '../../components/ui/Button'
import { RoomPresenceBanner } from '../../components/ui/RoomPresenceBanner'
import { RoomVoiceDock } from '../../components/voice/RoomVoiceDock'
import { chatListScrollKey, useChatScrollToBottom } from '../../hooks/useChatScrollToBottom'
import { useRoomPresenceNotification } from '../../hooks/useRoomPresenceNotification'
import { playCorrectGuessSfx } from '../../lib/playCorrectGuessSfx'
import { removeRecentRoom } from '../../lib/recentRooms'
import { getSocket } from '../../lib/socket'
import { joinRoom } from '../../lib/roomJoin'
import drawingGameBg from '../../assets/game-backgrounds/drawing_bg.png'
import { normalizeGuess, pickRandomWord } from './words'

type Role = 'drawer' | 'guesser'

/** After draw time runs out: show the word, then switch to guesser after a short delay. */
type DrawerTurnPhase = 'drawing' | 'reveal'

type GamePhase = 'playing' | 'leaderboard'

/** Normalized to the canvas CSS box: x,y in [0, 1]. Shared across all clients/screen sizes. */
type Point = { x: number; y: number }

type Stroke = {
  id: string
  points: Point[]
  color: string
  /** Line thickness as a fraction of `min(canvasCssWidth, canvasCssHeight)` (same visual weight on any device). */
  widthNorm: number
}

type ChatMessage = {
  id: string
  author: string
  text: string
  variant: 'chat' | 'system' | 'correct'
}

const CHAT_AUTHOR_COLOR_CLASSES = [
  'text-violet-700',
  'text-teal-700',
  'text-rose-700',
  'text-amber-700',
  'text-sky-700',
  'text-fuchsia-700',
  'text-emerald-700',
  'text-orange-700',
  'text-indigo-700',
  'text-cyan-700',
] as const

function hashString(s: string): number {
  let h = 0
  for (let i = 0; i < s.length; i++) h = (Math.imul(31, h) + s.charCodeAt(i)) | 0
  return Math.abs(h)
}

function chatAuthorNameClass(author: string, variant: ChatMessage['variant']): string {
  if (variant === 'system' || author === 'Game') return 'text-zinc-500'
  return CHAT_AUTHOR_COLOR_CLASSES[hashString(author) % CHAT_AUTHOR_COLOR_CLASSES.length]
}

const BRUSH_COLORS = [
  { label: 'Black', hex: '#000000' },
  { label: 'Violet', hex: '#7B61FF' },
  { label: 'Teal', hex: '#00D4AA' },
  { label: 'Fuchsia', hex: '#E040FB' },
  { label: 'Amber', hex: '#FFB800' },
  { label: 'Coral', hex: '#FF6B6B' },
  { label: 'Sky', hex: '#64B5F6' },
  { label: 'Lime', hex: '#C5E063' },
] as const

const DEFAULT_BRUSH = BRUSH_COLORS[0].hex

function hexForColorInput(hex: string): string {
  if (/^#[0-9A-Fa-f]{6}$/.test(hex)) return hex
  if (/^#[0-9A-Fa-f]{3}$/.test(hex)) {
    const h = hex.slice(1)
    return `#${h[0]}${h[0]}${h[1]}${h[1]}${h[2]}${h[2]}`
  }
  return DEFAULT_BRUSH
}

/** Pencil density (canvas line width in CSS pixels). */
const BRUSH_WEIGHTS = [
  { label: 'Thin', width: 2 },
  { label: 'Med', width: 4 },
  { label: 'Thick', width: 8 },
] as const

const DEFAULT_BRUSH_WIDTH = BRUSH_WEIGHTS[1].width

/** Drawer may draw for this many seconds per round; then play switches to guessing. */
const DRAWER_TIME_SEC = 60

/** How long the word stays visible after time runs out before switching to guesser. */
const REVEAL_AFTER_TIMEUP_SEC = 5

const MAX_ROUNDS = 3

const POINTS_CORRECT_GUESS = 100

function formatDrawerCountdown(totalSeconds: number) {
  const m = Math.floor(totalSeconds / 60)
  const s = totalSeconds % 60
  return `${m}:${s.toString().padStart(2, '0')}`
}

function clamp01(n: number) {
  if (!Number.isFinite(n)) return 0
  return Math.min(1, Math.max(0, n))
}

/** Let browser handle Ctrl+Z only for real text fields — not color/range/checkbox inputs. */
function strokeUndoShouldYieldToField(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null
  if (!el) return false
  if (el.closest('[contenteditable="true"]')) return true
  if (el.closest('textarea')) return true
  const input = el.closest('input')
  if (!input) return false
  const type = (input as HTMLInputElement).type
  if (
    type === 'color' ||
    type === 'range' ||
    type === 'checkbox' ||
    type === 'radio' ||
    type === 'button' ||
    type === 'submit' ||
    type === 'reset' ||
    type === 'file' ||
    type === 'hidden'
  )
    return false
  return true
}

/** `cssW` / `cssH` = canvas size in CSS pixels (same space as stored normalized points). */
function drawStroke(
  ctx: CanvasRenderingContext2D,
  points: Point[],
  color: string,
  widthNorm: number,
  cssW: number,
  cssH: number,
) {
  if (points.length < 2) return
  const m = Math.min(cssW, cssH)
  ctx.strokeStyle = color
  ctx.lineWidth = Math.max(0.75, widthNorm * m)
  ctx.lineCap = 'round'
  ctx.lineJoin = 'round'
  ctx.beginPath()
  ctx.moveTo(points[0].x * cssW, points[0].y * cssH)
  for (let i = 1; i < points.length; i++) {
    ctx.lineTo(points[i].x * cssW, points[i].y * cssH)
  }
  ctx.stroke()
}

/** Accept new normalized strokes; drop legacy pixel-based strokes from older clients. */
function parseStroke(raw: unknown): Stroke | null {
  if (!raw || typeof raw !== 'object') return null
  const o = raw as Record<string, unknown>
  if (typeof o.id !== 'string' || !Array.isArray(o.points) || o.points.length < 2) return null
  const color = typeof o.color === 'string' ? o.color : DEFAULT_BRUSH
  let widthNorm: number | undefined
  if (typeof o.widthNorm === 'number' && o.widthNorm > 0 && o.widthNorm <= 1) {
    widthNorm = o.widthNorm
  }
  if (widthNorm === undefined) return null
  const pts: Point[] = []
  for (const p of o.points) {
    if (!p || typeof p !== 'object') return null
    const rec = p as Record<string, unknown>
    const x = Number(rec.x)
    const y = Number(rec.y)
    if (!Number.isFinite(x) || !Number.isFinite(y)) return null
    if (x > 1.001 || y > 1.001 || x < -0.001 || y < -0.001) return null
    pts.push({ x: clamp01(x), y: clamp01(y) })
  }
  return { id: o.id, points: pts, color, widthNorm }
}

export default function GuessDrawingGame() {
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const roomCode = searchParams.get('room')
  const isOnline = Boolean(roomCode)

  const [secretWord, setSecretWord] = useState(() => pickRandomWord())
  const [playerId, setPlayerId] = useState<string | null>(null)
  const [drawerWord, setDrawerWord] = useState<string | null>(null)
  const [revealedWord, setRevealedWord] = useState<string | null>(null)
  const [onlineStatus, setOnlineStatus] = useState<
    'lobby' | 'playing' | 'reveal' | 'leaderboard' | null
  >(null)
  const [solvedByName, setSolvedByName] = useState<string | null>(null)
  const [playerCount, setPlayerCount] = useState<number | null>(null)
  const [voicePlayers, setVoicePlayers] = useState<{ id: string; displayName: string }[]>([])

  const { payload: presencePayload, handlePlayersSnapshot, dismiss: dismissPresence } =
    useRoomPresenceNotification(isOnline && roomCode ? roomCode : null)

  const [brushColor, setBrushColor] = useState<string>(DEFAULT_BRUSH)
  const brushColorRef = useRef(brushColor)
  const [brushWidth, setBrushWidth] = useState<number>(DEFAULT_BRUSH_WIDTH)
  const brushWidthRef = useRef(brushWidth)

  const [role, setRole] = useState<Role>('drawer')
  const [strokes, setStrokes] = useState<Stroke[]>([])
  const [draftPoints, setDraftPoints] = useState<Point[]>([])
  const drawingRef = useRef(false)
  const [messages, setMessages] = useState<ChatMessage[]>(() => [
    {
      id: 'sys-0',
      author: 'Game',
      text: `Best of ${MAX_ROUNDS} rounds. Each correct guess scores +${POINTS_CORRECT_GUESS} for Guesser. After each round you’ll see the leaderboard. (Use “Guessing” to practice locally.)`,
      variant: 'system',
    },
  ])
  const [guessInput, setGuessInput] = useState('')
  const [mobileGuessesOpen, setMobileGuessesOpen] = useState(false)
  const [roundSolved, setRoundSolved] = useState(false)
  const [gamePhase, setGamePhase] = useState<GamePhase>('playing')
  const [activeRound, setActiveRound] = useState(1)
  const [scores, setScores] = useState<Record<string, number>>({})
  const [drawerTurnPhase, setDrawerTurnPhase] = useState<DrawerTurnPhase>('drawing')
  const [drawerSecondsLeft, setDrawerSecondsLeft] = useState(DRAWER_TIME_SEC)
  const [revealSecondsLeft, setRevealSecondsLeft] = useState(REVEAL_AFTER_TIMEUP_SEC)

  const canvasRef = useRef<HTMLCanvasElement>(null)
  const wrapRef = useRef<HTMLDivElement>(null)
  const strokesRef = useRef(strokes)
  const draftRef = useRef(draftPoints)
  const timeUpHandledRef = useRef(false)

  useLayoutEffect(() => {
    strokesRef.current = strokes
    draftRef.current = draftPoints
    brushColorRef.current = brushColor
    brushWidthRef.current = brushWidth
  }, [strokes, draftPoints, brushColor, brushWidth])

  // Online mode: hydrate from Socket.IO room state.
  useEffect(() => {
    if (!isOnline || !roomCode) return
    const socket = getSocket()
    if (!socket.connected) socket.connect()

    void joinRoom(roomCode).then(({ player }) => {
      if (player?.id) setPlayerId(String(player.id))
    })

    const onState = (state: any) => {
      if (String(state?.code ?? '').toUpperCase() !== roomCode.toUpperCase()) return
      const dg = state?.drawingGame
      if (dg) {
        setOnlineStatus(
          dg.status === 'lobby' ||
            dg.status === 'playing' ||
            dg.status === 'reveal' ||
            dg.status === 'leaderboard'
            ? dg.status
            : null,
        )
        setDrawerTurnPhase(dg.status === 'reveal' ? 'reveal' : 'drawing')
        setDrawerSecondsLeft(Number(state?.timers?.drawSecLeft ?? DRAWER_TIME_SEC))
        setRevealSecondsLeft(Number(state?.timers?.revealSecLeft ?? REVEAL_AFTER_TIMEUP_SEC))
        if (dg.status === 'playing') setRevealedWord(null)
        setGamePhase(dg.status === 'leaderboard' ? 'leaderboard' : 'playing')
        if (typeof dg.matchRound === 'number') setActiveRound(dg.matchRound)
        if (dg.scores && typeof dg.scores === 'object') setScores(dg.scores as Record<string, number>)
        if (dg.drawerPlayerId && playerId) {
          setRole(dg.drawerPlayerId === playerId ? 'drawer' : 'guesser')
        }
        // Keep a placeholder hint as "secretWord" in UI for non-drawer contexts.
        if (typeof dg.wordHint === 'string') setSecretWord(dg.wordHint)
      }
      if (Array.isArray(state?.players)) {
        setPlayerCount(state.players.length)
        const vp = (state.players as { id: string; displayName?: string }[]).map((p) => ({
          id: String(p.id),
          displayName: String(p.displayName ?? 'Player'),
        }))
        setVoicePlayers(vp)
        handlePlayersSnapshot(vp)
      }
      if (state?.drawingGame?.solvedByPlayerId && Array.isArray(state?.players)) {
        const pid = String(state.drawingGame.solvedByPlayerId)
        const p = state.players.find((x: any) => String(x.id) === pid)
        setSolvedByName(p ? String(p.displayName ?? 'Player') : 'Player')
      } else if (dg?.status === 'playing') {
        setSolvedByName(null)
      }
      if (state?.drawing?.strokes)
        setStrokes(
          (state.drawing.strokes as unknown[]).map(parseStroke).filter((s): s is Stroke => s !== null),
        )
      if (Array.isArray(state?.chat)) {
        setMessages(
          state.chat.map((m: any) => ({
            id: String(m.id ?? crypto.randomUUID()),
            author: String(m.author ?? 'Player'),
            text: String(m.text ?? ''),
            variant:
              m.variant === 'system' || String(m.author ?? '') === 'Game'
                ? 'system'
                : m.variant === 'correct'
                  ? 'correct'
                : 'chat',
          })),
        )
      }
    }

    const onStroke = (s: unknown) => {
      const stroke = parseStroke(s)
      if (!stroke) return
      setStrokes((prev) => [...prev, stroke])
    }
    const onClear = () => setStrokes([])
    const onUndo = () => {
      setStrokes((prev) => (prev.length ? prev.slice(0, -1) : prev))
    }
    const onChat = (m: any) => {
      const variant =
        m.variant === 'system' || m.author === 'Game'
          ? 'system'
          : m.variant === 'correct'
            ? 'correct'
            : 'chat'
      if (variant === 'correct') {
        playCorrectGuessSfx()
      }
      setMessages((prev) => [
        ...prev,
        {
          id: String(m.id ?? crypto.randomUUID()),
          author: String(m.author ?? 'Player'),
          text: String(m.text ?? ''),
          variant,
        },
      ])
    }
    const onChatClear = () => setMessages([])
    const onWord = (p: any) => setDrawerWord(String(p?.word ?? ''))
    const onReveal = (p: any) => setRevealedWord(String(p?.word ?? ''))

    socket.on('room:state', onState)
    socket.on('drawing:stroke', onStroke)
    socket.on('drawing:undo', onUndo)
    socket.on('drawing:clear', onClear)
    socket.on('chat:message', onChat)
    socket.on('chat:clear', onChatClear)
    socket.on('game:drawing:word', onWord)
    socket.on('game:drawing:reveal', onReveal)

    return () => {
      socket.off('room:state', onState)
      socket.off('drawing:stroke', onStroke)
      socket.off('drawing:undo', onUndo)
      socket.off('drawing:clear', onClear)
      socket.off('chat:message', onChat)
      socket.off('chat:clear', onChatClear)
      socket.off('game:drawing:word', onWord)
      socket.off('game:drawing:reveal', onReveal)
    }
  }, [isOnline, roomCode, playerId, handlePlayersSnapshot])

  const paint = useCallback(() => {
    const canvas = canvasRef.current
    const wrap = wrapRef.current
    if (!canvas || !wrap) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    const w = wrap.clientWidth
    const h = wrap.clientHeight
    if (w < 4 || h < 4) return

    const dpr = window.devicePixelRatio || 1
    const nextW = Math.floor(w * dpr)
    const nextH = Math.floor(h * dpr)
    if (canvas.width !== nextW || canvas.height !== nextH) {
      canvas.width = nextW
      canvas.height = nextH
      canvas.style.width = `${w}px`
      canvas.style.height = `${h}px`
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)

    ctx.fillStyle = '#ffffff'
    ctx.fillRect(0, 0, w, h)

    for (const s of strokesRef.current) {
      drawStroke(ctx, s.points, s.color, s.widthNorm, w, h)
    }
    if (draftRef.current.length > 1) {
      const m = Math.min(w, h)
      const draftNorm = Math.min(1, brushWidthRef.current / m)
      drawStroke(ctx, draftRef.current, brushColorRef.current, draftNorm, w, h)
    }
  }, [])

  useEffect(() => {
    paint()
  }, [paint, strokes, draftPoints, brushColor, brushWidth])

  useEffect(() => {
    const wrap = wrapRef.current
    if (!wrap) return
    const ro = new ResizeObserver(() => paint())
    ro.observe(wrap)
    return () => ro.disconnect()
  }, [paint])

  /** Canvas-local coordinates in 0..1 (same on phone and desktop once rendered). */
  const clientToNorm = useCallback((e: ReactPointerEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current
    if (!canvas) return { x: 0, y: 0 }
    const rect = canvas.getBoundingClientRect()
    if (rect.width < 1 || rect.height < 1) return { x: 0, y: 0 }
    return {
      x: clamp01((e.clientX - rect.left) / rect.width),
      y: clamp01((e.clientY - rect.top) / rect.height),
    }
  }, [])

  const commitDraft = useCallback(() => {
    setDraftPoints((pts) => {
      if (pts.length > 1) {
        const wrap = wrapRef.current
        const cw = wrap?.clientWidth ?? 1
        const ch = wrap?.clientHeight ?? 1
        const m = Math.min(cw, ch)
        const color = brushColorRef.current
        const widthNorm = Math.min(1, brushWidthRef.current / m)
        const stroke: Stroke = {
          id: crypto.randomUUID(),
          points: pts,
          color,
          widthNorm,
        }
        setStrokes((prev) => [...prev, stroke])
        if (isOnline && roomCode) {
          const socket = getSocket()
          socket.emit('drawing:stroke', stroke)
        }
      }
      return []
    })
  }, [isOnline, roomCode])

  const becomeGuesserFromDrawer = useCallback(() => {
    drawingRef.current = false
    commitDraft()
    setRole('guesser')
  }, [commitDraft])

  const startFreshWordRound = useCallback(() => {
    drawingRef.current = false
    timeUpHandledRef.current = false
    setDrawerTurnPhase('drawing')
    setSecretWord(pickRandomWord())
    setStrokes([])
    setDraftPoints([])
    setRoundSolved(false)
    setGuessInput('')
    setRole('drawer')
  }, [])

  const dismissLeaderboardAndContinue = () => {
    if (isOnline) return
    const wasFinalRound = activeRound >= MAX_ROUNDS
    if (wasFinalRound) {
      setActiveRound(1)
      setScores({ drawer: 0, guesser: 0 })
      setMessages((m) => [
        ...m,
        {
          id: crypto.randomUUID(),
          author: 'Game',
          text: `New match, round 1/${MAX_ROUNDS}. Scores reset.`,
          variant: 'system',
        },
      ])
    } else {
      const next = activeRound + 1
      setActiveRound(next)
      setMessages((m) => [
        ...m,
        {
          id: crypto.randomUUID(),
          author: 'Game',
          text: `Round ${next}/${MAX_ROUNDS}: draw the next word.`,
          variant: 'system',
        },
      ])
    }
    setGamePhase('playing')
    startFreshWordRound()
  }

  useEffect(() => {
    if (isOnline) return
    if (
      role === 'drawer' &&
      !roundSolved &&
      drawerTurnPhase === 'drawing' &&
      gamePhase === 'playing'
    ) {
      setDrawerSecondsLeft(DRAWER_TIME_SEC)
    }
  }, [role, roundSolved, secretWord, drawerTurnPhase, gamePhase])

  useEffect(() => {
    if (isOnline) return
    if (drawerSecondsLeft > 0) timeUpHandledRef.current = false
  }, [drawerSecondsLeft])

  useEffect(() => {
    if (isOnline) return
    if (
      roundSolved ||
      drawerTurnPhase !== 'drawing' ||
      gamePhase !== 'playing'
    )
      return
    const id = window.setInterval(() => {
      setDrawerSecondsLeft((s) => (s <= 1 ? 0 : s - 1))
    }, 1000)
    return () => window.clearInterval(id)
  }, [roundSolved, secretWord, drawerTurnPhase, gamePhase])

  useEffect(() => {
    if (isOnline) return
    if (
      drawerSecondsLeft > 0 ||
      roundSolved ||
      drawerTurnPhase !== 'drawing' ||
      gamePhase !== 'playing'
    )
      return
    if (timeUpHandledRef.current) return
    timeUpHandledRef.current = true
    drawingRef.current = false
    commitDraft()
    setMessages((m) => [
      ...m,
      {
        id: crypto.randomUUID(),
        author: 'Game',
        text: `Time's up (${DRAWER_TIME_SEC}s). The word is shown for ${REVEAL_AFTER_TIMEUP_SEC} seconds, then you switch to Guessing.`,
        variant: 'system',
      },
    ])
    setDrawerTurnPhase('reveal')
  }, [
    drawerSecondsLeft,
    roundSolved,
    drawerTurnPhase,
    gamePhase,
    commitDraft,
  ])

  useEffect(() => {
    if (isOnline) return
    if (
      drawerTurnPhase !== 'reveal' ||
      roundSolved ||
      gamePhase !== 'playing'
    )
      return

    setRevealSecondsLeft(REVEAL_AFTER_TIMEUP_SEC)
    const start = Date.now()
    const tickId = window.setInterval(() => {
      const next = Math.max(
        0,
        REVEAL_AFTER_TIMEUP_SEC - Math.floor((Date.now() - start) / 1000),
      )
      setRevealSecondsLeft(next)
    }, 200)
    const doneId = window.setTimeout(() => {
      window.clearInterval(tickId)
      setMessages((m) => [
        ...m,
        {
          id: crypto.randomUUID(),
          author: 'Game',
          text: 'You are now guessing. Type your guess in chat.',
          variant: 'system',
        },
      ])
      if (role === 'drawer') becomeGuesserFromDrawer()
      setDrawerTurnPhase('drawing')
    }, REVEAL_AFTER_TIMEUP_SEC * 1000)

    return () => {
      window.clearInterval(tickId)
      window.clearTimeout(doneId)
    }
  }, [drawerTurnPhase, role, roundSolved, gamePhase, becomeGuesserFromDrawer])

  const onPointerDown = (e: ReactPointerEvent<HTMLCanvasElement>) => {
    if (
      gamePhase !== 'playing' ||
      role !== 'drawer' ||
      roundSolved ||
      drawerTurnPhase !== 'drawing'
    )
      return
    e.currentTarget.setPointerCapture(e.pointerId)
    e.currentTarget.focus()
    drawingRef.current = true
    setDraftPoints([clientToNorm(e)])
  }

  const onPointerMove = (e: ReactPointerEvent<HTMLCanvasElement>) => {
    if (
      gamePhase !== 'playing' ||
      role !== 'drawer' ||
      !drawingRef.current ||
      roundSolved ||
      drawerTurnPhase !== 'drawing'
    )
      return
    setDraftPoints((prev) => [...prev, clientToNorm(e)])
  }

  const onPointerUp = (e: ReactPointerEvent<HTMLCanvasElement>) => {
    if (
      gamePhase !== 'playing' ||
      role !== 'drawer' ||
      !drawingRef.current ||
      drawerTurnPhase !== 'drawing'
    )
      return
    drawingRef.current = false
    try {
      e.currentTarget.releasePointerCapture(e.pointerId)
    } catch {
      /* ignore */
    }
    commitDraft()
  }

  const clearCanvas = () => {
    if (gamePhase !== 'playing') return
    setStrokes([])
    setDraftPoints([])
  }

  const undoDrawing = useCallback(() => {
    if (
      gamePhase !== 'playing' ||
      role !== 'drawer' ||
      roundSolved ||
      drawerTurnPhase !== 'drawing'
    )
      return
    const hasDraft =
      drawingRef.current || draftRef.current.length > 0
    if (hasDraft) {
      drawingRef.current = false
      setDraftPoints([])
      return
    }
    if (isOnline && roomCode) {
      getSocket().emit('drawing:undo')
      return
    }
    setStrokes((prev) => (prev.length ? prev.slice(0, -1) : prev))
  }, [gamePhase, role, roundSolved, drawerTurnPhase, isOnline, roomCode])

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (
        gamePhase !== 'playing' ||
        role !== 'drawer' ||
        roundSolved ||
        drawerTurnPhase !== 'drawing'
      )
        return
      if (strokeUndoShouldYieldToField(e.target)) return
      const mod = e.ctrlKey || e.metaKey
      if (mod && e.key.toLowerCase() === 'z' && !e.shiftKey) {
        e.preventDefault()
        undoDrawing()
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [gamePhase, role, roundSolved, drawerTurnPhase, undoDrawing])

  const guessesMessageList = useMemo(
    () =>
      messages.map((m) => (
        <div
          key={m.id}
          className={`rounded-lg px-3 py-2 text-sm ${
            m.variant === 'system'
              ? 'border border-zinc-200 bg-zinc-50 text-zinc-600'
              : m.variant === 'correct'
                ? 'border border-teal-200 bg-teal-50 font-semibold text-teal-700 shadow-sm'
                : 'border border-zinc-100 bg-white text-zinc-800 shadow-sm'
          }`}
        >
          <span className={`text-xs font-semibold ${chatAuthorNameClass(m.author, m.variant)}`}>
            {m.author}
          </span>
          <p className="mt-0.5 wrap-break-word">{m.text}</p>
        </div>
      )),
    [messages],
  )

  const guessesScrollKey = useMemo(() => chatListScrollKey(messages), [messages])
  const guessesListRef = useChatScrollToBottom(guessesScrollKey)

  useEffect(() => {
    if (gamePhase === 'leaderboard') setMobileGuessesOpen(false)
  }, [gamePhase])

  const sendGuess = (e: React.FormEvent) => {
    e.preventDefault()
    const text = guessInput.trim()
    if (!text || role !== 'guesser' || gamePhase !== 'playing') return

    if (isOnline && roomCode) {
      const socket = getSocket()
      socket.emit('chat:message', { text })
      setGuessInput('')
      return
    }

    const correct = normalizeGuess(text) === normalizeGuess(secretWord)
    setMessages((m) => [
      ...m,
      {
        id: crypto.randomUUID(),
        author: 'You',
        text,
        variant: correct ? 'correct' : 'chat',
      },
    ])
    setGuessInput('')

    if (correct && !roundSolved) {
      playCorrectGuessSfx()
      setRoundSolved(true)
      setScores((s) => ({ ...s, guesser: s.guesser + POINTS_CORRECT_GUESS }))
      setMessages((m) => [
        ...m,
        {
          id: crypto.randomUUID(),
          author: 'Game',
          text: `Correct! +${POINTS_CORRECT_GUESS} to Guesser.`,
          variant: 'system',
        },
      ])
      setGamePhase('leaderboard')
    }
  }

  /** Online: go to game hub, not `/room/...`, or joinRoom runs and you re-enter the room (and may redirect to play). */
  const backTarget = '/games/drawing'

  return (
    <div className="relative isolate flex h-full min-h-0 flex-1 flex-col overflow-hidden">
      <div className="pointer-events-none absolute inset-0 -z-10" aria-hidden>
        <div
          className="absolute inset-0"
          style={{
            backgroundImage: `url(${drawingGameBg})`,
            backgroundRepeat: 'repeat',
            backgroundSize: 'clamp(15rem, 38vw, 24rem)',
          }}
        />
        <div className="absolute inset-0 bg-gradient-to-b from-white/10 via-transparent to-white/15" />
      </div>

      <div className="relative flex min-h-0 flex-1 flex-col overflow-hidden px-4 py-4 text-zinc-900 sm:px-6 sm:py-5 lg:min-h-0">
      <RoomPresenceBanner
        message={presencePayload?.text ?? null}
        kind={presencePayload?.kind ?? null}
        onDismiss={dismissPresence}
      />
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={() => {
            if (isOnline && roomCode) {
              const socket = getSocket()
              if (socket.connected) socket.emit('room:leave')
              removeRecentRoom(roomCode)
            }
            void navigate(backTarget)
          }}
          className="flex items-center gap-2 rounded-lg border border-zinc-200/90 bg-white/95 px-2 py-1.5 text-sm text-zinc-600 shadow-sm backdrop-blur-sm transition-all duration-150 hover:border-accent/40 hover:bg-white hover:text-zinc-900 hover:shadow-lg hover:ring-2 hover:ring-accent/20 active:scale-[0.98]"
        >
          <ArrowLeft size={15} /> Back
        </button>
        {isOnline && playerCount !== null && (
          <span className="rounded-lg border border-zinc-200/90 bg-white/95 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-zinc-500 shadow-sm backdrop-blur-sm">
            {playerCount} players
          </span>
        )}
        {roomCode && (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="!border-zinc-200/90 !bg-white/95 !text-zinc-700 shadow-sm transition-all duration-150 hover:!border-accent/40 hover:!bg-white hover:!text-zinc-900 hover:!shadow-lg hover:ring-2 hover:ring-accent/20 active:scale-[0.98]"
            onClick={() => {
              const socket = getSocket()
              socket.emit('room:leave')
              removeRecentRoom(roomCode)
              void navigate('/games')
            }}
          >
            Quit room
          </Button>
        )}
      </div>

      <div className="mb-4 max-w-md">
        {isOnline && roomCode && playerId ? (
          <RoomVoiceDock
            roomCode={roomCode}
            myPlayerId={playerId}
            players={voicePlayers}
          />
        ) : (
          <div className="rounded-xl border border-zinc-200/90 bg-white/95 px-3 py-2.5 text-sm text-zinc-600 shadow-sm backdrop-blur-sm">
            Room voice is available when you play online in a shared room.
          </div>
        )}
      </div>

      <div
        className={`grid min-h-0 flex-1 grid-cols-1 gap-4 overflow-hidden lg:grid-cols-5 lg:gap-6 ${MOBILE_CHAT_DOCK_PAD_CLASS}`}
      >
        <section className="flex min-h-0 min-w-0 flex-col overflow-hidden lg:col-span-3">
          <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
            <div className="flex flex-wrap items-center gap-3">
              <h1 className="text-lg font-extrabold tracking-tight text-white drop-shadow-[0_1px_4px_rgba(0,0,0,0.55)] sm:text-xl">
                Guess the Drawing
              </h1>
              <span className="rounded-lg border border-zinc-200/90 bg-white/95 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-zinc-500 shadow-sm backdrop-blur-sm">
                Round {activeRound}/{MAX_ROUNDS}
              </span>
              {!roundSolved &&
                drawerTurnPhase === 'drawing' &&
                gamePhase === 'playing' &&
                (!isOnline || onlineStatus === 'playing') && (
                <span
                  className={`rounded-lg border px-2.5 py-1 font-mono text-xs font-bold tabular-nums shadow-sm backdrop-blur-sm ${
                    drawerSecondsLeft <= 10
                      ? 'border-amber-300 bg-amber-50 text-amber-800'
                      : 'border-zinc-200/90 bg-white/95 text-zinc-600'
                  }`}
                  title="Time left in this round"
                >
                  {formatDrawerCountdown(drawerSecondsLeft)}
                </span>
              )}
            </div>
            {role === 'drawer' &&
              !roundSolved &&
              drawerTurnPhase === 'drawing' && (
              <div className="flex gap-2">
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="gap-1.5 !border-zinc-200/90 !bg-white/95 !text-zinc-700 shadow-sm transition-all duration-150 hover:!border-zinc-300 hover:!bg-white hover:!text-zinc-900 hover:shadow-md active:scale-[0.98]"
                  title="Undo last stroke (Ctrl+Z or ⌘Z)"
                  aria-keyshortcuts="Control+Z Meta+Z"
                  disabled={strokes.length === 0 && draftPoints.length === 0}
                  onClick={undoDrawing}
                >
                  <Undo2 size={14} /> Undo
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="gap-1.5 !border-zinc-200/90 !bg-white/95 !text-zinc-700 shadow-sm transition-all duration-150 hover:!border-zinc-300 hover:!bg-white hover:!text-zinc-900 hover:shadow-md active:scale-[0.98]"
                  onClick={clearCanvas}
                >
                  <Eraser size={14} /> Clear
                </Button>
              </div>
            )}
          </div>

          {role === 'drawer' &&
            !roundSolved &&
            drawerTurnPhase === 'drawing' && (
            <div className="mb-2 flex flex-col gap-2 rounded-xl border border-zinc-200/90 bg-white/95 p-2 shadow-sm sm:flex-row sm:flex-wrap sm:items-center">
              <div className="flex flex-wrap items-center gap-2">
                <span className="shrink-0 text-[10px] font-semibold uppercase tracking-wider text-zinc-500">
                  Color
                </span>
                <div className="flex flex-wrap items-center gap-1.5">
                  {BRUSH_COLORS.map((c) => (
                    <button
                      key={c.hex}
                      type="button"
                      title={c.label}
                      aria-label={`${c.label} brush color`}
                      aria-pressed={brushColor === c.hex}
                      onClick={() => setBrushColor(c.hex)}
                      className={`h-7 w-7 rounded-full border-2 transition-all duration-150 hover:scale-105 ${
                        brushColor === c.hex
                          ? 'scale-110 border-zinc-400 shadow-glow-accent ring-2 ring-accent'
                          : 'border-zinc-200 hover:border-zinc-400 hover:ring-2 hover:ring-white/60'
                      }`}
                      style={{ backgroundColor: c.hex }}
                    />
                  ))}
                  <label
                    className={`relative flex h-7 w-7 shrink-0 cursor-pointer items-center justify-center overflow-hidden rounded-full border-2 transition-all duration-150 hover:scale-105 hover:border-zinc-400 hover:ring-2 hover:ring-white/60 ${
                      BRUSH_COLORS.some((c) => c.hex === brushColor)
                        ? 'border-zinc-200'
                        : 'scale-110 border-zinc-400 shadow-glow-accent ring-2 ring-accent'
                    }`}
                    title="Custom color"
                  >
                    <span className="sr-only">Custom color</span>
                    <input
                      type="color"
                      value={hexForColorInput(brushColor)}
                      onChange={(e) => setBrushColor(e.target.value)}
                      className="absolute inset-0 h-full w-full cursor-pointer opacity-0"
                      aria-label="Custom brush color"
                    />
                    <span
                      className="pointer-events-none absolute inset-0 rounded-full"
                      style={{ backgroundColor: brushColor }}
                    />
                  </label>
                </div>
              </div>
              <div className="flex flex-wrap items-center gap-2 border-t border-zinc-200 pt-2 sm:border-l sm:border-t-0 sm:pl-3 sm:pt-0">
                <span className="shrink-0 text-[10px] font-semibold uppercase tracking-wider text-zinc-500">
                  Line
                </span>
                <div className="flex gap-1">
                  {BRUSH_WEIGHTS.map((w) => (
                    <button
                      key={w.label}
                      type="button"
                      aria-label={`${w.label} line`}
                      aria-pressed={brushWidth === w.width}
                      onClick={() => setBrushWidth(w.width)}
                      className={`flex h-8 min-w-13 flex-col items-center justify-center gap-0.5 rounded-lg border px-1.5 py-0.5 text-[9px] font-bold transition-all duration-150 active:scale-95 ${
                        brushWidth === w.width
                          ? 'border-accent/50 bg-accent/10 text-accent shadow-[0_0_12px_rgba(123,97,255,0.2)] hover:border-accent/60 hover:bg-accent/15'
                          : 'border-zinc-200 bg-zinc-50 text-zinc-600 hover:border-zinc-300 hover:bg-white hover:text-zinc-900 hover:shadow-sm'
                      }`}
                    >
                      <span
                        className="w-7 rounded-full bg-current"
                        style={{ height: Math.max(2, w.width * 0.35) }}
                      />
                      {w.label}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          )}

          <div
            ref={wrapRef}
            className={`relative min-h-70 flex-1 overflow-hidden rounded-2xl border border-zinc-200/90 bg-white shadow-[inset_0_1px_0_0_rgba(255,255,255,1),0_1px_3px_rgba(0,0,0,0.06)] sm:min-h-90 ${
              role === 'drawer' &&
              !roundSolved &&
              drawerTurnPhase === 'drawing'
                ? 'cursor-crosshair'
                : 'cursor-default'
            }`}
          >
            <canvas
              ref={canvasRef}
              tabIndex={-1}
              className="absolute inset-0 touch-none outline-none focus-visible:ring-2 focus-visible:ring-accent/40"
              onPointerDown={onPointerDown}
              onPointerMove={onPointerMove}
              onPointerUp={onPointerUp}
              onPointerCancel={onPointerUp}
              style={{
                pointerEvents:
                  role === 'drawer' &&
                  !roundSolved &&
                  drawerTurnPhase === 'drawing'
                    ? 'auto'
                    : 'none',
              }}
            />
            {role === 'drawer' &&
              !roundSolved &&
              drawerTurnPhase === 'drawing' && (
              <div className="pointer-events-none absolute right-2 top-2 z-10 max-w-[42%] rounded-md border border-accent/30 bg-white/95 px-2 py-1 shadow-md backdrop-blur-sm">
                <p className="text-[8px] font-semibold uppercase tracking-widest text-accent">
                  Word
                </p>
                <p className="truncate font-mono text-xs font-bold leading-tight tracking-wide text-zinc-900 sm:text-sm">
                  {isOnline ? drawerWord ?? '...' : secretWord}
                </p>
                <p className="mt-0.5 text-[8px] leading-tight text-zinc-500">
                  Don&apos;t type in chat
                </p>
              </div>
            )}
            {!roundSolved &&
              drawerTurnPhase === 'reveal' &&
              (!isOnline || onlineStatus === 'reveal') && (
              <div className="absolute inset-0 z-30 flex flex-col items-center justify-center gap-3 bg-white/95 px-6 text-center shadow-inner backdrop-blur-sm">
                <p className="text-xs font-semibold uppercase tracking-widest text-zinc-500">
                  {isOnline && solvedByName
                    ? `${solvedByName} guessed it!`
                    : "Time's up. The word was"}
                </p>
                <p className="font-mono text-2xl font-extrabold tracking-wide text-accent sm:text-3xl">
                  {isOnline ? revealedWord ?? drawerWord ?? '...' : secretWord}
                </p>
                <p className="text-sm text-zinc-600">
                  Switching turns in{' '}
                  <span className="font-mono font-bold tabular-nums text-zinc-900">
                    {revealSecondsLeft}
                  </span>{' '}
                  sec
                </p>
              </div>
            )}
            {roundSolved && gamePhase === 'playing' && (
              <div className="absolute inset-0 z-20 flex items-center justify-center bg-white/90 text-center backdrop-blur-sm">
                <p className="px-4 text-lg font-bold text-teal-600">Round solved!</p>
              </div>
            )}
          </div>
        </section>

        <section className="hidden min-h-0 min-w-0 flex-col overflow-hidden rounded-2xl border border-zinc-200/90 bg-white/95 shadow-sm backdrop-blur-sm lg:col-span-2 lg:flex lg:h-full">
          <div className="shrink-0 border-b border-zinc-200 px-4 py-3">
            <h2 className="text-sm font-semibold text-zinc-900">Guesses</h2>
            <p className="text-xs text-zinc-500">Chat is for guesses only (UI demo).</p>
          </div>
          <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
            <div
              ref={guessesListRef}
              className="min-h-0 flex-1 space-y-2 overflow-y-auto overscroll-contain px-4 py-3 [scrollbar-gutter:stable]"
            >
              {guessesMessageList}
            </div>
            <form
              onSubmit={sendGuess}
              className="shrink-0 border-t border-zinc-200 bg-zinc-50/90 p-3"
            >
              {role === 'guesser' && !roundSolved && gamePhase === 'playing' ? (
                <div className="flex gap-2">
                  <input
                    value={guessInput}
                    onChange={(e) => setGuessInput(e.target.value)}
                    placeholder="Type your guess…"
                    className="min-w-0 flex-1 rounded-xl border border-zinc-200 bg-white px-3 py-2.5 text-sm text-zinc-900 outline-none transition-colors placeholder:text-zinc-400 hover:border-zinc-300 focus:border-accent/50 focus:ring-1 focus:ring-accent/25"
                    autoComplete="off"
                  />
                  <Button
                    type="submit"
                    variant="primary"
                    size="md"
                    className="shrink-0 gap-1.5 px-4 shadow-glow-accent transition-all duration-150 hover:brightness-110 hover:shadow-md active:scale-95"
                  >
                    <Send size={16} />
                  </Button>
                </div>
              ) : (
                <p className="text-center text-xs text-zinc-500">
                  {gamePhase === 'leaderboard'
                    ? 'Check the leaderboard, then tap continue for the next round.'
                    : role === 'drawer' && drawerTurnPhase === 'reveal'
                      ? 'The word is on the canvas. You’ll switch to Guessing automatically.'
                      : role === 'drawer'
                        ? 'Switch to “Guessing” to type guesses, or open another browser as a guesser later.'
                        : 'This round is over. The leaderboard opens after a correct guess.'}
                </p>
              )}
            </form>
          </div>
        </section>
      </div>

      <MobileChatDock
        title="Guesses"
        subtitle="Tap ↑ to read history · guesses only"
        expanded={mobileGuessesOpen}
        onExpandedChange={setMobileGuessesOpen}
        scrollToBottomKey={guessesScrollKey}
        messages={<div className="space-y-2">{guessesMessageList}</div>}
        composer={
          role === 'guesser' && !roundSolved && gamePhase === 'playing' ? (
            <form className="flex w-full gap-2" onSubmit={sendGuess}>
              <input
                value={guessInput}
                onChange={(e) => setGuessInput(e.target.value)}
                placeholder="Type your guess…"
                className="min-w-0 flex-1 rounded-xl border border-zinc-200 bg-white px-3 py-2.5 text-sm text-zinc-900 outline-none transition-colors placeholder:text-zinc-400 focus:border-accent/50 focus:ring-1 focus:ring-accent/25"
                autoComplete="off"
              />
              <Button
                type="submit"
                variant="primary"
                size="md"
                className="shrink-0 gap-1.5 px-3 shadow-glow-accent transition-all duration-150 hover:brightness-110 active:scale-95"
              >
                <Send size={16} />
              </Button>
            </form>
          ) : (
            <div className="rounded-xl border border-zinc-200/90 bg-zinc-50 px-2 py-2 text-center text-[10px] leading-snug text-zinc-500">
              {gamePhase === 'leaderboard'
                ? 'Leaderboard open — use desktop panel or expand to read.'
                : role === 'drawer' && drawerTurnPhase === 'reveal'
                  ? 'Drawer: word on canvas. Guessing switches soon.'
                  : role === 'drawer'
                    ? 'Switch to Guessing to type, or use another device as guesser.'
                    : 'Round over — expand to read chat.'}
            </div>
          )
        }
      />

      {gamePhase === 'leaderboard' && (
        <div className="fixed inset-0 z-100 flex items-center justify-center bg-zinc-900/25 p-4 backdrop-blur-sm">
          <div
            className="w-full max-w-md rounded-2xl border border-zinc-200 bg-white p-6 shadow-xl"
            role="dialog"
            aria-modal="true"
            aria-labelledby="lb-title"
          >
            <h2
              id="lb-title"
              className="text-center text-lg font-extrabold text-zinc-900 sm:text-xl"
            >
              {activeRound >= MAX_ROUNDS ? 'Match complete' : `Round ${activeRound} complete`}
            </h2>
            <p className="mt-1 text-center text-xs text-zinc-500">
              Last word:{' '}
              <span className="font-mono font-semibold text-accent">{secretWord}</span>
            </p>

            <div className="mt-6 space-y-2 rounded-xl border border-zinc-200 bg-zinc-50 p-4">
              <p className="text-[10px] font-semibold uppercase tracking-wider text-zinc-500">
                Leaderboard
              </p>
              {Object.entries(scores)
                .sort((a, b) => (b[1] ?? 0) - (a[1] ?? 0))
                .slice(0, 8)
                .map(([id, pts]) => (
                  <div
                    key={id}
                    className="flex items-center justify-between gap-3 border-b border-zinc-200 py-2 text-sm last:border-b-0"
                  >
                    <span className="font-medium text-zinc-800">
                      {id === playerId ? 'You' : id.slice(0, 6)}
                    </span>
                    <span className="font-mono font-bold text-teal-600">{pts} pts</span>
                  </div>
                ))}
            </div>

            <div className="mt-6 flex justify-center">
              <Button
                type="button"
                variant="primary"
                size="md"
                className="min-w-40 shadow-glow-accent transition-all duration-150 hover:brightness-110 hover:shadow-md active:scale-[0.98]"
                onClick={dismissLeaderboardAndContinue}
                disabled={isOnline}
              >
                {isOnline
                  ? 'Auto-resetting…'
                  : activeRound >= MAX_ROUNDS
                    ? 'Play again'
                    : 'Next round'}
              </Button>
            </div>
          </div>
        </div>
      )}
      </div>
    </div>
  )
}
