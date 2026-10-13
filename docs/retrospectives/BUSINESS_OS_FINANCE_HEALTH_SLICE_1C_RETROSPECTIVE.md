# Retrospective: Business OS Finance & Business Health — Slice 1c (fix: test-mode platform money, paying Founding Partners)

> **Last Updated**: 2026-10-13

## Overview

This is the retrospective for fix slice 1c of the read-only admin page `/admin/finance`.

**Trigger.** The user tested Stripe end to end with their own owner account, in Stripe test mode: a $10 boost and a $79 Basic plan. Both were recorded correctly, but neither showed on the Finance page. A read-only investigation found no bug. The page worked as designed:

- the "Our revenue" panel and the paying read counted **live mode only** (BD-10);
- the account sat in **Comped**, because its plan tier was in force but its only billing row was test mode (S1C-F1).

The investigation first misdiagnosed the account as "Founding Partner". SA corrected that at requirement review (S1C-F1).

**User decisions.**

| # | Decision |
|---|---|
| BD-14 | Test-mode and live-mode payments both count, as real. No switch, no label |
| BD-15 | A paying Founding Partner is grouped under their paid tier, with a Founding Partner note. A non-paying one stays in Founding Partner |
| BD-16 | Volunteered by the user mid-cycle: one billing record per account, no separate test and live rows. This withdrew SA's dual-row redesign (SA-Q21) and cut the estimate to about one day |

**What the slice changed.** No migration, no new table, read, tile, route or query parameter.

- Reads R-c, R-c′ and R-d drop the mode filter and are renamed (`listBillingStatusesAllAccounts`, `findBillingStatusForAccount`, `countRevenueRows`). R-c and R-c′ add `bought_tier`.
- Two billing rows for one account are an **error**, never a figure: R-c's duplicate check (SA-WR-27), R-c′'s `maybeSingle` error (SA-WR-28). Section 1 then shows the "Tier set" fallback.
- The classifier gains `paidTierOf` (SA-Q20), the BD-15 override after `groupFor`, a per-group `foundingPartners` count, and dormant Founding Partners counted inside the group only (SA-W42).
- New revenue panel copy with no webhook or mode wording; a Founding Partner note (all businesses) and a `neutral` "Founding Partner" chip (picked business).
- Guards: "the repository code names no `livemode`" replaces the old live-mode rule, with planted controls; the AC-81 wording rules.

Note: the `basic` tier displays as **"Essentials"** (its config label), not "Basic".

The cycle ran in this order:

1. Investigation of the user's test, then BA requirement §11B (BD-14, BD-15).
2. SA requirement review (S1C-F1 to S1C-F6, edits E-15 to E-19).
3. RM cut `feature/bos-finance-health-1c` from `main` `97c66132`.
4. Dev workplan (SA-W41 to SA-W46).
5. SA workplan review: approved with conditions, rebased on BD-16 (SA-WR-26 to SA-WR-31, edits E-20 to E-25).
6. Implementation (deviations D-1 to D-4).
7. SA code review: approved with conditions (SA-CR-2, SA-CR-3).
8. QA: pass with issues, no bug, two Low notes.
9. Fix round 1 (SA-CR-2, SA-CR-3, QA-1).
10. The user's diff review: approved on 2026-10-13, "approved, commit and create a PR".

**MD links:** [BUSINESS_OS_FINANCE_HEALTH_REQUIREMENT.md](/docs/requirements/BUSINESS_OS_FINANCE_HEALTH_REQUIREMENT.md) | [BUSINESS_OS_FINANCE_HEALTH_SLICE_1C_WORKPLAN.md](/docs/workplans/BUSINESS_OS_FINANCE_HEALTH_SLICE_1C_WORKPLAN.md) | [Slice 2b retrospective](/docs/retrospectives/BUSINESS_OS_FINANCE_HEALTH_SLICE_2B_RETROSPECTIVE.md)

---

## What went well

- **The user's own end-to-end test found what no review had.** Two real (test-mode) payments that the page did not show surfaced a design rule, not a bug, and led to three clear business decisions in one sitting.
- **SA caught the misdiagnosis before any code.** The investigation called the account a Founding Partner; SA showed it was Comped because the tier was in force (S1C-F1). The fix was planned against the real cause.
- **BD-16 simplified the design instead of adding to it.** SA withdrew its own dual-row redesign (keyset on `id`, `.limit(2)`, OR over rows) and kept the existing single-row reads, after verifying in code that `user_id` paging loses nothing when there is one row per account. The estimate dropped to about one day, and Dev reported it was met.
- **Two rows fail honestly.** Rather than trusting BD-16 silently, SA required an error path (SA-WR-27, SA-WR-28): two rows give "Tier set", never a wrong group. The one residual (a second row exactly past a 1,000-row page boundary) is recorded in code and tests.
- **No blocked handshake.** All requirement edits (E-15 to E-25) were applied in place by Edit-capable agents, the standard set after 2a and 2b.
- **2b's conclusion 1 was applied.** Every new or edited guard rule has a planted control: the "no `livemode`" rule runs through the shared `stripComments`, and the AC-81 wording rule records the `latestMode` false-positive shape (SA-WR-30).
- **Earlier tests ran unedited.** The 1a classifier tests, the `buildShadowReport` parity test and the SA-WR-17 "no chip" render test all passed untouched (`planGroups.test.ts` was additions only, 154 / 0). The BD-15 override sits after `groupFor` so its exhaustive tests did not move (SA-W44).
- **Scope held.** Businesses-list, Credits (`creditsSection.ts`), billing placement and the Stripe guards all ran with `git diff --exit-code` 0. The only edit outside the slice's files was a 4-line comment in `payingSubscriptionStatuses.ts`, kept free of "supabase" for the placement guard.
- **Final results after fix round 1:** finance suites 1,288 tests, `test:bos-entitlements` 7,194, `test:authz-guard` 203, scoped `tsc` canary caught and 0 diagnostics. QA found no bug.

## What did not go well

- Number of Dev ↔ SA back-and-forths: **0 rejections.** Workplan approved with conditions (SA-WR-26 to SA-WR-31), code approved with two Low conditions (SA-CR-2, SA-CR-3).
- Number of Dev ↔ QA bug fix cycles: **0 bug cycles.** One fix round for three items (SA-CR-2, SA-CR-3, QA-1), no QA re-run required.
- Any blocked handshake and why: **none.**
- **"Live mode only" went unquestioned for four slices.** BD-10 was written in the 1a requirement and passed BA, SA, Dev, QA and four user diff reviews. No one asked what the page would show the owner during the test-mode period, when every payment is a test payment. It took the user's own test to expose it.
- **The investigation misdiagnosed the cause.** It said "Founding Partner"; the account was Comped. SA caught it, but a read-only investigation should state the account's lifecycle state from the code path, not from the cohort name.
- **A rename was chosen before the shape was settled.** SA-Q22 named R-c′ `list…` assuming SA-Q21's list; BD-16 withdrew the list, but the name was built anyway and had to be fixed (SA-CR-2). A name should follow the final shape, so re-check names when a later decision changes the shape.
- **A test title overstated what it proved.** The "duplicate check spans pages" test uses a fake that ignores `.gt`, so it could not show a cross-page catch (SA-CR-3, re-titled).
- **QA-1: the note did not check the period.** The Founding Partner note counted any champion-cohort account in a tier group, including one whose Founding Partner period had ended. Fixed in round 1: the note shows only while the period is current (no end, or an end after `now`).
- **`schema:check` still cannot run from the worktree** (V-10); `bought_tier` rests on migration `20261025` and the user's live check of 2026-10-12.
- **The manual QA backlog grew again**, to **L-1 to L-48**. 2b's conclusion 6 (one sitting before slice 3) has not happened yet. L-42 to L-48 include the user's own account, SQL checks 1 and 6, and `durationMs`.

### Slice 2b lessons and follow-ups: what happened in 1c

| 2b item | 1c outcome |
|---|---|
| Conclusion 1: planted control for every guard rule | ✅ Applied to the replaced `livemode` rule and the AC-81 rules |
| Conclusion 2: sweep for the same defect class | ✅ The rename grep (V-9) swept every caller, extended after SA-CR-2 |
| Conclusion 3: compare rules with each other and with shared components at requirement time | 🟡 Partly. SA-W42 (dormant scope) and SA-W43 (chip vs SA-WR-17) still surfaced at the workplan, but before code |
| Conclusion 4: a claim about "all" needs a complete read | ✅ Applied. "None yet" rests on R-d's exact, uncapped head counts |
| Conclusion 5: insertion-only shared-file changes | ✅ No shared-file change beyond a comment |
| Conclusion 6 / FU-2b-1: manual QA sitting | ⬜ Not done. Backlog is now L-1 to L-48 |
| FU-2b-4: AI-cost overlap questions and the urgent OV-2 picker move | ⬜ Still open |
| FU-2b-8: slice 4 (boost revenue) | ⬜ Next candidate, now with real rows to show |

## Conclusions & process improvements

1. **A user's own end-to-end test is a review stage, not just a check.** It exposed a design rule (live mode only) that every reviewer had accepted, because the reviewers checked the rule was built correctly, not whether it was the right rule for today. Before a slice is built on a mode, environment or data filter, the BA should write one sentence on **what the page shows the owner right now** with the data that exists today, and the user should confirm it.
2. **Question inherited design rules when the platform's state changes.** BD-10 was right for a live platform and wrong for a pre-launch one in Stripe test mode. When a requirement rule depends on the platform's stage, record that dependency so it is revisited when the stage changes.
3. **Investigations name the state from the code path.** A read-only investigation should trace the classifier (`deriveLifecycle`, `groupFor`) for the actual account, not infer the group from the cohort. S1C-F1 is the example.
4. **When a decision changes a shape, re-check the names chosen for the old shape.** SA-CR-2 would have been avoided by re-reading SA-Q22 after BD-16.
5. **Simplifying user decisions are welcome mid-cycle.** BD-16 arrived during the workplan review and removed work. SA rebasing its own ruling on it, while keeping an honest error path, is the pattern to repeat.
6. **Schedule the manual QA sitting now.** Forty-eight steps across five slices; L-43 to L-46 check the exact account that triggered this slice.

## Follow-ups

| # | Item | Owner | Status |
|---|---|---|---|
| FU-1c-1 | Manual QA **L-42 to L-48** (workplan QA report): the revenue panel, the user's own account under **Essentials** with the Founding Partner note, the picked-business chip, §13 SQL checks 1 and 6 (with the E-25 caveat), `durationMs`. Plus the owed **L-1 to L-41** from 1a, 1b, 2a and 2b | User | ⬜ Owed |
| FU-1c-2 | RM: commit, push and open the PR for `feature/bos-finance-health-1c`; record the commit in the workplan's Commit Info and in requirement §0.1 | RM / TL | ⬜ Approved by user, pending RM |
| FU-1c-3 | **Slice 4 (boost revenue)** and **slice 5 (plan revenue)** now have real rows to show (the user's test-mode boost and plan invoice, counted under BD-14) | BA → SA → Dev | ⬜ Next candidates |
| FU-1c-4 | AI-cost overlap review: open questions BQ-1 to BQ-5 (carried from FU-2b-4). **Urgent:** OV-2 (move Finance to the shared picker) must land before layout step L-8 deletes the picker `FinanceFilterBar.tsx` imports | User → BA → SA | ⬜ Open, time-sensitive |
| FU-1c-5 | Recorded residual: a second billing row exactly past a 1,000-row page boundary is not detected by R-c (SA-WR-27). Acceptable under BD-16; revisit if the one-row assumption changes | SA | ⬜ Recorded |
| FU-2b-5, FU-2b-6, FU-2b-7, FU-2b-9, FU-2b-10 | Carried: flaky wall-clock test; `schema:check` from a credentialed checkout; slice 3 waits on volume; slices 6 to 7 blocked; slice 8 snapshots | As before | ⬜ Unchanged |
| FU-2a-5 to FU-2a-8, FU-1b-3, FU-1b-4, FU-4 | Carried from earlier slices (DF-3 test-data filtering, DF-4 page shell, layer-B mode and failed charges, BA Edit tool; zero allowance wording, `metricParams` typing, shared ledger read) | As before | ⬜ Unchanged |

### Status: APPROVED BY USER — commit pending (RM) — `feature/bos-finance-health-1c`

---

## Change History

| Date | Change | Details |
|---|---|---|
| 2026-10-13 | Created (TL) | Slice 1c retrospective after the user approved the diff. Records the trigger (the user's own test-mode boost and plan, hidden by the live-only rule BD-10 and the Comped grouping, S1C-F1), decisions BD-14 to BD-16, BD-16 withdrawing the dual-row redesign, the honest two-row error path, the cycle counts (0 rejections, 0 bug cycles, one fix round of three items), a comparison with 2b's lessons, the main lesson that a user's own end-to-end test exposed a design rule no reviewer had questioned, and follow-ups (manual QA L-1 to L-48, slices 4 and 5, the AI-cost overlap questions and urgent OV-2). Commit pending (RM). |
