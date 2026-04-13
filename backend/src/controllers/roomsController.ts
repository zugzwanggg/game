import type { Response } from 'express'
import type { AuthedRequest } from '../auth/middleware.js'
import { createRoom, getRoom, listRoomsCount, pickRandomPublicRoom } from '../rooms/store.js'
import type { GameKey, RoomState } from '../rooms/types.js'
import { getCorsOriginsList } from '../corsOrigins.js'

function matchActive(room: RoomState): boolean {
  if (room.game === 'drawing') {
    const dg = room.drawingGame
    return dg != null && dg.status !== 'lobby'
  }
  if (room.game === 'meme') {
    const m = room.memeGame
    return m != null && m.status !== 'lobby'
  }
  return false
}

function toInviteUrl(code: string, game: GameKey) {
  const origins = getCorsOriginsList()
  const origin = origins[0] ?? 'http://localhost:5173'
  return `${origin}/room/${code}?game=${encodeURIComponent(game)}`
}

export function roomsHealth(_req: AuthedRequest, res: Response) {
  res.json({ ok: true, rooms: listRoomsCount() })
}

export function createRoomHandler(req: AuthedRequest, res: Response) {
  const game = String(req.body?.game ?? 'drawing') as GameKey
  const isPrivate = Boolean(req.body?.isPrivate ?? true)
  if (!req.principal || req.principal.kind !== 'user') {
    res.status(401).json({ error: 'auth_required' })
    return
  }
  const room = createRoom({ game, createdByUserId: req.principal.userId, isPrivate })
  // Ensure the creator exists in the players list immediately (prevents empty-room deletion
  // if the host hasn't connected to Socket.IO yet).
  room.players = [
    {
      id: req.principal.userId,
      kind: 'user' as const,
      displayName: req.principal.displayName ?? 'You',
      joinedAt: Date.now(),
    },
  ]
  res.status(201).json({
    room: {
      code: room.code,
      game: room.game,
      isPrivate: room.isPrivate,
      createdAt: room.createdAt,
      expiresAt: room.expiresAt,
      inviteUrl: toInviteUrl(room.code, room.game),
    },
  })
}

export function getRoomHandler(req: AuthedRequest, res: Response) {
  const code = String(req.params.code ?? '').trim().toUpperCase()
  const room = getRoom(code)
  if (!room) {
    res.status(404).json({ error: 'room_not_found' })
    return
  }
  res.json({
    room: {
      code: room.code,
      game: room.game,
      isPrivate: room.isPrivate,
      createdByUserId: room.createdByUserId,
      createdAt: room.createdAt,
      expiresAt: room.expiresAt,
      matchActive: matchActive(room),
      players: room.players.map((p) => ({
        id: p.id,
        kind: p.kind,
        displayName: p.displayName,
      })),
      round: room.round,
    },
  })
}

export function joinRandomRoomHandler(req: AuthedRequest, res: Response) {
  const game = String(req.query.game ?? 'drawing') as GameKey
  const room = pickRandomPublicRoom(game)
  if (!room) {
    // If no public rooms exist, auto-create a public room for authenticated users.
    if (req.principal?.kind === 'user') {
      const created = createRoom({
        game,
        createdByUserId: req.principal.userId,
        isPrivate: false,
      })
      created.players = [
        {
          id: req.principal.userId,
          kind: 'user' as const,
          displayName: req.principal.displayName ?? 'You',
          joinedAt: Date.now(),
        },
      ]
      res.status(201).json({
        created: true,
        room: {
          code: created.code,
          game: created.game,
          isPrivate: created.isPrivate,
          inviteUrl: toInviteUrl(created.code, created.game),
        },
      })
      return
    }
    res.status(404).json({ error: 'no_public_rooms' })
    return
  }
  res.json({
    created: false,
    room: {
      code: room.code,
      game: room.game,
      isPrivate: room.isPrivate,
      inviteUrl: toInviteUrl(room.code, room.game),
    },
  })
}

