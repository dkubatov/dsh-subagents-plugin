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

> **DSH 0.2.2-rc.5: инструменты — preset-scoped.** В rc.5 web-bundle выключает
> Host-строки `@deepseek-ai/dsh-tool-subagent`, а инструменты делегирования
> живут внутри Agent Preset. Поэтому bundle-патч форка регистрирует только
> provider (Host), а строки `tool-subagent` нужно добавить в используемый
> preset (например, override shipped-пресета `standard` в
> `cordis.patch.yml` профиля). Host-строка `tool-subagent-codex-next`
> останется `enabled: false` — это ожидаемо, не ошибка.
> Подробности и матрица проверок: `COMPATIBILITY.md`.

Профиль: `C:\Users\<you>\.dsh\profiles\desktop`. Форк ставится как **отдельный
bundle**, рядом с upstream (не поверх него).

> **Версия хоста.** Артефакт `0.2.2-rc.5-dsh.2` привязан к DSH **0.2.2-rc.5**
> (deps/peers exact). Для DSH `0.2.2-rc.1` остаётся предыдущий релиз
> [`v0.2.2-rc.1-dsh.1`](https://github.com/dkubatov/dsh-subagents-plugin/releases/tag/v0.2.2-rc.1-dsh.1).


### 0. Готовый tarball из GitHub Release (рекомендуется)

Релиз: <https://github.com/dkubatov/dsh-subagents-plugin/releases/tag/v0.2.2-rc.5-dsh.2>

```json
{
  "action": "install_bundle",
  "target": "https://github.com/dkubatov/dsh-subagents-plugin/releases/download/v0.2.2-rc.5-dsh.2/dsh-subagent-codex-next-0.2.2-rc.5-dsh.2.tgz",
  "enabled": true
}
```

Это `plugin_manager install_bundle` (агент/страница Plugins); `install_bundle`
принимает tarball-URL и локальные `file:`-спеки. Дальше — шаг 3.

### 1. Собрать tarball из исходников (для разработки)

```powershell
cd D:\Repos\DSH\plugins\subagents\packages\dsh-subagent-codex-next
npm pack --pack-destination .artifacts
# .artifacts\dsh-subagent-codex-next-0.2.2-rc.5-dsh.2.tgz
```

### 2. Установить локальный tarball через `plugin_manager`

```json
{"action":"install_bundle","target":"file:D:\\Repos\\DSH\\plugins\\subagents\\packages\\dsh-subagent-codex-next\\.artifacts\\dsh-subagent-codex-next-0.2.2-rc.5-dsh.2.tgz","enabled":true}
```

`install_bundle` принимает `file:`-спеки (см. README `dsh-plugin-manager`:
«paths, tarballs … skip the GitHub check»). При установке pnpm скачает
`@openai/codex@0.166.0` (пакет уже есть в pnpm-store, если в профиле стоит
`dsh-codex-subtask-cli` = alias 0.166.0). Без HMR активация — после
перезапуска процесса DSH.

### 3. Отключить upstream-bundle и обновить патч профиля

- Выключить `@deepseek-ai/dsh-subagent-codex` в Plugins (dependency остаётся
  установленной, слой перестаёт применяться).
- В `cordis.patch.yml` профиля удалить/заменить блок, который вставляет
  `subagent-codex` / `subagent-codex-luna` / `subagent-codex-terra` и их
  инструменты: иначе эти `insert`-строки продолжат монтировать upstream-плагин
  и его `codex`-провайдер с 0.153.4. Новые строки форка (соло/терра) — из
  раздела «Модели».
- Перезапустить DSH. Ожидаемо: инструменты `subagent_codex`,
  `subagent_codex_sol`, `subagent_codex_terra`; каждый turn идёт с новой
  моделью, в `stderr`/логах нет `model_not_found`.

### Откат

```json
{"action":"remove_bundle","target":"dsh-subagent-codex-next"}
```

Затем вернуть upstream-bundle (включить) и восстановить прежний блок
`cordis.patch.yml` (бэкап делается перед правкой вручную). `remove_bundle`
возвращает манифест профиля и lockfile к состоянию до установки.

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
