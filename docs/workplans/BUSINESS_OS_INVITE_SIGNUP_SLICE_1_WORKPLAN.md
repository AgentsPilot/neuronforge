# Workplan: Business OS Invite-Only Signup, Slice 1 (Champion signup, end to end)

> **Last Updated**: 2026-09-28

**Developer:** Dev
**Requirement:** [BUSINESS_OS_INVITE_SIGNUP_REQUIREMENT.md](/docs/requirements/BUSINESS_OS_INVITE_SIGNUP_REQUIREMENT.md) (§10 Slice 1, §12 T-items, §13.1 BQs, §16.3 T-decisions, §16.5 L-1 to L-12)
**Previous slice:** [BUSINESS_OS_INVITE_SIGNUP_SLICE_0_WORKPLAN.md](/docs/workplans/BUSINESS_OS_INVITE_SIGNUP_SLICE_0_WORKPLAN.md) (merged, PR #128; migration `20261012` applied to production)
**Date:** 2026-09-28
**Branch:** `feature/bos-invite-signup-slice-1`, cut from `origin/main` at fd710c26 (the PR #128 merge) on 2026-09-28, in its own worktree (`neuronforge-invite-s1`). Every file reference below was checked against that commit.
**Status:** SA workplan review applied (R-1 to R-14, 2026-09-28). **1a: SA code-approved for QA (2026-09-28), CR-1 and CR-2 applied; uncommitted; QA next.** **1a: merged (PR #133); `20261013` applied to production with checker PASS.** **1b: Code Complete (2026-09-28), uncommitted on `feature/bos-invite-signup-slice-1b`, awaiting SA code review; FR-12a's admin indicator included.** 1c: approved as scoped, after 1a.

## Overview

Slice 1 turns the read-only invite page into a working signup for **champion** invites, with email and password (Google is Slice 3, confirmed by the user on 2026-09-28). After SA's review it ships as three sub-slices, each demoable and each with at most one migration: **1a** (the page knows when the invited email already has an account, and when the visitor is already signed in), **1b** (a champion signs up end to end: code email, claim-before-create, finalise, sign-in, lineage L1, tenant widening), and **1c** (the admin list filters and search deferred from Slice 0). Accounts are never deleted by this feature: the invite is claimed in the database, with a server-generated account id, before the auth user is created (R-1). Erasure is designed here and built later (R-12). This workplan maps every applicable SA condition to files and tests (§9) and records each finding's SA ruling (§13).

---

## Table of Contents

1. [Analysis Summary](#1-analysis-summary)
2. [Implementation Approach](#2-implementation-approach)
3. [Files to Create / Modify](#3-files-to-create--modify)
4. [Migration SQL](#4-migration-sql)
5. [Read-only verification scripts](#5-read-only-verification-scripts)
6. [Runbooks](#6-runbooks)
7. [API contracts](#7-api-contracts)
8. [Task List](#8-task-list)
9. [Traceability: L-1 to L-12 and T-decisions](#9-traceability-l-1-to-l-12-and-t-decisions)
10. [Rate limiting: decision](#10-rate-limiting-decision)
11. [Erasure design (L-12): designed, not built](#11-erasure-design-l-12-designed-not-built)
12. [Test plan](#12-test-plan)
13. [Findings for SA: rulings and implementation deviations](#13-findings-for-sa-rulings-and-implementation-deviations)
14. [Manual QA script (production, tester's own email)](#14-manual-qa-script-production-testers-own-email)
15. [Rollback](#15-rollback)
16. [Logging-standard check (console.*)](#16-logging-standard-check-console)
17. [Open issues and follow-ups](#17-open-issues-and-follow-ups)
18. [SA Review Notes](#sa-review-notes)
19. [QA Testing Report](#qa-testing-report)
20. [Commit Info](#commit-info)

---

## 1. Analysis Summary

| Area | What Slice 1 touches | Verified against `origin/main` fd710c26 |
|---|---|---|
| Database | **Two migrations** (R-11). `20261013` (1a): one column `opened_by_existing_account_at` and the SECURITY DEFINER lookup `business_os_auth_email_has_account`. `20261014` (1b): signup-code and claim columns, the `business_os_account_lineage` table, and the SECURITY INVOKER `business_os_finalise_invite_redemption` function. 1c has no migration. | Last migration is `20261012_business_os_invites.sql`; `20261013`/`20261014` are free on every `origin/*` branch. **Re-check at 1b implementation.** |
| Plan table | `business_os_account_plans.user_id` is `REFERENCES auth.users ON DELETE CASCADE`; `origin` is free text; a plain `INSERT` with `cohort`, `cohort_expires_at`, `origin = 'invite'` is valid; the onboarding and profile triggers only fill a missing fact on conflict (AB-15, AC-4). | `20261005_business_os_entitlements.sql` |
| Profiles | `create_user_settings()` is codified (`20261003`) and inserts `profiles` inside the `auth.users` insert with no `ON CONFLICT`, so a created user without a profile cannot exist. **T-10/L-7 are superseded; no ensure step** (R-7). | `20261003_codify_create_user_settings_trigger.sql` header |
| Tenant check | `isBusinessOsTenant` has three callers: `adminOps.ts`, `entitlements/accounts/[accountId]/route.ts`, `accounts/[accountId]/summary/route.ts`. Widening (L-4, 1b) changes all three; F-14 ruled intended. | `grep isBusinessOsTenant` |
| Deletion guard | `no-deletion-paths.guard.test.ts` forbids `auth.admin.deleteUser` anywhere; its allow-list stays **empty** (R-1, invariant I-1). | Guard lines 55–85, 240–245 |
| Auth | No `auth.admin.createUser` exists in the repo. `@supabase/auth-js` 2.75.1 `AdminUserAttributes` accepts `id` on `createUser` (SA verified), which R-1 relies on. `signInWithPassword` in `lib/client/auth-actions.ts` is audited. | SA re-check, `lib/client/auth-actions.ts:97` |
| Email | `sendEmail` logs `to` and the first 50 characters of `subject` at info, so the code is never in the subject. | `lib/notifications/emailTransport.ts:465-507` |
| Logger | Redaction covers `password`, `token`; adding `code` would censor `dbError.code` app-wide, so 1b adds `signupCode`, `*.signupCode`, `otp`, `*.otp` (R-3). | `lib/logger/config.ts:32-48` |
| Account deletion | No account-deletion or erasure path exists. Erasure is designed (§11) and **not built** in Slice 1 (R-12). | `lib/business-os/account/accountDeletionPolicy.ts` has no caller |
| Rate limiting | No limiter or shared store exists. **Decision (SA): per-invite counters only; the Vercel Firewall rule is hardening, not a gate** (§10). | — |
| Public page | `/invite` and `/api/*` already pass the middleware; `/invite` is a public prefix in `PlatformChrome`. No middleware change. | `middleware.ts:125` |

**Out of scope for Slice 1:** Google signup (Slice 3), the invitation email and resend (Slice 2), the inviter's saved-language default (Slice 2), closing open signup (Slice 4), paid invites (Slice 5; the finalise function refuses tier grants), the circle report (Slice 6), T-9, **the erasure build and the 12-month job** (§11, open item dated 2027-09-28), **profile ensure** (R-7), and **any deletion path** (R-1).

---

## 2. Implementation Approach

### 2.1 Split (F-16, SA-approved with cuts)

| Sub-slice | Scope | Migration | Demo |
|---|---|---|---|
| **1a — "The page knows who you are"** | `business_os_auth_email_has_account` behind `AuthAccountRepository.emailHasAccount` (import-pinned, R-4); the `existing_account` state on the validate route with a one-time `opened_by_existing_account_at` stamp and audit; the admin list shows "Opened by an existing account"; the signed-in-visitor notice with Sign out; copy in `en`/`he`/`es`. | `20261013` | QA §14.1 A1–A6, A8, A9 |
| **1b — "A champion signs up"** | Code email; request-code and complete routes; claim-before-create with invariants I-1 to I-6 (§2.4); finalise function; lineage L1; `grantRules` and the tenant widening (L-4); password sign-in in the browser; the list shows "Accepted, account, time, L1"; revoke refuses a live claim. | `20261014` | QA §14.2 (the §10 Slice 1 done-means) |
| **1c — Admin list filters and search** | FR-5 filters (state, type) and email search; `searchRecentForAdmin`; D-9. | none | QA §14.3 (A7) |

1c can ship any time after 1a. SA's optional preparatory PR (`grantRules` + the L-4 widening ahead of 1b) is available if the 1b diff is hard to review.

### 2.2 Module layout

| File | Responsibility | Sub-slice |
|---|---|---|
| `lib/repositories/AuthAccountRepository.ts` (new) | The only file that reaches `auth.users`. 1a: `emailHasAccount(email)` (the RPC; returns a boolean). 1b: `createConfirmedUser({ id, email, password })`, `findUserExists(id)` (`getUserById`). **No delete method, ever** (I-1). Not exported from the `lib/repositories` barrel, so every importer names it and the callers guard (R-4) can see them. | 1a, 1b |
| `app/invite/useSignedInVisitor.ts` (new) | Client hook: reads the browser session (`supabase.auth.getSession()`, no network) and exposes `{ status, email, signOut }`. Sign out goes through the audited `signOutUser`. | 1a |
| `lib/business-os/invites/publicInviteView.ts` (modified) | New matched state `existing_account`, decided before the offer is built and before `first_viewed_at` is stamped. | 1a |
| `lib/business-os/invites/signupCodePolicy.ts` (new) | `digits: 6`, `ttlMinutes: 10`, `maxAttempts: 5`, `minResendSeconds: 60`, `maxSendsPerWindow: 5`, `windowHours: 24`, `claimLeaseSeconds: 120`. | 1b |
| `lib/business-os/invites/signupCode.ts` (new) | Generate, hash (`sha256(inviteId + ':' + code)`, F-11), timing-safe compare, `maskEmail` (first character of the local part plus the domain, R-6), and the pure `decideCodeIssue` / `decideCodeAttempt`. | 1b |
| `lib/business-os/invites/inviteRedemption.ts` (new) | `requestSignupCode`, `completeSignup` (§2.4). | 1b |
| `lib/business-os/entitlements/grantRules.ts` (new) | T-2's shared pure validator, used by `adminOps` and the invite path. | 1b |
| `lib/email/templates/invite-signup-code.ts` (new) | The one Slice 1 email: "your AgentPilot sign-up code", valid 10 minutes, "ignore it if you did not ask"; no code in the subject (R-9). | 1b |
| `app/invite/SignupForm.tsx` (new) | Two steps; on success signs in with the password just set (SA amendment to T-3). | 1b |

### 2.3 Key decisions

| # | Decision | Why |
|---|---|---|
| D-1 | **Two migrations, one per sub-slice** (R-11, reverses the first draft's single migration). | 1a's SQL is final now; 1b's is still under SA re-check. An uncalled redemption function should not sit in production while 1b is reviewed. |
| D-2 | **The finalise function reads the grant from the invite row**; the cohort id is an expected value; the champion end date is computed in SQL at finalise time (F-5, SA amendment to L-5). TypeScript validates the row with `grantRules` before the claim (R-5). | GR-2; no second clock; "counted from signup". |
| D-3 | **Finalise refuses anything but an admin-issued cohort grant.** | Slice 1 redeems champions only; Slice 5 extends it. |
| D-4 | **Signup-code counters and the claim are compare-and-swap updates in the repository.** | Atomic in one statement; keeps the function count at one per migration. |
| D-5 | **The attempt is counted before the code is compared.** | A guess that is not counted first is free. |
| D-6 | **Sign-in after redemption is the browser's `signInWithPassword` with the password just set** (F-2, SA amendment to T-3). No server-minted session. | "The link never authenticates anyone" becomes structural. |
| D-7 | **The code email uses the platform's system sender** (no `from`, `replyTo`, `ownerUserId`), `kind: 'transactional'` (F-10). | A code is a platform security message; Reply-To a person invites "here is my code" replies. |
| D-8 | **Claim before create** (R-1): re-validate → count attempt → compare → one CAS that clears the code and claims the invite with a server-generated account id → `createUser({ id })` → finalise → audit. | Removes compensation entirely (§2.4). |
| D-9 | **1c:** state filter in TypeScript with `deriveInviteState`; type and email in SQL; 500-row ceiling; `truncated` shown. | C-11: one derivation of state (F-9). |
| D-10 | **Audit on public routes is `log(…).catch` then `await flush().catch`** before responding. | WC-7. |
| D-11 | **The plan-row write goes through `BusinessOsAccountPlanRepository.provisionFromInvite`** (in `WRITE_METHODS`). | The entitlements imports guard sees every plan writer (F-8). |
| D-12 | **1a reads the invitee email through its own narrow method** (`findInviteeEmailForPublicCheck(inviteId)`, `select('email')`), called only after the token matched and only for a pending, grant-available invite. The public-view select keeps excluding the email. | The row the response is built from never holds the email, so no future edit of the allow-list can leak it by accident; the lookup's argument is, by construction, the matched row's email (R-4). |
| D-13 | **The existing-account stamp reports whether it was set now** (`UPDATE … WHERE opened_by_existing_account_at IS NULL RETURNING id`), and the route audits only then. | "Opened by an existing account" is audited once, not per reload. |

### 2.4 Request flows (1b flows for SA's one-pass re-check)

**Validate (`POST /api/public/invites/validate`, 1a).** Unchanged up to "pending and grant available". Then: `findInviteeEmailForPublicCheck(row.id)` → `emailHasAccount(email)`. Either error returns 503 `unavailable_try_again` (never "no account"). `true` → `markOpenedByExistingAccount(row.id, now)`; if it stamped now, the route audits `BOS_INVITE_OPENED_BY_EXISTING_ACCOUNT` (actor null, entity = invite id, details = correlation id only) and flushes; a stamp failure is logged at `warn` and does not cost the visitor the page; the response is the narrow `{ state: 'existing_account', language, inviterDisplayName }`, and `first_viewed_at` is not stamped. `false` → the Slice 0 `valid` path (1b adds `maskedEmail`).

**Request code (`POST /api/public/invites/signup/code`, 1b).** Body `{ token }` `.strict()`. `getUser()` session → 409 `signed_in` (before any invite read) → format (else the identical `not_recognised`) → lookup (error 503) → state (not pending → 409 with the narrow state) → **live claim** (claimed within the lease) → 409 `signup_in_progress` → grant, issuance policy, type champion via `grantRules` (409 `unavailable` / `paid_invites_not_available`) → `emailHasAccount` (409 `existing_account`, stamp as above) → `decideCodeIssue` (429 `code_recently_sent` / `code_limit_reached` with `retryAfterSeconds`) → generate, hash, CAS store (lost race → 409 `try_again`) → `sendEmail` (not sent → 503 `code_not_sent`; still counts against the cap) → 200 `{ codeExpiresAt, resendAvailableAt }`.

**Complete (`POST /api/public/invites/signup/complete`, 1b).** Body `{ token, signupCode, password }` `.strict()`; `password` 8 characters minimum and **at most 72 bytes** (`new TextEncoder().encode(p).length <= 72`, R-13). The route exports `maxDuration = 60`.

1. `getUser()` session → 409 `signed_in`.
2. Format → lookup → state → **a live claim (within the lease) → 409 `signup_in_progress`, before any code check** (SA D-1: otherwise a second tab gets a misleading `code_expired`) → grant/policy/type (as above) → `emailHasAccount` → 409 `existing_account` if true, **unless** the row carries a stale claim (step 6's I-6 path decides).
3. `decideCodeAttempt`: no live code → 409 `code_expired`; attempts used up → 409 `code_locked`.
4. CAS count the attempt (`signup_code_attempts = observed`); lost → 409 `try_again`.
5. Timing-safe compare; mismatch → 409 `code_invalid` with `attemptsRemaining`.
6. **Claim** (one CAS): `SET signup_code_hash = NULL, signup_code_expires_at = NULL, claimed_at = now, claimed_account_id = X WHERE id = row.id AND signup_code_hash = H AND redeemed_at IS NULL AND revoked_at IS NULL AND link_expires_at > now AND (claimed_at IS NULL OR claimed_at < now − lease) AND claimed_account_id IS NOT DISTINCT FROM <observed>`. `X` is `row.claimed_account_id` when a stale claim exists (I-6), otherwise `crypto.randomUUID()` generated here (I-3). Lost → 409 `try_again`.
7. `createConfirmedUser({ id: X, email: row.email, password })` with `email_confirm: true` and no metadata.
   - Success with `created.id !== X` → **no finalise**; log at `error`; 503 (I-3). The claim is kept (D-dev-3, approved), and the FR-12a failure record (D-2) is written with step `create_user_id_mismatch` and the **returned** id as `redemption_failed_account_id`, so the unexplained account stays findable after the lease lapses. The invite is refused as `existing_account` afterwards, so nothing re-claims it.
   - `email_exists` → `findUserExists(X)`: exists → this invite's own account from an earlier interrupted attempt; go to 8. Does not exist → release (8a), 409 `existing_account`, audit `BOS_INVITE_REDEMPTION_REFUSED` (I-6).
   - `weak_password` → release, 400 `weak_password`.
   - Any other failure (including timeout) → `findUserExists(X)`: exists → go to 8; a positive "no such user" → release, 503 (I-4, refined; D-dev-2, approved). **Never release on uncertainty:** if `findUserExists(X)` itself fails, keep the claim, answer 503, and write the failure record with step `find_user`. Keeping is always safe because a re-claim reuses `X`.
8. **Finalise** (`provisionFromInvite({ inviteId, accountId: X, email: row.email, cohort: row.grant_id })`), retried once in-request. Returns the invite id → audit `BOS_INVITE_REDEEMED` and `BOS_INVITE_PLAN_PROVISIONED`, flush → 200 `{ email: row.email, redirectTo: '/onboarding-chat' }`, `no-store`. Returns `null` or errors twice → the claim is **kept**, the failure record is written with step `finalise`, 503, audit `BOS_INVITE_REDEMPTION_INCOMPLETE` (severity warning; details exactly the D-2 fields plus the invite id), flush (I-5). Recovery is the runbook entry in §6.2.
   - 8a. **Release** is a CAS `SET claimed_at = NULL, claimed_account_id = NULL WHERE id AND claimed_account_id = X AND redeemed_at IS NULL`. A failed release is harmless: no account exists, and the claim lapses after the lease (I-4).

**Invariants (tested in §12):**

| # | Invariant |
|---|---|
| **I-1** | No code path calls `auth.admin.deleteUser`. `AuthAccountRepository` has no delete method; the no-deletion guard's allow-list stays empty. |
| **I-2** | After a live claim, revoke and expiry cannot win. `revokeForAdmin`'s CAS adds `claimed_at IS NULL OR claimed_at < now − lease`; the admin route answers 409 `signup_in_progress`. Finalise does **not** re-check `link_expires_at` or `revoked_at`: the claim was the decision point. (If an admin revokes after a lease lapsed and recovery later runs finalise, Slice 0's `not_revoked_and_redeemed` CHECK aborts it: recovery of a revoked invite needs an admin decision, not a script.) |
| **I-3** | The account id is generated server-side (`crypto.randomUUID()`), recorded on the invite before the user exists, and never read from the request. A `createUser` result with a different id is never finalised (this also proves on QA B5 that hosted GoTrue honours `id`). |
| **I-4** | A `createUser` failure releases the claim with a CAS on the same `claimed_account_id`, **after** `findUserExists(X)` confirms no user was created (D-dev-2). |
| **I-5** | Finalise is one SQL function, `SECURITY INVOKER`, `SET search_path = ''`, keyed on `(invite id, claimed account id, email)`, idempotent (already finalised for the same account returns its id), writing `redeemed_at`/`redeemed_account_id`, the plan row (plain `INSERT`) and the lineage row; retried once in-request; on a second failure the claim is kept and `…_INCOMPLETE` is audited. |
| **I-6** | A claim older than the lease (120 s, longer than the route's `maxDuration = 60`) may be re-claimed, **reusing** the recorded `claimed_account_id` (the claim CAS is `.is('claimed_account_id', null)` when none was observed, `.eq(…)` otherwise: D-dev-1, approved); on `email_exists`, `findUserExists(X)` decides between "finish this invite's account" and "release, existing account". **This "user exists → finalise" branch is a race-only path (SA D-6):** once an account exists for the email, validate and the code route answer `existing_account` before any claim logic, so the invitee cannot get back to `complete`. The real recovery for an account whose finalise did not run is FR-12a plus the §6.2 runbook. The branch stays because it is cheap and correct. |

**FR-12a: a signup that stops halfway (SA D-2, D-3, D-7; decision T-16).**

- **Durable record on the invite row** (D-2): `redemption_failed_at`, `redemption_failed_step`, `redemption_error_code`, `redemption_error_message`, `redemption_failed_account_id`. Written by one repository `UPDATE` keyed on `id` and `claimed_account_id` whenever the flow ends with the claim kept: the I-3 id mismatch (`create_user_id_mismatch`), a failed `findUserExists` (`find_user`), a non-recoverable `createUser` failure where the user may exist (`create_user`), and the second finalise failure (`finalise`). Last failure wins; never cleared, so the history survives a recovery. The step vocabulary is a TypeScript constant, not an SQL value list. The message comes from `safeDbError` (M-1) or the auth error, truncated to 300 characters, **with any email-shaped substring replaced**. The `BOS_INVITE_REDEMPTION_INCOMPLETE` audit details repeat exactly these fields plus the invite id. Never email, token, hash, code or password, on the row, in the audit details, in log lines or in the admin view (AC-5a).
- **"Stopped halfway" is derived from data, not events** (D-3): `redeemed_at IS NULL` **and** (`redemption_failed_at IS NOT NULL` **or** `claimed_at` older than the lease). The second half catches the case no code can report: the function killed by its timeout between `createUser` and finalise.
- **One lease constant** (D-4): `claimLeaseSeconds = 120` in `signupCodePolicy.ts`, read by the claim CAS, the revoke CAS (I-2) and the D-3 condition, with a test that it exceeds the complete route's `maxDuration = 60`.
- **How admins are told: T-16 (SA decision).** An indicator on `/admin/business-os-invites`, **no email**. A banner "N signups stopped halfway" above the list (counts and invite ids only), and on each affected row a badge with the failing step, error code, scrubbed message, account id and time. `InviteListView` gains the D-2 fields and a derived `redemptionStoppedHalfway` flag computed in TypeScript with the lease constant (the C-11 one-derivation rule). No email because there is no admin sender yet, a best-effort email from a failing request can itself fail silently, and it cannot report the timeout case. The data-derived indicator catches every case and needs no cron, queue or sender. Honest limit: an admin must open the page to see it.
- **Priority** (D-7): the D-2 columns ship in `20261014` (a later column would mean a third migration); the admin indicator is the **last** task of 1b and may slip to a follow-up PR without holding the signup demo.

**Client after 200.** `SignupForm` calls `signInWithPassword(email, password)` then `router.replace('/onboarding-chat')`; on sign-in failure it shows "Your account is ready. Sign in" with the normal sign-in link (R-2).

### 2.5 Tenant isolation (`tenant-isolation-guard` skill)

| Skill step | How Slice 1 meets it |
|---|---|
| 1. Applies? | Yes: `supabaseServer`, a caller-supplied token, and a trigger on `auth.users`. |
| 2. Ownership pre-check | The token hash is the ownership oracle; the email lock binds the row to one person; the finalise `WHERE` repeats id, email and the claimed account id. **R-1 strengthens it:** the account id is minted by the server and recorded on the invite before the account exists. 1a: the lookup's only argument is the email of the row the token matched (D-12), never request data. |
| 3. Explicit allow-list | `.strict()` bodies. `createUser` receives exactly `{ id, email: row.email, password, email_confirm: true }`. Finalise parameters are all server-derived. |
| 4. Scope-defeating three | The `auth.users` trigger writes only `NEW.id` rows; no upsert; no injectable payload. |
| 7. Tests | Injected `email`/`userId`/`cohort`/`level`/`tier`/`accountId` keys give 400 with no repository call; `createUser` receives the claimed id; a mismatched id, email or cohort makes finalise return nothing; the 1a callers guard and the argument test (R-4). |

---

## 3. Files to Create / Modify

Verified against `origin/main` fd710c26. Counts are per sub-slice; a file touched in two sub-slices is counted once in the total.

### 3.1 Slice 1a (implemented; 8 created, 23 modified = 31 files, plus this workplan and the requirement's L-12 row)

| # | File | Action | Reason |
|---|---|---|---|
| a1 | `supabase/migrations/20261013_business_os_invite_existing_account.sql` | create | §4.1 |
| a2 | `supabase/SQL Scripts/20261013_business_os_invite_existing_account_rollback.sql` | create | §15 |
| a3 | `scripts/check-bos-invite-existing-account-migration.sql` | create | §5.1 |
| a4 | `supabase/migrations/__tests__/business-os-invite-existing-account.migration.test.ts` | create | Editor-safe text, privileges, pinned `search_path`, checker names match |
| a5 | `lib/repositories/AuthAccountRepository.ts` | create | L-3 (`emailHasAccount`) |
| a6 | `lib/repositories/__tests__/AuthAccountRepository.test.ts` | create | Method test: boolean in and out, lower-casing, error scrub, no email logged |
| a7 | `lib/repositories/__tests__/authAccountRepository.callers.guard.test.ts` | create | R-4: who may import it |
| a8 | `app/invite/useSignedInVisitor.ts` | create | L-8 notice (client hook, own file per code standards) |
| a9 | `lib/repositories/BusinessOsInviteRepository.ts` | modify | `findInviteeEmailForPublicCheck`, `markOpenedByExistingAccount`; admin select gains the stamp |
| a10 | `lib/repositories/__tests__/BusinessOsInviteRepository.test.ts` | modify | One test per new method; M-1 leak test extended |
| a11 | `lib/repositories/types.ts` | modify | `opened_by_existing_account_at` on the admin row |
| a12 | `lib/business-os/invites/publicInviteView.ts` | modify | `existing_account` state |
| a13 | `lib/business-os/invites/__tests__/publicInviteView.test.ts` | modify | State, ordering, R-4 argument test |
| a14 | `app/api/public/invites/validate/route.ts` | modify | New dependency, audit once, flush |
| a15 | `app/api/public/invites/validate/__tests__/route.test.ts` | modify | `existing_account`, 503 on lookup error, audit once, no email in any body |
| a16 | `app/invite/page.tsx` | modify | `existing_account` view; signed-in notice |
| a17 | `app/invite/invitePageCopy.ts` | modify | New strings in three languages |
| a18 | `app/invite/__tests__/page.render.test.tsx` | modify | New states and notice |
| a19 | `lib/business-os/invites/adminInviteOps.ts` | modify | List view gains `openedByExistingAccountAt` |
| a20 | `lib/business-os/invites/__tests__/adminInviteOps.test.ts` | modify | Key set updated |
| a21 | `app/admin/business-os-invites/types.ts` | modify | Payload type |
| a22 | `app/admin/business-os-invites/components/InviteList.tsx` | modify | "Opened by an existing account" |
| a23 | `app/admin/business-os-invites/__tests__/page.render.test.tsx` | modify | Renders the fact |
| a24 | `lib/audit/events.ts` | modify | `BOS_INVITE_OPENED_BY_EXISTING_ACCOUNT` + metadata |
| a25 | `lib/audit/eventAudience.ts` | modify | Tag `bos` |
| a26 | `lib/audit/__tests__/eventAudience.test.ts` | modify | 162/17 → 163/18 |
| a27 | `app/api/admin/business-os/invites/__tests__/route.test.ts` | modify | Found at implementation: two typed invite fixtures gain `opened_by_existing_account_at` |
| a28 | `app/api/admin/business-os/invites/__tests__/revoke.route.test.ts` | modify | Found at implementation: the typed invite fixture gains the field |
| a29 | `app/admin/components/AdminSidebar.tsx` | modify | User request (label only): the entry is renamed "Invites" → **"Signup Invites"**; route unchanged |
| a30 | `app/admin/components/__tests__/AdminSidebar.nav.test.ts` | modify | Pins the new name and the unchanged href/description |
| a31 | `app/admin/business-os-invites/page.tsx` | modify | Heading "Business OS Invites" → "Business OS Signup Invites" (label only; a23 pins it) |

`lib/repositories/index.ts` is **not** modified: `AuthAccountRepository` stays out of the barrel so the R-4 callers guard can see every importer (D-12/R-4).

### 3.2 Slice 1b (planned; for SA's re-check)

| # | File | Action | Reason |
|---|---|---|---|
| b1 | `supabase/migrations/20261014_business_os_invite_signup.sql` | create | §4.2 |
| b2 | `supabase/SQL Scripts/20261014_business_os_invite_signup_rollback.sql` | create | §15 |
| b3 | `scripts/check-bos-invite-signup-migration.sql` | create | §5.2 |
| b4 | `supabase/migrations/__tests__/business-os-invite-signup.migration.test.ts` | create | As a4, plus the finalise function's body terms |
| b5 | `lib/business-os/invites/signupCodePolicy.ts` | create | T-5 values, per-invite limits, lease |
| b6 | `lib/business-os/invites/signupCode.ts` | create | §2.2 |
| b7 | `lib/business-os/invites/inviteRedemption.ts` | create | §2.4 |
| b8 | `lib/business-os/entitlements/grantRules.ts` | create | T-2 |
| b9 | `lib/email/templates/invite-signup-code.ts` | create | L-2, R-9 |
| b10 | `app/api/public/invites/signup/code/route.ts` | create | Request a code |
| b11 | `app/api/public/invites/signup/complete/route.ts` | create | Claim, create, finalise (`maxDuration = 60`) |
| b12 | `app/invite/SignupForm.tsx` | create | Two-step form |
| b13 | `lib/repositories/BusinessOsAccountLineageRepository.ts` | create | `findByInviteIdsForAdmin` |
| b14–b21 | Tests: `signupCode`, `inviteRedemption`, `grantRules`, the template, both routes, the lineage repository, `SignupForm` | create | §12 |
| b22 | `lib/repositories/AuthAccountRepository.ts` (+ test, + callers guard) | modify | `createConfirmedUser`, `findUserExists` |
| b23 | `lib/repositories/BusinessOsInviteRepository.ts` (+ test) | modify | `findByTokenHashForRedemption`, `issueSignupCode`, `countSignupCodeAttempt`, `claimForSignup`, `releaseSignupClaim` (CAS); `revokeForAdmin` refuses a live claim (I-2) |
| b24 | `app/api/admin/business-os/invites/[inviteId]/revoke/route.ts` (+ test) | modify | 409 `signup_in_progress` |
| b25 | `lib/repositories/types.ts`, `lib/repositories/index.ts` | modify | New types; the lineage repository export |
| b26 | `lib/business-os/invites/publicInviteView.ts` (+ test), `inviteSchemas.ts` (+ test) | modify | `maskedEmail`; the two bodies, 72-byte password |
| b27 | `app/invite/page.tsx`, `invitePageCopy.ts` (+ test) | modify | Render `SignupForm`; remove the R-4 line |
| b28 | `lib/business-os/invites/adminInviteOps.ts` (+ test), admin `types.ts`, `InviteList.tsx` (+ test) | modify | Accepted: account id, time, level |
| b29 | `lib/audit/events.ts`, `eventAudience.ts` (+ test) | modify | `BOS_INVITE_REDEEMED`, `…_PLAN_PROVISIONED`, `…_REDEMPTION_REFUSED`, `…_REDEMPTION_INCOMPLETE`; counts recomputed at implementation |
| b30 | `lib/business-os/entitlements/adminOps.ts` (+ test) | modify | `grantRules`; L-4 |
| b31 | `app/api/admin/business-os/entitlements/accounts/[accountId]/route.ts`, `…/entitlements/__tests__/routes.test.ts` | modify | L-4 caller |
| b32 | `app/api/admin/business-os/accounts/[accountId]/summary/route.ts` + its two tests | modify | L-4 caller (R-8) |
| b33 | `lib/repositories/BusinessOsAccountPlanRepository.ts` (+ test) | modify | `hasPlanRow`, `provisionFromInvite` |
| b34 | `lib/repositories/__tests__/businessOsEntitlements.imports.guard.test.ts` | modify | `provisionFromInvite` in `WRITE_METHODS`; `inviteRedemption.ts`, its test and the summary route (read-only) in `ALLOWED` |
| b35 | `lib/business-os/purge/descriptors.ts`, baseline JSON, `descriptors.invariant.test.ts` | modify | Lineage `never` (count 129 → 130) |
| b36 | `lib/business-os/entitlements/__tests__/enforcementPoints.test.ts` | modify | New non-gate importers |
| b37 | `lib/logger/config.ts` | modify | R-3 redaction paths (+ test) |
| b38 | `docs/architecture/BUSINESS_OS_ENTITLEMENTS.md` | modify | `origin = 'invite'`; tenant definition |

**Estimate:** about 21 new files and about 30 modified (several re-touched from 1a), roughly 51 file touches. Exact counts are recorded at 1b implementation.

### 3.3 Slice 1c (planned)

`lib/business-os/invites/inviteSchemas.ts` (+ test: list query `.strict()`), `lib/repositories/BusinessOsInviteRepository.ts` (+ test: `searchRecentForAdmin`, reusing `ilikeContainsPattern`/`matchesLiterally`), `lib/business-os/invites/adminInviteOps.ts` (+ test: state filter via `deriveInviteState`, `truncated`), `app/api/admin/business-os/invites/route.ts` (+ test: query params, gate first), `app/admin/business-os-invites/page.tsx`, `types.ts`, `components/InviteList.tsx` (+ render test). **About 13 files, none new, no migration.**

### 3.4 Removed from Slice 1 by SA

`AuthAccountRepository.deleteUserCreatedByRedemption`, the no-deletion-guard allow-list entry (R-1); `UserProfileRepository.ensureRowForNewAccount` and its test (R-7); `email` nullability, `email_erased_at`, `eraseInviteeEmail`, `ACCOUNT_ERASURE_HOOKS` and the "Email erased" UI (R-12); runbook P1 and P2 (R-1, R-4).

---

## 4. Migration SQL

Editor rules for both files: no `--` or block comments; string literals only letters, digits, underscores and spaces (the empty literal in `SET search_path = ''` qualifies); small statements; no single-letter aliases; `REVOKE ALL` from the four roles, one statement each, then one narrow grant; `SET search_path = ''` on every function, all names qualified. Explanations are in §6.

### 4.1 `20261013` (Slice 1a)

**File:** `supabase/migrations/20261013_business_os_invite_existing_account.sql`

```sql
BEGIN;

ALTER TABLE public.business_os_invites ADD COLUMN opened_by_existing_account_at timestamptz;

CREATE FUNCTION public.business_os_auth_email_has_account(p_email text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM auth.users AS auth_user
    WHERE lower(auth_user.email) = lower(btrim(p_email))
  );
$$;

REVOKE ALL ON FUNCTION public.business_os_auth_email_has_account(text) FROM PUBLIC;

REVOKE ALL ON FUNCTION public.business_os_auth_email_has_account(text) FROM anon;

REVOKE ALL ON FUNCTION public.business_os_auth_email_has_account(text) FROM authenticated;

REVOKE ALL ON FUNCTION public.business_os_auth_email_has_account(text) FROM service_role;

GRANT EXECUTE ON FUNCTION public.business_os_auth_email_has_account(text) TO service_role;

COMMIT;
```

Totals: one nullable column, one function (DEFINER, `boolean`, `STABLE`), `EXECUTE` held only by `service_role`. No table privilege changes (the Slice 0 grants cover the new column).

### 4.2 `20261014` (Slice 1b; for SA's one-pass re-check)

**File:** `supabase/migrations/20261014_business_os_invite_signup.sql`

```sql
BEGIN;

ALTER TABLE public.business_os_invites ADD COLUMN signup_code_hash text;

ALTER TABLE public.business_os_invites ADD COLUMN signup_code_expires_at timestamptz;

ALTER TABLE public.business_os_invites ADD COLUMN signup_code_attempts integer NOT NULL DEFAULT 0;

ALTER TABLE public.business_os_invites ADD COLUMN signup_code_sent_count integer NOT NULL DEFAULT 0;

ALTER TABLE public.business_os_invites ADD COLUMN signup_code_window_started_at timestamptz;

ALTER TABLE public.business_os_invites ADD COLUMN signup_code_last_sent_at timestamptz;

ALTER TABLE public.business_os_invites ADD COLUMN claimed_at timestamptz;

ALTER TABLE public.business_os_invites ADD COLUMN claimed_account_id uuid;

ALTER TABLE public.business_os_invites ADD CONSTRAINT business_os_invites_signup_code_hash_length CHECK (signup_code_hash IS NULL OR char_length(signup_code_hash) = 64);

ALTER TABLE public.business_os_invites ADD CONSTRAINT business_os_invites_signup_code_paired CHECK ((signup_code_hash IS NULL) = (signup_code_expires_at IS NULL));

ALTER TABLE public.business_os_invites ADD CONSTRAINT business_os_invites_signup_code_counters CHECK (signup_code_attempts >= 0 AND signup_code_sent_count >= 0);

ALTER TABLE public.business_os_invites ADD CONSTRAINT business_os_invites_claim_paired CHECK ((claimed_at IS NULL) = (claimed_account_id IS NULL));

ALTER TABLE public.business_os_invites ADD CONSTRAINT business_os_invites_redeemed_by_claimant CHECK (redeemed_account_id IS NULL OR (claimed_account_id IS NOT NULL AND redeemed_account_id = claimed_account_id));

ALTER TABLE public.business_os_invites ADD COLUMN redemption_failed_at timestamptz;

ALTER TABLE public.business_os_invites ADD COLUMN redemption_failed_step text;

ALTER TABLE public.business_os_invites ADD COLUMN redemption_error_code text;

ALTER TABLE public.business_os_invites ADD COLUMN redemption_error_message text;

ALTER TABLE public.business_os_invites ADD COLUMN redemption_failed_account_id uuid;

ALTER TABLE public.business_os_invites ADD CONSTRAINT business_os_invites_redemption_failure_paired CHECK ((redemption_failed_at IS NULL AND redemption_failed_step IS NULL) OR (redemption_failed_at IS NOT NULL AND redemption_failed_step IS NOT NULL));

ALTER TABLE public.business_os_invites ADD CONSTRAINT business_os_invites_redemption_failure_lengths CHECK ((redemption_failed_step IS NULL OR char_length(redemption_failed_step) <= 64) AND (redemption_error_code IS NULL OR char_length(redemption_error_code) <= 64) AND (redemption_error_message IS NULL OR char_length(redemption_error_message) <= 300));

CREATE TABLE public.business_os_account_lineage (
  account_id uuid NOT NULL,
  invite_id uuid,
  source text NOT NULL,
  parent_account_id uuid,
  root_account_id uuid NOT NULL,
  level integer NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT business_os_account_lineage_pkey PRIMARY KEY (account_id)
);

ALTER TABLE public.business_os_account_lineage ADD CONSTRAINT business_os_account_lineage_invite_key UNIQUE (invite_id);

ALTER TABLE public.business_os_account_lineage ADD CONSTRAINT business_os_account_lineage_source_known CHECK (source IN ('admin_invite', 'account_invite', 'organic'));

ALTER TABLE public.business_os_account_lineage ADD CONSTRAINT business_os_account_lineage_invite_matches_source CHECK ((source = 'organic') = (invite_id IS NULL));

ALTER TABLE public.business_os_account_lineage ADD CONSTRAINT business_os_account_lineage_level_shape CHECK ((parent_account_id IS NULL AND level = 1 AND root_account_id = account_id) OR (parent_account_id IS NOT NULL AND parent_account_id <> account_id AND level > 1));

ALTER TABLE public.business_os_account_lineage ADD CONSTRAINT business_os_account_lineage_admin_invite_parentless CHECK (source <> 'admin_invite' OR parent_account_id IS NULL);

CREATE INDEX business_os_account_lineage_root_idx ON public.business_os_account_lineage (root_account_id);

CREATE INDEX business_os_account_lineage_parent_idx ON public.business_os_account_lineage (parent_account_id);

ALTER TABLE public.business_os_account_lineage ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.business_os_account_lineage FROM PUBLIC;

REVOKE ALL ON TABLE public.business_os_account_lineage FROM anon;

REVOKE ALL ON TABLE public.business_os_account_lineage FROM authenticated;

REVOKE ALL ON TABLE public.business_os_account_lineage FROM service_role;

GRANT SELECT, INSERT ON TABLE public.business_os_account_lineage TO service_role;

CREATE FUNCTION public.business_os_finalise_invite_redemption(p_invite_id uuid, p_account_id uuid, p_email text, p_cohort text)
RETURNS uuid
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  v_invite_id uuid;
  v_access_open_ended boolean;
  v_access_months integer;
BEGIN
  UPDATE public.business_os_invites AS invite_row
     SET redeemed_at = now(),
         redeemed_account_id = p_account_id,
         updated_at = now()
   WHERE invite_row.id = p_invite_id
     AND invite_row.claimed_account_id = p_account_id
     AND invite_row.email = p_email
     AND invite_row.issuer_kind = 'admin'
     AND invite_row.grant_kind = 'cohort'
     AND invite_row.grant_id = p_cohort
     AND invite_row.redeemed_at IS NULL
  RETURNING invite_row.id, invite_row.access_open_ended, invite_row.access_months
       INTO v_invite_id, v_access_open_ended, v_access_months;

  IF v_invite_id IS NULL THEN
    SELECT done_row.id INTO v_invite_id
      FROM public.business_os_invites AS done_row
     WHERE done_row.id = p_invite_id
       AND done_row.redeemed_account_id = p_account_id;
    RETURN v_invite_id;
  END IF;

  INSERT INTO public.business_os_account_plans (user_id, cohort, cohort_expires_at, origin, period_anchor, updated_at)
  VALUES (
    p_account_id,
    p_cohort,
    CASE WHEN v_access_open_ended THEN NULL ELSE now() + make_interval(months => v_access_months) END,
    'invite',
    now(),
    now()
  );

  INSERT INTO public.business_os_account_lineage (account_id, invite_id, source, parent_account_id, root_account_id, level)
  VALUES (p_account_id, v_invite_id, 'admin_invite', NULL, p_account_id, 1);

  RETURN v_invite_id;
END;
$$;

REVOKE ALL ON FUNCTION public.business_os_finalise_invite_redemption(uuid, uuid, text, text) FROM PUBLIC;

REVOKE ALL ON FUNCTION public.business_os_finalise_invite_redemption(uuid, uuid, text, text) FROM anon;

REVOKE ALL ON FUNCTION public.business_os_finalise_invite_redemption(uuid, uuid, text, text) FROM authenticated;

REVOKE ALL ON FUNCTION public.business_os_finalise_invite_redemption(uuid, uuid, text, text) FROM service_role;

GRANT EXECUTE ON FUNCTION public.business_os_finalise_invite_redemption(uuid, uuid, text, text) TO service_role;

COMMIT;
```

Notes for SA's re-check:
- **Idempotency (I-5):** the `UPDATE` runs first and takes the row lock; if it matches nothing, the `SELECT` (a new statement, so it sees a concurrent finaliser's commit under READ COMMITTED) returns the id when this account already owns the redemption, else `NULL`.
- **No `link_expires_at` / `revoked_at` check (I-2):** the claim was the decision point. A revoke after a lapsed lease is refused by Slice 0's `not_revoked_and_redeemed` CHECK, which surfaces as an error, not a silent redemption.
- **The plan and lineage inserts are plain `INSERT`s:** a conflict aborts the whole transaction, including the invite update.
- **`redeemed_by_claimant` is NULL-safe** (`claimed_account_id IS NOT NULL AND …`), following Slice 0's M-2 lesson. Slice 0's `redemption_complete` CHECK is untouched.
- **FR-12a columns (SA D-2):** five nullable columns; `redemption_failure_paired` is NULL-safe (M-2 style, both-or-neither written out); `redemption_failure_lengths` bounds step and code at 64 and the message at 300. No value list in SQL: the step vocabulary is a TypeScript constant.
- Totals (after D-2): **13 invite columns** (8 code/claim + 5 FR-12a), **7 new invite CHECKs (16 → 23)**, one table with PK, one unique, 4 CHECKs, 2 indexes, RLS on, no policy, no FK, no trigger, one INVOKER function.

---

## 5. Read-only verification scripts

Both follow Slice 0's checker: one read-only session, one final `SELECT`, `PASS`/`FAIL` rows, `aclexplode` over `COALESCE(acl, acldefault(…))`, and the pinned `search_path` compared through `chr(61)`/`chr(34)` so no literal contains `=` or `"`.

### 5.1 `scripts/check-bos-invite-existing-account-migration.sql` (1a)

| Row | Check | Expected |
|---|---|---|
| E01 | `opened_by_existing_account_at` exists on `business_os_invites` and is nullable | 1 |
| E02 | Invite table still has exactly 16 CHECK constraints (nothing else changed) | 16 |
| E03 | `business_os_auth_email_has_account` exists exactly once | 1 |
| E04 | It is SECURITY DEFINER, returns `boolean` | yes |
| E05 | Its settings are exactly `search_path=""` | yes |
| E06 | `PUBLIC`, `anon`, `authenticated` hold no privilege on it | none |
| E07 | `service_role` holds exactly `EXECUTE` | 1 |

The SQL is in the file; the migration test asserts the checker names the function and the column exactly as the migration does.

### 5.2 `scripts/check-bos-invite-signup-migration.sql` (1b)

| Row | Check |
|---|---|
| S01 | The thirteen new invite columns (eight code/claim, five FR-12a from SA D-2) |
| S02 | Seven new named invite CHECKs present (incl. `redemption_failure_paired`, `redemption_failure_lengths`); 23 in total |
| S03 | Lineage table exists with RLS on |
| S04 | Lineage has no policies |
| S05 | Lineage: `PUBLIC`/`anon`/`authenticated` hold nothing |
| S06 | Lineage: `service_role` holds exactly `SELECT INSERT` |
| S07 | Lineage PK, unique `invite_id`, four named CHECKs |
| S08 | Lineage has no FK and no trigger |
| S09 | Finalise function exists once, SECURITY INVOKER |
| S10 | Its settings are exactly `search_path=""` |
| S11 | No `EXECUTE` for `PUBLIC`/`anon`/`authenticated` |
| S12 | `service_role` may execute it |

The 1b migration text test pins the D-2 columns, both new CHECKs (including the NULL-safe pairing), and that the checker's lists match the migration.

---

## 6. Runbooks

### 6.1 Applying `20261013` (1a)

| Step | What | Expected | If not |
|---|---|---|---|
| 1 | Pre-check: `SELECT count(*) AS existing_account_columns FROM pg_attribute JOIN pg_class ON pg_class.oid = pg_attribute.attrelid JOIN pg_namespace ON pg_namespace.oid = pg_class.relnamespace WHERE pg_namespace.nspname = 'public' AND pg_class.relname = 'business_os_invites' AND pg_attribute.attname = 'opened_by_existing_account_at' AND NOT pg_attribute.attisdropped;` | `0` | `1` means already applied; go to step 3. |
| 2 | Paste the whole of `20261013_business_os_invite_existing_account.sql`. | "Success. No rows returned." | One transaction; any error rolls back. Send the text to Dev. |
| 3 | Paste `scripts/check-bos-invite-existing-account-migration.sql`. | `VERDICT PASS`, 7 pass | E06/E07 FAIL: re-run the four `REVOKE` lines and the `GRANT`, then step 3 again. Other FAIL: rollback (§15). |
| 4 | Paste the Slice 0 checker `scripts/check-bos-invites-migration.sql`. | `VERDICT PASS`, 11 pass | I07 counts the 16 Slice 0 names only; a FAIL here means something unexpected changed; rollback. |
| 5 | **Apply `20261013` and get checker `VERDICT PASS` (steps 2–4) BEFORE the PR is merged. The merge is the deploy** (merging to `main` deploys on Vercel). Only then merge the 1a PR. | An invite to an existing email shows "You already have an account"; the admin Signup Invites page lists, creates and revokes. | **Why the order matters (SA CR-1):** the admin select now names `opened_by_existing_account_at`, so without the column PostgREST rejects every admin read and write, and every valid invite link answers "try again" (missing function). If the code is already live without the migration: apply the migration at once, or revert the code (§15.1). |

**Why it looks this way:** the column is nullable, so Slice 0 code keeps working and never selects it. The function is SECURITY DEFINER because `service_role` cannot normally read the `auth` schema; it is hardened (empty `search_path`, `auth.users` qualified, returns a boolean only) and only `service_role` may execute it, which checker E06 proves on production. That is how it avoids joining the 50 anon-callable definer functions. The lookup's argument is always the email of an invite whose 256-bit token matched (D-12), so it is not an enumeration oracle (F-4 ruling). `lower(auth_user.email)` cannot use the `auth.users` email index; that is fine at current volume (SA optimisation note).

### 6.2 Applying `20261014` (1b)

Same shape: pre-check (`business_os_account_lineage` absent), paste, checker `VERDICT PASS` 12 pass, re-run the Slice 0 checker (its I07 counts its 16 names only, so it still passes with 23 CHECKs), and apply **before** merging the 1b PR (the CR-1 rule: the merge is the deploy).

**Note (SA N-2): after `20261014`, the 1a checker's E02 ("invite table still has 16 check constraints") FAILS by design**, because `20261014` adds seven. That is expected, not drift. Every other 1a row (E01, E03–E07) must still PASS.

**Recovery entry (I-5).** If `BOS_INVITE_REDEMPTION_INCOMPLETE` is audited:

(Or when the admin page shows "N signups stopped halfway", T-16.)

1. **Read-only list, no email selected (SA D-5a):** `SELECT invite_row.id, invite_row.claimed_account_id, invite_row.claimed_at, invite_row.redemption_failed_at, invite_row.redemption_failed_step, invite_row.redemption_error_code, invite_row.redemption_error_message, invite_row.redemption_failed_account_id FROM public.business_os_invites AS invite_row WHERE invite_row.claimed_at IS NOT NULL AND invite_row.redeemed_at IS NULL AND EXISTS (SELECT 1 FROM auth.users AS auth_user WHERE auth_user.id = invite_row.claimed_account_id);`
2. **Finalise with only the invite id typed (SA D-5b),** so a hand-copied email or grant is impossible: `SELECT public.business_os_finalise_invite_redemption(invite_row.id, invite_row.claimed_account_id, invite_row.email, invite_row.grant_id) FROM public.business_os_invites AS invite_row WHERE invite_row.id = '<invite id>';` (the editor runs as the function owner). A returned id means the account is complete; `NULL` means the row no longer matches (for example revoked after the lease), which needs an admin decision.
3. **If finalise fails with a unique violation on `business_os_account_plans` (SA D-5c):** the person signed in and began onboarding before recovery, so the onboarding trigger gave them a trial plan row. This needs an admin decision, not a new function: (a) set the plan on the Tiers page (cohort champion, the invite's access end); then (b) record the redemption and the lineage by hand, typing only the invite id:
   - `UPDATE public.business_os_invites AS invite_row SET redeemed_at = now(), redeemed_account_id = invite_row.claimed_account_id, updated_at = now() WHERE invite_row.id = '<invite id>' AND invite_row.redeemed_at IS NULL AND invite_row.claimed_account_id IS NOT NULL;`
   - `INSERT INTO public.business_os_account_lineage (account_id, invite_id, source, parent_account_id, root_account_id, level) SELECT invite_row.claimed_account_id, invite_row.id, 'admin_invite', NULL, invite_row.claimed_account_id, 1 FROM public.business_os_invites AS invite_row WHERE invite_row.id = '<invite id>';`

**Rate limiting:** the Firewall rule is no longer a gate (§10); former step P8 is removed.

---

## 7. API contracts

### 7.1 `POST /api/public/invites/validate` (1a)

`runtime = 'nodejs'`, `dynamic = 'force-dynamic'`, `Cache-Control: no-store`, `Referrer-Policy: no-referrer` on every response.

| `state` | Fields (exact key set) | New in |
|---|---|---|
| `not_recognised` | none; byte-identical for every bad token | — |
| `valid` | Slice 0 set; 1b adds `maskedEmail` | 1b |
| `existing_account` | `language`, `inviterDisplayName` | **1a** |
| `expired`, `revoked`, `used`, `unavailable` | `language`, `inviterDisplayName` | — |

`existing_account` is returned only for a matched, pending, grant-available token. 503 `unavailable_try_again` also covers a failed email read or account lookup.

### 7.2 `POST /api/public/invites/signup/code` (1b)

Body `{ token: string (max 512) }` `.strict()`. 200 `{ success: true, data: { codeExpiresAt, resendAvailableAt } }`; 200 identical `not_recognised`; 400 `invalid_request`; 409 `signed_in`, `existing_account`, `used`, `revoked`, `expired`, `unavailable`, `paid_invites_not_available`, `signup_in_progress`, `try_again`; 429 `code_recently_sent` / `code_limit_reached` with `retryAfterSeconds`; 503 `unavailable_try_again`, `code_not_sent`.

### 7.3 `POST /api/public/invites/signup/complete` (1b)

Body `{ token: string (max 512), signupCode: /^[0-9]{6}$/, password: string, 8 characters min, 72 UTF-8 bytes max }` `.strict()`. `maxDuration = 60`. 200 `{ success: true, data: { email, redirectTo: '/onboarding-chat' } }` (the full email only here, after mailbox proof, F-6); 200 identical `not_recognised`; 400 `invalid_request`, `weak_password`; 409 `signed_in`, `existing_account`, `used`, `revoked`, `expired`, `unavailable`, `paid_invites_not_available`, `code_expired`, `code_locked`, `code_invalid` (with `attemptsRemaining`), `try_again`; 503 `unavailable_try_again`.

### 7.4 `POST /api/admin/business-os/invites/[inviteId]/revoke` (1b change)

New 409 `signup_in_progress` when the invite carries a live claim (I-2).

### 7.5 `GET /api/admin/business-os/invites`

1a: each row adds `openedByExistingAccountAt`. 1b: `redeemedAccountId`, `level`. 1c: query `state?`, `inviteType?`, `q?` (`.strict()`) and `truncated`. Never `token_hash`, `issuer_admin_id`, `internal_reason`, or any signup-code or claim column.

---

## 8. Task List

### Setup

- ✅ **Step 0** — `git branch --show-current` is `feature/bos-invite-signup-slice-1` in `neuronforge-invite-s1`; `20261013` and `20261014` free on `origin/main`.
- ✅ **Step R** — SA's R-1 to R-14 applied to this workplan (2026-09-28).

### Slice 1a — "The page knows who you are"

- ✅ **1a-1** — Migration `20261013`, rollback, checker, migration text test (a1–a4).
- ✅ **1a-2** — `AuthAccountRepository.emailHasAccount`, its test and the callers guard (a5–a7).
- ✅ **1a-3** — Invite repository: `findInviteeEmailForPublicCheck`, `markOpenedByExistingAccount`; admin select gains the stamp; tests (a9–a11).
- ✅ **1a-4** — `publicInviteView` `existing_account` state; validate route with audit-once and flush; audit event, audience tag, pinned counts; tests (a12–a15, a24–a26).
- ✅ **1a-5** — Invite page: `existing_account` view with Sign in; `useSignedInVisitor` and the signed-in notice with Sign out; copy in three languages; tests (a8, a16–a18).
- ✅ **1a-6** — Admin list shows "Opened by an existing account"; tests (a19–a23, a27–a28).
- ✅ **1a-6b** — User request (label only): sidebar entry "Invites" → "Signup Invites", page heading "Business OS Signup Invites"; route `/admin/business-os-invites` unchanged; nav and render tests updated (a29–a31, a23).
- ✅ **1a-7** — Local verification (results in §8 Step 1a-9).
- ⬜ **1a-8** — SA code review of the uncommitted diff. **No commit**; RM commits after SA, QA and user approval.
- ✅ **1a-9** — Implementation record: see "1a implementation record" below.

### Slice 1b — "A champion signs up" (starts only after SA's one-pass re-check of §2.4 and §4.2)

- ✅ **1b-0** — SA re-check of §2.4 and §4.2 done (2026-09-28); D-1 to D-7 folded in. Branch `feature/bos-invite-signup-slice-1b` cut from `origin/main` aa9d75e9 (after 1a merged as PR #133 and `20261013` was applied); `20261014` re-checked free on every `origin/*` branch.
- ✅ **1b-1** — `grantRules.ts` and its test; `adminOps.ts` uses `championEndDecisionMissing` for its three RC-4 checks; existing `adminOps` tests unchanged and green.
- ✅ **1b-2** — L-4: `isBusinessOsTenant` gains a `planRepository` input and reads the plan row last; all three callers pass it (the summary route per R-8); tests on the write path, the read route and the summary route; imports guard updated. (D-dev-9: reuses `findEntitlementInputs`; no `hasPlanRow` method.)
- ✅ **1b-3** — Migration `20261014`, rollback, checker (S01–S12), migration text test; lineage registered `never` in purge descriptors (count 129 → 130).
- ✅ **1b-4** — `signupCodePolicy.ts` (incl. the lease, D-4), `signupCode.ts` (incl. `maskEmail` R-6 and the D-2 scrub), the code email template; tests; logger redaction `signupCode`/`otp` with a test (R-3).
- ✅ **1b-5** — `AuthAccountRepository.createConfirmedUser` / `findUserExists` (no delete, I-1); invite repository `findByTokenHashForRedemption`, `issueSignupCode`, `countSignupCodeAttempt`, `claimForSignup`, `releaseSignupClaim`, `recordRedemptionFailure` (all CAS); `revokeForAdmin` refuses a live claim (I-2); `BusinessOsAccountPlanRepository.provisionFromInvite`; `BusinessOsAccountLineageRepository`; tests including the M-1 scrub for every new method.
- ✅ **1b-6** — `inviteRedemption.ts` and its test (every I-1 to I-6 case, D-1, D-dev-1/2/3, AC-5, AC-6, AC-8, AC-5a).
- ✅ **1b-7** — Both signup routes (the complete route declares `maxDuration = 60`); `redemptionDeps.ts` (production wiring, system sender); revoke 409 `signup_in_progress`; four audit events; `enforcementPoints` entries; route and wiring tests.
- ✅ **1b-8** — `SignupForm.tsx`, `maskedEmail`, the R-4 line removed; SA N-1 copy in `en`/`he`/`es`; tests.
- ✅ **1b-9** — Admin list: accepted account id, time and L1 (lineage read only for accepted rows); entitlements doc row.
- ✅ **1b-10** — FR-12a admin indicator (T-16): the "N signups stopped halfway" banner and the per-row badge (step, code, scrubbed message, account id, time; "timed out before it could record why" for the D-3 timeout case). **Made it into 1b** (not slipped).
- ✅ **1b-11** — Local verification (below). SA code review next. **No commit.**

### 1b implementation record

**Files: 23 created, 42 modified (65, including this workplan and the entitlements doc), uncommitted on `feature/bos-invite-signup-slice-1b`.**

| Created | |
|---|---|
| SQL | `supabase/migrations/20261014_business_os_invite_signup.sql`, `supabase/SQL Scripts/20261014_business_os_invite_signup_rollback.sql`, `scripts/check-bos-invite-signup-migration.sql` |
| Code | `lib/business-os/invites/signupCodePolicy.ts`, `signupCode.ts`, `inviteRedemption.ts`, `redemptionDeps.ts`; `lib/business-os/entitlements/grantRules.ts`; `lib/email/templates/invite-signup-code.ts`; `lib/repositories/BusinessOsAccountLineageRepository.ts`; `app/api/public/invites/signup/code/route.ts`, `complete/route.ts`; `app/invite/SignupForm.tsx` |
| Tests | `supabase/migrations/__tests__/business-os-invite-signup.migration.test.ts`; `lib/business-os/invites/__tests__/signupCode.test.ts`, `inviteRedemption.test.ts`, `redemptionDeps.test.ts`; `lib/business-os/entitlements/__tests__/grantRules.test.ts`; `lib/email/templates/__tests__/invite-signup-code.test.ts`; `lib/repositories/__tests__/BusinessOsAccountLineageRepository.test.ts`; `lib/logger/__tests__/redaction.signupCode.test.ts`; `app/api/public/invites/signup/__tests__/routes.test.ts`; `app/invite/__tests__/SignupForm.render.test.tsx` |

Modified: `lib/business-os/entitlements/adminOps.ts` (+ test); the two other tenant-check callers (+ their tests); `BusinessOsAccountPlanRepository.ts` (+ test), `BusinessOsInviteRepository.ts` (+ test), `AuthAccountRepository.ts` (+ test), `lib/repositories/types.ts`, `index.ts`; `lib/business-os/invites/adminInviteOps.ts` (+ test), `publicInviteView.ts` (+ test), `inviteSchemas.ts`; the validate route test; the admin invites and revoke route tests; `app/invite/page.tsx`, `invitePageCopy.ts` (+ page test); the admin page, `types.ts`, `InviteList.tsx` (+ render test); `lib/audit/events.ts`, `eventAudience.ts` (+ test, 163/18 → 167/22); `lib/logger/config.ts`; purge `descriptors.ts`, baseline JSON, invariant test; the three guards (`enforcementPoints`, `businessOsEntitlements.imports`, the `AuthAccountRepository` callers guard); `docs/architecture/BUSINESS_OS_ENTITLEMENTS.md`; this workplan.

**Verification (2026-09-28):**

| Check | Result |
|---|---|
| Invite, admin, entitlements, purge, repositories, audit, logger, templates, migrations suites plus every `*guard*`/`*forbidden*`/`*invariant*` suite (174 suites) | **3,520 pass, 2 fail, both pre-existing** (below); the UI suites that timed out once under a full-machine run pass in isolation; `SignupForm.render.test.tsx` now sets a 30 s timeout |
| `npm run test:authz-guard` | 119 / 119, CAPS untouched |
| `npm run test:bos-entitlements` | 82 suites, 1,651 pass, 1 fail: the pre-existing `enforcementPoints` failure (below) |
| Pre-existing failure 1 | `enforcementPoints.test.ts` › `lib/business-os/llm/aiActionAudit.ts` unaccounted: introduced on main by the credit-deduction slice 2 and **fixed on `origin/main` by PR #134 (`0620c0f5`)**, verified by running the test on a clean `origin/main` checkout. Disappears on rebase. |
| Pre-existing failure 2 | `app/api/admin/business-os/entitlements/__tests__/routes.test.ts` › "account on a tier" (`payments.reminders` decided by `basis`, not `lifecycle_gate`): **still fails on a clean `origin/main` (7c21d009)**, so SA N-3's note that PR #129 fixed it does not hold for this test. Untouched by this slice. |
| `eslint` on the 59 touched `.ts`/`.tsx` files | 0 errors; 5 warnings, all on lines this slice did not write |
| `npm run lint:hooks` | clean |
| `tsc --noEmit` | 0 errors in any touched file |
| `next build` (CI placeholder env from `.github/workflows/build.yml`) | **exit 0**, compiled successfully; `/api/public/invites/signup/code`, `/api/public/invites/signup/complete`, `/invite` (11.7 kB) and `/admin/business-os-invites` in the route table |

**Deviations from the workplan (1b):**

| # | What | Why |
|---|---|---|
| D-dev-9 | No `hasPlanRow` method: `isBusinessOsTenant` reuses the existing `findEntitlementInputs` read, only when a profile and an onboarding message both say no. | One fewer repository method and no new query shape; the read is already used by every caller's next step. |
| D-dev-10 | `inviteRedemption.ts` takes the finalise call as an injected function; only `redemptionDeps.ts` names the plan repository, and the imports guard pins that it calls exactly one write method, `provisionFromInvite` (new category `invite_redemption`). | Keeps the flow testable and keeps the list of plan-state writers explicit (F-8). |
| D-dev-11 | Code-route `existing_account` also stamps `opened_by_existing_account_at` and audits the first open, as the validate route does. | One behaviour for one fact, whichever route sees it first. |
| D-dev-12 | The "other" `createUser` failure where `findUserExists` says "no user" releases the claim and answers 503 without a failure record. | The claim is not kept, so FR-12a (a record of a KEPT claim) does not apply; the release makes the invite usable again. |
| D-dev-13 | The signup form counts UTF-8 bytes per code point instead of with `TextEncoder`. | The same number; the test environment has no `TextEncoder`, and the server check (the authority) uses it. |
| D-dev-14 | The FR-12a banner points admins to the §6.2 recovery runbook in the workplan, naming the file path (`docs/workplans/BUSINESS_OS_INVITE_SIGNUP_SLICE_1_WORKPLAN.md` §6.2) per SA's review. | There is no in-app recovery action by design (SA D-5: the operator runs the SQL). |
| D-dev-16 | **QA 1b notes (2026-09-29).** QA-1b-1: the migration test pins checker S06's pass condition. QA-1b-2: the banner test asserts the runbook path. QA-1b-4: §15.2 now says a re-apply after rollback fails once any signup happened, and gives the back-fill. QA-1b-7: the password schema caps at 256 characters before the byte count (tested with 100,000 characters). **Known, not changed:** QA-1b-5 (the banner only sees the newest 200 invites), QA-1b-6 and QA-1b-8, as QA recorded them. QA-1b-3 is for the user. No SQL changed. | QA Report 1b. |
| D-dev-15 | **SA code review 1b fixes (2026-09-28).** MF-1: `sendEmail` gains an opt-in `redactRecipientInLogs`; with it, `to` is logged masked and email-shaped text is stripped from logged and returned provider errors; `redemptionDeps.ts` sets it; other senders unchanged (tested both ways; `emailTransport.ts` has 0 `console.*`). MF-2: `issueSignupCode`'s CAS also compares the observed `signup_code_last_sent_at` (null-safe `IS NULL` / `eq`), requires `link_expires_at > now` and no live claim; a 24 h-rollover race test proves one winner. N-1 weak-password copy (send a new code) in `en`/`he`/`es`; N-2 warn log when the session check fails (both routes, tested); N-3 a failed lineage read is logged (tested); N-4 the double JSDoc merged. **No SQL changed:** `20261014` stays as SA approved it. | SA code review 1b, MF-1, MF-2 and nits. |

### Slice 1c — Admin list filters and search (after 1a)

- ✅ **1c-1** — Filters (state, type), email search, 500-row ceiling, `truncated`, UI controls, tests. Branch `feature/bos-invite-signup-slice-1c` (off `origin/main` 8cdff1cb), uncommitted.
  - **Deviation from D-9 / §3.3 / §7.5 (as directed at hand-off, 2026-09-29):** filters and search run **on the screen** over the rows the GET already returns, not in SQL. So there is no `searchRecentForAdmin`, no list query schema and no new query parameter: the route takes none and ignores any (tested: a query string changes nothing and is never logged). `listRecentForAdmin` keeps its name. Search input never leaves the component. The state filter matches the server-decided `state` (from `deriveInviteState`), `openedByExistingAccountAt` and `redemptionStoppedHalfway` (D-3); the screen compares no date (C-11, source-guard test). "Opened by an existing account" and "stopped halfway" are conditions, not states. Search is a plain case-insensitive `includes`, so `%`, `_`, `*` are literal.
  - **Ceiling:** `INVITE_LIST_CEILING = 500` in `adminInviteOps.ts`, passed to `listRecentForAdmin({ limit })`; the repository clamp `BUSINESS_OS_INVITE_LIST_LIMIT` is raised 200 → 500 (pinned equal by test). `truncated = rows ≥ 500` ("may be older ones"; exactly 500 rows also reads as truncated). This also widens QA-1b-5 (the T-16 banner now sees the newest 500).
  - **Lineage batching:** `findByInviteIdsForAdmin` refuses > 200 ids, so with a 500 ceiling the accepted rows are read in batches of 200 (`INVITE_LINEAGE_BATCH`, pinned ≤ `LINEAGE_LOOKUP_LIMIT`).
  - **Files (9 modified, 2 new):** `lib/business-os/invites/adminInviteOps.ts` (+ test), `lib/repositories/BusinessOsInviteRepository.ts` (+ test), `app/api/admin/business-os/invites/route.ts` (+ test), `app/admin/business-os-invites/page.tsx`, `types.ts`, `components/InviteList.tsx`, `__tests__/page.render.test.tsx`, `__tests__/source.guard.test.ts`; new `app/admin/business-os-invites/inviteFilter.ts`, `components/InviteFilters.tsx`.
  - **Verification:** invites suites 17/17, 458 tests pass; `npm run test:authz-guard` 119/119; `adminReadMethods.guard` + `enforcementPoints` 76/76; eslint clean on touched files; `tsc` reports nothing in touched files. No route added, so no `next build`.
- ✅ **1c-2** — SA code review APPROVED with no findings (2026-09-29; invites suites 475 tests pass, `npm run test:authz-guard` 119/119). User reviewed the diff and approved the commit on 2026-09-29. No separate QA A7 report was recorded for this slice. Committed on `feature/bos-invite-signup-slice-1c` and opened as a PR; no DB change, merge once CI is green.

### 1a implementation record

**Files (31):** created a1–a8; modified a9–a31 (§3.1). Uncommitted on `feature/bos-invite-signup-slice-1`. `node_modules` in this worktree is a junction to the Slice 0 worktree's (identical `package.json`/lockfile), not a tracked file.

**Verification (2026-09-28):**

| Check | Result |
|---|---|
| New and touched suites plus every `*guard*`, `*forbidden*`, `*invariant*` suite in `app/ lib/ components/ hooks/ supabase/ scripts/`, `lib/audit`, `lib/repositories/__tests__`, `supabase/migrations/__tests__` | **122 suites, 2,282 tests, all pass** (includes `no-deletion-paths.guard`, `tierLiteral.forbidden`, `adminReadMethods.guard`, `businessOsEntitlements.imports.guard`, the new callers guard) |
| `npm run test:authz-guard` | **119 / 119 pass**, `CAPS` untouched (no admin handler added) |
| `npm run test:bos-entitlements` | 79 suites, 1,564 pass, **1 fail: the pre-existing `customerPlanView.test.ts` (28 vs 29)**, known since Slice 0 and untouched here |
| Second pre-existing failure (SA N-3) | `app/api/admin/business-os/entitlements/__tests__/routes.test.ts` › "account on a tier": `payments.reminders` is decided by `basis`, not `lifecycle_gate`. Found in SA's wider run (outside `test:bos-entitlements`). Both failures come from the Founding Partner / `payments.reminders` catalog change and are **fixed on `origin/main` by PR #129 (`674ea389`)**. This diff touches nothing under `lib/business-os/entitlements/` or `app/api/admin/business-os/entitlements/`. **Rebase onto `origin/main` before the PR** so neither appears in CI. |
| CR-2 (after SA review) | `authAccountRepository.callers.guard.test.ts` now also scans `app/ lib/ components/ hooks/ scripts/ supabase/` (`.ts`/`.tsx`/`.js`/`.mjs`/`.sql`) for the SQL function name `business_os_auth_email_has_account`; allowed only in the repository, its test, the guard, and the migration, rollback, checker and migration test. 7/7 pass, including a negative control. |
| `eslint` on the 28 touched `.ts`/`.tsx` files | **0 errors**; 2 pre-existing warnings on lines this slice did not change (`lib/audit/events.ts:1042`, `lib/repositories/types.ts:393`) |
| `npm run lint:hooks` | clean |
| `tsc --noEmit` (whole project) | 0 errors in any touched file (the project has 2,083 pre-existing errors elsewhere; `next.config.js` ignores them) |
| `next build` with the CI placeholder env (`.github/workflows/build.yml`) | **exit 0**, compiled successfully; `/invite` (8.8 kB), `/admin/business-os-invites`, both admin invite routes and `/api/public/invites/validate` in the route table. The `Dynamic server usage … cookies` lines are the usual build-time noise from untouched routes. |

**Deviations from the workplan found at implementation:**

| # | What | Why |
|---|---|---|
| D-dev-4 | Five extra files (a27–a31): two admin route tests needed the new field on typed fixtures, and the user's label request touched the sidebar, its nav test and the page heading. | ts-jest type-checks fixtures; the label change was requested mid-slice. |
| D-dev-5 | The signed-in check lives in its own client hook (`app/invite/useSignedInVisitor.ts`) and is shown only on `valid` and `existing_account`. | Code standard: hooks in dedicated files. On expired, revoked, used or unavailable invites there is nothing to accept, so asking the visitor to sign out would be noise. |
| D-dev-6 | On `existing_account`, a signed-in visitor sees the sign-out notice and **no** Sign in button. | Offering "Sign in" to someone already signed in is confusing, and the notice already says what to do. |
| D-dev-7 | The view's outcome carries `firstOpenByExistingAccount: true` only when this view set the stamp (absent otherwise), and the route audits only then. | Keeps the Slice 0 outcome shape equal for every other state (existing `toEqual` assertions unchanged) while making "audit once" explicit (D-13). |
| D-dev-8 | **QA fixes (2026-09-28).** QA-1: the migration test pins the checker's E06 role list and E07 pass condition. QA-2: the callers guard also scans root-level deployed files (`middleware.ts`, `i18n.ts`, config files), one level deep. QA-3: the existing-account Sign in button renders only once the session check says `signed_out`, never while it is pending (two tests, the invite check resolving before `getSession`). QA-5: the label "Business OS Signup Invites" in the admin page header comment and in the audit filter group (`lib/audit/filterOptions.ts`); no test pinned the old label. QA-6: the Hebrew signed-in heading wraps the email in a left-to-right isolate (U+2066 … U+2069), with a test. QA-4 was a note, no change. | Test results after the fixes: invite suites 25 suites / 490 tests pass; `test:authz-guard` 119/119; eslint clean on the 7 touched files. |

---

## 9. Traceability: L-1 to L-12 and T-decisions

### 9.1 Later-slice conditions

| L | Sub-slice | What it requires (as amended by SA) | Satisfied by | Proven by |
|---|---|---|---|---|
| **L-1** | 1b | T-4 order (as replaced by R-1); the account id is **server-generated and bound by the claim**; the body is token, password and code only | §2.4 steps 6–8; `X = crypto.randomUUID()` recorded on the invite before `createUser({ id: X })`; `.strict()` body | Injected `userId`/`accountId`/`email`/`cohort`/`tier`/`level` → 400 with no repository call; `createConfirmedUser` receives `id: X`; finalise receives `X`; a different id from `createUser` is never finalised (I-3) |
| **L-2** | 1b | One code per T-5; exactly one email; `kind: 'transactional'`; redaction **amended**: `signupCode`, `*.signupCode`, `otp`, `*.otp`, not `code` (F-3) | D-7, template, R-3 | `sendEmail` once per issued code, `kind: 'transactional'`, no `from`/`replyTo`/`ownerUserId`; no code in the subject; logger spy never sees code, token, hash; redaction test |
| **L-3** | **1a** | Existing-account check via a `service_role`-only SQL function on `lower(email)`, privileges per C-2, not `listUsers` | `business_os_auth_email_has_account` (DEFINER, F-4 approved) behind `AuthAccountRepository.emailHasAccount`; the argument is always the matched row's email (D-12) | Checker E03–E07; migration text test; repository test; callers guard and argument test (R-4) |
| **L-4** | 1b | Tenant = profile OR onboarding OR any plan row, tested on the write path and the read route | `hasPlanRow`; three callers (R-8) | `adminOps.test`, `routes.test`, summary route tests: plan-row-only account is a tenant / 200 |
| **L-5** | 1b | **Amended (F-5):** plan-row write inside the finalise function through a repository method; cohort id validated in TS and passed as an expected value; **the end date is derived in SQL from the server-side row** | `provisionFromInvite` → finalise; `grantRules` before the claim (R-5) | Finalise tests: open-ended → `NULL`; 12 months → now + 12 months; cohort mismatch → no row; tier grant → no row; migration test: no plan-name literal |
| **L-6** | 1b | Lineage: PK `account_id`, no FKs, level ≥ 1, C-2 privileges, registered per C-10 | §4.2; `never(…, G)` | Checker S03–S08; descriptors invariant |
| **L-7** | — | **Superseded (R-7):** the codified trigger (`20261003`) inserts `profiles` inside the `auth.users` insert with no `ON CONFLICT`, so signup fails closed | No ensure step | — |
| **L-8** | 1a + 1b | Sign-in only for the account this request created; signed-in visitors asked to sign out | **1a:** the page shows "You're signed in as … sign out" with an audited Sign out and never shows a sign-in prompt to a signed-in visitor. **1b:** browser password sign-in with the password just set (SA amendment to T-3), and 409 `signed_in` from both signup routes | 1a page tests; 1b route and form tests |
| **L-9** | Slice 2 | — | The two transport facts (Gmail fallback From; `to` logged at info) are stated; neither exposes the code | QA B3 records the production From (R-9) |
| **L-10** | Slices 3–4 | — | Slice 1 adds no public `signUp`; accounts are created through the admin API | `grep` in QA |
| **L-11** | Slice 5 | — | Finalise refuses tier grants | Finalise test |
| **L-12** | Design only | Erasure and the 12-month anonymisation | §11 design; **open item, owner TL, first qualifying date 2027-09-28**, recorded in the requirement's L-12 row (R-12) | — |

**Per-IP rate limit (Slice 0 note):** superseded by SA's §10 decision; not a gate.

### 9.2 T-decisions

| T | Slice 1 application |
|---|---|
| **T-1** | Lineage in 1b (§4.2), explicit columns, structural CHECKs, no FKs. |
| **T-2** | Provisioned in-process through finalise; `grantRules` shared with `adminOps`; tenant = any plan row. |
| **T-3** | **SA amendment (F-2):** `createUser({ id, email, password, email_confirm: true })` after mailbox proof; sign-in is the browser's password sign-in; `generateLink` is dropped. |
| **T-4** | **Replaced by R-1:** claim before create, finalise after, no compensation, no deletion (I-1 to I-6). |
| **T-5** | Always a 6-digit code before the claim; hashed; 10 minutes; 5 attempts; per-invite send limits (§10). |
| **T-7** | Unchanged: fragment, POST bodies, `no-referrer`, `no-store`, never logged. |
| **T-10** | **Superseded (R-7).** |
| **T-12** | Code email and page copy in the invite row's `language`. |
| **T-15** | Issuance policy and paid switch re-checked at both signup routes. |

---

## 10. Rate limiting: decision

**SA decision (2026-09-28): 1b ships with option A only. The Vercel Firewall per-IP rule (B) is requested from Offir in parallel as hardening and is not a go-live gate. Option C (DB per-IP table) is rejected.**

| Option | Status |
|---|---|
| **A. Per-invite counters on the invite row** | **Built in 1b.** Code resend no sooner than 60 s; at most 5 codes per 24 h; at most 5 attempts per code (about 25 guesses a day against 10^6); code-email spam needs a real link and is capped at 5 a day. |
| **B. Vercel Firewall rule on `/api/public/invites/`** | **Requested from Offir by the user on 2026-09-28** (tracked as [OI-1](#oi-1)). Hardening for cost and availability; QA B16 verifies it at the end of Slice 1. |
| C. DB per-IP bucket table | Rejected: a write per public request plus a cleanup cron that itself needs `CRON_SECRET`. |
| D. `@vercel/firewall` SDK, E. Upstash/KV | Not pursued (new dependency or vendor, same ops dependency as B). |
| In-memory limiter | Does not work on Vercel serverless. |

This supersedes the Slice 0 note that the per-IP rule "should be in place before Slice 1 hands links to real invitees".

---

## 11. Erasure design (L-12): designed, not built

**Ruling R-12: design accepted, build deferred.** Nothing below is built in Slice 1: no `email` nullability, no `email_erased_at`, no `eraseInviteeEmail`, no `ACCOUNT_ERASURE_HOOKS` edit, no "Email erased" UI.

| Case | Design |
|---|---|
| **Account erasure** | Every invite whose `email` equals the erased person's normalised email, or whose `redeemed_account_id` is the erased account: email and `personal_note` removed (the column becomes nullable in that future migration, with an erasure stamp and a CHECK pairing them), signup code cleared. Lineage rows are kept (they hold no email; F-12). Wiring waits for an account-erasure path, which does not exist (the backlog item "account deletion never calls erasure"). Tables with no `user_id` column must be named in `accountDeletionPolicy.ts` at that time, because the `user_id` sweep cannot see them. |
| **Unused invites after 12 months** | `redeemed_at IS NULL AND least(link_expires_at, COALESCE(revoked_at, link_expires_at)) < now() - interval '12 months'`: the same anonymisation. Per SA: a set-based idempotent `UPDATE` with fail-closed `CRON_SECRET` auth and a `bos_cron_runs` record satisfies `durable-queue-drain` for this shape; the claim, reaper and dead-letter parts of §8.1 apply only if it becomes per-row work. |
| **Open item** | **Owner TL. First qualifying date 2027-09-28** (an invite revoked on 2026-09-28). Depends on `CRON_SECRET`. Recorded in the requirement's L-12 row. |

---

## 12. Test plan

### 12.1 Slice 1a

| Suite | Cases |
|---|---|
| Migration text (a4) | No `--`/`/*`; literals `^[A-Za-z0-9_ ]*$`; no single-letter alias; exactly one `ALTER TABLE … ADD COLUMN` (nullable, no default); exactly one function, `SECURITY DEFINER`, `STABLE`, `RETURNS boolean`, `SET search_path = ''`, `auth.users` schema-qualified; `REVOKE ALL` on it from exactly `PUBLIC`, `anon`, `authenticated`, `service_role`; exactly one `GRANT EXECUTE … TO service_role`; no enumerated `REVOKE`; no plan-name literal; no `CREATE TABLE`/`TRIGGER`/`POLICY`; the checker names the same function and column; the rollback drops exactly what the migration adds |
| `AuthAccountRepository` (a6) | `emailHasAccount`: calls `rpc('business_os_auth_email_has_account', { p_email })` with the trimmed lower-cased email; `true`/`false`; a non-boolean result is an error; an RPC error returns `{ error }` scrubbed to `{ code, message }` with no `details`/`hint` and no email in any log call |
| Callers guard (a7) | Only the repository, its test, the guard, `publicInviteView.ts`, the validate route (and, from 1b, `inviteRedemption.ts` and its test) name `AuthAccountRepository`/`authAccountRepository`; it is not exported from the barrel |
| Invite repository (a10) | `findInviteeEmailForPublicCheck` selects exactly `email` by `id`; `markOpenedByExistingAccount` filters `is('opened_by_existing_account_at', null)`, sets `updated_at`, returns `true` only when a row came back; admin columns include the stamp; M-1 leak test covers both |
| Public view (a13) | `existing_account` key set exactly `{ state, language, inviterDisplayName }`; decided before the offer and before `markFirstViewed`; the email read and the lookup run only for a pending, grant-available match; **the lookup's argument is exactly what the email read returned for the matched row's id (R-4)**; either failure → `{ ok: false }`; stamp failure logged, page still answered; `firstExistingAccountOpen` true only when stamped now |
| Validate route (a15) | `existing_account` body; audit once with actor null, entity the invite id, details without email/token/hash; flush after log; a rejected flush still 200; no audit on a second load; 503 on lookup error; no raw email in any response body (serialised search) |
| Page (a18) | `existing_account` in `en`/`he`/`es` with Sign in; signed-in notice with the email and Sign out on `valid` and `existing_account`, no Sign in button while signed in; Sign out calls `signOutUser` and re-checks the invite; not shown for other states |
| Admin list (a20, a23) | `openedByExistingAccountAt` in the key set; rendered in the row |
| Audience (a26) | 163 registered, 18 `bos` |
| Guards | `test:authz-guard` (no new admin handler), `tierLiteral.forbidden`, `no-deletion-paths.guard` (allow-list unchanged), `adminReadMethods.guard`, `enforcementPoints`, `next build` |

### 12.2 Slice 1b (for SA's re-check)

| Suite | Cases |
|---|---|
| Migration text (b4) | As a4 for the lineage table and finalise; finalise is `SECURITY INVOKER`; its `WHERE` contains `claimed_account_id = p_account_id`, `email = p_email`, `redeemed_at IS NULL`, `grant_kind = 'cohort'`, `issuer_kind = 'admin'`, and **not** `link_expires_at` or `revoked_at` (I-2); plan insert not `ON CONFLICT`; `redeemed_by_claimant` contains `claimed_account_id IS NOT NULL` |
| Redemption (b15) | **I-1:** no `deleteUser` anywhere (the guard) and no delete method on the repository. **I-2:** revoke CAS carries the lease condition; the route answers 409 `signup_in_progress`; finalise is called without an expiry check even when the clock is past `link_expires_at` after the claim. **I-3:** `createConfirmedUser` receives the claimed id; a different returned id → no finalise, 503, `error` log. **I-4:** `createUser` failure with `findUserExists(X) = false` → release CAS on `X`; `= true` → finalise. **I-5:** finalise retried once; second failure keeps the claim, 503, `…_INCOMPLETE` audited with invite and account ids only. **I-6:** stale claim → re-claim reuses `X`; `email_exists` + user exists → finalise; + not exists → release, `existing_account`. **AC-5:** two completes with one code: one loses the claim CAS; two invites to one email: the second `createUser` → `email_exists` with no user at its `X` → release. **AC-6/L-1:** injected fields → 400, no dependency called. **AC-8:** no claim before a matched code. **D-1:** a live claim → 409 `signup_in_progress` before any code check (complete route). **D-dev-2:** `findUserExists` failing → claim kept, 503, failure record step `find_user`, no release. **D-dev-3:** id mismatch → failure record with the **returned** id and step `create_user_id_mismatch`. **D-dev-1:** the claim CAS uses `.is('claimed_account_id', null)` / `.eq(…)` on the observed value. |
| FR-12a record and indicator (D-2, D-3, D-4, T-16) | The record is written only when the claim is kept; last failure wins; never cleared by a later success; the message is truncated to 300 and **an email inside an error message is replaced** (fixture with an address); AC-5a: no email, token, hash, code or password on the row write, the audit details, the logs or the admin view; `redemptionStoppedHalfway` true for a failure record and for a claim older than the lease with no record (the timeout case), false otherwise; the lease constant exceeds `maxDuration`; banner counts and ids only |
| Code, complete routes | Session → 409 before any read; identical `not_recognised`; every 409/429; `maxDuration = 60`; `no-store`; token, code, password, email in no log |
| Schemas | 72-byte password bound with a multi-byte string under 72 characters (R-13) |
| Signup code | Boundaries of resend, window, attempts, expiry; `maskEmail` 1-, 2-, long local parts (R-6) |
| Template | Three languages, RTL, code in the body only (R-9) |
| Tenant widening, imports guard, finalise function cases | §9 L-4, L-5 |

### 12.3 Slice 1c

Query schema `.strict()`; state filtered through `deriveInviteState` (source test: no `link_expires_at` comparison in `adminInviteOps`); search literal for `%`, `_`, `*`; `truncated`; gate first on 401/403 with no read.

**Pre-existing failure:** `customerPlanView.test.ts` (28 vs 29), known since Slice 0 and unrelated.

---

## 13. Findings for SA: rulings and implementation deviations

### 13.1 Workplan findings, with SA's rulings

| # | Finding (short) | SA ruling | Applied in |
|---|---|---|---|
| **F-1** | T-4 compensation conflicts with the no-deletion guard, D3 and unknown FK behaviour | **Rejected as written; replaced by R-1** (claim before create; no `deleteUser`, no guard entry, no ban) | §2.4, I-1 to I-6, §4.2, §6.2 |
| **F-2** | Sign in with the password just set instead of `generateLink` | **Approved** (SA amendment to T-3) | D-6, §9 L-8/T-3 |
| **F-3** | Redacting `code` would censor `dbError.code` app-wide | **Approved**: `signupCode`, `*.signupCode`, `otp`, `*.otp` | L-2, b37 |
| **F-4** | The lookup must be SECURITY DEFINER | **Approved** with R-4; runbook P2 dropped | §4.1, §6.1, a5–a7 |
| **F-5** | End date computed in SQL from the row | **Approved** (SA amendment to L-5) | D-2, §4.2 |
| **F-6** | `maskedEmail` on the page; full email only after proof | **Approved** | §7.1, §7.3 |
| **F-7** | Profiles trigger is codified | **Approved; the ensure step is dropped** (R-7) | §9 L-7, §3.4 |
| **F-8** | Plan write through the plan repository | **Approved** | D-11, b33–b34 |
| **F-9** | State filter in TS | **Approved; moved to 1c** | D-9, §3.3 |
| **F-10** | Code email from the system sender | **Correct technical reading; not a business change** | D-7, R-9 |
| **F-11** | Unkeyed SHA-256 over invite id and code | **Approved** (with a separator, `id:code`) | §2.2 |
| **F-12** | Lineage keeps pseudonymous ids | **Approved** | §11 |
| **F-13** | Supabase email OTP not used | **Agreed** | — |
| **F-14** | Third tenant-check caller | **Intended** (R-8) | b32, b34 |
| **F-15** | QA accounts stay on production | **Noted** (user awareness) | §14 |
| **F-16** | Split | **Approved with cuts** (R-11): 1a, 1b, 1c | §2.1, §3 |

### 13.2 Deviations for SA's 1b re-check

| # | What | Why |
|---|---|---|
| **D-dev-1** | The claim CAS also compares `claimed_account_id` with the observed value (`IS NOT DISTINCT FROM`). | Without it, two requests re-claiming the same stale claim could both pass the lease condition; with it, exactly one wins, and both would use the same `X` anyway (I-6). |
| **D-dev-2** | I-4 refined: on **any** `createUser` failure other than a clean `weak_password` refusal, `findUserExists(X)` runs before the release. | A timeout or 5xx can hide a user that was in fact created. Releasing then would lose `X` and leave an account its invite no longer points at, the anonymous orphan R-1 exists to prevent. With the check, such an account is finalised instead. |
| **D-dev-3** | A `createUser` success with a mismatched id keeps the claim rather than releasing it. | Releasing would let the invite be claimed again with a new id while an unexplained account exists for the email; keeping it makes the case visible in the §6.2 recovery query and lapses after the lease. |

**SA rulings (design re-check, 2026-09-28):** D-dev-1 **approved**. D-dev-2 **approved, with "never release on uncertainty"** (a failed `findUserExists` keeps the claim and writes step `find_user`). D-dev-3 **approved, with** the failure record storing the returned id and step `create_user_id_mismatch`. SA's D-1 to D-7 and the **T-16 decision (admin-page indicator, no email)** are folded into §2.4, §4.2, §5.2, §6.2, §8 and §12.2.

---

## 14. Manual QA script (production, tester's own email)

`<you>` is the tester's own sign-in address; `<you+s1a>` a plus-address of it (or a second mailbox the tester owns). **Never a real invitee's address.**

### 14.1 Slice 1a (after `20261013` is applied and §6.1 steps 3–4 PASS)

| # | Do | Expect | Pass? |
|---|---|---|---|
| A1 | Admin, Invites: create a champion invite for **`<you>`**, 1 month, 15 days, reason "QA slice 1a". Copy the link. | Link shown once; row Pending. | ⬜ |
| A2 | Private window, paste the link. | "You already have an account" in the invite's language, with **Sign in** going to the normal sign-in page. No offer, no note. | ⬜ |
| A3 | DevTools, Application, Cookies for the platform origin in that window. | No Supabase session cookie was set. | ⬜ |
| A4 | Reload the admin list. | Still **Pending**, with "Opened by an existing account" and a date. | ⬜ |
| A5 | Reload the link twice more; check `audit_trail` for `BOS_INVITE_OPENED_BY_EXISTING_ACCOUNT`. | Exactly **one** entry, with the invite id, no email, token or hash. | ⬜ |
| A6 | In your normal, signed-in window, open the link. | "You're signed in as `<you>`. Sign out to accept this invitation", with Sign out and no Sign in button. Clicking Sign out signs you out and the page re-checks. | ⬜ |
| A8 | Read-only SQL: `SELECT opened_by_existing_account_at, redeemed_at FROM public.business_os_invites WHERE email = '<you>';` | Stamp set, `redeemed_at` null. | ⬜ |
| A9 | Revoke the A1 invite ("QA cleanup"). | Revoked. | ⬜ |

### 14.2 Slice 1b (after `20261014`)

| # | Do | Expect | Pass? |
|---|---|---|---|
| B1 | Create two champion invites for **`<you+s1a>`**: X with 1 month, Y with no end date. | Both Pending. | ⬜ |
| B2 | Private window, link X. | Valid page, masked address, "Send me a code". | ⬜ |
| B3 | Send a code; send again within a minute. **Record the From display name and address shown** (R-9). | Code email from the platform sender, no code in the subject; the second click says to wait. | ⬜ |
| B4 | Wrong code + password. | "Not right", 4 attempts left. | ⬜ |
| B5 | Right code + password. | Lands on `/onboarding-chat`, signed in as `<you+s1a>`. (Also proves `createUser` honoured the server-generated id, I-3.) | ⬜ |
| B6 | Admin list. | X Accepted with account id, time, **L1**; Y Pending. | ⬜ |
| B7 | Tiers page, look up the account id. | Found; champion; end date about 1 month out. | ⬜ |
| B8 | Read-only SQL on the plan row and the lineage row for that account. | `champion`, about now + 1 month, `invite`; lineage X, `admin_invite`, no parent, root = self, level 1; the invite's `claimed_account_id = redeemed_account_id`. | ⬜ |
| B9 | One onboarding message, then re-read the plan row. | Cohort and expiry unchanged; `onboarding_started_at` set (AC-4). | ⬜ |
| B10 | Link X again. | "Already used, sign in". | ⬜ |
| B11 | Link Y. | "You already have an account"; Y stays Pending. | ⬜ |
| B12 | Invite Z for `<you+s1b>`: request a code, wait 11 minutes, enter it. | "Code expired". | ⬜ |
| B13 | Z: new code, 5 wrong, then right. | Locked after 5; a new code works. | ⬜ |
| B14 | Z: two tabs, one code, submit both quickly. | Exactly one account; the other tab is refused. | ⬜ |
| B15 | While a submit is in flight (or immediately after a claim), try to revoke Z from the admin page. | 409 "signup in progress" (I-2). | ⬜ |
| B16 | **[OI-1](#oi-1), only once Offir's rule `bos-public-invites-rate-limit` exists:** send more than 30 POSTs within 60 s from one IP to `/api/public/invites/validate` on production; then wait out the window and send one normal request. | 429 after the 30th request in the window; the normal request after the window succeeds. Record the result against OI-1. | ⬜ |
| B17 | Leak check: logs for token prefixes, codes, passwords; audit rows for the invite ids. | No match; no token, hash, code or password in audit details. | ⬜ |
| B18 | Clean-up: revoke every pending test invite. | The test accounts stay (F-15); 1-month access lapses by itself. | ⬜ |

### 14.3 Slice 1c

| # | Do | Expect | Pass? |
|---|---|---|---|
| A7 | Filter by state (Pending, Revoked), type (Champion); search part of your address; search `%` and `_`. | Only matching rows; `%` and `_` literal. | ⬜ |

---

## 15. Rollback

### 15.1 `20261013` (1a)

**File:** `supabase/SQL Scripts/20261013_business_os_invite_existing_account_rollback.sql`

```sql
BEGIN;

DROP FUNCTION public.business_os_auth_email_has_account(text);

ALTER TABLE public.business_os_invites DROP COLUMN opened_by_existing_account_at;

COMMIT;
```

| Scenario | Action | Consequence |
|---|---|---|
| 1a code problem | RM reverts the 1a merge. The migration can stay (Slice 0 code never selects the column or calls the function). | Page returns to Slice 0 behaviour. |
| Migration problem (checker FAIL other than privileges) | Revert or hold the code first (otherwise every link answers "try again"), then paste the rollback. | The "opened by an existing account" stamps are lost; nothing else. |
| Privilege drift | Re-run the four `REVOKE` lines and the `GRANT`, then the checker. | None. |

### 15.2 `20261014` (1b)

Drops the finalise function, the lineage table, the seven CHECKs and the thirteen columns (including the FR-12a record, SA D-2), in reverse order. **Export lineage first** if any signup happened. Accounts already created stay complete (their plan rows and redeemed invites are not in this migration); a claimed-but-unfinalised invite must be finalised (§6.2) before rolling back, or its account is left without a plan row.

**Re-applying `20261014` after its rollback (QA-1b-4).** Once any signup has happened, pasting `20261014` again **fails** (safely: the whole transaction rolls back). The rollback drops `claimed_account_id` but keeps `redeemed_account_id`, so the re-added `business_os_invites_redeemed_by_claimant` CHECK is violated by every redeemed row. The migration file itself stays unchanged. To re-apply:

1. Run first, in one paste: `BEGIN;` then `ALTER TABLE public.business_os_invites ADD COLUMN claimed_at timestamptz;` then `ALTER TABLE public.business_os_invites ADD COLUMN claimed_account_id uuid;` then `UPDATE public.business_os_invites SET claimed_at = redeemed_at, claimed_account_id = redeemed_account_id WHERE redeemed_account_id IS NOT NULL;` then `COMMIT;`
2. Paste `20261014` **without its two `ADD COLUMN claimed_at` / `ADD COLUMN claimed_account_id` lines** (they now exist). Everything else is unchanged.
3. Run the checker; it must read `VERDICT PASS`. Then restore lineage from the export taken before the rollback.

| Scenario | Action | Consequence |
|---|---|---|
| 1b code problem | Revert the 1b merge; the migration can stay. | Signup stops; the page falls back to 1a. |
| Migration problem | Hold the code, export lineage, finalise any open claims, paste the rollback. | Lineage rows lost (the export is the record). |
| A bad redemption | An admin corrects the plan on the Tiers page. | As for any plan correction. |

---

## 16. Logging-standard check (console.*)

Every existing file modified in 1a (a9–a26) and planned for 1b/1c, plus the files called without modification (`lib/client/auth-actions.ts`, `lib/supabaseClient.ts`, `lib/utils/origins.ts`, `lib/notifications/emailTransport.ts`, `lib/email/templates/base-template.ts`, `lib/auth.ts`, `lib/logger/config.ts`), was checked on `origin/main` fd710c26: **0 `console.*` calls in each.** No conversion is needed. New server files use `createLogger`; the new client hook and page log nothing.

---

## 17. Open issues and follow-ups

Items that must be **verified at the end of Slice 1**. None is a launch gate for 1b (SA R-10).

| # | Item | Owner | Status | Verification at the end of Slice 1 |
|---|---|---|---|---|
| <a id="oi-1"></a>**OI-1** | **Vercel Firewall per-IP rate limit on the public invite endpoints.** Requested by the user by email on 2026-09-28. Rule: name `bos-public-invites-rate-limit`; path prefix `/api/public/invites/` (covers validate and 1b's code and complete routes); 30 requests per 60 s per IP; fixed window; action 429; production. Hardening for cost and availability, not a gate (§10, SA R-10). | Offir (Vercel admin) | ⬜ Requested, awaiting Offir's confirmation | QA **B16** (§14.2): a burst of more than 30 POSTs in 60 s from one IP to `/api/public/invites/validate` on production returns 429 after the limit, and a normal request succeeds again after the window. **If Offir reports that the plan does not support WAF rate limiting, record it here and go back to SA.** |
| **OI-2** | Erasure of invite emails and the 12-month anonymisation of unused invites (L-12, §11). Designed, not built. | TL | ⬜ Open | Not verified in Slice 1. The first invite that can qualify reaches 12 months on **2027-09-28**. Recorded in the requirement's L-12 row. |

---

## SA Review Notes

### SA Workplan Review — 2026-09-28

**Reviewed by SA — 2026-09-28**
**Status:** 🔄 Revision Required (scoped). The workplan is thorough, honest about its size, and correct on almost every point of fact I re-checked. One design change is required (R-1, the T-4 compensation), plus scope cuts (R-11). **1a may proceed** once the R-1a items are applied to this document (no second SA pass for 1a). **1b** needs the R-items applied and a **one-pass SA re-check of the revised §2.4 flow and the 1b migration** before any 1b code is written, because that SQL is pasted into production by hand.

**Facts re-checked on `origin/main` fd710c26:** the no-deletion guard's `ALLOW_LIST` is empty and its header records D3 ("deleted `auth.users`, which decision D3 forbids absolutely") and the 16 FKs without `ON DELETE`; `create_user_settings` (20261003) inserts four rows inside the `auth.users` insert with **no** `ON CONFLICT`, so signup fails closed; `isBusinessOsTenant` has exactly three callers (`adminOps.ts`, the entitlements account route, the account summary route); Pino redacts `password`/`token` and not `code`; Slice 0's `business_os_invites_redemption_complete` CHECK pairs `redeemed_at` with `redeemed_account_id`; `revokeForAdmin` is a CAS on `redeemed_at IS NULL AND revoked_at IS NULL`; `@supabase/auth-js` 2.75.1 `AdminUserAttributes` accepts **`id`** and `ban_duration` on `createUser`; `signInWithPassword` in `lib/client/auth-actions.ts` is audited and returns `{ ok }`.

#### Rulings on Dev's findings

| # | Ruling | One line |
|---|---|---|
| **F-1** | **Rejected as written; replaced by R-1.** | No `deleteUser`, no guard exception, no ban. **Claim the invite in the DB before creating the auth user**, with a server-generated account id recorded on the claim and passed to `createUser({ id })`, then finalise. The business races that caused compensation (revoke/expiry in the gap, two invites to one email) disappear; the residual infra-failure case leaves an account that its invite points at, recoverable by re-running finalise, never an anonymous orphan. |
| **F-2** | **Approved.** | Sign in in the browser with the password just set; drop `generateLink` from T-3 (SA amendment). The server mints no credential, so "the link never authenticates anyone" is structural. L-8 is met by this plus the `signed_in` 409. |
| **F-3** | **Approved.** | Redact `signupCode`, `*.signupCode`, `otp`, `*.otp`; **not** `code` (it would censor `dbError.code`/`err.code` app-wide). L-2 amended accordingly. |
| **F-4** | **Approved: SECURITY DEFINER**, with R-4. | Verified in §4: `SET search_path = ''`, `auth.users` schema-qualified, returns `boolean` only, `REVOKE ALL` from `PUBLIC`/`anon`/`authenticated`/`service_role` then `GRANT EXECUTE` to `service_role` only, proven by checker S13/S14. Not an enumeration oracle: no route passes a caller-supplied email to it; the only argument is `row.email` of an invite already matched by a 256-bit token hash, which is exactly the disclosure §8.1 allows. Drop runbook P2 (DEFINER is correct either way; one fewer operator step). |
| **F-5** | **Approved.** | End date computed in SQL from the invite row at finalise time ("counted from signup"); the cohort id stays an expected value. TypeScript still validates the row's grant and end-date shape with `grantRules` before the claim. L-5 amended: "expiry is derived in SQL from the server-side row", which is stricter than "passed in". |
| **F-6** | **Approved.** | `valid` carries `maskedEmail` only; the full email is returned only in the `complete` 200, after mailbox proof, where the client needs it to sign in. |
| **F-7** | **Approved, and the ensure step is dropped** (R-7). | T-10's premise is gone: the codified trigger inserts `profiles` inside the `auth.users` insert with no `ON CONFLICT`, so a created user without a profile cannot exist. An idempotent insert is dead code plus one more post-`createUser` failure point. L-7 is superseded. |
| **F-8** | **Approved.** | Plan write via `BusinessOsAccountPlanRepository.provisionFromInvite` (renamed to match the finalise function is fine), in `WRITE_METHODS`, so the entitlements imports guard sees every plan writer. |
| **F-9** | **Approved** (moves to 1c, R-11). | State filter in TS via `deriveInviteState`, SQL filters on type/email, 500-row ceiling, `truncated` shown in the UI. |
| **F-10** | **Correct technical reading, not a business change.** | BQ-4/BQ-9 decided the sender of the **invitation** email (the question text says so). A one-time code is a platform security message; sending it "as" a person, with Reply-To that person, would invite "here is my code" replies. System identity, `kind: 'transactional'`, no `from`/`replyTo`/`ownerUserId`. QA B3 records the From shown on production (R-9). |
| **F-11** | **Approved.** | Unkeyed SHA-256 over invite id and code (use a separator, e.g. `id:code`). Reversing it yields nothing without the raw token, which is never stored; an HMAC key would be a new Vercel secret for no gain. |
| **F-12** | **Approved.** | Lineage keeps pseudonymous ids after erasure; it holds no email by design. |
| **F-13** | **Agreed.** | Supabase email OTP would go through the public signup path Slice 4 switches off. |
| **F-14** | **Intended.** | A plan-row-only account is a Business OS account (plan rows exist only via trigger, backfill, admin op or invite), so the summary route returning an empty summary instead of 404 is correct. Add it to the imports guard `ALLOWED` as read-only with its reason. |
| **F-15** | **Noted** (user awareness, below). | Test accounts stay on production; a 1-month champion lapses on its own. |
| **F-16** | **Split approved, with cuts** (R-11). | Option B is the right axis; it is honestly counted but still too big. Cut erasure build, profile ensure and the list filters out of Slice 1's critical path, and split the migration per sub-slice. |

#### Rate-limit decision

**1b ships with option A (per-invite counters) only. The Vercel Firewall per-IP rule (B) is requested from Offir in parallel as hardening and is NOT a go-live gate. Option C (DB per-IP table) is rejected.**

Why: with A, every security-relevant threat is bounded per invite: token guessing is infeasible (256 bits), code guessing is at most 5 attempts per code and 5 codes per 24 h (about 25 guesses a day against 10^6), and code-email spam to an invitee is at most 5 a day and needs a real link. What per-IP adds is cost and availability protection for three endpoints, which is the same exposure every other public route in the app has today. C would add a write per public request and a bucket-cleanup job, and that cleanup cron needs `CRON_SECRET`, which is itself waiting on Offir, so C does not remove the dependency it was meant to remove. Gating 1b on a Vercel-admin task repeats the pattern that has stalled `CRON_SECRET` and `SENTINEL_WEBHOOK_SECRET` for weeks. This supersedes the Slice 0 note that the per-IP rule "should be in place before Slice 1 hands links to real invitees": that note predates the per-invite counters.

#### Split and size (F-16)

| Sub-slice | Scope after SA cuts | Demo |
|---|---|---|
| **1a** | Migration `20261013` (only `opened_by_existing_account_at` and `business_os_auth_email_has_account`) with its own checker, rollback and text test; `AuthAccountRepository.emailHasAccount`; `existing_account` state on validate + audit; the signed-in-visitor notice; page copy in three languages. About 18 files. | Dev's 1a demo minus the filter steps (A1–A6, A8, A9). |
| **1b** | Migration `20261014` (signup-code and claim columns, lineage table, finalise function) with its own checker, rollback and test; code email; the two signup routes; claim/create/finalise (R-1); `grantRules` and the tenant widening; sign-in; lineage level and "Accepted, account, time" in the list. | Dev's 1b demo (the §10 Slice 1 done-means). |
| **1c** (new, off the critical path) | Admin list filters and search (FR-5, deferred from Slice 0): files 36–45's filter parts, `searchRecentForAdmin`, D-9. No migration. | Dev's A7. Can ship any time after 1a, before or after 1b. |
| Out of Slice 1 | Erasure build (R-12), profile ensure (R-7), deletion-guard entry (R-1). | — |

**Optional:** if the 1b diff is still hard to review, Dev may land `grantRules` + the L-4 tenant widening (files 10, 18, 55–61, 64 partly) as a preparatory, behaviour-proven PR ahead of 1b. Not required.

**Why two migrations (reverses D-1):** 1a's migration becomes one column and one function. The 1b SQL is being redesigned (R-1); if it shipped with 1a, any 1b review finding would need a second corrective migration anyway, and an uncalled redemption function would sit in production for as long as 1b takes. Two small pastes, each with its own checker, is less risk than one paste whose second half is not yet final.

#### Required changes

| # | Applies to | Change |
|---|---|---|
| **R-1** | 1b; §2.3 D-8, §2.4, §4, §6, §9 L-1/T-4, §12, §13 F-1, files 5, 6, 25, 26, 66 | **Claim before create; no deletion.** Rewrite `completeSignup` as: re-validate → count attempt → compare → **one CAS that clears the code and claims the invite** (`claimed_at = now()`, `claimed_account_id = <crypto.randomUUID() generated server-side>`, conditional on pending, not revoked, not expired, not already live-claimed, code hash unchanged) → `createConfirmedUser({ id: claimedAccountId, email: row.email, password, email_confirm: true })` → finalise → audit. Invariants the revised §2.4 must state and §12 must test: **I-1** no code path calls `auth.admin.deleteUser`; `deleteUserCreatedByRedemption` and file 66 are removed; the guard stays empty. **I-2** after a claim, revoke and expiry cannot win: `revokeForAdmin`'s CAS adds "no live claim" and the admin route answers 409 `signup_in_progress` (Slice 0 repository and route tests extended); finalise does not re-check `link_expires_at` or `revoked_at` (the claim was the decision point). **I-3** the account id is server-generated, recorded on the invite before the user exists, and never read from the request; if `createUser` returns an id different from `claimedAccountId`, finalise is not called, the response is 503, and it is logged at `error` (this also proves on QA B5 that hosted GoTrue honours `id`). **I-4** any `createUser` failure releases the claim with a CAS conditional on the same `claimed_account_id` (a failed release is harmless: no account exists, and the claim lapses per I-6). **I-5** finalise is one SQL function, `SECURITY INVOKER`, `SET search_path = ''`, keyed on `(invite id, claimed account id, email)`, idempotent (already finalised for the same account returns its id), writes `redeemed_at`/`redeemed_account_id`, the plan row (plain `INSERT`) and the lineage row; retried once in-request; on a second failure the claim is kept, the response is 503, and `BOS_INVITE_REDEMPTION_INCOMPLETE` (replaces `…_ORPHANED`, severity warning, invite id and account id only) is audited. The runbook gains a recovery entry: a read-only query listing claimed-but-unfinalised invites whose account exists, and the one `SELECT public.<finalise>(…)` line to complete each. **I-6** a claim older than a lease longer than the complete route's `maxDuration` (set `maxDuration` explicitly on that route) may be re-claimed, **reusing** the recorded `claimed_account_id`; if `createUser` then reports `email_exists`, `getUserById(claimedAccountId)` decides: the user exists → it is this invite's account, finalise it; it does not → release and answer `existing_account`. Migration: new `claimed_at`/`claimed_account_id` with a paired CHECK (the Slice 0 `redemption_complete` CHECK stays untouched), and a `redeemed_account_id = claimed_account_id` CHECK once redeemed. Runbook P1 is dropped. The ban fallback is rejected: it leaves a locked account the invitee cannot use and blocks their email until an admin acts. |
| **R-2** | 1b; D-6, §9 L-8/T-3 | Record F-2 as an SA amendment to T-3 ("password sign-in in the browser; no server-minted session"). `SignupForm` fallback on sign-in failure stays as written. |
| **R-3** | 1b; file 67 | Redaction paths exactly `signupCode`, `*.signupCode`, `otp`, `*.otp`, with the test. |
| **R-4** | 1a; files 1, 3–6, §6 | Keep the DEFINER lookup as written; drop P2. Add a pin (repository test or a small guard) that `AuthAccountRepository` is imported only by `publicInviteView.ts`/the validate route and `inviteRedemption.ts`, and a test that the argument is always the matched row's email; no schema anywhere accepts an email that reaches it. |
| **R-5** | 1b; §9 L-5 | Record F-5 as an SA amendment to L-5. `grantRules` validates the row (cohort id in `COHORT_IDS`, end-date shape per RC-4) before the claim; the finalise function test covers open-ended → `NULL`, 12 months → now + 12 months, cohort mismatch → no row, tier grant → no row. |
| **R-6** | 1b; `maskEmail` | Show at most the first character of the local part plus the domain; tests for 1-, 2-character and long local parts (already planned). |
| **R-7** | 1b; files 23, 65, D-8, §9 L-7/T-10 | Remove `ensureRowForNewAccount` and its test; mark T-10/L-7 superseded by the codified fail-closed trigger (20261003), citing that migration's header. |
| **R-8** | 1b; files 59–61, 64 | F-14 as ruled: the summary route passes the plan repository and joins `ALLOWED` as read-only with its reason; its tests cover a plan-row-only account returning 200. |
| **R-9** | 1b; D-7, §14 B3 | Keep the system sender. QA B3 records the exact From display name and address production shows (from `RESEND_FROM_EMAIL`). The code email body says what it is for ("your AgentPilot sign-up code") and "ignore it if you did not ask". |
| **R-10** | 1b; §10, §6 P8, §14 B16 | Rate limiting per the decision above: build A; P8 is no longer a gate; B16 runs only once Offir's rule exists; TL raises the Firewall request now. Delete option C from the recommendation. |
| **R-11** | All; §2.1, §3, §4, §5, §6, §8, §15 | Re-cut per the split table: 1a migration `20261013` (column + lookup function), 1b migration `20261014` (code, claim, lineage, finalise), each with its own checker (exact totals updated), rollback and text test; filters/search to a new 1c; recount files per sub-slice honestly. The rollback no longer needs the `SET NOT NULL` abort path (R-12). |
| **R-12** | L-12; §11, §4, files 25, 52, 53 | **Erasure: design accepted, build deferred.** Remove from Slice 1: `email` nullability, `email_erased_at`, the `email_normalised` drop/re-create, `eraseInviteeEmail`, `ACCOUNT_ERASURE_HOOKS` edits, the "Email erased" UI and the erased → `not_recognised` path. Uncalled column support and an uncalled repository method are dead code, and dropping `NOT NULL` makes the rollback abort-prone for no present benefit (no erasure path exists; the first unused invite qualifies for anonymisation on 2027-09-28). Keep §11 as the design, and record one open item (owner TL) with that date in the requirement's L-12 row. When the job is built, a set-based idempotent `UPDATE` with fail-closed `CRON_SECRET` auth and a `bos_cron_runs` record satisfies `durable-queue-drain` for this shape; the claim/reaper/dead-letter parts of §8.1 apply only if it becomes per-row work (for example emailing someone). |
| **R-13** | 1b; `completeSignup` body schema | Password upper bound is **72 bytes**, not 72 characters: bcrypt truncates silently past 72 bytes, and a multi-byte password under 72 characters can exceed it. Validate with `new TextEncoder().encode(p).length <= 72`; test with a multi-byte string. |
| **R-14** | §9, §13 | Update the traceability rows (L-1: account id is server-generated and bound by the claim; L-5, L-7, L-8, T-3, T-4, T-10 as ruled) and mark each F-item with its ruling. |

**Migration house-rule check (as submitted, before R-1/R-11/R-12):** ✅ SQL-editor-safe (no comments; literals only letters, digits, underscores and spaces; no single-letter aliases; small statements). ✅ `REVOKE ALL` from all four roles one statement each, then one narrow grant, for the table and both functions; no enumerated `REVOKE`. ✅ RLS on, no policy, on the lineage table; no FK; no trigger. ✅ `SET search_path = ''` on both functions, all names qualified, only `pg_catalog` built-ins unqualified. ✅ No new anon-callable SECURITY DEFINER (S13 proves it on production). ✅ The plan insert is a plain `INSERT`. The revised 1b migration must keep every one of these, and the text test must assert them for the finalise function.

**Tenant isolation (`tenant-isolation-guard`):** ✅ with R-1. Ownership oracle is the token hash plus the email lock, repeated in the finalise `WHERE`. Explicit allow-list: `.strict()` bodies; `createUser` receives exactly `{ id, email: row.email, password, email_confirm }` and no metadata; the finalise parameters are all server-derived. Scope-defeating three: the `auth.users` trigger writes only `NEW.id` rows; no upsert; no injectable payload. R-1 strengthens step 2: the account id is minted by the server and recorded on the invite before the account exists, so no id from any other source can reach the plan or lineage write.

### Optimisation Suggestions

- `lower(auth_user.email)` cannot use the `auth.users` email index. Fine at current volume; note it for later.
- `eventAudience` pins will move by different numbers once `ORPHANED` becomes `INCOMPLETE` and 1a/1b/1c are re-cut; recompute rather than carry the §3 figures.
- The Slice 0 checker's I07 counts names only, so it keeps passing; say so in each new runbook as already done for P6.

### For the user (business terms)

**No decision is needed.** For awareness only:

1. **Protection against one computer flooding the signup page is not a launch condition.** The limits that stop code guessing and code-email spam are built into Slice 1 and need nobody. The extra per-computer limit is an Offir task, requested now and added whenever he does it; Slice 1 does not wait for it.
2. **Accounts are never deleted by this feature.** If signup is interrupted by a system fault at the wrong instant, the account exists and is finished by a one-line recovery step, rather than being deleted. Test accounts created during QA stay on production; a 1-month Founding Partner access lapses by itself.
3. **The sign-up code email comes from the platform's standard system sender**, not from the inviting admin. The personal "<Name> via AgentPilot" sender is for the invitation email (Slice 2), as you decided. QA will record the exact sender name production shows.
4. **Removing invite emails after 12 months is designed but not built yet.** The first invite it could apply to reaches 12 months on 2027-09-28; it is tracked as an open item.

### Approval

[ ] Workplan approved — proceed to implementation
**1a:** approved to proceed once R-4, R-11 (1a part) and R-12 are applied to this document. **1b:** apply R-1 to R-14, then return §2.4 and the `20261014` migration to SA for a one-pass re-check before implementation. **1c:** approved as scoped (F-9, D-9), after 1a.

---

### SA Code Review 1a + 1b Design Re-check — 2026-09-28

**Code Review by SA — 2026-09-28 (Slice 1a)**
**Status:** ✅ Code Approved for QA, **conditional on two small must-fixes (CR-1, CR-2)**. Neither changes behaviour on production; QA can verify both. No second SA pass is needed for them.

Reviewed: the uncommitted diff on `feature/bos-invite-signup-slice-1` (24 tracked files, +813/−36, and 8 new files), read in full for the migration, rollback, checker, migration test, `AuthAccountRepository` and its callers guard, `publicInviteView.ts`, the validate route, `BusinessOsInviteRepository.ts`, `useSignedInVisitor.ts`, `app/invite/page.tsx`, `invitePageCopy.ts`, the admin list and sidebar, the audit registrations, and the new or changed tests.

#### Verification run by SA

| Check | Result |
|---|---|
| Jest: `app/invite`, `app/api/public/invites`, `app/api/admin/business-os`, `app/admin`, `lib/business-os/invites`, `lib/repositories/__tests__`, `lib/audit`, `supabase/migrations/__tests__`, `lib/business-os/purge`, `lib/business-os/entitlements`, `lib/admin` | **145 suites, 3,104 tests: 3,102 pass, 2 fail, both pre-existing on fd710c26 and untouched by 1a.** (1) `lib/business-os/entitlements/__tests__/customerPlanView.test.ts` (28 vs 29, known since Slice 0). (2) `app/api/admin/business-os/entitlements/__tests__/routes.test.ts` › "account on a tier": `payments.reminders` is decided by `basis`, not `lifecycle_gate`. Both come from the Founding Partner / `payments.reminders` catalog change and are fixed on `origin/main` by PR #129 (`674ea389`). The diff touches no file under `lib/business-os/entitlements/` or `app/api/admin/business-os/entitlements/`. Dev's record lists only the first; add the second. |
| No-deletion, tier-literal, admin-read-methods, entitlements-imports, account-seam, purge-invariant and the new callers guard | All pass (inside the run above). |
| One flaky run | `app/admin/business-os-invites/__tests__/page.render.test.tsx` failed once when the Jest run shared the machine with `next build` (28 s). Two isolated runs and the full rerun passed 13/13. Load-induced `findBy` timeout, not a defect; no action. |
| `npm run test:authz-guard` | **119 / 119 pass**, no CAPS change. |
| `next build` with the full CI placeholder env from `.github/workflows/build.yml` (including `OPENAI_API_KEY`, `STRIPE_SECRET_KEY`, the QStash keys) | **Exit 0.** Compiled successfully, 307/307 pages generated; `/admin/business-os-invites` and `/api/public/invites/validate` are in the route table. A first run with only the Supabase placeholders died collecting `/api/business-os/chat-v2` (missing OpenAI key): an environment gap in my command, not the code. |
| Collision check | `origin/main` has moved to `3941327f` (PRs #129, #130). None of its changed files overlap this diff, and it adds no `20261013` or `20261014` migration. **Rebase onto `origin/main` before the PR** so the two pre-existing failures disappear from CI. |

#### Required checks from the workplan review

| Item | Verdict | Evidence |
|---|---|---|
| **R-4** (lookup callers and argument) | ✅ with CR-2 | Not in the barrel; `authAccountRepository.callers.guard.test.ts` allow-lists 7 files and asserts they exist; `publicInviteView.test.ts` pins that the lookup is asked exactly once, about the email read for the **matched** row, and that an unmatched token reaches neither the email read nor the lookup. |
| **R-11, 1a part** | ✅ | Own migration `20261013` (one column, one function), own checker (7 rows), own rollback, own text test. No filter, search or erasure code in the diff. |
| **R-12** | ✅ | `email` stays `NOT NULL`; no `email_erased_at`, no `eraseInviteeEmail`, no erasure hooks. OI-2 records 2027-09-28. |
| House migration rules | ✅ | No comments; literals only letters, digits, underscores and spaces (the test enforces it); no single-letter alias; one `BEGIN`/`COMMIT`; `REVOKE ALL` from `PUBLIC`, `anon`, `authenticated`, `service_role`, one statement each, then only `GRANT EXECUTE … TO service_role`; no enumerated `REVOKE` (regex-tested); `SET search_path = ''`; `auth.users` qualified; returns `boolean` only; no new table, so no RLS question. Checker E06/E07 prove the grant end state on production through `aclexplode` over `COALESCE(proacl, acldefault(…))`. |

#### Security properties asked for

| Property | Verdict | How it holds |
|---|---|---|
| The existing-account state cannot probe emails | ✅ | The lookup runs only after a token hash matched a row, the invite is pending, and its grant is available (`publicInviteView.ts`, after `isInviteGrantAvailable`). Its argument is read by `findInviteeEmailForPublicCheck(row.id)`, keyed by the matched id, never by request data. The only way to aim it at an arbitrary address is to be an admin who creates an invite for that address, which is an accepted trust boundary (admins already see accounts on the Tiers page). |
| A failed lookup is never "no account" | ✅ | Either read failing, or a non-boolean RPC result, returns `{ ok: false }` → 503 `unavailable_try_again`. `AuthAccountRepository.emailHasAccount` rejects a non-boolean explicitly. Tested at the view and the route. |
| Bad-token responses still byte-identical | ✅ | The Slice 0 deep-equality tests (unknown, malformed, one-character-off: status, body, headers) are unchanged and pass. The new code runs only after a match. |
| The email in no response, log or audit entry | ✅ | `existing_account` is the narrow `{ state, language, inviterDisplayName }` (exact-key tests); the email is read by its own method and handed only to the lookup; the repository logs `{ dbError: { code, message } }` and the invite id only; the audit entry is `entityId` = invite id, `details: { correlationId }`, actor `null` (tested, including "no email reaches any log line"). |
| Audit only on first open | ✅ | `markOpenedByExistingAccount` is `UPDATE … WHERE opened_by_existing_account_at IS NULL RETURNING id`; the route audits only when that call set the stamp, then flushes (WC-7). A reload writes nothing; a failed stamp is a `warn` and the page still renders. |

#### Findings

| # | File:line | Finding | Priority |
|---|---|---|---|
| **CR-1** | `docs/workplans/…SLICE_1_WORKPLAN.md` §6.1 step 5 (line 475); cause at `lib/repositories/BusinessOsInviteRepository.ts:55` | **Merge order.** `BUSINESS_OS_INVITE_ADMIN_COLUMNS` now selects `opened_by_existing_account_at`, and create, list, find and revoke all use it. If the code reaches production before the migration, PostgREST rejects the whole select, so the admin invites page breaks (list, create and revoke) and every valid invite link answers "try again" (missing function). Merging to `main` deploys on Vercel, so "Deploy the 1a code" must read **"Apply `20261013` and get checker PASS before the PR is merged; the merge is the deploy."** Add the same line to Commit Info for RM. The rollback table (§15.1) is already right: revert the code before dropping the column. | **Must-fix** (document only) |
| **CR-2** | `lib/repositories/__tests__/authAccountRepository.callers.guard.test.ts:27` | The guard matches the class and instance names only. A new file calling `supabase.rpc('business_os_auth_email_has_account', …)` directly would bypass both the guard and R-4. Add the SQL function name to the scanned pattern (only the repository, its test, the migration test and the guard may contain it; the migration and checker live outside the scanned directories). | **Must-fix** (small) |
| N-1 | `app/invite/invitePageCopy.ts:86,119,152` | On `existing_account` there is nothing to accept, yet the signed-in notice says "An invitation can only be accepted by someone who is signed out". Accurate enough for 1a; reword in 1b (for example, "Sign out to continue with this invitation") when the form copy is added. | Nit |
| N-2 | Workplan §5.1 / §6.1 | Checker E02 pins exactly 16 CHECKs, so the 1a checker FAILs by design once `20261014` adds five. Say so in §6.2 so nobody reads a later rerun as drift. | Nit |
| N-3 | 1a implementation record | Record the second pre-existing failure (`routes.test.ts`) and the rebase before the PR. | Nit |

#### Rulings on D-dev-4 to D-dev-7

| # | Ruling |
|---|---|
| **D-dev-4** | **Accepted.** Typed fixtures needed the field, and the label change was the user's request; it is copy only (sidebar name, page heading, nav test), with no route or href change, and the authz guard is unaffected. |
| **D-dev-5** | **Accepted.** A dedicated client hook is the right shape. `getSession` is local, display-only, and fails to "signed out", which is safe because nothing on the page acts on it and the 1b routes refuse a session on the server. Showing the notice only on `valid` and `existing_account` is correct. |
| **D-dev-6** | **Accepted**, with N-1 for the copy. Hiding "Sign in" from someone already signed in is right; after Sign out the page re-asks the server and then shows it. |
| **D-dev-7** | **Accepted.** An optional `firstOpenByExistingAccount: true` keeps every other outcome shape unchanged and makes "audit once" a fact reported by the conditional `UPDATE`, not a guess. |

**Code approved for QA: Yes**, conditional on CR-1 and CR-2 (QA checks CR-1 in the runbook and runs the CR-2 guard).

---

**Design Re-check by SA — 2026-09-28 (Slice 1b: §2.4, §4.2, §6.2)**
**Status:** ✅ **Clear for Dev to implement once D-1 to D-7 below are folded into §2.4, §4.2, §5.2, §6.2 and §12.2.** They are additions I specify fully here, so no further SA design pass is needed; the finished SQL gets its normal review at 1b code review, before the user applies it.

The claim-before-create flow meets R-1. I-1 to I-6 are stated and each has a test in §12.2. The finalise SQL is correct: `SECURITY INVOKER`, empty `search_path`, `REVOKE ALL` from the four roles then `GRANT EXECUTE` to `service_role`, no enumerated `REVOKE`, editor-safe literals, `UPDATE`-first so the row lock serialises concurrent finalisers, and a READ COMMITTED re-read that makes it idempotent. The plan and lineage inserts are plain `INSERT`s. `redeemed_by_claimant` is NULL-safe and every existing row satisfies it (no invite has been redeemed yet). `service_role` holds `INSERT` on `business_os_account_plans` (20261009) and `UPDATE` on invites (20261012). The lineage block is as approved.

#### Rulings on D-dev-1 to D-dev-3

| # | Ruling |
|---|---|
| **D-dev-1** | **Approved.** Comparing `claimed_account_id` with the observed value makes the re-claim of a stale claim a true compare-and-swap. In PostgREST that is `.is('claimed_account_id', null)` when none was observed and `.eq(…)` otherwise. |
| **D-dev-2** | **Approved, with one rule: never release on uncertainty.** If `findUserExists(X)` itself fails, keep the claim, answer 503, and write the failure record (D-2) with step `find_user`. Keeping is always safe because a re-claim reuses `X`; releasing is safe only after a positive "no such user". |
| **D-dev-3** | **Approved, with one addition.** On an id mismatch, the failure record stores the **returned** id as the account id and the step `create_user_id_mismatch`, so the unexplained account stays findable after the lease lapses. Such an invite is refused as `existing_account` afterwards anyway, so nothing re-claims it. |

#### Required changes to the 1b design

| # | Change |
|---|---|
| **D-1** | **Complete route, step 2: a live claim answers 409 `signup_in_progress`**, before the code checks, as the code route already does. Without it a second tab gets a misleading `code_expired`. |
| **D-2** | **FR-12a durable record, on the invite row** (T-16 below). Add to `20261014`: `redemption_failed_at timestamptz`, `redemption_failed_step text`, `redemption_error_code text`, `redemption_error_message text`, `redemption_failed_account_id uuid`, all nullable; a CHECK pairing `redemption_failed_at` with `redemption_failed_step` (NULL-safe, M-2 style), and length CHECKs (step ≤ 64, code ≤ 64, message ≤ 300). No value list in SQL; the step vocabulary (`find_user`, `create_user`, `create_user_id_mismatch`, `finalise`) is a TypeScript constant. Written by one repository `UPDATE` keyed on `id` and `claimed_account_id` whenever the flow ends with the claim kept (I-3 mismatch, D-dev-2's failed lookup, I-5's second finalise failure); last failure wins; never cleared, so the history survives a recovery. The message is built from `safeDbError` (M-1) or the auth error, truncated to 300 characters, **with any email-shaped substring replaced**, and tested with a message that contains an address. The `BOS_INVITE_REDEMPTION_INCOMPLETE` audit details repeat exactly these fields plus the invite id: never email, token, hash, code or password (AC-5a, asserted on the row, the audit details, the log lines and the admin view). Update checker S01/S02 totals and the migration text test. |
| **D-3** | **The "stopped halfway" condition is derived from data, not from events.** An invite needs attention when `redeemed_at IS NULL` **and** either `redemption_failed_at IS NOT NULL` or `claimed_at` is older than the lease. The second half catches the case no code can report: the function killed by its timeout between `createUser` and finalise, which writes neither the row record nor the audit entry. |
| **D-4** | **One lease constant** (120 s) in the signup policy config, read by the claim CAS, the revoke CAS (I-2) and the D-3 condition, with a test that it exceeds the complete route's `maxDuration`. |
| **D-5** | **Recovery runbook (§6.2).** (a) The list query must not select the email: select id, `claimed_account_id`, `claimed_at` and the D-2 fields. (b) Run finalise so that only the invite id is typed: `SELECT public.business_os_finalise_invite_redemption(invite_row.id, invite_row.claimed_account_id, invite_row.email, invite_row.grant_id) FROM public.business_os_invites AS invite_row WHERE invite_row.id = '<invite id>';`. That makes a hand-copied email or grant impossible. (c) Add the branch "finalise fails with a unique violation on `business_os_account_plans`": the person signed in and began onboarding before recovery, so the trigger gave them a trial row. That needs an admin decision: set the plan on the Tiers page, then record the redemption and lineage by hand. Give the two statements, not a new function. |
| **D-6** | **State plainly in §2.4 that I-6's "user exists → finalise" branch is a race-only path.** Once an account exists for the email, validate and the code route answer `existing_account` before any claim logic, so the invitee cannot get back to `complete`. The real recovery for an account whose finalise did not run is FR-12a plus the runbook. Keep the branch (it is cheap and correct), but do not describe it as the recovery. |
| **D-7** | **FR-12a is the last task of 1b** (lowest priority, BQ-11): the D-2 columns ship in `20261014` (a later column add would mean a third migration), while the admin indicator (T-16) is the final task and may slip to a follow-up PR without holding the signup demo. |

#### T-16 decision: how admins are told

**An indicator on the admin invites page, now. No email, for now.**

- **What:** on `/admin/business-os-invites`, a banner "N signups stopped halfway" above the list, and on each affected row a badge showing the failing step, error code, scrubbed message, account id and time. It is driven by the D-3 condition and read through the list the page already loads: `InviteListView` gains the D-2 fields and a derived `redemptionStoppedHalfway` flag, computed in TypeScript with the lease constant (the same one-derivation rule as C-11). The banner holds counts and invite ids only. The row sits in the admin list, which already shows the invited email to admins; the FR-12a record itself never holds the email.
- **Why not email:** there is no admin mailing list or admin-alert sender yet. A best-effort email sent from the failing request can itself fail silently, and it cannot report the timeout case in D-3 at all, because that request never ran its error path. A data-derived indicator catches every case, needs no cron (no `CRON_SECRET` dependency), no queue and no new sender. Email (or a digest) can be added when admin notifications exist for other reasons; it would read the same D-2 fields.
- **Honest limit:** an admin has to open the page to see it. At today's volume, with admins creating these invites by hand, that is acceptable; it is the BA's recommendation, and it is recorded here as SA's decision.

**Design verdict: clear for Dev to implement**, with D-1 to D-7 and the D-dev-2/D-dev-3 conditions folded in.

#### For the user (business terms)

No decision is needed. If a signup is ever interrupted halfway by a system fault, the admin invites page shows it, with what went wrong. An admin finishes it by hand for now; automatic repair stays future work, as you decided (BQ-11). Merging 1a has one ordering rule, which is RM's job: the small database change is applied first, then the code is merged.

---

### SA Code Review 1b — 2026-09-28

**Code Review by SA — 2026-09-28 (Slice 1b)**
**Status:** ✅ **Code Approved for QA, conditional on MF-1 to MF-3 below.** No blocker. The migration SQL is **approved as written** for the user to paste (none of the must-fixes touches SQL). MF-1 and MF-2 are small TypeScript changes; MF-3 is the rebase. QA verifies all three; no second SA pass is needed unless the fix for MF-1 grows beyond an opt-in flag on the transport.

Reviewed: the uncommitted diff on `feature/bos-invite-signup-slice-1b` (42 tracked files +1650/−69, 23 new), read in full for the migration, rollback, checker, `inviteRedemption.ts`, `redemptionDeps.ts`, `signupCode.ts`, `signupCodePolicy.ts`, both signup routes, the new repository methods (invite, auth, plan, lineage), `grantRules.ts`, the tenant widening and its three callers, `adminInviteOps.ts`, the admin page and list, `SignupForm.tsx`, the schemas, the logger redaction and the guards; tests read by case list.

#### Verification run by SA

| Check | Result |
|---|---|
| Jest in this worktree: `app/invite`, `app/api/public/invites`, `app/api/admin/business-os`, `app/admin`, `lib/business-os/invites`, `…/entitlements`, `…/purge`, `lib/business-os/__tests__`, `lib/repositories/__tests__`, `lib/audit`, `lib/logger`, `lib/email/templates`, `supabase/migrations/__tests__`, `lib/admin` | **175 suites, 3,554 tests: 3,552 pass, 2 fail**, the two pre-existing failures below. |
| **The 1b diff applied onto current `origin/main` (571f48cc)** in a scratch worktree (not this tree) | `git apply --3way`: **two trivial conflicts** (`app/admin/business-os-invites/page.tsx`: PR #136's `key` on `CreatedLinkPanel` next to the T-16 banner; `docs/architecture/BUSINESS_OS_ENTITLEMENTS.md`: two Change History rows). Both keep-both. Same suite set: **175 suites, 3,557 tests: 3,556 pass, 1 fail** (`routes.test.ts` only). **`enforcementPoints.test.ts` passes after the rebase.** |
| Pre-existing 1: `enforcementPoints` › `lib/business-os/llm/aiActionAudit.ts` unaccounted | **Confirmed fixed on `origin/main`** (PR #134): passes on a clean `origin/main` checkout, and passes with this diff applied on top. Disappears on rebase. |
| Pre-existing 2: `app/api/admin/business-os/entitlements/__tests__/routes.test.ts` › "account on a tier" (`payments.reminders` decided by `basis`, not `lifecycle_gate`) | **Confirmed failing on a clean `origin/main` (571f48cc)**, independent of this branch. My 1a note (N-3) that PR #129 fixed it was wrong for this test; Dev's record is right. Needs its own ticket (not this slice). |
| `npm run test:authz-guard` | **119 / 119 pass**, no CAPS change (no new admin handler; the list and revoke routes keep `requireAdmin` first). |
| `npx next build`, full CI placeholder env from `.github/workflows/build.yml` | **Exit 0.** Compiled successfully, 307/307 pages; `/api/public/invites/signup/code`, `/api/public/invites/signup/complete`, `/invite` (11.7 kB), `/admin/business-os-invites` in the route table. |
| `deleteUser` anywhere in `app/` or `lib/` outside tests | **None** (only the no-deletion guard and two tests that assert its absence). |

#### Migration `20261014`, rollback and checker

| Property | Verdict | Evidence |
|---|---|---|
| SQL-editor-safe | ✅ | No `--` or block comments; every literal is letters, digits, underscores or spaces (`'invite'`, `'admin'`, `'cohort'`, `'admin_invite'`, `''`); no single-letter alias; one `BEGIN`/`COMMIT`; one statement per change. |
| Privileges | ✅ | Table and function: `REVOKE ALL` from `PUBLIC`, `anon`, `authenticated`, `service_role`, one statement each, then `GRANT SELECT, INSERT` (table) / `GRANT EXECUTE` (function) to `service_role` only. No enumerated `REVOKE`. This also cancels Supabase's default-privilege grants. |
| RLS on lineage | ✅ | `ENABLE ROW LEVEL SECURITY`, no policy, no FK, no trigger; S03/S04/S08 prove it on production. |
| Finalise function | ✅ | `SECURITY INVOKER`, `SET search_path = ''`, every name qualified, EXECUTE for `service_role` only. `UPDATE`-first takes the row lock before anything is read; a concurrent finaliser waits, re-evaluates `redeemed_at IS NULL`, matches nothing, and the following `SELECT` (a new statement under READ COMMITTED) returns the id. Re-run safe: a second call for the same account returns the invite id and writes nothing. The plan and lineage inserts are plain `INSERT`s, so a conflict aborts the invite update too. Under INVOKER, `service_role` has what it needs: `UPDATE` on invites (20261012), `INSERT` on plans (20261009), `INSERT` on lineage (here), and bypasses RLS. |
| End date | ✅ | `CASE WHEN access_open_ended THEN NULL ELSE now() + make_interval(months => access_months) END` cannot silently become open-ended: Slice 0's `business_os_invites_access_shape` CHECK forces `access_months` NOT NULL and > 0 whenever `access_open_ended` is false for a cohort grant. |
| CHECKs NULL-safe | ✅ | `hash_length` (`IS NULL OR …`), `signup_code_paired` and `claim_paired` (boolean equality of two `IS NULL`s, never NULL), `counters` (NOT NULL columns), `redeemed_by_claimant` (`claimed_account_id IS NOT NULL AND …`), `redemption_failure_paired` (both-or-neither written out), `redemption_failure_lengths` (each clause `IS NULL OR …`). Lineage `level_shape` and `invite_matches_source` are NULL-safe on their NOT NULL columns. If a redeemed row existed on production, `redeemed_by_claimant` would fail the `ADD` and the whole transaction would roll back; none can exist (Slice 0 has no redemption path). |
| No new anon-callable SECURITY DEFINER | ✅ | The only function is INVOKER and not executable by `anon`/`authenticated` (S11). |
| Onboarding/profile plan triggers | ✅ | The `auth.users` trigger (20261003) writes `profiles`, `user_preferences`, `notification_settings`, `security_settings` only; the plan-row triggers fire on `business_profiles` and `onboarding_conversations`, so `createUser` cannot pre-create a plan row that would make finalise's plain `INSERT` fail. (The §6.2 D-5c branch covers the case where the person onboards before a recovery.) |
| Rollback | ✅ | Drops the function, the lineage table (with its indexes and constraints), the 7 CHECKs, then the 13 columns, inside one transaction; `redeemed_by_claimant` is dropped before `claimed_account_id`. Plan rows with `origin = 'invite'` and redeemed stamps stay, as §15.2 says. |
| Checker S01–S12 | ✅ | Read-only session; `aclexplode` over `COALESCE(acl, acldefault(…))` for both objects; `search_path` compared through `chr(61)`/`chr(34)`; names match the migration (pinned by the migration text test). |

**The migration SQL is approved for the user to paste, unchanged.** Order per CR-1: pre-check, paste `20261014`, checker `VERDICT PASS` (12 pass), Slice 0 checker PASS, **then** merge the 1b PR. The 1a checker's E02 fails by design afterwards (N-2).

#### Claim-before-create, codes and tenant isolation

| Property | Verdict | Where it holds |
|---|---|---|
| I-1 no deletion | ✅ | `AuthAccountRepository` has no delete method; no `deleteUser` in product code. |
| I-2 revoke refuses a live claim | ✅ | `revokeForAdmin` adds `.or(noLiveClaim(cutoff))`; `revokeInviteForAdmin` re-reads and answers 409 `signup_in_progress`; the route passes the outcome's status through. Finalise has no expiry/revoke check. |
| I-3 server-generated id | ✅ | `accountId = row.claimed_account_id ?? deps.newAccountId()` (`crypto.randomUUID`); recorded by the claim CAS before `createConfirmedUser`; a different returned id is never finalised. The body is `.strict()` `{ token, signupCode, password }`. |
| I-4 / D-dev-2 never release on uncertainty | ✅ | Release only on `weak_password` or after `findUserExists(X) === false`; a failed lookup keeps the claim and records `find_user`. |
| D-dev-3 `create_user_id_mismatch` recorded | ✅ | Step `create_user_id_mismatch`, `failedAccountId` = the returned id, keyed on the claimed id; audited `…_INCOMPLETE`. |
| I-5 finalise retried once, then kept | ✅ | Two calls; on a second failure the record (step `finalise`) and the audit are written. |
| I-6 re-claim reuses the id | ✅ | `.is('claimed_account_id', null)` / `.eq(…)` on the observed value (D-dev-1). |
| D-1 live claim → 409 `signup_in_progress` before any code check | ✅ | `loadRedeemableInvite`, both routes. |
| D-4 lease > `maxDuration` | ✅ | 120 s vs 60 s, pinned by `signupCode.test.ts` and the routes test. `claimed_at` is taken after the request starts, so the claim cannot lapse inside a live request. |
| Plan row only through `provisionFromInvite`, `origin = 'invite'` | ✅ | `redemptionDeps.ts` is the only product file that names the plan repository outside admin code; the imports guard pins it to that one write. |
| Lineage L1, issuer from the row | ✅ | Written only by the finalise function: `source 'admin_invite'`, no parent, root = self, level 1, and the `WHERE` requires `issuer_kind = 'admin'` on the row. Nothing from the request. |
| Codes | ✅ except MF-2 | SHA-256 over `id:code`, timing-safe compare, 10-minute TTL, attempt counted by CAS before the compare, 5 attempts per code, attempts reset per new code, system sender (`kind: 'transactional'`, no `from`/`replyTo`/`ownerUserId`), no code in the subject. |
| Redaction | ✅ | `signupCode`, `*.signupCode`, `otp`, `*.otp` (not `code`), with a test. |
| F-6 | ✅ | `valid` carries `maskedEmail` only; the code route returns times only; the full email only in the complete 200. |
| R-13 | ✅ | Server: `TextEncoder` byte length ≤ 72, ≥ 8 code points; the form mirrors it (D-dev-13). |
| F-2 | ✅ | `signInWithPassword(email, password)` in the browser, fallback "Your account is ready. Sign in". |
| FR-12a record | ✅ | `scrubFailureMessage` replaces email-shaped text, collapses whitespace, cuts to 300 code points (as SQL counts); code cut to 64; audit details are exactly the record fields plus correlation id; entity = invite id. |
| D-3 banner and badge | ✅ | `isRedemptionStoppedHalfway` = not redeemed AND (failure recorded OR claim older than the lease), one derivation with the lease constant; the banner carries counts and ids only. |
| Tenant widening, summary route (R-8) | ✅ | Plan row read last and only when profile and onboarding both say no; `toInputs` never returns null data, so "no plan row" is `false` (404), not `null` (500). Three callers pass the repository; the summary route is in `ALLOWED` as read-only. |
| `business-os-entitlements` skill checklist | ✅ | `inviteRedemption.ts` and `redemptionDeps.ts` registered in `KNOWN_NON_GATE_IMPORTERS` with exact symbols; neither refuses a capability; no tier literal; no catalog change; the suite is green after the rebase. |

#### Findings

| # | File:line | Finding | Priority |
|---|---|---|---|
| **MF-1** | `lib/notifications/emailTransport.ts:484-485, 513, 527, 539` (reached from `lib/business-os/invites/redemptionDeps.ts:54`); the claim at `inviteRedemption.ts:37-40` and `lib/email/templates/invite-signup-code.ts:16` | **The invitee's email is logged.** `sendEmail` logs `to: p.to` at `info` ("Attempting to send email", then "Email sent") for every code sent, and the Resend error path logs the provider's error text, which can echo the address. That breaks the slice's own rule, stated in `inviteRedemption.ts`' header, that the email is "never logged", and the property you asked me to check. The template header even notes the transport logs the recipient. **Fix:** an opt-in field on the send params (for example `redactRecipientInLogs: true`), honoured on those log lines (log a masked address, `maskEmail`, or none) and on the Resend error text; `redemptionDeps.ts` sets it; one transport test and one assertion in `redemptionDeps.test.ts`. Do not change what other senders log in this slice. `emailTransport.ts` has 0 `console.*` (checked), so no conversion is owed. | **Must-fix** |
| **MF-2** | `lib/repositories/BusinessOsInviteRepository.ts:346` (`issueSignupCode`) | **The send limit is not fully atomic.** The CAS compares only `signup_code_sent_count`. When the 24 h window has lapsed and the previous window sent exactly one code, the new count is again `1`, so parallel requests that all read `1` all match and all send: the 60 s gap and the per-window count are then enforced read-then-write. Bounded (only at a window rollover, only by request concurrency, and each still needs the real link), but you asked for the limits to be enforced in the database. **Fix:** also compare the observed `signup_code_last_sent_at` (`.is(null)` when none, `.eq(…)` otherwise), which every issue changes; while there, add `.or(noLiveClaim(cutoff))` and `.gt('link_expires_at', now)` so a code is never written onto a live-claimed or expired row. One repository test for the rollover race. | **Must-fix** (small) |
| **MF-3** | Branch base | **Rebase onto `origin/main` before the PR** (now 571f48cc, PRs #134–#136). Two keep-both conflicts: `app/admin/business-os-invites/page.tsx` (PR #136's `key={created.invite.id}` and its comment must stay on `CreatedLinkPanel`, with the T-16 banner above it) and the `BUSINESS_OS_ENTITLEMENTS.md` Change History. After the rebase `enforcementPoints` passes (verified); record `routes.test.ts` as the one remaining pre-existing failure. | **Must-fix** (process) |
| N-1 | `app/invite/invitePageCopy.ts:146` (+ `he`, `es`) | After `weak_password` the code is already spent (the claim CAS cleared it), so re-submitting with a new password answers `code_expired`. Recoverable (that message says "Send a new one"), but the `weak_password` copy should say so up front: "Choose another password, then send yourself a new code". | Nit |
| N-2 | `app/api/public/invites/signup/code/route.ts:58`, `complete/route.ts:70` | `getUser().catch(() => null)` treats a failed session check as signed out. Harmless for security (nothing is granted to the session, and the email lock still binds the account), but log at `warn` in the catch so an auth outage is visible. | Nit |
| N-3 | `lib/business-os/invites/adminInviteOps.ts:369` | A failed lineage read is ignored silently (levels show as unknown, as intended); log it at `warn` with the count of ids. | Nit |
| N-4 | `lib/business-os/entitlements/adminOps.ts:258-270` | Two consecutive JSDoc blocks above `isBusinessOsTenant`; merge them so the L-4 text is part of the function's doc. | Nit |
| N-5 | `app/admin/business-os-invites/page.tsx:129` | D-3 counts an invite that was revoked after its lease lapsed as "stopped halfway" for good (the record is never cleared, by design). That is correct (such an account may lack its plan), but the banner cannot be cleared. Acceptable at today's volume; note it for the automatic-recovery item (§14 of the requirement). | Nit |

#### Rulings on D-dev-9 to D-dev-14

| # | Ruling |
|---|---|
| **D-dev-9** | **Accepted.** Reusing `findEntitlementInputs` avoids a new query shape; it reads the embedded overrides too, which is a little heavier than a `hasPlanRow`, but it runs only for accounts with neither a profile nor an onboarding message. |
| **D-dev-10** | **Accepted.** Injecting finalise keeps the flow testable, and the new `invite_redemption` category plus the one-write pin keeps every plan writer visible (F-8). |
| **D-dev-11** | **Accepted.** One fact, one behaviour, whichever route sees it first; the stamp's `IS NULL` condition keeps the audit to one entry. |
| **D-dev-12** | **Accepted.** FR-12a records a KEPT claim; after a positive "no such user" the claim is released and the invite is usable again. The `warn` log with the auth error code is enough. |
| **D-dev-13** | **Accepted.** The per-code-point count equals the UTF-8 length; the server's `TextEncoder` check stays the authority. |
| **D-dev-14** | **Accepted**, with one wording change: name the file in the banner (`docs/workplans/BUSINESS_OS_INVITE_SIGNUP_SLICE_1_WORKPLAN.md` §6.2) so an admin who has never seen "the Slice 1 workplan" can find it. |

#### Optimisation Suggestions

- When the admin notification email arrives (T-16 option b), it can read the same D-2 fields; nothing here needs to change.
- `routes.test.ts` "account on a tier" is red on `main`: raise it as its own small fix (it is a stale contract fixture after the `payments.reminders` catalog change), so 1b's CI is judged only on its own tests.

#### For the user (business terms)

The database change for signup is **approved to paste as written**. Apply it and run its checker **before** the code is merged, as with 1a. Before the pull request, Dev makes three small changes: the invitee's email address must not appear in our server logs when the code email is sent; the "one code per minute" limit must hold even when many requests arrive at the same instant; and the branch is brought up to date with the latest main. None changes what an invitee sees, and QA can check all three.

**Code Approved for QA: Yes**, conditional on MF-1, MF-2 and MF-3.

---

## QA Testing Report

### QA Report 1a — 2026-09-28

**QA — 2026-09-28 (Slice 1a only; 1b is not built and was not tested)**
**Test mode:** full
**Strategy used:** A + B (Jest unit and integration, run in the worktree), plus probe tests kept in the QA scratchpad (not in the tree), mutation testing and static SQL review. Playwright is not set up (CLAUDE.md), so the browser path is covered by the production checklist below.
**Focus:** api, ui, schema, security
**Skipped:** anything touching a database or a deployed route (by instruction). `tsc` and `next build` were not re-run: SA ran both on this same diff (§ SA Code Review) and no source file changed since.
**Input source:** prompt keywords (TL brief), plus this workplan's §12.1 and §14.1.

**Safety record:** every modified and untracked file (33: 24 modified, 9 untracked) and `git diff --stat` were snapshotted with SHA-256 hashes before testing. No `checkout`, `stash`, `reset`, `clean`, `restore` or commit was run. Each mutant and each guard plant touched one file, which was then restored from the snapshot and proven by hash and `diff`. At the end, `git status --porcelain` and all 33 hashes match the snapshot; this QA section is the only change.

#### Tests run

| Run | Result |
|---|---|
| `lib/business-os/invites`, `app/api/public/invites`, `app/api/admin/business-os/invites`, `app/invite`, `app/admin/business-os-invites`, `app/admin/components`, `lib/repositories/__tests__` (incl. the CR-2 callers guard), `lib/audit`, `supabase/migrations/__tests__` | **70 suites, 1,107 tests, all pass** |
| `npm run test:authz-guard` | **119 / 119 pass** |
| Wider neighbours: `lib/business-os/entitlements`, `lib/business-os/purge`, `lib/admin`, `app/api/admin/business-os` | 50 suites, 1,518 / 1,520 pass. The 2 failures are the known pre-existing ones: `customerPlanView.test.ts` and `app/api/admin/business-os/entitlements/__tests__/routes.test.ts`, both fixed on `main` by PR #129. |
| Every `*guard*`, `*forbidden*`, `*invariant*`, `enforcementPoints` suite in the repo | **41 suites, 1,063 tests, all pass** |
| QA probes (scratchpad, config pointed at the worktree): route-level (27), real repositories chained through the real view (11), page, copy and RTL (8) | **46 / 46 pass**; one edge case recorded (QA-3) |

#### Adversarial checks

| Check | Result | Evidence |
|---|---|---|
| **No email-probing oracle** | ✅ Pass | Probe: injected `email`, `p_email`, `userId` keys, or `email` with no token, give 400 with no email read and no lookup (`.strict()` body). Matched but expired, revoked, used or grant-gone invites, and unknown, malformed or one-character-off tokens, never read the email or ask the lookup. Two matched invites were asked about exactly their own DB-row emails, in order. With the real repositories, the RPC received `{ p_email }` = the DB row's email, trimmed and lower-cased. Mutant M1 (lookup before the state gate) killed by 7 tests. |
| **Lookup failure or non-boolean → 503** | ✅ Pass | Probe: lookup data `null`, `undefined`, `'true'`, `'false'`, `1`, `0`, `{}` each give 503 `{"success":false,"error":"unavailable_try_again"}` with no audit. An RPC error (`42501 permission denied`) and a row that disappeared between the two reads also give 503. Checked at two layers (the repository rejects non-booleans; the view re-checks `typeof`). Mutants M2 and M9 killed. |
| **Bad-token responses byte-identical** | ✅ Pass | Existing AC-2 tests are unchanged and pass. Probe: while the real invite is `existing_account`, the unknown, malformed and one-off answers are byte-identical (`{"success":true,"data":{"state":"not_recognised"}}`, same headers). `existing_account` is exactly `{"success":true,"data":{"state":"existing_account","language":"en","inviterDisplayName":"Dana"}}` with `no-store` and `no-referrer`. Two different existing-account invites answer byte-identically. `valid` contains no `@` and no UUID. Mutant M5 (email added to the response) killed. |
| **Audit on first open only** | ✅ Pass | Probe: 8 concurrent opens of one invite, against an atomic check-and-set fake with scheduling jitter, write **exactly 1** entry; 4+4 concurrent opens of two invites write one each. In production, atomicity comes from the single `UPDATE … WHERE opened_by_existing_account_at IS NULL RETURNING id`: under READ COMMITTED a second writer re-checks the WHERE clause after the row lock and gets 0 rows. Entry details are exactly `{ correlationId }`, with no `@` and no token; no log line carries either email. Mutants M3 (audit on every open), M4 (drop the `IS NULL` filter) and M10 (stamp always reports "set now") all killed. See QA-4 for what the stored row shows on production. |
| **Signed-in visitor (D-dev-6)** | ✅ Pass, with QA-3 | Existing tests plus probe: on `existing_account`, a signed-in visitor sees the notice and no Sign in button (also in Hebrew, `dir="rtl"`). The notice is not shown on the other states. Sign out is audited and re-checks the invite. |
| **Copy en / he / es, RTL** | ✅ Pass | Probe: each new key differs from English in `he` and `es`; the Hebrew strings contain only Hebrew letters; `signedInHeading` is translated in both forms and carries the email. A Hebrew page rendered with the email removed contains no English word. |
| **Labels** | ✅ Pass | The sidebar says "Signup Invites" with an unchanged href. The page heading is "Business OS Signup Invites". The admin row shows "Opened by an existing account (date)". All pinned by render and nav tests. Nit: QA-5. |
| **CR-2 guard** | ✅ Pass, with QA-2 | A direct `client.rpc('business_os_auth_email_has_account', …)` was planted in `app/api/admin/business-os/invites/route.ts`: the guard **failed** and named the file. Restored; hash equal, `git diff` clean. |

#### Mutation testing (one file at a time, each restored and proven)

| # | File | Mutation | Result |
|---|---|---|---|
| M1 | `publicInviteView.ts` | Lookup asked for every matched token, before the state gate | **Killed** (7 tests) |
| M2 | `publicInviteView.ts` | Lookup error or non-boolean falls through to "no account" | **Killed** (2) |
| M5 | `publicInviteView.ts` | Email added to the `existing_account` response | **Killed** (2) |
| M3 | `validate/route.ts` | Audit on every `existing_account` open, not the first only | **Killed** (1) |
| M4 | `BusinessOsInviteRepository.ts` | `.is('opened_by_existing_account_at', null)` removed | **Killed** (1) |
| M10 | `BusinessOsInviteRepository.ts` | Stamp always reports "set now" | **Killed** (1) |
| M9 | `AuthAccountRepository.ts` | Non-boolean check removed | **Killed** (5) |
| M8 | `20261013_…sql` | `REVOKE ALL … FROM anon` removed | **Killed** (1) |
| M6 | `check-bos-invite-existing-account-migration.sql` | E06 no longer inspects `anon` | **SURVIVED** → QA-1 |
| M7 | `check-bos-invite-existing-account-migration.sql` | E07 passes for any service_role privilege set (`execute_total >= 0`) | **SURVIVED** → QA-1 |

#### Static SQL review

| Item | Migration | Rollback | Checker |
|---|---|---|---|
| SQL-editor-safe (no comments; literals only letters, digits, `_`, space; no single-letter alias; one `BEGIN`/`COMMIT` where applicable) | ✅ | ✅ | ✅ (read-only session, one final `SELECT`) |
| `REVOKE ALL` from `PUBLIC`, `anon`, `authenticated`, `service_role`, one statement each, then only `GRANT EXECUTE … TO service_role` | ✅ | — | E06/E07 logic correct today, but unpinned (QA-1) |
| `SET search_path = ''`; `auth.users` schema-qualified; returns `boolean` only (`EXISTS` never returns NULL; NULL input gives `false`, and the repository never sends NULL) | ✅ | — | E05 compares `proconfig` with `search_path=""` via `chr()` ✅ |
| `CREATE FUNCTION` without `OR REPLACE`; the column is nullable with no default | ✅ (the runbook pre-check covers a re-run) | Drops exactly the function and the column | E01 nullable, E02 16 CHECKs, E03 exactly one function |
| `acldefault('f', owner)` when `proacl` is NULL (a default ACL would show PUBLIC EXECUTE → E06 FAIL) | — | — | ✅ |

#### Issues Found

**Bugs (must fix before commit):** none.

**Test gaps and edge cases:**

1. **QA-1: the checker's E06/E07 pass logic is not pinned** (Low, test gap). File: `supabase/migrations/__tests__/business-os-invite-existing-account.migration.test.ts:151-163`, covering `scripts/check-bos-invite-existing-account-migration.sql:51,92`.
   - Mutants M6 (drop `anon` from E06's role list) and M7 (E07 passes anything) survive all 190 tests. The test pins only the row labels, `aclexplode` and `acldefault`.
   - The checker SQL is correct today, but it is the **only production proof** of the privileges that CR-1 requires before merge. A later edit could turn it into a false PASS.
   - Slice 0's own test already pins its equivalent (`business-os-invites.migration.test.ts:266-267`).
   - Fix, two assertions: `expect(checker).toContain("function_acl.grantee_name IN ('PUBLIC', 'anon', 'authenticated')")` and `expect(checker).toContain('service_entries.execute_total = 1 AND service_entries.other_total = 0')`. **Recommended before commit** (cheap), not blocking.
2. **QA-2: the CR-2 guard does not scan the repository root** (Low, edge case). File: `lib/repositories/__tests__/authAccountRepository.callers.guard.test.ts:31,70`.
   - A direct `rpc('business_os_auth_email_has_account', …)` planted in the root `middleware.ts`, which is deployed server code, left the guard at 7/7 pass. Restored; hash equal, `git diff` clean.
   - `types/` and the root `i18n.ts` are also unscanned.
   - Suggest adding the root-level `*.ts` files, or at least `middleware.ts`.
   - A name built by string concatenation would still get past any text guard. That residual risk is accepted, because the database grant is the real control.
3. **QA-3: Sign in can flash for a signed-in visitor** (Low, edge case). File: `app/invite/page.tsx:190`.
   - `!showSignedInNotice` is true while `visitor.status === 'checking'`. If the invite check returns before `getSession()` resolves, Sign in shows until the session read finishes. The probe confirmed it (`shownWhileChecking=true`); the button is then removed.
   - This is unlikely because `getSession()` is local, except when supabase-js must refresh an expired token first.
   - The only harm is a link to `/login`. It still goes against D-dev-6's intent. Fix: hide Sign in while `visitor.status === 'checking'`.
4. **QA-4: what the audit row shows on production** (Note, pre-existing, not introduced by 1a). File: `lib/services/AuditTrailService.ts:147-149`.
   - The route passes `userId: null, actorId: null`. If `SYSTEM_ADMIN_USER_ID` is set on production, `buildLogEntry` substitutes it for both and adds `details.system_action: true`. The `user_email` BEFORE INSERT trigger then fills the **system admin's** email.
   - The invitee's email is never involved. Checklist step P6 below expects this.
   - If a truly anonymous row is wanted, that is a platform-wide `AuditTrailService` change, outside 1a.
5. **QA-5: two old "Business OS Invites" labels remain** (Nit). `app/admin/business-os-invites/page.tsx:4` (header comment only) and `lib/audit/filterOptions.ts:104` (the audit-log filter category, arguably correct as the name of the event family).
6. **QA-6: the email inside the Hebrew notice is not direction-isolated** (Nit). `app/invite/invitePageCopy.ts:118` puts a left-to-right email inside right-to-left text with no direction isolation (`<bdi>`), so punctuation around the address may render oddly. Look at it in P7 if you test in Hebrew.
7. SA's N-1 (the notice wording on `existing_account`) stays open for 1b-8, as planned.

**Performance:** none. `existing_account` adds one keyed read and one RPC, and only for a matched, pending token. `lower(auth_user.email)` cannot use the `auth.users` email index, which SA has already noted as acceptable at current volume.

#### Production checklist (the user runs this; order per CR-1)

`<you>` is your own existing sign-in email. `<you+qa1a>` is a plus-address you own that has **no** account. Never use a real invitee's address.

| # | When | Do | Expect | Pass? |
|---|---|---|---|---|
| P1 | **Before merge** | Rebase the 1a branch onto `origin/main` (PR #129 fixes the two pre-existing failures), and wait for green CI. | CI green. | ⬜ |
| P2 | **Before merge** | §6.1 step 1: run the pre-check query in the SQL editor. | `0`. A `1` means the migration is already applied; go to P4. | ⬜ |
| P3 | **Before merge** | Paste the whole of `supabase/migrations/20261013_business_os_invite_existing_account.sql`. | "Success. No rows returned." | ⬜ |
| P4 | **Before merge** | Paste `scripts/check-bos-invite-existing-account-migration.sql`. | `VERDICT PASS`, **7 pass 0 fail**. E06 detail `none`; E07 detail `EXECUTE`. On an E06/E07 FAIL, re-run the four `REVOKE` lines and the `GRANT`, then P4 again. On any other FAIL, **do not merge**; follow §15.1. | ⬜ |
| P5 | **Before merge** | Paste the Slice 0 checker `scripts/check-bos-invites-migration.sql`. | `VERDICT PASS`, 11 pass. | ⬜ |
| — | **Only now** | **Merge the 1a PR** (the merge is the deploy). Wait for the Vercel production deploy to finish. | — | ⬜ |
| P6 | After deploy | Admin sidebar: the entry reads **"Signup Invites"**; the page heading reads **"Business OS Signup Invites"**; the list loads. Create a champion invite for **`<you>`** (1 month, 15 days, reason "QA slice 1a"); copy the link. | Labels as stated; link shown once; row Pending. (A failed list or create means the column is missing: apply the migration at once or revert, §6.1 step 5.) | ⬜ |
| P7 | After deploy | Private window (signed out), open the link. | **"You already have an account"**, with **Sign in** going to the normal sign-in page. No offer, no note. No Supabase session cookie was set (DevTools, Application, Cookies). | ⬜ |
| P8 | After deploy | Reload the admin list. | The row is still **Pending** and shows **"Opened by an existing account (date)"**. | ⬜ |
| P9 | After deploy | Reload the link twice more, then read-only SQL: `SELECT id, entity_id, user_id, actor_id, details FROM public.audit_trail WHERE action = 'BOS_INVITE_OPENED_BY_EXISTING_ACCOUNT' ORDER BY created_at DESC LIMIT 5;` | **Exactly one** row for that invite. `entity_id` = the invite id. `details` has `correlationId` (and `system_action` if `SYSTEM_ADMIN_USER_ID` is set, QA-4). No invitee email, token or hash anywhere in it. | ⬜ |
| P10 | After deploy | In your normal **signed-in** window, open the same link. | "You're signed in as `<you>`" plus the sign-out line, a **Sign out** button, and **no Sign in button**. Click Sign out: you are signed out, and the page re-checks and shows Sign in. | ⬜ |
| P11 | After deploy | Create a second invite for **`<you+qa1a>`** (no account); open it in a private window. | The **valid** page: the offer and the "account creation is not available here yet" line. **Not** "already have an account". The admin row shows no existing-account line. | ⬜ |
| P12 | After deploy | Read-only SQL: `SELECT opened_by_existing_account_at, first_viewed_at, redeemed_at FROM public.business_os_invites WHERE email IN ('<you>', '<you+qa1a>');` | `<you>`: stamp set, `first_viewed_at` null, `redeemed_at` null. `<you+qa1a>`: stamp null, `first_viewed_at` set. | ⬜ |
| P13 | After deploy | Revoke both QA invites ("QA cleanup"). | Both Revoked. | ⬜ |

#### Final Status

**Verdict: PASS WITH NOTES.**

- [x] All 1a acceptance criteria pass in tests (FR-8a, AC-6a, L-3, L-8 for 1a, R-4, CR-2, D-12, D-13, D-dev-5 to D-dev-7). There is no High or Medium issue.
- [ ] Recommended before commit: QA-1 (two assertions). Optional: QA-2 and QA-3. QA-4 to QA-6 are notes.
- [ ] Before merge: P1 to P5 (CR-1). After merge: P6 to P13.

### QA Report 1b — 2026-09-29

**QA — 2026-09-29 (Slice 1b: champion signup with email, password and an emailed 6-digit code; FR-12a indicator)**
**Test mode:** full
**Strategy used:** A + B (Jest unit and integration in the worktree), plus probes kept in the QA scratchpad (not in the tree), mutation testing, and the real `20261012`/`20261013`/`20261014` SQL, rollback and all three checkers run on an in-memory PGlite. Playwright is not set up (CLAUDE.md), so the browser path is the production checklist below.
**Focus:** api, ui, schema, security
**Skipped:** anything touching a real database, a deployed route, or an email provider (by instruction). `tsc`, `eslint` and `next build` were not re-run: SA ran them on this diff, and MF-1/MF-2 changed TypeScript only in files the Jest runs compile (ts-jest type-checks each of them).
**Input source:** prompt keywords (TL brief), plus §2.4, §12.2, §14.2 and SA Code Review 1b.

**Safety record:** before testing, all 67 modified or untracked files (43 tracked, 24 new) plus `git status --porcelain`, `git diff --stat` and `git diff` were snapshotted with SHA-256 hashes. No `checkout`, `stash`, `reset`, `clean`, `restore`, `rebase` or commit was run. Each mutant touched one file, which was then restored from the snapshot and proven by hash before the next. Before this section was written, `git status --porcelain`, the diffstat, the file list and all 67 hashes matched the snapshot, and HEAD was unchanged (`aa9d75e9`). This section is the only change.

#### MF-1 and MF-2 (SA's conditions): verified

| # | What SA asked | Verdict | Evidence |
|---|---|---|---|
| **MF-1** | The code email must not log the invitee's address, including when a provider error echoes it | ✅ **Verified** | `sendEmail` masks `to` on every log line (attempt, "Email sent" for Resend, SMTP and Gmail, and the final "not delivered" warn) and strips email-shaped text from the Resend error text (logged **and** thrown) and from every transport's caught message (logged **and** returned in `SendEmailResult.error`). Probe against the real `sendEmail` (fetch mocked, Resend configured): success logs `d•••@example.com` only. A Resend 422 whose body echoes the address twice (plain and `<…>`) leaves no address in the logs or the returned result (`[email]`). An SMTP `550 <addr>: Recipient address rejected` gives the same. **Other senders are unchanged**: without the flag, the address is still logged. `redemptionDeps.ts:61` sets the flag. Mutants M6, M7 and M12 all killed. |
| **MF-2** | The send limit must be atomic at the 24 h rollover | ✅ **Verified** | `issueSignupCode` now compares the observed `signup_code_last_sent_at` (`.is(null)` / `.eq`), plus `link_expires_at > now` and no live claim. Race probe (real repository and flow over a PostgREST-shaped fake with random per-call latency): old window with 1 code sent, **12 parallel requests, 20 trials: exactly 1 code each time**, the rest `try_again` or `code_recently_sent`. The same for 12 parallel first-ever sends. **With the MF-2 predicate removed (mutant M3), the same probe sent 12 codes out of 12.** The repository also refuses to store a code on an expired link or a live-claimed row, and accepts one on a lapsed claim. M3 and M4 killed by the tree's own tests. |
| MF-3 | Rebase onto `origin/main` | ⬜ RM, at commit time | Not a QA item. The branch is still at `aa9d75e9` (so `enforcementPoints` fails, as expected); see the Commit Info rebase note. |

#### Tests run

| Run | Result |
|---|---|
| `lib/business-os/invites`, `app/api/public/invites`, `app/api/admin/business-os`, `app/invite`, `app/admin/business-os-invites`, `lib/repositories/__tests__`, `lib/audit`, `lib/logger`, `lib/email/templates`, `lib/notifications`, `supabase/migrations/__tests__`, `lib/business-os/entitlements`, `lib/business-os/purge`, `lib/admin` | **130 suites, 2,817 tests: 2,815 pass, 2 fail**. Both failures are the known pre-existing ones: `enforcementPoints` (only `lib/business-os/llm/aiActionAudit.ts` unaccounted; fixed on main by #134, goes away on rebase) and `app/api/admin/business-os/entitlements/__tests__/routes.test.ts` "account on a tier" (fails on clean main). |
| Every `*guard*`, `*forbidden*`, `*invariant*`, `enforcementPoints` suite in the repo | **41 suites, 1,070 tests: 1,069 pass, 1 fail** (the same pre-existing `enforcementPoints` failure) |
| `lib/business-os/__tests__` | 18 suites, 204 tests, all pass |
| `npm run test:authz-guard` | **119 / 119 pass** |
| QA probes, SQL (PGlite: the real migrations, the rollback and the three checkers) | **57 / 57 pass** |
| QA probes, flow (real invite and auth repositories with the real `requestSignupCode` / `completeSignup`, interleaving fake) | **61 / 61 pass** |
| QA probes, MF-1 (real `sendEmail`) and both routes | **16 / 16 pass** |

#### Adversarial checks

| Check | Result | Evidence |
|---|---|---|
| **Code only for a valid, pending, unclaimed invite** | ✅ Pass | Revoked → 409 `revoked`; expired link → `expired`; redeemed → `used`; live claim → `signup_in_progress`; paid → `paid_invites_not_available`; account-issued → `unavailable`. In every case no code is sent. Existing account → 409 `existing_account`: 6 parallel requests stamp once and audit once, and send nothing. Unknown, malformed and one-character-off tokens get a byte-identical `not_recognised`. |
| **Limits** | ✅ Pass | 60 s: a request at 59 s gets 429 `code_recently_sent` with `retryAfterSeconds: 1`, and 60 s later it goes through. 5 per 24 h: the sixth gets 429 `code_limit_reached` with a positive wait; after the window closes, it is allowed and the count resets to 1. 5 tries: the remaining count goes 4, 3, 2, 1, 0, then `code_locked` even for the right code. One `REDEMPTION_REFUSED` (`code_attempts_exhausted`) is audited. TTL: at 9:59 the code works; at 10:00 it is `code_expired`. A new code replaces the old one, and the old one fails. |
| **Attempt counted before the compare** | ✅ Pass | The right code with a lost claim still consumed an attempt (`signup_code_attempts = 1`). 40 parallel wrong guesses: never more than 5 counted, and never more than 5 compared (the attempt CAS on the observed count plus the code hash). M5 killed. |
| **Uniform errors** | ✅ Pass | Wrong → `{error:'code_invalid', attemptsRemaining}`; expired → exactly `{success:false, error:'code_expired'}`; used → exactly `{success:false, error:'used'}`. No email, hash or id in any error body. |
| **Claim before create; one account** | ✅ Pass | Order spy: `claim` then `create`. `createConfirmedUser` receives the id already recorded on the row, and the row's own email. 8 parallel completes with the right code, 10 trials: exactly one account and one plan row each time, and the losers get `try_again` / `signup_in_progress` / `code_expired`. Two invites to one email completed in parallel: one account; the loser's claim is released and it answers `existing_account`. M1 killed. |
| **409 `signup_in_progress`; revoke during a claim** | ✅ Pass | A live claim gets `signup_in_progress` from both routes before any code check. The real `revokeInviteForAdmin` over the real repository: at claim +60 s → 409 `signup_in_progress`, row not revoked; after the lease → revoked. |
| **Release vs keep** | ✅ Pass | `createUser` failing with "other" plus a positive "no such user" → released, 503, no failure record (D-dev-12). `createUser` failing **and** `findUserExists` erroring → **claim kept**, 503, record step `find_user` with the auth code and a scrubbed message, and `…_INCOMPLETE` audited with exactly the five D-2 fields. M2 ("release when unsure") killed. `weak_password` → released, 400; the spent code then gives `code_expired` (N-1 copy covers it). |
| **`create_user_id_mismatch`** | ✅ Pass | A different returned id → claim kept, record with step `create_user_id_mismatch` and the **returned** id, no finalise, 503. |
| **Finalise: re-run safe, origin, end date, lineage** | ✅ Pass (real SQL) | In PGlite: finalise returns the invite id; the plan row is `cohort champion`, `origin 'invite'`, `tier` NULL, and `cohort_expires_at` = the row's own transaction time + 3 months (NULL for open-ended). Lineage: `admin_invite`, L1, no parent, root = self, the invite id from the row, and `redeemed_account_id = claimed_account_id`. A re-run returns the same id and writes nothing; a different account gets NULL. A wrong email, account or cohort, an `issuer_kind 'account'`, a `tier` grant or an unclaimed invite each get NULL and write nothing. Revoked after the lease → aborts on `not_revoked_and_redeemed`, and nothing is written. A pre-existing trial plan row → unique violation; the invite update rolls back and the trial row is untouched (the §6.2 D-5c branch). No auth user yet → plan FK aborts and nothing is redeemed. Finalise failing twice in the flow → record step `finalise`, code `42501`, message `insert failed for [email]: permission denied`. I-6: a lapsed claim is re-taken with the **same** id after a new code. M9 (origin changed) killed. |
| **`.strict()` bodies, no request-supplied id** | ✅ Pass | Schema: injected `email`, `userId`, `accountId`, `cohort`, `tier`, `level`, `grantId` and `id` are each refused, and so is `email` on the code body. Route: each injected key gives 400 `invalid_request`, **before the session read and with no flow call**, with `no-store` and `no-referrer`. The flow receives exactly `{token, signupCode, password}`. M8 killed. |
| **Leaks** | ✅ Pass, with QA-1b-3 | Full run (two sends, a wrong code, success, a re-use), with every repository and route log line captured: no email or its local part, no token or token hash, no code or code hash, no password in any log line, audit entry or refusal body. The code-route 200 carries only `codeExpiresAt` and `resendAvailableAt`. The full email appears only in the complete-route 200. `maskEmail`: `dana@…` → `d•••@example.com`; a 1-character local part shows only that character; a leading emoji shows as one code point. The scrub removes `<a@b>`, `mailto:`, quoted, upper-case and comma-joined addresses, and caps at 300 code points. |
| **Passwords (R-13)** | ✅ Pass | Server: 36 × `é` (72 bytes) accepted, 37 × `é` (74) refused; 18 emoji (72) accepted, 19 (76) refused; 36 × `א` accepted, 37 refused; 72 ASCII accepted, 73 refused; 7 characters refused; 8 emoji accepted. The route answers 400 for a 74-byte password without echoing it. `weak_password` copy follows N-1 in all three languages ("send a new code, then choose another password"). |
| **FR-12a indicator (D-3)** | ✅ Pass, with QA-1b-2 | `isRedemptionStoppedHalfway` is true for a failure record, true for a claim older than the lease with no record (the timeout case), and false for a live claim or a redeemed row. The record message is ≤300 characters with no `@`. The banner names `docs/workplans/BUSINESS_OS_INVITE_SIGNUP_SLICE_1_WORKPLAN.md` §6.2, but no test pins it (M11 survived). |
| **Lease > `maxDuration`** | ✅ Pass | Route exports `maxDuration = 60`; lease 120; the policy constant agrees. M10 (lease 60) killed. |
| **Existing account; copy; RTL** | ✅ Pass, with QA-1b-8 | `existing_account` from both routes and from the page. The page shows "you already have an account" with Sign in, no offer and no form (the form is structurally inside the `valid` section only). en/he/es copy present for every signup string, including every error; Hebrew is `dir="rtl"` with the masked address isolated left to right; the code in the email is `dir="ltr"`. |
| **Session** | ✅ Pass | Signed in → 409 `signed_in` from both routes before the flow runs. A failed session check → treated as signed out and logged at `warn` (N-2). |

#### Mutation testing (one file at a time, each restored and proven by hash)

| # | File | Mutation | Result |
|---|---|---|---|
| M1 | `inviteRedemption.ts` | Create the user before the claim | **Killed** (3) |
| M2 | `inviteRedemption.ts` | Release the claim when `findUserExists` fails (release on uncertainty) | **Killed** (1) |
| M5 | `inviteRedemption.ts` | Compare the code before counting the attempt | **Killed** (2) |
| M3 | `BusinessOsInviteRepository.ts` | MF-2: drop the `signup_code_last_sent_at` compare-and-swap predicate | **Killed** (2); the QA race probe also kills it (12 of 12 sent) |
| M4 | `BusinessOsInviteRepository.ts` | MF-2: drop `link_expires_at > now` and the no-live-claim filter from the issue CAS | **Killed** (1) |
| M6 | `emailTransport.ts` | MF-1: log the recipient unmasked | **Killed** (2) |
| M7 | `emailTransport.ts` | MF-1: stop scrubbing provider error text | **Killed** (1) |
| M12 | `redemptionDeps.ts` | MF-1: the code email stops setting `redactRecipientInLogs` | **Killed** (1) |
| M8 | `inviteSchemas.ts` | Remove `.strict()` from the complete body | **Killed** (6) |
| M9 | `20261014_…sql` | Plan-row origin `'invite'` → `'admin'` | **Killed** (1) |
| M10 | `signupCodePolicy.ts` | Lease 120 → 60 (= `maxDuration`) | **Killed** (3) |
| M11 | `app/admin/business-os-invites/page.tsx` | Banner no longer names the runbook file | **SURVIVED** → QA-1b-2 |
| M13 | `check-bos-invite-signup-migration.sql` | S06 passes for any `service_role` privilege set | **SURVIVED** → QA-1b-1 |

#### Static SQL review (`20261014`, rollback, checker)

| Item | Result |
|---|---|
| Migration text = §4.2 of this workplan, line for line | ✅ |
| Editor-safe: no comments, literals only letters/digits/`_`/space, no single-letter alias, one `BEGIN`/`COMMIT`, no `IF NOT EXISTS`/`OR REPLACE` | ✅ (also pinned by the migration text test) |
| `REVOKE ALL` from `PUBLIC`, `anon`, `authenticated`, `service_role` for the table and the function, then `GRANT SELECT, INSERT` / `GRANT EXECUTE` to `service_role` only | ✅. In PGlite with Supabase-style default privileges: anon and authenticated cannot execute finalise or read lineage; service_role cannot UPDATE or DELETE lineage. |
| Finalise `SECURITY INVOKER`, `proconfig = {search_path=""}`, every name qualified | ✅ (read back from `pg_proc`) |
| RLS on lineage, no policy, no FK, no trigger | ✅ |
| NULL-safe CHECKs | ✅ All 13 violations tried were refused by the named constraint (claim pairing both ways, `redeemed_by_claimant` with no claim and with a different claimant, code pairing, hash length 63, negative counter, NULL attempts, failure pairing both ways, message 301 multi-byte characters, step 65, lineage level shape ×2, admin parentless, organic with invite id, unknown source, one lineage row per invite). 300 multi-byte characters and a 64-character code are accepted. |
| Checker | ✅ `VERDICT PASS 12 pass 0 fail` after the verbatim migration. The Slice 0 checker still passes 11/11. **The 1a checker's E02 FAILS (`23 of 16`) as designed, and every other 1a row passes** (N-2). Drift probes: without the lineage `REVOKE … FROM service_role`, S06 FAILS and lists the extra privileges; without the function `REVOKE … FROM anon`, S11 FAILS (`anon EXECUTE`). |
| Rollback | ✅ Applies cleanly with redeemed rows present; removes the 13 columns, the table and the function; 16 CHECKs remain; `origin 'invite'` plan rows stay (§15.2). See QA-1b-4 for re-applying afterwards. |

#### Issues Found

**Bugs (must fix before commit):** none.

**Test gaps and edge cases:**

1. **QA-1b-1: the checker's S06 pass condition is not pinned** (Low, test gap). `supabase/migrations/__tests__/business-os-invite-signup.migration.test.ts:225`, covering `scripts/check-bos-invite-signup-migration.sql:132`.
   - M13 (S06 passes for any privilege set) survives all tests.
   - The drift probe shows the condition matters: a missed lineage `REVOKE` is caught by the real S06 and would be a false PASS under M13.
   - This is the same class as 1a's QA-1. S11 and S12 are already pinned.
   - Fix, one assertion: `expect(checker).toContain('lineage_service.expected_total = 2 AND lineage_service.unexpected_total = 0')`.
2. **QA-1b-2: the banner's runbook path is not pinned** (Low, test gap). The banner is at `app/admin/business-os-invites/page.tsx:129`; the test that should pin it is at `app/admin/business-os-invites/__tests__/page.render.test.tsx:135`.
   - M11 (the path removed) survives. D-dev-14 and SA made the path a requirement.
   - Fix: assert that the banner contains `docs/workplans/BUSINESS_OS_INVITE_SIGNUP_SLICE_1_WORKPLAN.md` and `§6.2`.
3. **QA-1b-3: audit rows for the new account carry its email in `user_email`** (Low, note; business acceptance wanted). `lib/business-os/invites/redemptionDeps.ts:71-72`.
   - `details` are clean everywhere. But the route passes `userId = accountId`, and the dashboard-only `trigger_sync_audit_user_email` then fills `audit_trail.user_email` from `auth.users` on:
     - `BOS_INVITE_REDEEMED` and `BOS_INVITE_PLAN_PROVISIONED`;
     - `BOS_INVITE_REDEMPTION_INCOMPLETE`, whenever that account exists (step `finalise`; for `create_user_id_mismatch`, the returned account).
   - The browser sign-in straight after signup also writes the platform's standard `USER_LOGIN` audit, with the email in `details` and `resource_name` (`lib/client/auth-actions.ts:115-120`; it predates this slice).
   - None of this goes to an outside party, and it is how every user-attributed audit row works. It does, though, go further than AC-5a's "never carries the email" if the audit row counts as part of the FR-12a record.
   - Options: accept it as platform attribution (recommended), or pass `userId: null` for `…_INCOMPLETE` and keep the account id in `details`.
   - Checklist step C12 expects this, so it is not mistaken for a leak.
4. **QA-1b-4: re-applying `20261014` after its rollback fails once any signup has happened** (Low, runbook gap). §15.2, `supabase/SQL Scripts/20261014_business_os_invite_signup_rollback.sql`.
   - The rollback drops `claimed_account_id` but keeps `redeemed_account_id`. A later re-apply then fails its `ADD CONSTRAINT … redeemed_by_claimant` (`violated by some row`), and the whole transaction rolls back safely. Proven in PGlite.
   - §15.2 should say so, and give the fix before a re-apply: back-fill `claimed_at` and `claimed_account_id` from the redeemed columns.
5. **QA-1b-5: the banner only sees the newest 200 invites** (Low, edge case). `lib/business-os/invites/adminInviteOps.ts:364`: the count is derived from `listRecentForAdmin`, which is capped at 200.
   - A stopped signup older than the newest 200 invites is neither counted nor marked. That is acceptable at today's volume.
   - Worth recording with SA's N-5 for the automatic-recovery item.
6. **QA-1b-6: step `create_user` is never written** (Nit). `lib/business-os/invites/signupCodePolicy.ts:57`: every `createUser` failure goes through `findUserExists`, so the recorded steps are `find_user`, `create_user_id_mismatch` and `finalise`. The fourth name is unused vocabulary, and §2.4 lists it. Harmless.
7. **QA-1b-7: the password has no length cap before the byte count** (Nit). `lib/business-os/invites/inviteSchemas.ts:149`: a multi-megabyte `password` is fully encoded and split before it is refused. The platform's body limit bounds it. A `.max(512)` in front would make the refusal cheap.
8. **QA-1b-8: the "no form" assertion on the existing-account page checks for textboxes only** (Nit). `app/invite/__tests__/page.render.test.tsx:223`: the signup form's first step has no textbox, so a form rendered there would pass. It cannot happen today (the form sits inside the `valid` section). Add `expect(screen.queryByTestId('invite-signup')).not.toBeInTheDocument()`.

**Performance:** none. The code route adds one keyed read, one RPC and one CAS per request. Complete adds at most two CASs, one auth create, one optional `getUserById` and two finalise calls.

**Pre-existing (not this slice):** `enforcementPoints` (goes away on the MF-3 rebase) and `entitlements/__tests__/routes.test.ts` "account on a tier" (red on clean main; needs its own ticket).

#### Production checklist (the user runs this; order per CR-1)

`<you+s1b>` is a fresh plus-address of your own Gmail (for example `yourname+s1b@gmail.com`) that has **never** had an AgentPilot account. Never use a real invitee's address. **The test account cannot be deleted afterwards** (I-1, F-15); a 1-month grant lapses on its own.

| # | When | Do | Expect | Pass? |
|---|---|---|---|---|
| C1 | **Before merge** | Pre-check in the SQL editor: `SELECT count(*) AS lineage_tables FROM pg_class JOIN pg_namespace ON pg_namespace.oid = pg_class.relnamespace WHERE pg_namespace.nspname = 'public' AND pg_class.relname = 'business_os_account_lineage';` then `SELECT count(*) AS redeemed_invites FROM public.business_os_invites AS invite_row WHERE invite_row.redeemed_at IS NOT NULL;` | `0` and `0`. A `1` for the first means the migration is already applied (go to C3). A non-zero second count means the paste would fail on `redeemed_by_claimant`; stop and tell Dev. | ⬜ |
| C2 | **Before merge** | Paste the whole of `supabase/migrations/20261014_business_os_invite_signup.sql`. | "Success. No rows returned." One transaction; any error rolls everything back. | ⬜ |
| C3 | **Before merge** | Paste `scripts/check-bos-invite-signup-migration.sql`. | `VERDICT PASS`, **12 pass 0 fail**. S05 and S11 detail `none`; S06 detail `INSERT SELECT`. On S05/S06/S11/S12 FAIL, re-run the `REVOKE`/`GRANT` lines for that object, then C3 again. Any other FAIL: **do not merge**; §15.2. | ⬜ |
| C4 | **Before merge** | Paste the Slice 0 checker `scripts/check-bos-invites-migration.sql`. | `VERDICT PASS`, 11 pass. | ⬜ |
| C5 | **Before merge** (optional) | Paste the 1a checker `scripts/check-bos-invite-existing-account-migration.sql`. | **E02 FAILS (`23 of 16`) by design** (N-2); every other row PASS. | ⬜ |
| C6 | **Before merge** | RM rebases onto `origin/main` (MF-3; two keep-both conflicts), and CI goes green. | CI green; `enforcementPoints` passes after the rebase; only the known `routes.test.ts` failure, if CI runs it. | ⬜ |
| — | **Only now** | **Merge the 1b PR** (the merge is the deploy). Wait for the Vercel production deploy to finish. | — | ⬜ |
| C7 | After deploy | Admin → Signup Invites: create a **champion** invite for **`<you+s1b>`**, **1 month**, 30 days, reason "QA slice 1b". Copy the link. | Link shown once; row **Pending**; no "stopped halfway" banner. | ⬜ |
| C8 | After deploy | **Private window** (signed out), open the link. | The valid page with the offer and the signup section, showing only the **masked** address (`y•••@gmail.com`) and "Send me a code". No full address anywhere on the page. | ⬜ |
| C9 | After deploy | Click "Send me a code". Click "Send a new code" again within a minute. | The email arrives at `<you+s1b>` **from the platform's system sender** (record the From name and address). The subject has no digits, and the code is in the body only. The second click says to wait about a minute. | ⬜ |
| C10 | After deploy | Enter a **wrong** 6-digit code with a password (8+ characters) and its confirmation. | "That code is not right. 4 tries left." No account is created. | ⬜ |
| C11 | After deploy | Enter the **right** code with the password. | You land on `/onboarding-chat`, **signed in** as `<you+s1b>`. (This also proves hosted auth kept the server-made account id, I-3.) If sign-in fails instead, the page says "Your account is ready. Sign in"; record it. | ⬜ |
| C12 | After deploy | Admin → Signup Invites (reload). Then Tiers page: look up the account id shown on the row. | Row **Accepted**, with the account id, the time and **L1**; no "stopped halfway" banner. Tiers: found, **Founding Partner / champion**, end date about 1 month from today. | ⬜ |
| C13 | After deploy | In the private window (now signed in), open the same link again; then sign out and open it once more. | Signed in: "you're signed in" notice, no form. Signed out: **"already used, sign in"**. | ⬜ |
| C14 | After deploy | Read-only SQL (paste the invite id and the account id from C12): `SELECT invite_row.claimed_account_id, invite_row.redeemed_account_id, invite_row.redeemed_at, invite_row.signup_code_hash, invite_row.redemption_failed_at FROM public.business_os_invites AS invite_row WHERE invite_row.id = '<invite id>';` then `SELECT plan_row.cohort, plan_row.cohort_expires_at, plan_row.origin, plan_row.tier FROM public.business_os_account_plans AS plan_row WHERE plan_row.user_id = '<account id>';` then `SELECT lineage_row.invite_id, lineage_row.source, lineage_row.parent_account_id, lineage_row.root_account_id, lineage_row.level FROM public.business_os_account_lineage AS lineage_row WHERE lineage_row.account_id = '<account id>';` | Invite: `claimed_account_id = redeemed_account_id` = the account id; `redeemed_at` set; `signup_code_hash` NULL; `redemption_failed_at` NULL. Plan: `champion`, about now + 1 month, **`invite`**, `tier` NULL. Lineage: the invite id, `admin_invite`, parent NULL, root = the account id, **level 1**. | ⬜ |
| C15 | After deploy | Read-only SQL: `SELECT audit_row.action, audit_row.user_email, audit_row.details FROM public.audit_trail AS audit_row WHERE audit_row.entity_id = '<invite id>' ORDER BY audit_row.created_at;` | `BOS_INVITE_REDEEMED` and `BOS_INVITE_PLAN_PROVISIONED`, with `details` holding a correlation id, level 1 / `admin_invite` and the grant, and **no email, token or code**. `user_email` **will** show `<you+s1b>` on those two rows: that is the platform's audit trigger (QA-1b-3), not a leak from this slice. | ⬜ |
| C16 | After deploy | Vercel → production function logs, last hour: search for `<you+s1b>`, then for its local part (`yourname+s1b`), then for the 6-digit codes you received. | **No hits** on any line. You should find "Email sent" with **`to: ["y•••@gmail.com"]`** (masked), and "Signup code sent" / "Invite redeemed" with ids only. (Supabase Auth logs and the Resend dashboard do show the address; they are outside our logs. The `USER_LOGIN` audit row carries it by platform design, QA-1b-3.) | ⬜ |
| C17 | After deploy | Clean-up: revoke any other pending test invites. | The test account stays (it cannot be deleted); its 1-month access lapses on its own. | ⬜ |

#### Final Status

**Verdict: PASS WITH NOTES.**

- [x] MF-1 and MF-2 verified, with mutants proving the tests guard them.
- [x] All 1b acceptance criteria pass in tests: FR-11 to FR-13, FR-12a/T-16, AC-4, AC-5, AC-5a (on the record, the log lines and the admin view; see QA-1b-3 for the audit column), AC-6, AC-7, AC-8, AC-9, I-1 to I-6, D-1 to D-7, D-dev-1/2/3/9 to 15, R-6, R-13, N-1, N-2.
- [x] No High or Medium issue. Two pre-existing failures, both outside this slice.
- [ ] Recommended before commit (cheap): QA-1b-1 and QA-1b-2 (one assertion each). Optional: QA-1b-7 and QA-1b-8. Record QA-1b-4 in §15.2. QA-1b-3 needs the user's acceptance (recommended: accept). QA-1b-5 and QA-1b-6 are notes.
- [ ] Before merge: C1 to C6 (MF-3 rebase included). After merge: C7 to C17.

---

## Commit Info

**Merge-order note for RM (SA CR-1), Slice 1a:** migration `20261013_business_os_invite_existing_account.sql` must be **applied to production and `scripts/check-bos-invite-existing-account-migration.sql` must read `VERDICT PASS` BEFORE the 1a PR is merged.** Merging to `main` deploys on Vercel; without the migration the admin Signup Invites page (list, create, revoke) and every valid invite link break. Also rebase onto `origin/main` first (PR #129 fixes the two pre-existing test failures). The same rule applies to `20261014` and the 1b PR.

**Rebase note for RM (SA MF-3), Slice 1b:** do NOT rebase before commit time; RM rebases `feature/bos-invite-signup-slice-1b` onto `origin/main` then, as for 1a. Two conflicts are expected, both resolved by **keeping both sides**:
1. `app/admin/business-os-invites/page.tsx`: PR #136 added a `key` on `<CreatedLinkPanel …>`; this slice added the T-16 banner above it. Keep the `key` and the banner.
2. `docs/architecture/BUSINESS_OS_ENTITLEMENTS.md`: both sides appended a Change History row at the same place. Keep both rows.

Apply `20261014` and get `scripts/check-bos-invite-signup-migration.sql` to `VERDICT PASS` before the 1b PR merges (the CR-1 rule; the merge is the deploy).

**User decisions at commit time (Slice 1b, 2026-09-29):** the user reviewed and approved the 1b diff, and **accepted QA-1b-3**: audit rows attributed to the new account carry its email in `audit_trail.user_email` (the platform audit trigger). Accepted as platform attribution; no code change.

*[RM will populate the rest of this section]*

---

## Change History

| Date | Change | Details |
|------|--------|---------|
| 2026-09-28 | Created | Slice 1 workplan: 68 files (24 new, 44 modified), one migration `20261013_business_os_invite_signup.sql` (invite signup-code, existing-account and erasure columns; `business_os_account_lineage`; `business_os_redeem_invite` INVOKER and `business_os_auth_email_has_account` DEFINER, both `service_role`-only), a read-only checker, a pre-check runbook, traceability for L-1 to L-12 and the Slice 1 T-decisions, rate-limit options (recommend per-invite counters plus a Vercel Firewall rule), the erasure design, a production QA script, rollback, and sixteen findings for SA. Recommends splitting into 1a (existing-account path and admin list) and 1b (the signup). Verified against `origin/main` fd710c26. |
| 2026-09-28 | SA workplan review: Revision Required (scoped) | F-1 replaced by claim-before-create with a server-generated account id passed to `createUser({ id })` and an idempotent finalise function: no `deleteUser`, no deletion-guard exception, no ban (R-1). F-2 to F-16 ruled (F-7 drops the profile ensure; F-10 is a correct technical reading). Rate limiting: per-invite counters only; the Vercel Firewall rule is hardening, not a gate; the DB per-IP table rejected. Split re-cut into 1a (existing-account path, own migration `20261013`), 1b (signup, own migration `20261014`) and a new 1c (list filters); erasure build deferred to an open item dated 2027-09-28. R-1 to R-14. No user decision needed. |
| 2026-09-28 | R-1 to R-14 applied; OI-1 recorded; 1a implemented (uncommitted) | Workplan re-cut into 1a / 1b / 1c with migrations `20261013` (1a: one column + the SECURITY DEFINER lookup) and `20261014` (1b: code, claim, lineage, finalise); claim-before-create with invariants I-1 to I-6 and three refinements for SA (D-dev-1 to D-dev-3); erasure build, profile ensure and the deletion-guard entry removed; L-12 open item dated 2027-09-28 recorded in the requirement; F-items marked with rulings; traceability updated; rate limiting per SA (per-invite only; the Firewall rule is OI-1, verified by QA B16, not a gate). 1a implemented: 8 files created, 23 modified, including the user-requested label change "Invites" → "Signup Invites". 1b awaits SA one-pass re-check of §2.4 and §4.2. |
| 2026-09-28 | SA code review 1a + 1b design re-check | 1a: Code Approved for QA, conditional on CR-1 (apply `20261013` before merging; the merge is the deploy) and CR-2 (callers guard also scans the SQL function name); nits N-1 to N-3; D-dev-4 to D-dev-7 accepted. SA reran Jest (3,102/3,104; the 2 failures pre-exist on fd710c26 and are fixed on main by #129), `test:authz-guard` (119/119) and `next build` with the full CI env (exit 0). 1b: clear to implement with D-1 to D-7 (live-claim 409 on complete, FR-12a diagnostic columns on the invite row, data-derived "stopped halfway" condition, one lease constant, runbook fixes, I-6 described as race-only, FR-12a last); D-dev-1 approved, D-dev-2 and D-dev-3 approved with conditions. T-16 decided: admin-page indicator now, no email. |
| 2026-09-28 | SA code review of 1a and 1b design re-check applied | CR-1: `20261013` must be applied with checker PASS before the 1a PR merges (§6.1 step 5, Commit Info). CR-2: the callers guard also scans for the SQL function name, including `.sql` files under `supabase/`. N-2 noted in §6.2; N-3 (second pre-existing failure, fixed on main by PR #129) recorded; N-1 added to task 1b-8. SA D-1 to D-7, the D-dev-1/2/3 rulings and T-16 (admin-page indicator, no email) folded into §2.4, §4.2, §5.2, §6.2, §8, §12.2 and §13.2. 1b code not started. |
| 2026-09-28 | QA 1a notes fixed (uncommitted) | QA-1 (checker E06/E07 pinned), QA-2 (guard scans root files incl. `middleware.ts`), QA-3 (no Sign in while the session check is pending), QA-5 ("Business OS Signup Invites" in the page header comment and the audit filter label), QA-6 (Hebrew email isolated LTR). QA-4 note only. Recorded as D-dev-8. |
| 2026-09-28 | Slice 1b implemented (uncommitted) | On `feature/bos-invite-signup-slice-1b` from `origin/main` aa9d75e9: migration `20261014` (code, claim and FR-12a columns; lineage; the INVOKER finalise function) with checker, rollback and text test; claim-before-create with I-1 to I-6, SA D-1 to D-7 and D-dev-1/2/3 as ruled; the code email from the system sender; the two signup routes; password sign-in in the browser; the tenant widening; the admin list account/L1; and the FR-12a banner and row badge (T-16). 23 files created, 42 modified. Tests green except two pre-existing failures (one fixed on main by PR #134); authz guard 119/119; eslint 0 errors; `next build` exit 0 with both signup routes in the route table. Deviations D-dev-9 to D-dev-14. Awaiting SA code review; the user applies `20261014` before the 1b PR merges. |
| 2026-09-28 | SA code review 1b | Code Approved for QA, conditional on MF-1 (the code email must not log the invitee address: opt-in recipient redaction in `sendEmail`), MF-2 (`issueSignupCode` CAS also compares `signup_code_last_sent_at`, and refuses a live claim or an expired link) and MF-3 (rebase onto `origin/main` 571f48cc; two keep-both conflicts). Migration `20261014`, rollback and checker approved to paste unchanged. D-dev-9 to D-dev-14 accepted (D-dev-14 with the file named in the banner). Pre-existing: `enforcementPoints` passes after the rebase; `routes.test.ts` "account on a tier" fails on clean `origin/main` |
| 2026-09-28 | SA code review 1b fixes applied (uncommitted) | MF-1 (opt-in recipient redaction in `sendEmail`, set by the signup code email), MF-2 (issue CAS also on last-sent time, unexpired, no live claim; rollover race test), MF-3 recorded as an RM rebase note with the two expected keep-both conflicts, N-1 to N-4 and the D-dev-14 banner path. No SQL changed. Recorded as D-dev-15. |
| 2026-09-29 | QA 1b notes addressed (uncommitted) | QA-1b-1 (S06 pinned), QA-1b-2 (banner runbook path asserted), QA-1b-4 (§15.2 re-apply back-fill), QA-1b-7 (256-character password cap). QA-1b-5/6/8 known; QA-1b-3 for the user. No SQL changed. Recorded as D-dev-16. |
| 2026-09-29 | User approval; QA-1b-3 accepted | The user reviewed and approved the 1b diff and accepted QA-1b-3 (the new account email in the audit `user_email` column is platform attribution, not a leak). Handed to RM for commit, rebase onto `origin/main` and PR. |
