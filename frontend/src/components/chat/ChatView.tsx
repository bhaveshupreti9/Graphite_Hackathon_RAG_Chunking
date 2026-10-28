import { motion } from 'framer-motion'
import { useCallback, useEffect, useRef, useState } from 'react'
import type { FormEvent, KeyboardEvent } from 'react'
import { Link } from 'react-router-dom'
import { chat, getSummary } from '@/api/client'
import { toApiError } from '@/api/errors'
import type { ApiError } from '@/api/errors'
import { ChatBubble } from '@/components/ChatBubble'
import { ErrorState } from '@/components/ErrorState'
import { LoadingState } from '@/components/LoadingState'
import { AnswerText } from '@/components/AnswerText'
import { MethodBadge } from '@/components/TypeBadge'
import { useAsync } from '@/hooks/useAsync'
import { chatKey, recallChat, rememberChat } from '@/lib/chatCache'
import { cn } from '@/lib/cn'
import { METHOD_LABELS, ROUTES } from '@/lib/constants'
import { useAppStore } from '@/store/useAppStore'
import type { ChatTurn, Method } from '@/types/api'
import { AnswerDetails } from './AnswerDetails'

const EMPTY: ChatTurn[] = []

/** The model read the passages and replied that the document doesn't contain the answer. */
const DECLINED =
  /\b(could ?n[o']t find|can ?n[o']t find|unable to find|not (found|mentioned|covered|provided|included) in the (provided |given )?(document|context|text)|(document|context) does ?n[o']t (contain|mention|cover|say))/i

function isDeclinedAnswer(answer: string): boolean {
  return DECLINED.test(answer.slice(0, 300))
}

interface ChatViewProps {
  method: Method
  /** Compact: no summary panel and a shorter intro (used inside Session Summary). */
  compact?: boolean
}

function SummaryPanel({
  docId,
  onAsk,
  disabled,
}: {
  docId: string
  onAsk: (q: string) => void
  disabled: boolean
}) {
  const loader = useCallback(() => getSummary(docId), [docId])
  const summary = useAsync(loader)

  if (summary.status === 'loading') return <LoadingState compact label="Loading the summary…" />
  if (summary.status === 'error') {
    return (
      <ErrorState
        compact
        error={summary.error}
        onRetry={summary.reload}
        title="Summary didn’t load"
      />
    )
  }
  const data = summary.data
  return (
    <div className="space-y-5">
      <div className="space-y-2">
        <h2 className="font-semibold">About this document</h2>
        {data.summary.trim() === '' ? (
          <p className="text-sm text-muted">
            No summary for this document yet. Once the AI model is connected, process the document
            again to get a summary and suggested questions.
          </p>
        ) : (
          <p className="text-sm leading-6 text-fg/80">{data.summary}</p>
        )}
      </div>
      {data.key_topics.length > 0 ? (
        <div className="space-y-2">
          <h3 className="text-sm text-muted">Key topics</h3>
          <ul className="flex flex-wrap gap-1.5">
            {data.key_topics.map((topic) => (
              <li key={topic} className="chip text-fg/80">
                {topic}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      {data.suggested_questions.length > 0 ? (
        <div className="space-y-2">
          <h3 className="text-sm text-muted">Try asking</h3>
          <ul className="space-y-1.5">
            {data.suggested_questions.map((question) => (
              <li key={question}>
                <button
                  type="button"
                  disabled={disabled}
                  onClick={() => onAsk(question)}
                  className="w-full rounded-[var(--radius-sm)] border border-border bg-bg/50 px-3 py-2 text-left text-sm transition-colors hover:border-accent/60 disabled:opacity-50"
                >
                  {question}
                </button>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  )
}

/** One chat component for both methods (spec C4.4). Only `method` differs. */
export function ChatView({ method, compact = false }: ChatViewProps) {
  const docId = useAppStore((state) => state.doc_id) ?? ''
  const history = useAppStore((state) => state.histories[method] ?? EMPTY)
  const threshold = useAppStore((state) => state.processResult?.settings.not_found_threshold)
  const appendTurns = useAppStore((state) => state.appendTurns)
  const clearHistory = useAppStore((state) => state.clearHistory)
  const [draft, setDraft] = useState('')
  const [pending, setPending] = useState<string | null>(null)
  const [failed, setFailed] = useState<{ question: string; error: ApiError } | null>(null)
  // Index of the user turn that was on screen as "pending" and just got its answer: it must not
  // fade in a second time when it moves into the history.
  const [settledIndex, setSettledIndex] = useState<number | null>(null)
  // Which turn index got its answer during this visit; only that answer animates in.
  const [freshAnswer, setFreshAnswer] = useState<number | null>(null)
  const [stage, setStage] = useState<0 | 1>(0)
  const endRef = useRef<HTMLDivElement>(null)
  const other: Method = method === 'smart' ? 'naive' : 'smart'

  useEffect(() => {
    if (history.length > 0 || pending || failed)
      endRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
  }, [history.length, pending, failed])

  // Two honest stages while waiting: retrieval is fast, writing the answer takes longer.
  useEffect(() => {
    if (!pending) return
    setStage(0)
    const timer = setTimeout(() => setStage(1), 900)
    return () => clearTimeout(timer)
  }, [pending])

  const ask = async (raw: string) => {
    const question = raw.trim()
    if (question === '' || pending) return
    setDraft('')
    setFailed(null)
    setPending(question)
    try {
      const result = await chat({ doc_id: docId, method, question, history })
      const current = useAppStore.getState().histories[method] ?? EMPTY
      rememberChat(chatKey(docId, method, current.length + 1), result)
      setSettledIndex(current.length)
      setFreshAnswer(current.length + 1)
      appendTurns(method, [
        { role: 'user', content: question },
        { role: 'assistant', content: result.answer },
      ])
    } catch (error) {
      setFailed({ question, error: toApiError(error) })
    } finally {
      setPending(null)
    }
  }

  const onSubmit = (event: FormEvent) => {
    event.preventDefault()
    void ask(draft)
  }

  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault()
      void ask(draft)
    }
  }

  const conversation = (
    <div className="flex min-h-[28rem] flex-col">
      <div className="flex-1 space-y-5 pb-4" aria-live="polite">
        {history.length === 0 && !pending ? (
          <div className="flex flex-col items-center justify-center gap-2 py-16 text-center">
            <MethodBadge method={method} />
            <p className="max-w-sm text-muted">
              Ask anything about the document. Follow-up questions use the last six messages.
            </p>
          </div>
        ) : null}

        {history.map((turn, index) => {
          if (turn.role === 'user') {
            return (
              <ChatBubble key={index} role="user" instant={index === settledIndex}>
                <p className="whitespace-pre-wrap">{turn.content}</p>
              </ChatBubble>
            )
          }
          const result = recallChat(chatKey(docId, method, index))
          const question = history[index - 1]?.content ?? ''
          const declined = !result?.not_found && isDeclinedAnswer(turn.content)
          return (
            <ChatBubble
              key={index}
              role="assistant"
              method={method}
              notFound={(result?.not_found ?? false) || declined}
              instant={index !== freshAnswer && index < history.length - 1}
            >
              {result?.not_found ? (
                <p className="mb-2 inline-flex items-center gap-1.5 rounded-full border border-noise/50 px-2.5 py-0.5 text-xs font-medium text-noise">
                  <span aria-hidden="true">∅</span> Not found in document
                </p>
              ) : declined ? (
                <p className="mb-2 inline-flex items-center gap-1.5 rounded-full border border-noise/50 px-2.5 py-0.5 text-xs font-medium text-noise">
                  <span aria-hidden="true">∅</span> This document doesn’t cover that
                </p>
              ) : null}
              <motion.div
                initial={index === freshAnswer ? { opacity: 0, filter: 'blur(4px)' } : false}
                animate={{ opacity: 1, filter: 'blur(0px)' }}
                transition={{ duration: 0.45, ease: 'easeOut' }}
              >
                <AnswerText text={turn.content} />
              </motion.div>
              {result ? (
                <AnswerDetails
                  className="mt-3"
                  result={result}
                  question={question}
                  threshold={threshold}
                  declined={declined}
                />
              ) : null}
            </ChatBubble>
          )
        })}

        {pending ? (
          <div className="space-y-5">
            <ChatBubble role="user">
              <p className="whitespace-pre-wrap">{pending}</p>
            </ChatBubble>
            <ChatBubble role="assistant" method={method}>
              <div className="space-y-3" role="status">
                <ol className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
                  {['Finding the best passages', 'Writing the answer'].map((label, step) => (
                    <li
                      key={label}
                      className={cn(
                        'flex items-center gap-2 transition-colors duration-300',
                        step <= stage ? 'text-fg' : 'text-muted',
                      )}
                    >
                      <span
                        aria-hidden="true"
                        className={cn(
                          'h-1.5 w-1.5 rounded-full transition-colors duration-300',
                          step < stage
                            ? 'bg-good'
                            : step === stage
                              ? 'animate-pulse bg-accent'
                              : 'bg-border',
                        )}
                      />
                      {label}
                      {step === stage ? '…' : ''}
                    </li>
                  ))}
                </ol>
                <div aria-hidden="true" className="space-y-2">
                  {[92, 78, 54].map((width, line) => (
                    <motion.div
                      key={line}
                      className="h-2.5 rounded-full bg-surface-2"
                      style={{ width: `${width}%` }}
                      animate={{ opacity: [0.45, 1, 0.45] }}
                      transition={{ duration: 1.4, repeat: Infinity, delay: line * 0.15 }}
                    />
                  ))}
                </div>
              </div>
            </ChatBubble>
          </div>
        ) : null}

        {failed ? (
          <ErrorState
            compact
            error={failed.error}
            title="No answer this time"
            onRetry={() => void ask(failed.question)}
          />
        ) : null}
        <div ref={endRef} />
      </div>

      <form
        onSubmit={onSubmit}
        className={cn(
          'rounded-[var(--radius-md)] border border-border bg-surface/95 p-2 shadow-2xl backdrop-blur',
          !compact && 'sticky bottom-4',
        )}
      >
        <label htmlFor={`ask-${method}`} className="sr-only">
          Ask the {METHOD_LABELS[method]} chatbot
        </label>
        <div className="flex items-end gap-2">
          <textarea
            id={`ask-${method}`}
            rows={1}
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={onKeyDown}
            placeholder={
              history.length > 0 ? 'Ask a follow-up…' : 'Ask a question about the document…'
            }
            className="max-h-40 min-h-[2.5rem] flex-1 resize-none bg-transparent px-2 py-2 text-base text-fg placeholder:text-muted/70 focus:outline-none"
          />
          <button
            type="submit"
            className="btn btn-primary"
            disabled={draft.trim() === '' || pending !== null}
          >
            Ask
          </button>
        </div>
      </form>
    </div>
  )

  if (compact) return conversation

  return (
    <div className="space-y-6">
      <header className="flex flex-col gap-4 border-b border-border pb-6 md:flex-row md:items-end md:justify-between">
        <div className="max-w-2xl space-y-2">
          <MethodBadge method={method} />
          <h1 className="text-3xl font-semibold md:text-4xl">
            {method === 'smart' ? 'SmartChunk chat' : 'Traditional chat'}
          </h1>
          <p className="text-muted">
            {method === 'smart'
              ? 'Answers come from structure-aware chunks: whole code blocks, tables and lists, each labelled with its heading path and page.'
              : 'Answers come from fixed-size chunks with overlap. Same embedder, prompt and model as SmartChunk; only the chunking differs.'}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Link to={method === 'smart' ? ROUTES.chatTraditional : ROUTES.chatSmart} className="btn">
            Switch to {METHOD_LABELS[other]}
          </Link>
          <Link to={ROUTES.compareAnswers} className="btn">
            Compare side by side
          </Link>
          {history.length > 0 ? (
            <button type="button" className="btn btn-ghost" onClick={() => clearHistory(method)}>
              Clear chat
            </button>
          ) : null}
        </div>
      </header>

      <div className="grid gap-6 lg:grid-cols-[1fr_20rem]">
        <section aria-label="Conversation" className="min-w-0">
          {conversation}
        </section>
        <aside className={cn('panel h-fit p-5 lg:sticky lg:top-24')}>
          <SummaryPanel
            docId={docId}
            onAsk={(question) => void ask(question)}
            disabled={pending !== null}
          />
        </aside>
      </div>
    </div>
  )
}
