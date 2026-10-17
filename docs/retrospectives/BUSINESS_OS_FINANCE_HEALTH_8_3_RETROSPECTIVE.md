# Retrospective: Finance slice 8.3, the History block

> **Last Updated**: 2026-10-17

## Overview

Slice 8.3 is the last part of slice 8. It adds one read route, two repository reads and a pure view builder, so the Finance Overview (all businesses) can show what the nightly job (8.2) has recorded.

The new History block is **closed on page load** (S8-F1 / E-85). Only "Show history" sends the history request, so the page still makes exactly one request on load and every frozen pin keeps its bytes. When open, the block shows:
- the honest start line;
- the Plan mix and Credits tables;
- the "Change in this window" lines.

Before `20261078` is applied, it shows a calm "not available yet" notice instead of an error. There is no chart, no new dependency, no migration and no write, and the finance page route and its payload are unchanged. The PR is stacked behind 8.2, which is stacked behind #452 (8.1).

**MD links:** [BUSINESS_OS_FINANCE_HEALTH_REQUIREMENT.md §11M](/docs/requirements/BUSINESS_OS_FINANCE_HEALTH_REQUIREMENT.md) | [BUSINESS_OS_FINANCE_HEALTH_SLICE_8_3_HISTORY_BLOCK_WORKPLAN.md](/docs/workplans/BUSINESS_OS_FINANCE_HEALTH_SLICE_8_3_HISTORY_BLOCK_WORKPLAN.md)

**Branch:** `feature/bos-finance-health-8-3` (cut from the 8.2 tip `2f335510`), worktree `neuronforge-finance-m8`

---

## What went well

- **The writer guard stayed strict.** For Q5, SA-WR-8.3 split the reads out into a separate read-only repository instead of loosening 8.2-R2. The writer still has exactly one importer and one caller.
- **Opening closed kept the frozen pins intact.** Because History sends nothing until it is opened, the page still sends one request on load. AC-173 and the other six frozen pins kept their bytes, and the AC-145 payload is unchanged.
- **SA's code review caught a real production defect before QA.** C-1 was found by reading the code and confirmed on PGlite with realistic volume, not left for the first busy month on production.
- **QA passed on the fixed version with no bugs.** AC-287 to AC-293 PASS.

## What did not go well

- Number of Dev ↔ SA back-and-forths: 2. SA-WR-8.3 approved with conditions 8.3-R1 to 8.3-R3 and edits E-98 to E-101. SA-CR-8.3's first verdict was Fix Required (C-1); it passed after the fix.
- Number of Dev ↔ QA bug fix cycles: 0.
- Any blocked handshake and why: the PR is held behind 8.2 and #452 by the stacking rule, by design.
- **C-1 (High): a read was silently capped.** The history read made one `.range(0, 5000)` call. PostgREST caps every response at 1,000 rows and does not report the cut. On PGlite the old read covered only 28 of 89 days, and the page would have shown a short history as if it were complete. The fix reads in pages of 1,000 rows until a short page.
- **Neither the workplan nor the workplan review caught the cap.** A range above 1,000 rows looked correct on paper.

## Conclusions & process improvements

- **Every new list read must page at 1,000 rows.** Never trust a single `.range()` wider than the PostgREST cap.
- **Recommendation:** enforce this mechanically. Either add a source guard that flags `.range(` with a span above 1,000 outside a paging loop, or add a note to the `new-repository` skill (or both). This is a new pattern, so SA rules on which.
- **Test reads with realistic volume.** C-1 only showed with more than 1,000 rows. QA and SA probes of list reads should seed past the cap.
- **A read-only repository beside a single writer is the pattern for history tables.** It keeps the writer guard exact.
- **Release order:** open the PRs in order, 8.1 (#452) → 8.2 → 8.3, each only after the previous one is in main. Before opening each, merge main into the branch (no rebase).
- **Owed to the user (AC-294):** the browser steps L-159 to L-162, after 8.1 is applied and 8.2 has recorded at least one night.

### Status: APPROVED FOR COMMIT — feature/bos-finance-health-8-3 — commit pending (RM); PR held until 8.2 merges

---

## Change History

| Date | Change | Details |
|---|---|---|
| 2026-10-17 | Created (TL) | 8.3 retrospective after SA-WR-8.3 (8.3-R1 to 8.3-R3, E-98 to E-101), SA-CR-8.3 Fix Required (C-1, PostgREST 1,000-row cap) then Code Approved, and a QA pass with no bugs (AC-287 to AC-293); stacked behind 8.2 and #452 |

TL approval: APPROVED for RM (commit and push branch now; open PR after 8.2 merges)
