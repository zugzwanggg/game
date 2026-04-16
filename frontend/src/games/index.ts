import { Eye, ImageIcon, Pencil, Skull, type LucideIcon } from 'lucide-react'

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
  spy: {
    id: 'spy',
    label: 'Spy',
    tagline: 'Blend in. Find the word. Don’t get caught.',
    description:
      'One player is the Spy and doesn’t know the secret word. Everyone else has the same word and must give hints without saying it. Then vote to catch the Spy — but if you tie, Spy wins instantly. If caught, the Spy gets one last guess.',
    icon: Eye,
    glowColor: 'rgba(255, 184, 0, 0.25)',
    accentColor: '#FFB800',
    players: '3–10 players',
    maxPlayers: 10,
    duration: '~5 min',
    tags: ['social deduction', 'voice', 'party'],
  },
  mafia: {
    id: 'mafia',
    label: 'Mafia',
    tagline: 'Trust no one. Survive the night.',
    description:
      'A classic social deduction game: a hidden Mafia faction eliminates at night while Town debates by day. Vote wisely — or the Mafia wins by parity.',
    icon: Skull,
    glowColor: 'rgba(244, 63, 94, 0.25)',
    accentColor: '#F43F5E',
    players: '5–12 players',
    maxPlayers: 12,
    duration: '~15 min',
    tags: ['social deduction', 'party', 'voice'],
  },
}

export const listGames = (): GameDefinition[] => Object.values(GAMES)

export const getGame = (id: string | undefined): GameDefinition | null =>
  id && GAMES[id] ? GAMES[id] : null
