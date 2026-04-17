import { useSyncExternalStore } from 'react'

const LG_QUERY = '(min-width: 1024px)'

function getLgMatches() {
  return typeof window !== 'undefined' && window.matchMedia(LG_QUERY).matches
}

function subscribeLg(cb: () => void) {
  const mq = window.matchMedia(LG_QUERY)
  mq.addEventListener('change', cb)
  return () => mq.removeEventListener('change', cb)
}

/** Tailwind `lg` breakpoint — desktop layout vs mobile (e.g. chat dock). */
export function useMediaQueryLg(): boolean {
  return useSyncExternalStore(subscribeLg, getLgMatches, () => true)
}
