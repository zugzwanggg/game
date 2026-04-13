import { useEffect, useMemo, useRef, useState } from 'react'
import { getSocket } from '../lib/socket'

export type VoicePeer = { id: string; displayName: string }

const ICE_SERVERS: RTCIceServer[] = [
  { urls: 'stun:stun.l.google.com:19302' },
  { urls: 'stun:stun1.l.google.com:19302' },
]

const AUDIO_CONSTRAINTS: MediaStreamConstraints = {
  audio: {
    echoCancellation: true,
    noiseSuppression: true,
    autoGainControl: true,
    channelCount: 1,
  },
  video: false,
}

export type RoomVoiceStatus = 'idle' | 'requesting' | 'live' | 'error'

export type VoiceSignalWire =
  | { kind: 'offer'; sdp: RTCSessionDescriptionInit }
  | { kind: 'answer'; sdp: RTCSessionDescriptionInit }
  | { kind: 'candidate'; candidate: RTCIceCandidateInit }

function sortPeerIds(ids: string[]) {
  return [...ids].sort()
}

export function useRoomVoice(opts: {
  roomCode: string | null
  myPlayerId: string | null
  peers: VoicePeer[]
  enabled: boolean
}) {
  const { roomCode, myPlayerId, peers, enabled } = opts

  const [status, setStatus] = useState<RoomVoiceStatus>('idle')
  const [error, setError] = useState<string | null>(null)
  const [muted, setMuted] = useState(false)
  const [remoteAudioCount, setRemoteAudioCount] = useState(0)

  const mutedRef = useRef(muted)
  mutedRef.current = muted

  const localStreamRef = useRef<MediaStream | null>(null)
  const pcsRef = useRef<Map<string, RTCPeerConnection>>(new Map())
  const remoteTracksRef = useRef<Map<string, MediaStreamTrack>>(new Map())
  const remoteAudioRef = useRef<Map<string, HTMLAudioElement>>(new Map())
  const makingOfferRef = useRef<Set<string>>(new Set())
  const peerIdSetRef = useRef<Set<string>>(new Set())
  const myIdRef = useRef<string | null>(null)
  const signalBufferRef = useRef<{ fromPlayerId: string; signal: VoiceSignalWire }[]>([])
  const armedRef = useRef(false)

  const peerIds = useMemo(
    () => sortPeerIds(peers.map((p) => p.id).filter((id) => id && id !== myPlayerId)),
    [peers, myPlayerId],
  )
  const peerIdsKey = peerIds.join(',')

  useEffect(() => {
    if (!localStreamRef.current) return
    localStreamRef.current.getAudioTracks().forEach((t) => {
      t.enabled = !muted
    })
  }, [muted])

  useEffect(() => {
    myIdRef.current = myPlayerId
    peerIdSetRef.current = new Set(peerIds)
  }, [myPlayerId, peerIds])

  useEffect(() => {
    if (!enabled || !roomCode || !myPlayerId || peerIds.length === 0) {
      armedRef.current = false
      signalBufferRef.current = []
      for (const id of [...pcsRef.current.keys()]) {
        const pc = pcsRef.current.get(id)
        if (pc) {
          pc.ontrack = null
          pc.onicecandidate = null
          pc.onnegotiationneeded = null
          pc.close()
          pcsRef.current.delete(id)
        }
        const t = remoteTracksRef.current.get(id)
        if (t) {
          t.stop()
          remoteTracksRef.current.delete(id)
        }
        const a = remoteAudioRef.current.get(id)
        if (a) {
          a.pause()
          a.srcObject = null
          remoteAudioRef.current.delete(id)
        }
        makingOfferRef.current.delete(id)
      }
      if (localStreamRef.current) {
        localStreamRef.current.getTracks().forEach((tr) => tr.stop())
        localStreamRef.current = null
      }
      setRemoteAudioCount(0)
      setStatus('idle')
      setError(null)
      return
    }

    const socket = getSocket()
    if (!socket.connected) socket.connect()

    const emitSignal = (targetPlayerId: string, signal: VoiceSignalWire) => {
      socket.emit('voice:signal', { targetPlayerId, signal })
    }

    const ensurePc = (peerId: string): RTCPeerConnection => {
      let pc = pcsRef.current.get(peerId)
      if (pc) return pc
      pc = new RTCPeerConnection({
        iceServers: ICE_SERVERS,
        bundlePolicy: 'max-bundle',
        rtcpMuxPolicy: 'require',
      })
      pcsRef.current.set(peerId, pc)

      const stream = localStreamRef.current
      if (stream) {
        stream.getTracks().forEach((track) => pc!.addTrack(track, stream))
      }

      pc.onicecandidate = (ev) => {
        if (!ev.candidate) return
        try {
          emitSignal(peerId, { kind: 'candidate', candidate: ev.candidate.toJSON() })
        } catch {
          /* ignore */
        }
      }

      pc.ontrack = (ev) => {
        const [s] = ev.streams
        const track = s?.getAudioTracks()[0] ?? ev.track
        if (!track) return
        remoteTracksRef.current.set(peerId, track)

        const stream = s ?? new MediaStream([track])
        const prev = remoteAudioRef.current.get(peerId)
        if (prev) {
          prev.pause()
          prev.srcObject = null
        }
        const audio = new Audio()
        audio.autoplay = true
        audio.srcObject = stream
        remoteAudioRef.current.set(peerId, audio)
        void audio.play().catch(() => {
          /* user gesture may be required in strict browsers */
        })
        setRemoteAudioCount(remoteTracksRef.current.size)
      }

      return pc
    }

    const handleSignal = async (fromPlayerId: string, signal: VoiceSignalWire) => {
      const my = myIdRef.current
      if (!my || fromPlayerId === my || !peerIdSetRef.current.has(fromPlayerId)) return

      try {
        if (signal.kind === 'offer') {
          const pc = ensurePc(fromPlayerId)
          await pc.setRemoteDescription(new RTCSessionDescription(signal.sdp))
          const answer = await pc.createAnswer()
          await pc.setLocalDescription(answer)
          emitSignal(fromPlayerId, { kind: 'answer', sdp: pc.localDescription!.toJSON() })
        } else if (signal.kind === 'answer') {
          const pc = pcsRef.current.get(fromPlayerId)
          if (!pc) return
          await pc.setRemoteDescription(new RTCSessionDescription(signal.sdp))
        } else if (signal.kind === 'candidate') {
          const pc = ensurePc(fromPlayerId)
          try {
            await pc.addIceCandidate(new RTCIceCandidate(signal.candidate))
          } catch {
            /* ignore */
          }
        }
      } catch {
        /* ignore */
      }
    }

    const runNegotiation = async (peerId: string) => {
      const my = myIdRef.current
      if (!my || !peerIdSetRef.current.has(peerId) || !(my < peerId)) return
      const pc = ensurePc(peerId)
      if (makingOfferRef.current.has(peerId)) return
      makingOfferRef.current.add(peerId)
      try {
        const offer = await pc.createOffer()
        await pc.setLocalDescription(offer)
        emitSignal(peerId, { kind: 'offer', sdp: pc.localDescription!.toJSON() })
      } catch {
        /* ignore */
      } finally {
        makingOfferRef.current.delete(peerId)
      }
    }

    const onSignal = (payload: { fromPlayerId?: string; signal?: VoiceSignalWire }) => {
      const from = String(payload?.fromPlayerId ?? '')
      const signal = payload?.signal
      if (!from || !signal) return
      if (!armedRef.current) {
        signalBufferRef.current.push({ fromPlayerId: from, signal })
        return
      }
      void handleSignal(from, signal)
    }

    socket.on('voice:signal', onSignal)

    let cancelled = false

    void (async () => {
      setError(null)
      setStatus('requesting')
      try {
        const stream = await navigator.mediaDevices.getUserMedia(AUDIO_CONSTRAINTS)
        if (cancelled) {
          stream.getTracks().forEach((t) => t.stop())
          return
        }
        localStreamRef.current = stream
        stream.getAudioTracks().forEach((t) => {
          t.enabled = !mutedRef.current
        })

        armedRef.current = true
        const buf = signalBufferRef.current.splice(0, signalBufferRef.current.length)
        for (const { fromPlayerId, signal } of buf) {
          void handleSignal(fromPlayerId, signal)
        }

        const my = myPlayerId
        const others = sortPeerIds([...peerIdSetRef.current].filter((id) => id !== my))
        for (const peerId of others) {
          ensurePc(peerId)
          if (my < peerId) {
            await runNegotiation(peerId)
          }
        }

        if (!cancelled) setStatus('live')
      } catch (e: unknown) {
        if (!cancelled) {
          setStatus('error')
          setError(e instanceof Error ? e.message : 'Microphone unavailable')
          armedRef.current = false
          signalBufferRef.current = []
          for (const id of [...pcsRef.current.keys()]) {
            const pc = pcsRef.current.get(id)
            if (pc) {
              pc.close()
              pcsRef.current.delete(id)
            }
            const a = remoteAudioRef.current.get(id)
            if (a) {
              a.pause()
              a.srcObject = null
              remoteAudioRef.current.delete(id)
            }
          }
          if (localStreamRef.current) {
            localStreamRef.current.getTracks().forEach((t) => t.stop())
            localStreamRef.current = null
          }
          setRemoteAudioCount(0)
        }
      }
    })()

    return () => {
      cancelled = true
      socket.off('voice:signal', onSignal)
      armedRef.current = false
      signalBufferRef.current = []
      for (const id of [...pcsRef.current.keys()]) {
        const pc = pcsRef.current.get(id)
        if (pc) {
          pc.ontrack = null
          pc.onicecandidate = null
          pc.close()
          pcsRef.current.delete(id)
        }
        const t = remoteTracksRef.current.get(id)
        if (t) {
          t.stop()
          remoteTracksRef.current.delete(id)
        }
        const a = remoteAudioRef.current.get(id)
        if (a) {
          a.pause()
          a.srcObject = null
          remoteAudioRef.current.delete(id)
        }
        makingOfferRef.current.delete(id)
      }
      if (localStreamRef.current) {
        localStreamRef.current.getTracks().forEach((tr) => tr.stop())
        localStreamRef.current = null
      }
      setRemoteAudioCount(0)
      setStatus('idle')
      setError(null)
    }
  }, [enabled, roomCode, myPlayerId, peerIdsKey])

  return {
    status,
    error,
    muted,
    setMuted,
    remoteAudioCount,
    peerCount: peerIds.length,
  }
}
