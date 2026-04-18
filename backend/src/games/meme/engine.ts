import type { RoomState } from '../../rooms/types.js'
import { pickTwoPrompts, tieBreakIndex } from './prompts.js'

export const MEME_CONTEXT_VOTE_SEC = Number(process.env.MEME_CONTEXT_VOTE_SEC ?? 45)
export const MEME_CONTEXT_RESULT_SEC = Number(process.env.MEME_CONTEXT_RESULT_SEC ?? 4)
export const MEME_GIF_PICK_SEC = Number(process.env.MEME_GIF_PICK_SEC ?? 90)
export const MEME_REVEAL_SEC = Number(process.env.MEME_REVEAL_SEC ?? 5)
export const MEME_GIF_VOTE_SEC = Number(process.env.MEME_GIF_VOTE_SEC ?? 45)
export const MEME_ROUND_BREAK_SEC = Number(process.env.MEME_ROUND_BREAK_SEC ?? 6)
export const MAX_MEME_ROUNDS = Number(process.env.MAX_MEME_ROUNDS ?? 3)

function playerIds(room: RoomState) {
  return room.players.map((p) => p.id)
}

function allContextVotesIn(m: NonNullable<RoomState['memeGame']>, ids: string[]) {
  return ids.length > 0 && ids.every((id) => m.contextVotes[id] === 0 || m.contextVotes[id] === 1)
}

function allGifSubmissionsIn(m: NonNullable<RoomState['memeGame']>, ids: string[]) {
  return ids.length > 0 && ids.every((id) => m.submissions[id])
}

function allGifVotesIn(m: NonNullable<RoomState['memeGame']>, ids: string[]) {
  return ids.length > 0 && ids.every((id) => typeof m.gifVotes[id] === 'string')
}

function resolveWinningPrompt(m: NonNullable<RoomState['memeGame']>, ids: string[]): 0 | 1 {
  let c0 = 0
  let c1 = 0
  for (const id of ids) {
    const v = m.contextVotes[id]
    if (v === 0) c0++
    else if (v === 1) c1++
  }
  if (c0 > c1) return 0
  if (c1 > c0) return 1
  return tieBreakIndex(m.seed, m.round)
}

function tallyGifVotes(m: NonNullable<RoomState['memeGame']>, ids: string[]) {
  const next = { ...m.scores }
  for (const vid of ids) {
    const target = m.gifVotes[vid]
    if (target && target !== vid) {
      next[target] = (next[target] ?? 0) + 1
    }
  }
  return next
}

function clearRoundPayload(m: NonNullable<RoomState['memeGame']>) {
  m.contextVotes = {}
  m.winningPromptIndex = null
  m.submissions = {}
  m.gifVotes = {}
  m.phaseEndsAt = null
  m.revealEndsAt = null
}

function beginContextVote(_room: RoomState, m: NonNullable<RoomState['memeGame']>, t: number) {
  const seed = `${Date.now()}-${Math.random().toString(16).slice(2)}`
  m.seed = seed
  m.prompts = pickTwoPrompts(seed)
  m.status = 'context_vote'
  m.contextVotes = {}
  m.winningPromptIndex = null
  m.submissions = {}
  m.gifVotes = {}
  m.revealEndsAt = null
  m.leaderboardEndsAt = null
  m.roundBreakEndsAt = null
  m.phaseEndsAt = t + MEME_CONTEXT_VOTE_SEC * 1000
}

export function startMemeMatch(room: RoomState, t: number) {
  const m = room.memeGame
  if (!m || room.game !== 'meme') return
  if (room.players.length < 2) return
  for (const p of room.players) {
    p.spectator = false
  }
  m.matchId += 1
  m.round = 1
  m.scores = {}
  beginContextVote(room, m, t)
}

export function tickMemeGame(room: RoomState, t: number) {
  const m = room.memeGame
  if (!m || room.game !== 'meme') return

  if (room.players.length < 2) {
    m.status = 'lobby'
    clearRoundPayload(m)
    m.round = 1
    m.phaseEndsAt = null
    m.revealEndsAt = null
    m.leaderboardEndsAt = null
    m.roundBreakEndsAt = null
    return
  }

  const ids = playerIds(room)

  switch (m.status) {
    case 'lobby':
      return

    case 'context_vote': {
      const deadline = m.phaseEndsAt && t >= m.phaseEndsAt
      const allIn = allContextVotesIn(m, ids)
      if (!allIn && !deadline) return
      m.winningPromptIndex = resolveWinningPrompt(m, ids)
      m.status = 'context_result'
      m.phaseEndsAt = t + MEME_CONTEXT_RESULT_SEC * 1000
      return
    }

    case 'context_result': {
      if (!m.phaseEndsAt || t < m.phaseEndsAt) return
      m.status = 'gif_pick'
      m.phaseEndsAt = t + MEME_GIF_PICK_SEC * 1000
      return
    }

    case 'gif_pick': {
      const deadline = m.phaseEndsAt && t >= m.phaseEndsAt
      const allIn = allGifSubmissionsIn(m, ids)
      if (!allIn && !deadline) return
      m.status = 'reveal'
      m.revealEndsAt = t + MEME_REVEAL_SEC * 1000
      m.phaseEndsAt = null
      return
    }

    case 'reveal': {
      if (!m.revealEndsAt || t < m.revealEndsAt) return
      m.status = 'gif_vote'
      m.gifVotes = {}
      m.phaseEndsAt = t + MEME_GIF_VOTE_SEC * 1000
      m.revealEndsAt = null
      return
    }

    case 'gif_vote': {
      const deadline = m.phaseEndsAt && t >= m.phaseEndsAt
      const allIn = allGifVotesIn(m, ids)
      if (!allIn && !deadline) return
      m.scores = tallyGifVotes(m, ids)
      if (m.round >= m.maxRounds) {
        m.status = 'leaderboard'
        m.leaderboardEndsAt = null
        m.phaseEndsAt = null
        return
      }
      m.status = 'round_break'
      m.roundBreakEndsAt = t + MEME_ROUND_BREAK_SEC * 1000
      m.phaseEndsAt = null
      return
    }

    case 'round_break': {
      if (!m.roundBreakEndsAt || t < m.roundBreakEndsAt) return
      m.round += 1
      clearRoundPayload(m)
      beginContextVote(room, m, t)
      m.roundBreakEndsAt = null
      return
    }

    case 'leaderboard':
      return

    default:
      return
  }
}
