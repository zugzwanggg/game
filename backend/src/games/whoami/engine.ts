import crypto from 'node:crypto'
import type { RoomState } from '../../rooms/types.js'
import { clearSpectatorFlagsForMatchStart } from '../../rooms/spectators.js'
import { normalizeGuess } from '../drawing/words.js'
import type { WhoAmIDifficultyTier, WhoAmIItemInput } from './types.js'

export const WHOAMI_MIN_PLAYERS = 2
export const WHOAMI_MAX_PLAYERS = 12

/** Offline / empty-DB fallback so matches can still start before seeding. */
export const WHOAMI_FALLBACK_ITEMS: WhoAmIItemInput[] = [
  { id: 'fb-char-1', name: 'Batman', type: 'character', category: 'movie', imageUrl: null },
  { id: 'fb-char-2', name: 'Spider-Man', type: 'character', category: 'movie', imageUrl: null },
  { id: 'fb-char-3', name: 'Harry Potter', type: 'character', category: 'movie', imageUrl: null },
  { id: 'fb-char-4', name: 'Darth Vader', type: 'character', category: 'movie', imageUrl: null },
  { id: 'fb-char-5', name: 'Sherlock Holmes', type: 'character', category: 'movie', imageUrl: null },
  { id: 'fb-char-6', name: 'Iron Man', type: 'character', category: 'movie', imageUrl: null },
  { id: 'fb-char-7', name: 'Wonder Woman', type: 'character', category: 'movie', imageUrl: null },
  { id: 'fb-char-8', name: 'Gollum', type: 'character', category: 'movie', imageUrl: null },
  { id: 'fb-char-9', name: 'James Bond', type: 'character', category: 'movie', imageUrl: null },
  { id: 'fb-char-10', name: 'Hermione Granger', type: 'character', category: 'movie', imageUrl: null },
  { id: 'fb-char-11', name: 'Mario', type: 'character', category: 'game', imageUrl: null },
  { id: 'fb-char-12', name: 'Link', type: 'character', category: 'game', imageUrl: null },
  { id: 'fb-char-13', name: 'Master Chief', type: 'character', category: 'game', imageUrl: null },
  { id: 'fb-char-14', name: 'Kratos', type: 'character', category: 'game', imageUrl: null },
  { id: 'fb-char-15', name: 'Pikachu', type: 'character', category: 'game', imageUrl: null },
  { id: 'fb-per-1', name: 'Taylor Swift', type: 'person', category: 'musician', imageUrl: null },
  { id: 'fb-per-2', name: 'Shakira', type: 'person', category: 'musician', imageUrl: null },
  { id: 'fb-per-3', name: 'Elon Musk', type: 'person', category: 'public_figure', imageUrl: null },
  { id: 'fb-per-4', name: 'Cristiano Ronaldo', type: 'person', category: 'athlete', imageUrl: null },
  { id: 'fb-per-5', name: 'LeBron James', type: 'person', category: 'athlete', imageUrl: null },
  { id: 'fb-per-6', name: 'Tom Hanks', type: 'person', category: 'actor', imageUrl: null },
  { id: 'fb-per-7', name: 'Morgan Freeman', type: 'person', category: 'actor', imageUrl: null },
  { id: 'fb-per-8', name: 'Dwayne Johnson', type: 'person', category: 'actor', imageUrl: null },
  { id: 'fb-per-9', name: 'Rihanna', type: 'person', category: 'musician', imageUrl: null },
  { id: 'fb-per-10', name: 'Serena Williams', type: 'person', category: 'athlete', imageUrl: null },
  { id: 'fb-per-11', name: 'Oprah Winfrey', type: 'person', category: 'public_figure', imageUrl: null },
  { id: 'fb-per-12', name: 'Barack Obama', type: 'person', category: 'public_figure', imageUrl: null },
  { id: 'fb-per-13', name: 'Lionel Messi', type: 'person', category: 'athlete', imageUrl: null },
  { id: 'fb-per-14', name: 'Albert Einstein', type: 'person', category: 'public_figure', imageUrl: null },
  { id: 'fb-per-15', name: 'Madonna', type: 'person', category: 'musician', imageUrl: null },
  { id: 'fb-per-16', name: 'Keanu Reeves', type: 'person', category: 'actor', imageUrl: null },
  { id: 'fb-per-17', name: 'Jennifer Lawrence', type: 'person', category: 'actor', imageUrl: null },
  { id: 'fb-per-18', name: 'Michael Jordan', type: 'person', category: 'athlete', imageUrl: null },
  { id: 'fb-per-19', name: 'Billie Eilish', type: 'person', category: 'musician', imageUrl: null },
  { id: 'fb-per-20', name: 'Mr Beast', type: 'person', category: 'public_figure', imageUrl: null },
  { id: 'fb-char-16', name: 'Superman', type: 'character', category: 'movie', imageUrl: null },
  { id: 'fb-char-17', name: 'The Joker', type: 'character', category: 'movie', imageUrl: null },
  { id: 'fb-char-18', name: 'Yoda', type: 'character', category: 'movie', imageUrl: null },
  { id: 'fb-char-19', name: 'Black Panther', type: 'character', category: 'movie', imageUrl: null },
  { id: 'fb-char-20', name: 'Lara Croft', type: 'character', category: 'game', imageUrl: null },
]

function shuffle<T>(arr: T[]): T[] {
  const a = [...arr]
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[a[i], a[j]] = [a[j]!, a[i]!]
  }
  return a
}

function fallbackDifficulty(it: WhoAmIItemInput): 'easy' | 'medium' | 'hard' {
  if (it.difficulty) return it.difficulty
  let h = 0
  for (let i = 0; i < it.id.length; i++) h += it.id.charCodeAt(i)
  return (['easy', 'medium', 'hard'] as const)[h % 3]!
}

export function pickItemsForPlayerCount(
  poolItems: WhoAmIItemInput[],
  playerCount: number,
  itemType: 'character' | 'person',
  difficultyTier: WhoAmIDifficultyTier,
): WhoAmIItemInput[] {
  const n = Math.max(
    WHOAMI_MIN_PLAYERS,
    Math.min(WHOAMI_MAX_PLAYERS, Math.floor(playerCount)),
  )
  const pool = poolItems.filter((it) => it.type === itemType)
  const fallbacks = WHOAMI_FALLBACK_ITEMS.filter((it) => it.type === itemType)
  const uniq: WhoAmIItemInput[] = []
  const seen = new Set<string>()
  for (const it of shuffle([...pool])) {
    const key = normalizeGuess(it.name)
    if (!key || seen.has(key)) continue
    seen.add(key)
    uniq.push(it)
    if (uniq.length >= n) break
  }
  for (const it of shuffle([...fallbacks])) {
    if (uniq.length >= n) break
    if (difficultyTier !== 'any' && fallbackDifficulty(it) !== difficultyTier) continue
    const key = normalizeGuess(it.name)
    if (!key || seen.has(key)) continue
    seen.add(key)
    uniq.push(it)
  }
  return uniq.slice(0, n)
}

export function startWhoAmIMatch(room: RoomState, t: number, items: WhoAmIItemInput[]): boolean {
  if (room.game !== 'whoami' || !room.whoamiGame) return false
  const g = room.whoamiGame
  const ids = room.players.map((p) => p.id)
  if (ids.length < WHOAMI_MIN_PLAYERS || ids.length > WHOAMI_MAX_PLAYERS) return false
  if (items.length < ids.length) return false

  clearSpectatorFlagsForMatchStart(room)
  g.matchId += 1
  g.status = 'playing'
  g.startedAt = t
  g.assignments = {}
  g.solved = {}
  const shuffledItems = shuffle(items)
  ids.forEach((pid, i) => {
    const it = shuffledItems[i]!
    g.assignments[pid] = {
      itemId: it.id,
      name: it.name,
      type: it.type,
      category: it.category,
      imageUrl: it.imageUrl,
    }
    g.solved[pid] = false
  })
  return true
}

function allWhoAmIAssignmentsSolved(g: NonNullable<RoomState['whoamiGame']>): boolean {
  const ids = Object.keys(g.assignments)
  if (ids.length === 0) return false
  return ids.every((id) => g.solved[id] === true)
}

/** Returns match to lobby; keeps category and difficulty. */
function finishWhoAmIRoundToLobby(room: RoomState, t: number, announcement: string): boolean {
  const g = room.whoamiGame
  if (!g || room.game !== 'whoami' || g.status !== 'playing') return false
  g.status = 'lobby'
  g.assignments = {}
  g.solved = {}
  g.startedAt = null
  room.chat.push({
    id: crypto.randomUUID(),
    author: 'Game',
    text: announcement,
    ts: t,
    variant: 'system',
  })
  return true
}

export function pruneWhoAmIForPlayers(room: RoomState) {
  const g = room.whoamiGame
  if (!g || room.game !== 'whoami') return
  const live = new Set(room.players.map((p) => p.id))
  for (const k of Object.keys(g.assignments)) {
    if (!live.has(k)) {
      delete g.assignments[k]
      delete g.solved[k]
    }
  }
  if (room.players.length < WHOAMI_MIN_PLAYERS && g.status !== 'lobby') {
    g.status = 'lobby'
    g.assignments = {}
    g.solved = {}
    g.startedAt = null
    g.categoryFilter = null
    g.difficultyFilter = null
  }
}

export function tryWhoAmIGuess(
  room: RoomState,
  playerId: string,
  rawGuess: string,
  t: number,
): { ok: boolean; correct?: boolean } {
  const g = room.whoamiGame
  if (!g || room.game !== 'whoami' || g.status !== 'playing') return { ok: false }
  const a = g.assignments[playerId]
  if (!a || g.solved[playerId]) return { ok: false }
  const guess = normalizeGuess(String(rawGuess ?? '').trim().slice(0, 80))
  if (!guess) return { ok: false }
  const target = normalizeGuess(a.name)
  const correct = guess === target
  if (correct) {
    g.solved[playerId] = true
    room.chat.push({
      id: crypto.randomUUID(),
      author: 'Game',
      text: `${room.players.find((p) => p.id === playerId)?.displayName ?? 'Someone'} guessed their identity.`,
      ts: t,
      variant: 'system',
    })
    if (allWhoAmIAssignmentsSolved(g)) {
      finishWhoAmIRoundToLobby(
        room,
        t,
        'Everyone found their identity. The host can start another match from the menu when you are ready.',
      )
    }
  }
  return { ok: true, correct }
}

export function toItemInputsFromRows(
  rows: {
    id: string
    name: string
    type: string
    category: string
    image_url: string | null
    difficulty?: string
  }[],
): WhoAmIItemInput[] {
  return rows
    .filter((r) => (r.type === 'character' || r.type === 'person') && r.name?.trim())
    .map((r) => {
      const d = r.difficulty
      const difficulty =
        d === 'easy' || d === 'medium' || d === 'hard' ? d : ('medium' as const)
      return {
        id: r.id,
        name: r.name.trim(),
        type: r.type as 'character' | 'person',
        category: r.category,
        imageUrl: r.image_url,
        difficulty,
      }
    })
}
