import { Gamepad2, Search, TrendingUp } from 'lucide-react'
import { useMemo, useState } from 'react'
import GameCard from '../components/ui/GameCard'
import { listGames } from '../games'

export default function GamesHub() {
  const [query, setQuery] = useState('')
  const allGames = useMemo(() => listGames(), [])

  const games = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return allGames
    return allGames.filter((game) => {
      const haystack = [
        game.label,
        game.tagline,
        game.description,
        game.id,
        ...game.tags,
      ]
        .join(' ')
        .toLowerCase()
      return haystack.includes(q)
    })
  }, [allGames, query])

  return (
    <div className="relative min-h-full px-4 py-6 sm:px-8 sm:py-8">
      <div className="glow-orb bg-accent -left-20 top-0 h-96 w-96" />
      <div
        className="glow-orb top-40 right-0 h-80 w-80"
        style={{ background: '#E040FB' }}
      />

      <div className="relative mb-8">
        <label htmlFor="games-search" className="sr-only">
          Search games
        </label>
        <div className="relative max-w-xl">
          <Search
            size={18}
            className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-muted"
            aria-hidden
          />
          <input
            id="games-search"
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search by name, tag, or keyword…"
            autoComplete="off"
            className="w-full rounded-xl border border-border bg-surface py-3 pl-12 pr-4 text-sm text-text outline-none transition-colors placeholder:text-muted focus:border-accent/60"
          />
        </div>
      </div>

      <div className="relative mb-10">
        <div className="mb-3 flex items-center gap-2">
          <TrendingUp size={16} className="text-accent" />
          <span className="text-xs font-semibold uppercase tracking-widest text-accent">
            Games
          </span>
        </div>
        <h1 className="mb-3 text-3xl font-extrabold leading-tight text-text sm:text-4xl">
          Pick a game,
          <br />
          <span className="text-accent">open a room.</span>
        </h1>
        <p className="max-w-md text-base leading-relaxed text-muted">
          Create a room, share the link, and play. No account needed.
        </p>
      </div>

      <div className="relative mb-6">
        <div className="mb-5 flex flex-wrap items-center gap-2">
          <Gamepad2 size={15} className="text-fuchsia" />
          <span className="text-sm font-semibold text-text">All Games</span>
          <span className="text-xs text-muted">
            ({games.length}
            {query.trim() ? ` of ${allGames.length}` : ''} available)
          </span>
        </div>
        {games.length === 0 ? (
          <div className="rounded-2xl border border-border bg-card px-6 py-12 text-center">
            <p className="text-sm font-semibold text-text">No games match</p>
            <p className="mt-1 text-xs text-muted">
              Try another search or clear the bar to see everything.
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
            {games.map((game) => (
              <GameCard key={game.id} game={game} />
            ))}
          </div>
        )}
      </div>

      <div className="relative mt-4">
        <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-border p-8 text-center">
          <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-xl bg-white/5">
            <Gamepad2 size={20} className="text-muted" />
          </div>
          <p className="mb-1 text-sm font-semibold text-text">
            More games coming soon
          </p>
          <p className="text-xs text-muted">
            Trivia, Word Wars, and more are on the way.
          </p>
        </div>
      </div>
    </div>
  )
}
