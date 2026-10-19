# Retrospective: MK-0, the shared leading/lagging KPI indicator

> **Last Updated**: 2026-10-19

## Overview

MK-0 is the first slice of the Money restructure. It adds an optional `indicator` prop to the shared `KpiTile`, and exports a `KpiIndicator` for KPIs shown inside blocks. The tooltip is built in-house and is accessible, with no new dependency (SA-8). The icon sits beside the tile link, never inside it, so clicking a tile still goes where it did. No tile uses the indicator yet; the first use is MK-5. All seven frozen pins are unchanged, and there is no migration.

**MD links:** [ADMIN_MONEY_MK0_KPI_INDICATOR_WORKPLAN.md](/docs/workplans/ADMIN_MONEY_MK0_KPI_INDICATOR_WORKPLAN.md)

**Branch:** `feature/admin-money-mk0-kpi-indicator`, worktree `neuronforge-finance-m8`

---

## What went well

- **No new dependency.** The in-house tooltip meets SA-8 and the accessibility needs.
- **Existing callers are unaffected.** The prop is optional, the icon is outside the link, and Pin A and the other six pins kept their bytes.
- **SA-MK0 approved the code with no conditions,** including D-1 (a click also opens the tooltip).
- **QA's one Low finding was fixed and tested.** QA-MK0-N1: pressing Escape on the tooltip would also close a parent drawer. Now an open tooltip consumes Escape, and a closed one lets it pass through. Three tests were added.

## What did not go well

- Number of Dev ↔ SA back-and-forths: 0. Number of Dev ↔ QA bug fix cycles: 1 (QA-MK0-N1, Low).
- Any blocked handshake and why: none.
- **Escape inside nested overlays was not in the plan.** It was caught by QA, not by the workplan.
- **The full local gate still shows the 140 Windows-only failures.** They are the same set as R4's, none involve this diff, and Linux CI is authoritative.

## Conclusions & process improvements

- **Any shared overlay primitive must define how it handles Escape inside a parent overlay**, and test both the open and closed cases.
- **Next:** MK-1.

### Status: COMMITTED — feature/admin-money-mk0-kpi-indicator — commit `9583426c`, PR #474 (auto-merge on)

TL approval: APPROVED for RM (commit, PR, auto-merge)
