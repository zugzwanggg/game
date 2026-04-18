import type { RoomState } from '../../rooms/types.js'
import { clearSpectatorFlagsForMatchStart } from '../../rooms/spectators.js'

export const MEMORY_MIN_PLAYERS = 2
export const MEMORY_MAX_PLAYERS = 12
export const TILE_COUNT = 9
const INITIAL_SEQ_LEN = 2
/** Round 1 playback; later rounds shorten via `playbackShowMsForRound` / `playbackGapMsForRound`. */
export const SHOW_MS = 420
export const GAP_MS = 110

/** Each round the pattern plays faster (show + gap shrink until floors). */
export function playbackShowMsForRound(round: number): number {
  const r = Math.max(1, round)
  return Math.max(165, SHOW_MS - (r - 1) * 18)
}

export function playbackGapMsForRound(round: number): number {
  const r = Math.max(1, round)
  return Math.max(48, GAP_MS - (r - 1) * 5)
}
export const MATCH_START_COUNTDOWN_MS = 5000
export const BETWEEN_ROUNDS_COUNTDOWN_MS = 2000

function inputSecondsForRound(round: number): number {
  return Math.max(10, 40 - round * 2)
}

function resetMemoryLobby(g: NonNullable<RoomState['memoryGame']>) {
  g.status = 'lobby'
  g.countdownReason = null
  g.round = 1
  g.sequence = []
  g.alive = {}
  g.highlightTile = null
  g.playbackStep = 0
  g.playbackPhase = null
  g.phaseEndsAt = null
  g.inputEndsAt = null
  g.inputProgress = {}
  g.winnerId = null
  g.lastEliminatedPlayerId = null
}

export function startMemoryMatch(room: RoomState, t: number): boolean {
  if (room.game !== 'memory' || !room.memoryGame) return false
  const g = room.memoryGame
  clearSpectatorFlagsForMatchStart(room)
  const ids = room.players.map((p) => p.id)
  if (ids.length < MEMORY_MIN_PLAYERS || ids.length > MEMORY_MAX_PLAYERS) return false

  g.matchId += 1
  g.round = 1
  g.sequence = []
  for (let i = 0; i < INITIAL_SEQ_LEN; i++) {
    g.sequence.push(Math.floor(Math.random() * TILE_COUNT))
  }
  g.alive = {}
  for (const id of ids) g.alive[id] = true
  g.winnerId = null
  g.lastEliminatedPlayerId = null
  beginCountdownPhase(g, t, 'match_start')
  return true
}

function beginCountdownPhase(
  g: NonNullable<RoomState['memoryGame']>,
  t: number,
  reason: 'match_start' | 'next_round',
) {
  g.status = 'countdown'
  g.countdownReason = reason
  g.highlightTile = null
  g.playbackStep = 0
  g.playbackPhase = null
  g.inputEndsAt = null
  g.inputProgress = {}
  const ms = reason === 'match_start' ? MATCH_START_COUNTDOWN_MS : BETWEEN_ROUNDS_COUNTDOWN_MS
  g.phaseEndsAt = t + ms
}

function beginPlaybackPhase(_room: RoomState, g: NonNullable<RoomState['memoryGame']>, t: number) {
  g.countdownReason = null
  g.status = 'playback'
  g.playbackStep = 0
  g.playbackPhase = 'show'
  g.highlightTile = g.sequence[0]!
  g.phaseEndsAt = t + playbackShowMsForRound(g.round)
  g.inputEndsAt = null
  g.inputProgress = {}
}

function enterInputPhase(_room: RoomState, g: NonNullable<RoomState['memoryGame']>, t: number) {
  g.status = 'input'
  g.countdownReason = null
  g.highlightTile = null
  g.playbackPhase = null
  g.phaseEndsAt = null
  const sec = inputSecondsForRound(g.round)
  g.inputEndsAt = t + sec * 1000
  g.inputProgress = {}
  for (const id of Object.keys(g.alive)) {
    if (g.alive[id]) g.inputProgress[id] = 0
  }
}

function aliveIds(g: NonNullable<RoomState['memoryGame']>): string[] {
  return Object.entries(g.alive)
    .filter(([, v]) => v)
    .map(([k]) => k)
}

function allAliveCompletedInput(g: NonNullable<RoomState['memoryGame']>): boolean {
  const len = g.sequence.length
  for (const id of aliveIds(g)) {
    if ((g.inputProgress[id] ?? 0) < len) return false
  }
  return aliveIds(g).length > 0
}

function checkSingleWinnerOrReset(
  _room: RoomState,
  g: NonNullable<RoomState['memoryGame']>,
  _t: number,
): void {
  const ids = aliveIds(g)
  if (ids.length === 1) {
    g.status = 'winner'
    g.countdownReason = null
    g.winnerId = ids[0]!
    g.inputEndsAt = null
    g.phaseEndsAt = null
    g.highlightTile = null
    return
  }
  if (ids.length === 0) {
    resetMemoryLobby(g)
  }
}

/** Advance after everyone correctly finished the sequence before the timer. */
function advanceRoundAfterSuccess(_room: RoomState, g: NonNullable<RoomState['memoryGame']>, t: number) {
  g.round += 1
  g.sequence.push(Math.floor(Math.random() * TILE_COUNT))
  g.lastEliminatedPlayerId = null
  beginCountdownPhase(g, t, 'next_round')
}

export function tryMemoryTap(room: RoomState, playerId: string, tileIndex: number, t: number): boolean {
  const g = room.memoryGame
  if (!g || room.game !== 'memory' || g.status !== 'input') return false
  if (!g.alive[playerId]) return false
  if (tileIndex < 0 || tileIndex >= TILE_COUNT) return false

  const idx = g.inputProgress[playerId] ?? 0
  const expected = g.sequence[idx]
  if (expected === undefined) return false

  if (tileIndex !== expected) {
    g.alive[playerId] = false
    g.lastEliminatedPlayerId = playerId
    checkSingleWinnerOrReset(room, g, t)
    return true
  }

  g.inputProgress[playerId] = idx + 1
  g.lastEliminatedPlayerId = null

  if (g.inputProgress[playerId] === g.sequence.length && allAliveCompletedInput(g)) {
    g.inputEndsAt = null
    advanceRoundAfterSuccess(room, g, t)
  }

  return true
}

function processInputTimeout(_room: RoomState, g: NonNullable<RoomState['memoryGame']>, t: number) {
  for (const id of aliveIds(g)) {
    if ((g.inputProgress[id] ?? 0) < g.sequence.length) {
      g.alive[id] = false
      g.lastEliminatedPlayerId = id
    }
  }
  g.inputEndsAt = null

  const ids = aliveIds(g)
  if (ids.length === 1) {
    g.status = 'winner'
    g.countdownReason = null
    g.winnerId = ids[0]!
    g.highlightTile = null
    g.phaseEndsAt = null
    return
  }
  if (ids.length === 0) {
    resetMemoryLobby(g)
    return
  }

  g.round += 1
  g.sequence.push(Math.floor(Math.random() * TILE_COUNT))
  g.lastEliminatedPlayerId = null
  beginCountdownPhase(g, t, 'next_round')
}

function processPlaybackTick(room: RoomState, g: NonNullable<RoomState['memoryGame']>, t: number) {
  if (!g.phaseEndsAt || t < g.phaseEndsAt) return

  if (g.playbackPhase === 'show') {
    g.playbackPhase = 'gap'
    g.highlightTile = null
    g.phaseEndsAt = t + playbackGapMsForRound(g.round)
    return
  }

  // gap ended
  if (g.playbackStep < g.sequence.length - 1) {
    g.playbackStep += 1
    g.playbackPhase = 'show'
    g.highlightTile = g.sequence[g.playbackStep]!
    g.phaseEndsAt = t + playbackShowMsForRound(g.round)
    return
  }

  enterInputPhase(room, g, t)
}

function processCountdownEnd(room: RoomState, g: NonNullable<RoomState['memoryGame']>, t: number) {
  if (!g.phaseEndsAt || t < g.phaseEndsAt) return
  beginPlaybackPhase(room, g, t)
}

export function tickMemoryGame(room: RoomState, t: number) {
  const g = room.memoryGame
  if (!g || room.game !== 'memory' || g.status === 'lobby') return

  if (g.status === 'countdown') {
    processCountdownEnd(room, g, t)
    return
  }

  if (g.status === 'playback') {
    processPlaybackTick(room, g, t)
    return
  }

  if (g.status === 'input' && g.inputEndsAt != null && t >= g.inputEndsAt) {
    processInputTimeout(room, g, t)
  }
}

export function pruneMemoryForPlayers(room: RoomState) {
  const g = room.memoryGame
  if (!g || room.game !== 'memory' || g.status === 'lobby') return

  const ids = new Set(room.players.map((p) => p.id))
  for (const k of Object.keys(g.alive)) {
    if (!ids.has(k)) delete g.alive[k]
  }
  for (const k of Object.keys(g.inputProgress)) {
    if (!ids.has(k)) delete g.inputProgress[k]
  }

  const aliveCount = Object.values(g.alive).filter(Boolean).length
  if (aliveCount < MEMORY_MIN_PLAYERS && g.status !== 'winner') {
    resetMemoryLobby(g)
  }
}
