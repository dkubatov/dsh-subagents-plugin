# Апстрим-ресёрч: DSH subagent-codex + @openai/codex (gpt-6.x, ChatGPT-аккаунт)

Дата: 2026-11-19 · Автор: teammate `upstream-research` · Задача: task-2
Рабочая директория: `D:\Repos\DSH\plugins\subagents` · Артефакты: `research/npm/`

## TL;DR (однозначная рекомендация)

1. **Ждать апстрим бессмысленно.** Ни в одной опубликованной версии плагина (0.2.2-rc.1…rc.5, 0.2.2-alpha.3) нет bump'а Codex и нет фикса gpt-6: `lib/index.js` байт-идентичен, `@openai/codex` = `0.153.4` везде. В публичном master `deepseek-harness` — тоже 0.153.4.
2. **Форк нужен, но не как форк логики.** Код плагина менять не требуется: `@openai/codex` — обычная `dependency`. Минимальный фикс — `pnpm overrides` в профиле (или форк-пакет с тем же кодом и изменённым пином/peers, если нужен самостоятельный артефакт).
3. **Пин Codex: `0.166.0`, не `0.170.0`** (обоснование ниже). `0.166.0` уже установлен в этом окружении как `dsh-codex-subtask-cli` (alias `npm:@openai/codex@0.166.0`, win32-x64 бинарь на диске) и используется `dsh-codex-subscription@3.2.14`; `0.170.0` вышел только 2026-11-18 (сутки назад).
4. **Хост обновлять стоит, но проблему это не решит.** Установленный desktop = 0.2.2-rc.1, апдейтер уже видит 0.2.2-rc.5 (`nightly.yml`, releaseDate 2026-11-18, staging 100%). Однако плагин даже 0.2.2-rc.5 (npm `next`) остаётся на Codex 0.153.4 → gpt-6.x не заработает без подмены пина.
5. **Peer-риск форка с хостом 0.2.2-rc.1 — низкий, но шумный:** rc.5 объявляет exact-peers `0.2.2-rc.5`, у нас `0.2.2-rc.1`; при `autoInstallPeers: false` pnpm выдаст только warnings (уже видели в `.plugin-manager/logs/.../pnpm.log`: `[WARN] Issues with peer dependencies found`), не упадёт. Код идентичен rc.1, поэтому функционально rc.5 на хосте rc.1 эквивалентен. Для форка peers надо ослабить до `0.2.2-rc.1`.

---

## 1. npm-диффы плагина `@deepseek-ai/dsh-subagent-codex`

Метод: `npm pack` в `research/npm/`, распаковка, SHA256, сравнение `package.json` и `lib/index.js`.
Команда-воспроизведение:

```
cd research/npm
npm pack @deepseek-ai/dsh-subagent-codex@0.2.2-rc.1 ... @0.2.2-rc.5 @0.2.2-alpha.3
tar -xzf <tarball> -C x-<ver>
Get-FileHash x-*\package\lib\index.js
node asar-peek.mjs   # (asar-разбор хоста, см. §4)
```

### 1.1. Таблица версий плагина (даты — npm publish time, Europe/Moscow)

| Версия | Опубликован | `dependencies.@openai/codex` | `lib/index.js` SHA256 | `src/` в tarball | Ключевые peers |
|---|---|---|---|---|---|
| 0.2.2-alpha.3 | 2026-11-03 07:40 | **0.153.4** | `68DFA5D6…AFEB7` | нет | dsh-* `0.2.2-alpha.3` |
| 0.2.2-rc.1 (установлена) | 2026-11-04 09:14 | **0.153.4** | `68DFA5D6…AFEB7` | нет | dsh-* `0.2.2-rc.1`, cordis `~4.1.0` |
| 0.2.2-rc.2 | 2026-11-12 02:09 | **0.153.4** | `68DFA5D6…AFEB7` | да (index/run/wire.ts + maps) | dsh-* `0.2.2-rc.2` |
| 0.2.2-rc.3 | 2026-11-13 08:01 | **0.153.4** | `68DFA5D6…AFEB7` | да | dsh-* `0.2.2-rc.3` |
| 0.2.2-rc.4 | 2026-11-17 16:58 | **0.153.4** | `68DFA5D6…AFEB7` | да | dsh-* `0.2.2-rc.4` |
| 0.2.2-rc.5 (npm `next`) | 2026-11-18 13:08 | **0.153.4** | `68DFA5D6…AFEB7` | да | dsh-* `0.2.2-rc.5` |

**Вывод 1.1:** `lib/index.js` — один и тот же файл 31 199 байт во всех шести версиях (полный хеш: `68DFA5D64B3393BB722E4DA1B39E68DDB2C5D22646F3D5B864D341AACF6AFEB7`). Значит, **функциональных отличий между rc.1 и rc.5 нет вообще**, включая обработку моделей и ошибок. Отличия rc.2+ — только добавленные `src/`+sourcemaps, версии в `package.json`/peers и метаданные.

### 1.2. diff `package.json` rc.1 → rc.5

Полное сравнение: см. `research/npm/x-rc.1/package/package.json` и `x-rc.5/package/package.json`. Отличаются только:

- `version` (0.2.2-rc.1 → 0.2.2-rc.5);
- все peer-зависимости (exact `0.2.2-rc.N` → `0.2.2-rc.5`; cordis остаётся `~4.1.0`);
- `files` (+`src`, `lib/**/*.js.map`, `*.d.ts.map` в rc.5);
- в rc.5 добавлен `src/` (в rc.1 только `lib/index.js`+d.ts).

`dependencies`: `@openai/codex: 0.153.4`, `dsh-brand 0.2.2-rc.N`, `dsh-sdk-protocol 0.2.2-rc.N`, `schemastery ~3.19.0`, `dsh-tool-subagent 0.2.2-rc.N` — **пин Codex не менялся ни разу**.

### 1.3. `lib/index.js`: чего он ждёт от app-server

Grep по lib/index.js (rc.5, идентичен rc.1) и `src/wire.ts`:

- строка 12/2: `"Minimal Codex app-server 0.153.4 protocol adapter. The shared JSON-RPC…"` — **протокол зафиксирован на 0.153.4 в коде и в комментарии**;
- запуск: `[process.execPath, CODEX_PACKAGE_BIN, 'app-server', '--stdio']`, где `CODEX_PACKAGE_BIN` резолвится через `createRequire(import.meta.url).resolve('@openai/codex/package.json')` + путь к bin (package-local, не из PATH);
- хендшейк `initialize`/`initialized`; создание эфемерного треда `thread/start` (`ephemeral: true`); `turn/start` с `model` (если задан в конфиге плагина); слушает notifications/turn items, поддерживает approval-запросы; строгий whitelist методов (`default: unsupported app-server request`);
- импорты: `@deepseek-ai/schemastery`, `dsh-timeout`, `dsh-subagent`, `dsh-brand`, `dsh-sdk-protocol` (остальные peers — inject через cordis). В коде **нет** строк `model_not_found`, `gpt-6`, `gpt-5` — модель плагин не валидирует, он просто передаёт `model` в `turn/start`; `model_not_found` приходит от Codex/бэкенда.

**Прямое следствие для форка:** форк может ограничиться заменой зависимости `@openai/codex` (и, при желании, `wire.ts`-адаптера, если 0.166 выявит несовместимость). Логику плагина переписывать не нужно.

### 1.4. npm dist-tags плагина (почему «обновление» не приносит фикс)

Проверено `npm view`:

```
latest = 0.0.1-rc.1     ← СТАРАЯ ветка, отсюда ощущение «обновление старее установленного»
next   = 0.2.2-rc.5
alpha  = 0.2.2-alpha.3
```

Установлен rc.1 (04.11). Даже `next` (rc.5, 18.11) — без bump Codex (см. 1.1) → **обновление плагина проблему не решает принципиально**.

---

## 2. `@openai/codex`: с какой версии gpt-6.x у ChatGPT-аккаунта

### 2.1. Хронология (npm publish time + GitHub releases)

| `@openai/codex` | npm publish | Источник/смысл |
|---|---|---|
| **0.153.4** | 2026-09-04 23:31 | пин плагина DSH; «эра до gpt-6» |
| 0.154.0 | 2026-09-09 | |
| **0.156.0** | 2026-09-22 19:55 | GPT-6: [release 0.156.0](https://github.com/openai/codex/releases/tag/rust-v0.156.0); сторонний заголовок: [«Codex 0.156 Released with TUI, Voice, and GPT-6 Sol»](https://www.linkedin.com/posts/terminalblog_codingagents-openai-codex-activity-7508372208000421889-b_5B); в тот же день [9to5Mac: OpenAI upgrading ChatGPT and Codex with two more GPT-6 models](https://9to5mac.com/2026/09/22/openai-upgrading-chatgpt-and-codex-with-two-more-gpt-6-models/) |
| 0.158.0 | 2026-09-28 | по стороннему репорту gpt-6.1-sol ещё rejected |
| **~0.159.0** | 2026-10-01 (0.160 — 01.10) | по репорту: 0.158.0 rejected → 0.159.0 accepted для gpt-6.1 Sol (см. issue ниже) |
| 0.160.0 | 2026-10-01 | |
| 0.162.0 | 2026-10-08 | |
| 0.164.0 | 2026-10-23 | |
| **0.166.0** | 2026-10-29 19:56 | [release 0.166.0](https://github.com/openai/codex/releases/tag/rust-v0.166.0); GPT-6.2 Sol/Astra требуют ≥0.166.0 ([paperclipai/paperclip#22130](https://github.com/paperclipai/paperclip/issues/22130)) |
| 0.168.0 | 2026-11-13 | |
| 0.169.0/0.169.1 | 2026-11-13/17 | pin 0.169.0 для GPT-6.2 на ChatGPT-логинах ([nanocoai/nanoclaw#4446](https://github.com/nanocoai/nanoclaw/pull/4446)) |
| **0.170.0** (`latest`) | 2026-11-18 03:45 | [release 0.170.0](https://github.com/openai/codex/releases/tag/rust-v0.170.0) — WebRTC voice, OTLP auth, MCP; про модели в notes ничего |

**Вывод 2.1 (факт + вывод):**
- `0.153.4` (04.09) **старше появления gpt-6 вообще** → для моделей `gpt-6-luna`, `gpt-6.1-sol`, `gpt-6.1-terra` клиент 0.153.4 закономерно получает `model_not_found`. Это и есть корневая причина, а не «поломка» DSH.
- gpt-6.1-семейство у ChatGPT-аккаунта: **нужен минимум ~0.159.0** (репорт: 0.158.0 rejected, 0.159.0 accepted). Точную нижнюю границу официальными notes подтвердить не удалось (в release 0.156.0 notes перечислены TUI/voice/usage, без явного списка моделей; в 0.170.0 notes — тоже без моделей). Помечаю как **вывод из стороннего issue + дат релизов**, а не как проверенный факт.
- Более свежие семейства (gpt-6.2 Sol/Astra, daybreak) требуют **≥0.166.0**, а для ChatGPT-логинов указывают **0.169.0** ⇒ **0.166.0 — нижняя безопасная граница**, 0.170.0 — заведомо покрывает.

### 2.2. Ключевое доказательство по симптому

[can1357/oh-my-pi#19226](https://github.com/can1357/oh-my-pi/issues/19226) (открыт 2026-11-14, закрыт 2026-11-17) — другой клиент, тот же бэкенд Codex:

- при ChatGPT sign-in `gpt-6.1-sol`, `gpt-6.1-terra`, `gpt-6-sol`, `gpt-6-astra`, `gpt-5.6-sol`, `gpt-daybreak-blue-latest` → `model_not_found`; **`gpt-6-luna` работает**;
- текст ошибки слово-в-слово как у нас: `The 'gpt-6.1-sol' model is not supported when using Codex with a ChatGPT account. (code=model_not_found)` (в ряде случаев HTTP 400);
- причина — клиентская версия/идентификация: бэкенд version-gate'ит модели; в issue указаны openai/codex#60676 (backend fix 11.11) и открытый #60970 (ошибки на CLI 0.163.0–0.167.2);
- полезная деталь для нас: в issue процитирован разбор, где **0.158.0 rejected, 0.159.0 accepted** для gpt-6.1 Sol.

⚠️ Важная поправка к постановке: симптом «`model_not_found` для gpt-6-luna» на 0.153.4 объясняется возрастом клиента, но в ноябре 2026 был **отдельный серверный инцидент** (13.11), когда Sol/Terra резались даже на 0.163–0.167.2. Т.е. после bump'а возможен второй, уже серверный, сценарий — это риск, а не повод не делать bump.

---

## 3. deepseek-harness: публичность, master, фикс

- Репозиторий **публичный**: [github.com/deepseek-ai/deepseek-harness](https://github.com/deepseek-ai/deepseek-harness) (создан 2026-08-13, default branch `master`, pushed 2026-11-18, MIT, 283k★). **Issues и PR отключены** (`has_issues: false`, `has_pull_requests: false`, включены только Discussions) → искать «issue про gpt-6 / bump codex» там нельзя.
- `packages/subagent/subagent-codex` существует. `package.json` из master (raw.githubusercontent, снят 2026-11-19):
  - `version: 0.2.2-rc.5`, пины `workspace:*`, **`dependencies.@openai/codex: "0.153.4"`** — bump'а Codex в main **нет** (ссылка: <https://raw.githubusercontent.com/deepseek-ai/deepseek-harness/master/packages/subagent/subagent-codex/package.json>).
- В master `files` включает `src`, т.е. опубликованные rc.2+ = актуальный master-срез.

**Вывод:** официального фикса нет ни в npm, ни в main; трекер багов закрыт ⇒ рассчитывать на скорый апстрим-релиз нельзя, форк/override оправдан. Если нужен «апстрим-канал», остаётся ждать новых `next`-версий и следить за `@openai/codex` в master `package.json`.

---

## 4. Хост DSH и механизм обновления

### 4.1. Что установлено

- `D:\DeepSeek\resources\app-update.yml`: `provider: generic`, `url: https://download.deepseek.com/dsh-desk/feeds/win-x64/`, `channel: nightly` (плюс `publisherName` CN=Hangzhou DeepSeek…).
- `D:\DeepSeek\resources\app.asar` (213 MB), разбор заголовка asar (см. `research/asar-peek.mjs`):
  - `/package.json` → **`@deepseek-ai/dsh-desktop@0.2.2-rc.1`**;
  - `/dsh/package.json` → **`@deepseek-ai/dsh-desktop-runtime@0.2.2-rc.1`**;
  - внутри asar: `electron-updater@6.8.9` и `node_modules/ws` и т.п. — т.е. автообновление Electron работает.
- `D:\DeepSeek\DeepSeek Harness.exe` FileVersion = **0.2.2-rc.1** (ProductVersion 0.2.2.0).
- Профиль `C:\Users\kubat\.dsh\profiles\desktop\package.json`: `@deepseek-ai/dsh-subagent-codex: "0.2.2-rc.1"`, `dsh-codex-subscription: ^3.2.14`, `dsh-codex-subtask-cli: npm:@openai/codex@0.166.0`; `pnpm-workspace.yaml`: `nodeLinker: hoisted`, **`autoInstallPeers: false`**.
- Локально на диске есть **оба** платформенных бинаря Codex:
  - `desktop/node_modules/@openai/codex[-win32-x64]` → **0.153.4** (используется плагином);
  - `desktop/node_modules/dsh-codex-subtask-cli/node_modules/@openai/codex-win32-x64` → **0.166.0-win32-x64** (alias; используется `dsh-codex-subscription`).

### 4.2. Что предлагает апдейтер (проверено fetch'ем фида)

`https://download.deepseek.com/dsh-desk/feeds/win-x64/nightly.yml` (скачан в `research/nightly.yml`):

```yaml
version: 0.2.2-rc.5
files:
  - url: .../deepseek-harness-0.2.2-rc.5-win-x64.exe   # 299 593 552 байт
    sha512: wWySRp7Hk5gcH324jBxAc7KV0mniHzQDofyQexOJMIAWXBkgHTsRCr3IrdwX1XO8OIhDZsLYmve4mLxskikYIg==
stagingPercentage: 100
releaseDate: '2026-11-18T11:35:49.720Z'
```

- `latest.yml`/`latest-nightly.yml`/`beta.yml`/`alpha.yml` → 404; манифест канала называется **`nightly.yml`**.
- **Хост 0.2.2-rc.5 доступен и раскатан на 100%** (18.11, 11:35 UTC). Установлен rc.1 (04.11) → обновление не применено (нужен перезапуск/«Проверить обновления»; это к владельцу профиля, не в моём write scope).
- npm `@deepseek-ai/dsh`: `latest = next = 0.2.2-rc.5` (18.11), `alpha = 0.2.2-alpha.3`; версии rc.2/rc.3/rc.4 опубликованы 12.11/13.11/17.11. `@deepseek-ai/dsh-desktop` в npm **отсутствует** (только фид/asar) — десктоп обновляется только апдейтером.

**Вывод:** обновление хоста до 0.2.2-rc.5 возможно и полезно (peer-граф плагина rc.5, багфиксы), **но фикс gpt-6 не приносит** — плагин в rc.5 всё ещё на Codex 0.153.4.

### 4.3. peer-риски установки/форка rc.5 на хост 0.2.2-rc.1

- rc.5 peers: exact `@deepseek-ai/dsh-llm|session|subagent|subprocess|timeout = 0.2.2-rc.5`, `@deepseek-ai/cordis ~4.1.0`. Хост rc.1: cordis-диапазон совпадает, exact-пакеты — нет.
- `autoInstallPeers: false` ⇒ pnpm **не будет доставлять вторые копии** хостовых пакетов; в худшем случае — `[WARN] Issues with peer dependencies found`, что уже происходит в этом профиле (см. `.plugin-manager/logs/operation-k58QqF/pnpm.log`: `[WARN] Issues with peer dependencies found. Run "pnpm peers check"…`, установка завершилась `Done in 3.3s`).
- Рантайм: `lib/index.js` rc.5 ≡ rc.1 (см. §1.1) ⇒ поведение на хосте rc.1 идентично текущему; импорты (`dsh-timeout`, `dsh-subagent`, `dsh-brand`, `dsh-sdk-protocol`) резолвятся к хостовым rc.1-пакетам.
- Остаточный риск: если cordis-plugin-loader/plugin-manager начнёт enforcing peer-версий — возможен refusal/warning; проверять изолированно (не меняя профиль!) в spike. Функциональный риск — низкий.
- Для форка: peers выставить `0.2.2-rc.1` (или `>=0.2.2-rc.1 <0.3.0`), `dependencies.@openai/codex: 0.166.0`, имя — отдельный scope (например `@local/dsh-subagent-codex`), `files` как в rc.5.

---

## 5. Выбор пина Codex: `0.166.0` vs `0.170.0`

| Критерий | 0.166.0 | 0.170.0 |
|---|---|---|
| Дата | 2026-10-29 (3 недели зрелости) | 2026-11-18 (сутки) |
| Наличие локально (win32-x64 бинарь, ~250MB) | **есть** (`dsh-codex-subtask-cli` alias) → установка/оффлайн-тесты быстрые | нет, нужна новая загрузка |
| Уже используется в этом профиле | **да** (`dsh-codex-subscription@3.2.14` работает с 0.166.0) | нет |
| Покрытие gpt-6.x/gpt-6.1 | да (≥0.159) | да |
| Покрытие gpt-6.2 + ChatGPT-логины | 0.166 — нижняя граница по paperclip#22130; nanotlaw PR рекомендует 0.169 | да |
| Дрейф app-server протокола vs 0.153.4 | меньше | **больше** (0.167–0.170 добавили WebRTC/OTLP/Cloud reconnection/плагинные API — часть в app-server) |
| Риск регрессии для форка | ниже | выше |

**Рекомендация: `@openai/codex@0.166.0`.** Причины: (а) закрывает все заявленные модели с запасом (min ~0.159), (б) бинарь уже на диске и уже обкатан в этом профиле другим плагином, (в) на 3 недели стабильнее и ближе к 0.153.4 по app-server, (г) 0.170.0 не даёт известного фикса, релевантного нашей проблеме (в notes — voice/OTLP/MCP, не модели).

**Что проверить в spike перед релизом форка (не входило в мой scope — `spikes/` у другого владельца):** handshake форка с 0.166.0 бинарём: `initialize`/`initialized` → `thread/start` (ephemeral) → `turn/start` с `gpt-6.1-sol`, плюс негативный тест `model` omitted. С 0.153.4→0.166.0 в changelog видны app-server изменения: в 0.156 **удалён `thread/rollback`** (плагин его не использует), «Enforce managed provider requirements on existing app-server threads», «Expose disabled plugin settings in the app-server API» — совместимость базовых методов вероятна, но требует подтверждения на реальном бинаре.

---

## 6. Полные ответы на 5 вопросов задачи

1. **npm-диффы:** rc.1→rc.5 — только версии/peers/`src`; `lib/index.js` идентичен; пин Codex `0.153.4` во всех версиях и в master. Фикса gpt-6 нет. Совместимость rc.5 с хостом rc.1: работает (код идентичен), pnpm — только warnings при `autoInstallPeers:false`; чистый peer-граф требует хоста rc.5.
2. **Codex:** gpt-6 появился в 0.156.0 (22.09), gpt-6.1 Sol/Terra у ChatGPT-аккаунта — с ~0.159.0 (0.158 rejected), gpt-6.2 — ≥0.166.0 (ChatGPT-логины — 0.169.0). 0.153.4 не знает gpt-6 ⇒ ожидаемый `model_not_found`. App-server протокол менялся (удалён `thread/rollback` в 0.156, новые API), risk средний/низкий — подтвердить spike'ом.
3. **deepseek-harness:** репо публичное, issues/PR отключены; `packages/subagent/subagent-codex` есть; в master пин 0.153.4, bump'а нет; закрытость трекера ⇒ на быстрый апстрим-фикс не рассчитывать.
4. **Хост:** установлен desktop 0.2.2-rc.1 (asar+exe); апдейтер-фид `nightly.yml` предлагает 0.2.2-rc.5 (18.11, 100%); npm `@deepseek-ai/dsh` latest/next = 0.2.2-rc.5; фикса Codex-пина нет ни в одном релизе (плагин всегда 0.153.4).
5. **Итог:** апстрим не чинит → форк/override обязателен; пин **0.166.0**; peers форка на `0.2.2-rc.1`; хост обновить до rc.5 (гигиена, не фикс); архитектурно достаточно `pnpm overrides` в профиле, полноценный форк — только если нужен самостоятельный publish-артефакт.

## 7. Ссылки

- Релизы Codex: [0.156.0](https://github.com/openai/codex/releases/tag/rust-v0.156.0) · [0.166.0](https://github.com/openai/codex/releases/tag/rust-v0.166.0) · [0.170.0](https://github.com/openai/codex/releases/tag/rust-v0.170.0)
- Проблема model_not_found на ChatGPT-аккаунте: [can1357/oh-my-pi#19226](https://github.com/can1357/oh-my-pi/issues/19226)
- GPT-6.2 требует ≥0.166.0: [paperclipai/paperclip#22130](https://github.com/paperclipai/paperclip/issues/22130); для ChatGPT-логинов 0.169.0: [nanocoai/nanoclaw#4446](https://github.com/nanocoai/nanoclaw/pull/4446)
- GPT-6 анонсы: [9to5Mac, 2026-09-22](https://9to5mac.com/2026/09/22/openai-upgrading-chatgpt-and-codex-with-two-more-gpt-6-models/) · [Codex 0.156 + GPT-6 Sol (LinkedIn)](https://www.linkedin.com/posts/terminalblog_codingagents-openai-codex-activity-7508372208000421889-b_5B)
- Апстрим: [github.com/deepseek-ai/deepseek-harness](https://github.com/deepseek-ai/deepseek-harness) · [master package.json subagent-codex](https://raw.githubusercontent.com/deepseek-ai/deepseek-harness/master/packages/subagent/subagent-codex/package.json)
- Фид обновлений десктопа: <https://download.deepseek.com/dsh-desk/feeds/win-x64/nightly.yml>

## 8. Артефакты и ограничения

- `research/npm/*.tgz` + распакованные `x-<ver>/package/` (rc.1–rc.5, alpha.3), `research/npm/{codex,plugin,host}-time.json` (npm `@deepseek-ai/dsh-desktop` отсутствует — E404, поэтому desktop-time.json пустой);
- `research/asar-peek.mjs` — разбор заголовка `app.asar` (без изменения чего-либо);
- `research/nightly.yml` — манифест апдейтера;
- Профиль `C:\Users\kubat\.dsh`, `~/.codex`, установленные пакеты — **не изменялись** (только чтение/копирование tarball'ов);
- Гигантские платформенные пакеты Codex не скачивались (0.166.0-бинарник уже локальный);
- Не проверено (вне scope): фактический прогон app-server 0.166.0 против адаптера плагина; точная минимальная версия для `gpt-6-luna` по официальным notes.
