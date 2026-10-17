# Retrospective: Finance slice 8.1, the history snapshots migration (20261078)

> **Last Updated**: 2026-10-17

## Overview

Slice 8.1 adds one append-only, server-only table, `public.business_os_finance_snapshots`. Each row is one platform figure (a count of accounts or an amount of credits) for one UTC day. It also adds the scripts needed to apply it safely:
- a pre-check (check 31);
- a post-apply checker (check 32, 16 rows);
- a rollback that refuses to run if the table holds a row;
- a local-only self-test on PGlite 0.5.8.

It adds the shape constants module, the purge and export classification entry (a global `never`, excluded as platform data) and a migration source test. There is no writer, read, route, cron or UI; those come in 8.2 and 8.3. The test-account cleanup function needs no new version. BD-33's fast track does **not** cover a production migration, so the PR stays off auto-merge until the user applies it.

**MD links:** [BUSINESS_OS_FINANCE_HEALTH_REQUIREMENT.md §11M](/docs/requirements/BUSINESS_OS_FINANCE_HEALTH_REQUIREMENT.md) | [BUSINESS_OS_FINANCE_HEALTH_SLICE_8_1_SNAPSHOTS_MIGRATION_WORKPLAN.md](/docs/workplans/BUSINESS_OS_FINANCE_HEALTH_SLICE_8_1_SNAPSHOTS_MIGRATION_WORKPLAN.md)

**Branch:** `feature/bos-finance-health-8` (cut from the DF-6 tip `f6182697`, fast-forwarded to main `e5bc1e1f` under 8.1-R1), worktree `neuronforge-finance-m8`

---

## What went well

- **The requirement review caught two defects before any DDL existed.** BA wrote §11M. SA-RR-8 approved it with conditions E-85 to E-88: S8-F1 keeps History closed when the page opens, so the AC-173 request pin holds; S8-F2 allows hyphenated tier keys in the dimension CHECK.
- **The workplan review tightened the checker.** SA-WR-8.1 approved with conditions and applied E-89 to E-93. Check 32's tier row now matches the exact E-86 pattern, so it catches both a lost hyphen and a widened pattern. The self-test uses UTC dates (8.1-R2).
- **The mutation testing was thorough.** Each of the 17 mutations (M-1 to M-17) changed one thing in the migration copy. Each one turned the expected check 32 row false and/or failed the self-test. The harness passed (HARNESS PASS), and the rollback was refused while a row existed.
- **Code review and QA were clean.** SA-CR-8.1 approved D-1 to D-3. QA passed with no bugs. All seven frozen pins are unchanged, and the cleanup drift test stayed green with no regeneration.

## What did not go well

- Number of Dev ↔ SA back-and-forths: 2. SA-RR-8 had conditions (E-85 to E-88) and SA-WR-8.1 had conditions (E-89 to E-93, 8.1-R1 to 8.1-R4). The code review passed first time.
- Number of Dev ↔ QA bug fix cycles: 0.
- Any blocked handshake and why: none so far. The slice now waits on the user's production apply, by design.
- **The migration number moved in the middle of the cycle.** It was planned as `20261074`. DE-8a (#451) took 74 and 75, which forced #447 to renumber to 76 and 77, so 8.1 became `20261078`. The count pins also went stale: the plan said 155 → 156, and main was already at 156 by code time.
- **Main has a type error outside our scope.** The scoped `tsc` reports TS2353 at `exportClassification.test.ts(1964,42)`, from DE-7 (`adf9e37f`), on a line 8.1 does not touch. A chip has been raised for it; 8.1 does not fix it.
- **The workplan's "before the apply" expectation for check 32 was wrong.** Two `not exists` rows are true when the table does not exist yet (D-2). The harness now asserts exactly those two.

## Conclusions & process improvements

- **Parallel streams claim migration numbers (DE and finance).** Check open PRs **and** remote branches for the next free number at code time, **and again at PR time**. Never trust the number from the plan.
- **Recompute count pins from merged `origin/main` at code time.** Never copy them from the workplan.
- **Merge rule MR-1:** whichever of #447 and 8.1 merges second recounts the pins to 158 / 120 when it merges main.
- **Follow-up QA-81-N1 (Low):** a widened metric CHECK still passes check 32. Only a hand edit on production could slip past it (the migration test pins the repo copy). The fix is to add an exact-pattern row for the metric, as E-93 did for the dimension.
- **Follow-up:** the TS2353 chip on main (DE-7 owner).
- **User steps (L-155), in new SQL editor tabs:**
  1. Run check 31; expect 6 rows, all ok.
  2. Apply `20261078`.
  3. Run check 32; expect 16 rows, all ok.
  4. Tell the session "applied".

  RM then merges by hand, and 8.2 starts.

### Status: COMMITTED — feature/bos-finance-health-8 — commit `0439f94f`, PR #452 (auto-merge OFF); merge held for the user's apply of 20261078

---

## Change History

| Date | Change | Details |
|---|---|---|
| 2026-10-17 | Created (TL) | 8.1 retrospective after SA-RR-8 (E-85 to E-88), SA-WR-8.1 (E-89 to E-93), SA-CR-8.1 (D-1 to D-3 approved) and a QA pass with no bugs (QA-81-N1 follow-up); production migration, so auto-merge stays off |

TL approval: APPROVED for RM (commit, PR; auto-merge OFF until the user applies 20261078)
