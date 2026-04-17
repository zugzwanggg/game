import {
  ChevronRight,
  Gamepad2,
  Settings,
  Trophy,
  User,
  X,
} from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useAuth } from '../../context/AuthProvider'
import { useVoiceMode } from '../../context/useVoiceMode'
import { apiFetch } from '../../lib/api'
import { readStoredSfxEnabled, setSfxEnabled } from '../../lib/sfxPrefs'
import { getRecentRooms, removeRecentRoom, type RecentRoom } from '../../lib/recentRooms'
import Avatar from '../ui/Avatar'
import Badge from '../ui/Badge'

const NAV = [
  { id: 'games' as const, icon: Gamepad2, label: 'Games' },
  { id: 'profile' as const, icon: User, label: 'Profile' },
  { id: 'settings' as const, icon: Settings, label: 'Settings' },
]

type TabId = (typeof NAV)[number]['id']

type SidebarProps = {
  /** When false on small screens, drawer is hidden. Ignored at `lg+` (sidebar always visible). */
  mobileOpen?: boolean
  onRequestClose?: () => void
}

export default function Sidebar({ mobileOpen = true, onRequestClose }: SidebarProps) {
  const navigate = useNavigate()
  const [tab, setTab] = useState<TabId>('games')
  const { principal, logout } = useAuth()
  const { voiceMode, setVoiceMode } = useVoiceMode()
  const [stats, setStats] = useState<{ gamesPlayed: number; wins: number; bestScore: number } | null>(null)
  const [recentRooms, setRecentRooms] = useState<RecentRoom[]>([])
  const [sfxOn, setSfxOn] = useState(() => readStoredSfxEnabled())

  // Lightweight stats fetch for signed-in users.
  // (Guests/anonymous keep demo stats and don't hit the DB.)
  useEffect(() => {
    if (principal?.kind !== 'user') return
    void (async () => {
      try {
        const res = await apiFetch<{ stats: any[] }>('/stats/me')
        const drawing = (res.stats ?? []).find((s: any) => s.game === 'drawing') ?? null
        if (!drawing) {
          setStats({ gamesPlayed: 0, wins: 0, bestScore: 0 })
          return
        }
        setStats({
          gamesPlayed: Number(drawing.gamesPlayed ?? 0),
          wins: Number(drawing.wins ?? 0),
          bestScore: Number(drawing.bestScore ?? 0),
        })
      } catch {
        // ignore
      }
    })()
  }, [principal])

  useEffect(() => {
    const sync = () => setRecentRooms(getRecentRooms())
    sync()
    window.addEventListener('storage', sync)
    return () => window.removeEventListener('storage', sync)
  }, [])

  const recentItems = useMemo(() => {
    return recentRooms.map((r) => ({
      ...r,
      label: r.game === 'drawing' ? 'Guess the Drawing' : r.game,
    }))
  }, [recentRooms])

  const name =
    principal?.kind === 'user'
      ? principal.displayName
      : principal?.kind === 'guest'
        ? principal.displayName
        : 'Not signed in'
  const badge =
    principal?.kind === 'user'
      ? 'Account'
      : principal?.kind === 'guest'
        ? 'Guest'
        : 'Anonymous'

  return (
    <aside
      className={`fixed inset-y-0 left-0 z-50 flex h-full w-[min(18rem,88vw)] shrink-0 flex-col border-r border-border bg-surface pt-[env(safe-area-inset-top,0px)] shadow-xl transition-transform duration-200 ease-out lg:static lg:z-auto lg:w-64 lg:max-w-none lg:translate-x-0 lg:pt-0 lg:shadow-none ${
        mobileOpen ? 'translate-x-0' : '-translate-x-full lg:translate-x-0'
      }`}
    >
      <div className="flex items-center justify-between gap-2 border-b border-border px-4 py-4 sm:px-5 sm:py-5">
        <span className="text-lg font-extrabold tracking-tight text-white sm:text-xl">
          unplyd
        </span>
        <button
          type="button"
          className="inline-flex min-h-10 min-w-10 items-center justify-center rounded-xl border border-border bg-card text-muted transition-colors hover:bg-white/5 hover:text-text lg:hidden"
          aria-label="Close menu"
          onClick={() => onRequestClose?.()}
        >
          <X size={20} strokeWidth={2} />
        </button>
      </div>

      <nav className="border-b border-border px-3 py-4">
        {NAV.map(({ id, icon: Icon, label }) => (
          <button
            key={id}
            type="button"
            onClick={() => setTab(id)}
            className={`mb-1 flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition-all duration-150 ${
              tab === id
                ? 'bg-accent/15 text-accent'
                : 'text-muted hover:bg-card hover:text-text'
            }`}
          >
            <Icon size={17} />
            {label}
            {tab === id && (
              <ChevronRight size={14} className="ml-auto opacity-60" />
            )}
          </button>
        ))}
      </nav>

      <div className="flex-1 overflow-y-auto px-3 py-4">
        {tab === 'games' && (
          <div>
            <p className="mb-3 px-3 text-xs font-semibold uppercase tracking-wider text-muted">
              Recent Rooms
            </p>
            {recentItems.length ? (
              recentItems.map((item) => (
                <div
                  key={item.code}
                  className="mb-1 flex items-center gap-3 rounded-xl px-3 py-2.5 transition-colors hover:bg-card"
                >
                  <div className="h-2 w-2 shrink-0 rounded-full bg-teal" />
                  <button
                    type="button"
                    className="min-w-0 flex-1 text-left"
                    onClick={() => {
                      void navigate(`/room/${item.code}?game=${encodeURIComponent(item.game)}`)
                    }}
                  >
                    <p className="truncate text-xs font-medium text-text">
                      {item.label}{' '}
                      <span className="font-mono text-[10px] font-bold tracking-widest text-muted">
                        {item.code}
                      </span>
                    </p>
                    <p className="text-xs text-muted">
                      {item.role === 'host' ? 'Host' : 'Joined'} ·{' '}
                      {new Date(item.joinedAt).toLocaleString()}
                    </p>
                  </button>
                  <button
                    type="button"
                    className="rounded-lg p-1.5 text-muted transition-colors hover:bg-white/5 hover:text-text"
                    title="Remove from recents"
                    onClick={() => {
                      removeRecentRoom(item.code)
                      setRecentRooms(getRecentRooms())
                    }}
                  >
                    <Trophy size={12} className="opacity-60" />
                  </button>
                </div>
              ))
            ) : (
              <p className="px-3 text-xs text-muted">
                No recent rooms yet. Create a room or join via an invite link.
              </p>
            )}
          </div>
        )}

        {tab === 'profile' && (
          <div className="space-y-4">
            <div className="rounded-xl bg-card p-4 text-center">
              <div className="flex justify-center">
                <Avatar name={name} size="lg" />
              </div>
              <p className="mt-3 text-sm font-bold text-text">
                {name}
              </p>
              <div className="mt-1 flex justify-center">
                <Badge color="muted">{badge}</Badge>
              </div>
              <p className="mt-2 text-xs text-muted">
                {principal?.kind === 'user'
                  ? 'Signed in.'
                  : 'Sign up to save stats and history'}
              </p>
            </div>

            <div className="space-y-3 rounded-xl bg-card p-4">
              {[
                { label: 'Games played', value: principal?.kind === 'user' ? String(stats?.gamesPlayed ?? '-') : '12' },
                { label: 'Total wins', value: principal?.kind === 'user' ? String(stats?.wins ?? '-') : '7' },
                { label: 'Best score', value: principal?.kind === 'user' ? String(stats?.bestScore ?? '-') : '1,240' },
              ].map((stat) => (
                <div
                  key={stat.label}
                  className="flex items-center justify-between"
                >
                  <span className="text-xs text-muted">{stat.label}</span>
                  <span className="text-sm font-bold text-text">
                    {stat.value}
                  </span>
                </div>
              ))}
            </div>

            {principal?.kind !== 'user' ? (
              <Link
                to="/signup"
                className="block w-full rounded-xl bg-accent py-2.5 text-center text-sm font-semibold text-white transition-colors hover:bg-accent/90"
              >
                Create Account
              </Link>
            ) : (
              <Link
                to="/games"
                className="block w-full rounded-xl bg-surface py-2.5 text-center text-sm font-semibold text-text transition-colors hover:bg-card"
              >
                You&apos;re all set
              </Link>
            )}
          </div>
        )}

        {tab === 'settings' && (
          <div className="space-y-2">
            <p className="mb-3 px-3 text-xs font-semibold uppercase tracking-wider text-muted">
              Preferences
            </p>
            <div className="flex items-center justify-between rounded-xl bg-card px-4 py-3">
              <div>
                <p className="text-sm font-medium text-text">Room voice</p>
                <p className="text-xs text-muted">Auto-join voice in rooms (mic starts muted)</p>
              </div>
              <button
                type="button"
                role="switch"
                aria-checked={voiceMode}
                aria-label="Toggle room voice"
                onClick={() => setVoiceMode(!voiceMode)}
                className={`relative h-5 w-10 shrink-0 rounded-full transition-colors ${
                  voiceMode ? 'bg-teal/50' : 'bg-border/80'
                }`}
              >
                <span
                  className={`absolute top-0.5 h-4 w-4 rounded-full bg-white shadow transition-all ${
                    voiceMode ? 'right-0.5' : 'left-0.5'
                  }`}
                />
              </button>
            </div>
            <div className="flex items-center justify-between rounded-xl bg-card px-4 py-3">
              <div>
                <p className="text-sm font-medium text-text">Notifications</p>
                <p className="text-xs text-muted">Room invites & updates</p>
              </div>
              <div className="relative h-5 w-10 rounded-full bg-border/80 opacity-60">
                <div className="absolute left-0.5 top-0.5 h-4 w-4 rounded-full bg-muted" />
              </div>
            </div>
            <div className="flex items-center justify-between rounded-xl bg-card px-4 py-3">
              <div>
                <p className="text-sm font-medium text-text">Sound effects</p>
                <p className="text-xs text-muted">Short cues in rooms & games</p>
              </div>
              <button
                type="button"
                role="switch"
                aria-checked={sfxOn}
                aria-label="Toggle sound effects"
                onClick={() => {
                  const next = !sfxOn
                  setSfxOn(next)
                  setSfxEnabled(next)
                }}
                className={`relative h-5 w-10 shrink-0 rounded-full transition-colors ${
                  sfxOn ? 'bg-teal/50' : 'bg-border/80'
                }`}
              >
                <span
                  className={`absolute top-0.5 h-4 w-4 rounded-full bg-white shadow transition-all ${
                    sfxOn ? 'right-0.5' : 'left-0.5'
                  }`}
                />
              </button>
            </div>
            <div className="flex items-center justify-between rounded-xl bg-card px-4 py-3">
              <div>
                <p className="text-sm font-medium text-text">Animations</p>
                <p className="text-xs text-muted">Reduce motion effects</p>
              </div>
              <div className="relative h-5 w-10 rounded-full bg-border/80 opacity-60">
                <div className="absolute left-0.5 top-0.5 h-4 w-4 rounded-full bg-muted" />
              </div>
            </div>
            <div className="pt-4">
              <p className="mb-3 px-3 text-xs font-semibold uppercase tracking-wider text-muted">
                Account
              </p>
              <div className="flex flex-col gap-1 rounded-xl px-2 py-1">
                {principal?.kind === 'user' ? (
                  <button
                    type="button"
                    className="rounded-lg bg-card px-3 py-2.5 text-center text-sm font-semibold text-text transition-colors hover:bg-surface"
                    onClick={() => {
                      logout()
                      void navigate('/games')
                    }}
                  >
                    Log out
                  </button>
                ) : (
                  <>
                    <Link
                      to="/login"
                      className="rounded-lg px-3 py-2.5 text-center text-sm font-medium text-muted transition-colors hover:bg-card hover:text-text"
                    >
                      Sign in
                    </Link>
                    <Link
                      to="/signup"
                      className="rounded-lg px-3 py-2.5 text-center text-sm font-medium text-muted transition-colors hover:bg-card hover:text-text"
                    >
                      Create account
                    </Link>
                    {principal?.kind === 'guest' && (
                      <button
                        type="button"
                        className="rounded-lg px-3 py-2.5 text-center text-sm font-medium text-muted transition-colors hover:bg-card hover:text-text"
                        onClick={() => {
                          logout()
                          void navigate('/games')
                        }}
                      >
                        Clear guest session
                      </button>
                    )}
                  </>
                )}
              </div>
            </div>
          </div>
        )}
      </div>

      <div className="border-t border-border px-4 py-4">
        <div className="flex items-center gap-3">
          <Avatar name={name} size="sm" />
          <div className="min-w-0 flex-1">
            <p className="truncate text-xs font-semibold text-text">
              {name}
            </p>
            <p className="text-xs text-muted">
              {principal?.kind === 'user'
                ? 'Online'
                : principal?.kind === 'guest'
                  ? 'Guest'
                  : 'Choose guest or sign in'}
            </p>
          </div>
          <div className="h-2 w-2 rounded-full bg-teal" title="Online" />
        </div>
      </div>
    </aside>
  )
}
