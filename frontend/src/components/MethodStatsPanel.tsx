import { cn } from '@/lib/cn'
import type { Method, MethodStats } from '@/types/api'
import { StatCard } from './StatCard'
import type { StatTone } from './StatCard'
import { TiltCard } from './TiltCard'
import { MethodBadge } from './TypeBadge'
import { TypeDistribution } from './TypeDistribution'

interface MethodStatsPanelProps {
  method: Method
  stats: MethodStats
  className?: string
}

const damageTone = (value: number): StatTone => (value > 0 ? 'bad' : 'good')

/** Everything ProcessResult says about one chunking method, in plain words. */
export function MethodStatsPanel({ method, stats, className }: MethodStatsPanelProps) {
  const broken = stats.split_code_blocks + stats.split_tables + stats.split_lists
  const removed = stats.exact_duplicates_removed + stats.near_duplicates_removed
  return (
    <TiltCard max={3} className={className}>
      <section
        className={cn(
          'panel h-full space-y-5 p-5',
          method === 'smart' ? 'border-accent/40' : 'border-naive/40',
        )}
      >
        <header className="flex items-center justify-between gap-3">
          <MethodBadge method={method} />
          <span className={cn('text-sm font-medium', broken > 0 ? 'text-bad' : 'text-good')}>
            {broken > 0 ? `Broke ${broken} ${broken === 1 ? 'block' : 'blocks'}` : 'Broke nothing'}
          </span>
        </header>

        <div className="grid grid-cols-2 gap-2">
          <StatCard label="Chunks" value={stats.chunk_count} hint="Pieces the file was cut into" />
          <StatCard
            label="Average chunk size"
            value={stats.avg_tokens}
            digits={0}
            suffix="tokens"
            hint="1 token is about ¾ of a word"
          />
        </div>

        <div className="space-y-1.5">
          <p className="text-xs text-muted">What the chunks contain</p>
          <TypeDistribution counts={stats.type_counts} />
        </div>

        <div className="space-y-1.5">
          <p className="text-xs text-muted">Things cut in half (lower is better)</p>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            <StatCard
              label="Code blocks"
              value={stats.split_code_blocks}
              tone={damageTone(stats.split_code_blocks)}
            />
            <StatCard
              label="Tables"
              value={stats.split_tables}
              tone={damageTone(stats.split_tables)}
            />
            <StatCard
              label="Lists"
              value={stats.split_lists}
              tone={damageTone(stats.split_lists)}
            />
            <StatCard
              label="Lonely headings"
              value={stats.orphan_headings}
              tone={damageTone(stats.orphan_headings)}
              hint="Heading cut off from its text"
            />
          </div>
        </div>

        <div className="space-y-1.5">
          <p className="text-xs text-muted">Clean-up</p>
          <div className="grid grid-cols-3 gap-2">
            <StatCard
              label="Repeats removed"
              value={removed}
              tone={removed > 0 ? 'noise' : 'neutral'}
              hint="Same text appearing twice"
            />
            <StatCard
              label="Headers and footers removed"
              value={stats.noise_lines_removed}
              tone={stats.noise_lines_removed > 0 ? 'noise' : 'neutral'}
            />
            <StatCard
              label="Labels per chunk"
              value={stats.metadata_fields_present}
              hint={method === 'smart' ? 'Section, page, type and more' : 'Only file and page'}
            />
          </div>
        </div>
      </section>
    </TiltCard>
  )
}
