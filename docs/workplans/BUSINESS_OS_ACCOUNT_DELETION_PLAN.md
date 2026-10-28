# Plan: Business OS account deletion lifecycle, Keep my account, Cancel plan (DELETE scope)

> **Last Updated**: 2026-10-27

## Overview

This is the slice order for the DELETE scope of the self-service exit work: plain plan cancel (SX-1, SX-2, SX-3, SX-5), then the deletion lifecycle A to E (DL-1a to DL-5, plus DL-4b if BQ-23 is yes). For each slice it lists dependencies, gates, effort and the business questions that must be answered first. Requirement: [BUSINESS_OS_ACCOUNT_DELETION_LIFECYCLE_REQUIREMENT.md](/docs/requirements/BUSINESS_OS_ACCOUNT_DELETION_LIFECYCLE_REQUIREMENT.md) §6, with the SA conditions XC-* and SR-*. The parent's SA review wins where they differ. Each slice is its own PR from `main`, never stacked, at most 2.5 days. Status lives in the coordination file (`C:\Users\Barak\My Projects\AgentsPilot\SELF_SERVICE_EXIT_COORDINATION.md`), not here.

---

## 1. Slices

There is no SX-4. It was v1's deletion slice and is replaced by the DL track.

| # | Slice | Delivers (short) | Depends on | Migration / manual gate | Bold BQs that must be answered first | Effort |
|---|---|---|---|---|---|---|
| **SX-1** | Cancel and keep engine | `StripeService.setBusinessOsPlanCancelAtPeriodEnd`, `planCancellation.ts`, cancel / keep routes, SA-2 eligibility, fresh key (C-4), mirror write, audit, `isPlanSelfCancelEnabled()` off | — | — | none (BQ-11 carried: suggestion = refuse on failed payment) | 🟡 2.5 d |
| **SX-2** | Cancel drawer | `planEndingView` in `lib/business-os/entitlements/` + registrations (XC-19); reason, what changes, review, confirm; en/he/es | SX-1 | — · **PR held without auto-merge until SX-2b merges** (SA Q-9 / R-2) | BQ-20 ✅, BQ-7 ✅, BQ-17 ✅ (answered 2026-10-27) | 🟡 2.5 d |
| **SX-2b** | After-plan move to the free cohort (D3.1 in the coordination file) | Webhook `customer.subscription.deleted` with `cancellation_details.reason = 'cancellation_requested'`; account from our billing row by subscription id; only if still the current subscription; repository + `recordPlanChange`; `afterPlan` config in the entitlements drift snapshot; repeat-cancel tracking (halving rule) | SX-2 (`planEndingView`), P-7a.4 merged | none expected · own coordination row (webhook files are PLAN PAYMENTS') | BQ-20 ✅ | 🟡 ≈ 1.5 d |
| **SX-3** | Cancel emails, switch on | Cancelled / kept / 3-day reminder; R-3 refusal text; P-7a note | SX-2 | — · ops gate: Resend domain + `RESEND_FROM_EMAIL`, support address | BQ-36, open issue 1 / BQ-3 ✅ (answered 2026-10-27) | 🟢 1.5 d |
| **SX-5** | Stripe Connect fixes | C-5 delete only on confirmed deletion, OAuth deauthorize, D-2 via the check, G-8 wording | — | only if needed | BQ-12, BQ-19 | 🟡 2 d |
| **DL-1a** | Closure schema + regen | Table `business_os_account_closures`, claim RPC, session-cut function (spike first), closure + lock repositories, descriptor, regenerated cleanup function, duplicate-prefix guard (SR-7) | — (precondition: 20261092 applied, checker green ✅ 2026-10-25) | ✅ **20261093 + 20261094** (O-1), S-1 regen lock | none | 🟡 2 d |
| **DL-1b** | Request and keep routes | `account/delete` → request route; two-phase write (XC-2); blockers at A (XC-5); keep (A–C); checkout / Boost refusal; mirror C-3; anonymise-import guard (XC-6); audit rows that survive E | DL-1a, SX-1 | — | **BQ-21**, BQ-33, BQ-34, BQ-38 (carried BQ-11, BQ-18) | 🟡 2.5 d |
| **DL-2** | Deletion drawer + keep screens | Drawer with `<DownloadMyDataButton variant="button" />` (SR-9); future-bookings count; banner; plan card; Keep in Settings; `/account-deleted` and privacy paragraph re-worded | DL-1b, SX-2, SX-5; soft: EXPORT MX-3.1 | — | BQ-20 ✅, BQ-32, BQ-35 ✅, **BQ-39** (BQ-7 ✅) | 🟡 2 d |
| **DL-3** | Lifecycle job + emails | Hourly :50 claim-pattern cron; settle `requesting`; start C; `lock_at`; C email, reminder, requested, kept; each exactly once (claim + idempotency key + `*_sent_at`) | DL-1b; S-10 idempotency key (claim it, or reuse EXPORT's) | — | BQ-24 | 🟡 2.5 d |
| **DL-4** | Lock + admin unlock | Blocker re-check at the lock; "closed" email first (SR-8 cap columns); 10-year ban + session cut; banned-login copy; admin Unlock (`requireAdmin`, tombstone refusal) | DL-3 | — · ops gate: support address in the banned-login copy | BQ-22, **BQ-23** (decides DL-4b), **BQ-41** | 🟡 2.5 d |
| **DL-4b** | Website offline at the lock | `isAccountClosedToPublic` at the four XC-14 sites, `siteCache` revalidation, source-scan test | DL-4; only if BQ-23 = yes | — | BQ-23 = yes | 🟢 1.5 d |
| **DL-5** | Ready list, E route, switch on | `/admin/users` ready list; `requireAdmin` E route reading the closure row on the server; new receipt builder in `receiptInput.ts` (SR-1, no key change); `isAccountSelfDeleteEnabled()` on | DL-4 (+ DL-4b), **EXPORT MX-4 merged** | — · ops gate: `DELETION_RECEIPT_FINGERPRINT_KEY` checked (C-12) | **BQ-40** (open issue 2, legal, is now a launch gate before the first real customer, 2026-10-27) | 🟡 2 d |

**Totals:** cancel 10 d (incl. SX-2b 1.5 d) · deletion 13.5 d · DL-4b +1.5 d → **23.5 d, 25 d with DL-4b**.

**Hand-overs (2026-10-27):** `reasonCode` stays optional in D3; the first slice holding the cancel engine after D3 merges (P-7a.4 or D6) makes it required; if P-7a.4 merges before D3 it stays optional (SA Q-1, amends D2 Q-5). "Reactivate" is relabelled "Keep my plan" in D3; the user reviews the he/es copy in the D3 diff.

---

## 2. Order and parallel lanes

```text
Lane 1 (cancel):    SX-1 ──► SX-2 (built, held) ──► SX-2b ──► SX-2 merges ──► SX-3   (plain cancel live)
                                                    ▲ P-7a.4 merged
Lane 2 (deletion):  DL-1a ─┐
                           ├─► DL-1b ──► DL-2 ──► DL-3 ──► DL-4 ──► [DL-4b] ──► DL-5 (switch on)
Lane 1 feeds:       SX-1 ──┘            ▲ SX-2, SX-5                               ▲ EXPORT MX-4 merged
Lane 3:             SX-5 (any time before DL-2)
```

- **Start now:** DL-1a (holds the S-1 lock; EXPORT's MX-1a waits for its release, SR-4) and SX-1, in separate worktrees. They share only add-only registries.
- **DL-1a releases the regen lock** only after merge + apply + checker (SR-5). Release promptly: EXPORT has about 5 working days of slack before MX-1a needs it.
- **Deletion goes live last:** DL-5's switch waits for EXPORT MX-4 to merge (the export switch is removed in MX-3.1, 2026-10-27), because stage C promises export (B.4).

---

## 3. Gates

| Gate | Slices | Rule |
|---|---|---|
| Manual prod migration | DL-1a (SX-5 only if it needs one) | SR-5 pre-apply check → apply → checker → enqueue at once → live check → release the lock. Never auto-merge a migration-gated PR |
| Cleanup-regen lock (S-1) | DL-1a | One regeneration at a time, order DL-1a → MX-1a → MX-7 |
| User sees the diff before commit | every slice | Standing rule unless the user agrees a fast-track for this stream |
| Ops (not builds) | SX-3, DL-4, DL-5 | Resend domain verified + `RESEND_FROM_EMAIL`; support address `notifications@agentspilot.ai`; fingerprint key checked |
| Cross-scope | DL-2 (soft), DL-5 (hard) | MX-3.1 for the drawer link (soft); MX-4 merged before DL-5's switch |
| Legal | Launch, before the first real customer (not a DL-5 switch-on gate, user decision 2026-10-27) | Open issue 2 (files left out of the export; privacy paragraph) |

---

## 4. Business questions by slice

| Needed before | BQs |
|---|---|
| SX-2 | BQ-20, BQ-7, BQ-17 (all answered 2026-10-27) |
| SX-2b | BQ-20 (answered 2026-10-27) |
| SX-3 | BQ-36, open issue 1 / BQ-3 (answered 2026-10-27: `notifications@agentspilot.ai`) |
| SX-5 | BQ-12, BQ-19 |
| DL-1a | **none** |
| DL-1b | BQ-21, BQ-33, BQ-34, BQ-38 (BQ-11, BQ-18 carried) |
| DL-2 | BQ-20 ✅, BQ-32, BQ-35 ✅, BQ-39 |
| DL-3 | BQ-24 (SA ruling XC-4 is the suggestion) |
| DL-4 | BQ-22, BQ-23, BQ-41 |
| DL-5 | BQ-40 |
| Launch (first real customer) | Open issue 2 (legal; moved off DL-5 switch-on, 2026-10-27) |
| Any switch-on | BQ-9, BQ-15 (copy states the configured rule) |

---

## Change History

| Date | Change | Details |
|---|---|---|
| 2026-10-25 | Created (Dev) | Slice order, lanes, gates and BQ map from the DELETE requirement §6 and the SA split review; DL-1a numbering proposal O-1 (20261093 schema, 20261094 regeneration) |
| 2026-10-27 | User decisions + SX-2b (BA) | BQ-7, BQ-17, BQ-20, BQ-35 marked answered. New slice SX-2b (D3.1, ≈ 1.5 d) in §1 and the lane diagram: the webhook write to the free cohort, after SX-2 is built and P-7a.4 merged; SX-2's PR held without auto-merge until SX-2b merges. §4 gains an SX-2b row. `reasonCode` and "Keep my plan" hand-overs noted. Totals 23.5 d / 25 d |
| 2026-10-27 | EXPORT re-cut synced (TL) | MX-3.1 added (export switch + ZIP removed), MX-6 folded: DL-5 depends on EXPORT MX-4 merged (§1, lane diagram, §2, §3 gates); DL-2's soft dependency MX-1b → MX-3.1. Open issue 1 / BQ-3 answered (`notifications@agentspilot.ai`, Resend ops check stays); open issue 2 (legal) moved from DL-5 switch-on to a launch gate before the first real customer (§1 DL-5, §3 Legal, §4) |
