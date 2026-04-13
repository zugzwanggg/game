import { useContext } from 'react'
import { VoiceModeContext, type VoiceModeContextValue } from './voiceModeContext'

export function useVoiceMode(): VoiceModeContextValue {
  const ctx = useContext(VoiceModeContext)
  if (!ctx) {
    throw new Error('useVoiceMode must be used within VoiceModeProvider')
  }
  return ctx
}
