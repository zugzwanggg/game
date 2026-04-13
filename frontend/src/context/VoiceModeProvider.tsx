import {
  useCallback,
  useMemo,
  useState,
  type ReactNode,
} from 'react'
import { VoiceModeContext } from './voiceModeContext'

const STORAGE_KEY = 'gamemaxxing_voice_mode'

function readStored(): boolean {
  try {
    return localStorage.getItem(STORAGE_KEY) === '1'
  } catch {
    return false
  }
}

function writeStored(on: boolean) {
  try {
    localStorage.setItem(STORAGE_KEY, on ? '1' : '0')
  } catch {
    /* ignore */
  }
}

export function VoiceModeProvider({ children }: { children: ReactNode }) {
  const [voiceMode, setVoiceModeState] = useState<boolean>(readStored)

  const setVoiceMode = useCallback((on: boolean) => {
    setVoiceModeState(on)
    writeStored(on)
  }, [])

  const toggleVoiceMode = useCallback(() => {
    setVoiceModeState((prev) => {
      const next = !prev
      writeStored(next)
      return next
    })
  }, [])

  const value = useMemo(
    () => ({ voiceMode, setVoiceMode, toggleVoiceMode }),
    [voiceMode, setVoiceMode, toggleVoiceMode],
  )

  return (
    <VoiceModeContext.Provider value={value}>
      {children}
    </VoiceModeContext.Provider>
  )
}
