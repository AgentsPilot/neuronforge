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
| 1a | Safe manual page: server route + repository + page rewired + logging | ✅ Merged #477 (2026-10-19) | #477 | Full cycle (new route, data write, security). Works against today's database policies, so it ships first |
| 1b | Database record + lockdown migration (both tables into the repo, `profiles.role` replaced, browser writes revoked) | ✅ Applied to prod 2026-10-19 by user (check 35 VERDICT PASS 24/0, anon REST read+write refused 42501) · Merged #479 | #479 | Full cycle. **User applies the prod migration by hand** — the session stops for that. Applied only after 1a is deployed, so the page never breaks. Supersedes finance follow-up FF-2 (BD-55) |
| 2 | Exchange rates as a tab under the Finance admin page (no revenue link). **Finance tab only** (user, D-7), no Settings link | ⬜ Not started | — | Full cycle (adds a fourth tab to the existing Finance tablist, §5.3) |
| 1c | Page refinements from the user's 2026-10-19 page review (D-7): filter bar (Enabled only by default), newest 10 changes, admin name instead of the id, new KPIs (Enabled currencies, Last rate change; Stale tile removed). ~~Country flag column~~ dropped by the user (§3.3 comment 3) | 🟡 1c.1 built, PR open (SA approved after C-1/C-2, QA PASS-WITH-NOTES, user click-through passed 2026-10-20); 1c.2 next | — | **Build before slice 2.** Two small slices (§5.5.7): **1c.1** history cap + names + KPIs (route and page; full cycle, the route starts reading people's names), then **1c.2** filter bar only (page only; short path). No migration, no prod step. Comment 1 of the review is resolved by slice 2 (no Settings link) |
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
| FR-12 | Exchange rates is a tab on `/admin/finance`; the existing finance view is the default tab and is unchanged | 2 |
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

---

## 11. Open questions (business)

None blocking. All business choices are settled by D-1 to D-6. The CLAUDE.md wording (§3.1) needs the user's sign-off because it edits the user's root document.

**Slice 1c (D-7).** One question for the user — **closed**:

| # | Question | Default if unanswered |
|---|---|---|
| BQ-1 | On Windows (your machine), flag emoji show as two letters (for example "IL") rather than a picture. Are the letters acceptable, or do you want real flag pictures? Pictures need one small flag package added, which SA must approve | Letters on Windows (emoji, §5.5.2 (a)); real pictures on Mac and phones. **✅ Closed 2026-10-19.** User: "skip this requirement, not needed". Comment 3 dropped; no Country column (D-7, §5.5.2) |

**Assumed by BA for 1c (recorded so nobody re-asks):** the KPIs count every currency, whatever the filter shows; USD counts as an enabled currency; "Last action" means the last **rate** change (the tile is named so); the search box is never kept in the page link (the admin standard); a currency's own History button shows that currency's newest 10.

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
| `app/admin/exchange-rates/components/*` (1c) | View gains the filter bar (`AdminFilterBar` + `useAdminFilters`, URL key `currencies`); KPIs become Enabled currencies + Last rate change; history shows labels. ~~Table gains the Country column~~ (dropped by the user) |
| `lib/admin/exchangeRates/` (1c) | `HISTORY_LIMIT` 50 → 10; wire type gains `changedByLabel`; payloads gain `nameLookup`; separate per-currency payload type (SQ-12). ~~Currency-to-region map~~ (dropped by the user) |
| `app/admin/__tests__/redundantPages.source.guard.test.ts` (1c.1) | The Exchange rates folder's literal `fetch(` count goes **2 → 3** (the per-currency read, SQ-12); test name updated |
| `app/api/admin/exchange-rates/route.ts` (1c.1) | Resolves history editors' names (`findAdminNamesByIds`, `findEmailsByUserIds`); optional `?currency=` per SQ-12 |
| `lib/repositories/UserProfileRepository.ts`, `AdminUserRepository.ts` (1c.1) | No code change; "only caller" header comments updated |
| `app/admin/components/layout/__tests__/KpiStrip.callers.pin.render.test.tsx` (1c.1) | Exchange rates cases re-pinned per SQ-15; new cases appended |
| ~~`components/ui/CountrySelect.tsx`~~, ~~`package.json` / lockfile~~ | Not touched: comment 3 dropped by the user, so SQ-10 / SQ-11 are moot |

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
