// Reads colour tokens from the CSS variables in index.css so charts and 3D scenes use exactly the
// same colours as the rest of the UI. Nothing here defines a colour of its own except the
// fallbacks, which mirror index.css and are only used if the stylesheet has not loaded.

import type { ChunkType, Method } from '@/types/api'

export type TokenName =
  | 'bg'
  | 'surface'
  | 'surface-2'
  | 'border'
  | 'fg'
  | 'muted'
  | 'accent'
  | 'naive'
  | 'good'
  | 'bad'
  | 'noise'
  | 'type-prose'
  | 'type-code'
  | 'type-table'
  | 'type-list'

const FALLBACK: Readonly<Record<TokenName, string>> = {
  bg: '7 11 22',
  surface: '15 21 38',
  'surface-2': '23 32 54',
  border: '38 48 74',
  fg: '232 236 246',
  muted: '141 151 179',
  accent: '124 108 255',
  naive: '194 112 138',
  good: '61 220 151',
  bad: '255 92 108',
  noise: '124 132 156',
  'type-prose': '46 150 206',
  'type-code': '180 142 16',
  'type-table': '198 91 217',
  'type-list': '207 107 34',
}

const cache = new Map<string, string>()

const currentTheme = (): string =>
  typeof document === 'undefined' ? 'dark' : (document.documentElement.dataset.theme ?? 'dark')

/** Returns the token as a CSS colour string such as "rgb(124, 108, 255)". */
export function token(name: TokenName): string {
  const key = `${currentTheme()}:${name}`
  const cached = cache.get(key)
  if (cached) return cached
  let raw = FALLBACK[name]
  if (typeof window !== 'undefined' && typeof document !== 'undefined') {
    const value = getComputedStyle(document.documentElement).getPropertyValue(`--c-${name}`).trim()
    if (value) raw = value
  }
  const color = `rgb(${raw.split(/\s+/).join(', ')})`
  if (typeof window !== 'undefined') cache.set(key, color)
  return color
}

export const typeToken = (type: ChunkType): TokenName => `type-${type}`

export const methodToken = (method: Method): TokenName => (method === 'smart' ? 'accent' : 'naive')
