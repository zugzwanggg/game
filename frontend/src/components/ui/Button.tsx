import type { ButtonHTMLAttributes, ReactNode } from 'react'

type Variant = 'primary' | 'ghost' | 'teal' | 'danger'
type Size = 'sm' | 'md' | 'lg'

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  children: ReactNode
  variant?: Variant
  size?: Size
  className?: string
}

const variants: Record<Variant, string> = {
  primary:
    'bg-accent text-white shadow-glow-accent hover:bg-accent/90',
  ghost:
    'border border-border bg-transparent text-muted hover:bg-card hover:text-text',
  teal: 'bg-teal text-white shadow-glow-teal hover:bg-teal/90',
  danger:
    'border border-red-500/30 bg-red-500/20 text-red-400 hover:bg-red-500/30',
}

const sizes: Record<Size, string> = {
  sm: 'px-3 py-1.5 text-sm',
  md: 'px-5 py-2.5 text-sm',
  lg: 'px-7 py-3.5 text-base',
}

export default function Button({
  children,
  variant = 'primary',
  size = 'md',
  className = '',
  type = 'button',
  ...props
}: ButtonProps) {
  const base =
    'inline-flex cursor-pointer select-none items-center gap-2 rounded-xl font-semibold transition-all duration-150 active:scale-95'

  return (
    <button
      type={type}
      className={`${base} ${variants[variant]} ${sizes[size]} ${className}`}
      {...props}
    >
      {children}
    </button>
  )
}
