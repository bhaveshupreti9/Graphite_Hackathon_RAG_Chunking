import type { ReactNode } from 'react'
import { cn } from '@/lib/cn'

interface RichTextProps {
  text: string
  className?: string
}

// A small, dependency-free Markdown renderer for model answers. It supports what answers actually
// use: fenced code, tables, headings, bullet and numbered lists, quotes, rules, paragraphs, and
// inline **bold**, *italic*, `code` and [links](https://...). Everything is rendered as React
// elements (never as HTML strings), so model output cannot inject markup.

type Block =
  | { kind: 'code'; text: string }
  | { kind: 'table'; header: string[]; align: Align[]; rows: string[][] }
  | { kind: 'heading'; level: number; text: string }
  | { kind: 'list'; ordered: boolean; start: number; items: { text: string; depth: number }[] }
  | { kind: 'quote'; text: string }
  | { kind: 'rule' }
  | { kind: 'paragraph'; text: string }

type Align = 'left' | 'center' | 'right' | undefined

const FENCE = /^\s*(```|~~~)/
const HEADING = /^\s{0,3}(#{1,6})\s+(.*?)\s*#*\s*$/
const BULLET = /^(\s*)[-*+]\s+(.*)$/
const NUMBERED = /^(\s*)(\d{1,4})[.)]\s+(.*)$/
const QUOTE = /^\s*>\s?(.*)$/
const RULE = /^\s*([-*_])(\s*\1){2,}\s*$/
const TABLE_SEPARATOR = /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/

/** Splits a table row on unescaped pipes; "\|" stays a literal pipe. */
function splitRow(line: string): string[] {
  let row = line.trim()
  if (row.startsWith('|')) row = row.slice(1)
  if (row.endsWith('|') && !row.endsWith('\\|')) row = row.slice(0, -1)
  const cells: string[] = []
  let current = ''
  for (let i = 0; i < row.length; i += 1) {
    const char = row[i]
    if (char === '\\' && row[i + 1] === '|') {
      current += '|'
      i += 1
    } else if (char === '|') {
      cells.push(current.trim())
      current = ''
    } else {
      current += char
    }
  }
  cells.push(current.trim())
  return cells
}

function isTableStart(lines: string[], index: number): boolean {
  const line = lines[index]
  const next = lines[index + 1]
  return (
    line !== undefined &&
    next !== undefined &&
    line.includes('|') &&
    TABLE_SEPARATOR.test(next) &&
    splitRow(line).length >= 2
  )
}

function alignment(cell: string): Align {
  const value = cell.trim()
  if (value.startsWith(':') && value.endsWith(':')) return 'center'
  if (value.endsWith(':')) return 'right'
  if (value.startsWith(':')) return 'left'
  return undefined
}

function startsBlock(lines: string[], index: number): boolean {
  const line = lines[index]
  return (
    FENCE.test(line) ||
    HEADING.test(line) ||
    BULLET.test(line) ||
    NUMBERED.test(line) ||
    QUOTE.test(line) ||
    RULE.test(line) ||
    isTableStart(lines, index)
  )
}

function parseBlocks(text: string): Block[] {
  const lines = text.replace(/\r\n?/g, '\n').split('\n')
  const blocks: Block[] = []
  let i = 0
  while (i < lines.length) {
    const line = lines[i]
    if (line.trim() === '') {
      i += 1
      continue
    }

    const fence = FENCE.exec(line)
    if (fence) {
      const marker = fence[1]
      const body: string[] = []
      i += 1
      while (i < lines.length && !lines[i].trim().startsWith(marker)) {
        body.push(lines[i])
        i += 1
      }
      i += 1 // skip the closing fence (or run past the end of an unclosed one)
      blocks.push({ kind: 'code', text: body.join('\n') })
      continue
    }

    if (isTableStart(lines, i)) {
      const header = splitRow(line)
      const align = splitRow(lines[i + 1]).map(alignment)
      const rows: string[][] = []
      i += 2
      while (i < lines.length && lines[i].includes('|') && lines[i].trim() !== '') {
        const cells = splitRow(lines[i])
        rows.push(header.map((_, column) => cells[column] ?? ''))
        i += 1
      }
      blocks.push({ kind: 'table', header, align, rows })
      continue
    }

    const heading = HEADING.exec(line)
    if (heading) {
      blocks.push({ kind: 'heading', level: heading[1].length, text: heading[2] })
      i += 1
      continue
    }

    if (RULE.test(line)) {
      blocks.push({ kind: 'rule' })
      i += 1
      continue
    }

    if (BULLET.test(line) || NUMBERED.test(line)) {
      const ordered = !BULLET.test(line)
      const first = NUMBERED.exec(line)
      const items: { text: string; depth: number }[] = []
      const baseIndent = (BULLET.exec(line) ?? NUMBERED.exec(line))?.[1].length ?? 0
      while (i < lines.length) {
        const bullet = BULLET.exec(lines[i])
        const numbered = NUMBERED.exec(lines[i])
        if (bullet || numbered) {
          const indent = (bullet ?? numbered)?.[1].length ?? 0
          const content = bullet ? bullet[2] : (numbered?.[3] ?? '')
          items.push({
            text: content,
            depth: Math.min(3, Math.max(0, Math.floor((indent - baseIndent) / 2))),
          })
          i += 1
        } else if (lines[i].trim() !== '' && /^\s{2,}\S/.test(lines[i]) && items.length > 0) {
          items[items.length - 1].text += ` ${lines[i].trim()}` // wrapped continuation line
          i += 1
        } else {
          break
        }
      }
      blocks.push({ kind: 'list', ordered, start: first ? Number(first[2]) : 1, items })
      continue
    }

    if (QUOTE.test(line)) {
      const body: string[] = []
      while (i < lines.length && QUOTE.test(lines[i])) {
        body.push(QUOTE.exec(lines[i])?.[1] ?? '')
        i += 1
      }
      blocks.push({ kind: 'quote', text: body.join('\n') })
      continue
    }

    const body: string[] = []
    while (
      i < lines.length &&
      lines[i].trim() !== '' &&
      !(body.length > 0 && startsBlock(lines, i))
    ) {
      body.push(lines[i].trim())
      i += 1
    }
    blocks.push({ kind: 'paragraph', text: body.join('\n') })
  }
  return blocks
}

const INLINE =
  /(`+)([^`]+?)\1|\*\*(.+?)\*\*|__(.+?)__|(?<![\w*])\*(?!\s)([^*\n]+?)\*(?![\w*])|(?<![\w_])_(?!\s)([^_\n]+?)_(?![\w_])|\[([^\]\n]+)\]\((https?:\/\/[^)\s]+)\)/g

/** Inline Markdown to React nodes. Bold and italic may contain other inline elements. */
function renderInline(text: string, keyPrefix = 'i'): ReactNode[] {
  const nodes: ReactNode[] = []
  let last = 0
  let index = 0
  for (const match of text.matchAll(INLINE)) {
    const start = match.index ?? 0
    if (start > last) nodes.push(text.slice(last, start))
    const key = `${keyPrefix}-${index}`
    index += 1
    if (match[2] !== undefined) {
      nodes.push(
        <code
          key={key}
          className="rounded bg-surface-2 px-1.5 py-0.5 font-mono text-[0.88em] text-fg"
        >
          {match[2].trim()}
        </code>,
      )
    } else if (match[3] !== undefined || match[4] !== undefined) {
      nodes.push(
        <strong key={key} className="font-semibold text-fg">
          {renderInline(match[3] ?? match[4] ?? '', key)}
        </strong>,
      )
    } else if (match[5] !== undefined || match[6] !== undefined) {
      nodes.push(<em key={key}>{renderInline(match[5] ?? match[6] ?? '', key)}</em>)
    } else if (match[7] !== undefined && match[8] !== undefined) {
      nodes.push(
        <a
          key={key}
          href={match[8]}
          target="_blank"
          rel="noreferrer noopener"
          className="text-accent underline underline-offset-2 hover:opacity-80"
        >
          {match[7]}
        </a>,
      )
    }
    last = start + match[0].length
  }
  if (last < text.length) nodes.push(text.slice(last))
  return nodes
}

/** Keeps single line breaks inside a paragraph. */
function withBreaks(text: string, key: string): ReactNode[] {
  return text
    .split('\n')
    .flatMap((line, index) =>
      index === 0
        ? renderInline(line, `${key}-${index}`)
        : [<br key={`${key}-br-${index}`} />, ...renderInline(line, `${key}-${index}`)],
    )
}

const ALIGN_CLASS: Record<string, string> = {
  left: 'text-left',
  center: 'text-center',
  right: 'text-right',
}

function looksNumeric(value: string): boolean {
  return /^[\s(+-]*[₹$€£¥]?\s*[\d.,]+\s*%?\)?\s*$/.test(value) && /\d/.test(value)
}

export function MarkdownTable({
  header,
  rows,
  align = [],
  className,
}: {
  header: string[]
  rows: string[][]
  align?: Align[]
  className?: string
}) {
  // Columns whose cells are all numbers are right-aligned so figures line up.
  const numericColumns = header.map(
    (_, column) =>
      rows.length > 0 && rows.every((row) => row[column] === '' || looksNumeric(row[column] ?? '')),
  )
  const cellAlign = (column: number) =>
    ALIGN_CLASS[align[column] ?? ''] ??
    (numericColumns[column] ? 'text-right tabular-nums' : 'text-left')
  return (
    <div
      className={cn(
        'scrollbar-thin max-w-full overflow-x-auto rounded-[var(--radius-sm)] border border-border',
        className,
      )}
    >
      <table className="w-full border-collapse text-sm leading-6">
        <thead className="bg-surface-2">
          <tr>
            {header.map((cell, column) => (
              <th
                key={column}
                scope="col"
                className={cn(
                  'whitespace-nowrap border-b border-border px-3 py-2 font-semibold text-fg',
                  cellAlign(column),
                )}
              >
                {renderInline(cell, `h${column}`)}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, rowIndex) => (
            <tr
              key={rowIndex}
              className="border-b border-border/60 last:border-0 even:bg-surface-2/40"
            >
              {row.map((cell, column) => (
                <td
                  key={column}
                  className={cn(
                    'px-3 py-2 align-top text-fg/90',
                    cell.length <= 28 && 'whitespace-nowrap', // IDs, dates and names stay on one line
                    cellAlign(column),
                  )}
                >
                  {renderInline(cell, `c${rowIndex}-${column}`)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

/** Renders model answers as formatted Markdown. */
export function RichText({ text, className }: RichTextProps) {
  const blocks = parseBlocks(text)
  return (
    <div className={cn('space-y-3 break-words text-[15px] leading-7', className)}>
      {blocks.map((block, index) => {
        const key = `b${index}`
        switch (block.kind) {
          case 'code':
            return (
              <pre key={key} className="code-block scrollbar-thin">
                {block.text}
              </pre>
            )
          case 'table':
            return (
              <MarkdownTable
                key={key}
                header={block.header}
                rows={block.rows}
                align={block.align}
              />
            )
          case 'heading':
            return (
              <p
                key={key}
                role="heading"
                aria-level={Math.min(6, block.level + 2)}
                className={cn(
                  'font-semibold text-fg',
                  block.level <= 2 ? 'text-base' : 'text-[15px]',
                )}
              >
                {renderInline(block.text, key)}
              </p>
            )
          case 'list': {
            const items = block.items.map((item, itemIndex) => (
              <li
                key={itemIndex}
                className="pl-1 marker:text-muted"
                style={item.depth > 0 ? { marginLeft: `${item.depth * 1.25}rem` } : undefined}
              >
                {renderInline(item.text, `${key}-${itemIndex}`)}
              </li>
            ))
            return block.ordered ? (
              <ol key={key} start={block.start} className="list-decimal space-y-1 pl-6">
                {items}
              </ol>
            ) : (
              <ul key={key} className="list-disc space-y-1 pl-6">
                {items}
              </ul>
            )
          }
          case 'quote':
            return (
              <blockquote key={key} className="border-l-2 border-accent/50 pl-3 text-fg/80">
                {withBreaks(block.text, key)}
              </blockquote>
            )
          case 'rule':
            return <hr key={key} className="border-border" />
          default:
            return <p key={key}>{withBreaks(block.text, key)}</p>
        }
      })}
    </div>
  )
}
