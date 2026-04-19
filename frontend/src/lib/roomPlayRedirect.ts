/** True when the room is in an active match (not pre-game lobby). */
export function matchInProgressFromSocketState(state: {
  game?: string
  drawingGame?: { status?: string } | null
  memeGame?: { status?: string } | null
  spyGame?: { status?: string } | null
  mafiaGame?: { status?: string } | null
  liarGame?: { status?: string } | null
  memoryGame?: { status?: string } | null
  whoamiGame?: { status?: string } | null
}): boolean {
  const g = state.game
  if (g === 'drawing') {
    const s = state.drawingGame?.status
    return s != null && s !== 'lobby'
  }
  if (g === 'meme') {
    const s = state.memeGame?.status
    return s != null && s !== 'lobby'
  }
  if (g === 'spy') {
    const s = state.spyGame?.status
    return s != null && s !== 'lobby'
  }
  if (g === 'mafia') {
    const s = state.mafiaGame?.status
    return s != null && s !== 'lobby'
  }
  if (g === 'liar') {
    const s = state.liarGame?.status
    return s != null && s !== 'lobby'
  }
  if (g === 'memory') {
    const s = state.memoryGame?.status
    return s != null && s !== 'lobby'
  }
  if (g === 'whoami') {
    const s = state.whoamiGame?.status
    return s != null && s !== 'lobby'
  }
  // Fallback: some clients/pages may see a state snapshot before `game` is set.
  // Infer from game-specific state objects.
  const ds = state.drawingGame?.status
  if (ds != null && ds !== 'lobby') return true
  const ms = state.memeGame?.status
  if (ms != null && ms !== 'lobby') return true
  const ss = state.spyGame?.status
  if (ss != null && ss !== 'lobby') return true
  const mafs = state.mafiaGame?.status
  if (mafs != null && mafs !== 'lobby') return true
  const lg = state.liarGame?.status
  if (lg != null && lg !== 'lobby') return true
  const mem = state.memoryGame?.status
  if (mem != null && mem !== 'lobby') return true
  const who = state.whoamiGame?.status
  if (who != null && who !== 'lobby') return true
  return false
}

export function playPathForRoom(
  roomCode: string,
  game: 'drawing' | 'meme' | 'spy' | 'mafia' | 'liar' | 'memory' | 'whoami',
) {
  return `/games/${game}/play?room=${encodeURIComponent(roomCode)}`
}
