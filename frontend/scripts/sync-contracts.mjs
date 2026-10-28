// Copies ../contracts/*.json into src/api/contracts so the mock layer imports the exact files
// the backend tests use. Runs automatically before `npm run dev` and `npm run build`.
import { cpSync, existsSync, mkdirSync, readdirSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const frontendRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const source = resolve(frontendRoot, '..', 'contracts')
const destination = join(frontendRoot, 'src', 'api', 'contracts')

if (!existsSync(source)) {
  console.warn(`[sync-contracts] ${source} not found, keeping the existing copies.`)
  process.exit(0)
}

mkdirSync(destination, { recursive: true })

let copied = 0
for (const file of readdirSync(source)) {
  if (file.endsWith('.json')) {
    cpSync(join(source, file), join(destination, file))
    copied += 1
  }
}

console.log(`[sync-contracts] copied ${copied} file(s) to src/api/contracts`)
