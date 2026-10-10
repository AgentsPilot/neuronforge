# Workplan: Business OS Finance & Business Health — Slice 1a

> **Last Updated**: 2026-10-09

**Developer:** Dev
**Requirement:** [BUSINESS_OS_FINANCE_HEALTH_REQUIREMENT.md](/docs/requirements/BUSINESS_OS_FINANCE_HEALTH_REQUIREMENT.md), slice **1a** (§0.1, §9, §10.0). SA-cleared 2026-10-09 (SA-RC).
**SA rulings implemented:** SA-Q1 to SA-Q12, SA-L, SA-S (§0.3); findings SA-F1 to SA-F14 as applied by BA; workplan conditions 1 to 9 (§ SA Requirement Review).
**Date:** 2026-10-09
**Branch:** not yet cut. This workplan was written on the docs branch `docs/bos-finance-health-req` (worktree `neuronforge-finance-health`, `origin/main` `88f97171`, confirmed with `git branch --show-current`). RM cuts the code branch (proposed `feature/bos-finance-health-1a`) from `origin/main` before any code is written. Dev does not create it.
**Status:** Code Complete (uncommitted). Waiting for SA code review.

## Overview

Slice 1a delivers the first, demoable part of a read-only admin page at `/admin/finance`. It has a Monitor menu entry, a filter bar whose state lives in the URL, three KPI tiles (K-1 AI cost month on month, K-3 Founding Partners with no end date, K-5 our revenue), a "Platform revenue: none yet" panel, **Section 1** (accounts by plan) and **Section 3** (AI cost in the window). It is served by one admin route, `GET /api/admin/business-os/finance`.

The slice has no migration, no SQL function, no write, no LLM call and no audit entry. It adds four read-only repository methods: R-a on the ledger read repository, and R-c, R-c′ and R-d on a new `BusinessOsFinanceReadRepository`. It also makes a type-only widening of the Health evaluator (SA-Q1), adds three small exports to `report.ts` (SA-Q3), and adds the paying-status constant (SA-Q5).

Section 4 (credits), K-2, K-4, R-b and the SA-Q7 refactor belong to **1b** and are out of scope here.

Five points need an SA ruling before code starts (§ [Questions for SA](#questions-for-sa-before-code)). Two of them come from places where the requirement does not hold up against the code:
- **SA-W1.** With a business picked, AC-42 forbids R-c, but Section 1 needs it.
- **SA-W2.** The SA-Q5 constant trips two guards that §12.2 lists as "not tripped".

---

## Table of Contents

- [Verification Log](#verification-log)
- [Scope](#scope)
- [Questions for SA before code](#questions-for-sa-before-code)
- [Analysis Summary](#analysis-summary)
- [Implementation Approach](#implementation-approach)
- [Files to Create / Modify](#files-to-create--modify)
- [New repository methods](#new-repository-methods)
- [The route](#the-route)
- [Pure functions and their tests](#pure-functions-and-their-tests)
- [The page](#the-page)
- [SA-Q1 to SA-Q12: implementation notes](#sa-q1-to-sa-q12-implementation-notes)
- [Guard table §12.2, line by line](#guard-table-122-line-by-line)
- [AC mapping](#ac-mapping)
- [Verification plan](#verification-plan)
- [Logging](#logging)
- [Risks](#risks)
- [Estimate](#estimate)
- [Task List](#task-list)
- [Implementation Notes](#implementation-notes)
- [SA Workplan Review](#sa-workplan-review)
- [SA Code Review](#sa-code-review)
- [QA Report](#qa-report)
- [Commit Info](#commit-info)
- [Change History](#change-history)

---

## Verification Log

Every file below was opened at `88f97171` in this worktree. Line numbers are from that tree.

| Claim | Where |
|---|---|
| Monitor group: Health is first, at `/admin` | `app/admin/components/AdminSidebar.tsx:82-120` (Health `:86-93`); icons imported at `:7-32` |
| The nav test pins Monitor's hrefs, the on-disk page count and the listed count | `app/admin/components/__tests__/AdminSidebar.nav.test.ts:98-104`, `:142` (`>= 28`), `:159` (`toHaveLength(27)`) |
| `/admin` is the Health landing; the layout gates every page | `app/admin/page.tsx:16-20`; `app/admin/layout.tsx:30, 34-47` (`requireAdminPage`) |
| `HealthCondition<M extends MetricId, F extends FlagId>` has no defaults | `lib/admin/health/rules.ts:97-114`; `HealthRule` `:116-125`; `HealthRuleSet` `:128-136`; `TILE_VOCABULARY` `:141-164` |
| Validation reads `TILE_VOCABULARY[tile]` | `lib/admin/health/evaluateHealth.ts:188-222` (`conditionProblem`), `:225-259` (`validateRuleList`), `RuleErrorReport` `:164-168` |
| Micro-unit matching, C-2 | `evaluateHealth.ts:264-265`, `matchCondition` `:268-309` (typed on `MetricId` / `FlagId`), `firstMatchingRule` `:312-321` |
| C-18 lower-bound amber, green eligibility | `evaluateHealth.ts:88` (`LOWER_BOUND_TILES`), `:99-106` (`GREEN_ELIGIBLE`), `:64` (`LOWER_BOUND_HEADLINE`), `colourTile` `:444-547` (C-18 branch `:499-510`) |
| `Measured` and `TileStatus` | `lib/admin/health/windows.ts:54-57`; `lib/admin/health/healthTypes.ts:23` (runtime-free) |
| `STATUS_STYLES` is exported from a client component | `app/admin/components/health/HealthTile.tsx:1, 46` |
| Activity presets | `app/admin/business-os-llm/activityPresets.ts:10` (`ACTIVITY_PRESETS`), `:18-20`, `:23-47` (`today`, `this_month`) |
| Business picker API | `app/admin/audit-trail/BusinessAccountPicker.tsx:51, 73-77, 103` (`{ selectedAccountId, onSelect }`); reused by `ActivityFilters.tsx:20` |
| Cut-over clamp and notice | `lib/business-os/credits/aiActivity.ts:142` (`CHARGING_CUTOVER_FLOOR_MS`), `:215-221` (`cutoverClamp`), `:226` (`settle`); `app/admin/business-os-llm/components/activity/CutoverNotice.tsx:22-30, 32` |
| Exact-sum helpers, 92 days | `lib/business-os/credits/creditReport.ts:70-83` (`MAX_WINDOW_DAYS: 92`, `ROWS_CEILING: 20_000`), `:89-90` (scales), `:127-131` (`windowInstants`), `:136-139` (`toUnits`) |
| Effective fields (N-10) | `lib/business-os/credits/effectiveFields.ts:25` (`server-only`), `:110-123` (`resolveEffectiveFields`) |
| Ledger read repository: header, columns, limits, the account-scoped time read | `lib/repositories/BusinessOsCreditLedgerReadRepository.ts:17-38` (service-role callers paragraph), `:41-61` (account scope by signature), `:157-159` (`CREDIT_LEDGER_ROW_COLUMNS`), `:178-183` (`MAX_PAGE_SIZE 1000`, `MAX_CEILING 20_000`), `:291-300` (`assertPaging`), `:355-362` (`fail`), `:589-635` (`listRowsForAccountCreatedInRange`), `:648-683` (`findChargesByActionIds`), `:754` (`listChargesAllAccountsInWindow`, not used) |
| The ledger repository's no-write pin and exact caller list | `lib/repositories/__tests__/BusinessOsCreditLedgerReadRepository.test.ts:909` (`WRITE_VERB`), `:937-976` (caller list; the requirement cites `:950-975`) |
| Wiring precedents | `lib/business-os/credits/aiActivityDeps.ts:27-37`; `lib/business-os/credits/adminCreditPercentDeps.ts:24, 30-36` |
| Plan repository | `lib/repositories/BusinessOsAccountPlanRepository.ts:147-150` (`PLAN_COLUMNS`), `:234-253` (`findEntitlementInputs`, `.eq('user_id')`), `:382-405` (`pagePlans`, keyset, limit clamped to 1..1000), `:954-962` (`toInputs`) |
| Shadow report walk and inline predicates | `lib/business-os/entitlements/report.ts:73` (`PAGE_SIZE 500`), `:76` (`MAX_ACCOUNTS 20000`), `:449-566` (`buildStatic`), `:474`, `:491`, `:497-499` (open-ended cohort), `:507-509` (dormant champion), `:658-664` (`lifecycleInputs`, private) |
| Lifecycle | `lib/business-os/entitlements/lifecycle.ts:47-51` (`EntitlementBasis`), `:116-118` (`stateForCohort`, private), `:132` (`deriveLifecycle`), `:186-195` (tier in force wins); `types.ts:344` (`LifecycleState`) |
| Tier names and labels come from config | `lib/business-os/entitlements/config/tierMatrix.ts:71` (`TIER_ORDER`), `:243-262` (`presentation[tier].labels`); `source.ts:165` (`getEntitlementConfig`) |
| Non-gate importer list | `lib/business-os/entitlements/__tests__/enforcementPoints.test.ts:200-204`; `adminCreditPercent.ts` entry `:375-379` |
| RC-15 plan-repository guard | `lib/repositories/__tests__/businessOsEntitlements.imports.guard.test.ts:48-53` (symbols, also matched in import paths), `:63-174` (`ALLOWED`), `:184-185`, `:222-241` (`NO_STATE_WRITE_REFERRERS`), `:307-344` (every file in exactly one category), `:375-387` (8a pin precedent) |
| N-10 guard scan list | `lib/business-os/credits/__tests__/serviceColumn.guard.test.ts:18-20, 67-90, 92-119` |
| Paying-status type lives in a money repository | `lib/repositories/BusinessOsBillingAccountRepository.ts:55-63` (`BusinessOsSubscriptionStatus`); unique `(user_id, livemode)`: `supabase/migrations/20261025_business_os_billing_accounts.sql:30` |
| Billing-account exact caller list (text match, comments included) | `lib/repositories/__tests__/BusinessOsBillingAccountRepository.test.ts:481-540` |
| Billing directory: no repository import, not even type-only, and no "supabase" in the text | `app/api/stripe/webhook/__tests__/routerPlacement.guard.test.ts:37-43` (`BILLING_REPOSITORY_CALLERS`), `:617-637` |
| Sets SA-Q5 forbids reusing | `lib/business-os/billing/planCheckout.ts:89-96`; `lib/business-os/purge/adminDeletionRefusals.ts:67` |
| Route precedent | `app/api/admin/business-os/ai-activity/route.ts:46-47` (nodejs, force-dynamic), `:138-141` (gate first), `:147-152` (repeated key 400), `:155-165` (Zod 400), `:170-172` (platform 409, **not** copied: SA-F14), `:199-224` (one info line), `:227-241` (500 format) |
| Gate | `lib/admin/requireAdminRoute.ts:63`, 401 `:73, :77`, 403 `:116` (it sets no `Cache-Control`) |
| Admin name read | `lib/repositories/BusinessProfileRepository.ts:681` (`findAdminIdentitiesByUserIds`); `isPlatformAccount` `lib/business-os/llm/callCatalog.ts:236` |
| URL precedents (read only, Suspense) | `app/admin/audit-trail/page.tsx:3-4, 124, 275-280`; `app/admin/analytics/*` `useSearchParams` in Suspense |
| A server file may import from `app/admin` | `app/api/admin/health-summary/route.ts:53` |
| Scripts | `package.json:20` (`test:authz-guard`), `:23` (`test:bos-entitlements`), `:25` (`lint:hooks`), `:30` (`typecheck:bos-llm`); `scripts/typecheck-bos-llm.ts:102-110` (`lib/business-os/credits/` and `entitlements/` are scoped, so their direct callers are type-checked too) |
| 1b files, read only to keep them out | `lib/business-os/credits/adminCreditPercent.ts:193-194, 286`; `lib/business-os/credits/__tests__/creditLots.test.ts:201-228` (G3) — **not touched in 1a** |

---

## Scope

Exactly the 1a row of §10.0.

| In 1a | Out (1b or later) |
|---|---|
| S1-FR-1 to S1-FR-20, S1-FR-25 to S1-FR-27 | S1-FR-21 to S1-FR-24 (Section 4) |
| Tiles K-1, K-3, K-5 | K-2, K-4 (not rendered, not placeholders) |
| Reads R-a, R-c (+ R-c′, see SA-W1), R-d | R-b; the SA-Q7 refactor of `adminCreditPercent.ts`; G3 and lot-repository caller lists |
| SA-Q1 type widening; `report.ts` exports (SA-Q3); paying constant (SA-Q5); sibling preset module and URL module (SA-Q2, L-4) | Currency-grouping helper (slice 2, DF-1); businesses without a plan row (DF-2) |
| ACs tagged 1a (see [AC mapping](#ac-mapping)) | AC-8, 11, 13, 16, 17, 19, 38, 43 and the 1b clauses |

---

## Questions for SA before code

These are workplan-level forks. Each has a recommendation, and I build the recommendation unless SA rules otherwise.

| # | Issue | Recommendation |
|---|---|---|
| **SA-W1** | **The requirement contradicts itself when a business is picked.** L-3 says "accounts now" sections are not account-sensitive. SEC-3, S1-FR-9 and AC-42, however, say that with `accountId` set "**no** all-accounts method (R-a, R-b, R-c) is called". Section 1's paying vs comped split **needs** R-c (S1-FR-15), and its classification needs the all-accounts `pagePlans` walk. Both cannot hold. There is a second gap: S1-FR-9's 404 needs an account-scoped existence read on the plan table, and the RC-15 pin allows only `pagePlans`. | **Narrow Section 1 to the picked business.** All six groups are still shown, with Total 1 and the account's group at 1. The plan row is read with the existing account-scoped `findEntitlementInputs(accountId)` (`.eq('user_id')`, `:234-253`): no row → 404, a read error → 500 "Could not check this business". Overrides are discarded unread: never returned, never logged. Paying comes from a new account-scoped **R-c′** `findLiveBillingStatusForAccount(accountId)` (named per the "differently named method" convention). K-3 and the AI cost by-plan-group breakdown come from the same row. With `accountId` set, `pagePlans`, R-a and R-c get **zero** calls. The RC-15 pin becomes **two** methods (`pagePlans`, `findEntitlementInputs`). If SA prefers a plan-only read with no override embed, the alternative is a new `findPlanRow(accountId)` on the plan repository (one more method and test). |
| **SA-W2** | **The SA-Q5 constant trips two guards that §12.2 lists as "not tripped".** SA-Q5 puts the constant in `lib/business-os/billing/`, typed against `BusinessOsSubscriptionStatus`. That type is exported only from `lib/repositories/BusinessOsBillingAccountRepository.ts:55`. (a) `routerPlacement.guard.test.ts:617-637` forbids **any** repository import in a `lib/business-os/billing/` file, type-only included, unless the file is in `BILLING_REPOSITORY_CALLERS`. (b) `BusinessOsBillingAccountRepository.test.ts:481-540` is an exact text-match list, and the import path contains the class name. | **Option A (recommended):** `import type { BusinessOsSubscriptionStatus }` in the new file, and add it, with a "type only, not a caller" comment, to (a) `BILLING_REPOSITORY_CALLERS` and (b) the billing-account `ALLOWED` list. Its test needs no listing because it does not name the repository. Precedent for (b): `adminDeletionRefusals.ts` and `BusinessOsBillingEventRepository.ts` are listed as "status TYPE only". **Option B:** no import. The two statuses are a literal `as const`, and the co-located test reads `20261025_business_os_billing_accounts.sql` and asserts each one is in the CHECK list. No guard is touched, but the constant is not "typed against" the union, which deviates from SA-Q5's wording. |
| **SA-W3** | The §8.1 row "`grace` + basis `cohort` → its cohort group" needs a cohort → group mapping. Writing `'champion'` / `'trial'` in finance code copies `lifecycle.ts:116-118` (`stateForCohort`, private), which is the duplication SA-F6 warns against. | **Export `stateForCohort`** from `lifecycle.ts` (export keyword only, no behaviour change). The mapping then goes through **one** function: `groupForState(stateForCohort(basis.cohort))`. That adds one symbol to the finance importer's registration. Finance code compares only `LifecycleState` values typed by the union, never cohort ids. |
| **SA-W4** | SA-Q1 lets finance validation either widen `validateRuleList` or copy the vocabulary check. | **Widen through an extracted core**: `validateRuleListAgainst<T extends string>(tile: T, rules: unknown, vocabulary: { metrics: readonly string[]; flags: readonly string[] })` holds today's body, with `conditionProblem` taking the vocabulary instead of the tile id. `validateRuleList(tile, rules)` becomes a one-line delegate passing `TILE_VOCABULARY[tile]`. This is a behaviour-preserving extract, and every Health test passes unchanged. The alternative is a copy of about 60 lines that could drift. If SA reads "no runtime line in Health changes" strictly, I build the finance copy instead. |
| **SA-W5** | K-1 with an exact previous span of **$0** after the cut-over. Health's `ratioAtLeast` treats a zero baseline as "new spend": the rule fires when the current figure is at least the floor (`evaluateHealth.ts:286`). K-1's first rule is red ("doubled"), so a first month with spend after a zero month turns K-1 **red**. | Keep Health's semantics unchanged (SA-Q12 says reuse them). The red description says "AI cost at least doubled vs the same days last month", and the condition summary shows the $0 baseline. A test pins this case. |

Smaller points, recorded here so the review can strike them out:
- **SA-W6.** For a non-custom preset, a client `from` / `to` is **format-checked** (it is a known key, so a malformed one is still a 400) and its **value is ignored**. Range rules (order, today, 92 days) apply only to `custom`.
- **SA-W7.** Tile states reuse `STATUS_STYLES` labels as they are ("Needs action", "Needs a look", "For information", …). L-2's "Needs attention / Watch / No data yet" were examples, and SA-L said to reuse `STATUS_STYLES`.
- **SA-W8.** The sibling preset module sits at `app/admin/components/adminWindowPresets.ts` (SA-Q2: "beside the shared admin components"). The route imports it from there, as `health-summary/route.ts:53` already imports from `app/admin`.

---

## Analysis Summary

| Area | Touched how |
|---|---|
| Admin shell | One Monitor entry after Health; nav test |
| New page | `/admin/finance` (client view inside Suspense, under the guarded layout) |
| New route | `GET /api/admin/business-os/finance` |
| Builder | New `lib/business-os/finance/` module: window, classifier, AI-cost sums, rules, orchestrator, wiring |
| Health evaluator | Generic widening (SA-Q1) and the extracted validator core (SA-W4) |
| Entitlements | `report.ts` exports `lifecycleInputs`, `isOpenEndedCohort`, `isDormantChampion` (SA-Q3); `lifecycle.ts` exports `stateForCohort` (SA-W3) |
| Repositories | R-a added to the ledger read repository; new `BusinessOsFinanceReadRepository` (R-c, R-c′, R-d) |
| Billing | New paying-status constant (SA-Q5) |
| Tables read | `business_os_account_plans`, `business_os_credit_charges`, `business_os_billing_accounts` (status only), `business_os_billing_events` and `business_os_boost_purchases` (head counts only). All are live-verified (LS:151). `token_usage` and the layer-B tables are not read |
| Not touched | Money writers; `listChargesAllAccountsInWindow`; `buildShadowReport`'s control flow; `activityPresets.ts`; `adminCreditPercent.ts`; Health runtime behaviour |

---

## Implementation Approach

1. **Bottom up, pure first.** The repository methods and pure functions come first, each with tests. Then the orchestrator with injected deps, then the route, then the UI. Each layer is testable without the next one.
2. **One orchestrator, settled sections (SA-Q8).** `buildFinanceHealth(input, logger, deps)` starts every independent read at once through the existing `settle` helper (`aiActivity.ts:226`), so a read that throws becomes `{ error }` and never rejects. Each section derives its `status` (`ok` / `partial` / `unknown`) from its own reads. The names lookup for the top 10 runs after the cost read.
3. **One clock.** The route takes `now = new Date()` once. The window, the K-1 spans, the cut-over clamp, "ending in 30 days" and `generatedAt` all use it.
4. **Exact sums.** Cost and credits are summed as integers with `toUnits` / `COST_SCALE` / `CREDIT_SCALE` (`creditReport.ts:89-90, 136-139`) and converted to a number once, at the edge. An unreadable amount counts as 0 and is **counted** (`unreadableAmounts`). The same never-silent rule applies as in the Activity route log.
5. **Reuse, not copy.** `matchCondition` / `firstMatchingRule` (widened), `cutoverClamp`, `CHARGING_CUTOVER_FLOOR_MS`, `windowInstants`, `toUnits`, `resolveEffectiveFields`, `settle`, `deriveLifecycle` + `fromPlanRow` + `lifecycleInputs`, the `report.ts` predicates, `BusinessAccountPicker`, `CutoverNotice` and `STATUS_STYLES`.
6. **Placement.** The builder lives in `lib/business-os/finance/` (its own domain; slices 2 to 8 add revenue there). The N-10 guard's scan list is extended to cover it, as §12.2 allows.

---

## Files to Create / Modify

### Create

| File | Purpose |
|---|---|
| `lib/repositories/BusinessOsFinanceReadRepository.ts` | New read-only repository: R-c, R-c′, R-d. Service role documented, no write method |
| `lib/repositories/__tests__/BusinessOsFinanceReadRepository.test.ts` | One test per method, column lists, `livemode = true`, head count, ceiling → error, no-write source pin, caller list |
| `lib/business-os/billing/payingSubscriptionStatuses.ts` | `PAYING_SUBSCRIPTION_STATUSES = ['active', 'past_due']` (typed per SA-W2) and `isPayingBillingRow({ subscription_status, ended_at })` |
| `lib/business-os/billing/__tests__/payingSubscriptionStatuses.test.ts` | Exact set; differs from `LIVE_SUBSCRIPTION_STATUSES` and `R3_LIVE_STATUSES` and is not a reference to either; `ended_at` set → not paying |
| `app/admin/components/adminWindowPresets.ts` | Sibling preset module (SA-Q2): `today`, `7d`, `30d`, `this_month`, `custom`; `resolveAdminWindow(preset, now)`; `ADMIN_WINDOW_MAX_DAYS = 92` (a literal, pinned equal to `CREDIT_REPORT_LIMITS.MAX_WINDOW_DAYS` by the test, so the client bundle does not pull in a server module); `inclusiveDays(from, to)`; `isRealDate` |
| `app/admin/components/__tests__/adminWindowPresets.test.ts` | UTC edges, `7d` / `30d` include today, parity with `activityPresets.resolvePreset` for `today` and `this_month`, year boundary |
| `app/admin/finance/financeUrl.ts` | Pure `parseFinanceUrl(params, now)` → `{ query, notice }` and `serialiseFinanceUrl(query)` (L-4 condition 1) |
| `app/admin/finance/__tests__/financeUrl.test.ts` | Invalid value → default + notice; unknown key dropped; round trip; never a name |
| `lib/business-os/finance/financeTypes.ts` | Runtime-free payload types (`FinancePayload`, sections, tiles). No imports from entitlements or repositories, so the client may `import type` it |
| `lib/business-os/finance/financeWindow.ts` | Pure: `resolveFinanceWindow(query, now)`, `k1Spans(now)`, `isBeforeCutover(span)` |
| `lib/business-os/finance/planGroups.ts` | Pure classifier, **the only finance file that imports from `lib/business-os/entitlements/`**: `groupFor(lifecycle, paying)`, `classifyAccounts(rows, payingIds, window, now)` |
| `lib/business-os/finance/aiCost.ts` | Pure: `summariseAiCost(rows, reachedCeiling, originals, groupOf)` |
| `lib/business-os/finance/financeRules.ts` | Rule data (`FINANCE_RULES`), `FINANCE_TILE_VOCABULARY`, `FINANCE_GREEN_ELIGIBLE`, `colourFinanceTile` |
| `lib/business-os/finance/financeHealth.ts` | Orchestrator `buildFinanceHealth(input, logger, deps)`; `FinanceHealthDeps` (all `Pick<>`) |
| `lib/business-os/finance/financeHealthDeps.ts` | `server-only` production wiring (the one file naming the repository singletons) |
| `lib/business-os/finance/__tests__/financeWindow.test.ts` | Window and K-1 span arithmetic |
| `lib/business-os/finance/__tests__/planGroups.test.ts` | Mapping over every state × basis, sum = Total, paying vs comped, K-3 count, predicates |
| `lib/business-os/finance/__tests__/aiCost.test.ts` | Exact sums, deleted bucket, triggers, groups, top 10, ceiling |
| `lib/business-os/finance/__tests__/financeRules.test.ts` | K-1 / K-3 / K-5 colouring, threshold-in-data, rule validation |
| `lib/business-os/finance/__tests__/financeHealth.test.ts` | Section isolation, scoping, revenue panel branches, cut-over |
| `lib/business-os/finance/__tests__/finance.source.guard.test.ts` | No write verbs, no aggregate select, no `token_usage`, no layer-B table, no tier literal, no `console.`, no `listChargesAllAccountsInWindow` |
| `app/api/admin/business-os/finance/route.ts` | The route |
| `app/api/admin/business-os/finance/__tests__/route.test.ts` | Integration (mocked gate, deps, names) |
| `app/admin/finance/page.tsx` | Server component: `<Suspense fallback={null}><FinanceView /></Suspense>` |
| `app/admin/finance/useFinanceData.ts` | Hook: fetch with `AbortController`, `cache: 'no-store'`, retry |
| `app/admin/finance/components/FinanceView.tsx` | Client: URL ↔ state (`useSearchParams`, `router.replace(…, { scroll: false })`), header, layout |
| `app/admin/finance/components/FinanceFilterBar.tsx` | Presets, custom dates (Apply), `BusinessAccountPicker` |
| `app/admin/finance/components/FinanceKpiStrip.tsx` | Tiles with text state + `STATUS_STYLES` |
| `app/admin/finance/components/FinanceSection.tsx` | Heading, subtitle (source + window), status badge, "Could not load this section" + retry |
| `app/admin/finance/components/RevenuePanel.tsx` | "Our revenue" panel, three branches |
| `app/admin/finance/components/AccountsByPlanSection.tsx` | Section 1 (a `components/ui` table) |
| `app/admin/finance/components/AiCostSection.tsx` | Section 3 + `CutoverNotice` + link to AI cost & usage |
| `app/admin/finance/financeCopy.ts` | Every user-facing string (tests assert against it) |
| `app/admin/finance/__tests__/financePage.render.test.tsx` | jsdom render: text states, failed section, none-yet panel has no `$0`, at-least wording |
| `app/admin/finance/__tests__/source.guard.test.ts` | No `@/lib/repositories` import under `app/admin/finance`, no `console.`, Suspense + `replace` (not `push`) |

### Modify

| File | Change |
|---|---|
| `app/admin/components/AdminSidebar.tsx` | Monitor item after Health: `{ name: 'Finance', href: '/admin/finance', icon: Wallet, description: 'Revenue, AI cost and credits, Business OS' }`; one new lucide import (`Wallet`) |
| `app/admin/components/__tests__/AdminSidebar.nav.test.ts` | Monitor list adds `/admin/finance` second; `toContain('/admin/finance')`; listed count 27 → 28; on-disk floor 28 → 29 (comments updated) |
| `lib/admin/health/rules.ts` | `HealthCondition<M extends string = MetricId, F extends string = FlagId>`. Nothing else |
| `lib/admin/health/evaluateHealth.ts` | Generic `matchCondition<M extends string = MetricId, F extends string = FlagId>(condition: HealthCondition<M, F>, metrics: Partial<Record<M, Measured>>, flags: Partial<Record<F, boolean>>)`; `firstMatchingRule<R extends { condition: HealthCondition<M, F> }, M extends string = MetricId, F extends string = FlagId>`; extracted `validateRuleListAgainst` (SA-W4) |
| `lib/business-os/entitlements/report.ts` | `export function lifecycleInputs`; new `export function isOpenEndedCohort(row)` (= `:497` condition) and `export function isDormantChampion(row)` (= `:507` condition), used in place of the inline conditions. Control flow unchanged |
| `lib/business-os/entitlements/lifecycle.ts` | `export` on `stateForCohort` (SA-W3) |
| `lib/repositories/BusinessOsCreditLedgerReadRepository.ts` | R-a; header: the finance caller paragraph and R-a added to "ALL ACCOUNTS" |
| `lib/repositories/__tests__/BusinessOsCreditLedgerReadRepository.test.ts` | R-a tests; caller list + the three finance files |
| `lib/repositories/index.ts` | Export `BusinessOsFinanceReadRepository`, `businessOsFinanceReadRepository` and their types |
| `lib/repositories/__tests__/businessOsEntitlements.imports.guard.test.ts` | `ALLOWED` + `NO_STATE_WRITE_REFERRERS` entries; `FINANCE_WIRING` pin test |
| `lib/business-os/entitlements/__tests__/enforcementPoints.test.ts` | `KNOWN_NON_GATE_IMPORTERS` entry for `planGroups.ts` |
| `lib/business-os/credits/__tests__/serviceColumn.guard.test.ts` | Scan `lib/business-os/finance/**`, the finance route and `app/admin/finance/**`; name them in the `arrayContaining` pin |
| `lib/repositories/__tests__/BusinessOsBillingAccountRepository.test.ts` | Only under SA-W2 option A: `ALLOWED` + the constant file |
| `app/api/stripe/webhook/__tests__/routerPlacement.guard.test.ts` | Only under SA-W2 option A: `BILLING_REPOSITORY_CALLERS` + the constant file (type-only comment) |
| `docs/requirements/BUSINESS_OS_FINANCE_HEALTH_REQUIREMENT.md` | §0.1, Change History, and the 1a results after each stage |

None of the files to modify uses `console.*` (counted: AdminSidebar, evaluateHealth, rules, report, lifecycle, the ledger read repository, index, BusinessAccountPicker, aiActivity, HealthTile, CutoverNotice, activityPresets and creditReport, all 0).

---

## New repository methods

All of them use the `new-repository` skill's shape: injected client (default `supabaseServer`), `createLogger({ service })`, `{ data, error }`, never throw, guard errors logged at `warn`, read errors at `error`.

### R-a — `BusinessOsCreditLedgerReadRepository.listRowsOfAllAccountsCreatedInRange`

| Item | Spec |
|---|---|
| Signature | `async listRowsOfAllAccountsCreatedInRange(range: CreditPeriodStartRange, opts: CreditLedgerPageOptions): Promise<RepositoryResult<CreditLedgerPagedResult<CreditLedgerRow>>>` |
| Client | Service role (constructor default). Header: added to "ALL ACCOUNTS", with the caller paragraph "Finance & business health slice 1a, wired in `lib/business-os/finance/financeHealthDeps.ts`, reached only from `app/api/admin/business-os/finance` after `requireAdmin`, and only when no business is picked" |
| Query | `.from('business_os_credit_charges').select(CREDIT_LEDGER_ROW_COLUMNS).gte('created_at', from.toISOString()).lt('created_at', to.toISOString()).order('created_at', { ascending: false }).order('id', { ascending: false }).range(offset, offset + size - 1)` |
| Filters | **No** `user_id` filter (NULL rows included, by design). **No** `kind` filter (charges **and** adjustments). **No** `service` filter (N-10) |
| Paging | `pageSize` 1..1000, `ceiling` 1..20,000 (`assertPaging`, `:291-300`); loop `while rows.length < ceiling`; page size `min(pageSize, ceiling - rows.length)`; stop on a short page |
| De-duplication | By `String(row.id)` with a `Set`, first copy kept (the `:589-635` shape) |
| Ceiling | `reachedCeiling = rows.length >= ceiling` (`>=`, "may be incomplete"); rows sliced to `ceiling` |
| Logging | `info` (cross-account): `{ method, rows, reachedCeiling, durationMs }`. No figure |
| Errors | `assertRange` / `assertPaging` → `CreditLedgerReadGuardError` → `fail` (warn); a PostgREST error → `fail` (error). Returns `{ data: null, error }` |
| Result | `{ data: { rows, reachedCeiling }, error: null }` |
| Caller's values | `{ pageSize: 1000, ceiling: 20_000 }` (`FINANCE_LIMITS.LEDGER_PAGE_SIZE / LEDGER_CEILING`) |

The one-business counterpart is the existing `listRowsForAccountCreatedInRange(accountId, range, opts)`, with the same options.

### New `BusinessOsFinanceReadRepository` (R-c, R-c′, R-d)

Header text (summary): read-only by construction; "WHY A SEPARATE REPOSITORY" (SA-F2): it keeps a read page off the money writers' exact caller lists. **The header names those repositories in words ("the billing-account repository", "the billing-event repository", "the boost purchase repository"), never by class name**: their caller guards match the text, comments included (`BusinessOsBillingAccountRepository.test.ts:521-533`). It also says why the service role is used (an admin cross-account read; the owner RLS client cannot read other accounts, and the billing tables are server-write-only), names its one caller and gives the account-scope-by-signature rule. Exported constants: `FINANCE_BILLING_STATUS_COLUMNS = 'user_id, subscription_status, ended_at'`, `FINANCE_READ_LIMITS = { BILLING_PAGE_SIZE: 1000, BILLING_CEILING: 20_000 }`.

| | **R-c** `listLiveBillingStatusesAllAccounts` | **R-c′** `findLiveBillingStatusForAccount` (SA-W1) | **R-d** `countLiveRevenueRows` |
|---|---|---|---|
| Signature | `(opts?: { pageSize?: number; ceiling?: number }) → RepositoryResult<FinanceBillingStatusRow[]>` | `(accountId: string) → RepositoryResult<FinanceBillingStatusRow \| null>` | `() → RepositoryResult<{ planInvoicesPaid: number; boostsPaid: number }>` |
| Scope | Named all-accounts | Account-scoped; UUID asserted before the query | Platform-wide existence |
| Query | `.from('business_os_billing_accounts').select(FINANCE_BILLING_STATUS_COLUMNS).eq('livemode', true).order('user_id').limit(size)` plus keyset `.gt('user_id', last)` | `.from('business_os_billing_accounts').select(FINANCE_BILLING_STATUS_COLUMNS).eq('user_id', accountId).eq('livemode', true).maybeSingle()` (unique `(user_id, livemode)`, migration `:30`) | Two head counts in parallel: `business_os_billing_events` `.select('id', { count: 'exact', head: true }).eq('livemode', true).eq('kind', 'invoice_paid')`; `business_os_boost_purchases` `.select('id', { count: 'exact', head: true }).eq('livemode', true).not('paid_at', 'is', null)` |
| Rows with `user_id` NULL | Keyset paging on `user_id` cannot step over NULLs, so the query adds `.not('user_id', 'is', null)` (an unattributable row cannot classify an account) | n/a | n/a (counted, never read) |
| Ceiling | 20,000; **reached → error** (`FinanceReadCeilingError`), never a partial list: a cut list would silently turn paying accounts into Comped. The caller shows the "Tier set" fallback (SA-Q5) | n/a (one row) | n/a (head count, no rows) |
| Logging | `info`: `{ method, rows, durationMs }` | `debug`: `{ method, found }` (no account id at info; the route logs the filter) | `info`: `{ method, planInvoicesPaid, boostsPaid }` (counts, not money) |
| Errors | Guard error → warn; read error → error; `{ data: null, error }` | Same; `null` data = no live row | Either count failing → `{ data: null, error }` (the panel says "Could not check") |
| Row type | `FinanceBillingStatusRow = { user_id: string; subscription_status: string \| null; ended_at: string \| null }`. `subscription_status` is `string`, so the repository imports no type from the billing-account repository; the caller narrows it with `isPayingBillingRow` | same | — |

Repository tests (`BusinessOsFinanceReadRepository.test.ts`), with a recording fake client like the ledger test:
- R-c: exact columns; `eq('livemode', true)`; no `.eq('user_id'…)`; keyset across two pages; ceiling → error; a read error → `{ data: null }`.
- R-c′: malformed id refused before any query (zero `from` calls); exact `eq` calls `user_id` then `livemode`; no row → `null`.
- R-d: both head counts with `{ count: 'exact', head: true }`; the exact `eq` / `not` args; test-mode rows are excluded by the query (AC-23 half: `livemode` must be `true`); either error → error.
- Source pin: no `.insert(` / `.update(` / `.upsert(` / `.delete(` / `.rpc(` (the ledger test's `WRITE_VERB`, with its planted negative control); no `select('sum` / `count(` aggregate; the text names none of `BusinessOsBillingAccountRepository`, `BusinessOsBillingEventRepository`, `BusinessOsBoostPurchaseRepository`.
- Caller list: only `lib/business-os/finance/financeHealthDeps.ts`, `lib/business-os/finance/financeHealth.ts` (types), `lib/repositories/index.ts` and itself (the ledger test's walk shape, `__tests__` skipped).

---

## The route

`app/api/admin/business-os/finance/route.ts`, `export const runtime = 'nodejs'`, `export const dynamic = 'force-dynamic'`.

```text
GET /api/admin/business-os/finance?preset=today|7d|30d|this_month|custom[&from=YYYY-MM-DD&to=YYYY-MM-DD][&accountId=<uuid>]
```

Order. Nothing before the gate, and nothing from the request reaches a read except validated values:

1. `correlationId = header x-correlation-id ?? crypto.randomUUID()`, `baseLogger = logger.child({ correlationId })`.
2. **`const gate = await requireAdmin(baseLogger)`, the first statement inside the handler body.** On a `NextResponse`, set `Cache-Control: no-store` on it and return it (the 401 / 403 bodies come from `requireAdmin`, which sets no cache header; AC-35).
3. `requestLogger = baseLogger.child({ adminId: gate.user.id })`, `startedAt`.
4. `try {`. A repeated key → 400 "Each query parameter may appear once", **before** Zod (AC-33).
5. `now = new Date()` (the request's one clock). `buildQuerySchema(now).safeParse(Object.fromEntries(params))`:
   - `.strict()`: unknown key → 400.
   - `preset`: `z.enum(['today', '7d', '30d', 'this_month', 'custom']).default('this_month')`.
   - `from` / `to`: optional, `YYYY-MM-DD` and a real calendar date (`dateMs`, as `ai-activity/route.ts:53-58`).
   - `accountId`: `z.string().uuid()` optional.
   - `superRefine`, only for `custom`: both dates required; `from <= to`; `to <= today UTC` (**no** one-day tolerance, AC-34); `inclusiveDays(from, to) <= 92` (92 accepted, 93 refused).
   - Failure → 400 `{ success: false, error: <first issue message>, details: dev-only flatten() }`.
6. Window: `resolveFinanceWindow(query, now)`. For a preset this calls `resolveAdminWindow(preset, now)` and **drops** any client `from` / `to` (SA-Q2, L-4(5), SA-W6).
7. `accountId`: `isPlatformAccount(accountId)` → 404 `{ success: false, error: 'Business not found' }` (a pure check; the same body as below, SA-F14). The plan-table check runs inside the builder through `findEntitlementInputs` (SA-W1). A not-found there makes the builder return `{ kind: 'account_not_found' }` → the same 404; a failed check → 500 "Could not check this business. Try again."
8. `buildFinanceHealth({ window, accountId, now }, requestLogger, { ...financeHealthDeps(), findNames: (ids) => businessProfileRepository.findAdminIdentitiesByUserIds(ids) })`. The names read stays in the route (SEC-5, `adminReadMethods`). Ids come only from ledger rows already read.
9. **One** `requestLogger.info` (SA-Q11, S1-FR-10): `{ window: { preset, from, to }, accountId, sections: { revenue, accounts, aiCost } (statuses), tiles: { k1, k3, k5 } (statuses), counts: { accounts, ledgerRows, reachedCeiling, deletedRows, unreadableAmounts, unresolvedAdjustments, topAccounts, namesFound }, coverage, durationMs }`, message "Admin read the Business OS finance page". Never a name, an email or a per-account figure.
10. `return NextResponse.json({ success: true, data: payload }, { headers: NO_STORE })`.
11. `catch` → `requestLogger.error({ err }, 'Business OS finance read failed')` → 500 `{ success: false, error: 'Internal server error', details: dev-only message }` with `NO_STORE` (AC-36).

Every `NextResponse` in the file passes through one `noStore(res)` helper (or the `NO_STORE` headers constant). The route test asserts the header on every status: 200, 400, 401, 403, 404, 500.

**Per-section settled results (SA-Q8).** The builder launches, with `settle(...)` each:

| Read | All businesses | One business |
|---|---|---|
| Plans | `pagePlans` keyset walk (`limit 500`, stop on a short page, cap 20,000, `>=`) | `findEntitlementInputs(accountId)` (existence + row) |
| Paying | R-c | R-c′ |
| Revenue existence | R-d | R-d (platform-wide by definition: it reads no account and no amount) |
| Section 3 window | R-a over `cutoverClamp(start, end).readFrom … end` (skipped when entirely before the cut-over) | `listRowsForAccountCreatedInRange` |
| K-1 current (month start → `now`) | R-a | `listRowsForAccountCreatedInRange` |
| K-1 previous span | R-a, **skipped** when the span starts before the cut-over (grey, no read needed) | `listRowsForAccountCreatedInRange`, same skip |
| Originals of adjustments whose charge is outside the read set | `findChargesByActionIds` in chunks of 200, cap 1,000 ids (`CREDIT_REPORT_LIMITS.ORIGINALS_*`); a lookup by id is checked by `resolveEffectiveFields` (account must match) | same |
| Names (after Section 3) | injected `findNames(top10Ids)` | same, one id |

R-d is platform-wide, but it reads only two head counts: no account, no amount. The AC-42 test asserts zero calls for `pagePlans`, R-a and R-c, and lists R-d as the deliberate exception (SA to confirm in the review). Section mapping: plan walk → Section 1 + K-3 + Section 3's by-group breakdown; R-c fails → Section 1 `ok` with the "Tier set" fallback group (`payingKnown: false`); R-d fails → panel and K-5 "Could not check"; the window read fails → Section 3 `unknown`; the window read hits the ceiling → `partial`; a K-1 read fails → K-1 `unavailable`; names fail → top 10 shown with "name unavailable".

---

## Pure functions and their tests

### `adminWindowPresets.ts` (SA-Q2)

`ADMIN_WINDOW_PRESETS = ['today', '7d', '30d', 'this_month'] as const`; `resolveAdminWindow(preset, now) → { from, to }` (inclusive UTC dates). `today`: today/today; `7d`: today−6/today; `30d`: today−29/today; `this_month`: the 1st/today. `inclusiveDays(from, to)`; `isRealDate(s)`; `ADMIN_WINDOW_MAX_DAYS = 92`.

Tests (`adminWindowPresets.test.ts`): `now` at 23:59:59.999Z and at 00:00:00.000Z, on a month end (Jan 31 → Feb 1), on a year end (Dec 31 → Jan 1), on Feb 29 in a leap year; `7d` and `30d` include today (7 / 30 inclusive days); **parity**: for 50 sampled instants, `resolveAdminWindow('today'|'this_month', now)` deep-equals `resolvePreset('today'|'this_month', now)` from `activityPresets.ts`; `ADMIN_WINDOW_MAX_DAYS === CREDIT_REPORT_LIMITS.MAX_WINDOW_DAYS` (imported in the test only); `inclusiveDays('2026-01-01','2026-04-02') === 92`.

### `financeUrl.ts` (L-4)

`parseFinanceUrl(params: URLSearchParams, now) → { query: { preset, from, to, accountId }, notice: string | null }`. Only `preset`, `from`, `to` and `accountId` are read; other keys are dropped. An invalid preset, date or UUID, a custom range that breaks a rule, or a repeated key gives the default (`this_month`, All businesses) **plus** a notice. `serialiseFinanceUrl(query) → string` writes `preset` always, `from` / `to` only for `custom`, and `accountId` only when set. It holds ids and enums only.

Tests: each invalid value → default + notice; an unknown key is dropped with no notice; round trip `parse(serialise(q)) === q`; a picked name never appears (the query type has no name field, and a test asserts the serialised keys ⊆ the four).

### `financeWindow.ts`

- `resolveFinanceWindow(query, now) → { preset, from, to, start: Date, end: Date }`: `windowInstants({ from, to })`, half-open, whole days.
- `k1Spans(now) → { current: { from: monthStart, to: now }, previous: { from: prevMonthStart, to: prevMonthStart + min(now − monthStart, monthStart − prevMonthStart) }, previousBeforeCutover: prevMonthStart < CHARGING_CUTOVER_FLOOR_MS }`, built with `Date.UTC` (which rolls month −1 into the previous year).

Tests: Oct 9 2026 → previous Sep 1 to Sep 9 same time, and `previousBeforeCutover: true` (true today); Nov 9 2026 → `false`; **Mar 31 10:00** → previous span clamped to the whole of February (28 days), not into March; leap year Mar 30/31 → Feb 29; **Jan 15** → previous span in December of the previous year; `now` exactly at a month start → elapsed 0, previous span empty (`from === to`, so the read is skipped and the figure is exact 0).

### `planGroups.ts` (§8.1, SA-F7, SA-Q3, SA-Q5)

```ts
export type FinanceGroupKey = 'trial' | 'founding_partner' | 'comped' | `tier:${string}` | 'unknown_held' | 'tier_set';
export function groupFor(lifecycle: LifecycleResult, isPaying: boolean | null): FinanceGroupKey
```

| `state` | `basis.kind` | Group |
|---|---|---|
| `trial` | any | `trial` |
| `champion` | any | `founding_partner` |
| `active` / `past_due` / `grace` | `tier` | `isPaying === null` → `tier_set` (R-c failed); `true` → `` `tier:${basis.tier}` ``; `false` → `comped` |
| `grace` | `cohort` | `groupFor` of `stateForCohort(basis.cohort)` as a live state (SA-W3): `trial` → Trial, `champion` → Founding Partner, otherwise `unknown_held` |
| `paused`, `unknown`, any other pair | — | `unknown_held` |

The `tier:` keys are created only for `config.tierOrder` entries and labelled from `config.matrix.presentation[tier].labels.en` (`tierMatrix.ts:243-262`). A tier in force that is not in `tierOrder` cannot occur (`deriveLifecycle` returns `unknown_tier`), and it would fall to `unknown_held` anyway. There is no `'basic'` / `'pro'` literal and no cohort-id literal.

`classifyAccounts(rows, payingIds: ReadonlySet<string> | null, window, now) → AccountsSection` makes one pass:
- `deriveLifecycle(fromPlanRow(row), lifecycleInputs(config), now)` per row;
- tally per group (all groups pre-seeded at 0: Trial, Founding Partner, Comped, one per tier, Unknown/held; `tier_set` only when `payingIds === null`);
- `byState`; `grace` / `past_due` beside their group;
- `noEndDate` = Founding Partner group ∧ `isOpenEndedCohort(row)`; `dormant` = `isDormantChampion(row)`;
- new in window by `origin` (`created_at ∈ [start, end)`; the `backfill` origin is labelled "backfilled" by the copy, not by a literal comparison: the origin value is shown as given);
- ending in the next 30 days: `tier_expires_at` / `cohort_expires_at` / the `trial.endsAt` from the lifecycle result, in `[now, now + 30d)`.

It returns `total` = rows classified.

Tests (`planGroups.test.ts`), with the real config and an injected `now`:
- **AC-12.** A table-driven test over **every** `LifecycleState` × every basis kind (a hand-built `LifecycleResult` for each pair, including impossible ones) asserts that exactly one group is returned and that it is in the seeded set. Plus a classified fixture of 12 rows covering trial, champion open-ended, champion dated, champion lapsed into grace (cohort basis), tier in force paying, tier in force not paying (Comped), tier + cohort (tier wins), expired tier in grace (basis tier), `past_due`, an unknown cohort and an unknown tier. The sum of the groups equals `total`.
- `payingIds === null` → the `tier_set` group appears and Comped / tier counts are 0.
- `noEndDate` and `dormant` agree with `report.ts`'s own output: the same fixture is run through `buildShadowReport`'s static section via its injectable `planRepository`, and the test asserts `noEndDateAccountCount` for the champion cohort and the dormant count are equal. That gives one definition, two callers.
- An empty input → every group 0, total 0 (AC-6).

### `aiCost.ts`

`summariseAiCost({ rows, reachedCeiling, originals, groupOf }) → AiCostFigures`:
- **total**: every row (charges and adjustments, net): `costUnits += toUnits(cost_usd, COST_SCALE)`, `creditUnits += toUnits(credits, CREDIT_SCALE)`. `charges` = rows with `kind === 'charge'`. An unreadable amount → counted in `unreadableAmounts`, contributes 0;
- **deleted**: rows with `user_id === null`, split in Node from the same rows (cost, credits, count);
- **byTrigger**: `resolveEffectiveFields(row, chargesByActionId)` with the map built from the window's charge rows + `originals`; `effectiveTrigger` owner / scheduled / external / null → "unattributed" (resolved false);
- **byGroup**: `groupOf(user_id)` (from Section 1's classification; `null` when the plan walk failed → the breakdown is `unknown`); a ledger account with no plan row → `unknown_held`; deleted → its own line;
- **topAccounts**: the top 10 by cost units, descending, ties by `user_id` ascending, deleted excluded;
- `exact = !reachedCeiling`;
- `toUsd` / `toCredits` = units ÷ scale, once.

Tests: three rows summing $0.1 + $0.2 → exactly 0.3 (not 0.30000000000000004); an adjustment placed under its charge's trigger; an adjustment whose original is in `originals`; one whose original belongs to another account → unattributed; a deleted row counted in the total **and** in its own bucket, never in the top 10; a ceiling-reached input → `exact: false`; no rows → zeros, `exact: true`; an unreadable `cost_usd` counted; 11 accounts → 10 returned with the correct tie-break.

### `financeRules.ts` (SA-Q1, SA-Q12, BD-11)

```ts
export type FinanceMetric = 'aiCostMonth' | 'aiCostPrevSpan' | 'foundingNoEndDate';
export type FinanceTileId = 'k1_ai_cost' | 'k3_founding_no_end_date' | 'k5_our_revenue';
export const FINANCE_TILE_VOCABULARY: Record<FinanceTileId, { metrics: readonly FinanceMetric[]; flags: readonly never[] }>;
export const FINANCE_RULES: { k1_ai_cost: readonly FinanceRule[]; k3_founding_no_end_date: readonly FinanceRule[]; k5_our_revenue: readonly FinanceRule[] } = {
  k1_ai_cost: [
    { id: 'aiCost.doubled', priority: 1, colour: 'red',   description: 'AI cost at least doubled vs the same days last month',
      condition: { kind: 'ratioAtLeast', metric: 'aiCostMonth', baseline: 'aiCostPrevSpan', factor: 2,   floor: 1 } },
    { id: 'aiCost.up50',    priority: 2, colour: 'amber', description: 'AI cost up 50% or more vs the same days last month',
      condition: { kind: 'ratioAtLeast', metric: 'aiCostMonth', baseline: 'aiCostPrevSpan', factor: 1.5, floor: 1 } },
  ],
  k3_founding_no_end_date: [
    { id: 'founding.noEndDate', priority: 1, colour: 'amber', description: 'Founding Partners with no end date',
      condition: { kind: 'atLeast', metric: 'foundingNoEndDate', value: 1 } },
  ],
  k5_our_revenue: [],
};
export const FINANCE_GREEN_ELIGIBLE: ReadonlySet<FinanceTileId> = new Set(['k1_ai_cost', 'k3_founding_no_end_date']);
```

`FinanceRule` = `{ id; priority; colour: 'red' | 'amber'; description; condition: HealthCondition<FinanceMetric, never> }`, its own interface: Health's `HealthRule` stays closed. `colourFinanceTile(id, rules, measurement)` returns a `FinanceTile` with `status: TileStatus` (type-only import from `healthTypes.ts`):
1. `validateRuleListAgainst(id, rules, FINANCE_TILE_VOCABULARY[id])` fails → `unavailable`, and the problem is reported to the builder's logger at `error`.
2. `measurement === null` (read failed) → `unavailable` "Unknown".
3. `measurement.notEnoughHistory` (K-1 cut-over, code not data) → `not_measured` "Not enough history".
4. `firstMatchingRule(rules, metrics, {})` → that rule's colour + description.
5. No match and any metric inexact → **amber** "Total is a minimum; not all charges counted" (C-18 for every finance tile whose figures can be a lower bound: K-1 and K-3; finance's own headline constant).
6. No match, exact, in `FINANCE_GREEN_ELIGIBLE` → green "All clear".
7. Otherwise (K-5) → `neutral` with its information headline ("None yet" / "Revenue recorded, not yet shown"); a K-5 check failure → `unavailable` "Could not check".

Tests (`financeRules.test.ts`), the **AC-18** set with an injected measurement: previous $10, current $15 → amber; $20 → red; $14.99 → green; current $0.99 with previous $0.10 → no rule (floor) → green; the cut-over flag → `not_measured`; current inexact (or previous inexact) → amber minimum, never green; previous $0 exact, current $1.50 → red (SA-W5); both $0 → green. **AC-20**: a copy of the rules with amber `factor: 1.2` turns $12 / $10 from green to amber, with no code change. K-3: 0 exact → green; 2 → amber; 0 inexact → amber minimum; null → unavailable. K-5: three branches. Validation: a rule naming `spend24h` on a finance tile → `unavailable` (vocabulary enforced); `FINANCE_RULES` passes validation.

The Health widening is proven by the Health suites passing **unchanged** plus these finance tests (they call the widened generics with non-Health ids).

---

## The page

- `app/admin/finance/page.tsx` (server component, no data): `<Suspense fallback={null}><FinanceView /></Suspense>` (L-4(2)). It sits under `app/admin/layout.tsx`, so `requireAdminPage` runs before any of it renders (SEC-2, AC-3). There is no `route.ts` under `app/admin/**`.
- `FinanceView` (client): `useSearchParams()` → `parseFinanceUrl` → the query plus an optional notice. A filter change → `router.replace('/admin/finance?' + serialiseFinanceUrl(q), { scroll: false })` (L-4(3)); the URL is the state, so a reload reproduces the view (AC-24). It fetches `GET /api/admin/business-os/finance?<same query>` through `useFinanceData`. The title is "Finance & business health", with the purpose line from S1-FR-1.
- Order (S1-FR-5): KPI strip (K-1, K-3, K-5) → Revenue panel → Section 1 → Section 3. No Section 2, 4, 5 or 6 heading.
- Every tile: label, value, `STATUS_STYLES[status].label` text **and** colour, and the reason line when red or amber (AC-21). K-1's label is "This month vs last month, UTC" (S1-FR-4).
- Every section: heading, subtitle with source + window ("UTC"), a status badge (`ok` / "At least" when `partial` / "Could not load this section" + Retry when `unknown`) (L-5, S1-FR-6). Retry refetches the whole route; one route serves all the sections (SA-Q8).
- Section 1 subtitle says whether it is narrowed ("All businesses, now" / "This business, now") (SA-W1). Tables use `components/ui` primitives with header cells.
- Section 3: total USD (labelled USD, AC-14), credits, charged actions, by trigger, by current plan group (with the BD-8 note "by the plan each account is on now"), top 10 with business name, deleted bucket, "No AI actions charged in this window" when 0 rows (AC-7), "At least USD X" when partial (AC-15), `CutoverNotice` (AC-40), and a link to `/admin/analytics` "AI cost & usage" (S1-FR-20).
- Revenue panel: three branches of S1-FR-25/26 copy; never a `$0` and never a chart.
- Logging on the client: `createLogger({ module: 'AdminFinancePage' })` (the picker's precedent), fetch failure only, with no query values.

---

## SA-Q1 to SA-Q12: implementation notes

| Ruling | One line |
|---|---|
| SA-Q1 | `HealthCondition` / `matchCondition` / `firstMatchingRule` widened to `string` bounds with Health defaults. Finance has its own rule data, vocabulary, `FINANCE_GREEN_ELIGIBLE` and `colourFinanceTile`; validation goes through the extracted `validateRuleListAgainst` (SA-W4); no new condition kind |
| SA-Q2 | Sibling `app/admin/components/adminWindowPresets.ts` with a parity test against `activityPresets.ts` (`today`, `this_month`); `7d` / `30d` include today; the server re-resolves the preset with its own clock; L-4 meets all six conditions |
| SA-Q3 | Own keyset `pagePlans` walk (500 / 20,000, `>=`); `deriveLifecycle(fromPlanRow(row), lifecycleInputs(config), now)`; `report.ts` exports `lifecycleInputs`, `isOpenEndedCohort` and `isDormantChampion`; `buildShadowReport` is never called; `report.test.ts` / `dormantChampions.test.ts` are untouched |
| SA-Q4 | No `token_usage` read; a link to `/admin/analytics`; a source guard pins it (AC-29) |
| SA-Q5 | `PAYING_SUBSCRIPTION_STATUSES = ['active', 'past_due']` + `ended_at` NULL + `livemode = true` (in the R-c query) in `lib/business-os/billing/payingSubscriptionStatuses.ts`; not derived from `LIVE_SUBSCRIPTION_STATUSES` / `R3_LIVE_STATUSES`; the guard consequences are in SA-W2; "Tier set" only when R-c (or R-c′) fails |
| SA-Q6 | R-a `listRowsOfAllAccountsCreatedInRange`: charges + adjustments, half-open, paged, de-duplicated, NULL `user_id` included, ceiling 20,000 `>=`; one business → `listRowsForAccountCreatedInRange`; `listChargesAllAccountsInWindow` is never named (source guard) |
| SA-Q7 | 1b. `adminCreditPercent.ts` is not touched in 1a |
| SA-Q8 | One route; every read `settle`d; per-section `status`; a failure is never a 500; 500 only on an unexpected throw |
| SA-Q9 | Slice 2. No layer-B read; a source guard lists `payment_transactions`, `payment_refunds`, `payment_plan_*` as forbidden in 1a files |
| SA-Q10 | 1b. No lot repository read in 1a |
| SA-Q11 | No audit entry; one `info` line with `adminId`, `correlationId`, filters (account id), statuses, counts and timing |
| SA-Q12 | Span = same elapsed span of the previous month, clamped, injected `now`; `floor` $1.00 on the current figure (data); grey "Not enough history" only when the previous span starts before `CHARGING_CUTOVER_FLOOR_MS` (code), so no previous read is made then; C-2 / C-18 unchanged |

---

## Guard table §12.2, line by line

| Guard | What it checks | 1a trips it? | Exact change |
|---|---|---|---|
| `enforcementPoints.test.ts` | Every file outside the module that imports from it is a registered gate or non-gate, with **exactly** its imported symbols | **Yes**: `planGroups.ts` | Add to `KNOWN_NON_GATE_IMPORTERS`: `{ file: 'lib/business-os/finance/planGroups.ts', symbols: [the exact list at code time; planned: 'deriveLifecycle', 'fromPlanRow', 'getEntitlementConfig', 'isDormantChampion', 'isOpenEndedCohort', 'lifecycleInputs', 'stateForCohort', 'LifecycleResult', 'LifecycleState'], why: 'Finance & business health slice 1a: classifies each plan row into the admin page's six display groups with the lifecycle derivation and the shadow report's own predicates, for DISPLAY only. It never calls check() / decide() and refuses nothing. If it ever does, it is a gate and belongs in ENFORCEMENT_POINTS.' }`. No other finance file imports from the module (a finance source guard asserts it). `adminCreditPercent.ts`'s entry stays the same |
| `businessOsEntitlements.imports.guard.test.ts` (RC-15) | Only `ALLOWED` files name the plan or shadow repository (the path counts); non-repository readers must be in `NO_STATE_WRITE_REFERRERS`; wiring files are pinned to their methods | **Yes** | `ALLOWED` + `NO_STATE_WRITE_REFERRERS`: `lib/business-os/finance/financeHealthDeps.ts` (singleton), `lib/business-os/finance/financeHealth.ts` (`Pick<…, 'pagePlans' \| 'findEntitlementInputs'>` type), `lib/business-os/finance/planGroups.ts` (`BusinessOsAccountPlan` type). `ALLOWED` only (category "test"): `lib/business-os/finance/__tests__/planGroups.test.ts`, `financeHealth.test.ts` and `app/api/admin/business-os/finance/__tests__/route.test.ts`, if they name it. New pin test: `FINANCE_WIRING = 'lib/business-os/finance/financeHealthDeps.ts'`, calls on `businessOsAccountPlanRepository` equal `['pagePlans', 'findEntitlementInputs']` (or `['pagePlans']` if SA rejects SA-W1), with a planted negative control |
| `BusinessOsCreditLedgerReadRepository.test.ts` caller list (`:937-976`) | Exact list of files whose text names the repository | **Yes** | Add `lib/business-os/finance/financeHealth.ts` (types via `Pick<>`), `lib/business-os/finance/financeHealthDeps.ts` (calls R-a, `listRowsForAccountCreatedInRange`, `findChargesByActionIds`), `lib/business-os/finance/aiCost.ts` (the `CreditLedgerRow` type), each with a comment; rename the `it(...)` title to include the finance page. Repository header caller paragraph amended (`:17-38`) and R-a added to "ALL ACCOUNTS" (`:41-61`) |
| `serviceColumn.guard.test.ts` (N-10) | No filter, order or group on raw `service` in the scanned files | **Yes** (the scan must reach the new files) | `files` += `...sourceFiles('lib/business-os/finance')`, `'app/api/admin/business-os/finance/route.ts'`, `...sourceFiles('app/admin/finance')`; the `arrayContaining` pin names `lib/business-os/finance/aiCost.ts`, `financeHealth.ts`, `financeHealthDeps.ts` and the route, so moving them turns it red. Grouping only via `resolveEffectiveFields` |
| G3 in `creditLots.test.ts` | Who names the lot repository / `extraCreditsAt` | **No** (1b) | None |
| `BusinessOsCreditLotRepository.test.ts` | R-b | **No** (1b) | None |
| `creditFigures.fromConfig.guard.test.ts` | Who names `creditAllowanceForDisplay`; bare `2000` | **No** (1b; no 1a file names it). Budgets / caps are written `20_000` and `2 * 1000` style only where needed | None |
| `tierLiteral.forbidden.test.ts` | No `'basic'` / `'pro'` / `'growth'` / `TIER_ORDER` literal in `app`, `lib`, `components`, `hooks` | Could trip; must not | Tier keys built from `config.tierOrder` only; tests build tier fixtures from `config.tierOrder[0]` (tests are scanned by the literal guard too, so no literal in tests either) |
| Admin authz surface guard (`npm run test:authz-guard`) | Every `app/api/admin/**` handler calls `requireAdmin`; no `route.ts` under `app/admin/**`; layout gate | New route + page | `requireAdmin(baseLogger)` first in `GET`; written as `export async function GET(request: NextRequest)` (the traceable form); no allow-list entry; the page has no `route.ts` |
| `AdminSidebar.nav.test.ts` | Section order; every page listed once; counts | **Yes** | Monitor `toEqual(['/admin', '/admin/finance', '/admin/analytics', '/admin/jobs-queues', '/admin/audit-trail', '/admin/archiving'])`; `toHaveLength(28)`; on-disk floor 29 + `toContain('/admin/finance')`; comments |
| Health tests (`lib/admin/health/__tests__`, 5 suites) | Behaviour | Must pass **unchanged** | No edit to any Health test file |
| New finance repository tests | Columns, `livemode`, head count, no-write pin | New | `BusinessOsFinanceReadRepository.test.ts` (above) |
| **Not in §12.2. `BusinessOsBillingAccountRepository.test.ts:481-540`** (exact caller list, text match) | The constant file imports the status type from that repository's path | **Yes under SA-W2 A** | Add `lib/business-os/billing/payingSubscriptionStatuses.ts` with the comment "Finance & business health 1a (SA-Q5): imports the subscription status TYPE only. Not a caller." The finance repository's header must not name the class (it would trip this list) |
| **Not in §12.2. `routerPlacement.guard.test.ts:617-637`** (P-2a M-1) | A `lib/business-os/billing/*.ts` file imports no repository (type-only included) and contains neither "supabase" nor `.from(` | **Yes under SA-W2 A** | `BILLING_REPOSITORY_CALLERS` += `'payingSubscriptionStatuses.ts'` with a "type-only, no DB access" comment (the loop at `:633-636` then asserts its only repository import is the billing-account repository, which is true). The file must not contain the word "supabase", even in a comment |
| `adminReadMethods.guard.test.ts` | Admin identity reads only from `app/api/admin/**` | No (the route calls it and the builder receives it injected) | None |
| `BusinessOsBillingEventRepository.test.ts` / boost repository pins | Text names those repositories | No (the finance repository names tables, not classes) | None; a finance repository source test asserts it |
| `accountSeam.guard`, L8, BD-26, `businessOwnedTables`, purge descriptors | — | No | None |

---

## AC mapping

T-numbers: T1 `BusinessOsFinanceReadRepository.test.ts`, T2 `BusinessOsCreditLedgerReadRepository.test.ts` (R-a block), T3 `adminWindowPresets.test.ts`, T4 `financeUrl.test.ts`, T5 `payingSubscriptionStatuses.test.ts`, T6 `planGroups.test.ts`, T7 `aiCost.test.ts`, T8 `financeWindow.test.ts`, T9 `financeRules.test.ts`, T10 `financeHealth.test.ts`, T11 `finance.source.guard.test.ts`, T12 `route.test.ts`, T13 `financePage.render.test.tsx`, T14 `app/admin/finance/__tests__/source.guard.test.ts`. QA = recorded manual step in the QA report.

| AC | Test / check |
|---|---|
| AC-1 | T12 "401 when signed out, no data, no-store" |
| AC-2 | T12 "403 for a signed-in non-admin" (the gate mock returns 403; the `profiles.role` case is `requireAdmin`'s own suite, `lib/admin/__tests__/requireAdminRoute.test.ts`, re-run); `npm run test:authz-guard` |
| AC-3 | Existing `lib/admin/__tests__/requireAdminPage.test.ts` + T14 "page lives under the guarded layout, no route.ts in app/admin" + QA: non-admin browser session to `/admin/finance` is redirected |
| AC-4 | T12 `it.each`: unknown preset; custom without dates; `to` before `from`; 93 days; malformed `accountId`; unknown key → 400, standard body, `details` undefined when `NODE_ENV !== 'development'` |
| AC-5 | T12 "404 Business not found for a well-formed id with no plan row" and "404 for a platform account id, before any read" |
| AC-6 | T6 "no plan rows → six groups at 0, Total 0"; T10 "empty walk → K-3 green 0, not red/amber" |
| AC-7 | T7 "no rows → zeros exact"; T10 "no ledger rows → Section 3 ok, zero"; T13 "No AI actions charged in this window" + "USD 0.00"; T9 floor case; T9 cut-over grey |
| AC-9 | QA: SQL check 1 run at test time vs Section 1 + K-3 (`no_cohort_end_date` for the champion cohort) |
| AC-10 | QA: SQL check 2 (and 3 for the top 10) vs "This month" Section 3; T7 pins the sum method |
| AC-12 | T6 table test over every `LifecycleState` × basis + 12-row fixture sum = Total |
| AC-14 | T13 "AI cost labelled USD"; T11 "no layer-B table named in any 1a file" |
| AC-15 | T2 "R-a ceiling → reachedCeiling (>=)"; T10 "ceiling → Section 3 partial, at least"; T13 "At least USD"; T9 inexact → amber minimum, never green |
| AC-18 | T9 (the full set, incl. floor, cut-over grey, inexact) + T8 (31st clamp, year boundary) |
| AC-20 | T9 "threshold change in data changes colour" |
| AC-21 | T13 "every tile shows STATUS_STYLES text label" |
| AC-22 | T10 "R-d zeros → panel none_yet, K-5 neutral"; T13 "None yet copy, no `$0`, no chart" |
| AC-23 | T10 "R-d planInvoicesPaid 1 → recorded"; T1 "R-d filters livemode = true" (test rows cannot count) |
| AC-24 | T4 (parse / serialise, invalid → default + notice, unknown key dropped, no name); T14 "router.replace with scroll false, not push; useSearchParams inside Suspense"; QA reload of a shared URL |
| AC-25 | T3 (UTC edges, parity); T12 "preset 7d with client from/to → window resolved by the server clock" |
| AC-26 | T10 "accountId → Section 3 and K-1 reads go through listRowsForAccountCreatedInRange with exactly that id" |
| AC-27 | T10 "a rejected read → that section unknown, others ok"; T12 "200 with section status unknown"; T13 "Could not load this section + Retry, others render" |
| AC-28 | T11 + T1 no-write pins; T12 source "route names no write verb"; reviewer + QA: `git diff --stat` shows no `supabase/migrations` file |
| AC-29 | T11 "no `select('sum`, no aggregate, no `token_usage` in any 1a file" |
| AC-30 | T12 "one info line with correlationId and adminId; no name, email or per-account figure" (logger mock capture); T11/T14 no `console.` |
| AC-31 | `npm run test:bos-entitlements`, `npm run test:authz-guard`, Health suites, nav test, all pasted |
| AC-32 | QA manual critical path (1a clause) |
| AC-33 | T12 "repeated key → 400 before Zod" (the parse spy is not called) |
| AC-34 | T12 "`to` tomorrow → 400"; "92 inclusive days → 200"; "93 → 400" |
| AC-35 | T12 every status (200, 400, 401, 403, 404, 500) has `Cache-Control: no-store` |
| AC-36 | T12 "builder throws → 500 standard; details only in development" |
| AC-37 | T10 "plan walk fails → Section 1 unknown, K-3 unavailable, Section 3 total ok with byGroup unknown"; "walk hits 20,000 → Section 1 partial, at least" |
| AC-39 | T10 "R-d fails → panel unknown, K-5 unavailable 'Could not check'" |
| AC-40 | T10 "window starts before cut-over → coverage starts_before; entirely before → no read, coverage entirely_before"; T13 notice shown instead of `$0` |
| AC-41 | T10 "accountId of an open-ended Founding Partner → K-3 metric 1; dated → 0" |
| AC-42 | T10 (repository-level spies): with `accountId`, `pagePlans`, R-a and R-c have 0 calls; `findEntitlementInputs`, R-c′, `listRowsForAccountCreatedInRange` receive exactly the validated id; R-d is the documented platform-wide exception; T12 same through the route |
| AC-44 | Scoped `tsc` with canary (below), output pasted |

---

## Verification plan

**node_modules.** The worktree has none (checked). Before the first test run:

```bash
cmd //c mklink /J "C:\Users\Barak\My Projects\AgentsPilot\neuronforge-finance-health\node_modules" "C:\Users\Barak\My Projects\AgentsPilot\neuronforge\node_modules"
```

⚠️ **The junction must be unlinked with `cmd //c rmdir "<worktree>\node_modules"` before any `git worktree remove`**, or `--force` deletes the shared packages. It is recorded here and in the hand-over. Drift: the main checkout is at `89dbc568`, and `88f97171` adds one dependency (`lib-address`), which none of these suites imports. If a suite fails on a missing module, stop and report rather than run `npm install` through the junction.

Before SA code review, Dev runs these and pastes each output (command, exit code, counts) into this workplan:

| # | Command | Evidence |
|---|---|---|
| V-1 | `npx jest lib/business-os/finance app/admin/finance app/admin/components app/api/admin/business-os/finance lib/repositories/__tests__/BusinessOsFinanceReadRepository.test.ts lib/repositories/__tests__/BusinessOsCreditLedgerReadRepository.test.ts lib/business-os/billing/__tests__/payingSubscriptionStatuses.test.ts --ci` | Suites / tests passed |
| V-2 | `npx jest lib/admin/health --ci` | The 5 Health suites pass with **no** Health test file in the diff |
| V-3 | `npx jest lib/business-os/entitlements/__tests__/report.test.ts lib/business-os/entitlements/__tests__/dormantChampions.test.ts --ci` | Unchanged suites pass |
| V-4 | `npm run test:bos-entitlements` | Exit 0 (includes enforcementPoints, RC-15, tier literal, the ledger and finance repository tests, serviceColumn) |
| V-5 | `npm run test:authz-guard` | Exit 0 |
| V-6 | `npx jest app/admin/components/__tests__/AdminSidebar.nav.test.ts app/api/stripe/webhook/__tests__/routerPlacement.guard.test.ts lib/repositories/__tests__/BusinessOsBillingAccountRepository.test.ts lib/repositories/__tests__/adminReadMethods.guard.test.ts --ci` | Exit 0 |
| V-7 | `npm run lint:hooks` | Exit 0 |
| V-8 | `npx eslint <every touched file>` | Clean |
| V-9 | `npm run typecheck:bos-llm` | No new errors (the finance builder imports scoped `credits/` and `entitlements/` modules, so it is in this gate's scope) |
| V-10 | **Scoped `tsc` with a canary (AC-44)**, below | Output pasted |
| V-11 | `git diff --stat` before reading the diff | No deletion-only file; no `supabase/migrations` path |

**V-10 procedure.** Do **not** use `npx tsc --noEmit -p tsconfig.json`: it OOMs and prints nothing, which reads as clean.
1. Write `tsconfig.finance-1a.json` in the scratchpad dir, or at the worktree root and never staged: `{ "extends": "./tsconfig.json", "compilerOptions": { "noEmit": true, "incremental": false }, "include": ["next-env.d.ts", "types/**/*.d.ts", <every touched and new .ts/.tsx file>] }`.
2. Plant a canary in `lib/business-os/finance/financeRules.ts`: `const __canary: number = 'x';`.
3. `NODE_OPTIONS=--max-old-space-size=8192 npx tsc -p tsconfig.finance-1a.json > tsc.out 2>&1; echo "exit=$?"`. It **must** exit non-zero with `TS2322` at the canary line. If it does not, the run is not evidence: stop.
4. Remove the canary, re-run, and record the exit code and every diagnostic. Zero diagnostics in touched files; pre-existing diagnostics in files pulled in transitively are listed and attributed, not fixed.
5. Delete the temporary tsconfig and `tsc.out`.

---

## Logging

- Server: `createLogger({ module: 'AdminBosFinanceAPI' })` in the route, `createLogger({ module: 'BosFinanceHealth' })` passed as the builder's logger (child of the request logger), and `createLogger({ service: 'BusinessOsFinanceReadRepository' })`. The client uses `createLogger({ module: 'AdminFinancePage' })` (client-safe, the picker's precedent).
- Errors are always `{ err }`; per-read failures are logged once, by the builder, with `{ read, err }` at `error` (guard refusals at `warn`).
- Never logged: business names, emails, search text, per-account cost or credits, or the URL query string from the client.
- `console.*`: none in any new file (T11 / T14 pin it). Files touched that already use `console.*`: **none** (counted above: all 0), so the CLAUDE.md flag-and-convert rule has nothing to convert.

---

## Risks

| # | Risk | Mitigation |
|---|---|---|
| R-1 | SA-W1 changes Section 1's behaviour with a business picked, compared with L-3's wording | Raised before code; the alternative (Section 1 stays platform-wide and R-c is called) is a 1-line change in the builder, but it breaks AC-42 as written |
| R-2 | The SA-W2 guard edits touch money-module guards | List additions only, each with a "type only, not a caller" comment; option B avoids them |
| R-3 | Widening Health generics breaks inference at Health call sites | Type-only; V-2 with no Health test edited, plus V-10 over `evaluateHealth.ts`, `rules.ts` and the Health route |
| R-4 | The `report.ts` refactor (inline conditions → predicates) shifts a shadow report number | `report.test.ts` and `dormantChampions.test.ts` are not edited and must pass; the predicates are a verbatim move of `:497` and `:507` |
| R-5 | Keyset over `user_id` on billing accounts with NULLs | `.not('user_id', 'is', null)` in the query; T1 pins it |
| R-6 | Offset paging on R-a re-reads a row when one is inserted mid-read | De-duplication by id (the existing shape); a row cannot be skipped, because new rows land on the first page (`created_at DESC`) |
| R-7 | `{ count: 'exact', head: true }` returns `count: null` on some errors | `null` count → treated as an error ("Could not check"), never as 0 (T1) |
| R-8 | The node_modules junction removes shared packages on `git worktree remove --force` | Unlink step recorded (Verification plan); never `--force` with the junction present |
| R-9 | p95 over 1 s for one section (SA-Q8 split trigger) | Today's volumes: 8 plan rows, 265 ledger rows, 0 billing rows. The route logs `durationMs`; QA records it |
| R-10 | The tier literal guard scans tests too | Fixtures use `config.tierOrder[i]`, never a literal |

---

## Estimate

About **3.5 to 4 days**, within the 3 to 4 day target. If SA-W1 or SA-W2 is ruled the other way, the estimate does not change.

| Day | Work |
|---|---|
| 1 | R-a + tests; finance repository + tests; paying constant + guards; preset module + URL module + tests; Health widening; `report.ts` / `lifecycle.ts` exports |
| 2 | `financeWindow`, `planGroups`, `aiCost`, `financeRules` + tests; the orchestrator + wiring + tests; guard list edits |
| 3 | Route + integration tests; page, components, hook; render + source tests |
| 3.5 to 4 | Verification V-1 to V-11, the scoped `tsc` with canary, fixes; results pasted; requirement §0.1 updated |

---

## Task List

- ✅ 0. SA workplan review (APPROVED WITH CONDITIONS); branch `feature/bos-finance-health-1a` cut by RM; confirmed with `git branch --show-current`
- ✅ 1. node_modules junction to the main checkout (`mklink /J`); `/node_modules` is in `.gitignore`, not shown by `git status`. Unlink with `cmd //c rmdir` before any `git worktree remove`
- ✅ 2. R-a `listRowsOfAllAccountsCreatedInRange` + header + tests + caller list
- ✅ 3. `BusinessOsFinanceReadRepository` (R-c, R-c′, R-d) + index export + tests
- ✅ 4. `payingSubscriptionStatuses.ts` + test, **option B** (SA-WR-2): literal, no import, CHECK-list test; no guard file edited
- ✅ 5. Health widening (`rules.ts`, `evaluateHealth.ts`, `validateRuleListAgainst`); V-2 green, no Health test edited
- ✅ 6. `report.ts` exports + `lifecycle.ts` `stateForCohort` export; V-3 green
- ✅ 7. `adminWindowPresets.ts` + tests (parity)
- ✅ 8. `financeUrl.ts` + tests
- ✅ 9. `financeTypes.ts`, `financeWindow.ts` + tests
- ✅ 10. `planGroups.ts` + tests (config as a parameter, SA-WR-4); `KNOWN_NON_GATE_IMPORTERS` entry
- ✅ 11. `aiCost.ts` + tests (platform account flagged, SA-WR-5)
- ✅ 12. `financeRules.ts` + tests
- ✅ 13. `financeHealth.ts` + `financeHealthDeps.ts` + tests (override strip, SA-WR-1; AC-42 spies, SA-WR-3); RC-15 `ALLOWED` / `NO_STATE_WRITE_REFERRERS` / `FINANCE_WIRING` pin; serviceColumn scan list
- ✅ 14. `finance.source.guard.test.ts`
- ✅ 15. Route + integration test (real `requireAdmin`, `profiles.role` 403 case, SA-WR-6)
- ✅ 16. Sidebar entry + nav test
- ✅ 17. Page, `FinanceView`, filter bar, KPI strip, section frame, revenue panel, Section 1, Section 3, copy, hook
- ✅ 18. Render test + page source guard
- ✅ 19. Verification V-1 to V-11, outputs below (§ Implementation Notes)
- ⬜ 20. Requirement §0.1 and Change History: **not done by Dev** (the BA is editing the requirement in parallel; Dev was told not to touch it). Hand-over to SA code review, uncommitted

---

## Implementation Notes

Dev, 2026-10-09, on `feature/bos-finance-health-1a`. Nothing committed.

### SA conditions applied

| Condition | Where |
|---|---|
| SA-WR-1 | `financeHealthDeps.ts` `findPlanWithoutOverrides` maps `findEntitlementInputs` to `{ plan }`; the builder's dep type is `(accountId) => Promise<{ data: { plan } \| null; error }>`. `financeHealth.test.ts` › "SA-WR-1": an override with a `reason` never appears in the wiring result, the payload, the builder's log calls or the repository logger |
| SA-WR-2 | Option B. `payingSubscriptionStatuses.ts` has no import and no "supabase"; its test extracts the `business_os_billing_accounts_status_known` CHECK list from the migration (with a non-vacuity check). `routerPlacement.guard.test.ts` and `BusinessOsBillingAccountRepository.test.ts` are **unchanged** and pass (V-6) |
| SA-WR-3 | `financeHealth.test.ts` › "one business picked": spies on `findPlanForAccount`, R-c′, `listRowsForAccountCreatedInRange` (3 calls, all the id) and `findChargesByActionIds` (ids from rows read); zero calls on `pagePlans`, R-a, R-c; `countLiveRevenueRows` called with no argument; the names lookup gets only `[A]`. Repeated through the route in `route.test.ts` |
| SA-WR-4 | `classifyAccounts({ …, config })`; the wiring passes `getEntitlementConfig()` |
| SA-WR-5 | `summariseAiCost` marks `isPlatform`; the builder sets `nameStatus: 'platform'` and does not look the id up; the page shows "Platform account". Tested in T7, T10, T13 |
| SA-WR-6 | `route.test.ts` › "SA-WR-6": the real `requireAdmin`, `AdminAccessService.isAdmin` mocked false, the user carrying `role: 'admin'` in `app_metadata`, `user_metadata` and a mocked `UserProfileRepository` profile → 403, no read, and the profile is never consulted |
| SA-WR-7 | Scratch tsconfig in the session scratchpad with an absolute `extends`, deleted after the run |

### Deviations from the workplan (and why)

1. **`financeHealthDeps.ts` is a second non-gate importer** (`getEntitlementConfig` only). SA-WR-4 moves the config read into the wiring, which therefore imports from the module; registered in `KNOWN_NON_GATE_IMPORTERS` with its own `why`. The finance source guard pins "only `planGroups.ts` and the wiring" and the wiring's single symbol.
2. **`page.tsx` is `'use client'`**, not a server component. The admin authz surface guard's R8 (OI-21) fails any server-rendered `/admin` render entry that does not call `requireAdminPage()` itself. Client + Suspense is the audit-trail page's shape. The page source guard pins it.
3. **No `components/ui` table primitive exists**, and `Card` is a white light-theme box. Tables are native `<table>` with `<th scope>` header cells in the admin's slate styling, with `cn()`, as the Health and Activity screens do.
4. **One extra small file**, `app/admin/finance/financeFormat.ts` (USD / count / "At least" formatting), shared by four components.
5. **The backfill label** comes from a copy map (`ORIGIN_NOTES` in `financeCopy.ts`), not a literal comparison.
6. **The RC-15 pin compares sorted** (`['findEntitlementInputs', 'pagePlans']`): the wiring's source order is the reverse of the workplan's list.
7. **The account check runs before the other reads** (one extra round trip with a business picked), so nothing else is read for an id with no plan row.
8. The builder receives the request logger directly (no extra `BosFinanceHealth` child); read failures log `{ read, err }`.

### Files touched that use `console.*`

None. Every modified file has 0. The only matches in new files are the `/\bconsole\./` regexes inside the two source-guard tests.

### Verification results (2026-10-09)

| # | Command | Result |
|---|---|---|
| V-1 | `npx jest lib/business-os/finance app/admin/finance app/admin/components app/api/admin/business-os/finance lib/repositories/__tests__/BusinessOsFinanceReadRepository.test.ts lib/repositories/__tests__/BusinessOsCreditLedgerReadRepository.test.ts lib/business-os/billing/__tests__/payingSubscriptionStatuses.test.ts --ci` | exit 0; 17 suites, 604 tests passed |
| V-2 | `npx jest lib/admin/health --ci` | exit 0; 5 suites, 249 tests passed; `git status -- lib/admin/health/__tests__` empty (no Health test edited) |
| V-3 | `npx jest …/report.test.ts …/dormantChampions.test.ts …/lifecycle.test.ts --ci` | exit 0; 3 suites, 75 tests passed (unchanged files) |
| V-4 | `npm run test:bos-entitlements` | exit 0; 216 suites, 5,837 tests passed |
| V-5 | `npm run test:authz-guard` | exit 0; 2 suites, 203 tests (the first run failed R8 on a server `page.tsx`; see deviation 2) |
| V-6 | `npx jest AdminSidebar.nav routerPlacement.guard BusinessOsBillingAccountRepository adminReadMethods.guard app/admin/finance app/api/admin/health-summary --ci` | exit 0; 9 suites, 216 tests; the two billing guards unchanged |
| V-7 | `npm run lint:hooks` | exit 0 |
| V-8 | `npx eslint <48 changed and new .ts/.tsx files>` | exit 0; 48 files, 0 errors, 0 warnings |
| V-9 | `npm run typecheck:bos-llm` | exit 0; 483 files in scope, 28 errors, **0 new**. A first run found 24 new errors in the fake typing of `financeHealth.test.ts`; fixed. It also reports one pre-existing baseline entry as fixed (`app/api/onboarding/build/route.ts`), not touched here |
| V-10 | scoped `tsc` with canary | Canary run: exit 2, `lib/business-os/finance/financeRules.ts(161,7): error TS2322: Type 'string' is not assignable to type 'number'.` Canary removed, re-run: exit 2 with **0 diagnostics in touched or new files**. 3 pre-existing diagnostics in files pulled in through `lib/repositories/index.ts`, none in the diff: `lib/pilot/insight/MemoryManager.ts(60,48)` TS2769, `(126,40)` TS2339; `lib/repositories/CalibrationSessionRepository.ts(315,7)` TS2741 |
| V-11 | `git status --short`, `git diff --stat` | 12 modified files, 358 insertions, 31 deletions; no file with deletions only; no `supabase/migrations` path; `node_modules` not listed |

### Fix round 1 (SA code review APPROVED, QA PASS WITH ISSUES; Low findings)

| Finding | Change | Test added |
|---|---|---|
| SA-1 / QA-1 | `aiCost.ts`: `exact = !reachedCeiling && unreadableAmounts === 0`. `financeHealth.ts`: a K-1 span with an unreadable amount gives no measurement, so K-1 is grey "Unknown" | `aiCost.test.ts` › "SA-1"; `financeHealth.test.ts` › "SA-1 / QA-1" (K-1 unavailable "Unknown", Section 3 `partial`) |
| SA-2 | `summariseAiCost` takes `groupsComplete`; the by-group breakdown is `partial` when the plan walk hit its ceiling (`financeTypes` widened; the page shows an "At least" note) | `aiCost.test.ts` › "SA-2"; an assertion added to the 20,000-row walk test in `financeHealth.test.ts` |
| SA-3 | `route.ts`: the custom-range rules call the shared `customRangeProblem` (format still reported by the field refinements) | none needed; the existing route tests pass |
| QA-2 | **Not changed.** §7.1 defines K-3 as "accounts in the **Founding Partner group** whose cohort has no end date", and S1-FR-4 / AC-41 say "an open-ended Founding Partner". AC-9 ("K-3 equals check 1's `no_cohort_end_date` count for the champion cohort") disagrees only for a champion that also has a tier in force, which check 1 counts under its tier row. §7.1 governs the code; AC-9 needs a BA clarification. `planGroups.test.ts` already pins the case (the tier + champion row is excluded from `foundingNoEndDate`) | none |
| QA-3 | `route.ts`: a 400 says "The filters are not valid. Check the dates, the window and the business."; Zod's first issue and `flatten()` go under `details`, development only | `route.test.ts`: the six 400 cases assert the exact body; a new development-mode case checks `details.issue` |

Re-run: finance suites + route 17 suites / **608** tests; Health 5 / 249; `test:bos-entitlements` 216 / 5,837; `test:authz-guard` 2 / 203; `lint:hooks` exit 0; ESLint on 9 touched files: 0 errors, 0 warnings. Scoped `tsc`: the canary run gives `financeRules.ts(160,7)` TS2322; the clean run gives 0 errors in the 48 changed or new files, and only the same 3 errors already in the codebase (`MemoryManager.ts` ×2, `CalibrationSessionRepository.ts`).

---

## SA Workplan Review

**Reviewed by SA — 2026-10-09**
**Status:** ✅ **APPROVED WITH CONDITIONS.** Proceed to implementation once RM has cut `feature/bos-finance-health-1a`, applying SA-WR-1 to SA-WR-7 as you build. No re-review of the workplan is needed; SA checks these conditions at code review.

**How it was checked.** Against `88f97171`, opening the cited files rather than trusting the citations. Confirmed:
- the ledger caller list `it(...)` at `:937` with its `__tests__` skip at `:942`;
- `routerPlacement.guard.test.ts:37-43` and `:617-637` (a non-recursive scan of `lib/business-os/billing/*.ts`; any repository import, type-only included, fails unless the file is in `BILLING_REPOSITORY_CALLERS`);
- `BusinessOsSubscriptionStatus` exported only from `BusinessOsBillingAccountRepository.ts:55-63`; the migration CHECK `business_os_billing_accounts_status_known` at `20261025…sql:46`;
- `findEntitlementInputs` (`:234-248`) **embeds `business_os_entitlement_overrides` with their admin-written `reason` text**;
- `stateForCohort` private at `lifecycle.ts:116-118`;
- `matchCondition`'s zero-baseline branch ("new spend");
- `requireAdmin` 401 / 403 bodies carry no `Cache-Control` (`requireAdminRoute.ts:73, 77, 116`);
- `STATUS_STYLES` labels (`HealthTile.tsx:46-75`);
- the nav test counts (`:142` floor 28, `:159` length 27);
- `settle` at `aiActivity.ts:226`;
- `requireAdminRoute.test.ts` exists for AC-2's `profiles.role` case.

The workplan matches the code in every place checked.

### Rulings SA-W1 to SA-W8

| # | Ruling |
|---|---|
| **SA-W1** | **Approved, with one condition.** When a business is picked, Section 1 narrows to that business. All six groups are still shown, with Total 1. The plan row comes from the existing `findEntitlementInputs(accountId)`: no row → 404, read error → 500 "Could not check this business". Paying status comes from the new account-scoped **R-c′** `findLiveBillingStatusForAccount`. With `accountId` set, `pagePlans`, R-a and R-c get zero calls. **R-d is the deliberate exception and is allowed**: it reads two platform-wide head counts and touches no account and no amount. The RC-15 pin becomes `['pagePlans', 'findEntitlementInputs']`. **Condition (SA-WR-1):** that read embeds override rows carrying admin-written `reason` text, which must never travel further (shadow report RC-16). So `financeHealthDeps.ts` maps the result to `{ plan }` **inside the wiring**, and the builder's dep type is `(accountId) => Promise<{ data: { plan: BusinessOsAccountPlan \| null } \| null; error }>`. Overrides therefore never reach the builder, the payload or a log; a test pins this. No new plan-repository method. |
| **SA-W2** | **Option B.** Option A would put a file with no database access into `BILLING_REPOSITORY_CALLERS`. That list means "files allowed to reach the database" (P-2a M-1), so A blurs a money-module guard to satisfy a type annotation. Instead, `payingSubscriptionStatuses.ts` imports nothing from `lib/repositories/` and never contains the word "supabase". It declares `PAYING_SUBSCRIPTION_STATUSES = ['active', 'past_due'] as const`. Its co-located test reads `20261025_business_os_billing_accounts.sql`, extracts the `business_os_billing_accounts_status_known` CHECK list and asserts that each status is in it. That is a **runtime** check, which is stronger than a type annotation here, because ts-jest does not type-check. Neither guard file is edited. This changes SA-Q5's wording "typed against `BusinessOsSubscriptionStatus`" (see requirement edit E-4). |
| **SA-W3** | **Approved.** Add the `export` keyword to `stateForCohort` and change nothing else. `lifecycle.test.ts` must pass unchanged. Add the symbol to `planGroups.ts`'s non-gate entry. |
| **SA-W4** | **Approved.** The `validateRuleListAgainst` extract is within SA-Q1, which allowed a widened `validateRuleList`. It is a behaviour-preserving move: Health's public `validateRuleList(tile, rules)` keeps its signature and output, no Health test file is edited, and V-2 proves it. The "no runtime line changes" wording in SA-Q1 applied to evaluation semantics, which do not change. |
| **SA-W5** | **Keep Health's semantics.** An exact $0 previous span and a current figure at or above the $1.00 floor is red, as Health's "new spend" rule. The description "at least doubled" is literally true. The test is pinned as planned. Revisit only if it proves noisy in practice; that would be a data edit (raise the floor), not code. |
| **SA-W6** | **Approved.** For a non-custom preset, `from` / `to` are format-checked (malformed → 400) and their values ignored. Range rules apply only to `custom`. |
| **SA-W7** | **Approved.** Tiles use the `STATUS_STYLES` labels as they are. L-2's wording was illustrative. The headline ("Not enough history", "Total is a minimum…") carries the finance-specific reason. |
| **SA-W8** | **Approved.** `app/admin/components/adminWindowPresets.ts`, imported by the route (precedent: `health-summary/route.ts:53`). It must stay pure: no `'use client'`, no React, no server-only import. A test imports it in a Node environment. |

### Required changes (apply while building; SA verifies at code review)

1. **SA-WR-1 (High).** The `findEntitlementInputs` result is mapped to `{ plan }` in `financeHealthDeps.ts`, and the builder's dep type excludes overrides. A test asserts that an injected override (with a `reason`) never appears in the payload or the captured log calls.
2. **SA-WR-2 (Medium).** Use SA-W2 option B. Remove the two "Not in §12.2" rows (billing-account caller list, `routerPlacement`) from the guard table and from the Modify list. Drop `routerPlacement.guard.test.ts` and `BusinessOsBillingAccountRepository.test.ts` from V-6, or keep them as **unchanged** runs that prove the new file did not trip them (preferred). Add the CHECK-list test to T5.
3. **SA-WR-3 (Medium).** AC-42 test: spy on `findEntitlementInputs`, R-c′, `listRowsForAccountCreatedInRange` and `findChargesByActionIds`. Assert each account-scoped call receives exactly the validated id. Assert zero calls on `pagePlans`, R-a and R-c, and that R-d is called with **no arguments**. Assert that the names lookup receives only ids taken from rows already read.
4. **SA-WR-4 (Low).** `planGroups.ts` takes the `EntitlementConfig` as a parameter, with the wiring passing `getEntitlementConfig()`. It then stays pure and the classifier tests do not depend on module state. Its non-gate `symbols` list is finalised at code time to the exact imports, including `stateForCohort`.
5. **SA-WR-5 (Low).** Ledger rows of a platform account (`isPlatformAccount`) are counted in the total, but in the top 10 they are labelled "Platform account" rather than shown with a business name or as unknown. This is a copy-only change; the test lives in T7.
6. **SA-WR-6 (Low).** The AC mapping is complete for every 1a AC. For AC-2, also add a T12 case where `requireAdmin` is the **real** function with a mocked admin lookup returning false for a `profiles.role = 'admin'` user. That way the route itself proves the 403, not only the gate's own suite.
7. **SA-WR-7 (Low).** In the V-10 canary procedure, the scratch tsconfig must not sit at the worktree root unless it is deleted in the same step. Prefer the scratchpad with an absolute `extends`. Paste the canary run's TS2322 line as evidence.

**Confirmed as written:**
- `requireAdmin` is the first statement inside `GET`. The correlation id and logger set-up before it read nothing from the request body or the database (ai-activity precedent; the guard passes).
- `no-store` is set on every status, including the gate's own 401 / 403.
- The tenant-isolation points: one caller-supplied id, validated, existence-checked, the only scope; no write path.
- The guard table, line by line (after SA-WR-2).
- The scoped `tsc` with a planted canary (V-10).
- The node_modules junction note: create with `mklink /J`, unlink with `cmd //c rmdir` before any `git worktree remove`, never `--force` with it present, and stop rather than `npm install` through it.
- **The 3.5 to 4 day estimate: accepted.** It is tight for about 30 files. If day 3 slips, report it at the end of day 3 rather than cut tests.

### Requirement edits these rulings make (recorded in the requirement §0.3 as SA-W1 to SA-W8; BA applies E-1 to E-4)

- **E-1 (SA-W1)**, three edits:
  - **SEC-3:** after "when it is present, **no** all-accounts method is called", add "(R-d, a platform-wide head count that reads no account and no amount, is the one deliberate exception)". After "checked against the plan table" add "via `findEntitlementInputs(accountId)`, whose override rows are dropped in the wiring and never used".
  - **AC-42:** replace "and no all-accounts method (R-a, R-b, R-c) is called" with "no all-accounts method (`pagePlans`, R-a, R-b, R-c) is called, and R-d is called without any account argument".
  - **S1-FR-9:** append "Section 1 then narrows to that business (all six groups shown, Total 1), using `findEntitlementInputs` and the account-scoped R-c′".
- **E-2 (SA-W1)**, three edits:
  - **L-3:** replace "a section that is not (e.g. 'accounts now') says so in its subtitle" with "Section 1 ('accounts now') ignores the date window but narrows to a picked business; its subtitle says which".
  - **§10.8:** add a row **R-c′** `findLiveBillingStatusForAccount(accountId)`, account-scoped, `.eq('user_id').eq('livemode', true).maybeSingle()`, slice 1a.
  - **§12.2 RC-15 row:** "pin `pagePlans` and `findEntitlementInputs`".
- **E-3 (SA-W1):** **AC-26** 1a clause: "Section 1, Section 3 and K-1".
- **E-4 (SA-W2):** **SA-Q5 / §8.1 "Paying" row:** replace "typed against `BusinessOsSubscriptionStatus`" with "a literal `as const` whose members a test checks against the migration's `business_os_billing_accounts_status_known` CHECK list (SA-W2: no repository import in `lib/business-os/billing/`)". The SA-Q5 row in §0.3 keeps its original text; the amendment is recorded as the SA-W2 row beside it.
- **§12.2 / SA review citation** (SA's own table, corrected by SA now): the ledger caller list is at `:937-976`, not `:950-975`.

---

## SA Code Review

**Code Review by SA — 2026-10-09**
**Status:** ✅ **APPROVED.** Code approved for QA. The three findings below are Low and non-blocking; Dev may fold them in before RM or leave them as follow-ups. No re-review is needed either way.

**How it was checked.** Every modified (12) and new (36) file in the uncommitted worktree `feature/bos-finance-health-1a` was read. SA re-ran the suites itself, and the results match the Dev's numbers:
- the route, finance lib, page, admin components, finance and ledger repository, billing, RC-15, `enforcementPoints`, N-10 and Health suites: 36 suites, 1,327 tests, exit 0;
- `npm run test:authz-guard`: 2 suites, 203 tests;
- `npm run test:bos-entitlements`: 216 suites, 5,837 tests.

**Line endings (`evaluateHealth.ts`).** `git ls-files --eol` gives `i/lf w/lf`, and `--ignore-all-space --stat` is still 37 insertions and 14 deletions. The file is not rewritten. The warning only reflects `core.autocrlf=true`, and the commit stores LF, as HEAD does.

### Rulings on the Dev's deviations

| # | Deviation | Ruling |
|---|---|---|
| 1 | `financeHealthDeps.ts` is a second non-gate importer (`getEntitlementConfig`) | **Approved.** It follows from SA-WR-4. Its `KNOWN_NON_GATE_IMPORTERS` entry lists exactly that symbol, and the file calls no `check()` / `decide()`, so it is truly not a gate. `planGroups.ts`'s entry matches its 9 imports exactly. The skill checklist is met: there is no tier literal, no catalog or matrix change, and `test:bos-entitlements` is green. |
| 2 | `page.tsx` is `'use client'` | **Approved, and the gate is honest.** `app/admin/layout.tsx:41` runs `requireAdminPage()` before any child renders. The page holds no data. The only data path is the route, whose first statement after the logger set-up is `requireAdmin` (`route.ts:111`): that is the real enforcement. R8 forces this shape, which is the audit-trail precedent. |
| 3 | Native `<table>` | **Approved.** No `components/ui` table exists. Header cells use `scope`, as the Health and Activity screens do. |
| 4 | `financeFormat.ts`; the `ORIGIN_NOTES` copy map; the sorted RC-15 pin; the logger passed straight in | **Approved.** |
| 7 | Account check before the other reads | **Approved.** This is stronger than planned: an id with no plan row triggers no read at all. |

### Checklist

All items pass:
- **Gate.** `requireAdmin` is first, and 401 / 403 carry `no-store`. SA-WR-6 uses the real gate: `profiles.role` / metadata `admin` with the admin lookup false gives 403, the profile is never consulted, and nothing is read.
- **Validation.** Zod is `.strict()`. A repeated key gives 400 before Zod. `custom` checks: `from <= to`, `to <= today` UTC with no tolerance, at most 92 inclusive days. A preset's dates are re-resolved on the server.
- **AC-42.** With a business picked, every scoped read gets the id. `pagePlans`, R-a and R-c get zero calls. R-d gets no argument. Names come only from ids in rows already read. This is tested in the builder and through the route.
- **WR-1.** Overrides are dropped in `findPlanWithoutOverrides`. The dep type has no room for them, and a test with a planted secret covers the wiring, payload and logs.
- **WR-2.** `payingSubscriptionStatuses.ts` has no import and does not contain the word "supabase". It is checked against the migration's CHECK list.
- **R-a.** It is paged (1,000 / 20,000), de-duplicated and uses the `>=` ceiling. It feeds `exact: false`, which the page shows as "At least".
- **Money and plans.** Amounts are USD only, so nothing is summed across currencies. There are no tier literals; tiers come from `config.tierOrder`. K-1 is the calendar month in UTC via `Date.UTC`.
- **Logging.** Pino with `correlationId` and `adminId`. One info line with no name or figure. Zero `console.*` calls.
- **Types and finance repository.** No implicit `any`; the one `as any` is in a test, with a comment. The finance repository has a no-write source pin. It reads with `livemode = true` and documents why it uses the service role.
- **Errors and caching.** Error bodies carry `details` in development only. Every status is `no-store`.
- **Health.** Only types were widened, plus the `validateRuleListAgainst` extract. The `report.ts` predicates are equivalent. The Health, report and lifecycle tests pass unchanged.
- **Tests.** They exercise the real builder, classifier and gate behind fakes at the repository boundary. None asserts against its own mock.

### Code Review Comments

1. `lib/business-os/finance/financeHealth.ts:287-288`: `k1Measured` drops `sumCostUsd`'s `unreadableAmounts`, so a K-1 figure with an unreadable row can still be `exact` and turn green. **Fix:** `exact: !reachedCeiling && unreadableAmounts === 0`, with one test. The same applies to Section 3's `exact` (`aiCost.ts:146`). Priority: **Low**. There is no such row today, and the count is already logged.
2. `lib/business-os/finance/aiCost.ts:152-159`: when the plan walk is capped, `byGroup.status` is still `'ok'`, and accounts beyond the cap fall into Unknown/held. **Fix:** pass the plan cap through and mark the breakdown `partial`. Priority: **Low**. A cap needs more than 20,000 accounts.
3. `app/api/admin/business-os/finance/route.ts:81-102` repeats the rules in `customRangeProblem` (`adminWindowPresets.ts:162`). **Fix (optional):** have `superRefine` call `customRangeProblem`, so the page and the server cannot drift. Priority: **Low**.

### Optimisation Suggestions
- The workplan's task 20 (requirement §0.1 status) is still owed by the BA.

### Code Approved for QA: **Yes**

---

## QA Report

**QA — 2026-10-09**
**Test mode:** full
**Strategy used:** A (unit) + B (route integration with mocked gate / deps), re-run from the worktree; scoped `tsc` with canary; code reading for the edge cases; D (manual browser check) **listed for the user**, because it needs an admin login on the dev server.
**Focus:** all (api, ui, schema, security)
**Skipped:** the live browser path and the §13 SQL checks (QA does not run SQL against production). Steps for the user are below.
**Input source:** prompt keywords from TL.
**Verdict:** ✅ **PASS WITH ISSUES**. No bug found. Every 1a AC that Jest can test passes. AC-9, AC-10 and AC-32 wait on the user's manual check. Three Low edge cases, none blocking.

### Test runs (from `neuronforge-finance-health`, branch `feature/bos-finance-health-1a`, uncommitted)

| # | Command | Result |
|---|---|---|
| Q-1 | `npx jest lib/business-os/finance app/admin/finance app/admin/components app/api/admin/business-os/finance lib/repositories/__tests__/BusinessOsFinanceReadRepository.test.ts lib/repositories/__tests__/BusinessOsCreditLedgerReadRepository.test.ts lib/business-os/billing/__tests__/payingSubscriptionStatuses.test.ts --ci` (T1 to T14 + sidebar nav) | exit 0; **17 suites, 604 tests passed** |
| Q-2 | `npx jest lib/admin/health --ci` | exit 0; **5 suites, 249 passed**; `git status -- lib/admin/health/__tests__` is empty (no Health test edited) |
| Q-3 | `npx jest` over report, dormantChampions, lifecycle, `requireAdminRoute`, `requireAdminPage`, `routerPlacement.guard`, `BusinessOsBillingAccountRepository`, `adminReadMethods.guard` | exit 0; **8 suites, 215 passed**; none of these test files is in the diff |
| Q-4 | `npm run test:bos-entitlements` | exit 0; **216 suites, 5,837 passed** |
| Q-5 | `npm run test:authz-guard` | exit 0; **2 suites, 203 passed** |
| Q-6 | `npm run lint:hooks` | exit 0 (no output) |
| Q-7 | Scoped `tsc`. Config: `tsconfig.qa-1a.json` in the session scratchpad, with an absolute `extends` to the worktree `tsconfig.json` and `include` = `types/**/*.d.ts` + the 48 changed and new `.ts` / `.tsx` files. Command: `NODE_OPTIONS=--max-old-space-size=8192 npx tsc -p <it>` | **Canary run** (planted `const __qaCanary: number = "qa-canary";` at the end of `financeRules.ts`): exit 2, `lib/business-os/finance/financeRules.ts(159,7): error TS2322: Type 'string' is not assignable to type 'number'.` **Canary removed** (file back to its pre-QA bytes), re-run: exit 2 with **0 diagnostics in changed or new files**. The 3 that remain are pre-existing, outside the diff, and pulled in through `lib/repositories/index.ts`: `lib/pilot/insight/MemoryManager.ts(60,48)` TS2769, `(126,40)` TS2339; `lib/repositories/CalibrationSessionRepository.ts(315,7)` TS2741. Same as Dev's V-10 |
| Q-8 | `git status --short`, `git diff --stat` | 12 modified files (358+, 31−); no deletion-only file; no `supabase/migrations` path in the diff or the untracked files |

### Test Coverage (slice 1a ACs)

| AC | Result | Evidence |
|---|---|---|
| AC-1 | ✅ Pass | T12 "AC-1: 401 when signed out, no data, no-store" |
| AC-2 | ✅ Pass | T12: "AC-2: 403 for a signed-in non-admin, no-store, no read"; "SA-WR-6: 403 for a user whose profiles.role (and metadata) say admin, when admin_users says no" (real `requireAdmin`); "403, not 400, for a non-admin with an invalid query". Also Q-5 |
| AC-3 | ✅ Pass (Jest), manual confirm | `requireAdminPage.test.ts`; T14 "has no route.ts under app/admin" and "the page is a client component … Suspense"; layout gate. Manual step L-12 |
| AC-4 | ✅ Pass | T12 `it.each` (unknown preset, custom without dates, `to` before `from`, 93 days, malformed `accountId`, unknown key) → 400, `details` undefined outside development |
| AC-5 | ✅ Pass | T12: "404 … platform account id, before any read"; "404 for a well-formed id with no plan row, and no further read" |
| AC-6 | ✅ Pass | T6 "AC-6: no plan rows → every group 0, Total 0"; T10 "AC-6: an empty plan walk → Section 1 zeros and K-3 green 0" |
| AC-7 | ✅ Pass | T7 "AC-7: no rows → zeros, exact"; T10 "AC-7: no ledger rows"; T13 "AC-7: … No AI actions charged … USD 0.00"; T9 floor and cut-over cases |
| AC-9 | ⬜ NOT-TESTED | Manual: SQL check 1 vs Section 1 + K-3 (L-8) |
| AC-10 | ⬜ NOT-TESTED | Manual: SQL checks 2 and 3 vs Section 3 (L-9, L-10); T7 pins the exact-sum method |
| AC-12 | ✅ Pass | T6 table test over every `LifecycleState` × basis × paying; "classifies the 12 rows; the groups sum to Total" |
| AC-14 | ✅ Pass | T13 "AC-14: the AI cost is labelled USD"; T11 "no layer-B payment table" |
| AC-15 | ✅ Pass | T2 R-a ceiling `>=`; T7 "AC-15"; T10 "AC-15: … partial"; T13 "AC-15: … At least USD"; T9 inexact → amber minimum, never green |
| AC-18 | ✅ Pass | T9 `it.each` (10 → 15 amber, 20 red, 14.99 green, floor, $0 baseline red per SA-W5), cut-over, inexact; T8 Mar 31 clamp, leap year, Jan 15 year boundary, month start |
| AC-20 | ✅ Pass | T9 "AC-20: a threshold change in DATA changes the colour" |
| AC-21 | ✅ Pass | T13 "shows the title, the three tiles with their text state"; `FinanceKpiStrip` renders `STATUS_STYLES[status].label` |
| AC-22 | ✅ Pass | T10 revenue panel; T13 "AC-22: … no $0 anywhere in it or on K-5" |
| AC-23 | ✅ Pass | T10 "AC-23: a live paid invoice → recorded"; T1 "two head counts, live mode only" |
| AC-24 | ✅ Pass (Jest), manual confirm | T4 (default + notice, unknown key dropped, round trip, four keys only); T14 `router.replace` + scroll false, never push; T13 "a preset click writes the URL …". Reload: manual L-3 |
| AC-25 | ✅ Pass | T3 UTC edges, 7d / 30d include today, parity over 50 instants; T12 "AC-25: a preset with client from / to → the window comes from the server clock" |
| AC-26 | ✅ Pass | T10 "every account-scoped read gets exactly the id …"; "the picked account pays: its tier group, via R-c′" |
| AC-27 | ✅ Pass | T10 "AC-27: the window read fails → Section 3 unknown, the others ok"; T12 "AC-27: … 200 with that section unknown"; T13 "AC-27: … Retry" |
| AC-28 | ✅ Pass | T11 / T1 write-verb pins with planted negative controls; T12 "names no write verb and no audit call"; Q-8 no migration |
| AC-29 | ✅ Pass | T11 "no aggregate select and no token_usage"; T1 "selects no aggregate" |
| AC-30 | ✅ Pass | T12 "AC-30: one info line …; no name, email or figure"; T11 / T14 no `console` |
| AC-31 | ✅ Pass | Q-2, Q-4, Q-5, and the nav test in Q-1 |
| AC-32 | ⬜ NOT-TESTED | Manual critical path below (needs an admin login) |
| AC-33 | ✅ Pass | T12 "AC-33: a repeated key → 400 before Zod" |
| AC-34 | ✅ Pass | T12 "to = tomorrow → 400"; "92 inclusive days → 200; 93 → 400" |
| AC-35 | ✅ Pass | T12 asserts `no-store` on 200, 400, 401, 403, 404 and 500; the route uses `noStore()` / `NO_STORE` on every exit |
| AC-36 | ✅ Pass | T12: "an unexpected throw → 500 standard body, details only in development"; "in development, details carry the message" |
| AC-37 | ✅ Pass | T10: "plan walk fails → Section 1 unknown, K-3 unavailable, Section 3 total still ok with byGroup unknown"; "the walk reaching 20,000 → Section 1 partial, K-3 a minimum" |
| AC-39 | ✅ Pass | T10 "AC-39"; T13 "AC-39: … Could not check" |
| AC-40 | ✅ Pass | T10, both AC-40 cases (entirely before → no read; starts before → read from the cut-over); T13 notice instead of $0 |
| AC-41 | ✅ Pass | T10 "AC-41: an open-ended Founding Partner → K-3 is 1; a dated one → 0" |
| AC-42 | ✅ Pass | T10 SA-WR-3 test (0 calls on `pagePlans`, R-a and R-c; R-d with no argument; names only from rows read); T12 "AC-42 through the route" |
| AC-44 | ✅ Pass | Q-7 |

### Edge cases (code and tests read)

| Edge case | Result | Evidence |
|---|---|---|
| Empty data | Confirmed | AC-6 / AC-7 tests; `aiCost.ts` returns exact zeros; the UI shows "No AI actions charged in this window" |
| 20,000 ceiling → "at least" | Confirmed | R-a sets `reachedCeiling = rows.length >= ceiling`; `financeHealth.ts:269` → `partial`; `AiCostSection.tsx:70` uses `atLeast(...)`; plan walk at `financeHealth.ts:151`. The R-c ceiling is an error → "Tier set", never a partial paying list |
| 92-day limit | Confirmed | `route.ts:96`, inclusive; T12 92 → 200, 93 → 400. The presets are at most 31 days |
| Invalid / missing params → 400 | Confirmed | `route.ts:121` repeated key, `:80` `.strict()`, `:83` custom without dates. A missing `preset` defaults to `this_month` (by design) |
| Unknown / platform `accountId` → 404 | Confirmed | `route.ts:135` (pure, before any read) and `:150`. The builder checks the plan row before anything else (`financeHealth.ts:170-178`) |
| 401 vs 403, `profiles.role` admin | Confirmed | Real `requireAdmin` in T12; 403 without consulting the profile |
| Multi-currency | Confirmed (not applicable in 1a) | Only `cost_usd` (USD by column) is summed; T11 forbids every layer-B table, so no cross-currency sum is possible |
| Month boundary in UTC | Confirmed | `k1Spans` uses `Date.UTC`; T8 (Mar 31, leap year, Jan 15, exact month start); T3 (23:59:59.999Z / 00:00Z, year end, parity) |
| Deleted accounts | Confirmed | R-a has no `user_id` filter; `aiCost.ts:116-119` puts the deleted bucket in the total and on its own line, never in the top 10; T7 |
| $0 previous month on K-1 | Confirmed | SA-W5: an exact $0 previous span with current ≥ $1.00 → red "at least doubled"; T9 pins it. Today K-1 is grey anyway (the previous span is before the cut-over) |
| Cut-over notice | Confirmed | `financeHealth.ts:189, 203`; `AiCostSection.tsx:71-77` hides the figures when the window is entirely before |
| Override reason never in payload / logs | Confirmed | `financeHealthDeps.ts` maps to `{ plan }`; the T10 SA-WR-1 tests cover the wiring result, the payload, the builder logs and the repository logger |
| One section fails, others render | Confirmed | Every read is `settle`d (`financeHealth.ts:192-206`); T10 / T12 / T13 AC-27 |

### Issues Found

#### Bugs (must fix before commit)
None.

#### Performance Issues (should fix)
None blocking. Note: with `preset=this_month`, the Section 3 read and the K-1 current read cover almost the same range, so the ledger is read twice (`financeHealth.ts:203-204`). At 265 rows this costs nothing. It is worth one shared read if the ledger grows.

#### Edge Cases (nice to fix, all Low)
1. **K-1 ignores unreadable amounts** (`lib/business-os/finance/financeHealth.ts:287-288`). `sumCostUsd` counts `unreadableAmounts`, but `k1Measured` drops the count. A K-1 figure with an unreadable row therefore stays "exact" and can turn green. §7.1 says K-1 is grey "Unknown" when either figure is unreadable. This is practically unreachable: `cost_usd` is `numeric(16,10) NOT NULL` with a not-NaN CHECK (`20261015_business_os_credit_charges.sql:15, 48`). Low.
2. **K-3 vs SQL check 1 when a champion cohort also has a tier** (`lib/business-os/finance/planGroups.ts:150`). "No end date" is counted only inside the Founding Partner group. A champion-cohort account with a tier in force (tier wins) sits in a tier or Comped group and is not counted, while check 1's `no_cohort_end_date` for the champion cohort would count it. Today every row has `tier` NULL, so AC-9 matches. On a mismatch, check this first before calling it a bug. Low.
3. **The 400 message repeats Zod's own text**, e.g. "Unrecognized key(s) in object: 'foo'" (`route.ts:129`). It echoes only the caller's own input, nothing internal, so SEC-7 holds. Cosmetic. Low.

### Manual critical path (AC-32, AC-3, AC-9, AC-10): for the user

Run `npm run dev` from `neuronforge-finance-health` and sign in as a platform admin. Keep the Supabase SQL editor open for the read-only checks in requirement §13. QA did not run them.

| # | Step | Expected |
|---|---|---|
| L-1 | Open `/admin` and look at the Monitor group | "Finance" sits directly after Health, with the description "Revenue, AI cost and credits, Business OS". Clicking it opens `/admin/finance` |
| L-2 | Let the page load with no query | Title "Finance & business health" and its purpose line. The header shows "This month, 2026-10-01 to <today> UTC". Order: tiles K-1, K-3, K-5 → "Our revenue" → Accounts by plan → AI cost. No Credits, Revenue-by-month, Funnel or Payment problems heading |
| L-3 | Click Today, 7d, 30d and This month in turn; then Custom with a valid range of up to 92 days, and Apply; then reload (F5) after each | The URL changes in place (Back does not step through each click: `replace`). The 7d / 30d windows include today. After a reload, the same preset, dates and figures show. Paste the custom URL into a new tab: same view |
| L-4 | Edit the URL by hand: `?preset=nonsense`, then `?preset=custom&from=2026-01-01&to=2026-12-31`, then `?foo=1` | The first two fall back to This month / All businesses with a small amber notice, and nothing crashes. `foo` is dropped silently |
| L-5 | Business picker: choose one business, then go back to "All businesses" | The URL gains and loses `accountId=<uuid>` only, never a name. The Section 1 subtitle reads "Business OS plan row, this business, now" and shows Total 1 in that business's group. K-3 shows 1 or 0. AI cost and K-1 narrow to that business. The revenue panel does not change (platform-wide by design) |
| L-6 | Tile colours and text | K-1: grey, "Not enough history" this month (the previous span is before the 2026-09-29 cut-over), with this month's USD figure. K-3: amber with its text state label and the reason "Founding Partners with no end date"; its value is the number of open-ended Founding Partners. K-5: grey, "None yet". Every tile shows a text state, not colour alone |
| L-7 | The "Our revenue" panel | "None yet. Plan billing is not live …", with no $0 and no chart. Run **SQL check 6**: `plan_invoice_paid_live` and `boost_paid_live` must both be 0. If either is above 0, the panel must instead say "Live revenue has started to arrive …" |
| L-8 | **SQL check 1** vs Accounts by plan (AC-9) | The sum of `accounts` = Total. The champion-cohort rows = Founding Partner. K-3 = `no_cohort_end_date` on the champion rows (today 8 / 8, unless accounts have been added). "New in window" for This month = `created_this_month_utc`, split by origin |
| L-9 | **SQL check 2** vs AI cost, preset This month, All businesses (AC-10) | Total USD = the `(all)` row's `cost_usd`, to the cent; credits = its `credits`. "Charged actions" = the sum of `charge_rows` over the `kind = 'charge'` rows (the page counts charges only; the `(all)` row also counts adjustments). "Deleted accounts" = `deleted_account_rows` and its cost. The trigger split matches while there are no adjustment rows |
| L-10 | **SQL check 3** vs the top 10 | Same accounts in the same cost order (ties by account id). A platform account shows "Platform account" instead of a name |
| L-11 | A custom window entirely before 2026-09-29 (e.g. 2026-09-01 to 2026-09-20) | The cut-over notice shows **instead of** the figures (no USD 0.00). A window from 2026-09-20 to today shows the notice and the figures |
| L-12 | Sign in as a non-admin (or use a private window, signed out) and open `/admin/finance` and `/api/admin/business-os/finance` | Page: redirected, no figure shown (AC-3). API: 401 signed out, 403 non-admin, each with `Cache-Control: no-store` (DevTools → Network) |
| L-13 | Dev-server log | One `info` line "Admin read the Business OS finance page" per load, with `correlationId`, `adminId`, filters, statuses, counts and `durationMs`, and no business name or figure. Record `durationMs` (target p95 under 2 s; the split trigger is 1 s per section) |

### Final Status
- [ ] All acceptance criteria pass — ready for commit
- [x] **Every 1a AC that Jest can test passes, and no bug is open.** AC-9, AC-10 and AC-32 need the user's manual run (L-1 to L-13) before commit. The three Low edge cases do not block.

---

## Commit Info

_(RM to complete.)_

---

## Change History

| Date | Change | Details |
|---|---|---|
| 2026-10-09 | Created (Dev) | Slice 1a workplan against `88f97171`: file list, the R-a / R-c / R-c′ / R-d specs, the route, pure functions and tests, the SA-Q notes, the §12.2 guard table line by line (plus two guards §12.2 missed), the AC mapping, the verification plan with the scoped `tsc` canary, risks and estimate. Raises SA-W1 to SA-W8. No code written. |
| 2026-10-09 | SA workplan review: **APPROVED WITH CONDITIONS** | SA-W1 to SA-W8 ruled (W1 approved, overrides stripped in the wiring; W2 option B, no guard edits; W3, W4, W6, W7 and W8 approved; W5 Health semantics kept). Required changes SA-WR-1 to SA-WR-7. Requirement edits E-1 to E-4 listed for BA; ledger caller-list citation corrected in the requirement. Recorded in requirement §0.3 and its Change History. |
| 2026-10-09 | Implemented (Dev): **Code Complete**, uncommitted | Tasks 0 to 19 done; SA-WR-1 to SA-WR-7 applied; 8 deviations recorded (second non-gate importer for the config, client `page.tsx` for authz R8, native tables, `financeFormat.ts`, backfill copy map, sorted RC-15 pin, account check first, logger); V-1 to V-11 green and pasted in § Implementation Notes. Task 20 (requirement §0.1) left to the BA. |
| 2026-10-09 | SA code review: **APPROVED** | All 48 files reviewed; deviations 1 to 8 approved (second non-gate importer; client `page.tsx` behind the layout's `requireAdminPage`, with the route's `requireAdmin` as the real enforcement; native tables). SA re-ran the suites: 36 suites / 1,327 tests, authz guard 203 tests, `test:bos-entitlements` 5,837 tests, all green. `evaluateHealth.ts` has no line-ending rewrite. Three Low, non-blocking findings (unreadable amounts vs `exact`, `byGroup` status under a plan cap, duplicated custom-range rules). Code approved for QA. |
