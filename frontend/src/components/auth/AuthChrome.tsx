import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'

type AuthChromeProps = {
  children: ReactNode
}

export function AuthChrome({ children }: AuthChromeProps) {
  return (
    <div className="relative flex min-h-[100dvh] items-center justify-center overflow-hidden bg-base px-4 py-10 pt-[max(2.5rem,env(safe-area-inset-top))] pb-[max(2.5rem,env(safe-area-inset-bottom))]">
      <div
        className="glow-orb -left-20 -top-20 h-96 w-96"
        style={{ background: 'rgba(123,97,255,0.4)' }}
      />
      <div
        className="glow-orb bottom-0 right-0 h-80 w-80"
        style={{ background: 'rgba(224,64,251,0.3)' }}
      />

      <div className="relative w-full max-w-sm">
        <Link
          to="/games"
          className="mb-8 block text-center text-2xl font-extrabold tracking-tight text-text transition-colors hover:text-accent sm:text-3xl"
        >
          unplyd
        </Link>
        {children}
      </div>
    </div>
  )
}
