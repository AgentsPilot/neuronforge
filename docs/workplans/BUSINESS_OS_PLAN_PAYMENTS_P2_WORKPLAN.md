# Workplan: Business OS Plan Payments, P-2 (Plan prices and billing record)

> **Last Updated**: 2026-10-04

**Developer:** Dev
**Requirement:** [BUSINESS_OS_PLAN_PAYMENTS_REQUIREMENT.md](/docs/requirements/BUSINESS_OS_PLAN_PAYMENTS_REQUIREMENT.md): §4 PF-8, PF-14 (registry part), PF-15 (billing-row part); §6 "Price shown vs price charged"; §8 SR-8, SR-9, SR-12, SR-16, SR-17; §9.1 P-2; §9.3 (20261025); §9.4 (Stripe customer row) and CF-1; SA Review SA-P1, SA-P10 (env name only), SA-P12 (a), tenant-isolation ruling; conditions C-4, C-5, C-9. Reuse plan [L-2, L-10, RD-1, RD-3, Q-T1, Q-T8](/docs/requirements/BUSINESS_OS_TIER_BILLING_REUSE_PLAN.md).
**As-built:** [BUSINESS_OS_PLAN_PAYMENTS_ASBUILT.md](/docs/requirements/BUSINESS_OS_PLAN_PAYMENTS_ASBUILT.md) G-4, G-11, G-14
**Depends on:** SA-P13 query answered (C-4; done 2026-10-02, requirement §10.2). P-1 merged (PR #188) is not a dependency, but P-2 edits P-1's catalog.
**Date:** 2026-10-04
**Branch:** `feature/bos-plan-payments-p2`, local only, cut from `origin/main` `2fb98a74` (P-0 and P-1 merged).
**Status:** P-2a Code Complete (uncommitted, 2026-10-04): waiting for the user to see the diff, SA code review, QA, and the user's migration apply (P2-C6). P-2b not started.

## Overview

P-2 puts in place everything the first Business OS checkout (P-3a) needs, without selling anything. It creates the two plan prices in Stripe **test mode**, each found by a **lookup key** that is the same in test and live mode (Q-T1). It adds a read-only script, `check-bos-plan-prices`, which proves that each price equals the display price in `tierMatrix` ($79 and $129, SA-P12). Migration **20261025** adds the billing record table `business_os_billing_accounts`, with every column SA-P1 listed. The table is server-write-only, every row carries `livemode` (PF-15), and the table is registered as a retained financial record in the purge and deletion registries (PF-14). A repository is added, scoped by `user_id`. The Stripe customer helper is split (Q-T8): the Stripe lookup and create become a shared function with no side effect, and the `user_subscriptions` seed stays with the agent-platform caller, whose behaviour is shown to be unchanged. `.env.example` gains the Stripe names, with no values (PF-8). P-2 also answers carry-forward CF-1: how a renewal on a retired price is still recognised.

After merge, production is **inert**. No route reads the table, nobody can buy, and the router recognises a plan invoice only if one exists on these prices, which nothing creates until P-3a.

---

## Table of Contents

1. [Analysis summary](#1-analysis-summary)
2. [Scope](#2-scope)
3. [Design](#3-design)
4. [Migration 20261025](#4-migration-20261025)
5. [Files to create / modify](#5-files-to-create--modify)
6. [Task list](#6-task-list)
7. [Test plan](#7-test-plan)
8. [Gates and what the user must provide](#8-gates-and-what-the-user-must-provide)
9. [Tenant isolation](#9-tenant-isolation)
10. [Risks](#10-risks)
11. [Demo](#11-demo)
12. [Sizing](#12-sizing)
13. [Rollback](#13-rollback)
14. [Questions for SA](#14-questions-for-sa)
15. [SA Review](#sa-review)

---

## 1. Analysis summary

| Fact | Evidence |
|---|---|
| `BOS_PLAN_LOOKUP_KEYS` is empty, so the catalog never calls Stripe and nothing is recognised. Once the list is non-empty, the catalog makes one `prices.list({ lookup_keys })` call (no `active` filter), caches it for 5 minutes, refetches once on a miss (P1-C3), and **throws** if there are more than 10 keys | `lib/business-os/billing/planPriceCatalog.ts` |
| The router's outcome carries `lookupKeys`, not a tier. **No lookup key → tier mapping exists yet.** SA (P-1 Q-4) put it in P-2's entitlements config | `planInvoiceResolver.ts`; P-1 workplan SA ruling Q-4 |
| Display prices: `presentation.basic.monthlyPriceUsd = 79`, `presentation.pro.monthlyPriceUsd = 129`, `availableToBuy: false` on both. The comment says "Stripe becomes the source of truth in Slice 4" | `lib/business-os/entitlements/config/tierMatrix.ts:243-268` |
| `TIER_ORDER = ['basic', 'pro']`, `TierId` exported. `config/` holds no `server-only` import, so a `tsx` script can read it | `tierMatrix.ts:71-74`; grep |
| Tier-name literals are allowed only inside `entitlements/config/**` and that module's tests. The guard matches **whole quoted strings** (`'basic'`), so a lookup key such as `'bos_plan_basic_monthly_usd'` does not trip it. `scripts/` is not scanned | `__tests__/tierLiteral.forbidden.test.ts` |
| Any file outside the module that imports from it must be registered (type-only imports included) | `business-os-entitlements` skill; `__tests__/enforcementPoints.test.ts` `KNOWN_NON_GATE_IMPORTERS` |
| `StripeService.getOrCreateCustomer(supabase, userId, email, name)`: reads `user_subscriptions.stripe_customer_id`; if one is set, `customers.retrieve` (and reuses it unless the call **throws**; a deleted customer comes back `{ deleted: true }` and is reused, a quirk to keep); otherwise `customers.create({ email, name, metadata: { user_id } })` with no idempotency key; then UPDATEs or INSERTs `user_subscriptions` with the hard-coded seed (`monthly_amount_usd: 10.00, monthly_credits: 20833`). It contains 1 `console.warn`; the file contains **2** `console.*` calls | `lib/stripe/StripeService.ts:37-96` |
| Its only live caller is `createBoostPackCheckout`, reached from `create-checkout` (`custom_credits` is refused since P-1). `StripeInvoiceService` has its **own private** `getOrCreateCustomer` on a connected account. That one is not the Q-T8 function and must not be touched | `StripeService.ts:142, 237`; reuse plan §4.6b |
| A QA guard pins the function's body: 4 × `.from('user_subscriptions')`, 3 × `.eq('user_id', userId)`, an INSERT that starts with `user_id: userId,`, no upsert. The body is sliced from `async getOrCreateCustomer(` to `async createCustomCreditSubscription(`. Only three StripeService methods may take a Supabase client | `lib/repositories/__tests__/userSubscriptionsWriteLockdown.qa.test.ts:131-209` |
| The P-0/P-1 webhook harness and the P-1 QA suite fall back to the **real** catalog when a scenario names no prices. Today that is free because the list is empty. Once P-2 fills the list it would call Stripe, so their snapshots would change | `connectPath.characterisation.test.ts:136-147`; `routerEdgeCases.qa.test.ts:64-77` |
| Registries: purge `PURGE_DESCRIPTORS` (+ frozen `classification-baseline.json`), `USER_OWNED_TABLES` (a test parses **every migration's** `CREATE TABLE` and fails on an unclassified `user_id` table), `ACCOUNT_POLICY_EXCEPTIONS` (credit ledger and lots = `minimise`, carried out by `ON DELETE SET NULL` because service_role has no UPDATE on `user_id`). **No code executes the deletion policy yet.** It is declarative (the memory note "account deletion never calls erasure") | `lib/business-os/purge/descriptors.ts:396-409`; `lib/business-os/businessOwnedTables.ts:163-178`; `lib/business-os/account/accountDeletionPolicy.ts:119-147`; grep for `policyFor(` callers: none |
| Migration conventions: no `--` comments; small statements; strings without punctuation (`chr(58)` for a colon); `REVOKE ALL` from PUBLIC, anon, authenticated and service_role, **never an enumerated REVOKE** (the PG17 MAINTAIN defect); then explicit grants. Checkers live at `scripts/check-bos-*-migration.sql`, are read-only (`SET default_transaction_read_only = on`), and return `sort_order, check_name, status, detail` with a VERDICT row. Rollbacks live at `supabase/SQL Scripts/<n>_<name>_rollback.sql` and refuse to run if the table holds rows. Tier columns are plain text with no value list (20261005) | `20261017_business_os_credit_lots.sql`; `scripts/check-bos-credit-lots-migration.sql`; `supabase/SQL Scripts/20261017_business_os_credit_lots_rollback.sql`; `20261005` line 64 |
| Migration numbers: latest on main is `20261024`. No branch on origin uses 20261025 to 20261034 | `ls supabase/migrations`; `git ls-tree` over every remote branch |
| **`.env.example` is not tracked.** `.gitignore:38` ignores `.env*`. The main checkout has an untracked 174-line `.env.example` with 45 non-empty values; Dev did not read the values. No Stripe name is in it. The staging workplan's C2 (untracked) plans to complete it | `git check-ignore -v .env.example`; `docs/workplans/environment-readiness-staging.md` C2 |
| Env names the code reads: `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `STRIPE_CONNECT_WEBHOOK_SECRET`, `STRIPE_CLIENT_ID`, `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY`, `NEXT_PUBLIC_STRIPE_CLIENT_ID` | grep of `app lib components scripts` |
| The P-1 capture script exists. It is test-mode only and uses probe lookup keys. It has **not been run**: the resolver fixtures are hand-built. SA moved the real capture to **before P-2 code review**, because recognition first exists in P-2 | `scripts/capture-stripe-billing-fixtures.ts`; P-1 workplan, SA C-8 ruling |
| The repo's `.env.local` key belongs to a separate, empty Stripe sandbox ("AgentsPilot sandbox"), **not** the Stripe environment production uses. Production's database has processed only test-mode events (897, all `livemode = false`). Whether the Vercel production key is `sk_test_` or `sk_live_` is still owed (SA-P13 remainder) | TL brief; requirement §10.2 |

---

## 2. Scope

| In scope | Out of scope (where it lives) |
|---|---|
| Lookup-key config per tier, inside the entitlements config, with the retired-key list (CF-1) and its tests | Using the tier on a webhook (P-3b) |
| Filling the catalog from that config; a lookup key → tier helper; a CI test that the key count stays within the catalog's 10-key limit | Fetch-on-truncation (CF-2, before P-3b) |
| Script that creates the test-mode products and prices idempotently by lookup key, refusing non-`sk_test_` keys and the wrong Stripe account | Live-mode prices (go-live §9.5 #3 and #14) |
| `check-bos-plan-prices` script (read-only, both modes) and the pure comparison it uses, which P-3a's runtime check reuses (SA-P12 b) | The runtime check in the checkout route (P-3a) |
| Migration 20261025, pre-check SQL, checker SQL, rollback SQL, static migration test | Money history and the apply function (20261026, P-3b) |
| `BusinessOsBillingAccountRepository` with the `user_id`-scoped methods P-2 needs, plus tests | Lookups by Stripe subscription or customer id, the SR-5 checkout lock, and webhook updates (P-3a, P-3b: each added with its caller) |
| Customer helper split (Q-T8) with characterisation evidence of no agent-platform change; the Business OS customer function (`ensureBusinessOsStripeCustomer`) and the Stripe-mode helper, with no route calling them yet | Calling them from a checkout (P-3a) |
| Registry entries: purge `never`, `USER_OWNED_TABLES`, deletion policy `minimise` | The 409 `subscription_live` refusal on reset and deletion (P-7a, C-11) |
| Names-only `.env.example` Stripe section, including `STRIPE_BOS_PORTAL_CONFIGURATION_ID` (SA-P10) | The portal configuration script and its reader (P-7a) |
| Real fixture capture on the real plan prices, replacing the hand-built router fixtures (C-8, gate before code review) | Checkout-session fixtures (P-3a) |
| Converting `StripeService.ts`'s 2 `console.*` calls to Pino (CLAUDE.md § Logging: flagged here) | Any other change to StripeService. The Connect methods are untouched |

---

## 3. Design

### 3.1 Lookup keys and the tier they name (Q-T1, SA P-1 Q-4)

**File:** `lib/business-os/entitlements/config/planPrices.ts` (new, inside the config folder, so it may name tiers)

```typescript
export interface PlanStripePrice {
  /** The lookup key of the price we sell now. Identical in test and live mode (Q-T1). */
  readonly lookupKey: string;
  /** Lookup keys of earlier prices whose subscribers may still renew on them (CF-1). */
  readonly retiredLookupKeys: readonly string[];
}

export const PLAN_STRIPE_PRICES = {
  basic: { lookupKey: 'bos_plan_basic_monthly_usd', retiredLookupKeys: [] },
  pro:   { lookupKey: 'bos_plan_pro_monthly_usd',   retiredLookupKeys: [] },
} as const satisfies Record<TierId, PlanStripePrice>;

export function allPlanLookupKeys(): readonly string[];          // current + retired, deduplicated
export function tierForPlanLookupKey(key: string): TierId | null; // current or retired
```

- `satisfies Record<TierId, …>` means a new tier will not compile without a price entry. The tier procedure in `docs/architecture/BUSINESS_OS_ENTITLEMENTS.md` gains one step: "add its lookup key in `config/planPrices.ts`, run `scripts/setup-bos-plan-prices.ts`, then `check-bos-plan-prices`".
- The keys hold no version. A price change moves the **retired** price to a new key and leaves the current key on the new price (§3.2), so a key always names one sellable price.
- Cohorts (`trial`, `champion`) have no entry: they are not sold.
- The catalog is not per environment: the same keys exist in each mode (Q-T1).

### 3.2 Retired prices (CF-1)

**Problem.** When a price changes, the new price takes the lookup key. A subscriber still on the old price then renews with a price id that no key resolves to, and P-1's router would deny that renewal for good.

**Answer: retired lookup keys, not retired price ids.** Price ids differ between test and live mode. A list of ids would be the per-environment table that Q-T1 rejected. A lookup key can be changed on an existing price (`prices.update({ lookup_key })`), so the price-change procedure is:

1. Give the current price a retired key: `bos_plan_basic_monthly_usd_retired_<yyyymmdd>`. This frees the main key.
2. Create the new price with the main key.
3. Add the retired key to `retiredLookupKeys` for that tier in the **same PR** as any display-price change, and deploy it **before** step 1 is run in live mode.

`allPlanLookupKeys()` feeds the catalog, so the old price is recognised as a plan price, and `tierForPlanLookupKey` gives it its tier. Archived prices stay recognised (no `active` filter). Between steps 1 and 2 the main key resolves to nothing. The catalog logs `bos_billing_lookup_key_missing`, and P-3a's runtime price check refuses checkouts (it fails closed). Renewals on the old price still resolve through the retired key.

In P-2 both lists are **empty**, and nothing in P-2 changes a price. The setup script **refuses** to touch a price whose amount differs and prints this procedure (§3.5). Doing the change by hand is a go-live-era runbook item, written into the setup script's header and into the entitlements doc section above. A test asserts that every key is unique across tiers and lists, and that `allPlanLookupKeys().length <= 10`, so going over the catalog's 10-key limit fails CI instead of throwing on every production webhook.

### 3.3 Catalog changes

**File:** `lib/business-os/billing/planPriceCatalog.ts`

- `BOS_PLAN_LOOKUP_KEYS = allPlanLookupKeys()` (was `[]`). Header comment updated: "P-2 fills the list from `config/planPrices.ts`".
- New export `planTierForLookupKey` (a re-export of `tierForPlanLookupKey`) so P-3b reads tiers from the billing module and does not import the config directly.
- Nothing else changes (cache, refetch, failure rule).
- Registration: `planPriceCatalog.ts` is added to `KNOWN_NON_GATE_IMPORTERS` with `symbols: ['allPlanLookupKeys', 'tierForPlanLookupKey', 'TierId']`. Why: it maps Stripe price ids to plan names for the webhook router and refuses nothing by plan.

**Harness.** In both webhook suites, the fallback to the real catalog is replaced by an explicit empty map for scenarios that name no prices (`knownPlanPrices ?? {}`). The snapshots must stay **byte-identical** (SHA-256 recorded as in P-0/P-1). A guard asserts that no webhook test reaches `defaultStripe()`.

**Production effect of the filled list (inert, but not silent).** Once P-2 deploys, every platform `invoice.paid` and `invoice.payment_failed` triggers one cached `prices.list` call. That means the four agent-platform test subscriptions once a month, and the P1-C3 refetch on a miss. If the production key's environment **lacks** these prices, every load logs `bos_billing_lookup_key_missing` at `error` with `alert: true`. So creating the prices in **that** environment is a merge gate (§8), and so is knowing whether that key is test or live.

### 3.4 Price check (SA-P12 a; reused by P-3a for SA-P12 b)

**File:** `lib/business-os/billing/planPriceCheck.ts` (pure, no Stripe client)

```typescript
export interface PlanPriceFinding { tier: TierId; lookupKey: string; status: 'pass' | 'fail'; problems: string[]; priceId?: string; }
export function checkPlanPrices(input: {
  pricesByLookupKey: ReadonlyMap<string, StripePriceLike[]>; // every price Stripe returned per key
  expectedLivemode: boolean;
}): PlanPriceFinding[];
```

For each tier in `TIER_ORDER`, the price behind its current key must meet all of these:

- exactly one price returned;
- `active` is true;
- `type = 'recurring'`, `recurring.interval = 'month'`, `interval_count = 1`;
- `currency = 'usd'` (SR-15);
- `unit_amount = Math.round(presentation.monthlyPriceUsd * 100)`, and `monthlyPriceUsd * 100` must be an integer to within 1e-9, or the finding fails as "display price has sub-cent precision";
- `tax_behavior = 'exclusive'` (BQ-P5: "excluding tax");
- `livemode = expectedLivemode`.

Retired keys produce `info` lines (found or not found), never `fail`. Registration: `KNOWN_NON_GATE_IMPORTERS` entry, `symbols: ['TIER_MATRIX', 'TIER_ORDER', 'TierId', 'PLAN_STRIPE_PRICES']`. Why: it compares the display price with Stripe's price and refuses nothing by plan.

### 3.5 Scripts

All the scripts below:

- read the key from `--env <file>` (default `.env.local`) and never print it;
- print the mode, the Stripe account id (`acct_…`) and its dashboard display name, which are not secret;
- accept `--expect-account acct_…` and stop if the key belongs to a different account. This is the guard against the empty "AgentsPilot sandbox".

**`scripts/setup-bos-plan-prices.ts`** (creates test-mode objects)

- Refuses unless the key starts with `sk_test_`, and refuses any returned object with `livemode !== false`. A restricted key, an `sk_live_` key or a missing key exits 2 before any network call.
- `--expect-account` is **required**.
- Dry run by default: it prints what it would create. `--apply` creates.
- Product per tier: id `bos_plan_<tier>` (Stripe accepts a caller-chosen product id, which makes the step idempotent by id). The name is `presentation.labels.en` ("Essentials", "Autopilot", which customers see on checkout and receipts), with metadata `product: business_os_plan`. If the product exists but is archived, the script stops and reports.
- Price per tier: `prices.list({ lookup_keys: [key] })`. If a price exists and matches §3.4, it reports "unchanged". If it exists and differs, it **stops**, changes nothing, and prints the §3.2 procedure. If it is missing, it creates the price: `product`, `currency: 'usd'`, `unit_amount`, `recurring: { interval: 'month' }`, `tax_behavior: 'exclusive'`, `lookup_key`, nickname `bos <tier> monthly usd`, metadata `product: business_os_plan`, Stripe idempotency key `bos-plan-price:<lookupKey>:<unit_amount>`.
- It never sets `transfer_lookup_key`, never writes `user_id` / `credits` / `pilot_credits` metadata (C-3, CF-4), and creates no customer or subscription.
- At the end it runs the §3.4 check and prints the same table as `check-bos-plan-prices`.

**`scripts/check-bos-plan-prices.ts`** (read-only; npm script `check-bos-plan-prices`)

- Accepts `sk_test_`, `rk_test_`, `sk_live_` and `rk_live_`. A restricted read-only key is recommended for live mode at go-live (§9.5 #14).
- One `prices.list` call over `allPlanLookupKeys()`, then prints one PASS/FAIL row per tier, INFO rows for retired keys, and a VERDICT row. Exit code 1 on any FAIL.

**`scripts/capture-stripe-billing-fixtures.ts`** (extended, gate C-8)

- New `--plan-prices` mode: it subscribes test-clock customers to the **real** plan prices, which must already exist (it never creates them), instead of the probe prices.
- Outputs: `invoice.paid` (`subscription_create`, on `bos_plan_basic_monthly_usd`), a basic → pro upgrade proration `invoice.paid`, a renewal `invoice.paid` (`subscription_cycle`, clock advanced one month), and `invoice.payment_failed`. The unknown-price capture stays on the probe no-key price.
- P1-C7 rules as before: no forbidden metadata, an abort check, clocks deleted at the end, `--expect-account` required.
- Fixtures replace the hand-built ones, keeping their file names, and their `_fixture_source` becomes `CAPTURED <event id> <api_version> <date>`.
- The resolver suite gains a case that runs the **real** `planPriceCatalog` with an injected Stripe lister answering with the captured price ids, and expects `flow: 'plan'`.

### 3.6 Customer helper split (Q-T8, RD-3 as refined by SA-P1)

**File:** `lib/stripe/StripeService.ts`

```typescript
/** Shared, Stripe only. No database access, no product-specific side effect. */
async findOrCreatePlatformCustomer(params: {
  existingCustomerId?: string | null;
  email: string;
  name?: string;
  metadata: Record<string, string>;
  idempotencyKey?: string;
}): Promise<{ customerId: string; created: boolean; livemode: boolean }>;
```

- It reproduces today's semantics exactly. If `existingCustomerId` is set, it calls `customers.retrieve`. If the call resolves, the id is reused (including a `deleted: true` customer, today's quirk; see §14 Q-6). If it throws, the code warns and falls through. Otherwise it calls `customers.create({ email, name, metadata }, idempotencyKey ? { idempotencyKey } : undefined)`.
- **Placed above `getOrCreateCustomer`**, outside the slice the QA guard reads, and it takes no Supabase client, so the "three methods take a client" guard is unchanged.
- `getOrCreateCustomer(supabase, userId, email, name)` keeps its name and signature, and remains the **agent-platform caller**. It reads `user_subscriptions`, calls `findOrCreatePlatformCustomer({ existingCustomerId, email, name, metadata: { user_id: userId } })` **with no idempotency key** (adding one would change behaviour), then UPDATEs or INSERTs the same seed as today. The `user_subscriptions` statements are textually the same, so the QA guard's counts (4 / 3 / INSERT shape / no upsert) hold **unedited**.
- The `console.warn` inside it and the file's other `console.*` call become Pino (`createLogger({ module: 'StripeService' })`, `{ err }`). This is a logging-only change, flagged per CLAUDE.md § Logging: **2 calls in `lib/stripe/StripeService.ts`**. The user may decline it, and the rest of P-2 does not depend on it.

**Proof of no agent-platform behaviour change.** A characterisation suite, `lib/stripe/__tests__/getOrCreateCustomer.characterisation.test.ts`, records **on the unmodified code first** (task E1), with mocked Supabase and Stripe, the ordered calls and arguments for:

1. a row with a valid customer: retrieve, return;
2. a row whose retrieve throws: create with `metadata.user_id`, then UPDATE;
3. a row with `deleted: true`: reused;
4. no row: create, then INSERT with the hard-coded seed;
5. a row with a null customer id: create, then UPDATE;
6. a Stripe create error: rejects, no write;
7. `createBoostPackCheckout` end to end: the same customer id lands on the session.

After the refactor the snapshot must be byte-identical (SHA-256 before and after in the evidence log). The P-1 lockdown suites run unchanged.

**Business OS caller.** File: `lib/business-os/billing/businessOsStripeCustomer.ts`.

```typescript
export async function ensureBusinessOsStripeCustomer(
  input: { userId: string; email: string; name?: string },
  deps?: { repo?: BusinessOsBillingAccountRepository; stripe?: Pick<StripeService, 'findOrCreatePlatformCustomer'>; mode?: () => StripeMode },
): Promise<{ customerId: string; created: boolean }>;
```

- It reads the billing row for `(userId, current mode)`. If there is one, it returns its `stripe_customer_id` with **no Stripe call**.
- Otherwise it calls `findOrCreatePlatformCustomer` with metadata `{ product: 'business_os_plan', bos_user_id: userId }` (constants from `stripeMetadataKeys.ts`; never `user_id`, C-3) and Stripe idempotency key `bos-customer:<userId>` (Stripe keys are already separate per mode). Then `repo.recordCustomer({ userId, livemode: customer.livemode, stripeCustomerId })`.
- On a lost race (unique violation on `(user_id, livemode)`), it re-reads and returns the stored id. Within 24 hours the shared idempotency key makes both racers receive the same customer. A mode disagreement between the key prefix and the returned `livemode` throws (PF-15).
- **No route calls it in P-2.** P-3a wires it in with `userId` from the session.

**File:** `lib/business-os/billing/stripeMode.ts`. `stripeModeFromKey(key)` returns `'test'` for `sk_test_` / `rk_test_` and `'live'` for `sk_live_` / `rk_live_`, and throws otherwise. `currentStripeMode()` reads `STRIPE_SECRET_KEY`. P-3b's livemode check (PF-15) reuses it.

### 3.7 Repository

**File:** `lib/repositories/BusinessOsBillingAccountRepository.ts`. It follows `new-repository` (injected client, `{ data, error }`, never throws, Pino `service`, singleton) and the BOS repository style (types in the file, header that documents the service role).

| Method | Query | Notes |
|---|---|---|
| `findByUser(userId, livemode)` | `select(<explicit column list>)` · `.eq('user_id', userId)` · `.eq('livemode', livemode)` · `.maybeSingle()` | `null` when absent |
| `recordCustomer({ userId, livemode, stripeCustomerId })` | plain `insert({ user_id: userId, livemode, stripe_customer_id })` · `.select(<cols>)` · `.single()` | Explicit allow-list: no spread, no `id`, no upsert (tenant-isolation-guard Step 4). On `23505`: re-read with `findByUser`. If a row exists, return it with `created: false`. If none does, the conflict was on `stripe_customer_id` (another account holds that customer), so return an error and log `error` + `alert: true`, never a row |

- Service role, documented: the table has no client grant at all (SA-P1), so the repository uses `supabaseServer`. `userId` always comes from a server-side caller (session in P-3a, our own record in P-3b), never from request input.
- **No update or delete method in P-2.** The update methods arrive with their callers (P-3a lock, P-3b webhook mirror). There is no DELETE grant.
- A source guard lists the files allowed to import the repository (`businessOsStripeCustomer.ts` and tests), following the credit-lots precedent.
- Exported from `lib/repositories/index.ts`.

### 3.8 Registries (PF-14, registry part)

| Registry | Entry |
|---|---|
| `lib/business-os/purge/descriptors.ts` | `never('business_os_billing_accounts', U, 'The Business OS billing record …')`. Reason: a Reset that removed it would orphan a live Stripe subscription that keeps charging (PF-14) and lose the customer link. Keyed to `auth.users`, not `business_profiles` |
| `__tests__/classification-baseline.json` | `"business_os_billing_accounts": "never"`, `count` + 1. This is a reviewed addition: a new table, not a level change |
| `lib/business-os/businessOwnedTables.ts` `USER_OWNED_TABLES` | Reason: the commercial relationship with the person (the Stripe customer and subscription), which must survive any business Reset |
| `lib/business-os/account/accountDeletionPolicy.ts` `ACCOUNT_POLICY_EXCEPTIONS` | `minimise`. Financial record, retained and detached. `user_id` is `ON DELETE SET NULL` and service_role has no UPDATE on `user_id`, so the detach happens when the auth user is deleted. No `strip` (see §14 Q-3 on `stripe_customer_id`) |
| `accountDeletionPolicy.test.ts` | One case like S11-SQ-12's |

### 3.9 `.env.example` (PF-8, G-14)

A names-only Stripe section with empty values: `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `STRIPE_CONNECT_WEBHOOK_SECRET`, `STRIPE_CLIENT_ID`, `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY`, `NEXT_PUBLIC_STRIPE_CLIENT_ID`, `STRIPE_BOS_PORTAL_CONFIGURATION_ID`. Each has a one-line comment giving the mode rule: test key with test portal id, live key with live portal id. Lookup keys are code, not env (Q-T1).

**The file is not tracked today** (`.env*` is ignored). Dev's proposal (§14 Q-4): add `!.env.example` to `.gitignore` and commit a **new**, names-only file that starts with the Stripe section. **Never copy the main checkout's untracked file**, which holds values. Two consequences:

- Pulling `main` into the main checkout will then stop on its untracked `.env.example`. The user moves it aside first, a one-time step written in the PR description.
- The staging workplan's C2 later merges in the other names, names only.

---

## 4. Migration 20261025

**Files:**

- `supabase/migrations/20261025_business_os_billing_accounts.sql`
- `scripts/precheck-bos-billing-accounts-migration.sql`
- `scripts/check-bos-billing-accounts-migration.sql`
- `supabase/SQL Scripts/20261025_business_os_billing_accounts_rollback.sql`
- `supabase/migrations/__tests__/business-os-billing-accounts.migration.test.ts`

**Style (paste-file rules):** `BEGIN;` · `SET LOCAL lock_timeout = '5s';` · one statement per constraint · no `--` comments · no DO blocks · comment strings with no punctuation · `chr(95)` for `_` and `chr(58)` for `:` inside CHECK literals where a LIKE wildcard or editor mangling could bite · `COMMIT;`.

### 4.1 Table (SA-P1 columns, all created now so no later slice needs an ALTER)

| Column | Type | Null | Default | Note |
|---|---|---|---|---|
| `id` | uuid | NOT NULL | `gen_random_uuid()` | PK. **Surrogate, a change from SA-P1's `user_id` PK** (§14 Q-1) |
| `user_id` | uuid | NULL | — | FK `auth.users(id) ON DELETE SET NULL` (minimise, like the credit ledger) |
| `livemode` | boolean | NOT NULL | — | PF-15 |
| `stripe_customer_id` | text | NOT NULL | — | UNIQUE |
| `stripe_subscription_id` | text | NULL | — | UNIQUE |
| `subscription_status` | text | NULL | — | Stripe's status, display only (SA-P8) |
| `bought_tier` | text | NULL | — | From the lookup key. Plain text, no value list (20261005 precedent) |
| `current_period_end` | timestamptz | NULL | — | Stripe's, verbatim (PF-10) |
| `cancel_at_period_end` | boolean | NOT NULL | `false` | |
| `pending_tier` | text | NULL | — | Downgrade waiting for renewal |
| `open_checkout_session_id` | text | NULL | — | SR-5 lock |
| `open_checkout_expires_at` | timestamptz | NULL | — | SR-5 lock |
| `last_invoice_id` | text | NULL | — | |
| `last_paid_at` | timestamptz | NULL | — | |
| `last_payment_failed_at` | timestamptz | NULL | — | |
| `failed_attempts` | integer | NOT NULL | `0` | |
| `action_required_invoice_url` | text | NULL | — | |
| `founder_discount_applied_at` | timestamptz | NULL | — | |
| `ended_at` | timestamptz | NULL | — | |
| `created_at` | timestamptz | NOT NULL | `now()` | |
| `updated_at` | timestamptz | NOT NULL | `now()` | Set by the repository. No trigger (keeps the paste simple) |

### 4.2 Constraints and indexes (one `ALTER TABLE … ADD CONSTRAINT` each)

| Name | Definition |
|---|---|
| `…_pkey` | PRIMARY KEY (`id`) |
| `…_user_mode_key` | UNIQUE (`user_id`, `livemode`): one row per account **per mode**. Detached rows (NULL `user_id`) do not collide |
| `…_stripe_customer_id_key` | UNIQUE (`stripe_customer_id`) |
| `…_stripe_subscription_id_key` | UNIQUE (`stripe_subscription_id`) |
| `…_user_id_fkey` | FK → `auth.users (id) ON DELETE SET NULL` |
| `…_customer_id_shape` | `left(stripe_customer_id, 4) = 'cus' \|\| chr(95)` and length ≤ 255 |
| `…_subscription_id_shape` | NULL, or `left(…, 4) = 'sub' \|\| chr(95)` and length ≤ 255 |
| `…_checkout_id_shape` | NULL, or `left(…, 3) = 'cs' \|\| chr(95)` and length ≤ 255 |
| `…_invoice_id_shape` | NULL, or `left(…, 3) = 'in' \|\| chr(95)` and length ≤ 255 |
| `…_status_known` | NULL, or IN (`incomplete`, `incomplete_expired`, `trialing`, `active`, `past_due`, `canceled`, `unpaid`, `paused`) |
| `…_status_needs_subscription` | `subscription_status IS NULL OR stripe_subscription_id IS NOT NULL` |
| `…_tiers_length` | `bought_tier` and `pending_tier` each NULL or `char_length` between 1 and 64 |
| `…_checkout_lock_pair` | `(open_checkout_session_id IS NULL) = (open_checkout_expires_at IS NULL)` |
| `…_failed_attempts_not_negative` | `failed_attempts >= 0` |
| `…_action_url_shape` | NULL, or `left(…, 8) = 'https' \|\| chr(58) \|\| chr(47) \|\| chr(47)` and length ≤ 2048 |
| `…_updated_after_created` | `updated_at >= created_at` |
| index `…_mode_status_idx` | (`livemode`, `subscription_status`), for P-8a's list and MRR (current mode only) |

### 4.3 RLS and grants (server-write-only, SA-P1, L-29)

```text
ALTER TABLE … ENABLE ROW LEVEL SECURITY;            (no policy: no client role may read)
REVOKE ALL ON TABLE … FROM PUBLIC;                   (four separate statements; ALL covers
REVOKE ALL ON TABLE … FROM anon;                      MAINTAIN on PG17, TRUNCATE, REFERENCES,
REVOKE ALL ON TABLE … FROM authenticated;             TRIGGER; never an enumerated REVOKE)
REVOKE ALL ON TABLE … FROM service_role;
GRANT SELECT, INSERT ON TABLE … TO service_role;
GRANT UPDATE (stripe_subscription_id, subscription_status, bought_tier, current_period_end,
  cancel_at_period_end, pending_tier, open_checkout_session_id, open_checkout_expires_at,
  last_invoice_id, last_paid_at, last_payment_failed_at, failed_attempts,
  action_required_invoice_url, founder_discount_applied_at, ended_at, updated_at)
  ON TABLE … TO service_role;
```

There is no DELETE grant. **UPDATE is column-level**, a narrowing of SA-P1's table-level UPDATE (§14 Q-2): `id`, `user_id`, `livemode`, `stripe_customer_id` and `created_at` can never be rewritten, so a row cannot be handed to another account or mode. The FK's `SET NULL` still runs on account deletion, because referential actions do not need the column grant (the same mechanism as the credit ledger). Table and column `COMMENT`s carry no punctuation.

### 4.4 Pre-check (read-only, run first)

`scripts/precheck-bos-billing-accounts-migration.sql`: one SELECT of `UNION ALL` rows plus VERDICT, no DO block.

- PASS if `business_os_billing_accounts` does not exist.
- PASS if none of the planned constraint or index names exists in `public`.
- PASS if `auth.users` exists.
- PASS if `gen_random_uuid` exists.
- PASS if the roles `anon`, `authenticated` and `service_role` exist.
- PASS if `business_os_account_plans` exists (sanity check: this is the right database).
- INFO: `server_version`, and whether this server has the MAINTAIN privilege.
- INFO: the default privileges for new tables in `public`, as `pg_default_acl` grantees, so the user can see what `REVOKE ALL` removes.

It starts with `SET default_transaction_read_only = on;`. **The migration must therefore be pasted into a new SQL editor tab**, or it fails as read-only. This is written at the top of the file and in §8.

### 4.5 Checker (read-only, after the migration)

`scripts/check-bos-billing-accounts-migration.sql`, in the credit-lots checker shape: `aclexplode` at table and column level.

| # | Check |
|---|---|
| B1 | Table exists; RLS on; **zero policies** |
| B2 | Column list, types, nullability and defaults equal §4.1, compared as one ordered string |
| B3 | Every §4.2 constraint exists, by name and type; the FK targets `auth.users` with `confdeltype = 'n'` (SET NULL); the unique constraints cover the stated columns |
| B4 | Index `…_mode_status_idx` exists on (`livemode`, `subscription_status`) |
| B5 | PUBLIC, anon and authenticated hold **no** table or column privilege |
| B6 | service_role table privileges are exactly SELECT and INSERT |
| B7 | service_role column UPDATE is exactly the 16 columns of §4.3, and none on `id`, `user_id`, `livemode`, `stripe_customer_id` or `created_at` |
| B8 | No non-owner holds DELETE, TRUNCATE, REFERENCES, TRIGGER or MAINTAIN |
| B9 | INFO: row count by `livemode` (expected 0 and 0) |
| B10 | INFO: checked at (UTC) |

The VERDICT row is PASS only when no row is FAIL.

### 4.6 Rollback

`supabase/SQL Scripts/20261025_business_os_billing_accounts_rollback.sql`:

1. `BEGIN`; `lock_timeout`;
2. `LOCK TABLE … ACCESS EXCLUSIVE`;
3. a guard that raises `ROLLBACK REFUSED  the billing accounts table holds rows so nothing was dropped` if any row exists (the one small DO block, as the credit-lots rollback has; §14 Q-7);
4. `DROP TABLE`; `COMMIT`.

### 4.7 Order, and whether merging first is safe

**The user applies it by hand:** pre-check (VERDICT PASS) → migration (new tab) → checker (VERDICT PASS, rows pasted back) → merge.

**Is merging before the migration safe?** Technically yes. In P-2 **nothing at runtime touches the table**: the repository's only caller (`ensureBusinessOsStripeCustomer`) has no route caller, and the registry tests read the migration **file**, not the database. Dev still recommends **migration and checker PASS before merge**, as for every earlier migration, because the merged code describes a table that would otherwise not exist. **P-3a must not merge without the checker PASS on record**, since it is the first caller.

The migration is safe to apply before the code deploys: it is a new, empty table that no current code reads.

---

## 5. Files to create / modify

| File | Action | Reason |
|---|---|---|
| `supabase/migrations/20261025_business_os_billing_accounts.sql` | create | §4 |
| `scripts/precheck-bos-billing-accounts-migration.sql` | create | §4.4 |
| `scripts/check-bos-billing-accounts-migration.sql` | create | §4.5 |
| `supabase/SQL Scripts/20261025_business_os_billing_accounts_rollback.sql` | create | §4.6 |
| `supabase/migrations/__tests__/business-os-billing-accounts.migration.test.ts` | create | Static checks: paste rules, REVOKE ALL × 4, no enumerated REVOKE, no policy, no DELETE grant, no authenticated grant, column UPDATE list, column set equals §4.1 and equals the repository's select list, FK SET NULL, checker covers MAINTAIN, rollback refuses on rows |
| `lib/business-os/entitlements/config/planPrices.ts` | create | §3.1, §3.2 |
| `lib/business-os/entitlements/__tests__/planPrices.test.ts` | create | Every tier has an entry; keys unique; ≤ 10 keys; `tierForPlanLookupKey` for current, retired and unknown keys |
| `lib/business-os/billing/planPriceCatalog.ts` | modify | Keys from config; tier helper re-export (§3.3) |
| `lib/business-os/billing/__tests__/planPriceCatalog.test.ts` | modify | Default list equals `allPlanLookupKeys()`; retired price recognised |
| `lib/business-os/billing/planPriceCheck.ts` | create | §3.4 |
| `lib/business-os/billing/__tests__/planPriceCheck.test.ts` | create | Each failure reason; pass; sub-cent display price; duplicate price for one key; retired key is info only |
| `lib/business-os/billing/stripeMode.ts` + test | create | §3.6 |
| `lib/business-os/billing/businessOsStripeCustomer.ts` + test | create | §3.6 |
| `lib/repositories/BusinessOsBillingAccountRepository.ts` | create | §3.7 |
| `lib/repositories/__tests__/BusinessOsBillingAccountRepository.test.ts` | create | Each method; wrong-user read; injected fields dropped; 23505 paths; importer guard |
| `lib/repositories/index.ts` | modify | Export |
| `lib/stripe/StripeService.ts` | modify | `findOrCreatePlatformCustomer`; `getOrCreateCustomer` delegates; 2 × `console.*` → Pino |
| `lib/stripe/__tests__/getOrCreateCustomer.characterisation.test.ts` (+ snapshot) | create | §3.6 proof; recorded before the refactor |
| `lib/business-os/entitlements/__tests__/enforcementPoints.test.ts` | modify | Two `KNOWN_NON_GATE_IMPORTERS` entries (`planPriceCatalog.ts`, `planPriceCheck.ts`) |
| `lib/business-os/purge/descriptors.ts`, `lib/business-os/purge/__tests__/classification-baseline.json` | modify | §3.8 |
| `lib/business-os/businessOwnedTables.ts` | modify | §3.8 |
| `lib/business-os/account/accountDeletionPolicy.ts` + its test | modify | §3.8 |
| `app/api/stripe/webhook/__tests__/connectPath.characterisation.test.ts`, `routerEdgeCases.qa.test.ts` | modify | Empty map instead of the real-catalog fallback; snapshots byte-identical (§3.3) |
| `scripts/setup-bos-plan-prices.ts` | create | §3.5 |
| `scripts/check-bos-plan-prices.ts` | create | §3.5 |
| `scripts/capture-stripe-billing-fixtures.ts` | modify | `--plan-prices`, `--expect-account` (§3.5) |
| `lib/business-os/billing/__tests__/fixtures/stripe/*.json` | replace | Captured payloads (gate C-8) |
| `lib/business-os/billing/__tests__/planInvoiceResolver.test.ts` | modify | Real-catalog recognition case; source assertion becomes `CAPTURED` |
| `package.json` | modify | `"check-bos-plan-prices": "tsx scripts/check-bos-plan-prices.ts"` |
| `.env.example`, `.gitignore` | create / modify | §3.9, pending §14 Q-4 |
| `docs/architecture/BUSINESS_OS_ENTITLEMENTS.md` | modify | Tier procedure step; price-change procedure (§3.2); Change History |
| `docs/requirements/BUSINESS_OS_PLAN_PAYMENTS_REQUIREMENT.md` | modify | §9.4 CF-1 marked answered (pointer to §3.2); Change History |

---

## 6. Task list

**Phase A: preconditions**
- [x] A1. ✅ Branch `feature/bos-plan-payments-p2` confirmed at `origin/main` `2fb98a74`. (Done at kickoff, before this workplan.)
- [ ] A2. TL records the 20261025 use with the Credits Boost and credit-deduction sessions (G-11).
- [ ] A3. TL asks the user for the §8 inputs (Stripe environment, key handling, account id, SA-P13 key prefix, go-ahead). The code can be built without them. The capture and the price creation cannot.

**Phase B: migration**
- [x] B1. ✅ (P-2a) Migration (§4.1 to §4.3).
- [x] B2. ✅ (P-2a) Pre-check SQL (§4.4).
- [x] B3. ✅ (P-2a) Checker SQL (§4.5).
- [x] B4. ✅ (P-2a) Rollback SQL (§4.6).
- [x] B5. ✅ (P-2a) Static migration test.

**Phase C: config and catalog**
- [ ] C1. (P-2b) `config/planPrices.ts` + tests.
- [ ] C2. (P-2b) Catalog takes its keys from the config and gains the tier helper; catalog tests updated.
- [ ] C3. (P-2b) Webhook harness and QA suite pinned to an empty map; snapshots byte-identical (SHA-256 before and after).
- [ ] C4. (P-2b) `KNOWN_NON_GATE_IMPORTERS` entries; entitlements doc steps.

**Phase D: repository**
- [x] D1. ✅ (P-2a) `BusinessOsBillingAccountRepository` + index export.
- [x] D2. ✅ (P-2a) Tests (each method, wrong user, injected fields, both 23505 paths, importer guard).

**Phase E: customer split**
- [x] E1. ✅ (P-2a) Characterisation suite for `getOrCreateCustomer` / `createBoostPackCheckout` recorded on the **unmodified** file; SHA-256 recorded.
- [x] E2. ✅ (P-2a) Extract `findOrCreatePlatformCustomer`; `getOrCreateCustomer` delegates. Snapshot byte-identical; P-1 lockdown suites green **unedited**.
- [x] E3. ✅ (P-2a; the user may still decline, P2-C5) `StripeService.ts` 2 × `console.*` → Pino (unless the user declines).
- [x] E4. ✅ (P-2a) `stripeMode.ts`, `businessOsStripeCustomer.ts` + tests.

**Phase F: price scripts**
- [ ] F1. (P-2b) `planPriceCheck.ts` + tests.
- [ ] F2. (P-2b) `setup-bos-plan-prices.ts`. Refusals verified with no network: `sk_live_`, `rk_test_`, missing key, missing `--expect-account`.
- [ ] F3. (P-2b) `check-bos-plan-prices.ts` + npm script.
- [ ] F4. (P-2b) Capture script `--plan-prices` and `--expect-account`.

**Phase G: registries and env**
- [x] G1. ✅ (P-2a) Purge descriptor + baseline.
- [x] G2. ✅ (P-2a) `USER_OWNED_TABLES`.
- [x] G3. ✅ (P-2a) Deletion policy + test.
- [x] G4. ✅ (P-2a) Per SA Q-4: no `.env.example` / `.gitignore` change; the seven Stripe names and their mode rule are a table in `BUSINESS_OS_ENTITLEMENTS.md` § Billing, and requirement §9.1 P-2 says so.

**Phase H: gates that need the user** (order matters; §8)
- [ ] H1. (P-2a, owed by the user before merge, P2-C6) User runs the pre-check, migration and checker; the checker's VERDICT PASS rows are recorded in the evidence log.
- [ ] H2. (P-2b) With the go-ahead and the right environment: `setup-bos-plan-prices --apply`, then `check-bos-plan-prices` PASS (both $79 / $129, tax exclusive).
- [ ] H3. (P-2b) Capture `--plan-prices` (**before P-2 deploys**), fixtures replaced, and the P1-C7 read-only production check (no `user_subscriptions` write for the capture event ids; those events show as `unknown_price` denials, because production's list is still empty).

**Phase I: verification**
- [x] I1. ✅ (P-2a, see evidence log) `npx jest lib/business-os/billing lib/business-os/entitlements lib/stripe lib/repositories lib/business-os/purge lib/business-os/account lib/business-os/__tests__/businessOwnedTables.test.ts app/api/stripe supabase/migrations/__tests__ --ci`
- [x] I2. ✅ (run although P-2a imports nothing from entitlements) `npm run test:bos-entitlements` (required: new importers and a new config file).
- [x] I3. ✅ Scoped `npx tsc --noEmit` over changed files. ts-jest does not type-check here, so this is the type gate.
- [x] I4. ✅ `npm run lint` on changed files.
- [x] I5. ✅ (P-2a) Evidence log, status set to Code Complete, uncommitted.

**34 tasks.**

---

## 7. Test plan

| Suite | Cases |
|---|---|
| `planPrices` | Each `TIER_ORDER` tier has an entry; no key repeats across tiers or between current and retired lists; `allPlanLookupKeys()` ≤ 10 and deduplicated; `tierForPlanLookupKey` returns the tier for a current key and for a retired key (on a test-local config), and `null` for an unknown key or a probe key |
| `planPriceCatalog` | Default keys equal the config; a price behind a retired key is in `byPriceId`; empty-list behaviour kept through an injected `lookupKeys: []` |
| `planPriceCheck` | Pass; each failure on its own (not exactly one, inactive, interval, interval_count, currency, amount, tax_behavior, livemode); sub-cent display price; retired key missing → info, not fail; amounts read from `TIER_MATRIX.presentation` (a mutated display price makes the check fail) |
| `stripeMode` | Four prefixes; anything else throws; a missing env throws |
| `businessOsStripeCustomer` | Row present → no Stripe call; absent → create with BOS metadata (no `user_id` key), idempotency key `bos-customer:<id>`, row recorded with the returned `livemode`; race 23505 → stored id returned; key/object mode disagreement → throws, nothing recorded; Stripe error → rejects, nothing recorded |
| `BusinessOsBillingAccountRepository` | `findByUser`: found, absent, other user's row not returned (filter asserted), select list equals the migration columns; `recordCustomer`: insert payload is exactly three fields (an injected `id`/`user_id` in extra input is impossible by type, and asserted dropped at runtime), success, 23505 with own row → `created: false`, 23505 with no own row → error + `alert`, other error → `{ data: null, error }` |
| `getOrCreateCustomer` characterisation | §3.6 scenarios 1 to 7, before and after, byte-identical |
| Lockdown QA suites | Unchanged and green |
| Webhook harness + QA suite | Snapshots byte-identical; a guard asserts no webhook test reaches the real Stripe lister |
| `planInvoiceResolver` (captured fixtures) | Real catalog with an injected lister → the captured basic invoice → `flow: plan`, `lookupKeys: ['bos_plan_basic_monthly_usd']`; proration and renewal → `flow: plan`; unknown → `deny unknown_price`; every fixture `api_version` is `2025-10-29.clover` and states `CAPTURED` |
| Registries | `businessOwnedTables` (classifies every `user_id` table, which now includes this one), `descriptors.invariant` (baseline), `accountDeletionPolicy` (minimise via SET NULL, no strip) |
| Migration static test | §5 row |
| `enforcementPoints` / `tierLiteral` | Green through `npm run test:bos-entitlements` |

**Acceptance mapping:**

| P-2 "done means" | Evidence |
|---|---|
| Test prices with lookup keys for `basic` and `pro` | H2 output |
| `check-bos-plan-prices` shows $79 / $129 equal to `presentation` | H2 output + `planPriceCheck` tests |
| Table with the full column set; checker passes | H1 rows + migration test |
| In the purge and deletion registries | §3.8 tests |
| Every billing row carries `livemode` | NOT NULL column, unique `(user_id, livemode)`, B2 |
| `.env.example` incl. portal config id | G4 diff |
| Customer helper split, no agent-platform change | E1/E2 SHA-256 |
| CF-1 answered | §3.2 + retired-key tests |
| C-8 real fixtures | H3 event ids in the evidence log |

The route rule (happy path, auth failure and invalid input) does not apply: P-2 adds no route.

---

## 8. Gates and what the user must provide

| Gate | When | Shown by |
|---|---|---|
| C-4 SA-P13 query | Before this workplan | Requirement §10.2 ✅ |
| SA workplan review | Before code | SA Review below |
| **Migration applied:** pre-check PASS → migration → checker PASS | **Before merge** (strongly recommended; §4.7) and **mandatory before P-3a merges** | Checker rows in the evidence log |
| **Plan prices exist in the Stripe environment production's key uses**, and `check-bos-plan-prices` passes there | **Before merge.** Otherwise production logs `lookup_key_missing` at `error` on every catalog load (§3.3) | H2 output |
| **Real fixture capture (C-8)** + P1-C7 production check | **Before SA code review** (SA's P-1 ruling) and **before P-2 deploys** (after deploy, the capture events would be recognised with no handler, and Stripe would retry them for 3 days) | H3 event ids |
| `npm run test:bos-entitlements` green | Before handover | Evidence log |
| User sees the diff, QA pass, user approval | Before RM commits | Standing flow |

**What the user must provide** (TL collects it; none of it is pasted into a chat or a doc):

1. **The Stripe environment production uses.** The repo's `.env.local` key belongs to the empty "AgentsPilot sandbox", so it is the wrong one. The user names the environment as the dashboard shows it, and gives its **account id** (`acct_…`, from Settings → Business → Account details; not secret). The scripts take it as `--expect-account` and stop on any other account.
2. **Its test-mode secret key (`sk_test_…`), handled in one of two ways:**
   - (a) the user saves it in a local file **outside the repo**, for example `C:\Users\Barak\stripe-bos-test.env` containing one line `STRIPE_SECRET_KEY=…`, and tells TL only the path. Dev runs the scripts with `--env <path>`; they never print the key.
   - (b) the user runs the three commands themselves (exact commands in the PR description) and pastes back only the output, which contains no secret.
3. **SA-P13 remainder:** a look, not a copy, at whether the Vercel **production** `STRIPE_SECRET_KEY` starts `sk_test_` or `sk_live_`. Also whether its **last four characters** match a key in the environment named in item 1 (Dashboard → Developers → API keys shows the ending). If production is `sk_live_`, the price gate above cannot be met until live prices exist (go-live), so P-2 must merge with the list gated by mode (§14 Q-5).
4. **Go-ahead for the effects in that environment:**
   - two products and two prices, **permanent**; they are the real plan prices;
   - for the capture, temporary test-clock customers and subscriptions. Their events are **delivered to production's webhook**, which denies them as `unknown_price` and writes a `processed_webhook_events` row each, as every test event already does. The clocks are deleted at the end.
5. **The migration, applied by hand** in the Supabase SQL editor: pre-check, then the migration **in a new tab**, then the checker. Paste back the checker's rows.
6. **If not already recorded from P-1:** the Q-5 endpoint API version. The captured fixtures assert `2025-10-29.clover`.

---

## 9. Tenant isolation

`tenant-isolation-guard` applies to the repository (service role) and to the Stripe customer (an id another account could hold).

| Skill rule | P-2 |
|---|---|
| Service role + caller-supplied id | The repository only takes `userId` from server code. In P-2 its one caller is unwired; P-3a passes the session's user id. No method takes a Stripe id as a lookup key yet |
| Explicit allow-list on create | `recordCustomer` builds a three-field payload; no spread, no `id`, no upsert; tested |
| Scope-defeating three | No trigger; no upsert; no caller payload forwarded |
| A row moving between accounts | DB-level: no UPDATE grant on `user_id`, `livemode` or `stripe_customer_id`, and no DELETE (B7, B8). App-level: a customer id held by another account is an error, never a returned row |
| Metadata | BOS customer metadata carries `bos_user_id` as a cross-check only and never `user_id` (C-3). Nothing reads metadata to pick an account |
| Test | Wrong-user read returns nothing; injected fields dropped; foreign-customer 23505 returns an error with no row |

---

## 10. Risks

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| Prices created in the wrong Stripe environment (the empty sandbox) | Medium without a guard | Medium: production never recognises a real plan invoice | Required `--expect-account`; account id and display name printed; `check-bos-plan-prices` run against the production-used environment is a merge gate |
| Production key is `sk_live_` | Unknown (SA-P13 remainder) | Error-log noise on every catalog load; recognition impossible until live prices exist | §8 item 3 before merge; §14 Q-5 contingency |
| Capture run after P-2 deploys | Low | Low: no handler means no writes, but 3 days of retries and failed claim rows | Gate H3 before deploy; written in the script header |
| `tax_behavior` set wrong on a price | Low | High in live mode (it cannot be changed) | Script hard-codes `exclusive` per BQ-P5; the check asserts it; test mode only in P-2 |
| Agent-platform customer path changes subtly | Low | Low (platform parked) | Characterisation before and after; lockdown QA suites unedited |
| Harness snapshots drift once the list is filled | Certain if unhandled | Low | C3 pins an empty map; SHA-256 equality |
| `.env.example` collides with the main checkout's untracked file on pull | Certain if tracked | Low | One-time "move it aside" step; never copy its values (§3.9) |
| The ten-key catalog limit is reached through retired keys | Very low | High (every platform invoice webhook throws) | CI test ≤ 10; P-3b may add chunking if ever needed |
| Display price changed without the Stripe price | Low | High after go-live (charged ≠ shown) | `check-bos-plan-prices`; P-3a runtime check fails closed |

---

## 11. Demo

1. `npm run check-bos-plan-prices -- --env <path> --expect-account <acct>` against the production-used test environment shows mode `test` and the account, `basic` PASS `bos_plan_basic_monthly_usd` $79.00 USD month exclusive = presentation 79, `pro` PASS $129.00 = 129, and VERDICT PASS.
2. `npx tsx scripts/setup-bos-plan-prices.ts … --apply` run a second time reports "unchanged" for both, and creates nothing. With an `sk_live_` key, or a different `--expect-account`, it refuses and exits 2.
3. Change `monthlyPriceUsd` to 80 locally: the check FAILs on `basic` with "unit_amount 7900 ≠ display 8000". Revert.
4. Supabase SQL editor: the checker's VERDICT PASS and its B1 to B10 rows (from H1).
5. `npx jest lib/business-os/billing/__tests__/planInvoiceResolver.test.ts`: a **captured** `invoice.paid` on `bos_plan_basic_monthly_usd`, read through the real catalog, resolves to `flow: plan`. That is what P-3a's demo then shows live.
6. The characterisation snapshot hash for the agent-platform customer path, identical before and after.

There is no app demo and no deployment: nothing in P-2 runs in a request.

---

## 12. Sizing

**3 to 3.5 days.** This is the top of the slice range.

| Part | Estimate |
|---|---|
| Migration, pre-check, checker, rollback, static test | 0.75 d |
| Config, catalog, harness pin, registration | 0.5 d |
| Repository + tests | 0.25 d |
| Customer split (characterisation first), BOS customer, stripe mode | 0.5 d |
| Price check, setup and check scripts, capture extension | 0.5 d |
| Registries, env, docs | 0.25 d |
| Gates with the user (prices, capture, fixtures), evidence | 0.5 d (elapsed time depends on §8) |

**Split if needed (§14 Q-8):**

- **P-2a, "Billing record":** migration, repository, registries, customer split, `.env.example`. It needs only the migration from the user.
- **P-2b, "Plan prices":** config, catalog fill, check, scripts, capture. It needs the Stripe inputs.

The split is clean: P-2a fills no lookup key, so production is unchanged. Recommended if the §8 Stripe inputs are not available when coding starts, so the database half is not held up.

---

## 13. Rollback

- **Code:** revert the PR. The catalog list goes back to empty, so the router recognises nothing again, which is P-1's state. Nothing reads the table. Safe at any time before P-3a deploys.
- **Database:** the rollback script drops the table and refuses if it holds rows. With no caller, it holds none.
- **Stripe:** the test products and prices stay; they are harmless without a checkout. To remove them, archive them in the dashboard. The lookup keys are then free, and a later run recreates them.
- No feature flag: nothing in P-2 is reachable from a request.

---

## 14. Questions for SA

| # | Question | Dev's proposal |
|---|---|---|
| Q-1 | SA-P1 says `user_id` PK. Two facts conflict with that. (a) A PK cannot be NULL, but SA also ruled "minimised on erasure like the credit ledger", which is `ON DELETE SET NULL`. (b) PF-15 puts test- and live-mode customers in one database: an account that bought in test mode (a designated test account, or production while its key is `sk_test_`) could then never get a live row | **Surrogate `id` PK, `user_id` nullable with `ON DELETE SET NULL`, UNIQUE `(user_id, livemode)`.** It keeps one row per account per mode, allows detach, and P-8a reads `WHERE livemode = <current>` anyway |
| Q-2 | SA-P1 grants service_role table-level UPDATE | **Column-level UPDATE** on the 16 mutable columns; never on `id`, `user_id`, `livemode`, `stripe_customer_id` or `created_at` (§4.3). A row cannot be moved between accounts or modes even by a service-role bug. P-3a/P-3b update only listed columns |
| Q-3 | After erasure the row keeps `stripe_customer_id`, a pseudonymous link to a Stripe customer that holds the email | Keep it: it is needed to reconcile with Stripe's own records, and the person's data lives at Stripe, whose deletion is a P-7a/PF-14 question (refused while subscribed; afterwards, deleting the Stripe customer is a separate decision). No `strip` |
| Q-4 | `.env.example` is untracked and ignored (`.env*`); the main checkout has a valued copy | Add `!.env.example`, commit a **new names-only** file starting with the Stripe section, and leave the rest to staging C2. Alternative: document the names in a doc table and leave the file to C2, which would not literally meet PF-8 |
| Q-5 | If production's key is `sk_live_` (SA-P13 remainder), filling the catalog list in P-2 produces `error` logs until live prices exist | Then fill the list only when `stripeModeFromKey(STRIPE_SECRET_KEY) === 'test'`, until go-live, and remove that condition at P-12. If production is `sk_test_` (likely: 897/897 test events), no condition is needed |
| Q-6 | `customers.retrieve` of a deleted customer resolves (`deleted: true`) and is reused today | Keep the quirk for the agent platform (no behaviour change). The BOS caller never retrieves: it trusts our row. A Stripe "No such customer" or deleted customer at checkout is handled in P-3a (clear the row's customer, recreate) |
| Q-7 | The rollback refusal is a small DO block, as in the credit-lots rollback | Keep it. Rollback is rare, and refusing on rows matters more than paste purity. Alternative: a separate read-only "rows exist?" SELECT the user runs first |
| Q-8 | Ship as one PR (3 to 3.5 days) or as P-2a / P-2b | One PR if the §8 Stripe inputs are in hand when coding starts; otherwise split as §12 |
| Q-9 | Repository scope: only `findByUser` and `recordCustomer` now | Yes. Lookups by Stripe id, the lock, and the mirror updates land with their callers (P-3a/P-3b), each in its own review |
| Q-10 | Lookup key names `bos_plan_basic_monthly_usd` / `bos_plan_pro_monthly_usd`; retired form `<key>_retired_<yyyymmdd>`; product ids `bos_plan_<tier>`; product name = `presentation.labels.en` | As stated. The names are permanent in live mode, so this is the moment to object |
| Q-11 | `ensureBusinessOsStripeCustomer` in P-2 with no route caller, or move it to P-3a | P-2: it is the BOS half of the Q-T8 split, it exercises the repository, and it keeps P-3a's diff on checkout logic |

---

## Evidence log

*(Dev fills this during implementation: base SHA, harness and characterisation SHA-256 before and after, checker rows, price-check output, captured event ids, test commands and results.)*

### P-2a (Dev, 2026-10-04)

**Base:** `origin/main` `2fb98a74` (re-fetched at the end of the work: unchanged). All work uncommitted in worktree `neuronforge-invite-s0`, branch `feature/bos-plan-payments-p2`. Nothing applied to any database; no Stripe call made.

**Characterisation (P2-C4).** `lib/stripe/__tests__/getOrCreateCustomer.characterisation.test.ts`, 7 scenarios (§3.6 1 to 7), records Stripe and Supabase calls only (logger mocked, `console` silenced and not recorded). SHA-256 of `__snapshots__/getOrCreateCustomer.characterisation.test.ts.snap`:

| Point | SHA-256 |
|---|---|
| E1, recorded on the unmodified `StripeService.ts` | `826489d835d48736db9560e026c5b0ae9a3ee3b8dcde500c4c143c50192ed359` |
| E2, after the split (`findOrCreatePlatformCustomer` extracted) | `826489d835d48736db9560e026c5b0ae9a3ee3b8dcde500c4c143c50192ed359` (identical) |
| E3, after the Pino conversion of the 2 `console.*` calls | `826489d835d48736db9560e026c5b0ae9a3ee3b8dcde500c4c143c50192ed359` (identical) |

The P-1 lockdown suites (`userSubscriptionsWriteLockdown.qa.test.ts`, `userSubscriptionsWriteLockdownMigration.test.ts`) ran **unedited** and green after E2 and after E3. The split keeps a one-argument `customers.create(...)` when there is no idempotency key, so the agent-platform call is unchanged byte for byte.

**Tests.**

| Command | Result |
|---|---|
| `npx jest lib/business-os/billing lib/business-os/entitlements lib/stripe lib/repositories lib/business-os/purge lib/business-os/account lib/business-os/__tests__ app/api/stripe supabase/migrations/__tests__ scripts/__tests__ --ci` | 150 suites, 3,156 tests, 33 snapshots: all pass |
| `npm run test:bos-entitlements` | 107 suites, 2,501 tests: all pass |
| Scoped `tsc --noEmit` (a scratch tsconfig extending the repo's, `files` = the 15 changed or new TS files) | 0 errors in changed files. 2 pre-existing errors in files reached through the barrel (`lib/pilot/insight/MemoryManager.ts`, `lib/repositories/CalibrationSessionRepository.ts`), untouched. A full `tsc -p tsconfig.json` runs out of memory on this machine |
| `npx eslint` on the 15 changed or new TS files | 0 errors, 0 warnings |

**Migration execution.** No PGlite or local Postgres exists in this repo or on this machine, so the SQL is proven by the static guard `supabase/migrations/__tests__/business-os-billing-accounts.migration.test.ts` (73 cases) and, for real, by the user's paste (H1).

**Deviations from the workplan text (all from SA rulings or paste rules).**

1. Q-1, Q-2 / P2-C1: surrogate PK, nullable `user_id`, UNIQUE (`user_id`, `livemode`); UPDATE on **17** columns incl. `stripe_customer_id`; checker B7 proves the 4 immutable columns (`id`, `user_id`, `livemode`, `created_at`).
2. P2-C2: no `_updated_after_created` CHECK. So 10 CHECKs, 15 constraints.
3. Q-4: no `.env.example` / `.gitignore` change; doc table instead (G4).
4. §4.4 said the "new tab" warning is written at the top of the pre-check. The paste files carry no comments, so the pre-check's VERDICT row says it instead (`paste the migration into a NEW tab`).
5. P2-C9 (`--env` refuses a path inside the repo): no P-2a file takes `--env`. It applies to P-2b's scripts.
6. The repository also refuses a non-uuid account, a non-boolean mode and a customer id not shaped `cus_…` before querying (fail closed), and maps rows strictly (an unknown status is an error, never a guess).
7. `ensureBusinessOsStripeCustomer` fails closed on an unreadable billing row (no Stripe call), and treats a `null` livemode as a mode disagreement (P2-C3). An `idempotency_error` rejects and records nothing (P2-C8).

**Owed before P-2a merges (P2-C6):** the user runs `scripts/precheck-bos-billing-accounts-migration.sql` (VERDICT PASS), then `supabase/migrations/20261025_business_os_billing_accounts.sql` in a **new** SQL editor tab, then `scripts/check-bos-billing-accounts-migration.sql`, and pastes the checker rows here.

**SA code review M-1, fixed by Dev (2026-10-04).** `app/api/stripe/webhook/__tests__/routerPlacement.guard.test.ts`: the P1-C6 test is now titled "billing modules touch the database only through the allow-listed repository caller (SA P1-C6, P-2a M-1)". Besides the existing `supabase` / `.from(` check, it fails when any file in `lib/business-os/billing/` imports a repository (the `@/lib/repositories` barrel, any file under it, or a relative path into it; static, type-only, `export … from`, `import()` and `require()`, read from the AST), unless the file is on `BILLING_REPOSITORY_CALLERS = ['businessOsStripeCustomer.ts']`. It also asserts that the allow-listed file really is the one importing the repository. A negative-control test feeds seven injected import forms to the same function. Proof it bites on the real tree: `planPriceCatalog.ts` was copied to the scratchpad, an `import type … from '@/lib/repositories'` line was prepended, and the guard FAILED naming `planPriceCatalog.ts`. The file was then restored from the copy, `cmp` showed it identical, `git status` showed it clean, and the guard passed (12/12). Because the guard names the repository module path, it was added to the repository's caller allow-list (`BusinessOsBillingAccountRepository.test.ts`) with a comment saying it is a guard, not a caller.

**Carry-forwards to P-3a (from the SA P-2a code review)**
- The replace-customer path (the Q-2 compare-and-set) must **not** reuse the idempotency key `bos-customer:<userId>`: within 24 h Stripe would replay the original, possibly deleted, customer. Use a key that includes the old customer id.
- P-3a handles `billing_row_not_recorded` (the customer is held by another account) as a refused checkout with an alert, never a retry loop.
- Non-blocking: checker B3 counts 15 constraints. On Postgres 18, NOT NULL constraints are listed in `pg_constraint`, so B3 would wrongly FAIL. That is fine on today's Supabase PG17; re-pin B3 if the project is upgraded.

---

## QA Testing Report

*(QA to populate.)*

---

## Commit Info

*(RM to populate. Record also: migration 20261025 applied, the date, and the checker VERDICT.)*

---

## SA Review

**Reviewed by SA, 2026-10-04**
**Status:** APPROVED WITH CONDITIONS (P2-C1 to P2-C10). Ship as **two PRs, P-2a then P-2b** (Q-8).

Spot-checked against the worktree: `StripeService.ts` has exactly 2 `console.*` calls (lines 56, 312); `getOrCreateCustomer` (l.37) to `createCustomCreditSubscription` (l.107) is the slice the lockdown guard reads, so a helper placed above l.37 is outside it; the credit-lots rollback does use one `DO $refuse$` block; `.gitignore` ignores `.env*` and `.env.example` is not tracked; SA-P1 wording (requirement l.641) is as Dev quotes. The analysis is accurate and the design follows `new-repository`, `tenant-isolation-guard`, `business-os-entitlements` (both new importers registered) and the migration paste rules.

### Rulings on Q-1 to Q-11

| # | Ruling |
|---|---|
| Q-1 | **Approved. SA-P1 amended:** surrogate `id` PK, `user_id` nullable `ON DELETE SET NULL`, UNIQUE (`user_id`, `livemode`). Stripe customers are per mode, so "one Stripe customer per person within BOS" now reads "per person per mode". Default NULLS DISTINCT is what makes detached rows not collide: do not add `NULLS NOT DISTINCT`. Dev records the amendment in the requirement's Change History (SA-P1 is otherwise C-5-binding). |
| Q-2 | **Approved, amended: column-level UPDATE on 17 columns, adding `stripe_customer_id`.** `id`, `user_id`, `livemode`, `created_at` stay immutable, so a row still cannot move between accounts or modes. `stripe_customer_id` must be replaceable or Q-6's recovery (a customer deleted at Stripe, which "Delete all test data" does to every test customer) has no path: no DELETE, no re-key. The UNIQUE constraint stops one account taking another's customer. The replacing repository method lands in P-3a and must be compare-and-set (`.eq('user_id').eq('livemode').eq('stripe_customer_id', old)`). B7 and the static test change to 17 columns. |
| Q-3 | **Approved.** Keep `stripe_customer_id` after detach; no `strip`. State the reason in the `ACCOUNT_POLICY_EXCEPTIONS` entry. Stripe-side deletion stays a P-7a/PF-14 decision. |
| Q-4 | **Deferred out of P-2.** Un-ignoring `.env.example` makes the main checkout's untracked copy (45 filled values) visible to `git add .` on a **public** repo, and no CI job runs Jest, so a values guard would not block a merge. P-2 meets PF-8 by documenting the 7 Stripe names (with the mode rule) in a table in `BUSINESS_OS_ENTITLEMENTS.md` or the billing doc. The file moves to staging C2, which may un-ignore it only after (a) the user has moved the valued copy out of the repo folder, (b) the new file is written from scratch, (c) RM checks `git diff --cached .env.example` shows no value. Dev updates requirement §9.1 P-2 "done means" to match. |
| Q-5 | **Approved as a contingency only.** If prod's key is `sk_test_`, no condition. If `sk_live_`, the list is filled only when `stripeModeFromKey(...) === 'test'`, and removing that condition becomes a numbered §9.5 go-live item (not just "P-12"). |
| Q-6 | **Approved.** The agent-platform quirk (deleted customer reused) is kept. The BOS caller never retrieves. P-3a handles a missing or deleted customer by the compare-and-set replace in Q-2. |
| Q-7 | **Approved.** One `DO` block in the **rollback** only, as the credit-lots precedent. The migration itself has none. |
| Q-8 | **Split.** The Stripe inputs are not available, so the database half must not wait. **P-2a "Billing record":** migration + pre-check/checker/rollback/static test, repository, registries, customer split + Pino conversion, `stripeMode.ts`, `ensureBusinessOsStripeCustomer`, docs. **P-2b "Plan prices":** `config/planPrices.ts`, catalog fill + tier helper, harness pin to `{}`, `planPriceCheck.ts`, setup/check scripts, capture extension, captured fixtures, entitlements registrations for both importers. P-2a fills no key, so production is unchanged by it. |
| Q-9 | **Approved.** `findByUser` and `recordCustomer` only. |
| Q-10 | **Approved:** `bos_plan_basic_monthly_usd`, `bos_plan_pro_monthly_usd`, retired form `<key>_retired_<yyyymmdd>`, product ids `bos_plan_basic` / `bos_plan_pro`. Product **name** is not permanent (editable in Stripe), so `presentation.labels.en` is fine. |
| Q-11 | **Approved in P-2a**, with the importer guard limiting the repository to it. P-3a must pass `userId` **and `email`** from the session, never from the request body. |

### Conditions

1. **P2-C1** Q-2 amendment: 17 UPDATE columns incl. `stripe_customer_id`; checker B7 and static test follow.
2. **P2-C2** Drop CHECK `…_updated_after_created`. `updated_at` is written from the app clock (Vercel) and `created_at` from the DB clock, so a webhook update milliseconds after insert can fail it on clock skew. Nothing gains from it.
3. **P2-C3** `findOrCreatePlatformCustomer` return type: a retrieved **deleted** customer has no `livemode` field (`DeletedCustomer` is `{ id, object, deleted }`). Type it `livemode: boolean | null`. `ensureBusinessOsStripeCustomer` treats `null` as a mode disagreement and records nothing. No `as` cast.
4. **P2-C4** Characterisation order: E1 hash on unmodified code, E2 hash identical, then E3 (Pino), then hash again identical. The snapshot must record Stripe and Supabase calls only, with the logger mocked, so the logging change cannot move it. P-1 lockdown suites run **unedited**.
5. **P2-C5** Pino conversion of the 2 calls proceeds unless the user declines (CLAUDE.md § Logging). Errors as `{ err }`. The l.312 call drops its emoji and logs ids only, no customer email or name.
6. **P2-C6** Migration applied and checker VERDICT PASS **before P-2a merges** (mandatory, not "recommended"). The user pastes the pre-check in one tab and the migration in a **new** tab.
7. **P2-C7** P-2b merge gates: SA-P13 key prefix known; prices exist in prod's Stripe environment and `check-bos-plan-prices` PASS there; capture (C-8) done and fixtures replaced **before P-2b code review and before P-2b deploys**. P-2a has no capture gate.
8. **P2-C8** `ensureBusinessOsStripeCustomer`: a Stripe `idempotency_error` (same key, different email or name within 24 h) rejects and records nothing. Test it.
9. **P2-C9** Every script that takes `--env <path>` refuses a path inside the repo folder, so a key file can never be staged.
10. **P2-C10** `npm run test:bos-entitlements` is green for P-2b (new config file plus two importers). Scoped `tsc --noEmit` is the type gate for both PRs (ts-jest does not type-check here).

### Order, tenant isolation, registries, sizing

- **Tenant isolation:** passes. Service-role writes take `userId` from server code only, the allow-list is three fields, there is no upsert, spread or trigger, and the DB grants make `user_id`/`livemode` immutable. The foreign-customer 23505 returns an error and never a row.
- **Registries:** purge `never` (keyed to `auth.users`), `USER_OWNED_TABLES`, deletion `minimise` via SET NULL: correct. The baseline count +1 is a reviewed addition.
- **Agent-platform proof:** characterisation scenarios 1 to 7 plus the unedited lockdown guard are sufficient.
- **Sizing:** P-2a about 2 days, P-2b about 1.5 days plus the user's elapsed time. Within slice norms.

### What the user must provide

- **For P-2a (before merge):** run the pre-check, the migration (new tab) and the checker in the Supabase SQL editor, and paste back the checker rows. Optionally decline the StripeService logging conversion.
- **For P-2b (before coding the gates):** (1) the name and `acct_…` id of the Stripe environment production uses; (2) its `sk_test_` key in a file **outside the repo**, path only (or run the commands yourself); (3) whether Vercel production's `STRIPE_SECRET_KEY` starts `sk_test_` or `sk_live_` and whether its last four match that environment; (4) the go-ahead for two permanent test products and prices plus temporary capture test clocks; (5) the Q-5 endpoint API version if not already recorded.

### Approval

[x] Workplan approved with conditions P2-C1 to P2-C10. Dev may start P-2a now; P-2b coding may start, but its H2/H3 gates wait for the user's Stripe inputs.

### Code Review — P-2a

**Code Review by SA, 2026-10-04**
**Status:** APPROVED WITH FIXES (one must-fix, M-1). P2-C6 (user applies pre-check, migration, checker VERDICT PASS) stays a merge gate.

**Re-run:** `npx jest lib/business-os/billing lib/stripe lib/repositories supabase/migrations/__tests__ lib/business-os/purge lib/business-os/account app/api/stripe/webhook/__tests__/routerPlacement.guard.test.ts --ci`: 82 suites, 1,672 tests, 7 snapshots, all pass. Characterisation snapshot SHA-256 re-computed: `826489d8…ed359`, matching E1/E2/E3. Tree unchanged by the review (22 status entries before and after).

**Conditions and rulings checked**

| Item | Result |
|---|---|
| P2-C1 / Q-2 | Met. Column UPDATE on exactly 17 columns incl. `stripe_customer_id`; B7 lists them and proves `id`, `user_id`, `livemode`, `created_at` not updatable via `has_column_privilege` (covers table- and column-level grants) |
| P2-C2 | Met. No `_updated_after_created`; 10 CHECKs, 15 constraints |
| P2-C3 | Met. `livemode: boolean \| null`, `retrieved.deleted ? null : retrieved.livemode`, no cast; `null !== livemode` is a mismatch, nothing recorded; tested |
| P2-C4 | Met. Snapshot records Stripe and Supabase calls with args (so one-arg vs two-arg `create` would show); hash identical. Code reading agrees: same retrieve / warn-fall-through / create, `deleted` customer still reused (Q-6) |
| P2-C5 | Met. 0 `console.*` left in `StripeService.ts`; `{ err }`; the update log carries ids and amounts, no email or name, no emoji |
| P2-C8 | Met. Stripe errors incl. `idempotency_error` rethrown before any write; tested |
| Q-1, Q-3 | Met. Surrogate PK, nullable `user_id` `ON DELETE SET NULL`, default NULLS DISTINCT (detached rows cannot collide); `minimise` with no `strip` and the Q-3 reason stated |
| Q-4 | Met. Seven names and mode rule in `BUSINESS_OS_ENTITLEMENTS.md` § Billing, no values; requirement §9.1 P-2 and SA-P1 amendment + Change History row are accurate |
| Q-7 | Met. One `DO` block in the rollback only, after `LOCK ... ACCESS EXCLUSIVE`, raises on any row so `DROP` never runs |
| Q-9, Q-11 | Met. Two methods; three-field insert, no upsert (an upsert would need UPDATE on `user_id`/`livemode` and fail by design); caller allow-list guard covers the barrel; no route calls `ensureBusinessOsStripeCustomer` |

**Migration read as Postgres 17.** Valid, boring SQL: one statement per constraint, separate REVOKEs (PUBLIC, anon, authenticated, service_role) then exact re-grants; REVOKE ALL also strips PG17 `MAINTAIN`, and B8 checks for it. RLS on, no policy. The FK's SET NULL runs as the table owner (RI actions switch to the referencing table's owner and do not need the column grant), so the missing `user_id` UPDATE does not block erasure. Prefix CHECKs use `left()` + `chr(95)`, not `LIKE`, so `_` is literal. Pre-check is read-only (`default_transaction_read_only`, catalog reads only). Checker B1–B10 prove what they name.

**Tenant isolation.** Service-role repository; every read `.eq('user_id').eq('livemode')`; strict input and row validation, fail closed; UNIQUE (`stripe_customer_id`) plus the re-read turns a cross-account customer into an error and alert, never a row. The account id is caller-supplied by design; P-3a must take it and the email from the session (Q-11, carried).

**Ruling on placement (deviation: `businessOsStripeCustomer.ts` under `lib/business-os/billing/`).** Keep the placement: it is billing domain code and reaches the DB only through the repository (CLAUDE.md rule 1). But the P1-C6 guard now passes for it only because it does not spell `supabase` or `.from(`. That makes the guard silent if the router or catalog later import a repository.

**Must-fix**
1. **M-1** `app/api/stripe/webhook/__tests__/routerPlacement.guard.test.ts` (P1-C6 test): add a check that no file in `lib/business-os/billing/` imports `@/lib/repositories` (barrel or file) except an explicit allow-list of `businessOsStripeCustomer.ts`. Reword the test title to "billing modules touch the database only through the allow-listed repository caller". Test-only, about 10 lines. — Priority: Medium

**Carry-forward to P-3a (not P-2a fixes)**
- The replace-customer path (Q-2 compare-and-set) must **not** reuse the idempotency key `bos-customer:<userId>`. Within 24 h Stripe would replay the original, possibly deleted, customer. Use a key that includes the old customer id.
- P-3a handles `billing_row_not_recorded` (the customer is held by another account) as a refused checkout with an alert, never a retry loop.

**Optimisation suggestions (non-blocking)**
- Checker B3 counts 15 constraints. On Postgres 18, NOT NULL constraints appear in `pg_constraint` and would make it a false FAIL. That is fine on today's Supabase PG17; note it if the project is upgraded.

**Code Approved for QA:** Yes, in parallel with M-1. M-1 must land before RM commits.

---

## Change History

| Date | Change | Details |
|---|---|---|
| 2026-10-04 | Created (Dev) | P-2 workplan: lookup-key config with retired keys (CF-1), catalog fill, `check-bos-plan-prices`, test-mode price setup script with account and mode guards, migration 20261025 `business_os_billing_accounts` (surrogate PK and per-mode uniqueness proposed, column-level UPDATE), pre-check, checker, rollback, repository, customer helper split with characterisation proof, registries, names-only `.env.example`, real fixture capture gate. 34 tasks, 3 to 3.5 days, P-2a/P-2b split offered. Questions Q-1 to Q-11 for SA |
| 2026-10-04 | SA workplan review: **APPROVED WITH CONDITIONS** | Q-1 to Q-11 ruled (SA-P1 amended to surrogate PK + per-mode uniqueness; UPDATE grant 17 columns incl. `stripe_customer_id`; `.env.example` deferred to staging C2, names documented in a doc). Split into P-2a (billing record) and P-2b (plan prices). Conditions P2-C1 to P2-C10 |
| 2026-10-04 | P-2a implemented (Dev), uncommitted | Migration 20261025 + pre-check + checker (B1 to B10) + rollback + static guard; `BusinessOsBillingAccountRepository` (`findByUser`, `recordCustomer`) with importer guard; purge `never`, `USER_OWNED_TABLES`, deletion `minimise` + baseline 135; `findOrCreatePlatformCustomer` split with characterisation hash identical at E1, E2 and E3; 2 `console.*` to Pino; `stripeMode.ts`; `ensureBusinessOsStripeCustomer` (no caller); Stripe env-name table in BUSINESS_OS_ENTITLEMENTS.md; requirement SA-P1 amendment and §9.1 P-2 recorded. Evidence log § P-2a |
