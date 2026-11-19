// Integration probe for this fork: drives the packaged Codex app-server with the
// exact wire sequence the subagent provider uses, then reports a safe verdict.
//
// It answers one question: does the payload this fork pins still accept the
// provider's requests and the requested model on this machine?
//
// Usage:
//   node scripts/probe-app-server.mjs --model gpt-6-luna
//   node scripts/probe-app-server.mjs --model gpt-6.1-sol --mode approve-for-me
//   node scripts/probe-app-server.mjs --no-turn              # handshake only, 0 tokens
//   node scripts/probe-app-server.mjs --codex-package @openai/codex-next --model gpt-6-luna
//   node scripts/probe-app-server.mjs --codex-bin "C:\\path\\codex.exe" --model gpt-6-luna
//   node scripts/probe-app-server.mjs --command '["C:\\path\\codex.exe","app-server","--stdio"]'
//
// Omit --model to exercise the native default (config.toml `model =`), which is
// the production path when no provider instance fixes a model.
//
// Runs write raw JSONL frames to scripts/logs/ and a summary to scripts/results/.

import { mkdirSync } from "node:fs";
import { LOG_DIR, RESULT_DIR, resolvePackagedCommand, runProbe, verdictLine } from "./probe-wire.mjs";

function parseArgs(argv) {
  const out = { mode: "never", noTurn: false };
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (token === "--no-turn") {
      out.noTurn = true;
      continue;
    }
    if (!token.startsWith("--")) throw new Error(`unexpected argument ${token}`);
    const key = token.slice(2);
    const value = argv[i + 1];
    if (value === undefined) throw new Error(`missing value for ${token}`);
    i += 1;
    out[key] = value;
  }
  return out;
}

const args = parseArgs(process.argv.slice(2));

let command;
if (args.command !== undefined) {
  command = JSON.parse(args.command);
  if (!Array.isArray(command) || command.length === 0) throw new Error("--command must be a non-empty JSON array");
} else if (args["codex-bin"] !== undefined) {
  command = [args["codex-bin"], "app-server", "--stdio"];
} else if (args["codex-package"] !== undefined) {
  command = [...resolvePackagedCommand(args["codex-package"]), "app-server", "--stdio"];
}

const slug = args.slug
  ?? `probe-${args.model ?? "default-model"}-${args.mode}${args.noTurn ? "-handshake" : ""}`;

mkdirSync(LOG_DIR, { recursive: true });
mkdirSync(RESULT_DIR, { recursive: true });

const summary = await runProbe({
  command,
  binaryId: command === undefined
    ? undefined
    : args["codex-package"] ?? args["codex-bin"] ?? "custom-command",
  model: args.model,
  mode: args.mode,
  prompt: args.prompt ?? "Reply with exactly: OK",
  timeoutMs: Number(args["timeout-ms"] ?? 150_000),
  requestTimeoutMs: Number(args["request-timeout-ms"] ?? 60_000),
  writeTurn: !args.noTurn,
  slug,
});

console.log(verdictLine(summary));
if (summary.errorMessage) console.log(`error: ${summary.errorMessage}`);
if (summary.initialize.ok && args["print-initialize"]) {
  console.log(`initialize result: ${JSON.stringify(summary.initialize.result)}`);
}
if (summary.threadStart.ok && args["print-thread-start"]) {
  console.log(`thread/start: id=${summary.threadStart.threadId} ephemeral=${summary.threadStart.ephemeral}`);
}
console.log(`log: ${LOG_DIR}\\${slug}.jsonl`);
console.log(`result: ${RESULT_DIR}\\${slug}.json`);

process.exitCode = summary.outcome === "success" || summary.outcome === "handshake-only" ? 0 : 1;
