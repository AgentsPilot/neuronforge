# Workplan: Admin Exchange Rates, Slice 1a (Safe manual page)

> **Last Updated**: 2026-10-19

**Developer:** Dev
**Requirement:** [ADMIN_EXCHANGE_RATES_REQUIREMENT.md](/docs/requirements/ADMIN_EXCHANGE_RATES_REQUIREMENT.md) §5.1, §6 (FR-1 to FR-10, FR-13), §8 slice 1a, §13 (SA review, CLEARED-WITH-CHANGES)
**Branch:** `feature/admin-exchange-rates-1a` (worktree `neuronforge-fx-rates`, from `origin/main` `4583d21e`)
**Date:** 2026-10-19
**Status:** Code Complete 2026-10-19 (uncommitted; awaiting SA code review). Workplan SA APPROVED-WITH-CHANGES (§10)

## Overview

Slice 1a turns `/admin/exchange-rates` from a redundant, read-only page that reads two tables straight from the browser into a safe, manual, admin-only tool: an admin edits a rate or switches a currency on or off through a new server route (`requireAdmin`, Zod, repository, Pino, flushed audit), and sees which rates are stale (older than 35 days) through a KPI tile and a per-row text chip. No money is converted anywhere (D-5). No migration (that is slice 1b), no Finance tab (slice 2), no CLAUDE.md edit (SQ-6). Entitlements, LLM calls and queues are untouched (SA-R16).

---

## Table of Contents

1. [Approved scope (verbatim)](#1-approved-scope-verbatim)
2. [As-built baseline on this branch](#2-as-built-baseline-on-this-branch)
3. [Step 0: live schema verification (blocking)](#3-step-0-live-schema-verification-blocking)
4. [Analysis summary](#4-analysis-summary)
5. [Implementation approach](#5-implementation-approach)
6. [Files to create / modify](#6-files-to-create--modify)
7. [Task list](#7-task-list)
8. [Tests and commands](#8-tests-and-commands)
9. [Risks and items for SA](#9-risks-and-items-for-sa)
10. [SA Review Notes](#10-sa-review-notes)
11. [QA Testing Report](#11-qa-testing-report)
12. [Commit Info](#12-commit-info)
13. [Change History](#change-history)

---

## 1. Approved scope (verbatim)

Copied line for line from the requirement on this branch, so the build cannot drift from what SA approved. Where §9 below raises a point against a ruling, the ruling stands until SA answers.

### 1.1 Progress row (requirement §1)

> | # | Slice | Status | PR | Notes |
> |---|---|---|---|---|
> | 1a | Safe manual page: server route + repository + page rewired + logging | ⬜ Not started | — | Full cycle (new route, data write, security). Works against today's database policies, so it ships first |

### 1.2 Slice 1a scope (requirement §5.1)

> ### 5.1 Slice 1a — Safe manual page (code)
>
> Ships first. It works against today's database policies because all writes move to the server.
>
> | Part | What |
> |---|---|
> | Repository | `ExchangeRatesRepository` in `lib/repositories/` (use the `new-repository` skill): list all rates, get one by currency code, update a rate, set enabled. Returns `RepositoryResult`. Global, not per-user data, so no `user_id` filter: the repository is used only from the admin route with the service-role client, and the reason is documented in code (CLAUDE.md rule 4 bypass) |
> | Route(s) | Under `app/api/admin/exchange-rates/` (use the `new-api-route` skill): `requireAdmin` as the **first statement**; Zod on every input; Pino with `correlationId`; error format per CLAUDE.md. Read all rows; update one rate; set enabled on one row |
> | Audit | One non-blocking audit entry per change, recording currency code, old rate → new rate (or old → new enabled), and the admin's user id |
> | Page | `app/admin/exchange-rates/page.tsx` today is read-only and reads both tables from the browser (§2.2). Slice 1a **adds** rate edit and enable toggle back, through the route, and moves **both reads** (rates and the newest 50 history rows) to the route's `GET` (SA-R4), so the page holds no Supabase client. The `REDUNDANT (BD-34)` and FF-1a header comments are removed (BD-55 amends BD-34 / BD-36 for this page). Follows the admin layout standard (closed, L-* / LF-*): `AdminPageHeader`, Refresh-only bar with "Read at", shared loading / error / empty states, the standard table constants, `StatusChip` for the stale and enabled states, `formatUtc` for dates (SA-R11) |
> | Guards | `redundantPages.source.guard`: Exchange rates leaves G-1, G-3, G-5 and G-6 (the Platform dashboard keeps them). G-6, which bans `fetch(` in the page, is **replaced** by an Exchange rates page guard: no `@/lib/supabaseClient` import, no `.from(`, no `CurrencyService`, no outside host, and the only `fetch(` targets are `/api/admin/exchange-rates`, each rule with a planted control. G-2, G-4 (no in-app link) and the sidebar `UNLISTED` entry **stay** (D-6: URL only). Per SA-R3 |
> | Dead code | Nothing to remove in the page: FF-1a already removed its outside fetch, rate edit and toggle. `CurrencyService.updateRate` and `updateRatesFromApi` stay, unwired, with a header note that they must not be wired again (D-1, SQ-1) |
> | Logging | The page already logs through Pino (0 `console.*`); it keeps the module name `AdminExchangeRates`. The **9** `console.*` calls in `CurrencyService.ts` are converted to a **browser-safe** logger, because `CurrencySelector` loads the file in the browser (CLAUDE.md rule 3, SA-R12). **User approval for this conversion is treated as given within this scope** (the user asked for the page to be made usable; recorded here so the Dev does not re-ask) |
> | Docs | Optional: the §3.1 CLAUDE.md one-line fix, if SA and the user agree |

### 1.3 Functional requirements for slice 1a (requirement §6)

> | # | Requirement | Slice |
> |---|---|---|
> | FR-1 | The page lists every currency in `exchange_rates` with code, name, symbol, rate to USD, enabled, and last updated (UTC) | 1a |
> | FR-2 | An admin can edit a rate and save it. The save goes through the admin route, never the browser client | 1a |
> | FR-3 | An admin can switch a currency on or off. Same route rule | 1a |
> | FR-4 | The USD row's rate cannot be edited (R-2) | 1a |
> | FR-5 | No currency can be added or deleted in this scope (R-1) | 1a |
> | FR-6 | The route refuses: a rate ≤ 0, a rate above the upper bound, more than 6 decimal places, a non-numeric rate, a currency code that is not three upper-case letters or that does not exist | 1a |
> | FR-7 | Each saved change writes `last_updated_at` = now and `updated_by` = the admin's user id, and writes one non-blocking audit entry with old and new values | 1a |
> | FR-8 | Each row shows its age. A rate older than 35 days shows a clear "Stale" status (text, not colour alone). The header or KPI area shows how many enabled rates are stale | 1a |
> | FR-9 | A save failure shows a short message on the page and leaves the previous value showing; it never shows raw internal errors | 1a |
> | FR-10 | Only platform admins can read or change rates through the route (`requireAdmin`); everyone else gets the standard refusal | 1a |
> | FR-13 | No screen, route or calculation converts money or totals across currencies with these rates (D-5) | All |

### 1.4 Non-functional requirements (requirement §7)

> ## 7. Non-functional requirements
>
> - **Security:** `requireAdmin` first statement; admin truth is `admin_users` / `is_platform_admin()`, never `profiles.role`; service-role use documented in code; no internal error details outside development.
> - **Data access:** all DB access via `lib/repositories/` (rule 1); Zod before business logic (rule 2); Pino with `correlationId` (rule 3).
> - **Audit:** non-blocking, `.catch` logged, never fails the request.
> - **Accessibility:** status never by colour alone; table and inputs keyboard-usable and named; follows the admin layout standard.
> - **Performance:** one read of 43 rows; no caching layer needed.
> - **Compatibility:** `CurrencySelector` and `currencyHelpers` keep working before and after 1b.
> - **CI:** no new CI job; tests run in the existing Jest gate.

### 1.5 Acceptance criteria, slice 1a (requirement §8)

> ### Slice 1a
>
> - [ ] Typing `/admin/exchange-rates` as a platform admin opens the page; a non-admin is refused by the admin layout guard (unchanged behaviour).
> - [ ] The page shows all 43 currencies with last updated in UTC; every rate last touched 2025-11-05 shows as Stale, and the stale count is visible.
> - [ ] Editing a rate and saving updates it, refreshes "last updated", and clears the Stale status for that row.
> - [ ] Switching a currency off and on works and persists.
> - [ ] The USD rate cannot be edited.
> - [ ] The page source contains no Supabase client import and no direct table write (Jest source guard).
> - [ ] Route tests: happy path (read, update rate, set enabled), auth failure (not admin → refused, nothing written), invalid input (rate 0, negative, above bound, too many decimals, bad code, unknown code → 400, nothing written).
> - [ ] Repository tests: one per method, including a not-found currency.
> - [ ] One audit entry per change, with old and new values; an audit failure does not fail the save.
> - [ ] Zero `console.*` left in `lib/services/CurrencyService.ts` (all 9 converted to a browser-safe logger); the page stays at 0 and is pinned by the SA-R3 Exchange rates page guard, which replaces G-6.
> - [ ] `finance.source.guard` passes unchanged; no file under `lib/business-os/` imports the repository or `CurrencyService`.
> - [ ] `CurrencySelector` still lists enabled currencies.

### 1.6 SA requirement review (requirement §13, in full)

> **Reviewed by SA — 2026-10-19**
> **Verdict: CLEARED-WITH-CHANGES.** The slicing, the security model and the 1a-before-1b order are sound. But §2.2 and parts of §5.1 describe a **stale `main`**: the local checkout the BA read is 505 commits behind `origin/main`, and on `origin/main` the page has already moved (SA-R1). The user's 2026-10-19 decision stands and reverses two recorded finance decisions for this one page (SA-R2). **Conditions:** BA applies SA-R1 and SA-R2 to this requirement and to the finance requirement **before** Dev writes the slice 1a workplan; Dev branches from `origin/main`. User decisions D-1 to D-6 are not reopened.
>
> ### 13.1 Rulings on the BA's questions
>
> | # | Ruling |
> |---|---|
> | SQ-1 | **Leave `CurrencyService.updateRatesFromApi` and `updateRate` in place, unwired** (no caller on `origin/main`). Add a short header note that both are browser-side writers that stop working once 1b revokes client writes, and must not be wired again: the admin route is the only writer. Do not extend `CurrencyService` (direct Supabase outside `lib/repositories/`, legacy) |
> | SQ-2 | **Server route alone. No `is_platform_admin()` policy on either table.** 1b drops both `profiles.role` policies and adds none. Keep only "Users can read enabled exchange rates" (`SELECT`, `authenticated`, `is_enabled = true`) for `CurrencySelector` / `currencyHelpers`. Fewer policies, nothing to keep in step with `admin_users` |
> | SQ-3 | **One `GET /api/admin/exchange-rates` + one `PATCH /api/admin/exchange-rates/[currencyCode]`.** The currency code comes from the path (`z.string().regex(/^[A-Z]{3}$/)`), like the credits accounts route takes its id from the path. The body is a `.strict()` Zod discriminated union on `field`: `{ field: 'rate', rate: <decimal string> }` or `{ field: 'enabled', isEnabled: boolean }`. One change per request |
> | SQ-4 | **Redirect**, in slice 2: `app/admin/exchange-rates/page.tsx` becomes a server `redirect('/admin/finance?tab=exchange-rates')` (the admin layout still gates it). Tab key `exchange-rates`. Slice 2 then amends the guards that pin the page (SA-R3, SA-R13) |
> | SQ-5 | **Accepted with a shape rule.** The rate travels as a **decimal string**, not a JS number, so no float rounding reaches the `numeric` column: `^\d{1,8}(\.\d{1,6})?$`, then `> 0` and `≤ 10,000,000`. Dev confirms the column type and scale with the `business-os-schema-check` skill first; if the live scale is below 6, the decimals cap follows the column |
> | SQ-6 | **Agree with the wording, not with riding in 1a.** CLAUDE.md is the user's file: a separate docs-only change once the user signs off on the sentence. It does not block 1a |
> | SQ-7 | **One KPI tile, "Stale rates"** (enabled rates with `last_updated_at` older than 35 days), using the existing `KpiStrip` (the `KpiStrip.callers.pin` test gains this caller). Each row also carries a text `StatusChip` "Stale" |
>
> ### 13.2 Additional rulings
>
> | # | Topic | Ruling |
> |---|---|---|
> | SA-R1 | **Stale baseline (must fix before the workplan)** | On `origin/main` (not the local `main` the BA read): the page is marked `REDUNDANT (BD-34, 2026-10-16)`; it is **already read-only** (BD-36, FF-1a, PR #465): no rate edit, no toggle, no outside fetch; it **already logs via Pino** (`createLogger({ module: 'AdminExchangeRates' })`, 0 `console.*`); it still **reads** both tables from the browser (`exchange_rates` all rows, `exchange_rate_history` last 50). It is pinned by `app/admin/__tests__/redundantPages.source.guard.test.ts` (G-1 header, G-3 no notice, G-4 no in-app link to `/admin/exchange-rates`, G-5 Pino, G-6 read-only: `fetch(` is a forbidden token in the page) and by `AdminSidebar.nav.test.ts` (`UNLISTED`, sidebar never names `exchange-rates`). A write-access check already exists: check 35, `scripts/check-bos-exchange-rates-write-access.sql`, and the DB lockdown is the unscheduled finance follow-up **FF-2**. `CurrencyService.ts` has **9** `console.*` calls, not 7. BA rewrites §2.2 and the §5.1 Page / Logging / Dead code rows from `origin/main` |
> | SA-R2 | **Record the reversal** | The user's 2026-10-19 message makes the page a maintained admin tool again. That **amends BD-34 and BD-36 for Exchange rates only** (the Platform dashboard stays redundant). BA records a new BD in `BUSINESS_OS_FINANCE_HEALTH_REQUIREMENT.md` (amends BD-34 / BD-36 for this page; BD-12 and CUR-3 unchanged, per D-5), marks **FF-2 superseded by slice 1b here**, and cross-links both documents. Without it, slice 1a contradicts a recorded user decision and its guard |
> | SA-R3 | **Guards slice 1a must change** | `redundantPages.source.guard`: Exchange rates leaves G-1, G-3, G-5 and G-6 (the dashboard keeps them). G-6 is **replaced** by an Exchange rates page guard, with a planted control per rule: no `@/lib/supabaseClient` import, no `.from(`, no `CurrencyService`, no outside host; the only `fetch(` targets are `/api/admin/exchange-rates`. G-4 (no in-app link) and the sidebar `UNLISTED` entry **stay** in 1a (D-6: URL only). The `REDUNDANT` header comment is removed from the page |
> | SA-R4 | **Reads move too** | After 1b the history table has no client policy or grant, so the browser history read would fail. 1a moves **both** reads to `GET`: rates (all rows, ordered by code) and the newest 50 history rows, plus a `readAt`. Add an FR for the history panel (BD-36 kept it). The page then holds no Supabase client at all |
> | SA-R5 | **1a before 1b — confirmed** | `supabaseServer` (service role) bypasses RLS and holds the table grants, so the 1a route works under today's `profiles.role` policies. Order: 1a deployed → user applies 1b. After 1b, nothing in the product writes or reads these tables from the browser except the kept `CurrencySelector` enabled-row read |
> | SA-R6 | **Rule 4 / repository** | Accepted: a global platform table with no tenancy column, `supabaseServer` intentional. The repository carries a header in the `BoostPackRepository.ts` form: why there is no `user_id` filter, that authorisation is the caller's job, the one permitted caller (the admin route behind `requireAdmin`), server-only, no caller-supplied filters or column lists. **`tenant-isolation-guard` is not applicable**: no tenant id, no owner column, no caller-supplied account id. State that in the workplan. `updated_by` comes from the `requireAdmin` result (`gate.user.id`), **never** from the body |
> | SA-R7 | **Trigger contract** | The rate update sets `rate_to_usd`, `last_updated_at = now()` and `updated_by = admin id` **in one UPDATE** (SA-R6), so the trigger attributes the history row correctly. The enable toggle also sets `updated_by` and `last_updated_at`. Is `last_updated_at` set by a DB default or trigger on UPDATE? Dev checks; the repository sets it explicitly either way. A **same-value rate save is allowed** and means "confirmed for this month": it refreshes `last_updated_at` (clears Stale), writes no history row (trigger `IS DISTINCT FROM`), and the audit row records `oldValue = newValue`. A repository test pins that `updated_by` is in every update payload |
> | SA-R8 | **Base currency** | USD: the rate cannot be edited (FR-4) **and it cannot be disabled** (400). Add to FR-4 and the route tests |
> | SA-R9 | **Audit entry shape** | New constants in `lib/audit/events.ts` (`EXCHANGE_RATE_UPDATED`, `EXCHANGE_RATE_ENABLED_CHANGED`), registered in `lib/audit/eventAudience.ts` (platform admin audience). `entityType: 'exchange_rate'`, `entityId: <currency code>`, `userId` and `actorId` = admin id, `severity: 'info'`, `details: { currencyCode, field, oldValue, newValue }` (rates as strings, no other data), `request`. Written with **`logAndFlush`** (`lib/audit/boundedAuditFlush.ts`) before responding: it is a price-adjacent admin write (WC-7) and the **only** record of toggles. Never fails the request. The `oldValue` comes from the pre-read; the trigger's history row is the atomic record of the true old rate |
> | SA-R10 | **Route conventions** | Match `app/api/admin/boost-packs/route.ts` and the credits accounts route: `correlationId` from `x-correlation-id` or `crypto.randomUUID()`, `logger.child({ correlationId })`, `requireAdmin(requestLogger)` as the first gate, Zod `safeParse` → 400, repository call, CLAUDE.md error format with the development-only `details`, `runtime = 'nodejs'`, `dynamic = 'force-dynamic'`. 404 for an unknown code. Logs carry the currency code and field, never the admin email |
> | SA-R11 | **Page and layout standard** | `AdminPageHeader`, Refresh-only bar with "Read at", shared loading / error / empty states, `adminTable` constants, `StatusChip` (Stale, Enabled / Disabled as text), `formatUtc`, `KpiStrip` (SQ-7). Rate input is a named text input; save shows a short error and keeps the old value (FR-9). Logging stays on the module name `AdminExchangeRates` with the logger the other admin client pages use |
> | SA-R12 | **`CurrencyService.ts` logging** | 9 calls to convert. The file is loaded in the browser (`components/settings/CurrencySelector.tsx` imports it), so it must use a browser-safe logger (`@/lib/logger/client` or whatever the other client files under `components/` use). Dev confirms before converting |
> | SA-R13 | **Slice 2 and the finance guards** | `finance.source.guard` walks **all** of `app/admin/finance/**` and CUR-3 fails any file there whose code contains `exchange_rates`. So: the rates table component lives **outside** `app/admin/finance/` (for example `app/admin/exchange-rates/components/`); the finance tab file only imports and renders it; no finance file names `exchange_rates` (the API path `exchange-rates` with a hyphen does not match). `finance.source.guard` and `app/admin/finance/__tests__/source.guard.test.ts` stay unchanged and green; an edit to either needs an SA ruling. Slice 2 also amends `redundantPages` G-4 (the redirect target `/admin/finance?tab=exchange-rates` does not name `/admin/exchange-rates`, so G-4 may need no change; Dev confirms) and the sidebar nav test's on-disk route scan |
> | SA-R14 | **1b migration shape** | One file, idempotent. **Record**: `CREATE TABLE IF NOT EXISTS` for both tables as live (columns, defaults, constraints, the `changed_by` / `updated_by` FKs, indexes), read with `business-os-schema-check`; trigger via `DROP TRIGGER IF EXISTS` + `CREATE TRIGGER`. **Do not re-`CREATE` the function**: its body contains the SQL keyword after `INSERT`, which breaks the Supabase SQL editor when pasted (known hazard; FR-0.13 of the SECDEF stream forbids it), and the body is already captured in `SECDEF_PROD_ONLY_FUNCTION_DEFINITIONS.md`. Instead: `ALTER FUNCTION public.log_exchange_rate_change() SET search_path = public, pg_temp` (safe: the body is schema-qualified and `NOW()` is `pg_catalog`), plus, in the same file, `REVOKE EXECUTE ON FUNCTION public.log_exchange_rate_change() FROM PUBLIC, anon, authenticated` and `GRANT EXECUTE ... TO service_role`. That keeps the SECDEF CI guard (S6) satisfied and matches the stream's slice 5 pattern; the revoke is a no-op on prod. **Policies**: `DROP POLICY IF EXISTS` for both `profiles.role` policies. **Grants**: `REVOKE ALL` on both tables from `anon`; on `exchange_rates`, revoke `INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER` from `authenticated` (keep `SELECT`); `REVOKE ALL` on `exchange_rate_history` from `authenticated`. `TRUNCATE` is not governed by RLS, so it is revoked explicitly. **Pre-check**: function owner is `postgres` (SECDEF FR-0.10), `proconfig` is null, `pg_depend` shows only the trigger. **Checker**: reuse and extend check 35 rather than a new script; it asserts the policies, the grants, `proconfig` holds the `search_path`, no client EXECUTE, and that the trigger exists. Rollback under `supabase/SQL Scripts/`. Update the SECDEF requirement / inventory: this function leaves the parked S7 list (47 → 46) |
> | SA-R15 | **Migration number** | Highest on `origin/main` is `20261081` (`20261077` is already taken there). No remote branch (353 scanned), `supabase/held/` or `supabase/SQL Scripts/` holds `20261082` or higher. **Provisional: `20261082`.** Dev re-checks `origin/main`, open PR branches and `supabase/held/` at build time and takes the next free number |
> | SA-R16 | **Not touched — confirmed** | No import from `lib/business-os/entitlements/` (type-only included), no catalog or tier change: `business-os-entitlements` checklist not triggered. No LLM call (`bos-llm-call-standards` n/a), no cron or queue (`durable-queue-drain` n/a), no new pattern. Admin gate per CLAUDE.md: `requireAdmin` / `requireAdminPage`, never `profiles.role` |
> | SA-R17 | **Acceptance wording** | §8 slice 1a "no file under `lib/business-os/` imports ... `CurrencyService`" means **direct** imports: `InsightRepository.ts` already imports `currencyHelpers`, which type-imports `CurrencyService`. That is existing and allowed. Remove "Zero `console.*` in the page" (already true) and replace it with the SA-R3 guard |
>
> ### 13.3 Required changes for Dev (slice 1a workplan)
>
> 1. Branch from `origin/main`; restate the as-built page from there (SA-R1).
> 2. Repository with the rule-4 header (SA-R6), every update carrying `updated_by` and `last_updated_at` (SA-R7); unit test per method incl. not-found and the `updated_by` pin.
> 3. `GET` + `PATCH [currencyCode]` per SQ-3 and SA-R10; decimal-string rate per SQ-5; USD edit and disable refused (SA-R8); `GET` returns rates, 50 history rows and `readAt` (SA-R4).
> 4. Audit per SA-R9 with `logAndFlush`; new events registered in `events.ts` and `eventAudience.ts`.
> 5. Page rewrite per SA-R11 and SQ-7; no Supabase client in the page.
> 6. Guard changes per SA-R3 (planted controls); `KpiStrip` callers pin updated.
> 7. `CurrencyService.ts` 9 `console.*` → browser-safe logger (SA-R12); SQ-1 header note.
> 8. Route integration tests: happy path (read, rate, toggle, same-value confirm), not admin (nothing written), invalid input (each SQ-5 / SA-R8 case, bad code, unknown code 404).

---

## 2. As-built baseline on this branch

SA-R1 / §13.3 item 1. Re-read by Dev on 2026-10-19 from this worktree (`feature/admin-exchange-rates-1a` at `4583d21e`, equal to `origin/main`).

| Item | As built today |
|---|---|
| `app/admin/exchange-rates/page.tsx` | `'use client'` first. Line 3 is the exact `// REDUNDANT (BD-34, 2026-10-16): ... do not extend or link.` header; lines 4-7 the BD-12 and FU-M8-1 / FF-1a read-only notes. **Read-only**: no rate edit, no enable toggle, no outside fetch. **Browser reads** through `@/lib/supabaseClient`: `exchange_rates` `select('*')` ordered by `currency_code`, and `exchange_rate_history` `select('*')` newest 50 by `changed_at`. Logs through `createLogger({ module: 'AdminExchangeRates' })` from `@/lib/logger`, **0 `console.*`**. Own `<h1>`, own Refresh button in the header, `framer-motion` cards, hand-rolled table classes, dates by `toLocaleDateString` (not `formatUtc`), rates shown as JS numbers with `toFixed(6)`, `catch (err: any)`. No stale indication, no KPI, no visible "redundant" notice |
| `app/admin/__tests__/redundantPages.source.guard.test.ts` | Pins both redundant pages: G-1 header + `'use client'` (both pages and the dashboard route), G-2 sidebar names neither route, G-3 no notice, G-4 no non-test file under `app/`, `lib/`, `components/`, `hooks/` names either page route in code, G-5 Exchange rates on Pino, G-6 Exchange rates read-only (`fetch(` forbidden; every `.from(` is a `.select(` on the two rate tables). A planted control per rule |
| `app/admin/components/__tests__/AdminSidebar.nav.test.ts` | `/admin/exchange-rates` is `UNLISTED`; the sidebar never contains `exchange-rates`. **Unchanged by 1a** |
| `lib/services/CurrencyService.ts` | **9 `console.*`** (lines 64, 91, 118, 231, 239, 291, 399, 431, 436). `updateRate` and `updateRatesFromApi` have no caller outside the file. Imported by `components/settings/CurrencySelector.tsx` (browser) and type-imported by `lib/utils/currencyHelpers.ts` |
| Server route / repository for the two tables | **None.** No `app/api/admin/exchange-rates/`, no repository |
| Audit | No exchange-rate event and no `exchange_rate` entity type registered (`lib/audit/events.ts`, `lib/audit/types.ts`) |
| Live trigger (requirement §2.1, verified by TL 2026-10-19) | `exchange_rate_change_trigger` → `log_exchange_rate_change()` writes a history row with `changed_by = NEW.updated_by` only when `rate_to_usd IS DISTINCT FROM` the old value |

---

## 3. Step 0: live schema verification (blocking)

SQ-5 and the `business-os-schema-check` skill require the column type and scale to be confirmed on the live project `jgccgkyhpwirgknnceoh` **before** the repository and the Zod schema are written.

**✅ DONE — run read-only by TL on `jgccgkyhpwirgknnceoh`, 2026-10-19.** (The planning session had no live access; TL ran the queries below.) Results:

| Table | Column | Live definition |
|---|---|---|
| `exchange_rates` | `id` | `uuid` |
| | `currency_code` | `varchar` NOT NULL, `CHECK (currency_code ~ '^[A-Z]{3}$')`, **UNIQUE** |
| | `currency_name` | `varchar` NOT NULL |
| | `currency_symbol` | `varchar` NOT NULL |
| | `rate_to_usd` | **`numeric(12,6)`** NOT NULL, `CHECK (rate_to_usd > 0)` → largest storable value **999,999.999999** |
| | `is_enabled` | `boolean` DEFAULT `true`, **nullable** |
| | `decimal_places` | `smallint` DEFAULT 2, `CHECK 0..4` (display only; not the rate scale) |
| | `last_updated_at` | `timestamptz` DEFAULT `now()` (default only; **no** trigger sets it on UPDATE) |
| | `updated_by` | `uuid` FK → `auth.users(id)`, nullable |
| | `created_at` | timestamp |
| `exchange_rate_history` | `id` | — |
| | `currency_code` | `varchar` NOT NULL |
| | `old_rate` | `numeric(12,6)` (nullable) |
| | `new_rate` | `numeric(12,6)` NOT NULL |
| | `changed_by` | `uuid` FK → `auth.users` |
| | `changed_at` | `timestamptz` DEFAULT `now()` |
| | `change_reason` | `text`, nullable, **never written by the trigger** |

Data: 43 rows, 16 enabled, min rate 0.79, max 150, `USD` = 1.000000 (one row), 15 history rows. Triggers: only `exchange_rate_change_trigger` (fires on rate change only); `log_exchange_rate_change()` is SECDEF with no pinned `search_path` (1b's job, SA-R14).

Effects (ruled in §10): `currency_code` unique and already constrained to `^[A-Z]{3}$` → path key holds. Scale is 6 → decimals cap unchanged. Integer digits are 6, not 8 → **O-1 applies** (SA-O1 in §10). `last_updated_at` has no UPDATE trigger → the repository sets it explicitly (SA-R7, as planned). `change_reason` exists but is always null → keep it in the wire type, the history table does not show a Reason column.

Before the repository task begins, the following read-only queries are run (Dev through the Supabase tool if it is available at build time, otherwise TL). They avoid the word that breaks the Supabase SQL editor.

```sql
-- Q1: column types, precision, scale, nullability, defaults
select table_name, column_name, data_type, numeric_precision, numeric_scale, is_nullable, column_default
from information_schema.columns
where table_schema = 'public' and table_name in ('exchange_rates', 'exchange_rate_history')
order by table_name, ordinal_position;

-- Q2: every non-internal trigger on exchange_rates (is last_updated_at set on UPDATE by the database?)
select tgname, pg_get_triggerdef(oid) from pg_trigger
where tgrelid = 'public.exchange_rates'::regclass and not tgisinternal;

-- Q3: constraints (is currency_code unique?)
select conname, pg_get_constraintdef(oid) from pg_constraint
where conrelid = 'public.exchange_rates'::regclass;

-- Q4: today's range and the base row
select count(*) as rows, min(rate_to_usd), max(rate_to_usd),
       count(*) filter (where currency_code = 'USD') as usd_rows,
       count(*) filter (where currency_code !~ '^[A-Z]{3}$') as odd_codes
from public.exchange_rates;
```

Results are pasted into this section with the date and the project ref. Decisions that follow from them:

| Finding | Effect on the build |
|---|---|
| `rate_to_usd` scale < 6 | Decimal cap follows the column (SQ-5, already ruled) |
| `rate_to_usd` integer digits (precision − scale) < 8 | O-1: the shape regex and the upper bound cannot exceed what the column stores; SA rules before the Zod schema is written |
| `currency_code` not unique, or `odd_codes > 0` | Stop and report to SA: the path key `[A-Z]{3}` and "one row per code" would not hold |
| A trigger already sets `last_updated_at` | Repository still sets it explicitly (SA-R7); recorded here |
| `exchange_rate_history.change_reason` present but never written (live) | Kept in the history wire type as `changeReason`; the history table shows no Reason column (SA §10 additional ruling 4) |

---

## 4. Analysis summary

| Area | What 1a touches |
|---|---|
| DB tables | `public.exchange_rates` (read all, update one row by code), `public.exchange_rate_history` (read newest 50). No DDL, no migration |
| Repository | New `ExchangeRatesRepository` (global table, service role intentional, rule-4 header) |
| API | New `GET /api/admin/exchange-rates`, new `PATCH /api/admin/exchange-rates/[currencyCode]` |
| Audit | Two new events, one new entity type `exchange_rate`, written with `logAndFlush` |
| Page | `app/admin/exchange-rates/page.tsx` rewritten to the admin layout standard; the view lives in `app/admin/exchange-rates/components/` |
| Shared pure rules | New `lib/admin/exchangeRates/` (Zod schemas, bounds, stale rule, wire types), used by the route and the page |
| Guards / pins | `redundantPages.source.guard` (G-6 replaced, G-1/G-3/G-5 drop Exchange rates, G-4 matcher tightened, see O-2), `KpiStrip.callers.pin` (new caller), `layoutFolder.guard` (registry entry) |
| Legacy | `CurrencyService.ts`: 9 `console.*` to the browser-safe logger, SQ-1 header note. `CurrencySelector` and `currencyHelpers` unchanged and keep working |
| Not applicable | `tenant-isolation-guard`: **not applicable** (SA-R6): no tenant id, no owner column, no caller-supplied account id; the only caller-supplied key is a currency code on a global table, behind `requireAdmin`. `business-os-entitlements`, `bos-llm-call-standards`, `durable-queue-drain`: not triggered (SA-R16). Data export classification: no new table, bucket or column, so no descriptor change |

`console.*` check on every file this slice modifies: `lib/services/CurrencyService.ts` has **9** (converted here, approval recorded in requirement §5.1 Logging row). The page has 0. `lib/repositories/types.ts`, `lib/repositories/index.ts`, `lib/audit/events.ts`, `lib/audit/eventAudience.ts`, `lib/audit/types.ts`, `lib/audit/ownerVisibility.ts` have 0.

---

## 5. Implementation approach

### 5.1 Pure rules: `lib/admin/exchangeRates/exchangeRateRules.ts`

One pure module (no I/O, no React, no server-only import, so the page may import it) holding:

- `BASE_CURRENCY = 'USD'`, `STALE_AFTER_DAYS = 35`, `HISTORY_LIMIT = 50`.
- `RATE_PATTERN = /^\d{1,6}(\.\d{1,6})?$/` (SA O-1, amends SQ-5: live `rate_to_usd` is `numeric(12,6)`), then `> 0` compared as a string, never through `Number`. The pattern alone caps the value at 999,999.999999, so there is no second upper-bound rule; `RATE_MAX = '999999.999999'` is kept only for tests and the page hint.
- `currencyCodeSchema = z.string().regex(/^[A-Z]{3}$/)` (SQ-3).
- `patchBodySchema`: `z.discriminatedUnion('field', [z.object({ field: z.literal('rate'), rate: rateString }).strict(), z.object({ field: z.literal('enabled'), isEnabled: z.boolean() }).strict()])`. `rateString` = `z.string().regex(RATE_PATTERN)` then one refinement `> 0`, decided on the **decimal string** (at least one non-zero digit), never through `Number`, so no float rounding is involved (SQ-5 as amended by O-1).
- `sameRate(a, b)`: equality of two decimal strings after normalising (strip leading zeros of the integer part, trailing zeros of the fraction), so `"3.65"` and `"3.650000"` are the same rate.
- `isStale(lastUpdatedAt, readAt)`: true when `readAt − lastUpdatedAt > 35 × 24 h`; an unparseable or null date is stale. `readAt` is the **server** clock from `GET`, so the page and tests agree.
- Wire types: `ExchangeRateWire { currencyCode, currencyName, currencySymbol, rateToUsd: string, isEnabled, decimalPlaces, lastUpdatedAt, updatedBy }`, `ExchangeRateHistoryWire { id, currencyCode, oldRate: string | null, newRate: string, changedBy, changedAt, changeReason }`, `ExchangeRatesPayload { rates, history, readAt }`, `ExchangeRatePatchResult { rate, unchanged }`.

### 5.2 Repository: `lib/repositories/ExchangeRatesRepository.ts`

Per the `new-repository` skill and the `BoostPackRepository.ts` header form (SA-R6). Header states: global platform table, no `user_id` or owner column, so no `.eq('user_id')` (CLAUDE.md rule 4 exemption stated); `supabaseServer` intentional; **authorisation is the caller's job**; the one permitted caller is `app/api/admin/exchange-rates/**` behind `requireAdmin` (`admin_users`, never `profiles.role`); no caller-supplied filter, table name or column list; server-only; `updated_by` must be the acting admin on every update because the live trigger copies it to `exchange_rate_history.changed_by`; `CurrencyService` is a legacy browser reader/writer and is not a second writer to extend.

| Method | Query | Returns |
|---|---|---|
| `listAll()` | explicit column list, `rate_to_usd::text`, ordered by `currency_code` | `ExchangeRateRow[]` |
| `findByCode(code)` | same columns, `.eq('currency_code', code).maybeSingle()` | row or `null` (not found is not an error) |
| `listRecentHistory()` | explicit columns, `old_rate::text`, `new_rate::text`, ordered `changed_at` desc, `.limit(50)` (fixed, not caller-supplied) | `ExchangeRateHistoryRow[]` |
| `updateRate(code, rate, adminId)` | **one** `update({ rate_to_usd: rate, last_updated_at: now, updated_by: adminId })` `.eq('currency_code', code).select(cols).maybeSingle()` | row or `null` |
| `setEnabled(code, isEnabled, adminId)` | **one** `update({ is_enabled, last_updated_at: now, updated_by: adminId })`, same shape | row or `null` |

- Rates travel as **strings** both ways: the update sends the validated decimal string (PostgREST passes it to `numeric` unchanged), and reads cast to text, so no JS float ever holds a rate.
- `now` comes from an injectable clock (constructor option, default `() => new Date()`), so the test can pin `last_updated_at`.
- Every method returns `{ data, error }` and never throws; `createLogger({ service: 'ExchangeRatesRepository' })`; logs carry the code and duration only.
- Row types `ExchangeRateRow`, `ExchangeRateHistoryRow` in `lib/repositories/types.ts`; class and singleton exported from `lib/repositories/index.ts`.
- No `.or()` anywhere in the update chain (the PostgREST `update + or + select` 42703 bug does not apply).

### 5.3 Routes

Both files follow `app/api/admin/boost-packs/route.ts` and the credits accounts route (SA-R10): `runtime = 'nodejs'`, `dynamic = 'force-dynamic'`, `createLogger({ module: 'AdminExchangeRatesAPI' })`, `correlationId` from `x-correlation-id` or `crypto.randomUUID()`, `logger.child({ correlationId })`, **`const gate = await requireAdmin(requestLogger)` as the first statement of each handler**, `{ success, data }` / `{ success: false, error, details }` with `details` only in development. Logs carry `currencyCode` and `field`, the admin id where useful, never an email. No direct Supabase.

**`GET /api/admin/exchange-rates`** (`app/api/admin/exchange-rates/route.ts`): gate → `listAll()` and `listRecentHistory()` in parallel → either error → 500 `Failed to read exchange rates` → `200 { success: true, data: { rates, history, readAt } }` (`readAt` = server `new Date().toISOString()`; rows mapped to the camelCase wire types). No query string is read. No audit (plain read).

**`PATCH /api/admin/exchange-rates/[currencyCode]`** (`app/api/admin/exchange-rates/[currencyCode]/route.ts`), in this order, nothing written before the last step:

1. `requireAdmin` (401 / 403 owned by the gate).
2. Path code through `currencyCodeSchema` → 400 `Invalid currency code`.
3. Body: JSON parse failure → 400; `patchBodySchema.safeParse` failure → 400 `Invalid input` (issues only in development).
4. Base currency (SA-R8, pure, before any read): code `USD` with `field: 'rate'` → 400 `The USD rate is fixed at 1 and cannot be edited`; `field: 'enabled', isEnabled: false` → 400 `USD cannot be disabled`.
5. Pre-read `findByCode` → error 500, `null` → **404** `Unknown currency`.
6. Update (`updateRate` or `setEnabled`, `adminId = gate.user.id`, never from the body) → error 500; `null` (row vanished) → 404.
7. Audit with `logAndFlush` (§5.4), awaited before responding.
8. `200 { success: true, data: { rate, unchanged } }`, `unchanged` = `sameRate(old, new)` for a rate, `old === new` for enabled.

**Same-value save** (SA-R7): allowed, and means "confirmed for this month". It runs the same UPDATE, so `last_updated_at` refreshes and Stale clears; the trigger writes no history row (`IS DISTINCT FROM`); the audit row records `oldValue = newValue`. The same holds for an enabled save to its current value. Per SA-R7, the enable toggle also refreshes `last_updated_at` (see O-5).

### 5.4 Audit (SA-R9)

- `lib/audit/events.ts`: `EXCHANGE_RATE_UPDATED` and `EXCHANGE_RATE_ENABLED_CHANGED` in `AUDIT_EVENTS` under a new "PLATFORM EXCHANGE RATES (admin-only, server-written)" block, plus `EVENT_METADATA` entries: `severity: 'info'`, `complianceFlags: ['SOC2']`, descriptions "Exchange rate set by an admin (no amount converted)" and "Currency switched on or off by an admin".
- `lib/audit/eventAudience.ts`: both tagged **`'shared'`**. The registry has three audiences (`bos`, `shared`, `agentspilot`) and its header puts "admin/system" events under `shared`; there is no separate admin-only audience value, so "platform admin audience" maps to `shared`.
- `lib/audit/types.ts`: `'exchange_rate'` appended to `AUDIT_ENTITY_TYPES` (strict writes validate against it).
- `lib/audit/ownerVisibility.ts`: `exchange_rate: 'owner'`, with a comment in the `ai_pricing` / `archive_run` form: written with the admin's own id as `user_id`, never against a customer account, so `'owner'` shows it to nobody but that admin, and the owner-policy `NOT IN` list (and so the migration) is unchanged. (`'operator'` would require an owner-policy migration, out of scope.)
- Entry: `action`, `entityType: 'exchange_rate'`, `entityId: <currency code>`, `userId` and `actorId` = `gate.user.id`, `severity: 'info'`, `details: { currencyCode, field, oldValue, newValue }` (rates as strings, enabled as booleans, nothing else), `request`.
- Written with `await logAndFlush(entry, requestLogger, { reason, continues })` from `lib/audit/boundedAuditFlush.ts`, which never throws and is bounded, so an audit failure never fails the save.

### 5.5 Page (SA-R11, SQ-7, SA-R3)

- `app/admin/exchange-rates/page.tsx` becomes a small component that renders `ExchangeRatesView`. The REDUNDANT header and the FF-1a / FU-M8-1 comments are removed; a short header comment cites BD-55, D-5 (no conversion) and D-6 (URL only, no link).
- `app/admin/exchange-rates/components/` holds the view, so slice 2 can render it from the Finance tab without placing it under `app/admin/finance/` (SA-R13). Files: `ExchangeRatesView.tsx` (`'use client'`, read + state), `ExchangeRatesKpis.tsx` (the strip), `ExchangeRatesTable.tsx` (rows, edit, toggle), `RateHistoryTable.tsx` (newest 50).
- Read: `fetch('/api/admin/exchange-rates', { cache: 'no-store' })` through `readAdminResponse`; write: `fetch(\`/api/admin/exchange-rates/${code}\`, { method: 'PATCH', ... })` with the body through the shared helper (no own `.json(`, per the layout registry rule). No Supabase client, no `CurrencyService`, no outside host.
- Layout: `AdminPageHeader` (title "Exchange rates", purpose "Rates an admin keeps by hand, in units of each currency per 1 USD. Nothing on the platform converts money with them."), `ExchangeRatesKpis` on `KpiStrip`, Refresh-only `AdminFilterBar` with `readAt`, `AdminLoading` / `AdminError` / `AdminEmpty`, `ADMIN_TABLE*` constants, `StatusChip`, `formatUtc`.
- KPI (SQ-7): one tile, label "Stale rates", value = enabled rates with `isStale`, sub "of N enabled, older than 35 days", status `amber` when above 0, no link target. Loading uses `KpiStrip loading placeholderCount={1}`.
- Table columns: Currency (code + name), Symbol, Rate to USD (the string as stored), Enabled (`StatusChip` "Enabled" / "Disabled" in words), Last updated (`formatUtc` + age in days), Status (`StatusChip` "Stale" in words, or nothing), Actions.
- Edit: "Edit rate" opens a named text input (`aria-label="Rate to USD for EUR"`) prefilled with the stored string; Save / Cancel. Client-side, the same `RATE_PATTERN` gives an inline hint; the server is the authority. On failure: short message beside the row, input keeps the typed value, the shown rate stays the previous value (FR-9). On success: the row is replaced with the returned row (date refreshed, Stale cleared).
- Toggle: a button "Switch off" / "Switch on" with the result in words.
- USD row: no Edit and no Switch off control, with the text "Base currency, fixed at 1" (FR-4, SA-R8).
- History panel: the newest 50 rows from `GET`, `formatUtc` dates, old and new rate as strings, changed-by as a short id, the per-row "History" filter kept. The percentage-change column is dropped (it parses rates as floats and is not needed for D-1 to D-6).
- Logger: `clientLogger.child({ module: 'AdminExchangeRates' })` from `@/lib/logger/client`, the form other admin client pages use (`agentspilot-billing`, `audit-trail`). Logs carry the code and status, never a response body.

### 5.6 Guards (SA-R3)

In `app/admin/__tests__/redundantPages.source.guard.test.ts`:

- G-1, G-3, G-5: the Exchange rates page leaves `PAGES` / `MARKED`; the Platform dashboard page and its API route keep them unchanged.
- **G-6 replaced** by **G-6 (Exchange rates 1a)**, run over every non-test file under `app/admin/exchange-rates/` (the page and its `components/`), comments stripped:
  - no `@/lib/supabaseClient` import (nor `supabaseServer`, `supabaseServerAuth`, `@supabase/`);
  - no `.from(`;
  - no `CurrencyService` (nor `createCurrencyService`);
  - no outside host (`https?://`);
  - every `fetch(` call's first argument begins with `'/api/admin/exchange-rates` or `` `/api/admin/exchange-rates `` (nothing else, no `window.fetch` to another path);
  - (Dev addition, keeps what G-5 pinned) no `console.` and the module name `AdminExchangeRates` present.
  - A planted control per rule that must trip, plus a commented-out offender that must not.
- **G-4 stays**, but its matcher must stop matching the new API path, because `/api/admin/exchange-rates` contains the substring `/admin/exchange-rates` (see O-2). The page-route match becomes "`/admin/exchange-rates` not preceded by `/api`"; a planted control proves the API path is ignored and a `<Link href="/admin/exchange-rates">` still trips.
- G-2 and the sidebar `UNLISTED` entry: unchanged.
- File header comment amended to record the slice 1a change (BD-55, SA-R3).

Other pins:

- `KpiStrip.callers.pin.render.test.tsx`: new `A2 ExchangeRatesKpis loading`, `A2 ExchangeRatesKpis` (some stale) and `A2 ExchangeRatesKpis none stale` cases with their hashes; existing hashes untouched (see O-3).
- `layoutFolder.guard.test.ts` part (b): register `/admin/exchange-rates (Exchange rates)` with the page and its component files (shared header imported, no own `<h1`, no direct `.json(`, alias-only imports).

### 5.7 `CurrencyService.ts` (SA-R12, SQ-1)

- Import `clientLogger` from `@/lib/logger/client` (the browser-safe export used by `components/v2/UserMenu.tsx`, `components/UserProvider.tsx` and the admin client pages; it is the shared Pino logger with `browser.asObject`, safe in the browser and on the server, where `currencyHelpers` type-imports the file). `const logger = clientLogger.child({ service: 'CurrencyService' })`.
- The 9 calls become structured: `logger.error({ err: error }, 'Failed to fetch exchange rates')`, `logger.error({ err: error, currencyCode }, ...)`, `logger.info({ currencyCode, updatedBy }, 'Exchange rate updated')` (no emoji, no interpolated values), `logger.info({ provider }, 'Exchange rates updated from API')`, `logger.error({ err: error, userId }, 'Failed to update user currency preference')`, `logger.error({ err: auditError }, 'Audit trail write failed')`, `logger.info({ userId, currencyCode }, 'User currency updated')`.
- Header note (SQ-1): `updateRate` and `updateRatesFromApi` are browser-side writers left in place and unwired (D-1); they stop working once slice 1b revokes client writes; they must not be wired again; the admin route `PATCH /api/admin/exchange-rates/[currencyCode]` is the only writer. Do not extend this service (legacy, direct Supabase outside `lib/repositories/`).
- No behaviour change: same queries, same return values.

---

## 6. Files to create / modify

| File | Action | Reason |
|---|---|---|
| `lib/admin/exchangeRates/exchangeRateRules.ts` | create | Pure Zod schemas, bounds, `sameRate`, `isStale`, wire types (§5.1); folder renamed from `exchange-rates` (DV-1) |
| `lib/admin/exchangeRates/__tests__/exchangeRateRules.test.ts` | create | Every accepted / refused rate shape, bound edges, `sameRate`, `isStale` at 35 days ± 1 s |
| `lib/repositories/ExchangeRatesRepository.ts` | create | Repository with the rule-4 header (SA-R6, SA-R7) |
| `lib/repositories/__tests__/ExchangeRatesRepository.test.ts` | create | One test per method incl. not-found, error path, and the `updated_by` + `last_updated_at` pin |
| `lib/repositories/types.ts` | modify | `ExchangeRateRow`, `ExchangeRateHistoryRow` |
| `lib/repositories/index.ts` | modify | Export class, singleton, types |
| `app/api/admin/exchange-rates/route.ts` | create | `GET` (SA-R4) |
| `app/api/admin/exchange-rates/__tests__/route.test.ts` | create | GET happy path, 401, 403, repository failure, `requireAdmin`-first source check |
| `app/api/admin/exchange-rates/[currencyCode]/route.ts` | create | `PATCH` (SQ-3, SQ-5, SA-R8, SA-R9) |
| `app/api/admin/exchange-rates/[currencyCode]/__tests__/route.test.ts` | create | PATCH cases in §8.1 |
| `lib/audit/events.ts` | modify | Two events + metadata |
| `lib/audit/eventAudience.ts` | modify | Both events `'shared'` |
| `lib/audit/__tests__/eventAudience.test.ts` | modify | Split pin +2 shared (DV-4) |
| `lib/audit/types.ts` | modify | `'exchange_rate'` entity type |
| `lib/audit/ownerVisibility.ts` | modify | `exchange_rate: 'owner'` with reason (no owner-policy migration) |
| `app/admin/exchange-rates/page.tsx` | modify (rewrite) | Renders the view; REDUNDANT header removed |
| `app/admin/exchange-rates/components/ExchangeRatesView.tsx` | create | Read, refresh, edit, toggle, states |
| `app/admin/exchange-rates/components/ExchangeRatesKpis.tsx` | create | "Stale rates" tile on `KpiStrip` |
| `app/admin/exchange-rates/components/ExchangeRatesTable.tsx` | create | Rates table, Stale / Enabled chips, edit and toggle controls |
| `app/admin/exchange-rates/components/RateHistoryTable.tsx` | create | Newest 50 changes |
| `app/admin/exchange-rates/__tests__/exchangeRates.render.test.tsx` | create | jsdom: stale chip + KPI count, save success, save failure keeps old value, USD has no edit / switch-off, toggle |
| `app/admin/__tests__/redundantPages.source.guard.test.ts` | modify | G-6 replaced; G-1/G-3/G-5 drop Exchange rates; G-4 matcher (O-2) |
| `app/admin/components/layout/__tests__/KpiStrip.callers.pin.render.test.tsx` | modify | New caller cases (SQ-7, O-3) |
| `app/admin/components/layout/__tests__/layoutFolder.guard.test.ts` | modify | Register the migrated page |
| `lib/services/CurrencyService.ts` | modify | 9 `console.*` → `clientLogger`; SQ-1 header note |
| `docs/workplans/ADMIN_EXCHANGE_RATES_SLICE_1A_WORKPLAN.md` | create | This workplan |

**Not touched:** `app/admin/components/AdminSidebar.tsx`, `AdminSidebar.nav.test.ts`, `lib/business-os/finance/**` and `finance.source.guard.test.ts`, `app/admin/finance/**` and its guard, `components/settings/CurrencySelector.tsx`, `lib/utils/currencyHelpers.ts`, `scripts/check-bos-exchange-rates-write-access.sql`, `supabase/migrations/**`, `lib/business-os/entitlements/**`, `CLAUDE.md`. The requirement MD is updated by TL / BA with this slice's progress (not by this workplan task).

---

## 7. Task list

- ✅ Step 0: §3 read-only queries run by TL on `jgccgkyhpwirgknnceoh` 2026-10-19; results in §3; SA ruled O-1 (§10)
- ✅ Step 1: baseline on the unchanged tree (2026-10-19): narrow Jest set (existing suites only) **42 suites / 2,567 tests passed**; narrow `tsc` exit 2 with **3 pre-existing errors**, none in a touched file (`lib/pilot/insight/MemoryManager.ts` ×2, `lib/repositories/CalibrationSessionRepository.ts` ×1, reached through imports)
- ✅ Step 2: `exchangeRateRules.ts` + its unit test (O-1 pattern, `> 0` on the string, edges per §8.1)
- ✅ Step 3: row types in `lib/repositories/types.ts`; `ExchangeRatesRepository.ts` (+ wire mappers, `is_enabled` null → false); export from `index.ts`; repository unit test (incl. `updated_by` + `last_updated_at` pin and the null → false pin)
- ✅ Step 4: audit registrations: `events.ts`, `eventAudience.ts` (`'shared'`), `types.ts`, `ownerVisibility.ts` (`'owner'`); `eventAudience.test.ts` split pin +2 shared; `lib/audit/__tests__` green
- ✅ Step 5: `GET` route + test (logs `{ failed: 'rates' | 'history' }`)
- ✅ Step 6: `PATCH` route + test (every §8.1 case)
- ✅ Step 7: page rewrite + `components/` + render test
- ✅ Step 8: guards: `redundantPages` (G-6 replaced over `app/admin/exchange-rates/**` except `__tests__`, G-1/G-3/G-5 dashboard only, G-4 matcher "not preceded by `/api`" with controls both ways), `KpiStrip.callers.pin` (additions only: 29 / 0 lines), `layoutFolder` registry entry
- ✅ Step 9: `CurrencyService.ts`: 9 `console.*` → `clientLogger.child({ service: 'CurrencyService' })`, SQ-1 header note; no behaviour change; `CurrencySelector` unchanged
- ✅ Step 10: final checks (results in §7.1)

### 7.1 Implementation notes and deviations (Dev, 2026-10-19)

**Final results.**
- Narrow Jest set (§8.2 plus `lib/archiving` and `app/admin/audit-trail/__tests__/filterOptions.guard.test.ts`, the other `AUDIT_ENTITY_TYPES` consumers): **50 suites / 2,785 tests passed**. `lib/repositories/__tests__` in full: 113 suites / 2,718 passed.
- Narrow `tsc` (scratch tsconfig over the touched files and their imports): exit 2, **3 errors, the same 3 pre-existing ones as the baseline; 0 in any touched file**.
- `eslint` on the touched files: exit 0, 0 errors, 7 warnings, all pre-existing lines (`any` in `lib/audit/types.ts` / `lib/repositories/types.ts`, an unused `_` in `lib/audit/events.ts`).
- `npm run lint:hooks`: exit 0.

**Deviations from §5 / §6 (none changes a ruling).**

| # | Planned | Built | Why |
|---|---|---|---|
| DV-1 | Pure rules under `lib/admin/exchange-rates/` | `lib/admin/exchangeRates/` | The import specifier `@/lib/admin/exchange-rates/...` contains `/admin/exchange-rates`, so every importing file tripped G-4 (not preceded by `/api`). Renaming the folder keeps G-4 exactly as SA ruled (no allow-list) |
| DV-2 | Wire mapping in the route | `toExchangeRateWire` / `toExchangeRateHistoryWire` in `ExchangeRatesRepository.ts` | SA §10 ruling 1 puts the null → false mapping in the repository and pins it with a repository test, while the audit `oldValue` must keep the raw value: the repository returns the raw row and exports the mapper; the route audits `row.is_enabled` and answers with the mapped wire |
| DV-3 | `page.tsx` a server component rendering the view | `page.tsx` starts with `'use client'` | `admin-authz-surface.guard` R8: every render entry point under `app/admin/**` is a client component |
| DV-4 | Not listed | `lib/audit/__tests__/eventAudience.test.ts` split pin 216 → 218, shared 72 → 74, with a dated comment line | The pin counts every registered event; two new `'shared'` events move it |
| DV-5 | `requireAdmin(requestLogger)` with the correlation logger | `requireAdmin(logger.child({ route, method }))` as the literal first statement, `correlationId` child right after | The §8.1 source pin and the caller's rule ("first statement"); the credits accounts and archiving routes use the same shape |
| DV-6 | — | The view re-reads (`GET`) after a successful **rate** save | The trigger adds a history row on a rate change; the toggle is not historised, so it only replaces the row in place |
| DV-7 | — | G-6 (slice 1a) also asserts the folder has exactly 2 `fetch(` calls (one read, one write) and that the page no longer carries the REDUNDANT header | Non-vacuity of the fetch rule; the header removal is SA-R3 |

**Fixes after review (Dev, 2026-10-19; SA code review APPROVED-WITH-CHANGES, QA FAIL on B-1).**

| # | Finding | Fix |
|---|---|---|
| F-1 | B-1 / SA finding 1 (Medium): USD is enabled, dated 2025-11-05 and not editable, so it was Stale forever and the "Stale rates" KPI could never reach 0 | `isRateStale(rate, readAt)` in `exchangeRateRules.ts` returns false for `BASE_CURRENCY`; used by `ExchangeRatesTable.tsx` (chip) and `ExchangeRatesKpis.tsx`. USD is excluded from the stale count and from "of N enabled". Tests: rules unit test (USD old / null date never stale; other codes follow `isStale`) and two render cases (USD with an old date: no chip, "of 2 enabled"; KPI reaches 0 when every editable enabled rate is fresh). The three KpiStrip pin hashes are unchanged (the fixture has no USD row); the pin file still differs from main by additions only |
| F-2 | Two history-limit sources (Low) | `HISTORY_LIMIT` in the rules module is the one value; `ExchangeRatesRepository` imports it (`EXCHANGE_RATE_HISTORY_LIMIT = HISTORY_LIMIT`, kept as the repository's named export) |
| F-3 | `eventAudience.ts` placement (Low) | The two `'shared'` entries moved next to the admin/system `'shared'` block (after `ARCHIVE_RUN_FAILED`) |
| F-4 | Optional: a failed re-read after a save showed a page-level error | `load({ afterSave: true })`: on failure the data stays on screen and a `role="status"` line reads "Saved; could not refresh history" (`REFRESH_AFTER_SAVE_FAILED`); render test added |

QA's probes appended to the two route test files are kept unchanged. Re-run (2026-10-19): the 5 new suites, the KpiStrip pin, `eventAudience`, `redundantPages`, plus `layoutFolder`, `contrast.lf1` and `admin-authz-surface` guards: **11 suites / 903 tests passed**. `eslint` on the touched files: exit 0, no findings.

---

## 8. Tests and commands

### 8.1 Route test cases (§13.3 item 8, §8 slice 1a)

| Group | Case | Expect |
|---|---|---|
| GET | admin, both reads ok | 200, `rates`, `history` (≤ 50), `readAt` ISO |
| GET | signed out / non-admin | 401 / 403; repository not called |
| GET | rates read fails / history read fails | 500, no `details` outside development |
| PATCH happy | rate `"3.71"` on `ILS` | 200; `updateRate('ILS', '3.71', ADMIN.id)`; audit `EXCHANGE_RATE_UPDATED`, `entityId 'ILS'`, details `{ currencyCode, field: 'rate', oldValue, newValue }`; flushed before the response |
| PATCH happy | `enabled: false` on `EUR` | 200; `setEnabled('EUR', false, ADMIN.id)`; audit `EXCHANGE_RATE_ENABLED_CHANGED` |
| PATCH happy | same-value confirm (`"3.650000"` when stored `"3.65"`) | 200, `unchanged: true`; update still runs (date refresh); audit `oldValue === newValue` |
| PATCH happy | audit flush fails | 200 (save stands) |
| PATCH auth | signed out / non-admin | 401 / 403; no read, no update, no audit; body never read |
| PATCH `updated_by` | body carries `updatedBy` / `updated_by` | 400 (strict union), nothing written |
| PATCH invalid code | `usd`, `US`, `USDX`, `12A`, `U$D` | 400, nothing read or written |
| PATCH invalid body | not JSON; `{}`; unknown `field`; both fields; extra key | 400, nothing written |
| PATCH invalid rate | `0`, `0.000000`, `-1`, `"1000000"`, `"1234567"`, `"10000000"`, `"10000000.000001"`, `"123456789"`, `"1.1234567"`, `"1e3"`, `" 1"`, `"1."`, `".5"`, `""`, number `1.2` | 400, nothing written |
| PATCH bound edges | `"999999.999999"` (max), `"0.000001"` (min), `"000150"` (leading zeros) | accepted (SA O-1) |
| PATCH invalid enabled | `isEnabled: "true"` | 400 |
| PATCH base | `USD` rate (any value) / `USD` `enabled: false` | 400; nothing read or written |
| PATCH unknown | `XYZ` | 404; no update, no audit |
| PATCH failure | update error | 500, no audit row, no `details` outside development |
| Source | each handler's first statement is `const gate = await requireAdmin(` | pinned |

Mocks follow `app/api/admin/archiving/runs/__tests__/route.test.ts`: `@/lib/auth` `getUser`, `@/lib/services/AdminAccessService`, `@/lib/logger`, the repository singleton, and `AuditTrailService` with `log` and `flush` both returning resolved promises (the skill's warning on an `undefined` flush).

Repository tests (injected mock client): `listAll` (rows, error), `findByCode` (found, not found → `null`, error), `listRecentHistory` (ordered, limit 50, error), `updateRate` and `setEnabled` (success, not found → `null`, error), and the **pin**: every update payload contains `updated_by === adminId` and `last_updated_at` equal to the injected clock, sent in a single `.update()` call.

### 8.2 Commands

Narrow Jest set (run at Step 1 for a baseline and at Step 10):

```bash
npx jest lib/admin/exchangeRates lib/repositories/__tests__/ExchangeRatesRepository.test.ts app/api/admin/exchange-rates app/admin/exchange-rates app/admin/__tests__/redundantPages.source.guard.test.ts app/admin/components/__tests__/AdminSidebar.nav.test.ts app/admin/components/layout/__tests__ lib/audit/__tests__ lib/business-os/finance/__tests__/finance.source.guard.test.ts app/admin/finance/__tests__/source.guard.test.ts lib/business-os/purge/__tests__/descriptors.invariant.test.ts lib/admin/__tests__/admin-authz-surface.guard.test.ts --ci
```

Type check. A full `npx tsc --noEmit -p tsconfig.json` crashed out of memory on this machine (exit 134, "0 errors" from a crashed process, skill Rule 7) and, at 8 GB, did not finish in 10 minutes. So the check is narrow: a scratch tsconfig (in the session scratchpad, not committed) that `extends` the repo's `tsconfig.json` with `include` set to `next-env.d.ts`, `types/**/*.d.ts` and the files in §6, run as `npx tsc --noEmit -p <scratch>/tsconfig.fx.json`, output filtered to the §6 files and compared with the Step 1 baseline. The exit code is checked, not only the error count. Pass = no new error in a touched file.

Lint: `npx eslint <the §6 .ts/.tsx files>` and `npm run lint:hooks`.

Not needed: `npm run test:bos-entitlements` (no import from `lib/business-os/entitlements/`, SA-R16); `npm run schema:check` is run once at Step 10 as a read-only replay of the new selects, if credentials are available.

---

## 9. Risks and items for SA

| # | Item | Dev proposal | Needs |
|---|---|---|---|
| O-1 | `docs/MULTI_CURRENCY_SYSTEM.md` records `rate_to_usd` as `DECIMAL(12,6)`: at most 6 integer digits (max 999,999.999999). SQ-5 approves `^\d{1,8}` and ≤ 10,000,000, and only says the **decimal** cap follows the column. If live matches the doc, a valid-looking `"5000000"` would pass Zod and fail in Postgres (numeric overflow), returning 500 | If Step 0 confirms (12,6): integer digits and the upper bound follow the column too (`^\d{1,6}(\.\d{1,6})?$`, max 999,999.999999). Real rates sit well below (the largest are in the tens of thousands) | SA ruling after Step 0 |
| O-2 | G-4 "stays", but `/api/admin/exchange-rates` contains `/admin/exchange-rates`, so the page's own fetch (and any API path string in code) would trip G-4 | Tighten the page-route matcher to "not preceded by `/api`", with planted controls both ways. Intent of G-4 (no in-app link to the page) is unchanged | SA confirmation at workplan review |
| O-3 | `KpiStrip.callers.pin` says in its header that it was "never edited again" after F-5 and its SHA-256 is recorded in the F-5 workplan. SQ-7 rules that it gains this caller | Append new cases only, keep every existing hash, add one "Amended by Exchange rates 1a (SQ-7)" header line; note in the F-5 workplan is not edited | SA confirms this is the edit SQ-7 meant |
| O-4 | View placed in `app/admin/exchange-rates/components/` now (anticipating SA-R13), so the new G-6 scans the whole page folder, not only `page.tsx` | As written | SA confirmation |
| O-5 | SA-R7: the enable toggle also refreshes `last_updated_at`, so switching a currency off or on clears its Stale status without anyone confirming the rate | Implemented exactly as ruled; noted so it is a known consequence, not a surprise in QA | None unless SA wants to revisit |
| O-6 | Audit audience: no admin-only value exists; `'shared'` is the registry's admin/system bucket. Entity type `exchange_rate` classified `'owner'` (admin's own id as `user_id`, like `ai_pricing` / `archive_run`), which needs no owner-policy migration | As written | SA confirmation |
| R-1 | Race: two admins save the same code at once; the audit `oldValue` comes from the pre-read and may be stale | Accepted per SA-R9: the trigger's history row is the atomic record of the true old rate | None |
| R-2 | `CurrencySelector` (browser) now pulls the Pino logger through `CurrencyService`. It already does (the page and other client components import `@/lib/logger`); `clientLogger` is the established browser-safe path | Render or import check of `CurrencySelector` at Step 9 | None |
| R-3 | The history `GET` and the rates `GET` fail together (one 500) rather than separately | Simple and adequate for 43 + 50 rows; the old page tolerated a history failure | SA may ask for per-block failure |
| R-4 | Full `tsc` cannot run on this machine (§8.2); type errors outside the narrow scope would be missed | Narrow `tsc` over the touched files and their imports | None |
| R-5 | Prod behaviour before 1b: the browser can still write the tables under the `profiles.role` policy; 1a does not close that (1b does) | Out of scope by design (SA-R5) | None |

---

## 10. SA Review Notes

**Reviewed by SA — 2026-10-19 (workplan review, pre-implementation)**
**Status:** ✅ APPROVED-WITH-CHANGES. The workplan follows the §13 rulings faithfully (route conventions, repository header, trigger contract, audit with `logAndFlush`, guards, browser-safe logger). Step 0 is done (§3). Dev applies the changes below while building; no second workplan review is needed. Verified against the tree: `requireAdmin` returns `{ user: { id } }` from Supabase auth, `clientLogger` is exported by `@/lib/logger/client`, `logAndFlush(entry, logger, context)` exists, `AuditAudience` is `'bos' | 'shared' | 'agentspilot'`, and `ai_pricing` / `archive_run` are `'owner'` with the same reasoning.

### Rulings on §9

| # | Ruling |
|---|---|
| O-1 | **Accepted: the integer part follows the column.** Live `rate_to_usd` is `numeric(12,6)` (max 999,999.999999). `RATE_PATTERN = /^\d{1,6}(\.\d{1,6})?$/`, then `> 0`; the pattern alone caps the value below 1,000,000, so `RATE_MAX` is dropped (or kept as the string `'999999.999999'` for the test and the page hint only, never as a second rule). The string compare for `> 0` stays (no `Number`). This amends SQ-5 (amendment recorded in the requirement §13.1). Test edges: accept `"999999.999999"`, `"0.000001"`, `"000150"` (leading zeros are harmless to `numeric`; `sameRate` normalises); refuse `"1000000"`, `"1234567"`, `"10000000"`, plus every existing refusal in §8.1. A value that passes Zod can no longer overflow the column, so no rate input can reach a 500 |
| O-2 | **Confirmed.** G-4's intent is "no in-app link to the page". Tighten the matcher to `/admin/exchange-rates` not preceded by `/api`, with both planted controls (API path ignored; `<Link href="/admin/exchange-rates">` still trips). Do not add an allow-list of files instead: the lookbehind is narrower and self-explaining. Keep the existing control at line 207 green |
| O-3 | **Confirmed — this is the edit SQ-7 meant.** Append cases only; every existing hash byte-identical; one header line "Amended by Exchange rates 1a (SQ-7)". Do not edit the F-5 workplan. QA checks `git diff` on the pin shows additions only |
| O-4 | **Confirmed.** The view lives in `app/admin/exchange-rates/components/` now (SA-R13); the new G-6 walks the whole `app/admin/exchange-rates/` folder excluding `__tests__`. Slice 2 must keep that walk when the page becomes a redirect |
| O-5 | **Ruling stands, with one clarification.** A toggle refreshes `last_updated_at` because the column is "last touched by an admin", and the trigger only historises rate changes. Accepted consequence: switching a currency on clears its Stale chip. To keep that honest, the KPI sub-line and the Stale chip tooltip / `aria` text say "not updated in 35 days", not "rate not confirmed". No schema change; revisit only if the user asks for a separate "rate confirmed at" |
| O-6 | **Confirmed.** `'shared'` audience (admin/system bucket; it is in `OPERATOR_AUDIENCES`, so the admin audit trail shows it). Entity `exchange_rate: 'owner'` with the `ai_pricing` comment form; no owner-policy migration. `userId` = `actorId` = `gate.user.id` |
| R-3 | **Accepted: one 500 for both reads.** 43 + 50 rows from the same client in one request; a per-block degrade adds a partial-state UI and a second error path for no real gain. The `GET` logs which read failed (`{ failed: 'rates' \| 'history' }`) so the cause is not lost. Revisit only if history read failures are seen in practice |

### Additional rulings

1. **`is_enabled` nullable** — The repository maps `null` → `false` on read (`isEnabled: row.is_enabled === true`), matching the only consumer rule in production (`CurrencySelector` / RLS read `is_enabled = true`, so a null row is already invisible to users). The page shows it as "Disabled"; the KPI counts a row as enabled only when `=== true`. The toggle always writes an explicit boolean, so saving a null row heals it. The audit `oldValue` records the **raw** pre-read value (`null` stays `null`) so the trail is truthful. Repository test pins the null → false mapping. Live data today has no information on nulls; Dev may count them in the Step 1 baseline (read-only), not required.
2. **`updated_by` FK → `auth.users(id)`** — Confirmed fine. `requireAdmin` resolves the user through Supabase auth, so `gate.user.id` is an `auth.users.id`; every admin in `admin_users` is an auth user. A non-existent id would fail the FK (23503) and surface as a 500, which cannot happen through the gate. Never from the body (strict union, §8.1 row already pins it).
3. **`decimal_places`** is a per-currency display hint (0..4), **not** the rate's scale. Do not validate the rate against it; display the stored rate string as is (FR-1).
4. **History wire type** keeps `changeReason` (column exists, always null); the history table omits a Reason column. Update §3's "change_reason absent" decision row accordingly (it is present).
5. **`currency_code` DB CHECK** duplicates the Zod rule; Zod stays (rule 2, and it short-circuits before any read).
6. **§5.1 / §8.1 edits required before Step 2:** replace the SQ-5 pattern and `RATE_MAX` lines with O-1; in §8.1 change the bound-edges row to `"999999.999999"` / `"0.000001"` accepted and add `"1000000"` to the refused list.

### Approval
[x] Workplan approved with the changes above — proceed to implementation (Step 1). Code review follows Step 10.

### SA code review

**Code Review by SA — 2026-10-19**
**Status:** 🔄 APPROVED-WITH-CHANGES. Fix finding 1 (and finding 2 if convenient), re-run the narrow Jest set, then go to QA. No second SA pass is needed: QA confirms finding 1 with the tests named there.

Reviewed: `git status --short`, `git diff` (13 modified files) and every new file in the worktree `neuronforge-fx-rates` (`feature/admin-exchange-rates-1a` at `4583d21e`, uncommitted). SA re-ran the §8.2 narrow Jest set: **46 suites / 2,669 tests passed**, including `admin-authz-surface.guard`, `finance.source.guard`, `app/admin/finance/__tests__/source.guard` and `AdminSidebar.nav`.

#### Rulings on the deviations (§7.1)

| # | Ruling |
|---|---|
| DV-1 | **Accepted.** Renaming the folder to `lib/admin/exchangeRates/` keeps G-4 exactly as ruled in O-2 (lookbehind, no allow-list). The camelCase folder matches `lib/admin/` neighbours (`requireAdminRoute.ts`, `billing/`) |
| DV-2 | **Accepted.** The mappers sit next to the row types they read, and this split keeps the raw `is_enabled` for the audit while the wire reads null as false (§10 ruling 1). The repository type-imports the wire types from the pure rules module, which is a server → pure dependency, so there is no cycle and nothing leaks to the client. The mappers are pure functions, so slice 2 can reuse them as they are |
| DV-3 | **Accepted.** `admin-authz-surface.guard` R8 requires it, and the page holds no data access. Gating stays with the admin layout (`requireAdminPage`) |
| DV-4 | **Accepted.** 216 → 218 and shared 72 → 74, with the dated reason line. That is the pin doing its job |
| DV-5 | **Accepted.** `requireAdmin(logger.child({ route, method }))` is the literal first statement in both handlers and matches `app/api/admin/archiving/runs/route.ts:108`. Cost: a 401 / 403 log line has no `correlationId`. That is acceptable, because the gate logs only `userId` and the refusal is audited by `recordRefusedAccess` |
| DV-6 | **Accepted.** The trigger adds a history row only on a rate change, so the re-read is limited to rate saves. The row is already replaced from the PATCH answer before the re-read, so the user sees the new value straight away. See Optimisation Suggestions for what happens when the re-read fails |
| DV-7 | **Accepted.** The extra asserts make the guard stronger: exactly 2 `fetch(` calls stops the rule passing on nothing, and the page must not contain `REDUNDANT` (SA-R3). Slice 2 changes the fetch count only if it adds a call site. It must update the pin in the same change and say why |

#### Focus checks

| Check | Result |
|---|---|
| `requireAdmin` first statement, both handlers | ✅ `route.ts:54` (GET) and `[currencyCode]/route.ts:63` (PATCH); pinned by source tests in both test files. Nothing reads the body, path or database before it |
| Strict Zod union; `updated_by` never from the body | ✅ `exchangeRateRules.ts:55-58`: `discriminatedUnion('field', [...strict(), ...strict()])`. `updatedBy` / `updated_by` / extra keys are refused with 400 and nothing touched (route test `body:` cases). `adminId = gate.user.id` (`[currencyCode]/route.ts:67`), source-pinned |
| String-only rate checks | ✅ `RATE_PATTERN` `^\d{1,6}(\.\d{1,6})?$` + `/[1-9]/` for `> 0`; a JSON number is refused (`rate as a number`). `sameRate` normalises strings; no `Number(` / `parseFloat` / `toFixed` anywhere in the rules or the view. Reads cast `::text` |
| USD cannot be edited or disabled | ✅ `[currencyCode]/route.ts:91-98`, pure, before any read; tests cover `1`, `1.000000`, `2` and `isEnabled:false`, with nothing read. `isEnabled:true` is allowed (harmless). The UI shows no Edit or Switch control for USD |
| Unknown code → 404 | ✅ pre-read `null` → 404, and an update that matches no row → 404. Neither writes an audit row (both tested) |
| Single UPDATE sets `updated_by` + `last_updated_at` | ✅ `ExchangeRatesRepository.ts:174-183`: one `.update({ ...change, last_updated_at, updated_by })`. The toggle goes through the same path. The repository test pins the payload and the injected clock. No `.or()` in the chain |
| Audit via `logAndFlush`, never failing the save | ✅ awaited before the 200 (WC-7), bounded at 2 s, and it never throws (`boundedAuditFlush.ts:205-222`). The "audit failure does not fail the save" test passes. `details` is exactly `{ currencyCode, field, oldValue, newValue }`, with the raw old `is_enabled`. No audit row is written on a 4xx or 5xx |
| Error format, dev-only details | ✅ `fail()` / `readFailed()` send `details` only when `NODE_ENV === 'development'`. Zod issues are flattened, so messages are logged and never the values sent. Tested |
| No Supabase in the client folder | ✅ G-6 (slice 1a) walks every non-test file under `app/admin/exchange-rates/` and bans `@/lib/supabase*`, `@supabase/`, `.from(`, `CurrencyService`, outside hosts and `console.`, with a planted control for each rule |
| `CurrencyService` browser-safe | ✅ 9 → 0 `console.*`; `clientLogger.child({ service: 'CurrencyService' })` from `@/lib/logger/client`, the same export `UserMenu` / `UserProvider` use. Queries and return values are unchanged. The SQ-1 header note is present. Messages are structured, with no emoji |
| `CurrencySelector` unaffected | ✅ by code: `components/settings/CurrencySelector.tsx` is untouched and the public API of `CurrencyService` is unchanged. No Jest test covers it, so **QA confirms in the browser** (item Q-2) |
| `KpiStrip.callers.pin` additions only | ✅ `git diff --numstat`: **29 / 0**. Every existing hash is byte-identical. The header line is "Amended by Exchange rates 1a (SQ-7)" |
| Guards not weakened | ✅ G-1 / G-3 / G-5 keep the dashboard unchanged. G-2 and the sidebar `UNLISTED` entry are untouched. G-4 relaxes only for a match preceded by `/api`, with controls both ways, and still catches `router.push('/admin/exchange-rates?x=1')`. G-6 now covers the whole folder instead of one file. The old write-token bans (`.update(` / `.rpc(`) are covered because a Supabase client import and `.from(` are banned outright. `finance.source.guard` and the finance source guard are unchanged |
| Entitlements / LLM / queues | ✅ no import from `lib/business-os/entitlements/`, no LLM call, no cron or queue (SA-R16) |

#### Race between the pre-read and the update

The pre-read (`findByCode`) and the UPDATE are two statements, so a second admin's save can land between them. **The table stays correct.** The last write wins, each UPDATE is atomic, and the trigger writes the history row from `OLD` / `NEW` inside the UPDATE, with the true old rate and the right `changed_by`. Two things can be stale: the audit `oldValue`, and `unchanged`. `unchanged` only feeds a client log line. **This does not matter here.** The table is global, maintained by hand by a handful of admins, has no add or delete in scope (R-1) and converts no money (D-5). SA-R9 already names the trigger row as the atomic record of the old rate, and the code comment at `[currencyCode]/route.ts:125-126` says so. Making it atomic would need an RPC that returns `OLD`, which is a new SECDEF-adjacent pattern and is not justified. **No change.** Revisit only if rates ever drive a money figure (slice 4).

#### Code Review Comments

1. `lib/admin/exchangeRates/exchangeRateRules.ts:83` (with `ExchangeRatesKpis.tsx:30` and `ExchangeRatesTable.tsx:135`): **the USD row is Stale forever.** USD is enabled and last touched 2025-11-05 (requirement §2.1, "every `last_updated_at`"). The UI offers no Edit or Switch for it, and the route refuses a USD rate. So its Stale chip can never clear, and the "Stale rates" KPI can never reach 0 or leave amber, even after every other rate is updated. Only a hand-crafted `PATCH { field:'enabled', isEnabled:true }` would refresh it. A rate fixed at 1 by definition cannot go stale, so this is my own SQ-7 wording gap ("enabled rates"), not a Dev error. **Fix:** in the rules module, add one helper used by both the table and the KPI, for example `isRateStale(rate: ExchangeRateWire, readAt)`, which returns `false` for `BASE_CURRENCY` and otherwise calls `isStale`. Leave the base row out of both the stale count and the "of N enabled" denominator, so the sub-line reads "of N enabled" over editable currencies only. Tests: a rules unit test (USD with a 2025 date is not stale), and a render-test case (USD row with an old date has no `stale-USD` chip and the KPI does not count it). The `KpiStrip` pin fixture has no USD row, so its three new hashes must stay unchanged; QA confirms. Acceptance §8 "every rate last touched 2025-11-05 shows as Stale" is read as every rate an admin can update. — Priority: **Medium (fix required)**
2. `lib/admin/exchangeRates/exchangeRateRules.ts:27` vs `lib/repositories/ExchangeRatesRepository.ts:62`: `HISTORY_LIMIT` is exported but used nowhere (dead code), while the repository defines its own `EXCHANGE_RATE_HISTORY_LIMIT = 50`. That gives two sources for one number. **Fix:** keep one. Either the repository imports `HISTORY_LIMIT` from the pure rules module, which it already type-imports, or delete the rules constant. — Priority: Low
3. `lib/audit/eventAudience.ts:177-179`: the two new entries sit between `BOS_QUEUE_ITEM_RETRIED` and `BOS_BILLING_CHECKOUT_STARTED`, inside the Business OS run. They work, but a reader scanning the BOS block finds two `'shared'` platform events there. Optional: move them next to the other admin/system `'shared'` entries. Not blocking. — Priority: Low

#### Optimisation Suggestions

- `ExchangeRatesView.tsx:120`: if the re-read after a successful rate save fails, `load()` shows the page-level error banner and hides the KPI, although the save stood and the row is already updated. Optional: on the post-save re-read only, keep the current payload and show a short "Saved; could not refresh history" line instead. Not required for 1a.
- DV-5 trade-off: if correlated refusal logs are ever wanted, pass `logger.child({ route, method, correlationId })` to the gate, reading the header first. Reading a header is not a body or database touch, but it breaks the literal "first statement" pin, so leave this unless the pin is re-ruled.

#### For QA (no code change)

- **Q-1** Live smoke on a real admin session: `GET` returns `rateToUsd` as text such as `"3.650000"`, and a `PATCH` answer carries the updated row. The unit tests mock the Supabase client, so they cannot prove that PostgREST keeps the key `rate_to_usd` for `rate_to_usd::text` in both `.select()` and `.update().select()`. §7.1 does not record whether `npm run schema:check` was run (§8.2). Record its result, or the live smoke, in §11.
- **Q-2** `CurrencySelector` (settings) still lists the enabled currencies in the browser, with no console errors from `clientLogger` (R-2).
- **Q-3** After finding 1: USD shows no Stale chip, and the KPI counts only editable enabled rates. A same-value save ("confirmed") clears a row's Stale chip and adds no history row. A toggle refreshes the date (O-5).

### Code Approved for QA: Yes, after finding 1 is fixed (finding 2 is recommended in the same pass; finding 3 is optional)

---

## 11. QA Testing Report

### QA report

**QA — 2026-10-19**
**Test mode:** full
**Strategy used:** A (unit: rules, repository) + B (route integration with mocked auth and repository, and the real `logAndFlush`) + source guards + one read-only live select replay (Q-1). D (manual browser check) is **still owed: TL runs it**
**Focus:** api, ui, schema, security
**Skipped:** the manual browser check (owed by TL, see below). `test:bos-entitlements` was not triggered: there is no import from `lib/business-os/entitlements/` (SA-R16)
**Input source:** TL prompt + SA "For QA" items Q-1 to Q-3
**Tree:** worktree `neuronforge-fx-rates`, branch `feature/admin-exchange-rates-1a`, uncommitted. QA changed no product code. QA added tests only in the two new route test files.

**Verdict: FAIL — SA code-review finding 1 is not fixed on this tree.** SA's gate reads "Code Approved for QA: Yes, after finding 1 is fixed". It is still open (Bug B-1). Everything else passes. Once B-1 is fixed with the tests SA named, QA expects PASS-WITH-NOTES, and only B-1's tests and Q-3 need a re-run.

#### Counts

| Run | Result |
|---|---|
| §8.2 narrow set, re-run independently with `--ci` (before QA additions) | **47 suites / 2,742 tests passed**, 0 failed. Dev's 50 / 2,785 also counted `lib/archiving` and `filterOptions.guard`, which are outside the §8.2 command. SA's 46 / 2,669 was an earlier tree |
| The 5 new suites, before QA additions | 5 / 157 passed |
| The 5 new suites, after QA additions | **5 / 190 passed** (+33 QA probes) |
| Named source guards, run on their own (`redundantPages`, `AdminSidebar.nav`, `layoutFolder`, `KpiStrip.callers.pin`, `admin-authz-surface`, `finance.source.guard`, the `app/admin/finance` source guard, `descriptors.invariant`, `eventAudience`) | **9 suites / 2,080 tests passed** |
| `eslint` on the two edited test files | clean |

#### Acceptance criteria (requirement §8, slice 1a)

| Acceptance criterion | Tested? | Result | Notes |
|---|---|---|---|
| Admin opens `/admin/exchange-rates`; a non-admin is refused by the admin layout guard | ⚠️ | Not run | The layout guard is unchanged. `page.tsx` is a client entry (DV-3), and `admin-authz-surface` passes. **Manual browser check owed (TL)** |
| All 43 currencies, last updated in UTC; the 2025-11-05 rows are Stale; the stale count is visible | ❌ | **Fail (B-1)** | Unit and render tests pass, and the live read returns 43 rows. But USD (enabled, live `last_updated_at` 2025-11-05) is counted Stale and can never clear, so the KPI cannot reach 0. SA reads the criterion as "every rate an admin can update" |
| Edit a rate and save: it updates, "last updated" refreshes, Stale clears | ✅ | Pass (mocked) | Render test "saves through PATCH, replaces the row and clears its Stale chip"; PATCH happy path; repository pin on `last_updated_at`. Live check owed |
| Switch a currency off and on; the change persists | ✅ | Pass (mocked) | PATCH toggle, render toggle, repository `setEnabled`. Persistence needs the live check |
| The USD rate cannot be edited | ✅ | Pass | PATCH: USD rate `1`, `1.000000`, `2` → 400 with nothing read; USD disable → 400; render: USD has no Edit and no Switch off. QA added USD + `isEnabled: "false"` → 400 (refused by Zod first) |
| Page source: no Supabase client and no direct table write (Jest source guard) | ✅ | Pass | `redundantPages` G-6 (slice 1a) walks the whole folder, with a planted control per rule. There are exactly 2 `fetch(` calls, both to `/api/admin/exchange-rates` |
| Route tests: happy path; auth failure with nothing written; invalid input → 400 with nothing written; unknown code → 404 | ✅ | Pass | Every §8.1 row is present. QA added the probes listed below |
| Repository tests: one per method, incl. not found | ✅ | Pass | All 5 methods: found, not found, error, thrown. Also the single-UPDATE pin on `updated_by` + `last_updated_at`, and the null → false mapping |
| One audit entry per change, with old and new values; an audit failure does not fail the save | ✅ | Pass | Shape pinned (SA-R9). Order is `findByCode → update → audit.log → audit.flush`; a flush rejection still returns 200. QA added: exactly 1 entry per change, and a `log()` rejection still returns 200 |
| 0 `console.*` in `CurrencyService.ts` (9 moved to the browser-safe logger); the page stays at 0, pinned by the guard that replaces G-6 | ✅ | Pass | `grep -c console.` = 0; uses `clientLogger.child({ service: 'CurrencyService' })`. The code diff is logging only. G-6 bans `console.` in the folder |
| `finance.source.guard` unchanged and green; no `lib/business-os/` file imports the repository or `CurrencyService` directly | ✅ | Pass | Both finance guards are green and absent from the diff. A grep under `lib/business-os/` finds no direct import |
| `CurrencySelector` still lists enabled currencies | ⚠️ | Not tested | No Jest test covers `CurrencySelector`. By code review the `CurrencyService` change is logging only (same queries, same return values). **Manual check owed (TL), SA Q-2** |

#### SA "For QA" items

| # | Result |
|---|---|
| Q-1 (live shape of `::text` selects) | **Partly verified, read-only.** `npm run schema:check` cannot see the new selects: the repository passes the column-list constants `RATE_COLUMNS` / `HISTORY_COLUMNS`, which is the script's documented "non-literal select" blind spot, so its exit 1 lists only pre-existing failures elsewhere. QA then replayed `RATE_COLUMNS` with the service role as one read-only `select` (2026-10-19, no write). It returned no error and **43 rows**, with the keys `id, currency_code, currency_name, currency_symbol, rate_to_usd, is_enabled, decimal_places, last_updated_at, updated_by`. So PostgREST keeps the `rate_to_usd` key for `rate_to_usd::text`, and the value is a **string** (`USD` → `"1.000000"`). A second replay, needed for the history select and the enabled / null counts, was **blocked by the session's permission policy on production reads**, so it was not run. **Still owed:** the history select shape, and the `.update().select()` answer shape. The latter is a write, so it is covered by the manual check (step 3 below) |
| Q-2 (`CurrencySelector` in the browser) | Owed (manual check step 7) |
| Q-3 (after finding 1) | **Blocked by B-1.** The same-value save and the toggle date refresh pass at route level (QA probe and the existing test). The USD part cannot pass until B-1 is fixed |

#### Edge-case probes (QA added 33 cases, in the new test files only)

All of them passed on the first run, so none found a bug. They are in `app/api/admin/exchange-rates/[currencyCode]/__tests__/route.test.ts` and `app/api/admin/exchange-rates/__tests__/route.test.ts`, each under `describe('QA probes')`.

| Probe | Already covered by Dev | QA added | Result |
|---|---|---|---|
| Lowercase or mixed-case code in the path | `usd` | `eur`, `Ils` | 400, nothing read |
| Code that is not 3 letters | `US`, `USDX`, `12A`, `U$D` | `E1R`, `EU`, `EURO`, `E R`, `''` | 400, nothing read |
| Rate `"0"`, `"0.000000"`, `"-1"`, `" 1"`, `"1e3"`, `""`, number `1.2` | yes | `"0.0000000"` (7 decimals), `"000000.000000"`, `"1\n"`, an Arabic-Indic digit, integer `1`, `null`, missing | 400, nothing written |
| Extra body keys | `updatedBy`, `updated_by`, `note` | `user_id`, `currencyCode`, `last_updated_at`; a JSON array body; a bare string body | 400, nothing written |
| `isEnabled` not a boolean | `"true"` | `1`, `0`, `null`, `"false"`, missing | 400 |
| Disable USD / edit the USD rate | yes | USD + `isEnabled: "false"` | 400 |
| Same-value save | rate (`3.650000`, `3.65`) | enabled `true` over `true`: the update runs, `unchanged: true`, audit old === new | 200 |
| Non-admin: nothing written, no audit | yes (rate body) | 401 and 403 with a garbage body on USD: the gate answers first, nothing is read, no audit | 401 / 403 |
| GET when the history read fails | `{ error }` result | the history read **rejects**; the history read returns `{ data: null, error: null }`; a source check that the route never reads the query string | 500, body exactly `{ success: false, error }` |
| Thrown repository error on PATCH | — | `findByCode` rejects | 500, no `details`, no internal text |

#### CI-parity checks

| Check | Result |
|---|---|
| Source guards listed in the brief | All green (9 / 2,080, table above) |
| CRLF safety | The working files are LF: Dev wrote LF, and with `core.autocrlf=true` a fresh Windows checkout will be CRLF. No new or changed test scans for `'\n}'`: `grep -F '\n}'` over every touched test file finds 0 hits. G-1 splits on `\r?\n`; G-4 and G-6 are substring or regex scans after `stripComments`; the two `requireAdmin`-first source pins use `[^\n]*\n`, which absorbs `\r`. **Run empirically:** a scratch script (session scratchpad, not committed) ran the exact G-6 bans, fetch rule, module-logger rule, G-4 page-link rule and both source pins on LF and on CRLF copies of every scanned file. The results were identical: no bans, 2 fetches, 0 stray, logger found, pins true. A planted outside-host control still tripped under CRLF. **Line-ending-safe** |
| `git diff` of `KpiStrip.callers.pin.render.test.tsx`: additions only | `--numstat` **29 / 0** and no `-` lines, so additions only (SA O-3) |
| `git diff --numstat` sanity (truncation hazard) | The only file with far more deletions than insertions is `page.tsx` (9 / 355), which is the planned move into `components/` |

#### Issues found

**Bugs (must fix before commit)**

1. **B-1 — The USD row is Stale forever, so the "Stale rates" KPI can never reach 0** (SA code-review finding 1, still unfixed). Files: `app/admin/exchange-rates/components/ExchangeRatesKpis.tsx:29-30`, `app/admin/exchange-rates/components/ExchangeRatesTable.tsx:135`, and `lib/admin/exchangeRates/exchangeRateRules.ts`, which has no base-currency-aware helper. Severity: **Medium**.
   - Steps to reproduce: load the page with live data. The live read confirms USD `is_enabled = true` and `last_updated_at = 2025-11-05T19:03:12Z`. Update every other enabled rate.
   - Expected: USD shows no Stale chip; the KPI reads 0 and is not amber; "of N enabled" counts editable currencies only.
   - Actual: `ExchangeRatesKpis` counts every `isEnabled === true` row through `isStale`, USD included. The table calls `isStale` for USD too. USD has no Edit or Switch control and the route refuses a USD rate, so nothing in the UI can clear it, and the KPI stays at ≥ 1 and amber.
   - Fix and tests: as SA specified in §10 finding 1. Add `isRateStale(rate, readAt)`, which returns false for `BASE_CURRENCY`, and use it in the table and the KPI. Leave USD out of the denominator. Add a rules unit test, plus a render case where a USD row with an old date has no `stale-USD` chip and is not counted. The three `KpiStrip` pin hashes must stay unchanged; QA re-checks them.

**Performance issues:** none.

**Notes / edge cases (none blocking)**

1. **N-1 — SA finding 2 is still open (Low):** `HISTORY_LIMIT` (`exchangeRateRules.ts:27`) is unused, and the repository has its own `EXCHANGE_RATE_HISTORY_LIMIT` (`ExchangeRatesRepository.ts:62`).
2. **N-2 — The gate's refusal logs carry no `correlationId`** (DV-5, accepted by SA): `route.ts:54`, `[currencyCode]/route.ts:63`. Recorded for awareness only.
3. **N-3 — No automated test covers `CurrencySelector`.** The criterion rests on code review plus the manual check.
4. **N-4 — A toggle clears Stale (O-5, by ruling).** Listed so the manual tester does not report it as a bug.
5. **N-5 — Live data:** the live read returned `ILS` with `rate_to_usd = "1.000000"`. This is a data value, not a code defect. It is worth a look during the manual check, because ILS is the example currency in the tests and in the first real edit.

#### Manual browser check — OWED (TL)

QA did not run this. TL records the steps and results here.

1. Sign in as a platform admin and type `/admin/exchange-rates`. The page opens with 43 rows and dates in UTC. The 2025-11-05 rows show "Stale" (USD excepted, after B-1), and the KPI shows the enabled stale count.
2. Sign in as a non-admin and type the URL. The layout guard refuses.
3. Edit a non-USD rate and save. The rate, "last updated" and the history panel refresh, Stale clears, and the answer carries the rate as a string (Q-1 update shape).
4. Type an invalid rate (for example `0`). Either Save is disabled or the server refuses with a short message; the old value stays.
5. Switch a currency off, refresh the page (it stays off), then switch it back on.
6. USD has no Edit and no Switch off.
7. Open the settings page where `CurrencySelector` renders. It still lists the enabled currencies, with no console errors (Q-2).
8. The sidebar does not list the page (D-6).

#### Final status
- [ ] All acceptance criteria pass — ready for commit
- [x] Issues found — Dev must fix B-1, then QA re-runs the B-1 tests and the `KpiStrip` pin, and TL runs the manual browser check

---

## 12. Commit Info

- Branch: `feature/admin-exchange-rates-1a`
- Commit: `22d61fec` (feat), merged `origin/main` `c60e2f93` (MK-4 #476) cleanly, guards re-run 43/1,228 green
- PR: [#477](https://github.com/AgentsPilot/neuronforge/pull/477), merge commit (no squash), auto-merge on; CI is the only gate (user approved 2026-10-19, no migration)

---

## Change History

| Date | Change | Details |
|---|---|---|
| 2026-10-19 | Created | Dev workplan for slice 1a from the requirement as cleared by SA (§13) with SA-R1 / SA-R2 applied. Verbatim scope in §1. Step 0 (live column type) is blocking and not yet run; six items for SA (O-1 to O-6) |
| 2026-10-19 | Implemented (Code Complete) | §5.1 / §8.1 updated to SA O-1 before Step 2; Steps 1-10 done; results and deviations DV-1 to DV-7 in §7.1. Uncommitted |
| 2026-10-19 | Step 0 recorded; SA workplan review | Step 0 results from TL (live, read-only) recorded in §3: `rate_to_usd numeric(12,6)` (max 999,999.999999), `currency_code` unique + `^[A-Z]{3}$` CHECK, `is_enabled` nullable, `updated_by` FK `auth.users`, no `last_updated_at` UPDATE trigger, `change_reason` present but unused; 43 rows / 16 enabled / 15 history. SA verdict **APPROVED-WITH-CHANGES** (§10): O-1 rate pattern `^\d{1,6}(\.\d{1,6})?$` and `> 0` (amends SQ-5); O-2 to O-6 confirmed (O-5 with wording clarification); R-3 accepted (one 500, log which read failed); `is_enabled` null → false; `updated_by` FK confirmed |
| 2026-10-19 | SA code review | **APPROVED-WITH-CHANGES** (§10 "SA code review"). DV-1 to DV-7 accepted. Every focus check passed (gate first in both handlers, strict union, string-only rates, USD refused, 404, single UPDATE, `logAndFlush`, dev-only details, G-6 folder walk, `clientLogger`, KpiStrip pin 29 / 0). Narrow Jest re-run 46 / 2,669 passed. Pre-read / update race: does not matter here, no change. Fix required: finding 1, USD counted Stale forever (KPI can never reach 0). Low: duplicate / dead `HISTORY_LIMIT`; optional `eventAudience` placement. QA items Q-1 to Q-3 |
| 2026-10-19 | QA report (§11) | QA verdict **FAIL**: SA finding 1 (USD Stale forever, KPI never 0) is still unfixed (B-1, Medium). Otherwise green: §8.2 narrow set re-run with `--ci` 47 suites / 2,742 passed; 33 edge-case probes added to the two new route test files (new suites 5 / 190); named source guards 9 / 2,080; guards line-ending-safe on CRLF copies; `KpiStrip` pin diff additions only (29 / 0). Q-1 partly verified (live read-only rates select: `rate_to_usd` key kept, string value, 43 rows); history select shape not verified. Manual browser check owed by TL |
