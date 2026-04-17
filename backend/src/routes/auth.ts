import express from 'express'
import { rateLimit } from 'express-rate-limit'
import { optionalAuth } from '../auth/middleware.js'
import { guest, login, logout, me, signup, syncSession } from '../controllers/authController.js'
import { googleAuthCallback, googleAuthStart } from '../controllers/googleOAuthController.js'

export const authRouter = express.Router()

const authPostLimit = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 60,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'too_many_requests' },
})

authRouter.get('/auth/google', googleAuthStart)
authRouter.get('/auth/google/callback', googleAuthCallback)

authRouter.post('/auth/signup', authPostLimit, signup)
authRouter.post('/auth/login', authPostLimit, login)
authRouter.post('/auth/guest', authPostLimit, guest)
authRouter.post('/auth/logout', authPostLimit, logout)
authRouter.post('/auth/sync-session', authPostLimit, syncSession)
authRouter.get('/me', optionalAuth, me)

