export type RecentRoom = {
  code: string
  game: string
  joinedAt: number
  role: 'host' | 'player'
}

const KEY = 'recent_rooms_v1'
const MAX = 6

export function getRecentRooms(): RecentRoom[] {
  try {
    const raw = localStorage.getItem(KEY)
    const parsed = raw ? (JSON.parse(raw) as RecentRoom[]) : []
    if (!Array.isArray(parsed)) return []
    return parsed
      .filter((r) => r && typeof r.code === 'string' && typeof r.game === 'string')
      .slice(0, MAX)
  } catch {
    return []
  }
}

export function addRecentRoom(room: RecentRoom) {
  const next = [
    room,
    ...getRecentRooms().filter((r) => r.code !== room.code),
  ].slice(0, MAX)
  localStorage.setItem(KEY, JSON.stringify(next))
}

export function removeRecentRoom(code: string) {
  const next = getRecentRooms().filter((r) => r.code !== code)
  localStorage.setItem(KEY, JSON.stringify(next))
}

