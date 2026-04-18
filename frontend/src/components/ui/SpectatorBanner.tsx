/** Shown when the player joined mid-match and must wait for the next round / lobby. */
export function SpectatorBanner({ className = '' }: { className?: string }) {
  return (
    <div
      role="status"
      className={`rounded-lg border border-amber-400/40 bg-amber-50/95 px-2.5 py-1.5 text-[11px] leading-snug text-amber-950 shadow-sm dark:border-amber-500/30 dark:bg-amber-950/40 dark:text-amber-100 ${className}`}
    >
      <p className="font-medium">Spectating</p>
      <p className="mt-0.5 text-[10px] opacity-90">
        You joined mid-match. Watch only until the host starts the next match.
      </p>
    </div>
  )
}
