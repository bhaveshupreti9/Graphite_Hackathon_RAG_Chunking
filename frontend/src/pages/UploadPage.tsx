import { AnimatePresence, motion } from 'framer-motion'
import { useCallback, useEffect, useRef, useState } from 'react'
import { useDropzone } from 'react-dropzone'
import type { FileRejection } from 'react-dropzone'
import { Link, useLocation } from 'react-router-dom'
import {
  getProcessResult,
  getSamples,
  getStatus,
  startProcess,
  uploadFile,
  uploadSample,
} from '@/api/client'
import { ApiError, toApiError } from '@/api/errors'
import { EmptyState } from '@/components/EmptyState'
import { ErrorState } from '@/components/ErrorState'
import { Expander } from '@/components/Expander'
import { LoadingState } from '@/components/LoadingState'
import { MethodStatsPanel } from '@/components/MethodStatsPanel'
import { PageHeader } from '@/components/PageHeader'
import { ProcessPipeline } from '@/components/ProcessPipeline'
import { RemovedList } from '@/components/RemovedList'
import { ResultVerdict } from '@/components/ResultVerdict'
import { SettingsForm } from '@/components/SettingsForm'
import { useAsync } from '@/hooks/useAsync'
import { cn } from '@/lib/cn'
import { ROUTES } from '@/lib/constants'
import { MAX_UPLOAD_BYTES, MAX_UPLOAD_MB, SUPPORTED_FILES_TEXT } from '@/lib/files'
import { formatBytes } from '@/lib/format'
import { pollProcessing } from '@/lib/pollProcess'
import { readRedirectMessage } from '@/lib/redirect'
import { validateSettings } from '@/lib/settings'
import { useAppStore } from '@/store/useAppStore'
import type { ProcessingStatus, UploadResponse } from '@/types/api'

type ProcessPhase = 'idle' | 'starting' | 'running' | 'fetching' | 'done' | 'error'

const ACCEPT = {
  'application/pdf': ['.pdf'],
  'text/markdown': ['.md', '.markdown'],
  'text/plain': ['.txt'],
  'text/csv': ['.csv'],
  'text/tab-separated-values': ['.tsv'],
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': ['.xlsx'],
  'application/vnd.ms-excel.sheet.macroEnabled.12': ['.xlsm'],
}

function rejectionError(rejections: FileRejection[]): ApiError {
  const code = rejections[0]?.errors[0]?.code
  if (code === 'file-too-large') return new ApiError('FILE_TOO_LARGE', `Over ${MAX_UPLOAD_MB} MB.`)
  if (code === 'too-many-files')
    return new ApiError('VALIDATION_ERROR', 'Upload one file at a time.')
  return new ApiError('INVALID_FILE_TYPE', SUPPORTED_FILES_TEXT)
}

function StepHeading({ number, title, done }: { number: number; title: string; done?: boolean }) {
  return (
    <h2 className="flex items-center gap-3 text-xl font-semibold">
      <span
        aria-hidden="true"
        className={cn(
          'flex h-7 w-7 items-center justify-center rounded-full border text-sm',
          done ? 'border-good bg-good/15 text-good' : 'border-border text-muted',
        )}
      >
        {done ? '✓' : number}
      </span>
      {title}
    </h2>
  )
}

export default function UploadPage() {
  const location = useLocation()
  const redirectMessage = readRedirectMessage(location.state)

  const docId = useAppStore((state) => state.doc_id)
  const filename = useAppStore((state) => state.filename)
  const settings = useAppStore((state) => state.settings)
  const processResult = useAppStore((state) => state.processResult)
  const setDocument = useAppStore((state) => state.setDocument)
  const setSettings = useAppStore((state) => state.setSettings)
  const setProcessResult = useAppStore((state) => state.setProcessResult)
  const clearDocument = useAppStore((state) => state.clearDocument)
  const demoMode = useAppStore((state) => state.demoMode)

  const [uploadInfo, setUploadInfo] = useState<UploadResponse | null>(null)
  const [uploading, setUploading] = useState<string | null>(null)
  const [uploadError, setUploadError] = useState<ApiError | null>(null)
  const [phase, setPhase] = useState<ProcessPhase>(processResult ? 'done' : 'idle')
  const [status, setStatus] = useState<ProcessingStatus | null>(null)
  const [processError, setProcessError] = useState<ApiError | null>(null)
  const pollAbort = useRef<AbortController | null>(null)
  const lastFile = useRef<File | null>(null)

  const loadSamples = useCallback(() => getSamples(), [demoMode]) // eslint-disable-line react-hooks/exhaustive-deps
  const samples = useAsync(loadSamples)
  const settingsErrors = validateSettings(settings)
  const settingsValid = Object.keys(settingsErrors).length === 0

  // Stop polling when the page unmounts.
  useEffect(() => () => pollAbort.current?.abort(), [])

  const runPolling = useCallback(
    async (id: string) => {
      pollAbort.current?.abort()
      const controller = new AbortController()
      pollAbort.current = controller
      setPhase('running')
      try {
        const final = await pollProcessing(id, { signal: controller.signal, onUpdate: setStatus })
        if (final.status === 'error') {
          setPhase('error')
          setProcessError(
            new ApiError(
              'PROCESSING_FAILED',
              final.error_message ?? 'Processing failed on the server.',
            ),
          )
          return
        }
        setPhase('fetching')
        const result = await getProcessResult(id)
        if (controller.signal.aborted) return
        setProcessResult(result)
        setPhase('done')
      } catch (error) {
        if (error instanceof DOMException && error.name === 'AbortError') return
        setPhase('error')
        setProcessError(toApiError(error))
      }
    },
    [setProcessResult],
  )

  // Coming back to this page mid-run (or after a reload): pick the job up where it is.
  useEffect(() => {
    if (!docId || processResult) return
    let active = true
    getStatus(docId)
      .then((current) => {
        if (!active) return
        setStatus(current)
        if (current.status === 'running') void runPolling(docId)
        else if (current.status === 'done') void runPolling(docId)
        else if (current.status === 'error') {
          setPhase('error')
          setProcessError(
            new ApiError('PROCESSING_FAILED', current.error_message ?? 'Processing failed.'),
          )
        }
      })
      .catch((error: unknown) => {
        if (active && toApiError(error).code === 'DOC_NOT_FOUND') {
          setUploadError(toApiError(error))
          clearDocument()
        }
      })
    return () => {
      active = false
    }
    // Only on mount / document change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [docId])

  const afterUpload = (response: UploadResponse) => {
    pollAbort.current?.abort()
    setDocument(response) // clears old chats, votes and results (spec C3 rule 11)
    setUploadInfo(response)
    setStatus(null)
    setProcessError(null)
    setPhase('idle')
  }

  const doUpload = async (file: File) => {
    lastFile.current = file
    setUploadError(null)
    setUploading(file.name)
    try {
      afterUpload(await uploadFile(file))
    } catch (error) {
      setUploadError(toApiError(error))
    } finally {
      setUploading(null)
    }
  }

  const doUploadSample = async (sampleId: string, title: string) => {
    lastFile.current = null
    setUploadError(null)
    setUploading(title)
    try {
      afterUpload(await uploadSample(sampleId))
    } catch (error) {
      setUploadError(toApiError(error))
    } finally {
      setUploading(null)
    }
  }

  const onDrop = (accepted: File[], rejected: FileRejection[]) => {
    if (rejected.length > 0) {
      setUploadError(rejectionError(rejected))
      return
    }
    const file = accepted[0]
    if (file) void doUpload(file)
  }

  const { getRootProps, getInputProps, isDragActive, open } = useDropzone({
    onDrop,
    accept: ACCEPT,
    maxSize: MAX_UPLOAD_BYTES,
    multiple: false,
    noClick: true,
    disabled: uploading !== null || phase === 'running' || phase === 'starting',
  })

  const doProcess = async () => {
    if (!docId || !settingsValid) return
    setProcessError(null)
    setProcessResult(null)
    setStatus({
      doc_id: docId,
      status: 'running',
      step: 'uploaded',
      progress: 0,
      error_message: null,
    })
    setPhase('starting')
    try {
      await startProcess(docId, settings)
      await runPolling(docId)
    } catch (error) {
      const apiError = toApiError(error)
      if (apiError.code === 'PROCESSING_IN_PROGRESS') {
        await runPolling(docId)
        return
      }
      setPhase('error')
      setProcessError(apiError)
    }
  }

  const busy = phase === 'starting' || phase === 'running' || phase === 'fetching'
  const hasDoc = docId !== null

  return (
    <div className="space-y-10">
      <PageHeader
        title="Upload and process"
        description="Pick a document, check the settings, then process it. Both chunkers run on the same file, and both chunk sets are embedded and stored the same way."
      />

      {redirectMessage && !processResult ? (
        <p
          role="status"
          className="rounded-[var(--radius-sm)] border border-accent/40 bg-accent/10 px-4 py-3 text-sm"
        >
          {redirectMessage}
        </p>
      ) : null}

      {/* 1. Document */}
      <section aria-labelledby="step-document" className="space-y-4">
        <div id="step-document">
          <StepHeading number={1} title="Choose a document" done={hasDoc} />
        </div>
        <div className="grid gap-5 lg:grid-cols-[1.4fr_1fr]">
          <div
            {...getRootProps()}
            className={cn(
              'relative flex min-h-60 flex-col items-center justify-center gap-4 overflow-hidden rounded-[var(--radius-md)] border-2 border-dashed p-8 text-center transition-colors',
              isDragActive ? 'border-accent bg-accent/10' : 'border-border bg-surface/70',
            )}
          >
            <input {...getInputProps()} aria-label="Upload a document" />
            <div aria-hidden="true" className="flex items-end gap-1.5">
              {[
                'bg-type-prose h-8',
                'bg-type-code h-12',
                'bg-type-table h-10',
                'bg-type-list h-6',
              ].map((cls, index) => (
                <motion.span
                  key={cls}
                  className={cn('w-5 rounded-[3px]', cls)}
                  animate={isDragActive ? { y: [0, -8, 0] } : { y: 0 }}
                  transition={{
                    duration: 0.6,
                    repeat: isDragActive ? Infinity : 0,
                    delay: index * 0.08,
                  }}
                />
              ))}
            </div>
            {uploading ? (
              <LoadingState compact label={`Uploading ${uploading}…`} />
            ) : (
              <>
                <div className="space-y-1">
                  <p className="text-lg font-medium">
                    {isDragActive ? 'Drop it here' : 'Drag a file here'}
                  </p>
                  <p className="text-sm text-muted">
                    PDF, Markdown, TXT, CSV or Excel, up to {MAX_UPLOAD_MB} MB
                  </p>
                </div>
                <button type="button" className="btn btn-primary" onClick={open} disabled={busy}>
                  Choose a file
                </button>
              </>
            )}
          </div>

          <div className="panel space-y-3 p-4">
            <h3 className="font-semibold">Or start with a sample</h3>
            {samples.status === 'loading' ? (
              <LoadingState compact label="Loading samples…" />
            ) : null}
            {samples.status === 'error' ? (
              <ErrorState
                compact
                error={samples.error}
                onRetry={samples.reload}
                title="Samples didn’t load"
              />
            ) : null}
            {samples.status === 'success' && samples.data.length === 0 ? (
              <p className="text-sm text-muted">No samples are available on this server.</p>
            ) : null}
            {samples.status === 'success' && samples.data.length > 0 ? (
              <ul className="space-y-2">
                {samples.data.map((sample) => (
                  <li key={sample.sample_id}>
                    <button
                      type="button"
                      disabled={uploading !== null || busy}
                      onClick={() => void doUploadSample(sample.sample_id, sample.title)}
                      className="group w-full rounded-[var(--radius-sm)] border border-border bg-bg/50 p-3 text-left transition-colors hover:border-accent/60 disabled:opacity-50"
                    >
                      <span className="flex items-center justify-between gap-2">
                        <span className="font-medium">{sample.title}</span>
                        <span className="font-mono text-xs text-muted">{sample.filename}</span>
                      </span>
                      <span className="mt-1 block text-sm text-muted">{sample.description}</span>
                    </button>
                  </li>
                ))}
              </ul>
            ) : null}
          </div>
        </div>

        {uploadError ? (
          <ErrorState
            compact
            error={uploadError}
            title="That file couldn’t be used"
            onRetry={
              lastFile.current
                ? () => lastFile.current && void doUpload(lastFile.current)
                : undefined
            }
          />
        ) : null}

        {hasDoc ? (
          <div className="flex flex-wrap items-center gap-3 rounded-[var(--radius-sm)] border border-good/40 bg-good/[0.05] px-4 py-3 text-sm">
            <span aria-hidden="true" className="text-good">
              ✓
            </span>
            <span className="font-medium">{filename}</span>
            {uploadInfo ? (
              <span className="text-muted">
                {uploadInfo.pages}{' '}
                {/\.xlsx?m?$/i.test(uploadInfo.filename)
                  ? uploadInfo.pages === 1
                    ? 'sheet'
                    : 'sheets'
                  : uploadInfo.pages === 1
                    ? 'page'
                    : 'pages'}
                , {formatBytes(uploadInfo.size_bytes)}
              </span>
            ) : null}
            <span className="font-mono text-xs text-muted">{docId}</span>
          </div>
        ) : null}
        {uploadInfo && uploadInfo.warnings.length > 0 ? (
          <ul className="space-y-1 text-sm text-type-code">
            {uploadInfo.warnings.map((warning) => (
              <li key={warning}>{warning}</li>
            ))}
          </ul>
        ) : null}
      </section>

      {/* 2. Settings */}
      <section aria-labelledby="step-settings" className="space-y-4">
        <div id="step-settings">
          <StepHeading
            number={2}
            title="Check the settings"
            done={settingsValid && hasDoc && phase === 'done'}
          />
        </div>
        <Expander
          label={
            settingsValid ? (
              <>Advanced settings (the defaults work well)</>
            ) : (
              <span className="text-bad">Some settings are out of range</span>
            )
          }
          defaultOpen={!settingsValid}
        >
          <SettingsForm
            value={settings}
            errors={settingsErrors}
            disabled={busy}
            onChange={setSettings}
          />
        </Expander>
      </section>

      {/* 3. Process */}
      <section aria-labelledby="step-process" className="space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div id="step-process">
            <StepHeading
              number={3}
              title="Process it"
              done={phase === 'done' && processResult !== null}
            />
          </div>
          <button
            type="button"
            className="btn btn-primary px-5"
            disabled={!hasDoc || !settingsValid || busy}
            onClick={() => void doProcess()}
          >
            {busy ? 'Processing…' : processResult ? 'Process again' : 'Process document'}
          </button>
        </div>

        {!hasDoc ? (
          <p className="text-sm text-muted">Choose a document above to enable processing.</p>
        ) : null}

        {hasDoc && (status || busy || phase === 'done') ? (
          <ProcessPipeline
            status={
              phase === 'done' && processResult
                ? {
                    doc_id: docId,
                    status: 'done',
                    step: 'done',
                    progress: 100,
                    error_message: null,
                  }
                : status
            }
          />
        ) : null}

        {processError ? (
          <ErrorState
            compact
            error={processError}
            title="Processing stopped"
            onRetry={() => void doProcess()}
          />
        ) : null}
      </section>

      {/* 4. Results */}
      <AnimatePresence>
        {processResult ? (
          <motion.section
            key="results"
            aria-labelledby="results"
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            className="space-y-6"
          >
            <div className="flex flex-wrap items-end justify-between gap-4">
              <div>
                <StepHeading number={4} title="Results" done />
                <p id="results" className="mt-2 text-muted">
                  The same file, cut two ways. Here is what changed.
                </p>
              </div>
              <div className="flex flex-wrap gap-2">
                <Link to={ROUTES.explorer} className="btn">
                  Explore chunks
                </Link>
                <Link to={ROUTES.compareChunks} className="btn">
                  Compare chunking
                </Link>
                <Link to={ROUTES.visualize} className="btn">
                  Visualise chunking
                </Link>
                <Link to={ROUTES.chatSmart} className="btn btn-primary">
                  Ask questions
                </Link>
              </div>
            </div>

            {processResult.warnings.length > 0 ? (
              <ul className="space-y-1 rounded-[var(--radius-sm)] border border-type-code/40 bg-type-code/[0.06] p-3 text-sm">
                {processResult.warnings.map((warning) => (
                  <li key={warning}>{warning}</li>
                ))}
              </ul>
            ) : null}

            <ResultVerdict smart={processResult.smart_stats} naive={processResult.naive_stats} />

            <div className="grid gap-5 lg:grid-cols-2">
              <MethodStatsPanel method="naive" stats={processResult.naive_stats} />
              <MethodStatsPanel method="smart" stats={processResult.smart_stats} />
            </div>

            <div className="panel space-y-4 p-5">
              <div>
                <h3 className="text-lg font-semibold">What SmartChunk cleaned out</h3>
                <p className="text-sm text-muted">
                  SmartChunk only. The traditional chunker keeps all of this in its chunks.
                </p>
              </div>
              {processResult.removed_report.items.length === 0 ? (
                <EmptyState
                  title="Nothing was removed"
                  description="This document had no repeated headers, footers or duplicates."
                />
              ) : (
                <RemovedList items={processResult.removed_report.items} />
              )}
            </div>
          </motion.section>
        ) : null}
      </AnimatePresence>
    </div>
  )
}
