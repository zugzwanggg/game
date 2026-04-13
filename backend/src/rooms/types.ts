export type GameKey = 'drawing' | 'meme'

export type RoomPlayer = {
  id: string
  kind: 'user' | 'guest'
  displayName: string
  joinedAt: number
}

export type DrawingStroke = {
  id: string
  points: { x: number; y: number }[]
  color: string
  width: number
}

export type MemeGif = {
  id: string
  url: string
  previewUrl?: string
  width?: number
  height?: number
  title?: string
}

export type RoomState = {
  code: string
  game: GameKey
  isPrivate: boolean
  createdAt: number
  createdByUserId: string
  lastActivityAt: number
  expiresAt: number
  players: RoomPlayer[]
  drawing: {
    strokes: DrawingStroke[]
  }
  chat: {
    id: string
    author: string
    text: string
    ts: number
    variant?: 'chat' | 'system' | 'correct'
  }[]
  memeGame?: {
    matchId: number
    status:
      | 'lobby'
      | 'context_vote'
      | 'context_result'
      | 'gif_pick'
      | 'reveal'
      | 'gif_vote'
      | 'round_break'
      | 'leaderboard'
    round: number
    maxRounds: number
    seed: string
    prompts: [string, string]
    contextVotes: Record<string, 0 | 1>
    winningPromptIndex: 0 | 1 | null
    submissions: Record<string, { promptIndex: 0 | 1; gif: MemeGif }>
    gifVotes: Record<string, string>
    scores: Record<string, number>
    phaseEndsAt: number | null
    revealEndsAt: number | null
    leaderboardEndsAt: number | null
    roundBreakEndsAt: number | null
  }
  drawingGame?: {
    status: 'lobby' | 'playing' | 'reveal' | 'leaderboard'
    /** Increments every time a new match starts (for dedup keys). */
    matchId: number
    /** Match round number, 1..maxRounds. A round includes every player drawing once in order. */
    matchRound: number
    /** Which player's turn within the current match round (0..order.length-1). */
    turnIndex: number
    /** Fixed draw order for this match. */
    order: string[]
    drawerPlayerId: string | null
    word: string | null
    wordHint: string | null
    endsAt: number | null
    revealEndsAt: number | null
    leaderboardEndsAt: number | null
    solvedByPlayerId: string | null
    scores: Record<string, number>
  }
  round: {
    phase: 'drawing' | 'reveal' | 'guessing'
    endsAt: number
    revealEndsAt: number | null
  }
}

