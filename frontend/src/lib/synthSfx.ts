import { isSfxEnabled } from './sfxPrefs'

let ctx: AudioContext | null = null

function getCtx(): AudioContext | null {
  if (typeof window === 'undefined') return null
  if (!ctx) {
    const Ctor = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
    if (!Ctor) return null
    try {
      ctx = new Ctor()
    } catch {
      return null
    }
  }
  return ctx
}

function beep(
  freq: number,
  durationMs: number,
  volume: number,
  type: OscillatorType = 'sine',
): void {
  if (!isSfxEnabled()) return
  const c = getCtx()
  if (!c) return
  void c.resume().catch(() => {})

  const osc = c.createOscillator()
  const g = c.createGain()
  osc.connect(g)
  g.connect(c.destination)
  osc.type = type
  osc.frequency.setValueAtTime(freq, c.currentTime)
  const t0 = c.currentTime
  const dur = durationMs / 1000
  g.gain.setValueAtTime(0, t0)
  const peak = Math.min(0.22, volume)
  g.gain.linearRampToValueAtTime(peak, t0 + 0.008)
  g.gain.exponentialRampToValueAtTime(0.001, t0 + dur)
  osc.start(t0)
  osc.stop(t0 + dur + 0.03)
}

/** Someone joined the room. */
export function playRoomJoinSfx(): void {
  beep(660, 45, 0.11)
  window.setTimeout(() => beep(880, 40, 0.1), 55)
}

/** Someone left the room. */
export function playRoomLeaveSfx(): void {
  beep(520, 55, 0.1)
  window.setTimeout(() => beep(380, 60, 0.09), 50)
}

/** Meme: GIF locked in / submitted. */
export function playMemeSubmitSfx(): void {
  beep(920, 35, 0.11)
}

/** Meme: vote registered. */
export function playMemeVoteSfx(): void {
  beep(740, 42, 0.1)
}

/** Spy: someone called an early vote. */
export function playSpyCallVoteSfx(): void {
  beep(560, 40, 0.1, 'square')
  window.setTimeout(() => beep(780, 45, 0.1, 'sine'), 55)
}

/** Mafia: kill vote or town vote registered (local action). */
export function playMafiaVoteSfx(): void {
  beep(680, 40, 0.1)
}

/** Mafia: public dawn / vote reveal modal opens. */
export function playMafiaRevealPopupSfx(): void {
  beep(440, 28, 0.08)
  window.setTimeout(() => beep(660, 45, 0.11), 40)
}

/** Mafia: detective private investigation result modal. */
export function playMafiaPrivatePopupSfx(): void {
  beep(520, 35, 0.09)
  window.setTimeout(() => beep(780, 38, 0.1), 55)
}

export function playLiarCardPlaySfx(): void {
  beep(420, 55, 0.09, 'triangle')
}

export function playLiarCallSfx(): void {
  beep(320, 60, 0.14, 'square')
  window.setTimeout(() => beep(880, 90, 0.12, 'sawtooth'), 45)
}

export function playLiarFlipSfx(): void {
  beep(600, 35, 0.08)
  window.setTimeout(() => beep(900, 40, 0.09), 40)
}

export function playLiarSpinSfx(): void {
  beep(180, 120, 0.06, 'sine')
  window.setTimeout(() => beep(240, 100, 0.06, 'sine'), 70)
}

export function playLiarClickSfx(): void {
  beep(1200, 25, 0.14, 'square')
}

export function playLiarBangSfx(): void {
  beep(90, 220, 0.2, 'sawtooth')
  window.setTimeout(() => beep(55, 350, 0.18, 'square'), 40)
}
