import { Mic, MicOff, Radio } from 'lucide-react'
import { useVoiceMode } from '../../context/useVoiceMode'
import { useRoomVoice, type VoicePeer } from '../../hooks/useRoomVoice'
import Button from '../ui/Button'

type RoomVoiceDockProps = {
  roomCode: string | null
  myPlayerId: string | null
  players: VoicePeer[]
  className?: string
}

export function RoomVoiceDock({
  roomCode,
  myPlayerId,
  players,
  className = '',
}: RoomVoiceDockProps) {
  const { voiceMode, setVoiceMode, toggleVoiceMode } = useVoiceMode()

  const { status, error, muted, setMuted, remoteAudioCount, peerCount } = useRoomVoice({
    roomCode,
    myPlayerId,
    peers: players,
    enabled: voiceMode && Boolean(roomCode && myPlayerId && players.length >= 2),
  })

  const canVoice = Boolean(roomCode && myPlayerId && players.length >= 2)
  const subline = !canVoice
    ? 'Voice unlocks with 2+ people in this room.'
    : voiceMode && status === 'live'
      ? `${remoteAudioCount}/${peerCount} connected · mesh · Opus`
      : voiceMode && status === 'requesting'
        ? 'Connecting…'
        : voiceMode && status === 'error'
          ? error ?? 'Could not open microphone'
          : 'Browser WebRTC — low bitrate, echo cancellation on'

  return (
    <div
      className={`flex flex-col gap-2 rounded-xl border border-border bg-surface px-3 py-2.5 sm:flex-row sm:items-center sm:justify-between sm:gap-3 ${className}`}
    >
      <div className="flex min-w-0 flex-1 items-center gap-2.5">
        <div
          className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg ${
            voiceMode && status === 'live'
              ? 'bg-teal/20 text-teal'
              : voiceMode
                ? 'bg-amber-500/15 text-amber-200'
                : 'bg-card text-muted'
          }`}
        >
          {voiceMode ? <Mic size={18} aria-hidden /> : <MicOff size={18} aria-hidden />}
        </div>
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <p className="text-sm font-semibold text-text">Room voice</p>
            {voiceMode && canVoice && status === 'live' && (
              <span className="inline-flex items-center gap-1 rounded-md border border-teal/30 bg-teal/10 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-teal">
                <Radio size={10} aria-hidden /> Live
              </span>
            )}
          </div>
          <p className="truncate text-xs text-muted">{subline}</p>
        </div>
      </div>

      <div className="flex shrink-0 flex-wrap items-center justify-end gap-2">
        {voiceMode && canVoice && (status === 'live' || status === 'requesting') && (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => setMuted((m) => !m)}
            title={muted ? 'Unmute' : 'Mute'}
          >
            {muted ? <MicOff size={16} className="mr-1.5" /> : <Mic size={16} className="mr-1.5" />}
            {muted ? 'Muted' : 'Mute'}
          </Button>
        )}
        <button
          type="button"
          role="switch"
          aria-checked={voiceMode}
          aria-label={voiceMode ? 'Turn room voice off' : 'Turn room voice on'}
          disabled={!canVoice}
          onClick={() => {
            if (!canVoice) return
            toggleVoiceMode()
          }}
          className={`relative h-7 w-12 shrink-0 rounded-full transition-colors ${
            !canVoice ? 'cursor-not-allowed opacity-50' : ''
          } ${voiceMode ? 'bg-teal' : 'bg-border'}`}
        >
          <span
            className={`absolute top-0.5 h-6 w-6 rounded-full bg-white shadow transition-all duration-200 ${
              voiceMode ? 'right-0.5' : 'left-0.5'
            }`}
          />
        </button>
        {voiceMode && !canVoice && (
          <button
            type="button"
            className="text-xs font-medium text-muted hover:text-text"
            onClick={() => setVoiceMode(false)}
          >
            Turn off
          </button>
        )}
      </div>
    </div>
  )
}
