// Single probe: run the plugin's exact wire sequence against one binary and model.
//
// Usage:
//   node spikes/protocol/probe.mjs --binary 0.166.0 --model gpt-6.1-sol
//   node spikes/protocol/probe.mjs --binary app-0.169.0-alpha.11.1 --model gpt-6-luna --mode never
//   node spikes/protocol/probe.mjs --binary 0.166.0 --mode approve-for-me --no-turn   # handshake only
//
// Every run writes raw JSONL frames to spikes/protocol/logs/<slug>.jsonl and a
// summary to spikes/protocol/results/<slug>.json.

import { BINARIES, LOG_DIR, RESULT_DIR, runProbe, verdictLine } from "./wire.mjs";
import { mkdirSync } from "node:fs";

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
if (!BINARIES[args.binary]) {
  console.error(`unknown --binary ${JSON.stringify(args.binary)}; known: ${Object.keys(BINARIES).join(", ")}`);
  process.exit(2);
}
if (!args.model && !args["default-model"]) {
  console.error("--model is required (pass e.g. --model gpt-6.1-sol)");
  process.exit(2);
}

mkdirSync(LOG_DIR, { recursive: true });
mkdirSync(RESULT_DIR, { recursive: true });

const slug = args.slug ?? `${args.binary}-${args.model}-${args.mode}${args.noTurn ? "-handshake" : ""}`;
const summary = await runProbe({
  binaryId: args.binary,
  model: args.model,
  mode: args.mode,
  prompt: args.prompt ?? "Reply with exactly: OK",
  timeoutMs: Number(args["timeout-ms"] ?? 150_000),
  writeTurn: !args.noTurn,
  slug,
});

console.log(verdictLine(summary));
if (summary.errorMessage) console.log(`error: ${summary.errorMessage}`);
if (summary.initialize.ok && args["print-initialize"]) console.log(`initialize result: ${JSON.stringify(summary.initialize.result)}`);
if (summary.threadStart.ok && args["print-thread-start"]) console.log(`thread/start: id=${summary.threadStart.threadId} ephemeral=${summary.threadStart.ephemeral}`);
console.log(`log: ${LOG_DIR}\\${slug}.jsonl`);
console.log(`result: ${RESULT_DIR}\\${slug}.json`);

process.exitCode = summary.outcome === "success" || summary.outcome === "handshake-only" ? 0 : 1;
