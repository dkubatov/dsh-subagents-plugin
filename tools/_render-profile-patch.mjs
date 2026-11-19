// One-off: rebuild the desktop profile patch for the rc.5 preset-scoped tool model.
// - keeps the user's existing settings block (everything before the Codex block)
// - keeps global Codex provider rows (providers are Host services)
// - mounts the Codex delegation tools inside the shipped `standard` preset,
//   because rc.5 disables Host-root tool rows and lets presets select tools.
//
// Reads the shipped preset from app.asar and replaces the `!!js` expressions
// with concrete Windows/Desktop values so the profile patch parses as plain YAML.
//
// Usage: node tools/_render-profile-patch.mjs <currentPatch> <shippedPreset> <out>

import { readFileSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'

const [currentPatchPath, shippedPresetPath, outPath] = process.argv.slice(2)
const requireHere = createRequire(import.meta.url)

const current = readFileSync(currentPatchPath, 'utf8')
const shipped = readFileSync(shippedPresetPath, 'utf8')

// 1. User settings block: everything before the Codex comment we added.
const marker = '# Codex subagents via the local fork'
const markerIndex = current.indexOf(marker)
if (markerIndex < 0) throw new Error('Codex block marker not found in current patch')
const settingsBlock = current.slice(0, markerIndex).trimEnd()

// 2. Shipped standard preset plugin list, dedented by 4 spaces.
const lines = shipped.split(/\r?\n/)
const pluginsLine = lines.findIndex(line => line === '        plugins:')
if (pluginsLine < 0) throw new Error('plugins: line not found in shipped preset')
const pluginLines = lines.slice(pluginsLine + 1)
  .filter(line => line.trim() !== '')
  .map(line => line.startsWith('    ') ? line.slice(4) : line)

const skillPath = 'D:\\DeepSeek\\resources\\app.asar\\dsh\\node_modules\\@deepseek-ai\\dsh-agent-preset\\skills'

const rendered = []
for (const line of pluginLines) {
  let next = line
  next = next.replace("disabled: !!js process.platform === 'win32'", 'disabled: true')
  next = next.replace("disabled: !!js process.platform !== 'win32'", 'disabled: false')
  next = next.replace('disabled: !!js "!ctx.get(\'profileContext\')"', 'disabled: false')
  if (next.trim().startsWith('- !!js process.getBuiltinModule')) {
    next = `          - '${skillPath}'`.replace(/^ {10}/, line.match(/^\s*/)[0])
  }
  rendered.push(next)
}

// 3. Add the Codex delegation tools to the `delegation` group.
const anchor = `          - id: tool-workflow
            name: '@deepseek-ai/dsh-tool-workflow'`
const anchorIndex = rendered.findIndex(line => line === '          - id: tool-workflow')
if (anchorIndex < 0) throw new Error('tool-workflow row not found in rendered preset')
const codexToolRows = [
  '          - id: tool-subagent-codex-next',
  "            name: '@deepseek-ai/dsh-tool-subagent'",
  '            config:',
  '              provider: codex',
  '              toolName: subagent_codex',
  '              maxDepth: provider-managed',
  '          - id: tool-subagent-codex-next-luna',
  "            name: '@deepseek-ai/dsh-tool-subagent'",
  '            config:',
  '              provider: codex-luna',
  '              toolName: subagent_codex_luna',
  '              maxDepth: provider-managed',
  '          - id: tool-subagent-codex-next-sol',
  "            name: '@deepseek-ai/dsh-tool-subagent'",
  '            config:',
  '              provider: codex-sol',
  '              toolName: subagent_codex_sol',
  '              maxDepth: provider-managed',
  '          - id: tool-subagent-codex-next-terra',
  "            name: '@deepseek-ai/dsh-tool-subagent'",
  '            config:',
  '              provider: codex-terra',
  '              toolName: subagent_codex_terra',
  '              maxDepth: provider-managed',
]
// find end of tool-workflow entry: next line with exactly 6-space indent
let insertAt = anchorIndex + 1
while (insertAt < rendered.length && !/^ {6}- /.test(rendered[insertAt])) insertAt += 1
rendered.splice(insertAt, 0, ...codexToolRows)

const presetOverride = [
  '# rc.5 moved delegation tools into agent presets: Host-root tool rows are',
  '# disabled by the web bundle, so the Codex tools are mounted inside the',
  '# shipped `standard` preset (override restates the complete plugin list).',
  '- id: preset-standard',
  '  name: "@deepseek-ai/dsh-agent-preset"',
  '  config:',
  '    id: standard',
  '    order: 1',
  '    plugins:',
  ...rendered,
]

const providers = [
  '# Codex subagents via the local fork `dsh-subagent-codex-next` (Codex 0.166.0,',
  '# gpt-6.x). Provider rows are Host services; the delegation tools live in the',
  '# `standard` preset below.',
  '- insert:',
  '    - id: subagent-codex-next-luna',
  '      name: "dsh-subagent-codex-next"',
  '      config:',
  '        providerName: codex-luna',
  '        model: gpt-6-luna',
  '    - id: subagent-codex-next-sol',
  '      name: "dsh-subagent-codex-next"',
  '      config:',
  '        providerName: codex-sol',
  '        model: gpt-6.1-sol',
  '    - id: subagent-codex-next-terra',
  '      name: "dsh-subagent-codex-next"',
  '      config:',
  '        providerName: codex-terra',
  '        model: gpt-6.1-terra',
]

const defaultModel = [
  '- id: agent-default-model',
  '  name: "@deepseek-ai/dsh-agent-default-model"',
  '  config:',
  '    provider: deepseek-official',
  '    model: deepseek-flash',
  '    reasoningEffort: max',
]

const output = [settingsBlock, '', ...providers, '', ...presetOverride, '', ...defaultModel, ''].join('\n')

// Validate with the YAML implementation shipped in the host runtime when possible.
try {
  const yaml = requireHere('C:/Users/kubat/.dsh/profiles/node_modules/yaml')
  yaml.parse(output)
  console.log('YAML parse: OK')
} catch (error) {
  console.error('YAML validation failed:', error.message)
  process.exitCode = 1
}

writeFileSync(outPath, output)
console.log(`written: ${outPath} (${output.split('\n').length} lines)`)
