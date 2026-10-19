# Retrospective: MK-5, Finance strip re-cut with $ folded in

> **Last Updated**: 2026-10-19

**MD links:** [ADMIN_MONEY_MK5_STRIP_USD_WORKPLAN.md](/docs/workplans/ADMIN_MONEY_MK5_STRIP_USD_WORKPLAN.md) | **Branch:** `feature/admin-money-mk5-strip-usd`, worktree `neuronforge-finance-m8`

## Overview

The KPI strip is re-cut to five tiles: Revenue received, MRR now, Charged AI cost, AI margin and Paying %. Each tile carries its leading or lagging icon (MK-0). Money is shown as `$` through `formatUsdSign`, which only formats USD; other currencies appear only as a count, and nothing is summed across currencies (BD-12). K-3 and K-4 move into their blocks, and the margin tile gains the FC-2 tooltip. There is no migration.

## What went well

- **The `$` display is USD-only by construction.** No figure can mix currencies.
- **SA-CR-MK5 approved the code.** Its two Low conditions were fixed:
  - C-1: platform accounts are excluded from Paying %.
  - C-2: the K-2 chip takes its status from the rule, not from the page.
- **The platform margin stayed inside the ruled AC-145 re-freeze.** QA passed with no bugs.
- **Pins moved only as ruled:**
  - Pin B: `24ff0da7` → `a1b3db0c`.
  - Pin A: `30f5fc24` → `6547dcf7`.
  - AC-145: `30275c29` → `a13f1ccd`.

  The other pins kept their bytes.
- **The MK-4 workplan's QA status was updated to fixed.**

## What did not go well

- Dev ↔ SA back-and-forths: 1 (C-1 and C-2, both Low). Dev ↔ QA bug fix cycles: 0. Blocked handshakes: none.
- **Two rule details were left to the page and caught only at code review:** which accounts count toward Paying %, and where the chip status comes from.

## Conclusions & process improvements

- **A status or ratio on a tile must come from the shared rule, never be re-derived on the page** (C-2).
- **Every "% of accounts" figure must state its denominator in the workplan,** including whether platform accounts are excluded (C-1).
- **Next:** MK-5b, Converted this month.

### Status: APPROVED FOR COMMIT — feature/admin-money-mk5-strip-usd — commit pending (RM)

TL approval: APPROVED for RM (commit, PR, auto-merge)
