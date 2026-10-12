# Retrospective: Business OS Finance & Business Health — Slice 2b (Client payment problems)

> **Last Updated**: 2026-10-12

## Overview

This is the retrospective for slice 2b of the read-only admin page `/admin/finance`. The slice adds **Section 6 block B, "Client payment problems"**: where the businesses' clients are not paying. The block carries the chip "The businesses' problem, not ours" (BD-2) and has five parts, each with its own status:

1. **Failed client payments:** a fixed "not available" panel with no read behind it, never a 0.
2. **Overdue invoices**, as of now.
3. **Overdue or past-due instalments**, as of now.
4. **Client plans:** active now, cancelled and completed in the window, next charge overdue.
5. **Reminder health:** the Jobs & queues figures for `payment_reminders`, linked to `/admin/jobs-queues#queues`, skipped when a business is picked.

Every amount is the full invoice or instalment amount (not what is still owed), shown per currency, never added across currencies.

Slice 2b adds six named reads, **R-g, R-g′, R-h, R-h′, R-i and R-i′**, to `BusinessOsFinanceReadRepository`, generalising the 2a pager without changing its behaviour. It reuses `AdminJobsQueuesRepository.readQueueFiguresAllAccounts` (**R-j**), injected from the route under an explicit 2 s deadline. It adds the pure `dueDates.ts` and `paymentProblems.ts`, and builds the shared **`formatUtcDate`** in `adminFormat.ts` (full cycle, R-7). It has no migration, no SQL function, no write, no LLM call, no audit entry, no new query parameter and no KPI tile.

**With 2b, slice 2 is complete:** 2a (takings, merged as PR [#312](https://github.com/AgentsPilot/neuronforge/pull/312)) and 2b (client payment problems).

The cycle ran in this order:

1. Dev workplan (SA-W28 to SA-W40).
2. SA workplan review: approved with conditions (SA-WR-20 to SA-WR-25, edits E-11 to E-14).
3. Requirement edits E-11 to E-14, applied in place by an Edit-capable agent, in parallel with coding.
4. Implementation (deviations D-1 to D-4).
5. SA code review: approved with condition SA-CR-1.
6. QA: pass with issues, no bug.
7. Fix round 1 (SA-CR-1, QA-1, QA-2).
8. The user's diff review.

The user read the full diff and approved it on 2026-10-12. The work is uncommitted on `feature/bos-finance-health-2b` in worktree `neuronforge-finance-health`; RM commits next.

**MD links:** [BUSINESS_OS_FINANCE_HEALTH_REQUIREMENT.md](/docs/requirements/BUSINESS_OS_FINANCE_HEALTH_REQUIREMENT.md) | [BUSINESS_OS_FINANCE_HEALTH_SLICE_2B_WORKPLAN.md](/docs/workplans/BUSINESS_OS_FINANCE_HEALTH_SLICE_2B_WORKPLAN.md) | [Slice 2 live check](/docs/requirements/BUSINESS_OS_FINANCE_HEALTH_SLICE2_LIVE_CHECK.md) | [Slice 2a retrospective](/docs/retrospectives/BUSINESS_OS_FINANCE_HEALTH_SLICE_2A_RETROSPECTIVE.md)

---

## What went well

- **No blocked handshake on the requirement edits.** Acting on 2a's conclusion 1, E-11 to E-14 were routed to an Edit-capable agent from the start and applied in place, in parallel with coding. This is the first finance slice since 1a in which requirement upkeep did not stop or slow the flow.
- **The workplan caught four requirement gaps before code, and none reopened a business decision:**
  - **SA-W30:** the overdue tables' date order clashed with S2-CUR-5's "currency first" (E-11);
  - **SA-W31:** `FinanceSection` in `unknown` hides all its children, so one failed part would have hidden the other four (E-14);
  - **SA-W32:** AC-74's "30 September" clashed with the layout standard's `YYYY-MM-DD` (E-12);
  - **SA-W34:** two selected columns that no figure uses (E-13, dead selects dropped).
- **The Dev found a pre-existing defect that made a guard unfailable.** The finance source guard's cohort rule held a literal backspace byte (`0x08`) where regex `\b` was meant, so the rule could never match. The same byte was in two other test files. SA made it condition SA-CR-1, and fix round 1 replaced the byte with `\b` and added a planted control that proves the rule now bites. The other two files were kept out of scope and spawned as a separate task, which the user has started.
- **Shared code moved safely.** `adminFormat.ts` has about 22 importers. `formatUtcDate` went in with insertions only (+15 / −0, test +46 / −0). All 76 importer suites (1,900 tests) ran unchanged, and the layout folder guard passed unedited.
- **The pager refactor was proven, not assumed (SA-WR-20).** The only deleted line in the repository test is the recording-client method list gaining `'or'`. Every 2a describe passed byte-identical, so the 2a log text is unchanged.
- **Date-only due dates were handled end to end.** `due_date` is never passed through `new Date`; `dueDates.ts` compares text after `isRealDate`. AC-74 is tested in New York and Auckland, with a non-vacuity control showing that the naive path really does move a day.
- **Isolation held.** No finance `lib/` file names the jobs-queues repository; R-j is injected from the route through a structural type (SA-W35). The jobs-queues isolation guard, `adminReadMethods`, the three Stripe guards, `dateOnlyIsNotMidnightUTC`, the write-lockdown scan and the Businesses list all ran unchanged with `git diff --exit-code` 0.
- **Security and money integrity held.** Named read pairs; the UUID is refused before any query; `.eq('user_id')` on every page; the `.or()` string is built from fixed literals and a strict `YYYY-MM-DD`; with a business picked, zero all-accounts calls and zero reminder calls. No client columns are selected and no amount, due date, currency or name is logged.
- **Code review and QA passed on the first try.** SA approved with one condition. QA reported PASS WITH ISSUES with **no bug** and two Low notes. After fix round 1: finance suites 1,207 tests, `test:bos-entitlements` 6,982, `test:authz-guard` 203, scoped `tsc` canary caught and 0 errors in changed files.

## What did not go well

- Number of Dev ↔ SA back-and-forths: **0 rejections.** The workplan was approved with conditions (SA-WR-20 to SA-WR-25) and the code with one condition (SA-CR-1).
- Number of Dev ↔ QA bug fix cycles: **0 bug cycles.** One fix round for three items (SA-CR-1, QA-1, QA-2), with no QA re-run required.
- Any blocked handshake and why: **none.**
- **A guard rule had been silently vacuous since it was written.** The backspace byte in the cohort rule was in the finance guard before 2b, and in two other test files. No planted control existed for that rule, so nothing showed it could never fail. It was found by reading, not by a test.
- **The requirement still had gaps the workplan had to catch.** SA-W30 to SA-W32 and SA-W34 are the same kind of gap as SA-W18 to SA-W20 in 2a: rules in the requirement that were never compared with each other (S2-CUR-5 vs S2-FR-17), with the shared component's behaviour (`FinanceSection`), or with the layout standard (§5.11). All were caught before code, but one stage later than ideal.
- **QA-1: a sentence claimed more than the read proved.** "No failure has ever been stored" was stated from the rows read, which would be wrong at the 5,000 ceiling. Fixed in round 1, but the wording rule ("a claim about all rows needs a complete read") should be checked at requirement time.
- **A flaky test in the V-5 set.** `qa-slice5-pr2.route.test.ts` asserts real elapsed time and failed once under parallel load. It is pre-existing, unchanged and unrelated, but it costs a re-run each time it fires.
- **`schema:check` could not run again.** The worktree has no credentials (V-10); the columns rest on the live check's OpenAPI read and the migrations.
- **The manual QA backlog grew again.** The user now owes **L-1 to L-41**:
  - L-1 to L-13 (1a, merged);
  - L-14 to L-22 (1b, merged);
  - L-23 to L-31 (2a, merged);
  - L-32 to L-41 (2b).

  AC-73 (2b), §13 SQL checks 10 to 13 and the live halves of AC-56, AC-58, AC-59 and AC-61 rest on L-32 to L-41, plus `durationMs` and `reminderMs`. 2a's conclusion 6 ("one sitting before 2b reaches code review") was not acted on.

### Slice 2a lessons and follow-ups: what happened in 2b

| 2a item | 2b outcome |
|---|---|
| Conclusion 1 / FU-2a-8: route requirement edits to an Edit-capable agent from the start | ✅ Applied. E-11 to E-14 applied in place, no blocked handshake. The BA itself still has no Edit tool |
| Conclusion 2: cross-check every figure against its SQL check at requirement review | 🟡 Partly. Checks 10 to 13 matched the figures (SA-W36, SA-W39 cite them), but rule-vs-rule and rule-vs-component gaps (SA-W30, SA-W31, SA-W32) still surfaced at the workplan |
| Conclusion 3: live check before the requirement | ✅ Applied. The slice 2 live check covered the 2b tables (overdue counts, no failure or retry field set) |
| Conclusion 4: list the guards a new read will meet | ✅ Applied. The workplan listed every guard naming the 2b tables and the jobs-queues isolation guard up front (SA-W29, SA-W35) |
| Conclusion 5: measure numeric tolerances | ✅ No new tolerance; 2b reused `toHundredths` |
| Conclusion 6 / FU-2a-1: schedule the manual QA sitting | ⬜ Not done. Backlog is now L-1 to L-41 |
| FU-2a-2: RM commit of 2a | ✅ Merged as PR #312 |
| FU-2a-3: slice 2b | ✅ This slice |
| FU-2a-4: AI-cost overlap review questions | ⬜ Still open with the user, and now urgent (see FU-2b-4) |
| FU-2a-5 to FU-2a-7, FU-2a-9 | ⬜ Unchanged |

## Conclusions & process improvements

1. **Every guard rule needs a planted control that proves it can fail.** The backspace byte survived because the rule only had to pass. A rule without a control proving it catches a planted violation is unverified. SA should ask for the control at workplan review for any new or edited guard rule.
2. **Sweep for the same defect class when one is found.** The Dev grepped for the byte and found it in two more files. Keep doing that, and spawn the sweep as its own task rather than widening the slice, as was done here.
3. **At requirement review, compare rules with each other and with the shared components they will use.** For each new display rule, ask: does another rule in the requirement order or format the same thing differently, and does the shared component (`FinanceSection`, the layout standard) behave the way the rule assumes? That would have moved SA-W30 to SA-W32 one stage earlier.
4. **A sentence that claims "ever" or "all" needs a complete read behind it.** When a read can stop at a ceiling, its wording must say "among the rows read". Add this to the BA's wording checks.
5. **Keep shared-file changes insertion-only, with every importer suite run unchanged.** SA-WR-21 worked well for a file with about 22 importers; reuse it for any shared export.
6. **Schedule the manual QA sitting before slice 3 starts.** Forty-one steps across four slices is now the biggest open risk on the page; each slice adds about ten.

## Follow-ups

| # | Item | Owner | Status |
|---|---|---|---|
| FU-2b-1 | Manual QA L-32 to L-41 (workplan QA report), closing AC-73 (2b) and running §13 SQL checks 10 to 13; record `durationMs` (All businesses and one business) and `reminderMs` (well under 2,000). Plus the owed L-1 to L-31 from 1a, 1b and 2a | User | ⬜ Owed |
| FU-2b-2 | RM: commit, push and open the PR for `feature/bos-finance-health-2b`; record the commit in the workplan's Commit Info and in requirement §0.1 | RM / TL | ⬜ Next (user approved 2026-10-12) |
| FU-2b-3 | The same backspace-byte defect in `app/admin/business-os-llm/__tests__/ledgerPanel.render.test.tsx` and `app/admin/components/__tests__/AdminSidebar.nav.test.ts` | Separate task | 🟡 Started by the user |
| FU-2b-4 | **AI-cost overlap review: five business questions (BQ-1 to BQ-5)**, carried from FU-2a-4. **Urgent:** layout step L-8 deletes the audit-trail `BusinessAccountPicker` that `FinanceFilterBar.tsx` imports, so overlap slice **OV-2** (move Finance to the shared picker) must land before L-8 | User → BA → SA | ⬜ Open, time-sensitive |
| FU-2b-5 | `qa-slice5-pr2.route.test.ts` asserts wall-clock time with real timers (`:113-115`) and flakes under parallel load. Pre-existing and unrelated to 2b | Dev (separate item) | ⬜ Open |
| FU-2b-6 | Run `npm run schema:check` from a checkout with credentials for the 2a and 2b selects, or extend it to read exported column constants (extends FU-2a-9) | Dev / QA | ⬜ Open |
| FU-2b-7 | **Slice 3: the invite funnel.** Needs more invite volume before it is worth building | BA → user | ⬜ Waiting on volume |
| FU-2b-8 | **Slice 4: boost revenue.** Unblocked: all boost slices have merged | BA → SA → Dev | ⬜ Next candidate |
| FU-2b-9 | **Slices 5 to 7.** Blocked on the plan-payment slices | — | ⬜ Blocked |
| FU-2b-10 | **Slice 8: snapshots** | BA → SA → Dev | ⬜ Later |
| FU-2a-5, FU-2a-6, FU-2a-7, FU-2a-8 | Carried: DF-3 test-data filtering; DF-4 page shell migration; layer-B `livemode` and failed charges never stored; BA Edit tool (workaround now standard) | As before | ⬜ Unchanged |
| FU-1b-3, FU-1b-4, FU-4 | Carried from slice 1 (zero allowance wording, `metricParams` typing, shared ledger read) | As before | ⬜ Unchanged |

### Status: APPROVED BY USER — commit pending (RM) — `feature/bos-finance-health-2b`

---

## Change History

| Date | Change | Details |
|---|---|---|
| 2026-10-12 | Created (TL) | Slice 2b retrospective after the user approved the diff; slice 2 complete. Records E-11 to E-14 applied in place with no blocked handshake, the requirement gaps SA-W30 to SA-W32 and SA-W34, the backspace-byte guard defect (fixed here under SA-CR-1, two other files spawned as a separate task), the insertion-only `formatUtcDate` with 76 importer suites unchanged, the cycle counts (0 rejections, 0 bug cycles, one fix round of three items), a comparison with 2a's lessons, and follow-ups (manual QA L-1 to L-41, the urgent OV-2 before L-8, slices 3 to 8). Commit pending (RM). |
