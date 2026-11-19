// Protocol-drift probe that consumes NO model tokens: initialize handshake plus
// `thread/start` only (no turn/start), across every permission mode the plugin
// can configure. Captures the initialize response shape and whether the plugin's
// exact thread/start payload (including approve-for-me's approvalsReviewer /
// sandbox) is still accepted.
//
// Usage: node spikes/protocol/drift.mjs

import { BINARIES, THREAD_PERMISSION_PARAMS, runProbe, verdictLine } from "./wire.mjs";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

const RESULT_DIR = join(import.meta.dirname, "results");

const report = { generatedAt: new Date().toISOString(), binaries: {} };

for (const binaryId of Object.keys(BINARIES)) {
  const binary = BINARIES[binaryId];
  const version = spawnSync(binary.versionArgv[0], [...binary.versionArgv.slice(1), "--version"], { encoding: "utf8" });
  const versionText = `${version.stdout ?? ""}${version.stderr ?? ""}`.trim() || `exit ${version.status}`;
  const entry = { versionText, launchedBy: binary.launchedBy, modes: {} };
  report.binaries[binaryId] = entry;

  for (const mode of Object.keys(THREAD_PERMISSION_PARAMS)) {
    const slug = `drift-${binaryId}-${mode}`;
    const summary = await runProbe({
      binaryId,
      model: undefined, // thread/start without model: uses the account/config default
      mode,
      writeTurn: false,
      timeoutMs: 60_000,
      slug,
    });
    const mark = summary.outcome === "handshake-only" ? "OK" : "FAIL";
    console.log(`[${mark}] ${binaryId} | mode=${mode} | ${summary.outcome}${summary.errorMessage ? ` | ${summary.errorMessage}` : ""} | ${summary.elapsedMs}ms`);
    entry.modes[mode] = {
      paramsSent: THREAD_PERMISSION_PARAMS[mode],
      outcome: summary.outcome,
      errorMessage: summary.errorMessage,
      initialize: summary.initialize,
      threadStart: summary.threadStart.ok
        ? {
            ok: true,
            threadId: summary.threadStart.threadId,
            ephemeral: summary.threadStart.ephemeral,
            threadKeys: Object.keys(summary.threadStart.result?.thread ?? {}),
            responseKeys: Object.keys(summary.threadStart.result ?? {}),
          }
        : summary.threadStart,
      notifications: summary.notifications,
      serverRequests: summary.serverRequests.map((request) => request.method),
      stderrTail: summary.stderrTail,
    };
  }
}

writeFileSync(join(RESULT_DIR, "drift-summary.json"), `${JSON.stringify(report, null, 2)}\n`);
console.log(`\nwrote ${join(RESULT_DIR, "drift-summary.json")}`);

// Compact handshake comparison.
console.log("\ninitialize response shape by binary:");
for (const [binaryId, entry] of Object.entries(report.binaries)) {
  for (const [mode, data] of Object.entries(entry.modes)) {
    if (data.initialize?.ok) {
      console.log(`  ${binaryId} (${mode}): ${JSON.stringify(data.initialize.result)}`);
      break;
    }
  }
}
console.log("\nthread/start ephemeral flag by mode:");
for (const [binaryId, entry] of Object.entries(report.binaries)) {
  for (const [mode, data] of Object.entries(entry.modes)) {
    console.log(
      `  ${binaryId} | ${mode}: outcome=${data.outcome} ephemeral=${data.threadStart?.ephemeral} threadKeys=${(data.threadStart?.threadKeys ?? []).join(",")}`,
    );
  }
}
