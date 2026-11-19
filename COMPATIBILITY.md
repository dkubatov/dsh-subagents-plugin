# Compatibility and test matrix

Этот файл фиксирует **что именно и на каких версиях проверялось** для форка
`dsh-subagent-codex-next`. «Заявленная совместимость» (`engines.dsh`, peer
ranges) — это диапазон, а не доказательство; доказательства перечислены ниже.

## Проверенные окружения

| Компонент | rc.1 (разработка) | rc.5 (текущий хост) |
|---|---|---|
| DSH Desktop app | `44.7.0` | `44.7.0` |
| `@deepseek-ai/dsh-desktop-runtime` | `0.2.2-rc.1` | **`0.2.2-rc.5`** |
| Node / pnpm runtime | `24.21.0` / `11.28.5` | `24.21.0` / `11.28.5` |
| Upstream `@deepseek-ai/dsh-subagent-codex` | `0.2.2-rc.1` (pin Codex `0.153.4`) | `0.2.2-rc.1` — стал `incompatible-version`, выключен |
| Наш форк | `0.2.2-rc.1-dsh.1` | **`0.2.2-rc.5-dsh.2`** |
| Codex payload форка | `0.166.0` | `0.166.0` |
| App Codex CLI (`CODEX_CLI_PATH`) | `0.169.0-alpha.11.1` | `0.169.0-alpha.11.1` |

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
| Установка в DSH | `plugin_manager install_bundle` URL релиза | DSH `0.2.2-rc.5` | ✅ `application: applied`, dependencies обновлены |
| Активация provider'ов | Host-строки `subagent-codex-next` (-luna/-sol/-terra) | DSH `0.2.2-rc.5` | ✅ `fiberPhase: active` |
| Live e2e через DSH-инструменты | `subagent_codex*` → ответ на `gpt-6.x` | DSH `0.2.2-rc.5` | ⏳ требует **новой Session** (см. ниже) |

## Важно: DSH 0.2.2-rc.5 и preset-scoped инструменты

Апдейт хоста изменил архитектуру подключаемых инструментов: web-bundle теперь
выключает Host-строки `tool-subagent*`, а инструменты делегирования живут
**внутри Agent Preset** (shipped `standard` preset содержит
`tool-subagent`/`tool-subagent-fork`). Поэтому:

- Host-строка `tool-subagent-codex-next` из bundle patch на rc.5 остаётся
  `enabled: false` — это ожидаемо, а не ошибка пакета;
- чтобы инструменты `subagent_codex*` появились у агента, строки
  `@deepseek-ai/dsh-tool-subagent` нужно добавить в **preset**, а не в Host.
  Наш профиль использует override shipped-пресета `standard` в
  `cordis.patch.yml` профиля (см. историю установки ниже);
- официальный README upstream-плагина, обещающий «global tool для любого
  пресета», для rc.5 устарел. При следующем апдейте DSH профилю потребуется
  пере-рендер override'а (`tools/_render-profile-patch.mjs`).

## Как воспроизвести live-тест

1. Открыть **новую Session** (существующие сохраняют preset revision, с
   которым стартовали).
2. Вызвать `subagent_codex` с задачей «Reply with exactly: OK».
3. Ожидаемо: completion notice с `OK`, без `product-error`/`model_not_found`.
4. Повторить для `subagent_codex_sol` (`gpt-6.1-sol`) и
   `subagent_codex_terra` (`gpt-6.1-terra`); `subagent_codex_luna` —
   `gpt-6-luna`.

## Откат

- Вернуть пресет и патч: `local-backups/profile-before-preset-override-2026-11-19/cordis.patch.yml`.
- Удалить форк: `plugin_manager` `remove_bundle` → `dsh-subagent-codex-next`.
- Вернуть upstream-плагин: включить его снова (после апгрейда до `0.2.2-rc.5`
  его нужно обновить до версии `0.2.2-rc.5`, иначе он остаётся
  `incompatible-version`).
