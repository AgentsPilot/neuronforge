# Requirement: Business OS — Account Deletion Lifecycle (request, grace, lock, delete), Keep My Account, Cancel Plan

> **Last Updated**: 2026-10-25

**Created by:** BA
**Date:** 2026-10-25
**Status:** Draft (split scope). The parent requirement was approved by SA with conditions XC-1 to XC-21 on 2026-10-25. This file is not Approved on its own: the business questions in §9 still need the user's answers, and TL or the user must sign off on the split.
**Parent / index:** [BUSINESS_OS_SELF_SERVICE_EXIT_REQUIREMENT.md](/docs/requirements/BUSINESS_OS_SELF_SERVICE_EXIT_REQUIREMENT.md) (v2 + `## SA Review — 2026-10-25`, binding). Where this file and the parent disagree, the parent's SA review wins and this file gets fixed.
**Sibling scope:** [BUSINESS_OS_EXPORT_REDESIGN_REQUIREMENT.md](/docs/requirements/BUSINESS_OS_EXPORT_REDESIGN_REQUIREMENT.md) (EXPORT: per-module emailed export). A separate Claude session builds it at the same time. See §11 for the boundary.
**Source brief:** [BUSINESS_OS_SELF_SERVICE_EXIT_BRIEF_V2.md](/docs/requirements/BUSINESS_OS_SELF_SERVICE_EXIT_BRIEF_V2.md) items 1–3, TL notes R-1 to R-4.
**Related:** [BUSINESS_OS_DATA_EXPORT_DE10B_REQUIREMENT.md](/docs/requirements/BUSINESS_OS_DATA_EXPORT_DE10B_REQUIREMENT.md) (deletion design, guards G-4/G-6/G-8/G-9, UD-6) · [BUSINESS_OS_SUBSCRIPTION_ENTITLEMENTS_REQUIREMENT.md](/docs/requirements/BUSINESS_OS_SUBSCRIPTION_ENTITLEMENTS_REQUIREMENT.md) §9 · plan-payments P-7a (C-1)

---

## Overview

A Business OS owner can ask for their account to be deleted, keep using what they paid for until the period ends, get 14 days of grace to export, and then be locked out until an admin runs the existing "close and anonymise". Until the lock they can press **"Keep my account"**; after the lock only support can unlock. The same scope adds a plain **"Cancel plan"** (stop renewing at the period end, with "Keep my plan"), because cancel and deletion stage A share one "don't renew" engine. The immediate self-delete merged in PR #503 (off) is reworked into this lifecycle.

---

## Table of Contents

1. [Scope](#1-scope)
2. [User stories](#2-user-stories)
3. [Deletion lifecycle A to E](#3-deletion-lifecycle-a-to-e)
4. [Keep my account (reinstatement)](#4-keep-my-account-reinstatement)
5. [Cancel the plan at period end](#5-cancel-the-plan-at-period-end)
6. [Delivery slices and effort](#6-delivery-slices-and-effort)
7. [Acceptance criteria](#7-acceptance-criteria)
8. [Scenarios](#8-scenarios)
9. [Business questions for this scope](#9-business-questions-for-this-scope)
10. [SA conditions that apply](#10-sa-conditions-that-apply)
11. [Boundary and coordination with the other scope](#11-boundary-and-coordination-with-the-other-scope)
12. [Non-functional requirements](#12-non-functional-requirements)
13. [Out of scope / future roadmap](#13-out-of-scope--future-roadmap)
14. [Notes on integration points](#14-notes-on-integration-points)
15. [Change History](#change-history)

---

## 1. Scope

| In scope (DELETE) | Not in this scope |
|---|---|
| Plan cancel / keep engine, drawer, emails (SX-1, SX-2, SX-3) | Per-module export, its drawer, worker, history (EXPORT) |
| Stripe Connect fixes that feed the blockers (SX-5) | ZIP retirement and the DE-8a table drop (EXPORT MX-6, MX-7) |
| Closure table, claim RPC, session-cut function, descriptor, cleanup regeneration (DL-1a) | Receipt export facts (`findDeletionFacts`): EXPORT, XC-12. `receiptInput.ts` is DELETE's (SR-1, 2026-10-25) |
| Request and keep routes, two-phase write, checkout / Boost refusal while pending, mirror reactivation (DL-1b) | Admin "Send export to owner" (EXPORT MX-5) |
| Deletion drawer (links to the export drawer), banner, plan card, Keep screens (DL-2) | |
| Lifecycle job and emails (DL-3) | |
| Lock, admin Unlock, banned-login copy (DL-4) | |
| Public website and booking offline at the lock (DL-4b, if BQ-23 yes) | |
| Ready-to-delete list, admin E route reading the stored request, switch on (DL-5) | |
| LX-1 was built in this session before the split; it now belongs to EXPORT (§11 B.4) | |

---

## 2. User stories

**Delete**
- As an **owner**, I want to ask for my account to be deleted myself, so that I do not have to email anyone.
- As an **owner on a paid plan**, I want to keep everything I paid for until the period ends, then have time to take my data.
- As an **owner**, I want clear emails with the dates, so that I know when I can no longer sign in.

**Keep**
- As an **owner who changed my mind**, I want one button, "Keep my account", so that nothing is lost.
- As an **owner whose account is locked**, I want support to be able to open it again before it is deleted.

**Cancel**
- As an **owner on a paid plan**, I want to stop it renewing, see what I lose, and undo it until the end date.

**Admin / product**
- As an **admin**, I want a list of locked accounts ready to delete, with what blocks each one.
- As the **product owner**, I want every request, keep, lock, unlock and delete in the audit trail, and the deletion rows to survive the delete.

---

## 3. Deletion lifecycle A to E

### 3.1 The stages

| Stage | Starts | What the owner has | Email (login email, owner's language) |
|---|---|---|---|
| **A. Request** | Owner confirms in the deletion drawer | Everything as normal. A paid plan is set **not to renew** (same engine as §5) | **"Deletion requested"**: the plan runs to {date}, then 14 days to export, then the account closes on {lock date}. "Keep my account" link |
| **B. Rest of the paid period** (paid only) | At once | The full plan | — |
| **C. 14-day grace** | When the paid period ends (Stripe `ended_at`); at once for an account with no paid plan | What the account normally has once a plan ends (BQ-20, §3.2). Can always sign in, view and **export** | **"Your plan has ended. Your account closes on {lock date}"** at the start of C (paid only). **Reminder 3 days before the lock** |
| **D. Locked** | Start of local day 15 of C in `user_preferences.timezone` (UTC when NULL), fixed when C starts (XC-4, BQ-24) | Cannot sign in | **"Your account is closed"**, accepted by Resend **before** the lock |
| **E. Deleted** | An admin runs "close and anonymise" from the ready list on `/admin/users` | — | None. No undo (UD-6). The email can sign up again |

### 3.2 What the account has in stage C (R-3, BQ-20)

There is no free tier. Suggested meaning: what the account would normally have once its plan ends, with no new level built.

| Account | During the 14 days |
|---|---|
| Founding Partner cohort still running | Keeps its free Founding Partner access |
| Everyone else | Today's rule: 5 days read-only (website still up, with a warning), then paused (website and new bookings stop). Data is kept |
| Already lapsed or paused when they asked | Stays as it is |
| **In every case** | Can sign in, see everything and **export** (entitlements §9 "view and export only"; export is never gated, XC-19) |

Enforcement is off (`shadow`, K-2), so nothing is actually limited today. Copy states the configured rule (SA-15). Emails never say "free tier".

### 3.3 The request (stage A)

- **Where:** Settings → Danger Zone → "Delete my account" opens the deletion drawer.
- **Steps:**
  1. **Before you go:** "Export your data first" with a button that opens the **export drawer owned by EXPORT** (§11 S-4). One line: "Client documents are not in the export. Download them one by one from each client's record."
  2. **Why are you leaving?** The same reason list as the plan cancel (BQ-7), required, list only, no free text (C-10, BQ-17, BQ-32).
  3. **What happens:** the dates for this account, worked out on the server. A free account sees only the 14-day line. Number of future client bookings after the lock date, with "tell your clients" (BQ-39).
  4. **Blockers** (XC-5, BQ-21): `runAccountDeletionCheck` filtered: G-8 (Stripe Connect), G-9 (money in flight), G-4 (admin login: "contact support") and a failed last payment from our billing row (BQ-11) block, with where to fix each, and **no confirm box**. G-6 and G-12 are ignored; engineering guards do not block. The route's "available on this deployment" gate stays.
  5. **Confirm:** the typed sentence, checked on the server in en/he/es: *"I have exported my data and downloaded my documents"*. Rate limit, session user only, fails closed.
- **On confirm** (XC-2): closure row inserted as `requesting` with `renewal_was_on` from our billing row → Stripe "don't renew" (fresh key, C-4) → mirror compare-and-set → row to `pending`; "Deletion requested" email; audit row that survives deletion (XC-13).
- **The immediate delete of DE-10b.2 is removed** from the owner path (XC-6). The only delete is stage E.

### 3.4 While deletion is pending (A to C)

- A **banner on every Business OS page**: "Your account closes on {lock date}. [Keep my account]".
- The plan card reads "Ends on {date}. Your account is set to close." No separate "Keep my plan".
- **Buying a plan or a Boost is refused:** "Keep your account first" (BQ-18, BQ-34). The refusal reads the closure repository; it is not an entitlements gate (XC-19).
- No other freeze (DE-10b R-5). If the owner creates money in flight or reconnects Stripe, the lock waits (§3.5).

### 3.5 The lock (stage D)

- The hourly lifecycle job (:50, claim pattern) finds rows whose `lock_at` has passed.
- It **re-runs the blocker check** (XC-5). If something the owner can fix blocks (BQ-22): no lock, one "We can't close your account yet: {what to fix}" email, the row stays in C, re-checked each run, the ready list shows "blocked".
- If clear: send "Your account is closed" (Resend must accept it; if refused, retried hourly, BQ-41), then lock: 10-year GoTrue ban + session cut (XC-3), then `locked_at` and an audit row.
- The login page maps the banned error to "This account is closed. Contact {support address}".
- **Public website and booking go offline at the lock** if BQ-23 is yes (DL-4b, XC-14); client links already sent show "no longer available online".
- The account appears on the admin **ready to delete** list.

### 3.6 The final delete (stage E)

- `/admin/users` ready list: locked accounts, lock date, days since lock (overdue in red after 7 days, BQ-40), blocked yes/no (owner-fixable or "engineering").
- A new `requireAdmin` E route reads the user id from the path, then the closure row **on the server** (stored request time, statement language), never from the body (XC-6, F-6). It runs the existing engine with `origin: 'admin'`, `reason_category: 'customer_asked'`, `requested_at` = stored time, statement rebuilt from the stored language (SA-8). Guards G-4, G-6, G-8, G-9 apply unchanged.
- The receipt is built by `buildOwnerReceipt` with export facts from `findDeletionFacts`, both **owned by EXPORT** (§11 S-3); DELETE calls them only.
- A refused run shows the reason. The account stays locked.
- **At E the engine deletes the closure row** (XC-1). The deletion receipt and the surviving audit rows are the record.

---

## 4. Keep my account (reinstatement)

| Stage | How | Result |
|---|---|---|
| A, B | "Keep my account" in Settings, the banner, or the email link (opens Settings; signs nobody in) | Row to `kept` first, then Stripe renew **only if** `renewal_was_on` (XC-2). An owner who had cancelled the plan before stays cancelled (BQ-33) |
| C | Same button | Request cancelled. Account stays in its after-plan state. Can buy a plan through the normal path |
| D | Support only: admin "Unlock" on the ready list | Ban cleared (`ban_duration: 'none'`), request cancelled, after-plan state, website back if it went offline. Refused when the login is already a tombstone (XC-3) |
| E | Never | Fresh signup with the same email; nothing restored |

- Every keep sends **"Your account is kept"** and writes `ACCOUNT_DELETION_KEPT` with `details.source` owner / admin / stripe.
- **Operator reactivates the plan in Stripe during B** (C-3, BQ-38): the mirror cancels the request in the same update; "kept" email.
- **Operator cancels at once during B:** stage C starts at that moment.
- If the Keep's Stripe renew fails: an honest "Ends on {date} [Keep my plan]" card and an error, never a renewing plan with an open request (XC-2).

---

## 5. Cancel the plan at period end

Carried from the parent §6 with SA rulings SA-1, SA-2, SA-3, SA-5, C-4, C-9.

- Settings → Plan → **"Cancel plan"** (quiet link) opens a drawer: **reason** (list only, BQ-7 / BQ-17) → **what changes** (back to Founding Partner, or features you'll lose from `planComparison.ts` plus the read-only-then-paused sentence, computed by `planEndingView`, built in SX-2 inside the entitlements module, XC-19) → **review** ("Last day {date}", "You will not be charged again", "No refund for the current month", link to Export data) → **confirm**.
- Stripe: cancel at period end, never at once. Card: "Ends on {date}. It will not renew." with **"Keep my plan"** until that date.
- No offer to stay.
- Refused: failed last payment, upgrade waiting for card confirmation, `trialing` (SA-2), already ended, no Stripe subscription (cohort or admin-given access).
- Emails: "Plan cancelled", "Plan kept", reminder 3 days before the plan ends (BQ-36).
- At period end nothing is deleted. The account follows the after-plan rule (§3.2).

**Side by side in Settings:**

| Place | Shows |
|---|---|
| Plan section | "Cancel plan". While a deletion is pending: "Ends on {date}. Your account is set to close", no own undo |
| Danger Zone | "Delete my account". While pending: "Your account closes on {date}" + "Keep my account" |
| Banner | Only while a deletion is pending |

One engine sets and clears "don't renew" for both (SX-1). The deletion flow calls it; it does not copy it.

---

## 6. Delivery slices and effort

Each slice is its own PR from `main`, never stacked, at most 2.5 days. A slice with a migration is a manual prod gate. The user sees the diff before commit unless a fast-track is agreed for this stream. Effort is SA's XC-17 numbers.

### 6.1 Done before the split (in this session)

| # | Slice | Status |
|---|---|---|
| LX-1 | CRM / Orders list export safety fix (XC-18) | Being built on `fix/crm-export-safety-lx1`; merged before the split. Afterwards the code is owned by EXPORT. Not counted below |

### 6.2 Plan cancel track

| # | Slice | Delivers | Depends on | Migration | Effort |
|---|---|---|---|---|---|
| **SX-1** | Cancel and keep engine | `StripeService.setBusinessOsPlanCancelAtPeriodEnd`, `planCancellation.ts` (in the `planUpgrade.ts` shape), routes `…/plan/cancel` and `…/plan/keep`, SA-2 eligibility, fresh attempt key (C-4), mirror write (SA-3), audit, `isPlanSelfCancelEnabled()` off + `FEATURE_FLAGS.md` row | — | — | 🟡 2.5 d |
| **SX-2** | Cancel drawer | Builds `planEndingView` in `lib/business-os/entitlements/` with registrations (XC-19); reason, what changes, review, confirm; en/he/es | SX-1 | — | 🟡 2.5 d |
| **SX-3** | Cancel emails, switch on | Cancelled, kept, 3-day reminder (BQ-36); R-3 refusal text in `adminDeletionRefusals.ts`; P-7a note (C-1); switch on | SX-2 | — | 🟢 1.5 d |
| **SX-5** | Stripe Connect fixes | C-5: delete only on Stripe's confirmed deletion, OAuth deauthorize for Standard, D-2 refusal via the check (SA-14), G-8 wording | — | only if needed | 🟡 2 d |

**SX-1 as built (D2, 2026-10-26; [D2 workplan](/docs/workplans/BUSINESS_OS_D2_PLAN_CANCEL_ENGINE_WORKPLAN.md), SA workplan review W-1 to W-12).** Plan payments P-7a.1 (PR #519) had already shipped the engine, so SX-1 extends it rather than building a second one (SX C-1). Names as on `main` (SA Q-2): `StripeService.setBusinessOsCancelAtPeriodEnd`, `lib/business-os/billing/planSubscriptionManage.ts` (`managePlanSubscription`), routes `/api/business-os/billing/plan/cancel` and `/plan/reactivate`. There is no `/plan/keep`: "Keep my plan" is D3's label over `/plan/reactivate`. `trialing` stays manageable for the plain cancel (P-7a TQ-14, SA Q-1), which amends §5 "Refused: … `trialing`" and the §7 AC; D6 rules `trialing` for the deletion request separately. **`isPlanSelfCancelEnabled()` is superseded for the plan cancel** by plan-payments P-7a C-1 / BQ-1 (2026-10-26): cancel follows `BUSINESS_OS_PLAN_PRICES_ENABLED` only. XC-15 and the SR-10 anchor row for it no longer apply to the cancel (SA W-1). BA carries this into §11 of both files at the next joint splice; §11 is not edited here. D2 adds: a fresh Stripe idempotency key per attempt (SX C-4, never logged); `change_pending` (a `pending_tier` or an unexpired open checkout) refusing the cancel side only (SA-2, W-3); an optional `reasonCode` from `planLeaveReasons.ts` (BQ-7 TL default) in `details.reasonCode` of the existing P-7a audit key `BOS_BILLING_SUBSCRIPTION_CANCELLED` (SA-16 names not used, Q-4); and `oneDontRenewPath.guard.test.ts`, which makes D6 call the engine. `origin` moves to **D6 (DL-1b)** (W-5), and so does **SX C-3** (the mirror clears a pending deletion on a Stripe-side reactivation). D6's detection must read `cancel_at` as well as `cancel_at_period_end`, because P-7a's open C-3 follow-up says the webhook mirrors only the flag (Q-10). **BQ-11** now covers only the deletion request: for the plain cancel, the user's P-7a BQ-3 ("Ends now", P-7a.4) applies.

### 6.3 Deletion track

| # | Slice | Delivers | Depends on | Migration | Effort |
|---|---|---|---|---|---|
| **DL-1a** | Closure schema | Migration: `business_os_account_closures` (XC-1), claim RPC (`FOR UPDATE SKIP LOCKED`), session-cut `SECURITY DEFINER` function (service-role only, `REVOKE`d; first task a spike on whether GoTrue revokes sessions on ban, XC-3); closure repository and auth-admin lock seam; descriptor `export: exclude`; **cleanup function regenerated in the same PR** (XC-11, serialised, §11 S-1) | — | ✅ manual gate | 🟡 2 d |
| **DL-1b** | Request and keep routes | `account/delete` becomes the request route (XC-6 kept/removed list); two-phase write (XC-2); blockers at A (XC-5); keep route (A–C); checkout and Boost refusal while pending (closure repository); mirror clears the request on a dashboard reactivation (C-3); `no-deletion-paths.guard.test.ts` extended; audit rows that survive E; switch still off | DL-1a, SX-1 | — | 🟡 2.5 d |
| **DL-2** | Deletion drawer + keep screens | Drawer steps (§3.3) with the export link (S-4); future-bookings count (BQ-39); banner on every page; plan card wording; "Keep my account" in Settings; `/account-deleted` re-worded; privacy paragraph re-worded; en/he/es | DL-1b, SX-2 (`planEndingView`), SX-5 (blocker wording); soft: EXPORT MX-1b | — | 🟡 2 d |
| **DL-3** | Lifecycle job + emails | Hourly :50 cron on the claim pattern (lease 90 s, `maxDuration = 60`, reaper first): settle `requesting` older than 15 min from a fresh Stripe read; start C at `ended_at` (fresh Stripe read if 24 h late); fix `lock_at`; C-start email; 3-day reminder; "Deletion requested" and "Account kept" emails; each exactly once (claim + Resend idempotency key `closure:{id}:{email}` + `*_sent_at`; idempotency key per §11 S-10). Runs whatever the switch says | DL-1b | — | 🟡 2.5 d |
| **DL-4** | Lock + admin unlock | Blocker re-check at the lock (BQ-22); "closed" email first, retried hourly (BQ-41); 10-year ban + session cut; banned-login copy; admin "Unlock" (`requireAdmin`, authz registry, tombstone refusal) | DL-3 | — | 🟡 2.5 d |
| **DL-4b** | Website offline at the lock (if BQ-23 yes) | `isAccountClosedToPublic(userId)` at the four XC-14 call sites; `siteCache` revalidated at lock and unlock; source-scan test of the four sites; "no longer available online" for client links | DL-4 | — | 🟢 1.5 d |
| **DL-5** | Ready list, E route, switch on | `/admin/users` ready list (locked, blocked owner / engineering, days since lock, overdue red); new `requireAdmin` E route reading the closure row on the server (XC-6); receipt via EXPORT's `buildOwnerReceipt` / `findDeletionFacts` (read-only); QA; `DELETION_RECEIPT_FINGERPRINT_KEY` checked (C-12); switch `isAccountSelfDeleteEnabled()` on **only after EXPORT MX-4 is switched on** | DL-4 (+ DL-4b if built); **EXPORT MX-4 live** | — | 🟡 2 d |

**Totals:** cancel track **8.5 d** (SX-1 2.5 · SX-2 2.5 · SX-3 1.5 · SX-5 2); deletion track **13.5 d** (DL-1a 2 · DL-1b 2.5 · DL-2 2 · DL-3 2.5 · DL-4 2.5 · DL-5 2); website offline **+1.5 d** (DL-4b). **This scope: 22 working days, 23.5 with the website-offline step.** Plain cancel is live after SX-3; deletion is live after DL-5. Manual prod gates: DL-1a (and SX-5 only if it needs a migration).

**Suggested order:** SX-1 → SX-2 → SX-3 (cancel live), with SX-5 and DL-1a in parallel → DL-1b → DL-2 → DL-3 → DL-4 → DL-4b → DL-5 (switch on after EXPORT MX-4).

**Ops gates before switch-on (not builds):** `agentspilot.ai` verified in Resend and `RESEND_FROM_EMAIL` set (before SX-3); support address `notifications@agentspilot.ai` replaces the personal Gmail and is used in the banned-login copy (before SX-3 / DL-4); `DELETION_RECEIPT_FINGERPRINT_KEY` set in Vercel and checked with one deletion-check call (before DL-5).

---

## 7. Acceptance criteria

**All slices:** integration tests for happy path, auth failure and invalid input; session user only; Zod `.strict()`; Pino with `correlationId`, ids and codes only; no added CI time; QA records a manual check of the critical path.

**SX-1 to SX-3, SX-5** (v1 §10.1 with C-1, C-4, C-5, SA-2)
- [ ] Cancel sets cancel-at-period-end in Stripe and our row from Stripe's answer; Keep my plan clears it; a fresh idempotency key per attempt.
- [ ] Refused for `trialing`, failed payment, pending upgrade, ended plan, no Stripe subscription.
- [ ] The engine is called by DL-1b; there is one "don't renew" code path.
- [ ] The 3-day reminder is sent once, only while the plan is still set to end.
- [ ] Connect delete clears G-8 only on Stripe's confirmed deletion; Standard accounts are deauthorized.

**DL-1a**
- [ ] The closure table is server-write-only (RLS on, no anon or authenticated policy, repository only); partial unique "one open row per user".
- [ ] The session-cut function is callable by service role only; or the spike proves GoTrue revokes on ban and it is dropped.
- [ ] The regenerated cleanup function passes the drift test; applied to prod and merged back to back; checker run.

**DL-1b**
- [ ] With the switch off, the request route answers 404; Keep and the job still work for an existing open row.
- [ ] A paid account's request sets Stripe to not renew and moves the row to `pending`; a free account's request starts C at once.
- [ ] A Stripe failure deletes the `requesting` row; never a `pending` row on a renewing plan (invariant test).
- [ ] Blockers at A refuse with where to fix them; G-6 and G-12 do not block; engineering guards do not block.
- [ ] The typed sentence is checked on the server in all three languages; wrong text is refused.
- [ ] Keep in A/B restores renewal only if `renewal_was_on`.
- [ ] Buying a plan or a Boost is refused while pending.
- [ ] An operator reactivation in Stripe cancels the request with source `stripe`.
- [ ] No file under `app/api/business-os/**` imports `runAccountAnonymise` or `runSelfAccountAnonymise` (guard). Nothing is deleted by this route.

**DL-2**
- [ ] The drawer shows the right dates for paid, free and Founding Partner accounts, in the owner's timezone, and the future-bookings count.
- [ ] "Export your data first" opens the export drawer (or today's "Download my data" before EXPORT MX-1b).
- [ ] The banner shows on every Business OS page while pending, and goes after Keep.
- [ ] Hebrew is right-to-left; keyboard only works end to end.

**DL-3**
- [ ] Stage C starts when Stripe reports the plan ended, or from a fresh Stripe read 24 h after `current_period_end`; the C email is sent once.
- [ ] `lock_at` is the start of local day 15, fixed at C start; a later timezone change does not move it.
- [ ] The reminder is sent once, 3 days before the lock; not after a Keep.
- [ ] A killed run never sends an email twice.

**DL-4**
- [ ] At the lock time the "closed" email is accepted first, then sign-in fails, including for an open session (within about 30 s, F-3).
- [ ] A refused "closed" email delays the lock and is retried hourly (per BQ-41's answer).
- [ ] With an owner-fixable blocker, no lock; one email; the ready list shows "blocked".
- [ ] Admin Unlock restores sign-in and cancels the request; it is audited; it refuses on a tombstone.

**DL-4b**
- [ ] A locked account's site, book and contact pages, booking create and contact form answer "no longer available online"; Unlock brings them back.

**DL-5**
- [ ] The ready list shows only locked accounts; the E route uses the stored request time and language read on the server; guards still refuse when they should.
- [ ] After E: the closure row is gone, the deletion audit rows survive, the email can sign up again, nothing is restored.
- [ ] The switch is on only after EXPORT MX-4 is on.

---

## 8. Scenarios

Essentials plan renewing on the 28th, request on the 10th, owner timezone Asia/Jerusalem.

### 8.1 Paid account

| # | Situation | Expected |
|---|---|---|
| P-1 | Requests on the 10th, no blockers | A: not renewing; email with dates. B: full plan to the 28th. C from the 28th: after-plan rule, export works. Reminder 3 days before the lock. D: "closed" email, lock at the start of local day 15. E: admin deletes |
| P-2 | Keeps on the 12th (A/B) | Request cancelled; plan renews on the 28th; "kept" email; banner gone |
| P-3 | Keeps during C | Request cancelled; after-plan state; can buy a plan |
| P-4 | Writes to support after the lock | Admin unlocks; sign-in works; website back if it went offline |
| P-5 | Signs up again after E | Fresh account; nothing restored |
| P-6 | Cancelled the plan on the 3rd, requests deletion on the 10th, keeps on the 12th | Request cancelled; the plan **stays** cancelled (BQ-33) |
| P-7 | Tries to buy a Boost while pending | "Keep your account first" |
| P-8 | Stripe Connect linked | Blocked at A with where to fix it; no confirm box |
| P-9 | Starts a client payment plan during C | Allowed. At the lock: no lock, one email, ready list "blocked"; re-checked |
| P-10 | Last payment failed | "Update your card, or contact support"; no request |
| P-11 | Operator reactivates the plan in Stripe on the 20th | Mirror cancels the request; "kept" email |
| P-12 | Founding Partner who also bought Autopilot | C keeps Founding Partner access for the 14 days; then locked |

### 8.2 Free account

| # | Situation | Expected |
|---|---|---|
| F-1 | Requests on the 10th | A and C start together; lock at the start of local day 15; reminder 3 days before |
| F-2 | Keeps during C | Request cancelled; "kept" email |
| F-3 | Locked, asks support | Admin unlocks |
| F-4 | Already paused when asking | Stays paused; can sign in and export for the 14 days |

---

## 9. Business questions for this scope

Plain language; each has a suggested answer. **Bold = needed before the slice it names.** "Shared" = also listed in the EXPORT file; one answer serves both.

### 9.1 From v2 and the SA review

- [ ] **BQ-20 There is no free tier. What does the account have during the 14 days, and after a plain cancel?** **Suggestion: (a)** what it normally has once a plan ends. (status: pending user input; **before SX-2 and DL-2**)
- [ ] **BQ-21 Block the request at once if Stripe is connected or money is in flight?** (open issue 3) **Suggestion: yes.** (status: pending user input; **before DL-1b**)
- [ ] **BQ-22 If money in flight appears during the 14 days, what happens at the lock date?** **Suggestion:** don't lock; email once; check again; admin sees "blocked". (**before DL-4**)
- [ ] **BQ-23 Public website and booking pages offline at the lock?** **Suggestion: yes** (DL-4b, 1.5 d). (**before DL-4**)
- [ ] **BQ-24 When exactly does day 14 end?** **Suggestion (as ruled by SA, XC-4):** the start of day 15 in the owner's timezone (UTC if not set), fixed when the 14 days start. (before DL-3)
- [ ] **BQ-32 A reason picker in the deletion drawer too?** **Suggestion:** yes, the same list as cancel, list only. (before DL-2)
- [ ] **BQ-33 Owner cancelled earlier, then asked for deletion, then keeps. Does the plan renew?** **Suggestion:** no. (before DL-1b)
- [ ] **BQ-34 Boost credits while deletion is pending?** **Suggestion:** no, "Keep your account first". (before DL-1b)
- [ ] **BQ-35 (shared) Files reversal, confirm the record.** **Suggestion:** confirm; the deletion drawer says documents are downloaded one by one; the typed sentence stays "I have exported my data and downloaded my documents". (before DL-2)
- [ ] **BQ-36 Reminder 3 days before a cancelled plan ends?** **Suggestion:** yes. (before SX-3)
- [ ] **BQ-38 Operator reactivates the plan in Stripe while deletion is pending = "Keep my account"?** **Suggestion:** yes, with the "kept" email. (before DL-1b)
- [ ] **BQ-39 Clients' future bookings when the account closes.** **Suggestion:** the deletion screen and the 3-day reminder show how many future bookings there are and the owner tells their clients; we do not cancel or email clients; client links show "no longer available online". (raised by: SA; **before DL-2**)
- [ ] **BQ-40 How long until the final delete.** **Suggestion:** we commit to running it within 7 days of the lock; the admin list shows overdue accounts in red; legal confirms the total time. (raised by: SA; **before DL-5**)
- [ ] **BQ-41 If the "your account is closed" email cannot be delivered, do we still close the account?** **Suggestion:** try every hour for 24 hours, then close anyway and mark it on the admin list. Note: SA's XC-4 currently says "retried hourly and the lock waits"; the answer sets the cap. (raised by: SA; **before DL-4**)

### 9.2 Carried from v1, still open

- [ ] **BQ-7 The reason list.** **Suggestion:** Too expensive · Not using it enough · Missing a feature I need · Moving to another tool · My business is closing or pausing · Technical problems · Other. (before SX-2)
- [ ] **BQ-9 Credits.** **Suggestion:** monthly credits work through the 5 read-only days and stop when paused (C-9); Boost credits stay until the account is deleted, then are lost, no refund.
- [ ] **BQ-11 Failed last payment.** **Suggestion:** no self-service cancel or deletion request; "update your card, or contact support".
- [ ] **BQ-12 Soft Disconnect of Stripe with running client plans.** **Suggestion:** warn, allow. (before SX-5)
- [ ] **BQ-15 Switch on while plan limits are not enforced?** **Suggestion:** yes; the copy states the configured rule.
- [ ] **BQ-17 List only, no free-text reason.** **Suggestion:** yes.
- [ ] **BQ-18 Buy a plan while deletion is pending?** **Suggestion:** no, Keep first.
- [ ] **BQ-19 Stripe connection delete refuses when Stripe won't let go.** **Suggestion:** yes, honest refusal. (before SX-5)
- [ ] **Open issue 1 / BQ-3 (shared) Sender and support address.** **Suggestion:** `notifications@agentspilot.ai` for now, also in the banned-login copy. (before SX-3)
- [ ] **Open issue 2 (shared) Legal confirmation on leaving files out** (Art. 28(3)(g)), also covering the re-worded privacy paragraph (XC-6). (before DL-5 switch-on)

Closed by the v2 brief and relevant here: BQ-1 (no offer to stay) · BQ-2 (login email, owner's language) · BQ-5 (replaced by "side by side", §5) · BQ-6 (became BQ-20) · BQ-8 (Keep in A/B renews, refined by BQ-33) · BQ-10 (reminder 3 days before the lock) · BQ-16 (admin reasons page later).

---

## 10. SA conditions that apply

Copied from the parent's `## SA Review — 2026-10-25`. Binding. Where a condition is shared with EXPORT, only the DELETE part is acted on here; the full text is kept.

| # | Condition (verbatim) |
|---|---|
| **XC-1** | **Closure record = new table** `business_os_account_closures`, one row per request. Columns as SA-Q1 plus `status` (`requesting` → `pending` → `grace` → `locked`; terminal `kept` / `closed`), `kept_source` (`owner` / `admin` / `stripe`), `statement_language` (never the text; it is rebuilt from the server list, SA-8), `reason_code`, `blocked_codes text[]`, one `*_email_sent_at` column per email, and the claim columns (XC-4). Partial unique "one open row per user" over `requesting`, `pending`, `grace`, `locked`. Server-write-only: RLS on, no anon or authenticated policy, every access through a repository. Descriptor `export: exclude`. **At E the engine deletes it** (plan step A). It is not "closed in place": after E the deletion receipt and the surviving audit rows are the record. §4.6 "the closure record is closed" is amended to this |
| **XC-2** | **Write order** (adapts SA-7, answers SA-Q4). Request: insert the row as `requesting` with `renewal_was_on` read from our billing row → Stripe "don't renew" (fresh key per attempt, C-4) → mirror compare-and-set → row to `pending`. A Stripe failure deletes the `requesting` row. A `requesting` row older than 15 minutes is settled by the lifecycle job from a fresh Stripe read. Only `pending` counts as open, so the invariant "no open request in B on a renewing plan" holds, and a retry never reads its own cancellation as "renewal was off". Keep: row to `kept` first, then Stripe renew only if `renewal_was_on`. A Stripe failure leaves an honest "Ends on {date} [Keep my plan]" card and an error, never a renewing plan with an open request |
| **XC-3** | **Lock** (answers SA-Q2). Ban through the GoTrue Admin API (`auth.admin.updateUserById(id, { ban_duration: '87600h' })`, 10 years, deliberately under the tombstone's 99-year predicate). Unlock: `ban_duration: 'none'`. Sessions: a new service-role-only `SECURITY DEFINER` function deletes `auth.sessions` and `auth.refresh_tokens` for that one user, the same two steps the engine's closure list runs, `REVOKE`d from anon and authenticated. The Dev's first workplan task is a spike: if GoTrue revokes sessions on ban by itself, drop the function. Both calls sit behind one repository seam (rule 1), never in a route. Unlock refuses when the login is already a tombstone (`isClosedAccountEmail` or `raw_app_meta_data.deleted`). E needs no change: it overwrites the ban and deletes what is left. The login page maps GoTrue's banned error to "This account is closed. Contact {support address}" (XC-21) |
| **XC-4** | **Lifecycle job** (answers SA-Q3). One cron route, **hourly at :50** (no job uses :50 today), on the `durable-queue-drain` claim pattern over the closure table: claim RPC with `FOR UPDATE SKIP LOCKED`, lease 90 s with `maxDuration = 60`, reaper first. One pass per claimed row: settle `requesting`; start C; send the C email; send the reminder; re-check the blockers; send the "closed" email; lock. C starts at the mirror's `ended_at`. If 24 h after `current_period_end` there is still no `ended_at`, the job reads the subscription **fresh from Stripe** (`retrieveBusinessOsSubscription`) rather than guessing from tier dates. `lock_at` is fixed when C starts: the start of local day 15 in `user_preferences.timezone` (UTC when NULL), so the lock lands within the hour after it. A later timezone change does not move it. **Each email exactly once:** the claim, then a Resend idempotency key `closure:{id}:{email}`, then `*_sent_at` set on the claimed row. A "closed" email that Resend refuses is retried hourly and the lock waits (BQ-41). **The job, Keep and admin Unlock run whatever the switch says** whenever an open row exists. The switch only stops new requests (the DE-8b sweep precedent) |
| **XC-5** | **Blockers through `runAccountDeletionCheck`** (answers SA-Q5), filtered the same way at A and at the lock. Shown to the owner and blocking: G-8, G-9, G-4 (an admin login: "contact support"), plus a failed last payment from our billing row (BQ-11). **Ignored at A and at the lock:** G-6 (the plan is expected to be live at A; at the lock it has ended, and E re-checks) and G-12 (E's storage step removes the files). **Engineering guards** (G-10, G-11, G-13 to G-19) block neither the request nor the lock: they show on the ready list as "blocked: engineering", because the owner cannot fix them and refusing would send them back to email. The check itself needs no fingerprint key. Keep the route's "available on this deployment" gate (cleanup secret plus key), because a request that E could never complete must not be accepted |
| **XC-6** | **DE-10b.2 rework** (answers SA-Q6). **Kept:** `acknowledgement.ts`, `schemas.ts`, `sessionSubject.ts` (session and throttle key), `blockerCopy.ts`, `runAccountDeletionCheck`, the deletion-check route (with the XC-5 filter), `DeleteAccountDrawer.tsx` and `DangerZonePanel.tsx` (extended), the translations, and `isAccountSelfDeleteEnabled()`. **Removed from the owner path:** `runSelfAccountAnonymise`, the anonymise call and receipt building in `account/delete/route.ts` (it becomes the request route), and `expireAuthCookies` on that route. `deletionEmail.ts` becomes the "Deletion requested" builder. **Moved to E:** `receiptInput.ts` / `buildOwnerReceipt`, called by a new `requireAdmin` route that reads the user id from the path, then the closure row (requested time, language) **on the server**, never from the body. **Guard:** extend `no-deletion-paths.guard.test.ts` so that no file under `app/api/business-os/**` may import `runAccountAnonymise` or `runSelfAccountAnonymise`. `/account-deleted` stays, re-worded as the landing for a closed account. `docs/legal/ACCOUNT_DELETION_PRIVACY_PARAGRAPH.md` is re-worded for request, grace and lock (legal open issue 2 also covers it). *(Split note: "moved to E" means DELETE's E route **calls** `receiptInput.ts`; the file itself is owned by EXPORT, §11 S-3.)* |
| **XC-11** (shared) | **New tables and the cleanup function** (answers SA-Q12). Yes, it must be regenerated: the descriptor, the generator output and the drift test move together, in the **same PR** as the table. Two regenerations: MX-1a (export tables) and DL-1a (closure table). They are separate PRs merged one after the other, never stacked; the second regenerates on top of the first. A third at MX-7 (drop of `business_os_data_exports`: remove it from `FUNCTION_REQUIRED_TABLES` and the plan). Add a new table to `FUNCTION_REQUIRED_TABLES` only if the generated SQL names it statically. Numbers: **20261093 is next free today**, taken when each PR opens; 20261089 is never back-filled. **Deploy order:** a new `CLEANUP_FUNCTION_VERSION` makes the check and E answer `function_out_of_date` until DB and code agree. That fails closed, but it pauses admin deletes and test-account cleanup, so apply and merge back to back and run the checker. Each is a manual prod gate |
| **XC-13** (shared; DELETE acts on the lifecycle half) | **Audit** (answers SA-Q13). New: `ACCOUNT_DELETION_REQUESTED`, `ACCOUNT_DELETION_KEPT` (`details.source` owner / admin / stripe), `ACCOUNT_GRACE_STARTED`, `ACCOUNT_CLOSURE_EMAIL_SENT` (`details.email`: requested / grace / reminder / closed / kept; one event, not five), `ACCOUNT_CLOSURE_BLOCKED` (guard codes only), `ACCOUNT_LOCKED`, `ACCOUNT_UNLOCKED`. "Ready" is derived, so it has no event. These are written with `user_id` NULL (rewritten to the system user, as `ACCOUNT_PSEUDONYMISED` is) and `entity_type 'user'`, `entity_id` = subject, `actor_id` = the admin for unlock: they survive E, which deletes `audit_trail` rows **by `user_id` only**. Refusals keep B-1 (`user_id` = subject). Export: reuse `DATA_EXPORT_REQUESTED` (`details.modules`, origin), plus new `DATA_EXPORT_MODULE_SENT` and `DATA_EXPORT_MODULE_FAILED` (`details`: module code, rows, parts, failure code, `interrupted` flag). "Completed" and "delivered" are one moment, so they are one event. These carry `user_id` = owner and go with the account. Keep the ZIP constants for old rows, with no new writes after MX-6. Definitions and `eventAudience` / owner presentation entries for each |
| **XC-14** | **Public site at the lock** (answers SA-Q14, only if BQ-23 is yes). It is **not** an entitlements gate and does not start the enforcement work. A closure repository read `isAccountClosedToPublic(userId)` (status `locked`) is called at four points: `/api/website/public/[subdomain]`, `resolveBusinessByPrefix` (book and contact pages), `website/booking/create` and `website/forms/contact`. The site cache is revalidated at lock and unlock (`siteCache`). A source-scan test lists the four call sites. Client links already sent (`/book/manage/[token]`) show "no longer available online" (BQ-39). Slice DL-4b, 1.5 d |
| **XC-15** (shared; DELETE acts on the cancel and delete switches) | **Switches** (answers SA-Q15). `isPlanSelfCancelEnabled()`, `isAccountSelfDeleteEnabled()` (now the lifecycle **request** switch, XC-4), and a new `isModuleExportEnabled()`, each with a `feature_flags.md` row and the `is…Enabled` naming. While the export switch is off, nothing changes. When it is on: "Download my data" opens the drawer, and the ZIP **start** routes (owner and admin prepare) answer 404 at once. Ready ZIPs stay downloadable until they expire. MX-6 removes the code. The export worker and the sweep run regardless of their switches |
| **XC-17** (shared; delete and cancel rows) | **Slices re-cut** (each ≤ 2.5 d, from `main`, not stacked). DL-1 → **DL-1a** closure table + claim RPC + session-cut function + descriptors + regen (2 d) and **DL-1b** request and keep routes, two-phase write, checkout and Boost refusal, mirror C-3 (2.5 d). **DL-4b** website offline 1.5 d (was +1). DL-5 2 d (the E route of XC-6). SX-2 2.5 d (builds `planEndingView`) |
| **XC-19** (shared; DELETE acts on the entitlements part) | **Entitlements** (answers SA-Q17). `planEndingView` lives inside `lib/business-os/entitlements/`. Every file outside the module that imports it or `lifecycle.ts` (the cancel and deletion routes or view models, the lifecycle job if it computes the after-plan state, `planCancellation.ts` if it does) is registered in `KNOWN_NON_GATE_IMPORTERS` with its exact symbols, type-only included. The checkout and Boost refusal while a deletion is pending reads the **closure repository**, not entitlements, so it is **not** an `ENFORCEMENT_POINTS` gate. If `planPurchaseOffer` is already registered and gains a symbol, update its entry. Export never imports entitlements: it is available in every tier and state. Add a test asserting that no export route is in `ENFORCEMENT_POINTS`, so future enforcement cannot block it during grace or pause |
| **XC-21** (shared) | **Standards across slices:** rule 1 (closure, export and auth-admin access only through repositories; cron claim/complete methods marked `⟨unscoped-by-design⟩`); rule 2 (Zod `.strict()`; module ids validated against a Zod enum built from the module map); rule 3 (Pino; flag and convert any touched file with `console.*`); rule 4 (service-role paths documented; ids from the session, a claimed row or an admin path, never a body); rule 5 (no LLM involved); rule 7 (the exceptions ruled here: the 300 s worker, the session-cut function, the idempotency key option; nothing else new); CI (pure Jest, small fixtures, inside the existing job; the regen drift tests already exist, so **no added CI time**). Ops gates in §9.5 stand, plus: the Resend sending limit and plan quota checked against 13 modules × up to 10 emails, and the support address used in the banned-login copy |

**Relevant SA findings:** F-1 (free accounts cannot hold a billing row), F-2 (the anonymise's 100-year ban and its 99-year after-check), F-3 (`getUser()` 30 s cache: a locked user is out within about 30 s), F-4 (cleanup regeneration and drift test), F-6 (the admin anonymise route stamps `requestedAt = now` and takes the statement from the body), F-12 (`planEndingView` does not exist yet), F-13 (no public "closed" choke point), F-14 (next free migration 20261093).

**Carried v1 rulings that still apply** (parent §17): C-1 (SX-1–SX-3 = P-7a's cancel half; portal cannot cancel), C-3 (mirror clears the request on reactivation), C-4 (fresh Stripe key per attempt), C-5 (Connect delete only on confirmed deletion; OAuth deauthorize; G-8 wording), C-9 (copy states what the code does), C-10 (no free-text reason), C-11 (standards), C-12 (fingerprint key check before DL-5), SA-1 (new `StripeService` method + `planCancellation.ts` in the `planUpgrade.ts` shape), SA-2 (eligibility `active` only, also for the deletion request on a paid plan), SA-3 (write our row from Stripe's answer via the mirror compare-and-set), SA-4 (reason code in audit details), SA-5 (`planEndingView` in the entitlements module), SA-6 (no checkout or Boost while deletion pending, A–C), SA-8 (admin runs the engine with the stored request time), SA-9 (language, timezone and recipient sources; send only on a real change), SA-14 (G-8 strict; D-2 via `runAccountDeletionCheck`), SA-15 (copy states the configured rule under shadow mode), SA-16 (deletion events survive, extended by XC-13).

---

## 11. Boundary and coordination with the other scope

> **This section is identical** in [BUSINESS_OS_EXPORT_REDESIGN_REQUIREMENT.md](/docs/requirements/BUSINESS_OS_EXPORT_REDESIGN_REQUIREMENT.md) (EXPORT) and [BUSINESS_OS_ACCOUNT_DELETION_LIFECYCLE_REQUIREMENT.md](/docs/requirements/BUSINESS_OS_ACCOUNT_DELETION_LIFECYCLE_REQUIREMENT.md) (DELETE). Change it in both files in the same PR, or not at all.

Two Claude sessions build in parallel. **EXPORT** builds MX-0 to MX-7. **DELETE** builds SX-1, SX-2, SX-3, SX-5, DL-1a to DL-5 and DL-4b, and also built LX-1 before the split. Every reservation, claim, hand-off and question between them goes through the shared coordination file (B.5).

### B.1 Ownership

"Owns" = only that scope edits it. The other scope may **import or call** it read-only, never edit it. More files are assigned in B.8 (SR-11). Anything not listed: raise it in the coordination file before touching it.

| Area | EXPORT owns | DELETE owns |
|---|---|---|
| **Code dirs / files** (SR-1, SR-3, 2026-10-25) | `lib/business-os/data-export/**` (module map, `csv.ts`, `columnLabels.ts`, worker, ZIP files until removed) · `lib/repositories/BusinessOsDataExportJobRepository.ts` **including `findDeletionFacts` and the `DataExportDeletionFacts` type** (frozen, B.6) · new export request / module-job repositories · CRM / Orders list export code after LX-1 merges (`app/business-os/crm/page.tsx` export handler, `components/payments/MoneyList.tsx` export). **EXPORT does not edit `receiptInput.ts`**: XC-12 changes only the values `findDeletionFacts` returns (SR-1) | `lib/business-os/account-deletion/**` **including `receiptInput.ts`** (SR-1: DELETE may add builders, e.g. the DL-5 "admin runs an owner's stored request" builder; it may **not** change `receiptShape`, `DELETION_RECEIPT_INPUT_KEYS` or the `superRefine` without the S-1 cleanup-regen lock, because a key change is a regeneration) (incl. the DE-10b.2 files `acknowledgement.ts`, `schemas.ts`, `sessionSubject.ts`, `blockerCopy.ts`, `deletionEmail.ts`, `runAccountAnonymise.ts`, `closedAccount.ts`, `reason.ts`, `receiptFingerprint.ts`) · closure repository and the auth-admin lock seam · `lib/business-os/billing/**` (`planCancellation.ts`, `planSubscriptionMirror.ts`, `planPurchaseOffer` refusal) · `lib/stripe/StripeService.ts` cancel / keep / OAuth deauthorize methods · `planEndingView` in `lib/business-os/entitlements/` · `lib/business-os/purge/adminDeletionRefusals.ts` · the **rules** in `no-deletion-paths.guard.test.ts` (the anonymise-import guard of XC-6); its older-version allow-list entries go with whoever holds the S-1 lock (SR-3). DL-1a adds its session-cut migration to `SQL_AUTH_WRITE_ALLOW_LIST`, because `DELETE FROM auth.sessions` matches the guard (SR-3) |
| **Tables / DB objects** | `business_os_export_requests`, `business_os_export_module_jobs`, their start function and claim / reap RPCs · `business_os_data_exports` and the `20261074` start function (read-only, then dropped in MX-7) · bucket `business-data-exports` | `business_os_account_closures`, its claim RPC, the session-cut `SECURITY DEFINER` function · Supabase Auth ban / unban (through the repository seam) |
| **Routes** | New export request + history routes · export worker cron route · `app/api/business-os/data-exports/**` (retired in MX-6) · `app/api/admin/users/[id]/data-exports/**` (retired) and the new admin "Send export to owner" route · `/api/cron/data-export` (retired) | `app/api/business-os/account/delete` (becomes the request route) · keep route · deletion-check route · plan cancel / keep routes · lifecycle cron route · admin unlock, ready list and E routes · existing `app/api/admin/test-account-cleanup/**` (EXPORT changes receipt facts only inside `findDeletionFacts`, never in these routes) · `app/api/payments/stripe-connect/{disconnect,delete}` · the four XC-14 public "closed" call sites and `siteCache` revalidation |
| **UI** (SR-9, 2026-10-25) | Export drawer and its open action, which is `DownloadMyDataButton` (frozen, B.6) · admin "Send export to owner" button component | `DeleteAccountDrawer.tsx` · cancel drawer · pending-deletion banner · plan card wording · Keep screens · banned-login copy · `/account-deleted` · admin ready list / Unlock / run-delete components |
| **Emails** | Export requested · module part · failed · interrupted · too large | Deletion requested · grace started · reminder · closed · kept · blocked · plan cancelled / kept / reminder |
| **Flags** | `isModuleExportEnabled()` | `isPlanSelfCancelEnabled()`, `isAccountSelfDeleteEnabled()` |
| **Docs** | `BUSINESS_OS_DATA_EXPORT_CONTENTS.md` · flags-xlsx requirement "superseded" marker | `docs/legal/ACCOUNT_DELETION_PRIVACY_PARAGRAPH.md` · plan-payments P-7a note (C-1) |
| **Migrations** | MX-1a, MX-7 | DL-1a (and SX-5 only if it needs one) |

### B.2 Shared surfaces and how changes to them are serialised

| # | Shared surface | Who changes it | Rule |
|---|---|---|---|
| S-1 (SR-3, SR-4, SR-5, 2026-10-25) | **Test-account cleanup generator and every regenerated cleanup migration** (the files under the cleanup-regen lock): `scripts/generate-test-account-cleanup-sql.ts`, the pasted `CHECK_FILE` / `DELETE_FILE` SQL, the generated cleanup-function migration and its `supabase/SQL Scripts/<N>_rollback.sql`, `lib/business-os/test-account-cleanup/cleanupFunctionVersion.generated.ts` (`CLEANUP_FUNCTION_VERSION`), `scripts/__tests__/testAccountCleanupSql.test.ts` (drift test, the `APPLIED` / `APPLIED_TARGET` sha256 pins and the "chains on …" test), the older-version allow-list entries in `lib/business-os/purge/__tests__/no-deletion-paths.guard.test.ts`, `FUNCTION_REQUIRED_TABLES` | MX-1a, DL-1a, MX-7 (each regenerates it) | **Strictly one after another, never in parallel.** Before starting a regenerating slice, take the "cleanup regen" claim in the coordination file; only one claim may be open. Branch from a `main` that already holds the previous regeneration and regenerate on top of it. Each PR is **applied to prod and merged back to back** and the checker is run (XC-11: a version mismatch pauses admin deletes and test-account cleanup). Release the claim only after merge + apply + checker. **Order: DL-1a, then MX-1a, then MX-7** (SR-4). DL-1a takes the lock first; precondition: `20261092` is applied on prod and the checker is green, otherwise stop and tell TL. EXPORT runs MX-0 → MX-2a → MX-2b → MX-1a → MX-1b → MX-3 → …, and may build MX-1a's tables, repositories and start function on a branch while the lock is held, but does not regenerate or apply until it is released. **Pre-apply check for every regeneration** (SR-5): (a) branch rebased on current `origin/main` and green; (b) `origin/main`'s `FUNCTION_MIGRATION` equals the PR's `PREVIOUS_FUNCTION_MIGRATION`; (c) apply, then enqueue at once; (d) run the checker; (e) release the lock in the log. No new CI guard is needed for the race on `main` |
| S-2 (SR-3, 2026-10-25) | **Purge descriptors / export classification** (`lib/business-os/purge/descriptors.ts`, `exportClassification.test.ts`, `lib/business-os/businessOwnedTables.ts`) | EXPORT (export tables, `export` semantics, module-map test), DELETE (closure table) | Each scope adds descriptors **only for its own tables**, in the same PR as the table and its regeneration (S-1). The closure table is `export: exclude`. DELETE never changes an existing `export` entry; EXPORT never changes a non-export table's purge behaviour. `businessOwnedTables.ts` is add only |
| S-3 (SR-1, 2026-10-25) | **`BusinessOsDataExportJobRepository.findDeletionFacts` + `DataExportDeletionFacts`** | **EXPORT only** (XC-12, MX-4 and MX-7) | **DELETE must not touch either.** Signature frozen through MX-7 (B.6). DELETE's routes and DL-5's E route call `findDeletionFacts` through it. `receiptInput.ts` is no longer a shared surface: DELETE owns it (B.1, SR-1) and EXPORT does not edit it. Any change is announced in the coordination file before its PR opens and keeps the signature |
| S-4 (SR-9, 2026-10-25) | **Deletion drawer → export drawer link** | EXPORT provides, DELETE consumes | The export entry point is the existing `DownloadMyDataButton` (frozen, B.6). Before and after MX-1b, DL-2's drawer renders `<DownloadMyDataButton variant="button" />` and nothing else for export; it never names an export route (guard check 4 refuses that outside `lib/client/businessOsDataExport.ts`). In MX-1b, EXPORT makes that same component open the export drawer when `isModuleExportEnabled()` is on, so Settings, the Danger Zone, the AgentPilot security tabs and the deletion drawer switch over without being edited (XC-15). EXPORT's MX-1b handles focus and stacking when the export drawer opens inside the deletion drawer, and tests it once |
| S-5 (SR-10, 2026-10-25) | `components/business-os/purge/DangerZonePanel.tsx` and `app/business-os/settings/page.tsx` | **DELETE only** | **EXPORT does not edit them** (SR-9: the button switches itself). DELETE edits the "Delete my account" block, the plan card and the pending state. Keep diffs small, rebase on `main` just before enqueue |
| S-6 (SR-10, 2026-10-25) | `/admin/users` (`app/admin/users/page.tsx`, `app/admin/users/components/BusinessDetail.tsx`) | **DELETE only** | **EXPORT does not edit them**: MX-5 replaces the inside of `DataExportBlock`, which is already mounted. DELETE adds the ready list, Unlock and run-delete mounts. Never edit the other's component |
| S-7 (SR-10, 2026-10-25) | **Translations** `lib/business-os/translations/{en,he,es}.ts` | Both | **Add keys only, never edit or delete the other's keys**, in one block at your own anchor (B.7). Each scope keeps to its own key namespace (EXPORT: export drawer and export email keys; DELETE: closure, keep and plan-cancel keys). CSV header labels are not here (XC-10, EXPORT's `columnLabels.ts`) |
| S-8 (SR-10, 2026-10-25) | `lib/utils/featureFlags.ts` + `docs/FEATURE_FLAGS.md` (`feature_flags.md` rows) | Both | Add only your own reader and row, at your own anchor (B.7); `is…Enabled` naming |
| S-9 (SR-10, 2026-10-25) | **Audit events**: `lib/audit/events.ts`, the event definitions, `lib/audit/eventAudience.ts` | Both (XC-13 split) | Add only your own constants, definitions and audience entries, at your own anchor (B.7); never rename or remove an existing one. EXPORT keeps the ZIP constants for old rows |
| S-10 | **`emailTransport` idempotency key** (`lib/notifications/emailTransport.ts`, optional `idempotencyKey` on `SendEmailParams`, Resend only) | Whoever needs it first (EXPORT MX-3 per XC-9; DELETE DL-3 per XC-4) | Claim it in the coordination file before starting; the first builds it as an additive optional field in its own slice; **the other reuses it and never builds a second.** If both need it in the same week, the claim decides |
| S-11 (SR-10, 2026-10-25) | `vercel.json` crons | Both | Add or remove only your own entries, at your own anchor (B.7) (EXPORT: worker every 5 min, removes `/api/cron/data-export` in MX-6; DELETE: lifecycle job hourly at :50) |
| S-12 | Entitlements registries (`KNOWN_NON_GATE_IMPORTERS`, `ENFORCEMENT_POINTS` tests) | DELETE registers its importers (XC-19); EXPORT adds only the "no export route in `ENFORCEMENT_POINTS`" test | Add only |
| S-13 | Admin authz registry | Both | Add only your own route entries |
| S-14 | `BUSINESS_OS_DATA_EXPORT_DE10B_REQUIREMENT.md` | EXPORT (the `ownerExportDownloadedAt` note, XC-12); DELETE (DE-10b.3 superseded note, E route) | Add a section only; never rewrite the other's |
| S-15 | Parent requirement `BUSINESS_OS_SELF_SERVICE_EXIT_REQUIREMENT.md` | **TL only** | Neither session edits it |
| S-16 (SR-11, 2026-10-25) | `lib/repositories/types.ts` and `lib/repositories/index.ts` | Both | Add only. **Prefer keeping new types in the repository file itself** (as `DataExportDeletionFacts` is) and not adding to the barrel |
| S-17 (SR-10, SR-11, 2026-10-25) | `lib/security/rateLimit.ts` (`RATE_LIMITS`) | Both | Add only, your keys in one block at your own anchor, not adjacent to the other's (B.7) |

### B.3 Migration-number reservation

- The next free number is **20261093** (SA F-14). Each scope **reserves its number in the coordination file before writing the migration**: first come, first served, one number per migration.
- At PR open, check `origin/main` and the coordination file again; if the number was taken, reserve the next free one and rename (C-8).
- An abandoned migration releases its number in the coordination file.
- **20261089 is never used or back-filled.**
- Expected migrations: EXPORT MX-1a and MX-7; DELETE DL-1a (and SX-5 only if it needs one). MX-1a, DL-1a and MX-7 also follow S-1.
- (SR-7, 2026-10-25) Each reservation row records **number, slice and branch**. DL-1a takes the first number, `20261093`.
- (SR-6, 2026-10-25) **MX-7 is two migrations and reserves both numbers at once:** first the regenerated function (N), which no longer names `business_os_data_exports` (its descriptor and `FUNCTION_REQUIRED_TABLES` entry removed in the same PR), then the DROP (N+1). Never drop first.
- (SR-7, 2026-10-25) DL-1a adds a pure Jest guard: no two `supabase/migrations/*.sql` files with a prefix of `20261093` or above share an 8-digit prefix. It runs in the existing job (no added CI time) and also covers other streams that do not read the coordination file.

### B.4 Dependencies between the scopes

| Dependency | Rule |
|---|---|
| **DELETE switch-on waits for EXPORT MX-4 switch-on** | Stage C promises "you can export your data", so `isAccountSelfDeleteEnabled()` (DL-5) is not switched on before `isModuleExportEnabled()` is on (MX-4). DELETE may build and merge everything with its switch off before then |
| **DL-5 receipt reads export facts through the EXPORT interface** (SR-1, 2026-10-25) | The E route calls `findDeletionFacts` (S-3, B.6) and passes the values to DELETE's own `receiptInput.ts` builders. Before MX-4 it reads the old table; from MX-4 the new tables (and the old one until MX-7). DELETE changes nothing either way |
| DL-2 links to the export drawer (SR-9, 2026-10-25) | Soft; never blocking. DL-2 renders `<DownloadMyDataButton variant="button" />` (S-4) |
| **Regeneration order** (SR-4, 2026-10-25) | DL-1a → MX-1a → MX-7 (S-1) |
| **EXPORT MX-6 / MX-7 wait for nothing from DELETE** | Apart from the S-1 serialisation of MX-7's regeneration |
| MX-5 "works in stage D" | Tested against a banned user directly; does not wait for DL-4 |
| LX-1 | Built in the DELETE session on `fix/crm-export-safety-lx1` and merged **before** the split; afterwards the CRM / Orders list export code belongs to EXPORT |
| Ops gates | Resend domain verification and the sender / support address (open issue 1) serve both scopes; whoever reaches switch-on first raises them in the coordination file |

### B.5 Coordination file

`C:\Users\Barak\My Projects\AgentsPilot\SELF_SERVICE_EXIT_COORDINATION.md`. It sits outside any worktree and is not in git. It holds the migration reservations (B.3), the cleanup-regen claim (S-1), the idempotency-key claim (S-10), interface-change notices (S-3) and switch-on hand-offs (B.4). **The messaging rule between the two sessions is defined there, not here; follow it.**

### B.6 Frozen interfaces (SR-1, SR-2, SR-9, 2026-10-25)

**File:** `lib/repositories/BusinessOsDataExportJobRepository.ts` (owner: EXPORT)

```typescript
export interface DataExportDeletionFacts {
  ownerLastExportReadyAt: string | null;   // ISO or DB timestamp; null = none on record
  ownerExportDownloadedAt: string | null;  // always null for module exports (XC-12)
  adminExportExisted: boolean;
}

// new BusinessOsDataExportJobRepository(client?: SupabaseClient)
findDeletionFacts(userId: string): Promise<RepositoryResult<DataExportDeletionFacts>>;
```

Path, class, method and type names do not change in this stream, **including MX-6 and MX-7** (after MX-7 it reads only the new tables). Full contract: `## SA Split Review — 2026-10-25`, "Frozen interface spec".

**File:** `components/business-os/data-export/DownloadMyDataButton.tsx` (owner: EXPORT)

```typescript
export interface DownloadMyDataButtonProps { variant: 'row' | 'button'; className?: string; }
export function DownloadMyDataButton(props: DownloadMyDataButtonProps): JSX.Element;
```

Name, path and props stay frozen through MX-6. The visible label may change (EXPORT's `downloadMyDataCopy.ts`).

### B.7 Hotspot anchors (SR-10, 2026-10-25)

Own anchor, add only, rebase just before enqueue. Each scope inserts in **one contiguous block at its own anchor**, never at the end of a shared list.

| File | EXPORT inserts | DELETE inserts |
|---|---|---|
| `lib/audit/events.ts` (`AUDIT_EVENTS` and `EVENT_METADATA`) | Directly after `DATA_EXPORT_DOWNLOADED_BY_ADMIN` in each map | Directly after `ACCOUNT_DELETION_REFUSED` in each map |
| `lib/audit/eventAudience.ts` | After `DATA_EXPORT_DOWNLOADED_BY_ADMIN` | After the last `ACCOUNT_*` / test-account entry |
| `lib/business-os/translations/{en,he,es}.ts` | One block, prefix `settings.data_export.*` / `export_module.*`, after the last existing data-export key | One block, prefixes `settings.account_delete.*` (extend in place), `settings.plan_cancel.*`, `account_closure.*` |
| `lib/utils/featureFlags.ts` | `isModuleExportEnabled()` at the end of the file | `isPlanSelfCancelEnabled()` directly after `isAccountSelfDeleteEnabled()` |
| `docs/FEATURE_FLAGS.md` | Its row at the end of the env-flag table | Its row directly after the `isAccountSelfDeleteEnabled` row |
| `vercel.json` `crons` | The worker entry directly after `/api/cron/data-export` (MX-6 then removes the neighbour, same owner) | The `:50` entry directly after `/api/cron/payment-reminders` |
| `lib/security/rateLimit.ts` `RATE_LIMITS` | Its keys in one block at its own anchor | Its keys in one block at its own anchor (not adjacent) |

**Files EXPORT does not edit:** `components/business-os/purge/DangerZonePanel.tsx`, `app/business-os/settings/page.tsx`, `app/admin/users/components/BusinessDetail.tsx`, `app/admin/users/page.tsx`. If EXPORT finds it must edit one, it records a short claim in the coordination file first.

### B.8 More file assignments (SR-11, 2026-10-25)

| Surface | Owner |
|---|---|
| `components/business-os/data-export/**`, `lib/client/businessOsDataExport.ts`, `oneExportControl.guard.test.ts`, `components/settings/SecurityTab.tsx` and `components/v2/settings/SecurityTabV2.tsx` (AgentPilot security tabs, export entry only) | EXPORT |
| `app/admin/users/components/DataExportBlock.tsx`, `DataExportReasonDialog.tsx`, `app/admin/users/dataExportCopy.ts` and their tests | EXPORT |
| After LX-1 merges: `components/crm/ContactsExportButton.tsx`, `components/payments/MoneyCapNotice.tsx` (EXPORT does not touch any LX-1 file until LX-1 is on `main`) | EXPORT |
| `lib/business-os/account-deletion/receiptInput.ts` (SR-1) | DELETE |
| `lib/business-os/account-deletion/selfServiceDeletion.ts`, `authCookies.ts` (part of `account-deletion/**`, named so nobody misses them) | DELETE |
| `lib/business-os/test-account-cleanup/**` except the generated version file (S-1), `lib/repositories/TestAccountCleanupRepository.ts`, `components/business-os/purge/TestAccountCleanupPanel.tsx`, `app/admin/users/deletionCopy.ts`, `app/admin/users/page.tsx`, `useBusinessDetails.ts`, `types.ts`, `usersFilters.ts` | DELETE |
| `lib/repositories/types.ts`, `lib/repositories/index.ts` (S-16) | Shared, add only |
| `lib/security/rateLimit.ts` (S-17), `lib/business-os/businessOwnedTables.ts` (S-2) | Shared, add only |

---

## 12. Non-functional requirements

- **Security:** session user only (`getUser()`), never an id from the body; Zod `.strict()`; Stripe ids from our row only; admin routes `requireAdmin` first and in the authz registry; E route reads the closure row on the server; emails only to the login email at send time; rate limits on request, keep and cancel; service-role paths documented (rule 4); tenant-isolation-guard on admin paths.
- **Fails closed:** if Stripe, our record or the check cannot be read, nothing changes and the owner is told to try again. A failed email never undoes an action, except the "closed" email, which must be accepted **before** the lock.
- **Idempotent:** double clicks, retried jobs and replayed webhooks give one result, one email, one audit row.
- **Privacy:** no reason text; logs and audit hold ids, codes and counts; closure row deleted at E; deletion audit rows hold no personal data and survive.
- **Logging:** Pino `createLogger` with `correlationId`; no `console.*` (flag and convert any touched file).
- **Money:** no sums across currencies; plans USD only.
- **Time:** every date in `user_preferences.timezone`; NULL shown with "UTC".
- **Accessibility:** keyboard only, labelled controls, focus kept in the drawer, errors announced.
- **Languages:** en and he (right-to-left) at launch; es as a draft.
- **CI:** Jest only, small fixtures, inside the existing job: no added CI time.

---

## 13. Out of scope / future roadmap

- Automatic final delete after the lock.
- Removing personal details from the Stripe Customer after deletion.
- Admin receipt lookup and the retention sweep (DE-10b.4).
- A real free plan (BQ-20 option b).
- Mid-period downgrades, refunds, offers to stay.
- Self-service for a failed payment (BQ-11).
- An admin page of reasons (BQ-16).
- Annual plans (stage B could then be a year).
- Cancelling or emailing the owner's clients about future bookings (BQ-39).

---

## 14. Notes on integration points

| System | Impact |
|---|---|
| `lib/stripe/StripeService.ts` | Cancel-at-period-end on/off (SX-1); OAuth deauthorize (SX-5) |
| `lib/business-os/billing/` | `planCancellation.ts` (SX-1); `planSubscriptionMirror.ts` clears a request on reactivation (DL-1b); `planPurchaseOffer` refusal while pending |
| `lib/business-os/entitlements/` | `planEndingView` (SX-2); registrations (XC-19) |
| DE-10b.2 self-delete route, drawer, Danger Zone (PR #503) | Reworked to request + grace (DL-1b, DL-2) |
| `business_os_account_closures` (new) | Migration, manual gate (DL-1a) |
| `scripts/generate-test-account-cleanup-sql.ts` + cleanup migration | Regenerated in DL-1a (S-1) |
| Supabase Auth | Ban / unban + session cut (DL-4) |
| `/admin/users` | Ready list, Unlock, run delete (DL-4, DL-5) |
| Public website and booking routes | "Closed" check at four sites (DL-4b) |
| `lib/business-os/purge/descriptors.ts` | Closure table descriptor (DL-1a) |
| `lib/business-os/purge/adminDeletionRefusals.ts` | R-3 text (SX-3) |
| `app/api/payments/stripe-connect/{disconnect,delete}` | SX-5 |
| `lib/notifications/emailTransport.ts` | Optional `idempotencyKey` (S-10) |
| `lib/audit/events.ts`, `eventAudience.ts` | Lifecycle events (XC-13) |
| `vercel.json` | Lifecycle cron hourly at :50 |
| `BUSINESS_OS_PLAN_PAYMENTS_REQUIREMENT.md` P-7a | Note per C-1 |
| Feature flags | `isPlanSelfCancelEnabled`, `isAccountSelfDeleteEnabled` + `FEATURE_FLAGS.md` rows |

---

## SA Split Review — 2026-10-25

**Reviewed by SA — 2026-10-25** (split of the parent into EXPORT and DELETE; checked against `origin/main` at `7e51af5b`, PR #504 merged)
**Status:** ⚠️ Approved with conditions SR-1 to SR-12. **This section is identical in the EXPORT and DELETE files.** Where it disagrees with §11, this section wins until BA splices it into §11 of both files (SR-12).

Verdict in one line: the split is sound, and both sessions can start today. However, §11 gives `receiptInput.ts` to the wrong scope, misses about ten files that both scopes' slices will edit, and leaves the cleanup-regeneration order open. The rulings below fix that.

### What was checked

| Area | Evidence on `origin/main` |
|---|---|
| Receipt facts | `receiptInput.ts` holds the receipt **schema** and the pure builders (`buildAdminReceipt`, `buildOwnerReceipt`, `withFilesRemoved`). The export facts reach it only as arguments. The single read of the export tables is `BusinessOsDataExportJobRepository.findDeletionFacts(userId)`. Its callers are `account/delete/route.ts`, `account/deletion-check/route.ts` and `admin/test-account-cleanup/delete/route.ts`, all owned by DELETE |
| Receipt table | `20261080` CHECKs: `(origin = 'owner') = (executor_kind = 'self_service')`, `(executor_kind = 'admin') = (executor_admin_id IS NOT NULL)`, and statement language and text both set or both NULL. An admin-run delete of an owner request (XC-6: origin `admin`, reason `customer_asked`, statement rebuilt from the stored language) fits neither existing builder: `buildAdminReceipt` forces the statement to NULL, and `buildOwnerReceipt` forces origin `owner` |
| Cleanup regeneration | The generator holds **one** `FUNCTION_MIGRATION` (`20261092_…meeting_links`) and **one** `PREVIOUS_FUNCTION_MIGRATION` (`20261081`). The drift test pins the committed SQL, the migration, the rollback and `cleanupFunctionVersion.generated.ts` to the generator output, and pins applied files by sha256 (`APPLIED`, `APPLIED_TARGET`). `no-deletion-paths.guard.test.ts` imports `MIGRATION_FILE` / `PREVIOUS_MIGRATION_FILE` and keeps hand-listed allow entries for older applied versions |
| Migration numbers | Highest on main is `20261092`. No local or remote branch holds `20261093`+. No open PR. **No test refuses two migrations with the same number** (historical duplicates exist before 20261093) |
| Export entry points | `oneExportControl.guard.test.ts` requires the four entry files (`app/business-os/settings/page.tsx`, `DangerZonePanel.tsx`, `components/settings/SecurityTab.tsx`, `components/v2/settings/SecurityTabV2.tsx`) to render `DownloadMyDataButton`. It also allows only `lib/client/businessOsDataExport.ts` to name the export route outside `app/api/` |
| Admin page | `BusinessDetail.tsx` mounts `<DataExportBlock>` (export) and `TestAccountCleanupPanel` / `DeleteBusinessDialog` (deletion) in separate places. The ready list belongs in `page.tsx` |
| Anchors | `events.ts`: `DATA_EXPORT_*` (l.122–127, 923–952) and `ACCOUNT_PSEUDONYMISED` / `ACCOUNT_DELETION_REFUSED` (l.184–190, 1263–1272). `eventAudience.ts` `DATA_EXPORT_*` l.109–114. Translations are flat keys (`settings.account_delete.*` l.4300+). `vercel.json` crons are one array, with `/api/cron/data-export` at l.86 |
| LX-1 | Still **uncommitted** in `neuronforge-lx1`. It touches `crm/page.tsx`, `MoneyList.tsx`, en/he/es, a CRM guard, and adds `components/crm/ContactsExportButton.tsx` and `components/payments/MoneyCapNotice.tsx` |

### Conditions

| # | Ruling | Applies to |
|---|---|---|
| **SR-1** | **`receiptInput.ts` belongs to DELETE, not EXPORT** (BA flag XC-6 vs ownership: ruled for XC-6). XC-12 needs **no** edit to that file: it changes the values `findDeletionFacts` returns, and "no receipt schema change" stands. DL-5 needs a builder for "an admin runs an owner's stored request" (origin `admin`, executor `admin`, reason `customer_asked`, statement language and text rebuilt from the server list). That builder can only live there. Rules: DELETE may add builders. DELETE may **not** change `receiptShape`, `DELETION_RECEIPT_INPUT_KEYS` or the `superRefine`, because the generator test compares those keys with the SQL (S-1). A key change is a regeneration and needs the S-1 lock. EXPORT owns only `findDeletionFacts` and the `DataExportDeletionFacts` type. Amend B.1 (move `receiptInput.ts` to DELETE's column), S-3 (now covers `findDeletionFacts` only), the XC-6 split note and the coordination file | Both |
| **SR-2** | **Frozen interface: the one DELETE can rely on from today to the end of this stream.** See "Frozen interface spec" below. EXPORT does not move, rename or re-sign it, **including in MX-6 and MX-7**. After MX-7 it reads only the new tables but keeps its class, path and name. A rename is a follow-up after DELETE's DL-5 has merged. With that rule, EXPORT never has to edit a DELETE-owned route | Both |
| **SR-3** | **S-1 covers more files than §11 lists.** A regeneration also edits: the pasted `CHECK_FILE` / `DELETE_FILE` SQL, `supabase/SQL Scripts/<N>_rollback.sql`, `lib/business-os/test-account-cleanup/cleanupFunctionVersion.generated.ts`, the `APPLIED` / `APPLIED_TARGET` pins and the "chains on …" test in `testAccountCleanupSql.test.ts`, and the **older-version allow-list entries in `lib/business-os/purge/__tests__/no-deletion-paths.guard.test.ts`** (each regeneration moves the previous file into "older applied"). B.1's "`no-deletion-paths.guard.test.ts`: DELETE owns" is amended. DELETE owns its rules (the anonymise-import guard of XC-6). Its regeneration allow-list entries go with whoever holds the S-1 lock. DL-1a also adds its session-cut migration to `SQL_AUTH_WRITE_ALLOW_LIST`, because `DELETE FROM auth.sessions` matches the guard. S-2 also covers `lib/business-os/businessOwnedTables.ts` (add only) | Both |
| **SR-4** | **Regeneration order: DL-1a, then MX-1a, then MX-7.** DL-1a has no dependency and no bold business question, so it takes the S-1 lock **today**. EXPORT reorders its pure slices first: **MX-0 → MX-2a → MX-2b → MX-1a → MX-1b → MX-3 → …**. MX-3 needs both MX-1b and MX-2b, so EXPORT's critical path does not change, and DL-1a gets about 5 working days of slack before MX-1a needs the lock. If the lock is still held when MX-2b is done, EXPORT may build MX-1a's tables, repositories and start function on a branch. It does not regenerate or apply until the lock is released, then rebases on `main` and regenerates. **Precondition for DL-1a:** `20261092` is applied on prod and the checker is green, because DL-1a's `PREVIOUS_FUNCTION_MIGRATION` becomes `20261092`. If it is not applied, stop and tell TL | Both |
| **SR-5** | **S-1: the markdown lock is still needed, but no new CI guard is.** On `main`, existing CI already blocks the race. Both regenerating PRs edit the same generator lines (`FUNCTION_MIGRATION`, `PREVIOUS_FUNCTION_MIGRATION`, the purpose/consequence arrays), the one-line version file and the same pin block. The second PR **always** has a textual conflict, which the merge queue cannot resolve. A wrong hand resolution fails the drift test (the committed SQL lacks the other PR's table), the sha256 pins, or "the generator writes a newer file than every applied one". See "Both regenerations open at once" below. What CI cannot see is **prod**: a regeneration applied from a stale branch. So every regeneration follows a **pre-apply check**: (a) the branch is rebased on current `origin/main` and green; (b) `origin/main`'s `FUNCTION_MIGRATION` equals the PR's `PREVIOUS_FUNCTION_MIGRATION`; (c) apply, then enqueue at once; (d) run the checker; (e) release the lock in the log | Both |
| **SR-6** | **MX-7 is two migrations, in this order:** first the regenerated function (number N), which no longer names `business_os_data_exports` (descriptor and `FUNCTION_REQUIRED_TABLES` entry removed in the same PR), and only then the DROP (N+1). Dropping first makes every check and delete fail with 42P01 until the function is replaced (closed, but admin deletes are paused). Reserve both numbers at once | EXPORT |
| **SR-7** | **Migration numbers.** B.3 stands, with additions. Each reservation row records number, slice and branch. MX-7 reserves two. DL-1a (the first migration slice) adds a pure Jest guard: no two `supabase/migrations/*.sql` files with a prefix of `20261093` or above share an 8-digit prefix. It reads one directory, takes milliseconds and runs in the existing job, so it adds no CI time. This is the only CI guard added by this review. It closes the gap where two sessions both take the "next free" number and both PRs merge cleanly, because the file names differ. It also covers other streams (other worktrees are open today), which take numbers without reading the coordination file. No worktree or branch held `20261093`+ at review time | DELETE (DL-1a) |
| **SR-8** | **XC-4 vs BQ-41 (BA flag): XC-4 is amended to defer to BQ-41.** New text: "a 'closed' email that Resend refuses is retried hourly, and the lock waits until it is accepted **or the BQ-41 cap is reached**". Both answers are technically sound. SA has no objection to the suggested 24 h cap: the requested, grace and reminder emails have already told the owner the date, and an unbounded wait would let a dead mailbox keep an account open forever. So that the schema does not depend on the answer, **DL-1a adds `closed_email_attempts int` and `closed_email_first_attempt_at`** whatever is decided. BQ-41 stays "before DL-4". A lock without an accepted email writes `ACCOUNT_LOCKED` with `details.closed_email = 'not_accepted'`, and the ready list shows it. A message Resend accepted counts as sent. Bounces are not tracked | DELETE |
| **SR-9** | **The export entry point DELETE links to (S-4)** is the existing `DownloadMyDataButton` (frozen, see below). Before and after MX-1b, DL-2's drawer renders `<DownloadMyDataButton variant="button" />` and nothing else for export. It never names an export route: guard check 4 refuses that anywhere outside `lib/client/businessOsDataExport.ts`. In MX-1b, EXPORT makes that **same component** open the export drawer when `isModuleExportEnabled()` is on. Settings, the Danger Zone, the AgentPilot security tabs and the deletion drawer then switch over without anyone editing them. When the export drawer opens from inside the deletion drawer, EXPORT's MX-1b handles focus and stacking and tests it once | Both |
| **SR-10** | **Rule for the merge-conflict hotspots: own anchor, add only, rebase just before enqueue.** Each scope inserts in **one contiguous block at its own anchor**, never at the end of a shared list. Two inserts at different anchors merge cleanly. Two inserts at the end of a file conflict every time. See the anchor table below | Both |
| **SR-11** | **Surfaces missing from B.1, now assigned.** See the table below. Anything else that is not listed: raise it in the coordination file first, as B.1 already says | Both |
| **SR-12** | **BA splices SR-1, SR-3, SR-9, SR-10 and SR-11 into §11 of both files, identically,** before either session's first Dev workplan is approved. TL re-checks that the two §11 sections are byte-identical. Until then, this section is the binding text. The coordination file's "Shared items" table was updated by SA today to match | BA / TL |

### Frozen interface spec (SR-2, SR-9)

**File:** `lib/repositories/BusinessOsDataExportJobRepository.ts` (owner: EXPORT)

```typescript
export interface DataExportDeletionFacts {
  ownerLastExportReadyAt: string | null;   // ISO or DB timestamp; null = none on record
  ownerExportDownloadedAt: string | null;  // always null for module exports (XC-12)
  adminExportExisted: boolean;
}

// new BusinessOsDataExportJobRepository(client?: SupabaseClient)
findDeletionFacts(userId: string): Promise<RepositoryResult<DataExportDeletionFacts>>;
```

| Contract | Value |
|---|---|
| Import | `import { BusinessOsDataExportJobRepository, type DataExportDeletionFacts } from '@/lib/repositories/BusinessOsDataExportJobRepository'`. The path, class, method and type names do not change in this stream |
| Behaviour | Never throws. Returns `{ data, error }`. An invalid uuid is an error with no DB call. Reads by `user_id` only (service role, documented) |
| Meaning before MX-4 | Today's: newest owner ZIP `ready_at`, its `owner_downloaded_at`, any admin ZIP |
| Meaning from MX-4 (XC-12) | `ownerLastExportReadyAt` = the newest of (owner ZIP `ready_at`, last **owner-origin module job accepted**). `ownerExportDownloadedAt` = NULL whenever a module export is the newest. `adminExportExisted` = any admin ZIP **or** any admin-origin request. After MX-7: new tables only |
| DELETE's side | Treats the values as opaque receipt and display facts. Tests mock the repository and never assert which table a value came from. Copy shown to the owner says "last export" (not "ready" or "downloaded"), so the change in meaning at MX-4 needs no DELETE change. On `error`: the check route shows "none on record" (as today), and the E route refuses before anything is removed (as today's routes do) |
| Change control | Any change is announced in the coordination file **before** its PR opens and must keep this signature. A signature change is out of this stream |

**File:** `components/business-os/data-export/DownloadMyDataButton.tsx` (owner: EXPORT)

```typescript
export interface DownloadMyDataButtonProps { variant: 'row' | 'button'; className?: string; }
export function DownloadMyDataButton(props: DownloadMyDataButtonProps): JSX.Element;
```

The name, path and props stay frozen through MX-6. The visible label may change, because it lives in EXPORT's `downloadMyDataCopy.ts`.

### Both regenerations open at once (SR-5)

A = DL-1a, B = MX-1a, both branched from the same `main` (M), both regenerating on top of `20261092`.

| Order | On `main` (CI) | On prod |
|---|---|---|
| A merges, then B is enqueued | B conflicts on the generator constants, the version file and the pin block, so the queue refuses it. Resolved correctly (rebase, regenerate, B's `PREVIOUS` = A's file, A's pair moved into `APPLIED`, the guard allow-list updated): B's migration is the A+B function and goes green. Resolved by hand without regenerating: the drift test or the sha256 pins fail. Nothing wrong can merge | Safe only if B is **applied after** the rebase. If B was applied from its stale branch, prod has the M+B function (no closure table in the plan) while `main` has M+A, so the version stamps differ and the check and E answer `function_out_of_date`. That fails closed: admin deletes and test-account cleanup pause until a fresh regeneration (a **new** number, since B's applied bytes are now history) is applied. No data is lost, but a closure row could outlive a test-account cleanup if anyone bypassed the version check. The pre-apply check (b) prevents this |
| B merges, then A is enqueued | The same, the other way round | The same, the other way round (the prod function would lack the export tables) |
| Both applied on prod from stale branches | Unreachable on `main`: the second PR still conflicts | The last one applied wins on prod, the stamp matches neither `main`, and everything pauses until a fresh regeneration. This is the case the lock exists for |

### Hotspot anchors (SR-10)

| File | EXPORT inserts | DELETE inserts |
|---|---|---|
| `lib/audit/events.ts` (`AUDIT_EVENTS` and `EVENT_METADATA`) | Directly after `DATA_EXPORT_DOWNLOADED_BY_ADMIN` in each map | Directly after `ACCOUNT_DELETION_REFUSED` in each map |
| `lib/audit/eventAudience.ts` | After `DATA_EXPORT_DOWNLOADED_BY_ADMIN` | After the last `ACCOUNT_*` / test-account entry |
| `lib/business-os/translations/{en,he,es}.ts` | One block, prefix `settings.data_export.*` / `export_module.*`, after the last existing data-export key | One block, prefixes `settings.account_delete.*` (extend in place), `settings.plan_cancel.*`, `account_closure.*` |
| `lib/utils/featureFlags.ts` | `isModuleExportEnabled()` at the end of the file | `isPlanSelfCancelEnabled()` directly after `isAccountSelfDeleteEnabled()` |
| `docs/FEATURE_FLAGS.md` | Its row at the end of the env-flag table | Its row directly after the `isAccountSelfDeleteEnabled` row |
| `vercel.json` `crons` | The worker entry directly after `/api/cron/data-export` (MX-6 then removes the neighbour, same owner) | The `:50` entry directly after `/api/cron/payment-reminders` |
| `lib/security/rateLimit.ts` `RATE_LIMITS` | Its keys in one block at its own anchor | Its keys in one block at its own anchor (not adjacent) |
| `DangerZonePanel.tsx`, `app/business-os/settings/page.tsx` | **No edit** (SR-9: the button switches itself) | Its own blocks |
| `app/admin/users/components/BusinessDetail.tsx`, `page.tsx` | **No edit**: MX-5 replaces the inside of `DataExportBlock` | The ready list, Unlock and run-delete mounts |

If EXPORT finds it must edit a file that this table says it does not, it records a short claim in the coordination file first.

### Surfaces added to ownership (SR-11)

| Surface | Owner |
|---|---|
| `components/business-os/data-export/**`, `lib/client/businessOsDataExport.ts`, `oneExportControl.guard.test.ts`, `components/settings/SecurityTab.tsx` and `components/v2/settings/SecurityTabV2.tsx` (export entry only) | EXPORT |
| `app/admin/users/components/DataExportBlock.tsx`, `DataExportReasonDialog.tsx`, `app/admin/users/dataExportCopy.ts` and their tests | EXPORT |
| After LX-1 merges: `components/crm/ContactsExportButton.tsx`, `components/payments/MoneyCapNotice.tsx` (EXPORT does not touch any LX-1 file until LX-1 is on `main`) | EXPORT |
| `lib/business-os/account-deletion/receiptInput.ts` (SR-1) | DELETE |
| `lib/business-os/account-deletion/selfServiceDeletion.ts`, `authCookies.ts` (part of `account-deletion/**`, named so nobody misses them) | DELETE |
| `lib/business-os/test-account-cleanup/**` except the generated version file (S-1), `lib/repositories/TestAccountCleanupRepository.ts`, `components/business-os/purge/TestAccountCleanupPanel.tsx`, `app/admin/users/deletionCopy.ts`, `app/admin/users/page.tsx`, `useBusinessDetails.ts`, `types.ts`, `usersFilters.ts` | DELETE |
| `lib/repositories/types.ts` and `lib/repositories/index.ts` | Shared, add only. **Prefer keeping new types in the repository file itself** (as `DataExportDeletionFacts` is) and not adding to the barrel |
| `lib/security/rateLimit.ts`, `lib/business-os/businessOwnedTables.ts` | Shared, add only (SR-10, SR-3) |

### First slice for each session

| Session | Starts today with | In parallel (optional, separate worktree) | Takes a shared lock? |
|---|---|---|---|
| **EXPORT** | **MX-0** (pure config, no migration) | MX-2a after MX-0 merges (pure) | No. The S-1 lock is needed only at MX-1a, after MX-2b |
| **DELETE** | **DL-1a** (the GoTrue spike is task 1; migration; regeneration) | **SX-1** (it shares only add-only registries with DL-1a) | **Yes: the S-1 "cleanup regen" lock, today**, plus the first migration number, `20261093` |

**Business-question timing changed by this review:** BQ-25 and BQ-27 move from "before MX-0" to "**before MX-4 switch-on**". MX-0 is one pure config file with no migration, so moving a section between modules later is a one-line change. EXPORT can start MX-0 today on BA's default. BQ-29 stays before MX-1a, and MX-1a now starts later, so there is more time for it. BQ-41 stays before DL-4 (SR-8 makes DL-1a independent of the answer). No new business question.

### Optimisation suggestions (not blocking)

- Both crons send through one Resend team limit (2 per second), and EXPORT's 5-minute worker also runs at :50. DL-3 should honour `retry-after` on a 429 the same way XC-8 asks of EXPORT.
- Whoever builds the S-10 idempotency key also fixes F-7 (the transport logs the attachment filename at `info`) in the same slice, since it is the same file.

### Approval

[x] Split approved with conditions SR-1 to SR-12. Both sessions may start: EXPORT with MX-0, DELETE with DL-1a (holding the S-1 lock) and optionally SX-1. No Dev workplan is approved until SR-12 is done.

---

## Change History

| Date | Change | Details |
|---|---|---|
| 2026-10-25 | Created (BA), split from the parent | DELETE scope cut out of `BUSINESS_OS_SELF_SERVICE_EXIT_REQUIREMENT.md` v2 + SA review 2026-10-25 so two sessions can build in parallel. Lifecycle A–E with SA amendments (closure row deleted at E, lock at the start of local day 15, 10-year ban + session cut, blocker filter, E route reading the stored request), Keep my account, plain cancel. Slices SX-1, SX-2, SX-3, SX-5 (8.5 d), DL-1a, DL-1b, DL-2, DL-3, DL-4, DL-5 (13.5 d), DL-4b (+1.5 d): 22 d / 23.5 d. LX-1 noted as built in this session before the split, then owned by EXPORT. BQ-20…BQ-24, BQ-32…BQ-36, BQ-38…BQ-41, BQ-35 (shared), carried BQ-7/9/11/12/15/17/18/19, open issues 1 and 2 (shared). SA conditions XC-1…XC-6, XC-14, XC-11/13/15/17/19/21 (shared) and carried v1 rulings copied. Identical boundary section with the EXPORT file |
| 2026-10-25 | SA Split Review (SA) | `## SA Split Review — 2026-10-25` added, identical in the EXPORT and DELETE files: ⚠️ approved with conditions SR-1…SR-12. `receiptInput.ts` moves to DELETE, and EXPORT owns only `findDeletionFacts` (frozen interface spec). S-1 covers more files (`no-deletion-paths.guard.test.ts` allow-list, version file, pins). Regeneration order DL-1a → MX-1a → MX-7, with a pre-apply check. MX-7 is two migrations. Duplicate-number Jest guard in DL-1a. XC-4 now defers to BQ-41 (cap columns in DL-1a). `DownloadMyDataButton` is the frozen export entry. Hotspot anchors. Unlisted surfaces assigned. BQ-25 and BQ-27 move to before MX-4 switch-on. First slices: EXPORT MX-0, DELETE DL-1a (+ SX-1) |
| 2026-10-25 | §11 updated with SA split rulings SR-1/3/9/10/11 (SR-12) | Spliced identically into §11 of the EXPORT and DELETE files; changed rows marked "(SR-n, 2026-10-25)". B.1: `receiptInput.ts` moved to DELETE (SR-1), guard rules vs regen allow-list and `SQL_AUTH_WRITE_ALLOW_LIST` (SR-3). B.2: S-1 lists every file under the cleanup-regen lock, order DL-1a → MX-1a → MX-7 and the pre-apply check (SR-3/4/5); S-2 adds `businessOwnedTables.ts`; S-3 now `findDeletionFacts` only; S-4 `DownloadMyDataButton variant="button"` (SR-9); S-5/S-6 DELETE only, EXPORT does not edit; S-7/8/9/11 own anchor (SR-10); new S-16/S-17 shared add-only (SR-11). B.3: reservation fields, MX-7 two migrations, duplicate-prefix guard (SR-6/7). B.4: rows updated. New B.6 frozen interfaces, B.7 hotspot anchors, B.8 more file assignments |
| 2026-10-26 | SX-1 as-built note (Dev, D2) | §6.2: SX-1 extends P-7a.1's engine (names on `main`, no `/plan/keep`); `trialing` manageable (P-7a TQ-14); `isPlanSelfCancelEnabled()` superseded for the plan cancel by P-7a C-1 / BQ-1 (§11 to follow at the next joint splice); per-attempt key, cancel-side `change_pending`, optional `reasonCode` in the existing audit key, one-path guard; `origin` and SX C-3 (incl. `cancel_at`) move to D6; BQ-11 scoped to the deletion request |
