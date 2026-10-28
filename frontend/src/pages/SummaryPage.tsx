import { useCallback, useMemo } from 'react'
import { Link } from 'react-router-dom'
import { createSessionSummary } from '@/api/client'
import { ChatView } from '@/components/chat/ChatView'
import { EmptyState } from '@/components/EmptyState'
import { ErrorState } from '@/components/ErrorState'
import { LoadingState } from '@/components/LoadingState'
import { PageHeader } from '@/components/PageHeader'
import { StatCard } from '@/components/StatCard'
import { useAsync } from '@/hooks/useAsync'
import { cn } from '@/lib/cn'
import { ROUTES } from '@/lib/constants'
import { saveBlob } from '@/lib/download'
import { useAppStore } from '@/store/useAppStore'
import type { QAItem, SessionSummary } from '@/types/api'

const WINNER_LABEL: Record<QAItem['winner'], string> = {
  smart: 'SmartChunk',
  naive: 'Traditional',
  tie: 'Tie',
  unvoted: 'Not voted',
}

const WINNER_CLASS: Record<QAItem['winner'], string> = {
  smart: 'border-accent/60 text-fg',
  naive: 'border-naive/60 text-fg',
  tie: 'border-border text-fg',
  unvoted: 'border-border text-muted',
}

const escapeCell = (text: string): string => text.replace(/\|/g, '\\|').replace(/\n+/g, ' ')

function toMarkdown(summary: SessionSummary, filename: string | null): string {
  const lines = [
    `# SmartChunk session summary`,
    '',
    filename ? `Document: ${filename}` : '',
    `Exported: ${new Date().toISOString()}`,
    '',
    '## Recap',
    '',
    summary.recap,
    '',
    '## Key findings',
    '',
    ...(summary.key_findings.length > 0
      ? summary.key_findings.map((finding) => `- ${finding}`)
      : ['- None']),
    '',
    '## Questions',
    '',
    '| Question | SmartChunk answer | Traditional answer | Winner |',
    '|---|---|---|---|',
    ...summary.qa_rows.map(
      (row) =>
        `| ${escapeCell(row.question)} | ${escapeCell(row.smart_answer)} | ${escapeCell(row.naive_answer)} | ${WINNER_LABEL[row.winner]} |`,
    ),
    '',
  ]
  return lines.filter((line, index) => !(line === '' && lines[index - 1] === '')).join('\n')
}

export default function SummaryPage() {
  const docId = useAppStore((state) => state.doc_id) ?? ''
  const filename = useAppStore((state) => state.filename)
  const qaItems = useAppStore((state) => state.qaItems)

  // Re-request only when the questions or votes change.
  const signature = JSON.stringify(qaItems)
  const loader = useCallback(
    () => createSessionSummary({ doc_id: docId, qa_items: JSON.parse(signature) as QAItem[] }),
    [docId, signature],
  )
  const summary = useAsync(loader)

  const tally = useMemo(() => {
    const counts = { smart: 0, naive: 0, tie: 0, unvoted: 0 }
    qaItems.forEach((item) => {
      counts[item.winner] += 1
    })
    return counts
  }, [qaItems])

  const exportMarkdown = () => {
    if (summary.status !== 'success') return
    const blob = new Blob([toMarkdown(summary.data, filename)], { type: 'text/markdown' })
    saveBlob(blob, `smartchunk-session-${docId}.md`)
  }

  if (qaItems.length === 0) {
    return (
      <div className="space-y-8">
        <PageHeader
          title="Session summary"
          description="A recap of the questions you compared and how you voted."
        />
        <EmptyState
          title="No compared questions yet"
          description="Ask a few questions in Answer comparison and vote on the answers. The summary is built from those."
          action={
            <Link to={ROUTES.compareAnswers} className="btn btn-primary">
              Compare answers
            </Link>
          }
        />
      </div>
    )
  }

  return (
    <div className="space-y-10">
      <PageHeader
        title="Session summary"
        description={filename ? <>Everything you compared on {filename}.</> : undefined}
        actions={
          <>
            <button
              type="button"
              className="btn"
              onClick={summary.reload}
              disabled={summary.status === 'loading'}
            >
              Regenerate
            </button>
            <button
              type="button"
              className="btn btn-primary"
              onClick={exportMarkdown}
              disabled={summary.status !== 'success'}
            >
              Export as Markdown
            </button>
          </>
        }
      />

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <StatCard
          label="SmartChunk wins"
          value={tally.smart}
          tone={tally.smart > 0 ? 'good' : 'neutral'}
        />
        <StatCard label="Traditional wins" value={tally.naive} />
        <StatCard label="Ties" value={tally.tie} />
        <StatCard
          label="Not voted"
          value={tally.unvoted}
          tone={tally.unvoted > 0 ? 'noise' : 'neutral'}
        />
      </div>

      {summary.status === 'loading' && !summary.data ? (
        <LoadingState label="Writing the summary…" />
      ) : null}
      {summary.status === 'error' ? (
        <ErrorState
          error={summary.error}
          onRetry={summary.reload}
          title="The summary couldn’t be generated"
        />
      ) : null}

      {summary.data ? (
        <div
          className={cn(
            'space-y-8 transition-opacity',
            summary.status === 'loading' && 'opacity-60',
          )}
        >
          <section className="grid gap-6 lg:grid-cols-[1.3fr_1fr]">
            <div className="panel space-y-3 p-5">
              <h2 className="text-xl font-semibold">Recap</h2>
              <p className="leading-7 text-fg/85">
                {summary.data.recap || 'No recap was returned.'}
              </p>
            </div>
            <div className="panel space-y-3 p-5">
              <h2 className="text-xl font-semibold">Key findings</h2>
              {summary.data.key_findings.length === 0 ? (
                <p className="text-sm text-muted">No findings were returned.</p>
              ) : (
                <ul className="space-y-2">
                  {summary.data.key_findings.map((finding) => (
                    <li key={finding} className="flex gap-2 text-sm leading-6">
                      <span
                        aria-hidden="true"
                        className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-accent"
                      />
                      {finding}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </section>

          <section aria-labelledby="qa-table" className="space-y-3">
            <h2 id="qa-table" className="text-xl font-semibold">
              Questions and votes
            </h2>
            <div className="panel overflow-x-auto">
              <table className="w-full min-w-[48rem] text-left text-sm">
                <thead className="border-b border-border bg-surface-2/60 text-xs text-muted">
                  <tr>
                    <th scope="col" className="w-1/5 px-4 py-2.5 font-medium">
                      Question
                    </th>
                    <th scope="col" className="px-4 py-2.5 font-medium">
                      SmartChunk answer
                    </th>
                    <th scope="col" className="px-4 py-2.5 font-medium">
                      Traditional answer
                    </th>
                    <th scope="col" className="w-32 px-4 py-2.5 font-medium">
                      Winner
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {summary.data.qa_rows.map((row) => (
                    <tr
                      key={row.question}
                      className="border-b border-border/60 align-top last:border-0"
                    >
                      <td className="px-4 py-3 font-medium">{row.question}</td>
                      <td className="px-4 py-3 text-fg/80">
                        <p className="line-clamp-4 whitespace-pre-wrap">{row.smart_answer}</p>
                      </td>
                      <td className="px-4 py-3 text-fg/80">
                        <p className="line-clamp-4 whitespace-pre-wrap">{row.naive_answer}</p>
                      </td>
                      <td className="px-4 py-3">
                        <span
                          className={cn(
                            'inline-flex rounded-full border px-2.5 py-0.5 text-xs',
                            WINNER_CLASS[row.winner],
                          )}
                        >
                          {WINNER_LABEL[row.winner]}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        </div>
      ) : null}

      <section aria-labelledby="follow-up" className="space-y-3">
        <div>
          <h2 id="follow-up" className="text-xl font-semibold">
            Ask a follow-up
          </h2>
          <p className="text-sm text-muted">
            This is the SmartChunk chat, with the same history as its own page.
          </p>
        </div>
        <div className="panel p-4">
          <ChatView method="smart" compact />
        </div>
      </section>
    </div>
  )
}
