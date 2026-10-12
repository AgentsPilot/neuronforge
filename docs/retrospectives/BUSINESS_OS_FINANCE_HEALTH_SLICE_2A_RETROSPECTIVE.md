# Retrospective: Business OS Finance & Business Health — Slice 2a (Takings)

> **Last Updated**: 2026-10-12

## Overview

This is the retrospective for slice 2a of the read-only admin page `/admin/finance`. The slice adds **Section 2 block B, "Takings through the platform"**: what clients paid the businesses through AgentPilot, per currency. It shows:

- gross, refunded and net of refunds per currency;
- refunds dated by `created_at`;
- recorded processor fees, grouped by **fee currency** and never deducted;
- payments by processor and the number of businesses with takings;
- a per-business table capped at 200 rows.

The block carries a "Not our revenue" chip (BD-1). Slice 2a also builds the currency-grouping helper `currencyGroups.ts` (CUR-1, CUR-2, AC-13), which slice 1 deferred (DF-1). It adds the four named layer-B reads **R-e, R-e′, R-f and R-f′** to `BusinessOsFinanceReadRepository`. It has no migration, no SQL function, no write, no LLM call, no audit entry and no new query parameter.

The cycle ran in this order:

1. Live check.
2. User decision BD-13.
3. SA requirement review, with rework.
4. Dev workplan.
5. SA workplan review.
6. Requirement edits E-8 to E-10.
7. Implementation.
8. SA code review.
9. QA.
10. Fix round 1.
11. TL wording alignment.
12. The user's diff review.

The user approved the diff on 2026-10-12. Commit and PR are next (RM).

**MD links:** [BUSINESS_OS_FINANCE_HEALTH_REQUIREMENT.md](/docs/requirements/BUSINESS_OS_FINANCE_HEALTH_REQUIREMENT.md) | [BUSINESS_OS_FINANCE_HEALTH_SLICE_2A_WORKPLAN.md](/docs/workplans/BUSINESS_OS_FINANCE_HEALTH_SLICE_2A_WORKPLAN.md) | [Slice 2 live check](/docs/requirements/BUSINESS_OS_FINANCE_HEALTH_SLICE2_LIVE_CHECK.md) | [Slice 1b retrospective](/docs/retrospectives/BUSINESS_OS_FINANCE_HEALTH_SLICE_1B_RETROSPECTIVE.md)

---

## What went well

- **The live check came before the requirement was settled, and it changed the design.** It found four things before any code was written:
  - layer B has **no `livemode` column**, and Stripe ids do not encode the mode;
  - all 71 Stripe rows are almost certainly test data;
  - **failed charges are never stored** (`failure_reason` is set on 0 rows);
  - `fee_currency` is USD even on ILS charges, so fees must be grouped by fee currency.

  That turned SA-Q9 into a business question with real numbers behind it. The user took **BD-13, option A**: build now and treat all data as real. The decision was made in business terms and was not raised as a technical fork.
- **SA requirement review caught a guard collision before any code.** The finance source guard forbids `payment_transactions|payment_refunds|payment_plan_` in every finance file, so the new reads would have tripped it. SA ruled the narrowing plus a **positive table pin** (S2-F1). At workplan review, SA-WR-16 made the pin airtight: the count of `.from(` calls must equal the count of literal matches, so a `.from(TABLE)` cannot slip past.
- **The workplan surfaced three real requirement gaps (SA-W18 to SA-W20) before code.**
  - **SA-W18:** "counted" payments did not match SQL check 7, which counted every status.
  - **SA-W19:** a refund-only currency or business had no line and no row.
  - **SA-W20:** the requirement did not say what an unreadable amount does to net.

  SA ruled on all three, and SA-WR-14 corrected Dev's own SA-W20 cell. E-8 to E-10 made the page and the SQL agree by construction.
- **D-1 was proven, not just accepted.** Dev measured that a flat `1e-6` tolerance would wrongly mark about 12% of valid `NUMERIC(12,2)` values up to 1e10 as unreadable. SA proved the widened tolerance `max(1e-6, abs(n·100)·4ε)`:
  - it bounds the rounding error with a 4× margin;
  - it is still the flat `1e-6` below about 1.1e9 hundredths;
  - it still catches a third decimal at the column maximum.

  T2 pins `12.345`, `9999999999.995`, a 1e10 value and `0.1 + 0.2`.
- **Money integrity is built into the structure:**
  - integer hundredths, divided by 100 once;
  - no export that totals across currencies (the export list is pinned);
  - net is never a lower bound minus a figure;
  - the page never adds or subtracts money (a source rule with planted controls);
  - `formatMoney` always prints exactly two decimals.
- **Security held.** All four reads are named pairs. The UUID is refused before any query, and `.eq('user_id')` is applied on every page. With a business picked, R-e and R-f get zero calls and names come only from rows already read (AC-65, tested in the builder and through the route). The column lists exclude `contact_id` and `metadata`, and the logs carry counts and booleans only (AC-69).
- **Nothing outside the slice moved.** These were run with `git diff --exit-code` and all exited 0:
  - the three Stripe placement guards;
  - the payment write-lockdown scan;
  - `adminReadMethods`;
  - the layout folder guard;
  - the Businesses list.

  The one-caller pin stayed byte-identical because `takings.ts` declares its own structural input types (SA-W22).
- **Code review and QA passed on the first try.** SA APPROVED with two optional Low notes. QA reported PASS WITH ISSUES with **no bug**. Fix round 1 fixed three Low notes (QA-2, SA-1, SA-2 / QA-3), each with a test. After fix round 1:
  - finance suites: 840 tests;
  - `test:bos-entitlements`: 6,638;
  - `test:authz-guard`: 203;
  - scoped `tsc`: the canary was caught, and touched files had 0 errors.
- **The TL aligned S2-CUR-3 with D-1** before the user's review, which closed QA note 1. The requirement and the code no longer disagree on the tolerance.

## What did not go well

- Number of Dev ↔ SA back-and-forths: **0 rejections.** The requirement needed rework before code (the S2-F1 guard collision). The workplan was approved with conditions (SA-WR-14 to SA-WR-19), and the code was approved the first time.
- Number of Dev ↔ QA bug fix cycles: **0 bug cycles.** One fix round for three Low notes, with no QA re-run required.
- Any blocked handshake and why: **the requirement edits E-8 to E-10 were blocked at the BA.** The BA has no Edit tool, and the requirement is 1,429 lines long. Rather than risk a truncating whole-file rewrite, the BA **refused**. An Edit-capable general-purpose agent applied the three edits instead. The outcome was right, but the root cause has now been flagged in **three slices in a row** (1a lesson 1, 1b lesson 2), and this time it stopped the flow.
- **The requirement again missed facts that the workplan had to catch.** SA-W18 to SA-W20 are the same kind of gap as SA-W9 in 1b: SQL checks and figure rules that were never compared with each other or tested against edge rows. All three were caught before code, but one stage later than ideal. The S2-F1 guard collision was only caught at SA requirement review, after the BA draft.
- **The data under the block is mostly not real.** Because of BD-13, the page shows Stripe test payments as real takings. There is no `livemode` column in layer B, and failed charges are never stored, so the block cannot show failed client payments yet (S2-FR-10 lists it as "shown in a later update"). This was an informed choice, but it means L-24 to L-27 check the arithmetic, not real business takings.
- **`schema:check` could not run.** The worktree has no credentials, so the columns rest on the live check's OpenAPI read (SA-W27, V-10). The script also cannot see selects that pass exported column constants.
- **The manual QA backlog keeps growing.** The user now owes **L-1 to L-31**:
  - L-1 to L-13 (1a, merged);
  - L-14 to L-22 (1b, merged);
  - L-23 to L-31 (2a).

  AC-47 and AC-73 (2a) rest on L-23 to L-31, and so do SQL checks 7 to 9 and `durationMs` with takings on. 1b's lesson 3 ("close the backlog before slice 2") was not acted on.

### Slice 1b lessons and follow-ups: what happened in 2a

| 1b item | 2a outcome |
|---|---|
| Lesson 1: a schema-referential check at requirement review | 🟡 Partly. The live check ran first and found the schema facts (no `livemode`, fee currency, nullable `processor_type`). The figure-versus-SQL-check gaps (SA-W18 to SA-W20) still surfaced at the workplan stage |
| Lesson 2: give the BA an Edit tool | ⬜ Not done, and this time it **blocked** the flow (E-8 to E-10). Worked around with an Edit-capable general-purpose agent. Now recorded as a memory and process lesson |
| Lesson 3: close the manual QA backlog before slice 2 | ⬜ Not done. The backlog is now L-1 to L-31 |
| Lesson 4: keep "byte-identical tests" proofs for shared code | ✅ Applied. The Businesses list, the Stripe guards and the other guards all exited 0 on `git diff --exit-code` |
| Lesson 5: fix on the caller's side when shared code has another caller | ✅ Applied. `takings.ts` uses structural types instead of editing the one-caller pin; `FinanceSection` gained an optional prop, and existing sections render unchanged DOM |
| FU-1b-3 / FU-1b-4: zero allowance and the `metricParams` typing | ⬜ Unchanged, still with the user or a later slice |
| FU-1b-6: the requirement's header Status line | ⬜ Owned by TL / BA; the status update for this slice is being made separately |

## Conclusions & process improvements

1. **Edit-capable requirement upkeep is now a process rule, not a suggestion.** After three slices, a BA without an Edit tool cannot safely maintain a requirement this large. Until the BA has an Edit tool, route requirement edits to an Edit-capable agent from the start, with the BA's wording, rather than waiting for the BA to refuse. Keep the `git diff --stat` and line-count check after every edit.
2. **Cross-check every figure against its SQL check at requirement review.** For each figure that has a §13 check, compare three things: the status filter, the distinct key and the date column. Also ask what a row present on only one side (a refund with no payment in the window) does to the figure. That would have moved SA-W18 and SA-W19 one stage earlier.
3. **Run the live check before the requirement, not after it.** For 2a this worked well: BD-13 was decided on measured facts. Make it the default for any slice that reads a new table.
4. **List the source guards a new read will meet when the requirement is drafted.** The S2-F1 collision was predictable from `finance.source.guard.test.ts:86-88`. The BA (or the schema-check step) should list every guard that names the new tables.
5. **Measure numeric tolerances, do not assume them.** D-1 showed that a tolerance which looked safe fails on about 12% of valid values at the column maximum. Any future money-scale rule should be tested at the column's declared precision.
6. **Schedule the manual QA sitting.** L-1 to L-31 should be one sitting for the user before slice 2b reaches code review. Each slice adds about nine steps.

## Follow-ups

| # | Item | Owner | Status |
|---|---|---|---|
| FU-2a-1 | Manual QA L-23 to L-31 (workplan QA report), which closes AC-47 and AC-73 (2a) and runs §13 SQL checks 7 to 9, plus the owed L-1 to L-22 from 1a and 1b. Record `durationMs` for All businesses and for one business (target p95 under 2 s, SA-Q17) | User | ⬜ Owed |
| FU-2a-2 | RM: commit, push and open the PR for `feature/bos-finance-health-2`; record the commit in the workplan's Commit Info and in requirement §0.1 | RM / TL | ⬜ Next (user approved 2026-10-12) |
| FU-2a-3 | **Slice 2b:** Section 6 block B (client payment problems: R-g to R-i′, the reminder read R-j reusing `ADMIN_QUEUE_SPECS.payment_reminders`) and `formatUtcDate` (full cycle, R-7) | BA → SA → Dev | ⬜ Next slice |
| FU-2a-4 | **AI-cost overlap review: open questions.** The review of the three admin pages showing AI cost (Finance, AI cost & usage, Business OS AI) is in `docs/requirements/ADMIN_AI_COST_PAGES_OVERLAP_REVIEW.md` on branch `docs/admin-ai-cost-overlap-review`. Open with the user: BQ-1 keep the agent-platform scope on AI cost & usage; BQ-2 which figure decides pricing and margin (proposed: charged cost on Finance); BQ-3 show uncharged cost on Finance; BQ-4 rename the Health tile "Recorded AI cost"; BQ-5 reword three sidebar descriptions. Time-sensitive: layout step L-8 deletes the audit-trail `BusinessAccountPicker` that `FinanceFilterBar.tsx` imports, so the Finance page must move to the shared picker (overlap slice OV-2) before L-8 lands. CUR-5 (AI cost through the currency helper) applies from slice 6 (margin); Section 3 is unchanged in 2a (SA-W25) | BA → SA | ⬜ Open |
| FU-2a-5 | **DF-3:** filtering test businesses or test payments out of the figures. Today BD-13 treats all layer-B data as real | BA → user | ⬜ Deferred |
| FU-2a-6 | **DF-4:** migrate the finance page shell to the shared admin layout. 2a used the shared parts but not the shell | Dev (admin-layout slices) | ⬜ Deferred |
| FU-2a-7 | **Layer-B mode and failed charges.** Live check §2 options: (a) a `livemode` column written by the webhook plus a backfill, or (b) a deploy-level test-mode banner. Separately, failed client charges are never stored, so the "failed client payments" figure has no source (S2-FR-10) | BA → SA (with plan-payments) | ⬜ Open |
| FU-2a-8 | Give the BA an Edit tool, or formally route requirement edits to an Edit-capable agent (conclusion 1) | User / TL | ⬜ Open |
| FU-2a-9 | Run `npm run schema:check` from a checkout with credentials for the 2a selects, or extend it to read exported column constants (SA-W27) | Dev / QA | ⬜ Open |
| FU-1b-3, FU-1b-4, FU-4 | Carried from slice 1 (zero allowance wording, `metricParams` typing, shared ledger read) | As before | ⬜ Unchanged |

### Status: APPROVED BY USER — commit pending (RM) — `feature/bos-finance-health-2`

---

## Change History

| Date | Change | Details |
|---|---|---|
| 2026-10-12 | Created (TL) | Slice 2a retrospective after the user approved the diff. Records the live check and BD-13, the S2-F1 rework before code, the requirement gaps SA-W18 to SA-W20, the BA's refusal of E-8 to E-10 (applied by an Edit-capable agent), D-1's proof, the cycle counts (0 rejections, 0 bug cycles, one fix round of three Low notes), a comparison with 1b's lessons, and follow-ups (2b, the AI-cost overlap questions, DF-3, DF-4, layer-B mode). Commit pending (RM). |
