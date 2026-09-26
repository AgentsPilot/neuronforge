# Workplan: Business OS tier billing — S-0 "Unblock"

> **Last Updated**: 2026-09-26

**Developer:** Dev
**Requirement:** [BUSINESS_OS_TIER_BILLING_REUSE_PLAN.md](/docs/requirements/BUSINESS_OS_TIER_BILLING_REUSE_PLAN.md) §6.3 (S-0), RD-9, RD-10, H-7, TK-2
**Branch:** `feature/business-os-s0-unblock` (from `origin/main` at `fa64e384`)
**Date:** 2026-09-26
**Status:** Code Complete — SA approved, re-applied after a tree reset, awaiting QA
**WIP commit:** `a572d432` (the implementation; committed on purpose — §10.4)

## Table of Contents

- [1. Overview](#1-overview)
- [2. Scope, and what is deliberately outside it](#2-scope-and-what-is-deliberately-outside-it)
  - [2.1 Exit criteria](#21-exit-criteria)
- [3. Analysis summary](#3-analysis-summary)
- [4. Implementation approach and the decisions taken](#4-implementation-approach-and-the-decisions-taken)
- [5. Files created / modified](#5-files-created--modified)
- [6. Task list](#6-task-list)
- [7. TK-2 — the confirmed inventory](#7-tk-2--the-confirmed-inventory)
- [8. How the exhaustive scan is verified without a database](#8-how-the-exhaustive-scan-is-verified-without-a-database)
- [9. `console.*` in the touch set — flagged, not converted](#9-console-in-the-touch-set--flagged-not-converted)
- [10. Test and typecheck numbers](#10-test-and-typecheck-numbers)
  - [10.4 The reset, the recovery, and what it proved](#104-the-reset-the-recovery-and-what-it-proved)
- [11. What QA must run against production](#11-what-qa-must-run-against-production)
- [12. SA Review Notes](#12-sa-review-notes)
- [13. QA Testing Report](#13-qa-testing-report)
  - [13.10 Dev response — QA round 1](#1310-dev-response--qa-round-1)
- [14. Commit Info](#14-commit-info)
- [Change History](#change-history)

---

## 1. Overview

S-0 is the slice that **removes what makes the rest of the programme unsafe**. Nothing in it is visible to a customer, nothing it touches is switched on, and it must be able to merge while its two external gates are still outstanding.

Six engineering items, all of which are "a thing that would be discovered later, at a worse moment":

| # | Item | Shape of the fix |
|---|---|---|
| 1 | `findTenantsMissingPlanRow` becomes an exhaustive anti-join | A new SQL function; the repository calls it |
| 2 | The dormant-champion trim list | A new report section that proposes an action and cuts nobody |
| 3 | RD-10 — three misleading billing documents | One archived, two bannered, all three guarded by a test |
| 4 | H-7 — Business OS is not built on the orphaned `plans` table | Recorded in the document that would cause the mistake |
| 5 | RD-9 — the free-tier expiration cron | Settled as an executable rule, because `vercel.json` cannot carry a comment |
| 6 | TK-2 — confirm the retirement inventory | §7 below |

## 2. Scope, and what is deliberately outside it

**Explicitly NOT attempted here**, and the slice merges without them:

| Gate | Why not | What it blocks |
|---|---|---|
| **G-1** service-role key rotation | Not ours to schedule — §6.4. It has been outstanding across the whole programme | S-5 and all of S-4b. **Not** this slice, and not S-2 or S-4a, which may merge inert |
| **G-2** making the CI checks required | A repository setting, the user's or Offir's to change | Enforcement switch-on |
| **TK-1** whether the four Stripe subscriptions are live-mode | Needs the Stripe dashboard, not the codebase. ⚠️ If they are live they have been renewing against a real card unattended since 2026-07-19 | The WS-3 retirement in S-4a |

Referenced above so the slice's status is honest rather than silently incomplete. **Progress does not stall on them; delivery to a customer does** (§6.4).

**Also out of scope:** TK-3 (the disposition of `free_tier_expires_at`, S-4a/WS-3), TK-4 (the webhook's Pino conversion — see §9), TK-5, TK-6.

### 2.1 Exit criteria

Worded so that none of them can be read as more than it is. **"Done" here means "the code is right and the gap is closed in the repository" — it does not mean a number is now known.**

| # | Criterion | The wording that matters |
|---|---|---|
| 1 | The missing-plan-row scan is an exhaustive anti-join **in code**, and is **exhaustive in production only once the migration is applied there** | ⚠️ Not "the count is now known". Until `20261010` is pasted (runbook step 10), production still has no exhaustive scan, and **nobody knows what `missing_onboarding_only` is.** While the function is absent the repository answers with an **error**, never a zero — and the switch-on gate is **`scanFailed === false && count === 0`**, both conditions, because a failed scan is not a zero |
| 2 | The trim list exists as a list and a mechanism | **Nobody has been trimmed**, and no account changed |
| 3 | The three misleading documents are corrected, and guarded so they cannot silently revert | — |
| 4 | H-7 is recorded in the document that would cause the mistake | — |
| 5 | RD-9 is settled as an executable rule | The cron is still **unscheduled and still blind**; what changed is that it can no longer become scheduled-and-blind unnoticed |
| 6 | TK-2's inventory is confirmed | A **confirmation**, not a deletion. Nothing was deleted |
| 7 | G-1, G-2 and TK-1 are **untouched and referenced** | The slice merges without them. The honest status while they are outstanding is **"built, not switched on"** |

> **The one sentence to carry forward:** *the exhaustive anti-join is done in code; the scan becomes exhaustive in production when the migration is applied there, and the count is unknown until then.*

## 3. Analysis summary

| Area | What S-0 touches |
|---|---|
| **Database** | One new read-only function, `public.business_os_tenants_missing_plan_row(integer)`. No table, no column, no data, no trigger |
| **Repository** | `BusinessOsAccountPlanRepository.findTenantsMissingPlanRow` — rewritten as one RPC call |
| **Business OS entitlements** | `report.ts` — the existing `tenantsWithoutPlanRow` section gains a profile/onboarding split; a new `dormantChampions` section |
| **Crons** | None changed. One new guard test **about** `check-free-tier-expiration` and `vercel.json` |
| **Docs** | Three billing documents (RD-10), the apply runbook (step 10), the entitlements architecture doc (two switch-on gates moved) |
| **Providers / LLM / plugins / V6** | Untouched |
| **API routes** | None added or changed. There is no new endpoint in this slice |

## 4. Implementation approach and the decisions taken

### 4.1 The anti-join goes into SQL, not into TypeScript (item 1)

**The defect.** `findTenantsMissingPlanRow` read `business_profiles`, then asked about plan rows 100 ids at a time. A tenant is *not* someone with a business profile — the checker's own definition (row B5) is **the union of `business_profiles` and `onboarding_conversations`**. So somebody who started onboarding and never created a profile was **not counted**. While the mode is off that is a wrong number in an admin report. Under `enforce` it is a **customer who is refused**, because an account with no plan row resolves to no entitlements.

**Why it could not be fixed in place.** The query is `tenants (A ∪ B) ANTI JOIN plans`. PostgREST cannot express a union of two tables, let alone an anti-join across it. Any TypeScript version is a paged approximation, and the previous one is the proof.

**Decision: an RPC, not a cleverer PostgREST call.** A `SECURITY INVOKER STABLE` function with `SET search_path = ''`, `EXECUTE` granted to `service_role` only, returning **one row**:

| Column | Why it is there |
|---|---|
| `tenants_checked` | Non-vacuity. A scan that checked nothing must not read as "nothing missing" |
| `missing_count` | The **exact** count, never capped by `p_limit` |
| `missing_with_profile` / `missing_onboarding_only` | The split that names the defect. `missing_onboarding_only` is precisely the population the old code could not see |
| `missing_sample` | Up to `p_limit` ids, for looking at |
| `truncated` | Whether the *sample* was cut. The counts stay exact |

Consequences worth stating:

- **The report and checker row B1 can no longer disagree**, because they are now the same SQL. Before, the checker was right and the report was wrong, and nothing said which to believe.
- **A missing function is an error, not a zero.** The operator applies migrations by hand, so "nothing is missing" and "the check was never installed" *must* look different — the first is a green light to switch enforcement on. An empty result set is treated the same way.
- `bigint` arrives from PostgREST as a string. Counting is the entire purpose of the method, so every number is coerced with `Number(...)` and there is a test for it (`"37" + 1 === "371"` is the bug).
- `p_limit` is clamped **1..20000** in both the repository and the function. Two clamps rather than one: the function is callable from the SQL editor by an operator who did not read the repository.

**Two properties SA confirmed that I had not claimed — both make the change bigger than I described it:**

| Property | Why it matters |
|---|---|
| **The widening is strict *by construction*** | The profile side of the union is unchanged, so the new result is a **superset** of the old one — it cannot miss anyone the old scan caught, only add. That is what makes this a safe replacement rather than a different answer, and it is stronger than "the two agree on a fixture where every tenant has a profile". Asserted over five fixtures in the migration guard |
| **The old count was *also* bounded by its fetch limit** | The old code read `business_profiles` with `.order('user_id').limit(maxAccounts + 1)` and sliced to 2,000, so on a database with more than 2,000 profiles it **under-reported even on the profile side** — and because the ordering is stable it dropped **the same tenants on every run**, which is why re-running never surfaced them. So the fix is not only "it now sees onboarding-only tenants": **the count was a partial and is now exact**, with `p_limit` bounding the returned sample only. Asserted with a 2,500-tenant fixture |

### 4.2 The trim list is a list and a mechanism, never a cut (item 2)

**Nobody is trimmed by this slice.** The requirement is to produce the list and the mechanism; who (if anyone) loses access is a commercial decision and the user's alone.

The report's existing page walk already collects `noEndDateAccountsWithoutProfile`. `dormantChampions` reuses that walk — same pass, no second query — and for each account emits:

- `dormantDays` and `since`, so "how long" is a number rather than a date to subtract;
- `origin` and `onboardingStartedAt`, so the account can be recognised;
- **`endAccessOp`** — the exact `POST` to the existing admin account route that would end their champion cohort, complete with method, path, body and a `reason` field **whose value is a placeholder telling the reader to replace it**. There is deliberately no pasteable date: the 30-day figure is an illustration, and a copyable date is an invitation to act without deciding.
- **`afterExpiry`**, stating what actually happens at expiry — and that while the mode is off, nothing does.

Exclusions asserted by test: anyone with a business profile, anyone with an end date, anyone not a champion, and **anyone paying**. The section counts **accounts, not rows**, and agrees with `noEndDateAccountsWithoutProfile` by construction.

### 4.3 RD-10 — one archived, two bannered (item 3)

The instruction was to correct **or** archive, per document, and say which and why.

| Document | Chosen | Why |
|---|---|---|
| `BILLING_SYSTEM_COMPLETE_STATUS.md` | **Archived**, body replaced with a correction table, original text preserved below a line | It is the only one of the three whose claims are **false rather than unbuilt**: it said the platform has no Stripe integration, no recurring billing and no dunning. All three are live in production. Anyone planning from those lines **rebuilds working software**. Correcting it in place would mean maintaining a 691-line status report about the agent platform's billing, which is being parked — the corrected version would be a document nobody should plan from either. The useful residue is a pointer, so that is what the file is now |
| `PRICING_SYSTEM_IMPLEMENTATION_PLAN.md` | **Kept, bannered** directly under the H1 | Nothing in it shipped, and it is the **only written record of a design discussion about the agent platform's own pricing** — a product that is parked, not deleted. The banner says: never built, superseded for Business OS, and the `plans` table it designs exists with **zero callers** and its migration is not even in the repository (F-11). Read it as a proposal from 2025-01-27 |
| `STRIPE_BILLING_DATABASE_STATUS.md` | **Kept, bannered**, and it carries **H-7** | Half of it is true. It lists `user_subscriptions`, `billing_events` and `credit_transactions` (real, live, written by the webhook today) beside `plans` (zero callers) under one "✅ EXISTS" heading. The banner splits them |

**Banner placement is asserted, not assumed:** both banners must sit within five lines of the H1. A warning below a table of contents is a warning nobody meets.

**A guard test** (`docs/__tests__/billingDocsCorrected.rd10.guard.test.ts`, 13 tests) pins the three claims that were wrong, the H-7 text, the "nothing below this line" sentence, the pointer each document carries, and — deliberately — **not** the wording of anything else, so an improvement is not a failure. Removing a banner on purpose now requires deleting a test that says why it existed. That is a conversation rather than an accident.

### 4.4 H-7 is recorded where the mistake would be made (item 4)

H-7 is one decision: **Business OS is NOT built on the orphaned `plans` table.** It is written into `STRIPE_BILLING_DATABASE_STATUS.md`, because that is the document that makes `plans` look load-bearing. Recorded anywhere else it is a true fact nobody meets at the right moment. It states the positive as well as the negative: tiers live in `lib/business-os/entitlements/config/tierMatrix.ts`, an account's plan is a row in `business_os_account_plans`, nothing in `lib/business-os/**` reads `plans`, and nothing should start.

### 4.5 RD-9 is settled as a test, because `vercel.json` cannot carry a comment (item 5)

The plan asks for RD-9 to be recorded "where a future reader of `vercel.json` will find it". **`vercel.json` is JSON — there is nowhere in that file to write it**, and a comment in the route is read *after* the schedule was added, which is too late.

So the rule is executable (`app/api/cron/__tests__/freeTierExpiration.rd9.guard.test.ts`, 5 tests): the cron is **either unscheduled, or it excludes Business OS payers** — never scheduled and blind. Adding the path to `vercel.json` turns the suite red until the route consults something that knows what a Business OS account is, and the failure message says what to do and why (the cron freezes accounts that never bought credits, which is **every paying Business OS customer**; `account_frozen` is additionally read by `generate-agent`, so the freeze is not cosmetic).

It also records today's truth on purpose — **unscheduled *and* still blind** — so a change to either half shows up in a diff. A negative control proves the rule rejects the dangerous state rather than passing because the cron happens to be absent, and one assertion on the cron count proves the config parse was not vacuous.

**This does not decide TK-3**, which chooses between replacing the field's semantics and making RD-9 permanent. Either way the rule holds.

### 4.6 What was NOT done, on purpose

| Not done | Why |
|---|---|
| No new API route | Nothing in S-0 needs one. The report and the admin account route already exist |
| No change to the resolver, the catalog, the tier matrix or any cohort | S-0 changes no entitlement, for anyone |
| No `console.*` conversion | §9 — the files with `console.*` are ones S-0 **does not modify** |
| No deletion from the retirement inventory | TK-2 **confirms** the list; the deleting is S-4a/WS-3 |

## 5. Files created / modified

| File | Action | Reason |
|---|---|---|
| `supabase/migrations/20261010_business_os_tenants_missing_plan_row.sql` | create | The exhaustive anti-join as a read-only RPC |
| `supabase/migrations/__tests__/business-os-tenants-missing-plan-row.test.ts` | create | Text guard over the SQL **and** the defect modelled in TypeScript (§8) |
| `lib/repositories/BusinessOsAccountPlanRepository.ts` | modify | `findTenantsMissingPlanRow` is one RPC call; new `BusinessOsMissingPlanRowScan` type |
| `lib/repositories/__tests__/BusinessOsAccountPlanRepository.test.ts` | modify | Replaces the paged-walk tests with the boundary: right function, clamp, bigint, wrapped/unwrapped, and the two ways a failure must not look like zero |
| `lib/business-os/entitlements/report.ts` | modify | Profile/onboarding split on `tenantsWithoutPlanRow`; new `dormantChampions` section |
| `lib/business-os/entitlements/__tests__/report.test.ts` | modify | Updated for the new fields |
| `lib/business-os/entitlements/__tests__/dormantChampions.test.ts` | create | Who is on the list, the four exclusions, and that the section writes nothing |
| `app/api/cron/__tests__/freeTierExpiration.rd9.guard.test.ts` | create | RD-9 as an executable rule |
| `scripts/__tests__/entitlementSqlScripts.guard.test.ts` | modify | The new migration is pasted by hand, so it is held to the paste rules |
| `docs/BILLING_SYSTEM_COMPLETE_STATUS.md` → `docs/archive/` | move + rewrite | RD-10 |
| `docs/PRICING_SYSTEM_IMPLEMENTATION_PLAN.md` | modify | RD-10 banner |
| `docs/STRIPE_BILLING_DATABASE_STATUS.md` | modify | RD-10 banner + H-7 |
| `docs/__tests__/billingDocsCorrected.rd10.guard.test.ts` | create | The three corrections cannot silently revert |
| `docs/BUSINESS_OS_ENTITLEMENTS_APPLY_RUNBOOK.md` | modify | Step 10, the file table, and the change history |
| `docs/architecture/BUSINESS_OS_ENTITLEMENTS.md` | modify | Two switch-on gates moved (missing-plan-row check, trim list) |
| `docs/workplans/business-os-s0-unblock.md` | create | This file |

## 6. Task list

- [x] Confirm the branch is `feature/business-os-s0-unblock`, created by RM from `origin/main`
- [x] Write the SQL anti-join as a read-only `SECURITY INVOKER` function, `EXECUTE` to `service_role` only, held to the boring-script paste rules
- [x] Rewrite `findTenantsMissingPlanRow` as one RPC call, with the clamp, the bigint coercion and the two failure modes
- [x] Make the report print the profile/onboarding split and its own scope sentence
- [x] Add the `dormantChampions` section — list plus mechanism, no cut, no pasteable date
- [x] Settle RD-9 as an executable guard over `vercel.json` + the route
- [x] RD-10: archive one document, banner two, record H-7 in the right one
- [x] Add the RD-10 guard test so the corrections cannot silently revert
- [x] Extend the SQL paste guard to the new migration
- [x] Add runbook step 10 with the two queries that verify the RPC against checker row B1
- [x] Move the two switch-on gate rows in the entitlements architecture doc
- [x] TK-2: confirm §4.6's inventory against the code — §7
- [x] Record the `console.*` findings without converting anything — §9
- [x] Fix the two things RC-15 caught in my own code — §10.3
- [x] Run the affected test scope, typecheck and lint — §10

## 7. TK-2 — the confirmed inventory

**Read-only confirmation. Nothing was deleted, and nothing in §4.6 was edited.** SA's framing is that *the risk here is deleting one item too many*, so this is a checklist for S-4a/WS-3 to work from, not a change.

### 7.1 Dies — confirmed present, with the line it is on

| §4.6 item | Confirmed | Evidence |
|---|---|---|
| Ad-hoc price minting | ✅ **2 calls** | `lib/stripe/StripeService.ts:149` (per checkout) and `:321` (per upgrade) — exactly the lines F-12 cites |
| `updateSubscriptionAmount` | ✅ | Defined `lib/stripe/StripeService.ts:301`, called once from `app/api/stripe/update-subscription/route.ts:74` |
| The credit conversion inside `handleInvoicePaid` | ✅ | `pilotCreditsToTokens` imported at `app/api/stripe/webhook/route.ts:9`, called at `:125` (and `:476`, `:592`); `ais_system_config` read at `:111` |
| The L-13 "first subscription found" fallback | ✅ | `app/api/stripe/webhook/route.ts:67-70` — `subscriptions.list({ customer, limit: 1 })`, then `subscription.metadata?.user_id` |
| The L-15 description heuristic | ✅ | `app/api/stripe/webhook/route.ts:99-100` — `line.description?.includes('Unused time')` / `'Remaining time'` |
| `custom_credits` checkout branch | ✅ | `app/api/stripe/create-checkout/route.ts:47` (accepted values) and `:73` (the branch) |
| **The six `QuotaAllocationService` allocation calls** | ✅ **exactly six — SA's count is right** | `allocateQuotasForUser` at webhook `:328`, `:571`, `:716`, `:805`, `:876` (**five**) and `sync-subscription/route.ts:241` (**one**) |
| `subscription_renewal` / `subscription_upgrade` transaction types | ✅ | Written at `app/api/stripe/webhook/route.ts:212` (`hasProration ? 'subscription_upgrade' : 'subscription_renewal'`) |
| The boost-pack checkout (**TK-5**, decide explicitly) | ✅ | `create-checkout/route.ts:47,129` and `webhook/route.ts:465` (`session.mode === 'payment' && purchaseType === 'boost_pack'`). The `boost_packs` / `boost_pack_purchases` **tables** survive |
| The credit-purchase UI (L-33) and the four dead files (L-35) | ✅ **all six files present** | `components/settings/BillingSettings.tsx`, `components/settings/PlanManagementTab.tsx`, `components/v2/settings/BillingSettingsV2.tsx`, `BillingSettingsV2_NEW.tsx`, `app/v2/billing/page.tsx`, `app/v2/billing/page.tsx.bak`. **`PlanManagementTab.tsx` has zero importers** — confirmed, as L-35 claims |

### 7.2 Survives untouched — confirmed live

| §4.6 item | Confirmed | Evidence |
|---|---|---|
| `account_frozen` read by `generate-agent` | ✅ **2 reads** | `app/api/generate-agent/route.ts` — a live read path **outside billing and outside `CreditService`**, exactly as SA said |
| `free_tier_expires_at` read by `checkExecutionAllowed` | ✅ **2 reads** | `lib/services/CreditService.ts` |
| `getOrCreateCustomer` | ✅ | Defined `lib/stripe/StripeService.ts:37`, used internally at `:142` and `:237`, and from `app/api/stripe/create-checkout/route.ts` (2 sites). Q-T8's split applies to this function |
| The Connect half of the webhook | ✅ | `app/api/stripe/webhook/route.ts` — 2 connected-account references. Live client money; untouched by S-0 |
| `payment_grace_period_days` | ✅ **1 read** | `app/api/stripe/webhook/route.ts`. **Not** in `lib/stripe/StripeService.ts` (0) — so "not a Business OS source of truth" must not be executed as "delete the key": the live agent-platform dunning path in the webhook reads it |

### 7.3 Guarded — confirmed

| §4.6 item | Confirmed |
|---|---|
| `check-free-tier-expiration` | ✅ Unscheduled in `vercel.json`, and still reads both `free_tier_expires_at` and `account_frozen`. **Now held there by a test** — §4.5 |
| `app/api/business-os/usage/route.ts` reads `user_subscriptions` (F-28) | ✅ **1 read — the B-8 leak is real and live.** Left in place: TK-6 (S-4a/WS-3) |
| `checkExecutionAllowed` | ✅ Present in `lib/services/CreditService.ts`, fail-open intact |

### 7.4 Two corrections to my own first pass — and none to the plan

My first TK-2 script reported three items as `MISSING FILE`. **All three were my invented paths, not errors in §4.6:**

| I looked for | The real path | Note |
|---|---|---|
| `lib/services/StripeService.ts` | `lib/stripe/StripeService.ts` | The plan gets this right — F-1 and §6's file table both name `lib/stripe/StripeService.ts`. Later rows abbreviate to `StripeService.ts:301` with no directory, which is what I misread |
| `components/billing/BillingSettings.tsx` | `components/settings/BillingSettings.tsx` | The plan names it correctly at F-9 and F-20 |
| `app/settings/billing/page.tsx.bak` | `app/v2/billing/page.tsx.bak` | The plan names it correctly at F-20 and L-35 |

**§4.6 needs no correction.** Recorded because a "missing file" in a retirement inventory is exactly the kind of finding that gets acted on, and this one was wrong.

> **Also present:** `lib/stripe/StripeInvoiceService.ts`, which §4.6 does not mention. It contains none of the *Dies* patterns (0 hits for `prices.create`, `payment_grace_period_days`). Flagged for WS-3 to look at rather than assume.

## 8. How the exhaustive scan is verified without a database

No test in this repository can execute PostgreSQL, so the SQL itself cannot be *run* in CI. Rather than claim more than that, the verification is split into three things, each honest about what it proves:

### 8.1 A text guard over the SQL (16 tests)

`supabase/migrations/__tests__/business-os-tenants-missing-plan-row.test.ts` asserts that the function's text contains: both tenant tables; the fold that makes a tenant countable once however many rows they have; `NOT EXISTS` (not `IN`, not `LEFT JOIN … IS NULL`); the exact counts alongside a bounded sample; the profile/onboarding split; the clamp; `SECURITY INVOKER` with a pinned empty `search_path`; `REVOKE ALL` rather than an enumeration (the 2026-09-24 privilege lesson: **enumerate the `GRANT`, never the `REVOKE`**); that it writes nothing; that it is `CREATE OR REPLACE`; and the paste rules (zero `--` markers, balanced quotes and parens, paired dollar tags).

**What this proves:** the file says what it should. **What it cannot prove:** that Postgres agrees.

### 8.2 The defect modelled in TypeScript (the part that matters)

The same suite implements **two** scans over shared fixtures — `oldScan` (profiles only, the pre-S-0 logic) and `exhaustiveScan` (the union) — and asserts:

1. an onboarding-only tenant with no plan row is **invisible to `oldScan` and found by `exhaustiveScan`**;
2. the two **agree exactly** on a fixture where every tenant has a business profile — so the change is a strict widening, not a different answer;
3. a tenant with 40 onboarding messages is counted **once**.

This is the part that makes the gap reviewable: the *logic* is executable and the defect is reproduced, even though the dialect is not. If someone later reverts the SQL to a profiles-only scan, (1) is the test that explains what they broke.

### 8.3 The boundary, at the repository (36 tests in that suite)

Right function name, right argument, the clamp (999999 → 20000, 0 → 1, default 2000), `bigint`-as-string, the row accepted wrapped *or* unwrapped, zero-missing reported as zero, a **missing function reported as an error**, an **empty result set treated as a failure**, and `client.from` never called — the last one being the regression test for "somebody re-implemented the anti-join in TypeScript".

### 8.4 What is left, and only production can answer it

Three things, all in §11: that the function exists after the paste, that its answer equals checker row B1, and what `missing_onboarding_only` actually is on live data. The third is a **number nobody currently knows** — it is precisely the population the old code could not see.

## 9. `console.*` in the touch set — flagged, not converted

**Flagged rather than converted**, per CLAUDE.md § Logging: the rule applies to files you *modify*, and **S-0 modifies none of these**.

| File | `console.*` calls | Why S-0 does not convert it |
|---|---|---|
| `app/api/stripe/webhook/route.ts` | **168** | Not opened for modification by S-0. It is already **TK-4** in the plan (S-4a/WS-1/WS-3), subject to the user's approval, because S-4a *does* modify it and it serves live Connect payments |
| `lib/services/CreditService.ts` | **20** | Read-only confirmation for TK-2 §7.2 |
| `app/api/stripe/sync-subscription/route.ts` | **19** | Read-only confirmation for TK-2 §7.1 |
| `app/api/cron/check-free-tier-expiration/route.ts` | **10** | S-0 adds a test **about** this route; it does not edit the route. TK-3 (S-4a) is the slice that opens it |
| `lib/services/QuotaAllocationService.ts` | **10** | Read-only confirmation for TK-2 §7.1 |
| `lib/stripe/StripeService.ts` | **2** | Read-only confirmation for TK-2 |

**Every file S-0 creates or modifies has zero `console.*` calls.** Verified, not assumed.

> **Recommendation for the user, not a decision taken here:** the 168 in the webhook are the ones worth approving as their own task rather than as a rider on a billing change — it is a live-money file, the diff would be enormous, and mixing a logging rewrite into the retirement is how a retirement goes wrong. The other five are byproducts of reading, and the honest thing is to leave them until a slice actually opens them.

## 10. Test and typecheck numbers

Run from the worktree (which has no `node_modules` of its own):

| Suite | Tests | Result |
|---|---|---|
| `lib/business-os/entitlements/__tests__/report.test.ts` | **36** | ✅ — +3 for S0-1 |
| `lib/business-os/entitlements/__tests__/dormantChampions.test.ts` | **17** | ✅ new — +3 for QA-4 and QA-5 |
| `lib/repositories/__tests__/BusinessOsAccountPlanRepository.test.ts` | 36 | ✅ |
| `supabase/migrations/__tests__/business-os-tenants-missing-plan-row.test.ts` | **23** | ✅ new — +2 SA confirmations, +4 QA read-level, +1 QA-1 |
| `scripts/__tests__/entitlementSqlScripts.guard.test.ts` | 70 | ✅ |
| `app/api/cron/__tests__/freeTierExpiration.rd9.guard.test.ts` | 5 | ✅ new |
| `docs/__tests__/billingDocsCorrected.rd10.guard.test.ts` | **14** | ✅ new — +1 for QA-3 |
| `lib/repositories/__tests__/businessOsEntitlements.imports.guard.test.ts` | 8 | ✅ — see §10.3 |

### 10.1 Full affected scope

```
lib/business-os/entitlements  lib/repositories  supabase/migrations
scripts/__tests__  app/api/cron/__tests__  docs/__tests__
app/admin/business-os-tiers  app/api/admin/business-os
```

**70 suites, 1,439 tests, all passing.** 85s. (SA's own run of the eleven S-0 suites: **270 tests, 0 failures**, before the five fixes below.)

### 10.2 Typecheck and lint

| Check | Result |
|---|---|
| `tsc --noEmit` over the whole repository | **2,077 errors** |
| In any file S-0 creates or modifies | **0** — unchanged after the SA round, and the repository-wide total did not move either |
| In the directories S-0 touches | 5, all in files it does not touch: `lib/repositories/CalibrationSessionRepository.ts`, `lib/repositories/WebsiteContentRepository.ts`, `scripts/__tests__/check-bos-llm-literals.test.ts` (×3) |
| ESLint on the nine changed `.ts` files | **0 errors**, 3 warnings — all three are pre-existing `any`s in the repository test's PostgREST builder stub (lines 48 and 71), outside every hunk of this diff |

**On the total moving from 2,029 to 2,077.** The 2,029 baseline was measured on the tier-configuration branch; this branch is based on a **newer `origin/main`** (`fa64e384`), so the 48 arrived with main, not with S-0. The control is per-file rather than the total: **no file this slice creates or modifies produces an error**, and the twelve largest contributors are all long-standing agent-platform files (`components/wizard/hooks/useWorkflowActions.ts` 59, `scripts/test-slot-filling-scenarios.ts` 48, `app/v2/agents/[id]/page.tsx` 47 …), none of them in S-0's touch set. A whole-repository total is not a usable regression signal across a rebase; the per-file count is.

### 10.3 One finding, from an existing guard catching me

The first full run went **red on RC-15** (`businessOsEntitlements.imports.guard.test.ts`), twice, and both were true positives about my own code:

| What tripped it | Why | What I did |
|---|---|---|
| The RD-9 guard listed `businessOsAccountPlanRepository` as one of three signals that a route consults entitlement state | RC-15 forbids application code from naming those symbols at all — so the third signal was describing a path that **cannot legitimately exist** | **Removed the third signal.** The two remaining ones (the table name, the module path) are exhaustive *because* RC-15 closes the third. That interlock is now written in the function's doc comment, along with the fact that RC-15 is what taught it |
| `dormantChampions.test.ts` names the repository in the **path** of an `import type` | RC-15's match is symbol-shaped but a module path contains the class name, so a type-only import trips it | **Added the test to `ALLOWED`** with the reason. The alternative — importing the type through the `@/lib/repositories` barrel — would have passed by hiding the referrer, which is the exact evasion RC-15's own header warns about |

#### Tracked item, outside S-0 — RC-15's type-only-import precision

SA ruled the guard **stands as-is** (S0-2): the `ALLOWED` entry beat routing through the barrel, and removing the third RD-9 signal with the interlock documented was right. What was wrong was the **header**, which claimed symbol-level precision for both cases. It now says, in place: **symbol-level for a value import, path-level for a type-only import**, because `import type` erases and only the module path survives to be matched.

| | |
|---|---|
| **The item** | Refine RC-15's match so a type-only import is not reported as a referrer — e.g. strip `import type { … } from '…'` lines before scanning, or match the imported **binding** rather than the whole file's text |
| **Why not in S-0** | Widening a security guard is not a change to make inside a slice that is not about it. It **fails safe** today: it over-reports, never under-reports |
| **Why it is worth doing** | It costs a declaration every time somebody imports a row type, and it makes the next person think they have done something wrong when they have not |
| **Where it is recorded** | Here, **and pointed at from the guard's own header** — so a reader who trips it finds the explanation in the file that tripped them, not only in a workplan |

### 10.4 The reset, the recovery, and what it proved

On 2026-09-26 a QA mutation batch ran `git checkout -- lib docs supabase` between mutations, seventeen times, against a tree whose implementation was **uncommitted**. Every change to a **tracked** file was destroyed. Recorded here because two things came out of it that are worth keeping.

#### The guards specified the code well enough to rebuild it

Not a consolation prize — a measurable property. Each surviving suite was red, and each went green on the first run against a rewrite driven only by the suite:

| Recovered from its own guard | Result |
|---|---|
| `report.ts` — the `dormantChampions` section | `dormantChampions.test.ts` **14/14, first run** |
| The three RD-10 document corrections | `billingDocsCorrected.rd10.guard.test.ts` **13/13, first run** |
| The migration SQL | Its guard named five of the seven defects below by line |

The cost was the prose, not the logic: comments and doc-block reasoning had to be re-written from scratch, because no test pins a comment. That is the honest boundary of guard-as-specification.

#### ⚠️ The untracked files survived deletion but **not mutation**

`git checkout` cannot restore an untracked file — and by the same token it cannot revert one. The migration SQL was the mutation **subject** and was left carrying **seven live mutants**:

| # | Mutant found in the file | Caught by |
|---|---|---|
| 1 | `SECURITY DEFINER` instead of `SECURITY INVOKER` | the guard |
| 2 | `SET search_path = ''` deleted | the guard |
| 3 | Clamp cap `200000` instead of `20000` | the guard |
| 4 | Second `UNION` arm reading `public.business_profiles` **twice** instead of `onboarding_conversations` — i.e. the S-0 defect restored | the guard |
| 5 | `GROUP BY tenants.user_id` deleted from the fold | the guard |
| 6 | `missing_count` taken from **`sampled`** rather than `missing` | **nothing** |
| 7 | `tenants_checked` taken from the **raw union** rather than `folded` | **nothing** |
| 8 | `truncated` direction reversed (`<` for `>`) | **nothing** |

Numbers 6, 7 and 8 are **precisely the three arithmetic properties QA reported as unasserted** — so that finding is not a review opinion, it is three mutants that survived a batch. All three are now asserted, and the assertions say what the wrong version would do rather than only what the right one looks like:

| Assertion | What the mutant would have caused |
|---|---|
| `counts the MISSING, not the sample` | `count(*) FROM sampled` is bounded by `LIMIT cap`, so on any database with more missing tenants than the cap the count would report `cap` and stop — a capped number where the whole point was an exact one |
| `counts tenants from the FOLDED set — accounts, not rows` | An account that sent 40 onboarding messages counted as 40 tenants, and `tenants_checked` disagreeing with the checker for a reason nobody could see |
| `flags truncation in the right DIRECTION` | `true` on a healthy database and `false` on the one database where the sample really is incomplete — the single worst way for this flag to be wrong |

#### QA's third finding: a NULL `user_id`

**Not reachable today.** Both tenant tables declare `user_id UUID … NOT NULL` — `20260721_create_business_profiles.sql:7` and `20260721_create_onboarding_conversations.sql:7`. Added `WHERE user_id IS NOT NULL` to both `UNION` arms anyway, with an assertion: a NULL would survive the `UNION`, fold to its own group, match no plan record, and be reported as a missing tenant that does not exist. The constraint lives in a migration a different change could alter; the filter costs nothing and does not depend on it.

#### The stray-escape sweep

Six `\'` sequences inside **block comments** (the fingerprint of a scripted edit, where the escape has no meaning and renders as a literal backslash) were in the destroyed versions and are gone from the rewrite. The four remaining matches in this slice are inside single-quoted string literals, where the escape is correct. Verified with a fixed-string sweep over all nine files.

## 11. What QA must run against production

S-0's central claim — *the scan is exhaustive* — is the one thing that cannot be established from the repository. These are the checks, in order, and they need the Supabase SQL editor.

| # | Step | Expected | What a different answer means |
|---|---|---|---|
| 1 | Paste `supabase/migrations/20261010_business_os_tenants_missing_plan_row.sql` (runbook **step 10**) | The final `SELECT` prints the migration name and the runbook pointer | If the paste fails, it is a **construct** — all prose is already gone from these files (see the runbook's *Why the scripts are boring*, and that the apostrophe theory was **disproven** by probe on 2026-09-24) |
| 2 | `SELECT * FROM public.business_os_tenants_missing_plan_row(20000);` | One row | Nothing, or an error, means step 1 did not take |
| 3 | The hand-written union/anti-join in runbook step 10 | `missing` **equals** `missing_count` from step 2 | A difference means the function's logic is wrong, and step 3 is the authority |
| 4 | Checker **block 3**, row **B1** | Agrees with both | B1 is the pre-existing check. Three-way agreement is the point of the slice |
| 5 | Record `missing_onboarding_only` | **Any number ≥ 0 — nobody knows this yet** | This is the population the old code could not see. If it is above zero, the old report was **wrong on production**, and that number is the evidence |
| 6 | If `missing_count > 0`: **record the count, re-apply `20261005b` (re-runnable), record it again**, then repeat 2–4 | The count **falls to 0** | **A count that does not fall is a different problem with a different fix.** The backfill is not what is failing — the plan-row triggers are. Re-running the backfill will not help: check the database log (runbook step 6b) and checker row `trigger rows`, which must be above `0` once new tenants exist |
| 7 | Load the admin shadow report and read `tenantsWithoutPlanRow` | Same `count`, and its `scope` says "exhaustive" | A mismatch means the route is not reading the new scan |
| 8 | Read the report's `dormantChampions` | A list, with an `endAccessOp` per account, **and nothing changed** | Any state change is a defect: this section must write nothing |

> ### Gate: TWO conditions, not one
>
> **Do not set `BOS_ENTITLEMENTS_MODE=enforce` unless BOTH are true:**
>
> | | Condition | Where to read it |
> |---|---|---|
> | 1 | **The scan ran.** | Step 2 returned a row; `tenantsWithoutPlanRow.scanFailed` is `false` |
> | 2 | **And found nothing missing.** | `missing_count` is `0`; in the report `count` is `0`, **not `null`** |
>
> **A failed scan is not a zero** — that is S0-1, and it applies to the sentence stating the gate as much as to the code behind it. An account with no plan record resolves to no entitlements, so under enforcement it is a customer who is refused; a gate written against the number alone is satisfied by a check that never ran.
>
> For anyone automating it: **`scanFailed === false && count === 0`**.
>
> G-1 and G-2 both remain outstanding regardless.

**Verifiable without production:** everything in §10, plus the guard tests. **Not verifiable without production:** items 1–8 above.

## 12. SA Review Notes

### SA Code Review — S-0 Unblock

**Reviewed by SA — 2026-09-26** (branch `feature/business-os-s0-unblock`, implementation uncommitted; workplan `7f14f258`; base `fa64e384`)
**Status:** 🔄 **APPROVED FOR QA WITH ONE REQUIRED FIX (S0-1).** Four low items. The SQL is right, the widening is genuinely strict, and the verification strategy is the best available without a database — but the one guarantee this slice exists to create is undone one layer above where it is made.

**What SA ran:** the eleven S-0 suites — **270 tests, 0 failures**.

### 12.1 The anti-join

**The SQL is correct, and two details are better than they had to be.**

| Property | Verdict |
|---|---|
| The union and the fold | ✅ `UNION` dedupes on the **pair**, so a tenant with both a profile and onboarding rows appears twice with different flags — which is exactly why `folded`'s `bool_or` is necessary, and it is there. Getting this wrong would have double-counted every established tenant. |
| The anti-join | ✅ `NOT EXISTS`, which is NULL-safe. `NOT IN` against a nullable column is the classic version of this bug and it is not what was written. |
| **The count is unclamped; only the sample is capped** | ✅ **This is the design decision that matters.** `missing_count` counts all of `missing`; `LIMIT` applies to `sampled` alone; `truncated` reports that the *list* is partial. So the number the gate reads can never be silently short — which is precisely how the old implementation could under-report. |
| Posture | ✅ `SECURITY INVOKER` (right: the only caller holds the service role, so definer rights buy nothing and would become an escalation if a REVOKE were ever dropped), `STABLE`, `SET search_path = ''` with every reference schema-qualified, `REVOKE ALL` from PUBLIC/anon/authenticated then `GRANT EXECUTE` to `service_role`. Matches the convention and WC-9. |
| Paste rules | ✅ No `--` comments; the trailing `SELECT` gives the operator a visible confirmation row. |
| The clamp | ✅ `least(greatest(coalesce(p_limit, 2000), 1), 20000)` — a NULL, a zero and a silly number all land somewhere sane. |

**Is the widening strict? Yes, and I checked rather than accepted it.** The profile side of the union is unchanged (`SELECT profiles.user_id FROM public.business_profiles`), so every row the old scan could return is still returned: the new result is a superset by construction. **The new scan cannot miss anything the old one caught.**

And a second improvement the workplan does not claim: the old scan's count was **itself** bounded by its fetch limit, so on a large database it could under-report the size of the problem. The new count cannot. That is a bigger fix than "it now sees onboarding-only tenants".

**One low note:** `CREATE OR REPLACE FUNCTION` cannot change a return type. If these six output columns ever change, this migration will fail with *cannot change return type of existing function* and will need a `DROP FUNCTION` first. Worth a line in the runbook so it is diagnosed in seconds rather than minutes. **S0-3.**

### 12.2 S0-1 (required) — the guarantee is made at the repository and undone at the report

**At the repository the claim holds, and it is properly tested.** `if (error) throw error` covers a missing function, a missing grant and an unapplied migration; `if (!row) throw new Error('… returned no row')` covers an RPC that answers nothing; and the `bigint` → string coercion is explicit, which is a real trap avoided (PostgREST serialises `count(*)` as a string). The boundary suite pins both the *function does not exist* case and the *returned no row* case. So: **a failure at that layer can never look like zero.** ✅

**The report then turns it back into a zero.** Its failure branch emits:

```
{ checked: 0, count: 0, sample: [], withProfile: 0, onboardingOnly: 0,
  truncated: true, scope: 'unavailable — the read failed' }
```

The distinction lives **only in a prose string in a sibling field**. So:

- The gate as §11 words it — *do not set `enforce` while `missing_count` is above zero* — **is satisfied when the read failed**, because the count is `0`.
- No test and no machine can check "was this a real zero?", because the answer is English.
- This is the exact class of defect S-0 exists to close: a bookkeeping failure of ours that nobody can see.

The comment above that branch says the row "must never be confused with 'nothing is missing'". The intent is right; the mechanism cannot carry it.

**Required fix:** make the failure machine-readable — a `scanFailed: boolean`, or `count: number | null` — and restate the gate as **"`scanFailed` is false AND `count === 0`"**. Add the assertion to the report suite. §11 step 7 (which checks `scope` says "exhaustive") partially compensates today, and that is why this is a required fix rather than a blocking one: the runbook catches it, the type does not.

### 12.3 What QA must run on production (§11)

**Sound, ordered correctly, and the three-way agreement is the right instrument.** Step 3 nominating the hand-written union as **the authority** is the important choice: when a function and a model disagree, the plain SQL a human can read is what settles it, not the thing under test.

**`missing_onboarding_only` is exactly the right evidence** — it is, by construction, the population the old scan could not see, so it is the number that says whether the previous report was wrong on production and by how much. Recording it as "any number ≥ 0, nobody knows this yet" is the honest framing.

**The gate is not quite sufficient as worded** — see S0-1. With `scanFailed` it becomes sufficient. One addition worth making while there: step 6 says re-apply `20261005b` if the count is above zero, which is right, but it should also say **record the before and after numbers**, because a count that does not fall to zero after a re-run means the triggers are failing rather than the backfill having been missed — a different problem with a different fix. **S0-4.**

### 12.4 RD-10 — all three decisions right

**Archive the one that is actively wrong; banner the two that still have value.** That is the correct split, and the reasoning generalises: a document that would be *believed* is more dangerous than one that is merely old, and `BILLING_SYSTEM_COMPLETE_STATUS.md` claimed completeness for a system that bills the wrong thing. Keeping the original text under a correction table, rather than deleting it, preserves the record of what was thought — which matters when the next person asks why anyone believed it.

**The guard pins the right things, and Dev's description of it is accurate.** It asserts the three specific false claims are named, the banner sits **directly under the title** (placement, not presence), the H-7 text is where the mistake would be made, and that the `plans` table has no callers. It deliberately does not police general wording — which is the difference between a guard and a spellchecker, and the reason it will still be useful in a year.

### 12.5 SA ruling on RC-15

**Dev's observation is correct, the handling was right, and it stands as-is.**

- **The handling:** adding the test file to `ALLOWED` with a written reason, rather than routing the import through the barrel, is the right call and I would have insisted on it. A barrel import is the evasion the guard's own header warns about; **a declared referrer is auditable, a hidden one is not.** Removing the third RD-9 signal because RC-15 forbids naming it, and documenting the interlock, is also right — an interlock nobody wrote down is a trap for whoever next tries to add a signal.
- **The claim:** RC-15 *is* symbol-level for value imports and only **path-level for a type-only import**, because `import type { X }` erases at compile time and what survives in the source text is the path. Dev is right that it fails safe — it over-reports and forces a declaration.
- **The ruling:** the **behaviour stands** (widening or refining a security guard is not an S-0 change, and a guard that over-reports is the safe direction). But the guard's own header must stop claiming a precision it does not have: say *symbol-level for value imports; path-level for type-only imports, which fails safe*. **S0-2.** The refinement — skipping `import type` lines, or resolving symbols properly — becomes a **tracked item outside S-0**. A guard that overstates its own precision is what §13.10 of the entitlements workplan was about; correcting the claim costs one sentence.

### 12.6 TK-2 and `StripeInvoiceService`

**Dev's retraction of its own "missing files" flag is right, and worth noting as behaviour:** the paths were invented, Dev checked and withdrew it. §4.6 of the plan needs no correction.

**The `StripeInvoiceService` gap is real. My ruling: it belongs in the plan as a boundary note in §12 (Integration points), not as a 36th ledger row.** I read it: every method takes a `connectAccountId` and calls with `stripeAccount:`, and its six importers are payments, scheduling and booking lifecycle. It is **entirely Connect-side — invoicing the business's own clients** — so it is not a reuse candidate for platform subscription billing at all, and a ledger row would imply it is.

What the plan needs is one line saying so, because two hazards follow from its position:
1. It sits in the same folder as `StripeService` and shares the Stripe account, so someone asking "how do we create an invoice?" will find this first and use the wrong one.
2. **It has its own separate `getOrCreateCustomer`**, keyed by connect account — which could easily be mistaken for the one Q-T8 says to split. Naming both stops that.

This is a plan edit, not an S-0 code change. **S0-5** (low): raise it against the billing plan.

### 12.7 Scope

**Nothing in S-0 that should not be in S-0.** Every item is either a gate on switch-on, a correction to a document that would cause a wrong decision, or a guard replacing a comment that cannot exist. The `console.*` calls were flagged and not converted, which is the correct reading of the rule for a file this slice does not otherwise change.

**One thing S-0 delivers but cannot close by itself:** the scan is only *exhaustive in production* once the migration is applied there. S-0 ships the mechanism; §11 closes it. The workplan says so, so this is honest rather than a gap — but the S-0 exit criteria should state it in those words, so nobody reads "exhaustive anti-join: done" as "the count is now known".

### 12.8 Required and low fixes

| # | Fix | Priority |
|---|---|---|
| **S0-1** | Make a failed scan machine-readable (`scanFailed`, or `count: number \| null`) and restate the gate as *`scanFailed` is false AND `count === 0`*. Assert it in the report suite. A prose `scope` string cannot carry a gate condition. | **Required** |
| S0-2 | Correct the RC-15 guard's header: symbol-level for value imports, path-level for type-only imports, fails safe. Track the refinement outside S-0. | Low |
| S0-3 | Note in the runbook that changing the function's return columns needs a `DROP FUNCTION` first, because `CREATE OR REPLACE` cannot change a return type. | Low |
| S0-4 | §11 step 6: record the count before **and** after the backfill re-run — a count that does not fall to zero means the triggers are failing, which is a different problem. | Low |
| S0-5 | Add `StripeInvoiceService` to the billing plan's integration points as Connect-only, naming its separate `getOrCreateCustomer` so it is not confused with Q-T8's. | Low |

### 12.9 For the user

1. **This slice closes the thing I made binding before you switch enforcement on**, and it closes it properly: the count of accounts missing a plan record is now worked out by the database in one exhaustive pass instead of a partial scan, and it counts *everyone* rather than only accounts that got as far as creating a business.
2. **One fix before it counts as done.** If that check ever fails to run, the report currently shows "0 missing" with the explanation in a different column — so the rule "don't switch on while any are missing" would be satisfied by a check that never ran. That needs to be a flag a machine can read, not a sentence.
3. **The trim list cuts nobody.** It lists the dormant free accounts and, for each, the exact operation that would end its access. Deciding is yours; nothing happens until you ask for it.
4. **On the 168 log statements in the payment webhook — I agree with Dev, strongly.** They should be their own task, not a rider on the retirement. Mixing a mechanical logging rewrite into a deletion, inside the one file that handles live money, means a reviewer cannot tell the two apart — and that is how a retirement removes one line too many. Do the deletion on its own, with the smallest possible diff, and convert the logging separately where the whole change is uninteresting and therefore easy to check.
5. **Unchanged and still waiting on you:** the database key rotation, and making the CI checks required. Everything before the switch-on can be built and merged while those wait.

### 12.10 Dev response — SA round 1 applied

| # | Finding | What was done |
|---|---|---|
| **S0-1** | **Required**, and it is the S-0 defect class one layer up from where S-0 fixed it | **Both remedies, not one.** `tenantsWithoutPlanRow` gains **`scanFailed: boolean`**, and all four counts become `number \| null` — on failure every one is `null`, so no number is fabricated. The gate is restated as **`scanFailed === false && count === 0`** and asserted three ways (§12.11). `scanFailed` is the primary signal because **`null > 0` is `false` in JavaScript**: nullability without a flag is the same trap in a different hat. The prose `scope` string stays for human readers and is no longer load-bearing |
| **S0-2** | Low | RC-15's header corrected in place, and the refinement recorded as a tracked item outside S-0 — §10.3, pointed at **from the guard header**, so a reader who trips it finds the explanation in the file that tripped them |
| **S0-3** | Low | Runbook step 10 now warns that `CREATE OR REPLACE FUNCTION` **cannot change a return type** (`42P13`), and that adding a column to a `RETURNS TABLE` counts as changing it. **Safe to re-run is not the same as safe to edit** |
| **S0-4** | Low | Done in **both** places — §11 step 6 and runbook step 10 — each with the three outcomes. **A count that does not fall is a different problem with a different fix:** the backfill is not what is failing, the plan-row triggers are (runbook step 8, checker row `trigger rows`) |
| **S0-5** | Low, a plan edit | New **§4.6b** in `docs/requirements/BUSINESS_OS_TIER_BILLING_REUSE_PLAN.md` at its committed path — an **integration-points** line, not a 36th ledger row. Evidence re-verified here: 48 `connectAccountId`, 14 `stripeAccount:`, importers in payments / scheduling / booking, zero *Dies* patterns. Its **`getOrCreateCustomer` is `private` (`:65`) and is NOT the one Q-T8 splits** (`StripeService.ts:37`) — splitting the wrong one would put a Business OS subscriber onto a business's Stripe account |
| **Exit criteria** | Wording | §2.1, in SA's words, plus one carry-forward sentence |
| **SA's two confirmations** | Unclaimed properties | Stated in §4.1 **and made executable** — the strict widening over five fixtures, the fetch-limit under-report with a 2,500-tenant fixture |

### 12.11 How S0-1 is asserted

Three tests, because the finding has three parts:

| Assertion | What it pins |
|---|---|
| `a failed scan is distinguishable from nothing missing — by a FLAG, not by prose` | `scanFailed === true`, and `count` / `checked` / `withProfile` / `onboardingOnly` all **`null`, not `0`** |
| `the switch-on gate REFUSES a failed scan and accepts a real zero` | The gate written **once, as a predicate**, run against both cases. Before the fix both produced `count: 0` and both passed |
| `the OLD shape would have passed the gate — which is why the type changed` | The negative control: `{ scanFailed: false, count: 0 }` — the exact object the failure branch used to emit — **passes the gate**. Plus the proof that `null` alone was not enough: `Number(failed.count) > 0` is `false`, so the naive numeric gate admits a failed scan too |

**SA's "fix the same shape anywhere else":** the report has three other failure paths and **none has this defect** — pinned by a fourth test that makes all four reads fail at once.

| Path | On failure | Verdict |
|---|---|---|
| A failed plan **page** (`pagePlans`) | `truncated: true` on the static section | Already a flag — `accountsScanned: 0` cannot be read as "no accounts" |
| An unreadable **shadow window** | `rows: []` **with** `truncated: true`; a genuinely empty window returns `false` | Already distinguishable |
| An unreadable **setup-AI sample** | The section is **absent** rather than zeroed | The strongest form of all |

> One weaker spot **observed and deliberately not changed:** the setup-AI section's absence does not distinguish "not requested" from "could not be read". It fabricates no number and feeds no gate, so it is recorded here rather than fixed inside a slice that is not about it.

## 13. QA Testing Report

**QA — 2026-09-26**
**Test mode:** full, on the recovered and committed tree (`a572d432`)
**Strategy used:** mutation as the primary instrument — 20 mutations against the claims, each applied to real source, run, and reverted under an assert-clean-before / assert-clean-after protocol. Reading only where a mutation could not settle the question (the runbook's production steps, TK-2's line references, the RD-10 cross-check).
**Input source:** prompt keywords, seven ranked items
**Safety:** every restore was `git checkout --` against **named, committed file paths**, never a directory, with `git status --porcelain` asserted empty before each batch and after each mutation. The harness aborts rather than continues if a backup or a restore fails. Tree verified byte-clean at the end.

### Verdict

**PASS with three findings, none blocking.** S0-1 holds under every attack I could devise, the three arithmetic properties I flagged last round are now genuinely pinned, and the recovery is faithful. The findings are: one **unpinned arithmetic property** in the same family as A1/A2/A3 that nobody has closed yet, the **operator-facing gate sentence still carrying the pre-S0-1 wording**, and a prose over-pin in the RD-10 guard.

### 1. Every claim, attacked

Baseline and post-restore both **209 tests across the eight S-0 suites**; the working tree was byte-identical afterwards.

| # | Mutation | Result |
|---|---|---|
| **A1** | `missing_count` counts the clamped `sampled` instead of `missing` | **1 failed** ✅ |
| **A2** | `tenants_checked` counts raw `tenants` (rows) instead of `folded` (accounts) | **1 failed** ✅ |
| **A3** | `truncated` direction flipped | **1 failed** ✅ |
| **A10** | one of the two `user_id IS NOT NULL` guards dropped | **1 failed** ✅ |
| A4 | the fold loses its `GROUP BY` | 1 failed ✅ |
| A5 | the onboarding half of the union dropped | 1 failed ✅ |
| A6 | the clamp widened tenfold | 1 failed ✅ |
| A7 | `SECURITY DEFINER` | 1 failed ✅ |
| A8 | the `anon` REVOKE dropped | 1 failed ✅ |
| A9 | `search_path` no longer pinned | 1 failed ✅ |
| **B1** | a failed scan reports `scanFailed: false` | **2 failed** ✅ |
| **B2** | a failed scan reports `checked: 0, count: 0` beside the flag | **1 failed** ✅ |
| **B3** | the report reverts to the sample length as the count | **1 failed** ✅ |
| C1 | the repository re-implements the scan with `client.from` | 1 failed ✅ |
| C2 | a no-row answer becomes a clean zero instead of an error | 1 failed ✅ |
| C3 | the `bigint`-as-string coercion removed | 1 failed ✅ |
| **E2** | a NULL count coerced to `0` by `?? 0` | **3 failed** ✅ |
| D2 | the `NEVER BUILT` banner softened | 2 failed ✅ |
| D1 | *"zero callers"* reworded to *"no callers anywhere in the repository"* — **an improvement** | **1 failed** ⚠️ see QA-3 |
| **E1** | `missing_with_profile` and `missing_onboarding_only` **swapped** | **22 passed — NOT CAUGHT** ❌ see QA-1 |

**S0-1 is closed, and I could not get a bare zero out of it by any route.** `scanFailed: false` on failure, zeros beside the flag, the sample length as the count, a no-row answer turned into a clean zero at the repository, and a NULL count coerced by `?? 0` are each caught by a named test. The gate predicate `scanFailed === false && count === 0` refuses the failed scan and accepts a real zero, and the negative control shows the old shape passing.

### Findings

**QA-1 — The one arithmetic property still unpinned is the one §11 step 5 calls the evidence.** — Severity: **Medium**

- File: `supabase/migrations/20261010_business_os_tenants_missing_plan_row.sql:53-54`, guard `supabase/migrations/__tests__/business-os-tenants-missing-plan-row.test.ts:74-78`
- The guard asserts the two column **names** exist in the `RETURNS TABLE` clause (`missing_with_profile bigint`, `missing_onboarding_only bigint`) and nothing about the predicates that fill them. I swapped the two `WHERE` clauses — `missing_with_profile` computed from `NOT missing.has_business_profile` and vice versa — and **all 22 tests passed**.
- This matters more than it looks. `missing_onboarding_only` is the number **§11 step 5** records as *"the population the old code could not see… if it is above zero, the old report was wrong on production, and that number is the evidence."* Swapped, the evidence says the opposite, both values are plausible, and the three-way agreement in steps 3–4 would not catch it because `missing_count` is unaffected.
- It is the same family as A1/A2/A3, which Dev closed after my last round — this is the fourth member, missed because it is a *predicate* rather than a source table. **Fix is two lines**, matching the shape already used:
  ```
  expect(sql).toMatch(/FROM missing WHERE missing\.has_business_profile\) AS missing_with_profile/);
  expect(sql).toMatch(/FROM missing WHERE NOT missing\.has_business_profile\) AS missing_onboarding_only/);
  ```

**QA-2 — The gate the operator reads still carries the pre-S0-1 wording.** — Severity: **Medium**

- File: `docs/workplans/business-os-s0-unblock.md:426`
- S0-1 made the distinction machine-readable and restated the gate as **`scanFailed === false && count === 0`** — but only in a code comment (`lib/business-os/entitlements/report.ts:156`) and in a test predicate (`report.test.ts`, `gateSatisfied`). The sentence in §11, which is the one a human acts on, still reads:
  > *"do **not** set `BOS_ENTITLEMENTS_MODE=enforce` while `missing_count` is above zero"*
- That is the exact wording SA called insufficient, and for the exact reason: a scan that never ran leaves `missing_count` **not above zero**. I grepped both the workplan and the runbook — the two-condition form appears in neither.
- The code is right and the prose is stale, which is the safer half to be wrong, but S-0's whole thesis is that a distinction carried only in prose is not a distinction. **Restate §11's gate as both conditions**, in the operator's words: *"…while the scan has failed, or while `missing_count` is above zero. A failed scan is not a zero."*

**QA-3 — The RD-10 guard pins two facts as literal phrases, so an improvement to the prose fails CI.** — Severity: **Low**

- File: `docs/__tests__/billingDocsCorrected.rd10.guard.test.ts:89` (`/zero callers/i`), `:120` (`/ZERO callers/i`), `:116` (`/Do not wire\s*>?\s*anything to it/`)
- I reworded *"zero callers"* to *"no callers anywhere in the repository"* — strictly better, same fact — and the suite went **red**. Three other pins are fine because they pin **banner identity**, where exact text is the point (`NEVER BUILT`, `PART OF THIS SHIPPED AND PART NEVER DID`, the three truths). These two pin a **fact**, and a fact should survive being said better. `/\bno\b.*callers|zero callers/i` or a pin on the `plans` table name plus "callers" would keep the guarantee without freezing the sentence.
- Asked directly: **would an improvement fail it?** For the three banner pins, no. For these two, yes.

**QA-4 — The trim list still cannot say "I could not read", and it is the one section this slice added.** — Severity: Low (re-raised from my last round; not folded in)

- File: `lib/business-os/entitlements/report.ts:535` and `:221`
- `dormantChampionSection(dormant, truncated, now)` receives the static section's shared `truncated`. I probed it: on a **failed** plan walk the section returns `accounts: 0, rows: [], truncated: true` — the same shape as *"no dormant champions, and the walk was capped"*. `noEndDateAccountsWithoutProfile` reports `0` on the same failure.
- It fails in the **safe** direction (an empty trim list cuts nobody) and `truncated` is at least machine-readable, which is why this is Low and not a repeat of S0-1. The finding is the **asymmetry**: one section of this report distinguishes failure from emptiness with a dedicated flag because SA required it, and another, added by the same slice, uses a flag that carries two meanings. No test covers the failed-walk case for `dormantChampions`.

**QA-5 — One clamp lost in the recovery.** — Severity: Low

- File: `lib/business-os/entitlements/report.ts:570`
- The pre-reset version computed `dormantDays: Math.max(0, Math.floor(…))`. The re-applied version has `Math.floor(…)` without the clamp, so a `created_at` in the future (clock skew, or a report replayed at an earlier `now`) yields a negative dormancy. Trivial, and worth recording chiefly because it is **the only difference I could find** between the recovered implementation and the version I reviewed before the reset — everything else I had checked is present, and the six stray `\'` escapes in block comments are **gone** (verified: the only two remaining are legitimate escapes inside single-quoted strings, `report.ts:872` and `report.test.ts:580`, both pre-existing).

### 2. The anti-join

`WHERE user_id IS NOT NULL` landed on **both** union arms (`:25`, `:29`) and is pinned by a count-of-two assertion. Dev's note that both columns are `NOT NULL` today is correct and the filter is still right: the constraint lives in a different migration that a different change could alter.

The **widening is still strict**: the profile arm is unchanged, the second arm only adds rows, `folded` groups by `user_id`, and `bool_or` cannot turn a `true` into a `false` — so the new tenant set is a superset and `missing` can only grow. `missing_count` is unclamped (`SELECT count(*) FROM missing`) while only `sampled` carries the `LIMIT`; both now pinned. `NOT EXISTS` rather than `NOT IN` is NULL-safe and pinned. The `UNION` dedupes on the **pair**, so an account with 4,000 onboarding messages contributes at most two rows before the fold — the reason this could not be done through PostgREST at all.

### 3. The three layers

Each can fail: layer 1 by ten mutations above, layer 2 by A5 (the model's `oldScan`/`exhaustiveScan` divergence is what the union arm's removal exercises), layer 3 by C1/C2/C3/E2. **Can the model and the SQL drift together? Yes — and §8.1 and §8.2 say so in as many words** (*"What it cannot prove: that Postgres agrees"*), which is the right way to hold it. The only thing standing between the model and a wrong SQL is the text guard, which is exactly why QA-1 matters: it is the remaining seam in the layer that carries the weight.

### 4. §11, read as the user will

Step 6 carries SA's requirement in full: record the count, re-apply `20261005b`, record it again, and — stated plainly — **a count that does not fall is a different problem with a different fix**, naming the triggers rather than the backfill and pointing at runbook step 6b and the checker's `trigger rows`. Step 3 makes the hand-written union the authority and step 4 adds B1 for three-way agreement. Step 5 is honest that `missing_onboarding_only` is a number nobody knows. Step 8 requires that nothing changed. **S0-3 landed** — runbook line 212 warns that changing the return columns needs `DROP FUNCTION` first (`42P13`). The one defect is **QA-2**, the gate sentence.

### 5. RD-10 — is the guard just agreeing with what it generated?

**No, and I checked it against a source that predates it and survived untouched.** `docs/requirements/BUSINESS_OS_TIER_BILLING_REUSE_PLAN.md:484-486` (merged as PR #110) independently specifies all three: *"States there is no Stripe integration, no recurring billing and no dunning. All three are false"* → the guard pins those three truths; *"Banner: never built"* → `NEVER BUILT` in lines 2–6; *"Banner distinguishing what shipped from what did not"* + *"`plans` table … **zero callers**"* → both pinned. The archived document is intact: the original 691 lines are preserved **verbatim** below `Nothing below this line is a statement about the system as it is now`, inside a 733-line file, with the correction table and the superseded-by pointer above it — and the original is gone from `docs/`, so a planner cannot find it by accident. The banner-removal negative control is real (it builds `withoutBanner` from the file by `replace`, not from a literal).

### 6. `dormantChampions`, re-confirmed after the rewrite

`accounts: new Set(rows.map(r => r.user_id)).size` — **accounts, not rows**, with the comment explaining why that stays true if the one-record-per-account assumption ever stops holding. The `endAccessOp` is the **real** operation: `adminOps.ts:99-100` accepts `op: 'set_expiry'` with `field` in an enum containing `cohort_expires_at`, and `:364` refuses that field on an account with no cohort, which is exactly the 409 the code comment cites for not using `tier_expires_at`. The date is **not pasteable**: `reason` reads `REPLACE THIS with why, and the date above with the date you chose`. `afterExpiry` states the 30-day champion run-off and that nothing happens while the mode is off. The no-write test uses a denylist of method-name patterns (`/update|reset|ensure|create|end/i`) where an allow-list over the three methods the mock exposes would be strictly stronger — a one-line improvement, not a finding.

### 7. RD-9, TK-2, exit criteria

**RD-9's guard is the best-built thing in the slice.** The rule is evaluated against the real `vercel.json` and the real route; the negative control exercises the predicate on synthetic sources and checks **both** accepted signals so neither half is dead code; there is a non-vacuity floor on the config read (`crons.length > 3`); and the current state — unscheduled **and** blind — is pinned so a change to either shows in a diff. One observation: `excludesBusinessOsPayers` accepts a mere mention of `business_os_account_plans` or an import of the entitlements module, so a decorative reference would satisfy it. Permissive, but it takes two deliberate acts to reach.

**TK-2 is confirmed, and its line references are exact.** I spot-checked six: `StripeService.ts:149` and `:321` are both `stripe.prices.create`, `:301` is `updateSubscriptionAmount`, `webhook/route.ts:67-70` is the `subscriptions.list({ limit: 1 })` fallback, `:99-100` is the `Unused time` / `Remaining time` heuristic, and `allocateQuotasForUser` appears **5 times in the webhook + 1 in sync-subscription = exactly six**, as claimed.

**The exit-criteria wording is right.** Criterion 1 carries *"⚠️ Not 'the count is now known'"* and says the scan is exhaustive in production only once the migration is applied there, and the carry-forward sentence states it again. SA's concern cannot be read the wrong way out of §2.1.

### Numbers

| Check | Result |
|---|---|
| The eight S-0 suites | **209 tests**, green at baseline and after every restore |
| Wider scope (`entitlements`, `repositories`, `api/admin/business-os`, `supabase/migrations`, `docs/__tests__`, `api/cron/__tests__`, `scripts/__tests__`) | **65 suites / 1,354 tests, 0 failures** — consistent with Dev's 70 / 1,425 on a wider selection |
| ESLint over the touch set | **0 problems** |
| `tsc --noEmit` (verified method, `--typeRoots` at the main checkout) | **2,077**, with **zero in any file S-0 creates or touches** |
| Mutations | **20 applied, 19 caught, 1 not (QA-1)**; tree byte-clean before and after |

### Anything needing the user

Nothing to decide, and nothing here changes what §11 asks him to run. **QA-2 is the one he would be affected by**: the gate sentence he reads before flipping `BOS_ENTITLEMENTS_MODE` should say that a failed scan is not a zero, because that is the case the whole slice was written to make visible.

### Final Status

- [x] **Ready for the user's code review.** S0-1 holds under attack, the anti-join's arithmetic is pinned except for QA-1, the recovery is faithful, and nothing in S-0 writes anything.
- [ ] **Two lines before commit:** **QA-1** (pin the profile/onboarding predicates — the guard already has the shape) and **QA-2** (restate §11's gate in both conditions). **QA-3** should follow soon after; QA-4 and QA-5 are follow-ups that need not hold the commit.

### 13.10 Dev response — QA round 1

All five closed, plus both observations. QA passed on the committed tree: 20 mutations, 19 caught, 209 tests across the eight S-0 suites (report `d9aea623`).

| # | Finding | What was done |
|---|---|---|
| **QA-1** | Medium. The `missing_with_profile` / `missing_onboarding_only` predicates were unpinned — swapping them passed all 22 tests | **The fourth member of the S0-1 family, now pinned.** Two `toMatch`es assert which predicate feeds which column. **Proof, not assertion:** I reproduced QA's swap, watched the new test go red (1 failed, 22 passed), reverted, and confirmed the file is byte-identical to `HEAD` via `git diff --stat`. The comment records why the three-way agreement in runbook steps 3–4 cannot catch it: the sum is unchanged, so `missing_count` is unaffected, and both numbers stay plausible while the evidence says the opposite of what happened |
| **QA-2** | Medium, and the only one that reaches the user. The gate was still stated as `missing_count > 0` alone — the exact wording SA called insufficient | **Restated as two conditions in both documents**, in the operator's words, as a table: *(1) the scan ran — `scanFailed` is `false`; (2) and it found nothing — `count` is `0`, not `null`*, with **"a failed scan is not a zero"** on its own line and `scanFailed === false && count === 0` for anyone automating it. Also fixed the runbook's "what to do if the count is above zero" to rule out a failed scan first, and its change-history line. QA is right that leaving the gate as the one prose-only distinction would have been S-0 contradicting itself |
| **QA-3** | Low. Two FACT pins were literal phrases, so better wording failed CI | Both now use one shared `NO_CALLERS` matcher that accepts the natural ways to say it. **The three banner pins stay exact** — a banner has an identity, and that is a different kind of claim. A new test proves the matcher is not merely permissive: six better phrasings pass, three statements of the opposite (*"has two callers"*, *"Business OS reads the `plans` table"*) fail. That control immediately earned itself — it caught my own first regex, which missed *"nothing has ever called it"* |
| **QA-4** | Low, re-raised. The trim list reported a failed walk as `accounts: 0, rows: []` | **Fixed rather than justified.** `DormantChampionSection` gains `walkFailed: boolean`, `accounts` becomes `number \| null`, and a new `incomplete` string says so in words for whoever reads the report rather than a field. `truncated` could not carry this: a healthy walk that reaches `MAX_ACCOUNTS` sets it too, so it cannot tell "capped" from "broken" — which is why there are now two tests, one per state. Rows collected before the error are still listed: each is individually true, the list is simply not complete |
| **QA-5** | Low. `Math.max(0, …)` was lost on `dormantDays` in the re-application | Restored, with a comment saying what it is for, and a test using a record created in 2027. Noted for the record: QA found this to be **the only** difference between the recovered implementation and what it had reviewed before the reset |

**Both observations taken:**

- **The no-write test is now an allow-list** over the three reads the report may perform, rather than a denylist of write-sounding name patterns. A denylist only rejects the names somebody thought of; this fails by default on any new method added to the stub. Plus a non-vacuity assertion that the stub was exercised at all.
- **RD-9's detector no longer accepts a mention.** It now requires the table inside a `.from('…')` call or the module inside an `import … from '…'`, with three decorative cases asserted to fail — the realistic one being `// TODO: skip accounts in business_os_account_plans`, which is exactly the sort of line sitting in a route somebody is about to schedule.

## 14. Commit Info

_RM will populate this section._

---

## Change History

| Date | Change | Details |
|------|--------|---------|
| 2026-09-26 | Created | S-0 items 1–6 implemented; TK-2 confirmed read-only with two corrections to my own first pass and none to §4.6; `console.*` flagged in six files, none of which S-0 modifies |
| 2026-09-26 | Re-applied after a tree reset; QA read-level findings folded in | A QA reset loop destroyed every uncommitted change to a tracked file. Rebuilt from the surviving guards (`dormantChampions` 14/14 and RD-10 13/13 on the first run). **The untracked SQL survived deletion but carried seven live mutants**, three of which — `missing_count` from the sample, `tenants_checked` from the raw union, and a reversed `truncated` — were exactly the arithmetic properties QA had reported as unasserted, and are now asserted. `WHERE user_id IS NOT NULL` added to both UNION arms (unreachable today; both tables are NOT NULL). Stray `\'` escapes swept. **Committed as WIP `a572d432`.** §10.4 |
| 2026-09-26 | SA round 1 applied (S0-1 required + S0-2..S0-5 low) | S0-1: the report no longer emits `count: 0` on a failed scan — `scanFailed: boolean` plus nullable counts, the gate restated as a predicate and asserted three ways, and the other three failure paths checked for the same shape. S0-2 RC-15 header corrected and the refinement tracked outside S-0. S0-3 runbook `DROP FUNCTION` warning. S0-4 before-and-after counts in both places. S0-5 §4.6b in the plan. Exit criteria §2.1 worded so "done" cannot read as "the count is known". SA's two confirmations stated and made executable. |
| 2026-09-26 | RC-15 findings resolved | The RD-9 guard's third signal removed (RC-15 makes it unreachable, and the interlock is now documented in the function); `dormantChampions.test.ts` declared in `ALLOWED` rather than routed through the barrel. §10.3 |
| 2026-09-26 | SA code review: APPROVED for QA with S0-1 (SA) | Added §12. Ran the eleven S-0 suites (270 tests, green). The anti-join is correct: `UNION` dedupes on the pair so the `bool_or` fold is necessary and present, `NOT EXISTS` is NULL-safe, and — the design point that matters — `missing_count` is UNCLAMPED while only the sample is capped, so the number the gate reads can never be silently short. INVOKER/STABLE/`search_path=""`/REVOKE-then-GRANT posture matches WC-9. **Widening verified strict**: the profile side of the union is unchanged, so the new result is a superset by construction; and the old count was itself bounded by its fetch limit, so it could under-report — a bigger fix than Dev claimed. **S0-1 (required):** the repository genuinely guarantees "a failure is an error, never zero" (it throws on error AND on a missing row, with explicit bigint coercion, both pinned by tests) but the REPORT undoes it — its failure branch emits `count: 0` with the distinction only in a prose `scope` string, so the gate as worded is satisfied by a check that never ran. Make it machine-readable and restate the gate. RD-10's three decisions endorsed (archive what would be believed, banner what still has value, keep the original text) and the guard pins the right things. **RC-15 ruling: stands as-is** — adding the test to ALLOWED beats laundering through the barrel, and the claim is symbol-level for value imports but path-level for type-only ones, which fails safe; correct the header (S0-2) and track the refinement outside S-0. **StripeInvoiceService: a boundary note in the billing plan's integration points, not a 36th ledger row** — it is entirely Connect-side and has its own separate `getOrCreateCustomer` that could be confused with Q-T8's (S0-5). Scope is clean; the one thing S-0 cannot close alone is that the scan is only exhaustive in production once applied, which §11 does. Agreed with Dev that the webhook's 168 log statements must be their own task, not a rider on the retirement. |
| 2026-09-26 | QA round 1: PASS with three findings (QA) | Added §13. Twenty mutations against the claims, nineteen caught, tree byte-clean before and after. S0-1 holds by every route: `scanFailed: false`, bare zeros beside the flag, the sample length as the count, a no-row answer turned into a clean zero at the repository, and a NULL count coerced by `?? 0` are each caught by a named test. A1/A2/A3 and the NULL guards now bite. **QA-1 (Medium):** the `missing_with_profile` / `missing_onboarding_only` predicates are unpinned — swapping them passes all 22 SQL tests, and `missing_onboarding_only` is what §11 step 5 calls the evidence. **QA-2 (Medium):** §11:426 still gates on "`missing_count` is above zero" alone; the two-condition form appears only in a code comment and a test predicate. **QA-3 (Low):** the RD-10 guard pins "zero callers" as a literal phrase, so rewording it better fails CI. QA-4/QA-5 low. RD-10 cross-checked against the merged reuse plan rather than against itself; TK-2 line references spot-checked exact; S0-3 present at runbook:212. 65 suites / 1,354 tests, lint 0, tsc 2,077 with zero in S-0 files. |
| 2026-09-26 | QA round 1 closed (Dev) | QA-1: the two split predicates pinned — QA's swap reproduced, watched go red, reverted, tree byte-identical. QA-2: the switch-on gate restated as TWO conditions in the workplan and the runbook, in the operator's words, because leaving the gate as the one prose-only distinction would be S-0 contradicting itself. QA-3: the two fact pins share a matcher that survives better wording and still rejects the opposite — its control caught my own first regex. QA-4: `walkFailed` + `accounts: number \| null` + an `incomplete` sentence, with a test for the failed walk AND the capped walk. QA-5: the clamp restored. Both observations taken: allow-list for the no-write check, and RD-9 now requires a query or an import rather than a mention. **70 suites / 1,439 tests**, lint 0 errors, tsc 2,077 with zero in S-0 files. |
