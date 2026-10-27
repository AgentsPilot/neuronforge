# Workplan: Finance follow-ups bundle 2 (MK9-FU-2, MK8B notes, BLL-FU-1)

> **Last Updated**: 2026-10-27

**Developer:** Dev
**Branch:** `chore/finance-followups-bundle-2`, worktree `neuronforge-finfu2`. It was cut from `origin/main` `4e75ed9f` (#534), then fast-forwarded with nothing written yet to `origin/main` `8967888c` (#537, after #536 merged).
**Requirement sources:** the retrospectives and workplans quoted under each item. The user approved this bundle on 2026-10-27.
**Date:** 2026-10-27
**Status:** Code Complete (Dev, 2026-10-27), uncommitted. SA-WP-FU2 approved with FU2-C1 to FU2-C5; the user accepted the 7b Back change. FU-SL-1 and FU-SL-2 are out of scope (assigned to Offir). Awaiting SA code review, then QA.

## Overview

This bundle holds four small follow-ups and ships as **one PR**. The user's item numbers are kept: item 4 (MK9-FU-2), item 7 (two MK-8b notes, 7a and 7b), BLL-FU-1 and FU-SL-1. **FU-SL-1 and FU-SL-2 are Out of scope — assigned to Offir (user, 2026-10-27).** The FU-SL-1 section below stays as the reference handed to Offir; this PR does not build it. Each item quotes its source word for word, then gives the Step 0 facts, the fix and the tests.

Step 0 found three things that differ from the brief. SA and the user should see them first:

1. **Item 4 can be fixed with no payload change.** The only way Comped can be cut off is a capped plan walk. That flag already reaches the page as `trials.status === 'partial'`, because both figures come from the same walk. The billing-status read cannot be "cut": at its ceiling it throws, and Comped already shows "Could not check". The default fix is therefore UI-only, with no AC-145 move and no overlap with item 8 (SA-Q-FU2-1).
2. **Item 7a's text match is in the provider, not the reader.** `readAiCostDrawer` already matches on `status === 409 && message === 'platform_account'` (the route's stable code). The provider then throws that away and compares the *display sentence* with `COSTS_PLATFORM_ACCOUNT`. The fix carries a kind, not a sentence, from reader to provider.
3. **FU-SL-1 never showed "no links".** The list read and the visitor count are separate reads. When the count fails, the links still list, and every link shows **0 unique visitors**. The real defect is a false 0, not a false empty list. This is a **business-user page** (Business OS website, Smart links), so what replaces the 0 is a business question (BQ-FU2-1). **Out of scope — assigned to Offir (user, 2026-10-27).**

## Table of Contents

- [Analysis Summary](#analysis-summary)
- [Item 4: MK9-FU-2, Comped "at least" on a cut walk](#item-4-mk9-fu-2-comped-at-least-on-a-cut-walk)
- [Item 7a: MK-8b, the platform account by kind, not by text](#item-7a-mk-8b-the-platform-account-by-kind-not-by-text)
- [Item 7b: MK-8b, "Open full view" in place](#item-7b-mk-8b-open-full-view-in-place)
- [BLL-FU-1: shrink the bos-llm baseline](#bll-fu-1-shrink-the-bos-llm-baseline)
- [FU-SL-1: a failed visitor count is not 0 (out of scope)](#fu-sl-1-a-failed-visitor-count-is-not-0-out-of-scope)
- [Files to Create / Modify](#files-to-create--modify)
- [Overlaps](#overlaps)
- [Pin and baseline moves](#pin-and-baseline-moves)
- [Acceptance criteria](#acceptance-criteria)
- [Estimate](#estimate)
- [Risks](#risks)
- [SA questions](#sa-questions)
- [Business questions (separate)](#business-questions-separate)
- [Task List](#task-list)
- [Implementation Notes (Dev, 2026-10-27)](#implementation-notes-dev-2026-10-27)
- [SA Review Notes](#sa-review-notes)
- [QA Testing Report](#qa-testing-report)
- [Commit Info](#commit-info)
- [Change History](#change-history)

---

## Analysis Summary

| Item | Touches | DB / reads | Payload |
|---|---|---|---|
| 4 (MK9-FU-2) | `PayingBreakdownSection.tsx` (render only) | None | None (default A) |
| 7a | `aiCostDrawerReads.ts`, `AiCostDrawers.tsx` | None | None |
| 7b | `AiCostDrawers.tsx`, `AiCostView.tsx` | None new: the in-page switch sends the page's own report request for the picked business (the Pin C row 7 literal) | None |
| BLL-FU-1 | `scripts/typecheck-bos-llm.baseline.json` | — | — |
| FU-SL-1 | **Out of scope — assigned to Offir (user, 2026-10-27)** — nothing touched in this PR | — | — |

There is no migration, no new route, no new repository method and no new admin route. The finance builder (`financeHealth.ts`), the finance route, the livemode guard, CUR-3 and the CPU leak guard are untouched. `console.*` count in every file touched: 0. The one match in `app/business-os/website/page.tsx` (line 2721) is inside a comment.

---

## Item 4: MK9-FU-2, Comped "at least" on a cut walk

### Source

[ADMIN_MONEY_MK9_RETROSPECTIVE.md](/docs/retrospectives/ADMIN_MONEY_MK9_RETROSPECTIVE.md), "Follow-ups (QA, Low, optional)":

> MK9-FU-2: Comped has no "at least" when its read hits a cut-off.

The MK-9 workplan's own rule ([ADMIN_MONEY_MK9_PAYING_TRIAL_WORKPLAN.md](/docs/workplans/ADMIN_MONEY_MK9_PAYING_TRIAL_WORKPLAN.md) §1.1):

> a capped walk makes the part "at least" (S5B-FR-16).

### Step 0 facts

| # | Fact | Where |
|---|---|---|
| S4-1 | `compedSplit` counts accounts in `groupByAccount` whose group is `comped`. `groupByAccount` comes from `classifyAccounts` over `plansResult.data.rows`, the plan walk | `lib/business-os/finance/payingBreakdown.ts:40-64`; `lib/business-os/finance/financeHealth.ts:840-842`, `:1511-1513` |
| S4-2 | The plan walk can be **cut**: `plansResult.data.capped`. A capped walk leaves accounts out, so Comped and both parts are lower bounds | `financeHealth.ts:840`, `:857`, `:862` |
| S4-3 | The billing-status read (`statusRows`) **cannot be cut**. At its ceiling `listBillingRowsForModeAllAccounts` throws `AdminBillingReadCeilingError`, so `payingResult.data` is null and `compedSplit` returns null ("Comped: Could not check") | `lib/repositories/BusinessOsBillingAdminReadRepository.ts:188`; `lib/admin/billing/currentModeBillingStatus.ts:109-110`; `payingBreakdown.ts:46` |
| S4-4 | So the only cut-off for Comped is S4-2, and that flag already reaches the client: `trials` is built with `capped: plansResult.data?.capped`, giving `trials.status === 'partial'` | `financeHealth.ts:1514-1516`; `payingBreakdown.ts:116` |
| S4-5 | Whenever `comped` is non-null, `trials.status` is `ok` or `partial`, never `unknown`. `comped` non-null needs `classified`, which needs `plansResult.data`; `trials` is `unknown` only when `planRows` is null, which is when `plansResult.data` is null | `financeHealth.ts:840-847`, `:1508-1513` |
| S4-6 | The section already uses `exact = trials.status === 'ok'` and `atLeast()` for every trial count, but prints the three Comped numbers with `formatCount` only | `app/admin/finance/components/PayingBreakdownSection.tsx:45-46`, `:70-73` |
| S4-7 | `atLeast(text, exact)` gives `"At least 6"`; `AT_LEAST = 'At least'` | `app/admin/finance/financeFormat.ts:78-80`; `app/admin/finance/financeCopy.ts:56` |

### Fix (default: option A, UI only)

In `PayingBreakdownSection.tsx`, print the three Comped figures through the same `n()` the trial counts use:

- `Comped: At least 6 · Assigned, no subscription At least 4 · Subscription ended or not paying At least 2` on a cut walk.
- Unchanged on an exact walk.
- "Comped: Could not check" unchanged when the paying read failed.

The exactness is named once for both blocks (`const walkExact = trials.status === 'ok'`), with a comment citing S4-4/S4-5: both blocks rest on the same plan walk. `payingBreakdown.ts` gets no code change. Its header gains one sentence saying that a cut walk makes the split "at least", and that the page reads it from the walk's flag.

**Option B (not the default):** `compedSplit` takes `capped` and `FinanceCompedSplit` gains `status: 'ok' | 'partial'`. That makes Comped self-describing, but it adds a payload key, so the AC-145 hash moves. Item 8 also moves AC-145, so the two PRs would collide on the same constant (SA-Q-FU2-1).

### Tests

| # | File | Case |
|---|---|---|
| T4-1 | `app/admin/finance/__tests__/payingBreakdown.render.test.tsx` (append) | Cut walk (`trials.status: 'partial'`) with a Comped split: the Comped line reads `Comped: At least 6`, `Assigned, no subscription At least 4`, `Subscription ended or not paying At least 2` |
| T4-2 | same | Exact walk: the Comped line contains no "At least" (control: T4-1 fails if the `n()` wrapper is removed) |
| T4-3 | same | Cut walk, paying read failed (`comped: null`): "Comped: Could not check", with no "At least" |
| T4-4 | `lib/business-os/finance/__tests__/financeHealth.test.ts` (append inside "Money MK-9: payingBreakdown through the builder") | A capped plan walk gives `payingBreakdown.comped` non-null **and** `trials.status === 'partial'`: this pins the invariant the page relies on (S4-4/S4-5) |

---

## Item 7a: MK-8b, the platform account by kind, not by text

### Source

[ADMIN_MONEY_MK8B_RETROSPECTIVE.md](/docs/retrospectives/ADMIN_MONEY_MK8B_RETROSPECTIVE.md), "SA's two Low notes, recorded":

> The platform account is detected by matching text. QA confirmed this works with the real route body.

SA-CR-MK8B ([ADMIN_MONEY_MK8B_AI_COST_DRAWERS_WORKPLAN.md](/docs/workplans/ADMIN_MONEY_MK8B_AI_COST_DRAWERS_WORKPLAN.md), line 591):

> `AiCostDrawers.tsx`: the platform case is recognised by comparing the message text with `COSTS_PLATFORM_ACCOUNT`. That works, but it ties behaviour to the wording. If the read ever gains a `kind`, switch on that instead. Low; does not block.

### Step 0 facts

| # | Fact | Where |
|---|---|---|
| S7a-1 | The route answers `{ success: false, error: 'platform_account' }` with status 409, before any read | `app/api/admin/business-os/credits/report/route.ts:154` (QA MK-8b, line 662) |
| S7a-2 | The reader already matches on the status and the stable code: `result.status === 409 && result.message === 'platform_account'`. It then returns `{ ok: false, message: COSTS_PLATFORM_ACCOUNT }`, a display sentence | `app/admin/ai-cost/aiCostDrawerReads.ts:41` |
| S7a-3 | The provider tells the platform notice from an error by `state.message === COSTS_PLATFORM_ACCOUNT`, a text comparison | `app/admin/ai-cost/components/AiCostDrawers.tsx:271` |
| S7a-4 | `DrawerRead<T>` is `{ ok: true; data: T } \| { ok: false; message: string }`, used by 15 other files. It has no room for a kind | `app/admin/components/layout/useDrawerResource.ts:35` |
| S7a-5 | Precedent for a kind: `useCostReport` keeps `{ kind: 'platform_account' \| 'other'; message }` | `app/admin/ai-cost/useCostReport.ts:32`, `:81-83` |

### Fix (default: local data union, no shared change)

- `aiCostDrawerReads.ts`: the drawer reads `AiCostDrawerData = { kind: 'report'; report: CostReportPayload } | { kind: 'platform_account' }`. A 409 with `platform_account` becomes `{ ok: true, data: { kind: 'platform_account' } }`. The status and the code are both still checked. A platform account is not a failure on this page, because it is shown as an `AdminNotice`, not an `AdminError`. Every other failure stays `{ ok: false, message }`.
- `AiCostDrawers.tsx`: switch on `state.data.kind`. `'platform_account'` renders `<AdminNotice testId="ai-cost-drawer-platform">{COSTS_PLATFORM_ACCOUNT}</AdminNotice>`, and `'report'` renders `DrawerBody` as today. The `state.message === COSTS_PLATFORM_ACCOUNT` comparison is deleted.
- `useDrawerResource.ts` and `DrawerRead` are not touched (SA-Q-FU2-2 offers the shared alternative).

### Tests

| # | File | Case |
|---|---|---|
| T7a-1 | `app/admin/ai-cost/__tests__/aiCostDrawerReads.test.ts` (edit the 409 case) | 409 `platform_account` → `{ ok: true, data: { kind: 'platform_account' } }`. A 409 with another code → `{ ok: false, message: <that code> }`. A 200 → `{ ok: true, data: { kind: 'report', report } }` |
| T7a-2 | `app/admin/ai-cost/__tests__/aiCostDrawers.render.test.tsx` (existing 409 case, unchanged) | Still shows `ai-cost-drawer-platform` with the sentence |
| T7a-3 | same (new) | Wording independence: a 400 whose reason **equals** `COSTS_PLATFORM_ACCOUNT` renders `ai-cost-drawer-error`, not the notice. This fails on today's code, which proves the text match is gone |
| T7a-4 | `app/admin/ai-cost/__tests__/aiCost.source.guard.test.ts` or the drawer test (new, source) | `AiCostDrawers.tsx` contains no `=== COSTS_PLATFORM_ACCOUNT`, with a planted control |

---

## Item 7b: MK-8b, "Open full view" in place

### Source

[ADMIN_MONEY_MK8B_RETROSPECTIVE.md](/docs/retrospectives/ADMIN_MONEY_MK8B_RETROSPECTIVE.md):

> "Open full view" reloads the whole page.

SA-CR-MK8B (line 592):

> "Open full view" is a plain `<a>`, so it loads the whole page again rather than navigating client-side. That matches MK-8's link and the Q-7 ruling, so it is accepted. Note for QA only.

### Step 0 facts

| # | Fact | Where |
|---|---|---|
| S7b-1 | `FullViewLink` is `<a href={href}>` with no click handler, so a click is a full document load | `AiCostDrawers.tsx:210-218` |
| S7b-2 | The href comes from `fullViewHref(accountId, anchor)` = `/admin/ai-cost` + `hrefFor({ ...tabPatch('checks'), account })` + anchor (`#costs-periods` from the period drawer) | `app/admin/ai-cost/components/AiCostView.tsx:125-128` |
| S7b-3 | The page's state is `useAdminFilters(AI_COST_FILTER_SPEC)`. `setFilters` applies at once and writes the URL with `replaceState`, and it never pushes (U-1 to U-10) | `app/admin/components/layout/useAdminFilters.ts:1-32`; `AiCostView.tsx:85` |
| S7b-4 | **Precedent: "a real link, plain left click applies in place".** `KpiTileFilter { href, apply }` and the exported `isPlainLeftClick`. Modified and middle clicks keep the browser's own handling | `app/admin/components/layout/KpiStrip.tsx:377-414`, `:478-495`; `AiCostView.tsx:103-116` (`tabLink`, which also scrolls to an anchor after the switch) |
| S7b-5 | Once a business is picked, `drawerWindow` is null. The provider then publishes a null context, so the Details column and every opener disappear (MK-8 N-5, SA-Q-MK8B-4) | `AiCostView.tsx:120-124`; `AiCostDrawers.tsx:279` |
| S7b-6 | Focus on close goes to `openerRef.current` (`onReturnFocus`). After a full view, that opener is unmounted (S7b-5), so focus would fall to `<body>` | `AiCostDrawers.tsx:254-260`, `:283-285` |
| S7b-7 | `#costs-periods` is a `<section id>` from `SectionShell` | `app/admin/business-os-llm/components/costs/CostsSections.tsx:62-65`, `:187` |
| S7b-8 | A business change makes **one** report request: the `request` memo depends on `filters.window` and `filters.account` only. With the window unchanged, it is exactly the request the page sends with that business picked (Pin C row 7) | `AiCostView.tsx:88-96` |

### Fix (default: the S7b-4 precedent)

- `AiCostDrawerProvider` gains one prop, `openFullView: (accountId, anchor) => void`, beside `fullViewHref`.
- `FullViewLink` keeps `href` (a real link for a new tab or a copied address) and adds `onClick`: when `isPlainLeftClick(event)`, call `preventDefault()`, then:
  1. Mark the close as a "full view" close (a ref), and `setTarget(null)`, which closes the drawer.
  2. Call `openFullView(target.accountId, anchor)`.
- `AiCostView.openFullView`: `setFilters({ ...tabPatch('checks'), account: accountId })`. If an anchor is given, it scrolls to it on the next frame, exactly as `tabLink.apply` does (S7b-4).
- **Focus:** `onReturnFocus` checks the ref. After a normal close (Escape, X, overlay), focus goes to the opener as today. After a full-view close, focus goes to the "Summary & checks" tab button (`aiCostTabId('checks')`, always mounted) with `{ preventScroll: true }`, so the anchor scroll is not undone. The opener no longer exists (S7b-6). SA-Q-FU2-3 covers the alternatives.
- **History:** the switch uses `setFilters`, so it replaces the entry like every other in-page change on this page. Back now leaves the page instead of returning to "all businesses". Today's plain `<a>` pushes an entry (SA-Q-FU2-4).
- No Next `router` call and no `next/link`: `useAdminFilters` is the page's only history writer (S-6), and it re-parses outside changes. A `router.push` would also work, but it would add a second writer.

### Tests (all in `app/admin/ai-cost/__tests__/aiCostDrawers.render.test.tsx`, appended)

| # | Case |
|---|---|
| T7b-1 | Business drawer, plain click on "Open full view": no document navigation (the click's `defaultPrevented` is true), the drawer closes, the page shows that business picked, and **exactly one** new request is sent, equal to the Pin C row 7 report literal. The `href` is unchanged (`/admin/ai-cost?account=<id>`) |
| T7b-2 | Period drawer: the same, plus `scrollIntoView` called on `#costs-periods` (stubbed, because jsdom has none) |
| T7b-3 | Ctrl, Meta or Shift click: `defaultPrevented` is false, the drawer stays open, and no request is sent (the browser handles it) |
| T7b-4 | Focus: after a full view, `document.activeElement` is the Summary & checks tab. After Escape (the existing test at line 241), focus is still the row button (that test stays unedited) |
| T7b-5 | After the switch there is no Details column and no opener (S7b-5), and the URL (via the `replaceState` spy) is `?account=<id>` |

T-12 (`aiCostRequests.render.test.tsx`) and Pin C (`chargeChecksRequest.pin.render.test.tsx`) are **not edited**. Neither covers a click inside a drawer, and the load requests do not change.

---

## BLL-FU-1: shrink the bos-llm baseline

### Source

[FINANCE_FOLLOWUPS_BUNDLE_RETROSPECTIVE.md](/docs/retrospectives/FINANCE_FOLLOWUPS_BUNDLE_RETROSPECTIVE.md), "New follow-ups":

> BLL-FU-1: shrink the `typecheck:bos-llm` baseline, since 16 entries are now fixed. This is a one-file PR after merge.

SA probe ruling ([FINANCE_FOLLOWUPS_BUNDLE_WORKPLAN.md](/docs/workplans/FINANCE_FOLLOWUPS_BUNDLE_WORKPLAN.md), line 790):

> ratchet it down as follow-up `BLL-FU-1`: a one-file PR after this merges, regenerated on `main` and reviewed as a shrink only (lines removed, none added).

### Step 0 facts (run on this branch at `4e75ed9f`, `NODE_OPTIONS=--max-old-space-size=8192`, 462 s)

| # | Fact |
|---|---|
| SB-1 | Output: `597 files in scope, 11 errors, 0 new` and `16 baseline entries are fixed; consider --update-baseline`. Exit 0. The run at Node's default heap died out of memory after 11 minutes. CI sets 6,144 MB (`.github/workflows/bos-llm-typecheck.yml:122`) |
| SB-2 | Baseline **before**: 24 keys, counts summing to **31** errors (`scripts/typecheck-bos-llm.baseline.json`) |
| SB-3 | The 16 reported keys are **all at 0 now**, not partly fixed. The 8 keys left sum to 11 = the 11 errors found. Each remaining key's count equals its baseline count exactly |
| SB-4 | The 16 fixed keys: `app/api/book/manage/[token]/reschedule/route.ts` TS2352 (1); `app/api/onboarding/build/route.ts` TS18047 (3); 14 keys in `lib/services/WebsiteBlockEnrichmentService.ts` (TS2322 ×10 keys / 12 errors, TS2352 ×4 keys / 4 errors) |
| SB-5 | The 8 kept: `app/api/business-os/chat/route.ts` TS2322 (1); `app/api/website/blocks/[blockId]/regenerate/route.ts` TS2322 (1); `lib/services/WebsiteSectionService.ts` TS2352 (1); `scripts/bizql-capability-sweep.ts` (1); `scripts/bizql-conversation-test.ts` (1); `scripts/bizql-planner-test.ts` `groups` (2) and `value` (1); `tests/business-os-chat/run-eval.ts` (3) |
| SB-6 | `--update-baseline` writes **every current key**, sorted, with its current count (`scripts/typecheck-bos-llm.ts:273-279`). With 0 new errors, it can only remove keys or lower counts. The check below still proves that, rather than trusting it |

### Fix

- After items 4 and 7 are in and `origin/main` is merged in, run `NODE_OPTIONS=--max-old-space-size=8192 npm run typecheck:bos-llm -- --update-baseline` on the final tree. Then run the gate once more without the flag: it must print `0 new` and no "fixed" line.
- **Shrink-only proof**, a throwaway Node script in the session scratchpad (not committed). It reads the old file (`git show origin/main:scripts/typecheck-bos-llm.baseline.json`) and the new file, and asserts:
  - (a) every new key is in the old file;
  - (b) every new count ≤ its old count;
  - (c) each removed key is in the gate's "fixed" list.

  The script prints before and after (keys/errors). It is expected to print **24/31 → 8/11**, which is −16 keys and −20 errors.
- `git diff --numstat` on the file must show 0 lines added (key order is unchanged, because both files are sorted the same way). If the writer reformats anything, SA sees it.
- If `main` has moved by then and the numbers differ, the new numbers are recorded with the same proof. Nothing else is allowed into this file.

### Tests

The gate itself (`npm run typecheck:bos-llm`) passes with `0 new` and no "fixed" line. The shrink-only proof above passes. There is no Jest change.

---

## FU-SL-1: a failed visitor count is not 0 (out of scope)

> **Out of scope — assigned to Offir (user, 2026-10-27)**, together with FU-SL-2 (SL-8 below). Tracked in [BUSINESS_OS_FINANCE_HEALTH_REQUIREMENT.md](/docs/requirements/BUSINESS_OS_FINANCE_HEALTH_REQUIREMENT.md) §0.4. This section is kept as the reference handed over; none of it is built in this bundle, and its tests (TSL-1 to TSL-4) and acceptance criteria are removed from this PR.

### Source

[FINANCE_FOLLOWUPS_BUNDLE_RETROSPECTIVE.md](/docs/retrospectives/FINANCE_FOLLOWUPS_BUNDLE_RETROSPECTIVE.md), "New follow-ups":

> FU-SL-1 (QA Q-1): SmartLink returns `{}` when page 2 fails. This is its existing never-fatal behaviour, but it is worth a look.

QA Q-1 ([FINANCE_FOLLOWUPS_BUNDLE_WORKPLAN.md](/docs/workplans/FINANCE_FOLLOWUPS_BUNDLE_WORKPLAN.md), line 879):

> What happens: a failed page gives `{ data: {}, error: null }`, so the figure is absent rather than an error result. That is the method's existing never-fatal contract, and the comment in the code records it.
> Why it matters: "never a partial figure" holds. A caller cannot tell a failed read from a read with no links, but that was already true before this bundle.

### Step 0 facts

| # | Fact | Where |
|---|---|---|
| SL-1 | `uniqueVisitorsByLink(userId, linkIds, days = 30)` reads `smart_link_clicks` in pages of 1,000 up to 20,000. Any page error throws, and the `catch` logs `logger.error` and returns `{ data: {}, error: null }`. That applies to page 1 as well as later pages | `lib/repositories/SmartLinkRepository.ts:591-673` |
| SL-2 | **One caller**: `GET /api/smart-links`. It is a Business OS user route (`getUser()`, not admin) | `app/api/smart-links/route.ts:102-112` |
| SL-3 | The route reads the links first, with its own read (`listByUser`). Only that read's error gives a 500. The uniques result only feeds `unique_visitors: uniques.data?.[link.id] ?? 0` | `route.ts:70-77`, `:108-112` |
| SL-4 | **So on a failed count, the business owner sees every link, each with "0 Unique Visitors".** It is never "no links" | `route.ts:111` |
| SL-5 | Consumers of `/api/smart-links` (GET): `app/business-os/website/page.tsx` (lines 1331, 1367, 1670) and `components/business-os/CustomerAcquisitionList.tsx:146`. **Only the website page reads `unique_visitors`**: the Smart links row figure `link.unique_visitors ?? 0` (`page.tsx:4724`, type `unique_visitors?: number` at `:187`). `CustomerAcquisitionList` and `LandingPageWizard` (POST/PUT only) never read it | grep |
| SL-6 | In the same row, the Rate figure already shows a muted `'—'` when there is no reading (`click_count === 0`) | `page.tsx:4725-4731` |
| SL-7 | Existing test: `lib/repositories/__tests__/rangeCapTrancheA.paging.test.ts:149-152` asserts `{ data: {}, error: null }` on a page-2 failure. It is an expectation, not a pin | — |
| SL-8 | Out of scope, recorded only: at the 20,000 ceiling the count is a floor (logged as a warning), but the page shows it as exact | `SmartLinkRepository.ts:631-636` |

### Fix

- **Repository:** the `catch` returns `{ data: null, error }`, wrapped as an `Error` if needed. The `logger.error` stays. The doc comment drops "never fatal" and says that the caller decides. `linkIds.length === 0` still returns `{ data: {}, error: null }`, because that is a real "no links".
- **Route:** on `uniques.error`, log `requestLogger.warn({ err }, 'Unique visitor counts unavailable; listing links without them')`, and send `unique_visitors: null` on every link. The response stays **200 with every link**: a failed count must not hide the list, so the route does not 500 (SA-Q-FU2-5). On success, nothing changes.
- **Page (`app/business-os/website/page.tsx`):** the type becomes `unique_visitors?: number | null`. The cell shows the number when it is a number. When it is null or missing, the cell shows a muted `'—'` with the same `muted` styling the Rate cell uses at no clicks (SL-6). This is the BQ-FU2-1 default.
- The page change is one cell. The pure rule (`number → itself, else '—' muted`) moves to a small helper, `app/business-os/website/smartLinkFigures.ts` (new, about 15 lines), so it can be unit-tested without rendering the 9,479-line page.

### What each page shows

| Page | Today, count fails | After, count fails | After, count works |
|---|---|---|---|
| Business OS → Website → Smart links (business user) | Every link listed, "0" unique visitors each | Every link listed, a muted "—" for unique visitors (BQ-FU2-1). Clicks, conversions and rate unchanged | Unchanged |
| Customer acquisition list (business user) | Unaffected (does not read the field) | Unaffected | Unchanged |
| Any admin page | No caller | No caller | — |

### Tests

| # | File | Case |
|---|---|---|
| TSL-1 | `lib/repositories/__tests__/rangeCapTrancheA.paging.test.ts` (edit lines 149-152) | Page-2 failure → `data: null`, `error` an `Error`, `logger.error` called. Still never a partial count |
| TSL-2 | same (new) | Page-1 failure → the same. Empty `linkIds` → `{ data: {}, error: null }` with no request |
| TSL-3 | `app/api/smart-links/__tests__/route.test.ts` (new; `getUser` and repositories mocked) | Happy path: 200, each link carries its count. Uniques failure: 200, every link listed, `unique_visitors: null`, warn logged, no 500. Unauthenticated: 401, no read. List read failure: 500 with the generic message, as today |
| TSL-4 | `app/business-os/website/__tests__/smartLinkFigures.test.ts` (new) | `5 → '5'`, not muted; `0 → '0'`, not muted (a real zero stays zero); `null` / `undefined` → `'—'`, muted |

---

## Files to Create / Modify

| File | Action | Item | Reason |
|---|---|---|---|
| `app/admin/finance/components/PayingBreakdownSection.tsx` | modify | 4 | Comped figures through `atLeast` |
| `lib/business-os/finance/payingBreakdown.ts` | modify (doc comment only) | 4 | Say how the cut-off reaches the page |
| `app/admin/finance/__tests__/payingBreakdown.render.test.tsx` | modify (append) | 4 | T4-1 to T4-3 |
| `lib/business-os/finance/__tests__/financeHealth.test.ts` | modify (append one case) | 4 | T4-4 |
| `app/admin/ai-cost/aiCostDrawerReads.ts` | modify | 7a | Kind, not sentence |
| `app/admin/ai-cost/components/AiCostDrawers.tsx` | modify | 7a, 7b | Switch on kind; in-place full view; focus |
| `app/admin/ai-cost/components/AiCostView.tsx` | modify | 7b | `openFullView` |
| `app/admin/ai-cost/__tests__/aiCostDrawerReads.test.ts` | modify | 7a | T7a-1 |
| `app/admin/ai-cost/__tests__/aiCostDrawers.render.test.tsx` | modify (append) | 7a, 7b | T7a-3, T7b-1 to T7b-5 |
| `scripts/typecheck-bos-llm.baseline.json` | modify (shrink only) | BLL-FU-1 | 16 fixed keys removed |

**Not touched:** `SmartLinkRepository.ts`, `app/api/smart-links/**`, `app/business-os/website/**` (FU-SL-1 out of scope), `BlockKpi.tsx`, `LeakCheckPanel.tsx`, `CreditsSection.tsx`, `TakingsSection.tsx`, `financePage.render.test.tsx`, `financeHealth.ts`, `financeTypes.ts`, the finance route and its test, `BusinessOsBillingAdminReadRepository.ts`, `lib/admin/billing/**`, `useDrawerResource.ts`, `useAdminFilters.ts`, `KpiStrip.tsx` (its `isPlainLeftClick` is imported, not edited).

---

## Overlaps

### PR #536 (section tiles on the 5-tile grid)

**#536 merged (`e9b0fc77`) before this branch's tip (`8967888c`), so there is nothing left to conflict with.** This bundle touches none of its files (BlockKpi, CreditsSection, TakingsSection, LeakCheckPanel, financePage.render.test). The BlockKpi markup hash on this tree is the post-#536 `d2557496` (`BlockKpi.render.test.tsx:58`), and it does not move. `AiCostDrawers.tsx` renders `LeakCheckPanel`, but it does not edit it.

### Item 8, MK5B-FU-1 (worktree `neuronforge-mk5bfu`, branch `fix/finance-paying-first-payment-scale`; no changes on disk at 2026-10-27)

| Area | Item 8 | This bundle | Overlap |
|---|---|---|---|
| First-payment read, `BusinessOsBillingAdminReadRepository`, `lib/admin/billing` | Changes | Not touched | None |
| `financeHealth.ts` (the converted block; `firstPaymentsAll` feeds `trialsToPaid`) | Changes | **Not touched** under option A | None. Under option B there would be one hunk near `:1512`, close to item 8's input |
| Finance route test, AC-145 expected calls and hash | Moves | **Not touched** under option A | None. Under option B, **both PRs move the same `EXPECTED_SHA256`**, and whichever merges second must re-freeze again |
| `financeHealth.test.ts` | Likely appends converted cases | One appended case (T4-4) in the MK-9 describe | Textual only, in different blocks. The PR that merges second takes `main` in |
| `payingBreakdown.ts` / `PayingBreakdownSection.tsx` | Item 8 may change what `paid` means (the trial-to-paid input) but probably not these files | Comped render plus one doc line | Low. A different hunk if both edit |

---

## Pin and baseline moves

Step 0 hashes are LF-normalised SHA-256 on `8967888c`.

| Pin / baseline | Moves? | Item | Ruling needed |
|---|---|---|---|
| **AC-145** (`route.test.ts` `EXPECTED_SHA256` `38897cd3`) | **No** (option A). It would move under option B | 4 | SA-Q-FU2-1 |
| **AC-173** (one request on load, `3a1a2dd4` / helper `b84e0c96`) | No | — | — |
| **Pin A** (`KpiStrip.callers.pin`, `a130d560`) | No (`isPlainLeftClick` is imported, not changed; no KpiTile caller changes) | — | — |
| **Pin B** (`financeTiles.pin`, `eac3590a`) | No | — | — |
| **Pin C** (`chargeChecksRequest.pin`, `e57f2675` / `64a565e9`) | No. The in-place full view's one request equals the row 7 literal, asserted in the drawer test, not in the pin | 7b | — |
| **Pin D** (`m5WordingOnly.pin`, `1f7cf07a`) | No | — | — |
| **T-12** (`aiCostRequests.render.test.tsx`, `c2891a35`) | No: load requests unchanged | 7b | — |
| **BlockKpi markup hash** (`d2557496`) | No | — | — |
| **`typecheck:bos-llm` baseline** | **Yes, a shrink only:** 24 keys / 31 errors → 8 / 11 (expected), with the shrink-only proof | BLL-FU-1 | SA-Q-FU2-6 (the ruled re-freeze) |
| Finance livemode guard, CUR-3, CPU leak guard (`ALLOWED`) | No | — | — |
| Range-cap allow-list | No | — | — |

Test expectations that change but are **not pins**: `rangeCapTrancheA.paging.test.ts:149-152` (TSL-1) and the 409 case in `aiCostDrawerReads.test.ts` (T7a-1).

---

## Acceptance criteria

| ID | Criterion | Item |
|---|---|---|
| FU2-AC-1 | On a cut plan walk, the Comped total and both parts read "At least N". On an exact walk they read plain numbers. A failed paying read still reads "Comped: Could not check" | 4 |
| FU2-AC-2 | No payload key changes (option A). AC-145 passes unedited | 4 |
| FU2-AC-3 | The platform notice in the AI cost drawer is chosen by a kind derived from status 409 plus code `platform_account`. A failure whose text equals the platform sentence shows as an error. No `=== COSTS_PLATFORM_ACCOUNT` remains in `AiCostDrawers.tsx` | 7a |
| FU2-AC-4 | A plain left click on "Open full view" switches the page in place: no document load, the drawer closes, that business is picked on Summary & checks in the same window, and exactly one request is sent (the Pin C row 7 report literal). From the period drawer, `#costs-periods` is scrolled into view | 7b |
| FU2-AC-5 | A modified click on "Open full view" is left to the browser, and the `href` is unchanged | 7b |
| FU2-AC-6 | After a full view, focus is on the Summary & checks tab. After any other close, focus returns to the opener, as today | 7b |
| FU2-AC-7 | T-12 and Pin C pass unedited | 7 |
| FU2-AC-8 | `typecheck:bos-llm` passes with `0 new` and no "fixed" line. The baseline diff removes lines only. Every removed key was in the gate's "fixed" list. Before and after counts are recorded | BLL-FU-1 |
| FU2-AC-12 | Pins A–D, AC-173, T-12, AC-145, the BlockKpi hash, the livemode guard, CUR-3 and the CPU leak guard are unchanged. `npm run test:bos-entitlements` is not needed (no entitlements import) | all |
| FU2-AC-13 | The touched-file typecheck is clean, `npm run build` passes, and no `console.*` is added | all |

---

## Estimate

| Item | Estimate | Notes |
|---|---|---|
| 4 (MK9-FU-2) | 0.2 d | Render change plus 4 tests |
| 7a | 0.2 d | Reader union, provider switch, 3 tests |
| 7b | 0.4 d | Click handler, focus routing, 5 render tests (jsdom `scrollIntoView` and `replaceState` stubs) |
| BLL-FU-1 | 0.2 d | Mostly wall time: two gate runs at about 8 min each, plus the proof script |
| FU-SL-1 | — | Out of scope — assigned to Offir (user, 2026-10-27) |
| Ship drill (build, touched-file typecheck, suites) | 0.05 d | — |
| **Total** | **about 1.05 d** | FU-SL-1 (0.45 d) left the bundle |

---

## Risks

| # | Risk | Mitigation |
|---|---|---|
| R-1 | Option A ties Comped's "at least" to `trials.status`. A later change could split the two reads | T4-4 pins the invariant at the builder. The comment names it. Option B is available if SA prefers it |
| R-2 | 7b changes Back behaviour: the full view no longer adds a history entry | It follows the page's replace-only rule (S7b-3). SA-Q-FU2-4 offers push |
| R-3 | 7b focus: Radix `onCloseAutoFocus` runs after the switch has re-rendered, so the opener is gone | Focus is routed by a ref set before the close. T7b-4 asserts it |
| R-4 | The baseline shrink runs out of memory locally, or `main` moves between the run and merge | Run with 8 GB. Regenerate after the last `main` merge-in. A concurrent PR that fixes more errors only makes the gate print "fixed" again (non-blocking). One that adds an error would have failed anyway |
| R-5 | (Out of scope — assigned to Offir (user, 2026-10-27)) FU-SL-1 makes a business user see "—" where they saw "0" | That is the intent. BQ-FU2-1 asks the user. The list itself never disappears |
| R-6 | Other callers rely on `uniqueVisitorsByLink` never erroring | There is one caller (SL-2), and it is updated in the same PR |
| R-7 | The website page is 9,479 lines and has no render harness | The change is one type and one cell, with the rule unit-tested in a helper. QA does a manual check of the Smart links tab |

---

## SA questions

| ID | Question | Dev default |
|---|---|---|
| SA-Q-FU2-1 | Item 4: option A (UI derives Comped's exactness from `trials.status`, the same plan walk; no payload change, no AC-145 move) or option B (`FinanceCompedSplit.status`, a payload key; AC-145 re-freeze that collides with item 8's)? | **A**, with T4-4 pinning the invariant |
| SA-Q-FU2-2 | Item 7a: a local data union in the AI cost reader (`{ kind: 'platform_account' }` as data), or an optional `kind` on the shared `DrawerRead` failure branch (a shared-layout change across 15 other files)? | **Local union.** No shared change |
| SA-Q-FU2-3 | Item 7b focus after a full view: the Summary & checks tab button (always mounted), the `#costs-periods` section (needs `tabIndex={-1}` in a guarded `business-os-llm` file), or the business picker? | **The Summary & checks tab**, with `preventScroll` |
| SA-Q-FU2-4 | Item 7b history: `setFilters` (replace, as every in-page change on this page and the strip tiles' `apply`) or `router.push` (keeps today's Back-to-all-businesses entry, but adds a second history writer next to `useAdminFilters`)? | **Replace (`setFilters`)** |
| SA-Q-FU2-5 | FU-SL-1: on a count failure, keep the route at 200 with `unique_visitors: null`, or fail the whole route (500) so the page shows its error state? | **200 with null.** A failed side figure must not hide the business's links |
| SA-Q-FU2-6 | BLL-FU-1: approve the baseline as a ruled shrink-only re-freeze, 24/31 → 8/11 (or the numbers on the final tree), with the shrink-only proof script output pasted into Implementation Notes? | **Yes** |
| SA-Q-FU2-7 | Item 4: should the cut-off notice ("Not every account could be read, so these counts are 'at least'.") also cover Comped? Today it sits inside the trial block only | **No markup move.** The "At least" words on each Comped figure and the section's partial status are enough. Moving the notice would edit the existing cut-walk render test |
| SA-Q-FU2-8 | SL-8 (the 20,000-ceiling floor shown as exact on Smart links) is out of scope. Record it as FU-SL-2? | **Yes, record only** |

---

## Business questions (separate)

| ID | Question | Recommended default |
|---|---|---|
| **BQ-FU2-1** (Out of scope — assigned to Offir (user, 2026-10-27)) | On **Business OS → Website → Smart links**, when we cannot count a link's unique visitors for a moment (a database read fails), what should the business owner see in that link's "Unique visitors" figure? Today they see **0**, which reads as "nobody came". | **A muted "—"** in that figure only, the same look the Rate figure already uses when there is no reading. Clicks, conversions and rate stay as they are, and there is no banner. Alternatives: (b) hide the figure for that load; (c) "—" plus a small "Couldn't count visitors right now" note, which needs English, Spanish and Hebrew copy |

---

## Task List

- [x] Step 1: SA reviews this workplan (SA-Q-FU2-1 to -8). The user answers BQ-FU2-1.
- [x] Step 2: Item 4: render change, T4-1 to T4-4.
- [x] Step 3: Item 7a: reader union and provider switch, T7a-1 to T7a-4.
- [x] Step 4: Item 7b: in-place full view and focus routing, T7b-1 to T7b-5. T-12 and Pin C pass unedited.
- [x] Step 6: Merge `origin/main` in. BLL-FU-1: `--update-baseline`, a clean gate run, the shrink-only proof, before and after counts.
- [x] Step 7: Ship drill step 1: `npm run build`, touched-file typecheck, suites (finance, ai-cost, admin layout and guards, `test:bos-llm`), and pin hashes re-recorded.
- [ ] Step 8: Hand to SA (code review), then QA.


## Implementation Notes (Dev, 2026-10-27)

**Tree:** branch `chore/finance-followups-bundle-2`, fast-forwarded (no commits of its own) to `origin/main` `8a1ffad2` (#538) before the final runs. Uncommitted. No stash.

**Item 4 (MK9-FU-2), option A.** `PayingBreakdownSection.tsx` prints Comped and both parts through the same `n()` as the trial counts, with a comment naming the invariant. `payingBreakdown.ts`: two doc lines only. Tests: T4-1 to T4-3 in `payingBreakdown.render.test.tsx`; T4-4 appended in the MK-9 describe of `financeHealth.test.ts` (capped walk → Comped non-null, all "Assigned", `trials.status` `partial`, `accounts.status` `partial`). Planted control: with the component restored to `HEAD`, T4-1 fails (1 failed, 10 passed).

**Item 7a (FU2-C1).** `readAiCostDrawer` answers `DrawerRead<AiCostDrawerData>`; a 409 **and** the code `platform_account` is `{ ok: true, data: { kind: 'platform_account' } }`. The provider switches on `state.data.kind`; the `=== COSTS_PLATFORM_ACCOUNT` comparison is gone. `useDrawerResource` / `DrawerRead` untouched. Reader tests: the 409 case now expects the kind; new cases for another 409 (error), the code on a 400 (error), and the sentence as a reason (error). Render: T7a-3 (a 400 whose reason is the sentence shows `ai-cost-drawer-error`). Source: T7a-4 with planted controls.

**Item 7b (FU2-C2).** `FullViewLink` keeps its `href`; a plain left click (`isPlainLeftClick`, imported from `KpiStrip`, not edited) prevents the load and calls the provider's `onFullView`: mark the close, `setTarget(null)`, then `AiCostView.openFullView` = `setFilters({ ...tabPatch('checks'), account })` plus the anchor scroll on the next frame (as `tabLink.apply`). `onReturnFocus` sends focus to `#ai-cost-tab-checks` with `preventScroll` after a full-view close, else to the opener as before. No `router`, no `next/link`. Tests (appended): T7b-1/T7b-5 business drawer (not prevented = false, drawer closes, report requests exactly `[load, ROW7, ROW7]`, URL `?account=<id>` via `replaceState`, no openers after); T7b-2 period drawer (third request = ROW7, `#costs-periods` scrolled); T7b-3 ctrl/meta/shift and a non-left button left alone (no request, drawer stays); T7b-4 focus on the tab. The existing Escape-focus test is unedited and passes.

**Planted control for 7a/7b:** with `AiCostDrawers.tsx`, `aiCostDrawerReads.ts` and `AiCostView.tsx` restored to `HEAD`, the drawer render suite gives 5 failed / 24 passed (T7a-3, T7a-4, T7b-1, T7b-2, T7b-4); restored after.

**BLL-FU-1 (SA-Q-FU2-6), on the final tree.**
- Gate with the **old** baseline on the final tree: `597 files in scope, 11 errors, 0 new`, `16 baseline entries are fixed`.
- `--update-baseline`: `baseline written (8 keys)`.
- Gate with the new baseline: `597 files in scope, 11 errors, 0 new`, no "fixed" line, `passed`.
- Shrink-only proof (scratchpad script, not committed), verbatim:

```text
before: 24 keys / 31 errors
after:  8 keys / 11 errors
removed keys: 16; lowered counts: 0; gate fixed list: 16
PASS: (a) every key old, (b) every count <= old, (c) every removed/lowered key in the fixed list
```

- `git diff --numstat scripts/typecheck-bos-llm.baseline.json`: `0 16` (0 added, 16 deleted).

**Pins re-hashed after the last edit (LF-normalised SHA-256), all unchanged:** AC-145 `38897cd3` (route test unedited), AC-173 `3a1a2dd4` / `b84e0c96`, Pin A `a130d560`, Pin B `eac3590a`, Pin C `e57f2675` / `64a565e9`, Pin D `1f7cf07a`, T-12 `c2891a35`, BlockKpi `d2557496` (constant unedited). No diff against `origin/main` in `app/api/**`, `app/admin/components/**`, `lib/admin/**`, `financeHealth.ts`, `financeTypes.ts`, so the livemode guard, CUR-3, the CPU `ALLOWED` list and the range-cap list cannot have moved.

**Checks:** full `tsc --noEmit` (8 GB, completed, not OOM): 1,849 pre-existing errors, **0 in any touched file**. ESLint on the touched files: clean. `console.*` added: 0.

**Build:** `npm run build` (8 GB) **compiled successfully** ("Compiled with warnings", then "Compiled successfully"). It then stopped at "Collecting page data" for `/api/admin/dashboard` (not touched) with "Missing Supabase environment variables": this worktree has no `.env.local`, only `.env.example`. That is an environment gap, not a code failure. I did not copy secrets into the worktree. CI's Build check on the PR is the authoritative run.

## SA Review Notes

### SA Workplan Review (SA-WP-FU2)

**Reviewed by SA — 2026-10-27** (worktree at `8967888c`)
**Status:** ✅ Approved with conditions (FU2-C1 to FU2-C5). Item 7b and FU-SL-1 wait for the user's two answers (see below).

**Fit.** Each finding that differs from the brief checks out against the code:
- **Item 4:** in `trialsToPaid`, `status` is exactly `capped ? 'partial' : 'ok'`. The billing-status read can only fail, never be cut. So the walk's flag is the only cut-off Comped has, and it already reaches the page.
- **7a:** the text match is in the provider (`AiCostDrawers.tsx`); the reader already matches on status and code.
- **FU-SL-1:** the real defect is a false "0 unique visitors" on a business-user page.
- No migration, no new route, no new repository method. No `console.*` in the touched code: the one hit in `website/page.tsx` is a comment.

**Rulings**

| # | Ruling |
|---|---|
| SA-Q-FU2-1 | **Option A.** `trials.status` is a direct function of the same plan walk's `capped`, so it is the right signal. It needs no payload key, does not move AC-145, and does not collide with item 8. **T4-4 is required**: it pins the builder-level invariant that a capped walk gives a non-null Comped together with `trials.status === 'partial'`. If a later change gives Comped its own cut-off source, option B becomes due then. |
| SA-Q-FU2-2 | **The local union.** It follows the `useCostReport` `{kind}` precedent and makes no shared `DrawerRead` change across 15 files. Treating a platform account as *data* (`ok: true`) is right, because the page shows it as a notice, not an error. T7a-3 (a 400 whose reason equals the sentence shows as an error) is the proof, and it must fail on today's code. |
| SA-Q-FU2-3 | **The Summary & checks tab button, with `preventScroll`.** It is always mounted, and the user lands on the tab they were sent to. Adding a `tabIndex` in a guarded `business-os-llm` file is not worth it. |
| SA-Q-FU2-4 | **Replace (`setFilters`), if the user accepts the Back change.** That matches the page's one-writer, replace-only rule and the strip tiles' `apply`. **If the user does not accept it:** leave "Open full view" as today's plain `<a>` (it pushes, and Back returns), and close 7b as *won't change*. **Do not** add a `router.push` beside `useAdminFilters`, because two history writers is a new pattern for a cosmetic gain. 7a ships either way. |
| SA-Q-FU2-5 | **200 with `null`.** A failed side figure must not hide the business's links. The route logs a warn (the page then shows "—"), and a failed list read still returns 500 as today. |
| SA-Q-FU2-6 | **Yes, a ruled shrink-only re-freeze.** Regenerate on the **final** tree after the last `origin/main` merge-in, then run the gate again: `0 new` and no "fixed" line. Paste the proof script's output (every key old, every count ≤ old, every removed key in the gate's "fixed" list) into the Implementation Notes. `git diff --numstat` on the file must show 0 added lines. Expected 24/31 → 8/11. Other numbers are fine if `main` moved, as long as the proof holds. |
| SA-Q-FU2-7 | **No markup move.** "At least" on each Comped figure plus the section's partial status is enough, and moving the notice would edit a cut-walk test for no gain. |
| SA-Q-FU2-8 | **Yes, record FU-SL-2 only** (the 20,000-ceiling floor shown as exact). It belongs with the Smart links owner, not a finance bundle. |

**Conditions**
1. **FU2-C1 (7a):** the reader still checks **both** status 409 and code `platform_account`. Every other 409 stays an error (T7a-1). T7a-4 has a planted control.
2. **FU2-C2 (7b):** a modified or middle click is left alone (T7b-3). Exactly one request after the switch, equal to the Pin C row 7 literal (T7b-1). The existing Escape-focus test stays **unedited**. T-12 and Pin C pass unedited.
3. **FU2-C3 (FU-SL-1):**
   - `linkIds.length === 0` stays `{ data: {}, error: null }` with no request.
   - A real 0 still shows "0" (TSL-4).
   - The route test covers 401 with no read, uniques failing with 200, null and the warn, and the list failing with 500.
   - The muted "—" reuses the Rate cell's existing class, with no new copy, so no he/es strings are needed **under the default**. If the user picks option (c), its English, Spanish and Hebrew copy come back to SA before building.
   - QA does a manual check of the Smart links tab.
4. **FU2-C4 (pins):** Pins A to D, AC-173, T-12, AC-145, the `BlockKpi` hash `d2557496`, the livemode guard, CUR-3, the CPU `ALLOWED` list and the range-cap list must not move. The only ruled move is the bos-llm baseline shrink. Re-hash after the last edit.
5. **FU2-C5 (overlap with item 8):** this bundle's only shared file is `financeHealth.test.ts`, with one appended case (T4-4) in the MK-9 describe. Item 8 edits the MK-5b block and its own cases, so the hunks differ. Whichever merges second takes `main` in and re-runs the finance suites. Do the BLL-FU-1 regeneration **after** that merge-in.

**Business questions (for the user, via TL):**
- **BQ-FU2-1:** the default (a muted "—") is sound.
- **The 7b Back change:** a genuine user-visible trade-off. Ask it in plain words: "After 'Open full view', should the Back button return to the all-businesses view (today), or leave the AI cost page (the in-place switch)?" My recommended default is the in-place switch. If the user says no, 7b is dropped, not rebuilt with a second history writer (SA-Q-FU2-4).

### Approval
[x] Workplan approved with conditions FU2-C1 to FU2-C5. Items 4, 7a and BLL-FU-1 may proceed now. 7b and FU-SL-1's cell proceed once the user answers.

### SA Code Review (SA-CR-FU2)

**Code Review by SA — 2026-10-27** (uncommitted tree on `8a1ffad2`; scope: items 4, 7a, 7b and BLL-FU-1. FU-SL-1 and FU-SL-2 were dropped at the user's request and handed to Offir. The user accepted the 7b Back change.)
**Status:** ✅ Code Approved

**What I read**
- The diffs of `PayingBreakdownSection.tsx`, `aiCostDrawerReads.ts`, `AiCostDrawers.tsx` and `AiCostView.tsx`.
- `git diff --numstat`: the baseline file is 0 added / 16 removed; FIN is 3 / 0. Nothing is deletion-only except the baseline, and that one is meant to shrink.

**Conditions**

| # | Verdict |
|---|---|
| FU2-C1 (7a) | ✅ `{ kind: 'platform_account' }` is returned only when **both** `status === 409` and the code equals `PLATFORM_ACCOUNT_CODE`. Every other failure stays `{ ok: false, message }`. The provider switches on `state.data.kind` and renders the notice with the constant, and the text comparison is gone. The new cases (another 409, a 400 carrying the code, the sentence used as a reason) are all errors. The source scan has planted controls. |
| FU2-C2 (7b) | ✅ The real `href` is kept, and a modified or middle click returns early, so the browser handles it. A plain left click calls `preventDefault`, sets a ref, closes the drawer and runs `setFilters` (replace). That makes exactly one extra request, equal to Pin C row 7. The period drawer scrolls to `#costs-periods` on the next frame, as `tabLink` does. Focus goes to the Summary & checks tab with `preventScroll`; any other close still returns to the opener. The Escape test is unedited. With the source reverted, 5 tests fail. T-12 and Pin C are unedited. |
| FU2-C3 | Not applicable: FU-SL-1 was dropped and handed off. Its §0.4 record is in place. |
| FU2-C4 | ✅ No pin moved: AC-145 `38897cd3`, AC-173, Pins A to D, T-12 and `BlockKpi` `d2557496`. There is no diff in `app/api`, the admin components, `lib/admin`, `financeHealth.ts` or `financeTypes.ts`. The only ruled move is the baseline. |
| FU2-C5 | ✅ The baseline was shrunk **after** the merge with `main`: 24/31 → 8/11, 0 lines added, with the proof output in the notes and a clean gate run. The overlap with item 8 is one appended case (T4-4) in a different describe. |

**Item 4:** the three Comped figures go through the section's existing `n()` (`atLeast` with `trials.status === 'ok'`). "Could not check" is unchanged. T4-4 pins the builder invariant (capped walk ⇒ Comped present and `partial`). The `payingBreakdown.ts` change is a doc comment only.

### Code Review Comments
1. `AiCostDrawers.tsx`, `closedForFullViewRef`: the flag is cleared only in `returnFocus`. If a future change ever closed the drawer without calling `onReturnFocus` after a full view, the *next* ordinary close would send focus to the tab. Today `setTarget(null)` always closes through `AdminDrawer`, which calls it, so this is fine as built. Low; does not block.

### Code Approved for QA: Yes

## QA Testing Report

### QA — finance follow-ups bundle 2, 2026-10-27

**Test mode:** full. **Strategy used:**
- A / B: Jest. Independent probes through the real AI cost page (jsdom, a copy of the drawer suite's harness), a reader matrix, and a byte-level render comparison against main's component.
- The BLL-FU-1 proof script.
- A scoped tsc with a canary.

**Focus:** ui, api (client reads). **Skipped:** `npm run build` (no env in the worktree; CI's required Build, as Dev noted) and FU-SL-1/2 (out of scope, Offir). **Input source:** coordinator prompt + FU2-AC-n, FU2-C1..C5, SA-CR-FU2.

**Verdict: PASS.** No bugs.

#### Test Coverage

| Criterion | Tested? | Result | Notes |
|---|---|---|---|
| FU2-AC-1 item 4: cut walk → "At least N" ×3; exact → plain; failed paying read → "Could not check" | ✅ | Pass | Probe vs main's `PayingBreakdownSection` (`git show 8a1ffad2:`). Cut walk: "Comped: At least 1,234 · Assigned, no subscription At least 1,000 · Subscription ended or not paying At least 234", and the rest of the section is byte-identical to main (only the Comped line blanked). Byte-identical to main in 6 other states: exact walk, too few, paid unknown, paying read failed (Comped null, "Could not check"), Comped null + trials unknown, paying tile unknown |
| FU2-AC-2 no payload change | ✅ | Pass | AC-145 `EXPECTED_SHA256` still `38897cd3`, and the route test is unedited and green |
| FU2-AC-3 / FU2-C1 item 7a | ✅ | Pass | Reader matrix on `readAiCostDrawer`. **Only** 409 + `platform_account` gives `{ kind: 'platform_account' }`. Errors: 409 + another code; 409 + the sentence as the reason; 409 with no `error`; 409 with the code in another field; 400, 403 and 500 carrying `platform_account`; 400 + the sentence. 200 gives `{ kind: 'report' }`. No `=== COSTS_PLATFORM_ACCOUNT` in `AiCostDrawers.tsx` (T7a-4 green). Render T7a-3 green |
| FU2-AC-4 / FU2-C2 item 7b plain click | ✅ | Pass | Through the real page. Period drawer → plain click: the drawer closes, **exactly one** extra report request, equal to Pin C row 7, no leak request, and still one after settling (300 ms); URL `?account=<id>` via `replaceState`; `pushState` never called; Summary & checks tab `aria-selected`; `#costs-periods` scrolled (T7b-2). Business drawer: T7b-1 / T7b-5 green |
| FU2-AC-5 modified clicks left to the browser | ✅ | Pass | ctrl, meta, shift and button-1 clicks (T7b-3) are not prevented. A real middle click (`auxclick`, button 1, plus mousedown / mouseup) is not prevented, sends 0 requests and the drawer stays (QA probe). The `href` is unchanged |
| FU2-AC-6 focus | ✅ | Pass | After a full view, focus is on `#ai-cost-tab-checks`. Business drawer: Escape and the Close button both return focus to the opener row button (QA probe); period drawer Escape test unedited and green |
| SA Low note (flag cleared only in `returnFocus`) | ✅ | Pass | Probe: period drawer → full view (focus on the tab) → **Clear** back to all businesses → open row B → Escape → focus on **row B's button**, not the tab; open it again → Close button → focus on row B again. Requests in order: load, drawer A, full view A, reload all, drawer B, drawer B |
| FU2-AC-7 T-12 and Pin C unedited | ✅ | Pass | `c2891a35`, `e57f2675` / `64a565e9`; green |
| FU2-AC-8 BLL-FU-1 | ✅ | Pass | See below |
| FU2-AC-12 pins | ✅ | Pass | LF-normalised: Pin A `a130d560`, Pin B `eac3590a`, Pin C `e57f2675` / `64a565e9`, Pin D `1f7cf07a`, AC-173 `3a1a2dd4` / `b84e0c96`, T-12 `c2891a35`, AC-145 `38897cd3`, BlockKpi `d2557496`. No diff in `app/api/**`, `lib/admin/**`, `app/admin/components/**`, `financeHealth.ts`, `financeTypes.ts` |
| FU2-AC-13 typecheck, no console | ✅ (build: CI) | Pass | Scoped tsc over the 9 touched .ts/.tsx files (8 GB, no OOM): the only error is the canary in `AiCostDrawers.tsx`; restored, `cmp` clean. 0 `console.*` added |
| Smart links untouched (FU-SL-1/2 out of scope) | ✅ | Pass | No diff in `SmartLinkRepository.ts`, `app/api/smart-links/**`, `app/business-os/website/**` or `rangeCapTrancheA.paging.test.ts` |

#### BLL-FU-1 (re-run by QA)
- `origin/main` (fetched, now `81d3bd47`): its baseline is byte-identical to `8a1ffad2`'s.
- Gate on this tree with **`origin/main`'s baseline** swapped in, then restored with `cp` and checked with `cmp`: `597 files in scope, 11 errors, 0 new`, `16 baseline entries are fixed`, passed.
- Gate with the **branch baseline**: `597 files in scope, 11 errors, 0 new`, **no "fixed" line**, passed. No OOM in either run (8 GB).
- `shrink-proof.js <origin/main baseline> <branch baseline> <gate output>`:
  ```text
  before: 24 keys / 31 errors
  after:  8 keys / 11 errors
  removed keys: 16; lowered counts: 0; gate fixed list: 16
  PASS: (a) every key old, (b) every count <= old, (c) every removed/lowered key in the fixed list
  ```
- `git diff --numstat origin/main -- scripts/typecheck-bos-llm.baseline.json`: `0 16`.

#### Runs

| Run | Result |
|---|---|
| `app/admin/ai-cost`, `app/admin/finance`, `lib/business-os/finance`, `app/admin/business-os-llm`, `app/admin/components`, `lib/admin`, `app/api/admin/business-os/finance` | 147 / 147 suites, 6,911 / 6,911 tests |
| `npm run test:bos-llm` | 23 / 636 |
| `npm run test:bos-entitlements` | 319 / 9,559 (not required here; run anyway) |
| `npm run test:authz-guard` | 2 / 203 |

#### Issues Found
**Bugs:** none.

**Observations (no action required here):**
1. **O-1:** `origin/main` moved past `8a1ffad2` (the plan-payments P-7a files, among others). Its baseline is unchanged, and the gate here was run on this tree. Per FU2-C5, whichever merges second re-runs the gate on the combined tree; the merge queue / CI covers it.
2. **O-2:** after a full view the Back button leaves the AI cost page. This is the accepted trade-off (SA-Q-FU2-4); `replaceState` only, no `pushState`, confirmed.

#### Probes
All deleted; none kept:
- `app/admin/ai-cost/__tests__/zz_fu2_7b.render.test.tsx`
- `app/admin/ai-cost/__tests__/zz_fu2_7a.test.ts`
- `app/admin/finance/__tests__/zz_fu2_item4.render.test.tsx`
- `app/admin/finance/components/zz_OldPayingBreakdownSection.tsx`

The baseline swap and the canary were each restored with `cp`, and `cmp` confirmed both restores. No source changed, no commit, no stash.

#### Final Status
- [x] All acceptance criteria pass — ready for commit (build proof: CI's required Build)
- [ ] Issues found — Dev must address before commit

## Commit Info

_RM populates this section._

---

## Change History

| Date | Change | Details |
|---|---|---|
| 2026-10-27 | Workplan written | Step 0 on `4e75ed9f`, branch fast-forwarded to `8967888c`. Four items, about 1.5 d, no pin moves except the ruled bos-llm baseline shrink |
| 2026-10-27 | SA workplan review (SA-WP-FU2) | Approved with conditions FU2-C1 to FU2-C5. Q-1 option A with T4-4 required; Q-2 local union; Q-3 the tab button; Q-4 replace, or if the user rejects the Back change drop 7b (no second history writer); Q-5 200 with null; Q-6 a ruled shrink-only baseline re-freeze on the final tree; Q-7 no move; Q-8 FU-SL-2 recorded. Waiting on the user for BQ-FU2-1 and the Back change |
| 2026-10-27 | Scope change (coordinator, user decision) | FU-SL-1 and FU-SL-2 are out of scope, assigned to Offir (user, 2026-10-27). FU-SL-1 section kept as the hand-over reference; its tasks, files, tests and FU2-AC-9 to FU2-AC-11 removed. User accepted the 7b Back change; 7b proceeds |
| 2026-10-27 | Dev: items 4, 7a, 7b and BLL-FU-1 built (uncommitted) | Option A; local union; in-place full view with tab focus; baseline 24/31 → 8/11 shrink-only proof PASS. No pin moved. FU-SL-1 not built (out of scope) |
| 2026-10-27 | SA code review (SA-CR-FU2) | Code approved for QA. FU2-C1, C2, C4 and C5 met; C3 not applicable (FU-SL dropped). No pin moved; the baseline shrank 24/31 → 8/11 (0 lines added). One Low note on the full-view focus flag |
