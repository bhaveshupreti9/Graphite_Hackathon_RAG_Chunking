import { motion } from 'framer-motion'
import { useCallback, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { deleteDocument, getDocuments, getProcessResult } from '@/api/client'
import { toApiError } from '@/api/errors'
import type { ApiError } from '@/api/errors'
import { ConfirmDialog } from '@/components/ConfirmDialog'
import { EmptyState } from '@/components/EmptyState'
import { ErrorState } from '@/components/ErrorState'
import { LoadingState } from '@/components/LoadingState'
import { PageHeader } from '@/components/PageHeader'
import { TiltCard } from '@/components/TiltCard'
import { useAsync } from '@/hooks/useAsync'
import { cn } from '@/lib/cn'
import { ROUTES } from '@/lib/constants'
import { formatDate } from '@/lib/format'
import { useAppStore } from '@/store/useAppStore'
import type { DocumentInfo } from '@/types/api'

const STATUS: Record<DocumentInfo['status'], { label: string; className: string }> = {
  ready: { label: 'Ready', className: 'border-good/50 text-good' },
  processing: { label: 'Processing', className: 'border-accent/60 text-fg' },
  uploaded: { label: 'Not processed', className: 'border-border text-muted' },
  error: { label: 'Failed', className: 'border-bad/50 text-bad' },
}

export default function KnowledgePage() {
  const navigate = useNavigate()
  const currentId = useAppStore((state) => state.doc_id)
  const selectDocument = useAppStore((state) => state.selectDocument)
  const clearDocument = useAppStore((state) => state.clearDocument)
  const demoMode = useAppStore((state) => state.demoMode)

  const loader = useCallback(() => getDocuments(), [demoMode]) // eslint-disable-line react-hooks/exhaustive-deps
  const documents = useAsync(loader)

  const [opening, setOpening] = useState<string | null>(null)
  const [actionError, setActionError] = useState<ApiError | null>(null)
  const [toDelete, setToDelete] = useState<DocumentInfo | null>(null)
  const [deleting, setDeleting] = useState(false)

  const open = async (doc: DocumentInfo) => {
    setActionError(null)
    if (doc.status !== 'ready') {
      selectDocument(doc.doc_id, doc.filename, null)
      navigate(ROUTES.upload)
      return
    }
    setOpening(doc.doc_id)
    try {
      const result = await getProcessResult(doc.doc_id)
      selectDocument(doc.doc_id, doc.filename, result)
      navigate(ROUTES.explorer)
    } catch (error) {
      setActionError(toApiError(error))
    } finally {
      setOpening(null)
    }
  }

  const confirmDelete = async () => {
    if (!toDelete) return
    setDeleting(true)
    setActionError(null)
    try {
      await deleteDocument(toDelete.doc_id)
      if (toDelete.doc_id === currentId) clearDocument()
      setToDelete(null)
      documents.reload()
    } catch (error) {
      setActionError(toApiError(error))
      setToDelete(null)
    } finally {
      setDeleting(false)
    }
  }

  return (
    <div className="space-y-8">
      <PageHeader
        title="Knowledge base"
        description="Your saved documents. Open one to explore its chunks and chat with it again."
        actions={
          <>
            <button
              type="button"
              className="btn"
              onClick={documents.reload}
              disabled={documents.status === 'loading'}
            >
              Refresh
            </button>
            <Link to={ROUTES.upload} className="btn btn-primary">
              Upload a document
            </Link>
          </>
        }
      />

      {actionError ? <ErrorState compact error={actionError} title="That action failed" /> : null}

      {documents.status === 'loading' && !documents.data ? (
        <LoadingState label="Loading documents…" />
      ) : null}
      {documents.status === 'error' ? (
        <ErrorState
          error={documents.error}
          onRetry={documents.reload}
          title="Documents didn’t load"
        />
      ) : null}

      {documents.data && documents.status !== 'error' ? (
        documents.data.length === 0 ? (
          <EmptyState
            title="No documents yet"
            description="Upload a PDF, Markdown, text, CSV or Excel file, or start from a sample."
            action={
              <Link to={ROUTES.upload} className="btn btn-primary">
                Upload a document
              </Link>
            }
          />
        ) : (
          <ul className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {documents.data.map((doc, index) => {
              const status = STATUS[doc.status]
              const current = doc.doc_id === currentId
              return (
                <motion.li
                  key={doc.doc_id}
                  initial={{ opacity: 0, y: 12 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: Math.min(index, 8) * 0.04 }}
                >
                  <TiltCard className="h-full">
                    <article
                      className={cn(
                        'panel flex h-full flex-col gap-4 p-5',
                        current && 'border-accent/70 shadow-[0_0_0_1px_rgb(var(--c-accent)/0.4)]',
                      )}
                    >
                      <header className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <h2 className="truncate text-lg font-semibold" title={doc.filename}>
                            {doc.filename}
                          </h2>
                          <p className="font-mono text-xs text-muted">{doc.doc_id}</p>
                        </div>
                        <span
                          className={cn(
                            'shrink-0 rounded-full border px-2.5 py-0.5 text-xs',
                            status.className,
                          )}
                        >
                          {status.label}
                        </span>
                      </header>

                      <p className="line-clamp-3 min-h-[3.75rem] text-sm text-fg/75">
                        {doc.summary_preview.trim() !== '' ? (
                          doc.summary_preview
                        ) : (
                          <span className="text-muted">No summary available.</span>
                        )}
                      </p>

                      <dl className="grid grid-cols-3 gap-2 text-sm">
                        <div>
                          <dt className="text-xs text-muted">Pages</dt>
                          <dd className="tabular-nums">{doc.pages}</dd>
                        </div>
                        <div>
                          <dt className="text-xs text-muted">SmartChunk</dt>
                          <dd className="tabular-nums">{doc.smart_chunk_count ?? 'n/a'}</dd>
                        </div>
                        <div>
                          <dt className="text-xs text-muted">Traditional</dt>
                          <dd className="tabular-nums">{doc.naive_chunk_count ?? 'n/a'}</dd>
                        </div>
                      </dl>

                      <footer className="mt-auto flex items-center justify-between gap-2 border-t border-border pt-4">
                        <span className="text-xs text-muted">{formatDate(doc.created_at)}</span>
                        <div className="flex gap-2">
                          <button
                            type="button"
                            className="btn btn-danger px-3 py-1.5"
                            onClick={() => setToDelete(doc)}
                            aria-label={`Delete ${doc.filename}`}
                          >
                            Delete
                          </button>
                          <button
                            type="button"
                            className={cn('btn px-3 py-1.5', !current && 'btn-primary')}
                            disabled={opening !== null || doc.status === 'processing'}
                            onClick={() => void open(doc)}
                          >
                            {opening === doc.doc_id
                              ? 'Opening…'
                              : current
                                ? 'Open again'
                                : doc.status === 'ready'
                                  ? 'Open'
                                  : 'Process'}
                          </button>
                        </div>
                      </footer>
                    </article>
                  </TiltCard>
                </motion.li>
              )
            })}
          </ul>
        )
      ) : null}

      <ConfirmDialog
        open={toDelete !== null}
        title={`Delete ${toDelete?.filename ?? 'this document'}?`}
        description="This removes the file, both chunk collections and the summary from the server. It can’t be undone."
        confirmLabel="Delete document"
        busy={deleting}
        onConfirm={() => void confirmDelete()}
        onCancel={() => setToDelete(null)}
      />
    </div>
  )
}
