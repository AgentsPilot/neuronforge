# Workplan: Money MK-0, the leading / lagging indicator on the shared KPI tile

> **Last Updated**: 2026-10-19

**Developer:** Dev
**Requirement:** [ADMIN_MONEY_KPI_RESTRUCTURE_REVIEW.md](/docs/requirements/ADMIN_MONEY_KPI_RESTRUCTURE_REVIEW.md) §3.3 (LL-1 to LL-5), §12 MK-0 row, SA-RR-MK (SA-8, "`KpiTile` `indicator` (MK-0)", pins table: MK-0 moves none); FIN BD-46
**Branch:** `feature/admin-money-mk0-kpi-indicator` (from main `d50ce806`)
**Date:** 2026-10-19
**Status:** Code Complete (uncommitted)
**Path:** full cycle (shared export, LAY R-7, SA-8). The user said "let's go" on 2026-10-19. No data, route, payload or migration change.

## Overview

MK-0 adds an optional `indicator` to the shared `KpiTile`: a small, uncoloured icon in the tile's top corner (a forward arrow for leading, a clock for lagging). It has an in-house accessible tooltip and an accessible name. The same indicator is exported for block KPIs. **No caller uses it yet**, so Pin A, Pin B and every Finance pin are unchanged. The first Finance use is MK-5.

---

## 1. Code facts (at `d50ce806`)

| # | Fact | Where |
|---|---|---|
| CF-1 | `KpiTile` renders the whole tile as ONE `<a>` (anchor or filter mode) or a `next/link` (cross-page). With no target it renders a `div role="group"`. Its content is spans only, because it sits inside the link (K-6) | `app/admin/components/layout/KpiStrip.tsx` |
| CF-2 | Pin A hashes the rendered `innerHTML` of every existing prop shape and caller (useId normalised); Pin B hashes the Finance tiles | `KpiStrip.callers.pin.render.test.tsx`, `financeTiles.pin.render.test.tsx` |
| CF-3 | No block-KPI component exists. Block KPIs are first specified for MK-5 to MK-8 (§3.2, §5) | grep |
| CF-4 | `lucide-react` is installed (`ArrowRight`, `Clock`); there is no tooltip package (SA-8) | `package.json:93` |
| CF-5 | The C-14 guard pins the folder's file list and import allow-list (`react`, `lucide-react` and others). The contrast guard refuses `text-slate-500/600` | `layoutFolder.guard.test.ts`, `contrast.lf1.source.guard.test.ts` |

## 2. Component API

**File:** `app/admin/components/layout/KpiStrip.tsx` (no new file, so the C-14 expected-file list is unchanged)

```typescript
export type KpiIndicatorKind = 'leading' | 'lagging';
export interface KpiIndicatorSpec {
  kind: KpiIndicatorKind;
  /** Line 1: the KPI in plain words, from the caller's one copy constant per KPI (LL-4). */
  definition: string;
}
/** LL-2 line 2, one copy each. */
export const KPI_INDICATOR_WORDS: Record<KpiIndicatorKind, { name: string; line: string }>;
/** The icon plus its tooltip. Used by KpiTile, and on its own by block KPIs. */
export function KpiIndicator(props: { indicator: KpiIndicatorSpec; testId?: string; className?: string }): JSX.Element;
// KpiTile gains:  indicator?: KpiIndicatorSpec | null
```

- `KPI_INDICATOR_WORDS.leading` = `{ name: 'Leading indicator', line: 'Leading indicator: it tells you early what is coming' }`; `lagging` = `{ name: 'Lagging indicator', line: 'Lagging indicator: it tells you what already happened' }`.
- **Block KPIs:** there is no component to extend (CF-3). The minimal shared piece is `KpiIndicator` itself. A block places it in its own heading corner, so later slices get the same icon, words and behaviour without a second copy.

## 3. Structure: "tile is a link" plus "icon is focusable"

Interactive content inside an `<a>` is invalid HTML, so the icon is **never inside the link**.

- **Without `indicator`:** `KpiTile` returns exactly the element it returns today. No wrapper and no extra hook call, so the output is byte-identical (Pin A).
- **With `indicator`:**
  - `KpiTile` returns a `div` with class `relative`. Its children are the unchanged tile element (link, `next/link` or group, with one extra right-padding class so the label clears the icon) and, as a **sibling**, `KpiIndicator`, absolutely positioned in the top-right corner.
  - The wrapper has no role, so landmark and button counts are unchanged apart from the icon itself.
  - A click on the icon lands on the button, not on the link, so it never follows the link or runs the filter `apply` (LL-3).
  - The link's K-7 name is unchanged; the icon carries its own name.

## 4. Accessibility

| Item | Detail |
|---|---|
| Focusable element | A `<button type="button">`: the native focusable element, with no tab-index tricks |
| Accessible name (LL-3) | `aria-label` = `"{name}. {definition}"`, for example "Lagging indicator. Cash owners paid us…" |
| Tooltip (SA-8) | A `<span role="tooltip" id=…>` with two lines (definition; the LL-2 line), linked by the button's `aria-describedby`. It is always in the DOM and hidden while closed (`hidden`), so the description exists without a hover |
| Opens | `mouseenter` on the button or the tooltip (hoverable, WCAG 1.4.13), and `focus` on the button |
| Closes | `mouseleave` of both, `blur`, and **Escape**. Escape listens on the document while open, so it dismisses without moving focus or the pointer (WCAG 1.4.13 dismissible) |
| Click | Opens the tooltip, for touch. It does not toggle: in a browser the same click focuses the button, so a toggle would close it at once. It is not a link and never navigates |
| Colour | `text-slate-400`, uncoloured (LL-1, BD-11). Focus ring `focus-visible:ring-purple-500`, as the tile. Icons are `aria-hidden` |
| Position | CSS only: `absolute right-2 top-2`; tooltip `absolute right-0 top-full z-20 w-64` |

## 5. Tests

**File:** `app/admin/components/layout/__tests__/KpiIndicator.render.test.tsx` (new, jsdom)

| # | Case |
|---|---|
| T-1 | The accessible name is "Leading indicator. {definition}" / "Lagging indicator. {definition}"; the right icon renders |
| T-2 | Focus shows the tooltip (`role="tooltip"`, not hidden) with both lines; `aria-describedby` points to its id |
| T-3 | Escape closes it while focus stays on the button; blur closes it |
| T-4 | Hover opens and leave closes; moving from the button to the tooltip keeps it open |
| T-5 | A click on the icon does not follow the tile: filter mode's `apply` is not called and `href` mode does not navigate; a click on the tile still does |
| T-6 | **No indicator, no change:** for each mode (anchor, filter, link, group), `innerHTML` without `indicator` equals `indicator={null}` and holds no button or tooltip. Pin A covers the byte level |
| T-7 | With the indicator, the icon is a sibling of the link, never a descendant; the link's name is unchanged |
| T-8 | `KpiIndicator` on its own (block KPI) renders the same name and tooltip |
| T-9 | The words come from `KPI_INDICATOR_WORDS` (one copy, LL-4) |

## 6. Guards

- **Pin A** (`KpiStrip.callers.pin`) and **Pin B**, plus the other five Finance pins: not edited, re-hashed at handover. MK-0 moves none (SA-RR-MK table).
- **C-14** `layoutFolder.guard`: no new file and only allow-listed imports (`react`, `lucide-react`). Contrast: `text-slate-400` only. Vocabulary guard: no AI cost wording.
- `lint:hooks`: hooks only in `KpiIndicator`, a component, called unconditionally there.
- No new dependency. No CI time added (one Jest file).

## 7. Risks

| # | Risk | Mitigation |
|---|---|---|
| R-1 | The wrapper changes the grid item for an indicator tile | Only when `indicator` is set (no caller yet); MK-5 re-freezes Pin B once |
| R-2 | The name and the description read the same definition twice to a screen reader | SA-8 requires both; the description adds the LL-2 line. Recorded for SA |
| R-3 | A tooltip clipped by an `overflow-hidden` parent | The strip has none today; MK-5 checks its placement in the browser |
| R-4 | A button inside a tile wrapper changes a page's button count | Only once a caller opts in; MK-5 pins it |

## Implementation Notes

**2026-10-19, Dev. Implemented as §2 to §4, uncommitted. No new file in the layout folder, no new dependency, no pin moved.**

| File | Change |
|---|---|
| `app/admin/components/layout/KpiStrip.tsx` | Adds:<ul><li>the `KpiIndicatorKind`, `KpiIndicatorSpec` and `KpiIndicatorProps` types;</li><li>`KPI_INDICATOR_WORDS` (the LL-2 and LL-3 words, one copy);</li><li>the exported `KpiIndicator` component (button plus `role="tooltip"`);</li><li>the optional `indicator` prop on `KpiTile`.</li></ul>Every return of `KpiTile` goes through `withIndicator(tile)`. With no indicator it returns `tile` itself, and the padding suffix is `''`, so every class string is byte-identical. With one, it returns a `div.relative` holding the tile, with `pr-9` added, and the icon as a sibling. The imports are `react`, `lucide-react` (`ArrowRight`, `Clock`) and `next/link`, all already allow-listed. `console.*`: 0 |
| `app/admin/components/layout/__tests__/KpiIndicator.render.test.tsx` | New, 18 tests (T-1 to T-9) |

**D-1:** a click **opens** the tooltip and does not toggle it. In a browser the same click also focuses the button, so a toggle would close it at once. It closes on blur, on leave or on Escape. The §4 row is updated.

**QA-MK0-N1 (Low), fixed by Dev.** Escape was not stopped, so an indicator inside a drawer would close the drawer too. The listener now sits on **window in the capture phase**, the first stop of the event path. That puts it ahead of Radix's document-capture listener (`@radix-ui/react-use-escape-keydown`, used by `AdminDrawer` through the sheet).

- **While the tooltip is open:** Escape calls `stopPropagation()` and `preventDefault()` and closes it.
- **While it is closed:** no listener is registered, so Escape passes through untouched and a second press closes the drawer.
- **Keys other than Escape** are never stopped.

There are 3 new tests, using a drawer-like parent with both a React `onKeyDown` and a native document capture listener:
- open: the tooltip closes, `defaultPrevented` is true, and neither handler is called;
- closed: the second press reaches both handlers once, not prevented;
- Tab passes.

The existing listener-removal test now spies on `window` with `{ capture: true }`. A mutation with `stopPropagation()` removed failed 2 of the new tests. The file was restored byte-identical. After the fix:
- the indicator tests: 21 passed;
- `app/admin/components` plus the contrast guard: 27 suites, 938 passed (C-14 and Pin A included);
- Pin B: passed;
- ESLint: clean;
- the seven pins: unchanged.

**Hooks:** `KpiTile`'s own hook calls are unchanged (one `useId`). The indicator's `useId`, `useState` and `useEffect` run only inside `KpiIndicator`, so existing tiles' ids do not shift.

**Runs:**

| Run | Result |
|---|---|
| `app/admin/components` | 26 suites, 843 passed (Pin A included) |
| `app/admin/finance` | 20 suites, 687 passed (Pin B included) |
| Layout (C-14) and contrast guards | 2 suites, 479 passed, with no guard edit |
| Vocabulary guard | 182 passed |
| `test:authz-guard` | 2 suites, 203 passed |
| `test:bos-entitlements` | 297 suites, 8997 passed |
| `lint:hooks` | exit 0 |
| ESLint on both files | clean |
| Scoped tsc with a canary | TS2322 at `KpiStrip.tsx(432,7)`. Restored byte-identical (sha256 `0e8553f2…fd9b4`), and the clean run had 0 errors in scope |
| Full `npm test` | 1591 suites (1563 passed, 20 failed, 8 skipped) and 40,379 tests (40,174 passed, 140 failed, 65 skipped), in 587 s |

**The full-run failures were all there before this change.** The failing set is **identical**, suite for suite, to the R4 baseline run on main-based code: the same 20 suites and 140 tests. These are the Windows path-separator guards, `supabaseFetch`, pilot ConditionalEvaluator / StructuredTransforms, agentkit v4 / v6, orchestration and the OpenAI pricing adapter. The diff adds none.

**Pins** (HEAD blob plus `git diff --quiet`): all seven are unchanged.
- AC-173 `3a1a2dd4…`
- helper `b84e0c96…`
- A `30f5fc24…`
- B `24ff0da7…`
- C `98ea0507…`
- helper `02813360…`
- D `1f7cf07a…`

Pin A passes unedited, so every existing caller renders byte-identically.

**Not done here (by design):** no caller uses the indicator. The per-KPI definition constants (LL-4) arrive with their first users (MK-5 for Finance, with Pin A and Pin B re-frozen once).


## SA Review Notes

### SA Review (workplan and code)

**Reviewed by SA, 2026-10-19. Reviewed: the uncommitted tree on `feature/admin-money-mk0-kpi-indicator` (from main `d50ce806`).**
**Status: Code Approved (SA-MK0).** There are no conditions; one Low suggestion follows.

| Item | Result |
|---|---|
| SA-8 tooltip, in house | ✅ The icon is a native `<button type="button">`, so it is focusable and has an `aria-label` of "Leading/Lagging indicator. {definition}" (LL-3). The tooltip is a `role="tooltip"` span referenced by `aria-describedby` and always in the DOM, using `hidden` while closed. It opens on hover (the tooltip itself is hoverable, WCAG 1.4.13) and on focus. It closes on leave and blur, and on **Escape**, which is heard on the document only while open, so it dismisses without moving focus. It is CSS-positioned and needs no package: `package.json` and the lockfile are untouched |
| No interactive content inside the link | ✅ An indicator tile is a `relative` wrapper holding the **unchanged** tile (`<a>`, `Link`, filter `<a>` or `role="group"`) and, as a **sibling**, `KpiIndicator`, absolutely positioned in the corner. The button is never a descendant of the link |
| A click never follows the link | ✅ The button is outside the anchor, so neither its click nor its Enter or Space reach the link's handler or default (render test). The tile pads by `pr-9` only when it has an icon, so the icon never covers the tile's text |
| No indicator, same output | ✅ With no indicator there is no wrapper and no extra hook (the `useId` order is kept), so **Pin A is unchanged**. All 56 suites that import `KpiStrip` pass (56 suites / 1581 tests), and so do the scanners that read it (contrast LF-1, the finance app and lib source guards, Subscriptions: 1353 tests) |
| Colour and layout | ✅ The icon is uncoloured (`text-slate-400`, LL-1); the focus ring matches the tile; icons are `aria-hidden`. `app/admin/__tests__` and `app/admin/components` (contrast, C-14 layout folder, nav) pass: 42 suites, 1456 tests. No test under `layout/__tests__` was edited; the one new file is `KpiIndicator.render.test.tsx` |
| Shared export (LAY R-7) | ✅ It runs the full cycle as R-7 requires. `KpiIndicator`, its types and `KPI_INDICATOR_WORDS` are exported from `KpiStrip.tsx` (one copy, LL-4). There is no exact-export registry to update: the C-14 guard checks imports and placement, and it passes |
| Pins | ✅ SA recomputed the seven Finance and layout pins: `3a1a2dd4` `b84e0c96` `30f5fc24` `24ff0da7` `98ea0507` `02813360` `1f7cf07a`. No caller uses `indicator` yet (the first Finance use is MK-5, per SA-RR-MK, so Pin B moves once) |
| Full gate | ✅ The 20 Windows-only failing suites are **not** in the `--findRelatedTests` set for `KpiStrip.tsx` (56 suites, all green), and none scans the layout folder. The failing set therefore cannot come from this diff, and it matches the R4 baseline. CI on Linux is the gate |

**D-1 (a click opens and does not toggle): approved.** On touch a click is the only way to open it, and a toggle would close at once, because the same click focuses the button. Escape, blur and leave all close it.

**Optimisation suggestion (Low, not blocking).** The accessible name already contains the definition, and `aria-describedby` repeats it, so a screen reader reads the definition twice. A later tidy could point `aria-describedby` at line 2 only, in the MK-5 copy pass.

#### Code Approved for QA: Yes

## QA Testing Report

**QA — 2026-10-19** (worktree `neuronforge-finance-m8`, branch `feature/admin-money-mk0-kpi-indicator` on `d50ce806`, uncommitted)
**Test mode:** full
**Strategy used:**
- **A:** Jest suites and guards, run one at a time.
- A code read of `KpiIndicator` and the `KpiTile` wrapper.
- A temporary untracked **`user-event` probe** (real Tab focus, real clicks, real hover), deleted afterwards (`git status` clean of it).
- A scoped tsc with a canary.

**Focus:** ui (accessibility)
**Skipped:** a browser look. No caller uses the indicator yet; the first live sight is MK-5.
**Input source:** prompt + workplan

**Verdict: PASS. No bugs; one Low note (QA-MK0-N1).**

### Behaviour

| Item | Result | Evidence |
|---|---|---|
| Leading shows a forward arrow, lagging a clock | ✅ | QA probe: leading's SVG is `lucide lucide-arrow-right`, lagging's is `lucide lucide-clock` (Dev's test checks only that an SVG exists) |
| Not colour-coded | ✅ | `text-slate-400` (hover `text-white`), whatever the tile status; Dev's test "no status colour…" with `status="red"` |
| Two-line tooltip on hover and keyboard focus | ✅ | QA probe: **Tab** reaches the tile link first, then the icon. Focus opens the tooltip, whose text is exactly "Def G." + "Lagging indicator: it tells you what already happened". Hover (`user.hover`) shows "Leading indicator: it tells you early what is coming", and unhover closes it. The copy is one constant (`KPI_INDICATOR_WORDS`, pinned) |
| Accessible name | ✅ | `aria-label` = "Lagging indicator. {definition}" / "Leading indicator. {definition}"; icons are `aria-hidden` |
| `role="tooltip"` and `aria-describedby` | ✅ | the button's `aria-describedby` equals the tooltip's id (QA probe and Dev's test); the tooltip is always in the DOM, `hidden` while closed |
| Escape, blur and moving away close it | ✅ | QA probe: Escape closes it and focus **stays on the button**; tabbing away keeps it closed. Dev's tests: blur, leave, hover-opened Escape, and the listener is removed when closed |
| A click opens it and does not navigate the tile link | ✅ | QA probe: a real click on the icon in href mode leaves `location.hash` empty and opens the tooltip; the button has no `<a>` ancestor; a click on the tile then sets `#rev`. Dev's test: filter mode's `apply` is not called by the icon click |
| A tile with no indicator is unchanged | ✅ | **Pin A unchanged and green** (byte-level innerHTML of every existing shape). Dev's `it.each(MODES)`: absent and `null` give the same HTML, with no button, tooltip, wrapper or padding |
| No new dependency | ✅ | `package.json` and the lockfile are `git diff --quiet`; imports are `react`, `lucide-react` and `next/link`, all allow-listed by C-14 |

### Suite runs (each alone)

| Suite | Result |
|---|---|
| `app/admin/components` (incl. Pin A and the new `KpiIndicator.render.test.tsx`) | 26/26, 843/843 |
| `app/admin/finance` (incl. Pin B) | 20/20, 687/687 |
| Layout (C-14 `layoutFolder.guard`) + contrast (`contrast.lf1`) | 2/2, 479/479; both unedited |
| Vocabulary guard | 182/182 |
| `npm run test:authz-guard` | 2/2, 203/203 |
| `npm run test:bos-entitlements` | 297/297, 8997/8997 |
| `npm run lint:hooks` | exit 0 |

These match Dev's counts.

**Scoped tsc:**
- Config in the scratchpad covering `KpiStrip.tsx`, the new test, the `KpiStrip` render test, Pin A, Pin B and `FinanceKpiStrip.tsx`.
- A canary gave `KpiStrip.tsx(432,7) TS2322`.
- The file was restored with `cp` and checked with `cmp` (identical).
- The clean run gives **exit 0, 0 errors**.

**Pins (LF-normalised):** `3a1a2dd4` `b84e0c96` `30f5fc24` `24ff0da7` `98ea0507` `02813360` `1f7cf07a`, all unchanged.

### Issues Found
- **Bugs:** none.
- **Performance:** none.
- **Notes (for MK-5, not blocking):**
  1. **QA-MK0-N1 (Low).** The Escape listener is on `document` and does not stop the event, so inside an `AdminDrawer` (or any Escape-closing surface) one Escape would close **both** the tooltip and the drawer. No caller exists yet. When MK-5 places an indicator inside a drawer, either stop propagation while the tooltip is open, or accept and pin the behaviour.
  2. SA's Low suggestion stands (the definition is read twice; point `aria-describedby` at line 2 only), for the MK-5 copy pass.

### Final Status
- [x] All MK-0 behaviours pass. No bugs. Pin A, Pin B and the five other pins are unchanged. **Ready for RM.**
- [ ] Issues found

## Commit Info

[RM will populate this section]

---

## Change History

| Date | Change | Details |
|---|---|---|
| 2026-10-19 | Created and implemented (Dev) | Optional `indicator` on `KpiTile` and the exported `KpiIndicator`; in-house tooltip; no pin moved |
| 2026-10-19 | SA review | Code Approved (SA-MK0): accessible in-house tooltip with no dependency, icon outside the link, the no-indicator output unchanged (Pin A), seven pins equal, every KpiStrip-related suite green; D-1 approved; one Low suggestion |
