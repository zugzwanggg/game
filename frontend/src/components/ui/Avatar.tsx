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
}

export default function Avatar({ name = '?', size = 'md' }: AvatarProps) {
  const [a, b] = GRADIENTS[name.charCodeAt(0) % GRADIENTS.length]
  const initials = name.slice(0, 2).toUpperCase()

  return (
    <div
      className={`${sizeClass[size]} flex shrink-0 items-center justify-center rounded-full font-bold text-white`}
      style={{ background: `linear-gradient(135deg, ${a}, ${b})` }}
    >
      {initials}
    </div>
  )
}
