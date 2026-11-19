# План: починка Codex-субагентов DSH для моделей gpt-6.x

Дата: 2026-11-19 · Статус: исследование завершено, recommend-план готов, внедрение не
выполнено (живой профиль не изменялся) · Артефакты: [README](README.md), [спайк](spikes/protocol/REPORT.md),
[апстрим-ресёрч](research/upstream-report.md), [override-проверка](research/override/REPORT.md),
[форк](packages/dsh-subagent-codex-next/README.md).

---

## 1. Диагноз (подтверждено эмпирически)

> **Статус проверки артефактов (2026-11-19, Lead):** спайк-прогон повторён
> вручную (`gpt-6-luna` через wire-последовательность плагина на Codex 0.166.0
> → `completed`, ответ `OK`); override переустановлен с нуля в копии профиля →
> резолвится `0.166.0`, `codex-cli 0.166.0`; tarball форка установлен в чистый
> profile-like layout (`pnpm add file:…tgz`, offline) → зависимость форка
> `@openai/codex@0.166.0` ставится и резолвится, packaged-probe handshake
> проходит. Команда/логи: `research/override/logs/`, `research/fork-install-test/`.

Цепочка сбоя:

```
subagent_codex / subagent_codex_luna / subagent_codex_terra
  → @deepseek-ai/dsh-subagent-codex@0.2.2-rc.1
    → createRequire(...).resolve("@openai/codex/package.json")   // exact dep
      → @openai/codex@0.153.4 (bin/codex.js → vendor codex.exe)
        → codex app-server --stdio
          → turn/start { model: "gpt-6-luna" }
            → HTTP 400 model_not_found: "The 'gpt-6-luna' model is not
              supported when using Codex with a ChatGPT account."
```

Ключевые факты (все проверены на этой машине; ссылки на отчёты в шапке):

| Факт | Проверка |
|---|---|
| Плагин пинит `@openai/codex@0.153.4` жёстко (exact) | `package.json` плагина; `lib/index.js` стр. 535 |
| `0.153.4` **старше** всей gpt-6-эры (gpt-6 появился в Codex 0.156.0) | апстрим-ресёрч, §2 |
| Wire-последовательность плагина совместима с `0.166.0` и с app-бинарём `0.169.0-alpha.11.1` | спайк: 9/9 handshake+thread/start, 7/7 успешных turn'ов |
| `gpt-6-luna`, `gpt-6.1-sol`, `gpt-6.1-terra` работают на `0.166.0` с ChatGPT-аккаунтом | спайк: matrix.json |
| Контроль: `0.153.4` воспроизводит ровно тот же 400 | спайк, §4 |
| Апстрим-фикса нет ни в одной опубликованной версии | ресёрч: `lib/index.js` байт-идентичен (rc.1…rc.5, alpha.3), pin 0.153.4 везде; master GitHub — тоже |
| npm-тег `latest` плагина (`0.0.1-rc.1`) старее установленной; `next` = `0.2.2-rc.5` — **не** содержит bump | ресёрч, §1 |
| `pnpm overrides` в `pnpm-workspace.yaml` принудительно ставит плагину `0.166.0` | override-проверка на копии профиля; резолвинг из плагина → `codex-cli 0.166.0` |
| `pnpm.overrides` в `package.json` **не работает** (pnpm 11 игнорирует поле) | override-проверка, вариант B |
| Хост обновлён с DSH 0.2.2-rc.1 до **0.2.2-rc.5** (2026-11-19); upstream-плагин 0.2.2-rc.1 стал `incompatible-version`, все опубликованные версии плагина по-прежнему пинят Codex 0.153.4 | `research/versions-after-dsh-update.json`, `plugin_manager list_bundles` |

**Вывод:** сломан не wire и не аккаунт, а устаревший Codex-payload в
зависимости плагина. Достаточно поднять payload до `0.166.0`; правки
JSON-RPC-адаптера не нужны.

---

## 2. Рассмотренные варианты

| # | Вариант | Плюсы | Минусы | Вердикт |
|---|---|---|---|---|
| A | **Ждать апстрим / обновиться** | ничего не делать | фикса нет ни в одном релизе; репозиторий без issues/PR; ETA неизвестен; хост-обновление pin не меняет | ❌ не решает |
| B | **pnpm override** `@openai/codex → 0.166.0` в `pnpm-workspace.yaml` профиля | 0 кода; проверено; ~5 сек установки; легко откатить; переживает обновления пакета плагина | это модификация профиля, а не артефакт; plugin-manager может перезаписать `pnpm-workspace.yaml` (риск низкий, merge-логика есть); код плагина остаётся «0.153.4 baseline» | ✅ **быстрый hotfix** |
| C | Подменить payload «на месте» (nested `node_modules/@openai/codex` внутри плагина) | работает без конфигов | не декларативно, слетит при переустановке, не видно в lockfile, ручной труд | ⚠️ только аварийный |
| D | **Форк плагина** со своим пином и настраиваемым executable | самодостаточный артефакт; свои модель-дефолты и bundle-слой; можно публиковать/делиться; место для будущих фиксов | нужен пакет/установка; upstream-тесты не поставляются — нужен свой acceptance; peer-риск при апгрейде хоста | ✅ **durable-решение** |
| E | Новый плагин «с нуля» | чистый код | бессмысленно: ~900 строк проверенного wire уже есть; риск регрессий выше | ❌ |
| F | Сменить backend субагентов (Claude Code и т.п.) | обход | не решает задачу, меняет продукт | ❌ вне scope |

**Рекомендация — двухшаговая:**

1. **Сейчас (Phase 0):** override в `pnpm-workspace.yaml` + правка моделей в
   `cordis.patch.yml` профиля. Это чинит `subagent_codex*` на gpt-6.x за
   ~15 минут, без нового пакета.
2. **Далее (Phase 1):** установить форк как отдельный bundle и выключить
   upstream-bundle. Это убирает зависимость от override и даёт переносимый
   артефакт. MVP форка уже собран в этом репозитории.
3. **Phase 2–3:** расширить тесты, решить вопрос `0.170.0`, отправить
   upstream-отчёт/PR и вернуться на официальный пакет, когда в нём появится
   bump Codex.

Почему не ограничиться override: он лечит профиль, но не решает проблему
«пакет декларирует несовместимый payload». Любая переустановка/пересборка
профиля может потребовать повторной проверки override; форк же несёт свой пин
в `package.json` и проверяется автоматически.

---

## 3. Phase 0 — быстрый hotfix (сейчас, ~15 минут)

Предусловия: бэкап `cordis.patch.yml` профиля; закрыты операции plugin-manager
(не устанавливать/не удалять плагины в GUI в этот момент). Живой профиль:
`C:\Users\kubat\.dsh\profiles\desktop`.

### 3.1. Override

`pnpm` в PATH не установлен; рабочий запуск:

```powershell
$pnpm = 'node D:\DeepSeek\resources\runtime\primary-runtime\dependencies\pnpm\bin\pnpm.cjs'
cd C:\Users\kubat\.dsh\profiles\desktop
Copy-Item pnpm-workspace.yaml pnpm-workspace.yaml.bak-before-override
Copy-Item pnpm-lock.yaml     pnpm-lock.yaml.bak-before-override
Copy-Item cordis.patch.yml   cordis.patch.yml.bak-before-gpt6
```

В `C:\Users\kubat\.dsh\profiles\desktop\pnpm-workspace.yaml` добавить:

```yaml
overrides:
  '@openai/codex': 0.166.0
```

Затем:

```powershell
& $pnpm install          # ожидаемо: +2 −11 пакетов, 5–15 с, только peer-warnings
```

Проверка резолвинга ровно как в коде плагина:

```powershell
node -e "const {createRequire}=require('node:module');const r=createRequire('C:/Users/kubat/.dsh/profiles/desktop/node_modules/@deepseek-ai/dsh-subagent-codex/lib/index.js');const p=r.resolve('@openai/codex/package.json');console.log(p,require(p).version)"
# ожидается: ...@openai\codex\package.json 0.166.0
```

(В lockfile не должно остаться `0.153.4`; это уже проверено на копии профиля.)

### 3.2. Модели в патче профиля

Сейчас в `cordis.patch.yml` модели зафиксированы на gpt-5.6 (обходной путь).
Заменить на gpt-6.x; рекомендуемая раскладка:

```yaml
- id: subagent-codex
  name: "@deepseek-ai/dsh-subagent-codex"
  config:
    model: gpt-6-luna          # базовый инструмент subagent_codex
- insert:
    - id: subagent-codex-luna
      name: "@deepseek-ai/dsh-subagent-codex"
      config:
        providerName: codex-luna
        model: gpt-6-luna      # сохраняем имя инструмента; модель = дефолт
    - id: subagent-codex-terra
      name: "@deepseek-ai/dsh-subagent-codex"
      config:
        providerName: codex-terra
        model: gpt-6.1-terra
    - id: subagent-codex-sol
      name: "@deepseek-ai/dsh-subagent-codex"
      config:
        providerName: codex-sol
        model: gpt-6.1-sol
    # + tool-subagent-codex-{luna,terra,sol} с toolName
    #   subagent_codex_luna/terra/sol, provider: codex-…, maxDepth: provider-managed
```

Важно: `subagent-model-selection-settings.allowedModels` уже содержит
`gpt-6.1-sol`, `gpt-6.1-terra`, `gpt-6-luna` — менять там ничего не нужно.

### 3.3. Применить и проверить

1. Перезапустить DSH (без HMR изменения профиля не применяются; текущая
   сессия — часть процесса).
2. Acceptance (минимум):
   - `subagent_codex` с задачей «Reply with OK» → ответ, без `product-error`;
   - `subagent_codex_terra` → `gpt-6.1-terra`; `subagent_codex_sol` → `gpt-6.1-sol`;
   - в логах/host stderr нет `model_not_found`;
   - `node scripts/probe-app-server.mjs --no-turn` для форка/Override — по желанию.
3. Контрольная точка: `grep 0\.153\.4 C:\Users\kubat\.dsh\profiles\desktop\pnpm-lock.yaml` — пусто.

### 3.4. Откат Phase 0

```powershell
cd C:\Users\kubat\.dsh\profiles\desktop
Copy-Item pnpm-workspace.yaml.bak-before-override pnpm-workspace.yaml -Force
Copy-Item pnpm-lock.yaml.bak-before-override     pnpm-lock.yaml -Force
Copy-Item cordis.patch.yml.bak-before-gpt6      cordis.patch.yml -Force
& $pnpm install
# перезапуск DSH
```

---

## 4. Phase 1 — форк как отдельный bundle (0.5–1 день)

### 4.1. Что уже готово

`packages/dsh-subagent-codex-next/` — MVP форка: `@openai/codex@0.166.0`,
опции `codexPackage`/`codexBin`/`command`, свой bundle-слой с id `-next`,
probe-скрипт, README с установкой/откатом. `lib/index.js` собран из upstream rc.5
с минимальными правками (см. diff-описание в README форка); `src/` приложен.

### 4.2. Установка

```powershell
cd packages/dsh-subagent-codex-next
npm pack --pack-destination .artifacts
```

Далее — `plugin_manager install_bundle` с target
`file:D:\Repos\DSH\plugins\subagents\packages\dsh-subagent-codex-next\.artifacts\dsh-subagent-codex-next-0.2.2-rc.5-dsh.1.tgz`,
`enabled: true` (можно попросить агента в этой сессии; операция требует
danger-full-access/approval). После установки:

1. Выключить upstream-bundle `@deepseek-ai/dsh-subagent-codex` (dependency
   остаётся) — его слой больше не применяется.
2. Удалить из `cordis.patch.yml` профиля блок `insert`-строк
   `subagent-codex*`/`tool-subagent-codex*`, которые монтируют upstream
   (иначе они продолжат поднимать провайдера с 0.153.4). Строки для вариантов
   `-next` (sol/terra) — из README форка.
3. Перезапустить DSH; acceptance — как в §3.3.

### 4.3. Ожидаемый результат

- `subagent_codex` → gpt-6-luna (нативный `config.toml`), варианты sol/terra — из патча.
- Никаких зависимостей от override профиля: пин живёт в `package.json` форка.
- Откат: `remove_bundle` + включить upstream + вернуть patch-бэкап.

### 4.4. Что доделать в форке до «продакшена»

- [ ] **Воспроизводимая сборка**: добавить `tsdown`/`tsconfig` (в npm-tarball
      upstream конфиги сборки не входят) и скрипт `build`, чтобы `lib/` не был
      ручным артефактом; CI-проверка «lib == build(src)».
- [ ] **Расширенный probe**: approval-flow с инструментами (approve-for-me),
      cancel/interrupt, `--no-turn` во всех трёх permission-mode; зафиксировать
      ожидаемые результаты.
- [ ] **Пин-файл**: `package.json` + `npm run probe` в pre-release чеклисте.
- [x] **Публикация/распространение**: GitHub-релиз tarball;
      артефакт `v0.2.2-rc.5-dsh.1` для хоста 0.2.2-rc.5 (старый
      `v0.2.2-rc.1-dsh.1` сохранён для хоста 0.2.2-rc.1).
- [x] **Peer-политика**: артефакт привязан к версии хоста (deps/peers exact
      `0.2.2-rc.5`, `engines.dsh: >=0.2.2-rc.5 <0.2.3-0`); при следующем
      обновлении хоста нужен новый релиз форка с версией этого хоста.

---

## 5. Phase 2 — стабилизация и апстрим (1–3 дня)

1. **Решить `0.170.0`**: `npm install @openai/codex@0.170.0` в пакете форка →
   `npm run probe` → матрица моделей → решить, оставаться на 0.166.0 или
   перейти. Без прогона не пинить (спайк не проверял 0.170.0).
2. **Обновление хоста до 0.2.2-rc.5** (апдейтер уже предлагает): гигиена и
   свежие peer-графы; **не** фикс проблемы (pin плагина тот же). Порядок:
   обновление хоста → повторная проверка override/форка → повторный acceptance.
3. **Upstream**: репозиторий `deepseek-ai/deepseek-harness` публичен, но
   issues/PR отключены — отправить отчёт через in-app feedback с этим
   исследованием и diff'ом форка; следить за `npm dist-tags` плагина и
   `@openai/codex` в master. Критерий «апстрим починил»: в новой версии
   `dependencies.@openai/codex >= 0.159` (для gpt-6.1 нужен ≥0.159, для
   gpt-6.2 — ≥0.166) **и** `lib/index.js` не байт-идентичен.
4. **Retire workaround**: когда апстрим-версия с фиксом выйдет и пройдёт
   acceptance — удалить форк/override, вернуть official bundle.

---

## 6. Тест-матрица и критерии приёмки

| Уровень | Что | Как | Ожидание |
|---|---|---|---|
| Wire (без токенов) | handshake + thread/start, 3 permission-mode | `node scripts/probe-app-server.mjs --no-turn --mode never/approve-for-me/dangerously-bypass...` | `handshake-only`, `ephemeral=true` |
| Wire (1 turn) | модели | `--model gpt-6-luna / gpt-6.1-sol / gpt-6.1-terra / gpt-5.6-sol (контроль)` | `completed`, output, 5–30 с |
| Негатив | `0.153.4` контроль | probe с `--command` на старый бинарь | 400 `model_not_found` (доказывает валидность теста) |
| DSH e2e | инструменты `subagent_codex*` после рестарта | delegate-запрос на «Reply with OK» | ответ без `product-error`; модель в логе |
| Профиль | override не потерян | `Select-String overrides pnpm-workspace.yaml`; в lockfile нет `0.153.4` | есть/нет |
| Регрессия | 5.6-модели | `--model gpt-5.6-sol` | работают (fallback) |
| Повтор после plugin-manager | установка/удаление любого плагина не сломала форк/override | повторить разрешение `@openai/codex` из плагина | 0.166.0 |

Критерии приёмки Phase 0/1: все пункты зелёные; откат проверен на копии или
бэкапе; в host-логах нет `model_not_found`.

---

## 7. Риски и митигации

| Риск | Вероятность | Влияние | Митигация |
|---|---|---|---|
| `plugin-manager` перезапишет `pnpm-workspace.yaml` и потеряет `overrides` | низкая (он merge-ит свои ключи) | override молча исчезнет после установки плагина | хранить override в `pnpm-workspace.yaml` (единственное рабочее место), после каждой операции проверять резолвинг; при потере — вернуть блок + `pnpm install` (~5 с) |
| Ошибка в profile patch (`id`/`toolName` коллизии) | средняя | DSH не поднимет слой / дубли инструментов | ставить форк с id `-next`; удалять upstream-insert'ы; держать бэкап `cordis.patch.yml`; HMR/рестарт по инструкции |
| `codex app-server` 0.166 отличается в непроверенных путях (approval с инструментами, cancel) | средняя | отдельные сценарии субагента | Phase 2 probe для approval/cancel; при инциденте — быстрый откат на 5.6-модели/0.153.4 |
| Обновление хоста меняет peer-граф/переустанавливает профиль | средняя | форк/override требуют повторной проверки | обновлять хост осознанно, после обновления прогнать acceptance |
| Модельный каталог/аккаунт меняется (gpt-6.2 и т.п.) | средняя | старый payload снова отстанет | держать пин в одном месте (`package.json`/overrides) + probe в чеклисте; обновление = bump + прогон матрицы |
| `0.170.0` окажется протокольно несовместим | низкая | сломанные turns | не пинить без probe; 0.166.0 — проверенный base |
| Безопасность диагностики: сырой `turn.error.message` скрыт upstream-кодом | — | сложнее диагностировать 400 | опциональный backlog: пробрасывать `httpStatus`/`error.code` из `turn.error.message` в safe-diagnostic (спайк §9.5) |

---

## 8. Оценка трудозатрат

| Работа | Оценка |
|---|---|
| Phase 0 (override + модели + рестарт + acceptance) | ~15–30 мин |
| Phase 1 (форк уже собран): pack/install/disable upstream/patch/рестарт/acceptance | ~1–2 ч |
| Phase 1 «до продакшена» (build, расширенный probe, публикация) | ~0.5–1 день |
| Phase 2 (0.170 probe, хост rc.5, upstream feedback, retire) | ~1–2 дня (в основном ожидание/проверки) |

---

## 9. Что нужно решить (вопросы к владельцу)

1. **Применять Phase 0 сейчас?** (override + правка моделей + перезапуск DSH;
   откат — 4 команды из §3.4). Живой профиль сейчас не тронут.
2. **Ставить форк сразу** (Phase 1) или пожить на override и вернуться к форку
   позже?
3. **Обновлять ли хост до 0.2.2-rc.5** перед внедрением (рекомендуется, но
   добавляет перезапуск и переустановку профиля)?
4. **Публиковать ли форк** (npm-scope/GitHub-релиз) или держать локальным
   tarball'ом?

---

## 10. Артефакты

| Что | Где |
|---|---|
| Спайк: wire-совместимость, матрица моделей, JSON-schema-дифф | [spikes/protocol/REPORT.md](spikes/protocol/REPORT.md) |
| Апстрим-ресёрч: версии, diffs, pin-рекомендация | [research/upstream-report.md](research/upstream-report.md) |
| Override: проверка на копии профиля, команды, логи | [research/override/REPORT.md](research/override/REPORT.md) |
| Форк-пакет + README/установка/откат | [packages/dsh-subagent-codex-next/](packages/dsh-subagent-codex-next/README.md) |
| Probe-скрипты (спайк/форк) | `spikes/protocol/*.mjs`, `packages/dsh-subagent-codex-next/scripts/*.mjs` |
| Служебный доступ к `app.asar` | `tools/extract.mjs` |

## 11. Публикация

Репозиторий опубликован публично: <https://github.com/dkubatov/dsh-subagents-plugin>.
Актуальный релиз (хост 0.2.2-rc.5):
<https://github.com/dkubatov/dsh-subagents-plugin/releases/tag/v0.2.2-rc.5-dsh.1>
(asset `dsh-subagent-codex-next-0.2.2-rc.5-dsh.1.tgz` + `SHA256SUMS.txt`).
Предыдущий релиз для хоста 0.2.2-rc.1:
<https://github.com/dkubatov/dsh-subagents-plugin/releases/tag/v0.2.2-rc.1-dsh.1>.

Установка прямо из релиза (`plugin_manager install_bundle`):

```json
{"action":"install_bundle","target":"https://github.com/dkubatov/dsh-subagents-plugin/releases/download/v0.2.2-rc.5-dsh.1/dsh-subagent-codex-next-0.2.2-rc.5-dsh.1.tgz","enabled":true}
```

Локальный репозиторий — корень этого рабочего пространства (`main`), remote
`origin` указывает на GitHub. Обновление опубликованных артефактов:

```powershell
cd packages/dsh-subagent-codex-next
npm pack --pack-destination .artifacts
# затем: commit + push; gh release upload v0.2.2-rc.5-dsh.1 .artifacts\*.tgz --clobber
```

