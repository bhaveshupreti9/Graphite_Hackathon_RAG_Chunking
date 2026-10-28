import type { ReactNode } from 'react'

interface EmptyStateProps {
  title: string
  description?: ReactNode
  action?: ReactNode
}

export function EmptyState({ title, description, action }: EmptyStateProps) {
  return (
    <div className="panel flex flex-col items-center gap-3 border-dashed px-6 py-14 text-center">
      <span aria-hidden="true" className="flex gap-1">
        <span className="h-6 w-3 rounded-[2px] bg-type-prose/40" />
        <span className="h-6 w-5 rounded-[2px] bg-type-code/40" />
        <span className="h-6 w-2 rounded-[2px] bg-type-table/40" />
        <span className="h-6 w-4 rounded-[2px] bg-type-list/40" />
      </span>
      <h2 className="text-lg font-semibold">{title}</h2>
      {description ? <div className="max-w-md text-sm text-muted">{description}</div> : null}
      {action ? <div className="mt-2 flex flex-wrap justify-center gap-2">{action}</div> : null}
    </div>
  )
}
