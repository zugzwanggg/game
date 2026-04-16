import type { ReactNode } from 'react'

type GameTheme = 'drawing' | 'meme'

type GameWorldProps = {
  theme: GameTheme
  children: ReactNode
  className?: string
}

export function GameWorld({ theme, children, className = '' }: GameWorldProps) {
  return (
    <div
      data-game-theme={theme}
      className={`game-world flex min-h-0 flex-1 flex-col ${className}`}
    >
      {children}
    </div>
  )
}

