# Workplan: Business OS Plan Payments, P-0 (Stripe webhook logging to Pino)

> **Last Updated**: 2026-10-02

**Developer:** Dev
**Requirement:** [BUSINESS_OS_PLAN_PAYMENTS_REQUIREMENT.md](/docs/requirements/BUSINESS_OS_PLAN_PAYMENTS_REQUIREMENT.md): §9.1 P-0, §9.4 (coordination), SR-10, SR-16, conditions C-1. Also [BUSINESS_OS_CREDITS_BOOST_REQUIREMENT.md](/docs/requirements/BUSINESS_OS_CREDITS_BOOST_REQUIREMENT.md) §18.3 T-17, §18.4, §18.5 slice 0, §18.8 (untracked in the main checkout on this date). Reuse plan [TK-4](/docs/requirements/BUSINESS_OS_TIER_BILLING_REUSE_PLAN.md).
**As-built:** [BUSINESS_OS_PLAN_PAYMENTS_ASBUILT.md](/docs/requirements/BUSINESS_OS_PLAN_PAYMENTS_ASBUILT.md) §1.2 (TK-4: 173 `console.*`), §2 (webhook envelope)
**Date:** 2026-10-02
**Branch:** `feature/bos-plan-payments-p0`, first cut from `origin/docs/bos-plan-payments-scope` at `259f67b5`; before implementation it was moved onto `origin/main` at `9a7c4fb3` (contains PR #175 as `25cf76b0`), in the `neuronforge-invite-s0` worktree. No commits on it yet.
**Status:** Code Complete (2026-10-02). SA conditions P0-C1 to P0-C6 addressed (§13.8). Everything is **uncommitted**, waiting for SA code review, QA and the user's look at the diff.

> **One slice, two requirements.** P-0 **is** Credits Boost slice 0. Both requirements ask for the same mechanical conversion of the same file, with the same rule: no behaviour change and Connect before/after evidence. The user approved it under CLAUDE.md rule 3 (boost §18.8, row "0"; plan payments §9.1). Whichever session starts first does it; this session is starting first, so the Credits Boost session must **not** schedule its own slice 0 and should rebase slice 4a onto this. Both requirements' acceptance conditions are listed in §7 so a single review closes both.

## Overview

`app/api/stripe/webhook/route.ts` (2,748 lines) receives every Stripe event: platform billing and the **live Connect payments of Business OS clients** (invoices, bookings, payment plans, refunds, disputes). It logs through 173 `console.*` calls (106 `log`, 60 `error`, 7 `warn`), against CLAUDE.md rule 3. P-0 converts every one of them to structured Pino (`createLogger`, a request child logger carrying a `correlationId` and the Stripe event id, errors as `{ err }`), removes full-payload dumps from the logs, and changes **nothing else**. The slice ships with machine-checked evidence that only logging changed, plus a new behavioural harness that records what the Connect path writes, run before and after. It is a precursor: P-1 (the price-id router) and boost slice 4a must not put new code into the unconverted file (C-1).

---

## Table of Contents

1. [Analysis summary](#1-analysis-summary)
2. [Scope](#2-scope)
3. [Implementation approach](#3-implementation-approach)
4. [Files to create / modify](#4-files-to-create--modify)
5. [Task list](#5-task-list)
6. [Evidence plan: no behaviour change](#6-evidence-plan-no-behaviour-change)
7. [Acceptance (both requirements)](#7-acceptance-both-requirements)
8. [Risks](#8-risks)
9. [Demo](#9-demo)
10. [Sizing](#10-sizing)
11. [Rollback](#11-rollback)
12. [Questions for SA](#12-questions-for-sa)
13. [Evidence log](#13-evidence-log)
14. [SA Review](#sa-review)

---

## 1. Analysis summary

| Fact | Evidence |
|---|---|
| 173 `console.*` calls: 106 `log`, 60 `error`, 7 `warn` | `grep -o "console\.[a-z]*" route.ts \| sort \| uniq -c` on `259f67b5` |
| 17 functions contain them: `handleCheckoutCompleted` 34, `handleConnectInvoicePaid` 26, `handleInvoicePaid` 25, `handleConnectCheckoutCompleted` 18, `POST` 15, `handleSubscriptionUpdated` 9, `recordPlanPeriodPaid` 7, `handleConnectPaymentIntentSucceeded` 6, `handleConnectInvoicePaymentFailed` 6, `handleInvoicePaymentFailed` 5, `handleDispute` 4, `handleConnectInvoiceUncollectible` 4, `handleConnectInvoiceFinalized` 4, `handleChargeRefunded` 4, `handleSubscriptionDeleted` 3, `handlePlanSubscriptionEnded` 2, `accountOwns` 1 | awk count per function |
| 14 calls span several lines; 2 are inside `.catch(err => console.*(…))` arrow bodies (`:1021`, `:2225`) | grep |
| Three calls dump whole objects that can carry client data: `invoice.metadata` (`:84`), `session.metadata` (`:469`), `JSON.stringify(invoice.metadata)` on **Connect** invoices (`:1494`). Connect metadata is written by the connected business and may hold client details | grep |
| No call logs an email, card data or a secret. Ids (`cus_`, `in_`, `sub_`, `pi_`, user uuids, connected account ids) are logged throughout | grep for `email`, `card`, `name`, `address` in `console.*` lines: none |
| **`@/lib/logger` resolves to `lib/logger.ts`, which has no `redact` configuration.** The redaction list in `lib/logger/config.ts` is only used by `lib/logger/index.ts`, which the alias does not reach (a file beats a directory index in module resolution) | `lib/logger.ts` (30 lines); `lib/logger/config.ts:37-75` |
| Handlers are module-level functions called from `POST`. There is no request context they can read, so a request child logger has to be passed in | `route.ts:2416` onwards |
| Existing tests pin the file's text: `emptyBody.guard.test.ts` requires the strings "Empty request body" and "Signature verification failed" in specific branches; `userSubscriptionsWriteLockdown.qa.test.ts` counts five `new QuotaAllocationService(supabaseAdmin)` sites. Neither imports the route | the two test files |
| **No test executes the route.** There is no Connect behaviour test today | `grep -rl "webhook/route"` in tests |
| Out of scope, flagged (not changed here): the route builds its own service-role client (`createClient`, `:28`), not a repository (rule 1); the 500 response returns `error.message` to the caller in production (`:2742`) | read |

The log lines use emoji prefixes and `[Webhook]` tags, and interpolate values into the message. Pino wants a static message and the values in the context object.

---

## 2. Scope

| In scope | Out of scope |
|---|---|
| All 173 `console.*` calls in `app/api/stripe/webhook/route.ts` converted to Pino | Any change to what the webhook does: claims, statuses, responses, DB writes, Stripe calls, branch order |
| A module logger plus a per-request child logger with `correlationId` and the Stripe event id, passed to every function that logs | `lib/stripe/StripeService.ts` (2 `console.*`, boost T-17 leaves it alone), other Stripe routes, `lib/payments/**` |
| Full-object dumps replaced by ids and key lists | Fixing the `error.message` leak in the 500 body, or the direct `createClient` (flagged in §1; separate fixes) |
| A source guard (no `console.*`; logger shape) and a behavioural Connect harness | Adding redaction to `lib/logger.ts` (§12 Q-1) |
| A reusable "only logging changed" AST check script | Router, dispatcher, Business OS branch (P-1) |

---

## 3. Implementation approach

### 3.1 Logger shape

```typescript
import { createLogger, type Logger } from '@/lib/logger';

const logger = createLogger({ module: 'stripe-webhook', route: '/api/stripe/webhook' });

export async function POST(request: NextRequest) {
  const correlationId = request.headers.get('x-correlation-id') ?? crypto.randomUUID();
  let log = logger.child({ correlationId });
  // ... after the event is verified:
  log = log.child({ stripeEventId: event.id, eventType: event.type, livemode: event.livemode });
  // ... after the Connect split:
  // connectAccountId is bound on Connect events only
}
```

- **Correlation:** Stripe sends no correlation header, so the id is generated per request. The Stripe event id is bound as soon as the event is verified (boost §18.4 asks for the event id as the webhook's correlation), so every handler line carries both.
- **Threading:** every function that logs gets one extra **last** parameter, `log: Logger`, and every call site passes it. This is plain parameter passing. AsyncLocalStorage would avoid touching signatures but is a new pattern (rule 7), so it is not used (§12 Q-2).
- **`.catch` arrows** become `.catch((err) => log.error({ err }, '…'))`.

### 3.2 Conversion rules

| Rule | Detail |
|---|---|
| Level | `console.log` → `info`, `console.warn` → `warn`, `console.error` → `error`. **No level is changed**, except the deviations listed in the workplan's conversion table (expected: the three payload dumps go to `debug` with keys only). Each deviation is listed with its line and reason |
| Message | Static string, no emoji, no interpolation. The words stay the same where a test or a person searches for them (§1: "Empty request body", "Signature verification failed") |
| Context | Values move into the object: `log.info({ invoiceId: invoice.id, customerId }, 'Processing invoice.paid')`. Field names follow `SYSTEM_LOGGING_GUIDELINES.md` (camelCase, `userId`, `invoiceId`, `subscriptionId`, `connectAccountId`, `stripeEventId`) |
| Errors | Always `{ err }`. A PostgREST error object is passed as `{ err: error }`; `stripeError.message` becomes `{ err: stripeError }` |
| No payloads | No whole Stripe object, no `metadata` object, no `JSON.stringify` of anything. Metadata becomes `metadataKeys: Object.keys(x ?? {})`; line-item dumps become a count and amounts. Ids are fine |
| No PII, secrets, card data | None are logged today (§1); the guard test pins that no log call references `email`, `customer_details`, `billing_details`, `payment_method_details` or `card` |
| Pure arguments only | A log argument may not call anything with a side effect. Allowed inside log arguments: property reads, `String()`, `Number()`, `Object.keys()`, `.length`, `.map()` over already-loaded arrays, `.toFixed()`, `.toLocaleString()`, `Boolean()`. The AST script lists every call inside a log argument, before and after, so a reviewer can confirm |

### 3.3 Why the evidence is two-sided

A logging change in a 2,748-line money file can go wrong in two ways that a reviewer reading the diff will not reliably catch: an edit that slips into a non-logging line (a deleted `return`, a moved brace, a renamed variable), or a log argument that was doing work. The AST check proves the first cannot have happened; the harness proves the observable writes did not change for the Connect paths. Both are run **before** converting (to capture the baseline) and after.

---

## 4. Files to create / modify

| File | Action | Reason |
|---|---|---|
| `app/api/stripe/webhook/route.ts` | modify | 173 conversions, module logger, request child logger, `log` parameter on 17 functions and their call sites. Nothing else |
| `app/api/stripe/webhook/__tests__/pinoLogging.guard.test.ts` | create | Source guard: zero `console.*`; imports `createLogger`; `POST` builds a child with `correlationId` and binds `stripeEventId`; no log call passes a `metadata` object, `JSON.stringify`, or a PII field name; the pinned strings of `emptyBody.guard.test.ts` survive |
| `app/api/stripe/webhook/__tests__/connectPath.characterisation.test.ts` | create | Behavioural harness (§6.2): imports the route with Supabase, Stripe and side services mocked; feeds Connect events; records every DB operation, Stripe call and response |
| `app/api/stripe/webhook/__tests__/fixtures/connect/*.json` | create | Synthetic Connect events on Basil (`2025-10-29.clover`) shapes, one per scenario in §6.2 |
| `app/api/stripe/webhook/__tests__/__snapshots__/connectPath.characterisation.test.ts.snap` | create | Recorded **on the unconverted file**, then must match unchanged after |
| `scripts/check-logging-only-diff.ts` | create | AST check (§6.1). Reusable for every later rule-3 conversion and for P-1's "Connect functions unchanged" check (`--functions` mode) |
| `docs/workplans/BUSINESS_OS_PLAN_PAYMENTS_P0_WORKPLAN.md` | create | This file |

No migration. No change to `lib/logger.ts`, `lib/stripe/**`, `lib/payments/**`.

---

## 5. Task list

**Phase A: baseline (before touching `route.ts`)**
- [x] ✅ A1. Confirm the branch (`git branch --show-current` = `feature/bos-plan-payments-p0`) and that `route.ts` is byte-identical to `origin/main` (`git diff origin/main -- app/api/stripe/webhook/route.ts` empty). Record the `main` sha. (§13.1)
- [x] ✅ A2. Write `scripts/check-logging-only-diff.ts` (§6.1) and its own small Jest test (`scripts/__tests__/check-logging-only-diff.test.ts`): a pair of inputs where only a log call changed passes; a pair where a `return` was dropped, an `if` condition changed, or a log argument gained a side-effecting call fails.
- [x] ✅ A3. Write the characterisation harness (§6.2) and its Connect fixtures. Run it **against the unconverted route** to write the snapshot. Save the run output (pass count, scenario list) into §13 of this workplan. (§13.2)
- [x] ✅ A4. Run the existing guards against the unconverted route and record the result: `emptyBody.guard.test.ts`, `userSubscriptionsWriteLockdown.qa.test.ts`, `app/api/stripe/__tests__/stripeAuditEntries.test.ts`, `lib/payments/__tests__/` (Connect helpers). (§13.3)
- [x] ✅ A5. Record the TypeScript baseline for the file: `npx tsc --noEmit -p tsconfig.json` filtered to `app/api/stripe/webhook/route.ts` (count and text of errors, if any). (§13.3; scoped tsconfig, see there)

**Phase B: conversion**
- [x] ✅ B1. Add the module logger, the `Logger` type import, and the request child logger in `POST` (correlation id at entry; `stripeEventId`, `eventType`, `livemode` bound after verification; `connectAccountId` bound after the Connect split).
- [x] ✅ B2. Add `log: Logger` as the last parameter of the 16 handler functions and `accountOwns`; pass `log` at every call site (the `switch` in `POST`, and the internal calls such as `recordPlanPeriodPaid` and the eight `accountOwns` calls).
- [x] ✅ B3. Convert `POST` (15 calls), keeping the two pinned strings.
- [x] ✅ B4. Convert the Connect functions: `handleConnectInvoicePaid`, `handleConnectCheckoutCompleted`, `handleConnectPaymentIntentSucceeded`, `handleConnectInvoicePaymentFailed`, `handleConnectInvoiceFinalized`, `handleConnectInvoiceUncollectible`, `recordPlanPeriodPaid`, `handlePlanSubscriptionEnded`, `accountOwns`, `handleDispute`, `handleChargeRefunded` (66 calls). The Connect metadata dump (`:1494`) becomes `metadataKeys` at `debug`.
- [x] ✅ B5. Convert the platform functions: `handleInvoicePaid`, `handleInvoicePaymentFailed`, `handleCheckoutCompleted`, `handleSubscriptionUpdated`, `handleSubscriptionDeleted` (76 calls). The two platform dumps (`:84`, `:469`) become ids and `metadataKeys`.
- [x] ✅ B6. Fill the conversion table in §13: every level deviation and every removed payload, with old line and reason. Anything not listed is a straight `log→info / warn→warn / error→error`. (§13.5)

**Phase C: evidence**
- [x] ✅ C1. Write `pinoLogging.guard.test.ts` (§6.3).
- [x] ✅ C2. Run `scripts/check-logging-only-diff.ts --base origin/main --file app/api/stripe/webhook/route.ts`. It must report **identical** non-logging ASTs. Paste the summary and the "calls inside log arguments" listing into §13. (§13.4)
- [x] ✅ C3. Re-run the harness with `--ci` (no snapshot writes). It must pass against the snapshot recorded in A3. (§13.2: SHA-256 identical)
- [x] ✅ C4. Re-run the A4 tests and the A5 type check; same results as the baseline (no new type error in the file). (§13.3)
- [x] ✅ C5. `grep -c "console\." app/api/stripe/webhook/route.ts` = 0; `npm run lint` shows no new finding in the file. (§13.6)
- [x] ✅ C6. `npm run test:bos-entitlements`, as a hygiene check (P-0 imports nothing from the entitlements module, so it must be unchanged and green, or red only on main's known reds, listed). (§13.6: green)
- [x] ✅ C7. Update this workplan's status to Code Complete and hand to TL for SA code review. Leave everything uncommitted (standing preference: the user sees the diff before any commit).

---

## 6. Evidence plan: no behaviour change

### 6.1 AST check: only logging lines changed

`scripts/check-logging-only-diff.ts` (TypeScript compiler API, `typescript` 5.9 is already a dependency):

1. Read the base version (`git show <base>:<file>`) and the working-tree version.
2. Parse both with `ts.createSourceFile`.
3. Normalise both with the same transform:
   - every call whose callee is `console.<x>`, or `<logger|log>.<info|warn|error|debug|trace|fatal>` becomes the placeholder call `__LOG__()` (arguments dropped), in statement **and** expression position;
   - a parameter named `log` typed `Logger` is removed; an argument that is exactly the identifier `log` is removed from every call;
   - in the head only: the `createLogger` / `Logger` import, the `const logger = createLogger(…)` declaration, and the `log = …child(…)` declarations and assignments are removed;
   - comments and formatting are dropped (the printer re-emits from the AST).
4. Print both with `ts.createPrinter()` and compare. Any difference fails the check and prints a unified diff of the normalised text.
5. Separately, list every call expression found **inside** a log call's arguments, in both versions, so the reviewer can confirm each is pure (§3.2).

What it proves: every token outside logging calls (control flow, DB calls, Stripe calls, returns, status codes, response bodies, the claim logic) is identical. What it does not prove: that log arguments are side-effect free (step 5 covers it by listing), and runtime behaviour of imported modules (unchanged files).

### 6.2 Behavioural harness: Connect path before and after

`connectPath.characterisation.test.ts` imports the real `POST` with:
- `@/lib/stripe/StripeService` mocked so `constructWebhookEvent` returns the fixture event and every other Stripe call is recorded and answered from the fixture;
- `@supabase/supabase-js` `createClient` mocked to a **recording PostgREST builder** (the Proxy pattern already used in `app/api/stripe/__tests__/stripeAuditEntries.test.ts`), answering each table from per-scenario rows and recording `table`, operation, filters and payload;
- the side services the Connect path calls mocked and recorded: `crmActivityRepository`, `notifyOwnerOfDispute`, `syncBookingsForTransactions`, `paymentPlanSubscriptionRepository`, `resolveAccountOwner`, `bindPlanSubscription`;
- `@/lib/logger` mocked (the route does not import it before conversion; the mock is harmless then).

Each scenario snapshots `{ status, body, dbOps[], stripeCalls[], sideEffects[] }`:

| # | Scenario | Path exercised |
|---|---|---|
| 1 | Connect `invoice.paid`, platform invoice found by `stripe_invoice_id`, owned | `handleConnectInvoicePaid` happy path |
| 2 | Connect `invoice.paid` naming an invoice owned by another business | cross-tenant refusal (`:1645`) |
| 3 | Connect `invoice.paid` for a payment-plan period (Basil `parent.subscription_details`) | `recordPlanPeriodPaid` |
| 4 | Connect `checkout.session.completed` for an invoice, and one for a booking | `handleConnectCheckoutCompleted` both branches |
| 5 | Connect `payment_intent.succeeded`, owner owns the account; and one where it does not | `handleConnectPaymentIntentSucceeded` + refusal |
| 6 | Connect `invoice.payment_failed`, `invoice.finalized`, `invoice.marked_uncollectible` | the three small Connect handlers |
| 7 | `charge.refunded` on a Connect charge; `charge.dispute.created` | `handleChargeRefunded`, `handleDispute` |
| 8 | Connect `customer.subscription.deleted` | `handlePlanSubscriptionEnded` |
| 9 | Duplicate delivery (claim row `completed`) and in-flight (`processing`) | claim short-circuit |
| 10 | A handler throws | release to `failed`, 500 |
| 11 | Platform `invoice.paid` with no `user_id` anywhere | platform path returns early (sanity only; platform behaviour is P-1's subject) |

The snapshot is written once on the unconverted file (A3) and must match exactly after conversion (C3). It becomes the standing Connect regression asset that P-1, P-3b, P-6b, P-8b and P-10 reuse for SR-10 / AC-SR.3.

### 6.3 Source guard

`pinoLogging.guard.test.ts` (source-level, like `emptyBody.guard.test.ts`, because importing the route for a text property would test its imports):
- zero matches of `/\bconsole\./`;
- `createLogger` imported from `@/lib/logger`; the module logger declared once;
- `POST` contains `child({ correlationId` and binds `stripeEventId`;
- no log call's arguments contain `JSON.stringify`, `.metadata` used as a value (only `Object.keys(…metadata…)` is allowed), `email`, `customer_details`, `billing_details`, `payment_method_details`, or `card`;
- every `catch` that logs uses `{ err`.

### 6.4 What is reported to SA and QA

The AST check summary, the harness results before and after, the A4/A5 baselines against the final runs, and the conversion table. QA re-runs all four independently.

---

## 7. Acceptance (both requirements)

| Requirement | Condition | Met by |
|---|---|---|
| Plan payments §9.1 P-0 | Mechanical, no behaviour change, Connect before/after evidence | §6.1, §6.2 |
| Plan payments SR-10 / AC-SR.3 | Connect behaves identically before and after; Connect tests unchanged | §6.2 harness, snapshot recorded before |
| Plan payments SR-16 | Pino with a correlation id | §3.1, §6.3 |
| Plan payments C-1 | P-0 merges before P-1 | Gate on P-1 (P-1 workplan §8) |
| Boost T-17 | All 173 calls, mechanical, separate PR, before the boost hook; `StripeService.ts` not touched | §2, §4 |
| Boost §18.4 | Stripe event id as the webhook's correlation | `stripeEventId` bound on the child logger |
| Boost HP-4 | Connect unaffected, with evidence | §6.2 |
| Boost NFR-5 | No `console.*` in touched code | §6.3 |
| CLAUDE.md § Logging | Flag → propose → convert, approved by the user | Approval recorded in the requirement (§9.1) and boost §18.8 |

---

## 8. Risks

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| A non-logging line changes by accident in a 2,748-line live-money file | Medium (large mechanical edit) | High (client payments) | AST check fails on any non-logging difference; harness snapshot |
| A log argument had a side effect that disappears | Low | Medium | Step 5 listing in the AST check; rule "pure arguments only" |
| Missing `log` at a call site compiles anyway (e.g. through an `any`) and throws at runtime | Low | High | `log` is a required parameter, so a missing argument is a type error; harness exercises every Connect handler |
| A sensitive value reaches logs because `@/lib/logger` has no redaction | Low (nothing sensitive is logged today) | Medium | Explicit no-payload rule + guard; §12 Q-1 asks SA about the redaction gap |
| Rebase conflict with another branch editing the file (boost 4a, P-1) | Low now (nothing in flight) | Medium | Land P-0 first (C-1, boost §18.8); announce to the boost session that P-0 is taken |
| Harness mocks drift from reality, so "identical" proves less | Medium | Low | The harness compares the route against itself; its value is the before/after equality, not realism. The AST check carries the proof |
| Vercel log search for the old emoji strings stops matching | Certain | Low | Messages keep their words; anyone with a saved search updates it. Noted in the PR description |

---

## 9. Demo

1. `grep -c "console\." app/api/stripe/webhook/route.ts` → `0`.
2. `npx tsx scripts/check-logging-only-diff.ts --base origin/main --file app/api/stripe/webhook/route.ts` → "non-logging AST identical", with the list of calls inside log arguments.
3. `npx jest app/api/stripe/webhook` → guard, empty-body guard and the Connect harness green; the snapshot file shows it was written before the conversion (timestamped run output in §13).
4. Local run with Stripe test keys: `stripe trigger payment_intent.succeeded` forwarded by `stripe listen` to `localhost:3000/api/stripe/webhook`, showing JSON log lines carrying `correlationId`, `stripeEventId` and `eventType`. (Test mode only; no live event is sent.)

---

## 10. Sizing

**1.5 to 2 days**, small risk once the evidence is in place.

| Part | Estimate |
|---|---|
| AST check script + its test | 0.25 d |
| Characterisation harness + 11 scenarios + fixtures | 0.5 to 0.75 d |
| Conversion (173 calls, 17 signatures) | 0.5 d |
| Evidence runs, conversion table, workplan update | 0.25 d |

Boost §18.5 estimated 1 to 1.5 days without the harness. The harness is added because no Connect test exists and every later webhook slice needs one; it could be split into its own PR if SA prefers (§12 Q-3).

---

## 11. Rollback

Revert the PR. No migration, no data, no configuration. Behaviour is unchanged by construction, so a revert restores only the old log format. The harness and the AST script can stay even if the conversion is reverted.

---

## 12. Questions for SA

| # | Question | Dev's proposal |
|---|---|---|
| Q-1 | `@/lib/logger` resolves to `lib/logger.ts`, which has **no `redact` list**; the list in `lib/logger/config.ts` is not reached by the alias. Every Pino caller in the repo is unredacted. Is that known? | Out of P-0's scope (a change to every logger in the app). P-0 does not rely on redaction: it logs ids only. Recommend a separate small fix (`lib/logger.ts` reuses `loggerConfig`) through its own review |
| Q-2 | Thread the request logger as a `log` parameter (17 signatures) or introduce AsyncLocalStorage for the webhook? | Parameter: no new pattern, and the AST script normalises it away. AsyncLocalStorage exists in `lib/ai/usageScope.ts` but for a different purpose |
| Q-3 | Ship the characterisation harness in P-0, or as its own PR merged first? | In P-0: the snapshot must be recorded on the unconverted file, and keeping both in one PR makes that ordering reviewable. Split only if SA wants a smaller diff |
| Q-4 | May the three payload dumps go to `debug` with keys only, as the only level deviations? | Yes; anything else keeps its level |
| Q-5 | Commit `scripts/check-logging-only-diff.ts` as a shared tool (proposed) or keep it as a one-off in the scratchpad? | Commit: CLAUDE.md requires converting every touched `console.*` file, so it will be reused |

---

## 13. Evidence log

All runs in the `neuronforge-invite-s0` worktree, Node 22.19.0, on 2026-10-02 (UTC times below).

### 13.1 Baseline (A1)

| Check | Result |
|---|---|
| Branch | `feature/bos-plan-payments-p0`, moved onto `origin/main` = `9a7c4fb39fd16f4471d4a185b4549aa79d117cc6` (contains PR #175 `25cf76b0`); both workplan files survived the move (untracked) |
| `route.ts` vs `origin/main` | identical (`git diff origin/main -- app/api/stripe/webhook/route.ts` empty) before any edit |
| `console.*` in `route.ts` | 173: 106 `log`, 60 `error`, 7 `warn` |
| AST script on the unconverted file vs itself | "non-logging AST identical", 173/173 log calls, base-side refusal (P0-C3) not triggered: `route.ts` uses no `log`/`logger` identifier today |

### 13.2 Characterisation harness, before and after (A3, C3, P0-C2)

`app/api/stripe/webhook/__tests__/connectPath.characterisation.test.ts`, 19 scenarios, 19 snapshots:

| # | Scenario | Status |
|---|---|---|
| 1a | Connect `invoice.paid`, found by `stripe_invoice_id`, owned, booking linked | 200 |
| 1b | Connect `invoice.paid`, found through the metadata fallback, booking guessed by amount | 200 |
| 2 | Connect `invoice.paid` naming another business's invoice (refused) | 200 |
| 3 | Connect `invoice.paid` for a plan period (Basil `parent.subscription_details`): bind + `recordPlanPeriodPaid` | 200 |
| 4a / 4b | Connect `checkout.session.completed`, invoice branch / booking branch | 200 |
| 5a / 5b | Connect `payment_intent.succeeded`, owned / refused | 200 |
| 6a / 6b / 6c | Connect `invoice.payment_failed` (+ CRM activity) / `invoice.finalized` / `invoice.marked_uncollectible` | 200 |
| 7a / 7b | `charge.refunded` (two refunds, one pending) / `charge.dispute.created` (+ owner alert) | 200 |
| 8 | Connect `customer.subscription.deleted` ends the plan | 200 |
| 9a / 9b / 9c | Duplicate `completed` / in-flight `processing` / previously `failed` reclaimed | 200 |
| 10 | Handler throws: claim released to `failed`, 500 | 500 |
| 11 | Platform `invoice.paid` with no `user_id` (sanity) | 200 |

| Run | When (UTC) | Route | Result | Snapshot SHA-256 |
|---|---|---|---|---|
| A3 (write) | 2026-10-02T20:42Z | unconverted (`== origin/main`) | 19 passed, 19 written | `1075b773f6300bf517255c0dcb048fbc704ffb3765362099bd3308fbf1ede20c` |
| A3 (re-run, `--ci`) | 2026-10-02T20:42Z | unconverted | 19 passed | `1075b773…ede20c` |
| C3 (`--ci`) | 2026-10-02T20:54Z | converted | 19 passed | `1075b773f6300bf517255c0dcb048fbc704ffb3765362099bd3308fbf1ede20c` |

**Identical.** A copy of the A3 snapshot was kept outside the repo and `cmp` reports the C3 file byte-identical to it.

Mutation check (then reverted, `cmp` confirmed the restore): changing `status: 'overdue'` to `'overdue_mutant'` in the converted route fails the harness (1 snapshot, scenario 6a) **and** the AST check ("non-logging AST DIFFERS", with the line). Both proofs bite.

### 13.3 Existing tests and type check (A4, A5, C4)

| Check | Before (unconverted) | After (converted) |
|---|---|---|
| `emptyBody.guard.test.ts`, `userSubscriptionsWriteLockdown.qa.test.ts`, `stripeAuditEntries.test.ts`, `lib/payments/__tests__/` | 29 suites, 438 tests, all pass | 29 suites, 438 tests, all pass |
| Scoped `tsc` (scratch tsconfig extending the repo's, `files` = `route.ts` + the new script/tests; whole-repo `tsc` is not run here) | 1 error, **not in `route.ts`**: `lib/payments/bindPlanSubscription.ts(344,17): TS18004 No value exists in scope for the shorthand property 'serviceId'` | the same single error; **0 errors in `route.ts`** and in the new files |

The `bindPlanSubscription.ts:344` error is pre-existing on `main` and out of P-0's scope. It is a real defect, not a typing nit: the `logger.error({ planId, serviceId, ownerId }, …)` in the `!planRowId` branch references an undeclared `serviceId`, so that branch throws `ReferenceError` at runtime instead of logging and returning. Raised to TL as a separate fix.

### 13.4 AST check (C2)

```text
$ npx tsx scripts/check-logging-only-diff.ts --base origin/main --file app/api/stripe/webhook/route.ts
File: app/api/stripe/webhook/route.ts
Base: origin/main   Head: working tree
Logging calls: base 173, head 173
RESULT: non-logging AST identical            (exit 0)

Calls inside logging (base): 11 call(s), 1 marked REVIEW
  ok     handleInvoicePaid:107  invoice.lines.data.map(l => ({ desc: l.description, amount: l.amount }))
  ok     handleInvoicePaid:122  amountPaidUsd.toFixed(2)
  ok     handleInvoicePaid:173  credits.toLocaleString()  (x2 with currentBalance.toLocaleString(); :179 again)
  ok     handleCheckoutCompleted:801  balanceAfterBonus.toLocaleString()
  ok     handleSubscriptionUpdated:847  pilotCredits.toLocaleString(), stripeAmountUsd.toFixed(2)
  ok     recordPlanPeriodPaid:1292  String(invoice.total)
  REVIEW handleConnectInvoicePaid:1494  JSON.stringify(invoice.metadata || {})     <- the Connect dump, removed
  ok     POST:2446  signature.split(',')

Calls inside logging (head): 14 call(s), 6 marked REVIEW
  REVIEW <module>:31  createLogger({ module: 'stripe-webhook', route: '/api/stripe/webhook' })
  ok     handleInvoicePaid:102  Object.keys(invoice.metadata ?? {})
  ok     handleInvoicePaid:129  invoice.lines.data.map(l => ({ desc: l.description, amount: l.amount }))
  ok     handleInvoicePaid:147  amountPaidUsd.toFixed(2)
  ok     handleCheckoutCompleted:504  Object.keys(session.metadata ?? {})
  ok     handleSubscriptionUpdated:903  stripeAmountUsd.toFixed(2)
  ok     recordPlanPeriodPaid:1357  String(invoice.total)
  ok     handleConnectInvoicePaid:1570  Object.keys(invoice.metadata || {})
  REVIEW POST:2531  logger.child({ correlationId: request.headers.get('x-correlation-id') || crypto.randomUUID(), })
  REVIEW POST:2532  request.headers.get('x-correlation-id')
  REVIEW POST:2532  crypto.randomUUID()
  ok     POST:2561  signature.split(',')
  REVIEW POST:2611  log.child({ stripeEventId: event.id, eventType: event.type, livemode: event.livemode })
  REVIEW POST:2703  log.child({ connectAccountId })
```

Every head `REVIEW` is logger setup (creating the module logger and its children, reading a header, generating a UUID). None writes anything the route reads back. Every other call in a log argument is a pure read or format.

### 13.5 Conversion table (B6)

A mechanical pass over both ASTs pairs the 173 base calls with the 173 head calls in order: `info→info` 103, `error→error` 60, `warn→warn` 7, `info→debug` **3**. Anything not listed below is a straight `log→info / warn→warn / error→error`.

| Old line | New line | Function | Change | Reason |
|---|---|---|---|---|
| `:84` | `:98` | `handleInvoicePaid` | `info` → `debug`; `{ invoiceId, customer, metadata }` → `{ stripeInvoiceId, customerId, metadataKeys }` | SA Q-4. Metadata values not logged; a possibly-expanded `customer` object reduced to its id |
| `:469` | `:503` | `handleCheckoutCompleted` | `info` → `debug`; `session.metadata` → `{ sessionId, metadataKeys }` | SA Q-4 |
| `:1494` | `:1569` | `handleConnectInvoicePaid` | `info` → `debug`; `JSON.stringify(invoice.metadata)` → `{ stripeInvoiceId, metadataKeys }` | SA Q-4. Connect metadata is written by the connected business and may hold client details |
| `:67` | `:79` | `handleInvoicePaid` | `invoice.customer` → `customerId` (the id, also when Stripe expanded the object) | An expanded Customer would carry the email; no level change |
| `:83`, `:337`, `:580`, `:725`, `:812` | | platform handlers | `stripeError.message` / `quotaError.message` → `{ err }` | Errors as `{ err }` (rule 3) |
| `:1554`, `:1950` | | Connect plan binding | `(msg, subscriptionId, bindError)` / `{ error: scheduleError }` → `{ err, subscriptionId[, connectAccountId] }` | Errors as `{ err }` |
| `:2372` | | `handlePlanSubscriptionEnded` | Message "Payment plan completed/cancelled" → "Payment plan ended" + `outcome: 'completed' \| 'cancelled'` | Static message; the variable part moved into context |
| `:2716` | | `POST` catch | "Error:" → "Webhook processing failed" with `{ err }` | A searchable message for the one line that matters most |

Across all lines: emoji and `[Webhook]` tags removed (the `module: 'stripe-webhook'` field replaces the tag); interpolated values moved into the context object; ids added as context where the old line had none (pure property reads only). The words "Empty request body" and "Signature verification failed" are kept in their branches (`emptyBody.guard.test.ts` passes).

### 13.6 Hygiene (C5, C6)

| Check | Result |
|---|---|
| `grep -c "console\." route.ts` | `0` |
| `npx eslint` on `route.ts` | 14 problems (1 error, 13 warnings) before and after, the same findings at shifted lines. The one error (`no-require-imports`, `require('stripe')` in `handleInvoicePaid`) is pre-existing; changing it is a non-logging edit and out of scope |
| `npx eslint` on the new script and tests | clean |
| `npm run test:bos-entitlements` | 105 suites, 2,352 tests, all pass. P-0 imports nothing from the entitlements module |
| New tests | `pinoLogging.guard.test.ts` 11 pass; `check-logging-only-diff.test.ts` 18 pass; harness 19 pass |
| Guard shown to fail | Run against the unconverted route: 6 of 11 fail (console present, no logger, no child, handlers without `log`, pinned `'Signature verification failed'` literal). Run against a planted `metadata: invoice.metadata` value: the metadata test fails, while a planted `discarded` key does **not** trip the `card` rule (P0-C5) |

### 13.7 Deviations from the workplan

| # | Planned | Done | Why |
|---|---|---|---|
| D-1 | `const correlationId = …` then `logger.child({ correlationId })` (§3.1) | The id is computed inside the child call: `logger.child({ correlationId: request.headers.get('x-correlation-id') \|\| crypto.randomUUID() })` | A separate `const` is a non-logging statement and the AST check would (rightly) flag it. Inlined, it is part of the logger setup the check removes, and the setup's calls are still listed for review (§13.4). `\|\|` matches the other routes |
| D-2 | 11 scenario rows | 19 snapshots: 1b (metadata fallback + booking guess by amount) and 9c (failed event reclaimed) added; 4, 5, 6, 7, 9 split per branch | More of the Connect path pinned at no extra cost |
| D-3 | Harness mocks `createClient`, `StripeService`, side services | Same, plus `resolveInvoicePaymentIntent`, `resolveProcessorFee`, `bindPlanSubscription` mocked at the module boundary and recorded (the Stripe client is a recorded marker). The route is re-imported per scenario (`jest.isolateModules`) | The route keeps a module-level account-owner cache, so without a fresh module one scenario decides whether the next looks the owner up |
| D-4 | Guard by text matching | Guard walks the TypeScript AST; forbidden names also include `customer_email`, `phone`, `address` | Comments and message words cannot trip it; names match whole (P0-C5) |
| D-5 | Script CLI `--base`, `--file`, `--functions` | Also `--head <ref>` (compare two refs instead of the working tree) | Lets P-1 and QA run the check on a pushed branch without checking it out |

### 13.8 SA conditions

| Condition | Met by |
|---|---|
| P0-C1 logging excluded from the snapshot | Logger mock is a no-op that records nothing; `console` is silenced, not captured. Stated in the harness header. Proven: the snapshot did not change across 173 rewritten log lines |
| P0-C2 SHA-256 before/after, C3 with `--ci` | §13.2: `1075b773…ede20c` at A3 and C3 |
| P0-C3 refuse a base already using `log`/`logger` | `findReservedIdentifierUses` + exit 2; four tests (value use, `register(logger)`, a partly-Pino base accepted, property names ignored) |
| P0-C4 `--functions` mode + guidelines note | `compareFunctions`, four tests (identical, one function differs, missing on either side, edits outside named functions ignored). `docs/SYSTEM_LOGGING_GUIDELINES.md` § Migration Guide "Converting a `console.*` file: prove only logging changed" + Change History row |
| P0-C5 whole-name matching | AST identifiers; `discarded` demonstrated not to trip `card` (§13.6) |
| P0-C6 name the known violations in the PR description | §13.9 below, for RM to paste |

### 13.9 For the PR description (P0-C6)

This PR changes logging only. These are still in the file, unchanged, on purpose:

1. **Direct service-role Supabase client** (`createClient` at the top of `route.ts`) queried outside `lib/repositories/` (CLAUDE.md rule 1). Tracked follow-up (reuse plan WS-3); P-1 must not add new direct queries (P1-C6).
2. **Error details in the 500 body**: `{ error: error.message }` is returned in production, and two thrown messages embed PostgREST `error.message`. A response change is a behaviour change, so it is fixed in P-1 (P1-C5).
3. **Logger redaction gap**: `@/lib/logger` resolves to `lib/logger.ts`, which has no `redact` list (already noted as OI-9 in `SYSTEM_LOGGING_GUIDELINES.md`). Separate High-priority task per SA Q-1. P-0 does not rely on redaction: it logs ids and metadata keys only.

Also worth saying in the PR: the three metadata lines move to `debug` and disappear from production logs (which run at `info`); saved Vercel log searches for the old emoji strings need updating.

---

## QA Testing Report

*(QA to populate.)*

---

## Commit Info

*(RM to populate.)*

---

## SA Review

*(SA to populate.)*

**Reviewed by SA — 2026-10-02 (workplan review)**
**Status:** ✅ APPROVED WITH CONDITIONS (P0-C1 to P0-C6 below). Dev may implement once TL confirms the conditions are read; no re-review of the plan is needed.

### Architectural fit

Sound. A mechanical rule-3 conversion with two independent proofs (AST equality outside logging, behavioural snapshot recorded on the unconverted file) is the right weight for a 2,748-line file carrying live Connect money. Scope is correctly fenced: no behaviour change, so the two pre-existing violations in §1 stay out (see "CLAUDE.md violations" below). C-1 (requirement) is honoured: P-1 cannot start until this merges. Sizing (1.5 to 2 days) is realistic; the harness is the uncertain part (the route builds `supabaseAdmin` at module load and imports many services, so mock hoisting will take iteration), and the upper bound covers it. No split needed.

### Rulings on §12

| # | Ruling |
|---|---|
| Q-1 | **Verified, and it is platform-wide.** `@/lib/logger` resolves to `lib/logger.ts` in Next, `tsc` and Jest alike (`moduleNameMapper` `^@/(.*)$` → `<rootDir>/$1`; a file beats a directory index). `lib/logger.ts` has no `redact`, no `LOG_LEVEL`, no ISO timestamp. `lib/logger/config.ts` is reached only by `lib/logger/index.ts`, which no `@/lib/logger` import reaches. Both redaction tests (`lib/logger/__tests__/redaction.*.test.ts`) build their own `pino({ redact: loggerConfig.redact })`, so they prove the **config** and never the logger the app uses. The "backstop" that invite slices 1b (`signupCode`, `otp`) and 3b (`idToken`, `credential`, `nonce`) relied on has never been active. **Out of P-0's scope; its own task, priority High (small fix, do it within days, not after the plan-payments slices).** Shape for that task: `lib/logger.ts` builds its base logger from `loggerConfig` (keeping `browser.asObject` and the `clientLogger` export), plus one test that imports `createLogger` from `@/lib/logger` and asserts a redacted field, so the gap cannot reopen. It changes log output app-wide (`LOG_LEVEL`, timestamp, `env` base field), so it gets its own SA code review. P-0 does not depend on it: it logs ids only. |
| Q-2 | **Parameter.** AsyncLocalStorage would be a new pattern in a money route (rule 7) for no functional gain. Position is free: the AST normaliser drops the parameter by name, so put it last unless a signature has optional parameters (none found today). |
| Q-3 | **In P-0.** The ordering proof (snapshot recorded before conversion) is reviewable only if both are in one PR; see P0-C2 for how the ordering is evidenced. |
| Q-4 | **Approved:** the three dumps go to `debug` with `metadataKeys` only, as the only level deviations, each listed in the §13 conversion table. Note for the PR description: production runs at `info`, so these lines disappear from production logs; that is acceptable (the ids stay at `info`). |
| Q-5 | **Commit it** as `scripts/check-logging-only-diff.ts` with its Jest test. Rule 3 makes every touched `console.*` file a conversion, so it will be reused; P-1 F4 already depends on it. Conditions P0-C3, P0-C4. |

### CLAUDE.md violations found in the file (flagged, not in P-0)

1. **Rule 1 / direct Supabase:** the route builds its own service-role client (`createClient`, `:28`) and queries tables directly. Correctly left alone in a no-behaviour-change slice. It is the reuse plan's WS-3 territory; record it as a tracked follow-up (TL), and P-1 onward must not add new direct queries to it (P-1 condition P1-C6).
2. **Security rule / error details:** the 500 body returns `error.message` in production (`:2744`), and two thrown messages embed PostgREST `error.message` (`:1100`, `:1238`). The only caller is Stripe, so exposure is the Stripe dashboard, but it is still the rule. A response-body change is a behaviour change, so it is **not** in P-0; it is fixed in P-1 (P-1 condition P1-C5), because P-1 adds new throw paths that would flow into that body.

### Conditions

1. **P0-C1** Harness snapshots must exclude all logging. The logger mock must not be captured, and no `console` spy may feed the snapshot; otherwise the conversion changes the snapshot by construction and the before/after proves nothing. State this in the harness header comment.
2. **P0-C2** Record the snapshot file's SHA-256 in §13 at A3 (unconverted route) and again at C3; they must be identical. Run C3 with `--ci`. This is the reviewable proof of ordering inside one PR.
3. **P0-C3** The AST script must refuse (exit non-zero with a message) if the **base** file already uses the identifiers `log` or `logger` outside logging calls, since the normaliser would otherwise mask real edits to them. `route.ts` has none today; the guard is for reuse.
4. **P0-C4** Build the `--functions <names>` mode in P-0 (P-1 F4 relies on it) and cover it in the script's test; add a short "Converting a `console.*` file" note pointing to the script in `docs/SYSTEM_LOGGING_GUIDELINES.md` (Change History row).
5. **P0-C5** Guard test word matching: match `card`, `email` as whole identifiers/property names (e.g. `/\bcard\b/`), not substrings, so `discard`-style names do not create false failures that tempt someone to weaken the guard.
6. **P0-C6** In the PR description, name the two pre-existing violations above and the logger-redaction task, so the reviewer of a "no behaviour change" PR is not surprised they are still there.

### Approval
[x] Workplan approved with conditions P0-C1 to P0-C6 — proceed to implementation. SA code review follows.

### Code Review — 2026-10-03

**Code Review by SA — 2026-10-03**
**Status:** ✅ Code Approved (no must-fix items)

**Re-run by SA (not taken from §13):** AST checker vs `origin/main` exit 0, "non-logging AST identical", 173/173 calls, REVIEW list matches §13.4 (logger setup only). Snapshot SHA-256 `1075b773…ede20c`, unchanged. `connectPath.characterisation`, `pinoLogging.guard`, `check-logging-only-diff`, `emptyBody.guard` with `--ci`: 4 suites, 55 tests, 19 snapshots pass.

| Condition | Verdict |
|---|---|
| P0-C1 | Met. Harness header states the exclusion; logger mock records nothing |
| P0-C2 | Met. SHA identical, independently recomputed |
| P0-C3 / P0-C4 | Met. Refusal and `--functions` covered by tests; guideline note is accurate (behaviour, exit codes, redaction caveat) |
| P0-C5 | Met. AST identifiers, whole-name set |
| P0-C6 | Met. §13.9 ready for RM |

**Log arguments:** every call read. Ids, counts, amounts and `Object.keys(metadata)` only; no email, name, address, metadata values, card data or whole Stripe objects. Expanded `invoice.customer` reduced to its id. Errors are `{ err }` throughout. POST builds a `correlationId` child, then binds `stripeEventId`/`eventType`/`livemode` and `connectAccountId`. Fixtures are synthetic (`sk_test_harness`, `whsec_*`, `acct_owner`).

**Deviations D-1..D-5:** all acceptable. D-1 is the correct reading of the AST check. The two wording changes are message strings only (`outcome` moved to context).

**Rule 7:** `scripts/` + `tsx` + `typescript` are existing dependencies and conventions; `execFileSync` with an argv array (no shell). Not a new pattern.

**Optimisation (non-blocking):** the guard does not forbid a whole Stripe object as a log value (e.g. `{ invoice }`) or `customer`; consider adding in P-1.

**Code Approved for QA: Yes**

---

## Change History

| Date | Change | Details |
|---|---|---|
| 2026-10-02 | Created (Dev) | P-0 workplan = Credits Boost slice 0: Pino conversion of the Stripe webhook with AST and Connect-harness evidence |
| 2026-10-02 | Implemented (Dev) | Code complete and uncommitted: 173 calls converted, AST check identical, harness snapshot SHA-256 identical before/after, SA P0-C1 to P0-C6 addressed; evidence in §13 |
