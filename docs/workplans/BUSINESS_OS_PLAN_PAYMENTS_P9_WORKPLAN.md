# Workplan: Business OS Plan Payments, P-9 (Admin Paid invites)

> **Last Updated**: 2026-10-14

**Developer:** Dev
**Requirement:** [BUSINESS_OS_PLAN_PAYMENTS_REQUIREMENT.md](/docs/requirements/BUSINESS_OS_PLAN_PAYMENTS_REQUIREMENT.md): §9.1 P-9 row; **F3**; §9.1.1 (D5-3, G5-12, G5-14, the P-3a/P-3b "already built" table: "a held admin invitee is refused until P-9"); §9.3 (20261029); §9.5 row 17; SA-P9, SA-P11; **SA Review — P-5 scoping** S5-1, S5-2, **S5-7**, P5-N1; AC-F3.1; BQ-14 / FR-30 (friends only; an admin Paid invite may sell either tier).
**Invite requirement:** [BUSINESS_OS_INVITE_SIGNUP_REQUIREMENT.md](/docs/requirements/BUSINESS_OS_INVITE_SIGNUP_REQUIREMENT.md): **FR-22** to FR-26, FR-24 (held, no time limit), FR-13, F5c-3, F5c-4, §7.10 FR-39 to FR-43 (N-1 to the issuing admin; N-2 champion-only), BQ-3, BQ-8, T-13, GR-1, GR-3, C-6.
**Depends on:** P-5a merged (P-5a.1 #314 with 20261028 applied to production; P-5a.2 #327). P-5b is not needed, but P-5b.2 (#363) is now on `main` and gives the admin list its "Signed up, not paid" and paid line for free (§1.3).
**Date:** 2026-10-14
**Branch:** `feature/bos-plan-payments-p9`, worktree `neuronforge-invite-s1`, cut from `origin/main` `396cafa6` (#362). Confirmed with `git branch --show-current` on 2026-10-14. `origin/main` has since moved to `096f86e0` (#363, P-5b.2, 5 commits); it is merged in at T0 (RM's call, never a rebase or a stash).
**Status:** SA APPROVED WITH CONDITIONS C-1 to C-12 (2026-10-14). Two PRs, P-9.1 first. **P-9.1 MERGED (#373, 2026-10-14); 20261029 APPLIED to production 2026-10-14** (G-2: pre-check PASS 7/0, checker PASS 7/0 with C3 `576c2e80149a372d7cc1dce490e0de4f`, PROBE PASS F01 to F10 and F12, F11 PASS). G-6 answered YES (2026-10-14): T10 is in P-9.2. **P-9.2 Code Complete (2026-10-14)** on `feature/bos-plan-payments-p9-2` (worktree `neuronforge-invite-s1`, fresh from `origin/main` `392a9b53`; confirmed with `git branch --show-current`), uncommitted, awaiting SA code review.

## Overview

Today an admin can choose "Paid" with Essentials or Autopilot on the invite form only while `paidInvitesAvailable` is on, and even then the invitee is refused at signup (`inviteRedemption.ts:330`, `paid_invites_not_available`), and a held admin invitee would be refused at checkout (`heldPaymentOffer` returns `held_tier_unresolved` for `admin_invite`). P-9 closes both gaps, so F3 works end to end:

1. **Signup.** An admin-issued Paid invite is redeemable (code or Google) while `paidInvitesAvailable` is on. A new SQL finalise writes the plan row with **no basis** and the lineage at **L1 / `admin_invite`**, as SA-P9 ruled. The invitee lands on the holding screen, never onboarding. The issuing admin gets N-1 ("Signed up — not subscribed yet"), which already works for admins.
2. **Pay.** `heldPaymentOffer` offers an admin invitee **the tier the admin chose**, read server-side from the invite row through the hold, never from the client. The holding screen shows that plan and its price and Pay; the held checkout admits exactly that tier.
3. **Get in.** Nothing new: the P-3b/P-5a apply function assigns the bought tier, stamps `first_paid_at`, and the hold releases on the next page load. AC-F3.1: an Autopilot invitee lands in onboarding at L1 with `pro`.
4. **Invite page (FR-22).** A Paid invite says "Payment is required at signup" when payment is actually open, and "Payment opens soon" otherwise, decided on the server from the same switches as the Pay button. An admin Paid invite that cannot be redeemed (switch off) reads "no longer available", matching the signup refusal.
5. **Admin form.** The Paid plans offered are those that can actually be paid (a Stripe price exists), each with its monthly price, and a one-line note that the invitee pays at signup.

**One migration, 20261029** (a new function; nothing replaced, no table, no column). It is still free, and sorting before 20261030+ is safe (§11).

**Production after merge:** inert. `paidInvitesAvailable` stays `false`, so the form keeps Paid disabled, the new redemption branch refuses at its first line, and the invite page answers "unavailable" for any admin Paid invite. §9.5 row 17 (switch on, after P-9 merges) is what turns F3 on.

**Size ≈ 3.2 dev-days** (≈ 3.8 if the business question in §14 is answered yes). **Split proposed** into **P-9.1 "Admin invitee signs up and is held"** (≈ 1.75d) and **P-9.2 "Admin invitee pays and gets in"** (≈ 1.45d, or ≈ 2.05d with N-2 to the admin), never stacked (§10).

---

## Table of Contents

1. [Analysis Summary](#1-analysis-summary)
2. [Scope](#2-scope)
3. [Implementation Approach](#3-implementation-approach)
4. [Files to Create / Modify](#4-files-to-create--modify)
5. [Gates](#5-gates)
6. [Task List](#6-task-list)
7. [Tests](#7-tests)
8. [Demo Plan](#8-demo-plan)
9. [i18n and RTL](#9-i18n-and-rtl)
10. [Sizing and Split](#10-sizing-and-split)
11. [Migration Plan](#11-migration-plan)
12. [Risks](#12-risks)
13. [Rollout and Rollback](#13-rollout-and-rollback)
14. [Open Points for SA, and One Business Question](#14-open-points-for-sa-and-one-business-question)
15. [SA Review Notes](#sa-review-notes)
16. [Implementation Notes (P-9.1)](#implementation-notes-p-91)
17. [QA Testing Report](#qa-testing-report)
18. [Implementation Notes (P-9.2)](#implementation-notes-p-92)
19. [Commit Info](#commit-info)
20. [Change History](#change-history)

---

## 1. Analysis Summary

### 1.1 What exists (as-built, `origin/main` `096f86e0`)

| Area | As built | What P-9 needs |
|---|---|---|
| **Admin issuance** (`adminInviteOps.ts`, `config/invites.ts`) | `INVITE_TYPES.paid` = `grantKind: 'tier'`, `grantIds: TIER_ORDER` (`basic`, `pro`), default `TIER_ORDER[0]`. `refusalFor` refuses a tier type while `paidInvitesAvailable` is false (form option disabled with "available when payments are live"; create answers 409 `paid_invites_not_available`). The row stores `grant_kind = 'tier'`, `grant_id = <tier>`, `access_open_ended`/`access_months` NULL (CHECK `business_os_invites_access_shape`) | Offer only payable tiers (a Stripe price exists), show the price, and say the invitee pays at signup. **No storage change**: the tier is already on the row |
| **Invitation email** (`inviteEmail.ts:148`, `invite-invitation.ts`) | A tier invite already reads "Payment required" (en/he/es) | Nothing |
| **Public invite view** (`publicInviteView.ts`) | An admin tier invite whose grant is in config is `valid`; the page then shows `paymentOpensLater` for every non-free offer (SA CR-1 comment in `app/invite/page.tsx:180`). `copy.paymentRequired` exists in en/he/es, unrendered since 5b | FR-22: a server-decided payment statement; an admin Paid invite that redemption would refuse reads `unavailable` |
| **Redemption** (`inviteRedemption.ts`) | `issuer_kind = 'account'` → `loadFriendInvite` (5b). Otherwise **l.330: `if (row.grant_kind === 'tier') return refuse(409, 'paid_invites_not_available')`**, unconditionally (SA G5-12 / S5-7). Champion → `business_os_finalise_invite_redemption` (20261014, cohort only: `grant_kind = 'cohort'` in its WHERE) | A third branch, `admin_paid`, with its own finalise and the `awaiting_payment` landing |
| **Finalise SQL** | 20261014 champion finalise (cohort plan row, L1 lineage, `RETURNS uuid`); 20261024 friend finalise (no-basis plan row, L2+ lineage, `RETURNS TABLE (result_outcome, result_invite_id, result_level)`, keyed on `issuer_kind = 'account'` and the issuer's champion cohort) | Neither fits an admin tier invite. SA-P9: "a finalise variant for `admin_invite` with a tier grant that inserts the plan row with no tier and no cohort (`origin = 'invite'`) and lineage at L1. The tier is assigned only by the payment" → **migration 20261029** |
| **Payment hold** (`paymentHold.ts`) | Held ⇔ lineage AND `first_paid_at IS NULL` AND (`account_invite` OR `admin_invite` whose invite has `grant_kind = 'tier'`). Already covers F3 (as-built §3.3). For `admin_invite` it reads the invite by PK through `findHoldFactsById` (`grant_kind, language`) | The held result must also carry the invite's `grant_id`, so `heldPaymentOffer` can name the tier without a second read |
| **Pay predicate** (`planCheckoutEligibility.ts` `heldPaymentOffer`) | Three switches (D5-3) → friend → `INVITE_ISSUANCE_POLICY.account.grantId` if sellable, else `held_tier_unresolved`; **`admin_invite` → `held_tier_unresolved` always** (l.181) | The admin branch: the hold's `grantId` if it is a sellable tier, else `held_tier_unresolved` (fail closed) |
| **Holding screen** (`heldPaymentView.ts`, `awaiting-payment/page.tsx`, `awaitingPaymentCopy.ts`) | Generic copy ("Pay for your plan"), plan name and price from `TIER_MATRIX.presentation[offer.tier]`, invite's language | Nothing new to say (§9). One alert log when an admin invitee is stuck on `held_tier_unresolved` with every switch on |
| **Checkout** (`planCheckout.ts`) | Step 6 delegates to `planCheckoutEligibility`; a held account asking another tier gets `held_tier_not_allowed`; SR-5, BQ-P10, M-3 all apply to held accounts | Nothing: the tier list comes from `heldPaymentOffer` |
| **Apply / release** (20261028 `business_os_apply_plan_payment`, `planPaymentApply.ts`) | Assigns the paid tier, stamps `first_paid_at` for **any** lineage row on a first invoice above $0 (D5-4); N-2 runs only for `account_invite` (`bos_invite_subscribed_not_applicable` info log for `admin_invite`) | Nothing for AC-F3.1. N-2 to an admin issuer only if §14 BQ is answered yes |
| **N-1** (`inviterNotification.ts`) | Admin invites notify the ONE issuing admin (`isActiveAdmin` check); status from the landing: `awaiting_payment` → `not_subscribed_yet` (l.157: "if an admin Paid invitee is …") | Nothing: passing the `awaiting_payment` landing is enough |
| **Admin list / reports** (P-5b.2, #363) | `InvitePaymentView` (`awaiting_payment` / `paid_recorded` / …) from `isAwaitingPayment` with the invite's grant kind, so an admin Paid invitee already reads "Signed up, not paid" and then "Paid · date · amount"; `paymentHoldBatch.ts` already reads grant kinds for unpaid `admin_invite` rows | Nothing; pinned by one test each (§7) |

### 1.2 Schema verified from migrations (`business-os-schema-check`)

- `business_os_invites` (20261012, +20261013/14/20/23): `grant_kind` CHECK in (`cohort`, `tier`); `grant_id` text NOT NULL; `access_shape` CHECK makes a tier invite carry NULL access; `one_issuer` CHECK (admin ⇒ `issuer_admin_id`, account ⇒ `issuer_account_id`); `claimed_account_id`, `redeemed_at`, `redeemed_account_id` (20261014, `redeemed_by_claimant` CHECK); `revoked_at`. `service_role`: SELECT, INSERT, UPDATE.
- `business_os_account_lineage` (20261014 + 20261024): PK `account_id`, `invite_id` UNIQUE, `source` CHECK in (`admin_invite`, `account_invite`, `organic`), `level_shape` CHECK (L1 ⇔ no parent and `root_account_id = account_id`), `admin_invite_parentless` CHECK, `first_paid_at`/`first_payment_ref` paired. `service_role`: SELECT, INSERT, plus column UPDATE on the two stamp columns (20261028).
- `business_os_account_plans` (20261005): PK `user_id` → `auth.users` ON DELETE CASCADE; `tier`, `cohort` nullable; `origin` NOT NULL; `period_anchor` default `now()`. The friend finalise's no-basis insert `(user_id, origin, period_anchor, updated_at)` is the precedent (T-13 layer 1).
- **The tier an admin Paid invite sells is already stored** (`grant_kind = 'tier'`, `grant_id`). **No column or table is needed.** The only schema change is a new function.
- Highest migration on `origin/main` `096f86e0`: **20261060**. `20261029` is absent on `origin/main` and on every remote branch (checked 2026-10-14).

### 1.3 Interplay with P-5b (#363, merged after this branch was cut)

- The admin paid line and "Signed up, not paid" read `isAwaitingPayment` with the invite's grant kind, so they already cover `admin_invite` + tier. P-9 adds a test row, not code.
- N-2 (`championSubscribedNotification.ts`) is champion-only by type (`issuerKind: 'account'` for `'subscribed'`) and by the `planPaymentApply.ts` gate. An admin invitee's first payment logs `bos_invite_subscribed_not_applicable` and sends nothing. Changing that is the business question in §14.
- #363 also edited the requirement's §9.1 and Change History. This branch edits the P-9 row and appends a Change History row; the T0 merge of `origin/main` will need a trivial append-only conflict resolution (RM).

### 1.4 Platform design phase

Not V6 or plugin work; no pipeline phase is touched.

### 1.5 Findings during analysis

| # | Finding | Handling |
|---|---|---|
| A-1 | The invite page shows "Payment opens soon" for **every** paid offer, including a champion's friend once P-5a's payment is live. FR-22 ("says that payment is required at signup") covers friends as well | Fixed once in P-9.2 with one server-decided flag for both kinds (§3.5). Flagged for SA as a small scope extension (Q-5) |
| A-2 | Today `publicInviteView` answers `valid` for an admin Paid invite even while redemption refuses it, so a visitor fills the form and then reads "no longer available" | P-9.1: the view answers `unavailable` in exactly the cases redemption refuses (§3.5) |
| A-3 | `INVITE_TYPES.paid.grantIds` is `TIER_ORDER`, not "tiers with a price". Both tiers are priced today, but a future unpriced tier could be issued and leave the invitee held on "coming soon" forever | Issuance, redemption and `heldPaymentOffer` use one rule, `sellableTiers()` (§3.6, Q-3) |
| A-4 | A demo flip of `paidInvitesAvailable` on localhost writes real invite rows into the shared database | They read `unavailable` in production while the switch is off there (A-2), and the demo revokes them the same day (§8) |

---

## 2. Scope

| In | Out (and where it lives) |
|---|---|
| Redemption of an admin-issued Paid invite (code and Google), behind `paidInvitesAvailable` (C-6, S5-7) | Turning `paidInvitesAvailable` on (§9.5 row 17, a reviewed one-line PR after P-9 merges) |
| The finalise function 20261029, its four scripts and its Jest guard | Any change to the champion or friend finalise |
| The hold carries the invite's `grant_id`; `heldPaymentOffer`'s admin branch | Admin waiver for a held invitee (P-13, which comes next and covers both kinds) |
| The holding screen for an admin invitee (existing copy; one alert log) | Reminders or deletion for unpaid invitees (BQ-8) |
| FR-22 on the invite page, for admin Paid and friend invites | Discounts or perks (FR-38) |
| The admin form offers payable tiers with their price, and a payment note | Changing which tiers exist, or their prices |
| N-1 to the issuing admin (already built; pinned by test) | N-2 to the issuing admin, **unless** the user answers §14 BQ yes (then in P-9.2) |
| Tests, demo, docs | Admin list or report code (P-5b.2 already covers admin invitees) |

---

## 3. Implementation Approach

### 3.1 Migration 20261029: `business_os_finalise_admin_paid_invite_redemption` (SA-P9)

A **new** function, modelled on the friend finalise (20261024), so the live champion and friend functions are not touched:

```text
business_os_finalise_admin_paid_invite_redemption(p_invite_id uuid, p_account_id uuid, p_email text, p_tier text)
RETURNS TABLE (result_outcome text, result_invite_id uuid)
LANGUAGE plpgsql SECURITY INVOKER SET search_path = ''
```

1. `SELECT … FOR UPDATE` the invite row WHERE `id = p_invite_id AND claimed_account_id = p_account_id AND email = p_email AND issuer_kind = 'admin' AND grant_kind = 'tier' AND grant_id = p_tier AND redeemed_at IS NULL AND revoked_at IS NULL`.
2. Not found → `already_finalised` when the row is redeemed by this account **and** a lineage row `source = 'admin_invite'` with this invite id exists (join, as 20261024); otherwise `not_matched`.
3. Found → burn (`redeemed_at = now()`, `redeemed_account_id = p_account_id`, `updated_at`); INSERT the plan row `(user_id, origin, period_anchor, updated_at)` with `origin = 'invite'` and **no tier, no cohort** (the tier is assigned only by the payment, SA-P9; T-13 layer 1 so the onboarding and profile triggers can never mint a trial); INSERT lineage `(account_id, invite_id, source, parent_account_id, root_account_id, level)` = `(p_account_id, p_invite_id, 'admin_invite', NULL, p_account_id, 1)`; return `finalised`.
4. `p_tier` comes from the row (TypeScript passes `row.grant_id` after checking it is a sellable tier); the SQL holds no plan name (L-5). It is a compare-and-set on the shape TypeScript validated, as the friend function does with `p_tier`.
5. COMMENT; REVOKE ALL from PUBLIC, anon, authenticated, service_role; GRANT EXECUTE to service_role; `NOTIFY pgrst, 'reload schema'`. One `BEGIN … COMMIT`, `SET LOCAL lock_timeout = '5s'`.

No table, column or grant on a table changes, so the test-account cleanup chain (20261047) is untouched (§9.1.1 N-2): an admin invitee's rows live in tables the cleanup already knows.

### 3.2 Repository

`BusinessOsAccountPlanRepository.provisionFromAdminPaidInvite({ inviteId, accountId, email, tierId })` → `RepositoryResult<AdminPaidFinaliseOutcome>` where the outcome is `{ outcome: 'finalised' | 'already_finalised'; inviteId }` or `{ outcome: 'not_matched' }`; an unknown answer or a DB error is scrubbed `{ code, message }` (M-1), as `provisionFromFriendInvite`. Listed in the entitlements imports guard's `WRITE_METHODS` and `INVITE_REDEMPTION_WRITES` beside the other two finalise methods. Its doc comment carries the same "documented exception to R2-3" note as the friend method.

`BusinessOsInviteRepository.findHoldFactsById` selects `grant_kind, grant_id, language` (was `grant_kind, language`); `BusinessOsInviteHoldFacts` gains `grant_id: string`. Same one-row PK read, same caller (the invite id comes from the session account's own lineage row), so the tenant-isolation note in the repository header is unchanged apart from "three facts".

### 3.3 Redemption (`inviteRedemption.ts`)

`RedemptionKind` becomes `'champion' | 'friend' | 'admin_paid'`. In `loadRedeemableInvite`, l.330 becomes `if (row.grant_kind === 'tier') return loadAdminPaidInvite(row, deps, now, options)`:

| Order | Check | Refusal |
|---|---|---|
| 1 | `INVITE_ISSUANCE_POLICY.paidInvitesAvailable` (C-6; the one switch, S5-7) | 409 `paid_invites_not_available` (unchanged answer while off) |
| 2 | `row.issuer_kind === 'admin'`, `row.invite_type === PAID_INVITE_TYPE`, `INVITE_ISSUANCE_POLICY.admin.includes(PAID_INVITE_TYPE)`, `isInviteGrantAvailable(config, row)`, and `sellableTiers()` includes `row.grant_id` | 409 `unavailable` |
| 3 | The existing-account check **before any code**, the champion's 1b order: the admin holds the address, so there is no oracle to protect (unlike F5b-3); I-6's stale-claim exception kept | 409 `existing_account` / try again |

`finish` gains `if (kind === 'admin_paid') return finishAdminPaid(…)`: `deps.finaliseAdminPaid({ inviteId, accountId, email: row.email, tierId: row.grant_id })`, retried once (I-5); `not_matched` or an error twice → `stopWithClaimKept` (FR-12a) and try again. On success: `BOS_INVITE_REDEEMED` `{ inviteType, level: 1, source: 'admin_invite', method }` and `BOS_INVITE_PLAN_PROVISIONED` `{ grantKind, grantId, basis: 'none', awaitingPayment: true, origin: 'invite' }` (the friend's shape; no new audit key); log `Admin Paid invite redeemed; account held until payment`; landing **`awaiting_payment`**; `notifyInviterSafely(row, 'awaiting_payment', deps)`, so the issuing admin's N-1 reads "Signed up — not subscribed yet". The code path and the Google path reach it through the shared `createAndFinish`, so I-1 to I-6 hold by construction. `RedemptionDeps.finaliseAdminPaid` is wired in `redemptionDeps.ts` to the new repository method. The public routes already map `landing` to a path (`REDEMPTION_LANDING_PATHS`), so no route changes.

### 3.4 Hold and the Pay predicate (SA S5-2, SA-P11)

- `paymentHold.ts`: the held variant gains `grantId: string | null`: `null` for `account_invite` (the R-3 short circuit still never reads the invite), the invite's `grant_id` for `admin_invite`. `isAwaitingPayment` and the not-held answers are unchanged; the gate still reads only `held`. The module keeps importing nothing from the entitlements module.
- `heldPaymentOffer` (`planCheckoutEligibility.ts`), admin branch: `const tier = sellableTiers().find((candidate) => candidate === hold.grantId)` → `{ kind: 'pay', tier }`, else `held_tier_unresolved`. Still after the three-switch check (D5-3). No tier literal; the file's registered symbols do not change.
- Because the holding screen and the checkout already call this one function, the screen offers Pay for the invited plan exactly when the checkout admits that plan (P5-C5). A held admin invitee asking any other tier gets `held_tier_not_allowed` (unchanged code).
- `heldPaymentView.ts`: when the offer is `held_tier_unresolved` while all three switches are on, log `error` with `alert: true` (`bos_billing_held_tier_unresolved`, account id and source only): an invitee is held with nothing they can buy. The screen still shows "coming soon".

### 3.5 Invite page (FR-22)

`viewInviteByToken`:

- An admin-issued tier invite (`issuer_kind = 'admin'`, `grant_kind = 'tier'`) answers `unavailable` in exactly the cases §3.3 rows 1 and 2 refuse, through one shared predicate `adminPaidInviteRedeemable(row, config)` exported from `inviteRedemption.ts`'s neighbour `inviteOffer.ts` (so view and redemption cannot drift). The existing-account check then runs as for a champion.
- The `valid` response gains `payment: 'none' | 'required' | 'opens_later'`, decided here: `none` for a free offer; for a tier offer `required` when `readHeldPaymentSwitches()` reports all three switches on, else `opens_later`. Injectable switches for tests. For a friend invite this replaces the page's unconditional `paymentOpensLater` (A-1).
- `app/invite/page.tsx`: renders `copy.paymentRequiredAtSignup` for `required` (`data-testid="invite-payment-required"`), the existing `paymentOpensLater` for `opens_later`, nothing for `none`. The SA CR-1 comment is replaced by a pointer to this rule. The unused 5b key `paymentRequired` is removed in favour of the new key (§9), or kept if SA prefers no key churn.

### 3.6 Admin issuance (`adminInviteOps.ts`)

- `buildInviteFormOptions`: the Paid type's `grants` are `sellableTiers()` (in tier order, default the first), each labelled `"<plan label> · $<price> a month"` from `TIER_MATRIX.presentation[tier].monthlyPriceUsd` (new registered symbol, Q-8). The option gains `note: 'The invitee pays this plan at signup and cannot use AgentPilot until they have paid.'` (English, admin surface; the form renders it under the plan select).
- `createInviteForAdmin`: a Paid grant that is not in `sellableTiers()` → 409 `grant_not_available` (existing code and message), after the C-6 refusal and before any write.
- The page stays a thin renderer of the GET payload (it imports nothing from the invites or entitlements modules); only `CreateInviteForm.tsx` renders `note`. The shared admin layout (L-6, LF-3a drawer) is unchanged.

### 3.7 Entitlements registration (`business-os-entitlements`, SR-17)

| File | Change in imports from `lib/business-os/entitlements/` | Registry |
|---|---|---|
| `inviteRedemption.ts` | `+ PAID_INVITE_TYPE` | Symbols updated; `why` gains "and an admin Paid invite's shape (P-9)" |
| `adminInviteOps.ts` | `+ TIER_MATRIX` (price in the grant label) | Symbols updated; `why` gains the display-only price |
| `inviteOffer.ts` | none new (`INVITE_TYPES`, `EntitlementConfig` already), unless the shared predicate needs `INVITE_ISSUANCE_POLICY` / `PAID_INVITE_TYPE` → then registered with exact symbols | As needed |
| `publicInviteView.ts`, `planCheckoutEligibility.ts`, `heldPaymentView.ts`, `paymentHold.ts` | none new (`sellableTiers` and `readHeldPaymentSwitches` come from `lib/business-os/billing/`) | Unchanged |

No tier or cohort literal is written outside `config/`. `npm run test:bos-entitlements` is run and reported before each SA code review (G-4).

### 3.8 Tenant isolation (`tenant-isolation-guard`)

- Redemption is service-role with a caller-supplied token: the ownership oracle stays the token hash plus the email lock; every write keys on the matched row id **and** values observed on it (the finalise's WHERE repeats `claimed_account_id`, `email`, `issuer_kind`, `grant_kind`, `grant_id`, not redeemed, not revoked). The account id is server-generated (I-3). The request still supplies only token + code + password (or token + ID token + nonce), under the routes' `.strict()` schemas.
- The tier the invitee may buy is read from the invite named by the **session account's own lineage row**; the client never chooses it (SA-P9). The checkout refuses any other tier.
- The admin routes keep `requireAdmin` as their first statement; no new admin route.

### 3.9 Logging and audit

Pino via `createLogger`, context first; ids only, never an email, token or code. No new audit key: `BOS_INVITE_REDEEMED`, `BOS_INVITE_PLAN_PROVISIONED`, `BOS_INVITE_REDEMPTION_INCOMPLETE`, N-1's notified/not-notified and the payment events are reused. The redemption routes already flush their queued entries before answering (WC-7).

---

## 4. Files to Create / Modify

| File | Action | Reason | Slice |
|---|---|---|---|
| `supabase/migrations/20261029_business_os_admin_paid_invite_finalise.sql` | create | §3.1 | .1 |
| `scripts/precheck-bos-admin-paid-invite-finalise-migration.sql` | create | §11 pre-check | .1 |
| `scripts/check-bos-admin-paid-invite-finalise-migration.sql` | create | §11 checker | .1 |
| `scripts/probe-bos-admin-paid-invite-finalise.sql` | create | §11 rolled-back probe | .1 |
| `supabase/SQL Scripts/20261029_business_os_admin_paid_invite_finalise_rollback.sql` | create | §11 rollback | .1 |
| `supabase/migrations/__tests__/business-os-admin-paid-invite-finalise.migration.test.ts` | create | File-level guard (paste rules, privileges, invoker, WHERE filters, no plan name, checker/rollback match) | .1 |
| `lib/repositories/BusinessOsAccountPlanRepository.ts` (+ test) | modify | `provisionFromAdminPaidInvite` | .1 |
| `lib/repositories/types.ts` | modify | `AdminPaidFinaliseOutcome`; `BusinessOsInviteHoldFacts.grant_id` (.2) | .1/.2 |
| `lib/repositories/__tests__/businessOsEntitlements.imports.guard.test.ts` | modify | `WRITE_METHODS`, `INVITE_REDEMPTION_WRITES` | .1 |
| `lib/business-os/invites/inviteRedemption.ts` (+ tests) | modify | §3.3 | .1 |
| `lib/business-os/invites/redemptionDeps.ts` (+ test) | modify | wire `finaliseAdminPaid` | .1 |
| `lib/business-os/invites/inviteOffer.ts` (+ test) | modify | shared `adminPaidInviteRedeemable` | .1 |
| `lib/business-os/invites/publicInviteView.ts` (+ test) | modify | `unavailable` while not redeemable (.1); `payment` flag (.2) | .1/.2 |
| `lib/business-os/entitlements/__tests__/enforcementPoints.test.ts` | modify | registry symbols (§3.7) | .1/.2 |
| `lib/business-os/entitlements/config/invites.ts` | modify | comments only: what P-9 made true; still `false` | .1 |
| `lib/repositories/BusinessOsInviteRepository.ts` (+ test) | modify | `findHoldFactsById` selects `grant_id` | .2 |
| `lib/business-os/invites/paymentHold.ts` (+ test) | modify | `grantId` on the held result | .2 |
| `lib/business-os/billing/planCheckoutEligibility.ts` (+ tests) | modify | admin branch of `heldPaymentOffer`; comments | .2 |
| `lib/business-os/billing/heldPaymentView.ts` (+ test) | modify | alert on stuck `held_tier_unresolved` | .2 |
| `lib/business-os/billing/__tests__/planCheckout*.test.ts` | modify | admin invitee admitted for its tier only | .2 |
| `app/invite/page.tsx`, `app/invite/invitePageCopy.ts` (+ render tests) | modify | FR-22 statement, new key en/he/es | .2 |
| `app/invite/__tests__/awaitingPayment.render.test.tsx` | modify | admin invitee: Autopilot, $129, Pay | .2 |
| `lib/business-os/invites/adminInviteOps.ts` (+ test) | modify | §3.6 | .2 |
| `app/admin/business-os-invites/components/CreateInviteForm.tsx`, `types.ts` (+ render test) | modify | render `note` | .2 |
| `docs/requirements/BUSINESS_OS_PLAN_PAYMENTS_REQUIREMENT.md` | modify | P-9 row, §9.3 row, Change History (Edit only) | both |
| `docs/requirements/BUSINESS_OS_INVITE_SIGNUP_REQUIREMENT.md` | modify | §0 status line for 5c / P-9 (Edit only) | .2 |
| *(only if §14 BQ = yes)* `lib/business-os/invites/inviterNotification.ts`, `championSubscribedNotification.ts` (rename not required), `lib/business-os/billing/planPaymentApply.ts`, `lib/email/templates/invite-accepted.ts` (+ tests) | modify | N-2 to the issuing admin | .2 |

---

## 5. Gates

| # | Gate | When |
|---|---|---|
| G-1 | SA approves this workplan and rules on the split and Q-1 to Q-10 | Before T1 |
| G-2 | **20261029 applied to production** by the user: pre-check VERDICT PASS, migration, checker VERDICT PASS, probe PROBE PASS on a test account, nothing left behind (precedent P5-C2) | Before P-9.1 merges |
| G-3 | The user approves the he/es draft of the one new invite-page line (§9) | Before P-9.2 merges |
| G-4 | `npm run test:bos-entitlements` green and recorded | Before each SA code review |
| G-5 | Demo run (§8), or the user waives it | Before each merge |
| G-6 | The user answers §14 BQ (N-2 to the issuing admin) | Before P-9.2 starts. **Answered 2026-10-14: YES** (requirement BQ-P11, §10.5): T10 is built in P-9.2 |

---

## 6. Task List

| # | Task | Est. | Slice |
|---|---|---|---|
| ⚠️ T0 | Merge `origin/main` (`096f86e0`, #363) into the branch (RM's call; append-only conflict in the requirement's Change History). Re-check that `20261029` is free and the highest number. Baseline: `npm test -- lib/business-os/invites lib/business-os/billing app/invite app/admin/business-os-invites`, `npm run test:bos-entitlements` | 0.1d | .1 |
| ✅ T1 | Migration 20261029 + pre-check, checker, probe, rollback (§11), run on a local PGlite (pre-check, migration, checker, probe, rollback, checker again); Jest file guard | 0.8d | .1 |
| ✅ T2 | `provisionFromAdminPaidInvite` + types + guard lists + repository tests (finalised, already_finalised, not_matched, unknown answer, DB error scrubbed) | 0.25d | .1 |
| ✅ T3 | Redemption `admin_paid` branch, `finishAdminPaid`, deps wiring, shared `adminPaidInviteRedeemable`, public view `unavailable` (A-2); tests (§7) | 0.5d | .1 |
| ✅ T4 | Comments in `config/invites.ts`; registry update (§3.7); P-9.1 docs; full suites, typecheck, lint | 0.1d | .1 |
| ✅ T5 | Hold `grantId` (repository select, type, `readPaymentHold`), `heldPaymentOffer` admin branch, held-view alert; switch-matrix parity test extended to admin invitees; checkout tests | 0.4d | .2 |
| ✅ T6 | FR-22: `payment` flag in the view, page rendering, new copy key en/he/es (drafts), render tests (en, he RTL, es) for admin Paid and friend | 0.35d | .2 |
| ✅ T7 | Admin form: sellable grants with price, `note`, create refusal; ops + render tests | 0.25d | .2 |
| ✅ T8 | Registry update, P-9.2 docs (both requirements), full suites, `test:bos-entitlements`, typecheck, lint | 0.15d | .2 |
| ⬜ T9 | Demo (§8) (P-9.1 and P-9.2 shares: checklists written in Implementation Notes (P-9.1) and (P-9.2); the run is TL/user's) on the standard sandbox, cleanup the same day | 0.3d | .1 0.1d / .2 0.2d |
| ✅ T10 | *(§14 BQ answered **yes** 2026-10-14: in scope for P-9.2)* N-2 to the issuing admin: allow `'subscribed'` for `issuerKind: 'admin'` with N-1's active-admin check; `planPaymentApply.ts` hands `admin_invite` first payments to the notifier; the notifier's issuer cross-check accepts an admin invite whose `redeemed_account_id` is the payer; audit shape as N-2 (`business_os_invite`, `userId: null`); en/he/es wording reused ("Subscribed"); tests | 0.6d | .2 |

**Total ≈ 3.2d** (P-9.1 ≈ 1.75d: T0 to T4 + 0.1d of T9; P-9.2 ≈ 1.45d: T5 to T8 + 0.2d of T9). **With T10 ≈ 3.8d** (P-9.2 ≈ 2.05d).

---

## 7. Tests

| Area | Cases |
|---|---|
| Migration guard (Jest, files only) | No `--` comment; no punctuation in any string literal; no "into" inside a string; SECURITY INVOKER, `search_path = ''`; REVOKE from PUBLIC/anon/authenticated/service_role, EXECUTE to service_role only; WHERE has `issuer_kind = 'admin'`, `grant_kind = 'tier'`, `grant_id = p_tier`, `claimed_account_id`, `email`, `redeemed_at IS NULL`, `revoked_at IS NULL`, `FOR UPDATE`; plan INSERT names no `tier`/`cohort` column; lineage INSERT writes `'admin_invite'`, `NULL` parent, level 1; no tier or cohort id from config appears as a literal; checker and rollback name the same signature |
| Repository | The four outcomes; argument names `p_invite_id`, `p_account_id`, `p_email`, `p_tier`; `findHoldFactsById` selects `grant_id` |
| Redemption (code and Google) | Switch off → 409 `paid_invites_not_available` before any code or claim; wrong type / account issuer / grant left config / unsellable tier → `unavailable`; existing account → `existing_account` before a code is stored; happy path → `awaiting_payment`, finalise called with `row.grant_id`, two audits with the shapes above, N-1 called with `landing: 'awaiting_payment'`; finalise fails twice → claim kept, FR-12a record, `INCOMPLETE` audit; `already_finalised` → success; champion and friend paths unchanged (existing tests stay green) |
| Public view | Admin Paid with switch off → `unavailable`; on + sellable → `valid` with `payment` per the switch matrix; friend → `required` only with all three switches on; champion → `none`; no email or id in any response (existing allow-list test extended) |
| Hold | `admin_invite` + tier → held with `grantId`; `account_invite` → `grantId: null` and the invite is still never read (R-3 pin); invite read error → `{ ok: false }` |
| `heldPaymentOffer` | Admin `basic`/`pro` → `pay` with that tier; unknown or unpriced `grantId` → `held_tier_unresolved`; any switch off → `held_payment_unavailable`; **parity test**: for every switch combination × {friend, admin basic, admin pro, admin unknown}, the screen offers Pay ⇔ the checkout admits that tier |
| Checkout | Held admin `pro` invitee asking `pro` → admitted to the session step; asking `basic` → `held_tier_not_allowed`; SR-5 and BQ-P10 unchanged |
| Holding screen | Admin `pro` invitee, Hebrew → "Autopilot" label in Hebrew, `$129` LTR inside RTL, Pay; `held_tier_unresolved` with switches on → coming soon + one alert log |
| Admin ops / form | Paid grants = sellable tiers with price label; `note` present; create of an unsellable grant → 409 `grant_not_available` with no write; Paid still disabled while the switch is off |
| N-1 | Admin Paid acceptance → the issuing admin, status `not_subscribed_yet` (existing notifier, new input) |
| Admin list (P-5b.2) | An accepted admin Paid invite whose account is unpaid → `payment.state = 'awaiting_payment'`; with a stamped lineage and a money row → `paid_recorded` |
| Entitlements | `npm run test:bos-entitlements` (registry, tier-literal guard) |

---

## 8. Demo Plan

**Prerequisites (requirement §9.1.1 N-4, N-5 as updated 2026-10-12; P5-N1).**

- The standard sandbox **`acct_1UPKR4C7KDUGYIcA`**; the key file is supplied by TL. Its webhook does not forward to production, so no endpoint pause. Events reach localhost through `stripe listen --forward-to localhost:3000/api/stripe/webhook` with its `whsec_` in `STRIPE_WEBHOOK_SECRET`.
- Locally only, **never committed**: `BUSINESS_OS_PLAN_CHECKOUT_ENABLED=true`, `BUSINESS_OS_PLAN_PRICES_ENABLED=true`, `paidInvitesAvailable: true` in the working tree (S5-7).
- 20261029 applied (G-2).
- An admin account whose mailbox the user controls (N-1 sends a real email to it), and a fresh invitee address the user controls.
- Local and production share one database: the invite, the account, the money row and the audit rows are real rows written in test mode.

| Step | Action | Expected | Slice |
|---|---|---|---|
| D1 | Admin: `/admin/business-os-invites` → New invite → Paid | Plans "Essentials · $79 a month", "Autopilot · $129 a month"; the payment note | .2 (labels) / .1 (Paid enabled) |
| D2 | Issue an **Autopilot** Paid invite, language Hebrew | Link created; invitation email says "Payment required" | .1 |
| D3 | Open the link (signed out) | Plan Autopilot, $129 per month, what it includes, "Payment is required at signup" (Hebrew, RTL) | .2 (statement) |
| D4 | Sign up with the code | Lands on the holding screen. **.1:** "Payment coming soon". **.2:** "Finish your payment", Autopilot, "$129 a month, excluding tax", Pay | .1 / .2 |
| D5 | Admin inbox | One N-1 email: the address and "Signed up — not subscribed yet" | .1 |
| D6 | Admin list | Accepted, L1, "Signed up, not paid" | .1 |
| D7 | Read-only SQL (user) | Plan row: `tier` NULL, `cohort` NULL, `origin = 'invite'`; lineage: `admin_invite`, level 1, `first_paid_at` NULL | .1 |
| D8 | Pay with `4242 4242 4242 4242` | Processing, then onboarding | .2 |
| D9 | Read-only SQL; Tiers page | Plan row `tier = 'pro'`; lineage `first_paid_at` and `first_payment_ref` set once; one `BOS_BILLING_FIRST_PAYMENT_STAMPED`; one `BOS_BILLING_INVOICE_PAID` (**AC-F3.1**) | .2 |
| D10 | Admin list | Paid · date · $129.00 USD · Test payment | .2 |
| D11 | Resend `invoice.paid` from the sandbox | `already_applied`; nothing changes (and no second email if T10) | .2 |
| D12 | Switch `paidInvitesAvailable` back to false locally; open a second, unused Paid link | Invite page: "no longer available"; a direct signup call → 409 `paid_invites_not_available` | .1 |
| D13 | Cleanup, the same day | Cancel the test subscription in the sandbox (N-4); revoke unused demo invites; revert the local flips; the test account may then go through the Danger Zone cleanup (refused while the subscription is live, PF-14) | both |

---

## 9. i18n and RTL

| Surface | New text | en | he (DRAFT, G-3) | es (DRAFT, G-3) |
|---|---|---|---|---|
| Invite page, `paymentRequiredAtSignup` | One line under a Paid offer when payment is open | Payment is required at signup. Prices exclude tax, and you can start using AgentPilot as soon as you have paid. | נדרש תשלום בעת ההרשמה. המחירים לא כוללים מס, ואפשר להתחיל להשתמש ב־AgentPilot מיד אחרי התשלום. | Se requiere el pago al registrarte. Los precios no incluyen impuestos y podrás empezar a usar AgentPilot en cuanto hayas pagado. |
| Holding screen (admin invitee) | **None.** P-5a.2's keys are invite-neutral ("Finish your payment", "Your account is ready. Pay for your plan to start using it.", "Your plan", "{price} a month, excluding tax", "Pay"); the plan name comes from `TIER_MATRIX.presentation[tier].labels[lang]`, so an Autopilot invitee reads "Autopilot" in their language | — | — | — |
| Admin form note and price label | English only (admin surface; P-5b SA Q-7 precedent) | The invitee pays this plan at signup and cannot use AgentPilot until they have paid. / "Autopilot · $129 a month" | — | — |

Hebrew is gender-neutral and right to left; the price stays in a `<bdi dir="ltr">` as on the holding screen. Each language gets a render test; the Hebrew one asserts `dir="rtl"`.

---

## 10. Sizing and Split

≈ 3.2d is above the 2–3d slice size, so two slices, each its own PR from `origin/main`, **never stacked**:

| Slice | Scope | Demo | Est. | Production after merge |
|---|---|---|---|---|
| **P-9.1 "Admin invitee signs up and is held"** | 20261029 + scripts; repository method; redemption branch; public view `unavailable`; N-1 pinned; config comments | D2, D4 (coming soon), D5, D6, D7, D12 | ≈ 1.75d | Inert: the branch refuses at its first line while the switch is off. Gate G-2 before merge |
| **P-9.2 "Admin invitee pays and gets in"** | Hold `grantId`; `heldPaymentOffer` admin branch; held-view alert; FR-22 statement (admin and friend); admin form price and note; (T10 if BQ = yes) | D1, D3, D4 (Pay), D8 to D11, AC-F3.1 | ≈ 1.45d (≈ 2.05d with T10) | Inert: every held-payment switch off |

Why this cut: P-9.1 is the database and signup half, with the only migration and its production gate; P-9.2 is the payment and display half and needs no migration. After P-9.1 alone (with the switch flipped locally) an admin invitee is held on "coming soon", the same safe state a friend was in under 5b. If SA prefers one PR, the estimate stays ≈ 3.2d.

---

## 11. Migration Plan

**Verdict: needed, and 20261029 is safe.**

| Check | Result |
|---|---|
| Needed? | **Yes.** No existing finalise can redeem an admin tier invite: 20261014's filters `grant_kind = 'cohort'`, 20261024's filters `issuer_kind = 'account'` and the issuer's champion cohort. Writing the burn, plan row and lineage from TypeScript would break the one-transaction rule (I-5) |
| Free? | `20261029` is absent on `origin/main` `096f86e0` and on every remote branch (2026-10-14). `20261028` (P-5a.1) and `20261030` (boost) exist |
| Sorting before 20261030+ safe? | **Yes.** The function depends only on `business_os_invites` (20261012/13/14), `business_os_account_lineage` (20261014/24) and `business_os_account_plans` (20261005). No migration from 20261030 to 20261060 alters a column, constraint or grant those tables give this function: 20261030 only reads the plan table; 20261041 to 20261047 are cleanup-function versions; the secdef lockdowns do not touch invoker functions, and this migration issues its own REVOKE/GRANT. The only migration with `ALTER DEFAULT PRIVILEGES` is 20261005, which sorts earlier. A fresh replay and the out-of-order production apply give the same result |
| Out-of-order apply | Precedent: 20261028 was applied to production on 2026-10-12, after 20261051. The project applies by hand in the SQL editor; if `supabase db push` is ever used it needs `--include-all` (note in the migration's runbook line, not in the SQL) |
| Cleanup chain | No table, no FK to `auth.users`: 20261047 is untouched. An admin invitee's rows are in tables the cleanup already handles (as a champion's) |

**Scripts** (all in the user's paste rules: **no `--` comments, no punctuation in string literals, never the word "into" inside a string**; results as `SELECT` rows with a final `VERDICT` line, as the 20261028 set):

| Script | Checks |
|---|---|
| Pre-check | P1 the three tables exist with the columns the function names; P2 the function does not exist yet; P3 the 20261014 and 20261024 finalise functions exist (sanity); P4 count of admin `tier` invites already redeemed (expected 0: redemption has refused them); P5 count of lineage rows `admin_invite` whose invite is a `tier` grant (expected 0); P6 count of pending admin `tier` invites (informational: demo-issued links, to revoke). VERDICT PASS when P1 to P5 hold |
| Checker | C1 function exists with the 4-argument signature and the 2-column return; C2 `prosecdef = false`; C3 `proconfig` holds `search_path=""`; C4 EXECUTE: service_role yes, anon/authenticated/PUBLIC no; C5 comment present; C6 body md5 printed and compared; C7 the champion and friend functions' md5 unchanged from their own checkers. VERDICT |
| Probe (one transaction, ending in ROLLBACK) | On a **test account id** the user supplies (the plan row FKs `auth.users`): insert an admin `tier` invite claimed for it; F01 call → `finalised`; F02 plan row has `tier` NULL, `cohort` NULL, `origin` invite; F03 lineage `admin_invite`, level 1, root = account; F04 invite burned; F05 second call → `already_finalised`; F06 wrong `p_tier` → `not_matched`; F07 revoked invite → `not_matched`; F08 cohort invite → `not_matched`; F09 account-issued tier invite → `not_matched`; F10 the hold predicate in SQL (lineage unpaid + tier grant) → held. `PROBE PASS`, then ROLLBACK; nothing left behind (F11 re-count after rollback, run separately) |
| Rollback (`supabase/SQL Scripts/`) | `DROP FUNCTION` the exact signature; `NOTIFY pgrst`. Rows already written stay valid (held accounts stay held; a payment still releases them). No refusal guard needed |

**Apply order (G-2):** pre-check → migration in a new tab → checker → probe on a test account → record the results in §9.3 of the requirement. Before P-9.1 merges. The code that calls the function is unreachable in production until §9.5 row 17, so a late apply is safe too, but the precedent (P5-C2) is kept.

---

## 12. Risks

| # | Risk | Mitigation |
|---|---|---|
| R-1 | `paidInvitesAvailable` on while a payment switch is off: an admin invitee signs up and is held on "coming soon" | The same state friends were in under 5b, with no time limit (BQ-8). §9.5 orders row 15 (payment switches) before row 17. The invite page says "Payment opens soon" in that state, not "required" (§3.5) |
| R-2 | Demo invites on the shared database | Production reads them `unavailable` while its switch is off (A-2); D13 revokes them the same day |
| R-3 | An invited tier later loses its price | Issuance and redemption refuse it; an already-held invitee sees "coming soon" and an alert fires (§3.4). P-13's waiver is the admin's way out |
| R-4 | An admin assigns a plan on the Tiers page to a held invitee | They stay held (the hold keys on `first_paid_at`), as for a friend today. P-13 is the designed release |
| R-5 | The lineage `source` for both champions and Paid invitees is `admin_invite`; anything that treats `admin_invite` as "champion" | Checked: N-2, the reports and the hold all key on the invite's grant kind or the stamp, not on `admin_invite` alone. A grep for `admin_invite` in T0 re-confirms |
| R-6 | Requirement doc conflict with #363 at the T0 merge | Append-only Change History rows; RM resolves |
| R-7 | Champion signup regresses | The champion branch and its SQL are untouched; its existing tests stay green and one new test pins that a cohort invite never reaches the Paid branch |
| R-8 | Out-of-order number confuses a future CLI push | §11 note; the project applies by hand |

---

## 13. Rollout and Rollback

**Rollout.** P-9.1 then P-9.2, each merged after its gates. Production stays inert: `paidInvitesAvailable` is false, so Paid is disabled on the form, redemption refuses, the invite page reads "unavailable", and `heldPaymentOffer` refuses. F3 goes live only at **§9.5 row 17**, a reviewed one-line PR the user decides, after P-9 has merged and after row 15. The comment in `config/invites.ts` is updated to say that P-9 has removed the unconditional refusal, so the switch now opens F3 fully.

**Rollback.** Revert the PR(s). The 20261029 rollback drops the function; nothing persisted depends on the code. An admin invitee created while F3 was on stays held until they pay (the apply function and the hold are P-5a's, unchanged) or until P-13 waives them.

---

## 14. Open Points for SA, and One Business Question

**For SA**

| # | Point | Dev's recommendation |
|---|---|---|
| Q-1 | A new finalise function vs widening the champion one (which would need DROP/CREATE of a live function, since its return type differs) | New function; nothing live is replaced |
| Q-2 | Redemption gate: `paidInvitesAvailable` only (C-6, S5-7), not the two payment env switches | Yes, as friends: held on "coming soon" if payment is not open |
| Q-3 | Which tiers an admin may sell: those with a Stripe price (`sellableTiers()`), whatever `availableToBuy` says (an admin Paid invite is sales-assisted). One rule at issuance, redemption and `heldPaymentOffer` | As stated |
| Q-4 | The tier reaches `heldPaymentOffer` as `grantId` on the held result, from the one invite read `readPaymentHold` already does (one more column, no new read, R-3 untouched) | As stated |
| Q-5 | FR-22 statement decided on the server from the three switches, applied to friend invites too (A-1) | Include; ≈ 0.1d of T6 |
| Q-6 | Keep 20261029 (§11) and apply it before P-9.1 merges (G-2) | As stated |
| Q-7 | No new audit key: reuse `BOS_INVITE_REDEEMED` / `BOS_INVITE_PLAN_PROVISIONED` with `source: 'admin_invite'`, `basis: 'none'`, `awaitingPayment: true` | As stated |
| Q-8 | Price in the admin grant label adds `TIER_MATRIX` to `adminInviteOps.ts`'s registered symbols | Accept, or drop the price from the label |
| Q-9 | Where the shared "admin Paid invite is redeemable" predicate lives (`inviteOffer.ts`) so the view and redemption cannot drift | As stated |
| Q-10 | If the BQ below is yes: N-2 to an admin reuses N-1's active-admin check and N-2's audit shape (`business_os_invite`, `userId: null`), in `planPaymentApply.ts`'s existing notifier port | As stated |

**Business question for the user (plain terms)**

> When someone you invited with an admin Paid invite pays for the first time, should the admin who sent the invite get an email saying "{email} has subscribed"?
>
> Today that email goes only to a Founding Partner about a friend they invited. Admins already get the "has joined / not subscribed yet" email at signup (you chose that on 2026-10-04), and the invites list shows "Paid" with the date and amount.
>
> **Recommended default: yes**, so the admin who sold the plan hears about the payment the same way they heard about the signup. It adds about half a day to P-9.2. If no, nothing is built and the invites list remains the place to see it.

**User decision 2026-10-14 (G-6): YES.** Recorded in the requirement as BQ-P11 (§10.5). T10 is in P-9.2 (≈ 2.05d), built per the Q-10 ruling.

---

## SA Review Notes

**Reviewed by SA — 2026-10-14**
**Status:** ✅ APPROVED WITH CONDITIONS (C-1 to C-12). Two PRs, not stacked, as proposed.

Checked against the branch (`396cafa6`) and `origin/main` `096f86e0`: `inviteRedemption.ts` (l.302-347), `paymentHold.ts`, `planCheckoutEligibility.ts` (`sellableTiers`, `buyableTiers`, `heldPaymentOffer`), `planCheckout.ts` step 6 to 8a, `config/invites.ts`, `planPresentation.ts`, the entitlements registry (`enforcementPoints.test.ts`), migrations 20261012, 20261014, 20261024, 20261030, 20261041 to 20261047 and every file from 20261030 to 20261060.

### Rulings on Q-1 to Q-10

| # | Ruling |
|---|---|
| Q-1 | **New function.** Widening the champion function would mean DROP/CREATE of a live function with a different return type for no gain. Modelling on 20261024 (`SECURITY INVOKER`, `search_path = ''`, REVOKE from PUBLIC/anon/authenticated/service_role then GRANT EXECUTE to service_role) is correct: the friend function proves service_role already holds every table privilege this body needs (SELECT … FOR UPDATE and UPDATE on invites, INSERT on plans and lineage). INVOKER is the right choice; DEFINER would only add a secdef surface the lockdown programme is removing. |
| Q-2 | **Approved.** Redemption gates on `paidInvitesAvailable` only (C-6, S5-7). Held on "coming soon" while a payment switch is off is the 5b friend state (FR-24, BQ-8) and §9.5 orders row 15 before row 17. |
| Q-3 | **Approved: `sellableTiers()` (priced), not `buyableTiers()` (priced AND `availableToBuy`).** This is exactly the P-4.1 M-1 ruling: "the held path is unchanged: there `paidInvitesAvailable` governs (D5-3)"; the friend branch already uses `sellableTiers()`. `availableToBuy` is the public self-serve shelf; an admin Paid invite is sales-assisted. BQ-P10 is not affected: a held admin invitee has a no-basis plan row, so `hasOpenEndedFreeAccess` is false, and the held checkout still runs BQ-P10 (W-3) for the edge where an admin later assigns a cohort to a held invitee (R-4; that account is refused at checkout and P-13 is the release; watch item W-1 below). The one rule must be applied identically at issuance (form + create), redemption, the public view and `heldPaymentOffer` (C-3). |
| Q-4 | **Approved**, with a type refinement (C-5): `grantId` lives only on the `admin_invite` held variant, typed `string`, not a nullable field on both. One more column on the same PK read; R-3 untouched. |
| Q-5 | **Approved** (FR-22 already covers friends; A-1 is a real defect). Condition C-6 on how `required` is decided. |
| Q-6 | **Approved: keep 20261029.** Verified: absent on `origin/main` `096f86e0` (20261028 then 20261030). Of 20261030 to 20261060 only 20261030 (reads `business_os_account_plans` in two existence checks) and the cleanup chain 20261041/42/43/46/47 name the three tables; none alters a column, constraint, grant or default privilege on them, and none of 20261044/48/49/50/51 (secdef lockdowns) or 20261054 to 60 touches these tables or issues a schema-wide function REVOKE. The cleanup function needs no new version: the invitee's lineage row is self-rooted (excluded by its `IS DISTINCT FROM` count), its plan row is tenancy-deleted as for a champion, and its redeemed invite row is "kept" as for a champion. Replay order and the out-of-order production apply converge. G-2 (applied before P-9.1 merges) stands. T0 re-confirms the number after the merge (C-12). |
| Q-7 | **Approved.** No new audit key; the friend's `BOS_INVITE_PLAN_PROVISIONED` shape with `source: 'admin_invite'` is sufficient to tell the two apart. |
| Q-8 | **Approved, but through the config-bound helper, not `TIER_MATRIX`** (C-4): `adminInviteOps.ts` already reads `planLabel(config, …)` from `planPresentation.ts`; use `planMonthlyPriceUsd(config, tier)` from the same module so label and price come from the same injected `EntitlementConfig`. Register the exact new symbol (`planMonthlyPriceUsd`) on the existing `adminInviteOps.ts` registry entry. |
| Q-9 | **Approved, extended** (C-2): the shared predicate owns rows 1 AND 2 of §3.3 and returns a reason, not a boolean, so neither caller re-derives any part of it. |
| Q-10 | **Technical approach approved only if the user says yes** to the business question; SA does not decide that question. If built: the notifier fires only on the transition that newly sets `first_paid_at` (the apply function's own "stamped" answer, never on a replay), the admin is found from the invite named by the payer's own lineage row (never from webhook metadata), and N-1's active-admin check is reused unchanged. |

### Conditions

1. **C-1 Finalise SQL (T1).** Exactly the 20261024 shape with `issuer_kind = 'admin'`: the locking SELECT repeats all eight filters (§3.1 step 1); detect not-found with `FOUND` (no issuer variable here); the `already_finalised` join also requires `done_row.issuer_kind = 'admin'`, `done_row.grant_kind = 'tier'` and `lineage_row.source = 'admin_invite'`; lineage INSERT `(p_account_id, p_invite_id, 'admin_invite', NULL, p_account_id, 1)`; plan INSERT names no `tier`/`cohort` column. COMMENT text obeys the paste rules (no punctuation, never the word "into" in any string). Checker C7 compares the champion and friend bodies' md5 to the values recorded in their own checkers.
2. **C-2 One predicate (Q-9).** `adminPaidInviteRedemption(row, config): 'ok' | 'switch_off' | 'unavailable'` (name at Dev's choice) in `inviteOffer.ts`, covering: the switch; `issuer_kind = 'admin'`; `INVITE_ISSUANCE_POLICY.admin` includes the row's type; `INVITE_TYPES[row.invite_type].grantKind === 'tier'` (GR-1: key on the type's grant kind; comparing to the imported `PAID_INVITE_TYPE` constant is acceptable as the champion branch's mirror, never a string literal); `isInviteGrantAvailable`; `sellableTiers()` includes `row.grant_id`. Redemption maps `switch_off` → 409 `paid_invites_not_available` and `unavailable` → 409 `unavailable`; the public view maps both to `unavailable`. `inviteRedemption.ts` then needs no new entitlements symbol; register on `inviteOffer.ts` exactly what it adds (`INVITE_ISSUANCE_POLICY`, and `PAID_INVITE_TYPE` only if used). A test pins that the view and redemption agree for every row shape × switch value.
3. **C-3 One tier rule.** `sellableTiers()` is the only source at issuance (form grants and the create refusal), redemption (C-2), the public view and `heldPaymentOffer`. No call site uses `buyableTiers()` or `INVITE_TYPES.paid.grantIds` for an admin Paid decision. Importing `planCheckoutEligibility.ts` into the invites modules is a new direction (invites → billing); it is acceptable because billing's import of `paymentHold` is type-only, so there is no runtime cycle. State that in the import comment, and add no other billing import to `paymentHold.ts` (its "imports nothing from entitlements" pin stays green).
4. **C-4 Price label (Q-8)** via `planMonthlyPriceUsd(config, tier)`, registry symbol updated; the admin page stays a thin renderer of the GET payload; `CreateInviteForm.tsx` only renders `note`. No new admin route; the existing `/api/admin/business-os-invites` handlers keep `requireAdmin` as their first statement (unchanged; the CI guard covers it).
5. **C-5 Hold type (Q-4).** `PaymentHold`'s held variant becomes a union: `{ source: 'account_invite'; inviteId }` | `{ source: 'admin_invite'; inviteId: string; grantId: string }`. A null or empty `grant_id` from the read is impossible by schema (NOT NULL) but must map to `{ ok: false }`, never to a held result with no tier. `heldPaymentOffer`'s admin branch: `grantId` ∈ `sellableTiers()` → `pay`, else `held_tier_unresolved`. The P5-C5 parity test covers {friend, admin basic, admin pro, admin unknown} × all eight switch combinations, asserting screen-offers-Pay ⇔ checkout-admits-that-tier and checkout-refuses-every-other-tier.
6. **C-6 FR-22 flag (Q-5).** `payment: 'required'` only when the held offer this invite would produce is `pay`: all three switches on AND the invite's tier (admin: `row.grant_id`; friend: `INVITE_ISSUANCE_POLICY.account.grantId`) is in `sellableTiers()`. Extract the pure tier-and-switches step from `heldPaymentOffer` into one exported helper and call it from both, so the invite page can never say "required" where the holding screen would say "coming soon". Switches injectable in tests.
7. **C-7 Copy: reuse, do not add.** `copy.paymentRequired` already exists in en/he/es ("Payment is required at signup.") and is exactly FR-22's sentence. Render it for `required`; do not add `paymentRequiredAtSignup`. G-3 then has nothing new to approve for the invite page and is dropped unless Dev adds other user-facing text. Update the SA CR-1 comment in `app/invite/page.tsx` to point at C-6.
8. **C-8 Redemption order.** The admin branch is reached only after the existing state and live-claim checks (l.315-321), and the switch is the branch's first check, so the off-switch answer is unchanged in production. The champion branch's code and tests are untouched; one new test pins that a cohort row never reaches the admin branch and a tier row never reaches the champion finalise (R-7).
9. **C-9 Tenant isolation (`tenant-isolation-guard`).** No request field names an account, invite or tier: the routes' `.strict()` schemas are unchanged, and a test posts an extra `tier`/`accountId` field and gets 400. The finalise is called with the server-generated account id and values read from the matched row only. The held tier comes from the session account's own lineage → invite read; `heldPaymentView` and the checkout never accept a tier from the client beyond the one they then check against `heldPaymentOffer`.
10. **C-10 Probe.** The probe inserts the admin `tier` invite with `issuer_admin_id` taken from an existing `admin_users` row (one_issuer CHECK) and a fresh 64-character `token_hash`, on the test account id the user supplies; it ends in ROLLBACK and F11 (run separately) re-counts zero. Run the full set on local PGlite before handing it to the user, and paste-rule-check it with the Jest guard.
11. **C-11 Switch row.** In P-9.1's docs edit, §9.5 row 17 reads "only after **P-9.2** has merged" (P-9.1 alone holds an admin invitee with nothing to pay). The `config/invites.ts` comment change in T4 says the same.
12. **C-12 T0.** Merge `origin/main` (RM; append-only resolution in the requirement). After it, re-list `supabase/migrations/` for `2026102[9]` and for any new file touching the three tables; record the result in §11. `npm run test:bos-entitlements` before each SA code review (G-4).

### Split decision

**Two PRs, as proposed, never stacked:** P-9.1 "Admin invitee signs up and is held" (≈ 1.75d, carries 20261029 and gate G-2) and P-9.2 "Admin invitee pays and gets in" (≈ 1.45d; ≈ 2.05d only if the user answers T10 yes). P-9.2 is cut fresh from `origin/main` after P-9.1 merges. C-1, C-2, C-8, C-9, C-10, C-11 belong to P-9.1; C-3 to C-7 to P-9.2 (C-3 starts in P-9.1 for redemption and the view). G-6 gates only T10, not the start of T5 to T8: P-9.2 may start without the answer, and T10 is added or dropped when it arrives.

### Watch items (not blocking)

- **W-1** A held invitee to whom an admin assigns a cohort on the Tiers page sees Pay but is refused at checkout (`free_access_no_end_date`, W-3). Pre-existing for friends; P-13's waiver is the designed exit. Record it in P-13's scope.
- **W-2** The `held_tier_unresolved` alert (§3.4) should carry the source and account id only, as stated; rate is naturally bounded by page loads.

### Optimisation Suggestions

- Name the repository method `provisionFromAdminPaidInvite` as proposed, but return the outcome union already used by `FriendFinaliseOutcome` minus `level` and `issuer_not_eligible` rather than a parallel type, if it reads cleanly.
- In the migration guard, reuse the 20261024 guard's helpers rather than copying them.

### Approval

[x] Workplan approved — proceed to implementation, P-9.1 first, under C-1 to C-12. The admin "subscribed" email (T10) waits for the user's answer, which TL is collecting; SA does not decide it.

---

## Implementation Notes (P-9.1)

**Dev, 2026-10-14.** Branch `feature/bos-plan-payments-p9` (confirmed with `git branch --show-current`), base `396cafa6`. Uncommitted.

### T0 and C-12

| Check | Result |
|---|---|
| Merge `origin/main` (`5e44871d`) | ⚠️ **Refused by git**: "Your local changes to `docs/requirements/BUSINESS_OS_PLAN_PAYMENTS_REQUIREMENT.md` would be overwritten". Not stashed (house rule). **Left to RM**: commit first, then merge; the requirement needs an append-only resolution (Change History, §9.1). `main` also changed `BusinessOsInviteRepository.ts` (+`findGrantKindsByIdsForAdmin`) and `types.ts` (P-5b.2 types) in hunks away from this slice's, so a clean auto-merge is expected there |
| 20261029 still free | ✅ Absent on `origin/main` `5e44871d` (20261028 then 20261030; highest 20261060) and on every remote branch (`git ls-tree` over all `origin/*`) |
| New file on `main` touching the three tables | ✅ None: `git diff HEAD origin/main -- supabase/` is empty |
| Baseline suites | Not run before the edits (the merge did not happen); every suite below is green on the final diff |

### What was built

| Area | Files |
|---|---|
| Migration (C-1) | `supabase/migrations/20261029_business_os_admin_paid_invite_finalise.sql` |
| Pre-check, checker, probe, F11 count | `scripts/precheck-bos-admin-paid-invite-finalise-migration.sql`, `scripts/check-bos-admin-paid-invite-finalise-migration.sql`, `scripts/probe-bos-admin-paid-invite-finalise.sql`, `scripts/probe-bos-admin-paid-invite-finalise-after.sql` |
| Rollback | `supabase/SQL Scripts/20261029_business_os_admin_paid_invite_finalise_rollback.sql` |
| Migration guard (Jest) | `supabase/migrations/__tests__/business-os-admin-paid-invite-finalise.migration.test.ts` (62 tests) |
| Repository (T2) | `BusinessOsAccountPlanRepository.provisionFromAdminPaidInvite`; `AdminPaidFinaliseOutcome` in `types.ts`; `WRITE_METHODS` / `INVITE_REDEMPTION_WRITES` in the imports guard |
| Shared predicate (C-2) | `adminPaidInviteRedemption(row, config): 'ok' \| 'switch_off' \| 'unavailable'` in `inviteOffer.ts` |
| Redemption (T3, C-8) | `inviteRedemption.ts`: `RedemptionKind` gains `admin_paid`; `loadAdminPaidInvite` replaces the unconditional refusal, after the state and live-claim checks; `finishAdminPaid` (retried once, FR-12a on failure, two audits, landing `awaiting_payment`, N-1); `redemptionDeps.ts` wires `finaliseAdminPaid` |
| Public view (A-2) | `publicInviteView.ts`: an admin tier invite reads `unavailable` unless the predicate says `ok`; `BUSINESS_OS_INVITE_PUBLIC_COLUMNS` and `BusinessOsInvitePublicView` gain `invite_type` (read, never returned) |
| Config comments (T4, C-11) | `config/invites.ts`: the switch now opens admin Paid signup; on only after **P-9.2** has merged |
| Registry (§3.7) | `inviteOffer.ts` entry gains `INVITE_ISSUANCE_POLICY` only (`PAID_INVITE_TYPE` not used: the predicate keys on `INVITE_TYPES[type].grantKind`). `inviteRedemption.ts` and `publicInviteView.ts` import nothing new from the module |

### T1: the PGlite run (C-10)

PGlite 0.2.17 (PostgreSQL 16.4), installed in a scratch directory outside the repo. Stub roles `anon`, `authenticated`, `service_role` **with BYPASSRLS** (Supabase's); stub `auth.users`, `admin_users` (one admin bound to an account), `business_os_billing_accounts`, `onboarding_conversations`, `business_profiles`. Then the real files 20261005, 20261012, 20261013, 20261014, 20261020, 20261023, 20261024. One owner account with a plan row (`backfill`) and an organic lineage row.

| Step | VERDICT |
|---|---|
| Pre-check before 20261029 | **PASS** 7 pass 0 fail, "run the migration in a NEW tab" (P3 champion md5 `61f1914570db05d988331f1c11d3280d`, P4 friend md5 `55d59010921417011ec6c777064056fe`) |
| Checker before | FAIL 2/5 (C1 to C5 missing; C6, C7 PASS) |
| Probe before | PROBE SKIPPED "apply 20261029 first" |
| 20261029 applied | applied |
| **Checker after** | **PASS 7 pass 0 fail** (C3 body md5 `576c2e80149a372d7cc1dce490e0de4f`) |
| Pre-check after | FAIL on P2 only, "do not run the migration" (as designed) |
| Probe with the placeholder left in | PROBE SKIPPED "replace PASTE_THE_TEST_ACCOUNT_ID_HERE" |
| **Probe**, account WITH a plan row and an organic lineage row | **PROBE PASS** F01 to F10 and F12 (F00: both set aside for the run); rows before = after (plan origin still `backfill`) |
| **F11** after it | **PASS** 0 probe invites, 0 probe lineage rows |
| **Probe**, account with NO plan row and NO lineage row | **PROBE PASS**; still 0 rows after |
| F11 after it | PASS |
| Rollback | applied; checker FAIL on C1 to C5 only; pre-check PASS again |
| 20261029 re-applied | checker PASS 7/0 |

**Mutations (each must turn the probe or the checker red):**

| Mutation | Result |
|---|---|
| M1 no `revoked_at IS NULL` in the lock | checker C3 FAIL; PROBE FAIL F07 (23514) |
| M2 no `issuer_kind = 'admin'` | C3 FAIL; PROBE FAIL F09 |
| M3 no `grant_kind = 'tier'` | C3 FAIL; PROBE FAIL F08 |
| M4 plan row written with a cohort | C3 FAIL; PROBE FAIL F02 |
| M5 EXECUTE also granted to `authenticated` | C4 FAIL (`authenticated EXECUTE service_role EXECUTE`). The probe still passes F12: an invoker function run by `authenticated` fails on the tables anyway, so the checker is the guard here |
| M6 SECURITY DEFINER | C1 FAIL |
| M7 no EXECUTE for `service_role` | C4 FAIL; PROBE FAIL F01 to F09 (42501) |
| M8 no `grant_id = p_tier` | C3 FAIL; PROBE FAIL F06 |
| M9 `service_role` without BYPASSRLS | PROBE FAIL (F01 `not_matched`): the stand-in must bypass RLS as Supabase's does, or the run proves nothing |

PGlite does not reproduce Supabase's default grants (covered by the explicit REVOKEs) or concurrency. The production pre-check, checker and probe at G-2 remain the proof.

### Deviations and points for SA

| # | What | Why |
|---|---|---|
| D-1 | T0 not done (git refused; no stash) | House rule. RM merges after commit. P-5b.2 is therefore not on this branch: the "admin list reads Signed up, not paid" pin (§7 row "Admin list") is **not** added in P-9.1; it belongs after the merge (P-9.2, or RM's merge commit if SA wants it in P-9.1) |
| D-2 | C-1 says C7 compares the champion and friend md5 "to the values recorded in their own checkers". **Those checkers record no md5** (`check-bos-invite-signup-migration.sql`, `check-bos-friend-invite-signup-migration.sql` check shape and position only) | The md5s are derived from the 20261014 and 20261024 files (line endings removed, as `prosrc` is compared), pinned in the checker (C6 champion, C7 friend) and the pre-check (P3, P4), and the Jest guard re-derives both from the files, so they cannot drift. If production's bodies differ from the files by whitespace, P3/P4 FAIL before anything is applied: stop and report, do not apply |
| D-3 | The lock is `PERFORM … FOR UPDATE` then `IF NOT FOUND`, not `SELECT … INTO` | `FOUND` as C-1 asks, with no variable; the word "into" then appears only as `INSERT INTO` in all six files |
| D-4 | The probe rolls back by its final `RAISE EXCEPTION` inside a `DO` block (the 20261028 precedent), not a literal `ROLLBACK`; F11 is a sixth, read-only file | A `DO` block cannot `ROLLBACK`, and the SQL editor aborts the rest of a paste after the raise, so F11 must run on its own. The probe sets aside the test account's existing plan and lineage rows inside the always-rolled-back transaction (as the owner; refused if the account has invitees or a live-mode billing record). Added **F12**: `authenticated` may not execute (see M5) |
| D-5 | `BusinessOsInviteRepository.ts` and `types.ts` touched in P-9.1 (§4 listed them for .2 only): the public view now reads `invite_type` | C-2 needs the type for the view's half of the predicate. Never returned (the allow-list test is extended) |
| D-6 | Checker rows: C1 to C5 the new function, C6 champion md5, C7 friend md5, C8 time. §11's "C6 body md5 printed" is folded into C3's detail | One fewer row, same information |
| D-7 | `inviteOffer.ts` imports `sellableTiers` from `billing/planCheckoutEligibility.ts` (C-3) | The C-3 import comment is in place; billing imports `invites/paymentHold` as a type only, so there is no runtime cycle |
| D-8 | The agreement test (C-2) covers admin-issued TIER rows (the predicate's domain), five shapes × both switch values | Out of scope, noted only: for an admin COHORT row whose `invite_type` is not the champion type (never written by issuance), the page still says `valid` while the signup says `unavailable`. Pre-existing since 1b; not changed here |
| D-9 | The existing-account check for an admin Paid invite runs in `loadAdminPaidInvite`, before any code (the champion order), as §3.3 row 3 | — |
| D-10 | Migration guard helpers copied from the 20261028 guard, not imported (SA optimisation suggestion) | Importing a test file would run its suites inside this one |
| D-11 | The probe uses made-up ids (`probe_tier`, `probe_type`), never config tier or cohort names | The function holds no plan name (L-5); the guard pins it |

### Tests and gates (final diff)

| Command | Result |
|---|---|
| `npx jest lib/business-os/invites app/api/public/invites app/invite app/api/admin/business-os/invites supabase/migrations/__tests__ lib/repositories/__tests__ lib/business-os/entitlements` | **198 suites, 6349 tests, 0 failed** |
| `npm run test:bos-entitlements` (G-4) | **258 suites, 7623 tests, 0 failed** |
| `npm run typecheck:bos-llm` | **passed**, 0 new (one test fixture needed `invite_type`, fixed) |
| `eslint` on the 21 touched files | 0 errors (4 pre-existing `no-explicit-any` warnings, not on changed lines) |
| `npm run lint:hooks` | clean |

New or extended tests: the migration guard (62); `inviteRedemption.test.ts` P-9.1 block (switch off on all three entry points; four `unavailable` shapes including an unpriced tier; existing account before any code; code and Google happy paths with the row tier, audit shapes and N-1; `already_finalised`; retry; two FR-12a failures; R-7 both directions; live claim first); `adminPaidInviteAgreement.test.ts` (C-2, 11); `inviteOffer.test.ts` (predicate, 11); `publicInviteView.test.ts` (5); `routes.test.ts` (C-9: `tier`, `grantId`, `accountId`, `inviteId`, `inviteType` → 400 on code, complete and Google, 16); `inviterNotification.test.ts` (N-1 to the issuing admin, `not_subscribed_yet`); repository (5) and wiring (1).

### G-2: production apply runbook (user, SQL editor, before P-9.1 merges)

Paste each file whole; none has a `--` comment, punctuation inside a string, or the word "into" inside a string.

| # | Step | Expected |
|---|---|---|
| 1 | **Pre-check** `scripts/precheck-bos-admin-paid-invite-finalise-migration.sql` | `VERDICT PASS`, "7 pass 0 fail  run the migration in a NEW tab". P6 and P7 = 0. P8 (INFO) counts pending admin tier invites: demo links to revoke. **If P3 or P4 FAIL** (live champion or friend body differs from the repo), stop and report |
| 2 | **Migration** `supabase/migrations/20261029_business_os_admin_paid_invite_finalise.sql` in a **NEW tab** (the pre-check leaves its tab read-only) | Success, no rows |
| 3 | **Checker** `scripts/check-bos-admin-paid-invite-finalise-migration.sql` | `VERDICT PASS`, "7 pass 0 fail"; C3 detail `576c2e80149a372d7cc1dce490e0de4f`; C4 `service_role EXECUTE` |
| 4 | **Probe** `scripts/probe-bos-admin-paid-invite-finalise.sql` in a **NEW tab**, after replacing `PASTE_THE_TEST_ACCOUNT_ID_HERE` with a test account's user id | An ERROR whose message starts `PROBE PASS`, lists F00 INFO and F01 to F10 and F12 PASS, and ends "this error is expected and rolls everything back". `PROBE SKIPPED …` means a guard refused: follow its text |
| 5 | **F11** `scripts/probe-bos-admin-paid-invite-finalise-after.sql` in a new tab | `F11 … PASS`, "0 probe invites  0 probe lineage rows" |
| 6 | Record the four results in requirement §9.3 (20261029 row) | — |

**Rollback** (only if needed): `supabase/SQL Scripts/20261029_business_os_admin_paid_invite_finalise_rollback.sql`, then the checker reads FAIL on C1 to C5 (C6, C7 PASS) and the pre-check PASS again. Nothing persisted depends on the function. If `supabase db push` is ever used, 20261029 sorts before applied 20261030+: it needs `--include-all`.

### T9 (P-9.1 share): demo checklist for TL / the user

Locally, never committed: `paidInvitesAvailable: true` in `config/invites.ts`. 20261029 applied (G-2). An admin mailbox the user reads and a fresh invitee address.

| Step | Expected |
|---|---|
| D2 | Issue an admin Paid invite (Autopilot, Hebrew): link created; invitation says "Payment required" |
| D4 | Sign up with the code (or Google): lands on `/invite/awaiting-payment`, "Payment coming soon" (P-9.2 adds Pay) |
| D5 | The issuing admin's inbox: one N-1 email, "Signed up — not subscribed yet" |
| D6 | Admin list: Accepted, L1 (the "Signed up, not paid" line needs P-5b.2, i.e. after the T0 merge) |
| D7 | Read-only SQL: plan row `tier` NULL, `cohort` NULL, `origin = 'invite'`; lineage `admin_invite`, level 1, `first_paid_at` NULL |
| D12 | Flip the switch back to `false`; a second, unused Paid link: the page reads "no longer available"; a direct signup call → 409 `paid_invites_not_available` |
| D13 | Same day: revoke the unused demo invites, revert the local flip; the test account may go through the Danger Zone cleanup |

---

## SA Code Review — P-9.1 (2026-10-14)

**Code Review by SA — 2026-10-14**
**Status:** ✅ Code Approved (APPROVED WITH FIXES — one doc fix applied by SA, listed below; nothing for Dev to redo)

Reviewed in the worktree `neuronforge-invite-s1`, branch `feature/bos-plan-payments-p9` at `396cafa6`, uncommitted: 20 modified files (+767/−43) and the 8 new files. Read in full: the migration, the rollback, the pre-check, the checker, the probe, the F11 count, the migration guard, the agreement test, and the diffs of `inviteOffer.ts`, `inviteRedemption.ts`, `publicInviteView.ts`, `redemptionDeps.ts`, both repositories, `types.ts`, `config/invites.ts`, the registry and the imports guard, plus all the test diffs. Skills applied: `tenant-isolation-guard`, `business-os-entitlements` (review checklist), `business-os-schema-check` (columns checked against 20261005, 20261012, 20261014 and 20261024).

### Gates SA ran on the final diff

| Command | Result |
|---|---|
| `npx jest` over invites, public invite routes, `app/invite`, billing, the 20261029 guard, both repository tests and the imports guard | **62 suites, 4623 tests, 0 failed** |
| `npm run test:bos-entitlements` (G-4) | **258 suites, 7623 tests, 0 failed** |
| `npm run typecheck:bos-llm` | passed (exit 0). A full `tsc --noEmit` over the repo did not finish in 10 min on this machine, so it is not counted as evidence |
| `eslint` on every touched `.ts` file and the two new tests | 0 errors; 4 pre-existing `no-explicit-any` warnings, none on changed lines |
| `console.*` in touched non-test files | none |

### Mutation checks (one at a time; each restored by re-editing and md5-verified)

| # | Mutation | Caught by |
|---|---|---|
| SM-1 | 20261029: drop `done_row.grant_kind = 'tier'` from the `already_finalised` join | migration guard (2 red) |
| SM-2 | 20261029: the word "into" added to the COMMENT | migration guard, paste rule (1 red) |
| SM-3 | `adminPaidInviteRedemption`: an unpriced tier answers `ok` | `inviteOffer.test.ts` and `inviteRedemption.test.ts` (2 red). **Not** caught by the agreement test (see O-1) |
| SM-4 | `publicInviteView.ts`: only `unavailable` reads "no longer available", `switch_off` does not | `publicInviteView.test.ts` and the agreement test (6 red) |
| SM-5 | `loadAdminPaidInvite`: the existing-account check is skipped | `inviteRedemption.test.ts` (1 red) |

md5 after restore, equal to the value before the first mutation: migration `1f5f7c3dab6efccef515ed85c0fd88eb`, `inviteOffer.ts` `e4fa4fd17f8c322774d2679cf1d90f93`, `publicInviteView.ts` `ec3641f928941ce1824e07f58274ff12`, `inviteRedemption.ts` `ee50984f109c1ff388bb2f607ff50106`.

### Conditions

| # | Verdict | Evidence |
|---|---|---|
| C-1 | ✅ | Same shape as 20261024, with `issuer_kind = 'admin'`. Header: `LANGUAGE plpgsql SECURITY INVOKER SET search_path = ''`. Lock: all eight filters plus `FOR UPDATE`, then `IF NOT FOUND` (D-3). The `already_finalised` join requires `done_row.redeemed_account_id = p_account_id`, `issuer_kind = 'admin'`, `grant_kind = 'tier'` and `lineage_row.source = 'admin_invite'`. Burn by id after the lock. Plan INSERT `(user_id, origin, period_anchor, updated_at)`, with no tier and no cohort. Lineage `(p_account_id, p_invite_id, 'admin_invite', NULL, p_account_id, 1)`. COMMENT obeys the paste rules. REVOKE ALL from PUBLIC, anon, authenticated and service_role, then GRANT EXECUTE to service_role only. One BEGIN/COMMIT, `lock_timeout 5s`, NOTIFY after COMMIT. No `ON CONFLICT`, no plan name. Checker C1 to C7 check exactly these properties. Concurrency: a second caller blocks on the row lock, re-reads `redeemed_at IS NULL` once the first commits, and falls through to `already_finalised` |
| Paste rules | ✅ | All six files: no `--`, no `/*`. String literals hold only letters, digits, underscores and spaces (`@`, `.` and `-` are built with `chr()`). "into" appears only as `INSERT INTO`. The guard pins this for every file |
| C-2 | ✅ | `adminPaidInviteRedemption(row, config)` returns `'ok' \| 'switch_off' \| 'unavailable'`. Order: the switch first; admin issuer and tier grant; own-key type check (rejects `constructor`); `INVITE_ISSUANCE_POLICY.admin` includes the type; `INVITE_TYPES[type].grantKind === 'tier'` (GR-1, no literal); `isInviteGrantAvailable`; `sellableTiers()`. Redemption maps `switch_off` to 409 `paid_invites_not_available` and everything else to 409 `unavailable`. The view maps both to `unavailable`. Agreement test: 5 shapes × 2 switch values, run over the real modules |
| C-3 (P-9.1 part) | ✅ | `sellableTiers()` is the only tier source in the predicate. A source test forbids `buyableTiers` and a `'paid'` literal in `inviteOffer.ts` |
| C-8 | ✅ | The admin branch comes after the state and live-claim checks, and after the friend branch (`issuer_kind = 'account'` returns first). The champion code is untouched: only the old unconditional refusal line was replaced by the branch. R-7 is pinned in both directions, and so is "a live claim answers first" |
| C-9 | ✅ | The route schemas are unchanged and `.strict()`. New tests inject `tier`, `grantId`, `accountId`, `inviteId` and `inviteType` into code, complete and Google requests: each gets a 400 and nothing runs downstream. `finishAdminPaid` passes `row.id`, the server-generated `accountId`, `row.email` and `row.grant_id`. Nothing comes from the request |
| C-10 | ✅ | `issuer_admin_id` comes from an existing `admin_users` row, and each row gets a fresh 64-char `token_hash`. The user supplies the test account, behind guards: placeholder replaced, valid uuid, session not read-only, function present, real account, no live-mode billing, no invitees. Every call runs as `service_role` (F12 runs as `authenticated` and gets 42501). The final RAISE always rolls everything back. F11 is a separate read-only file. Run on PGlite with M1 to M9 |
| C-11 | ✅ | §9.5 row 17 and both `config/invites.ts` comments say "only after **P-9.2** has merged" |
| C-12 | ⚠️ deferred, accepted (D-1) | 20261029 re-confirmed free on `5e44871d` and on every remote branch; no newer migration touches the three tables. The merge itself goes to RM |

### Tenant isolation (`tenant-isolation-guard`)

✅ This is a service-role path with a caller-supplied token. The ownership oracle is still the token hash, the email lock and the claim. Every SQL write keys on the locked row's id **and** on the values observed on it (`claimed_account_id`, `email`, `issuer_kind`, `grant_kind`, `grant_id`, not redeemed, not revoked). The account id is server-generated (I-3) and the tier is the row's own. No request field can name an account, an invite or a tier (C-9 tests). The function is INVOKER with EXECUTE for service_role only, so it adds no secdef surface.

### Entitlements (`business-os-entitlements` review checklist)

✅ Only `inviteOffer.ts` gains a symbol (`INVITE_ISSUANCE_POLICY`), and its `KNOWN_NON_GATE_IMPORTERS` entry matches its imports exactly. It is correctly a non-gate: the predicate decides whether an *invite* may be redeemed, not what an account may do. `inviteRedemption.ts` and `publicInviteView.ts` import nothing new from the module. There is no tier or cohort literal: the migration guard checks both the migration and the probe against `TIER_ORDER` and `COHORT_IDS`, and the probe uses `probe_tier` / `probe_type`. `npm run test:bos-entitlements` is green (above). The guard imports `config/`, which is allowed because it is a test file.

### Rulings on D-1 to D-11

| # | Ruling |
|---|---|
| D-1 | **Accepted.** The T0 merge goes to RM after the commit (no stash, per house rule). The P-5b.2 pin "admin list reads Signed up, not paid" (§7 row "Admin list") moves to **P-9.2**, where it is a required test, not optional. RM: resolve the requirement's Change History append-only, then re-run the invites and repositories suites on the merge commit before opening the PR |
| D-2 | **Accepted, now evidenced.** The earlier checkers record no md5. Dev derived the values from the 20261014 and 20261024 files with CR removed, and the guard re-derives them, so they cannot drift. TL's read-only production query (2026-10-14) returns the same two values, one copy of each function, so P3/P4 and C6/C7 will PASS on production as written. The runbook keeps its "stop if P3 or P4 FAIL" line |
| D-3 | **Accepted.** `PERFORM … FOR UPDATE` followed by `IF NOT FOUND` is what C-1 asked for, and it keeps "into" out of the files except as `INSERT INTO` |
| D-4 | **Accepted.** A DO block cannot ROLLBACK. The final `RAISE EXCEPTION` aborts the whole statement, as in the 20261028 precedent. F11 needs its own paste because the editor stops after the raise. Setting the test account's plan and lineage rows aside inside a statement that always aborts is sound: the guards refuse live-mode billing and accounts with invitees, and the abort restores everything. F12 is a welcome addition |
| D-5 | **Accepted.** Only the public-view repository method reads `invite_type`, and it reaches no response. `viewInviteByToken` builds every response from explicit fields, `describeInviteOffer` returns plan facts only, and the route returns `outcome.response` alone. The allow-list test pins the seven keys and checks that the JSON holds no `invite_type`, `issuer` or `admin`. The repository column-list test pins the column order |
| D-6 | **Accepted.** C3's detail carries the body md5: the same information in one row fewer |
| D-7 | **Accepted.** The C-3 import comment is in place. Verified: `planCheckoutEligibility.ts` imports only config, two flag readers (each importing only `parseBooleanFlag`) and `import type { PaymentHold }`, so there is no runtime cycle. `paymentHold.ts` is not touched |
| D-8 | **Accepted as out of scope; recorded as follow-up F-1.** Issuance cannot write an admin COHORT row whose `invite_type` is not the champion type, and the mismatch predates 1b. Fix it the next time the champion branch is touched, with the same pattern: one predicate that returns a reason, not a boolean. Not blocking |
| D-9 | **Accepted.** As §3.3 row 3 says, the admin holds the address, so there is no oracle to protect. I-6's stale-claim exception is kept, and SM-5 shows the check is pinned |
| D-10 | **Accepted.** Copying is right here: importing a test file would run its suites |
| D-11 | **Accepted.** Made-up ids keep L-5 true in the probe too |

### Fixes applied by SA

1. `docs/requirements/BUSINESS_OS_PLAN_PAYMENTS_REQUIREMENT.md` §9.1 P-9 row said "`096f86e0` with P-5b.2 is merged in at T0", which is no longer true (D-1). It now says the T0 merge is left to RM after the commit. Docs only.

### Code Review Comments

None blocking.

### Optimisation Suggestions

- **O-1** (Low) `adminPaidInviteAgreement.test.ts` proves *agreement* only. Its "unpriced" and "no longer carried" shapes would still pass if both sides wrongly said `valid` (SM-3). Two other suites pin the refusal, so nothing is unguarded. Asserting the expected state per shape (`valid` only for the first shape with the switch on) would let the file stand alone. Fold it into P-9.2 if convenient.

### Follow-ups (not P-9.1)

- **F-1** (D-8) The champion branch and the view disagree on an admin cohort row with a non-champion type. Pre-existing, and unreachable through issuance.
- **F-2** P-9.2 adds the D-1 admin-list pin and keeps C-3 to C-7 as approved.

### QA focus

1. **Inert in the shipped state** (switch `false`): an admin Paid link shows `unavailable`; code, complete and Google each return 409 `paid_invites_not_available` with only the token lookup run; champion and friend signups are unchanged (run one of each end to end).
2. **Switch flipped locally only, never committed:** happy path by code and by Google lands on `/invite/awaiting-payment` showing "coming soon". The issuing admin gets one N-1 ("not subscribed yet"). The D7 SQL shows plan `tier`/`cohort` NULL and `origin = 'invite'`, and lineage `admin_invite` L1 with `first_paid_at` NULL. The two audit rows have the shapes in §3.3.
3. **Refusals with the switch on:** an address that already has an account gets `existing_account` before any code is sent; a revoked link is refused; re-submitting complete after success returns `already_finalised` as a success, with no second N-1.
4. **C-9:** POST each route with an extra `tier` or `accountId` field and expect 400.
5. **G-2 (the user's step, before P-9.1 merges):** pre-check PASS 7/0 (P3/P4 must PASS, and TL's md5 evidence says they will); migration in a NEW tab; checker PASS 7/0 with C3 `576c2e80149a372d7cc1dce490e0de4f`; `PROBE PASS` on a test account; F11 0/0.
6. **Cleanup the same day (D13):** revoke the demo invites and revert the local flip.

### Code Approved for QA: **Yes**

---

## QA Testing Report

### QA — P-9.1 "Admin invitee signs up and is held" (2026-10-14)

**Test mode:** full (SA QA focus 1 to 4; focus 5 and 6 are the user's steps, covered by the run-sheet below)
**Strategy used:** A (Jest unit, over the real modules with injected deps) + B-lite (route-level Jest with mocked deps) + static review of the six SQL files. No browser, no real database, no Stripe in this session, so the database half rests on Dev's recorded PGlite run (Implementation Notes, T1) and on the Jest migration guard; QA did not re-run PGlite.
**Focus:** api, schema, security
**Skipped:** D (browser) and live SQL: not available in this session; both are in the run-sheet for the user. PGlite: Dev's harness lives in a scratch directory and was not re-run; Dev's recorded verdicts are relied on and said so.
**Input source:** prompt keywords (TL trigger) + SA "QA focus"
**Worktree:** `neuronforge-invite-s1`, `feature/bos-plan-payments-p9` on `396cafa6`, uncommitted. md5 of `inviteOffer.ts`, `inviteRedemption.ts`, `publicInviteView.ts` and the migration matched SA's post-review values before QA started.

#### Test Coverage

| Acceptance criterion (SA QA focus) | Tested? | Result | Evidence |
|---|---|---|---|
| 1a. Switch off: an admin Paid link reads `unavailable` and never asks the account question | ✅ | Pass | `publicInviteView.test.ts` P-9.1 block (switch off: `unavailable`, `accountQuestions` empty, no first-view stamp) |
| 1b. Switch off: code, complete and Google each 409 `paid_invites_not_available`, only the token lookup run | ✅ | Pass | `inviteRedemption.test.ts` `it.each(entries)`: `calls` = `['find']`, admin finalise never called, even with `emailHasAccount: true` |
| 1c. Shipped value is `false` | ✅ | Pass | "ships with the Paid switch off" pins `INVITE_ISSUANCE_POLICY.paidInvitesAvailable === false`; `config/invites.ts` diff is comments only |
| 1d. Champion and friend signups unchanged | ✅ | Pass | Every removed line in the touched test files was read: no champion or friend case was edited or deleted (only the old admin-Paid test was renamed, same assertions; imports widened). R-7 pinned both ways. All champion/friend suites green in the run below |
| 2a. Switch on: code path finalises via the new function with the ROW tier, lands `awaiting_payment` | ✅ | Pass | finalise called with `{ inviteId, accountId: NEW_ID, email, tierId: row.grant_id }`; champion and friend finalises not called |
| 2b. Switch on: Google path, same finalise and landing | ✅ | Pass | `inviteRedemption.test.ts` Google case; `routes.test.ts` "lands on the payment hold from either method" |
| 2c. Lands on `/invite/awaiting-payment` showing "coming soon" | ✅ (by reading + existing tests) | Pass | Landing → path via `REDEMPTION_LANDING_PATHS` (unchanged). The hold already treats `admin_invite` + tier + `first_paid_at` NULL as held (`paymentHold.ts` `isAwaitingPayment`); `heldPaymentOffer` answers `held_tier_unresolved` for `admin_invite` in P-9.1, so the screen shows "coming soon" whatever the switches. Visual check left to the run-sheet |
| 2d. One N-1 to the issuing admin, "not subscribed yet" | ✅ | Pass | Redemption: `notified` has exactly one entry, `issuerKind: 'admin'`, `issuerAdminId`, `landing: 'awaiting_payment'`. Notifier: `inviterNotification.test.ts` new case → sent to the admin, text "Signed up — not subscribed yet", audit `status: 'not_subscribed_yet'` |
| 2e. Plan row tier/cohort NULL, origin invite; lineage `admin_invite` L1, parent NULL, `first_paid_at` NULL | ✅ (file + Dev's PGlite) | Pass | Migration read: plan INSERT names `(user_id, origin, period_anchor, updated_at)` only; lineage INSERT `(…, 'admin_invite', NULL, p_account_id, 1)`; `first_paid_at` not written (defaults NULL). Guard pins both. Dev's PGlite PROBE PASS F02/F03. Live check is D7 in the run-sheet |
| 2f. Audit rows per §3.3 | ✅ | Pass | Exact `toEqual` on both: `BOS_INVITE_REDEEMED { inviteType, level: 1, source: 'admin_invite', method }` and `BOS_INVITE_PLAN_PROVISIONED { grantKind, grantId, basis: 'none', awaitingPayment: true, origin: 'invite' }`; no secrets (`expectNoSecrets`) |
| 3a. Existing account → `existing_account` before any code is sent | ✅ | Pass | Code request: calls `['find', 'emailHasAccount:…', 'stamp']`, `sent` empty. **QA extra:** Google path with an existing account → 409 `existing_account`, no user created, no finalise |
| 3b. Revoked link refused | ✅ (QA extra) | Pass | **QA extra:** switch on, revoked admin Paid row → 409 `revoked` on code, complete and Google; only `find`; no finalise, no N-1. Also expired → 409 `expired` |
| 3c. Resubmit after success → no second N-1 | ✅ (QA extra) | Pass | **QA extra:** after a successful complete (1 N-1), re-submitting against the now-redeemed row → 409 `used`, no finalise, no audit, no N-1. Note: a resubmit never reaches the SQL `already_finalised` branch (the state check answers first); `already_finalised` only arises on the I-5 retry after a lost commit, where **QA extra** confirms exactly one N-1 and one audit pair |
| 3d. `already_finalised` is a success | ✅ | Pass | Dev's case + QA extra above |
| 4. Injected `tier` / `accountId` / `grantId` / `inviteId` / `inviteType` → 400 on each route | ✅ | Pass | `routes.test.ts` C-9 block: 5 fields × code, complete, Google = 15 cases, each 400 and `state.events` empty |
| 4b. `invite_type` never reaches the page or client | ✅ | Pass | Read but never returned: allow-list test pins the seven response keys and asserts no `invite_type`/`issuer`/`admin` text; the validate route returns `outcome.response` only; `grep` finds no `invite_type`/`inviteType` in `app/invite` or `app/api/public/invites` (non-test) |
| SQL paste rules, all six files | ✅ | Pass | QA's own scanner (independent of Dev's guard) over every single-quoted literal: migration 14, pre-check 141, checker 89, probe 110, F11 6, rollback 2 literals; **0** with any character outside letters, digits, underscore, space; **0** containing "into". `--` count 0 and `/*` count 0 in all six. "into" appears only as the `INSERT INTO` keyword (migration ×2, probe ×2), never in a string. No double quotes anywhere. Dollar quotes: `$$` (migration body) and `$probe$` only |

#### Mutation check (QA, one at a time, restored by re-editing, md5-verified)

| # | Mutation | Caught by | Restore |
|---|---|---|---|
| QM-1 | 20261029: lineage `parent_account_id` `NULL` → `p_account_id` (an admin invitee would look like a friend of themself) | Migration guard, 2 red ("the lineage row is L1, source admin_invite, no parent…", and the checker C3 body md5 drift) | Re-edited with the Edit tool; md5 back to `1f5f7c3dab6efccef515ed85c0fd88eb` (SA's value); guard 62/62 green |

The QA extra cases were run from a temporary copy of `inviteRedemption.test.ts` (`zzqa.p91.tmp.test.ts`, 5 cases, all green) and the file was deleted afterwards; nothing QA wrote remains in the tree.

#### Issues Found

**Bugs (must fix before commit):** none.

**Performance issues:** none.

**Edge cases / notes (nice to fix, none blocking):**
1. **Test gap, revoked / expired / resubmit not pinned for the admin Paid branch** (Low). They pass today because the generic state checks run before the branch (C-8), and QA verified them with temporary tests; Dev's suite does not pin them for `admin_paid`. Worth adding the three cases in P-9.2 so a future reorder of `loadRedeemableInvite` cannot slip.
2. **SA O-1 stands** (Low): the agreement test proves agreement, not the expected state per shape.
3. **Admin route path in the trigger**: `app/api/admin/business-os/invites` exists and ran; it has no P-9.1 change (the admin form is P-9.2).

#### Test Outputs

| Command | Result |
|---|---|
| `npx jest lib/business-os/invites app/api/public/invites app/invite app/api/admin/business-os/invites supabase/migrations/__tests__ lib/repositories/__tests__ lib/business-os/billing lib/business-os/entitlements` | **229 suites, 9704 tests, 0 failed** (191 s; one "worker failed to exit gracefully" warning, no failure) |
| QA extra (temporary file, deleted) | 5 passed |
| Migration guard after QM-1 restore | 62 / 62 |
| `npm run test:bos-entitlements` | First run **257 of 258 suites, 7622 of 7623 tests**: 1 failure, `app/admin/users/__tests__/creditsBlock.render.test.tsx` "keeps the request id across a network error…" (5 s Jest timeout), run while `typecheck:bos-llm` was loading the machine. That file is **not** in the P-9.1 diff. It timed out again when re-run alone during the typecheck, then **passed 69/69** when re-run alone after the typecheck finished. Recorded as a load-sensitive flake, not a P-9.1 defect; SA's run of the same gate was 258/7623 green. Worth a timeout bump in its own ticket |
| `npm run typecheck:bos-llm` | **passed**, exit 0: 522 files in scope, 28 errors, 0 new (baseline); one baseline entry now fixed (`app/api/onboarding/build/route.ts` TS18047), not P-9.1's |
| `npm run lint:hooks` | **clean**, exit 0 |

#### Demo run-sheet for the user's session (P-9.1 share: D2, D4, D5, D6, D7, D12, D13)

**Before you start.** G-2 done (20261029 applied on production, checker PASS). On localhost only, set `paidInvitesAvailable: true` in `lib/business-os/entitlements/config/invites.ts` and **never commit it**. Have an admin account whose inbox you read, and a fresh invitee address you control that has never signed up.

| Step | Do | Expect |
|---|---|---|
| D2 | `/admin/business-os-invites` → New invite → Paid → **Autopilot**, language Hebrew, the fresh address | Link created; the invitation email says payment is required |
| D3-lite | Open the link signed out (private window) | The offer page, not "no longer available" (the "payment required" line is P-9.2) |
| D4 | Sign up with the emailed code | Lands on `/invite/awaiting-payment` showing "Payment coming soon". No way into the app |
| D5 | The admin's inbox | **Exactly one** email: the invitee's address and "Signed up — not subscribed yet". Refresh the holding page and re-open the link: still one email; the link now reads "already used" |
| D6 | Admin invites list | The invite is Accepted, L1 (the "Signed up, not paid" line arrives with P-9.2) |
| D7 | Supabase SQL editor, **read-only**, one query per tab (below) | Q1: one row, `tier` and `cohort` empty, `origin` invite. Q2: `admin_invite`, level 1, `parent_account_id` empty, `first_paid_at` empty. Q3: one `BOS_INVITE_REDEEMED` and one `BOS_INVITE_PLAN_PROVISIONED` |
| D12 | Set `paidInvitesAvailable` back to `false`, restart dev, open a second unused Paid link | "No longer available". A signup attempt on it is refused |
| D13 | **Same day** | Revoke every unused demo invite from the admin list (reason e.g. "demo cleanup"); confirm `git diff lib/business-os/entitlements/config/invites.ts` is empty; the test account may then go through the Danger Zone cleanup |

Read-only SQL for D7 (no comments, no punctuation inside strings, the word "into" never appears). They pick the newest redeemed admin Paid invite, so run them right after D4:

```sql
SELECT plan_row.user_id, plan_row.tier, plan_row.cohort, plan_row.origin
FROM public.business_os_account_plans AS plan_row
JOIN public.business_os_invites AS invite_row ON invite_row.redeemed_account_id = plan_row.user_id
WHERE invite_row.issuer_kind = 'admin' AND invite_row.grant_kind = 'tier' AND invite_row.redeemed_at IS NOT NULL
ORDER BY invite_row.redeemed_at DESC
LIMIT 1;
```

```sql
SELECT lineage_row.source, lineage_row.level, lineage_row.parent_account_id, lineage_row.root_account_id, lineage_row.first_paid_at
FROM public.business_os_account_lineage AS lineage_row
JOIN public.business_os_invites AS invite_row ON invite_row.id = lineage_row.invite_id
WHERE invite_row.issuer_kind = 'admin' AND invite_row.grant_kind = 'tier' AND invite_row.redeemed_at IS NOT NULL
ORDER BY invite_row.redeemed_at DESC
LIMIT 1;
```

```sql
SELECT audit_row.action, audit_row.details, audit_row.created_at
FROM public.audit_trail AS audit_row
WHERE audit_row.entity_id::text = (
  SELECT invite_row.id::text FROM public.business_os_invites AS invite_row
  WHERE invite_row.issuer_kind = 'admin' AND invite_row.grant_kind = 'tier' AND invite_row.redeemed_at IS NOT NULL
  ORDER BY invite_row.redeemed_at DESC LIMIT 1)
ORDER BY audit_row.created_at;
```

Q3 also lists the N-1 "notified" row and the code-sent rows for the same invite; what matters is one `BOS_INVITE_REDEEMED` and one `BOS_INVITE_PLAN_PROVISIONED`, with `source` admin_invite and `basis` none.

#### Final Status

- [x] All P-9.1 acceptance criteria in scope for QA pass — **PASS WITH NOTES** (notes are a test-gap suggestion for P-9.2 and SA O-1; no bug)
- Still owed before merge, by the user: G-2 on production (pre-check, migration, checker, probe, F11) and the run-sheet above (G-5), or a waiver; RM's T0 merge of `origin/main` with the invites and repositories suites re-run on the merge commit (SA D-1)

---

## Implementation Notes (P-9.2)

**Dev, 2026-10-14.** Branch `feature/bos-plan-payments-p9-2` (worktree `neuronforge-invite-s1`, fresh from `origin/main` `392a9b53`, which carries P-9.1 #373 and P-5b.2 #363; confirmed with `git branch --show-current`). Uncommitted. **No migration.** Skills applied: `business-os-entitlements`, `tenant-isolation-guard`, `new-api-route` (no new route), `business-os-schema-check` (`grant_id`, `issuer_admin_id`, `grant_kind` verified on `business_os_invites` in 20261012: NOT NULL `grant_id`, `one_issuer` CHECK).

### G-2 recorded (P-9.1 gate, production, 2026-10-14)

| Step | Result |
|---|---|
| Pre-check | VERDICT PASS 7/0 |
| Migration 20261029 | applied |
| Checker | VERDICT PASS 7/0, C3 body md5 `576c2e80149a372d7cc1dce490e0de4f` (equal to the PGlite run) |
| Probe | PROBE PASS F01 to F10 and F12 |
| F11 | PASS (nothing left behind) |

Recorded in requirement §9.3 (20261029 row). P-9.1 merged as #373.

### What was built

| Task | Area | Files |
|---|---|---|
| T5 | Hold carries the invited tier (C-5): `findHoldFactsById` selects `grant_kind, grant_id, language`; `BusinessOsInviteHoldFacts.grant_id`; `PaymentHold`'s held variant is a union, `grantId: string` only on `admin_invite`; an empty / missing `grant_id` → `{ ok: false }` | `lib/repositories/BusinessOsInviteRepository.ts`, `lib/repositories/types.ts`, `lib/business-os/invites/paymentHold.ts` |
| T5 | `heldInviteOffer(invite, switches)` extracted (C-6): switches first (D5-3), then the invited tier (friend: `INVITE_ISSUANCE_POLICY.account.grantId`; admin: `grantId`) if it is in `sellableTiers()` (C-3), else `held_tier_unresolved`. `heldPaymentOffer` now delegates to it. No registry change (same symbols) | `lib/business-os/billing/planCheckoutEligibility.ts` |
| T5 | Holding screen: `held_tier_unresolved` (only reachable with every switch on) logs `error`, `alert: true`, `bos_billing_held_tier_unresolved`, account id and source only (W-2) | `lib/business-os/billing/heldPaymentView.ts` |
| T6 | FR-22: the `valid` response gains `payment: 'none' \| 'required' \| 'opens_later'`, decided by `heldInviteOffer` with injectable switches (`paymentSwitches`); `none` for a non-tier grant | `lib/business-os/invites/publicInviteView.ts` |
| T6 | Invite page renders the existing `copy.paymentRequired` for `required` (`data-testid="invite-payment-required"`), `paymentOpensLater` for `opens_later`, nothing for a free offer; the SA CR-1 comment now points at C-6/C-7. No new copy key (C-7) | `app/invite/page.tsx`, `app/invite/invitePageCopy.ts` (comment only) |
| T7 | Admin form: the Paid type's grants are `sellableTiers()` that the config still carries for an invite type, labelled `"<plan> · $<price> a month"` via `planLabel` + `planMonthlyPriceUsd(config, tier)` (C-4); default = the type's default when payable, else the first; `note` = the pays-at-signup line; with no payable tier the type is unavailable ("No plan has a price yet"). Create refuses an unpayable Paid grant with 409 `grant_not_available` before any read or write | `lib/business-os/invites/adminInviteOps.ts`, `app/admin/business-os-invites/components/CreateInviteForm.tsx` (renders `note`), `app/admin/business-os-invites/types.ts` |
| T8 | Registry: `adminInviteOps.ts` gains exactly `planMonthlyPriceUsd` | `lib/business-os/entitlements/__tests__/enforcementPoints.test.ts` |
| T10 | N-2 to the issuing admin (BQ-P11, Q-10): `planPaymentApply.ts` hands a stamped `admin_invite` first payment to the existing notifier port (organic still `not_applicable`) with the lineage `source` (`lineageSource`); the notifier looks for the recipient that lineage names: for `admin_invite` the invite must be admin-issued, name an `issuer_admin_id` and be redeemed by the payer (else `invite_mismatch`, alerted); a champion's own (cohort) payment owes nobody (info line, no audit); then `notifyInviter` with `issuerKind: 'admin'` (N-1's `isActiveAdmin` and the admin's live auth email via `findUserIdentity`, N-1's admin button, the same 4 s clock, N-2's audit shape with `recipientKind: 'admin'`). `NotifyInviterInput` allows `'subscribed'` for an admin. The N-2 invite read gains `issuer_admin_id, grant_kind` | `lib/business-os/billing/planPaymentApply.ts`, `lib/business-os/invites/championSubscribedNotification.ts`, `lib/business-os/invites/inviterNotification.ts`, `lib/repositories/BusinessOsInviteRepository.ts`, `lib/repositories/types.ts`, `lib/email/templates/invite-accepted.ts` |

**Exactly once (T10).** Only `result.firstPaymentStamped === true` (the apply function's own "newly stamped" answer) on `applied`/`recorded` reaches the notifier, unchanged from P-5b.1; a replay is `already_applied` and never gets there, including a replay arriving while the first email is still sending (pinned).

### Copy (G-3)

**No new he/es strings.** The invite page reuses `copy.paymentRequired` (C-7). The admin's "subscribed" email reuses N-2's approved strings: its heading is N-2's **subject** in each language (the English N-2 heading says "Your friend subscribed", which is wrong for an admin), its lead, status word and footer are N-2's, its button is N-1's admin one. G-3 has nothing to approve.

New **English-only admin** strings (admin surface, P-5b SA Q-7 precedent): the form note "The invitee pays this plan at signup and cannot use AgentPilot until they have paid."; the grant label shape "<plan> · $<price> a month"; the unavailable reason "No plan has a price yet".

### Deviations and points for SA

| # | What | Why |
|---|---|---|
| D2-1 | T10 needed two more columns on the N-2 invite read: `findInviterNotificationFactsById` now selects `issuer_kind, issuer_account_id, issuer_admin_id, grant_kind, email, redeemed_account_id` (was four); `BusinessOsInviteNotificationFacts` gains both. Same one-row PK read, same single caller (C-7 guard unchanged) | Q-10: the admin is found from the payer's own lineage invite (`issuer_admin_id`), and only an admin **Paid** (tier) invite owes the email, so the grant kind is needed. Not listed in §4 |
| D2-2 | `FirstPaymentNotifyInput` gains optional `lineageSource`; absent is read as a friend (P-5b.1's only case) | The notifier keeps P-5b.1's cross-check "the invite is of the kind the lineage says"; a friend lineage pointing at an admin invite is still `not_a_friend_invite` |
| D2-3 | An `admin_invite` first payment now always reaches the notifier, so a **champion's own** first payment costs one bounded invite read before the notifier says `not_applicable` (info, no audit). The unwired-notifier alert now also covers `admin_invite`; its message was reworded ("may be owed an N-2 email") | Only the invite row tells a champion (cohort) from an admin Paid invitee (tier); `planPaymentApply.ts` imports nothing from invites (C-8) |
| D2-4 | Admin email heading = the N-2 subject (no new string) | See Copy |
| D2-5 | The admin form's payable-tier predicate is `isInviteGrantAvailable(config, tier) && sellableTiers().includes(tier)`, the two tier halves of the redemption predicate; the LIST comes from `sellableTiers()`. `isInviteGrantAvailable` (pre-existing GR-1 check, already applied at create) consults the invite types' grant lists | Read C-3 as "the tier list and the price rule come from `sellableTiers()`, never `buyableTiers()` or `INVITE_TYPES.paid.grantIds` as the list"; form, create and redemption cannot disagree. SA to confirm |
| D2-6 | Paid type shown unavailable when no tier is payable ("No plan has a price yet") | Otherwise the form would offer a type whose create always answers 409 |
| D2-7 | The client type keeps `payment` optional; a paid offer with no flag reads "Payment opens soon" | A deploy in flight (old server, new page) must never show "required" |
| D2-8 | The `held_tier_unresolved` alert also fires for a FRIEND whose friend tier lost its price | Same condition (every switch on, nothing to buy); W-2 shape |
| D2-9 | `{ ok: false }` for an empty `grant_id` means the page GATE treats the account as not held (it fails open on `{ ok: false }` with an error log, SA Q-2), while the checkout and the holding screen fail closed | As C-5 rules; the case is impossible by schema (NOT NULL). Flagged so SA sees the gate's half |
| D2-10 | Existing tests edited where the behaviour changed on purpose (listed below), never to weaken an assertion | Fixtures gain `grant_id` / the two N-2 columns / the `payment` key; three "until P-9" cases now use an unpriced admin tier and keep their fail-closed assertion; the P-5b.1 "admin_invite sends nothing" case is narrowed to organic, its admin half replaced by the T10 block |

Existing tests edited: `paymentHold.test.ts` (fixtures + `grantId`), `paymentHoldBatch.test.ts` (fixture), `planCheckout.test.ts` and `planCheckout.qa.test.ts` and `planCheckoutEligibility.test.ts` and `heldPaymentView.test.ts` and `app/api/business-os/billing/plan/checkout/__tests__/route.test.ts` ("until P-9" cases → unpriced admin tier, same refusal), `heldPaymentOffer.matrix.test.ts` (shapes, see §tests), `publicInviteView.test.ts` and `app/api/public/invites/validate/__tests__/route.test.ts` (allow-list gains `payment`), `BusinessOsInviteRepository.test.ts` (two column lists), `championSubscribedNotification.test.ts` and `planPaymentApply.n2.test.ts` (fixtures; organic-only case; T10 block appended), `adminPaidInviteAgreement.test.ts` (O-1), `inviteRedemption.test.ts` and `awaitingPayment.render.test.tsx` (blocks appended).

### Tests

| Area | Where | What |
|---|---|---|
| Hold (C-5) | `paymentHold.adminGrant.test.ts` (new) | admin + tier → `grantId`; friend → no `grantId`, invite never read (R-3); empty / null / undefined `grant_id` → `{ ok: false }`; cohort not held; `paymentHold.ts` imports nothing from billing or entitlements |
| `heldPaymentOffer` / `heldInviteOffer` | `heldPaymentOffer.admin.test.ts` (new) | each sellable tier → pay that tier; unknown / empty / `constructor` → unresolved; every partial switch combination → unavailable; `heldInviteOffer` ≡ `heldPaymentOffer` for 8 × 4 holds; source pin (sellableTiers only, no buyableTiers, no INVITE_TYPES, no tier literal); holding screen en/he/es Pay with the config's label and price; the W-2 alert (exact context) only with every switch on |
| P5-C5 parity (C-5) | `heldPaymentOffer.matrix.test.ts` | {friend, admin per tier (basic, pro), admin unknown, friend unpriced} × 8 switch combinations through the REAL route: the checkout admits exactly `[view.tier]` when Pay is shown and refuses every other tier (all of them otherwise); expected tier asserted per cell |
| Checkout | `planCheckout.test.ts` (block appended) | invited to each tier: admitted for it, `held_tier_not_allowed` for every other tier with no session; empty `grant_id` → `hold_unreadable` |
| FR-22 (C-6) | `invitePaymentStatement.agreement.test.ts` (new) | {admin per tier, admin tier lost its price, friend, friend tier lost its price} × 8: the page's `payment` = the expected value (O-1 style) AND `required` ⇔ `heldPaymentOffer` pay ⇔ `readHeldPaymentView` pay; champion → `none` |
| Page (C-7) | `page.payment.render.test.tsx` (new) | en/he (RTL)/es: `required` → one "Payment is required at signup." line, no "opens soon"; `opens_later` → one "opens soon" line; no flag → the safe line; free → none; no new key; page keys on the flag only |
| Holding screen | `awaitingPayment.render.test.tsx` (block appended) | admin hold (with `grantId`) reaches the model; en/he/es "Finish your payment", Autopilot, $129 (LTR `bdi` inside RTL), Pay POSTs the model's tier; coming soon otherwise |
| Admin ops (C-3, C-4) | `adminInviteOps.paid.test.ts` (new) | grants = sellable tiers with `planLabel · $planMonthlyPriceUsd a month`; note on Paid only; unpriced tier dropped and default moves; none payable → unavailable with reason; switch off unchanged; create refuses an unpriced tier with no read or write and lets every payable tier reach the write; source pin |
| Admin form | `createInviteForm.paidNote.render.test.tsx` (new) | renders the server grants and note; none for a champion; writes no note text or price of its own |
| Admin list (SA D-1, REQUIRED) | `invites.adminPaidInvitee.render.test.tsx` (new) | the REAL `listInvitesForAdmin` into the REAL `InviteList`: an admin Paid invitee reads "Signed up, not paid" (L1); after the stamp, "Paid · 2026-10-14 · $129.00 USD" + "Test payment"; an admin champion has no payment line |
| Redemption pins (QA P-9.1 note 1) | `inviteRedemption.test.ts` (block appended) | switch ON, admin Paid: revoked → 409 `revoked`, expired → 409 `expired`, used → 409 `used` on code, complete and Google, only the token lookup, no finalise, audit, N-1 or code; success then resubmit → one finalise, one audit pair, one N-1 in total |
| O-1 | `adminPaidInviteAgreement.test.ts` | each shape × switch asserts the expected page state, signup answer and predicate reason, not only agreement |
| T10 notifier | `championSubscribedNotification.admin.test.ts` (new) | one email to the admin's live auth email, active-admin checked, ids from `issuer_admin_id` only; exact NOTIFIED entry (N-2 shape, `recipientKind: 'admin'`); he/es approved subject and list word, RTL; former admin → `recipient_not_admin`; champion cohort → no email, no audit; four mismatches alerted; admin lineage without invite id; no clock left; friend path unchanged; no `@` in logs or audits |
| T10 apply | `planPaymentApply.n2.test.ts` (block appended) | stamped `admin_invite` → notifier with `lineageSource`; flag false / `already_applied` → never; real notifier → one admin email, audit order (stamp flush, then the N-2 entry); champion cohort → nothing; the same invoice twice through the real handler → one email; **replay mid-send** → `already_applied`, one email; one 4 s clock (1.5 s read leaves 2.5 s) |
| Template | `invite-accepted.adminSubscribed.test.ts` (new) | admin heading = approved subject in en/he/es; champion and N-1 unchanged |

### Gates (final diff)

| Command | Result |
|---|---|
| `npx jest lib/business-os/invites lib/business-os/billing app/api/public/invites app/invite app/api/admin/business-os/invites app/admin/business-os-invites app/api/business-os/billing app/api/stripe lib/repositories/__tests__ lib/email lib/business-os/entitlements supabase/migrations/__tests__` | **301 suites, 11451 tests, 0 failed** |
| `npm run test:bos-entitlements` (G-4) | **264 suites, 7869 tests, 0 failed** |
| `npm run typecheck:bos-llm` | **passed**, 530 files in scope, 28 errors, **0 new** (the one baseline entry it reports as fixed, `app/api/onboarding/build/route.ts` TS18047, is not P-9.2's). A first run caught one new error, an `admin_invite` hold fixture without `grantId` in `heldPaymentView.test.ts`, fixed before this run |
| `tsc` over the 41 touched code files plus every file importing the changed modules (scratch tsconfig, 150 files) | 0 errors in any touched file or in any error mentioning the changed types; the only error in a touched file is the pre-existing TS1501 at `awaitingPayment.render.test.tsx:398` (present on `origin/main`) |
| `eslint` on the 41 touched code files | 0 errors; 1 pre-existing `no-explicit-any` warning (`lib/repositories/types.ts:516`, not a changed line) |
| `npm run lint:hooks` | clean, exit 0 |
| `console.*` or a tier literal in added lines | none |

### T9 (P-9.2 share): demo checklist for TL / the user

Prerequisites (§8): the standard sandbox `acct_1UPKR4C7KDUGYIcA` with `stripe listen` forwarding; locally only, never committed: `BUSINESS_OS_PLAN_CHECKOUT_ENABLED=true`, `BUSINESS_OS_PLAN_PRICES_ENABLED=true`, `paidInvitesAvailable: true`; an admin mailbox the user reads; a fresh invitee address.

| Step | Do | Expect |
|---|---|---|
| D1 | `/admin/business-os-invites` → New invite → Paid | Plans "Essentials · $79 a month", "Autopilot · $129 a month"; the note "The invitee pays this plan at signup and cannot use AgentPilot until they have paid." |
| D2 | Issue an Autopilot Paid invite, Hebrew | Link created; invitation says payment required |
| D3 | Open the link signed out | Autopilot, $129 a month, what it includes, and **"נדרש תשלום בעת ההרשמה."** (RTL); with either env switch off it reads "payment opens soon" instead |
| D4 | Sign up with the code | Holding screen: "Finish your payment", Autopilot, "$129 a month, excluding tax", Pay |
| D5 | Admin inbox | One N-1 "Signed up — not subscribed yet" |
| D6 | Admin list | Accepted, L1, **"Signed up, not paid"** |
| D8 | Pay with `4242 4242 4242 4242` | Processing, then onboarding |
| D9 | Read-only SQL; Tiers page | Plan row `tier = 'pro'`; lineage `first_paid_at` and `first_payment_ref` set once; one `BOS_BILLING_FIRST_PAYMENT_STAMPED`, one `BOS_BILLING_INVOICE_PAID` (AC-F3.1) |
| D10 | Admin list | Paid · date · $129.00 USD · Test payment |
| **D10a (T10)** | Admin inbox | **Exactly one** "Your invitation turned into a subscription" email (heading the same), "{invitee} has subscribed.", status "Subscribed", button "Open invites"; one `BOS_INVITE_INVITER_NOTIFIED` on the invite with `event: subscribed`, `recipientKind: admin` |
| D11 | Resend `invoice.paid` from the sandbox | `already_applied`; nothing changes, **no second admin email** |
| D11a | (optional) Before paying, try the checkout for Essentials from the browser console | 409 `held_tier_not_allowed` |
| D13 | Same day | Cancel the sandbox subscription; revoke unused demo invites; revert the local flips (`git diff lib/business-os/entitlements/config/invites.ts` empty); Danger Zone cleanup of the test account |

---

## SA Code Review — P-9.2 (2026-10-14)

**Code Review by SA — 2026-10-14**
**Status:** ✅ Code Approved (APPROVED WITH FIXES: one comment-only fix applied by SA, listed below; nothing for Dev to redo)

Reviewed in the worktree `neuronforge-invite-s1`, branch `feature/bos-plan-payments-p9-2` on `origin/main` `392a9b53`, uncommitted: 35 modified files (+894/−149) and 9 new test files. Read in full: the diffs of `paymentHold.ts`, `planCheckoutEligibility.ts`, `heldPaymentView.ts`, `publicInviteView.ts`, `app/invite/page.tsx`, `invitePageCopy.ts`, `adminInviteOps.ts`, `CreateInviteForm.tsx`, the admin `types.ts`, `planPaymentApply.ts`, `championSubscribedNotification.ts`, `inviterNotification.ts`, `invite-accepted.ts`, the invite repository, `lib/repositories/types.ts` and the registry; every removed line in the 17 edited test files; the new parity matrix, the T10 notifier tests and the replay-mid-send case. Also read, unchanged: `planBillingHandler.ts` wiring, `inviterNotificationDeps.ts`, `paymentHoldGate.ts`, and the two other hold readers (`boostCheckout.ts`, `creditAdminOps.ts`). Skills applied: `tenant-isolation-guard`, `business-os-entitlements` (review checklist), `business-os-schema-check` (`grant_id` NOT NULL, `issuer_admin_id`, `grant_kind` on `business_os_invites`, 20261012).

### Gates SA ran on the final diff

| Command | Result |
|---|---|
| `npx jest` over invites, billing, public invite routes, `app/invite`, admin invite route and page, billing routes, Stripe, repositories, email, entitlements, migration guards | **301 suites, 11451 tests, 0 failed** |
| `npm run test:bos-entitlements` (G-4) | **264 suites, 7869 tests, 0 failed** |
| `console.*` in any touched non-test file (whole file, not only added lines) | none |
| Tier literal (`'basic'`, `'pro'`, plan names) in added non-test lines | none |

`typecheck:bos-llm` and eslint were not re-run by SA; Dev's recorded runs (0 new errors, 0 lint errors) are relied on. The union change to `PaymentHold` is the one type risk, and every consumer (`planCheckout`, `boostCheckout`, `creditAdminOps`, the gate, the holding screen) reads only `ok` / `held` / `source`, so the narrowing cannot break them.

### Mutation checks (one at a time; each restored by re-editing and md5-verified)

| # | Mutation | Caught by |
|---|---|---|
| SM-1 | `adminMismatchOf`: drop "redeemed by this account" | `championSubscribedNotification.admin.test.ts` (1 red) |
| SM-2 | Notifier: a champion's own (cohort) first payment no longer stops before the send | admin notifier test and `planPaymentApply.n2.test.ts` (2 red) |
| SM-3 | `heldInviteOffer`: an admin invitee pays its `grantId` without the `sellableTiers()` check | 7 billing suites incl. the P5-C5 matrix through the real route, `heldPaymentOffer.admin`, checkout, eligibility, holding screen |
| SM-4 | Public view: an admin tier invite says `required` without asking `heldInviteOffer` (ignores the switches) | `invitePaymentStatement.agreement.test.ts` (6 red) |
| SM-5 | Create: the unpayable-Paid-grant refusal is skipped | `adminInviteOps.paid.test.ts` (1 red) |
| SM-6 | Hold: an empty `grant_id` becomes a held result instead of `{ ok: false }` | `paymentHold.adminGrant.test.ts` and `planCheckout.test.ts` (2 red) |

md5 after restore, equal to the value before the first mutation: `paymentHold.ts` `5bc1ba75155181742ddab7790cde299f`, `championSubscribedNotification.ts` `beea76523ba3f5eafe1ebd40398c967d`, `planCheckoutEligibility.ts` `151702573b052ac86d55c49aa35345fa`, `publicInviteView.ts` `6373c5d7f34fc4eb851d39f53fafdfb1`, `adminInviteOps.ts` `308aa147219814491ecadb62d2aa88d4`; `planPaymentApply.ts` `dcc6b920b7242cdac681deeafd87237e` (not mutated).

### Conditions

| # | Verdict | Evidence |
|---|---|---|
| C-3 | ✅ | `sellableTiers()` is the only price rule at the form, create, redemption (P-9.1), the public view and `heldInviteOffer`. No `buyableTiers()` and no `INVITE_TYPES.paid.grantIds` as a list in any admin Paid decision (source pins in `heldPaymentOffer.admin.test.ts` and `adminInviteOps.paid.test.ts`). `paymentHold.ts` gains no import (its pin stays green). Import graph: `planCheckoutEligibility.ts` imports config, two flag readers and `import type { PaymentHold }` only; no billing module imports `adminInviteOps`, `publicInviteView` or `inviteOffer`. No runtime cycle; both new invites → billing imports carry the C-3 comment |
| C-4 | ✅ | `planMonthlyPriceUsd` is the only new entitlements symbol, on the existing `adminInviteOps.ts` entry with a matching `why`. No admin route changed, so `requireAdmin` stays the first statement (CI guard). The new 409 `grant_not_available` sits after the pre-existing pure checks and before any repository call (SM-5). The admin page is unchanged apart from `CreateInviteForm.tsx` rendering the server's `note`; it stays inside the shared admin layout |
| C-5 | ✅ | `PaymentHold` held variant is the union, `grantId: string` only on `admin_invite`; the friend's invite is still never read (R-3, pinned). Empty / null / undefined `grant_id` → `{ ok: false }` (SM-6). The matrix runs {friend, admin basic, admin pro, admin unknown, friend unpriced} × 8 switches through the REAL checkout route, trying every tier per cell, and asserts the expected tier per cell, not only agreement |
| C-6 | ✅ | `heldInviteOffer` is the one step; `heldPaymentOffer` delegates to it; the public view calls it for friend (`account_invite`) and admin tier (`row.grant_id`) with injectable switches; `invitePaymentStatement.agreement.test.ts` pins page `required` ⇔ `heldPaymentOffer` pay ⇔ `readHeldPaymentView` pay (SM-4). The client reads `required` only when the server sent it; anything else on a paid offer reads "opens soon" (D2-7) |
| C-7 | ✅ | `copy.paymentRequired` rendered; no new copy key (pinned in the page render test); CR-1 comment updated |

### T10 (G-6 = yes)

| Check | Verdict |
|---|---|
| Exactly once | ✅ Only `firstPaymentStamped === true` on `applied`/`recorded` reaches `notifyFirstPayment` (unchanged); a replay is `already_applied`; the replay-mid-send case runs through the real handler and sends one email |
| Admin found only from the payer's own lineage invite | ✅ `inviteId` from the paying account's lineage row; `issuer_admin_id` from that invite's row; nothing from Stripe metadata |
| Invite must be admin-issued and redeemed by the payer | ✅ `adminMismatchOf` → `invite_mismatch`, `alert: true`, NOT_NOTIFIED audit (SM-1) |
| Active admin, live auth email | ✅ `notifyInviter` with `issuerKind: 'admin'` runs N-1's `isActiveAdmin` (`AdminAccessService.isAdminById`, `admin_users`) and `findUserIdentity`; production wiring in `planBillingHandler.ts` provides both through `buildInviterNotificationDeps` |
| Same 4 s clock | ✅ One `deadlineMs`; the 1.5 s-read case leaves 2.5 s |
| Audit | ✅ entity `business_os_invite`, `userId`/`actorId` null, `recipientKind: 'admin'`; no address in logs or audits (pinned) |
| Champion cohort first payment | ✅ info line, no audit, no email, no admin lookup (SM-2) |
| Friend path | ✅ unchanged; a friend lineage pointing at an admin invite is still `not_a_friend_invite` |

### Tenant isolation (`tenant-isolation-guard`)

✅ No new request field anywhere. The held tier is read on the server from the invite named by the session account's own lineage row (`findHoldFactsById`, one extra column on the same PK read); the checkout admits only the tier `heldInviteOffer` answers, and the client's named tier is checked against it. The webhook path is service-role with no session: the account comes from OUR billing record (SR-8), the invite from that account's lineage, the admin from that invite, and the invite must be redeemed by the payer before anyone is emailed. The repository's two widened selects stay one-row PK reads with no hash, no reply-to, no note.

### Entitlements (`business-os-entitlements` review checklist)

✅ Only `adminInviteOps.ts` gains a symbol (`planMonthlyPriceUsd`, display only, from the injected config); its non-gate classification is correct (issuance rule on who may invite, not a capability). `publicInviteView.ts` and `planCheckoutEligibility.ts` import nothing new from the module (`heldInviteOffer` reuses the symbols already registered for `planCheckoutEligibility.ts`). No tier literal in code. `npm run test:bos-entitlements` green.

### Rulings on D2-1 to D2-10

| # | Ruling |
|---|---|
| D2-1 | **Accepted.** Q-10 needs `issuer_admin_id` and `grant_kind`; same one-row PK read, same single caller (C-7 guard). Column-list test updated on purpose |
| D2-2 | **Accepted.** Optional `lineageSource`, absent = friend, keeps P-5b.1's callers and the "the lineage decides whom to look for" cross-check |
| D2-3 | **Accepted.** One bounded invite read on a champion's own first payment is the price of not importing invites into billing (C-8); it happens once per account lifetime. The reworded unwired alert is correct |
| D2-4 | **Accepted.** The approved N-2 subject is a correct admin heading in all three languages; no G-3 approval owed |
| D2-5 | **Accepted: consistent with C-3.** C-3 forbids `buyableTiers()` and `INVITE_TYPES.paid.grantIds` as the *source of the tier list or the price rule*. The list here comes from `sellableTiers()`; `isInviteGrantAvailable` is the pre-existing GR-1 "the config still carries this grant for an invite type" check that create already ran and that `adminPaidInviteRedemption` runs, so the form and create apply exactly the two tier halves of the redemption predicate and issuance ⊆ redeemable. `heldInviteOffer` deliberately checks `sellableTiers()` alone: once an invitee is held, the only question is whether their tier can be bought |
| D2-6 | **Accepted.** Offering a type whose create always answers 409 would be worse |
| D2-7 | **Accepted.** The safe default is the line that never promises a payment |
| D2-8 | **Accepted.** Same condition, W-2 shape (account id and source only) |
| D2-9 | **Accepted.** This is exactly C-5's ruling: an empty `grant_id` is impossible by schema (NOT NULL, and every writer copies a payable tier), so it is a read anomaly, and Q-2 treats every unreadable hold the same way: the page gate fails open with an error log, while every path that SELLS or GIVES (plan checkout, holding screen, boost checkout, admin credit grant) fails closed. Making this one case fail closed at the gate would need a third hold outcome for a state the schema rules out. SM-6 pins it |
| D2-10 | **Accepted, verified line by line.** Every removed test line was read. The "until P-9" admin cases in `planCheckout.test.ts`, `planCheckout.qa.test.ts`, `planCheckoutEligibility.test.ts`, `heldPaymentView.test.ts` and the checkout route test now use an unpriced admin tier and keep their fail-closed assertion; the rest are fixture widenings (`grant_id`, the two N-2 columns, the `payment` key, the allow-list) and the narrowed P-5b.1 "admin_invite sends nothing" case (organic only, its admin half moved to the T10 block). No money assertion was weakened; no Stripe webhook or credit suite was edited |

### Fixes applied by SA

1. `lib/business-os/invites/inviterNotificationDeps.ts`: the service-role justification comment described N-2's recipient as `issuer_account_id` only. It now also names the T10 case (`issuer_admin_id` of the same invite, admin-issued and redeemed by the payer, `isActiveAdmin` before any send). Comment only.

### Code Review Comments

None blocking.

### Optimisation Suggestions

- **O-2** (Low) The gate's "Payment hold unreadable; failing open" line in `paymentHoldGate.ts` carries no `alert: true`. A persistent unreadable hold (D2-9, or a lineage read failing) is an account getting in unpaid; an alert flag would surface it. Pre-existing and outside this diff; consider it when the gate is next touched.

### QA focus

1. **Inert in the shipped state** (`paidInvitesAvailable: false`, env switches off): admin Paid links still `unavailable`; the admin form shows the Paid type unavailable with the existing reason; a friend invite page shows "payment opens soon", not "required".
2. **Parity, switches flipped locally only:** an admin Autopilot invitee sees "Payment is required at signup" on the link, Pay for Autopilot on the holding screen, and a 409 `held_tier_not_allowed` for Essentials; with any one switch off, the link says "opens soon" and the screen "coming soon".
3. **Admin form:** grants read "<plan> · $<price> a month" with the note; with no priced tier the Paid type is unavailable ("No plan has a price yet"); a direct POST of an unpriced tier returns 409 `grant_not_available` with no row written.
4. **T10:** after the first `invoice.paid`, exactly one admin email (approved N-2 subject as heading, "{invitee} has subscribed.", button "Open invites") and one `BOS_INVITE_INVITER_NOTIFIED` with `recipientKind: admin`; resending the event sends nothing. A champion (cohort) invitee's own first payment sends nothing and audits nothing.
5. **Friend regression (P-5b.1):** a friend's first payment still emails the champion once; the friend checkout still refuses the higher tier.
6. **Run-sheet T9 D1 to D13**, same-day cleanup and revert of the local flips.

### Code Approved for QA: **Yes**

---

## QA Testing Report (P-9.2)

### QA — P-9.2 "Admin invitee pays and gets in" (2026-10-14)

**Test mode:** full (SA QA focus 1 to 5; focus 6 is the user's session, covered by the tightened run-sheet below)
**Strategy used:** A (Jest over the real modules with injected deps and switches) + B-lite (route-level Jest with mocked repositories, incl. the REAL checkout route in the P5-C5 matrix and the REAL admin invites route in QA's temporary cases) + code reading of every non-test diff. No browser, no database, no Stripe, no real email in this session.
**Focus:** api, ui (render tests), security, schema
**Skipped:** D (browser) and live Stripe / SQL / inbox: not available here; all in the run-sheet.
**Input source:** prompt keywords (TL trigger) + SA "QA focus"
**Worktree:** `neuronforge-invite-s1`, `feature/bos-plan-payments-p9-2` on `392a9b53`, uncommitted (36 modified, 9 new test files). Before QA started, md5 of `paymentHold.ts`, `championSubscribedNotification.ts`, `planCheckoutEligibility.ts`, `publicInviteView.ts`, `adminInviteOps.ts` and `planPaymentApply.ts` equalled SA's recorded values.

#### Test Coverage

| Acceptance criterion (SA QA focus) | Tested? | Result | Evidence |
|---|---|---|---|
| 1a. Shipped: admin Paid link `unavailable` | ✅ | Pass | `paidInvitesAvailable: false as boolean` in `config/invites.ts` (unchanged); `publicInviteView.test.ts` / `adminPaidInviteAgreement.test.ts` switch-off cells (page `unavailable`, signup 409) |
| 1b. Shipped: admin form Paid type unavailable with the EXISTING reason | ✅ | Pass | `adminInviteOps.paid.test.ts` "while the Paid switch is off"; **QA extra** through the real GET route: the payload carries `paidUnavailableReason` and never "No plan has a price yet" (the switch refusal wins over the priced check, by reading: `refusal === 'paid_invites_not_available'` is tested first) |
| 1c. Shipped: friend invite page "opens soon", not "required" | ✅ | Pass | `invitePaymentStatement.agreement.test.ts` friend × 8 switches (only all-on is `required`); production default switches = env flags off → `opens_later`; `page.payment.render.test.tsx` en/he/es |
| 2a. Switches on: admin Autopilot link "Payment is required at signup" | ✅ | Pass | agreement test (admin per tier, all on → `required`); page render test (`invite-payment-required`, one line, no "opens soon"); copy is the existing `copy.paymentRequired` (C-7, no new key) |
| 2b. Holding screen offers Pay for Autopilot | ✅ | Pass | `awaitingPayment.render.test.tsx` appended block (en/he/es, $129 in LTR `bdi`, Pay posts the model's tier); `heldPaymentOffer.admin.test.ts` |
| 2c. Essentials checkout → 409 `held_tier_not_allowed` | ✅ | Pass | `heldPaymentOffer.matrix.test.ts` through the REAL route, every other tier per cell; `planCheckout.test.ts` "invited to each tier" block (no Stripe session) |
| 2d. Any one switch off → link "opens soon", screen "coming soon" | ✅ | Pass | agreement test and matrix cover all 8 combinations; `heldInviteOffer` checks the three switches before the tier (read) |
| 3a. Form grants "<plan> · $<price> a month" + note | ✅ | Pass | `adminInviteOps.paid.test.ts`, `createInviteForm.paidNote.render.test.tsx`; **QA extra** through the real GET route |
| 3b. No priced tier → Paid type unavailable, "No plan has a price yet" | ✅ | Pass | unit test; **QA extra** through the real GET route (`sellableTiers` spied to `[]`) |
| 3c. Direct POST of an unpriced tier → 409 `grant_not_available`, no row | ✅ | Pass | unit test (before the inviter read and any write, SM-5); **QA extra** through the real POST route, every tier in `TIER_ORDER` with nothing priced: each 409 `grant_not_available`, `inserted`, `audit`, `sent` all empty. Counter-check: a priced tier → 201 with one insert `{ grant_kind: 'tier', grant_id }`. Extra `accountId` field → 400 (strict schema) |
| 4a. T10: exactly one admin email + one `BOS_INVITE_INVITER_NOTIFIED`, `recipientKind: 'admin'` | ✅ | Pass | `championSubscribedNotification.admin.test.ts` happy path (exact NOTIFIED entry, `userId`/`actorId` null, entity `business_os_invite`); `planPaymentApply.n2.test.ts` "with the real notifier: ONE email to the admin" (audit after the stamp flush) |
| 4b. `invoice.paid` resend sends nothing | ✅ | Pass | n2 "the same invoice twice through the real handler: one admin email" and "a replay arriving WHILE the admin email is still sending" (`already_applied`, one email total) |
| 4c. Champion (cohort) own first payment sends and audits nothing | ✅ | Pass | notifier "a champion paying for themself" (info line, no audit) + n2 "champion's own first payment"; SM-2 |
| 4d. Invite not redeemed by the payer → `invite_mismatch`, alerted, no email | ✅ | Pass | notifier `it.each` (four mismatches incl. `redeemed_by_another_account`, NOT_NOTIFIED with `reason: invite_mismatch`); SM-1 |
| 4e. Inactive admin → no email | ✅ | Pass | "a former admin": NOT_NOTIFIED `recipient_not_admin`, no send; production wiring uses `AdminAccessService.isAdminById` (`admin_users`, never `profiles.role`) |
| 5a. Friend regression: champion still gets exactly one email | ✅ | Pass | P-5b.1 friend cases in `planPaymentApply.n2.test.ts` and `championSubscribedNotification.test.ts` green, untouched in substance (D2-10 verified by SA line by line); notifier "the friend path is unchanged" (friend lineage + admin row → `not_a_friend_invite`) |
| 5b. Friend can't buy the higher tier | ✅ | Pass | matrix friend rows: checkout admits exactly the friend tier, refuses the rest |
| Admin email never in logs / audit | ✅ | Pass | notifier test asserts no `@` anywhere in `logs` and `audits`; read: the admin branch logs ids, `grantKind` and `source` only; mismatch audits carry `issuer_admin_id` (an id), never an address |
| Audit `userId` / `actorId` null | ✅ | Pass | exact `toMatchObject` in the notifier tests (NOTIFIED and NOT_NOTIFIED) |
| `requireAdmin` first | ✅ | Pass | `app/api/admin/business-os/invites/route.ts` GET and POST and `[inviteId]/revoke` POST: `requireAdmin` is the first statement; no admin route changed in this diff |
| No tier literals | ✅ | Pass | `git diff` added non-test lines: 0 matches for `'basic'`, `'pro'`, "Essentials", "Autopilot", `console.` ; source pins in `heldPaymentOffer.admin.test.ts` and `adminInviteOps.paid.test.ts` |

#### Mutation check (QA, one at a time, restored by re-editing, md5-verified)

| # | Mutation | Caught by | Restore |
|---|---|---|---|
| QM-1 | `app/invite/page.tsx` `paymentStatementOf`: the missing-flag fallback flipped (`data.payment === 'opens_later' ? 'opens_later' : 'required'`), so an old-server response or any unexpected value would promise "Payment is required at signup" (the D2-7 safety) | `page.payment.render.test.tsx` + `page.render.test.tsx`, **7 red** | Re-edited with the Edit tool; md5 back to `280d056d98cf0c4f338d650db4425a61`; `app/invite` 215/215 green |

The QA extra cases (4: shipped GET, unpriced GET + POST of every tier, priced GET + POST, extra-field 400) ran from a temporary copy of the admin invites route test (`zzqa.p92.tmp.test.ts`), all green, and the file was **deleted**. While it existed it made one repo-wide source guard red (`BusinessOsBillingEventRepository.test.ts` "only the listed files name the repository", because the copy inherits the repository mock): that is QA's artefact, not a P-9.2 defect; after deletion the suite was 67/67 and the full gate was re-run (below). Nothing QA wrote remains in the tree.

#### Issues Found

**Bugs (must fix before commit):** none.

**Performance issues:** none. (D2-3's one bounded invite read on a champion's own first payment is once per account lifetime, accepted by SA.)

**Edge cases / notes (none blocking):**
1. **Route-level pin for 3c missing** (Low). The unpriced-tier 409 is pinned in `adminInviteOps.paid.test.ts` against the ops function; no case goes through the POST route. QA's temporary route case proved it; adding one to `route.test.ts` would make a future handler change that bypasses `createInviteForAdmin` visible.
2. **SA O-2 stands** (Low): the gate's "hold unreadable; failing open" line has no `alert: true` (pre-existing, D2-9).
3. **Admin email language** is the ADMIN's own language (N7, recipient's preference), not the invite's. A Hebrew invite still emails an English-preferring admin in English. Correct by design; noted in the run-sheet so the user is not surprised.

#### Test Outputs

| Command | Result |
|---|---|
| `npx jest lib/business-os/invites lib/business-os/billing app/api/public/invites app/invite app/api/admin/business-os/invites app/admin/business-os-invites app/api/business-os/billing app/api/stripe lib/repositories/__tests__ lib/email lib/business-os/entitlements supabase/migrations/__tests__` | **301 suites, 11451 tests, 0 failed** (147 s; one "worker failed to exit gracefully" warning, no failure). Run before any QA file existed |
| QA extra (temporary, deleted) | 4 passed |
| QM-1 | 7 red while mutated; 215/215 after restore |
| `npm run test:bos-entitlements` | First run 263/264 suites, 7868/7869: the one red was the source guard above, caused by QA's temporary file. **Re-run after deleting it: 264 suites, 7869 tests, 0 failed.** No load timeouts |
| `npm run typecheck:bos-llm` | **passed**, exit 0: 530 files in scope, 28 errors, 0 new; one baseline entry fixed (`app/api/onboarding/build/route.ts` TS18047), not P-9.2's |
| `npm run lint:hooks` | **clean**, exit 0 |

#### T9 run-sheet for the user's session (P-9.2 share, tightened by QA)

**Before you start (localhost only, never committed).**
- Stripe: the standard sandbox `acct_1UPKR4C7KDUGYIcA`, with `stripe listen --forward-to localhost:3000/api/stripe/webhook` running and its `whsec_` secret in `.env.local`.
- `.env.local`: `BUSINESS_OS_PLAN_CHECKOUT_ENABLED=true`, `BUSINESS_OS_PLAN_PRICES_ENABLED=true`.
- `lib/business-os/entitlements/config/invites.ts`: `paidInvitesAvailable: true`.
- **Restart `npm run dev`** after the flips (the env flags are read by the server at start).
- An admin account whose inbox you read (the admin emails arrive in that admin's own language preference), and a fresh invitee address that has never signed up.

| Step | Do | Expect |
|---|---|---|
| D1 | `/admin/business-os-invites` → New invite → Paid | Plans "Essentials · $79 a month" and "Autopilot · $129 a month"; under them "The invitee pays this plan at signup and cannot use AgentPilot until they have paid." |
| D2 | Issue an **Autopilot** Paid invite, language Hebrew, to the fresh address | Link created; the invitation says payment is required |
| D3 | Open the link signed out (private window) | Autopilot, $129 a month, what it includes, and **"נדרש תשלום בעת ההרשמה."** (RTL). Nothing says "payment opens soon" |
| D3b | (optional, before D4) Set `BUSINESS_OS_PLAN_CHECKOUT_ENABLED=false`, restart, reload the link; then set it back to `true` and restart | With the switch off: "payment opens soon" and no "required" line. Back on: "required" again |
| D4 | Sign up with the emailed code | Holding screen: "Finish your payment", Autopilot, "$129 a month, excluding tax", a Pay button. No way into the app |
| D5 | Admin inbox | **One** N-1: "Signed up — not subscribed yet" |
| D6 | Admin list | Accepted, L1, **"Signed up, not paid"** |
| D11a | (optional, before paying) On the holding screen, browser console: `fetch('/api/business-os/billing/plan/checkout',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({tier:'basic',returnTo:'awaiting_payment'})}).then(r=>r.json()).then(console.log)` | `success: false`, error `held_tier_not_allowed` (status 409). No Stripe session opens |
| D8 | Click Pay; card `4242 4242 4242 4242`, any future date, any CVC | Processing, then onboarding; `stripe listen` shows `invoice.paid` → 200 |
| D9 | Read-only SQL below (one query per tab); Tiers page | Q1: `tier` = `pro`, `cohort` empty. Q2: `admin_invite`, level 1, `first_paid_at` and `first_payment_ref` both set. Q3: one `BOS_BILLING_FIRST_PAYMENT_STAMPED`, one `BOS_BILLING_INVOICE_PAID`, one `BOS_INVITE_INVITER_NOTIFIED` (details `event` subscribed, `recipientKind` admin, `user_id` and `actor_id` empty), **no** `BOS_INVITE_INVITER_NOT_NOTIFIED` |
| D10 | Admin list | "Paid · <today> · $129.00 USD" and "Test payment" |
| **D10a (T10)** | Admin inbox | **Exactly one** "Your invitation turned into a subscription" email (heading the same as the subject), "<invitee> has subscribed.", status "Subscribed", button "Open invites" |
| D11 | `stripe events resend <evt_id of that invoice.paid>` | Webhook 200, outcome `already_applied`; re-run Q3: still one of each row; **no second admin email** |
| D13 | **Same day** | Cancel the sandbox subscription in the Stripe dashboard; revoke every unused demo invite from the admin list; set `paidInvitesAvailable` back to `false` and remove the two env lines; confirm `git diff lib/business-os/entitlements/config/invites.ts` is empty; restart dev; the test account may then go through the Danger Zone cleanup |

Read-only SQL for D9 and D11 (no comments, no punctuation inside strings, the forbidden word never appears). Each picks the newest redeemed admin Paid invite, so run them right after D8:

```sql
SELECT plan_row.user_id, plan_row.tier, plan_row.cohort, plan_row.origin, plan_row.updated_at
FROM public.business_os_account_plans AS plan_row
JOIN public.business_os_invites AS invite_row ON invite_row.redeemed_account_id = plan_row.user_id
WHERE invite_row.issuer_kind = 'admin' AND invite_row.grant_kind = 'tier' AND invite_row.redeemed_at IS NOT NULL
ORDER BY invite_row.redeemed_at DESC
LIMIT 1;
```

```sql
SELECT lineage_row.source, lineage_row.level, lineage_row.parent_account_id, lineage_row.first_paid_at, lineage_row.first_payment_ref
FROM public.business_os_account_lineage AS lineage_row
JOIN public.business_os_invites AS invite_row ON invite_row.id = lineage_row.invite_id
WHERE invite_row.issuer_kind = 'admin' AND invite_row.grant_kind = 'tier' AND invite_row.redeemed_at IS NOT NULL
ORDER BY invite_row.redeemed_at DESC
LIMIT 1;
```

```sql
SELECT audit_row.action, audit_row.entity_type, audit_row.user_id, audit_row.actor_id, audit_row.details, audit_row.created_at
FROM public.audit_trail AS audit_row
JOIN (
  SELECT invite_row.id::text AS invite_key, invite_row.redeemed_account_id::text AS account_key
  FROM public.business_os_invites AS invite_row
  WHERE invite_row.issuer_kind = 'admin' AND invite_row.grant_kind = 'tier' AND invite_row.redeemed_at IS NOT NULL
  ORDER BY invite_row.redeemed_at DESC
  LIMIT 1
) AS newest ON audit_row.entity_id::text IN (newest.invite_key, newest.account_key)
WHERE audit_row.action IN ('BOS_BILLING_FIRST_PAYMENT_STAMPED', 'BOS_BILLING_INVOICE_PAID', 'BOS_INVITE_INVITER_NOTIFIED', 'BOS_INVITE_INVITER_NOT_NOTIFIED')
ORDER BY audit_row.created_at;
```

Q3 lists the D5 N-1 entry too (`event` accepted); count only the `subscribed` one for D10a.

#### Final Status

- [x] All P-9.2 acceptance criteria in scope for QA pass — **PASS WITH NOTES** (notes: a route-level pin suggestion for the 409, SA O-2, and the admin-email language reminder; no bug)
- Still owed before merge, by the user: the run-sheet above (G-5) or a waiver, and seeing the diff (standing preference)

---

## Commit Info

*(RM populates this section.)*

---

## Change History

| Date | Change | Details |
|---|---|---|
| 2026-10-14 | Workplan written (Dev) | On `feature/bos-plan-payments-p9` (cut from `origin/main` `396cafa6`; `096f86e0` merged at T0). One migration, 20261029 (new finalise for admin Paid invites; verified free and safe to sort before 20261030+). ≈ 3.2d, split proposed into P-9.1 "Admin invitee signs up and is held" (≈ 1.75d) and P-9.2 "Admin invitee pays and gets in" (≈ 1.45d, ≈ 2.05d with N-2 to the admin). SA points Q-1 to Q-10; one business question (N-2 to the issuing admin, recommended yes). Awaiting SA review |
| 2026-10-14 | SA workplan review (SA) | **APPROVED WITH CONDITIONS** C-1 to C-12; Q-1 to Q-9 ruled (new INVOKER function; `paidInvitesAvailable`-only redemption gate; `sellableTiers()` everywhere for admin Paid, per P-4.1 M-1; `grantId` on the admin held variant only; FR-22 `required` from the same helper as `heldPaymentOffer`; 20261029 verified free and safe before 20261030 to 20261060; price via `planMonthlyPriceUsd(config, …)`; one predicate returning a reason). Q-10 approach approved only if the user says yes. Split confirmed: P-9.1 then P-9.2, not stacked; §9.5 row 17 to say "after P-9.2". Existing `paymentRequired` copy reused, no new key |
| 2026-10-14 | G-6 answered (user, via TL) | **YES**: the issuing admin gets the "{email} has subscribed" email. T10 is in P-9.2 (≈ 2.05d). Requirement BQ-P11 (§10.5) |
| 2026-10-14 | P-9.1 implemented (Dev) | T1 to T4 and the P-9.1 share of T9 (checklist); C-1, C-2, C-8, C-9, C-10, C-11, C-12 (and C-3 for redemption and the view). 20261029 + pre-check, checker, probe, F11 count, rollback, run on PGlite (pre-check PASS 7/0, checker PASS 7/0, PROBE PASS with and without existing plan and lineage rows, F11 PASS, rollback and re-apply clean, M1 to M9 caught). T0 merge refused by git over the uncommitted requirement (not stashed): left to RM. Deviations D-1 to D-11 for SA in Implementation Notes (P-9.1). Uncommitted |
| 2026-10-14 | SA code review of P-9.1 (SA) | **Code approved for QA** (approved with one SA doc fix: the requirement's P-9 row no longer claims the T0 merge happened). C-1, C-2, C-8 to C-11 verified, C-12 deferred to RM (D-1). D-1 to D-11 accepted; D-8 recorded as follow-up F-1; the D-1 admin-list pin moves to P-9.2. SA re-ran the suites (62 suites, 4623 tests), `test:bos-entitlements` (258 suites, 7623 tests) and `typecheck:bos-llm`, all green. Five mutations, each caught and restored by md5. QA focus listed in "SA Code Review — P-9.1" |
| 2026-10-14 | QA of P-9.1 (QA) | **PASS WITH NOTES**. 229 suites / 9704 tests green over the requested scope; 5 temporary extra cases (revoked, expired, resubmit after success, `already_finalised` sends one N-1, Google existing account) green and deleted; `test:bos-entitlements` 7622/7623 with one load-sensitive timeout in an untouched admin-credits render test that passed 69/69 on its own; `typecheck:bos-llm` passed, `lint:hooks` clean. Independent paste-rule scan of all six SQL files clean. Mutation QM-1 (lineage parent) caught, restored, md5-verified. No bugs; demo run-sheet with read-only SQL added to the QA section |
| 2026-10-14 | P-9.1 merged; G-2 recorded; P-9.2 implemented (Dev) | P-9.1 merged as #373; 20261029 applied to production (pre-check PASS 7/0, checker PASS 7/0 with C3 `576c2e80149a372d7cc1dce490e0de4f`, PROBE PASS F01 to F10 and F12, F11 PASS), recorded here and in requirement §9.3. P-9.2 on `feature/bos-plan-payments-p9-2` (from `origin/main` `392a9b53`): T5 to T8 and T10 under C-3 to C-7 and Q-10, plus the required pins (SA D-1 admin list "Signed up, not paid", QA revoked / expired / resubmit, SA O-1). No migration, no new he/es strings. Deviations D2-1 to D2-10 for SA. Suites 301 / 11451, `test:bos-entitlements` 264 / 7869, `typecheck:bos-llm` 0 new, `lint:hooks` clean. Uncommitted, awaiting SA code review. Details in Implementation Notes (P-9.2) |
| 2026-10-14 | SA code review of P-9.2 (SA) | **Code approved for QA** (approved with one SA comment-only fix in `inviterNotificationDeps.ts`). C-3 to C-7 and T10 (Q-10) verified; D2-1 to D2-10 accepted (D2-5 consistent with C-3; D2-9 is C-5's ruling, gate fail-open per Q-2, every selling path fails closed). SA re-ran the suites (301 / 11451) and `test:bos-entitlements` (264 / 7869), all green. Six mutations (SM-1 to SM-6), each caught and restored by md5. O-2 (gate alert flag) suggested, not blocking. QA focus in "SA Code Review — P-9.2" |
| 2026-10-14 | QA of P-9.2 (QA) | **PASS WITH NOTES**. 301 suites / 11451 tests green over the requested scope; 4 temporary route-level extras (shipped form, unpriced GET + POST of every tier → 409 `grant_not_available` with nothing written, priced POST → 201, extra field → 400) green and deleted; `test:bos-entitlements` 264 / 7869 green (a first run's single red was QA's own temporary file tripping a source guard, cleared by deleting it); `typecheck:bos-llm` 0 new; `lint:hooks` clean. Mutation QM-1 (page's missing-flag fallback) caught 7 red, restored, md5-verified. No bugs; T9 run-sheet tightened (restart after flips, D3b switch-off check, D11a console snippet, read-only SQL Q1 to Q3, `stripe events resend`) in "QA Testing Report (P-9.2)" |
