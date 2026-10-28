import { motion } from 'framer-motion'
import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { PageHeader } from '@/components/PageHeader'
import { cn } from '@/lib/cn'
import { CHUNK_TYPE_DOT, ROUTES } from '@/lib/constants'
import { rand } from '@/three/docModel'
import type { ChunkType } from '@/types/api'

const inView = { once: true, amount: 0.4 } as const

function Concept({
  id,
  title,
  children,
  figure,
}: {
  id: string
  title: string
  children: ReactNode
  figure: ReactNode
}) {
  return (
    <section
      aria-labelledby={id}
      className="grid items-center gap-8 border-b border-border py-14 last:border-0 lg:grid-cols-[1fr_1.1fr]"
    >
      <div className="max-w-lg space-y-3">
        <h2 id={id} className="text-2xl font-semibold sm:text-3xl">
          {title}
        </h2>
        <div className="space-y-3 leading-7 text-fg/80">{children}</div>
      </div>
      <div aria-hidden="true" className="panel relative min-h-56 overflow-hidden p-6">
        {figure}
      </div>
    </section>
  )
}

const PREDICTED = ['Binary', 'search', 'runs', 'in', 'O(log', 'n)', 'time', 'on', 'sorted', 'data.']

function LlmFigure() {
  return (
    <div className="space-y-5">
      <p className="text-sm text-muted">Prompt</p>
      <p className="rounded-[var(--radius-sm)] border border-border bg-bg p-3 font-mono text-sm">
        How fast is binary search?
      </p>
      <p className="text-sm text-muted">The model writes one token at a time</p>
      <p className="flex flex-wrap gap-1.5 font-mono text-sm">
        {PREDICTED.map((word, index) => (
          <motion.span
            key={word}
            initial={{ opacity: 0, y: 6 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={inView}
            transition={{ delay: 0.25 + index * 0.18 }}
            className="rounded bg-accent/15 px-1.5 py-0.5 text-fg"
          >
            {word}
          </motion.span>
        ))}
      </p>
    </div>
  )
}

const CONTEXT_BLOCKS: { type: ChunkType; size: number }[] = [
  { type: 'prose', size: 14 },
  { type: 'code', size: 20 },
  { type: 'table', size: 16 },
  { type: 'list', size: 10 },
  { type: 'prose', size: 18 },
  { type: 'code', size: 22 },
  { type: 'table', size: 15 },
  { type: 'prose', size: 12 },
]

function ContextFigure() {
  let used = 0
  return (
    <div className="space-y-4">
      <div className="flex items-baseline justify-between text-sm">
        <span className="text-muted">Context window</span>
        <span className="font-mono text-fg">8,192 tokens</span>
      </div>
      <div className="relative">
        <div className="absolute -inset-y-2 left-0 w-[62%] rounded-[var(--radius-sm)] border-2 border-accent" />
        <div className="flex gap-1 py-1">
          {CONTEXT_BLOCKS.map((block, index) => {
            const start = used
            used += block.size
            const fits = start + block.size <= 62
            return (
              <motion.span
                key={index}
                initial={{ opacity: 0, x: 40 }}
                whileInView={{ opacity: fits ? 1 : 0.25, x: 0 }}
                viewport={inView}
                transition={{ delay: 0.15 + index * 0.12 }}
                className={cn('h-10 shrink-0 rounded-[3px]', CHUNK_TYPE_DOT[block.type])}
                style={{ width: `${block.size * 0.62}%` }}
              />
            )
          })}
        </div>
      </div>
      <p className="text-sm text-muted">
        Chunks that don’t fit are left out. Smaller, cleaner chunks leave room for more of them.
      </p>
    </div>
  )
}

const RAG_STEPS = [
  'Question',
  'Embed the question',
  'Search the vector DB',
  'Top-k chunks + question',
  'LLM writes the answer',
]

function RagFigure() {
  return (
    <ol className="space-y-2">
      {RAG_STEPS.map((step, index) => (
        <motion.li
          key={step}
          initial={{ opacity: 0.25, x: -8 }}
          whileInView={{ opacity: 1, x: 0 }}
          viewport={inView}
          transition={{ delay: 0.2 + index * 0.35 }}
          className={cn(
            'flex items-center gap-3 rounded-[var(--radius-sm)] border px-3 py-2.5 text-sm',
            index === 2 ? 'border-accent bg-accent/10' : 'border-border bg-bg/60',
          )}
        >
          <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-surface-2 font-mono text-xs">
            {index + 1}
          </span>
          {step}
        </motion.li>
      ))}
    </ol>
  )
}

const CLUSTER_CENTERS: Record<ChunkType, [number, number]> = {
  prose: [80, 70],
  code: [250, 60],
  table: [110, 175],
  list: [270, 170],
}

function VectorFigure() {
  const points = (Object.keys(CLUSTER_CENTERS) as ChunkType[]).flatMap((type, typeIndex) =>
    Array.from({ length: 7 }, (_, i) => {
      const [cx, cy] = CLUSTER_CENTERS[type]
      return {
        type,
        x: cx + (rand(i + typeIndex * 10, 1) - 0.5) * 70,
        y: cy + (rand(i + typeIndex * 10, 2) - 0.5) * 55,
      }
    }),
  )
  const query = { x: 178, y: 118 }
  const nearest = points
    .map((point) => ({ ...point, d: Math.hypot(point.x - query.x, point.y - query.y) }))
    .sort((a, b) => a.d - b.d)
    .slice(0, 3)
  const fill: Record<ChunkType, string> = {
    prose: 'fill-type-prose',
    code: 'fill-type-code',
    table: 'fill-type-table',
    list: 'fill-type-list',
  }
  return (
    <svg viewBox="0 0 340 230" className="h-full w-full">
      {points.map((point, index) => (
        <motion.circle
          key={index}
          cx={point.x}
          cy={point.y}
          r={5}
          className={fill[point.type]}
          initial={{ opacity: 0, scale: 0 }}
          whileInView={{ opacity: 1, scale: 1 }}
          viewport={inView}
          transition={{ delay: index * 0.025 }}
        />
      ))}
      {nearest.map((point, index) => (
        <motion.line
          key={index}
          x1={query.x}
          y1={query.y}
          x2={point.x}
          y2={point.y}
          className="stroke-fg"
          strokeWidth={1.2}
          strokeDasharray="3 3"
          initial={{ pathLength: 0 }}
          whileInView={{ pathLength: 1 }}
          viewport={inView}
          transition={{ delay: 1 + index * 0.15, duration: 0.5 }}
        />
      ))}
      <motion.circle
        cx={query.x}
        cy={query.y}
        r={7}
        className="fill-fg stroke-accent"
        strokeWidth={3}
        initial={{ scale: 0 }}
        whileInView={{ scale: 1 }}
        viewport={inView}
        transition={{ delay: 0.8, type: 'spring' }}
      />
      <text x={query.x - 34} y={query.y + 24} className="fill-fg text-[12.5px]">
        your question
      </text>
    </svg>
  )
}

const CODE = [
  'def binary_search(a, x):',
  '    lo, hi = 0, len(a) - 1',
  '    while lo <= hi:',
  '        mid = (lo + hi) // 2',
  '        if a[mid] == x:',
  '            return mid',
  '    return -1',
]

function ChunkingFigure() {
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      <div className="space-y-2">
        <p className="text-sm text-bad">Traditional</p>
        <motion.pre
          className="code-block border-bad/50 text-xs"
          initial={{ y: 0 }}
          whileInView={{ y: -6 }}
          viewport={inView}
          transition={{ delay: 0.6 }}
        >
          {CODE.slice(0, 4).join('\n')}
        </motion.pre>
        <motion.pre
          className="code-block border-bad/50 text-xs"
          initial={{ y: 0 }}
          whileInView={{ y: 6 }}
          viewport={inView}
          transition={{ delay: 0.6 }}
        >
          {CODE.slice(4).join('\n')}
        </motion.pre>
      </div>
      <div className="space-y-2">
        <p className="text-sm text-good">SmartChunk</p>
        <pre className="code-block border-good/50 text-xs">{`## Binary Search\n${CODE.join('\n')}`}</pre>
      </div>
    </div>
  )
}

const FAIRNESS = [
  'Same embedding model (all-MiniLM-L6-v2)',
  'Same ChromaDB settings',
  'Same top-k',
  'Same prompt template',
  'Same LLM',
  'Temperature 0',
  'Same follow-up question rewriting',
]

export default function HowItWorksPage() {
  return (
    <div>
      <PageHeader
        title="How it works"
        description="Four ideas explain why chunking decides the quality of a RAG answer."
        actions={
          <Link to={ROUTES.upload} className="btn btn-primary">
            Try it with a document
          </Link>
        }
      />

      <Concept id="llm" title="LLM" figure={<LlmFigure />}>
        <p>
          A large language model predicts text one token at a time from the words in its prompt. It
          has learned language in general, not your document.
        </p>
        <p>To answer questions about a file, the relevant passages must be put in the prompt.</p>
      </Concept>

      <Concept id="context" title="Context window" figure={<ContextFigure />}>
        <p>
          The context window is the maximum number of tokens the model can read at once. Everything
          in the prompt, including the question and the retrieved chunks, has to fit.
        </p>
        <p>A whole manual won’t fit, so a system has to pick a few pieces.</p>
      </Concept>

      <Concept id="rag" title="RAG" figure={<RagFigure />}>
        <p>
          Retrieval-augmented generation answers in two steps: first it retrieves the chunks most
          similar to the question, then the model writes an answer using only those chunks.
        </p>
        <p>If a code block was cut in half, retrieval can only return half of it.</p>
      </Concept>

      <Concept id="vector" title="Vector database" figure={<VectorFigure />}>
        <p>
          Each chunk is converted into an embedding, a list of numbers that represents its meaning.
          A vector database (ChromaDB here) stores them and finds the nearest ones to the question’s
          embedding.
        </p>
        <p>Similar meaning, nearby points. Retrieval is a nearest-neighbour search.</p>
      </Concept>

      <Concept id="chunking" title="Where SmartChunk differs" figure={<ChunkingFigure />}>
        <p>
          The traditional chunker cuts every N tokens. SmartChunk parses the document first, keeps
          code, tables and lists whole, splits prose where the topic changes, removes repeated
          headers, footers and duplicates, and records each chunk’s heading path and page.
        </p>
      </Concept>

      <section aria-labelledby="fairness" className="py-14">
        <div className="grid gap-8 lg:grid-cols-[1fr_1.1fr]">
          <div className="max-w-lg space-y-3">
            <h2 id="fairness" className="text-2xl font-semibold sm:text-3xl">
              A fair comparison
            </h2>
            <p className="leading-7 text-fg/80">
              Both chatbots share everything except the chunks. If the answers differ, the chunking
              is the reason.
            </p>
          </div>
          <ul className="grid gap-2 sm:grid-cols-2">
            {FAIRNESS.map((rule, index) => (
              <motion.li
                key={rule}
                initial={{ opacity: 0, y: 8 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={inView}
                transition={{ delay: index * 0.06 }}
                className="flex items-center gap-3 rounded-[var(--radius-sm)] border border-good/30 bg-good/[0.04] px-3 py-2.5 text-sm"
              >
                <span aria-hidden="true" className="text-good">
                  ✓
                </span>
                {rule}
              </motion.li>
            ))}
            <motion.li
              initial={{ opacity: 0, y: 8 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={inView}
              transition={{ delay: FAIRNESS.length * 0.06 }}
              className="flex items-center gap-3 rounded-[var(--radius-sm)] border border-accent bg-accent/10 px-3 py-2.5 text-sm font-medium"
            >
              <span aria-hidden="true">≠</span>
              Only the chunking differs
            </motion.li>
          </ul>
        </div>
      </section>
    </div>
  )
}
