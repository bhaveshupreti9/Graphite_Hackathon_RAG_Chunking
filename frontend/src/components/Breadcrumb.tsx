import { cn } from '@/lib/cn'

interface BreadcrumbProps {
  path: string[]
  className?: string
  /** Text shown when the path is empty (naive chunks never have one). */
  emptyLabel?: string
}

export function Breadcrumb({ path, className, emptyLabel = 'No heading' }: BreadcrumbProps) {
  if (path.length === 0) {
    return <span className={cn('text-xs italic text-muted', className)}>{emptyLabel}</span>
  }
  return (
    <nav aria-label="Heading path" className={cn('min-w-0', className)}>
      <ol className="flex flex-wrap items-center gap-x-1 text-xs text-muted">
        {path.map((part, index) => (
          <li key={`${part}-${index}`} className="flex items-center gap-1">
            {index > 0 ? (
              <span aria-hidden="true" className="text-border">
                /
              </span>
            ) : null}
            <span className={index === path.length - 1 ? 'text-fg' : undefined}>{part}</span>
          </li>
        ))}
      </ol>
    </nav>
  )
}
