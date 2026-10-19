# Requirement: Admin Exchange Rates Page

> **Last Updated**: 2026-10-19

**Created by:** BA
**Date:** 2026-10-19
**Status:** Draft. User decisions recorded 2026-10-19 (§3). **SA requirement review 2026-10-19: CLEARED-WITH-CHANGES (§13)** — BA must apply SA-R1 and SA-R2 (stale baseline, BD-34 / BD-36 reversal) before Dev writes the workplan. **BA applied SA-R1 and SA-R2 on 2026-10-19** (§2.2 and §5.1 rewritten from `origin/main` `4583d21e`; the reversal recorded as BD-55 in the finance requirement, FF-2 superseded by slice 1b). Final status "Approved" needs user or TL sign-off.
**Related:** [BUSINESS_OS_FINANCE_HEALTH_REQUIREMENT.md](/docs/requirements/BUSINESS_OS_FINANCE_HEALTH_REQUIREMENT.md) (BD-12, CUR-3, the Finance page; **BD-55** records the user's 2026-10-19 decision behind this requirement and amends BD-34 / BD-36 for this page; its follow-up FF-2 is superseded by slice 1b here), [ADMIN_LAYOUT_STANDARD_REQUIREMENT.md](/docs/requirements/ADMIN_LAYOUT_STANDARD_REQUIREMENT.md) (closed standard the page follows), [ADMIN_IDENTIFICATION_AND_ACCESS.md](/docs/admin/ADMIN_IDENTIFICATION_AND_ACCESS.md)

## Overview

`/admin/exchange-rates` exists but cannot be trusted or used: all 43 rates were last touched on 2025-11-05, the page is marked redundant and was made read-only (finance BD-34, BD-36), so no admin can update a rate, it still reads both rate tables straight from the browser, and the database still decides who is an admin with `profiles.role`, which the platform has banned as an admin source of truth. This requirement makes the page a **safe, manual, admin-only tool** for keeping a table of exchange rates up to date: an admin opens the page by its URL, edits a rate or switches a currency on or off, and sees how old each rate is. It does **not** convert any money, does **not** produce any USD total and is **not** linked to any customer revenue (user decision D-5). A later slice adds the page as a tab under the Finance admin page, still with no revenue link.

---

## Table of Contents

1. [Progress](#1-progress)
2. [Current state (verified)](#2-current-state-verified)
3. [User decisions](#3-user-decisions)
4. [User stories](#4-user-stories)
5. [Slices](#5-slices)
6. [Functional requirements](#6-functional-requirements)
7. [Non-functional requirements](#7-non-functional-requirements)
8. [Acceptance criteria](#8-acceptance-criteria)
9. [Out of scope / future roadmap](#9-out-of-scope--future-roadmap)
10. [Questions for SA](#10-questions-for-sa)
11. [Open questions (business)](#11-open-questions-business)
12. [Notes on integration points](#12-notes-on-integration-points)
13. [SA requirement review](#13-sa-requirement-review)
14. [Change History](#change-history)

---

## 1. Progress

> Single source of truth for this work. Every SA ruling, PR, merge, migration apply and deferral is recorded here.

| # | Slice | Status | PR | Notes |
|---|---|---|---|---|
| 1a | Safe manual page: server route + repository + page rewired + logging | 🟡 Built, PR open (SA approved, QA PASS after B-1, user click-through passed 2026-10-19) | — | Full cycle (new route, data write, security). Works against today's database policies, so it ships first |
| 1b | Database record + lockdown migration (both tables into the repo, `profiles.role` replaced, browser writes revoked) | ⬜ Not started | — | Full cycle. **User applies the prod migration by hand** — the session stops for that. Applied only after 1a is deployed, so the page never breaks. Supersedes finance follow-up FF-2 (BD-55) |
| 2 | Exchange rates as a tab under the Finance admin page (no revenue link) | ⬜ Not started | — | Full cycle (introduces tabs on `/admin/finance`, a new page shape there) |
| 3 | Month-end rate record, only if §5.4 shows history is not enough | Parked | — | Only if needed |
| 4 | Conversion / USD view | Parked (D-5) | — | Needs a written exception to BD-12 and to CLAUDE.md "never sum money across currencies" first |

---

## 2. Current state (verified)

Live facts were read on 2026-10-18 on project `jgccgkyhpwirgknnceoh`. Code facts in §2.2 were re-read on 2026-10-19 from `origin/main` `4583d21e` (SA-R1; the first draft had read a stale local `main`).

### 2.1 Database

| Fact | Detail |
|---|---|
| `public.exchange_rates` | 43 rows. **Every** `last_updated_at` is 2025-11-05. Columns used by code: `id`, `currency_code`, `currency_name`, `currency_symbol`, `rate_to_usd` (units of the currency per 1 USD; `convertToUsd` divides by it), `is_enabled`, `decimal_places`, `last_updated_at`, `created_at`, `updated_by` |
| RLS on `exchange_rates` | On. Policy "Admins can manage exchange rates": `ALL`, role `authenticated`, `USING EXISTS (profiles.id = auth.uid() AND profiles.role = 'admin')`, **no `WITH CHECK`**. Policy "Users can read enabled exchange rates": `SELECT`, `authenticated`, `is_enabled = true` |
| `public.exchange_rate_history` | RLS on. One policy "Admins can read exchange rate history": `SELECT`, same `profiles.role` predicate |
| Table privileges | `UPDATE` granted to both `anon` and `authenticated` on both tables. RLS is the only thing stopping them |
| Migrations | **Neither table has a migration in the repo** (created in the dashboard) |
| History trigger | **Verified live 2026-10-19 (TL).** Trigger `exchange_rate_change_trigger` (`AFTER UPDATE ... FOR EACH ROW`) on `exchange_rates` calls `public.log_exchange_rate_change()`: `SECURITY DEFINER`, plpgsql, **no `SET search_path`**. On UPDATE, when `OLD.rate_to_usd IS DISTINCT FROM NEW.rate_to_usd`, it inserts `(currency_code, old_rate, new_rate, changed_by = NEW.updated_by, changed_at = NOW())` into `public.exchange_rate_history`. Consequences: (a) every rate update must set `updated_by` = the acting admin, or the history row is attributed to the previous editor; (b) enable / disable changes are **not** historised (the audit trail is their record); (c) a same-value save writes no history row. EXECUTE on the function was already revoked from `PUBLIC`, `anon`, `authenticated` by SECDEF slice 5 (`20261051`); its body is captured in `docs/investigations/SECDEF_PROD_ONLY_FUNCTION_DEFINITIONS.md`. `changed_by` → `auth.users` (NO ACTION); both actor columns are already classified by the operator account cleanup (`20261081`) and the purge baseline ("never") |

### 2.2 Code

| File | Today |
|---|---|
| `app/admin/exchange-rates/page.tsx` | Client component (`'use client'`). Header comment line 3: `REDUNDANT (BD-34, 2026-10-16)`, "do not extend or link"; lines 5-7: read-only since **FF-1a (BD-36, PR #465)**. **Already read-only:** no rate edit, no enable toggle, no outside rate fetch (the exchangerate-api.com block was removed by FF-1a). **Already on Pino:** `createLogger({ module: 'AdminExchangeRates' })` from `@/lib/logger`, **0 `console.*`**. **Still reads both tables from the browser** through `@/lib/supabaseClient`: `exchange_rates` all rows ordered by `currency_code` (about lines 65-68) and the newest 50 `exchange_rate_history` rows by `changed_at` (about 81-85). Header has only a Refresh button; each row has a history toggle; dates use `toLocaleDateString`, not `formatUtc`. No visible "redundant" notice |
| `app/admin/__tests__/redundantPages.source.guard.test.ts` | Pins the page as redundant (finance M-8 / FF-1a). **G-1** the exact REDUNDANT header line and `'use client'` first; **G-2** the sidebar file names neither `platform-dashboard` nor `exchange-rates`; **G-3** no redundant notice (`redundant-page-notice`, `AdminNotice`); **G-4** no non-test file under `app/`, `lib/`, `components/`, `hooks/` names `/admin/exchange-rates` in code; **G-5** Pino, no `console.`; **G-6** read-only: forbidden tokens `.update(`, `.insert(`, `.upsert(`, `.delete(`, `.rpc(`, `updateRate`, `createCurrencyService`, **`fetch(`**, and every `.from(` is a `.select(` on the two rate tables. Each rule has a planted control |
| `app/admin/components/__tests__/AdminSidebar.nav.test.ts` | Lists `/admin/exchange-rates` as **`UNLISTED`** (on disk, never in the sidebar); asserts the sidebar never contains `exchange-rates` |
| `scripts/check-bos-exchange-rates-write-access.sql` | **Finance check 35** (FF-1a), read-only: per table and role (`anon`, `authenticated`), RLS on/off, SELECT / INSERT / UPDATE / DELETE grants and the policies that apply. It is the pre-check for the database lockdown, which the finance requirement recorded as follow-up **FF-2** (unscheduled; superseded by slice 1b here, BD-55) |
| `lib/services/CurrencyService.ts` | `updateRate` (from line 215), API auto-update path `updateRatesFromApi` (from line 245); neither has a caller outside the file. **9 `console.*` calls** (lines 64, 91, 118, 231, 239, 291, 399, 431, 436). Imported by `CurrencySelector` (runs in the browser) and type-imported by `currencyHelpers` |
| `components/settings/CurrencySelector.tsx:45-60` | **Legacy reader that must keep working.** Reads enabled rows as the signed-in user |
| `lib/utils/currencyHelpers.ts` | Legacy helper; must keep working |
| `lib/business-os/finance/currencyGroups.ts` + `lib/business-os/finance/__tests__/finance.source.guard.test.ts` | Business OS finance code must not import rates. The guard enforces it. **Unchanged by this work** |
| Access | `/admin/exchange-rates` already sits behind `app/admin/layout.tsx` (`requireAdminPage`). No sidebar link (pinned by G-2, G-4 and the sidebar `UNLISTED` entry) |
| Recorded decisions | Finance **BD-34** (redundant, do not extend) and **BD-36** (read-only) applied to this page until 2026-10-19; **BD-55** amends both for this page only (the Platform dashboard stays redundant) |

### 2.3 Why it matters

- `profiles.role` is the banned admin source of truth (CLAUDE.md Security Rules). The source of truth is `admin_users`, SQL predicate `public.is_platform_admin()`, route guard `requireAdmin`, page guard `requireAdminPage`.
- The page's browser reads are direct Supabase calls outside `lib/repositories/` (CLAUDE.md rule 1). The page no longer writes, but the database still lets a signed-in browser session write under the `profiles.role` policy, which is what check 35 measures.
- No admin can update a rate today: the only write path in the product was removed by FF-1a, so the table cannot be kept current.
- Stale rates look current: nothing on the page says "this is a year old".

---

## 3. User decisions

User message, 2026-10-19, verbatim:

> "let's first get the exchange rate page up to date, so it can be used. i agree with all recommendations in 1-4, let's skip on any conversions in 5 yet, and just have the page ready for manual updates by admin and allow me to write the url and open the page. then we may add it as a tab under the finance page, with no linkage yet to any customer revenue"

| # | Topic | Decision | Source (verbatim) | Consequence for this requirement |
|---|---|---|---|---|
| D-1 | Rate source | **Manual entry by an admin**, on the page. No automatic feed in this scope | "i agree with all recommendations in 1-4" / "just have the page ready for manual updates by admin" | `CurrencyService.updateRatesFromApi` stays unused. The page's outside-rate fetch is already gone (FF-1a). BA recommendation: **leave the service code in place, unwired**. SA ruled (§13.1 SQ-1) |
| D-2 | Date rule | **One rate per month (month-end)** for future reporting | "i agree with all recommendations in 1-4" | Slice 1 adds no month-end table. Slice 1b verifies that `exchange_rate_history` records every change; if it does, a month-end rate can be recovered later (§5.4). If not, slice 1b adds the history trigger and slice 3 stays parked. The page's stale warning follows the monthly rule (FR-8) |
| D-3 | Audience | **Admin only.** Never shown to businesses | "i agree with all recommendations in 1-4" | No business-facing screen, route or chat answer reads these rates. The existing `CurrencySelector` read is a legacy platform-UI read and stays as is (§12) |
| D-4 | Missing rate | **Never assume 1** | "i agree with all recommendations in 1-4" | Standing rule. It has no effect until a conversion exists (D-5); recorded so the conversion slice inherits it |
| D-5 | Conversions | **Out of scope.** No conversion, no USD totals, no link to customer revenue | "let's skip on any conversions in 5 yet" / "with no linkage yet to any customer revenue" | BD-12 and CLAUDE.md "never sum money across currencies" stay unchanged. `finance.source.guard` stays unchanged. One CLAUDE.md wording fix is proposed (§3.1) |
| D-6 | Access | Page reachable by **typing the URL** `/admin/exchange-rates`. Later, a **tab under the Finance page** | "allow me to write the url and open the page. then we may add it as a tab under the finance page" | Slice 1: no sidebar link (already true). Slice 2: the tab |

### 3.1 Proposed CLAUDE.md wording fix (SA / user decide)

CLAUDE.md, Currency & Timezone table, "Never sum money across currencies" row says: "There is no FX rate anywhere in the platform." That is factually wrong: `public.exchange_rates` exists and this work makes it current. Proposed replacement for that sentence:

> "An admin-maintained `exchange_rates` table exists, but no figure may be converted or summed with it."

The rule itself does not change. The edit is a one-line docs change and can ride with slice 1a. Needs SA agreement and user sign-off (CLAUDE.md is the user's file).

### 3.2 Recommendations recorded by BA (not user decisions)

| # | Topic | BA recommendation | Why |
|---|---|---|---|
| R-1 | Add a new currency in slice 1 | **No.** Edit and enable / disable only | 43 currencies exist; adding one needs name, symbol and decimal places validation and a duplicate check, which is a second form for no current need. Add later if the user asks |
| R-2 | USD row | Shown, **not editable** (rate fixed at 1, it is the base) | Editing the base would silently re-scale every other row |
| R-3 | Stale threshold | **35 days** since `last_updated_at` | Matches the monthly rule (D-2) with a few days' grace after month-end |
| R-4 | Rate bounds | `rate_to_usd` > 0 and ≤ 10,000,000, at most 6 decimal places | Covers every real currency per USD (the largest are in the tens of thousands, some unofficial rates higher) while refusing typos like a missing decimal point that adds many zeros. SA may tighten |

---

## 4. User stories

- As a platform admin, I want to open `/admin/exchange-rates` by typing its URL, so that I can maintain rates without a menu entry.
- As a platform admin, I want to edit a currency's rate to USD and save it, so that the table reflects this month's rate.
- As a platform admin, I want to switch a currency on or off, so that only currencies we support are offered.
- As a platform admin, I want to see when each rate was last updated, with a clear warning when it is older than about a month, so that I know which rates need attention.
- As a platform admin, I want every change recorded with the old and new rate and who made it, so that I can tell later what the rate was and why it changed.
- As a business user, I never see these rates on any Business OS screen (D-3).

---

## 5. Slices

Slices are small and numbered, reuse existing infrastructure (`requireAdmin`, `requireAdminPage`, the repository pattern, `AuditTrailService`, the admin layout shared components) and add nothing new without a reason.

### 5.1 Slice 1a — Safe manual page (code)

Ships first. It works against today's database policies because all writes move to the server.

| Part | What |
|---|---|
| Repository | `ExchangeRatesRepository` in `lib/repositories/` (use the `new-repository` skill): list all rates, get one by currency code, update a rate, set enabled. Returns `RepositoryResult`. Global, not per-user data, so no `user_id` filter: the repository is used only from the admin route with the service-role client, and the reason is documented in code (CLAUDE.md rule 4 bypass) |
| Route(s) | Under `app/api/admin/exchange-rates/` (use the `new-api-route` skill): `requireAdmin` as the **first statement**; Zod on every input; Pino with `correlationId`; error format per CLAUDE.md. Read all rows; update one rate; set enabled on one row |
| Audit | One non-blocking audit entry per change, recording currency code, old rate → new rate (or old → new enabled), and the admin's user id |
| Page | `app/admin/exchange-rates/page.tsx` today is read-only and reads both tables from the browser (§2.2). Slice 1a **adds** rate edit and enable toggle back, through the route, and moves **both reads** (rates and the newest 50 history rows) to the route's `GET` (SA-R4), so the page holds no Supabase client. The `REDUNDANT (BD-34)` and FF-1a header comments are removed (BD-55 amends BD-34 / BD-36 for this page). Follows the admin layout standard (closed, L-* / LF-*): `AdminPageHeader`, Refresh-only bar with "Read at", shared loading / error / empty states, the standard table constants, `StatusChip` for the stale and enabled states, `formatUtc` for dates (SA-R11) |
| Guards | `redundantPages.source.guard`: Exchange rates leaves G-1, G-3, G-5 and G-6 (the Platform dashboard keeps them). G-6, which bans `fetch(` in the page, is **replaced** by an Exchange rates page guard: no `@/lib/supabaseClient` import, no `.from(`, no `CurrencyService`, no outside host, and the only `fetch(` targets are `/api/admin/exchange-rates`, each rule with a planted control. G-2, G-4 (no in-app link) and the sidebar `UNLISTED` entry **stay** (D-6: URL only). Per SA-R3 |
| Dead code | Nothing to remove in the page: FF-1a already removed its outside fetch, rate edit and toggle. `CurrencyService.updateRate` and `updateRatesFromApi` stay, unwired, with a header note that they must not be wired again (D-1, SQ-1) |
| Logging | The page already logs through Pino (0 `console.*`); it keeps the module name `AdminExchangeRates`. The **9** `console.*` calls in `CurrencyService.ts` are converted to a **browser-safe** logger, because `CurrencySelector` loads the file in the browser (CLAUDE.md rule 3, SA-R12). **User approval for this conversion is treated as given within this scope** (the user asked for the page to be made usable; recorded here so the Dev does not re-ask) |
| Docs | Optional: the §3.1 CLAUDE.md one-line fix, if SA and the user agree |

### 5.2 Slice 1b — Database record and lockdown (migration)

| Part | What |
|---|---|
| Record as-is | One migration that records both tables exactly as they are live (columns, defaults, constraints, indexes, the history trigger and its function if present), written idempotently (`IF NOT EXISTS`) so it is a no-op for structure on prod |
| Replace `profiles.role` | Drop both `profiles.role` policies. Admin reads of `exchange_rate_history` and all writes go through the server route only |
| Revoke browser writes | Revoke `INSERT`, `UPDATE`, `DELETE` on both tables from `anon` and `authenticated` |
| Keep the legacy read | **Keep** `authenticated` `SELECT` of enabled rows on `exchange_rates` (`CurrencySelector`, `currencyHelpers`) |
| History | Verify the history trigger exists and fires on update (§5.4) |
| Scripts | Rollback script and a read-only check script (policies, grants, trigger present, legacy read still works, browser write refused), following the repo's existing migration-checker pattern |
| Apply | **The user applies the prod migration by hand.** The session stops and hands over the scripts. Applied only after slice 1a is deployed |

Whether an admin-read policy on `is_platform_admin()` is still wanted once all admin reads go through the server is an SA call (SQ-2).

### 5.3 Slice 2 — Finance tab

Add Exchange rates as a tab on the Finance admin page (`app/admin/finance/`). Today that page has **no tabs**: `FinanceView.tsx` renders one stacked view whose filters live in the URL. The admin precedent for tabs is Business OS AI (`app/admin/business-os-llm/page.tsx`): `?tab=` in the URL written with `replaceState`, arrow / Home / End keyboard focus, manual activation. Slice 2 follows that precedent:

- Tab 1 is today's finance view, unchanged, and stays the default (no `?tab=` = today's page, so existing links keep working).
- Tab 2 is the exchange rates table, the same component slice 1a built, reading the same admin route.
- The finance filters (window, account) do not apply to the Exchange rates tab and are not shown on it.
- **No linkage to revenue:** nothing on the finance tab reads a rate; no figure on any finance section changes; `finance.source.guard` stays green unchanged.
- `/admin/exchange-rates` keeps working (either still its own page or a redirect to the finance tab; SA rules SQ-4).
- No sidebar change beyond what the tab needs (Finance is already in the sidebar).

### 5.4 Month-end rate (D-2): is a new table needed?

A month-end rate is "the rate in force at the end of the month". It can be recovered from `exchange_rate_history` if, and only if, **every** change to `rate_to_usd` writes a history row with the old rate, the new rate and the time. Then the month-end rate for a currency is the newest history row at or before month-end (or the current row, if it has not changed since).

- If slice 1b confirms the trigger exists and writes those three facts: **no new table now.** Slice 3 stays parked until a report needs it.
- If the trigger is missing or incomplete: slice 1b adds it (small, records each change), so rates edited from now on are not lost. Slice 3 stays parked.
- The audit entry from slice 1a (old → new) is a second record either way.
- History before today is whatever exists; the 2025-11-05 values are the only known starting point.

---

## 6. Functional requirements

| # | Requirement | Slice |
|---|---|---|
| FR-1 | The page lists every currency in `exchange_rates` with code, name, symbol, rate to USD, enabled, and last updated (UTC) | 1a |
| FR-2 | An admin can edit a rate and save it. The save goes through the admin route, never the browser client | 1a |
| FR-3 | An admin can switch a currency on or off. Same route rule | 1a |
| FR-4 | The USD row's rate cannot be edited (R-2) | 1a |
| FR-5 | No currency can be added or deleted in this scope (R-1) | 1a |
| FR-6 | The route refuses: a rate ≤ 0, a rate above the upper bound, more than 6 decimal places, a non-numeric rate, a currency code that is not three upper-case letters or that does not exist | 1a |
| FR-7 | Each saved change writes `last_updated_at` = now and `updated_by` = the admin's user id, and writes one non-blocking audit entry with old and new values | 1a |
| FR-8 | Each row shows its age. A rate older than 35 days shows a clear "Stale" status (text, not colour alone). The header or KPI area shows how many enabled rates are stale | 1a |
| FR-9 | A save failure shows a short message on the page and leaves the previous value showing; it never shows raw internal errors | 1a |
| FR-10 | Only platform admins can read or change rates through the route (`requireAdmin`); everyone else gets the standard refusal | 1a |
| FR-11 | After 1b, the browser roles cannot insert, update or delete either table; signed-in users can still read enabled rows | 1b |
| FR-12 | Exchange rates is a tab on `/admin/finance`; the existing finance view is the default tab and is unchanged | 2 |
| FR-13 | No screen, route or calculation converts money or totals across currencies with these rates (D-5) | All |

---

## 7. Non-functional requirements

- **Security:** `requireAdmin` first statement; admin truth is `admin_users` / `is_platform_admin()`, never `profiles.role`; service-role use documented in code; no internal error details outside development.
- **Data access:** all DB access via `lib/repositories/` (rule 1); Zod before business logic (rule 2); Pino with `correlationId` (rule 3).
- **Audit:** non-blocking, `.catch` logged, never fails the request.
- **Accessibility:** status never by colour alone; table and inputs keyboard-usable and named; follows the admin layout standard.
- **Performance:** one read of 43 rows; no caching layer needed.
- **Compatibility:** `CurrencySelector` and `currencyHelpers` keep working before and after 1b.
- **CI:** no new CI job; tests run in the existing Jest gate.

---

## 8. Acceptance criteria

### Slice 1a

- [ ] Typing `/admin/exchange-rates` as a platform admin opens the page; a non-admin is refused by the admin layout guard (unchanged behaviour).
- [ ] The page shows all 43 currencies with last updated in UTC; every rate last touched 2025-11-05 shows as Stale, and the stale count is visible.
- [ ] Editing a rate and saving updates it, refreshes "last updated", and clears the Stale status for that row.
- [ ] Switching a currency off and on works and persists.
- [ ] The USD rate cannot be edited.
- [ ] The page source contains no Supabase client import and no direct table write (Jest source guard).
- [ ] Route tests: happy path (read, update rate, set enabled), auth failure (not admin → refused, nothing written), invalid input (rate 0, negative, above bound, too many decimals, bad code, unknown code → 400, nothing written).
- [ ] Repository tests: one per method, including a not-found currency.
- [ ] One audit entry per change, with old and new values; an audit failure does not fail the save.
- [ ] Zero `console.*` left in `lib/services/CurrencyService.ts` (all 9 converted to a browser-safe logger); the page stays at 0 and is pinned by the SA-R3 Exchange rates page guard, which replaces G-6.
- [ ] `finance.source.guard` passes unchanged; no file under `lib/business-os/` imports the repository or `CurrencyService`.
- [ ] `CurrencySelector` still lists enabled currencies.

### Slice 1b

- [ ] Migration, rollback and check scripts exist in the repo; the check script passes on prod after the user applies the migration.
- [ ] No policy on either table references `profiles.role`.
- [ ] `anon` and `authenticated` cannot insert, update or delete either table (checked by the script).
- [ ] A signed-in non-admin can still read enabled rates; `CurrencySelector` still works.
- [ ] The history trigger is confirmed (or added), and one test update on prod writes a history row with old rate, new rate and time.
- [ ] The slice 1a page still saves after the migration.

### Slice 2

- [ ] `/admin/finance` with no `?tab=` looks and behaves exactly as before (existing finance tests unchanged and green).
- [ ] `/admin/finance?tab=exchange-rates` (exact key per SA) shows the exchange rates table with the same edit and toggle behaviour.
- [ ] Tabs are keyboard-usable per the Business OS AI precedent; the tab is in the URL.
- [ ] No finance figure changes; `finance.source.guard` unchanged and green.
- [ ] `/admin/exchange-rates` still reaches the rates (page or redirect, per SA).

---

## 9. Out of scope / future roadmap

- Any conversion, USD total or cross-currency sum (D-5); any link to customer revenue or takings.
- An automatic rate feed (D-1). The service code stays, unwired.
- Adding or deleting currencies (R-1).
- A sidebar entry for `/admin/exchange-rates` in slice 1 (D-6).
- Showing rates to businesses in any form (D-3).
- Slice 3: a month-end rate table, only if §5.4 shows history is not enough.
- Slice 4: a conversion / USD view. Before it starts: a written exception to BD-12 and to the CLAUDE.md rule, D-4 (never assume 1) applied, and month-end rates (D-2) as the basis.
- Retiring or reworking the legacy `CurrencySelector` / `currencyHelpers` readers.

---

## 10. Questions for SA

Technical forks for SA to rule on; none need the user.

| # | Question | BA suggestion |
|---|---|---|
| SQ-1 | Remove `CurrencyService.updateRatesFromApi` and its fetchers, or leave unwired? | Leave, unwired, out of scope (D-1). Revisit if a feed is ever wanted |
| SQ-2 | After 1b, keep an admin `SELECT` policy on `is_platform_admin()` for either table, or rely on the server route alone? | Server route alone (no browser admin read exists after 1a); fewer policies to keep right |
| SQ-3 | One route with PATCH for both rate and enabled, or two routes? | One `GET` + one `PATCH` keyed by currency code; the body says which field changes |
| SQ-4 | Slice 2: keep `/admin/exchange-rates` as its own page or redirect to the finance tab? | Redirect, so there is one place; links keep working |
| SQ-5 | Upper bound and decimal places (R-4) | 10,000,000 and 6 decimals unless SA has a better rule |
| SQ-6 | Should the CLAUDE.md wording fix (§3.1) ride with 1a? | Yes, as a separate commit; user signs off on the wording |
| SQ-7 | Does the page component need a KPI strip (stale count) or only a header badge? | One KPI tile "Stale rates" (enabled rates older than 35 days), per the admin money-page KPI-first preference |

---

## 11. Open questions (business)

None blocking. All business choices are settled by D-1 to D-6. The CLAUDE.md wording (§3.1) needs the user's sign-off because it edits the user's root document.

---

## 12. Notes on integration points

| Area | Effect |
|---|---|
| `public.exchange_rates`, `public.exchange_rate_history` | Recorded in a migration and locked down in 1b; written only by the admin route |
| `lib/repositories/` | New `ExchangeRatesRepository` |
| `app/api/admin/exchange-rates/` | New admin route(s), `requireAdmin` first |
| `app/admin/exchange-rates/page.tsx` | Edit and toggle added back and both reads moved to the route (no Supabase client left); REDUNDANT / FF-1a header comments removed; layout standard; already on Pino |
| `app/admin/__tests__/redundantPages.source.guard.test.ts`, `AdminSidebar.nav.test.ts` | G-6 replaced by an Exchange rates page guard; G-1 / G-3 / G-5 drop Exchange rates; G-2, G-4 and `UNLISTED` stay (SA-R3) |
| [BUSINESS_OS_FINANCE_HEALTH_REQUIREMENT.md](/docs/requirements/BUSINESS_OS_FINANCE_HEALTH_REQUIREMENT.md) | **BD-55** amends BD-34 / BD-36 for this page; FF-2 superseded by slice 1b; check 35 is reused and extended by 1b (SA-R14) |
| `lib/services/CurrencyService.ts` | `console.*` → Pino; API path stays, unwired |
| `components/settings/CurrencySelector.tsx`, `lib/utils/currencyHelpers.ts` | Must keep working; rely on the kept `authenticated` read of enabled rows |
| `app/admin/finance/` | Slice 2 adds tabs; finance data and sections unchanged |
| `lib/business-os/finance/**` and its source guard | Unchanged; must not import rates |
| `AuditTrailService` | One entry per change |
| CLAUDE.md | Proposed one-line wording fix (§3.1) |

---

## 13. SA requirement review

**Reviewed by SA — 2026-10-19**
**Verdict: CLEARED-WITH-CHANGES.** The slicing, the security model and the 1a-before-1b order are sound. But §2.2 and parts of §5.1 describe a **stale `main`**: the local checkout the BA read is 505 commits behind `origin/main`, and on `origin/main` the page has already moved (SA-R1). The user's 2026-10-19 decision stands and reverses two recorded finance decisions for this one page (SA-R2). **Conditions:** BA applies SA-R1 and SA-R2 to this requirement and to the finance requirement **before** Dev writes the slice 1a workplan; Dev branches from `origin/main`. User decisions D-1 to D-6 are not reopened.

### 13.1 Rulings on the BA's questions

| # | Ruling |
|---|---|
| SQ-1 | **Leave `CurrencyService.updateRatesFromApi` and `updateRate` in place, unwired** (no caller on `origin/main`). Add a short header note that both are browser-side writers that stop working once 1b revokes client writes, and must not be wired again: the admin route is the only writer. Do not extend `CurrencyService` (direct Supabase outside `lib/repositories/`, legacy) |
| SQ-2 | **Server route alone. No `is_platform_admin()` policy on either table.** 1b drops both `profiles.role` policies and adds none. Keep only "Users can read enabled exchange rates" (`SELECT`, `authenticated`, `is_enabled = true`) for `CurrencySelector` / `currencyHelpers`. Fewer policies, nothing to keep in step with `admin_users` |
| SQ-3 | **One `GET /api/admin/exchange-rates` + one `PATCH /api/admin/exchange-rates/[currencyCode]`.** The currency code comes from the path (`z.string().regex(/^[A-Z]{3}$/)`), like the credits accounts route takes its id from the path. The body is a `.strict()` Zod discriminated union on `field`: `{ field: 'rate', rate: <decimal string> }` or `{ field: 'enabled', isEnabled: boolean }`. One change per request |
| SQ-4 | **Redirect**, in slice 2: `app/admin/exchange-rates/page.tsx` becomes a server `redirect('/admin/finance?tab=exchange-rates')` (the admin layout still gates it). Tab key `exchange-rates`. Slice 2 then amends the guards that pin the page (SA-R3, SA-R13) |
| SQ-5 | **Accepted with a shape rule.** The rate travels as a **decimal string**, not a JS number, so no float rounding reaches the `numeric` column: `^\d{1,8}(\.\d{1,6})?$`, then `> 0` and `≤ 10,000,000`. Dev confirms the column type and scale with the `business-os-schema-check` skill first; if the live scale is below 6, the decimals cap follows the column. **Amended by SA 2026-10-19 (workplan review, O-1):** live `rate_to_usd` is `numeric(12,6)` (max 999,999.999999, verified by TL), so the integer part follows the column too: `^\d{1,6}(\.\d{1,6})?$`, then `> 0`; the pattern caps the value below 1,000,000 (R-4's 10,000,000 bound is superseded). Live max today is 150 |
| SQ-6 | **Agree with the wording, not with riding in 1a.** CLAUDE.md is the user's file: a separate docs-only change once the user signs off on the sentence. It does not block 1a |
| SQ-7 | **One KPI tile, "Stale rates"** (enabled rates with `last_updated_at` older than 35 days), using the existing `KpiStrip` (the `KpiStrip.callers.pin` test gains this caller). Each row also carries a text `StatusChip` "Stale" |

### 13.2 Additional rulings

| # | Topic | Ruling |
|---|---|---|
| SA-R1 | **Stale baseline (must fix before the workplan)** | On `origin/main` (not the local `main` the BA read): the page is marked `REDUNDANT (BD-34, 2026-10-16)`; it is **already read-only** (BD-36, FF-1a, PR #465): no rate edit, no toggle, no outside fetch; it **already logs via Pino** (`createLogger({ module: 'AdminExchangeRates' })`, 0 `console.*`); it still **reads** both tables from the browser (`exchange_rates` all rows, `exchange_rate_history` last 50). It is pinned by `app/admin/__tests__/redundantPages.source.guard.test.ts` (G-1 header, G-3 no notice, G-4 no in-app link to `/admin/exchange-rates`, G-5 Pino, G-6 read-only: `fetch(` is a forbidden token in the page) and by `AdminSidebar.nav.test.ts` (`UNLISTED`, sidebar never names `exchange-rates`). A write-access check already exists: check 35, `scripts/check-bos-exchange-rates-write-access.sql`, and the DB lockdown is the unscheduled finance follow-up **FF-2**. `CurrencyService.ts` has **9** `console.*` calls, not 7. BA rewrites §2.2 and the §5.1 Page / Logging / Dead code rows from `origin/main` |
| SA-R2 | **Record the reversal** | The user's 2026-10-19 message makes the page a maintained admin tool again. That **amends BD-34 and BD-36 for Exchange rates only** (the Platform dashboard stays redundant). BA records a new BD in `BUSINESS_OS_FINANCE_HEALTH_REQUIREMENT.md` (amends BD-34 / BD-36 for this page; BD-12 and CUR-3 unchanged, per D-5), marks **FF-2 superseded by slice 1b here**, and cross-links both documents. Without it, slice 1a contradicts a recorded user decision and its guard |
| SA-R3 | **Guards slice 1a must change** | `redundantPages.source.guard`: Exchange rates leaves G-1, G-3, G-5 and G-6 (the dashboard keeps them). G-6 is **replaced** by an Exchange rates page guard, with a planted control per rule: no `@/lib/supabaseClient` import, no `.from(`, no `CurrencyService`, no outside host; the only `fetch(` targets are `/api/admin/exchange-rates`. G-4 (no in-app link) and the sidebar `UNLISTED` entry **stay** in 1a (D-6: URL only). The `REDUNDANT` header comment is removed from the page |
| SA-R4 | **Reads move too** | After 1b the history table has no client policy or grant, so the browser history read would fail. 1a moves **both** reads to `GET`: rates (all rows, ordered by code) and the newest 50 history rows, plus a `readAt`. Add an FR for the history panel (BD-36 kept it). The page then holds no Supabase client at all |
| SA-R5 | **1a before 1b — confirmed** | `supabaseServer` (service role) bypasses RLS and holds the table grants, so the 1a route works under today's `profiles.role` policies. Order: 1a deployed → user applies 1b. After 1b, nothing in the product writes or reads these tables from the browser except the kept `CurrencySelector` enabled-row read |
| SA-R6 | **Rule 4 / repository** | Accepted: a global platform table with no tenancy column, `supabaseServer` intentional. The repository carries a header in the `BoostPackRepository.ts` form: why there is no `user_id` filter, that authorisation is the caller's job, the one permitted caller (the admin route behind `requireAdmin`), server-only, no caller-supplied filters or column lists. **`tenant-isolation-guard` is not applicable**: no tenant id, no owner column, no caller-supplied account id. State that in the workplan. `updated_by` comes from the `requireAdmin` result (`gate.user.id`), **never** from the body |
| SA-R7 | **Trigger contract** | The rate update sets `rate_to_usd`, `last_updated_at = now()` and `updated_by = admin id` **in one UPDATE** (SA-R6), so the trigger attributes the history row correctly. The enable toggle also sets `updated_by` and `last_updated_at`. Is `last_updated_at` set by a DB default or trigger on UPDATE? Dev checks; the repository sets it explicitly either way. A **same-value rate save is allowed** and means "confirmed for this month": it refreshes `last_updated_at` (clears Stale), writes no history row (trigger `IS DISTINCT FROM`), and the audit row records `oldValue = newValue`. A repository test pins that `updated_by` is in every update payload |
| SA-R8 | **Base currency** | USD: the rate cannot be edited (FR-4) **and it cannot be disabled** (400). Add to FR-4 and the route tests |
| SA-R9 | **Audit entry shape** | New constants in `lib/audit/events.ts` (`EXCHANGE_RATE_UPDATED`, `EXCHANGE_RATE_ENABLED_CHANGED`), registered in `lib/audit/eventAudience.ts` (platform admin audience). `entityType: 'exchange_rate'`, `entityId: <currency code>`, `userId` and `actorId` = admin id, `severity: 'info'`, `details: { currencyCode, field, oldValue, newValue }` (rates as strings, no other data), `request`. Written with **`logAndFlush`** (`lib/audit/boundedAuditFlush.ts`) before responding: it is a price-adjacent admin write (WC-7) and the **only** record of toggles. Never fails the request. The `oldValue` comes from the pre-read; the trigger's history row is the atomic record of the true old rate |
| SA-R10 | **Route conventions** | Match `app/api/admin/boost-packs/route.ts` and the credits accounts route: `correlationId` from `x-correlation-id` or `crypto.randomUUID()`, `logger.child({ correlationId })`, `requireAdmin(requestLogger)` as the first gate, Zod `safeParse` → 400, repository call, CLAUDE.md error format with the development-only `details`, `runtime = 'nodejs'`, `dynamic = 'force-dynamic'`. 404 for an unknown code. Logs carry the currency code and field, never the admin email |
| SA-R11 | **Page and layout standard** | `AdminPageHeader`, Refresh-only bar with "Read at", shared loading / error / empty states, `adminTable` constants, `StatusChip` (Stale, Enabled / Disabled as text), `formatUtc`, `KpiStrip` (SQ-7). Rate input is a named text input; save shows a short error and keeps the old value (FR-9). Logging stays on the module name `AdminExchangeRates` with the logger the other admin client pages use |
| SA-R12 | **`CurrencyService.ts` logging** | 9 calls to convert. The file is loaded in the browser (`components/settings/CurrencySelector.tsx` imports it), so it must use a browser-safe logger (`@/lib/logger/client` or whatever the other client files under `components/` use). Dev confirms before converting |
| SA-R13 | **Slice 2 and the finance guards** | `finance.source.guard` walks **all** of `app/admin/finance/**` and CUR-3 fails any file there whose code contains `exchange_rates`. So: the rates table component lives **outside** `app/admin/finance/` (for example `app/admin/exchange-rates/components/`); the finance tab file only imports and renders it; no finance file names `exchange_rates` (the API path `exchange-rates` with a hyphen does not match). `finance.source.guard` and `app/admin/finance/__tests__/source.guard.test.ts` stay unchanged and green; an edit to either needs an SA ruling. Slice 2 also amends `redundantPages` G-4 (the redirect target `/admin/finance?tab=exchange-rates` does not name `/admin/exchange-rates`, so G-4 may need no change; Dev confirms) and the sidebar nav test's on-disk route scan |
| SA-R14 | **1b migration shape** | One file, idempotent. **Record**: `CREATE TABLE IF NOT EXISTS` for both tables as live (columns, defaults, constraints, the `changed_by` / `updated_by` FKs, indexes), read with `business-os-schema-check`; trigger via `DROP TRIGGER IF EXISTS` + `CREATE TRIGGER`. **Do not re-`CREATE` the function**: its body contains the SQL keyword after `INSERT`, which breaks the Supabase SQL editor when pasted (known hazard; FR-0.13 of the SECDEF stream forbids it), and the body is already captured in `SECDEF_PROD_ONLY_FUNCTION_DEFINITIONS.md`. Instead: `ALTER FUNCTION public.log_exchange_rate_change() SET search_path = public, pg_temp` (safe: the body is schema-qualified and `NOW()` is `pg_catalog`), plus, in the same file, `REVOKE EXECUTE ON FUNCTION public.log_exchange_rate_change() FROM PUBLIC, anon, authenticated` and `GRANT EXECUTE ... TO service_role`. That keeps the SECDEF CI guard (S6) satisfied and matches the stream's slice 5 pattern; the revoke is a no-op on prod. **Policies**: `DROP POLICY IF EXISTS` for both `profiles.role` policies. **Grants**: `REVOKE ALL` on both tables from `anon`; on `exchange_rates`, revoke `INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER` from `authenticated` (keep `SELECT`); `REVOKE ALL` on `exchange_rate_history` from `authenticated`. `TRUNCATE` is not governed by RLS, so it is revoked explicitly. **Pre-check**: function owner is `postgres` (SECDEF FR-0.10), `proconfig` is null, `pg_depend` shows only the trigger. **Checker**: reuse and extend check 35 rather than a new script; it asserts the policies, the grants, `proconfig` holds the `search_path`, no client EXECUTE, and that the trigger exists. Rollback under `supabase/SQL Scripts/`. Update the SECDEF requirement / inventory: this function leaves the parked S7 list (47 → 46) |
| SA-R15 | **Migration number** | Highest on `origin/main` is `20261081` (`20261077` is already taken there). No remote branch (353 scanned), `supabase/held/` or `supabase/SQL Scripts/` holds `20261082` or higher. **Provisional: `20261082`.** Dev re-checks `origin/main`, open PR branches and `supabase/held/` at build time and takes the next free number |
| SA-R16 | **Not touched — confirmed** | No import from `lib/business-os/entitlements/` (type-only included), no catalog or tier change: `business-os-entitlements` checklist not triggered. No LLM call (`bos-llm-call-standards` n/a), no cron or queue (`durable-queue-drain` n/a), no new pattern. Admin gate per CLAUDE.md: `requireAdmin` / `requireAdminPage`, never `profiles.role` |
| SA-R17 | **Acceptance wording** | §8 slice 1a "no file under `lib/business-os/` imports ... `CurrencyService`" means **direct** imports: `InsightRepository.ts` already imports `currencyHelpers`, which type-imports `CurrencyService`. That is existing and allowed. Remove "Zero `console.*` in the page" (already true) and replace it with the SA-R3 guard |

### 13.3 Required changes for Dev (slice 1a workplan)

1. Branch from `origin/main`; restate the as-built page from there (SA-R1).
2. Repository with the rule-4 header (SA-R6), every update carrying `updated_by` and `last_updated_at` (SA-R7); unit test per method incl. not-found and the `updated_by` pin.
3. `GET` + `PATCH [currencyCode]` per SQ-3 and SA-R10; decimal-string rate per SQ-5; USD edit and disable refused (SA-R8); `GET` returns rates, 50 history rows and `readAt` (SA-R4).
4. Audit per SA-R9 with `logAndFlush`; new events registered in `events.ts` and `eventAudience.ts`.
5. Page rewrite per SA-R11 and SQ-7; no Supabase client in the page.
6. Guard changes per SA-R3 (planted controls); `KpiStrip` callers pin updated.
7. `CurrencyService.ts` 9 `console.*` → browser-safe logger (SA-R12); SQ-1 header note.
8. Route integration tests: happy path (read, rate, toggle, same-value confirm), not admin (nothing written), invalid input (each SQ-5 / SA-R8 case, bad code, unknown code 404).

---

## Change History

| Date | Change | Details |
|---|---|---|
| 2026-10-19 | Created | BA draft from the 2026-10-18 status review and the user's 2026-10-19 decisions (D-1 to D-6). Slices 1a, 1b, 2; 3 and 4 parked. Awaiting SA review |
| 2026-10-19 | SA requirement review | **CLEARED-WITH-CHANGES** (§13). SQ-1 to SQ-7 ruled; SA-R1 to SA-R17 added. §2.1 history trigger row replaced with the live-verified trigger facts (SECDEF, no `search_path`, `changed_by = NEW.updated_by`, toggles not historised). Conditions before the workplan: BA refreshes §2.2 / §5.1 from `origin/main` (page already read-only, Pino, guarded; SA-R1) and records the BD-34 / BD-36 reversal and FF-2 supersession in the finance requirement (SA-R2). Provisional migration `20261082` (SA-R15) |
| 2026-10-19 | BA applied SA-R1 and SA-R2 | **SA-R1:** §2.2 rewritten from `origin/main` `4583d21e` (page REDUNDANT per BD-34 and read-only per BD-36 / FF-1a PR #465, Pino with 0 `console.*`, still reads `exchange_rates` and 50 `exchange_rate_history` rows from the browser; guard rows for `redundantPages.source.guard` G-1 to G-6 and `AdminSidebar.nav.test` `UNLISTED`; check 35; `CurrencyService.ts` has 9 `console.*`). Overview, §2.3, D-1 consequence, §5.1 Page / Dead code / Logging rows (plus a new Guards row per SA-R3), the §8 slice 1a `console.*` criterion and §12 corrected to match. **SA-R2:** the user's decision is recorded as **BD-55** in [BUSINESS_OS_FINANCE_HEALTH_REQUIREMENT.md](/docs/requirements/BUSINESS_OS_FINANCE_HEALTH_REQUIREMENT.md) (amends BD-34 / BD-36 for Exchange rates only; Platform dashboard stays redundant; BD-12 and CUR-3 unchanged), FF-2 marked superseded by slice 1b, cross-linked both ways. Ready for the slice 1a workplan |
| 2026-10-19 | SA slice 1a workplan review | Workplan [ADMIN_EXCHANGE_RATES_SLICE_1A_WORKPLAN.md](/docs/workplans/ADMIN_EXCHANGE_RATES_SLICE_1A_WORKPLAN.md) **APPROVED-WITH-CHANGES** (its §10). Step 0 live results recorded there (`rate_to_usd numeric(12,6)`, `is_enabled` nullable, `updated_by` FK `auth.users`). SQ-5 amended (O-1): rate pattern `^\d{1,6}(\.\d{1,6})?$`, `> 0`, below 1,000,000 |
