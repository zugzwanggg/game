import type { Request, Response } from 'express'
import crypto from 'node:crypto'
import { AUTH_COOKIE_NAME, getAuthSecret } from '../auth/middleware.js'
import { signToken } from '../auth/token.js'
import { upsertGoogleUser } from '../db/users.js'

const USER_TOKEN_TTL_SEC = Number(process.env.USER_TOKEN_TTL_SEC ?? 60 * 60 * 24)

/** Must match the route mounted at app.use('/api', authRouter) → GET .../auth/google/callback */
const GOOGLE_OAUTH_CALLBACK_PATH = '/api/auth/google/callback'

const OAuthStateCookie = 'oauth_google_state'
const OAuthReturnCookie = 'oauth_google_return'

function useCrossSiteAuthCookies(): boolean {
  if (process.env.AUTH_COOKIE_CROSS_SITE === '0') return false
  if (process.env.AUTH_COOKIE_CROSS_SITE === '1') return true
  return process.env.NODE_ENV === 'production'
}

function sessionCookieFlags() {
  const crossSite = useCrossSiteAuthCookies()
  const secure = crossSite
  const sameSite = crossSite ? ('none' as const) : ('lax' as const)
  return { httpOnly: true, sameSite, secure, path: '/' as const }
}

function cookieOpts(ttlSec: number) {
  return { ...sessionCookieFlags(), maxAge: ttlSec * 1000 }
}

function getApiPublicOrigin(): string {
  const o = process.env.PUBLIC_API_ORIGIN?.trim()
  if (o) return o.replace(/\/$/, '')
  const port = Number(process.env.PORT) || 3000
  return `http://localhost:${port}`
}

/** Google “Authorized redirect URI” = `{origin}/api/auth/google/callback` (this path is fixed). */
function getRedirectUri(): string {
  const explicit = process.env.GOOGLE_REDIRECT_URI?.trim()
  if (explicit) {
    if (explicit.startsWith('http://') || explicit.startsWith('https://')) {
      try {
        const u = new URL(explicit)
        if (u.pathname === '/auth/google/callback') {
          u.pathname = GOOGLE_OAUTH_CALLBACK_PATH
          return u.toString()
        }
      } catch {
        /* use as-is */
      }
      return explicit
    }
    if (explicit.startsWith('/')) {
      return `${getApiPublicOrigin()}${explicit}`
    }
  }
  return `${getApiPublicOrigin()}${GOOGLE_OAUTH_CALLBACK_PATH}`
}

function getClientOrigin(): string {
  const raw = process.env.CLIENT_ORIGIN?.trim()
  if (raw) return raw.split(',')[0].trim()
  return 'http://localhost:5173'
}

function oauthCookieOpts() {
  return { ...sessionCookieFlags(), maxAge: 10 * 60 * 1000 }
}

function clearCookieOpts() {
  return { ...sessionCookieFlags(), maxAge: 0 }
}

export async function googleAuthStart(req: Request, res: Response) {
  const clientId = process.env.GOOGLE_CLIENT_ID?.trim()
  if (!clientId) {
    res.status(503).json({ error: 'google_oauth_not_configured' })
    return
  }

  const state = crypto.randomBytes(24).toString('hex')
  const rawReturn = typeof req.query?.return === 'string' ? req.query.return : ''
  const returnTo =
    rawReturn.startsWith('/') && !rawReturn.startsWith('//')
      ? rawReturn.slice(0, 512)
      : '/games'

  res.cookie(OAuthStateCookie, state, oauthCookieOpts())
  res.cookie(OAuthReturnCookie, returnTo, oauthCookieOpts())

  const redirectUri = getRedirectUri()
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: 'code',
    scope: 'openid email profile',
    state,
    access_type: 'offline',
    prompt: 'select_account',
  })

  const url = `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`
  res.redirect(302, url)
}

type GoogleTokenResponse = {
  access_token?: string
  id_token?: string
  expires_in?: number
  token_type?: string
}

type GoogleUserInfo = {
  sub: string
  email?: string
  email_verified?: boolean
  name?: string
  picture?: string
}

export async function googleAuthCallback(req: Request, res: Response) {
  const clientId = process.env.GOOGLE_CLIENT_ID?.trim()
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET?.trim()
  if (!clientId || !clientSecret) {
    res.redirect(302, `${getClientOrigin()}/login?oauth=error&reason=config`)
    return
  }

  const code = typeof req.query['code'] === 'string' ? req.query['code'] : ''
  const state = typeof req.query['state'] === 'string' ? req.query['state'] : ''
  const err = typeof req.query['error'] === 'string' ? req.query['error'] : ''

  const cookieState = (req as any).cookies?.[OAuthStateCookie] as string | undefined
  const returnTo = typeof (req as any).cookies?.[OAuthReturnCookie] === 'string'
    ? String((req as any).cookies[OAuthReturnCookie])
    : '/games'

  res.clearCookie(OAuthStateCookie, clearCookieOpts())
  res.clearCookie(OAuthReturnCookie, clearCookieOpts())

  if (err || !code || !state || !cookieState || state !== cookieState) {
    res.redirect(302, `${getClientOrigin()}/login?oauth=error&reason=${encodeURIComponent(err || 'state')}`)
    return
  }

  const redirectUri = getRedirectUri()

  const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code,
      client_id: clientId,
      client_secret: clientSecret,
      redirect_uri: redirectUri,
      grant_type: 'authorization_code',
    }).toString(),
  })

  if (!tokenRes.ok) {
    res.redirect(302, `${getClientOrigin()}/login?oauth=error&reason=token`)
    return
  }

  const tokenJson = (await tokenRes.json()) as GoogleTokenResponse
  const accessToken = tokenJson.access_token
  if (!accessToken) {
    res.redirect(302, `${getClientOrigin()}/login?oauth=error&reason=no_access`)
    return
  }

  const uiRes = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
    headers: { authorization: `Bearer ${accessToken}` },
  })
  if (!uiRes.ok) {
    res.redirect(302, `${getClientOrigin()}/login?oauth=error&reason=userinfo`)
    return
  }

  const profile = (await uiRes.json()) as GoogleUserInfo
  if (!profile.sub) {
    res.redirect(302, `${getClientOrigin()}/login?oauth=error&reason=profile`)
    return
  }

  const email = (profile.email ?? '').trim().toLowerCase()
  if (!email || profile.email_verified === false) {
    res.redirect(302, `${getClientOrigin()}/login?oauth=error&reason=email`)
    return
  }

  const displayName = (profile.name ?? email.split('@')[0] ?? 'Player').trim().slice(0, 80)

  let user
  try {
    user = await upsertGoogleUser({
      googleSub: profile.sub,
      email,
      displayName,
    })
  } catch {
    res.redirect(302, `${getClientOrigin()}/login?oauth=error&reason=account`)
    return
  }

  const token = signToken(
    { typ: 'user', sub: user.id, name: user.displayName },
    getAuthSecret(),
    { expiresInSec: USER_TOKEN_TTL_SEC },
  )
  res.cookie(AUTH_COOKIE_NAME, token, cookieOpts(USER_TOKEN_TTL_SEC))

  const safePath = returnTo.startsWith('/') && !returnTo.startsWith('//') ? returnTo : '/games'
  res.redirect(302, `${getClientOrigin()}${safePath}?oauth=success`)
}
