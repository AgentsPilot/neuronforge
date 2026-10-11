# Retrospective: Business OS Finance & Business Health — Slice 1b

> **Last Updated**: 2026-10-11

## Overview

Retrospective for slice 1b of the read-only admin page `/admin/finance`: **Section 4 (Credits)**, tiles **K-2** (accounts far over allowance) and **K-4** (gifted credits outstanding), the new named all-accounts lot read **R-b** `listLotsWithDrawsAllAccounts`, and the **SA-Q7 refactor** of `adminCreditPercent.ts` (one core, two projections), with the Businesses list's "Credits left" column unchanged. The slice has no migration, no SQL function, no write, no LLM call and no audit entry. It ran: Dev workplan, SA workplan review, BA requirement edits E-5 to E-7, implementation, SA code review, QA, fix round 1, and the user's diff review. The user approved the diff on 2026-10-11. Commit and PR are next (RM).

**This completes slice 1 (1a + 1b)**: the page now shows everything that has real rows today (accounts, AI cost, credits). Slice 1a merged as PR [#284](https://github.com/AgentsPilot/neuronforge/pull/284). **The next slices depend on data.** Slice 2 (business takings and client payment problems, grouped per currency, with the CUR-1 / CUR-2 helper and AC-13) has real rows today, but its workplan must first measure the live `processor_type` / `charge_account_kind` values (SA-Q9). Slices 3 to 7 wait on invite volume, boost checkout opening, or plan-payments work (requirement §0.1).

**MD links:** [BUSINESS_OS_FINANCE_HEALTH_REQUIREMENT.md](/docs/requirements/BUSINESS_OS_FINANCE_HEALTH_REQUIREMENT.md) | [BUSINESS_OS_FINANCE_HEALTH_SLICE_1B_WORKPLAN.md](/docs/workplans/BUSINESS_OS_FINANCE_HEALTH_SLICE_1B_WORKPLAN.md) | [Slice 1a retrospective](/docs/retrospectives/BUSINESS_OS_FINANCE_HEALTH_SLICE_1A_RETROSPECTIVE.md)

---

## What went well

- **The workplan found the requirement's gap before code.** SA-W9: `user_id` on lots and draws is `ON DELETE SET NULL`, so SQL check 5 would have counted deleted accounts' grants as "outstanding" credits nobody can use. SA ruled to leave them out of K-4, show them as their own figure, and edit check 5 (E-5). The page and the SQL now agree by construction.
- **SA caught a false green at workplan review (SA-WR-8).** When one account is Unknown, "0 far over" is a lower bound, so K-2 must never show green "All clear". This was fixed in the design, not found in testing.
- **The SA-Q7 refactor was proven, not asserted.** `git diff --exit-code` on the Businesses list's tests exited 0 (byte-identical, 409 tests passing), and the new parity test compares through the public `creditPercentLeft`, so it cannot mirror its own maths (SA-WR-12).
- **Security held.** R-b is a named, no-argument, all-accounts read that errors at its 1,000-row ceiling and never returns a partial list. With a business picked, every read gets exactly that id and R-b gets zero calls (AC-42). Admin-written text on lots and draws (`reason`, keys, `sourceRef`) is dropped field by field in the wiring, pinned by a planted-reason test (SA-W14).
- **The code review and QA passed on the first try.** SA approved with no blocking finding and two optional Low notes. QA gave PASS WITH ISSUES with no bug. Every 1b AC that Jest can test passes: 598 finance tests after fix round 1, `test:bos-entitlements` at 6,074, the authz guard at 203, Health and the sidebar nav unchanged at 274. The scoped `tsc` canary was run by both Dev and QA (AC-44).
- **Fix round 1 was narrow by choice.** SA note 2 and QA note 2 (a throw in the positions pass would turn the route into a 500) were fixed on the finance side only. Moving `resolveAccountId` inside the shared runner would have changed the Businesses list's behaviour on a throw, so `adminCreditPercent.ts` was left untouched and the list stays byte-identical. A negative control proved the new test bites.
- **Slice 1a lessons were applied.** See the comparison table below.

## What did not go well

- Number of Dev ↔ SA back-and-forths: **0 rejections.** The workplan was approved with conditions (SA-WR-8 to SA-WR-13); the code was approved first time.
- Number of Dev ↔ QA bug fix cycles: **0 bug cycles.** One fix round for a Low robustness note (SA note 2 / QA note 2), with no QA re-run required.
- Any blocked handshake and why: none was blocked.
- **The requirement still missed a schema fact (SA-W9).** Check 5 was written and SA-cleared without testing it against `ON DELETE SET NULL`. The workplan caught it, as with SA-W1 / SA-W2 in 1a: one stage later than ideal.
- **Whole-file rewrites continue.** The BA applied E-5 to E-7 as a whole-file rewrite again (it has no Edit tool), and TL's status edit in this step is a whole-file rewrite too. The line-count and `git diff --stat` check found nothing wrong (+14 / −6), but the structural risk from 1a lesson 1 is unchanged.
- **The manual QA backlog has grown.** The user now owes L-1 to L-13 (1a, already merged) and L-14 to L-22 (1b). AC-11 and AC-32 rest on them, and so does `durationMs` with Section 4 on.
- **Two product calls were left to the user rather than resolved:** a literal zero allowance shows "Unknown" (and counts towards K-2's "could not be read"), matching the Businesses list; and `metricParams?: unknown` is a test hook on the production deps type.

### Slice 1a follow-ups and lessons: what happened in 1b

| 1a item | 1b outcome |
|---|---|
| Lesson 1: after any whole-file rewrite, check the line count and `git diff --stat` | ✅ Applied to the BA's E-5..E-7 rewrite (+14 / −6, intact) and to TL's edit here. The root cause (no Edit tool for BA) is not fixed |
| Lesson 2: test each scoping rule against each mode at requirement review | 🟡 Partly. No SA-W1-type contradiction this time (AC-42 re-ran cleanly), but SA-W9 was a schema-mode gap found at workplan stage |
| Lesson 4: one owner for requirement upkeep | ✅ Applied. The BA owned the requirement edits (Dev deviation D-5); TL owns the §0 status edits |
| Lesson 5: an AC that matches SQL depends on the SQL at test time | ✅ Applied. AC-11 compares with check 5 as edited, through an independent `checkFive` helper |
| FU-1: manual QA L-1..L-13 | ⬜ Still owed |
| FU-3: slice 1b | ✅ Done (this slice) |
| FU-4: shared ledger read for Section 3 and K-1 | ⬜ Still parked |
| FU-5: record `durationMs` | ⬜ Still owed, now with Section 4 on (L-22) |
| FU-6: the requirement's header Status line is stale | ⬜ Still open (line 7 still describes slice 1a) |

## Conclusions & process improvements

1. **Add a schema-referential check to the requirement review.** For every figure that reads a table with nullable or `ON DELETE SET NULL` foreign keys, ask "what does a deleted or orphaned row do to this figure, on the page and in the SQL check?" This would have caught SA-W9 one stage earlier.
2. **Give the BA an Edit tool (carried over from 1a).** Two slices in a row, the requirement was rewritten whole to change a few lines. The check-after rule works, but it is a mitigation.
3. **Close the manual QA backlog before slice 2 starts.** Merged code whose SQL cross-checks have never been run is a growing liability; L-1 to L-22 should be one sitting for the user.
4. **Keep the "byte-identical tests" proof for any shared-core refactor.** `git diff --exit-code` on the other caller's tests plus a parity test through the public function was cheap and conclusive.
5. **Fix robustness findings on the caller's side when the shared code has another caller.** Fix round 1 showed the trade-off clearly; record the reason in the workplan, as Dev did.

## Follow-ups

| # | Item | Owner | Status |
|---|---|---|---|
| FU-1b-1 | Manual QA steps L-14 to L-22 (workplan QA report), which close AC-11 and AC-32 (1b), plus the 1a steps L-1 to L-13 | User | ⬜ Owed |
| FU-1b-2 | RM: commit, push and open the PR for `feature/bos-finance-health-1b`; record the commit in the workplan's Commit Info and in requirement §0.1 | RM / TL | ⬜ Next |
| FU-1b-3 | Product call: should a literal zero allowance show "No allowance" instead of "Unknown" (here and in the Businesses list)? | User | ⬜ Surfaced, left as-is |
| FU-1b-4 | Optional SA note 1: type `metricParams` on the deps as `typeof FINANCE_METRIC_PARAMS \| unknown` with a comment | Dev (later slice) | ⬜ Surfaced, left as-is |
| FU-1b-5 | QA note 2: `resolveAccountId` runs outside the shared runner's `try` in `adminCreditPercent.ts`. Unreachable today (identity); the finance side is protected by fix round 1 | Dev (if the seam changes) | ⬜ Parked |
| FU-1b-6 | Requirement header Status line (1a FU-6) | BA | ⬜ Open |
| FU-1b-7 | Slice 2: business takings and client payment problems, per currency; workplan measures SA-Q9 with the `business-os-schema-check` skill first | BA → SA → Dev | ⬜ After 1b merges |
| FU-4 | Shared ledger read for Section 3 and K-1 (from 1a) | Dev (later slice) | ⬜ Parked |

### Status: APPROVED BY USER — UNCOMMITTED — `feature/bos-finance-health-1b` — commit pending (RM)

---

## Change History

| Date | Change | Details |
|---|---|---|
| 2026-10-11 | Created (TL) | Slice 1b retrospective after the user approved the diff. Records the cycle counts, the comparison with slice 1a's lessons and follow-ups, the two items left to the user, and the owed manual steps L-1 to L-22. Notes that slice 1 (1a + 1b) is complete and that slice 2 depends on data. Commit pending (RM). |
