import type { GameDefinition } from '../../games'

type GameCoverProps = {
  game: GameDefinition
  /** `card` = 16:9 for hub tiles; `detail` = wider hero on game page */
  variant: 'card' | 'detail'
  className?: string
}

function Placeholder({ game, variant }: { game: GameDefinition; variant: 'card' | 'detail' }) {
  const detail = variant === 'detail'
  return (
    <div
      className="absolute inset-0 flex flex-col items-center justify-center gap-2"
      style={{
        backgroundColor: `${game.accentColor}22`,
      }}
    >
      <span
        className={`rounded-md border border-border/80 bg-base/40 px-2 py-1 font-bold uppercase tracking-[0.2em] text-muted ${
          detail ? 'text-xs' : 'text-[10px]'
        }`}
      >
        Cover
      </span>
      <span
        className={`max-w-[90%] truncate text-center font-semibold text-text/90 ${
          detail ? 'text-base sm:text-lg' : 'text-xs'
        }`}
      >
        {game.label}
      </span>
    </div>
  )
}

export function GameCover({ game, variant, className = '' }: GameCoverProps) {
  const aspect =
    variant === 'detail'
      ? 'aspect-[2/1] max-h-56 sm:max-h-64 md:max-h-72'
      : 'aspect-video'

  return (
    <div
      className={`relative w-full overflow-hidden bg-surface ${aspect} ${className}`}
    >
      {game.coverImage ? (
        <img
          src={game.coverImage}
          alt=""
          className="h-full w-full object-cover"
          loading="lazy"
        />
      ) : (
        <Placeholder game={game} variant={variant} />
      )}
    </div>
  )
}
