import { Router } from 'express'
import { klipyGifsSearch, klipyGifsTrending } from '../controllers/klipyController.js'

export const klipyRouter = Router()

klipyRouter.get('/klipy/gifs/search', klipyGifsSearch)
klipyRouter.get('/klipy/gifs/trending', klipyGifsTrending)
