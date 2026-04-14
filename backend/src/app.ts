import cors from 'cors'
import express, { type Request, type RequestHandler, type Response } from 'express'
import cookieParser from 'cookie-parser'
import * as helmetModule from 'helmet'
import type { HelmetOptions } from 'helmet'
import { authRouter } from './routes/auth.js'
import { roomsRouter } from './routes/rooms.js'
import { statsRouter } from './routes/stats.js'
import { klipyRouter } from './routes/klipy.js'
import { getCorsOrigins } from './corsOrigins.js'

export const app = express()

if (
  process.env.NODE_ENV === 'production' ||
  process.env.TRUST_PROXY === '1'
) {
  app.set('trust proxy', 1)
}

// Helmet's ESM/CJS typings resolve to the module namespace under TS 6 + NodeNext; assert to the real factory.
const helmet = helmetModule.default as unknown as (
  options?: Readonly<HelmetOptions>,
) => RequestHandler

app.use(
  helmet({
    contentSecurityPolicy: false,
    crossOriginResourcePolicy: { policy: 'cross-origin' },
  }),
)
app.use(
  cors({
    origin: getCorsOrigins(),
    credentials: true,
  }),
)
app.use(cookieParser())
app.use(express.json())

app.use('/api', authRouter)
app.use('/api', roomsRouter)
app.use('/api', statsRouter)
app.use('/api', klipyRouter)

app.get('/health', (_req: Request, res: Response) => {
  res.json({ ok: true })
})
