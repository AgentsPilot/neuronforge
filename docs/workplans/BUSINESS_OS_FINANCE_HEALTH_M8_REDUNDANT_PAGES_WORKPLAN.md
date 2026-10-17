# Workplan: Money M-8, mark the Platform dashboard and Exchange rates pages redundant

> **Last Updated**: 2026-10-17

**Developer:** Dev
**Requirement:** [BUSINESS_OS_FINANCE_HEALTH_REQUIREMENT.md](/docs/requirements/BUSINESS_OS_FINANCE_HEALTH_REQUIREMENT.md) §11J (AC-233 to AC-242, SA-Q75 to SA-Q80, BQ-14, FU-M8-1; BD-25, BD-33, BD-34); [ADMIN_COST_REVENUE_CONSOLIDATION_REVIEW.md](/docs/requirements/ADMIN_COST_REVENUE_CONSOLIDATION_REVIEW.md) §8 M-8 row, inventory I-15 and I-19, BQ-7; [ADMIN_LAYOUT_STANDARD_REQUIREMENT.md](/docs/requirements/ADMIN_LAYOUT_STANDARD_REQUIREMENT.md) §2.3 X-1, X-2, §3 rule 9, C-14
**Branch:** `feature/bos-money-m8` (from main `5c214310`)
**Worktree:** `neuronforge-finance-m8` (node_modules is a junction: no `git worktree remove`, no `git stash`)
**Date:** 2026-10-17
**Status:** Planning (workplan only; no code written; awaiting SA review of §11J and this workplan together)
**Path:** UI short path, about 1 day. Approval flow BD-33: SA, QA and TL approve, then RM commits, opens the PR and turns on auto-merge. No migration. BQ-14 has a default (show the notice), so nothing stops for the user.

## Overview

BD-34: the Platform dashboard (legacy) and Exchange rates admin pages are **kept, not deleted**. M-8 marks both, and the API route only the dashboard calls, as redundant in a header comment; removes the one product reference left (the dashboard's item in the hidden parked sidebar section); shows a one-line redundant notice on both pages; and adds a guard so nothing links to them again. No data, money, API logic, request or migration change.

---

## Table of Contents

- [Scope](#scope)
- [Analysis Summary](#analysis-summary)
- [Implementation Approach](#implementation-approach)
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
- [Change History](#change-history)

---

## Scope

**In scope (§11J.2):**

1. **Header comments (RP-1)** in `app/admin/platform-dashboard/page.tsx`, `app/admin/exchange-rates/page.tsx` and `app/api/admin/dashboard/route.ts`.
2. **Sidebar (RP-2).** Remove the Platform dashboard item from the hidden "AgentsPilot (parked)" section (15 → 14 items), drop the unused `LayoutDashboard` import, and reword three comments so the sidebar file names neither path. The visible sections do not change.
3. **Notice (RP-4)** on both pages, in every state, from the existing `AdminNotice`.
4. **Guard (RP-5)**: nothing in `app/`, `lib/`, `components/` or `hooks/` links to either page, and only the dashboard calls `/api/admin/dashboard`.
5. **Logging (RP-7)**: Exchange rates' one `console.error` (`exchange-rates/page.tsx:92`) to Pino. **Flagged per CLAUDE.md "Non-compliant files you touch": 1 `console.*` call in that file**; the dashboard page and the route have 0.
6. **Doc pointers**: the admin reorganisation requirement (U-6, S4-b) and ADMIN_IDENTIFICATION (register rows 22, 23) note BD-34.

**Kept intact:**
- **The frozen pins**, never opened. Hashes are of the git blob (LF), checked at Step 0 and at handover. Verified on `5c214310` while writing this plan; all seven match:

  | Pin | File | SHA-256 |
  |---|---|---|
  | AC-173 | `app/admin/finance/__tests__/financeRequest.pin.render.test.tsx` | `3a1a2dd415b3d0e0ffe44488a8c410b8e67a0bedf2ca908bbf064b6708bcf6f8` |
  | AC-173 helper | `app/admin/finance/__tests__/financeRequestPins.ts` | `b84e0c961e60c994414af7b418dd7f9dc94273e45695d632956427fade68aabf` |
  | A | `app/admin/components/layout/__tests__/KpiStrip.callers.pin.render.test.tsx` | `30f5fc24f4e46870033ecdc984efa1c0647f633256f73ccfb302fa9899e62e01` |
  | B | `app/admin/finance/__tests__/financeTiles.pin.render.test.tsx` | `24ff0da7efb824ccc2b5d90687e34b3cd9da33803658dccf19c0d096ae56df9f` |
  | C | `app/admin/finance/__tests__/chargeChecksRequest.pin.render.test.tsx` | `98ea05072007b028604e782e43a3cbbc3c0098d360a11a76491be88afc111e4b` |
  | C helper | `app/admin/finance/__tests__/chargeChecksRequestPins.ts` | `028133609122976f034c71bc841dde4b95c170a592862500bc6381ad2e545bd8` |
  | D | `lib/admin/health/__tests__/m5WordingOnly.pin.test.ts` | `1f7cf07af1ea07975badca277c903a5568793cd4e88ff49f83ff9cdff34af144` |

  On Windows the working copy has CRLF (`core.autocrlf=true`), so `sha256sum` of the file differs. Check with `git show HEAD:<file> | sha256sum` for the base and `git diff --quiet -- <file>` for the tree.
- **Every read, write and request** of both pages, the external rates fetch, the dashboard's period options and its outbound links.
- **`/api/admin/dashboard` code**: only a comment is added; `requireAdmin` stays first in GET and HEAD.
- `CurrencyService`, `CurrencySelector`, `currencyHelpers` (shared, CF-8); `app/admin/components/layout/**`; the C-14 registry; the contrast guard's `PAGES`.

**Out of scope:** deleting anything (BD-34); making Exchange rates read-only (FU-M8-1); moving either page onto the layout standard; the other 14 parked pages; the requirement MDs (BA owns them); any user browser look (parked AgentsPilot pages).

---

## Analysis Summary

| # | Finding | Evidence |
|---|---|---|
| A-1 | The dashboard is one client file; its only data call is `/api/admin/dashboard?period=`; its header (`:23-33`) already says URL-only (U-6) | `app/admin/platform-dashboard/page.tsx:1`, `:23-33`, `:106` |
| A-2 | The dashboard component `AdminDashboard` (`:90`) has three early returns: loading `:157-166`, error `:168-184`, `!data` `:186`; the loaded view starts `:188` with its own h1 "System Overview" `:193` | `platform-dashboard/page.tsx` |
| A-3 | `/api/admin/dashboard` has GET (`:15`, `requireAdmin` at `:22-23`) and HEAD (`:274-283`); no caller outside the dashboard page. Referenced by `adminGate.writes.test.ts:237`, `:341-342` and ADMIN_IDENTIFICATION rows 22, 23 | `app/api/admin/dashboard/route.ts` |
| A-4 | Exchange rates `ExchangeRatesPage` (`:46`) has one early return (loading `:211-217`) and the loaded view at `:219` (h1 `:227`). It writes from the browser (`:106-150`, `:184`) and fetches an external API (`:167`) | `app/admin/exchange-rates/page.tsx` |
| A-5 | Exchange rates has no route of its own; `CurrencyService` is also used by `components/settings/CurrencySelector.tsx:9` and `lib/utils/currencyHelpers.ts:4` | search at `5c214310` |
| A-6 | The sidebar's only reference to either page: the parked item `:232-241` (comment `:234-237`), the header comment `:66-69` naming `/admin/platform-dashboard`, and `:82-83` ("Exchange Rates is deliberately NOT listed", no path). Parked-section comment `:225-229` says "Fifteen items". `LayoutDashboard` is imported `:8` and used only at `:240` | `app/admin/components/AdminSidebar.tsx` |
| A-7 | Nav test pins: header list `:1-30`; `UNLISTED` `:87-89`; parked count 15 and contains the dashboard `:135-141`; on-disk scan contains both `:167`, `:169`; 29 hrefs `:179`; `not.toContain('exchange-rates')` on the whole sidebar file `:192-194`; parser self-check `:196-198`; every parked item says AgentsPilot `:202-208` | `app/admin/components/__tests__/AdminSidebar.nav.test.ts` |
| A-8 | Health guards: no Health file contains `platform-dashboard` (`health.source.guard.test.ts:67-69`, `health.render.test.tsx:241-246`); the dashboard file starts with `'use client'` (`trimStart().startsWith`), fetches `/api/admin/dashboard?period=` and uses `createLogger({ module: 'AdminPlatformDashboard' })`, comments stripped (`health.source.guard.test.ts:146-153`) | as cited |
| A-9 | `AdminNotice` exists (`app/admin/components/layout/AdminStates.tsx:102-111`): amber border and text, `AlertTriangle` icon, optional `testId` on the `<p>` | as cited |
| A-10 | C-14 part (a) rules apply to files **inside** the layout folder; part (b) applies to `MIGRATED_PAGES` only (`layoutFolder.guard.test.ts:511`, `:736-757`). Neither page is listed, so importing `AdminNotice` adds no obligation | as cited |
| A-11 | The contrast guard walks named folders only (`contrast.lf1.source.guard.test.ts:56-64`); neither page is in them | as cited |
| A-12 | `stripComments` is available for source scans (`tests/helpers/source-scan.ts:246`) | as cited |
| A-13 | No `next.config.js` redirect and no `middleware.ts` rule names either route | search |

---

## Implementation Approach

### Step 0: the pins and the baseline (unchanged `5c214310`)

- Record the seven blob hashes above with `git show HEAD:<file> | sha256sum`.
- Run `npx jest app/admin/components/__tests__/AdminSidebar.nav.test.ts app/admin/__tests__/health.source.guard.test.ts app/admin/__tests__/health.render.test.tsx app/api/admin/__tests__/adminGate.writes.test.ts --ci` and record the pass counts.

### Step 1: header comments (RP-1)

- `platform-dashboard/page.tsx`: insert after `'use client';` (`:1`), before the imports:
  ```typescript
  // REDUNDANT (BD-34, 2026-10-16): superseded by the Money area; kept, not deleted; do not extend or link.
  // Its AI cost totals are in AI calls & usage (all products). Finance requirement §11J.
  ```
  Add one line to the existing `:23-33` block saying FU-4 is answered by BD-34 (kept, unlinked).
- `exchange-rates/page.tsx`: the same first line after `'use client';`, then `// No figure on the platform uses an exchange rate (BD-12). Finance requirement §11J.`
- `app/api/admin/dashboard/route.ts`: after the path comment `:1`, the same first line, then `// Its only caller is the redundant Platform dashboard page. Finance requirement §11J.` No code change (RP-6).

### Step 2: the notice in every state (RP-4, SA-Q76)

For each page, rename the component to an inner function and wrap it, so no early return is edited:

**File:** `app/admin/platform-dashboard/page.tsx`

```typescript
const REDUNDANT_NOTICE = 'Redundant page. This old AgentsPilot dashboard is kept but is no longer used or linked. Business OS money is on Finance, in the Money section.';

export default function AdminDashboard() {
  return (
    <div className="space-y-6">
      <AdminNotice testId="redundant-page-notice">{REDUNDANT_NOTICE}</AdminNotice>
      <AdminDashboardContent />
    </div>
  );
}

function AdminDashboardContent() { /* today's body, unchanged */ }
```

Exchange rates is the same, with `ExchangeRatesContent` and its RP-4 copy. `AdminNotice` is imported by alias, `@/app/admin/components/layout/AdminStates`. Hooks stay inside the inner functions (PascalCase), so `lint:hooks` is unaffected.

### Step 3: logging (RP-7)

`exchange-rates/page.tsx`: add `import { createLogger } from '@/lib/logger';` and `const logger = createLogger({ module: 'AdminExchangeRates' });`; replace `:92` with `logger.error({ err }, 'Error loading exchange rate history');`. The same pattern the dashboard uses (A-8).

### Step 4: the sidebar (RP-2, SA-Q75)

`app/admin/components/AdminSidebar.tsx`:
- remove the item `:232-241` and the `LayoutDashboard` import `:8`;
- `:66-69`: reword to "moved the old AgentsPilot dashboard to its own URL-only page; Money M-8 (BD-34) marked it redundant and removed its hidden item" (no path);
- `:82-83`: keep the meaning, add that M-8 also keeps the old dashboard unlisted (no path);
- `:225-229`: "Fifteen items" → "Fourteen since Money M-8 (BD-34) removed the old dashboard's item".

The nav test's parser needs `name:` and `href:` adjacent in every remaining item; no remaining item changes.

### Step 5: tests and guard

See [Tests](#tests).

### Step 6: doc pointers

- `docs/requirements/ADMIN_MODULE_BOS_REORGANISATION_REQUIREMENT.md` `:273` and `:280` (S4-b): append "Amended 2026-10-17 by Finance BD-34 / M-8: the hidden parked item is removed; the page is kept, redundant, URL-only"; one Change History row.
- `docs/admin/ADMIN_IDENTIFICATION_AND_ACCESS.md` rows 22, 23 (`:235-236`): note "redundant (BD-34), kept and gated"; one Change History row.

### Step 7: verification

See [Verification Plan](#verification-plan).

---

## Files to Create / Modify

| File | Action | Reason |
|---|---|---|
| `app/admin/platform-dashboard/page.tsx` | modify `:1-33` (comment, import), `:90` (rename, wrapper) | RP-1, RP-4 |
| `app/admin/exchange-rates/page.tsx` | modify `:1-21` (comment, imports, logger), `:46` (rename, wrapper), `:92` | RP-1, RP-4, RP-7 |
| `app/api/admin/dashboard/route.ts` | modify `:1-2` (comment only) | RP-1, RP-6 |
| `app/admin/components/AdminSidebar.tsx` | modify `:8`, `:66-69`, `:82-83`, `:225-241` | RP-2 |
| `app/admin/components/__tests__/AdminSidebar.nav.test.ts` | modify `:1-30` (header item 10), `:87-89`, `:135-141`, `:172-180`, after `:194` | AC-233 |
| `app/admin/__tests__/redundantPages.source.guard.test.ts` | create | AC-233, AC-234, AC-237, AC-240 |
| `app/admin/__tests__/redundantPages.render.test.tsx` | create | AC-235, AC-236 |
| `docs/requirements/ADMIN_MODULE_BOS_REORGANISATION_REQUIREMENT.md` | modify `:273`, `:280`, Change History | Pointer (U-6, S4-b) |
| `docs/admin/ADMIN_IDENTIFICATION_AND_ACCESS.md` | modify `:235-236`, Change History | Pointer (rows 22, 23) |

**Not edited** (`git diff` empty at handover): the seven pin files; `app/admin/__tests__/health.*`; `app/api/admin/__tests__/adminGate.writes.test.ts`; `app/admin/components/layout/**`; `lib/**`; `components/**`; `supabase/**`; `next.config.js`; `middleware.ts`; the finance requirement and CR (BA owns them).

---

## Tests

### Must change

`AdminSidebar.nav.test.ts`:
- `UNLISTED` becomes `['/admin/exchange-rates', '/admin/platform-dashboard']`, with a comment citing §4.3 and BD-34;
- `:135` title "parks the fourteen AgentsPilot pages"; `toHaveLength(14)`; `not.toContain('/admin/platform-dashboard')`;
- `:179` `toHaveLength(28)`, with the comment's arithmetic extended ("− the legacy dashboard (M-8, BD-34)");
- new case beside `:192-194`: "keeps the redundant Platform dashboard unlisted (BD-34)": `expect(sidebar).not.toContain('platform-dashboard')`;
- `:167` and `:169` stay as they are: the routes are kept on disk (AC-235).

### New

`app/admin/__tests__/redundantPages.source.guard.test.ts` (pure `fs`, comments stripped where noted):
- **G-1 (AC-237):** each of the three files contains the exact RP-1 line (raw text, comments not stripped); both pages' trimmed text still starts with `'use client'`.
- **G-2 (AC-233):** the sidebar file contains neither `platform-dashboard` nor `exchange-rates`.
- **G-3 (AC-236):** both pages' code contains `testId="redundant-page-notice"` and imports `AdminNotice` from `@/app/admin/components/layout/AdminStates`.
- **G-4 (AC-234):** walk `app`, `lib`, `components`, `hooks` (skip `__tests__`, `__snapshots__`, `node_modules`, non-`.ts`/`.tsx`); in `stripComments(code)`, no file contains `/admin/platform-dashboard` or `/admin/exchange-rates`; only `app/admin/platform-dashboard/page.tsx` contains `/api/admin/dashboard`. The walk asserts it found at least one file in each root and found the dashboard page.
- **G-5 (AC-240):** `exchange-rates/page.tsx` code has no `console.` and has `createLogger({ module: 'AdminExchangeRates' })`.
- **Self-tests (no dead regex):** G-4's matcher catches `href="/admin/exchange-rates"` and `` fetch(`/api/admin/dashboard?period=7`) `` and ignores the same text inside a `//` comment.

`app/admin/__tests__/redundantPages.render.test.tsx` (jsdom, React Testing Library):
- dashboard: `global.fetch` mocked (one pending promise for the loading case; one resolved payload for loaded; one rejection for error): the notice is present in all three, with the RP-4 text; the first request URL is `/api/admin/dashboard?period=30` (AC-235, AC-236);
- exchange rates: `@/lib/supabaseClient` mocked (chained `from().select().order()` and `limit()`), loading and loaded: the notice is present; the rates table renders the mocked rows (today's content).

### Must stay untouched and green

`health.source.guard.test.ts`, `health.render.test.tsx`, `adminGate.writes.test.ts`, `layoutFolder.guard.test.ts`, `contrast.lf1.source.guard.test.ts`, `aiCostVocabulary.source.guard.test.ts`, the seven pin files, `business-os-llm/__tests__/nav.test.ts` and `business-os-tiers/__tests__/nav.test.ts`.

---

## Guards

| Guard | Effect of M-8 | Action |
|---|---|---|
| `AdminSidebar.nav.test.ts` | One hidden item gone | **Edit** (above). Visible lists `:111-132` unchanged |
| `business-os-llm/__tests__/nav.test.ts` | Counts `/admin/business-os-llm` in the sidebar file | None; no new comment may name that path |
| `health.source.guard` / `health.render` | Dashboard keeps `'use client'` first, its fetch and its logger; no Health file changes | None; must pass |
| `layoutFolder.guard` C-14 | `AdminNotice` imported from outside the folder | None; neither page joins `MIGRATED_PAGES` (A-10) |
| `contrast.lf1.source.guard` | Neither page is walked | None; the notice uses amber text, never slate-500/600 |
| `aiCostVocabulary.source.guard` | Not scanned | None |
| `adminGate.writes.test`, `test:authz-guard` | Comment-only route change | None; run |
| `test:bos-entitlements` | No entitlements import touched | Not required; run once as a smoke check |
| `lint:hooks` | Hooks move into inner PascalCase functions | Run |
| `redundantPages.source.guard` (new) | — | G-1 to G-5 |
| Frozen pins (seven files) | Not opened | Blob hashes at Step 0 and handover |

---

## AC mapping

| AC | Proof |
|---|---|
| **AC-233** no item for either page; parked hidden, 14 items; visible sections unchanged; sidebar names neither path | nav test (`UNLISTED`, 14, 28, new case, visible lists unedited); G-2 |
| **AC-234** no in-app link; only the dashboard calls its route | G-4 with its self-tests |
| **AC-235** both routes load by URL, content and requests unchanged | on-disk scan `:167`, `:169`; render test (first request `?period=30`, rates rows); `git diff` of each page shows only the comment, imports, rename and wrapper (plus `:92` for Exchange rates) |
| **AC-236** notice in loading, error and loaded states | render test (dashboard three states; Exchange rates loading and loaded; its load error is caught inside and renders the loaded view); G-3 |
| **AC-237** exact header in three files; `'use client'` first | G-1; `health.source.guard:146-153` |
| **AC-238** route unchanged apart from the comment; gate test and authz guard pass | `git diff app/api/admin/dashboard/route.ts` is comment lines only; `adminGate.writes.test`; `npm run test:authz-guard` |
| **AC-239** non-admin refused, as today | Both pages stay under `app/admin` (layout `requireAdminPage`); R8 in `test:authz-guard`; no `route.ts` added under `app/admin` |
| **AC-240** no `console.*` in Exchange rates; Pino with `{ err }` | G-5 |
| **AC-241** no data, money, read, request, migration or API logic change | `git diff --stat -- supabase lib components next.config.js middleware.ts` empty; route diff comment-only |
| **AC-242** pins byte-identical; guards pass; C-14 and contrast registries unchanged | Blob hashes and `git diff --quiet` on the seven files; suites in steps 2 to 5 of the plan; `git diff` on `layoutFolder.guard` and `contrast.lf1` empty |

---

## SA-W questions

1. **SA-W1. The wrapper and the h1.** The notice renders above each page's own h1 ("System Overview", "Exchange Rates"). Neither page is on the layout standard, so the "one h1 = sidebar label" rule does not apply, and neither h1 is changed. **Default:** leave both h1s.
2. **SA-W2. The wrapper adds a `space-y-6` `div`** around today's root. The loaded views already use `space-y-6` at their root (`platform-dashboard/page.tsx:189`, `exchange-rates/page.tsx:220`), so spacing matches. **Default:** this markup. Alternative: a fragment with a bottom margin on the notice.
3. **SA-W3. Exchange rates' error state.** Its loader shows errors inside the loaded view (no separate early return, A-4), so "on error" is covered by the loaded case. **Default:** no extra error test for that page.
4. **SA-W4. G-4 scope.** It walks `app`, `lib`, `components` and `hooks`, not `scripts/`, `docs/` or `tests/`. **Default:** yes; docs and scripts may name the routes.
5. **SA-W5. Doc pointers in this PR** (Step 6). **Default:** yes, two docs, one Change History row each; no past rows rewritten.

---

## Verification Plan

Each suite is run alone.

1. **Step 0 evidence** on `5c214310`: the seven blob hashes; baseline pass counts for nav, Health and gate tests.
2. **Admin pages:** `npx jest app/admin/__tests__ --ci` (Health, vocabulary, contrast, new redundant-page guard and render test).
3. **Components:** `npx jest app/admin/components --ci` (nav test, C-14, Pin A).
4. **Finance pins:** `npx jest app/admin/finance --ci` (AC-173, Pins B and C).
5. **Health libs:** `npx jest lib/admin/health --ci` (Pin D).
6. **Gate:** `npx jest app/api/admin/__tests__/adminGate.writes.test.ts --ci`; `npm run test:authz-guard`; `npm run lint:hooks`.
7. **Scoped `tsc --noEmit`:** a tsconfig in the scratchpad, outside the worktree, extending the repo `tsconfig.json` and including the changed and new `.ts`/`.tsx` files. Run once with a planted canary (`const canary: number = 'x'`), which must fail, then without it, which must pass. Delete both.
8. **Mutations** (scratchpad runner; each file restored and checked with `git diff --quiet`). Each must fail a named test:
   - M-1: add `href="/admin/exchange-rates"` to `app/admin/finance/page.tsx` (G-4);
   - M-2: put the dashboard item back in the sidebar (nav test, G-2);
   - M-3: change one word of the RP-1 line in the route (G-1);
   - M-4: move the notice into the loaded branch only of the dashboard (render test, loading case);
   - M-5: put `console.error` back in Exchange rates (G-5);
   - M-6: add `fetch('/api/admin/dashboard')` to a file under `lib/` (G-4);
   - M-7: put `// see /admin/platform-dashboard` in the sidebar (nav test new case, G-2).
9. **Handover diff checks:** `git status` and `git diff --numstat`; only the listed files change; no deletion without insertion (the truncation check; each page's deletions are the rename line only); `git diff --stat -- supabase lib components next.config.js middleware.ts app/admin/components/layout` empty; the seven pin files unchanged.
10. **No user browser look.** The pages are parked AgentsPilot pages; AC-235 and AC-236 are proven by the render test. QA may optionally open both URLs on `npm run dev` as an admin and record what it saw.

---

## Risks

| Risk | Mitigation |
|---|---|
| The rename or wrapper changes page behaviour | The inner body is moved unchanged; render test pins the first request and the rendered rows; `git diff` reviewed |
| A Health guard breaks on the dashboard file | `'use client'` stays line 1; the fetch and logger lines are untouched (A-8) |
| The nav parser miscounts after the removal | Parser self-check `:196-198`; no remaining item edited |
| A sidebar comment names a guarded path | Step 4 rewords without paths; M-7 |
| A frozen pin is opened | Not in the file list; blob hashes at Step 0 and handover |
| Shared `node_modules` junction / other sessions' WIP | No `git stash`, no `git worktree remove`; `git diff --stat` before handover |
| PR #447 also edits the finance requirement | Dev does not edit it; BA's §11J edits are self-contained, numbered after #447 |

---

## Estimate

About **1 day**. 9 files plus this workplan: 2 new tests; 4 modified product files; 1 modified test; 2 docs.

| Work | Time |
|---|---|
| Step 0 hashes and baseline | 0.05 d |
| Steps 1 to 3: comments, wrappers, notice, logger | 0.25 d |
| Step 4: sidebar and nav test | 0.15 d |
| New guard and render test | 0.25 d |
| Step 6 docs | 0.05 d |
| Verification, mutations, `tsc` canary, Implementation Notes | 0.25 d |

---

## Checklist

- ✅ SA review of §11J and this workplan; SA-Q75 to SA-Q80 and SA-W1 to SA-W5 answered (approved with conditions M8-R1 to M8-R4)
- ✅ Step 0: seven pin hashes and baseline pass counts recorded
- ✅ Step 1: RP-1 comments in the two pages and the route
- ✅ Step 2: deleted by M8-R1 (no notice, no wrapper)
- ✅ Step 3: Exchange rates logger
- ✅ Step 4: sidebar item, import and comments
- ✅ Step 5: nav test edits; new source guard (no render test, M8-R1)
- ✅ Step 6: doc pointers (three docs, M8-R2)
- ✅ Step 7: verification; results in Implementation Notes
- ⬜ Hand to SA code review and QA (BD-33 fast track)

---

## Implementation Notes

Implemented 2026-10-17 on `feature/bos-money-m8` (base `5c214310`), uncommitted. Scope as amended by SA (M8-R1 to M8-R4, E-71): **code comments only, no visible notice**.

### Step 0: baseline (unchanged tree)

- `npx jest AdminSidebar.nav health.source.guard health.render adminGate.writes --ci`: **4 suites, 415 tests passed**.

### What was built

| File | Change |
|---|---|
| `app/admin/platform-dashboard/page.tsx` | RP-1 header after `'use client'`; the old header block's stale "sidebar entry sits in the hidden section" sentence reworded (FU-4 answered by BD-34). Comment lines only |
| `app/admin/exchange-rates/page.tsx` | RP-1 header, plus a FU-M8-1 comment line; RP-7 `createLogger({ module: 'AdminExchangeRates' })` and `logger.error({ err }, 'Error loading exchange rate history')` replacing the one `console.error`. Nothing else |
| `app/api/admin/dashboard/route.ts` | RP-1 header after the path comment. Comment lines only; `requireAdmin` untouched |
| `app/admin/components/AdminSidebar.tsx` | Hidden parked item for the old dashboard removed; `LayoutDashboard` import removed; three comments reworded so the file names neither route. Visible sections' data unedited |
| `app/admin/components/__tests__/AdminSidebar.nav.test.ts` | Header item 10; `UNLISTED` gains the dashboard; parked 15 → 14 (two cases: `:135` and `:278`); hrefs 29 → 28; new case "keeps the redundant Platform dashboard unlisted". Visible lists `:111-132` and the on-disk `toContain` lines unedited |
| `app/admin/__tests__/redundantPages.source.guard.test.ts` | New: G-1 to G-5 (G-3 per M8-R1: no `redundant-page-notice`, no `AdminNotice`) and a planted control for every rule (M8-R3) |
| `docs/MULTI_CURRENCY_SYSTEM.md` | M8-R2: redundant pointer at `:43`, `:233`, `:286` areas; new Change History section with one row |
| `docs/admin/ADMIN_IDENTIFICATION_AND_ACCESS.md` | Rows 22, 23 note "redundant, kept and gated"; one Change History row |
| `docs/requirements/ADMIN_MODULE_BOS_REORGANISATION_REQUIREMENT.md` | Slice 4 AC and S4-b amended by BD-34; one Change History row |

### Deviation (for SA)

- The nav test pinned the parked count **twice** (`:135` and `:278`, "keeps all fifteen parked items in the data"). The plan named only the first; both now say 14.
- Two existing comment sentences in the dashboard page and the sidebar named the removed hidden item; they were reworded (comment-only), so the comments are not stale.

### Verification (each command run alone; real results)

| Command | Result |
|---|---|
| `npx jest app/admin/components --ci` (nav, C-14 `layoutFolder.guard`, Pin A and the rest) | **25 suites, 818 tests passed** |
| `npx jest app/admin/__tests__/redundantPages.source.guard.test.ts --ci` | **1 suite, 17 tests passed** |
| `npx jest app/admin/__tests__/health.source.guard.test.ts app/admin/__tests__/health.render.test.tsx --ci` | **2 suites, 56 tests passed** |
| `npx jest app/admin/__tests__/contrast.lf1.source.guard.test.ts --ci` | **1 suite, 85 tests passed** |
| `npx jest app/api/admin/__tests__/adminGate.writes.test.ts --ci` | **1 suite, 328 tests passed** |
| `npx jest app/__tests__/tailwind-css-escape.guard.test.ts --ci` | **1 suite, 6 tests passed** |
| `npm run test:authz-guard` | **2 suites, 203 tests passed** |
| `npm run lint:hooks` | exit 0, no output |
| `npx eslint` on the six touched code files | 0 errors, 11 warnings, all pre-existing: the HEAD versions give the same 9 (Exchange rates) and 2 (dashboard) warnings; none is on a changed line, so none was fixed (comment-only rule) |
| Scoped `tsc --noEmit` (scratchpad tsconfig extending the repo's, the six touched code files) | with canary `const canary: number = 'x'`: exit 2, TS2322 on the canary only; without it: **exit 0**. Config and canary deleted |

### Frozen pins (M8-R4: LF-normalised, `sed 's/\r$//' <file> | sha256sum`)

| Pin | SHA-256 |
|---|---|
| AC-173 | `3a1a2dd415b3d0e0ffe44488a8c410b8e67a0bedf2ca908bbf064b6708bcf6f8` |
| AC-173 helper | `b84e0c961e60c994414af7b418dd7f9dc94273e45695d632956427fade68aabf` |
| A | `30f5fc24f4e46870033ecdc984efa1c0647f633256f73ccfb302fa9899e62e01` |
| B | `24ff0da7efb824ccc2b5d90687e34b3cd9da33803658dccf19c0d096ae56df9f` |
| C | `98ea05072007b028604e782e43a3cbbc3c0098d360a11a76491be88afc111e4b` |
| C helper | `028133609122976f034c71bc841dde4b95c170a592862500bc6381ad2e545bd8` |
| D | `1f7cf07af1ea07975badca277c903a5568793cd4e88ff49f83ff9cdff34af144` |

All seven equal the frozen values, and `git diff --quiet HEAD` on the seven files is clean.

### Diff checks at handover

- `git diff --numstat`: sidebar 6/14, nav test 19/10, Exchange rates 8/1, dashboard page 7/2, route 2/0, MULTI_CURRENCY 12/0, ADMIN_IDENTIFICATION 4/3, reorganisation requirement 4/3 (plus the BA/SA requirement and CR edits). **No file has deletions without insertions.**
- `git diff -U0` of the two pages and the route: every added or removed line is a comment or blank line, except the Exchange rates logger lines (import, `const logger`, the `logger.error` replacing `console.error`). No markup, hook, request or write changed.
- Not touched: `lib/**`, `components/**`, `supabase/**`, `next.config.js`, `middleware.ts`, `app/admin/components/layout/**`, the Health tests, the gate test, the seven pins.
- FU-M8-1 recorded only (comment in the Exchange rates header and the MULTI_CURRENCY note); the page still writes from the browser.

---

## SA Review Notes

### SA Workplan Review

**Reviewed by SA — 2026-10-17, against `5c214310`. This is also the SA requirement review of §11J (SA-RR-M8).**
**Status:** ✅ **APPROVED WITH CONDITIONS** (M8-R1 to M8-R4). UI short path. SA applied E-71 to §11J.

**BD-34 reading (final, not sent to the user):** the user said "no need to remove, we can just add comments it is redundant for now and not use them". M-8 is therefore **code comments only, with no visible notice**. BQ-14 is resolved by BD-34. §11J (scope row, RP-4, AC-236, §11J.4 and the BQ-14 paragraph) is amended by E-71.

**Checked against the code**
- **References.** `git grep` across the repo outside `docs/` and tests finds only the sidebar (`:68` comment, `:239` item), the dashboard's own fetch and the route's path comment. Nothing in `lib/`, `components/`, `hooks/`, emails, `next.config.js` or `middleware.ts` links to either page.
- **Docs.** Besides the two the workplan lists, `docs/MULTI_CURRENCY_SYSTEM.md` (`:43`, `:233`, `:286`) still tells admins to visit `/admin/exchange-rates` (M8-R2).
- **Sidebar.** Removing the hidden parked item leaves the visible sections' data untouched. The nav test's visible lists (`:111-132`) stay unedited, which proves the visible nav is byte-identical. The counts 15 → 14 and 29 → 28 are right.
- **Pino.** `createLogger({ module: 'AdminExchangeRates' })` with `{ err }` matches the sibling dashboard page, which the Health guard pins to `@/lib/logger`. It is approved.
- **No edits needed** for Health, layoutFolder (C-14), contrast, authz or the vocabulary guard. Neither page is registered in any of them.
- **Frozen pins.** This worktree checks files out with CRLF, so a raw `sha256sum` differs. **LF-normalised**, all seven equal the frozen values (`3a1a2dd4`, `b84e0c96`, `30f5fc24`, `24ff0da7`, `98ea0507`, `02813360`, `1f7cf07a`), and each file is clean against `HEAD` (M8-R4).
- **The AC mapping is complete** (AC-233 to AC-242).
- **Estimate.** It drops to **about 0.75 day** without the notice.

**Rulings**

| # | Ruling |
|---|---|
| SA-Q75 | **Remove** the hidden item (BD-34). The route joins the nav test's unlisted list, like Exchange rates. |
| SA-Q76 | **Moot.** With no notice there is no wrapper or inner `…Content` rename. Step 2 is deleted, and both component structures stay exactly as they are. |
| SA-Q77 | **Moot** (no notice). |
| SA-Q78 | **Comment only** on the route. A runtime marker would be an API change. |
| SA-Q79 | **A new `redundantPages.source.guard.test.ts`.** |
| SA-Q80 | **Record only, as FU-M8-1.** |
| SA-W1, SA-W2, SA-W3 | **Moot** (notice dropped): no h1 or spacing question arises. |
| SA-W4 | **Approved:** G-4 walks `app`, `lib`, `components` and `hooks`, where docs and scripts may name the routes. |
| SA-W5 | **Approved, plus M8-R2:** doc pointers in this PR, three docs, one Change History row each. |

**Required changes (SA verifies at code review)**
1. **M8-R1 (Medium). Drop the notice everywhere** (E-71):
   - delete Step 2;
   - delete the render test `redundantPages.render.test.tsx`;
   - replace G-3 with "neither page contains `redundant-page-notice` nor imports `AdminNotice`";
   - each page's diff must be the RP-1 comment lines only (plus the RP-7 logger lines on Exchange rates);
   - remove the `lint:hooks` "hooks move" note.
2. **M8-R2 (Low). Add `docs/MULTI_CURRENCY_SYSTEM.md`** to Step 6, with a pointer note that the page is redundant (BD-34) and kept, and one Change History row.
3. **M8-R3 (Low). Planted controls in the new guard.** Each rule G-1, G-2, G-4 and G-5 and the new G-3 gets a planted control that must fail. That covers a missing header, a sidebar naming the path, a link in a planted file, a `console.` line, and a planted notice.
4. **M8-R4 (Low). Pin hashes LF-normalised.** Record them in Implementation Notes (`sed 's/\r$//' | sha256sum`), because this worktree checks out CRLF. `git diff --quiet HEAD` on the seven files is the primary proof.

### SA Code Review

**Code Review by SA — 2026-10-17** (uncommitted on `feature/bos-money-m8`)
**Status:** ✅ **Code Approved.** No conditions.

**Conditions**
- **M8-R1.** The page and route diffs are comment lines only, plus Exchange rates' `createLogger` import, `logger` constant and its one `logger.error({ err }, …)` line. There is no visible notice. Both pages still start with `'use client'`. G-3 asserts no `redundant-page-notice` and no `AdminNotice`.
- **M8-R2.** The `docs/MULTI_CURRENCY_SYSTEM.md` pointer notes are in, three of them, plus a new Change History.
- **M8-R3.** G-1 to G-5 each have a planted control that bites, in the "planted controls" `describe`. The G-4 walk also guards itself.
- **M8-R4.** SA recomputed the seven pins LF-normalised: `3a1a2dd4`, `b84e0c96`, `30f5fc24`, `24ff0da7`, `98ea0507`, `02813360`, `1f7cf07a`. All are unchanged and clean against `HEAD`.

**Other checks**
- **Sidebar.** The hidden item and the now-unused `LayoutDashboard` import are removed. The visible lists in the nav test are unedited. The parked count goes 15 → 14 in both places it is pinned, the href count goes 29 → 28, and there is a new "names no `platform-dashboard`" case.
- **Pino.** `createLogger({ module: 'AdminExchangeRates' })` with `{ err }` is correct and matches the dashboard.
- **The two extra docs were needed, because each was stale on the removed item.** The reorganisation requirement's S4-b and the slice 4 criterion described the hidden parked entry, and ADMIN_IDENTIFICATION rows 22 and 23 cover the route. Each has a Change History row.
- **The reworded comments are acceptable.** They drop the route paths (RP-2, G-2) and record BD-34.
- **No data, API-logic or money change.** The route gains two comment lines only.

**SA re-run (all exit 0)**

| Suite | Result |
|---|---|
| `app/admin/components` | 25 suites, 818 tests |
| New guard, Health guards, gate test | 4 suites, 401 tests |
| `test:authz-guard` | 2 suites, 203 tests |

**Code Approved for QA: Yes**

---

## QA Testing Report

**QA — 2026-10-17**
**Test mode:** full (UI short path)
**Strategy used:** A: Jest source guards and render tests, run one at a time. Plus mechanical diff checks, a planted-link run against the real guard, and a scoped tsc with a canary.
**Focus:** ui, security
**Skipped:** the browser look (optional per brief; agent-platform click-throughs are parked, so none are written).
**Input source:** prompt + workplan

**Verdict: PASS. No bugs.**

### Suite runs (each alone, worktree `feature/bos-money-m8`, uncommitted)

| Suite | Result |
|---|---|
| `app/admin/components` (nav, C-14 `layoutFolder`, Pin A and the rest) | 25/25, 818/818 |
| `app/admin/__tests__/redundantPages.source.guard.test.ts` | 1/1, 17/17 |
| Health `health.source.guard` + `health.render` | 2/2, 56/56 |
| Contrast `contrast.lf1.source.guard` | 1/1, 85/85 |
| Gate `app/api/admin/__tests__/adminGate.writes.test.ts` | 1/1, 328/328 |
| All of `app/admin/__tests__` | 16/16, 602/602 |
| `npm run test:authz-guard` | 2/2, 203/203 |
| `npm run lint:hooks` | exit 0 |

These match Dev's counts.

**Pins (LF-normalised, `sed 's/\r$//' | sha256sum`):** AC-173 `3a1a2dd4…f6f8` ✅, helper `b84e0c96…aabf` ✅, A `30f5fc24…2e01` ✅, B `24ff0da7…df9f` ✅, C `98ea0507…1e4b` ✅, C helper `02813360…5bd8` ✅, D `1f7cf07a…f144` ✅. `git diff --quiet HEAD` is clean on all pin folders.

**Scoped tsc:**
- Config in the scratchpad covering the 6 touched TS/TSX files.
- A canary in `exchange-rates/page.tsx` gave `(540,7) TS2322`.
- The file was restored with `cp` and checked with `cmp` (identical; numstat back to 8/1).
- The clean run gives **exit 0, 0 errors**.

**Scope:** `git diff --stat -- supabase lib components next.config.js middleware.ts` is empty. No file is deletion-only.

### Checks

1. **Comment-only diffs.** In `git diff -U0` of both pages and the route, every non-comment, non-blank changed line is one of three: `import { createLogger } from '@/lib/logger'`, `const logger = createLogger({ module: 'AdminExchangeRates' })`, and `console.error(...)` → `logger.error({ err }, ...)`. Nothing else changed.
2. **Visible sidebar unchanged.** The `AdminSidebar.tsx` hunks touch only the `LayoutDashboard` import, three comments and the hidden parked item. The nav test's visible lists are unedited and green.
3. **Both routes render as before.** The component bodies are untouched: no markup, hook, request or write changed. Logging from a `'use client'` page has a sibling precedent: platform-dashboard already uses `createLogger`, pinned by the Health guard.
4. **The guard catches a planted link.** I planted a temporary untracked `components/__qa_plant_m8__/Plant.tsx` and ran the guard twice:
   - with `<Link href="/admin/exchange-rates">`, G-4 "no file names either page route in code" fails and names the file;
   - with `fetch('/api/admin/dashboard')`, G-4 "only the dashboard page names the dashboard API route" fails.

   The plant was deleted afterwards (`git status` clean for `components/`).
5. **No `console.*` remains in the touched files.** The only matches are a JSDoc mention in `platform-dashboard/page.tsx:31` and the guard's own planted-control strings.

### Test Coverage

| AC | Verdict | Evidence |
|---|---|---|
| AC-233 | PASS | nav test (UNLISTED, parked 14, hrefs 28, visible lists unedited); G-2 |
| AC-234 | PASS | G-4 green, plus QA's two planted controls caught |
| AC-235 | PASS (code) | page bodies unchanged (check 1); a live look is optional |
| AC-236 | PASS | no notice (G-3); diff = RP-1 comments + RP-7 logger lines (check 1) |
| AC-237 | PASS | G-1 (exact RP-1 header, `'use client'` first) |
| AC-238 | PASS | route diff is 2 comment lines; gate test and authz-guard green, unedited |
| AC-239 | PASS (code) | admin layout untouched; authz-guard green |
| AC-240 | PASS | G-5; one `logger.error({ err }, …)` replaces the only `console.error` |
| AC-241 | PASS | scope diff empty |
| AC-242 | PASS | 7 pins equal, clean vs HEAD; nav, Health, C-14, contrast and redundant guards green |

### Issues Found
- **Bugs:** none.
- **Performance:** none.
- **Edge cases:** none new. FU-M8-1 (Exchange rates writes from the browser) is recorded, as SA ruled.

### Final Status
- [x] All acceptance criteria pass. Ready for SA code review sign-off and RM.
- [ ] Issues found

---

## Commit Info

_Pending (RM)._

---

## Change History

| Date | Change | Details |
|---|---|---|
| 2026-10-17 | Created (Dev) | Workplan for Money M-8 from Finance §11J and BD-34, at main `5c214310`: files with lines, guards, AC-233 to AC-242 mapping, SA-W1 to SA-W5, verification with seven mutations, about 1 day. No code written |
