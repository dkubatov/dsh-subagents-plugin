// Verify plugin-side resolution of @openai/codex in the scratch profile copy.
// Mirrors how @deepseek-ai/dsh-subagent-codex resolves the codex CLI:
// createRequire on its own entry, then resolve('@openai/codex/...').
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { execFileSync } from 'node:child_process';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';

const root = path.resolve(process.argv[2] ?? '.');
const pluginEntry = path.join(root, 'node_modules/@deepseek-ai/dsh-subagent-codex/lib/index.js');
const req = createRequire(pathToFileURL(pluginEntry));

const out = { pluginEntry, resolutions: [], stale: [] };

for (const spec of ['@openai/codex', '@openai/codex/package.json']) {
  try {
    out.resolutions.push({ spec, resolved: req.resolve(spec) });
  } catch (err) {
    out.resolutions.push({ spec, error: String(err?.code ?? err) });
  }
}

let manifestPath;
try { manifestPath = req.resolve('@openai/codex/package.json'); } catch {}
if (manifestPath) {
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
  out.packageName = manifest.name;
  out.version = manifest.version;
  out.binField = manifest.bin;
  const binRel = typeof manifest.bin === 'string' ? manifest.bin : manifest.bin?.codex;
  const binPath = path.resolve(path.dirname(manifestPath), binRel);
  out.binPath = binPath;

  out.platform = {};
  for (const name of ['@openai/codex-win32-x64']) {
    try {
      const p = req.resolve(name + '/package.json');
      const m = JSON.parse(readFileSync(p, 'utf8'));
      out.platform[name] = { name: m.name, version: m.version, path: p };
      const exe = path.join(path.dirname(p), 'vendor/x86_64-pc-windows-msvc/bin/codex.exe');
      try { out.platform[name].exe = exe; out.platform[name].exeExists = readFileSync(exe).length > 0; } catch { out.platform[name].exeExists = false; }
    } catch (err) {
      out.platform[name] = { error: String(err?.code ?? err) };
    }
  }

  try {
    out.versionOutput = execFileSync(process.execPath, [binPath, '--version'], {
      cwd: root, encoding: 'utf8', timeout: 120000, windowsHide: true,
    }).trim();
  } catch (err) {
    out.versionOutput = { error: String(err?.message ?? err), stdout: err?.stdout, stderr: err?.stderr };
  }
}

// Look for stale @openai/codex manifests under node_modules/.pnpm (only there, top level is checked above).
const vdir = path.join(root, 'node_modules/.pnpm');
try {
  for (const e of readdirSync(vdir, { withFileTypes: true })) {
    if (!e.isDirectory() || !e.name.startsWith('@openai+codex@')) continue;
    const p = path.join(vdir, e.name, 'node_modules/@openai/codex/package.json');
    try {
      const m = JSON.parse(readFileSync(p, 'utf8'));
      out.stale.push({ dir: e.name, version: m.version });
    } catch { out.stale.push({ dir: e.name, manifest: 'missing' }); }
  }
} catch {}

console.log(JSON.stringify(out, null, 2));
