// check-imports.mjs — build-time guard against a runtime ERR_MODULE_NOT_FOUND.
//
// The Dockerfile assembles the runtime image by copying files; a module that is
// imported but not present (Dockerfile omission, or a file that was never
// committed) does not fail the build — it crashes the server at boot, which only
// surfaces at the Railway healthcheck, AFTER the old container may be gone. That
// is how the site went down once. This script makes that failure a BUILD failure
// instead: it walks server.mjs's local import graph and asserts every referenced
// file is actually on disk. Run it in the Dockerfile's runtime stage right after
// the COPYs — a missing module then fails `docker build`, the deploy is rejected,
// and Railway keeps serving the last healthy container.
//
//   node tools/check-imports.mjs [entry.mjs ...]   (defaults to server.mjs)
import { existsSync } from 'node:fs'
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'

// Match static `from '...'` and dynamic `import('...')` specifiers.
const SPEC_RE = /(?:from|import)\s*\(?\s*['"]([^'"]+)['"]/g

/** Local (relative) specifiers only — bare specifiers are npm deps, resolved by node. */
const isLocal = (s) => s.startsWith('./') || s.startsWith('../')

function scan(entry, seen, problems) {
  const abs = resolve(entry)
  if (seen.has(abs)) return
  seen.add(abs)
  if (!existsSync(abs)) return // caller already recorded it as missing
  const src = readFileSync(abs, 'utf8')
  const here = dirname(abs)
  for (const m of src.matchAll(SPEC_RE)) {
    const spec = m[1]
    if (!isLocal(spec)) continue
    const target = resolve(here, spec)
    if (!existsSync(target)) { problems.push({ importer: entry, spec, target }); continue }
    scan(target, seen, problems) // follow the graph
  }
}

const entries = process.argv.slice(2)
if (!entries.length) entries.push('server.mjs')

const problems = []
const seen = new Set()
for (const e of entries) {
  if (!existsSync(resolve(e))) { problems.push({ importer: '(entry)', spec: e, target: resolve(e) }); continue }
  scan(e, seen, problems)
}

if (problems.length) {
  console.error('✗ import check failed — these modules are imported but missing from the image:')
  for (const p of problems) console.error(`    ${p.importer}  →  '${p.spec}'  (expected ${p.target})`)
  console.error('\nAdd the file to the Dockerfile runtime COPY (or commit it) before deploying.')
  process.exit(1)
}
console.log(`✓ import check passed — ${seen.size} local module(s) reachable from ${entries.join(', ')}`)
