import express, { type Response } from 'express'
import { optionalAuth, requireUser, type AuthedRequest } from '../auth/middleware.js'
import { createRoomHandler, getRoomHandler, joinRandomRoomHandler, roomsHealth } from '../controllers/roomsController.js'

export const roomsRouter = express.Router()

roomsRouter.get('/rooms/health', roomsHealth)
roomsRouter.post('/rooms', requireUser, (req: AuthedRequest, res: Response) =>
  createRoomHandler(req, res))
roomsRouter.get('/rooms/random', optionalAuth, (req: AuthedRequest, res: Response) =>
  joinRandomRoomHandler(req, res))
roomsRouter.get('/rooms/:code', (req: AuthedRequest, res: Response) => getRoomHandler(req, res))

