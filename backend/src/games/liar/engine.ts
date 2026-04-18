import crypto from 'node:crypto'
import type { RoomState } from '../../rooms/types.js'
import { clearSpectatorFlagsForMatchStart } from '../../rooms/spectators.js'
import type { LiarCard, LiarGameState, LiarRank, LiarRevolver } from './types.js'
import { RANK_ORDER } from './types.js'

export const LIAR_MIN_PLAYERS = 2
export const LIAR_MAX_PLAYERS = 6
export const LIAR_HAND_SIZE = 5
export const BLUFF_WINDOW_MS = 4000
export const REVEAL_HOLD_MS = 2800
export const POST_SHOT_MS = 2200

export type {
  LiarCard,
  LiarGameState,
  LiarRank,
  LiarRevolver,
  LiarStats,
} from './types.js'
export { RANK_ORDER } from './types.js'

const SUITS: LiarCard['suit'][] = ['S', 'H', 'D', 'C']

function buildOneDeck(): LiarCard[] {
  const cards: LiarCard[] = []
  for (const suit of SUITS) {
    for (const rank of RANK_ORDER) {
      cards.push({
        id: crypto.randomUUID(),
        rank,
        suit,
      })
    }
  }
  return cards
}

function shuffle<T>(arr: T[]): T[] {
  const a = [...arr]
  for (let i = a.length - 1; i > 0; i--) {
    const j = crypto.randomInt(0, i + 1)
    ;[a[i], a[j]] = [a[j]!, a[i]!]
  }
  return a
}

function deckCopiesForPlayers(n: number): number {
  const need = n * LIAR_HAND_SIZE
  return Math.max(1, Math.ceil(need / 20))
}

function parseClaimedRank(raw: string): LiarRank | null {
  const s = String(raw ?? '').trim()
  return (RANK_ORDER as readonly string[]).includes(s) ? (s as LiarRank) : null
}

/** Claim matches reality: same count and every played card is the claimed rank. */
export function claimIsTruthful(
  cards: LiarCard[],
  claimedRank: LiarRank,
  claimedCount: number,
): boolean {
  return (
    claimedCount === cards.length && cards.length > 0 && cards.every((c) => c.rank === claimedRank)
  )
}

function aliveIds(room: RoomState, g: LiarGameState): string[] {
  return room.players.map((p) => p.id).filter((id) => !g.revolvers[id]?.eliminated)
}

function appendLog(g: LiarGameState, text: string, now: number) {
  g.log.push({ ts: now, text })
  if (g.log.length > 200) g.log = g.log.slice(-200)
}

function ensureStats(g: LiarGameState, playerId: string) {
  if (!g.stats[playerId]) {
    g.stats[playerId] = {
      bluffsDeclared: 0,
      timesCaughtLying: 0,
      successfulBluffs: 0,
      wrongAccusations: 0,
      pullsSurvived: 0,
    }
  }
}

function initRevolver(): LiarRevolver {
  return {
    bulletChamber: crypto.randomInt(0, 6),
    nextChamber: crypto.randomInt(0, 6),
    pullCount: 0,
    pullHistory: [],
    eliminated: false,
    immune: false,
  }
}

/** Pull trigger: returns outcome, mutates revolver. */
export function pullTrigger(r: LiarRevolver): 'click' | 'bang' {
  const hit = r.nextChamber === r.bulletChamber
  r.pullCount += 1
  r.nextChamber = (r.nextChamber + 1) % 6
  if (hit) {
    r.eliminated = true
    r.pullHistory.push('bang')
    return 'bang'
  }
  r.pullHistory.push('click')
  if (r.pullCount >= 6) {
    r.immune = true
  }
  return 'click'
}

export function startLiarMatch(room: RoomState, now: number) {
  const g = room.liarGame
  if (!g || room.game !== 'liar') return
  const players = [...room.players].sort((a, b) => a.joinedAt - b.joinedAt)
  if (players.length < LIAR_MIN_PLAYERS || players.length > LIAR_MAX_PLAYERS) return

  clearSpectatorFlagsForMatchStart(room)

  g.matchId += 1
  g.status = 'playing'
  g.phase = 'between_rounds'
  g.round = 0
  g.winnerId = null
  g.hands = {}
  g.pile = []
  g.lastPlay = null
  g.bluffEndsAt = null
  g.resolving = null
  g.shotResult = null
  g.revolvers = {}
  g.stats = {}
  g.log = []

  for (const p of players) {
    g.revolvers[p.id] = initRevolver()
    ensureStats(g, p.id)
  }

  g.order = players.map((p) => p.id)
  g.turnIndex = 0

  appendLog(g, 'Match started. Russian roulette revolvers loaded.', now)
  startRound(room, now)
}

function startRound(room: RoomState, now: number) {
  const g = room.liarGame!
  const ids = aliveIds(room, g)
  if (ids.length <= 1) {
    g.status = 'finished'
    g.winnerId = ids[0] ?? null
    g.phase = 'between_rounds'
    appendLog(g, g.winnerId ? `Winner: ${nameOf(room, g.winnerId)}.` : 'Game over.', now)
    return
  }

  g.round += 1
  g.pile = []
  g.lastPlay = null
  g.bluffEndsAt = null
  g.resolving = null
  g.shotResult = null
  g.phase = 'turn'

  for (const id of Object.keys(g.revolvers)) {
    g.revolvers[id]!.immune = false
  }

  const copies = deckCopiesForPlayers(ids.length)
  let deck = shuffle(Array.from({ length: copies }, () => buildOneDeck()).flat())
  g.hands = {}
  for (const id of ids) {
    g.hands[id] = deck.splice(0, LIAR_HAND_SIZE)
  }

  g.order = ids
  const startIx = g.turnIndex % g.order.length
  g.turnIndex = startIx

  appendLog(g, `Round ${g.round}: deal ${LIAR_HAND_SIZE} cards each. Declare any rank and count when you play.`, now)
}

function nameOf(room: RoomState, id: string): string {
  return room.players.find((p) => p.id === id)?.displayName ?? 'Player'
}

export function getActiveLiarPlayerId(g: LiarGameState): string | null {
  if (!g.order.length) return null
  return g.order[g.turnIndex % g.order.length] ?? null
}

function activePlayerId(g: LiarGameState): string | null {
  return getActiveLiarPlayerId(g)
}

function advanceTurn(room: RoomState, g: LiarGameState) {
  const alive = aliveIds(room, g)
  if (!alive.length) return
  g.order = g.order.filter((id) => alive.includes(id))
  if (!g.order.length) return
  g.turnIndex = (g.turnIndex + 1) % g.order.length
}

export function tryPlayCards(
  room: RoomState,
  playerId: string,
  cardIds: string[],
  claimedRankRaw: string,
  claimedCount: number,
  now: number,
): boolean {
  const g = room.liarGame
  if (!g || room.game !== 'liar' || g.status !== 'playing') return false
  if (g.phase !== 'turn') return false
  if (playerId !== activePlayerId(g)) return false

  const claimedRank = parseClaimedRank(claimedRankRaw)
  if (!claimedRank) return false
  if (!Number.isInteger(claimedCount) || claimedCount < 1 || claimedCount > 3) return false

  const ids = [...new Set(cardIds.map((x) => String(x).trim()))]
  if (ids.length < 1 || ids.length > 3) return false

  const hand = g.hands[playerId]
  if (!hand) return false
  const picked: LiarCard[] = []
  for (const cid of ids) {
    const ix = hand.findIndex((c) => c.id === cid)
    if (ix < 0) return false
    picked.push(hand[ix]!)
  }

  for (const c of picked) {
    const ix = g.hands[playerId]!.findIndex((x) => x.id === c.id)
    if (ix >= 0) g.hands[playerId]!.splice(ix, 1)
  }

  g.pile.push({ playerId, cards: picked })
  g.lastPlay = { playerId, cards: picked, claimedRank, claimedCount }
  g.phase = 'bluff'
  g.bluffEndsAt = now + BLUFF_WINDOW_MS

  const decl = nameOf(room, playerId)
  ensureStats(g, playerId)
  g.stats[playerId]!.bluffsDeclared += 1

  appendLog(
    g,
    `${decl} puts ${picked.length} card(s) face down, claims ${claimedCount} × ${claimedRank}.`,
    now,
  )

  const h = g.hands[playerId]
  if (h && h.length === 0) {
    appendLog(g, `${decl} emptied their hand and survives this round.`, now)
    g.phase = 'between_rounds'
    g.bluffEndsAt = null
    g.lastPlay = null
    g.pile = []
    windowRoundAdvance(room, now)
    return true
  }

  return true
}

function windowRoundAdvance(room: RoomState, now: number) {
  startRound(room, now)
}

export function tryCallLiar(room: RoomState, accuserId: string, now: number): boolean {
  const g = room.liarGame
  if (!g || room.game !== 'liar' || g.status !== 'playing') return false
  if (g.phase !== 'bluff' || !g.lastPlay || !g.bluffEndsAt) return false
  if (now > g.bluffEndsAt) return false
  if (accuserId === g.lastPlay.playerId) return false
  if (g.revolvers[accuserId]?.eliminated) return false

  const declared = g.lastPlay
  const wasLying = !claimIsTruthful(declared.cards, declared.claimedRank, declared.claimedCount)
  const shooterId = wasLying ? declared.playerId : accuserId

  if (!wasLying) {
    ensureStats(g, accuserId)
    g.stats[accuserId]!.wrongAccusations += 1
  } else {
    ensureStats(g, declared.playerId)
    g.stats[declared.playerId]!.timesCaughtLying += 1
  }

  appendLog(
    g,
    `${nameOf(room, accuserId)} calls Liar! ${wasLying ? `${nameOf(room, declared.playerId)} was lying.` : `${nameOf(room, declared.playerId)} told the truth.`}`,
    now,
  )

  g.phase = 'resolving'
  g.bluffEndsAt = null
  g.resolving = {
    accuserId,
    wasLying,
    shooterId,
    revealedCards: [...declared.cards],
    claimedRank: declared.claimedRank,
    claimedCount: declared.claimedCount,
    endsAt: now + REVEAL_HOLD_MS,
  }
  return true
}

function applyShot(room: RoomState, shooterId: string, now: number) {
  const g = room.liarGame!
  const rev = g.revolvers[shooterId]
  if (!rev || rev.eliminated) return

  const outcome = pullTrigger(rev)
  ensureStats(g, shooterId)
  if (outcome === 'click') g.stats[shooterId]!.pullsSurvived += 1

  const sn = nameOf(room, shooterId)
  appendLog(g, outcome === 'bang' ? `BANG! ${sn} is eliminated.` : `CLICK. ${sn} survives.`, now)

  g.shotResult = {
    playerId: shooterId,
    outcome,
    endsAt: now + POST_SHOT_MS,
  }
  g.resolving = null
}

export function tickLiarGame(room: RoomState, now: number) {
  const g = room.liarGame
  if (!g || room.game !== 'liar' || g.status !== 'playing') return

  if (g.phase === 'bluff' && g.bluffEndsAt && now >= g.bluffEndsAt) {
    appendLog(g, 'No challenge. Cards stay hidden.', now)
    if (g.lastPlay) {
      const lp = g.lastPlay
      const lied = !claimIsTruthful(lp.cards, lp.claimedRank, lp.claimedCount)
      if (lied) {
        ensureStats(g, lp.playerId)
        g.stats[lp.playerId]!.successfulBluffs += 1
      }
    }
    g.phase = 'turn'
    g.bluffEndsAt = null
    g.lastPlay = null
    advanceTurn(room, g)
    return
  }

  if (g.phase === 'resolving' && g.resolving && now >= g.resolving.endsAt) {
    const shooterId = g.resolving.shooterId
    applyShot(room, shooterId, now)
    return
  }

  if (g.shotResult && now >= g.shotResult.endsAt) {
    const eliminated = g.revolvers[g.shotResult.playerId]?.eliminated
    g.shotResult = null
    const alive = aliveIds(room, g)
    if (alive.length <= 1) {
      g.status = 'finished'
      g.winnerId = alive[0] ?? null
      g.phase = 'between_rounds'
      appendLog(g, g.winnerId ? `Winner: ${nameOf(room, g.winnerId!)}.` : 'Game over.', now)
      return
    }
    if (eliminated) {
      g.pile = []
      g.lastPlay = null
      g.turnIndex = 0
    }
    windowRoundAdvance(room, now)
  }
}

export function pruneLiarForPlayers(room: RoomState) {
  const g = room.liarGame
  if (!g || room.game !== 'liar') return
  const ids = new Set(room.players.map((p) => p.id))
  for (const k of Object.keys(g.hands)) {
    if (!ids.has(k)) delete g.hands[k]
  }
  for (const k of Object.keys(g.revolvers)) {
    if (!ids.has(k)) delete g.revolvers[k]
  }
  for (const k of Object.keys(g.stats)) {
    if (!ids.has(k)) delete g.stats[k]
  }
  g.order = g.order.filter((id) => ids.has(id))
}
