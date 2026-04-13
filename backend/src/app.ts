import cors from 'cors'
import express from 'express'
import cookieParser from 'cookie-parser'
import * as helmet from 'helmet'
import { authRouter } from './routes/auth.js'
import { roomsRouter } from './routes/rooms.js'
import { statsRouter } from './routes/stats.js'
import { klipyRouter } from './routes/klipy.js'

export const app = express()

if (
  process.env.NODE_ENV === 'production' ||
  process.env.TRUST_PROXY === '1'
) {
  app.set('trust proxy', 1)
}

app.use(
  helmet.default({
    contentSecurityPolicy: false,
    crossOriginResourcePolicy: { policy: 'cross-origin' },
  }),
)
app.use(
  cors({
    origin: process.env.CLIENT_ORIGIN ?? 'http://localhost:5173',
    credentials: true,
  }),
)
app.use(cookieParser())
app.use(express.json())

app.use('/api', authRouter)
app.use('/api', roomsRouter)
app.use('/api', statsRouter)
app.use('/api', klipyRouter)

app.get('/health', (_req, res) => {
  res.json({ ok: true })
})
