import express from 'express'
import { requireUser, type AuthedRequest } from '../auth/middleware.js'
import { myStats, recordStats } from '../controllers/statsController.js'

export const statsRouter = express.Router()

statsRouter.get('/stats/me', requireUser, (req: AuthedRequest, res) => {
  void myStats(req, res)
})

statsRouter.post('/stats/record', requireUser, (req: AuthedRequest, res) => {
  void recordStats(req, res)
})

