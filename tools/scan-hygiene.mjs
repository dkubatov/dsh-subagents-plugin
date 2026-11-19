// Read-only: scan tracked text files for machine-local paths and secrets.
//
// Usage: node tools/scan-hygiene.mjs
//
// The forbidden local-path needles are derived from the CURRENT environment
// (home directory, DSH_* variables, workspace directory), so this file stores
// no machine-specific path. Placeholders such as <HOME>, <DSH_PROFILE_DIR>,
// <DSH_INSTALL_DIR>, <CODEX_CLI_PATH>, <workspace> are allowed.
//
// Exit code 0 = clean; 1 = findings printed.

import { execFileSync } from 'node:child_process'
import { readFileSync, statSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)))
const SELF = fileURLToPath(import.meta.url)
const TEXT_EXT = /\.(md|markdown|json|jsonl|mjs|js|ts|yml|yaml|txt|toml|ps1|cmd|sh|svg)$/i
const MAX_BYTES = 2 * 1024 * 1024

function variants(value) {
  if (!value || value.length < 6) return []
  const normalized = value.replace(/[\\/]+/g, '\\')
  return [...new Set([value, normalized, normalized.replace(/\\/g, '/'), normalized.replace(/\\/g, '\\\\')])]
}

const needles = new Set()
for (const value of [
  homedir(),
  process.env.USERPROFILE,
  process.env.DSH_HOME,
  process.env.DSH_PROFILE_DIR,
  process.env.DSH_INSTALL_DIR,
  process.env.DSH_APP_DIR,
  process.env.DSH_NODE_EXECUTABLE,
  ROOT,
]) {
  for (const needle of variants(value)) needles.add(needle)
}
needles.delete(ROOT)
for (const needle of variants(ROOT)) needles.add(needle)

const USER_PATH = /[A-Za-z]:[\\/]{1,2}Users[\\/]{1,2}(?!<)[A-Za-z0-9._-]{2,}/g
const APP_PATH = /[A-Za-z]:[\\/]{1,2}(?:Repos|DeepSeek)(?:[\\/]{1,2}[^\s"'<>]+)*/g

const SECRETS = [
  ['GitHub token', /gh[opsu]_[A-Za-z0-9]{30,}/g],
  ['GitHub fine-grained token', /github_pat_[A-Za-z0-9_]{20,}/g],
  ['OpenAI-style key', /\bsk-[A-Za-z0-9_-]{24,}/g],
  ['Slack token', /\bxox[baprs]-[A-Za-z0-9-]{10,}/g],
  ['AWS access key', /\bAKIA[0-9A-Z]{16}\b/g],
  ['Private key block', /-----BEGIN (?:RSA |OPENSSH |EC |DSA )?PRIVATE KEY-----/g],
]

function trackedFiles() {
  const out = execFileSync('git', ['ls-files', '-z'], { cwd: ROOT, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 })
  return out.split('\0').filter(Boolean)
}

const findings = []
for (const relative of trackedFiles()) {
  if (relative === 'tools/scan-hygiene.mjs') continue
  const absolute = join(ROOT, relative)
  if (!TEXT_EXT.test(relative)) continue
  try {
    if (statSync(absolute).size > MAX_BYTES) continue
  } catch {
    continue
  }
  const lines = readFileSync(absolute, 'utf8').split('\n')
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index]
    for (const needle of needles) {
      if (line.includes(needle)) {
        findings.push({ kind: 'local path', file: relative, line: index + 1, sample: needle })
      }
    }
    for (const match of line.matchAll(USER_PATH)) {
      findings.push({ kind: 'windows user path', file: relative, line: index + 1, sample: match[0] })
    }
    for (const match of line.matchAll(APP_PATH)) {
      findings.push({ kind: 'absolute app path', file: relative, line: index + 1, sample: match[0] })
    }
    for (const [label, pattern] of SECRETS) {
      for (const match of line.matchAll(pattern)) {
        findings.push({ kind: label, file: relative, line: index + 1, sample: match[0].slice(0, 8) + '…' })
      }
    }
  }
}

if (findings.length === 0) {
  console.log('scan-hygiene: OK — no local paths or secrets in tracked files')
  process.exit(0)
}

for (const finding of findings) {
  console.log(`${finding.file}:${finding.line}  [${finding.kind}]  ${finding.sample}`)
}
console.log(`\nscan-hygiene: ${findings.length} finding(s) — replace local paths with placeholders (<HOME>, <DSH_PROFILE_DIR>, <DSH_INSTALL_DIR>, <CODEX_CLI_PATH>, <workspace>) and rotate any real secret.`)
process.exit(1)
