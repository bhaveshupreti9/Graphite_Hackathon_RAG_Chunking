import { motion } from 'framer-motion'
import type { ReactNode } from 'react'
import { cn } from '@/lib/cn'
import type { Method } from '@/types/api'

interface ChatBubbleProps {
  role: 'user' | 'assistant'
  method?: Method
  notFound?: boolean
  /** Skip the entrance animation (the bubble is already on screen, e.g. the pending question). */
  instant?: boolean
  children: ReactNode
}

export function ChatBubble({
  role,
  method = 'smart',
  notFound = false,
  instant = false,
  children,
}: ChatBubbleProps) {
  const isUser = role === 'user'
  return (
    <motion.div
      initial={instant ? false : { opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3, ease: [0.22, 1, 0.36, 1] }}
      className={cn('flex gap-3', isUser ? 'justify-end' : 'justify-start')}
    >
      {!isUser ? (
        <span
          aria-hidden="true"
          className={cn(
            'mt-1 flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-semibold text-white',
            notFound ? 'bg-noise' : method === 'smart' ? 'bg-accent' : 'bg-naive',
          )}
        >
          {method === 'smart' ? 'S' : 'T'}
        </span>
      ) : null}
      <div
        className={cn(
          'min-w-0 rounded-[var(--radius-md)] border px-4 py-3',
          isUser
            ? 'max-w-[85%] border-accent/30 bg-accent/15'
            : notFound
              ? 'w-full max-w-3xl border-noise/40 bg-noise/[0.06]'
              : 'w-full max-w-3xl border-border bg-surface',
        )}
      >
        <span className="sr-only">{isUser ? 'You said:' : 'Answer:'}</span>
        {children}
      </div>
    </motion.div>
  )
}
