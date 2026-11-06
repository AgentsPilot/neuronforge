# Workplan: DL-1b (D6) — Request and keep routes

> **Last Updated**: 2026-11-04

**Developer:** Dev
**Requirement:** [BUSINESS_OS_ACCOUNT_DELETION_LIFECYCLE_REQUIREMENT.md](/docs/requirements/BUSINESS_OS_ACCOUNT_DELETION_LIFECYCLE_REQUIREMENT.md) §3.3, §3.4, §4, §6.2 "SX-1 as built", §6.3 DL-1b row, §7 "DL-1b", §9.1 (BQ-21, BQ-33, BQ-34, BQ-38 answered 2026-11-04), §10 XC-1, XC-2, XC-5, XC-6, XC-13 (lifecycle half), XC-15, XC-19, XC-21; carried rulings C-3, C-4, SA-2, SA-3, SA-6, SA-8, SA-9
**Builds on:** [BUSINESS_OS_DELETION_DL1A_WORKPLAN.md](/docs/workplans/BUSINESS_OS_DELETION_DL1A_WORKPLAN.md) (DL-1a, merged) and [BUSINESS_OS_D2_PLAN_CANCEL_ENGINE_WORKPLAN.md](/docs/workplans/BUSINESS_OS_D2_PLAN_CANCEL_ENGINE_WORKPLAN.md) (SX-1, merged; SA W-5, W-7, Q-1, Q-10 hand D6 the engine's `origin` and SX C-3)
**Coordination:** `C:/Users/Barak/My Projects/AgentsPilot/SELF_SERVICE_EXIT_COORDINATION.md` (outside the repo, not in git) (a D6 row is needed before code, §14)
**Branch:** `feature/bos-deletion-dl1b-request-keep` (worktree `neuronforge-d6`, from `origin/main` `0eb3949e`)
**Date:** 2026-11-04
**Status:** Code Complete (2026-11-04; uncommitted, awaiting SA code review and the user's diff review)

## Overview

D6 turns today's immediate owner self-delete (DE-10b.2, `POST /api/business-os/account/delete`, which anonymises the account at once) into the **request** of the deletion lifecycle, and adds the **Keep my account** route for stages A to C. A request writes a closure row as `requesting`, sets a paid plan to stop renewing through the one "don't renew" engine (`managePlanSubscription`, with a new `origin` input), and only then marks the row `pending`. A free account goes straight to stage C (`grace`) with its lock date fixed. Keep marks the row `kept` first and only then asks Stripe to renew, and only when renewal was on before (BQ-33). While a request is open, buying a plan or a Boost is refused ("Keep your account first", BQ-34), from the closure repository, not from entitlements (XC-19). The Stripe webhook mirror records an operator's reactivation in Stripe as a Keep with source `stripe` (C-3, BQ-38). Nothing is deleted by any route any more, and a guard pins that. No email is sent, no UI changes, no migration, and the switch stays off.

---

## Table of Contents

1. [Analysis summary (as-is on origin/main)](#1-analysis-summary-as-is-on-originmain)
2. [Scope](#2-scope)
3. [Decisions and their reasons](#3-decisions-and-their-reasons)
4. [The request route](#4-the-request-route)
5. [The keep route](#5-the-keep-route)
6. [The engine: `origin` (W-5)](#6-the-engine-origin-w-5)
7. [The mirror: a Stripe-side reactivation is a Keep (C-3)](#7-the-mirror-a-stripe-side-reactivation-is-a-keep-c-3)
8. [Checkout and Boost refused while pending](#8-checkout-and-boost-refused-while-pending)
9. [Blockers at A (XC-5)](#9-blockers-at-a-xc-5)
10. [Audit (XC-13)](#10-audit-xc-13)
11. [Emails: what D6 records for DL-3](#11-emails-what-d6-records-for-dl-3)
12. [Guards and registries](#12-guards-and-registries)
13. [Files to create / modify](#13-files-to-create--modify)
14. [Coordination block (for TL to paste)](#14-coordination-block-for-tl-to-paste)
15. [Test plan (one-to-one with §7 DL-1b)](#15-test-plan-one-to-one-with-7-dl-1b)
16. [Task list](#16-task-list)
17. [Risks](#17-risks)
18. [Open questions for SA](#18-open-questions-for-sa)
19. [SA Review Notes](#sa-review-notes)
20. [QA Testing Report](#qa-testing-report)
21. [Commit Info](#commit-info)
22. [Change History](#change-history)

---

## 1. Analysis summary (as-is on origin/main)

Read on `0eb3949e`. Line numbers are from that commit.

| Area | Finding | Evidence |
|---|---|---|
| Owner self-delete route | Switch (404) → session (`readSessionSubject`, no cache) → Zod `.strict()` `{ statement, language }` → throttle `RATE_LIMITS.write` → statement against the server list → "available" gate (login email, cleanup secret, fingerprint key) → export facts → **immediate anonymise** → expire auth cookies → "Your account was deleted" email | `app/api/business-os/account/delete/route.ts` l.150, 156, 177, 193, 197, 208, 220 (`findDeletionFacts`), 230 (`runSelfAccountAnonymise`), 232 (`buildOwnerReceipt`), 248 (`expireAuthCookies`), 249 (`sendConfirmation`) |
| Pre-check route | Same gates; runs `runAccountDeletionCheck` and maps every blocker except G-12 with `toBlockerViews`; G-6 ("plan running") **blocks today** | `app/api/business-os/account/deletion-check/route.ts` l.89, l.112; `lib/business-os/account-deletion/selfServiceDeletion.ts` l.70–100 (l.87 drops G-12 only) |
| Self-service runners | `runAccountDeletionCheck` (read-only check) and `runSelfAccountAnonymise` (the delete) live in one file; family 5 of `no-deletion-paths` requires both customer routes to import that file and not the cleanup repository | `selfServiceDeletion.ts` l.70, l.106; `no-deletion-paths.guard.test.ts` l.300–330, l.678–687 |
| Closure storage (DL-1a) | Table, partial unique "one open row" over `requesting/pending/grace/locked`; repository has `findOpenForUser`, `insertRequesting` (23505 → `already_open`), `transition` (compare-and-set, per-transition column allow-list), `deleteRequesting`; **no production caller** | `supabase/migrations/20261093_business_os_account_closures.sql` l.125; `lib/repositories/AccountClosureRepository.ts` l.107, l.146–154, l.223, l.288, l.324, l.361 |
| Allowed transitions | `requesting → pending | grace`, `pending → grace | kept`, `grace → locked | kept`, `locked → kept`. `requesting>pending` may write `requested_email_sent_at`, `next_check_at`; `requesting>grace` may also write `grace_starts_at`, `lock_at`, `lock_timezone`; `*>kept` writes `kept_at`, `kept_source` | `closureLifecycle.ts` l.50; repository l.146–154 |
| **Claim excludes `kept`** | The claim predicate and its index take only `requesting/pending/grace`. A `kept` row is never claimed, so DL-3 as specified cannot find a row whose "kept" email is unsent | migration 20261093 l.129, l.150. See Q-9 |
| Callers guard | Allow-list of who may name `AccountClosureRepository`: today the two repositories and their tests only | `lib/repositories/__tests__/accountClosureRepositories.callers.guard.test.ts` l.53–85 |
| "Don't renew" engine | `managePlanSubscription({ action, userId, accountId, reasonCode })`; no `origin`. Our row `failing` admits a cancel, and a fresh Stripe `past_due` / `unpaid` **ends the plan now** (P-7a.4). Step 7 answers `unchanged` with `state: cancelling` when already set to end. Per-attempt key (C-4) and the mirror write (SA-3) are inside | `lib/business-os/billing/planSubscriptionManage.ts` l.206, l.337, l.367, l.394–399, l.415, l.441, l.466 |
| One-path guard | Only the engine may call `setBusinessOsCancelAtPeriodEnd` / `cancelBusinessOsSubscriptionNow` in `lib/business-os/**` and `app/api/business-os/**` | `lib/business-os/billing/__tests__/oneDontRenewPath.guard.test.ts` |
| Plain reactivate | `/plan/reactivate` calls the engine with no closure awareness: during a pending deletion it would make the plan renew with an open request (breaks the XC-2 invariant) | `app/api/business-os/billing/plan/reactivate/route.ts` l.86 |
| Mirror | Reads Stripe fresh; the stored flag is already the derived `isSetToEndThisPeriod` (flag OR `cancel_at` at or before the period end). So the P-7a C-3 follow-up that SA Q-10 required "before or inside D6" **has landed**; D6 reuses the computed value | `lib/business-os/billing/planSubscriptionMirror.ts` l.130–143; `subscriptionCancelling.ts` l.61 |
| Mirror wiring | Ports are built in `planBillingHandler.ts` (`afterPlanMove` precedent, a DELETE-owned port) | `planBillingHandler.ts` l.66–67, l.158–160, l.188 |
| Plan checkout | Every DB read precedes any Stripe call; the billing row is read at step 8, the our-data decision at 8a | `lib/business-os/billing/planCheckout.ts` l.311, l.372, l.378; route wiring `app/api/business-os/billing/plan/checkout/route.ts` l.104–108 |
| Plan upgrade | Already refuses a plan set to end (`subscription_cancelling`), which every pending request has | `lib/business-os/billing/planUpgrade.ts` l.106, l.294–295, l.474 |
| Boost checkout | Step 1 payment hold, step 2 package, then Stripe; ports via `boostCheckoutDeps()` | `lib/business-os/boost/boostCheckout.ts` l.140–160; `boostCheckoutDeps.ts`; route l.104–105 |
| Plain-cancel reminder | Already skips accounts with an open closure, in SQL (DR-2): no double email | `lib/business-os/billing/planCancelReminderPass.ts` header l.20 |
| Lock date helper | `businessDayFor(now, zone, dayOffset).startUtc` is "start of local day N", DST-safe; `resolveBusinessTimezone` maps NULL / unusable to `UTC`; `UserPreferencesRepository.findTimezone` reads `user_preferences.timezone` | `lib/business-os/businessDay.ts` l.70, l.99; `lib/repositories/UserPreferencesRepository.ts` l.123 |
| Audit anchors | DELETE's block starts after `ACCOUNT_DELETION_REFUSED`; `logAndFlush` with `userId` unset writes `SYSTEM_ADMIN_USER_ID` and `system_action: true` | `lib/audit/events.ts` l.201, l.1400; `lib/audit/eventAudience.ts` l.127; `lib/services/AuditTrailService.ts` l.210–230 |
| Reason codes | `PLAN_LEAVE_REASON_CODES` (BQ-7) fit the closure `reason_code` CHECK | `lib/business-os/billing/planLeaveReasons.ts` l.22 |
| Statement | Already the §3.3 sentence in en/he/es (D7) | `acknowledgement.ts` l.35, `matchStatement` l.80 |
| `console.*` | None in any file this slice touches (git grep) | — |
| Migrations | Highest on `origin/main` is `20261105`. **D6 needs none** and regenerates nothing | `git ls-tree origin/main supabase/migrations/` |

**Ownership note for TL.** The D6 brief says `receiptInput.ts` is owned by EXPORT. Requirement §11 B.1 and SA SR-1 give `receiptInput.ts` to DELETE and only `findDeletionFacts` to EXPORT. D6 edits neither: the request route simply stops importing `buildOwnerReceipt` and `findDeletionFacts`. EXPORT should still be told, because the SA Split Review lists `account/delete/route.ts` as a `findDeletionFacts` caller (§14).

**Phase (CLAUDE.md rule 8):** not V6 or pilot work. No plugin code.

---

## 2. Scope

**DL-1b row (§6.3, quoted):** "`account/delete` becomes the request route (XC-6 kept/removed list); two-phase write (XC-2); blockers at A (XC-5); keep route (A–C); checkout and Boost refusal while pending (closure repository); mirror clears the request on a dashboard reactivation (C-3); `no-deletion-paths.guard.test.ts` extended; audit rows that survive E; switch still off". Estimate 2.5 d.

| In | Out (later slice) |
|---|---|
| Request route (rework of `account/delete`), keep route, engine `origin`, mirror C-3, plan checkout + Boost refusal, plain reactivate refused while pending, XC-5 filter (request and pre-check), new audit events, guards | Drawer, banner, plan card wording, Settings "Keep" button (DL-2) |
| Lock date fixed for a free account at request time (needed to write `grace`) | Hourly job, 15-minute `requesting` settle, C start for paid accounts (DL-3) |
| Recording the state each email needs (`*_email_sent_at` left NULL) | Sending any lifecycle email (DL-3) |
| — | Lock / unlock (DL-4), website offline (DL-4b), ready list, E route, switch on (DL-5) |

Where a §7 DL-1b criterion touches a later slice, §18 asks SA instead of pulling the work in (Q-8, Q-9, Q-11).

---

## 3. Decisions and their reasons

| # | Decision | Why | Needs |
|---|---|---|---|
| D-1 | **Orchestration in pure modules over ports**, routes thin: `closureRequest.ts` (+ `closureRequestDeps.ts`), `closureKeep.ts` (+ `closureKeepDeps.ts`) in `lib/business-os/account-deletion/` | The `planSubscriptionManage` / `boostCheckout` pattern: every write-order branch, including the invariant, is tested with fakes and no network (CLAUDE.md "no test may reach the network") | — |
| D-2 | **Paid or free is decided from our billing row with `planManageOffer`** (the predicate the plan card and the engine already share), before any write | One rule for "is there a renewing paid plan". Table in §4.3 | Q-3 (odd statuses) |
| D-3 | **`renewal_was_on` at insert comes from our row (XC-2), and is corrected at the `pending` transition from the engine's own answer**: `cancelled` ⇒ true, `unchanged / cancelling` ⇒ false | Our row can lag Stripe (P-7a C-2). The insert value must exist for DL-3's settle of an abandoned row, but once the engine has answered, its answer is the truth, and a lagging row would otherwise make Keep renew a plan the operator cancelled, or not renew one that was renewing. Needs `renewal_was_on` added to the repository's `requesting>pending` column list (repository only, no migration) | **Q-2** |
| D-4 | **Free account: `requesting → grace` in the same request**, with `grace_starts_at` = now and `lock_at` = start of local day 15 in `user_preferences.timezone` (UTC when NULL), `lock_timezone` stored | §7 "a free account's request starts C at once"; the table CHECK needs `lock_at` for `grace`. New pure helper `closureDates.ts` (`closureLockAt`) over `businessDayFor`, reused by DL-3 | — |
| D-5 | **The engine gets `origin: 'owner' | 'deletion_request' | 'deletion_keep'`** (absent = `owner`, D2 W-5), with three effects only (§6) | W-5 gives `origin` to D6. The deletion request must never take P-7a.4's immediate path (BQ-11 refuses it), and the plain reactivate must be refused while a request is open (XC-2 invariant) | **Q-4**, **Q-5** |
| D-6 | **Mirror C-3 is a port** (`closureStripeKeep`, DELETE-owned, the `afterPlanMove` precedent), called after a successful mirror when the derived flag says "renews" | Keeps the plan-payments file change to a few lines; the port owns the closure logic and its audit | — |
| D-7 | **Checkout and Boost refusal through one reader**, `deletionPendingReader.ts` (`readDeletionPending(userId)` → `none` / `open` / `unreadable`), passed as a port. Fails closed on `unreadable` | XC-19: the closure repository, not entitlements. One reader keeps the callers guard short | — |
| D-8 | **No email is sent by D6.** `requested_email_sent_at` and `kept_email_sent_at` stay NULL; that NULL is DL-3's outbox. `deletionEmail.ts` is left as it is (no caller after D6) for DL-3 to turn into the "Deletion requested" builder | DL-3 is the only "each email exactly once" path (claim + Resend key + `*_sent_at`). Sending inline here would be a second, unclaimed send path. Switch is off until DL-5, which comes after DL-3, so no owner meets the gap | **Q-8**, Q-9 |
| D-9 | **`runSelfAccountAnonymise` is deleted** from `selfServiceDeletion.ts` (and its tests and mocks), not just uncalled. `authCookies.ts` and `deletionEmail.ts` stay (harmless, no caller) | A dead export of a destructive runner invites reuse; the new guard (§12) bans the name under `app/api/business-os/**` anyway | Q-10 |
| D-10 | **Request body `{ statement, language, reasonCode }`**, `.strict()`, `reasonCode` required from `PLAN_LEAVE_REASON_CODES` | The table needs `reason_code` NOT NULL; §3.3 step 2 makes the reason required (BQ-32 suggestion; the drawer is DL-2) | Q-12 |
| D-11 | **Keep is not behind the switch**; the request is | XC-4: "Keep … run whatever the switch says"; §7 "with the switch off … Keep and the job still work for an existing open row" | — |
| D-12 | **Plan upgrade is not changed.** It already refuses a plan set to end; a test pins that a pending request's plan is refused there | Every pending request has its plan set to end, or no plan | Q-7 |

---

## 4. The request route

`POST /api/business-os/account/delete` (path kept: the drawer already posts there; DL-2 re-words the drawer). Session user only (`readSessionSubject`, never the `lib/auth` cache, DE-10b.2 V-1). Node runtime, `force-dynamic`, `maxDuration = 60` (the check plus one Stripe write).

### 4.1 Contract

| Status | Body (`success: false` unless noted) | When |
|---|---|---|
| 404 | `{ error: 'not_found' }` | Switch off, before the session is read (unchanged) |
| 401 | `{ error: 'Unauthorized' }` | No verified session |
| 413 / 400 | `body_too_large` / `invalid_body` | Size cap (unchanged), Zod `.strict()` `{ statement, language, reasonCode }` |
| 429 | shared 429, `no-store` | Throttle `RATE_LIMITS.write`, key `selfDeleteThrottleKey('account-delete', id)` (unchanged) |
| 400 | `statement_mismatch` | Not one of the three server statements (counted in the failure budget, audited B-1) |
| 503 | `not_available` | No login email, no cleanup secret, no fingerprint key, check `unavailable` (function out of date), prices switch off on a paid account, key mode unknown |
| 503 | `try_again` | Closure, billing row, timezone or check read failed; `transition` errored on the free path |
| 409 | `already_requested`, `data: { status }` | An open closure row exists (any of `requesting / pending / grace / locked`), at the read or as `already_open` from the insert |
| 409 | `blocked`, `blockers: BlockerView[]` | XC-5 filter (§9) or our row `failing` (BQ-11 → code `payment_failed`); no row written |
| 409 | `plan_change_pending` | Engine `upgrade_pending` / `change_pending`; free account with an unexpired open checkout (Q-3) |
| 409 | `plan_state_changed` | Our row and Stripe disagree in a way a retry fixes (§4.4 rows P-5, P-6) |
| 502 | `stripe_error`, `outcomeUnknown?: true` | Engine `stripe_error` |
| 500 | `request_failed` | Unexpected throw (development-only `details`) |
| 200 | `success: true, data: { status: 'pending', planEndsOn, renewalWasOn }` | Paid account, row now `pending` |
| 200 | `success: true, data: { status: 'grace', lockAt, lockTimezone }` | Free account, row now `grace` |

The response never carries the email, the statement, a guard's SQL text, a Stripe or database message. Logs carry ids, codes, statuses and counts.

### 4.2 Order (each step stops before the next)

| # | Step | Failure branch |
|---|---|---|
| R-0 | `isAccountSelfDeleteEnabled()` | off → 404 |
| R-1 | `readSessionSubject()` | null or throws → 401 |
| R-2 | Body size, JSON, Zod `.strict()` | 413 / 400 |
| R-3 | Throttle | 429 |
| R-4 | `matchStatement(statement)` → `statementLanguage` (the matched list's language, never the UI's) | null → failure count, `ACCOUNT_DELETION_REFUSED` (`reason: statement_mismatch`), 400 |
| R-5 | "Available" gate: login email, `isTestCleanupConfigured()`, `isFingerprintKeyAvailable()` (XC-5 keeps it) | refused audit, 503 `not_available` |
| R-6 | `readDeletionPending`-equivalent read: `findOpenForUser(subject)` | error → 503 `try_again`; a row → 409 `already_requested` (no audit: nothing was attempted) |
| R-7 | Key mode, then billing row `findByUser(subject, livemode)`, then classify (§4.3) | mode unknown → 503; read error → 503; `failing` → blocked `payment_failed` (refused audit); others per §4.3 |
| R-8 | `runAccountDeletionCheck({ email, subject })`, then `requestBlockers` (§9) | `unavailable` → 503 `not_available`; `failed` → 503 `try_again`; blocking rows → refused audit (guard codes only), 409 `blocked` |
| R-9 | Free path only: `findTimezone(subject)` → `resolveBusinessTimezone` → `closureLockAt(now, zone)` | read error → 503 `try_again` (fail closed: the lock date is promised to the owner) |
| R-10 | `insertRequesting({ userId: subject, statementLanguage, reasonCode, renewalWasOn, planEndsAt })` with `renewalWasOn` = paid and our row not set to end; `planEndsAt` = our row's `current_period_end` (paid) or NULL | `already_open` → 409 `already_requested`; error → 503 `try_again` |
| R-11f | **Free:** `transition(id, subject, 'requesting', 'grace', { grace_starts_at, lock_at, lock_timezone })` | error or not moved → best-effort `deleteRequesting`, 503 `try_again` (a row left behind is not open in the XC-2 sense and DL-3 settles it) |
| R-11p | **Paid:** `managePlanSubscription({ action: 'cancel', userId: subject, accountId: resolveAccountId(subject), origin: 'deletion_request', reasonCode })` | table §4.4 |
| R-12 | **Paid, engine confirmed set to end:** ~~`transition(id, subject, 'requesting', 'pending', { next_check_at: endsOn, renewal_was_on })` (D-3)~~ **Superseded by W-2 and W-3:** `transition(id, subject, 'requesting', 'pending', { renewal_was_on, plan_ends_at })`, both from the engine's answer, and no `next_check_at` | §4.4 row P-8 |
| R-13 | Audit (§10): `BOS_BILLING_SUBSCRIPTION_CANCELLED` (only when the engine reached the write, `details.origin: 'deletion_request'`), then `ACCOUNT_DELETION_REQUESTED` (and `ACCOUNT_GRACE_STARTED` on the free path, Q-6), flushed bounded before the answer (WC-7) | never fails the request |
| R-14 | 200 | — |

Every database read and every refusal decided from our own data precedes the closure insert, and the insert precedes the only Stripe call (XC-2; the P-7b.1 V-9 order rule).

### 4.3 Classifying the account from our billing row (R-7)

| Our row (`planManageOffer` with the prices switch, plus two extra checks) | Path | `renewalWasOn` |
|---|---|---|
| No row, or no `stripe_subscription_id`, and no unexpired open checkout | Free | false |
| No subscription id but an **unexpired open checkout** | Refuse 409 `plan_change_pending` (a checkout paid during grace would start a plan on a closing account) | — |
| `ended_at` set | Free (the plan has already ended) | false |
| `renewing` | Paid | true |
| `cancelling` (owner cancelled earlier, BQ-33) | Paid | false |
| `failing` (`past_due`, `unpaid`, or failed attempts on a live status) | Refuse `blocked` / `payment_failed` (BQ-11, XC-5) | — |
| `none / change_pending` | Refuse 409 `plan_change_pending` | — |
| `none / period_over` (set to end, period end past, webhook lagging) | Refuse 409 `plan_state_changed` (retry after the end is mirrored) | — |
| `none / not_active` without `ended_at` (`incomplete`, `paused`, unknown) | Refuse 409 `plan_state_changed` (Q-3) | — |
| Subscription id set, prices switch off | Refuse 503 `not_available` | — |
| `trialing` | As `renewing` / `cancelling` (proposal, **Q-1**) | as above |

### 4.4 Paid path: every engine outcome (R-11p, R-12)

| # | Engine result | Row action | Answer | Audit |
|---|---|---|---|---|
| P-1 | `cancelled` (period end) | R-12 with `renewal_was_on: true` | 200 `pending` | CANCELLED (`outcome: cancelled`, origin) + REQUESTED |
| P-2 | `unchanged / cancelling` | R-12 with `renewal_was_on: false` | 200 `pending` | REQUESTED only (no Stripe write) |
| P-3 | `cancelled` with `mode: 'immediate'` | Cannot happen with `origin: 'deletion_request'` (§6 E-1). If it ever does: leave the row `requesting`, alert | 500 `request_failed` | CANCELLED (`outcome: cancelled`) |
| P-4 | Refusal, definite (any code without `outcomeUnknown`) | `deleteRequesting`; a failed delete is logged `error` + `alert`, the row is not open in the XC-2 sense and DL-3 settles it from a fresh read | Mapped: `payment_failed_contact_us` → 409 `blocked` [`payment_failed`]; `billing_record_mismatch` → 409 `blocked` [`contact_support`]; `upgrade_pending` / `change_pending` → 409 `plan_change_pending`; `subscription_not_active` / `not_subscribed` → 409 `plan_state_changed`; `manage_unavailable` → 503 `not_available`; `billing_row_unreadable` → 503 `try_again`; `stripe_error` → 502 | `ACCOUNT_DELETION_REFUSED` (`reason: plan_<code>`) |
| P-5 | `unchanged / ended` (our row lagged an end) | `deleteRequesting` | 409 `plan_state_changed` (the engine healed our row, so a retry takes the free path) | REFUSED |
| P-6 | `unchanged / renewing` or any other shape | `deleteRequesting`, alert (a fault) | 500 `request_failed` | REFUSED |
| P-7 | Refusal with `outcomeUnknown: true` | **Leave `requesting`** (XC-2: DL-3 settles it from a fresh Stripe read after 15 minutes, with the stored `renewal_was_on`). Never `pending`, never deleted | 502 `stripe_error`, `outcomeUnknown: true` | CANCELLED (`outcome: unknown`, from the engine's facts) + REFUSED (`reason: plan_outcome_unknown`) |
| P-8 | P-1 / P-2, then R-12 errors or does not move | Leave `requesting` (Stripe is already set not to renew; DL-3 settles it to `pending`) | 503 `try_again` with `data: { status: 'requesting' }`, see **Q-11** | CANCELLED as P-1; REQUESTED is **not** written until the row is `pending` |
| P-9 | Engine throws | Leave `requesting` (the throw may follow the write) | 500 `request_failed` | REFUSED (`reason: unexpected_failed`) |

**Invariant (XC-2, §7):** a row becomes `pending` only in R-12, and R-12 runs only after the engine has said, from Stripe's own answer, that the plan is set to end (P-1, P-2). No other code path writes `pending`. That is what the invariant test (T-6) drives.

### 4.5 What the route no longer does (XC-6)

Removed: the export facts read (`findDeletionFacts`), `buildOwnerReceipt`, `runSelfAccountAnonymise`, the fingerprint computation, `expireAuthCookies`, `sendConfirmation`, the `/account-deleted` redirect. Kept: the switch, session, body cap, statement match, throttle and refusal audit shapes, the "available" gate, `runAccountDeletionCheck`.

---

## 5. The keep route

`POST /api/business-os/account/keep`, new, `new-api-route` shape with the DE-10b.2 deviations already ruled for this module (session from `readSessionSubject`, `no-store` answers). Body `{}` `.strict()`. **Not behind the switch** (D-11). Throttle `RATE_LIMITS.write`, key `selfDeleteThrottleKey('account-keep', id)` (the union in `sessionSubject.ts` grows by one member).

### 5.1 Contract

| Status | Body | When |
|---|---|---|
| 401 / 400 / 429 | as the request route | session, `.strict()` body, throttle |
| 409 | `nothing_to_keep` | no open row |
| 409 | `request_in_progress` | the open row is `requesting` (a live request, or one DL-3 has yet to settle) |
| 409 | `locked` | the open row is `locked`: only support can unlock (§4 row D, DL-4) |
| 409 | `state_changed`, `data: { status }` | the compare-and-set did not move (a second tab, the mirror, or DL-3 moved it first); `status` re-read |
| 503 | `try_again` | a read or the transition errored |
| 200 | `success: true, data: { kept: true, from, renewal }` | `renewal` is `restored`, `not_needed` (from `grace`: the plan has ended), `not_restored_by_choice` (BQ-33, `renewal_was_on` false), `failed` (with `code` and `planEndsOn`), or `unknown` (Stripe answer lost) |

`renewal: 'failed'` answers 200 because the account **is** kept; the plan card (DL-2) then shows the honest "Ends on {date} [Keep my plan]" and the error (XC-2). See Q-13 if SA prefers a non-200.

### 5.2 Order

| # | Step | Failure branch |
|---|---|---|
| K-1 | Session, body, throttle | 401 / 400 / 429 |
| K-2 | `findOpenForUser(subject)` | error → 503; none → 409 `nothing_to_keep`; `requesting` → 409; `locked` → 409 |
| K-3 | **Row first (XC-2):** `transition(id, subject, from, 'kept', { kept_at: now, kept_source: 'owner' })`, `from` = `pending` or `grace` | error → 503; not moved → re-read, 409 `state_changed` |
| K-4 | `ACCOUNT_DELETION_KEPT` (`details.source: owner`, `from`), flushed bounded | never fails the request |
| K-5 | Only when `from = pending` **and** `renewal_was_on`: `managePlanSubscription({ action: 'reactivate', …, origin: 'deletion_keep' })` | `reactivated` / `unchanged renewing` → `restored`; refusal → `failed` + code; `outcomeUnknown` → `unknown`. `BOS_BILLING_SUBSCRIPTION_REACTIVATED` with `details.origin` when the write was reached |
| K-6 | 200 | — |

Because K-3 precedes K-5, the mirror that runs on the resulting `customer.subscription.updated` finds the row already `kept` and does nothing (§7). No "kept" email is sent here (D-8, Q-9).

---

## 6. The engine: `origin` (W-5)

**File:** `lib/business-os/billing/planSubscriptionManage.ts` (PLAN PAYMENTS owns it; coordination row in §14). Additive: `PlanManageInput.origin?: 'owner' | 'deletion_request' | 'deletion_keep'` (absent = `owner`); `PlanManageAuditFacts.origin`; one new refusal `deletion_pending` (409, "Keep your account first."); one optional port `deletionPending?: (userId) => Promise<'none' | 'open' | 'unreadable'>` (default `readDeletionPending`).

| # | Effect | Where | Why |
|---|---|---|---|
| E-1 | `origin: 'deletion_request'` never takes the immediate path: our row `failing` → refuse `payment_failed_contact_us` at step 5; a fresh Stripe `past_due` / `unpaid` → refuse `payment_failed_contact_us` at step 6 instead of `cancelNow` | after l.367 and at l.394–399 | BQ-11 for the deletion request: "update your card, or contact support", no request. A request must never end a plan now |
| E-2 | `origin: 'owner'` + `reactivate` reads `deletionPending(userId)` after the billing row read (step 4) and before any Stripe call: `open` → refuse `deletion_pending`; `unreadable` → refuse `billing_row_unreadable` (fail closed) | after l.331 | Otherwise the plain "Keep my plan" makes a pending request's plan renew (XC-2 invariant; §3.4 "no separate Keep my plan") |
| E-3 | `origin` is copied into the audit facts; the deletion routes put it in `details.origin`. The plain routes are not edited (absent = owner, W-5) | `auditBase` l.440 | SA-4 / D2 Q-4: one act, one key |
| E-4 | `trialing`: no change (TQ-14 behaviour) unless SA rules otherwise in Q-1 | — | — |

The plain `/plan/cancel` needs nothing: during a pending request the plan is already set to end, so it answers `unchanged`. The two plan routes map the new refusal through `PLAN_MANAGE_REFUSALS` with no code change.

---

## 7. The mirror: a Stripe-side reactivation is a Keep (C-3)

**Files:** `lib/business-os/billing/planSubscriptionMirror.ts` and `planBillingHandler.ts` (PLAN PAYMENTS; §14), new port `lib/business-os/account-deletion/closureStripeKeep.ts` + `closureStripeKeepDeps.ts` (DELETE).

- `PlanSubscriptionMirrorDeps.closureStripeKeep: ClosureStripeKeepPort` (required, as `afterPlanMove`), wired in `planBillingHandler.ts` next to l.188.
- Called after `mirrored.data.mirrored` is true, on `.updated` and `.deleted`, when the fresh read says the plan **renews**: `status` in `active / trialing`, `endedAt` null, and the derived `cancelAtPeriodEnd` (`isSetToEndThisPeriod`, already computed at l.132) is **false**. Because the derived flag also reads `cancel_at`, a dashboard reactivation that clears only `cancel_at`, or moves it past the period end, counts (SA Q-10).
- The port, with the account id from our billing row (never Stripe metadata) through `resolveAccountId`: `findOpenForUser`; only a `pending` row is kept: `transition(id, accountId, 'pending', 'kept', { kept_at, kept_source: 'stripe' })`; when it moved, `ACCOUNT_DELETION_KEPT` with `details.source: 'stripe'`, system actor. A `requesting` row is ignored (it belongs to a live request; the engine's own write is about to set it to end), `grace` / `locked` are ignored (no subscription renews there), none is a no-op.
- ~~A read or write error **throws**, so the webhook claim is released and Stripe retries (the `afterPlanMove` contract, mirror header step 6).~~ **Superseded by IN-1:** the port still throws on a read or write error, but the production wiring (`closureStripeKeepNeverFailing` in `planBillingHandler.ts`) catches it, logs `error` + alert and lets the mirror complete, so Stripe does not retry; DL-3 re-checks `pending` rows (SA IN-1 ruling, obligation (a) to (d)). Every step is idempotent: a replay finds the row `kept` and does nothing.
- **How DL-3 learns to send the "kept" email (BQ-38):** the row is `kept` with `kept_source = 'stripe'`, `kept_at` set and `kept_email_sent_at` NULL. That NULL is the outbox. See Q-9: the DL-1a claim never returns a `kept` row, so DL-3 needs its own way to find it.

Account id versus user id: the closure is keyed by the login (`user_id`); the billing row by `account_id`. Today `resolveAccountId` is the identity, as every billing reader assumes; the port documents the assumption and the accountSeam guard covers the seam.

---

## 8. Checkout and Boost refused while pending

`readDeletionPending(userId)` (new `lib/business-os/account-deletion/deletionPendingReader.ts`): `findOpenForUser` → `none` / `open` / `unreadable`. "Open" is any of `requesting / pending / grace / locked` (A to C, plus D, where nobody can sign in anyway). It is not an entitlements gate and imports nothing from that module (XC-19).

| Path | Change | Refusal |
|---|---|---|
| Plan checkout `planCheckout.ts` | New port `deletionPending` in `PlanCheckoutDeps`; read right after step 8 (still before any Stripe call, C-4 order rule); `open` → `deletion_pending`; `unreadable` → `deletion_state_unreadable`. Applies to held and non-held accounts | `deletion_pending` 409 "Keep your account first."; `deletion_state_unreadable` 503 |
| Plan checkout route | Wires `deletionPending: readDeletionPending` beside `readPlanSnapshot` (l.104–108) | — |
| Boost `boostCheckout.ts` | New port `deletionPending` in `BoostCheckoutDeps`; new step 1b after the payment hold, before the package and any Stripe call; `open` → `deletion_pending` (409); `unreadable` → `deletion_check_failed` (500, as `payment_hold_check_failed`) | added to `BOOST_CHECKOUT_REFUSAL_STATUS` |
| `boostCheckoutDeps.ts` | Adds `deletionPending: readDeletionPending`. Its entitlements imports and symbols are unchanged | — |
| Plan upgrade | No change (D-12): it refuses `subscription_cancelling` already | test pin only |

Copy: the server messages are English, as every refusal in these files. The en/he/es keys for "Keep your account first" are DL-2's (S-7 untouched here).

---

## 9. Blockers at A (XC-5)

New pure `lib/business-os/account-deletion/closureBlockers.ts`: `requestBlockers(rows: GuardRowLike[]): { blocking: GuardRowLike[]; engineering: string[] }`, applied to the check's rows. The same function serves the lock re-check later (DL-4).

| Guard | At A | Shown as |
|---|---|---|
| G-8 (Stripe Connect) | **Blocks** (BQ-21) | `stripe_connected` |
| G-9 (client plans running, payments or refunds pending) | **Blocks** (BQ-21) | `client_plans_running` / `client_payments_pending` with counts |
| G-4 (an admin login) | **Blocks** | `admin_account` ("contact support") |
| Failed last payment from our billing row (BQ-11) | **Blocks** (decided at R-7, before the check) | new code `payment_failed` |
| `unknown` (the check resolved another login, or a row the parser missed) | **Blocks**, fail closed | `contact_support` |
| G-1, G-2, G-2a, G-3 (identity of the login) | **Blocks**, fail closed (proposal, Q-14) | `contact_support` |
| G-6 (plan running), G-12 (files) | Ignored | — |
| G-10, G-11, G-13 to G-22, G-5, G-7 (if they ever block) | Do **not** block; listed in `engineering` for the log and, later, the ready list | — |

- `BLOCKER_CODES` (`blockerCopy.ts` l.20) gains `payment_failed`, appended (client-safe, additive; the drawer's copy for it is DL-2).
- The pre-check route (`deletion-check`) applies the same filter and the same billing-row check, so the drawer never shows G-6 as a blocker (XC-6: "the deletion-check route (with the XC-5 filter)"). Its wire shape is unchanged apart from the new enum member. Q-15 if SA wants that left to DL-2.
- Refusals are audited with guard codes only (`details.guards`), never item text.

---

## 10. Audit (XC-13)

New constants and metadata in `lib/audit/events.ts`, inserted at DELETE's anchor (directly after `ACCOUNT_DELETION_REFUSED`, l.201 and l.1400), audience `'bos'` in `eventAudience.ts` after l.127. Never rename or move another entry (S-9).

| Event | Written by | `user_id` | `actor_id` | `entity_type` / `entity_id` | `details` | Severity |
|---|---|---|---|---|---|---|
| `ACCOUNT_DELETION_REQUESTED` (new) | request route, after `pending` or `grace` | **unset** → system user, `system_action: true` (survives E) | the subject (owner act) | `user` / subject | `closure_id`, `status`, `renewal_was_on`, `plan_ends_on`, `lock_at` (free), `reason_code`, `statement_language`, `correlation_id` | `warning`, GDPR + SOC2 |
| `ACCOUNT_DELETION_KEPT` (new) | keep route; mirror port | unset → system user | subject (owner) / unset (stripe) | `user` / subject | `closure_id`, `source` (`owner` / `stripe`; `admin` in DL-4), `from`, `renewal` (owner), `stripe_event_id` (stripe) | `info`, GDPR + SOC2 |
| `ACCOUNT_GRACE_STARTED` (new, proposal Q-6) | request route, free path only | unset → system user | subject | `user` / subject | `closure_id`, `grace_starts_at`, `lock_at`, `lock_timezone` | `info`, GDPR |
| `ACCOUNT_DELETION_REFUSED` (existing) | request route refusals | **subject** (B-1: the account stays) | subject | `user` / subject | `source: 'deletion_request'`, `reason`, `guards` | unchanged |
| `BOS_BILLING_SUBSCRIPTION_CANCELLED` / `_REACTIVATED` (existing) | request / keep routes when the engine reached the write | subject (money audit, goes with the account) | subject | `business_os_billing_account` / account | the plain routes' fields + `origin`, `closure_id` | unchanged |

Survival check: E deletes `audit_trail` by `user_id` only (XC-13), so the three new rows survive and hold only uuids, codes and dates. Keep refusals are logged, not audited (the plan routes' rule). No email address, statement text or reason text in any row.

---

## 11. Emails: what D6 records for DL-3

| Email | State D6 leaves | Who sends |
|---|---|---|
| "Deletion requested" (paid) | row `pending`, `requested_email_sent_at` NULL | DL-3 (claimable: `pending`) |
| "Deletion requested" (free) | row `grace`, `requested_email_sent_at` NULL | DL-3 (claimable: `grace`) |
| "Your account is kept" (owner) | row `kept`, `kept_source = owner`, `kept_email_sent_at` NULL | DL-3, but **not claimable** today (Q-9) |
| "Your account is kept" (Stripe, BQ-38) | row `kept`, `kept_source = stripe`, `kept_email_sent_at` NULL | same |

Proposal for SA (Q-8): D6 sends nothing, and `deletionEmail.ts` (today "Your account was deleted") is rewritten by DL-3 as the "Deletion requested" builder, with dates. The alternative, sending the requested email inline from the request route, would be a second send path outside DL-3's claim and Resend idempotency key, so a retried request or a later job could send it twice. While the switch is off, no owner can reach the gap.

---

## 12. Guards and registries

| # | Guard | Change |
|---|---|---|
| G-1 | `no-deletion-paths.guard.test.ts` (DELETE owns its rules, SR-3) | **New family 6 (XC-6):** no non-test file under `app/api/business-os/**` names `runAccountAnonymise` or `runSelfAccountAnonymise` (identifier scan after `stripComments`, string literals count), with a negative fixture per name and a positive "scan ran" floor. Family 5's `it.each` (l.678–687) keeps both customer routes importing `selfServiceDeletion` (they still use `runAccountDeletionCheck`). Adds: "nothing is deleted by this route": the request route imports none of `runAccountAnonymise`, `buildOwnerReceipt`, `findDeletionFacts`, `expireAuthCookies`. **No** older-version allow-list entry moves (no regeneration, S-1 untouched) |
| G-2 | `accountClosureRepositories.callers.guard.test.ts` | `AccountClosureRepository` rule gains exactly: `closureRequestDeps.ts`, `closureKeepDeps.ts`, `closureStripeKeepDeps.ts`, `deletionPendingReader.ts` and their tests. Routes, the engine, the mirror and the checkouts reach it only through those files |
| G-3 | `oneDontRenewPath.guard.test.ts` | No edit: D6 calls `managePlanSubscription` only. ~~A new assertion that `closureRequest.ts` and `closureKeep.ts` import `managePlanSubscription`.~~ **Superseded by W-7:** the "D6 calls the engine" pin is a source scan in the DELETE-owned `closureRequest.test.ts` (the request and Keep wiring files import it; no D6 file names a Stripe cancel method) |
| G-4 | `enforcementPoints.test.ts` `KNOWN_NON_GATE_IMPORTERS` (S-12, add only) | Two entries, `symbols: ['resolveAccountId']`: `app/api/business-os/account/delete/route.ts` and `app/api/business-os/account/keep/route.ts`, each "DL-1b: the account seam for the engine call; refuses nothing by plan". `planSubscriptionMirror.ts`, `planCheckout.ts`, `boostCheckoutDeps.ts` keep their symbol lists unchanged. No new file is an `ENFORCEMENT_POINTS` gate (XC-19). `npm run test:bos-entitlements` before hand-over |
| G-5 | Admin authz registry | Not touched (no admin route) |

---

## 13. Files to create / modify

| File | Action | Reason |
|---|---|---|
| `app/api/business-os/account/delete/route.ts` | rewrite | §4 (request route) |
| `app/api/business-os/account/keep/route.ts` | create | §5 |
| `app/api/business-os/account/deletion-check/route.ts` | modify (small) | §9 filter + billing-row check |
| `lib/business-os/account-deletion/closureRequest.ts`, `closureRequestDeps.ts` | create | §4 orchestration + production wiring |
| `lib/business-os/account-deletion/closureKeep.ts`, `closureKeepDeps.ts` | create | §5 |
| `lib/business-os/account-deletion/closureStripeKeep.ts`, `closureStripeKeepDeps.ts` | create | §7 port |
| `lib/business-os/account-deletion/deletionPendingReader.ts` | create | §8 |
| `lib/business-os/account-deletion/closureBlockers.ts` | create | §9 |
| `lib/business-os/account-deletion/closureDates.ts` | create | D-4 `closureLockAt` |
| `lib/business-os/account-deletion/schemas.ts` | modify | request body `{ statement, language, reasonCode }`; request / keep answer schemas; the `accountDeletedRedirect` helpers stay for `/account-deleted` (DL-2 re-words it) |
| `lib/business-os/account-deletion/blockerCopy.ts` | modify (append one code) | `payment_failed` |
| `lib/business-os/account-deletion/selfServiceDeletion.ts` | modify | remove `runSelfAccountAnonymise` (D-9) |
| `lib/business-os/account-deletion/sessionSubject.ts` | modify | throttle key union + `'account-keep'` |
| `lib/repositories/AccountClosureRepository.ts` | modify (two lines) | `renewal_was_on` in the patch schemas and in `requesting>pending` only (D-3, Q-2) |
| `lib/business-os/billing/planSubscriptionManage.ts` | modify | §6 (PLAN PAYMENTS file) |
| `lib/business-os/billing/planSubscriptionMirror.ts`, `planBillingHandler.ts` | modify | §7 (PLAN PAYMENTS files) |
| `lib/business-os/billing/planCheckout.ts`, `app/api/business-os/billing/plan/checkout/route.ts` | modify | §8 (PLAN PAYMENTS files) |
| `lib/business-os/boost/boostCheckout.ts`, `boostCheckoutDeps.ts` | modify | §8 (Boost files, PLAN PAYMENTS) |
| `lib/audit/events.ts`, `lib/audit/eventAudience.ts` | modify (DELETE anchor, add only) | §10 (co-owned with EXPORT) |
| `lib/utils/featureFlags.ts` | modify (doc comment of `isAccountSelfDeleteEnabled` only) | XC-15: it is now the request switch; Keep is not behind it |
| `docs/FEATURE_FLAGS.md` | modify (own row and its section, plus a version-history row) | same |
| `lib/business-os/purge/__tests__/no-deletion-paths.guard.test.ts` | modify | G-1 |
| `lib/repositories/__tests__/accountClosureRepositories.callers.guard.test.ts` | modify | G-2 |
| `lib/business-os/entitlements/__tests__/enforcementPoints.test.ts` | modify (add two entries) | G-4 |
| `app/api/business-os/account/delete/__tests__/route.test.ts`, `refusalAudit.qa.allPaths.test.ts`, `refusalAudit.realService.test.ts` | rewrite | the route changed meaning; refusal-audit coverage kept |
| `app/api/business-os/account/keep/__tests__/route.test.ts` | create | §15 |
| `app/api/business-os/account/deletion-check/__tests__/route.test.ts`, `route.qa.test.ts` | modify | filter; drop the `runSelfAccountAnonymise` mock |
| `lib/business-os/account-deletion/__tests__/closureRequest.test.ts`, `closureRequest.invariant.test.ts`, `closureKeep.test.ts`, `closureStripeKeep.test.ts`, `closureBlockers.test.ts`, `closureDates.test.ts`, `deletionPendingReader.test.ts` | create | §15 |
| `lib/business-os/account-deletion/__tests__/selfServiceDeletion.test.ts` | modify | drop the anonymise runner's cases |
| `lib/business-os/billing/__tests__/planSubscriptionManage.origin.d6.test.ts` | create | E-1, E-2, E-3 |
| `lib/business-os/billing/__tests__/planSubscriptionMirror.test.ts`, `planBillingHandler.test.ts`, `planCheckout.test.ts` | modify (add cases, wire the new port in fakes) | §7, §8 |
| `lib/business-os/boost/__tests__/boostCheckout.test.ts` | modify (add cases) | §8 |
| `lib/repositories/__tests__/AccountClosureRepository.test.ts` | modify (add cases) | `renewal_was_on` only on `requesting>pending` |
| `docs/requirements/BUSINESS_OS_ACCOUNT_DELETION_LIFECYCLE_REQUIREMENT.md` | modify (after build: a "DL-1b as built" note in §6.3 and a Change History row; §11 untouched) | "always update the main requirement" |

**Not touched:** any migration, the cleanup generator and its outputs (no S-1 lock), `receiptInput.ts`, `BusinessOsDataExportJobRepository.ts`, `deletionEmail.ts`, `authCookies.ts`, `DeleteAccountDrawer.tsx`, `DangerZonePanel.tsx`, translations, `vercel.json`, `rateLimit.ts`, the plain `/plan/cancel` and `/plan/reactivate` routes, `planUpgrade.ts`.

---

## 14. Coordination block (for TL to paste)

> **D6 / DL-1b — `feature/bos-deletion-dl1b-request-keep` (from `0eb3949e`).** No migration, no number reserved, no cleanup regeneration (does not take or wait for the S-1 lock). No emails (no S-10 claim).
>
> **PLAN PAYMENTS files (claim before code; additive hunks only):**
> - `lib/business-os/billing/planSubscriptionManage.ts`: `PlanManageInput.origin?` (`owner` | `deletion_request` | `deletion_keep`); `PlanManageAuditFacts.origin`; refusal `deletion_pending` in `PlanManageRefusalCode` and `PLAN_MANAGE_REFUSALS`; optional port `deletionPending` in `PlanManageDeps`; step 4/5: `owner` + reactivate refused while a closure is open; step 5 and step 6: `deletion_request` never takes `cancelNow` (BQ-11). Plain routes untouched.
> - `lib/business-os/billing/planSubscriptionMirror.ts`: required port `closureStripeKeep` in `PlanSubscriptionMirrorDeps`; one call after a successful mirror when the derived flag says the plan renews.
> - `lib/business-os/billing/planBillingHandler.ts`: wire `closureStripeKeep` next to `afterPlanMove`.
> - `lib/business-os/billing/planCheckout.ts`: port `deletionPending`; read after step 8; refusals `deletion_pending` (409) and `deletion_state_unreadable` (503).
> - `app/api/business-os/billing/plan/checkout/route.ts`: wire the port.
> - `lib/business-os/boost/boostCheckout.ts`, `boostCheckoutDeps.ts`: port `deletionPending`, step 1b, refusals `deletion_pending` (409) and `deletion_check_failed` (500).
> - Tests: `planSubscriptionManage.origin.d6.test.ts` (new), cases added to `planSubscriptionMirror.test.ts`, `planBillingHandler.test.ts`, `planCheckout.test.ts`, `boostCheckout.test.ts`.
>
> **EXPORT-shared files (S-9, add only, DELETE anchor):** `lib/audit/events.ts` (`ACCOUNT_DELETION_REQUESTED`, `ACCOUNT_DELETION_KEPT`, and if SA agrees `ACCOUNT_GRACE_STARTED`, directly after `ACCOUNT_DELETION_REFUSED` in `AUDIT_EVENTS` and in `EVENT_METADATA`); `lib/audit/eventAudience.ts` (the same names, `'bos'`, after `ACCOUNT_DELETION_REFUSED`).
>
> **Notice to EXPORT (S-3):** `app/api/business-os/account/delete/route.ts` stops calling `findDeletionFacts` and `buildOwnerReceipt` (it no longer deletes). The deletion-check route still calls `findDeletionFacts` unchanged. The frozen interface is untouched.
>
> **Shared add-only registries:** `KNOWN_NON_GATE_IMPORTERS` (S-12) two entries; `lib/utils/featureFlags.ts` + `docs/FEATURE_FLAGS.md` (S-8) own reader's comment and own row only.

---

## 15. Test plan (one-to-one with §7 DL-1b)

All pure Jest with fakes or `jest.mock` seams, small fixtures, no network, inside the existing job (no added CI time). Route tests cover happy path, auth failure and invalid input for **both** routes (§7 "All slices").

| §7 DL-1b criterion | Test(s) |
|---|---|
| With the switch off, the request route answers 404; Keep and the job still work for an existing open row | T-1 request route: switch off → 404 before the session is read (session mock not called). T-2 keep route: switch off + an open `pending` row → 200 kept. (The job is DL-3; nothing in D6 reads the switch outside the request route, asserted by a source scan of `closureKeep*.ts` and `closureStripeKeep*.ts`) |
| A paid account's request sets Stripe to not renew and moves the row to `pending`; a free account's request starts C at once | T-3 `closureRequest.test.ts`: renewing row → engine called with `origin: 'deletion_request'` and the reason code → `requesting` insert with `renewal_was_on: true` → `pending` with `next_check_at`. Cancelling row (BQ-33) → engine `unchanged` → `pending`, `renewal_was_on: false`. Free → `grace` with `lock_at` = start of local day 15 (`closureDates.test.ts`: Asia/Jerusalem, a DST week, NULL → UTC, an unusable zone → UTC) and no engine call |
| A Stripe failure deletes the `requesting` row; never a `pending` row on a renewing plan (invariant test) | T-4: each definite refusal code → `deleteRequesting` called, answer mapped (§4.4 P-4). T-5: `outcomeUnknown` → row left `requesting`, never deleted, never `pending`. **T-6 `closureRequest.invariant.test.ts`:** a table over every engine result (P-1 to P-9) × transition result (moved / not moved / error) × delete result, with a fake Stripe state; asserts that whenever the fake closure store ends with a `pending` row, the fake subscription is set to end. Plus: keep calls `transition(…'kept')` strictly before `managePlanSubscription` (call-order spy); the mirror keeps a `pending` row when the plan renews (T-12); the engine refuses `owner` reactivate while open (T-13) |
| Blockers at A refuse with where to fix them; G-6 and G-12 do not block; engineering guards do not block | T-7 `closureBlockers.test.ts`: every guard id the generated function emits (read from the generator, as `blockerCopy`'s test does) has a classification; G-6, G-12, G-10, G-11, G-13 to G-22 alone → no block; G-8, G-9 (both items), G-4, `unknown`, identity → block with the right code and counts. Route: a blocked check → 409 `blocked`, no closure insert, refusal audit with guard codes only; failed payment row → `payment_failed`. Pre-check route: G-6 alone → `blockers: []` |
| The typed sentence is checked on the server in all three languages; wrong text is refused | T-8 route: the en, he and es statements each → accepted, `statement_language` = the matched language even with another UI `language`; a wrong or near-miss text → 400 `statement_mismatch`, refusal audit, no closure read |
| Keep in A/B restores renewal only if `renewal_was_on` | T-9 `closureKeep.test.ts`: `pending` + true → reactivate with `origin: 'deletion_keep'` → `restored`; `pending` + false → no engine call → `not_restored_by_choice`; `grace` → no engine call → `not_needed`; reactivate refusal → `kept` stays, `renewal: 'failed'` with the code; `requesting` / `locked` / none → 409s; compare-and-set lost → `state_changed` |
| Buying a plan or a Boost is refused while pending | T-10 `planCheckout.test.ts`: `open` → `deletion_pending` and no Stripe call (Stripe fake asserts zero calls); `unreadable` → `deletion_state_unreadable`; `none` → unchanged flow. `boostCheckout.test.ts`: same three, refusal before `reserve`. Upgrade pin: a plan set to end → `subscription_cancelling` (existing case referenced) |
| An operator reactivation in Stripe cancels the request with source `stripe` | T-12 `planSubscriptionMirror.test.ts` + `closureStripeKeep.test.ts`: flag cleared → port called → `pending → kept`, `kept_source: 'stripe'`, `ACCOUNT_DELETION_KEPT` source stripe; `cancel_at` alone cleared → same; `cancel_at` moved after the period end → same; still set to end → port not called; `requesting` / `grace` / none → no write; a port error → the mirror throws (webhook retry); a replay → no second audit |
| No file under `app/api/business-os/**` imports `runAccountAnonymise` or `runSelfAccountAnonymise` (guard). Nothing is deleted by this route | T-14 `no-deletion-paths` family 6 with negative fixtures; the request route imports none of the four removed symbols; `selfServiceDeletion.ts` no longer exports `runSelfAccountAnonymise` |

Also:

| # | Test | Asserts |
|---|---|---|
| T-13 | `planSubscriptionManage.origin.d6.test.ts` | E-1 (our row `failing` and fresh `past_due` / `unpaid` refused for `deletion_request`, `cancelNow` never called); E-2 (`owner` reactivate with `open` → `deletion_pending`, with `unreadable` → `billing_row_unreadable`, no Stripe call either way; `deletion_keep` reactivate is not refused); E-3 (`origin` in the audit facts; absent → `owner`). Existing P-7a / D2 suites unchanged and green |
| T-15 | Route integration (both routes) | 401 without a session, 400 on an extra key (`userId`, `email`, `status`), 429 throttle, `no-store`, no email or statement in any log call (log spy), refusal audit rows have `user_id` = subject; success rows of the new events have no `userId` |
| T-16 | Callers and registry guards | G-2 allow-list; G-4 entries match exactly; `npm run test:bos-entitlements` green |
| T-17 | `AccountClosureRepository.test.ts` | `renewal_was_on` accepted on `requesting>pending` only, refused on any other transition before a DB call |
| T-18 | Hand-over runs | `npm test -- app/api/business-os/account lib/business-os/account-deletion lib/business-os/billing lib/business-os/boost lib/business-os/purge lib/repositories/__tests__ app/api/business-os/billing app/api/business-os/credits`, then `npm test`, `npm run lint`, `npm run test:bos-entitlements`, `npx tsc --noEmit` filtered to touched files with `NODE_OPTIONS=--max-old-space-size=8192` and the tool's exit code checked (an OOM prints no diagnostics). Full-gate failures compared with clean `main`, de-duplicated (memory: Jest prints FAIL twice) |

QA manual check (critical path, recorded in the QA report): on a dev server with the switch on locally, a `+test` free account requests (row `grace`, lock date right in Asia/Jerusalem), keeps (row `kept`); a Boost and a plan checkout are refused while pending. A paid sandbox account's request sets `cancel_at_period_end` in the Stripe test dashboard; a dashboard reactivation turns the row `kept` / `stripe`. No real account, and the switch stays off in every deployed environment.

---

## 16. Task list

- [x] ✅ 0. SA workplan review; TL adds the §14 row to the coordination file and confirms no other session holds the PLAN PAYMENTS files listed (TL: PLAN PAYMENTS acked, 2026-11-04).
- [x] ✅ 1. `closureDates.ts` + tests (D-4, W-11).
- [x] ✅ 2. `closureBlockers.ts` + tests; `blockerCopy.ts` `payment_failed` (§9, W-4).
- [x] ✅ 3. Repository: `renewal_was_on` and `plan_ends_at` on `requesting>pending` (D-3, W-3) + T-17.
- [x] ✅ 4. `deletionPendingReader.ts` + tests; callers guard entries (G-2).
- [x] ✅ 5. Engine `origin`, E-1 to E-3, W-1, `deletion_pending` + T-13; the D2 / P-7a suites re-run with one fake each, assertions unchanged (W-6).
- [x] ✅ 6. Audit constants, metadata and audience entries at DELETE's anchor (§10).
- [x] ✅ 7. `closureRequest.ts` + deps + T-3 to T-6.
- [x] ✅ 8. Request route rewrite; `schemas.ts`; remove `runSelfAccountAnonymise` (W-9); route tests T-1, T-8, T-15; pre-check route filter (Q-15).
- [x] ✅ 9. `closureKeep.ts` + deps + keep route + T-2, T-9, T-15; `sessionSubject.ts` key.
- [x] ✅ 10. `closureStripeKeep.ts` + deps; mirror + handler wiring; T-12.
- [x] ✅ 11. Plan checkout and Boost ports, wiring, T-10.
- [x] ✅ 12. Guards: `no-deletion-paths` family 6 (T-14), `KNOWN_NON_GATE_IMPORTERS` (G-4); the "D6 calls the engine" pin in `closureRequest.test.ts` (W-7, not in `oneDontRenewPath`).
- [x] ✅ 13. `featureFlags.ts` comment + `FEATURE_FLAGS.md` row (XC-15).
- [x] ✅ 14. Test runs; `console.*` re-check on every touched file; workplan updated with results (Implementation notes below).
- [x] ✅ 15. Requirement "DL-1b as built" note + Change History.
- [ ] ⬜ 16. Hand over to SA for code review; leave everything uncommitted (standing rule: the user sees the diff before any commit).

**Estimate:** 2.5 d (SA XC-17). The request orchestration and its invariant table are about 1 d; engine, mirror and the two checkouts about 0.75 d; keep about 0.4 d; guards, audit, docs about 0.35 d.

---

## 17. Risks

| # | Risk | Mitigation |
|---|---|---|
| K-1 | A `requesting` row left by P-7, P-8 or P-9 blocks a new request and Keep until DL-3's settle exists | The switch is off until DL-5, which comes after DL-3, so no real owner reaches it. The row is not "open" for the XC-2 invariant. Logged with `alert` |
| K-2 | An operator reactivation lands between the engine's answer and R-12, while the row is still `requesting`: the mirror ignores it and R-12 then writes `pending` on a renewing plan | Window of one DB round trip. Proposal for DL-3 (not built here): its pass over `pending` rows reads Stripe fresh and keeps with source `stripe` when the plan renews. Named in Q-11 |
| K-3 | Our billing row lags Stripe when `renewal_was_on` is read | D-3 corrects it from the engine's own answer at R-12 |
| K-4 | Merge conflicts with PLAN PAYMENTS on the engine, mirror and checkout files | §14 claim before code; additive hunks; rebase just before enqueue (SR-10) |
| K-5 | `events.ts` / `eventAudience.ts` conflict with EXPORT | DELETE anchor only, one contiguous block |
| K-6 | The drawer (`DeleteAccountDrawer.tsx`) still expects the old success shape (a redirect) | Switch off; DL-2 rewrites the drawer before switch-on. Named in the DL-1b as-built note |
| K-7 | A Boost or plan checkout session opened **before** the request is paid during grace | Plan: the request refuses while a checkout is open (§4.3). Boost: a paid Boost on a closing account is BQ-9 territory (lost at E, no refund); flagged, not changed here |
| K-8 | Owner keeps, then Stripe renew fails: the plan ends with no request | Intended (XC-2): honest "Ends on {date} [Keep my plan]"; the plain reactivate works again because no closure is open |
| K-9 | The `kept` email is never sent because the claim excludes `kept` (Q-9) | Raised now so DL-3 plans it; no data is lost (the outbox column is NULL) |
| K-10 | A typecheck read as clean after an OOM | T-18 checks the exit code (CLAUDE.md ship drill step 1) |

---

## 18. Open questions for SA

| # | Question | Dev proposal |
|---|---|---|
| Q-1 | **`trialing` for the deletion request.** SA-2 says eligibility is `active` only on a paid plan; D2 / TQ-14 made `trialing` manageable for the plain cancel | **Allow `trialing` like `active`.** Setting a trial not to renew means no first charge, which protects the owner (TQ-14's reason). Stage B then ends at the trial end. Refusing it would send a trialing owner to support for something the plain Cancel already lets them do. This amends SA-2 for the request only |
| Q-2 | **D-3:** correct `renewal_was_on` at the `pending` transition from the engine's answer (repository allow-list change, no migration) | Yes. The insert value (XC-2) stays for DL-3's settle; the engine's answer wins once known |
| Q-3 | Rows that are neither clearly free nor clearly paid (`incomplete`, `paused`, `period_over`, a free account with an unexpired open checkout) | Refuse with "try again" codes (§4.3); never guess. `ended_at` set → free |
| Q-4 | `origin` values: `owner` / `deletion_request` / `deletion_keep`, or two values with Keep using `deletion_request` | Three: the audit then tells a deletion Keep from a plain Keep my plan |
| Q-5 | **E-2:** refuse the plain `/plan/reactivate` while a closure is open, inside the engine (port), rather than in the route | In the engine: one place, and every future caller inherits the XC-2 invariant |
| Q-6 | Add `ACCOUNT_GRACE_STARTED` in D6 (the free path starts C here), or leave every XC-13 event except REQUESTED / KEPT to DL-3 | Add it in D6, written on the free path only; DL-3 reuses it for paid accounts |
| Q-7 | Plan upgrade: rely on `subscription_cancelling` (D-12) or add the closure check with "Keep your account first" | Rely on it; DL-2 can show the closure copy for that code while a request is open |
| Q-8 | **The existing "Deletion requested" email (`deletionEmail.ts`, XC-6) versus DL-3's "each email exactly once".** Send it inline from the request route, or leave it to DL-3 | **Leave it to DL-3.** D6 sends nothing and leaves `requested_email_sent_at` NULL; DL-3 rewrites `deletionEmail.ts` as the builder and sends it from the claim with the Resend key `closure:{id}:requested`. Inline sending would be a second, unclaimed path |
| Q-9 | **The DL-1a claim never returns a `kept` row** (migration 20261093 l.129, l.150), so DL-3 cannot find a `kept` row with `kept_email_sent_at` NULL | Not D6's to fix. Record now, for DL-3: either a second claim function over `status = 'kept' AND kept_email_sent_at IS NULL` (a DL-3 migration and a reservation), or inline sending for Keep. Dev leans to the second claim, so every lifecycle email has one send path |
| Q-10 | D-9: delete `runSelfAccountAnonymise` outright (with its tests and mocks), keep `authCookies.ts` and `deletionEmail.ts` unused | Yes |
| Q-11 | §4.4 P-8 (Stripe already set not to renew, `pending` transition failed): answer 503 `try_again` with `status: 'requesting'` and let DL-3 settle; and K-2's fresh re-check of `pending` rows belongs to DL-3 | Yes to both; the owner's retry sees `already_requested` |
| Q-12 | Request body requires `reasonCode` now, ahead of BQ-32 (reason picker in the drawer, before DL-2) | Required. The column is NOT NULL; if BQ-32 is answered "no", DL-2 sends a fixed code such as `other` |
| Q-13 | Keep with a failed Stripe renew answers 200 `{ kept: true, renewal: 'failed', code }` rather than an error status | 200: the account is kept, which is what the owner asked; the plan card shows the error |
| Q-14 | Identity guards (G-1, G-2, G-2a, G-3) at A: block (fail closed) rather than "engineering" | Block, `contact_support`: they mean the check may not be about this login |
| Q-15 | Apply the XC-5 filter to the pre-check route in D6 (so the drawer never shows G-6), not in DL-2 | D6: one filter, both routes, same PR |

---

## Implementation notes

Built 2026-11-04 on `feature/bos-deletion-dl1b-request-keep`, uncommitted. No migration, no regeneration, no email, switch off.

**Deviations from the text above (each with its reason):**

| # | What | Why |
|---|---|---|
| IN-1 | §7 said a closure-keep failure throws so Stripe retries. Built: the production wiring wraps the port (`closureStripeKeepNeverFailing` in `planBillingHandler.ts`), which logs `error` + alert and never fails the mirror | TL relay of PLAN PAYMENTS review point 1. Consequence: a failed keep stays `pending` on a renewing plan until DL-3's pass re-reads Stripe (risk K-2 widens from one round trip to "until DL-3") |
| IN-2 | The wrap sits in the production port list, not inside `createPlanBillingHandler` | `planBillingHandler.test.ts` pins that each use case receives the SAME deps object; wrapping inside would break that assertion |
| IN-3 | W-1's refusal code is `custom_end_date` (409), mapped by the request route to `blocked` / `contact_support` | A name was needed; TL point 4 also asked that the plain-reactivate refusal `deletion_pending` have its own code and message |
| IN-4 | `origin` is in the audit facts only for a deletion origin (absent = owner) | Existing engine suites compare audit facts with `toEqual`; this keeps them unchanged (W-6 c) and the plain routes' rows byte-identical |
| IN-5 | E-2's closure read is placed after every our-data refusal (step 5), not right after step 4 | Still before any Stripe call; fewer existing suites reach it |
| IN-6 | Plan checkout and Boost use ONE code and status for an unreadable closure: `deletion_state_unreadable` 503 | SA optimisation note |
| IN-7 | `ACCOUNT_DELETION_REQUESTED` severity `info`, not `warning` | SA optimisation note (audit-severity alerting) |
| IN-8 | K-4 (Keep audit) is written after K-5, in one flush with the money row | §10 puts `renewal` in the KEPT row's details, which is only known after K-5. The row is still moved first (XC-2) |
| IN-9 | The pre-check reads our billing row (`readDeletionBillingRow`) to show `payment_failed`; key mode unknown → `available: false`, unreadable → 500 `check_failed` | Q-15, "the same billing-row check" |
| IN-10 | Copy-map lines outside the §13 list: `planManageCopy.ts`, `planPurchaseCopy.ts`, `app/invite/awaitingPaymentCopy.ts` each map the new codes to an EXISTING key | They are `Record`s over the refusal unions with a runtime parity test; no new wording (D2 `change_pending` precedent). DL-2 gives `deletion_pending` its own line |
| IN-11 | Registries outside §13 that had to follow the code: `BusinessOsBillingAccountRepository.test.ts` allow-list (+`closureRequestDeps.ts`), `eventAudience.test.ts` counts (+3 BOS), plan cancel route suites and checkout route suites mock the closure reader (one `jest.mock` line each), `planReconcilePass.d31.test.ts` and `planRenewal.captured.test.ts` take the closure-keep stub | W-6: required ports and the real default reader would otherwise fail or reach the network |
| IN-12 | Six existing lines in PLAN PAYMENTS / shared files were extended in place (two union terminators, one `if (action === 'cancel')`, `auditBase`, the answer-check condition, the Boost union terminator). Everything else is additive | Unavoidable to add a union member or a condition |

**Not done here (as ruled):** the plain cancel's required `reasonCode` (§6.2 hand-over) stays with PLAN PAYMENTS. The drawer still posts the old body and has no `payment_failed` copy: DL-2.

**Verification (2026-11-04):**

| Run | Result |
|---|---|
| New + touched suites: `app/api/business-os/account`, `lib/business-os/account-deletion`, `AccountClosureRepository.test`, callers guard, `no-deletion-paths` | 914 / 914 |
| T-6 invariant matrix (real engine over a fake Stripe, 360 combinations + 2) | 362 / 362 |
| Billing / Boost / credits / plan routes / copy maps | 105 suites, 5,815 / 5,815 |
| Guards: `oneDontRenewPath`, `routerPlacement`, `planReconcilePass.guard`, `afterPlanMove.guard`, `businessOsEntitlements.imports.guard` | 111 / 111 |
| `npm run test:bos-entitlements` | 346 suites, 10,057 / 10,057 |
| Broad run (`lib/business-os`, `app/api/business-os`, `lib/audit`, `app/api/stripe`, `components/business-os`, `app/invite`, `app/admin/users`, `lib/repositories/__tests__`) | 926 / 929 suites; the 3 failures are newline-literal source scans of untouched files on CRLF working copies (`bookingNextStep`, two onboarding guards), the known local Windows pattern |
| `tsc --noEmit -p tsconfig.json` (8 GB heap) | completed, semantic pass ran; 1,922 errors repo-wide, **0 in the 76 touched files** |
| ESLint on touched files | 0 errors (1 warning, `events.ts` `getEventsByCompliance`, which was already there) |
| `console.*` in touched code files | none |

## SA Review Notes

**Reviewed by SA — 2026-11-04.** Status: 🔄 Approved with conditions W-1 to W-14. The full review, the rulings on Q-1 to Q-15 and the questions for the user are in [SA Workplan Review — 2026-11-04](#sa-workplan-review--2026-11-04) below.

- [x] Workplan approved — proceed to implementation once W-1 to W-14 are folded into the workplan text and TL has written the §14 coordination row (with the W-12 corrections)

## QA Testing Report

**QA — 2026-11-05**
**Test mode:** full
**Strategy used:** A (Jest unit, with fakes at every port) and B (route tests with `jest.mock` seams), plus throwaway edge-case tests kept outside the worktree (session scratchpad, not committed). No network; the request switch stays off.
**Focus:** api, security, schema
**Skipped:** D (manual browser check). This slice is backend-only and the switch is off in every environment, so there is no screen to click. The §15 "QA manual check" (dev server with the switch on locally, a `+test` free account and a paid sandbox account) moves to the slice that switches it on (DL-2 screens, DL-5 switch-on). The user is not asked to click anything.
**Input source:** TL trigger (full; the §7 DL-1b list as the checklist; CR fixes; named edge cases; named regression set)

Read against the uncommitted worktree `neuronforge-d6` on `feature/bos-deletion-dl1b-request-keep` (base `0eb3949e`), after the SA code review fixes of 2026-11-05.

### Test Coverage

| Acceptance Criterion (requirement §7 DL-1b) | Tested? | Result | Evidence |
|---|---|---|---|
| Switch off: the request route answers 404; Keep still works for an existing open row | ✅ | Pass | `delete/__tests__/route.test.ts` "T-1: the request switch" (5 values: unset, empty, `false`, `1`, `TRUE` → 404 before the session is read). `keep/__tests__/route.test.ts` "T-2" (switch unset and `false`, open `pending` row → 200 kept). Source scan in `closureKeep.test.ts`: `closureKeep.ts`, `closureKeepDeps.ts`, `closureStripeKeep.ts`, `closureStripeKeepDeps.ts` and the Keep route never name `isAccountSelfDeleteEnabled`. "The job" is DL-3 and does not exist yet. `isAccountSelfDeleteEnabled()` is true only for the exact string `true` |
| A paid request sets Stripe to not renew and moves the row to `pending`; a free request starts C at once | ✅ | Pass | `closureRequest.test.ts` T-3 (renewing → `requesting` with `renewal_was_on: true` → engine with `origin: 'deletion_request'` and the reason → `pending`; BQ-33 cancelling → `pending` with `false`; D-3 corrections both ways). Free: no row → `grace`, lock date in the stored zone, no engine call, no `next_check_at`. Route: "a paid account → 200 pending" (call order `session, closure:open, check, closure:insert, engine, closure:requesting>pending`, no delete) and "a free account → 200 grace" (lock `2026-11-17T22:00:00.000Z`, Asia/Jerusalem = start of local day 15) |
| A Stripe failure deletes the `requesting` row; never a `pending` row on a renewing plan (invariant) | ✅ | Pass | `closureRequest.test.ts` T-4 (each definite engine refusal → withdrawn, mapped) and T-5 (P-7 `outcomeUnknown`, P-3, P-8, P-9 → row stays `requesting`, never deleted, never `pending`). `closureRequest.invariant.test.ts` T-6: the REAL `managePlanSubscription` over a fake Stripe and a fake closure store, 360 combinations plus the non-vacuous pin and the W-1 later-`cancel_at` pin, all green |
| Blockers at A refuse with where to fix them; G-6 and G-12 do not block; engineering guards do not block | ✅ | Pass | `closureBlockers.test.ts`: reads the guard ids of the generated function (not vacuous); G-6, G-12, G-6 + G-12 and the engineering guards do not block; G-8 → `stripe_connected`, G-9 by item with counts, G-4 → `admin_account`; identity guards G-1, G-2, G-2a, G-3, an unclassified id, an unknown G-9 item and another login → `contact_support` (fail closed). Failed payment: `closureRequest.test.ts` "payment_failed is shown with its own blocker code" and route "a failed last payment → 409 blocked [payment_failed], no check run". Pre-check route: `deletion-check/__tests__/route.test.ts` "DL-1b: the request's blockers" (same filter, `payment_failed`) |
| The typed sentence is checked on the server in en / he / es; wrong text refused | ✅ | Pass | Route T-8: the en, he and es statements each accepted with a DIFFERENT UI language, `statement_language` = the matched one; case/spaces and Hebrew marks tolerated; a wrong text and a near miss → 400 `statement_mismatch`, refusal audit, counted in the failure budget (429 once spent) |
| Keep in A/B restores renewal only if `renewal_was_on` | ✅ | Pass | `closureKeep.test.ts` T-9: `pending` + true → row kept FIRST, then reactivate with `origin: 'deletion_keep'` → `restored`; `pending` + false → no engine call, `not_restored_by_choice`; `grace` → `not_needed`; refusal → kept, `renewal: 'failed'` + code + end date; lost answer / throw → kept, `unknown` |
| Buying a plan or a Boost is refused while pending | ✅ | Pass | `planCheckout.test.ts` "D6: …" (open → `deletion_pending` 409, unreadable and a throwing reader → `deletion_state_unreadable` 503; zero Stripe calls; after every DB read; `none` → flow unchanged). `boostCheckout.test.ts` "D6 / DL-1b: no Boost while …" (same three, before `reserve`; a held account still refused as `awaiting_payment` first). Production wiring passes `readDeletionPending` in both (`plan/checkout/route.ts`, `boostCheckoutDeps.ts`). The plain "Keep my plan" is refused too: `planSubscriptionManage.origin.d6.test.ts` E-2 |
| An operator reactivation in Stripe cancels the request with source `stripe` | ✅ | Pass | `closureStripeKeep.test.ts` T-12 (`pending` → `kept`, `kept_source: 'stripe'`, one KEPT audit; `requesting` / `grace` / `locked` / none → nothing). `planSubscriptionMirror.test.ts` (the real port over a fake store from the mirror; not called when the row no longer holds the subscription). The mirror decides "renews" from a FRESH Stripe read, so an out-of-order event cannot keep a request |
| No `app/api/business-os/**` file imports `runAccountAnonymise` / `runSelfAccountAnonymise`; nothing is deleted by this route | ✅ | Pass | `no-deletion-paths.guard.test.ts` family 6 (scan with floor and negative fixtures; the request route imports none of the removed symbols; `selfServiceDeletion.ts` no longer exports the runner). QA grep: no non-test file under `app/api/business-os` names either runner; `runSelfAccountAnonymise` is gone from the repo outside tests |
| User decision: `trialing` accepted like `active` | ✅ | Pass | `closureRequest.test.ts` "trialing is accepted like active (user decision Q-1)" |
| User decision: `reasonCode` required | ✅ | Pass | Route T-15: no `reasonCode`, an off-list code → 400 `invalid_body`, nothing read. QA scratch: `reasonCode: null` → refused |

**Review fixes checked:**

| Item | Result | Evidence |
|---|---|---|
| CR-1: REQUESTED, GRACE_STARTED and owner KEPT carry no request context; REFUSED and money rows still do | Pass | Code: the three entries have no `request` key; `AuditTrailService.buildLogEntry` stores `ip_address`, `user_agent`, `session_id` only from `input.request`, so they are NULL. Tests: delete route asserts REQUESTED (paid) and both free rows have no `request` while the CANCELLED row has one, and a REFUSED row has one; keep route asserts KEPT has none and REACTIVATED has one. Stripe-sourced KEPT (`closureStripeKeepDeps.ts`) passes no request, no user id, no actor |
| CR-4: mismatched origin / action refused before any read or Stripe call | Pass | `planSubscriptionManage.origin.d6.test.ts` "CR-4": `deletion_request` + reactivate and `deletion_keep` + cancel → `manage_unavailable`, error + alert, nothing read; `owner` still runs both |
| CR-5: `readDeletionPending` never throws, the shared repository included | Pass | `deletionPendingReader.test.ts` "SA CR-5: …" (a throwing constructor → `unreadable`) |
| Replay safety of the Stripe-side keep | Pass | `closureStripeKeep.test.ts` "replay-safe" and `planSubscriptionMirror.test.ts` "pending → kept once; a replay writes no second transition and no second audit" (compare-and-set on `pending`; audit only when the row moved) |
| A throwing Stripe-side keep never fails the webhook mirror | Pass | `planBillingHandler.test.ts` "D6 / DL-1b: the closure-keep port in the production wiring" (production ports carry the wrapped port; a throw → logged error + alert with ids and a snake_case code only, resolves; the real mirror with a throwing port completes; a free-text message is never logged) |

**Edge cases looked at directly** (throwaway Jest file in the session scratchpad, run against the worktree code; 16 of 17 pass, the one failure is Edge Case 1 below):

| Edge case | Result |
|---|---|
| Double submit, one after the other | Second → `already_requested` with status `grace`, not audited; one row |
| Double submit, concurrent (both pass R-6) | The unique insert refuses the second → `already_requested`; one row |
| Keep on a `requesting` row | 409 `request_in_progress`, row untouched, no engine call |
| Keep twice | First kept (`not_needed` from `grace`); second `nothing_to_keep`; no engine call |
| Two tabs Keep at once on `pending` + renewal on | Exactly one engine reactivate (compare-and-set) |
| New request after a Keep | Accepted (`kept` is not open) |
| Invalid body: missing / null `reasonCode`, unknown key, 501-character statement; Keep body with any key or `null` | All refused by `.strict()` schemas; route tests also cover `userId`, `email`, `origin`, `status`, `closureId` keys → 400, and unparsable JSON / oversized body → 400 / 413 |
| Unauthenticated | 401 on both routes before anything is read (route T-15; a throwing session read → 401) |
| Lock date: Jerusalem fall-back week, 23:30 / 00:10 local, NULL → UTC, unusable name → UTC | Pass (in `closureDates.test.ts`) |
| Lock date: Jerusalem spring-forward (27 Mar 2026), New York fall-back, UTC+14, half-hour zone, empty string | Pass (QA scratch) |
| Lock date in a zone whose DST starts AT midnight (America/Santiago, 6 Sep 2026) | Fails, see Edge Case 1 |

### Issues Found

#### Bugs (must fix before commit)

None.

#### Performance Issues (should fix)

None. One closure read is added to the plan checkout, the Boost checkout and the plain reactivate, each before any Stripe call.

#### Edge Cases (nice to fix)

1. **Lock date one hour early, on the previous local date, in a zone whose DST starts at midnight** — File: `lib/business-os/account-deletion/closureDates.ts:37` via `businessDayFor` (`lib/business-os/businessDay.ts:121`) and `startOfDayUtc` in `lib/business-os/bizql/dates.ts` (shared helper, not changed by D6) — Severity: Low
   - Steps to reproduce: `closureLockAt(new Date('2026-08-23T16:00:00.000Z'), 'America/Santiago')`
   - Expected: the first instant of local 6 Sep 2026, which is `2026-09-06T04:00:00.000Z` (01:00 local, UTC-3; 00:00 does not exist that day)
   - Actual: `2026-09-06T03:00:00.000Z`, which is 5 Sep 23:00 local (UTC-4). Shown in the owner's zone, the lock date reads one day early
   - Reach: only zones that change clock at local midnight (Chile, Paraguay, Cuba and a few others), and only when day 15 is the change day. The switch is off. The helper is shared, so the fix belongs to its owner, not D6. DL-2 and DL-3 show and act on this date, so it should be settled before DL-5
2. **`lock_timezone` stores the zone name as the user typed its case** — `closureLockAt(now, 'asia/jerusalem')` returns `lockTimezone: 'asia/jerusalem'` (the date itself is right). `resolveBusinessTimezone` accepts any name Intl accepts. Severity: Low; only matters if a later reader compares zone strings. Pre-existing resolver behaviour
3. **`closureDates.test.ts` pins the fall-back week only.** The spring-forward direction passes in the QA scratch test; adding one line for it would pin both directions. Nice to have

Carried from the SA code review, unchanged and owned by DL-2 / DL-3 as named there: CR-6 (`status: null` on a lost re-read), CR-7 (KEPT audit written after the Stripe call), CR-8 (`state_changed` when the row is already `kept`), CR-9 (a stuck `requesting` row blocks Keep, checkout and Boost until DL-3), CR-10 (placeholder client copy for `deletion_pending`), and the binding DL-3 obligation (a) to (d) before DL-5.

### Test Outputs / Logs

| Run | Result |
|---|---|
| Targeted D6 set: `app/api/business-os/account`, `lib/business-os/account-deletion`, `planSubscriptionManage.origin.d6`, `planSubscriptionMirror`, `planBillingHandler`, `planCheckout*`, `lib/business-os/boost`, `AccountClosureRepository`, the closure callers guard, `no-deletion-paths`, `oneDontRenewPath`, `enforcementPoints`, `eventAudience`, plan checkout and Boost checkout routes (`--ci`) | 59 / 59 suites, 2,185 / 2,185 tests |
| Broad regression: `lib/business-os`, `app/api/business-os`, `lib/audit`, `app/api/stripe`, `components/business-os`, `app/invite`, `app/admin/users`, `lib/repositories/__tests__` (`--ci`) | 926 / 929 suites; 25,179 passed, 5 failed, 29 skipped; snapshots 134 / 134 |
| `npm run test:bos-entitlements` | 346 / 346 suites, 10,057 / 10,057 |
| Webhook / Connect harness (`app/api/stripe/webhook/__tests__`, inside the broad run, `--ci`) | All green, `connectPath.characterisation` included; `git status` shows no `.snap` change |
| `tsc --noEmit -p tsconfig.json`, 8 GB heap | Completed (exit 1 from pre-existing errors, no OOM; 1,921 errors repo-wide, semantic pass ran). **0 errors in the 74 touched code files** (paths matched exactly) |
| ESLint on touched code files | 0 errors, 1 warning (`lib/audit/events.ts` unused `_`, there before D6) |
| `console.*` in touched non-test files | None |

**The 3 failing suites are not D6-caused.** `lib/business-os/__tests__/bookingNextStep.test.ts`, `lib/business-os/onboarding/__tests__/servicesAreDraftsWithWords.guard.test.ts` and `lib/business-os/onboarding/__tests__/theChainHoldsEndToEnd.test.ts` scan source text with newline literals (for example `indexOf` of a blank line, and a `z.object` opening spread over two lines). The files they scan (`bookingNextStep.ts`, `translations/*.ts`, `BookingsTab.tsx`, the onboarding build files) are checked out with CRLF line endings here (`core.autocrlf=true`; `file` reports CRLF), and none of them is in the D6 diff. This is the known local Windows pattern and does not happen on CI's LF checkout.

### Final Status
- [x] All acceptance criteria pass — ready for commit (after the user has seen the diff, per the standing rule)
- [ ] Issues found — Dev must address before commit

**Verdict: PASS WITH NOTES.** Every §7 DL-1b criterion, both user decisions and the review fixes CR-1, CR-4 and CR-5 pass, with the replay and never-fail behaviour of the Stripe-side keep confirmed. No bug. Three Low edge cases are recorded for TL to route (Edge Case 1 belongs to the owner of the shared date helper and should be settled before DL-5).

## Commit Info

*(RM populates)*

---

## SA Workplan Review — 2026-11-04

**Reviewer:** SA. **Read against:** `origin/main` `0eb3949e` in the `neuronforge-d6` worktree (code, not the workplan's citations), the requirement §3.3, §3.4, §4, §6.2 "SX-1 as built", §6.3 DL-1b row, §7 DL-1b, §9.1, §10 and §11, and the skills `tenant-isolation-guard`, `business-os-entitlements`, `new-api-route`, `durable-queue-drain`.

**Verdict: APPROVED WITH CONDITIONS (W-1 to W-14).** The design is right: thin routes over pure orchestration with ports, one engine call, the row written before the only Stripe call, Keep row-first, the C-3 mirror as a DELETE-owned port, the checkout and Boost refusal from the closure repository, no migration, no regeneration, no email, switch off. Scope matches the §6.3 DL-1b row and 2.5 d; nothing in it widens the row. Two findings are real invariant holes (W-1, W-2) and one would refuse every free account that has files (W-4); they are fixable inside the plan without new scope.

### What was verified on `origin/main`

| # | Area | Result |
|---|---|---|
| V-1 | Engine order and C-4 key | Confirmed. Every read and our-data refusal precedes the Stripe read; the write key is `planManageAttemptKey(subscriptionId, action, randomUUID())`, fresh per call of `managePlanSubscription` (`planSubscriptionManage.ts` l.441). D6 makes one engine call per request, so C-4 holds with no D6 code. Definite refusals (`NOT_EXECUTED_ERROR_TYPES`, every refusal before step 9) carry no `outcomeUnknown`; a lost answer or an answer that differs carries `outcomeUnknown: true` with audit facts (l.446–463). The §4.4 P-4 / P-7 split is therefore correct |
| V-2 | Step 7 "already set to end" | **Hole, see W-1.** Step 7 compares `hasCancelDate(fresh)` (l.415), which counts ANY `cancel_at`, also one later than the period end. The mirror stores `isSetToEndThisPeriod` (`subscriptionCancelling.ts` l.61), which does not |
| V-3 | One "don't renew" path | Confirmed: `oneDontRenewPath.guard.test.ts` pins `setBusinessOsCancelAtPeriodEnd`, `cancelBusinessOsSubscriptionNow` and the void methods to the engine over `lib/business-os/**` and `app/api/business-os/**`. The new D6 files fall inside the scan, so calling the engine is enforced, not just planned |
| V-4 | Plain reactivate | Confirmed: `/plan/reactivate` calls the engine with no closure awareness (route l.86). E-2 is needed |
| V-5 | Mirror and C-3 | Confirmed: the mirror reads Stripe fresh and stores the derived flag (`planSubscriptionMirror.ts` l.130–143); the P-7a C-3 follow-up has landed, so SA Q-10's "before or inside D6" is met. `afterPlanMove` is the precedent for a required DELETE-owned port that throws to release the webhook claim |
| V-6 | Closure storage | Confirmed: the claim and the claimable index take `requesting / pending / grace` only and skip a future `next_check_at` (migration 20261093, claim WHERE and index). `transition` is compare-and-set on `id + user_id + status` with a per-transition column allow-list; `requesting>pending` today writes only `requested_email_sent_at`, `next_check_at` |
| V-7 | Pre-check runner | **Hole, see W-4.** `runAccountDeletionCheck` drops G-12 and then substitutes `unknown` when nothing is left (`selfServiceDeletion.ts` l.84–89) |
| V-8 | Checkout and Boost | Confirmed: plan checkout reads the billing row at step 8 and decides at 8a before any Stripe call; Boost does the payment hold, then the package, then Stripe. Both have room for a pre-Stripe read |
| V-9 | Upgrade | Confirmed: `planUpgrade.ts` refuses `subscription_cancelling` on the fresh flag or any `cancel_at` (l.294–295). D-12 holds |
| V-10 | Audit | Confirmed: `AuditTrailService` writes `SYSTEM_ADMIN_USER_ID` with `system_action: true` when `userId` is unset, keeps `actorId`; every regenerated cleanup function deletes `audit_trail` by `user_id` only. DELETE's anchors are directly after `ACCOUNT_DELETION_REFUSED` in `events.ts` (l.201, l.1400) and `eventAudience.ts` (l.127) |
| V-11 | Entitlements | The mirror, `planCheckout.ts`, both checkout routes, `boostCheckoutDeps.ts` and the plan routes are already registered in `KNOWN_NON_GATE_IMPORTERS`; their symbol lists do not change. The registry test fails on an unregistered importer, so G-4 is enforced |
| V-12 | Tenant isolation | Every closure, billing and timezone read in the plan is keyed by `readSessionSubject()` (verified Supabase Auth, no cache) or, in the mirror, by OUR billing row's account id, never a body value or Stripe metadata. The closure repository filters `user_id` on every per-account method. The engine cross-checks Stripe's `bos_user_id` against the session account. No service-role path takes a caller-supplied id. Passes |

### Item 7: who owns `receiptInput.ts`

**The Dev is right.** §11 is the binding boundary and says it three times: B.1 lists `lib/business-os/account-deletion/**` "**including `receiptInput.ts`**" under DELETE (SR-1), B.8 assigns `receiptInput.ts` to DELETE, and S-3 says "`receiptInput.ts` is no longer a shared surface: DELETE owns it (B.1, SR-1) and EXPORT does not edit it". EXPORT owns only `findDeletionFacts` and `DataExportDeletionFacts` in `BusinessOsDataExportJobRepository.ts` (frozen, B.6). Verified in code: `buildOwnerReceipt` is exported from `receiptInput.ts` (l.137). The two lines that say otherwise are stale: §3.6 ("`buildOwnerReceipt` with export facts from `findDeletionFacts`, both owned by EXPORT") and the XC-6 split note ("the file itself is owned by EXPORT"). The XC-6 copy is a dated record and the §11 header says the amended §11 lines win over those; §3.6 is body text written before SR-1. **Coordination record:** correct the D6 row to "`receiptInput.ts` / `buildOwnerReceipt`: DELETE; `findDeletionFacts`: EXPORT". **Requirement:** BA corrects §3.6 at the next splice (DELETE's own section; §11 untouched). D6 edits neither file; the S-3 notice to EXPORT that the request route stops calling `findDeletionFacts` is still correct and harmless.

### Item 8: the claim never returns a `kept` row (Q-9)

**Confirmed.** The claim's WHERE and the claimable index both take `status IN ('requesting', 'pending', 'grace')`, so a `kept` row with `kept_email_sent_at` NULL is never claimed, and DL-3 as specified (§6.3: "Deletion requested" and "Account kept" emails, each exactly once through the claim) cannot send the "kept" email. **Direction for DL-3, not D6:** one claim path, widened, rather than a second function or inline sending. DL-3 replaces the claim function (same name and signature) so that it also returns `status = 'kept' AND kept_email_sent_at IS NULL`, adjusts the claimable index to match, and its pass on a `kept` row does the kept email and nothing else. Inline sending from the Keep route and the mirror is rejected for the same reason as Q-8: a second, unclaimed send path, and the mirror runs inside a webhook claim. **Consequence for the plan:** DL-3 gains a migration, so it becomes a manual prod gate and reserves a number (§6.3 shows "—" today). TL records this in the coordination file and the DL-3 row at DL-3 scoping; it costs D6 nothing. No `kept` row can exist before DL-3: the request is behind the switch.

### Conditions (each must be in the workplan text before code)

| # | Condition | Priority |
|---|---|---|
| **W-1** | **Never `pending` on a plan that renews this period.** For `origin: 'deletion_request'` the engine's "already set to end" test is `isSetToEndThisPeriod` on the fresh read (flag, or `cancel_at` at or before the latest item period end), not `hasCancelDate`. A fresh `cancel_at` LATER than the period end (an operator's custom date) must not produce P-2: as written, step 7 answers `unchanged / cancelling`, R-12 writes `pending`, the plan renews at the period end, and the next `customer.subscription.updated` makes the C-3 port keep the request as `stripe` without the owner asking. Default ruling: refuse definitely (new engine refusal, mapped to 409 `blocked` `contact_support`, row deleted as P-4). The Dev may instead go on to the write only if a sandbox check, recorded in the workplan, shows `setBusinessOsCancelAtPeriodEnd(true)` replaces the later date; then the write's answer must also pass `isSetToEndThisPeriod` or it is `answer_differs`. R-12 likewise moves to `pending` only on an answer that passes `isSetToEndThisPeriod`. The owner and keep origins keep today's `hasCancelDate` behaviour (SA Q-6 of C-3 stands). T-6 and T-13 gain the "later `cancel_at`" rows | High |
| **W-2** | **Do not sleep the row at `pending`.** R-12 must not write `next_check_at = endsOn`: the claim skips a future `next_check_at`, so DL-3 could not send "Deletion requested" until the paid period ended, against §3.1 stage A. D6 leaves `next_check_at` NULL at `pending` and at `grace`; DL-3 owns pacing (it sends the email, then sleeps the row). Drop `next_check_at` from R-12 and §4.4 P-1 / P-2 | High |
| **W-3** | **Q-2, widened by one column.** Add `renewal_was_on` AND `plan_ends_at` to the `requesting>pending` allow-list and patch schemas, both corrected from the engine's own answer at R-12 (`plan_ends_at` from `endsOn` on P-1, `date` on P-2; an early `cancel_at` ends the plan before our row's `current_period_end`, and DL-3's dates come from this column). No other transition gains them (T-17 refuses both elsewhere before a DB call). Repository file only, no migration | Medium |
| **W-4** | **Classify blockers from the RAW guard rows.** `requestBlockers` must not take `runAccountDeletionCheck`'s `blockers` field: it has G-12 removed and `unknown` put in when nothing else is left, so a free account whose only block is stored files is refused as `contact_support`, against XC-5 ("G-12 ignored"). Extend `runAccountDeletionCheck` (DELETE-owned) to return the raw rows and the "check resolved this login" fact separately; `requestBlockers` reads those, and `unknown` blocks only for a parser miss or another login. Tests: G-12 alone, G-6 alone, G-6 + G-12 → not blocked; target login mismatch → `contact_support`; a G-9 row with unrecognised item text → blocks as `contact_support` (fail closed). The pre-check route uses the same function (Q-15) | High |
| **W-5** | **A free account does not depend on the prices switch.** `planManageOffer` answers `switch_off` before anything else, so R-7 must decide "no subscription id" and "`ended_at` set" from the row first, and read the switch only for a row with a live subscription id (503 `not_available`). Test both free shapes with the switch off → `grace` | Medium |
| **W-6** | **Ports and their test fan-out, stated honestly.** (a) The engine's `deletionPending` may stay optional with the real reader as default (the engine's existing `repo` / `stripe` pattern), and the plain reactivate route stays untouched; but every existing engine suite that reaches a reactivate must pass a fake, or it hits the real reader, the no-network guard refuses it, and it reads `billing_row_unreadable`. (b) The checkout and Boost `deletionPending` ports and the mirror's `closureStripeKeep` are **required**, with no default; never a no-op default for `closureStripeKeep` (it would silently drop C-3). (c) Replace "Existing P-7a / D2 suites unchanged" with "one fake line in each suite's deps builder, assertions unchanged", and list the files in the §14 claim: `planSubscriptionManage.test.ts`, `planSubscriptionManage.p7a1.qa.test.ts`, `planCancelEngine.d2.test.ts`, `planCancelNow.p7a4.test.ts`, `planManageOffer.matrix.test.ts`, `subscriptionCancelling.c3.qa.test.ts`, `planCheckout.test.ts`, `planCheckout.qa.test.ts`, `heldPaymentOffer.matrix.test.ts`, `planPurchaseOffer.matrix.test.ts`, `planSubscriptionMirror.test.ts`, `planBillingHandler.test.ts`, `planPaymentApply.firstPayment.test.ts`, `planPaymentApply.n2.test.ts`, `planReconcilePass.d31.test.ts`, `planRenewal.captured.test.ts` (all under `lib/business-os/billing/__tests__/`), `lib/business-os/boost/__tests__/boostCheckout.test.ts`, `app/api/business-os/credits/boost/checkout/__tests__/route.test.ts`. Only the files whose deps actually need it are touched; the Dev confirms the list against the type-check | Medium |
| **W-7** | **G-3 contradicts itself** ("No edit" plus "a new assertion"). Do not edit `oneDontRenewPath.guard.test.ts`. Put the "D6 calls `managePlanSubscription`" pin in a DELETE-owned test (a source scan in `closureRequest.test.ts` / `closureKeep.test.ts`) | Low |
| **W-8** | **`origin`, closure id and account id never come from a request.** The routes set `origin` as a constant; the plain routes pass none (absent = `owner`); `deletion_keep` is passed only by `closureKeep.ts` after K-3 moved the row. The `.strict()` bodies already refuse an `origin` key; T-15 asserts it | Medium |
| **W-9** | **D-9 clean-up is complete.** Removing `runSelfAccountAnonymise` also removes `selfServiceDeletion.ts`'s import of `runAccountAnonymise`, and the `why` of its `CLEANUP_REPOSITORY_IMPORTERS` entry in `no-deletion-paths.guard.test.ts` changes to "pre-check runner only" (DELETE owns the rules, SR-3; no older-version allow-list entry moves) | Low |
| **W-10** | **Entitlements registrations follow the code, not the plan.** As planned, `resolveAccountId` is imported only by the two account routes (two new `KNOWN_NON_GATE_IMPORTERS` entries, exact symbols). If any new DELETE file (`closureRequestDeps.ts`, `closureKeepDeps.ts`, `closureStripeKeepDeps.ts`) imports from the module instead, it gets its own entry; `deletionPendingReader.ts` imports nothing from it (assert this in its test, XC-19). No new file goes into `ENFORCEMENT_POINTS`. `npm run test:bos-entitlements` green before hand-over | Medium |
| **W-11** | **Lock date pinned.** `closureLockAt(now, zone)` = `businessDayFor(now, zone, 14).startUtc`, day 1 being the local day the request is made. `closureDates.test.ts` adds a request at 23:30 local and one at 00:10 local, beside the DST week, NULL → UTC and unusable zone → UTC. `lock_timezone` stores the resolved zone; the zone comes from `user_preferences.timezone` only (CLAUDE.md: `business_profiles.timezone` does not exist) | Medium |
| **W-12** | **§14 coordination block corrections.** Add the W-6 test list to the PLAN PAYMENTS claim; record `receiptInput.ts` as DELETE-owned and `findDeletionFacts` as EXPORT-owned (item 7); note that §11 B.1 already gives DELETE `lib/business-os/billing/**` against EXPORT, so the claim is with the PLAN PAYMENTS stream only; keep "the plain `/plan/cancel` and `/plan/reactivate` routes not touched" true under W-6 (a) | Medium |
| **W-13** | **Q-12 as ruled below.** `reasonCode` required, `z.enum(PLAN_LEAVE_REASON_CODES)`. If the user answers BQ-32 "no", DL-2 must not send `other` on the owner's behalf (it would put a reason the owner never gave into the reasons data): a dedicated code such as `not_asked` is added then, a one-line enum change | Low |
| **W-14** | **XC-13 audit rows.** Success rows (`REQUESTED`, `KEPT`, `GRACE_STARTED`) have `userId` unset and `actorId` = subject (owner acts) or unset (Stripe); refusals keep B-1. Keep the existing refusal `details.source: 'self_service'` and add `stage: 'request'` instead of renaming the value, so older rows and newer rows filter alike. T-15 asserts `user_id` / `actor_id` per row, and that no row carries an email, statement text or Stripe message | Low |

### Rulings on the Dev's questions

| Q | Ruling | Reason |
|---|---|---|
| Q-1 | APPROVED (technically), **business confirmation asked below** | TQ-14 already treats `trialing` as `active` in the shared predicate and the plain cancel; setting a trial not to convert charges nothing; refusing would send an owner to support for what Cancel already allows. It amends carried SA-2 for the request only; the requirement as-built note says so |
| Q-2 | APPROVED WITH CHANGE (W-3) | The engine's answer is Stripe's truth and our row can lag (P-7a C-2); a request can never read its own cancellation, since it makes one engine call and a definite refusal writes nothing. Also correct `plan_ends_at` at the same transition |
| Q-3 | APPROVED WITH CHANGE (W-5) | Never guess; refuse with a retryable code. `ended_at` set → free. Free classification must come before the prices-switch read |
| Q-4 | APPROVED | Three values. `deletion_keep` changes no engine behaviour (the row is already `kept` when it runs), but the audit must tell a deletion Keep from a plain Keep my plan (SA-4) |
| Q-5 | APPROVED WITH CHANGE (W-6) | In the engine, so every future caller inherits the XC-2 invariant; fails closed on `unreadable`. Optional port with the real default, and fakes in the existing suites |
| Q-6 | APPROVED | XC-13 names `ACCOUNT_GRACE_STARTED`; the free path starts C in D6, so D6 writes it there, and DL-3 reuses it for paid accounts |
| Q-7 | APPROVED | Every pending request has its plan set to end, so the upgrade already refuses (`subscription_cancelling`, verified l.294–295). DL-2 shows "Keep your account first" for that code while a request is open |
| Q-8 | APPROVED WITH CHANGE (W-2) | DL-3 is the one exactly-once send path (claim, Resend key, `*_sent_at`). Requires `next_check_at` NULL at `pending` so DL-3 can send at stage A |
| Q-9 | APPROVED (record only), direction ruled in item 8 | Confirmed hole. DL-3 widens the one claim to `kept AND kept_email_sent_at IS NULL` in its own migration; no inline sending; nothing in D6 |
| Q-10 | APPROVED WITH CHANGE (W-9) | A dead export of a destructive runner invites reuse. Also drop the now-unused import and update the guard's `why` |
| Q-11 | APPROVED | P-8 answers 503 `try_again` with `status: 'requesting'`; the retry sees `already_requested`; DL-3 settles. K-2's fresh re-check of `pending` rows is DL-3's pass, not D6's. Nobody can reach either while the switch is off |
| Q-12 | APPROVED WITH CHANGE (W-13), **BQ-32 still open for the user** | The column is NOT NULL and §3.3 step 2 makes the reason required. Do not default to `other` if BQ-32 is "no" |
| Q-13 | APPROVED | The account IS kept, which is what was asked; `renewal: 'failed'` with the code is the honest XC-2 answer and the plan card shows "Ends on {date} [Keep my plan]" |
| Q-14 | APPROVED | XC-5 lists neither the identity guards nor puts them in the engineering list; they mean the check may not be about this login, so they fail closed as `contact_support` |
| Q-15 | APPROVED | XC-6 keeps the deletion-check route "with the XC-5 filter"; one filter for both routes in one PR, so the drawer never shows G-6 |

### Notes for TL (not conditions on the Dev)

- **A carried hand-over that is outside this slice.** Requirement §6.2 ("`reasonCode` hand-over", SA Q-1 of D3) says the first slice that holds the cancel engine after D3 merges, "P-7a.4 or D6", makes the **plain cancel's** `reasonCode` required. That is not in the §6.3 DL-1b row, and D6 keeps the plain routes untouched, so D6 does not do it. TL re-homes it (coordination file, and a line in the DL-1b as-built note saying it was not done here) or asks the user to drop it.
- DL-3 gains a migration (item 8). Record it at DL-3 scoping.
- Requirement §3.6's ownership sentence is stale (item 7); BA corrects it at the next splice, §11 untouched.

### Optimisation suggestions (not blocking)

- One refusal vocabulary for "closure state unreadable": plan checkout `deletion_state_unreadable` (503) and Boost `deletion_check_failed` (500) name the same fault twice. Prefer one code and one status (503) in both.
- Keep route, compare-and-set lost: re-read, and if the row is now `kept` (a second tab, or the mirror), answer 200 `kept` rather than 409 `state_changed`; the owner's wish is met.
- `ACCOUNT_DELETION_REQUESTED` at `warning`: check it against the audit-severity alerting rules (the 2026-09 false-positive work); `info` is enough unless an alert is wanted.
- The pure modules type their closure port locally (`Pick` of a local interface), so only the `*Deps.ts` files name `AccountClosureRepository` and the G-2 allow-list stays as planned.

### Questions for the user (business, plain language)

1. **Q-1, a trial that is asked to delete.** An owner who is still in a free trial of a paid plan asks to delete their account. Should we accept the request (the trial is set not to turn into a paid plan, so nothing is charged; the 14 days to export start when the trial ends), or refuse it and send them to support? **Suggested answer: accept it**, the same as the plain Cancel already does for a trial.
2. **BQ-32, the reason picker (already open, needed before DL-2).** Should the deletion drawer ask "Why are you leaving?" with the same list as the plan cancel, list only? **Suggested answer: yes.** D6 already requires a reason on the server; if the answer is "no", we record "not asked" rather than pretending the owner chose "Other".

### Code Approved for QA

Not applicable (workplan review). Code review follows implementation.

---

## User Decisions — 2026-11-04

| # | Question | Answer |
|---|---|---|
| Q-1 / SA business question 1 | An owner on a paid-plan free trial (`trialing`) asks for deletion | **Accept**, as `active`: the trial does not convert, nothing is charged, stage C starts when the trial ends |
| Q-12 / BQ-32 | Reason list in the deletion drawer | **Yes, required**: same list as the plan cancel, list only; the request route requires `reasonCode` (W-13; `not_asked` is not needed) |

TL note: the §6.2 hand-over that makes the PLAIN cancel `reasonCode` required ("P-7a.4 or D6") is NOT in D6; it stays with PLAN PAYMENTS.

---

## SA Code Review — 2026-11-04

**Reviewer:** SA. **Read against:** the uncommitted worktree `neuronforge-d6` (`git diff 0eb3949e` plus the untracked files), the code itself rather than the Implementation notes, the requirement §3.3, §3.4, §4, §7 DL-1b, §9.1, §10, and the W-1 to W-14 conditions above.

**Status: 🔄 APPROVED WITH FIXES.** One MUST-FIX (CR-1, small and local); everything else is SHOULD-FIX or NOTE. The design is built as approved: thin routes over pure orchestration, one engine call, the row written before the only Stripe call, Keep row-first, the C-3 port wired once, the checkout and Boost refusals from the closure repository, no migration, no email, switch off.

### Suites run by SA (not the Dev's numbers)

| Run | Result |
|---|---|
| `lib/business-os/account-deletion`, `app/api/business-os/account`, `planSubscriptionManage.origin.d6`, `planSubscriptionMirror`, `planBillingHandler`, `planCheckout`, `boostCheckout`, `AccountClosureRepository`, the closure callers guard, `no-deletion-paths`, `oneDontRenewPath`, `enforcementPoints`, `eventAudience` | 37 suites, 1,340 / 1,340 |
| `routerPlacement.guard`, `afterPlanMove.guard`, `planReconcilePass.guard`, `planReconcilePass.d31`, `planRenewal.captured`, every `planSubscriptionManage*` and `planCancel*` suite | 17 suites, 429 / 429 |
| `app/api/business-os/billing`, `app/api/business-os/credits`, the plan card render suites, `app/invite` | 24 suites, 759 / 759 |
| Snapshots | none changed (`git status` and `git diff --stat` show no `.snap`) |

The typecheck was not re-run by SA (the Dev's run reports 0 errors in touched files with the semantic pass completed). ts-jest compiles each suite with its own inline tsconfig, so the green suites above are not a strict-mode typecheck. QA re-runs the filtered `tsc` before hand-over.

**The invariant test can fail.** `closureRequest.invariant.test.ts` drives the REAL `managePlanSubscription` over a fake Stripe and a fake closure store (360 combinations plus two pins). Remove the W-1 pre-step-7 check and the row `cancel_at_later` / `cancelling` / `moved` ends `pending` with `isSetToEndThisPeriod` false, so the assertion fails. Remove `notThisPeriod` from the answer check and `answer_later_cancel_at` / `moved` does the same. The row can only become `pending` in R-12, which is reached from P-1 or P-2 only.

### W-1 to W-14, checked in the code

| # | Met? | Where |
|---|---|---|
| W-1 | Yes | `planSubscriptionManage.ts`: before step 7, `deletion_request` + any cancel date + not `isSetToEndThisPeriod` refuses `custom_end_date` (no write); the write's answer must also pass `isSetToEndThisPeriod` or it is `answer_differs` with `outcomeUnknown`. `closureRequest.ts` maps `custom_end_date` to `blocked` / `contact_support` and withdraws the row. The owner and keep origins keep `hasCancelDate` (pinned in `origin.d6`) |
| W-2 | Yes | `closureRequest.ts` R-11f and R-12 write no `next_check_at` (but see CR-3: the workplan body still says it does) |
| W-3 | Yes | `AccountClosureRepository.ts`: `renewal_was_on` and `plan_ends_at` on `requesting>pending` only; T-17 refuses both elsewhere |
| W-4 | Yes | `runAccountDeletionCheck` returns `rows`, `verdictBlocked`, `resolvedThisLogin`; `requestBlockers` reads the raw rows; an unknown guard id and a G-9 row with unrecognised text both block as `contact_support`; G-6 and G-12 are ignored. The pre-check route uses the same function |
| W-5 | Yes | `classifyBillingRow` decides free from the row before `pricesEnabled()`; tests cover both free shapes with the switch off |
| W-6 | Yes | `closureStripeKeep`, the checkout and the Boost `deletionPending` ports are required with no default; the engine's port is optional with the real reader; each engine suite got one fake line, assertions unchanged |
| W-7 | Yes | The "calls the engine" pin is in `closureRequest.test.ts`; `oneDontRenewPath.guard.test.ts` is not edited |
| W-8 | Yes | `origin` is a constant in `closureRequest.ts` / `closureKeep.ts`; both bodies are `.strict()` and the route tests refuse `origin`, `userId`, `status`, `closureId` |
| W-9 | Yes | `runSelfAccountAnonymise` and the `runAccountAnonymise` import are gone; the guard's `why` was updated; family 6 has negative fixtures and a floor |
| W-10 | Yes | Exactly two new `KNOWN_NON_GATE_IMPORTERS` entries (`resolveAccountId` only); no new DELETE lib file imports the module (`deletionPendingReader.ts` names it in comments only) |
| W-11 | Yes | `closureLockAt` = `businessDayFor(now, zone, 14).startUtc`; tests for 23:30 / 00:10 local, the DST week, NULL and an unusable zone |
| W-12 | n/a | TL's coordination block |
| W-13 | Yes | `reasonCode: z.enum(PLAN_LEAVE_REASON_CODES)`, required; missing or off-list is 400 |
| W-14 | **Partly: see CR-1** | `user_id` / `actor_id` are as ruled. The surviving rows still carry the request context |

### Code Review Comments

| # | Severity | File:line | Finding | Fix |
|---|---|---|---|---|
| CR-1 | **MUST-FIX** | `app/api/business-os/account/delete/route.ts:258-263` (`shared` has `request`); `app/api/business-os/account/keep/route.ts:141` | The three rows that must survive stage E (`ACCOUNT_DELETION_REQUESTED`, `ACCOUNT_GRACE_STARTED`, owner `ACCOUNT_DELETION_KEPT`) are written with `request`. `AuditTrailService.buildLogEntry` then stores `ip_address`, `user_agent` and `session_id` (a cookie or `authorization` prefix) in `audit_trail`. E deletes `audit_trail` by `user_id` only, and these rows have the system `user_id`, so the owner's IP address and browser are kept after erasure, beside `entity_id` = the subject. That breaks §10 and W-14 ("uuids, codes and dates only") and the GDPR purpose of E. The precedent survivor row, `ACCOUNT_PSEUDONYMISED`, is written in SQL with no request context | Drop `request` from those three entries only. Keep it on `ACCOUNT_DELETION_REFUSED` and on the `BOS_BILLING_SUBSCRIPTION_*` rows, which carry `user_id` = subject and go with the account. Add one assertion in each route test that the surviving entries have no `request` key. `closureStripeKeepDeps.ts` already passes none, so the Stripe-sourced KEPT row is correct |
| CR-2 | SHOULD-FIX | requirement §6.3 "DL-1b as built" note | The note says a mirror keep failure "is logged and alerted and never fails the event", but not what that costs or who pays it: a `pending` row can now sit on a renewing plan until DL-3 exists. That obligation has to be in the requirement, not only in this workplan | Add the DL-3 obligation from the IN-1 ruling below to the note, as one sentence, with "before DL-5" |
| CR-3 | SHOULD-FIX (docs) | this workplan §4.2 R-12 (still `next_check_at: endsOn`), §7 bullet 4 (still "throws, so … Stripe retries"), §12 G-3 (still "a new assertion" in `oneDontRenewPath`) | The W conditions were to be folded into the workplan text before code. The code follows the W rulings and the IN notes, but three body lines still describe the superseded design | Edit the three lines to match W-2, IN-1 and W-7, or add "superseded by W-2 / IN-1 / W-7" to each. No code change |
| CR-4 | NOTE | `lib/business-os/billing/planSubscriptionManage.ts` (the W-1 block before step 7, and `notThisPeriod`) | Both are gated on `origin === 'deletion_request'` only, not on `action === 'cancel'`. A future caller passing `deletion_request` with `reactivate` would always read `answer_differs`. No such caller exists, and W-8 makes `origin` a server constant | Optional: add `action === 'cancel' &&` to both, or type `PlanManageInput` so `deletion_request` goes with `cancel` and `deletion_keep` with `reactivate`. PLAN PAYMENTS' call |
| CR-5 | NOTE | `lib/business-os/account-deletion/deletionPendingReader.ts:215` | The default parameter `repo = sharedRepository()` is evaluated before the `try`, so a constructor throw (a missing service-role env) escapes, although the header says "Never throws". Every caller wraps the call in try/catch and maps a throw to `unreadable`, so the refusal still fails closed | Move the default into the `try` (`const r = repo ?? sharedRepository()`) so the module matches its own contract |
| CR-6 | NOTE | `lib/business-os/account-deletion/closureRequest.ts:353-354` | `already_open` from the insert, then a failed re-read, answers 409 with `data: { status: null }` | Harmless; DL-2 should treat a null status as "already requested" |
| CR-7 | NOTE | `closureKeep.ts` K-3 (IN-8) | The KEPT audit is written after K-5, so if the function dies inside the Stripe call (`maxDuration` 30 s), the row is `kept` with no KEPT audit row. The row is the record and DL-3 sends the email from it | Accepted for D6. If DL-2 shows the audit trail to the owner, write the KEPT row before K-5 with `renewal: 'pending'` and the money row after |
| CR-8 | NOTE | `closureKeep.ts:115-119` | A lost compare-and-set whose re-read is `kept` (a second tab, or the mirror) still answers 409 `state_changed`; the SA optimisation note suggested 200 | DL-2 may map `state_changed` + `status: 'kept'` to the kept screen; no change required here |
| CR-9 | NOTE | `readDeletionPending` counts `requesting` as open | A `requesting` row left by P-7, P-8 or P-9 refuses the plain Keep my plan (`deletion_pending`), plan checkout and Boost, while Keep answers `request_in_progress`. The owner has no way out until DL-3 settles the row. Already risk K-1; unreachable while the switch is off | DL-3 obligation (b) below |
| CR-10 | NOTE | `components/business-os/settings/planManageCopy.ts`, `planPurchaseCopy.ts`, `app/invite/awaitingPaymentCopy.ts` | Verified: each new code maps to a key that already exists on `0eb3949e` (`plan.manage.refusal.unavailable`, `plan.manage.refusal.support`, `plan.refusal.not_open`, `plan.refusal.generic`, `refusalNotOpen`, `refusalGeneric`). No wording or translation added. The owner therefore sees "not available right now" or "Payment for your invitation is not open yet" for `deletion_pending` | DL-2 gives `deletion_pending` its own en/he/es line in all three maps and in the Boost client before switch-on |
| CR-11 | NOTE | `deletionEmail.ts`, `authCookies.ts` | Both have no production caller after D6, as planned (D-8, D-9). Their tests still run | DL-3 rewrites `deletionEmail.ts`; DL-5 removes `authCookies.ts` if nothing claims it |
| CR-12 | NOTE (outside D6, for TL) | `lib/services/AuditTrailService.ts` `extractRequestContext` | Every audit row written with `request` stores the value of `sb-access-token` / `sb-refresh-token` / `session_id` cookies, or the first 32 characters of `authorization`, as `session_id`. Not a D6 change. A token-shaped value in an audit table is worth its own small finding | TL parks it as a separate item; D6 only has to stop sending it on the surviving rows (CR-1) |

### Rules checked (CLAUDE.md 1 to 7, security)

| Rule | Result |
|---|---|
| 1 Repositories only | Yes. Closure, billing and timezone reads go through `AccountClosureRepository`, `BusinessOsBillingAccountRepository`, `UserPreferencesRepository`; only the `*Deps.ts` files and `deletionPendingReader.ts` name the closure repository (callers guard green) |
| 2 Zod `.strict()` before logic | Yes, both routes; Keep's empty body reads as `{}` |
| 3 Pino + correlationId; ids and codes only; `{ err }` | Yes. Errors are logged as `err: errorKindFacts(error)` (kind, code, name), the module's DE-10b.2 sanitiser. `closureStripeKeepNeverFailing` logs a message only when it is a snake_case code. No `console.*` in any touched file |
| 4 / tenant isolation | Every closure, billing and engine id is `readSessionSubject()`'s, or in the mirror OUR billing row's account id; the repository filters `user_id` on each method; nothing takes a body or Stripe-metadata id. Service role documented in each deps header |
| 5 No hardcoded models | n/a |
| 6 Strict TS, no unexplained `any` | No `any` added; `as unknown as PlanManageDeps` only in the invariant test's fake |
| 7 No new pattern | None. Ports, the `afterPlanMove`-style required mirror port, `logAndFlush` |
| Error format | Internal detail only under `NODE_ENV === 'development'` |
| Audit non-blocking | `logAndFlush`, bounded, never fails a request; refusals keep B-1 (`user_id` = subject); `source: 'self_service'` kept and `stage: 'request'` added |
| Shared audit files | `events.ts` and `eventAudience.ts` edits are one contiguous block each, directly after `ACCOUNT_DELETION_REFUSED`; nothing renamed or moved |
| Entitlements | Two `KNOWN_NON_GATE_IMPORTERS` entries, `resolveAccountId` only, exact; no `ENFORCEMENT_POINTS` change |

### PLAN PAYMENTS' five review points

| # | Point | Result |
|---|---|---|
| a | `closureStripeKeep` never fails the mirror | Yes. `closureStripeKeepNeverFailing` (in `planBillingHandler.ts`) catches, logs `error` + `alert` with ids and a code only, and resolves; tested with the real mirror and a throwing port |
| b | Replay-safe | Yes. Only a `pending` row is moved, by compare-and-set on `pending`; the audit is written only when the row moved. A replay finds no open row (`kept` is not open) or loses the compare-and-set. Tested with the real port over a fake store in `planSubscriptionMirror.test.ts` |
| c | Mirror deps built in one place | Yes. Production `PlanSubscriptionMirrorDeps` exist only in `planBillingHandler.ts`'s port list; the wrap is applied there (IN-2 keeps the same-deps-object pin). `routerPlacement`, `planReconcilePass.guard` and `afterPlanMove.guard` are green |
| d | Plain reactivate refusal while a closure is open | Yes. Own code `deletion_pending`, own server message ("Your account is set to be deleted. Keep your account first."), 409; an unreadable closure refuses as `billing_row_unreadable` with no Stripe call. The client copy is a placeholder until DL-2 (CR-10) |
| e | No `.snap` changed | Confirmed |

### Ruling on IN-1 (the mirror keep is logged, not retried)

**Accepted for D6.** The request route is behind the switch, which is off in every environment and stays off until DL-5. So no `pending` row can exist anywhere, and the gap cannot be reached. PLAN PAYMENTS' reason holds: a webhook retry for a DELETE fault would hold up their mirror. Risk K-2 already needed DL-3's re-check, and IN-1 widens the same gap rather than opening a new one.

**DL-3 obligation (binding; DL-5 must not switch on until it is met and tested):**

- **(a) Re-check `pending` rows against Stripe.** DL-3's pass over every `pending` row reads the subscription fresh from Stripe, through the subscription id on our billing row. The row is kept when the plan renews this period. "Renews" means: status `active` or `trialing`, not ended, and `isSetToEndThisPeriod` false. Kept means: `pending → kept` by compare-and-set, `kept_source = 'stripe'`, and `ACCOUNT_DELETION_KEPT` with `source: 'stripe'`, no `user_id`, no `actor_id` and no request context. Reuse `keepClosureAfterStripeReactivation` so the mirror and the pass share one implementation.
- **(b) Settle `requesting` rows.** After the 15-minute settle, a fresh Stripe read moves each `requesting` row to `pending` when the plan is set to end this period, or deletes it. This covers P-7, P-8, P-9 and a failed withdrawal.
- **(c) Bounded cadence.** A `pending` row is revisited at least daily until its plan ends, even after the "Deletion requested" email has slept it. That bounds "a pending row on a renewing plan" to one day, not the rest of the paid period.
- **(d) Alert.** The alert `bos_closure_stripe_keep_failed` stays, and DL-3's runbook names it.

### Hunks in PLAN PAYMENTS-owned files (for PLAN PAYMENTS' SA)

Listed in the review reply to TL.

### Code Approved for QA

**Yes, on condition that CR-1 is fixed first.** CR-1 is two hunks and two assertions; SA re-checks only that diff. CR-2 and CR-3 are documentation and can land in the same pass. Every NOTE is optional or belongs to DL-2 / DL-3 as named.

### Re-check — 2026-11-05

**Status: ✅ APPROVED — Code Approved for QA: Yes.** SA re-checked only the fix diffs, in code:

| # | Result |
|---|---|
| CR-1 | Fixed. `delete/route.ts` `shared` has no `request` (REQUESTED, GRACE_STARTED); the owner KEPT row in `keep/route.ts` has none. REFUSED, CANCELLED and REACTIVATED still carry it. The route tests assert both sides (`not.toHaveProperty('request')` on the surviving rows, `toHaveProperty('request')` on the others) |
| CR-2 | Fixed. The requirement's §6.3 as-built note carries DL-3 obligations (a) to (d), binding before DL-5, plus a Change History row |
| CR-3 | Fixed. §4.2 R-12, §7 bullet 4 and §12 G-3 are struck through, with the replacement text |
| CR-4 | Fixed as PLAN PAYMENTS ruled. `ORIGIN_ACTION` (`deletion_request` with cancel, `deletion_keep` with reactivate, `owner` either) is checked first in `managePlanSubscription`, before any switch, read or Stripe call; a mismatch logs at error with `alert: true` and answers `manage_unavailable`. Tested in `planSubscriptionManage.origin.d6.test.ts` |
| CR-5 | Fixed. `readDeletionPending` builds the shared repository inside the `try`; a test covers a constructor throw |
| `connectExitGuard.test.ts` | The fake check outcome now carries `rows`, `verdictBlocked`, `resolvedThisLogin`; test-only |

SA re-run: account-deletion, both account routes, every `planSubscriptionManage*` and `planCancel*` suite, the plan routes and `oneDontRenewPath`: 49 suites, 1,546 / 1,546. The Dev's filtered `tsc` (0 errors in the 74 touched files) was not re-run by SA. The NOTEs CR-6 to CR-12 stand as recorded for DL-2, DL-3 and TL.

---

## Change History

| Date | Change | Details |
|---|---|---|
| 2026-11-04 | Workplan written (Dev) | D6 / DL-1b on `feature/bos-deletion-dl1b-request-keep` from `0eb3949e`. As-is findings with line refs; the P-7a C-3 follow-up (derived flag in the mirror) has already landed; the DL-1a claim excludes `kept` rows (Q-9). Design: request route two-phase write with every engine outcome mapped, free path straight to `grace` with the lock date, keep route row-first, engine `origin` (no immediate end for a request, plain reactivate refused while open), mirror C-3 port, checkout and Boost refusal through one closure reader, XC-5 filter, three survivable audit events, family-6 guard. No migration, no regeneration, no email, switch off. 16 tasks, 2.5 d. Q-1 to Q-15 for SA |
| 2026-11-04 | SA workplan review (SA) | Approved with conditions W-1 to W-14, verified on `origin/main` `0eb3949e`. High: W-1 (engine step 7 counts a `cancel_at` later than the period end as "set to end", so a request could go `pending` on a plan that renews; use `isSetToEndThisPeriod` for `deletion_request`), W-2 (no `next_check_at` at `pending`, or DL-3 cannot send "Deletion requested" at stage A), W-4 (classify blockers from the raw guard rows: the runner turns "G-12 only" into `unknown`). Item 7: `receiptInput.ts` is DELETE's (§11 B.1, B.8, S-3), `findDeletionFacts` is EXPORT's; §3.6 is stale. Item 8 / Q-9 confirmed; DL-3 widens the one claim in its own migration. Q-1 to Q-15 ruled; two business questions for the user (trialing request, BQ-32). Section "SA Workplan Review — 2026-11-04" added; nothing else edited |
| 2026-11-04 | User decisions recorded (TL) | Q-1 trialing accepted; BQ-32 yes, reasonCode required. |
| 2026-11-04 | Implemented (Dev) | Tasks 1 to 15 done, uncommitted, on the W-1 to W-14 conditions and the TL relay of the PLAN PAYMENTS review (closure keep never fails the mirror; replay-safe; one wiring point; distinct `deletion_pending`). "Implementation notes" section added with deviations IN-1 to IN-12 and the verification runs. Task 16 (SA code review) open |
| 2026-11-04 | SA code review (SA) | Approved with fixes. W-1 to W-14 checked in code; SA re-ran the key suites (1,340 + 429 + 759 green) and confirmed the invariant test drives the real engine and can fail. MUST-FIX CR-1: the three audit rows that must survive E are written with the request, so the owner's IP and user agent outlive erasure; drop `request` on those three only. SHOULD-FIX CR-2 (DL-3 obligation into the requirement's as-built note) and CR-3 (three stale workplan body lines). IN-1 accepted for D6 with a binding DL-3 obligation (re-check pending rows against Stripe, settle requesting rows, daily cadence) before DL-5. PLAN PAYMENTS' five points met. Section "SA Code Review — 2026-11-04" added; nothing else edited |
| 2026-11-05 | SA code review fixes (Dev) | CR-1: `request` dropped from the three surviving rows (REQUESTED, GRACE_STARTED, owner KEPT), kept on REFUSED and the money rows; route tests assert it both ways. CR-2: the DL-3 obligation (a) to (d), before DL-5, added to the requirement's DL-1b as-built note. CR-3: §4.2 R-12, §7 bullet 4 and §12 G-3 marked superseded by W-2 / W-3, IN-1 and W-7. CR-5: `readDeletionPending` builds the shared repository inside its `try`, with a test. CR-4 per the PLAN PAYMENTS ruling (relayed by TL): `managePlanSubscription` refuses a deletion origin paired with the other action as `manage_unavailable` (error + alert) before any read, with one test per pairing. `connectExitGuard.test.ts` given the three new check fields (a type error the first filtered typecheck missed: it filtered the touched files only). Still uncommitted |
| 2026-11-05 | QA (QA) | PASS WITH NOTES. Every §7 DL-1b criterion, the user decisions (`trialing`, required `reasonCode`) and CR-1 / CR-4 / CR-5 checked against named tests; the Stripe-side keep is replay-safe and never fails the mirror. Runs: targeted 59 suites 2,185 green; broad 926 / 929 suites (3 CRLF source-scan failures in untouched files, not D6); `test:bos-entitlements` 346 suites / 10,057 green; webhook harness green, no `.snap` changed; `tsc` 0 errors in touched files. No bug. Edge cases: lock date one hour early in midnight-DST zones (shared date helper, Low), zone-name case stored as given (Low), spring-forward not pinned in `closureDates.test.ts`. Manual browser check not possible (backend-only, switch off); the §15 manual check moves to switch-on. "QA Testing Report" section filled; nothing else edited |
