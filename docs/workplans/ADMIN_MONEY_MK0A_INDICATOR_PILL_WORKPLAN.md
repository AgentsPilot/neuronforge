# Workplan: MK-0a, the indicator as a word pill, its tooltip below the tile, and equal tiles

> **Last Updated**: 2026-10-19

**Developer:** Dev
**Requirement:** the user's three decisions of 2026-10-19 after seeing MK-5 live (relayed by the coordinator); [ADMIN_MONEY_KPI_RESTRUCTURE_REVIEW.md](/docs/requirements/ADMIN_MONEY_KPI_RESTRUCTURE_REVIEW.md) §3.3 LL-1 to LL-5 (behaviour unchanged), SA-8; MK-0 and MK-0 QA-MK0-N1
**Branch:** `fix/admin-kpi-indicator-word-pill` (from main `a9551d9c`; MK-5 #478 merged)
**Date:** 2026-10-19
**Status:** Code Approved (SA-MK0A), QA passed; committed `85a165f2`, PR [#481](https://github.com/AgentsPilot/neuronforge/pull/481) opened 2026-10-20, auto-merge on
**Path:** a UI fix to a shared export (full review of Pin A). No data, payload or route change.

## Overview

1. **The pill.** `KpiIndicator` shows a small bordered pill reading **"Leading"** or **"Lagging"** instead of the arrow or clock icon. It is not colour-coded: a neutral border and secondary text, so it never competes with BD-11. It stays the same focusable button, with the same accessible name, the same tooltip text and the same LL-2 / LL-3 behaviour (Escape consumed only while open, QA-MK0-N1). The tile's right padding grows so a long label never runs under the pill.
2. **The tooltip is placed against the tile, not the pill.** It is a sibling of the pill, positioned against the tile's (or block KPI's) `relative` box:
   - **below** the box by default (`top-full`), with the box's width (at least `14rem`);
   - **flipped above** (`bottom-full`) when the space under the box in the viewport is too small.
   - It is never inside the tile's link, so the value and label stay readable.
   - It stays open while the pointer moves from the pill to the tooltip (a short close delay; WCAG 1.4.13 hoverable).
   - Clipping check: the strip and the tile have no `overflow-hidden`. The only scrolling ancestor is `AdminChrome`'s `main` (`overflow-y-auto`), whose content scrolls rather than clips, and the flip covers the bottom edge.
3. **Equal tiles.** `KpiStrip`'s grid gains `auto-rows-fr`, so every row has the same height; the columns are already equal (`grid-cols-*`). Grid items stretch by default. An indicator tile's wrapper and its tile get `h-full`, so an indicator tile fills its cell too. This is the shared behaviour for every caller (listed below).

## Callers of `KpiStrip` / `KpiTile` (the change reaches all)

Analytics (`AnalyticsKpis`), Archiving (`ArchivingKpis`), Invites (`InviteKpis`), Business OS AI Activity (`ActivityKpis`), Charge checks (`CostsKpis`), Business OS AI settings (`SettingsKpis`), Plans & entitlements (`PlansKpis`), Jobs & queues (`JobsQueuesView`), Exchange rates (`ExchangeRatesKpis`), Model pricing (`system-config/page.tsx`), Businesses (`BusinessesKpis`) and Finance (`FinanceKpiStrip`). `BlockKpi` (Finance) uses `KpiIndicator` only.

## Files

| File | Change |
|---|---|
| `app/admin/components/layout/KpiStrip.tsx` | The pill; the tooltip as a sibling, below or above with a flip; the hover close delay; `auto-rows-fr`; `h-full` and wider padding on indicator tiles |
| `app/admin/finance/components/BlockKpi.tsx` | Padding for the pill (`pr-24`) |
| `app/admin/components/layout/__tests__/KpiIndicator.render.test.tsx` | Updated and extended (below) |
| `app/admin/components/layout/__tests__/KpiStrip.callers.pin.render.test.tsx` | **Ruled re-freeze of Pin A** if hashes move (expected: every case that renders a strip, and the A3 indicator cases). Old and new values go in the notes |

## Tests

- Pill text "Leading" / "Lagging", with no icon.
- The accessible name is unchanged.
- `data-placement="below"` by default; `"above"` when the box sits near the viewport bottom (`getBoundingClientRect` mocked).
- The tooltip is a sibling of the tile link inside the box (never inside the link or its value).
- Equal sizing: the strip has `auto-rows-fr`; an indicator tile and its box are `h-full`.
- No click-through; Escape closes it and is consumed only while open (the existing tests are kept).
- Hover: moving from the pill onto the tooltip keeps it open; leaving both closes it after the delay.

## Guards and pins

Contrast (no `text-slate-500/600`), C-14 (no new file or import), vocabulary, `lint:hooks`, `test:authz-guard`, `test:bos-entitlements`. Pin B checks text and the indicator's kind only, so it is expected to stay unchanged. Pin A is a ruled re-freeze (flagged for SA). The Finance AC-173, AC-145 and Pins C and D do not change.

## Risks

| # | Risk | Mitigation |
|---|---|---|
| R-1 | Every page's strip HTML changes (Pin A) | Intended by the user's decision; a ruled re-freeze, recorded |
| R-2 | `auto-rows-fr` makes a row as tall as the tallest tile anywhere in the strip | That is the decision ("all boxes the same size") |
| R-3 | The flip cannot be measured in jsdom | `getBoundingClientRect` is mocked in the test; the browser look is owed to the user |

## Implementation Notes

**2026-10-19, Dev. Implemented as planned, uncommitted. One ruled re-freeze, Pin A, flagged for SA. Every Finance pin is unchanged.**

### What changed

| File | Change |
|---|---|
| `app/admin/components/layout/KpiStrip.tsx` | The pill and the tooltip:<ul><li>`KpiIndicator` is now a word pill (`KPI_INDICATOR_PILL`: "Leading" / "Lagging"): `rounded-full border border-slate-600 … text-slate-300`, no colour by status, no icon. `ArrowRight` and `Clock` are no longer imported.</li><li>It returns the pill span **and** the tooltip as siblings, so the tooltip is positioned against the box's `relative` wrapper: `left-0 right-0` (the box width, at least `14rem`), `top-full mt-2` (**below**), or `bottom-full mb-2` (**above**) when `tooltipPlacementFor(box rect, innerHeight)` finds less than 160px under the box and more above. `data-placement` says which, and `data-testid` is `{testId}-tooltip`.</li><li>Hover has a 150 ms close delay on both the pill and the tooltip, so the pointer can cross the gap.</li><li>Unchanged: the button, the accessible name, `aria-describedby`, focus / click / blur, and Escape consumed only while open (window capture).</li></ul>Equal sizing:<ul><li>`KpiStrip`'s grid gains `auto-rows-fr`.</li><li>An indicator tile gets `h-full pr-20` and its box `relative h-full`.</li><li>A tile with no indicator renders exactly as before.</li></ul> |
| `app/admin/finance/components/BlockKpi.tsx` | `pr-9` → `pr-20` (room for the pill); a header note. Its box is the tooltip's `relative` anchor, so the tooltip opens below the block KPI box |

**Clipping check:** no `overflow-hidden` on the strip, the tile, the box or Finance's sections. `AdminChrome`'s `main` is `overflow-y-auto`, a scroll container that scrolls rather than clips, and its parents' `overflow-hidden` sit outside the scrolled area. The tooltip is `z-30`, above the content that follows.

**`console.*`:** 0 in both source files.

### Callers reached (all intended, per the user's "make all boxes the same size")

Analytics, Archiving, Invites, Business OS AI Activity, Charge checks, Business OS AI settings, Plans & entitlements, Jobs & queues, Exchange rates, Model pricing, Businesses and Finance. All of their suites pass unchanged (counts below).

### Ruled re-freeze: Pin A (flag for SA)

`KpiStrip.callers.pin.render.test.tsx` file sha256 (LF): **`e7d8da203997b0d822826cbb03044b35237ae3027925d05cdee769d47e50e8fc` → `98cadff30a30c72f541653d62781565a589328e0e16d54830842271f6a6ee7b4`**. The "before" is main's file after #479, which added the Exchange rates cases.

- **40** case hashes moved: every case that renders the strip (`auto-rows-fr`), plus the five A3 indicator cases (the pill, the sibling tooltip, `h-full pr-20`).
- The A1 bare-tile cases with no indicator are **byte-identical**.
- A header note records the re-freeze.

| Case | Before | After |
|---|---|---|
| A1 strip children | `c508be9c9307…` | `9a83fc289de4…` |
| A1 strip loading 3 | `33df0ad454d0…` | `aa4935d00b13…` |
| A1 strip loading 4 | `00ff7c443adc…` | `45c9f289d0fc…` |
| A1 strip loading 5 | `a1b6856bed75…` | `c5bb805961ec…` |
| A1 strip loading default | `00ff7c443adc…` | `45c9f289d0fc…` |
| A1 strip loading with children (Jobs) | `00ff7c443adc…` | `45c9f289d0fc…` |
| A1 strip not loading with children (Jobs) | `b0f973c97459…` | `25c330ce9bfa…` |
| A2 AnalyticsKpis loading bos | `00ff7c443adc…` | `45c9f289d0fc…` |
| A2 AnalyticsKpis loading all | `a1b6856bed75…` | `c5bb805961ec…` |
| A2 AnalyticsKpis bos | `3eebeeeac0de…` | `5bbe567eea8c…` |
| A2 AnalyticsKpis all | `43cb021f0b04…` | `a9bbfb89dd2c…` |
| A2 ArchivingKpis loading | `00ff7c443adc…` | `45c9f289d0fc…` |
| A2 ArchivingKpis | `0f77d90b359f…` | `eb5d340a074e…` |
| A2 ArchivingKpis failed run | `9f717ec68e67…` | `a2ed84979c2d…` |
| A2 InviteKpis loading | `a1b6856bed75…` | `c5bb805961ec…` |
| A2 InviteKpis | `32b71808fea3…` | `150679220b45…` |
| A2 ActivityKpis loading | `00ff7c443adc…` | `45c9f289d0fc…` |
| A2 ActivityKpis | `a816e75980a7…` | `a9e127f5ddf6…` |
| A2 CostsKpis loading | `a1b6856bed75…` | `c5bb805961ec…` |
| A2 CostsKpis | `3f9aebb93447…` | `e22045d420bf…` |
| A2 CostsKpis no sections | `9cb293771862…` | `e8d692a0abc2…` |
| A2 SettingsKpis loading | `00ff7c443adc…` | `45c9f289d0fc…` |
| A2 SettingsKpis | `1587aea98bfb…` | `2ba767a09c39…` |
| A2 SettingsKpis quiet | `04f6b49dba54…` | `ad762af1dcd9…` |
| A2 PlansKpis loading | `00ff7c443adc…` | `45c9f289d0fc…` |
| A2 PlansKpis | `db11968a0448…` | `63fcccbf9f42…` |
| A2 PlansKpis one | `5d82771cf7fd…` | `485dd8565e2a…` |
| A2 BusinessesKpis loading | `33df0ad454d0…` | `aa4935d00b13…` |
| A2 BusinessesKpis | `df69b7b5e517…` | `b519a2272971…` |
| A2 Model pricing reading | `be9d1a213d32…` | `e6a7e097cca0…` |
| A2 Model pricing unavailable | `31241fbf7736…` | `5c98bf373888…` |
| A2 Model pricing recent | `13a71e361d6e…` | `afe7ca77c2df…` |
| A2 ExchangeRatesKpis loading | `b628c0bab0e9…` | `db7f5d3e4e99…` |
| A2 ExchangeRatesKpis | `41899b6997db…` | `c7da5668e58c…` |
| A2 ExchangeRatesKpis none stale | `ada696c76cf9…` | `8534cba87cd6…` |
| A3 Finance anchor lagging with status and detail | `aa49c3366273…` | `34166a30ada7…` |
| A3 Finance anchor leading with sub and detail | `9bc3350d8d95…` | `331063459874…` |
| A3 Finance tab filter current lagging | `7ec83c051358…` | `9d94402070f3…` |
| A3 Finance tab filter lagging | `86aeb0ef2ea5…` | `5ae604690d8a…` |
| A3 Finance no target lagging (a business picked) | `656beb659ca8…` | `876167dd1a46…` |

The other Finance and layout pins are unchanged (HEAD blob plus `git diff --quiet`):
- AC-173 `3a1a2dd4…` and its helper `b84e0c96…`;
- Pin B `a1b3db0c…`, which reads text and the indicator's kind only, so the pill moved nothing;
- Pin C `98ea0507…` and its helper `02813360…`;
- Pin D `1f7cf07a…`;
- `route.test.ts` / AC-145 `ff387500…`.

### Tests

Ruled edits:
- `KpiStrip.render.test.tsx`: the strip class now carries `auto-rows-fr`.
- `KpiIndicator.render.test.tsx`:
  - the icon assertion is replaced by the pill text "Lagging" (no svg);
  - "not colour-coded" now checks the pill's neutral classes;
  - the hover test is now the delayed close with fake timers;
  - `pr-9` → `pr-20` and `h-full`.

New (8, `MK-0a` describe):
- pill text and accessible name;
- the tooltip is a sibling of the link inside the box, after it, never inside the link or the pill;
- below by default (`data-placement="below"`, `top-full`, `left-0 right-0`);
- **flips above** with a mocked box rect near the viewport bottom;
- the pure placement rule;
- a block KPI box gets the same placement;
- equal sizing (`auto-rows-fr`, equal `grid-cols`, no `items-*` override, `h-full` on the indicator tile and its box);
- no click-through, and Escape consumed only while open, the second press reaching the parent.

### Runs

| Run | Result |
|---|---|
| `app/admin/components` (Pin A, layout, Jobs) | 26 suites, 874 passed |
| `app/admin/finance` | 23 suites, 797 passed |
| The other callers (`analytics`, `archiving`, `business-os-invites`, `business-os-llm`, `business-os-tiers`, `exchange-rates`, `system-config`, `users`) | 81 suites, 2408 passed |
| Layout (C-14) and contrast guards | 496 passed |
| Vocabulary guard | 182 passed |
| `test:authz-guard` | 2 suites, 203 passed |
| `test:bos-entitlements` | 301 suites, 9125 passed |
| `lint:hooks` | exit 0 |
| ESLint on the touched files | clean |
| Scoped tsc | 96 root files: `app/admin/components/layout/**/*.{ts,tsx}`, `app/admin/finance/**/*.{ts,tsx}`, `next-env.d.ts`. The canary gave TS2322 at `KpiStrip.tsx(505,7)`; the file was restored byte-identical, and the clean run had 0 errors in scope |

**Full `npm test`:** 1603 suites (1572 passed, 23 failed, 8 skipped) and 40,931 tests (40,713 passed, 153 failed, 65 skipped), in 1112 s. The machine was under load: the usual run takes about 600 s.

- **20 of the 23 failing suites are the Windows baseline, unchanged.**
- **3 failed only in this run:**
  - `app/admin/__tests__/jobsQueues.drain.render.test.tsx` (a double-click timing test);
  - `app/admin/analytics/__tests__/analytics.table.render.test.tsx`;
  - `components/business-os/settings/__tests__/MarketingConsentDrawer.render.test.tsx`.

  **All 3 pass when re-run alone** (3 suites, 73 passed). They are timing flakes under load, and none imports the indicator or asserts the strip's classes.

**Owed to the user:** a browser look at the pill, the tooltip below the tile (and above near the bottom), and equal tiles on Finance and one other page.


### QA optional findings E-1 and E-2 (fixed by Dev, 2026-10-20)

- **E-1, phone width (fixed by Dev).** A right-column tile's tooltip ran about 30px off-screen. The new pure function `tooltipClampFor` compares the box's left edge plus the tooltip width (at least 224px) with the viewport width less a 16px gutter. When the tooltip would overflow, it is right-aligned to the tile's right edge (`right: 0; left: auto`, plus `data-align="end"`), and its width is capped at the box's right edge less 16px. When it fits, nothing is added, so the closed markup and Pin A are unchanged.
- **E-2, flip margin (fixed by Dev).** `tooltipPlacementFor` now takes the tooltip's measured height (`offsetHeight`). It needs that height plus the 8px gap and an 8px margin below the box, otherwise it flips above. While the tooltip is still unmeasured, it assumes 160px.
- **Tests:** 4 new tests in `KpiIndicator.render.test.tsx`:
  - the clamp rule;
  - a right-edge tile rendering right-aligned;
  - no style when the tooltip fits;
  - the flip boundary, 136px against 135px.
- **Runs:** `app/admin/components` with the layout and contrast guards: 27 suites, 975 passed. Pin A file hash is still 98cadff3.

## SA Review Notes

### SA Review (workplan and code, MK-0a)

**Reviewed by SA, 2026-10-19. Reviewed: the uncommitted tree on `fix/admin-kpi-indicator-word-pill` (from main `a9551d9c`).**
**Status: Code Approved (SA-MK0A).** No conditions.

#### Rulings

- **Pin A re-freeze `e7d8da20` → `98cadff3` (40 cases): within MK-0a, ruled.** The user's decision 3 ("every KpiStrip tile the same size, on every page") is a change to the **shared strip**, so every Pin A caller entry moves with it by design. Pin A exists to catch an *unintended* change to a caller. Here the change is intended, recorded and the same for every caller: `auto-rows-fr` on the strip grid and `h-full` on an indicator tile. One re-freeze with before and after hashes is the right record. No other pin moved: SA recomputed AC-173 `3a1a2dd4`, its helper `b84e0c96`, Pin B `a1b3db0c`, Pin C `98ea0507`, its helper `02813360`, Pin D `1f7cf07a`.
- **Equal sizing on the other admin pages: safe.** The callers are:
  - Analytics;
  - Archiving;
  - Invites;
  - Business OS AI Settings, Activity and Costs;
  - Plans & entitlements;
  - Jobs & queues;
  - Exchange rates;
  - System config;
  - Businesses;
  - Finance.

  Column widths were already equal (`grid-cols-2 / md:3 / xl:5` is unchanged). Grid items already stretch, so the only new effect is `auto-rows-fr`, which gives a wrapped second row the first row's height. **A strip with fewer tiles** keeps the same five-column track and leaves empty cells, exactly as before; nothing is re-laid. A tile with no indicator renders its old element, which fills the cell as a grid item. All 57 suites related to `KpiStrip.tsx` / `BlockKpi.tsx` plus `app/admin/__tests__` pass (**66 suites, 2137 tests**), and those include every caller page's render tests.

#### Verified

| Item | Result |
|---|---|
| Accessibility unchanged | ✅ The same native `<button type="button">`. The same accessible name `"{Leading/Lagging} indicator. {definition}"` (the pill's visible word is a prefix of it). The same `aria-describedby` → `role="tooltip"`, focus and blur, and a click that only opens. Escape is still consumed **only while open** (window, capture, `stopPropagation`; a closed tooltip has no listener, QA-MK0-N1). The tooltip is a **sibling** of the pill inside the tile's `relative` box, outside the link, so there is no click-through and no interactive content inside the link |
| Hover reach (WCAG 1.4.13) | ✅ The tooltip itself is hoverable, and a 150 ms close delay lets the pointer cross the gap. That is an improvement on MK-0 |
| Clipping | ✅ No ancestor of a strip or block KPI has `overflow: hidden` up to `<main className="overflow-y-auto">` (`AdminChrome.tsx:47`). The tooltip spans the box horizontally (`left-0 right-0`, at least 14rem), so it cannot be cut sideways. Vertically it either sits in the scroll area or flips above near the viewport's bottom (`tooltipPlacementFor`, pure and tested). The shell's `overflow-hidden` wrappers (`:39`, `:44`) are outside `<main>`'s scroll box and do not clip it |
| Neutral pill (BD-11, LL-1) | ✅ Slate border and secondary text, with no status colour. The contrast guard passes inside `app/admin/__tests__` |
| No dependency | ✅ `package.json` and the lockfile are unchanged. The arrow and clock icon imports are removed |
| The three extra full-gate failures | **Load, not this change.** `jobsQueues.drain.render.test.tsx` renders `JobsQueuesView`, which **does** render `KpiStrip`. `analytics.table.render.test.tsx` imports only `isPlainLeftClick` from the module. `MarketingConsentDrawer.owner.test.tsx` does not use it. SA ran all three alone: **45 of 45 passed**. The other 20 failures are the known Windows set |

#### Code Approved for QA: Yes

## QA Testing Report

**QA — 2026-10-20** (worktree `neuronforge-finance-m8`, branch `fix/admin-kpi-indicator-word-pill` on `a9551d9c`, uncommitted)
**Test mode:** full
**Strategy used:**
- **A:** Jest suites and guards, each run alone.
- **A, jsdom:** a temporary `user-event` probe with real hover, Tab, click and Escape.
- **D-lite, real layout:** the probe's rendered HTML, compiled with the repo's Tailwind 4 and measured in **headless Chrome** at three content widths: 1168px (5 columns), 852px (3), 452px and 390px (2).
- A wide scoped tsc with a canary.

The probe test and the Chrome files were untracked or in the scratchpad, and are deleted or kept outside the repo (`git status` shows only Dev's 5 files plus this workplan).

**Focus:** ui
**Skipped:** the live page in a signed-in browser (user, steps below).
**Input source:** prompt + workplan

**Verdict: PASS. No bugs.** Two Low edge cases and one pre-existing main issue are noted below.

### Behaviour

| Item | Result | Evidence |
|---|---|---|
| The pill reads "Leading" / "Lagging" | ✅ | Probe: the button's text is exactly `Lagging` / `Leading`, with no svg. The accessible name is unchanged ("Lagging indicator. Money owners…"). The Chrome screenshot shows a small bordered pill in the corner |
| Neutral, not colour-coded | ✅ | The probe's five Finance pills (amber, green and no status) share one identical class string, with no red / amber / green / emerald / yellow / orange classes. Chrome computed colour is slate-300 text on a slate-600 border, the same on every tile |
| Never overlaps a long label | ✅ | Chrome rect intersection of the pill against the label and the value: **no overlap at any width**, including a 4-line label ("Paying accounts with an unusually long label that wraps") and "Charged AI cost this month" on 2 lines. The block KPI is also clear (`pr-20`) |
| The tooltip opens **below**, **outside** the tile | ✅ | Chrome: for all 6 tooltips (5 tiles + 1 block KPI) at every width, `tooltip.top ≥ box.bottom`. The tooltip is a sibling of the link (probe: `parentElement` is the box; the link does not contain it) |
| At the tile's width | ✅ | Equal to the box width at 852px (263 = 263). At 1168px and 452px the box is narrower than `min-w-[14rem]`, so the tooltip is 224px against a 208 / 211px tile (as designed). The block KPI tooltip is the box width minus its 1px borders |
| The tile's value and label stay visible | ✅ | Chrome: the tooltip never intersects the label or the value, below **or** above |
| Flips **above** near the viewport bottom | ✅ | **Rule (jsdom, real hover, mocked rect):** a box at 650–760 in an 800px viewport gives `data-placement="above"` and `bottom-full`, not `top-full`; after unhover and re-hover with room, it is `below` again. **Geometry (Chrome, above variant):** `tooltip.bottom ≤ box.top`, with no overlap of the label or value, for all 6 |
| Not clipped | ✅ | Chrome, with the tooltip scrolled into view: all four corners and the centre resolve (`elementFromPoint`) to the tooltip itself. It is not covered by the next row's tiles (`z-30`) or cut by the `overflow-y-auto` main, and stays inside main horizontally at 1168 / 852 / 452px (but see E-1 at 390px) |
| Hover, focus and click open the tooltip | ✅ | Probe: `user.hover` opens it. Tab reaches the tile link, then the pill, and focus opens it. `user.click` opens it |
| Escape, blur and moving away close it | ✅ | Probe: moving the pointer from the pill **onto the tooltip** keeps it open past the 150 ms delay (hoverable). Leaving both closes it. Escape closes it with focus kept on the pill. Tab away (blur) closes it once the pointer has left |
| Escape is consumed only while open | ✅ | Probe with a window keydown listener: Escape while **closed** reaches it (1 call); Escape while **open** does not (0 calls); the next Escape does (1 call) |
| A pill click never follows the tile link | ✅ | Probe: a real click on the pill leaves `location.hash` empty and the button has no `<a>` ancestor; a click on the tile then sets `#revenue` |
| Block KPIs get the same placement | ✅ | Probe: the tooltip's parent is the `BlockKpi` box; near the bottom it flips `above`. Chrome: below the box, not over the label, value or chip |
| Equal tile sizes | ✅ | Chrome, every strip at every width has **one width and one height**, and each tile fills its cell (the indicator tile is the box's full width and height). Finance 5 tiles: 208×250 (1168px), 263×198 (852px), 211×230 (452px). The mixed strip (anchor, filter `current`, plain, red with sub + detail): one size each. The real `BusinessesKpis`: one size each |
| Equal sizes on every caller | ✅ | Code read: all 12 callers render `KpiTile`s as **direct** children of `KpiStrip` (conditional `{x && <KpiTile/>}` and Jobs' `.map` included), so the grid's `auto-rows-fr` with stretch applies to each, with no wrapper to break it. Their suites pass unchanged (below) |
| Pins | ✅ | Pin A `98cadff3` (ruled). Unchanged: Pin B `a1b3db0c`, AC-173 `3a1a2dd4` / helper `b84e0c96`, Pin C `98ea0507` / helper `02813360`, Pin D `1f7cf07a` (`m5WordingOnly.pin.test.ts`), and `route.test.ts` `ff387500` with AC-145 `a13f1ccd…0060`. `git diff --quiet HEAD` covers the finance tests, `app/api` and `lib` |

### Suite runs (each alone)

| Suite | Result |
|---|---|
| `app/admin/components` (Pin A, layout, Jobs) | 26/26, **874/874** |
| `app/admin/finance` | 23/23, **797/797** |
| Other callers (analytics, archiving, invites, business-os-llm, business-os-tiers, exchange-rates, system-config, users) | 81/81, **2408/2408** |
| Contrast (LF-1) + layout folder (C-14) + vocabulary guards | 3/3, **678/678** (= Dev's 496 + 182) |
| `npm run test:authz-guard` | 2/2, 203/203 |
| `npm run test:bos-entitlements` | 301/301, 9125/9125 |
| `npm run lint:hooks` | exit 0 |
| The three load-failed suites alone: `jobsQueues.drain`, `analytics.table`, `MarketingConsentDrawer` | 3/3, **73/73** |

**Wide scoped tsc:**
- Config in the scratchpad: `app/admin/components/**`, `app/admin/finance/**` and all 8 other caller folders. That is 324 admin files plus `next-env.d.ts`, wider than Dev's 96.
- The canary in `KpiStrip.tsx` gave `(505,7) TS2322`. The file was restored with `cp` and checked with `cmp` (identical).
- The clean run gives **0 errors in any file this branch touches**. It reports **one pre-existing error, not from this branch:** `app/admin/system-config/__tests__/pageLayout.render.test.tsx(114,3) TS2741`, "Property 'anthropic' is missing in type … 'FetchStatus'". Price-review slice 10 (`d201fbde`) added `anthropic` to `FetchStatus`, but this test fixture was never updated. The file is untouched here, and ts-jest does not type-check, so the suite is green. It is a **main** issue for a separate fix (TL to route); it does not block MK-0a.

### Issues Found

**Bugs:** none.

**Edge cases (Low, nice to fix):**
1. **E-1, narrow screens.** With a content area about 390px wide (2 columns, 156px tiles), the right-column tooltip (`min-w-[14rem]`, anchored `left-0`) ends about 30px past the viewport's right edge, so main gains a horizontal scroll. Desktop widths (452px and up) are fine. A possible fix: anchor right-column tooltips `right-0`, or cap at `max-w-[calc(100vw-2rem)]`. Admin is desktop-first, so this is Low.
2. **E-2, flip margin.** The flip triggers when less than 160px is left below the box. The tallest current tooltip measures 150px (MRR at 1168px and 452px), plus the 8px gap, giving 158px. A longer definition, or a narrower tile, would leave the bottom of the tooltip below the viewport when the room is between 160px and its height. It scrolls rather than clips. A possible fix: measure the tooltip's own height instead of a constant.

Accepted, not an issue: R-2. At a 390px content width, Finance rows are 394px tall, because `auto-rows-fr` makes every row as tall as the tallest tile. That is the user's decision.

### User browser steps (signed in as an admin)
1. **Money → Finance.** Each of the 5 tiles shows a small grey pill, "Leading" (MRR) or "Lagging" (the rest), in its top-right corner. It is the same grey on an amber or green tile, and no label runs under it. All 5 tiles are the same width and height.
2. Hover a pill. The explanation opens **below** the tile, as wide as the tile, and the tile's figure and label stay readable. Move the pointer down onto the explanation: it stays open. Move away: it closes.
3. Scroll so a tile sits near the bottom of the window, then hover its pill. The explanation opens **above** the tile.
4. Tab to a pill: it opens. Press Escape: it closes. Press Escape again inside a drawer: the drawer closes. Click a pill: the page does **not** jump. Click the tile: it jumps.
5. Credits section: the block figure's pill behaves the same, opening below the box.
6. Open one other page with a strip (for example **Jobs & queues** or **Businesses**). Every tile in the strip is the same size.

### Final Status
- [x] All MK-0a behaviours pass. Pin A moved as ruled; every other pin is unchanged. No bugs. **Ready for RM.** E-1 and E-2 are optional follow-ups. The system-config TS2741 on main needs a separate fix.
- [ ] Issues found

## Commit Info

- **Branch:** `fix/admin-kpi-indicator-word-pill` (from main `a9551d9c`, which had not moved; no merge needed, no Pin A conflict)
- **Commit:** `85a165f2` fix(admin): KPI indicator as a Leading/Lagging pill, tooltip below the tile, equal tile sizes (MK-0a)
- **Pin A:** `98cadff3` (ruled); every other pin unchanged
- **PR:** [#481](https://github.com/AgentsPilot/neuronforge/pull/481), auto-merge on (merge commit, via the merge queue)

---

## Change History

| Date | Change | Details |
|---|---|---|
| 2026-10-19 | Created and implemented (Dev) | The pill, the tooltip below or above the box, equal tiles |
| 2026-10-19 | SA review | Code Approved (SA-MK0A): Pin A re-freeze e7d8da20 to 98cadff3 ruled within MK-0a; equal sizing safe on every caller; accessibility unchanged, no clipping, no dependency; the 3 extra failures pass alone (jobsQueues.drain does render KpiStrip) |
| 2026-10-20 | QA E-1/E-2 fixed (Dev) | Tooltip clamped inside the viewport on phones; the flip uses the measured height plus a margin; 4 tests; Pin A unchanged |
