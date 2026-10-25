# Requirement: Admin Exchange Rates Page

> **Last Updated**: 2026-10-20

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
| 1a | Safe manual page: server route + repository + page rewired + logging | ✅ Merged #477 (2026-10-19) | #477 | Full cycle (new route, data write, security). Works against today's database policies, so it ships first |
| 1b | Database record + lockdown migration (both tables into the repo, `profiles.role` replaced, browser writes revoked) | ✅ Applied to prod 2026-10-19 by user (check 35 VERDICT PASS 24/0, anon REST read+write refused 42501) · Merged #479 | #479 | Full cycle. **User applies the prod migration by hand** — the session stops for that. Applied only after 1a is deployed, so the page never breaks. Supersedes finance follow-up FF-2 (BD-55) |
| 2a | Exchange rates as a fourth tab under the Finance admin page (no revenue link). **Finance tab only** (user, D-7), no Settings link. FR-23 to FR-25, FR-27 | ✅ Merged #486 (2026-10-20). SA code approved, QA PASS-WITH-NOTES, user click-through passed. Workplan [ADMIN_EXCHANGE_RATES_SLICE_2A_WORKPLAN.md](/docs/workplans/ADMIN_EXCHANGE_RATES_SLICE_2A_WORKPLAN.md) | #486 | User go-ahead 2026-10-20: "start slice 2 (the Finance tab)". SA split slice 2 into 2a / 2b (SA-2-4). Branch from `origin/main` once 1c.2 (PR #484) has merged. TL picks full cycle or short path (a money page's layout changes, no figure, request or data path) |
| 2b | Old URL retired: `next.config.js` temporary redirect `/admin/exchange-rates` → `/admin/finance?tab=exchange-rates`, `app/admin/exchange-rates/page.tsx` deleted (SQ-17 (a)). FR-26 | ✅ Merged #487 (2026-10-20). Workplan [ADMIN_EXCHANGE_RATES_SLICE_2B_WORKPLAN.md](/docs/workplans/ADMIN_EXCHANGE_RATES_SLICE_2B_WORKPLAN.md); SA code approved, QA PASS-WITH-NOTES, live redirect checks passed | #487 | Branches from `origin/main` **after 2a merges, not stacked** (SA-2-4). Config + tests only; separately revertible |
| 1c | Page refinements from the user's 2026-10-19 page review (D-7): filter bar (Enabled only by default), newest 10 changes, admin name instead of the id, new KPIs (Enabled currencies, Last rate change; Stale tile removed). ~~Country flag column~~ dropped by the user (§3.3 comment 3) | 🟡 1c.1 ✅ merged #482 (2026-10-20). 1c.2 PR #484, in the merge queue (workplan [ADMIN_EXCHANGE_RATES_SLICE_1C2_WORKPLAN.md](/docs/workplans/ADMIN_EXCHANGE_RATES_SLICE_1C2_WORKPLAN.md); SA code approved, QA PASS-WITH-NOTES, user click-through passed 2026-10-20) | — | **Build before slice 2.** Two small slices (§5.5.7): **1c.1** history cap + names + KPIs (route and page; full cycle, the route starts reading people's names), then **1c.2** filter bar only (page only; short path). No migration, no prod step. Comment 1 of the review is resolved by slice 2 (no Settings link) |
| 1d | History window (D-8): a Window control above the history table (Today / 7 days / 30 days / This month / Custom, default **This month**); the history table and the per-currency History view show the newest 10 rate changes **inside the window**, filtered on the server; the "Last rate change" tile stays **all-time** (new `lastChange` field on the plain `GET`). FR-28 to FR-34 | ✅ Merged #492 (2026-10-20). SA §13.6 cleared; SA code review approved; QA PASS-WITH-NOTES. Workplan [ADMIN_EXCHANGE_RATES_SLICE_1D_WORKPLAN.md](/docs/workplans/ADMIN_EXCHANGE_RATES_SLICE_1D_WORKPLAN.md) | #492 | User request 2026-10-20 (D-8). Reuses `DatePresets` and `adminWindow.ts` / `adminWindowPresets.ts`. Route `GET` + repository + view; **no migration** (`idx_exchange_rate_history_changed_at` exists, `20261082`). Branches from `origin/main` (2a #486 and 2b #487 merged). Cycle: TL picks; BA suggests full cycle (the route's query and payload change) |
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
| D-7 | Page review | Six comments on the live page (verbatim in §3.3). **Placement: Finance tab only**, so comment 1 (Settings sidebar) is resolved by slice 2 and there is **no Settings sidebar link**. **Stale: keep the row mark**, drop the Stale KPI tile. **Comment 3 (flag / country column) dropped by the user** (BQ-1 answer). Comments 2, 4, 5 and 6 become slice 1c | "Finance tab only" / "Keep the row mark" (follow-up answers, 2026-10-19); "skip this requirement, not needed" (BQ-1 answer, 2026-10-19) | New slice 1c (§5.5), built before slice 2. No Country column, no flag code, no new dependency. D-6 stands: no sidebar entry, so G-2, G-4 and the sidebar `UNLISTED` entry stay. SQ-7's Stale tile is replaced (FR-22); the per-row Stale chip stays (FR-8) |
| D-8 | History window | The history table shows the **newest 10 rate changes within a chosen period**. A **Window** control like the Finance page's (Today / 7 days / 30 days / This month / Custom) sits **above the history table**, default **This month**. The window filters **the history table and the per-currency History view only**; the **"Last rate change" tile stays all-time** | Request: "add another small change, the history table, needs to show the last 10 changes within a define period. in the main finance page we have a filter like the picture attached, let's have a similar filter above the history exchange rate, where default is "This Month". meaning, last 10 new changes this month." Follow-up: "Go ahead. The window filters the history table and the per-currency History view only. The Last rate change tile stays all-time." (both 2026-10-20) | New slice 1d (§5.6). Amends FR-18 (newest 10 **in the window**) and SA-1c-2's KPI source (`history[0]` → a separate all-time `lastChange`). The picture's note "Only accounts with a business profile can be found by name" belongs to Finance's business picker and does not apply: the history control has no business picker. The rates table, the Show / Search filter and the "Enabled currencies" tile are unchanged |

### 3.1 Proposed CLAUDE.md wording fix (SA / user decide)

CLAUDE.md, Currency & Timezone table, "Never sum money across currencies" row says: "There is no FX rate anywhere in the platform." That is factually wrong: `public.exchange_rates` exists and this work makes it current. Proposed replacement for that sentence:

> "An admin-maintained `exchange_rates` table exists, but no figure may be converted or summed with it."

The rule itself does not change. The edit is a one-line docs change and can ride with slice 1a. Needs SA agreement and user sign-off (CLAUDE.md is the user's file).

✅ **Applied 2026-10-25.** User sign-off, verbatim: "Yes. Change the CLAUDE.md currency rule to: 'An admin-maintained exchange_rates table exists, but no figure may be converted or summed with it.' Docs-only PR with auto-merge." SA had agreed (SQ-6). Code comments that still say "no FX rate anywhere" were left unchanged (out of scope; still true in practice: nothing converts).

### 3.2 Recommendations recorded by BA (not user decisions)

| # | Topic | BA recommendation | Why |
|---|---|---|---|
| R-1 | Add a new currency in slice 1 | **No.** Edit and enable / disable only | 43 currencies exist; adding one needs name, symbol and decimal places validation and a duplicate check, which is a second form for no current need. Add later if the user asks |
| R-2 | USD row | Shown, **not editable** (rate fixed at 1, it is the base) | Editing the base would silently re-scale every other row |
| R-3 | Stale threshold | **35 days** since `last_updated_at` | Matches the monthly rule (D-2) with a few days' grace after month-end |
| R-4 | Rate bounds | `rate_to_usd` > 0 and ≤ 10,000,000, at most 6 decimal places | Covers every real currency per USD (the largest are in the tens of thousands, some unofficial rates higher) while refusing typos like a missing decimal point that adds many zeros. SA may tighten |

### 3.3 User page review, 2026-10-19 (D-7)

The user reviewed the slice 1a page on 2026-10-19 and left six comments, then answered two follow-up questions. All quoted verbatim. After the SA review the user answered BQ-1 (flags on Windows) on 2026-10-19 with "skip this requirement, not needed", which **drops comment 3** entirely.

| # | User comment (verbatim) | Follow-up answer (verbatim) | Decision | Built in |
|---|---|---|---|---|
| 1 | "add it to the settings section of the admin side bar." | Placement: "Finance tab only" | **Replaced by the follow-up answer.** No Settings sidebar link. The page is reached from the Finance tab (slice 2) and by typing its URL (D-6) | **Slice 2** (resolves comment 1) |
| 2 | "add a filter on the top, in the same standard as the rest of the admin pages filters, default should be to present only enabled prices." | — | The shared admin filter bar. **Show: Enabled only** by default, plus Disabled only and All, and a search on code or name | 1c.2 (FR-14 to FR-16) |
| 3 | "can you add a country icon or flag icon near each currency? as another column near SYMBOL" | BQ-1: "skip this requirement, not needed" | **Dropped by the user** (2026-10-19). No Country column | — (FR-17 withdrawn) |
| 4 | "the latest changes, can we narrow it down to last 10 changes" | — | The **newest 10** changes (was 50) | 1c.1 (FR-18) |
| 5 | "can we change the GUID to user name" | — | The admin's **name**, else their email, else "Unknown user", worked out on the server | 1c.1 (FR-19) |
| 6 | "top KPIs should be: active/enabled currencies out of X, don't think we need stale KPI, and another box stating last action - for example: currency X changed from A to B" | Stale: "Keep the row mark" | Two tiles: **Enabled currencies** (N of X) and **Last rate change** (currency, A → B, who, when). **Stale tile removed**; the per-row Stale chip stays (35 days, USD never stale) | 1c.1 (FR-20 to FR-22) |

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

> **Note (2026-10-19, D-7).** The user's page comment 1 ("add it to the settings section of the admin side bar") is **resolved by this slice**: the follow-up answer was "Finance tab only". There is **no Settings sidebar link** and no other sidebar change; D-6, G-2, G-4 and the sidebar `UNLISTED` entry stay. Slice 2 is built **after slice 1c**, so the tab renders the refined view.
>
> **Baseline drift, for the slice 2 workplan.** The paragraph below says the Finance page has no tabs. On `origin/main` `0581637a` it already has three (`app/admin/finance/components/FinanceTabs.tsx`: Overview, Accounts, Plans, selected by `?tab=` through `useAdminFilters`). Slice 2 therefore adds a **fourth tab to an existing tablist**, not tabs from scratch. The Plans tab already owns the URL key `status`, **and the Accounts tab owns `show`** (`FINANCE_FILTER_SPEC.show`: `all` / `active` / `negative`; `financeFilterRepair` resets a non-default `show` whenever the tab is not Accounts), which is why slice 1c's filter uses the key **`currencies`** (SQ-8 ruling, SA-1c-1). BA refreshes this section from `origin/main` before the slice 2 workplan.
>
> **For slice 2 (SA-1c-1).** `FINANCE_FILTER_SPEC.tab` (today `['accounts', 'plans']`) and `financeFilterRepair` must learn the new `exchange-rates` tab, and the exchange-rates view's filter hook runs with `{ active: tab === 'exchange-rates' }`. Slice 2 concern only; nothing in 1c touches `app/admin/finance/`.

> **Refreshed by BA 2026-10-20** from branch `feature/admin-exchange-rates-2-finance-tab` at `c38ad4f4` (the slice 1c.2 tip; 1c.2 is PR #484, in the merge queue). The notes above are kept for the record; the text below **replaces** the 2026-10-19 slice 2 paragraph, which was written when `/admin/finance` had no tabs. User decisions, **not reopened**: placement "Finance tab only" (comment 1, D-7: no Settings link, no new sidebar entry); no linkage to customer revenue (D-5; nothing on finance reads a rate, BD-12, CUR-3); go-ahead on 2026-10-20: "start slice 2 (the Finance tab)".

#### 5.3.1 Finance today (as built)

| File | Today |
|---|---|
| `app/admin/finance/page.tsx` | `'use client'` (authz guard R8), wraps `FinanceView` in `<Suspense>` (`useSearchParams`, Next 14) |
| `app/admin/finance/components/FinanceTabs.tsx` | Page-local APG tablist, manual activation: Left / Right wrap, Home / End, Enter / Space selects, roving `tabIndex`, `aria-controls` / `aria-labelledby`. `FinanceTab = 'overview' \| 'accounts' \| 'plans'`; labels from `financeCopy.ts` (`TAB_OVERVIEW` "Overview", `TAB_ACCOUNTS` "Accounts", `TAB_PLANS` "Plans & subscriptions", `TABS_LABEL` "Finance views"). The finance source guard pins that no file outside `app/admin/finance/` imports it |
| `app/admin/finance/financeFilters.ts` | `FINANCE_FILTER_SPEC`, keys in this order: `window` (`range` / `from` / `to`, alias `preset`), `account` (alias `accountId`), `tab` = `choiceFilter('tab', ['accounts', 'plans'], '')`, `sort`, `group`, `show`, `status`. `FinanceFilters.tab: '' \| 'accounts' \| 'plans'`. `toFinanceQuery` sends `tab` to the finance route **only** for Accounts with no business, so the Plans tab's read is the Overview's. `financeFilterRepair`, in order: (1) "Since it started" without a business → default window; (2) a business with any tab or tab key → drop the tab and its keys (the business wins); (3) tab not Accounts and `sort` / `group` / `show` not at default → reset them; (4) tab not Plans and `status` set → reset it. `FINANCE_CLEAR_PATCH` keeps the tab |
| `app/admin/finance/components/FinanceView.tsx` | One `useAdminFilters(FINANCE_FILTER_SPEC)` (no `active` option). `useFinanceData(queryString)` reads the finance route on **every** tab. Order: `AdminPageHeader` (h1 "Finance", `asOf` = the window label) → `FinanceKpiStrip` (only when data; placeholders while the first read runs) → `FinanceFilterBar` (window, business picker, Clear, Read at, Refresh) → the content area. **The tablist and every panel render only inside `data && !error`**, and there is no tablist with a business picked. A panel is mounted only while its tab is selected (unmounted on leave), unlike Business OS AI, which keeps a visited tab mounted and hidden. `onSelectTab`: Accounts → `{ tab, status: '' }`; Plans → `{ tab, ...TAB_RESET }`; Overview → `{ tab: '', ...TAB_RESET, status: '' }`, one write each |
| Finance tests that pin the tab count | `financePage.render.test.tsx` (~line 1787: the three tab names, in order); `accountsTab.render.test.tsx` (~line 209: the keyboard test, "the keys wrap over three"); `financeFilters.test.ts` (the spec's tab values) |

#### 5.3.2 How the fourth tab fits

| Part | Spec |
|---|---|
| Tab | **Fourth and last**, after Plans & subscriptions. Label **"Exchange rates"** (new `TAB_EXCHANGE_RATES` in `financeCopy.ts`). Id `exchange-rates`; URL `?tab=exchange-rates` (SQ-4). Overview stays the default (no `tab` key), so every existing link keeps working |
| Types and spec (SA-1c-1, SA-2-2, SQ-20 (1)) | `FinanceTab` and `FinanceFilters.tab` gain `'exchange-rates'`; `FINANCE_FILTER_SPEC.tab` becomes `['accounts', 'plans', 'exchange-rates']`. **One finance key is added:** `FinanceFilters` gains `currencies: string`, and `FINANCE_FILTER_SPEC` gains, as its **last** key (after `status`), `currencies: EXCHANGE_RATES_FILTER_SPEC.currencies` — **the same field object**, never a copy, so both hooks parse and serialise the key identically and can never disagree on a URL. No existing finance key is renamed or re-ordered. A Dev comment at the new field says why two specs owning one key is safe: one shared field object, and the view's hook exists only while its tab is shown (SA-2-5). `toFinanceQuery` / `fromFinanceQuery` are untouched; `FINANCE_CLEAR_PATCH` and `financeCanClear` do **not** learn the key |
| `financeFilterRepair` (SA-1c-1, SA-2-2, SQ-20 (3)) | Its existing rules cover the tab itself. A business still drops it (rule 2, the business wins, so `?account=…&tab=exchange-rates` opens that business's Overview view); `show` / `sort` / `group` reset because the tab is not Accounts (rule 3); `status` resets because the tab is not Plans (rule 4). **One new rule, after rule 4:** tab not `exchange-rates` and `currencies` not at its default → `{ currencies: <default> }` (a pasted `?currencies=all` on Overview, or on a business link once rule 2 has dropped the tab; SQ-24). On the tab the new rule returns nothing |
| `onSelectTab` / `selectedTab` (SQ-20 (2), SQ-24) | Exchange rates → `{ tab: 'exchange-rates', ...TAB_RESET, status: '' }`, one write. The Overview, Accounts and Plans branches add `currencies: DEFAULT_CURRENCY_SHOW` (imported with the spec), so leaving the tab is still **one** write. `selectedTab` is `'exchange-rates'` when `filters.tab === 'exchange-rates'` and no business is picked (`query.accountId === null`), so the view never mounts on a business link |
| Request (SQ-19 (ii)) | **Unchanged.** `toFinanceQuery` still sends `tab` for Accounts only, and the request string does not include `currencies`, so on this tab the finance request string is the Overview's (as Plans) and `financeRequest.pin` is unchanged. The finance read **keeps running** on this tab (the Plans precedent), so Overview has its data on return; skipping it is a later optimisation, not this slice |
| Panel | `<FinanceTabPanel id="exchange-rates">` renders the existing `ExchangeRatesView`, reading the same admin route (`GET` / `PATCH /api/admin/exchange-rates…`), same edit, toggle, filter bar, KPIs and history |
| Where the view lives (SA-R13, CUR-3) | **Stays in `app/admin/exchange-rates/components/`.** The finance tab only imports and renders it. No file under `app/admin/finance/**` contains `exchange_rates` (new finance tests included); the hyphenated `exchange-rates` does not match. `finance.source.guard` and `app/admin/finance/__tests__/source.guard.test.ts` stay unchanged and green |
| Import (DV-1) | The alias path `@/app/admin/exchange-rates/components/ExchangeRatesView` contains `/admin/exchange-rates`, which `redundantPages` G-4 refuses in code (only a match preceded by `/api` is exempt). **Ruled (SQ-18):** `FinanceView.tsx` imports `{ ExchangeRatesView, EXCHANGE_RATES_PURPOSE }` from `'../../exchange-rates/components/ExchangeRatesView'`, and `financeFilters.ts` imports `EXCHANGE_RATES_FILTER_SPEC` from `'../exchange-rates/exchangeRatesFilters'`; each with a one-line comment saying the alias would spell the page route G-4 refuses (DV-1). No G-4 edit. No finance file imports `lib/admin/exchangeRates/**` directly |
| Finance chrome on this tab (SQ-19 (i)) | When `selectedTab === 'exchange-rates'`, `FinanceView` renders, under the header, the tablist and the rates panel **outside** the `data && !error` gate, and renders **none** of: `FinanceKpiStrip`, `FinanceKpiPlaceholders`, `FinanceFilterBar` (window, business picker, Clear, Read at, Refresh), the finance `AdminError`, the finance `AdminLoading`, or an `aria-busy` that reflects the finance read; the header's window `asOf` is `null`. None of them applies to rates: rates have no window and no business, and the finance tiles describe money. The view brings its own KPI strip (Enabled currencies, Last rate change), its own bar (Show, Search, Clear, Read at, Refresh), its own states and its own busy flag. The **tablist stays visible**, so the admin can go back. Overview, Accounts and Plans render exactly as today. For the user's diff review: on this tab the tablist sits directly under the header, on the others under the KPI strip and filter bar (an inherent layout shift of hiding the chrome, not a blocker) |
| One h1 (SQ-21) | **Exactly one h1, "Finance".** The view drops its `AdminPageHeader` (and the import) and exports its sentence as `EXCHANGE_RATES_PURPOSE` (the existing `PURPOSE` text, unchanged, still in `ExchangeRatesView.tsx`). On this tab `FinanceView`'s header is `title={PAGE_TITLE}`, `purpose={EXCHANGE_RATES_PURPOSE}`, `asOf={null}` (the Business OS AI precedent, L-8a, F-68). No `showHeader` prop. **During 2a only**, `app/admin/exchange-rates/page.tsx` renders `<AdminPageHeader title="Exchange rates" purpose={EXCHANGE_RATES_PURPOSE} />` above the view, so the standalone URL keeps its h1 until 2b deletes the page. `ExchangeRatesKpis.tsx` is not edited |
| Not gated on the finance read (SQ-19 (i)) | Today the tablist and panels sit inside `data && !error`. On this tab the rates show while the finance read is still running and when it has failed, with no finance error and no finance loading text, since they do not depend on it |
| The view's filter hook (SQ-20 (4), amends SA-1c-1) | The view is rendered **without** an `active` prop (default `true`); no `owns()` gating. Finance unmounts a hidden panel, so the view's hook exists only while its tab is selected; it starts at the default because leaving the tab and the repair remove `currencies`; a Show change is written by the view's hook and Finance's hook re-parses it to the same value (no write, no request). The view's `active` prop and its R-14 test stay (the L-9a contract); the view's header comment line 44 is corrected to "Finance unmounts hidden panels, so no caller passes false today" |
| No revenue link | Nothing on the finance page reads a rate; no finance figure, tile or section changes; no file under `app/admin/finance/` imports `lib/admin/exchangeRates/**` (only the view's own files do) |
| Sidebar | **No change.** Finance is already in the sidebar. No Settings link, no new item; G-2 stays (the sidebar names no `exchange-rates`) |
| KPI links | No Finance KPI tile links to the new tab (BA default; the finance tiles are about money) |

#### 5.3.3 The old URL (SQ-4)

SQ-4 ruled: `/admin/exchange-rates` becomes a server `redirect('/admin/finance?tab=exchange-rates')`. Authz guard **R8** (`lib/admin/__tests__/admin-authz-surface.guard.test.ts`) accepts a render entry point under `app/admin/**` that is a client component **or** a server page whose first statement awaits `requireAdminPage()` (R8's self-guarding clause, `guardsItselfFirst`); its exemption lists `R8_PARKED` and `R8_PERMANENT` are **empty and capped at 0** "and it has to stay that way". So a Server Component `page.tsx` that calls `redirect()` **fails R8 unless its first statement awaits `requireAdminPage()`**; none exists under `app/admin`, and SA rejects introducing one here (SQ-17 (d), SA-2-1).

**Ruled (SQ-17, 2026-10-20): option (a), built in slice 2b.** (b), (c) and (d) rejected.

| Option | What | Ruling |
|---|---|---|
| (a) **Ruled** | The Money MK-4 precedent: one temporary redirect in `next.config.js` `redirects()` — `{ source: '/admin/exchange-rates', destination: '/admin/finance?tab=exchange-rates', permanent: false }`, no `has`, with a comment in the existing style — and `app/admin/exchange-rates/page.tsx` is **deleted** (as `/admin/subscriptions` was for the Plans tab) | ✅ R8 untouched. The incoming query is kept and the destination's `tab` wins (`prepareDestination`, Next 14.2.35): `?currencies=all` arrives with it, `?tab=accounts` still lands on Exchange rates. The redirect runs before the admin layout; the destination is gated by it, so a non-admin still gets the layout's refusal. New test `app/admin/finance/__tests__/exchangeRatesRedirect.config.test.ts` in the `subscriptionsRedirect.config.test.ts` shape (shape block + `prepareDestination` block, asserting the parsed query object); `chargeChecksRedirect.config.test.ts` "three redirects in all" becomes four |
| (b) | Keep `page.tsx` as a `'use client'` component that calls `redirect()` from `next/navigation` during render | ❌ Rejected: a client page whose only job is to leave; drops the query unless it adds `useSearchParams` and a Suspense boundary; renders a flash first |
| (c) | A Server Component page + an R8 exemption, cap 0 → 1 | ❌ Rejected: R8 stays at 0 |
| (d) | A self-guarding server page (`await requireAdminPage()` first, then `redirect()`) | ❌ Rejected although R8 accepts it: it would be the first server-rendered page under `app/admin`, a new pattern (CLAUDE.md rule 7) for no gain over (a) |

#### 5.3.4 Guards and tests the slice touches

> **Ruled list (SQ-23, SA-2-3, 2026-10-20).** This table replaces the BA's first draft, which named a `financeFilters.test` tab-values pin that does not exist and missed the `currencies` lines, `financeFilterBar.layout` `DEFAULTS` and the sidebar on-disk floor. Dev shows each forced-edit file's diff in the handover, and nothing else in those files changes.

**Unchanged in both 2a and 2b**

| Guard or test | Effect |
|---|---|
| `redundantPages` **G-4** (no product code names `/admin/exchange-rates`) | **Unchanged.** `/admin/exchange-rates` stays in `PAGE_ROUTES`: in-app links go to the tab, never to the old URL. The redirect target does not name it; `next.config.js` is outside the walk roots (`app`, `lib`, `components`, `hooks`); the relative imports pass (SQ-18) |
| `redundantPages` **G-2** | Unchanged (sidebar not edited) |
| `finance.source.guard`, `app/admin/finance/__tests__/source.guard.test.ts` | **Unchanged** (SA-R13). FinanceTabs stays page-local; no `exchange_rates`; no repository or `server-only` import in finance files. New test files must not contain `exchange_rates` either (SA-2-6) |
| `KpiStrip.callers.pin`, `financeTiles.pin`, `financeRequest.pin` | **Not affected.** `ExchangeRatesKpis` is not edited, so every hash stays; the Finance strip is simply not rendered on this tab and the request string does not change |
| Authz **R8** | Nothing: one render entry point fewer after 2b; no exemption, cap stays 0 |

**2a — forced edits to existing tests (the complete list)**

| Test | Edit |
|---|---|
| `app/admin/finance/__tests__/financePage.render.test.tsx:1787` | The tab names list becomes four: Overview, Accounts, Plans & subscriptions, Exchange rates |
| `accountsTab.render.test.tsx` keyboard test (~209-239) | Wraps over four: Right from Plans, End, and Left from Overview land on Exchange rates; one more `ArrowRight` step; comment updated |
| `financeFilters.test.ts` lines **48, 52, 60** | `currencies` added: line 48 (`parseLink` builds every field), line 52 (`DEFAULTS`), line 60 (the `Object.keys(FINANCE_FILTER_SPEC)` list, `currencies` last) |
| `financeFilterBar.layout.render.test.tsx:39` | `currencies` added to `DEFAULTS: FinanceFilters` (a type error once the field is required) |
| `financeFilters.test.ts`, the test "fromFinanceQuery maps the Accounts tab's query back" (at `251472bb`: `it(` line 205, the edit at 214-215) | **DV-3, a forced edit SQ-23 missed, accepted in the 2a code review.** The expectation spreads `DEFAULTS`, which gained `currencies`, so it gains `currencies: undefined` with a one-line comment after `status: undefined` (the MK-4 form). `fromFinanceQuery` itself is unchanged (SQ-20 (3)). Recorded here in 2b (SA-2b-3) so the next reviewer does not take it for drift |

**2a — not touched:** G-4, G-6, the layoutFolder registry, `AdminSidebar.nav.test.ts`, `next.config.js`, `chargeChecksRedirect.config.test.ts` and the two rates render suites (the standalone page still renders the h1 they assert).

**2a — new tests (SA-2-6),** in `financePage.render.test.tsx` or a new `app/admin/finance/__tests__/exchangeRatesTab.render.test.tsx`: (1) select the tab from Overview → exactly one `replaceState`, `?tab=exchange-rates`, Accounts keys and `status` reset; rates table, Show select, rates KPIs and history render; no Finance strip, no Finance filter bar, no window `asOf`; exactly one h1, "Finance", with the rates purpose sentence. (2) `?tab=exchange-rates` with the finance read pending and with it failing → the rates render; no finance error, no finance loading text. (3) `?tab=exchange-rates&currencies=all` opens All; change Show; leave to Overview → one write, no `currencies` key; `?currencies=all` on Overview is repaired away. (4) `?account=<id>&tab=exchange-rates` → the business view, no tablist, the view not mounted, the URL keeps `account` only. (5) The finance request string on this tab equals the Overview literal. (6) `financeFilters.test.ts` gains the new repair rule (and null on the tab), and `currencies` is `EXCHANGE_RATES_FILTER_SPEC.currencies` by identity (`toBe`).

**2b — forced edits to existing tests (the complete list)**

| Test | Edit |
|---|---|
| `chargeChecksRedirect.config.test.ts:50-53` | "three redirects in all" → four (`toHaveLength(4)`, test name and comment) |
| `redundantPages` **G-6** (Exchange rates folder) | Drop `expect(files).toContain(EXCHANGE_PAGE)` and the "the REDUNDANT header is gone from the page" test (both read the deleted file); delete the then-unused `EXCHANGE_PAGE` constant; the guard's header gains an "Amended by slice 2" line. 6 non-test files remain (≥ 5 holds); the `fetch(` count stays **3**; the module logger rule is unchanged |
| `AdminSidebar.nav.test.ts` | **On-disk floor 29 → 28** (`expect(onDisk.length).toBeGreaterThanOrEqual(29)`, line 167, becomes 28); `expect(onDisk).toContain('/admin/exchange-rates')` (line 177) becomes `not.toContain` (the MK-4 Subscriptions precedent); `/admin/exchange-rates` leaves `UNLISTED`; the two stale comments (above `UNLISTED`, lines 89-91, and header line 28 "Both pages stay on disk") are rewritten. **`allHrefs` stays 28**; "never names `exchange-rates`" (line 203) stays. No new sidebar item |
| `layoutFolder.guard` C-14 registry (SQ-22) | The `'/admin/exchange-rates (Exchange rates)'` entry is removed and its five non-page files are appended to the `'/admin/finance (Finance)'` entry, with a comment in the Charge checks form ("the view stays in `app/admin/exchange-rates/` (SA-R13) and is listed here, and only here"). `changedByText.ts` is not added |
| `exchangeRates.render.test.tsx`, `exchangeRatesFilters.render.test.tsx` | Render `<ExchangeRatesView />` instead of `import ExchangeRatesPage from '../page'` (lines 44 and 34); the h1 assertion at `exchangeRates.render.test.tsx:173` becomes "the view renders no h1" (the one-h1 check lives in the new Finance tests) |

**2b — new test:** `app/admin/finance/__tests__/exchangeRatesRedirect.config.test.ts` per SQ-17 (§5.3.3).

### 5.4 Month-end rate (D-2): is a new table needed?

A month-end rate is "the rate in force at the end of the month". It can be recovered from `exchange_rate_history` if, and only if, **every** change to `rate_to_usd` writes a history row with the old rate, the new rate and the time. Then the month-end rate for a currency is the newest history row at or before month-end (or the current row, if it has not changed since).

- If slice 1b confirms the trigger exists and writes those three facts: **no new table now.** Slice 3 stays parked until a report needs it.
- If the trigger is missing or incomplete: slice 1b adds it (small, records each change), so rates edited from now on are not lost. Slice 3 stays parked.
- The audit entry from slice 1a (old → new) is a second record either way.
- History before today is whatever exists; the 2025-11-05 values are the only known starting point.

### 5.5 Slice 1c — Page refinements (D-7)

The user's comments 2, 4, 5 and 6 on the live page (§3.3). Comment 1 goes to slice 2; comment 3 was dropped by the user (§5.5.2). Code facts below were read from `origin/main` `0581637a`. Nothing here adds a table, a column, a migration or a write path. The `PATCH` route and the audit entries are unchanged. D-5 holds: the "A → B" in the Last change tile is two stored strings side by side, with no arithmetic and no percentage.

#### 5.5.1 Filter bar (comment 2)

**Pattern:** the shared admin filter bar `AdminFilterBar` (`app/admin/components/layout/AdminFilterBar.tsx`, Admin Layout Standard C-8, §5.5) with the URL state hook `useAdminFilters` + `textFilter` (`app/admin/components/layout/useAdminFilters.ts`, C-7, §5.6). The closest page is **Businesses** (`app/admin/users/usersFilters.ts`, L-4a): one status select kept in the URL, its default (`active`) never written (U-3), an unknown value ignored (U-4), and the search text held by the page and **never** written to the URL (layout standard U-1 exception (1), its D-6 (a)). Field markup follows `app/admin/business-os-invites/components/InviteFilters.tsx`: labelled native `<select>` and `type="search"` input on `ADMIN_FIELD_LABEL` / `ADMIN_FIELD_CONTROL`.

| Control | Spec |
|---|---|
| Show | Native select, label "Show": **Enabled only** (default), Disabled only, All. **In the URL**, like every other admin page filter: key **`currencies`** with values `disabled` and `all`; the default `enabled` is never written, so the plain URL opens Enabled only; any other value is ignored (SQ-8 ruling: `show` is taken by Finance's Accounts tab, SA-1c-1) |
| Search | `type="search"`, label "Search", placeholder "Code or name". Case-insensitive match on the currency code or name. **Held by the page, never written to the URL** (the layout standard's rule for all free text) |
| Clear | Resets Show and Search to their defaults; disabled at the defaults |
| Read at + Refresh | Unchanged from 1a |

- **Where the filter runs:** in the page, over the `GET` payload. The route keeps returning every currency (43 rows); it takes no filter parameter.
- **KPIs count every currency, never the filtered view. BA recommends this.** Under the default filter, "Enabled currencies" counted over the filtered rows would always read "N of N", which says nothing. Businesses hit the same trap (its tile had to say "shown" rather than "total", SA C-15 (a) in L-4a). The history list and the Last change tile ignore the filter too.
- A count line above the table: "Showing N of X currencies". When nothing matches: the shared empty state, "No currencies match these filters.", with Clear available.
- USD is enabled, so it shows under Enabled only and All.
- **A row switched off while "Enabled only" is shown:** BA suggests it stays in place, its chip now "Disabled", until the next Refresh or filter change, so the row and the keyboard focus do not vanish under the admin (SQ-9).
- **Slice 2 compatibility:** the same `ExchangeRatesView` will render inside a Finance tab, where several tabs share one address bar. The Plans tab already uses `status` and the Accounts tab uses `show`, so 1c uses `currencies` (SQ-8). In slice 2 the view's hook takes the `{ active }` option (layout L-9a, F-113), as Business OS AI does.

#### 5.5.2 ~~Country flag column (comment 3)~~ — dropped by the user

> **Dropped 2026-10-19.** The user answered BQ-1 with "skip this requirement, not needed". No Country column, no currency-to-region map, no flag component, no `CountrySelect` / `flagOf` change, no new dependency. FR-17 withdrawn; SQ-10 and SQ-11 moot (§13.4).

#### 5.5.3 History capped at 10 (comment 4)

- Today `HISTORY_LIMIT = 50` in `lib/admin/exchangeRates/exchangeRateRules.ts`. It is the one source: `ExchangeRatesRepository` re-exports it as `EXCHANGE_RATE_HISTORY_LIMIT` and uses it in `.limit(...)`. Change it to **10**. It stays fixed and never comes from the caller. The comments that say "50" are updated: route header, view header, `RateHistoryTable` header, repository.
- **Effect on the per-row History button.** Today it filters the loaded rows in the browser ("ILS: 2 of the newest 50"). With 10 rows, most currencies would show nothing. The options for SA (SQ-12):
  - (a) Keep filtering in the browser over the 10. Simplest, but the view is nearly always empty. BA is against it.
  - (b) **BA suggestion:** the `GET` takes an optional `?currency=XXX` (validated with the existing `currencyCodeSchema`) and returns that currency's newest 10. The overall list (and the Last change tile) still come from the plain read.
  - (c) Remove the per-row History button.

#### 5.5.4 Admin name instead of the id (comment 5)

- **Today** `RateHistoryTable` shows `formatShortId(row.changedBy)`, with the full uuid as the hover text.
- **Change:** the `GET` route turns each distinct `changed_by` in the history rows it returns into a display label, **on the server**, in this order:
  1. **The person's name**, from `profiles.full_name` (trimmed, non-empty), through `userProfileRepository.findAdminNamesByIds(ids)`. This is the Audit trail route's pattern (`app/api/admin/audit-trail/route.ts`, the user-names block; ADMIN_BOS_CLEANUP slice 4).
  2. **Otherwise the admin's email**, through `adminUserRepository.findEmailsByUserIds(ids)`. This is the AI model price history pattern (`app/api/admin/model-pricing/history/route.ts`, slice 9, SA SC9-1). It deliberately includes deactivated admins, because history is a permanent record and a former admin should still be named. The archiving route's `adminLabels` uses `listActive()`, which drops former admins, so it is not the pattern here.
  3. **Otherwise "Unknown user"**, which also covers a null `changed_by` (older rows may have one).
- **Lookup failure ≠ no name.** The Audit trail posture: log the failure, still answer 200 with rates and history, leave the labels out, and say so in the body (for example `nameLookup: 'failed'`). The page then shows the short id as today, never "Unknown user" (SQ-13).
- **Wire:** add `changedByLabel: string | null` to `ExchangeRateHistoryWire` (null only when the lookup failed). Whether `changedBy` (the uuid) stays as hover text is part of SQ-13; BA suggests it stays, for tracing.
- **Cost:** at most 10 distinct ids, so one `.in()` read per table, run after the history read.
- **Guards:** `lib/repositories/__tests__/adminReadMethods.guard.test.ts` already lets anything under `app/api/admin/**` call both methods, so the guard needs no edit. But both methods' header comments name their "only caller", so they must be updated to add this route.
- **Privacy.** This is fine because the page is admin-only (`requireAdminPage`) and so is the route (`requireAdmin`). The ids come from the history rows the route itself read, never from the request. The response adds only a display label for the admins who made the changes: no other profile field and no other user's data. Logs carry counts only, never a name or an email (both repository methods already behave that way). D-3 is unchanged: no business ever sees this.

#### 5.5.5 KPIs (comment 6)

The KPIs stay in `app/admin/exchange-rates/components/ExchangeRatesKpis.tsx`, on the existing `KpiStrip` / `KpiTile`. Two tiles, in this order:

| Tile | Spec |
|---|---|
| **Enabled currencies** | "N of X": N = rows with `isEnabled === true` (a database null reads as false), X = all rows. Counts the **whole payload**, not the filtered view (§5.5.1). **USD is counted** (it is a real, enabled currency; the old Stale tile excluded it only because its age could never clear). No status colour |
| **Last rate change** | From the newest history row (the route's order, newest `changed_at` first). Value: "ILS 3.65 → 3.70" (stored strings, shown as stored); old rate null → "ILS set to 3.70". Sub line: "by {label}, {formatUtc(changedAt)}"; the short id when the name lookup failed. No history → "No changes yet" |

- **Do on / off switches count as the "last action"?** No, not from this source. The history table records **rate changes only**: the trigger fires on `rate_to_usd` (§2.1 (b)), and switches are recorded only in the audit trail (`EXCHANGE_RATE_ENABLED_CHANGED`). **BA recommends rate changes only, from history**, with the tile named "Last rate change" so it does not claim more than it shows. Adding switches would need an audit-trail read in the `GET` (SQ-14).
- **The Stale tile is removed.** The per-row "Stale" `StatusChip` stays, unchanged (FR-8: 35 days, measured against `readAt`; USD is never stale, through `isRateStale`). The FR-8 clause about showing a count of stale rates is withdrawn by D-7.
- **Pin test:** `app/admin/components/layout/__tests__/KpiStrip.callers.pin.render.test.tsx` gets **additive cases only** for the new states: two tiles, no history, name lookup failed, old rate null. But it already pins three `ExchangeRatesKpis` cases (`A2 ExchangeRatesKpis loading`, `A2 ExchangeRatesKpis`, `A2 ExchangeRatesKpis none stale`), and replacing the tiles **necessarily changes those three hashes**. That is a named, forced change limited to the Exchange rates cases; every other caller's hash stays unchanged (SQ-15).

#### 5.5.6 Unchanged by 1c

- No migration, no new table or column. The `PATCH` route, the audit events and the 1b lockdown are untouched.
- D-5: nothing converts or totals money. D-6: no sidebar entry. G-2, G-4 and the sidebar `UNLISTED` entry stay.
- The SA-R3 Exchange rates page guard still allows only `fetch(` targets under `/api/admin/exchange-rates`. A `?currency=` read (SQ-12 (b)) stays on that path; Dev confirms the guard's matcher accepts a query string.
- `finance.source.guard` and CUR-3 are untouched. No 1c file lives under `app/admin/finance/`.
- No new dependency: `package.json` and the lockfile are untouched (the flag option (c) went with comment 3).

#### 5.5.7 Proposed split (small numbered slices)

| Slice | Covers | Touches | Path |
|---|---|---|---|
| **1c.1** | History capped at 10 (+ the per-currency read, SQ-12), names in the route, the two new KPI tiles with the Stale tile removed, the pin update | Route `GET`, rules constant, repository (per-currency read), wire type, `RateHistoryTable`, `ExchangeRatesKpis`, route / repository / render / pin tests | **Full cycle**: the admin route starts reading people's names (privacy) |
| **1c.2** | Filter bar only (the Country column was dropped by the user, §5.5.2) | `ExchangeRatesView`, a new filter spec, render and unit tests | **Short path** (UI-only, user's standing preference) |

**Order: 1c.1 → 1c.2 → slice 2.** Why this split: the Last change tile shows *who*, so names and KPIs belong together, while the filter is page-only. Each part is a few days at most. If SA prefers one 1c slice, nothing in the requirement changes except the §1 row (SQ-16).

### 5.6 Slice 1d — History window (D-8)

The user's 2026-10-20 request (D-8, verbatim in §3): the history shows the newest 10 rate changes **within a chosen period**, picked with a Window control like the Finance page's, default **This month**. The window applies to the history table and the per-currency History view only; the "Last rate change" tile stays all-time. Code facts below were read from `origin/main` `930a6cee` (2a #486 and 2b #487 merged, so the view renders inside Finance's Exchange rates tab). No table, column, migration or write path is added; the `PATCH` route, the audit entries and the 1b lockdown are untouched. D-5 holds: nothing converts or totals money.

#### 5.6.1 What exists to reuse

| Piece | Today |
|---|---|
| `app/admin/components/layout/DatePresets.tsx` | The Admin Layout Standard Window control (C-8, §5.5 parts 1 and 2): labelled group "Window" with Today, 7 days, 30 days, This month, Custom; the Custom row has From (UTC) / To (UTC) whole-date inputs and Apply. A preset applies at once; clicking the pressed preset goes back to `defaultValue`; Apply with both empty goes back to the default; only "From after To" is refused here. Props: `value`, `defaultValue`, `onChange`, optional `extras`, optional `requireBothDates`. Exports `ADMIN_FIELD_LABEL`, `ADMIN_FIELD_CONTROL`, `AdminFieldSpacer` |
| `app/admin/components/layout/adminWindow.ts` | Pure. `AdminWindowValue` (`none` / `preset` / `custom` / `linked` / `extra`), `windowFilter()` owning the URL keys `range` / `from` / `to`, `parseWindow`, `serialiseWindow`, `windowEquals`, `resolveWindow(value, now)` → whole UTC dates, `ADMIN_WINDOW_LABELS` ("Today", "7 days", "30 days", "This month", "Custom") |
| `app/admin/components/adminWindowPresets.ts` | Pure and isomorphic (page and route both import it). `ADMIN_WINDOW_PRESETS` = `today`, `7d`, `30d`, `this_month`; `resolveAdminWindow(preset, now)` → inclusive UTC dates (`this_month` = the 1st of the current UTC month to today; `7d` / `30d` include today); `isRealDate`, `todayUtc`, `inclusiveDays`, `customRangeProblem` (from ≤ to, to not after today UTC, at most `ADMIN_WINDOW_MAX_DAYS` = 92 inclusive days). Its header: "the route re-resolves the preset with its own clock, so the URL is input, never authority" |
| `app/admin/exchange-rates/components/ExchangeRatesView.tsx` | Three literal `fetch(` sites: plain `GET` (rates, newest 10 changes, `readAt`), `GET ?currency=<CODE>` (the open panel), `PATCH /<CODE>`. KPIs and the overall history come from the plain `GET`; the per-currency read feeds the history panel only (SA-1c-2) and is re-run after a rate save and on Refresh. The history (`RateHistoryTable`) renders below the rates table, inside `exchange-rates-content` |
| `app/admin/exchange-rates/components/RateHistoryTable.tsx` | Caption "The newest {HISTORY_LIMIT} changes" when the list reached the cap, else "{n} change(s), newest first"; per-currency prefix "{CODE}: ". Empty: "No rate changes recorded yet." / "No recent rate changes for {CODE}." |
| `app/admin/exchange-rates/components/ExchangeRatesKpis.tsx` | "Last rate change" = `payload.history[0]` (line 57). **Once the history is windowed, `history[0]` is the newest change in the window, not of all time** (see §5.6.3) |
| `app/api/admin/exchange-rates/route.ts` | `requireAdmin` first; repeated query key → 400; `exchangeRatesQuerySchema` = `z.object({ currency: currencyCodeSchema.optional() }).strict()`, so any other key → 400; unknown code → 404; `resolveLabels` names editors, all-or-nothing |
| `lib/repositories/ExchangeRatesRepository.ts` | `listRecentHistory()` and `listRecentHistoryForCurrency(code)`: `.order('changed_at', { ascending: false }).limit(EXCHANGE_RATE_HISTORY_LIMIT)` |
| `lib/admin/exchangeRates/exchangeRateRules.ts` | `HISTORY_LIMIT = 10`, the one source (fixed, never caller-supplied) |
| Index | `idx_exchange_rate_history_changed_at` (btree on `changed_at`), recorded in `20261082`. No migration needed |

#### 5.6.2 The Window control

| Part | Spec |
|---|---|
| Place | **Directly above the history table**, not in the top filter bar (the user: "above the history exchange rate"). One control for both history views: the overall list and the per-currency panel (they are never shown together) |
| Control | The shared `DatePresets`, unchanged: Today, 7 days, 30 days, This month, Custom (From (UTC) / To (UTC), Apply). No `extras`. No business picker (Finance's "Only accounts with a business profile…" note does not apply). `DatePresets.tsx`, `adminWindow.ts` and `adminWindowPresets.ts` are **not edited** |
| Default | **This month** (`{ kind: 'preset', preset: 'this_month' }`). Clicking the pressed preset goes back to This month (the control's own rule) |
| Time zone | UTC, like every admin window (SQ-29) |
| State | Page state of the view, not the address bar (BA default, SQ-25) |
| What it filters | The overall history list and the per-currency History view. **Not** the rates table, **not** the Show / Search filter, **not** either KPI tile |
| Read at / Refresh | Unchanged (the top bar). Refresh re-reads with the window that is applied |

#### 5.6.3 Server-side filtering and the all-time "Last rate change"

- **The window is applied on the server.** The plain `GET` and the per-currency `GET` take the window and return the **newest `HISTORY_LIMIT` (10) changes with `changed_at` inside it**, newest first. They never return the newest 10 overall for the page to trim: a window holding 3 changes shows those 3, and a window holding 40 shows its newest 10.
- **Window bounds:** the inclusive UTC dates `from`..`to` mean `changed_at >= from 00:00:00Z` and `changed_at < (to + 1 day) 00:00:00Z` (SQ-28). The repository applies `.gte` / `.lt` on `changed_at`, the existing order and the fixed limit; the existing index serves it.
- **"Last rate change" stays all-time (D-8).** Today the tile reads `history[0]`; after this slice `history` is windowed, so the plain `GET` returns the all-time newest change **separately**, as a new field `lastChange: ExchangeRateHistoryWire | null` (null when there is no history at all). The tile reads `lastChange`, never `history[0]`. **Flagged for SA (SQ-31):** this amends SA-1c-2 ("Last rate change" = `history[0]`). BA suggestion: a repository read of the newest one row (`limit(1)`, no window), and the label lookup covers its editor too (at most 11 distinct ids, still one `.in()` per source, the same all-or-nothing rule).
- `lastChange` is on the **plain** `GET` only. The per-currency payload (`ExchangeRateHistoryPayload`) does not carry it, so the tile can still never be fed from it (SA-1c-2).
- The rates and the "Enabled currencies" tile are unchanged.

#### 5.6.4 Captions and empty states

Captions **name the period**, so an admin never reads a windowed list as "all history".

| View | Caption (BA wording; Dev may adjust words, not meaning) |
|---|---|
| Overall, list at the cap | "The newest 10 changes this month" / "… today" / "… in the last 7 days" / "… in the last 30 days" / "… from 2026-10-01 to 2026-10-15 (UTC)" |
| Overall, below the cap | "3 changes this month, newest first" (same period wording) |
| Per currency | Prefixed "ILS: ", e.g. "ILS: 2 changes this month, newest first" |
| Empty, overall | "No rate changes in this period." |
| Empty, per currency | "No rate changes for ILS in this period." |

The cap in the caption comes from `HISTORY_LIMIT`, never a literal (SA-1c-4). The period wording comes from one pure helper keyed by the window value, so the two views cannot disagree.

#### 5.6.5 Behaviour details

- A window change re-reads the history for the visible view: the per-currency read when a panel is open, else the plain read (SQ-34).
- After a rate save, the re-reads that already happen (SA Q-3) carry the applied window.
- Leaving the Exchange rates tab and coming back starts again at This month (Finance unmounts hidden panels; SQ-30).
- A refused custom range (From after To) is shown by the control itself and sends nothing.

#### 5.6.6 Unchanged by 1d

- No migration, table, column or index. `PATCH`, audit events, the 1b lockdown, `HISTORY_LIMIT` (still 10), the name-lookup rules (SQ-13) and `UNKNOWN_USER_LABEL`.
- The rates table, the Show / Search filter (`currencies`), held rows (SQ-9), the "Enabled currencies" tile.
- `DatePresets.tsx`, `adminWindow.ts`, `adminWindowPresets.ts`, `useAdminFilters.ts`: reused, not edited.
- Finance: no file under `app/admin/finance/` changes; `FINANCE_FILTER_SPEC`, `financeFilterRepair`, the finance request string and `financeRequest.pin` are untouched (if SQ-25 is ruled as BA suggests). `finance.source.guard` and CUR-3 unchanged.
- `redundantPages` G-6: the folder's literal `fetch(` count stays **3** (the two `GET` sites gain query parameters; no new call site; SQ-33).
- D-5, D-6: nothing converts money; no sidebar change.

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
| FR-8 | Each row shows its age. A rate older than 35 days shows a clear "Stale" status (text, not colour alone). The header or KPI area shows how many enabled rates are stale (**count withdrawn by D-7 in 1c; the row status stays**, FR-22) | 1a |
| FR-9 | A save failure shows a short message on the page and leaves the previous value showing; it never shows raw internal errors | 1a |
| FR-10 | Only platform admins can read or change rates through the route (`requireAdmin`); everyone else gets the standard refusal | 1a |
| FR-11 | After 1b, the browser roles cannot insert, update or delete either table; signed-in users can still read enabled rows | 1b |
| FR-12 | Exchange rates is a tab on `/admin/finance`; the existing finance view is the default tab and is unchanged | 2a |
| FR-13 | No screen, route or calculation converts money or totals across currencies with these rates (D-5) | All |
| FR-14 | The page has the shared admin filter bar: Show (Enabled only by default, Disabled only, All), Search (code or name), Clear, Read at, Refresh (§5.5.1) | 1c.2 |
| FR-15 | Show is kept in the URL under the key `currencies` (values `disabled` / `all`; the default `enabled` is never written; an unknown value is ignored); the search text is never written to the URL | 1c.2 |
| FR-16 | The filter narrows the rates table only. The KPIs, the history list and the Last change tile always count every currency. A count line says how many currencies are shown; an empty result shows the shared empty state | 1c.2 |
| FR-17 | ~~Country column with flags~~ — **withdrawn: dropped by the user** 2026-10-19 ("skip this requirement, not needed", §5.5.2) | — |
| FR-18 | The history list shows the newest **10** rate changes (fixed, never caller-supplied); the per-currency view follows SQ-12 | 1c.1 |
| FR-19 | "Changed by" shows the admin's name, else their admin email, else "Unknown user", resolved on the server; a failed lookup shows the short id, not "Unknown user" (§5.5.4) | 1c.1 |
| FR-20 | KPI "Enabled currencies": N of X, over all currencies, USD included | 1c.1 |
| FR-21 | KPI "Last rate change": the newest history row as "CODE A → B", with who and when; "No changes yet" when there is none. On / off switches are not counted (SQ-14) | 1c.1 |
| FR-22 | No Stale KPI tile. The per-row Stale status of FR-8 stays unchanged | 1c.1 |
| FR-23 | The Finance tablist has a fourth and last tab, "Exchange rates", at `?tab=exchange-rates`, keyboard-usable like the other three (§5.3.2) | 2a |
| FR-24 | On that tab the Finance KPI strip, the Finance filter bar and the window "as of" line are not shown; the rates view's own KPIs, filter bar and states are; the page has exactly one h1, "Finance" (§5.3.2, SQ-21) | 2a |
| FR-25 | The rates on the tab show whether or not the finance read has finished or failed, with no finance error or loading state on the tab (SQ-19) | 2a |
| FR-26 | `/admin/exchange-rates` sends the admin to `/admin/finance?tab=exchange-rates` by a temporary `next.config.js` redirect that keeps the query; the page file is deleted (SQ-4, SQ-17 (a)) | 2b |
| FR-27 | No sidebar change: no Settings link and no new item (D-7) | 2a |
| FR-28 | A Window control (the shared `DatePresets`: Today, 7 days, 30 days, This month, Custom with From (UTC) / To (UTC) and Apply) sits directly above the history table; default **This month**; UTC (D-8, §5.6.2) | 1d |
| FR-29 | The history table shows the newest **10** rate changes whose `changed_at` lies **inside the window**, newest first, selected **on the server** (never the newest 10 overall trimmed in the page). Amends FR-18 | 1d |
| FR-30 | The per-currency History view follows the same window, with the same server-side rule | 1d |
| FR-31 | The "Last rate change" tile stays **all-time**: it reads a separate all-time `lastChange` from the plain `GET`, never the windowed list. Amends SA-1c-2 (SQ-31) | 1d |
| FR-32 | Captions name the period ("this month", "today", "in the last 7 days", "in the last 30 days", "from A to B (UTC)"), overall and per currency; the cap comes from `HISTORY_LIMIT` | 1d |
| FR-33 | An empty window shows "No rate changes in this period." (per currency: "No rate changes for {CODE} in this period.") | 1d |
| FR-34 | The window does not affect the rates table, the Show / Search filter or the "Enabled currencies" tile | 1d |

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

### Slice 1c

**1c.1 — history, names, KPIs**

- [ ] The history list shows at most 10 rows, newest first; a route test pins the limit (a constant, never read from the request).
- [ ] The per-currency History view behaves per the SQ-12 ruling: `GET ?currency=XXX` returns that currency's newest 10 in its own payload type.
- [ ] SQ-12 query checks (route tests): an unknown query key, a repeated `currency` or a badly shaped code → **400**, nothing read; a valid code with no row → **404**.
- [ ] "Changed by" shows the name; with no name, the admin email (a deactivated admin included); with neither, "Unknown user". One route test per case.
- [ ] A history row with a null `changedBy` shows "Unknown user", whether the lookup succeeded or failed (nothing was looked up for it).
- [ ] If the name lookup fails, the `GET` still answers 200 with rates and history, the page shows the short id, and the failure is logged. No log line holds a name or an email.
- [ ] The name lookup is all-or-nothing: **any** failure (returned or thrown, either source) gives 200 with `nameLookup: 'failed'` and the `changedByLabel` of **every looked-up editor** null; never a half-resolved list. A row with no `changedBy` still reads "Unknown user" (SA workplan ruling Q-1, 2026-10-19).
- [ ] The response adds only the display label: no other profile field, and no id taken from the request.
- [ ] The KPI strip has exactly two tiles: "Enabled currencies" (N of X, all currencies, USD counted) and "Last rate change" (CODE A → B, who, when), or "No changes yet".
- [ ] There is no Stale tile; every rate older than 35 days still shows the Stale chip on its row; USD never does.
- [ ] `KpiStrip.callers.pin`: every non-Exchange-rates hash unchanged; the Exchange rates cases follow the SQ-15 ruling; the new cases are appended.
- [ ] Nothing does arithmetic on a rate (no difference, no percentage, no total): D-5.

**1c.2 — filter bar** (the Country column was dropped by the user, §5.5.2)

- [ ] Opening `/admin/exchange-rates` shows only enabled currencies; Show reads "Enabled only"; the URL has no `currencies` key (`enabled` is never written).
- [ ] Disabled only and All work and are written to the URL as `currencies=disabled` / `currencies=all`; opening that URL reproduces the view; an unknown value falls back to Enabled only.
- [ ] Search matches code or name, case-insensitive, and never appears in the URL.
- [ ] Clear returns to the defaults and is disabled at the defaults; Read at and Refresh behave as in 1a.
- [ ] The KPI figures are identical under Enabled only, Disabled only and All (render test).
- [ ] The count line is right; a filter that matches nothing shows the empty state.
- [ ] Switching a currency off under "Enabled only" behaves per the SQ-9 ruling: the row stays visible with its chip "Disabled" (focus stays on its switch) until **Refresh**, or a filter or search change; after Refresh it is gone. One render test.
- [ ] ~~Country column~~ — dropped by the user 2026-10-19 ("skip this requirement, not needed").
- [ ] The bar follows the layout standard (`role="search"` named "Filters", labelled native controls); the existing layout and Exchange rates guards stay green.

### Slice 1d — History window (FR-28 to FR-34)

- [ ] On `/admin/finance?tab=exchange-rates` a Window control (Today, 7 days, 30 days, This month, Custom) sits directly above the history table, with **This month** pressed on first open.
- [ ] Under This month the history shows only changes dated this UTC month, at most 10, newest first. A route test with more than 10 rows in the window and more outside it proves the 10 returned are the **newest 10 inside the window** (the selection is on the server, not trimmed in the page).
- [ ] Today, 7 days and 30 days each narrow the list as `resolveAdminWindow` defines them (UTC, including today); Custom with From / To applies whole UTC dates with an inclusive end (a change at `to` 23:59:59Z is in, one at `to + 1` 00:00:00Z is out).
- [ ] Opening a currency's History shows that currency's newest 10 changes **in the same window**; changing the window while the panel is open re-reads that currency's history.
- [ ] The "Last rate change" tile shows the **all-time** newest change whatever the window: with no change this month it still shows the last change (e.g. from a previous month), never "No changes yet" while history exists. It reads `lastChange`, never `history[0]` (render test with a window that excludes the newest change).
- [ ] `lastChange` is on the plain `GET` only; the per-currency payload has no `lastChange`. Its editor gets a label under the same all-or-nothing name lookup (SQ-13).
- [ ] An empty window shows "No rate changes in this period." (per currency: "No rate changes for {CODE} in this period."); the caption names the period in every state.
- [ ] Query validation per the SQ-26 ruling: a bad, one-sided or reversed window, an unknown key or a repeated key → **400**, nothing read; the history limit is still the constant 10 and never comes from the request.
- [ ] The rates table, Show / Search, held rows and "Enabled currencies" behave exactly as before under every window (render test).
- [ ] Per the SQ-25 ruling: switching the history window writes nothing to the address bar (BA default), and the Finance request string on the tab is unchanged (`financeRequest.pin` green unedited).
- [ ] Leaving the tab and coming back shows This month again (SQ-30).
- [ ] `redundantPages` G-6 `fetch(` count still **3**; `KpiStrip.callers.pin` per the SQ-31 / SQ-32 ruling (BA expects no hash to move); no file under `app/admin/finance/` or `lib/business-os/finance/` changes; no migration.
- [ ] Nothing does arithmetic on a rate (D-5).

### Slice 2

Refreshed 2026-10-20 against `c38ad4f4` (§5.3); split into 2a and 2b per SA-2-4 (§13.5). 2b starts from `origin/main` after 2a merges, not stacked.

**2a — the tab** (FR-23 to FR-25, FR-27)

- [ ] `/admin/finance` with no `?tab=`, and with `tab=accounts` or `tab=plans`, looks and behaves exactly as before. Existing finance tests stay green; the only edits to them are the 2a forced edits in §5.3.4 (tab names list, keyboard wrap over four, `currencies` at `financeFilters.test` lines 48 / 52 / 60, `financeFilterBar.layout.render.test.tsx:39` `DEFAULTS`).
- [ ] The tablist reads Overview, Accounts, Plans & subscriptions, Exchange rates. Left / Right wrap over four, Home / End, Enter / Space selects, roving `tabIndex`, manual activation (the existing FinanceTabs behaviour).
- [ ] **One write per tab switch:** selecting Exchange rates from any tab writes `?tab=exchange-rates` in exactly one `replaceState` and resets the Accounts keys and `status`; leaving it for Overview, Accounts or Plans is also exactly one write. Opening `?tab=exchange-rates` selects it.
- [ ] `/admin/finance?tab=exchange-rates` shows the rates table, filter bar (Show, default Enabled only, `currencies` in the URL), KPIs (Enabled currencies, Last rate change) and history, with the same edit and on / off behaviour as 1c.
- [ ] On that tab there is no Finance KPI strip (nor its placeholders), no Finance filter bar (window, business, Clear, Read at, Refresh) and no window "as of" line.
- [ ] **Exactly one h1, "Finance"**, on that tab, followed by the rates purpose sentence (`EXCHANGE_RATES_PURPOSE`); the rates view renders no h1 of its own (SQ-21). The standalone `/admin/exchange-rates` page keeps its "Exchange rates" header until 2b.
- [ ] **Rates visible while the finance read is pending or failing:** with the finance read still loading, and with it failed, the rates render; **no finance error, no finance loading text** and no `aria-busy` tied to the finance read appear on the tab (SQ-19 (i)).
- [ ] **`currencies` behaviour (SQ-20):** `FINANCE_FILTER_SPEC.currencies` is `EXCHANGE_RATES_FILTER_SPEC.currencies` by identity (`toBe`), and it is the spec's last key. `?tab=exchange-rates&currencies=all` opens All; a Show change is written once by the view and causes no finance request; leaving the tab leaves no `currencies` key in the address bar; `?currencies=all` on any other tab is repaired away by the new `financeFilterRepair` rule (which returns nothing on the tab). The view is rendered without an `active` prop.
- [ ] **The business wins (SQ-24):** `?account=<id>&tab=exchange-rates` shows the business view with no tablist, the rates view is not mounted, and the URL keeps `account` only (the tab and any `currencies` dropped by the existing rule 2 and the new rule).
- [ ] **Request string unchanged:** the finance request string on every tab, this one included, equals today's (on this tab, the Overview literal); `financeRequest.pin` green unedited; the finance read keeps running on the tab (SQ-19 (ii)).
- [ ] No finance figure changes; `finance.source.guard` and `app/admin/finance/__tests__/source.guard.test.ts` unchanged and green; no file under `app/admin/finance/` (new tests included) contains `exchange_rates`.
- [ ] `FinanceView` and `financeFilters.ts` import from the rates folder by relative path without naming `/admin/exchange-rates` (SQ-18); `redundantPages` G-4 unedited and green.
- [ ] The sidebar is unchanged (no Settings link, no new item; `allHrefs` 28).
- [ ] `KpiStrip.callers.pin` unchanged (no hash moves).
- [ ] Nothing does arithmetic on a rate (D-5).

**2b — the old URL** (FR-26)

- [ ] `next.config.js` has exactly one redirect for `/admin/exchange-rates`: destination `/admin/finance?tab=exchange-rates`, `permanent: false`, no `has` (SQ-17 (a)); `app/admin/exchange-rates/page.tsx` is deleted.
- [ ] The new `exchangeRatesRedirect.config.test.ts` passes: no query → `{ tab: 'exchange-rates' }`; `currencies=all` → `{ tab: 'exchange-rates', currencies: 'all' }`, read as the tab and as All; an incoming `tab=accounts` → `tab: 'exchange-rates'` (the destination wins); `currencies=junk` → the default.
- [ ] A non-admin following the old URL is still refused by the admin layout. Authz R8 green with no new exemption (cap 0).
- [ ] Existing tests are amended only as the 2b list in §5.3.4 says (`chargeChecksRedirect` four, G-6, `AdminSidebar.nav` on-disk floor 29 → 28 and `not.toContain`, layoutFolder registry per SQ-22, the two rates render suites); `allHrefs` stays 28; G-4 unedited.
- [ ] `git diff --stat` shows no file under `app/api/admin/exchange-rates/`, `lib/admin/exchangeRates/`, `lib/repositories/` or `lib/business-os/finance/`; `next.config.js` gains no `console.*`.

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
- ✅ **Done 2026-10-20** (comment reworded to name the Finance tab). Follow-up from slice 2b (SA Q-1 (d)): the header comment at `lib/repositories/ExchangeRatesRepository.ts:3` still calls the table the one "behind `/admin/exchange-rates`". That page was deleted in 2b, and the address now redirects to Finance's Exchange rates tab. Reword the comment the next time the repository is edited for a reason of its own. 2b keeps `lib/repositories/` out of its diff (§8).

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

**Slice 1c (D-7).** SQ-7's tile is replaced by the user's choice (FR-20 to FR-22); the questions below are the technical forks only.

| # | Question | BA suggestion |
|---|---|---|
| SQ-8 | URL key and values for Show | Key `show`, values `disabled` / `all`, default `enabled` never written (Businesses' `status` pattern). Not `status`: the Finance Plans tab already owns it, and slice 2 puts this view in the same address bar. **→ SA ruling applied: key `currencies`** (values `disabled` / `all`, default `enabled` never written), because `show` is Finance's Accounts key (§13.4, SA-1c-1) |
| SQ-9 | A row switched off while "Enabled only" is shown | It stays in place, chip "Disabled", until the next Refresh or filter change; focus stays on its switch |
| SQ-10 | `flagOf` is private to `components/ui/CountrySelect.tsx` | Move it to one shared pure helper (for example under `lib/geo/`) used by both; `CountrySelect` behaviour unchanged. Or copy it, if SA prefers no cross-area edit. **Moot:** comment 3 dropped by the user |
| SQ-11 | How flags are drawn (§5.5.2 (a) emoji, (b) code text badge, (c) `country-flag-icons` SVG as a declared direct dependency) | (a) with `aria-label` and the country name as `title`. (c) only if the user wants real pictures on Windows (BQ-1) and SA accepts the dependency. **Moot:** comment 3 dropped by the user |
| SQ-12 | The per-currency History view once the list is 10 rows | (b): optional `?currency=XXX` on the same `GET`, validated with `currencyCodeSchema`, returning that currency's newest 10. Unknown code → 404, like `PATCH` |
| SQ-13 | Name lookup: sources, order, failure, wire shape | `profiles.full_name` (`findAdminNamesByIds`) → `admin_users.email` incl. deactivated (`findEmailsByUserIds`) → "Unknown user". On failure: 200, labels left out, `nameLookup: 'failed'`, page shows the short id. Add `changedByLabel`; keep `changedBy` as hover text. Update both methods' "only caller" header comments |
| SQ-14 | Does "Last rate change" include on / off switches? | No: rate changes only, from history. Switches would need an audit-trail read in the `GET` |
| SQ-15 | `KpiStrip.callers.pin`: the three existing `ExchangeRatesKpis` hashes must change | Re-pin those three as a named, forced change (every other hash unchanged) and append the new cases |
| SQ-16 | Split 1c into 1c.1 (history, names, KPIs) and 1c.2 (filter, flags), or build one slice? | Split, as §5.5.7 |

**Slice 2 (refreshed 2026-10-20, §5.3).** Rulings already folded in, not re-asked: SQ-4 (redirect, tab key `exchange-rates`), SA-R13 (the view stays outside `app/admin/finance/`, both finance guards unchanged), SA-1c-1 (spec, repair, `{ active }`), the 1c.2 code review's DV-1 forward note (G-4 and the alias import).

| # | Question | BA suggestion |
|---|---|---|
| SQ-17 | SQ-4 says a **server** `redirect()`. Authz R8 requires every `app/admin/**` render entry point to be a client component, with empty exemption lists and caps 0, so a Server Component `page.tsx` fails it. Which mechanism (§5.3.3 (a) `next.config.js` + page deleted, (b) client page calling `redirect()`, (c) server page + R8 exemption)? | **(a)**, the Money MK-4 precedent (`/admin/subscriptions` → `/admin/finance?tab=plans`): temporary, query kept, R8 untouched, page deleted; new config test, the "three redirects" count becomes four. Then the §5.3.4 (a) amendments to G-6, `AdminSidebar.nav` and the layoutFolder registry apply |
| SQ-18 | How `FinanceView` (or a new finance tab file) imports `ExchangeRatesView` without tripping G-4 | Relative import `'../../exchange-rates/components/ExchangeRatesView'` with a comment giving the reason (DV-1 precedent, already approved for the view's own sibling import). No G-4 amendment |
| SQ-19 | On the Exchange rates tab: (i) the tablist and panels render only inside `data && !error`; (ii) the finance read runs on every tab. Should the rates tab render regardless of the finance read, and should the read be skipped there? | (i) Yes: on this tab render the tablist and the rates panel whatever the finance read's state; Overview / Accounts / Plans unchanged. (ii) Keep the read (as Plans does): the request string and `financeRequest.pin` stay unchanged, and switching back to Overview has its data. Skipping it is a later optimisation |
| SQ-20 | The `currencies` key across tabs. Finance's hook keeps keys it does not own on write, so after leaving the tab `currencies=all` would linger on Overview, against L-9a ("the address bar describes the visible tab only"). How is it dropped, and is `active` simply "tab shown" or also "the URL already names the tab" (Business OS AI `owns()`)? | Leaving the tab removes `currencies` in the same single write. Smallest diff BA can see: a `currencies` field in `FINANCE_FILTER_SPEC` that reuses the rates spec's field (relative import, SQ-18) and that `onSelectTab` / `financeFilterRepair` reset when the tab is not Exchange rates (as `status` for Plans), with the view's hook `active` only when the tab is shown **and** the URL names it, so two hooks never write the key in the same render. SA may prefer the Business OS AI save / drop / restore mechanism |
| SQ-21 | One h1. The view renders `AdminPageHeader` (h1 "Exchange rates"); inside Finance that is a second h1. Header-less prop, or remove the view's header? Which purpose line on this tab? | If SQ-17 is (a), the view has no page of its own any more, so it **drops its `AdminPageHeader`**, and Finance's header shows the view's purpose sentence on this tab (exported from the view's folder; F-68 "purpose follows the tab"), with no `asOf`. Under (b), a `showHeader` prop (default true) instead. The `ExchangeRatesKpis` file is not touched either way, so `KpiStrip.callers.pin` does not move |
| SQ-22 | layoutFolder C-14 registry: the `'/admin/exchange-rates (Exchange rates)'` entry lists `page.tsx` and relies on some file importing `AdminPageHeader` | Under (a): remove the entry and add the five rates files (`exchangeRatesFilters.ts`, `ExchangeRatesView`, `ExchangeRatesKpis`, `ExchangeRatesTable`, `RateHistoryTable`) to the Finance entry, as Charge checks lists `business-os-llm` files under its Finance page; every file stays in exactly one entry. Under (b): keep the entry |
| SQ-23 | Approve the named forced edits to existing tests (§5.3.4): finance tab names list, keyboard wrap over four, the spec's tab values, the two rates render suites rendering the view instead of `../page`, the G-6 page-only checks, `AdminSidebar.nav` on-disk / `UNLISTED`, `chargeChecksRedirect` "three" → four | Approve as listed; Dev shows each diff in the handover and nothing else in those files changes |
| SQ-24 | A link that combines a business with `tab=exchange-rates` | Keep the existing rule: the business wins and the tab is dropped (rule 2 of `financeFilterRepair`, unchanged). No special case for rates, which have no business |

**Slice 1d (D-8, §5.6).** Technical forks only; the business choices are settled by the user's two 2026-10-20 messages.

| # | Question | BA suggestion |
|---|---|---|
| SQ-25 | **URL collision.** The Admin Layout Standard window owns the URL keys `range` / `from` / `to` (`windowFilter`). On the Finance Exchange rates tab, Finance's own Window already owns those keys (`FINANCE_FILTER_SPEC.window`, alias `preset`); it is hidden on this tab but its hook is mounted, so a history window written as `range=7d` would be parsed by Finance as **its** window (and change the finance request string). Keep the history window in page state only, or give it distinct keys? | **Page state only** (a `useState` in `ExchangeRatesView` holding an `AdminWindowValue`, default This month). No URL key, no edit to `FINANCE_FILTER_SPEC` or `financeFilterRepair`, `financeRequest.pin` untouched. Cost: the history window is not in a shared link and a reload returns to This month, which matches the user's "default is This month". Distinct keys (e.g. `historyRange` / `historyFrom` / `historyTo`) would need a second `windowFilter` with renamed keys, a Finance repair rule for the other tabs and new pins, for no current need |
| SQ-26 | **Query shape on the `GET`, and its validation.** Today the query schema is `.strict()` and allows only `currency`. Dates or instants? Which keys? | Extend `exchangeRatesQuerySchema` (still `.strict()`, repeated key still refused first) with **`from` and `to` as whole UTC dates** `YYYY-MM-DD`, validated with `isRealDate` and `from ≤ to`; **both required together** (one without the other → 400); both absent → the server's default window, This month (so an old client or a test without params still gets a bounded, defined answer). Not instants: the control only produces whole dates, and dates keep the query free of time-zone text. Applies to both the plain and the per-currency read (`currency` + `from` + `to`). No 92-day cap (`ADMIN_WINDOW_MAX_DAYS` protects Finance's aggregates; here the limit is a fixed 10 rows on an indexed column); SA may add it |
| SQ-27 | **Where the window is resolved** (client vs server) | **The page resolves** the value to dates with `resolveWindow(value, new Date())` and sends `from` / `to`; the server validates and converts to instants (SQ-28). Simplest: one query shape for presets and Custom, and the caption and the request come from the same dates. Alternative (Finance's precedent, "the URL is input, never authority"): send `range=this_month` and let the server re-resolve with its own clock. That matters for Finance's money aggregates; for a list of 10 rows a clock skew at midnight UTC is harmless. SA's call |
| SQ-28 | **Custom bounds** | Whole UTC dates, **inclusive end**: `changed_at >= from T00:00:00Z` and `changed_at < (to + 1 day) T00:00:00Z` (half-open on the next midnight, so a change at 23:59:59.999Z on `to` is included and no `23:59:59` literal is needed). `DatePresets` with **`requireBothDates`** (Finance also requires both dates for Custom), so a one-sided custom window never reaches the route. `to` after today: allowed by the route (harmless), though the control's dates normally end today |
| SQ-29 | **UTC** for Today / 7 days / 30 days / This month | **Yes, UTC**, as the rest of admin (`resolveAdminWindow`, the "From (UTC) / To (UTC)" labels, `formatUtc` in the table). No local-time variant |
| SQ-30 | **Does the window reset when the admin leaves the tab?** | **Yes**, by construction: Finance unmounts a hidden panel (SQ-20 (4)), so the view's page state starts at This month each time the tab opens, and on reload. No extra code. Within the tab, the window survives Refresh, a rate save, a Show / Search change and opening / closing a currency's History |
| SQ-31 | **"Last rate change" stays all-time (flagged).** Today the tile reads `payload.history[0]` (SA-1c-2); once `history` is windowed that would be the newest change in the window. Shape of the separate all-time value? | Add **`lastChange: ExchangeRateHistoryWire \| null`** to `ExchangeRatesPayload` (plain `GET` only; not on `ExchangeRateHistoryPayload`). Repository: a new `findLatestChange()` (newest one row, no window, same columns and order), or `listRecentHistory` returning it alongside; SA picks. The label lookup runs once over the distinct editors of the windowed rows **plus** `lastChange` (≤ 11 ids, one `.in()` per source), same all-or-nothing rule. `ExchangeRatesKpis` reads `payload.lastChange`. SA-1c-2's "Last rate change = `history[0]`" is amended to "= `lastChange`" |
| SQ-32 | **`KpiStrip.callers.pin`**, since the tile's data source changes | The tile's rendered output does not change, only where it reads from. Fixtures gain `lastChange` equal to today's `history[0]` (and `null` in the no-history fixture), so **every hash stays unchanged**; one additive case may be appended ("last change outside the window": `history` empty, `lastChange` set). If SA prefers no new case, the render test in §8 1d covers it |
| SQ-33 | **`redundantPages` G-6 fetch count** | **Stays 3.** The plain `GET` and the per-currency `GET` gain query parameters at their existing literal call sites; no new `fetch(` site, and no folding of sites into a variable to dodge the count (SQ-12 ruling). Dev confirms `ALLOWED_FETCH` accepts the added `?from=…&to=…` on the plain read (today that site has no query string) |
| SQ-34 | **What a window change re-reads** | The plain `GET` (rates + windowed history + `lastChange`) when no panel is open; only the per-currency `GET` when a panel is open (the overall list is not visible then). BA accepts that a plain re-read also releases held rows (SQ-9: emptied on every successful read). If SA wants the rates untouched by a window change, the alternative is a history-only read, which would be a fourth `fetch(` site and a new payload shape: BA does not suggest it |

---

## 11. Open questions (business)

None blocking. All business choices are settled by D-1 to D-6. The CLAUDE.md wording (§3.1) needs the user's sign-off because it edits the user's root document.

**Slice 1c (D-7).** One question for the user — **closed**:

| # | Question | Default if unanswered |
|---|---|---|
| BQ-1 | On Windows (your machine), flag emoji show as two letters (for example "IL") rather than a picture. Are the letters acceptable, or do you want real flag pictures? Pictures need one small flag package added, which SA must approve | Letters on Windows (emoji, §5.5.2 (a)); real pictures on Mac and phones. **✅ Closed 2026-10-19.** User: "skip this requirement, not needed". Comment 3 dropped; no Country column (D-7, §5.5.2) |

**Assumed by BA for 1c (recorded so nobody re-asks):** the KPIs count every currency, whatever the filter shows; USD counts as an enabled currency; "Last action" means the last **rate** change (the tile is named so); the search box is never kept in the page link (the admin standard); a currency's own History button shows that currency's newest 10.

**Assumed by BA for slice 2 (2026-10-20; no question for the user):** the tab is named "Exchange rates" and sits last, after Plans & subscriptions; Overview stays the page's default; the Finance KPIs and the Finance filters (window, business) are not shown on the rates tab, because none of them applies to rates; no Finance KPI tile links to the tab; typing the old address still reaches the rates (it forwards to the tab); no sidebar item, no Settings link (the user's "Finance tab only").

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
| `app/admin/finance/` | Slice 2a adds a **fourth** tab to the existing tablist (`FinanceTabs.tsx`, `financeFilters.ts` with the shared `currencies` field and one repair rule, `financeCopy.ts`, `FinanceView.tsx`); finance data, request and sections unchanged (§5.3) |
| `app/admin/exchange-rates/page.tsx` (2) | **Header added in 2a, deleted in 2b.** 2a: renders `<AdminPageHeader title="Exchange rates" purpose={EXCHANGE_RATES_PURPOSE} />` above the view, temporarily (SQ-21). 2b: the file is deleted and `/admin/exchange-rates` is redirected to `/admin/finance?tab=exchange-rates` by a temporary `next.config.js` redirect (SQ-4, SQ-17 (a)) |
| Guards and tests (2) | Per §5.3.4 (SQ-23): G-4, G-2, both finance guards, `KpiStrip.callers.pin` unchanged. **2a:** `financePage.render`, `accountsTab.render`, `financeFilters.test` (lines 48 / 52 / 60) and `financeFilterBar.layout.render` (`DEFAULTS`) amended; new Finance tab tests (SA-2-6). **2b:** `chargeChecksRedirect` (four), G-6, `AdminSidebar.nav` (on-disk floor 29 → 28), the layoutFolder registry and the two rates render suites amended; new `exchangeRatesRedirect.config.test.ts` |
| `lib/business-os/finance/**` and its source guard | Unchanged; must not import rates |
| `AuditTrailService` | One entry per change |
| CLAUDE.md | Proposed one-line wording fix (§3.1) |
| `app/admin/exchange-rates/components/*` (1c) | View gains the filter bar (`AdminFilterBar` + `useAdminFilters`, URL key `currencies`); KPIs become Enabled currencies + Last rate change; history shows labels. ~~Table gains the Country column~~ (dropped by the user) |
| `lib/admin/exchangeRates/` (1c) | `HISTORY_LIMIT` 50 → 10; wire type gains `changedByLabel`; payloads gain `nameLookup`; separate per-currency payload type (SQ-12). ~~Currency-to-region map~~ (dropped by the user) |
| `app/admin/__tests__/redundantPages.source.guard.test.ts` (1c.1) | The Exchange rates folder's literal `fetch(` count goes **2 → 3** (the per-currency read, SQ-12); test name updated |
| `app/api/admin/exchange-rates/route.ts` (1c.1) | Resolves history editors' names (`findAdminNamesByIds`, `findEmailsByUserIds`); optional `?currency=` per SQ-12 |
| `lib/repositories/UserProfileRepository.ts`, `AdminUserRepository.ts` (1c.1) | No code change; "only caller" header comments updated |
| `app/admin/components/layout/__tests__/KpiStrip.callers.pin.render.test.tsx` (1c.1) | Exchange rates cases re-pinned per SQ-15; new cases appended |
| ~~`components/ui/CountrySelect.tsx`~~, ~~`package.json` / lockfile~~ | Not touched: comment 3 dropped by the user, so SQ-10 / SQ-11 are moot |
| `app/admin/exchange-rates/components/ExchangeRatesView.tsx` (1d) | Holds the history window in page state (default This month, SQ-25); renders `DatePresets` above the history table; both `GET` call sites carry `from` / `to`; a window change re-reads per SQ-34 |
| `app/admin/exchange-rates/components/RateHistoryTable.tsx` (1d) | Captions name the period; new empty messages (FR-32, FR-33) |
| `app/admin/exchange-rates/components/ExchangeRatesKpis.tsx` (1d) | "Last rate change" reads `payload.lastChange`, not `history[0]` (SQ-31); output unchanged |
| `app/api/admin/exchange-rates/route.ts` (1d) | Query gains `from` / `to` (SQ-26); history reads windowed; plain `GET` adds `lastChange`; label lookup covers its editor; route header rewritten |
| `lib/repositories/ExchangeRatesRepository.ts` (1d) | `listRecentHistory` / `listRecentHistoryForCurrency` take a window (`.gte` / `.lt` on `changed_at`, same order and fixed limit); an all-time newest-change read (SQ-31); unit tests |
| `lib/admin/exchangeRates/exchangeRateRules.ts` (1d) | Query schema gains `from` / `to`; `ExchangeRatesPayload` gains `lastChange`; a pure period-wording helper may live here or beside the view. `HISTORY_LIMIT` unchanged (10) |
| `app/admin/components/layout/DatePresets.tsx`, `adminWindow.ts`, `app/admin/components/adminWindowPresets.ts` (1d) | Reused, **not edited** |
| `app/admin/finance/**`, `KpiStrip.callers.pin`, `redundantPages` G-6 (1d) | Unchanged (SQ-25, SQ-32, SQ-33): no finance key, the fetch count stays 3, no hash expected to move. No migration (`idx_exchange_rate_history_changed_at` exists) |

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

### 13.4 SA review — slice 1c

**Reviewed by SA — 2026-10-19** (requirement review of §3.3, §5.5, FR-14 to FR-22, §8 slice 1c, the §12 1c rows, SQ-8 to SQ-16, BQ-1). Code read from `origin/main` `0581637a` (this worktree's base); `node_modules` facts read from the main checkout.
**Verdict: CLEARED-WITH-CHANGES.** The slice is proportionate, adds no table, migration or write path, and reuses the shared filter bar, the URL hook, `KpiStrip` and two existing admin read methods. One BA proposal must change before the workplan: **SQ-8's key `show` is already owned by the Finance page** (the Accounts tab), not only `status` (SA-1c-1). User decisions D-7 (Finance tab only, no Settings link; per-row Stale chip kept, Stale KPI dropped; Enabled only by default; Country column next to Symbol; history capped at 10; names instead of ids; KPIs = Enabled N of X + Last change) are **not reopened**.

**Verified as stated:**

| Claim | Result |
|---|---|
| `userProfileRepository.findAdminNamesByIds(userIds: readonly string[])` | ✅ `lib/repositories/UserProfileRepository.ts:446`. Returns `RepositoryResult<AdminProfileName[]>` = `{ id, full_name }[]` (columns `id, full_name` only); de-duplicated, chunked `.in('id', …)`, empty list makes no query, never throws, logs counts only. Header names its only caller as `app/api/admin/audit-trail/route.ts` |
| `adminUserRepository.findEmailsByUserIds(userIds: readonly string[])` | ✅ `lib/repositories/AdminUserRepository.ts:150`. Returns `RepositoryResult<Array<{ user_id; email }>>`, **active and deactivated** admins (SC9-1), chunked, logs counts only. The file header (line 24) names "the history route" as its only caller |
| Audit trail failure posture | ✅ `app/api/admin/audit-trail/route.ts` ~185-220: returned **or thrown** failure → logged, request survives, labels dropped, body says `userLookup: 'failed'`; only a trimmed non-empty `full_name` counts as a name |
| `adminReadMethods.guard` | ✅ with one precision: `lib/repositories/__tests__/adminReadMethods.guard.test.ts` lists both methods in `ADMIN_METHODS` and asserts every **calling file** starts with `app/api/admin/`. So no guard edit is needed **only if the calls sit in a file under `app/api/admin/`** (SA-1c-6) |
| `AdminFilterBar` / `useAdminFilters` / `textFilter` | ✅ `app/admin/components/layout/AdminFilterBar.tsx` (already used by `ExchangeRatesView` as the Refresh-only bar), `useAdminFilters(spec, { active })` (L-9a option present), `textFilter({ key, defaultValue, isValid, pageOnly })`; unrelated keys such as `tab` are kept on write. `app/admin/users/usersFilters.ts` is the pattern as described |
| Finance already has tabs | ✅ `app/admin/finance/components/FinanceTabs.tsx`: Overview, Accounts, Plans; `FINANCE_FILTER_SPEC.tab = choiceFilter('tab', ['accounts', 'plans'], '')`. **But** the spec also owns `show` (Accounts tab: `all` / `active` / `negative`), `status`, `sort`, `group`, `window` (alias `preset`), `account` (alias `accountId`), and `financeFilterRepair` resets a non-default `show` whenever the tab is not Accounts. See SA-1c-1 |
| `HISTORY_LIMIT = 50` single source | ✅ `lib/admin/exchangeRates/exchangeRateRules.ts`; repository re-exports it as `EXCHANGE_RATE_HISTORY_LIMIT` and uses it in `.limit(...)` |
| `flagOf` private to `CountrySelect`; `countryName()` has no EU | ✅ `components/ui/CountrySelect.tsx:43`; `lib/geo/countries.ts` `countryName` returns the code for an unknown code |
| 43 codes | ✅ `lib/utils/currencyHelpers.ts` lists exactly the 43 codes in the §5.5.2 map |
| `KpiStrip.callers.pin` | ✅ three cases at lines 272-274, hashes at 334-336, header line 29 "Amended by Exchange rates 1a" |

**Baseline drift (not a blocker, BA records it).** §1 is stale: slice 1a is **merged** (PR #477, in this base), and slice 1b is **merged** on `origin/main` (PR #479, `a9551d9c`, after `0581637a`). Dev branches 1c.1 from the **current** `origin/main`, not from `0581637a`.

#### Rulings

| # | Ruling |
|---|---|
| SQ-8 | **Rejected as proposed; key `currencies`.** `show` is already a Finance URL key (`FINANCE_FILTER_SPEC.show`, Accounts tab, values `all` / `active` / `negative`), and `financeFilterRepair` rewrites any non-default `show` when the tab is not Accounts. In slice 2 the two would fight over one address bar (`?tab=exchange-rates&show=all` would be "repaired" away). Use **`currencies`**, values `disabled` / `all`, default `enabled` never written (U-3), any other value ignored (U-4), via `textFilter({ key: 'currencies', defaultValue: 'enabled', isValid })` in a module-level spec (e.g. `app/admin/exchange-rates/exchangeRatesFilters.ts`). Search is a `pageOnly` field or plain page state, never written (U-1 exception). The view's hook takes `{ active }` from a prop defaulting to `true`, so slice 2 needs no edit to the spec. Dev greps every `FINANCE_FILTER_SPEC` key and alias at Step 0 and confirms `currencies` is still free |
| SQ-9 | **Accepted, with the mechanism fixed.** Today `setEnabled` replaces the row in `payload`, so a filter derived from `payload` would drop the row at once. The view keeps a `heldCodes` set: a code switched in this view stays visible (`matchesFilter(row) \|\| heldCodes.has(code)`) with its new chip. The set is emptied on Refresh, on every successful read, and on any filter or search change. The count line counts what is shown (held rows included). Focus stays on the switch because the row does not unmount. One render test: switch off under Enabled only → row stays, chip "Disabled"; Refresh → row gone |
| SQ-10 | **⚪ Moot (BA note, 2026-10-19): comment 3 was dropped by the user ("skip this requirement, not needed"); nothing below is built. SA text kept for the record.** **Depends on SQ-11.** Only under (a): move `flagOf` to one pure helper (`lib/geo/flagEmoji.ts`, unit-tested: `IL` → regional indicators, lower case accepted), imported by `CountrySelect` with behaviour unchanged (its existing tests stay green unedited). Under (b) or (c) **do not touch `CountrySelect`** (no cross-area edit for nothing) |
| SQ-11 | **⚪ Moot (BA note, 2026-10-19): comment 3 was dropped by the user ("skip this requirement, not needed"); no flag option is built and no dependency is added. SA text kept for the record.** **All three options are buildable; ruled so whichever BQ-1 answer comes back can be built without another review.** Common shape for all three: the currency → region map (`lib/admin/exchangeRates/currencyCountry.ts`, pure, client-safe) returns `{ region: string \| null, label: string }` and knows nothing about drawing; **one** presentational component (`app/admin/exchange-rates/components/CurrencyFlag.tsx`) draws it; the cell is a wrapper `<span role="img" aria-label={label} title={label}>` with the drawing inside `aria-hidden`. The neutral mark for `region: null` (unknown code, XAF/XOF/XCD/XPF/XDR, metals, crypto) is **lucide-react `Globe`** (already a dependency, used across `app/admin`) in every option, so it looks the same on Windows. EU label "European Union" lives in the map. **(a) Emoji:** approved, no new dependency; the user sees letters on Windows (BQ-1). **(b) ISO code badge:** approved, no new dependency; a small mono text badge on the existing chip styling (not `StatusChip`, which means status); the label still comes from `countryName()` / the map. **(c) `country-flag-icons` SVG: approved as a declared direct dependency, conditions below.** Facts checked: MIT (`LICENSE`, © 2020 catamphetamine); version 1.6.20 already locked and hoisted (`package-lock.json`, pulled by `react-phone-number-input ^1.6.14`); 12 MB on disk across all formats, but `react/3x2` is ESM with `"sideEffects": false` and each flag is a `/*#__PURE__*/` function component taking SVG props (incl. `title`), so only imported flags are bundled; the 43 needed flags' SVGs total ≈ 26 KB raw (measured), the whole barrel `modules/react/3x2/index.js` is ≈ 331 KB if tree-shaking is defeated; `exports.require` → `index.cjs`, so Jest resolves it without a transform change. Nothing in the app imports its React flags today. **Is it a new pattern?** Declaring an already-installed package as a direct dependency for a leaf presentational component is not a new architectural pattern; this ruling is the CLAUDE.md rule 7 review, so no further SA step is needed. **Conditions for (c):** (1) `package.json` `dependencies` gains `"country-flag-icons": "^1.6.20"`; the lockfile diff is limited to the root entry; `npm ls country-flag-icons` shows one deduped copy. (2) Named imports only, from `country-flag-icons/react/3x2`, in `CurrencyFlag.tsx` alone, into a static `Record<string, FlagComponent>` for the 43 mapped regions (EU included). **Forbidden:** `import *`, indexing the module namespace by a runtime code, the CSS sprite (`3x2/flags.css`: global CSS + asset URLs), `string/*` (needs `dangerouslySetInnerHTML`), `unicode` / any network flag URL. (3) Dev records the `/admin/exchange-rates` First Load JS from `next build` before and after in the workplan; expected growth well under 30 KB; anything near the barrel size means tree-shaking failed: stop. (4) Fixed size via Tailwind (e.g. `h-3.5 w-5`), `aria-hidden` on the SVG, the label on the wrapper only (no duplicate `<title>`). (5) The diff shown to the user includes `package.json` and the lockfile; 1c.2 under (c) does not use any auto-merge fast-track |
| SQ-12 | **(b) accepted, shaped.** `GET /api/admin/exchange-rates?currency=XXX`. Query parsed with Zod **before** any read: `z.object({ currency: currencyCodeSchema.optional() }).strict()` over the search params; an unknown key, a repeated `currency` (`getAll().length > 1`) or a bad code → 400. Valid shape but no such row (`findByCode` → null) → 404. New repository method `listRecentHistoryForCurrency(code)`: `.eq('currency_code', code)`, same order, `.limit(EXCHANGE_RATE_HISTORY_LIMIT)`; repository unit test pins the `.eq` and the limit. The per-currency response is a **separate wire type** (`ExchangeRateHistoryPayload { currencyCode; history; nameLookup; readAt }`), not a filtered `ExchangeRatesPayload`, so the page can never take rates or the Last change tile from it. The plain `GET` (no query) is unchanged in shape apart from SQ-13. Route header ("No query string is read") is rewritten. **Guard edit approved:** `redundantPages.source.guard` "the folder does fetch … one read and one write" is pinned at `toBe(2)`; the per-currency read is a third literal call site (`` fetch(`/api/admin/exchange-rates?currency=${encodeURIComponent(code)}`, …) ``, which `ALLOWED_FETCH` already accepts via `?`) and the count becomes **3**, with the test name updated. Do **not** fold it into the existing read with a variable or a bare `${query}` suffix to dodge the count |
| SQ-13 | **Accepted, precised.** Order: trimmed non-empty `profiles.full_name` → `admin_users.email` (deactivated included) → `UNKNOWN_USER_LABEL = 'Unknown user'` (constant in `exchangeRateRules.ts`). Ids come only from the history rows the route read (distinct, non-null), never from the request. Both lookups run in parallel, each wrapped for **returned and thrown** errors. **Any** lookup failure → `nameLookup: 'failed'`, every `changedByLabel` null (no half-resolved list), one `error` log with counts and the failed source only, still 200. Success → `nameLookup: 'ok'` and every label non-null. A row with `changedBy` null is labelled "Unknown user" in both cases (nothing was looked up, so nothing failed). Wire: `ExchangeRateHistoryWire.changedByLabel: string \| null`; payloads gain `nameLookup: 'ok' \| 'failed'`. `changedBy` stays on the wire and as the cell's `title` (tracing; admin-only). Page: label when present, else `formatShortId(changedBy)`. The precedence rule is one pure function in `lib/admin/exchangeRates/` (unit-tested), but **the two repository calls stay in a file under `app/api/admin/exchange-rates/`** (SA-1c-6). Both repositories' header comments are updated to name this route as a second caller |
| SQ-14 | **Accepted: rate changes only, from history.** The tile is labelled "Last rate change". No audit-trail read in the `GET` (that would be a second data source and a privacy surface for a label). An on/off switch never changes this tile |
| SQ-15 | **Re-pinning accepted, as a named, scoped change.** Pin A's purpose is that the shared `KpiTile` / `KpiStrip` renders byte-identically for every caller across shared-component changes; a caller that deliberately changes its own tiles is outside that promise, and the A1 shape cases still guard the shared component. Conditions: `KpiStrip.tsx` is **not** edited in 1c; `A2 ExchangeRatesKpis loading` keeps its name and gets its new hash (two placeholders); `A2 ExchangeRatesKpis` and `A2 ExchangeRatesKpis none stale` are **removed** (the second's name no longer means anything) and the new cases are appended under clear names (two tiles; no history; name lookup failed; old rate null); the header gains one "Amended by Exchange rates 1c.1" line; the `git diff` of the file touches no other case or hash (Dev shows it in the handover); the file's old and new SHA-256 go in the 1c.1 workplan, as MK-5 did |
| SQ-16 | **Split accepted: 1c.1 then 1c.2, sequential, not stacked.** 1c.2 branches from `origin/main` after 1c.1 merges (both edit `ExchangeRatesView.tsx`; avoid stacked PRs). 1c.1 full cycle (the route starts returning people's names/emails). 1c.2 short path (UI-only) for (a) or (b); under (c) it stays short path for review but the dependency diff goes to the user, never auto-merged (SQ-11 condition 5) |

#### Additional rulings

| # | Topic | Ruling |
|---|---|---|
| SA-1c-1 | §5.3 / §5.5.1 slice 2 note | The "different key" rationale names `status` only. BA adds that `show` is also Finance's (Accounts), and records for slice 2 that `FINANCE_FILTER_SPEC.tab` (`['accounts', 'plans']`) and `financeFilterRepair` must learn the new tab, while the exchange-rates hook runs with `{ active: tab === 'exchange-rates' }`. Slice 2 concern only; nothing in 1c touches `app/admin/finance/` |
| SA-1c-2 | KPI source | Both tiles take `payload.rates` / `payload.history` from the **plain** `GET` only, never from the filtered rows or the per-currency payload. "Enabled currencies" counts `isEnabled === true` over all rows, USD included, no status colour. "Last rate change" = `history[0]`; value shows the two stored strings ("ILS 3.65 → 3.70", or "ILS set to 3.70" when `oldRate` is null), no arithmetic (D-5); sub line by label or short id, `formatUtc(changedAt)` |
| SA-1c-3 | Stale constants | The Stale tile goes; `STALE_*` constants, `isRateStale` and the row chip stay. Remove only the imports that become unused in `ExchangeRatesKpis.tsx` (no dead code); the tile's `testId="kpi-stale-rates"` disappears with it, so any test asserting it is updated in 1c.1 |
| SA-1c-4 | History labels | `RateHistoryTable` caption changes with the cap ("The newest 10"; per-currency: "ILS: newest N"), from `HISTORY_LIMIT`, never a literal. Comments that say 50 are updated (route, view, table, repository) |
| SA-1c-5 | Filter bar | `role="search"` named "Filters", labelled native `<select>` ("Show") and `type="search"` ("Search", placeholder "Code or name") on `ADMIN_FIELD_LABEL` / `ADMIN_FIELD_CONTROL`; Clear disabled at defaults; Read at and Refresh unchanged. Search: trimmed, case-insensitive substring on `currencyCode` or `currencyName`; no regex built from input. Empty result: `AdminEmpty` "No currencies match these filters." with Clear |
| SA-1c-6 | Where the name lookups live | The guard allows only files under `app/api/admin/**` to call `findAdminNamesByIds` / `findEmailsByUserIds`. The calls therefore go in `app/api/admin/exchange-rates/route.ts` (or a sibling helper in that folder), never in `lib/admin/exchangeRates/` or the repository. The guard needs no edit |
| SA-1c-7 | Privacy and logs | The response adds `changedByLabel` and `nameLookup` only. Logs carry counts, the currency code and `nameLookup`, never a name or an email. A route test spies on the logger and asserts no label value appears in any log argument (the N-6 precedent in `adminReadMethods.guard`) |
| SA-1c-8 | Skills / domains | No entitlements import, no LLM call, no cron, no schema claim beyond columns already verified in 1a, no tenant id: `business-os-entitlements`, `bos-llm-call-standards`, `durable-queue-drain`, `tenant-isolation-guard` not triggered. The `GET` keeps `requireAdmin` as the first statement; the new query parse comes after it. The route edit follows the `new-api-route` checklist for the changed handler (Zod first, correlationId, error format) |

#### Required changes

**BA, before the 1c.1 workplan:** ✅ all four applied 2026-10-19 (item 3's `package.json` / lockfile row not added: flag option (c) is gone with comment 3).

1. SQ-8: replace key `show` with `currencies` in §5.5.1, FR-15, §8 1c.2 and the §10 SQ-8 row's consequence; add the SA-1c-1 note to §5.3.
2. §1: mark slice 1a merged (PR #477) and slice 1b merged (PR #479); 1c row → "SA cleared with changes (§13.4)".
3. §12: add the `redundantPages.source.guard` fetch count 2 → 3 (SQ-12) and, under SQ-11 (c) only, `package.json` / `package-lock.json`.
4. §8 1c.1: add the SQ-12 400 / 404 cases, the "any lookup failure → all labels null" case, and the null-`changedBy` → "Unknown user" case; §8 1c.2: add the SQ-9 Refresh step.

**Dev, 1c.1 workplan and build:**

1. Branch from the current `origin/main` (1a and 1b both merged).
2. `HISTORY_LIMIT` 50 → 10; captions and comments per SA-1c-4.
3. `GET` query parse and per-currency branch per SQ-12; repository `listRecentHistoryForCurrency` + unit test; separate wire type.
4. Name resolution per SQ-13 and SA-1c-6 / SA-1c-7; pure precedence function unit-tested; both repositories' caller comments updated.
5. KPIs per SA-1c-2 / SA-1c-3; pin per SQ-15 (SHA-256 old/new recorded).
6. Route tests: limit is 10 and not from the request; name; email incl. deactivated; neither → "Unknown user"; null `changedBy`; lookup returned-error and thrown → 200, `nameLookup: 'failed'`, labels null, logged without names; `?currency=` valid / bad / unknown key / repeated / unknown code 404; not admin → 401/403 before any read.

**Dev, 1c.2 workplan and build:**

1. Filter spec and bar per SQ-8, SA-1c-5; held rows per SQ-9.
2. ~~Country column per SQ-11~~ — dropped by the user 2026-10-19; not built.
3. Render tests per §8 1c.2, incl. KPIs identical under all three Show values.

### 13.5 SA review — slice 2

**Reviewed by SA — 2026-10-20** (requirement review of §5.3.1 to §5.3.4 as refreshed by the BA on 2026-10-20, FR-23 to FR-27, §8 slice 2, the §11 slice 2 defaults, SQ-17 to SQ-24). Code read from `feature/admin-exchange-rates-2-finance-tab` at `c38ad4f4`; Next internals from the installed `next` 14.2.35.
**Verdict: CLEARED-WITH-CHANGES.** The approach is right and proportionate: one more tab on the existing page-local tablist, the view rendered where it already lives, the old URL retired by the MK-4 mechanism, no route, repository, migration, sidebar or finance-figure change. Three BA statements are wrong or incomplete against the code (SA-2-1: R8 does accept one kind of server page; SA-2-2: §5.3.2 says no finance key is added while SQ-20 adds one; SA-2-3: the forced-edit list misses two edits and names one that does not exist). **Slice 2 is split into 2a and 2b** (SA-2-4), sequential, not stacked. User decisions **not reopened**: "Finance tab only" (no Settings link, no sidebar item, D-7), no link to revenue (D-5), nothing in finance reads a rate (BD-12, CUR-3).

**Verified against the code:**

| Claim | Result |
|---|---|
| Authz R8 forbids a Server Component `page.tsx` that calls `redirect()` | ⚠️ **Partly.** `lib/admin/__tests__/admin-authz-surface.guard.test.ts` R8 accepts a render entry point that is a client component **or** a server page whose first statement awaits `requireAdminPage()` ("the rule's second accepting clause", `guardsItselfFirst`, proved on the `SELF_GUARDING_SERVER_PAGE` fixture). `R8_PARKED` / `R8_PERMANENT` are empty and the cap is 0, as stated. So a self-guarding server page with `redirect()` would pass R8 with no exemption. No such page exists in `app/admin` today (SA-2-1) |
| MK-4 precedent: a `next.config.js` redirect that keeps the query, page deleted | ✅ `next.config.js` `redirects()`: `{ source: '/admin/subscriptions', destination: '/admin/finance?tab=plans', permanent: false }`, no `has`; `app/admin/subscriptions/` is gone; pinned by `app/admin/finance/__tests__/subscriptionsRedirect.config.test.ts` (shape + `prepareDestination`) |
| Option (a): `/admin/exchange-rates?currencies=all` lands on `/admin/finance?tab=exchange-rates&currencies=all` | ✅ `next/dist/shared/lib/router/utils/prepare-destination.js` sets `parsedDestination.query = { ...query, ...parsedDestination.query }`: the incoming `currencies=all` is kept and the destination's `tab` wins over any incoming `tab` (e.g. `?tab=accounts` still lands on Exchange rates). Key order in the string may differ (`currencies` first); Finance's hook re-projects it in spec order on mount with one cosmetic `replaceState`. Tests assert the parsed query object, not the string |
| G-4 is unaffected by a relative import | ✅ `redundantPages.source.guard` G-4 matches `(?<!/api)/admin/exchange-rates` in code with comments stripped. `'../../exchange-rates/components/ExchangeRatesView'` (from `app/admin/finance/components/`) and `'../exchange-rates/exchangeRatesFilters'` (from `app/admin/finance/`) contain no `/admin/exchange-rates`. `next.config.js` is outside `WALK_ROOTS`. A comment naming the route is stripped. The only other non-test mention, `lib/repositories/ExchangeRatesRepository.ts:3`, is a comment |
| The finance read runs on every tab; tabs render only inside `data && !error` | ✅ `FinanceView.tsx`: `useFinanceData(queryString)` with no tab condition (deps `[queryString, attempt]`, so a filter change that leaves the string alone sends nothing); the `FinanceTabs` and every `FinanceTabPanel` sit inside `{data && !error && (…)}` within `finance-content` (`aria-busy={loading}`), after `AdminError` / `AdminLoading` |
| `financeFilterRepair` / `FINANCE_FILTER_SPEC` and `currencies` (L-9a) | ✅ with a correction. `useAdminFilters`' `projectSearch` deletes only the keys **its own spec** owns and keeps every other key, so Finance's hook cannot drop `currencies` unless its spec owns it. `financeFilterRepair` rules 1 to 4 are as the BA lists; rule 2 returns `{ tab: '', ...TAB_KEYS_DEFAULT }`, so a crafted business + tab link with a tab key is cleaned in two passes (the `status` precedent). Business OS AI's save / drop / restore cannot be reused: that page writes `tab` itself, outside `useAdminFilters`, while Finance's `tab` is a hook key (SA-2-5) |
| h1 handling | ✅ `ExchangeRatesView.tsx:351` renders `<AdminPageHeader title="Exchange rates" purpose={PURPOSE} />` with `PURPOSE` module-private (line 89). `FinanceView` renders `AdminPageHeader` (`PAGE_TITLE` "Finance", `PAGE_PURPOSE`, `asOf`). The Business OS AI precedent is real: one `AdminPageHeader`, `purpose={PURPOSE[tab]}` (F-68). `app/admin/finance/__tests__/source.guard.test.ts` pins "FinanceView has no own h1, header by alias" — unaffected |
| layoutFolder registry move | ✅ `app/admin/components/layout/__tests__/layoutFolder.guard.test.ts`: per entry, files exist, **some** file imports `AdminPageHeader` by alias, no file has `<h1` or `.json(`, no relative reach into the layout folder; registry-wide, every file in exactly one entry. The rates entry lists `page.tsx` + the five files the BA names (`changedByText.ts` is not registered today and stays unregistered). The Finance entry contains `FinanceView.tsx` (imports the header), so the five files satisfy it there. The Charge checks entry is the precedent (files from another folder, listed only there) |
| Forced edits: finance tab list | ✅ `financePage.render.test.tsx:1787` (`[TAB_OVERVIEW, TAB_ACCOUNTS, 'Plans & subscriptions']`); no other test counts the tabs |
| Forced edits: keyboard wrap | ✅ `accountsTab.render.test.tsx:209-239`: Right from Plans → Overview, End → Plans, Left from Overview → Plans all change to Exchange rates; one more `ArrowRight` step is added |
| Forced edits: `financeFilters.test` "the spec's tab values" | ❌ **No such pin.** No test asserts the tab values. What does break is the **`currencies` key** (SQ-20): line 48 (`parseLink` builds every field), line 52 (`DEFAULTS`), line 60 (`Object.keys(FINANCE_FILTER_SPEC)` list); and, not named by the BA, `financeFilterBar.layout.render.test.tsx:39` (`DEFAULTS: FinanceFilters`, a type error once the field is required) (SA-2-3) |
| Forced edits: the two rates render suites import `../page` | ✅ `exchangeRates.render.test.tsx:44` and `exchangeRatesFilters.render.test.tsx:34`; the h1 assertion is `exchangeRates.render.test.tsx:173` |
| Forced edits: `chargeChecksRedirect` count | ✅ `chargeChecksRedirect.config.test.ts:50-53` "three redirects in all", `toHaveLength(3)`. No other test counts the redirects |
| `AdminSidebar.nav.test.ts` | ⚠️ **One edit missed.** `onDisk` is a one-level scan: 29 routes today (30 `page.tsx` minus nested `finance/charges`). Deleting the rates page makes it 28, so `expect(onDisk.length).toBeGreaterThanOrEqual(29)` (line 167) fails and becomes 28. `toContain('/admin/exchange-rates')` (line 177) becomes `not.toContain`; `UNLISTED` loses the route; the comment above `UNLISTED` (line 89-91, "writes from the browser straight to the database") and the header line 28 ("Both pages stay on disk") are rewritten; `allHrefs` stays **28**; "never names `exchange-rates`" (line 203) stays (SA-2-3) |
| `redundantPages` G-6 after the delete | ✅ 6 non-test files remain (`exchangeRatesFilters.ts`, `ExchangeRatesView`, `ExchangeRatesKpis`, `ExchangeRatesTable`, `RateHistoryTable`, `changedByText.ts`), so `≥ 5` holds; `fetch(` count stays 3; `toContain(EXCHANGE_PAGE)` and "the REDUNDANT header is gone from the page" read the deleted file and go |
| The api routes `/api/admin/exchange-rates` are untouched | ✅ Nothing in slice 2 needs `app/api/admin/exchange-rates/route.ts` or `[currencyCode]/route.ts`: the view keeps its three literal calls; the redirect `source` is the page path only and does not match `/api/...`. Neither file, nor `lib/admin/exchangeRates/**` nor `ExchangeRatesRepository.ts`, is in the diff |
| Finance guards | ✅ `finance.source.guard` (CUR-3: no `exchange_rates` in any file under `lib/business-os/finance` and `app/admin/finance`) and the page guard (no repository, no `server-only`, value imports from `lib/business-os/finance` refused) have **no rule against importing from `app/admin/exchange-rates/`**; the camel-case specifiers contain no `exchange_rates`. `financeRequest.pin` hashes the route schema and `serialiseFinanceUrl`, not `toFinanceQuery`; both stay byte-identical |

#### Rulings

| # | Ruling |
|---|---|
| SQ-17 | **(a), the MK-4 mechanism.** In `next.config.js` `redirects()`, one entry `{ source: '/admin/exchange-rates', destination: '/admin/finance?tab=exchange-rates', permanent: false }`, no `has`, with a comment in the existing style (slice 2, SQ-4 / SQ-17, temporary for the same reason, query kept); `app/admin/exchange-rates/page.tsx` is **deleted**. **(b) rejected:** a client page whose only job is to leave, drops the query unless it adds `useSearchParams` and a Suspense boundary, and renders a flash first. **(c) rejected:** R8 stays at 0. **(d), a self-guarding server page (`await requireAdminPage()` then `redirect()`), rejected too** although R8 accepts it (SA-2-1): it would be the first server-rendered page under `app/admin`, a new pattern (CLAUDE.md rule 7) for no gain over (a). SQ-4's "server `redirect()`" is satisfied in spirit: the redirect is server-side, before any render. The redirect runs before the admin layout; the destination is gated by it, so a non-admin still gets the layout's refusal. New test `app/admin/finance/__tests__/exchangeRatesRedirect.config.test.ts` in the `subscriptionsRedirect.config.test.ts` shape: shape block (exactly one entry for the source, `toEqual` the three fields); `prepareDestination` block: no query → `{ tab: 'exchange-rates' }`; `currencies=all` → `{ tab: 'exchange-rates', currencies: 'all' }`, read by `FINANCE_FILTER_SPEC.tab` as `exchange-rates` and by the `currencies` field as `all`; an incoming `tab=accounts` → `tab: 'exchange-rates'` (the destination wins); `currencies=junk` → the field reads the default |
| SQ-18 | **Accepted.** `FinanceView.tsx` imports `{ ExchangeRatesView, EXCHANGE_RATES_PURPOSE }` from `'../../exchange-rates/components/ExchangeRatesView'`, and `financeFilters.ts` imports `EXCHANGE_RATES_FILTER_SPEC` from `'../exchange-rates/exchangeRatesFilters'`; each with a one-line comment saying the alias would spell the page route G-4 refuses (DV-1). No G-4 edit. No finance file imports `lib/admin/exchangeRates/**` directly |
| SQ-19 | **(i) accepted, made precise; (ii) accepted.** (i) When `selectedTab === 'exchange-rates'`, `FinanceView` renders, under the header: the tablist and the rates panel, **outside** the `data && !error` gate; and it renders **none** of `FinanceKpiStrip`, `FinanceKpiPlaceholders`, `FinanceFilterBar`, the finance `AdminError`, the finance `AdminLoading`, or an `aria-busy` that reflects the finance read (the rates view has its own states and its own busy flag). Overview, Accounts and Plans render exactly as today. (ii) The finance read keeps running on this tab (the Plans precedent): request string unchanged, `financeRequest.pin` green unedited, Overview has its data on return. Skipping the read here is a later optimisation, not this slice. Consequence the user will see in the diff: on this tab the tablist sits directly under the header, while on the other tabs it sits under the KPI strip and the filter bar (an inherent layout shift of hiding the chrome); recorded for the user's diff review, not a blocker |
| SQ-20 | **BA's mechanism accepted; `owns()` gating rejected as unnecessary.** (1) `FinanceFilters` gains `currencies: string`; `FINANCE_FILTER_SPEC` gains, **last** (after `status`), `currencies: EXCHANGE_RATES_FILTER_SPEC.currencies` — **the same field object**, never a copy, so both hooks parse and serialise the key identically and can never disagree on a URL. (2) `onSelectTab`: the Overview, Accounts and Plans branches add `currencies: DEFAULT_CURRENCY_SHOW` (imported with the spec), so leaving the tab is still **one** write; the Exchange rates branch is `{ tab: 'exchange-rates', ...TAB_RESET, status: '' }`. (3) `financeFilterRepair` gains one rule after rule 4: tab not `exchange-rates` and `currencies` not at its default → `{ currencies: <default> }` (a pasted `?currencies=all` on Overview, or a business link). `FINANCE_CLEAR_PATCH` and `financeCanClear` do **not** learn the key (Finance's Clear is never shown on this tab, and elsewhere the key is always at its default). `toFinanceQuery` / `fromFinanceQuery` are untouched. (4) The view is rendered **without** an `active` prop (default `true`). Why no `owns()`: Finance unmounts a hidden panel, so the view's hook exists only while its tab is selected; on the click render it parses the leaving tab's string, which never holds `currencies` (leaving the tab and the repair remove it), so it starts at the default; its write effect (a child effect, run before Finance's) finds nothing to change; Finance then writes `tab` once. On leaving, the view unmounts (an unmount writes nothing) and Finance writes once. A Show change is written by the view's hook; Finance's hook re-parses the echo to the same value and its projection is identical (no write, and no request: the request string does not include `currencies`). The view's `active` prop and its R-14 test stay (they are the L-9a contract, tested, should Finance ever keep panels mounted); the view's header comment line 44 is corrected to "Finance unmounts hidden panels, so no caller passes false today". SA-1c-1's `{ active: tab === 'exchange-rates' }` is amended accordingly: always true where the view is mounted, so it is not written |
| SQ-21 | **Accepted: the view drops its `AdminPageHeader`; one h1, "Finance".** The view exports its sentence as `EXCHANGE_RATES_PURPOSE` (the existing `PURPOSE` text, unchanged, still in `ExchangeRatesView.tsx`, outside `app/admin/finance/`). `FinanceView`'s header on this tab: `title={PAGE_TITLE}`, `purpose={EXCHANGE_RATES_PURPOSE}`, `asOf={null}` (the window does not apply). No `showHeader` prop. Under the 2a / 2b split (SA-2-4), `app/admin/exchange-rates/page.tsx` renders `<AdminPageHeader title="Exchange rates" purpose={EXCHANGE_RATES_PURPOSE} />` above the view **during 2a only**, so the standalone URL keeps its h1 until 2b deletes it. `ExchangeRatesKpis.tsx` is not edited; `KpiStrip.callers.pin` does not move |
| SQ-22 | **Accepted, in 2b.** The `'/admin/exchange-rates (Exchange rates)'` entry is removed and its five non-page files are appended to the `'/admin/finance (Finance)'` entry with a comment in the Charge checks form ("the view stays in `app/admin/exchange-rates/` (SA-R13) and is listed here, and only here"). `changedByText.ts` is not added (not registered today; no scope creep). In 2a the entry is unchanged: `page.tsx` still imports the header |
| SQ-23 | **Approved, with SA-2-3's corrections; the complete list is the one below.** Dev shows each file's diff in the handover and nothing else in those files changes. **2a:** `financePage.render.test.tsx:1787` (four names); `accountsTab.render.test.tsx` keyboard test (wrap over four, comment updated); `financeFilters.test.ts` lines 48, 52, 60 (`currencies`); `financeFilterBar.layout.render.test.tsx:39` (`currencies` in `DEFAULTS`). **2b:** `chargeChecksRedirect.config.test.ts` three → four (test name and comment); `redundantPages.source.guard` G-6: drop `toContain(EXCHANGE_PAGE)` and the "REDUNDANT header is gone from the page" test, delete the then-unused `EXCHANGE_PAGE` constant, header gains an "Amended by slice 2" line; `AdminSidebar.nav.test.ts`: on-disk floor 29 → 28, `/admin/exchange-rates` `not.toContain`, out of `UNLISTED`, the two stale comments rewritten, `allHrefs` 28 unchanged; `layoutFolder.guard` registry per SQ-22; the two rates render suites render `<ExchangeRatesView />` instead of `../page`, and the h1 assertion at `exchangeRates.render.test.tsx:173` becomes "the view renders no h1" (the one-h1 check moves to the new Finance tests) |
| SQ-24 | **Accepted.** The business wins: rule 2 drops the tab; the new rule then drops a stray `currencies`. No special case. `selectedTab` is `'exchange-rates'` only with no business (`query.accountId === null`), as for Plans, so the view never mounts on a business link |

#### Additional rulings

| # | Topic | Ruling |
|---|---|---|
| SA-2-1 | §5.3.3 R8 statement | BA corrects "A Server Component `page.tsx` that calls `redirect()` fails R8" to: "fails R8 unless its first statement awaits `requireAdminPage()` (R8's self-guarding clause); none exists under `app/admin`, and SA rejects introducing one here (SQ-17 (d))". |
| SA-2-2 | §5.3.2 contradiction | The "Types and spec" row says "No other finance key is added"; SQ-20 adds `currencies`. BA rewrites the row per SQ-20 (1) and the `financeFilterRepair` row's "No new finance-key rule" per SQ-20 (3) |
| SA-2-3 | §5.3.4 forced-edit list | BA replaces the "Finance render tests" and `AdminSidebar.nav` rows with the SQ-23 list (the `financeFilters.test` tab-values pin does not exist; the `currencies` lines, `financeFilterBar.layout` `DEFAULTS` and the on-disk floor 29 → 28 were missing) |
| SA-2-4 | **Split: 2a then 2b** | Slice 2 touches config, a page delete, four finance files, the view and ten test files; split so each PR is reviewable in one sitting and the URL retirement is separately revertible. **2a, the tab:** `FinanceTabs.tsx`, `financeCopy.ts` (`TAB_EXCHANGE_RATES`), `financeFilters.ts`, `FinanceView.tsx`, `ExchangeRatesView.tsx` (header removed, `EXCHANGE_RATES_PURPOSE` exported, comment line 44), `app/admin/exchange-rates/page.tsx` (renders the header above the view, temporarily); the 2a forced edits; new Finance render tests. G-4, G-6, the registry, the sidebar test, `next.config.js` and the two rates render suites are **not** touched in 2a (the page still renders the h1 they assert). **2b, the old URL:** `next.config.js` redirect, page deleted, the 2b forced edits, the new redirect test. 2b branches from `origin/main` after 2a merges (not stacked). Cycle: 2a changes a money page's layout but no figure, request or data path; TL picks full cycle or short path. 2b is config + tests only. FR-23 to FR-25 and FR-27 are 2a; FR-26 is 2b |
| SA-2-5 | Why not the Business OS AI mechanism | Recorded so it is not re-proposed: BOS AI's page writes `tab` itself and saves / drops / restores each tab's keys, because its tab is not a hook key. Finance's `tab` is a `useAdminFilters` key and the hook keeps foreign keys, so the smallest correct change is for Finance's spec to own `currencies` too (SQ-20). Two specs owning one key is safe here only because they share **one field object** and the view's hook exists only while its tab is shown; a Dev comment at the new spec field says both |
| SA-2-6 | Tests for 2a (new, in `financePage.render.test.tsx` or a new `exchangeRatesTab.render.test.tsx` under `app/admin/finance/__tests__/`) | (1) Select the tab from Overview: **exactly one** `replaceState`, URL `?tab=exchange-rates`, Accounts keys and `status` reset; the rates table, Show select, rates KPIs and history render; no `FinanceKpiStrip`, no finance filter bar, no window `asOf`; exactly one `heading level 1`, "Finance", with the rates purpose sentence. (2) Open `?tab=exchange-rates` with the finance read **pending** and with it **failing**: the rates render; no finance error, no finance loading text. (3) `?tab=exchange-rates&currencies=all` opens All; change Show; leave to Overview: **one** write, no `currencies` key; `?currencies=all` on Overview is repaired away. (4) `?account=<id>&tab=exchange-rates`: the business view, no tablist, the view not mounted, the URL keeps `account` only. (5) The finance request string on this tab equals the Overview literal (`financeRequest.pin` unedited). (6) `financeFilters.test.ts` gains: the new repair rule (and null when on the tab), and `currencies` is `EXCHANGE_RATES_FILTER_SPEC.currencies` by identity (`toBe`). New test files must not contain `exchange_rates` (CUR-3 does not scan tests, but SA-R13's wording covers them) |
| SA-2-7 | Skills and domains | No entitlements import (type-only included), no LLM call, no cron or queue, no new route, repository, table or column claim, no caller-supplied id: `business-os-entitlements`, `bos-llm-call-standards`, `durable-queue-drain`, `business-os-schema-check`, `tenant-isolation-guard`, `new-api-route`, `new-repository` not triggered. The admin gate is unchanged (`app/admin/layout.tsx`, `requireAdminPage`); no `profiles.role`. Touched files are already on `clientLogger` / no `console.*` (the finance guard pins it for `app/admin/finance/**`; G-6 for the rates folder); Dev confirms `next.config.js` gains no `console.*` |
| SA-2-8 | §11 defaults | All accepted as business-neutral: tab named "Exchange rates", last; Overview stays default; Finance KPIs and filters hidden on the tab; no tile links to it; the old address forwards to the tab; no sidebar item, no Settings link |

#### Required changes

**BA, before the 2a workplan:** ✅ **Applied by BA 2026-10-20** (items 1 to 4: §5.3.3 R8 wording and SQ-17 rulings; §5.3.2 `currencies` / repair rule / no `active` prop / SQ-19 (i) hidden list; §5.3.4 replaced by the SQ-23 list split 2a / 2b; §1 rows 2a / 2b, FR slice column, §8 2a / 2b criteria, §12 page row).

1. §5.3.3: SA-2-1 wording; record SQ-17 (a) as ruled, (b) / (c) / (d) rejected.
2. §5.3.2: SA-2-2 (`currencies` in the spec, the new repair rule, no `active` prop, the SQ-19 (i) list of what is hidden on the tab, including the finance error / loading / `aria-busy`).
3. §5.3.4: SA-2-3 (the SQ-23 list, split into 2a and 2b).
4. §1 and §8: slice 2 becomes rows / criteria **2a** and **2b** per SA-2-4; §8 adds the "one write per switch" and "no finance error or loading on the tab" criteria; the h1 criterion reads "exactly one h1, Finance". §12: the `app/admin/exchange-rates/page.tsx` row reads "header added in 2a, deleted in 2b".

**Dev, 2a workplan and build:**

1. Branch from the current `origin/main` once 1c.2 (PR #484) has merged.
2. `FinanceTab` / `FinanceFilters.tab` / `FINANCE_FILTER_SPEC.tab` gain `'exchange-rates'`; `TABS` gains the fourth entry; `TAB_EXCHANGE_RATES = 'Exchange rates'` in `financeCopy.ts`; update the stale "two views" header comment of `FinanceTabs.tsx`.
3. `currencies` per SQ-20 (same field object, `onSelectTab`, one repair rule); `toFinanceQuery` / `fromFinanceQuery` / `FINANCE_CLEAR_PATCH` / `financeCanClear` untouched.
4. `FinanceView` per SQ-19 (i) and SQ-21; `selectedTab` per SQ-24; relative imports per SQ-18; header comment gains a slice 2 paragraph.
5. `ExchangeRatesView`: drop `AdminPageHeader` (and its import), export `EXCHANGE_RATES_PURPOSE`, fix comment line 44; `page.tsx` renders the header above the view.
6. Forced edits (2a part of SQ-23) and new tests (SA-2-6). Narrow Jest over `app/admin/finance`, `app/admin/exchange-rates`, `app/admin/components`, `app/admin/__tests__`, `lib/admin/__tests__`, `lib/business-os/finance/__tests__`; `tsc`, `eslint`, `lint:hooks`.

**Dev, 2b workplan and build (after 2a merges):**

1. `next.config.js` redirect per SQ-17; delete `app/admin/exchange-rates/page.tsx`.
2. New `exchangeRatesRedirect.config.test.ts` per SQ-17; the 2b forced edits per SQ-23 and SQ-22.
3. Confirm `git diff --stat` shows no file under `app/api/admin/exchange-rates/`, `lib/admin/exchangeRates/`, `lib/repositories/` or `lib/business-os/finance/`.

### 13.6 SA review — slice 1d

**Reviewed by SA — 2026-10-20.** This is a requirement review of the §1 1d row, D-8, §5.6, FR-28 to FR-34, the §8 slice 1d criteria, the §12 1d rows, and SQ-25 to SQ-34. Code was read from `feature/admin-exchange-rates-1d-history-window` at `origin/main` `930a6cee`.

**Verdict: CLEARED-WITH-CHANGES. Dev builds from the step list below; there is no separate workplan review.** The slice is proportionate. It adds no table, migration, write path, dependency or new fetch site. It reuses the shared Window control and the admin window helpers unedited, and it keeps every Finance file untouched.

Two BA proposals change:
- **SQ-34.** A window change re-reads what Refresh re-reads, not the panel only. Otherwise the overall list behind an open panel goes stale.
- **SQ-32.** No new pin case.

Four gaps the BA did not list are added: SA-1d-1 to SA-1d-4. They cover a request race on the plain read, the caption naming the window the rows were read under, a date range that would otherwise reach Postgres as a 500, and the ordering of a null `changed_at`.

**Not split.** A server-only half would either ship a windowed list with no control and no period caption, or need a temporary all-time default that is then reversed. The slice is one feature over six source files.

**Cycle:** full cycle. The route's query and payload change.

**User decisions, not reopened (D-8):**
- The control has the same five presets, defaults to This month, and shows the newest 10 in the window.
- It filters the history table and the per-currency History view only.
- "Last rate change" stays all-time.

**Verified against the code:**

| Claim | Result |
|---|---|
| `DatePresets` props and rules (§5.6.1) | ✅ `app/admin/components/layout/DatePresets.tsx`: `value`, `defaultValue`, `onChange`, `extras`, `requireBothDates`. A preset applies at once. A second click on the pressed preset calls `onChange(defaultValue)`, so with the default This month pressed it calls `onChange` with an **equal** value (SA-1d-6). "Custom" only opens the row. With `requireBothDates`, Apply stays disabled until both dates are set. Only "From after To" is refused. The type still allows `{ kind: 'custom', from: null }`, so the page's helper must narrow (step 4). **No page imports `DatePresets` directly today.** Every caller goes through `AdminFilterBar`'s `windowControl`. No guard forbids a direct import (`layoutFolder.guard` lists the file and has no import rule for it). See SA-1d-5 |
| `resolveWindow` / `resolveAdminWindow` / `isRealDate`, UTC | ✅ `adminWindow.ts` `resolveWindow(value, now)` maps `preset` through `resolveAdminWindow` and returns `custom` as given. `adminWindowPresets.ts` is UTC throughout (`Date.UTC`, `getUTC*`). `this_month` runs from the 1st to today; `7d` / `30d` include today. `isRealDate` checks the pattern and the round-trip, so it refuses `2026-02-30` and `''`. It **accepts** `0000-01-01` and `9999-12-31` (SA-1d-3). `customRangeProblem` is **not** reusable here: it refuses a `to` after today and anything over 92 days, neither of which this slice wants (SQ-26) |
| Finance owns `range` / `from` / `to` on the tab (SQ-25) | ✅ `FinanceView.tsx:151` `useAdminFilters(FINANCE_FILTER_SPEC)` is unconditional, with no `active` option, so it is mounted on the Exchange rates tab. `financeFilters.ts:116-119`: `window: windowFilter(...)` with alias `preset` → `range`, so it owns `range`, `from`, `to` and reads `preset`. A history window in the URL would be parsed as Finance's window and would change the finance request string. Finance's filter bar is not rendered on the tab (SQ-19 (i)), so the history control is the only group named "Window" on screen |
| Panels unmount (SQ-30) | ✅ As ruled in §13.5 (SQ-20 / SQ-19). `ExchangeRatesView` exists only while its tab is selected, so its page state starts at the default on every visit and on reload |
| Strict query schema | ✅ `exchangeRateRules.ts` `exchangeRatesQuerySchema = z.object({ currency: currencyCodeSchema.optional() }).strict()`. The route refuses a repeated key **before** the parse (`params.getAll(key).length > 1`), then parses `Object.fromEntries(params)`. Adding `.superRefine` turns it into a `ZodEffects`; `safeParse` and `query.data.currency` still work |
| Repository history reads | ✅ `listRecentHistory()` and `listRecentHistoryForCurrency(code)` select `HISTORY_COLUMNS`, `.order('changed_at', { ascending: false }).limit(EXCHANGE_RATE_HISTORY_LIMIT)`. Neither takes a window today. The header promises "No method accepts a caller-supplied filter … or limit" and must be reworded (step 3). `changed_at` is `timestamp with time zone DEFAULT now()` and **nullable** (`20261082` line 116). The trigger always sets `NOW()`, but `ExchangeRateHistoryRow.changed_at` is typed `string` (SA-1d-4). Index `idx_exchange_rate_history_changed_at` exists (line 126) |
| `nameLookup` | ✅ `route.ts` `resolveLabels(records)` takes the ids from `historyEditorIds(records)` (distinct, non-null). It runs both sources in parallel through `settle` (returned and thrown errors are the same failure), and any failure gives `labelHistory(records, { status: 'failed' })`. It returns already-labelled rows, so as written a second list (`lastChange`) would need a second lookup and could disagree with the first. Step 5 splits it into "resolve once" and "label each list" |
| `KpiStrip.callers.pin` (SQ-32) | ✅ Five `ExchangeRatesKpis` cases (lines 294-298, hashes 359-363). The fixtures (`FX_PAYLOAD` and the three spreads, lines 209-217) are typed `ExchangeRatesPayload`, and Jest runs `ts-jest`, so a required `lastChange` **must** be added to them. The tile reads only `lastChange`, so with `lastChange` equal to today's `history[0]` (`null` for no history) the HTML, and so **every hash, is unchanged**. `KpiStrip.tsx` is not touched. With a payload present, `loading` does not swap the tiles for placeholders (line 54), so a window re-read does not flicker the strip |
| `redundantPages` G-6 (SQ-33) | ✅ `` ALLOWED_FETCH = /^\s*(['"`])\/api\/admin\/exchange-rates(['"`/?]\|\$\{)/ `` (guard line 128; the table cell escapes the `\|`). A template literal `` `/api/admin/exchange-rates?${…}` `` passes on the `?` branch. The per-currency site already does. `fetchCount` counts literal `fetch(` sites, so the count stays **3** when both GET sites gain parameters in place. The `\$\{` branch would also pass `` `/api/admin/exchange-rates${suffix}` ``; that form is still forbidden by the SQ-12 ruling (step 6) |
| Held rows vs re-reads (SQ-9, SQ-34) | ✅ `ExchangeRatesView.tsx`: `refresh()` empties the held set **before** its reads, and `load()` empties it on every successful plain read. `load` is `useCallback([])` with **no request counter**, so only the one-currency read has one (`historyRequest`, SA W-3). Two quick window changes could therefore let an older plain answer land last (SA-1d-1) |
| SQ-27 precedent | ✅ The layout-standard pages resolve on the client and send dates: `costsFilters.ts` `costsRouteSearch` and `activityFilters.ts` `activityRouteSearch` send `from` / `to` as whole dates. The AI activity route (`app/api/admin/business-os/ai-activity/route.ts`) takes `from` / `to` `YYYY-MM-DD`, strict. Audit trail and Analytics also send resolved bounds. Finance is the exception: its route takes `preset` and re-resolves with its own clock, because its money aggregates must not trust a client clock. A `lib/` module importing the pure `adminWindowPresets.ts` has precedent too (`lib/business-os/finance/dueDates.ts:20`) |
| Forced test edits (not listed by BA) | ⚠️ Exact-URL matchers break once the GETs carry parameters: `exchangeRates.render.test.tsx` lines 171, 347, 565, 580, and `exchangeRatesFilters.render.test.tsx:143`. Caption assertions using `toHaveTextContent` (a substring match) break on the new period wording: `exchangeRates.render.test.tsx` lines 444, 451, 459, 462, 475, 511, 589. The route-test repository mock drops arguments (`listRecentHistory: () => listRecentHistory()`, line 54). `app/admin/finance/__tests__/exchangeRatesTab.render.test.tsx` matches with `startsWith(RATES_PATH)`, types its payload `unknown` and asserts only that `kpi-last-rate-change` exists, so it stays green **unedited** |

#### Rulings

| # | Ruling |
|---|---|
| SQ-25 | **Accepted: page state only.** `useState<AdminWindowValue>` in `ExchangeRatesView`, default `HISTORY_DEFAULT_WINDOW` (step 4). No URL key. No edit to `FINANCE_FILTER_SPEC`, `financeFilterRepair`, `useAdminFilters` or `EXCHANGE_RATES_FILTER_SPEC`. `financeRequest.pin` is green and unedited |
| SQ-26 | **Accepted, with one addition (SA-1d-3).** `exchangeRatesQuerySchema` stays `.strict()`, and the repeated-key refusal stays first. It gains `from` and `to`, each `z.string().refine(isRealDate)` and inside the SA-1d-3 range. A `superRefine` requires **both or neither**, and `from ≤ to` (a string compare, after both are real dates). Both absent → the server default, `resolveAdminWindow(HISTORY_DEFAULT_PRESET, new Date())`, so every existing no-query route test keeps its meaning. `to` after today is allowed. **No 92-day cap**: the read is 10 rows on an indexed column, not an aggregate. The same keys apply to the plain read and to `currency` + `from` + `to`. The limit never comes from the request |
| SQ-27 | **Accepted: the page resolves and sends whole dates.** This is consistent with Costs, AI activity, Audit trail and Analytics (verified above). Finance's re-resolution is the money-aggregate exception, not the repo's rule for a list. Presets are resolved **at each read**, with `new Date()` at call time: Refresh and the save re-reads re-resolve, so "today" moves with the clock. The server converts the dates to instants (SQ-28). It does not trust them for anything else and has no preset key |
| SQ-28 | **Accepted.** Half-open bounds on UTC midnights: `changed_at >= {from}T00:00:00.000Z` and `changed_at < {to + 1 day}T00:00:00.000Z`. They are built by one pure helper in `exchangeRateRules.ts` (step 2) using `Date.UTC` arithmetic, never local time and never a `23:59:59` literal. `DatePresets` gets `requireBothDates` |
| SQ-29 | **Accepted: UTC**, with the shared labels "From (UTC)" / "To (UTC)" |
| SQ-30 | **Accepted, no code.** Covered by an unmount / remount render test in the rates suite. No Finance test is edited |
| SQ-31 | **Accepted, with a separate method.** `ExchangeRatesPayload` gains `lastChange: ExchangeRateHistoryWire \| null`, on the plain read only. `ExchangeRateHistoryPayload` does not gain it. The repository gets a new `findLatestChange()`: same columns, no window, newest first, `limit(1)`. It is called only on the plain read, in parallel with the other two reads. A failure gives the existing 500, logged `failed: 'lastChange'`. **SA-1c-2 is amended:** "Last rate change" = `payload.lastChange`, never `history[0]`. The label lookup runs **once** over the editors of the windowed rows plus `lastChange` (≤ 11 ids), with the same all-or-nothing rule across both lists (step 5) |
| SQ-32 | **Hashes unchanged, accepted. The additive case is rejected.** The "last change outside the window" case would render byte-identical HTML to `A2 ExchangeRatesKpis two tiles`, because the tile no longer reads `history`, so it adds no coverage of the shared component. The fixtures gain `lastChange` (step 7). `EXPECTED` is untouched. The header gains one line: "Amended by Exchange rates 1d: fixtures gain `lastChange`; no case or hash changed." The "outside the window" behaviour is proven by the view render test (step 8, test 5) |
| SQ-33 | **Accepted: the count stays 3.** Both GET sites stay literal `fetch(` calls whose first argument is a template literal starting `` `/api/admin/exchange-rates? ``. No variable URL, no folded site, no `${suffix}` directly after the path. No guard edit |
| SQ-34 | **Rejected as proposed: a window change runs Refresh's reads.** That means the plain read, plus the open panel's read when a panel is open. With only the panel re-read, the overall `payload.history` stays on the old window, and "Show all currencies" (which reads nothing) would show it under the new window. Running Refresh's reads also empties the held set first. That is the existing SQ-9 rule ("Refresh, every successful read"), and the rates are re-read in the same step, so the table is current. This is recorded for the user's diff review, not a blocker. A history-only read stays rejected (a fourth `fetch(` and a new payload shape) |

#### Additional rulings

| # | Topic | Ruling |
|---|---|---|
| SA-1d-1 | Plain-read race | `load` gets a request counter like `historyRequest` (SA W-3). Every plain read takes a number, and only the newest may write `payload`, the shown window, `error`, `refreshNotice`, the held set or `loading`. Unmount retires it too. A window change while a read is in flight then cannot be overwritten by the older answer |
| SA-1d-2 | Captions name the rows' window | Each answer records the window it was **read under**. The plain read stores it beside `payload`, and `CurrencyHistory` gains `window`. Captions and empty messages use that recorded window, never the control's current value. After a failed window re-read, the rows on screen keep their own period's wording. While a re-read runs, the existing `aria-busy` marks the list |
| SA-1d-3 | Date range | `from` and `to` must also lie in `2000-01-01`..`2999-12-31` (a string compare after `isRealDate`), else 400. Without this, `0000-01-01` (no year 0 in Postgres) or `9999-12-31` (+1 day gives the extended-year ISO `+010000-…`) passes Zod and fails in the database as a 500. Constants `HISTORY_WINDOW_MIN_DATE` / `HISTORY_WINDOW_MAX_DATE` go in `exchangeRateRules.ts` |
| SA-1d-4 | Null `changed_at` | `findLatestChange` orders `{ ascending: false, nullsFirst: false }`, so a row with no time can never be the tile's "last change". The windowed reads exclude nulls by the comparison itself. `listRecentHistory*` keep their existing order call |
| SA-1d-5 | Using `DatePresets` outside `AdminFilterBar` | **Approved as reuse, not a new pattern** (this is the CLAUDE.md rule 7 review). A second `AdminFilterBar` would add a second `role="search"` landmark named "Filters" to the page. The control is rendered **inside `RateHistoryTable`**, between its heading row ("Recent rate changes" and the caption) and its body. It is shown in every state (loading, error, empty, rows), so an admin can always widen an empty window. The two `RateHistoryTable` instances sit in the same slot of the view's ternary, so React keeps one control across opening and closing a panel. No `extras`. No edit to any file in `app/admin/components/layout/` |
| SA-1d-6 | No-op change | A window change whose value `windowEquals` the applied one reads nothing (this covers the second click on the pressed This month) |
| SA-1d-7 | §8 criterion 2 ("a route test proves the newest 10 inside the window") | With a mocked repository, a route test cannot prove a database selection. The proof is in three parts: (a) the repository unit test pins `.gte`, `.lt`, `.order(desc)` and `.limit(10)` on **one** builder chain; (b) the route test pins that the request's dates reach the repository as the SQ-28 instants; (c) a view test shows the page renders exactly the rows it receives, with no trimming. BA rewords the criterion to this; it is a record edit and does not gate Dev |
| SA-1d-8 | Skills and domains | `new-api-route` checklist for the changed handler: `requireAdmin` first, Zod before any read, correlationId, error format. `new-repository` checklist for `findLatestChange` and the windowed reads: `RepositoryResult`, never throws, method logger, counts only. The documented no-`user_id` exemption stays and covers the new method. No entitlements import (type-only included), no LLM call, no cron, no caller-supplied tenant id: `business-os-entitlements`, `bos-llm-call-standards`, `durable-queue-drain` and `tenant-isolation-guard` are not triggered. Schema: `changed_at` is verified from the `20261082` record. No `console.*` in any touched file (0 today in all six), and the new files stay at 0 |
| SA-1d-9 | Logs and privacy | The route may log the window dates at `debug` (not personal data). It never logs a label, name or email (SA-1c-7). The existing logger-spy test is extended to the `lastChange` label |

#### Required changes

**BA (record edits; they do not gate Dev):**
1. §5.6.5 first bullet and SQ-34 consequence: a window change runs Refresh's reads.
2. §8 slice 1d criterion 2 per SA-1d-7; criterion 8 adds the SA-1d-3 range.
3. §8 KPI pin criterion: "no hash moves, no new case".
4. §12: add `app/admin/exchange-rates/historyWindow.ts` (new) and the forced test edits from the table above. The `RateHistoryTable` row adds "renders the Window control (SA-1d-5)".

**Dev, build (the step list is the workplan; record deviations as DV-n in a short workplan MD the TL opens for QA):**

0. **Branch and baseline.** Work in this worktree, from `origin/main` `930a6cee` or newer. Run the narrow Jest set (step 10) once before editing and record the counts.
1. **Rules: the query** (`lib/admin/exchangeRates/exchangeRateRules.ts`).
   - Import `isRealDate`, `resolveAdminWindow` and `type AdminWindowPreset` from `@/app/admin/components/adminWindowPresets`.
   - Add `HISTORY_DEFAULT_PRESET = 'this_month' satisfies AdminWindowPreset`, and the two SA-1d-3 constants.
   - Rewrite `exchangeRatesQuerySchema` per SQ-26: `currency`, `from`, `to`, all optional, `.strict()`, plus the `superRefine` for both-or-neither and `from ≤ to`.
   - Export `type HistoryWindowDates = { from: string; to: string }`.
   - Update the schema's doc comment. `HISTORY_LIMIT` stays 10.
2. **Rules: the bounds and the payload.**
   - Add `historyWindowBounds(dates: HistoryWindowDates): { fromInclusive: string; toExclusive: string }` per SQ-28, pure, using `Date.UTC`.
   - Add `defaultHistoryWindowDates(now: Date): HistoryWindowDates` = `resolveAdminWindow(HISTORY_DEFAULT_PRESET, now)`.
   - `ExchangeRatesPayload` gains `lastChange: ExchangeRateHistoryWire | null`, with a doc comment: all-time, plain read only, SA-1c-2 as amended.
3. **Repository** (`lib/repositories/ExchangeRatesRepository.ts`).
   - `listRecentHistory(window: { fromInclusive: string; toExclusive: string })` and `listRecentHistoryForCurrency(code, window)` add `.gte('changed_at', window.fromInclusive).lt('changed_at', window.toExclusive)` before the existing order and limit.
   - New `findLatestChange(): Promise<RepositoryResult<ExchangeRateHistoryRow | null>>` per SQ-31 and SA-1d-4: `.limit(1)`, then `data[0] ?? null`.
   - Rewrite the header line "No method accepts a caller-supplied filter…" to name the window: two instants the route built from Zod-validated dates.
4. **Page helper, new pure file** `app/admin/exchange-rates/historyWindow.ts` (no React, no fetch; not added to the `layoutFolder` registry, like `changedByText.ts`).
   - `HISTORY_DEFAULT_WINDOW: AdminWindowValue = { kind: 'preset', preset: HISTORY_DEFAULT_PRESET }`.
   - `historyWindowDates(value, now): HistoryWindowDates`: `resolveWindow`, and anything that is not two non-null dates falls back to the default. This is the `costsFilters.datesOf` shape.
   - `historyWindowParams(value, now): URLSearchParams` holding `from` and `to`.
   - `historyPeriodText(value)`: `today` → "today", `7d` → "in the last 7 days", `30d` → "in the last 30 days", `this_month` → "this month", custom → "from A to B (UTC)", anything else → the default's text.
5. **Route** (`app/api/admin/exchange-rates/route.ts`).
   - Dates come from the query, or `defaultHistoryWindowDates(new Date())` when absent, then `historyWindowBounds`.
   - Plain read: `Promise.all([listAll(), listRecentHistory(bounds), findLatestChange()])`, each failure named (`rates` / `history` / `lastChange`).
   - Per-currency read: `listRecentHistoryForCurrency(code, bounds)`, no `findLatestChange`.
   - Split `resolveLabels` into `resolveLookup(records): Promise<{ lookup: EditorLookup; nameLookup: NameLookupStatus }>`, run once over the window rows plus `lastChange`. Then call `labelHistory(rows, lookup)`, and `labelHistory([latest], lookup)[0]` for `lastChange`. Its contract is unchanged (never throws, logs counts only).
   - Rewrite the route header: the query keys, the default window, `lastChange`, and the label lookup over both lists.
6. **View** (`ExchangeRatesView.tsx`).
   - `historyWindow` state and a `historyWindowRef`, both set **in the change handler**, never during render and never in an effect. Do not name a variable `window`.
   - `load` and `loadCurrencyHistory` read the ref at call time and send `` fetch(`/api/admin/exchange-rates?${historyWindowParams(…)}`, …) `` and `` fetch(`/api/admin/exchange-rates?currency=${encodeURIComponent(code)}&${historyWindowParams(…)}`, …) ``.
   - Plain-read counter per SA-1d-1; shown windows per SA-1d-2.
   - `changeHistoryWindow(next)`: SA-1d-6 no-op, else set state and ref, then `refresh()` (SQ-34).
   - Pass `window`, `defaultWindow` and `onWindowChange` plus the rows' window to `RateHistoryTable`.
   - Update header comment lines 17-24: the GETs carry `from` / `to`; a window change runs Refresh's reads.
7. **Presentational.**
   - `RateHistoryTable.tsx` renders `<DatePresets … requireBothDates />` per SA-1d-5.
   - `historyCaption(count, currencyCode, period)`: at the cap, "The newest {HISTORY_LIMIT} changes {period}"; otherwise "{n} change(s) {period}, newest first"; the "{CODE}: " prefix kept.
   - Empty messages: "No rate changes in this period." / "No rate changes for {CODE} in this period." (FR-32, FR-33). Update its header comment.
   - `ExchangeRatesKpis.tsx`: `const last = payload.lastChange;`, and its header comment says all-time, from `lastChange`.
   - `KpiStrip.callers.pin`: fixtures gain `lastChange`. `FX_PAYLOAD` → `FX_CHANGE`; no history → `null`; lookup failed → the same `changedByLabel: null` row; old rate null → the `oldRate: null` row. Add one header line. Show the `git diff` of that file in the handover: no hash or case line moves.
8. **Tests, new and amended.**
   - `exchangeRateRules.test.ts`:
     - Schema: none, `currency` only, `from` + `to`, all three, `from = to` → ok. Only `from`, only `to`, reversed, `2026-02-30`, `''`, `2026-1-01`, `1999-12-31`, `3000-01-01`, an unknown `limit` → refused. A future `to` → ok.
     - `historyWindowBounds`: 10-01..10-20 → `2026-10-01T00:00:00.000Z` / `2026-10-21T00:00:00.000Z`, plus month end, year end, `2028-02-28` → 02-29, `2028-02-29` → 03-01, `2027-02-28` → 03-01.
   - New `app/admin/exchange-rates/__tests__/historyWindow.test.ts`: every preset at a fixed `now`, including `2026-10-01T00:00:00.000Z` and `2026-10-31T23:59:59.999Z`; custom; the fallback; every `historyPeriodText`.
   - `ExchangeRatesRepository.test.ts`:
     - Both windowed reads pin `gte` / `lt` / `eq` (per currency) / `order` desc / `limit(10)` on one chain.
     - `findLatestChange`: no `gte` / `lt`, `nullsFirst: false`, `limit(1)`, a row or `null`, a returned error, a thrown error.
   - `route.test.ts`:
     - Forward mock arguments; mock `findLatestChange` in `beforeEach`.
     - The window reaches the repository as instants. No query gives This month at a pinned clock (`jest.useFakeTimers({ now })` in that test only, then `useRealTimers`).
     - `lastChange` is labelled, including an editor who appears only in `lastChange`: each source is called once with the union of ids.
     - A lookup failure nulls the `lastChange` label too.
     - A `findLatestChange` error gives a 500 with `failed: 'lastChange'`.
     - The per-currency body has no `lastChange` key and `findLatestChange` is not called.
     - 400 with no repository call: one-sided, reversed, bad date, out of range, repeated `from`, `limit=50`.
     - Not admin → refused before any read.
     - The logger spy finds no label value.
   - Rates render suites:
     - Fix the forced URL matchers by comparing `pathname` plus `searchParams`.
     - Rewrite the forced caption assertions to the period wording.
     - Fixtures gain `lastChange`.
   - New `describe('slice 1d')` in `exchangeRates.render.test.tsx`:
     1. One group named "Window", with This month pressed; the first GET carries this month's `from` / `to` (computed in the test with the helper); caption names "this month".
     2. 7 days → one plain GET with those dates; no `replaceState` call and `location.search` unchanged; caption "in the last 7 days".
     3. Custom: Apply is disabled with one date; both dates → exact `from` / `to`; caption "from A to B (UTC)".
     4. Panel open + window change → one plain GET and one `currency` GET with the window; then "Show all currencies" shows the overall list under the new period.
     5. `history: []` with `lastChange` set → the tile shows the change, and the list shows "No rate changes in this period."
     6. Per-currency empty message.
     7. Race: the first window's answer resolves after the second's → the second's rows and caption stay (SA-1d-1).
     8. A failed window re-read → the page error, and the old rows keep their own period caption (SA-1d-2).
     9. "Enabled currencies" is identical under every window, Show / Search are unchanged, and a held row is released by a window change (SQ-34).
     10. A second click on the pressed This month → no read (SA-1d-6).
     11. A rate save → the re-reads carry the applied window.
     12. Unmount and remount → This month (SQ-30).
     13. 3 rows received → 3 shown, and 10 → 10 with "The newest 10 changes this month" (SA-1d-7 (c)).
9. **Must stay unedited and green:** every file under `app/admin/finance/` (including `exchangeRatesTab.render.test.tsx` and `financeRequest.pin`) and `lib/business-os/finance/`; `app/admin/components/layout/**` sources; `redundantPages.source.guard` (count 3); `adminReadMethods.guard`; `layoutFolder.guard`. No migration, `package.json` or lockfile change. The `[currencyCode]/route.ts` PATCH is untouched.
10. **Checks.**
    - Narrow Jest over `app/admin/exchange-rates`, `app/api/admin/exchange-rates`, `lib/admin/exchangeRates`, `lib/repositories/__tests__/ExchangeRatesRepository.test.ts`, `lib/repositories/__tests__/adminReadMethods.guard.test.ts`, `app/admin/finance`, `app/admin/components`, `app/admin/__tests__`, `lib/admin/__tests__`.
    - `tsc` (narrow), `eslint`, `lint:hooks`.
    - Before the handover, run `git diff --stat` and confirm no file outside steps 1 to 8 appears, then run `git diff --numstat` and confirm there is no deletion-only file.

---

## Change History

| Date | Change | Details |
|---|---|---|
| 2026-10-19 | Created | BA draft from the 2026-10-18 status review and the user's 2026-10-19 decisions (D-1 to D-6). Slices 1a, 1b, 2; 3 and 4 parked. Awaiting SA review |
| 2026-10-19 | SA requirement review | **CLEARED-WITH-CHANGES** (§13). SQ-1 to SQ-7 ruled; SA-R1 to SA-R17 added. §2.1 history trigger row replaced with the live-verified trigger facts (SECDEF, no `search_path`, `changed_by = NEW.updated_by`, toggles not historised). Conditions before the workplan: BA refreshes §2.2 / §5.1 from `origin/main` (page already read-only, Pino, guarded; SA-R1) and records the BD-34 / BD-36 reversal and FF-2 supersession in the finance requirement (SA-R2). Provisional migration `20261082` (SA-R15) |
| 2026-10-19 | BA applied SA-R1 and SA-R2 | **SA-R1:** §2.2 rewritten from `origin/main` `4583d21e` (page REDUNDANT per BD-34 and read-only per BD-36 / FF-1a PR #465, Pino with 0 `console.*`, still reads `exchange_rates` and 50 `exchange_rate_history` rows from the browser; guard rows for `redundantPages.source.guard` G-1 to G-6 and `AdminSidebar.nav.test` `UNLISTED`; check 35; `CurrencyService.ts` has 9 `console.*`). Overview, §2.3, D-1 consequence, §5.1 Page / Dead code / Logging rows (plus a new Guards row per SA-R3), the §8 slice 1a `console.*` criterion and §12 corrected to match. **SA-R2:** the user's decision is recorded as **BD-55** in [BUSINESS_OS_FINANCE_HEALTH_REQUIREMENT.md](/docs/requirements/BUSINESS_OS_FINANCE_HEALTH_REQUIREMENT.md) (amends BD-34 / BD-36 for Exchange rates only; Platform dashboard stays redundant; BD-12 and CUR-3 unchanged), FF-2 marked superseded by slice 1b, cross-linked both ways. Ready for the slice 1a workplan |
| 2026-10-19 | SA slice 1a workplan review | Workplan [ADMIN_EXCHANGE_RATES_SLICE_1A_WORKPLAN.md](/docs/workplans/ADMIN_EXCHANGE_RATES_SLICE_1A_WORKPLAN.md) **APPROVED-WITH-CHANGES** (its §10). Step 0 live results recorded there (`rate_to_usd numeric(12,6)`, `is_enabled` nullable, `updated_by` FK `auth.users`). SQ-5 amended (O-1): rate pattern `^\d{1,6}(\.\d{1,6})?$`, `> 0`, below 1,000,000 |
| 2026-10-19 | Slice 1a merged, slice 1b PR opened | 1a merged via PR #477. 1b built (migration `20261082`, rollback, check 35 extended to 24 checks), SA approved (CR-1/CR-2 applied), QA PASS-WITH-NOTES, user reviewed the diff; RM committed and opened the PR **without auto-merge**. Manual gate: the user applies `20261082` to prod by hand after #477 is deployed. Workplan: [ADMIN_EXCHANGE_RATES_SLICE_1B_WORKPLAN.md](/docs/workplans/ADMIN_EXCHANGE_RATES_SLICE_1B_WORKPLAN.md) |
| 2026-10-19 | BA: slice 1c "Page refinements" | From the user's six page comments and two follow-up answers (D-7, verbatim in §3.3). Comment 1 resolved by slice 2 ("Finance tab only"; no Settings link; §5.3 note, which also records that Finance already has three tabs on `origin/main` `0581637a`). Stale tile dropped, row chip kept ("Keep the row mark"). New §5.5 (filter bar, Country column, history 10, names, KPIs; split 1c.1 / 1c.2, built before slice 2), FR-14 to FR-22, §8 slice 1c criteria, SQ-8 to SQ-16, BQ-1 (flags on Windows), §12 rows; FR-8's stale count withdrawn. Awaiting SA |
| 2026-10-19 | SA requirement review — slice 1c | **CLEARED-WITH-CHANGES** (§13.4). SQ-8 rejected as proposed: `show` is already a Finance URL key (Accounts tab) and `financeFilterRepair` rewrites it, so the key is `currencies`. SQ-9 accepted with a held-rows mechanism; SQ-10 only under flag option (a); SQ-11 all three options buildable, (c) `country-flag-icons` approved as a declared direct dependency under five conditions (MIT, 1.6.20 already locked, named imports from `react/3x2` only, build-size check, dependency diff shown to the user); SQ-12 (b) with Zod query parse, 404, a separate wire type and the page guard's fetch count 2 → 3; SQ-13 with all-or-nothing failure and the lookups kept under `app/api/admin/**`; SQ-14 rate changes only; SQ-15 re-pin of the Exchange rates cases only; SQ-16 split, sequential. SA-1c-1 to SA-1c-8 added. Verified: both name-lookup methods, the admin read guard, `AdminFilterBar` / `useAdminFilters`, Finance's three tabs. Noted §1 stale (1a #477 and 1b #479 merged) |
| 2026-10-19 | BA: BQ-1 answered, SA 1c changes applied | **User, verbatim:** "skip this requirement, not needed" — comment 3 (flag / Country column) **dropped**: recorded in D-7 and §3.3; §5.5.2 reduced to a one-line dropped note; FR-17 withdrawn; §8 Country criterion struck; §12 map / `CountrySelect` rows struck; BQ-1 closed; SQ-10 / SQ-11 marked moot (SA text kept). 1c.2 is now the filter bar only. **SA required BA changes (§13.4):** (1) URL key `currencies` (`disabled` / `all`, `enabled` never written) in §5.5.1, FR-15, §8, SQ-8; SA-1c-1 note in §5.3. (2) §1: 1b applied to prod 2026-10-19 by user (check 35 PASS 24/0, anon REST refused 42501), merged #479; 1c SA cleared, 1c.1 next; slice 2 Finance tab only. (3) §12: page guard fetch count 2 → 3; no `package.json` / lockfile row. (4) §8 1c.1: SQ-12 400 / 404 cases, all-or-nothing name lookup, null `changedBy` → "Unknown user"; §8 1c.2: SQ-9 Refresh step. Ready for the 1c.1 workplan |
| 2026-10-20 | Slice 1c.1 merged; slice 1c.2 built | 1c.1 merged via PR #482 (`origin/main` `0c27b576`). 1c.2 (filter bar) workplan SA-reviewed APPROVED-WITH-CHANGES (C-1: hold the switched code inside `patch` before the row is replaced; C-2: non-vacuous JPY check; Q-1 to Q-7 ruled). Built uncommitted: Show in the URL as `currencies` (default `enabled` never written), page-only Search, count line, filtered empty state, held rows per SQ-9, `active` prop for slice 2. KPIs and history unfiltered. No route, repository, migration or dependency change. Narrow Jest 29 suites / 2,662 tests passed; narrow `tsc`, `eslint`, `lint:hooks` clean. Awaiting SA code review and QA (short path) |
| 2026-10-20 | BA: slice 2 refreshed against today's code | User go-ahead: "start slice 2 (the Finance tab)". Read from `feature/admin-exchange-rates-2-finance-tab` at `c38ad4f4` (1c.2 = PR #484, in the merge queue). §5.3 rewritten: Finance as built (three tabs, `FINANCE_FILTER_SPEC`, the four `financeFilterRepair` rules, tablist inside `data && !error`, panels unmounted on leave), how the fourth tab fits (last, "Exchange rates", `?tab=exchange-rates`, Finance strip / bar / `asOf` hidden, one h1, relative import per DV-1, request unchanged), the old URL (SQ-4 folded in; R8 conflict with a Server Component page raised), and the guards and tests touched (G-4, G-2, both finance guards and `KpiStrip.callers.pin` unchanged; G-6, `AdminSidebar.nav`, layoutFolder registry, two rates render suites, three finance tests and `chargeChecksRedirect` amended). §1 slice 2 row → BA refreshed, awaiting SA; 1c row notes PR #484. FR-23 to FR-27 added; §8 slice 2 criteria rewritten; SQ-17 to SQ-24 added; BA defaults for slice 2 recorded in §11 (no business question); §12 rows updated. User decisions D-5, D-7 not reopened. Awaiting SA |
| 2026-10-20 | SA requirement review — slice 2 | **CLEARED-WITH-CHANGES** (§13.5), read from `c38ad4f4`. SQ-17 (a): `next.config.js` temporary redirect, page deleted (MK-4); (b), (c) and a self-guarding server page (d) rejected. R8 corrected: it accepts a server page that awaits `requireAdminPage()` first (SA-2-1). Query kept, destination `tab` wins (`prepareDestination` 14.2.35, verified). SQ-18 relative imports, no G-4 edit. SQ-19 rates render outside `data && !error`, no finance strip / bar / error / loading / `aria-busy` on the tab; the read keeps running. SQ-20 Finance's spec owns `currencies` via the same field object, reset in `onSelectTab` and one new repair rule; no `owns()` gating and no `active` prop (panels unmount). SQ-21 one h1 "Finance" with the rates purpose; the view drops its header. SQ-22 registry move in 2b. SQ-23 approved with corrections (no tab-values pin exists; `currencies` lines in `financeFilters.test`, `financeFilterBar.layout` `DEFAULTS` and the sidebar on-disk floor 29 → 28 added). SQ-24 accepted. Slice split into **2a** (the tab) and **2b** (the old URL), sequential (SA-2-4). §11 defaults accepted. API routes untouched. User decisions D-5, D-7, BD-12, CUR-3 not reopened |
| 2026-10-20 | BA applied SA slice 2 changes | Per §13.5 "BA, before the 2a workplan". **SA-2-1:** §5.3.3 R8 wording corrected (R8 also accepts a server page whose first statement awaits `requireAdminPage()`; exemption lists empty, cap 0; none exists and (d) is rejected as a new pattern); SQ-17 (a) recorded as ruled, (b) / (c) / (d) rejected. **SA-2-2:** §5.3.2 rewritten — `FinanceFilters` gains `currencies`, `FINANCE_FILTER_SPEC` gains the same field object as its last key, one new `financeFilterRepair` rule after rule 4, `onSelectTab` one write each way, no `active` prop, SQ-19 (i) hidden list (finance strip, placeholders, bar, error, loading, `aria-busy`), one h1 "Finance" with `EXCHANGE_RATES_PURPOSE`, relative imports per SQ-18. **SA-2-3:** §5.3.4 replaced by the SQ-23 list split 2a / 2b (`financeFilters.test` lines 48 / 52 / 60, `financeFilterBar.layout.render.test.tsx:39` `DEFAULTS`; 2b `AdminSidebar.nav` on-disk floor 29 → 28; the non-existent tab-values pin removed). **SA-2-4:** §1 row 2 split into 2a (SA cleared with changes; workplan next) and 2b (after 2a, not stacked); FR-12, FR-23 to FR-25, FR-27 → 2a, FR-26 → 2b; §8 split into 2a / 2b with the one-write-per-switch, rates-visible-while-finance-pending-or-failing (no finance error / loading), exactly-one-h1-"Finance", `currencies`, business-wins and request-string-unchanged criteria; §12 page row "header added in 2a, deleted in 2b". Ready for the 2a workplan |
| 2026-10-20 | Slice 2a workplan approved; built | Workplan [ADMIN_EXCHANGE_RATES_SLICE_2A_WORKPLAN.md](/docs/workplans/ADMIN_EXCHANGE_RATES_SLICE_2A_WORKPLAN.md): SA APPROVED-WITH-CHANGES (Q-1 accepted: the tab's gate is `onRatesTab \|\| (data && !error)`, hidden blocks as holes in place so the tablist keeps keyboard focus, SA-2a-1; SA-2a-2 to SA-2a-4). Dev built it uncommitted on `adb1c6e8`: fourth tab "Exchange rates" at `?tab=exchange-rates`, Finance chrome hidden on it, one h1 "Finance" with the rates sentence, `currencies` owned through the shared field object plus one repair rule, request unchanged; the standalone page renders its own header until 2b. Deviations DV-1 to DV-5 (a fifth forced test edit, the `fromFinanceQuery` expectation; `origin/main` moved to `0c0ca640` (#485) during the build). Narrow Jest 93 suites / 4,637 tests passed; narrow `tsc` 0 errors; `eslint`, `lint:hooks` clean. Awaiting SA code review and QA |
| 2026-10-20 | Slice 2b workplan approved; built | Workplan [ADMIN_EXCHANGE_RATES_SLICE_2B_WORKPLAN.md](/docs/workplans/ADMIN_EXCHANGE_RATES_SLICE_2B_WORKPLAN.md): SA APPROVED-WITH-CHANGES (Q-1 to Q-5 accepted; SA-2b-1 to SA-2b-4). Dev built it uncommitted on `feature/admin-exchange-rates-2b-redirect` (from the 2a tip `251472bb`). `next.config.js` gains the temporary redirect `/admin/exchange-rates` → `/admin/finance?tab=exchange-rates` (no `has`), `app/admin/exchange-rates/page.tsx` is deleted, and there is a new `exchangeRatesRedirect.config.test.ts`. The 2b forced edits per §5.3.4, plus comment-only fixes (Q-1). The DV-3 row was added to the §5.3.4 2a table (SA-2b-3), and the `ExchangeRatesRepository.ts` comment is recorded as a §9 follow-up (Q-1 (d)). API routes, `lib/admin/exchangeRates/`, `lib/repositories/` and `lib/business-os/finance/` are untouched. Awaiting SA code review and QA; the PR opens after #486 merges |
| 2026-10-20 | Slices 2a and 2b merged; 2b follow-up closed | 2a merged via #486 and 2b via #487. The SA Q-1 (d) follow-up is done: the `ExchangeRatesRepository.ts` header comment now names the Finance Exchange rates tab instead of the deleted `/admin/exchange-rates` page. Comment only, no code change. |
| 2026-10-20 | BA: slice 1d "History window" | From the user's 2026-10-20 request and follow-up (D-8, both verbatim in §3). New §1 row 1d; new §5.6 (reuse map read from `origin/main` `930a6cee`; Window control above the history table, shared `DatePresets`, default This month, UTC; newest 10 inside the window filtered on the server; per-currency view follows the window; "Last rate change" stays all-time through a new `lastChange` field, amending SA-1c-2; captions name the period; "No rate changes in this period."). FR-28 to FR-34 (FR-29 amends FR-18); §8 slice 1d criteria; SQ-25 to SQ-34 (URL collision with Finance's `range` / `from` / `to`, query shape, where resolved, Custom bounds, UTC, reset on leave, `lastChange`, `KpiStrip` pin, G-6 count 3, re-read scope); §12 rows. No migration. Out of scope: rates table, KPIs except the tile's data source. Awaiting SA |
| 2026-10-20 | SA requirement review — slice 1d | **CLEARED-WITH-CHANGES** (§13.6), read from `930a6cee`; Dev builds from the §13.6 step list with no separate workplan review. SQ-25 page state accepted (Finance's always-mounted hook owns `range` / `from` / `to`, verified). SQ-26 accepted, plus a date range `2000-01-01`..`2999-12-31` (SA-1d-3); no 92-day cap. SQ-27: the page resolves and sends whole dates (the Costs / AI activity / Audit / Analytics precedent; Finance's server re-resolution is the money exception). SQ-28 to SQ-30 accepted. SQ-31: a separate `findLatestChange()` (`nullsFirst: false`, SA-1d-4), one label lookup across the window rows and `lastChange`; SA-1c-2 amended. SQ-32: no hash moves, additive case rejected (byte-identical). SQ-33: count 3, verified against `ALLOWED_FETCH`. **SQ-34 rejected as proposed**: a window change runs Refresh's reads (plain + open panel), else the overall list goes stale behind the panel. Added SA-1d-1 plain-read request counter, SA-1d-2 captions from the rows' own window, SA-1d-5 `DatePresets` inside `RateHistoryTable` (reuse, not a new pattern), SA-1d-6 no-op change, SA-1d-7 where the "newest 10 in the window" proof lives. Not split. Forced test edits listed. User decisions D-8 not reopened |
| 2026-10-21 | Slice 1d built, PR open | SA code review approved (3 Low findings; Q-1 ruled: "every state" means every caption and empty message). QA PASS-WITH-NOTES, 12 probes added including the plain-read unmount test (mutation-checked). Open note for BA/SA: a Custom range before 2000 returns 400 and shows the page error (the shared DatePresets has no min/max); no history exists before 2026. |
| 2026-10-24 | Slice 1d marked merged | §1 row 1d updated to merged via #492 (it still read "PR open"). Docs only. |
| 2026-10-25 | CLAUDE.md wording fix applied (§3.1) | With the user's sign-off, the CLAUDE.md "Never sum money across currencies" row now reads "An admin-maintained `exchange_rates` table exists, but no figure may be converted or summed with it." The rule is unchanged. Docs only. |
