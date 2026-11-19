import { extractFile } from '@electron/asar'
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join, sep } from 'node:path'

const archive = 'D:/DeepSeek/resources/app.asar'
const outRoot = process.argv[2]
const files = process.argv.slice(3)

for (const file of files) {
  const archPath = file.split('/').join(sep)
  const buf = extractFile(archive, archPath)
  const out = join(outRoot, file.replace(/^\/+/, ''))
  mkdirSync(dirname(out), { recursive: true })
  writeFileSync(out, buf)
  console.log(`${file} -> ${out} (${buf.length} bytes)`)
}
