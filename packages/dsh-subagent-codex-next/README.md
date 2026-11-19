# dsh-subagent-codex-next

Форк `@deepseek-ai/dsh-subagent-codex@0.2.2-rc.5` для DeepSeek Harness (DSH) 0.2.2-rc.5.
Один и тот же провайдер одноразовых Codex-субагентов (`subagent_codex`) поверх
официального `codex app-server --stdio`, но с современным Codex-payload и
настраиваемым исполняемым файлом.

## Зачем форк

Upstream-плагин жёстко пинит `@openai/codex@0.153.4` (сентябрь 2026). Этот билд
не знает моделей `gpt-6.x`: для аккаунта ChatGPT каждый turn падает с

```
HTTP 400, code: model_not_found
The 'gpt-6-luna' model is not supported when using Codex with a ChatGPT account.
```

Проверено (см. `../../spikes/protocol/REPORT.md`): wire-последовательность
плагина **не менялась** и полностью принимается Codex `0.166.0` и
app-бинарём `0.169.0-alpha.11.1`; модели `gpt-6-luna`, `gpt-6.1-sol`,
`gpt-6.1-terra` работают. Значит, достаточно поднять payload — что и делает
этот форк.

Апстрим-фикса нет: `lib/index.js` байт-идентичен во всех опубликованных
версиях плагина (alpha.3, rc.1…rc.5), `@openai/codex` = `0.153.4` во всех,
master GitHub-репозитория — тоже.

## Что изменено относительно upstream

| # | Изменение | Где |
|---|---|---|
| 1 | `dependencies.@openai/codex`: `0.153.4` → **`0.166.0`** (exact pin) | `package.json` |
| 2 | Новые необязательные опции экземпляра провайдера: `codexPackage`, `codexBin`, `command` | `src/run.ts`, `src/index.ts`, `lib/index.js` |
| 3 | Пакет называется `dsh-subagent-codex-next`; `name`-экспорт и id строк слоя получили суффикс `-next`, чтобы жить рядом с upstream | `package.json`, `cordis.patch.yml`, `lib/index.js` |
| 4 | Пакет привязан к хосту: deps/peers — exact `0.2.2-rc.5`, `engines.dsh: >=0.2.2-rc.5 <0.2.3-0` | `package.json` |
| 5 | Добавлен интеграционный probe `scripts/probe-app-server.mjs` | `scripts/` |
| 6 | В репозиторий положен TypeScript-исходник upstream (rc.5) с теми же правками; `lib/index.js` — собранный артефакт | `src/`, `lib/` |

Wire-код (JSON-RPC, выбор ответа, approval-ответы, teardown) **не менялся** —
только разрешение исполняемого файла и идентификаторы.

## Модели

`cordis.patch.yml` форка повторяет upstream-слой: один провайдер `codex` **без
фиксированной модели** — значит, действует нативный `~/.codex/config.toml`
(`model = "gpt-6-luna"`). Дополнительные экземпляры под конкретные модели
добавляются патчем профиля, например:

```yaml
- insert:
    - id: subagent-codex-next-sol
      name: 'dsh-subagent-codex-next'
      config:
        providerName: codex-sol
        model: gpt-6.1-sol
    - id: tool-subagent-codex-next-sol
      name: '@deepseek-ai/dsh-tool-subagent'
      config:
        provider: codex-sol
        toolName: subagent_codex_sol
        maxDepth: provider-managed
    - id: subagent-codex-next-terra
      name: 'dsh-subagent-codex-next'
      config:
        providerName: codex-terra
        model: gpt-6.1-terra
    - id: tool-subagent-codex-next-terra
      name: '@deepseek-ai/dsh-tool-subagent'
      config:
        provider: codex-terra
        toolName: subagent_codex_terra
        maxDepth: provider-managed
```

## Конфигурация

Поля upstream: `providerName`, `model`, `env`, `permissionMode`,
`disposeGraceMs` (см. upstream-README). Новые поля:

| Поле | По умолчанию | Смысл |
|---|---|---|
| `codexPackage` | `@openai/codex` | Имя пакета (или npm-alias, например `@openai/codex-next`) с `bin.codex` — откуда запускать app-server |
| `codexBin` | — | Готовый исполняемый файл: запуск `codexBin app-server --stdio`; приоритетнее `codexPackage` |
| `command` | — | Полный argv, уже включающий `app-server --stdio`; приоритетнее `codexBin` |

Приоритет: `command` → `codexBin` → `codexPackage`. `codexBin` и `command`
взаимоисключающие — при одновременной настройке `apply()` падает.

Примеры:

```yaml
# app-бинарь из установленного Codex-приложения (экспериментально)
- id: subagent-codex-next
  config:
    codexBin: 'C:\Users\<you>\AppData\Local\OpenAI\Codex\bin\<build>\codex.exe'

# другой payload из npm-alias, установленного в профиль
- id: subagent-codex-next
  config:
    codexPackage: '@openai/codex-next'
```

`env` уже позволяет передать `CODEX_HOME` и прочие переменные дочернего
процесса.

## Установка в профиль DSH

> **DSH 0.2.2-rc.5: важное предусловие.** В профиле не должно
> оставаться старого upstream-плагина
> `@deepseek-ai/dsh-subagent-codex@0.2.2-rc.1`: после обновления хоста он
> `incompatible-version`, а его зависимость
> `@deepseek-ai/dsh-tool-subagent@0.2.2-rc.1` затеняет совместимый rc.5-пакет.
> Из-за этого не активируется ни одна строка `tool-subagent` (симптом: нет
> `subagent_codex*`, `subagent`, `subagent_fork`). Удалите его через
> `remove_bundle` — форк его заменяет. Если нужен upstream рядом, обновите его
> до `0.2.2-rc.5`. Подробности: `../../COMPATIBILITY.md`,
> `../../research/live-e2e-2026-11-19.md`.

Профиль: `C:\Users\<you>\.dsh\profiles\desktop`. Форк ставится как
**отдельный bundle вместо прежнего upstream** (не оставляйте рядом rc.1).

> **Версия хоста.** Артефакт `0.2.2-rc.5-dsh.3` привязан к DSH **0.2.2-rc.5**
> (deps/peers exact). Для DSH `0.2.2-rc.1` остаётся предыдущий релиз
> [`v0.2.2-rc.1-dsh.1`](https://github.com/dkubatov/dsh-subagents-plugin/releases/tag/v0.2.2-rc.1-dsh.1).

### 0. Готовый tarball из GitHub Release (рекомендуется)

Релиз: <https://github.com/dkubatov/dsh-subagents-plugin/releases/tag/v0.2.2-rc.5-dsh.3>

```json
{
  "action": "install_bundle",
  "target": "https://github.com/dkubatov/dsh-subagents-plugin/releases/download/v0.2.2-rc.5-dsh.3/dsh-subagent-codex-next-0.2.2-rc.5-dsh.3.tgz",
  "enabled": true
}
```

Это `plugin_manager install_bundle` (агент/страница Plugins); `install_bundle`
принимает tarball-URL и локальные `file:`-спеки.

### 1. Собрать tarball из исходников (для разработки)

```powershell
cd D:\Repos\DSH\plugins\subagents\packages\dsh-subagent-codex-next
npm pack --pack-destination .artifacts
# .artifacts\dsh-subagent-codex-next-0.2.2-rc.5-dsh.3.tgz
```

### 2. Установить локальный tarball через `plugin_manager`

```json
{"action":"install_bundle","target":"file:D:\\Repos\\DSH\\plugins\\subagents\\packages\\dsh-subagent-codex-next\\.artifacts\\dsh-subagent-codex-next-0.2.2-rc.5-dsh.3.tgz","enabled":true}
```

При установке pnpm поставит `@openai/codex@0.166.0` (пакет уже есть в
pnpm-store, если в профиле стоит `dsh-codex-subtask-cli` = alias 0.166.0).

### 3. Удалить несовместимый upstream и настроить модели

1. Если в профиле остался `@deepseek-ai/dsh-subagent-codex@0.2.2-rc.1` —
   удалите его: `plugin_manager` → `remove_bundle` →
   `@deepseek-ai/dsh-subagent-codex`. Иначе `@deepseek-ai/dsh-tool-subagent`
   снова будет резолвиться в rc.1 и все инструменты делегирования исчезнут.
2. Уберите из `cordis.patch.yml` профиля остатки прежних workaround'ов:
   `insert`-строки upstream-плагина и override `preset-standard` (если
   добавляли). Shipped-пресет `standard` должен остаться нетронутым: на rc.5
   он сам содержит preset-scoped `subagent`/`subagent_fork`, а строки форка —
   Host-scoped.
3. Bundle-патч форка регистрирует provider `codex` и базовый инструмент
   `subagent_codex` (модель — дефолт `~/.codex/config.toml`, т.е.
   `gpt-6-luna`). Дополнительные варианты добавляются патчем профиля:

   ```yaml
   - insert:
       - id: subagent-codex-next-luna
         name: "dsh-subagent-codex-next"
         config: { providerName: codex-luna, model: gpt-6-luna }
       - id: subagent-codex-next-sol
         name: "dsh-subagent-codex-next"
         config: { providerName: codex-sol, model: gpt-6.1-sol }
       - id: subagent-codex-next-terra
         name: "dsh-subagent-codex-next"
         config: { providerName: codex-terra, model: gpt-6.1-terra }
       - id: tool-subagent-codex-next-luna
         name: "@deepseek-ai/dsh-tool-subagent"
         config: { provider: codex-luna, toolName: subagent_codex_luna, maxDepth: provider-managed }
       - id: tool-subagent-codex-next-sol
         name: "@deepseek-ai/dsh-tool-subagent"
         config: { provider: codex-sol, toolName: subagent_codex_sol, maxDepth: provider-managed }
       - id: tool-subagent-codex-next-terra
         name: "@deepseek-ai/dsh-tool-subagent"
         config: { provider: codex-terra, toolName: subagent_codex_terra, maxDepth: provider-managed }
   ```

4. Активация Host-строк обычно происходит live (HMR), инструменты подхватывает
   и текущая, и новая сессия. Если инструментов нет — перезапустить DSH
   (полностью приложение) и открыть новую сессию.

Ожидаемо: `subagent_codex`, `subagent_codex_luna`, `subagent_codex_sol`,
`subagent_codex_terra`; каждый turn идёт с моделью gpt-6.x, в логах нет
`model_not_found`.

### Откат

```json
{"action":"remove_bundle","target":"dsh-subagent-codex-next"}
```

При необходимости upstream ставится заново официальным способом — для rc.5
версия `0.2.2-rc.5` (rc.1 оставлять бессмысленно: он несовместим с хостом и
ломает резолвинг `@deepseek-ai/dsh-tool-subagent`). Патч профиля — из бэкапа.

## Проверка

`scripts/probe-app-server.mjs` прогоняет ровно ту JSON-RPC последовательность,
что и провайдер: `initialize` → `initialized` → `thread/start` (ephemeral,
модель, permission-mode) → `turn/start` → ожидание `turn/completed`, с
approval-заглушками. Ничего не меняет, кроме временного `scripts/tmp/`.

```powershell
cd packages/dsh-subagent-codex-next

# 1) smoke: handshake без вызова модели (0 токенов)
node scripts/probe-app-server.mjs --no-turn

# 2) пакетный payload (после установки зависимостей пакета)
npm install
node scripts/probe-app-server.mjs --model gpt-6-luna
node scripts/probe-app-server.mjs --model gpt-6.1-sol --mode approve-for-me

# 3) внешний payload без установки зависимостей пакета
node scripts/probe-app-server.mjs --command '["node","C:\\...\\dsh-codex-subtask-cli\\bin\\codex.js","app-server","--stdio"]' --model gpt-6-luna
```

Успех: `outcome=success | turnStatus=completed`, ответ модели в
`scripts/results/*.json`, raw-кадры в `scripts/logs/*.jsonl` (env/токены не
логируются). `--no-turn` ожидает `outcome=handshake-only`.

## Ограничения и что не проверено

- **Live e2e на DSH `0.2.2-rc.5` пройден (2026-11-19):** `subagent_codex`,
  `subagent_codex_terra`, `subagent_codex_sol` вернули `OK` нативно через DSH
  (`gpt-6-luna` / `gpt-6.1-terra` / `gpt-6.1-sol`); детали —
  `../../COMPATIBILITY.md`, `../../research/live-e2e-2026-11-19.md`.
- Upstream не публикует свой набор тестов; форк наследует заявление upstream
  «protocol evidence pinned to 0.153.4». Наш probe покрывает main path
  (handshake, thread/start во всех трёх permission-mode, один текстовый turn,
  выбор `final_answer`), но **не** покрывает: живые approval-flow с
  инструментами, cancel/interrupt, resume/steer, keyless/API-key режимы.
- `@openai/codex@0.166.0` проверен probe'ом и сторонними отчётами; `0.170.0`
  не проверялся (см. `../../spikes/protocol/REPORT.md` §9). Менять пин — через
  `npm run probe` перед выкаткой.
- Alpha-бинарь приложения `0.169.0-alpha.11.1` тоже совместим, но как пин не
  рекомендуется (alpha, платформенный путь).
- `lib/index.js` — собранный артефакт; `src/` приложен для ревью. Если нужен
  воспроизводимый build, добавьте `tsdown`/`tsconfig` upstream и собирайте
  `pnpm run build` (в опубликованный tarball rc.5 конфиги сборки не входят).

## Лицензия

MIT, как у upstream (`LICENSE`). Форк не связан с DeepSeek/OpenAI; «Codex» —
продукт OpenAI.
