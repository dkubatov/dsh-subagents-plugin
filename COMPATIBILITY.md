# Compatibility and test matrix

Этот файл фиксирует **что именно и на каких версиях проверялось** для форка
`dsh-subagent-codex-next`. «Заявленная совместимость» (`engines.dsh`, peer
ranges) — это диапазон, а не доказательство; доказательства перечислены ниже.

Обновлено: 2026-11-19, после live-e2e на нативном DSH-инструменте.

## Проверенные окружения

| Компонент | Значение |
|---|---|
| DSH Desktop app | `44.7.0` |
| `@deepseek-ai/dsh-desktop-runtime` | **`0.2.2-rc.5`** |
| Node / pnpm runtime | `24.21.0` / `11.28.5` |
| Форк | **`0.2.2-rc.5-dsh.4`** (предыдущие: `rc.5-dsh.3`, `rc.5-dsh.1/.2`, `rc.1-dsh.1` для хоста rc.1) |
| Codex payload форка | `@openai/codex@0.166.0` (exact pin) |
| App Codex CLI (`CODEX_CLI_PATH`) | `0.169.0-alpha.11.1` (форком не используется) |

Снимки версий: `research/versions-before-dsh-update.json`,
`research/versions-after-dsh-update.json`,
`research/versions-after-fork-install.json` (собираются
`tools/collect-versions.mjs`).

## Матрица проверок

| Уровень | Что проверялось | Окружение | Результат |
|---|---|---|---|
| Wire-протокол | Точная JSON-RPC последовательность плагина против Codex `0.166.0` | не зависит от DSH | ✅ 3/3 turn'а (`gpt-6-luna`, `gpt-6.1-sol`, `gpt-5.6-sol`) |
| Wire-протокол | Та же последовательность против app-бинаря `0.169.0-alpha.11.1` | app-бинарь | ✅ 4/4 turn'а (+ `gpt-6.1-terra`) |
| Wire-протокол | Handshake/thread-start во всех 3 permission-mode, 3 бинаря | app/0.166/0.153 | ✅ 9/9 |
| Негативный контроль | Плагинный Codex `0.153.4` + `gpt-6-luna` | профиль rc.1 | ✅ воспроизведён `400 model_not_found` |
| Установка пакета | tarball форка ставится в чистый pnpm-layout с зависимостями `0.2.2-rc.5` | pnpm `11.28.5` | ✅ `@openai/codex` резолвится как `0.166.0` |
| Установка в DSH | `plugin_manager install_bundle` URL релиза | DSH `0.2.2-rc.5` | ✅ `application: applied` |
| Активация provider'ов | Host-строки `subagent-codex-next` (-luna/-sol/-terra) | DSH `0.2.2-rc.5` | ✅ `fiberPhase: active` |
| **Live e2e, нативный инструмент** | `subagent_codex` → «Reply with exactly: OK» | DSH `0.2.2-rc.5` | ✅ `OK` (provider `codex`, дефолт `gpt-6-luna`) |
| **Live e2e, нативный инструмент** | `subagent_codex_terra` → «Reply with exactly: OK» | DSH `0.2.2-rc.5` | ✅ `OK` (`gpt-6.1-terra`) |
| **Live e2e, нативный инструмент** | `subagent_codex_sol` → «Reply with exactly: OK» | DSH `0.2.2-rc.5` | ✅ `OK` (`gpt-6.1-sol`) |
| Регистрация инструмента | `subagent_codex_luna` в каталоге (тот же provider, что база) | DSH `0.2.2-rc.5` | ✅ зарегистрирован (отдельный вызов не делался) |

Детали live-e2e и id сессий: `research/live-e2e-2026-11-19.md`.

## Reasoning effort (`0.2.2-rc.5-dsh.4`)

Новая опция экземпляра провайдера `reasoningEffort` передаётся в
`thread/start` как `config.model_reasoning_effort`; `model` / `modelProvider` /
`reasoningEffort` из ответа app-server пишутся в лог
(`thread ready (…)`), а при расхождении с конфигурацией — warning
`thread started with unexpected configuration (…)`. Это только диагностика:
acceptance-логика JSON-RPC-адаптера не меняется (инвариант AGENTS §2).

Каталог `model/list` (`@openai/codex@0.166.0`, ChatGPT-аккаунт, снят 2026-11-19):

| Модель | Default effort | Supported efforts |
|---|---|---|
| `gpt-6.2-sol` | `low` | `low`, `medium`, `high`, `xhigh`, `max`, `ultra` |
| `gpt-6.2-astra` | `low` | `low`, `medium`, `high`, `xhigh`, `max`, `ultra` |
| `gpt-6.1-terra` | `low` | `low`, `medium`, `high`, `xhigh`, `max`, `ultra` |
| `gpt-6.1-sol` | `low` | `low`, `medium`, `high`, `xhigh`, `max`, `ultra` |
| `gpt-6-astra` | `medium` | `low`, `medium`, `high`, `xhigh`, `max`, `ultra` |
| `gpt-6-sol` | `medium` | `low`, `medium`, `high`, `xhigh`, `max`, `ultra` |
| `gpt-6-luna` | `medium` | `low`, `medium`, `high`, `xhigh`, `max` (без `ultra`) |

Каталог аккаунта динамический: в течение 2026-11-19 сервер добавил
`gpt-6.2-sol`/`gpt-6.2-astra` и сделал `gpt-6.2-sol` default-моделью аккаунта;
провайдер без `model` продолжает жить по `~/.codex/config.toml`
(`model = "gpt-6-luna"`). Есть также `gpt-5.6-*` и `gpt-5.5` (вне матрицы).

Проверено probe'ом (no-turn, `thread/start` echo, тот же payload `0.166.0`):

| Уровень | Что проверялось | Результат |
|---|---|---|
| `thread/start` echo | `gpt-6.2-sol` × `medium`, `high`, `ultra` | ✅ reported model/effort совпали |
| `thread/start` echo | `gpt-6.1-sol` × `low`, `medium`, `high`, `xhigh`, `ultra` | ✅ совпали |
| `thread/start` echo | `gpt-6.1-terra` × `low`, `medium`, `high`, `max` | ✅ совпали |
| `thread/start` echo | `gpt-6-luna` × `medium`, `high`, `max` | ✅ совпали |
| Каталог | `scripts/probe-model-catalog.mjs` на `0.166.0` | ✅ 10 моделей, матрица выше |
| Негативный контроль | `gpt-6-luna` × `ultra` и × `bogus` | ⚠️ echo принимает оба значения — echo не валидирует поддержку; смотрите каталог |
| Live-turn с усилием | реальный turn с `reasoningEffort: high` | ⏳ не прогонялся (нужен live-профиль с dsh.4) |

**Важно:** `thread/start` возвращает запрошенное значение даже для
неподдерживаемого усилия, поэтому плагинная сверка ловит только рассинхрон
конфигурации, а не ошибку выбора. Допустимые комбинации — по таблице каталога.

## Найденная причина «пропавших» инструментов

Симптом: после обновления хоста до `0.2.2-rc.5` свежие сессии не содержали ни
`subagent_codex*`, ни даже базовых `subagent`/`subagent_fork`, хотя
провайдеры форка были активны.

Причина — **затенение пакета**:

1. в профиле оставался выключенный upstream-плагин
   `@deepseek-ai/dsh-subagent-codex@0.2.2-rc.1` (после обновления хоста он
   стал `incompatible-version`);
2. его точная зависимость `@deepseek-ai/dsh-tool-subagent@0.2.2-rc.1`
   поднималась в `profiles/desktop/node_modules` и перекрывала
   установочный пакет `0.2.2-rc.5`;
3. строки `tool-subagent` (и preset-scoped, и Host) резолвили rc.1-пакет,
   который несовместим с rc.5-хостом, и не активировались — поэтому не
   регистрировались **все** инструменты делегирования.

Исправление: удалить upstream-плагин `0.2.2-rc.1` из профиля (не обновлять до
rc.5 — форк его заменяет). После этого `@deepseek-ai/dsh-tool-subagent`
резолвится как `0.2.2-rc.5`, Host-строки инструментов активируются, и в
Live e2e это подтверждено. **Перезапуск DSH не потребовался** — HMR
пере-активировал Host-строки и обновил каталог инструментов живой сессии.

Уточнение к более ранней гипотезе: в rc.5 web-bundle действительно выключает
базовые Host-строки `tool-subagent` и использует preset-scoped строки, но
плагин может добавлять **свои** Host-строки инструментов — они работают, если
пакет `@deepseek-ai/dsh-tool-subagent` резолвится в совместимую версию.
Проблема была не в preset-scoped архитектуре, а в затенении rc.1-пакетом.

## Как воспроизвести live-тест

1. Проверить, что в живом профиле нет `@deepseek-ai/dsh-subagent-codex@0.2.2-rc.1`:

   ```powershell
   Get-Content "$env:USERPROFILE\.dsh\profiles\desktop\package.json"
   ```

2. Открыть новую сессию и вызвать по очереди:

   - `subagent_codex` — «Reply with exactly: OK»;
   - `subagent_codex_terra` — «Reply with exactly: OK»;
   - `subagent_codex_sol` — «Reply with exactly: OK».

3. Ожидаемо: completion notice с `OK` для каждого, без
   `product-error`/`model_not_found`; в `~/.dsh/sessions/…/session.v4.jsonl.zstd`
   видны `tool/call` и `tool/result` для этих инструментов.

## Откат

- Инструменты/провайдеры: `plugin_manager` → `remove_bundle` →
  `dsh-subagent-codex-next`.
- Патч профиля: бэкапы в `local-backups/profile-before-host-tool-rows-2026-11-19/`
  (и более ранние `…-before-preset-override…`, `…-before-preset-toggle…`).
- Upstream-плагин при необходимости ставится заново официальным способом
  (для rc.5 — версия `0.2.2-rc.5`; rc.1 оставлять не нужно).
