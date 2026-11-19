// Read-only: list the Codex model catalog for the current account via the
// app-server `model/list` method. No model turn runs (0 tokens).
//
// Usage:
//   node scripts/probe-model-catalog.mjs
//   node scripts/probe-model-catalog.mjs --json
//   node scripts/probe-model-catalog.mjs --command '["<path-to-codex.exe>","app-server","--stdio"]'
//
// Each model row shows the default reasoning effort and the efforts the model
// advertises. The provider passes `--effort` through as
// `thread/start.config.model_reasoning_effort`; the app-server echoes the value
// it accepted, while this catalog is the authoritative per-model support list.

import { spawn } from "node:child_process";
import { createInterface } from "node:readline";
import { randomUUID } from "node:crypto";
import { resolvePackagedCommand } from "./probe-wire.mjs";

const args = {};
for (let i = 2; i < process.argv.length; i += 1) {
  const token = process.argv[i];
  if (token === "--json") {
    args.json = true;
    continue;
  }
  if (!token.startsWith("--")) throw new Error(`unexpected argument ${token}`);
  const value = process.argv[i + 1];
  if (value === undefined) throw new Error(`missing value for ${token}`);
  args[token.slice(2)] = value;
  i += 1;
}

const command = args.command !== undefined
  ? JSON.parse(args.command)
  : [...resolvePackagedCommand(args["codex-package"] ?? "@openai/codex"), "app-server", "--stdio"];
if (!Array.isArray(command) || command.length === 0) throw new Error("--command must be a non-empty JSON array");

const child = spawn(command[0], command.slice(1), {
  env: process.env,
  stdio: ["pipe", "pipe", "pipe"],
  windowsHide: true,
});

const pending = new Map();
const rl = createInterface({ input: child.stdout });
let stderr = "";
child.stderr.on("data", chunk => { if (stderr.length < 8192) stderr += chunk.toString("utf8"); });
rl.on("line", line => {
  if (!line.trim()) return;
  let message;
  try { message = JSON.parse(line); } catch { return; }
  if (message.id === undefined) return;
  const waiter = pending.get(message.id);
  if (waiter === undefined) return;
  pending.delete(message.id);
  if (message.error) waiter.reject(new Error(JSON.stringify(message.error)));
  else waiter.resolve(message.result);
});

const request = (method, params) => new Promise((resolve, reject) => {
  const id = randomUUID();
  pending.set(id, { resolve, reject });
  child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id, method, params })}\n`);
});

const timeout = setTimeout(() => {
  console.error("probe-model-catalog: timeout");
  child.kill();
  process.exit(1);
}, 60_000);

try {
  await request("initialize", {
    clientInfo: { name: "dsh-probe", title: "DSH probe", version: "0.0.1" },
    capabilities: { experimentalApi: false, requestAttestation: false },
  });
  child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", method: "initialized" })}\n`);
  const response = await request("model/list", {});
  const models = (response.data ?? []).map(model => ({
    id: model.id,
    model: model.model,
    displayName: model.displayName,
    isDefault: model.isDefault,
    defaultReasoningEffort: model.defaultReasoningEffort,
    supportedReasoningEfforts: (model.supportedReasoningEfforts ?? []).map(entry => entry.reasoningEffort ?? entry),
  }));
  if (args.json) {
    console.log(JSON.stringify(models, null, 2));
  } else {
    for (const model of models) {
      console.log(`${model.id} | default=${model.defaultReasoningEffort} | supported=${model.supportedReasoningEfforts.join(",")}${model.isDefault ? " | account-default" : ""}`);
    }
  }
  process.exitCode = 0;
} catch (error) {
  console.error(`probe-model-catalog: ${error instanceof Error ? error.message : String(error)}`);
  if (stderr.trim()) console.error(stderr.trim().split(/\r?\n/).slice(-20).join("\n"));
  process.exitCode = 1;
} finally {
  clearTimeout(timeout);
  rl.close();
  try { child.stdin.end(); } catch {}
  child.kill();
}
