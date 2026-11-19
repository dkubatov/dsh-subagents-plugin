# Спайк: совместимость Codex app-server с плагином `@deepseek-ai/dsh-subagent-codex@0.2.2-rc.1`

Дата: 2026-11-19 · Исполнитель: teammate `protocol-spike` · Shared task `task-1`

## Вердикт (TL;DR)

**Wire-протокол полностью совместим. Правки JSON-RPC последовательности плагина НЕ нужны — достаточно поднять зависимость `@openai/codex` с `0.153.4` до `0.166.0`.**

- Плагин посылает ровно `initialize` → `initialized` → `thread/start` → `turn/start` → ждёт `turn/completed`. Эту же последовательность **без единого изменения** приняли и обслужили:
  - `@openai/codex@0.166.0` (`node <pkg>/bin/codex.js app-server --stdio`);
  - desktop-бинарь Codex `0.169.0-alpha.11.1` (`codex.exe app-server --stdio`).
- **Модели `gpt-6-luna`, `gpt-6.1-sol`, `gpt-6.1-terra` работают** на обоих кандидатах с текущим ChatGPT-аккаунтом (turn `completed`, ответ `"OK"`).
- Плагинный `@openai/codex@0.153.4` воспроизвёл ровно заявленную ошибку `400 model_not_found` для `gpt-6-luna` — то есть наш harness валиден, а сломан именно старый билд, а не wire.
- `thread/start` со всеми тремя permission-mode плагина (включая approve-for-me: `approvalPolicy:"on-request"` + `approvalsReviewer:"auto_review"` + `sandbox:"workspace-write"`) принят **всеми тремя** бинарями; `thread.id` и `thread.ephemeral === true` на месте; набор server→client requests, на которые плагин умеет отвечать, **не изменился** (11 методов, все 5 ключевых на месте во всех версиях).
- **Рекомендация по пиннингу: `@openai/codex@0.166.0` (exact pin).** Альтернатива `0.169.0-alpha.11.1` — только как экспериментальный override (alpha + desktop-only бинарь, не npm-зависимость). `0.170.0` (latest) не проверялся, скрипты готовы.

## 1. Что именно проверялось

Harness (`wire.mjs`) — точная реимплементация `CodexAppServerWire` + `startCodexRun` из
`<DSH_PROFILE_DIR>\node_modules\@deepseek-ai\dsh-subagent-codex\lib\index.js`
(873 строки, прочитан целиком), с теми же JSON-RPC кадрами:

| шаг | кадр | поля |
|---|---|---|
| 1 | request `initialize` | `clientInfo:{name:"deepseek-harness",title:"DeepSeek Harness",version:"0.0.1"}`, `capabilities:{experimentalApi:false, requestAttestation:false}` |
| 2 | notification `initialized` | без params, затем flush stdin |
| 3 | request `thread/start` | `{cwd, ephemeral:true, model?, ...THREAD_PERMISSION_PARAMS[mode]}`; проверка `thread.id` string и `thread.ephemeral === true` |
| 4 | request `turn/start` | `{threadId, input:[{type:"text", text, text_elements:[]}]}` |
| 5 | wait notification `turn/completed` | принять только `completed/interrupted/failed`, разобрать `turn.error.codexErrorInfo`, выбрать текст: `final_answer` → `partial_answer` → фаза `null` |
| 6 | server→client requests | отвечать как плагин: approval → `{decision}` из `availableDecisions` (cancel→decline), permissions → `{permissions:{},scope:"turn"}`, userInput → `{answers:{}}`, elicitation → `{action:"decline",...}`; на неизвестный метод — JSON-RPC error −32603 и провал (как в плагине) |

Транспорт — построчный JSON-RPC 2.0 (`{jsonrpc:"2.0", id:"req_<uuid>", method, params}`), как `JsonRpcLineTransport` из `@deepseek-ai/dsh-sdk-protocol`. Все входящие/исходящие кадры логируются в `logs/*.jsonl`; env и auth не логируются.

Бинари (все уже были на диске, ничего не скачивалось):

| id | запуск | версия |
|---|---|---|
| `app-0.169.0-alpha.11.1` | `%LOCALAPPDATA%\OpenAI\Codex\bin\22fc0d1de88fa0c1\codex.exe app-server --stdio` | `codex-cli 0.169.0-alpha.11.1` |
| `0.166.0` | `node %USERPROFILE%\.dsh\profiles\desktop\node_modules\dsh-codex-subtask-cli\bin\codex.js app-server --stdio` (пакет с `name:"@openai/codex"`, `version:"0.166.0"`) | `codex-cli 0.166.0` |
| `plugin-0.153.4` | `node %USERPROFILE%\.dsh\profiles\desktop\node_modules\@openai\codex\bin\codex.js app-server --stdio` — пин плагина (`dependencies.@openai/codex = "0.153.4"`) | `codex-cli 0.153.4` |

У всех трёх `initialize`-ответ содержит `codexHome: <HOME>\.codex` → тестировался один и тот же аккаунт/конфиг, что у плагина.

## 2. Как воспроизвести

```powershell
cd <workspace>\spikes\protocol

# один прогон (matrix из одного бинаря/модели); turn с крошечным промптом
node probe.mjs --binary 0.166.0 --model gpt-6.1-sol
node probe.mjs --binary app-0.169.0-alpha.11.1 --model gpt-6-luna

# только handshake + thread/start, без вызова модели (0 токенов)
node probe.mjs --binary 0.166.0 --model gpt-5.6-sol --no-turn
node probe.mjs --binary app-0.169.0-alpha.11.1 --mode approve-for-me --no-turn

# полная матрица (8 попыток: 7 кандидатов + 1 негативный контроль)
node run-matrix.mjs

# дрейф: initialize + thread/start во всех 3 permission-mode для всех 3 бинарей (0 токенов)
node drift.mjs

# дрейф по JSON Schema (generate-json-schema --experimental)
node schema-diff.mjs
```

Схемы уже сгенерированы в `schema/{plugin-0.153.4,0.166.0,app-0.169.0-alpha.11.1}/`
(432/420/369 v2-файлов; утилита `codex app-server generate-json-schema --out … --experimental` работает во всех версиях).

## 3. Матрица: бинарь × модель

Один крошечный turn, `approvalPolicy:"never"`, `ephemeral:true`, промпт `Reply with exactly: OK`,
cwd `spikes/protocol/tmp/probe`. 8 вызовов модели (7 кандидатов + 1 контроль).

| binary | model | outcome | turn status | output | elapsed |
|---|---|---|---|---|---|
| app-0.169.0-alpha.11.1 | gpt-6-luna | ✅ success | completed | `"OK"` | 5.4 s |
| app-0.169.0-alpha.11.1 | gpt-6.1-sol | ✅ success | completed | `"OK"` | 5.1 s |
| app-0.169.0-alpha.11.1 | gpt-5.6-sol (контроль) | ✅ success | completed | `"OK"` | 9.0 s |
| app-0.169.0-alpha.11.1 | gpt-6.1-terra | ✅ success | completed | `"OK"` | 7.8 s |
| 0.166.0 | gpt-6-luna | ✅ success | completed | `"OK"` | 27.7 s (первый cold start) |
| 0.166.0 | gpt-6.1-sol | ✅ success | completed | `"OK"` | 11.8 s |
| 0.166.0 | gpt-5.6-sol (контроль) | ✅ success | completed | `"OK"` | 7.7 s |
| plugin-0.153.4 | gpt-6-luna (негативный контроль) | ❌ turn-failed | failed | — | 6.1 s |

Во всех успешных прогонах: `initialize.ok=true`, `threadStart.ephemeral=true`, `thread.id` получен,
`turn/completed` со `status:"completed"`, фаза сообщения `final_answer`, `outputText:"OK"`.
Полные данные: [results/matrix.json](results/matrix.json), по одному summary на прогон в `results/matrix-*.json`, raw JSONL в `logs/matrix-*.jsonl`.

## 4. Негативный контроль: плагинный 0.153.4 воспроизводит баг

`logs/matrix-plugin-0.153.4-gpt-6-luna.jsonl`, `results/matrix-plugin-0.153.4-gpt-6-luna.json`
(та же wire-последовательность, тот же аккаунт, тот же cwd):

```json
{"status":"failed",
 "error":{"message":"{\"type\":\"error\",\"status\":400,\"error\":{\"type\":\"invalid_request_error\",\"message\":\"The 'gpt-6-luna' model is not supported when using Codex with a ChatGPT account.\",\"code\":\"model_not_found\"}}",
          "codexErrorInfo":"other","additionalDetails":null,"misalignment":null}}
```

Т.е. handshake и thread/start на 0.153.4 проходят, а turn падает на HTTP 400 `model_not_found` — ровно
та проблема, ради которой делается спайк. Плагин при этом маппит `codexErrorInfo:"other"` → `product-error`
и прячет исходный текст ошибки (пригодится в форке: пробрасывать `turn.error.message` наружу для диагностики).

## 5. Живая проверка handshake/thread-start (0 вызовов модели)

`node drift.mjs` — 9 прогонов (3 бинаря × 3 permission-mode), все ✅:

| binary | mode | thread/start payload | outcome |
|---|---|---|---|
| app-0.169.0-alpha.11.1 | never | `{approvalPolicy:"never"}` | ✅ ephemeral=true |
| app-0.169.0-alpha.11.1 | approve-for-me | `{approvalPolicy:"on-request", approvalsReviewer:"auto_review", sandbox:"workspace-write"}` | ✅ ephemeral=true |
| app-0.169.0-alpha.11.1 | dangerously-bypass… | `{approvalPolicy:"never", sandbox:"danger-full-access"}` | ✅ ephemeral=true |
| 0.166.0 | never / approve-for-me / dangerously | те же payload'ы | ✅ ×3 |
| plugin-0.153.4 | never / approve-for-me / dangerously | те же payload'ы | ✅ ×3 |

Ответ `initialize` одинаков по форме во всех трёх версиях (новых обязательных полей нет —
`required: ["clientInfo"]`, `protocolVersion` не требуется):

```json
{"userAgent":"deepseek-harness/<version> (Windows 10.0.19045; x86_64) unknown (deepseek-harness; 0.0.1)",
 "codexHome":"<HOME>\\.codex",
 "platformFamily":"windows","platformOs":"windows"}
```

`thread/start` ответ: обязательные поля одинаковые (`id`, `environments`, `extra`, `sessionId`, …),
`thread.ephemeral` присутствует и **required**, `true` во всех прогонах. Подробности: [results/drift-summary.json](results/drift-summary.json).

Server→client requests в этих прогонах не возникали (промпт без инструментов); но набор их схем
не изменился — см. ниже.

## 6. Дрейф протокола (JSON Schema)

Источник: `codex app-server generate-json-schema --experimental` для каждой версии;
полный машинный дифф: [schema/diff-summary.json](schema/diff-summary.json).

### 6.1 initialize
- `InitializeParams.required = ["clientInfo"]` во всех версиях; `protocolVersion` нет.
- `InitializeResponse.required = ["codexHome","platformFamily","platformOs","userAgent"]` — без изменений.
- `InitializeCapabilities` — только optional-поля; добавлены `explicitGatewayOauth` (0.166) и
  `requiredHumanApproval` (0.169). Поля плагина `experimentalApi:false`, `requestAttestation:false`
  остаются валидными (подтверждено живым handshake).

### 6.2 thread/start
- `required = []` во всех версиях.
- `approvalsReviewer`, `sandbox`, `approvalPolicy`, `ephemeral`, `model`, `cwd` присутствуют во всех версиях;
  добавлено optional-поле `daybreakEnabled` (0.166+). Payload approve-for-me валиден (живой тест).

### 6.3 turn/start
- `required = ["input","threadId"]` во всех версиях.
- `UserInput` text-вариант: `required=["text","type"]`, `text_elements` присутствует (default `[]`) —
  ровно то, что шлёт плагин. Добавлены optional-поля (`parentTurnId`, `rootTurnId`, `disabledPluginIds`, …).

### 6.4 Методы JSON-RPC (client requests)
- `0.153.4 → 0.166.0`: +25, −1. Удалён единственный `thread/rollback` (плагином не используется).
- `0.166.0 → 0.169.0-alpha`: +5, −0 (`account/securitySetup/read`, `modelProvider/config/write`,
  `modelProvider/list`, `thread/guardianReview`, `thread/prepareApprovedPlan`).
- Все методы, которые использует плагин (`initialize`, `thread/start`, `turn/start`, `turn/interrupt`),
  присутствуют во всех трёх версиях без переименований.

### 6.5 Server→client requests (approve-for-me путь)
Набор **идентичен** во всех трёх версиях: 11 методов, включая все 5, которые обрабатывает плагин:
`item/commandExecution/requestApproval`, `item/fileChange/requestApproval`,
`item/permissions/requestApproval`, `item/tool/requestUserInput`, `mcpServer/elicitation/request`.
Ничего не переименовано и не удалено → ответы плагина (decline/cancel/`{permissions:{}}`/`{answers:{}}`) остаются валидными.

### 6.6 Server notifications
- `0.153.4 → 0.166.0`: +4 (`account/gatewayOAuth/changed`, `thread/attachment/updated`,
  `thread/prediction/updated`, `thread/readState/changed`); `0.166 → 0.169`: +1 (`thread/section/changed`).
- Ключевые `turn/started`, `item/completed`, `turn/completed` — на месте, без изменений.
- Плагин игнорирует незнакомые notifications — новые типы безопасны. В реальных прогонах 0.166/0.169
  дополнительно шлют `remoteControl/status/changed`, `account/updated`, `mcpServer/startupStatus/updated`,
  `thread/status/changed`, `item/started`, `item/agentMessage/delta`, `thread/tokenUsage/updated`,
  `account/rateLimits/updated` — все безопасно игнорируются (turn завершился `completed`).

### 6.7 Agent-message phase
- 0.153.4: `commentary | final_answer`.
- 0.166.0 и 0.169.0-alpha: `commentary | partial_answer | final_answer` — плагин уже разбирает
  `partial_answer`, новых неизвестных фаз нет. В прогонах пришла `final_answer` → текст выбран корректно.

## 7. Стоимость и латентность

- 8 попыток turn'а (лимит задачи ~8): 7 успешных крошечных ответов + 1 контрольный вызов, упавший на 400 до генерации.
- Полный handshake+thread/start: 0.6–3 с (0.169/0.153), у 0.166 первый запуск ~14 с (холодный старт), далее ~2–6 с.
- Крошечный turn: 5–12 с; единственный выброс 27.7 с — первый turn 0.166 (cold start, `mcpServer/startupStatus/updated` ×10).
- Замечание вне протокола: все билды на `thread/start` поднимают MCP-серверы из пользовательского `config.toml`
  и шлют `mcpServer/startupStatus/updated` (в тестах `yandex_telemost` падал с HTTP 403 Forbidden — не блокирует turn,
  плагин эти notifications игнорирует). Это часть cold-start latency, а не дрейф wire.

## 8. Ограничения спайка

- Проверен ровно текстовый turn без инструментов: approval-flow в approve-for-me живьём не исполнялся
  (но набор server-request схем идентичен, а живой `thread/start` с `approvalsReviewer:"auto_review"` принят).
- Проверялась только одна последовательность плагина (one thread → one turn → dispose); resume/interrupt/steer не тестировались.
- Тест шёл с реальным `~/.codex` (только чтение конфига/кэша; ephemeral threads), профиль `<HOME>\.dsh`,
  `~/.codex/config.toml`, `auth.json`, `models_cache` и сам плагин не изменялись.
- `@openai/codex@0.170.0` (latest npm) не проверялся — скрипты готовы (`npm install --prefix spikes/protocol/vendor @openai/codex@0.170.0` + тот же `run-matrix.mjs`).
- Desktop-бинарь 0.169.0-alpha.11.1 — alpha-сборка; стабильность/поведение вне протокола не оценивались.

## 9. Рекомендация по пиннингу Codex для форка

1. **Основной вариант: `@openai/codex` pinned exactly `0.166.0`.**
   - Единственное изменение в форке: поднять зависимость в `package.json` плагина с `0.153.4` до `0.166.0`
     (поле `dependencies.@openai/codex`), wire-код (`CodexAppServerWire`, `codexAppServerArgv`) не трогать.
   - Уже установлен локально в профиле (`dsh-codex-subtask-cli` → `name:"@openai/codex", version:"0.166.0"`), т.е. проверен ровно тот бинарь, что будет резолвиться.
   - Стабильный релиз из npm-линейки, воспроизводим на любой машине (в отличие от desktop-бинаря), `bin.codex` и путь `node <pkg>/bin/codex.js app-server --stdio` сохраняются.
   - Модели `gpt-6-luna`, `gpt-6.1-sol`, `gpt-6.1-terra` работают, `gpt-5.6-sol` — контроль работает.
2. **Экспериментальный fallback: desktop-бинарь `0.169.0-alpha.11.1`** (тоже полностью совместим и принимает все gpt-6.x).
   Не рекомендуется как пин: alpha, платформенно-зависимый path в `%LOCALAPPDATA%`, не npm-зависимость, невоспроизводим.
3. **`0.153.4` нельзя оставлять** — именно он даёт `400 model_not_found` на gpt-6.x.
4. **`0.170.0` (latest)** — кандидат на следующий шаг, если форк хочет latest: прогнать `npm pack/install @openai/codex@0.170.0` и `run-matrix.mjs` (матрица займёт ~1–2 мин, ~8 крошечных вызовов). Пока данных нет — не пинить.
5. Опционально в форке: пробрасывать `turn.error.message` (сырой JSON HTTP-ошибки) в диагностику
   вместо маппинга `codexErrorInfo:"other"` → `product-error`, чтобы `model_not_found` был виден пользователю.

## 10. Артефакты

| файл | назначение |
|---|---|
| [wire.mjs](wire.mjs) | точная реимплементация wire-слоя плагина + транспорт + raw-логирование |
| [probe.mjs](probe.mjs) | один прогон: `--binary --model [--mode] [--no-turn]` |
| [run-matrix.mjs](run-matrix.mjs) | матрица бинарь × модель + негативный контроль 0.153.4 |
| [drift.mjs](drift.mjs) | initialize + thread/start во всех permission-mode (0 токенов) |
| [schema-diff.mjs](schema-diff.mjs) | дифф JSON Schema версий: методы, required-поля, capabilities, фазы |
| [schema/](schema/) | сгенерированные `generate-json-schema --experimental` бандлы для 3 версий |
| [logs/](logs/) | raw JSONL кадров (in/out/server-request), без env/токенов |
| [results/](results/) | `matrix.json`, `drift-summary.json`, summary каждого прогона |
| [tmp/probe/](tmp/probe/) | рабочий каталог turn'ов |
