# Workplan: Finance F-1, contrast, shared tables and the section status chip

**Developer:** Dev
**Branch:** `fix/finance-f1-contrast-tables` (from origin/main 70b609f2)
**Requirement:** the read-only Finance vs Admin Layout Standard review of 2026-10-15, slice F-1 (user-approved). F-0 = PR #414; F-2, F-4 and F-5 belong to the finance session.
**Date:** 2026-10-15
**Status:** Code Complete

## Analysis Summary

Classes only, on `app/admin/finance/components`. No figure, request, wording or behaviour change. The page header, the KPI strip structure, the filter bar layout, the URL code and `useFinanceData` are out of scope. The one filter bar line touched is the class-only contrast change the brief lists.

## Implementation Approach

1. **Contrast (T-5):** `text-slate-500` becomes `text-slate-400` on the 8 information-text lines. I re-checked each line number on this branch, and these 8 are the only `text-slate-500` uses in the folder.
2. **Slice-1a tables:** AccountsByPlanSection, AiCostSection and CreditsSection drop their local `TH` / `TD` constants. They take the shared `ADMIN_TABLE_WRAP`, `ADMIN_TABLE`, `ADMIN_THEAD`, `ADMIN_TBODY`, `ADMIN_TH`, `ADMIN_TH_NUM`, `ADMIN_TD` and `ADMIN_TD_NUM`, the same way OverdueTable already does.
   - Number columns get `ADMIN_TH_NUM` / `ADMIN_TD_NUM`, so they are right-aligned with tabular figures.
   - Text columns (group, plan, business, the yes/no "Over" column and the no-allowance colSpan cell) stay left-aligned.
   - Per-row `border-t` classes give way to the tbody divider. The Total row keeps `font-semibold`.
   - Each table sits in the wrap div, which is the only markup addition. All test ids stay on the table.
3. **Section status pill:** FinanceSection's hand-built pill becomes the shared `StatusChip`. The mapping is ok to neutral (no icon), partial to warn (amber, with an icon) and unknown to unknown (with an icon). The words and `section-ID-status` test id are unchanged.
4. **Contrast guard:** add a `Finance` entry to `app/admin/__tests__/contrast.lf1.source.guard.test.ts` that walks `app/admin/finance`, plus a walk pin, as LF-1 did.

## Files to Create / Modify

| File | Action | Reason |
|------|--------|--------|
| app/admin/finance/components/FinanceView.tsx | modify | contrast |
| app/admin/finance/components/FinanceKpiStrip.tsx | modify | contrast |
| app/admin/finance/components/FinanceFilterBar.tsx | modify | contrast (class only) |
| app/admin/finance/components/OverdueTable.tsx | modify | contrast |
| app/admin/finance/components/RevenuePanel.tsx | modify | contrast |
| app/admin/finance/components/TakingsSection.tsx | modify | contrast |
| app/admin/finance/components/AiCostSection.tsx | modify | contrast + shared table classes |
| app/admin/finance/components/CreditsSection.tsx | modify | contrast + shared table classes |
| app/admin/finance/components/AccountsByPlanSection.tsx | modify | shared table classes |
| app/admin/finance/components/FinanceSection.tsx | modify | StatusChip |
| app/admin/finance/__tests__/financePage.render.test.tsx | modify | 3 "no chip in the section" pins now skip the section's own status chip; new pins for the chip tone and the numeric cells |
| app/admin/__tests__/contrast.lf1.source.guard.test.ts | modify | Finance contrast guard |

## Task List

- ✅ Step 1: contrast, 8 lines
- ✅ Step 2: shared table classes on the 3 slice-1a sections
- ✅ Step 3: FinanceSection status pill to StatusChip
- ✅ Step 4: update the class pins deliberately, add the Finance contrast guard
- ✅ Step 5: jest + tailwind guard + lint:hooks, 3 mutations

## Decisions for SA

- **AI cost captions:** the three captions now sit inside the bordered frame, so they get `px-3 py-2` to line up with the cells. This is a class change only.
- **Section status, OK state:** "OK" maps to `neutral`, which has no icon, so the shared layout keeps its single green.
- **Credits table:** the colSpan "No allowance" cell spans number columns but holds words, so it stays left-aligned.
- **Row borders:** the Total row lost its stronger top border (`border-slate-600`) to the shared tbody divider, and keeps its bold. Tables also take the shared cell padding (`px-3 py-2`) and body colour (`text-slate-300`, was `text-slate-200`).

## Verification

- Jest: app/admin/finance, lib/business-os/finance, the contrast guard, app/admin/components and the tailwind guard ran 50 suites, 2702 passed and 2 failed. The 2 failures are the DF-5 CRLF tests that F-0 (PR #414) fixes. That fix is not on this branch, which was cut before #414 merged.
- Final pass on app/admin/finance, the contrast guard and the tailwind guard: 11 suites, 416/416.
- `npm run lint:hooks`: clean. ESLint on the touched files: clean. tsc: no errors in the touched files.
- Test pins changed deliberately: three "no chip in the section" assertions in financePage.render.test.tsx now skip the section's own status chip (`NO_CHIP_BUT_STATUS`). Two F-1 tests were added: one pins the status chip tones and icons, the other pins each table column by column (number columns right-aligned and tabular, all others not).
- Mutations, all caught and all reverted:
  1. OverdueTable `NOTE` back to `text-slate-500`: the Finance contrast guard fails.
  2. FinanceSection "partial" tone `warn` to `neutral`: the F-1 status chip test fails.
  3. The Credits "Gifted outstanding" cell `ADMIN_TD_NUM` to `ADMIN_TD`: the F-1 table test fails.

## SA Review Notes

### SA Code Review

**Code Review by SA, 2026-10-15**
**Status:** ✅ Code Approved. **Verdict: APPROVED** (no fixes required; two optional suggestions below).

Reviewed in proportion to a classes-only UI slice. The worktree diff (12 files, 247 insertions and 143 deletions) was the same before and after this review.

#### Checks

| # | Check | Result |
|---|---|---|
| 1 | No figure, request, wording or behaviour change | ✅ In all three table sections every cell expression is unchanged (`n()`, `formatCount`, `usd`, `formatCredits`, `credits`, `usedPercent`, `yesNo`, `groupLabel`, `nameOf`). Every header copy constant and every test id (`accounts-groups`, `accounts-total`, `accounts-founding-chip-*`, `accounts-founding-note-*`, `ai-top`, `credits-table`, `credits-row-*`, `section-ID-status`) is unchanged and still on the same element. The only markup added is the wrap div. No hooks, fetches or copy files were touched. |
| 2 | Alignment | ✅ Right-aligned: Accounts, In grace and Past due; Cost and Credits in all three AI tables; Allowance, Used, % used and Gifted outstanding. Left-aligned: group, plan, business, trigger, and the yes/no Over column. The colSpan=4 "No allowance" / "Unknown" cell uses `ADMIN_TD`, which is left-aligned and correct because it holds words. The empty Total-row cells use `ADMIN_TD_NUM`, which is harmless. |
| 3 | StatusChip tones | ✅ ok maps to neutral (no icon, so the layout keeps a single green), partial to warn, unknown to unknown. The words come from the same `SECTION_*` constants. The test id passes through `testId`. `cn` was removed and nothing else used it. |
| 4 | NO_CHIP_BUT_STATUS pins | ✅ Narrow. The selector excludes only the exact `section-ID-status` test id for the section under test. Any other `[data-tone]` element in the section, including a founding chip, still fails the pin. |
| 5 | Contrast guard | ✅ `Finance: walk('app/admin/finance')` is live and has no exclusion list. The walk pin names page.tsx and the 8 components that carry information text. The Dev's mutation 1 proves it bites. No `text-slate-500` or `text-slate-600` is left in the folder. The two `border-slate-600` uses are borders, which the guard deliberately does not cover. |
| 6 | Visual extras | ✅ All acceptable and all from the standard (§5.7): caption `px-3 py-2` inside the frame, the Total row keeping `font-semibold` without the heavier border, shared padding, body colour `text-slate-300`, and the wrap div, which matches OverdueTable. |
| 7 | Finance stream collision | ✅ No open finance PR (the open PRs are #416 billing P-6a.2 and #417 LF-8). #417 touches `adminTable.ts` but only adds `ADMIN_TH_OPEN` / `ADMIN_TD_OPEN` and changes no constant this slice uses. It touches no finance file. origin/main since 70b609f2 touches no file in this diff. |
| 8 | DF-5 failures | ✅ Confirmed. On this branch the only failures are the 2 DF-5 tests in `lib/business-os/finance/__tests__/finance.source.guard.test.ts`. #414 MERGED at 19:03 (e2f0f4d5) and changes only that test file and its workplan. origin/main's version of the file, run against this branch's sources, passed 908/908. A merge of origin/main clears both failures and has no overlap with this diff. |

#### SA mutations (both caught, both reverted)

1. CreditsSection: the colSpan "No allowance" cell changed from `ADMIN_TD` to `ADMIN_TD_NUM`. The F-1 table test fails.
2. AccountsByPlanSection: the "Past due" header changed from `ADMIN_TH_NUM` to `ADMIN_TH` (header only, cells left numeric). The F-1 table test fails.

After the reverts: app/admin/finance plus the contrast guard ran 10 suites, 410/410.

#### Optimisation Suggestions (non-blocking)

- The column-by-column pin covers `accounts-groups`, `ai-top` and `credits-table`. The two AI "by trigger" and "by group" tables have no test id, so the pin does not cover them. They were reviewed by eye and are correct. A follow-up could pin them if one is ever needed. Do not add a test id in this slice.
- The reflowed header comment in `contrast.lf1.source.guard.test.ts` leaves one line of about 150 characters. Re-wrapping it would be cosmetic.

#### QA

A separate QA pass is not needed (short path for UI changes). The Dev's run, the 5 mutations and the column pin cover the change. RM: merge origin/main into the branch before the PR, so the DF-5 fix from #414 is included and the Tests check goes green.

### Code Approved for QA: Yes (no separate QA pass required)

## QA Testing Report

## Commit Info
