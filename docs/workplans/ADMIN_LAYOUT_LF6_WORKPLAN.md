# Workplan: Admin Layout LF-6 (Finance page: filter bar alignment)

> **Last Updated**: 2026-10-14

**Developer:** Dev
**Requirement:** [ADMIN_LAYOUT_FOLLOWUPS_REQUIREMENT.md](/docs/requirements/ADMIN_LAYOUT_FOLLOWUPS_REQUIREMENT.md) §1 LF-6 (user request 2026-10-14, screenshot)
**Branch:** `fix/admin-layout-lf6-finance-filter-bar` (from `origin/main` 49b66feb)
**Path:** UI short path (Dev, then SA code review and QA in parallel, then user diff, then RM)
**Date:** 2026-10-14
**Status:** PR #362 open — fast-track (SA passed); the user merges

## Overview

On `/admin/finance` the filter bar row is `items-end`. The Account picker (the old `audit-trail/BusinessAccountPicker`) carries a two-line help line under its input, so its column is the tallest; bottom-aligned, the presets, From (UTC), To (UTC) and Apply drop to the bottom while the Account label and input float above them. This is the glitch L-4a fixed on the shared bar (see [ADMIN_LAYOUT_L4A_WORKPLAN.md](/docs/workplans/ADMIN_LAYOUT_L4A_WORKPLAN.md) §2.2). LF-6 applies the same technique locally in `FinanceFilterBar.tsx`. Layout and classes only: no filter, date, URL, request, data or wording change.

## Analysis Summary

| Where | Fact |
|---|---|
| `app/admin/finance/components/FinanceFilterBar.tsx:56` | Controls row `flex flex-wrap items-end gap-3` |
| `:57` | Window group has no visible label, so with `items-start` it would sit a label row higher than the fields |
| `:80-87` | From / To are `label.flex.flex-col` with the text directly above the input (no gap): about 16.5 px of label, against the picker's 20 px (`text-xs` + `mb-1`) |
| `:88-94` | Apply has no label |
| `:96-101` | Picker in a `w-64` column; the help line is inside the picker (`audit-trail/BusinessAccountPicker.tsx:336`), under its input |
| Heights | Picker input about 34 px (`py-1.5 text-sm`); finance inputs and Apply about 26 px (`py-1 text-xs`); preset frame about 30 px |

No finance test pins any filter-bar class (`financePage.render` mocks the picker to `null`; neither source guard reads these classes). No guard forbids a finance import of `AdminFieldSpacer` from `@/app/admin/components/layout/AdminFilterBar` (the re-export pages already use).

## Implementation Approach

1. Row `items-end` to `items-start` (L-4a §2.2).
2. Label-less controls (the Window group and Apply) each sit under `AdminFieldSpacer` (imported, not edited), so their control starts on the same line as a labelled input.
3. From / To labels gain `gap-1`, so their label row is the spacer's height (`text-[11px]` line plus 4 px, the same as `ADMIN_FIELD_LABEL`'s `mb-1`); the picker's own label is 20 px, within half a pixel.
4. Control heights matched to the picker input (about 34 px), the L-4a SA Q-6 rule: date inputs and Apply `py-1` to `py-2`, preset buttons `py-1` to `py-1.5`. Text size unchanged.
5. The help line stays where it is, under the picker input inside the picker column. With `items-start` it only grows that column downward and moves no other control. The picker file is not edited.

Not done: adopting `AdminFilterBar` / `AdminBusinessPicker` (the finance adoption slice), any shared-folder edit, any copy change.

## Files to Create / Modify

| File | Action | Reason |
|---|---|---|
| `app/admin/finance/components/FinanceFilterBar.tsx` | modify | Row alignment, two spacers, label gap, control heights |
| `app/admin/finance/__tests__/financeFilterBar.layout.render.test.tsx` | create | Pins the alignment |
| `docs/requirements/ADMIN_LAYOUT_FOLLOWUPS_REQUIREMENT.md` | modify | §1 LF-6 row, Change History row |
| `docs/workplans/ADMIN_LAYOUT_LF6_WORKPLAN.md` | create | This workplan |

## Task List

- ✅ Step 1: Workplan
- ✅ Step 2: `FinanceFilterBar.tsx` layout and classes
- ✅ Step 3: Layout render test
- ✅ Step 4: Runs: jest `app/admin/finance lib/business-os/finance app/admin/components`, tailwind guard, `lint:hooks`
- ✅ Step 5: Requirement §1 row and Change History

## SA Review Notes

### SA Code Review

**Code Review by SA — 2026-10-14**
**Status:** ✅ Code Approved (no fixes)

1. `FinanceFilterBar.tsx` — classes and wrapper divs only. No change to handlers, `onChange` payloads, the Apply gate, URL, requests or copy. `AdminFieldSpacer` comes from the shared `AdminFilterBar` re-export; the shared folder is unedited. The finance `source.guard` still passes, so the import is allowed.
2. Padding beyond "top-align + spacer" (inputs and Apply `py-2`, presets `py-1.5` in the `p-0.5` frame) — **accepted**. It is the L-4a SA Q-6 rule (controls end on one line), and it is scoped to this file.
3. `financeFilterBar.layout.render` — sensible class and structure pins: row `items-start`, spacer columns for Window and Apply, `gap-1` label rows, control heights, and the help line kept inside the picker column (5 row items). The stand-in picker is acceptable because jsdom does not lay out.
4. The 2 failing DF-5 tests in `finance.source.guard` are **not caused by this slice and do not block it**. Confirmed: `git ls-files --eol` reports `i/lf w/crlf` for `boostRevenue.ts` (`core.autocrlf=true`), and the guard slices on `indexOf` of a newline-brace-newline sequence, which a CRLF working copy never matches. CI checks out LF on Linux, and this slice does not touch either file. Optional follow-up chip: normalise CRLF in the guard's `codeOf`, so it also passes on Windows.
5. Run: `npx jest app/admin/finance --ci` — 4 suites, 116 tests passed.

**Code Approved for QA: Yes**

## QA Testing Report

No separate QA: class-only UI slice, proportionate-effort rule. SA ran the finance suites green (see SA Code Review item 5).

## Commit Info

| Item | Value |
|---|---|
| Branch | `fix/admin-layout-lf6-finance-filter-bar` |
| Code commit | `13c03014` |
| Merge of `origin/main` | `d0f996d0` |
| PR | [#362](https://github.com/AgentsPilot/neuronforge/pull/362) — open, fast-track; the user merges |
| RM test run | 27 suites / 814 tests passed (`app/admin/finance`, `app/admin/components`, tailwind-css-escape guard); `lint:hooks` clean |
