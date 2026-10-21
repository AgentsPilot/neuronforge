# Workplan: Money MK-8, the Finance drawers (Page 1 only)

> **Last Updated**: 2026-10-21

**Developer:** Dev
**Requirement:** [ADMIN_MONEY_KPI_RESTRUCTURE_REVIEW.md](/docs/requirements/ADMIN_MONEY_KPI_RESTRUCTURE_REVIEW.md) §12 MK-8; §3 drawer column (Finance); §3.4 USD-1 to USD-6; §8; Q-7 (accepted); SA-RR-MK SA-5 ("Reuse `useDrawerResource`… no new shared export") and the pins table (MK-8: "AC-145 only if a payload key is added"); FIN NG-1 (read-only), BD-23 (actions stay in Businesses)
**Branch:** `feature/admin-money-mk8-finance-drawers` (from main `ff4a676f`; MK-7 #491 and Exchange rates #492 merged)
**Date:** 2026-10-21
**Status:** Code Complete
**Path:** Full cycle. It adds one read-only admin route (the plan drawer) and no migration.

## Overview

Finance gains two read-only side drawers (Q-7: a quick look from a list, with "Open full view" for today's page):

| Drawer | Opens from | Shows |
|---|---|---|
| **Business drawer** | Accounts tab rows; Plans & subscriptions → Subscriptions rows; the AI cost top accounts, Credits and Client payments rows (SA-CR-MK8 CR-2) | Today's account summary for that business in the page's window: what it paid us (plans, boosts, total), AI margin, charged and recorded AI cost, credit position; its client payments in **its own currency sign** (USD-4); its overdue items. From a subscription row, the read-only **Plan billing** panel (P-8a.2) too. "Open full view" goes to today's picked-business page |
| **Plan drawer** | Plans & subscriptions → "Paid accounts" per-plan entries | One plan: its MRR (per currency, `$`), its accounts by status, and its accounts list (status, plan bought, plan on record, paid through) |

**Out of scope, recorded:**
- The **AI cost business drawer** and the **billing-period drawer** are Page 2. The user stopped before Page 2; they follow the MK-2 and MK-3 review.
- **"Run leak check"** belongs to AI cost (Page 2).
- Revenue has no per-business rows that open a business, so it gets no opener (SA-CR-MK8 CR-2).

## 1. Code facts (at `ff4a676f`)

| # | Fact | Where |
|---|---|---|
| CF-1 | `useDrawerResource(key, read)` gives one read per key, abort on close, and no stale frame. `AdminDrawer`, `DrawerSection`, `DrawerFields` and `OpenRowButton` are the shared shell | `app/admin/components/layout/` |
| CF-2 | The finance route with `accountId=` returns today's picked-business payload (header, summary, takings, payment problems), and the page's request serialiser builds it | `app/api/admin/business-os/finance/route.ts`, `financeUrl.ts` `serialiseFinanceUrl` |
| CF-3 | `AccountHeader` and `AccountSummary` render that payload. `accountViewHref` is the full-view link | `app/admin/finance/components/`, `financeLinks.ts` |
| CF-4 | `PlanBillingBlock` is the read-only Plan billing panel. It reads on demand, `GET /api/admin/business-os/billing/accounts/[accountId]` | `app/admin/users/components/PlanBillingBlock.tsx` |
| CF-5 | The subscriptions payload's `rows` are capped at 200 and its totals cover all plans, so a plan drawer cannot be cut from it | `lib/admin/billing/subscriptionsView.ts` |

## 2. Design

### 2.1 Business drawer: no new read (reuse, Rules)

**`BusinessDrawerProvider`** (in `FinanceView`) holds one drawer and exposes `openBusiness({ accountId, name, withBilling }, opener)` through context. A table renders its opener only when the provider is present, so standalone renders are unchanged.

**The read.** `useDrawerResource(key, readBusinessDrawer)`:
- The key is `accountId|serialised window`.
- The read calls `GET /api/admin/business-os/finance?<the page window>&accountId=<id>`, the existing route with the existing serialiser, so no route, schema or payload changes. It runs only when the drawer opens.
- The route already enforces requireAdmin, Zod, the plan-row check (404), tenant isolation to the picked id, and the paging ceilings.

**The body, in order:**
1. `AccountHeader` and `AccountSummary`, the same components as the picked view.
2. "Client payments": `takings` lines in the business's **own currency sign**, through a new `formatOwnCurrency` (Intl currency style; unknown codes fall back to `formatMoney`) (USD-4, Q-10).
3. The overdue invoices and instalments, as counts.
4. `PlanBillingBlock`, when opened from a subscription row. It stays read-only and on demand.
5. "Open full view", which links to `accountViewHref`.

The drawer has no action buttons (§8, NG-1, BD-23). Its only controls are the plan-billing open and refresh (reads) and the links.

### 2.2 Plan drawer: one new read-only route

`GET /api/admin/business-os/billing/plans/[planId]`:

- **Order:**
  1. requireAdmin, the first statement;
  2. Zod on the path (`^[a-z0-9_-]{1,64}$`, strict, no query keys);
  3. the plan id must be in `config.tierOrder` (404 `plan_not_found`; no tier literal anywhere);
  4. the current Stripe mode (409, as Subscriptions);
  5. the two existing reads (the one-mode billing read, keyset ≤ 1,000 per request with the ceiling an error, and the plan walk);
  6. the pure builder;
  7. names for the shown rows only (the admin identity read, `app/api/admin/**` only).
- **No new repository method.** The subscriptions wiring (`subscriptionsDeps`) is reused.
- **No secret column.** The P8A-R3 column set is reused: no checkout lock, no bearer link, no Stripe id.
- **Pure builder.** New `buildPlanSubscriptions({ ...SubscriptionsInput, planId })` in `subscriptionsView.ts`. It filters the inputs, then calls `buildSubscriptions` once, so one rule makes both lists:
  - the billing rows whose `bought_tier` is the plan;
  - the plan rows of those accounts (for status and paid-through);
  - plan rows on the plan with no billing row of any plan in this mode ("No Stripe").
- **Payload:** `SubscriptionsPayload` (types unchanged), with `totals.mrr` for this plan only. The rows are capped at 200, and `matching` is "showing n of m". It is logged with counts only. The response is `no-store`.

**The client.** `planDrawerRead.ts` is the reader, with the key equal to the plan id. `PlanDrawer.tsx` renders MRR per currency (`$` for USD through the existing `formatMinorAmount` path), the status counts, and `SubscriptionsTable` with the rows (no openers inside the drawer).

### 2.3 Rules kept

| Rule | How it is kept |
|---|---|
| One fetch on load (AC-173) | Both drawers read only on open |
| The page request is the pinned literal | Unchanged |
| `$` (USD-1..6) | MRR and summary use the existing formatters; client payments use their own sign (USD-4) |
| Mode wording | Only in `plansCopy.ts` / `PlansSubscriptions.tsx` (the allow-list). The plan drawer names no mode |
| Pins | **No payload key is added**, so AC-145 (`23a12c7e`) does not move. Pin B, Pin A, AC-173, C and D are unchanged |

## 3. Files

| File | Action |
|---|---|
| `lib/admin/billing/subscriptionsView.ts` | `buildPlanSubscriptions` |
| `app/api/admin/business-os/billing/plans/[planId]/route.ts` | **new** route |
| `app/api/admin/business-os/billing/plans/[planId]/__tests__/route.test.ts` | **new** |
| `app/admin/finance/drawerReads.ts` | **new**: both readers in one file (`readBusinessDrawer`, `readPlanDrawer`, `businessDrawerKey`) |
| `app/admin/finance/plansMoney.ts` | **new**: the MRR line formatters, moved out of `PlansSubscriptions.tsx` so the plan drawer prints MRR the same way |
| `app/admin/finance/components/BusinessDrawer.tsx`, `PlanDrawer.tsx` | **new** |
| `app/admin/finance/components/FinanceView.tsx` | Provider |
| `AccountEconomicsTable.tsx`, `SubscriptionsTable.tsx`, `PlansSubscriptions.tsx` | Openers |
| `app/admin/finance/financeCopy.ts`, `financeFormat.ts` | Drawer words; `formatOwnCurrency` |
| Tests | `lib/admin/billing/__tests__/subscriptionsView.test.ts` (plan builder); `app/admin/finance/__tests__/financeDrawers.render.test.tsx` (new); updates where a table's columns changed |

## 4. Tests

- **Plan builder:**
  - only that plan's billing rows are counted, and its MRR equals `subscriptionsMrr` over those rows;
  - "No Stripe" plan rows are included;
  - an account billed on another plan is excluded;
  - the cap is 200 and `matching` is the full count;
  - the plan ids come only from config.
- **Plan route:**
  - 401 and 403 with no read;
  - a bad id (400);
  - an unknown plan (404);
  - the mode is unknown (409);
  - a read fails (500);
  - 200 with names for the shown rows only;
  - `no-store`;
  - the log has no id or name;
  - the source has requireAdmin first and no write verb.
- **Drawers (render):**
  - closed on load: one fetch, the pinned literal;
  - opening an Accounts row gives one request, the finance route with `accountId` and the page window;
  - the drawer body shows the header, the summary, client payments with `₪` for ILS and `$` for USD, and "Open full view" with the full-view href;
  - from a subscription row, the Plan billing panel shows closed, with no request until it is opened;
  - the plan drawer gives one request, to the plan route, and shows MRR `$`, the statuses and the rows;
  - an error shows the shared error;
  - close returns focus;
  - no action buttons.
- **Guards:** vocabulary, layout, contrast, finance source, USD copy, and authz (the new route).

## 5. Risks

| Risk | Mitigation |
|---|---|
| A business-drawer request equal in shape to the picked-view request could be confused with it in the request pins | It is sent only on open; AC-173's load-time pins are unchanged, and the drawer test pins its own URL |
| Table column changes move render tests | Only the Subscriptions table gains an opener column; the Accounts table puts the opener in its existing last cell |
| Plan filter edge cases (a mismatched plan row) | Unit-tested; one rule (`buildSubscriptions`) after the filter |

## 6. Estimate

About 2.5 days: builder and route 0.5, drawers 1, tests 0.75, runs 0.25.

## 7. Task List

- ✅ Step 1: Plan builder, with tests
- ✅ Step 2: Plan route, with tests
- ✅ Step 3: Readers, drawers, provider, openers
- ✅ Step 4: Render tests
- ✅ Step 5: Runs and pins

## Implementation Notes

**Built as designed.** Notes:

- **N-1. The readers.** Both are in one file, `drawerReads.ts`. The MRR formatters (`money`, `mrrParts`) moved, unchanged, to `plansMoney.ts`, and are shared by `PlansSubscriptions` and `PlanDrawer`.
- **N-2. The Accounts-row opener** is an `OpenRowButton` in the row's existing last cell, before "Open", so the column set is unchanged. Platform rows and rows with no plan row have no opener.
- **N-3. The Subscriptions table** gains the narrow LF-8 "Details" column, but only when `onQuickLook` is passed. The plan drawer reuses the table without it.
- **N-4. The plan openers** are the existing "Paid accounts" words, each now a button. The text is unchanged ("1 Plan A 1"); the tooltip reads "Open plan …".
- **N-5. The business drawer's provider** is given no window when a business is already picked, so a picked view has no openers.
- **N-6. AC-145 does not move.** No payload key is added: the business drawer reads today's picked-business payload, and the plan drawer has its own route.
- **N-7. Out of scope**, as recorded in the Overview:
  - the AI cost business drawer and the billing-period drawer (Page 2, after MK-2 and MK-3);
  - "Run leak check";

**SA-CR-MK8 fixes (Dev, 2026-10-21):**

- **CR-1 (Medium), one account in two plan drawers. Fixed by Dev.**
  - **Cause:** `planBilling` matched `bought_tier` on any billing row, so a stale `bought_tier` on a row with no subscription status put the account in that plan's drawer, while its plan row also put it in its own plan's drawer as "No Stripe".
  - **Fix:** `buildPlanSubscriptions` now uses ONE predicate, `isBilled` (this mode and a subscription status), for both `billedAnyPlan` and `planBilling`.
  - **The list and MRR agree.** This is the Subscriptions list's own predicate (`subscribed` in `buildSubscriptions`). MRR (`subscriptionsMrr` / `computeMrr`) counts paying statuses only, so a status-less row was never in MRR. The plan drawer, the list and MRR therefore agree.
  - **QA's probe is now a permanent test,** plus a second test: every listed account is in exactly one plan drawer, and the drawers' USD MRR adds up to the list's (`subscriptionsView.test.ts`).
- **CR-2, the openers are built** (MK8-FU-1 is closed). New `BusinessQuickLook` is in `BusinessDrawer.tsx`: an `OpenRowButton` inside each row's business cell, so no column is added and no text either (the icon has an accessible name).
  - It is on the AI cost top accounts (`ai-top-quick-look-<id>`), the Credits rows (`credits-quick-look-<id>`) and the Client payments rows (`takings-quick-look-<id>-<currency>`).
  - It is never on the platform account, a deleted account or an unidentified business, and never with a business picked.
  - Each opens the same business drawer (without Plan billing).
  - The tile and section links are unchanged, and the page still makes one fetch on load.
  - Tests: 5 page cases in `financePage.render.test.tsx` (placement, no platform opener, the column counts unchanged, one more request per opener, none with a business picked).
- **Re-runs after the fixes:**
  - `app/admin/finance`: 26 suites, 892 tests.
  - `lib/admin/billing`: 5 suites, 80 tests.
  - The plan route: 16 tests.
  - The guards: 7 suites, 2,349 tests.
  - The pins: 6 suites, 216 tests; AC-145 is `23a12c7e` and no pin file changed.
  - Scoped tsc: 405 files, 0 errors; the canary gave TS2322, and the file was restored byte-identical.

**Pins.** All unchanged, and no pin file differs from main:
- AC-145 is still `23a12c7e`.
- Pin A is as on main.
- Pin B is `a1b3db0c`.
- AC-173 is `3a1a2dd4` / `b84e0c96`.
- C is `98ea0507` / `02813360`.
- D is `1f7cf07a`.

**Tests added:**
- 6 plan-builder cases in `subscriptionsView.test.ts`.
- 16 cases for the new route.
- `financeDrawers.render.test.tsx`, 9 cases: the openers; one read on open with the pinned URL; the key shape; the plan drawer's read, contents and read-only state; `formatOwnCurrency`.
- 3 page cases in `financePage.render.test.tsx`: one fetch on load; the business drawer from a subscription row, with the ₪ and $ client lines, Plan billing closed, "Open full view" and no action button; the plan drawer from "Paid accounts".

### Runs

| Run | Result |
|---|---|
| `app/admin/finance` | 26 suites, 887 tests |
| `app/admin/components` | 26 suites, 878 tests |
| `lib/admin/billing` | 5 suites, 78 tests |
| `lib/business-os/finance` | 21 suites, 2,194 tests |
| `lib/repositories` | 113 suites, 2,750 tests |
| Finance and billing routes, the new plan route included | 5 suites, 189 tests |
| `app/admin/users` (`PlanBillingBlock` reused) | 28 suites, 673 tests |
| Guards (vocabulary, layout, contrast, range-cap, finance source, USD copy, Finance source) | 7 suites, 2,349 tests |
| Pins | 6 suites, 216 tests |
| `test:authz-guard` | 203 tests |
| `test:bos-entitlements` | 301 suites, 9,166 tests |
| `lint:hooks` | Clean |
| Scoped tsc | 405 files, including the 4 touched test files, 0 errors. The canary gave TS2322, and the file was restored byte-identical |

**Full gate:** 21 suites and 141 tests failed. That is exactly the known Windows-only set: the 20-suite baseline plus `upgradeModal.guard`.

**Logging:** there are no `console.*` calls in any touched file.

## SA Review Notes

### SA Code Review (MK-8, Finance drawers)

**Code Review by SA, 2026-10-21. Reviewed: the uncommitted tree on `feature/admin-money-mk8-finance-drawers` (from main `ff4a676f`).**
**Status: Code Approved (SA-CR-MK8, after the CR-1 / CR-2 re-check, 2026-10-21).** It was first Fix Required on CR-1 and CR-2.

**Re-check (SA).**
- **CR-1.** `buildPlanSubscriptions` now uses one predicate, `isBilled`: current mode **and** `subscription_status !== null`. It applies to both `billedAnyPlan` and `planBilling`, so each account lands in exactly one plan drawer. **The Subscriptions list and MRR are unchanged for every account:** the diff touches no line of `buildSubscriptions` or `subscriptionsMrr`, and `subscriptionsMrr` already used the same predicate since MK-4. Only the plan-drawer split changes, and only for the stale-tier case. QA's probe is now a permanent test.
- **CR-2.** The AI cost top-10, Credits and Client payments rows open the same `BusinessDrawer`, with one request on open and still one fetch on load.
- **Pins.** No pin file and no route test differs from HEAD.
- **Tests.** SA ran `app/admin/finance`, `lib/admin/billing`, the billing routes, `app/admin/__tests__` and `app/admin/components`: **2735 of 2736 passed**. The one failure was QA's parallel page probe `zz_mk8_page_probe.render.test.tsx` under load (132 s); **run alone it passes 200 of 200**.

#### 1. The new route `GET /api/admin/business-os/billing/plans/[planId]`

| Item | Result |
|---|---|
| `requireAdmin` first | ✅ It is the first statement of `GET`. The route is on the authz surface (`app/api/admin/**`): `test:authz-guard` passes 203 of 203 with no allow-list edit |
| Input validation | ✅ The path is Zod-checked by **shape** (`^[a-z0-9_-]{1,64}$`), then checked **against the configured tiers** (`config.tierOrder.includes`, 404 `plan_not_found`). There is no tier literal. Any query key is a 400 |
| Reads | ✅ Only through `subscriptionsDeps` (P-8a's one-mode reader, keyset ≤ 1,000, ceiling error; the plan walk ≤ 1,000), plus names for the shown rows only (≤ 200). The FF-1d guard passes |
| Columns, errors and mode | ✅ The P-8a column lists, with no secret column. The CLAUDE.md error format is used, with development-only `details` and `no-store` on every response. The mode fails closed (409). The log carries counts and the mode only |

#### 2. Tenant isolation, business drawer

✅ The drawer's key is the clicked row's `accountId` in the page's own request shape (`businessDrawerKey`). The read is the **existing** finance route with `accountId`, so all of its guards apply: UUID, platform 404, then the plan check before any read (SEC-3). No other id is sent, and there is no new route.

#### Defect

- **CR-1 (Medium): an account can appear in two plan drawers.** QA's probe `zz_mk8_probe.test.ts` ("a billing row with no subscription… keeping an old bought plan, and a plan row now on another plan") fails: drawer total 2, list 1. The cause is in `buildPlanSubscriptions` (`subscriptionsView.ts:270-279`):
  - `billedAnyPlan` counts only rows **with a status in the current mode**;
  - but `planBilling` / `planAccounts` take **every** row whose `bought_tier` matches, including a status-null row.

  So the account is in the old plan's drawer (via its stale `bought_tier`) **and** in the new plan's drawer (as "No Stripe", via its plan row). **Fix:** select `planBilling` with the same predicate as `billedAnyPlan`: current mode, `subscription_status !== null`, `user_id` not null. Each account then lands in exactly one drawer, and the drawers sum to the list. Turn QA's probe case into a permanent test in `subscriptionsView.test.ts`, with "the sum over every plan drawer equals the list" as the invariant. QA then deletes its probe file.

#### 3. MK8-FU-1: build the openers now (CR-2)

They are small (about half a day) and complete Page 1, as the user expects for review. **Build them in this slice** wherever a Page 1 block lists businesses:
- the **AI cost** top-10 rows (`AiCostSection.tsx:179`);
- the **Credits** per-account rows (`CreditsSection.tsx:202`);
- the **Client payments** by-business rows (`TakingsSection.tsx`).

Each opens the same `BusinessDrawer` (one read on open, the same key). **Revenue** lists no businesses in the all-businesses view (its lines are per currency and per package), so it gets no opener. If a per-business list appears there later, it gets one then. Use a real button or link on the business name (not a whole-row click), keyboard-reachable, as on the Accounts rows. Add one render test per block: opening sends exactly one request with that row's id.

#### Confirmed

| Item | Result |
|---|---|
| AC-173 (one fetch on load) | ✅ Both drawers are closed on load. The page tests and the AC-173 pin are unedited and green |
| One pinned fetch each, on open | ✅ The business drawer sends one finance request with that account (`financeDrawers.render.test.tsx:116`), and the plan drawer one request to the plan route (`:170`). Closed means no request. The Plan billing panel inside stays closed until opened (P-8a.2) |
| Read-only (NG-1, BD-23) | ✅ No action buttons; "Open full view" links to the picked-business page |
| Pins | ✅ No pin file and no route test differs from HEAD, and AC-145 is unchanged (no new payload key) |
| Guards | ✅ `app/admin/finance`, the billing routes, `lib/admin/billing`, `app/admin/__tests__` (vocabulary, contrast, C-14), `app/admin/components` and FF-1d: **2550 of 2551 passed**. The one failure is QA's probe (CR-1) |
| Low note | The drawer shows a business's client payments with the currency **code** ("ILS 230.30") rather than its sign (`₪`) as USD-4 describes. That is acceptable (exact and never mixed). A sign map is optional polish |

#### Code Approved for QA: Yes (CR-1 and CR-2 met and re-checked)

## QA Testing Report

**QA — 2026-10-21** (worktree `neuronforge-finance-m8`, branch `feature/admin-money-mk8-finance-drawers` on `ff4a676f`, uncommitted). This report covers the **final tree, after CR-1 and CR-2**: the source has been stable since 11:28, and every suite below was re-run from 11:39 on.
**Test mode:** full
**Strategy used:**
- **A + B:** every suite and guard, each run alone.
- A code read of the route, the builder, both drawers and the openers.
- **Three temporary, untracked QA probes, deleted afterwards** (`git status` is clean of `zz_*`):
  - **(1) The plan builder against the list,** on the real config: a mixed fixture, the stale-`bought_tier` case, and a **500-fixture randomized check** across modes, statuses, null and retired plans.
  - **(2) The drawers in isolation, with real `user-event`:** reads, Escape, focus.
  - **(3) A page-level case:** a **second** business's row (Beta Clinic, not Acme) through the real `FinanceView`.
- A scoped tsc with a canary.

**Focus:** api, ui, security
**Skipped:** the live page (user, below).
**Input source:** prompt + workplan + coordinator note (CR-1, CR-2)

**Verdict: PASS. No open bugs.** QA's first-run finding, an account in two plan drawers, became SA's **CR-1 (Medium)**. It is **fixed and re-verified** (below).

### Behaviour

| Item | Result | Evidence |
|---|---|---|
| Business drawer opens in place and reads only on open, once | ✅ | Probe 2: **0 requests** before opening. Opening gives **1** request: the finance route with `accountId` and the page's own window (`preset=last_30_days` carried). Re-opening after closing reads once more (a fresh read; `useDrawerResource`). Page test: from a Subscriptions row, the URLs are exactly `[finance, subscriptions, finance&accountId=A]` |
| Contents: paid to us, charged AI cost and margin, credits, client payments in own currency, overdue counts | ✅ | The body is the picked view's own `AccountHeader` and `AccountSummary` (the same components, so the figures cannot differ). Client payments: "gross **₪230.30** · net **₪215.30**" (ILS) and "gross **$150.50** · net **$130.50**" (USD), one line per currency, never summed. `formatOwnCurrency` falls back to the code for an unknown currency (drawer test: ₪, $, €, an unknown code). The overdue invoices and instalments are counts, "at least" when cut and Unknown on failure |
| "Open full view" goes to the picked-business page, same window | ✅ | `href = accountViewHref(id, data.window)`, the response's own window. Page test: `/admin/finance?preset=this_month&accountId=A`. Probe 3: `…accountId=B` for Beta Clinic. The key test covers a custom window's dates |
| From a Subscriptions row: Plan billing, closed until opened | ✅ | Page test: a "Show plan billing" button is shown, and the request count stays at 3 (no billing-account read). From the other rows there is **no** Plan billing panel (CR-2 `it.each`) |
| Read-only, no action buttons | ✅ | Page test: the drawer's only buttons are "Show plan billing" and Close. There is no write verb in any new file, and the route source test pins "no write, no audit, no Stripe call" |
| **CR-2: the three new openers** (AI cost top-10, Credits, Client payments) | ✅ | Page tests: each opens the business drawer with **exactly one more request**, on top of **one fetch on load**; there is no opener on the platform row, and the column count is unchanged (3 on the AI top table). **Probe 3, right business:** on the Client payments row for **Beta Clinic (B)** (Acme is in the same table), the opener's name is "Quick look at Beta Clinic". The request is `…&accountId=B`, the drawer heading and account header are Beta Clinic (`title = B`), and "Open full view" is `…accountId=B`. Escape closes it, and **focus returns to that row's button**. Total requests: 2. With a business picked, there are no openers on the page |
| Plan drawer: accounts, statuses, MRR, equal to the Subscriptions list | ✅ | The builder narrows the inputs and calls the list's own `buildSubscriptions`, so it is one rule. **Probe 1 (final tree):** on a mixed fixture, each account is in **exactly one** drawer, the drawers' accounts and per-status counts **sum to the list's** `totals.accounts` and `byStatus`, and each drawer's `paidByPlan` entry equals the list's. The route test covers one plan's MRR only. In the page test the MRR line is `$49 …` |
| **CR-1: plan-drawer membership (re-verified)** | ✅ | **Before the fix:** a billing row with `subscription_status: null` (as `replaceCustomer` leaves it after a deleted Stripe customer) and `bought_tier` = the old plan, with the plan row now on another plan, showed in **both** plans' drawers (2 against the list's 1). **After `isBilled`:** it is in its plan-on-record drawer only (0 + 1 = 1 = list). **500 random fixtures:** no account appears in two drawers; every drawer row is a list row; the only list rows in no drawer are subscribed accounts with **no recorded plan** (`planBought` null), which have no plan to open; every `paidByPlan` entry matches |
| Unknown `planId` refused cleanly | ✅ | Route tests: a well-formed but unconfigured id gives **404** `plan_not_found` before any read, with the sentence "That plan is not one of the configured plans."; a bad shape gives **400**; any query key gives **400**. The id is compared with `config.tierOrder`, with no tier literal (source test) |
| Non-admin refused | ✅ | Route tests: **401** with no session and **403** for a signed-in non-admin, both **before any read**. `requireAdmin` is the first statement (source test, and `test:authz-guard` green) |
| No secret columns | ✅ | The route test asserts no Stripe id, checkout lock or invoice link in the body. `SubscriptionRow` carries none (code read). The log line has counts and the plan id only, never an account id or a name (route test) |
| Escape closes and focus returns to the row | ✅ | Probe 2 (real keyboard): **business drawer** and **plan drawer** each close on Escape, and `document.activeElement` is the opener button again. Probe 3: the same on the page from a Client payments row |
| Page load: exactly one fetch | ✅ | Page tests (AC-173 kept, and the CR-2 openers): `['/api/admin/business-os/finance?preset=this_month']` only. AC-173 `3a1a2dd4` / `b84e0c96` are unchanged |
| A picked business | ✅ | Probe 2: `window={null}` gives a null context, so no opener anywhere. Page test: 0 `quick-look` elements |
| Pins unchanged | ✅ | No pin or `*Pins.ts` file differs from HEAD, and nothing tracked under `app/api` does. AC-145 is still `23a12c7e`; Pin B `a1b3db0c`; AC-173 `3a1a2dd4` / `b84e0c96`; Pin C `98ea0507` / `02813360`; Pin D `1f7cf07a`. Pin A reads `e4331716`, **main's** current value (no diff on this branch) |

### Suite runs (each alone, final tree)

| Suite | Result |
|---|---|
| `app/admin/finance` | 26/26, **892/892** (887 before CR-2) |
| `app/admin/components` | 26/26, 878/878 |
| `lib/admin/billing` | 5/5, **80/80** (CR-1's test included) |
| `lib/business-os/finance` | 21/21, 2194/2194 |
| `lib/repositories` | 113/113, 2750/2750 |
| Routes: finance and billing, including the new plan route | 5/5, 189/189 |
| `app/admin/users` (`PlanBillingBlock` reused) | 28/28, 673/673 |
| Guards: vocabulary, contrast, layout folder, range-cap, finance source (lib and app), USD copy | 7/7, **2349/2349** |
| `npm run test:authz-guard` | 2/2, 203/203 |
| `npm run test:bos-entitlements` | 301/301, 9166/9166 |
| `npm run lint:hooks` | exit 0 |

**Scoped tsc:**
- Scope: `app/admin/finance/**`, `app/admin/components/**`, `app/admin/users/**`, `app/api/admin/business-os/billing/**`, `app/api/admin/business-os/finance/**` and `lib/admin/billing/**`. That is 437 app and lib files, every touched and new file included.
- The canary in `PlanDrawer.tsx` gave `(93,7) TS2322`. The file was restored with `cp` and checked with `cmp` (identical).
- The clean run: **0 errors**.

### Issues Found
- **Bugs:** none open. CR-1 (Medium), first found by this QA run, is fixed, and the fix is verified with a fixed case plus a 500-fixture randomized check.
- **Performance:** none. Both drawers read only on open; the plan route reuses the Subscriptions reads (keyset, ceiling an error).
- **Edge cases (Low, by design):**
  1. A subscribed account whose billing row has **no recorded plan** (`bought_tier` null) is in the Subscriptions list but in **no** plan drawer: there is no plan to open it from. The list still shows it.
  2. An opener on a row whose business has **no plan row** (for example a business deleted since), when its id still appears in a Credits, AI cost or Client payments row, opens a drawer that shows the shared error. The finance route answers 404 for an account with no plan row. It is not a blank or a crash.

### User browser steps (signed in as an admin)
1. **Money → Finance**, Overview. The network panel shows **one** finance request on load.
2. **AI cost** top accounts, **Credits** rows, **Client payments** rows: each business has a small open icon beside its name (none on the platform row). Click one: a side drawer opens **on the same page**, with **one** new request. It shows that business's paid-to-us figures, AI cost and margin, credits, its client payments in **its own currency** (₪ for shekels, $ for dollars) and its overdue counts. There are no action buttons. Press **Escape**: the drawer closes, and focus is back on the icon you clicked.
3. Click **Open full view**: you land on that business's Finance page, in the same window.
4. **Accounts** tab: each row's icon opens the same drawer.
5. **Plans & subscriptions** → Subscriptions: a row's Details icon opens the drawer with a closed **Plan billing** panel. It reads only when you click "Show plan billing".
6. Under "Paid accounts", click a plan name: the **plan drawer** shows its MRR in `$`, its statuses and its accounts. Its accounts and statuses match that plan's rows in the Subscriptions list. Escape closes it.
7. Pick one business: no drawer icons appear.

### Final Status
- [x] All MK-8 behaviours pass on the final tree (CR-1 fixed and re-verified, CR-2 openers verified with the right business). The payload and pins are unchanged. **Ready for RM.**
- [ ] Issues found

## Commit Info

[RM will populate this section]

---

## Change History

| Date | Change | Details |
|---|---|---|
| 2026-10-21 | Created (Dev) | Finance drawers only; Page 2 drawers and the extra openers recorded as out of scope |
| 2026-10-21 | Implemented (Dev) | Business drawer (Accounts and Subscriptions rows), plan drawer and its read-only route; no pin moved |
| 2026-10-21 | SA code review | Fix Required (SA-CR-MK8): CR-1 one account in two plan drawers (planBilling must use the billedAnyPlan predicate; QA probe becomes a test); CR-2 build the drawer openers on the AI cost top-10, Credits and Client payments rows (Revenue has none). Route, isolation, one fetch, pins and guards approved |
| 2026-10-21 | SA-CR-MK8 fixes (Dev) | CR-1 one billing predicate (QA probe now a test; list, MRR and drawers agree); CR-2 openers on AI cost top accounts, Credits and Client payments rows; MK8-FU-1 closed |
| 2026-10-21 | SA re-check | Code Approved (SA-CR-MK8): one isBilled predicate for both plan lists; the Subscriptions list and MRR are untouched (no line of buildSubscriptions or subscriptionsMrr changed); openers on 3 blocks with one fetch on open; QA page probe passes alone |
