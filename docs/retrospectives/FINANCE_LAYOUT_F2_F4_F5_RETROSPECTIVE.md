# Retrospective: Finance on the admin layout standard (F-2, F-4, F-5)

> **Last Updated**: 2026-10-16

## Overview

This retrospective covers the three Finance layout-standard slices the finance stream owned: F-2, F-4 and F-5. Together they make up DF-4 / Money M-6, "Finance shell on the layout standard". The admin-layout session handed them over on 2026-10-15, after it had already merged F-0 (#414), F-1 (#418) and F-3 (#420). The user's final decisions, BD-28 to BD-31, framed all three slices:

- the h1 reads "Finance";
- the KPI tiles sit above the filter bar on both tabs;
- a bad link drops only the bad filter;
- the tiles are clickable.

**Status:** draft, written by TL. It has not been approved yet and is waiting for the user's review.

---

## Finance F-2, F-4, F-5 (DF-4 / Money M-6) — 2026-10-16

**MD links:** [BUSINESS_OS_FINANCE_HEALTH_REQUIREMENT.md](/docs/requirements/BUSINESS_OS_FINANCE_HEALTH_REQUIREMENT.md) §11G | [ADMIN_LAYOUT_STANDARD_REQUIREMENT.md](/docs/requirements/ADMIN_LAYOUT_STANDARD_REQUIREMENT.md) | [ADMIN_LAYOUT_FOLLOWUPS_REQUIREMENT.md](/docs/requirements/ADMIN_LAYOUT_FOLLOWUPS_REQUIREMENT.md) | [F-2 workplan](/docs/workplans/FINANCE_F2_HEADER_STATES_WORKPLAN.md) | [F-4 workplan](/docs/workplans/FINANCE_F4_FILTER_BAR_WORKPLAN.md) | [F-5 workplan](/docs/workplans/FINANCE_F5_KPI_TILES_WORKPLAN.md)

### Slice outcomes

| Slice | Path | PR | Outcome |
|---|---|---|---|
| F-2 header and states | UI short path | #424, merged | The page now uses `AdminPageHeader` (h1 "Finance"), `AdminLoading`, `AdminError` and `AdminNotice`, and the content area carries `aria-busy`. `adminReadFallback` is exported from the shared reader. Finance joined `MIGRATED_PAGES`. "Retry" became "Try again" everywhere on the page (F2-R2). SA approved with no conditions, and QA passed. |
| F-4 filter bar and URL state | Full cycle | #434, merged | `AdminFilterBar` and `useAdminFilters` own all eight keys, so each change is one write. The canonical keys are `range` and `account`, and the `preset` and `accountId` aliases are read forever. Refresh and Read-at moved into the bar, which ended DV-1. The bad-link notice was removed (BD-30, U-4 per key). The AC-173 request pin was written first and frozen. E-60 allows four intended request changes, and F4-R4 records the page deviations in the standard. Both stale `router.replace` comments were fixed. |
| F-5 KPI tiles | Full cycle (shared folder) | #437, open (auto-merge on); commit `24cf0c3d` | The shared `KpiStrip` gained the green, not-measured and unavailable statuses, an optional value, a `detail` line and a cross-page `link` mode. There is still a single green, `OK_GREEN`. The tiles sit above the bar on both tabs and in the picked view. K-2 to K-5 jump to their sections, and K-1 opens AI cost & usage on This month plus the business (W7(a), E-62). Finance no longer imports Health's `STATUS_STYLES`. SA approved with no conditions, and QA passed with no bugs. |

### What went well

- **Pins first, then frozen.** Each pin was written and run green on the unchanged tree before any product edit, and recorded by SHA-256:
  - F-4: the AC-173 request pin (15 literals, the route-schema hash and the serialiser hash).
  - F-5: Pin A (every one of the ten callers renders byte-identically) and Pin B (Finance tile values and statuses).

  QA recomputed the hashes at handover and they matched. As a result, the shared-folder change in F-5 reached ten other admin pages with no visible drift.
- **Display-only discipline held.** `git diff -- lib app/api supabase` was empty in all three slices (AC-182). No figure, request or payload changed, except the four named E-60 request changes for bad or non-canonical links, each pinned by its new literal.
- **SA rulings resolved the technical forks, not the user.** Examples: the notice removal (F-4 SA-W1), one spec for every key (SA-W2), and K-1 carrying This month (F-5 SA-W7). Only BD-28 to BD-31 went to the user, as business choices.
- **Mutations proved that the tests bite.** F-2 ran 4 mutations, F-4 ran 7 and F-5 ran 11. Each one failed a named test, and every file was restored by checksum.
- **The scoped `tsc` with a planted canary** caught one real type error in F-4 (`financeFilters.ts` account `serialise`) before review.
- **Approved deviations were small and reasoned.** Examples: the strip file was slimmed rather than deleted so the `lib/` SA-WR-34 guard stays unedited, and the F-2 tests went into the existing suite to reuse its fixtures.

### What did not go well

- **Dev ↔ SA back-and-forths: 1.** All three workplans were approved with conditions (F2-R1..R3, F4-R1..R5, F5-R1..R5), and those conditions were folded into implementation. Code review sent back only F-4, once: the SA-allowed pin amendment and two comment-only fixes. F-2 and F-5 were approved with no conditions.
- **Dev ↔ QA bug fix cycles: 0.** QA passed all three slices first time with no bugs.
- **Blocked handshakes:** none.
- **The handoff brief was wrong about F-3.** It said F-3 was merged while #420 was still open. TL had to fast-forward the F-2 branch once F-3 landed.
- **A frozen pin was load-sensitive.** The AC-173 pin used the default 1 s `findBy` wait, and one row timed out once under heavy parallel load. Because the file was frozen, fixing it took a formal SA-approved amendment: a 10 s wait and a 30 s per-test timeout, with a new frozen hash and a QA two-hunk proof. This was avoidable.
- **A flake outside the diff appeared in SA's F-5 re-run.** `bosLens.render.test.tsx` P-8 hit Jest's 5 s default under load. It passed on re-run, but it is a merge-queue risk.
- **QA conflict flags from unrecorded go-aheads.** Where the user's go-ahead lived only in the conversation and not in the requirement, QA flagged a conflict between the code and the document.

### Conclusions & process improvements

1. **Verify PR states before acting on a handoff.** Check every PR a handoff brief calls merged with `gh pr view` before branching from it.
2. **Use explicit timeouts from the start in any frozen pin.** Every `findBy…` gets an explicit wait (10 s) and every case a test timeout (30 s), because a frozen file cannot be loosened later without an amendment. F-5 applied this from Step 0 (F5-R4), with no incident.
3. **Freeze pins with hashes for shared-component and request-path changes.** Record the SHA-256 at Step 0 and at handover, and have QA recompute it. This kept merge-queue risk low and made "byte-identical" checkable.
4. **Record the user's go-ahead in the requirement.** Writing each decision there as it is made (BD rows, E-rows) prevents QA conflict flags.
5. **Name intended behaviour changes inside a "byte-identical" contract** (as in E-60), each with its own new pinned literal, rather than weakening the contract.

### Follow-ups

| # | Item | Owner |
|---|---|---|
| FU-1 | Harden the flaky `bosLens.render.test.tsx` P-8 (explicit wait and test timeout). A chip has been spawned. | Dev (chip) |
| FU-2 | Read-only browser looks L-106 to L-127 (F-2: L-106..L-111, F-4: L-112..L-119, F-5: L-120..L-127) | User |
| FU-3 | M-5: Money section in the sidebar, Health rule texts, Jobs cron wording (FU-M4-1) | Finance stream |
| FU-4 | M-7: resume 4b (refund dates), 5b (MRR) and 7 | Finance stream |
| FU-5 | M-8: remove the old pages | Finance stream |
| FU-6 | Open user question: should a refunded boost take its credits back? | User |

### Status: F-2 MERGED (#424) — F-4 MERGED (#434) — F-5 PR #437 (auto-merge on) — `feature/finance-f5-kpi-tiles` — commit `24cf0c3d`

---

## Change History

| Date | Change | Details |
|---|---|---|
| 2026-10-16 | Created | TL retrospective for F-2, F-4, F-5 (DF-4 / Money M-6); draft awaiting user approval |
| 2026-10-16 | F-5 commit recorded (RM) | F-5 committed `24cf0c3d`, PR #437 opened with auto-merge on |
