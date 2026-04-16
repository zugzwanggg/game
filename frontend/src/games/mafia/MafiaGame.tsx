import {
  ArrowLeft,
  Crown,
  HeartPulse,
  Moon,
  Search,
  Skull,
  Sun,
  Timer,
  Trophy,
  Users,
  Vote,
  X,
  type LucideIcon,
} from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import Avatar from '../../components/ui/Avatar'
import Badge from '../../components/ui/Badge'
import Button from '../../components/ui/Button'
import { RoomPresenceBanner } from '../../components/ui/RoomPresenceBanner'
import { RoomVoiceDock } from '../../components/voice/RoomVoiceDock'
import { useRoomPresenceNotification } from '../../hooks/useRoomPresenceNotification'
import { removeRecentRoom } from '../../lib/recentRooms'
import { getSocket } from '../../lib/socket'
import { joinRoom } from '../../lib/roomJoin'
import { getGame } from '../../games'
import {
  playMafiaPrivatePopupSfx,
  playMafiaRevealPopupSfx,
  playMafiaVoteSfx,
} from '../../lib/synthSfx'

function uid() {
  try {
    return typeof crypto !== 'undefined' && 'randomUUID' in crypto
      ? crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(16).slice(2)}`
  } catch {
    return `${Date.now()}-${Math.random().toString(16).slice(2)}`
  }
}

type MafiaRoleWire =
  | { role: null }
  | { role: 'mafia'; teammateIds: string[] }
  | { role: 'town' | 'doctor' | 'detective' }

type ChatMessage = {
  id: string
  author: string
  text: string
  variant: 'chat' | 'system'
}

type MafiaPublicRole = 'mafia' | 'town' | 'doctor' | 'detective'

type MafiaLastAnnouncementWire = {
  kind: 'night' | 'vote'
  playerId: string | null
  secondaryPlayerId?: string | null
  roleReveal: MafiaPublicRole | null
  secondaryRoleReveal?: MafiaPublicRole | null
  primaryKillBy?: 'mafia' | 'detective'
  secondaryKillBy?: 'mafia' | 'detective'
  doctorSavedPlayerIds?: string[]
}

type MafiaGameWire =
  | {
      matchId: number
      round: number
      status: 'lobby' | 'night' | 'day' | 'voting'
      alive: Record<string, boolean>
      phaseEndsAt: number | null
      nightEndsAt: number | null
      dayEndsAt: number | null
      voteEndsAt: number | null
      resultsEndsAt: number | null
      winner: null
      lastAnnouncement: MafiaLastAnnouncementWire | null
      mafiaKillVoteCount?: number
      dayVoteCount?: number
      /** Alive players who tapped skip-to-vote this day. */
      daySkipYesCount?: number
      /** Living mafia who tapped skip-night (mafia UI only; may hint team size). */
      nightSkipYesCount?: number
      /** Mafia + Doctor + Detective (alive) who must agree to skip night. */
      nightActorsRequiredCount?: number
    }
  | {
      matchId: number
      round: number
      status: 'results'
      alive: Record<string, boolean>
      phaseEndsAt: number | null
      resultsEndsAt: number | null
      winner: 'town' | 'mafia'
      lastAnnouncement: MafiaLastAnnouncementWire | null
      roles: Record<string, string>
      mafiaKillVoteCount?: number
      dayVoteCount?: number
      daySkipYesCount?: number
      nightSkipYesCount?: number
      nightActorsRequiredCount?: number
    }

type TimersWire = {
  mafiaNightSecLeft?: number
  mafiaDaySecLeft?: number
  mafiaVoteSecLeft?: number
  mafiaResultsSecLeft?: number
}

function formatClock(sec: number) {
  const s = Math.max(0, Math.floor(sec))
  const m = Math.floor(s / 60)
  const r = s % 60
  return `${m}:${r.toString().padStart(2, '0')}`
}

function roleLabel(r: string) {
  if (r === 'mafia') return 'Mafia'
  if (r === 'doctor') return 'Doctor'
  if (r === 'detective') return 'Detective'
  return 'Town'
}

function killerTeamLabel(by: 'mafia' | 'detective' | undefined): string {
  if (by === 'detective') return 'The Detective'
  return 'The Mafia'
}

function joinPlayerNames(ids: string[], nameById: Map<string, string>): string {
  const n = ids.map((id) => nameById.get(id) ?? 'Unknown')
  if (n.length === 0) return ''
  if (n.length === 1) return n[0]!
  if (n.length === 2) return `${n[0]} and ${n[1]}`
  return `${n.slice(0, -1).join(', ')}, and ${n[n.length - 1]!}`
}

function RoleRevealIcon({ role, className = '' }: { role: string; className?: string }) {
  const base = `inline-block shrink-0 align-middle ${className}`
  if (role === 'mafia') return <Skull size={18} className={`${base} text-rose-300`} aria-hidden />
  if (role === 'doctor') return <HeartPulse size={18} className={`${base} text-teal-300`} aria-hidden />
  if (role === 'detective') return <Search size={18} className={`${base} text-sky-300`} aria-hidden />
  return <Users size={18} className={`${base} text-muted`} aria-hidden />
}

export default function MafiaGame() {
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const roomCode = searchParams.get('room')
  const isOnline = Boolean(roomCode)

  const [playerId, setPlayerId] = useState<string | null>(null)
  const [players, setPlayers] = useState<{ id: string; displayName: string }[]>([])
  const [createdByUserId, setCreatedByUserId] = useState<string | null>(null)
  const [mafia, setMafia] = useState<MafiaGameWire | null>(null)
  const [timers, setTimers] = useState<TimersWire>({})
  const [role, setRole] = useState<MafiaRoleWire | null>(null)
  const [myDayVote, setMyDayVote] = useState<string | null>(null)
  const [myKillVote, setMyKillVote] = useState<string | null>(null)
  const [investigateHint, setInvestigateHint] = useState<string | null>(null)
  const [doctorProtectTarget, setDoctorProtectTarget] = useState<string | null>(null)
  /** Server: cannot protect same player two nights in a row. */
  const [doctorCannotProtectPlayerId, setDoctorCannotProtectPlayerId] = useState<string | null>(null)
  const [detectiveNightCommitted, setDetectiveNightCommitted] = useState(false)
  const [chatInput, setChatInput] = useState('')
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [mobileTab, setMobileTab] = useState<'round' | 'chat' | 'players'>('round')
  const [daySkipClicked, setDaySkipClicked] = useState(false)
  const [nightSkipClicked, setNightSkipClicked] = useState(false)
  const [announcementOpen, setAnnouncementOpen] = useState(false)
  const lastAnnouncementKeyRef = useRef<string>('')
  const [detectiveCheckTargetId, setDetectiveCheckTargetId] = useState<string | null>(null)
  const [privateInvestigation, setPrivateInvestigation] = useState<{
    targetId: string
    role: string
  } | null>(null)

  const isHost = Boolean(playerId && createdByUserId && playerId === createdByUserId)
  const minPlayersMet = players.length >= 5 && players.length <= 12

  const backTarget = '/games/mafia'

  const { payload: presencePayload, handlePlayersSnapshot, dismiss: dismissPresence } =
    useRoomPresenceNotification(isOnline && roomCode ? roomCode : null)

  const status = mafia?.status ?? 'lobby'
  const nightSec = timers.mafiaNightSecLeft ?? 0
  const daySec = timers.mafiaDaySecLeft ?? 0
  const voteSec = timers.mafiaVoteSecLeft ?? 0
  const resultsSec = timers.mafiaResultsSecLeft ?? 0

  const nameById = useMemo(() => {
    const m = new Map<string, string>()
    for (const p of players) m.set(p.id, p.displayName)
    return m
  }, [players])

  const aliveSet = mafia?.alive ?? {}
  const alivePlayers = useMemo(
    () => players.filter((p) => aliveSet[p.id] === true),
    [players, aliveSet],
  )

  const deadPlayers = useMemo(
    () => players.filter((p) => aliveSet[p.id] === false),
    [players, aliveSet],
  )

  const imAlive = playerId ? aliveSet[playerId] === true : false
  const matchActive = status !== 'lobby' && status !== 'results'
  const showAliveDeadRoster = status !== 'lobby'

  const chatLockedAtNight =
    status === 'night' && role?.role !== 'detective'

  const mafiaTeamSize =
    role?.role === 'mafia' ? 1 + (role.teammateIds?.length ?? 0) : 0

  const mafiaBrand = getGame('mafia')
  const MafiaLogoIcon = mafiaBrand?.icon ?? Skull
  const brandAccent = mafiaBrand?.accentColor ?? '#F43F5E'

  useEffect(() => {
    if (!isOnline || !roomCode) return
    const socket = getSocket()
    if (!socket.connected) socket.connect()

    const runJoin = () => {
      void joinRoom(roomCode).then(({ player }) => {
        if (player?.id) setPlayerId(String(player.id))
        socket.emit('game:mafia:role:request')
      })
    }
    runJoin()
    socket.on('connect', runJoin)

    const onState = (state: any) => {
      if (String(state?.code ?? '').toUpperCase() !== roomCode.toUpperCase()) return
      if (typeof state?.youPlayerId === 'string' && state.youPlayerId) setPlayerId(state.youPlayerId)
      if (Array.isArray(state?.players)) {
        const next = (state.players as any[]).map((p) => ({
          id: String(p.id),
          displayName: String(p.displayName ?? 'Player'),
        }))
        setPlayers(next)
        handlePlayersSnapshot(next)
      }
      if (typeof state?.createdByUserId === 'string') setCreatedByUserId(state.createdByUserId)
      const mg = state.mafiaGame as MafiaGameWire | null | undefined
      setMafia(mg ?? null)
      if (!mg || mg.status === 'lobby') setRole(null)
      setTimers((state.timers ?? {}) as TimersWire)
      if (Array.isArray(state?.chat)) {
        setMessages(
          state.chat.map((m: any) => ({
            id: String(m.id ?? uid()),
            author: String(m.author ?? 'Player'),
            text: String(m.text ?? ''),
            variant: m.variant === 'system' || String(m.author ?? '') === 'Game' ? 'system' : 'chat',
          })),
        )
      }
    }

    const onRole = (p: any) => {
      if (p?.role === 'mafia' && Array.isArray(p?.teammateIds)) {
        setRole({ role: 'mafia', teammateIds: p.teammateIds.map((x: any) => String(x)) })
      } else if (p?.role === 'town' || p?.role === 'doctor' || p?.role === 'detective') {
        setRole({ role: p.role })
      } else {
        setRole({ role: null })
      }
    }

    const onDetectiveCheckAck = (p: { targetPlayerId?: string }) => {
      const t = p?.targetPlayerId
      if (t) setDetectiveCheckTargetId(String(t))
      setDetectiveNightCommitted(true)
    }

    const onInvestigateReveal = (p: { targetPlayerId?: string; role?: string }) => {
      const tid = p?.targetPlayerId
      const r = p?.role
      if (tid && r) {
        setPrivateInvestigation({ targetId: String(tid), role: String(r) })
        setInvestigateHint(`Role: ${roleLabel(r)}`)
      }
    }

    const onDoctorSaveAck = (p: { targetPlayerId?: string }) => {
      const t = p?.targetPlayerId
      if (t) setDoctorProtectTarget(String(t))
    }

    const onDoctorRestriction = (p: { cannotProtectPlayerId?: string | null }) => {
      setDoctorCannotProtectPlayerId(p?.cannotProtectPlayerId != null ? String(p.cannotProtectPlayerId) : null)
    }

    const onDetectiveKillAck = () => {
      setDetectiveNightCommitted(true)
    }

    socket.on('room:state', onState)
    socket.on('game:mafia:role', onRole)
    socket.on('game:mafia:detective_check_ack', onDetectiveCheckAck)
    socket.on('game:mafia:investigate_reveal', onInvestigateReveal)
    socket.on('game:mafia:doctor_save_ack', onDoctorSaveAck)
    socket.on('game:mafia:doctor_restriction', onDoctorRestriction)
    socket.on('game:mafia:detective_kill_ack', onDetectiveKillAck)

    const onChat = (m: any) => {
      const variant = m.variant === 'system' || m.author === 'Game' ? 'system' : 'chat'
      setMessages((prev) => [
        ...prev,
        {
          id: String(m.id ?? uid()),
          author: String(m.author ?? 'Player'),
          text: String(m.text ?? ''),
          variant,
        },
      ])
    }
    const onChatClear = () => setMessages([])
    socket.on('chat:message', onChat)
    socket.on('chat:clear', onChatClear)

    return () => {
      socket.off('connect', runJoin)
      socket.off('room:state', onState)
      socket.off('game:mafia:role', onRole)
      socket.off('game:mafia:detective_check_ack', onDetectiveCheckAck)
      socket.off('game:mafia:investigate_reveal', onInvestigateReveal)
      socket.off('game:mafia:doctor_save_ack', onDoctorSaveAck)
      socket.off('game:mafia:doctor_restriction', onDoctorRestriction)
      socket.off('game:mafia:detective_kill_ack', onDetectiveKillAck)
      socket.off('chat:message', onChat)
      socket.off('chat:clear', onChatClear)
    }
  }, [isOnline, roomCode, handlePlayersSnapshot])

  useEffect(() => {
    if (!roomCode) return
    if (role) return
    if (!mafia || mafia.status === 'lobby') return
    const socket = getSocket()
    if (!socket.connected) socket.connect()
    socket.emit('game:mafia:role:request')
  }, [roomCode, role, mafia?.status])

  useEffect(() => {
    if (!mafia?.matchId) return
    setDoctorCannotProtectPlayerId(null)
  }, [mafia?.matchId])

  useEffect(() => {
    if (!mafia?.matchId) return
    setMyDayVote(null)
    setMyKillVote(null)
    setInvestigateHint(null)
    setDetectiveCheckTargetId(null)
    setPrivateInvestigation(null)
    setDoctorProtectTarget(null)
    setDetectiveNightCommitted(false)
    setDaySkipClicked(false)
    setNightSkipClicked(false)
  }, [mafia?.matchId, mafia?.round])

  useEffect(() => {
    if (mafia?.status !== 'day') setDaySkipClicked(false)
  }, [mafia?.status])

  useEffect(() => {
    if (mafia?.status !== 'night') {
      setNightSkipClicked(false)
      setMyKillVote(null)
      setDoctorProtectTarget(null)
      setDetectiveNightCommitted(false)
      setDetectiveCheckTargetId(null)
    }
  }, [mafia?.status])

  useEffect(() => {
    if (mafia?.status === 'voting') setMobileTab('round')
  }, [mafia?.status])

  useEffect(() => {
    lastAnnouncementKeyRef.current = ''
  }, [mafia?.matchId])

  useEffect(() => {
    if (!mafia?.lastAnnouncement || mafia.status === 'lobby') return
    const a = mafia.lastAnnouncement
    const key = [
      mafia.matchId,
      mafia.round,
      a.kind,
      a.playerId ?? '',
      a.secondaryPlayerId ?? '',
      (a.doctorSavedPlayerIds ?? []).join(','),
    ].join('|')
    if (lastAnnouncementKeyRef.current === key) return
    lastAnnouncementKeyRef.current = key
    setAnnouncementOpen(true)
    playMafiaRevealPopupSfx()
  }, [mafia?.matchId, mafia?.round, mafia?.lastAnnouncement, mafia?.status])

  useEffect(() => {
    if (!announcementOpen) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setAnnouncementOpen(false)
    }
    document.addEventListener('keydown', onKey)
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.removeEventListener('keydown', onKey)
      document.body.style.overflow = prev
    }
  }, [announcementOpen])

  useEffect(() => {
    if (!privateInvestigation) return
    playMafiaPrivatePopupSfx()
  }, [privateInvestigation])

  const leaveRoomSocket = () => {
    if (!roomCode) return
    const socket = getSocket()
    if (socket.connected) socket.emit('room:leave')
    removeRecentRoom(roomCode)
  }

  const startMatch = () => {
    if (!roomCode) return
    const socket = getSocket()
    if (!socket.connected) socket.connect()
    socket.emit('game:mafia:start')
  }

  const sendChat = (e: React.FormEvent) => {
    e.preventDefault()
    if (!roomCode) return
    const text = chatInput.trim()
    if (!text) return
    getSocket().emit('chat:message', { text })
    setChatInput('')
  }

  const castKillVote = (targetPlayerId: string) => {
    if (!roomCode || !playerId) return
    if (targetPlayerId === playerId) return
    playMafiaVoteSfx()
    setMyKillVote(targetPlayerId)
    getSocket().emit('game:mafia:kill_vote', { targetPlayerId })
  }

  const doctorSave = (targetPlayerId: string) => {
    if (!roomCode || !playerId) return
    if (doctorCannotProtectPlayerId != null && targetPlayerId === doctorCannotProtectPlayerId) return
    getSocket().emit('game:mafia:doctor_save', { targetPlayerId })
  }

  const detectiveProbe = (targetPlayerId: string) => {
    if (!roomCode || !playerId || detectiveNightCommitted) return
    getSocket().emit('game:mafia:detective_investigate', { targetPlayerId })
  }

  const detectiveKill = (targetPlayerId: string) => {
    if (!roomCode || !playerId || detectiveNightCommitted) return
    getSocket().emit('game:mafia:detective_kill', { targetPlayerId })
  }

  const castDayVote = (targetPlayerId: string) => {
    if (!roomCode || !playerId) return
    if (targetPlayerId === playerId) return
    playMafiaVoteSfx()
    setMyDayVote(targetPlayerId)
    getSocket().emit('game:mafia:day_vote', { targetPlayerId })
  }

  const requestSkipToVote = () => {
    if (!roomCode || !imAlive) return
    setDaySkipClicked(true)
    getSocket().emit('game:mafia:day_skip')
  }

  const requestSkipNight = () => {
    if (!roomCode) return
    if (role?.role === 'mafia' && !myKillVote) return
    if (role?.role !== 'mafia' && role?.role !== 'doctor' && role?.role !== 'detective') return
    setNightSkipClicked(true)
    getSocket().emit('game:mafia:night_skip')
  }

  const phaseTimer =
    status === 'night'
      ? nightSec
      : status === 'day'
        ? daySec
        : status === 'voting'
          ? voteSec
          : status === 'results'
            ? resultsSec
            : 0

  const phaseBadge: {
    Icon: LucideIcon
    label: string
    chipClass: string
  } =
    status === 'night'
      ? {
          Icon: Moon,
          label: 'Night',
          chipClass:
            'border-indigo-400/35 bg-indigo-500/15 text-indigo-100 [&_svg]:text-indigo-200',
        }
      : status === 'day'
        ? {
            Icon: Sun,
            label: 'Day',
            chipClass:
              'border-amber-400/40 bg-amber-500/15 text-amber-50 [&_svg]:text-amber-200',
          }
        : status === 'voting'
          ? {
              Icon: Vote,
              label: 'Vote',
              chipClass: 'border-teal-400/35 bg-teal-500/15 text-teal-50 [&_svg]:text-teal-200',
            }
          : status === 'results'
            ? {
                Icon: Trophy,
                label: 'Results',
                chipClass:
                  'border-fuchsia-400/35 bg-fuchsia-500/15 text-fuchsia-50 [&_svg]:text-fuchsia-200',
              }
            : {
                Icon: MafiaLogoIcon,
                label: 'Lobby',
                chipClass: 'border-border bg-surface text-muted [&_svg]:text-muted',
              }

  const PhaseBadgeIcon = phaseBadge.Icon

  if (!isOnline || !roomCode) {
    return (
      <div className="flex flex-1 items-center justify-center text-muted">
        Mafia is room-only. Create or join a room to play.
      </div>
    )
  }

  /** Scroll area for long target lists (night roles, voting). */
  const playerListScrollClass =
    'min-h-0 max-h-[min(300px,40vh)] overflow-y-auto overscroll-contain rounded-xl border border-border/50 bg-base/40 p-2 shadow-[inset_0_1px_0_0_rgba(255,255,255,0.04)] sm:max-h-[min(360px,48vh)]'

  return (
    <div className="relative flex h-full min-h-0 flex-1 flex-col overflow-hidden px-4 py-4 sm:px-6 sm:py-5">
      <RoomPresenceBanner
        message={presencePayload?.text ?? null}
        kind={presencePayload?.kind ?? null}
        onDismiss={dismissPresence}
      />

      <div className="mb-4 flex shrink-0 flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex flex-wrap items-center gap-3">
          <Link
            to={backTarget}
            className="inline-flex items-center gap-2 rounded-xl border border-border bg-surface px-3 py-2 text-sm text-muted hover:text-text"
            onClick={(e) => {
              if (roomCode) {
                e.preventDefault()
                leaveRoomSocket()
                void navigate(backTarget)
              }
            }}
          >
            <ArrowLeft size={16} /> Back
          </Link>
          <div className="flex items-center gap-2.5">
            <div
              className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-white/10 shadow-inner"
              style={{
                background: `linear-gradient(145deg, ${brandAccent}35, ${brandAccent}12)`,
                boxShadow: `0 0 24px ${brandAccent}22`,
              }}
              aria-hidden
            >
              <MafiaLogoIcon size={22} className="text-text" strokeWidth={1.75} />
            </div>
            <div className="text-sm font-semibold text-text">Mafia</div>
            <div className="uppercase tracking-wider">
              <Badge color="accent">{roomCode}</Badge>
            </div>
            {isHost && (
              <div className="uppercase tracking-wider">
                <Badge color="accent">
                  <Crown size={12} className="mr-1 inline-block" /> host
                </Badge>
              </div>
            )}
          </div>
        </div>

        {status !== 'lobby' && (
          <div className="flex flex-wrap items-center gap-3 text-sm">
            <span
              className={[
                'inline-flex items-center gap-2 rounded-xl border px-3 py-1.5 text-xs font-semibold uppercase tracking-wider',
                phaseBadge.chipClass,
              ].join(' ')}
            >
              <PhaseBadgeIcon size={16} className="shrink-0" aria-hidden />
              {phaseBadge.label}
            </span>
            <span className="inline-flex items-center gap-1.5 text-muted">
              <Timer size={14} className="shrink-0 opacity-80" aria-hidden />
              <span className="font-mono font-semibold text-text">{formatClock(phaseTimer)}</span>
            </span>
          </div>
        )}
      </div>

      {!imAlive && matchActive && (
        <div className="mb-4 flex shrink-0 items-start gap-3 rounded-2xl border border-rose-500/45 bg-gradient-to-r from-rose-950/55 to-rose-950/25 px-4 py-3 text-rose-50 shadow-[0_0_0_1px_rgba(244,63,94,0.12)]">
          <Skull size={22} className="mt-0.5 shrink-0 text-rose-400" aria-hidden />
          <div className="min-w-0">
            <div className="text-sm font-bold tracking-wide text-rose-100">You are eliminated</div>
            <p className="mt-1 text-sm leading-snug text-rose-200/90">
              You are out of the game. Watch the round, but you cannot vote or use night actions.
            </p>
          </div>
        </div>
      )}

      <div className="mb-4 max-w-2xl shrink-0">
        <RoomVoiceDock
          roomCode={roomCode}
          myPlayerId={playerId}
          players={players.map((p) => ({ id: p.id, displayName: p.displayName }))}
          silenceAll={status === 'night'}
        />
      </div>

      <div className="mb-3 flex shrink-0 gap-2 lg:hidden">
        {[
          { id: 'round' as const, label: 'Round' },
          { id: 'chat' as const, label: 'Chat' },
          { id: 'players' as const, label: 'Players' },
        ].map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => setMobileTab(t.id)}
            className={[
              'flex-1 rounded-xl border px-3 py-2.5 text-sm font-semibold transition-colors',
              mobileTab === t.id ? 'border-accent bg-accent/10 text-text' : 'border-border bg-surface text-muted',
            ].join(' ')}
          >
            {t.label}
          </button>
        ))}
      </div>

      <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-hidden lg:flex-row lg:items-stretch">
        <div
          className={[
            'flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden rounded-2xl border border-border bg-surface',
            mobileTab === 'round' ? 'flex' : 'hidden',
            'lg:flex',
          ].join(' ')}
        >
          <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-4">
          {status === 'lobby' && (
            <div className="flex min-h-full flex-1 flex-col items-center justify-center py-8 text-center">
              <div className="mb-2 text-lg font-semibold text-text">Mafia</div>
              <div className="mb-6 max-w-md text-sm text-muted">
                5-12 players. Mafia eliminates at night; town debates by day and votes out suspects. When Mafia
                reach parity with town, Mafia wins.
              </div>
              {isHost ? (
                <Button
                  variant="teal"
                  size="lg"
                  type="button"
                  disabled={!minPlayersMet}
                  onClick={startMatch}
                  className="justify-center"
                >
                  {!minPlayersMet ? 'Need 5-12 players' : 'Start game'}
                </Button>
              ) : (
                <div className="text-sm text-muted">Waiting for the host to start…</div>
              )}
            </div>
          )}

          {status !== 'lobby' && status !== 'results' && (
            <div className="mb-4 shrink-0 rounded-2xl border border-border bg-base p-4">
              <div className="mb-1 text-xs font-semibold uppercase tracking-wider text-muted">Your role</div>
              {role?.role === 'mafia' ? (
                <div>
                  <div className="text-lg font-semibold text-rose-300">You are Mafia.</div>
                  <div className="mt-2 text-sm text-muted">
                    Teammates:{' '}
                    {role.teammateIds.length
                      ? role.teammateIds.map((id) => nameById.get(id) ?? id).join(', ')
                      : '-'}
                  </div>
                </div>
              ) : role?.role === 'doctor' ? (
                <div className="text-lg font-semibold text-teal">You are the Doctor.</div>
              ) : role?.role === 'detective' ? (
                <div className="text-lg font-semibold text-sky-300">You are the Detective.</div>
              ) : role?.role === 'town' ? (
                <div className="text-lg font-semibold text-text">You are Town.</div>
              ) : (
                <div className="text-sm text-muted">Loading…</div>
              )}
            </div>
          )}

          {status === 'night' && mafia && (
            <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-hidden pb-1">
              <div className="shrink-0 flex items-center justify-between gap-3">
                <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-muted">
                  <Moon size={16} className="text-indigo-200" aria-hidden />
                  Night
                </div>
                <div className="text-sm text-muted">
                  <Timer size={14} className="mr-1 inline-block align-middle" />
                  {formatClock(nightSec)}
                </div>
              </div>
              <p className="shrink-0 text-sm text-muted">
                Chat is closed at night for most roles; the Detective can still chat while choosing an action.
                Mafia: agree on a kill (vote first, then you can skip). Doctor & Detective: use your actions or
                tap Skip night. The night only ends early when every player with a night role has agreed to
                skip.
              </p>

              {role?.role === 'mafia' && imAlive && (
                <div className="flex min-h-0 flex-1 flex-col gap-2 overflow-hidden">
                  <div className="shrink-0 text-xs font-semibold uppercase text-muted">Mafia kill vote</div>
                  <div className={playerListScrollClass}>
                    <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                    {alivePlayers.filter((p) => p.id !== playerId).map((p) => {
                      const active = myKillVote === p.id
                      return (
                        <button
                          key={p.id}
                          type="button"
                          onClick={() => castKillVote(p.id)}
                          className={[
                            'flex items-center gap-3 rounded-xl border px-3 py-2.5 text-left transition-all',
                            active ? 'border-rose-400/60 bg-rose-500/10' : 'border-border bg-base hover:border-accent/40',
                          ].join(' ')}
                        >
                          <Avatar name={p.displayName} size="sm" />
                          <div className="min-w-0">
                            <div className="truncate text-sm font-semibold text-text">{p.displayName}</div>
                            <div className="text-xs text-muted">{active ? 'Your vote' : 'Vote to kill'}</div>
                          </div>
                        </button>
                      )
                    })}
                    </div>
                  </div>
                  <div className="shrink-0 text-xs text-muted">
                    Mafia votes: {mafia.mafiaKillVoteCount ?? 0} (majority resolves at dawn)
                  </div>

                  {myKillVote && mafiaTeamSize > 0 && (
                    <div className="mt-auto shrink-0 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border bg-surface/95 px-3 py-2.5 shadow-[0_-8px_24px_-6px_rgba(0,0,0,0.4)] backdrop-blur-sm">
                      <div className="text-sm text-muted">
                        Skip night:{' '}
                        <span className="font-semibold text-text">{mafia.nightSkipYesCount ?? 0}</span> /{' '}
                        <span className="font-semibold text-text">
                          {mafia.nightActorsRequiredCount ?? '-'}
                        </span>{' '}
                        ready. Every Mafia (kill vote first), Doctor, and Detective must agree.
                      </div>
                      <Button
                        type="button"
                        variant="ghost"
                        className="shrink-0"
                        onClick={requestSkipNight}
                        disabled={nightSkipClicked}
                      >
                        {nightSkipClicked ? 'Skip requested' : 'Skip night'}
                      </Button>
                    </div>
                  )}
                </div>
              )}

              {role?.role === 'doctor' && imAlive && (
                <div className="flex min-h-0 flex-1 flex-col gap-2 overflow-hidden">
                  <div className="shrink-0 text-xs font-semibold uppercase text-muted">Protect</div>
                  <p className="shrink-0 text-sm text-muted">
                    You cannot protect the same player on two nights in a row.
                  </p>
                  {!playerId ? (
                    <p className="text-sm text-muted">Connecting to the room…</p>
                  ) : (
                    <>
                      <div className={playerListScrollClass}>
                        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                        {alivePlayers.map((p) => {
                          const active = doctorProtectTarget === p.id
                          const blocked =
                            doctorCannotProtectPlayerId != null && p.id === doctorCannotProtectPlayerId
                          return (
                            <button
                              key={p.id}
                              type="button"
                              disabled={blocked}
                              onClick={() => doctorSave(p.id)}
                              className={[
                                'flex items-center gap-3 rounded-xl border px-3 py-2.5 text-left transition-all',
                                blocked
                                  ? 'cursor-not-allowed border-border/40 bg-base/40 opacity-60'
                                  : active
                                    ? 'border-teal/60 bg-teal/10 hover:border-teal/50'
                                    : 'border-border bg-base hover:border-teal/40',
                              ].join(' ')}
                            >
                              <Avatar name={p.displayName} size="sm" />
                              <div className="min-w-0">
                                <span className="block truncate text-sm font-semibold text-text">{p.displayName}</span>
                                <span className="text-xs text-muted">
                                  {blocked
                                    ? 'Protected last night. Pick someone else'
                                    : active
                                      ? 'Your protection'
                                      : 'Tap to protect'}
                                </span>
                              </div>
                            </button>
                          )
                        })}
                        </div>
                      </div>
                      <div className="mt-auto shrink-0 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border bg-surface/95 px-3 py-2.5 shadow-[0_-8px_24px_-6px_rgba(0,0,0,0.4)] backdrop-blur-sm">
                        <div className="text-sm text-muted">
                          Skip night:{' '}
                          <span className="font-semibold text-text">{mafia.nightSkipYesCount ?? 0}</span> /{' '}
                          <span className="font-semibold text-text">
                            {mafia.nightActorsRequiredCount ?? '-'}
                          </span>{' '}
                          ready. Everyone with a night role must agree (you can skip if you&apos;re fine ending now).
                        </div>
                        <Button
                          type="button"
                          variant="ghost"
                          className="shrink-0"
                          onClick={requestSkipNight}
                          disabled={nightSkipClicked}
                        >
                          {nightSkipClicked ? 'Skip requested' : 'Skip night'}
                        </Button>
                      </div>
                    </>
                  )}
                </div>
              )}

              {role?.role === 'detective' && imAlive && (
                <div className="flex min-h-0 flex-1 flex-col gap-2 overflow-hidden">
                  <div className="shrink-0 text-xs font-semibold uppercase text-muted">Investigate or kill</div>
                  <p className="shrink-0 mb-1 text-sm text-muted">
                    Choose <span className="font-medium text-text">Check</span> to investigate. You learn their role
                    at dawn, not immediately. Or use <span className="font-medium text-rose-300">Kill</span> to try to
                    eliminate them at night (Doctor can still protect). You get{' '}
                    <span className="font-medium text-text">one</span> action per night (check or kill). You can use
                    chat while you decide.
                  </p>
                  {detectiveNightCommitted && (
                    <p className="shrink-0 mb-2 text-sm font-medium text-sky-300">Night action locked in for this night.</p>
                  )}
                  {!playerId ? (
                    <p className="text-sm text-muted">Connecting to the room…</p>
                  ) : (
                    <>
                      <div className={[playerListScrollClass, 'min-h-0 flex-1'].join(' ')}>
                        <div className="space-y-2">
                        {alivePlayers
                          .filter((p) => p.id !== playerId)
                          .map((p) => (
                            <div
                              key={p.id}
                              className="flex flex-col gap-2 rounded-xl border border-border bg-base p-3 sm:flex-row sm:items-center sm:justify-between"
                            >
                              <div className="flex min-w-0 items-center gap-3">
                                <Avatar name={p.displayName} size="sm" />
                                <span className="truncate text-sm font-semibold text-text">{p.displayName}</span>
                              </div>
                              <div className="flex w-full shrink-0 gap-2 sm:w-auto">
                                <Button
                                  type="button"
                                  variant="ghost"
                                  size="sm"
                                  className="min-w-0 flex-1 sm:flex-initial"
                                  disabled={detectiveNightCommitted}
                                  onClick={() => detectiveProbe(p.id)}
                                >
                                  Check
                                </Button>
                                <Button
                                  type="button"
                                  variant="ghost"
                                  size="sm"
                                  className="min-w-0 flex-1 text-rose-300 hover:text-rose-200 sm:flex-initial"
                                  disabled={detectiveNightCommitted}
                                  onClick={() => detectiveKill(p.id)}
                                >
                                  Kill
                                </Button>
                              </div>
                            </div>
                          ))}
                        {status === 'night' && detectiveCheckTargetId && (
                          <div className="rounded-xl border border-sky-400/30 bg-sky-400/10 px-3 py-2 text-sm">
                            <span className="font-semibold text-sky-200">Investigation pending.</span>{' '}
                            Checking{' '}
                            <span className="font-semibold text-text">
                              {nameById.get(detectiveCheckTargetId) ?? 'player'}
                            </span>
                            . You&apos;ll learn their role at dawn.
                          </div>
                        )}
                        </div>
                      </div>
                      <div className="mt-auto shrink-0 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border bg-surface/95 px-3 py-2.5 shadow-[0_-8px_24px_-6px_rgba(0,0,0,0.4)] backdrop-blur-sm">
                        <div className="min-w-0 text-sm text-muted">
                          Skip night:{' '}
                          <span className="font-semibold text-text">{mafia.nightSkipYesCount ?? 0}</span> /{' '}
                          <span className="font-semibold text-text">
                            {mafia.nightActorsRequiredCount ?? '-'}
                          </span>{' '}
                          ready. Everyone with a night role must agree (you can skip if you&apos;re fine ending now).
                        </div>
                        <Button
                          type="button"
                          variant="ghost"
                          className="shrink-0"
                          onClick={requestSkipNight}
                          disabled={nightSkipClicked}
                        >
                          {nightSkipClicked ? 'Skip requested' : 'Skip night'}
                        </Button>
                      </div>
                    </>
                  )}
                </div>
              )}

              {role?.role === 'town' && imAlive && (
                <div className="text-sm text-muted">Wait for morning. Night actions are hidden from town.</div>
              )}
            </div>
          )}

          {status === 'day' && mafia && (
            <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
              <div className="mb-3 shrink-0 flex items-center justify-between gap-3">
                <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-muted">
                  <Sun size={16} className="text-amber-200" aria-hidden />
                  Discussion
                </div>
                <div className="text-sm text-muted">{formatClock(daySec)}</div>
              </div>
              <div className="mb-4 shrink-0 rounded-2xl border border-border bg-base p-4 text-sm text-muted">
                All alive players may speak. Debate, bluff, and look for inconsistencies before the vote.
              </div>

              {role?.role === 'detective' && investigateHint && (
                <div className="mb-4 flex shrink-0 items-start gap-2 rounded-xl border border-sky-400/30 bg-sky-400/10 px-3 py-2 text-sm">
                  <Search size={16} className="mt-0.5 shrink-0 text-sky-300" aria-hidden />
                  <span className="font-semibold">{investigateHint}</span>
                </div>
              )}

              <div
                className={[
                  'mt-auto shrink-0 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border bg-surface px-3 py-2.5',
                ].join(' ')}
              >
                <div className="text-sm text-muted">
                  Skip to vote:{' '}
                  <span className="font-semibold text-text">{mafia.daySkipYesCount ?? 0}</span> /{' '}
                  <span className="font-semibold text-text">{alivePlayers.length}</span> alive; need{' '}
                  <span className="font-semibold text-text">
                    {Math.floor(alivePlayers.length / 2) + 1}
                  </span>{' '}
                  or more (strict majority)
                </div>
                <Button
                  type="button"
                  variant="ghost"
                  onClick={requestSkipToVote}
                  disabled={!imAlive || daySkipClicked}
                >
                  {daySkipClicked ? 'Skip requested' : 'Skip to vote'}
                </Button>
              </div>
            </div>
          )}

          {status === 'voting' && mafia && (
            <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
              <div className="mb-3 shrink-0 flex items-center justify-between gap-3">
                <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-muted">
                  <Vote size={16} className="text-teal-200" aria-hidden />
                  Town vote
                </div>
                <div className="text-sm text-muted">{formatClock(voteSec)}</div>
              </div>
              <div className="mb-4 shrink-0 text-sm text-muted">
                Vote for who you think is Mafia. Votes are secret until the phase ends. You cannot vote for yourself.
              </div>

              {imAlive ? (
                <div className={playerListScrollClass}>
                  <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                    {alivePlayers
                      .filter((p) => p.id !== playerId)
                      .map((p) => {
                        const active = myDayVote === p.id
                        return (
                          <button
                            key={p.id}
                            type="button"
                            onClick={() => castDayVote(p.id)}
                            className={[
                              'flex items-center gap-3 rounded-xl border px-3 py-2.5 text-left transition-all',
                              active ? 'border-teal/60 bg-teal/10' : 'border-border bg-base hover:border-accent/40',
                            ].join(' ')}
                          >
                            <Avatar name={p.displayName} size="sm" />
                            <div className="min-w-0">
                              <div className="truncate text-sm font-semibold text-text">{p.displayName}</div>
                              <div className="text-xs text-muted">{active ? 'Your vote' : 'Tap to vote'}</div>
                            </div>
                          </button>
                        )
                      })}
                  </div>
                </div>
              ) : (
                <div className="shrink-0 text-sm text-muted">You are eliminated and cannot vote.</div>
              )}

              <div className="mt-auto shrink-0 border-t border-border bg-surface/95 px-3 pb-1 pt-3 text-center text-xs text-muted backdrop-blur-sm">
                Votes locked in: {mafia.dayVoteCount ?? 0} / {alivePlayers.length}
              </div>
            </div>
          )}

          {status === 'results' && mafia && mafia.status === 'results' && (
            <div className="flex min-h-0 flex-1 flex-col">
              <div className="mb-3 flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-muted">
                <Trophy size={16} className="text-fuchsia-200" aria-hidden />
                Game over
              </div>
              <div className="mb-4 rounded-2xl border border-border bg-base p-4 text-center">
                <div className="text-sm text-muted">Winner</div>
                <div
                  className={`text-2xl font-extrabold ${mafia.winner === 'town' ? 'text-teal' : 'text-rose-300'}`}
                >
                  {mafia.winner === 'town' ? 'Town' : 'Mafia'}
                </div>
                <div className="mt-2 text-xs text-muted">Next round in {formatClock(resultsSec)}</div>
              </div>

              <div className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted">Roles</div>
              <div className="min-h-0 flex-1 overflow-auto rounded-2xl border border-border bg-base p-3">
                <div className="space-y-2">
                  {Object.keys(mafia.roles ?? {}).length === 0 ? (
                    <div className="py-6 text-center text-sm text-muted">Roles were cleared.</div>
                  ) : (
                    Object.entries(mafia.roles).map(([id, r]) => (
                      <div key={id} className="flex items-center justify-between rounded-xl border border-border bg-surface px-3 py-2">
                        <div className="min-w-0">
                          <div className="truncate text-sm font-semibold text-text">{nameById.get(id) ?? id}</div>
                        </div>
                        <div className="text-sm font-semibold text-muted">{roleLabel(r)}</div>
                      </div>
                    ))
                  )}
                </div>
              </div>

              <div className="mt-4 flex justify-center">
                {isHost ? (
                  <Button type="button" variant="teal" onClick={startMatch} disabled={!minPlayersMet}>
                    Play again
                  </Button>
                ) : (
                  <div className="text-sm text-muted">Waiting for the host…</div>
                )}
              </div>
            </div>
          )}
          </div>
        </div>

        <div
          className={[
            'flex min-h-0 w-full min-w-0 flex-col overflow-hidden rounded-2xl border border-border bg-surface lg:max-h-full lg:w-[380px] lg:shrink-0',
            mobileTab === 'chat' ? 'flex' : 'hidden',
            'lg:flex',
          ].join(' ')}
        >
          <div className="border-b border-border px-4 py-3 text-xs font-semibold uppercase tracking-wider text-muted">
            Chat{' '}
            {chatLockedAtNight
              ? '(closed at night)'
              : status === 'night' && role?.role === 'detective'
                ? '(you can chat while choosing your action)'
                : ''}
          </div>
          <div className="min-h-0 flex-1 overflow-auto px-3 py-3">
            <div className="space-y-2">
              {messages.map((m) => (
                <div
                  key={m.id}
                  className={[
                    'rounded-xl px-3 py-2 text-sm',
                    m.variant === 'system' ? 'bg-base text-muted' : 'bg-base text-text',
                  ].join(' ')}
                >
                  <span className="font-semibold text-accent">{m.author}:</span> {m.text}
                </div>
              ))}
            </div>
          </div>
          <form onSubmit={sendChat} className="border-t border-border p-3">
            <div className="flex gap-2">
              <input
                value={chatInput}
                onChange={(e) => setChatInput(e.target.value)}
                placeholder={chatLockedAtNight ? 'Chat closed at night' : 'Message the room…'}
                disabled={
                  chatLockedAtNight || (playerId != null && aliveSet[playerId] === false)
                }
                className="min-w-0 flex-1 rounded-xl border border-border bg-base px-3 py-2.5 text-sm text-text placeholder:text-muted outline-none focus:border-accent/60 disabled:opacity-50"
              />
              <Button type="submit" variant="teal" disabled={chatLockedAtNight || !chatInput.trim()}>
                Send
              </Button>
            </div>
          </form>
        </div>

        <div
          className={[
            'flex min-h-0 w-full min-w-0 flex-col overflow-hidden rounded-2xl border border-border bg-surface lg:max-h-full lg:w-[280px] lg:shrink-0',
            mobileTab === 'players' ? 'flex' : 'hidden',
            'lg:flex',
          ].join(' ')}
        >
          <div className="shrink-0 border-b border-border px-4 py-3 lg:border-b-0 lg:p-4 lg:pb-0">
            <div className="text-xs font-semibold uppercase tracking-wider text-muted">Players</div>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 pb-4 pt-2 lg:pt-0">
          {!showAliveDeadRoster ? (
            <div className="space-y-2">
              {players.map((p) => (
                <div
                  key={p.id}
                  className="flex items-center gap-3 rounded-xl border border-border bg-base px-3 py-2"
                >
                  <Avatar name={p.displayName} size="sm" />
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-semibold text-text">{p.displayName}</div>
                    <div className="text-xs text-muted">In lobby</div>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="space-y-4">
              <div>
                <div className="mb-2 flex items-center justify-between gap-2">
                  <span className="text-[11px] font-semibold uppercase tracking-wider text-teal-200/90">
                    Alive
                  </span>
                  <span className="rounded-md bg-teal/15 px-2 py-0.5 text-[10px] font-bold text-teal-200">
                    {alivePlayers.length}
                  </span>
                </div>
                <div className="space-y-2">
                  {alivePlayers.map((p) => {
                    const isMe = p.id === playerId
                    return (
                      <div
                        key={p.id}
                        className={[
                          'flex items-center gap-3 rounded-xl border px-3 py-2',
                          isMe
                            ? 'border-teal/35 bg-teal/10 shadow-[inset_0_0_0_1px_rgba(0,212,170,0.12)]'
                            : 'border-border bg-base',
                        ].join(' ')}
                      >
                        <Avatar name={p.displayName} size="sm" />
                        <div className="min-w-0 flex-1">
                          <div className="truncate text-sm font-semibold text-text">{p.displayName}</div>
                          <div className="text-xs text-teal-200/80">{isMe ? 'You · in play' : 'In play'}</div>
                        </div>
                      </div>
                    )
                  })}
                </div>
              </div>

              {deadPlayers.length > 0 && (
                <div>
                  <div className="mb-2 flex items-center gap-2">
                    <Skull size={14} className="text-rose-400/90" aria-hidden />
                    <span className="text-[11px] font-semibold uppercase tracking-wider text-rose-300/90">
                      Eliminated
                    </span>
                    <span className="rounded-md bg-rose-500/15 px-2 py-0.5 text-[10px] font-bold text-rose-200">
                      {deadPlayers.length}
                    </span>
                  </div>
                  <div className="space-y-2">
                    {deadPlayers.map((p) => {
                      const isMe = p.id === playerId
                      return (
                        <div
                          key={p.id}
                          className={[
                            'flex items-center gap-3 rounded-xl border px-3 py-2.5',
                            isMe
                              ? 'border-rose-400/60 bg-rose-950/35'
                              : 'border-rose-500/25 bg-rose-950/20',
                          ].join(' ')}
                        >
                          <Avatar name={p.displayName} size="sm" variant="eliminated" />
                          <div className="min-w-0 flex-1">
                            <div
                              className={[
                                'truncate text-sm font-semibold',
                                isMe ? 'text-rose-100' : 'text-rose-200/90 line-through decoration-rose-400/60',
                              ].join(' ')}
                            >
                              {p.displayName}
                              {isMe ? ' (you)' : ''}
                            </div>
                            <div className="text-xs font-medium text-rose-300/90">Out of the game</div>
                          </div>
                        </div>
                      )
                    })}
                  </div>
                </div>
              )}
            </div>
          )}
          </div>
        </div>
      </div>

      {privateInvestigation && (
        <div
          className="fixed inset-0 z-[210] flex items-center justify-center bg-black/50 p-4 backdrop-blur-sm"
          role="dialog"
          aria-modal="true"
          aria-labelledby="mafia-private-inv-title"
        >
          <button
            type="button"
            className="absolute inset-0 cursor-default"
            aria-label="Close"
            onClick={() => setPrivateInvestigation(null)}
          />
          <div className="glass relative z-10 w-full max-w-sm rounded-2xl border border-sky-400/30 p-6 shadow-card">
            <div className="mb-3 flex items-start justify-between gap-2">
              <h2
                id="mafia-private-inv-title"
                className="flex items-center gap-2 text-base font-extrabold text-text"
              >
                <Search size={20} className="text-sky-300" aria-hidden />
                Investigation
              </h2>
              <button
                type="button"
                onClick={() => setPrivateInvestigation(null)}
                className="rounded-lg p-1.5 text-muted hover:bg-white/5 hover:text-text"
              >
                <X size={18} />
              </button>
            </div>
            <p className="text-sm leading-relaxed text-text">
              <span className="font-semibold">{nameById.get(privateInvestigation.targetId) ?? 'Unknown'}</span>
              {"'"}s role:{' '}
              <span className="inline-flex items-center gap-1.5 font-semibold">
                <RoleRevealIcon role={privateInvestigation.role} />
                {roleLabel(privateInvestigation.role)}
              </span>
            </p>
            <div className="mt-5 flex justify-end">
              <Button type="button" variant="teal" onClick={() => setPrivateInvestigation(null)}>
                OK
              </Button>
            </div>
          </div>
        </div>
      )}

      {announcementOpen && mafia?.lastAnnouncement && mafia.status !== 'lobby' && (
        <div
          className="fixed inset-0 z-200 flex items-center justify-center bg-black/65 p-4 backdrop-blur-sm"
          role="dialog"
          aria-modal="true"
          aria-labelledby="mafia-announcement-title"
        >
          <button
            type="button"
            className="absolute inset-0 cursor-default"
            aria-label="Close"
            onClick={() => setAnnouncementOpen(false)}
          />
          <div className="glass relative z-10 w-full max-w-md rounded-2xl border border-border p-6 shadow-card">
            <div className="mb-4 flex items-start justify-between gap-3">
              <h2
                id="mafia-announcement-title"
                className="flex items-center gap-2 text-lg font-extrabold leading-tight text-text"
              >
                {mafia.lastAnnouncement.kind === 'night' ? (
                  <Moon size={22} className="text-indigo-200" aria-hidden />
                ) : (
                  <Vote size={22} className="text-teal-200" aria-hidden />
                )}
                {mafia.lastAnnouncement.kind === 'night' ? 'Last night' : 'The vote'}
              </h2>
              <button
                type="button"
                onClick={() => setAnnouncementOpen(false)}
                className="rounded-lg p-1.5 text-muted transition-colors hover:bg-white/5 hover:text-text"
              >
                <X size={18} aria-hidden />
              </button>
            </div>

            <div className="space-y-3 text-sm leading-relaxed text-text">
              {mafia.lastAnnouncement.kind === 'night' ? (
                (() => {
                  const ann = mafia.lastAnnouncement
                  const hasKill1 = Boolean(ann.playerId && ann.roleReveal)
                  const hasKill2 = Boolean(ann.secondaryPlayerId && ann.secondaryRoleReveal)
                  const saved = ann.doctorSavedPlayerIds ?? []
                  const hasSaves = saved.length > 0
                  if (!hasKill1 && !hasKill2 && !hasSaves) {
                    return <p className="text-muted">No one was eliminated last night.</p>
                  }
                  return (
                    <ul className="list-none space-y-3">
                      {hasKill1 && ann.playerId && ann.roleReveal ? (
                        <li className="flex gap-2 rounded-xl border border-border/80 bg-base/50 px-3 py-2.5">
                          <Skull size={18} className="mt-0.5 shrink-0 text-rose-300/90" aria-hidden />
                          <span>
                            <span className="font-semibold text-rose-200">
                              {killerTeamLabel(ann.primaryKillBy)}
                            </span>{' '}
                            eliminated{' '}
                            <span className="font-semibold text-text">
                              {nameById.get(ann.playerId) ?? 'Unknown'}
                            </span>
                            <span className="inline-flex items-center gap-1.5 text-muted">
                              {' '}
                              (revealed:{' '}
                              <RoleRevealIcon role={ann.roleReveal} />
                              {roleLabel(ann.roleReveal)})
                            </span>
                            .
                          </span>
                        </li>
                      ) : null}
                      {hasKill2 && ann.secondaryPlayerId && ann.secondaryRoleReveal ? (
                        <li className="flex gap-2 rounded-xl border border-border/80 bg-base/50 px-3 py-2.5">
                          <Search size={18} className="mt-0.5 shrink-0 text-sky-300/90" aria-hidden />
                          <span>
                            <span className="font-semibold text-sky-200">
                              {killerTeamLabel(ann.secondaryKillBy)}
                            </span>{' '}
                            eliminated{' '}
                            <span className="font-semibold text-text">
                              {nameById.get(ann.secondaryPlayerId) ?? 'Unknown'}
                            </span>
                            <span className="inline-flex items-center gap-1.5 text-muted">
                              {' '}
                              (revealed:{' '}
                              <RoleRevealIcon role={ann.secondaryRoleReveal} />
                              {roleLabel(ann.secondaryRoleReveal)})
                            </span>
                            .
                          </span>
                        </li>
                      ) : null}
                      {hasSaves ? (
                        <li className="flex gap-2 rounded-xl border border-teal-500/30 bg-teal-500/10 px-3 py-2.5 text-teal-50">
                          <HeartPulse size={18} className="mt-0.5 shrink-0 text-teal-200" aria-hidden />
                          <span>
                          <span className="font-semibold text-teal-200">The Doctor</span> protected{' '}
                          <span className="font-semibold text-text">{joinPlayerNames(saved, nameById)}</span>
                          . {saved.length === 1 ? 'They were' : 'They were each'} targeted for elimination and survived
                          the night.
                          </span>
                        </li>
                      ) : null}
                    </ul>
                  )
                })()
              ) : mafia.lastAnnouncement.playerId && mafia.lastAnnouncement.roleReveal ? (
                <p className="flex flex-wrap items-center gap-2">
                  <Users size={18} className="shrink-0 text-muted" aria-hidden />
                  <span>
                    The town voted out{' '}
                    <span className="font-semibold text-text">
                      {nameById.get(mafia.lastAnnouncement.playerId) ?? 'Unknown'}
                    </span>
                    <span className="inline-flex items-center gap-1.5 text-muted">
                      {' '}
                      (revealed:{' '}
                      <RoleRevealIcon role={mafia.lastAnnouncement.roleReveal} />
                      {roleLabel(mafia.lastAnnouncement.roleReveal)})
                    </span>
                    .
                  </span>
                </p>
              ) : (
                <p className="text-muted">The vote ended in a tie. No elimination.</p>
              )}
            </div>

            <div className="mt-6 flex justify-end">
              <Button type="button" variant="teal" onClick={() => setAnnouncementOpen(false)}>
                Continue
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
