# dsh-subagents-plugin

[![Latest release](https://img.shields.io/github/v/release/dkubatov/dsh-subagents-plugin?include_prereleases)](https://github.com/dkubatov/dsh-subagents-plugin/releases)

Публичный форк Codex-провайдера субагентов для [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness)
(DSH) с современным Codex-payload и настраиваемым исполняемым файлом.

**Проблема, которую решает репозиторий.** Плагин
`@deepseek-ai/dsh-subagent-codex@0.2.2-rc.1` жёстко пинит
`@openai/codex@0.153.4` — билд, который не знает моделей `gpt-6.x`. Для
ChatGPT-аккаунта каждый Codex-субагент падает на первом turn с

```
HTTP 400 model_not_found
The 'gpt-6-luna' model is not supported when using Codex with a ChatGPT account.
```

Апстрим-фикса нет ни в одной опубликованной версии плагина (код
`lib/index.js` байт-идентичен, пин `0.153.4` — во всех), поэтому здесь лежит
форк с проверенным payload `0.166.0` и исследования, доказывающие
совместимость.

## Установка форка

Пакет: [`packages/dsh-subagent-codex-next`](packages/dsh-subagent-codex-next/README.md),
версия `0.2.2-rc.5-dsh.3`, Codex `0.166.0` (exact pin), DSH `0.2.2-rc.5` (deps/peers привязаны к этой версии хоста).

### 1. Скачать tarball из GitHub Release

Страница релизов: <https://github.com/dkubatov/dsh-subagents-plugin/releases>

- актуальный релиз для DSH **0.2.2-rc.5** — `v0.2.2-rc.5-dsh.3`;
- для DSH `0.2.2-rc.1` сохранён прежний релиз
  [`v0.2.2-rc.1-dsh.1`](https://github.com/dkubatov/dsh-subagents-plugin/releases/tag/v0.2.2-rc.1-dsh.1).

```text
https://github.com/dkubatov/dsh-subagents-plugin/releases/download/v0.2.2-rc.5-dsh.3/dsh-subagent-codex-next-0.2.2-rc.5-dsh.3.tgz
```

### 2. Установить как bundle через `plugin_manager`

```json
{
  "action": "install_bundle",
  "target": "https://github.com/dkubatov/dsh-subagents-plugin/releases/download/v0.2.2-rc.5-dsh.3/dsh-subagent-codex-next-0.2.2-rc.5-dsh.3.tgz",
  "enabled": true
}
```

Либо локально, если tarball уже на диске:
`"target": "file:D:\\path\\dsh-subagent-codex-next-0.2.2-rc.5-dsh.3.tgz"`.

Перед установкой удалите из профиля несовместимый upstream-плагин
`@deepseek-ai/dsh-subagent-codex@0.2.2-rc.1` (`plugin_manager` → `remove_bundle`):
его зависимость `@deepseek-ai/dsh-tool-subagent@0.2.2-rc.1` затеняет rc.5-пакет
и не даёт смонтироваться ни одному инструменту делегирования. После установки
форка инструменты обычно подхватываются live (HMR); если их нет — полностью
перезапустите DSH. Подробная инструкция и откат —
[README форка](packages/dsh-subagent-codex-next/README.md#установка-в-профиль-dsh).

### Пересборка tarball из исходников

```powershell
cd packages/dsh-subagent-codex-next
npm pack --pack-destination .artifacts
```

## Почему это работает (кратко)

1. **Wire-протокол не менялся.** Спайк прогнал ровно ту JSON-RPC-последовательность,
   что использует провайдер (`initialize` → `initialized` → `thread/start` →
   `turn/start` → `turn/completed`, все три permission-mode) против Codex
   `0.166.0` и app-бинаря `0.169.0-alpha.11.1`: 9/9 handshake+thread/start,
   7/7 успешных turn'ов, включая `gpt-6-luna`, `gpt-6.1-sol`, `gpt-6.1-terra`.
   Контроль `0.153.4` воспроизвёл заявленный `400`.
2. **Достаточно поднять payload.** В форке `dependencies.@openai/codex`
   заменён на `0.166.0`; JSON-RPC-адаптер не менялся. Дополнительно добавлены
   опции `codexPackage` / `codexBin` / `command`, чтобы можно было указать
   любой современный Codex (включая установленный приложением app-server).
3. **Почему не ждать апстрим.** `lib/index.js` плагина байт-идентичен во всех
   версиях `0.2.2-alpha.3`…`0.2.2-rc.5`; npm-тег `latest` (`0.0.1-rc.1`)
   старее установленной версии, а `next` (`0.2.2-rc.5`) не меняет Codex-pin.
   В master публичного `deepseek-harness` — тоже `0.153.4`.
4. **Live e2e пройден.** На DSH `0.2.2-rc.5` нативные инструменты
   `subagent_codex`, `subagent_codex_terra`, `subagent_codex_sol` вернули
   `OK` на `gpt-6-luna` / `gpt-6.1-terra` / `gpt-6.1-sol`; детали —
   [COMPATIBILITY.md](COMPATIBILITY.md) и
   [research/live-e2e-2026-11-19.md](research/live-e2e-2026-11-19.md).

## Содержимое репозитория

| Путь | Что внутри |
|---|---|
| [PLAN.md](PLAN.md) | План внедрения: варианты (override/форк/апстрим), фазы, тест-матрица, риски, откат |
| [COMPATIBILITY.md](COMPATIBILITY.md) | Что и на каких версиях DSH/Codex реально проверено (и что ещё нет) |
| [packages/dsh-subagent-codex-next/](packages/dsh-subagent-codex-next/README.md) | Форк-пакет: код, конфигурация, установка/откат, probe |
| [spikes/protocol/REPORT.md](spikes/protocol/REPORT.md) | Спайк: wire-совместимость с Codex 0.166/0.169, матрица моделей, JSON-schema-дифф протокола |
| [research/upstream-report.md](research/upstream-report.md) | Апстрим-ресёрч: версии плагина/Codex, diffs, рекомендация по пину |
| [research/override/REPORT.md](research/override/REPORT.md) | Альтернатива без форка: pnpm-override `@openai/codex → 0.166.0` (проверено на копии профиля) |
| `tools/` | Служебное чтение `app.asar` (не входит в пакет) |

## Проверка

```powershell
cd packages/dsh-subagent-codex-next
node scripts/probe-app-server.mjs --no-turn          # handshake, 0 токенов
npm install
node scripts/probe-app-server.mjs --model gpt-6-luna # один крошечный turn
```

Ожидаемо: `outcome=handshake-only` / `outcome=success`, ответ модели в
`scripts/results/`, raw-кадры в `scripts/logs/` (env и токены не логируются).

## Как контрибьютить

Перед любыми изменениями прочитайте [AGENTS.md](AGENTS.md) — там обязательные
правила для агентов и людей.

Коротко: **прямые коммиты в `main` запрещены**. Каждая задача — отдельная
ветка (`docs/…`, `fix/…`, `feat/…`) от актуального `main` и отдельный pull
request; PR сливается через GitHub (squash) после проверок, ветка удаляется.
Правило действует на уровне GitHub (ruleset `main: pull requests only`):
прямой push в `main` отклоняется, force-push и удаление `main` запрещены.

## Лицензия

[MIT](LICENSE). Форк основан на `@deepseek-ai/dsh-subagent-codex` (MIT, DeepSeek);
исходный текст лицензии сохранён в
[`packages/dsh-subagent-codex-next/LICENSE`](packages/dsh-subagent-codex-next/LICENSE).
«Codex» — продукт OpenAI; репозиторий не связан с DeepSeek и OpenAI.
