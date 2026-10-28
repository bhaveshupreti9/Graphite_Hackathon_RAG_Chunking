import { useCallback, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  Bar,
  BarChart,
  CartesianGrid,
  LabelList,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import type { TooltipProps } from 'recharts'
import { getEvaluation } from '@/api/client'
import { EmptyState } from '@/components/EmptyState'
import { ErrorState } from '@/components/ErrorState'
import { Expander } from '@/components/Expander'
import { LoadingState } from '@/components/LoadingState'
import { PageHeader } from '@/components/PageHeader'
import { StatCard } from '@/components/StatCard'
import { useAsync } from '@/hooks/useAsync'
import { cn } from '@/lib/cn'
import { CHUNK_TYPES, CHUNK_TYPE_LABELS, ROUTES } from '@/lib/constants'
import { formatDate } from '@/lib/format'
import { token } from '@/lib/palette'
import type { EvaluationResult, PRF } from '@/types/api'

interface Row {
  name: string
  smart: number
  naive: number
}

type ValueKind = 'score' | 'count'

function ChartTooltip({
  active,
  payload,
  label,
  kind,
}: TooltipProps<number, string> & { kind: ValueKind }) {
  if (!active || !payload || payload.length === 0) return null
  return (
    <div className="rounded-[var(--radius-sm)] border border-border bg-surface px-3 py-2 text-xs shadow-xl">
      <p className="mb-1 font-medium text-fg">{label}</p>
      {payload.map((entry) => (
        <p key={String(entry.dataKey)} className="flex items-center gap-2 text-muted">
          <span
            aria-hidden="true"
            className="h-2 w-2 rounded-full"
            style={{ backgroundColor: entry.color }}
          />
          {entry.name}
          <span className="ml-auto pl-3 tabular-nums text-fg">
            {typeof entry.value === 'number'
              ? kind === 'score'
                ? entry.value.toFixed(2)
                : entry.value
              : ''}
          </span>
        </p>
      ))}
    </div>
  )
}

function MethodBars({
  data,
  kind,
  labels = false,
  height = 260,
}: {
  data: Row[]
  kind: ValueKind
  labels?: boolean
  height?: number
}) {
  const colors = useMemo(
    () => ({
      smart: token('accent'),
      naive: token('naive'),
      muted: token('muted'),
      border: token('border'),
      fg: token('fg'),
    }),
    [],
  )
  return (
    <div style={{ height }} className="w-full">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart
          data={data}
          barGap={2}
          barCategoryGap="28%"
          margin={{ top: labels ? 22 : 8, right: 8, left: -12, bottom: 0 }}
        >
          <CartesianGrid
            vertical={false}
            stroke={colors.border}
            strokeDasharray="0"
            strokeOpacity={0.6}
          />
          <XAxis
            dataKey="name"
            tickLine={false}
            axisLine={{ stroke: colors.border }}
            tick={{ fill: colors.muted, fontSize: 13 }}
          />
          <YAxis
            tickLine={false}
            axisLine={false}
            tick={{ fill: colors.muted, fontSize: 13 }}
            domain={kind === 'score' ? [0, 1] : [0, 'auto']}
            ticks={kind === 'score' ? [0, 0.2, 0.4, 0.6, 0.8, 1] : undefined}
            allowDecimals={kind === 'score'}
            tickFormatter={(value: number) => (kind === 'score' ? value.toFixed(1) : String(value))}
          />
          <Tooltip
            cursor={{ fill: colors.border, fillOpacity: 0.25 }}
            content={<ChartTooltip kind={kind} />}
          />
          <Legend
            verticalAlign="top"
            align="right"
            iconType="circle"
            iconSize={8}
            wrapperStyle={{ fontSize: 13, color: colors.muted, paddingBottom: 8 }}
          />
          <Bar
            dataKey="naive"
            name="Traditional"
            fill={colors.naive}
            radius={[4, 4, 0, 0]}
            maxBarSize={40}
          >
            {labels ? (
              <LabelList
                dataKey="naive"
                position="top"
                fill={colors.muted}
                fontSize={13}
                formatter={(value: number) => (kind === 'score' ? value.toFixed(2) : value)}
              />
            ) : null}
          </Bar>
          <Bar
            dataKey="smart"
            name="SmartChunk"
            fill={colors.smart}
            radius={[4, 4, 0, 0]}
            maxBarSize={40}
          >
            {labels ? (
              <LabelList
                dataKey="smart"
                position="top"
                fill={colors.fg}
                fontSize={13}
                formatter={(value: number) => (kind === 'score' ? value.toFixed(2) : value)}
              />
            ) : null}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  )
}

function DataTable({ rows, kind }: { rows: Row[]; kind: ValueKind }) {
  const format = (value: number) => (kind === 'score' ? value.toFixed(2) : String(value))
  return (
    <table className="w-full text-sm">
      <thead className="text-xs text-muted">
        <tr>
          <th scope="col" className="py-1.5 text-left font-medium">
            Measure
          </th>
          <th scope="col" className="py-1.5 text-right font-medium">
            Traditional
          </th>
          <th scope="col" className="py-1.5 text-right font-medium">
            SmartChunk
          </th>
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => (
          <tr key={row.name} className="border-t border-border/60">
            <th scope="row" className="py-1.5 text-left font-normal">
              {row.name}
            </th>
            <td className="py-1.5 text-right tabular-nums">{format(row.naive)}</td>
            <td className="py-1.5 text-right tabular-nums">{format(row.smart)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}

function ChartPanel({
  title,
  description,
  rows,
  kind,
  labels,
  className,
}: {
  title: string
  description: string
  rows: Row[]
  kind: ValueKind
  labels?: boolean
  className?: string
}) {
  return (
    <section className={cn('panel space-y-3 p-5', className)}>
      <div>
        <h2 className="text-lg font-semibold">{title}</h2>
        <p className="text-sm text-muted">{description}</p>
      </div>
      <MethodBars data={rows} kind={kind} labels={labels} />
      <Expander label="View as table">
        <DataTable rows={rows} kind={kind} />
      </Expander>
    </section>
  )
}

function PRFRow({ label, prf }: { label: string; prf: PRF }) {
  return (
    <tr className="border-t border-border/60">
      <th scope="row" className="py-2 text-left font-medium">
        {label}
      </th>
      <td className="py-2 text-right tabular-nums">{prf.precision.toFixed(2)}</td>
      <td className="py-2 text-right tabular-nums">{prf.recall.toFixed(2)}</td>
      <td className="py-2 text-right tabular-nums">{prf.f1.toFixed(2)}</td>
    </tr>
  )
}

function Results({ data }: { data: EvaluationResult }) {
  const [byTypeMetric, setByTypeMetric] = useState<'recall_at_5' | 'mrr'>('recall_at_5')
  const headline: Row[] = [
    {
      name: 'Found it (Recall@5)',
      smart: data.methods.smart.recall_at_5,
      naive: data.methods.naive.recall_at_5,
    },
    { name: 'Ranked first (MRR)', smart: data.methods.smart.mrr, naive: data.methods.naive.mrr },
  ]
  const byType: Row[] = CHUNK_TYPES.map((type) => ({
    name: CHUNK_TYPE_LABELS[type],
    smart: data.methods.smart.by_type[type][byTypeMetric],
    naive: data.methods.naive.by_type[type][byTypeMetric],
  }))
  const damage: Row[] = [
    {
      name: 'Code blocks',
      smart: data.damage.smart.split_code_blocks,
      naive: data.damage.naive.split_code_blocks,
    },
    {
      name: 'Tables',
      smart: data.damage.smart.split_tables,
      naive: data.damage.naive.split_tables,
    },
    {
      name: 'Repeated chunks',
      smart: data.damage.smart.duplicates,
      naive: data.damage.naive.duplicates,
    },
    {
      name: 'Junk chunks',
      smart: data.damage.smart.noise_chunks,
      naive: data.damage.naive.noise_chunks,
    },
  ]
  const recallGain = data.methods.smart.recall_at_5 - data.methods.naive.recall_at_5

  return (
    <div className="space-y-8">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <StatCard
          label="SmartChunk found the right passage"
          value={data.methods.smart.recall_at_5 * 100}
          suffix="% of questions"
          tone="good"
          hint="Recall@5"
        />
        <StatCard
          label="Traditional found the right passage"
          value={data.methods.naive.recall_at_5 * 100}
          suffix="% of questions"
          hint="Recall@5"
        />
        <StatCard
          label="Difference"
          value={recallGain * 100}
          digits={0}
          suffix="points"
          tone={recallGain > 0 ? 'good' : recallGain < 0 ? 'bad' : 'neutral'}
        />
        <StatCard label="Test questions" value={data.questions_count} />
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <ChartPanel
          title="Did the chatbot find the right passage?"
          description="Found it: how often the passage holding the answer was among the 5 the chatbot read. Ranked first: how close to the top it was (1.0 means always first). Higher is better."
          rows={headline}
          kind="score"
          labels
        />
        <ChartPanel
          title="Things cut in half"
          description="Across all test documents. Lower is better."
          rows={damage}
          kind="count"
          labels
        />
      </div>

      <section className="panel space-y-3 p-5">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <h2 className="text-lg font-semibold">Results by chunk type</h2>
            <p className="text-sm text-muted">
              Where the answer passage is code, a table, a list or prose.
            </p>
          </div>
          <div
            role="group"
            aria-label="Metric"
            className="inline-flex rounded-[var(--radius-sm)] border border-border p-0.5"
          >
            {(
              [
                ['recall_at_5', 'Found it'],
                ['mrr', 'Ranked first'],
              ] as const
            ).map(([value, label]) => (
              <button
                key={value}
                type="button"
                aria-pressed={byTypeMetric === value}
                onClick={() => setByTypeMetric(value)}
                className={cn(
                  'rounded-[calc(var(--radius-sm)-2px)] px-3 py-1 text-sm',
                  byTypeMetric === value ? 'bg-surface-2 text-fg' : 'text-muted hover:text-fg',
                )}
              >
                {label}
              </button>
            ))}
          </div>
        </div>
        <MethodBars data={byType} kind="score" height={280} />
        <Expander label="View as table">
          <DataTable rows={byType} kind="score" />
        </Expander>
      </section>

      {data.classifier ? (
        <section className="panel space-y-3 p-5">
          <div>
            <h2 className="text-lg font-semibold">Boundary classifier</h2>
            <p className="text-sm text-muted">
              Topic-boundary detection on {data.classifier.test_pairs.toLocaleString('en-US')}{' '}
              held-out sentence pairs: the similarity threshold versus the trained logistic
              regression.
            </p>
          </div>
          <table className="w-full max-w-xl text-sm">
            <thead className="text-xs text-muted">
              <tr>
                <th scope="col" className="py-2 text-left font-medium">
                  Method
                </th>
                <th scope="col" className="py-2 text-right font-medium">
                  Precision
                </th>
                <th scope="col" className="py-2 text-right font-medium">
                  Recall
                </th>
                <th scope="col" className="py-2 text-right font-medium">
                  F1
                </th>
              </tr>
            </thead>
            <tbody>
              <PRFRow label="Similarity threshold" prf={data.classifier.threshold} />
              <PRFRow label="Trained classifier" prf={data.classifier.trained} />
            </tbody>
          </table>
        </section>
      ) : null}
    </div>
  )
}

export default function EvaluationPage() {
  const loader = useCallback(() => getEvaluation(), [])
  const evaluation = useAsync(loader)

  return (
    <div className="space-y-8">
      <PageHeader
        title="Evaluation"
        description="Both chatbots were tested on the same fixed set of questions with known answers, so these numbers don’t depend on what you asked."
        meta={
          evaluation.data ? (
            <>
              <span className="chip">{evaluation.data.questions_count} questions</span>
              <span className="chip">{evaluation.data.documents.length} documents</span>
              <span className="chip">Generated {formatDate(evaluation.data.generated_at)}</span>
            </>
          ) : undefined
        }
      />

      {evaluation.status === 'loading' && !evaluation.data ? (
        <LoadingState label="Loading evaluation results…" />
      ) : null}

      {evaluation.status === 'error' ? (
        evaluation.error.code === 'EVAL_NOT_AVAILABLE' ? (
          <EmptyState
            title="No evaluation results yet"
            description={
              <>
                Run{' '}
                <code className="rounded bg-surface-2 px-1.5 py-0.5 text-fg">
                  python -m eval.run_eval
                </code>{' '}
                on the backend to create{' '}
                <code className="rounded bg-surface-2 px-1.5 py-0.5 text-fg">
                  eval/results.json
                </code>
                , then reload this page.
              </>
            }
            action={
              <>
                <button type="button" className="btn btn-primary" onClick={evaluation.reload}>
                  Check again
                </button>
                <Link to={ROUTES.compareAnswers} className="btn">
                  Compare answers instead
                </Link>
              </>
            }
          />
        ) : (
          <ErrorState
            error={evaluation.error}
            onRetry={evaluation.reload}
            title="Evaluation results didn’t load"
          />
        )
      ) : null}

      {evaluation.status === 'success' ? (
        evaluation.data.questions_count === 0 ? (
          <EmptyState
            title="The evaluation has no questions"
            description="eval/results.json exists but contains no evaluated questions."
          />
        ) : (
          <>
            {evaluation.data.documents.length > 0 ? (
              <p className="text-sm text-muted">
                Documents:{' '}
                <span className="text-fg/80">{evaluation.data.documents.join(', ')}</span>
              </p>
            ) : null}
            <Results data={evaluation.data} />
          </>
        )
      ) : null}
    </div>
  )
}
