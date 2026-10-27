# Workplan: Block KPI tiles on the five-tile grid

> **Last Updated**: 2026-10-27

**Developer:** Dev
**Requirement:** the user's request of 2026-10-27 (short UI path, no requirement MD): "have the tiles layout as it there are 5 tiles in the sub areas, similar to the head of the page … have them in a 5 tile layout format"
**Branch:** `feature/admin-block-kpi-5-grid` (worktree `neuronforge-kpigrid`, from origin/main 89cd0d90)
**Date:** 2026-10-27
**Status:** Code Complete (uncommitted)

## Overview

Inside a section, the headline tiles (`BlockKpi`) sit on their own: one tile stretches across the whole section, and Client payments' two tiles share a 2-column grid. Neither reads as a tile next to the five-tile strip at the top of the page. This change puts every section's headline tiles on the page-top strip's own grid, so a tile in a section is one column of five, the same width as a top tile.

---

## Callers found

`grep BlockKpi` over `app/`, `components/`, `lib/` (and the concurrent `neuronforge-finfu` bundle, which adds none):

| Page | Section | Tiles | Before | File |
|---|---|---|---|---|
| Finance | Credits | "Accounts over allowance" | 1 tile, full section width | `app/admin/finance/components/CreditsSection.tsx` |
| Finance | Client payments (no dollar figure) | "Businesses taking client payments" | 1 tile, full width | `app/admin/finance/components/TakingsSection.tsx` |
| Finance | Client payments (with the dollar figure) | the above + "Client payments processed" | 2 tiles, each half the width (`grid gap-3 sm:grid-cols-2`) | `app/admin/finance/components/TakingsSection.tsx` |
| AI cost | Leak check (page variant only) | "Businesses with uncharged calls" | 1 tile, full width | `app/admin/business-os-llm/components/costs/LeakCheckPanel.tsx` |

Not tiles, so out of scope: Revenue and Plans & subscriptions have no `BlockKpi`; their figures are `<dl>` summary lists (`credits-summary`, `plans-subscriptions-totals`, AI cost's `dl`s). The Leak check's drawer variant renders no KPI.

## Design

**Reuse `KpiStrip` itself as the row container.** Each section wraps its `BlockKpi`s in `<KpiStrip>`, the component that draws the page-top strip. Its grid is `grid auto-rows-fr grid-cols-2 gap-4 md:grid-cols-3 xl:grid-cols-5`, so:

- one tile takes one column of five on a wide screen (one of three on a tablet, one of two on a phone), and the rest of the row stays empty;
- two tiles take two columns, equal width and equal height;
- the breakpoints and gap are the top strip's, by construction: there is one copy of the grid, so they cannot drift.

Why not a new `BlockKpiRow` export or a shared grid constant: both add an export to the shared layout folder (CLAUDE.md rule 7) and the layout-folder guard; reusing the existing component adds nothing. `KpiStrip` without `loading` renders exactly `<div class="grid …">{children}</div>`, so it is a pure grid here.

`BlockKpi` is not touched, so its markup hash (`99c6969c…`) holds. A grid item stretches to its cell by default, so the tile fills its cell height without an `h-full`.

Client payments keeps its `data-testid="takings-headlines"` on a plain wrapper `div` around the strip (no class), so existing tests keep their hook and `KpiStrip` needs no new prop.

## Files

| File | Action | Reason |
|---|---|---|
| `app/admin/finance/components/CreditsSection.tsx` | modify | wrap the block KPI in `<KpiStrip>` |
| `app/admin/finance/components/TakingsSection.tsx` | modify | both branches: `<KpiStrip>` replaces the 2-col grid / the bare tile |
| `app/admin/business-os-llm/components/costs/LeakCheckPanel.tsx` | modify | wrap the page-variant KPI in `<KpiStrip>` |
| `app/admin/finance/__tests__/blockKpiGrid.render.test.tsx` | create | Credits (1 tile), Client payments (1 tile and 2 tiles) sit directly in the strip grid |
| `app/admin/business-os-llm/__tests__/blockKpiGrid.render.test.tsx` | create | Leak check (1 tile) in the strip grid; drawer variant has no KPI and no grid |
| `app/admin/__tests__/blockKpiGrid.source.guard.test.ts` | create | every admin file rendering `<BlockKpi` imports and renders `<KpiStrip>` (catches a future caller) |
| `app/admin/finance/__tests__/financePage.render.test.tsx` | modify (1 line) | MK-1 test asserted the tile is `takings-body`'s first child; it is now the first cell of the strip that is that first child |
| this workplan | create | |

No overlap with the `neuronforge-finfu` bundle (it touches `RevenuePanel`, `PayingBreakdownSection`, `financeCopy.ts`, the finance lib and repositories, none of these files).

## Pins

| Pin | Moves? | Why |
|---|---|---|
| `BlockKpi` markup hash `99c6969c…` | no | `BlockKpi.tsx` untouched |
| Pin A (`KpiStrip.callers.pin`) | no | `KpiStrip.tsx` untouched; new callers are not in its cases |
| Pins B-D, T-12, AC-173 (requests) | no | no request or URL change |
| AC-145 (route payload hash, `route.test.ts`) | no | no payload change; file not touched |
| Layout folder guard | no | no new file or export in the layout folder |
| Render tests asserting structure | one line moves | `financePage.render.test.tsx` MK-1 "Client payments … is the headline": `takings-body.firstElementChild` → `.firstElementChild?.firstElementChild`. The bundle (`neuronforge-finfu`) also edits this file, in other hunks (lines 423-1650); no line overlap |

## Task List

- ✅ Step 1: worktree, junction, read standard and callers
- ✅ Step 2: wrap the three callers in `KpiStrip`
- ✅ Step 3: render test for every row, including the one-tile case
- ✅ Step 4: finance, AI cost, layout and `app/admin/__tests__` suites; scoped tsc

## SA questions (with Dev defaults)

1. **SA-Q-1: `KpiStrip` used as a block-row container.** Reusing the page-top strip component inside a section, rather than a new `BlockKpiRow` export. Default: yes, reuse; it is one grid, and no new export means no rule-7 pattern. If SA prefers a named export, the alternative is `BlockKpiRow` in `BlockKpi.tsx` rendering `KpiStrip`.
2. **SA-Q-2: tile padding and corner.** `BlockKpi` is `p-3 rounded-lg`, the top tile `p-4 rounded-xl`, so a section tile is a few pixels shorter with a slightly tighter corner. Default: leave it (the hash holds; width and grid are what the user asked about). Matching would move the `BlockKpi` hash.
3. **SA-Q-3: phone width.** On a phone the strip is two columns, so a single block tile takes half the width, as a single top tile would. A long figure ("≈ $1,234,567") beside the `pr-20` pill room is as tight as on the top strip; QA to eyeball at 375 px.

## Test results

- New: 3 suites, 8 tests, all pass.
- Combined run (`app/admin/finance`, `app/admin/ai-cost`, `app/admin/business-os-llm`, `app/admin/components/layout`, `app/admin/__tests__`): 94 suites, 3,559 tests. 11 failures in 6 suites: 1 real (the MK-1 structure line above, fixed); the other 10 were timeouts under full parallel load and pass on rerun with `--maxWorkers=1` (`financePage` 211/211, `exchangeRatesTab` 20/20, `jobsQueues.items` 25/25, `costsTab`, `costsLayout`, `aiCostDrawers` pass).
- Pins unchanged and green: `BlockKpi` hash, Pin A, layout folder guard, `financeTiles.pin`, `financeRequest.pin`, contrast guard.
- `tsc --noEmit` (full, ran to completion, 1,849 pre-existing errors elsewhere): 0 in touched files. ESLint on touched files: clean.

## SA Review Notes

### SA Code Review (SA-CR-KPIGRID)

**Code Review by SA — 2026-10-27** (uncommitted tree on `89cd0d90`)
**Status:** ✅ Code Approved, with one change (G-1) to make before QA.

**What I read**
- The four source diffs and the shared `KpiStrip` and `BlockKpi`.
- Wrapping each caller in `<KpiStrip>` (no `loading` prop) renders exactly the page-top grid: `grid auto-rows-fr grid-cols-2 gap-4 md:grid-cols-3 xl:grid-cols-5`. That is what the user asked for.
- There is no new export or file, and no logic change. The `takings-headlines` test id is kept.
- The one moved structural assertion in `financePage.render.test.tsx` is a ruled test edit: the block KPI is now one level deeper.
- The source guard (every `<BlockKpi` file renders `<KpiStrip>`) prevents drift.

**Rulings**

| # | Ruling |
|---|---|
| SA-Q-1 | **Reuse `KpiStrip`; no `BlockKpiRow`.** It is the very grid the user pointed at, so reusing an existing shared export is the rule-7-compliant choice. A wrapper export would add a name with no new behaviour. |
| **SA-Q-2** | **Match the top tile's frame. Change G-1.** The user's words are "similar to the head of the page" and "hard to identify the tile", so the tile's look is part of the ask, not just the grid. Change `BlockKpi`'s frame from `rounded-lg … p-3` to `rounded-xl … p-4`, which is the top tile's `TILE_BASE`. Keep `pr-20` for the pill, and keep the border and background as they are. This is one class change in a shared component, and it applies to all three callers at once, which is the point. **The `BlockKpi` hash moves (`99c6969c…` → new) as a ruled re-freeze.** Record the before and after hashes in this workplan. The only edit in the hash test is the constant, and the diff is that one class string. The contrast and layout-folder guards must stay green unedited. Pin A does not move, because `BlockKpi` is not a `KpiTile`. |
| SA-Q-3 | **Accepted. QA checks at 375 px.** The two-column phone grid is the same one the top strip already uses. The tightest cases are "≈ $1,234,567" and the amber chip beside the `pr-20` pill room. If either overflows, report it to SA. Do not fix it ad hoc. |
| Overlap | **Accepted.** The bundle and this change edit different hunks of `financePage.render.test.tsx`. Whichever merges second takes `main` in, and the merge queue tests the combined tree. |

### Code Approved for QA: Yes, after G-1 (the padding and corner match, with the ruled `BlockKpi` hash re-freeze). Short path: SA does not need to see the G-1 diff again if QA confirms the hash diff is only the constant.

### G-1 resolved (Dev, 2026-10-27)

- `app/admin/components/layout/BlockKpi.tsx`: one class string, `relative rounded-lg border border-slate-700 bg-slate-800 p-3 pr-20` → `relative rounded-xl border border-slate-700 bg-slate-800 p-4 pr-20`. `pr-20`, border and background kept.
- Ruled re-freeze of the `BlockKpi` hash, in `app/admin/components/layout/__tests__/BlockKpi.render.test.tsx`. The only edit is the constant:
  - before `99c6969c1c394f247177a882555aba230c92cad8208edf9a498e3c73bc24fad4`
  - after `305cd6910751821c60b13b72afe7307f2897f66cfc6ccf16f32420775c780e48`
- Pin A, the contrast guard and the layout folder guard were not edited, and all are green.
- Test results after G-1: the combined run (`app/admin/finance`, `app/admin/ai-cost`, `app/admin/business-os-llm`, `app/admin/components/layout`, `app/admin/__tests__`, `--maxWorkers=4`) passed 94/94 suites and 3,559/3,559 tests, with no flakes. The full `tsc --noEmit` ran to completion with 1,849 errors already on main and 0 in touched files.

## QA Testing Report

### QA — block KPIs on the 5-tile grid, 2026-10-27

**Test mode:** full (UI-only short path). **Strategy used:**
- A: Jest suites, a byte-level DOM comparison against main, and a planted source-guard check.
- D, by browser measurement instead of clicking through: the real section DOM, rendered by Jest, served with the Tailwind CSS built for it inside a replica of the admin shell (`main p-6`, an off-canvas sidebar below lg and a 256 px sidebar from lg). It was loaded in headless Chrome inside an iframe of the exact viewport width (375 / 768 / 1024 / 1280 / 1440), measured with `getBoundingClientRect` and screenshotted.

**Focus:** ui. **Skipped:** live app click-through (no dev server or env in the worktree; the measurement above uses the real markup and real CSS). **Input source:** coordinator prompt + SA-CR-KPIGRID.

**Verdict: FAIL on SA-Q-3 (overflow found, reported to SA as ruled, not fixed).** Everything else passes.

#### Test Coverage

| Check | Tested? | Result | Notes |
|---|---|---|---|
| 1. Grid = top strip at every breakpoint | ✅ | Pass | Every block KPI row is the strip's grid. Measured columns: 2 at 375, 3 at 768 and 1024, 5 at 1280 and 1440, the same as the top strip in the same shell |
| 1. One or two tiles: one column each, rest of the row empty | ✅ | Pass | Takings 1 tile, Credits, Leak: 1 cell. Takings with the dollar figure: 2 cells of equal width and equal height (`auto-rows-fr`) |
| 1. Frame matches the top tile | ✅ | Pass | Computed radius 12 px, padding 16 / 16 / 80 (right), the same as a top KpiTile with an indicator. Label `text-sm`, value `text-2xl`, as on the top tile. Height follows content, as on the top strip |
| 2. Nothing else changed | ✅ | Pass | New Credits and Takings vs main's (extracted with `git show`) are byte-identical after unwrapping the strip div, mapping the frame class back and dropping the `takings-headlines` grid class (useId normalised). 8 cases: Takings with no usd, usd ok, stale, partial and missing EUR; Credits with far-over 1, 0 and null. This covers the pills and tooltips, the "Our customers' revenue, not ours" note, the stale chip, the far-over chip, accessible names and copy. The diff touches no Revenue, Plans, copy, fetch or route file. Leak: the diff is the wrapper only, with identical props |
| 3. SA-Q-3 phone check at 375 px | ✅ | **Fail** | B-1 and B-2 below. No horizontal scroll at any width: the document's `scrollWidth` equals the viewport, and `main`'s `scrollWidth` equals its `clientWidth` at all five widths |
| 4. Hash diff is only the constant | ✅ | Pass | `BlockKpi.render.test.tsx` numstat 1 / 1: `99c6969c…` → `305cd691…`, nothing else |
| 4. Pin A, contrast guard, layout-folder guard unedited | ✅ | Pass | No diff in `app/admin/components/layout/__tests__/` except that constant, and the only other test edit is the ruled `financePage` line. All green in the run |
| 4. New source guard catches a planted caller | ✅ | Pass | A planted `zz_PlantBlockKpi.tsx` (a BlockKpi with no KpiStrip) fails it, and so does an import-only plant (KpiStrip imported, never rendered). Green again after removal |
| 4. Suites | ✅ | Pass | `app/admin/finance`, `app/admin/ai-cost`, `app/admin/business-os-llm`, `app/admin/components/layout`, `app/admin/__tests__` (`--maxWorkers=4`): 94 / 94 suites, 3,559 / 3,559 tests |
| 4. Scoped tsc | ✅ | Pass | The 9 touched or new .ts/.tsx files (8 GB, no OOM): the only error is the canary in `BlockKpi.tsx`; restored, `cmp` clean |

#### Issues Found

**Bugs (for SA to rule; not fixed by QA):**

1. **B-1: the Credits far-over chip runs out of its tile at 1280 px and at 375 px.** Severity: Medium. File: `app/admin/components/layout/BlockKpi.tsx` (the chip row), via `CreditsSection.tsx`.
   - The chip is `whitespace-nowrap`, so it cannot wrap. With the count 1, "1 at or over 150% of allowance" measures 182 px.
   - **At 1280 px** (xl, 5 columns, sidebar showing) the tile is 172.6 px wide and the chip ends **26.6 px past the tile's right border**. A larger count makes it wider.
   - **At 375 px** the tile is 131 px wide and the chip ends **68 px past the border**.
   - It is fine at 768, 1024 and 1440 (tiles of 204 to 213 px).
   - Before this change the tile was full width, so this is new.
   - Steps: Finance → Credits with at least one far-over account, at a 1280 px or a phone viewport.
   - Expected: the chip inside the tile. Actual: it crosses the border into the empty grid space. There is no scroll.
2. **B-2: at 375 px the indicator pill covers the first word of the label.** Severity: Medium (phone). Cause: `pr-20` together with a half-width tile.
   - The content box is about 33 px wide, so a first word longer than that (e.g. "Accounts", "Businesses") runs under the absolute "Leading" pill.
   - This hits all five block cases: Takings with 1 and 2 tiles ("Businesses taking client payments"), Credits ("Accounts over allowance") and Leak ("Businesses with uncharged calls").
   - There is no overlap at 768 px and above.
   - The top strip's labels in the same probe ("Revenue received") did not collide.
3. **B-3: at 375 px the long dollar figure and the stale chip spill slightly.** Severity: Low.
   - "≈ $1,234,567" wraps after "≈", and "$1,234,567" ends 3.7 px past the tile border; "At least ≈ …" behaves the same.
   - The amber "Uses a stale rate" chip (122 px, nowrap) ends 8 px past the border.
   - Neither reaches past the section's padding, so there is no scroll, and neither touches the pill (they sit on lower lines).

**Edge cases / observations:**
- O-1: the source guard is file-level (it checks that KpiStrip is imported and rendered). A file that renders a strip and also a BlockKpi outside it would pass. The per-caller render tests cover today's callers.

#### Test Outputs / Logs
- Measurement JSON and screenshots (scratch, not in the repo): `qa_kpigrid/m375.json`, `m1280.json`, `c375.png`, `c1280.png`, `s375.png`, `s1280.png`.
- At 375 px: tile 131 px; Credits `chipPast` 68.2; USD `valuePast` 3.7, `chipPast` 8; `labelOverPill` true on all 5 block tiles.
- At 1280 px: Credits tile 172.6 px, `chipPast` 26.6.

#### Probes
All deleted; none kept:
- `app/admin/finance/__tests__/zz_kpigrid_dump.render.test.tsx`
- `app/admin/finance/__tests__/zz_kpigrid_same.render.test.tsx`
- `app/admin/finance/components/zz_OldCreditsSection.tsx`
- `app/admin/finance/components/zz_OldTakingsSection.tsx`
- `app/admin/finance/components/zz_PlantBlockKpi.tsx`

The canary was restored with `cp` and checked with `cmp`. No source changed, no commit, no stash.

#### Final Status
- [ ] All acceptance criteria pass — ready for commit
- [x] Issues found — SA to rule on B-1 / B-2 (B-3 Low) before commit; everything else passes

### SA ruling on QA findings B-1 to B-3 (SA-R-KPIGRID-2)

**Ruled by SA — 2026-10-27.** The findings are real, and QA was right to report them unfixed.

**Q1: how does the page-top `KpiTile` handle this?**
- **The pill:** the same as `BlockKpi`. The tile has `pr-20` (`INDICATOR_PAD`), and the pill is absolute at `right-2 top-2`.
- **Status:** **no nowrap chip.** Status and the sub-line are plain block text lines under the value (`mt-1 block text-xs`, icon plus words), so they wrap inside the tile.
- **Why the top strip does not collide at 375 px:** its tiles are 148 px wide, because the strip sits directly in `main`. Block rows sit inside the section card's own padding, which leaves 131 px. Its labels' first words also happen to be short ("Revenue received").
- So copy its approach where it has one (chips on their own wrapping line). Where it has none, because its tiles are never this narrow, add a phone-only fallback for the pill.

**The fix: all three changes go in `BlockKpi.tsx`.** No caller, `KpiStrip`, `KpiTile` or `StatusChip` changes.
1. **B-1 and B-3 (the chip): its own line, allowed to wrap, as `KpiTile`'s status line does.**
   - Render the value on its own line.
   - Render the chip in a block wrapper under it: `mt-1 block max-w-full [&>span]:whitespace-normal`.
   - The `[&>…]` child-selector override has a precedent in `AdminDrawer.tsx` (`[&>button]`), and `.x>span` outranks the chip's own `whitespace-nowrap`.
   - `StatusChip` stays nowrap everywhere else, so tables are unaffected.
   - The chip keeps its tone, icon and words (A-7).
2. **B-2 (the pill on phones):**
   - Below `sm`, the pill sits **in the flow**, above the label (`mb-1` / `self-start`), and the tile drops `pr-20` to `pr-4`.
   - From `sm` up it is exactly today's absolute top-right with `pr-20`. Pass `sm:absolute sm:right-2 sm:top-2 sm:mb-0` through `KpiIndicator`'s existing `className` prop, and use `pr-4 sm:pr-20` on the frame.
   - The tooltip still opens from the same relative box. QA checks that it opens and stays on screen at 375 px.
3. **B-3 (the value on phones):** `text-xl sm:text-2xl` on the value span. A 131 px phone tile cannot hold a seven-digit dollar figure at `text-2xl`. Breaking a number mid-way is never acceptable. From `sm` up the tile matches the top tile exactly.

**Not chosen:**
- **A single column on phones:** `KpiStrip` is shared with the top strip, and the user asked for the same grid.
- **Dropping nowrap in `StatusChip` itself:** it is shared, and tables rely on it.
- **Changing `KpiTile` as well:** its labels and tiles fit today. Moving Pin A and Pin B for a problem the top strip does not have is out of proportion. If a top label ever collides, apply the same phone fallback there as its own change.

**Pins**
- **The `BlockKpi` hash moves again.** Record one final before and after: `99c6969c…` (main) → new. The hash test's only edit is the constant.
- Pin A, Pin B, `KpiStrip`, `KpiTile` and `StatusChip` are unchanged.
- The contrast and layout-folder guards stay green unedited.
- The 1b render tests that look for the chip and note by test id must pass unedited.

**QA re-measures** at 375, 768, 1024, 1280 and 1440, using the same probes. The pass criteria:
- no chip or value past the tile border at any width;
- `labelOverPill` false on every block tile at 375;
- at sm and above, the pill geometry is identical to the top tile's;
- the tooltip works at 375;
- still no horizontal page scroll.

### SA-R-KPIGRID-2 resolved (Dev, 2026-10-27)

All three changes are in `app/admin/components/layout/BlockKpi.tsx` only. No caller, `KpiStrip`, `KpiTile` or `StatusChip` changed.

1. **Chip (B-1, B-3).** The value is now its own line. The chip sits under it in `<span className="mt-1 block max-w-full [&>span]:whitespace-normal">`.
2. **Pill (B-2).**
   - The frame is now `relative flex flex-col rounded-xl … p-4 pr-4 sm:pr-20`.
   - `KpiIndicator` gets `className="order-first mb-1 self-start sm:absolute sm:right-2 sm:top-2 sm:mb-0"` through its existing prop.
   - Below `sm` the pill is drawn above the label by `order-first`, so the DOM order is unchanged (the pill is still last). The tooltip is absolute, so it is unaffected by the flex column and still opens from the same relative box.
3. **Value (B-3).** The value is `text-xl sm:text-2xl`.

The header comment records the ruling.

**`BlockKpi` hash, one final ruled re-freeze.** The only test edit is the constant:
- before (main): `99c6969c1c394f247177a882555aba230c92cad8208edf9a498e3c73bc24fad4`
- after: `d25574961e3c6024f6e360f006642c3e9f4ff9ab68fb8037f46731c18f71dfe0`

This supersedes G-1's interim `305cd691…`. The hash fixture has no chip, so it covers the frame, the value and the pill.

**Results.**
- The admin suites (finance, ai-cost, business-os-llm, components/layout, `app/admin/__tests__`, `--maxWorkers=4`) passed 94/94 suites and 3,559/3,559 tests. These were all unedited: Pin A, Pin B (`financeTiles.pin`), the contrast guard, the layout-folder guard and the 1b render tests (`clientPaymentsUsd`, the `BlockKpi` note cases).
  - An earlier run of the same command, made alongside tsc, reported only 78 suites (3,134 tests), all passing. `--listTests` lists 94, and a run on its own covered all 94. I did not find why the first run was short.
- Full `tsc --noEmit`: 1,849 errors already on main, 0 in touched files. ESLint on `BlockKpi.tsx`: clean.

### QA re-test — SA-R-KPIGRID-2, 2026-10-27

**Verdict: PASS.** All SA pass criteria are met, with one 1 px deviation on "pill geometry identical" (D-1). It is the same on main and was not introduced here; SA to accept or fix.

**Method:** the same as the first QA pass.
- Jest rendered the real DOM; Tailwind CSS was built for it (the `[&>span]:whitespace-normal` rule is confirmed in the output); it sat in the admin-shell replica and was loaded in headless Chrome inside exact-width iframes.
- Widths: 375, 768, 1024, 1280 and 1440 as asked, plus 414, 600 and 640 (the `sm` edge).
- Cases:
  - Takings with 1 tile; 2 tiles with "≈ $1,234,567" and the stale chip; 2 tiles partial ("At least ≈ $1,234,567" + stale).
  - Credits with far-over 1, with large counts (12,345 / "1,234 at or over 150% of allowance") and with huge counts (1,234,567 / 123,456).
  - Leak.
  - Four G-1-vs-new pairs: plain, note, chip, chip + note.
- Control: an exact rebuild of the G-1 `BlockKpi` (main's file with the frame swapped) still shows the old faults: label under the pill at 375 px, chip past the border at 375 / 414 / 768 / 1024 / 1280 / 1440. So the probe still detects them.

| Criterion | Result | Evidence |
|---|---|---|
| No chip or value past a tile border, any width | ✅ Pass | 0 of all real and pair tiles at all 8 widths (box and text-ink checks). Chips wrap inside the tile: at 375 px "123,456 at or over 150% of allowance" takes 3 lines in a 131 px tile. No chip overflows internally |
| No label under the pill at 375 | ✅ Pass | `labelOverPill` false on every block tile at every width. At 375 the pill is in the flow at y = 17 and the label starts at y = 43. No value, chip or note under the pill either |
| From `sm` up, pill where the top KpiTile's is | ✅ with D-1 | Absolute top-right at every width ≥ 640, and the label starts at y = 17 as on the top tile. Measured from the tile's border edge: block pill 9 / 9 px, top tile 8 / 8 px. See D-1 |
| Tooltip works at 375 | ✅ Pass | Opened on every block tile using the component's own clamp rule (`tooltipClampFor`): every tooltip is inside the viewport and below its tile. The right-column USD tile clamps (l 94, r 318), the left tiles don't (l 42, r 266) |
| No horizontal page scroll | ✅ Pass | Document `scrollWidth` = viewport and `main` `scrollWidth` = `clientWidth` at all 8 widths |
| flex-col change: label / value / note from `sm` up | ✅ Pass | New vs G-1 at 640 / 768 / 1280 / 1440: label and value positions and sizes identical (24 px value), and the note identical when there's no chip. With a chip, only the chip line and below differ, because the chip is now a wrapping block (the SA's intent). With chip + note at 640 / 768 the chip and note sit 2 to 3 px higher (`mt-1` block vs the old `gap-2` flex row). Below `sm`: value 20 px, pill above the label |
| Reading and tab order unchanged | ✅ Pass | Jest, G-1 vs new, 4 variants: identical text order, `data-testid` order, focusable list (one button, same name), group name and tooltip text. The pill is still last in the DOM; `order-first` is visual only. With one focusable per tile, the visual vs DOM order difference below `sm` cannot misorder focus |
| BlockKpi hash: only the constant | ✅ Pass | `BlockKpi.render.test.tsx` numstat 1 / 1, `99c6969c…` → `d2557496…` |
| Pin A, Pin B, guards, admin suites | ✅ Pass | No diff in `KpiStrip.callers.pin` (Pin A) or `financeTiles.pin` (Pin B). Admin suites (finance, ai-cost, business-os-llm, components/layout, `app/admin/__tests__`, `--maxWorkers=4`): 94 / 94 suites, 3,559 / 3,559 tests. Scoped tsc (9 touched files, 8 GB, no OOM): only the canary in `BlockKpi.tsx`; restored, `cmp` clean |

**D-1 (Low; pre-existing, not introduced here; SA to accept or fix).** From `sm` up the block pill sits 1 px further in, on both axes, than the top tile's.
- Both use `right-2 top-2`, but they are anchored differently:
  - KpiTile's pill is anchored to the borderless `-box` wrapper, so it measures 8 px from the visible border.
  - BlockKpi's pill is anchored to the bordered frame's padding box, so it measures 9 px.
- Main's and G-1's `BlockKpi` measure 9 / 9 too.
- If SA wants it exact, `sm:right-[7px] sm:top-[7px]` would align it. That is a further hash move.

**Observation (no action):** where a long word is wider than the `sm:pr-20` content box, it extends into the right padding, still inside the border and below the pill. Example: "$1,234,567" in a 179 px tile at 1280 px.

**Probes:** all deleted; none kept:
- `app/admin/finance/__tests__/zz_kpigrid2_dump.render.test.tsx` (the DOM dump plus the reading/tab-order checks)
- `app/admin/finance/components/zz_G1BlockKpi.tsx` (the G-1 baseline)

The canary was restored, with `cmp`. No source changed, no commit, no stash. Screenshots and measurement JSON are in the scratchpad (`qa_kpigrid2/r375.png`, `r1280.png`, `m*.json`).

**Final Status (re-test):**
- [x] All SA-R-KPIGRID-2 criteria pass — ready for the user's diff view / commit, subject to SA accepting D-1 (1 px, pre-existing)

## Commit Info

---

## Change History

| Date | Change | Details |
|---|---|---|
| 2026-10-27 | Created | Dev: callers, design, pins, SA questions |
| 2026-10-27 | SA code review (SA-CR-KPIGRID) | Approved. SA-Q-1: reuse `KpiStrip`, no new export. SA-Q-2: match the top tile frame (`rounded-xl p-4`, keep `pr-20`), with a ruled `BlockKpi` hash re-freeze (G-1). SA-Q-3: QA checks 375 px. The overlap with the follow-ups bundle is accepted |
| 2026-10-27 | SA ruling on QA B-1 to B-3 (SA-R-KPIGRID-2) | Fix in `BlockKpi` only: the chip on its own wrapping line (KpiTile pattern, `[&>span]:whitespace-normal`); below sm the pill moves into the flow and the frame uses `pr-4`; the value is `text-xl` below sm. `BlockKpi` hash re-frozen once more (final before and after). KpiTile, KpiStrip, StatusChip, Pins A and B unchanged. QA re-measures |
