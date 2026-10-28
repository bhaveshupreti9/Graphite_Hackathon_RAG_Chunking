import { AnimatePresence, motion } from 'framer-motion'
import { useId, useState } from 'react'
import type { ReactNode } from 'react'
import { cn } from '@/lib/cn'

interface ExpanderProps {
  label: ReactNode
  children: ReactNode
  defaultOpen?: boolean
  className?: string
}

export function Expander({ label, children, defaultOpen = false, className }: ExpanderProps) {
  const [open, setOpen] = useState(defaultOpen)
  const id = useId()
  return (
    <div className={cn('rounded-[var(--radius-sm)] border border-border', className)}>
      <button
        type="button"
        aria-expanded={open}
        aria-controls={id}
        onClick={() => setOpen((value) => !value)}
        className="flex w-full items-center justify-between gap-3 px-3 py-2 text-left text-sm text-muted transition-colors hover:text-fg"
      >
        <span className="flex items-center gap-2">{label}</span>
        <motion.span aria-hidden="true" animate={{ rotate: open ? 180 : 0 }} className="text-xs">
          ▾
        </motion.span>
      </button>
      <AnimatePresence initial={false}>
        {open ? (
          <motion.div
            id={id}
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.22 }}
            className="overflow-hidden"
          >
            <div className="border-t border-border p-3">{children}</div>
          </motion.div>
        ) : null}
      </AnimatePresence>
    </div>
  )
}
