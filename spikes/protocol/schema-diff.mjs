// Schema drift: compare the generated app-server JSON Schemas for the plugin's
// pinned 0.153.4, 0.166.0 and the desktop app binary 0.169.0-alpha.11.1.
//
// Focus: the exact protocol surface the plugin uses.
//   - client notifications:  initialized
//   - client requests:       initialize, thread/start, turn/start, turn/interrupt
//   - server requests:       item/commandExecution/requestApproval,
//                            item/fileChange/requestApproval,
//                            item/permissions/requestApproval,
//                            item/tool/requestUserInput, mcpServer/elicitation/request
//   - server notifications:  turn/started, item/completed, turn/completed
//   - required fields of InitializeParams, ThreadStartParams, TurnStartParams
//   - approve-for-me fields (approvalsReviewer / sandbox / approvalPolicy)
//   - agentMessage phase enum, UserInput.text_elements, InitializeCapabilities
//
// Usage: node spikes/protocol/schema-diff.mjs

import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";

const ROOT = import.meta.dirname;
const SCHEMA_DIR = join(ROOT, "schema");
const VERSIONS = ["plugin-0.153.4", "0.166.0", "app-0.169.0-alpha.11.1"];

function readSchema(version, relativePath) {
  const path = join(SCHEMA_DIR, version, relativePath);
  if (!existsSync(path)) return undefined;
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch {
    return undefined;
  }
}

/** Method names declared in a JSON-RPC frame union (`method` enum or const). */
function methodList(version, file) {
  const schema = readSchema(version, file);
  if (!schema) return undefined;
  const variants = schema.oneOf ?? schema.anyOf ?? [];
  const methods = new Set();
  for (const variant of variants) {
    const method = variant?.properties?.method;
    if (typeof method?.const === "string") methods.add(method.const);
    for (const value of method?.enum ?? []) if (typeof value === "string") methods.add(value);
  }
  return [...methods].sort();
}

/** Root-level required/properties of a params schema (schemars puts them at the root). */
function rootShape(version, file) {
  const schema = readSchema(version, file);
  if (!schema) return undefined;
  return {
    required: Array.isArray(schema.required) ? [...schema.required].sort() : [],
    properties: schema.properties && typeof schema.properties === "object" ? Object.keys(schema.properties).sort() : [],
    additionalProperties: schema.additionalProperties,
  };
}

/** Named definitions within one generated schema file. */
function definitions(version, file) {
  return readSchema(version, file)?.definitions ?? {};
}

function definitionShape(version, file, name) {
  const definition = definitions(version, file)[name];
  if (!definition || typeof definition !== "object") return undefined;
  return {
    required: Array.isArray(definition.required) ? [...definition.required].sort() : [],
    properties: definition.properties && typeof definition.properties === "object" ? Object.keys(definition.properties).sort() : [],
    enum: definition.enum,
    oneOf: definition.oneOf,
    additionalProperties: definition.additionalProperties,
  };
}

const KEY_CLIENT_REQUESTS = ["initialize", "thread/start", "turn/start", "turn/interrupt"];
const KEY_CLIENT_NOTIFICATIONS = ["initialized"];
const KEY_SERVER_REQUESTS = [
  "item/commandExecution/requestApproval",
  "item/fileChange/requestApproval",
  "item/permissions/requestApproval",
  "item/tool/requestUserInput",
  "mcpServer/elicitation/request",
];
const KEY_SERVER_NOTIFICATIONS = ["turn/started", "item/completed", "turn/completed"];

const report = {
  generatedAt: new Date().toISOString(),
  versions: VERSIONS,
  protocolSurface: {},
  params: {},
  capabilities: {},
  agentMessage: {},
  input: {},
  thread: {},
  methodsDiff: {},
};

for (const version of VERSIONS) {
  const surface = {
    clientRequests: methodList(version, "ClientRequest.json"),
    clientNotifications: methodList(version, "ClientNotification.json"),
    serverRequests: methodList(version, "ServerRequest.json"),
    serverNotifications: methodList(version, "ServerNotification.json"),
  };

  report.protocolSurface[version] = {
    counts: Object.fromEntries(Object.entries(surface).map(([kind, list]) => [kind, list?.length ?? null])),
    keyClientRequestsPresent: Object.fromEntries(
      KEY_CLIENT_REQUESTS.map((method) => [method, surface.clientRequests?.includes(method) ?? null]),
    ),
    keyClientNotificationsPresent: Object.fromEntries(
      KEY_CLIENT_NOTIFICATIONS.map((method) => [method, surface.clientNotifications?.includes(method) ?? null]),
    ),
    keyServerRequestsPresent: Object.fromEntries(
      KEY_SERVER_REQUESTS.map((method) => [method, surface.serverRequests?.includes(method) ?? null]),
    ),
    keyServerNotificationsPresent: Object.fromEntries(
      KEY_SERVER_NOTIFICATIONS.map((method) => [method, surface.serverNotifications?.includes(method) ?? null]),
    ),
    clientRequests: surface.clientRequests,
    serverRequests: surface.serverRequests,
    serverNotifications: surface.serverNotifications,
  };

  const initializeParams = rootShape(version, "v1/InitializeParams.json");
  const initializeCapabilities = definitionShape(version, "v1/InitializeParams.json", "InitializeCapabilities");
  const clientInfo = definitionShape(version, "v1/InitializeParams.json", "ClientInfo");
  const initializeResponse = rootShape(version, "v1/InitializeResponse.json");
  const threadStart = rootShape(version, "v2/ThreadStartParams.json");
  const turnStart = rootShape(version, "v2/TurnStartParams.json");
  const threadStartResponse = rootShape(version, "v2/ThreadStartResponse.json");
  const turnCompleted = rootShape(version, "v2/TurnCompletedNotification.json");
  const itemCompleted = rootShape(version, "v2/ItemCompletedNotification.json");
  const threadStartParamsDefs = definitions(version, "v2/ThreadStartParams.json");
  const turnStartDefs = definitions(version, "v2/TurnStartParams.json");
  const itemCompletedDefs = definitions(version, "v2/ItemCompletedNotification.json");
  const threadStartResponseDefs = definitions(version, "v2/ThreadStartResponse.json");

  report.params[version] = {
    initialize: {
      required: initializeParams?.required ?? null,
      properties: initializeParams?.properties ?? null,
      response: initializeResponse === undefined ? null : { required: initializeResponse.required },
    },
    threadStart: {
      required: threadStart?.required ?? null,
      properties: threadStart?.properties ?? null,
      approvalsReviewer: threadStart?.properties?.includes("approvalsReviewer") ?? null,
      sandbox: threadStart?.properties?.includes("sandbox") ?? null,
      approvalPolicy: threadStart?.properties?.includes("approvalPolicy") ?? null,
      ephemeral: threadStart?.properties?.includes("ephemeral") ?? null,
      model: threadStart?.properties?.includes("model") ?? null,
      response: threadStartResponse === undefined ? null : { required: threadStartResponse.required, properties: threadStartResponse.properties },
    },
    turnStart: {
      required: turnStart?.required ?? null,
      properties: turnStart?.properties ?? null,
      input: turnStart?.properties?.includes("input") ?? null,
      threadId: turnStart?.properties?.includes("threadId") ?? null,
    },
    turnCompleted: turnCompleted ? { required: turnCompleted.required, properties: turnCompleted.properties } : null,
    itemCompleted: itemCompleted ? { required: itemCompleted.required, properties: itemCompleted.properties } : null,
  };

  report.capabilities[version] = {
    initializeCapabilities,
    clientInfo,
    threadStartParamsDefs: Object.keys(threadStartParamsDefs).filter((name) => /Approval|Sandbox|Reviewer/i.test(name)),
    turnStartParamsDefs: Object.keys(turnStartDefs).filter((name) => /Approval|Input|TurnStart/i.test(name)),
  };

  // agentMessage phase: the MessagePhase enum referenced from the agentMessage item definition.
  const messagePhase = definitionShape(version, "v2/ItemCompletedNotification.json", "MessagePhase");
  const agentMessage = Object.entries(itemCompletedDefs).find(
    ([, value]) => value?.properties?.phase && value?.properties?.type?.enum?.includes("agentMessage"),
  );
  report.agentMessage[version] = {
    messagePhaseEnum: messagePhase?.enum ?? null,
    agentMessageItem: agentMessage ? { name: agentMessage[0], required: [...(agentMessage[1].required ?? [])].sort(), properties: Object.keys(agentMessage[1].properties ?? {}).sort() } : null,
  };

  // UserInput carries { type:"text", text, text_elements } for turn/start.
  const userInput = definitionShape(version, "v2/ItemCompletedNotification.json", "UserInput") ?? definitionShape(version, "v2/TurnStartParams.json", "UserInput");
  const userInputDef = definitions(version, "v2/ItemCompletedNotification.json").UserInput ?? definitions(version, "v2/TurnStartParams.json").UserInput;
  const textVariant = userInputDef?.oneOf?.find((variant) => variant?.properties?.type?.enum?.includes("text"));
  report.input[version] = {
    userInputFound: Boolean(userInputDef),
    textVariantRequired: textVariant?.required ? [...textVariant.required].sort() : null,
    textVariantProperties: textVariant?.properties ? Object.keys(textVariant.properties).sort() : null,
    textElementsDeclared: Boolean(textVariant?.properties?.text_elements),
  };

  // Thread object: `ephemeral` must still exist and be true in the response.
  const threadDefinition = threadStartResponseDefs.Thread ??
    Object.entries(threadStartResponseDefs).find(([, value]) => value?.properties?.ephemeral)?.[1];
  report.thread[version] = threadDefinition
    ? {
        required: [...(threadDefinition.required ?? [])].sort(),
        properties: Object.keys(threadDefinition.properties ?? {}).sort(),
        ephemeralDeclared: Boolean(threadDefinition.properties?.ephemeral),
        ephemeralRequired: threadDefinition.required?.includes("ephemeral") ?? false,
      }
    : null;
}

// Method-level diffs between consecutive versions.
for (let index = 1; index < VERSIONS.length; index += 1) {
  const previous = VERSIONS[index - 1];
  const current = VERSIONS[index];
  const diff = {};
  for (const [kind, file] of [
    ["clientRequests", "ClientRequest.json"],
    ["clientNotifications", "ClientNotification.json"],
    ["serverRequests", "ServerRequest.json"],
    ["serverNotifications", "ServerNotification.json"],
  ]) {
    const before = new Set(methodList(previous, file) ?? []);
    const after = new Set(methodList(current, file) ?? []);
    diff[kind] = {
      added: [...after].filter((method) => !before.has(method)),
      removed: [...before].filter((method) => !after.has(method)),
    };
  }
  report.methodsDiff[`${previous} -> ${current}`] = diff;
}

const outPath = join(SCHEMA_DIR, "diff-summary.json");
writeFileSync(outPath, `${JSON.stringify(report, null, 2)}\n`);

// Console summary.
for (const version of VERSIONS) {
  const surface = report.protocolSurface[version];
  console.log(`\n### ${version}  counts=${JSON.stringify(surface.counts)}`);
  console.log(`  initialize required=${JSON.stringify(report.params[version].initialize.required)} response required=${JSON.stringify(report.params[version].initialize.response?.required)}`);
  console.log(`  InitializeCapabilities=${JSON.stringify(report.capabilities[version].initializeCapabilities)}`);
  console.log(`  thread/start required=${JSON.stringify(report.params[version].threadStart.required)} approve-for-me fields: approvalsReviewer=${report.params[version].threadStart.approvalsReviewer} sandbox=${report.params[version].threadStart.sandbox} approvalPolicy=${report.params[version].threadStart.approvalPolicy}`);
  console.log(`  turn/start required=${JSON.stringify(report.params[version].turnStart.required)}`);
  console.log(`  MessagePhase=${JSON.stringify(report.agentMessage[version].messagePhaseEnum)}`);
  console.log(`  UserInput text variant required=${JSON.stringify(report.input[version].textVariantRequired)} props=${JSON.stringify(report.input[version].textVariantProperties)} text_elements=${report.input[version].textElementsDeclared}`);
  console.log(`  Thread ephemeral declared=${report.thread[version]?.ephemeralDeclared} required=${report.thread[version]?.ephemeralRequired}`);
  console.log(`  key client requests: ${JSON.stringify(surface.keyClientRequestsPresent)}`);
  console.log(`  key server requests: ${JSON.stringify(surface.keyServerRequestsPresent)}`);
  console.log(`  key server notifications: ${JSON.stringify(surface.keyServerNotificationsPresent)}`);
}
console.log("\n### method diffs");
for (const [pair, diff] of Object.entries(report.methodsDiff)) {
  console.log(`  ${pair}:`);
  console.log(`    clientRequests +${diff.clientRequests.added.length} -${diff.clientRequests.removed.length}`);
  console.log(`    serverRequests +${diff.serverRequests.added.length} -${diff.serverRequests.removed.length}`);
  if (diff.serverRequests.removed.length > 0) console.log(`    REMOVED server requests: ${diff.serverRequests.removed.join(", ")}`);
  console.log(`    serverNotifications +${diff.serverNotifications.added.length} -${diff.serverNotifications.removed.length}`);
}
console.log(`\nwrote ${outPath}`);
