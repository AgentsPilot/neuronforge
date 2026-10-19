# Retrospective: MK-0a, KPI indicator word pill and tooltip placement

> **Last Updated**: 2026-10-20

**Branch:** `fix/admin-kpi-indicator-word-pill`, worktree `neuronforge-finance-m8`. The user approved MK-0a on 2026-10-19, after seeing MK-5 live.

## Overview

The leading/lagging icon is replaced by a neutral "Leading" or "Lagging" word pill. The tooltip opens below the tile, at the tile's width, and flips above when it would run off the bottom of the screen. Every `KpiStrip` tile is now the same size on every page that uses the strip.

## What went well

- **The change came from the user seeing the real page,** and it shipped the next day.
- **SA-MK0A approved the code.** Pin A was re-frozen as intended (`e7d8da20` → `98cadff3`, 40 cases), and every other pin is unchanged.
- **QA passed with no bugs, checked in headless Chrome.** Two of QA's optional findings were applied: the tooltip stays on screen at phone width, and the flip uses the tooltip's measured height plus 16px.

## What did not go well

- Dev ↔ SA back-and-forths: 0. Dev ↔ QA bug fix cycles: 0 (both optional findings were applied). Blocked handshakes: none.
- **Three suites failed under load and passed when run alone.** This is the known load-flake class.
- **QA saw a type error in a system-config test on main.** It predates this change and is not caused by it.

## Conclusions & process improvements

- **Check UI on a real browser at phone width before release,** not only in Jest.
- **Follow-up:** the pre-existing type error in the system-config test on main still needs an owner.

### Status: APPROVED FOR COMMIT — fix/admin-kpi-indicator-word-pill — commit pending (RM)

TL approval: APPROVED for RM (commit, PR, auto-merge)
