import crypto from 'node:crypto'
import type { GameKey, RoomState } from './types.js'
import { pickRandomWord, toHint } from '../games/drawing/words.js'
import { MAX_MEME_ROUNDS, tickMemeGame } from '../games/meme/engine.js'
import { tickSpyGame, SPY_MIN_PLAYERS } from '../games/spy/engine.js'
import { tickMafiaGame, pruneMafiaForPlayers, MAFIA_MIN } from '../games/mafia/engine.js'
import { tickLiarGame, pruneLiarForPlayers } from '../games/liar/engine.js'

function resetDrawingLobby(g: NonNullable<RoomState['drawingGame']>, room: RoomState) {
  g.status = 'lobby'
  g.matchRound = 1
  g.turnIndex = 0
  g.order = []
  g.drawerPlayerId = null
  g.word = null
  g.wordHint = null
  g.endsAt = null
  g.revealEndsAt = null
  g.leaderboardEndsAt = null
  g.solvedByPlayerId = null
  g.scores = {}
  room.drawing.strokes = []
  room.chat = []
}

function pruneMemeGameState(room: RoomState) {
  const m = room.memeGame
  if (!m) return
  const allowed = new Set(room.players.map((p) => p.id))
  const pruneKeys = (obj: Record<string, unknown>) => {
    for (const k of Object.keys(obj)) {
      if (!allowed.has(k)) delete obj[k]
    }
  }
  pruneKeys(m.contextVotes as Record<string, unknown>)
  pruneKeys(m.submissions as Record<string, unknown>)
  pruneKeys(m.scores as Record<string, unknown>)
  for (const k of Object.keys(m.gifVotes)) {
    if (!allowed.has(k)) {
      delete m.gifVotes[k]
      continue
    }
    const target = m.gifVotes[k]
    if (typeof target === 'string' && !allowed.has(target)) delete m.gifVotes[k]
  }
}

function repairDrawingGame(room: RoomState, t: number, liveIds: Set<string>) {
  const g = room.drawingGame
  if (!g || g.status === 'lobby') return

  if (g.status === 'leaderboard') {
    for (const k of Object.keys(g.scores)) {
      if (!liveIds.has(k)) delete g.scores[k]
    }
    g.order = g.order.filter((id) => liveIds.has(id))
    return
  }

  if (room.players.length < 2) {
    resetDrawingLobby(g, room)
    return
  }

  for (const k of Object.keys(g.scores)) {
    if (!liveIds.has(k)) delete g.scores[k]
  }

  g.order = g.order.filter((id) => liveIds.has(id))

  if (g.order.length < 2) {
    resetDrawingLobby(g, room)
    return
  }

  const drawerValid =
    Boolean(g.drawerPlayerId) &&
    liveIds.has(g.drawerPlayerId!) &&
    g.order.includes(g.drawerPlayerId!)

  if (drawerValid) {
    g.turnIndex = g.order.indexOf(g.drawerPlayerId!)
    return
  }

  g.turnIndex = Math.min(g.turnIndex, g.order.length - 1)
  g.drawerPlayerId = g.order[g.turnIndex]!

  if (g.status === 'playing') {
    const w = pickRandomWord()
    g.word = w
    g.wordHint = toHint(w)
    g.endsAt = t + DRAW_SEC * 1000
    g.revealEndsAt = null
    g.solvedByPlayerId = null
    room.drawing.strokes = []
    room.chat = []
  } else if (g.status === 'reveal') {
    g.revealEndsAt = t
  }
}

/** Call after removing a player from `room.players` so in-game state stays consistent. */
export function applyPlayerLeftRoom(room: RoomState) {
  const t = now()
  const liveIds = new Set(room.players.map((p) => p.id))

  if (room.game === 'meme' && room.memeGame) {
    pruneMemeGameState(room)
    tickMemeGame(room, t)
  }

  if (room.game === 'drawing' && room.drawingGame) {
    repairDrawingGame(room, t, liveIds)
  }

  if (room.game === 'mafia' && room.mafiaGame) {
    pruneMafiaForPlayers(room)
    tickMafiaGame(room, t)
    if (room.players.length < MAFIA_MIN) {
      room.mafiaGame.status = 'lobby'
      room.mafiaGame.roles = {}
      room.mafiaGame.alive = {}
    }
  }

  if (room.game === 'liar' && room.liarGame) {
    pruneLiarForPlayers(room)
    tickLiarGame(room, t)
    if (room.players.length < 2) {
      room.liarGame.status = 'lobby'
      room.liarGame.hands = {}
      room.liarGame.pile = []
      room.liarGame.lastPlay = null
    }
  }

  if (room.game === 'spy' && room.spyGame) {
    // Prune vote maps.
    for (const k of Object.keys(room.spyGame.earlyVoteYes)) {
      if (!liveIds.has(k)) delete room.spyGame.earlyVoteYes[k]
    }
    for (const k of Object.keys(room.spyGame.votes)) {
      if (!liveIds.has(k)) delete room.spyGame.votes[k]
    }
    tickSpyGame(room, t)
    // If not enough players, collapse to lobby.
    if (room.players.length < SPY_MIN_PLAYERS) {
      room.spyGame.status = 'lobby'
    }
  }
}

const ROOM_CODE_LEN = 6
const ROOM_TTL_MS = Number(process.env.ROOM_TTL_MS ?? 1000 * 60 * 30) // 30 minutes
const DRAW_SEC = Number(process.env.DRAW_SEC ?? 60)
const REVEAL_SEC = Number(process.env.REVEAL_SEC ?? 3)
const MAX_MATCH_ROUNDS = Number(process.env.MAX_MATCH_ROUNDS ?? 3)
const LEADERBOARD_SEC = Number(process.env.LEADERBOARD_SEC ?? 5)

const rooms = new Map<string, RoomState>()

function now() {
  return Date.now()
}

function generateRoomCode(): string {
  // avoid ambiguous chars
  const alphabet = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'
  let out = ''
  for (let i = 0; i < ROOM_CODE_LEN; i++) out += alphabet[crypto.randomInt(0, alphabet.length)]
  return out
}

export function createRoom(args: {
  game: GameKey
  createdByUserId: string
  isPrivate: boolean
}): RoomState {
  let code = generateRoomCode()
  for (let i = 0; i < 5 && rooms.has(code); i++) code = generateRoomCode()
  if (rooms.has(code)) throw new Error('Failed to allocate unique room code')

  const t = now()
  const state: RoomState = {
    code,
    game: args.game,
    isPrivate: args.isPrivate,
    createdAt: t,
    createdByUserId: args.createdByUserId,
    lastActivityAt: t,
    expiresAt: t + ROOM_TTL_MS,
    players: [],
    drawing: { strokes: [] },
    chat: [],
    drawingGame:
      args.game === 'drawing'
        ? {
            status: 'lobby',
            matchId: 0,
            matchRound: 1,
            turnIndex: 0,
            order: [],
            drawerPlayerId: null,
            word: null,
            wordHint: null,
            endsAt: null,
            revealEndsAt: null,
            leaderboardEndsAt: null,
            solvedByPlayerId: null,
            scores: {},
          }
        : undefined,
    memeGame:
      args.game === 'meme'
        ? {
            matchId: 0,
            status: 'lobby',
            round: 1,
            maxRounds: MAX_MEME_ROUNDS,
            seed: '',
            prompts: ['', ''],
            contextVotes: {},
            winningPromptIndex: null,
            submissions: {},
            gifVotes: {},
            scores: {},
            phaseEndsAt: null,
            revealEndsAt: null,
            leaderboardEndsAt: null,
            roundBreakEndsAt: null,
          }
        : undefined,
    spyGame:
      args.game === 'spy'
        ? {
            matchId: 0,
            status: 'lobby',
            word: null,
            spyPlayerId: null,
            discussionEndsAt: null,
            votingEndsAt: null,
            spyGuessEndsAt: null,
            earlyVoteYes: {},
            votes: {},
            revealedSpyPlayerId: null,
            revealedWord: null,
            winner: null,
            selectedPlayerId: null,
            tie: false,
            spyGuessedCorrectly: null,
          }
        : undefined,
    liarGame:
      args.game === 'liar'
        ? {
            matchId: 0,
            status: 'lobby',
            phase: 'between_rounds',
            round: 0,
            order: [],
            turnIndex: 0,
            hands: {},
            pile: [],
            lastPlay: null,
            bluffEndsAt: null,
            resolving: null,
            shotResult: null,
            revolvers: {},
            stats: {},
            winnerId: null,
            log: [],
          }
        : undefined,
    mafiaGame:
      args.game === 'mafia'
        ? {
            matchId: 0,
            round: 0,
            status: 'lobby',
            roles: {},
            alive: {},
            phaseEndsAt: null,
            nightEndsAt: null,
            dayEndsAt: null,
            voteEndsAt: null,
            resultsEndsAt: null,
            mafiaKillVotes: {},
            doctorSaveTarget: null,
            doctorPreviousNightProtectTarget: null,
            detectiveInvestigateTarget: null,
            detectiveKillTarget: null,
            pendingDetectiveReveal: null,
            dayVotes: {},
            daySkipYes: {},
            nightSkipYes: {},
            winner: null,
            lastAnnouncement: null,
          }
        : undefined,
    round: {
      phase: 'drawing',
      endsAt: t + DRAW_SEC * 1000,
      revealEndsAt: null,
    },
  }
  rooms.set(code, state)
  return state
}

export function getRoom(code: string): RoomState | null {
  const room = rooms.get(code) ?? null
  if (!room) return null
  if (room.expiresAt <= now()) {
    rooms.delete(code)
    return null
  }
  return room
}

export function touchRoom(code: string) {
  const room = rooms.get(code)
  if (!room) return
  room.lastActivityAt = now()
  room.expiresAt = room.lastActivityAt + ROOM_TTL_MS
}

export function deleteRoom(code: string) {
  rooms.delete(code)
}

export function listRoomsCount(): number {
  return rooms.size
}

export function pickRandomPublicRoom(game: GameKey): RoomState | null {
  const candidates: RoomState[] = []
  for (const room of rooms.values()) {
    if (room.game !== game) continue
    if (room.isPrivate) continue
    // prefer rooms that actually have someone in them
    if (room.players.length === 0) continue
    if (room.expiresAt <= now()) continue
    candidates.push(room)
  }
  if (!candidates.length) return null
  candidates.sort((a, b) => b.lastActivityAt - a.lastActivityAt)
  return candidates[0] ?? null
}

export function tickRoomTimers(code: string) {
  const room = rooms.get(code)
  if (!room) return
  const t = now()

  if (room.game === 'meme' && room.memeGame) {
    tickMemeGame(room, t)
    return
  }

  if (room.game === 'spy' && room.spyGame) {
    tickSpyGame(room, t)
    return
  }

  if (room.game === 'mafia' && room.mafiaGame) {
    tickMafiaGame(room, t)
    return
  }

  if (room.game === 'liar' && room.liarGame) {
    tickLiarGame(room, t)
    return
  }

  if (room.game === 'drawing' && room.drawingGame && room.drawingGame.status !== 'lobby') {
    const g = room.drawingGame
    // Player requirement: if not enough players remain, stop the match.
    if (room.players.length < 2) {
      g.status = 'lobby'
      g.matchRound = 1
      g.turnIndex = 0
      g.order = []
      g.drawerPlayerId = null
      g.word = null
      g.wordHint = null
      g.endsAt = null
      g.revealEndsAt = null
      g.leaderboardEndsAt = null
      g.solvedByPlayerId = null
      g.scores = {}
      room.drawing.strokes = []
      room.chat = []
      return
    }
    if (g.status === 'playing' && g.endsAt && t >= g.endsAt) {
      g.status = 'reveal'
      // Time-up: show reveal/switch screen briefly, then advance.
      // Correct-guess sets its own revealEndsAt in socket handler.
      g.revealEndsAt = t + REVEAL_SEC * 1000
    }

    if (g.status === 'reveal' && g.revealEndsAt && t >= g.revealEndsAt) {
      // Advance turn (each player draws once in order), then advance match round.
      const liveOrder = g.order.filter((id) => room.players.some((p) => p.id === id))
      g.order = liveOrder
      if (g.order.length === 0) {
        g.status = 'lobby'
        g.drawerPlayerId = null
        g.word = null
        g.wordHint = null
        g.endsAt = null
        g.revealEndsAt = null
        g.leaderboardEndsAt = null
        g.solvedByPlayerId = null
        room.drawing.strokes = []
        room.chat = []
        return
      }

      g.turnIndex += 1
      if (g.turnIndex >= g.order.length) {
        g.matchRound += 1
        g.turnIndex = 0
      }

      if (g.matchRound > MAX_MATCH_ROUNDS) {
        g.status = 'leaderboard'
        g.leaderboardEndsAt = t + LEADERBOARD_SEC * 1000
        g.drawerPlayerId = null
        g.word = null
        g.wordHint = null
        g.endsAt = null
        g.revealEndsAt = null
        g.solvedByPlayerId = null
        room.drawing.strokes = []
        room.chat = []
        return
      }

      const nextDrawerId = g.order[g.turnIndex]!
      g.status = 'playing'
      g.drawerPlayerId = nextDrawerId
      const nextWord = pickRandomWord()
      g.word = nextWord
      g.wordHint = toHint(nextWord)
      g.endsAt = t + DRAW_SEC * 1000
      g.revealEndsAt = null
      g.solvedByPlayerId = null
      room.drawing.strokes = []
      room.chat = []
      return
    }

    if (g.status === 'leaderboard' && g.leaderboardEndsAt && t >= g.leaderboardEndsAt) {
      // Auto-restart a fresh match (round 1) if enough players.
      const players = [...room.players].sort((a, b) => a.joinedAt - b.joinedAt)
      if (players.length < 2) {
        g.status = 'lobby'
        g.matchRound = 1
        g.turnIndex = 0
        g.order = []
        g.drawerPlayerId = null
        g.word = null
        g.wordHint = null
        g.endsAt = null
        g.revealEndsAt = null
        g.leaderboardEndsAt = null
        g.solvedByPlayerId = null
        g.scores = {}
        room.drawing.strokes = []
        room.chat = []
        return
      }

      g.matchId += 1
      g.status = 'playing'
      g.matchRound = 1
      g.turnIndex = 0
      g.order = players.map((p) => p.id)
      g.scores = {}
      g.drawerPlayerId = g.order[0]!
      const w = pickRandomWord()
      g.word = w
      g.wordHint = toHint(w)
      g.endsAt = t + DRAW_SEC * 1000
      g.revealEndsAt = null
      g.leaderboardEndsAt = null
      g.solvedByPlayerId = null
      room.drawing.strokes = []
      room.chat = []
      return
    }
    return
  }

  if (room.round.phase === 'drawing' && t >= room.round.endsAt) {
    room.round.phase = 'reveal'
    room.round.revealEndsAt = t + REVEAL_SEC * 1000
  }
  if (room.round.phase === 'reveal' && room.round.revealEndsAt && t >= room.round.revealEndsAt) {
    room.round.phase = 'guessing'
    room.round.revealEndsAt = null
  }
}

// Basic cleanup loop.
const cleanupIntervalMs = 10_000
setInterval(() => {
  const t = now()
  for (const [code, room] of rooms) {
    if (room.expiresAt <= t) rooms.delete(code)
  }
}, cleanupIntervalMs).unref()

