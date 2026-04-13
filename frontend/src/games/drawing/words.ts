/** Simple nouns for local “guess the drawing” rounds. */
export const DRAW_WORDS = [
  'cat',
  'dog',
  'house',
  'tree',
  'sun',
  'moon',
  'car',
  'phone',
  'apple',
  'fish',
  'bird',
  'chair',
  'table',
  'book',
  'clock',
  'star',
  'cloud',
  'flower',
  'bicycle',
  'train',
  'cake',
  'pizza',
  'guitar',
  'hat',
  'shoe',
  'umbrella',
  'rocket',
  'robot',
  'castle',
  'bridge',
  'island',
  'volcano',
  'snowman',
  'butterfly',
  'elephant',
  'penguin',
  'banana',
  'orange',
  'lighthouse',
] as const

export function pickRandomWord(): string {
  const i = Math.floor(Math.random() * DRAW_WORDS.length)
  return DRAW_WORDS[i] ?? 'cat'
}

export function normalizeGuess(s: string): string {
  return s.trim().toLowerCase().replace(/\s+/g, ' ')
}
