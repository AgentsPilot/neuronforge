# Retrospective: Money M-8, mark the Platform dashboard and Exchange rates pages redundant

> **Last Updated**: 2026-10-17

## Overview

Money M-8 carries out BD-34. The Platform dashboard (legacy) and Exchange rates admin pages, and the `/api/admin/dashboard` route that only the dashboard calls, are kept but marked redundant in header comments. The only in-app link was a hidden parked-sidebar item, and it is removed. A new source guard stops anything linking to either page again. Exchange rates' one `console.error` now goes through Pino. There is no data, money, API logic or migration change. M-8 took the UI short path under the BD-32/BD-33 fast track: SA, QA and TL approve, then RM commits, opens the PR and turns on auto-merge.

**MD links:** [BUSINESS_OS_FINANCE_HEALTH_REQUIREMENT.md §11J](/docs/requirements/BUSINESS_OS_FINANCE_HEALTH_REQUIREMENT.md) | [BUSINESS_OS_FINANCE_HEALTH_M8_REDUNDANT_PAGES_WORKPLAN.md](/docs/workplans/BUSINESS_OS_FINANCE_HEALTH_M8_REDUNDANT_PAGES_WORKPLAN.md)

**Branch:** `feature/bos-money-m8` (from main `5c214310`), worktree `neuronforge-finance-m8`

---

## What went well

- **BQ-14 was settled from the user's own words, not sent to the user.** The BA asked whether to show a visible "redundant" notice. TL and SA answered it from BD-34 ("just add comments … and not use them"). SA's M8-R1 (E-71) dropped the notice, the wrapper and the render test, and the estimate fell from about 1 day to about 0.75 day.
- **The visible nav is byte-identical.** Only the hidden parked item, its unused `LayoutDashboard` import and three comments changed. The nav test's visible lists stayed unedited and green, so they prove it. The counts moved as expected: parked 15 → 14, in both places it is pinned, and hrefs 29 → 28.
- **The new guard has teeth.** `redundantPages.source.guard.test.ts` covers G-1 to G-5, and each rule has a planted control that must fail (M8-R3). QA also planted a real link and a real `fetch` in a temporary file, and G-4 failed and named the file both times.
- **One more file follows the logging standard.** Exchange rates' only `console.error` became `logger.error({ err }, …)`, matching the sibling dashboard page.
- **SA caught a live doc pointer the plan missed.** `docs/MULTI_CURRENCY_SYSTEM.md` still told admins to visit `/admin/exchange-rates` (M8-R2). Dev also found and fixed a second pin of the parked count, and two stale comments.
- **The CRLF worktree was handled correctly.** The seven frozen pins were checked LF-normalised (M8-R4), with `git diff --quiet HEAD` as the main proof. Dev, SA and QA each got the same seven hashes.
- **It ran in parallel without collisions.** M-8 went ahead while 4b.1 (#447) waits for the user to apply its migrations. Dev left the finance requirement to BA, so the two branches do not both edit it.

## What did not go well

- Number of Dev ↔ SA back-and-forths: 1. SA approved the workplan with conditions M8-R1 to M8-R4, Dev applied them, and the code review passed first time with no conditions.
- Number of Dev ↔ QA bug fix cycles: 0. QA passed with no bugs.
- Any blocked handshake and why: none.
- **The workplan was written around a notice the user had not asked for.** BQ-14's default ("show the notice") went into the plan before anyone read it against the exact BD-34 wording. SA's ruling removed it, but the plan's Steps 2 and 5 and its render test were written and then deleted.
- **The workplan missed one pin and one doc.** It named one of the two parked-count pins in the nav test, and two of the three stale docs.

## Conclusions & process improvements

- **Read an open BQ against the user's exact recorded words before giving it a default.** When a BD already answers it, close it there and leave it out of the plan.
- **Before an "N → M" count edit, grep the whole test file for every place N is pinned.**
- **Before planning doc pointers, grep `docs/` for every route a slice touches.** Do not rely on the docs you already know about.
- **In CRLF worktrees, keep LF-normalised hashes plus `git diff --quiet HEAD` as the standard pin proof.**
- **Follow-up FU-M8-1:** Exchange rates still writes from the browser. It is recorded only (a header comment and a MULTI_CURRENCY note), not fixed.
- **Next slice in the BD-32 order: 6b.** AI margin net of an estimated Stripe fee, plus the KPI re-order (revenue, then cost, then users), per BD-35.

### Status: COMMITTED — feature/bos-money-m8 — commit `92ef1454`, PR [#448](https://github.com/AgentsPilot/neuronforge/pull/448) (auto-merge on)

---

## Change History

| Date | Change | Details |
|---|---|---|
| 2026-10-17 | Created (TL) | M-8 retrospective after SA workplan approval (M8-R1 to M8-R4), SA code approval with no conditions and a QA pass with no bugs; fast track BD-33, no migration, auto-merge allowed |

TL approval: approved for RM commit + PR (auto-merge)
