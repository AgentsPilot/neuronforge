# Retrospective: MK-1, names and block KPIs (UI short path)

> **Last Updated**: 2026-10-19

**MD links:** [ADMIN_MONEY_MK1_NAMES_BLOCK_KPIS_WORKPLAN.md](/docs/workplans/ADMIN_MONEY_MK1_NAMES_BLOCK_KPIS_WORKPLAN.md) | **Branch:** `feature/admin-money-mk1-names-block-kpis`, worktree `neuronforge-finance-m8`

## Overview

The Takings block is renamed "Client payments (the businesses' money, not ours)", moves to the end of the page and keeps its "Not our revenue" chip. Two block KPI headlines now show the leading icon from MK-0. The far-over-allowance amber chip appears at 150% or more. The payload is unchanged, and the seven frozen pins and AC-145 kept their bytes.

## What went well

- **The client-money label is now unambiguous.** It cannot be read as our revenue.
- **MK-0's indicator was reused with no change to it.**
- **SA-CR-MK1 approved the code.** Its one item, C-1, removed the duplicate and unused copy constants (LL-4). QA passed with no bugs.

## What did not go well

- Dev ↔ SA back-and-forths: 1 (C-1, a cleanup). Dev ↔ QA bug fix cycles: 0. Blocked handshakes: none.

## Conclusions & process improvements

- **Delete copy constants made redundant by a rename in the same slice (LL-4).**
- **`BlockKpi` stays Finance-local for now.** MK-3 promotes it to a shared component.

### Status: APPROVED FOR COMMIT — feature/admin-money-mk1-names-block-kpis — commit pending (RM)

TL approval: APPROVED for RM (commit, PR, auto-merge)
