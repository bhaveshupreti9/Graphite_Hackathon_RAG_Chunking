// Chunk geometry engine for the visualiser.
//
// Puts both chunk sets of one document on a single "document axis" so the UI can show exactly where
// the traditional chunker's cuts fall relative to SmartChunk's structural blocks.
//   - SmartChunk chunks are the blocks, in document order. Each block's length is its token_count.
//   - Each traditional chunk's start position is found by matching its first lines against the
//     SmartChunk text. When nothing matches (noise-only windows, unusual PDFs), the position is
//     interpolated from token counts. Positions are forced to be non-decreasing.
//   - A cut that lands strictly inside a block splits that block.
// The contract has no character offsets, so positions are approximate. They are exact enough to
// show which blocks were cut and roughly where.

import { withoutHeadings } from '@/lib/damage'
import type { Chunk, ChunkType, RemovedItem } from '@/types/api'

export interface VizBlock {
  index: number
  chunk: Chunk
  start: number
  end: number
  section: string
  sectionIndex: number
  /** Positions of traditional cuts strictly inside this block. */
  cuts: number[]
  /** Cut inside AND no single traditional chunk holds the whole block (spec B4 "split"). */
  split: boolean
  /** Cut inside, but the window overlap kept one complete copy in some traditional chunk. */
  rescuedByOverlap: boolean
  structural: boolean
  /** Traditional chunks that hold part of this block. */
  naiveIndices: number[]
}

export interface VizSegment {
  block: number
  start: number
  end: number
  naiveIndex: number
  /** The segment's top edge is a traditional cut inside its block. */
  cutAbove: boolean
}

export interface VizNaive {
  index: number
  chunk: Chunk
  start: number
  end: number
  /** True when the position came from text matching, false when interpolated. */
  matched: boolean
}

export interface VizCut {
  naiveIndex: number
  pos: number
  block: number | null
  inside: boolean
}

export interface VizNoise {
  item: RemovedItem
  /** The noise sits after this block (-1 = before the first block). */
  afterBlock: number
}

export interface VizSection {
  name: string
  first: number
  last: number
}

export interface VizStats {
  smartCount: number
  naiveCount: number
  structuralBlocks: number
  splitStructuralBlocks: number
  /** Blocks a cut passed through, whether or not the overlap saved them. */
  cutBlocks: number
  splitByType: Record<ChunkType, number>
  blocksByType: Record<ChunkType, number>
  cutsTotal: number
  cutsInsideBlocks: number
  cutsInsideStructural: number
  matchedShare: number
  noiseCount: number
}

export interface VizModel {
  blocks: VizBlock[]
  segments: VizSegment[]
  naive: VizNaive[]
  cuts: VizCut[]
  noise: VizNoise[]
  sections: VizSection[]
  total: number
  stats: VizStats
  /** True when the document was longer than the block limit and was shortened. */
  truncated: boolean
}

export const MAX_BLOCKS = 160
const MAX_NOISE = 40
const EDGE_MARGIN = 0.04 // a cut this close to a block edge counts as landing on the edge
const MIN_LINE = 10 // shorter lines ("else:", "```") are too generic to match on

const emptyTypeCounts = (): Record<ChunkType, number> => ({ prose: 0, code: 0, table: 0, list: 0 })

function normaliseLine(line: string): string {
  return line
    .replace(/```\w*/g, '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ')
}

interface IndexedLine {
  text: string
  /** Fraction of the block's text before this line starts. */
  at: number
}

function indexLines(text: string): { lines: IndexedLine[]; chars: number } {
  const raw = text.split('\n').map(normaliseLine)
  const chars = raw.reduce((sum, line) => sum + line.length + 1, 0) || 1
  let offset = 0
  const lines: IndexedLine[] = []
  for (const line of raw) {
    if (line.length >= MIN_LINE) lines.push({ text: line, at: offset / chars })
    offset += line.length + 1
  }
  return { lines, chars }
}

const collapse = (text: string): string => text.toLowerCase().replace(/\s+/g, ' ').trim()

function chunkOrder(chunk: Chunk): number {
  const match = /_(\d{4,})$/.exec(chunk.chunk_id)
  return match ? Number(match[1]) : Number.MAX_SAFE_INTEGER
}

/** Builds the visualiser model. Never throws on odd input; empty input gives an empty model. */
export function buildVizModel(
  smartInput: Chunk[],
  naiveInput: Chunk[],
  removed: RemovedItem[],
  maxBlocks = MAX_BLOCKS,
): VizModel {
  const smartSorted = [...smartInput].sort((a, b) => chunkOrder(a) - chunkOrder(b))
  const naiveSorted = [...naiveInput].sort((a, b) => chunkOrder(a) - chunkOrder(b))
  const truncated = smartSorted.length > maxBlocks
  const smart = smartSorted.slice(0, maxBlocks)

  // 1. Blocks on the document axis.
  const blocks: VizBlock[] = []
  const sections: VizSection[] = []
  let cursor = 0
  smart.forEach((chunk, index) => {
    const length = Math.max(1, chunk.token_count)
    const section = chunk.heading_path[0] ?? 'Untitled section'
    const previous = sections[sections.length - 1]
    if (!previous || previous.name !== section) {
      sections.push({ name: section, first: index, last: index })
    } else {
      previous.last = index
    }
    blocks.push({
      index,
      chunk,
      start: cursor,
      end: cursor + length,
      section,
      sectionIndex: sections.length - 1,
      cuts: [],
      split: false,
      rescuedByOverlap: false,
      structural: chunk.type !== 'prose',
      naiveIndices: [],
    })
    cursor += length
  })
  const total = cursor

  // 2. Where each traditional chunk starts.
  const indexed = blocks.map((block) => indexLines(block.chunk.text))
  const naiveTokenTotal =
    naiveSorted.reduce((sum, chunk) => sum + Math.max(1, chunk.token_count), 0) || 1
  const naive: VizNaive[] = []
  let searchFrom = 0
  let naiveTokensBefore = 0
  let matchedCount = 0

  naiveSorted.forEach((chunk, index) => {
    const interpolated = (naiveTokensBefore / naiveTokenTotal) * total
    naiveTokensBefore += Math.max(1, chunk.token_count)
    let position: number | null = index === 0 ? 0 : null

    if (position === null && blocks.length > 0) {
      const candidateLines = chunk.text
        .split('\n')
        .map(normaliseLine)
        .filter((line) => line.length >= MIN_LINE)
        .slice(0, 8)
      const firstBlock = Math.max(0, searchFrom - 1)
      outer: for (const naiveLine of candidateLines) {
        for (let b = firstBlock; b < Math.min(blocks.length, firstBlock + 60); b += 1) {
          const block = blocks[b]
          const info = indexed[b]
          if (!block || !info) continue
          for (const line of info.lines) {
            if (line.text === naiveLine || line.text.includes(naiveLine)) {
              // A partial first line ("lling functions") starts part-way into the smart line.
              const into = line.text.length - naiveLine.length
              const fraction = Math.min(1, line.at + Math.max(0, into) / info.chars)
              position = block.start + fraction * (block.end - block.start)
              searchFrom = b
              break outer
            }
          }
        }
      }
    }

    const matched = position !== null
    if (matched) matchedCount += 1
    let start = position ?? interpolated
    const previous = naive[naive.length - 1]
    if (previous) start = Math.max(start, previous.start)
    start = Math.min(start, total)
    naive.push({ index, chunk, start, end: total, matched })
  })
  naive.forEach((item, index) => {
    const next = naive[index + 1]
    item.end = next ? next.start : total
  })
  const visibleNaive = naive.filter((item) => item.start < total || item.index === 0)

  // 3. Cuts: the start of every traditional chunk after the first.
  const cuts: VizCut[] = []
  for (const item of visibleNaive) {
    if (item.index === 0) continue
    const block = blocks.find(
      (candidate) => item.start > candidate.start && item.start < candidate.end,
    )
    if (!block) {
      cuts.push({ naiveIndex: item.index, pos: item.start, block: null, inside: false })
      continue
    }
    const length = block.end - block.start
    const inside =
      item.start - block.start > length * EDGE_MARGIN &&
      block.end - item.start > length * EDGE_MARGIN
    cuts.push({ naiveIndex: item.index, pos: item.start, block: block.index, inside })
    if (inside && !block.cuts.some((existing) => Math.abs(existing - item.start) < length * 0.01)) {
      block.cuts.push(item.start)
    }
  }
  const naiveTexts = visibleNaive.map((item) => collapse(item.chunk.text))
  blocks.forEach((block) => {
    block.cuts.sort((a, b) => a - b)
    if (block.cuts.length === 0) return
    const body = collapse(withoutHeadings(block.chunk.text).join('\n'))
    const whole = body !== '' && naiveTexts.some((text) => text.includes(body))
    block.split = !whole
    block.rescuedByOverlap = whole
  })

  // 4. Segments: blocks sliced at their cuts, each tagged with the traditional chunk it lands in.
  const naiveAt = (pos: number): number => {
    let found = 0
    for (const item of visibleNaive) {
      if (item.start <= pos + 1e-6) found = item.index
      else break
    }
    return found
  }
  const segments: VizSegment[] = []
  for (const block of blocks) {
    const edges = [block.start, ...block.cuts, block.end]
    for (let i = 0; i < edges.length - 1; i += 1) {
      const start = edges[i] ?? block.start
      const end = edges[i + 1] ?? block.end
      if (end - start <= 0) continue
      const naiveIndex = naiveAt(start)
      segments.push({ block: block.index, start, end, naiveIndex, cutAbove: i > 0 })
      if (!block.naiveIndices.includes(naiveIndex)) block.naiveIndices.push(naiveIndex)
    }
  }

  // 5. Removed noise, placed by page (or spread evenly when pages are unknown).
  const noiseItems = removed.slice(0, MAX_NOISE)
  const noise: VizNoise[] = noiseItems.map((item, i) => {
    if (item.page !== null && blocks.length > 0) {
      let afterBlock = -1
      blocks.forEach((block) => {
        if (block.chunk.page !== null && block.chunk.page <= item.page!) afterBlock = block.index
      })
      return { item, afterBlock }
    }
    return { item, afterBlock: Math.round(((i + 1) / (noiseItems.length + 1)) * blocks.length) - 1 }
  })

  // 6. Stats.
  const splitByType = emptyTypeCounts()
  const blocksByType = emptyTypeCounts()
  blocks.forEach((block) => {
    blocksByType[block.chunk.type] += 1
    if (block.split) splitByType[block.chunk.type] += 1
  })
  const insideCuts = cuts.filter((cut) => cut.inside)
  const stats: VizStats = {
    smartCount: blocks.length,
    naiveCount: visibleNaive.length,
    structuralBlocks: blocks.filter((block) => block.structural).length,
    splitStructuralBlocks: blocks.filter((block) => block.structural && block.split).length,
    cutBlocks: blocks.filter((block) => block.cuts.length > 0).length,
    splitByType,
    blocksByType,
    cutsTotal: cuts.length,
    cutsInsideBlocks: insideCuts.length,
    cutsInsideStructural: insideCuts.filter((cut) => {
      const block = cut.block === null ? undefined : blocks[cut.block]
      return block?.structural ?? false
    }).length,
    matchedShare: naive.length > 1 ? (matchedCount - 1) / (naive.length - 1) : 1,
    noiseCount: noise.length,
  }

  return { blocks, segments, naive: visibleNaive, cuts, noise, sections, total, stats, truncated }
}
