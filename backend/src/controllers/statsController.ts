import type { Response } from 'express'
import type { AuthedRequest } from '../auth/middleware.js'
import { getStatsForUser, recordGameResult } from '../db/stats.js'

export async function myStats(req: AuthedRequest, res: Response) {
  if (!req.principal || req.principal.kind !== 'user') {
    res.status(401).json({ error: 'auth_required' })
    return
  }
  const stats = await getStatsForUser(req.principal.userId)
  res.json({ stats })
}

export async function recordStats(req: AuthedRequest, res: Response) {
  if (!req.principal || req.principal.kind !== 'user') {
    res.status(401).json({ error: 'auth_required' })
    return
  }
  const game = String(req.body?.game ?? 'drawing')
  const didWin = Boolean(req.body?.didWin)
  const points = Number(req.body?.points ?? 0)
  if (!game || !Number.isFinite(points) || points < 0) {
    res.status(400).json({ error: 'invalid_input' })
    return
  }
  const row = await recordGameResult({
    userId: req.principal.userId,
    game,
    didWin,
    points: Math.floor(points),
  })
  res.json({ stats: row })
}

