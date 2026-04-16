import type { RoomState } from '../../rooms/types.js'
import { normalizeSpyGuess, pickRandomSpyWord } from './words.js'

export const SPY_MIN_PLAYERS = 3
export const SPY_MAX_PLAYERS = 10

export const SPY_DISCUSSION_SEC = Number(process.env.SPY_DISCUSSION_SEC ?? 240) // 4 min
export const SPY_VOTE_SEC = Number(process.env.SPY_VOTE_SEC ?? 25) // 20–30 sec
export const SPY_GUESS_SEC = Number(process.env.SPY_GUESS_SEC ?? 20)

function resetToLobby(s: NonNullable<RoomState['spyGame']>) {
  s.status = 'lobby'
  s.word = null
  s.spyPlayerId = null
  s.discussionEndsAt = null
  s.votingEndsAt = null
  s.spyGuessEndsAt = null
  s.earlyVoteYes = {}
  s.votes = {}
  s.revealedSpyPlayerId = null
  s.revealedWord = null
  s.winner = null
  s.selectedPlayerId = null
  s.tie = false
  s.spyGuessedCorrectly = null
}

function livePlayerIds(room: RoomState) {
  return room.players.map((p) => p.id)
}

function startVoting(room: RoomState, s: NonNullable<RoomState['spyGame']>, t: number) {
  if (room.players.length < SPY_MIN_PLAYERS) {
    resetToLobby(s)
    return
  }
  s.status = 'voting'
  s.votes = {}
  s.votingEndsAt = t + SPY_VOTE_SEC * 1000
}

function tallyVotes(s: NonNullable<RoomState['spyGame']>, ids: string[]) {
  const counts = new Map<string, number>()
  for (const voter of ids) {
    const target = s.votes[voter]
    if (!target) continue
    counts.set(target, (counts.get(target) ?? 0) + 1)
  }
  let topId: string | null = null
  let topVotes = 0
  let tie = false
  for (const [id, c] of counts) {
    if (c > topVotes) {
      topVotes = c
      topId = id
      tie = false
    } else if (c === topVotes && c > 0) {
      tie = true
    }
  }
  return { topId, topVotes, tie }
}

function enterReveal(
  s: NonNullable<RoomState['spyGame']>,
  args: {
    winner: 'spy' | 'agents'
    selectedPlayerId: string | null
    tie: boolean
    spyGuessedCorrectly: boolean | null
  },
) {
  s.status = 'reveal'
  s.revealedSpyPlayerId = s.spyPlayerId
  s.revealedWord = s.word
  s.winner = args.winner
  s.selectedPlayerId = args.selectedPlayerId
  s.tie = args.tie
  s.spyGuessedCorrectly = args.spyGuessedCorrectly

  // Clear timers, but keep reveal payload.
  s.discussionEndsAt = null
  s.votingEndsAt = null
  s.spyGuessEndsAt = null
}

export function startSpyMatch(room: RoomState, t: number) {
  const s = room.spyGame
  if (!s || room.game !== 'spy') return
  if (room.players.length < SPY_MIN_PLAYERS) return
  if (room.players.length > SPY_MAX_PLAYERS) return

  s.matchId += 1
  s.status = 'discussion'
  s.word = pickRandomSpyWord()
  const ids = livePlayerIds(room)
  s.spyPlayerId = ids[Math.floor(Math.random() * ids.length)] ?? null
  s.discussionEndsAt = t + SPY_DISCUSSION_SEC * 1000
  s.votingEndsAt = null
  s.spyGuessEndsAt = null
  s.earlyVoteYes = {}
  s.votes = {}
  s.revealedSpyPlayerId = null
  s.revealedWord = null
  s.winner = null
  s.selectedPlayerId = null
  s.tie = false
  s.spyGuessedCorrectly = null
}

export function requestEarlyVote(room: RoomState, s: NonNullable<RoomState['spyGame']>, byPlayerId: string, t: number) {
  if (room.game !== 'spy') return
  if (s.status !== 'discussion') return
  s.earlyVoteYes[byPlayerId] = true
  const ids = livePlayerIds(room)
  const yes = ids.filter((id) => s.earlyVoteYes[id]).length
  if (yes > ids.length / 2) {
    startVoting(room, s, t)
  }
}

export function castSpyVote(room: RoomState, s: NonNullable<RoomState['spyGame']>, voterId: string, targetId: string, t: number) {
  if (room.game !== 'spy') return
  if (s.status !== 'voting') return
  if (!room.players.some((p) => p.id === voterId)) return
  if (!room.players.some((p) => p.id === targetId)) return
  if (voterId === targetId) return
  s.votes[voterId] = targetId
  const ids = livePlayerIds(room)
  // End early if everyone voted.
  const allIn = ids.length > 0 && ids.every((id) => typeof s.votes[id] === 'string')
  if (allIn) {
    s.votingEndsAt = t
  }
}

export function spyGuess(room: RoomState, s: NonNullable<RoomState['spyGame']>, byPlayerId: string, guess: string) {
  if (room.game !== 'spy') return
  if (s.status !== 'spy_guess') return
  if (!s.spyPlayerId || byPlayerId !== s.spyPlayerId) return
  if (!s.word) return
  const ok = normalizeSpyGuess(guess) === normalizeSpyGuess(s.word)
  enterReveal(s, {
    winner: ok ? 'spy' : 'agents',
    selectedPlayerId: s.selectedPlayerId ?? null,
    tie: false,
    spyGuessedCorrectly: ok,
  })
}

export function tickSpyGame(room: RoomState, t: number) {
  const s = room.spyGame
  if (!s || room.game !== 'spy') return

  if (room.players.length < SPY_MIN_PLAYERS || room.players.length > SPY_MAX_PLAYERS) {
    resetToLobby(s)
    return
  }

  switch (s.status) {
    case 'lobby':
      return

    case 'discussion': {
      if (s.discussionEndsAt && t >= s.discussionEndsAt) {
        startVoting(room, s, t)
      }
      return
    }

    case 'voting': {
      if (!s.votingEndsAt || t < s.votingEndsAt) return
      const ids = livePlayerIds(room)
      const { topId, tie } = tallyVotes(s, ids)
      if (tie || !topId) {
        enterReveal(s, {
          winner: 'spy',
          selectedPlayerId: null,
          tie: true,
          spyGuessedCorrectly: null,
        })
        return
      }

      s.selectedPlayerId = topId
      if (s.spyPlayerId && topId === s.spyPlayerId) {
        // Spy caught: give one chance to guess.
        s.status = 'spy_guess'
        s.spyGuessEndsAt = t + SPY_GUESS_SEC * 1000
        s.votingEndsAt = null
        return
      }

      // Wrong player eliminated.
      enterReveal(s, {
        winner: 'spy',
        selectedPlayerId: topId,
        tie: false,
        spyGuessedCorrectly: null,
      })
      return
    }

    case 'spy_guess': {
      if (s.spyGuessEndsAt && t >= s.spyGuessEndsAt) {
        // No guess or time up => agents win (spy was caught).
        enterReveal(s, {
          winner: 'agents',
          selectedPlayerId: s.selectedPlayerId ?? null,
          tie: false,
          spyGuessedCorrectly: false,
        })
      }
      return
    }

    case 'reveal':
      return

    default:
      return
  }
}

