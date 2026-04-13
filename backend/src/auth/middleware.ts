import type { NextFunction, Request, Response } from 'express'
import { verifyToken, type TokenPayload } from './token.js'

export type AuthedPrincipal =
  | { kind: 'user'; userId: string; displayName?: string }
  | { kind: 'guest'; guestId: string; displayName?: string }

declare global {
  // eslint-disable-next-line no-var
  var __auth__: undefined
}

export function getAuthSecret(): string {
  const secret = process.env.AUTH_SECRET
  if (secret) return secret
  if (process.env.NODE_ENV === 'production') {
    throw new Error('AUTH_SECRET is required in production')
  }
  console.warn(
    '[auth] AUTH_SECRET is not set; using a dev-only default. Add AUTH_SECRET to backend/.env (see .env.example).',
  )
  return 'dev-only-auth-secret-not-for-production'
}

export const AUTH_COOKIE_NAME = process.env.AUTH_COOKIE_NAME ?? 'auth_token'

function parseBearer(req: Request): string | null {
  const header = req.header('authorization') ?? req.header('Authorization')
  if (!header) return null
  const m = header.match(/^Bearer\s+(.+)$/i)
  return m?.[1]?.trim() || null
}

export type AuthedRequest = Request & { principal?: AuthedPrincipal; token?: TokenPayload }

export function optionalAuth(req: AuthedRequest, _res: Response, next: NextFunction) {
  const cookieToken =
    (req as any).cookies?.[AUTH_COOKIE_NAME] as string | undefined
  const token = cookieToken ?? parseBearer(req)
  if (!token) return next()
  const payload = verifyToken(token, getAuthSecret())
  if (!payload) return next()

  req.token = payload
  if (payload.typ === 'user') {
    req.principal = { kind: 'user', userId: payload.sub, displayName: payload.name }
  } else {
    req.principal = { kind: 'guest', guestId: payload.sub, displayName: payload.name }
  }
  return next()
}

export function requireUser(req: AuthedRequest, res: Response, next: NextFunction) {
  optionalAuth(req, res, () => {
    if (req.principal?.kind !== 'user') {
      res.status(401).json({ error: 'auth_required' })
      return
    }
    next()
  })
}

