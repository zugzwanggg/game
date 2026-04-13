import type { ReactNode } from 'react'

type Color = 'accent' | 'teal' | 'fuchsia' | 'muted'

const colors: Record<Color, string> = {
  accent: 'border-accent/30 bg-accent/15 text-accent',
  teal: 'border-teal/30 bg-teal/15 text-teal',
  fuchsia: 'border-fuchsia/30 bg-fuchsia/15 text-fuchsia',
  muted: 'border-border bg-white/5 text-muted',
}

type BadgeProps = {
  children: ReactNode
  color?: Color
}

export default function Badge({ children, color = 'accent' }: BadgeProps) {
  return (
    <span
      className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-medium ${colors[color]}`}
    >
      {children}
    </span>
  )
}
