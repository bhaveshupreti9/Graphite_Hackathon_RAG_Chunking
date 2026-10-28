// The illustrative "document" used by the landing hero (3D and 2D fallback). Pure data, no three.js,
// so the 2D fallback can import it without pulling WebGL code into the main bundle.

import type { ChunkType } from '@/types/api'

export interface DocBlock {
  type: ChunkType
  /** Width and height in document units. */
  w: number
  h: number
  /** Index into SECTIONS. */
  section: number
}

export const SECTIONS = ['Introduction', 'Data types', 'Algorithms', 'Errors'] as const

export const BLOCKS: readonly DocBlock[] = [
  { type: 'prose', w: 3.1, h: 0.5, section: 0 },
  { type: 'list', w: 2.5, h: 0.85, section: 0 },
  { type: 'prose', w: 3.3, h: 0.6, section: 1 },
  { type: 'code', w: 2.8, h: 1.15, section: 1 },
  { type: 'table', w: 3.3, h: 0.95, section: 1 },
  { type: 'prose', w: 3.0, h: 0.5, section: 2 },
  { type: 'code', w: 2.7, h: 1.25, section: 2 },
  { type: 'list', w: 2.4, h: 0.75, section: 2 },
  { type: 'table', w: 3.3, h: 1.0, section: 2 },
  { type: 'prose', w: 2.9, h: 0.5, section: 3 },
  { type: 'code', w: 2.6, h: 0.95, section: 3 },
]

export const BLOCK_GAP = 0.14
export const SECTION_GAP = 0.55
/** Distance between the naive chunker's blind cuts, in document units. */
export const CUT_SPACING = 1.3
export const MAX_W = Math.max(...BLOCKS.map((block) => block.w))

export interface DocLayout {
  /** Distance from the top of the document to the top of each block. */
  tops: number[]
  height: number
}

export function layoutDoc(sectionGap: number): DocLayout {
  const tops: number[] = []
  let cursor = 0
  BLOCKS.forEach((block, index) => {
    const previous = BLOCKS[index - 1]
    if (index > 0) cursor += previous && previous.section !== block.section ? sectionGap : BLOCK_GAP
    tops.push(cursor)
    cursor += block.h
  })
  return { tops, height: cursor }
}

export const COLUMN = layoutDoc(BLOCK_GAP)
export const GROUPED = layoutDoc(SECTION_GAP)

/**
 * Where a blind cut line crosses each block (offset from the block's top), or null when no cut
 * lands inside it. Computed on the plain column layout.
 */
export const CUTS: readonly (number | null)[] = BLOCKS.map((block, index) => {
  const top = COLUMN.tops[index] ?? 0
  for (let line = CUT_SPACING; line < COLUMN.height; line += CUT_SPACING) {
    if (line > top + 0.1 && line < top + block.h - 0.1) return line - top
  }
  return null
})

export interface SectionBounds {
  top: number
  bottom: number
}

export function sectionBounds(layout: DocLayout): SectionBounds[] {
  return SECTIONS.map((_, section) => {
    let top = Infinity
    let bottom = -Infinity
    BLOCKS.forEach((block, index) => {
      if (block.section !== section) return
      const blockTop = layout.tops[index] ?? 0
      top = Math.min(top, blockTop)
      bottom = Math.max(bottom, blockTop + block.h)
    })
    return { top, bottom }
  })
}

/** Deterministic pseudo-random number in [0, 1). */
export function rand(index: number, salt: number): number {
  const value = Math.sin(index * 12.9898 + salt * 78.233) * 43758.5453
  return value - Math.floor(value)
}
