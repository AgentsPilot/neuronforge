# High-level requirement: Customer self-service for leaving Business OS (cancel, delete, export)

> **Last Updated**: 2026-10-24
> Source: the user's brief, pasted 2026-10-24 (verbatim below). TL corrections are in the "Status corrections" section at the end; the brief itself is unchanged.

## Why
We compared Business OS with HubSpot's cancel/delete and export flows. Our safety rules are as strict as theirs, or stricter: a running plan, connected Stripe payouts and money in flight all block deletion, finance records are kept, and there is no false promise of an undo. The gap is the customer-facing half. Today a customer cannot cancel their plan or delete their account without writing to us, and the "Contact us" fallback goes to a personal Gmail address. HubSpot treats both as basic self-service.

## Goal
A Business OS owner can end their plan, take their data and delete their account by themselves, safely, without contacting support.

## Scope (in priority order)

### 1. Self-service "delete my account" (accounts with no running plan)
- Already built on the local branch `feature/data-export-de10b2` (commit `9f9285da`, DE-10b.2). It is not pushed and not merged, and it sits behind an off switch (`isAccountSelfDeleteEnabled()`).
- Scope: review it against the current `main` (the branch predates several merges), finish it, merge it, and decide when to switch it on.
- It must keep the agreed design (DE-10b requirement, "SA Review 2"): a warning to download your data first; one typed confirmation sentence (en/he/es) checked on the server; rate limit; session user only; sign-out, then an `/account-deleted` page, then a confirmation email.
- Done when: an owner without a running plan can delete their account from Settings, and the personal-Gmail "Contact us" route is no longer the only way out.

### 2. Self-service plan cancellation: "cancel at end of period", with undo
- There is no cancel or downgrade route for the Business OS plan today. Only a cancellation made directly in Stripe is picked up.
- What we want, modelled on HubSpot:
  - Cancelling means "don't renew". It takes effect at the end of the paid period and never mid-period.
  - The owner can undo it ("keep my plan") until that date.
  - The flow has a short reason picker, a "features you'll lose" screen (from the entitlements catalogue), a review step and a confirmation email.
  - After the period ends, the account falls back to its free/cohort tier, and data is kept ("data is never deleted by a lifecycle transition").
- Ties to deletion: this is the step that makes "delete my account" reachable for paying customers. Covers DE-10b.3 (scheduled delete at period end, plus "Cancel deletion"). BA to decide whether "cancel plan" and "cancel plan and delete account at period end" are one flow or two.
- Out of scope: mid-period downgrades and refunds. Downgrades stay at renewal, as HubSpot does it.

### 3. Prerequisite (ops check, not a build): confirm admin "close and anonymise" is live on prod
- DE-10b.1 (PR #468) is merged, but the last notes say migrations `20261080` (deletion receipts) and `20261081` (cleanup function) were not applied.
- Verify on prod and apply them if missing, per `docs/runbooks/TEST_ACCOUNT_CLEANUP_RUNBOOK.md` §7.2. Items 1 and 2 depend on this engine.

### 4. Everyday per-list export (CSV / Excel)
- This is a separate feature from the full-account "Download my data" ZIP, which stays as it is.
- Export the list the owner is looking at (clients, invoices, bookings, payments…) with its current filters, as CSV or XLSX.
- BA to scope which lists come first, and whether choosing columns is needed in slice 1.

### 5. Later, already on the open-items list (record here, don't build now)
- Background exports with an emailed link, for accounts over today's size limits (export Phase 2).
- Removing the person's details from the Stripe Customer object after deletion.
- Admin receipt lookup and the retention sweep (DE-10b.4).

## Rules to keep (already decided, do not reopen)
- No undo after a delete runs (UD-6).
- Personal details are removed, but money records are kept for the retention period. The 7-year placeholder is pending the CPA (BQ-13).
- A running plan, a connected Stripe Connect account and money in flight block deletion (G-6, G-8, G-9).
- The export never blocks a delete. "Download my data" is offered next to deletion.
- Admin delete paths and their guards stay as they are.

## Open questions for BA
1. Should the cancel flow offer anything to keep the customer (pause, a discount), or is it a plain cancel? Default: a plain cancel.
2. Who receives the cancel and delete emails, and in which languages?
3. What replaces the personal-Gmail support contact, and when (BQ-8)?
4. Which lists does per-list export start with?

## References
- `docs/requirements/BUSINESS_OS_DATA_EXPORT_DE10B_REQUIREMENT.md` (deletion design, SA Review 2, BQ list)
- `docs/workplans/BUSINESS_OS_DATA_EXPORT_DE10B2_WORKPLAN.md`
- `docs/requirements/BUSINESS_OS_SUBSCRIPTION_ENTITLEMENTS_REQUIREMENT.md` §9 (lapse and data rules)
- `docs/business-os/BUSINESS_OS_DATA_EXPORT_CONTENTS.md` (what the ZIP contains)
- `lib/business-os/billing/planUpgrade.ts`, `planSubscriptionMirror.ts` (current plan routes and Stripe mirror)
- Note: read from `origin/main`. The local `main` checkout may be behind.

---

## Status corrections (TL, 2026-10-24, verified on prod read-only)

| Item | Brief says | Actual |
|---|---|---|
| 3 | 20261080 / 20261081 not applied | **Applied** (2026-10-18; checker 11/11). Re-applied 2026-10-23 from main after Offir's in-place regeneration (`c21a4b0f`, stamp `2bd40a46795e4555`), then a **user-applied bridge** adding 8 unreviewed inbound FKs (`abandoned_bookings`, `scheduling_meetings`, `email_sends.booking_id/meeting_id`, `payment_plan_installments.meeting_id`) with the stamp kept at `2bd40a46…`. The proper fix (branch `fix/cleanup-meetings-inbound-fks`, worktree `neuronforge-cleanupfk`, true stamp `ec34d5604055abfe`) still needs its own PR and a NEW migration number — never another edit of 20261081. Receipts table live, 0 rows. Item 3 is an ops check that is done, plus that PR. |
| 1 | not pushed | Still local (`9f9285da`); SA ✅ + QA PASS 2026-10-21; now 49 commits behind `origin/main`. GitHub access is back (2026-10-24). |
| Known gap | — | G-8 counts any `stripe_connect_accounts` row, so a **soft** "Disconnect" (Business Setup → Payments) does not clear it; only "Delete Account" (which deletes the connected account in Stripe) does. The disconnect routes also do not warn about running plans. |
| Prerequisite still owed | — | `DELETION_RECEIPT_FINGERPRINT_KEY` not confirmed set in Vercel; without it every delete answers 503 `not_configured`. |

## Change History

| Date | Change | Details |
|---|---|---|
| 2026-10-24 | Brief recorded | User's brief verbatim + TL status corrections |
