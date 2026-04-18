import type { RoomState } from './types.js'

/** Everyone in the room becomes a participant for the next match (Spy, Meme, Mafia, Liar, Drawing, Memory, etc.). */
export function clearSpectatorFlagsForMatchStart(room: RoomState): void {
  for (const p of room.players) {
    p.spectator = false
  }
}
