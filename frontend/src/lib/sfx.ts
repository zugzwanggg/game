let ctx: AudioContext | null = null

function getCtx(): AudioContext | null {
  if (typeof window === 'undefined') return null
  try {
    if (!ctx) {
      const Ctx = window.AudioContext || (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
      if (!Ctx) return null
      ctx = new Ctx()
    }
    return ctx
  } catch {
    return null
  }
}

/** Call from a click or key handler so the browser allows sound. */
export async function ensureAudioReady(): Promise<void> {
  const c = getCtx()
  if (c?.state === 'suspended') await c.resume().catch(() => {})
}

function beep(frequency: number, durationSec: number, type: OscillatorType, volume: number) {
  const c = getCtx()
  if (!c) return
  const t0 = c.currentTime
  const osc = c.createOscillator()
  const gain = c.createGain()
  osc.type = type
  osc.frequency.setValueAtTime(frequency, t0)
  gain.gain.setValueAtTime(0.0001, t0)
  gain.gain.exponentialRampToValueAtTime(Math.max(0.0002, volume), t0 + 0.02)
  gain.gain.exponentialRampToValueAtTime(0.0001, t0 + durationSec)
  osc.connect(gain)
  gain.connect(c.destination)
  osc.start(t0)
  osc.stop(t0 + durationSec + 0.05)
}

/** Short pleasant confirmation (two soft notes). */
export function playWhoamiCorrect() {
  if (!getCtx()) return
  beep(523.25, 0.12, 'sine', 0.06)
  window.setTimeout(() => beep(659.25, 0.12, 'sine', 0.055), 70)
}

/** Low soft “nope” without being harsh. */
export function playWhoamiWrong() {
  beep(140, 0.22, 'triangle', 0.055)
  window.setTimeout(() => beep(110, 0.18, 'triangle', 0.04), 90)
}
