# Workplan: Admin Layout LF-1 (contrast)

> **Last Updated**: 2026-10-13

**Developer:** Dev
**Requirement:** [ADMIN_LAYOUT_FOLLOWUPS_REQUIREMENT.md](/docs/requirements/ADMIN_LAYOUT_FOLLOWUPS_REQUIREMENT.md) §4, §7.1 (AC-1.1 to AC-1.3), §13 (SA-C13, SQ-8)
**Branch:** `feature/admin-layout-lf1` (cut from `feature/admin-layout-followups`, PR #336)
**Path:** UI short path (Dev, then SA code review and QA in parallel, then user diff, then RM)
**Date:** 2026-10-13
**Status:** PR #338 open — fast-track (SA + QA passed); the user merges

## Overview

Information text in `text-slate-500` is below WCAG AA 4.5:1 on Health, Scheduled jobs & queues and Audit trail (browser check BC-4). LF-1 changes it to `text-slate-400` (the standard's T-5 colour), plus the Activity half of F-116 (SA SQ-8). Class-only: no word, behaviour, data or request change. Borders (`border-slate-600`), underline decoration (`decoration-slate-500`), placeholders and disabled styling are not touched.

## Analysis Summary

Read of the worktree on 2026-10-13. No `text-slate-600` text exists in any in-scope file; every `slate-600` there is a border, so only `text-slate-500` changes.

### Information lines listed (AC-1.1, SA-C13)

| Page | File | Lines | Count |
|---|---|---|---|
| Health | `app/admin/components/health/HealthTile.tsx` | 136 footnote, 158 rule condition, 162 rule otherwise | 3 |
| Health | `HealthGrid.tsx`, `app/admin/page.tsx` | none | 0 |
| Jobs & queues | `app/admin/components/jobs/JobsQueuesView.tsx` | 174, 178, 196, 201, 202, 222, 235, 275, 304, 305, 401, 408, 432 | 13 |
| Jobs & queues | `QueueItemsPanel.tsx` | 258 (table head) | 1 |
| Jobs & queues | `DrainNowDialog.tsx`, `CancelQueueItemDialog.tsx`, `RetryQueueItemDialog.tsx` | one hint line each (254, 285, 342) | 3 |
| Audit trail | `app/admin/audit-trail/page.tsx` | 378, 515, 562, 1075, 1083 (SA-C13), plus 1218 ("Entity id" label), 1229 and 1243 (empty-value dash) | 8 |
| Activity (F-116) | `business-os-llm/components/activity/ActivityDrillDown.tsx` | 94 ("Unknown"), 187 (business short id) | 2 |
| Activity (F-116) | `AuditSummaryLine.tsx` | 44, 48 | 2 |
| Activity (F-116) | `DeletedAccountsBucket.tsx` | 39 | 1 |
| Activity (F-116) | `RecordStateMarker.tsx` | 110 ("None") | 1 |

Total 34 classes in 11 files. The Jobs count matches F-95's 17 uses. Audit trail's 8 matches the browser count of 8.

### Left alone, by name

- `app/admin/audit-trail/BusinessAccountPicker.tsx`: Finance imports it (F-112); the audit-trail page now uses the shared `AdminBusinessPicker`.
- `users/components/CreditsBlock.tsx:380`: LF-4b (money file).
- `finance/components/FinanceView.tsx:61`: the finance adoption slice.
- `business-os-llm/components/Chip.tsx`: retiring it is F-116's component half, out of LF-1 (SQ-8). Its classes are slate-200 / slate-400 text anyway.

## Implementation Approach

1. Edit the 34 classes in place (`text-slate-500` to `text-slate-400`), nothing else on the line.
2. Pinned-class check before editing: `health.qa-slice5.render` pins green only, no slate class (SA-C13 check done); Health, Jobs and Audit trail suites pin no slate-500. One Activity assertion (`activityLayout.render` T-13) says "slate-500 survives only in the record-state marker": after LF-1 none survives, so it is tightened to "no slate-500 in the table" (a stronger assertion, not a weaker one), with the reason in its comment.
3. New guard `app/admin/__tests__/contrast.lf1.source.guard.test.ts`: one case per page (Health, Jobs & queues, Audit trail, Activity), each WALKING its folder (Audit trail: `page.tsx` and `auditTrailFilters.ts`, the picker excluded by name), refusing `text-slate-500` and `text-slate-600` (any variant prefix such as `hover:`). The rule is proved on planted strings, including that a border, `decoration-slate-500` and `text-slate-400` pass. The regex uses character classes only, no backslash.

## Files to Create / Modify

| File | Action | Reason |
|---|---|---|
| `app/admin/components/health/HealthTile.tsx` | modify | 3 classes |
| `app/admin/components/jobs/JobsQueuesView.tsx` | modify | 13 classes |
| `app/admin/components/jobs/QueueItemsPanel.tsx` | modify | 1 class |
| `app/admin/components/jobs/DrainNowDialog.tsx` | modify | 1 class |
| `app/admin/components/jobs/CancelQueueItemDialog.tsx` | modify | 1 class |
| `app/admin/components/jobs/RetryQueueItemDialog.tsx` | modify | 1 class |
| `app/admin/audit-trail/page.tsx` | modify | 8 classes |
| `app/admin/business-os-llm/components/activity/ActivityDrillDown.tsx` | modify | 2 classes |
| `app/admin/business-os-llm/components/activity/AuditSummaryLine.tsx` | modify | 2 classes |
| `app/admin/business-os-llm/components/activity/DeletedAccountsBucket.tsx` | modify | 1 class |
| `app/admin/business-os-llm/components/activity/RecordStateMarker.tsx` | modify | 1 class |
| `app/admin/business-os-llm/__tests__/activityLayout.render.test.tsx` | modify | T-13 tightened: no slate-500 left in the table |
| `app/admin/__tests__/contrast.lf1.source.guard.test.ts` | create | per-page guard against slate-500 / slate-600 text |
| `docs/requirements/ADMIN_LAYOUT_FOLLOWUPS_REQUIREMENT.md` | modify | §1 LF-1 row, Change History |

## Task List

- [x] 1. Pinned-class check (health.qa-slice5, Health, Jobs, Audit trail, Activity suites)
- [x] 2. Health: 3 classes
- [x] 3. Jobs & queues: 17 classes in 5 files
- [x] 4. Audit trail: 8 classes
- [x] 5. Activity (F-116 half): 6 classes in 4 files
- [x] 6. Tighten `activityLayout.render` T-13
- [x] 7. New guard `contrast.lf1.source.guard`
- [x] 8. Runs: jest (app/admin/components, app/admin/__tests__, app/admin/audit-trail, app/admin/business-os-llm), authz guard, tailwind guard, lint:hooks, scoped tsc with canary, `git diff --numstat`
- [x] 9. Requirement §1 row and Change History

## Tests

| Suite | What it proves |
|---|---|
| `contrast.lf1.source.guard` (new) | No `text-slate-500` or `text-slate-600` in any walked file of the four pages; the rule catches planted dim text and passes borders, decoration and slate-400; the walk found the expected files |
| `activityLayout.render` T-13 (tightened) | The Activity table renders no slate-500 element |
| Existing Health, Jobs, Audit trail, Activity suites | Unchanged and green (AC-1.3: no weakened assertion) |

## Browser checks owed (QB-x)

Dark scheme, desktop width, as an admin. Contrast measured against the page background, as in BC-4.

| # | Check | Expected |
|---|---|---|
| QB-1 | Health (`/admin`): tile footnotes and the rule lines ("when ...", "otherwise ...") | Readable, every element at or above 4.5:1; 0 below (was 36 at 3.07:1) |
| QB-2 | Scheduled jobs & queues: job cards (schedule, time limit, "No run recorded", Late after, Stopped after, "—", "None"), queue cards ("Drained by", "Failures are ...", note), the summary lines and table head | 0 elements below 4.5:1 (was about 88 at 4.16:1) |
| QB-3 | Jobs & queues: open a queue's items panel (table head) and each of Drain now, Cancel, Retry dialogs (hint line under the reason field) | Text readable at or above 4.5:1; buttons, borders and disabled state look as before |
| QB-4 | Audit trail: the count line with "(Page N of M)" and, with a search, "(Page N)" | At or above 4.5:1 |
| QB-5 | Audit trail table: a row with no business and a system row (the "—" cells), a row with no resource name ("Entity id") | At or above 4.5:1 |
| QB-6 | Audit trail detail: an AIS score change (Multiplier line) and a normalization ranges change (category, "+ N more ranges") | At or above 4.5:1 |
| QB-7 | Business OS AI, Activity tab: the audit summary lines, the deleted-accounts bucket note, a "None" record-state marker, the drill-down's business short id and an "Unknown" field | At or above 4.5:1 |
| QB-8 | All four pages | No word changed, no layout shift, same requests in the network tab as before |

## Implementation Notes

- 34 classes changed in 11 files, every changed line a 1-for-1 swap (`git diff --numstat` equal added and removed per file; no deletion-only file).
- Jest: `app/admin/components`, `app/admin/__tests__`, `app/admin/audit-trail`, `app/admin/business-os-llm`, the authz surface guard and the Tailwind escape guard: 68 suites, 2200 tests, all green. The new guard is 27 tests; a planted `text-slate-500` on `RecordStateMarker.tsx` turned it red (1 failed), then reverted.
- `lint:hooks` clean. Scoped `tsc` over the changed files and the new guard: only the canary error.
- No `console.*`, no `any`, no backslash in the new guard or this file.

## SA Review Notes

### SA Code Review

**Code Review by SA, 2026-10-13**
**Status:** Code Approved

| Check | Result |
|---|---|
| Class-only | With the class swapped out, `git diff -U0` leaves no other change: 34 `text-slate-500` lines become `text-slate-400` in 11 app files. No text, handler, prop or request changed |
| Disabled and placeholder | No changed line has a `disabled:` or `placeholder` class |
| SA-C13 | `audit-trail/page.tsx` lines 378, 515, 562, 1075 and 1083 are all moved, plus the "Entity id" label and two dashes. No slate-500 or slate-600 text is left in the walked folders, except in the excluded picker |
| Guard catches regressions | Mutation run: a `hover:text-slate-500` planted in `HealthTile.tsx`, and a new `components/jobs/zzMutant.tsx` with `text-slate-600`. Result: 2 failed, 26 passed. Both were reverted and the guard is green again |
| Walk and exclusion | The walk recurses, skips `__tests__` and snapshots, and asserts that the files it found exist. `BusinessAccountPicker.tsx` is excluded by exact path and the exclusion is asserted. Finance still imports the picker (`FinanceFilterBar.tsx`) and the audit page does not, so leaving it for the finance slice is correct. If the file is ever moved, the guard fails rather than passing in silence |
| T-13 | Tightened from "markers only" to zero `text-slate-500`, which is stricter than before. `activityLayout.render` is green (65 tests across both suites) |
| Scope | Nothing changed under Businesses, Finance or the parked pages |
| Backslashes | None in the guard, this workplan or the requirement |

No fixes required. The browser checks QB-1 to QB-8 are still owed by QA.

## QA Testing Report

[QA will populate this section]

## Commit Info

| Item | Value |
|---|---|
| Branch | `feature/admin-layout-lf1` |
| Code commit | `b5939019` |
| Merge of `origin/main` | `d4741aa2` (clean) |
| PR | [#338](https://github.com/AgentsPilot/neuronforge/pull/338), open, fast-track; not merged by RM |
| Re-run after merge | Jest 68 suites / 2200 tests green; `lint:hooks` clean; `typecheck:bos-llm` passed (0 new) |

## Change History

| Date | Change | Details |
|---|---|---|
| 2026-10-13 | Created and built (Dev) | UI short path: 34 classes in 11 files, one tightened assertion, one new guard |
| 2026-10-13 | SA code review | Code approved, no fixes required |
| 2026-10-13 | QA (TL, browser) | PASS: 0 elements below 4.5:1 on all four pages |
| 2026-10-13 | Committed, PR opened (RM) | `b5939019`, merged `origin/main` (`d4741aa2`), PR #338 open under the admin-layout fast-track |

## QA Report (TL, browser) — 2026-10-13

**Verdict: PASS.** Live check in the in-app browser (local dev server on this branch, signed-in admin, dark mode), measuring WCAG contrast of every visible text element against its effective background:

| Page | Before (2026-10-13 sweep) | After |
|---|---|---|
| Health | 36 elements at 3.07:1 | 0 below 4.5:1; 0 text-slate-500, 59 text-slate-400, 7 tiles loaded |
| Jobs & queues | ~88 elements at 4.16:1 | 0 below 4.5:1 (page fully loaded) |
| Audit trail | 8 elements at 4.16:1 | 0 below 4.5:1 |
| BOS AI Activity | — | 0 below 4.5:1 |

Read-only: nothing was clicked. Jest set, guard mutation and lint results are in the Dev and SA sections.
