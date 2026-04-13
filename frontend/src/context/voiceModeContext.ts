import { createContext } from 'react'

export type VoiceModeContextValue = {
  voiceMode: boolean
  setVoiceMode: (on: boolean) => void
  toggleVoiceMode: () => void
}

export const VoiceModeContext = createContext<VoiceModeContextValue | null>(null)
