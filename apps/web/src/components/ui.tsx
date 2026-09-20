import type { ReactNode } from 'react'

export function Card({ children, className = '' }: { children: ReactNode; className?: string }) {
  return <div className={`card ${className}`}>{children}</div>
}

export function Spinner({ label }: { label?: string }) {
  return (
    <div className="flex items-center justify-center gap-3 py-10" style={{ color: 'var(--muted)' }}>
      <span
        className="inline-block h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent"
        aria-hidden
      />
      <span className="text-sm">{label ?? 'Đang tải…'}</span>
    </div>
  )
}

export function EmptyState({ icon, title, hint }: { icon?: string; title: string; hint?: string }) {
  return (
    <div className="flex flex-col items-center gap-2 px-6 py-12 text-center">
      {icon && <div className="text-3xl opacity-60">{icon}</div>}
      <p className="font-semibold">{title}</p>
      {hint && <p className="max-w-xs text-sm" style={{ color: 'var(--muted)' }}>{hint}</p>}
    </div>
  )
}

export function ErrorNote({ message }: { message: string }) {
  return (
    <div
      className="rounded-xl px-3 py-2 text-sm"
      style={{ background: 'color-mix(in srgb, var(--danger) 12%, transparent)', color: 'var(--danger)' }}
      role="alert"
    >
      {message}
    </div>
  )
}

export function Avatar({ name, color, size = 32 }: { name: string; color: string; size?: number }) {
  const initial = name.trim().split(/\s+/).at(-1)?.[0]?.toUpperCase() ?? '?'
  return (
    <span
      className="inline-flex shrink-0 items-center justify-center rounded-full font-semibold text-white"
      style={{ width: size, height: size, background: color, fontSize: size * 0.42 }}
      title={name}
    >
      {initial}
    </span>
  )
}

export function StatTile({ label, value, unit, tone }: { label: string; value: string | number; unit?: string; tone?: 'ok' | 'warn' | 'brand' }) {
  const color = tone === 'ok' ? 'var(--ok)' : tone === 'warn' ? 'var(--warn)' : 'var(--brand)'
  return (
    <div className="card px-4 py-3">
      <p className="text-xs font-medium" style={{ color: 'var(--muted)' }}>{label}</p>
      <p className="mt-1 text-2xl font-bold tabular-nums" style={{ color }}>
        {value}
        {unit && <span className="ml-1 text-sm font-medium" style={{ color: 'var(--muted)' }}>{unit}</span>}
      </p>
    </div>
  )
}
