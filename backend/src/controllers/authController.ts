import type { Request, Response } from 'express'
import crypto from 'node:crypto'
import { hashPassword, verifyPassword } from '../auth/password.js'
import { AUTH_COOKIE_NAME, getAuthSecret, optionalAuth, type AuthedRequest } from '../auth/middleware.js'
import { signToken } from '../auth/token.js'
import { createUser, findUserByEmail, findUserById } from '../db/users.js'

const USER_TOKEN_TTL_SEC = Number(process.env.USER_TOKEN_TTL_SEC ?? 60 * 60 * 24)
const GUEST_TOKEN_TTL_SEC = Number(process.env.GUEST_TOKEN_TTL_SEC ?? 60 * 60 * 6)

const isProd = process.env.NODE_ENV === 'production'

/**
 * Cross-origin SPA (e.g. Vercel → API on another domain): browsers do not attach
 * SameSite=Lax cookies to credentialed fetch/XHR. Use None + Secure over HTTPS.
 * Local dev: localhost↔localhost stays Lax (same-site).
 */
function sessionCookieFlags() {
  const secure = isProd
  const sameSite = isProd ? ('none' as const) : ('lax' as const)
  return { httpOnly: true, sameSite, secure, path: '/' as const }
}

function cookieOpts(ttlSec: number) {
  return {
    ...sessionCookieFlags(),
    maxAge: ttlSec * 1000,
  }
}

function clearAuthCookieOpts() {
  return sessionCookieFlags()
}

export async function signup(req: Request, res: Response) {
  const email = String(req.body?.email ?? '').trim().toLowerCase()
  const password = String(req.body?.password ?? '')
  const displayName = String(req.body?.displayName ?? '').trim()

  if (!email || !password || password.length < 6 || !displayName) {
    res.status(400).json({ error: 'invalid_input' })
    return
  }

  const passwordHash = await hashPassword(password)

  try {
    const user = await createUser({
      email,
      displayName,
      passwordHash,
    })
    const token = signToken(
      { typ: 'user', sub: user.id, name: user.displayName },
      getAuthSecret(),
      { expiresInSec: USER_TOKEN_TTL_SEC },
    )
    res.cookie(AUTH_COOKIE_NAME, token, cookieOpts(USER_TOKEN_TTL_SEC))
    res.json({ user: { id: user.id, email: user.email, displayName: user.displayName } })
  } catch {
    res.status(409).json({ error: 'email_taken' })
  }
}

export async function login(req: Request, res: Response) {
  const email = String(req.body?.email ?? '').trim().toLowerCase()
  const password = String(req.body?.password ?? '')
  if (!email || !password) {
    res.status(400).json({ error: 'invalid_input' })
    return
  }

  const user = await findUserByEmail(email)
  if (!user || !(await verifyPassword(password, user.passwordHash))) {
    res.status(401).json({ error: 'invalid_credentials' })
    return
  }

  const token = signToken(
    { typ: 'user', sub: user.id, name: user.displayName },
    getAuthSecret(),
    { expiresInSec: USER_TOKEN_TTL_SEC },
  )
  res.cookie(AUTH_COOKIE_NAME, token, cookieOpts(USER_TOKEN_TTL_SEC))
  res.json({ user: { id: user.id, email: user.email, displayName: user.displayName } })
}

export async function guest(req: Request, res: Response) {
  const displayNameRaw = String(req.body?.displayName ?? '').trim()
  const displayName = displayNameRaw || `Guest-${crypto.randomInt(1000, 9999)}`
  const guestId = crypto.randomUUID()
  const token = signToken(
    { typ: 'guest', sub: guestId, name: displayName },
    getAuthSecret(),
    { expiresInSec: GUEST_TOKEN_TTL_SEC },
  )
  res.cookie(AUTH_COOKIE_NAME, token, cookieOpts(GUEST_TOKEN_TTL_SEC))
  res.json({ guest: { id: guestId, displayName } })
}

export async function logout(_req: Request, res: Response) {
  res.clearCookie(AUTH_COOKIE_NAME, clearAuthCookieOpts())
  res.json({ ok: true })
}

export async function me(req: AuthedRequest, res: Response) {
  // this is mounted with optionalAuth in router, but keep tolerant.
  optionalAuth(req, res, async () => {
    if (!req.principal) {
      res.json({ principal: null })
      return
    }
    if (req.principal.kind === 'guest') {
      res.json({
        principal: {
          kind: 'guest',
          id: req.principal.guestId,
          displayName: req.principal.displayName ?? 'Guest',
        },
      })
      return
    }
    const user = await findUserById(req.principal.userId)
    if (!user) {
      res.json({ principal: null })
      return
    }
    res.json({
      principal: {
        kind: 'user',
        id: user.id,
        email: user.email,
        displayName: user.displayName,
      },
    })
  })
}

