import type { ChunkType, ProcessStep } from '@/types/api'

export const ROUTES = {
  landing: '/',
  upload: '/upload',
  explorer: '/explorer',
  chatSmart: '/chat/smart',
  chatTraditional: '/chat/traditional',
  compareChunks: '/compare/chunks',
  compareAnswers: '/compare/answers',
  visualize: '/visualize',
  summary: '/summary',
  evaluation: '/evaluation',
  knowledge: '/knowledge',
  howItWorks: '/how-it-works',
  login: '/login',
  history: '/history',
} as const

export interface NavItem {
  label: string
  to: string
}

export interface NavGroup {
  label: string
  items: readonly NavItem[]
}

export const NAV_GROUPS: readonly NavGroup[] = [
  {
    label: 'Build',
    items: [
      { label: 'Upload and Process', to: ROUTES.upload },
      { label: 'Chunk Explorer', to: ROUTES.explorer },
      { label: 'Knowledge Base', to: ROUTES.knowledge },
    ],
  },
  {
    label: 'Chat',
    items: [
      { label: 'SmartChunk Chat', to: ROUTES.chatSmart },
      { label: 'Traditional Chat', to: ROUTES.chatTraditional },
    ],
  },
  {
    label: 'Compare',
    items: [
      { label: 'Chunking Visualiser', to: ROUTES.visualize },
      { label: 'Chunking Comparison', to: ROUTES.compareChunks },
      { label: 'Answer Comparison', to: ROUTES.compareAnswers },
    ],
  },
  {
    label: 'Insights',
    items: [
      { label: 'History', to: ROUTES.history },
      { label: 'Session Summary', to: ROUTES.summary },
      { label: 'Evaluation', to: ROUTES.evaluation },
    ],
  },
]

export const NAV_LINKS: readonly NavItem[] = [{ label: 'How It Works', to: ROUTES.howItWorks }]

/** Pipeline steps in order, with the progress value at which each starts (PART A8). */
export const PROCESS_STEPS: readonly { step: ProcessStep; label: string; progress: number }[] = [
  { step: 'uploaded', label: 'Uploaded', progress: 0 },
  { step: 'parsing', label: 'Parsing', progress: 10 },
  { step: 'cleaning', label: 'Cleaning', progress: 25 },
  { step: 'semantic_split', label: 'Semantic split', progress: 40 },
  { step: 'dedup', label: 'Deduplication', progress: 60 },
  { step: 'embedding', label: 'Embedding', progress: 70 },
  { step: 'storing', label: 'Storing', progress: 85 },
  { step: 'summarizing', label: 'Summarizing', progress: 92 },
  { step: 'done', label: 'Done', progress: 100 },
]

export const CHUNK_TYPES: readonly ChunkType[] = ['prose', 'code', 'table', 'list']

export const CHUNK_TYPE_LABELS: Readonly<Record<ChunkType, string>> = {
  prose: 'Prose',
  code: 'Code',
  table: 'Table',
  list: 'List',
}

/** Full class names (not built dynamically) so Tailwind can see them. */
export const CHUNK_TYPE_DOT: Readonly<Record<ChunkType, string>> = {
  prose: 'bg-type-prose',
  code: 'bg-type-code',
  table: 'bg-type-table',
  list: 'bg-type-list',
}

export const CHUNK_TYPE_BORDER: Readonly<Record<ChunkType, string>> = {
  prose: 'border-l-type-prose',
  code: 'border-l-type-code',
  table: 'border-l-type-table',
  list: 'border-l-type-list',
}

export const METHOD_LABELS = { smart: 'SmartChunk', naive: 'Traditional' } as const

/** The chat history sent to the backend never holds more than this many turns (PART A7). */
export const MAX_HISTORY_TURNS = 6
