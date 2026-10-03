# Business OS Plan Payments: As-Built Inventory

> **Last Updated**: 2026-10-03

**Written by:** SA (read-only investigation, no code changed)
**Checked against:** `origin/main` `03b62c3c`, worktree `neuronforge-invite-s1`. In-flight worktrees were read as well: credit deduction slice 11 (`neuronforge-llm-layer2-step4`, uncommitted) and the Credits Boost requirement, which is untracked in the main checkout.
**Scope:** grounds the scoping of Business OS plan payments: S-4a (buy path), invite Slice 5c (the friend pays at signup), recurring billing, and admin monitoring.

## Overview

The [reuse plan](/docs/requirements/BUSINESS_OS_TIER_BILLING_REUSE_PLAN.md) (plan of record, last updated 2026-09-27) still describes the Stripe side accurately. **No part of WS-1 or WS-3 has been built.** The Stripe code changed in two ways only, and both were in the Connect (client-payment) path:
- dispute handling was added;
- an empty-body guard was added.

Since that plan was written, the Business OS side has moved a long way:
- credit allowances are now real numbers, backed by a live charge ledger;
- friend invites are live, and the friends they bring in are held at a payment screen;
- the lineage table has its payment-stamp columns;
- the Credits Boost requirement now claims a shared Business OS webhook dispatcher.

This document records each of those facts with file:line evidence. Section 7 separates decisions that are already made from questions that are still open.

---

## 1. What changed since the reuse plan (2026-09-27)

### 1.1 Slices and workstreams

| Item | Status on 2026-10-02 | Evidence |
|---|---|---|
| **S-0 Unblock** | ✅ **Merged** in PR #120. Done: the anti-join migration `20261010`, the trim list, RD-9 held by a test, RD-10 docs, TK-2 inventory. **G-1 and TK-1 are still open.** G-2 is only partly met: Jest is still not run in CI (invite §0.8 #3) | `git log` d70e5c18; `docs/workplans/business-os-s0-unblock.md:76`; `docs/archive/BILLING_SYSTEM_COMPLETE_STATUS.md`; banners at `docs/PRICING_SYSTEM_IMPLEMENTATION_PLAN.md:3` and `docs/STRIPE_BILLING_DATABASE_STATUS.md:3` |
| **S-2 Enforcement** | ⬜ Not started. Outside the entitlements module, only two callers use the resolver: the admin route and `my-plan`. Nothing reads `chat.access`. The mode is `shadow` | grep `EntitlementService` (only `app/api/business-os/entitlements/my-plan/route.ts` and `lib/business-os/credits/ownerCreditUsage.ts`); `docs/architecture/BUSINESS_OS_ENTITLEMENTS.md:166` |
| **S-4a WS-1** (fixed prices, BOS checkout, price-id router, `assign_tier` on payment, dunning to lifecycle) | ⬜ **Nothing built.** `StripeService.ts` has no `lookup_key`. No route exists under `app/api/business-os/billing*`. The webhook has no Business OS branch | `lib/stripe/StripeService.ts:149,321` (still `prices.create`); webhook switch `app/api/stripe/webhook/route.ts:2585-2702` |
| **S-4a WS-2** | Step 1 (read-only "Your plan") ✅. Step 1b (localisation) **appears done**: the component looks up keys with `t()`, but no document records the gate as closed. Steps 2–4 ⬜. Both tiers have `availableToBuy: false` | `components/business-os/settings/PlanSection.tsx:152,215,232`; `lib/business-os/entitlements/config/tierMatrix.ts:251,262` |
| **S-4a WS-3** (retire Pilot-Credit purchase path) | ⬜ Not started. Every item on the *Dies* list is still present | §1.2 |
| **S-5 / S-3 / S-4b** | ⬜ S-5 is blocked on S-2, S-4a and G-1. **S-3 metering has been overtaken by the credit deduction work** (§4.3). S-4b boosts are now the separate **Credits Boost** requirement | Boost requirement status line |

### 1.2 F- and TK- items

| Item | Now | Evidence |
|---|---|---|
| F-5 / L-12 claim table | **Different (better):** the claim is now two-phase. `status` is `processing`, `completed` or `failed`, plus `failure_message` and `completed_at`. A `failed` row is reclaimed when Stripe retries. ⚠️ A row stuck at `processing` (for example after a function timeout) is **never reclaimed** | `supabase/migrations/20260828_webhook_event_status.sql`; `route.ts:2506-2569, 2716-2741` |
| F-6, F-7, F-12, L-2, L-13, L-15 | **Still true**, but line numbers have moved by +1 | fallback `route.ts:67-78`; description heuristic `:99-101`; dunning `:347-447`; seed `StripeService.ts:83-93` |
| F-18 / six quota calls | Still present: webhook `:329, :572, :717, :806, :877`, plus `sync-subscription/route.ts:241` | grep |
| F-19 / F-20 / L-35 dead UI | Still present: `PlanManagementTab.tsx`, `BillingSettingsV2*.tsx`, `app/v2/billing/page.tsx.bak` | `ls` |
| F-21 tier numbers | **Stale.** The allowance capability is now `credits.allowance`: `basic` 19,750/month, `pro` 32,250/month, matrix v2. Champion follows `pro` (Q-B3 was reversed 2026-09-27) | `tierMatrix.ts:148,215,219-221` |
| F-23 `ALWAYS_SUFFICIENT` | Still the balance source. The **ledger is live and charging**, but nothing is refused until credit slice 9 | `lib/business-os/entitlements/balance.ts:45`; `EntitlementService.ts:97` |
| **F-28 / TK-6** (BOS usage route reads `user_subscriptions`) | ✅ **Done as a side effect** of credit deduction slice 6a, which rewrote the route. No Business OS route or lib reads `user_subscriptions` now. The only mentions left are in the deletion/purge registries | `git log` 0e3815a2; grep of `app/api/business-os`, `lib/business-os` |
| **TK-1** (are the four subs live-mode?) | ⬜ **No outcome recorded anywhere.** Still the only item with a live-money clock | `business-os-s0-unblock.md:58` |
| TK-2 | ✅ Confirmed (S-0 §7) | `business-os-s0-unblock.md:213-250` |
| TK-3 (`free_tier_expires_at`) | ⬜ Undecided. The cron is still unscheduled (13 crons in `vercel.json`, none of them this one), and a test holds it there | `vercel.json`; `app/api/cron/check-free-tier-expiration/route.ts:34-37` |
| **TK-4** (webhook to Pino) | ⬜ Not done. The webhook still has **173** `console.*` calls. **The user approved the conversion** as Credits Boost slice 0: a separate mechanical PR, to land *before* any Business OS hook | grep count; boost req §18.8 gate table, row "0" |
| TK-5 (agent-platform boost checkout) | ⬜ Undecided. Still live at `create-checkout/route.ts:47,129` and `route.ts:466` | |
| L-18 / Q-T3 (`billing_events` product dimension) | ⚠️ **Complication:** the table has **no CREATE migration in the repo** (boost HZ-12). Its shape is only knowable from the live DB and the inserts at `route.ts:264-276`. Note also that `stripe_event_id` is filled with `invoice.id` (`:274`) | `ls supabase/migrations`; boost req T-16 |
| Q-T2 "`assign_tier` inherits the audit entry" | ⚠️ **Only partly true.** `executeAdminOp` does not audit. The **route** does the audit and the cache invalidation. `AdminOpContext` also requires an `adminId`, which is written to `updated_by_admin_id`, and a webhook has none | `lib/business-os/entitlements/adminOps.ts:164-181, 213-245, 572-586`; `app/api/admin/business-os/entitlements/accounts/[accountId]/route.ts:19,234` |
| RD-8 / Q-B6 (5-day paid grace) | ⚠️ **Config disagrees:** `subscriptionGraceHistory` is **7 days** | `lib/business-os/entitlements/config/lifecycle.ts:28` |

---

## 2. Stripe: what exists, and what is reusable for Business OS

| Capability | As built | BOS reuse |
|---|---|---|
| SDK init | One secret key, API version `2025-10-29.clover`, singleton `getStripeService()` | ✅ As-is (`StripeService.ts:25-32, 782-788`) |
| Products / prices | **None fixed.** `prices.create` is called per checkout (`:149`) and per upgrade (`:321`), and **no `lookup_key` exists anywhere** | ⬜ BUILD (L-10, Q-T1) |
| Customer | `getOrCreateCustomer` reads and writes **`user_subscriptions.stripe_customer_id`**, and seeds a hard-coded Pilot-Credit row (`:37-96`) | ⚠️ **Not reusable as-is.** See the storage gap in §6 G-4 |
| Checkout | Embedded `mode: 'subscription'`, metadata `user_id`/`credits` on session and subscription (`:107-196`). `create-checkout` validates by hand, not with Zod. It writes through `supabaseServer` because of the `user_subscriptions` lockdown (`create-checkout/route.ts:92-100`) | Envelope ✅. Route ⬜ (new BOS route per `new-api-route`) |
| Portal | `createPortalSession(customerId, returnUrl)` (`:280-290`). The route reads the customer id from `user_subscriptions` | Method ✅. Route ⬜ |
| Invoices | `listInvoices` (`:393`). `invoices/route.ts` builds its own `createClient` service-role client and uses `console.*` | Method ✅. Route ⬜ |
| Proration | `update-subscription`: upgrade `always_invoice`, downgrade `none` (`:350`). This is minting a new amount, not switching to a different price | Policy ✅ (RD-7). Code ⬜ (swap the price id) |
| Cancel / reactivate | `cancel_at_period_end` true/false (`:364-381`); routes key on `user_subscriptions` | Methods ✅. Routes ⬜ |
| Dunning | `handleInvoicePaymentFailed` (`route.ts:347-447`): retry count and grace (per-user, then `payment_grace_period_days`, then 3), then `past_due` with agents paused, plus `billing_events` and a `PAYMENT_FAILED` audit. **No email** (`:447` TODO). Stripe Smart Retries come from dashboard settings | Shape only (L-16). BOS has **no `past_due` writer**: `lifecycle.ts:192` comments "past_due is Slice 4" |
| Webhook envelope | Dual secrets `STRIPE_WEBHOOK_SECRET` + `STRIPE_CONNECT_WEBHOOK_SECRET` (`:2458-2461`); two-phase claim (`:2506-2569`); `event.account` splits Connect from platform (`:2577`); 13 event cases (`:2585-2702`); release-on-error returns 500 (`:2716-2741`) | ✅ As-is (L-11/L-12). **One endpoint** (RD-4) |
| Platform `invoice.paid` | `handleInvoicePaid` (`:45`): uses metadata `user_id`, falls back to the customer's first subscription, then converts the amount to Pilot-Credit tokens and writes `user_subscriptions`, `credit_transactions` and `billing_events` | 🔴 **Live hazard today:** a BOS invoice carrying `metadata.user_id` would be converted into Pilot Credits |
| Platform `checkout.session.completed` | Boost pack (`:466`) or credit subscription. With no `credits` metadata it logs and returns (`:587-590`) | DO NOT REUSE |
| `customer.subscription.updated/deleted` | Platform only. Keyed on `metadata.user_id` and writes `user_subscriptions` (`:825`, `:2381`). Connect `deleted` goes to `handlePlanSubscriptionEnded`, which handles client instalment plans (`:2325`) | DO NOT REUSE. A BOS branch is needed |
| Disputes / refunds | `handleDispute` and `handleChargeRefunded` match **Connect `payment_transactions` only**. A platform dispute logs "unknown payment" (`:934-1021`, `:1025`) | Not covered for BOS plans |
| Not handled | `customer.subscription.created`, `invoice.upcoming`, `invoice.payment_action_required` (SCA), `checkout.session.expired`, `checkout.session.async_payment_*` | Decide per 5c/S-4a |
| Env var names | `STRIPE_SECRET_KEY` (32 refs), `STRIPE_WEBHOOK_SECRET`, `STRIPE_CONNECT_WEBHOOK_SECRET`, `STRIPE_CLIENT_ID`, `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY`. **None of them is in `.env.example`** | `docs/workplans/environment-readiness-staging.md:260` |
| Connect-only | `StripeService.ts:413-776`; `StripeInvoiceService.ts` (its own private `getOrCreateCustomer`, **not** the Q-T8 one) | Leave untouched |

---

## 3. Business OS plan side

### 3.1 The plan row (`business_os_account_plans`, `supabase/migrations/20261005_business_os_entitlements.sql:83-138`)

| Field | Meaning | Payment relevance |
|---|---|---|
| `tier`, `plan_version` | Commercial assignment; a CHECK requires `plan_version > 0` when a tier is set | 5c writes `basic` at the matrix version |
| `tier_expires_at` | **The paid-through date.** The column comment reads "Stripe current-period end from Slice 4". NULL means forever | `invoice.paid` moves it forward |
| `cohort`, `cohort_expires_at` | Trial or champion | Unchanged by payment |
| `trial_*`, `grace_ends_at` | Admin pins of derived dates | — |
| `period_anchor` | Credit-period anchor. The comment reads "Becomes the Stripe billing-cycle anchor in Slice 4" | ⚠️ `assign_tier` **resets it to now** (`adminOps.ts:409`), which restarts the credit period |
| `origin`, `updated_by_admin_id` | Provenance; the actor uuid has no FK | A webhook actor needs a decision |
| **Missing** | No `status` column, no `stripe_customer_id`, no `stripe_subscription_id`, no `cancel_at_period_end` | §6 G-4 |

**Status is derived, not stored.** `deriveLifecycle` (`lib/business-os/entitlements/lifecycle.ts:132-256`) works it out at read time:
- a tier in force gives `active`;
- an expired tier falls back to a live cohort, or else moves to `grace` and then `paused`, using `subscriptionGraceHistory`;
- a missing row or missing assignment gives `unknown`.

The basis is `tier`, `cohort` or `none`. The other states are `LifecycleState = trial | champion | active | past_due | grace | paused | unknown` (`types.ts:344`). The overlay in `config/lifecycle.ts:46+` defines `past_due` as LIVE, but **nothing ever produces `past_due`**. No cron moves any state.

**Who reads it:**
- the resolver, through `EntitlementService`;
- `my-plan` and the PlanSection;
- the admin Tiers page and its inspect route;
- the shadow report;
- the credit period helpers (`lib/business-os/credits/creditPeriod.ts`, `creditLeakCheck.ts`).

### 3.2 `assign_tier` (`adminOps.ts:395-414`)

- Its schema requires the `expiresAt` key (`:108-112`).
- It refuses with 409 if the change would leave the account with no basis.
- It writes `tier`, `tier_expires_at`, `period_anchor = now` and `plan_version`.
- `executeAdminOp` first checks `isBusinessOsTenant` and the existence of a plan row (`:213-234`).
- **Audit and cache invalidation are in the admin route, not here.**

### 3.3 Held friends and what 5c must write

| Fact | Evidence |
|---|---|
| Friend finalise inserts a plan row with **no tier and no cohort** (`origin='invite'`), so the lifecycle reads it as `unknown/no_assignment` | `supabase/migrations/20261024_business_os_friend_invite_signup.sql:83` |
| Hold predicate: has a lineage row, `first_paid_at IS NULL`, and (`account_invite`, or an `admin_invite` with a tier grant). It is mode-independent and fails open in layouts | `lib/business-os/invites/paymentHold.ts:58-90` |
| Enforced in **four layouts**: `app/business-os/layout.tsx`, `app/onboarding-chat/layout.tsx`, `app/onboarding-build/layout.tsx`, `app/test-business-os/layout.tsx`. **API routes are not gated** (F5b-5 residual) | `lib/business-os/invites/paymentHoldGate.ts` |
| Holding screen `/invite/awaiting-payment`: "coming soon", no checkout. The copy exists in en/he/es | `app/invite/awaiting-payment/page.tsx`; `app/invite/awaitingPaymentCopy.ts:31,46,61` |
| **Release today: none.** There is no code path that sets `first_paid_at`, and `BusinessOsAccountLineageRepository` has no update method. Only an admin's manual SQL could release a held friend | `lib/repositories/BusinessOsAccountLineageRepository.ts:54,84` |
| Columns `first_paid_at` and `first_payment_ref` exist, with paired CHECK and ref length 1–255. **No UPDATE grant** for `service_role` yet (F5c-2 needs a column-level grant) | `20261024_…sql:5-11` |
| `paidInvitesAvailable: false` keeps admin Paid invites refused at issue and at redemption | `lib/business-os/entitlements/config/invites.ts:117`; `lib/business-os/invites/adminInviteOps.ts:256`; `lib/business-os/invites/inviteRedemption.ts:312` |
| The champion's list has no "Subscribed" state. `FriendInviteStatus` is `pending`, `expired`, `revoked` or `joined` | `lib/business-os/invites/friendInviteOps.ts:159` |

**5c must write, in one idempotent webhook transaction:**
1. The plan row: `tier='basic'`, `tier_expires_at` = Stripe `current_period_end`, `plan_version`.
2. The lineage row, once only (`WHERE first_paid_at IS NULL`): `first_paid_at` and `first_payment_ref`.
3. A billing record.
4. An audit entry.

The 5c work also has these jobs:
- the launch dry run must list held friends (T-9);
- the shadow report must label them "awaiting payment";
- the champion's list must gain "Subscribed".

---

## 4. Recurring billing and credit periods

| Question | As built |
|---|---|
| What renews today | Only agent-platform credit subscriptions: Stripe auto-invoices, then `invoice.paid` replaces the allowance (`route.ts:139-180`). For Business OS: **nothing renews**, because no BOS subscription exists |
| What would move BOS paid-through | Nothing yet. The design (L-19, Q-T2): on `invoice.paid` for a BOS price, set `tier_expires_at` to the line's `period.end` |
| Cancel at period end | Needs no column: the date stops advancing and `deriveLifecycle` moves the account to grace (`lifecycle.ts:198-240`) |
| Failure hooks | Only the agent-platform `handleInvoicePaymentFailed` exists. BOS has no `past_due` writer and no failure email. Grace config is 7 days against the 5 decided |
| Credit allowance reset | **Derived, not event-driven.** `business_os_credit_period_start(anchor, at)` is a monthly anniversary computed from `period_anchor` (`20261015_business_os_credit_charges.sql:138-170`). The totals row is keyed on `(user_id, period_start)`. No rollover (FR-18). The trial is a one-off 2,000 |
| Coupling risk | Stripe's billing anchor and `period_anchor` are separate clocks. `assign_tier` resets `period_anchor` on every call. If each renewal called it, the credit period would restart at every renewal, and an upgrade would restart it mid-cycle. The design must decide whether renewal touches `period_anchor` at all |
| Lots (in flight) | Credit slice 11a creates `business_os_credit_lots` and `_lot_draws` in **`20261017`** (uncommitted). Lots never touch the per-period totals | `neuronforge-llm-layer2-step4/supabase/migrations/20261017_business_os_credit_lots.sql` |

---

## 5. Admin monitoring that exists today

| Need | Exists? | Evidence |
|---|---|---|
| Per-account plan state (tier, cohort, dates, lifecycle, layers) | ✅ `/admin/business-os-tiers` plus `GET .../entitlements/accounts/[id]` | `app/admin/business-os-tiers/page.tsx` |
| Invites: issuer, level, accepted | ✅ `/admin/business-os-invites`. There is **no paid / not-paid column** (FR-25 is a 5c deliverable) | |
| Credits: report, leak check | ✅ `app/api/admin/business-os/credits/{report,leak-check}`; nightly `credit-leak-check` cron | `vercel.json` |
| Subscriptions, MRR, plan mix | ❌ None for BOS. The agent-platform admin pages read `user_subscriptions` (`app/api/admin/users/[id]/stats/route.ts:71`, `onboarding-users/route.ts:43`) | |
| Payments, invoices, failed payments | ❌ No admin reader of `billing_events` anywhere | grep: only stripe routes, `CreditService`, purge/deletion registries |
| Webhook failures | ❌ `processed_webhook_events` has a `failed` status and an "unfinished" index, but **nothing reads it** apart from the webhook and the purge registry | `20260828_webhook_event_status.sql` |
| Stripe ↔ plan-row reconciliation (Q-T9 alert) | ❌ None. `sync-subscription` is Pilot-Credit-shaped | |
| Billing audit events | Agent-platform only: `INVOICE_PAID`, `PAYMENT_FAILED`, `SUBSCRIPTION_CANCELED`, `SUBSCRIPTION_CHECKOUT_INITIATED`, `SUBSCRIPTION_REACTIVATED`. Entitlement ops audit `BOS_ENTITLEMENT_*` from the admin route | grep `app/api/stripe` |
| Alerts | Only a Connect **owner** dispute email (`route.ts:1013-1021`). There is no admin alert channel for billing | |
| Cron health | `/admin/jobs-queues` plus `admin_bos_cron_run_summary`. Covers crons, not webhooks | `20261011_bos_cron_runs.sql:391` |
| `system-config` billing panel | Describes Pilot-Credit billing and grace days (agent platform) | `app/admin/agentspilot-billing/page.tsx` (moved off `/admin/system-config` 2026-10-03, ADMIN_BOS_CLEANUP slice 2) |

---

## 6. Gaps and risks for 5c / S-4a

| # | Gap or risk | Note |
|---|---|---|
| G-1 | **Service-role key rotation is still open.** It blocks real money for 5c and S-4a and for `enforce` | invite §0.8 #1 (user + Offir) |
| G-2 | **Stripe mode on production is unknown from the repo.** There is one environment, and no staging or test endpoint. `processed_webhook_events.metadata.livemode` records the mode per event (`route.ts:2546`), so one read-only query answers it | Staging plan D4: mode is baked into the stored customer and account ids |
| G-3 | **TK-1 is still unrecorded.** Four `user_subscriptions` rows with non-zero amounts | Stripe dashboard check |
| G-4 | **There is nowhere to store a BOS Stripe customer or subscription id.** The plan row has no such columns. RD-2 forbids BOS from reading or writing `user_subscriptions`, yet the only customer-id store and every portal, invoice and cancel route key on `user_subscriptions` | A storage decision is needed. One option is a new BOS billing table (server-write-only, L-29) |
| G-5 | **One dispatcher, two flows.** Boost R-3 says the first flow to land **owns** the platform-only Business OS dispatcher seam, and the other rebases onto it. Boost R-2 says a boost payment must **never** stamp `first_paid_at` or write the plan or lineage. Boost slice 0 (the Pino conversion of the whole webhook) should land before either seam | boost req §18.8 R-2/R-3 |
| G-6 | **The hazard is live today.** Until WS-3 or the router lands, a platform invoice carrying `metadata.user_id` is converted into Pilot Credits (`route.ts:45-126`). The BOS checkout must not set `user_id` metadata before the router exists, or it must land together with the router | RD-4 deny-by-default |
| G-7 | **A stuck `processing` claim is never reclaimed.** A paid invoice could then be lost silently. Credits Boost F-1 needs reconciliation for the same reason | `route.ts:2524-2528` |
| G-8 | **`billing_events` has no migration in the repo.** Q-T3's product dimension is an ALTER on a dashboard-defined table. Verify the live schema first (`business-os-schema-check`) | boost T-16 |
| G-9 | **`assign_tier` from a webhook** needs three things: a system actor (`adminId` is required), its own audit and cache invalidation (they are in the route today), and a `period_anchor` policy | §3.2, §4 |
| G-10 | **Grace config is 7 days; the decision is 5.** A history entry is needed (Q-T7) | `config/lifecycle.ts:28` |
| G-11 | **Migration numbers.** Applied up to `20261024`. Reserved: **20261016–19** credit deduction (4c `16`, 11a `17` in flight); **20261020–22** invite (`20` used); **20261030–34** boost. **Free and proposed for S-4a/5c: `20261025–20261029`.** Boost R-4 notes that it does not depend on this gap. Record the reservation with both sessions before the first workplan | `ls supabase/migrations`; credit slice 4 workplan V-20; boost R-4 |
| G-12 | **Hold is pages only.** A held friend can call BOS APIs under `shadow`. Boost R-1 refuses held accounts at its own checkout. The 5c checkout itself must *allow* held accounts | `paymentHoldGate.ts` |
| G-13 | **No email on failed payment** and no failure handling for BOS. SCA (`payment_action_required`) is not handled | `route.ts:447` |
| G-14 | **Env hygiene.** No `STRIPE_*` var is in `.env.example`. Price lookup keys would need dashboard objects in both modes (Q-T1) | staging workplan :260 |
| G-15 | **Disputes and refunds of a BOS plan payment** fall through to "unknown payment" | `route.ts:957, 1048` |

---

## 7. Decided vs open

### 7.1 Decided: don't re-ask

| Decision | Source |
|---|---|
| USD only; prices $79 / $129; no refunds; access runs to period end | Q-B2, Q-B7, RD-7, RD-13 |
| Proration: upgrade charged now, downgrade at renewal | RD-7 |
| Paid-lapse grace is 5 days; links for the business's own clients stay live | Q-B6, RD-8 |
| Self-serve and admin-assigned plans | Q-B5 |
| Fixed prices addressed by `lookup_key`; one endpoint; route on price id, deny by default; metadata is a cross-check only | RD-1, RD-4, Q-T1, Q-T4, Q-T11 |
| Stripe owns what was bought; the plan row owns what is in force | Q-T9 |
| The webhook assigns plans through `assign_tier` server-side, never by HTTP | Q-T2 |
| The Pilot-Credit purchase path is retired inside S-4a (WS-3) | RD-12 |
| Friends get Essentials only; held with no trial; no perks; `first_paid_at` is the perk hook; flipping `paidInvitesAvailable` also opens admin Paid invites | invite BQ-13–15, FR-37/38, F5c-3 |
| 5c builds no payment code of its own; it consumes WS-1 | F5c-1 |
| The `first_paid_at` stamp is written once, with a column-level UPDATE grant | F5c-2 |
| Boost never writes lineage or plan rows; the dispatcher is shared; boost holds migrations 30–34 | boost R-2, R-3, R-4 |
| Webhook Pino conversion approved, as a separate slice-0 PR | boost §18.8 |
| Annual plans, add-ons and multi-currency come later | Q-B8, RD-11, OI-1 |

### 7.2 Genuinely open

| # | Question | Kind |
|---|---|---|
| O-1 | TK-1: are the four subscriptions live? Cancel them? | Business / ops (user) |
| O-2 | May an admin let a held friend in without paying? | Business (invite §0.6) |
| O-3 | TK-5: does the agent-platform boost checkout die? TK-3: what happens to `free_tier_expires_at`? | Business, small |
| O-4 | Is S-4a's scope cut to "5c first" (buy Essentials at signup) or delivered whole (WS-1+2+3)? Does WS-3 have to ship with the first BOS invoice? (SA position: yes, or at least the router's deny-by-default must) | Business sequencing, then SA |
| O-5 | Where the BOS Stripe customer and subscription ids live (G-4), and how RD-3/Q-T8 fit RD-2 | Technical (SA) |
| O-6 | `period_anchor` vs the Stripe billing anchor on first payment, renewal and upgrade (G-9) | Technical (SA), product-visible |
| O-7 | Webhook system actor, plus audit and cache invalidation outside the admin route (G-9) | Technical (SA) |
| O-8 | Reclaiming stale `processing` claims, and reconciliation (G-7, Q-T9 alert) | Technical (SA) |
| O-9 | Admin monitoring scope for v1: payments, failed payments, webhook failures, MRR | Business priority, then SA |
| O-10 | BOS dunning: `past_due` writer, customer email, SCA | Technical, with business wording |
| O-11 | Stripe Tax / VAT for plans (boost DEP-7 asks the accountant) | Business (accountant) |
| O-12 | Grace config 7 → 5 days (a history entry) | Technical, already decided in substance |

---

## Change History

| Date | Change | Details |
|---|---|---|
| 2026-10-02 | Created (SA) | Read-only as-built inventory for S-4a, invite 5c, recurring billing and admin monitoring, against `origin/main` 03b62c3c |
| 2026-10-03 | Billing panel row repointed (ADMIN_BOS_CLEANUP slice 2) | The `system-config` billing panel row now cites `app/admin/agentspilot-billing/page.tsx`. The grace period, boost packs and calculator moved there; `/admin/system-config` holds only model pricing |
