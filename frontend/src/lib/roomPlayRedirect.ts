/** True when the room is in an active match (not pre-game lobby). */
export function matchInProgressFromSocketState(state: {
  game?: string
  drawingGame?: { status?: string } | null
  memeGame?: { status?: string } | null
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
  return false
}

export function playPathForRoom(roomCode: string, game: 'drawing' | 'meme') {
  return `/games/${game}/play?room=${encodeURIComponent(roomCode)}`
}
