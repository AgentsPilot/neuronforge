# Retrospective: Money M-5, the Money section

> **Last Updated**: 2026-10-17

## Overview

This retrospective covers Money M-5, "The Money section", from the finance stream. M-5 adds a Money section to the admin sidebar, moves the Costs & credits report and its Leak check from Business OS AI to a new Charge checks page, renames "AI cost & usage" to "AI calls & usage", and closes FU-M4-1 (the Health rule and cron wording). There is no data, money, API or migration change. Under the user's standing go-ahead (BD-32, BD-33, 2026-10-16), each slice proceeds once SA, QA and TL approve. RM then commits, opens the PR and turns on auto-merge.

**Status:** SA approved (workplan with conditions M5-R1 to M5-R4, code with no conditions). QA passed with no bugs. TL approves for RM below. Nothing is committed yet.

---

## Money M-5, the Money section — 2026-10-17

**MD links:** [BUSINESS_OS_FINANCE_HEALTH_REQUIREMENT.md](/docs/requirements/BUSINESS_OS_FINANCE_HEALTH_REQUIREMENT.md) §11H | [ADMIN_COST_REVENUE_CONSOLIDATION_REVIEW.md](/docs/requirements/ADMIN_COST_REVENUE_CONSOLIDATION_REVIEW.md) §8 | [M-5 workplan](/docs/workplans/BUSINESS_OS_FINANCE_HEALTH_M5_MONEY_SECTION_WORKPLAN.md) | Comparison: [F-2, F-4, F-5 retrospective](/docs/retrospectives/FINANCE_LAYOUT_F2_F4_F5_RETROSPECTIVE.md)

### What shipped

| Area | Outcome |
|---|---|
| Sidebar | A new **Money** section follows Monitor. It holds Finance (first, BD-21), Charge checks and AI calls & usage (detail). Monitor now has four pages: Health, Scheduled jobs & queues, Audit trail and Archiving. Business OS AI reads "Models, temperatures & AI activity". |
| Charge checks | Costs & credits, Leak check included, moved to `/admin/finance/charges` **as it is** (`git diff` on the costs components is empty). Business OS AI keeps only Settings and Activity. |
| Old links | A temporary (307) `next.config.js` redirect sends `/admin/business-os-llm?tab=costs` to Charge checks and keeps the window and business keys. `curl -sI` confirmed it; `tab=settings`, `tab=activity` and no tab are not redirected. |
| In-app links | `costsHref` and `leakCheckHref` point at the new path at source, with no `tab`. No product link to `tab=costs` remains. |
| Copy | S-1 to S-18 now say "AI calls & usage". S-18 (`ANALYTICS_WHAT`) was renamed in this slice rather than left as a follow-up (M5-R2). FU-M4-1 is closed: the Health rule texts and the leak-check cron text no longer say "spend". |
| Health tile | The "Recorded AI cost" tile now links to Finance ("Charged AI cost: open Finance"). `evaluateHealth.ts` changes only that link and three wordings (+14/−3); SA verified that no rule, metric, threshold, id or colour changed. |

### What went well

- **New frozen pins, written first.** Pin C (the same report and Leak check requests on the old page and on Charge checks) and Pin D (Health rules and the cron entry change wording only) were green on the unchanged tree before any product edit. Pin C is one file that mounts whichever page exists, so it proves equality across the move. SA and QA each recomputed all seven hashes: the two new pins, Pin C's helper and the four existing pins (AC-173 pin and helper, Pin A, Pin B). The four existing pins were never opened.
- **The F-2/F-4/F-5 lesson was applied from the start.** Every Pin C wait carried an explicit 10 s timeout and only `Date` was faked, so no frozen-pin amendment was needed this time.
- **SA saved coverage.** The workplan proposed deleting X-8, X-8b and X-10. SA ruled (M5-R1) that they test L-9a lag-window timing that still exists between Activity and Settings. They were re-scoped, not deleted, so the L-9a coverage is kept. Only X-1, X-2, X-3, X-12 and one `costsTab` case, which need two filter tabs, were removed, each named with its reason.
- **SA settled the technical forks.** The redirect over middleware, the costs files staying in place (which keeps Pin A valid), the stray `tab` key and the floor-preserving rename were all ruled by SA, not asked of the user.
- **Mutations bit.** 11 mutations were run and each failed a named test. The two not run (Money order, a duplicate C-14 entry) are covered by exact-list assertions.
- **Scope held.** `git diff` was empty for `app/api`, `lib/repositories`, `supabase` and the costs components. `test:authz-guard`, `test:bos-entitlements` and `lint:hooks` were green, and a scoped `tsc` with a planted canary was clean.

### What did not go well

- **Dev ↔ SA back-and-forths: 0.** The workplan was approved with four conditions (M5-R1 to M5-R4) at the first review, and the code was approved at the first review with no conditions.
- **Dev ↔ QA bug fix cycles: 0.** QA passed first time with no bugs.
- **Blocked handshakes:** none.
- **The workplan's first test plan would have lost coverage.** Dev listed X-8, X-8b and X-10 for deletion. SA caught it. A test should only be deleted when the behaviour it covers is gone, not when the setup it used is gone.
- **Two load-sensitive tests surfaced again.** `bosLens.render` P-8 (already seen in F-5) and the `jobs-queues` `qa-slice5-pr2` wall-clock case (`< 1000` ms, failed at 1344 ms under combined load). Neither file is in this diff. They went out as one combined fix chip, outside this PR, so they remain a merge-queue risk until that lands.
- **Accepted low notes from QA:**
  - `tab=costs` stays in the Charge checks URL after the redirect until the first filter change. It is cosmetic and ignored by the page (SA-W1, accepted).
  - 14 code comments (JSDoc) still say "AI cost & usage". Nothing is rendered. Optional tidy-up.

### Conclusions & process improvements

1. **Before deleting a test, ask whether its behaviour still exists.** If it does, re-scope the test to the setup that remains (M5-R1).
2. **A dual-mount frozen pin proves a page move.** One unedited file that runs on both the old and new page is stronger than a standalone component pin.
3. **Keep explicit waits in every frozen pin from Step 0.** This is now the norm; it cost nothing here and avoided an amendment.
4. **Wall-clock assertions do not belong in tests that run in the merge queue.** The combined chip should remove the bound or use fake timers, as SA suggested.
5. **Rename rather than remove a constant when a vocabulary floor depends on it,** instead of lowering the floor.

### Follow-ups

| # | Item | Owner |
|---|---|---|
| FU-M5-1 | Closed in this slice: `ANALYTICS_WHAT` renamed as S-18 (M5-R2) | — |
| FU-M5-2 | Refresh the costs components' header comments when they are moved to their final folder (SA-W9, SA-Q59 later move) | Finance stream |
| FU-M5-3 | Harden `bosLens.render` P-8 and `qa-slice5-pr2` wall-clock test (one combined chip, outside this PR) | Dev (chip) |
| FU-M5-4 | Optional: update the 14 JSDoc comments that still say "AI cost & usage" | Finance stream |
| FU-M5-5 | Read-only browser look after merge, L-128 to L-136 | User |
| FU-M5-6 | Remove the temporary `?tab=costs` redirect once old links have aged out (with M-8, old-page removal) | Finance stream |

### What is next

- **4b (refund dates)**, next in the BD-32 order. It needs a prod migration that the user applies by hand, so its PR stays **off** auto-merge until the user confirms the migration is applied.
- **Open business question BQ-13:** should a refunded boost take back its credits? Today's behaviour is kept until the user decides.

### Status: APPROVED, NOT YET COMMITTED — `feature/bos-money-m5` — commit hash to be recorded by RM

**TL approval: approved for RM commit + PR** (BD-33: SA approved, QA passed, TL approved, 2026-10-17). RM sets auto-merge, because this slice has no migration or manual gate.

---

## Change History

| Date | Change | Details |
|---|---|---|
| 2026-10-17 | Created | TL retrospective for Money M-5, the Money section; TL approval for RM commit + PR under BD-33 |
