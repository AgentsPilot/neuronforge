# Workplan: Finance F-5, KPI tiles on the shared admin layout standard

**Developer:** Dev
**Requirement:** [BUSINESS_OS_FINANCE_HEALTH_REQUIREMENT.md](/docs/requirements/BUSINESS_OS_FINANCE_HEALTH_REQUIREMENT.md) §11G (the F-5 row, AC-178 to AC-183; user decisions BD-28 to BD-31 of 2026-10-15, final); [ADMIN_LAYOUT_STANDARD_REQUIREMENT.md](/docs/requirements/ADMIN_LAYOUT_STANDARD_REQUIREMENT.md) §5.4 (K-1 to K-10), §6.1 (S-1 to S-10, S-7 in particular), §6.2 C-11; [ADMIN_LAYOUT_FOLLOWUPS_REQUIREMENT.md](/docs/requirements/ADMIN_LAYOUT_FOLLOWUPS_REQUIREMENT.md), row F-2/F-4/F-5
**Branch:** `feature/finance-f5-kpi-tiles` (from main `447d17a2`; F-2 #424 and F-4 #434 included)
**Worktree:** `neuronforge-finance-health` (node_modules is a junction: no `git worktree remove`, no `git stash`)
**Date:** 2026-10-16
**Status:** Code Complete (SA approved the workplan with conditions F5-R1 to F5-R5; awaiting SA code review and QA)
**Path:** Full cycle, about 2 days. It changes the shared layout folder (`KpiTile` / `KpiStrip` / `StatusChip`), which ten other admin pages render, and it shows money tiles. No data, money, request, payload, API, `lib/` or migration change.

---

## Table of Contents

- [Scope](#scope)
- [Analysis Summary](#analysis-summary)
- [Implementation Approach](#implementation-approach)
- [Shared component API, before and after](#shared-component-api-before-and-after)
- [Step 0: the pins, written first](#step-0-the-pins-written-first)
- [Finance tile mapping (K-1 to K-5)](#finance-tile-mapping-k-1-to-k-5)
- [Clicks: anchors, the Accounts tab, and the AI cost link](#clicks-anchors-the-accounts-tab-and-the-ai-cost-link)
- [Visible changes, old and new](#visible-changes-old-and-new)
- [Files to Create / Modify](#files-to-create--modify)
- [Tests](#tests)
- [Guards](#guards)
- [AC mapping](#ac-mapping)
- [SA-W questions](#sa-w-questions)
- [Verification Plan](#verification-plan)
- [Risks](#risks)
- [Estimate](#estimate)
- [Checklist](#checklist)
- [Implementation Notes](#implementation-notes)
- [SA Review Notes](#sa-review-notes)
- [QA Testing Report](#qa-testing-report)
- [Commit Info](#commit-info)

---

## Scope

**In scope (requirement §11G, F-5 row; BD-29, BD-31):**

1. **Shared tiles** (`app/admin/components/layout/`):
   - add the K-4 statuses `green` (its colours come from `StatusChip`'s single green constant, S-7), `not_measured` and `unavailable`;
   - allow a tile with no value;
   - add an optional second line under the status row (`detail`);
   - add the cross-page tile mode (K-6, `next/link`), whose first consumer is Finance's K-1.
   - **Every existing caller renders byte-identically.** This is pinned in Step 0 before any change.
2. **Finance:**
   - `FinanceKpiStrip.tsx` is **slimmed, not deleted**: it renders the shared `KpiStrip` / `KpiTile`.
   - It no longer imports Health's `STATUS_STYLES`, and neither does any file under `app/admin/finance`, tests included.
3. **Position (BD-29):** header, then the KPI strip, then the filter bar. The strip shows on Overview, on the Accounts tab, and with a business picked, where it sits above the account header.
4. **Clicks (BD-31):**
   - each of K-2 to K-5 jumps to its own section through the existing anchor mode;
   - K-1, "Charged AI cost", opens AI cost & usage as a cross-page link that carries the window and the account.
5. **Guard registry:** the Finance C-14 entry (added in F-2) gains `FinanceKpiStrip.tsx` and `FinanceSection.tsx`. Both have no own `<h1` and no direct `.json(`.
6. **Display only.**
   - No money figure, calculation, request or payload changes.
   - The tile values and statuses are pinned per fixture in Step 0.
   - The AC-173 request pin file is untouched; its SHA-256 stays `3a1a2dd4…f6f8`.

**Kept intact:**
- the F-0 to F-4 work;
- `MIGRATED_PAGES`, apart from the two added files;
- the contrast entry for `app/admin/finance`;
- the `aiCostVocabulary` floors (`financeCopy.ts` 439, `AiCostSection.tsx` 28, `AnalyticsKpis.tsx` 33);
- K-1 to K-5's red and amber rules in `lib/business-os/finance/financeRules.ts`, which stay data: only the rendering changes;
- the finance source guards' SA-WR-34 pin on the strip file. This is why the file is kept, not deleted.

**Out of scope:**
- any change to `HealthTile` / Health's tiles, which keep their own (C-11);
- the remaining finance layout items (tables, drawers);
- `lib/`, `app/api/` and migrations (AC-182);
- the requirement MDs, which TL records.

---

## Analysis Summary

**The shared tile today** (`app/admin/components/layout/KpiStrip.tsx`, 226 lines):

| Part | Where | What |
|---|---|---|
| `KpiTileStatus` | `:36` | `'red' \| 'amber'` only (L-1b red, L-2a amber); green, not_measured and unavailable were deferred "to their first consumer" (header `:11-15`, `:29-35`, `:45-51`) |
| `TILE_STATUS_STYLES` | `:52-65` | label, icon, card border and accent, copied from Health (S-3 forbids the import) |
| `KpiStrip` | `:74-96` | the K-2 grid; `loading` shows `placeholderCount` placeholders (K-10); no test id |
| `KpiTileBase` | `:98-106` | `label`, **`value: string` (required)**, `sub`, `status`, `testId` |
| Modes | `:108-128` | anchor (`` href: `#${string}` ``), same-page filter (`filter: { href, apply, current }`), no target (`div role="group"`); **no cross-page mode** |
| Render | `:146-226` | content `:155-171` (label, value, sub, status row); name `:152` (`label, value[, status]`); `aria-describedby` = the sub's `useId` |

**The single green** (`app/admin/components/layout/StatusChip.tsx:37`):
- `OK_TONE = 'border-emerald-500/40 bg-emerald-500/15 text-emerald-300'`, used at `:45`.
- The comment at `:30-36` pre-approves reshaping it into **one** object literal (chip, card and accent) when "Healthy" arrives (SA Q-3). Two green constants are never allowed.
- The C-14 check (`layoutFolder.guard.test.ts:341-348`) pins the **file and the count, not the name** (SA Q-9). The literal-object form passes `isLiteralConstant` (`:226-231`).

**Every caller of `KpiTile` / `KpiStrip`.** Found with `grep -rln "layout/KpiStrip'" app components lib`. Health is **not** a caller: it renders its own `HealthTile`.

| # | Page | File (tile lines) | Modes and statuses used | Existing render test |
|---|---|---|---|---|
| 1 | Scheduled jobs & queues | `app/admin/components/jobs/JobsQueuesView.tsx:141-170, :394-395` (`KpiTileProps[]`, spread) | anchor `#jobs` / `#queues`, neutral and red, sub; strip `loading` + children together | `app/admin/__tests__/jobsQueues.layout.render.test.tsx` |
| 2 | AI cost & usage | `app/admin/analytics/components/AnalyticsKpis.tsx:69-137` | filter (`current`), amber/red, sub; loading 4 or 5 | `analytics/__tests__/analytics.layout.render.test.tsx` |
| 3 | Archiving | `app/admin/archiving/components/ArchivingKpis.tsx:111-137` (`KpiTileStatus` at `:63`) | anchor `#sources` / `#run-history`, red/amber, sub; loading 4 | `archiving/__tests__/page.render.test.tsx` |
| 4 | Businesses | `app/admin/users/components/BusinessesKpis.tsx:38-55` | filter, status, sub; loading 3 | `users/__tests__/businessesLayout.render.test.tsx`, `defaultFilter.render.test.tsx`, `businessOsPanel.render.test.tsx` |
| 5 | Plans & entitlements | `app/admin/business-os-tiers/components/PlansKpis.tsx:47-87` | anchor, neutral, sub; loading 4 | `business-os-tiers/__tests__/page.render.test.tsx` |
| 6 | Signup Invites | `app/admin/business-os-invites/components/InviteKpis.tsx:82-100` | no target, sub, amber; loading 5 | `business-os-invites/__tests__/page.render.test.tsx` |
| 7 | Business OS AI, Activity | `app/admin/business-os-llm/components/activity/ActivityKpis.tsx:71-116` | filter, status, sub; loading 4 | `business-os-llm/__tests__/activityLayout.render.test.tsx` |
| 8 | Business OS AI, Costs & credits | `app/admin/business-os-llm/components/costs/CostsKpis.tsx:58-120` | no target, status, sub; loading | `business-os-llm/__tests__/costsLayout.render.test.tsx` |
| 9 | Business OS AI, Settings | `app/admin/business-os-llm/components/SettingsKpis.tsx:36-85` | anchor and no target, neutral; loading | `business-os-llm/__tests__/settingsLayout.render.test.tsx` |
| 10 | Model pricing | `app/admin/system-config/page.tsx:463-…` with props from `system-config/priceKpis.ts` (`KpiTileStatus` at `:19`, `:29`) | no target, red/amber, sub | `system-config/__tests__/pageLayout.render.test.tsx` |
| — | (helper only) | `app/admin/analytics/components/AnalyticsTable.tsx:18` imports `isPlainLeftClick` | unchanged | `analytics.table.render.test.tsx` |

**Types used outside the folder:**
- `KpiTileStatus` (Archiving, Model pricing) and `KpiTileProps` (Jobs) are only *assigned to*, so widening the union is safe for them.
- `KpiTileFilter` (Analytics, Activity) is unchanged.
- The scoped `tsc` run proves all of this.

**Finance today:**
- `app/admin/finance/components/FinanceKpiStrip.tsx` (90 lines):
  - imports `STATUS_STYLES` from `@/app/admin/components/health/HealthTile` (`:16`);
  - draws its own `div` tiles (`:36-54`) with `data-testid="tile-<id>"` and `data-status`;
  - adds `tile-<id>-state` and `tile-<id>-headline` sub-test-ids;
  - lays out its own grid `sm:grid-cols-3 lg:grid-cols-5` with `data-testid="kpi-strip"` (`:69`);
  - `k5Value(k5.money)` (`:22-34`, `:87`) is the one place K-5's money is printed (pinned by `lib/business-os/finance/__tests__/finance.source.guard.test.ts:847-863`, SA-WR-34).
- `app/admin/finance/components/FinanceView.tsx`:
  - header `:162`, then the bar `:164-176`, then the content `:179-233`;
  - with a business picked, the account header and summary come next (`:186-203`);
  - the strip renders **inside the Overview body only** (`:222`), so it is not on the Accounts tab today.
- The statuses come from the payload (`FinanceTile.status: TileStatus`, `lib/business-os/finance/financeTypes.ts:414-425`). They are decided by `financeRules.ts:155-203`: red or amber from a rule, `unavailable`, `not_measured`, amber for a lower bound, `green` only for the eligible set, otherwise `neutral` with the information headline.
  - F-5 renders those statuses and decides none of them (K-5 rule (i)).
- **Sections and anchors.** `FinanceSection` (`components/FinanceSection.tsx:50-62`) renders `<section aria-labelledby="<id>-heading" data-testid="section-<id>">` with **no DOM `id`**, so the anchor mode has no target yet.
  - The ids in use are `revenue`, `takings`, `accounts`, `ai-cost`, `credits`, `payment-problems` and `accounts-economics`.
  - They are unique: the tabs use `finance-tab-*` / `finance-panel-*`.
- **The AI cost & usage link already exists:**
  - `section3AnalyticsHref(accountId | null, window)` (`app/admin/finance/financeLinks.ts:83-88`) carries the window in Analytics' own keys (`range`, plus `from` / `to` for anything but Today / This month) and `account` when one is picked;
  - Section 3 uses it (`AiCostSection.tsx:198`).

**Other guards and pins that reference the strip file:**
- the contrast guard's walk test names `FinanceKpiStrip.tsx` (`app/admin/__tests__/contrast.lf1.source.guard.test.ts:130`);
- the finance source guard's slice 4a block uses `STRIP = '…/FinanceKpiStrip.tsx'` (`:671`, `:684`, `:844`, `:855-861`).
  - That guard lives under `lib/`, so editing it would break AC-182.
  - **This is why the file is slimmed, not deleted or renamed.**

---

## Implementation Approach

The steps are ordered so that every pin exists and is green **before** the code it protects changes.

### Step 0 (first, on the unchanged `447d17a2`): the pins

Two new test files, written and run green on the unchanged tree. After that they are frozen: never edited again in this slice. Their SHA-256 is recorded in Implementation Notes at Step 0 and again at handover, and the two must be equal (the AC-173 discipline). Details in [Step 0](#step-0-the-pins-written-first).

### Step 1: `StatusChip.tsx`, one green, reshaped (S-7, SA Q-3)

`OK_TONE` (`:37`) becomes one exported object literal:

```typescript
/** THE ONLY GREEN … (unchanged comment, plus: the tile's "Healthy" card and accent come from here, S-7). */
export const OK_GREEN = {
  chip: 'border-emerald-500/40 bg-emerald-500/15 text-emerald-300',
  card: 'border-emerald-500/40',
  accent: 'text-emerald-300',
};
```

- `TONES.ok.classes` becomes `OK_GREEN.chip`. The chip's class string is byte-identical, pinned by `StatusChip.render.test.tsx`, which is unedited.
- C-14 still counts one green constant, in `StatusChip.tsx`.

### Step 2: `KpiStrip.tsx`, the API extension

The change is shown in [the next section](#shared-component-api-before-and-after). Rules for the edit:

- **The anchor, filter and no-target render branches (`:179-225`) keep their JSX and attribute order.** Only the shared `content` and `name` change, and only when the new props are used.
- `TILE_STATUS_STYLES` gains:
  - `green`: label "Healthy", icon `CheckCircle2`, card `OK_GREEN.card`, accent `OK_GREEN.accent`, imported from `./StatusChip`, which S-3 allows;
  - `not_measured`: "Not measured yet", `CircleDashed`, card `border-dashed border-slate-600`, accent `text-slate-400`;
  - `unavailable`: "Could not check", `HelpCircle`, card `border-slate-600`, accent `text-slate-400`.
  - Labels and icons equal Health's (`HealthTile.tsx:38-79`), pinned by a parity test.
  - The `bg-slate-800/60` that Health uses on the two grey statuses is **not** copied: the base keeps `bg-slate-800`, and overriding it would rely on class order (S-9). See SA-W2.
- **No second `useId`.**
  - In a React 18 client render, every extra `useId` call shifts every later id on the page.
  - The detail line's id is therefore derived from the sub's: `${subId}-detail`.
- The header comment is updated: the statuses and the cross-page mode now have their first consumer, Finance F-5.

### Step 3: `FinanceSection.tsx`, an anchor target

- Add `id={id}` to the `<section>` (`:58`). Nothing else changes: the `aria-labelledby`, the test id and the classes stay.
- This is the same markup that Jobs (`JobsQueuesView.tsx:407, :443`) and Archiving (`archiving/page.tsx:301, :320`) use for their anchor targets.

### Step 4: `FinanceKpiStrip.tsx`, slimmed onto the shared strip

- Remove the `STATUS_STYLES` import, the local `Tile` and the local grid.
- Keep `k5Value` and its one call `k5Value(k5.money)`, so the SA-WR-34 pin keeps passing unedited.
- Render a wrapper `<div data-testid="kpi-strip">` around `<KpiStrip>`, plus one `<KpiTile>` per tile, mapped as shown in [the tile mapping](#finance-tile-mapping-k-1-to-k-5).
  - The wrapper keeps the page's test id. The shared `KpiStrip` has none, and adding one would be a shared API change with no other consumer (SA-W6).
- `tileStatus(status: FinanceTile['status']): KpiTileStatus | null` maps `neutral` to `null` and passes every other status through.
  - The status type comes through `FinanceTile` (a wire type, imported type-only), so there is no new `lib/` import.
- New props:
  - `aiCostHref: `/${string}``, which K-1 uses;
  - `targetFor(section: 'credits' | 'accounts' | 'revenue')`, which returns either `{ href: `#${section}` }` or `{ filter }`.
  - The view decides between them, as described in [Clicks](#clicks-anchors-the-accounts-tab-and-the-ai-cost-link).
- A sibling export `FinanceKpiPlaceholders` renders `<KpiStrip loading placeholderCount={5} />` **with no `kpi-strip` test id**. Dozens of tests await `kpi-strip` as the "loaded" marker, and they must not resolve on placeholders.

### Step 5: `FinanceView.tsx`, the position and the targets

The new order is:
1. `AdminPageHeader`;
2. the strip;
3. `FinanceFilterBar`;
4. the content.

Inside the content come the account header and summary when a business is picked, then the tabs and the panels.

**The strip block, between the header and the bar:**
- `data && !error`: `<FinanceKpiStrip …/>`, on every tab and in the picked view;
- `loading && !data && !error`: the placeholders (K-10);
- an error: nothing (K-10: the strip is hidden and the page error shows). The hook already clears `data` on a failure.

**Other changes in the view:**
- `aiCostHref = section3AnalyticsHref(data.accountId, data.window)`. This is the helper Section 3 already uses, so the two links cannot drift.
- `targetFor` is defined in [Clicks](#clicks-anchors-the-accounts-tab-and-the-ai-cost-link).
- `hrefFor` is taken from the existing `useAdminFilters(FINANCE_FILTER_SPEC)` call, so the import line pinned by `source.guard.test.ts:88` is unchanged.
- The strip is removed from `OverviewBody` (`:222`).
- The header comment (`:16-19`, `:21-25`) is updated to the new order.

### Step 6: `financeCopy.ts`

- Update the stale comment at `:8-9`: states now use the shared tile's K-4 labels.
- Add one helper, `k1SubLine(previous: string | null)`, which returns `TILE_LABELS.k1Sub` or `` `${TILE_LABELS.k1Sub} · ${TILE_PREVIOUS} ${previous}` `` (SA-W4).
- No visible string is removed, so the 439 floor can only rise. It is re-measured with the guard's own function.

### Step 7: tests and guards, then verification

The lists are in [Tests](#tests) and [Guards](#guards).

---

## Shared component API, before and after

**File:** `app/admin/components/layout/KpiStrip.tsx`

| Prop / type | Before | After | Existing callers |
|---|---|---|---|
| `KpiTileStatus` | `'red' \| 'amber'` | `'red' \| 'amber' \| 'green' \| 'not_measured' \| 'unavailable'` (keys mirror Health `TileStatus` minus `neutral`, which stays "no status") | Widening; they only assign to it |
| `value` | `string` (required) | `string \| null` (optional). `null` / absent: no value line, and K-7 name `label[, status]` | Every caller passes a string, so the output is identical |
| `sub` | `string \| null` | unchanged | — |
| `detail` | — | **new** `string \| null`. A second line **after** the status row (`mt-1 block text-xs text-slate-300`, id `${subId}-detail`). Joins `aria-describedby` after the sub's id | Absent, so identical |
| Modes | anchor `` href: `#${string}` ``; `filter`; none | adds **cross-page** `` link: `/${string}` ``, rendered with `next/link` (`<Link href>`), same classes and attribute order as anchor mode, K-7 name | Not used, so identical |
| `KpiStrip` | `loading`, `placeholderCount`, `children` | unchanged | — |
| `isPlainLeftClick` | exported | unchanged | AnalyticsTable |

**The union after the change:**

```typescript
export type KpiTileProps = KpiTileBase &
  (
    | { href: `#${string}`; filter?: never; link?: never }      // anchor (L-1b)
    | { filter: KpiTileFilter; href?: never; link?: never }     // same-page filter (L-2a)
    | { link: `/${string}`; href?: never; filter?: never }      // cross-page (F-5, K-6)
    | { href?: never; filter?: never; link?: never }            // no target
  );
```

**Name and description:**
- name = `[label, value?, statusLabel?].filter(Boolean).join(', ')`. For a tile with a string value this equals today's template exactly.
- `aria-describedby` = `[sub && subId, detail && detailId].filter(Boolean).join(' ') || undefined`. With no detail it equals today's value.

**Status row.** The status row is unchanged. `neutral` (`status` null or absent) still shows **no status row** and the `border-slate-700` card (K-4).

---

## Step 0: the pins, written first

### Pin A: `app/admin/components/layout/__tests__/KpiStrip.callers.pin.render.test.tsx` (new, frozen)

**Normalisation:**
- `container.innerHTML`, with every React `useId` value (`/:r[0-9a-z]+:/g`) replaced by `:id:`;
- hashed with SHA-256.
- On a mismatch the test prints the case name and the normalised HTML.

**Part A1, the shared matrix.** Every prop shape the ten callers pass, found by reading each caller:
- **anchor:** neutral with and without sub; red with sub; amber with sub.
- **filter:** neutral; `current: true`; amber; red; red with `current` (the status wins).
- **no target:** neutral; amber; red; with and without sub.
- **`KpiStrip`:** with children; `loading` with 3, 4 and 5 placeholders; `loading` with children (Jobs passes both).

**Part A2, the callers themselves.** Each standalone caller component is rendered with the fixture from its own layout test, or a minimal literal of its props type. Each is rendered once in the loading state and once with figures:
- `AnalyticsKpis`;
- `ArchivingKpis`;
- `InviteKpis`;
- `ActivityKpis`;
- `CostsKpis`;
- `SettingsKpis`;
- `PlansKpis`;
- `BusinessesKpis`;
- Model pricing: the tiles from the real `priceKpis.ts` builder, rendered through `KpiTile` as `system-config/page.tsx:463-…` does.

Jobs' `kpiTiles` is module-private (`JobsQueuesView.tsx:141`). Its prop shapes (anchor, neutral or red, sub, `loading` and children) are all in A1, and its existing `jobsQueues.layout.render.test.tsx` stays unedited (SA-W5).

**Step 0 deliverable:** both parts green on `447d17a2`, with the hash constants recorded on that tree. Steps 1 and 2 must then leave every hash equal.

### Pin B: `app/admin/finance/__tests__/financeTiles.pin.render.test.tsx` (new, frozen), for AC-181

The test renders the real `FinanceView` with `fetch` served from fixed payloads. For each fixture and each tile it asserts:
- the tile `tile-<id>` exists, and its **`data-status`** equals the literal;
- the tile's **text contains** the literal value (`USD 10.00`, `At least 1`, `12.5`, `2 currencies, see Our revenue`, `Unknown`), the sub-line literal(s) and the headline literal;
- the state word, for every non-neutral status ("Needs action", "Needs a look", "Healthy", "Not measured yet", "Could not check");
- for a tile with no value, that no number appears.

**Why the selectors work on both trees:** they are only `getByTestId('tile-<id>')`, `data-status` and `toHaveTextContent(substring)`, which hold for the old `div` tiles and the new shared tiles alike. The pin therefore runs **unchanged** on both sides.

**Fixtures:**

| Fixture | Covers |
|---|---|
| F1 base | every tile with a value; K-1 green with previous; K-2 amber "At least"; K-3 red; K-4 neutral; K-5 `one` USD |
| F2 grey | K-1 `not_measured` (no previous); K-2 `unavailable`; K-5 `none` (no value, "No data yet") |
| F3 money | K-5 `several` (2); then K-5 `unknown`; K-1 inexact (amber, "At least") |
| F4 picked | `accountId` set; K-4 `0` neutral |

**Not pinned, by design:**
- the "For information" word on a neutral tile, which this slice removes (SA-W1, K-4);
- the line order and the font sizes.

Both are listed as deliberate changes and get their own new tests.

**AC-173.** `financeRequest.pin.render.test.tsx` is not opened. Its SHA-256 is checked at Step 0 and at handover: `3a1a2dd415b3d0e0ffe44488a8c410b8e67a0bedf2ca908bbf064b6708bcf6f8`.

---

## Finance tile mapping (K-1 to K-5)

`status`: payload `TileStatus` → `KpiTileStatus`.
- `red`, `amber`, `green`, `not_measured` and `unavailable` pass through unchanged.
- `neutral` becomes `null`. Only the visible row changes: `data-status` stays `"neutral"`.

The `value`, `sub` and `detail` strings are produced by the **same formatter calls as today** (`FinanceKpiStrip.tsx:70-87`), moved, not rewritten.

| Tile | `testId` | `label` | `value` | `sub` | `detail` (2nd line) | Target |
|---|---|---|---|---|---|---|
| K-1 Charged AI cost | `tile-k1_ai_cost` | `TILE_LABELS.k1` | `k1.value ? atLeast(formatUsd(v), exact) : null` | `k1SubLine(k1.previous ? atLeast(formatUsd(prev), exact) : null)` | `k1.headline` | **cross-page** `link = section3AnalyticsHref(accountId, window)` (Overview, Accounts and picked alike) |
| K-2 Accounts far over allowance | `tile-k2_far_over_allowance` | `TILE_LABELS.k2` | `k2.value ? atLeast(formatCount(v), exact) : null` | `k2Subtitle(farOverAllowancePercent)` | `k2.headline` | `#credits` (Section 4 holds "far over allowance") |
| K-3 Founding Partners with no end date | `tile-k3_founding_no_end_date` | `TILE_LABELS.k3` | `k3.value ? atLeast(formatCount(v), exact) : null` | — | `k3.headline` | `#accounts` (Accounts by plan; the Founding Partner chips) |
| K-4 Gifted credits outstanding | `tile-k4_gifted_outstanding` | `TILE_LABELS.k4` | `k4.value ? formatCredits(v) : null` (credits, never money) | `TILE_LABELS.k4Sub` | `k4.headline` | `#credits` (Section 4 "gifted") |
| K-5 Our revenue | `tile-k5_our_revenue` | `TILE_LABELS.k5` | `k5Value(k5.money)` (`formatMoney` / copy only, SA-WR-34) | `k5Caption(windowLabel)` | `k5.headline` | `#revenue` |

**Notes on the mapping:**
- "The anchor" means `{ href: '#…' }` on Overview and in the picked view, and the filter form on the Accounts tab (next section).
- **No new threshold and no client status.** The red and amber rules stay in `financeRules.ts`, as data.
- No `.money` read other than K-5's one call.
- No sum, and no money conversion.

---

## Clicks: anchors, the Accounts tab, and the AI cost link

### Overview tab, or a business picked

The sections are mounted, so K-2 to K-5 use the **existing anchor mode**, a plain `<a href="#credits">` (K-6). This is native browser behaviour, as on Jobs and Archiving, and it writes no history entry through the page.

### Accounts tab

The sections are **not mounted** (`FinanceView.tsx:205-219`), so a `#credits` anchor would do nothing. Proposed (SA-W3, option a), using the **existing filter mode**:
- `href` = `/admin/finance${hrefFor({ tab: '', ...TAB_RESET })}#credits`. This is a real link to the Overview view at the same window and business, so a modified or middle click and Copy link still work.
- `apply` = `onSelectTab('overview')` plus `setJumpTo('credits')`. This is one filter write, the same as clicking the Overview tab.
- A `useEffect` on `[jumpTo, selectedTab, data]`: once the Overview body is mounted, it calls `document.getElementById(jumpTo)?.scrollIntoView({ block: 'start' })` and clears `jumpTo`.
  - It never sets `location.hash`. The finance source guard's `URL_WRITER` forbids page-side URL writes (`source.guard.test.ts:86-92`), and the hook stays the only writer.

### K-1 → AI cost & usage (BD-31)

- **Cross-page mode**, with `link = section3AnalyticsHref(data.accountId, data.window)`. On a plain click this is client navigation through `next/link`.
- It carries:
  - **the window** in Analytics' own keys: `range=today` or `range=this_month`, else `range=custom&from&to` with the payload's resolved dates (SA-W56);
  - **the account** as `account=<id>` when one is picked.
- No name and no email travel.
- It is the same helper as Section 3's link (`AiCostSection.tsx:198`), so a new test asserts that the two hrefs are equal on the same render.
- It shows on all three views: Overview, Accounts and picked.

---

## Visible changes, old and new

These are the only visible changes. Each one is part of the user's browser look (AC-183).

| Where | Old | New | Why |
|---|---|---|---|
| Strip position | Inside the content, under the bar; Overview only; under the account header when picked | Between the header and the bar; on Overview, on the Accounts tab and in the picked view (above the account header) | BD-29 |
| Tile | A plain card, not clickable | The whole tile is a link (K-6): K-2 to K-5 jump to their section, and K-1 opens AI cost & usage | BD-31 |
| Line order | label, sub, value, previous, state, headline | label, value, sub (K-1: sub · previous), state, headline | K-3 |
| Type | label `text-xs text-slate-400`, value `text-lg` | label `text-sm font-medium text-white`, value `text-2xl font-semibold tabular-nums` | K-3 |
| Grid | `sm:grid-cols-3 lg:grid-cols-5`, gap 3 | `grid-cols-2 md:grid-cols-3 xl:grid-cols-5`, gap 4 | K-2 |
| Neutral tile (K-4 usually, K-5) | "For information" status row | No status row, `border-slate-700`; the headline line stays | K-4 (SA-W1) |
| Not measured / Could not check | `bg-slate-800/60` card | `bg-slate-800` card, same border and words | S-9 (SA-W2) |
| First load | `AdminLoading` only | Five tile placeholders above the bar, plus `AdminLoading` | K-10 |
| Error | Strip hidden (data cleared) | Unchanged | K-10 |

---

## Files to Create / Modify

| File | Action | Reason |
|---|---|---|
| `app/admin/components/layout/__tests__/KpiStrip.callers.pin.render.test.tsx` | create (Step 0, frozen) | Byte-identical pin of every existing caller (AC-178) |
| `app/admin/finance/__tests__/financeTiles.pin.render.test.tsx` | create (Step 0, frozen) | Tile value and status pin per fixture (AC-181) |
| `app/admin/components/layout/StatusChip.tsx` | modify `:30-45` | `OK_TONE` becomes the one exported `OK_GREEN` object literal (S-7, SA Q-3) |
| `app/admin/components/layout/KpiStrip.tsx` | modify `:3-22`, `:29-65`, `:98-128`, `:146-171`; add the cross-page branch | Statuses, optional value, `detail`, cross-page `link` mode |
| `app/admin/components/layout/__tests__/KpiStrip.render.test.tsx` | modify (additions only) | New statuses, no value, detail, cross-page mode, Health label parity |
| `app/admin/components/layout/__tests__/layoutFolder.guard.test.ts` | modify `:79-83` (header note), `:690-700` (Finance entry) | Adds `FinanceKpiStrip.tsx` and `FinanceSection.tsx` to the Finance C-14 entry |
| `app/admin/finance/components/FinanceKpiStrip.tsx` | modify (slim, ~90 → ~80 lines) | Shared `KpiStrip` / `KpiTile`; no `STATUS_STYLES`; `k5Value` kept |
| `app/admin/finance/components/FinanceView.tsx` | modify `:16-25`, `:96`, `:160-176`, `:222`; add `jumpTo` | BD-29 position; targets; K-1 link; placeholders |
| `app/admin/finance/components/FinanceSection.tsx` | modify `:58` | `id={id}` on the section: the anchor target |
| `app/admin/finance/financeCopy.ts` | modify `:8-9` (comment), add `k1SubLine` | K-1 sub with previous (SA-W4) |
| `app/admin/finance/__tests__/financePage.render.test.tsx` | modify (named tests below) | Old `-state` / `-headline` test ids and `STATUS_STYLES` gone; position assertions flip |
| `app/admin/finance/__tests__/source.guard.test.ts` | modify (additions) | No `HealthTile` import anywhere under `app/admin/finance`; the strip uses the shared tile by alias |
| `docs/workplans/FINANCE_F5_KPI_TILES_WORKPLAN.md` | create | This file |

**Count:** 12 code and test files (2 new, 10 modified), plus this workplan.

**Not touched:**
- `lib/**`, including `finance.source.guard.test.ts`;
- `app/api/**`;
- `financeRequest.pin.render.test.tsx` and `financeRequestPins.ts`;
- the contrast guard, whose `FinanceKpiStrip.tsx` path is kept;
- `aiCostVocabulary.source.guard.test.ts`;
- `HealthTile.tsx`;
- every other caller's component and test;
- `accountsTab.render.test.tsx`, whose module mock path is unchanged. If its strip mock needs the new props, they are ignored by the mock.

---

## Tests

### Must change (each named in the PR)

All in `app/admin/finance/__tests__/financePage.render.test.tsx`:

| Test (line) | Today | After |
|---|---|---|
| `:90` import | `STATUS_STYLES` from `HealthTile` | Removed (AC-179); states asserted by their literal words |
| `:503` "title, the three tiles with their text state…" | `tile-<id>-state` equals `STATUS_STYLES[status].label`; `tile-k3-headline` | Non-neutral: the tile contains its state word; neutral: no status row; headline as tile text |
| `:532` AC-22 / AC-94 | `tile-k5-headline` "No data yet" | The tile contains "No data yet" and no value line |
| `:692` AC-21 | `-state` for all five | As `:503` |
| `:738` AC-8 | K-4 state `STATUS_STYLES.neutral.label` | `data-status="neutral"`, no status row (K-4; SA-W1) |
| `:1445` AC-90 | `k5.className` lacks `STATUS_STYLES.green.card` | `data-status` is not `green` and the class lacks `OK_GREEN.card`'s border |
| `:1662` AC-110 | Account header **before** the strip | Strip **before** the bar, and the bar before the header (BD-29) |
| `:1708` 6a tabs | `kpi-strip` inside the Overview panel | `kpi-strip` outside the tab panel, before the bar; sections still in the panel |
| `:1925` Refresh keeps figures | `kpi-strip` inside `finance-content` | `kpi-strip` still present during the refresh (outside the content area); content `aria-busy` as before |

### New

**In `KpiStrip.render.test.tsx`:**
- each new status:
  - word, hidden icon, card border and accent;
  - name "label, value, healthy" and so on;
  - green's classes equal `OK_GREEN.card` / `.accent`;
- a value-less tile: no value line, name "label, status";
- `detail`: rendered after the status row, in `aria-describedby` after the sub, not in the name;
- the cross-page mode:
  - one `<a>` to the path;
  - never a button and never a region;
  - K-7 name;
  - the same classes as anchor mode;
- the Health parity test: imports `STATUS_STYLES` (test-only, outside S-3's scope) and asserts that the labels for red, amber, green, not_measured and unavailable are equal.

**In `financePage.render.test.tsx`, new describe "Finance F-5":**
- **AC-179:**
  - order: h1, then `kpi-strip`, then the filter bar, by document position, on Overview, Accounts and picked;
  - placeholders on first load, with no `kpi-strip`;
  - none on error.
- **AC-180:**
  - K-2 and K-4 href `#credits`, K-3 `#accounts`, K-5 `#revenue`, and each target `id` exists;
  - K-1 href equals `ai-analytics-link`'s href (all businesses, and picked with `account=`), with Custom window keys present for 7 days;
  - Accounts tab:
    - K-2's href is `/admin/finance?…#credits` with no `tab=`;
    - a plain click selects Overview (one `replaceState`, `tab` gone) and calls `scrollIntoView` on `#credits` (mocked on `Element.prototype`);
    - a ctrl-click does neither.
- No tile is a button: the button count is unchanged versus before the tiles became links. The page's "every retry reads Try again" test stays green.

**In `source.guard.test.ts`:**
- no file under `app/admin/finance`, tests included, names `components/health/HealthTile` or `STATUS_STYLES` (with a planted control);
- `FinanceKpiStrip.tsx` imports `KpiStrip` / `KpiTile` by the alias.

### Must stay untouched and green

- `financeRequest.pin.render.test.tsx`: hash equal.
- Every other caller's render test (the ten in [Analysis Summary](#analysis-summary)).
- `StatusChip.render.test.tsx`.
- `health.*` tests.
- `accountsTab.render.test.tsx`.
- `financeUrlState.render.test.tsx`, `financeFilterBar.layout.render.test.tsx` and `financeLinks.test.ts`.
- `finance.source.guard.test.ts`, including SA-WR-34 on the strip.

---

## Guards

| Guard | Effect of F-5 | Action |
|---|---|---|
| `layoutFolder.guard` C-14 (a) S-3 | `KpiStrip.tsx` adds `next/link` (allow-listed) and `./StatusChip` (inside the folder) | None; passes |
| C-14 (a) S-7 | Still one green constant (`OK_GREEN`, a literal object), in `StatusChip.tsx`; `KpiStrip.tsx` has no `emerald` literal | None; mutation M-2 proves it bites |
| C-14 (a) S-5 / S-6 / S-8 | No `console`, no `.json(`, no history write, no `<section>` in the folder | None |
| C-14 (b) Finance entry | Adds `FinanceKpiStrip.tsx` and `FinanceSection.tsx`. Neither has `<h1` or `.json(`; both reach the folder by alias (S-1) | **Edit the registry** (AC-181) |
| `contrast.lf1.source.guard` | Finance walk unchanged; the new classes are `slate-400` / `slate-300` / white; the `FinanceKpiStrip.tsx` path is kept | None |
| `aiCostVocabulary.source.guard` | `financeCopy.ts` gains one helper, no removal, so the floor of 439 holds; `AiCostSection.tsx` (28) and `AnalyticsKpis.tsx` (33) are untouched | Re-measure; stop and ask SA if any floor would drop |
| `app/admin/finance/__tests__/source.guard` | No console, no URL writer (scroll only), types-only finance imports, the `useAdminFilters` import line unchanged | Additions only |
| `lib/business-os/finance/__tests__/finance.source.guard` | SA-WR-34: `formatMoney(money.net, money.currency)`, one `.money`, `k5Value(k5.money)` in `FinanceKpiStrip.tsx`; no `stripe_` | Not edited (AC-182); the file is kept for this reason |
| `health.source.guard` | Scans the three Health files only; `GREEN_STYLE` untouched | None |
| AC-173 request pin | Not opened; hash `3a1a2dd4…f6f8` checked at Step 0 and at handover | None |
| `test:authz-guard` | No `route.ts` and no special-name file added | Run |
| `lint:hooks` | One new `useEffect` and `useState` in `FinanceView` | Run |

---

## AC mapping

| AC | Proof |
|---|---|
| **AC-178** shared tile supports green (S-7), not_measured, unavailable, no value, second line; existing users unchanged | `KpiStrip.render` new cases; C-14 S-7; **Pin A** (A1 and A2) hashes equal to Step 0; the ten callers' tests unedited and green |
| **AC-179** Finance renders the shared strip above the bar on Overview and Accounts; no `STATUS_STYLES` import in `app/admin/finance` | F-5 order tests (three views); source guard no-`HealthTile` case; grep in Implementation Notes |
| **AC-180** each tile jumps to its section; K-1 opens AI cost & usage | F-5 href and target tests; the Accounts-tab click test; K-1 href equals Section 3's link |
| **AC-181** values and statuses equal before and after; C-14 entry passes | **Pin B** green on `447d17a2` and after, file unedited (hash); C-14 (b) Finance entry with the two files |
| **AC-182** no `lib/`, `app/api/` or migration change | `git diff --stat -- lib app/api supabase` empty |
| **AC-183** browser look | Verification step 9, done by the user |

---

## SA-W questions

1. **SA-W1. Neutral tiles lose "For information".** K-4 says neutral tiles show no status row. Today Finance prints Health's "For information" on K-4, and on K-5 when there is no rule. Default: follow K-4, so the status row goes, while the headline line stays and `data-status` stays `neutral`. The alternative, a `neutral` row in the shared tile, would be a K-4 change for all pages.
2. **SA-W2. Grey card background.** Health draws `not_measured` / `unavailable` on `bg-slate-800/60`. The shared base is `bg-slate-800`, and an override would rely on class order (S-9). Default: keep `bg-slate-800` and copy only the border and accent. The alternative is to move `bg-*` out of `TILE_BASE` into each style, which changes the class string of every existing caller and breaks Pin A, so it is not proposed.
3. **SA-W3. Tiles on the Accounts tab.** The sections are not mounted there. Default (a): filter mode, a real link to Overview with `#section`, and a plain click that selects Overview and scrolls (`scrollIntoView`, never a hash write). Alternative (b): on the Accounts tab K-2 to K-5 are no-target tiles, and only K-1 links. (a) honours BD-31 on both tabs; (b) is simpler.
4. **SA-W4. K-1's three lines.** K-1 has a sub ("This month vs last month, UTC"), a previous figure and a headline. Default: fold the previous figure into the sub as "… · Same days last month: $X" (`k1SubLine`) and use `detail` for the headline, so there is one new prop. The alternative, a third line prop, adds shared API for one tile.
5. **SA-W5. The pin scope for Jobs and Model pricing.** Jobs' `kpiTiles` is module-private, and Model pricing's tiles live in an 818-line page. Default: Pin A1 covers every prop shape they pass, Pin A2 renders the real `priceKpis.ts` output through `KpiTile`, and both pages' existing layout tests stay unedited. Exporting `kpiTiles` only for a test would add an export with no consumer (SA-R-3).
6. **SA-W6. `kpi-strip` test id.** Default: a Finance wrapper `div`. Placeholders render outside it, so the many `findByTestId('kpi-strip')` "loaded" waits keep their meaning. The alternative is a `testId` prop on the shared `KpiStrip`, which is a shared API change with one consumer.
7. **SA-W7. K-1's window.** K-1 measures **this month** (`k1Spans(now)`) whatever the filter window is. The brief and BD-31 say the link carries the window and the account, so the default reuses `section3AnalyticsHref` (the page window), the same link as Section 3. With a 7-day window, AI cost & usage then shows a different figure from the tile. Alternative: send `range=this_month` (plus the account), which matches the tile's own figure. This is a business-visible choice; SA rules, or routes it to the user.
8. **SA-W8. `FinanceSection` gains `id`.** This makes every section an anchor target, as on Jobs and Archiving. It is not a landmark change, because `aria-labelledby` is unchanged (A-9). Confirm that it is acceptable outside the shared folder with no guard edit.

---

## Verification Plan

1. **Step 0 evidence.** On the unchanged `447d17a2`, run:
   - `npx jest app/admin/components/layout/__tests__/KpiStrip.callers.pin.render.test.tsx app/admin/finance/__tests__/financeTiles.pin.render.test.tsx --ci`, which must be green;
   - record the pass counts, both pin-file SHA-256s, and the AC-173 pin hash (`3a1a2dd4…f6f8`).
2. **Every page using `KpiTile` / `KpiStrip`:**

   ```bash
   npx jest app/admin/components app/admin/analytics app/admin/archiving app/admin/users \
     app/admin/business-os-tiers app/admin/business-os-invites app/admin/business-os-llm \
     app/admin/system-config app/admin/__tests__/jobsQueues.layout.render.test.tsx --ci
   ```
3. `npx jest app/admin/finance --ci`
4. **The guards, alone:**

   ```bash
   npx jest app/admin/__tests__/contrast.lf1.source.guard.test.ts \
     app/admin/__tests__/aiCostVocabulary.source.guard.test.ts \
     app/admin/__tests__/health.source.guard.test.ts app/admin/__tests__/health.render.test.tsx \
     lib/business-os/finance app/api/admin/business-os/finance --ci
   ```

   The F-0 CRLF fix means the DF-5 cases pass on Windows.
5. `npm run test:authz-guard`
6. `npm run lint:hooks`
7. **Scoped `tsc --noEmit`.**
   - Write a tsconfig to the scratchpad, **outside the worktree**. It extends the repo `tsconfig.json` and includes every changed and new file plus the ten caller files and `priceKpis.ts`, because the widened `KpiTileStatus` and the new union reach them.
   - Run it once with a planted canary (`const canary: number = 'x'`), which must fail, then without the canary, which must pass.
   - Delete the canary and the config.
8. **Mutations** (scratchpad runner; each file restored and its checksum re-checked). Each must fail a named test:
   - M-1: change one class in the anchor branch of `KpiStrip.tsx` (Pin A1 and A2);
   - M-2: write `border-emerald-500/40` literally in `KpiStrip.tsx` (C-14 S-7);
   - M-3: add a second `useId` in `KpiTile` (Pin A, ids shift; the normalisation keeps it green, so this is expected to **pass**: it documents that the ids are normalised);
   - M-4: render the neutral status as `green` in `tileStatus` (Pin B);
   - M-5: swap `atLeast` for a bare `formatCount` on K-2 (Pin B);
   - M-6: put the strip back below the bar (F-5 order test);
   - M-7: K-3 to `#credits` (F-5 href test);
   - M-8: K-1 link without `account` (equality with Section 3's link);
   - M-9: re-add `import { STATUS_STYLES }` to `FinanceKpiStrip.tsx` (source guard);
   - M-10: remove `FinanceKpiStrip.tsx` from the Finance C-14 entry and give it an `<h1` (C-14 (b) catches the `<h1` only once the entry lists it).
9. **`git diff --stat` and `git status` before handover:**
   - only the listed files change;
   - `git diff --stat -- lib app/api supabase` is empty;
   - no deletion without insertion (the agent file-write truncation check);
   - both Step 0 pin hashes and the AC-173 hash are equal to Step 0.
10. **The user's read-only browser look at `/admin/finance` (AC-183):**
    - **Order:** h1 "Finance", then five tiles, then the filter bar. The same holds on the Accounts tab and with a business picked (tiles above the account header).
    - **Clicks:**
      - "Accounts far over allowance" and "Gifted credits outstanding" jump to Credits;
      - "Founding Partners…" jumps to Accounts by plan;
      - "Our revenue" jumps to Our revenue;
      - "Charged AI cost" opens AI cost & usage with the same window and business;
      - on the Accounts tab, a tile opens Overview at its section.
    - **Look:** the coloured tiles show their word ("Needs action", "Healthy" and so on); grey tiles show "Not measured yet" or "Could not check"; the neutral tiles have no status line; light and dark themes.
    - **Values:** the same figures as before F-5 for the same window.

---

## Risks

| Risk | Mitigation |
|---|---|
| A shared edit changes another page's markup | Pin A (matrix plus eight real components plus the real `priceKpis`) written first and frozen; the three existing render branches are not edited |
| An extra `useId` shifts ids page-wide | No new `useId`: `detailId` is derived from `subId` |
| A second green constant | `OK_GREEN` is the one literal; C-14 S-7 plus mutation M-2 |
| A tile value or status drifts during the move | Pin B, selector-agnostic, frozen; the formatter calls are moved, not rewritten |
| The SA-WR-34 pin in `lib/` breaks | The strip file is kept with `k5Value(k5.money)`; the guard is not edited (AC-182) |
| `kpi-strip` waits resolve on placeholders | The placeholders sit outside the `kpi-strip` wrapper (SA-W6) |
| A dead anchor on the Accounts tab | SA-W3 (a): filter mode to Overview plus scroll |
| A K-1 link that differs from Section 3's | One helper; an equality test on the same render |
| Hash writes or a second URL writer | Scroll only; the `URL_WRITER` source guard |
| `tsc` misses a caller narrowing on `KpiTileStatus` | The scoped `tsc` includes all ten callers, with a canary |
| Shared `node_modules` junction / other sessions' WIP | No `git stash`, no `git worktree remove`; requirement MDs untouched; `git diff --stat` before handover |
| The user is surprised by neutral tiles losing "For information" | Listed in the old and new table; SA-W1; part of the browser look |

---

## Estimate

About **2 days**. **12 code and test files** (2 new, 10 modified), plus this workplan.

| Work | Time |
|---|---|
| Step 0: Pin A (matrix plus eight caller components plus `priceKpis`) and Pin B (four fixtures), green on `447d17a2` | 0.5 d |
| `StatusChip` reshape and the `KpiStrip` API (statuses, no value, detail, cross-page) with its render tests | 0.4 d |
| `FinanceKpiStrip` slim, `FinanceView` position, targets and jump, `FinanceSection` id, copy helper | 0.4 d |
| `financePage.render` edits, the F-5 describe, source-guard additions, C-14 registry | 0.4 d |
| Verification, ten mutations, `tsc` canary, Implementation Notes | 0.3 d |

---

## Checklist

- ✅ SA workplan review; SA-W1 to SA-W8 answered (approved with conditions F5-R1 to F5-R5)
- ✅ Step 0: Pin A and Pin B written and green on unchanged `447d17a2`; hashes and the AC-173 hash recorded
- ✅ Step 1: `StatusChip.tsx` `OK_GREEN`; `StatusChip.render` unedited and green
- ✅ Step 2: `KpiStrip.tsx` statuses, optional value, `detail`, cross-page `link`; Pin A green and unedited
- ✅ Step 3: `FinanceSection.tsx` `id`; F5-R1 `k1AnalyticsHref` in `financeLinks.ts`
- ✅ Step 4: `FinanceKpiStrip.tsx` slimmed (no `STATUS_STYLES`, `k5Value` kept)
- ✅ Step 5: `FinanceView.tsx` order (BD-29), targets (BD-31), placeholders, Accounts-tab jump (F5-R2)
- ✅ Step 6: `financeCopy.ts` comment and `k1SubLine`; vocabulary floors hold (guard green)
- ✅ Step 7: test edits and new tests; source guard additions; C-14 Finance entry
- ✅ Step 8: verification steps 1 to 9; results in Implementation Notes
- ⬜ Step 9: hand to SA code review and QA; the user's browser look (step 10)

---

## Implementation Notes

### Step 0 (F5-R4): the two pins, on the unchanged tree

- Both pins were written on `447d17a2` before any product edit. They were linted (ESLint exit 0), type-checked (scoped `tsc`, 0 errors) and run green:
  - **Pin A: 49/49** (48 cases plus the list check);
  - **Pin B: 6/6** (5 fixtures plus the list check).
- Timeouts, set from the start:
  - every render wait in Pin B has an explicit `{ timeout: 10_000 }`, and every case a 30 s test timeout;
  - Pin A renders synchronously, with a 30 s case timeout.
- Pin A's per-case hashes were recorded in the file from that green run; the file was then frozen.
- Pin B's payload builders are a copy of `financePage.render.test.tsx:170-356, :370-389, :417-481`, so the pin never depends on a file this slice edits.

**Frozen SHA-256 at Step 0:**

| File | SHA-256 |
|---|---|
| `app/admin/components/layout/__tests__/KpiStrip.callers.pin.render.test.tsx` (Pin A) | `30f5fc24f4e46870033ecdc984efa1c0647f633256f73ccfb302fa9899e62e01` |
| `app/admin/finance/__tests__/financeTiles.pin.render.test.tsx` (Pin B) | `24ff0da7efb824ccc2b5d90687e34b3cd9da33803658dccf19c0d096ae56df9f` |
| AC-173 pin `financeRequest.pin.render.test.tsx` (unopened) | `3a1a2dd415b3d0e0ffe44488a8c410b8e67a0bedf2ca908bbf064b6708bcf6f8` |
| AC-173 helper `financeRequestPins.ts` (unopened) | `b84e0c961e60c994414af7b418dd7f9dc94273e45695d632956427fade68aabf` |

### Steps 1-7: what was built

- **`StatusChip.tsx`:** `OK_TONE` became the one exported object literal `OK_GREEN` (`chip`, `card`, `accent`). The chip string is unchanged.
- **`KpiStrip.tsx`:**
  - statuses `green` (from `OK_GREEN`), `not_measured` and `unavailable`;
  - an optional `value`;
  - `detail`, whose id is derived from the sub's `useId`, so there is no new hook call;
  - the cross-page `link` mode on `next/link`.
  - In the anchor, filter and no-target branches only the `aria-describedby` expression changed, to the shared `describedBy`. With no `detail` it equals the old value, which Pin A proves.
- **`FinanceSection.tsx`:** `id={id}` on the section (SA-W8).
- **`financeLinks.ts`:**
  - `k1AnalyticsHref(accountId | null)` (F5-R1), built on `section3AnalyticsHref` with This month;
  - `analyticsHref` and `section3AnalyticsHref` now return the template type `AnalyticsHref`. This is type only and the strings are the same; it lets the tile take the address as a `/${string}` link.
- **`FinanceKpiStrip.tsx`:**
  - the shared strip inside a `kpi-strip` wrapper, with `FinanceKpiPlaceholders` outside it;
  - `k5Value(k5.money)` kept, so the `lib/` SA-WR-34 pin is untouched.
- **`FinanceView.tsx`:**
  - order: header, then strip or placeholders, then bar, then content (BD-29);
  - `targetFor`: an anchor, or the filter mode on the Accounts tab;
  - `jumpTo` scrolls once and clears, with no hash and no history write (F5-R2).
- **`financeCopy.ts`:** `k1SubLine`, and the stale comment fixed.
- **Tests:**
  - `KpiStrip.render` (+96 lines): the new statuses, Health label parity, no value, `detail`, the cross-page mode.
  - `financeLinks.test`: +4 cases (F5-R1).
  - `financePage.render`: the 9 named edits from the plan, plus a new "Finance F-5" describe of 12 tests:
    - the order on three views;
    - placeholders, and the error state;
    - the anchors and their targets;
    - F5-R3 unique ids;
    - K-1 This month (all businesses, picked, and a 7-day window);
    - on the Accounts tab: the real link, a plain click (one write, one scroll, no hash), and a modified click;
    - the Overview anchor.
  - `source.guard`: no Health tile import anywhere in `app/admin/finance`, tests included; the strip uses the shared tile by alias.
  - `layoutFolder.guard`: the Finance entry gains 2 files, plus a header note.

### Deviations from the plan (for SA)

1. **15 files, not 12.** The three extra files:
   - `financeLinks.ts` and `financeLinks.test.ts`, for F5-R1, which SA required;
   - `accountsTab.render.test.tsx`:
     - its `FinanceKpiStrip` mock needed the new `FinanceKpiPlaceholders` export;
     - its AC-130 reload test asserted **no** strip on the Accounts tab, which BD-29 reverses. It now asserts the strip is present, outside the tab panel.
2. **`financePage.render`'s "bad link" test (`:1941`)** also changed. It asserted that nothing amber sits outside the content area, and an amber tile now sits above the bar. The assertion now excludes the strip too; the notice check is unchanged.
3. **`AnalyticsHref` return type** on the two existing link builders. It is type only, with no string change. `financeLinks.test` has only additions and is green.
4. **One new `(global as any).fetch` stub** in the new page tests. It is the file's existing pattern, with its eslint-disable comment; Pin B carries the same stub.
5. **Mutation M-3 not run.** The plan documented it (a second `useId`) as expected to pass, so it was dropped. Two F5-R2 mutations were added instead (M-11, M-12).

### Step 8: verification (each suite run alone, 2026-10-16)

| # | Command | Result |
|---|---|---|
| 1 | Pin A and Pin B on `447d17a2` | 49/49, 6/6 |
| 2a | `npx jest app/admin/analytics app/admin/archiving app/admin/business-os-tiers app/admin/business-os-invites app/admin/system-config app/admin/__tests__/jobsQueues.layout.render.test.tsx --ci` | 35 suites, **846 passed** |
| 2b | `npx jest app/admin/users --ci` | 26 suites, **615 passed** |
| 2c | `npx jest app/admin/business-os-llm --ci` | 17 suites, **854 passed** |
| 3 | `npx jest app/admin/finance --ci` | 15 suites, **527 passed** |
| 4 | `npx jest app/admin/components --ci`, including `layoutFolder.guard` C-14 (S-7: one green, in `StatusChip.tsx`; the Finance entry with `FinanceKpiStrip.tsx` and `FinanceSection.tsx`) | 24 suites, **804 passed** |
| 5 | Contrast, `aiCostVocabulary`, `health.source.guard`, `health.render`, `lib/business-os/finance`, `app/api/admin/business-os/finance` | 21 suites, **1,949 passed** |
| 6 | `npm run test:authz-guard` | 2 suites, **203 passed** |
| 7 | `npm run lint:hooks` | exit 0, 0 warnings |
| 8 | ESLint on the 15 touched files | exit 0 |
| 9 | Scoped `tsc --noEmit`, with the config in the scratchpad. It covers the 15 files, the ten callers, `AnalyticsTable`, `priceKpis`, `AccountSummary`, `AiCostSection` and the finance route | Canary run: exit 2, exactly 1 error (the canary). Clean run: exit 0, 0 errors. The canary and the configs were deleted |

**Mutations.** A scratchpad runner applied each one, then restored it. Afterwards all 15 files were re-checked byte-identical by SHA-256.

| Mutation | Caught by | Result |
|---|---|---|
| M-1: an anchor-branch class changed | Pin A | 14 failed |
| M-2: an `emerald` literal in `KpiStrip.tsx` | C-14 S-7 | 1 failed |
| M-4: neutral rendered as green | Pin B | 4 failed |
| M-5: K-2 loses "At least" | Pin B | 2 failed |
| M-6: the strip moved back below the bar | F-5 order tests | 4 failed |
| M-7: K-3 jumps to Credits | F-5 anchor test | 1 failed |
| M-8: the K-1 link loses the account | `financeLinks.test` (F5-R1) | 2 failed |
| M-9: Health's styles imported in the strip | finance `source.guard` | 1 failed |
| M-10: an own `<h1` in the strip | C-14 (b) Finance entry | 1 failed |
| M-11: `jumpTo` never cleared | F5-R2 one-scroll test | 1 failed |
| M-12: the jump writes `location.hash` | F5-R2 no-hash test | 1 failed |

**Handover checks:**
- **The pin hashes at handover equal Step 0:** Pin A `30f5fc24…2e01`, Pin B `24ff0da7…f9f`, AC-173 `3a1a2dd4…f6f8`, helper `b84e0c96…aabf`.
- `git diff --stat -- lib app/api supabase` is **empty**.
- `git diff --numstat`: every modified file has insertions, and no file has a deletion without an insertion.
  - 13 code and test files modified, 2 new.
  - `docs/requirements/BUSINESS_OS_FINANCE_HEALTH_REQUIREMENT.md` shows SA's E-62 edit, not Dev's.
- No `console.*` added, and no `any` beyond the commented fetch stub.

### Open points for SA / QA

- The user's read-only browser look is owed (verification step 10, AC-183):
  - the order on Overview, on the Accounts tab and with a business picked;
  - the clicks;
  - the grey and neutral tiles;
  - light and dark themes.
- The visible changes are as listed in [Visible changes](#visible-changes-old-and-new). The K-1 link now opens This month (SA-W7 (a)), not the page window.

---

## SA Review Notes

### SA Workplan Review

**Reviewed by SA — 2026-10-16, against `447d17a2`**
**Status:** ✅ **APPROVED WITH CONDITIONS** (F5-R1 to F5-R5). Full cycle: this slice changes the shared layout folder. SA applied E-62 to the requirement.

**Checked against the code**
- **Callers.** `grep` for `layout/KpiStrip` imports outside tests finds exactly the workplan's ten pages: Analytics, Archiving, Invites, Activity, Costs, Settings, Plans, Jobs, Model pricing (page plus `priceKpis.ts`) and Businesses. It also finds the `AnalyticsTable` helper import. Health is not a caller. Pin A (the A1 prop matrix plus A2, the eight standalone components and the real `priceKpis`) covers them all; Jobs is covered through A1 and its unedited layout test (SA-W5).
- **S-7 single green.** `OK_TONE` is today's only green (`StatusChip.tsx:37`; the workplan's `:263`/`:271` line references are stale, F5-R5). The C-14 green check counts a `{ … }` object literal as a literal constant (`isLiteralConstant`, `layoutFolder.guard.test.ts:227-232`), so one exported `OK_GREEN` object passes. `KpiStrip.tsx` then holds no `emerald` literal. The chip string is unchanged and pinned by the unedited `StatusChip.render`.
- **Existing callers.** None uses the new statuses, `detail`, a null value or `link`. The name and `aria-describedby` formulas reduce to today's strings when those are absent. No new `useId` is added (`detailId` derives from `subId`). The three render branches are not edited, so Pin A must hold byte-identical.
- **Display only.** Pin B (four fixtures, selector-agnostic, frozen) pins every tile's `data-status`, value and lines before and after. The formatter calls are moved, not rewritten. There is no `lib/`, `app/api/` or request change.
- **AC-173 pin.** The current hashes match the workplan: pin file `3a1a2dd4…f6f8`, helper `b84e0c96…aabf`. Neither file is opened.
- **SA-WR-34.** `FinanceKpiStrip.tsx` is kept with `k5Value(k5.money)`, so the `lib/` guard stays unedited (AC-182).
- **The guard table, the AC mapping (AC-178 to AC-183) and the 2-day estimate are accepted.**

**Rulings**

| # | Ruling |
|---|---|
| **SA-W1** | **Approved.** Neutral tiles follow K-4: no status row and the `border-slate-700` card. The headline stays as the second line, and `data-status` stays `neutral`. Adding a shared `neutral` row would change K-4 for every page. |
| **SA-W2** | **Approved.** The grey statuses keep `bg-slate-800` and take only Health's border and accent. **This changes no existing caller**, because none passes `not_measured` or `unavailable` today. Pin A proves it: no A1/A2 hash moves. The only visible difference is on Finance's grey tiles, which go from `/60` to the solid tile background, and it is part of the browser look. |
| **SA-W3** | **(a) Approved.** The real link goes to Overview `#section` at the same window and business, and a plain click selects Overview (one hook write) and scrolls. It never writes a hash or history from the page. **F5-R2:** a test asserts that `jumpTo` is cleared after the scroll, that a second render does not scroll again, and that `location.hash` is untouched. |
| **SA-W4** | **Approved.** The previous figure joins the sub through `k1SubLine`, and the headline goes in `detail`. That is one new shared prop. |
| **SA-W5** | **Approved.** No test-only export of Jobs' `kpiTiles` (SA-R-3). The A1 matrix covers Jobs' prop shapes (including `loading` with children), and `jobsQueues.layout.render` stays unedited and green. Model pricing goes through its real `priceKpis.ts` output. |
| **SA-W6** | **Approved.** A Finance wrapper `div data-testid="kpi-strip"`, with the placeholders outside it. No shared `testId` prop. |
| **SA-W7** | **(a): the K-1 link carries the tile's own period, This month (UTC), plus the business when one is picked.** It does not carry the page window. K-1 always measures this month (`k1Spans`), so opening a different period from the tile would read as a bug. **Note:** AI cost & usage shows the **recorded** AI cost (M-4 vocabulary), so even for the same month its figure is at or above the tile's **charged** figure. That gap is by design and is explained by Section 3's "Recorded above charged" line. This is a technical reading of BD-31, which names the destination but not the period, so **no user question is needed**. **F5-R1:** add `k1AnalyticsHref(accountId \| null)` in `financeLinks.ts`, built as `section3AnalyticsHref(accountId, { preset: 'this_month', … })`, so it gives `range=this_month` plus `account=<id>` when picked. Pin it by tests: it equals Section 3's href when the page window is This month, and with a 7-day window it still carries `range=this_month`. Mutation M-8 is re-pointed to "K-1 link loses `account`". Recorded as E-62. |
| **SA-W8** | **Approved.** `id={id}` on `FinanceSection` gives the anchor targets, the same markup as Jobs and Archiving. `aria-labelledby` is unchanged (A-9), so this is not a landmark change. **F5-R3:** a test asserts that each anchor id occurs exactly once in the document on Overview and in the picked view. |

**Required changes (SA verifies at code review)**
1. **F5-R1 (Medium).** `k1AnalyticsHref`, This month plus the account, with tests (SA-W7).
2. **F5-R2 (Low).** The jump is scroll-only: `jumpTo` is cleared, there is no second scroll, and no hash is written (SA-W3).
3. **F5-R3 (Low).** Each section anchor id is unique (SA-W8).
4. **F5-R4 (Medium).** Freeze both pins: Pin A's and Pin B's SHA-256 values are recorded at Step 0 and at handover and must be equal, as must the AC-173 pair (`3a1a2dd4…`, `b84e0c96…`). Under the merge queue, every render wait in the two new pins uses an explicit `findBy…` timeout from the start (10 s, the F-4 amendment lesson). They will be frozen afterwards, so they cannot be loosened later.
5. **F5-R5 (Low).** Correct the stale `StatusChip.tsx` line references in the workplan (`OK_TONE` is at `:37`, used at `:46`) before Step 1, so the reviewers' diff map is right.

**Requirement edit (SA applied; recorded in §0.3 as SA-WP-F5)**
- **E-62 (§11G.2, F-5 row).** Appended: "K-1's link carries the tile's own period, This month (UTC), and the business when one is picked, not the page window (SA-W7). AI cost & usage shows the recorded AI cost, so its figure is at or above the tile's charged figure; Section 3's 'Recorded above charged' explains the gap. On the Accounts tab a tile opens Overview at its section (SA-W3). Neutral tiles show no status row (K-4, SA-W1)."

### SA Code Review

**Code Review by SA — 2026-10-16** (uncommitted on `feature/finance-f5-kpi-tiles`)
**Status:** ✅ **Code Approved.** No conditions. Nothing blocks QA.

**1. Conditions**
- **F5-R1.** `k1AnalyticsHref(accountId)` is `section3AnalyticsHref(accountId, { preset: 'this_month', … })`, which gives `/admin/analytics?range=this_month`, plus `&account=<id>` when a business is picked. It never takes the page window. Tests pin both forms, and pin that a 7-day page window still yields `range=this_month`.
- **F5-R2.** The Accounts-tab tile uses filter mode: one hook write (`onSelectTab('overview')`) plus `setJumpTo`. An effect calls `scrollIntoView` once the section exists, then clears `jumpTo`. Tests cover a single scroll, `location.hash === ''`, and no scroll on a modified click.
- **F5-R3.** A test asserts that each anchor id occurs exactly once (`querySelectorAll('[id]')`), and that each `#section` resolves to its `section-*` element.
- **F5-R4.** SA recomputed the four pin hashes: Pin A `30f5fc24…2e01`, Pin B `24ff0da7…df9f`, AC-173 pin `3a1a2dd4…f6f8`, helper `b84e0c96…aabf`. All match the reported and frozen values, and the AC-173 pair is untouched.
- **F5-R5.** The `StatusChip.tsx:37` line references are corrected.

**2. Other checks**
- **S-7.** There is one green: the `OK_GREEN` object literal, whose `chip` string is byte-equal to the old `OK_TONE`. `KpiStrip.tsx` imports `card` and `accent` from it and holds no `emerald` literal. The C-14 guard passes, including Finance's extended entry.
- **Existing callers are byte-identical.** Read from the diff:
  - with no `detail`, the name formula `[label, value, status].filter().join(', ')` and `describedBy` reduce exactly to the old strings;
  - the value line renders whenever value is a string;
  - the anchor, filter and no-target branches are untouched apart from the shared `describedBy` variable;
  - no new `useId` (`detailId` is derived).

  Pin A (frozen) proves this on all callers.
- **Display only.** `git diff -- lib app/api` is empty, Pin B is frozen and green, and `k5Value(k5.money)` is kept (SA-WR-34). There is no figure, calculation or request change.
- **BD-29 and BD-31.**
  - **Placement:** the strip renders between the header and the filter bar on Overview, the Accounts tab and the picked view, with placeholders on first load and nothing on an error.
  - **Targets:** K-2 to K-5 jump to `#credits`, `#accounts`, `#credits` and `#revenue` respectively, and K-1 is a `next/link` to AI cost & usage.
- **No `console.*` and no `any`** in the touched product files.

**3. Deviations**

| Deviation | Ruling |
|---|---|
| `financeLinks.ts`, `financeLinks.test.ts` and `accountsTab.render.test.tsx` were edited beyond the plan | ✅ **Approved.** `financeLinks` is where F5-R1's helper belongs. The `accountsTab` change is a **legitimate reversal, not a weakening.** BD-29 now requires the strip on the Accounts tab, and the new assertion is stronger than the old one: the strip is present *and* outside the tab panel. The mock gains `FinanceKpiPlaceholders: () => null`, test-only. |
| The bad-link amber check now also excludes the strip | ✅ **Approved.** The check exists to prove the deleted URL notice is gone. Since BD-29 the strip legitimately sits outside the content area and may be amber; everything else outside the content area is still checked. |
| `analyticsHref` and `section3AnalyticsHref` return a narrower type (`` `/admin/analytics?${string}` ``) | ✅ **Approved.** Only the return type changed; the function bodies are unchanged, so the URLs are byte-identical. The existing `financeLinks` tests pass unedited (the diff only adds lines), and the new type is what the tile's `link` mode requires. |
| M-3 dropped; two F5-R2 mutations added | ✅ **Approved.** M-3 was a documented non-biting mutation (ids are normalised); the two added mutations bite on the new jump behaviour. |

**4. SA re-run** (one suite at a time, own exit codes)

| Run | Result |
|---|---|
| `app/admin/finance` (incl. Pin B and the AC-173 pin) | exit 0, 15 suites, 527 tests |
| `app/admin/components` (incl. Pin A, C-14, `KpiStrip.render`) | exit 0, 24 suites, 804 tests |
| `app/admin/analytics` (a caller) | first run 7/8. `bosLens.render.test.tsx` P-8 hit Jest's 5 s default test timeout under load; it is **not in the diff** and makes no tile assertion. **Re-run alone 16/16, then the whole folder 8/8, 191 tests, exit 0** |
| `app/admin/business-os-llm` (three callers) | exit 0, 17 suites, 854 tests |
| `npm run test:authz-guard` | exit 0, 2 suites, 203 tests |

**Follow-up (Low, not this slice):** `bosLens.render.test.tsx` P-8 uses the 5 s default timeout and can time out under a loaded runner. That is a merge-queue flake risk. Record it for a future harden-the-wait chore, the same treatment as the F-4 pin.

**Code Approved for QA: Yes**

---

## QA Testing Report

**QA — 2026-10-16**
**Test mode:** full (AC-178 to AC-182; AC-183 manual)
**Strategy used:** A + B (render, pin and guard suites), each run alone; all four frozen-pin hashes recomputed; scoped `tsc` with a canary over every `KpiTile` caller; code reading for the edge cases; D (read-only browser look) listed for the user.
**Focus:** ui, shared component
**Skipped:** the browser look (AC-183): L-120 to L-127, for the user
**Input source:** prompt keywords from TL.
**Verdict:** ✅ **PASS**. No bug found.

**Frozen pins: all four equal**

| File | Expected | Recomputed |
|---|---|---|
| Pin A `KpiStrip.callers.pin.render.test.tsx` | `30f5fc24…2e01` | `30f5fc24f4e46870033ecdc984efa1c0647f633256f73ccfb302fa9899e62e01` ✅ |
| Pin B `financeTiles.pin.render.test.tsx` | `24ff0da7…df9f` | `24ff0da7efb824ccc2b5d90687e34b3cd9da33803658dccf19c0d096ae56df9f` ✅ |
| AC-173 pin `financeRequest.pin.render.test.tsx` | `3a1a2dd4…f6f8` | `3a1a2dd415b3d0e0ffe44488a8c410b8e67a0bedf2ca908bbf064b6708bcf6f8` ✅ |
| AC-173 helper `financeRequestPins.ts` | `b84e0c96…aabf` | `b84e0c961e60c994414af7b418dd7f9dc94273e45695d632956427fade68aabf` ✅ |

**Test runs** (worktree `neuronforge-finance-health`, branch `feature/finance-f5-kpi-tiles`, uncommitted; every run passed first time)

| # | Command | Result |
|---|---|---|
| Q-1 | Callers: `npx jest app/admin/analytics app/admin/archiving app/admin/business-os-tiers app/admin/business-os-invites app/admin/system-config app/admin/__tests__/jobsQueues.layout.render.test.tsx --ci` (AI cost & usage, Archiving, Plans, Invites, Model pricing, Jobs) | exit 0; **35 suites, 846 passed** |
| Q-2 | `npx jest app/admin/users --ci` (Businesses) | exit 0; **26 suites, 615 passed** |
| Q-3 | `npx jest app/admin/business-os-llm --ci` (Activity, Costs, Settings) | exit 0; **17 suites, 854 passed** |
| Q-4 | `npx jest app/admin/finance --ci` (incl. Pin B and the AC-173 pin) | exit 0; **15 suites, 527 passed** |
| Q-5 | `npx jest app/admin/components --ci`: PASS `layoutFolder.guard` (C-14 incl. S-7 one green and the Finance entry), `KpiStrip.callers.pin` (Pin A), `KpiStrip.render`, `StatusChip.render` | exit 0; **24 suites, 804 passed** |
| Q-6 | Contrast, `aiCostVocabulary`, `health.source.guard`, `health.render`, `lib/business-os/finance`, `app/api/admin/business-os/finance` | exit 0; **21 suites, 1,949 passed** |
| Q-7 | `npm run test:authz-guard` | exit 0; **2 suites, 203 passed** |
| Q-8 | `npm run lint:hooks` | exit 0 |
| Q-9 | Scoped `tsc`: `tsconfig.qa-f5.json` in the session scratchpad (outside the worktree), absolute `extends`, `include` = types + the 15 changed / new files + every non-test `layout/KpiStrip` importer + `priceKpis.ts` (27 files) | **Canary** in `KpiStrip.tsx` → exit 2, `KpiStrip.tsx(293,7): error TS2322`. **Restored** byte-identical (`cmp`, `grep -c qaCanary` = 0). Re-run: **exit 0, 0 diagnostics** |
| Q-10 | `git diff --stat -- lib app/api supabase`; deletion-only check; `grep -rn "STATUS_STYLES\|HealthTile" app/admin/finance` | **empty**; no deletion-only file; the only hits are the source guard's own regex and its planted control (`source.guard.test.ts:385, 401`) |

**Test coverage**

| AC | Result | Evidence |
|---|---|---|
| AC-178 | ✅ Pass | `KpiStrip.render` new cases (green from `OK_GREEN`, not_measured, unavailable, no value, `detail`, cross-page link, Health label parity); C-14 S-7 one green in `StatusChip.tsx`; **Pin A** green with its hash unchanged; every caller page's suites green (Q-1 to Q-3) |
| AC-179 | ✅ Pass | F-5 order tests on Overview, Accounts and picked (header → strip → bar); the source guard's "names neither Health's tile file nor its STATUS_STYLES" over every finance file, tests included |
| AC-180 | ✅ Pass | F-5 anchor and target tests; K-1 `k1AnalyticsHref` tests (This month plus the account, also on a 7-day window); the Accounts-tab real link, plain click and modified click |
| AC-181 | ✅ Pass | **Pin B** green with its hash unchanged (every tile's `data-status`, value and lines over four fixtures); the C-14 Finance entry lists `FinanceKpiStrip.tsx` and `FinanceSection.tsx` |
| AC-182 | ✅ Pass | Q-10: no `lib`, `app/api` or `supabase` change |
| AC-183 | ⬜ NOT-TESTED | Manual L-120 to L-127 |

**Edge cases**

| Case | Result | Evidence |
|---|---|---|
| Order header → tiles → bar, both tabs | Confirmed | `FinanceView.tsx:206-221`: `AdminPageHeader`, then the strip (or placeholders), then `FinanceFilterBar`, outside the tab panels, so on both tabs and in the picked view; F-5 order tests; mutation M-6 |
| Each tile's target | Confirmed | K-2 and K-4 → `#credits`, K-3 → `#accounts`, K-5 → `#revenue`, K-1 → `k1AnalyticsHref`; F-5 anchor test; M-7 |
| K-1 carries This month plus the business, even on a 7-day window | Confirmed | `K1_WINDOW = { preset: 'this_month' }` passed through `section3AnalyticsHref` (`financeLinks.ts:94-105`); test with a 7-day window; M-8 |
| Accounts tab: a click switches to Overview and scrolls once, no hash | Confirmed | Filter mode with `apply = onSelectTab('overview') + setJumpTo` (`FinanceView.tsx:181-196`). The effect scrolls once and clears `jumpTo` (`:169-176`). No `location.hash` write (`URL_WRITER` guard); F5-R2 tests; M-11, M-12 |
| Section ids unique | Confirmed | `id={id}` on `FinanceSection`; F5-R3 test on Overview and picked |
| Not-measured / unavailable tiles with no value | Confirmed | Optional `value`, so the name is `label[, status]`; Pin B fixture F2 (K-1 not_measured, K-2 unavailable, K-5 none) |
| Green status | Confirmed | `TILE_STATUS_STYLES.green` takes card and accent from `OK_GREEN`; C-14 S-7 counts one green; M-2 |
| No other admin page changed | Confirmed | Pin A hash unchanged and green; the ten callers' own suites unedited and green |
| No tile value or status changed | Confirmed | Pin B hash unchanged and green; M-4, M-5 |

**Issues found**
- **Bugs:** none.
- **Notes (Low):** none. The visible changes (neutral tiles lose "For information", grey tiles on the solid background, new type sizes) are approved (SA-W1, SA-W2, K-3) and are part of the browser look.

**Manual live steps** (continuing from F-4's L-119): a read-only browser look, signed in as a platform admin

| # | Step | Expected |
|---|---|---|
| L-120 | Open `/admin/finance` | From the top: the **"Finance"** heading, then **five tiles** (Charged AI cost, Accounts far over allowance, Founding Partners with no end date, Gifted credits outstanding, Our revenue), then the filter bar. On a hard reload, five grey placeholders show first |
| L-121 | Read the tiles | Coloured tiles show their word ("Needs action", "Needs a look", "Healthy"); grey ones say "Not measured yet" or "Could not check"; neutral tiles (often Gifted credits) have **no** status line. Figures equal those before F-5 for the same window. Check light and dark themes |
| L-122 | Click **Accounts far over allowance**, then **Gifted credits outstanding** | Each scrolls to the **Credits** section |
| L-123 | Click **Founding Partners with no end date**, then **Our revenue** | They scroll to **Accounts by plan** and to **Our revenue** |
| L-124 | Choose **7 days**, then click **Charged AI cost** | AI cost & usage opens on **This month** (`range=this_month`), not 7 days. Pick a business first and repeat: the link also carries `account=<id>`. AI cost & usage shows the *recorded* cost, which can be above the tile's *charged* figure (by design) |
| L-125 | Open the **Accounts** tab, then click **Our revenue** (or Credits) | The tiles are above the bar there too. The page switches to **Overview** and scrolls to that section once. The address bar has **no `#`**, and Back does not step through the scroll |
| L-126 | Pick a business | The tiles stay above the bar and above the account header; each still jumps to its section |
| L-127 | Open **Scheduled jobs & queues** (`/admin/jobs-queues`), then **AI cost & usage** and **Businesses** | Their tiles look exactly as before (same layout, colours and words) |

---

## Commit Info

_RM to populate._
