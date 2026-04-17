import { Mic, MicOff } from 'lucide-react'
import { useVoiceMode } from '../../context/useVoiceMode'
import { useRoomVoice, type VoicePeer } from '../../hooks/useRoomVoice'

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

  const { status, muted, setMuted } = useRoomVoice({
    roomCode,
    myPlayerId,
    peers: players,
    enabled: voiceMode && Boolean(roomCode && myPlayerId && players.length >= 2),
    silenceAll,
  })

  const canVoice = Boolean(roomCode && myPlayerId && players.length >= 2)
  const live = status === 'live'
  const connecting = status === 'requesting'

  const handleClick = () => {
    if (!canVoice) return
    if (!voiceMode) {
      setVoiceMode(true)
      return
    }
    if (live && !silenceAll) {
      setMuted((m) => !m)
      return
    }
    if (status === 'error' || status === 'idle') {
      setVoiceMode(false)
    }
  }

  const isDisabled = !canVoice || connecting || (voiceMode && live && silenceAll)

  const showUnmutedMic =
    !voiceMode || connecting || (live && !silenceAll && !muted)

  const label = !canVoice
    ? 'Room voice needs at least two people'
    : !voiceMode
      ? 'Enable room voice'
      : connecting
        ? 'Connecting…'
        : live && silenceAll
          ? 'Voice muted for this phase'
          : live
            ? muted
              ? 'Unmute microphone'
              : 'Mute microphone'
            : status === 'error'
              ? 'Voice error — click to turn off'
              : 'Room voice'

  return (
    <div className={`inline-flex items-center justify-center ${className}`}>
      <button
        type="button"
        disabled={isDisabled}
        onClick={handleClick}
        title={label}
        aria-label={label}
        aria-pressed={Boolean(voiceMode && live && !silenceAll && !muted)}
        className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-full border shadow-sm transition-all duration-150 focus:outline-none focus-visible:ring-2 focus-visible:ring-accent/50 disabled:cursor-not-allowed disabled:opacity-40 active:scale-95 ${
          voiceMode && live && !silenceAll && !muted
            ? 'border-teal/45 bg-teal/15 text-teal hover:border-teal/55 hover:bg-teal/25 hover:shadow-md'
            : 'border-zinc-200/90 bg-white/95 text-zinc-600 hover:border-zinc-300 hover:bg-white hover:text-zinc-900 hover:shadow-md'
        } ${connecting ? 'animate-pulse' : ''}`}
      >
        {showUnmutedMic ? (
          <Mic size={20} strokeWidth={2} aria-hidden />
        ) : (
          <MicOff size={20} strokeWidth={2} aria-hidden />
        )}
      </button>
    </div>
  )
}
