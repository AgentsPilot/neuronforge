# Workplan: Business OS tier billing — S-0 "Unblock"

> **Last Updated**: 2026-09-26

**Developer:** Dev
**Requirement:** [BUSINESS_OS_TIER_BILLING_REUSE_PLAN.md](/docs/requirements/BUSINESS_OS_TIER_BILLING_REUSE_PLAN.md) §6.3 (S-0), RD-9, RD-10, H-7, TK-2
**Branch:** `feature/business-os-s0-unblock` (from `origin/main` at `fa64e384`)
**Date:** 2026-09-26
**Status:** Code Complete — awaiting SA review

## Table of Contents

- [1. Overview](#1-overview)
- [2. Scope, and what is deliberately outside it](#2-scope-and-what-is-deliberately-outside-it)
- [3. Analysis summary](#3-analysis-summary)
- [4. Implementation approach and the decisions taken](#4-implementation-approach-and-the-decisions-taken)
- [5. Files created / modified](#5-files-created--modified)
- [6. Task list](#6-task-list)
- [7. TK-2 — the confirmed inventory](#7-tk-2--the-confirmed-inventory)
- [8. How the exhaustive scan is verified without a database](#8-how-the-exhaustive-scan-is-verified-without-a-database)
- [9. `console.*` in the touch set — flagged, not converted](#9-console-in-the-touch-set--flagged-not-converted)
- [10. Test and typecheck numbers](#10-test-and-typecheck-numbers)
- [11. What QA must run against production](#11-what-qa-must-run-against-production)
- [12. SA Review Notes](#12-sa-review-notes)
- [13. QA Testing Report](#13-qa-testing-report)
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
| `lib/business-os/entitlements/__tests__/report.test.ts` | 33 | ✅ |
| `lib/business-os/entitlements/__tests__/dormantChampions.test.ts` | 14 | ✅ new |
| `lib/repositories/__tests__/BusinessOsAccountPlanRepository.test.ts` | 36 | ✅ |
| `supabase/migrations/__tests__/business-os-tenants-missing-plan-row.test.ts` | 16 | ✅ new |
| `scripts/__tests__/entitlementSqlScripts.guard.test.ts` | 70 | ✅ |
| `app/api/cron/__tests__/freeTierExpiration.rd9.guard.test.ts` | 5 | ✅ new |
| `docs/__tests__/billingDocsCorrected.rd10.guard.test.ts` | 13 | ✅ new |
| `lib/repositories/__tests__/businessOsEntitlements.imports.guard.test.ts` | 8 | ✅ — see §10.3 |

### 10.1 Full affected scope

```
lib/business-os/entitlements  lib/repositories  supabase/migrations
scripts/__tests__  app/api/cron/__tests__  docs/__tests__
app/admin/business-os-tiers  app/api/admin/business-os
```

**70 suites, 1,425 tests, all passing.** 85s.

### 10.2 Typecheck and lint

| Check | Result |
|---|---|
| `tsc --noEmit` over the whole repository | **2,077 errors** |
| In any file S-0 creates or modifies | **0** |
| In the directories S-0 touches | 5, all in files it does not touch: `lib/repositories/CalibrationSessionRepository.ts`, `lib/repositories/WebsiteContentRepository.ts`, `scripts/__tests__/check-bos-llm-literals.test.ts` (×3) |
| ESLint on the nine changed `.ts` files | **0 errors**, 3 warnings — all three are pre-existing `any`s in the repository test's PostgREST builder stub (lines 48 and 71), outside every hunk of this diff |

**On the total moving from 2,029 to 2,077.** The 2,029 baseline was measured on the tier-configuration branch; this branch is based on a **newer `origin/main`** (`fa64e384`), so the 48 arrived with main, not with S-0. The control is per-file rather than the total: **no file this slice creates or modifies produces an error**, and the twelve largest contributors are all long-standing agent-platform files (`components/wizard/hooks/useWorkflowActions.ts` 59, `scripts/test-slot-filling-scenarios.ts` 48, `app/v2/agents/[id]/page.tsx` 47 …), none of them in S-0's touch set. A whole-repository total is not a usable regression signal across a rebase; the per-file count is.

### 10.3 One finding, from an existing guard catching me

The first full run went **red on RC-15** (`businessOsEntitlements.imports.guard.test.ts`), twice, and both were true positives about my own code:

| What tripped it | Why | What I did |
|---|---|---|
| The RD-9 guard listed `businessOsAccountPlanRepository` as one of three signals that a route consults entitlement state | RC-15 forbids application code from naming those symbols at all — so the third signal was describing a path that **cannot legitimately exist** | **Removed the third signal.** The two remaining ones (the table name, the module path) are exhaustive *because* RC-15 closes the third. That interlock is now written in the function's doc comment, along with the fact that RC-15 is what taught it |
| `dormantChampions.test.ts` names the repository in the **path** of an `import type` | RC-15's match is symbol-shaped but a module path contains the class name, so a type-only import trips it | **Added the test to `ALLOWED`** with the reason. The alternative — importing the type through the `@/lib/repositories` barrel — would have passed by hiding the referrer, which is the exact evasion RC-15's own header warns about |

Recorded because the second one is a **small imprecision in RC-15 worth knowing**: it says it is symbol-level, and for a type-only import it is really path-level. Not changed here (it fails safe, and widening a security guard is not an S-0 change), but it is the kind of thing that makes the next person think they have done something wrong when they have not.

## 11. What QA must run against production

S-0's central claim — *the scan is exhaustive* — is the one thing that cannot be established from the repository. These are the checks, in order, and they need the Supabase SQL editor.

| # | Step | Expected | What a different answer means |
|---|---|---|---|
| 1 | Paste `supabase/migrations/20261010_business_os_tenants_missing_plan_row.sql` (runbook **step 10**) | The final `SELECT` prints the migration name and the runbook pointer | If the paste fails, it is a **construct** — all prose is already gone from these files (see the runbook's *Why the scripts are boring*, and that the apostrophe theory was **disproven** by probe on 2026-09-24) |
| 2 | `SELECT * FROM public.business_os_tenants_missing_plan_row(20000);` | One row | Nothing, or an error, means step 1 did not take |
| 3 | The hand-written union/anti-join in runbook step 10 | `missing` **equals** `missing_count` from step 2 | A difference means the function's logic is wrong, and step 3 is the authority |
| 4 | Checker **block 3**, row **B1** | Agrees with both | B1 is the pre-existing check. Three-way agreement is the point of the slice |
| 5 | Record `missing_onboarding_only` | **Any number ≥ 0 — nobody knows this yet** | This is the population the old code could not see. If it is above zero, the old report was **wrong on production**, and that number is the evidence |
| 6 | If `missing_count > 0`: re-apply `20261005b` (re-runnable), then repeat 2–4 | `missing_count` → 0 | — |
| 7 | Load the admin shadow report and read `tenantsWithoutPlanRow` | Same `count`, and its `scope` says "exhaustive" | A mismatch means the route is not reading the new scan |
| 8 | Read the report's `dormantChampions` | A list, with an `endAccessOp` per account, **and nothing changed** | Any state change is a defect: this section must write nothing |

> **Gate:** do **not** set `BOS_ENTITLEMENTS_MODE=enforce` while `missing_count` is above zero. An account with no plan row resolves to no entitlements, so under enforcement it is a customer who is refused. G-1 and G-2 both remain outstanding regardless.

**Verifiable without production:** everything in §10, plus the guard tests. **Not verifiable without production:** items 1–8 above.

## 12. SA Review Notes

_SA will populate this section._

## 13. QA Testing Report

_QA will populate this section._

## 14. Commit Info

_RM will populate this section._

---

## Change History

| Date | Change | Details |
|------|--------|---------|
| 2026-09-26 | Created | S-0 items 1–6 implemented; TK-2 confirmed read-only with two corrections to my own first pass and none to §4.6; `console.*` flagged in six files, none of which S-0 modifies |
| 2026-09-26 | RC-15 findings resolved | The RD-9 guard's third signal removed (RC-15 makes it unreachable, and the interlock is now documented in the function); `dormantChampions.test.ts` declared in `ALLOWED` rather than routed through the barrel. §10.3 |
