// Matrix runner: binaries × models, one tiny turn each, plus the plugin's own
// pinned 0.153.4 as a failure-control for gpt-6-luna (reproduces the reported
// HTTP 400 model_not_found).
//
// Usage: node spikes/protocol/run-matrix.mjs
// Optional: node spikes/protocol/run-matrix.mjs --skip-terra

import { runProbe, verdictLine } from "./wire.mjs";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const RESULT_DIR = join(import.meta.dirname, "results");
mkdirSync(RESULT_DIR, { recursive: true });

const skipTerra = process.argv.includes("--skip-terra");
const prompt = "Reply with exactly: OK";

const CASES = [
  // Core matrix: both candidate binaries × three models.
  { binaryId: "app-0.169.0-alpha.11.1", model: "gpt-6-luna" },
  { binaryId: "app-0.169.0-alpha.11.1", model: "gpt-6.1-sol" },
  { binaryId: "app-0.169.0-alpha.11.1", model: "gpt-5.6-sol" },
  { binaryId: "0.166.0", model: "gpt-6-luna" },
  { binaryId: "0.166.0", model: "gpt-6.1-sol" },
  { binaryId: "0.166.0", model: "gpt-5.6-sol" },
  // Extra new-model probe on the newer binary (one more model call).
  ...(skipTerra ? [] : [{ binaryId: "app-0.169.0-alpha.11.1", model: "gpt-6.1-terra" }]),
  // Failure control: the plugin's pinned build should reproduce model_not_found.
  { binaryId: "plugin-0.153.4", model: "gpt-6-luna", role: "control" },
];

const results = [];
for (const testCase of CASES) {
  const slug = `matrix-${testCase.binaryId}-${testCase.model}`;
  const startedAt = Date.now();
  const summary = await runProbe({
    binaryId: testCase.binaryId,
    model: testCase.model,
    mode: "never",
    prompt,
    timeoutMs: 150_000,
    slug,
  });
  results.push({
    binaryId: summary.binaryId,
    model: summary.model,
    role: testCase.role ?? "candidate",
    outcome: summary.outcome,
    turnStatus: summary.terminal?.status,
    codexErrorInfo: summary.terminal?.codexErrorInfo,
    turnError: summary.terminal?.error,
    outputText: summary.outputText,
    elapsedMs: summary.elapsedMs,
    initializeOk: summary.initialize.ok,
    threadId: summary.threadStart.threadId,
    ephemeral: summary.threadStart.ephemeral,
    errorMessage: summary.errorMessage,
    notifications: summary.notifications,
    serverRequests: summary.serverRequests.map((request) => request.method),
    logFile: `logs/${slug}.jsonl`,
    resultFile: `results/${slug}.json`,
    wallMs: Date.now() - startedAt,
  });
  console.log(verdictLine(summary));
}

const matrix = {
  generatedAt: new Date().toISOString(),
  prompt,
  cases: results,
  modelCalls: results.filter((result) => result.role !== "control" || result.turnStatus !== undefined).length,
};
writeFileSync(join(RESULT_DIR, "matrix.json"), `${JSON.stringify(matrix, null, 2)}\n`);

console.log("\n=== matrix ===");
for (const row of results) {
  const outcome = row.outcome === "success" ? "SUCCESS" : `FAIL(${row.outcome})`;
  const text = row.outputText === undefined ? "" : ` text=${JSON.stringify(row.outputText)}`;
  const err = row.turnStatus && row.turnStatus !== "completed" ? ` status=${row.turnStatus} info=${JSON.stringify(row.codexErrorInfo)}` : "";
  console.log(`${row.binaryId.padEnd(24)} ${String(row.model).padEnd(14)} ${outcome}${err}${text} ${row.elapsedMs}ms`);
}

console.log(`\nwrote ${join(RESULT_DIR, "matrix.json")}`);
process.exitCode = results.some((row) => row.outcome === "success") ? 0 : 1;
