import correctGuessSfxUrl from '../assets/sfx/correct-sfx.mp3'
import { isSfxEnabled } from './sfxPrefs'

/** Short success sting when a player submits a correct guess (e.g. drawing). */
export function playCorrectGuessSfx(): void {
  if (!isSfxEnabled()) return
  const audio = new Audio(correctGuessSfxUrl)
  audio.volume = 0.95
  void audio.play().catch(() => {
    /* Autoplay policy or missing decode: ignore. */
  })
}
