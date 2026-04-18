import { Search } from 'lucide-react'
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
            placeholder="Search games"
            autoComplete="off"
            className="w-full rounded-xl border border-border bg-surface py-3 pl-12 pr-4 text-sm text-text outline-none transition-colors placeholder:text-muted focus:border-accent/60"
          />
        </div>
      </div>

      <div className="relative mb-10">
        <p className="mb-2 text-xs font-semibold uppercase tracking-widest text-muted">Games</p>
        <h1 className="mb-3 text-3xl font-extrabold leading-tight text-text sm:text-4xl">
          Pick a game and open a room.
        </h1>
        <p className="max-w-md text-base leading-relaxed text-muted">
          Create a room or join one. Guests can play without an account.
        </p>
      </div>

      <div className="relative mb-6">
        <div className="mb-5 flex flex-wrap items-center gap-2">
          <span className="text-sm font-semibold text-text">All games</span>
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
        <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-border p-6 text-center">
          <p className="text-sm font-medium text-muted">More games later.</p>
        </div>
      </div>
    </div>
  )
}
