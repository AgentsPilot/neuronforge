# Requirement: Business OS Plan Payments (Stripe)

> **Last Updated**: 2026-10-13

**Created by:** BA
**Date:** 2026-10-02
**Status:** SA approved with conditions C-1 to C-12 (see "SA Review — 2026-10-02"); C-12 text corrections applied. All business questions decided 2026-10-02 (§10.1). **APPROVED by the user 2026-10-02:** "I approve the payments scope and committing the two documents in a PR; Dev can start the P-0 and P-1 workplans."
**Related:** [BUSINESS_OS_PLAN_PAYMENTS_ASBUILT.md](/docs/requirements/BUSINESS_OS_PLAN_PAYMENTS_ASBUILT.md) (SA as-built, 2026-10-02: the authority on what exists), [BUSINESS_OS_TIER_BILLING_REUSE_PLAN.md](/docs/requirements/BUSINESS_OS_TIER_BILLING_REUSE_PLAN.md) (plan of record: Q-B, RD, Q-T, S-4a, WS-1/2/3, TK), [BUSINESS_OS_INVITE_SIGNUP_REQUIREMENT.md](/docs/requirements/BUSINESS_OS_INVITE_SIGNUP_REQUIREMENT.md) (§7.6, §7.7, §7.9, Slice 5c, F5c-1 to F5c-4), [BUSINESS_OS_ENTITLEMENTS.md](/docs/architecture/BUSINESS_OS_ENTITLEMENTS.md), [BUSINESS_OS_CREDIT_PRICING.md](/docs/architecture/BUSINESS_OS_CREDIT_PRICING.md), [BUSINESS_OS_CREDITS_BOOST_REQUIREMENT.md](/docs/requirements/BUSINESS_OS_CREDITS_BOOST_REQUIREMENT.md) (sibling; untracked in the main checkout on this date; shares the webhook dispatcher).

## Overview

A Business OS owner can pay us a monthly subscription for a plan, and Stripe charges them every month until they cancel. Self-serve buyers choose a plan in Settings → Plan; an invited friend, or an admin's Paid invitee, pays at signup and is then let into the product. Customers can upgrade, downgrade, cancel, reactivate, update their card and see their invoices. When a card fails, Stripe retries, the account gets 5 days of grace, and then it pauses. Admins can see, per account and across all accounts, who is paying, who is failing, and where Stripe and our plan record disagree. Everything is in USD at the decided prices. **Out of scope:** annual plans and add-ons (Q-B8, RD-11), multi-currency and VAT (OI-1), credit boosts (the Credits Boost requirement), and switching enforcement on (reuse-plan S-2 and S-5).

This document scopes the reuse plan's **S-4a** (WS-1, WS-2, WS-3) together with invite **Slice 5c**. It adds the parts the plan of record did not cover: recurring-payment rules stated end to end, admin monitoring, and a small-slice delivery order. It does not re-decide anything: earlier decisions are cited by id.

---

## Table of Contents

1. [Conventions](#1-conventions)
2. [Scope](#2-scope)
3. [What exists and what is missing](#3-what-exists-and-what-is-missing)
4. [Findings to fix](#4-findings-to-fix)
5. [The flows](#5-the-flows)
6. [Recurring-payment rules](#6-recurring-payment-rules)
7. [Admin monitoring](#7-admin-monitoring)
8. [Safety requirements](#8-safety-requirements)
9. [Proposed slices](#9-proposed-slices)
10. [Business questions for the user](#10-business-questions-for-the-user)
11. [For SA](#11-for-sa)
12. [Acceptance criteria](#12-acceptance-criteria)
13. [Notes on integration points](#13-notes-on-integration-points)

---

## 1. Conventions

| Item | Convention |
|---|---|
| Plan names | Internal ids, per RD-14: `basic`, `pro` (tiers), `trial`, `champion` (cohorts). The customer names are Essentials, Autopilot, Test Flight and Founding Partner, held as data in `presentation` and `cohorts.ts`. |
| Prices | `basic` $79 and `pro` $129 a month, USD only (Q-B2, RD-13). |
| Ids in this document | **F1 to F10** flows · **PF-n** findings to fix · **SR-n** safety requirements · **P-n** slices · **BQ-Pn** business questions · **SA-Pn** items for SA · **AC-Fn.m** acceptance criteria |
| "Paid-through date" | The plan row's `tier_expires_at`, which is Stripe's current-period end (as-built §3.1) |
| "Held" | An invited account that has not paid yet and is kept on the "finish your payment" screen (invite GR-4, FR-24, FR-35) |
| "Enforced" | Nothing about plans is refused until reuse-plan S-5 switches enforcement on. Before that, the lifecycle (grace, paused) is **recorded, not acted on**. The invite payment hold is the exception: it is a page gate and works today (invite GR-5). |

---

## 2. Scope

| In scope | Out of scope (and where it lives) |
|---|---|
| Monthly subscription to `basic` or `pro` through Stripe, on fixed prices (RD-1, Q-T1) | Annual prices (Q-B8), add-ons, Flex (RD-11) |
| Self-serve buy, upgrade, downgrade, cancel, reactivate, card update, invoice list (Q-B5, RD-6, WS-2) | Credit boosts (Credits Boost requirement) |
| Friend pays at signup, and already-held friends pay later (invite 5c, FR-37) | Perks on first payment (invite §14, FR-38) |
| Admin Paid invites switched on (invite FR-22 to FR-26, F5c-3) | Reminders or deletion for unpaid invitees (invite BQ-8) |
| Admin-assigned (sales-assisted) plans coexisting with Stripe (Q-B5, Q-T9) | Multi-currency, VAT, tax invoices (OI-1) |
| Renewal, failed payment, 5-day grace, pause, recovery (Q-B6, RD-8) | Switching enforcement on (S-2, S-5); refusing AI at zero credits (credit deduction slices 9–10) |
| Founding Partner converting to paid, with the founder discount (D-6, WS-1) | Price changes for existing subscribers and grandfathering at renewal |
| Admin monitoring v1 (§7) | Self-serve refunds; refund policy beyond "no refunds" (Q-B7) |
| Retiring the Pilot-Credit purchase path (WS-3, RD-12) | Agent-platform billing beyond that retirement (E-2) |

---

## 3. What exists and what is missing

Detail and file evidence: [as-built](/docs/requirements/BUSINESS_OS_PLAN_PAYMENTS_ASBUILT.md).

| Area | Exists | Missing | As-built |
|---|---|---|---|
| Stripe plumbing | SDK, embedded checkout envelope, portal, invoice list, cancel/reactivate methods, proration policy | Fixed prices with lookup keys; a Business OS checkout route | §2 |
| Webhook | Signature check, one endpoint, two-phase claim | A Business OS branch; deny-by-default routing; reclaiming stuck claims. **Live hazard:** a plan invoice carrying `user_id` would become Pilot Credits today | §2, G-6, G-7 |
| Where the customer is recorded | Only `user_subscriptions`, which Business OS may not use (RD-2) | A Business OS home for the Stripe customer and subscription ids | G-4 |
| Plan row | Tier, paid-through date, credit-period anchor | A safe way for the webhook to assign a plan (system actor, audit, no period reset) | §3.2, G-9 |
| Lifecycle | Grace and paused are derived from the paid-through date | Nothing produces `past_due`; grace config is 7 days, not 5 | §3.1, G-10 |
| Held friends | Hold gate, lineage `first_paid_at` columns, holding screen | Any way to release a friend; the UPDATE grant | §3.3 |
| Customer surface | Read-only "Your plan" (WS-2 step 1), localised (step 1b, not recorded as closed) | Buy, change, cancel, card, invoices | §1.1 |
| Admin | Per-account plan state (Tiers page), invites list, credit reports, cron health | Anything about payments, subscriptions, failures, webhooks or reconciliation | §5 |

---

## 4. Findings to fix

Places where the code contradicts a decision. These are defects to fix inside the slices, **not** new questions. PF-9 to PF-15 were added by the SA review (SA-3), with SA's severity.

| # | Decision | What the code does | Fix in |
|---|---|---|---|
| **PF-1** | Paid-lapse grace is **5 days** (Q-B6, RD-8, Q-T7) | `subscriptionGraceHistory` is 7 days (G-10) | P-6a (moved from P-2 by SA): append a 5-day history entry, together with the PF-10 margin; never edit the old one (C-10) |
| **PF-2** | The credit period does not restart mid-cycle; the allowance resets per period (credit deduction FR-18) | `assign_tier` sets `period_anchor = now` on every call, so a renewal or upgrade through it would restart the credit period (as-built §4) | P-3b (SA-P2) |
| **PF-3** | The webhook's plan assignment "inherits the audit entry" (Q-T2) | Audit and cache invalidation live in the admin route, not in `executeAdminOp`, and an admin id is required (G-9) | P-3b (SA-P3) |
| **PF-4** | Deny by default; unknown never means credits (RD-4) | A platform invoice with `user_id` metadata is converted to Pilot Credits, with a first-subscription fallback (G-6) | P-1 |
| **PF-5** | Idempotent, never silently lost (L-12) | A claim stuck at `processing` is never reclaimed, so a paid invoice can be lost (G-7) | P-8b, before go-live (→ §9.5 go-live checklist, row 1) |
| **PF-6** | Disputes and refunds are recorded, not ignored (by analogy with boost FR-35/FR-36) | Plan-payment disputes and refunds fall through to "unknown payment" (G-15) | P-6b, resolved via the Basil invoice-payment lookup (PF-9) |
| **PF-7** | WS-2 step 1b (localisation) gates any screen that asks for payment (reuse plan §4.6c, F5c-4) | It appears done but no document records the gate as closed | P-4: QA records it closed, or fixes the gap |
| **PF-8** | Env vars are documented | No `STRIPE_*` variable is in `.env.example` (G-14) | P-2 |
| **PF-9** (High) | The webhook reads the shapes of the Stripe API version in use, `2025-10-29.clover` (SA-1) | **Basil-era Stripe shapes.** On `2025-10-29.clover` the invoice line's price is `line.pricing.price_details.price` (not `line.price`), the invoice's subscription is `invoice.parent.subscription_details.subscription`, the period end is on subscription **items**, and `charge.invoice` is gone (resolve a refund or dispute via the PaymentIntent's invoice payments). A router written against older shapes would deny every plan invoice, or route nothing | P-1 (router), P-3b, P-6b; each with a fixture test from a real test-mode payload (C-8) |
| **PF-10** (High, post S-5) | Grace is 5 days after a missed renewal (Q-B6), not a monthly state for every subscriber | **Monthly grace blip.** Stripe finalises and charges the renewal about an hour **after** the period ends, so `tier_expires_at` passes before `invoice.paid` arrives and every subscriber reads `grace` for up to an hour each month (read-only owner once S-5 is on). Ruling: store Stripe's period end verbatim, and add a **renewal settlement margin of 24 h** to lifecycle config as a history entry, applied by `deriveLifecycle` to a tier's access end before grace starts (all tiers; harmless for admin-assigned ones). The 5-day grace then counts from the end of the margin | P-6a (C-10) |
| **PF-11** (Medium) | Every money event writes an audit entry (AM-7) | **Audit only queues** (`log()`); a serverless function frozen after the 200 loses the row. The webhook must `flush()` before responding, as the admin route does | P-3b (SA-P3, C-7) |
| **PF-12** (High) | Deny by default (RD-4); never take money we will not credit | **Paying into a denied path.** After P-1, an agent-platform subscription checkout would still take money that the router then refuses to credit | P-1 (SA-P7, C-2) |
| **PF-13** (Medium) | The credit period follows billing (§6, SA-P2) | **Admin `assign_tier` on a subscribed account resets the anchor**, desynchronising the credit period from billing | P-3b (SA-P2) |
| **PF-14** (High) | A customer is never charged for an account that no longer exists | **Reset / deletion while subscribed.** A Danger-Zone reset or an account deletion that removes the plan row leaves Stripe charging. Purge, reset and deletion paths must **refuse while the billing record has a live subscription** (409 `subscription_live`) until it is cancelled; the billing record itself is retained | P-2 (registry), P-7a (refusal); before go-live (C-11; → §9.5 go-live checklist, row 1) |
| **PF-15** (Medium) | Test mode first, and test data never mixed with real money (SR-12) | **Test mode on the production database.** There is one Supabase project, so test-mode customers and plan rows land in production tables. Every billing row carries `livemode`; the webhook refuses an event whose `livemode` differs from the key's mode; admin lists and MRR filter on the current mode; demos use designated test accounts only | P-2, P-3b, P-8a (C-9); checked before live keys → §9.5 go-live checklist, rows 6 and 19 |

---

## 5. The flows

Each flow lists what the **customer** sees, what the **system** records, and what an **admin** can see. "Billing record" means the Business OS home for the Stripe customer and subscription (SA-P1). "Money history" means the per-event payment log (SA-P5).

### F1. New customer buys a plan from the plan screen (self-serve, Q-B5)

```text
Settings → Plan → "Choose Essentials" → Stripe checkout → paid → webhook → plan row = basic → "You're on Essentials"
```

| # | Customer sees | System records | Admin sees |
|---|---|---|---|
| 1 | Settings → Plan lists Essentials and Autopilot with price and contents, and a **Choose** button on each plan whose `availableToBuy` is on | — | — |
| 2 | Chooses a plan; the embedded Stripe checkout opens, in USD, with the tax wording of BQ-P5 | A Stripe customer for this person (created once, reused afterwards); a checkout session on that plan's fixed price. **Nothing on the plan row yet** | — |
| 3 | Pays; sees "Payment processing", then "You're on Essentials" with the next renewal date | On Stripe's paid invoice: plan row `tier`, paid-through date and plan version; credit period starts on the billing date (§6); billing record; money history; audit entry | Per-account billing panel: Stripe active, plan row `basic`, last payment, next renewal |
| 4 | Stripe emails a receipt | — | — |
| — | Abandons or the card is declined: stays on the plan screen, nothing changed | Nothing on the plan row | Nothing (an abandoned checkout is not a payment) |

**Who uses F1:** trial accounts, accounts with no plan, and paused accounts buying again. Founding Partners use F10, held invitees F2/F3, and paying customers F7.

**When a trial account buys, the trial ends.** The first charge is taken at once and the plan starts at once (BQ-P2, decided 2026-10-02).

### F2. Friend invite: the friend pays at signup (invite 5c)

```mermaid
sequenceDiagram
  participant Friend
  participant App
  participant Stripe
  participant Webhook
  Friend->>App: signs up from the champion's invite (5b, live)
  App-->>Friend: "Finish your payment": Essentials $79, Pay button
  Friend->>Stripe: pays in checkout (held account is allowed in)
  Stripe->>Webhook: invoice paid (plan price)
  Webhook->>App: plan = basic, paid-through set, first_paid_at stamped once
  App-->>Friend: hold lifted, lands in onboarding
```

| # | Customer sees | System records | Admin sees |
|---|---|---|---|
| 1 | The friend signs up exactly as today (5b) and lands on the holding screen, which now says **"Finish your payment"** with Essentials, its price ("$79 a month, excluding tax", BQ-P5, read from `presentation`) and a **Pay** button (was "payment coming soon", FR-35). After paying it shows "payment processing" until the hold is lifted (P-5a, §9.1.1 G5-8) | As 5b: lineage at L2, plan row with no basis | Invites list: Accepted, L2, "signed up, not paid" |
| 2 | Pays in the checkout | The checkout **allows** a held account (G-12; built in P-3a: a held friend may buy Essentials only, and an unreadable hold is refused). From P-5a it does so only while `paidInvitesAvailable` is on (§9.1.1 D5-3). It refuses if this account already has a live or pending plan subscription, so a double click cannot start a second one (SR-5) | — |
| 3 | Lands in onboarding; signing in again goes straight to the product | On the paid plan invoice: plan row `basic`; **`first_paid_at` and `first_payment_ref` stamped once** (F5c-2); money history; audit "first payment" (invite §8.3). The hold gate now lets the account in | Invites list: paid, date and amount (FR-25). Tiers page: `basic`. Billing panel as F1 |
| 4 | The **champion** sees "Subscribed" against that friend (FR-31) | Derived from `first_paid_at` | — |

**Already-held friends** (signed up under 5b before payment existed): the next time they sign in, the holding screen shows **Pay** instead of "coming soon". Nobody is emailed automatically (invite BQ-8; telling held friends is listed as future in invite §14). Admins can see the list and follow up by hand.

**Card declined at checkout:** Stripe shows the error inside the checkout; nothing is recorded; the friend stays held with no time limit and can try again (BQ-8).

**Rules carried in from earlier decisions:** the friend's plan is Essentials only (BQ-14, FR-30); after paying they can upgrade like any customer (F7). No perks on either side (FR-38). **Only a plan payment stamps `first_paid_at`, never a boost** (boost R-2). An admin may let a held friend in without paying, as an audited waiver with a required reason; it never counts as a payment (BQ-P3, decided 2026-10-02). Built as its own slice, **P-13**, after P-9 (§9.1.1, placed 2026-10-11).

### F3. Admin Paid invite: the invitee pays at signup

```text
Admin creates Paid invite (basic or pro) → invitee signs up → held → checkout for the invited plan → paid → plan assigned, first_paid_at → onboarding
```

| # | Customer sees | System records | Admin sees |
|---|---|---|---|
| 1 | Invite page shows the plan the admin chose, its price, what it includes, and "payment required" (FR-22) | Invite as today (Paid type enabled once `paidInvitesAvailable` is on, F5c-3) | Invites list: Pending |
| 2 | Creates the account and lands on "finish your payment" for **the invited plan** | Lineage at L1, `admin_invite` with a tier grant; plan row with no basis. The hold predicate already covers this case (as-built §3.3) | Accepted, L1, "signed up, not paid" |
| 3 | Pays; lands in onboarding | As F2 step 3, with the invited tier | Paid, date and amount; Tiers page shows the tier |

Today an admin-issued tier invite is **refused at redemption**, so F3 needs a redemption path for it (SA-P9).

### F4. Sales-assisted or admin-assigned plan (Q-B5) next to Stripe (Q-T9)

| # | Customer sees | System records | Admin sees |
|---|---|---|---|
| 1 | Their plan in Settings → Plan, with its end date | Admin runs `assign_tier` on the Tiers page with an end date and a reason; audited. **No Stripe object** | The plan row, with origin and admin; billing panel: "No Stripe subscription" |
| 2 | Later buys through F1 | The paid invoice assigns the bought plan; the payment is the newest fact and replaces the admin assignment; audited | Billing panel: Stripe active |
| 3 | — | An admin changes the tier of an account **that has a live Stripe subscription** | The admin screen warns "Stripe is still billing for <plan>; the next renewal restores <plan>". The plan row governs access (Q-T9) until then: **every paid plan invoice re-asserts the bought tier**, so a lasting change on a subscribed account needs an override or a change to the subscription in Stripe (SA-P16b). The reconciliation flag (§7) stays up until Stripe and the plan row agree |

**Sales-assisted means an admin assigns the plan; payment, if any, is through the normal checkout.** In v1, admin actions on Stripe itself (cancel, refund) are done in the Stripe dashboard, linked from the billing panel.

### F5. Monthly renewal

```text
Billing date → Stripe charges the card → invoice paid → paid-through moves to the new period end → fresh credit allowance for the new period
```

| # | Customer sees | System records | Admin sees |
|---|---|---|---|
| 1 | Nothing in the app, apart from a new next-renewal date; Stripe emails a receipt | Paid-through date moves to the new period end (L-19). **The credit period is not restarted**: the new period starts on the billing anniversary, from the anchor set at first payment (§6, PF-2). Money history; audit | Last payment and next renewal on the billing panel |
| 2 | The credits card shows the full monthly allowance again | Nothing is written: the period is derived (as-built §4). No rollover (credit deduction FR-18). Extra credits (lots) are untouched | — |

**Renewal settlement margin (PF-10):** Stripe charges the renewal about an hour after the period ends, so the paid-through date passes before the payment arrives. A 24-hour margin after the paid-through date comes before grace, so a normal renewal never reads as grace.

### F6. Failed payment: retries, 5-day grace, paused, recovery

```mermaid
stateDiagram-v2
  [*] --> Active
  Active --> Grace: renewal charge fails (paid-through date passes)
  Grace --> Active: a Stripe retry succeeds, or the owner updates the card
  Grace --> Paused: 5 days pass (Q-B6)
  Paused --> Active: a retry succeeds, or the owner pays the open invoice
  Paused --> Ended: Stripe stops retrying and cancels (BQ-P7)
  Ended --> Active: the owner buys again (F1)
```

| # | Customer sees | System records | Admin sees |
|---|---|---|---|
| 1 | Stripe's failed-payment email; in the app, a banner "Your payment failed, update your card" with a link to update it | The failed attempt in the money history; audit. The paid-through date does **not** move, so the lifecycle reads **grace** | The account under "Failed" and "In grace", with the attempt count |
| 2 | During grace: per B-9 (read-only owner, client pages live with a warning) **once S-5 is on**; before S-5, nothing is restricted | Stripe retries on its own schedule (BQ-P7) | — |
| 3 | After 5 days: paused. **Still working for the business's clients (B-11):** invoice pay links, receipts, booking cancel and reschedule links | Lifecycle reads **paused** (derived, no job) | "Paused" |
| 4 | Fixes the card, or a retry succeeds: back to normal at once | Paid invoice → paid-through date moves → lifecycle reads active; audit | Back to "Active" |
| 5 | Stripe gives up: the subscription ends; the account stays paused, data kept; can buy again (F1) | Subscription ended on the billing record; audit | "Ended" |

**A renewal that needs the card holder's authentication** (3-D Secure) is treated as a failed payment until it is completed, and Stripe's email carries the link (SA-P8).

**Grace starts after the 24-hour renewal margin** (PF-10): the 5 days count from the end of the margin, not from the paid-through date itself.

### F7. Upgrade and downgrade (RD-7)

| | Upgrade (`basic` → `pro`) | Downgrade (`pro` → `basic`) |
|---|---|---|
| Customer sees | "Upgrade to Autopilot": the prorated amount due now, then the new plan immediately | "Switch to Essentials on <renewal date>"; keeps Autopilot until then; can undo before that date |
| Charged | The prorated difference, now | Nothing now; the lower price from the next renewal; no refund |
| System records | Plan row `pro` immediately; paid-through date unchanged; **credit period not restarted**, so the higher allowance applies to the rest of the current period; money history; audit | The scheduled change on the billing record; the plan row changes only when the renewal invoice is paid |
| Admin sees | The change and the charge | "Downgrade scheduled for <date>" |

The Stripe subscription moves to the other **fixed price**; no new price is created (L-9).

**How (SA):** an upgrade uses `proration_behavior: 'always_invoice'` with `payment_behavior: 'pending_if_incomplete'`, so it only takes effect if paid; a declined or 3-D Secure-abandoned upgrade leaves the account on `basic`. A downgrade is a **price swap with `proration_behavior: 'none'`** (no subscription schedules in v1); the plan row changes on the renewal `invoice.paid` whose line carries the lower price; undo is the reverse swap.

### F8. Cancel and reactivate (Q-B7)

| # | Customer sees | System records | Admin sees |
|---|---|---|---|
| 1 | "Cancel plan": confirms; Settings now says "Ends on <date>" with a **Reactivate** button | Cancel at period end on the billing record; audit. Nothing refunded | Under "Cancelling", with the end date |
| 2 | Reactivates before the end date: back to normal, nothing charged now | Cancellation removed; audit | Back to "Active" |
| 3 | Does nothing: on the end date the plan stops, then (after the 24-hour renewal margin, PF-10) 5 days of grace, then paused (same as F6) | The paid-through date stops moving; the lifecycle does the rest (as-built §4) | "Ended", then "In grace", then "Paused" |
| 4 | Wants it back after the end date: buys again through F1, with a new billing date | As F1 | As F1 |

### F9. Update card, view invoices and receipts

| Need | How | Note |
|---|---|---|
| Update the card | A button in Settings → Plan that opens the Stripe customer portal (L-4), limited to card and invoices (SA-P10) | Plan changes stay in the app, so RD-7 is applied in one place |
| See invoices | An in-app list in Settings → Plan (L-5): date, plan, amount, status, and a link to Stripe's hosted invoice and receipt | Read from Stripe through our records; never from `user_subscriptions` (RD-2) |
| Receipts | Stripe emails one for every paid invoice | Only if **"Successful payments" customer emails** are switched on in the Stripe dashboard (go-live item, §9.5); branding set there too |

### F10. Founding Partner converting to paid

| # | Customer sees | System records | Admin sees |
|---|---|---|---|
| 1 | Nothing changes while free access has no end date. Champions keep Autopilot-level access at $0 (entitlements doc) | — | — |
| 2 | Once an admin sets an end date: Settings → Plan says "Your free access ends on <date>. Choose a plan" | Admin `set_expiry` on the cohort, as today | The end date on the Tiers page |
| 3 | Chooses a plan; checkout shows the **founder discount** (BQ-P1) | Checkout with the discount; the first charge follows BQ-P2 | Billing panel shows the discount and when it ends |
| 4 | On the end date: carries on without a break on the paid plan | The cohort ends; the tier is in force | "Active", with the discount |
| 5 | Did not choose: champion grace (lifecycle config), then paused | Derived | "In grace", then "Paused" |

Decided 2026-10-02: 50% off the chosen plan for 24 months, once per account (BQ-P1), and the first charge on the day free access ends (BQ-P2). Technically the subscription starts with a trial to the cohort end, and its $0 invoice assigns nothing and stamps nothing (SA-P16c). F10 ships after go-live as its own slice (P-11, BQ-P4); until then champions can buy at full price through F1.

---

## 6. Recurring-payment rules

| Rule | Decision | Source |
|---|---|---|
| Billing date | Monthly, on the anniversary of the first payment (Stripe's billing anchor) | — |
| Credit period | Starts on the billing date at first payment and follows the billing anniversary afterwards. **Not restarted** by a renewal, an upgrade, a downgrade or a card fix | PF-2, credit deduction FR-18; SA-P2 |
| Allowance | Full plan allowance each period; no rollover; extra credits (lots) unaffected | FR-18; credit deduction slice 11; boost T-2 |
| Upgrade | Prorated charge now, new plan immediately | RD-7 |
| Downgrade | At the next renewal; no refund | RD-7 |
| Retries | Stripe's recommended automatic retries, about two weeks, then the subscription is cancelled | BQ-P7 (decided 2026-10-02) |
| Grace | 5 days, counted from the end of a 24-hour renewal settlement margin after the missed paid-through date (fix the 7 in config, PF-1; margin PF-10) | Q-B6, RD-8, Q-T7; PF-10 |
| Paused | After grace. Invoice pay links, receipts and booking cancel/reschedule links keep working for the business's clients | B-11 |
| Enforcement | Grace and pause are **recorded, not acted on, until S-5**. The invite payment hold is the exception | S-5, invite GR-5 |
| Cancel | At period end; access to the end; no refund | Q-B7, RD-7 |
| Reactivate | Before the end date: undo, nothing charged. After it: buy again | L-6 |
| Refunds | None by policy. An exceptional refund by an admin in the Stripe dashboard is recorded and flagged; the plan does not change automatically | Q-B7; PF-6 |
| Disputes | Recorded against the payment and flagged to admins; no automatic plan change | PF-6 |
| Receipts | Stripe emails one per paid invoice; in-app invoice list | F9 |
| Currency | USD only; no conversion shown anywhere | Q-B2, RD-13 |
| Tax | Prices shown "excluding tax"; tax recorded separately. Set before live prices exist, because Stripe does not let `tax_behavior` change. Multi-currency and VAT are OI-1 | BQ-P5 (decided 2026-10-02); OI-1; → §9.5 go-live checklist, rows 5 and 7 |
| Price shown vs price charged | The customer-facing price comes from `presentation` (display) and must equal the Stripe price behind the lookup key (charge). Stripe is the source of truth for what is charged | F-22; SA-P12 |

---

## 7. Admin monitoring

The as-built (§5) finds almost nothing for plan billing. Proposal for **v1**, reusing existing admin surfaces; everything gated by `requireAdmin` / `requireAdminPage` (L-30).

| # | What | Shows | Where (reuse) | v1 or later | Why there |
|---|---|---|---|---|---|
| AM-1 | **Per-account billing panel** | Stripe subscription status next to the plan row (Q-T9's "both side by side"): plan bought, plan in force, paid-through date, next renewal, last payment (date, amount), failed attempts, cancelling or scheduled change, discount, a "they disagree" flag, and a link to the customer in the Stripe dashboard | The account inspect view on `/admin/business-os-tiers` | **v1** | Q-T9 already puts it on the inspect route; support reads the plan row there today |
| AM-2 | **Subscriptions list** with filters: Active, In grace, Paused, Cancelling, Failed (last attempt failed), Ended, No Stripe (admin-assigned) | One row per account with plan, status, paid-through, last payment, attempts | A new tab on `/admin/business-os-tiers` | **v1** | No surface lists payments; a tab keeps plan and billing together instead of a new page |
| AM-3 | **Totals** | Active paid accounts per plan; in grace; paused; cancelling; MRR in USD (sum of net USD amounts of active subscriptions, current mode only; BQ-P6 struck by SA) | Header of the AM-2 tab | **v1** | USD only and two fixed prices make it a simple sum |
| AM-4 | **Webhook health** | Failed and stuck (`processing` too long) events, oldest first | `/admin/jobs-queues` | **v1** | Already the place for background health; `processed_webhook_events` has a failed status nobody reads |
| AM-5 | **Reconciliation** | Nightly: Stripe vs plan row disagreements, stuck claims re-processed (PF-5), paid invoices with no plan assignment. Results on AM-1/AM-2 as flags and an `error` log per finding | The credit leak-check cron pattern (`bos_cron_runs`) and its admin button | **v1** | A lost paid invoice is the worst failure here (RD-4); shared pattern with boost F-1 |
| AM-6 | **Invites paid column** | Paid / signed up not paid, date and amount (FR-25) | `/admin/business-os-invites` | **v1** (5c) | Already specified by the invite requirement |
| AM-7 | **Audit for every money event** | Checkout started, paid, failed, plan assigned, first payment stamped, upgraded, downgrade scheduled, cancelled, reactivated, ended, refund or dispute flagged, admin override on a subscribed account | `AuditTrailService` (L-31) | **v1** | Required on money events; non-blocking |
| AM-8 | Admin billing **actions** in the app (refund, cancel, change plan in Stripe) | — | — | Later | The Stripe dashboard covers them; the panel links there |
| AM-9 | Admin **alert emails** on failures | — | — | Later | No admin alert channel exists (as-built §5); v1 uses page flags and `error` logs |
| AM-10 | Churn, plan mix over time, revenue by month | — | — | Later | Needs history; not needed to operate |

**Data source:** our own records (billing record and money history), never a live Stripe call to render a list or decide access (Q-T9).

---

## 8. Safety requirements

| # | Requirement | Source |
|---|---|---|
| **SR-1** | **The deny-by-default price-id router lands before, or with, the first Business OS checkout.** Until it does, no Business OS checkout sets `user_id` metadata | RD-4, as-built G-6 |
| **SR-2** | Route on the price id from the invoice line items; metadata is a cross-check, and a disagreement is refused and alerted | RD-4 |
| **SR-3** | One webhook endpoint, one claim table | RD-4, Q-T5, Q-T11 |
| **SR-4** | Every money event is processed exactly once: redelivery, retry and reconciliation converge on the same result. A failed write releases the claim; a stuck claim is recovered (PF-5) | L-12, G-7 |
| **SR-5** | A held friend, or any account, is never charged twice for the same plan: the checkout refuses while the account has a live or pending plan subscription | — |
| **SR-6** | **A boost never stamps `first_paid_at`**, never writes the plan row or lineage. Only a plan invoice does | boost R-2, invite §6.4 |
| **SR-7** | `first_paid_at` is written once (`WHERE first_paid_at IS NULL`) through a column-level grant | F5c-2 |
| **SR-8** | The account a payment belongs to comes from our own billing record, never from Stripe metadata or the request (`tenant-isolation-guard`) | boost T-4 analogue |
| **SR-9** | Business OS billing never reads or writes `user_subscriptions`, `credit_transactions` or a Pilot-Credit balance | RD-2 |
| **SR-10** | Connect (client) payments behave identically before and after each webhook change, with before/after evidence | Q-T5, RD-12 |
| **SR-11** | An access decision never waits on a Stripe API call | Q-T9 |
| **SR-12** | **Stripe test mode first.** Every slice is demoed in test mode. Real money only after go-live (P-12; → §9.5 go-live checklist) | — |
| **SR-13** | **G-1** (service-role key rotation) is verified before any real money (→ §9.5 row 3) | G-1, invite §0.3 |
| **SR-14** | **TK-1** is recorded (the four agent-platform subscriptions: live or test mode, cancelled if live) **before any real money** (→ §9.5 row 4). Originally a P-1 merge gate (C-2); moved by the user on 2026-10-03: "we are still in testing mode, so not worries for now". P-1 merged on 2026-10-03 (#188) on that basis. P-1 recognises nothing, so every platform invoice is denied, and none is converted to Pilot Credits. If any of the four is live, its customer is charged without receiving credits until TK-1 is done. That risk was accepted with the decision | TK-1; user decision 2026-10-03 |
| **SR-15** | USD only; the Stripe checkout must not present or charge another currency | Q-B2, boost F-7 analogue |
| **SR-16** | Every route: Zod, repositories, Pino with a correlation id, CLAUDE.md error format; every money table server-write-only | CLAUDE.md rules 1–3, L-29 |
| **SR-17** | Every new import from `lib/business-os/entitlements/` is registered | `business-os-entitlements` skill |

---

## 9. Proposed slices

Small, numbered, each a few days and demoable on its own. **Test mode throughout; real money only at P-12.**

### 9.1 Slice list

| Slice | Scope title | Done means (the demo) | Depends on | Migration | State in production after merge | Est. |
|---|---|---|---|---|---|---|
| **P-0** | **Webhook logging to Pino** (= Credits Boost slice 0, already approved by the user) | Whichever session starts first does it; mechanical, no behaviour change; Connect before/after evidence | — | None | Live | small |
| **P-1** | **Price-id router, deny by default** | A test platform invoice with an unknown price is logged and refused, and no Pilot-Credit row appears. Connect tests unchanged. The Pilot-Credit invoice conversion and its first-subscription fallback are gone. The subscription branch of `app/api/stripe/create-checkout` is refused (410, logged; PF-12). The router reads Basil shapes, with fixture tests (PF-9) | P-0 merged (C-1); dispatcher owner agreed (§9.4). TK-1 moved to the go-live checklist by the user on 2026-10-03 (SR-14, §9.5). The webhook API version and key-prefix checks were moved to the P-3a gate. **Merged 2026-10-03 (#188)** | None | **Live**: protective only | 2–3d |
| **P-2** | **Plan prices and billing record** | Test-mode Stripe products and prices for `basic` and `pro` with lookup keys; the `check-bos-plan-prices` script shows both resolve to $79 / $129, equal to `presentation` (SA-P12). The billing record table `business_os_billing_accounts` exists with its full column set (SA-P1; checker passes) and is in the purge/deletion registries (PF-14). Every billing row carries `livemode` (PF-15). The Stripe env names, including the portal configuration id, documented with their mode rule in a table in [BUSINESS_OS_ENTITLEMENTS.md](/docs/architecture/BUSINESS_OS_ENTITLEMENTS.md) § Billing (PF-8, SA-P10); the tracked `.env.example` itself moves to the staging workplan C2 (P-2 SA ruling Q-4). Stripe customer helper split (Q-T8). PF-1 moved to P-6a. **Shipped as two PRs** (P-2 SA ruling Q-8): **P-2a** billing record (migration, repository, registries, customer split, env-name table) and **P-2b** plan prices (lookup-key config, catalog fill, price check and scripts, captured fixtures) | SA-P13 query answered (C-4; answered 2026-10-02, §10.2) | **20261025** | Inert | 2–3d |
| **P-3a** | **Checkout route (test mode)** | Checkout route behind a server flag: customer create, SR-5 lock, adaptive pricing off, runtime price check, held-account tier restriction. Demo: a test card pays; the router recognises a BOS plan invoice, logs that no handler exists yet, and releases the claim; no plan row changes | P-1 deployed to production (C-3), P-2. **Before any plan invoice is parsed:** the test-mode webhook endpoint's API version is confirmed as `2025-10-29.clover`, the SDK's version (Q-5, PF-9), and someone has looked at the prefix of the Vercel production `STRIPE_SECRET_KEY` (SA-P13; look only, never copy). Both are dashboard checks, because the repo's local key belongs to a separate, empty sandbox (§9.5). Both come back for live mode in §9.5. **For production to recognise a plan invoice** (P-2b): production's Stripe account holds the plan prices, `check-bos-plan-prices` passes against it, and only then `BUSINESS_OS_PLAN_PRICES_ENABLED` is turned on there (§10.2). **Code complete 2026-10-07, uncommitted, awaiting SA code review** ([P-3a workplan](/docs/workplans/BUSINESS_OS_PLAN_PAYMENTS_P3A_WORKPLAN.md), SA APPROVED WITH CONDITIONS C-1..C-6). Server switch `BUSINESS_OS_PLAN_CHECKOUT_ENABLED` (default off; the route refuses unless the price switch is also on). Merge gate G-2 met: the user stated on 2026-10-04 "checker passed, merged PR192" for 20261025, plus Dev's read-only column check. The endpoint-version and key-prefix checks above were **kept open by the user** (2026-10-07): they gate any demo against production and either switch in a shared environment, not this merge. Webhook unchanged (session events moved to P-3b, SA Q-1) | None | Flag off | 2–3d |
| **P-3b** | **Plan assignment (test mode)** | `business_os_apply_plan_payment`, money history (`business_os_billing_events`), system actor, `recordPlanChange` (audit + flush + invalidate) with the admin route refactored onto it, SA-P2 anchor, livemode check (PF-11, PF-13, PF-15). Demo: from `/test-business-os`, a trial account pays $79 with a test card; the Tiers page shows `basic`, paid-through = Stripe period end, credit period starting on the billing date; money history and audit written | P-3a. **Split in two PRs, in order, never stacked** ([P-3b workplan](/docs/workplans/BUSINESS_OS_PLAN_PAYMENTS_P3B_WORKPLAN.md), SA APPROVED WITH CONDITIONS C-1..C-8, 2026-10-07, Q-13): **P-3b.1** money history, apply function, `recordPlanChange` with the admin route on it, PF-13 anchor rule (inert); **P-3b.2** webhook plan handler, session events, subscription mirror, CF-2, demo. **Merge gate (SA Q-13): 20261027 is applied to production with checker and probe VERDICT PASS before P-3b.1 merges**, because P-3b.1 registers the new table in the purge, deletion and cleanup registries, which must never name a missing table. **P-3b.1 merged (#251); 20261027 and 20261042 applied to production.** **P-3b.2 implemented 2026-10-07, uncommitted:** the `plan` flow handler (`lib/business-os/billing/planBillingHandler.ts`, one registration line in the webhook route), paid invoices applied through the function, failed ones recorded (SA Q-2), session events (link + lock clear), the status-only subscription mirror (SA Q-1), CF-2. Open before merge: C-6 (captured `2025-09-30.clover` fixtures, from the demo) and the Connect harness entry P3 (a P-1 platform scenario that pins "no handler yet"), see the workplan. **2026-10-11: both closed. P-3b.2 MERGED as [PR #299](https://github.com/AgentsPilot/neuronforge/pull/299) (5c774539, 2026-10-11); no migration; both switches stay off on Vercel, so production behaviour is unchanged. P-3b COMPLETE.** P3 re-recorded alone with the CF-5 session's written agreement (SA F-1); SA approved with fixes, QA PASS WITH NOTES. Demo (T26) run 1 on 2026-10-09 in the sandbox (checkout and payment worked; production claimed the events first); the user confirmed the plan switch on 2026-10-11; the demo subscription was cancelled on 2026-10-11. **C-6 closed:** all five objects (invoice, invoice line, subscription, checkout session, checkout line item) captured in `2025-09-30.clover`, every field the code reads present. The live re-check moves to the user's separate "Stripe test account setup" session | **20261027** (was 20261026, taken on main; renumbered per P-10 SA C-2, §9.3) | Flag off | 2–3d (≈ 5.5d as two PRs) |
| **P-4** | **Buy button in Settings → Plan** (WS-2 step 2) | With `availableToBuy` on in a preview, an owner buys from Settings, sees "processing" then the new plan, in en/he/es with RTL. PF-7 recorded | P-3b | None | `availableToBuy` off | 2d |
| **P-5a** | **Friend pays and gets in** (invite 5c, first half; P-5 split 2026-10-11, §9.1.1) | A held test friend signs in and sees **"Finish your payment"** with Essentials, "$79 a month, excluding tax" and **Pay**. They pay with a test card in the embedded checkout, see "payment processing", then land in onboarding. Signing in again goes straight to the product. `first_paid_at` and `first_payment_ref` are stamped once, and a replayed webhook changes nothing. A declined card records nothing and leaves the friend held. A friend held since 5b sees the same screen, and nobody is emailed. The screen reads correctly in en/he/es, with Hebrew right to left. With `paidInvitesAvailable` off, the screen still says "payment coming soon" and the checkout refuses a held account (D5-3). Audit "first payment stamped" (AM-7). 20261028 adds the column grant and replaces `business_os_apply_plan_payment` to add the once-only stamp | P-3b (merged, #251 and #299). **Demo prerequisite (§9.1.1 N-5):** local and production share one database, and the sandbox's webhook endpoint forwards to production. A live demo therefore needs either the production endpoint paused for about 15 minutes (as on 2026-10-11) or the separate Stripe sandbox from the user's "Stripe test account setup" session. It also needs one designated held test friend, and the demo subscription is cancelled the same day. **Shipped as two PRs, never stacked** ([P-5a workplan](/docs/workplans/BUSINESS_OS_PLAN_PAYMENTS_P5A_WORKPLAN.md), SA APPROVED WITH CONDITIONS W-1 to W-12, 2026-10-11). **P-5a.1 "first payment stamp": implemented 2026-10-11, uncommitted, awaiting SA code review.** 20261028 with its pre-check, checker, rolled-back probe and rollback (all run on a local PGlite: pre-check, checker and probe PASS); the repository reads the new flag leniently; the webhook apply writes `BOS_BILLING_FIRST_PAYMENT_STAMPED` with the invoice-paid entry under one flush; P5-C4 source guards. Inert, no UI. **Merge gate G-3:** 20261028 applied to production with pre-check P5 and P6 = 0 and VERDICT PASS, checker VERDICT PASS and probe PROBE PASS, before P-5a.1 merges. **P-5a.2 "Pay screen": not started**; it branches from `main` after P-5a.1 merges, gated by G-4 (he/es wording) and G-6 (demo) | **20261028** (was 20261027; §9.3) | Inert: `paidInvitesAvailable` and both payment switches off, so the screen is unchanged. The replaced function is live but not called | 3d |
| **P-5b** | **Champion, admin and reports see the payment** (invite 5c, second half, with N-2) | After a P-5a payment, the champion's list shows **"Subscribed"** for that friend (FR-31). The champion gets **one** "{email} has subscribed" email in their own language (N-2, FR-43), and a replay sends nothing. The admin invites list shows paid, date and amount in USD, read from `business_os_billing_events` (FR-25), and still shows held friends as "signed up, not paid". The shadow report labels held accounts "awaiting payment" instead of flagging an anomaly, and the launch dry run lists them separately (SA-P18, T-9). Labels in en/he/es | P-5a | None expected | Live, read-only: the shadow-report label shows at once for friends already held; the paid fields stay empty until payments exist | 2–2.5d |
| **P-9** | **Admin Paid invites** (F3), built right after P-5 | Admin issues an Autopilot Paid invite on preview. The invitee signs up, is held, pays through P-5's pay-at-signup, and lands in onboarding at L1 with `pro` | P-5a (reuses its pay-at-signup; P-5b need not have merged). Built before P-6a: the user re-prioritised it on 2026-10-03 | **20261029** (was 20261028; §9.3) | `paidInvitesAvailable` off | 2–3d |
| **P-13** | **Admin waiver: let a held invitee in without paying** (BQ-P3; placed 2026-10-11, §9.1.1 D5-2) | An admin opens a held friend and chooses "Let in without payment". The admin must give a reason and choose a plan with an end date. On the friend's next sign-in they go to onboarding. They are **not** counted as paid: no `first_paid_at`, the champion sees "Joined", not "Subscribed", and there is no N-2 email and no perk. The admin list shows "waived" with who, when and why. Audited | P-5a (the hold and its release); P-9, so one design covers friends and admin Paid invitees. Before go-live only if BQ-P9 is answered yes (§10.3) | Next free number at Dev time (after 20261051): three waiver columns on the lineage table (SA S5-9, P5-C12; §9.3) | Admin action only; nothing changes until it is used | 2d |
| **P-6a** | **Renewal, failed payment, grace** | With Stripe test clocks (the test-mode customer is created on a test clock from `/test-business-os`): a renewal moves the paid-through date without restarting the credit period; a failed renewal shows the banner and reads grace after the 24-hour margin, then paused after 5 days; a 3-D Secure renewal shows the "confirm your payment" banner; a fixed card returns to active; `subscription.updated/deleted` mirrored; Stripe giving up reads ended. The 5-day grace history (PF-1) and the 24-hour margin (PF-10) land here as config history entries (C-10) | P-3b; built after P-9 (build order only, not a technical dependency; user 2026-10-03) | None | Inert (no live subscriptions) | 3d |
| **P-6b** | **Refunds and disputes** | A refund and a dispute on a test plan payment are each recorded and flagged, never "unknown payment", resolved via the Basil invoice-payment lookup (PF-6, PF-9) | P-6a | None | Inert | 2–3d |
| **P-7a** | **Card, invoices, cancel and reactivate** (WS-2 steps 3–4, part) | Owner updates the card in the portal, sees the invoice list, cancels ("Ends on…"), reactivates. Reset and deletion are refused while the subscription is live (PF-14, C-11) | P-6a | None | Behind the flag | 2–3d |
| **P-7b** | **Upgrade and downgrade** | Upgrade charges the prorated amount and switches now; downgrade is scheduled and applied at renewal (test clock); the credit period is not restarted | P-3b, P-6a | None | Behind the flag | 2–3d |
| **P-8a** | **Admin billing panel and subscriptions list** (AM-1 to AM-3, AM-7) | Admin opens an account and sees Stripe vs plan row side by side; the new tab filters by status and shows totals, including MRR, filtered on the current `livemode` (PF-15) | P-3b | None | Live (read-only; empty until data exists) | 2–3d |
| **P-8b** | **Reconciliation and webhook health** (AM-4, AM-5, PF-5) | A `processing` claim older than 15 minutes is reclaimed in the webhook (SA-P4 part 1); a forced stuck claim is recovered by the nightly `bos-billing-reconcile` job or the button; a deliberate Stripe vs plan-row mismatch shows as a flag; Jobs page lists failed and stuck events | P-6a | None. The 20261029 spare went to P-9 (§9.3); if one is ever needed, take the next free number after 20261038 at that time (P-10 SA C-2) | Live (read-only plus recovery through the same idempotent path) | 2–3d |
| **P-10** | **Retire the rest of the Pilot-Credit purchase path** (WS-3) | §4.6's *Dies* list removed, *Survives* intact, *Guarded* implemented, TK-3 per BQ-P8; Connect before/after evidence. **Split in two PRs** ([P-10 workplan](/docs/workplans/BUSINESS_OS_PLAN_PAYMENTS_P10_WORKPLAN.md), SA-approved with conditions 2026-10-05): **P-10a** server (webhook status mirror only, `sync-subscription` and `create-checkout` 410 for every purchase type incl. the boost pack per Credits Boost FR-40, price-minting methods and `CreditService` stubs deleted, freeze job inert and permanently unscheduled, TK-6 guard, migration 20261038) and **P-10b** the old billing UI (after P-10a merges). Merge gate: the frozen-account pre-check (both counts) recorded first (SA C-1) | P-1; the `billing_events` shape query answered (SA-P5, C-4) | **20261038** (P-10a) | Live (deletion) | 3–3.5d |
| **P-11** | **Founding Partner conversion** (F10) | A champion with an end date sees the prompt, buys with the founder discount, and continues without a break on the end date (test clock) | P-4 (BQ-P1 and BQ-P2 decided 2026-10-02) | None expected | Behind the flag | 2d |
| **P-12** | **Go-live** (a checklist, not code) | §9.5 | §9.5 row 1: the technical floor (SA-4) plus BQ-P4 as re-prioritised on 2026-10-03 (§10.1), meaning P-0, P-1, P-2, P-3a, P-3b, P-4, P-5a, P-5b, P-9, P-6a, P-6b, P-7a, P-8a, P-8b, P-10 (P-5 split 2026-10-11), and P-13 (BQ-P9 decided yes on 2026-10-11, §10.3). Then every other §9.5 row, including SR-13 and SR-14 | — | **Live money** | — |

### 9.1.1 P-5 scoping (2026-10-11)

The user confirmed P-5's scope in plain terms on 2026-10-11: "yes, matches. let's start". This subsection records what was agreed, how it is sliced, what P-3a and P-3b already built, the gaps found, and notes for Dev and SA. It changes no earlier decision.

**Agreed scope**

| In | Out (and where it lives) |
|---|---|
| The holding screen says "Finish your payment" with Essentials, "$79 a month, excluding tax" and **Pay**. This includes friends already held since 5b, and nobody is emailed (BQ-8) | Admin Paid invites (P-9) |
| The plan checkout admits a held account and still refuses one whose subscription is live or pending (SR-5) | Perks for either side (FR-38, invite §14) |
| On the paid plan invoice, the hold lifts and the friend lands in onboarding | Reminders or deletion for unpaid friends (BQ-8) |
| `first_paid_at` and `first_payment_ref` are stamped exactly once. A replay never stamps them, and neither does a boost (SR-6, SR-7) | Any plan other than Essentials at signup (BQ-14, FR-30). The friend can upgrade after paying (F7) |
| The champion sees "Subscribed" and gets one N-2 email (FR-31, FR-43) | Admin waiver (BQ-P3): its own slice, P-13 |
| The admin invites list shows paid, date and amount (FR-25) | — |
| The shadow report labels held accounts "awaiting payment", and the launch dry run lists them (SA-P18, T-9) | — |
| A declined card leaves the friend held, with no time limit, and they can retry | — |
| Everything stays behind `paidInvitesAvailable` (off) | — |

**Decisions (BA, 2026-10-11)**

| # | Decision | Why |
|---|---|---|
| D5-1 | **P-5 is split into two slices.** **P-5a**, "Friend pays and gets in" (about 3 days): the stamp migration, the Pay screen and its processing state, the switch check on the held checkout, and the "first payment" audit. **P-5b**, "Champion, admin and reports see the payment" (about 2 to 2.5 days): "Subscribed", the N-2 email, the admin paid column, the shadow-report label and the dry-run list | The 3-day estimate predates N-2 (added 2026-10-04), the audit event and the i18n work; together they come to about 5 to 5.5 days. Each half has its own demo, and P-5a alone closes the money-path gap G5-6. P-9 needs only P-5a |
| D5-2 | **The admin waiver (BQ-P3) is its own slice, P-13, after P-9** | Paying does not need it. The waiver changes the hold gate itself, giving a second way out besides `first_paid_at`. It needs an admin action with a required reason and a plan with an end date. Everywhere P-5b shows a payment, it must also show a waiver as different from a payment. Placing it after P-9 means one design covers both held friends and admin Paid invitees. Size: about 2 days. Whether it must ship before the first real charge is the business question BQ-P9 (§10.3) |
| D5-3 | **One switch, one rule.** A held account sees **Pay**, and the checkout admits it, only while `paidInvitesAvailable` is on **and** the checkout would accept the payment (the checkout and price switches are on). Otherwise the screen keeps today's "payment coming soon" | Follows the agreed scope ("everything behind `paidInvitesAvailable`"). The screen must never offer a payment the server would refuse |
| D5-4 | **Every account with a lineage row is stamped on its first paid BOS plan invoice above $0**, as invite §6.4 says, so a Founding Partner who later buys is stamped too. **N-2 goes only to a champion, about a friend invite** (`account_invite`) | Matches invite §6.4 and FR-43 as written. "Paid signups per level" (FR-27) needs every first payment |
| D5-5 | **A waived friend is not "Subscribed".** The champion sees "Joined" (the N-1 wording), no N-2 is sent, and admins see "waived" | BQ-P3: a waiver is not a payment and is not a paid signup. Decided without asking, so it can be overridden |
| D5-6 | **N-2 is best effort and sent once.** It is sent only when this payment wrote the stamp. It never fails the payment and never holds it past its time budget. A lost send is not retried, and the status stays visible in the champion's list, as for N-1 | FR-39, FR-43; N-1 SA Q-1, Q-2 |

**Already built by P-3a and P-3b (P-5 does not rebuild it)**

| Item | Built in | For P-5 |
|---|---|---|
| The plan checkout admits a held account (G-12, SA-P11). A held friend may buy Essentials only, from the invite config with no tier literal. A held admin invitee is refused until P-9. An unreadable hold is refused | P-3a (#248) | P-5a only adds the `paidInvitesAvailable` condition (D5-3). The "must admit" in F2 row 2 and §9.4 is done |
| SR-5: refused while a subscription is live or pending or a checkout is open, through the record, a Stripe check and the lock | P-3a | AC-F2.3 is shown again in the P-5a demo, not rebuilt |
| `returnTo: 'awaiting_payment'`, so the checkout returns to the holding screen | P-3a (SA Q-7) | No API change in P-5a |
| `readPaymentHold` returns the lineage `source` | P-3a (SA Q-3) | Reused by the shadow report and the dry run (SA-P18), never copied |
| A paid plan invoice assigns `basic` through `business_os_apply_plan_payment`, writes the money history and audits `BOS_BILLING_INVOICE_PAID` | P-3b (#251, #299) | **It does not touch lineage, so a held friend who pays today gets `basic` and stays held** (P-3b R-6). Production is safe because every switch is off there. P-5a closes this |
| The entitlement cache is cleared after a plan write, and the hold is read uncached | P-3b | The release takes effect on the friend's next page load |
| Boost refuses held accounts (boost R-1) | Credits Boost | AC-F2.4 is a test, not new code |

**Gaps and contradictions found (2026-10-11)**

| # | Gap | Resolution |
|---|---|---|
| G5-1 | The P-5 row did not mention the N-2 email (FR-43, invite §7.10, decided 2026-10-04 "with P-5") | In P-5b; AC-F2.8 |
| G5-2 | The P-5 row had no "first payment stamped" audit, though AM-7 and invite §8.3 require one | In P-5a; AC-F2.9. SA names the event (S5-4) |
| G5-3 | No i18n was named for the new text: the Pay screen and its processing state, "Subscribed", the N-2 email and the admin labels | en/he/es, with Hebrew right to left, in P-5a and P-5b. The user approves the he/es wording, as for 5a (invite §0.7); AC-F2.7 |
| G5-4 | F2 and §9.4 say the checkout "must admit" held accounts, which P-3a already built | Treated as done. P-5a only adds D5-3 |
| G5-5 | P-3a admits a held friend whenever the checkout switch is on, whatever `paidInvitesAvailable` says | P-5a adds the switch to the held path (D5-3, S5-1); AC-F2.5 |
| G5-6 | Since P-3b.2 (#299), a held friend who pays where both payment switches are on gets `basic` but stays held | No shared environment turns both payment switches on before P-5a merges. Both are off in production |
| G5-7 | F2 row 1 said "its price" without the BQ-P5 wording | "$79 a month, excluding tax", read from `presentation`, never written as a literal. F2 row 1 is updated |
| G5-8 | F2 had no "payment processing" step, unlike F1, yet the webhook can arrive after the friend is back from checkout | In P-5a, the screen shows "processing" until the hold is lifted, then goes to onboarding. A failed read never lets anyone in (as SA R-4); S5-6 |
| G5-9 | Invite FR-25, §6.4 and §8.3 name `billing_events` "with the product dimension" as the payment source | Stale since SA-P5 reversed Q-T3: the source is `business_os_billing_events`. Read the invite text through that ruling; AC-F2.2 |
| G5-10 | `FriendInviteStatus` has no "subscribed" value (as-built §3.3) | P-5b |
| G5-11 | P-5 and P-9 say "on preview", but every demo so far ran locally against the sandbox on the shared database | Read "on preview" as: locally, or wherever the user's test-account setup provides. The demo prerequisite is in the P-5a row (N-5) |
| G5-12 | Turning `paidInvitesAvailable` on also lets admins issue Paid invites, while redeeming them waits for P-9. An admin could send a Paid invite that cannot be redeemed | The switch is turned on only at §9.5 row 17, which comes after P-9. P-5 demos do not issue admin Paid invites. SA confirms this or splits the switch (S5-7) |
| G5-13 | No slice owned the waiver (BQ-P3) | P-13 (D5-2); AC-F2.11 |
| G5-14 | FR-43 tells only the champion. Nobody is emailed about an admin Paid invitee's first payment (P-9), or about a Founding Partner's own first payment | Kept as written. P-9 can raise an admin-facing "subscribed" email as a question if it is wanted |

**Notes for Dev and SA**

| # | Note |
|---|---|
| N-1 | **20261028 stays with P-5a**: the column grant on `first_paid_at` and `first_payment_ref`, and the replacement of `business_os_apply_plan_payment` with the once-only stamp. At workplan time, Dev confirms the number is still free on main and still sorts after 20261027, so a replay leaves the newer function body in place |
| N-2 | **P-5a and P-5b add no table**, so the test-account cleanup function is not touched. On main its chain ends at `20261047_operator_test_account_cleanup_audit_actor`. If a change in P-5 or P-13 adds a table the cleanup must know about, it ships as a new `CREATE OR REPLACE` of the cleanup function on the **next free number at Dev time**. Main's highest migration on 2026-10-11 is **20261051**, so that means 20261052 or later. The SQL is SA's call |
| N-3 | P-13 also takes the next free number at Dev time. SA ruled that the waiver marker is stored (S5-9, 2026-10-11): three columns on the lineage table, no new table (§9.3) |
| N-4 | Cleaning up a paid test friend: deletion and reset are refused while the subscription is live (PF-14), so the demo subscription is cancelled in Stripe the same day (as P-3a C-5) |
| N-5 | **Live demo prerequisite (P-5a).** Local and production share one database, and the sandbox's webhook endpoint forwards to production. A live P-5a demo therefore needs one of two things: the production endpoint paused for about 15 minutes (as on 2026-10-11, `we_1UNG3L56GTXD0wwiKUsZn8DU`), or the separate Stripe sandbox from the user's "Stripe test account setup" session. It also needs one designated held test friend, created through a real friend invite from a test champion |
| N-6 | **Audit visibility carry-forward (SA P-5a.1 code review, D-3, 2026-10-11).** The P-5a.1 audit entity type `business_os_account_lineage` is classified owner-visible, and visibility is decided per entity type, so every later entry on it is owner-readable too. **P-13's `BOS_INVITE_PAYMENT_WAIVED` (admin actor) and P-5b's "not notified" entry must use an operator-only entity type**, or reclassify this one together with an owner-policy migration on `audit_trail`. Binding on the P-5b and P-13 workplans |

**For SA (P-5a and P-5b workplan review)**

| # | Item | BA note |
|---|---|---|
| S5-1 | The held path of the checkout also requires `paidInvitesAvailable` (D5-3) | Fail closed, like the hold read |
| S5-2 | The Pay button and the checkout use the same predicate | One function, not two copies, so the screen never offers what the server refuses |
| S5-3 | The stamp inside the replaced function: a BOS plan invoice above $0 (a $0 trial invoice stamps nothing, SA-P16c), a lineage row, `WHERE first_paid_at IS NULL`, Stripe's paid time and the invoice id (the ruling under SA-2) | The caller must learn whether **this** call wrote the stamp, so the audit entry and N-2 each happen once |
| S5-4 | The audit event for the first payment (AM-7, invite §8.3) | A registered `BOS_BILLING_*` event or a field on `BOS_BILLING_INVOICE_PAID`; SA chooses. N-2's notified and not-notified audit entries follow N-1's |
| S5-5 | N-2 sent from the webhook path | Reuse N-1's module, template and deadline. Send after the money write and the audit flush, within the webhook's time budget. It never changes the webhook's answer |
| S5-6 | How the holding screen learns, after checkout, that the hold is lifted | Re-read on load, or a short poll. Never release on a read error |
| S5-7 | `paidInvitesAvailable` also opens admin Paid invites before P-9 exists (G5-12) | Confirm the switch is turned on only after P-9, or split it |
| S5-8 | The admin's paid, date and amount come from the money-history row of `first_payment_ref` | A cross-account admin read. The service-role use is documented, and nothing is copied onto lineage |
| S5-9 | P-13 waiver design | A durable record of who, when and why, separate from `first_paid_at`. The hold reads it, which is gate-critical code. The plan is assigned in the same admin action, so the account never has no basis (R2-3). `requireAdmin`, a required reason, an audit entry. P-5b's views show waived as different from paid |

### 9.2 Order

```mermaid
flowchart LR
  P0[P-0 webhook Pino = Boost slice 0] --> P1
  P1["P-1 router (merged, PR 188)"] --> P3a
  P2[P-2 prices + billing record] --> P3a
  Q5["Test endpoint API version = 2025-10-29.clover; key prefix looked at"] --> P3a
  P3a[P-3a checkout route] --> P3b[P-3b plan assignment]
  P3b --> P4[P-4 buy button]
  P3b --> P5a[P-5a friend pays + first-payment stamp]
  P5a --> P5b[P-5b champion, admin, reports, N-2 email]
  P5a --> P9[P-9 admin Paid invites]
  P9 --> P13[P-13 admin waiver]
  P9 -. build order .-> P6a
  P3b --> P6a[P-6a renewal + failure + grace]
  P3b --> P8a[P-8a admin panel + list]
  P6a --> P6b[P-6b refunds + disputes]
  P6a --> P7a[P-7a card, invoices, cancel]
  P6a --> P7b[P-7b upgrade/downgrade]
  P6a --> P8b[P-8b reconciliation]
  P1 --> P10[P-10 retire Pilot-Credit path]
  P4 --> P11[P-11 Founding Partner]
  GL["9.5 go-live checklist: G-1, TK-1, tax, live Stripe setup, keys, switches"] --> P12[P-12 go-live]
  P9 --> P12
  P5b --> P12
  P13 --> P12
  P7a --> P12
  P8b --> P12
  P10 --> P12
  P6b --> P12
  P8a --> P12
```

P-2 and P-1 can run in parallel. P-1 must be deployed to production before P-3a merges (C-3). P-1 merged on 2026-10-03 (#188). Before P-3a parses a plan invoice, the test endpoint's API version and the key prefix are checked (§9.1 P-3a row). After P-3b, P-5a is followed by P-5b and directly by P-9, which reuses P-5a's pay-at-signup. P-13, the admin waiver, follows P-9 (§9.1.1, decided 2026-10-11). P-9 is built before P-6a. The user re-prioritised this on 2026-10-03; it is build order, not a technical dependency. P-4 and P-8a stay independent of the others. G-1, TK-1 and every other live-only item gate only P-12 (→ §9.5), not the test-mode slices.

### 9.3 Migrations

| Number | Slice | Contents (SA decides the shape) |
|---|---|---|
| 20261025 | P-2 | Business OS billing record `business_os_billing_accounts`, full column set (SA-P1). Server-write-only (L-29) |
| 20261027 | P-3b | Money history `business_os_billing_events` (SA-P5, with the four Q-10 columns) and the plan-assignment function `business_os_apply_plan_payment` (SA-P3 as amended: Q-7, Q-11, C-1 to C-4); the function does not reference the lineage table. Append-only (`service_role` SELECT and INSERT only). Pre-check `scripts/precheck-bos-billing-events-migration.sql`, checker `scripts/check-bos-billing-events-migration.sql`, rolled-back probe `scripts/probe-bos-apply-plan-payment.sql`, rollback in `supabase/SQL Scripts/` (refuses once a live-mode row exists). Applied before P-3b.1 merges (SA Q-13). **Applied to production** (recorded by TL at the P-3b.2 kickoff, 2026-10-07; P-3b.1 merged as #251). P-3b.2 is its first caller |
| 20261042 | P-3b.1 (cleanup) | New version of the test-account cleanup function `operator_test_account_cleanup` (owned by the Danger Zone cleanup, PR #249; its 20261041 is applied and never edited). `CREATE OR REPLACE` only: adds `business_os_billing_events` to guard G-5 and to the plan, keeps the schema, the secret table and the hash. Generated by `scripts/generate-test-account-cleanup-sql.ts`; refuses until 20261041 and 20261027 are applied. **Apply after 20261027 and right before P-3b.1 deploys**: the app pins the function's version stamp, and the Danger Zone check and delete refuse (fail closed) while the two disagree. Rollback restores the 20261041 function ([runbook](/docs/runbooks/TEST_ACCOUNT_CLEANUP_RUNBOOK.md) §6.1.1, §6.7). **Applied to production** (recorded by TL at the P-3b.2 kickoff, 2026-10-07) |
| 20261028 | P-5a (P-5 split 2026-10-11) | Column-level UPDATE on `first_paid_at`, `first_payment_ref`, and a replacement of `business_os_apply_plan_payment` that adds the once-only stamp (F5c-2, SA-2). BA need (2026-10-11): the caller must be able to tell a first stamp from a replay, so the audit entry and the N-2 email each happen once; SA decides how. It adds no table, so the test-account cleanup function is not touched. Dev confirms at workplan time that 20261028 is still free on main and still sorts after 20261027 (§9.1.1 N-1, N-2). **Built in P-5a.1 (2026-10-11, uncommitted):** `supabase/migrations/20261028_business_os_first_payment_stamp.sql` drops and re-creates the function with a seventh output `out_first_payment_stamped` (the 20261027 body plus one declaration, the flag set to false first, and the stamp block), and grants UPDATE on the two columns only. Scripts: `scripts/precheck-bos-first-payment-stamp-migration.sql`, `scripts/check-bos-first-payment-stamp-migration.sql`, `scripts/probe-bos-first-payment-stamp.sql`, rollback `supabase/SQL Scripts/20261028_business_os_first_payment_stamp_rollback.sql`. Re-checked free on `origin/main` `a66b4c41` on 2026-10-11 (highest there 20261051). **After 20261028 the P-3b checker `scripts/check-bos-billing-events-migration.sql` reads rows 81 and 83 FAIL by design** (the six-output names and the 20261027 body md5); every other row still passes, so its VERDICT is FAIL for those two rows only. It is not edited; the 20261028 checker prints this as C9, and the rollback restores both rows to PASS. Applied state: **not yet applied** (merge gate G-3) |
| 20261029 | P-9 | Redemption path for admin-issued tier invites (SA-P9) |
| Next free at Dev time (after 20261051) | P-13 | **Columns on the lineage table** (SA S5-9, P5-C12): three nullable waiver columns on `business_os_account_lineage` (`payment_waived_at`, `payment_waived_by` with no foreign key, `payment_waiver_reason`), their CHECKs, and a column-level UPDATE grant on the three to `service_role`. Columns, not a table, so the test-account cleanup function gets no new version; Dev runs the Danger Zone check on a test account after applying it |
| 20261038 (renumbered 2026-10-06: 20261036 was taken on main) | P-10a | Browser grants removed (`anon`, `authenticated`): ALL on `billing_events`, `boost_pack_purchases`, `subscription_invoices`, `processed_webhook_events`; writes only on `boost_packs` (SELECT kept until P-10b). `service_role`, policies and RLS unchanged |
| 20261039 | P-10 follow-up (SA Q-7 one-liner, P-10b B-4) | Browser SELECT removed on `boost_packs` (`anon`, `authenticated`); P-10b (#238) removed its last browser readers. `service_role`, policies and RLS unchanged. Applied by hand: pre-check `scripts/precheck-boost-packs-client-select.sql`, checker `scripts/check-boost-packs-client-select-migration.sql`, rollback in `supabase/SQL Scripts/`. **Merged (PR #243) and applied to prod 2026-10-07** by the user: pre-check as expected (2 policies, 0 dependents, 3 rows, 0 active), checker VERDICT PASS 21 pass 0 fail |
| 20261040 | P-10 follow-up (route standards refactor, [workplan](/docs/workplans/ADMIN_BOOST_PACKS_ROUTE_STANDARDS_WORKPLAN.md)) | Drops the two dead `boost_packs` policies ("Boost packs are publicly readable", "Service role can manage boost packs"); RLS stays enabled with no policy, so only the service role reads or writes the table. Grants unchanged. Pre-check `scripts/precheck-boost-packs-dead-policies.sql`, checker `scripts/check-boost-packs-dead-policies-migration.sql`, rollback in `supabase/SQL Scripts/`. After it, the 20261039 checker's C5 (expects 2 policies) reads FAIL by design. Pending manual apply |

**Renumbered 2026-10-05 (P-10 workplan, SA condition C-2).** 20261026 is already used on `main` by another session's `20261026_business_os_credit_charges_activity_indexes.sql`, so the block shifts by one: **P-3b 20261027, P-5 20261028, P-9 20261029**. The order matters: P-5 *replaces* `business_os_apply_plan_payment`, which P-3b creates, so P-3b must sort before it or a replay lets the older function body win. P-8b's spare is dropped; if a later slice needs one, it takes the next free number after 20261038 at that time. The SA Review section (SA-2, SA-4) keeps the old numbers as written on its date; this table is the current assignment.

**Reserved by others:** 20261016–19 credit deduction (20261017 in flight), 20261020–22 invite signup, 20261030–34 Credits Boost. **Record the 20261025–29 reservation (renumbered 2026-10-05 per C-2: 20261026 is taken on main, so the block is now 20261025 and 20261027–29, plus 20261038 for P-10a) with both sessions before the first workplan** (as-built G-11). Each migration is safe to apply before its code deploys, ships a read-only check script and a rollback script, and the user applies it to production by hand.

### 9.4 Coordination with Credits Boost

| Shared item | Who | Rule |
|---|---|---|
| Webhook Pino conversion | P-0 = Boost slice 0 (whichever session starts first) | Merges before P-1 (C-1); no plan code goes into the unconverted file |
| Business OS webhook dispatcher | **Whoever lands first** (boost R-3) | P-1 builds it if boost 4a has not landed; otherwise P-1 adds the plan branch to it. A payment resolved as a boost is never offered to the plan branch, and the reverse |
| Stripe customer | Plan payments (this work) | Boosts create no Stripe customer in v1 (boost T-8, F-10), so the customer helper split (Q-T8, DEP-4) is P-2's |
| `first_paid_at` | Plan payments only | SR-6, boost R-2 |
| Held accounts | Opposite rules | The boost checkout refuses held accounts (boost R-1); the plan checkout must admit them (G-12) |
| Stuck-event recovery and reconciliation | Both | One cron route, `bos-billing-reconcile`, with pluggable passes; whichever of P-8b and boost 4b lands first creates it, the other adds its pass; passes never share rows (SA-P4) |
| `billing_events` | Neither | Business OS writes its own `business_os_billing_events` (SA-P5, Q-T3 reversed); boost does not write `billing_events` either (boost T-16) |
| Admin views | Separate homes | Boosts on the Costs & credits tab; plan billing on the Tiers page |

**Recorded by P-1 (2026-10-03).** Boost 4a had not landed, so **P-1 built the dispatcher**: `lib/business-os/billing/webhookDispatcher.ts`, called once from `POST /api/stripe/webhook` for platform events only. Boost 4a adds its resolver by appending it to `DEFAULT_RESOLVERS` and registers its handler in the route's `BUSINESS_OS_FLOW_HANDLERS` (`boost`); the metadata marker it uses is `BOS_BOOST_PRODUCT_MARKER` in `lib/business-os/billing/stripeMetadataKeys.ts`. Two resolvers deciding the same event is denied as `resolver_conflict`.

**P-1 carry-forwards (SA P1-C8).** Not lost between slices:

| # | Carry-forward | Owner |
|---|---|---|
| CF-1 | **Retired-price recognition (Q-4).** Lookup keys move to the new price when a price changes, so a renewal on the old price would carry an id no key resolves to, and be denied. The P-2 workplan must state how such a renewal is recognised (and with which tier). **Answered in P-2b (2026-10-06):** retired lookup keys, not retired price ids. The old price is moved to `<key>_retired_<yyyymmdd>`, which `config/planPrices.ts` lists under its tier, so it stays recognised and keeps its tier; procedure in P-2 workplan §3.2 and BUSINESS_OS_ENTITLEMENTS.md § Plan prices in Stripe | P-2 |
| CF-2 | **Fetch on truncation (Q-8).** P-1 denies an invoice whose `lines.has_more` is true. Before P-3b assigns plans, a truncated **recognised** invoice must be fetched in full, not denied for good. **Closed in P-3b.2 (merged as #299, 2026-10-11):** with the price switch on, the router reads a truncated invoice's lines in full (`StripeService.listInvoiceLinesAll`, paged, throws rather than answer partially) and decides it like any other; the plan handler reads them again for the facts. With the switch off it is still P-1's `lines_truncated` deny, with no Stripe call | Before P-3b |
| CF-3 | **`sync-subscription` stays a metadata-driven credit path** until P-10. No Business OS impact, because Business OS uses its own Stripe customer (SA-P1), but it must stay on P-10's list. **Closed in P-10a (2026-10-05, code complete, not yet merged):** the route authenticates and returns 410, with no Stripe or database call | P-10 |
| CF-4 | **P-3a writes no legacy metadata** (`user_id`, `credits`, `pilot_credits`) on any Business OS object (C-3, SA Q-7): P-1's router denies a known plan price that carries them, and `handleSubscriptionUpdated` / `sync-subscription` still act on them. **Closed in P-3a (2026-10-07, code complete, not merged):** the session's metadata and subscription metadata are built inside `StripeService.createBusinessOsPlanCheckoutSession` from the shared keys only (`product`, `bos_user_id`), the method takes no metadata from its caller, and source guards over the checkout files and the method fail on any legacy key | P-3a |
| CF-5 | **Webhook Connect-side DB access → repositories** (CLAUDE.md rule 1, follow-up named at P-1). The 51 remaining direct `.from(` calls and the route's own service-role `createClient` in `app/api/stripe/webhook/route.ts` move behind `lib/repositories/`, no behaviour change, proven byte-identical by the P-0 Connect harness. [Workplan](/docs/workplans/BUSINESS_OS_WEBHOOK_CONNECT_REPOSITORIES_WORKPLAN.md) SA-approved with conditions C-1..C-9 (2026-10-06): six sequential PRs (0 harness gaps → 1 claim table + client → 2 invoices → 3 money rows → 4 plans + bookings → 5 legacy tables + final guard). The SA review also confirmed pre-existing tenant holes F-1/F-2/F-4 (security fix PR "Fix-1") and the plan-end bug F-3 ("Fix-2", business decision); these are separate PRs, never inside the refactor. Order (user, 2026-10-07: security fix first; Fix-1b and FU-5 kept in this effort, F-3 handed to Offir by email 2026-10-07): **Fix-1** ([workplan](/docs/workplans/BUSINESS_OS_WEBHOOK_CONNECT_FIX1_WORKPLAN.md)) → **Fix-1b** (F-5; [workplan](/docs/workplans/BUSINESS_OS_WEBHOOK_PLAN_BOOKING_OWNERSHIP_FIX1B_WORKPLAN.md), SA-approved C-1..C-6, code complete 2026-10-07; follow-ups: scope the `propagate_refund_to_booking` trigger, both halves, as its own migration; bind's 5 inline queries join CF-5 PR 4) → PR 0..5; F-3 decision open. **Status: done.** Fix-1 (#242), Fix-1b (#246), FU-5 (#250) merged; refactor PR 0 (#254), PR 1 (#258), PR 2 (#266), PR 3 (#270), PR 4 (#275) and PR 5 (#279) merged. `app/api/stripe/webhook/route.ts` issues no query of its own: 51 → 0 `.from(`, its private `createClient` and the `supabaseAdmin` alias are gone, and `supabaseServer` is held only to hand to `pilotCreditsToTokens`, `QuotaAllocationService` and `resolveAccountOwner` (SA Q-2). `bindPlanSubscription.ts` (5) and `resolveAccountOwner` (2) moved behind repositories too. Proven byte-identical by the P-0 harness at every step (snapshot 103 entries, blob `4194ff19`), and held by a rule-1 source guard in `routerPlacement.guard` (no `.from`/`.rpc`; from `@/lib/supabaseServer` only the plain `supabaseServer`, and only as the three helpers' argument; no other client; no repository class named, so none built; repositories imported only by plain named static imports, never by `import()`/`require()`; singletons only as direct call receivers). Still open, separate from CF-5: F-3 (Fix-2, Offir's decision), the `propagate_refund_to_booking` trigger scope (migration follow-up), FU-1/FU-2/FU-6 retirements (FU-7 goes with FU-2), FU-3, FU-4, FU-8, FU-9, and T29 (`resolveUserConnectAccounts`, `resolvePaymentCollectionCapability`). | After P-10 |
| CF-6 | **$0 upgrade paid from the Stripe credit balance (P-3b SA C-3).** Under P-3b's assigns-plan rule (an amount paid, or a discounted cycle invoice), a $0 `subscription_update` invoice that the customer's Stripe credit balance paid in full never switches the tier: the upgrade would be recorded but not applied. P-4 (the buy and upgrade button) must decide how such an upgrade is recognised before upgrades are offered | P-4 |

### 9.5 Go-live checklist (P-12): switching to real money

**This is the single list of everything to do when going live.** Other sections point here (→ §9.5) instead of repeating an item; the rulings behind each row stay where they are and are cited. Nothing in this list gates a test-mode slice. When a row is complete, tick **Done** and add the date. P-12 is complete when every row is ticked.

**Where things stand (2026-10-03).** Every webhook event production has processed so far is test mode (§10.2). The repo's local test key belongs to a separate, empty Stripe sandbox ("AgentsPilot sandbox", with no webhook endpoints and no events). So production's Stripe environment cannot be inspected from the repo, and every Stripe-side row below is a dashboard check by the user or Offir. Two items were taken off the P-1 merge gate on 2026-10-03, and P-1 merged that day (#188) on that basis, because P-1 recognises nothing and so denies every platform invoice:

- TK-1. The user said: "we are still in testing mode, so not worries for now".
- The webhook API version and Vercel key-prefix checks. These come back at the P-3a gate (§9.1) for test mode, and here for live mode.

| # | Item | Owner | When | Done |
|---|---|---|---|---|
| 1 | **Build complete per BQ-P4.** Merged and deployed: the technical floor (P-0, P-1, P-2, P-3a, P-3b, P-6a, P-6b, P-7a, P-8b), plus P-4, P-5a, P-5b, P-9, P-8a and P-10 (BQ-P4 as re-prioritised on 2026-10-03, §10.1; P-5 split 2026-10-11, §9.1.1), and P-13 (BQ-P9 decided yes on 2026-10-11, §10.3). This includes the stuck-claim reclaim (PF-5) and the refusal of reset or deletion while subscribed (PF-14, C-11) | Dev | Before row 2 | ☐ |
| 2 | **SA go-live review.** SA confirms row 1, confirms that conditions C-1 to C-12 and carry-forwards CF-1 to CF-4 (§9.4) are closed, and signs off the Dev rows of this list | Dev (SA review) | Before row 7 | ☐ |
| 3 | **G-1**: service-role key rotation verified (SR-13) | User + Offir | Before row 14 | ☐ |
| 4 | **TK-1**: check the four agent-platform subscriptions in the Stripe dashboard. Record whether each is live or test mode, and cancel any live one. Since P-1, their invoices are denied rather than converted to Pilot Credits (SR-14) | User | Before row 14 | ☐ |
| 5 | **Accountant's tax answer**, covering plans as well as boosts (BQ-P5; boost DEP-7) | User | Before row 7 | ☐ |
| 6 | **Test and live data kept apart (PF-15, C-9).** Every billing row carries `livemode`. The webhook refuses an event whose mode differs from the key's. Admin lists and MRR filter on the current mode. Demo accounts stay test-only. The test-mode demo deployment keeps its test keys and its own test endpoint | Dev | Before row 14 | ☐ |
| 7 | **Live products and prices** for `basic` ($79) and `pro` ($129), with the **same lookup keys** as test mode (Q-T1). `tax_behavior` is set to "excluding tax" per BQ-P5, and Stripe does not let it change once set. `check-bos-plan-prices` passes in live mode (SA-P12). The plan price switch `BUSINESS_OS_PLAN_PRICES_ENABLED` is on in production only once that check passes against production's account (P-2b, §10.2) | User with Dev | After rows 2 and 5 | ☐ |
| 8 | **Live webhook endpoint** pointing at production `/api/stripe/webhook`. It is subscribed to exactly the SA-P8 event list; `invoice.created`, `invoice.upcoming` and `customer.subscription.created` are not subscribed. It keeps every event Connect already receives (SR-10) | User | Before row 14 | ☐ |
| 9 | **The live endpoint's API version is `2025-10-29.clover`**, the version the SDK is pinned to (Q-5). The webhook reads only clover-era shapes (PF-9) | User | With row 8 | ☐ |
| 10 | **Customer emails**: "Successful payments" on (Stripe sends subscription receipts only when this is on, F9), plus "Failed payments" and the authentication (3-D Secure) email. AgentPilot branding set | User | Before row 14 | ☐ |
| 11 | **Retries**: Smart Retries for about two weeks, then cancel the subscription (BQ-P7) | User | Before row 14 | ☐ |
| 12 | **Adaptive Pricing and local-currency presentment off** (SA-P15, SR-15). Set before row 14, then confirmed on the first live session (row 18) | User with Dev | Before row 14; confirmed at row 18 | ☐ |
| 13 | **Portal configuration** created in live mode by the script, and its id set as `STRIPE_BOS_PORTAL_CONFIGURATION_ID` in production (SA-P10) | User with Dev | Before row 14 | ☐ |
| 14 | **Vercel production keys.** `STRIPE_SECRET_KEY` switched to the `sk_live_` key (look at the prefix, never copy a key into a chat or doc). `STRIPE_WEBHOOK_SECRET` set to the live endpoint's signing secret. The publishable key used by the embedded checkout switched to live. Then redeploy. **Connect client payments use the same key and endpoint (SR-10), so confirm with Offir before switching** | User + Offir | Switch day, after rows 1–13 | ☐ |
| 15 | **Server checkout flag** on in production | User decides; one-line PR | After row 14 | ☐ |
| 16 | **`availableToBuy`** on for the plans to sell | User decides; one-line PR | After row 15 | ☐ |
| 17 | **`paidInvitesAvailable`** on. This opens friend payment and admin Paid invites (F5c-3). **Turned on only after P-9 has merged** (SA S5-7, P5-C12): before P-9, an admin could send a Paid invite that cannot be redeemed yet. Local demos flip it locally and never commit the flip | User decides; one-line PR | After row 15, and only after P-9 has merged | ☐ |
| 18 | **First real purchase** checked end to end: the plan row, the billing record with `livemode = true`, the money history, the audit entry, the receipt email, and Adaptive Pricing off (row 12) | User; TL checks the records | After row 16 | ☐ |
| 19 | **Admin shows live data only.** The billing panel, subscriptions list and MRR show the live purchase and none of the test rows (PF-15) | User; TL checks | After row 18 | ☐ |

---

## 10. Business questions for the user

Each has a recommended default. **All were decided on 2026-10-02 as the defaults; see §10.1.** Candidates already decided were dropped: whether a friend can pick Autopilot at signup (no: BQ-14 and FR-30; they can upgrade after paying, F7), and what a held friend sees after a declined card (they stay held with no time limit and can retry: BQ-8).

| # | Question | Recommended default | Why |
|---|---|---|---|
| **BQ-P1** | **What discount does a Founding Partner get when they start paying?** | **50% off whichever plan they choose, for 24 months, once per account**: the example already on record in D-6. Autopilot would then be $64.50 a month | It is the figure already on record; it rewards design partners without creating a third plan |
| **BQ-P2** | **If a trial or Founding Partner account buys before its free period ends, when is the first charge?** | **Trial:** charged at once; the plan starts and the trial ends. **Founding Partner:** charged from the day free access ends, so they lose none of what was promised | A trial is short and small, and "pay now, start now" is simplest. A Founding Partner was promised free access until a date |
| **BQ-P3** | **May an admin let an invited friend in without paying?** (invite §0.8 #11) | **Yes**, as an explicit admin action with a required reason, audited. It is recorded as a **waiver, not a payment**: the friend does not count as a paid signup, and future perks do not fire. The admin also gives them a plan with an end date on the Tiers page | Covers real support cases (paying another way, a goodwill exception) and keeps "who paid" honest |
| **BQ-P4** | **What must exist before the first real customer is charged?** | **Router, prices, checkout, friend payment, renewal and failed payment, card/invoices/cancel, admin monitoring v1, and the Pilot-Credit retirement** (P-1 to P-6, P-7a, P-8a, P-8b, P-10). In-app upgrade/downgrade (P-7b), admin Paid invites (P-9) and Founding Partner conversion (P-11) may follow. **Accept** that until enforcement is switched on (S-5), a customer whose renewal fails keeps full access; admins see it and follow up | Every customer can pay, cancel and fix a card; we can see every failure. Waiting for S-5 would hold revenue on unrelated work, and the first payers are a small, known group |
| **BQ-P5** | **Are plan prices shown as "excluding tax", like boosts?** | **Yes.** "$79 a month, excluding tax", with tax recorded separately so it can be switched on later; the accountant's check (boost DEP-7) covers plans too, before real money | One rule for everything we sell; changing later is a setting, not a rebuild |
| ~~**BQ-P6**~~ | ~~Does the first admin release need revenue (MRR), or are counts per plan enough?~~ | **Struck by SA (SA-5): ruled technical; MRR is included** (sum of net USD amounts of active subscriptions, current mode only) | The cost is negligible |
| **BQ-P7** | **How long does Stripe keep retrying a failed renewal before cancelling the subscription?** | **Stripe's recommended automatic retries, about two weeks, then cancel.** The account stays paused with its data, and the owner can buy again | Longer than our 5-day grace, so a late card fix still recovers without a new checkout; standard practice |
| **BQ-P8** | **The old free-tier expiry job (TK-3): keep it permanently off?** | **Yes.** It stays unscheduled for good, recorded where anyone reading the cron list will see it (RD-9) | It belongs to the parked agent platform, and switching it on would freeze paying Business OS customers (F-17) |

**Decided without asking** (recorded so they can be overridden):

| Item | Default |
|---|---|
| Receipts and invoices | Stripe's own, branded AgentPilot in the Stripe dashboard; listed in the app |
| Failed-payment emails | Stripe's own emails plus the in-app banner; no custom email in v1 |
| Telling held friends that payment is live | Not automatic (invite BQ-8, §14); admins and champions follow up by hand |
| Card updates | Through the Stripe portal; plan changes stay in the app |
| Sales-assisted payment | Through the normal checkout; an admin assignment with no payment is a comp |
| Payment after an admin assignment | The payment is the newer fact and sets the plan |
| Grace after a voluntary cancel | Applies, as for a failed payment (5 days before pause) |
| Admin refunds and cancellations | In the Stripe dashboard, linked from the billing panel; recorded and flagged in the app |
| Admin alerts in v1 | Page flags and `error` logs; email later |
| Deleting or resetting a subscribed account | First requires cancelling the subscription; no refund for the rest of the period (Q-B7, PF-14). Added by SA |
| Admin tier change on a subscribed account | Lasts until the next renewal; lasting changes go through Stripe or an override (SA-P16b). Added by SA |

**User actions owed (not questions):**
- The `billing_events` shape query (SA-P5), before the P-10 workplan.
- Before P-3a parses a plan invoice: the test endpoint's API version, and a look (never a copy) at the prefix of the Vercel production `STRIPE_SECRET_KEY` (SA-P13, §9.1).
- Everything owed for real money (TK-1, G-1, the accountant's answer, the Stripe dashboard settings, the live keys) → §9.5 go-live checklist.

### 10.1 Decisions (2026-10-02)

The user's answer on 2026-10-02: "go with the defaults for all questions". Each question is decided as its recommended default.

| # | Decision |
|---|---|
| **BQ-P1** | Founding Partner discount: 50% off the chosen plan for 24 months, once per account |
| **BQ-P2** | Trial: charged at once, the plan starts and the trial ends. Founding Partner: first charge on the day free access ends (implemented per SA-P16c) |
| **BQ-P3** | Yes: an admin may let an invited friend in without paying, as an audited waiver with a required reason; it is not a payment and fires no perks; the admin also assigns a plan with an end date. **Placed 2026-10-11 as slice P-13**, after P-9 (§9.1.1 D5-2); whether it ships before the first real charge is BQ-P9 (§10.3) |
| **BQ-P4** | As narrowed by SA: on top of the technical floor, P-8a (admin panel and list) and P-10 (Pilot-Credit retirement) come before the first real charge, with both entry points (P-4, P-5); P-7b (upgrade/downgrade) and P-11 (Founding Partner conversion) follow after. **Re-prioritised by the user on 2026-10-03:** P-9 (admin Paid invites) moves out of the "follow after" list into the build order. It runs right after P-5, because it reuses P-5's pay-at-signup, and before P-6a; so it is now done before the first real charge. Accepted: until S-5, a customer whose payment fails, who cancels, or whose subscription ends keeps full access (SA-5 awareness item) |
| **BQ-P5** | Prices shown "excluding tax", with tax recorded separately; the accountant's check comes before real money. Decided before live prices exist, as SA required |
| ~~BQ-P6~~ | Struck by SA: MRR included. Not a user decision |
| **BQ-P7** | Stripe's recommended automatic retries, about two weeks, then cancel; the account stays paused with its data and can buy again |
| **BQ-P8** | The old free-tier expiry job (TK-3) stays permanently off, recorded where anyone reading the cron list will see it |

### 10.2 SA-P13 result: Stripe mode on production (2026-10-02)

The user ran SA-P13's read-only query in the Supabase SQL editor on 2026-10-02. It returned one row:

| livemode | events | first_seen (UTC) | last_seen (UTC) |
|---|---|---|---|
| false | 897 | 2026-08-25 20:47:24 | 2026-10-02 18:26:46 |

**What it shows:** every webhook event the production database has processed since 2026-08-25 is test mode. No live-mode event has ever been recorded. C-4's first query is answered, so the P-2 workplan is unblocked.

**What it does not show:**
- **The key's mode.** The user did not report whether the Vercel production `STRIPE_SECRET_KEY` starts `sk_live_` or `sk_test_`. SA-P13 asked for that look too, and it is still owed. **Update 2026-10-03:** this was deferred from the P-1 merge gate to the P-3a gate (§9.1) and to the go-live checklist (§9.5 row 14). The repo's local key belongs to a separate, empty sandbox, so this needs a look at the Vercel dashboard.
- **TK-1 is not closed.** A live-mode subscription would only appear here if a live-mode endpoint delivers to this webhook. TK-1 still needs the Stripe dashboard check. This evidence makes live renewals unlikely, nothing more. **Update 2026-10-03:** the user moved TK-1 from the P-1 merge gate to the go-live checklist ("we are still in testing mode, so not worries for now"; SR-14, §9.5 row 4). P-1 merged that day (#188).
- **The `billing_events` shape query** (SA-P5) is separate and is still owed before the P-10 workplan.

**Update 2026-10-06: the sandbox decision (P-2b).** The user decided: "yes, use the sandbox and start P-2b." Development and testing of plan payments use the separate "AgentsPilot sandbox" Stripe account (`acct_1SMy0N56GTXD0wwi`): P-2b created the two plan products and prices there, with the lookup keys `bos_plan_basic_monthly_usd` ($79) and `bos_plan_pro_monthly_usd` ($129), and test-clock fixtures are captured there. **Production's own Stripe account gets the same lookup keys when it is set up** (by the user and Offir; §9.5 row 7 for live mode). The code names lookup keys only, never a price, product or account id, so it does not change between accounts. Because production's account may not hold the prices yet, P-2b ships the catalog behind a server switch, `BUSINESS_OS_PLAN_PRICES_ENABLED` (default off): while it is off production behaves exactly as P-1 (no Stripe lookup, every plan invoice denied). It is turned on per environment only after `npm run check-bos-plan-prices` passes against that environment's account.

**Observed 2026-10-06 (P-2b fixture capture), to confirm with the user and Offir:** the sandbox is **not** without webhook endpoints any more. It has one, created 2026-10-05, pointing at `https://neuronforge-kohl.vercel.app/api/stripe/webhook` (production), on API version `2025-09-30.clover`, subscribed to 13 event types. The capture's 26 test-mode events were delivered to it and none is pending, which means production accepted their signatures: production's `STRIPE_WEBHOOK_SECRET` appears to belong to this sandbox endpoint. Production denied or ignored them (no plan is recognised in production, and the capture objects carry no `user_id` metadata). Consequences: (1) production's Stripe environment may now be the sandbox, which the key-prefix look (§9.1 P-3a) must settle; (2) that endpoint's API version is not the SDK's `2025-10-29.clover` (Q-5, PF-9), and the sandbox account's default version renders events in `2025-09-30.clover`, so the C-8 fixture capture stopped without writing anything (P-2 workplan, P-2b evidence).

### 10.3 Question raised 2026-10-11 (decided the same day)

Raised by the P-5 scoping (§9.1.1 D5-2). **DECIDED by the user 2026-10-11: "Yes, before go-live (Recommended)".** P-13 is built right after P-9 and is part of §9.5 row 1.

| # | Question | Recommended default | Why |
|---|---|---|---|
| **BQ-P9** | **Should the admin's "let in without payment" action (P-13) be ready before the first real customer is charged?** | **Yes.** Build it right after P-9 (about 2 days) and add it to the go-live list (§9.5 row 1) | On launch day, support then has a clean, recorded way to let someone in who paid another way or deserves a goodwill exception. Friends held since 5b also get a way in other than paying. If it waits, the only way to let a held friend in is a manual database change, and that would wrongly count them as paid |

---

## 11. For SA

Technical items. None is put to the user.

| # | Item | BA note |
|---|---|---|
| **SA-P1** | **Where the Business OS Stripe customer and subscription ids live** (O-5, G-4), and how RD-3 / Q-T8 fit RD-2 | BA leans to a new server-write-only Business OS billing table (20261025), keyed to the account, never purged, minimised on deletion like the credit ledger |
| **SA-P2** | **Assigning a plan from the webhook without resetting `period_anchor`** (O-6, PF-2) | Business rule: anchor set once, at first payment, to the billing date; renewals, upgrades, downgrades and card fixes never move it. Also: what happens to the anchor for a paused account that buys again |
| **SA-P3** | **Webhook system actor, audit and cache invalidation outside the admin route** (O-7, PF-3, Q-T2) | The admin path's `adminId` requirement and `updated_by_admin_id` need a system value |
| **SA-P4** | **Stuck `processing` claims and reconciliation** (O-8, PF-5, Q-T9 alert) | Coordinate with boost F-1: one nightly job or two on the same pattern |
| **SA-P5** | **Money history shape** (Q-T3, G-8) | `billing_events` has no CREATE migration and stores an invoice id as the event id. Verify the live schema (`business-os-schema-check`) before deciding between the product dimension and a Business OS-owned table |
| **SA-P6** | **Dispatcher ownership with Boost** (R-3) and the plan branch's place in it | §9.4 |
| **SA-P7** | **Router before checkout** (SR-1, G-6): whether the router and the checkout may merge in the same PR, and the remaining WS-3 boundary in a file carrying Connect money (RD-12, Q-T5) | P-1 / P-10 split proposed |
| **SA-P8** | **Events to handle and lifecycle writes** (O-10): paid, payment failed, action required (SCA), subscription updated and deleted, checkout expired; whether anything should produce `past_due` or grace stays purely derived | The flows assume derived grace |
| **SA-P9** | **Redemption path for admin-issued tier invites** (today refused at redemption; the 20261014 finalise handles cohorts only) | F3; 20261028 (renumbered 2026-10-05 per C-2: now 20261029) |
| **SA-P10** | **Customer portal configuration**: which features are on (card, invoices; plan changes and cancel off, to keep RD-7 in the app) | F9 |
| **SA-P11** | **Held accounts at checkout**: the plan checkout admits them (G-12) while API routes stay ungated (F5b-5) | — |
| **SA-P12** | **Display price vs Stripe price**: a check that `presentation.monthlyPriceUsd` equals the Stripe price behind each lookup key, in both modes | F-22 |
| **SA-P13** | **Stripe mode on production** (G-2: one read-only query on `processed_webhook_events.metadata.livemode`) and env hygiene (G-14) | Before P-2. **Query answered 2026-10-02: all 897 events test mode** (§10.2). The key-prefix look is still owed, now at the P-3a gate (§9.1), and for live mode → §9.5 row 14 |
| **SA-P14** | **Single open subscription per account** (SR-5) and checkout idempotency | — |
| **SA-P15** | **Local-currency presentment off** for plan checkouts (boost F-7 analogue) | SR-15 |
| **SA-P16** | **Lifecycle precedence** when a champion with a live cohort also holds a tier (F10), and when an admin assignment and a Stripe subscription disagree (F4) | BQ-P2 removes most of the overlap for champions |
| **SA-P17** | **S-5 verification** of the paid-lapse path with one real test purchase (Q-T10) | Recorded for S-5 |
| **SA-P18** | **Shadow report and launch dry run** treatment of held accounts (T-9, entitlements doc "Held paid invitees") | In P-5 |

---

## 12. Acceptance criteria

All in Stripe test mode unless stated.

**F1 Self-serve buy**
- [ ] **AC-F1.1** An owner buys `basic` from Settings → Plan; the plan row shows `basic`, the paid-through date equals Stripe's period end, and the credit period starts on the billing date.
- [ ] **AC-F1.2** An abandoned or declined checkout changes no plan row and writes no money history.
- [ ] **AC-F1.3** With `availableToBuy` off, the Choose button is absent and a direct call to the checkout route is refused.

**F2 Friend pays**
- [ ] **AC-F2.1** (P-5a) A held friend pays and lands in onboarding. `first_paid_at` and `first_payment_ref` are set once, to Stripe's paid time and the invoice id. A replayed webhook, or the reconciler applying the invoice again, leaves both unchanged.
- [ ] **AC-F2.2** (P-5b) The champion sees "Subscribed". The admin invites list shows paid, date and amount in USD, read from `business_os_billing_events` and never copied onto the lineage.
- [ ] **AC-F2.3** A second checkout attempt while a subscription is live or pending is refused (SR-5). Built in P-3a and shown again in the P-5a demo.
- [ ] **AC-F2.4** A paid boost on a held account (if one were possible) does not stamp `first_paid_at` or touch the plan row (SR-6).
- [ ] **AC-F2.5** (P-5a) While `paidInvitesAvailable` or either payment switch is off, the holding screen still says "payment coming soon" with no Pay button, and the checkout refuses a direct call from a held account.
- [ ] **AC-F2.6** (P-5a) A friend held since 5b sees "Finish your payment" at their next sign-in, and nobody is emailed. A declined card records nothing and leaves the friend held, free to try again.
- [ ] **AC-F2.7** (P-5a) The holding screen and its processing state read correctly in en, he and es, with Hebrew right to left. The price comes from `presentation` and is shown "excluding tax". While the payment is processing, the screen never lets the friend in before the hold is lifted, and a failed read never releases them.
- [ ] **AC-F2.8** (P-5b) The champion gets exactly one "{email} has subscribed" email, in the champion's own language, when the stamp is first written. A replay, a reconciliation, a boost or a waiver sends none. A failed send never fails the webhook, and it is audited as "not notified".
- [ ] **AC-F2.9** (P-5a) One "first payment stamped" audit entry is written, carrying the invoice id and no email address.
- [ ] **AC-F2.10** (P-5b) The shadow report shows held accounts as "awaiting payment", not as anomalies, and the launch dry run lists them separately (SA-P18).
- [ ] **AC-F2.11** (P-13) An admin waiver needs a reason and a plan with an end date. It lifts the hold and is audited. It writes no `first_paid_at` and sends no N-2 email. The champion sees the friend as "Joined" and admins see "waived".

**F3 Admin Paid invite**
- [ ] **AC-F3.1** An admin `pro` invitee is held after signup, pays, and is assigned `pro` at L1 with `first_paid_at` set.

**F4 Admin-assigned**
- [ ] **AC-F4.1** An admin tier assignment with no subscription shows "No Stripe subscription" on the billing panel.
- [ ] **AC-F4.2** Changing the tier of an account with a live subscription shows the warning, and the reconciliation flag appears until they agree.

**F5 Renewal**
- [ ] **AC-F5.1** A test-clock renewal moves the paid-through date to the new period end and does not move the credit-period anchor.
- [ ] **AC-F5.2** The credit period that follows starts on the billing anniversary.

**F6 Failed payment**
- [ ] **AC-F6.1** A failed renewal shows the banner; the lifecycle reads grace once the 24-hour margin has passed; after a further 5 days it reads paused; config holds a 5-day grace entry and a 24-hour margin entry (PF-1, PF-10).
- [ ] **AC-F6.2** A successful retry or card update returns the account to active.
- [ ] **AC-F6.3** When Stripe stops retrying, the subscription is recorded as ended and the account stays paused.
- [ ] **AC-F6.4** A refund and a dispute on a plan payment are each recorded and flagged, never "unknown payment".

**F7 Upgrade / downgrade**
- [ ] **AC-F7.1** An upgrade charges the prorated amount, sets `pro` at once, and does not restart the credit period.
- [ ] **AC-F7.2** A downgrade is scheduled, can be undone, and is applied only when the renewal invoice is paid.
- [ ] **AC-F7.3** No new Stripe price is created by either change.

**F8 Cancel / reactivate**
- [ ] **AC-F8.1** Cancelling shows "Ends on <date>"; nothing is refunded; reactivating before that date restores normal renewal with no charge.
- [ ] **AC-F8.2** After the end date the lifecycle reads grace, then paused.

**F9 Card and invoices**
- [ ] **AC-F9.1** The portal opens for the account's own customer only, and offers card and invoices.
- [ ] **AC-F9.2** The invoice list shows every invoice with a working Stripe link, and reads nothing from `user_subscriptions`.

**F10 Founding Partner**
- [ ] **AC-F10.1** A champion with an end date who buys is charged per BQ-P2, with the BQ-P1 discount, and has no gap in access on the end date.

**Admin monitoring**
- [ ] **AC-AM.1** The billing panel shows Stripe status and the plan row side by side, with a dashboard link.
- [ ] **AC-AM.2** The subscriptions tab filters by each status and its totals match the records; MRR is included, current mode only (BQ-P6 struck by SA).
- [ ] **AC-AM.3** A forced stuck claim is recovered exactly once by the reconciliation job or the button.
- [ ] **AC-AM.4** Every money event in §7 AM-7 writes an audit entry; an audit failure never fails the money write.

**Safety**
- [ ] **AC-SR.1** A platform invoice with an unknown price is refused and logged; no Pilot-Credit row is written (SR-1, SR-2).
- [ ] **AC-SR.2** A price-id and metadata mismatch is refused and alerted.
- [ ] **AC-SR.3** Connect tests pass unchanged before and after each webhook slice.
- [ ] **AC-SR.4** No Business OS billing code reads or writes `user_subscriptions` or `credit_transactions`.
- [ ] **AC-SR.5** Every new route has tests for the happy path, auth failure and invalid input.

---

## 13. Notes on integration points

| System | Effect |
|---|---|
| `app/api/stripe/webhook/route.ts` | Pino (P-0), router and dispatcher (P-1), plan branch (P-3a, P-3b, P-6a, P-6b; logic in `lib/business-os/billing/`, not inline), stale-claim reclaim (P-8b), WS-3 deletions (P-10). Carries live Connect money (SR-10) |
| `lib/stripe/StripeService.ts` | Lookup-key prices, customer helper split (Q-T8), subscription price swap; Connect methods untouched |
| New Business OS billing routes (checkout, portal, invoices, change, cancel) | `new-api-route` skill |
| `business_os_account_plans`, `lib/business-os/entitlements/adminOps.ts` | Webhook plan assignment (SA-P2, SA-P3) |
| `lib/business-os/entitlements/config/lifecycle.ts`, `tierMatrix.ts`, `invites.ts` | Grace history (PF-1); `availableToBuy`; `paidInvitesAvailable` |
| `business_os_account_lineage`, `lib/business-os/invites/paymentHold.ts`, `/invite/awaiting-payment`, `app/invite/awaitingPaymentCopy.ts` | First-payment stamp, the Pay screen and its processing state in en/he/es, and the release (P-5a); the waiver's release (P-13) |
| `lib/business-os/invites/inviterNotification.ts`, `lib/email/templates/invite-accepted.ts`, `lib/business-os/invites/friendInviteOps.ts` | The N-2 email and the champion's "Subscribed" (P-5b), reusing N-1 |
| Shadow report and launch dry run (entitlements module) | "Awaiting payment" label and separate list, through `readPaymentHold` (P-5b, SA-P18) |
| `components/business-os/settings/PlanSection.tsx` | Buy, change, cancel, card, invoices (WS-2) |
| `/admin/business-os-tiers`, `/admin/business-os-invites`, `/admin/jobs-queues` | Admin monitoring (§7) |
| `business_os_credit_*` and lots | Read only, for the credit period; never written by plan payments |
| Credits Boost | §9.4 |
| Stripe dashboard (not code) | Prices in both modes, events, retries, emails, branding, portal (§9.5) |

---

## SA Review — 2026-10-02

**Reviewed by SA — 2026-10-02**, against `origin/main` `03b62c3c` (worktree `neuronforge-invite-s1`), the SA as-built of the same day, the reuse plan (RD-1..16, Q-T1..11), the Credits Boost requirement §18 (R-1..R-5, §18.9), and the code at the cited lines.
**Status: APPROVED WITH CONDITIONS.** The scope, flows and safety list are sound. Conditions C-1 to C-12 (end of this section) must be reflected in the slice workplans. Two Q-T rulings are refined (Q-T2, Q-T3) and one RD is refined (RD-3), each with its reason. Nothing here is a question for the user except the BQs in §SA-4.

### SA-1. Fact check

| Claim | Verdict | Evidence |
|---|---|---|
| `assign_tier` sets `period_anchor = now` on every call (PF-2) | ✅ | `adminOps.ts` `assignTier`: `period_anchor: ctx.now.toISOString()` |
| `executeAdminOp` neither audits nor invalidates; `adminId` required and written to `updated_by_admin_id` (PF-3) | ✅ | `AdminOpContext.adminId: string`; `updatePlan(..., ctx.adminId)`; audit, `invalidate()` and `flush()` live in `app/api/admin/business-os/entitlements/accounts/[accountId]/route.ts` |
| Platform `invoice.paid` → Pilot Credits with metadata / subscription fallback (PF-4) | ✅ | `route.ts:45-80` (subscription `metadata.user_id`, then `subscriptions.list({customer, limit:1})`) |
| Stuck `processing` never reclaimed (PF-5) | ✅ | `route.ts` claim: `status === 'processing'` → `duplicate: true`, 200, no age check |
| Grace 7 days (PF-1) | ✅ | `config/lifecycle.ts`: `subscriptionGraceHistory = [{ effectiveFrom: SHIPPED, days: 7 }]` |
| Admin tier invites refused at redemption (SA-P9) | ✅ | `inviteRedemption.ts`: `if (row.grant_kind === 'tier') return refuse(409, 'paid_invites_not_available')` |
| Credit period is a monthly anniversary from `period_anchor`, derived | ✅ | `20261015` `business_os_credit_period_start`: anchor + N months, end-of-month clamped. This is the **same arithmetic Stripe uses** for a monthly billing anchor, so anchor = Stripe `billing_cycle_anchor` keeps the two clocks aligned indefinitely |
| Tier in force beats a live cohort | ✅ | `lifecycle.ts`: tier in force → `active`, basis `tier`; a champion who starts a tier mid-cohort loses champion (`pro`-level) access the moment the tier is assigned. This drives the F10 ruling in SA-P16 |
| API version `2025-10-29.clover` (Basil+ shapes) | ✅ | `stripe ^19.2.1`; comment at `route.ts:1136`. **Not reflected in the requirement** (PF-9 below) |

### SA-2. Rulings on SA-P1 to SA-P18

| # | Ruling |
|---|---|
| **SA-P1** Storage of BOS Stripe ids (O-5, G-4) | **New table `business_os_billing_accounts`, migration 20261025, one row per account (`user_id` PK, FK `auth.users`).** Columns, all created in 20261025 so no later slice needs an ALTER: `stripe_customer_id` (UNIQUE), `stripe_subscription_id` (UNIQUE, nullable), `livemode` (NOT NULL), `subscription_status` (Stripe's status, mirrored for display only), `bought_tier` (from the price's lookup key), `current_period_end`, `cancel_at_period_end`, `pending_tier` (a downgrade waiting for renewal), `open_checkout_session_id` + `open_checkout_expires_at` (SR-5 lock), `last_invoice_id`, `last_paid_at`, `last_payment_failed_at`, `failed_attempts`, `action_required_invoice_url`, `founder_discount_applied_at`, `ended_at`, `created_at`, `updated_at`. **Server-write-only**: RLS on, no `authenticated` grant at all (owners read through routes), `service_role` SELECT/INSERT/UPDATE, no DELETE. Repository `BusinessOsBillingAccountRepository` per `new-repository`. Registered in the purge/deletion registries as a **retained financial record** (minimised on erasure like the credit ledger). **RD-3 refined:** "one Stripe customer per person" holds **within Business OS** (PK on `user_id`, Stripe idempotency key `bos-customer:<user_id>`). BOS cannot read `user_subscriptions.stripe_customer_id` (RD-2, F-28), so a person who was also an agent-platform payer gets a second Stripe customer. Accepted: the agent platform is parked and the alternative breaks RD-2. Q-T8's split stands: the shared helper becomes a pure Stripe create/lookup with no `user_subscriptions` side effect; each product persists its own id. **Amended 2026-10-04 by the P-2 workplan SA review (rulings Q-1, Q-2):** a surrogate `id` primary key replaces the `user_id` PK; `user_id` is nullable with `ON DELETE SET NULL` (so the row can be minimised like the credit ledger); UNIQUE (`user_id`, `livemode`) with default NULLS DISTINCT, so "one Stripe customer per person within Business OS" now reads **per person per Stripe mode**; and `service_role` UPDATE is **column-level on 17 columns** (`stripe_customer_id` included, replaceable only by a compare-and-set in P-3a), never on `id`, `user_id`, `livemode` or `created_at` |
| **SA-P2** Anchor policy (O-6, PF-2) | **`period_anchor` is set from Stripe, and only when the subscription identity changes.** On the first paid invoice of a subscription id the account has not had before (first buy, or a paused/ended account buying again), set `period_anchor = subscription.billing_cycle_anchor` (exact timestamp). Renewals, upgrades, downgrades, card fixes and replays **never** write it. Checkout and upgrade calls **never** pass `billing_cycle_anchor` or `proration_behavior` that resets the cycle. **Admin `assign_tier` on an account whose billing record has a live subscription keeps the anchor** (it still resets it otherwise, unchanged behaviour). A trial's one-off allowance is not carried over: the new anchor starts a fresh period with the full plan allowance |
| **SA-P3** System actor, audit, cache (O-7, PF-3) | **Q-T2 refined.** The webhook does not call `executeAdminOp` (its Zod union is the admin HTTP contract; a system op must not be reachable from it). Instead: (a) extract the pre-write checks it shares (tenant check, tiers configured, `wouldLeaveNoBasis`, plan row exists) into functions both paths call; (b) the **write** is one SQL function `business_os_apply_plan_payment(...)` (20261026, renumbered 2026-10-05 per C-2: now 20261027; `SECURITY INVOKER`, `service_role` only) that, in one transaction, locks the billing row `FOR UPDATE`, inserts the money-history row (unique on Stripe event id → replay returns `already_applied`), and updates the plan row with `tier`, `plan_version`, `tier_expires_at = GREATEST(existing, period_end)` (out-of-order safe) and the SA-P2 anchor; `updated_by_admin_id = NULL` (system). (c) A shared TS helper `recordPlanChange()` does audit (`actorId` null, `details.actor = 'stripe_webhook'`, registered `AUDIT_EVENTS` keys `BOS_BILLING_*`), `getEntitlementService().invalidate(accountId)` and **`auditTrail.flush()` before the 200** (WC-7: `log()` only queues). The admin route is refactored to use the same helper. Other instances see the change within the 30 s TTL; the payment hold is read uncached, so a friend's release is immediate. **Amended 2026-10-07 by the P-3b workplan SA review:** **Q-7** `tier_expires_at` is Stripe's period end written verbatim when the invoice is the newest by the **billing row's** Stripe facts (period end, then `paid_at`); this **supersedes `GREATEST(existing, period_end)`**, so on a subscribed account an admin-extended paid-through date is cut back to Stripe's date at the next payment (F4: the payment is the newer fact). **Q-11** idempotency is the event-id UNIQUE plus a partial UNIQUE on the paid invoice id, so a reconciler with no event id cannot record twice; a known event id also returns early (C-2). **Q-4** the system actor is `platformActorId()` with `details.actor = 'stripe_webhook'`, never a null actor (the audit service would record the owner). **Q-5** the flush is bounded at 2 s (`logAndFlush`), the one behaviour change for the admin route. **C-1** a subscription held by another billing row is detected before any write. **C-3** `bought_tier` is written only together with the plan row |
| **SA-P4** Stuck claims, reconciliation (O-8, PF-5) | Two parts, both in P-8b. (1) **In the webhook claim:** a `processing` row older than 15 minutes (above the function's max duration) is reclaimed by an **atomic conditional UPDATE** (`WHERE event_id = $1 AND status = 'processing' AND processed_at < now() - interval '15 minutes'` returning the row); zero rows → duplicate. This also protects Connect money; SR-10 evidence applies. (2) **Nightly `bos-billing-reconcile` cron** on the `durable-queue-drain` pattern (CRON_SECRET fail-closed, `bos_cron_runs`, bounded batch, per-item lease, admin button): lists BOS-price subscriptions and paid invoices since the last good run from Stripe and re-applies them through `business_os_apply_plan_payment` (idempotent), then flags plan-row vs Stripe disagreements. **One cron route, pluggable passes:** whichever of P-8b and boost 4b lands first creates the route; the other adds its pass (mirrors R-3). Passes never share rows |
| **SA-P5** Money history (Q-T3, G-8) | **Q-T3 reversed: Business OS gets its own append-only `business_os_billing_events` (20261026, renumbered 2026-10-05 per C-2: now 20261027); `billing_events` is not used** (aligned with boost T-16). Reasons: no CREATE migration, so its constraints and RLS are unknown; its `stripe_event_id` holds invoice ids (`route.ts:274`), so it cannot be an idempotency key; it is written by the Pilot-Credit path with `credits_delta`; a separate table keeps RD-2 enforceable by grep and RLS. Shape: `id`, `user_id`, `kind` (CHECK, full v1 set from day one: `invoice_paid`, `invoice_payment_failed`, `payment_action_required`, `subscription_updated`, `subscription_ended`, `refunded`, `dispute_opened`, `dispute_closed`, `mismatch_refused`), `stripe_event_id` UNIQUE, `stripe_invoice_id`, `stripe_subscription_id`, `tier`, `amount_minor`, `amount_tax_minor`, `currency` CHECK `= 'usd'`, `period_start`, `period_end`, `livemode`, `created_at`. INSERT-only for `service_role`; no UPDATE/DELETE grant; no `authenticated` grant. **Amended 2026-10-07 (P-3b SA review Q-10):** four more columns, `stripe_customer_id` (the only key of an unknown-customer refusal), `plan_written` (drives the SA-P2 anchor rule), `refusal_reason` (set exactly when `kind = 'mismatch_refused'`) and `paid_at` (the ordering key). **Live shape of `billing_events`:** not needed to decide this, but owed **before the P-10 workplan** (WS-3 deletes its writers). The user runs, read-only, in the Supabase SQL editor: <br>`select column_name, data_type, is_nullable, column_default from information_schema.columns where table_schema='public' and table_name='billing_events' order by ordinal_position;`<br>`select conname, pg_get_constraintdef(oid) from pg_constraint where conrelid='public.billing_events'::regclass;`<br>`select policyname, cmd, roles from pg_policies where schemaname='public' and tablename='billing_events';`<br>`select event_type, count(*) from public.billing_events group by 1 order by 2 desc;` |
| **SA-P6** Dispatcher with Boost (R-3) | Confirmed: **whichever lands first owns it**; the other adds a branch. Module in `lib/business-os/billing/` (not in `route.ts`); one call before the existing `switch`, **platform events only** (`event.account == null`). Contract: `resolve(event) → { flow: 'plan' \| 'boost', ... } \| { deny: reason } \| 'not_business_os'`. Identities are disjoint by construction: boost resolves by our purchase row (`client_reference_id` / `payment_intent`, `mode = 'payment'`); plan resolves by BOS lookup-key price on the invoice line, then the account by **our billing record** (`stripe_subscription_id`, else `stripe_customer_id`). **If both branches claim an event, refuse and log `error`.** Never offer an event to the AgentsPilot handlers once a BOS branch has resolved or denied it |
| **SA-P7** Router before checkout (SR-1) | **Separate PRs; P-1 merged and deployed before P-3a merges.** P-1 also **refuses the subscription branch of `app/api/stripe/create-checkout`** (410, logged): once deny-by-default lands, an agent-platform subscription invoice would be denied, so taking that money must stop in the same PR (PF-12). The one-off boost-pack branch stays for TK-5 / boost slice 7. With the conversion gone and the entry closed, RD-12's safety reason is met by P-1; P-10 is the remaining clean-up and is not on the safety floor (see BQ-P4) |
| **SA-P8** Events and lifecycle writes (O-10) | **Grace stays derived; nothing writes `past_due` to the plan row** (there is no column; `subscription_status` on the billing record is display only). Handled platform events: `checkout.session.completed` (link subscription id, clear checkout lock; **no plan write**), `checkout.session.expired` (clear lock), `invoice.paid` (**the only event that assigns a plan or moves paid-through**; requires `amount_paid > 0` or `billing_reason = 'subscription_cycle'` with a discount, see SA-P16), `invoice.payment_failed` (attempt count, banner), `invoice.payment_action_required` (store `hosted_invoice_url`; banner "confirm your payment"; treated as failed), `customer.subscription.updated` (mirror status, `cancel_at_period_end`, `pending_tier`; **no plan write**), `customer.subscription.deleted` (`ended_at`; no plan write, lifecycle derives), `charge.refunded`, `charge.dispute.created`, `charge.dispute.closed` (flag only). Not subscribed: `invoice.created` (avoids Stripe's 72 h finalisation hold on a failing endpoint), `invoice.upcoming`, `customer.subscription.created`. **Card only** (`payment_method_types: ['card']`), so no async-payment events. Checkout handles first-payment 3-D Secure inline; an abandoned 3DS leaves an `incomplete` subscription that Stripe expires after 23 h, which the SR-5 lock covers |
| **SA-P9** Admin tier invite redemption | 20261028 (renumbered 2026-10-05 per C-2: now 20261029): a finalise variant for `admin_invite` with a tier grant that inserts the plan row with **no tier and no cohort** (`origin = 'invite'`, as the friend path does) and lineage at L1 with the grant. **The tier is assigned only by the payment.** The checkout reads the invited tier from the lineage/invite row server-side; the client never chooses it |
| **SA-P10** Portal | A dedicated portal configuration created by an idempotent script per mode: `payment_method_update` on, `invoice_history` on, `subscription_cancel` off, `subscription_update` off, `customer_update` off. Its id is an env var per mode (`STRIPE_BOS_PORTAL_CONFIGURATION_ID`, in `.env.example`) passed on every portal session. The portal route resolves the customer from the billing record by authenticated `user_id` only |
| **SA-P11** Held accounts at checkout | The plan checkout **admits** a held account and **restricts it to the invited tier** (friend → `basic` per BQ-14/FR-30; admin invite → the granted tier). It reuses `readPaymentHold` (never copies the predicate) and **fails closed** on a read error, because it decides what may be bought. Other API routes stay ungated (F5b-5 residual unchanged); boost keeps refusing held accounts (R-1) |
| **SA-P12** Display vs Stripe price | (a) A read-only script `check-bos-plan-prices` resolves each lookup key in the current mode and asserts `unit_amount = presentation.monthlyPriceUsd × 100`, `currency = usd`, `recurring.interval = month`, `active`, and `tax_behavior` per BQ-P5; run in the P-2 demo and at go-live. (b) **At runtime the checkout route compares the resolved price to `presentation` and refuses (logged `error`) on mismatch** — fail closed. Resolved price ids are cached per instance with a short TTL |
| **SA-P13** Stripe mode on production | Owed by the user **before the P-2 workplan**, read-only: `select metadata->>'livemode' as livemode, count(*) as events, min(processed_at) as first_seen, max(processed_at) as last_seen from public.processed_webhook_events group by 1;` plus a look (not a copy) at whether the Vercel production `STRIPE_SECRET_KEY` starts `sk_live_` or `sk_test_`. **Never paste a key into a chat or doc.** Test-mode demos need a deployment with test keys and its own test-mode endpoint and secret (C-9) |
| **SA-P14** One open subscription | Three layers. (1) **Checkout refuses** when the billing record has `subscription_status` in (`active`, `trialing`, `past_due`, `unpaid`, `incomplete`) or an unexpired `open_checkout_session_id`; sessions are created with a 30-minute `expires_at` and a Stripe idempotency key per attempt. The lock is written with a conditional update so two clicks cannot both pass. (2) **The webhook refuses a second BOS subscription** for an account whose record holds a different live one: `mismatch_refused` row, `error` log, admin flag, no plan write; refund in the dashboard. (3) Reconciliation lists any customer with more than one BOS subscription |
| **SA-P15** Local-currency presentment | `adaptive_pricing: { enabled: false }` on every plan session (verify the parameter on `2025-10-29.clover`, as boost T-15). Backstop: the plan branch refuses any invoice with `currency ≠ 'usd'` (`mismatch_refused`) |
| **SA-P16** Precedence | (a) **The plan row governs access** (Q-T9). (b) **Every paid plan invoice re-asserts the bought tier**: an admin tier change on a subscribed account lasts only until the next renewal. Admins who want a lasting change on a subscribed account use an **override** or change the subscription in Stripe; the F4 warning must say this. (c) **Founding Partner (F10, with the BQ-P2 default):** the subscription is created with `trial_end = cohort_expires_at`; the resulting **$0 invoice assigns nothing and stamps nothing**; the first non-zero paid invoice assigns the tier and sets the anchor. Between cohort end and that invoice (minutes), the champion's 30-day cohort grace covers access, so there is no break. Assigning the tier earlier would downgrade a champion from `pro`-level access to `basic` (SA-1). (d) A trial account that buys gets the tier at once; the trial cohort stays recorded but the tier wins |
| **SA-P17** S-5 verification | Recorded for S-5: one real (live-mode, low-value) purchase taken through renewal, a failed renewal, the margin (PF-10), grace and paused, before enforcement is switched on. Test-clock evidence from P-6a is the pre-requisite, not a substitute |
| **SA-P18** Held accounts in shadow report / dry run | In P-5, via `readPaymentHold` (no copied predicate): the shadow report labels them `awaiting_payment` instead of `no_assignment` anomalies, and the launch dry run lists them separately so S-5 does not count them as broken accounts |

**`first_paid_at` idempotency (SR-7, F5c-2), ruled:** stamped inside `business_os_apply_plan_payment` only (added by 20261027, renumbered 2026-10-05 per C-2: now 20261028; see SA-3), `UPDATE business_os_account_lineage SET first_paid_at = $paid_at, first_payment_ref = $invoice_id WHERE user_id = $u AND first_paid_at IS NULL`, with `$paid_at` = Stripe's `status_transitions.paid_at` (not `now()`), so a replay or the reconciler writes the same value or nothing. Only on a BOS **plan** invoice with `amount_paid > 0`. No lineage row (self-serve) → no-op. Column-level UPDATE grant on those two columns to `service_role` only.

**Tenant isolation (`tenant-isolation-guard`), ruled:** the account is always taken from **our** billing record, keyed by the Stripe subscription or customer id; Stripe metadata (`bos_user_id`) is a cross-check only, and a disagreement is `mismatch_refused`. The checkout and portal routes take the account from the authenticated session only, never a body or header id. Every billing-repository query carries `user_id`; every service-role write documents why.

### SA-3. Findings the requirement missed (add to §4)

| # | Severity | Finding | Fix in |
|---|---|---|---|
| **PF-9** | High | **Basil-era Stripe shapes.** On `2025-10-29.clover` the invoice line's price is `line.pricing.price_details.price` (not `line.price`), the invoice's subscription is `invoice.parent.subscription_details.subscription`, the period end is on subscription **items**, and `charge.invoice` is gone (resolve a refund or dispute via the PaymentIntent's invoice payments). A router written against older shapes would deny every plan invoice, or route nothing | P-1 (router), P-3b, P-6b; each with a fixture test from a real test-mode payload |
| **PF-10** | High (post S-5) | **Monthly grace blip.** Stripe finalises and charges the renewal about an hour **after** the period ends, so `tier_expires_at` passes before `invoice.paid` arrives and every subscriber reads `grace` for up to an hour each month (read-only owner once S-5 is on). Ruling: store Stripe's period end verbatim, and add a **renewal settlement margin of 24 h** to lifecycle config as a history entry, applied by `deriveLifecycle` to a tier's access end before grace starts (all tiers; harmless for admin-assigned ones). The 5-day grace then counts from the end of the margin | P-6a |
| **PF-11** | Medium | **Audit only queues** (`log()`); a serverless function frozen after the 200 loses the row. The webhook must `flush()` before responding, as the admin route does | P-3b (SA-P3) |
| **PF-12** | High | **Paying into a denied path.** After P-1, an agent-platform subscription checkout would still take money that the router then refuses to credit | P-1 (SA-P7) |
| **PF-13** | Medium | **Admin `assign_tier` on a subscribed account resets the anchor**, desynchronising the credit period from billing | P-3b (SA-P2). **Knock-on fixed 2026-10-13:** a re-anchor (first plan payment or `assign_tier`) made the admin "Credits left" column and finance positions count the old period's usage; the admin row selector now matches the exact period key — [re-anchor fix](/docs/requirements/BUSINESS_OS_ADMIN_CREDITS_LEFT_REANCHOR_FIX.md) |
| **PF-14** | High | **Reset / deletion while subscribed.** A Danger-Zone reset or an account deletion that removes the plan row leaves Stripe charging. Purge, reset and deletion paths must **refuse while the billing record has a live subscription** (409 `subscription_live`) until it is cancelled; the billing record itself is retained | P-2 (registry), P-7a (refusal) |
| **PF-15** | Medium | **Test mode on the production database.** There is one Supabase project, so test-mode customers and plan rows land in production tables. Every billing row carries `livemode`; the webhook refuses an event whose `livemode` differs from the key's mode; admin lists and MRR filter on the current mode; demos use designated test accounts only | P-2, P-3b, P-8a |

**Flow corrections (text, BA):** F5/F6/F8 "grace" starts after the 24 h margin (PF-10). F4 step 3: the warning must say the next renewal restores the bought tier (SA-P16b). F7 downgrade: implemented as a **price swap with `proration_behavior: 'none'`** (no subscription schedules in v1); the plan row changes on the renewal `invoice.paid` whose line carries the lower price; undo is the reverse swap. F7 upgrade: `proration_behavior: 'always_invoice'` with `payment_behavior: 'pending_if_incomplete'`, so the upgrade only takes effect if paid (a declined or 3DS-abandoned upgrade leaves `basic`). F9 receipts: Stripe sends subscription receipts only if **"Successful payments" customer emails** are switched on in the dashboard (go-live item). PF-6 refunds/disputes resolve via the Basil invoice-payment lookup (PF-9).

**Standards for every workplan:** CLAUDE.md rules 1 (all new tables behind `lib/repositories/`; the plan branch lives in `lib/business-os/billing/`, not inline in `route.ts`), 2 (Zod on every route), 3 (Pino + correlation id; P-0 converts the webhook), 4 (`user_id` on every query), 6, 7 (the dispatcher and the shared `recordPlanChange` helper are reviewed here and are the pattern). Skills: `new-api-route`, `new-repository`, `tenant-isolation-guard`, `durable-queue-drain` (P-8b), `business-os-entitlements` (registration of every new import, SR-17), `business-os-schema-check` (any `billing_events` or plan-row column claim), admin gate `requireAdmin` / `requireAdminPage` (P-8a, P-8b). `bos-llm-call-standards` does not apply (no AI calls).

### SA-4. Slice plan: re-cut

The order is right. Three changes: P-0 is made explicit, P-3 and P-6 are each split (each was more than one demo), and the grace change moves to where it is demoed.

| Slice | Change | Migration | After merge |
|---|---|---|---|
| **P-0** | **New: webhook logging to Pino = Boost slice 0.** Already approved by the user. Whichever session starts first does it; mechanical, no behaviour change, Connect evidence | — | Live |
| **P-1** | Router, deny by default, conversion and fallback removed, **subscription branch of `create-checkout` refused** (PF-12), Basil shapes (PF-9). Gates: P-0 merged; TK-1 recorded | — | Live (protective) |
| **P-2** | Test-mode prices, `check-bos-plan-prices` script, billing record table (full column set, SA-P1), customer helper split, `.env.example` (incl. portal config id), purge/deletion registry entries. **PF-1 moves to P-6a.** Gate: SA-P13 query answered | **20261025** | Inert |
| **P-3a** | Checkout route behind a server flag: customer create, SR-5 lock, adaptive pricing off, runtime price check, held-account tier restriction. Demo: a test card pays; the router recognises a BOS plan invoice, logs that no handler exists yet, and releases the claim; no plan row changes | — | Flag off |
| **P-3b** | Plan assignment: `business_os_apply_plan_payment`, money history, system actor, `recordPlanChange` (audit + flush + invalidate) with the admin route refactored onto it, SA-P2 anchor, livemode check. Demo as the old P-3 | **20261026** (renumbered 2026-10-05 per C-2: now 20261027) | Flag off |
| **P-4** | Unchanged | — | `availableToBuy` off |
| **P-5** | Unchanged, plus: 20261027 adds the column grant **and replaces `business_os_apply_plan_payment` to add the once-only stamp** (the function in 20261026 must not reference the lineage table, because the grant does not exist yet) | **20261027** (renumbered 2026-10-05 per C-2: now 20261028; in this row 20261027 reads 20261028 and 20261026 reads 20261027) | `paidInvitesAvailable` off |
| **P-6a** | Renewal, failed payment, 3DS banner, `subscription.updated/deleted`, **5-day grace history (PF-1) and the 24 h margin (PF-10)**, test clocks (the test-mode customer is created on a test clock from `/test-business-os`) | — | Inert |
| **P-6b** | Refunds and disputes flagged (PF-6) via the Basil lookup | — | Inert |
| **P-7a / P-7b** | Unchanged; depend on P-6a. P-7a adds the PF-14 refusal | — | Flag |
| **P-8a** | Unchanged; depends on P-3b; filters on `livemode` | — | Live, read-only |
| **P-8b** | Stale-claim reclaim in the webhook (SA-P4 part 1) + `bos-billing-reconcile` + Jobs page. **20261029 is expected to stay unused** (`bos_cron_runs` and the billing record suffice) | (20261029 spare) (renumbered 2026-10-05 per C-2: spare dropped, 20261029 is now P-9) | Live |
| **P-9, P-10, P-11, P-12** | Unchanged. P-10 needs the `billing_events` shape query (SA-P5) | 20261028 (P-9) (renumbered 2026-10-05 per C-2: now 20261029) | — |

Dependencies confirmed: P-0 → P-1 → P-3a; P-2 ∥ P-1; P-3a → P-3b → {P-4, P-5, P-6a, P-8a}; P-6a → {P-6b, P-7a, P-7b, P-8b}; P-5 → P-9; P-1 → P-10; P-4 → P-11. **G-1 gates only P-12**, not the test-mode slices. **No dependency on credit deduction 20261017 or on Boost slices 1–7**: plan payments never write lots. Migrations 20261025–29 are free on main (latest applied 20261024) (renumbered 2026-10-05 per C-2: 20261026 was later taken on main; see §9.3); the reservation must still be recorded with both sessions (G-11). Each slice is two to three days and demoable; inert/live states above are correct.

**Technical go-live floor** (the part of BQ-P4 that is not a business choice): P-0, P-1, P-2, P-3a, P-3b, P-6a, P-6b, P-7a (a customer must be able to cancel in-app, since the portal's cancel is off), P-8b, and at least one entry point (P-4 or P-5).

**Go-live checklist additions (§9.5):** endpoint subscribed to exactly the SA-P8 list, `invoice.created` not subscribed; "Successful payments" and "Failed payments" customer emails on; Smart Retries and "after all retries" behaviour per BQ-P7; portal configuration created in live mode and its id set; Adaptive Pricing confirmed off on live sessions; live prices created **with `tax_behavior` per BQ-P5 — Stripe does not let `tax_behavior` change once set**, so BQ-P5 must be answered before live prices exist; `check-bos-plan-prices` passes in live mode.

### SA-5. Business questions

| # | SA verdict |
|---|---|
| BQ-P1, BQ-P2, BQ-P3, BQ-P7 | **Keep**: genuine business choices. BQ-P2's technical consequence is ruled in SA-P16c |
| BQ-P4 | **Keep, narrowed**: the safety floor is ruled above. The user decides only whether P-8a, P-10, P-7b, P-9, P-11 come before the first real charge |
| BQ-P5 | **Keep**, with a deadline: must be answered before live prices are created (immutable `tax_behavior`) |
| **BQ-P6** | **Struck, ruled technical:** MRR is included (sum of net USD amounts of active subscriptions, current mode only). The cost is negligible |
| BQ-P8 | **Keep** (small); RD-9 already holds it off |
| Missing | **None blocking.** Add to "Decided without asking": *deleting or resetting a subscribed account first requires cancelling the subscription; no refund for the rest of the period (Q-B7)* (PF-14), and *an admin tier change on a subscribed account lasts until the next renewal; lasting changes go through Stripe or an override* (SA-P16b) |

**Awareness item: confirmed, and wider than stated.** Until S-5 (which needs S-2, not started), nothing reads the lifecycle for access, and credits are charged but not refused until credit slices 9–10. So not only a failed renewal: **a customer who cancels, whose payment fails, or whose subscription ends keeps full product and AI access until S-5.** Paid-through, grace and paused are recorded correctly and shown to admins, so switching S-5 on later acts on accurate data. The only page gate that works today is the invite payment hold, and it is released once and never re-applied.

### Conditions

1. **C-1** P-0 (webhook Pino) merges before P-1; no plan code goes into the unconverted file.
2. **C-2** TK-1 recorded before P-1 merges (SR-14); P-1 refuses the Pilot-Credit subscription checkout in the same PR (PF-12).
3. **C-3** P-1 deployed to production before P-3a merges (SA-P7); no BOS checkout ever sets `user_id` metadata (it uses `bos_user_id` as a cross-check only).
4. **C-4** SA-P13 query answered before the P-2 workplan; SA-P5 `billing_events` query answered before the P-10 workplan.
5. **C-5** Storage, money history and the apply function exactly as SA-P1, SA-P3, SA-P5; `billing_events` is not written by Business OS (Q-T3 reversed). *Amended 2026-10-07 by the P-3b workplan SA review: the money history carries the four Q-10 columns, and the apply function follows SA-P3 as amended (Q-7 replaces `GREATEST`, Q-11).*
6. **C-6** Anchor policy SA-P2 and precedence SA-P16, each pinned by tests (replay, out-of-order renewal, upgrade, re-buy after pause, $0 trial invoice, admin change on a subscribed account).
7. **C-7** The webhook flushes audit before its 200 and invalidates the entitlement cache (PF-11).
8. **C-8** Basil shapes (PF-9) covered by fixture tests built from real test-mode payloads.
9. **C-9** Test mode on the shared database per PF-15; test-mode demos run on a deployment with test keys and its own test-mode endpoint (Vercel deployment protection bypassed for Stripe's deliveries, documented in the workplan).
10. **C-10** PF-10 margin and PF-1 grace land together in P-6a as config history entries, never by editing an old entry.
11. **C-11** PF-14 refusal on reset/deletion while subscribed lands before go-live.
12. **C-12** BA applies the text corrections in SA-3 and SA-5 (PF-9 to PF-15 into §4, flow notes, P-0/P-3a/P-3b/P-6a/P-6b into §9, BQ-P6 struck, two "decided without asking" rows) before the P-1 workplan.

### Approval

[x] Requirement approved with conditions C-1 to C-12. Dev may write the P-0 and P-1 workplans once C-12's text corrections land; P-2 additionally waits for C-4's first query.

---

## SA Review — P-5 scoping (2026-10-11)

**Reviewed by SA, 2026-10-11.** Scope: §9.1.1 (D5-1 to D5-6, G5-1 to G5-14, N-1 to N-5, S5-1 to S5-9), the P-5a, P-5b, P-9 and P-13 rows of §9.1, §9.2, §9.3, §9.5 row 1, §10.3, AC-F2.x, F2, SR-5/6/7, SA-P11, SA-P18, and the invite requirement (5c, FR-25, FR-31, FR-35 to FR-38, FR-43, §7.10, §8.3). Checked against `origin/main` `3517f563` and the as-built code: `paymentHold.ts`, `paymentHoldGate.ts`, `app/invite/awaiting-payment/page.tsx`, `awaitingPaymentCopy.ts`, `inviterNotification.ts`, `invite-accepted.ts`, `friendInviteOps.ts`, `planCheckout.ts`, `planCheckoutEligibility.ts`, `planPaymentApply.ts`, `adminInviteOps.ts`, `inviteRedemption.ts`, `config/invites.ts`, migrations 20261014, 20261024, 20261027 and 20261047, and the 20261027 checker script.

**Status: APPROVED WITH CONDITIONS** (P5-C1 to P5-C12 below). The split into P-5a and P-5b is right, P-13 after P-9 is right, and the scope reuses what P-3a, P-3b and N-1 built. One technical fact in the plan was wrong (P5-F1) and one migration mechanic was missing (P5-F2); both are ruled below. No question goes to the user.

### P5-1. Fact check

| Claim | Verdict | Evidence |
|---|---|---|
| 20261028 is free on main and sorts after 20261027 | ✅ | `git ls-tree origin/main supabase/migrations/`: 20261027 then 20261030; 20261028 and 20261029 absent there and on every remote branch |
| Main's highest migration is 20261051; the cleanup chain ends at 20261047 | ✅ | `20261051_secdef_lockdown_slice5_trigger_functions.sql`; `20261047_operator_test_account_cleanup_audit_actor.sql` is the newest `operator_test_account_cleanup` version |
| `first_paid_at`, `first_payment_ref` exist on `business_os_account_lineage`, paired | ✅ | 20261024: both columns, CHECK `(first_paid_at IS NULL) = (first_payment_ref IS NULL)`, ref length 1 to 255 |
| Lineage has no UPDATE grant today | ✅ | 20261014: `REVOKE ALL` from every role, then `GRANT SELECT, INSERT ... TO service_role` |
| The stamp SQL in SA-2 (`WHERE user_id = $u`) | ❌ **P5-F1** | The lineage key is **`account_id`** (PK). There is no `user_id` column. Today `resolveAccountId(userId)` returns the user id unchanged, so the function writes `WHERE account_id = p_user_id`, with a comment naming that seam |
| "Replace" `business_os_apply_plan_payment` with `CREATE OR REPLACE` | ❌ **P5-F2** | It is `RETURNS TABLE (out_status, out_event_row_id, out_tier_before, out_tier_after, out_plan_written, out_anchor_set)`. Adding a return column changes the return type, which `CREATE OR REPLACE` refuses. Ruled in S5-3 |
| P-3a admits a held friend whatever `paidInvitesAvailable` says (G5-5) | ✅ | `planCheckoutEligibility.ts` reads `INVITE_ISSUANCE_POLICY.account.grantId` only; the switch is read only by `adminInviteOps.ts:256` |
| A paying held friend gets `basic` and stays held (G5-6) | ✅ | 20261027's function never touches lineage; `readPaymentHold` keys on `first_paid_at` |
| Admin Paid invites are refused at redemption regardless of the switch (G5-12) | ✅ | `inviteRedemption.ts:330`: `if (row.grant_kind === 'tier') return refuse(409, 'paid_invites_not_available')` |
| N-1 was built to take N-2 | ✅ | `invite-accepted.ts`: `InviterNotificationEvent = 'accepted'`, commented "N-2 adds `'subscribed'`"; one 4 s deadline in `INVITER_NOTIFICATION_POLICY` |
| `FriendInviteStatus` has no "subscribed" (G5-10) | ✅ | `friendInviteOps.ts:159`: `'pending' \| 'expired' \| 'revoked' \| 'joined'` |
| The 20261027 checker pins the function's output names | ✅ | `scripts/check-bos-billing-events-migration.sql:271` compares the full argument and output name list, so after 20261028 that check reads FAIL by design (precedent: the 20261039 checker's C5 after 20261040) |

### P5-2. Rulings on S5-1 to S5-9

| # | Ruling |
|---|---|
| **S5-1** Held path needs `paidInvitesAvailable` | **Yes, inside `planCheckoutEligibility`**, which already imports `INVITE_ISSUANCE_POLICY`, so the entitlements registration does not change. When the hold is `held` and the switch is off, return a refusal (`held_payment_unavailable`, logged at `warn`), never a widened tier list. An unreadable hold stays `hold_unreadable` (fail closed). The switch is read through an injectable dependency so tests cover both states without editing the constant. The checkout and price switches are already checked first (route and step 4); this adds only the third |
| **S5-2** One predicate for the button and the checkout | **One pure function** in `lib/business-os/billing/` (for example `heldPaymentOffer(hold, switches)`), returning `pay` with the tier, or `unavailable`. `planCheckoutEligibility` calls it for the held case, and the holding page calls it with the same switch readers (`isPlanCheckoutEnabled`, `isPlanPriceRecognitionEnabled`, `paidInvitesAvailable`). The page must not re-derive any part of it. A test asserts that for every combination of the three switches and the hold states, the page offers Pay exactly when the checkout eligibility admits the account |
| **S5-3** The stamp and "did THIS call write it" | **Add one output column, `out_first_payment_stamped boolean`**, false on every early return. Inside the function, only on the two paths that insert a fresh `invoice_paid` row (`applied` and `recorded`), and only when `p_amount_minor > 0` (never `p_assigns_plan`, which is also true for a discounted $0 cycle): `UPDATE public.business_os_account_lineage SET first_paid_at = p_paid_at, first_payment_ref = p_stripe_invoice_id WHERE account_id = p_user_id AND first_paid_at IS NULL`, then `GET DIAGNOSTICS` row count = 1 sets the flag. The flag comes from the same transaction that holds the billing row `FOR UPDATE` and inserted the invoice under its partial UNIQUE, so a replay (`already_applied`, `already_recorded`), a concurrent delivery or a reconciler pass can never see true twice. No lineage row: count 0, flag false. **Migration mechanics (P5-F2):** inside the one `BEGIN ... COMMIT`, `DROP FUNCTION public.business_os_apply_plan_payment(<the exact 18-type signature>)`, `CREATE FUNCTION` with the new return table, then re-issue the COMMENT and every REVOKE/GRANT exactly as 20261027 (PUBLIC, anon, authenticated, service_role revoked; EXECUTE to service_role), plus `GRANT UPDATE (first_paid_at, first_payment_ref) ON public.business_os_account_lineage TO service_role`, and end with `NOTIFY pgrst, 'reload schema'`. The rollback drops and re-creates the 20261027 body and revokes the column grant. Scripts as for 20261027: pre-check, checker, rolled-back probe (first stamp true, replay false, $0 invoice false, no-lineage false, refusal false), rollback in `supabase/SQL Scripts/`. All SQL follows the user's paste rules: no `--` comments, no punctuation in string literals, never the word "into" in a string. The checker states that the 20261027 checker's signature line now fails by design |
| **S5-4** The audit event | **A new registered key, `BOS_BILLING_FIRST_PAYMENT_STAMPED`** (severity `info`, audience `bos`, in `lib/audit/events.ts` and `eventAudience.ts`), not a field on `BOS_BILLING_INVOICE_PAID`. Reasons: invite §8.3 lists it as its own event; future perks key on it, so it must be filterable by action; and its entity is the lineage row, not the plan row. Actor `platformActorId()` with `details.actor = 'stripe_webhook'` (P-3b Q-4); entity `business_os_account_lineage` / account id; details: invoice id, money-history row id, lineage `source`, `livemode`; never an email. Written only when `out_first_payment_stamped` is true, queued together with the `BOS_BILLING_INVOICE_PAID` entry so the existing bounded flush covers both (no second serial flush). The lineage row itself is the primary record (invite §8.3), so a lost audit row loses no fact. N-2's notified and not-notified entries reuse `BOS_INVITE_INVITER_NOTIFIED` and its sibling with `event: 'subscribed'` in details, as N-1 |
| **S5-5** N-2 from the webhook: durable queue or direct send | **Direct send, awaited inline under N-1's 4 s deadline, after the money write and the audit flush; no outbox table, no cron.** The `durable-queue-drain` skill governs a job that drains a table of pending effects; here there is no table to drain. The "exactly once" comes from the stamp flag (S5-3), not from a claim, and D5-6 accepts that a send lost to a crash is not retried, as N-1 does (N-1 SA Q-1, Q-2). An outbox would add a table, a migration, a cleanup-function version and a cron for one best-effort email, which is disproportionate (CLAUDE.md rule 7). Rules: (a) the stamp side effects live in the **shared orchestration `planPaymentApply.ts`**, injected as a dependency, never in the webhook route or handler, so a future reconciler (P-8b) that is the first to apply an invoice also audits and emails exactly once, and one that re-applies does neither (AC-F2.8 reads "a reconciliation that re-applies an invoice"); (b) nothing after the apply commits may throw, so a stamped payment is never released for a Stripe retry that would then return `already_applied` and lose the audit and the email: a unit test pins that N-2 failure, timeout and lookup failure all return normally; (c) only for lineage `source = 'account_invite'`; the champion is the invite row's `issuer_account_id`, read by the lineage `invite_id` of the account that our billing record resolved (SR-8), never from Stripe metadata; (d) the email carries only the address the champion typed and the status, in the champion's language (FR-40, FR-41), with N-1's redaction settings |
| **S5-6** How the holding screen learns the hold lifted | **The server re-read is the only thing that releases.** The page is already `force-dynamic` and redirects to onboarding when `readHoldForSession()` says not held. Processing state: when the URL carries the checkout return marker (the session id Stripe appends to the `awaiting_payment` return path), or the billing row for the current mode shows a paying subscription status while the account is still held, show "Payment processing" with no Pay button, and refresh the server component every few seconds for about a minute (`router.refresh()`), then show "This is taking longer than usual, refresh in a minute". The URL marker only changes what is shown; it can never release anyone. A read error shows the existing error state and never redirects (SA R-4). A held account with a paying subscription for more than a few minutes is the G5-6 shape: log `error` with `alert: true` |
| **S5-7** `paidInvitesAvailable` also opens admin Paid invites | **Do not split the switch.** It is a code constant, so turning it on is a reviewed one-line PR, and redemption of admin tier invites is refused unconditionally until P-9 (`inviteRedemption.ts:330`), so the worst case is an admin sending an invite that cannot be redeemed yet, never money taken without access. P-5a updates the comment in `config/invites.ts` to say so, and §9.5 row 17 says "only after P-9 is merged". Local demos flip it locally and never commit the flip |
| **S5-8** Admin paid, date and amount | **A cross-account admin read, documented.** A new purpose method on `BusinessOsBillingEventRepository` that takes a list of `(account id, invoice id)` pairs from the lineage rows on the page and returns `kind = 'invoice_paid'` rows matching **both** `user_id` and `stripe_invoice_id` (the partial UNIQUE on the paid invoice id makes it one row each). Matching both stops a wrong or reused ref from showing another account's payment (`tenant-isolation-guard` step 2). One batched query per page, never one per row. The route keeps `requireAdmin` as its first statement. Nothing is copied onto lineage. The service-role use is commented in the method |
| **S5-9** P-13 waiver storage | **Three nullable columns on `business_os_account_lineage`**: `payment_waived_at timestamptz`, `payment_waived_by uuid` (**no foreign key**, so the account-deletion FK chain and the cleanup function's G-10 link guard are untouched, and a deleted admin leaves the record readable), `payment_waiver_reason text` (CHECK 1 to 500 characters), with a CHECK that `payment_waived_at` and the reason are set together, and `GRANT UPDATE` on the three columns to `service_role`. Not the audit trail (it only queues, so it cannot be gate input) and not a new table (the hold already reads this one row by primary key, so the gate gains no read and no new failure mode). The hold predicate becomes: held only if `first_paid_at IS NULL` **and** `payment_waived_at IS NULL`, changed once in `isAwaitingPayment` / `readPaymentHold` and nowhere else; the `account_invite` short circuit still decides on the lineage read alone. The admin action: `requireAdmin` first; Zod (`.strict()`: reason, tier from `TIER_ORDER`, end date in the future); the account id from the path, then **refused unless `readPaymentHold` says that account is held** (so a marker can never land on an ordinary account); then the plan is assigned with its end date through the existing admin plan path (`recordPlanChange`), then the waiver is written by a compare-and-set update `WHERE account_id = $1 AND first_paid_at IS NULL AND payment_waived_at IS NULL` using `{ count: 'exact' }` and no `.or()` or `.select()` (the PostgREST gotcha). Plan first, waiver second: if the second step fails the friend has a plan and is still held, which is safe, and a retry finds the plan in place. Audit `BOS_INVITE_PAYMENT_WAIVED` (registered, severity `info` like the other deliberate admin billing actions, with the admin as actor and the tier and end date in details; the free-text reason stays on the row, not in the audit entry). Migration: next free number at Dev time (after 20261051). It adds columns, not a table, so no cleanup-function version is needed; Dev runs the Danger Zone check on a test account after applying it to confirm |

### P5-3. Slicing, reuse and standards

| Check | Verdict |
|---|---|
| Each slice demoable and a few days | ✅ P-5a about 3 to 3.5 days (the DROP/CREATE migration and its four scripts are about a day; the Pay screen, processing state and i18n about a day). P-5b 2 to 2.5 days. P-13 about 2 to 2.5 days |
| Reuse | ✅ `readPaymentHold`, `planCheckoutEligibility`, `recordPlanChange` and the bounded flush, N-1's notifier, template and deadline, the existing embedded-checkout pattern (`BoostPackagesPanel`, the harness `PlanCheckoutPanel`). **P-5a extracts one shared plan embedded-checkout client component** from the harness panel, which P-4 then reuses; it does not write a second Stripe.js loader |
| New things, justified (rule 7) | One output column, one column grant, one audit key (S5-4), one pure predicate (S5-2), one repository method (S5-8); P-13 three columns and one audit key. Nothing else |
| Entitlements registration (SR-17) | `planCheckoutEligibility.ts` keeps its symbols. Any new importer, for example the module that reads `presentation` for the price on the holding screen, or the shadow report change, is registered in `KNOWN_NON_GATE_IMPORTERS` with exact symbols, and `npm run test:bos-entitlements` is reported in each workplan. The holding page itself keeps its "imports nothing from the entitlements module" rule: it receives the price from the billing helper |
| Tenant isolation | The stamp is keyed on the account our billing record resolved (SR-8). N-2's lookups are keyed on the lineage invite id of that account. The champion's "Subscribed" is derived through the issuer-scoped repository (session account = `issuer_account_id`), returns a status only, never a date or amount. The admin read matches account and invoice together (S5-8). The waiver is refused on any account that is not held |
| Shadow report and dry run (SA-P18) | Reuse the predicate `isAwaitingPayment`, never copy it. These reports cover many accounts, so read lineage (and admin invite grant kinds) in **one batched query** and apply the shared predicate per row; never call `readPaymentHold` once per account |
| Cleanup chain | P-5a and P-5b add no table and no FK to `auth.users`; the chain stays at 20261047. P-13 adds columns with no FK (S5-9) |

### P5-4. Findings and notes

| # | Severity | Finding | Where |
|---|---|---|---|
| P5-F1 | Medium | SA-2's stamp SQL names `user_id`; the lineage key is `account_id` | Fixed in this ruling (S5-3); the SA-2 text is kept as written on its date |
| P5-F2 | High | A replacement with `CREATE OR REPLACE` would fail on apply, since the return type changes | S5-3: DROP and CREATE in one transaction, grants re-issued |
| P5-F3 | Medium | A held friend whose paid invoice was applied **before** 20261028 is never stamped, because a re-delivery returns `already_applied` and stops before the stamp. Production has had both payment switches off, so the count should be 0 | The 20261028 pre-check counts lineage rows with `first_paid_at IS NULL` whose account has an `invoice_paid` row with `amount_minor > 0`. Expected 0. If it is not 0, stop and bring it to SA; no backfill is written speculatively |
| P5-F4 | Low | The invite pages send `Referrer-Policy: no-referrer`. Whether Stripe's embedded checkout renders under it is not proven | Checked on localhost on P-5a day 1. If it does not render, SA pre-approves `strict-origin` for `/invite/awaiting-payment` only (it carries no token), in the middleware and the page metadata together |
| P5-N1 | Note | Payments on the shared database are test mode (PF-15), so a test payment stamps `first_paid_at` like a real one | Any future perks slice must check the money-history row's `livemode` before granting anything. Demos use test champions and test friends only (N-5) |
| P5-N2 | Note | The P-5b demo sends a real N-2 email | The test champion's address is one the user controls |

### Conditions

1. **P5-C1** 20261028 exactly as S5-3: the stamp on `account_id`, only on a fresh `invoice_paid` row with `p_amount_minor > 0`, `out_first_payment_stamped` from the row count, DROP and CREATE in one transaction with every grant re-issued, the column-level UPDATE grant, `NOTIFY pgrst`, and the four scripts. Dev confirms at workplan time that 20261028 is still free on `origin/main`.
2. **P5-C2** **Merge gate:** 20261028 is applied to production with the pre-check (P5-F3 count 0), checker and probe VERDICT PASS **before P-5a merges**, as P-3b's Q-13. The repository maps the new column; the code treats a missing value as "not stamped".
3. **P5-C3** The stamp's side effects (S5-4 audit, and N-2 from P-5b) are driven only by `out_first_payment_stamped`, live in `planPaymentApply.ts` behind injected dependencies, and never throw after the apply commits (S5-5 a and b), each pinned by a test.
4. **P5-C4** No TypeScript code writes `first_paid_at` or `first_payment_ref`: no repository method for it, and a source guard test that the boost modules never reference the lineage writer or those columns (SR-6, AC-F2.4).
5. **P5-C5** One predicate for the Pay button and the held checkout (S5-1, S5-2), with the switch-combination test.
6. **P5-C6** The holding screen releases only on the server re-read; processing state and polling per S5-6; a read error never redirects.
7. **P5-C7** `BOS_BILLING_FIRST_PAYMENT_STAMPED` registered and written once per stamp, with no second serial flush (S5-4).
8. **P5-C8** N-2 per S5-5: inline, 4 s deadline, friend invites only, N-1's template extended with `'subscribed'` and its audit entries, en/he/es.
9. **P5-C9** Admin paid column per S5-8 (account and invoice matched together, one batched query); the champion's "Subscribed" through the issuer-scoped repository, status only.
10. **P5-C10** Shadow report and dry run reuse `isAwaitingPayment` on batched reads (P5-3).
11. **P5-C11** Every new importer of `lib/business-os/entitlements/` registered with exact symbols; `npm run test:bos-entitlements` reported per workplan (SR-17).
12. **P5-C12** P-13 per S5-9: lineage columns with no FK, the hold predicate changed in one place, refused unless held, plan first then a compare-and-set waiver with `{ count: 'exact' }`, `requireAdmin` first, Zod `.strict()`, registered audit key. BA records in §9.5 row 17 that `paidInvitesAvailable` is turned on only after P-9 has merged (S5-7), and updates the §9.3 P-13 row to "columns on the lineage table".

### Business questions

**None.** Every S5 item is technical and ruled above. D5-5 (a waived friend shows as "Joined" to the champion) stays the BA's recorded default and can be overridden by the user later without code beyond a label.

### Approval

[x] P-5 scoping approved with conditions P5-C1 to P5-C12. Dev may write the P-5a workplan now. P-5b's workplan may start once P-5a's is approved; P-13's after P-9's.

---

## Change History

| Date | Change | Details |
|------|--------|---------|
| 2026-10-02 | Created (BA) | Scoping of S-4a and invite 5c from the SA as-built of the same day: flows F1–F10, findings PF-1 to PF-8, recurring rules, admin monitoring v1 (AM-1 to AM-10), safety SR-1 to SR-17, slices P-1 to P-12 with migrations 20261025–29 proposed, coordination with Credits Boost, eight business questions (BQ-P1 to BQ-P8), SA items SA-P1 to SA-P18, acceptance criteria |
| 2026-10-02 | SA review: **APPROVED WITH CONDITIONS** | New section "SA Review — 2026-10-02". SA-P1 to SA-P18 ruled: new server-write-only `business_os_billing_accounts` (RD-3 refined), own append-only `business_os_billing_events` (Q-T3 reversed), one SQL apply function with system actor and shared audit/flush/invalidate helper (Q-T2 refined), anchor set only on a new subscription, stale-claim reclaim plus a pluggable reconcile cron, derived grace with no `past_due` write. New findings PF-9 to PF-15 (Basil shapes, monthly grace blip → 24 h margin, audit flush, paying into a denied path, anchor reset by admin, reset/deletion while subscribed, test mode on the shared DB). Slices re-cut: P-0 added, P-3 → P-3a/P-3b, P-6 → P-6a/P-6b, PF-1 moved to P-6a. BQ-P6 struck (MRR included); BQ-P4 narrowed to above a technical floor; BQ-P5 must precede live prices. Conditions C-1 to C-12 |
| 2026-10-02 | Decisions, SA-P13 result and C-12 corrections (BA) | User decisions recorded in new §10.1 ("go with the defaults for all questions"): BQ-P1 to BQ-P5, BQ-P7 and BQ-P8 decided as the defaults, BQ-P4 as narrowed by SA; BQ-P6 struck by SA. SA-P13 query result recorded in new §10.2: 897 events, all test mode, 2026-08-25 to 2026-10-02, so the P-2 workplan is unblocked; key prefix, TK-1 and the `billing_events` query still owed. C-12 applied: PF-9 to PF-15 added to §4; flow notes (24 h margin in F5/F6/F8/§6, F4 warning, F7 mechanics, F9 receipt emails, PF-6 lookup); §9 re-cut (P-0, P-3a/P-3b, P-6a/P-6b, dependencies, diagram, migrations, coordination, go-live checklist additions); BQ-P6 struck; two "decided without asking" rows. Status line updated |
| 2026-10-03 | User approval recorded; P-1 notes in §9.4 (Dev) | Status line records the user's approval of 2026-10-02. §9.4 records that P-1 built the Business OS dispatcher and how boost 4a plugs in (P-1 workplan A2), and the SA P1-C8 carry-forwards CF-1 to CF-4 |
| 2026-10-03 | Go-live checklist consolidated; P-9 re-ordered (BA) | User decisions of 2026-10-03. **§9.5 is now the single go-live checklist** ("switching to real money"), with 19 rows, each with an owner, a "when" and a done box. It gathers the SA review, G-1, TK-1, the accountant's tax answer before live prices, PF-15 / C-9, live prices with the same lookup keys, the live endpoint with its events and the API version `2025-10-29.clover` (Q-5), the Vercel live keys, the dashboard emails, retries, Adaptive Pricing and portal, the three switches, the first real purchase, and live-only admin data. Other sections now point to it instead of repeating items (PF-5, PF-14, PF-15, §6 tax, SR-12 to SR-14, §10 user actions, §10.2, SA-P13). **TK-1** moved off the P-1 gate to the go-live checklist (user: "we are still in testing mode, so not worries for now"). The **webhook API version and key-prefix checks** were deferred to the P-3a gate and the checklist. P-1 merged on that basis (#188), because P-1 recognises nothing and denies every platform invoice. The repo's local Stripe key belongs to a separate, empty sandbox, so production's Stripe environment needs dashboard checks. **P-9** (admin Paid invites) now runs right after P-5, before P-6a, and before the first real charge. §9.1 rows, the §9.2 diagram and paragraph, and the BQ-P4 decision are updated; migration 20261028 is unchanged |
| 2026-10-04 | SA-P1 amended; §9.1 P-2 updated (Dev, P-2a) | SA-P1 row records the P-2 workplan SA review rulings Q-1 and Q-2: surrogate `id` PK, nullable `user_id` `ON DELETE SET NULL`, UNIQUE (`user_id`, `livemode`) (one Business OS customer per person **per mode**), column-level UPDATE on 17 columns incl. `stripe_customer_id`. §9.1 P-2: env names documented in BUSINESS_OS_ENTITLEMENTS.md instead of a tracked `.env.example` (ruling Q-4, file deferred to staging C2), and the P-2a / P-2b split (ruling Q-8) |
| 2026-10-05 | Payments migration block renumbered; P-10 split and 20261036 recorded (Dev, P-10a) | Per the P-10 workplan SA review condition C-2: 20261026 is already used on `main` (`20261026_business_os_credit_charges_activity_indexes.sql`), so §9.1 and §9.3 now read **P-3b 20261027, P-5 20261028, P-9 20261029**, and the P-8b spare is dropped (next free number after 20261036 if ever needed). The SA Review section keeps the old numbers as written. §9.1 P-10 row: split in P-10a (server, migration **20261036**) and P-10b (old billing UI), boost checkout switched off per Credits Boost FR-40 (R-7: P-10 lands first), frozen-account pre-check as a merge gate (C-1). §9.3 records 20261036. §9.4 CF-3 closed in P-10a (not yet merged) |
| 2026-10-06 | P-10a migration renumbered 20261036 → 20261038 (Dev, P-10a) | After rebasing P-10a on `main`: 20261036 and 20261037 were taken there by the address book (`20261036_business_addresses_book.sql`, `20261037_business_addresses_ownership_fk.sql`). §9.1 P-8b/P-10 rows, §9.3 table and the reservation note now read 20261038; the 2026-10-05 row above keeps the old number as written. |
| 2026-10-06 | §9.3: migration 20261039 recorded (Dev, P-10 follow-up) | Browser SELECT on `boost_packs` revoked from `anon` and `authenticated` (SA Q-7 one-liner, P-10b open item B-4). P-10a (#234) and P-10b (#238) are merged; no browser reader of the table is left. Pending manual apply |
| 2026-10-06 | Sandbox decision; CF-1 answered; plan price switch (Dev, P-2b) | §10.2 records the user's decision ("yes, use the sandbox and start P-2b"): development and testing on the "AgentsPilot sandbox" account, production's own account gets the same lookup keys at its setup; the code stays account-agnostic, and the catalog uses the keys only while the server switch `BUSINESS_OS_PLAN_PRICES_ENABLED` is on (default off, so production stays at P-1's deny-all). §10.2 also records what the fixture capture observed: the sandbox now has a webhook endpoint to production on `2025-09-30.clover`, and events render in that version, so the capture wrote nothing. §9.4 CF-1 answered (retired lookup keys). §9.5 row 7 gains the switch |
| 2026-10-06 | Webhook Connect DB→repositories workplan approved (TL) | §9.4 CF-5 added. [Workplan](/docs/workplans/BUSINESS_OS_WEBHOOK_CONNECT_REPOSITORIES_WORKPLAN.md) SA APPROVED WITH CONDITIONS C-1..C-9: ~5 dev-days, six sequential PRs (no stacking), "before" snapshot recorded on 248de6be (28 tests / 28 snapshots, snapshot blob `4f5f223e`). Pre-existing findings F-1/F-2/F-4 (cross-tenant writes on Connect invoices/bookings) and F-3 (Stripe-ended plans keep unpaid periods pending) go to separate fix PRs |
| 2026-10-07 | Webhook Fix-1 workplan approved (TL) | User chose to close the Connect cross-tenant holes before the refactor. [Fix-1 workplan](/docs/workplans/BUSINESS_OS_WEBHOOK_CONNECT_FIX1_WORKPLAN.md) SA APPROVED WITH CONDITIONS C-1..C-5: owner checked before any Connect invoice write (F-1), booking update scoped to the account owner (F-2), foreign booking/contact/service ids dropped before the payment row (F-4); refusals keep today's policy (log, 200, event completed). SA also confirmed F-5 (plan path stores an unchecked booking id) → separate PR Fix-1b right after. Follow-up FU-5: the account-owner cache caches a failed lookup as "no business" |
| 2026-10-07 | §9.3: 20261039 applied; 20261040 recorded (Dev) | 20261039 merged (PR #243) and applied to prod 2026-10-07, checker VERDICT PASS. New row 20261040: drop the two dead `boost_packs` policies, RLS kept on; pending manual apply |
| 2026-10-07 | Webhook Fix-1 PR opened (TL) | [PR #242](https://github.com/AgentsPilot/neuronforge/pull/242) (`fix/webhook-connect-tenant-ownership`, base d8d565f4, no migration): SA code review APPROVED, QA PASS WITH NOTES (28 QA tests, 15 fail on the old code), harness 20 entries identical / 8 planned / 12 new. Next: Fix-1b (F-5), FU-5, then CF-5 PRs 0–5 |
| 2026-10-07 | Webhook Fix-1 merged (TL) | [PR #242](https://github.com/AgentsPilot/neuronforge/pull/242) merged as 2a88f0bc, all checks green. User: no business-logic fixes in this effort, so F-3 was emailed to Offir; Fix-1b (F-5) and FU-5 (owner cache) are in scope as security/infra. Next: Fix-1b |
| 2026-10-07 | P-3a code complete (Dev) | §9.1 P-3a row: code complete, uncommitted, awaiting SA code review; new server switch `BUSINESS_OS_PLAN_CHECKOUT_ENABLED` (default off, refuses unless the price switch is on); G-2 met (user, 2026-10-04: "checker passed, merged PR192", plus a read-only column check); the endpoint-version and key-prefix checks stay open by the user's choice and gate only production demos and switches. §9.4 CF-4 closed. Webhook unchanged: checkout-session events move to P-3b (SA Q-1). No migration |
| 2026-10-07 | Webhook Fix-1b PR opened (TL) | [PR #246](https://github.com/AgentsPilot/neuronforge/pull/246) (no migration): `bindPlanSubscription` keeps a plan's booking / service / plan id only if the owner owns it (F-5), dropped never refused, cap unchanged. SA APPROVED_CODE_REVIEW, QA PASS WITH NOTES (35 end-to-end QA tests, 21 fail on the old code). Existing-data check (C-3) run by the user: no rows |
| 2026-10-07 | Webhook Fix-1b merged (TL) | [PR #246](https://github.com/AgentsPilot/neuronforge/pull/246) merged as 0f3dd447 after a docs-only rebase over #245, all checks green |
| 2026-10-07 | Webhook FU-5 workplan approved (TL) | [FU-5 workplan](/docs/workplans/BUSINESS_OS_WEBHOOK_OWNER_CACHE_FU5_WORKPLAN.md) SA APPROVED WITH CONDITIONS C-1..C-5 (infra): a failed account-owner lookup now throws, so the webhook returns 500, releases its claim and Stripe retries, instead of refusing and losing the event; a failed lookup is never cached; the cache is cleared at the start of every webhook call: a successful lookup by one call may be read by an overlapping call; a failed or empty one never is. A truly unmapped account is refused unchanged. SA rule-1 ruling: `resolveAccountOwner`'s direct reads move in CF-5 PR 5 onto the existing `StripeConnectRepository` and `PluginConnectionRepository` |
| 2026-10-07 | P-3b workplan rulings recorded; P-3b.1 implemented (Dev) | Per the [P-3b workplan](/docs/workplans/BUSINESS_OS_PLAN_PAYMENTS_P3B_WORKPLAN.md) SA review (C-7): SA-P3 amended (Q-7 writes the period end verbatim when newest by the billing row's Stripe facts and replaces `GREATEST`; Q-11 adds the partial UNIQUE on the paid invoice id; Q-4 platform actor; Q-5 bounded flush; C-1, C-3), SA-P5 and C-5 amended (Q-10's four columns), §9.1 P-3b split in P-3b.1 / P-3b.2 with the Q-13 merge gate (20261027 applied before P-3b.1 merges), §9.3 20261027 row, §9.4 CF-6 (the $0 credit-balance upgrade, owner P-4). P-3b.1 implemented, uncommitted; `routes.test.ts` unedited except the one SA-approved mock (C-8 ruling). SA fix F-1: a replacement subscription clears `cancel_at_period_end` |
| 2026-10-07 | §9.3: 20261042 recorded (Dev, P-3b.1) | P-3b.1 adds `business_os_billing_events` to the test-account cleanup plan, which changes the cleanup function. 20261041 (PR #249) is applied, so the change ships as a new `CREATE OR REPLACE` migration 20261042 that refuses until 20261041 and 20261027 exist. Apply order for P-3b.1: 20261027 (pre-check, migration, checker, probe), then 20261042, then merge and deploy |
| 2026-10-07 | Webhook FU-5 PR opened and merged (TL) | [PR #250](https://github.com/AgentsPilot/neuronforge/pull/250) merged as 0c3c1800: a failed account-owner lookup now returns 500 so Stripe retries; SA APPROVED_CODE_REVIEW, QA PASS WITH NOTES (23 tests, 19 fail on the old code). Refactor PR 0 (harness gaps) started; effort per PR 0.75 / 0.5 / 1 / 1 / 1.25 / 1 d |
| 2026-10-07 | Webhook refactor PR 0 opened and merged (TL) | [PR #254](https://github.com/AgentsPilot/neuronforge/pull/254): tests only, 55 new harness scenarios, all 51 direct DB calls in the webhook now executed (coverage 73% → 91%), 45 existing entries byte-identical; QA killed 35/35 behaviour mutants. Coordinated with P-3b.2 (one handler-map line in the route; second to land rebases; harness entries added, never changed). PR 1 (claim table + shared client) started |
| 2026-10-07 | P-3b.2 implemented (Dev) | §9.1 P-3b row: P-3b.1 merged (#251), 20261027 and 20261042 applied (§9.3); P-3b.2 implemented, uncommitted, per the [P-3b workplan](/docs/workplans/BUSINESS_OS_PLAN_PAYMENTS_P3B_WORKPLAN.md) T14–T25: the `plan` flow handler (PF-15 first), `invoice.paid` through `business_os_apply_plan_payment` then `recordPlanChange` (platform actor, SA Q-4), `invoice.payment_failed` as one history row (SA Q-2), no plan row → released for retry with an alert (SA Q-3), session events (link + compare-and-set lock clear), the status-only subscription mirror read fresh from Stripe (SA Q-1). §9.4 CF-2 closed (not yet merged). Still open: C-6 (captured `2025-09-30.clover` fixtures from the demo) and the Connect harness P3 entry, which pinned "no handler yet" |
| 2026-10-08 | Webhook refactor PR 1 opened and merged (TL) | [PR #258](https://github.com/AgentsPilot/neuronforge/pull/258): `processed_webhook_events` behind the new `ProcessedWebhookEventRepository` (unscoped by design: keyed by the signed Stripe event id), the route's private service-role client replaced by the shared `supabaseServer`; 100/100 harness entries identical, QA old-vs-new traces identical on 17 claim scenarios. Rebased over Offir's #257, which added 2 direct `payment_transactions` calls (moved in PR 3); direct calls in the route 53 → 48. PR 2 (invoices) started |
| 2026-10-08 | Webhook refactor PR 2 opened and merged (TL) | [PR #266](https://github.com/AgentsPilot/neuronforge/pull/266): the 15 Connect `payment_invoices` / `business_profiles` sites behind `PaymentInvoiceRepository` purpose methods and the reused `findByStripeInvoiceId` / `findLanguage` (neither catches any more, so a thrown read still returns 500 and Stripe retries; SA CR-P2-1); Fix-1 ownership order pinned by a guard; 100/100 harness entries identical, QA 74/79 old-vs-new traces byte-identical (the rest only the accepted repository error logs). Rebased over credits boost 4a; direct calls in the route 48 → 33. PR 3 (money rows) started |
| 2026-10-08 | Webhook refactor PR 3 opened and merged (TL) | [PR #270](https://github.com/AgentsPilot/neuronforge/pull/270): the 11 `payment_transactions` sites (incl. #257's lookup and attach) and the `payment_refunds` upsert behind seven `PaymentTransactionRepository` purpose methods and the new `PaymentRefundRepository`; 3 harness entries added first for #257's untested arms; 103 entries identical after the refactor, QA 88/88 old-vs-new traces byte-identical, 41/41 mutants killed. Direct calls in the route 33 → 21. A pre-existing dispute bug (a repeated `charge.dispute.created` overwrites `status_before_dispute`) emailed to Offir, not fixed here. PR 4 (plans and bookings) started |
| 2026-10-09 | Webhook refactor PR 4 opened and merged (TL) | [PR #275](https://github.com/AgentsPilot/neuronforge/pull/275): the 10 plan-period, plan-subscription and booking sites in the route and the 5 direct queries in `bindPlanSubscription` behind 15 purpose methods on `PaymentPlanRepository`, `SchedulingBookingRepository` and `PaymentPlanSubscriptionRepository` (owner-scoped ones keep `user_id`); F-3 deliberately kept (Offir's); the plan-checkout owner check moved above its `try`, which only removes a misleading log line (FU-5 SA Q-3). 103/103 harness entries identical, QA 70/73 + 33/33 traces identical (3 = that log line), 54/54 mutants. Direct calls in the route 21 → 11 (legacy tables only), bind 5 → 0. PR 5 (legacy tables, owner resolver, final guard) started |
| 2026-10-09 | Webhook refactor PR 5 merged — CF-5 done (TL) | [PR #279](https://github.com/AgentsPilot/neuronforge/pull/279) merged as 1c7ceaaa: the 11 legacy agent-platform sites and `resolveAccountOwner`'s 2 reads behind repositories, the `supabaseAdmin` alias removed, and a rule-1 source guard added to `routerPlacement.guard`. `app/api/stripe/webhook/route.ts` now issues no database query of its own (51 → 0 over CF-5); every step proven byte-identical by the P-0 harness (103 entries). §9.4 CF-5 marked done; open follow-ups listed there |
| 2026-10-11 | P-3b.2 demo recorded, C-6 closed (Dev) | §9.1 P-3b row: demo (T26) run 1 on 2026-10-09 (checkout and payment worked; production claimed the events first, the sandbox's link to production being on); the user confirmed the plan switch on 2026-10-11; production endpoint `we_1UNG3L56GTXD0wwiKUsZn8DU` paused 15:29:11 and re-enabled 15:31:46 UTC on 2026-10-11 with nothing bought; the Oct-9 subscription `sub_1UOayP56GTXD0wwiRAo7opmW` cancelled 2026-10-11. **C-6 closed:** five captured `2025-09-30.clover` fixtures (scrubbed of personal data), every field the code reads present; Q-9 stays closed. The harness Billing panel now says paying switches the plan. Live re-check moves to the user's "Stripe test account setup" session. P-3b.2 ready for PR, uncommitted. The 2026-10-07 "P-3b.2 implemented" row moved into date order |
| 2026-10-11 | P-3b.2 merged — P-3b complete (TL) | [PR #299](https://github.com/AgentsPilot/neuronforge/pull/299) merged as 5c774539: the webhook `plan` handler, session events, subscription mirror, CF-2, captured C-6 fixtures. §9.1 P-3b row and §9.4 CF-2 updated. No migration. For P-5: the test-account cleanup function chain on `main` now ends at `20261047_operator_test_account_cleanup_audit_actor` and the highest migration is 20261051, so P-5's cleanup change chains on the latest cleanup version and takes the next free number at its start (its 20261028 apply-function replacement is unchanged) |
| 2026-10-11 | P-5 scoped: split into P-5a / P-5b; admin waiver placed as P-13 (BA) | The user confirmed P-5's scope ("yes, matches. let's start"). New §9.1.1 "P-5 scoping (2026-10-11)" covers: the agreed scope; decisions D5-1 to D5-6; what P-3a and P-3b already built (held checkout, SR-5, `returnTo`, and P-3b R-6, a paying held friend staying held); gaps G5-1 to G5-14 (N-2 missing from the row, the first-payment audit, i18n, the switch check on the held checkout, the processing state, "excluding tax", the stale `billing_events` source in invite FR-25/§6.4/§8.3, `paidInvitesAvailable` opening admin Paid invites before P-9); notes N-1 to N-5 (20261028, the cleanup chain, the next free number after 20261051, the live-demo prerequisite); and SA items S5-1 to S5-9. §9.1: P-5 replaced by **P-5a** (3d, 20261028) and **P-5b** (2–2.5d, no migration); new **P-13** admin waiver after P-9 (BQ-P3); P-9 now depends on P-5a; P-12 updated. Also updated: §9.2 diagram and paragraph; §9.3 (20261028 to P-5a, new P-13 row); §9.5 row 1; F2 rows 1–2 and rules; AC-F2.1–2.3; §10.1 BQ-P3; §13 rows. Added: AC-F2.5–2.11; new §10.3 with **BQ-P9** (open). No earlier decision changed |
| 2026-10-11 | BQ-P9 decided (TL) | The user answered BQ-P9 "Yes, before go-live (Recommended)": the admin waiver P-13 is built right after P-9 and is part of the go-live build (§9.5 row 1); §10.3 and the §9.2 diagram updated |
| 2026-10-11 | SA review of the P-5 scoping: **APPROVED WITH CONDITIONS** (SA) | New section "SA Review — P-5 scoping (2026-10-11)", checked against `origin/main` `3517f563`. Fact check: 20261028 and 20261029 free and correctly ordered, highest 20261051, cleanup chain at 20261047; two corrections: the lineage key is `account_id`, not `user_id` (P5-F1), and adding a return column means the 20261028 function must be dropped and re-created, not replaced (P5-F2). S5-1 to S5-9 ruled: the switch check inside `planCheckoutEligibility` with one shared predicate for the Pay button; a new `out_first_payment_stamped` output from the same transaction drives the audit and N-2; a registered `BOS_BILLING_FIRST_PAYMENT_STAMPED` event; N-2 sent inline under N-1's 4 s deadline from the shared apply orchestration, no outbox or cron; release only on the server re-read; `paidInvitesAvailable` not split; the admin paid read matches account and invoice together; the P-13 waiver as three FK-less columns on the lineage row behind a compare-and-set. Findings P5-F3 (pre-check for payments applied before 20261028) and P5-F4 (embedded checkout under `no-referrer`). Conditions P5-C1 to P5-C12; merge gate: 20261028 applied with VERDICT PASS before P-5a merges. No business question |
| 2026-10-11 | P5-C12 text updates; P-5a workplan written (Dev) | §9.5 row 17: `paidInvitesAvailable` is turned on only after P-9 has merged (S5-7). §9.3 P-13 row: the waiver is columns on the lineage table, with no cleanup-function version (S5-9). [P-5a workplan](/docs/workplans/BUSINESS_OS_PLAN_PAYMENTS_P5A_WORKPLAN.md) written for SA review; 20261028 re-confirmed free on `origin/main` `a66b4c41` (20261027, then 20261030) |
| 2026-10-11 | SA review of the P-5a workplan: **APPROVED WITH CONDITIONS**; P-5a ships as two PRs (SA) | Rulings Q-1 to Q-8 and conditions W-1 to W-12 in the workplan's SA Review Notes. P-5a is cut into **P-5a.1** "first payment stamp" (20261028, repository mapping, stamp audit; inert, merge-gated on 20261028 applied with VERDICT PASS) and **P-5a.2** "Pay screen" (shared predicate, holding screen, shared embedded checkout, he/es approval, demo), never stacked. Stale text aligned with S5-9: the §9.1 P-13 migration cell and §9.1.1 N-3 now say the waiver is three columns on the lineage table, not "only if SA rules a stored marker". No business question |
| 2026-10-11 | P-5a.1 implemented (Dev) | 20261028 (the once-only stamp in `business_os_apply_plan_payment`, the seventh output `out_first_payment_stamped`, UPDATE on the two stamp columns only) with pre-check, checker, rolled-back probe F01 to F10 and rollback; all run on a local PGlite 16 (pre-check PASS, checker PASS 8/0, probe PROBE PASS with and without a lineage row, rollback restores the P-3b checker to PASS 16/0; six probe mutations and five checker sabotages each fail). The repository reads the flag leniently (P5-C2); the webhook apply writes `BOS_BILLING_FIRST_PAYMENT_STAMPED` with the invoice-paid entry under one bounded flush (`logAndFlush` list form, `recordPlanChange` companion entries); P5-C4 source guards. §9.1 P-5a row (P-5a.1 and P-5a.2 status) and §9.3 20261028 row (P-3b checker rows 81 and 83 FAIL by design) updated. Uncommitted, awaiting SA code review; merge gate G-3 open. `origin/main` not yet merged in (git refused the merge over this file's uncommitted edits) |
| 2026-10-11 | P-5a.1 SA code review carry-forward (TL) | §9.1.1 N-6 added: the SA's D-3 ruling makes the lineage audit entity owner-visible, so P-13's waiver entry and P-5b's not-notified entry must use an operator-only entity type (binding on both workplans) |
| 2026-10-13 | Admin Credits-left re-anchor fix (TL) | PF-13 row (risk register): after a re-anchor the admin Businesses "Credits left" column and the finance credit positions counted the old period's row (0% left vs the owner card's 100% on the test account). Fixed by exact-key row selection against a TS mirror of `business_os_credit_period_start`; see [BUSINESS_OS_ADMIN_CREDITS_LEFT_REANCHOR_FIX.md](/docs/requirements/BUSINESS_OS_ADMIN_CREDITS_LEFT_REANCHOR_FIX.md) |
