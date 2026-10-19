# Workplan: Money MK-4, Plans & subscriptions tab and MRR in the Finance payload

> **Last Updated**: 2026-10-19

**Developer:** Dev
**Requirement:** [ADMIN_MONEY_KPI_RESTRUCTURE_REVIEW.md](/docs/requirements/ADMIN_MONEY_KPI_RESTRUCTURE_REVIEW.md) §12 MK-4 row; §3.2 (the Plans & subscriptions row and the Revenue "Recurring now" line); §5 F-K2; §3.4; SA-RR-MK SA-2, SA-4, SA-6 and the pins table; FIN C-4, BD-37, BQ-P8a-4; P-8a (`planMrr.ts`, `BusinessOsBillingAdminReadRepository`, `/admin/subscriptions`)
**Branch:** `feature/admin-money-mk4-plans-subscriptions-mrr` (from main `4583d21e`; MK-0 and MK-1 merged)
**Date:** 2026-10-19
**Status:** Code Complete (uncommitted)
**Path:** full cycle (payload change, ruled AC-145 re-freeze). It runs in parallel with MK-2, so it does not touch the Charge checks files or `chargedAiCost.ts`.

## Overview

MK-4 does four things:
- **MRR now** (current Stripe mode, BD-37) joins the Finance payload, read through a `lib/admin/billing` wiring function that reuses P-8a's one-mode reader and its one MRR rule;
- the Revenue section gains a **"Recurring now"** line;
- the Subscriptions page becomes the **Plans & subscriptions** tab of Finance, with Plan mix on top and the list fetched only when the tab is open;
- `/admin/subscriptions` **redirects** to `/admin/finance?tab=plans`.

**The F-K2 tile is not built here.** §12 lists the strip re-cut (F-K1 to F-K5) as MK-5, and SA-RR-MK's pins table puts "Pin B (the strip re-cut…)" in MK-5. MK-4 only puts `mrr` and `stripeMode` in the payload, which MK-5's tile will read.

---

## 1. Code facts (at `4583d21e`)

| # | Fact | Where |
|---|---|---|
| CF-1 | `computeMrr(rows, { livemode, priceOf })` is the one MRR rule. `past_due` is counted and shown apart (`MRR_COUNTS_PAST_DUE`, BQ-P8a-4); `discountUnknown` and `unpriced` are never shown as 0; there is one line per currency | `lib/business-os/billing/planMrr.ts` |
| CF-2 | The Subscriptions page's MRR is `computeMrr` over the current-mode rows that have a status, priced by `catalogPriceOf(config)` | `lib/admin/billing/subscriptionsView.ts` (`buildSubscriptions`) |
| CF-3 | One-mode reads with no new method: `listBillingRowsForModeAllAccounts(mode)` (keyset ≤ 1,000, ceiling errors) and `findBillingRowForAccount(id, mode)`. The mode is resolved in `lib/admin/billing` (R4) | `BusinessOsBillingAdminReadRepository.ts`; `currentModeBillingStatus.ts` |
| CF-4 | The finance source guard forbids `/livemode\|test.?mode\|live.?mode/i` in the code of every file under `lib/business-os/finance`, `app/admin/finance`, the route and the finance read repository | `finance.source.guard.test.ts:655-692` |
| CF-5 | AC-173: Part A covers the requests of the pinned page states; Part B hashes the route's `buildQuerySchema`; Part C hashes `serialiseFinanceUrl`. The serialiser writes `tab` only for `accounts` | `financeRequest.pin.render.test.tsx`; `financeUrl.ts` |
| CF-6 | AC-145 hashes the Overview payload bytes and lists its top-level keys. The route test mocks the finance wiring | `route.test.ts:1163-1300` |
| CF-7 | The page tab state is `filters.tab` (`'' \| 'accounts'`, `financeFilters.ts`). `toFinanceQuery` sends `tab` only for `accounts` | `financeFilters.ts:126`, `:153` |
| CF-8 | `/admin/subscriptions` is a Money sidebar item. The users drawer imports `subscriptionsCopy` and `SubscriptionsTable` stays shared | `AdminSidebar.tsx:141`; `PlanBillingBlock.tsx:30` |
| CF-9 | Redirects live in `next.config.js` and are tested through Next's matcher (the M-5 pattern) | `chargeChecksRedirect.config.test.ts` |

## 2. Design

- **`lib/admin/billing/subscriptionsView.ts`:** a pure exported `subscriptionsMrr(billingRows, config, mode)`, which is the filter (current mode, has a status) plus `computeMrr` plus `catalogPriceOf`. `buildSubscriptions` calls it, so the Subscriptions list and Finance give **the same MRR by construction**.
- **New `lib/admin/billing/financeMrr.ts`:** `readFinanceMrr(accountId | null, deps?)` resolves the mode with `currentStripeMode()` and fails closed (`unknown`, no figure). All businesses read through `listBillingRowsForModeAllAccounts`; one business through `findBillingRowForAccount`. It returns `{ stripeMode: 'test' | 'live' | null, mrr: FinanceMrrSection }`. No new repository method, and no `.limit` of its own.
- **`lib/business-os/finance/financeTypes.ts`:** `FinanceMrrSection` (`status`, `lines` with the MRR line fields, `unpriced`, `discountUnknown`, `pastDueCounted`), and optional `FinancePayload.mrr` / `stripeMode` (optional so existing fixtures still type, as E-103). It names no mode wording: `stripeMode` and `'test' | 'live'` do not match CF-4.
- **Route:** `readFinanceMrr(accountId)` runs beside `buildFinanceHealth`, and the payload is `{ ...payload, mrr, stripeMode }`. `requireAdmin` stays first, and **`buildQuerySchema` is unchanged** (D-1 below).
- **Page:**
  - `financeFilters` `tab` gains `plans`. `toFinanceQuery` still sends `tab` only for `accounts`, so the Plans tab sends the **Overview request**: one fetch, and Part A and Part C are unchanged.
  - `FinanceTabs` gains "Plans & subscriptions".
  - The Plans panel holds `AccountsByPlanSection` (Plan mix) on top, then the new `PlansSubscriptions`. That component fetches the existing subscriptions route **on mount**, which is only when the tab is open, and shows:
    - the mode chip and the test-key notice;
    - the MRR lines;
    - a status select (local state);
    - the count line and `SubscriptionsTable`.
- **Revenue "Recurring now"** (`RevenuePanel`): one line per currency, giving MRR, "of which past due (still counted)", "of which cancelling", the subscription count, and the unpriced and discount notes. Money uses the panel's current `formatMoney` (named currency), and the `$` switch is MK-5's. **No mode label** (C-4).
- **Redirect:** `/admin/subscriptions` → `/admin/finance?tab=plans`, temporary, with the query kept. The Money sidebar item goes; `/admin/subscriptions/page.tsx` and its render test are deleted, their cases moving to the tab's tests. `subscriptionsCopy.ts` and `SubscriptionsTable.tsx` stay, because they are shared with the users drawer.

**D-1 (for SA): AC-173 Part B is not moved.** The tab needs no route-side behaviour: Plan mix and MRR are in the Overview payload. Sending `tab=plans` would also need `serialiseFinanceUrl`, which would move **Part C**, and that is not ruled. So the route schema stays as it is, and only AC-145 moves. That is fewer pins than ruled, not more.

**D-2 (for SA): the mode-wording guard is not narrowed.** The tab's mode words ("Stripe test mode", the test-key note) come from P-8a's `subscriptionsCopy.ts`, outside the scanned tree. The Finance files name only the constants (`MODE_BADGE`, `TEST_KEY_NOTE`) and the `stripeMode` key, none of which match CF-4. So the existing rule stays strict: **no** allow-list entry. Instead a new render test pins C-4: the words appear only inside the Plans tab's subscriptions block, never on the Overview, the strip or Revenue. If SA still wants the SA-4 allow-list (for MK-5's tile constant), MK-5 adds it with its planted control.

## 3. Files

| File | Action |
|---|---|
| `lib/admin/billing/subscriptionsView.ts` | modify (`subscriptionsMrr`, used by `buildSubscriptions`) |
| `lib/admin/billing/financeMrr.ts` | create |
| `lib/business-os/finance/financeTypes.ts` | modify (types only) |
| `app/api/admin/business-os/finance/route.ts` | modify (MRR read beside the build; payload merge) |
| `app/admin/finance/financeFilters.ts`, `components/FinanceTabs.tsx`, `components/FinanceView.tsx`, `financeCopy.ts`, `components/RevenuePanel.tsx` | modify |
| `app/admin/finance/components/PlansSubscriptions.tsx` | create |
| `app/admin/components/AdminSidebar.tsx` | modify (the Subscriptions item removed) |
| `next.config.js` | modify (one redirect) |
| `app/admin/subscriptions/page.tsx`, `__tests__/subscriptionsPage.render.test.tsx` | delete (moved) |
| Tests | see §5 |

## 4. Ruled pins

| Pin | Before | After | Ruling |
|---|---|---|---|
| AC-145 (`route.test.ts` `EXPECTED_SHA256` and `EXPECTED_KEYS`) | `39b35743…56ea`; keys end `paymentProblems` | `30275c29…0631`; keys gain `mrr`, `stripeMode` | SA-RR-MK MK-4. The earlier hashes still reproduce once the two keys are stripped |
| AC-173 Part B | `da268284…d87f` | **unchanged** (D-1) | — |
| AC-173 Parts A and C, Pins A to D | unchanged | unchanged | stop if any moves |

## 5. Tests

| # | Test |
|---|---|
| T-1 | `financeMrr.test.ts`: the same billing rows give **the same MRR** through `readFinanceMrr` and `buildSubscriptions`. Covers past_due counted and shown apart, other-mode rows excluded, an unknown key fails closed with zero reads, one account through `findBillingRowForAccount`, and a read error gives `unknown` |
| T-2 | Route: `mrr` and `stripeMode` in the payload; a failed MRR read leaves the rest of the payload intact (`mrr.status: 'unknown'`). AC-145 is the ruled update |
| T-3 | Page: **one fetch on load** (Overview); opening Plans & subscriptions sends **one more** fetch, to the subscriptions route only; Overview never calls it |
| T-4 | Page: the Plans tab request to the finance route equals the Overview literal (`preset=this_month`), pinned in this slice's own test, not in the AC-173 table |
| T-5 | Page: "Stripe test mode" text appears **only** inside the Plans tab's subscriptions block (C-4), never on the Overview, the strip or Revenue |
| T-6 | Revenue "Recurring now": lines per currency, past due apart, unknown, and "None" |
| T-7 | Redirect: shape plus Next's matcher, with the query kept; the redirect count is updated (ruled edit) |
| T-8 | Sidebar nav test: the Subscriptions item is removed (ruled edit) |
| T-9 | Tabs: the three tabs in order (ruled edit of the two-tab assertion) |

## 6. Guards

- Finance source guard (unchanged; it must pass); vocabulary; contrast; C-14 / MIGRATED_PAGES (no entry for `/admin/subscriptions` exists); range-cap (no new `.limit`); the routerPlacement guard (`lib/admin/billing` holds the read, R4 lesson).
- `test:authz-guard` (no new route), `test:bos-entitlements` (`subscriptionsView` already imports entitlements; `financeMrr` imports `subscriptionsView` and `getEntitlementConfig`, which may need its importer registered; run it), `lint:hooks`.

## 7. Risks

| # | Risk | Mitigation |
|---|---|---|
| R-1 | Parallel MK-2 and MK-3 both edit `next.config.js` and the redirect count test | Small, mergeable entries; RM merges main before the PR |
| R-2 | A missing Stripe key makes MRR `unknown` locally | Fail closed by design (PF-15); the rest of the page is unaffected |
| R-3 | The Plans tab with a status filter in the URL | The filter is local state, so the URL never fights the Finance filter spec (D-3) |
| R-4 | Removing the Subscriptions page drops its tests | Its cases move to the tab's tests |

## Implementation Notes

**2026-10-19, Dev. Implemented as §2, uncommitted. One ruled pin moved (AC-145). AC-173 Part B did NOT move (D-1). No migration.**

### Files

| File | Change |
|---|---|
| `lib/admin/billing/subscriptionsView.ts` | New pure `subscriptionsMrr(rows, config, mode)`; `buildSubscriptions` now calls it. Same filter, same rule, same price |
| `lib/admin/billing/financeMrr.ts` | New `readFinanceMrr(accountId \| null, deps?)`. Mode from `currentStripeMode()`; on an unknown key it fails closed with no read. All businesses via `listBillingRowsForModeAllAccounts`, one business via `findBillingRowForAccount`. Pino warn or error on each failure; it never throws |
| `lib/business-os/finance/financeTypes.ts` | `FinanceMrrLine`, `FinanceMrrSection`; optional `FinancePayload.mrr` and `stripeMode` (types only; no mode wording, the guard passes) |
| `app/api/admin/business-os/finance/route.ts` | All businesses: `readFinanceMrr(null)` starts beside the builder. A picked business is read only after the builder found its plan row, so there is no read for an id that is not a business. The payload becomes `{ ...built, mrr, stripeMode }`. The info line adds `sections.mrr` (status and currency count, never a figure). **`buildQuerySchema` is unchanged** |
| `app/admin/finance/financeFilters.ts` | `tab` gains `plans`; a new `status` key (the Subscriptions filter, only with `tab=plans`). Repair drops `status` off the tab, and Clear resets it. `toFinanceQuery` is unchanged, so the request is unchanged |
| `app/admin/finance/components/FinanceTabs.tsx`, `FinanceView.tsx` | Third tab "Plans & subscriptions". Its panel holds `AccountsByPlanSection` (Plan mix) on top, then `PlansSubscriptions`. Strip tiles on that tab link back to Overview (the F-5 filter mode, as on Accounts) |
| `app/admin/finance/components/PlansSubscriptions.tsx` | New: the old page's content (mode chip, test-key notice, MRR lines, paid accounts, status select, count line, `SubscriptionsTable`). It fetches the subscriptions route **on mount only**, which means only when the tab is open |
| `app/admin/finance/components/RecurringNowPart.tsx`, `RevenuePanel.tsx` | "Recurring now (MRR)" in Revenue: per currency, past due and cancelling apart, unpriced and discount notes, "Unknown" or "None". It is absent when the payload has no `mrr` (old fixtures), so the panel renders as before |
| `app/admin/finance/financeCopy.ts` | Tab, subscriptions-block and Recurring-now strings. None names a mode |
| `app/admin/components/AdminSidebar.tsx` | Money's Subscriptions item removed (the unused `CreditCard` import too) |
| `next.config.js` | `/admin/subscriptions` → `/admin/finance?tab=plans`, `permanent: false` |
| `app/admin/subscriptions/page.tsx` + its render test | **Deleted.** The redirect serves the path. `subscriptionsCopy.ts` and `SubscriptionsTable.tsx` stay (used by the tab and the users drawer) |
| `lib/business-os/entitlements/__tests__/enforcementPoints.test.ts` | `financeMrr.ts` registered as a non-gate importer (`EntitlementConfig`, `getEntitlementConfig`), per the `business-os-entitlements` skill |

### Ruled pins

| Pin | Before | After |
|---|---|---|
| **AC-145** `EXPECTED_SHA256` (`route.test.ts`) | `39b35743527b3a1948efd30c3ebc2510eb0916301baa4ea8f2e0210d7e1556ea` | `30275c298fa4cb265ffe8933dee56c71d4243c171c39eddbe1d2e55d64950631` |
| AC-145 `EXPECTED_KEYS` | ends `paymentProblems` | ends `paymentProblems`, `mrr`, `stripeMode` |
| `route.test.ts` file (sha256, LF) | `8fb18b3c…` | `225e6ea1…` |
| AC-173 Part B (`buildQuerySchema` text) | `da268284…d87f` | **unchanged** (`da268284…d87f`) |
| AC-173 file and helper, Pins A, B, C (and helper), D | as before | **unchanged** |

The AC-145 test now proves the bytes changed **only** by the two keys. With `mrr` and `stripeMode` stripped, the payload hashes to the old `39b35743…56ea`, and the older M-4 and 6a hashes still reproduce after that. The MRR read is faked at its module (`@/lib/admin/billing/financeMrr`), and the test asserts it was called once with `null`.

**Other ruled test edits:**
- the "returns every section" key list (+2 keys);
- the finance-filter spec keys (+`status`) and Clear patch (+`status: ''`);
- the tabs list (three tabs);
- the tab keyboard test (wraps over three);
- the sidebar nav test (Subscriptions gone; on-disk count 30 → 29, listed 29 → 28);
- the M-5 redirect count (2 → 3).

### Deviations for SA

- **D-1:** AC-173 Part B is not moved. The Plans tab sends the Overview request, and a `tab=plans` request would have moved Part C (not ruled). The tab's own request literal is pinned in this slice's test (T-4: `/api/admin/business-os/finance?preset=this_month`).
- **D-2 (superseded by SA-CR-MK4 CR-1, below):** the mode-wording guard is not narrowed. Every mode word on the tab comes from `subscriptionsCopy.ts`, outside the scanned tree, so the strict rule holds unchanged. T-5 pins C-4: no mode words anywhere on the Overview or outside the subscriptions block.
- **D-3:** the status filter is a Finance URL key (`status`, tab-only) rather than local state, so old `?status=` links survive the redirect. This replaces the workplan's local-state plan.
- **D-4:** Revenue shows MRR in the panel's current format ("USD 147.00"). The Plans tab keeps the old page's `formatMinorAmount` ("$147.00"). MK-5 aligns both with the `$`-only switch.

### Tests added

- `financeMrr.test.ts` (8): MRR equals `buildSubscriptions` totals for the same rows; past due and cancelling shown apart; discount never priced; a live key reads live rows only; one business by id; no row gives ok with no line; an unknown key gives zero reads; a failed or throwing read gives `unknown`.
- `route.test.ts` "Money MK-4" (5): no MRR read on 401, 403 or 400; all-businesses read with `null`; a picked business read with its id; the info line has no figure.
- `financePage.render.test.tsx` "Money MK-4" (8):
  - T-3: one fetch on load;
  - T-3 / T-4: the tab adds exactly one subscriptions fetch, and the finance request is the Overview literal;
  - a deep link with `status`;
  - T-5 (C-4);
  - T-6 Recurring now: lines, Unknown, None, and absent;
  - a subscriptions error stays inside the block;
  - leaving the tab drops `status`.
- `subscriptionsRedirect.config.test.ts` (4): the shape; through Next's `prepareDestination` with no query, with `status`, and with a bad status.

### Runs

| Run | Result |
|---|---|
| `app/admin/finance` | 21 suites, 719 passed |
| `app/admin/subscriptions` | no tests left (the page test moved) |
| `lib/admin/billing` | 4 suites, 66 passed |
| `lib/business-os/finance` (finance source guard included) | 20 suites, 2007 passed |
| Finance route | 2 suites, 127 passed |
| `app/admin/components` (nav test, Pin A) | 26 suites, 846 passed |
| Vocabulary guard | 182 passed |
| Layout (C-14) and contrast guards | 2 suites, 482 passed |
| Range-cap guard | 21 passed (no new `.limit`; no baseline change) |
| routerPlacement and `app/admin/users` | 29 suites, 712 passed |
| `app/api/admin/business-os/billing` | 2 suites, 42 passed |
| `test:authz-guard` | 2 suites, 203 passed |
| `test:bos-entitlements` | 297 suites, 9002 passed (after the registration) |
| `lint:hooks` | exit 0 |
| ESLint on the changed source files | clean |
| Scoped tsc with a canary (14 files) | TS2322 at `financeMrr.ts(114,7)`. Restored byte-identical (sha256 `d1cc2bcb…8caf`), and the clean run had 0 errors in scope |
| Full `npm test` | 1592 suites (1564 passed, 20 failed, 8 skipped) and 40,474 tests (40,269 passed, 140 failed, 65 skipped). The failing set is **identical** to the 20-suite Windows baseline |

**`console.*`:** 0 in every touched source file.


### SA-CR-MK4 fixes (Fix Required, 2026-10-19)

- **CR-1 (Medium), fixed by Dev. This replaces D-2.** The tab used to show mode words by importing copy from outside the Finance tree, which the guard could not see. Two changes close that:
  - **MK4-FU-1, done:** `app/admin/subscriptions/subscriptionsCopy.ts` moved to `app/admin/finance/plansCopy.ts`, and `components/SubscriptionsTable.tsx` moved to `app/admin/finance/components/SubscriptionsTable.tsx`. The code is unchanged, apart from the import paths and the copy header. `app/admin/subscriptions/` no longer exists. `PlanBillingBlock.tsx` and its test import from the new path.
  - **The SA-4 allow-list in `finance.source.guard.test.ts`**, which is explicit:
    - `MODE_ALLOWED_FILES = ['app/admin/finance/plansCopy.ts']`, the only tab file whose code names a mode;
    - `MODE_ALLOWED_CONSTANTS = { 'app/admin/finance/financeCopy.ts': ['REVENUE_RECURRING_TEST_KEY_LABEL'] }`. Exactly that one declaration is stripped before the scan, and nothing else in the file.
  - **The tests:**
    - the allow-list is UI-only (never `lib/`, the route or the repository), every entry exists and is scanned, the allowed constant is declared exactly once and really carries mode words, and the allowed file really needs its entry (no stale entries);
    - **planted controls:** (a) a mode string in a non-allowed page file is caught; (b) a second mode constant beside the allowed one in `financeCopy.ts` is caught; (c) the allowed constant's declaration in another file is not stripped, so it is caught; (d) planted `lib/`, route and repository entries are refused;
    - `lib/business-os/finance/**` gets its own test: no mode and no `livemode`, with no allowance at all. The repository-wide `livemode` rule is unchanged.
  - **Live mutation:** a `'Stripe live mode'` constant planted in `PlansSubscriptions.tsx` failed the guard on that file. The file was restored byte-identical.
- **CR-2 (Medium), fixed by Dev.**
  - Revenue's "Recurring now (MRR)" heading carries a neutral `StatusChip` "Stripe test mode" (`REVENUE_RECURRING_TEST_KEY_LABEL`) only when `stripeMode === 'test'` and the MRR read is `ok`. It shows nothing with a live key or an unknown MRR.
  - `RevenuePanel` takes `stripeMode`, and `FinanceView` passes `data.stripeMode`.
  - Revenue received (plans and boosts parts) is never labelled (BD-20, tested).
  - T-5 now asserts the mode words appear only on that chip and in the subscriptions block.
  - A new CR-2 test covers test (chip), live (none) and unknown (none).
- **Pins:** only AC-145 moved (`30275c29…0631`, unchanged by these fixes). AC-173 file, helper and Part B (`da268284…`), and Pins A to D are unchanged.

**Re-runs:**

| Run | Result |
|---|---|
| `app/admin/finance` | 21 suites, 728 passed |
| Vocabulary guard | 182 passed |
| Layout (C-14) and contrast guards | 484 passed (the moved files are walked; no `text-slate-500`) |
| Finance source guard, with the mode allow-list and its planted controls | 1239 passed |
| `lib/admin/billing` | 66 passed |
| Finance route | 127 passed |
| `app/admin/users` | 673 passed |
| Sidebar nav | 32 passed |
| `test:authz-guard` | 203 passed |
| `test:bos-entitlements` | 297 suites, 9004 passed |
| `lint:hooks` | exit 0 |
| ESLint on the touched files | clean |


### QA-MK4-1 and QA-MK4-2 fixes (2026-10-19)

- **QA-MK4-1 (Medium), fixed by Dev.** The three TS2741 errors (missing `status`) are fixed:
  - `financeFilters.test.ts` `parseLink` now returns `status: read(S.status)`, and its `DEFAULTS` gain `status: ''`;
  - `financeFilterBar.layout.render.test.tsx` `DEFAULTS` gain `status: ''`;
  - one more expectation surfaced by the same change: the Accounts-tab bridge (`fromFinanceQuery` never sets `status`) now states `status: undefined`.

  **Why my earlier tsc missed them:** its config listed only the files I had edited, not every test that types a `FinanceFilters` object. The new config uses globs and covers **121 root files**:
  - `app/admin/finance/**/*.{ts,tsx}` (every source and test file, both redirect tests included);
  - `lib/admin/billing/**/*.ts`;
  - `app/api/admin/business-os/finance/**/*.ts`;
  - `lib/business-os/finance/**/*.ts`;
  - `app/admin/users/components/PlanBillingBlock.tsx` and `app/admin/users/__tests__/planBillingBlock.render.test.tsx`;
  - `app/admin/components/AdminSidebar.tsx` and `app/admin/components/__tests__/AdminSidebar.nav.test.ts`;
  - `lib/business-os/entitlements/__tests__/enforcementPoints.test.ts`;
  - `next-env.d.ts`.

  The canary planted in `financeFilters.test.ts` gave TS2322 at `(317,7)`. The file was restored byte-identical (sha256 `387a95bd…bfdc`), and the clean run had **0 errors** in scope. `app/admin/finance`: 21 suites, 728 passed.
- **QA-MK4-2 (Low), fixed by Dev.** The duplicated block (the doc header and §1 to §7) was pasted into the D-4 line. The cause was a `String.replace` replacement string holding `` $` ``, which means "the text before the match". The block is removed and D-4 reads as intended. Later inserts use `slice`, never a replacement string.


## SA Review Notes

### SA Code Review (MK-4)

**Code Review by SA, 2026-10-19. Reviewed: the uncommitted tree on `feature/admin-money-mk4-plans-subscriptions-mrr` (from main `4583d21e`).**
**Status: Code Approved (SA-CR-MK4, after the CR-1, CR-2 and FU-1 re-check, 2026-10-19).** It was first Fix Required on CR-1 and CR-2.

**Re-check (SA).**
- **CR-1:** the mode wording is allow-listed to `plansCopy.ts` and one `financeCopy` constant, with planted controls. `lib/business-os/finance/**` still names no mode (an SA grep for `livemode|test.?mode|live.?mode` in its non-test sources finds nothing).
- **CR-2:** the "Recurring now" line shows "Stripe test mode" from that one allowed constant, in test mode only.
- **FU-1 is done.** `app/admin/subscriptions/` is gone, and no importer still names it. The users drawer's `PlanBillingBlock.tsx` imports its words from `app/admin/finance/plansCopy.ts`; the drawer's rule forbids only `lib/business-os` imports.
- **Only AC-145 moved** (`30275c29…`). SA recomputed the seven pins: `3a1a2dd4` `b84e0c96` `30f5fc24` `24ff0da7` `98ea0507` `02813360` `1f7cf07a`.
- **Tests:** SA re-ran `app/admin/finance`, `app/admin/users`, the finance route, the finance source guard, `lib/admin/billing`, `app/admin/components`, `app/admin/__tests__` and FF-1d: **4318 passed**.

#### Rulings on the five questions

| # | Ruling |
|---|---|
| 1. AC-173 part B unmoved | **Correct; my pin row over-predicted it.** `tab=plans` is a **page-only** URL key: `toFinanceQuery` still sends `tab` only for `accounts` (`financeFilters.ts:161`). The Plans & subscriptions tab therefore sends the unchanged Overview request, and its list reads the existing subscriptions route on opening. The route's query schema is untouched, so part B's hash cannot move. `status` is also page-only, never sent to the finance route. The AC-173 table and its helper are byte-identical (hashes below) |
| 2. "Stripe test mode" (C-4) | **The tab renders it** (`PlansSubscriptions.tsx:136-137` `MODE_BADGE[data.mode]`, `:167` `TEST_KEY_NOTE`), but **through a path the Finance guard cannot see**: the words are imported from `app/admin/subscriptions/subscriptionsCopy.ts`, outside the scanned Finance tree, instead of the explicit allow-list SA-4 ruled. **The "Recurring now" MRR line renders no mode label at all** (`RecurringNowPart.tsx:11`, "No Stripe mode is named here"), although it is the current-mode MRR placed beside both-mode cash: the exact disagreement C-4 exists to explain. **See CR-1 and CR-2** |
| 3. Deleting `/admin/subscriptions` | **Acceptable.** A temporary `next.config.js` redirect to `/admin/finance?tab=plans` keeps the query (`?status=…`, tested in `subscriptionsRedirect.config.test.ts`). The sidebar and nav test are updated (Money loses the entry; the "not on disk" check is ruled). No layout or contrast registry lists the path (SA grep of `layout/__tests__` and `app/admin/__tests__`). The P-8a page test is removed with the page, and its content cases move to the Finance page test. Keeping a stub page would only duplicate the redirect |
| 4. MRR equal to Subscriptions | ✅ **Equal by construction.** `subscriptionsMrr()` (`subscriptionsView.ts`) is now the one function both `buildSubscriptions` and `financeMrr.ts` call: the same P-8a reader, the same current mode, the same catalog price and `computeMrr`. A mode or read failure gives `unknown`, never 0 |
| 5. Past due | ✅ Counted (`MRR_COUNTS_PAST_DUE`) and shown apart on the "Recurring now" line (`REVENUE_RECURRING_PAST_DUE`), with cancelling apart too. The "not counted" note is only reachable if the switch is ever false |

#### Fixes before QA sign-off

- **CR-1 (Medium): make the mode-wording path explicit, as SA-4 ruled.**
  - In `finance.source.guard.test.ts` (or the app Finance guard), add an **allow-list**: the only Finance files that may render Stripe-mode wording are `PlansSubscriptions.tsx` and the MRR-line file (CR-2).
  - Add a rule that **no other file under `app/admin/finance/`** imports `MODE_BADGE`, `TEST_KEY_NOTE` or any mode copy, with a planted control.
  - `lib/business-os/finance/**` stays mode-free (unchanged).
  - Importing the words from outside the scanned folder without that allow-list is a bypass, even though the guard passes.
- **CR-2 (Medium): label the "Recurring now" line with the mode.**
  - Show "Stripe test mode" from the payload's `stripeMode`, through the same one copy constant as the tab (LL-4), when the mode is test, and nothing in live (C-4).
  - **Revenue received keeps no label** (BD-20).
  - Add a render test for test, live and unknown mode (the line shows Unknown when `stripeMode` is null).

#### Follow-up (Low, recorded, not blocking)

- **MK4-FU-1:** `app/admin/subscriptions/` is now a page folder with no page, holding `subscriptionsCopy.ts` and `components/SubscriptionsTable.tsx`. Finance and the users drawer (`PlanBillingBlock.tsx`, P-8a.2) import from it. Move them to a neutral shared admin folder (the `app/admin/components/jobs/` precedent, for example `app/admin/components/billing/`) in MK-8 or the next tidy, with the CR-1 allow-list kept.

#### Confirmed

| Item | Result |
|---|---|
| `requireAdmin` first | ✅ The finance route's gate and order are unchanged. MRR is read after the builder; for a picked business, only once its plan row is found (no read for an id that is not a business). The subscriptions route keeps its own `requireAdmin` |
| Repositories and paging | ✅ `BusinessOsBillingAdminReadRepository` only (keyset ≤ 1,000, ceiling error; `findBillingRowForAccount` for a picked business). The FF-1d `rangeCap` guard passes |
| AC-145 | ✅ One ruled re-freeze: `39b35743…` → `30275c29…`. Stripping `mrr` and `stripeMode` reproduces the old hash |
| Pins A to D, AC-173 | ✅ SA recomputed: `3a1a2dd4` `b84e0c96` `30f5fc24` `24ff0da7` `98ea0507` `02813360` `1f7cf07a` |
| Entitlements | ✅ `financeMrr.ts` (`getEntitlementConfig`) is registered as a non-gate importer, and `enforcementPoints` passes |
| Guards and tests | ✅ SA ran `app/admin/finance`, the finance route, `lib/admin/billing`, `app/admin/components`, `app/admin/__tests__` (vocabulary, contrast, layout), `app/admin/users`, the finance source guard, FF-1d and `enforcementPoints`: **4405 passed** |

#### Code Approved for QA: Yes (CR-1, CR-2 and FU-1 met and re-checked)

## QA Testing Report

**QA — 2026-10-19** (worktree `neuronforge-finance-m8`, branch `feature/admin-money-mk4-plans-subscriptions-mrr` on `4583d21e`, uncommitted; on the **final** tree: CR-1, CR-2 and FU-1 applied, source stable since 17:16, all suites re-run after it)
**Test mode:** full
**Strategy used:**
- **A + B:** Jest suites and guards, run one at a time.
- A code read of the label sources, the redirect and the guard allow-list.
- A scoped tsc with a canary, then a **wider** tsc over the whole finance tree.

**Focus:** api, ui, security
**Skipped:** the live browser look (user, below).
**Input source:** prompt + workplan + coordinator note (CR-1, CR-2, FU-1)

**Verdict: PASS WITH ISSUES. One Medium bug (QA-MK4-1, type errors, trivial fix) and one Low doc bug (QA-MK4-2).** All behaviour is correct.

### Behaviour

| Item | Result | Evidence |
|---|---|---|
| Overview loads with exactly one request | ✅ | "T-3: the Overview makes ONE request on load, to the finance route only" |
| Revenue "Recurring now" MRR line, past due counted and shown apart | ✅ | T-6 "per currency, past due and cancelling apart"; Unknown, never 0; None; no `mrr` key renders as before |
| MRR equals the old Subscriptions page's for the same data | ✅ | equal by construction: `subscriptionsMrr()` is the one function `buildSubscriptions` and `financeMrr` both call (`financeMrr.test.ts` asserts it) |
| Plans & subscriptions tab: Plan mix on top, list below; the list fetches only on opening, once | ✅ | "a deep link to tab=plans: Plan mix on top, then the subscriptions"; "T-3 / T-4: opening … sends exactly one more request, to the subscriptions route; the finance request is the Overview literal" |
| Status filters work | ✅ | `status` is a Finance URL key, tab-only (D-3); the deep-link status reaches the first read; leaving the tab drops it; Clear resets it |
| `/admin/subscriptions` redirects to the tab | ✅ | `next.config.js:94`, temporary, to `/admin/finance?tab=plans`, with the query kept (`subscriptionsRedirect.config.test.ts` through Next's `prepareDestination`) |
| No dead links | ✅ | the sidebar item is removed (nav test); `app/admin/subscriptions/` no longer exists (FU-1); `/admin/subscriptions` appears in code only in comments and the redirect |
| **"Stripe test mode" ONLY on the MRR line and the tab** | ✅ | The label is rendered in exactly two components: `PlansSubscriptions.tsx` (`MODE_BADGE`, `TEST_KEY_NOTE` from `plansCopy.ts`) and `RecurringNowPart.tsx` (`REVENUE_RECURRING_TEST_KEY_LABEL`). Tests: "T-5 (C-4): shown on the MRR line and the Plans & subscriptions block only"; "CR-2: labelled in test only; a live key or an unknown MRR has no label; **revenue received never** (BD-20)"; AC-55 / BD-13 keep the other Revenue parts free of mode words. It does appear (not "nowhere") |
| CR-1 allow-list | ✅ | `finance.source.guard.test.ts`: `MODE_ALLOWED_FILES = ['app/admin/finance/plansCopy.ts']`, `MODE_ALLOWED_CONSTANTS = { financeCopy.ts: ['REVENUE_RECURRING_TEST_KEY_LABEL'] }`; "the allow-list is explicit, exists, and stays in the page tree"; planted controls "mode words anywhere else in Finance are still caught" |
| Payload: `mrr` and `stripeMode`; AC-145 | ✅ | `EXPECTED_SHA256` `30275c29…0631`; `BEFORE_MK4_SHA256` `39b35743…56ea` is asserted after stripping the two keys; route suite green |
| Pins A to D, AC-173 | ✅ | `3a1a2dd4` `b84e0c96` `30f5fc24` `24ff0da7` `98ea0507` `02813360` `1f7cf07a`, all unchanged |

### Suite runs (each alone, final tree)

| Suite | Result |
|---|---|
| `app/admin/finance` (now holds the old Subscriptions page cases) | 21/21, **728/728** |
| Old subscriptions tests | the page test was moved into `financePage.render.test.tsx` (the "Money MK-4" describe); `app/admin/subscriptions/` is gone |
| `lib/admin/billing` | 4/4, 66/66 |
| `lib/business-os/finance` (incl. the finance source guard with CR-1) | 20/20, 2045/2045 |
| The finance route (AC-145) | 2/2, 127/127 |
| `app/admin/components` (nav, Pin A) | 26/26, 846/846 |
| Vocabulary + layout (C-14) + contrast + range-cap guards | 4/4, 687/687 |
| routerPlacement + `app/admin/users` + `app/api/admin/business-os/billing` | 31/31, 754/754 |
| `npm run test:authz-guard` | 2/2, 203/203 |
| `npm run test:bos-entitlements` | 297/297, 9004/9004 |
| `npm run lint:hooks` | exit 0 |

**Scoped tsc:** a canary in `lib/admin/billing/financeMrr.ts` gave `(114,7) TS2322`; restored with `cp` and checked with `cmp` (identical). **But the clean run does not give 0 errors** (QA-MK4-1).

### Issues Found

#### Bugs (must fix before commit)
1. **QA-MK4-1 (Medium; trivial fix): MK-4 leaves 3 TypeScript errors in 2 test files.**
   - **Errors:** TS2741 "Property 'status' is missing … required in type 'FinanceFilters'":
     - `app/admin/finance/__tests__/financeFilters.test.ts:48` (`parseLink`'s return) and `:51` (`DEFAULTS`);
     - `app/admin/finance/__tests__/financeFilterBar.layout.render.test.tsx:38`, a file MK-4 **did not edit** but broke.
   - **Cause:** D-3 made `status` a required key of `FinanceFilters`.
   - **Why the suites stay green:** Jest passes (ts-jest does not type-check here), and Dev's 14-file tsc scope did not include these files. The same scope was clean before MK-4. No CI job type-checks app tests, so this would ship. CLAUDE.md says "TypeScript errors … fix them anyway".
   - **Steps to reproduce:** `tsc --noEmit` over `app/admin/finance/**` (a scratch config extending the repo's).
   - **Fix:** add `status: ''` in those three places (or `status: read(S.status)` in `parseLink`); then re-run the wide tsc for 0 errors.
2. **QA-MK4-2 (Low, documentation): this workplan is corrupted.**
   - The D-4 deviation stops mid-sentence at line 157 ("MK-5 aligns both with the `").
   - A **second full copy** of the workplan follows there, from the title through §7 Risks.
   - The sentence resumes at "-only switch." (the agent file-write hazard).
   - **Fix:** delete the duplicated block and rejoin the D-4 sentence.

#### Performance
None. MRR reads one mode's billing rows beside the builder; a picked business is read only after its plan row is found.

#### Notes
MK4-FU-1 is done here: the copy and table moved into `app/admin/finance/` (`plansCopy.ts`, `SubscriptionsTable.tsx`), and the users drawer imports from there.

### User browser steps (after merge; signed in as an admin, Stripe test key)
1. **Money → Finance**, Overview. The network panel shows **one** request (`/api/admin/business-os/finance?preset=this_month`).
   - In **Our revenue**, a "Recurring now (MRR)" line shows "USD 79.00" (one subscription) with a "Stripe test mode" chip.
   - "Revenue received" shows **no** mode label.
2. Click the **Plans & subscriptions** tab.
   - Plan mix is on top; the subscriptions list is below, with the "Stripe test mode" chip and the test-key note.
   - Exactly **one** more request goes to `/api/admin/business-os/billing/subscriptions`.
   - The MRR equals the Recurring now line.
3. Pick **Failed** in the status filter: the list narrows and the URL gains `status=failed`. Go back to Overview: `status` leaves the URL.
4. Open the old `/admin/subscriptions?status=failed`: it redirects to the Plans & subscriptions tab with the Failed filter. The Money sidebar has no "Subscriptions" item.

### Final Status
- [ ] All acceptance criteria pass — ready for commit
- [x] Issues found — Dev must fix **QA-MK4-1** (three `status: ''` lines; then the wide tsc reads 0 errors) and should fix **QA-MK4-2** (the workplan duplication) before RM commits. All behaviour checks pass.

## Commit Info

[RM will populate this section]

---

## Change History

| Date | Change | Details |
|---|---|---|
| 2026-10-19 | Created and implemented (Dev) | MRR in the payload via `lib/admin/billing`; Plans & subscriptions tab; redirect; D-1 (Part B not moved), D-2 (guard not narrowed) |
| 2026-10-19 | SA code review | Fix Required (SA-CR-MK4): CR-1 explicit allow-list for Finance mode wording (no import bypass); CR-2 Stripe-mode label on the Recurring now line. Part B unmoved is correct (tab=plans is page-only); the page deletion and redirect are fine; MRR equal by construction; past due shown apart; MK4-FU-1 move the orphan copy and table folder |
| 2026-10-19 | SA re-check | Code Approved (SA-CR-MK4): CR-1 allow-list, CR-2 label and FU-1 move verified; lib/business-os/finance has no mode wording; only AC-145 moved; 4318 passed |
