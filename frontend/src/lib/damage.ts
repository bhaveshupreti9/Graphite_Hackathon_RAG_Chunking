// Per-chunk integrity check used to colour chunks in the comparison views.
// The contract only reports damage as totals (MethodStats.split_*), so this is a UI heuristic on the
// chunk text, documented in INTEGRATION_NOTES.md. Green = intact structure, red = likely split.

import type { Chunk, Method } from '@/types/api'

export type Integrity = 'intact' | 'damaged' | 'neutral'

export interface IntegrityResult {
  status: Integrity
  reason: string
}

const LIST_MARKER = /^\s*([-*+•]|\d+[.)])\s+/
const HEADING = /^\s{0,3}#{1,6}\s/

/**
 * Lines of `text` without Markdown heading lines. Lines inside ``` fences are always kept, so a
 * "# comment" in a bash or Python block is never mistaken for a heading.
 */
export function withoutHeadings(text: string): string[] {
  let inFence = false
  return text.split('\n').filter((line) => {
    if (line.trim().startsWith('```')) {
      inFence = !inFence
      return true
    }
    return inFence || !HEADING.test(line)
  })
}

/** True when the line is a Markdown heading outside any code fence (checked on the last line). */
export function endsWithHeading(text: string): boolean {
  let inFence = false
  let lastIsHeading = false
  for (const line of text.split('\n')) {
    if (line.trim() === '') continue
    if (line.trim().startsWith('```')) inFence = !inFence
    lastIsHeading = !inFence && HEADING.test(line)
  }
  return lastIsHeading
}

function bodyLines(text: string): string[] {
  return withoutHeadings(text).filter((line) => line.trim() !== '')
}

function balanced(text: string): boolean {
  const pairs: Record<string, string> = { ')': '(', ']': '[', '}': '{' }
  const stack: string[] = []
  for (const char of text) {
    if (char === '(' || char === '[' || char === '{') stack.push(char)
    else if (char in pairs) {
      if (stack.pop() !== pairs[char]) return false
    }
  }
  return stack.length === 0
}

function codeProblem(text: string): string | null {
  const fences = (text.match(/```/g) ?? []).length
  if (fences % 2 === 1) return 'Code fence opened or closed in another chunk'
  if (!balanced(text)) return 'Brackets do not balance, so the code continues elsewhere'
  const lines = bodyLines(text)
  const first = lines[0]
  if (first && /^\s{4,}\S/.test(first) && fences === 0)
    return 'Starts in the middle of an indented block'
  return null
}

function tableProblem(text: string): string | null {
  const lines = bodyLines(text)
  const rows = lines.filter((line) => line.trim().startsWith('|'))
  if (rows.length === 0) return null
  const hasSeparator = rows.some((row) => /^\s*\|?\s*:?-{3,}/.test(row))
  if (!hasSeparator) return 'Table rows without their header'
  const last = rows[rows.length - 1] ?? ''
  if (!last.trim().endsWith('|')) return 'Last table row is cut off'
  const firstBody = lines[0] ?? ''
  if (
    !firstBody.trim().startsWith('|') &&
    lines.indexOf(rows[0] ?? '') > 0 &&
    !/[.:!?]$/.test(firstBody.trim())
  ) {
    return 'Table starts mid-chunk after a cut sentence'
  }
  return null
}

function listProblem(text: string): string | null {
  const lines = bodyLines(text)
  const first = lines[0]
  if (first && !LIST_MARKER.test(first) && /^[a-z]/.test(first.trim())) {
    return 'Starts in the middle of a list item'
  }
  return null
}

/** Rates one chunk. SmartChunk structural chunks are intact by construction (spec B4). */
export function assessChunk(chunk: Chunk, method: Method): IntegrityResult {
  if (chunk.type === 'prose') {
    const first = bodyLines(chunk.text)[0]?.trim() ?? ''
    if (method === 'naive' && /^[a-z,;)]/.test(first)) {
      return { status: 'damaged', reason: 'Starts in the middle of a sentence' }
    }
    return { status: 'neutral', reason: 'Prose' }
  }

  const problem =
    chunk.type === 'code'
      ? codeProblem(chunk.text)
      : chunk.type === 'table'
        ? tableProblem(chunk.text)
        : listProblem(chunk.text)

  if (problem) return { status: 'damaged', reason: problem }
  return {
    status: 'intact',
    reason:
      method === 'smart'
        ? `Whole ${chunk.type} block kept together`
        : `${chunk.type[0]?.toUpperCase() ?? ''}${chunk.type.slice(1)} looks complete`,
  }
}

/** Normalised lines for overlap matching between the two chunk sets. */
export function normalisedLines(text: string): string[] {
  return bodyLines(text)
    .map((line) =>
      line
        .replace(/```\w*/g, '')
        .trim()
        .toLowerCase()
        .replace(/\s+/g, ' '),
    )
    .filter((line) => line.length > 9) // ignore generic lines like "else:" or "```"
}
