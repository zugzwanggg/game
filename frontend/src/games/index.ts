import { ImageIcon, Pencil, type LucideIcon } from 'lucide-react'

export type GameDefinition = {
  id: string
  label: string
  tagline: string
  description: string
  icon: LucideIcon
  /** Card cover art URL; omit to use the built-in placeholder */
  coverImage?: string
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
    glowColor: 'rgba(123, 97, 255, 0.3)',
    accentColor: '#7B61FF',
    players: '2–16 players',
    maxPlayers: 16,
    duration: '~15 min',
    tags: ['drawing', 'real-time', 'creative'],
  },
  meme: {
    id: 'meme',
    label: 'Meme Battle',
    tagline: 'May the funniest meme win.',
    description:
      'A prompt appears. Everyone picks the meme they think fits best. The group votes on the funniest. Chaos guaranteed.',
    icon: ImageIcon,
    glowColor: 'rgba(0, 212, 170, 0.3)',
    accentColor: '#00D4AA',
    players: '2–20 players',
    maxPlayers: 20,
    duration: '~10 min',
    tags: ['memes', 'voting', 'party'],
  },
}

export const listGames = (): GameDefinition[] => Object.values(GAMES)

export const getGame = (id: string | undefined): GameDefinition | null =>
  id && GAMES[id] ? GAMES[id] : null
