# Retrospective: MK-3b, the Calls tab (AI cost page complete)

> **Last Updated**: 2026-10-26

**Branch:** `feature/admin-money-mk3b-calls-tab`, worktree `neuronforge-finance-mk3` | **Workplan:** [ADMIN_MONEY_MK3_AI_COST_PAGE_WORKPLAN.md](/docs/workplans/ADMIN_MONEY_MK3_AI_COST_PAGE_WORKPLAN.md)

## Overview

MK-3b adds the Calls tab and completes the AI cost page; MK-3a merged as #517. It includes:
- one page spec;
- the report read lifted into `useCostReport`;
- a tab list with "Summary & checks" and "Calls";
- Calls built from the old analytics page, with `AnalyticsKpis` turned into summary cards and filter links;
- whole-UTC-day windows, with no 24h option;
- a redirect from `/admin/analytics`, and every internal link pointed direct;
- the sidebar's Money section reduced to Finance and AI cost, with the Coins icon (closing MK3A-FU-2).

## What went well

- **The old analytics page now lives in one place.** It is a tab of AI cost, with one spec and one shared report read.
- **SA kept a technical call with SA.** Mounting only the shown tab was accepted as a technical choice, not a business question: a Leak check result was already lost today, between the two separate pages. SA also accepted the Pin A re-hash inside the one re-freeze.
- **QA passed with no bugs.** Its one Low edge case was fixed before commit (see below).
- **Pins moved only as ruled.**
  - Pin A: `4e2a93aa` → `a130d560`.
  - Unchanged: Pin C (`e57f2675` and `64a565e9`), AC-145 (`33340751`), AC-173, Pin B and Pin D.
  - The request-pin row updates are ruled, and only the Calls drill-down `dateTo` moved.

## What did not go well

- Dev ↔ SA back-and-forths: 1. SA-CR-MK3B required two fixes, and SA's re-check then passed:
  - F-1 (High): when the report read failed on Calls, the strip disappeared without a word. It now shows the notice, or the error with Try again.
  - F-2 (Medium): the old filter spec, which only tests still used, was retired.
- Dev ↔ QA bug fix cycles: 1. E-1 (Low): the Calls day ended at `.999999Z`, while A-K2's ended at `.999Z`. It was aligned and pinned by T-12 rows.
- Blocked handshakes: none.

## Conclusions & process improvements

- **When content moves between tabs, its error path must move with it.** F-1 was caught only in review.
- **Use one day-end helper.** Two conventions (microseconds and milliseconds) existed side by side.
- **Next:** the last Page 2 slice, the AI cost business drawer and the billing-period drawer.

### Status: APPROVED FOR COMMIT — feature/admin-money-mk3b-calls-tab — commit pending (RM)

TL approval: APPROVED for RM (commit, PR, auto-merge)
