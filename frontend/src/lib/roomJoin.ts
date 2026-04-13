import { getSocket } from './socket'

export type JoinedRoom = {
  room: { code: string; game?: string }
  player: { id: string; displayName: string; kind: string }
}

export async function joinRoom(code: string): Promise<JoinedRoom> {
  const normalized = String(code ?? '').trim()
  if (!normalized) throw new Error('Missing room code')

  const socket = getSocket()
  if (!socket.connected) socket.connect()

  const res = await new Promise<any>((resolve) => {
    socket.emit('room:join', { code: normalized }, (r: any) => resolve(r))
  })

  if (!res?.ok) {
    const err = res?.error ? String(res.error) : 'join_failed'
    throw new Error(err)
  }

  return { room: res.room, player: res.player }
}

