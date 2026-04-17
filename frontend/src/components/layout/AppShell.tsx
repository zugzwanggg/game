import { Menu } from 'lucide-react'
import { useEffect, useState } from 'react'
import { Link, Outlet, useLocation } from 'react-router-dom'
import Sidebar from './Sidebar'

export default function AppShell() {
  const { pathname } = useLocation()
  const [mobileOpen, setMobileOpen] = useState(false)
  const isGameDetailPage = /^\/games\/[^/]+$/.test(pathname)

  useEffect(() => {
    setMobileOpen(false)
  }, [pathname])

  useEffect(() => {
    if (!mobileOpen) return
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.body.style.overflow = prev
    }
  }, [mobileOpen])

  return (
    <div className="flex h-[100dvh] max-h-[100dvh] overflow-hidden bg-base">
      {mobileOpen && (
        <button
          type="button"
          className="fixed inset-0 z-40 bg-black/55 backdrop-blur-[2px] lg:hidden"
          aria-label="Close menu"
          onClick={() => setMobileOpen(false)}
        />
      )}
      <Sidebar
        mobileOpen={mobileOpen}
        onRequestClose={() => setMobileOpen(false)}
      />
      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        <header className="flex shrink-0 items-center gap-3 border-b border-border bg-surface/95 px-3 py-2.5 pt-[max(0.625rem,env(safe-area-inset-top))] backdrop-blur-sm lg:hidden">
          <button
            type="button"
            className="inline-flex min-h-11 min-w-11 items-center justify-center rounded-xl border border-border bg-card text-text active:bg-card/80"
            aria-label="Open menu"
            aria-expanded={mobileOpen}
            onClick={() => setMobileOpen((o) => !o)}
          >
            <Menu size={22} strokeWidth={2} />
          </button>
          <Link
            to="/games"
            className="min-w-0 truncate text-lg font-extrabold tracking-tight text-text sm:text-xl"
          >
            unplyd
          </Link>
        </header>
        <main
          className={`min-h-0 flex-1 overflow-x-hidden overflow-y-auto overscroll-y-contain pb-[max(0px,env(safe-area-inset-bottom))] ${
            isGameDetailPage ? 'scrollbar-none' : ''
          }`}
        >
          <Outlet />
        </main>
      </div>
    </div>
  )
}
