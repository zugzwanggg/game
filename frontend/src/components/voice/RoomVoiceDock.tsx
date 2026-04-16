import { Mic, MicOff, Radio } from 'lucide-react'
import { useVoiceMode } from '../../context/useVoiceMode'
import { useRoomVoice, type VoicePeer } from '../../hooks/useRoomVoice'
import Button from '../ui/Button'

type RoomVoiceDockProps = {
  roomCode: string | null
  myPlayerId: string | null
  players: VoicePeer[]
  className?: string
  /** Mute all incoming/outgoing voice (e.g. Mafia night). */
  silenceAll?: boolean
}

export function RoomVoiceDock({
  roomCode,
  myPlayerId,
  players,
  className = '',
  silenceAll = false,
}: RoomVoiceDockProps) {
  const { voiceMode, setVoiceMode } = useVoiceMode()

  const { status, error, muted, setMuted, remoteAudioCount, peerCount } = useRoomVoice({
    roomCode,
    myPlayerId,
    peers: players,
    enabled: voiceMode && Boolean(roomCode && myPlayerId && players.length >= 2),
    silenceAll,
  })

  const canVoice = Boolean(roomCode && myPlayerId && players.length >= 2)
  const subline = !canVoice
    ? 'Voice needs at least two people in this room.'
    : silenceAll && voiceMode && (status === 'live' || status === 'requesting')
      ? 'Night: everyone muted until morning.'
      : voiceMode && status === 'live'
        ? `${remoteAudioCount}/${peerCount} connected · mesh · Opus`
        : voiceMode && status === 'requesting'
          ? 'Connecting…'
          : voiceMode && status === 'error'
            ? error ?? 'Could not open microphone'
            : 'Browser WebRTC: low bitrate, echo cancellation on'

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
            title={muted ? 'Unmute to talk' : 'Mute microphone'}
          >
            {muted ? <MicOff size={16} className="mr-1.5" /> : <Mic size={16} className="mr-1.5" />}
            {muted ? 'Unmute' : 'Mute'}
          </Button>
        )}
        {!voiceMode && (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            disabled={!canVoice}
            onClick={() => {
              if (!canVoice) return
              setVoiceMode(true)
            }}
            title="Enable room voice"
          >
            <Mic size={16} className="mr-1.5" />
            Enable voice
          </Button>
        )}
        {voiceMode && canVoice && (status === 'idle' || status === 'error') && (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => {
              // Quick opt-out; primary opt-out is in Settings.
              setVoiceMode(false)
            }}
            title="Turn voice off"
          >
            Turn off
          </Button>
        )}
      </div>
    </div>
  )
}
