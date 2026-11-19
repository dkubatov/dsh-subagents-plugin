# pnpm override `@openai/codex` → 0.166.0: проверка в изолированной копии профиля

**Статус: ПОДТВЕРЖДЕНО.** Рабочий вариант — `overrides:` в `pnpm-workspace.yaml`.
`pnpm.overrides` в `package.json` на pnpm 11.28.5 **не работает** (ключ игнорируется).
Живой профиль не изменялся: всё выполнялось в `research/override/profile-copy/`.

- Дата проверки: 2026-11-19
- Окружение: Windows, node v24.19.0 (system), pnpm 11.28.5 (bundled DSH runtime), store `C:\Users\kubat\AppData\Local\pnpm\store\v11` (1273 MB)
- Изолированная копия: `research/override/profile-copy/` (создана копированием `package.json`, `pnpm-workspace.yaml`, `pnpm-lock.yaml` из `C:\Users\kubat\.dsh\profiles\desktop`; без `node_modules`)

## 1. Точная команда запуска pnpm

`pnpm` в PATH отсутствует. Бандленный pnpm лежит в runtime DSH:

```powershell
$pnpm = 'D:\DeepSeek\resources\runtime\primary-runtime\dependencies\pnpm\bin\pnpm.cjs'
node $pnpm --version    # 11.28.5  (совпадает с D:\DeepSeek\resources\runtime\versions.json)
```

Полная команда установки в копии (использовалась фактически):

```powershell
$store = 'C:\Users\kubat\AppData\Local\pnpm\store\v11'
node $pnpm install --offline --config.storeDir="$store" --config.package-import-method=copy --reporter=append-only
```

Почему нужны `--config.storeDir` и `package-import-method=copy`: копия профиля лежит на `D:`, и pnpm сам выбирает стор по диску проекта — пустой `D:\.pnpm-store\v11` (0 MB), т.к. хардлинки с `C:` невозможны. Без этих флагов `--offline` падает с `ERR_PNPM_NO_OFFLINE_TARBALL` (проверено: 0.166.0 и `@deepseek-ai/dsh-subagent-codex` отсутствуют в D-сторе). В живом профиле (`C:`) эта проблема не возникает — там используется C-стор по умолчанию.

## 2. Вариант A — `overrides:` в `pnpm-workspace.yaml` ✅ РАБОЧИЙ

`research/override/profile-copy/pnpm-workspace.yaml`:

```yaml
packages:
  - .

overrides:
  '@openai/codex': 0.166.0

nodeLinker: hoisted
autoInstallPeers: false
minimumReleaseAgeExclude:
  - dsh-codex-subscription@3.1.4 || 3.2.14
```

Результат `pnpm install --offline` (из lockfile копии с 0.153.4 → re-resolve):

- pnpm 11.28.5 **принимает** ключ `overrides` в `pnpm-workspace.yaml` (никаких warning'ов о неизвестном ключе; в логе `Lockfile is up to date`/затем re-resolve).
- Lockfile переписан: появился блок `overrides:` и **все** `@openai/codex*` стали 0.166.0:
  ```yaml
  overrides:
    '@openai/codex': 0.166.0
  ```
  `Select-String '0\.153\.4' pnpm-lock.yaml` → **0 совпадений**.
- Платформенные пакеты (`npm:@openai/codex@0.153.4-win32-x64` и т.п., задекларированные как alias-зависимости `@openai/codex-win32-x64`) override **не ломает**: они перерезолвились в `@openai/codex@0.166.0-win32-x64`. Т.е. одного ключа `@openai/codex` достаточно, отдельные overrides для `@openai/codex-*` не нужны.
- Время: **4.4–7.5 с**, объём изменений: `+2 −11` пакетов (удалён 0.153.4-дерево, добавлен 0.166.0-win32-x64), итоговый `node_modules` — **488.7 MB** (два платформенных бинаря).
- Warnings: только **предсуществующие** peer-warnings профиля (`missing peer @deepseek-ai/cordis`, `@deepseek-ai/dsh-llm`, ... — framework-пакеты DSH не лежат в node_modules профиля, `autoInstallPeers: false`; в живом профиле ровно то же самое, к override отношения не имеют). Warning'ов про supply-chain/release-age при установке конкретно 0.166.0 **нет** (`minimumReleaseAge` в pnpm-конфиге не задан; строка `✓ Lockfile passes supply-chain policies` — штатная проверка pnpm 11).

## 3. Проверка резолвинга «как из плагина» ✅

Воспроизведена ровно логика `@deepseek-ai/dsh-subagent-codex/lib/index.js` (стр. 535–538):

```js
const codexPackageJsonPath = createRequire(import.meta.url).resolve("@openai/codex/package.json");
const CODEX_PACKAGE_BIN = resolve(dirname(codexPackageJsonPath), codexPackageManifest.bin.codex);
```

Скрипт `research/override/verify-resolve.mjs` (запуск: `node research/override/verify-resolve.mjs research/override/profile-copy`), результат на варианте A:

| Проверка | Значение |
|---|---|
| `resolve('@openai/codex/package.json')` из `.../dsh-subagent-codex/lib/index.js` | `...\profile-copy\node_modules\@openai\codex\package.json` |
| version | **0.166.0** |
| bin | `...\node_modules\@openai\codex\bin\codex.js` |
| `node bin/codex.js --version` | **`codex-cli 0.166.0`** |
| платформенный пакет | `@openai/codex@0.166.0-win32-x64` (`name` в манифесте — `@openai/codex`), `vendor\x86_64-pc-windows-msvc\bin\codex.exe` присутствует |
| stale 0.153.4 в `node_modules/.pnpm` | нет (`stale: []`), плагин не имеет вложенного `node_modules`, резолв идёт в hoisted-корень |
| `pnpm why @openai/codex` | только `@openai/codex@0.166.0` (+ платформенные 0.166.0-*), ни одного 0.153.4 |

Логи: `research/override/logs/verify-A-final.log`, `install-A-final.log`.

## 4. Вариант B — `pnpm.overrides` в `package.json` ❌ НЕ РАБОТАЕТ

`package.json`:
```json
"pnpm": { "overrides": { "@openai/codex": "0.166.0" } }
```

pnpm 11.28.5 явно предупреждает и игнорирует:

```
WARN  The "pnpm" field in package.json is no longer read by pnpm.
      The following keys were ignored: "pnpm.overrides".
```

Резолвинг из плагина после `pnpm install`: **0.153.4**, `node bin/codex.js --version` → **`codex-cli 0.153.4`**; в lockfile остались оба дерева (0.153.4 и 0.166.0), `overrides:`-блока нет. Логи: `logs/install-B.log`, `logs/verify-B.log`.

**Вывод: единственное рабочее место для override на pnpm 11 — `pnpm-workspace.yaml`. package.json вариант неприменим в принципе.**

## 5. Устойчивость к DSH plugin-manager

- `package.json` вариант отпадает, поэтому вопрос устойчивости сводится к `pnpm-workspace.yaml`. Плюс: plugin-manager уже пишет в этот файл (`minimumReleaseAgeExclude`, `allowBuilds`) — значит файл не является для него «чужим»; он должен сохранять прочие ключи (merge). package.json plugin-manager переписывает чаще (dependencies, dsh.profile.bundles), и `pnpm`-поле там игнорируется и было бы потеряно.
- **Риск сохраняется**: если plugin-manager когда-нибудь перезапишет `pnpm-workspace.yaml` целиком (а не merge), override исчезнет. Практическая проверка после каждой операции install/update/disable плагина:
  ```powershell
  Select-String -Path "$env:DSH_PROFILE_DIR\pnpm-workspace.yaml" -Pattern "overrides:|@openai/codex"
  Select-String -Path "$env:DSH_PROFILE_DIR\pnpm-lock.yaml" -Pattern "0\.153\.4"   # должно быть 0
  ```
  Если override пропал — вернуть блок и `pnpm install` (5 с). Рекомендуется держать сниппет в `research/override/` и добавить проверку в onboarding-доку плагина.
- Другое следствие: lockfile теперь содержит `overrides:`. Если plugin-manager запустит `pnpm install` без re-resolve — всё консистентно (lockfile уже с override). Если он принудительно `--frozen-lockfile` при неизменных манифестах — тоже ок.

## 6. `dsh-codex-subscription` и peer'ы

`dsh-codex-subscription@3.2.14` **не зависит** от `@openai/codex`; его связь с плагином — optional peer `@deepseek-ai/dsh-subagent-codex` (диапазон `... >=0.2.2-rc.1 <0.2.3-0`, в `peerDependenciesMeta` как optional). Override версии Codex CLI этот peer не затрагивает: версия `@deepseek-ai/dsh-subagent-codex` остаётся `0.2.2-rc.1`. Ломаться нечему; peer-warnings в `pnpm peers check` — предсуществующие (framework-пиры DSH не установлены в node_modules профиля), идентичны живому профилю.

## 7. Что будет при переходе на 0.170.0

Это **смена одного значения**, без форка и без правок плагина:

```yaml
overrides:
  '@openai/codex': 0.170.0
```
затем `pnpm install` (нужна сеть: tarball'ов 0.170.0 нет в сторе; платформенный пакет крупный). Lockfile перегенерируется автоматически, старый бинарь удалится. Нюансы:
- если DSH начнёт enforced `minimumReleaseAge` и версия «слишком свежая» — добавить `- '@openai/codex@0.170.0'` в `minimumReleaseAgeExclude` (там уже есть аналогичная запись для `dsh-codex-subscription`).
- plugin-manager сам обновляет только плагин; override придётся менять руками (или скриптом).
- Плагин пиннит `@openai/codex: 0.153.4` в своих `dependencies` — override действует поверх, но semver-несовместимость остаётся на совести пользователя.

## 8. Риски и рекомендация

Риск №1 (главный): **протокольная совместимость**. В шапке `lib/index.js` плагина: *«Minimal Codex app-server 0.153.4 protocol adapter»*. Override подсовывает CLI 0.166.0, чей app-server JSON-RPC может отличаться; статически это не проверяется. Нужен end-to-end прогон subagent-задачи (это делает spike/тесты, не эта задача). Косвенный плюс: alias `dsh-codex-subtask-cli → @openai/codex@0.166.0` уже стоит в профиле и используется, т.е. CLI 0.166.0 в системе рабочий; но adapter плагина — отдельная история.

Риск №2: override молча нарушает exact-pin `0.153.4` в манифесте плагина; при обновлении/переустановке плагина нужна повторная проверка (п.5).

Риск №3: хрупкость к перезаписи `pnpm-workspace.yaml` plugin-manager'ом (п.5) и к смене поведения pnpm в будущих версиях (на 11.28.5 поддержка подтверждена; в pnpm 11 `package.json#pnpm` уже мёртв).

**Рекомендация для плана:**
1. Использовать **override в `pnpm-workspace.yaml`** как основной механизм: минимальное вмешательство, переживает правки plugin-manager'а лучше package.json, не требует форка, смена версии — одна строка.
2. Для живого профиля (когда Lead решит): добавить блок `overrides` в `C:\Users\kubat\.dsh\profiles\desktop\pnpm-workspace.yaml`, выполнить `pnpm install` (5–10 с, ~490 MB `node_modules`), затем прогнать `verify-resolve.mjs` и e2e subagent-задачу.
3. Форк/патч манифеста плагина (`@openai/codex: 0.166.0` в его `dependencies`) — только если понадобится менять код под протокол 0.166.0; для простого обновления версии форк избыточен.
4. В репозиторий добавить проверочный скрипт (`research/override/verify-resolve.mjs` как основа) и упомянуть override в документации: он должен переприменяться после установок/обновлений плагинов.

## 9. Артефакты

- `research/override/profile-copy/` — изолированная копия профиля в финальном **рабочем** состоянии (variant A): `pnpm-workspace.yaml` с `overrides`, перегенерированный `pnpm-lock.yaml` (0.153.4 = 0 вхождений), исходники в `*.orig.*`. `node_modules` после проверки удалён (воспроизводится командой из п.1 за ~5 с).
- `research/override/verify-resolve.mjs` — верификатор резолвинга из плагина (+ `--version`, платформенный пакет, stale-поиск).
- `research/override/logs/` — `install-A-final.log`, `install-B.log`, `verify-A-final.log`, `verify-B.log`.
- Живой профиль `C:\Users\kubat\.dsh\profiles\desktop`, `~/.codex` и установленные пакеты **не изменялись** (только чтение).
