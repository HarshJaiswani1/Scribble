import type { ButtonHTMLAttributes, ReactNode } from 'react'

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger'

const VARIANTS: Record<Variant, string> = {
  primary:
    'bg-brand-500 text-white hover:bg-brand-400 active:bg-brand-600 shadow-lg shadow-brand-600/25',
  secondary:
    'bg-ink-700 text-slate-100 hover:bg-ink-600 border border-white/5',
  ghost: 'text-ink-400 hover:text-slate-200 hover:bg-white/5',
  danger: 'bg-rose-500/15 text-rose-300 hover:bg-rose-500/25',
}

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant
}

export function Button({
  variant = 'primary',
  className = '',
  ...props
}: ButtonProps) {
  return (
    <button
      {...props}
      className={`inline-flex items-center justify-center gap-2 rounded-xl px-4 py-2.5 text-sm font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-40 ${VARIANTS[variant]} ${className}`}
    />
  )
}

export function Panel({
  children,
  className = '',
}: {
  children: ReactNode
  className?: string
}) {
  return (
    <div
      className={`rounded-2xl border border-white/8 bg-ink-900/80 backdrop-blur-sm ${className}`}
    >
      {children}
    </div>
  )
}

export function Label({ children }: { children: ReactNode }) {
  return (
    <span className="text-xs font-semibold uppercase tracking-wider text-ink-400">
      {children}
    </span>
  )
}

const INPUT_CLASS =
  'w-full rounded-xl border border-white/10 bg-ink-850 px-4 py-3 text-slate-100 outline-none transition-colors placeholder:text-ink-400/60 focus:border-brand-500 focus:ring-2 focus:ring-brand-500/25 disabled:opacity-50'

export { INPUT_CLASS }

export function ErrorText({ children }: { children: ReactNode }) {
  if (!children) return null
  return (
    <p role="alert" className="text-sm text-rose-300">
      {children}
    </p>
  )
}
