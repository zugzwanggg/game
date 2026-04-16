import { Skull } from 'lucide-react'

const GRADIENTS: [string, string][] = [
  ['#7B61FF', '#E040FB'],
  ['#00D4AA', '#7B61FF'],
  ['#FF6B6B', '#E040FB'],
  ['#FFB800', '#FF6B6B'],
]

type Size = 'sm' | 'md' | 'lg'

const sizeClass: Record<Size, string> = {
  sm: 'h-7 w-7 text-xs',
  md: 'h-9 w-9 text-sm',
  lg: 'h-12 w-12 text-base',
}

type AvatarProps = {
  name?: string
  size?: Size
  /** Out of play (e.g. Mafia elimination): muted look + skull badge. */
  variant?: 'default' | 'eliminated'
}

export default function Avatar({ name = '?', size = 'md', variant = 'default' }: AvatarProps) {
  const [a, b] = GRADIENTS[name.charCodeAt(0) % GRADIENTS.length]
  const initials = name.slice(0, 2).toUpperCase()
  const eliminated = variant === 'eliminated'

  return (
    <div className={`relative shrink-0 ${eliminated ? 'opacity-[0.72]' : ''}`}>
      <div
        className={[
          sizeClass[size],
          'flex items-center justify-center rounded-full font-bold text-white',
          eliminated ? 'grayscale contrast-95 ring-2 ring-rose-900/60 ring-offset-2 ring-offset-base' : '',
        ].join(' ')}
        style={{ background: `linear-gradient(135deg, ${a}, ${b})` }}
      >
        {initials}
      </div>
      {eliminated && (
        <span
          className="absolute -bottom-0.5 -right-0.5 flex h-[15px] w-[15px] items-center justify-center rounded-full border border-rose-400/35 bg-rose-950 shadow-sm"
          aria-hidden
        >
          <Skull size={9} className="text-rose-300" strokeWidth={2.5} />
        </span>
      )}
    </div>
  )
}
