// Collect the exact version matrix this fork is being tested against.
//
// Output: JSON snapshot (default: research/versions-<date>.json) plus a markdown row.
// Run before and after a DSH update, then record the matrix in COMPATIBILITY.md.
//
// Usage:
//   node tools/collect-versions.mjs [--out research/versions-<label>.json] [--label <label>]
//
// Reads the installed DSH app/runtime, the profile's package graph, the upstream
// Codex pin, the fork version, and the Codex CLI payload versions found on disk.
// Read-only: extracts two small files from app.asar into memory.

import { createRequire } from 'node:module'
import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync, readdirSync, mkdirSync, statSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)))
const requireHere = createRequire(import.meta.url)
const { extractFile } = requireHere('@electron/asar')

const args = process.argv.slice(2)
const labelIndex = args.indexOf('--label')
const label = labelIndex >= 0 ? args[labelIndex + 1] : 'current'
const outIndex = args.indexOf('--out')
const outPath = outIndex >= 0
  ? args[outIndex + 1]
  : join(ROOT, 'research', `versions-${label}.json`)

// Paths come from the environment, never from this file. Snapshots store
// placeholders (<DSH_PROFILE_DIR>, <CODEX_CLI_PATH>) instead of real paths.
const DSH_APP_DIR = process.env.DSH_APP_DIR
  ?? (process.env.DSH_NODE_EXECUTABLE ? dirname(process.env.DSH_NODE_EXECUTABLE) : undefined)
const DSH_ASAR = process.env.DSH_APP_ASAR
  ?? (DSH_APP_DIR ? join(DSH_APP_DIR, 'resources', 'app.asar') : undefined)
const PROFILE_DIR = process.env.DSH_PROFILE_DIR
  ?? join(homedir(), '.dsh', 'profiles', 'desktop')
const FORK_DIR = join(ROOT, 'packages', 'dsh-subagent-codex-next')

function readJson(path) {
  return JSON.parse(readFileSync(path, 'utf8'))
}

function safe(fn) {
  try {
    return fn()
  } catch (error) {
    return { error: String(error?.message ?? error) }
  }
}

function extractAsarJson(innerPath) {
  if (!DSH_ASAR) throw new Error('set DSH_APP_ASAR or DSH_NODE_EXECUTABLE to read the installation')
  const buf = extractFile(DSH_ASAR, innerPath)
  return JSON.parse(buf.toString('utf8'))
}

function codexVersion(argv, cwd) {
  const out = execFileSync(argv[0], argv.slice(1), {
    cwd,
    encoding: 'utf8',
    timeout: 30_000,
    windowsHide: true,
  })
  return out.trim()
}

const appVersion = DSH_APP_DIR
  ? safe(() => readFileSync(join(DSH_APP_DIR, 'version'), 'utf8').trim())
  : { error: 'DSH_APP_DIR is unknown' }

const desktopRuntime = safe(() => {
  const pkg = extractAsarJson('dsh/package.json')
  return { name: pkg.name, version: pkg.version }
})

const runtimeToolchain = DSH_APP_DIR
  ? safe(() => readJson(join(DSH_APP_DIR, 'resources', 'runtime', 'versions.json')))
  : { error: 'DSH_APP_DIR is unknown' }

const profilePackage = safe(() => readJson(join(PROFILE_DIR, 'package.json')))

const pluginPkg = safe(() => readJson(join(PROFILE_DIR, 'node_modules', '@deepseek-ai', 'dsh-subagent-codex', 'package.json')))

const installedCodex = safe(() => {
  const pkg = readJson(join(PROFILE_DIR, 'node_modules', '@openai', 'codex', 'package.json'))
  return { name: pkg.name, version: pkg.version }
})

const codexCli = safe(() => codexVersion([
  process.execPath,
  join(PROFILE_DIR, 'node_modules', '@openai', 'codex', 'bin', 'codex.js'),
  '--version',
], PROFILE_DIR))

const appCodex = safe(() => {
  const binRoot = join(process.env.LOCALAPPDATA ?? join(homedir(), 'AppData', 'Local'), 'OpenAI', 'Codex', 'bin')
  if (!existsSync(binRoot)) return { error: 'bin root not found' }
  const builds = readdirSync(binRoot, { withFileTypes: true })
    .filter(entry => entry.isDirectory())
    .map(entry => join(binRoot, entry.name, 'codex.exe'))
    .filter(path => existsSync(path))
  if (builds.length === 0) return { error: 'no codex.exe found' }
  const newest = builds.sort((a, b) => statSync(b).size - statSync(a).size)[0]
  return { path: '<CODEX_CLI_PATH>', version: codexVersion([newest, '--version'], ROOT) }
})

const forkPkg = safe(() => readJson(join(FORK_DIR, 'package.json')))

const snapshot = {
  label,
  collectedAt: new Date().toISOString(),
  host: {
    desktopAppVersion: appVersion,
    desktopRuntime,
    runtimeToolchain,
  },
  profile: {
    path: '<DSH_PROFILE_DIR>',
    bundles: safe(() => profilePackage.dsh?.profile?.bundles),
    dependencies: safe(() => profilePackage.dependencies),
  },
  upstreamPlugin: {
    installedVersion: safe(() => pluginPkg.version),
    pinnedCodex: safe(() => pluginPkg.dependencies?.['@openai/codex']),
    installedCodex,
    codexCliVersion: codexCli,
  },
  appCodex,
  fork: {
    name: safe(() => forkPkg.name),
    version: safe(() => forkPkg.version),
    pinnedCodex: safe(() => forkPkg.dependencies?.['@openai/codex']),
    enginesDsh: safe(() => forkPkg.engines?.dsh),
  },
  environment: {
    node: process.version,
    platform: `${process.platform}-${process.arch}`,
  },
}

mkdirSync(dirname(outPath), { recursive: true })
writeFileSync(outPath, `${JSON.stringify(snapshot, null, 2)}\n`)
console.log(JSON.stringify(snapshot, null, 2))
console.log(`\nwritten: ${outPath}`)
