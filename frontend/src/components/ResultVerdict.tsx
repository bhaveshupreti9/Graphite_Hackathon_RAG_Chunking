import type { MethodStats } from '@/types/api'

interface ResultVerdictProps {
  smart: MethodStats
  naive: MethodStats
}

const plural = (count: number, one: string, many: string): string => (count === 1 ? one : many)

/** One plain-language sentence about what happened, followed by up to three facts. */
export function ResultVerdict({ smart, naive }: ResultVerdictProps) {
  const naiveBroken = naive.split_code_blocks + naive.split_tables + naive.split_lists
  const smartBroken = smart.split_code_blocks + smart.split_tables + smart.split_lists
  const structural = smart.type_counts.code + smart.type_counts.table + smart.type_counts.list
  const cleaned =
    smart.noise_lines_removed + smart.exact_duplicates_removed + smart.near_duplicates_removed

  const headline =
    naiveBroken === 0 && smartBroken === 0
      ? 'Neither method cut a code block, table or list in half in this document.'
      : smartBroken === 0
        ? `The traditional method cut ${naiveBroken} ${plural(naiveBroken, 'code block, table or list', 'code blocks, tables or lists')} in half. SmartChunk kept every one whole.`
        : `The traditional method cut ${naiveBroken} ${plural(naiveBroken, 'block', 'blocks')} in half; SmartChunk cut ${smartBroken} very large ${plural(smartBroken, 'block', 'blocks')} at safe points.`

  const facts = [
    structural > 0
      ? `This file has ${structural} ${plural(structural, 'piece', 'pieces')} of structure (code, tables, lists). A chatbot answers best when each one stays in a single chunk.`
      : null,
    cleaned > 0
      ? `SmartChunk removed ${cleaned} repeated ${plural(cleaned, 'line or passage', 'lines and passages')} (page headers, footers, copies) so they don't crowd out real content.`
      : null,
    'Every SmartChunk chunk knows its section and page, so answers can say where they came from.',
  ].filter((fact): fact is string => fact !== null)

  return (
    <div className="panel space-y-3 border-accent/30 bg-accent/[0.04] p-5">
      <p className="text-lg font-semibold leading-snug">{headline}</p>
      <ul className="space-y-1.5 text-sm text-fg/80">
        {facts.map((fact) => (
          <li key={fact} className="flex gap-2">
            <span aria-hidden="true" className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-accent" />
            {fact}
          </li>
        ))}
      </ul>
    </div>
  )
}
