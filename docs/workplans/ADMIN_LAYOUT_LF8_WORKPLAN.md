# Workplan: LF-8 — Open button becomes an icon in a narrow last column

> **Last Updated**: 2026-10-15

**Developer:** Dev
**Requirement:** [ADMIN_LAYOUT_FOLLOWUPS_REQUIREMENT.md](/docs/requirements/ADMIN_LAYOUT_FOLLOWUPS_REQUIREMENT.md) §1, row LF-8 (user request 2026-10-15)
**Branch:** `feature/admin-layout-lf8-open-icon` (from `origin/main` `ba29f058`)
**Date:** 2026-10-15
**Status:** Code Complete (awaiting SA code review)

## Overview

The user asked on 2026-10-15 that the per-row "Open" button in admin tables become a small icon-only button in a narrow last column, with the whole row still clickable where it is today. This is a UI change to a shared component, so SA reviews the code. Nothing is committed.

## Analysis Summary

- Shared component: `app/admin/components/layout/OpenRowButton.tsx` (icon `PanelRightOpen` plus the visible word "Open"; the accessible name is the caller's `aria-label`).
- Five tables use it, all with the button in the **first** cell:

| Table | File | Header today | Row click today |
|---|---|---|---|
| AI cost & usage, call rows | `app/admin/analytics/components/AnalyticsTable.tsx` (`CallTable`) | "Details" | No |
| Audit trail | `app/admin/audit-trail/page.tsx` | "Details" | No |
| Business OS AI, Activity | `app/admin/business-os-llm/components/activity/ActivityTable.tsx` (header from `COLUMNS.details`) | "Details" | No |
| Messages | `app/admin/messages/components/MessagesTable.tsx` | "Details" (Delete sits in an sr-only "Actions" last column) | Yes (D-17) |
| Businesses (Admin users) | `app/admin/users/page.tsx` | none: the button shares the "Business / user" cell | Yes (D-17) |

- No other admin table renders an Open-style row button (searched `app/admin` for `PanelRightOpen`, a visible "Open" word and `OpenRowButton`).
- The `layoutFolder` guard lists `OpenRowButton.tsx` and checks its imports (`lucide-react` is allowed) but does not pin its markup: no guard edit needed.
- `tests/admin/drawerPinHarness.ts` and every `businessDrawer.pins.*` file find the button by role and accessible name only ("Open details for Dana Cohen"), never by the visible word: they stay unedited.

## Implementation Approach

1. `OpenRowButton`: drop the visible word; render `ChevronRight` (`aria-hidden`) in a 32 by 32 px box (`h-8 w-8`, `inline-flex items-center justify-center`), keep `aria-label={label}`, add `title={label}`, keep the purple `focus-visible` ring. Behaviour (one `onOpen(event.currentTarget)` per click, `type="button"`) is untouched.
2. Each table: the Open cell moves from first to last; the header becomes a narrow (`w-10`) header whose text is screen-reader-only and keeps today's word "Details", so the column is still named for assistive technology. Cells take `w-10` and a tighter horizontal padding.
3. Businesses: the button leaves the "Business / user" cell into its own last column, so the table has seven headers and the empty-state `colSpan` becomes 7.
4. Analytics footer: "Total" now spans the Call column only and an empty cell closes the Open column.
5. Activity: `COLUMNS.details` moves to the end of the `COLUMNS` object so the header order and `Object.values(COLUMNS)` agree.
6. Messages: Open becomes the last column, after the sr-only "Actions" (Delete) column.

Nothing else changes: no request, no data, no handler. Row clicks still route through the same `[data-testid="row-open"]` opener, so focus return (D-6) and the single-open rule are untouched.

**Side effect for SA:** in Messages, keyboard Tab order within a row is now Delete then Open (it was Open then Delete). In every other table Open becomes the last stop in its row rather than the first.

## Files to Create / Modify

| File | Action | Reason |
|------|--------|--------|
| `app/admin/components/layout/OpenRowButton.tsx` | modify | Icon-only, 32 px target, `title` |
| `app/admin/analytics/components/AnalyticsTable.tsx` | modify | Open column last and narrow; footer span |
| `app/admin/audit-trail/page.tsx` | modify | Open column last and narrow |
| `app/admin/business-os-llm/components/activity/ActivityTable.tsx` | modify | Open column last and narrow |
| `app/admin/business-os-llm/activityCopy.ts` | modify | `details` key last in `COLUMNS` |
| `app/admin/messages/components/MessagesTable.tsx` | modify | Open column last and narrow |
| `app/admin/users/page.tsx` | modify | Open in its own last column; colSpan 7 |
| Tests that pinned the visible word, the first-cell position or the header list | modify | Deliberate edits, listed in the Dev report |
| `docs/requirements/ADMIN_LAYOUT_FOLLOWUPS_REQUIREMENT.md` | modify | LF-8 row in §1 and a Change History row |

## Task List

- ✅ Step 1: Baseline `jest app/admin`
- ✅ Step 2: `OpenRowButton` icon-only
- ✅ Step 3: Five tables: Open column last and narrow
- ✅ Step 4: Deliberate test edits (pin files and harness untouched)
- ✅ Step 5: Runs: `jest app/admin`, authz guard, tailwind guard, `test:bos-entitlements`, `lint:hooks`, scoped `tsc` with a canary
- ✅ Step 6: Mutations (each restored, checksum verified)
- ✅ Step 7: Requirement §1 row and Change History

## Results

| Run | Result |
|---|---|
| Baseline `jest app/admin` (before any edit) | 143 suites, 4,241 tests, all pass |
| `jest app/admin` after | 143 suites, 4,245 tests, all pass (+4: two `adminTable` rows, the 32 px test, the narrow-header test) |
| `npm run test:authz-guard` | 2 suites, 203 tests pass |
| Tailwind guard (`app/__tests__/tailwind-css-escape.guard.test.ts`) | 6 tests pass |
| `npm run test:bos-entitlements` | 272 suites, 8,093 tests pass |
| `npm run lint:hooks` | clean |
| Scoped `tsc` (scratch tsconfig extending the worktree's, the 17 touched code files) | with a canary: exactly `zz-canary.ts(1,7): error TS2322`, exit 2; without it: exit 0. Scratch files deleted |
| Pin files `businessDrawer.pins.*` and `tests/admin/drawerPinHarness.ts` | sha256 equal before and after (unedited) |
| `console.`, `any`, backslashes in added lines and this workplan | none |

### Mutations

Each applied to one file, the targeted suites run, the file copied back and its `git hash-object` compared: all six restored, equal.

| # | Mutation | Caught by |
|---|---|---|
| M1 | Drop `aria-label` from `OpenRowButton` | 2 tests (`OpenRowButton`, Audit trail). Note: the `title` then becomes the accessible name, so name-based finders still pass; the `aria-label` pins catch it |
| M2 | Drop `focus-visible:ring-purple-500` | 1 test (A-1 ring) |
| M3 | Drop `title` | 2 tests (`OpenRowButton`, `businessesLayout`) |
| M4 | Drop `h-8 w-8` (the 32 px target) | 1 test |
| M5 | Businesses empty state `colSpan` 7 back to 6 | 1 test (`defaultFilter`) |
| M6 | Audit trail Open header word made visible | 1 test (narrow-header test) |

## SA Review Notes

### SA Code Review

**Code Review by SA — 2026-10-15**
**Status:** APPROVED WITH FIXES (F-1, F-2 below; neither touches behaviour)

#### What was checked

| Item | Result |
|---|---|
| `OpenRowButton`: `aria-label={label}` kept, `type="button"`, `onClick` hands `event.currentTarget` once (unchanged) | ✅ |
| Icon `ChevronRight` with `aria-hidden="true"`; `textContent` is empty; one svg | ✅ |
| 32 px target (`h-8 w-8`, centred); `focus-visible:ring-2 ring-purple-500` kept | ✅ |
| Five tables: the Open cell leaves the first position and becomes the last `td` of the same row; handler, label and `testId` moved unchanged | ✅ Analytics calls, Audit trail, Activity, Messages, Businesses |
| Headers: a last `th scope="col"` with `ADMIN_TH_OPEN` and `<span className="sr-only">Details</span>`, so the column keeps a name | ✅ all five |
| `colSpan`: Businesses empty state 6 to 7 (the only one in these tables; the others render their empty state outside the table) | ✅ |
| Analytics footer: "Total" no longer spans 2; an `ADMIN_TD_OPEN` cell closes the row. Counted: 8 footer cells, 8 headers | ✅ (but unpinned, see F-2) |
| `activityCopy` `COLUMNS`: `details` moved last, so `Object.values(COLUMNS)` matches the header order; the old "first, so a keyboard reaches it first" comment is replaced | ✅ |
| Businesses first cell: the flex wrapper goes with the button; business name, `UserNameLine` and short id are unchanged in content and order | ✅ |
| Pin files `businessDrawer.pins.boost / credits / dangerReads` and `tests/admin/drawerPinHarness.ts`: `git hash-object` equals `HEAD` and current `origin/main` `70b609f2` | ✅ byte-identical |
| No request, fetch, state or handler change in any file; `OpenRowButton` still imported and used in each table | ✅ |
| Test edits: each follows a moved cell (index 0 to last, other cell indexes shifted by 1), a header list gaining "Details" at the end, a count of 6 to 7, or the visible word becoming empty. Each keeps its assertion strength and carries an LF-8 comment. New: the 32 px test, the narrow sr-only header test, two `adminTable` rows | ✅ not weakened |
| U-10 title pin reversal (`hasAttribute('title')` false, now `title` equals the name): the false pin dates from L-4a, when the control was the expand toggle whose name flipped between Show and Hide, so a tooltip would have gone stale. That control is gone; the new pin is stricter (exact value) | ✅ justified |
| Line endings: `OpenRowButton.tsx` is LF in the working copy and in the index (`i/lf w/lf`). `.gitattributes` has no rule for `.tsx`, and `core.autocrlf=true` stores LF either way. `git diff` shows only the 15 / 13 real lines, no whole-file churn | ✅ does not matter |
| `jest app/admin`, re-run by SA | 143 suites, 4,245 tests, all pass |
| `console.*`, `any`, new patterns | none; the two new class constants follow the existing `adminTable` pattern |

#### SA mutations (each restored, `git hash-object` equal after)

| # | Mutation | Result |
|---|---|---|
| SA-M1 | Analytics call footer: "Total" given `colSpan={2}` again while the new last cell stays (the footer becomes 9 columns under 8 headers, every sum shifted one column right) | **Survived** (`jest app/admin/analytics`: 190 pass). The footer width is not pinned: F-2 |
| SA-M2 | `aria-hidden="true"` removed from the `ChevronRight` | Survived, correctly: `lucide-react` 0.525 adds `aria-hidden="true"` itself to an icon with no children and no a11y prop, so the icon stays hidden. Not a defect; the explicit attribute stays as belt and braces |

#### Fixes

1. **F-1 (Medium, docs).** `docs/requirements/ADMIN_LAYOUT_STANDARD_REQUIREMENT.md` §5.8 rule D-2 still says the opener is a first-column button showing "Open" with `PanelRightOpen`. Q-16 and R-8 still say the Businesses button sits inside the first cell. The next page built to the standard would follow the old rule. Amend D-2 in place with an LF-8 amendment line covering:
   - an icon-only `ChevronRight` with a 32 px target
   - the name as `aria-label` and `title`
   - a narrow LAST column via `ADMIN_TH_OPEN` / `ADMIN_TD_OPEN`, with a screen-reader-only "Details" header
   - that it supersedes L-1d SA Q-10 ("first, so the keyboard reaches it first") and Q-16 / R-8 ("inside the first cell"), by user request 2026-10-15

   Add a Change History row. Leave the historic rows as they are.
2. **F-2 (Low, test).** Pin the Analytics call-table footer width. In T-4, or a new T-4b, assert that the footer cells' `colSpan` values add up to the header count (8) and that the last footer cell is the narrow one. Re-run SA-M1: it must now fail.

#### Rulings on the Dev's questions

**Q1. Open as the last Tab stop (Messages: Delete then Open). Ruling: acceptable; keep it LAST.**
- WCAG 2.4.3 asks for a focus order that keeps the meaning. Here the DOM order is the visual order, left to right, so it is compliant.
- The user asked for a narrow last column. A narrow first column would put a bare chevron before the row's name. That reads worse on screen, and worse for a screen reader moving cell by cell.
- Delete before Open in Messages is safe: Delete opens the shared confirmation dialog (LF-7), so pressing Enter on it by mistake deletes nothing.
- Messages and Businesses also open from a click anywhere on the row (D-17).
- The keyboard cost is one extra Tab in Messages only.
- F-1 records that this supersedes Q-10.

**Q2. `title` equal to `aria-label`. Ruling: keep the tooltip.**
- The button has no visible word. For a sighted mouse user, the tooltip is the only text that says what the chevron does.
- It takes no row space, so it does not work against the user's request.
- The double reading is mostly theoretical. Under the accessible name and description rules, `title` becomes the description only when `aria-label` already gives the name. Chromium and Firefox drop a description that equals the name, so NVDA, JAWS and VoiceOver on current browsers read the label once.
- Conditions:
  - `title` must stay exactly equal to `label`. The `OpenRowButton` test pins this.
  - `title` must never be the only name. M1 showed it would silently become the accessible name.

#### Verdict

**APPROVED WITH FIXES: F-1, F-2.** The code is approved for commit once both fixes are in. They change no behaviour, so they need no second SA pass. Dev re-runs `jest app/admin` and SA-M1 and records both results here.

#### Fixes applied (Dev, 2026-10-15)

- **F-1 applied:** `ADMIN_LAYOUT_STANDARD_REQUIREMENT.md` §5.8 D-2 amended in place with the LF-8 line. It covers the icon-only `ChevronRight` with a 32 px target, the label as `aria-label` and `title`, and the narrow last column (`ADMIN_TH_OPEN` / `ADMIN_TD_OPEN`) with a screen-reader-only "Details" header. It records that this supersedes L-1d SA Q-10 and Q-16 / R-8, by user request 2026-10-15. A Change History row was added, the historic rows are untouched, and Last Updated is set to 2026-10-15.
- **F-2 applied:** new T-4b in `analytics.table.render`. The footer cells' `colSpan` values must add up to 8, which equals the header count, and the last footer cell must carry `w-10`.
- **SA-M1 re-run** ("Total" `colSpan={2}`, the last cell kept): it now **fails**, only on T-4b (Expected 8, Received 9). `jest app/admin/analytics`: 1 failed, 190 passed. The file was restored and its `git hash-object` is equal before and after (`e25aafb8`).
- **After the fixes:**
  - `jest app/admin`: 143 suites, 4,246 tests, all pass (+1, T-4b)
  - tailwind guard: 6 tests pass
  - `lint:hooks`: exit 0
  - no backslashes in added lines

### Code Approved for QA: Yes (see the ruling below)

## QA Testing Report

**SA ruling (2026-10-15): no separate QA pass.**
- The change is presentational: one shared component and five table layouts.
- No request, data, handler or focus-return path changed, and the drawer pins are byte-identical.
- `jest app/admin` covers the structure: positions, names, the sr-only header, `colSpan`, the 32 px classes and the focus ring.
- What Jest cannot see is the look. When the user (or TL) views the diff, open one table in a browser, Audit trail for example, in light and dark mode. Check two things:
  - the chevron sits centred in a narrow column
  - Tab shows the purple ring
- That covers this slice; a full QA cycle would be out of proportion.

## Commit Info

[RM will populate this section]

## Change History

| Date | Change | Details |
|------|--------|---------|
| 2026-10-15 | Created | Dev workplan for LF-8 |
| 2026-10-15 | SA code review | APPROVED WITH FIXES (F-1 standard D-2 amendment, F-2 footer-width pin); Q1 keep Open last; Q2 keep `title`; no separate QA pass |
| 2026-10-15 | SA fixes applied (Dev) | F-1: standard §5.8 D-2 amended with the LF-8 line, plus a Change History row there. F-2: T-4b footer-width pin; SA-M1 now fails (8 expected, 9 received) and the file was restored with an equal checksum. `jest app/admin` 143 suites / 4,246 tests pass; tailwind guard 6 pass; `lint:hooks` clean |
