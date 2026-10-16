# Workplan: F-1, admin colour-settings save hardening and logging conversion

> **Last Updated**: 2026-10-16

**Developer:** Dev
**Requirement:** `docs/requirements/PERFORMANCE_IMPROVEMENT_SCOPING.md` §0, rows "RC-14 answered" and "TH-1 approved; F-1 started" (uncommitted, never commit it)
**Depends on:** TH-1 (`feature/perf-th1-theme-prepaint`), which adds `lib/design-system-v2/customTokens.ts`
**Branch:** `fix/f1-admin-ui-config-hardening` (from `origin/main` at `80a142ca`, after TH-1 #422 merged; worktree `neuronforge-f1`)
**Date:** 2026-10-15 (implemented 2026-10-16)
**Status:** Code Complete (uncommitted; awaiting SA code review + QA)
**Cycle:** full cycle (admin write route): SA workplan review → Dev → SA code review + QA → user sees diff → RM

## Overview

An admin edits the platform's custom design tokens (brand colours, radii, shadows, spacing, font sizes) at `/admin/ui-config`. The save route stores whatever it is sent. TH-1 made the **read** side the security boundary (`sanitizeV2CustomTokens`), because those values are now inlined into a raw `<style>` on every owner page. F-1 adds the matching **write** side: the save is validated with the same grammar, goes through the repository, is audited, and logs through Pino. It also removes two dead client hooks.

---

## 1. Analysis summary: what exists today

Read from `origin/main` at `8f3d88ed` and from the TH-1 worktree (read-only).

### 1.1 `app/api/admin/ui-config/route.ts` (175 lines, 8 `console.*`)

| Concern | Today | Compliant? |
|---|---|---|
| **Auth** | Both `GET` and `POST` call `requireAdmin(requestLogger)` as the first statement inside `try`, and return the gate's response. No other admin check in the file | ✅ Already compliant. No change needed beyond keeping it first |
| **Logger** | `createLogger({ module: 'UiConfigAdminAPI' })` exists and is used only for the gate. `GET()` takes no `request`, so it generates a correlation id instead of reading `x-correlation-id` | 🟡 Partly |
| **`console.*`** | 8: `GET` catch (1); `update_version`: `log` before write, 2× `error` on failure, `log` of the full result after (4); `save_tokens` failure (1); `reset_tokens` failure (1); outer catch (1) | ❌ |
| **Input validation** | None. `const { action, data } = body`; `version` and `tokens` are used as sent. `version.toUpperCase()` throws a 500 if `version` is not a string. `tokens` can be any JSON | ❌ (CLAUDE.md rule 2) |
| **DB access** | Module-level `createClient(URL, SERVICE_ROLE_KEY)`: direct service-role client in the route. Two `.single()` reads in `GET` whose errors are ignored; `upsert` for `ui_version` and `v2_custom_tokens`; `delete` for the reset | ❌ (CLAUDE.md rule 1) |
| **Error responses** | `update_version` returns `error.message` **and the raw Postgres error object as `details`** in every environment; `save_tokens`/`reset_tokens` return `error.message` | ❌ (Security Rules: no internal details in production) |
| **Audit** | None. Three admin writes of platform-wide settings leave no audit row | ❌ |
| **Correctness** | Unknown `action` → 400 (fine). Invalid tokens are stored and later dropped by TH-1's reader, so the admin sees "saved" and nothing changes | ❌ |

`SystemConfigRepository` (`lib/repositories/SystemConfigRepository.ts`) already has everything needed: `getByKey`, `getByKeys`, `set(key, value, category, description, { actorId })` (writes `updated_by` when given) and `delete(key)`. Its default client is `supabaseServer`. TH-1's reader already uses `getByKey` for the same key. **No repository change is needed.**

`system_settings_config` columns used (verified from the repository's own writes, which run in production): `key`, `value`, `category`, `description`, `updated_at`, `updated_by` (uuid FK to the user relation, verified live 2026-09-22 per the repository comment). No migration.

### 1.2 `ui_version` has no reader left

`git grep ui_version` on main: only this route and `lib/hooks/useUIVersion.ts`. The middleware rewrite that read it was removed (`middleware.ts:315-335` says so). So the admin page's **V1/V2 toggle writes a value nothing reads.** F-1 keeps the action (validated, converted) and raises its removal as a question (§10 Q-3); removing it is not in scope.

### 1.3 `app/admin/ui-config/page.tsx` (980 lines, 4 `console.*`)

`'use client'`. The 4 calls are `console.error('Error:', err)` in `fetchCurrentVersion`, `saveCustomTokens`, `resetToDefaults`, `handleVersionToggle`. Each also sets a `message` banner.

**Problem for F-1:** every handler does `if (!response.ok) throw new Error('Failed to save custom tokens')` **before** reading the body, so a 400 that names the invalid tokens would be shown as a generic failure. The handlers must read the JSON body first and show `result.error`.

Preset option lists (`radiusOptions`, `shadowOptions`, `spacingOptions`, `fontSizeOptions`) and the `v2Tokens` defaults the editor pre-fills were checked by hand against TH-1's grammar: all pass (hex colours; `Npx`/`Nrem` lengths; shadows `0 1px 2px rgba(0,0,0,0.05)` use only `px`/`rgba`). A test pins this (T-4), so a future preset cannot be rejected by its own page.

### 1.4 `lib/hooks/useUIVersion.ts` (87 lines, **5** `console.*`, not 3)

`'use client'`. Exports `useUIVersion`, `getUIVersion`, `setUIVersion`. All three read or write `system_settings_config` (`ui_version`) through the anon browser client `@/lib/supabaseClient` (rule 1 breach; `setUIVersion` is a browser-side write that only RLS stops).

**Dead code, confirmed:** `git grep` on `origin/main` for `useUIVersion`, `getUIVersion`, `setUIVersion` and the path finds **no importer** in any `.ts/.tsx/.js` file, including `scripts/` and tests. The only mentions are docs: `docs/architecture/BUSINESS_OS_MONOREPO_ARCHITECTURE.md:214` (file inventory) and two historical lines in `docs/workplans/SECDEF_LOCKDOWN_SLICE3_WORKPLAN.md`. In the TH-1 worktree it is mentioned only in a comment in `lib/design-system-v2/__tests__/themePrepaint.guard.test.ts` (G-8). And the value it reads (`ui_version`) has no consumer anyway (§1.2). **Proposal: delete it.** This also removes one of the browser readers in the TH-2b anon-reader inventory.

### 1.5 `lib/hooks/useTheme.ts` (68 lines, 1 `console.log`)

`'use client'`, a second `.dark` class writer plus `--background`/`--foreground` inline styles and a `localStorage` key `app-theme`. **Dead code, confirmed:** no importer of the path, and the identifier `useTheme` appears in no other `.ts/.tsx` file on main or in the TH-1 worktree. Only mention: the same architecture inventory line. **Proposal: delete it** (SA recorded this chore during TH-1).

### 1.6 TH-1's `customTokens.ts`, what F-1 reuses

From the TH-1 worktree (read-only):
- `V2_CUSTOM_TOKENS_CONFIG_KEY = 'v2_custom_tokens'`
- `V2_CUSTOM_TOKEN_VARS`: the allow-list, 5 groups / 31 keys
- `validTokenValue(group, raw)`: the trimmed value or `null` (string, 1..200 chars, group grammar)
- `sanitizeV2CustomTokensDetailed(raw)`: `{ tokens, droppedKeys }`

**Constraint:** TH-1 guard **G-12** requires `customTokens.ts` to import nothing. So the Zod schema cannot live in `customTokens.ts`; it goes in `lib/validation/` and imports the allow-list and `validTokenValue` from it. The grammar exists in exactly one place.

### 1.7 Audit

`AUDIT_EVENTS.SYSTEM_CONFIG_CHANGED` exists (`lib/audit/events.ts:182`), audience `'shared'` (`eventAudience.ts:125`), and is used nowhere today. It has no `EVENT_METADATA` entry; `getEventMetadata` has a fallback. Reusing it adds no new event.

### 1.8 Skills applied

| Skill | Why | Outcome |
|---|---|---|
| `new-api-route` | Rework of an admin route | `requireAdmin` first; Zod; repository; Pino + correlationId; non-blocking audit; dev-only `details` |
| `tenant-isolation-guard` | Service-role write | Not tenant data: a platform-wide row, admin-only, the key is a module constant and never caller-supplied. No `user_id` column. Documented as an intentional RLS bypass in the route header, same wording as TH-1's reader |
| `business-os-schema-check` | Column claims | §1.1. No new columns |
| `business-os-entitlements` | Not applicable: no import from `lib/business-os/entitlements/` | — |

---

## 2. Implementation approach

### 2.1 Write-side schema (one grammar, two sides)

**New file:** `lib/validation/admin-ui-config-schema.ts`

- `v2CustomTokensWriteSchema`: built **from `V2_CUSTOM_TOKEN_VARS`**, not hand-listed. For each group, a `z.object({...}).strict()` whose keys are the group's allow-listed keys, each `z.unknown().optional()` refined with `validTokenValue(group, v)`. A failing value adds an issue at path `[group, key]`; a passing value is **transformed to the trimmed value** (the same value the read side would emit). The top level is `.strict()` over the 5 groups. Unknown groups, unknown keys, `__proto__`, non-string values, and values outside the grammar are all rejected.
- **Empty values (Q-1):** the page stores `''` when an admin clears a text field, and renders it as the default (`customTokens.colors?.x || default`). Proposal: a value that is empty or whitespace-only means "use the default" and is **removed** before validation, not rejected. Groups left empty are removed. The stored object then contains only real overrides.
- `uiConfigPostSchema`: `z.discriminatedUnion('action', [...])`:
  - `update_version`: `data: { version: z.enum(['v1', 'v2']) }`
  - `save_tokens`: `data: { tokens: v2CustomTokensWriteSchema }`
  - `reset_tokens`: `data` optional, ignored
- `invalidTokenKeys(zodError)`: returns the `group.key` names from the issues, for the message.

**Parity guarantee (anti-drift):** a test (T-3) asserts, over a corpus of valid and hostile inputs, that the schema accepts an object **if and only if** `sanitizeV2CustomTokensDetailed` drops nothing and keeps every non-empty key, and that the stored output equals the sanitizer's output. If someone changes the grammar on one side, the test fails.

### 2.2 Route rewrite (`app/api/admin/ui-config/route.ts`)

- Remove `createClient` and the module-level service-role client. Use `systemConfigRepository` (the exported singleton TH-1 already uses).
- Keep `requireAdmin` as the first statement in both handlers. `GET(request: NextRequest)` takes the request so it can propagate `x-correlation-id`.
- `GET`: `getByKeys(['ui_version', V2_CUSTOM_TOKENS_CONFIG_KEY])`. A repository error is now a 500 (today it is silently returned as defaults). Response shape unchanged: `{ uiVersion, customTokens }`. See Q-2 about adding `ignoredKeys`.
- `POST`: parse the body (malformed JSON → 400), then `uiConfigPostSchema.safeParse`. On failure:
  - tokens: 400 `{ success: false, error: 'These values are not valid: colors.primary, shadows.card. Use a colour such as #6366F1, or a size such as 12px.', invalidKeys: [...] }`. **Key names only, never the rejected value** (no reflection of the input; same rule as TH-1's logs).
  - anything else: 400 `{ success: false, error: 'Invalid input' }` with `details: error.flatten()` only in development.
- Writes: `set(key, value, 'ui', description, { actorId: gate.user.id })` for `ui_version` and `v2_custom_tokens`; `delete(V2_CUSTOM_TOKENS_CONFIG_KEY)` for the reset. Repository error → 500 `'Failed to save UI configuration'`, `details` development-only. The raw Postgres error is never returned in production.
- Audit after each successful write, **non-blocking**: `AuditTrailService.getInstance().log({ action: AUDIT_EVENTS.SYSTEM_CONFIG_CHANGED, entityType: 'system', entityId: <key>, userId: gate.user.id, resourceName: 'UI configuration', details: { operation: 'update_version' | 'save_tokens' | 'reset_tokens', version?, tokenKeys?: ['colors.primary', ...] }, severity: 'info', request }).catch(err => requestLogger.error({ err }, 'Audit failed (non-blocking)'))`. Token **names**, not values. No awaited flush: a cosmetic setting is not a WC-7 write (money, access, entitlement, price). See Q-4.
- Logging: `requestLogger.info({ adminId, operation, tokenKeyCount }, ...)` on success, `warn({ invalidKeys })` on a rejected save, `error({ err })` on failures. No token values in logs. `update_version` no longer logs the full DB result.
- Header comment: purpose, the intentional service-role bypass (§1.8), and that write validation mirrors TH-1's read sanitizer.
- Success message for tokens: TH-1's reader caches for 60 s per server instance, so "Refresh V2 pages to see changes" becomes "Saved. Pages pick up the change within about a minute." (page text, §2.3).

### 2.3 Page (`app/admin/ui-config/page.tsx`)

- Replace the 4 `console.error` with `clientLogger.child({ module: 'AdminUiConfigPage' })` from `@/lib/logger/client`, `logger.error({ err }, '...')` (the client-side precedent: `lib/client/auth-actions.ts`).
- In all 4 handlers, read the JSON body before checking `response.ok`, and show `result.error` in the existing `message` banner. No new UI component.
- Optional, small (Q-2): mark the fields named in `invalidKeys` with the existing error colour. Default plan: the banner only.
- The page does **not** strip empty strings before sending. The server owns that rule (§2.1).
- Change the token-save success text as in §2.2.
- No other edits to this 980-line file.

### 2.4 Dead hooks

Delete `lib/hooks/useUIVersion.ts` and `lib/hooks/useTheme.ts`. Update the inventory line in `docs/architecture/BUSINESS_OS_MONOREPO_ARCHITECTURE.md:214` and the G-8 comment in TH-1's `themePrepaint.guard.test.ts` (comment only, it names the deleted file). Leave `SECDEF_LOCKDOWN_SLICE3_WORKPLAN.md` alone (historical record). The TH-2b inventory in the uncommitted scoping doc is updated by TL/main session, not in this branch.

---

## 3. Files to create / modify

| File | Action | Reason |
|---|---|---|
| `lib/validation/admin-ui-config-schema.ts` | create | Write-side Zod schema built from TH-1's allow-list and `validTokenValue` (cannot live in `customTokens.ts`, guard G-12) |
| `lib/validation/__tests__/admin-ui-config-schema.test.ts` | create | Schema unit tests + read/write parity (T-2..T-4) |
| `app/api/admin/ui-config/route.ts` | modify | Zod, repository, Pino, audit, dev-only details, correlation id on GET |
| `app/api/admin/ui-config/__tests__/route.test.ts` | create | Integration test: auth, invalid input, poisoned token, happy paths, failures (T-1) |
| `app/admin/ui-config/page.tsx` | modify | 4 `console.*` → `clientLogger`; show the route's 400 message; success text |
| `app/admin/ui-config/__tests__/source.guard.test.ts` | create | Pino + structure guard (T-5) |
| `lib/hooks/useUIVersion.ts` | delete | Dead (no importer), reads a value nothing consumes, browser DB access (rule 1), 5 `console.*` |
| `lib/hooks/useTheme.ts` | delete | Dead (no importer), second `.dark` writer, 1 `console.log` |
| `lib/design-system-v2/__tests__/themePrepaint.guard.test.ts` | modify (comment only) | G-8 comment names the deleted `useUIVersion.ts` |
| `docs/architecture/BUSINESS_OS_MONOREPO_ARCHITECTURE.md` | modify (1 line + header/history) | Inventory lists the two deleted hooks |
| `app/admin/ui-config/presets.ts` | create (R-5) | The four preset arrays, imported by the page, iterated by T-4 |
| `app/api/admin/system-config/route.ts` | modify (R-1) | `v2_custom_tokens` added to `LOCKED_KEYS` (now a key-to-message map) |
| `app/api/admin/system-config/__tests__/route.test.ts` | modify (R-1) | PUT with `v2_custom_tokens` (3 spellings + mixed body) returns 400, `setMultiple` not called |
| `lib/design-system-v2/customTokens.ts` | modify (comment only, R-7) | Header no longer says the save is unvalidated |
| `app/api/admin/__tests__/adminGate.writes.test.ts` | modify (1 line) | `GET` now takes the request (correlation id), so the gate test passes one |

Not touched: `SystemConfigRepository.ts`, `lib/audit/events.ts`, any migration.

---

## 4. Task list

- ✅ T0: RM creates the branch from `main` after TH-1 merges; Dev confirms `git branch --show-current`, moves this workplan to `docs/workplans/F1_ADMIN_UI_CONFIG_WORKPLAN.md`, re-reads `customTokens.ts` **as merged** (its exports may have moved in review)
- ✅ T1: `lib/validation/admin-ui-config-schema.ts` + its tests (T-2..T-4); run them
- ✅ T2: Rewrite the route (§2.2); remove `createClient`; add header comment
- ✅ T3: Route integration test (T-1); run it
- ✅ T4: Page: `clientLogger`, body-before-`ok` in 4 handlers, success text
- ✅ T5: Source guard (T-5)
- ✅ T6: Delete the two hooks; re-run the importer grep on the branch; update the G-8 comment and the architecture inventory line
- ✅ T7: `npx tsc --noEmit` on touched files, `npm run lint`, `npm test -- app/api/admin/ui-config app/admin/ui-config lib/validation lib/design-system-v2`, and the admin-route CI guard; `git diff --stat` check (no deletion-without-insertion except the two hooks)
- ⬜ T8 (owed, not run by Dev: needs a signed-in admin on `npm run dev`): Manual check on `npm run dev` as an admin: load, save a valid colour, save `red;}` (rejected, banner names the key), clear a field and save (stored without that key), reset, toggle version. Record the result under the QA Testing Report heading for QA to confirm

---

## 5. Tests

| ID | File | Cases |
|---|---|---|
| **T-1** | `app/api/admin/ui-config/__tests__/route.test.ts` (mocks `requireAdmin` via `getUser` + `AdminAccessService` as existing admin route tests do, `systemConfigRepository`, `AuditTrailService`, logger) | **Auth:** GET and POST return 401 signed out and 403 non-admin, and the repository is **never called** (no body read before the gate). **Invalid input:** malformed JSON → 400; unknown `action` → 400; `update_version` with `version: 'v3'` or a number → 400 (today: 500 or stored); `save_tokens` with `tokens` as array / string / null → 400. **Poisoned token:** `colors.primary: 'red;}body{display:none'`, `shadows.card: 'url(javascript:alert(1))'`, an unknown key `colors.evil`, an unknown group `'--v2-bg'`, a `__proto__` key, a non-string value → 400, `set` **not called**, `invalidKeys` lists the names, and the response body contains **none of the rejected values**. **Happy path:** valid tokens → 200, `set('v2_custom_tokens', <trimmed object>, 'ui', …, { actorId: admin.id })`, audit logged with `SYSTEM_CONFIG_CHANGED`, token names and no values; empty-string values removed before saving; `update_version` → `set('ui_version', 'v2', …)`; `reset_tokens` → `delete(key)`; GET returns `{ uiVersion, customTokens }`. **Failures:** repository error → 500 with no `details` when `NODE_ENV=production`; audit `log` rejects → still 200 |
| **T-2** | `lib/validation/__tests__/admin-ui-config-schema.test.ts` | Each group accepts its grammar's examples and rejects `;`, `{`, `}`, `<`, quotes, `\`, newline, 201-char strings, non-strings; unknown keys/groups rejected; trimmed output |
| **T-3** | same | **Read/write parity:** for a corpus of objects (valid, partly invalid, hostile), `schema.success === (sanitizer droppedKeys is empty)` after empty-removal, and on success the parsed output deep-equals `sanitizeV2CustomTokens(input)`. This is the anti-drift pin |
| **T-4** | same | Every preset option in the page and every `v2Tokens` default the editor pre-fills passes the schema (so the page cannot be refused by its own presets). Presets are read from the page source, or SA may prefer moving the 4 arrays to a small exported constant (Q-5) |
| **T-5** | `app/admin/ui-config/__tests__/source.guard.test.ts` (modelled on `app/admin/archiving/__tests__/source.guard.test.ts`) | Route and page contain no `console.`; route does not import `@supabase/supabase-js` or `createClient`; route imports the schema from `@/lib/validation/admin-ui-config-schema` and declares no token regex of its own; each handler's first statement in `try` is `requireAdmin`; `lib/hooks/useUIVersion.ts` and `lib/hooks/useTheme.ts` do not exist |

Coverage meets CLAUDE.md: route integration test covers happy path + auth failure + invalid input.

---

## 6. Business behaviour: what changes, what does not

| Question | Answer |
|---|---|
| Do owners or their clients see anything different? | **No.** Owner pages render through TH-1's sanitizer either way. The two live custom colours are valid hex (TH-1 T-0(g)), so they keep rendering exactly as now |
| Does an admin see anything different? | **Yes, one thing.** Saving an invalid colour or size is **rejected with a message that names the field**, where today it shows "saved", is stored, and is then silently ignored by every page. Clearing a field now saves as "use the default" (it did in effect before, because an empty value was ignored on read). The success text says changes appear within about a minute (true since TH-1's 60 s cache) |
| Does that need a business decision? | **No, in Dev's view.** It is admin-only, it changes no customer-visible result (the invalid value never took effect), and it replaces a false "saved" with a true answer. Stated for TL/user awareness, not as a question |
| Data change? | None. No migration. The existing row is valid and is not rewritten until the next save |
| Money, access, entitlements? | None touched |
| Audit trail | New rows: one `SYSTEM_CONFIG_CHANGED` per admin save/reset/version toggle, with token names only |
| Deleted code | Two hooks that nothing imports. No behaviour removed |
| The V1/V2 toggle | Still works as it does today (writes a value nothing reads). Removal is Q-3 |

---

## 7. Risks

| Risk | Likelihood | Mitigation |
|---|---|---|
| TH-1's `customTokens.ts` exports change during its review/merge | 🟡 | T0 re-reads the merged file; schema imports only `V2_CUSTOM_TOKEN_VARS`, `validTokenValue`, `V2_CUSTOM_TOKENS_CONFIG_KEY`; T-3 fails on drift |
| A stored invalid value blocks an admin's next save (the page re-sends the whole object) | 🟢 | Prod row checked valid in TH-1 T-0(g). The 400 names the key, so the admin can fix or clear it. Q-2 offers a load-time notice |
| `systemConfigRepository.set` is read-then-write, not an atomic upsert: two admins creating the row at the same instant → one gets a unique-key 500 | 🟢 | Only when the row does not exist (after a reset); single-admin setting; retry succeeds. Accepted, noted |
| `set`'s update branch does not rewrite `category`/`description` (the upsert did) | 🟢 | Same constant values; insert branch still writes them |
| Deleting a hook that is imported dynamically or by string | 🟢 | Grep covered all file types on main and the TH-1 worktree; `tsc` + `next build` in CI catch a static import; T6 re-greps on the branch |
| Route test mocks drift from `requireAdmin` internals | 🟢 | Mock the same seams as existing admin route tests |
| Admin-route CI guard | 🟢 | `requireAdmin` stays first; no `AdminAccessService` in the route |

---

## 8. `console.*` counts

| File | On main | After F-1 |
|---|---|---|
| `app/api/admin/ui-config/route.ts` | 8 | 0 (Pino `createLogger` + correlationId, errors as `{ err }`) |
| `app/admin/ui-config/page.tsx` | 4 | 0 (`clientLogger`) |
| `lib/hooks/useUIVersion.ts` | **5** (brief said 3) | file deleted |
| `lib/hooks/useTheme.ts` | 1 | file deleted |
| **Total** | **18** | **0** |

---

## 9. Questions for SA

- **Q-1 (empty values):** remove empty/whitespace values before validation ("use the default"), as proposed, or reject them?
- **Q-2 (already-stored invalid values):** GET today returns the raw stored object. Options: (a) unchanged, the 400 on save names the bad key (default plan); (b) GET returns the raw object plus `ignoredKeys` from `sanitizeV2CustomTokensDetailed`, and the page shows "these saved values are ignored"; (c) GET returns the sanitized object, so the editor shows what pages render and the next save cleans the row. Prod has no invalid value today, so this is about the future.
- **Q-3 (`ui_version`):** nothing reads it. Keep the action and toggle in F-1 (validated + converted, the plan), or remove the toggle and the action in a follow-up?
- **Q-4 (audit flush):** non-blocking `log()` without an awaited flush, since a cosmetic setting is not WC-7. Agree? And reuse `SYSTEM_CONFIG_CHANGED` (no new event), or add an `EVENT_METADATA` entry for it?
- **Q-5 (T-4 presets):** read the 4 preset arrays from the page source in the test, or move them to a small exported constant next to the page (a new file, tiny)?
- **Q-6 (placement):** schema in `lib/validation/admin-ui-config-schema.ts` (forced by G-12 keeping `customTokens.ts` import-free). Agree?

---

## SA Review Notes

**Reviewed by SA — 2026-10-15**
**Status:** APPROVED WITH CHANGES (R-1..R-8 below are conditions; Dev applies them during implementation, no second workplan round needed)

Read against `origin/main` at `8b4db932` (contains `8f3d88ed`) and the TH-1 worktree at `5bb948f4` (read-only).

### Verified, holds

| Check | Result |
|---|---|
| `requireAdmin` first statement in both handlers | ✅ Today and in the plan. T-5 + the admin-authz CI workflow both pin it |
| Repository write | ✅ `systemConfigRepository.set(key, value, category, description, { actorId })` and `delete(key)` exist on main; default client `supabaseServer`. Same pattern as `app/api/admin/system-config/route.ts` (the precedent to copy for header comment, logger, runtime exports) |
| Rule 4 / service-role justification | ✅ Accepted. `system_settings_config` is a global, admin-only table with no `user_id`; keys are module constants, never caller-supplied. The header comment must say so (intentional RLS bypass, admin-gated) |
| No raw error leak | ✅ Plan removes `details: error` (raw Postgres object, every env) and `error.message` echoes; `details` dev-only |
| Schema/sanitizer drift | ✅ Design is right: schema built by iterating `V2_CUSTOM_TOKEN_VARS`, values checked by `validTokenValue`; no grammar copy. T-3 is the pin, but its statement needs fixing (R-3) |
| Prototype pollution | ✅ in principle (`.strict()` over allow-listed shape). Zod 3.25 strict mode enumerates own keys with `for…in`, so a JSON-parsed own `__proto__` is flagged. Test and pre-processing details in R-2/R-4 |
| Dead hooks | ✅ Safe to delete. My own `git grep` on `origin/main` (all non-doc files, incl. `scripts/`, tests): no importer of `useUIVersion`/`getUIVersion`/`setUIVersion`/`lib/hooks/useTheme`; the identifier `useTheme` appears only in its own file (also in the TH-1 worktree). Doc mentions: architecture inventory line 214 (update) and two historical lines in `SECDEF_LOCKDOWN_SLICE3_WORKPLAN.md` (leave). G-8 comment at `themePrepaint.guard.test.ts:148` names `useUIVersion.ts` (update, comment only) |
| Test coverage (CLAUDE.md, modified API route) | ✅ T-1 covers happy path, auth failure (401 + 403, repository untouched) and invalid input |
| `AUDIT_EVENTS.SYSTEM_CONFIG_CHANGED` | ✅ Exists, audience `shared`, unused. `entity_id` already takes non-uuid strings in other routes (`'lead_responses'`, `'analytics'`) |
| G-12 / G-13 interaction | ✅ G-12 only forbids imports **inside** `customTokens.ts`; importing it from `lib/validation/` is allowed. G-13 pins `app/api/design-system/v2-custom-tokens` as the only `app/api/` file matching `readV2CustomTokens` — the admin route must **not** call `readV2CustomTokens*` (it reads through the repository, as planned) |
| Business decision | ✅ None needed. Admin-only; an invalid value never took effect on any page; the change replaces a false "saved" with a true refusal. Record it for user awareness in the diff summary, not as a question |

### Rulings on Q-1..Q-6

- **Q-1 (empty values): DROP.** Empty/whitespace values on **allow-listed** keys are removed before validation ("use the default"); empty groups removed. Conditions in R-2.
- **Q-2 (already-stored invalid values): (c).** GET returns `sanitizeV2CustomTokensDetailed(stored).tokens`, and logs `warn({ droppedKeys })` (names only) when non-empty. The editor then shows exactly what pages render, and the next save cleans the row. No `ignoredKeys` field and no new UI (prod has no invalid value; (b) is UI for a case that does not exist). This also removes the "a stored bad value blocks the next save" risk in §7.
- **Q-3 (`ui_version`): KEEP** in F-1, validated (`z.enum(['v1','v2'])`) and converted. Removing the toggle + action is a separate follow-up, recorded in the requirement, not built here.
- **Q-4 (audit): AGREE.** Non-blocking `log().catch(...)`, no awaited flush (not WC-7 per the `new-api-route` skill). Reuse `SYSTEM_CONFIG_CHANGED`; no `EVENT_METADATA` entry required (optional). Shape fixed in R-6.
- **Q-5 (T-4 presets): EXTRACT**, do not parse source. Note `page.tsx` cannot export arbitrary named constants (Next.js page-export restriction fails the type check), so the arrays move to a sibling `app/admin/ui-config/presets.ts` that the page imports. See R-5.
- **Q-6 (placement): AGREE.** `lib/validation/admin-ui-config-schema.ts` follows the `-schema.ts` convention and is forced by G-12.

### Required changes

1. **R-1 Close the side door.** `PUT /api/admin/system-config` writes any key not in `LOCKED_KEYS` (today only `helpbot_embedding_model`), so an admin can still store `v2_custom_tokens` unvalidated through it, which defeats the "write side validated" claim. Add `V2_CUSTOM_TOKENS_CONFIG_KEY` (`'v2_custom_tokens'`) to `LOCKED_KEYS` in `app/api/admin/system-config/route.ts` with a one-line why-comment, plus one test case in that route's existing tests (PUT with that key is refused, `set` not called). Its only caller (`app/admin/agentspilot-billing/page.tsx`) never writes it. Add both files to §3. — Priority: High
2. **R-2 Empty-removal must not copy by input key.** Pre-processing iterates the allow-list (or builds via `Object.fromEntries(Object.entries(...).filter(...))`), never `out[inputKey] = …` (assignment to `'__proto__'` sets the prototype and the key vanishes before `.strict()` sees it). Only allow-listed keys with a string value that trims to `''` are removed; an unknown key is still rejected even if its value is `''`; non-strings (`null`, numbers) are rejected, not stripped. — High
3. **R-3 Fix T-3's parity statement and the 400 key list.**
   (a) The sanitizer **silently ignores** unknown groups/keys (they are not in `droppedKeys`), while the schema rejects them, so "success iff `droppedKeys` is empty" is false as written. Correct form: after empty-removal, `schema.success === (droppedKeys.length === 0 && no non-allow-listed group or key is present)`, and on success `parsed === sanitizeV2CustomTokens(input)` (deep-equal).
   (b) `invalidTokenKeys` must strip the `['data','tokens']` path prefix and handle `unrecognized_keys` issues (path `[group]` or `[]`, names in `issue.keys`). Unrecognized names are **caller-supplied**, so they must **not** be echoed: `invalidKeys` lists only allow-listed `group.key` names; unknown groups/keys are reported as a fixed phrase ("unknown setting") and logged as a count. This keeps the "no reflection" rule in §2.2 true. — High
4. **R-4 Prototype-pollution test uses a raw JSON string body.** An object literal `{ __proto__: … }` in a test sets the prototype and creates no own key, so it tests nothing. Send `new Request(url, { body: '{"action":"save_tokens","data":{"tokens":{"__proto__":{"x":"1"},"colors":{"constructor":"#fff"}}}}' })`; assert 400, `set` not called, and `({} as any).x === undefined` afterwards. Cover top-level `__proto__`, group-level `__proto__`/`constructor`, and `prototype`. — High
5. **R-5 T-4 via extracted presets.** Create `app/admin/ui-config/presets.ts` exporting the four arrays (unchanged values); the page imports them. T-4 iterates them **excluding the `'custom'` sentinel** (never stored; `handleSelectChange` only sets a flag), plus every `v2Tokens` default the editor pre-fills (the `|| v2Tokens…` fallbacks in the token list). T-5 checks the page no longer declares those arrays inline. Add the file to §3. — Medium
6. **R-6 Audit shape.** `entityType: 'settings'`, `entityId: <config key>`, `userId` and `actorId` = admin id, `resourceName: 'UI configuration'`, `details: { operation, version? | tokenKeys? }` (names only, no values), `severity: 'info'`, `request`; `.catch(err => requestLogger.error({ err }, 'Audit failed (non-blocking)'))`. GET writes no audit. T-1 asserts no token value appears in the audit call. — Medium
7. **R-7 Stale comment in `customTokens.ts`.** Its header says "the save route stores the object as-is, without validation", which F-1 makes false. Update that sentence (comment-only; G-12 tests imports, not comments) to say the write is validated by `lib/validation/admin-ui-config-schema.ts` and this module remains the security boundary for the read. Amend §3's "Not touched" line. — Medium
8. **R-8 GET per Q-2 (c).** GET: `getByKeys([...])` → repository error is 500 (no `details` in prod); `customTokens = sanitizeV2CustomTokensDetailed(raw).tokens`; `uiVersion` defaults to `'v1'` when missing or not in the enum (same as today's fallback). T-1 adds: stored invalid value → GET omits it and logs `droppedKeys` names, no values. — Medium

### Optimisation suggestions (non-blocking)

- Copy the `system-config` route's `export const runtime = 'nodejs'` / `export const dynamic = 'force-dynamic'` and its header-comment layout.
- Dedupe `invalidKeys` and cap the message at a sensible number of names.
- `update_version` success text can use the validated enum value directly; no `.toUpperCase()` on unknown input remains.
- §7 "set is read-then-write" risk: accepted as stated.

### Sequencing

Agreed: branch from `main` after #422 merges; T0 must re-read the merged `customTokens.ts` and the merged guard file (G-8 line numbers and G-12/G-13 wording may move in the conflict resolution happening now). Do not touch the `neuronforge-th1` worktree.

### Approval
[x] Workplan approved with conditions R-1..R-8 — proceed to implementation after #422 merges. SA code review will check each R-item explicitly.

---

**Code Review by SA — 2026-10-16**
**Status:** APPROVED (Code Approved for QA). No required code changes. One condition outside the code: the T8 browser check below runs before RM commits.

Reviewed: `git diff` of the worktree against `80a142ca` plus the five new files. Re-ran `npx jest app/admin/ui-config app/api/admin/ui-config app/api/admin/system-config lib/validation/__tests__/admin-ui-config-schema.test.ts lib/design-system-v2 app/api/admin/__tests__/adminGate.writes.test.ts --ci`: 15 suites, 1209 tests pass. `npx tsc --noEmit` (full project): no error in any touched file.

### R-items

| Item | Verdict | Evidence |
|---|---|---|
| R-1 side door | ✅ | `LOCKED_KEYS` holds `V2_CUSTOM_TOKENS_CONFIG_KEY`, matched on `canonicalKey` (NFKC, invisible chars, case), so `V2_CUSTOM_TOKENS` and the zero-width variant are refused. The refusal text is a constant (never the caller's spelling). 4 tests, `setMultiple` untouched. I grepped every other `system_settings_config` writer (`onboarding-`, `memory-`, `orchestration-`, `agent-generation-config`): all write module-constant keys, so no other route can store `v2_custom_tokens` |
| R-2 empty removal | ✅ | `stripEmptyTokenValues` copies only through `Object.entries` / `Object.fromEntries`. Membership is checked with `hasOwnProperty`, not `in` (a good catch: with `in`, `constructor` would count as allow-listed). Unknown keys with `''`, `null` and numbers are kept, so the schema rejects them |
| R-3 (a) parity | ✅ | The oracle is stated as I ruled. On success the output deep-equals `sanitizeV2CustomTokens`. The corpus covers both outcomes |
| R-3 (b) no reflection | ✅ | `unrecognized_keys` are counted, never named. A name is returned only if it is in the allow-list, which a forged-issue test pins. The `['data','tokens']` prefix is stripped. The token issue message is a constant `'Invalid token value'` |
| R-4 prototype pollution | ✅ | Raw JSON bodies at body, `data`, tokens and group level, covering `__proto__`, `constructor` and `prototype`. Each case also checks the response text and that `Object.prototype` is clean. In Zod 3, objects are built only from shape keys and `strict` enumerates own keys with `for…in`, so an own `__proto__` key is flagged |
| R-5 presets | ✅ | `presets.ts` values are unchanged. `CUSTOM_OPTION` is excluded. T-4 also asserts that each group and key on the page is in the allow-list, so a page field the save would refuse as unknown fails the test |
| R-6 audit | ✅ | Shape matches the ruling. `.catch` is in place and not awaited. Details carry names only, which a test asserts. GET does not audit. `entityType: 'settings'` has precedent (`preferences`, `notification-preferences`, `CurrencyService`) |
| R-7 comment | ✅ | Comment-only. Change history is not needed for a code comment |
| R-8 GET | ✅ | A `getByKeys` error returns 500 with dev-only details. Tokens are sanitized and `droppedKeys` is logged with names only. `uiVersion` falls back to `'v1'`. The response shape `{ success, data: { uiVersion, customTokens } }` is unchanged from main, and the page is its only caller |

### Brief checks

| Check | Result |
|---|---|
| `requireAdmin` first, no body read before it | ✅ In both handlers the preamble is only the correlation id and the child logger (T-5 pins the exact lines). The route test spies on `json/text/clone/arrayBuffer/formData/blob` and checks `bodyUsed` on a 401. `AuditTrailService.extractRequestContext` reads only headers, cookies and `ip`, never the body |
| Repository only, rule-4 justification | ✅ No `createClient`, `supabaseServer` or `.from(` in the route (T-5, plus a throwing `supabaseServer` mock in T-1). The header documents the intentional service-role bypass |
| No raw errors in production | ✅ `devDetails` and `flatten()` are behind `NODE_ENV === 'development'`. The raw Postgres `details: error` is gone. Tested for GET, write and invalid input |
| Schema cannot drift | ✅ Built by iterating `V2_CUSTOM_TOKEN_VARS`, and values go through `validTokenValue`. T-5 forbids a regex literal or `RegExp` in the route. T-3 pins parity |
| 400 never reflects input | ✅ The poison test checks that the response text contains no value, no unknown key name and no unknown group name. The dev-only `flatten()` can name keys, but it is never sent in production and never sent on a token failure |
| Logging | ✅ No `console.*` left in the route, the page, the presets, the schema or `system-config/route.ts` (grep found only the guard's own prose). The page uses `clientLogger.child({ module: 'AdminUiConfigPage' })`, and errors are logged as `{ err }` |
| Dead hooks | ✅ My own grep on the branch (`.ts/.tsx/.js/.mjs/.json`, excluding `node_modules`) found no importer of `useUIVersion`, `getUIVersion`, `setUIVersion`, `hooks/useTheme` or `hooks/useUIVersion`. The only hits are the T-5 "stays deleted" test and the G-8 comment |
| Coverage (CLAUDE.md) | ✅ Happy path (3 actions plus GET), auth failure (401/403 with no data touched), invalid input (malformed, enum, type, poisoned, pollution), and failure paths (write/read 500, audit rejection) |

### Rulings on the Dev decisions (IN-1..IN-6)

1. **`LOCKED_KEYS` as a key→message map: ACCEPT.** This is the smallest way to give each locked key its own message. The existing helpbot text and its tests are unchanged.
2. **IN-1, separate 400 for a missing or mistyped `tokens`: ACCEPT.** It has the same status and reflects nothing, and the page gets a more useful banner. A `data` that is not an object still gets the generic `'Invalid input'`, which is correct.
3. **T-4 defaults found by scanning `page.tsx` with the count pinned at 28: ACCEPT.** Without the pin, a regex that stopped matching would silently pass zero cases. Adding a field means updating one number, which is intended friction.
4. **IN-2, one-method structural logger type: ACCEPT.** It follows the `AdminGateLogger` precedent and needs no `any`.
5. **IN-3, `GET(request)` plus the one-line fix in `adminGate.writes.test.ts`: ACCEPT.** The route needs the request to propagate `x-correlation-id` (CLAUDE.md rule 3). The gate test change only passes the request.
6. **IN-5, architecture doc edit: ACCEPT.** It updates one row, the header date and a Change History row, as the docs standard requires.

### Code Review Comments
None blocking.

### Optimisation Suggestions (non-blocking, do not hold the cycle)
- `app/api/admin/ui-config/route.ts` `devDetails`: a repository error that is a plain PostgREST object (not an `Error`) shows as `"[object Object]"` in development. `JSON.stringify` or `error.message ?? String(error)` would read better. Low.
- `lib/validation/admin-ui-config-schema.ts` `invalidTokensMessage`: the hint gives a colour example and a size example but no shadow example (`0 2px 4px rgba(0,0,0,0.1)`). Low.
- `page.tsx` has 5 pre-existing eslint warnings, left alone as the plan says. Low.

### T8 manual check: ruling
**Required before RM commits.** No Jest test exercises the page in a browser. Its 4 handlers were rewritten (body read before `ok`), and its preset arrays moved to another module. A wrong import or a handler regression would show only on screen. The route itself is fully covered, so the check can be small: about 2 minutes on `npm run dev`, signed in as an admin, at `/admin/ui-config`:
1. Load the page: current tokens show, with no error banner.
2. Edit mode: change one colour to a valid hex and pick one radius preset, then Save. The success banner reads "Saved. Pages pick up the change within about a minute." The values persist after a reload.
3. Type `red;}` into a colour text field and Save. The error banner names `colors.<field>`. After a reload, the previous valid value is still shown.
4. Reset to defaults. The success banner shows, and the page shows defaults after a reload.

The version toggle and cleared-field saves are optional: T-1 and T-2 cover them, and nothing reads `ui_version`. Record the result under the QA Testing Report heading. If no admin session is available to QA, the user runs it at the diff-review step, before RM.

### Code Approved for QA: Yes

---

## Implementation Notes

**Dev, 2026-10-16.** Built on `fix/f1-admin-ui-config-hardening` from `origin/main` `80a142ca` (TH-1 #422 merged). Uncommitted.

### T0 re-read of the merged TH-1 files

`customTokens.ts` exports are unchanged from the workplan: `V2_CUSTOM_TOKENS_CONFIG_KEY`, `V2_CUSTOM_TOKEN_VARS`, `validTokenValue`, `sanitizeV2CustomTokens(Detailed)`. The G-8 comment is at `themePrepaint.guard.test.ts:148`. G-12 forbids imports *inside* `customTokens.ts` only. G-13 pins `app/api/design-system/v2-custom-tokens` as the only `app/api/` file naming `readV2CustomTokens`; the admin route reads through the repository and never names it (T-5 asserts this too).

### How each SA item was applied

| Item | Where | Notes |
|---|---|---|
| R-1 | `app/api/admin/system-config/route.ts` | `LOCKED_KEYS` became a `ReadonlyMap<key, message>` so each locked key has its own refusal text (the helpbot text is unchanged and its tests still pass). The `v2_custom_tokens` message points to `/admin/ui-config`. Matched on the canonical form, so upper-case and zero-width variants are refused too. 4 new test cases |
| R-2 | `stripEmptyTokenValues` in the schema | `Object.fromEntries(Object.entries(...))`, never `out[inputKey] =`. Allow-list membership uses `hasOwnProperty`; with `in`, `constructor` would count as allow-listed (probe R2b). Only allow-listed keys with a string trimming to `''` are removed; unknown keys with `''`, `null` and numbers stay for the schema to reject |
| R-3 (a) | T-3 | Oracle: after empty-removal, `success === (input is an object && droppedKeys.length === 0 && only allow-listed groups/keys present)`; on success the output deep-equals `sanitizeV2CustomTokens(stripped)`. 23-entry corpus including JSON-parsed `__proto__`/`constructor`; a test asserts the corpus covers both outcomes |
| R-3 (b) | `invalidTokenKeys` | Strips the `['data','tokens']` prefix. `unrecognized_keys` issues are counted, never named. A name is returned only if it is an allow-listed `group` or `group.key`, including for a forged issue Zod would not raise today. Message: up to 10 names plus "and N more", then "The request contains an unknown setting." The route logs `invalidKeys` and `unknownKeyCount` |
| R-4 | route test + schema test | Raw JSON strings: top-level `__proto__`/`constructor`/`prototype`; group-level `__proto__` (object and `''`), `constructor` (value and `''`), `prototype`; beside a valid key; body- and `data`-level `__proto__`. Each returns 400, `set` is not called, the response does not contain the key names, and `({}).x` / `({}).polluted` are undefined afterwards |
| R-5 | `app/admin/ui-config/presets.ts` | Values unchanged. `'custom'` exported as `CUSTOM_OPTION` and skipped by T-4. The `v2Tokens` defaults are found by scanning the page for the `customTokens.<group>?.<key> || v2Tokens.<path>` fallbacks (28 fields, count pinned) and resolving each path, so a new field is covered automatically |
| R-6 | route `audit()` | `entityType 'settings'`, `entityId` = config key, `userId` = `actorId` = admin, `resourceName 'UI configuration'`, `details { operation, version? or tokenKeys? }`, `severity 'info'`, `request`; `.catch` logs `Audit failed (non-blocking)`. GET writes none. The test asserts no token value in the audit payload |
| R-7 | `customTokens.ts` header | Comment only |
| R-8 | route GET | `getByKeys` error returns 500 (`details` dev-only). `customTokens = sanitizeV2CustomTokensDetailed(raw).tokens`; `warn({ droppedKeys })`, names only. `uiVersion` falls back to `'v1'` when missing or not `v1`/`v2` |
| Q-3 | route | `update_version` kept, `z.enum(['v1','v2'])` |
| Optional | route | `runtime = 'nodejs'`, `dynamic = 'force-dynamic'`, header layout copied from `system-config` |

### Deviations and decisions

- **IN-1 Missing or non-object `tokens`** (`data: {}`, `tokens: null/[]/'x'`) returns the token-style 400 with `error: 'The custom tokens are not in the expected format.'` and `invalidKeys: []`, not the generic `'Invalid input'`. Same status, no reflection, more useful text on the page.
- **IN-2 Logger type in helpers.** `ReturnType<typeof logger.child>` does not type-check against Pino's generics, so the two helpers take a one-method structural type (same approach as `AdminGateLogger`).
- **IN-3 Gate test touched.** `app/api/admin/__tests__/adminGate.writes.test.ts:359` called `uiConfig.GET()` with no request; it now passes `req('/api/admin/ui-config', 'GET')`. All 328 cases pass.
- **IN-4 Page.** The body is read with `response.json().catch(() => null)` before checking `ok`, so a 400 banner shows the route's text. 5 pre-existing eslint warnings (unused `Badge`/`Sun`/`options`, unescaped quotes) left alone, as the plan says no other edits.
- **IN-5 Architecture doc.** The `lib/hooks/` row now says no `'use client'` module is left there (the two deleted hooks were the only ones). Doc header date and a Change History row added, per the docs standard.
- **IN-6 Hooks.** Re-grepped on the branch: no importer of `useUIVersion`/`getUIVersion`/`setUIVersion`/`lib/hooks/useTheme` outside docs. Historical mentions in `PERF_TH1_THEME_PREPAINT_WORKPLAN.md` and `SECDEF_LOCKDOWN_SLICE3_WORKPLAN.md` are left as records.

### `console.*` after F-1

Route 8 to 0 (Pino + correlationId on both handlers). Page 4 to 0 (`clientLogger.child({ module: 'AdminUiConfigPage' })`). Hooks 5 + 1, deleted. T-5 pins route, page and presets.

### Verification (Dev, 2026-10-16)

| Check | Result |
|---|---|
| `npx jest app/admin/ui-config app/api/admin/ui-config app/api/admin/system-config app/api/admin/__tests__/adminGate.writes.test.ts lib/validation lib/design-system-v2 --ci` | 21 suites, 1332 tests, all pass |
| New: route T-1 / schema T-2..T-4 / source guard T-5 | 37 / 102 / 11 tests |
| `npm run test:bos-entitlements` | 277 suites, 8231 tests pass |
| `npm run test:authz-guard` | 203 pass |
| `npm run lint:hooks` | exit 0 |
| `tsc` scoped to the touched files (temporary tsconfig, deleted) | 0 errors in touched files. Pre-existing errors elsewhere in the import graph (`lib/audit/admin-helpers.ts`, `lib/memory/*`, `lib/pdf/*`, ...) are unrelated and unchanged |
| `eslint` on touched files | 0 errors; 5 pre-existing warnings in `page.tsx` |
| `next build` | Not run: no rendering change beyond the page's handlers and imports |

### Mutation probes (each restored after the run)

| Probe | Mutation | Result |
|---|---|---|
| R1 lock | `v2_custom_tokens` removed from `LOCKED_KEYS` | Caught (4) |
| R2a proto-unsafe copy | top-level copy via `out[g] = v` before the walk | Caught (4) |
| R2b `in` for membership | `key in V2_CUSTOM_TOKEN_VARS[group]` | Caught (4) |
| R2c strip non-strings | `null` stripped as empty | Caught (6) |
| R2d strip unknown empties | allow-list check dropped from empty removal | Caught (5) |
| R3a echo unknown names | `issue.keys` added to `invalidKeys` | Caught (13) |
| R3b name any key | allow-list check dropped for `group.key` | Survived first run (unreachable via Zod); forged-ZodError test added, then Caught (1) |
| R3c prefix kept | `['data','tokens']` not stripped | Caught (11) |
| R3d value in issue | rejected value put in the Zod issue message | Survived first run (the route never returns issue text); schema test added, then Caught (1) |
| Gate: body before gate | `request.clone().json()` above `try` | **Survived first run**; the route test now spies `json/text/clone/arrayBuffer/formData/blob` and checks `bodyUsed`, and T-5 pins the exact preamble; then Caught (2) |
| Gate: POST order swapped | body read before `requireAdmin` | Caught (2) |
| Gate: GET read before gate | `getByKeys` above `requireAdmin` | Caught (3) |
| Gate: POST / GET gate removed | | Caught (6) / (3) |
| Group / top not strict | `.strict()` removed / `.passthrough()` | Caught (18) / (14) |
| Audit carries values | `tokens` added to `details` | Caught (1) |
| Audit not caught | `.catch` removed | Caught (1) |
| GET returns raw | stored object returned instead of sanitized | Caught (1) |
| Details in production | dev guard removed | Caught (2) |
| Page `console.error` back | one handler | Caught (1) |

### Owed

- T8 manual check on `npm run dev` as an admin (load, valid save, `red;}` rejected with the key named, cleared field saved without the key, reset, version toggle). Not run by Dev.
- Follow-up already ruled (Q-3): remove the `ui_version` toggle and action. Not built here.

---

## QA Testing Report

**QA — 2026-10-16**
**Test mode:** full
**Strategy used:** A + B (Jest unit tests for the schema; Jest integration tests for the route with the repository, gate and audit mocked) plus 5 independent mutation probes. D (manual browser check) is scoped below as T8. It has not been run.
**Focus:** api, schema, security
**Skipped:** the T8 browser check, which needs a signed-in platform admin on a local server. That server writes to the production `system_settings_config` row, so the user runs it with the checklist below. `next build` was not run: no rendering change beyond the page's handlers and imports, and CI runs it.
**Input source:** TL prompt (QA judgment for the details)

### Test runs (QA re-ran them in the `neuronforge-f1` worktree)

| Command | Result |
|---|---|
| `npx jest app/admin/ui-config app/api/admin/ui-config app/api/admin/system-config app/api/admin/__tests__/adminGate.writes.test.ts lib/validation lib/design-system-v2 --ci` | **21 suites, 1332 tests, all pass** (matches Dev) |
| `npm run test:authz-guard` | **2 suites, 203 tests, pass** (one "worker failed to exit gracefully" notice; it does not fail the run and was already there) |
| `npm run test:bos-entitlements` | Not re-run: the diff imports nothing from `lib/business-os/entitlements/`, so the skill trigger does not apply. Dev's green run is on record |

### Mutation probes (run by QA)

Each probe was applied by a script and type-checks. ts-jest diagnostics are on, so a compile error would have shown up as a fake catch, and none appeared. The probe ran against the 4 directly affected suites (184 tests). Afterwards all three target files were copied back from a backup, and `sha256sum -c` confirmed each was byte-identical (CRLF kept). `git status` afterwards matched the starting state.

| Probe | Mutation | Result | Tests that caught it |
|---|---|---|---|
| (a) | `v2_custom_tokens` entry removed from `LOCKED_KEYS` (system-config route) | **Caught (4)** | system-config PUT: exact key, upper-case, zero-width prefix, mixed body |
| (b) | `stripEmptyTokenValues` rebuilt with `out[k] = v` over the input keys | **Caught (6)** | T-2 prototype safety (3), T-3 parity "proto top", route R-4 group-level `__proto__` (2) |
| (c) | Unknown key names (`issue.keys`) added to `invalidKeys`, so they echo in the 400 | **Caught (13)** | route poisoned-token + log tests, 9 route R-4 raw-JSON cases, T-3b (2) |
| (d) | POST: `request.json()` moved above `requireAdmin` | **Caught (2)** | T-5 source guard (POST preamble), route "does not read the body before the gate, by any method" |
| (e) | `tokens` (the values) spread into the audit `details` | **Caught (1)** | route "save_tokens stores the trimmed object without empty values, audited by name" |

Probes (d) and (e) are each caught by only 1 or 2 tests, but each test asserts the exact property, so this is enough.

### Test Coverage

Legend: **V** = verified by an automated test (and, where noted, a probe). **L** = verified only at logic level, against mocks (no real DB or browser). **M** = needs the manual T8 check.

| Acceptance item (workplan §2, §5, R-1..R-8) | Tested? | Result | Evidence |
|---|---|---|---|
| `requireAdmin` is the first statement in GET and POST; nothing reads the body or the DB before it | ✅ V | Pass | T-1 401/403 cases with the repository never called; body-method spies + `bodyUsed`; T-5 preamble guard; authz guard 203 green; probe (d) |
| Zod validation before business logic (malformed JSON, unknown action, bad `version`, non-object `tokens`) → 400 | ✅ V | Pass | T-1 invalid-input cases |
| Poisoned values (`red;}…`, `url(javascript:…)`, non-strings, unknown keys or groups) → 400, nothing written, rejected values never echoed | ✅ V | Pass | T-1 poisoned-token cases; T-2 grammar; probe (c) |
| Prototype pollution (`__proto__`/`constructor`/`prototype`, top and group level, raw JSON) refused, no global pollution (R-2, R-4) | ✅ V | Pass | T-1 R-4 cases, T-2 prototype safety; probe (b) |
| One grammar: the write schema equals the read sanitizer (R-3a) | ✅ V | Pass | T-3 parity over a 23-entry corpus |
| 400 lists only allow-listed names; unknown names are counted, never named (R-3b) | ✅ V | Pass | T-3b; probe (c) |
| Empty values are removed as "use the default"; unknown empties and non-strings are still rejected (Q-1, R-2) | ✅ V / L | Pass | T-2; T-1 happy path stores the trimmed object without empties. Real DB row: Variant B only |
| Writes go through `systemConfigRepository.set/delete` with `actorId`; no `createClient` in the route | ✅ V / L | Pass | T-1 asserts the `set`/`delete` args; T-5 import guard. The real repository against prod: **M** (T8 A4/A5) |
| `v2_custom_tokens` locked in `PUT /api/admin/system-config` (R-1) | ✅ V | Pass | 4 new tests; probe (a) |
| Audit: `SYSTEM_CONFIG_CHANGED`, `entityType 'settings'`, names only, non-blocking; GET writes none (R-6) | ✅ V | Pass | T-1 audit args, rejected `log()` still returns 200; probe (e) |
| Error responses: no `details` outside development; raw Postgres error never returned (Security Rules) | ✅ V | Pass | T-1 `NODE_ENV=production` cases |
| GET returns sanitized tokens and logs dropped names only; `uiVersion` falls back to `v1` (R-8) | ✅ V | Pass | T-1 stored-invalid case |
| Presets and editor defaults all pass the schema (R-5, T-4) | ✅ V | Pass | T-4 over `presets.ts` + 28 scanned fallbacks (count pinned) |
| `console.*` 18 → 0; route uses Pino + correlationId; page uses `clientLogger` | ✅ V | Pass | T-5 |
| Dead hooks deleted, no importer left | ✅ V | Pass | T-5 file-absence check; the jest/ts graph compiles |
| Page reads the body before `ok` and shows the route's 400 text in the banner | ⚠️ L | Pass (code read) | Diff read in all 4 handlers. The rendered banner needs **M** (T8 A2) |
| Page loads; presets moved to `presets.ts` still populate the dropdowns; the success banner has the new wording | ⚠️ M | Not run | T8 A1, A3, A4 |
| Version toggle still works end to end | ⚠️ M | Not run | T8 A5 (optional per SA) |
| Valid different value persists; reset shows defaults | ⚠️ L | Pass (logic) | T-1 `set`/`delete` args. In a browser: Variant B only |

### Issues Found

#### Bugs (must fix before commit)
None.

#### Performance Issues (should fix)
None.

#### Edge Cases (nice to fix)
1. **Probe (e) has a single catching test.** It is a precise assertion, so this is acceptable. A second assertion on the `reset_tokens`/`update_version` audit shape would make it sturdier. Low, optional.
2. **The test-owner account is probably not a platform admin.** T8 must run as the user's normal admin account (an `admin_users` row). Otherwise every call returns 403, and that would look like a failure.

### T8: manual check (owed; SA requires it before RM commits)

**Setup:** `npm run dev` in the `neuronforge-f1` worktree. Sign in at `http://localhost:3000` as **your normal account, which is a platform admin** (in `admin_users`), not the test-owner account. Open DevTools.

> ⚠️ **The local server writes to the PRODUCTION `system_settings_config` row.** A saved token changes the brand colours on every live owner page within about a minute (TH-1's 60 s cache). A reset removes all custom colours until you restore them. Every write also adds a `SYSTEM_CONFIG_CHANGED` audit row (expected, harmless).

**QA recommends Variant A ("no visible change").** It covers what SA's ruling says only a browser can catch: the 4 rewritten handlers, the 400 banner, and the presets moved to `presets.ts`. It also exercises the real write path against prod, by re-saving the current values unchanged and with a version round trip that nothing reads, so live pages are never affected. SA's steps 2 and 4 (save a *different* colour, reset) would visibly change live brand colours. Their server side is covered by T-1. Variant B runs them, with a mandatory restore, if you want them seen in a browser.

**Step 0, both variants: record the current values (read-only).** In the DevTools console on `/admin/ui-config`:
```js
copy(JSON.stringify((await (await fetch('/api/admin/ui-config')).json()).data))
```
Paste the result somewhere safe (it is `{ uiVersion, customTokens }`). Expected: `success: true`, valid hex colours, no 500.

#### Variant A (recommended): read-only, rejection, no-op writes

| # | Step | Expected |
|---|---|---|
| A1 | Load `/admin/ui-config` | The page renders; the editor shows the stored colours; no error banner; no `console.error` from the page |
| A2 | Click **Edit Tokens**, type `red;}` in the **primary** colour field, click **Save Changes** | A red banner: "These values are not valid: colors.primary. Use a colour such as #6366F1…". The Network tab shows a 400 with `invalidKeys: ["colors.primary"]`, and the response does **not** contain `red;}` |
| A3 | Reload (discards the edit). Click **Edit Tokens** and open a radius, shadow, spacing and font-size dropdown. Do not save. Reload again | Each dropdown lists its presets plus "custom" (proves `presets.ts` is wired). After the reload, the Step 0 fetch is identical to Step 0 (A2 wrote nothing) |
| A4 | Click **Edit Tokens**, change nothing, click **Save Changes** | A green banner: "Saved. Pages pick up the change within about a minute." This re-saves the GET values unchanged, so live pages do not change |
| A5 (optional) | Flip the V1/V2 toggle, then flip it back to its Step 0 value | A success banner each time. `ui_version` has no reader (§1.2), so nothing live changes |
| A6 | Final check: re-run the Step 0 fetch | `customTokens` and `uiVersion` are identical to Step 0 |

#### Variant B (SA's full form): adds a different value and a reset; live colours change for a few minutes

Run Variant A first, then:

| # | Step | Expected |
|---|---|---|
| B1 | Change one colour to another valid hex, pick one radius preset, then save. Reload | A green banner; after the reload both values persist |
| B2 (optional) | Clear one field (empty), then save | Saved; the fetch shows that key **absent** (not `""`) |
| B3 | **Reset**, then confirm. Reload | "Tokens reset to defaults successfully"; the page shows defaults; the fetch shows `customTokens: {}` |
| **Restore (mandatory, do it immediately)** | In the console, set `T` to the Step 0 `customTokens` object, then run: `await (await fetch('/api/admin/ui-config',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'save_tokens',data:{tokens:T}})})).json()` | `success: true`. Re-fetch: `customTokens` deep-equals Step 0. Live pages are back within about a minute |

Restore notes: if Step 0 returned `customTokens: {}` (no row), restore with `{action:'reset_tokens'}` instead, which deletes the row. GET returns sanitized tokens, so a stored value that pages already ignore is not restored. It had no effect on any page, and TH-1 T-0(g) found none in prod. If you used the toggle, put `uiVersion` back to its Step 0 value.

**Record:** each step's result, the date, and the account used, as rows under this heading.

### Final Status
- [x] All automated acceptance criteria pass: 21 suites / 1332 tests, authz guard 203, 5/5 QA mutation probes caught, all files restored by hash
- [ ] T8 manual check (Variant A recommended) is owed by the user before RM commits (SA condition). No bug is open

**QA verdict: PASS (automated). Ready for the user's diff review. T8 Variant A is owed before commit.**

---

## Commit Info

_RM to populate._

---

## Change History

| Date | Change | Details |
|---|---|---|
| 2026-10-15 | Workplan drafted | Dev, workplan only, against TH-1 worktree; awaiting SA review |
| 2026-10-15 | SA workplan review | APPROVED WITH CHANGES R-1..R-8; Q-1 drop empties, Q-2 (c) sanitized GET, Q-3 keep toggle, Q-4 non-blocking audit, Q-5 extract presets, Q-6 agree |
| 2026-10-16 | Implemented (uncommitted) | Dev. R-1..R-8 applied; §3 amended (presets, system-config route + test, `customTokens.ts` comment, gate test). Schema, route rewrite, page logging, two dead hooks deleted. All affected suites green; 21 mutation probes, 3 survivors on the first run closed with new tests (IN notes). T8 manual check owed |
| 2026-10-16 | QA | PASS (automated): 21 suites / 1332 tests, authz guard 203, 5/5 mutation probes caught and restored by hash. T8 manual check owed before commit (SA condition); QA recommends Variant A (no visible change on prod); Variant B = SA full form + mandatory restore |
| 2026-10-16 | SA code review | APPROVED, Code Approved for QA. R-1..R-8 verified; IN-1..IN-6 accepted; 3 non-blocking suggestions. T8 is required before commit, in a minimal 4-step form |
