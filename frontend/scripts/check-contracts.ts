// npm run check:contract
// Validates every file in ../contracts against the zod schemas the frontend uses at runtime.
// Exits with code 1 if any file is missing, unknown, or does not match its schema.

import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { ZodType } from 'zod'
import {
  ChatResultSchema,
  ChunkPageSchema,
  CompareResultSchema,
  DocSummarySchema,
  DocumentsSchema,
  ErrorEnvelopeSchema,
  EvaluationResultSchema,
  ProcessResultSchema,
  ProcessStartResponseSchema,
  ProcessingStatusSchema,
  SamplesSchema,
  SessionSummarySchema,
  UploadResponseSchema,
} from '../src/api/schemas'

const SCHEMAS: Record<string, ZodType<unknown>> = {
  'upload.json': UploadResponseSchema,
  'process_start.json': ProcessStartResponseSchema,
  'status_running.json': ProcessingStatusSchema,
  'status_done.json': ProcessingStatusSchema,
  'process_result.json': ProcessResultSchema,
  'chunks_page.json': ChunkPageSchema,
  'chat_result_smart.json': ChatResultSchema,
  'chat_result_not_found.json': ChatResultSchema,
  'compare.json': CompareResultSchema,
  'summary.json': DocSummarySchema,
  'session_summary.json': SessionSummarySchema,
  'evaluation.json': EvaluationResultSchema,
  'documents.json': DocumentsSchema,
  'samples.json': SamplesSchema,
  'error.json': ErrorEnvelopeSchema,
}

const contractsDir = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', 'contracts')

if (!existsSync(contractsDir)) {
  console.error(`✕ contracts folder not found at ${contractsDir}`)
  process.exit(1)
}

let failures = 0
const present = new Set(readdirSync(contractsDir).filter((file) => file.endsWith('.json')))

for (const [file, schema] of Object.entries(SCHEMAS)) {
  if (!present.has(file)) {
    console.error(`✕ ${file}: missing (spec A9 requires it)`)
    failures += 1
    continue
  }
  let data: unknown
  try {
    data = JSON.parse(readFileSync(join(contractsDir, file), 'utf8'))
  } catch (error) {
    console.error(
      `✕ ${file}: not valid JSON (${error instanceof Error ? error.message : String(error)})`,
    )
    failures += 1
    continue
  }
  const result = schema.safeParse(data)
  if (result.success) {
    console.log(`✓ ${file}`)
  } else {
    failures += 1
    console.error(`✕ ${file}`)
    for (const issue of result.error.issues) {
      console.error(`    at ${issue.path.join('.') || '(root)'}: ${issue.message}`)
    }
  }
}

for (const file of present) {
  if (!(file in SCHEMAS)) {
    console.error(`✕ ${file}: not part of spec A9 (no schema to check it against)`)
    failures += 1
  }
}

if (failures > 0) {
  console.error(`\n${failures} contract problem(s).`)
  process.exit(1)
}
console.log(`\nAll ${Object.keys(SCHEMAS).length} contract files match the frontend schemas.`)
