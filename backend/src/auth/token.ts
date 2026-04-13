export type TokenKind = 'user' | 'guest'

export type TokenPayload = {
  typ: TokenKind
  sub: string
  name?: string
}
import jwt from 'jsonwebtoken'

export function signToken(
  payload: TokenPayload,
  secret: string,
  opts: { expiresInSec: number },
): string {
  return jwt.sign(payload, secret, { expiresIn: opts.expiresInSec })
}

export function verifyToken(token: string, secret: string): TokenPayload | null {
  try {
    const decoded = jwt.verify(token, secret) as jwt.JwtPayload | string
    if (!decoded || typeof decoded === 'string') return null
    const typ = decoded.typ as TokenKind | undefined
    const sub = decoded.sub as string | undefined
    const name = decoded.name as string | undefined
    if (!typ || (typ !== 'user' && typ !== 'guest')) return null
    if (!sub || typeof sub !== 'string') return null
    return { typ, sub, name }
  } catch {
    return null
  }
}

