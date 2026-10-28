import { RichText } from '@/components/RichText'
import { cn } from '@/lib/cn'

// The answer prompt asks the model to put anything that is not from the document in a final
// section starting with "Beyond the document:". That part is shown in its own callout so a reader
// can always tell what came from their file and what is general knowledge.
const BEYOND = /^[ \t>]*(?:[*_#]+\s*)?Beyond the document\s*:?\s*(?:[*_]+)?\s*:?[ \t]*/im

function splitAnswer(answer: string): { fromDocument: string; beyond: string | null } {
  const match = BEYOND.exec(answer)
  if (!match) return { fromDocument: answer, beyond: null }
  const fromDocument = answer.slice(0, match.index).trim()
  const beyond = answer.slice(match.index + match[0].length).trim()
  return { fromDocument, beyond: beyond === '' ? null : beyond }
}

interface AnswerTextProps {
  text: string
  className?: string
}

/** A model answer: the part grounded in the document, then any general-knowledge addition. */
export function AnswerText({ text, className }: AnswerTextProps) {
  const { fromDocument, beyond } = splitAnswer(text)
  return (
    <div className={cn('space-y-3', className)}>
      {fromDocument !== '' ? <RichText text={fromDocument} /> : null}
      {beyond ? (
        <aside
          aria-label="Beyond the document"
          className="rounded-[var(--radius-sm)] border border-type-code/40 bg-type-code/[0.07] px-4 py-3"
        >
          <p className="mb-1.5 flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-type-code">
            <span aria-hidden="true">◆</span> Beyond the document
            <span className="font-normal normal-case tracking-normal text-muted">
              general knowledge, not from your file
            </span>
          </p>
          <RichText text={beyond} className="text-[14px] leading-6 text-fg/85" />
        </aside>
      ) : null}
    </div>
  )
}
