const STORAGE_KEY = 'gamemaxxing_sfx_enabled'

export function isSfxEnabled(): boolean {
  try {
    return localStorage.getItem(STORAGE_KEY) !== '0'
  } catch {
    return true
  }
}

export function setSfxEnabled(on: boolean): void {
  try {
    localStorage.setItem(STORAGE_KEY, on ? '1' : '0')
  } catch {
    /* ignore */
  }
}

export function readStoredSfxEnabled(): boolean {
  return isSfxEnabled()
}
