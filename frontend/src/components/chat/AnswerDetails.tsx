import { motion } from 'framer-motion'
import { ChunkCard } from '@/components/ChunkCard'
import { CitationChip } from '@/components/CitationChip'
import { Expander } from '@/components/Expander'
import { ScoreBar } from '@/components/ScoreBar'
import { TokenMeter } from '@/components/TokenMeter'
import { cn } from '@/lib/cn'
import { formatMs } from '@/lib/format'
import type { ChatResult } from '@/types/api'

interface AnswerDetailsProps {
  result: ChatResult
  question: string
  /** not_found_threshold from the settings, drawn as a marker on each score bar. */
  threshold?: number
  /** The AI read the passages but said the document doesn't answer the question. */
  declined?: boolean
  className?: string
}

/** Citations, retrieval, token meter, latency and the prompt behind one answer. */
export function AnswerDetails({
  result,
  question,
  threshold,
  declined = false,
  className,
}: AnswerDetailsProps) {
  const rewritten = result.standalone_question.trim() !== question.trim()
  return (
    <motion.div
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.35, ease: 'easeOut', delay: 0.25 }}
      className={cn('space-y-3 border-t border-border pt-3', className)}
    >
      {rewritten ? (
        <p className="text-xs text-muted">
          Understood your question as:{' '}
          <span className="text-fg/80">{result.standalone_question}</span>
        </p>
      ) : null}

      {result.sources.length > 0 ? (
        <div className="space-y-1.5">
          <p className="text-xs text-muted">
            {declined ? 'Passages it checked (none answered the question)' : 'Where this came from'}
          </p>
          <div className="flex flex-wrap gap-1.5">
            {result.sources.map((source) => (
              <CitationChip key={source.chunk_id} citation={source} />
            ))}
          </div>
        </div>
      ) : null}

      <div className="grid gap-3 sm:grid-cols-[1fr_auto] sm:items-end">
        {result.not_found ? (
          <p className="text-xs text-muted">
            Nothing in the file matched well enough, so the AI was not asked.
          </p>
        ) : (
          <TokenMeter tokens={result.tokens_used} limit={result.context_window_limit} />
        )}
        <p className="text-xs text-muted sm:text-right">
          Answered in <span className="tabular-nums text-fg">{formatMs(result.latency_ms)}</span>
        </p>
      </div>

      <Expander
        label={
          <>
            Passages the chatbot read{' '}
            <span className="tabular-nums text-fg">{result.retrieved_chunks.length}</span>
          </>
        }
      >
        {result.retrieved_chunks.length === 0 ? (
          <p className="text-sm text-muted">No passages were found for this question.</p>
        ) : (
          <>
            <p className="mb-3 text-xs text-muted">
              The bar is the match score: 1.00 is a perfect match. Passages left of the thin line
              were too weak to use.
            </p>
            <ol className="space-y-3">
              {result.retrieved_chunks.map((item, index) => (
                <li key={`${item.chunk.chunk_id}-${index}`} className="space-y-1.5">
                  <ScoreBar score={item.score} threshold={threshold} />
                  <ChunkCard chunk={item.chunk} />
                </li>
              ))}
            </ol>
          </>
        )}
      </Expander>

      {result.prompt_sent.trim() !== '' ? (
        <Expander label="Show exactly what the AI was sent">
          <pre className="code-block scrollbar-thin max-h-96 whitespace-pre-wrap text-xs">
            {result.prompt_sent}
          </pre>
        </Expander>
      ) : null}
    </motion.div>
  )
}
