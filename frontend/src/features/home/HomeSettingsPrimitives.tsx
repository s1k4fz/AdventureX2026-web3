import type { ReactNode } from 'react'

import { cn } from '@/lib/utils'

export function SettingsPageHeader({
  title,
  description,
}: {
  title: string
  description?: string
}) {
  return (
    <header className="mb-5">
      <h2 className="font-display text-[22px] font-semibold tracking-tight text-foreground">
        {title}
      </h2>
      {description ? (
        <p className="mt-1 text-[13px] leading-5 text-muted-foreground">
          {description}
        </p>
      ) : null}
    </header>
  )
}

export function SettingsSection({
  title,
  description,
  children,
  className,
}: {
  title?: string
  description?: string
  children: ReactNode
  className?: string
}) {
  return (
    <section className={cn('space-y-2.5', className)}>
      {title ? (
        <div>
          <h3 className="text-[13px] font-semibold tracking-wide text-foreground">
            {title}
          </h3>
          {description ? (
            <p className="mt-0.5 text-[12px] leading-4 text-muted-foreground">
              {description}
            </p>
          ) : null}
        </div>
      ) : null}
      <div className="overflow-hidden rounded-2xl border border-[var(--units-stroke-color)] bg-background/80">
        {children}
      </div>
    </section>
  )
}

export function SettingsRow({
  label,
  hint,
  children,
  className,
}: {
  label: string
  hint?: string
  children: ReactNode
  className?: string
}) {
  return (
    <div
      className={cn(
        'flex min-h-14 items-center justify-between gap-4 px-3.5 py-3',
        'border-b border-[color-mix(in_srgb,var(--units-black)_10%,transparent)] last:border-b-0',
        className
      )}
    >
      <div className="min-w-0">
        <p className="text-[14px] font-medium leading-5 text-foreground">
          {label}
        </p>
        {hint ? (
          <p className="mt-0.5 text-[12px] leading-4 text-muted-foreground">
            {hint}
          </p>
        ) : null}
      </div>
      <div className="shrink-0">{children}</div>
    </div>
  )
}

export function SettingsMutedValue({
  children,
  className,
}: {
  children: ReactNode
  className?: string
}) {
  return (
    <span
      className={cn(
        'max-w-[220px] truncate text-right text-[13.5px] leading-5 text-muted-foreground',
        className
      )}
    >
      {children}
    </span>
  )
}
