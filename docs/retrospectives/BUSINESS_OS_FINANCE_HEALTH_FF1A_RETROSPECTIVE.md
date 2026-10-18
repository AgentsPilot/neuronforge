# Retrospective: Finance follow-up FF-1a, Exchange rates page made read-only

> **Last Updated**: 2026-10-18

## Overview

FF-1a closes FU-M8-1. M-8 marked the Exchange rates admin page as redundant, but the page could still write the rate tables from the browser. FF-1a removes that write path, so the page is now read-only. It also adds check 35, a read-only SQL check that shows whether a browser session can still write the rate tables. There is no database change, no migration and no change to any money or figure. It was held from the FF-1 bundle until the user answered BQ-20, and runs under BD-33.

**MD links:** [BUSINESS_OS_FINANCE_HEALTH_REQUIREMENT.md](/docs/requirements/BUSINESS_OS_FINANCE_HEALTH_REQUIREMENT.md) | [BUSINESS_OS_FINANCE_HEALTH_FOLLOWUPS_FF1_WORKPLAN.md](/docs/workplans/BUSINESS_OS_FINANCE_HEALTH_FOLLOWUPS_FF1_WORKPLAN.md)

**Branch:** `feature/bos-finance-ff1a`, worktree `neuronforge-finance-m8`

---

## What went well

- **The business call went to the user, and only that.** BQ-20 became BD-36 on 2026-10-18. Splitting FF-1a out let FF-1b to FF-1d ship without waiting.
- **The change was safe because SA checked usage first.** SA had confirmed at SA-WR-FF1 that nothing in use depends on editing the rates.
- **Code review and QA were clean.** SA-CR-FF1a approved the code. Its one fix, FF1a-C1 (an unused import), was applied. QA passed with no bugs.
- **Check 35 makes the remaining exposure visible** without changing the database.
- **All seven frozen pins are unchanged.**

## What did not go well

- Number of Dev ↔ SA back-and-forths: 1 (FF1a-C1, an unused import).
- Number of Dev ↔ QA bug fix cycles: 0.
- Any blocked handshake and why: FF-1a waited on BQ-20, by design.
- **Read-only in the UI is not read-only in the database.** A browser session may still be able to write the rate tables directly; check 35 reports this but does not close it.

## Conclusions & process improvements

- **Split a business-gated item out of a bundle early,** so the technical items do not wait on it.
- **Follow-up FF-2 (recorded):** a later database lockdown that revokes browser writes on the rate tables, leaving reads untouched. It needs a migration, so it takes the user's hand-apply path, not BD-33. Check 35 is its before-and-after proof.

### Status: COMMITTED — feature/bos-finance-ff1a — commit `d9fe11f4`, PR #465 (auto-merge on)

---

## Change History

| Date | Change | Details |
|---|---|---|
| 2026-10-18 | Created (TL) | FF-1a retrospective after BD-36 (BQ-20), SA-CR-FF1a approved (FF1a-C1 applied) and a QA pass with no bugs; check 35 added; FF-2 recorded; no DB change |

TL approval: APPROVED for RM (commit, PR, auto-merge)
