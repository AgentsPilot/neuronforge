# Workplan: Business OS Plan Payments, P-8a (Admin billing panel and subscriptions list)

> **Last Updated**: 2026-10-18

**Developer:** Dev
**Requirement:** [BUSINESS_OS_PLAN_PAYMENTS_REQUIREMENT.md](/docs/requirements/BUSINESS_OS_PLAN_PAYMENTS_REQUIREMENT.md): §7 AM-1, AM-2, AM-3, AM-7 and the "Data source" line; §9.1 P-8a row; PF-15 (C-9); SA-P1, SA-P5, SA-P8, SA-P16 (b); SA-5 (BQ-P6 struck: MRR included); F4 rows 1 to 3; AC-AM.1, AC-AM.2, AC-AM.4, AC-F4.1. Cross-stream: [BUSINESS_OS_FINANCE_HEALTH_REQUIREMENT.md](/docs/requirements/BUSINESS_OS_FINANCE_HEALTH_REQUIREMENT.md) §0.1 rows 5 and 5b, BD-14, BD-16, BD-19, BD-21, BD-23, SA-Q5, SA-F2.
**Depends on:** P-3b merged (#251, #299: billing record mirror, money history). P-6a merged (#405, #416: `failed_attempts`, `last_payment_failed_at`, `ended_at`, grace margin in `deriveLifecycle`).
**Date:** 2026-10-18
**Branch:** `feature/bos-plan-payments-p8a`, worktree `neuronforge-finance-health`, fresh from `origin/main` `f7429b57` (#462). Confirmed with `git branch --show-current` on 2026-10-18. Highest migration on that main: `20261079`.
**Status:** SA APPROVED WITH CONDITIONS (SA-WP-P8a). **P-8a.1 Code Approved (SA-CR-P8a.1), QA passed; committed `5c31cb92`, PR [#466](https://github.com/AgentsPilot/neuronforge/pull/466) opened 2026-10-18, auto-merge on.** P-8a.1 MERGED (#466). **P-8a.2 Code Approved (SA-CR-P8a.2), QA passed; committed `56afcbe3`, PR [#467](https://github.com/AgentsPilot/neuronforge/pull/467) opened 2026-10-18, auto-merge on.** P-8a.3 not started.

## Overview

P-8a gives admins two read-only views of plan billing, built only from our own stored records (no Stripe call):

- **The billing panel (AM-1)** in the Businesses drawer. It shows one account's Stripe subscription, as mirrored on the billing record, next to its plan row, with a "they disagree" flag and a link to the customer in the Stripe dashboard. An account with no subscription reads "No Stripe subscription" (AC-F4.1).
- **The subscriptions list (AM-2) and its totals (AM-3)** on a new **Subscriptions** page in the Money sidebar section. It has one row per account, filters by status, and shows totals: paid accounts per plan, in grace, paused, cancelling, and **MRR per currency**. Every row and figure covers the current Stripe mode only (PF-15).
- **MRR is one pure rule** (`lib/business-os/billing/planMrr.ts`). Finance slice 5b imports the same rule later and must not define a second one (BD-19). §4 says how each kind of account counts. The points the requirement leaves open are BQ-P8a-1 to BQ-P8a-6, each with a default.
- **AM-7**: a coverage pin. Every money event that already exists is checked against its registered audit event, and the events that are not built yet are listed with the slice that owns them. One small gap that P-8a can close is in §5.6.

**Production after merge:** live and read-only. The list shows whatever current-mode billing rows exist, and is empty until there are any. Today the only rows are the user's own Stripe test-mode purchases. **No migration, no new table, no write path, no new pattern** except where §12 asks SA.

**Size: about 3.0 dev-days**, over the 2-day line, so §9 proposes three numbered PRs, never stacked.

---

## Table of Contents

1. [Code facts (as-built on `f7429b57`)](#1-code-facts-as-built-on-f7429b57)
2. [Spec vs code mismatches](#2-spec-vs-code-mismatches)
3. [Scope](#3-scope)
4. [The MRR rule](#4-the-mrr-rule)
5. [Implementation approach](#5-implementation-approach)
6. [Files to create / modify](#6-files-to-create--modify)
7. [Task list (mapped to ACs)](#7-task-list-mapped-to-acs)
8. [Tests and guards](#8-tests-and-guards)
9. [Split and estimate](#9-split-and-estimate)
10. [User browser steps](#10-user-browser-steps)
11. [Risks](#11-risks)
12. [Questions for SA](#12-questions-for-sa)
13. [Business questions (with defaults)](#13-business-questions-with-defaults)
14. [SA Review Notes](#sa-review-notes)
15. [QA Testing Report](#qa-testing-report)
16. [Commit Info](#commit-info)

---

## 1. Code facts (as-built on `f7429b57`)

Stream state, checked first: **no plan-payments PR is open**, and every `origin/feature/bos-plan-payments-*` branch is an ancestor of `origin/main`. The newest plan-payments work on main is P-6a.2 (#416). P-6b, P-7a, P-7b.2, P-8b, P-11 and P-13 are not built. Nothing here touches unfinished work from that stream. **Open elsewhere:** Finance follow-ups FF-1 is PR #463, which is not merged yet. It carries the FF-1d 1,000-row guard (`lib/repositories/__tests__/rangeCap.source.guard.test.ts`). P-8a is written to pass it whether it lands before or after.

### 1.1 Columns (business-os-schema-check: read from the migrations)

| Table | Columns P-8a reads | Source |
|---|---|---|
| `business_os_billing_accounts` | `id` (PK), `user_id` (nullable, FK `ON DELETE SET NULL`), `livemode` (NOT NULL), `stripe_customer_id`, `stripe_subscription_id`, `subscription_status` (CHECK: `incomplete`, `incomplete_expired`, `trialing`, `active`, `past_due`, `canceled`, `unpaid`, `paused`), `bought_tier`, `current_period_end`, `cancel_at_period_end`, `pending_tier`, `last_invoice_id`, `last_paid_at`, `last_payment_failed_at`, `failed_attempts`, `founder_discount_applied_at`, `ended_at`, `updated_at` | `20261025_business_os_billing_accounts.sql`. **UNIQUE (`user_id`, `livemode`)**, so there is at most one row per account per mode. Index (`livemode`, `subscription_status`). There is **no currency column and no amount column**. Never selected: `open_checkout_*` and `action_required_invoice_url`, which is a bearer link to the owner's invoice. |
| `business_os_billing_events` | `user_id`, `livemode`, `kind`, `stripe_invoice_id`, `amount_minor`, `amount_tax_minor`, `currency` (CHECK `= 'usd'`), `paid_at`, `plan_written` | `20261027_business_os_billing_events.sql`. `amount_minor` is Stripe's `amount_paid`, so it includes tax and a proration (`planInvoiceFacts.ts:19`). **No `billing_reason` column.** |
| `business_os_account_plans` | `user_id`, `tier`, `tier_expires_at`, `cohort`, `cohort_expires_at`, `origin`, `updated_by_admin_id`, `period_anchor` (plus the lifecycle inputs `fromPlanRow` takes) | `20261005_business_os_entitlements.sql:83-138` |

### 1.2 What already exists and is reused

| Fact | Where |
|---|---|
| The "paying" set `['active', 'past_due']` plus `ended_at` NULL, for P-8a to adopt (SA-Q5). Its test checks it against the CHECK list. **It does not filter mode** (BD-14) | `lib/business-os/billing/payingSubscriptionStatuses.ts` |
| The current mode from the key prefix. It **throws** on a missing or unknown key | `lib/business-os/billing/stripeMode.ts` (`currentStripeMode`) |
| SA-F2: every admin read of a money table lives in the read-only `BusinessOsFinanceReadRepository`. The billing-account writer repository has an **exact caller list**, which P-8a must not join | `lib/repositories/BusinessOsFinanceReadRepository.ts` header; `BusinessOsBillingAccountRepository.test.ts:843` |
| R-c reads all accounts, but only 4 columns, both modes, and **skips `user_id` NULL**. R-c′ uses `maybeSingle` with no mode filter, so it errors once an account has both a test row and a live row | `BusinessOsFinanceReadRepository.ts:495`, `:549` |
| Placement rule: files in `lib/business-os/billing/` may not import the data layer, type-only imports included, unless allow-listed | `payingSubscriptionStatuses.ts` header; `app/api/stripe/webhook/__tests__/routerPlacement.guard.test.ts` |
| Lifecycle per plan row (grace, paused, after the 24 h margin), with the precedent of a pure all-accounts classifier registered as a non-gate importer | `lib/business-os/entitlements/lifecycle.ts` `deriveLifecycle`; `lib/business-os/finance/planGroups.ts` |
| Plan rows of all accounts, keyset-paged (at most 1,000) | `BusinessOsAccountPlanRepository.pagePlans`, `findEntitlementInputsBatch` |
| List prices `presentation.<tier>.monthlyPriceUsd` (79, 129), checked against Stripe by `check-bos-plan-prices` (SA-P12) | `lib/business-os/entitlements/config/tierMatrix.ts`; `lib/business-os/billing/planPriceCheck.ts` |
| Grouping by currency, never one cross-currency sum | `lib/business-os/finance/currencyGroups.ts` `groupByCurrency` |
| Stripe dashboard links, mode-aware (`/test/`), for `payment` and `dispute` only | `lib/business-os/boost/boostAdminView.ts:104-125` |
| Tenant pattern for a caller-supplied account id: UUID → platform account (409) → `isBusinessOsTenant` → reads | `app/api/admin/business-os/accounts/[accountId]/summary/route.ts` |
| Admin layout: `AdminPageHeader`, `AdminFilterBar`, `KpiStrip`, `StatusChip`, `useAdminFilters`, `AdminStates`, `adminTable`, `adminFormat.formatUtc` | `app/admin/components/layout/` |

### 1.3 The Businesses drawer today (what is shown, to avoid duplication)

`BusinessOsPanel.tsx` has three boxes:

- **Credits & billing**: the Credits and Credit top-ups blocks.
- **Plan & entitlements**: `EntitlementSnapshot`, collapsed.
- **AI usage**.

There is also an "Open money view" link to `/admin/finance?accountId=…`. The Finance M-2 money view already lists **plan payments received** per account (`PlanRevenuePart.tsx`, read R-m′). **Nothing in the drawer shows the Stripe subscription**: no status, renewal date, cancelling state or failed attempts. So the panel adds the subscription side and the latest payment only, and links to the money view for the payment list. It does not repeat that list.

### 1.4 Money-event audits that exist (AM-7)

| AM-7 event | Registered event | Emitted by |
|---|---|---|
| Checkout started | `BOS_BILLING_CHECKOUT_STARTED` | `app/api/business-os/billing/plan/checkout/route.ts` |
| Paid / plan assigned / upgraded (by `billingReason`) | `BOS_BILLING_INVOICE_PAID` | `recordPlanChange` via `planPaymentApply.ts` |
| Payment refused | `BOS_BILLING_PAYMENT_REFUSED` | plan billing handler |
| First payment stamped | `BOS_BILLING_FIRST_PAYMENT_STAMPED` | `planPaymentApply.ts` |
| Upgrade requested | `BOS_BILLING_UPGRADE_REQUESTED` | `.../plan/upgrade/route.ts` |
| Failed (renewal), 3-D Secure renewal | `BOS_BILLING_PAYMENT_FAILED`, `BOS_BILLING_PAYMENT_ACTION_REQUIRED` | P-6a.2 handler |
| Ended | `BOS_BILLING_SUBSCRIPTION_ENDED` | P-6a.2 handler |
| Downgrade scheduled | none | **P-7b.2** (not built) |
| Cancelled, reactivated | none | **P-7a** (not built) |
| Refund or dispute flagged | none | **P-6b** (not built) |
| Admin override on a subscribed account | `BOS_ENTITLEMENT_TIER_ASSIGNED` / `_OVERRIDE_ADDED` are written, **but they do not say the account was subscribed** | gap; see §5.6 |

---

## 2. Spec vs code mismatches

| # | Spec says | Code / later decision says | Proposed |
|---|---|---|---|
| M-1 | AM-1: the panel goes on "the account inspect view on `/admin/business-os-tiers`"; AM-2: "a new tab on `/admin/business-os-tiers`" | Admin Layout LF-2 **removed the account lookup** from Plans & entitlements; the drawer is its only user (`EntitlementSnapshot.tsx:9`). **BD-23** (user, 2026-10-14) puts the panel in the Businesses drawer and the list, totals and MRR in the Money area | Follow BD-23, which is the later user decision. BA to correct §7's "Where" column (a text fix, §12 Q-1) |
| M-2 | Finance §11 "Paying (BD-4)" (line 478): "a `livemode = true` row" | `payingSubscriptionStatuses.ts` says "Mode is not filtered: test and live rows both count (BD-14)", and R-c reads both modes | P-8a filters on the **current** mode (PF-15), which is neither. The MRR rule takes the mode as a **parameter**, so 5b chooses deliberately. BQ-P8a-6 |
| M-3 | Finance BD-16: "one billing row per account" | The schema allows two (UNIQUE (`user_id`, `livemode`)). R-c′ (`maybeSingle`, no mode) fails once an account has both | P-8a's reads always filter `livemode`, so they are immune. Flagged to Finance, not fixed here (§11 R-5) |
| M-4 | P-6a carry-forward U-10: a money-history display "must label it by `billing_reason`" | `business_os_billing_events` has **no `billing_reason` column**. A migration is out of P-8a's row | P-8a shows **no money-history list**. The panel's failure fields come from the billing record, which P-6a writes on renewals only (U-10 already applied). U-10 stays carried to P-7a and to any later history view |
| M-5 | AM-3: MRR is the "sum of net USD amounts of active subscriptions" | No amount is stored per subscription. `amount_minor` is the last `amount_paid` (tax and proration included) | The rule prices each subscription from the catalog's monthly list price for `bought_tier` (§4). BQ-P8a-1 |
| M-6 | The as-built inventory (2026-10-03) says no admin billing surface exists | It is stale: P-3b to P-6a added the mirror columns. Nothing contradicts P-8a | No change. Noted for the BA |

---

## 3. Scope

| In | Out (owner) |
|---|---|
| Pure MRR rule plus its test pins (§4) | MRR on the Finance page (FIN **5b**, which imports this rule) |
| `GET /api/admin/business-os/billing/subscriptions`: the list and totals, current mode | Stripe-side reconciliation, the "flag until they agree" from Stripe (AC-F4.2's flag, AM-5: **P-8b**) |
| `GET /api/admin/business-os/billing/accounts/[accountId]`: the panel | The F4 warning when an admin changes the tier of a subscribed account (AC-F4.2 first half): no tier-change UI exists in admin today. Recorded for P-8b and the BA |
| New page `/admin/finance/subscriptions` and a Money sidebar entry "Subscriptions" | Admin actions on Stripe (AM-8, later); alert emails (AM-9) |
| Panel in the drawer's Credits & billing box, a "Stripe dashboard" link, a "No Stripe subscription" state | A money-history list, because of the U-10 / `billing_reason` mismatch (M-4) |
| AM-7 coverage pin; a `subscribed` detail on admin plan changes (§5.6) | Audits for cancel, reactivate, downgrade, refund and dispute (P-7a, P-7b.2, P-6b) |
| A test-key note, as BoostBlock has | Any migration; any live Stripe API call |

---

## 4. The MRR rule

**File:** `lib/business-os/billing/planMrr.ts`. It is pure. It imports nothing from the data layer (the placement rule) and nothing from the entitlements module. Prices and the mode are passed in, so the rule holds no tier literal and needs no registration. Only the route's wiring passes the catalog price.

```typescript
export interface MrrBillingRow {
  livemode: boolean;
  subscription_status: string | null;
  ended_at: string | null;
  cancel_at_period_end: boolean;
  bought_tier: string | null;
  founder_discount_applied_at: string | null;
}
export interface MrrPrice { currency: string; monthlyMinor: number }   // excluding tax (BQ-P5)
export interface MrrInputs { livemode: boolean; priceOf: (tier: string) => MrrPrice | null }

/** One line per currency, never one cross-currency total. */
export interface MrrLine {
  currency: string;
  amountMinor: number;              // counted subscriptions
  subscriptions: number;
  ofWhichCancellingMinor: number;   // still counted, shown separately
  ofWhichPastDueMinor: number;      // still counted, shown separately
}
export interface MrrResult {
  lines: MrrLine[];
  unpriced: number;           // counted status, but no monthly price for bought_tier: never 0, never guessed
  discountUnknown: number;    // carries a founder discount whose amount is not recorded (BQ-P8a-2)
  otherModeExcluded: number;  // rows of the other mode: proof PF-15 filtered, never shown as money
}
export function computeMrr(rows: Iterable<MrrBillingRow>, inputs: MrrInputs): MrrResult;
/** The per-row classification, exported so the list and 5b give the same answer. */
export function mrrTreatment(row: MrrBillingRow, inputs: MrrInputs): MrrTreatment;
```

**Counted** means: `livemode === inputs.livemode` **and** `isPayingBillingRow(row)` (adopts `PAYING_SUBSCRIPTION_STATUSES` = `active`, `past_due` with `ended_at` NULL, per SA-Q5; never `LIVE_SUBSCRIPTION_STATUSES` or `R3_LIVE_STATUSES`). **Amount** = `priceOf(bought_tier).monthlyMinor`: the list price, excluding tax, from the same catalog the checkout is checked against (SA-P12). Currency comes from that price. Lines are grouped with `groupByCurrency`, so a second currency is never summed into the first.

| Account kind | How it counts in MRR | In the list | Basis |
|---|---|---|---|
| Active subscription (`active`, not cancelling) | Counted, at the list price of `bought_tier` | Active | AM-3 |
| **Cancelling at period end** (`active` + `cancel_at_period_end`) | **Counted until it ends**, shown as "of which cancelling" | Cancelling | **BQ-P8a-3** (default: count, as Stripe does) |
| **`past_due`** (renewal failed, Stripe retrying) | **Counted**, shown as "of which past due" | Failed, plus In grace once the lifecycle says so | **BQ-P8a-4** (default: count; it is in the SA-Q5 paying set) |
| `unpaid`, `paused` (Stripe), `incomplete`, `incomplete_expired`, `canceled`, or `ended_at` set | Not counted | Ended, or "Other: <status>" | Not money coming in |
| **Trial** (Test Flight cohort, no Stripe) | Not counted; it has no billing row | Not listed (BQ-P8a-5) | BQ-P2: a trial that buys becomes `active` and is counted |
| Stripe `trialing` (a Founding Partner subscribed ahead of their cohort end, SA-P16c) | Not counted until the first non-zero invoice makes it `active` | "Other: starting <period end>" | SA-P16c: the $0 invoice assigns nothing |
| **Founding Partner, free** (cohort, no Stripe) | Not counted ($0) | Not listed (BQ-P8a-5) | — |
| **Founding Partner paying with the founder discount** (P-11, not built) | Today `founder_discount_applied_at` is never set, so this does not arise. Once it is set, the row is counted in **`discountUnknown`**, not at list price | Active, marked "discount" | **BQ-P8a-2** |
| **Comped / admin-assigned** (plan row tier, no subscription in this mode) | Not counted ($0) | No Stripe | AM-2 "No Stripe (admin-assigned)"; "an admin assignment with no payment is a comp" (§10) |
| **Annual plan** | Out of scope (Q-B8); no annual price exists. A `bought_tier` with no monthly price is **`unpriced`**: counted by number, never by amount | As its status | **BQ-P8a-1** (default for later: monthly-normalise, amount ÷ 12) |
| Scheduled downgrade (`pending_tier`) | At the **current** `bought_tier` until the renewal is paid | As its status, marked "downgrade to X on <date>" | RD-7: the lower price starts at the next renewal |
| Row detached from a deleted account (`user_id` NULL) | Counted if paying (money is still taken), labelled "deleted account" | Listed, with no business link | PF-14 makes it rare |
| Other mode's rows | Never counted; only `otherModeExcluded` is shown, as a number | Not listed | PF-15 |
| Unknown key mode (`currentStripeMode` throws) | **No MRR at all**: the route answers `stripe_mode_unknown` and the page says so. It never guesses a mode | Not listed | Fail closed |

**Why list price and not the last paid invoice:** `amount_minor` is `amount_paid`. It includes tax, a prorated upgrade charge, and any customer-balance credit, so the last payment is not the recurring amount. The list price is what the subscription renews at (RD-1, L-9: fixed prices, no per-customer price). Its one weakness is a future price change for existing subscribers (§11 R-2, §12 Q-3).

---

## 5. Implementation approach

### 5.1 Reads (in `BusinessOsFinanceReadRepository`, SA-F2)

Two new read-only methods in the file that already holds the admin money reads. The billing writer repository's caller list does not change.

- **R-p `listBillingRowsForModeAllAccounts({ livemode, pageSize ≤ 1000, ceiling })`**: selects `ADMIN_BILLING_ROW_COLUMNS` (the §1.1 list, without `open_checkout_*` or `action_required_invoice_url`). It filters `.eq('livemode', livemode)` and keyset-pages on **`id`** (the PK), not on `user_id`, so detached rows are included. Reaching the ceiling is an error, never a partial list (as R-c).
- **R-p′ `findBillingRowForAccount(accountId, livemode)`**: UUID-guarded, `.eq('user_id', accountId).eq('livemode', livemode).maybeSingle()`. The UNIQUE (`user_id`, `livemode`) constraint makes `maybeSingle` safe.
- Plan rows: the list uses `BusinessOsAccountPlanRepository.pagePlans` (keyset, at most 1,000), and the panel uses `findEntitlementInputs`. No new plan-repository method.

The source-pin test for the finance repository (no insert, update, upsert, delete or rpc call) still holds. The finance route's frozen payload pins (§8.3) are unaffected: the finance route calls neither method.

### 5.2 View builders (in `lib/admin/billing/`)

They live there because `lib/business-os/billing/` may not reach the data layer and the builders need the plan-row type. This matches `lib/admin/health` and `lib/admin/jobs`.

- `subscriptionsView.ts` (pure): `(billingRows, planRows, config, now, mode, priceOf) → { rows, totals, mrr }`.
  - **Status per row** (the chip uses the first match): Ended (`ended_at` set, or `canceled` / `incomplete_expired`) → Paused (lifecycle `paused`) → In grace (lifecycle `grace`) → Failed (`failed_attempts > 0`, which P-6a sets on renewals only and clears on a paid renewal) → Cancelling → Active (paying) → Other (`trialing`, `incomplete`, `unpaid`, `paused`).
  - **Filters** are memberships, so an account can be both Failed and In grace.
  - **No Stripe** rows are plan rows whose tier is in force (lifecycle basis `tier`) and that have no subscription in this mode.
  - **Totals (AM-3):** paid accounts per bought plan (labelled by `planLabel`), in grace, paused, cancelling, failed, no Stripe, and MRR from `computeMrr`.
  - **Rows:** the business name (after the page is cut), plan bought, plan in force, status, paid-through (`tier_expires_at`), next renewal (`current_period_end`, or "Ends on" when cancelling), last payment (`last_paid_at`), failed attempts, and "downgrade to X". The list is capped at 200 rows, as the Finance Accounts tab is, with "showing 200 of N" (§12 Q-5).
- `billingPanelView.ts` (pure): `(billingRow | null, planRow, config, now) → panel`. It returns both columns side by side and a **stored-mirror disagreement flag**. The flag is raised when the subscription is paying and any of these holds: `bought_tier` differs from the plan row's tier; `current_period_end` differs from `tier_expires_at`; or the plan has no tier in force. Each finding is reported by name. It is **not** the P-8b reconciliation, which compares against Stripe itself, and the panel says so.
- Both import from the entitlements module (`deriveLifecycle`, `fromPlanRow`, `lifecycleInputs`, `planLabel`, types) for **display only**. Each file is registered as a non-gate importer (§5.5).

### 5.3 Routes (skill `new-api-route`)

Both follow the same order:

1. `requireAdmin` is the **first statement**.
2. Correlation id and `logger.child`.
3. Strict Zod.
4. `currentStripeMode()` inside a try. On failure the route returns `409 stripe_mode_unknown` and logs a warn, never echoing the key.
5. Reads.
6. Pure builder.
7. `{ success: true, data }`, with `Cache-Control: no-store`. Errors use the CLAUDE.md format, with `details` only in development.

- `GET /api/admin/business-os/billing/subscriptions?status=<enum>` (Zod: `status` optional, one of `active | grace | paused | cancelling | failed | ended | no_stripe | other`, `.strict()`, a repeated key gives 400). Totals and MRR always cover the whole current-mode set. `status` filters only the rows. **Tenant isolation:** no caller-supplied id. It is a cross-account service-role read, justified in the code (admin-only, read-only, no owner data beyond the business name, logged at info as the finance reads are).
- `GET /api/admin/business-os/billing/accounts/[accountId]`: the `tenant-isolation-guard` order of the summary route: UUID (400 `invalid_account_id`) → platform account (409 `platform_account`) → `isBusinessOsTenant` (404 `not_a_business_os_account`, 500 `tenant_check_failed`) → reads filtered by that `accountId`. The id is never trusted beyond the check.
- No audit for these reads: they are not money events, and admin reads elsewhere (finance, summary) are not audited. §12 Q-6 asks SA to confirm.

### 5.4 UI

- **Page** `app/admin/finance/subscriptions/page.tsx` (client, under `requireAdminPage` in the layout, as Charge checks is). It uses:
  - `AdminPageHeader` with title "Subscriptions", the "Read-only" chip and "As of";
  - `KpiStrip` with the AM-3 tiles: MRR per currency (one tile per currency, never summed), paid accounts per plan, in grace, paused, cancelling;
  - `AdminFilterBar` and `useAdminFilters` with a `status` URL key;
  - an `adminTable` table with a `StatusChip` per row;
  - `AdminStates` for loading, empty ("No subscriptions in Stripe test mode yet") and error;
  - the test-key note when the mode is test;
  - "Other-mode rows not shown: N".
  
  Each row links to the Businesses drawer through the existing `account` deep link (Finance SA-Q33).
- **Sidebar**: Money gets "Subscriptions" (`/admin/finance/subscriptions`, description "Plan subscriptions and MRR, Business OS") after Finance. It is read-only, so it fits Money's rule ("nothing with action buttons", BD-21). The Money section is the user's recorded exception to the fixed sidebar, and BD-23 placed the list there. **Not on Plans & entitlements:** that page is the plan catalogue and no longer lists accounts (LF-2), and its no-entitlements-import rule (page header) would stop it showing plan-row state. §12 Q-2.
- **Drawer**: a new `PlanBillingBlock.tsx` (its own read, mounted like `BoostBlock`) as the **first** part of the "Credits & billing" box, so the subscription sits beside the credits it funds (BD-23). It shows two columns, "Stripe (mirrored)" and "Plan row", the disagreement flag, the Stripe customer link, an "Open money view" link for the payment list, and the "No Stripe subscription" state. The box's purpose line is reworded within the 12-word rule (DB-3).
- Plan names come only from the server's `planLabel`. The client holds no tier literal.

### 5.5 Entitlements registration (SR-17, skill `business-os-entitlements`)

These are added to `KNOWN_NON_GATE_IMPORTERS`, with `symbols` exactly matching the imports:

- `lib/admin/billing/subscriptionsView.ts`
- `lib/admin/billing/billingPanelView.ts`
- the two routes, only if they import the config getter or the price (`TIER_MATRIX.presentation`) for `priceOf`

`priceOf` is built in one small server file, `lib/admin/billing/planPrices.ts`, so only that file names `TIER_MATRIX`. It holds no tier literal. `npm run test:bos-entitlements` is run before handover.

### 5.6 AM-7

- **T-AM7a**: a coverage pin test (`lib/business-os/billing/__tests__/moneyEventAudit.coverage.test.ts`). It maps each AM-7 event to its registered `AUDIT_EVENTS` key and to the source file that emits it (AST, as the vocabulary guard reads files). The unbuilt events are listed with their owning slice, and the test fails when one of those slices adds its event without updating the map. It writes nothing and is cheap.
- **T-AM7b**: "admin override on a subscribed account". This is the one AM-7 gap inside reach. The admin entitlements route already reads `hasLivePlanSubscription` for `assign_tier`. P-8a adds `subscribed: true | false` to the `details` of `BOS_ENTITLEMENT_TIER_ASSIGNED` and `_OVERRIDE_ADDED`. The flag is read once per write, and the read failing keeps today's 500 for `assign_tier` and stays unrecorded (`null`) for an override. This touches a write path, so it is its own small PR (P-8a.3), and it waits for an SA ruling (§12 Q-7).

---

## 6. Files to create / modify

| File | Action | Reason | Slice |
|---|---|---|---|
| `lib/business-os/billing/planMrr.ts` | create | The one MRR rule (§4) | .1 |
| `lib/business-os/billing/__tests__/planMrr.test.ts` | create | Every row of the §4 table; no cross-currency sum; mode filter | .1 |
| `lib/repositories/BusinessOsFinanceReadRepository.ts` | modify | R-p, R-p′, `ADMIN_BILLING_ROW_COLUMNS` | .1 / .2 |
| `lib/repositories/__tests__/BusinessOsFinanceReadRepository.test.ts` | modify | Columns, `livemode` filter, keyset on `id`, page at most 1,000, ceiling error, UUID guard | .1 / .2 |
| `lib/admin/billing/planPrices.ts` | create | `priceOf` from the catalog presentation (server-only) | .1 |
| `lib/admin/billing/subscriptionsView.ts` (+ test) | create | List, status precedence, filters, totals | .1 |
| `app/api/admin/business-os/billing/subscriptions/route.ts` (+ `__tests__/route.test.ts`) | create | List and totals route | .1 |
| `app/admin/finance/subscriptions/page.tsx`, `subscriptionsCopy.ts`, `useSubscriptionsData.ts` (+ render tests) | create | The page | .1 |
| `app/admin/components/AdminSidebar.tsx`, `__tests__/AdminSidebar.nav.test.ts` | modify | Money entry | .1 |
| `lib/business-os/entitlements/__tests__/enforcementPoints.test.ts` | modify | Non-gate registrations | .1 / .2 |
| `lib/admin/billing/billingPanelView.ts` (+ test) | create | Panel and disagreement flag | .2 |
| `app/api/admin/business-os/billing/accounts/[accountId]/route.ts` (+ test) | create | Panel route | .2 |
| `app/admin/users/components/PlanBillingBlock.tsx` (+ render test), `BusinessOsPanel.tsx`, `DrawerBox.tsx` | create / modify | Drawer panel, purpose line | .2 |
| `lib/business-os/boost/boostAdminView.ts` | modify | Add `customer` (`cus_`) and `subscription` (`sub_`) kinds to `stripeDashboardUrl` (§12 Q-4) | .2 |
| `lib/business-os/billing/__tests__/moneyEventAudit.coverage.test.ts` | create | AM-7 pin | .3 |
| `app/api/admin/business-os/entitlements/accounts/[accountId]/route.ts`, `lib/business-os/entitlements/adminOps.ts` (+ tests) | modify | `subscribed` audit detail (if Q-7 approves) | .3 |
| `docs/requirements/BUSINESS_OS_PLAN_PAYMENTS_REQUIREMENT.md` | modify | §9.1 link (done with this workplan); status after each PR | all |

Files with `console.*`: none of the files listed is known to use it. The check is repeated when each file is opened, per CLAUDE.md § Logging.

---

## 7. Task list (mapped to ACs)

AC-AM.1, AC-AM.2, AC-AM.4 and AC-F4.1 come from the requirement. **AC-P8a.n are proposed here**, because the requirement has none for the MRR cases.

| Task | Does | AC | Slice |
|---|---|---|---|
| ✅ T0 | Re-check the stream (open PRs, main head); confirm FF-1 #463 status | — | .1 |
| ✅ T1 | `planMrr.ts` and its test | AC-AM.2 (MRR, current mode); **AC-P8a.1** each §4 row counts as stated; **AC-P8a.2** never one total across currencies; **AC-P8a.3** other-mode rows only counted, never summed | .1 |
| ✅ T2 | R-p (list read) and its tests | **AC-P8a.4** every request is at most 1,000 rows, keyset on `id`, ceiling is an error | .1 |
| ✅ T3 | `subscriptionsView.ts` (with `catalogPriceOf`, D-3) and tests | AC-AM.2 (each status filter; totals match the records) | .1 |
| ✅ T4 | Subscriptions route and tests (happy path, 401/403, invalid `status`, repeated key, `stripe_mode_unknown`, read failure 500) | AC-SR.5; **AC-P8a.5** unknown mode shows no figure | .1 |
| ✅ T5 | Page, sidebar entry, nav test, render tests (empty, test-key note, filters in URL, one MRR tile per currency) | AC-AM.2 | .1 |
| ✅ T6 | Entitlements registration for .1; `npm run test:bos-entitlements` | SR-17 | .1 |
| ✅ T7 | R-p′, `billingPanelView.ts`, panel route and tests (tenant order, UUID, platform, not a tenant) | AC-AM.1; AC-F4.1; **AC-P8a.6** the disagreement flag names each stored mismatch and says it is not the Stripe check | .2 |
| ✅ T8 | `PlanBillingBlock` in the drawer; dashboard link kinds; purpose line; drawer pins re-run unchanged | AC-AM.1 (dashboard link) | .2 |
| ⬜ T9 | AM-7 coverage pin | AC-AM.4 (coverage of what is built) | .3 |
| ⬜ T10 | `subscribed` detail on admin plan changes (if Q-7 approves) | AC-AM.4 ("admin override on a subscribed account") | .3 |
| ⬜ T11 | Requirement §9.1 row and change history after each PR | — | all |

---

## 8. Tests and guards

### 8.1 Tests

- **Unit (pure):** `planMrr` (a table test over the §4 rows, plus a two-currency fixture that must yield two lines); `subscriptionsView` (precedence, memberships, totals equal the row counts, the 200 cap); `billingPanelView` (no row, no-Stripe comp, each mismatch, a trialing Founding Partner).
- **Repository:** a recorded query builder, as in the existing finance repository test. It checks columns, `.eq('livemode')`, `.gt('id')` paging, `.limit` at most 1,000, the ceiling error, and that no write method is named.
- **Route integration:** happy path, auth failure (401 and 403 through `requireAdmin`), invalid input, `stripe_mode_unknown`, a read failing (500 with no details in production), `no-store`.
- **Render:** page states, the filter URL round trip, the drawer block's states. The `businessDrawer.pins.*` suites pass **unchanged**.

### 8.2 Guards that must stay green

| Guard | What P-8a does |
|---|---|
| `requireAdmin` first statement (admin authz surface guard) | Both routes; the page sits under `requireAdminPage` in the layout |
| FF-1d `rangeCap.source.guard` (PR #463) | Every `.limit` / page size at most 1,000; no `.range`; no baseline entry added |
| Billing-account repository exact caller list | Unchanged (P-8a never names that repository) |
| Webhook router placement guard | New `lib/business-os/billing/` file (`planMrr.ts`) imports no data layer |
| `enforcementPoints.test.ts` (entitlements) | New non-gate entries, symbols exact |
| `aiCostVocabulary.source.guard` | P-8a copy names no AI cost. Its list is unchanged |
| Admin sidebar nav test | Updated in the same PR: Money gains one entry |
| Tier-literal rule | No `'basic'` / `'pro'` outside `entitlements/config/**` |

### 8.3 The 7 Finance frozen pins (unchanged)

P-8a changes neither `app/api/admin/business-os/finance/route.ts`, nor its deps, nor any existing finance read's arguments, nor `financeUrl` / `financeFilters`. So these stay byte-identical: **AC-173** and its parts **A, B, C, D**, and **AC-145** at `39b35743…56ea` (`app/api/admin/business-os/finance/__tests__/route.test.ts:1256`), with its M-4 and 6a companion hashes. QA re-runs the finance route suite and the AC-173 tests on the final diff.

---

## 9. Split and estimate

Three PRs, in order, never stacked. Each is a few days at most and demoable. Not one of them has a migration.

| Slice | Scope title | Done means (demo) | Est. |
|---|---|---|---|
| **P-8a.1** | **MRR rule and the Subscriptions page** | Money → Subscriptions lists the user's test-mode subscription, with the status chip and filters. The tiles show MRR "USD 79.00" (test mode) and 1 paid Essentials account. With the filter "Paused" the list is empty. A test-key note is shown | 1.6d |
| **P-8a.2** | **Billing panel in the Businesses drawer** | Opening the test owner shows "Stripe (mirrored)" next to "Plan row", the Stripe customer link opens the test dashboard, and a comp account reads "No Stripe subscription" | 1.0d |
| **P-8a.3** | **Money-event audit coverage** | The AM-7 pin is green. An admin tier change on the subscribed test account writes `subscribed: true` in its audit details | 0.4d |
| | **Total** | | **≈ 3.0d** (row: 2–3d) |

P-8a.1 goes first because Finance 5b waits on the MRR rule.

---

## 10. User browser steps

On a deployment with the Stripe test key, signed in as an admin:

1. **Money → Subscriptions.** You should see the test owner account (Essentials) as **Active**, the next renewal date, and the last payment date. The tiles should read MRR **USD 79.00**, with "Stripe test mode, not real money" under the header.
2. Pick the **Failed** and **Paused** filters. The list should be empty unless a test-clock renewal failed. The URL keeps the filter after a reload.
3. Click the row. The Businesses drawer opens on that business. In **Credits & billing**, the first part shows the Stripe side and the plan side together, and no "disagree" flag.
4. Click **Open in Stripe**. The test dashboard should open on that customer.
5. Open a business that has no subscription. It should read **No Stripe subscription**.
6. (P-8a.3) In `/test-business-os`, an admin tier change on the subscribed test account; then **Audit trail** shows `subscribed: true` on that entry.

---

## 11. Risks

| # | Risk | Mitigation |
|---|---|---|
| R-1 | MRR is read as real money while production runs a test key | Mode label on the header and tiles; other-mode count shown; BoostBlock's test-key wording reused |
| R-2 | A future price change for existing subscribers makes list-price MRR wrong (grandfathered renewals at the old price) | Out of scope today (§2 "price changes for existing subscribers"). The rule's header and §12 Q-3 say what replaces it (a stored per-subscription amount, which needs a migration) |
| R-3 | The status chip disagrees with the owner's banner | Both read the same columns (`failed_attempts`, lifecycle). The view test pins the same fixtures as `planPaymentNotice` |
| R-4 | Drawer pins break when a part is added to Credits & billing | The block mounts in its own slot, with no key, as BoostBlock does. The pins re-run unchanged. If they pin the part order, the block goes after Top-ups instead |
| R-5 | Finance R-c′ (`maybeSingle`, no mode) errors once an account has both a test and a live row (M-3) | Not P-8a's file; reported to Finance as a follow-up. P-8a's reads filter mode |
| R-6 | The disagreement flag is read as reconciliation | The flag is worded "stored records disagree"; the Stripe-side check is P-8b's |
| R-7 | PR #463 (FF-1d) merges in between and finds a P-8a read | Every read is written at 1,000 or fewer from the start; rebase and re-run before the PR |

---

## 12. Questions for SA

| # | Question | Dev proposal |
|---|---|---|
| Q-1 | Follow BD-23 over §7's "Where" column (M-1)? | Yes; BA fixes the text |
| Q-2 | The list as its own Money page, `/admin/finance/subscriptions`, instead of a Finance tab or Plans & entitlements? | Own page (exact-path highlight, like Charge checks; Finance's URL and payload stay frozen) |
| Q-3 | MRR from the catalog list price per `bought_tier`, rather than the last paid invoice? | Yes (§4 "Why list price"); revisit when prices change for existing subscribers |
| Q-4 | Extend `stripeDashboardUrl` (boost file) with `customer` and `subscription` kinds, rather than a billing copy? | Extend: one rule for dashboard links |
| Q-5 | A 200-row cap on the list (Finance Accounts tab precedent), with totals over the full set? | Yes |
| Q-6 | No audit entry for these admin reads? | Confirm (finance and summary reads are not audited) |
| Q-7 | P-8a.3: add `subscribed` to admin plan-change audit details (a write-path detail change)? | Yes, as its own PR |
| Q-8 | Builders in `lib/admin/billing/` (needs the plan-row type) and the pure rule in `lib/business-os/billing/`? | Yes |

---

## 13. Business questions (with defaults)

Each default applies unless the user says otherwise. None blocks the workplan. They decide what one number means, which matters once Finance 5b shows it too.

| # | Question | Default | Why |
|---|---|---|---|
| **BQ-P8a-1** | MRR "net USD amount": the plan's list price excluding tax, or what the last invoice charged? | **List price excluding tax** (Essentials $79, Autopilot $129). If annual plans ever exist, count them at a twelfth of the yearly price | The last invoice includes tax and one-off upgrade charges, so it is not the monthly amount |
| **BQ-P8a-2** | A Founding Partner paying with the 50% founder discount (BQ-P1, P-11 not built): how is it counted? | **Shown separately as "discounted, amount not recorded"** until P-11 records the discounted price, never at full price | Today nobody has the discount; counting $129 for someone paying $64.50 would overstate MRR |
| **BQ-P8a-3** | A subscription set to cancel at the period end: does it count in MRR until it ends? | **Yes, counted, and shown as "of which cancelling"** | They still pay until the end date; this is how Stripe reports it |
| **BQ-P8a-4** | A subscription whose renewal failed and Stripe is retrying (`past_due`): does it count? | **Yes, counted, and shown as "of which past due"** | It matches the "paying" definition Finance already uses (SA-Q5); most retries recover |
| **BQ-P8a-5** | Should the list include free accounts (trials, free Founding Partners), or only paid and admin-assigned plans? | **Only accounts with a Stripe subscription, plus admin-assigned plans ("No Stripe")** | It is a subscriptions list; trials and Founding Partners are counted on Finance and Plans & entitlements |
| **BQ-P8a-6** | MRR on the Finance page (5b): current Stripe mode only, like here, or test and real together like Finance's other counts (BD-14)? | **Current mode only** (PF-15: test data never mixed with real money) | The same number on both pages; test purchases never inflate revenue |

---

## SA Review Notes

### SA Workplan Review

**Reviewed by SA, 2026-10-18, at `f7429b57`.**
**Status: APPROVED WITH CONDITIONS (SA-WP-P8a).** P-8a.1 may start; P-8a.2 and P-8a.3 follow in order. **Only one business question goes to the user (BQ-P8a-4).** The other five are settled by the specs, below.

#### Mismatches

| # | Ruling |
|---|---|
| (a) M-1 placement | **Follow BD-23** (the later user decision): the panel goes in the Businesses drawer, and the list, totals and MRR on a Money page. LF-2 removed the account lookup from Plans & entitlements, and that page may not import plan-row state. The BA corrects §7's "Where" column for AM-1 to AM-3 (text only) |
| (b) M-2 mode | **Settled by PF-15:** "admin lists and MRR filter on the current mode" (also §9.5 rows 6 and 19). BD-14 (test and live together) covers Finance's counts, not MRR. The rule takes the mode as a parameter, as planned |
| (c) M-4 history | **Accepted:** no money-history list until a `billing_reason` exists (U-10 stays carried to P-7a) |
| (d) M-5 list price | **Confirmed as reliable.** `tierMatrix.ts` `presentation.<tier>.monthlyPriceUsd` (79, 129), and the config **rejects a tier with no presentation entry at load** (`tierMatrix.ts:49`), so every configured tier has a price. `check-bos-plan-prices` (`planPriceCheck.ts:9-10`) asserts that the Stripe price behind each lookup key is the only one, active, monthly (`interval month`, count 1), and equal to `presentation`. Monthly is the only interval (Q-B8). A `bought_tier` no longer in config is `unpriced`: counted by number, never guessed. Q-3 accepted; R-2 (grandfathered prices) is recorded |

#### The six business questions: genuine or settled

| BQ | Verdict | Basis |
|---|---|---|
| BQ-P8a-1 basis | **Settled.** List price, excluding tax | AM-3 "net USD amounts"; BQ-P5 (prices excluding tax); L-9 / RD-1 (fixed prices). Annual is out of scope (Q-B8) |
| BQ-P8a-2 founder discount | **Settled, not asked.** BQ-P1 fixed the terms (50% off for 24 months, once per account). It cannot arise before P-11, which records `founder_discount_applied_at`. P-11 then prices it at 50% while within 24 months of that date. Until then, Dev's `discountUnknown` guard (never full price) stands | BQ-P1 |
| BQ-P8a-3 cancelling | **Settled.** Counted until it ends | AM-3 counts "active subscriptions", and a cancel-at-period-end subscription is still `active`. "Of which cancelling" is display only |
| **BQ-P8a-4 past_due** | **Genuine: ask the user.** AM-3 says "active"; Finance's "paying" set (SA-Q5) includes `past_due`. Default: **count it, shown as "of which past due"**, so the MRR rule and Finance's paying set agree | AM-3 vs SA-Q5 |
| BQ-P8a-5 free accounts | **Settled.** Not listed | AM-2's own filter list: subscription states plus "No Stripe (admin-assigned)". Trials and free Founding Partners are not subscriptions |
| BQ-P8a-6 Finance 5b mode | **Settled.** Current mode | PF-15 names MRR explicitly; one MRR rule (BD-19) |

#### Rulings on Q-1 to Q-8

- **Q-1:** yes.
- **Q-2:** yes, its own page `/admin/finance/subscriptions`. It is read-only under BD-21, and Finance's URL and payload stay frozen.
- **Q-3:** yes.
- **Q-4:** extend `stripeDashboardUrl`, unless a boost guard pins its export list. In that case move the function, unchanged, to a neutral pure file under `lib/business-os/billing/` and re-export it from the boost file. Do not keep two copies.
- **Q-5:** yes, 200 rows; totals cover the full set.
- **Q-6:** confirmed, no audit for reads.
- **Q-7:** yes, as P-8a.3.
- **Q-8:** yes.

#### Conditions

- **P8A-R1 (registrations).** Besides `enforcementPoints.test.ts`, the new importers of `BusinessOsAccountPlanRepository`, which the subscriptions route and the panel route use for `pagePlans` / `findEntitlementInputs`, must be added to that repository's **exact importer list** in `lib/repositories/__tests__/businessOsEntitlements.imports.guard.test.ts` (RC-15). Run `npm run test:bos-entitlements` per PR.
- **P8A-R2 (paging).**
  - R-p keyset-pages on `id` at ≤ 1,000 per request, and reaching the ceiling is an error.
  - `pagePlans` stays at its own ≤ 1,000 page.
  - **No `.limit` or page size above 1,000** (FF-1d, #463), and no new baseline entry.
  - A repository test serves exactly 1,000 rows and asserts the next page.
- **P8A-R3 (secrets in the select).** `ADMIN_BILLING_ROW_COLUMNS` is an exported constant with a test that it never contains `open_checkout`, `action_required_invoice_url` or `livemode`-free reads. Neither route returns a Stripe id other than the customer id used in the dashboard link, which is built on the server.
- **P8A-R4 (follow-up for Finance, recorded, not fixed here).** Finance R-c′ (`BusinessOsFinanceReadRepository.ts:549`, `maybeSingle` with no mode filter) will **error once an account has both a test and a live billing row**. That happens to the owner account the day live keys arrive. It must be fixed before §9.5 row 14 (live keys). It is logged as a Finance follow-up.
- **P8A-R5 (pins and guards).**
  - The seven Finance pins and AC-145 must stay byte-identical: no edit to the finance route, its deps, `financeUrl` or `financeFilters`.
  - The `businessDrawer.pins.*` suites pass unedited.
  - The vocabulary guard needs no edit.
  - The page uses only the layout standard primitives.
  - `requireAdmin` is the first statement in both routes, and the panel route follows the `tenant-isolation-guard` order of the summary route.

#### Checked and fine

- MRR is one pure rule in `lib/business-os/billing/planMrr.ts`, with no data layer and no entitlements import. `priceOf` is injected, so Finance 5b can reuse it.
- `groupByCurrency` is used, so there is never a cross-currency total.
- The unknown key mode fails closed (409 and no figures).
- No migration and no Stripe call.
- **Estimate:** about 3.0 days over three PRs, accepted.

## Implementation Notes (P-8a.1)

**Dev, 2026-10-18.** Branch `feature/bos-plan-payments-p8a` on `f7429b57`, uncommitted (no stash, no commit). T0 re-check: no plan-payments PR open; FF-1 #463 still open.

### What was built

| File | What |
|---|---|
| `lib/business-os/billing/planMrr.ts` (+ test) | The one MRR rule (§4): `computeMrr`, `mrrTreatment`, `MRR_COUNTS_PAST_DUE`. Imports only `payingSubscriptionStatuses` and `currencyGroups`; mode and `priceOf` are parameters |
| `lib/repositories/BusinessOsBillingAdminReadRepository.ts` (+ test) | R-p `listBillingRowsForModeAllAccounts(livemode)`: `.eq('livemode')`, keyset on `id`, `.limit` 1,000, ceiling 20,000 is an error, `ADMIN_BILLING_ROW_COLUMNS` with no secret or Stripe id |
| `lib/admin/billing/subscriptionsTypes.ts` | Payload types, statuses, row cap 200, the 409 sentence. No imports (client-safe) |
| `lib/admin/billing/subscriptionsView.ts` (+ test) | Pure builder: status precedence and memberships, No Stripe rows, totals, MRR, `catalogPriceOf(config)` |
| `lib/admin/billing/subscriptionsDeps.ts` | Wiring: R-p, `pagePlans` through Finance's `walkPlans` (a capped walk is an error), `getEntitlementConfig` |
| `app/api/admin/business-os/billing/subscriptions/route.ts` (+ test) | `requireAdmin` first; repeated key and strict Zod 400; `stripe_mode_unknown` 409; reads 500; names for the shown rows only; `no-store` |
| `app/admin/subscriptions/page.tsx`, `subscriptionsCopy.ts`, `components/SubscriptionsTable.tsx` (+ render test) | Header with the mode chip and "As of", test-key notice, filter bar (status in the URL), KPI strip (MRR per currency, paid accounts per plan, five filter tiles), table with `StatusChip`, shared states |
| `app/admin/components/AdminSidebar.tsx` (+ nav test) | Money: Finance → **Subscriptions** → Charge checks → AI calls & usage |
| Guards updated (reviewable additions) | `enforcementPoints.test.ts` (2 non-gate entries); `businessOsEntitlements.imports.guard.test.ts` (P8A-R1: 3 ALLOWED, 2 NO_STATE_WRITE, a `pagePlans`-only pin); `BusinessOsBillingAccountRepository.test.ts` (the billing-table reader list gains the new read-only repository, with a no-write check) |

**BQ-P8a-4** is one constant, `MRR_COUNTS_PAST_DUE = true` in `planMrr.ts`; a test pins that it is declared once and that `false` excludes `past_due` and nothing else.

### Deviations for SA

| # | Deviation | Why |
|---|---|---|
| D-1 | R-p lives in a **new read-only repository** `BusinessOsBillingAdminReadRepository`, not in `BusinessOsFinanceReadRepository` (§5.1) | The finance source guard pins that the finance repository's code never names `livemode` (BD-14), and P-8a must filter on it (PF-15). SA-F2 still holds: no writer's caller list changes, and the new file has no write (pinned twice) |
| D-2 | The page is **`/admin/subscriptions`**, not `/admin/finance/subscriptions` (Q-2) | Every file under `app/admin/finance` is scanned by the finance guard's "names no mode in code" rule; this page must show the Stripe mode (PF-15). Still in the Money section, after Finance |
| D-3 | No `lib/admin/billing/planPrices.ts`; `catalogPriceOf(config)` sits in `subscriptionsView.ts` and reads `planMonthlyPriceUsd` from the config passed in | No `TIER_MATRIX` import and one fewer entitlements importer |
| D-4 | No "other-mode rows not shown: N" line on the page (§5.4) | R-p reads one mode only, so the count would need a second read. `computeMrr` still returns `otherModeExcluded` for 5b; the page's notice says live-mode rows are not shown |
| D-5 | The header chip is the mode ("Stripe test mode" / "Stripe live mode"), with "Read-only" only before the first read | One chip per header (§5.3); the mode is the fact this page must state |
| D-6 | `BusinessOsBillingAccountRepository.test.ts` edited (the billing-table reader list) | Required by any new reader of that table; the edit adds the file and a no-write assertion. Not a Finance pin |

### Checks

| Check | Result |
|---|---|
| Touched folders: `lib/business-os/billing`, `lib/admin`, `app/api/admin/business-os/billing`, `app/admin/subscriptions`, `app/admin/components`, `lib/business-os/entitlements` | 129 suites, 6,459 tests, all pass |
| `app/admin/finance` | 20 suites, 687 tests, pass |
| `lib/business-os/finance` | 20 suites, 1,953 tests, pass |
| `lib/repositories` | 110 suites, 2,627 tests, pass |
| `app/admin/__tests__/aiCostVocabulary.source.guard.test.ts` | 182 pass, unedited |
| FF-1d `rangeCap.source.guard` (from PR #463, run as a temporary probe, then deleted) | 21 pass, no baseline entry |
| `npm run test:authz-guard` | 2 suites, 203 pass |
| `npm run test:bos-entitlements` | 293 suites, 8,840 pass |
| `npm run lint:hooks`; eslint on new files | clean |
| Scoped `tsc` (temporary `tsconfig.p8a-scope.json`, removed) with a canary in `planMrr.ts` | canary run: exactly 1 error `planMrr.ts(171,7) TS2322`; restored from a copy, SHA-256 `88e5a902…087e` identical; clean run: 0 errors |
| Finance route (`app/api/admin/business-os/finance`) incl. AC-145 `39b35743…56ea` | 2 suites, 122 pass; hash constants unchanged |
| Seven pins (LF-normalised SHA-256) | all equal to the 8.3 values: `3a1a2dd4…f6f8`, `b84e0c96…aabf`, `30f5fc24…2e01`, `24ff0da7…df9f`, `98ea0507…1e4b`, `02813360…5bd8`, `1f7cf07a…f144` |
| Webhook placement guard, `app/admin/__tests__`, `app/admin/users` (drawer pins), `app/admin/business-os-tiers` | 49 suites, 1,419 pass, drawer pins unedited |

P8A-R4 (Finance R-c′ with two modes) is left for Finance, not touched.

### User browser steps (P-8a.1)

Signed in as an admin, on a deployment with the Stripe test key: Money → **Subscriptions**. Expect the "Stripe test mode" chip and notice, the test owner account as Active with its renewal date, MRR (USD) $79 and Paid accounts 1. Pick **Failed** or click the Failed tile: the URL gets `?status=failed` and the list empties. Click a business name: the Businesses drawer opens on it.

### SA Code Review (P-8a.1)

**Code Review by SA, 2026-10-18. Reviewed: the uncommitted tree on `feature/bos-plan-payments-p8a`.**
**Status: Code Approved (SA-CR-P8a.1).** No conditions. BQ-P8a-4 is recorded in the requirement: the user decided on 2026-10-18 that `past_due` counts, shown separately, which matches `MRR_COUNTS_PAST_DUE = true`.

#### Checked

| Item | Result |
|---|---|
| One pure MRR rule, reusable by 5b | ✅ `planMrr.ts` imports only `payingSubscriptionStatuses` and `currencyGroups`. The mode and `priceOf` are parameters, and there is no data layer, entitlements import or tier literal. `mrrTreatment` is exported for per-row use. The founder-discount rows go to `discountUnknown`, never full price. A missing price is `unpriced`, never guessed. The switch is declared once and tested both ways |
| No currency summing | ✅ The lines come from `groupByCurrency` (one line per normalised code, with an Unknown line and overflow flagged). The page shows one KPI tile per currency |
| `requireAdmin` first | ✅ It is the first statement of `GET`, before the correlation id. Then the repeated key, strict Zod, the fail-closed mode (409, the key never echoed), the reads, the builder, and `no-store` on every response, with development-only `details` |
| Tenant isolation | ✅ There is no caller-supplied id. It is a cross-account, read-only, service-role read, with the reason in the repository header. Names are read only for the ≤ 200 rows shown. The log carries counts, the mode and the filter, and never a name or id |
| Repositories (D-1) | **Approved.** The new read-only `BusinessOsBillingAdminReadRepository` is the right home. The finance read repository's guard forbids naming `livemode` (BD-14), and PF-15 needs it here. There is no write method (pinned), and `ADMIN_BILLING_ROW_COLUMNS` holds no `open_checkout_*`, `action_required_invoice_url` or Stripe id (P8A-R3) |
| Paging (P8A-R2) | ✅ A keyset on `id`, `.limit(pageSize)` with `pageSize` ≤ 1,000 (guarded), and `>=` the 20,000 ceiling is an error. SA ran **main's FF-1d `rangeCap` guard** against this tree as a temporary probe file, which was removed afterwards: it passed with no baseline entry |
| Entitlements and RC-15 (P8A-R1) | ✅ Two non-gate entries in `enforcementPoints.test.ts`; the account-plan importer list is updated (3 ALLOWED, 2 NO_STATE_WRITE, a `pagePlans`-only pin); `test:bos-entitlements` passes |
| D-6 | **Approved:** the billing-table reader list gains the read-only repository, with a no-write assertion. It is not a Finance pin |
| Page and placement (D-2) | **Approved.** `/admin/subscriptions` sits in Money after Finance (the nav test is updated). It uses the layout primitives only (`AdminPageHeader`, `AdminFilterBar`, `KpiStrip`, `AdminStates`, `StatusChip`, `useAdminFilters`, `readAdminResponse`, `adminFormat`). There is no Supabase or repository import (render-test pin) and no `console.*`. The vocabulary guard needs no edit |
| D-3, D-4, D-5 | Approved. `catalogPriceOf(config)` avoids a `TIER_MATRIX` import. Showing no other-mode count is honest, since the page reads one mode. One mode chip per header |
| Seven Finance pins (SA recomputed) | ✅ `3a1a2dd4` `b84e0c96` `30f5fc24` `24ff0da7` `98ea0507` `02813360` `1f7cf07a`. The finance route and AC-145 are untouched |
| SA re-run | ✅ `planMrr`, `lib/admin/billing`, the subscriptions route, the page, the read repository, the sidebar nav test and the FF-1d probe: **7 suites, 153 passed** |

P8A-R4 (Finance R-c′ with both modes) is still owed to Finance before live keys. It is not P-8a's file.

#### Code Approved for QA: Yes

## Implementation Notes (P-8a.2)

**Dev, 2026-10-18.** Branch `feature/bos-plan-payments-p8a2`, cut from the P-8a.1 tip `d84e7b7b`. Uncommitted (no stash, no commit, no PR until #466 merges).

### What was built

| File | What |
|---|---|
| `lib/repositories/BusinessOsBillingAdminReadRepository.ts` (+ test) | R-p′ `findBillingRowForAccount(accountId, livemode)`: UUID guard, `.eq('user_id')` and `.eq('livemode')`, `maybeSingle`. `ADMIN_BILLING_PANEL_COLUMNS` = the list columns plus `stripe_customer_id` only (P8A-R3); no write (pinned) |
| `lib/admin/billing/billingPanelTypes.ts` | Panel payload types (type-only import) |
| `lib/admin/billing/billingPanelView.ts` (+ test) | Pure builder: the Stripe side (statuses from the list's own `subscriptionStatuses`, now exported; MRR from `mrrTreatment` with `catalogPriceOf`, label formatted on the server), the plan side (`deriveLifecycle` state, origin), stored-record disagreements (`tier_differs`, `paid_through_differs` beyond 1 s, `no_tier_on_plan`, only while paying), and the customer dashboard link |
| `app/api/admin/business-os/billing/accounts/[accountId]/route.ts` (+ test) | `requireAdmin` first → UUID 400 → platform 409 → `isBusinessOsTenant` 404/500 → mode 409 → R-p′ and the plan row (overrides dropped) → builder; `no-store`; logs ids and states only |
| `lib/business-os/boost/boostAdminView.ts` (+ test) | `stripeDashboardUrl` gains the `customer` kind (`cus_` → `customers`), per SA Q-4 (no boost guard pins its kinds) |
| `app/admin/users/components/PlanBillingBlock.tsx` (+ render test) | "Plan billing" part in the Credits & billing box, after Credit top-ups: closed by default; on opening, one GET; Stripe (mirrored) and Plan row columns, status chips, "In MRR", disagreements with "not a check against Stripe", the Stripe dashboard link, the test-key note, "No Stripe subscription" (AC-F4.1), "Read again" |
| `app/admin/users/components/BusinessOsPanel.tsx` | Mounts the block once (5 added lines) |
| Registrations | `enforcementPoints.test.ts`: `billingPanelView.ts` and the route as non-gate importers. RC-15 guard: the route (admin_route), its test, the builder (NO_STATE_WRITE) and its test |

### Deviations for SA

| # | Deviation | Why |
|---|---|---|
| D-7 | The block is **read on demand**: closed when the drawer opens, one GET when the admin opens it | Every `businessDrawer.pins.*` suite records `unexpected` for any GET its route table does not know and fails on it, so a read on drawer open would move the pins. A closed block sends nothing (the Finance 8.3 history-block precedent). All drawer pin and layout suites pass **unedited** |
| D-8 | The block sits **after** Credit top-ups, not first in the box (§5.4) | Risk R-4's fallback: it keeps the Credits and Top-ups blocks' positions exactly as pinned |
| D-9 | The Credits & billing purpose line is **unchanged**; the block carries its own one-line purpose instead of a `DRAWER_PURPOSE` key | `drawerBox.render.test.tsx` pins the exact `DRAWER_PURPOSE` key set |
| D-10 | The MRR amount is formatted on the server (`monthly.label`) | The drawer's source guard forbids any `lib/business-os` import in the screen's files; the new block follows the same rule |
| D-11 | No `billingPanelDeps.ts`: the route names the two repositories itself | The summary route's pattern (admin routes are an allowed RC-15 category); one wiring file fewer |

### Checks (each suite run alone)

| Check | Result |
|---|---|
| Touched folders: `lib/admin`, `lib/business-os/boost`, `app/api/admin/business-os/billing`, `lib/business-os/entitlements`, `lib/repositories` | 195 suites, 5,415 tests, pass |
| `app/admin/users` (drawer pins and layout unedited) | 28 suites, 670 tests, pass |
| `app/admin/components` | 25 suites, 824 tests, pass |
| Vocabulary guard | 182 pass, unedited |
| Range-cap guard (`rangeCap.source.guard`, now on main) | 21 pass, no baseline entry |
| `npm run test:authz-guard` | 203 pass |
| `npm run test:bos-entitlements` | 296 suites, 8,923 pass |
| `npm run lint:hooks`; eslint on the changed files | clean |
| Scoped `tsc` (temporary config, removed) with a canary in `billingPanelView.ts` | canary: exactly 1 error `billingPanelView.ts(139,7) TS2322`; restored, SHA-256 `90afa987…9a19` identical; clean run 0 errors |
| Seven Finance pins (LF-normalised) | unchanged: `3a1a2dd4…f6f8`, `b84e0c96…aabf`, `30f5fc24…2e01`, `24ff0da7…df9f`, `98ea0507…1e4b`, `02813360…5bd8`, `1f7cf07a…f144` |

### QA note QA-P8a2-N1 (Low), fixed

Fixed by Dev: for a `past_due` subscription the drawer's "In MRR" line now reads "$79 a month · past due (still counted)". The builder sends `monthly.pastDue` from `mrrTreatment`. The wording is one constant, `MRR_PAST_DUE_COUNTED` in `app/admin/subscriptions/subscriptionsCopy.ts`, and the Subscriptions MRR tile now uses it too ("of which past due (still counted) $79"). Tests: the builder's past-due case, two block cases (marker present, absent) and one page case. Re-run: `app/admin/users` 28 suites, 672 tests, pass, with the drawer pins unedited; the vocabulary and contrast guards pass (2 suites, 274 tests).

### User browser steps (P-8a.2)

On a deployment with the Stripe test key, signed in as an admin: Businesses → open the test owner → Credits & billing → **Show plan billing**. Expect Stripe (mirrored) "Active", the plan bought, the next renewal, "$79 a month" in MRR, the Plan row with the same plan and paid-through date, "Stored records agree", and **Open the customer in Stripe** opening the test dashboard. A business with an admin-assigned plan and no purchase reads **No Stripe subscription**.

### SA Code Review (P-8a.2)

**Code Review by SA, 2026-10-18. Reviewed: the uncommitted tree on `feature/bos-plan-payments-p8a2`, stacked on P-8a.1 (#466).**
**Status: Code Approved (SA-CR-P8a.2).** No conditions. The PR is opened only after #466 merges; then merge main into this branch, with no stacked PR.

| Item | Result |
|---|---|
| `requireAdmin` first | ✅ It is the first statement of `GET`, and `no-store` is on every response |
| Tenant isolation | ✅ The route trusts only its path id. The order is the summary route's: Zod UUID (400) → `isPlatformAccount` (409) → `isBusinessOsTenant` (404 / 500) → the mode (409, fail closed) → reads scoped to that id. R-p′ re-guards the UUID and filters `.eq('user_id')` plus `.eq('livemode')`; `maybeSingle` is safe under UNIQUE (`user_id`, `livemode`). The block sends the drawer's selected `accountId`, URL-encoded, and the server re-checks it, so no other id is trusted |
| Stored mirror only | ✅ The panel is built from the billing row and the plan row only. There is no Stripe API call, and the panel says "not a check against Stripe" |
| Columns (P8A-R3) | ✅ `ADMIN_BILLING_PANEL_COLUMNS` is the list columns plus `stripe_customer_id`, used only for the server-built dashboard link. There is no `open_checkout_*`, no `action_required_invoice_url`, and no subscription or invoice id. The override rows (admin reasons) are not passed to the builder |
| Paging | ✅ R-p′ is a one-row `maybeSingle`; no list read is added. SA ran main's FF-1d guard against this tree (a temporary probe, removed): it passed with no baseline entry |
| `stripeDashboardUrl` (Q-4) | ✅ The `customer` kind is added (`cus_` pattern → `customers`), with the existing kinds unchanged and a test added. There is one rule for dashboard links |
| Drawer pins and layout | ✅ No file under `app/admin/users/__tests__` is modified; the one new file there is `planBillingBlock.render.test.tsx`. `BusinessOsPanel.tsx` changes by a mount only |
| Seven Finance pins (SA recomputed) | ✅ `3a1a2dd4` `b84e0c96` `30f5fc24` `24ff0da7` `98ea0507` `02813360` `1f7cf07a` |
| Guards | ✅ The vocabulary guard needs no edit. RC-15 and `enforcementPoints` registrations are added. SA re-ran the billing routes, `lib/admin/billing`, `app/admin/users`, the boost view, the read repository, the vocabulary guard and the FF-1d probe: **36 suites, 1002 passed** |

**Deviation rulings**

- **D-7: approved.** On-demand loading keeps every drawer pin unedited, the Finance 8.3 precedent. "Show plan billing" sends exactly one GET.
- **D-8: approved.** Placing it after Credit top-ups keeps the pinned part order, the planned fallback for R-4.
- **D-9: approved.** The block's own purpose line avoids editing the pinned `DRAWER_PURPOSE` key set.
- **D-10: approved.** Formatting on the server follows the drawer's "no `lib/business-os` import in screen files" rule.
- **D-11: approved.** It matches the summary route's pattern; admin routes are an allowed RC-15 category.

#### Code Approved for QA: Yes

## QA Testing Report

**QA — 2026-10-18** (P-8a.1 only: the MRR rule and `/admin/subscriptions`; P-8a.2 and P-8a.3 are not built)
**Test mode:** full
**Strategy used:**
- **A + B:** Jest unit, repository, route and render suites, plus guards, run one at a time in the worktree.
- A code read of `planMrr.ts` and of the page's MRR line.
- **A temporary merge with main, outside the worktree:** a scratch `git archive origin/main` (`399070d4`, which has FF-1 #463 and pricing slice 9 #464) with the P-8a diff and new files applied. The patch applied cleanly, with no file overlap with main's drift. The range-cap guard, which is on main and not in this branch, and the cross-cutting suites were run there with that export as the working directory. The worktree was not merged or changed.
- A scoped tsc with a canary.

**Focus:** api, ui, security, schema
**Skipped:** the live browser look (user, below).
**Input source:** prompt + workplan

**Verdict: PASS. No bugs.**

### Suite runs (each alone, worktree `neuronforge-finance-health`, branch `feature/bos-plan-payments-p8a` on `f7429b57`, uncommitted)

| Suite | Result |
|---|---|
| Touched folders: `lib/business-os/billing`, `lib/admin`, `app/api/admin/business-os/billing`, `app/admin/subscriptions`, `app/admin/components`, `lib/business-os/entitlements` | **129 suites, 6,459 tests**. In the batch, `lib/admin/__tests__/admin-authz-surface.guard.test.ts` once failed to run under load (0 failing assertions); alone it gave 1/1, 119/119. Total 6,340 + 119 = 6,459, as Dev recorded |
| `app/admin/finance` | 20/20, 687/687 |
| `lib/business-os/finance` | 20/20, 1953/1953 |
| `lib/repositories` | 110/110, 2627/2627 |
| The finance route `app/api/admin/business-os/finance` (AC-145) | 2/2, 122/122 |
| Vocabulary guard | 1/1, 182/182; unedited |
| **Range-cap guard (FF-1d)**, on main + P-8a | **1/1, 21/21**, no baseline entry added |
| `npm run test:authz-guard` | 2/2, 203/203 |
| `npm run test:bos-entitlements` | 293/293, 8840/8840 |
| `npm run lint:hooks` | exit 0 |

These match Dev's counts.

**Range-cap guard, proven to scan P-8a:** in the export, a planted `q.limit(2000)` in `BusinessOsBillingAdminReadRepository.ts` failed the guard, naming that file. The export copy was restored. The real code pages at `PAGE_SIZE: 1000` (a validated `pageSize`, keyset on `id`), with `CEILING: 20_000` as an error.

**Main + P-8a, the cross-cutting run:** the touched folders, `lib/repositories` and the vocabulary guard together gave 241/242 suites, 9,316/9,317 tests. The one failure is `BusinessDataExportRepository.test.ts` "sole importer", which shells out to `git grep`. My export is not a git repository, so this is environmental. It passes in the worktree, and P-8a does not touch data export. **So there is no semantic conflict with main.**

**Pins (LF-normalised):** AC-173 `3a1a2dd4…f6f8` ✅, helper `b84e0c96…aabf` ✅, A `30f5fc24…2e01` ✅, B `24ff0da7…df9f` ✅, C `98ea0507…1e4b` ✅, C helper `02813360…5bd8` ✅, D `1f7cf07a…f144` ✅. `git diff --quiet HEAD` is clean on:
- `app/admin/finance`, `lib/business-os/finance`, the finance route (AC-145);
- `app/admin/components/layout`, `lib/admin/health`, `app/admin/users` (drawer pins), `supabase`;
- `payingSubscriptionStatuses.ts`, `BusinessOsFinanceReadRepository.ts` and the billing writer repository.

**Scoped tsc:**
- Config in the scratchpad covering 27 files: the changed and new files plus all seven pins.
- A canary in `planMrr.ts` gave `(171,7) TS2322` only.
- The file was restored with `cp` and checked with `cmp` (identical).
- The clean run gives **exit 0, 0 errors**.

### Edge cases

| Case | Result | Evidence |
|---|---|---|
| MRR uses the list price excluding tax | ✅ | `catalogPriceOf(config)` reads the config's monthly list price (the price `check-bos-plan-prices` ties to Stripe), never `amount_minor` (which includes tax and proration); test "prices every configured tier from presentation, in USD hundredths" |
| Monthly or annual | ✅ (n/a) | monthly is the only interval (Q-B8). A tier with no monthly price is **unpriced**: counted by number, "never 0, never guessed" (test), and shown as a note on the MRR tile |
| Per currency, never summed | ✅ | `groupByCurrency`; "never adds two currencies together: one line each"; page "MRR is one tile per currency, never one total" |
| Founding Partner discount shown separately | ✅ | `discount_unknown`, never at list price (planMrr and view tests); the page note "N with a founder discount, amount not recorded yet, not counted" |
| Cancel-at-period-end counts | ✅ | counted with its own part; status "Cancelling"; the row reads "Ends on"; tile sub-line "of which cancelling" |
| `past_due` counts, on its own line | ✅ | `MRR_COUNTS_PAST_DUE = true` (the user's decision, recorded by SA), declared once; `false` excludes only `past_due`; tile sub-line "of which past due" (`page.tsx:80`); the row status is Failed |
| Free and comped accounts | ✅, per AM-2 / BQ-P8a-5 | **Free accounts** (trial, free Founding Partner, a plan row with no tier) are **not listed** (test). **Comped / admin-assigned** accounts are listed only as **"No Stripe"**, as AM-2 requires, and are **never in MRR** ($0). An abandoned checkout row is not listed |
| Current mode only, both ways | ✅ | route: a test key reads test-mode rows only, a live key live-mode only; R-p filters `livemode` on every request (repository test); other-mode rows never reach the list or the money; an unknown key gives 409, no figure, no read, the key never echoed |
| Status filter, totals, empty state | ✅ | the filter narrows the rows while the totals cover everything; status tiles are real links; `?status` round-trips through the URL; an unknown value is ignored; "no paying subscription: the MRR tile says None, and the list is empty"; a 200-row cap with "how many matched" |
| Paging past 1,000 rows | ✅ | a page of exactly 1,000 asks for the next after the last id; a page size of 0, 1001 or 1.5 is refused; the ceiling is an error, never a partial list; plan rows go through the walk (≤ 1,000 per page, capped is an error) |
| Non-admin refused | ✅ | route: 401 with no session and 403 for a non-admin, both **before any read**; `requireAdmin` is the first statement; the page sits under the admin layout (`requireAdminPage`); the authz surface guard (119) covers it |
| No secret columns in the payload | ✅ | `ADMIN_BILLING_ROW_COLUMNS` never selects `open_checkout_*`, `action_required_invoice_url` or a Stripe id, and every column exists in the migration; the route test "the payload carries no Stripe id (P8A-R3)"; logs carry counts only |

### Test Coverage

| AC | Verdict | Evidence |
|---|---|---|
| AC-AM.2 (list, filters, totals, MRR, current mode) | PASS (code), browser owed | route, view and render tests; edge-case table |
| AM-3 (totals and MRR per currency) | PASS | view "MRR per currency, paid accounts per plan, and counts per status, over every row" |
| PF-15 (current mode only) | PASS | route both-mode tests; repository `livemode` on every `.from(` |
| AC-SR.5 / AC-P8a.5 (unknown mode shows no figure) | PASS | route 409 cases; page 409 render |
| AC-P8a.1 (each §4 row as stated) | PASS | `planMrr.test.ts` covers every row |
| AC-P8a.2 (never one total across currencies) | PASS | planMrr and page tests |
| AC-P8a.3 (other-mode rows counted, never summed) | PASS | planMrr test |
| AC-P8a.4 (≤ 1,000 per request, keyset on `id`, ceiling is an error) | PASS | repository tests; range-cap guard on main |
| SR-17 / P8A-R1 (registrations) | PASS | `enforcementPoints` and RC-15 importer list green; `test:bos-entitlements` 8,840 |
| P8A-R5 (pins, drawer pins, vocabulary, layout primitives, `requireAdmin` first) | PASS | above |
| AC-AM.1, AC-F4.1 (panel), AC-AM.4 (AM-7) | NOT-TESTED | P-8a.2 and P-8a.3, not built |

### Issues Found
- **Bugs:** none.
- **Performance:** none. One mode's billing rows plus the plan walk, both paged at 1,000; names only for the ≤ 200 rows shown.
- **Notes:**
  1. The `admin-authz-surface.guard` suite once failed to run under parallel load and passed alone (119/119). This is the known load-flake class, not P-8a.
  2. Recorded, not fixed here (SA P8A-R4): Finance R-c′ (`maybeSingle`, no mode filter) errors once an account has both a test and a live billing row. It must be fixed before live keys.
  3. When opening the PR, merge `origin/main` (now `399070d4`) and re-run. QA's export shows it applies cleanly and stays green, the range-cap guard included.

### User browser steps (after merge; signed in as an admin, Stripe test key)
1. **Money → Subscriptions.**
   - The header chip reads "Stripe test mode", with the test-key note and an "As of" time.
   - The test owner account is listed as **Active**, with its plan, next renewal and last payment in UTC.
   - The MRR tile reads **USD 79.00** (one tile per currency), and Paid accounts reads 1.
2. Click the **Failed** tile, or pick Failed in the filter. The URL gains `?status=failed` and the list empties, unless a test renewal failed. Reload: the filter is kept. The totals do not change with the filter.
3. Pick **Paused**: empty. Pick **No Stripe**: any admin-assigned (comped) account is listed with no MRR.
4. Click the owner's business name: the Businesses drawer opens on it.
5. A non-admin account opening `/admin/subscriptions` is refused (the admin gate). Optional; this is already proven by the route and layout tests.

### Final Status
- [x] All P-8a.1 acceptance criteria pass in code. The browser look (steps above) is the user's after merge. P-8a.2 and P-8a.3 are not in scope. No bugs. **Ready for RM** (merge `origin/main` first, then re-run).
- [ ] Issues found

## QA Report — P-8a.2

**QA — 2026-10-18** (worktree `neuronforge-finance-health`, branch `feature/bos-plan-payments-p8a2`, cut from the P-8a.1 tip `d84e7b7b`, which already has `origin/main` merged; uncommitted; stacked on #466)
**Test mode:** full
**Strategy used:**
- **A + B:** Jest unit, repository, route and render suites, plus guards, run one at a time.
- A code read of `billingPanelView.ts` and `PlanBillingBlock.tsx`.
- A temporary untracked probe through the real `buildBillingPanel`, reusing the view test's fixtures. It was deleted afterwards (`git status` clean of it).
- A scoped tsc with a canary.

**Focus:** api, ui, security
**Skipped:** the live browser look (user, below).
**Input source:** prompt + workplan

**Verdict: PASS. No bugs; one Low note (QA-P8a2-N1).**

### Suite runs (each alone)

| Suite | Result |
|---|---|
| Touched folders: `lib/admin`, `lib/business-os/boost`, `app/api/admin/business-os/billing`, `lib/business-os/entitlements`, `lib/repositories` | 195/195, 5415/5415 |
| `app/admin/users`, including the `businessDrawer.pins.*` and layout suites | 28/28, 670/670. The only change in `app/admin/users/__tests__` is the new `planBillingBlock.render.test.tsx`; **every drawer pin is unedited** |
| `app/admin/components` | 25/25, 824/824 |
| Vocabulary guard | 182/182; unedited |
| Range-cap guard (on this branch through the main merge) | 21/21; unedited, no baseline entry |
| `npm run test:authz-guard` | 2/2, 203/203 |
| `npm run test:bos-entitlements` | 296/296, 8923/8923 |
| `npm run lint:hooks` | exit 0 |

These match Dev's counts.

**Scoped tsc:**
- Config in the scratchpad covering 25 files: the changed and new files, the billing routes and all seven pins.
- A canary in `billingPanelView.ts` gave `(139,7) TS2322` only.
- The file was restored with `cp` and checked with `cmp` (identical).
- The clean run gives **exit 0, 0 errors**.

**Pins (LF-normalised):** `3a1a2dd4` `b84e0c96` `30f5fc24` `24ff0da7` `98ea0507` `02813360` `1f7cf07a`, all unchanged. `git diff --quiet HEAD` is clean on `app/admin/finance`, `lib/business-os/finance`, the finance route, `app/admin/components`, `supabase`, `BusinessOsFinanceReadRepository.ts` and the billing writer repository.

### Behaviour

| Item | Result | Evidence |
|---|---|---|
| Loads only on "Show plan billing"; opening the drawer adds no request | ✅ | render: "starts closed and sends nothing until opened (D-7)"; "opening reads once; closing and opening again does not read again"; "calls exactly one URL, and never Stripe". The drawer pin suites, which fail on any unknown GET, pass unedited |
| Stripe's stored mirror beside our plan row | ✅ | render "Stripe beside the plan row…" (AC-AM.1). The Stripe column shows the status chip(s), Stripe status, plan bought, next renewal or "Ends on", scheduled change, last payment, failed attempts and "In MRR". The plan-row column shows the lifecycle state and origin. Mode: the test-key note shows on a test key and is absent on a live key; the dashboard link is mode-aware (`/test/`) |
| Price and MRR | ✅ | `mrrTreatment` (the one rule) with `catalogPriceOf`. Probe: an active row gives `counted`, "$79" ("$79 a month"); a cancelling row is counted, "$79"; a founder discount is `discount_unknown`, never at list price; trialing is not counted |
| `past_due` counted and shown apart | ✅, with a Low note | probe: a `past_due` row gives `mrrKind: counted`, "$79", status chip **Failed**, Stripe status **`past_due`**. The panel shows it apart through the chip and the raw status, but the "In MRR" line itself reads "$79 a month" with no past-due marker (QA-P8a2-N1). The account-level view has no "of which" split; that lives on the Subscriptions totals (P-8a.1) |
| Dashboard link uses the `customer` kind | ✅ | `billingPanelView.ts:135` `stripeDashboardUrl('customer', row.stripe_customer_id, row.livemode)`. `boostAdminView.ts:106` adds `'customer'` (`cus_` → `customers`); boost tests are green. There is no link without a customer |
| No billing row: empty state, no error | ✅ | view and route "No Stripe subscription" (AC-F4.1); render: no dashboard link without a customer; an abandoned checkout (a customer with no subscription) gives no Stripe side but keeps the customer link; a row of the other mode is ignored (PF-15) |
| A read error shows inside the panel | ✅ | render `it.each`: 404, 409 (`stripe_mode_unknown`) and 500 each show their sentence in `plan-billing-error`, and "Read again" reads again; a network failure shows the fallback sentence. The drawer itself is unaffected |
| Non-admin refused | ✅ | route: 401 without a session, 403 for a non-admin, both before any read; `requireAdmin` is the first statement. Then UUID 400, platform 409, not a tenant 404, tenant check 500, all before the billing read; "every read receives exactly the checked id" |
| No secret columns in the payload | ✅ | `ADMIN_BILLING_PANEL_COLUMNS` = the list columns plus `stripe_customer_id` only (repository test "nothing secret"); "carries no Stripe id but the customer's, and only inside its dashboard link"; the route "never sends an override reason, and logs no Stripe id"; probe: no `sub_`, `pi_`, `in_`, `open_checkout` or `action_required` in the built panel |

### Test Coverage

| AC | Verdict | Evidence |
|---|---|---|
| AC-AM.1 (panel beside the plan row, dashboard link) | PASS (code), browser owed | above |
| AC-F4.1 ("No Stripe subscription") | PASS | view, route and render |
| AC-P8a.6 (disagreement flag names each stored mismatch, says it is not the Stripe check) | PASS | view: `tier_differs`, `paid_through_differs` (beyond 1 s; "the same instant written differently is not a disagreement"), `no_tier_on_plan`, only while paying; render "…says it is not the Stripe check" |
| P8A-R1 / R3 / R5 | PASS | registrations green; columns; pins; drawer pins unedited; `requireAdmin` first and the tenant order |
| AC-AM.4 (AM-7) | NOT-TESTED | P-8a.3, not built |

### Issues Found
- **Bugs:** none.
- **Performance:** none. One GET, only on demand.
- **Edge cases (nice to fix):**
  1. **QA-P8a2-N1 (Low).** `app/admin/users/components/PlanBillingBlock.tsx:200-208`: for a `past_due` subscription, the "In MRR" line reads "$79 a month" with no marker that the counted amount is past due. The user's decision is "past_due counts and is shown separately". The panel does show it through the **Failed** chip and "Stripe status: past_due", so nothing is wrong or hidden. Optional: append "(past due)" when `stripeStatus === 'past_due'`. This is copy only and needs no server change.

### User browser steps (after #466 and this PR merge; signed in as an admin, Stripe test key)
1. **Businesses →** open the test owner. The drawer opens with **no** new request in the network panel.
2. **Credits & billing →** "Plan billing" (after Credit top-ups) → **Show plan billing.** Exactly one request, `/api/admin/business-os/billing/accounts/<id>`. Expect:
   - the Stripe (mirrored) side: "Active", the plan bought, the next renewal, "In MRR $79 a month";
   - the Plan row side: the same plan and its paid-through date;
   - "Stored records agree", and the test-key note.
3. Click **Open the customer in Stripe**: the **test** dashboard opens on that customer.
4. Close and reopen the part: no second request.
5. Open a business with an admin-assigned plan and no purchase: **No Stripe subscription**, with no error and no dashboard link.

### Final Status
- [x] All P-8a.2 acceptance criteria pass in code. One Low note (QA-P8a2-N1). The browser look is the user's after merge. **Ready for RM once #466 merges** (no stacking).
- [ ] Issues found

## Commit Info

_RM to populate._

---

## Change History

| Date | Change | Details |
|---|---|---|
| 2026-10-18 | Created (Dev) | Workplan for P-8a from `origin/main` `f7429b57`; no code. Stream state checked (no open plan-payments PR; FF-1 #463 open). MRR rule §4; split P-8a.1 / .2 / .3 (≈ 3.0d); mismatches M-1 to M-6; SA Q-1 to Q-8; BQ-P8a-1 to BQ-P8a-6 with defaults |
| 2026-10-18 | SA workplan review | APPROVED WITH CONDITIONS (SA-WP-P8a): one genuine BQ (P8a-4), five settled; P8A-R1 to R5 |
| 2026-10-18 | Dev: P-8a.1 implemented (uncommitted) | MRR rule, read-only admin billing read, builder, route, `/admin/subscriptions` page and Money entry; T0 to T6 done; deviations D-1 to D-6; all checks green, seven pins equal |
| 2026-10-18 | SA code review (P-8a.1) | Code Approved (SA-CR-P8a.1); D-1, D-2 and D-6 approved; BQ-P8a-4 recorded in the requirement |
| 2026-10-18 | Dev: P-8a.2 implemented (uncommitted) | Billing panel in the Businesses drawer: R-p′, builder, route, read-on-demand block; T7, T8 done; deviations D-7 to D-11; drawer pins unedited and green; seven pins equal |
| 2026-10-18 | SA code review (P-8a.2) | Code Approved (SA-CR-P8a.2): D-7 to D-11 and the Q-4 `customer` link kind approved; requireAdmin first, tenant order, stored mirror only, no secret columns, drawer pins unedited, seven pins unchanged; open the PR only after #466 merges |
| 2026-10-18 | Dev: QA-P8a2-N1 fixed | Past-due marker in the drawer's In MRR line, one shared constant with the Subscriptions page; tests added |
