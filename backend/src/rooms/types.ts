export type GameKey = 'drawing' | 'meme' | 'spy' | 'mafia'

export type MafiaRole = 'mafia' | 'town' | 'doctor' | 'detective'

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
  spyGame?: {
    matchId: number
    status: 'lobby' | 'discussion' | 'voting' | 'spy_guess' | 'reveal'
    /** The secret word for this round (never send in `room:state` during play). */
    word: string | null
    spyPlayerId: string | null
    /** Discussion ends at (ms since epoch). */
    discussionEndsAt: number | null
    /** Voting ends at (ms since epoch). */
    votingEndsAt: number | null
    /** If Spy is caught, they have until this time to guess the word. */
    spyGuessEndsAt: number | null
    /** Who asked to start a vote early (must be >50% to trigger). */
    earlyVoteYes: Record<string, boolean>
    /** Anonymous votes: voter -> target. */
    votes: Record<string, string>
    /** Reveal payload (only set in reveal). */
    revealedSpyPlayerId: string | null
    revealedWord: string | null
    winner: 'spy' | 'agents' | null
    /** Who was selected by vote (if any). */
    selectedPlayerId: string | null
    /** Set when tie happens (spy wins instantly). */
    tie: boolean
    /** If Spy was caught, whether they guessed the word correctly. */
    spyGuessedCorrectly: boolean | null
  }
  mafiaGame?: {
    matchId: number
    round: number
    status: 'lobby' | 'night' | 'day' | 'voting' | 'results'
    /** Server-only; never broadcast in full. */
    roles: Record<string, MafiaRole>
    alive: Record<string, boolean>
    phaseEndsAt: number | null
    nightEndsAt: number | null
    dayEndsAt: number | null
    voteEndsAt: number | null
    resultsEndsAt: number | null
    mafiaKillVotes: Record<string, string>
    doctorSaveTarget: string | null
    /** Who the doctor protected last night; cannot be targeted again this night. */
    doctorPreviousNightProtectTarget: string | null
    detectiveInvestigateTarget: string | null
    /** If set, detective kills this player at night (mutually exclusive with investigate). */
    detectiveKillTarget: string | null
    /** Set at end of night before clear; emitted privately then cleared (not in public state). */
    pendingDetectiveReveal: {
      detectiveId: string
      targetId: string
      role: MafiaRole
    } | null
    dayVotes: Record<string, string>
    /** Alive players who asked to skip discussion and go straight to voting. */
    daySkipYes: Record<string, boolean>
    /** Living mafia who asked to end the night early (after submitting a kill vote). */
    nightSkipYes: Record<string, boolean>
    winner: 'town' | 'mafia' | null
    lastAnnouncement: {
      kind: 'night' | 'vote'
      playerId: string | null
      /** Second victim when both Mafia and Detective kills resolve in one night. */
      secondaryPlayerId?: string | null
      /** Full role of `playerId` when revealed (night or vote). */
      roleReveal: MafiaRole | null
      secondaryRoleReveal?: MafiaRole | null
      /** Night: who eliminated `playerId`. */
      primaryKillBy?: 'mafia' | 'detective'
      /** Night: who eliminated `secondaryPlayerId`. */
      secondaryKillBy?: 'mafia' | 'detective'
      /** Night: players targeted for elimination but protected by the Doctor. */
      doctorSavedPlayerIds?: string[]
    } | null
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

