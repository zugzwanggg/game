export const RANK_ORDER = ['A', 'K', 'Q', 'J', '10'] as const
export type LiarRank = (typeof RANK_ORDER)[number]

export type LiarCard = {
  id: string
  rank: LiarRank
  suit: 'S' | 'H' | 'D' | 'C'
}

export type LiarRevolver = {
  bulletChamber: number
  nextChamber: number
  pullCount: number
  /** Last pulls in order (for UI chamber marks). */
  pullHistory: ('click' | 'bang')[]
  eliminated: boolean
  immune: boolean
}

export type LiarStats = {
  bluffsDeclared: number
  timesCaughtLying: number
  successfulBluffs: number
  wrongAccusations: number
  pullsSurvived: number
}

export type LiarLastPlay = {
  playerId: string
  cards: LiarCard[]
  /** Verbal claim (may not match what was played). */
  claimedRank: LiarRank
  claimedCount: number
}

export type LiarGameState = {
  matchId: number
  status: 'lobby' | 'playing' | 'finished'
  phase: 'turn' | 'bluff' | 'resolving' | 'between_rounds'
  round: number
  order: string[]
  turnIndex: number
  hands: Record<string, LiarCard[]>
  pile: { playerId: string; cards: LiarCard[] }[]
  lastPlay: LiarLastPlay | null
  bluffEndsAt: number | null
  resolving: {
    accuserId: string
    wasLying: boolean
    shooterId: string
    revealedCards: LiarCard[]
    claimedRank: LiarRank
    claimedCount: number
    endsAt: number
  } | null
  shotResult: {
    playerId: string
    outcome: 'click' | 'bang'
    endsAt: number
  } | null
  revolvers: Record<string, LiarRevolver>
  stats: Record<string, LiarStats>
  winnerId: string | null
  log: { ts: number; text: string }[]
}
