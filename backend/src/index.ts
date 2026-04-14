import 'dotenv/config'
import type { Request, Response } from 'express'
import { createServer } from 'node:http'
import { app } from './app.js'
import { checkDb, pool } from './db/pool.js'
import { initSocket } from './socket.js'

const port = Number(process.env.PORT) || 3000
const httpServer = createServer(app)

initSocket(httpServer)

app.get('/health/db', async (_req: Request, res: Response) => {
  const ok = await checkDb()
  res.status(ok ? 200 : 503).json({ database: ok ? 'up' : 'down' })
})

httpServer.listen(port, () => {
  console.log(`HTTP + Socket.IO on http://localhost:${port}`)
})

async function shutdown(signal: string) {
  console.log(`\n${signal} received, closing...`)
  await new Promise<void>((resolve, reject) => {
    httpServer.close((err) => (err ? reject(err) : resolve()))
  })
  await pool.end()
  process.exit(0)
}

process.on('SIGINT', () => void shutdown('SIGINT'))
process.on('SIGTERM', () => void shutdown('SIGTERM'))
