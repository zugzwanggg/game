import { Eye, ImageIcon, LayoutGrid, Pencil, Skull, Target, type LucideIcon } from 'lucide-react'

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
      'One player draws a word; everyone else guesses in chat. Earlier correct guess scores higher.',
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
    tagline: 'Pick a meme. Vote.',
    description:
      'Prompts, then GIF picks. Vote each round.',
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
    tagline: 'Find the Spy.',
    description:
      'Spy does not know the word. Others give hints and vote. Tie goes to Spy. Caught Spy gets one guess.',
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
      'Play face-down cards and claim a rank. Others can call bluff. Wrong player spins. Last one standing wins.',
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
  memory: {
    id: 'memory',
    label: 'Memory Arena',
    tagline: 'Repeat the pattern.',
    description:
      'Tiles flash in order. Tap the same order. Wrong or out of time: you lose. Sequence grows each round.',
    icon: LayoutGrid,
    glowColor: 'rgba(56, 189, 248, 0.28)',
    accentColor: '#38BDF8',
    players: '2-12 players',
    maxPlayers: 12,
    duration: '~5 min',
    tags: ['memory', 'reaction', 'party'],
  },
  mafia: {
    id: 'mafia',
    label: 'Mafia',
    tagline: 'Night and day.',
    description:
      'Mafia kills at night; town votes by day. Mafia wins when equal to town.',
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
