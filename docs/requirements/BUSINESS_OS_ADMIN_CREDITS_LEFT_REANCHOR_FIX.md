# Requirement: Admin "Credits left" wrong after a credit period is restarted (re-anchor fix)

> **Last Updated**: 2026-10-12

**Created by:** BA
**Date:** 2026-10-12
**Status:** Draft
**Type:** Bug fix

## Overview

When a plan payment (or an admin tier change) restarts an account's credit period mid-cycle, the admin screens keep reading the **old** period's usage as if it were current. The owner's Credits card is correct; the admin figures are not. This note requires every admin credit figure to agree with the owner's card for the same account at the same moment. Restarting the period is intended behaviour (SA-P2 / PF-13 in [BUSINESS_OS_PLAN_PAYMENTS_REQUIREMENT.md](/docs/requirements/BUSINESS_OS_PLAN_PAYMENTS_REQUIREMENT.md)) and is not changed here.

---

## Reproduction (2026-10-12, Stripe test mode)

| Item | Value |
|---|---|
| Account | `5f63adbd-7297-4e93-b0c7-b12cc2198e85` (champion) |
| Anchor before payment | `2026-10-04T15:15:01Z` |
| Credit totals rows | one row, `period_start` 2026-10-04 15:15:01, `credits_total` about 20,276 |
| Action | Paid Essentials (`basic`); P-3b.2 set `period_anchor` to the billing date |
| Anchor after payment | `2026-10-12T18:21:50Z` |
| Owner's Credits card | 100% left (correct: new period, no usage yet) |
| `/admin/users` "Credits left" | 0% (wrong) |

## Root Cause (verified)

`computePositions` in `lib/business-os/credits/adminCreditPercent.ts` picks the "current" monthly row with `isCurrentPeriodRow(anchor, row.period_start, now)` from `lib/business-os/credits/creditPeriod.ts`. That rule works out the next period start from the anchor's day **and the row's month**. With anchor 2026-10-12T18:21:50Z and a row starting 2026-10-04 it returns 2026-11-12, so the old row looks current. The rule assumes every row starts on a boundary of the **current** anchor, which stops being true once the anchor moves.

The owner's card instead resolves the period with the DB function `business_os_credit_period_start(anchor, now)` and reads the row with that exact key. That is the behaviour the admin readers need to match.

## Affected Readers

| Reader | Where | Status |
|---|---|---|
| "Credits left" column | `/admin/users` via `readAdminCreditsLeft` | Affected |
| Finance page credits section (over-allowance counts) | `/api/admin/business-os/finance` via `readAdminCreditPositions` | Affected |
| Per-account admin credits block | `GET /api/admin/business-os/credits/accounts/<id>` (uses owner's `readCreditPosition`) | Believed correct, **to be verified** |

Same trigger: an admin `assign_tier` that resets the anchor (PF-13).

---

## User Stories

- As a platform admin, I want "Credits left" to show what the business owner sees, so that I don't act on a wrong balance (for example granting credits to someone who has a full allowance).
- As a platform admin, I want finance over-allowance counts to reflect only the current period, so that a restarted period does not inflate them.

## Functional Requirements

1. Every admin credit figure (percent left, used, over-allowance) must equal what the owner's Credits card shows for the same account at the same moment.
2. Usage from a period that ended because the period was restarted must never count toward the new period.
3. When no row exists yet for the newly started period, the account reads as nothing used (100% left), the same as the owner's card.
4. Accounts whose anchor has not moved must behave exactly as today.
5. Trial accounts (usage summed from the anchor) are out of scope unless the fix is found to affect them; if it does, the same agreement rule (FR-1) applies.

## Non-Functional Requirements

- Performance: no extra per-account round trips on the `/admin/users` list beyond what exists today (SA to confirm the approach).
- Security: no change to admin gating or tenant scoping.
- No UI change, no migration, no new pattern expected. If the fix needs any of these, SA must rule first (CLAUDE.md rule 7).

## Acceptance Criteria

- [ ] Regression test with exactly the reproduction dates: anchor `2026-10-12T18:21:50Z`, one row with `period_start` 2026-10-04 15:15:01 and usage about 20,276; at a `now` after the new anchor the result is **100% left, used 0**. The old row must not count.
- [ ] Test: a normal, unmoved anchor still selects its current row and returns the correct percent.
- [ ] Test: finance positions (`readAdminCreditPositions`) agree with the `/admin/users` figure for the re-anchored case, and the account is not counted as over allowance.
- [ ] Per-account admin credits block verified for the re-anchored account (agrees with the owner card); if it does not, it is fixed in this slice.
- [ ] Manual check on the test account: `/admin/users` "Credits left" equals the owner's Credits card.

## Out of Scope / Future Roadmap

- Changing the re-anchoring rule itself (SA-P2 / PF-13 stand).
- Any change to how the owner's Credits card computes its figure.
- Cleaning up or archiving old-period credit totals rows.
- Follow-up (SA W-1): fold `creditLeakCheck.addMonthsUtc` / `creditPeriodStartAt` onto `currentPeriodStartMs` in its own small slice, with the leak-check `it.each` as the regression net. Until then a test-only parity table keeps the two TS copies in agreement.

## Open Questions

- [ ] Should the admin readers call the same period resolution the owner card uses (`business_os_credit_period_start`), or a TypeScript twin of it? (raised by: BA | status: open, for SA) Suggested resolution: reuse the owner's resolution so the two cannot drift; SA decides the mechanism.
- [ ] Is `isCurrentPeriodRow` used anywhere else that could show the same fault? (raised by: BA | status: open, for Dev/SA) Suggested resolution: Dev lists every caller in the workplan; any caller with the same fault is in scope.

## Notes on Integration Points

- `lib/business-os/credits/adminCreditPercent.ts` (`computePositions`, `readAdminCreditsLeft`, `readAdminCreditPositions`)
- `lib/business-os/credits/creditPeriod.ts` (`isCurrentPeriodRow`)
- DB: `business_os_account_plans.period_anchor`, `business_os_credit_totals`, function `business_os_credit_period_start`
- Triggers: P-3b.2 first-payment re-anchor; admin `assign_tier` (PF-13)

---

## SA Requirement Review

**Reviewed by SA — 2026-10-12**
**Verdict:** APPROVED WITH CONDITIONS

### Findings against the SQL (`20261015_business_os_credit_charges.sql`, `20261028_business_os_first_payment_stamp.sql`)

| # | Question | Finding |
|---|---|---|
| a | Can the re-anchor land EARLIER than an old-anchor row's `period_start`? | **Yes.** P-3b.2 writes `period_anchor = p_billing_cycle_anchor`, which is Stripe's `billing_cycle_anchor` (`planPaymentApply.ts` → `isoFromUnix`): the subscription's creation second, always **before** the webhook is processed, and Stripe retries can delay that by hours or days. If an old-anchor boundary falls between the Stripe anchor and the webhook (e.g. old boundary 11-04 15:15, Stripe anchor 11-04 15:14, webhook 11-04 15:20, a charge at 15:16), the recorder writes a row keyed 11-04 15:15 under the old anchor. That row is `>= anchor`, and `isCurrentPeriodRow` calls it current. The owner card reads key 11-04 15:14 and shows zero. **The TL's `>= anchor` guard is not sufficient.** |
| b | Does `business_os_credit_period_start` return a start before the anchor? | **Yes, when `at < anchor`.** The months difference is <= 0, the candidate is after `at`, and the function steps back one month, giving `anchor - 1 month`. The recorder writes rows at that key, and the owner card reads it. A `>= anchor` guard would drop those rows and disagree with the card (a future-dated anchor is unlikely today, but the rule must not depend on that). |
| c | Other row-selectors with the same fault | `isCurrentPeriodRow` has **one** caller: `adminCreditPercent.ts:232`, which feeds both `readAdminCreditsLeft` and `readAdminCreditPositions`, so finance is fixed by the same change. `creditLowLine` reads the charge's own key; `ownerCreditUsage` / `readCreditPosition` read the exact DB key. Neither is affected. `creditLeakCheck.creditPeriodStartAt` already has a TS twin of the period function (labels, ms) and is outside this fault. |
| d | Per-account admin block | **Correct.** `[accountId]/route.ts` → `readCreditPosition` → `resolveCreditPeriod` → `periodStartFor` (DB function via `adminCreditPositionDeps.ts`) → `findTotalsForPeriod(exact key)`. That is the owner card's path. AC-4 is met by a test, with no code change. |
| — | 32-day lookback | Unaffected. The current key is <= now and > now − 31 days (one period is at most 31 days; this also holds in case b), and the day-floored `from` keeps it in range. |

### Ruling on the approach (answers both open questions)

1. **Keep the batched pass (SQ-42).** Do not add a per-account RPC, and do not add a new batched SQL function (that would be a migration and a new pattern, and it is not needed).
2. **Replace the selector's rule with exact-key equality.** A row is current only if `displayInstantMs(row.period_start) === ms(expectedKey)`, where `expectedKey` is a TS mirror of `business_os_credit_period_start(anchor, now)`: same months difference, Postgres clamped month addition (`addMonthsClampedUtc`), and the same "candidate > at → step back one month" step. This is the only rule that agrees with the card in cases a and b, and it is unchanged for an unmoved anchor.
3. **Millisecond equality is safe.** A month interval keeps the anchor's time of day, microseconds included, so every key under an anchor shares that anchor's sub-ms digits and both sides truncate the same way. Two distinct keys for one account cannot fall within the same millisecond.
4. **One mirror only.** Put the function in `creditPeriod.ts` (display maths, never a filter key; the existing source guard still applies) and let `creditLeakCheck.creditPeriodStartAt` reuse it, or record in the workplan why it does not. Do not add a third copy.

### Conditions

- C-1: Tests: the reproduction (100% left, used 0); an unmoved anchor; case a (an old-anchor row keyed after a backdated new anchor is excluded); case b (`now < anchor` selects the `anchor - 1 month` row); an anchor on the 31st across February; finance agreeing with the list.
- C-2: A parity test pinning the TS mirror to the SQL function's body (the existing source-pin style), so the two cannot drift.
- C-3: Sub-ms edge (Low): when `now` equals the candidate at the millisecond and the anchor has sub-ms digits, SQL steps back and the TS mirror would not. Either handle it, or document it as an accepted 1 ms window.
- C-4: Update the `isCurrentPeriodRow` doc comment and the module header of `adminCreditPercent.ts`. The header must no longer say the selector mirrors the reset-date maths.

---

## Change History

| Date | Change | Details |
|---|---|---|
| 2026-10-12 | Created | BA bug-fix note from user report reproduced on test account `5f63adbd…`; root cause verified in `computePositions` / `isCurrentPeriodRow` |
| 2026-10-12 | SA requirement review | APPROVED WITH CONDITIONS: exact-key equality against a TS mirror of `business_os_credit_period_start` (the `>= anchor` guard is not enough, because Stripe anchors are backdated); per-account block verified correct |
