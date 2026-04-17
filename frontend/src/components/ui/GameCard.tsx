import { ArrowRight, Clock, Users } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import { GameCover } from '../game/GameCover'
import type { GameDefinition } from '../../games'
import Badge from './Badge'

type GameCardProps = {
  game: GameDefinition
}

export default function GameCard({ game }: GameCardProps) {
  const navigate = useNavigate()

  return (
    <button
      type="button"
      onClick={() => void navigate(`/games/${game.id}`)}
      className="group relative w-full cursor-pointer overflow-hidden rounded-2xl border border-border bg-card p-0 text-left transition-all duration-300 hover:-translate-y-1 hover:border-accent/40 hover:shadow-glow-accent"
    >
      <div
        className="pointer-events-none absolute -right-10 -top-10 h-40 w-40 rounded-full opacity-0 transition-opacity duration-500 group-hover:opacity-100"
        style={{ background: game.glowColor, filter: 'blur(40px)' }}
      />

      <GameCover game={game} variant="card" />

      <div className="relative p-6">
        <div className="mb-1 flex flex-wrap items-center gap-2">
          <h3 className="text-lg font-bold text-text">{game.label}</h3>
          {game.beta && <Badge color="muted">Beta</Badge>}
        </div>
        <p className="mb-4 text-sm leading-relaxed text-muted">{game.tagline}</p>

        <div className="mb-4 flex items-center gap-3">
          <div className="flex items-center gap-1.5 text-xs text-muted">
            <Users size={12} />
            {game.players}
          </div>
          <div className="flex items-center gap-1.5 text-xs text-muted">
            <Clock size={12} />
            {game.duration}
          </div>
        </div>

        <div className="mb-5 flex flex-wrap gap-1.5">
          {game.tags.map((tag) => (
            <Badge key={tag} color="muted">
              {tag}
            </Badge>
          ))}
        </div>

        <div className="flex items-center gap-1.5 text-sm font-semibold text-accent transition-all group-hover:gap-2.5">
          Play now <ArrowRight size={15} />
        </div>
      </div>
    </button>
  )
}
