import { Eye, ImageIcon, Pencil, Skull, Target, type LucideIcon } from 'lucide-react'

import guessTheDrawingCover from '../assets/covers/guess_the_drawing_cover.png'
import liarsRevolverCover from '../assets/covers/liars_revolver_cover.png'
import mafiaCover from '../assets/covers/mafia_cover.png'
import memeBattleCover from '../assets/covers/meme_battle_cover.png'
import spyCover from '../assets/covers/spy_cover.png'

export type GameDefinition = {
  id: string
  label: string
  tagline: string
  description: string
  icon: LucideIcon
  /** Card cover art URL; omit to use the built-in placeholder */
  coverImage?: string
  /** Hub / game page badge */
  beta?: boolean
  glowColor: string
  accentColor: string
  players: string
  maxPlayers: number
  duration: string
  tags: string[]
}

export const GAMES: Record<string, GameDefinition> = {
  drawing: {
    id: 'drawing',
    label: 'Guess the Drawing',
    tagline: 'Draw fast. Guess faster.',
    description:
      'One player draws a secret word while everyone else races to guess it in real time. The faster you guess, the more points you earn.',
    icon: Pencil,
    coverImage: guessTheDrawingCover,
    glowColor: 'rgba(123, 97, 255, 0.3)',
    accentColor: '#7B61FF',
    players: '2-16 players',
    maxPlayers: 16,
    duration: '~15 min',
    tags: ['drawing', 'real-time', 'creative'],
  },
  meme: {
    id: 'meme',
    label: 'Meme Battle',
    tagline: 'May the funniest meme win.',
    description:
      'Everyone gets a prompt and picks a meme. The group votes for the funniest.',
    icon: ImageIcon,
    coverImage: memeBattleCover,
    glowColor: 'rgba(0, 212, 170, 0.3)',
    accentColor: '#00D4AA',
    players: '2-20 players',
    maxPlayers: 20,
    duration: '~10 min',
    tags: ['memes', 'voting', 'party'],
  },
  spy: {
    id: 'spy',
    label: 'Spy',
    tagline: 'Blend in. Find the word. Don’t get caught.',
    description:
      'One player is the Spy and does not know the secret word. Everyone else shares the word and gives hints without saying it. Vote to catch the Spy. On a tie, Spy wins. If caught, the Spy gets one guess.',
    icon: Eye,
    coverImage: spyCover,
    glowColor: 'rgba(255, 184, 0, 0.25)',
    accentColor: '#FFB800',
    players: '3-10 players',
    maxPlayers: 10,
    duration: '~5 min',
    tags: ['social deduction', 'voice', 'party'],
  },
  liar: {
    id: 'liar',
    label: "Liar's Revolver",
    tagline: 'Bluff, call, survive.',
    description:
      'Play cards face down and say how many of which rank you claim (rank and count are yours to invent). Others can call your bluff. Wrong player spins the cylinder. Last one standing wins.',
    icon: Target,
    coverImage: liarsRevolverCover,
    beta: true,
    glowColor: 'rgba(251, 191, 36, 0.28)',
    accentColor: '#FBBF24',
    players: '2-6 players',
    maxPlayers: 6,
    duration: '~10 min',
    tags: ['bluffing', 'party', 'cards'],
  },
  mafia: {
    id: 'mafia',
    label: 'Mafia',
    tagline: 'Trust no one. Survive the night.',
    description:
      'Mafia kills at night; town votes by day. If Mafia matches town in numbers, Mafia wins.',
    icon: Skull,
    coverImage: mafiaCover,
    glowColor: 'rgba(244, 63, 94, 0.25)',
    accentColor: '#F43F5E',
    players: '5-12 players',
    maxPlayers: 12,
    duration: '~15 min',
    tags: ['social deduction', 'party', 'voice'],
  },
}

export const listGames = (): GameDefinition[] => Object.values(GAMES)

export const getGame = (id: string | undefined): GameDefinition | null =>
  id && GAMES[id] ? GAMES[id] : null
