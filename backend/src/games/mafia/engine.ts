import crypto from 'node:crypto'
import type { MafiaRole, RoomState } from '../../rooms/types.js'

export const MAFIA_MIN = 5
export const MAFIA_MAX = 12

export const MAFIA_NIGHT_SEC = Number(process.env.MAFIA_NIGHT_SEC ?? 40)
export const MAFIA_DAY_SEC = Number(process.env.MAFIA_DAY_SEC ?? 180) // 3 min
export const MAFIA_VOTE_SEC = Number(process.env.MAFIA_VOTE_SEC ?? 25)
/** When every living player has voted, remaining vote time is capped to this many seconds. */
export const MAFIA_VOTE_ALL_IN_REM_SEC = Number(process.env.MAFIA_VOTE_ALL_IN_REM_SEC ?? 5)
export const MAFIA_RESULTS_SEC = Number(process.env.MAFIA_RESULTS_SEC ?? 8)
export const MAFIA_TIE_MODE = (process.env.MAFIA_TIE_MODE ?? 'none') as 'none' | 'random'
export const MAFIA_GHOST_CHAT = process.env.MAFIA_GHOST_CHAT === '1'
/** On by default; set `MAFIA_ENABLE_DOCTOR=0` to disable. Works from 5 players up. */
export const MAFIA_ENABLE_DOCTOR = process.env.MAFIA_ENABLE_DOCTOR !== '0'
/** On by default; set `MAFIA_ENABLE_DETECTIVE=0` to disable. Works from 5 players up. */
export const MAFIA_ENABLE_DETECTIVE = process.env.MAFIA_ENABLE_DETECTIVE !== '0'

function shuffle<T>(arr: T[]): T[] {
  const a = [...arr]
  for (let i = a.length - 1; i > 0; i--) {
    const j = crypto.randomInt(0, i + 1)
    ;[a[i], a[j]] = [a[j], a[i]]
  }
  return a
}

function mafiaCountForPlayers(n: number): number {
  if (n <= 6) return 1
  if (n <= 9) return 2
  return 3
}

function assignRoles(playerIds: string[]): Record<string, MafiaRole> {
  const n = playerIds.length
  const m = mafiaCountForPlayers(n)
  const shuffled = shuffle(playerIds)
  const roles: Record<string, MafiaRole> = {}
  for (let i = 0; i < m; i++) roles[shuffled[i]!] = 'mafia'
  let idx = m
  if (MAFIA_ENABLE_DOCTOR && n >= MAFIA_MIN) {
    roles[shuffled[idx++]!] = 'doctor'
  }
  if (MAFIA_ENABLE_DETECTIVE && n >= MAFIA_MIN) {
    roles[shuffled[idx++]!] = 'detective'
  }
  for (let i = idx; i < n; i++) {
    const id = shuffled[i]!
    if (!roles[id]) roles[id] = 'town'
  }
  for (const id of playerIds) {
    if (!roles[id]) roles[id] = 'town'
  }
  return roles
}

export function startMafiaMatch(room: RoomState, t: number) {
  const g = room.mafiaGame
  if (!g || room.game !== 'mafia') return
  if (room.players.length < MAFIA_MIN || room.players.length > MAFIA_MAX) return
  if (g.status === 'results') {
    endMafiaResults(room, g)
  }
  if (g.status !== 'lobby') return

  const ids = room.players.map((p) => p.id)
  g.matchId += 1
  g.round = 1
  g.status = 'night'
  g.roles = assignRoles(ids)
  g.alive = Object.fromEntries(ids.map((id) => [id, true]))
  g.winner = null
  g.phaseEndsAt = t + MAFIA_NIGHT_SEC * 1000
  g.nightEndsAt = g.phaseEndsAt
  g.dayEndsAt = null
  g.voteEndsAt = null
  g.resultsEndsAt = null
  g.mafiaKillVotes = {}
  g.doctorSaveTarget = null
  g.doctorPreviousNightProtectTarget = null
  g.detectiveInvestigateTarget = null
  g.detectiveKillTarget = null
  g.dayVotes = {}
  g.daySkipYes = {}
  g.nightSkipYes = {}
  g.lastAnnouncement = null
  g.pendingDetectiveReveal = null
}

function aliveIds(g: NonNullable<RoomState['mafiaGame']>): string[] {
  return Object.entries(g.alive)
    .filter(([, a]) => a)
    .map(([id]) => id)
}

function mafiaIds(g: NonNullable<RoomState['mafiaGame']>): string[] {
  return Object.entries(g.roles)
    .filter(([id, r]) => r === 'mafia' && g.alive[id])
    .map(([id]) => id)
}

function townCount(g: NonNullable<RoomState['mafiaGame']>): number {
  return aliveIds(g).filter((id) => g.roles[id] !== 'mafia').length
}

function mafiaAliveCount(g: NonNullable<RoomState['mafiaGame']>): number {
  return aliveIds(g).filter((id) => g.roles[id] === 'mafia').length
}

function checkWin(g: NonNullable<RoomState['mafiaGame']>): 'town' | 'mafia' | null {
  const m = mafiaAliveCount(g)
  const t = townCount(g)
  if (m === 0) return 'town'
  if (m >= t) return 'mafia'
  return null
}

function pickMajorityTarget(votes: Record<string, string>, voters: string[]): string | null {
  const counts = new Map<string, number>()
  for (const v of voters) {
    const tgt = votes[v]
    if (!tgt) continue
    counts.set(tgt, (counts.get(tgt) ?? 0) + 1)
  }
  let best: string | null = null
  let bestC = 0
  for (const [id, c] of counts) {
    if (c > bestC) {
      bestC = c
      best = id
    }
  }
  if (!best) return null
  const tied = [...counts.entries()].filter(([, c]) => c === bestC).map(([id]) => id)
  if (tied.length > 1) {
    return MAFIA_TIE_MODE === 'random' ? tied[crypto.randomInt(0, tied.length)]! : null
  }
  return best
}

function doctorBlocksKillOn(g: NonNullable<RoomState['mafiaGame']>, targetId: string): boolean {
  const docId = Object.entries(g.roles).find(([, r]) => r === 'doctor')?.[0]
  return Boolean(docId && g.alive[docId] && g.doctorSaveTarget === targetId)
}

function roleOfVictim(g: NonNullable<RoomState['mafiaGame']>, victimId: string): MafiaRole {
  return g.roles[victimId] ?? 'town'
}

function setNightEliminationAnnouncement(
  g: NonNullable<RoomState['mafiaGame']>,
  killedM: string | null,
  killedD: string | null,
  doctorSavedPlayerIds: string[],
) {
  const saves =
    doctorSavedPlayerIds.length > 0 ? [...doctorSavedPlayerIds] : undefined

  if (!killedM && !killedD) {
    g.lastAnnouncement =
      saves && saves.length > 0
        ? {
            kind: 'night',
            playerId: null,
            roleReveal: null,
            doctorSavedPlayerIds: saves,
          }
        : { kind: 'night', playerId: null, roleReveal: null }
    return
  }

  if (killedM && !killedD) {
    g.lastAnnouncement = {
      kind: 'night',
      playerId: killedM,
      roleReveal: roleOfVictim(g, killedM),
      primaryKillBy: 'mafia',
      doctorSavedPlayerIds: saves,
    }
    return
  }

  if (!killedM && killedD) {
    g.lastAnnouncement = {
      kind: 'night',
      playerId: killedD,
      roleReveal: roleOfVictim(g, killedD),
      primaryKillBy: 'detective',
      doctorSavedPlayerIds: saves,
    }
    return
  }

  g.lastAnnouncement = {
    kind: 'night',
    playerId: killedM!,
    roleReveal: roleOfVictim(g, killedM!),
    primaryKillBy: 'mafia',
    secondaryPlayerId: killedD!,
    secondaryRoleReveal: roleOfVictim(g, killedD!),
    secondaryKillBy: 'detective',
    doctorSavedPlayerIds: saves,
  }
}

function clearNightActionFields(g: NonNullable<RoomState['mafiaGame']>) {
  g.mafiaKillVotes = {}
  g.doctorSaveTarget = null
  g.detectiveInvestigateTarget = null
  g.detectiveKillTarget = null
}

/** Remember who was protected this night for the next night’s “no repeat” rule, then clear night picks. */
function endNightAndClearActions(g: NonNullable<RoomState['mafiaGame']>) {
  g.doctorPreviousNightProtectTarget = g.doctorSaveTarget
  clearNightActionFields(g)
}

/** Stash investigation result before night fields are cleared; socket emits privately at dawn. */
function queueDetectiveRevealIfNeeded(g: NonNullable<RoomState['mafiaGame']>) {
  const targetId = g.detectiveInvestigateTarget
  if (!targetId) return
  const detectiveId = Object.entries(g.roles).find(([, r]) => r === 'detective')?.[0]
  if (!detectiveId || g.alive[detectiveId] !== true) return
  const role = g.roles[targetId]
  if (!role) return
  g.pendingDetectiveReveal = { detectiveId, targetId, role }
}

function endNight(_room: RoomState, g: NonNullable<RoomState['mafiaGame']>, t: number) {
  const doctorSavedPlayerIds: string[] = []
  const mids = mafiaIds(g)
  let mafiaKill = pickMajorityTarget(g.mafiaKillVotes, mids)
  if (mafiaKill && !g.alive[mafiaKill]) mafiaKill = null
  if (mafiaKill && doctorBlocksKillOn(g, mafiaKill)) {
    doctorSavedPlayerIds.push(mafiaKill)
    mafiaKill = null
  }

  let detKill: string | null = g.detectiveKillTarget
  if (detKill && !g.alive[detKill]) detKill = null
  if (detKill && doctorBlocksKillOn(g, detKill)) {
    doctorSavedPlayerIds.push(detKill)
    detKill = null
  }

  let killedM: string | null = null
  let killedD: string | null = null

  if (mafiaKill && g.alive[mafiaKill]) {
    g.alive[mafiaKill] = false
    killedM = mafiaKill
  }

  let w = checkWin(g)
  if (w) {
    g.winner = w
    g.status = 'results'
    g.phaseEndsAt = t + MAFIA_RESULTS_SEC * 1000
    g.resultsEndsAt = g.phaseEndsAt
    g.nightEndsAt = null
    g.dayEndsAt = null
    g.voteEndsAt = null
    g.nightSkipYes = {}
    setNightEliminationAnnouncement(g, killedM, null, doctorSavedPlayerIds)
    queueDetectiveRevealIfNeeded(g)
    endNightAndClearActions(g)
    return
  }

  if (detKill && g.alive[detKill]) {
    g.alive[detKill] = false
    killedD = detKill
  }

  w = checkWin(g)
  if (w) {
    g.winner = w
    g.status = 'results'
    g.phaseEndsAt = t + MAFIA_RESULTS_SEC * 1000
    g.resultsEndsAt = g.phaseEndsAt
    g.nightEndsAt = null
    g.dayEndsAt = null
    g.voteEndsAt = null
    g.nightSkipYes = {}
    setNightEliminationAnnouncement(g, killedM, killedD, doctorSavedPlayerIds)
    queueDetectiveRevealIfNeeded(g)
    endNightAndClearActions(g)
    return
  }

  setNightEliminationAnnouncement(g, killedM, killedD, doctorSavedPlayerIds)
  queueDetectiveRevealIfNeeded(g)
  g.status = 'day'
  g.phaseEndsAt = t + MAFIA_DAY_SEC * 1000
  g.dayEndsAt = g.phaseEndsAt
  g.nightEndsAt = null
  g.voteEndsAt = null
  g.nightSkipYes = {}
  g.daySkipYes = {}
  endNightAndClearActions(g)
}

function endDay(_room: RoomState, g: NonNullable<RoomState['mafiaGame']>, t: number) {
  g.status = 'voting'
  g.phaseEndsAt = t + MAFIA_VOTE_SEC * 1000
  g.voteEndsAt = g.phaseEndsAt
  g.dayEndsAt = null
  g.dayVotes = {}
  g.daySkipYes = {}
}

function endVoting(_room: RoomState, g: NonNullable<RoomState['mafiaGame']>, t: number) {
  const voters = aliveIds(g)
  const counts = new Map<string, number>()
  for (const vid of voters) {
    const tgt = g.dayVotes[vid]
    if (!tgt || tgt === vid) continue
    counts.set(tgt, (counts.get(tgt) ?? 0) + 1)
  }
  let top: string | null = null
  let topC = 0
  for (const [id, c] of counts) {
    if (c > topC) {
      topC = c
      top = id
    }
  }
  const tied = [...counts.entries()].filter(([, c]) => c === topC && topC > 0).map(([id]) => id)
  let eliminated: string | null = null
  if (tied.length > 1) {
    if (MAFIA_TIE_MODE === 'random' && tied.length) {
      eliminated = tied[crypto.randomInt(0, tied.length)]!
    }
  } else if (top && topC > 0) {
    eliminated = top
  }

  if (eliminated && g.alive[eliminated]) {
    g.alive[eliminated] = false
    g.lastAnnouncement = {
      kind: 'vote',
      playerId: eliminated,
      roleReveal: g.roles[eliminated] ?? 'town',
    }
  } else {
    g.lastAnnouncement = { kind: 'vote', playerId: null, roleReveal: null }
  }

  const w = checkWin(g)
  if (w) {
    g.winner = w
    g.status = 'results'
    g.phaseEndsAt = t + MAFIA_RESULTS_SEC * 1000
    g.resultsEndsAt = g.phaseEndsAt
    g.voteEndsAt = null
    return
  }

  g.round += 1
  g.status = 'night'
  g.phaseEndsAt = t + MAFIA_NIGHT_SEC * 1000
  g.nightEndsAt = g.phaseEndsAt
  g.voteEndsAt = null
  g.dayVotes = {}
  g.mafiaKillVotes = {}
  g.doctorSaveTarget = null
  g.detectiveInvestigateTarget = null
  g.detectiveKillTarget = null
  g.pendingDetectiveReveal = null
  g.nightSkipYes = {}
}

export function endMafiaResults(_room: RoomState, g: NonNullable<RoomState['mafiaGame']>) {
  g.status = 'lobby'
  g.phaseEndsAt = null
  g.nightEndsAt = null
  g.dayEndsAt = null
  g.voteEndsAt = null
  g.resultsEndsAt = null
  g.roles = {}
  g.alive = {}
  g.winner = null
  g.lastAnnouncement = null
  g.daySkipYes = {}
  g.nightSkipYes = {}
  g.detectiveKillTarget = null
  g.pendingDetectiveReveal = null
  g.doctorPreviousNightProtectTarget = null
}

/** Majority of *alive* players must skip (> 50%) to end discussion early. */
export function requestMafiaDaySkip(room: RoomState, playerId: string, t: number) {
  const g = room.mafiaGame
  if (!g || room.game !== 'mafia' || g.status !== 'day') return
  if (g.alive[playerId] !== true) return
  if (g.daySkipYes[playerId]) return
  g.daySkipYes[playerId] = true
  const ids = aliveIds(g)
  const yes = ids.filter((id) => g.daySkipYes[id]).length
  if (yes > ids.length / 2) {
    endDay(room, g, t)
  }
}

/** Every living Mafia (after kill vote), Doctor, and Detective must agree to end night early. */
function allNightActorsReadyToSkip(g: NonNullable<RoomState['mafiaGame']>): boolean {
  const mids = mafiaIds(g)
  for (const id of mids) {
    if (!g.mafiaKillVotes[id]) return false
    if (!g.nightSkipYes[id]) return false
  }
  const docId = Object.entries(g.roles).find(([, r]) => r === 'doctor')?.[0]
  if (docId && g.alive[docId] && !g.nightSkipYes[docId]) return false
  const detId = Object.entries(g.roles).find(([, r]) => r === 'detective')?.[0]
  if (detId && g.alive[detId] && !g.nightSkipYes[detId]) return false
  return true
}

/** Returns true if the skip was accepted (invalid requests return false). */
export function requestNightSkip(room: RoomState, playerId: string, t: number): boolean {
  const g = room.mafiaGame
  if (!g || room.game !== 'mafia' || g.status !== 'night') return false
  if (g.alive[playerId] !== true) return false
  if (g.nightSkipYes[playerId]) return false

  const role = g.roles[playerId]
  if (role === 'mafia') {
    if (!g.mafiaKillVotes[playerId]) return false
  } else if (role !== 'doctor' && role !== 'detective') {
    return false
  }

  g.nightSkipYes[playerId] = true
  if (allNightActorsReadyToSkip(g)) {
    endNight(room, g, t)
  }
  return true
}

export function tickMafiaGame(room: RoomState, t: number) {
  const g = room.mafiaGame
  if (!g || room.game !== 'mafia') return

  if (room.players.length < MAFIA_MIN || room.players.length > MAFIA_MAX) {
    if (g.status !== 'lobby') endMafiaResults(room, g)
    return
  }

  if (g.status === 'lobby') return

  if (!g.phaseEndsAt || t < g.phaseEndsAt) return

  if (g.status === 'night') {
    endNight(room, g, t)
    return
  }
  if (g.status === 'day') {
    endDay(room, g, t)
    return
  }
  if (g.status === 'voting') {
    endVoting(room, g, t)
    return
  }
  if (g.status === 'results') {
    endMafiaResults(room, g)
    return
  }
}

export function tryMafiaKillVote(
  room: RoomState,
  voterId: string,
  targetId: string,
): boolean {
  const g = room.mafiaGame
  if (!g || room.game !== 'mafia' || g.status !== 'night') return false
  if (!g.alive[voterId] || !g.alive[targetId]) return false
  if (g.roles[voterId] !== 'mafia') return false
  if (voterId === targetId) return false
  g.mafiaKillVotes[voterId] = targetId
  return true
}

export function tryDoctorSave(room: RoomState, playerId: string, targetId: string): boolean {
  const g = room.mafiaGame
  if (!g || room.game !== 'mafia' || g.status !== 'night') return false
  if (!g.alive[playerId] || !g.alive[targetId]) return false
  if (g.roles[playerId] !== 'doctor') return false
  if (g.doctorPreviousNightProtectTarget != null && targetId === g.doctorPreviousNightProtectTarget) {
    return false
  }
  g.doctorSaveTarget = targetId
  return true
}

export function tryDetectiveInvestigate(
  room: RoomState,
  playerId: string,
  targetId: string,
): { ok: boolean } {
  const g = room.mafiaGame
  if (!g || room.game !== 'mafia' || g.status !== 'night') return { ok: false }
  if (!g.alive[playerId] || !g.alive[targetId]) return { ok: false }
  if (g.roles[playerId] !== 'detective') return { ok: false }
  if (playerId === targetId) return { ok: false }
  /** One night action total: check XOR kill, no switching targets after the first pick. */
  if (g.detectiveKillTarget != null) return { ok: false }
  if (g.detectiveInvestigateTarget != null && g.detectiveInvestigateTarget !== targetId) {
    return { ok: false }
  }
  g.detectiveKillTarget = null
  g.detectiveInvestigateTarget = targetId
  return { ok: true }
}

export function tryDetectiveKill(room: RoomState, playerId: string, targetId: string): boolean {
  const g = room.mafiaGame
  if (!g || room.game !== 'mafia' || g.status !== 'night') return false
  if (!g.alive[playerId] || !g.alive[targetId]) return false
  if (g.roles[playerId] !== 'detective') return false
  if (playerId === targetId) return false
  if (g.detectiveInvestigateTarget != null) return false
  if (g.detectiveKillTarget != null && g.detectiveKillTarget !== targetId) return false
  g.detectiveInvestigateTarget = null
  g.detectiveKillTarget = targetId
  return true
}

function allAliveHaveCastDayVote(g: NonNullable<RoomState['mafiaGame']>): boolean {
  const ids = aliveIds(g)
  for (const vid of ids) {
    const tgt = g.dayVotes[vid]
    if (!tgt || tgt === vid || g.alive[tgt] !== true) return false
  }
  return ids.length > 0
}

export function tryDayVote(room: RoomState, voterId: string, targetId: string): boolean {
  const g = room.mafiaGame
  if (!g || room.game !== 'mafia' || g.status !== 'voting') return false
  if (!g.alive[voterId] || !g.alive[targetId]) return false
  if (voterId === targetId) return false
  g.dayVotes[voterId] = targetId

  const t = Date.now()
  if (allAliveHaveCastDayVote(g) && g.phaseEndsAt != null) {
    const cap = t + MAFIA_VOTE_ALL_IN_REM_SEC * 1000
    if (g.phaseEndsAt > cap) {
      g.phaseEndsAt = cap
      g.voteEndsAt = cap
    }
  }
  return true
}

export function pruneMafiaForPlayers(room: RoomState) {
  const g = room.mafiaGame
  if (!g || room.game !== 'mafia') return
  const allowed = new Set(room.players.map((p) => p.id))
  for (const k of Object.keys(g.alive)) {
    if (!allowed.has(k)) delete g.alive[k]
  }
  for (const k of Object.keys(g.roles)) {
    if (!allowed.has(k)) delete g.roles[k]
  }
  for (const k of Object.keys(g.mafiaKillVotes)) {
    if (!allowed.has(k)) delete g.mafiaKillVotes[k]
  }
  for (const k of Object.keys(g.dayVotes)) {
    if (!allowed.has(k)) delete g.dayVotes[k]
  }
  for (const k of Object.keys(g.daySkipYes)) {
    if (!allowed.has(k)) delete g.daySkipYes[k]
  }
  for (const k of Object.keys(g.nightSkipYes)) {
    if (!allowed.has(k)) delete g.nightSkipYes[k]
  }
  if (g.doctorPreviousNightProtectTarget && !allowed.has(g.doctorPreviousNightProtectTarget)) {
    g.doctorPreviousNightProtectTarget = null
  }
}
