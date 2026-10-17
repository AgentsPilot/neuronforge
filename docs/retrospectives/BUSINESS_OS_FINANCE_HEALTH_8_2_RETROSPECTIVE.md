# Retrospective: Finance slice 8.2, the nightly history snapshot job

> **Last Updated**: 2026-10-17

## Overview

Slice 8.2 adds the nightly job that fills `business_os_finance_snapshots` (the 8.1 table). At 00:07 UTC it reads the all-businesses state shown in Sections 1 and 4: the plan walk, the billing rows, the credit positions (with a 30 s budget) and the lots. It turns these into the §11M.5 rows through the same functions the page uses. It checks every emitted row against the 8.1 shape constants, then writes everything in one idempotent insert through a new repository.

The job also handles three failure cases:
- A run that starts at or after 02:00 UTC writes nothing.
- A family whose read failed is skipped, never written as 0.
- If the table is not installed, the job returns a clean 503 before any read.

8.2 has no migration. It runs under BD-33, but its PR is stacked behind #452 (8.1), which waits for the user to apply `20261078`.

**MD links:** [BUSINESS_OS_FINANCE_HEALTH_REQUIREMENT.md §11M](/docs/requirements/BUSINESS_OS_FINANCE_HEALTH_REQUIREMENT.md) | [BUSINESS_OS_FINANCE_HEALTH_SLICE_8_2_SNAPSHOT_JOB_WORKPLAN.md](/docs/workplans/BUSINESS_OS_FINANCE_HEALTH_SLICE_8_2_SNAPSHOT_JOB_WORKPLAN.md)

**Branch:** `feature/bos-finance-health-8-2` (cut from the 8.1 tip `1eaa8f3d`), worktree `neuronforge-finance-m8`

---

## What went well

- **Dev's questions improved on SA's own ruling.** SA-WR-8.2 accepted all six Dev questions. SA-W-8.2-1 replaced SA's earlier ruling (E-94): the job takes its reads straight from `financeHealthDeps()`, so they are the page's reads by construction, and no caller list moved.
- **The page's figures did not change.** `walkPlans` is now exported, and `payingSetOf` and `outstandingBySource` are extracted without behaviour change. The AC-145 hash, `creditsSection.test.ts` and the 1a to 1c tests passed unedited.
- **The writer has one path.** 8.2-R2's guard lets only `financeSnapshotDeps.ts` import the writer and only the job call `insertSnapshotRows`. 8.2-R4 makes `financeSnapshotClock` the job's only clock. Both guards have planted controls.
- **QA wrote the real rows to a real local schema.** The builder's actual output went into a local PGlite database with `20261078` applied. The first night wrote 36 rows and the re-run wrote 0, which proves the insert is idempotent. Check 33 passed on that data.
- **SA-CR-8.2 approved with no conditions.** QA passed with no bugs: AC-278 to AC-286 and AC-293 PASS. All seven frozen pins are unchanged.

## What did not go well

- Number of Dev ↔ SA back-and-forths: 1. SA-WR-8.2 approved with conditions 8.2-R1 to 8.2-R4 and edits E-94 to E-97. The code review passed first time.
- Number of Dev ↔ QA bug fix cycles: 0.
- Any blocked handshake and why: the PR is held behind #452 by the stacking rule, by design.
- **RC-15 tripped on the first full run.** A new test named the plan repository directly. D-2 switched it to a derived type, with no guard edit.
- **`addedOn` cannot be known at code time.** It is a placeholder (`2026-10-18`, D-3) that RM must set at release. If it is set too early, Jobs & queues shows "Stopped".
- **A known flake recurred.** `qa-slice5-pr2.route.test.ts` (its 5 s deadline under parallel load, chip `task_d3dcf2de`) failed once and passed alone. It is unrelated to 8.2.

## Conclusions & process improvements

- **Picking reads from the page's deps factory is the pattern for any future platform job.** The job cannot drift from the page, and no caller list moves.
- **Before writing new test files, check the entitlements and repository import guards (RC-15).** They apply to tests too.
- **Release-date fields such as `addedOn` should always be RM's last edit before merge**, with SA's rule written down: the date of the first scheduled run after the deploy.
- **Low follow-up:** checks 33 and 34 exist only in the requirement text, not as script files under `scripts/`. They should be extracted byte for byte, as checks 31 and 32 were.
- **Release order for RM:**
  1. Commit and push this branch now.
  2. Once #452 has merged, merge main into this branch (no rebase).
  3. Set `addedOn` (`bosCronJobs.ts:634`) to the UTC date of the first 00:07 run after the production deploy, in the last commit before merge.
  4. Open the PR.
  5. Turn on auto-merge only after that, and only once `20261078` is applied.
- **Owed to the user after the first night (AC-294):** L-156 (the job is listed), L-157 (a green run, with `metricsWritten` and `familiesSkipped` 0) and L-158 (checks 33 and 34).

### Status: APPROVED FOR COMMIT — feature/bos-finance-health-8-2 — commit pending (RM); PR held until #452 merges

---

## Change History

| Date | Change | Details |
|---|---|---|
| 2026-10-17 | Created (TL) | 8.2 retrospective after SA-WR-8.2 (8.2-R1 to 8.2-R4, E-94 to E-97), SA-CR-8.2 approved with no conditions (D-1 to D-5 ruled) and a QA pass with no bugs (PGlite 36 rows, re-run 0); stacked behind #452; `addedOn` set by RM at release |

TL approval: APPROVED for RM (commit and push branch now; open PR after #452 merges, set addedOn, then auto-merge)
