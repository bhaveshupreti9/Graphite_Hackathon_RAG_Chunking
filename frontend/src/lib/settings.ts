// Settings defaults, ranges and validation. Values come straight from PART A5.

import type { Settings } from '@/types/api'

export interface SettingMeta {
  key: keyof Settings
  label: string
  help: string
  kind: 'int' | 'float'
  min: number
  max: number
  step: number
}

export const DEFAULT_SETTINGS: Settings = {
  min_chunk_tokens: 80,
  max_chunk_tokens: 300,
  similarity_threshold: 0.45,
  dedup_threshold: 0.95,
  top_k: 5,
  naive_chunk_tokens: 500,
  naive_overlap_tokens: 50,
  not_found_threshold: 0.15,
}

export const SETTINGS_META: readonly SettingMeta[] = [
  {
    key: 'min_chunk_tokens',
    label: 'Smallest chunk (tokens)',
    help: 'Pieces smaller than this are joined to their neighbour. Must be below the largest size.',
    kind: 'int',
    min: 20,
    max: 200,
    step: 1,
  },
  {
    key: 'max_chunk_tokens',
    label: 'Largest chunk (tokens)',
    help: 'Longer text is split at the nearest end of a sentence. Code and tables stay whole.',
    kind: 'int',
    min: 100,
    max: 512,
    step: 1,
  },
  {
    key: 'similarity_threshold',
    label: 'Topic-change sensitivity',
    help: 'Higher means new chunks start more often. Two sentences less similar than this start a new chunk.',
    kind: 'float',
    min: 0,
    max: 1,
    step: 0.01,
  },
  {
    key: 'dedup_threshold',
    label: 'Duplicate strictness',
    help: 'How alike two chunks must be to count as copies. 1.0 removes only exact copies.',
    kind: 'float',
    min: 0.8,
    max: 1,
    step: 0.01,
  },
  {
    key: 'top_k',
    label: 'Passages per answer',
    help: 'How many chunks the chatbot reads before it answers.',
    kind: 'int',
    min: 1,
    max: 10,
    step: 1,
  },
  {
    key: 'naive_chunk_tokens',
    label: 'Fixed chunk size (tokens)',
    help: 'The traditional method cuts the text every this many tokens.',
    kind: 'int',
    min: 100,
    max: 1000,
    step: 1,
  },
  {
    key: 'naive_overlap_tokens',
    label: 'Overlap (tokens)',
    help: 'How much each traditional chunk repeats from the one before. Must be below the chunk size.',
    kind: 'int',
    min: 0,
    max: 200,
    step: 1,
  },
  {
    key: 'not_found_threshold',
    label: '“Not found” cut-off',
    help: 'If even the best passage matches less than this, the chatbot says the answer is not in the file.',
    kind: 'float',
    min: 0,
    max: 1,
    step: 0.01,
  },
]

export type SettingsErrors = Partial<Record<keyof Settings, string>>

/** Returns an error message per invalid field. An empty object means the settings are valid. */
export function validateSettings(settings: Settings): SettingsErrors {
  const errors: SettingsErrors = {}

  for (const meta of SETTINGS_META) {
    const value = settings[meta.key]
    if (typeof value !== 'number' || !Number.isFinite(value)) {
      errors[meta.key] = 'Enter a number.'
    } else if (meta.kind === 'int' && !Number.isInteger(value)) {
      errors[meta.key] = 'Enter a whole number.'
    } else if (value < meta.min || value > meta.max) {
      errors[meta.key] = `Must be between ${meta.min} and ${meta.max}.`
    }
  }

  if (
    !errors.min_chunk_tokens &&
    !errors.max_chunk_tokens &&
    settings.min_chunk_tokens >= settings.max_chunk_tokens
  ) {
    errors.min_chunk_tokens = 'Must be lower than the max chunk tokens.'
  }

  if (
    !errors.naive_overlap_tokens &&
    !errors.naive_chunk_tokens &&
    settings.naive_overlap_tokens >= settings.naive_chunk_tokens
  ) {
    errors.naive_overlap_tokens = 'Must be lower than the naive chunk tokens.'
  }

  return errors
}
