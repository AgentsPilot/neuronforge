# Workplan: Business OS Invite-Only Signup, Slice 5b (A friend signs up at L2, then is held)

> **Last Updated**: 2026-10-01

**Developer:** Dev
**Requirement:** [BUSINESS_OS_INVITE_SIGNUP_REQUIREMENT.md](/docs/requirements/BUSINESS_OS_INVITE_SIGNUP_REQUIREMENT.md): §5 GR-4/GR-5, §6.2–6.4, §7.3 FR-11 to FR-13 and FR-12a, §7.6 FR-24, §7.9 FR-31 and FR-34 to FR-36, AC-18, AC-19, §16.3 T-9 and T-13, §17 (T-18, **T-19**, **F5b-1 to F5b-7**), BQ-13 to BQ-15
**Previous slices:** [Slice 1](/docs/workplans/BUSINESS_OS_INVITE_SIGNUP_SLICE_1_WORKPLAN.md) (1b claim → create → finalise, I-1 to I-6, D-1 to D-13), [Slice 3](/docs/workplans/BUSINESS_OS_INVITE_SIGNUP_SLICE_3_WORKPLAN.md) (3b Google, R-1 to R-12), [Slice 5a](/docs/workplans/BUSINESS_OS_INVITE_FRIENDS_SLICE_5A_WORKPLAN.md) (PR #154; carries **N-4** and the Q-3 "already used → 409" to this slice)
**Date:** 2026-09-30
**Branch:** `feature/bos-invite-friend-5b`, cut from `origin/main` at `de4b31f2` (the #160 merge) in the `neuronforge-invite-s0` worktree, fast-forwarded to `56feb9d2` (#161, which touches only the my-plan route) before implementation. Upstream tracking unset. Every file and line reference below was checked on this branch.
**Status:** SA workplan review ✅ approved with conditions (R-1 to R-11 folded in, 2026-10-01). **Two PRs (SA ruling):** **5b-1 Code Complete, uncommitted** (2026-10-01, §6.1): migration `20261024`, redemption for both methods, the existing-account redesign, the gate in four layouts, the holding screen, the landing. **5b-2 not started** (the champion's label, revoke 409, N-4, admin parent, the entitlements doc row). Waiting for SA code review of 5b-1, the user's look at the diff, then QA. **Merge 5b-1 only after `20261024` is applied and its checker is PASS (§4.1).** The switch `accountInvitesAvailable` stays **false**.

## Overview

A friend opens a champion's invite link and **creates an account for the invite's email only**, with the emailed code and a password (Slice 1b path) or with Google (Slice 3b path, switched on in production on 2026-09-30). One new SQL function (migration `20261024`) burns the invite, writes a lineage row at **L2** (or the champion's level + 1) under the champion, and writes a plan row with **no basis**, so no trial can ever be minted for them. The friend then lands on a **"payment coming soon"** screen and cannot reach onboarding or Business OS: a server-side gate in the onboarding and Business OS layouts, keyed on lineage, sends them back there. The champion's list shows the friend as "Signed up — not subscribed yet", and revoking that invite answers 409 "already used". Everything ships **inert** behind `accountInvitesAvailable: false`. Turning friend invites on stays a one-line config PR after 5b (§10).

---

## Table of Contents

1. [Analysis Summary](#1-analysis-summary)
2. [Implementation Approach](#2-implementation-approach)
3. [Files to Create / Modify](#3-files-to-create--modify)
4. [Migration `20261024`](#4-migration-20261024)
5. [Behaviour contracts](#5-behaviour-contracts)
6. [Task List](#6-task-list)
7. [Traceability](#7-traceability)
8. [Test plan](#8-test-plan)
9. [Production manual check](#9-production-manual-check)
10. [Switching friend invites on](#10-switching-friend-invites-on)
11. [Rollback](#11-rollback)
12. [Split proposal](#12-split-proposal)
13. [Questions for SA](#13-questions-for-sa)
14. [Logging-standard check (console.*)](#14-logging-standard-check-console)
15. [SA Review Notes](#sa-review-notes)
16. [QA Testing Report](#qa-testing-report)
17. [Commit Info](#commit-info)

---

## 1. Analysis Summary

| Area | As built on `de4b31f2` | 5b change |
|---|---|---|
| Redemption `inviteRedemption.ts:220-272` (`loadRedeemableInvite`) | Refuses every `grant_kind = 'tier'` row at `:242` (`paid_invites_not_available`), then allows only `issuer_kind = 'admin'` champion rows (`:243`). Runs `emailHasAccount` (`:255`) **before** any code is sent or any Google proof is checked. | A new, explicit **friend branch** keyed on `issuer_kind = 'account'`, placed before `:242`. The generic tier refusal **stays** for admin rows (F5b-2). The friend branch defers the existing-account check until after mailbox proof (F5b-3). |
| `finish()` `inviteRedemption.ts:565-608` | Always calls `deps.finalise` (the champion function) and audits `level: 1, source: 'admin_invite'`. | Branches on the loaded kind: friends call a new `finaliseFriend` and audit the level the function returns. `createAndFinish` (`:499`) is shared unchanged, so **both signup methods** get the friend path by construction. |
| Redemption columns `BusinessOsInviteRepository.ts:97-100` | No `issuer_account_id`. | Add `issuer_account_id` (needed for the issuer re-check). |
| Finalise SQL `20261014` | `business_os_finalise_invite_redemption` requires `issuer_kind = 'admin'`, `grant_kind = 'cohort'`; writes a champion plan row and an L1 lineage row. Does not filter `revoked_at` (AB-26). | **Untouched.** A second function in `20261024` (T-19). |
| Lineage table (20261014) | `level_shape` accepts L2 with root = parent; `admin_invite_parentless` constrains `admin_invite` only. No `first_paid_at` / `first_payment_ref`. `service_role`: `SELECT, INSERT` only. | Add the two nullable columns; **no UPDATE grant** (that is 5c, F5c-2). |
| Plan table (20261005) | No-basis rows pass every CHECK (SA, T-19). `business_os_plan_fact_onboarding` (on `onboarding_conversations`) and `business_os_plan_fact_profile` (on `business_profiles`) insert `cohort = 'trial'` **or**, on conflict, only fill a NULL fact. | Nothing changes. A no-basis row written at redemption makes both triggers fill a fact only (T-13 layer 1). |
| Public view `publicInviteView.ts:207-222` | An account-issued tier invite with the switch on gets `signup_opens_soon` (no form); switch off → `unavailable`. The existing-account check is skipped for account-issued rows (5a F5a-10). | With the switch on, an account-issued tier invite gets **`valid`** (form, Google button, masked email) and **still skips** the existing-account check. `signup_opens_soon` becomes unreachable and is removed (Q-8). |
| Landing `complete/route.ts:56`, `google/route.ts:66` | `LANDING = '/onboarding-chat'`. The clients (`SignupForm.tsx:161`, `GoogleSignupButton.tsx:106-115`) navigate to the server's `redirectTo`. | The routes send a held friend to `/invite/awaiting-payment`. **No client change.** |
| Middleware `middleware.ts:109-113` | `/invite` and `/invite/*` return early with `Referrer-Policy: no-referrer` and never reach the onboarding redirect (`:238-242`). | **Unchanged.** The holding screen lives at `/invite/awaiting-payment`, so it inherits that bypass (Q-4). |
| Layouts | `app/onboarding-chat/layout.tsx` (server, sync, 0 `console.*`); `app/business-os/layout.tsx` (server, async, reads `readPlanBadge`). | Each calls the payment-hold gate first and `redirect`s a held account (T-13 layer 2). |
| Champion list / revoke (5a) | Status `joined` ("Signed up"); revoke answers one 404 for not found, not yours and no longer revocable (`revoke/route.ts:95-96`). | Copy "Signed up — not subscribed yet" (F5b-7); a scoped second read turns "already used" into **409** (5a Q-3). |
| Friend-invite send route `route.ts:137-153` | Audits `BOS_FRIEND_INVITE_REFUSED` for every refusal except the switch-off `not_eligible`. | **N-4:** never audit `not_eligible` (§2.2 D-12). |
| Admin list | Lineage read `findByInviteIdsForAdmin` selects `account_id, invite_id, level`. | Also `parent_account_id`, shown as "L2 · parent …" (FR-36). |
| Launch dry run `app/api/admin/business-os/entitlements/launch/route.ts:116-133` | Counts any account without an in-force tier and not a champion as "would become champion". Execution returns 501. | Not changed. T-9 recorded as a switch-on precondition in the entitlements doc (F5b-6, D-14). |
| Migrations | Highest is `20261023`. `20261015` is used (credit charges), `20261020` is used; `20261016–19` and `20261021–22` are reserved. **`20261024` is free** (`ls supabase/migrations`, 2026-09-30). | `20261024_business_os_friend_invite_signup.sql`. |

**Not touched:** `EntitlementService` and the mode (the gate is mode-independent), the provider factory, any LLM call, the 20261014 function, `SignupForm.tsx`, `GoogleSignupButton.tsx`, `middleware.ts`, the entitlements catalog and tier matrix.

---

## 2. Implementation Approach

### 2.1 Module layout

```
lib/business-os/invites/inviteRedemption.ts   friend branch in loadRedeemableInvite; post-proof account check; finish() branches
lib/business-os/invites/redemptionDeps.ts     wires finaliseFriend, the issuer plan reader and the existing-account notice
lib/business-os/invites/paymentHold.ts        pure: isAwaitingPayment(facts), readPaymentHold(accountId, deps)
lib/business-os/invites/paymentHoldGate.ts    server-only: redirectIfAwaitingPayment() for the layouts; readHoldForSession() for the screen
app/invite/awaiting-payment/page.tsx          the holding screen (server component)
app/invite/awaiting-payment/SignOutButton.tsx the one client control
app/invite/awaitingPaymentCopy.ts             en/he/es copy (the invitePageCopy.ts precedent)
lib/email/templates/invite-existing-account.ts  "you already have an account, sign in" (F5b-3)
```

### 2.2 Key decisions

| # | Decision | Why |
|---|---|---|
| D-1 | **The friend branch is explicit** in `loadRedeemableInvite`, keyed on `row.issuer_kind === 'account'` (the 5a R-5 key), and runs **before** the generic tier refusal. For an account-issued row it checks, in order: `INVITE_ISSUANCE_POLICY.accountInvitesAvailable` → `grant_kind === 'tier'`, `invite_type === INVITE_ISSUANCE_POLICY.account.inviteType`, `grant_id === INVITE_ISSUANCE_POLICY.account.grantId`, `isInviteGrantAvailable` → the issuer's plan row via `findEntitlementInputs(row.issuer_account_id)` and 5a's `isInForceChampion`. Any "no" → 409 `unavailable` (T-18's "no longer available"); a read error → 503. It returns `{ ok: true, row, kind: 'friend' }` **without** the existing-account check. Admin rows are unchanged: tier → `paid_invites_not_available`, champion → the 1b path. | F5b-2: "a new explicit branch, not removing the tier refusal"; the TypeScript check first, the SQL re-check decides (T-19). `paidInvitesAvailable` is not consulted: in 5b a friend is held, not sent to checkout. 5c changes the landing when it is on. |
| D-2 | **The existing-account check moves after mailbox proof for friends** (F5b-3). Code route: no check before the code. Complete route: after the code matches, before the claim. Google route: after the proof and the address match, before the claim. The I-6 rule (`allowStaleClaimWithAccount`) keeps its meaning. The champion path keeps the 1b order byte for byte. | Only the mailbox owner can pass the code or the Google proof, so only they learn "you already have an account". The champion holds the link and learns nothing. |
| D-3 | **A decoy code on the code route.** For a friend invite the route always runs `decideCodeIssue`, generates a code and CAS-stores its hash (the same counters, the same 429s), then asks `emailHasAccount`. **No account:** the code email, as today. **Account:** the stored code is never sent; the address instead receives the "you already have an account — sign in" email; `markOpenedByExistingAccount` + `BOS_INVITE_OPENED_BY_EXISTING_ACCOUNT` (once). **The HTTP answer is identical** (`200 { codeExpiresAt, resendAvailableAt }`, or `503 code_not_sent` if the email failed). A read error is 503 in both cases. | If nothing were stored, a follow-up `complete` would answer `code_expired` for an existing account but `code_invalid` (+ attempts left) for a new one, which is a disclosure. With a stored decoy, both answer `code_invalid`. Guessing the unsent code is 5 tries at 10⁻⁶ each, and even then the post-proof check answers `existing_account` and creates nothing. **Q-3.** |
| D-4 | **The friend finalise is a new plan-repository method**, `provisionFromFriendInvite({ inviteId, accountId, email, tierId, issuerCohort })`, calling `business_os_finalise_friend_invite_redemption` (§4). It returns an outcome class: `finalised` / `already_finalised` (both carry the invite id and the level) → success; `issuer_not_eligible` → **no retry**, the claim is kept, and the FR-12a record is written with step `finalise` and error code `issuer_not_eligible`; `not_matched` or a DB error → today's retry once, then FR-12a. `tierId` = `INVITE_ISSUANCE_POLICY.account.grantId`, `issuerCohort` = `INVITE_ISSUANCE_POLICY.account.issuerCohort`, both from config (L-5). | T-19. A plan-state writer lives on the plan repository so the RC-15 imports guard sees it (1b D-11). Distinguishing the issuer refusal makes FR-12a diagnosable (BQ-11). **Q-1** covers the orphan account this leaves. |
| D-5 | **Audit, friend redemption:** `BOS_INVITE_REDEEMED` `{ inviteType, level: <returned>, source: 'account_invite', method }`; `BOS_INVITE_PLAN_PROVISIONED` `{ grantKind: 'tier', grantId, basis: 'none', awaitingPayment: true, origin: 'invite' }`. No new audit event. Never the email, token, hash, code or password. | FR-12, T-13. Reusing the events keeps `eventAudience.test.ts`'s pinned counts unchanged. |
| D-6 | **Landing.** `CompleteSignupOutcome` / `CompleteGoogleSignupOutcome` success gains `landing: 'onboarding' \| 'awaiting_payment'` (friend → `awaiting_payment`). The two routes map it to `/onboarding-chat` or `/invite/awaiting-payment`. | FR-13, FR-35, F5b-4 ("the hand-off lands on the holding screen"). The clients already follow `redirectTo`. |
| D-7 | **The payment hold (T-13 layer 2), keyed on lineage, never on `origin`:** held ⇔ a lineage row exists for the account **and** `first_paid_at IS NULL` **and** (`source = 'account_invite'` **or** the invite's `grant_kind = 'tier'`). `readPaymentHold` does one PK read on the lineage (most accounts have no row and stop there). **SA R-3:** an unpaid `account_invite` row is held on that read alone; the invite (`grant_kind, language`) is read only for an unpaid `admin_invite` row (5c's case), so no invite-read error can release a friend. The holding screen reads the invite's `language` separately. It never calls `EntitlementService`, `check()`, `getSnapshot()` or the mode reader. | F5b-4's predicate, written so it is already right for 5c's admin Paid invites (`admin_invite` + tier grant) without a change. Mode-independent, so `shadow` and `off` cannot open it (GR-5). |
| D-8 | **Where the gate lives: FOUR server layouts (SA R-1, R-2)**, `app/onboarding-chat/layout.tsx`, `app/onboarding-build/layout.tsx` (R-1: its page writes a completed profile, after which middleware lets the account in everywhere), `app/business-os/layout.tsx`, and a new `app/test-business-os/layout.tsx` (R-2: open to every signed-in account and skipped by middleware). The text below was written for the first two; it applies to all four. Each calls `await redirectIfAwaitingPayment()` as its first statement; the helper resolves the session (`getUser()` → `resolveAccountId`), reads the hold, and calls `redirect('/invite/awaiting-payment')` **outside** any `try/catch` (Next's redirect throws). **Not middleware:** it runs on every request including static and API paths, it already bypasses `/onboarding-chat`, and it reaches Supabase directly (the rule 1 exception it already is); adding lineage reads there would widen that. The layouts cover every **page** entry (corrected by SA R-1: "every entry" was not true of two layouts): middleware sends any account without a completed business profile (a held friend has none) to `/onboarding-chat`, whose layout holds them; `/onboarding-build` and `/test-business-os` are skipped by middleware and now hold them themselves; a held account that somehow has a profile reaches `/business-os/*`, whose layout holds them. The API routes are the accepted F5b-5 residual. | F5b-4 names two places; SA R-1/R-2 add two. No new middleware logic. |
| D-9 | **Fail mode: open, logged at `error`.** If the hold read fails, the layouts render normally. | A DB blip must not lock every customer out of Business OS. Layer 1 still stops a trial, and the gap equals F5b-5's accepted residual. **Q-2.** |
| D-10 | **The holding screen** `/invite/awaiting-payment` (server component). No session → a "sign in to continue" link to `marketingUrl('/login')`, and nothing else. Signed in and **not** held → `redirect('/onboarding-chat')`. **SA R-4:** when the screen's own hold read fails, it shows a neutral "something went wrong, try again" with Sign out and **never** redirects; the gate and the screen share `readPaymentHold`, so they cannot disagree on the predicate. Held → "Your account is ready. Payment for your plan is not open yet, so there is nothing to do here for now. Sign in again later to finish." (BA to confirm the wording), in the **invite's** language with RTL for Hebrew, and a Sign out button (`signOutUser({ method: 'awaiting-payment' })`). **No checkout, no plan name, no price, no promise of an email** (FR-24: no reminders). It imports nothing from the entitlements module. | FR-24/FR-35. The invite's language is the champion's explicit choice for this friend (C-8); `LanguageContext` is never a source. Under `/invite/*` it inherits the middleware bypass, `no-referrer` and `noindex`. |
| D-11 | **The friend's invite page** (switch on): `valid` with the signup form and Google button, exactly as a champion invite, plus one line shown when `offer.kind === 'payment_required'`: "You can create your account now. Payment opens soon, and you'll be able to use AgentPilot once you've paid." (en/he/es). The masked email is read with 1a's `findInviteeEmailForPublicCheck`; `emailHasAccount` is **never** called for an account-issued row. The issuer's cohort is **not** re-checked on the page (5a Q-6); the code and Google routes refuse before any email or account. | FR-8, FR-22 honesty, F5b-3. |
| D-12 | **N-4: no audit for `not_eligible`, from either side.** The send route logs it at `info` with the correlation id and writes no `BOS_FRIEND_INVITE_REFUSED` row. The other four refusals stay audited. | SA offered "skip the audit or rate-limit it". A per-account rate limit needs infrastructure the platform does not have (C-4: no in-memory limiter). `not_eligible` carries no information worth a permanent row: a non-champion is refused for being a non-champion. The SQL-side `not_eligible` is reachable only by an in-force champion losing the cohort mid-request, which is not worth distinguishing. |
| D-13 | **Champion list and revoke.** The status stays `joined` internally, with the copy "Signed up — not subscribed yet" (en/he/es), derived from `redeemed_at` only (F5b-7). Revoke keeps its one count-only UPDATE; on 0 rows a **scoped second read** (`findRedeemedForIssuerAccount(inviteId, accountId)`: `select('redeemed_at')`, `.eq('id')`, `.eq('issuer_kind','account')`, `.eq('issuer_account_id', accountId)`, `maybeSingle`) answers **409 `already_used`** when redeemed, and 404 otherwise. The revoke button is already shown for Pending rows only (`InviteFriendsSection.tsx:344`). | 5a Q-3 carry-over. A read, not a mutation: the `mutationOrSelect` guard is not touched, and `EXEMPT` stays one entry. Not found and not yours still share the 404. |
| D-14 | **T-9 as a recorded precondition**, not code: a new row in `BUSINESS_OS_ENTITLEMENTS.md` § "Before enforcement can be switched on": "**Held paid invitees** — the launch execution (Slice 2) must skip every account `isAwaitingPayment` holds, and its dry run must list them; today's dry run counts them in `wouldBecomeChampion`." | F5b-6 allows either. The execution does not exist (501), so a dry-run change now would label a count nothing acts on. |
| D-15 | **The admin list** adds `parent_account_id` to `findByInviteIdsForAdmin` and `parentAccountId` to `InviteListView` (the pinned `INVITE_LIST_VIEW_KEYS`), rendered as "L2 · parent <account id>". | FR-36. The parent is read from lineage, not inferred from the issuer. |

### 2.3 Redemption order for a friend invite

Unchanged from 1b/3b except where marked **5b**.

| Step | Code route | Complete route | Google route |
|---|---|---|---|
| 1 | `getUser()` → 409 `signed_in` | same | same |
| 2 | Format → lookup → state → live claim (409 `signup_in_progress`) | same | same |
| 3 | **5b friend branch (D-1)**: switch, grant shape, issuer in force | same | same |
| 4 | `decideCodeIssue` → CAS store the code hash | `decideCodeAttempt` → count → compare | verify proof → address match |
| 5 | **5b:** `emailHasAccount` → account: notice email; none: code email. **One answer** (D-3) | **5b:** `emailHasAccount` (unless a stale claim) → 409 `existing_account` | **5b:** `emailHasAccount` (unless a stale claim) → 409 `existing_account` |
| 6 | — | claim → `createAndFinish` → **`finaliseFriend`** | claim → `createAndFinish` → **`finaliseFriend`** |
| 7 | — | 200 `{ email, redirectTo: '/invite/awaiting-payment' }` | 200 `{ redirectTo: '/invite/awaiting-payment' }` |

I-1 to I-6 hold unchanged: the claim, the server-generated id, no deletion, release only after a positive "no such user", and FR-12a on a kept claim.

### 2.4 Tenant isolation (`tenant-isolation-guard`)

| Step | How 5b meets it |
|---|---|
| 1. Applies? | Yes: service role, a caller-supplied token, a caller-supplied `inviteId` on revoke, and triggers on the plan table. |
| 2. Ownership | Redemption: the token hash and the email lock, as 1b; the friend finalise keys on `(invite id, claimed account id, email)` plus `issuer_kind`, `grant_kind`, `grant_id`, `redeemed_at IS NULL`, `revoked_at IS NULL`. Revoke: ownership inside the UPDATE (5a), and the second read is scoped the same way. Hold read: the account id comes from `getUser()` → `resolveAccountId`, never from a request. |
| 3. Allow-list | The route bodies are unchanged (`.strict()`). The finalise parameters are all server-derived: the invite id and email from the row, the account id minted here (I-3), the tier and cohort from config. |
| 4. Scope-defeating three | The plan triggers fire on `onboarding_conversations` / `business_profiles`, not on the tables 5b writes. The finalise uses plain INSERTs, no upsert. No payload is forwarded. |
| 7. Tests | A friend finalise with a mismatched account, email, tier, issuer kind, revoked row or lapsed issuer changes nothing (PGlite). Revoking another account's redeemed invite gives 404, not 409 (the second read is scoped). The hold read for account A never reads account B's lineage. |

---

## 3. Files to Create / Modify

All paths verified at `de4b31f2`. **13 new, 35 modified** (18 of the 48 are tests), plus one doc.

| File | Action | Reason |
|---|---|---|
| `supabase/migrations/20261024_business_os_friend_invite_signup.sql` | create | §4 (F5b-1, T-19) |
| `scripts/check-bos-friend-invite-signup-migration.sql` | create | Read-only checker (next to the other `check-bos-invite*` files, 5a Q-4) |
| `supabase/SQL Scripts/20261024_business_os_friend_invite_signup_rollback.sql` | create | Rollback |
| `supabase/migrations/__tests__/business-os-friend-invite-signup.migration.test.ts` | create | Text test: C-2, `SECURITY INVOKER`, `search_path = ''`, the `revoked_at IS NULL` and `claimed_account_id = p_account_id` filters, plain INSERTs, no plan names, only the structural literals, the checker's lists match |
| `lib/business-os/invites/paymentHold.ts` | create | `isAwaitingPayment`, `readPaymentHold` (D-7) |
| `lib/business-os/invites/paymentHoldGate.ts` | create | `redirectIfAwaitingPayment`, `readHoldForSession` (server-only wiring, D-8) |
| `lib/business-os/invites/__tests__/paymentHold.test.ts` | create | Predicate table, read order, fail-open, account scoping |
| `app/invite/awaiting-payment/page.tsx` | create | The holding screen (D-10) |
| `app/invite/awaiting-payment/SignOutButton.tsx` | create | The one client control |
| `app/invite/awaitingPaymentCopy.ts` | create | en/he/es copy |
| `app/invite/__tests__/awaitingPayment.render.test.tsx` | create | Three states, RTL, no checkout/price/plan name |
| `lib/email/templates/invite-existing-account.ts` | create | The F5b-3 notice (en/he/es; `stripHtmlComments` via the wrapper; sign-in link only) |
| `lib/email/templates/__tests__/invite-existing-account.test.ts` | create | No token, code or invite link; three languages |
| `lib/business-os/invites/inviteRedemption.ts` | modify | D-1 to D-6 |
| `lib/business-os/invites/__tests__/inviteRedemption.test.ts` | modify | §8; **replaces** the 5a pin "account-issued invites refused on all three paths" with the switch-off / bad-shape / lapsed-issuer refusals, and keeps "admin tier → `paid_invites_not_available`" |
| `lib/business-os/invites/redemptionDeps.ts` | modify | Wire `finaliseFriend`, the issuer plan reader, `sendExistingAccountNotice` |
| `lib/business-os/invites/__tests__/redemptionDeps.test.ts` | modify | The new wiring |
| `lib/business-os/invites/publicInviteView.ts` | modify | Account-issued tier + switch on → `valid` (no existing-account check); remove `signup_opens_soon` (D-11, Q-8) |
| `lib/business-os/invites/__tests__/publicInviteView.test.ts` | modify | `emailHasAccount` never called for account rows; masked email present |
| `app/api/public/invites/validate/__tests__/route.test.ts` | modify | `signup_opens_soon` cases → `valid` |
| `lib/business-os/invites/friendInviteOps.ts` | modify | Revoke's scoped second read → 409 (D-13) |
| `lib/business-os/invites/__tests__/friendInviteOps.test.ts` | modify | 409 vs 404 |
| `app/api/public/invites/signup/complete/route.ts` | modify | Landing (D-6) |
| `app/api/public/invites/signup/google/route.ts` | modify | Landing (D-6) |
| `app/api/public/invites/signup/__tests__/routes.test.ts` | modify | Friend happy path per route, landing, identical code-route answers (D-3) |
| `app/api/business-os/friend-invites/route.ts` | modify | N-4 (D-12) |
| `app/api/business-os/friend-invites/__tests__/route.test.ts` | modify | No audit for `not_eligible` with the switch on |
| `app/api/business-os/friend-invites/[inviteId]/revoke/route.ts` | modify | 409 `already_used` |
| `app/api/business-os/friend-invites/__tests__/revoke.route.test.ts` | modify | 409 own redeemed; 404 another's redeemed |
| `lib/repositories/BusinessOsInviteRepository.ts` | modify | `issuer_account_id` in the redemption columns; `findHoldFactsById` (`grant_kind, language`); `findRedeemedForIssuerAccount`; header comment |
| `lib/repositories/BusinessOsAccountLineageRepository.ts` | modify | `findHoldFactsForAccount(accountId)` (`invite_id, source, first_paid_at`); `parent_account_id` in the admin read; header comment (the first account-scoped method) |
| `lib/repositories/BusinessOsAccountPlanRepository.ts` | modify | `provisionFromFriendInvite` (the RPC; the documented R2-3 exception, T-13) |
| `lib/repositories/types.ts` | modify | Friend finalise result, hold facts, `parent_account_id` |
| `lib/repositories/__tests__/BusinessOsInviteRepository.test.ts` | modify | One test per new method; M-1 leak suite |
| `lib/repositories/__tests__/BusinessOsAccountLineageRepository.test.ts` | modify | Same |
| `lib/repositories/__tests__/BusinessOsAccountPlanRepository.test.ts` | modify | `provisionFromFriendInvite`: argument map, outcome parsing, `safeDbError` |
| `lib/repositories/__tests__/businessOsEntitlements.imports.guard.test.ts` | modify | `provisionFromFriendInvite` into `WRITE_METHODS`; the redemption wiring may call exactly the two finalise writes |
| `lib/business-os/entitlements/__tests__/enforcementPoints.test.ts` | modify | Register `paymentHoldGate.ts` (`resolveAccountId`, Q-6). `inviteRedemption.ts`'s symbols are unchanged (`INVITE_ISSUANCE_POLICY.account` is already imported) |
| `app/onboarding-chat/layout.tsx` | modify | `await redirectIfAwaitingPayment()` (becomes async) |
| `app/business-os/layout.tsx` | modify | Same, before `readPlanBadge` |
| `app/onboarding-build/layout.tsx` | modify | **SA R-1:** `await redirectIfAwaitingPayment()` first (becomes async). 0 `console.*` |
| `app/test-business-os/layout.tsx` | create | **SA R-2:** a server layout that runs the gate first |
| `docs/BUSINESS_OS_TEST_PAGE_SCOPE.md` | modify | **SA R-2:** one note under Account Model, and a Change History row |
| `lib/email/__tests__/platformBranding.test.ts` | modify | Found at implementation: the pinned importers of the platform branding gain the notice template (the guard says "adding a platform email means adding it here") |
| `app/invite/page.tsx`, `app/invite/invitePageCopy.ts` | modify | Remove the `signup_opens_soon` branch; add the payment-later line (D-11) |
| `app/invite/__tests__/page.render.test.tsx` | modify | The line shows for `payment_required` only |
| `components/business-os/settings/inviteFriendsCopy.ts` | modify | "Signed up — not subscribed yet" (en/he/es) |
| `lib/business-os/invites/adminInviteOps.ts`, `app/admin/business-os-invites/types.ts`, `app/admin/business-os-invites/components/InviteList.tsx` | modify | `parentAccountId` (D-15) |
| `lib/business-os/invites/__tests__/adminInviteOps.test.ts` | modify | The pinned `INVITE_LIST_VIEW_KEYS` gains `parentAccountId` |
| `docs/architecture/BUSINESS_OS_ENTITLEMENTS.md` | modify | The T-9 row (D-14) and a Change History row |

**Not touched:** `middleware.ts`, `SignupForm.tsx`, `GoogleSignupButton.tsx`, `config/invites.ts` (the switch stays `false`), the 20261014 function, anything under `/api/admin/**` (the authz guard counts do not move), `lib/audit/events.ts`.

---

## 4. Migration `20261024`

**File:** `supabase/migrations/20261024_business_os_friend_invite_signup.sql`

The editor rules of Slices 0–5a apply: one `BEGIN`/`COMMIT`, no `--` or block comments, one statement per blank-line-separated block, full alias names, a dollar-quoted body. **No plan name and no policy number.** The only literals are structural values that already live in table CHECKs or in 20261014 (`'account'`, `'tier'`, `'account_invite'`, `'invite'`), the four outcome classes, the level rule's `2` and `+ 1` (§6.3; 20261014 writes `1` the same way), and the reference's length bounds `1` and `255` (a column shape, like 20261014's `64`/`300`, Q-7).

```sql
BEGIN;

ALTER TABLE public.business_os_account_lineage ADD COLUMN first_paid_at timestamptz;

ALTER TABLE public.business_os_account_lineage ADD COLUMN first_payment_ref text;

ALTER TABLE public.business_os_account_lineage ADD CONSTRAINT business_os_account_lineage_first_payment_paired CHECK ((first_paid_at IS NULL) = (first_payment_ref IS NULL));

ALTER TABLE public.business_os_account_lineage ADD CONSTRAINT business_os_account_lineage_first_payment_ref_length CHECK (first_payment_ref IS NULL OR char_length(first_payment_ref) BETWEEN 1 AND 255);

CREATE FUNCTION public.business_os_finalise_friend_invite_redemption(
  p_invite_id uuid, p_account_id uuid, p_email text, p_tier text, p_issuer_cohort text)
RETURNS TABLE (result_outcome text, result_invite_id uuid, result_level integer)
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  v_issuer uuid;
  v_parent_level integer;
  v_parent_root uuid;
  v_level integer;
  v_root uuid;
BEGIN
  SELECT invite_row.issuer_account_id INTO v_issuer
    FROM public.business_os_invites AS invite_row
   WHERE invite_row.id = p_invite_id
     AND invite_row.claimed_account_id = p_account_id
     AND invite_row.email = p_email
     AND invite_row.issuer_kind = 'account'
     AND invite_row.grant_kind = 'tier'
     AND invite_row.grant_id = p_tier
     AND invite_row.redeemed_at IS NULL
     AND invite_row.revoked_at IS NULL
   FOR UPDATE;

  IF v_issuer IS NULL THEN
    RETURN QUERY
      SELECT 'already_finalised'::text, lineage_row.invite_id, lineage_row.level
        FROM public.business_os_invites AS done_row
        JOIN public.business_os_account_lineage AS lineage_row
          ON lineage_row.account_id = done_row.redeemed_account_id AND lineage_row.invite_id = done_row.id
       WHERE done_row.id = p_invite_id AND done_row.redeemed_account_id = p_account_id;
    IF NOT FOUND THEN
      RETURN QUERY SELECT 'not_matched'::text, NULL::uuid, NULL::integer;
    END IF;
    RETURN;
  END IF;

  IF NOT EXISTS (
    SELECT plan_row.user_id FROM public.business_os_account_plans AS plan_row
     WHERE plan_row.user_id = v_issuer
       AND plan_row.cohort = p_issuer_cohort
       AND (plan_row.cohort_expires_at IS NULL OR plan_row.cohort_expires_at > now())
  ) THEN
    RETURN QUERY SELECT 'issuer_not_eligible'::text, NULL::uuid, NULL::integer;
    RETURN;
  END IF;

  SELECT parent_row.level, parent_row.root_account_id INTO v_parent_level, v_parent_root
    FROM public.business_os_account_lineage AS parent_row
   WHERE parent_row.account_id = v_issuer;

  IF v_parent_level IS NULL THEN
    v_level := 2;
    v_root := v_issuer;
  ELSE
    v_level := v_parent_level + 1;
    v_root := v_parent_root;
  END IF;

  UPDATE public.business_os_invites AS burn_row
     SET redeemed_at = now(), redeemed_account_id = p_account_id, updated_at = now()
   WHERE burn_row.id = p_invite_id;

  INSERT INTO public.business_os_account_plans (user_id, origin, period_anchor, updated_at)
  VALUES (p_account_id, 'invite', now(), now());

  INSERT INTO public.business_os_account_lineage (account_id, invite_id, source, parent_account_id, root_account_id, level)
  VALUES (p_account_id, p_invite_id, 'account_invite', v_issuer, v_root, v_level);

  RETURN QUERY SELECT 'finalised'::text, p_invite_id, v_level;
END;
$$;

REVOKE ALL ON FUNCTION public.business_os_finalise_friend_invite_redemption(uuid, uuid, text, text, text) FROM PUBLIC;

REVOKE ALL ON FUNCTION public.business_os_finalise_friend_invite_redemption(uuid, uuid, text, text, text) FROM anon;

REVOKE ALL ON FUNCTION public.business_os_finalise_friend_invite_redemption(uuid, uuid, text, text, text) FROM authenticated;

REVOKE ALL ON FUNCTION public.business_os_finalise_friend_invite_redemption(uuid, uuid, text, text, text) FROM service_role;

GRANT EXECUTE ON FUNCTION public.business_os_finalise_friend_invite_redemption(uuid, uuid, text, text, text) TO service_role;

COMMIT;
```

**As built (5b-1), two changes to the block above, both SA's:** `SET LOCAL lock_timeout = '5s';` right after `BEGIN;` (the 20261005 precedent), and **R-6**: the `already_finalised` query also filters `done_row.issuer_kind = 'account'` and `lineage_row.source = 'account_invite'`, so the friend function never reports success for a row it would not write. The file `supabase/migrations/20261024_business_os_friend_invite_signup.sql` is the source of truth; the text test pins both.

**Notes for SA:**

- **T-19, point by point:** `revoked_at IS NULL` and `claimed_account_id = p_account_id` explicitly (a revoked row now returns `not_matched` instead of tripping `not_revoked_and_redeemed`); `grant_id = p_tier` with the tier passed in from `INVITE_ISSUANCE_POLICY.account.grantId` (`TIER_ORDER[0]`); the issuer cohort passed in; level and root from the issuer's lineage row, else `2` and the issuer (§6.3, AB-29); **plain INSERTs**, so a conflict aborts the whole transaction including the burn; `SECURITY INVOKER`, `SET search_path = ''`, C-2 privileges; the 20261014 function untouched.
- **The row lock:** `SELECT … FOR UPDATE` locks the invite before the issuer check, and the UPDATE is keyed on the id alone because every guard was checked on the locked row. `service_role` holds `UPDATE` on the invites (20261012), which `FOR UPDATE` needs.
- **Idempotent (I-5):** a second call for the same account finds no pending row, and returns `already_finalised` with the stored level. Under READ COMMITTED, a concurrent finaliser's commit is visible to that second statement.
- **T-13 layer 1:** the plan row has `cohort` and `tier` NULL, `origin = 'invite'`. `business_os_plan_fact_onboarding` and `…_profile` then hit `ON CONFLICT` and can only fill `onboarding_started_at` / `profile_created_at`. The R2-3 no-basis rule applies to admin operations; this exception is documented in the repository method, as T-13 requires.
- **CHECKs by construction:** lineage `level_shape` (parent set, parent ≠ account because the account is new, level ≥ 2), `invite_matches_source`, `source_known`, `invite_key` UNIQUE; invite `redeemed_by_claimant`, `not_revoked_and_redeemed`; plan `tier_versioned` (no tier). The new `first_payment_paired` holds for every existing row (both NULL).
- **Privileges:** `service_role` already holds what the body needs: `SELECT, UPDATE` on the invites, `SELECT, INSERT` on the plans (20261009) and the lineage (20261014). **No table grant changes**: in particular no `UPDATE` on the lineage until 5c (F5c-2).
- **Safe before the code deploys:** nothing calls the function; two nullable columns and two CHECKs that every existing row satisfies. `ALTER TABLE … ADD CONSTRAINT` scans the lineage table under a brief lock; it is small.

### 4.1 Pre-check, apply, verify (the user, SQL editor)

| Step | What | Expected | If not |
|---|---|---|---|
| 1 | `SELECT (SELECT count(*) FROM pg_proc JOIN pg_namespace ON pg_namespace.oid = pg_proc.pronamespace WHERE pg_namespace.nspname = 'public' AND pg_proc.proname = 'business_os_finalise_friend_invite_redemption') AS friend_finalise, (SELECT count(*) FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'business_os_account_lineage' AND column_name IN ('first_paid_at', 'first_payment_ref')) AS payment_columns;` | `0`, `0` | `1`, `2`: already applied, go to step 3. Anything else: stop and send it to Dev. |
| 2 | Paste the whole migration | "Success. No rows returned." | One transaction, nothing half-applied. Send the error text to Dev. |
| 3 | Paste `scripts/check-bos-friend-invite-signup-migration.sql` | `VERDICT PASS`, **15 pass 0 fail** (L01–L13 with L04a/b, L08a/b) | Rollback (§11), do not merge. |
| 4 | Paste the 5a checker `scripts/check-bos-friend-invites-migration.sql` and the Slice 0 checker `scripts/check-bos-invites-migration.sql` | Both `VERDICT PASS` | Stop: an end state changed unexpectedly. (Do not use the 1a/1b checkers as gates, per 5a QA5a-2: they count CHECKs point-in-time, and the 1b one also counts lineage CHECKs, which this migration raises from 4 to 6.) |
| 5 | Merge the PR | §9 Part A | — |

### 4.2 Checker rows

Same shape as 5a's: `SET default_transaction_read_only = on`, one final `SELECT` with a `VERDICT`, explicit `IN (…)` lists, `aclexplode(COALESCE(proacl, acldefault('f', proowner)))`.

| Row | Check | Expected |
|---|---|---|
| L01 | The function exists with the 5-argument signature | 1 |
| L02 | `prosecdef = false` | true |
| L03 | `proconfig` contains `search_path=""` | true |
| L04a/b | `EXECUTE` held by `service_role`; none for `PUBLIC`, `anon`, `authenticated` | exact |
| L05 | `prosrc` contains `revoked_at IS NULL`, `claimed_account_id = p_account_id` and `FOR UPDATE` (catches a stale or hand-edited body, 5a F09's lesson) | true |
| L06 | Lineage columns `first_paid_at timestamptz` and `first_payment_ref text`, both nullable | 2 |
| L07 | Lineage CHECKs `…_first_payment_paired` and `…_first_payment_ref_length` exist | 2 |
| L08a/b | Lineage table: no privilege for `PUBLIC`/`anon`/`authenticated`; `service_role` exactly `SELECT, INSERT` (**no UPDATE**) | exact |
| L09 | No column-level ACL on the lineage table | 0 |
| L10 | Lineage: RLS on, 0 policies, 0 triggers | on / 0 / 0 |
| L11 | The 20261014 function `business_os_finalise_invite_redemption(uuid, uuid, text, text)` still exists | 1 |
| L12 | **SA R-7:** `prosrc` contains no `ON CONFLICT` (plain INSERTs) | true |
| L13 | **SA R-7:** `pg_get_function_result` is `TABLE(result_outcome text, result_invite_id uuid, result_level integer)` | true |

---

## 5. Behaviour contracts

**Public signup routes** (bodies unchanged, `.strict()`):

| Route | 5b change |
|---|---|
| `POST /api/public/invites/signup/code` | A friend invite answers exactly as today whether or not the address has an account (D-3). New refusal for a friend invite: 409 `unavailable` (switch off, wrong shape, lapsed issuer). |
| `POST /api/public/invites/signup/complete` | Friend success: `200 { email, redirectTo: '/invite/awaiting-payment' }`. 409 `existing_account` only after the code matched. |
| `POST /api/public/invites/signup/google` | Friend success: `200 { redirectTo: '/invite/awaiting-payment' }`. 409 `existing_account` only after the proof and the address match. |
| `POST /api/public/invites/validate` | An account-issued tier invite with the switch on: `valid` (with `maskedEmail`); off: `unavailable`. `signup_opens_soon` is no longer produced. |

**Customer routes (5a):**

| Route | 5b change |
|---|---|
| `POST /api/business-os/friend-invites` | `not_eligible` → 403, **not audited** (N-4). |
| `POST /api/business-os/friend-invites/[inviteId]/revoke` | 0 rows and own invite redeemed → **409 `{ error: 'already_used' }`**; otherwise 404 as before. |
| `GET /api/business-os/friend-invites` | A redeemed row's `status` is still `joined`; the section labels it "Signed up — not subscribed yet". It keeps its slot (unchanged predicate). |

**Pages:** `/invite/awaiting-payment` (D-10). `/onboarding-chat` and `/business-os/*` redirect a held account there (D-8).

---

## 6. Task List

**Split (SA ruling):** **5b-1** = T-0 to T-7, T-10, T-12, T-13 (✅ below). **5b-2** = T-8, T-9, T-11, plus the R-8 doc row (⬜, not started). The switch stays off until both are merged.

- ✅ **T-0** Confirm the branch (`git branch --show-current` = `feature/bos-invite-friend-5b`). Run `npm run schema:check` (skill `business-os-schema-check`) and record the ref; confirm on the live DB, read-only, that `business_os_invites.issuer_account_id`, `business_os_account_lineage.parent_account_id` / `source` / `level` / `root_account_id`, and the `onboarding_conversations` columns used by the AC-18 probe (`user_id`, `message_sequence`, `role`, `content`) exist. Re-run `ls supabase/migrations` and confirm `20261024` is still free.
- ✅ **T-1** Migration, checker, rollback and text test (§4). Run the migration in PGlite over `20261005`, `20261009`, `20261012`, `20261013`, `20261014`, `20261020`, `20261023` (5a's QA pattern): checker PASS; every outcome class; L2 with no issuer lineage (root = issuer); L3 under an L2 issuer (root = the issuer's root); revoked → `not_matched`; lapsed issuer → `issuer_not_eligible` with nothing written; second call → `already_finalised`; a trigger-style `INSERT … ON CONFLICT` into the plan row after finalise leaves `cohort` NULL; `anon` / `authenticated` denied; rollback returns the pre-check to `0, 0`.
- ✅ **T-2** Repositories: `provisionFromFriendInvite` (plan), `findHoldFactsForAccount` and `parent_account_id` (lineage), `issuer_account_id` in the redemption columns, `findHoldFactsById`, `findRedeemedForIssuerAccount` (invites); types; headers; one unit test per method with the M-1 leak suite (R-6 style: `safeDbError`, `toError`, `details` never logged).
- ✅ **T-3** `inviteRedemption.ts`: the friend branch (D-1), the post-proof account check (D-2), the decoy code and notice (D-3), `finish()` branching and audit (D-4, D-5), `landing` (D-6). The champion path's tests stay green unmodified.
- ✅ **T-4** The notice email template and its test; `redemptionDeps.ts` wiring (`finaliseFriend`, the issuer plan reader, `sendExistingAccountNotice` on the system sender, `kind: 'transactional'`, `redactRecipientInLogs: true`).
- ✅ **T-5** Routes: landing in `complete` and `google`; the routes test (friend happy path per method, the identical code-route answers, landing).
- ✅ **T-6** `publicInviteView.ts` (`valid` for friend invites; remove `signup_opens_soon`), the invite page line and copy, their tests.
- ✅ **T-7** `paymentHold.ts` + `paymentHoldGate.ts` and tests (D-7 to D-9, R-3); the **four** layouts (R-1, R-2); the holding screen with its R-4 error state, its copy, sign-out button and render test; the `BUSINESS_OS_TEST_PAGE_SCOPE.md` note.
- ⬜ **T-8** *(5b-2)* Champion side: the copy change, the revoke second read and 409, N-4 in the send route, their tests (D-12, D-13).
- ⬜ **T-9** *(5b-2)* Admin list `parentAccountId` (D-15) and its tests.
- ✅ **T-10** Registrations: `enforcementPoints.test.ts` (`paymentHoldGate.ts`), the RC-15 imports guard (`provisionFromFriendInvite`). Run `npm run test:bos-entitlements` on the final diff and record the result here.
- ⬜ **T-11** *(5b-2)* `BUSINESS_OS_ENTITLEMENTS.md`: the T-9 switch-on row (D-14), **widened by SA R-8** to (a) T-9, (b) the shadow report labels held accounts "awaiting payment" (Q-5), (c) if Slice 4 resumes before S-5, first close the F5b-5 API residual and the Q-1 / FR-12a friend-orphan trial path; and Change History.
- ✅ **T-12** Guards and full check: `npx tsc --noEmit` (filtered to touched files), `npm run lint`, `npm run lint:hooks`, `mutationOrSelect.guard` (EXEMPT unchanged), `tierLiteral.forbidden` (no baseline change), `npm run test:authz-guard`, the touched suites, a full `npx jest --ci` compared with a clean `origin/main` baseline, `npx next build` with the CI env. **Live read-only probes** (production PostgREST, the 5a pattern, a throwaway script deleted afterwards): the redemption select with `issuer_account_id`, `findHoldFactsForAccount` and `findHoldFactsById` with a zero uuid, the admin lineage select with `parent_account_id` (after `20261024` for the hold read), `findRedeemedForIssuerAccount` with a zero uuid. `git diff --stat` before hand-over: no deletion without insertion.
- ✅ **T-13** Hand over **uncommitted** for SA code review, the user's diff view, then QA.

### 6.1 Implementation record, 5b-1 (Dev, 2026-10-01)

Built on `feature/bos-invite-friend-5b` at `56feb9d2`, **uncommitted**. `20261024` is still free on `origin/main` (`git ls-tree origin/main supabase/migrations`, 2026-10-01). **Files: 14 new, 27 modified** (plus this workplan and the Slice 3 workplan update, which rides in this PR per TL). `git diff --stat`: 28 files, +1,132 / −163. Every deletion is a replaced line or the removed `signup_opens_soon` state (Q-8) and its 5a tests; the only two files that shrink on net, `app/invite/page.tsx` (+15/−26) and `publicInviteView.ts` (+22/−28), shrink for exactly that reason.

**R-items, as built:**

| # | Where |
|---|---|
| R-1 | `app/onboarding-build/layout.tsx` awaits the gate first; pinned by the source test in `paymentHold.test.ts` (first statement of the default export, all four layouts) |
| R-2 | New `app/test-business-os/layout.tsx`; the same pin; one note + Change History row in `docs/BUSINESS_OS_TEST_PAGE_SCOPE.md` |
| R-3 | `readPaymentHold`: an unpaid `account_invite` row returns held before any invite read. Test: the invite reader set to fail, still held, invite never read |
| R-4 | `readHoldForSession` returns `error` (never `not_held`) on an unreadable hold; the page renders "something went wrong" + Try again + Sign out, no redirect. Render test |
| R-5 | `invite-existing-account.ts`: system sender (no `from`/`replyTo`/`ownerUserId`, `redactRecipientInLogs`), only a sign-in link, the ignore line, nothing from the champion. Template test + wiring test (no `replyTo`) |
| R-6 | `already_finalised` filters `issuer_kind = 'account'` and `source = 'account_invite'`; text test + PGlite (the friend function on an admin row → `not_matched`) |
| R-7 | Checker rows L12 (no `ON CONFLICT`) and L13 (the result signature) |
| R-8 | 5b-2 (T-11), and one line in §10 now |
| R-9 | §9 T-0 note: list the `onboarding_conversations` triggers before B-9 |
| R-10 | §10 awareness bullet |
| R-11 | §11 paragraph "A stopped friend signup" |
| Q-6 | `paymentHoldGate.ts` in `KNOWN_NON_GATE_IMPORTERS` with SA's `why` |
| Q-8 | `signup_opens_soon` removed (view, page, copy, tests); the copy key became `paymentOpensLater` |
| Optional | `SET LOCAL lock_timeout = '5s'` taken. The D-3 existing-account branch runs the stamp and its audit alongside the notice send (`Promise.all`). React `cache()` for the session read: **not taken** (it would change `readPlanBadge`, outside this slice) |

**Deviations (for SA):**
1. **`issuer_account_id` added to `BusinessOsInviteRedemptionView`** (and the redemption columns) — needed by D-1's issuer read; planned in §3 but worth naming: the redemption row now carries the champion's account id server-side. It is never returned to the browser or logged.
2. **The landing map lives in `redemptionDeps.ts`** (`REDEMPTION_LANDING_PATHS`), shared by both routes, because Next.js route files may export only handlers and config. `AWAITING_PAYMENT_PATH` lives in `paymentHold.ts`.
3. **`finishFriend` does not retry `issuer_not_eligible`** (Q-1: a retry cannot change it) and records it as FR-12a step `finalise`, error code `issuer_not_eligible`. `not_matched` and DB errors keep the once-retry (I-5).
4. **An unknown or malformed RPC answer is an error**, never a success (`provisionFromFriendInvite`).
5. **The notice goes to the address even when `issueSignupCode` counted the send** — both branches consume the same code budget, so the 429s are identical (D-3's point).
6. **The holding screen reads the invite language itself** (`findHoldFactsById`), so the gate path stays one read for friends (R-3). A failed language read falls back to English and stays held.
7. **`platformBranding.test.ts`** gains the notice template in its pinned importer list (the full Jest run caught it).
8. **`/invite/awaiting-payment` sets its own `metadata`** (`noindex`, `no-referrer`, title "AgentPilot" rather than the segment's "Your invitation").

**Checks run (2026-10-01):**

| Check | Result |
|---|---|
| Touched suites (invites, public invite routes, invite page, repositories, guards, email templates, migrations, friend-invite routes, admin invites, settings) | ✅ 51 suites, 1,523 tests |
| New/changed: `inviteRedemption` (106, of which 5b friend: 34), `paymentHold` (32), holding screen (8), migration text (21), notice template (7), public view + validate (58), signup routes (82) | ✅ |
| `npm run test:bos-entitlements` | ✅ 98 suites, 2,058 tests |
| `npm run test:authz-guard` | ✅ 119; counts unchanged (no `/api/admin/**` file touched) |
| `mutationOrSelect.guard` | ✅ `EXEMPT` unchanged; 5b-1 adds no PostgREST mutation (two SELECT methods and one RPC) |
| `tierLiteral.forbidden` | ✅ no baseline change (the tier and cohort come from `INVITE_ISSUANCE_POLICY.account`) |
| `npm run lint:hooks` | ✅ clean |
| `npx eslint` on the 36 touched `.ts`/`.tsx` | ✅ 0 errors; 4 warnings, all on lines this slice did not change |
| `tsc` (a touched-files project; the whole-repo run exhausts memory) | ✅ nothing new in touched files. The 32 errors it reports are in files reached through imports and not changed here (`LanguageContext.tsx` 24, `ConfigurationDialog.tsx` 3, `SchedulingBookingModal.tsx` 3, `StripeConnectStatus.tsx`, `JourneyGapNotice.tsx`) |
| Full `npx jest --ci` | Failing suites identical to the 5a baseline list (27; `diff` empty) after the `platformBranding` fix. None in this slice's area |
| `npx next build` (the CI placeholder env from `build.yml`) | ✅ exit 0; `/invite/awaiting-payment` is `ƒ` (dynamic) |
| **PGlite** (`20261012`, `13`, `14`, `20`, `23`, `24` over a plan table with the 20261005 CHECKs and the real onboarding trigger function) | ✅ **37/37.** Pre-check 0,0 → 1,2. **5b checker 15/15 PASS**, 5a checker PASS, Slice 0 checker PASS. L2 under a no-lineage champion (root = parent = champion); L2 under an L1 champion; **L3 under an L2 champion (root = the L2's root)**; no-basis plan row, `origin = invite`; invite burned; second call `already_finalised`; lapsed issuer and wrong cohort → `issuer_not_eligible`, nothing written; wrong tier / email / account → `not_matched`; **revoked → `not_matched`, no raise**; champion finalise still works and the friend function on that admin row → `not_matched` (R-6); **AC-18: an onboarding message after finalise fills `onboarding_started_at` and leaves `cohort`/`tier` NULL**; an existing plan row aborts the finalise (plain INSERT) and leaves the invite unburned; half a milestone refused by the paired CHECK; `service_role` cannot UPDATE lineage; `anon`/`authenticated` denied EXECUTE; rollback → pre-check 0,0, 5b checker FAIL, Slice 0 checker PASS; re-apply works; a second paste fails and changes nothing |
| **Live no-match** (production PostgREST, 2026-10-01, zero uuid, no real row; the script ran from the worktree and is deleted) | The friend finalise RPC → `PGRST202` (function not in the schema cache: **`20261024` is not applied yet**, so nothing can write). The redemption select with `issuer_account_id` → `{ data: null, error: null }`. `findHoldFactsById` → `{ data: null, error: null }`. `findHoldFactsForAccount` → **`42703 first_paid_at does not exist`** (expected before the migration). Zero plan and lineage rows at the zero id afterwards |

**QA fixes (2026-10-01, after QA passed 5b-1 with notes):**

| # | Fix |
|---|---|
| QA-1 (Medium) | The friend code route's existing-account branch now answers **exactly like a new address's success** (same status, body and counters) whether or not the notice was sent; a failed notice is logged at `warn` by invite id only, never the address. Before, a failed notice gave 503 `code_not_sent` against 200 for a new address, which told the champion the address had an account. A new address whose OWN code email fails still gets 503 `code_not_sent` (that is genuinely about that address). `invite-existing-account.ts` `safeHref` validates once and never throws: an unusable sign-in URL renders the notice without a link. Tests: the flow (a failed notice equals a new address's success; no address in the logs), the template (four malformed URLs, no link, no markup), the wiring (a malformed URL still sends; a throwing transport is `{ sent: false }`), and a new route-level test `app/api/public/invites/signup/__tests__/code.friend.route.test.ts` through the real flow and the real wiring: with a malformed `NEXT_PUBLIC_MARKETING_URL`, an existing account and a new address get **byte-identical** 200 responses. That test fakes the auth and plan repositories, so it is registered in the `AuthAccountRepository` callers guard and the RC-15 `ALLOWED` list (test files only, no application change) |
| QA-3 | `publicInviteView.ts` header comment: the friend `valid` view no longer says "payment required"; the page adds one "payment opens soon" statement (SA CR-1) |

Re-run after the QA fixes: touched suites and repository guards 108 suites, 2,244/2,244; `npm run test:bos-entitlements` 2,058/2,058; `npm run test:authz-guard` 119/119; eslint 0 errors (4 old warnings). Migration SQL unchanged.

**What the live check means for the merge order:** until `20261024` is applied, the lineage hold read fails with 42703 on every gated layout render. The gate then fails **open** (Q-2), logged at `error`, so nobody is locked out, but the logs would be noisy and the holding screen would show its error state. So the order is the usual one, and it is required: **apply `20261024` → checker PASS → re-run this probe (expect the RPC to answer `not_matched` and the lineage read `{ data: null, error: null }`) → merge.**

---

## 7. Traceability

### 7.1 T-19

| T-19 requirement | Where |
|---|---|
| Second function, 1b's untouched | §4; checker L11 |
| Filter `revoked_at IS NULL` and the claimant explicitly | §4 `FOR UPDATE` select; checker L05; text test |
| `grant_id` = the tier passed in from `TIER_ORDER[0]`; cohort passed in; no plan names in SQL | D-4; text test |
| Plain INSERT, a conflict aborts | §4; PGlite (T-1) |
| Level `parent.level + 1` and the parent's root, else 2 and the issuer | §4; PGlite L2 and L3 cases |
| C-2, `SECURITY INVOKER`, `SET search_path = ''`, idempotent | §4; checker L01–L04; `already_finalised` |
| `first_paid_at` / `first_payment_ref` nullable, no UPDATE grant until 5c | §4; checker L06–L08 |
| No-basis plan row passes every CHECK | PGlite (T-1) |

### 7.2 F5b-1 to F5b-7, N-4 and the 5a carry-over

| # | Where it is met |
|---|---|
| F5b-1 | §4, §4.1, §4.2, §11 |
| F5b-2 | D-1; the generic tier refusal kept for admin rows (test) |
| F5b-3 | D-2, D-3, D-11; Q-3. Material change for the friend? No: an existing account holder is told to sign in either way; only the channel moves from the page to their inbox. So no BA question to the user; TL mentions it as awareness |
| F5b-4 | Layer 1: §4 plan row. Layer 2: D-7, D-8; keyed on lineage, never `origin`; landing D-6; AC-18 probe §9 B-9 |
| F5b-5 | Accepted as written. The gate covers pages only; under `shadow` a held friend's session can still call Business OS APIs. It closes at `enforce` (`no_assignment`, fail closed). Revisit if Slice 4 resumes before S-5. The same applies to `/test-business-os`, which the middleware skips |
| F5b-6 | D-14 |
| F5b-7 | D-13: status from `redeemed_at` only; the list columns are unchanged (5a F5a-9) |
| N-4 | D-12 |
| 5a Q-3 | D-13 |

FR-34 → D-1 to D-5 · FR-35 → D-6 to D-10 · FR-36 → D-13, D-15, §9 B-7 (Tiers page) · FR-12a → D-4 · AC-18 → T-1, §9 B-8/B-9 · AC-19 → §9 B-4 to B-7.

---

## 8. Test plan

| Suite | Cases |
|---|---|
| Redemption (`inviteRedemption.test.ts`) | **Friend branch:** switch off → 409 `unavailable` with no email, no claim, no account lookup; wrong type, wrong tier id, grant no longer configured → `unavailable`; issuer not a champion, lapsed, no plan row → `unavailable`; issuer read error → 503. **Admin tier row → still 409 `paid_invites_not_available`.** **Champion path unchanged** (existing tests untouched). **F5b-3:** code route, new address vs existing account: identical status and body keys, `issueSignupCode` called in both, exactly one email in both (code vs notice), `markOpenedByExistingAccount` only in the second; complete route with an existing account: a wrong code → `code_invalid` (same as a new address), a right code → 409 `existing_account` **before** any claim; Google with an existing account → 409 after the proof, never before. **Finish:** `finaliseFriend` called with the config tier and cohort, never `finalise`; `finalised` / `already_finalised` → success with `landing: 'awaiting_payment'` and the returned level in the audit; `issuer_not_eligible` → no retry, FR-12a with that code, 503; `not_matched` → retry once, then FR-12a. Password and Google both reach `finaliseFriend` through `createAndFinish` |
| Routes (`routes.test.ts`) | Friend complete → `redirectTo: '/invite/awaiting-payment'`; Google likewise; champion still `/onboarding-chat`; the code route's two F5b-3 answers deep-equal apart from the timestamps |
| Payment hold (`paymentHold.test.ts`) | `isAwaitingPayment`: no lineage → false; `account_invite` unpaid → true; paid → false; `admin_invite` + tier unpaid → true; `admin_invite` + cohort → false. Reads: no lineage → one read; the invite read only for an invited account; the account id is the session's. Errors → not held and one `error` log (D-9). **Never imports `EntitlementService`, `mode` or `check`** (source guard) |
| Gate + layouts | Held → `redirect('/invite/awaiting-payment')` from both layouts; not held → children render; no session → children render (the pages handle it). The redirect is not swallowed by a `catch` |
| Holding screen | No session → sign-in link only; not held → redirect to `/onboarding-chat`; held → copy in the invite's language, `dir="rtl"` for he, sign-out button; no price, plan name, checkout or email promise |
| Public view / page | Account-issued tier + switch on → `valid` with `maskedEmail`; `emailHasAccount` never called; switch off → `unavailable`; the payment line shows for `payment_required` only |
| Champion side | Revoke own redeemed → 409 `already_used`; another account's redeemed → 404 and the second read carried the caller's `issuer_account_id`; own pending → 200. Send: `not_eligible` with the switch on writes no audit row; the other four still do |
| Repositories | One per new method, argument maps, `safeDbError`, `toError`, `details` never logged; `provisionFromFriendInvite` parses each outcome class |
| Migration text | C-2 five statements; `SECURITY INVOKER`; `search_path`; the two filters and `FOR UPDATE`; no `basic`/`pro`/`champion`/`trial`; only the listed literals; no `--`; the checker lists match |
| Email template | en/he/es; no link other than sign-in; no token, code, inviter or plan |
| Guards (stay green) | `mutationOrSelect` (EXEMPT unchanged), `tierLiteral.forbidden`, `npm run test:bos-entitlements`, `npm run test:authz-guard`, `eventAudience` counts unchanged |
| PGlite (T-1) | §6 T-1 list |

**Mutation targets for QA:** drop `revoked_at IS NULL`; drop the issuer check; level from the issuer's `level` without `+ 1`; skip the post-proof account check on the complete route; skip storing the decoy code; the gate keyed on `origin`; the landing always `/onboarding-chat`; audit `not_eligible` again.

---

## 9. Production manual check

**Identities.** Champion: the **existing test Founding Partner** from the 5a demo (never a new one). Friend (password path): `<you>+friend5b@gmail.com`. Friend (Google path): a **second real Gmail with no AgentPilot account** (Google always reports the base address, so a `+alias` cannot pass). Existing-account case: an address you own that already has an account, for example `<you>@gmail.com`.

**What cannot be undone.** Every friend account created here is permanent unless removed by hand:
- the auth user, its `profiles` row (and settings rows), a plan row with no basis, a **lineage row at L2** that the product never deletes (no FK, by design) and that will show in the Slice 6 circle report, and a burned invite that **uses one of the test champion's 5 slots for good** (BQ-15).
- **Deleting the test friend** in Supabase → Users fails until its `profiles` row (and any other rows referencing the user) are deleted by hand first; the plan row then goes with the user (`ON DELETE CASCADE`), but the lineage row stays. Record every friend account id in the QA report so reports can exclude it.
- So: **at most one password friend and one Google friend.**

### Part A — production, switch **off** (after `20261024` and the merge)

| # | Step | Expected |
|---|---|---|
| A-1 | §4.1 steps 1–4 | All `VERDICT PASS` |
| A-2 | Sign in as yourself (not held), open `/business-os` and `/onboarding-chat` | Both load as before (the gate does not hold a normal account) |
| A-3 | Open `/invite/awaiting-payment` signed in as yourself | Redirected to `/onboarding-chat` |
| A-4 | A pending friend invite link from the 5a demo (if any is still live), or send none | "no longer available" (`unavailable`) |
| A-5 | Browser console: `fetch('/api/business-os/friend-invites/00000000-0000-4000-8000-000000000000/revoke',{method:'POST'}).then(r=>r.status)` | 404, no 500, no 42703 in the Vercel logs |
| A-6 | An admin champion invite still redeems as before (optional, only if one is needed anyway) | L1, lands in onboarding |

### Part B — switch **on**, local run only

`npm run dev` with `accountInvitesAvailable: true` in the working copy **only, never committed**, against the live database. Links in emails point at the production origin: replace the host with `localhost:3000` and keep `#t=…`. (A throwaway preview does not work for Google, whose client has no preview origin.)

| # | Step | Expected |
|---|---|---|
| B-1 | As the test champion, send one invite to `<you>+friend5b@gmail.com` | Link shown once; "N of 5 left" drops by one |
| B-2 | Open the link (host swapped) in a private window | "<Champion> invited you", the note, the plan with its price, "payment required", the payment-later line, **the signup form and the Google button**, the masked address. No "you already have an account" |
| B-3 | "Send me a code", enter it, choose a password | Lands on `/invite/awaiting-payment`: "payment coming soon", no checkout |
| B-4 | Go to `/onboarding-chat`, `/onboarding-build`, `/business-os`, `/business-os/settings` and `/test-business-os` (SA R-1, R-2) | Each redirects to the holding screen |
| B-5 | Sign out; sign in again as the friend (in-app sign-in on `/test-business-os`, or the normal sign-in); open `/business-os` | Back on the holding screen |
| B-6 | SQL (read-only): the friend's lineage, plan row and invite | Lineage `source = account_invite`, `parent_account_id` = the champion, `level` = champion's level + 1 (2 for a pre-invite champion, with `root_account_id` = the champion), `first_paid_at` NULL; plan `cohort` NULL, `tier` NULL, `origin = invite`; invite `redeemed_at` set, `redeemed_account_id` = the friend |
| B-7 | Champion's settings; admin `/admin/business-os-invites`; the Tiers page | Champion: "Signed up — not subscribed yet", the count does **not** rise back. Admin: Accepted, L2, parent = the champion. Tiers page finds the friend's account (no basis) |
| B-8 | Console as the champion: revoke that invite's id | **409 `already_used`** |
| B-9 (first, SA R-9) | Read-only: `SELECT tgname, tgfoid::regproc FROM pg_trigger WHERE tgrelid = 'public.onboarding_conversations'::regclass AND NOT tgisinternal;` | Only `business_os_plan_on_onboarding`, or triggers with no side effect outside the transaction (for example no `pg_net`). If anything else appears, stop and ask Dev before B-9 |
| B-9 | **AC-18 probe**, SQL editor, rolled back: `BEGIN; INSERT INTO public.onboarding_conversations (user_id, message_sequence, role, content) VALUES ('<FRIEND_ID>', 0, 'user', 'qa5b probe'); SELECT cohort, tier, onboarding_started_at IS NOT NULL AS fact_filled FROM public.business_os_account_plans WHERE user_id = '<FRIEND_ID>'; ROLLBACK;` | `cohort` NULL, `tier` NULL, `fact_filled` true. Then a read-only count of that friend's onboarding rows is `0` |
| B-10 | **F5b-3:** send an invite to the existing-account address; open it; "Send me a code" | The page shows the normal form and "code sent", exactly like B-3. The mailbox receives the **"you already have an account — sign in"** email, **not** a code. A wrong code on the page answers "wrong code, N left" as usual. Admin list: "opened by an existing account". Then revoke this invite (Pending → its slot returns) |
| B-11 | Clean-up count: `SELECT count(*) FROM public.business_os_invites WHERE issuer_kind = 'account' AND revoked_at IS NULL AND redeemed_at IS NULL;` | `0` |

### Part C — Google friend

Either locally (needs the **dev** client id in `.env.local` **and** added to Supabase's Google provider Client IDs, per the Slice 3 ops record), or as the **first production check after the switch-on PR**, with the second real Gmail:

| # | Step | Expected |
|---|---|---|
| C-1 | Champion sends an invite to `<second>@gmail.com`; open it; "Continue with Google" as that account | Lands on the holding screen. B-6 and B-7 hold for this friend too (`BOS_INVITE_REDEEMED` has `method: google`) |
| C-2 | Logs and audit (Vercel, admin audit view), for B-3, B-10 and C-1 | No token, hash, code, password, ID token, email or `sub` in any log line or `BOS_INVITE_*` / `BOS_FRIEND_INVITE_*` details |

---

## 10. Switching friend invites on

After 5b merges, the switch is still **one line** (`accountInvitesAvailable: true` in `config/invites.ts`) in its own PR, with the config invariant test updated to expect `true`. **All of these must be true first:**

1. `20261023` and `20261024` are applied on production and their checkers PASS; 5a's P-1 lock probe has passed.
2. 5b is merged and deployed, with this slice's **N-4 fix** in it (D-12).
3. §9 Part A and Part B passed and are recorded in the QA report (Part C may follow the switch-on).
4. The T-9 row is in the entitlements switch-on list (D-14).
5. The user chooses to (BQ-13), knowing that: every in-force Founding Partner then sees "Invite friends"; any friend who signs up is **held with no time limit** and has nothing to do until 5c; and, until G-1 and Slice 4, invite-only is a business control, not a security boundary (§8.4).

6. **SA R-8(c):** if Slice 4 (closing open signup) resumes before S-5, first close the F5b-5 API residual and the Q-1 / FR-12a friend-orphan trial path.

**Awareness (SA R-10):** in 5b **no admin can let a held friend in**. Assigning a tier or cohort on the Tiers page does not lift the hold; only 5c's payment stamp does. Whether the business wants an admin "let in without paying" is a question for the 5c BA pass.

Nothing else gates it: the switch is read on the GET, the send, the page and at redemption, so turning it off again is the same one-line PR, and held friends simply stay held.

---

## 11. Rollback

| Layer | How | Notes |
|---|---|---|
| Behaviour | The switch is off at merge. If a switch-on PR misbehaves, revert that one line | Friends already held stay held (the gate reads lineage, not the switch). Their invites are burned |
| Code | Revert the merge PR | Friend invites go back to 5a behaviour (`signup_opens_soon`, refused at redemption). **A friend created before the revert would then fall through to onboarding**: their no-basis plan row stops a trial, but the page gate is gone. So revert the code only with the switch off and no friend accounts, or accept that |
| Database | `supabase/SQL Scripts/20261024_business_os_friend_invite_signup_rollback.sql`: a read-only pre-check that no lineage row has `first_paid_at` set (5c not live), then `BEGIN; DROP FUNCTION public.business_os_finalise_friend_invite_redemption(uuid, uuid, text, text, text); ALTER TABLE public.business_os_account_lineage DROP CONSTRAINT business_os_account_lineage_first_payment_ref_length; ALTER TABLE public.business_os_account_lineage DROP CONSTRAINT business_os_account_lineage_first_payment_paired; ALTER TABLE public.business_os_account_lineage DROP COLUMN first_payment_ref; ALTER TABLE public.business_os_account_lineage DROP COLUMN first_paid_at; COMMIT;` | **Revert the code first**: the hold read selects `first_paid_at`, and without the column it fails (open, D-9) and every held friend is released. Rows are never deleted |

**Rollback pre-check (SA N-5), read-only, paste first. It must return `0`:**

```sql
SELECT count(*) AS paid_lineage_rows FROM public.business_os_account_lineage WHERE first_paid_at IS NOT NULL;
```

Anything above `0` means 5c has stamped a payment: stop, do not roll back, and send the number to Dev.

**A stopped friend signup (FR-12a, SA R-11).** What the admin sees on the invites page (the T-16 indicator): step `finalise` with error code `issuer_not_eligible` (the champion lost the cohort between the claim and the finalise, Q-1) or a database error code. The account then exists with **no plan row and no lineage**, so it is **not held**. Recovery is by hand, as for every stopped signup: completing it (the friend finalise, run once with the recorded ids) is possible only while the account still has no plan row. If the orphan has already started onboarding, the trigger wrote a trial row, the finalise's plain INSERT aborts, and the admin decides case by case (end the trial, or leave it and record why). The D-3 notice email can invite that orphan to sign in; that is accepted on the F5b-5 bound (SA Q-1).

---

## 12. Split proposal

**Recommendation: one PR, committed in task order** (T-1 … T-11), so SA can review each part. It is medium-sized: one migration, 13 new files (6 of them tests or copy), 35 modified (about half tests).

The user's suggested split (5b-1 migration + password, 5b-2 Google + held screen) **does not fall out naturally**:
- **Google cannot be deferred cheaply.** `completeGoogleSignup` already calls `loadRedeemableInvite` and the shared `createAndFinish`, so the friend branch reaches Google automatically. Deferring it would mean adding a refusal now and removing it later.
- **The held screen cannot come after signup.** FR-35: a friend must never reach onboarding, and a local demo of signup without the gate would show a friend using the product.

**If it runs long, the clean cut is:**
- **5b-1** (the loop): migration, redemption (both methods), existing-account redesign, the gate and the holding screen, landing (T-0 to T-7, T-10, T-12). Demoable end to end.
- **5b-2** (the champion and admin views, and the switch-on preconditions): "Signed up — not subscribed yet", revoke 409, N-4, admin parent, T-9 doc (T-8, T-9, T-11). Small.

The switch stays off until **both** are merged (§10).

**SA ruling (2026-10-01): two PRs**, using the cut above. Part A of §9 runs per PR; Part B runs once, after 5b-2 merges. **5b-1 is implemented (§6.1).**

---

## 13. Questions for SA

| # | Question | Dev's recommendation |
|---|---|---|
| Q-1 | **The issuer lapses between the claim and the finalise** (seconds: an admin ends the champion's access, or `cohort_expires_at` passes, mid-request). T-19's SQL re-check then refuses after `createUser`, leaving an auth user with **no plan row and no lineage**. The gate does not hold it (no lineage), and the onboarding trigger would give it a **trial**. | Keep T-19's re-check (it decides), return `issuer_not_eligible` (D-4) so FR-12a names it, and accept the seconds-wide window. The admin sees it on the invites page (T-16 indicator) and handles it by hand, as every stopped signup. **Alternative for SA:** on `issuer_not_eligible`, still insert the no-basis plan row (not the lineage, not the burn), so no trial can be minted for the orphan. It closes the trial path at the cost of a partial write. |
| Q-2 | Gate fail mode when the hold read errors. | **Open**, logged at `error` (D-9). Closed would send every customer to the holding screen during a DB blip. Layer 1 still stops a trial. |
| Q-3 | F5b-3 design: the decoy code (D-3) and the notice email. Residuals: (a) the champion can spend the friend's code budget (the 1b send limits) or lock the code path with 5 wrong codes; Google still works (3b D-8) and the window resets. This already exists for admin invites, where the admin holds the link. (b) A `signup_in_progress` answer tells the link holder that someone is mid-signup, for at most the 120 s lease. | Accept both. Neither says whether the address has an account. |
| Q-4 | The holding screen at `/invite/awaiting-payment`, to reuse the middleware's `/invite/*` bypass (no middleware change, `no-referrer`, `noindex`). The alternative is a top-level path plus a new `skipOnboardingCheck` entry, which is needed anyway to avoid a redirect loop. | `/invite/awaiting-payment`. 5c can keep the path for "finish your payment". |
| Q-5 | T-13 also says the **shadow report** should label these rows "awaiting payment", not as a defect. They currently show as the `no_assignment` anomaly. | **Defer to 5c**, where FR-5/FR-25's "signed up, not paid" status lands in the admin views; the report can read `isAwaitingPayment` then. 5b's admin invites list already shows Accepted, L2 and the parent, so an admin can tell. |
| Q-6 | `paymentHoldGate.ts` imports `resolveAccountId`. It **refuses a page**, but by lineage, not by plan or capability. | Register it in `KNOWN_NON_GATE_IMPORTERS` with that reason: it keys on how the account was created and whether it paid, reads no plan and no capability, and would stay the same if every capability moved. |
| Q-7 | The two lineage CHECKs (`first_payment_paired`, ref length 1–255). T-19 only says "nullable". | Keep them: 5c's stamp then cannot write half a milestone. Drop them if SA prefers 5c to own the shape. |
| Q-8 | `signup_opens_soon` becomes unreachable once the page shows `valid` for friend invites with the switch on. | Remove it (state, copy, page branch, tests). The switch now means "friends may be invited and may sign up". |

---

## 14. Logging-standard check (console.*)

Counted on `de4b31f2` for every existing file this plan modifies: **0 `console.*`** in all of them, including `middleware.ts` (not modified), `app/onboarding-chat/layout.tsx`, `app/business-os/layout.tsx`, `inviteRedemption.ts`, `redemptionDeps.ts`, `publicInviteView.ts`, `friendInviteOps.ts`, `adminInviteOps.ts`, the three repositories, `types.ts`, the three public signup routes, both friend-invite routes, `app/invite/page.tsx`, `invitePageCopy.ts`, `InviteFriendsSection.tsx`, `inviteFriendsCopy.ts`, the admin list files, `lib/client/auth-actions.ts` and the entitlements doc.

**Flag (next to this work, not modified by it):** `app/onboarding-chat/page.tsx` has **3 `console.*` calls**. 5b changes only the segment's `layout.tsx`, so the page is not converted here. Converting it is proposed as a separate small change for the user to approve. (The 5a flag on `lib/business-os/LanguageContext.tsx`, 9 calls, still stands; 5b does not touch it.)

New files use `createLogger` only.

**5b-1 addition:** `app/onboarding-build/layout.tsx` (modified, SA R-1) has **0 `console.*`**, as have `docs/BUSINESS_OS_TEST_PAGE_SCOPE.md`, `lib/email/__tests__/platformBranding.test.ts` and every new file. The gated `app/onboarding-build/page.tsx` and `app/test-business-os/page.tsx` are **not** modified.

---

## SA Review Notes

### SA Workplan Review — 2026-09-30

**Reviewed by SA — 2026-09-30**, against `origin/main` `de4b31f2` in the `neuronforge-invite-s0` worktree.
**Status:** ✅ Approved with conditions. Implementation may start. R-1 to R-5 are part of the implementation, not follow-ups, and SA code review checks every R-item.

**Verdict in one paragraph.** The design is sound and follows T-19 and F5b-1 to F5b-7. The migration is correct as written. The redemption branch, the decoy code and the lineage-keyed gate are the right shapes. There is **one real gap**: D-8 says the two layouts "cover every entry", but they do not. `/onboarding-build` is a sibling of `/onboarding-chat`, not a child. Middleware skips it (`startsWith('/onboarding')`), and its page calls `POST /api/onboarding/build`, which writes a completed business profile. After that, middleware lets the account into every other signed-in page. `/test-business-os` is also skipped by middleware and is open to any signed-in account. Both need the gate (R-1, R-2). Nothing here needs a user decision.

#### Verification

| Item | Result | SA note |
|---|---|---|
| **Migration `20261024` against T-19** | ✅ | `SELECT … FOR UPDATE` on the invite, before the issuer check. `service_role` holds `UPDATE` on invites (20261012:81), which the lock needs. Under READ COMMITTED, a concurrent revoke that commits first is re-checked against `revoked_at IS NULL` on the new row version, so it gives `not_matched`, never a raise. The `revoked_at IS NULL` and `claimed_account_id = p_account_id` filters are explicit. Tier and cohort are parameters. The plan and lineage writes are plain INSERTs. The level rule is `parent.level + 1` with the parent's root, or `2` with the issuer as root, and this satisfies `level_shape`. The plan row has no basis: it passes `tier_versioned` and both expiry-pair CHECKs (20261005:138-146). `SECURITY INVOKER`, `SET search_path = ''`, and the five C-2 statements are present. `RETURN QUERY` followed by `IF NOT FOUND` is correct plpgsql (`RETURN QUERY` sets `FOUND`). The `result_*` OUT names cannot collide with column names. The in-force predicate matches 20261023:23-24 and `isInForceChampion` exactly. See R-6 for one tightening. |
| New lineage columns, no UPDATE grant | ✅ | Two nullable columns and two CHECKs that every existing row already satisfies. No table grant changes. Checker L08 pins `SELECT, INSERT` only. |
| SQL-editor safety | ✅ | One transaction, no `--` comments, dollar-quoted body, and a pre-check that detects a re-apply. Blank lines inside the `$$` body follow the 20261014 precedent, which applied cleanly. Optional: add `SET LOCAL lock_timeout = '5s'` (20261005 precedent), so the editor fails fast instead of hanging behind a champion redemption. |
| Checker L01–L11 | ✅ with R-7 | |
| Rollback | ✅ | Pre-check first, then revert the code before the DB, and no rows are deleted. |
| **Hold gate keyed on lineage** | ✅ | `first_paid_at IS NULL` and (`account_invite`, or an invite with a tier grant). It never reads `origin`, the mode or `EntitlementService`. Tighten it with R-3. |
| **Gate coverage** | ❌ without R-1 and R-2 | See the verdict above. The API routes under `/api/business-os/**` and `/api/onboarding/**`, the chat API and plugin execute are **not** covered: that is F5b-5, see the bound below. `/(protected)/*` and `/v2/*` need a completed profile, so once R-1 closes the page path they are reachable only through the API residual. |
| **T-13 layer 1** | ✅ | Verified in 20261005:349-392. Both triggers `INSERT … VALUES (…, 'trial', …) ON CONFLICT (user_id) DO UPDATE SET <one fact>`. With the no-basis row present, they can only fill `onboarding_started_at` or `profile_created_at`. They never touch `cohort`. The plan FK to `auth.users` is satisfied because the finalise runs after `createUser`. |
| **N-4** | ✅ | D-12: `not_eligible` is logged and never audited, from either side. The other four refusals stay audited. The route's current `warn` for every refusal is fine to keep. |
| **Revoke of an accepted invite → 409** | ✅ | A separate scoped read method, called from `friendInviteOps.ts`, which has no `.update(`. `revokeForIssuerAccount` keeps its `.or(noLiveClaim)` with `{ count: 'exact' }` and no `.select`. **Keep the second read out of that method's block**: the guard scans to the end of the enclosing block after an `.update(`. `EXEMPT` stays one entry. |
| **Both signup methods through `createAndFinish`** | ✅ | `completeSignup` and `completeGoogleSignup` both reach `finish()`, so branching there covers both methods by construction. 5b adds no new mutation, only three SELECT methods and one RPC, so no `.or()` is combined with `.select()`. |
| **§10 switch-on preconditions** | ✅ with R-8 and R-10 | |
| Entitlements registration | ✅ | `paymentHoldGate.ts` → `KNOWN_NON_GATE_IMPORTERS` (Q-6). `paymentHold.ts` and the holding page must import nothing from the module. The RC-15 guard gains `provisionFromFriendInvite`. |
| Logging | ✅ | Every modified file has 0 `console.*`. `app/onboarding-chat/page.tsx` (3 calls) is flagged and left to the user, which is correct because the file is not modified. |

#### Rulings on Q-1 to Q-8

| # | Ruling |
|---|---|
| **Q-1** | **No: do not insert the no-basis plan row on `issuer_not_eligible`. Accept Dev's recommendation.** (1) The partial write breaks recovery. If the admin later completes that signup, the friend finalise's plain plan INSERT conflicts with the row written here and aborts. (2) Without lineage, the account is not held either way, so the gain appears only at `enforce`. (3) While Slice 4 is parked, anyone can get a trial by signing up on the marketing site, so this orphan's exposure is no greater than any visitor's. (4) The window is seconds wide and needs an admin action in the middle of a request. The same orphan already exists for every FR-12a stop on the friend path, not only this one (for example two DB errors at finalise). The D-3 notice email can then invite that orphan to sign in. All of this is accepted on the same bound as F5b-5 and recorded for revisiting (R-8). Keep the SQL re-check: it is cheap defence against a TypeScript regression, and `issuer_not_eligible` makes FR-12a diagnosable. |
| **Q-2** | **Fail open is approved, with R-3 and R-4.** Failing closed for "accounts with a friend lineage row" is exactly what R-3 delivers. The lineage read is what tells us, so when it succeeds and shows `account_invite` with no payment, the friend is held with **no second read**. The gate can then fail open only when **the lineage read itself** fails, and then nothing is known, so failing closed would hold every customer. What stays open is a blip in which the lineage PK read fails but the product's own reads succeed, which is unlikely. Layer 1 still stops a trial, and the API is already open under F5b-5. "No session" and "session read failed" (`getUser()` returns `null` on error) also fall through open and are accepted on the same basis. **5c must revisit this for `admin_invite` rows with a tier grant**, where the invite read does decide. |
| **Q-3** | **Sound. Residuals (a) and (b) are accepted.** Neither says whether the address has an account. With the decoy stored, `complete` answers `code_invalid` for both kinds of address, and the only one who can pass the code or the Google proof is the mailbox owner. Add residual **(c) timing**: the existing-account branch also runs `markOpenedByExistingAccount` and an audit. That is tens of ms against an email send with far larger jitter. Accepted; see the optimisation suggestion. **The notice email to the mailbox itself is OK**, with R-5: whoever holds the link can trigger it, so it must carry nothing from the champion and must tell the reader to ignore it if they did not ask. **Not a material change for the friend** (F5b-3): an existing account holder is told to sign in either way, and only the channel moves. No BA question. |
| **Q-4** | **Approved: `/invite/awaiting-payment`.** It inherits the middleware bypass, `no-referrer` and `noindex` with no middleware change. |
| **Q-5** | **Deferral to 5c approved, with R-8.** Held friends will show as `no_assignment` in the shadow report between switch-on and 5c. The admin invites list (Accepted, L2, parent) identifies them. Enforcement must not be switched on before the label exists, and R-8 records that in the entitlements doc. |
| **Q-6** | **Approved: `KNOWN_NON_GATE_IMPORTERS`.** `ENFORCEMENT_POINTS` is keyed by capability, and the hold refuses by payment lineage, not by plan or capability. The `why` must say which change added the import, that the file uses `resolveAccountId` only as the account seam, that it reads no plan row, snapshot or capability, and that **if it ever reads a plan or calls `check()`, it becomes a gate and moves**. |
| **Q-7** | **Keep both CHECKs in 5b.** They are shape, not value. 5c then owns only the column-level grant (F5c-2) and cannot write half a milestone. |
| **Q-8** | **Approved: remove `signup_opens_soon`.** The switch has never been on in production, so no friend has ever seen that state, and no persisted value names it. |

#### Accepted risk: the F5b-5 API residual

Under `shadow`, a held friend's session can still call `/api/business-os/**` and `/api/onboarding/**` (which includes the chat and onboarding LLM calls) and plugin execute. This costs LLM spend, with no trial. **It is bounded well enough for 5b**, for four reasons. (1) While open signup exists, any visitor gets the same product through the marketing site with less effort. (2) Friends are verified mailbox owners invited by a Founding Partner, at most 5 per champion. (3) After R-1 and R-2 there is **no page path**: it takes hand-made requests. (4) It closes at `enforce` (`no_assignment` fails closed). **The bound depends on (1).** If Slice 4 (closing open signup) resumes before S-5, the residual becomes the only free path and must be closed first. R-8 writes that down where Slice 4 and S-5 will see it.

#### R-items

| # | Priority | Item | SA |
|---|---|---|---|
| **R-1** | High | **Gate `/onboarding-build`.** Add `await redirectIfAwaitingPayment()` as the first statement of `app/onboarding-build/layout.tsx` (a server component, sync today, 0 `console.*`), and add it to §3. Correct D-8's "cover every entry" to name three places. Test it in the gate-and-layouts suite, and add `/onboarding-build` to §9 B-4. | pending |
| **R-2** | Medium | **Gate `/test-business-os`.** Add a server `app/test-business-os/layout.tsx` that calls the gate. It is open to every signed-in account in production and skipped by middleware, and its "Account setup" and module testers drive the full Business OS API in one click. The gate turns it into the API-only residual. B-5 still works: signed out, the page renders as today. Add it to §9 B-4. Update `docs/BUSINESS_OS_TEST_PAGE_SCOPE.md` with one line, plus a Change History row. | pending |
| **R-3** | Medium | **Short-circuit D-7.** A lineage row with `source = 'account_invite'` and `first_paid_at IS NULL` is held **without** reading the invite. Read the invite only for `admin_invite` rows (5c's case). The `language` read belongs to the holding screen only. Test: for an `account_invite` row, `findHoldFactsById` is never called, and an error from it cannot release a friend. | pending |
| **R-4** | Medium | **Holding screen error path.** When `readHoldForSession` fails, the screen renders a neutral "something went wrong, try again" state with Sign out, and **does not redirect** to `/onboarding-chat`. Otherwise one failed screen read releases a friend whom the layout just held. The gate and the screen share `readPaymentHold`, so they can never disagree on the predicate. Add a render test. | pending |
| **R-5** | Medium | **Notice email (F5b-3).** Use the system sender. No champion name, no `Reply-To` to the champion, no invite link, token or code. The only link is to sign in. Include "If you did not ask for this, you can ignore this email." The template test pins that there is no `replyTo` and no inviter. | pending |
| **R-6** | Low | **Tighten `already_finalised`.** Also filter `done_row.issuer_kind = 'account'` and `lineage_row.source = 'account_invite'`, so the friend function never reports success for a row it would not write. Pin both in the text test. | pending |
| **R-7** | Low | **Checker.** Add a row that `prosrc` contains no `ON CONFLICT` (plain INSERTs), and one that pins `pg_get_function_result` to the three-column table. | pending |
| **R-8** | Medium | **D-14 entitlements-doc row, widened.** Before enforcement: (a) T-9, as written. (b) The shadow report labels held accounts "awaiting payment" (Q-5). (c) **If Slice 4 resumes before S-5**, first close the F5b-5 API residual and the Q-1 / FR-12a friend-orphan trial path. Also add (c) as one line in this workplan's §10, so the switch-on PR carries it. | pending |
| **R-9** | Low | **T-0.** List the triggers on `onboarding_conversations` (read-only) before running B-9 in production. Only the plan-fact trigger is known from the migrations. Confirm that nothing else has a side effect outside the transaction (for example `pg_net`) that `ROLLBACK` would not undo. | pending |
| **R-10** | Low | **§10 awareness bullet.** In 5b **no admin can let a held friend in**. Assigning a tier or cohort on the Tiers page does not lift the hold; only 5c's payment stamp does. Whether the business wants an admin "let in without paying" is a question for the 5c BA pass, not for 5b. | pending |
| **R-11** | Low | **A stopped friend signup (FR-12a).** Add one paragraph to §11 or §9 on what the admin sees: `issuer_not_eligible` or a finalise error. The account then has no plan row and no lineage, and it is not held. Recovery is by hand. Completing the signup is possible only while the account has no plan row: if the orphan has already started onboarding (a trial row), the friend finalise aborts and the admin decides case by case. | pending |

#### The split

**Recommendation: two PRs, using §12's fallback cut, not the originally suggested one.** Dev is right that "password now, Google later" does not fall out: Google shares `createAndFinish`. Dev is also right that the gate cannot trail the signup.
- **5b-1:** the migration, redemption for both methods, F5b-3, the gate (with R-1 and R-2), the holding screen and the landing (T-0 to T-7, T-10, T-12). This PR carries all the money and security review.
- **5b-2:** the champion copy, revoke 409, N-4, the admin parent, and the T-9/R-8 doc row (T-8, T-9, T-11). It carries no security weight, so review and QA are short, and it would only dilute attention inside 5b-1.

Part A runs per PR. Part B runs once, after 5b-2 merges. The switch stays off until both are merged. This is a delivery choice, not a business decision.

#### Optimisation suggestions (non-blocking)

- Wrap the session read in React `cache()`, so the gate and `readPlanBadge` share one `getUser()` per render in the Business OS layout, instead of two auth round trips.
- In the D-3 existing-account branch, run `markOpenedByExistingAccount` and its audit alongside the notice send (`Promise.all`), to narrow residual (c).
- `SET LOCAL lock_timeout = '5s'` after `BEGIN` in the migration (see above).

#### For the user

**No decision needed.** For awareness only:
1. A friend who signs up is held on "payment coming soon". Until payment exists (5c), **nobody can let them in early**, including an admin.
2. Until open signup on the marketing site is closed, a held friend who knows how to send requests by hand could still use Business OS features, just as any visitor can today by signing up directly. The screens are closed to them. This closes when plan enforcement is switched on.
3. SA recommends shipping 5b as two small PRs. The first is the signup and the hold; the second is the champion's and admin's views. Friend invites stay switched off until both are in.

### Approval

[x] Workplan approved. Proceed to implementation, subject to R-1 to R-11. SA code review checks each of them.

### SA Code Review 5b-1 — 2026-10-01

**Code Review by SA — 2026-10-01**, on the uncommitted `feature/bos-invite-friend-5b` worktree at `56feb9d2` (14 new, 27 modified, plus this workplan and the Slice 3 workplan's docs-only status update).
**Status:** ✅ Code Approved. There are no blockers and nothing must be fixed before merge. One item, CR-1 (copy), must be fixed before the switch is turned on and is carried to 5b-2. The rest are nits and optimisations.

**Verdict in one paragraph.** The migration matches T-19 line by line, and R-6, R-7 and `lock_timeout` are in. The redemption friend branch runs after the state and live-claim checks and before the generic tier refusal. It asks the account question only after mailbox proof, and the decoy code makes the code route's answer, log line and rate-limit spend identical for both kinds of address. Both methods reach `finishFriend` through `createAndFinish`. The gate is keyed on lineage alone, runs first in all four layouts, and fails open only when the lineage read fails. The holding screen never releases a friend on an error. The switch `accountInvitesAvailable` is still `false` (`lib/business-os/entitlements/config/invites.ts:117`, not in the diff). **`20261024` is approved to paste** (§4.1 steps 1–4, then merge).

#### Verification

| Item | Result | SA note |
|---|---|---|
| **Migration `20261024` vs T-19** | ✅ | Second function; 20261014 untouched (L11). `FOR UPDATE` select keyed on id, `claimed_account_id = p_account_id`, `email`, `issuer_kind = 'account'`, `grant_kind = 'tier'`, `grant_id = p_tier`, `redeemed_at IS NULL`, `revoked_at IS NULL`. `business_os_invites_one_issuer` (20261012:47) guarantees `issuer_account_id` is non-NULL on an account row, so `v_issuer IS NULL` means "no matching row" and nothing else. The issuer in-force predicate is byte-identical to 20261023:19-25. Level/root: an L1 champion has `root_account_id = account_id` (20261014:124), so L2 gets root = champion; with no issuer lineage, 2 and the issuer; L3 inherits the root. Every branch satisfies `level_shape`. Plain INSERTs, so an existing plan or lineage row aborts the whole transaction, including the burn (Dev's PGlite pins this). No plan names; tier and cohort are parameters. |
| R-6 | ✅ | `already_finalised` also filters `done_row.issuer_kind = 'account'` and `lineage_row.source = 'account_invite'` (`20261024…sql:44-47`). The lineage PK means at most one row. |
| R-7 / checker | ✅ | L12 (`ON CONFLICT` absent, case-folded) and L13 (`pg_get_function_result` built with `chr()` so the editor sees no parentheses in a literal). Each function row FAILs when the function is missing (`total = 1` or a `= 1` count). 15 rows, one final `SELECT`, `default_transaction_read_only`. |
| `lock_timeout`, C-2, INVOKER, `search_path`, editor safety | ✅ | `SET LOCAL lock_timeout = '5s'` right after `BEGIN`. The five C-2 statements. `SECURITY INVOKER`, `SET search_path = ''`, every name schema-qualified. One transaction, no `--`, dollar-quoted body, blank lines only between statements and inside `$$` (20261014 precedent). No table grant change; lineage stays `SELECT, INSERT` (L08b). |
| Rollback | ✅ (nit N-5) | Drops the function, both CHECKs, both columns, in the right order, inside one transaction. It matches the 20261014/20261023 shape, and the text test pins it. |
| **Gate, all four layouts** | ✅ | `await redirectIfAwaitingPayment()` is the first statement of `app/onboarding-chat/layout.tsx`, `app/onboarding-build/layout.tsx` (R-1), `app/business-os/layout.tsx` (before `readPlanBadge`) and the new `app/test-business-os/layout.tsx` (R-2). A source test pins all four. Every page under those segments is `'use client'`, so no server page body runs side effects in parallel with the layout's redirect. **Build:** every gated page route is `ƒ` (dynamic), none prerendered (see N-2). |
| R-3 | ✅ | `paymentHold.ts:77`: an unpaid `account_invite` row is held on the lineage read alone. The invite is read only for `admin_invite`. Tested with a failing invite reader. |
| R-4 | ✅ | `readHoldForSession` maps `{ ok: false }` to `error`, never `not_held`. The page redirects only on `not_held` (`awaiting-payment/page.tsx:48`), and the error state offers Try again and Sign out. Render test. |
| Keyed on lineage only | ✅ | The source test pins that the gate imports only `entitlements/account` and the lineage and invite repositories, and never names `EntitlementService`, `getSnapshot`, `check(`, the mode or `origin`. `paymentHold.ts`, the page and the copy import nothing from the entitlements module. |
| Q-6 registration | ✅ | `KNOWN_NON_GATE_IMPORTERS` entry (`enforcementPoints.test.ts:362-366`) carries all four parts of SA's `why`: the slice, "account seam only", "no plan, snapshot or capability", and "if it ever reads a plan or calls `check()`, it moves". |
| **Merge before the migration** | ✅ safe, and the order is explicit | Before `20261024`, `findHoldFactsForAccount` gets `42703`. The repository returns `{ error }` and never throws, `readPaymentHold` returns `{ ok: false }`, and the gate logs at `error` and renders the page. Nobody is locked out and nothing crashes. `/invite/awaiting-payment` shows its error state, which only a direct visit can reach. Friends cannot exist yet (the switch is off, and the RPC is `PGRST202`). The order "apply → checker PASS → re-probe → merge" is in the Status line (line 10) and §6.1. **RM must copy it into the PR body as a merge gate.** |
| **Redemption friend branch** | ✅ | `loadFriendInvite` runs after the state and live-claim checks and never calls `emailHasAccount`. It checks the switch, the shape (tier, `inviteType`, `grantId`, `issuer_account_id`, `isInviteGrantAvailable`) and the issuer (`isInForceChampion`); a read error gives 503, and any other "no" gives 409 `unavailable`. The admin tier refusal is unchanged below it (F5b-2). The account question is asked only after mailbox proof: on the code route after the CAS store (`inviteRedemption.ts:421-426`), on complete after the code matched (`:486-491`), on Google after the proof and the address match (`:564-569`). I-6's stale-claim skip is kept on complete and Google. |
| Decoy + identical answers | ✅ | Both branches pass the same `decideCodeIssue`, the same CAS store and counters, and the same 429s. They give the same success body and the same `'Signup code sent'` log line. An `emailHasAccount` error is 503 in both. A failed send is `code_not_sent` in both. `complete` then answers `code_invalid` for both kinds of address. Residual (c) is narrowed with `Promise.all`. Tested at `inviteRedemption.test.ts:1144-1171`. |
| R-5 notice | ✅ | `redemptionDeps.ts:76-90`: `kind: 'transactional'`, no `from`, `replyTo` or `ownerUserId`, and `redactRecipientInLogs: true`. The template (`invite-existing-account.ts`) has no inviter, token, code, invite link or plan. It has one sign-in link (`marketingUrl('/login')`, the link the invite page already uses) and the "ignore if you did not ask" line in en/he/es. The subject names the purpose only. |
| Both methods → `createAndFinish` → `finishFriend` | ✅ | `finish()` branches on `kind` as its first line. Password and Google both pass `kind` through `createAndFinish`, including the "our own account from an interrupted attempt" path. |
| Q-8 | ✅ | `signup_opens_soon` is removed from the view type, the page type, the page branch and the copy, and the validate tests were moved to `valid`. |
| **Deviations 1–8** | ✅ all accepted | (1) `issuer_account_id` is in `BUSINESS_OS_INVITE_REDEMPTION_COLUMNS` only. The public view builds its own response and never spreads the row, and no logger receives the row. (2) `REDEMPTION_LANDING_PATHS` sits in `redemptionDeps.ts`, typed `Record<RedemptionLanding, string>`, so a new landing cannot compile without a path. (3) `finishFriend` does not retry `issuer_not_eligible` and writes FR-12a step `finalise`, code `issuer_not_eligible`; `not_matched` and DB errors retry once (I-5). (4) `provisionFromFriendInvite` gives an error for an unknown outcome or a malformed success (non-string id, non-number level), never success. (5) The notice is sent after the budget was counted, so the 429s are identical. (6) The screen reads the language itself, so the gate path stays one read, and a failed language read gives English and stays held. (7) The `platformBranding` allow-list gains the notice template. (8) The page's own `metadata` has `noindex`, `no-referrer` and the title "AgentPilot". |
| **Tenant isolation** | ✅ | The hold's account id comes from `getUser()` → `resolveAccountId`, never from a request. `findHoldFactsById` gets the invite id from that account's own lineage row. Finalise parameters are all server-derived (the row's id and email, the minted account id, config tier and cohort). No `.update`, `.upsert` or `.or(` was added (grep of the diff). `mutationOrSelect.guard` is green with `EXEMPT` unchanged. |
| M-1 scrub | ✅ | The three new methods log `{ dbError: safeDbError(…) }` only and return a scrubbed `Error` (`toError`, or `{ code, message }` rebuilt). `details` is never logged. The repository tests include the leak suite. |
| `WRITE_METHODS` | ✅ | `provisionFromFriendInvite` added. The wiring test now requires both finalise writes and forbids every other plan-state write in `redemptionDeps.ts`. |
| Logging standard | ✅ | 0 `console.*` in every touched and new file. The `app/onboarding-chat/page.tsx` flag (3 calls, not modified) stands as recorded in §14. |
| Switch | ✅ | `accountInvitesAvailable: false as boolean`, file not in the diff. |

#### Code Review Comments

| # | Where | Finding | Severity |
|---|---|---|---|
| **CR-1** | `app/invite/page.tsx:144` with `:308-312`; `invitePageCopy.ts` `paymentOpensLater` | **Contradictory copy on a friend's invite page.** For a paid offer, `InviteOfferDetails` still prints "Payment is required at signup." Just below it, the new line says "You can create your account now. Payment opens soon…". Both show on every friend invite (§9 B-2 expects both). The friend is told two opposite things, which conflicts with FR-22's honesty rule. Inert while the switch is off. **Fix before switch-on, in 5b-2:** hide `paymentRequired` when the payment-later line shows, or reword it to "Payment is required before you can use AgentPilot". BA owns the words. | Must-fix before switch-on (not a merge blocker for 5b-1) |
| N-1 | `lib/email/templates/invite-existing-account.ts:71-73`, called from `redemptionDeps.ts:78` | `safeHref` **throws** on a malformed `NEXT_PUBLIC_MARKETING_URL`. That breaks the dep's "never throws" contract: on the existing-account branch alone, the code route would answer 503 `unavailable_try_again` from the route's catch, while a new address gets 200. The difference would be config-induced. Unlikely (the env is ours, and the invite page uses the same URL), but cheap to close: wrap the notice build and send in `try/catch` → `{ sent: false }`, or validate once at module load. | Low |
| N-2 | `lib/business-os/invites/paymentHoldGate.ts:57-63` | The `try/catch` around `getUser()` also catches Next's `DYNAMIC_SERVER_USAGE` at build time: 20 `warn` lines "Session read failed" in `next build`. The routes are still `ƒ`, because Next 14.2 flags dynamic use before it throws (verified in the build table), and `requireAdminPage` uses the same pattern. Still, correctness rests on that framework detail: a statically prerendered gated layout would pass every visitor through as signed out. Consider `export const dynamic = 'force-dynamic'` on the three layouts that were not already dynamic, or rethrowing when `digest === 'DYNAMIC_SERVER_USAGE'`. | Low |
| N-3 | `lib/business-os/invites/redemptionDeps.ts:61` | `issuerPlans: businessOsAccountPlanRepository` hands the whole plan repository (all write methods) to the orchestration, narrowed only by the `IssuerPlanReader` type. The RC-15 guard is textual and would not catch `deps.issuerPlans.<write>` added later in `inviteRedemption.ts`. Prefer `{ findEntitlementInputs: (id) => businessOsAccountPlanRepository.findEntitlementInputs(id) }`. The 5a `friendInviteDeps.ts:30` precedent has the same shape. | Low |
| N-4 | `app/api/public/invites/signup/complete/route.ts:55-56` | A double blank line was left where `LANDING` was removed. | Low |
| N-5 | §11 Database row | The rollback's "read-only pre-check that no lineage row has `first_paid_at` set" is described but not written anywhere. Put the exact `SELECT count(*) FROM public.business_os_account_lineage WHERE first_paid_at IS NOT NULL;` (expect `0`) in §11. It is always 0 in 5b (no UPDATE grant), but 5c will need it. | Low |
| N-6 | `lib/business-os/invites/publicInviteView.ts:178-179` | The page's friend branch checks `grant_kind` and the switch, but not `invite_type` / `grant_id` as `loadFriendInvite` does. A malformed account row (only the SQL send writes them, so none can exist) would show the form, and redemption would then say "no longer available". Harmless; align in 5b-2 if convenient. | Low |

#### Optimisation Suggestions

- `readPaymentHold` does a second PK read (the invite) on every gated render for every **L1 champion** (`admin_invite` rows). In 5b those rows are always cohort grants, so the read can never hold anyone. It is cheap and correct for 5c, so keep it. If the layouts' latency matters, React `cache()` over the session read (already suggested) is the larger win.
- The code-route identical-answer check lives in `inviteRedemption.test.ts`. A route-level deep-equal of the two answers (§8 "Routes") would also pin the HTTP mapping. Optional.

#### Checks run by SA (2026-10-01, in the worktree)

| Check | Result |
|---|---|
| Touched suites (`lib/business-os/invites`, `app/api/public/invites`, `app/invite`, `lib/email`, the 5b migration text test, friend-invite routes, admin invites, settings) | ✅ 45 suites, 1,127 tests |
| `npm run test:bos-entitlements` | ✅ 98 suites, 2,058 tests |
| `npm run test:authz-guard` | ✅ 1 suite, 119 tests |
| Every `guard` / `forbidden` / `invariant` / `eventAudience` suite in the repo | ✅ 51 suites, 1,156 tests |
| `npm run lint:hooks` | ✅ clean |
| `npx eslint` on every touched and new `.ts`/`.tsx` | ✅ 0 errors; 4 `no-explicit-any` warnings, all on unchanged lines |
| `tsc` over the touched non-test files | ✅ 0 errors in touched files; 32 pre-existing errors in files reached through imports (`LanguageContext.tsx` 24, `ConfigurationDialog.tsx` 3, `SchedulingBookingModal.tsx` 3, `StripeConnectStatus.tsx` 1, `JourneyGapNotice.tsx` 1), the same as Dev's list |
| `npx next build` with the CI placeholder env from `build.yml` | ✅ exit 0. `/business-os` and all 6 sub-pages, `/onboarding-chat`, `/onboarding-build`, `/test-business-os`, `/invite`, `/invite/awaiting-payment` are all `ƒ`; no gated page is static |

#### `20261024` — approved to paste

Yes. Order: §4.1 step 1 (pre-check `0, 0`) → step 2 (paste) → step 3 (checker **15 pass 0 fail**) → step 4 (5a and Slice 0 checkers PASS) → re-run the live probe (RPC `not_matched`, lineage read `{ data: null, error: null }`) → merge 5b-1.

### Code Approved for QA: Yes

Conditions: CR-1 is fixed in 5b-2, before the switch-on PR, and §10 gains that as a precondition. The nits are the Dev's choice; N-1 and N-3 are recommended in this PR if it is reopened anyway. **Merge only after `20261024` is applied and its checker is PASS.** RM puts that sentence in the PR body.

---

## QA Testing Report

*(QA to populate. Must include the PGlite T-1 results, the §9 Part A and Part B records (with every friend account id created), the B-9 and B-11 SQL pastes, and, when run, Part C.)*

### QA Report 5b-1 — 2026-10-01

**QA — 2026-10-01**, on the uncommitted `feature/bos-invite-friend-5b` worktree at `56feb9d2` (after the SA code-review fixes CR-1 and N-1 to N-5).
**Test mode:** full
**Strategy used:** A (Jest unit: the touched suites and every guard), B (PGlite over the real migration chain, the integration layer for `20261024`), C (QA probes in the scratchpad: the REAL routes, redemption, deps wiring, email template, gate, four layouts and holding page, with only the repositories, transport, audit, session and logger faked), plus mutation testing. **D (browser) not run:** the switch is off, so no friend can exist in any environment yet. The browser checks are the user's §9 Part A (now) and Part B (after 5b-2).
**Focus:** all (api, ui, schema, security)
**Skipped:** the live production probe and §9 Part A/B/C, which need the user's SQL editor and browser (checklist below). No DB writes, no production routes and no real emails were used.
**Input source:** prompt keywords (TL brief), then the §8 test plan and SA R-1 to R-11 / CR-1 / N-1 to N-5.

**Safety record.** Before any test, all 43 modified and untracked files were snapshotted with SHA-256 hashes, plus `git status` and `git diff --stat`. Mutants were applied one file at a time, and each file was restored from the snapshot and hash-checked (18/18 `restored-ok`). SQL mutants for PGlite ran on in-memory copies of the migration text. Nothing was committed, stashed, checked out or reset. `node_modules` was not touched. **Before this report was written: `git status --porcelain -uall` and `git diff --stat` were byte-identical to the snapshot, and 43/43 hashes matched.** This report is the only change.

#### Test Coverage

| Acceptance criterion / item | Tested? | Result | Notes |
|---|---|---|---|
| Migration `20261024` applies over `20261012`/`13`/`14`/`20`/`23` (plan table with the 20261005 CHECKs and the real onboarding trigger) | ✅ | Pass | PGlite, a QA harness written independently of Dev's: **53/53** |
| Pre-check `0,0` → `1,2`; 5b checker **L01–L13 (+L04a/b, L08a/b) all PASS, VERDICT PASS 15/0**; 5a and Slice 0 checkers PASS | ✅ | Pass | Row by row: VERDICT, L01, L02, L03, L04a, L04b, L05, L06, L07, L08a, L08b, L09, L10, L11, L12, L13 = PASS |
| L2 under a champion with no lineage (parent = root = champion) | ✅ | Pass | |
| L2 under an L1 champion (root = the L1) | ✅ | Pass | |
| L3 under an L2 (root = the L2's root); also L4 under an L3 | ✅ | Pass | The level rule generalises |
| No-basis plan row (`cohort`/`tier` NULL, `origin = invite`); invite burned to the friend | ✅ | Pass | |
| `already_finalised` is idempotent (called twice, no duplicate rows); for another account → `not_matched` | ✅ | Pass | |
| `issuer_not_eligible`: lapsed champion, issuer on trial, issuer with no plan row, wrong cohort parameter; nothing written, invite unburned | ✅ | Pass | |
| `not_matched`: wrong tier, email (including case), account; revoked (no raise); admin invite, both pending **and** redeemed (R-6) | ✅ | Pass | "Wrong cohort" as a grant cannot reach the RPC: an account-issued cohort-grant row is refused by the table CHECK (verified). A wrong *issuer* cohort parameter gives `issuer_not_eligible` by design |
| Pre-existing plan row → abort, invite unburned, trial row untouched; the same for a pre-existing lineage row | ✅ | Pass | Plain INSERTs |
| `service_role`: no UPDATE and no DELETE on lineage; `anon`/`authenticated`: no EXECUTE and no lineage SELECT; the paired CHECK refuses half a milestone | ✅ | Pass | |
| AC-18: onboarding messages fill `onboarding_started_at`, `cohort`/`tier` stay NULL | ✅ | Pass | Two messages |
| Rollback: pre-check `0` paid rows → `0,0`; 5b checker FAIL; 5a + Slice 0 PASS; lineage rows kept; re-apply works; a second paste fails and changes nothing | ✅ | Pass | |
| Touched suites | ✅ | Pass | 46 suites, 1,217 tests |
| `npm run test:authz-guard` | ✅ | Pass | 119/119 |
| `npm run test:bos-entitlements` (the diff imports from `entitlements/`) | ✅ | Pass | 98 suites, 2,058 tests |
| Every `guard`/`forbidden`/`invariant`/`eventAudience` suite | ✅ | Pass | 49 suites, 1,144 tests |
| `npm run lint:hooks`; `console.*` in new files | ✅ | Pass | Exit 0; 0 calls |
| **Decoy parity, route level** (real code + complete routes): 7 code requests (200, cooldown 429, four 200s after the cooldown, cap 429) + a wrong-code complete | ✅ | Pass | Existing account vs new address: status, body, log lines (level, message, keys), send/attempt counters and both 429s identical. Only the email differs: the code vs the notice |
| R-5 notice: system sender (no `from`/`replyTo`/`ownerUserId`), `transactional`, `redactRecipientInLogs`; no code, token, hash, invite link, `#t=`, champion name, issuer id or invite id; the only href is `/login`; the "ignore" line; the invite's language (he, `dir="rtl"`) | ✅ | Pass | |
| **Malformed `NEXT_PUBLIC_MARKETING_URL`** → `{ sent: false }` and **no distinguishable response** | ✅ | **Fail** | **QA-1**: `{ sent: false }` holds, but the answer is distinguishable |
| `emailHasAccount` error → 503 whatever the address | ✅ | Pass | |
| **Account question only after mailbox proof**: code route after the CAS store, never on a 429; complete: never on a wrong code, after the attempt count on the right one, 409 before any claim or create; Google: after the verifier, never on a refused proof, 409 before the claim | ✅ | Pass | |
| **Both methods** reach `finaliseFriend` (config tier and cohort, never the champion finalise) and land on `/invite/awaiting-payment`; the audit carries `source: account_invite` and `method` | ✅ | Pass | |
| Switch off → code, complete and Google all 409 `unavailable`, with no email, store, claim, account lookup or verifier call; lapsed issuer → `unavailable` before any email | ✅ | Pass | |
| **Switch stays false** | ✅ | Pass | `config/invites.ts:117` `false as boolean`, file not in the diff, pinned by `inviteConfig.invariant.test.ts:109`. Forced on **only in the probe process** for the end-to-end run |
| No email, token, hash, code, password, `issuer_account_id`, ID token or nonce in any response, log or audit (password, Google and existing-account flows) | ✅ | Pass | The one exception is by design: the complete route's own success body carries the email (1b F-6) |
| **Hold gate × 4 layouts** (onboarding-chat, onboarding-build, business-os, test-business-os), with the real gate: unpaid `account_invite` → redirected, one lineage read, **no invite read** (R-3), no plan read; paid / L1 champion / no lineage / signed out → through; lineage read failure → through with an `error` log; `force-dynamic` present; the gate is the first statement; account id from `getUser()` only | ✅ | Pass | 29 cases |
| **Holding screen** with the real `readHoldForSession`: a failed or **thrown** lineage read → neutral error + Try again + Sign out, never a redirect (R-4); held → en/he/es in the invite's language (`dir="rtl"` for he); a failed language read → still held, in English; not held → `/onboarding-chat`; signed out → sign-in link only | ✅ | Pass | 8 cases |
| **CR-1**: exactly one payment statement on a friend invite, en/he/es | ✅ | Pass | The project test (`page.render.test.tsx`, per language) kills the mutant that restores "Payment is required at signup" |

#### Mutation testing

**File mutants.** One file each; the project suites ran against the mutant; restored and hash-checked. **18/18 killed by the project's own suites.**

| # | Guarantee | Mutant | Killed by (project) |
|---|---|---|---|
| 1 | Gate keyed on `first_paid_at IS NULL` | Ignore `first_paid_at` (a paid friend stays held) | `paymentHold.test.ts` "a paid friend is not held" |
| 1b | Gate keyed on the source | Hold any unpaid lineage row (L1 champions held) | `paymentHold.test.ts` 5c case / Q-2 |
| 1c | Predicate's tier clause (5c) | `admin_invite` + tier never held | `paymentHold.test.ts` |
| 2 | R-3 short-circuit | Read the invite first; its error releases a friend | `paymentHold.test.ts` R-3 + holding-screen language cases |
| 3a | Decoy parity | No decoy stored for an existing account (same 200) | `inviteRedemption.test.ts` decoy ×3 |
| 3b | Decoy parity | The log line carries `notice: hasAccount` | `inviteRedemption.test.ts` "both branches log the same line" (the QA probe compares keys only and would miss this one) |
| 3c | Decoy parity | An existing account answers 503 | `inviteRedemption.test.ts` "identical HTTP answer" |
| 4 | Post-proof check | Complete: the check moved before the code compare | `inviteRedemption.test.ts` ×4 |
| 4b | Post-proof check | Complete: the check skipped | `inviteRedemption.test.ts` ×2 |
| 4c | Post-proof check | Google: the check before the verifier | `inviteRedemption.test.ts` ×2 |
| 5 | `force-dynamic` | Removed from `app/test-business-os/layout.tsx` | `paymentHold.test.ts` N-2 pin |
| 5b | `force-dynamic` | Removed from `app/onboarding-build/layout.tsx` | `paymentHold.test.ts` N-2 pin |
| 5c | Gate first | Business OS layout reads the plan badge first | `paymentHold.test.ts` first-statement pin |
| 6 | Level rule | `v_level := v_parent_level` (no `+ 1`), in the file | Migration text test |
| 6b | Level rule | Root always the issuer, in the file | Migration text test |
| 7 | R-6 filter | `already_finalised` filters dropped, in the file | Migration text test (R-6) |
| 8 | CR-1 single statement | "Payment is required at signup" restored | `page.render.test.tsx` CR-1 en/he/es + paid state |
| + | Landing | `awaiting_payment` mapped to `/onboarding-chat` | `routes.test.ts` complete + Google |

**SQL behaviour mutants in PGlite** (in-memory copies of the migration text; the file untouched). **8/8 killed:** drop `revoked_at IS NULL` (L05 + a revoked row raises), drop the claimant filter (L05 + wrong account finalises), level without `+ 1` (L2 under L1 violates `level_shape`; L3 → 2; AC-18 cascades), root always the issuer (L3/L4 root), drop the R-6 filters (redeemed admin row → `already_finalised`), drop the issuer check (lapsed/trial/no-plan issuers finalise), plan `ON CONFLICT DO NOTHING` (L12 + an existing trial row no longer aborts), `GRANT UPDATE` on lineage (L08b + `service_role` can stamp).

#### Issues Found

##### Bugs (must fix before commit)

None block this commit. One bug is recorded here because it breaks a stated guarantee (F5b-3 decoy parity). It is inert while the switch is off, so the deadline is the switch-on PR, not this merge:

1. **QA-1: a malformed `NEXT_PUBLIC_MARKETING_URL` turns the friend code route into an account-existence oracle.** Files: `lib/email/templates/invite-existing-account.ts:71-73` (`safeHref` throws), `lib/business-os/invites/redemptionDeps.ts:77-98` (N-1 catch → `{ sent: false }`), `lib/business-os/invites/inviteRedemption.ts:439` (`!sent.sent` → 503). **Severity: Medium. Must fix before the switch-on PR; not a merge blocker for 5b-1**, because the switch is off and no friend invite can reach the code route.
   - Steps to reproduce (QA probe, real route + deps + template): set `NEXT_PUBLIC_MARKETING_URL` to any value without an `http(s)://` scheme (for example `agentspilot.ai`), or with a space, quote or angle bracket. Request a code on a friend invite for an address with an account, then for one without.
   - Expected (brief, and F5b-3's point): the same answer for both.
   - Actual: existing account → `503 { error: 'code_not_sent' }`, plus logs `error "Existing-account notice could not be built or sent"` and `warn "Signup code email was not sent"`. New address → `200 { codeExpiresAt, resendAvailableAt }`. This is deterministic and repeats for every address while the variable is wrong, so whoever holds the link can test addresses. N-1 made the dependency stop throwing, but did not make the answer the same. (A missing variable is safe: it falls back to a valid constant. Only a *malformed* value triggers it.)
   - Suggested direction (Dev/SA to choose): build and validate the sign-in URL once, falling back to the known marketing origin, so the notice can always be built. Or, when the notice cannot be built, answer exactly as the new-address branch does (log at `error`; the mailbox gets nothing, as with a lost email). The existing N-1 test (`redemptionDeps.test.ts:98-104`) should gain a route-level assertion that the two answers stay equal.

##### Performance Issues (should fix)

None found. The gate is one PK read per gated render for accounts without lineage, and two for L1 champions (SA already accepted this).

##### Edge Cases (nice to fix)

1. **QA-2 (Low, info):** the email transport logs the subject (`lib/notifications/emailTransport.ts:576-578`). So in **server logs** the code email and the notice have different subjects, although the redemption and route log lines are identical. Only an operator can see this, not the link holder, so it is not an oracle. Recorded so that nobody later cites "identical logs" end to end.
2. **QA-3 (Low, docs):** `lib/business-os/invites/publicInviteView.ts:40`: the header comment still says a friend's `valid` view shows "payment required". CR-1 removed that line. Fix in 5b-2.
3. **QA-4 (Low, test gap):** the project's holding-screen render test mocks `readHoldForSession` whole, so the path from a failing repository through the real gate to the error state is covered only by `paymentHold.test.ts` plus this QA probe. Optional: one render test over the real `readHoldForSession`.
4. **Observation, not a defect:** besides `paymentOpensLater`, a friend's offer box shows the access line "While the plan is paid for". It is consistent with the payment line, not contradictory, so CR-1 is met. BA may want to check the pairing when 5b-2 touches the copy.

#### Test Outputs / Logs

```text
PGlite (QA harness qa5b1.mjs): TOTAL 53 pass, 0 fail
  checker rows: VERDICT=PASS, L01..L03=PASS, L04a/b=PASS, L05..L07=PASS, L08a/b=PASS, L09..L13=PASS
  SQL mutants: drop_revoked KILLED, drop_claimant KILLED, level_no_plus_one KILLED, root_is_issuer_always KILLED,
               drop_r6_filter KILLED, drop_issuer_check KILLED, plan_on_conflict KILLED, grant_update_lineage KILLED
Touched suites:        Test Suites: 46 passed | Tests: 1217 passed
test:authz-guard:      Test Suites: 1 passed  | Tests: 119 passed
test:bos-entitlements: Test Suites: 98 passed | Tests: 2058 passed
All guard suites:      Test Suites: 49 passed | Tests: 1144 passed
lint:hooks:            exit 0
QA probe signupFlow:   14 passed, 1 failed (QA-1)
  MALFORMED_URL existing={"status":503,"body":{"success":false,"error":"code_not_sent"}}
  MALFORMED_URL fresh={"status":200,"body":{"success":true,"data":{"codeExpiresAt":"T","resendAvailableAt":"T"}}}
QA probe holdGate:     37 passed
File mutants:          18/18 killed by project suites, 18/18 restored-ok (SHA-256)
Tree vs snapshot:      status identical, diff --stat identical, 43/43 hashes OK (before this report)
```

#### Production checklist for the user

**Before merge (SQL editor, in this order; any FAIL = stop, do not merge, rollback per §11 with its pre-check first):**

| # | Step | Expected |
|---|---|---|
| P-1 | §4.1 step 1 pre-check | `0`, `0` |
| P-2 | Paste the whole `supabase/migrations/20261024_business_os_friend_invite_signup.sql` | "Success. No rows returned." |
| P-3 | Paste `scripts/check-bos-friend-invite-signup-migration.sql` | `VERDICT PASS`, **15 pass 0 fail** |
| P-4 | Paste the 5a checker `scripts/check-bos-friend-invites-migration.sql` and the Slice 0 checker `scripts/check-bos-invites-migration.sql` | Both `VERDICT PASS` |
| P-5 | Dev re-runs the live no-match probe (zero uuid, no real row) | The friend finalise RPC answers `not_matched` (no longer `PGRST202`); the lineage hold read answers `{ data: null, error: null }` (no longer `42703`) |
| P-6 | Merge 5b-1 | The switch `accountInvitesAvailable` stays `false` |

**After merge and deploy, switch OFF (§9 Part A):**

| # | Step | Expected |
|---|---|---|
| A-1 | Signed in as yourself, open `/business-os` (and a sub-page such as `/business-os/settings`), `/onboarding-chat` and `/test-business-os` | Each loads as before; nobody is sent to the holding screen |
| A-2 | Open `/invite/awaiting-payment` signed in as yourself | Redirected to `/onboarding-chat` |
| A-3 | Vercel logs for those requests | **No** `Payment hold unreadable` / `Payment hold read threw` error lines, and no `42703` |
| A-4 | If a 5a friend-invite link is still live, open it | "no longer available" |

**Note:** the real end-to-end friend demo (§9 Part B, then Part C for Google) needs the switch on. **Per SA it waits for 5b-2** (and QA-1 should be fixed before the switch-on PR).

#### Final Status

- [x] All acceptance criteria in 5b-1's scope pass — **ready for commit (PASS WITH NOTES)**. No High bug. QA-1 (Medium) is inert while the switch is off and must be fixed before switch-on, alongside CR-1's carry-over. The merge is still gated on P-1 to P-5.
- [ ] Issues found — Dev must address before commit

---

## Commit Info

*(RM to populate.)*

- **User approval (2026-10-01, in session):** "I approve committing 5b-1 and opening the PR." SA code-approved (migration `20261024` approved to paste); QA PASS WITH NOTES (QA-1 and QA-3 fixed; migration SHA-256 unchanged since QA).
- **Branch:** `feature/bos-invite-friend-5b`, rebased on `origin/main`, pushed by RM. Commits: `docs(invites)` slice 3 final status; `docs(invites)` this workplan and the test-page scope note; `feat(business-os)` 5b-1 code, migration, checker, rollback and existing-test edits; `test(business-os)` the new test files. Hashes and PR number are reported to TL by RM.
- **PR:** to `main`, opened by RM 2026-10-01, **not merged**, no auto-merge. Merge commit (not squash), only after the merge order below.

**Merge order for 5b-1 (RM; required, from SA code review 5b-1 and the §6.1 live check).** The PR may be opened before, but is **merged only after all of these, in order**:

1. The user applies `supabase/migrations/20261024_business_os_friend_invite_signup.sql` in the SQL editor (after the §4.1 pre-check returns `0, 0`).
2. `scripts/check-bos-friend-invite-signup-migration.sql` → `VERDICT PASS`, **15 pass 0 fail**.
3. The 5a checker `scripts/check-bos-friend-invites-migration.sql` and the Slice 0 checker `scripts/check-bos-invites-migration.sql` → both `VERDICT PASS`.
4. Dev re-runs the live no-match probe (zero uuid, no real row): the friend finalise RPC answers `not_matched` (no longer `PGRST202`), and the lineage hold read answers `{ data: null, error: null }` (no longer `42703`).
5. Merge. The switch `accountInvitesAvailable` stays `false`.

Any FAIL at steps 2–4: stop, do not merge; rollback per §11 (pre-check first).

---

## Change History

| Date | Change | Details |
|------|--------|---------|
| 2026-09-30 | Created (Dev) | Slice 5b workplan against `origin/main` `de4b31f2`: migration `20261024` (the friend finalise per T-19, and the lineage `first_paid_at` / `first_payment_ref` columns); an explicit friend branch in redemption for both signup methods; the existing-account check moved after mailbox proof with a decoy code and a "sign in instead" email (F5b-3); a no-basis plan row plus a lineage-keyed page gate in the onboarding and Business OS layouts, landing on `/invite/awaiting-payment` (T-13, F5b-4); N-4 by not auditing `not_eligible`; revoke 409 "already used"; admin parent; T-9 as a switch-on precondition. Questions Q-1 to Q-8 for SA. |
| 2026-09-30 | SA workplan review | Approved with conditions. Rulings on Q-1 to Q-8. R-1 to R-11, of which R-1 (High) gates `/onboarding-build`, which middleware skips and which writes a completed profile. Recommends the §12 fallback split (5b-1 / 5b-2). No user decision. |
| 2026-10-01 | 5b-1 implemented (Dev), uncommitted; R-1 to R-11 folded in | Status, D-7 (R-3), D-8 (four layouts, R-1/R-2), D-10 (R-4), §3 rows, §4 as-built note (R-6, `lock_timeout`), checker rows L12/L13 (R-7), §6 split and ✅ for 5b-1, new §6.1 implementation record (R-items, 8 deviations, checks: touched suites 1,523/1,523, bos-entitlements 2,058/2,058, authz-guard 119/119, full Jest failing list identical to baseline, `next build` exit 0, PGlite 37/37 with checker 15/15, live no-match showing `20261024` not yet applied), §9 B-4 and the R-9 trigger listing, §10 R-8(c) and the R-10 bullet, §11 R-11 paragraph, §12 the two-PR ruling, §14 note. Lines only added or replaced in place. 5b-2 not started. |
| 2026-10-01 | SA code review 5b-1 | ✅ Code Approved for QA. No blockers, nothing to fix before merge. CR-1 (the invite page shows "Payment is required at signup" next to "Payment opens soon") must be fixed in 5b-2 before switch-on. N-1 to N-6 are Low. `20261024` approved to paste; merge only after it is applied and its checker PASSes. SA reran: touched suites 1,127/1,127, bos-entitlements 2,058/2,058, authz-guard 119/119, all guard suites 1,156/1,156, lint:hooks clean, tsc clean on touched files, `next build` exit 0 with every gated page dynamic. |
| 2026-10-01 | SA code review 5b-1 fixes (Dev) | CR-1: the invite page no longer shows "Payment is required at signup" (the paid `valid` offer in 5b is always a friend invite while payment is not live), so a friend sees exactly one payment statement, `paymentOpensLater`, in en/he/es; render test per language; the 1b paid-state test updated to match; `paymentRequired` kept in the copy for 5c. N-1: the notice send never throws (a malformed marketing URL is `{ sent: false }`, logged); test. N-2: `export const dynamic = 'force-dynamic'` on the four gated layouts; pinned. N-3: `issuerPlans` gets only `findEntitlementInputs`; test. N-4: the double blank line. N-5: the rollback pre-check SQL in §11. Commit Info: the explicit merge order for RM. Migration SQL unchanged. |
| 2026-10-01 | QA Report 5b-1 | PASS WITH NOTES. PGlite 53/53 (checker 15/0, every outcome, L2/L3/L4, R-6, AC-18, grants, rollback); touched suites 1,217, authz-guard 119, bos-entitlements 2,058, guards 1,144, lint:hooks clean; route-level decoy parity, post-proof check, both methods, gate ×4 layouts and holding screen probed; 18/18 file mutants and 8/8 SQL mutants killed. QA-1 (Medium, before switch-on): a malformed `NEXT_PUBLIC_MARKETING_URL` makes the friend code route answer 503 for an existing account vs 200 for a new one. QA-2 to QA-4 Low. User's production checklist added. |
| 2026-10-01 | QA fixes QA-1 and QA-3 (Dev) | QA-1: the existing-account branch of the friend code route answers exactly like a new address's success whether or not the notice was sent (the failure is logged at warn, no address); the notice template never throws and drops the link for an unusable URL; a route-level test proves byte-identical answers with a malformed marketing URL (registered in two repository-caller guards as a test file). QA-3: the stale public-view comment. Recorded in §6.1. Migration SQL unchanged. |
| 2026-10-01 | User approved the commit and PR; committed, PR opened (RM) | User: "I approve committing 5b-1 and opening the PR." RM committed 5b-1 on `feature/bos-invite-friend-5b` (docs, feat, test), pushed and opened the PR to `main`, not merged. Commit Info updated; the merge stays gated on the merge order there. |
