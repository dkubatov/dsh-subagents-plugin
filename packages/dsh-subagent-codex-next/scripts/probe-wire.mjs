// Faithful re-implementation of the DSH codex-subagent wire layer:
//   @deepseek-ai/dsh-subagent-codex@0.2.2-rc.1 -> lib/index.js
//   CodexAppServerWire + startCodexRun
//
// Purpose: drive `codex app-server --stdio` over newline-delimited JSON-RPC 2.0
// with exactly the requests/notifications the plugin sends, so the fork can
// measure whether its packaged Codex build still accepts that wire sequence.
//
// No environment is logged; only JSON-RPC frames (plus a redacted stderr tail).

import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { createWriteStream, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { StringDecoder } from "node:string_decoder";

export const ROOT = dirname(fileURLToPath(import.meta.url));
export const LOG_DIR = join(ROOT, "logs");
export const RESULT_DIR = join(ROOT, "results");
export const TMP_DIR = join(ROOT, "tmp", "probe");

// ---------------------------------------------------------------------------
// The payload under test is the one this fork pins: `@openai/codex` resolved
// from the fork package. `DSH_CODEX_PACKAGE` overrides the package/alias name.
// A complete command passed to runProbe() bypasses this resolution entirely.
// ---------------------------------------------------------------------------
const requireHere = createRequire(import.meta.url);

/** Resolve the official wrapper of a package (or npm alias) pinned by this fork. */
export function resolvePackagedCommand(packageName) {
  const codexPackageJsonPath = requireHere.resolve(`${packageName}/package.json`);
  const codexPackageManifest = JSON.parse(
    readFileSync(codexPackageJsonPath, "utf8"),
  );
  return [
    process.execPath,
    resolve(dirname(codexPackageJsonPath), codexPackageManifest.bin.codex),
  ];
}

export const BINARIES = {
  packaged: {
    get argv() {
      return resolvePackagedCommand(process.env.DSH_CODEX_PACKAGE ?? "@openai/codex");
    },
    launchedBy: "packaged @openai/codex payload of this fork",
  },
};

export const APP_SERVER_ARGS = ["app-server", "--stdio"];

// Exactly as THREAD_PERMISSION_PARAMS in the plugin.
export const THREAD_PERMISSION_PARAMS = {
  never: { approvalPolicy: "never" },
  "approve-for-me": {
    approvalPolicy: "on-request",
    approvalsReviewer: "auto_review",
    sandbox: "workspace-write",
  },
  "dangerously-bypass-approvals-and-sandbox": {
    approvalPolicy: "never",
    sandbox: "danger-full-access",
  },
};

// ---------------------------------------------------------------------------
// Minimal line-delimited JSON-RPC transport (mirrors JsonRpcLineTransport).
// ---------------------------------------------------------------------------
export class LineTransport {
  constructor(input, output, transcript) {
    this.input = input;
    this.output = output;
    this.transcript = transcript; // (dir, message) => void
    this.buffer = "";
    this.decoder = new StringDecoder("utf8");
    this.pending = new Map();
    this.requestHandler = undefined;
    this.notificationHandler = undefined;
    this.failure = undefined;
    this.started = false;
  }

  start() {
    if (this.started) return;
    this.started = true;
    this.input.on("data", (chunk) => this.onData(chunk));
    this.input.on("error", (error) => this.failPending(error));
    this.input.on("end", () => {
      this.buffer += this.decoder.end();
      this.drainLines();
      this.failPending(new Error("JSON-RPC input closed"));
    });
  }

  close() {
    this.input.removeAllListeners("data");
    this.failPending(new Error("JSON-RPC transport closed"));
  }

  onRequest(handler) {
    this.requestHandler = handler;
  }

  onNotification(handler) {
    this.notificationHandler = handler;
  }

  request(method, params, timeoutMs) {
    if (this.failure !== undefined) return Promise.reject(this.failure);
    const id = `req_${randomUUID().replaceAll("-", "")}`;
    const message = { jsonrpc: "2.0", id, method, params };
    return new Promise((resolve, reject) => {
      let timer;
      const settle = (fn, value) => {
        if (timer) clearTimeout(timer);
        this.pending.delete(id);
        fn(value);
      };
      this.pending.set(id, {
        resolve: (value) => settle(resolve, value),
        reject: (error) => settle(reject, error),
      });
      if (timeoutMs !== undefined) {
        timer = setTimeout(() => {
          settle(reject, new Error(`spike: request ${method} timed out after ${timeoutMs}ms`));
        }, timeoutMs);
        timer.unref?.();
      }
      try {
        this.write(message);
      } catch (error) {
        this.pending.delete(id);
        reject(error);
      }
    });
  }

  notify(method, params) {
    this.write(params === undefined ? { jsonrpc: "2.0", method } : { jsonrpc: "2.0", method, params });
  }

  flush() {
    return new Promise((resolve) => this.output.write("", () => resolve()));
  }

  write(message) {
    this.transcript?.("out", message);
    this.output.write(`${JSON.stringify(message)}\n`);
  }

  writeResponse(id, result) {
    this.write({ jsonrpc: "2.0", id, result });
  }

  writeError(id, code, message) {
    this.write({ jsonrpc: "2.0", id, error: { code, message } });
  }

  onData(chunk) {
    this.buffer += typeof chunk === "string" ? chunk : this.decoder.write(chunk);
    this.drainLines();
  }

  drainLines() {
    for (;;) {
      const newline = this.buffer.indexOf("\n");
      if (newline < 0) break;
      const line = this.buffer.slice(0, newline).trim();
      this.buffer = this.buffer.slice(newline + 1);
      if (!line) continue;
      this.handleLine(line);
    }
  }

  handleLine(line) {
    let message;
    try {
      message = JSON.parse(line);
    } catch {
      this.transcript?.("in-unparsed", line);
      return;
    }
    this.transcript?.("in", message);
    if (!message || typeof message !== "object") return;
    const id = message.id;
    const method = message.method;
    if ((typeof id === "string" || typeof id === "number") && typeof method === "string") {
      void this.handleIncomingRequest(id, method, objectParams(message.params));
      return;
    }
    if (typeof id === "string" || typeof id === "number") {
      const pending = this.pending.get(id);
      if (!pending) return;
      this.pending.delete(id);
      if (message.error && typeof message.error === "object") {
        const error = new Error(typeof message.error.message === "string" ? message.error.message : "JSON-RPC error");
        error.code = message.error.code;
        error.data = message.error.data;
        pending.reject(error);
        return;
      }
      pending.resolve(message.result);
      return;
    }
    if (typeof method === "string") this.notificationHandler?.(method, objectParams(message.params));
  }

  async handleIncomingRequest(id, method, params) {
    const handler = this.requestHandler;
    if (!handler) {
      this.writeError(id, -32601, `method not found: ${method}`);
      return;
    }
    try {
      const result = await handler(method, params);
      this.writeResponse(id, result);
    } catch (error) {
      this.writeError(id, -32603, error instanceof Error ? error.message : String(error));
    }
  }

  failPending(error) {
    this.failure ??= error;
    const pending = [...this.pending.values()];
    this.pending.clear();
    for (const waiter of pending) waiter.reject(error);
  }
}

function objectParams(params) {
  return params && typeof params === "object" && !Array.isArray(params) ? params : {};
}

// ---------------------------------------------------------------------------
// Server → client requests: same switch as the plugin's handleServerRequest.
// ---------------------------------------------------------------------------
function object(value, label) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`subagent-codex: app-server returned invalid ${label}`);
  }
  return value;
}

function string(value, label) {
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`subagent-codex: app-server returned invalid ${label}`);
  }
  return value;
}

function unattendedDecision(params) {
  const available = params.availableDecisions;
  if (available === undefined || available === null) return "decline";
  if (Array.isArray(available)) {
    if (available.includes("cancel")) return "cancel";
    if (available.includes("decline")) return "decline";
  }
  throw new Error("subagent-codex: app-server offered no unattended approval decision");
}

function failureInfo(turn) {
  const error = turn.error;
  if (error === null || typeof error !== "object" || Array.isArray(error)) return {};
  return error.codexErrorInfo;
}

// ---------------------------------------------------------------------------
// The wire driver: one process, initialize + thread/start + one turn.
// ---------------------------------------------------------------------------
export async function runProbe(options) {
  const {
    binaryId,
    command,
    model,
    mode = "never",
    prompt = "Reply with exactly: OK",
    timeoutMs = 150_000,
    requestTimeoutMs = 60_000,
    cwd = TMP_DIR,
    writeTurn = true,
    extraThreadParams = {},
    slug = `${binaryId ?? "probe"}-${model ?? "model-default"}-${mode}`,
  } = options;

  const binary = command === undefined ? BINARIES[binaryId ?? "packaged"] : undefined;
  if (command === undefined && !binary) throw new Error(`unknown binary id ${JSON.stringify(binaryId)}`);
  mkdirSync(LOG_DIR, { recursive: true });
  mkdirSync(RESULT_DIR, { recursive: true });
  mkdirSync(TMP_DIR, { recursive: true });
  mkdirSync(cwd, { recursive: true });

  const summary = {
    slug,
    binaryId,
    binaryVersion: undefined,
    model: model ?? null,
    mode,
    permissionParams: THREAD_PERMISSION_PARAMS[mode] ?? {},
    prompt,
    cwd,
    startedAt: new Date().toISOString(),
    outcome: "running",
    errorMessage: undefined,
    elapsedMs: 0,
    initialize: { ok: false },
    threadStart: { ok: false },
    turnStart: { ok: false },
    terminal: undefined,
    outputText: undefined,
    notifications: [], // {method, count}
    serverRequests: [], // raw {method, params}
    unknownServerRequests: [],
    stderrTail: undefined,
  };

  // Transcript: raw JSONL, one object per frame, no env/auth material.
  const logPath = join(LOG_DIR, `${slug}.jsonl`);
  const logStream = createWriteStream(logPath, { flags: "w" });
  const transcript = (dir, message) => {
    logStream.write(`${JSON.stringify({ ts: Date.now(), dir, message })}\n`);
  };

  let stderr = "";
  const startedAtMs = Date.now();
  const argv = command !== undefined ? [...command] : [...binary.argv, ...APP_SERVER_ARGS];
  const startedAt = new Date().toISOString();
  const child = spawn(argv[0], argv.slice(1), {
    cwd,
    env: process.env, // inherited, never logged
    stdio: ["pipe", "pipe", "pipe"],
    windowsHide: true,
  });
  child.stderr.on("data", (chunk) => {
    if (stderr.length < 128 * 1024) stderr += chunk.toString("utf8");
  });
  child.on("error", (error) => {
    summary.outcome = "spawn-error";
    summary.errorMessage = `spawn failed: ${error.message}`;
  });

  const transport = new LineTransport(child.stdout, child.stdin, transcript);
  const notifications = new Map();
  const serverRequests = [];
  const unknownServerRequests = [];
  let threadId;
  let turnId;
  let pendingTurnId;
  let turnCompleted; // {resolve, reject, promise}
  let earlyTurnNotifications = [];
  let lastFinalAnswer;
  let lastPartialAnswer;
  let lastUnphasedAnswer;
  let fatalReject;
  const fatal = new Promise((_, reject) => {
    fatalReject = reject;
  });
  fatal.catch(() => {});

  const recordNotification = (method) => {
    notifications.set(method, (notifications.get(method) ?? 0) + 1);
  };
  const recordServerRequest = (method, params) => {
    serverRequests.push({ method, params });
    transcript("server-request", { method, params });
  };
  const observePendingTurnId = (id) => {
    if (turnCompleted === undefined) throw new Error("subagent-codex: app-server referenced a turn before turn/start");
    if (pendingTurnId !== undefined && pendingTurnId !== id) {
      throw new Error("subagent-codex: app-server referenced conflicting turns");
    }
    pendingTurnId = id;
  };
  const commitTurnId = (id) => {
    if (pendingTurnId !== undefined && pendingTurnId !== id) {
      throw new Error("subagent-codex: turn/start response did not match the active turn");
    }
    turnId = id;
    const queued = earlyTurnNotifications.splice(0);
    for (const notification of queued) handleNotification(notification.method, notification.params, notification.order);
  };
  const collectOutput = () => {
    const selected = lastFinalAnswer ?? lastPartialAnswer ?? lastUnphasedAnswer;
    return selected !== undefined && selected.trim().length > 0 ? selected : undefined;
  };

  function handleNotification(method, params, order) {
    recordNotification(method);
    if (method === "turn/started") {
      if (string(params.threadId, "turn/started thread id") !== threadId) return;
      const turn = object(params.turn, "turn/started turn");
      if (turnCompleted !== undefined && turnId === undefined) observePendingTurnId(string(turn.id, "turn/started turn id"));
      return;
    }
    if (method === "item/completed") {
      if (string(params.threadId, "item/completed thread id") !== threadId) return;
      const id = string(params.turnId, "item/completed turn id");
      if (turnId === undefined) {
        if (turnCompleted !== undefined) {
          observePendingTurnId(id);
          earlyTurnNotifications.push({ method, params, order });
        }
        return;
      }
      if (id !== turnId) return;
      const item = object(params.item, "item/completed item");
      if (item.type !== "agentMessage") return;
      const text = typeof item.text === "string" ? item.text : (() => {
        throw new Error("subagent-codex: app-server returned an invalid agent message");
      })();
      if (item.phase === "final_answer") lastFinalAnswer = text;
      else if (item.phase === "partial_answer") lastPartialAnswer = text;
      else if (item.phase === null) lastUnphasedAnswer = text;
      else if (item.phase !== "commentary") throw new Error(`subagent-codex: app-server returned an unknown agent message phase ${JSON.stringify(item.phase)}`);
      return;
    }
    if (method !== "turn/completed") return;
    if (threadId === undefined || string(params.threadId, "turn/completed thread id") !== threadId) return;
    const turn = object(params.turn, "turn/completed turn");
    const id = string(turn.id, "turn/completed turn id");
    const completion = turnCompleted;
    if (completion === undefined) return;
    if (turnId === undefined) {
      observePendingTurnId(id);
      earlyTurnNotifications.push({ method, params, order });
      return;
    }
    if (id !== turnId) return;
    completion.resolve({ params, order: order ?? 0 });
  }

  function handleServerRequest(method, params) {
    try {
      recordServerRequest(method, params);
      switch (method) {
        case "item/commandExecution/requestApproval": {
          const id = validateRunIds(params);
          if (id === "provisional") observePendingTurnId(string(params.turnId, "server request turn id"));
          const decision = unattendedDecision(params);
          return Promise.resolve({ decision });
        }
        case "item/fileChange/requestApproval": {
          const id = validateRunIds(params);
          if (id === "provisional") observePendingTurnId(string(params.turnId, "server request turn id"));
          const decision = unattendedDecision(params);
          return Promise.resolve({ decision });
        }
        case "item/permissions/requestApproval":
          validateRunIds(params);
          return Promise.resolve({ permissions: {}, scope: "turn" });
        case "item/tool/requestUserInput":
          validateRunIds(params);
          return Promise.resolve({ answers: {} });
        case "mcpServer/elicitation/request": {
          validateRunIds(params, true);
          return Promise.resolve({ action: "decline", content: null, _meta: null });
        }
        default: {
          unknownServerRequests.push({ method, params });
          throw new Error(`subagent-codex: unsupported app-server request ${JSON.stringify(method)}`);
        }
      }
    } catch (error) {
      fatalReject(error);
      return Promise.reject(error);
    }
  }

  function validateRunIds(params, nullableTurn = false) {
    if (params.threadId !== threadId) throw new Error("subagent-codex: app-server request referenced another thread");
    if (nullableTurn && params.turnId === null) return "none";
    const id = string(params.turnId, "server request turn id");
    if (turnId === undefined) return "provisional";
    if (id !== turnId) throw new Error("subagent-codex: app-server request referenced another turn");
    return "current";
  }

  transport.onRequest(handleServerRequest);
  transport.onNotification((method, params) => {
    try {
      handleNotification(method, params);
    } catch (error) {
      fatalReject(error);
    }
  });

  let timedOut = false;
  const deadline = setTimeout(() => {
    timedOut = true;
  }, timeoutMs);

  const killChild = () => {
    try {
      child.stdin.end();
    } catch {}
    try {
      child.kill("SIGKILL");
    } catch {}
  };

  try {
    transport.start();

    // ---- initialize (exact plugin payload) --------------------------------
    const initStart = Date.now();
    const initResult = await Promise.race([
      transport.request(
        "initialize",
        {
          clientInfo: { name: "deepseek-harness", title: "DeepSeek Harness", version: "0.0.1" },
          capabilities: { experimentalApi: false, requestAttestation: false },
        },
        requestTimeoutMs,
      ),
      fatal,
    ]);
    summary.initialize = { ok: true, elapsedMs: Date.now() - initStart, result: initResult };
    transport.notify("initialized");
    await transport.flush();

    // ---- thread/start (exact plugin payload) ------------------------------
    const threadStart = Date.now();
    const threadResult = await Promise.race([
      transport.request(
        "thread/start",
        {
          cwd,
          ephemeral: true,
          ...(model === undefined ? {} : { model }),
          ...THREAD_PERMISSION_PARAMS[mode],
          ...extraThreadParams,
        },
        requestTimeoutMs,
      ),
      fatal,
    ]);
    const thread = object(object(threadResult, "thread/start response").thread, "thread/start thread");
    threadId = string(thread.id, "thread/start thread id");
    summary.threadStart = {
      ok: true,
      elapsedMs: Date.now() - threadStart,
      threadId,
      ephemeral: thread.ephemeral,
      // Newer builds may add fields; keep the whole response for drift analysis.
      result: threadResult,
    };
    if (thread.ephemeral !== true) throw new Error("subagent-codex: app-server did not create an ephemeral thread");

    if (!writeTurn) {
      summary.outcome = "handshake-only";
      return summary;
    }

    // ---- turn/start (exact plugin payload) --------------------------------
    turnCompleted = {};
    turnCompleted.promise = new Promise((resolve) => {
      turnCompleted.resolve = resolve;
    });
    const turnStartAt = Date.now();
    const turnResult = await Promise.race([
      transport.request(
        "turn/start",
        { threadId, input: [{ type: "text", text: prompt, text_elements: [] }] },
        requestTimeoutMs,
      ),
      fatal,
    ]);
    const turn = object(object(turnResult, "turn/start response").turn, "turn/start turn");
    summary.turnStart = { ok: true, elapsedMs: Date.now() - turnStartAt, turnId: turn.id, result: turnResult };
    commitTurnId(string(turn.id, "turn/start turn id"));

    // ---- wait for turn/completed -----------------------------------------
    const completed = await Promise.race([turnCompleted.promise, fatal]);
    const terminal = object(completed.params.turn, "turn/completed turn");
    summary.terminal = {
      status: terminal.status,
      error: terminal.error ?? null,
      codexErrorInfo: terminal.error ? failureInfo(terminal) : undefined,
    };
    summary.outputText = collectOutput();
    const phases = { final: lastFinalAnswer, partial: lastPartialAnswer, unphased: lastUnphasedAnswer };
    summary.phases = phases;
    const status = terminal.status;
    if (status === "completed") {
      summary.outcome = summary.outputText === undefined ? "turn-completed-without-answer" : "success";
    } else {
      summary.outcome = `turn-${String(status)}`;
    }
  } catch (error) {
    if (timedOut) {
      summary.outcome = "timeout";
      summary.errorMessage = `spike: no terminal turn within ${timeoutMs}ms`;
    } else if (summary.outcome === "spawn-error") {
      // already recorded
    } else if (summary.initialize.ok === false) {
      summary.outcome = "startup-error";
      summary.errorMessage = error instanceof Error ? error.message : String(error);
      summary.initialize.error = serializeError(error);
    } else if (summary.threadStart.ok === false) {
      summary.outcome = "thread-start-failed";
      summary.errorMessage = error instanceof Error ? error.message : String(error);
      summary.threadStart.error = serializeError(error);
    } else if (summary.turnStart.ok === false) {
      summary.outcome = "turn-start-failed";
      summary.errorMessage = error instanceof Error ? error.message : String(error);
      summary.turnStart.error = serializeError(error);
    } else {
      summary.outcome = "wire-error";
      summary.errorMessage = error instanceof Error ? error.message : String(error);
    }
  } finally {
    clearTimeout(deadline);
    summary.notifications = [...notifications.entries()].map(([method, count]) => ({ method, count }));
    summary.serverRequests = serverRequests;
    summary.unknownServerRequests = unknownServerRequests;
    summary.stderrTail = redact(stderr).split(/\r?\n/).slice(-80).join("\n");
    summary.elapsedMs = Date.now() - startedAtMs;
    transport.close();
    killChild();
    await new Promise((resolve) => child.once("close", resolve));
    logStream.end();
    logStream.on("close", () => {});
    try {
      writeFileSync(join(RESULT_DIR, `${slug}.json`), `${JSON.stringify(summary, null, 2)}\n`);
    } catch {}
  }
  return summary;
}

function serializeError(error) {
  if (!(error instanceof Error)) return { message: String(error) };
  const out = { name: error.name, message: error.message };
  if ("code" in error) out.code = error.code;
  if ("data" in error) out.data = error.data;
  return out;
}

/** Remove anything token-shaped from captured stderr before persisting it. */
export function redact(text) {
  return text
    .replace(/sk-[A-Za-z0-9_-]{16,}/g, "[REDACTED_SECRET]")
    .replace(/((?:"?(?:access|refresh|id|session)_?token"?\s*[:=]\s*"?)Bearer\s+)[A-Za-z0-9._~+/-]+=*/gi, "$1[REDACTED]")
    .replace(/Bearer\s+[A-Za-z0-9._~+/-]+=*/g, "Bearer [REDACTED]")
    .replace(/("(?:access_token|refresh_token|id_token|api_key|password)"\s*:\s*)"[^"]*"/gi, '$1"[REDACTED]"');
}

/** Print a compact one-line verdict for a summary (used by CLI + matrix). */
export function verdictLine(summary) {
  const t = summary.terminal;
  const info = t?.codexErrorInfo === undefined ? "" : ` codexErrorInfo=${JSON.stringify(t.codexErrorInfo)}`;
  const err = t?.error ? ` error=${JSON.stringify(t.error)}` : "";
  const out = summary.outputText === undefined ? "" : ` output=${JSON.stringify(summary.outputText)}`;
  return `${summary.binaryId} | model=${summary.model ?? "(default)"} | mode=${summary.mode} | outcome=${summary.outcome}${t ? ` | turnStatus=${t.status}` : ""}${info}${err}${out} | ${summary.elapsedMs}ms`;
}
