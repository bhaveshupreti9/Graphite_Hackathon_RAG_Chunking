import type { ReactNode } from 'react'

interface PageHeaderProps {
  title: string
  description?: ReactNode
  actions?: ReactNode
  meta?: ReactNode
}

export function PageHeader({ title, description, actions, meta }: PageHeaderProps) {
  return (
    <header className="mb-8 flex flex-col gap-4 border-b border-border pb-6 md:flex-row md:items-end md:justify-between">
      <div className="max-w-2xl space-y-2">
        {meta ? <div className="flex flex-wrap items-center gap-2">{meta}</div> : null}
        <h1 className="text-3xl font-semibold md:text-4xl">{title}</h1>
        {description ? <div className="text-muted">{description}</div> : null}
      </div>
      {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
    </header>
  )
}
