import type { Server as HttpServer } from 'node:http'
import { Server } from 'socket.io'
import crypto from 'node:crypto'
import { verifyToken } from './auth/token.js'
import { AUTH_COOKIE_NAME, getAuthSecret } from './auth/middleware.js'
import { applyPlayerLeftRoom, deleteRoom, getRoom, tickRoomTimers, touchRoom } from './rooms/store.js'
import type { RoomPlayer } from './rooms/types.js'
import { normalizeGuess, pickRandomWord, toHint } from './games/drawing/words.js'
import { startMemeMatch } from './games/meme/engine.js'
import { sanitizeMemeGif } from './games/meme/sanitize.js'
import { getCorsOrigins } from './corsOrigins.js'

let io: Server | null = null

const startedTurnByRoom = new Map<string, string>()
const revealedTurnByRoom = new Map<string, string>()

export function initSocket(httpServer: HttpServer): Server {
  io = new Server(httpServer, {
    cors: {
      origin: getCorsOrigins(),
      methods: ['GET', 'POST'],
      credentials: true,
    },
  })

  function getCookie(header: string | undefined, name: string): string | null {
    if (!header) return null
    const parts = header.split(';')
    for (const part of parts) {
      const [k, ...rest] = part.trim().split('=')
      if (k === name) return decodeURIComponent(rest.join('=') ?? '')
    }
    return null
  }

  io.use((socket, next) => {
    const cookieHeader = socket.handshake.headers.cookie as string | undefined
    const cookieToken = getCookie(cookieHeader, AUTH_COOKIE_NAME)
    const authPayload = socket.handshake.auth as { token?: string } | undefined
    const authToken =
      typeof authPayload?.token === 'string' ? authPayload.token.trim() : ''
    const headerBearer = (socket.handshake.headers['authorization'] as string | undefined)?.replace(
      /^Bearer\s+/i,
      '',
    )
    const raw =
      cookieToken ||
      headerBearer ||
      authToken ||
      null
    if (!raw) return next()
    const payload = verifyToken(String(raw), getAuthSecret())
    if (payload) {
      ;(socket.data as any).token = payload
      ;(socket.data as any).principal =
        payload.typ === 'user'
          ? { kind: 'user', id: payload.sub, displayName: payload.name }
          : { kind: 'guest', id: payload.sub, displayName: payload.name }
    }
    next()
  })

  io.on('connection', (socket) => {
    console.log('[socket] connected', socket.id)

    let joinedCode: string | null = null
    let joinedPlayerId: string | null = null

    const emitRoomState = (code: string) => {
      const room = getRoom(code)
      if (!room) return
      tickRoomTimers(code)
      const now = Date.now()
      const dg = room.drawingGame
      const drawSecLeft =
        dg?.status === 'playing' && dg.endsAt
          ? Math.max(0, Math.ceil((dg.endsAt - now) / 1000))
          : dg?.status === 'lobby'
            ? 60
            : Math.max(0, Math.ceil((room.round.endsAt - now) / 1000))
      const revealSecLeft =
        dg?.status === 'reveal' && dg.revealEndsAt
          ? Math.max(0, Math.ceil((dg.revealEndsAt - now) / 1000))
          : room.round.phase === 'reveal' && room.round.revealEndsAt
            ? Math.max(0, Math.ceil((room.round.revealEndsAt - now) / 1000))
            : 0

      const mg = room.memeGame
      const memePhaseSecLeft =
        mg?.phaseEndsAt != null ? Math.max(0, Math.ceil((mg.phaseEndsAt - now) / 1000)) : 0
      const memeRevealSecLeft =
        mg?.revealEndsAt != null ? Math.max(0, Math.ceil((mg.revealEndsAt - now) / 1000)) : 0
      const memeLeaderboardSecLeft =
        mg?.leaderboardEndsAt != null
          ? Math.max(0, Math.ceil((mg.leaderboardEndsAt - now) / 1000))
          : 0
      const memeRoundBreakSecLeft =
        mg?.roundBreakEndsAt != null
          ? Math.max(0, Math.ceil((mg.roundBreakEndsAt - now) / 1000))
          : 0

      io!.to(code).emit('room:state', {
        code: room.code,
        game: room.game,
        createdByUserId: room.createdByUserId,
        players: room.players,
        drawing: { strokes: room.drawing.strokes },
        chat: room.chat.slice(-100),
        round: room.round,
        memeGame: mg,
        drawingGame: dg
          ? {
              status: dg.status,
              matchId: dg.matchId,
              matchRound: dg.matchRound,
              turnIndex: dg.turnIndex,
              orderSize: dg.order.length,
              drawerPlayerId: dg.drawerPlayerId,
              wordHint: dg.wordHint,
              endsAt: dg.endsAt,
              revealEndsAt: dg.revealEndsAt,
              leaderboardEndsAt: dg.leaderboardEndsAt,
              solvedByPlayerId: dg.solvedByPlayerId,
              scores: dg.scores,
            }
          : undefined,
        timers: {
          drawSecLeft,
          revealSecLeft,
          memePhaseSecLeft,
          memeRevealSecLeft,
          memeLeaderboardSecLeft,
          memeRoundBreakSecLeft,
        },
      })

      // Broadcast transitions and deliver secret word to drawer.
      if (room.game === 'drawing' && dg) {
        if (dg.status === 'playing') {
          const turnKey = `${dg.matchId}-${dg.matchRound}-${dg.turnIndex}`
          const lastStarted = startedTurnByRoom.get(code)
          if (lastStarted !== turnKey) {
            startedTurnByRoom.set(code, turnKey)
            io!.to(code).emit('game:drawing:started', { code, game: 'drawing' as const })
          }
          // Send the word only to drawer sockets (once per round per socket).
          if (dg.drawerPlayerId && dg.word) {
            for (const s of io!.sockets.sockets.values()) {
              if (!s.rooms?.has(code)) continue
              const pid = (s.data as any).playerId as string | undefined
              if (pid !== dg.drawerPlayerId) continue
              const lastWordTurn = (s.data as any).lastWordTurnSent as string | undefined
              if (lastWordTurn === turnKey) continue
              ;(s.data as any).lastWordTurnSent = turnKey
              s.emit('game:drawing:word', { word: dg.word })
            }
          }
        } else if (dg.status === 'reveal' && dg.word) {
          const turnKey = `${dg.matchId}-${dg.matchRound}-${dg.turnIndex}`
          const lastRevealed = revealedTurnByRoom.get(code)
          if (lastRevealed !== turnKey) {
            revealedTurnByRoom.set(code, turnKey)
            io!.to(code).emit('game:drawing:reveal', { word: dg.word })
          }
        }
      }
    }

    socket.on(
      'room:join',
      (payload: { code?: string; nickname?: string }, cb?: (res: any) => void) => {
        const code = String(payload?.code ?? '')
          .trim()
          .toUpperCase()
        const room = getRoom(code)
        if (!room) {
          cb?.({ ok: false, error: 'room_not_found' })
          return
        }

        const principal = (socket.data as any).principal as
          | { kind: 'user' | 'guest'; id: string; displayName?: string }
          | undefined

        const displayName =
          String(payload?.nickname ?? '').trim().slice(0, 20) ||
          principal?.displayName ||
          `Guest-${crypto.randomInt(1000, 9999)}`

        const playerId = principal?.id ?? crypto.randomUUID()
        const player: RoomPlayer = {
          id: playerId,
          kind: principal?.kind === 'user' ? 'user' : 'guest',
          displayName,
          joinedAt: Date.now(),
        }

        // upsert by id
        room.players = [
          ...room.players.filter((p) => p.id !== playerId),
          player,
        ]
        touchRoom(code)

        joinedCode = code
        joinedPlayerId = playerId
        ;(socket.data as any).playerId = playerId

        void socket.join(code)
        cb?.({ ok: true, room: { code, game: room.game }, player })
        emitRoomState(code)

        // If a drawing round is already running, make sure the drawer receives the word
        // even if they missed the initial event (e.g. navigated after start).
        if (
          room.game === 'drawing' &&
          room.drawingGame &&
          room.drawingGame.status !== 'lobby' &&
          room.drawingGame.drawerPlayerId === playerId &&
          room.drawingGame.word
        ) {
          socket.emit('game:drawing:word', { word: room.drawingGame.word })
        }
        // If the round is in reveal, ensure late joiners see the revealed word too.
        if (
          room.game === 'drawing' &&
          room.drawingGame &&
          room.drawingGame.status === 'reveal' &&
          room.drawingGame.word
        ) {
          socket.emit('game:drawing:reveal', { word: room.drawingGame.word })
        }
      },
    )

    socket.on('game:drawing:start', () => {
      if (!joinedCode) return
      const room = getRoom(joinedCode)
      if (!room || room.game !== 'drawing' || !room.drawingGame) return

      // Only the room creator (authenticated user) can start.
      const principal = (socket.data as any).principal as { kind: 'user' | 'guest'; id: string } | undefined
      if (!principal || principal.kind !== 'user' || principal.id !== room.createdByUserId) return

      const players = [...room.players].sort((a, b) => a.joinedAt - b.joinedAt)
      if (players.length < 2) return

      const g = room.drawingGame
      // Start / restart the match from round 1.
      g.matchId += 1
      g.status = 'playing'
      g.matchRound = 1
      g.turnIndex = 0
      g.order = players.map((p) => p.id)
      g.scores = {}
      const drawerPlayerId = g.order[0]!
      g.drawerPlayerId = drawerPlayerId

      const word = pickRandomWord()
      const now = Date.now()
      g.word = word
      g.wordHint = toHint(word)
      g.endsAt = now + 60_000
      g.revealEndsAt = null
      g.leaderboardEndsAt = null
      g.solvedByPlayerId = null
      room.drawing.strokes = []
      room.chat = []
      touchRoom(joinedCode)

      io!.to(joinedCode).emit('drawing:clear')
      io!.to(joinedCode).emit('chat:clear')

      // Send the word only to the drawer socket(s).
      for (const s of io!.sockets.sockets.values()) {
        const pid = (s.data as any).playerId as string | undefined
        if (!pid || pid !== drawerPlayerId) continue
        if (!(s.rooms?.has(joinedCode))) continue
        s.emit('game:drawing:word', { word })
      }

      emitRoomState(joinedCode)
    })

    socket.on('game:meme:start', () => {
      if (!joinedCode) return
      const room = getRoom(joinedCode)
      if (!room || room.game !== 'meme' || !room.memeGame) return
      const principal = (socket.data as any).principal as
        | { kind: 'user' | 'guest'; id: string }
        | undefined
      if (!principal || principal.kind !== 'user' || principal.id !== room.createdByUserId) return
      if (room.players.length < 2) return
      startMemeMatch(room, Date.now())
      touchRoom(joinedCode)
      io!.to(joinedCode).emit('game:meme:started', { code: joinedCode, game: 'meme' as const })
      emitRoomState(joinedCode)
    })

    socket.on('game:meme:context_vote', (payload: { promptIndex?: number }) => {
      if (!joinedCode || !joinedPlayerId) return
      const room = getRoom(joinedCode)
      if (!room?.memeGame || room.memeGame.status !== 'context_vote') return
      const ix: 0 | 1 = payload?.promptIndex === 1 ? 1 : 0
      room.memeGame.contextVotes[joinedPlayerId] = ix
      touchRoom(joinedCode)
      emitRoomState(joinedCode)
    })

    socket.on('game:meme:submit_gif', (payload: { gif?: unknown }) => {
      if (!joinedCode || !joinedPlayerId) return
      const room = getRoom(joinedCode)
      if (!room?.memeGame || room.memeGame.status !== 'gif_pick') return
      const m = room.memeGame
      if (m.winningPromptIndex === null) return
      const gif = sanitizeMemeGif(payload?.gif)
      if (!gif) return
      m.submissions[joinedPlayerId] = {
        promptIndex: m.winningPromptIndex,
        gif,
      }
      touchRoom(joinedCode)
      emitRoomState(joinedCode)
    })

    socket.on('game:meme:gif_vote', (payload: { targetPlayerId?: string }) => {
      if (!joinedCode || !joinedPlayerId) return
      const room = getRoom(joinedCode)
      if (!room?.memeGame || room.memeGame.status !== 'gif_vote') return
      const m = room.memeGame
      const target = String(payload?.targetPlayerId ?? '').trim()
      if (!target || target === joinedPlayerId) return
      if (!room.players.some((p) => p.id === target)) return
      m.gifVotes[joinedPlayerId] = target
      touchRoom(joinedCode)
      emitRoomState(joinedCode)
    })

    socket.on('room:leave', () => {
      if (!joinedCode || !joinedPlayerId) return
      const code = joinedCode
      const room = getRoom(code)
      if (room) {
        room.players = room.players.filter((p) => p.id !== joinedPlayerId)
        if (room.players.length === 0) {
          deleteRoom(code)
          startedTurnByRoom.delete(code)
          revealedTurnByRoom.delete(code)
        } else {
          applyPlayerLeftRoom(room)
          touchRoom(code)
          emitRoomState(code)
        }
      }
      void socket.leave(code)
      joinedCode = null
      joinedPlayerId = null
    })

    socket.on(
      'voice:signal',
      (payload: { targetPlayerId?: string; signal?: { kind?: string; sdp?: unknown; candidate?: unknown } }) => {
        if (!joinedCode || !joinedPlayerId) return
        const room = getRoom(joinedCode)
        if (!room) return
        const target = String(payload?.targetPlayerId ?? '').trim()
        if (!target || target === joinedPlayerId) return
        if (!room.players.some((p) => p.id === target)) return
        const signal = payload?.signal
        if (!signal || typeof signal !== 'object') return

        for (const s of io!.sockets.sockets.values()) {
          const pid = (s.data as any).playerId as string | undefined
          if (pid !== target) continue
          if (!(s.rooms?.has(joinedCode))) continue
          s.emit('voice:signal', {
            fromPlayerId: joinedPlayerId,
            signal,
          })
        }
      },
    )

    socket.on('chat:message', (payload: { text?: string }) => {
      if (!joinedCode) return
      const room = getRoom(joinedCode)
      if (!room) return
      const text = String(payload?.text ?? '').trim().slice(0, 240)
      if (!text) return
      const player = room.players.find((p) => p.id === joinedPlayerId)
      const author = player?.displayName ?? 'Player'
      let variant: 'chat' | 'correct' = 'chat'
      let solved = false
      let guessPts = 0
      let drawerPts = 0

      // Guess checking (server-authoritative).
      if (room.game === 'drawing' && room.drawingGame?.status === 'playing') {
        const g = room.drawingGame
        if (g.word && g.drawerPlayerId && joinedPlayerId && joinedPlayerId !== g.drawerPlayerId) {
          if (normalizeGuess(text) === normalizeGuess(g.word)) {
            solved = true
            variant = 'correct'
            g.status = 'reveal'
            g.solvedByPlayerId = joinedPlayerId
            g.revealEndsAt = Date.now() + 3_000
            const secLeft = g.endsAt ? Math.max(0, Math.ceil((g.endsAt - Date.now()) / 1000)) : 0
            guessPts = 100 + secLeft * 2
            drawerPts = 25
            g.scores[joinedPlayerId] = (g.scores[joinedPlayerId] ?? 0) + guessPts
            g.scores[g.drawerPlayerId] = (g.scores[g.drawerPlayerId] ?? 0) + drawerPts
          }
        }
      }

      const msg = { id: crypto.randomUUID(), author, text, ts: Date.now(), variant }
      room.chat.push(msg)
      if (room.chat.length > 200) room.chat = room.chat.slice(-200)
      touchRoom(joinedCode)
      io!.to(joinedCode).emit('chat:message', msg)

      if (solved) {
        io!.to(joinedCode).emit('chat:message', {
          id: crypto.randomUUID(),
          author: 'Game',
          text: `${author} guessed correctly! +${guessPts} (drawer +${drawerPts})`,
          ts: Date.now(),
          variant: 'system',
        })
        emitRoomState(joinedCode)
      }
    })

    socket.on('drawing:stroke', (payload: any) => {
      if (!joinedCode) return
      const room = getRoom(joinedCode)
      if (!room) return
      // Trust-but-verify minimal shape.
      if (!payload || typeof payload.id !== 'string' || !Array.isArray(payload.points)) return
      room.drawing.strokes.push(payload)
      if (room.drawing.strokes.length > 500) room.drawing.strokes = room.drawing.strokes.slice(-500)
      touchRoom(joinedCode)
      socket.to(joinedCode).emit('drawing:stroke', payload)
    })

    socket.on('drawing:clear', () => {
      if (!joinedCode) return
      const room = getRoom(joinedCode)
      if (!room) return
      room.drawing.strokes = []
      touchRoom(joinedCode)
      io!.to(joinedCode).emit('drawing:clear')
    })

    const timer = setInterval(() => {
      if (!joinedCode) return
      const room = getRoom(joinedCode)
      if (!room) return
      tickRoomTimers(joinedCode)
      emitRoomState(joinedCode)
    }, 1000)

    socket.on('disconnect', (reason) => {
      console.log('[socket] disconnected', socket.id, reason)
      clearInterval(timer)
      if (!joinedCode || !joinedPlayerId) return
      const code = joinedCode
      const room = getRoom(code)
      if (!room) return
      room.players = room.players.filter((p) => p.id !== joinedPlayerId)
      if (room.players.length === 0) {
        deleteRoom(code)
        startedTurnByRoom.delete(code)
        revealedTurnByRoom.delete(code)
      } else {
        applyPlayerLeftRoom(room)
        touchRoom(code)
        emitRoomState(code)
      }
    })
  })

  return io
}

export function getIo(): Server {
  if (!io) {
    throw new Error('Socket.IO has not been initialized')
  }
  return io
}
