import { cn } from '@/lib/cn'
import { DEFAULT_SETTINGS, SETTINGS_META } from '@/lib/settings'
import type { SettingsErrors } from '@/lib/settings'
import type { Settings } from '@/types/api'

interface SettingsFormProps {
  value: Settings
  errors: SettingsErrors
  disabled?: boolean
  onChange: (next: Settings) => void
}

const GROUPS: { title: string; keys: (keyof Settings)[] }[] = [
  {
    title: 'SmartChunk',
    keys: ['min_chunk_tokens', 'max_chunk_tokens', 'similarity_threshold', 'dedup_threshold'],
  },
  { title: 'Traditional', keys: ['naive_chunk_tokens', 'naive_overlap_tokens'] },
  { title: 'Retrieval (both)', keys: ['top_k', 'not_found_threshold'] },
]

/** All eight fields from spec A5 with their defaults, ranges and inline validation. */
export function SettingsForm({ value, errors, disabled = false, onChange }: SettingsFormProps) {
  const changed = SETTINGS_META.some((meta) => value[meta.key] !== DEFAULT_SETTINGS[meta.key])

  return (
    <div className="space-y-6">
      {GROUPS.map((group) => (
        <fieldset key={group.title} className="space-y-3" disabled={disabled}>
          <legend className="mb-2 text-sm font-semibold text-fg">{group.title}</legend>
          <div className="grid gap-4 sm:grid-cols-2">
            {group.keys.map((key) => {
              const meta = SETTINGS_META.find((item) => item.key === key)
              if (!meta) return null
              const id = `setting-${key}`
              const error = errors[key]
              const current = value[key]
              return (
                <div key={key} className="space-y-1.5">
                  <div className="flex items-baseline justify-between gap-2">
                    <label htmlFor={id} className="label">
                      {meta.label}
                    </label>
                    <span className="text-xs text-muted tabular-nums">
                      {meta.min} to {meta.max}
                    </span>
                  </div>
                  <div className="flex items-center gap-3">
                    <input
                      type="range"
                      aria-hidden="true"
                      tabIndex={-1}
                      min={meta.min}
                      max={meta.max}
                      step={meta.step}
                      value={Number.isFinite(current) ? current : meta.min}
                      onChange={(event) =>
                        onChange({ ...value, [key]: Number(event.target.value) })
                      }
                      className="h-1 flex-1 cursor-pointer accent-[rgb(var(--c-accent))]"
                    />
                    <input
                      id={id}
                      type="number"
                      inputMode={meta.kind === 'int' ? 'numeric' : 'decimal'}
                      min={meta.min}
                      max={meta.max}
                      step={meta.step}
                      value={Number.isFinite(current) ? current : ''}
                      aria-invalid={error ? true : undefined}
                      aria-describedby={`${id}-help`}
                      onChange={(event) =>
                        onChange({
                          ...value,
                          [key]:
                            event.target.value === '' ? Number.NaN : Number(event.target.value),
                        })
                      }
                      className={cn('input w-24 text-right tabular-nums', error && 'border-bad')}
                    />
                  </div>
                  <p id={`${id}-help`} className={cn('text-xs', error ? 'text-bad' : 'text-muted')}>
                    {error ?? meta.help}
                  </p>
                </div>
              )
            })}
          </div>
        </fieldset>
      ))}
      {changed ? (
        <button
          type="button"
          className="btn btn-ghost px-3 py-1.5"
          disabled={disabled}
          onClick={() => onChange(DEFAULT_SETTINGS)}
        >
          Reset to defaults
        </button>
      ) : null}
    </div>
  )
}
