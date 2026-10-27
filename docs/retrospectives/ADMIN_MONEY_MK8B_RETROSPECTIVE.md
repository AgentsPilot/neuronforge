# Retrospective: MK-8b, AI cost page drawers

> **Last Updated**: 2026-10-26

**Branch:** `feature/admin-money-mk8b-ai-cost-drawers`, worktree `neuronforge-finance-mk8b` | **Workplan:** [ADMIN_MONEY_MK8B_AI_COST_DRAWERS_WORKPLAN.md](/docs/workplans/ADMIN_MONEY_MK8B_AI_COST_DRAWERS_WORKPLAN.md)

This is the last Page 2 slice.

## Overview

MK-8b adds two drawers to the AI cost page.
- **The billing-period drawer** opens from the period rows and shows the stored figures beside the rebuilt ones.
- **The business drawer** opens from the Leak result rows and shows a Leak check for that business.

Both drawers are read-only and read only when opened. Each opening makes one request, identical to Pin C row 7. Rows open on click and use the Businesses page's button (MK-10). `openableRowClass` and `OpenRowHeader` moved to the shared layout folder, and Finance re-exports them. There is no new route, repository method, payload key or migration.

## What went well

- **The plan held.** SA-WP-MK8B approved with conditions C-1 to C-6, and all seven defaults held. The Calls tab already had its call drawer, so nothing was owed there.
- **No stacked PR.** The slice was built on the MK-3b commits before #518 merged, then fast-forwarded to main `f683d49f`.
- **SA-CR-MK8B approved the code, with DV-1 to DV-6 accepted.**
- **All pins are byte-identical:** A `a130d560`, B, C `e57f2675` / `64a565e9`, D, AC-145 `33340751`, AC-173 and T-12 `c2891a35`. Only the ruled lists moved: the registry 22 → 26 and the vocabulary 21 → 23.

## What did not go well

- Dev ↔ SA back-and-forths: 0. Dev ↔ QA bug fix cycles: 1. QA's first run failed on B-1 (Medium):
  - The period drawer marked "(differs)" on periods the check never checked. When the read ceiling was hit, it compared against a partial rebuilt sum.
  - Fix: "(differs)" now shows only when `matches === false`. A period that was not checked shows "—" and "not checked".
  - Three permanent tests were added, and the re-test passed.
- Blocked handshakes: none.
- **SA's two Low notes, recorded:**
  - The platform account is detected by matching text. QA confirmed this works with the real route body.
  - "Open full view" reloads the whole page.

## Conclusions & process improvements

- **A "differs" marker must follow the check's own verdict.** Never recompute it from figures that may be partial.
- **Shared row-opening helpers now live in the layout folder.** New drawers should use them.
- **Page 2 is complete once this merges.**

### Status: COMMITTED — feature/admin-money-mk8b-ai-cost-drawers — commit `f0bea2b0`, PR #520 (auto-merge on)

TL approval: APPROVED for RM (commit, PR, auto-merge)
