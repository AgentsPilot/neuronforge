# Workplan: AI Model Price Review, page layout (retired filter, KPIs, help drawer)

> **Last Updated**: 2026-10-16

**Developer:** Dev
**Requirement:** [AI_MODEL_PRICE_REVIEW_REQUIREMENT.md](/docs/requirements/AI_MODEL_PRICE_REVIEW_REQUIREMENT.md) §8a UF-7 (user feedback 2026-10-16)
**Branch:** `feature/ai-model-price-review-page-layout` (worktree `neuronforge-model-pricing-s3`, off origin/main `067c4a3e`)
**Date:** 2026-10-16
**Status:** COMPLETE. MERGED 2026-10-16 (PR #431, commit 5aaba308, merge bc067640); user browser check (§8 / QA replacement list) owed

## Overview

A UI-only slice on `/admin/system-config` (Model pricing). No route, repository, migration or charging change; `chargingUntouched.guard` unedited.

## 1. User requests (2026-10-16)

1. **Show retired** toggle, OFF by default: retired rows are hidden unless the admin turns it on. **Superseded rows (stored, never charged) follow the same toggle.** "Starts later" rows are charged later, so they always show.
2. **KPIs at the top**: Undercharging, Pending prices, Last provider check, Models in use.
3. **Help drawer**: the always-open "About Model Pricing" box moves behind a **?** button that opens a side drawer; the text explains the flow and the buttons in plain words.

## 2. Design

- **Shared parts, no shared edit:** `KpiStrip` / `KpiTile` (no-target tiles, `role="group"`), `AdminDrawer` + `DrawerSection` (Radix focus trap, Esc, overlay, X; focus goes back to the **?** button). No admin page has a "?" help drawer yet, so the shared row drawer is reused as is; no new component.
- **Not joining the migrated-pages registry.** The registry demands `AdminPageHeader` (no own `<h1>`) and no `.json(`; the source guard pins this page's own `<h1>` (G-8) and the Sync handler's `.json()` byte for byte. That move stays with L-11 / slice 6.
- **KPI figures** are pure functions in a new `priceKpis.ts`, from the comparison the page already reads and the fetch status `ProviderPriceCheck` already reads. **No new query or request**: `ProviderPriceCheck` gains an optional `onStatus` prop and hands the page the status it loaded (the page still names no model-pricing URL).
- **"Now"** for the 90-day rule is the comparison's server `generatedAt`, as slice 4 does for "today".
- **Toggle:** a button with `aria-pressed`, "Show retired", plus a muted line when any are hidden: "1 retired or superseded row hidden." or "N retired or superseded rows hidden."
- **No price arithmetic in the browser:** gaps come from `gapBasisPoints` and print through `unitGapText`; no `Number(` / `parseFloat(` / `parseInt(` / `toFixed(` in new code.

## 3. KPI definitions

| Tile | Value | Sub-line | Status (never colour alone) |
|---|---|---|---|
| Undercharging | count of compared rows with colour `red` | `worst -12.00% (gpt-4o input)`: the undercharging unit with the lowest `gapBasisPoints`; if every red row is "Not priced": `N not priced` | `red` ("Needs action" + icon) when count > 0, else neutral |
| Pending prices | distinct pending `lineId`s across rows | `awaiting Apply` | neutral |
| Last provider check | `formatUtc(openai.lastOkAt)` | `N days ago`; "never checked" when null | `red` when older than 90 days or never; "Unavailable" + `amber` when the status read failed; "Reading…" until it loads |
| Models in use | rows with at least one switched-on area tag (`areas.some((tag) => tag.enabled)`; an "(off)"-only row is not in use, SA F-1) | `of N compared` | neutral |

The shared tile keeps its value text white and turns the card border and status row red (K-4): "red value" is met through the tile status, words and icon included. Changing the value colour would edit the shared folder.

## 4. Guard impact (`source.guard.test.ts` reads `page.tsx` text)

| Pin | Effect | Action |
|---|---|---|
| S-1 helper text, S-2/S-3 labels, S-9 handler, S-10 button | Untouched, byte-identical | none |
| S-4 Sync paragraph (with `<strong className="text-green-300">`) | Kept verbatim inside the drawer in `page.tsx` | none |
| MT-1 banned words (`immediately`, `per 1,000`, …), G-2 `boost` | New help text avoids them ("right away") | none |
| MT-2 `in effect on all servers within 1 hour` | Kept verbatim inside the drawer | none |
| W2-4 counts, G-1, G-3, G-7, G-8 | Unchanged | none |

**No `source.guard.test.ts` assertion changes.** One wiring pin in `priceReview.source.test.ts` (slice 5: `<ProviderPriceCheck onFinished={() => { void fetchData(true); }} />`, whitespace-normalised) must gain `onStatus={setCheckStatus}`; edited with a one-line comment, intent kept (rendered once; a stored check re-reads silently). **SA to confirm.**

## 5. Files

| File | Action |
|---|---|
| `app/admin/system-config/page.tsx` | modify: KPI strip, toggle, ? button + drawer; info box removed |
| `app/admin/system-config/priceKpis.ts` | create: pure KPI figures |
| `app/admin/system-config/priceReviewCopy.ts` | modify: KPI, toggle and help words |
| `app/admin/system-config/components/ProviderPriceCheck.tsx` | modify: optional `onStatus` |
| `app/admin/system-config/__tests__/pageLayout.render.test.tsx` | create |
| `app/admin/system-config/__tests__/priceKpis.test.ts` | create |
| `app/admin/system-config/__tests__/priceReview.source.test.ts` | modify: the one pin above |
| existing page suites | modify where they pin retired / superseded rows (listed in §7) |

## 6. Tests

- `pageLayout.render`: toggle hidden by default, shown when on, `aria-pressed`; each KPI (red count and worst text, neutral 0; pending count; last check fresh, older than 90 days red with a pinned `generatedAt`, never checked, unavailable; models in use); drawer opens from ?, has the pinned sentences, Esc closes it and focus returns. `ProviderPriceCheck` mocked with a stand-in that calls `onStatus`.
- `priceKpis`: the pure figures, including the exact 90-day boundary.
- `fireEvent` only; every case under about 1.5 s.

## 7. Task list

- [x] T-1 Workplan
- [x] T-2 `priceKpis.ts` + copy
- [x] T-3 `ProviderPriceCheck` `onStatus`
- [x] T-4 Page: KPIs, toggle, drawer
- [x] T-5 Tests; existing pins adjusted (see Implementation notes)
- [x] T-6 Requirement note + slice 5 Commit Info

### Implementation notes

- **Existing tests edited (one-line comment each, intent kept):** `pages.render` R-12 and `priceTable.render` T-11, T-12 click "Show retired" first; `priceReview.source` slice 5 wiring pin gains `onStatus={setCheckStatus}`. No `source.guard` or `chargingUntouched.guard` edit.
- **Header order:** Refresh stays the first header button (`pages.edge.qa` E-3 finds it by position); **?** sits after it.
- **D-1:** the Undercharging value numeral stays white; the tile's red border and "Needs action" row carry the red (shared `KpiTile`, K-4). Colouring the numeral would edit the shared folder. **SA: accepted.**
- **D-2:** Models in use first counted any area tag, "(off)" included. **Ruled by SA (F-1): switched-on tags only**; fixed, `modelsInUseKpi` counts `row.areas.some((tag) => tag.enabled)`.
- **D-3:** two apostrophes in moved help text became `&apos;` for eslint (`react/no-unescaped-entities`); neither is in a pinned sentence. **SA: accepted.**
- **D-4:** the page does not join the migrated-pages registry (it would need `AdminPageHeader` and the removal of the pinned `<h1>` (G-8) and the Sync `.json()`). **SA: accepted**; slice 6 / L-11 work. The page is a consumer of `KpiStrip` and `AdminDrawer` only.
- **D-5:** the shared row drawer `AdminDrawer` is reused as the help drawer, with static children and no new prop. **SA: accepted**; a dedicated help-drawer component waits for a second page (CLAUDE.md rule 7).
- **D-6:** superseded rows follow the "Show retired" toggle; "Starts later" rows always show. **SA: accepted** (never charged, today or later; the hidden line names them).
- **D-7:** Refresh stays the first header button, ? after it (`pages.edge.qa` E-3 finds Refresh by position). **SA: accepted.**
- New suites: `priceKpis.test` (K-1..K-12), `pageLayout.render` (L-1a..L-1c, L-2..L-10).

### SA / QA fix pass (2026-10-16)

- **F-1:** Models in use counts switched-on tags only (doc comment, §3, D-2, requirement UF-7). K-6 adds an "(off)"-only row (not counted) and a mixed off-and-on row (counted); L-4's fixture adds an "(off)"-only row.
- **F-2:** D-4..D-7 recorded above with SA's rulings.
- **Hidden line pluralised** (L-1c pins the singular); the count prints through `formatCount` (SA suggestion). `HIDDEN_UNLESS_RETIRED_SHOWN` typed by the row kind (SA suggestion).
- **Help text:** Sync and Edit "will be removed in a later update, when Apply arrives" (was "in the next release").
- **Page-level worst gap:** the `pageLayout` red fixture has three red units (-5.00%, -12.00%, -5.00%) on two rows, the worst neither first nor last.
- **QA timing:**
  - **L-1** split into L-1a (default hidden), L-1b (on, then off) and L-1c (singular). The toggle is found by test id, rows are read inside the table, and L-10 finds the ? button and drawer by test id, checking their names with `toHaveAccessibleName`. A scratch profile measured `getByRole('button', { name })` at about 0.5 s a call on this page (it computes the name of every button), so role queries were the cost. R-12, T-11 and T-12 also find the toggle by test id.
  - **R-9:** nothing is re-read before the success message. It shows after the PUT answers and one batched full-page render. Under parallel load that render alone has passed the 1 s default, so that one `findByText` has `{ timeout: 3000 }`. No other wait was widened.
  - **T-15:** a save re-renders the whole page about six times (saving, the PUT answer, re-reading on, the re-read answer, saving off), and the case used the full ten-row fixture for every render. Now it uses only the row being saved. One `waitFor` on `aria-busy` replaces a no-op `findByText` plus a `setTimeout(0)`. The Jest timeout is unchanged.
  - **R-5, R-10, E-3** (Sync button) also stopped using the page-wide role query: R-5 hit the 5 s limit once in this pass.
  - **Open:** three parallel runs still go over 3.5 s, and E-1 failed once at 5 s. The cases over the limit are the first case of each suite (T-1, E-1; the cold start) and the save flows of unedited suites (E-1, E-2, R-9). L-1a reached 3.9 s once as the first case of its suite. The fix that remains is a test-wide change (for example a framer-motion stand-in in the page suites, which is a new pattern, or splitting E-1). TL/SA to decide.

## 8. Manual check (user, after deploy)

1. Open `/admin/system-config`: four tiles above the table; no green "About Model Pricing" box.
2. Undercharging reads the red-row count and the worst gap; 0 is a plain tile.
3. Last provider check shows the last successful check, red with "Needs action" if older than 90 days or never run.
4. Retired and superseded rows are hidden; "Show retired" shows them, pressing again hides them.
5. **?** opens the help drawer; Esc closes it and focus returns to **?**.

## SA Review Notes

**Code Review by SA — 2026-10-16** (UI short path)
**Status:** 🔄 Fix Required (one item, F-1; small). Approved with conditions: fix F-1 and F-2, then QA proceeds. No re-review by SA is needed if F-1 is exactly as written below.

### Code Review Comments

1. **F-1 `priceKpis.ts` `modelsInUseKpi` — D-2 ruled: count switched-on areas only** — Priority: High (the user's words were "actively being used by the system"; a model whose every call is switched off is not in use). Fix: `rows.filter((row) => row.areas.some((tag) => tag.enabled)).length`. "On" comes from `AreaTag.enabled`, which the comparison already carries (`areaTags.ts`: false when every call of that area is switched off; the embeddings tag is always `true`). This is the same flag behind the "(off)" chip in `PriceRowCells.tsx`. No new query, request or field. Then: update the doc comment on the function; update §3 (Models in use: "rows with at least one switched-on area tag"), D-2 in the Implementation notes (ruled by SA/TL), and the UF-7 row in the requirement ("rows with a switched-on Business OS area tag"). Tests: K-6 gains a row whose only tag is `enabled: false` (not counted) and one with a mixed off and on pair (counted); L-4 gains an "(off)"-only row so the page figure is pinned as well.
2. **F-2 workplan — deviations list** — Priority: Low. The TL brief lists seven deviations but §7 records D-1..D-3. Record the others as D-4..D-7 (registry not joined, row drawer reused as the help drawer, superseded rows follow the toggle, Refresh stays first with ? after it) with their SA rulings below, so the record matches the brief.
3. **Guard pin edit, `priceReview.source.test.ts`, slice 5 wiring pin** — ✅ Approved as edited. The intent (one `<ProviderPriceCheck>`, a stored check re-reads silently via `fetchData(true)`) is unchanged, the `match(...).toHaveLength(1)` pin still stands, and the comment cites the slice. `source.guard.test.ts` is byte-identical to HEAD (verified with `git diff --quiet`). S-4 (the Sync paragraph with `<strong className="text-green-300">`) and MT-2 ("in effect on all servers within 1 hour") are present verbatim in `PricingHelp` in `page.tsx`, and S-4, MT-1, MT-2, G-2 and G-8 all pass.
4. **Correctness, verified:**
   - **90-day rule:** `isStale = ageMs > 90 * DAY_MS`. Exactly 90 days is fresh; 1 ms more is red (K-9 pins both sides). "Older than 3 months" read as strictly older than 90 days is the right reading. A future `lastOkAt` (clock skew) clamps to "today" and is fresh. An unparseable timestamp is red with "age unknown": it fails safe. Accepted.
   - **"Now" from `generatedAt`:** `lastCheckKpi(status, comparison.generatedAt)`. The browser clock is never read (K-10). Accepted.
   - **No `Number(` on prices:** none in the new code. Gaps come from `gapBasisPoints` through `unitGapText`. The only arithmetic is `Date.parse` on timestamps and `Number.isFinite` on the age, which is allowed. K-11 pins this. The `toFixed` / `parseFloat` in the legacy Edit inputs of `page.tsx` predate this slice and were not touched.
   - **Accessibility:** the toggle is a `type="button"` with `aria-pressed`; its name stays "Show retired" in both states (correct pattern), and the on state also adds a Check icon, not only a ring. The ? button has `aria-label` and `aria-haspopup="dialog"`. The drawer is the shared Radix `AdminDrawer`, which provides the focus trap, Esc, overlay and X; focus returns through `onReturnFocus` (L-10). Red and amber tiles carry "Needs action" / "Needs a look" plus an icon (K-4), so colour is never the only signal.
   - **No `console.*`** in any touched file. ESLint is clean on all six touched files.
   - **`onStatus` held in a ref:** `onStatusRef.current = onStatus` on every render; `loadStatus` keeps `[]` deps, so the mount read never re-runs. It reports both the success and the failure (`null`). Accepted.
5. **Scope confirmed:** no file under `lib/`, `app/api/` or `supabase/` changed; no repository and no migration. `chargingUntouched.guard.test.ts` and `source.guard.test.ts` are unedited. The only `ProviderPriceCheck` change is the optional prop. The slice 5 workplan diff is a doc-only Commit Info fill (PR #404 record), which is fine to carry here.

### Rulings on the deviations

- **D-1 (Undercharging numeral stays white; red is carried by the tile border plus "Needs action" and an icon):** Accepted. The user's "RED" is met by the shared tile's red status. Recolouring the numeral would edit the shared layout folder for one page, which is not justified.
- **D-2 (Models in use):** Ruled against the current code. See F-1.
- **D-3 (not joining the migrated-pages registry because of G-8 and the Sync `.json()` pin):** Accepted. Joining it means `AdminPageHeader` plus removing the pinned `<h1>` and `.json(`, which is slice 6 / L-11 work. The page uses `KpiStrip` and `AdminDrawer` as a consumer only; nothing in `layoutFolder.guard` requires a consumer to be registered.
- **D-4 (row drawer reused as the help drawer):** Accepted. `AdminDrawer` takes static children without a new prop. A dedicated help-drawer component waits for a second page that needs one (CLAUDE.md rule 7: no new pattern for a single use).
- **Superseded rows follow the toggle:** Accepted. They are never charged, today or later, and the hidden line names them ("retired or superseded rows hidden."). "Starts later" rows always showing is correct.
- **Refresh stays the first header button, with ? after it (E-3 by position):** Accepted.
- **`&apos;` in the moved help text:** Accepted. No pinned sentence is affected; S-4 and MT-2 pass.

### Test durations — ruling

Accepted. No timeout is raised and no suite is split. SA measured: run in band, L-1 took 1350 ms and T-1 2182 ms (T-1 is the first case of `priceTable.render`, so its time is suite warm-up, as at slice 5: 2.1 s). In a parallel `app/admin/system-config` run the slowest case was 2842 ms (E-2, an unedited suite). In a heavier parallel run with the layout folder added, E-1 reached 4180 ms. That is load on an 8-core machine, not this slice, but it is the closest any case has come to 5 s. The slice adds one extra page re-render (the `onStatus` state update), which costs little. Condition for QA: record three parallel `app/admin/system-config` runs. If any case of this slice's suites (`pageLayout.render`, `priceKpis`) or any edited case (R-12, T-11, T-12) exceeds 3.5 s, split L-1 into two cases (hidden by default; toggled on and off). The cause of the earlier 5 s flakes (`userEvent.click`) is not reintroduced: the new suites use `fireEvent` only.

### Optimisation Suggestions

- `HIDDEN_UNLESS_RETIRED_SHOWN` could be typed `ReadonlySet<PriceTableRow<ModelPricing>['kind']>`, so a renamed kind fails to compile.
- The hidden line prints `${hiddenCount}` raw. `formatCount(hiddenCount)` would match the KPI tiles.
- When every row is hidden, the table shows `NO_MODELS_LINE` above "N retired or superseded rows hidden." The second line makes this clear enough; no change is required.
- Help text "will be removed in the next release": consider "will be removed when Apply arrives", so the words stay true if a different release ships first. This is wording only, so the user decides.
- `unitName` in `priceKpis.ts` duplicates the private `unitLabel` in `coverageColour.ts`. Fine for now.
- Full `tsc --noEmit` did not finish within 10 minutes on this machine (exit 124). QA should run it with `--max-old-space-size=8192` and confirm 0 errors in the touched files. Jest (29 suites, 816 tests across system-config and the layout folder) and ESLint are green.

### Code Approved for QA: Yes, after F-1 (and F-2, doc only)

## QA Testing Report

**QA — 2026-10-16**
**Test mode:** full (UI short path)
**Strategy used:** A (Jest unit + jsdom render) plus mutation testing on scratchpad copies, static source checks, and a review of the manual check. No browser run: no dev server in this pass, so the manual check (D) is left to the user.
**Focus:** ui, performance (test timing)
**Skipped:** live browser check (no dev server allowed in this pass; the user runs §8)
**Input source:** TL prompt

### Test Coverage

| Acceptance criterion (§1, §3) | Tested? | Result | Notes |
|---|---|---|---|
| Show retired off by default; retired and superseded rows hidden; Starts later always shown | ✅ | Pass | L-1; mutations M01 and M02 caught |
| Toggle is a button with `aria-pressed`; "N … hidden." line | ✅ | Pass | L-1 |
| Undercharging = red-row count; worst unit text; neutral at 0; "N not priced" | ✅ | Pass | K-1..K-4, L-2, L-3; M06 and M07 caught |
| Pending prices = distinct pending `lineId`s | ✅ | Pass | K-5, L-4; M08a and M08b caught. Superseded proposal lines never reach the browser: the repository reads `.eq('state', 'pending')`, pinned in `AiPriceProposalRepository.test.ts:119` |
| Last provider check: Reading / Unavailable (amber) / Never (red) / fresh / >90 days (red) | ✅ | Pass | K-7..K-10, L-5..L-8b. Boundary per §3 is strictly "older than 90 days" (`>`); K-9 pins both sides to the millisecond. M03a and M03b caught |
| "Now" = server `generatedAt`, never the browser clock | ✅ | Pass | K-10, L-5, L-6; M05 caught |
| Models in use = rows with `areas.length > 0`, "of N compared" | ✅ | Pass | K-6, L-4; M09 caught |
| No KPI strip when the table read fails | ✅ | Pass | L-9 |
| ? button opens the drawer; Esc closes it; focus returns; info box gone | ✅ | Pass | L-10; M10 and M11 caught |
| Red never colour-only ("Needs action" words + icon) | ✅ | Pass | L-2, L-6, L-7; M12 caught |
| No new request; no charging, route or migration change | ✅ | Pass | Static checks below |
| Desktop browser walkthrough | ⚠️ | Not run | §8, by the user |

### Step 1: test runs (counts verbatim)

`npx jest app/admin/system-config --ci --verbose`, three runs in parallel:

| Run | Suites | Tests | Time | Slowest 5 |
|---|---|---|---|---|
| 1 | 1 failed, 10 passed, 11 total | **1 failed**, 150 passed, 151 total | 104.9 s | E-1 500 on save 4349 ms; T-1 4345 ms; **L-1 3567 ms**; R-9 3399 ms (FAILED); E-1 200/false 3354 ms |
| 2 | 11 passed, 11 total | 151 passed, 151 total | 100.6 s | **L-1 5102 ms**; E-1 500 on save 5013 ms; R-9 4317 ms; T-1 4142 ms; E-3 3927 ms |
| 3 | 11 passed, 11 total | 151 passed, 151 total | 102.4 s | E-1 500 on save 4630 ms; E-1 200/false 4207 ms; T-1 4198 ms; E-3 3470 ms; R-5 3130 ms |
| extra, alone | 1 failed, 10 passed | **1 failed**, 150 passed, 151 total | 110.2 s | **T-15 5322 ms (FAILED, 5 s timeout)**; T-1 4947 ms; E-3 4213 ms; E-1 4087 ms; **L-1 2894 ms** |

- Run 1 failure: `pages.render` R-9, `findByText('Pricing updated successfully!')` ran out of its 1 s wait (test took 3399 ms). Passed in runs 2 and 3.
- Extra-run failure: `priceTable.render` T-15, "Exceeded timeout of 5000 ms" (2132 ms in run 1).
- Both are older tests, and no assertion in them changed. I timed `pages.render`, `priceTable.render` and `pages.edge.qa` against the HEAD `page.tsx` and against the new one, one run each, same conditions. Passing tests showed no consistent slowdown, for example R-9 1039 to 995 ms and T-15 968 to 1017 ms. Some went up (T-1b 804 to 1710 ms) and some went down (E-2 1425 to 1077 ms), which is within noise. Conclusion: these suites are load-sensitive whatever this slice does. This slice does not cause it.
- Other suites: `npx jest lib/ai/pricing-research --ci` gave 13 suites passed, **277 passed**, 277 total. `npm run test:bos-entitlements` gave 278 suites passed, **8240 passed**, 8240 total, exit 0, with a "worker failed to exit gracefully" warning only. The Tailwind guard `app/__tests__/tailwind-css-escape.guard.test.ts` gave **6 passed**, 6 total.
- `npx eslint` on the 6 new or changed source and test files: exit 0.

### Step 2: mutation checks (scratchpad copies, mapped in by a scratch Jest config; repo untouched)

Controls (no-op copies of `page.tsx` and `priceKpis.ts`): 23/23 pass. **13 of 13 mutations caught.**

| # | Mutation | Caught by |
|---|---|---|
| M01 | toggle defaults to on | L-1, R-12, T-11, T-12 |
| M02 | superseded rows shown while off | L-1 |
| M03a | 90 to 91 days | K-9, L-6 |
| M03b | `>` to `>=` | K-9 |
| M04 | "Never checked" not red | K-7, L-7 |
| M05 | `Date.now()` instead of `generatedAt` | K-8, K-9, K-10, L-5, L-6 |
| M06 | undercharging counts green rows | K-1, K-2, L-2, L-3 |
| M07 | worst gap picks the smallest gap | K-2 only (the render fixture has one red unit) |
| M08a | pending counts views, not distinct lines | K-5 |
| M08b | page adds superseded table rows to pending | L-3, L-4 |
| M09 | models in use counts rows with no area | K-6, L-3, L-4 |
| M10 | drawer stays open on Esc (`onClose` no-op) | L-10 |
| M11 | ? button loses `aria-label` | L-10 |
| M12 | shared tile drops "Needs action" (colour only) | L-2, L-6, L-7 |

### Step 3: static checks

| Check | Result |
|---|---|
| `console.*` in new or changed code | 0. The only hit is the `'console.'` string literal inside K-11 |
| `Number(` / `parseFloat(` / `parseInt(` / `toFixed(` in `priceKpis.ts` and added lines | 0 |
| Backslash followed by a hex digit in added lines and new files (code and docs) | 0 |
| `source.guard.test.ts` | unchanged vs HEAD |
| `chargingUntouched.guard.test.ts` | unchanged vs HEAD |
| `lib/`, `app/api/`, `supabase/` (charging, routes, migrations) | 0 changed or untracked files |

### Issues Found

#### Bugs (must fix before commit)
1. **New case L-1 is 2.9 to 5.1 s, against §6's "every case under about 1.5 s"**. File: `app/admin/system-config/__tests__/pageLayout.render.test.tsx`. Severity: Medium (test only, product unaffected).
   - Steps to reproduce: run the folder three times in parallel.
   - Expected: under about 1.5 s.
   - Actual: 3567 / 5102 / 2894 ms. Run 2 finished 102 ms past the 5 s Jest timeout and still passed only because the work was synchronous. That is the same 5 s flake this page has had before.
   - Suggestion for Dev: split it into L-1a (default hidden, count line, Starts later shown) and L-1b (on, then off again). Or reach the toggle with `getByTestId('show-retired-toggle')` once and keep its role/name check in a cheaper case.

#### Performance Issues (should fix)
1. **Pre-existing, load-sensitive timeouts:** R-9 (`findByText` at the 1 s default) and T-15 (5 s test timeout) each failed once in 4 runs. Not caused by this slice (see Step 1), but they will hit CI under load. Fix in a follow-up: an explicit `{ timeout }` on the R-9 `findByText`, and a per-test timeout or fewer re-renders in T-15.

#### Edge Cases (nice to fix)
1. With exactly one hidden row the line reads "1 retired or superseded rows hidden." (plural). Low.
2. M07 is caught only by the unit test. A second red unit in the `pageLayout` `RED_ROWS` fixture would also pin it at page level. Low.
3. When red rows mix "Not priced" and undercharging units, the sub-line shows only the worst gap. The not-priced count is not shown. This matches §3 as written, so it is noted, not a bug.

### Manual check: proposed replacement for §8 (desktop viewport)

1. Open `/admin/system-config`. Four tiles in this order: Undercharging, Pending prices, Last provider check, Models in use. No green "About Model Pricing" box. Collapse the pricing section: the tiles stay.
2. **Undercharging:** the number equals the number of red "Undercharging" rows in the table. Its sub-line names the most negative gap shown in any red row. When it is above 0 the tile has a red border and the words "Needs action". At 0 it is a plain tile reading "no model is undercharged".
3. **Pending prices:** the number equals the pending prices shown in the table, with an image model counted once per line. Sub-line "awaiting Apply".
4. **Last provider check:** the time matches the last successful check shown in the Check provider prices panel. The sub-line gives the age ("today" / "N days ago"). Red plus "Needs action" appears only if that check is older than 90 days or has never run. Do not try to force the red state on prod.
5. **Models in use:** the number equals the rows with a "Used by" chip, "(off)" chips included. Sub-line "of N compared".
6. **Show retired:** on load it is off and retired and superseded rows are absent. The line "N retired or superseded rows hidden." gives the count. "Starts …" rows show either way. Click it: the button shows a tick and a ring, the rows appear and the line goes. Click again: back to hidden.
7. **? button:** open it with the mouse, then again from the keyboard (Tab to ?, press Enter). The drawer titled "About model pricing" contains the Sync paragraph and "within 1 hour". Close it three ways: Esc, the X, a click outside. After Esc, the focus ring is back on **?**.
8. Nothing else changed: Refresh, Sync, Edit and Enter provider price behave as before.

### Final Status
- [ ] All acceptance criteria pass — ready for commit
- [x] Issues found — Dev must address before commit. Functionally every criterion passes and 13 of 13 mutations are caught. The one open item is the Medium test-timing bug on L-1. There is no High bug. TL decides whether L-1 blocks the commit or goes as a fast follow.

## Commit Info

| Item | Value |
|---|---|
| Branch | `feature/ai-model-price-review-page-layout` |
| Commit | `5aaba308` feat(pricing): Model pricing page KPIs, Show retired toggle and help drawer |
| PR | #431 |
| Merge | `bc067640` (2026-10-16) |
| Migration | None |
| Owed | User browser check after deploy (QA manual check list) |

## Change History

| Date | Change | Details |
|------|--------|---------|
| 2026-10-16 | Created; code complete | User feedback UF-7 (retired toggle, KPIs, help drawer). UI only. Uncommitted, awaiting SA + QA |
| 2026-10-16 | SA and QA fix pass | SA F-1 (Models in use counts switched-on area tags only; K-6 and L-4 extended), F-2 (D-4..D-7 recorded with rulings). QA: L-1 split into L-1a..L-1c with test-id and in-table queries; R-9 one `findByText` given 3 s (no re-read precedes it); T-15 cut to the saved row and one `waitFor`. Hidden line pluralised, the help text now says "when Apply arrives", and a second red unit pins the worst gap at page level. Uncommitted |
| 2026-10-16 | Merged; COMPLETE | PR #431 merged (commit 5aaba308, merge bc067640). No migration. User browser check owed |
