const PROMPTS: string[] = [
  'When you realize it’s Monday again…',
  'POV: You opened the group chat after one hour.',
  'That moment you remember you forgot to save your work.',
  'When the Wi‑Fi disconnects during the final boss fight.',
  'Me pretending I didn’t see the notification.',
  'When the food arrives and everyone suddenly stops talking.',
  'You said “just one more episode” and now it’s 3 AM.',
  'When the teacher says “this will be on the test.”',
  'When you hit “send” and instantly regret it.',
  'When you get paid and your bank account still looks the same.',
  'When your code works on the first try (suspicious).',
  'When your friend says “I’m on my way” but they’re still at home.',
]

export function hashSeed(s: string) {
  let h = 0
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0
  return h
}

export function pickTwoPrompts(seed: string): [string, string] {
  const n = PROMPTS.length
  const a = Math.abs(hashSeed(seed)) % n
  const b = (a + 1 + (Math.abs(hashSeed(seed + ':b')) % (n - 1))) % n
  return [PROMPTS[a], PROMPTS[b]]
}

export function tieBreakIndex(seed: string, round: number) {
  return (Math.abs(hashSeed(`${seed}|${round}|ctx`)) % 2) as 0 | 1
}
