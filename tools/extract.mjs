// Read files from the installed DSH Electron app.asar.
//
// Usage:
//   node tools/extract.mjs <out-dir> <archive-inner-path> [<archive-inner-path> ...]
//
// Archive resolution order: --archive <path>, env DSH_APP_ASAR,
// <DSH_APP_DIR>/resources/app.asar, or the directory of DSH_NODE_EXECUTABLE
// plus resources/app.asar. No machine-specific path is stored in this file.

import { extractFile } from '@electron/asar'
import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join, sep } from 'node:path'

const rawArgs = process.argv.slice(2)
const archiveFlag = rawArgs.indexOf('--archive')
const archive = archiveFlag >= 0
  ? rawArgs[archiveFlag + 1]
  : process.env.DSH_APP_ASAR
    ?? join(
      process.env.DSH_APP_DIR
        ?? (process.env.DSH_NODE_EXECUTABLE ? dirname(process.env.DSH_NODE_EXECUTABLE) : '.'),
      'resources',
      'app.asar',
    )

const args = archiveFlag >= 0
  ? rawArgs.filter((_, index) => index !== archiveFlag && index !== archiveFlag + 1)
  : rawArgs
const outRoot = args[0]
const files = args.slice(1)

if (!archive || !existsSync(archive)) {
  console.error('extract: app.asar not found; pass --archive <path> or set DSH_APP_ASAR')
  process.exit(2)
}
if (!outRoot || files.length === 0) {
  console.error('extract: usage: node tools/extract.mjs <out-dir> <archive-inner-path> [...]')
  process.exit(2)
}

for (const file of files) {
  const archPath = file.split('/').join(sep)
  const buf = extractFile(archive, archPath)
  const out = join(outRoot, file.replace(/^\/+/, ''))
  mkdirSync(dirname(out), { recursive: true })
  writeFileSync(out, buf)
  console.log(`${file} -> ${out} (${buf.length} bytes)`)
}
