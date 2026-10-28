import { formatPage } from '@/lib/format'
import type { SourceCitation } from '@/types/api'

interface CitationChipProps {
  citation: SourceCitation
  onClick?: () => void
}

export function CitationChip({ citation, onClick }: CitationChipProps) {
  const path = citation.heading_path.length > 0 ? citation.heading_path.join(' / ') : 'No heading'
  const content = (
    <>
      <span aria-hidden="true" className="h-1.5 w-1.5 rounded-full bg-accent" />
      <span className="max-w-[18rem] truncate">{path}</span>
      {citation.page !== null ? (
        <span className="text-muted">{formatPage(citation.page)}</span>
      ) : null}
    </>
  )
  const className =
    'inline-flex items-center gap-1.5 rounded-full border border-border bg-surface-2 px-2.5 py-1 text-xs text-fg'
  return onClick ? (
    <button
      type="button"
      onClick={onClick}
      title={citation.chunk_id}
      className={`${className} transition-colors hover:border-accent`}
    >
      {content}
    </button>
  ) : (
    <span title={citation.chunk_id} className={className}>
      {content}
    </span>
  )
}
