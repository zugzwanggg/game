import type { Request, Response } from 'express'

const KLIPY_BASE = 'https://api.klipy.com/api/v1'
/** Klipy docs recommend a browser-like UA for some endpoints. */
const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'

async function forwardKlipy(
  req: Request,
  res: Response,
  pathSuffix: '/gifs/search' | '/gifs/trending',
) {
  const key = process.env.KLIPY_API_KEY?.trim()
  if (!key) {
    res.status(503).json({
      error: 'klipy_not_configured',
      message: 'Set KLIPY_API_KEY in backend/.env (see .env.example).',
    })
    return
  }

  const qs = new URLSearchParams(req.query as Record<string, string>).toString()
  const url = `${KLIPY_BASE}/${encodeURIComponent(key)}${pathSuffix}${qs ? `?${qs}` : ''}`

  try {
    const r = await fetch(url, {
      headers: { 'User-Agent': UA, Accept: 'application/json' },
    })
    const text = await r.text()
    let json: unknown
    try {
      json = text ? JSON.parse(text) : null
    } catch {
      res.status(502).json({ error: 'klipy_bad_json' })
      return
    }
    res.status(r.status).json(json)
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : String(e)
    res.status(502).json({ error: 'klipy_fetch_failed', message })
  }
}

export function klipyGifsSearch(req: Request, res: Response) {
  return forwardKlipy(req, res, '/gifs/search')
}

export function klipyGifsTrending(req: Request, res: Response) {
  return forwardKlipy(req, res, '/gifs/trending')
}
