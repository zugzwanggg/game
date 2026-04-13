export const DRAW_WORDS = [
  'cat',
  'pizza',
  'rocket',
  'tree',
  'bicycle',
  'guitar',
  'elephant',
  'house',
  'phone',
  'rainbow',
  'dragon',
  'cupcake',
] as const

export function pickRandomWord(): string {
  return DRAW_WORDS[Math.floor(Math.random() * DRAW_WORDS.length)] ?? 'cat'
}

export function normalizeGuess(s: string): string {
  return s
    .toLowerCase()
    .trim()
    .replaceAll(/[^a-z0-9]+/g, '')
}

export function toHint(word: string): string {
  const letters = word.split('')
  return letters.map((c) => (c === ' ' ? ' ' : '_')).join('')
}

