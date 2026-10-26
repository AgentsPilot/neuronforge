# Retrospective: MK-2, one AI cost

> **Last Updated**: 2026-10-26

**Branch:** `feature/admin-money-mk2-one-ai-cost`, worktree `neuronforge-finance-health` | **Workplan:** [ADMIN_MONEY_MK2_ONE_AI_COST_WORKPLAN.md](/docs/workplans/ADMIN_MONEY_MK2_ONE_AI_COST_WORKPLAN.md)

This is the first Page 2 slice of the Money restructure.

## Overview

Scope, quoted verbatim: "AI cost tile counts charges created in the window; default This month; whole-periods label on the period table; deleted-accounts line (§2)".

MK-2 was built before the Page 1 pause and parked uncommitted. It was then re-applied onto main `6e19cbe4`: 17 files unchanged, and 5 `financeHealth` edits re-applied.

## What went well

- **There is one ledger read.** SA-CR-MK2 approved the code with no conditions. RU-19 wires the route through Finance's own deps, so the ledger is read only once.
- **A technical fork stayed with SA.** Q-R1 was a technical ruling, not a user question: F-K3 (a trend tile) stays Unknown, and A-K1 shows "at least" with a note in MK-3.
- **QA tested the window, not just equality.** Dev's equality tests used a fake ledger that ignored the window. QA added a date-filtering probe across 6 windows. It showed tile = Section 3 = F-K3 (8.25), and the deleted-accounts line was correct. The probe was then deleted. QA passed with no bugs.
- **Pins moved only as ruled.**
  - Pin A: the two `CostsKpis` entries, plus the fixture's `chargedInWindow` line.
  - Pin C table: rows 1, 7, 9 and 10.
  - Unchanged: AC-145 (`33340751`), Pin B, Pin D and AC-173.

## What did not go well

- Dev ↔ SA back-and-forths: 0. Dev ↔ QA bug fix cycles: 0. Blocked handshakes: none.
- **Dev's equality tests could not catch a window bug.** The fake ledger did not filter by date, so equal figures proved nothing about the window.
- **Parking the slice across many merges cost a re-apply.** Five edits had to be re-applied by hand.

## Conclusions & process improvements

- **Equality tests need a fake that actually filters by window.** Otherwise "A equals B" passes when both are wrong.
- **To re-apply a slice that was parked across many merges, copy its files aside, fast-forward, then re-apply them.** Never use `git stash`.
- **Follow-up MK2-FU-1 (a QA note, not a defect):** F-K3 counts up to now, while the tile counts up to midnight. A charge made between two page loads can make them differ until both are reloaded.

### Status: COMMITTED — feature/admin-money-mk2-one-ai-cost — commit `5452be3c`, PR #516 (auto-merge on)

TL approval: APPROVED for RM (commit, PR, auto-merge)
