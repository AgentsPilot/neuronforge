# Workplan: Money M-5, the Money section

**Developer:** Dev
**Requirement:** [BUSINESS_OS_FINANCE_HEALTH_REQUIREMENT.md](/docs/requirements/BUSINESS_OS_FINANCE_HEALTH_REQUIREMENT.md) §11H (AC-184 to AC-203, SA-Q58 to SA-Q64; BD-21, BD-24, BD-27, BD-32 to BD-35; FU-M4-1); [ADMIN_COST_REVENUE_CONSOLIDATION_REVIEW.md](/docs/requirements/ADMIN_COST_REVENUE_CONSOLIDATION_REVIEW.md) §8 M-5 row and SA-Q-4; [ADMIN_LAYOUT_STANDARD_REQUIREMENT.md](/docs/requirements/ADMIN_LAYOUT_STANDARD_REQUIREMENT.md) §2.3 X-1, X-2, §3 rule 9, D-3 (a), C-14
**Branch:** `feature/bos-money-m5` (from main `98735db9`)
**Worktree:** `neuronforge-finance-health` (node_modules is a junction: no `git worktree remove`, no `git stash`)
**Date:** 2026-10-16
**Status:** Planning (workplan only; no code written; awaiting SA review of §11H and this workplan together)
**Path:** UI short path, about 2 days (§11H). Approval flow BD-33: SA, QA and TL approve, then RM commits, opens the PR and turns on auto-merge. No migration, so nothing stops for the user.

---

## Table of Contents

- [Scope](#scope)
- [Analysis Summary](#analysis-summary)
- [Implementation Approach](#implementation-approach)
- [Sidebar, before and after](#sidebar-before-and-after)
- [The route move: Charge checks at /admin/finance/charges](#the-route-move-charge-checks-at-adminfinancecharges)
- [The redirect for old links](#the-redirect-for-old-links)
- [Every in-app link to the old tab](#every-in-app-link-to-the-old-tab)
- [Step 0: the pins, written first](#step-0-the-pins-written-first)
- [Strings, old and new](#strings-old-and-new)
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

**In scope (§11H.2):**

1. **Sidebar.** Monitor keeps Health, Scheduled jobs & queues, Audit trail and Archiving. A new **Money** section follows it, holding Finance (first), **Charge checks** and **AI calls & usage (detail)**. Business OS AI's description becomes "Models, temperatures & AI activity". The sign-off for this exception to LAY X-1, X-2 and rule 9 is recorded in §11H.0 (BQ-1, BQ-6, given 2026-10-14).
2. **Charge checks.** A new client page at `/admin/finance/charges` mounts today's `CostsTab`, Leak check included, **as it is**, under the standard header. The Costs & credits tab leaves Business OS AI, which keeps Settings and Activity.
3. **Old links.** A temporary `next.config.js` redirect sends `/admin/business-os-llm?tab=costs[&range&from&to&account]` to `/admin/finance/charges` with the same query values.
4. **In-app links.** `costsHref` and `leakCheckHref` in `financeLinks.ts` point at the new path at source, with no `tab`.
5. **Health tile.** The "Recorded AI cost (USD)" tile gains a static page link to Finance.
6. **Strings S-1 to S-17.** "AI cost & usage" becomes "AI calls & usage" (with "(detail)" in the sidebar and the h1). S-14 to S-17 finish FU-M4-1, as wording only.

**Kept intact:**
- **The frozen pins**, never opened, with their hashes checked at Step 0 and at handover:
  - AC-173 pin `app/admin/finance/__tests__/financeRequest.pin.render.test.tsx` `3a1a2dd4…f6f8`;
  - its helper `financeRequestPins.ts` `b84e0c96…aabf`;
  - Pin A `app/admin/components/layout/__tests__/KpiStrip.callers.pin.render.test.tsx` `30f5fc24…2e01`;
  - Pin B `app/admin/finance/__tests__/financeTiles.pin.render.test.tsx` `24ff0da7…df9f`.
  - Hashes re-verified on `98735db9` while writing this plan; all four match.
- **The F-0 to F-5 work.** Nothing under `app/admin/components/layout/`, `FinanceView.tsx`, `FinanceKpiStrip.tsx` or the Finance tile mapping changes.
- **The cost report and the Leak check.** `app/admin/business-os-llm/components/costs/*`, `costsFilters.ts`, `costTypes.ts`, `costFormat.ts`, `leakCopy.ts`, `leakTypes.ts` and their API routes are **not edited** (SA-Q59 default; `git diff` on them is empty at handover).
- **Health and cron semantics.** Rule ids, colours, priorities, thresholds, factors, floors, metric ids, the tile id `bos_ai_spend`, the cron key, path, schedule and count keys.

**Out of scope:**
- Activity, which stays in Business OS AI (CR §1);
- moving any page with actions into Money (BD-21, NG-1);
- moving the `components/costs/*` files (SA-Q59);
- the `/test-business-os` harness text (CF-8) and historical workplans;
- any data, money, API route, payload shape (other than the Health tile's `pageLink` value) or migration change;
- the requirement MDs, which TL records.

---

## Analysis Summary

**Re-verified on `98735db9` (this worktree) while writing the plan:**

| # | Fact | Evidence |
|---|---|---|
| A-1 | Monitor items: Health `:87-94`, Finance `:95-101`, AI cost & usage `:102-107`, Jobs `:108-114`, Audit trail `:115-120`, Archiving `:121-126`. Settings: Business OS AI `:170-180` (description `:179`). Section titles `:85`, `:130`, `:168` | `app/admin/components/AdminSidebar.tsx` |
| A-2 | Active entry is `pathname === item.href` (`:379`), an exact match | `AdminSidebar.tsx:379` |
| A-3 | Icons already imported (`:7-33`). `UserCheck` is used only by a hidden parked entry, so a visible use under Money is not a duplicate | `AdminSidebar.tsx:7-33` |
| A-4 | Nav test parser: `itemRe = /name: '…',\s*href: '…',[\s\S]*?description: '…'/` (`:57`). **`name:` and `href:` must stay adjacent**, with no comment between them. Section order `:86-93`, Monitor list `:100-107`, Settings `:114-118`, on-disk scan one level deep `:71-79`, sorted equality `:158-166`, href count 28 at `:165` | `app/admin/components/__tests__/AdminSidebar.nav.test.ts` |
| A-5 | The Business OS AI nav test counts `/\/admin\/business-os-llm/g` in the **whole sidebar file, comments included**: exactly 1 (`:23`). Description pin at `:43` | `app/admin/business-os-llm/__tests__/nav.test.ts` |
| A-6 | Business OS AI page: `PageTab` `:121`, `TABS` `:126-130`, `PURPOSE` `:135-139`, `tabFromParam` `:142-144` (unknown → Settings), `TAB_KEYS` `:155-159`, `ALL_TAB_KEYS` `:162`, `writeTabToUrl` `:174-188`, `costsOpened` `:211`, `chooseTab` `:215-220`, `owns` `:225`, costs panel `:313-315` | `app/admin/business-os-llm/page.tsx` |
| A-7 | `CostsTab({ active = true })` calls `useAdminFilters(COSTS_FILTER_SPEC, { active })` (`:70-71`). It owns `range`, `from`, `to` (`wholeDateWindowFilter`) and `account`. `tab` is not a spec key, so the hook leaves it alone (`costsFilters.ts:7`, `:41-44`). The hook deletes only its own keys and aliases on a write (`useAdminFilters.ts:141-142`) | `components/costs/CostsTab.tsx`, `costsFilters.ts` |
| A-8 | `CostsTab` contains no visible "tab" wording. The only visible copy that names the tab outside the costs folder: `COSTS_TAB_LABEL` (`costCopy.ts:6`), `PLATFORM_ACCOUNT_ERROR` (`activityCopy.ts:99-101`) and `ACCOUNT_LINK_COSTS` (`financeCopy.ts:526`) | grep |
| A-9 | `next.config.js` `redirects()` at `:71-79` holds one temporary redirect. `require('./next.config.js').redirects()` resolves under plain Node (checked), so a Jest test can read it | `next.config.js` |
| A-10 | **Next 14.2.35 passes the request query through to the destination and cannot drop a key.** Query merge order: request query, then path params, then destination query (`prepare-destination.js:221-228`). `has` values are anchored regexes, `^value$`, and a repeated key matches its **last** value (`:96-101`) | `node_modules/next/dist/shared/lib/router/utils/prepare-destination.js` |
| A-11 | The finance source guard walks every non-test file under `app/admin/finance`, nested folders included (`:27-37`). So `charges/page.tsx` must be `'use client'`, use no `console` and no repository, and **write no URL itself** (`URL_WRITER` `:75`, applied at `:90`). The Suspense check reads only the root `page.tsx` (`:69-73`) | `app/admin/finance/__tests__/source.guard.test.ts` |
| A-12 | Authz R8 walks every render entry point under `app/admin/**` and requires a client component. A `'use client'` page passes with no registry edit | `lib/admin/__tests__/admin-authz-surface.guard.test.ts:387-455`, `:1966` |
| A-13 | C-14 registry: Business OS AI entry `:657-686` lists `costsFilters.ts` (`:661`) and the five costs components (`:681-685`). Finance entry `:700-711`. Analytics label `:545`. **No test asserts that a file is in only one entry** | `app/admin/components/layout/__tests__/layoutFolder.guard.test.ts` |
| A-14 | Contrast guard `PAGES` `:56-64`: Finance is `walk('app/admin/finance')` (so it picks up `charges/page.tsx`); the costs folder is not guarded. All five costs files have **0** `text-slate-500/600` hits today | `app/admin/__tests__/contrast.lf1.source.guard.test.ts` |
| A-15 | Vocabulary guard: `FILES` `:35-50` (14), `FORBIDDEN` `:54-63`, `ALLOWED` empty `:69`, `MIN_TEXTS` `:163-180`. The pinned rows that M-5 changes: W-19a `:310`, W-19b `:312`, W-21c `:316`. Header `:22-23` says `rules.ts` is skipped until M-5 | `app/admin/__tests__/aiCostVocabulary.source.guard.test.ts` |
| A-16 | Visible-text counts measured with the guard's own algorithm (scratch copy): `rules.ts` 184, `bosCronJobs.ts` 580, `costCopy.ts` 44 (equals floor), `activityCopy.ts` 142 (= floor), `evaluateHealth.ts` 217 (= floor), `financeCopy.ts` 448 (floor 439), `analytics/page.tsx` 71 (= floor), `BusinessOsPanel.tsx` 111 (= floor). **Removing `COSTS_TAB_LABEL` would drop `costCopy.ts` to 43, below its floor** | scratch measurement |
| A-17 | Forbidden phrases today in the files M-5 adds to the guard: only `bosCronJobs.ts:452` and `:459` ("AI spend"). None in `rules.ts` or `costCopy.ts` | grep |
| A-18 | Health: `OI_P1_NOTE` `:65-66`, spend figure `linkLabel` `:662`, footnote `:678-682`, `ENTITLEMENTS_PAGE_LINK` `:725-728`, `tilePageLink` `:734-738`, `colourTile` base `:475` (a static link survives a failed read). The spend tile always goes through `colourTile` (`:913`), never `notMeasuredTile` (`:765-778`) | `lib/admin/health/evaluateHealth.ts` |
| A-19 | Rule texts: `METRIC_LABELS` spend `:73-76`; spend rules `:213-251` (descriptions `:218`, `:225`, `:232`, `:239`, `:247`). Neither `rules.ts` nor `evaluateHealth.ts` imports from `lib/business-os/entitlements/`. Only `app/api/admin/health-summary/route.ts` is registered (`enforcementPoints.test.ts:268`), and it is not touched | `lib/admin/health/rules.ts` |
| A-20 | Cron: `credit-leak-check` description `:452`, count label `:459`. No test pins either string (grep: only `buildJobsQueuesView.test.ts:372` names the label "Credit leak check", unchanged) | `lib/cron/bosCronJobs.ts` |
| A-21 | `ANALYTICS_WHAT = 'AI cost and usage'` (`AnalyticsFilterBar.tsx:49`) is a visible name of the page, used in the bar and state copy. **It is not in S-1 to S-17** (SA-W7) | `app/admin/analytics/components/AnalyticsFilterBar.tsx:49` |
| A-22 | Pin A imports `CostsKpis` from `@/app/admin/business-os-llm/components/costs/CostsKpis` (`:42`) and `AnalyticsKpis` (`:32`), and hashes their HTML. Neither file nor its output changes in M-5. **A move of the costs files (SA-Q59 "move") would break Pin A's import**; the "stay" default is required for the pin to stay untouched | Pin A `:30-52`, `:231-233`, `:283-285` |
| A-23 | Pin B reads tile text by literal; AC-173 hashes request URLs. Neither reads any string M-5 changes (grep for the changed names and links: no hit in any of the four files) | the four pin files |
| A-24 | Live docs that point operators at the old tab: `docs/admin/ADMIN_IDENTIFICATION_AND_ACCESS.md:297-298`, `docs/architecture/BUSINESS_OS_CREDIT_PRICING.md:235`, `docs/architecture/BUSINESS_OS_ENTITLEMENTS.md:228`, `:265` (SA-W8) | grep |

**Not a new pattern (CR SA-Q-4).**
- `CostsTab` already runs standalone: its `active` defaults to `true`, and it owns its keys through `useAdminFilters`.
- On its own route, no other tab shares the address bar, so none of the L-9a coordination is copied.
- The page shape is Finance's own: a `'use client'` page wrapping its content in `Suspense`.

---

## Implementation Approach

Every pin exists and is green **before** the code it protects changes.

### Step 0 (first, on the unchanged `98735db9`): the pins

Two new **frozen** pins (C and D) are written and run green on the unchanged tree, together with the four existing hashes. Their SHA-256 values are recorded in Implementation Notes at Step 0 and again at handover, and the two must be equal. Details in [Step 0](#step-0-the-pins-written-first).

### Step 1: `next.config.js`, the redirect, and its test

Add the R-1 entry (see [The redirect](#the-redirect-for-old-links)). Write `chargeChecksRedirect.config.test.ts`. On the unchanged tree it fails, because the entry is missing. After the edit it is green.

### Step 2: the Charge checks page

Create `app/admin/finance/charges/page.tsx` (see [The route move](#the-route-move-charge-checks-at-adminfinancecharges)). Rename `COSTS_TAB_LABEL` to `CHARGE_CHECKS_TITLE = 'Charge checks'` in `costCopy.ts` (S-6, SA-W4). Pin C must now pass on the new side.

### Step 3: Business OS AI loses the Costs tab (CC-5)

Edit `app/admin/business-os-llm/page.tsx`:
- `PageTab = 'settings' | 'activity'`;
- `TABS`, `PURPOSE` and `TAB_KEYS` lose `costs`, and `ALL_TAB_KEYS` becomes `[...TAB_KEYS.activity]`, deduplicated as today;
- remove `costsOpened`, the `costs` branch of `chooseTab` and the costs `tabpanel` (`:313-315`);
- remove the imports of `CostsTab`, `COSTS_FILTER_SPEC`, `COSTS_INTRO` and `COSTS_TAB_LABEL`;
- update the header comment (`:30-48`, `:82-93`): Costs moved to Charge checks in M-5, and old `?tab=costs` links are redirected by `next.config.js`.

The L-9a coordination stays as it is (SA-Q61 default), now with one filter tab. `tabFromParam` is unchanged, so an unknown `tab`, `costs` included, opens Settings (R-2).

### Step 4: links at source (R-3, R-4)

Edit `financeLinks.ts`:
- `businessOsAiHref` serves Activity only (its `tab` parameter narrows to `'activity'`);
- `costsHref(accountId, window)` builds `/admin/finance/charges?` + `wholeDayWindow` keys + `account`, with no `tab`;
- `leakCheckHref(accountId)` returns `/admin/finance/charges`, or `/admin/finance/charges?account=<id>`.

Function names are kept, so `AccountSummary.tsx:187` and `RecordedCostLines.tsx:90` are not edited. The header comment (`:8-10`) and the two doc comments (`:107-112`) are updated.

### Step 5: the sidebar (§11H.3)

Edit `AdminSidebar.tsx` as shown in [Sidebar, before and after](#sidebar-before-and-after). The header comment (`:60-82`) gains one M-5 paragraph. **No comment may contain the literal `/admin/business-os-llm`** (A-5).

### Step 6: strings S-1 to S-17 and the Health link

Apply [Strings, old and new](#strings-old-and-new). In `evaluateHealth.ts`:
- add `export const FINANCE_PAGE_LINK: HealthPageLink = { href: '/admin/finance', text: 'Charged AI cost: open Finance' }`;
- add one branch to `tilePageLink`: `if (id === 'bos_ai_spend') return FINANCE_PAGE_LINK;`.

`HealthTile.tsx` already renders `pageLink` (`:138-147`) and is not edited.

### Step 7: tests and guards

Lists are in [Tests](#tests) and [Guards](#guards).

### Step 8: docs pointers (SA-W8)

Repoint the four live doc lines (A-24) to "Charge checks (`/admin/finance/charges`)", and add one Change History row to each of the three docs.

### Step 9: verification

See the [Verification Plan](#verification-plan).

---

## Sidebar, before and after

**File:** `app/admin/components/AdminSidebar.tsx`

| Section | Before (`98735db9`, `:83-198`) | After (M-5) |
|---|---|---|
| **Monitor** (`:85`) | Health · Finance · AI cost & usage · Scheduled jobs & queues · Audit trail · Archiving | Health · Scheduled jobs & queues · Audit trail · Archiving |
| **Money** (new, inserted after Monitor's closing `}` at `:128`) | — | **Finance** (`/admin/finance`, `Wallet`, "Revenue, AI cost and credits, Business OS", unchanged) · **Charge checks** (`/admin/finance/charges`, `UserCheck`, "Charged AI cost checked per account, Business OS") · **AI calls & usage (detail)** (`/admin/analytics`, `TrendingUp`, "Every AI call and its recorded cost, both products") |
| **Businesses** (`:130`) | Businesses · Plans & entitlements · Signup Invites · Messages | Unchanged |
| **Settings** (`:168`) | Business OS AI ("Models, temperatures & costs", `:179`) · Model pricing · Admin users | Business OS AI ("Models, temperatures & AI activity") · Model pricing · Admin users |
| **AgentsPilot (parked)**, hidden | 15 items | Unchanged |

**Rules for the edit:**
- Finance's existing comment (`:96`) moves with it and is updated to say "first in Money (M-5, BD-21)". The Business OS AI comment (`:174-178`) gains "M-5: Costs & credits moved to Charge checks".
- Each item keeps `name:` directly followed by `href:` (A-4).
- The visible render loop, `visibleSections` and separators are unchanged. The new section has no `hidden`.
- `globalIndex = sectionIndex * 10 + itemIndex` (animation delay only) is unaffected.

---

## The route move: Charge checks at /admin/finance/charges

**File:** `app/admin/finance/charges/page.tsx` (new, about 40 lines)

```typescript
'use client';

/**
 * `/admin/finance/charges` — Charge checks (Money M-5, §11H.4 CC-1 to CC-5).
 * Today's Costs & credits report and its Leak check, moved out of Business OS
 * AI and mounted here AS THEY ARE. ... (gated by app/admin/layout.tsx; no
 * own guard; useSearchParams needs Suspense; no tab coordination: CostsTab is
 * the only filter owner on this route, so `active` keeps its default `true`).
 */

import { Suspense } from 'react';

import { AdminPageHeader } from '@/app/admin/components/layout/AdminPageHeader';
import { CostsTab } from '@/app/admin/business-os-llm/components/costs/CostsTab';
import { CHARGE_CHECKS_TITLE, COSTS_INTRO } from '@/app/admin/business-os-llm/costCopy';

export default function ChargeChecksPage() {
  return (
    <Suspense fallback={null}>
      <div className="space-y-6">
        <AdminPageHeader title={CHARGE_CHECKS_TITLE} purpose={COSTS_INTRO} badge={{ label: 'Read-only' }} />
        <CostsTab />
      </div>
    </Suspense>
  );
}
```

**How `CostsTab` mounts (CC-3, SA-Q-4):**
- No `active` prop, so it defaults to `true` (`CostsTab.tsx:70`). The hook re-reads on outside URL changes and writes `range`, `from`, `to` and `account` with `replaceState(null, …)`.
- The `useAdminFilters` keys are `COSTS_FILTER_SPEC`'s: `window` → `range`, `from`, `to` (no aliases), and `account`. Default 30 days, plus the `90d` extra.
- Every other key, a stray `tab=costs` included, is left in the URL untouched (A-7).
- The page writes no URL itself, so the finance `URL_WRITER` guard holds (A-11). The hook lives in `app/admin/components/layout/`, which is outside that walk.
- The page has no `<h1` of its own and no `.json(`, as C-14 requires.

**Header (CC-2):** h1 "Charge checks" (= sidebar label, LAY D-3 (a)), the neutral "Read-only" chip, and `COSTS_INTRO` unchanged. It is the same header Business OS AI showed on its Costs tab (`page.tsx:280-284` with `PURPOSE.costs`).

**What is not copied:**
- the L-9a save and restore;
- `writeTabToUrl`;
- `owns()`;
- any `?tab=` reading.

---

## The redirect for old links

**File:** `next.config.js` (`redirects()`, `:71-79`)

```javascript
{
  // Money M-5 (§11H.4 R-1): Costs & credits moved to Charge checks. Temporary
  // (307) for the same reason as above. Next passes the query through, so the
  // window (range, from, to) and the business (account) arrive; the stray
  // tab=costs is not a Charge checks key and is ignored there (SA-Q60).
  source: '/admin/business-os-llm',
  has: [{ type: 'query', key: 'tab', value: 'costs' }],
  destination: '/admin/finance/charges',
  permanent: false,
},
```

**Behaviour:**
- `has` is anchored, so only `tab=costs` exactly matches (A-10). `?tab=settings`, `?tab=activity`, no `tab`, and `?tab=costsx` are not redirected (R-2, AC-192).
- The redirect runs before middleware and before the admin layout. An unauthenticated request is still refused, at the destination (AC-202).

**Test:** `app/admin/finance/__tests__/chargeChecksRedirect.config.test.ts` (new, `@jest-environment node`)

| Case | Assertion |
|---|---|
| Shape | `await require('next.config.js').redirects()` contains exactly one entry with `source: '/admin/business-os-llm'`, `has: [{ type: 'query', key: 'tab', value: 'costs' }]`, `destination: '/admin/finance/charges'`, and `permanent: false` (AC-191 temporary) |
| Payments redirect kept | The `/business-os/payments` entry is unchanged; there are two entries in total |
| Matching (SA-W3) | Through Next's own `matchHas(req, query, has)` (`next/dist/shared/lib/router/utils/prepare-destination`): `{tab:'costs', range:'7d', account:A}` matches; `{tab:'activity'}`, `{tab:'settings'}`, `{}`, and `{tab:'costsx'}` do not |
| Pass-through | Next's `prepareDestination({ destination, params, query, appendParamsToQuery:false })` for `tab=costs&range=custom&from=2026-09-01&to=2026-09-30&account=A` yields pathname `/admin/finance/charges` and a query that still holds `range`, `from`, `to` and `account` (AC-191: window and business arrive) |
| Parsed back | Those destination keys parse back through `COSTS_FILTER_SPEC` to the same window and account (the `financeLinks.test` method) |

**Manual check (Verification step 8):** `curl -sI` against the dev server. The redirect runs before auth, so no login is needed.

---

## Every in-app link to the old tab

Found by `grep -rn "tab=costs\|'costs'\|business-os-llm" app lib components hooks middleware.ts` outside tests and the page's own folder.

| # | Where | What | M-5 |
|---|---|---|---|
| L-1 | `app/admin/finance/financeLinks.ts:50-56`, `:62-64` (`businessOsAiHref('costs', …)` via `costsHref`) | Account summary "Business OS AI Costs & credits" link, `AccountSummary.tsx:187` | → `/admin/finance/charges?range…&account=…` (R-3) |
| L-2 | `app/admin/finance/financeLinks.ts:113-118` (`leakCheckHref`) | Section 3 "Leak check" link, `RecordedCostLines.tsx:90` | → `/admin/finance/charges[?account=…]` (R-4) |
| L-3 | `app/admin/business-os-llm/page.tsx:121-162`, `:211-216`, `:313-315` | The tab itself and its `?tab=costs` read | Removed (CC-5) |
| L-4 | `app/admin/components/AdminSidebar.tsx:172` | `/admin/business-os-llm` (no tab) | Unchanged |
| L-5 | `lib/admin/health/evaluateHealth.ts:577` | Settings tile → `/admin/business-os-llm` (no tab) | Unchanged |

There are no other product links:
- `adminWindowPresets.ts`, `adminWindow.ts` and `readJsonBody.ts` mention the folder in comments only.
- The `lib/business-os/credits/*Types.ts` hits are comments.

**Text-only mentions** (no link):
- `activityCopy.ts:101` → S-10.
- `components/test-business-os/llm-usage/CheckPanels.tsx:286` stays (CF-8, out of scope).

**Tests that use `?tab=costs`** (all listed in [Tests](#tests)):
- `costsLayout.render` (25 lines);
- `tabCoexistence.render` (20 lines);
- `activityTab.render:648-653`;
- `financeLinks.test:54`, `:164-186`;
- `recordedCost.render:83`, `:86`.

---

## Step 0: the pins, written first

### Pin C: `app/admin/finance/__tests__/chargeChecksRequest.pin.render.test.tsx` + helper `chargeChecksRequestPins.ts` (new, frozen), for AC-188

**Helper `chargeChecksRequestPins.ts` (frozen):**
- `PIN_NOW = new Date('2026-10-16T10:00:00.000Z')`, `PIN_ACCOUNT`;
- `STATES`: the Charge checks query strings, with no `tab`:
  - `''`;
  - `range=7d`;
  - `range=90d`;
  - `range=today`;
  - `range=this_month`;
  - `range=custom&from=2026-09-01&to=2026-09-30`;
  - `account=<A>`;
  - `range=7d&account=<A>`;
  - one invalid account (`account=nope`, ignored → all businesses);
  - one one-sided custom (`range=custom&from=2026-09-01`, ignored → 30 days);
- `EXPECTED_REPORT[i]`: the exact `/api/admin/business-os/credits/report?…` URL each state sends;
- `EXPECTED_LEAK`: the exact leak-check request URL after "Run leak check" with and without a picked account.
- It carries one table self-check, because Jest collects every file under `__tests__/`, as with the AC-173 helper.

**Pin C test:** it is frozen and runs unedited on **both** trees.
- `const NEW_PAGE = 'app/admin/finance/charges/page.tsx'`.
- If that file exists, it mounts the Charge checks page at `/admin/finance/charges?${state}`. Otherwise it mounts `BusinessOsLlmSettingsPage` at `/admin/business-os-llm?tab=costs${state && '&' + state}`. In both cases the module is loaded with `require()` inside the test, so the file compiles whichever page is absent (SA-W2).
- It collects the fetch calls to the report path (ignoring the settings `GET` and the picker), asserts **exactly one** report request per state equal to `EXPECTED_REPORT[i]`, then presses "Run leak check" and asserts `EXPECTED_LEAK`.
- `jest.useFakeTimers({ now: PIN_NOW, doNotFake: ['setTimeout', 'setInterval', 'setImmediate', 'queueMicrotask', 'nextTick'] })`: only `Date` is faked (the #399 lesson: no `advanceTimers`).
- Every wait is an explicit `findBy…` or `waitFor` with a 10 s timeout (the F-4 amendment lesson).
- The navigation mock is the `costsLayout` harness: `useSearchParams` follows `window.location`.

**Its weakness:** after M-5 the old-page branch is dead code. It stays, because it is what proves equality across the change (the AC-173 "same file on either side" discipline).

### Pin D: `lib/admin/health/__tests__/m5WordingOnly.pin.test.ts` (new, frozen), for AC-197 and AC-198

It hashes (SHA-256, constants recorded at Step 0) three things:
1. `JSON.stringify(HEALTH_RULES)` with every `description` replaced by `''`: ids, priorities, colours and conditions;
2. `METRIC_LABELS` with every `label` replaced by `''`: metric ids and units;
3. the `credit-leak-check` entry of the cron list with `description` and every count `label` replaced by `''`: id, path, schedule, `addedOn`, `drainsQueue` and count keys and paths.

A planted one-character factor change fails it (mutation M-9). Descriptions and labels are free to change, which is the whole of S-14 to S-17.

### The four existing pins

These are not opened. Their hashes are checked at Step 0 and at handover:

| Pin | SHA-256 |
|---|---|
| AC-173 `financeRequest.pin.render.test.tsx` | `3a1a2dd415b3d0e0ffe44488a8c410b8e67a0bedf2ca908bbf064b6708bcf6f8` |
| AC-173 helper `financeRequestPins.ts` | `b84e0c961e60c994414af7b418dd7f9dc94273e45695d632956427fade68aabf` |
| Pin A `KpiStrip.callers.pin.render.test.tsx` | `30f5fc24f4e46870033ecdc984efa1c0647f633256f73ccfb302fa9899e62e01` |
| Pin B `financeTiles.pin.render.test.tsx` | `24ff0da7efb824ccc2b5d90687e34b3cd9da33803658dccf19c0d096ae56df9f` |

**Frozen-pin impact: none expected.**
- No pin's content needs to change.
- Pin A renders `CostsKpis` and `AnalyticsKpis`, whose files and output M-5 does not touch. This depends on SA-Q59 "stay" (A-22).
- If SA rules a move, Pin A's import path breaks. Dev would then stop and raise it as an SA-W, not edit the pin.

---

## Strings, old and new

Copy only. Each row keeps its testid, key and href unless it says otherwise.

| # | File:line | Old | New |
|---|---|---|---|
| S-1 | `AdminSidebar.tsx:103` | `AI cost & usage` | `AI calls & usage (detail)` |
| S-2 | `AdminSidebar.tsx:106` | `Token spend, both products` | `Every AI call and its recorded cost, both products` |
| S-3 | `AdminSidebar.tsx` (new item) | — | `Charge checks` / `Charged AI cost checked per account, Business OS` |
| S-4 | `AdminSidebar.tsx:179` | `Models, temperatures & costs` | `Models, temperatures & AI activity` |
| S-5 | `app/admin/analytics/page.tsx:289` | `title="AI cost & usage"` | `title="AI calls & usage (detail)"` |
| S-6 | `app/admin/business-os-llm/costCopy.ts:6` | `COSTS_TAB_LABEL = 'Costs & credits'` | `CHARGE_CHECKS_TITLE = 'Charge checks'` (renamed, not removed: keeps the 44 floor; SA-W4), used as the Charge checks h1 |
| S-7 | `app/admin/finance/financeCopy.ts:217` `AI_LINK`, `:527` `ACCOUNT_LINK_ANALYTICS` | `AI cost & usage` | `AI calls & usage` |
| S-8 | `app/admin/finance/financeCopy.ts:526` `ACCOUNT_LINK_COSTS` | `Business OS AI Costs & credits` | `Charge checks` |
| S-9 | `app/admin/business-os-llm/activityCopy.ts:75`, `:81` | `… the recorded AI cost in AI cost & usage.`; `AI cost & usage (Business OS, recorded)` | `… the recorded AI cost in AI calls & usage.`; `AI calls & usage (Business OS, recorded)` |
| S-10 | `app/admin/business-os-llm/activityCopy.ts:101` | `… counted by the leak check on the Costs & credits tab.` | `… counted by the Leak check on Charge checks.` |
| S-11 | `app/admin/users/components/BusinessOsPanel.tsx:397` | `Open in AI cost & usage` | `Open in AI calls & usage` |
| S-12 | `lib/admin/health/evaluateHealth.ts:66`, `:662`, `:681` | `AI cost & usage reads at most…`; `…, open in AI cost & usage`; `…; AI cost & usage computes…` | `AI calls & usage reads at most…`; `…, open in AI calls & usage`; `…; AI calls & usage computes…` |
| S-13 | `lib/admin/health/evaluateHealth.ts` (new `FINANCE_PAGE_LINK`) | — | `Charged AI cost: open Finance` → `/admin/finance` |
| S-14 | `lib/admin/health/rules.ts:73-76` | `24 h spend` · `previous 24 h spend` · `7-day spend` · `previous 7-day spend` | `24 h recorded AI cost` · `previous 24 h recorded AI cost` · `7-day recorded AI cost` · `previous 7-day recorded AI cost` |
| S-15 | `lib/admin/health/rules.ts:225`, `:232`, `:239` | `Spend tripled vs yesterday` · `Spend doubled vs yesterday` · `Week up 50% or more` | `Recorded AI cost tripled vs yesterday` · `Recorded AI cost doubled vs yesterday` · `Recorded AI cost up 50% or more on the week` (`:218`, `:247` stay) |
| S-16 | `lib/cron/bosCronJobs.ts:452` | `Checks that yesterday's Business OS AI spend was all charged` | `Checks that yesterday's recorded Business OS AI cost was all charged` |
| S-17 | `lib/cron/bosCronJobs.ts:459` | `businesses with uncharged AI spend` | `businesses with recorded AI cost not charged` |

**Comments touched alongside, no visible effect:**
- `AnalyticsKpis.tsx:4` is **not** touched (Pin A file).
- The `financeLinks.ts` and `page.tsx` headers, as in the steps above.
- The `rules.ts` comment at `:106` ("new spend") is left.

**Not changed:**
- `ANALYTICS_WHAT 'AI cost and usage'` (A-21, SA-W7);
- the Leak check reason texts (SA-W96);
- the `route.qa-edge` test titles (optional per §11H.6; left to keep that file untouched).

---

## Files to Create / Modify

| File | Action | Reason |
|---|---|---|
| `app/admin/finance/__tests__/chargeChecksRequestPins.ts` | create (Step 0, frozen) | AC-188 states and literal requests |
| `app/admin/finance/__tests__/chargeChecksRequest.pin.render.test.tsx` | create (Step 0, frozen) | Pin C, runs on both trees (AC-188) |
| `lib/admin/health/__tests__/m5WordingOnly.pin.test.ts` | create (Step 0, frozen) | Pin D (AC-197, AC-198) |
| `app/admin/finance/charges/page.tsx` | create | Charge checks (CC-1 to CC-4) |
| `app/admin/finance/__tests__/chargeChecks.page.render.test.tsx` | create | h1, badge, purpose, report and Leak check, URL writes with no `tab`, stray `tab` kept (AC-187, AC-189) |
| `app/admin/finance/__tests__/chargeChecksRedirect.config.test.ts` | create | R-1 redirect (AC-191, AC-192) |
| `next.config.js` | modify `:71-79` | R-1 |
| `app/admin/components/AdminSidebar.tsx` | modify `:60-198` | Money section, S-1 to S-4 |
| `app/admin/business-os-llm/page.tsx` | modify `:1-98`, `:113-162`, `:211-220`, `:313-315` | Costs tab removed (CC-5) |
| `app/admin/business-os-llm/costCopy.ts` | modify `:1-6` | S-6 |
| `app/admin/business-os-llm/activityCopy.ts` | modify `:75`, `:81`, `:101` | S-9, S-10 |
| `app/admin/finance/financeLinks.ts` | modify `:8-10`, `:50-64`, `:107-118` | R-3, R-4 |
| `app/admin/finance/financeCopy.ts` | modify `:217`, `:526-527` | S-7, S-8 |
| `app/admin/analytics/page.tsx` | modify `:289` | S-5 |
| `app/admin/users/components/BusinessOsPanel.tsx` | modify `:397` | S-11 |
| `lib/admin/health/evaluateHealth.ts` | modify `:66`, `:662`, `:681`, `:723-738` | S-12, S-13, R-5 |
| `lib/admin/health/rules.ts` | modify `:73-76`, `:225`, `:232`, `:239` | S-14, S-15 |
| `lib/cron/bosCronJobs.ts` | modify `:452`, `:459` | S-16, S-17 |
| `app/admin/components/__tests__/AdminSidebar.nav.test.ts` | modify | Order, Money, nested route, count 29 |
| `app/admin/business-os-llm/__tests__/nav.test.ts` | modify `:42-44` | S-4 pin |
| `app/admin/business-os-llm/__tests__/costsLayout.render.test.tsx` | modify | Re-target to Charge checks (SA-W5) |
| `app/admin/business-os-llm/__tests__/costsTab.render.test.tsx` | modify `:18`, `:335-423` | Page block: two tabs; Charge checks mounts the report |
| `app/admin/business-os-llm/__tests__/tabCoexistence.render.test.tsx` | modify | Re-scope to Settings ↔ Activity (SA-W6) |
| `app/admin/business-os-llm/__tests__/activityTab.render.test.tsx` | modify `:648-653` | `?tab=costs` now opens Settings |
| `app/admin/business-os-llm/__tests__/activityLayout.render.test.tsx` | modify `:32`, `:161-163`, `:173-204` | Two tabs (T-1, T-2) |
| `app/admin/business-os-llm/__tests__/settingsLayout.render.test.tsx` | modify `:157` | Loop over `activity` only |
| `app/admin/finance/__tests__/financeLinks.test.ts` | modify `:52-71`, `:164-186` | New paths, no `tab` |
| `app/admin/finance/__tests__/recordedCost.render.test.tsx` | modify `:83`, `:86` | New Leak check href |
| `app/admin/analytics/__tests__/analytics.layout.render.test.tsx` | modify `:185`, `:204` | S-5 h1 |
| `lib/admin/health/__tests__/evaluateHealth.test.ts` | modify `:356`, `:645-659`; add cases | S-12 label; R-5 link |
| `app/admin/__tests__/health.render.test.tsx` | modify `:97`; add one case | Fixture label; the spend tile renders its page link |
| `app/admin/__tests__/aiCostVocabulary.source.guard.test.ts` | modify | +3 files, floors, M-5 rows (AC-199) |
| `app/admin/components/layout/__tests__/layoutFolder.guard.test.ts` | modify `:545`, `:646-686`, after `:711`; add one case | C-14 Charge checks entry; one-entry-per-file check |
| `app/admin/__tests__/contrast.lf1.source.guard.test.ts` | modify `:56-64`, walk test | "Charge checks" key (SA-Q63) |
| `docs/admin/ADMIN_IDENTIFICATION_AND_ACCESS.md`, `docs/architecture/BUSINESS_OS_CREDIT_PRICING.md`, `docs/architecture/BUSINESS_OS_ENTITLEMENTS.md` | modify (pointer lines + Change History row) | SA-W8 |

**Not edited** (`git diff` empty at handover):
- `app/admin/business-os-llm/components/costs/*`, `costsFilters.ts`, `costTypes.ts`, `costFormat.ts`, `leakCopy.ts`, `leakTypes.ts`;
- `AccountSummary.tsx`, `RecordedCostLines.tsx`, `HealthTile.tsx`;
- the four frozen pins;
- `app/api/**`, `lib/repositories/**`, `supabase/**`, `app/admin/components/layout/**`;
- the requirement MDs.

---

## Tests

### Must change (each named in the PR)

| Test | Change |
|---|---|
| `AdminSidebar.nav.test.ts` | Section order `['Monitor','Money','Businesses','Settings','AgentsPilot (parked)']`. Monitor `['/admin','/admin/jobs-queues','/admin/audit-trail','/admin/archiving']`; new Money `['/admin/finance','/admin/finance/charges','/admin/analytics']`. `NESTED_LISTED = ['/admin/finance/charges']`, each asserted to exist on disk; the sorted equality becomes `onDisk minus UNLISTED plus NESTED_LISTED`. Href count 28 → 29. New cases: Finance first in Money (BD-21); no action page in Money: `/admin/users`, `/admin/system-config`, `/admin/jobs-queues` and `/admin/business-os-invites` are absent from Money (AC-185); S-1 to S-3 names and descriptions; the Business OS AI description contains no "cost" (AC-186). Header comment items 8 and 9 added |
| `business-os-llm/__tests__/nav.test.ts` | `:43` → `Models, temperatures & AI activity`; add `not.toContain("Models, temperatures & costs")`. The "exactly one match" test is unchanged and must stay green (A-5) |
| `costsLayout.render.test.tsx` (23 tests) | `PAGE = '/admin/finance/charges'`; mount `ChargeChecksPage`; `openAt('?tab=costs…')` → `openAt('?…')`; URL expectations drop `tab=costs` (C-4 "keeping tab" → "writes only Costs keys"); `costs()` → `screen.getByTestId('costs-tab')`. C-1 to C-12 and F-1 otherwise keep their assertions. One added case: an inbound `?tab=costs&range=7d` (the redirect's output) keeps `tab=costs` after a window change and reads 7 days once |
| `costsTab.render.test.tsx` "the page" block (`:335-423`, 4 tests) | (1) Business OS AI opens on Settings, shows **two** tabs and never requests `/credits/report`; (2) → "Charge checks mounts the report" (renders `ChargeChecksPage`); (3) each of the two tabs controls its own tabpanel; (4) "switching tabs keeps the window" is **deleted**: there is no Costs tab (SA-W6). `COSTS_TAB_LABEL` import → none |
| `tabCoexistence.render.test.tsx` (12 tests) | Kept or adapted to Settings ↔ Activity: X-4 (unchanged), X-5 (row "a Costs URL" becomes "an old `?tab=costs` URL opens Settings, and a stray Activity key never survives"), X-6 (Activity ↔ Settings, unrelated keys and hash), X-7 (Activity's first visit from Settings in the lag window), X-9 (Clear on Activity after a switch keeps `tab` and unrelated keys), X-11 (an outside change re-parses Activity only while shown). **Deleted**, because they need two filter tabs: X-1, X-2, X-3, X-8, X-8b, X-10, X-12 (SA-W6). The header comment says so |
| `activityTab.render.test.tsx:648-653` | `?tab=costs` opens **Settings** (selected), mounts no `costs-tab`, and requests no report (R-2, AC-192) |
| `activityLayout.render.test.tsx` | T-1 drops the Costs step (`:161-163`) and the `COSTS_INTRO` import. T-2 with two tabs: tabIndex `[0,-1]`, ArrowLeft wraps to Activity, ArrowRight to Settings then Activity, End/Home, then Enter selects Activity and the **list** is read (not the report) |
| `settingsLayout.render.test.tsx:157` | `for (const other of ['activity'])` |
| `financeLinks.test.ts` | `describe.each` keeps the Activity row and moves Costs to its own block: `costsHref` starts with `/admin/finance/charges?`, has **no `tab`**, parses back through `COSTS_FILTER_SPEC` to the same dates and account for all five presets, and every key is one the spec owns. `leakCheckHref(null)` → `'/admin/finance/charges'`; `leakCheckHref(A)` → `` `/admin/finance/charges?account=${A}` ``, with keys `['account']` and no window. A source check that no function in `financeLinks.ts` emits `tab=costs` (AC-193) |
| `recordedCost.render.test.tsx:83`, `:86` | `/admin/finance/charges`, `` `/admin/finance/charges?account=${A}` `` |
| `analytics.layout.render.test.tsx:185`, `:204` | h1 `AI calls & usage (detail)` |
| `evaluateHealth.test.ts:356` | `…, open in AI calls & usage$` |
| `evaluateHealth.test.ts:645-659` | `LINKED` gains `bos_ai_spend`. New cases: the spend tile's `pageLink` equals `FINANCE_PAGE_LINK` (`/admin/finance`, "Charged AI cost: open Finance"), read or failed; the two figure links still go to `/admin/analytics?scope=bos&…` with their own windows (AC-196) |
| `health.render.test.tsx` | Fixture `:97` label updated. New case: a spend tile with that `pageLink` renders `page-link` with the text and href. "A tile without a page link renders none" (`bos_ai_failures`) is unchanged |
| `aiCostVocabulary.source.guard.test.ts` | See [Guards](#guards) |
| `layoutFolder.guard.test.ts` | See [Guards](#guards) |
| `contrast.lf1.source.guard.test.ts` | See [Guards](#guards) |

### New

| Test | What |
|---|---|
| Pin C + helper (Step 0, frozen) | AC-188 |
| Pin D (Step 0, frozen) | AC-197, AC-198 |
| `chargeChecks.page.render.test.tsx` | One h1 `Charge checks`; a neutral `Read-only` chip; purpose = `COSTS_INTRO`. The report reads once on first load with no click (AC-189); `costs-periods` and the Leak check panel ("Run leak check") render (AC-187). A preset click writes `?range=7d` via `replaceState(null, …)` with no `tab`; picking a business writes `account` (AC-189). An inbound `?tab=costs&range=7d&account=A` reads 7 days for A once (AC-191 landing). A source check: the page is `'use client'`, wraps in `Suspense`, renders `<CostsTab />` with **no** `active` prop, and imports no `useSearchParams` / `history` / `router` (CC-3) |
| `chargeChecksRedirect.config.test.ts` | See [The redirect](#the-redirect-for-old-links) |

### Must stay untouched and green

- The four frozen pins.
- `leakPanel.render`, `costFormat`, `costsFilters`, `page.render` (45 tests), `source.guard` (Business OS AI).
- `lastChanged.render`, `ledgerPanel.render`, `activityDrillDown`, `activityFilters`, `activityPresets`.
- `financePage.render`, `financeAccount.render`, `accountsTab.render`, `financeUrl*`, `useFinanceData.render`, finance `source.guard`.
- The analytics tests other than `analytics.layout`.
- `rules.config.test.ts`, `route.qa-edge.test.ts`, `route.test.ts` (health-summary), `qa-slice5.test.ts`.
- The Jobs tests (`jobsQueues.*`, `lib/admin/jobs/__tests__/*`, `lib/cron/__tests__/*`): none pins S-16 or S-17 (A-20).

---

## Guards

| Guard | Effect of M-5 | Action |
|---|---|---|
| `AdminSidebar.nav.test.ts` | New section; nested route listed | **Edit** (above). It stays a source scan |
| `business-os-llm/__tests__/nav.test.ts` | One match of `/admin/business-os-llm` in the sidebar file | Description pin edited; **no new comment may name that path** |
| `business-os-tiers/__tests__/nav.test.ts` | Checks Businesses → Plans & entitlements; Money sits before Businesses | None (no title between Businesses and its entry) |
| `layoutFolder.guard` C-14 (b) | New route | **New entry** `/admin/finance/charges (Charge checks)`: `app/admin/finance/charges/page.tsx`, `app/admin/business-os-llm/costsFilters.ts`, and the five `components/costs/*` files. Those six **leave** the Business OS AI entry (`:661`, `:681-685`), whose comment (`:646-656`) is updated. The analytics label `:545` → `/admin/analytics (AI calls & usage (detail))`. **New case:** no file is listed in two entries (AC-200, "once each"). The page imports `AdminPageHeader` by alias; no file has `<h1` or `.json(` |
| `MIGRATED_PAGES` (same file) | As above | As above |
| `contrast.lf1.source.guard` | Finance `walk('app/admin/finance')` picks up `charges/page.tsx` by itself | **Add** `'Charge checks': walk('app/admin/business-os-llm/components/costs')` (SA-Q63; 0 offences today, A-14). The walk test asserts the five costs files are found |
| `aiCostVocabulary.source.guard` | Charge checks page, `rules.ts`, `bosCronJobs.ts` | **Edit:** the header `:22-25` loses "skipped until M-5"; `FILES` + `app/admin/finance/charges/page.tsx`, `lib/admin/health/rules.ts`, `lib/cron/bosCronJobs.ts` (whole file: after S-16 and S-17 it has no offence, A-17), so 14 → 17. New `MIN_TEXTS` entries are measured with the guard's own function after the edit (expected: `rules.ts` 184, `bosCronJobs.ts` 580, page about 3). The existing floors hold (`costCopy.ts` stays 44 by the rename; `evaluateHealth.ts` rises). `NEW_TEXTS`: W-19a, W-19b, W-21c rewritten to the S-9, S-12 words; new rows S-5, S-6, S-7, S-8, S-10, S-12 (`:66`, `:681`), S-13, S-14 (four), S-15 (three), S-16, S-17. `OLD_TEXTS`: `AI cost & usage` (exact, all files), the three old rule descriptions, the four old metric labels, the two old cron strings, `Costs & credits` (exact), and the old W-21c / W-19b. `FORBIDDEN` is unchanged and `ALLOWED` stays empty (AC-199) |
| `app/admin/finance/__tests__/source.guard` | The walk includes `charges/page.tsx` | None. It is `'use client'`, writes no URL, has no repository, no `console` and no `lib/business-os/finance` import |
| `business-os-llm/__tests__/source.guard` (G-1 to G-8) | The costs folder is unchanged; `page.tsx` loses imports | None. "No `@/lib/`" still covers the costs files (SA-Q59) |
| `lib/business-os/finance/__tests__/finance.source.guard` | Not touched | None |
| `financeLinks` import rule ("imports only the wire types") | Literal paths only | None |
| Frozen pins (AC-173 pin and helper, Pin A, Pin B) | Not opened | Hashes at Step 0 and at handover |
| `test:authz-guard` (R8 and others) | A new `'use client'` page; no `route.ts`; no `requireAdmin` change | Run, expected green with no edit |
| `test:bos-entitlements` | `BusinessOsPanel.tsx` sits in `app/admin/users`, which is in the suite; no entitlements import is added or changed (`rules.ts` and `evaluateHealth.ts` import none, A-19) | Run, expected green with no edit |
| `lint:hooks` | Hooks removed from `page.tsx`; the new page has none | Run |
| `enforcementPoints` registry | Only `app/api/admin/health-summary/route.ts` is registered; it is untouched | None |

---

## AC mapping

| AC | Proof |
|---|---|
| **AC-184** sidebar order and Money's three entries; Monitor's four | `AdminSidebar.nav.test` order, Monitor and Money lists |
| **AC-185** no action page in Money | nav test absent-list case |
| **AC-186** Business OS AI description, no "cost" | `business-os-llm/nav.test` + nav test case |
| **AC-187** Charge checks h1, badge, purpose, report, Leak check; sidebar highlights it | `chargeChecks.page.render`; exact href `/admin/finance/charges` in the nav test (highlight is `pathname === href`, A-2); browser look L-130 |
| **AC-188** same report request, same Leak check request | **Pin C**, green on `98735db9` (old page at `?tab=costs`) and after (Charge checks), file and helper unedited (hashes) |
| **AC-189** reads on first load; window and business written to its own URL | `chargeChecks.page.render`; re-targeted `costsLayout.render` C-2 to C-5 |
| **AC-190** two tabs; no Costs tab, panel or purpose; Activity unchanged | `costsTab.render` page block; `activityLayout` T-1, T-2; `settingsLayout`; `tabCoexistence` X-4 to X-11 as kept; `activityLayout` URL contract tests unedited |
| **AC-191** old link lands with window and business; temporary | `chargeChecksRedirect.config.test` (shape, `matchHas`, `prepareDestination`, parse back); `chargeChecks.page.render` inbound `?tab=costs&range=7d&account=A`; `curl -sI` (step 8); L-131 |
| **AC-192** no redirect for no tab, `settings`, `activity` | Redirect test negative cases; `activityTab.render:648` (old value opens Settings) |
| **AC-193** both Finance links go to the new path; no `?tab=costs` link left | `financeLinks.test`, `recordedCost.render`; the grep of [Every in-app link](#every-in-app-link-to-the-old-tab) re-run at handover, with the result in Implementation Notes |
| **AC-194** AI calls page h1 = sidebar label; URL and content unchanged | `analytics.layout.render` h1; nav test S-1; Pin A (`AnalyticsKpis` HTML) unedited and green |
| **AC-195** S-1 to S-17 read as new; nothing else changes | Vocabulary guard `NEW_TEXTS` / `OLD_TEXTS`; nav tests; `git diff` reviewed against the table |
| **AC-196** Health spend tile page link; figure links unchanged; others unchanged | `evaluateHealth.test` (`LINKED`, link value, figure hrefs); `health.render` new case |
| **AC-197** rule ids, colours, priorities, thresholds, metric ids unchanged; same statuses | **Pin D**; `evaluateHealth.test`, `rules.config.test`, `route.qa-edge.test` unedited and green |
| **AC-198** cron key, path, schedule, count keys unchanged | **Pin D** part 3; `lib/cron` and Jobs tests green |
| **AC-199** vocabulary guard scans `rules.ts`, S-16/S-17, Charge checks; `ALLOWED` empty | Vocabulary guard edits; mutations M-7, M-8 |
| **AC-200** C-14 entry; files once each; contrast and finance guards pass | `layoutFolder.guard` new entry + uniqueness case; contrast "Charge checks" key; finance `source.guard` |
| **AC-201** no API, repository, read, payload (beyond `pageLink`) or migration change; authz and entitlements suites pass | `git diff --stat -- app/api lib/repositories supabase` empty; `lib/` diff limited to the three files; `test:authz-guard`, `test:bos-entitlements` |
| **AC-202** admin-only through the layout | R8 (`test:authz-guard`) walks the new page; finance `source.guard` "no route.ts under app/admin"; the page is under `app/admin` (layout `requireAdminPage`); browser look as a non-admin is optional (L-130) |
| **AC-203** browser look L-128 to L-136 | Verification step 10, by the user after merge (BD-33) |

---

## SA-W questions

1. **SA-W1. The stray `tab=costs` after the redirect (SA-Q60 follow-on).** Next merges the request query into the destination and cannot drop a key (A-10). The page cannot strip it either, because the finance `URL_WRITER` guard forbids a page-side history write (A-11), and the hook keeps unknown keys by design (A-7). **Default:** leave it. It is harmless, ignored by Charge checks, and pinned by one `costsLayout` case. Alternatives: a middleware rewrite, which is new code on the auth path, or a hook option to drop foreign keys, which is a shared API change. Neither is proposed.
2. **SA-W2. Pin C mounts whichever page exists.** It uses `fs.existsSync('app/admin/finance/charges/page.tsx')` and `require()`, so one frozen file proves AC-188 across the change (the AC-173 "same file on either side" discipline). The cost is one `require()` with an `any` result, commented per CLAUDE.md rule 6, and a dead branch after M-5. **Default:** this design. Alternative: freeze only a standalone `CostsTab` pin plus a temporary, uncommitted old-page run recorded in the notes. That is weaker, because the page's own wiring (`active` default) would not be pinned across the change.
3. **SA-W3. The redirect test calls Next internals.** It imports `matchHas` and `prepareDestination` from `next/dist/shared/lib/router/utils/prepare-destination` (14.2.35) to prove matching and pass-through, not only the config shape. A Next upgrade that moves them fails the test loudly, which is acceptable. **Default:** yes. Alternative: shape-only, with behaviour left to the `curl` step and L-131.
4. **SA-W4. `COSTS_TAB_LABEL` renamed, not removed (S-6).** Removing it drops `costCopy.ts` to 43 visible texts, below the vocabulary floor of 44 (A-16). Lowering a floor is a slackening that SA rules on. **Default:** rename it to `CHARGE_CHECKS_TITLE = 'Charge checks'` and use it as the h1, so one constant serves both the h1 and the sidebar check.
5. **SA-W5. Where the re-targeted Costs tests live.** `costsLayout.render` and `costsTab.render` stay in `app/admin/business-os-llm/__tests__/` and import the new page. **Default:** stay (smallest diff, history kept, the components still live there). Alternative: `git mv` to `app/admin/finance/__tests__/`, which puts them under the F-5 `walkAll` test scan as well.
6. **SA-W6. Tests deleted with the Costs tab.** These need two filter tabs on one page, a situation that no longer exists:
   - `tabCoexistence` X-1, X-2, X-3, X-8, X-8b, X-10 and X-12;
   - `costsTab.render` "switching tabs keeps the chosen window".

   X-4, X-5, X-6, X-7, X-9 and X-11 are kept and adapted to Settings ↔ Activity, so the L-9a code that stays is still covered. **Default:** delete as listed, with the reason in the file header. Confirm.
7. **SA-W7. `ANALYTICS_WHAT 'AI cost and usage'`** (`AnalyticsFilterBar.tsx:49`) names the page in its bar and state copy, but it is not in S-1 to S-17, and AC-195 says no other visible string changes. **Default:** leave it and record it as FU-M5-1. Alternative: add it as S-18, "AI calls and usage" (BA and SA, copy only).
8. **SA-W8. Live docs that point at the old tab** (A-24: ADMIN_IDENTIFICATION `:297-298`, CREDIT_PRICING `:235`, ENTITLEMENTS `:228`, `:265`). **Default:** repoint the four lines in this PR and add a Change History row to each doc. The Change History rows of past dates are not rewritten. These are doc edits only; no entitlements code is touched.
9. **SA-W9. The costs components' header comments** still say "the Costs & credits tab of the Business OS AI admin page". **Default:** leave them, so that `git diff -- app/admin/business-os-llm/components/costs` stays empty as the proof of "mounted as it is". The new page and `page.tsx` headers state the move. Refresh the comments as FU-M5-2 when SA-Q59's later move happens.
10. **SA-W10. A repeated `tab` key.** Next matches the **last** `tab` value (A-10) and the page reads the **first**, so `?tab=activity&tab=costs` would redirect. No app link produces a repeated key. **Default:** accept and note it.
11. **SA-W11. Icon for Charge checks.** `UserCheck` (already imported; used only by a hidden parked entry). Confirm, or name another imported icon.

---

## Verification Plan

Each suite is run alone (the jobsQueues and creditsBlock load flakes pass alone, per SA-CR-M4A).

1. **Step 0 evidence (unchanged `98735db9`):**
   - `npx jest app/admin/finance/__tests__/chargeChecksRequest.pin.render.test.tsx lib/admin/health/__tests__/m5WordingOnly.pin.test.ts --ci`, which must be green (Pin C mounts the old page at `?tab=costs`);
   - record the pass counts and the SHA-256 of Pin C, its helper and Pin D;
   - recompute the four existing hashes (AC-173 pin and helper, Pin A, Pin B).
2. **Health:** `npx jest app/admin/__tests__ --ci` (health render and layout, vocabulary, contrast, `jobsQueues.*`).
3. **Finance:** `npx jest app/admin/finance --ci` (Pin C, AC-173, Pin B, page, redirect, links).
4. **Business OS AI:** `npx jest app/admin/business-os-llm --ci`.
5. **AI calls page:** `npx jest app/admin/analytics --ci`.
6. **Components:** `npx jest app/admin/components --ci` (nav, C-14, Pin A).
7. **Cron and Jobs, Health libs and routes:** `npx jest lib/admin/health lib/admin/jobs lib/cron app/api/admin/health-summary app/api/admin/jobs-queues --ci`; also `npx jest app/admin/users --ci` (S-11) and `npx jest app/admin/business-os-tiers/__tests__/nav.test.ts --ci`.
8. **Redirect by hand:** with `npm run dev`, run `curl -sI "http://localhost:3000/admin/business-os-llm?tab=costs&range=7d&account=<uuid>"`, which must give `307` and `Location: /admin/finance/charges?tab=costs&range=7d&account=<uuid>`. `?tab=activity` and no `tab` must give no redirect (the admin layout's own response). Record both in Implementation Notes.
9. **Suites:**
   - `npm run test:authz-guard`;
   - `npm run test:bos-entitlements` (`app/admin/users` is in it);
   - `npm run lint:hooks`.
10. **Scoped `tsc --noEmit`:**
    - Write a tsconfig to the scratchpad, **outside the worktree**. It extends the repo `tsconfig.json` and includes every changed and new `.ts` / `.tsx` file plus `AccountSummary.tsx`, `RecordedCostLines.tsx`, `HealthTile.tsx` and `CostsTab.tsx` (callers of the changed exports).
    - Run it once with a planted canary (`const canary: number = 'x'`), which must fail, then without it, which must pass.
    - Delete the canary and the config.
11. **Mutations** (scratchpad runner; each file restored and its checksum re-checked). Each must fail a named test:
    - M-1: drop `has` from the redirect (redirect test: `tab=activity` matches);
    - M-2: `permanent: true` (redirect shape);
    - M-3: `costsHref` keeps `tab=costs` (financeLinks);
    - M-4: put `['costs', …]` back in `TABS` (costsTab page block, activityLayout T-2);
    - M-5: render `<CostsTab active={false} />` on Charge checks (page test, AC-189: no first read);
    - M-6: Charge checks before Finance in Money (nav test);
    - M-7: put "Spend tripled vs yesterday" back in `rules.ts` (vocabulary `OLD_TEXTS`);
    - M-8: put "AI spend" back in `bosCronJobs.ts:452` (vocabulary `FORBIDDEN`);
    - M-9: change `factor: 3` to `factor: 2.9` in `rules.ts` (Pin D);
    - M-10: list `CostsTab.tsx` in both C-14 entries (uniqueness case);
    - M-11: add a comment naming `/admin/business-os-llm` in the sidebar (business-os-llm nav "exactly one");
    - M-12: change the default window in `costsFilters.ts` to 7 days (Pin C).
12. **`git diff --stat` and `git status` before handover:**
    - only the listed files change;
    - `git diff --stat -- app/api lib/repositories supabase app/admin/components/layout app/admin/business-os-llm/components/costs` is empty;
    - no deletion without insertion (the truncation check);
    - the six pin hashes (four existing plus C and D, and C's helper) equal Step 0;
    - the grep from [Every in-app link](#every-in-app-link-to-the-old-tab) finds no `tab=costs` outside tests and `next.config.js`.
13. **The user's read-only browser look (AC-203, after merge, BD-33)**, L-128 to L-136:
    - sidebar Monitor / Money / Businesses / Settings;
    - Money order and labels;
    - Charge checks loads its report and Leak check, and is highlighted;
    - an old `?tab=costs&range=7d&account=…` bookmark lands on Charge checks with 7 days and that business;
    - Business OS AI shows Settings and Activity only;
    - Finance's "Charge checks" and "Leak check" links;
    - the "AI calls & usage (detail)" h1;
    - the Health spend tile's "Charged AI cost: open Finance" link and the reworded rule list;
    - the Jobs page leak-check row wording.

---

## Risks

| Risk | Mitigation |
|---|---|
| The report request changes in the move | Pin C (old page and new page, same literals), frozen; the costs folder is not edited |
| A frozen pin is opened or drifts | Hashes at Step 0 and at handover; no planned edit; SA-Q59 "stay" keeps Pin A's import valid (A-22) |
| The redirect catches more than `tab=costs` | Anchored `has` value; negative cases in the test; M-1 |
| The redirect becomes permanent and is cached | `permanent: false` asserted; M-2 |
| Old bookmarks lose the window or business | Next pass-through proven through its own `prepareDestination`, with the keys parsed back; the inbound page case; `curl` |
| The nav parser silently skips an item | `name:` and `href:` kept adjacent; the existing parser self-check (`:176-178`) |
| A sidebar comment names `/admin/business-os-llm` | Called out in Step 5; M-11 |
| `costCopy.ts` floor drops | Rename, not removal (SA-W4) |
| Health rule semantics change under a wording edit | Pin D; mutation M-9 |
| L-9a regressions on the Business OS AI page after the tab removal | Kept and adapted `tabCoexistence` cases (X-4 to X-11), `activityLayout` URL tests unedited |
| The nested route breaks the "every page reachable" scan | `NESTED_LISTED` with an existence check |
| A stray `tab=costs` confuses a reader of the URL | SA-W1; harmless; pinned |
| Shared `node_modules` junction / other sessions' WIP | No `git stash`, no `git worktree remove`; requirement MDs untouched (they already carry TL's uncommitted §11H edits); `git diff --stat` before handover |

---

## Estimate

About **2 days** (§11H.2). **37 files**, plus this workplan:
- 6 new: 3 pin or pin-helper files, the page, and 2 tests;
- 12 modified product files;
- 16 modified test files;
- 3 docs.

| Work | Time |
|---|---|
| Step 0: Pin C (dual-mount) with its helper, and Pin D, green on `98735db9`; the four hashes | 0.35 d |
| Redirect and its test; Charge checks page and its test; `costCopy` rename | 0.35 d |
| Business OS AI tab removal and the six re-targeted / re-scoped Business OS AI test files | 0.5 d |
| Sidebar and nav tests; `financeLinks` and its tests; strings S-1 to S-17; Health link and tests | 0.4 d |
| Guards (vocabulary, C-14, contrast); docs pointers | 0.15 d |
| Verification, twelve mutations, `tsc` canary, `curl`, Implementation Notes | 0.25 d |

---

## Checklist

- ✅ SA review of §11H and this workplan; SA-Q58 to SA-Q64 and SA-W1 to SA-W11 answered (approved with conditions M5-R1 to M5-R4)
- ✅ Step 0: Pin C (+ helper) and Pin D written and green on unchanged `98735db9`; their hashes and the four existing hashes recorded
- ✅ Step 1: `next.config.js` R-1; redirect test green (shape block and Next 14.2.35 internals block, M5-R3)
- ✅ Step 2: `app/admin/finance/charges/page.tsx`; `CHARGE_CHECKS_TITLE`; Pin C green on the new side, unedited
- ✅ Step 3: Business OS AI two tabs; L-9a kept minus `costs`
- ✅ Step 4: `costsHref` / `leakCheckHref` at the new path
- ✅ Step 5: sidebar Money section, S-1 to S-4
- ✅ Step 6: S-5 to S-18 (S-18 per M5-R2); Health `FINANCE_PAGE_LINK`; Pin D green, unedited
- ✅ Step 7: test edits and new tests; vocabulary, C-14 and contrast guards; `tabCoexistence` per M5-R1
- ✅ Step 8: docs pointers (SA-W8)
- ✅ Step 9: verification steps 1 to 12; results in Implementation Notes
- ⬜ Step 10: hand to SA code review and QA; the user's browser look after merge (step 13)

---

## Implementation Notes

Implemented 2026-10-16 to 2026-10-17 on `feature/bos-money-m5` (base `98735db9`). Nothing is committed.

### Step 0 (M5-R4): the pins, on the unchanged tree

Pins C and D were written on `98735db9` before any product edit and run green:
- **Pin C:** 10/10 rows. It mounted the Business OS AI page at `?tab=costs&<state>`, because the new page did not exist yet. The helper self-check ran twice (once from the helper file, once through the pin's import), so the run reported 12/12.
- **Pin D:** 4/4. Its three hashes were recorded from that run and the file was frozen.

Every Pin C wait has an explicit 10 s timeout. Only `Date` is faked (`doNotFake` lists every timer).

| Pin | SHA-256 at Step 0 | At handover |
|---|---|---|
| Pin C `app/admin/finance/__tests__/chargeChecksRequest.pin.render.test.tsx` | `98ea05072007b028604e782e43a3cbbc3c0098d360a11a76491be88afc111e4b` | equal ✅ |
| Pin C helper `app/admin/finance/__tests__/chargeChecksRequestPins.ts` | `028133609122976f034c71bc841dde4b95c170a592862500bc6381ad2e545bd8` | equal ✅ |
| Pin D `lib/admin/health/__tests__/m5WordingOnly.pin.test.ts` | `1f7cf07af1ea07975badca277c903a5568793cd4e88ff49f83ff9cdff34af144` | equal ✅ |
| Pin A `KpiStrip.callers.pin.render.test.tsx` (unopened) | `30f5fc24f4e46870033ecdc984efa1c0647f633256f73ccfb302fa9899e62e01` | equal ✅ |
| Pin B `financeTiles.pin.render.test.tsx` (unopened) | `24ff0da7efb824ccc2b5d90687e34b3cd9da33803658dccf19c0d096ae56df9f` | equal ✅ |
| AC-173 pin `financeRequest.pin.render.test.tsx` (unopened) | `3a1a2dd415b3d0e0ffe44488a8c410b8e67a0bedf2ca908bbf064b6708bcf6f8` | equal ✅ |
| AC-173 helper `financeRequestPins.ts` (unopened) | `b84e0c961e60c994414af7b418dd7f9dc94273e45695d632956427fade68aabf` | equal ✅ |

Handover check: `sha256sum -c` against the Step 0 list gave seven OK. Pin C then ran green on the new side, mounting `/admin/finance/charges?<state>`, unedited: 10/10 rows, the same literals.

### What was built (Steps 1 to 8)

- **Redirect** (`next.config.js`): R-1 added after the payments redirect.
  - Shape block (2 cases) plus the "Next 14.2.35 internals … re-point or fall back to shape + curl" block (7 cases), per M5-R3: 9/9.
- **Charge checks** (`app/admin/finance/charges/page.tsx`): a client page; Suspense; `AdminPageHeader` ("Charge checks", Read-only, `COSTS_INTRO`); `<CostsTab />` with no `active`.
  - `COSTS_TAB_LABEL` was renamed to `CHARGE_CHECKS_TITLE` (SA-W4), so the `costCopy.ts` floor stays at 44.
- **Business OS AI** (`page.tsx`): two tabs; `costs` removed from `PageTab`, `TABS`, `PURPOSE`, `TAB_KEYS` and `ALL_TAB_KEYS`; the lazy-open state and the panel are gone. L-9a is otherwise unchanged (SA-Q61).
- **Links** (`financeLinks.ts`):
  - `costsHref` → `/admin/finance/charges?range…&account=…`;
  - `leakCheckHref` → `/admin/finance/charges[?account=…]`;
  - `activityHref` is unchanged in output.
- **Sidebar:** Monitor (4 entries); Money (Finance, Charge checks with `UserCheck`, AI calls & usage (detail)); Business OS AI description S-4.
- **Strings S-5 to S-18** as in the table, S-18 included (`ANALYTICS_WHAT` = "AI calls and usage", M5-R2). Health gained `FINANCE_PAGE_LINK` and its `tilePageLink` branch.
- **Docs (SA-W8):** four pointer lines repointed, one Change History row per doc, and "Last Updated" bumped in the three docs.

### Tests changed, and the tests deleted on purpose

- `tabCoexistence.render`, per M5-R1:
  - X-4, X-5, X-6, X-7, X-8, X-8b, X-9, X-10 and X-11 were kept and re-scoped to Activity ↔ Settings (10 cases, all green);
  - **deleted: X-1, X-2, X-3, X-12**, each named with its reason in the file header;
  - the Costs report fixture and its helpers went with them. This is the file's 86 insertions / 216 deletions.
- `costsTab.render`:
  - **deleted: "switching tabs keeps the chosen window and account, and does not re-read (CR-N2)"**, named in place;
  - the other page cases were re-targeted (Business OS AI shows two tabs and reads no report; Charge checks mounts the report; two tabpanels). This is the file's 27 insertions / 53 deletions.
- `costsLayout.render`: all 23 cases now mount Charge checks, and their URL expectations lose `tab=costs`. One new case pins that a stray `tab=costs` from the redirect is kept (SA-W1). 24 cases.
- `activityTab.render:648`: an old `?tab=costs` opens Settings, with no report read.
- `activityLayout` T-1 and T-2: two tabs.
- `settingsLayout`: the loop now covers Activity only.
- Also edited:
  - the nav tests;
  - `financeLinks.test`, which gained a new AC-193 source case;
  - `recordedCost.render`;
  - `analytics.layout` and `analytics.table` (h1 and S-18 words);
  - `evaluateHealth.test` (`LINKED` plus three R-5 cases);
  - `health.render` (one R-5 case);
  - the vocabulary guard (18 files; NEW and OLD rows for S-5 to S-18);
  - C-14 (Charge checks entry, plus a one-entry-per-file case);
  - contrast (the "Charge checks" key).
- New: `chargeChecks.page.render` (8 cases) and `chargeChecksRedirect.config` (9 cases).

### Verification (each command run alone; real results)

| # | Command | Result |
|---|---|---|
| 2 | `npx jest app/admin/__tests__ --ci` (Health, vocabulary, contrast, `jobsQueues.*`) | 15 suites, **585/585** |
| 3 | `npx jest app/admin/finance --ci` | 19 suites, **564/564** |
| 4 | `npx jest app/admin/business-os-llm --ci` | 17 suites, **850/850** (854 before: −5 deleted, +1 new) |
| 5 | `npx jest app/admin/analytics --ci` | 8 suites, **191/191** |
| 6 | `npx jest app/admin/components --ci` | 24 suites, **816/816** |
| 7 | `npx jest lib/admin/health lib/admin/jobs lib/cron app/api/admin/health-summary --ci` | 22 suites, **773/773** |
| 7 | `npx jest app/api/admin/jobs-queues --ci` | 7 suites, **384/384** |
| 9 | `npm run test:bos-entitlements` | 280 suites, **8472/8472** |
| 9 | `npm run test:authz-guard` | 2 suites, **203/203** |
| 9 | `npm run lint:hooks` | clean (0 problems, `--max-warnings 0`) |
| 9 | `npx eslint <35 touched .ts/.tsx> next.config.js` | exit 0, 0 problems. Two unused constants in `tabCoexistence` were removed first |
| 10 | Scoped `tsc --noEmit` | Config in the session scratchpad (outside the worktree), extending the repo `tsconfig.json`, 39 files: every changed or new `.ts` / `.tsx`, plus `AccountSummary.tsx`, `RecordedCostLines.tsx`, `HealthTile.tsx` and `CostsTab.tsx`. With the canary (`const canary: number = 'x'`): exit 2, only `TS2322` on the canary. Without it: exit 0. Canary and configs deleted |

**Flake noted, not caused by M-5:** when step 7's two halves run as one command, `app/api/admin/jobs-queues/__tests__/qa-slice5-pr2.route.test.ts` "non-admin with parameters and hung reads: 403 immediately" failed twice on its wall-clock limit (`< 1000` ms, received 1344 ms). The file is untouched by M-5. It passes alone (11/11) and in the split run above (384/384). It is the known load flake class (SA-CR-M4A).

### Step 8: the `curl -sI` check (M5-R3)

Dev server `npx next dev -p 3157` in this worktree, stopped afterwards:

| Request | Result |
|---|---|
| `/admin/business-os-llm?tab=costs&range=7d&account=11111111-…-111111111111` | `307 Temporary Redirect`, `location: /admin/finance/charges?tab=costs&range=7d&account=11111111-…-111111111111` |
| `/admin/business-os-llm?tab=costs` | `307`, `location: /admin/finance/charges?tab=costs` |
| `?tab=activity&range=7d`, no query, `?tab=settings` | **No redirect** (no 307, no `location`). The app answered 500 because this worktree's dev server has no Supabase env ("Your project's URL and API key are required"; `/` failed the same way). The redirect behaviour is what is checked |

### Mutations (scratchpad runner; each file restored and its SHA-256 re-checked)

All 11 run were caught:

| Mutation | Caught by | Failures |
|---|---|---|
| M-1 drop `has` from the redirect | redirect test | 5 |
| M-2 `permanent: true` | redirect test | 1 |
| M-3 `costsHref` sets `tab=costs` | `financeLinks.test` | 6 |
| M-4 `writeTabToUrl` stops restoring saved keys | `tabCoexistence` (re-scoped X-4, X-6, X-8, X-10) | 4 |
| M-5 `<CostsTab active={false} />` on Charge checks | `chargeChecks.page.render` | 4 |
| M-7 "Spend tripled vs yesterday" back in `rules.ts` | vocabulary guard | 2 |
| M-8 "AI spend" back in `bosCronJobs.ts` | vocabulary guard | 3 |
| M-9 factor 3 → 2.9 | Pin D | 1 |
| M-11 a sidebar comment naming `/admin/business-os-llm` | `business-os-llm/nav.test` | 1 |
| M-12 Costs default window 30d → 7d | Pin C | 4 |
| M-13 Health spend page link removed | `evaluateHealth.test` | 2 |

M-6 (Money order) and M-10 (a duplicate C-14 file) were not run. They are covered by exact-list assertions (the Money `toEqual` and the new uniqueness case).

### Diff checks at handover

- `git diff --stat` on `app/api`, `lib/repositories`, `supabase`, `app/admin/components/layout/KpiStrip.tsx`, `app/admin/business-os-llm/components/costs`, `costsFilters.ts`, `costTypes.ts`, `costFormat.ts`, `leakCopy.ts` and `leakTypes.ts`: **empty**.
- `lib/` changes:
  - wording in `rules.ts` (7/7) and `bosCronJobs.ts` (2/2);
  - `lib/admin/health/evaluateHealth.ts` (14/3): S-12 wording plus S-13 / R-5 `FINANCE_PAGE_LINK`;
  - tests: `evaluateHealth.test.ts` (edited) and Pin D (new).
- No file shows a deletion without an insertion. The two deletion-heavy files are the intentional test deletions named above.
- `grep tab=costs` over `app lib components hooks middleware.ts next.config.js`, outside tests: comments only (`business-os-llm/page.tsx:53`, `finance/charges/page.tsx:12`, `next.config.js:82`). There is no link left (AC-193).

### Deviations from the plan (for SA)

1. **`lib/admin/health/evaluateHealth.ts` changes, not only `rules.ts` and `bosCronJobs.ts`.** S-12 (three wordings) and S-13 / R-5 (the Finance page link) live there, as the plan and §11H.5 say. No rule, metric, id or read changed. Pin D proves the rules side.
2. **The vocabulary guard scans 18 files, not 17.** `AnalyticsFilterBar.tsx` was added for S-18's NEW/OLD rows (M5-R2). Its floor of 50 was measured with the guard's own scanner. No forbidden phrase is in it.
3. **The new floors** are `rules.ts` 184, `bosCronJobs.ts` 580, Charge checks page 2 and `AnalyticsFilterBar.tsx` 50. Existing floors are unchanged. `evaluateHealth.ts` now has 220 texts against its floor of 217.
4. **The re-scoped X-6** uses `keep=1` only (no `actionId`), because Activity reads `actionId` for its drill-down. With a Costs → Activity path this was harmless; with Activity first it would open a drawer.
5. **Docs:** "Last Updated" was bumped to 2026-10-16 in the three docs, alongside the Change History rows.

### Open points for SA / QA

- The browser look L-128 to L-136 is the user's, after merge (BD-33).
- FU-M5-2 (costs component header comments and the later file move) stays open, per SA-W9.

---

## SA Review Notes

### SA Workplan Review

**Reviewed by SA — 2026-10-16, against `98735db9`. This also serves as the SA requirement review of §11H (SA-RR-M5).**
**Status:** ✅ **APPROVED WITH CONDITIONS** (M5-R1 to M5-R4). It is held to the full standard: it moves a page, adds a redirect and edits Health rule wording. SA applied E-63 and E-64 to §11H.

**Checked against the code**
- **Admin gate.** `app/admin/layout.tsx` runs `requireAdminPage()` for every page under `/admin` (route-tree property, "page 23 is guarded before its author writes a line"). The new `app/admin/finance/charges/page.tsx` is a client page under it, the same shape as `app/admin/finance/page.tsx` (R8). Its data comes from the existing `/api/admin/business-os/credits/report` and leak-check routes, which already `requireAdmin`. No route is added. The redirect only moves a gated URL to a gated URL (AC-202).
- **C-14 and `MIGRATED_PAGES`.** There is a new entry for `/admin/finance/charges`. The page, `costsFilters.ts` and the five `components/costs/*` files move out of the Business OS AI entry, and a new uniqueness case checks each file is listed once. This is right.
- **Nav count 28 → 29 is correct.** Exactly one new href (`/admin/finance/charges`); Finance and analytics move sections, keeping their hrefs. `NESTED_LISTED` with an existence check handles the one-level scan (CF-3).
- **Health rules are wording only.** The rules are code constants (`rules.ts` header: "a description edit is a data edit"). The evaluator only checks that a description is non-empty and does not say "OK" (`evaluateHealth.ts:261-262`); none of the new wordings does. No description is persisted. Pin D (rules with descriptions blanked, metric labels blanked, the cron entry with description and labels blanked) proves ids, priorities, colours, conditions, cron key, path, schedule and count keys are unchanged.
- **`test:bos-entitlements` must run**, because `app/admin/users` (S-11) is in the suite. It is in the plan (step 9).
- **Callers.** `ANALYTICS_WHAT` is used only by `AnalyticsFilterBar` and `analytics/page.tsx`, not by `AnalyticsKpis`, so renaming it does not touch Pin A (W7).
- **The four frozen pins stay untouched** under SA-Q59 "stay": Pin A imports `CostsKpis` from its current path.
- **The AC mapping is complete** (AC-184 to AC-203). Canaries are in steps 10 and 11. **The estimate of about 2 days is accepted.**

**Rulings: requirement questions**

| # | Ruling |
|---|---|
| SA-Q58 | **Its own Money entry**, directly under Finance. It is its own route and the sidebar highlights by exact path. |
| SA-Q59 | **Stay.** The costs files are imported from `app/admin/business-os-llm/`; a move is a later clean-up (FU-M5-2). This keeps Pin A valid and `git diff -- …/components/costs` empty, which proves "mounted as it is". |
| SA-Q60 | **A `next.config.js` temporary redirect.** A client redirect would render Business OS AI first; middleware is new code on the auth path. |
| SA-Q61 | **Keep L-9a minus the `costs` entries.** Smallest diff, not a new pattern. |
| SA-Q62 | **"AI calls & usage (detail)" in both the h1 and the sidebar** (LAY D-3 (a)). Links elsewhere say "AI calls & usage". |
| SA-Q63 | **Add the "Charge checks" contrast key now** (0 offences today). |
| SA-Q64 | **No window.** Finance opens at its default, This month; the tile's own figures keep their windows through their links. |
| SA-Q-4 (CR) | **Confirmed.** Mounting `CostsTab` alone with its default `active` is not a new pattern. |

**Rulings: workplan questions**

| # | Ruling |
|---|---|
| **SA-W1** | **Leave the stray `tab=costs`; it is harmless on Charge checks.** `CostsTab` owns only `range`/`from`/`to`/`account`, and the hook keeps unknown keys by design (U-2). Nothing on the page reads `tab`. The sidebar highlight is an exact **pathname** match, so the query is irrelevant. Sending the link back to Business OS AI can never re-open Costs, because that tab no longer exists. Stripping it would need middleware or a shared hook option, both disproportionate. The planned `costsLayout` case pins it. |
| **SA-W2** | **Approved.** Pin C mounts whichever page exists, with a commented `require()` (CLAUDE.md rule 6), so one frozen file proves AC-188 across the change. |
| **SA-W3** | **Approved, with M5-R3.** `matchHas` and `prepareDestination` are Next's own matcher and pass-through, so they test the real behaviour; a shape-only test could not prove the window and business arrive. The brittleness is acceptable because it fails loudly on a Next upgrade. **M5-R3:** keep the config-shape assertions in their own `describe`, independent of Next internals. Put the installed Next version (`14.2.35`) and "Next internals: re-point or fall back to shape + curl" in the internals `describe` title, so an upgrade failure explains itself. Record the `curl -sI` result (step 8) in Implementation Notes. |
| **SA-W4** | **Rename (approved).** `CHARGE_CHECKS_TITLE` serves the h1. A floor is never lowered to make room for a deletion. |
| **SA-W5** | **Stay** in `business-os-llm/__tests__/`, beside the components they test. |
| **SA-W6** | **Not as listed: some coverage would be lost (M5-R1).** X-8 (revisit before sync), X-8b (a change in the lag window is kept) and X-10 (rapid switches, one write per click) test L-9a timing that **still exists** between Activity and Settings: Activity → Settings → Activity inside the sync lag. They are re-scoped to that pair, not deleted. **Deleted, correctly, because they need two filter tabs:** X-1, X-2, X-3 and X-12, plus `costsTab.render` "switching tabs keeps the chosen window". The file header names each deleted case and its reason. |
| **SA-W7** | **Rename it now, as S-18 (E-63):** `ANALYTICS_WHAT` → `'AI calls and usage'`. It is visible copy on that page ("Reading AI cost and usage…", the error fallback), and the M-5 vocabulary goal is the page's new name. It is outside Pin A. Update the analytics tests that pin the old text, and add NEW/OLD rows in the vocabulary guard. |
| **SA-W8** | **Approved:** repoint the four live doc lines, and add a Change History row to each doc. Do not rewrite historic rows. |
| **SA-W9** | **Approved:** leave the costs components' header comments (FU-M5-2). |
| **SA-W10** | **Accepted and noted.** No app link produces a repeated `tab`. |
| **SA-W11** | **`UserCheck` approved** (already imported). |

**Required changes (SA verifies at code review)**
1. **M5-R1 (Medium).** `tabCoexistence`: re-scope X-8, X-8b and X-10 to Activity ↔ Settings; delete only X-1, X-2, X-3 and X-12 (plus the one `costsTab` case), each named with its reason in the file header (E-64).
2. **M5-R2 (Low).** S-18 `ANALYTICS_WHAT` = `'AI calls and usage'`, with the pinned tests and vocabulary rows (E-63).
3. **M5-R3 (Low).** Split the redirect test into a shape block and a Next-internals block (version in the title), and record the `curl` result.
4. **M5-R4 (Medium).** Pins C (with its helper) and D are frozen. Their SHA-256 values are recorded at Step 0 and again at handover, and must be equal. Every render wait has an explicit 10 s timeout from the start. The four existing hashes stay unchanged (`3a1a2dd4…`, `b84e0c96…`, `30f5fc24…`, `24ff0da7…`).

**Requirement edits (SA applied)**
- **E-63 (§11H.5, AC-195).** New row: "S-18 | AI calls page bar and state noun `ANALYTICS_WHAT` (`AnalyticsFilterBar.tsx:49`) | `AI cost and usage` | `AI calls and usage` (SA-W7)". AC-195 now reads S-1 to S-18.
- **E-64 (§11H.6, Business OS AI page tests row).** Appended: "`tabCoexistence`: X-4 to X-11 kept, with X-8, X-8b and X-10 re-scoped to Activity ↔ Settings (the L-9a lag-window behaviour still exists); only X-1, X-2, X-3 and X-12 and `costsTab.render` 'switching tabs keeps the chosen window' are deleted, because they need two filter tabs (SA-WP-M5, M5-R1)."

_SA populates this section._

### SA Code Review

**Code Review by SA — 2026-10-17** (uncommitted on `feature/bos-money-m5`)
**Status:** ✅ **Code Approved.** No conditions. Nothing blocks QA or TL.

**1. The conditions**
- **M5-R1.** `tabCoexistence` keeps X-4 to X-11. X-8, X-8b and X-10 are re-scoped to Activity ↔ Settings in the lagging mode (revisit before sync, a change in the lag window, rapid switches), so the L-9a timing coverage that still applies is kept. Only X-1, X-2, X-3, X-12 and the one `costsTab` case are deleted, each named with its reason in the file header.
- **M5-R2.** `ANALYTICS_WHAT` = `'AI calls and usage'` (S-18), with the analytics tests and vocabulary rows updated.
- **M5-R3.** The redirect test has a shape-only `describe` and a separate "through Next 14.2.35 internals … re-point or fall back to shape + curl" `describe`. The `curl` result (307 to `/admin/finance/charges` with the window and business kept; no redirect for `tab=activity`, `tab=settings` or no query) is recorded in Implementation Notes.
- **M5-R4.** SA recomputed every hash, and all equal the reported and frozen values:

  | Pin | SHA-256 |
  |---|---|
  | Pin C | `98ea0507…1e4b` |
  | Pin C helper | `02813360…5bd8` |
  | Pin D | `1f7cf07a…f144` |
  | Pin A | `30f5fc24…2e01` |
  | Pin B | `24ff0da7…df9f` |
  | AC-173 pin | `3a1a2dd4…f6f8` |
  | AC-173 helper | `b84e0c96…aabf` |

**2. `evaluateHealth.ts` (+14/−3): link and wording only.** The diff is:
- three strings, "AI cost & usage" → "AI calls & usage" (S-12);
- the new `FINANCE_PAGE_LINK` constant;
- one `tilePageLink` branch, `if (id === 'bos_ai_spend') return FINANCE_PAGE_LINK;`.

There is no change to a rule, condition, metric, threshold, id, colour or green rule. The only change to Health's computed result is that tile's `pageLink` value, which AC-201 allows. Pin D (rules, metrics and the cron entry with wording blanked) and the unedited `rules.config`, `route.qa-edge` and health-summary route tests prove that statuses and matched rule ids are unchanged. `rules.ts` and `bosCronJobs.ts` change wording only (S-14 to S-17).

**3. Deviations**

| Deviation | Ruling |
|---|---|
| The vocabulary guard scans 18 files (`AnalyticsFilterBar.tsx` added) | ✅ **Approved.** That is where S-18 lives; scanning it keeps the old noun from coming back. |
| X-6 re-scoped to `keep=1` only | ✅ **Approved; no coverage lost.** In the old X-6, `actionId` was an *unrelated* key only from the Costs tab's point of view. On Activity it is the drawer's own key, so keeping it would test the drawer, not "unrelated keys survive". The Costs side of that case no longer exists. `actionId` behaviour itself stays covered by `activityDrillDown`, `activityFilters`, `activityLayout` and `activityTab`. |

**4. Verified**
- **Sidebar.** Monitor, **Money** (Finance, Charge checks, AI calls & usage (detail)), Businesses, Settings. Monitor is Health, Jobs, Audit trail and Archiving. The Business OS AI description is "Models, temperatures & AI activity". The nav tests pin 29 hrefs, and one new href is the correct delta.
- **C-14 and `MIGRATED_PAGES`.** There is an entry for `/admin/finance/charges (Charge checks)`, the costs files moved out of the Business OS AI entry, and the uniqueness case passes.
- **The costs files are not moved.** `git diff` is empty for `components/costs` and `costsFilters.ts`. The new page mounts `<CostsTab />` with no `active` prop, inside `Suspense`, under the admin layout's `requireAdminPage`.
- **Business OS AI has no costs tab.** `page.tsx` keeps only a comment naming `?tab=costs`. No product file links to `tab=costs` any more; `grep` finds only comments.
- **Links at source.** `costsHref` gives `/admin/finance/charges?…&account=` with no `tab`. `leakCheckHref` gives the bare path or `?account=`.
- **Nothing outside the page changes.** `git diff` is empty for `app/api`, `lib/repositories` and `supabase`, so there is no data, API or money change. No `console.*` and no `any` in the product files.

**5. The jobs-queues flake.** The file is `app/api/admin/jobs-queues/__tests__/qa-slice5-pr2.route.test.ts`, the case "non-admin with parameters and hung reads: 403 immediately". It has a wall-clock `< 1000` ms limit and failed at 1344 ms under load. **Not in this PR:** it is untouched, out of scope, and hardening it is a test-design change. Make it **one follow-up chip** with `bosLens.render` P-8 (SA-CR-F5), "harden load-sensitive timing tests for the merge queue". For this case, assert the 403 without a wall-clock bound, for example by checking that the hung reads are never awaited, or by using fake timers.

**6. SA re-run** (one suite at a time, own exit codes)

| Run | Result |
|---|---|
| `app/admin/finance` (incl. Pins B and C, the AC-173 pin, the redirect test) | exit 0, 19 suites, 564 tests |
| `app/admin/business-os-llm` | exit 0, 17 suites, 850 tests |
| `app/admin/components` (incl. Pin A, nav, C-14) | exit 0, 24 suites, 816 tests |
| Health (`lib/admin/health` incl. Pin D, health-summary route, `health.render`) | exit 0, 9 suites, 319 tests |
| `npm run test:bos-entitlements` | exit 0, 280 suites, 8472 tests |
| `npm run test:authz-guard` | exit 0, 2 suites, 203 tests |

**Code Approved for QA and TL: Yes**

---

## QA Testing Report

**QA — 2026-10-17**
**Test mode:** full
**Strategy used:** A + B (Jest unit, render and config tests; Next's own `matchHas` / `prepareDestination`), source checks, a scoped tsc with a canary. Browser look D is the user's (L-128 to L-136, BD-33).
**Focus:** ui, schema (pins), security (authz walk)
**Skipped:** live browser look (after merge, by the user); no live DB access was needed.
**Input source:** prompt keywords + workplan

### Suite runs (each suite alone, worktree, uncommitted tree)

| Suite | Result |
|---|---|
| `app/admin/__tests__` (Health) | 15/15 suites, 585/585 |
| `app/admin/finance` | 19/19, 564/564 |
| `app/admin/business-os-llm` | 17/17, 850/850 |
| `app/admin/analytics` | 8/8, 191/191 |
| `app/admin/components` | 24/24, 816/816 |
| `lib/admin/health lib/admin/jobs lib/cron app/api/admin/health-summary` | 22/22, 773/773 |
| `app/api/admin/jobs-queues` | 7/7, 384/384 |
| `app/admin/users` (BusinessOsPanel) | 26/26, 615/615 |
| `qa-slice5-pr2.route.test.ts` alone | 1/1, 11/11, 14.4 s |
| `qa-slice5-pr2` **alongside** `app/admin/__tests__` | 16/16, 596/596, 68.4 s: **no timeout this time**. The known load flake (FU-5a-3) did not show |
| `npm run test:bos-entitlements` | 280/280, 8472/8472 |
| `npm run test:authz-guard` | 2/2, 203/203 |
| `npm run lint:hooks` | exit 0, no output |

These match Dev's counts exactly.

**Pins (sha256, recomputed):** C `98ea0507…1e4b` ✅, C helper `02813360…5bd8` ✅, D `1f7cf07a…f144` ✅, A `30f5fc24…2e01` ✅, B `24ff0da7…df9f` ✅, AC-173 `3a1a2dd4…f6f8` ✅, AC-173 helper `b84e0c96…aabf` ✅.

**Scope:** `git diff --stat -- app/api lib/repositories supabase KpiStrip.tsx business-os-llm/components/costs costsFilters.ts` is empty. No file is deletion-only (`--numstat`).

**Scoped tsc:**
- Config in the scratchpad with an absolute `extends`. It includes `types/**` and all 35 changed or new `.ts`/`.tsx` files.
- A canary in `financeLinks.ts` gave `financeLinks.ts(144,7): error TS2322`.
- The file was restored with `cp` and checked with `cmp` (identical; diff stat back to Dev's 28+/22−).
- The clean run gives **0 errors**.

### Test Coverage

| AC | Verdict | Evidence |
|---|---|---|
| AC-184 | PASS | `AdminSidebar.nav.test`: section order, Monitor 4, Money 3 (green) |
| AC-185 | PASS | nav test absent-list case |
| AC-186 | PASS | `business-os-llm/nav.test` + nav test: description "Models, temperatures & AI activity" |
| AC-187 | PASS (code), browser look owed | `chargeChecks.page.render`. Highlight is `pathname === item.href` (`AdminSidebar.tsx:404`), so on `/admin/finance/charges` only Charge checks lights up (Finance does not) |
| AC-188 | PASS | Pin C green; Pin C and helper hashes unchanged; costs components and `costsFilters.ts` diff empty |
| AC-189 | PASS | page test: first-load read, `replaceState` with no `tab`. The page renders `<CostsTab />` with no `active` prop (`charges/page.tsx:33`) |
| AC-190 | PASS | `costsTab` page block, `activityLayout` T-1/T-2 (two tabs), `tabCoexistence` X-4..X-11 kept (X-5 `it.each` present; only X-1/2/3/12 removed, as M5-R1 allows) |
| AC-191 | PASS (code), L-131 owed | redirect test through Next's `matchHas` + `prepareDestination`: `range`, `from`, `to` and `account` arrive and parse back; `permanent: false` (`next.config.js:83-87`) |
| AC-192 | PASS | redirect negatives (`settings`, `activity`, none, `costsx`); `activityTab.render` `?tab=costs` opens Settings |
| AC-193 | PASS | `financeLinks.test`. Grep for `tab=costs` outside tests finds comments only (`business-os-llm/page.tsx:53`, `charges/page.tsx:12`) |
| AC-194 | PASS | `analytics.layout.render` h1; Pin A unchanged and green |
| AC-195 | PASS | vocabulary guard `NEW_TEXTS`/`OLD_TEXTS` green. Visible-string grep for "AI cost & usage" / "AI cost and usage" finds only JSDoc comments (14 files, e.g. `analyticsCall.ts:2`, `FinanceKpiStrip.tsx:75`), none rendered |
| AC-196 | PASS | `FINANCE_PAGE_LINK` (`evaluateHealth.ts:735-738`, `:746`); `evaluateHealth.test` + `health.render` green; figure links still go to analytics |
| AC-197 | PASS | Pin D green and its hash unchanged; `rules.ts` diff is labels and descriptions only. `rules.config`, `route.qa-edge` and health-summary tests unedited (not in `git status`) |
| AC-198 | PASS | Pin D part 3; cron and Jobs suites green |
| AC-199 | PASS | vocabulary guard green with the three files added; `ALLOWED` empty |
| AC-200 | PASS | `layoutFolder.guard` (new entry + uniqueness), contrast guard, finance `source.guard`, all green |
| AC-201 | PASS | scope diff empty; authz and entitlements green |
| AC-202 | PASS (code) | authz-guard R8 walks the page; the page is under `app/admin` (layout `requireAdminPage`); the redirect moves a gated URL to a gated URL |
| AC-203 | NOT-TESTED | browser look is the user's, after merge (BD-33); steps below |

### Edge cases checked

1. **Old `?tab=costs` with a window and a business.** It gets a 307 to `/admin/finance/charges` and keeps the whole query. The stray `tab=costs` stays in the URL (SA-W1, accepted) and is ignored by the Charge checks spec. Only an exact `costs` value matches.
2. **Business OS AI remaining tabs.** X-8, X-8b and X-10 are re-scoped to Activity↔Settings and green. X-4, X-5, X-6, X-7, X-9 and X-11 are green.
3. **Leak check on Charge checks.** It renders ("Run leak check"). Pin C rows 1/7 pin the leak request, including `accountId`. `leakCheckHref` → `/admin/finance/charges[?account=]`.
4. **Health tile.**
   - The figure and colour are unchanged (Pin D; `evaluateHealth` thresholds untouched).
   - The new page link is "Charged AI cost: open Finance" → `/admin/finance`, shown even when the read failed.
   - The `settingsMeasurement` link (`evaluateHealth.ts:577`) still goes to `/admin/business-os-llm` (Settings), which is correct.
5. **Sidebar active state** on `/admin/finance/charges` is exact-match, see AC-187.
6. **Finance → Charge checks links keep the window.** `costsHref` round-trips all five presets; `leakCheckHref` carries the account only (by design).
7. **No visible "AI cost & usage" left**, see AC-195.

### Issues Found

#### Bugs (must fix before commit)
None.

#### Performance Issues
None.

#### Edge Cases (nice to fix)
1. **Low.** After a redirect, the Charge checks URL keeps `tab=costs` until the first filter write (`next.config.js:83-87`, SA-W1 accepted). This is cosmetic only.
2. **Low, comments only.** 14 JSDoc comments still name "AI cost & usage" (e.g. `app/admin/analytics/analyticsCall.ts:2`, `lib/repositories/AdminTokenUsageAnalyticsRepository.ts:2`). Nothing is rendered. Optional tidy-up.

### Manual live steps (user, after merge; read-only)

- **L-128 Money section:** the sidebar shows Monitor (Health, Jobs, Audit trail, Archiving), then Money (Finance, Charge checks, AI calls & usage (detail)), then Businesses and Settings.
- **L-129 Labels:** Business OS AI reads "Models, temperatures & AI activity". No Money item is an action page.
- **L-130 Open Charge checks:**
  - h1 "Charge checks" with a Read-only chip;
  - the report loads with no click;
  - "Run leak check" works;
  - only Charge checks is highlighted;
  - picking 7 days writes `?range=7d` with no `tab`.
- **L-131 Old bookmark:** `/admin/business-os-llm?tab=costs&range=7d&account=<id>` lands on `/admin/finance/charges` showing 7 days for that business. `?tab=settings` and `?tab=activity` stay on Business OS AI.
- **L-132 Business OS AI tabs:** only Settings and Activity. Switch Activity → Settings → Activity: the Activity window is kept and no Costs panel appears.
- **L-133 Finance links:** "Charge checks" keeps the Finance window and business. "Leak check" carries the business only.
- **L-134 AI calls page:** the h1 "AI calls & usage (detail)" matches the sidebar.
- **L-135 Health tile:** the "Recorded AI cost" tile keeps the same figure and colour as before deploy. Its "Charged AI cost: open Finance" link opens `/admin/finance`. The rule list reads "Recorded AI cost tripled / doubled vs yesterday" and "… up 50% or more on the week".
- **L-136 Jobs page:** the leak-check cron row shows the new wording.

### Final Status
- [x] All acceptance criteria pass in code (AC-203 browser look owed by the user after merge). No bugs open. **QA PASS, ready for TL / RM.**
- [ ] Issues found — Dev must address before commit

---

## Commit Info

_RM populates this section._
