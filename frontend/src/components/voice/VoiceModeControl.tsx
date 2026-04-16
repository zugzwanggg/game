import { Mic, MicOff } from 'lucide-react'
import { useVoiceMode } from '../../context/useVoiceMode'

type VoiceModeControlProps = {
  className?: string
}

export function VoiceModeControl({ className = '' }: VoiceModeControlProps) {
  const { voiceMode, toggleVoiceMode } = useVoiceMode()

  return (
    <div
      className={`flex items-center justify-between gap-3 rounded-xl border border-border bg-surface px-3 py-2.5 ${className}`}
    >
      <div className="flex min-w-0 flex-1 items-center gap-2.5">
        <div
          className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg ${
            voiceMode ? 'bg-teal/20 text-teal' : 'bg-card text-muted'
          }`}
        >
          {voiceMode ? (
            <Mic size={18} aria-hidden />
          ) : (
            <MicOff size={18} aria-hidden />
          )}
        </div>
        <div className="min-w-0">
          <p className="text-sm font-semibold text-text">Voice mode</p>
          <p className="truncate text-xs text-muted">
            {voiceMode
              ? 'Mic enabled for this session (UI only).'
              : 'Voice chat off. Turn it on when you are ready.'}
          </p>
        </div>
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={voiceMode}
        aria-label={voiceMode ? 'Turn voice mode off' : 'Turn voice mode on'}
        onClick={toggleVoiceMode}
        className={`relative h-7 w-12 shrink-0 rounded-full transition-colors ${
          voiceMode ? 'bg-teal' : 'bg-border'
        }`}
      >
        <span
          className={`absolute top-0.5 h-6 w-6 rounded-full bg-white shadow transition-all duration-200 ${
            voiceMode ? 'right-0.5' : 'left-0.5'
          }`}
        />
      </button>
    </div>
  )
}
