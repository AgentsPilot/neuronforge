# Workplan: Admin BOS Cleanup, Slice 2 (Model pricing split, plus the free tier move)

> **Last Updated**: 2026-10-03

**Developer:** Dev
**Requirement:** [ADMIN_BOS_CLEANUP_REQUIREMENT.md](/docs/requirements/ADMIN_BOS_CLEANUP_REQUIREMENT.md): §4.8 FR-PR1, FR-PR2, FR-PR4, FR-PR5, FR-PR6; §4.9 FR-FT1, FR-FT2; the slice 2 lines of §9; and **SA Review — slice 2 (2026-10-03), conditions C2-1 to C2-12** (binding). **FR-PR3 (Sync) is PARKED** (UC-5, §11 "Model price source and Sync") and is not touched here.
**User decision UC-6 (2026-10-03):** two AgentsPilot routes not converted in slice 2. This answers SA's Q-SA2-1 with **no**. `app/api/admin/boost-packs/route.ts` and `app/api/admin/calculator-config/route.ts` are not edited. They are recorded as known AgentsPilot debt (section 9.2). The main session records UC-6 in the requirement. This workplan does not edit the requirement.
**Branch:** `fix/admin-pricing-split`, created by RM from `origin/main` `5061489b`. Work happens in the worktree `neuronforge-admin-docs`, which also holds the uncommitted requirement edit (Sync parked, SA's slice 2 review). That edit stays as it is.
**Process:** Full cycle: Dev workplan → SA workplan review → Dev implement → SA code review → QA → the user sees the uncommitted diff → user approval → RM. Dev commits nothing.
**Date:** 2026-10-03
**Status:** Code Complete. The SA workplan review approved it with W2-1..W2-9, carried (see Implementation Notes). SA code review APPROVED and QA PASS WITH NOTES (2026-10-03); the main session applied the optional fixes (Refresh `aria-label` on both pages, a saved-row guard, two blank lines). Awaiting the user's diff review. Nothing committed.
**Effort:** S to M, about 1 to 1.5 days (SA §E, without Q-SA2-1). Breakdown in [section 12](#12-effort-estimate).

## Overview

`/admin/system-config` puts the `ai_model_pricing` table, which every Business OS credit charge is computed from, on the same page as four AgentsPilot settings. Those settings are the payment grace period, boost packs, the Pilot Credit calculator, and a read-only JSON dump. This slice cuts the 1,989-line page in two:

- `/admin/system-config` becomes **"Model pricing"**. It keeps only the pricing table, and Sync is unchanged.
- A new client page, `/admin/agentspilot-billing`, takes everything else, verbatim. It is listed only in the hidden AgentsPilot (parked) sidebar section.

"Free tier & onboarding" moves to the same parked section. The Plans & entitlements description now says that the Business OS trial lives there.

Three more changes come with the split:

- Price-change audits are flushed before the pricing route responds (C2-7).
- Both pages log through `clientLogger` instead of the 20 `console.*` calls.
- A failed price read shows an error instead of an empty table (C2-4).

No route is added, moved or renamed. No database change, and no authz guard or gate-list change.

---

## Table of Contents

- [1. Analysis Summary](#1-analysis-summary)
- [2. Implementation Approach](#2-implementation-approach)
- [3. Files to Create / Modify / Delete](#3-files-to-create--modify--delete)
- [4. Task List](#4-task-list)
- [5. Test Plan](#5-test-plan)
- [6. Manual QA Check](#6-manual-qa-check)
- [7. Acceptance Criteria This Slice Closes](#7-acceptance-criteria-this-slice-closes)
- [8. Conditions Traceability (C2-1 to C2-12)](#8-conditions-traceability-c2-1-to-c2-12)
- [9. Logging Compliance (`console.*`)](#9-logging-compliance-console)
- [10. Risks and Rollback](#10-risks-and-rollback)
- [11. PR Body Draft](#11-pr-body-draft)
- [12. Effort Estimate](#12-effort-estimate)
- [13. Open Points for SA](#13-open-points-for-sa)
- [Implementation Notes](#implementation-notes)
- [SA Review Notes](#sa-review-notes)
- [QA Testing Report](#qa-testing-report)
- [Commit Info](#commit-info)
- [Change History](#change-history)

---

## 1. Analysis Summary

Read on `fix/admin-pricing-split` @ `5061489b`. Line numbers are from that commit.

| Area | As built today | What this slice does |
|---|---|---|
| `app/admin/system-config/page.tsx` (1,989 lines, `'use client'`, 20 `console.*`) | One component `SystemConfigPage`, with shared state for `loading`, `saving`, `error`, `success` and the collapse flags (all sections collapsed by default, `:61-64`). Here is where each part is used. **Pricing only:** `pricingModels` and `editingPricing` / `editedInputCost` / `editedOutputCost` (`:53-58`), `handleEditPricing`, `handleCancelEditPricing`, `handleSavePricing`, `handleSyncPricing` (`:273-361`), `formatCost` (`:533`), and the JSX `:599-831`. **AgentsPilot only:** `billingConfig`, `boostPacks` and its edit, delete and add state, `pilotCreditCostUsd` (`:67-102`), `calcConfig` (`:105-129`), `handleSaveCalculatorConfig`, `handleSaveBillingConfig`, `calculateBoostPackCredits`, `handleSaveBoostPack`, `handleDeleteBoostPack` (`:363-531`), Billing JSX `:833-1427`, Calculator JSX `:1429-1926`, and the Advanced dump `:1928-1985`. **Shared:** `fetchData` (`:135-271`) makes four reads. A failed settings read throws, and the whole page drops to the error banner (S2-8). A failed pricing read is swallowed: the table renders empty with no message (`:213-215`). | Cut, not copied (SA §C). Pricing parts stay. AgentsPilot parts move. `fetchData` is split. |
| Sync (C2-1, UC-5) | The button (`:618-634`, labels "Sync Latest Pricing" / "Syncing..."), helper text (`:614`), info-box paragraph (`:668`), `handleSyncPricing` (`:328-361`, one `console.error` at `:356`), comment `:350`. Route `pricing/sync/route.ts` | **Unchanged byte for byte.** The only edit is the `:356` logging line. Listed in 2.1. |
| `app/api/admin/system-config/pricing/route.ts` (359 lines, 0 `console.*`) | PUT reads the row first, then `await logAIPricingUpdated(..., { before, after }).catch(...)` (`:240-243`), then `reportZeroPrice` (`:245`, which may queue `AI_PRICING_ZERO_SET`). POST (`:296-304`) and DELETE (`:345-349`) also audit. **No flush.** `auditLog` only queues (S2-5). | C2-7: one flush per write handler, after every audit call and before the success response. |
| `app/api/admin/system-config/pricing/__tests__/route.test.ts` (27 cases) | Mocks `@/lib/audit/admin-helpers`. Does **not** mock `@/lib/services/AuditTrailService`, because the route does not import it today. | Adds an `AuditTrailService` mock that records order, plus the flush cases (5.2). |
| `app/api/admin/system-config/route.ts` | Header `:23-24` says that `app/admin/system-config/page.tsx` is its caller. | C2-9: the header names the parked page. No code change. |
| `app/admin/components/AdminSidebar.tsx` (0 `console.*`) | Settings is `[business-os-llm, system-config ("Model pricing & billing"), onboarding ("Free tier & onboarding"), settings]`. Parked has 13 items. The Plans & entitlements description is "Business OS plans, read-only". The parked comment `:190` says "twelve always-open items" (stale before this slice). | C2-6 data changes (2.4). |
| `app/admin/components/__tests__/AdminSidebar.nav.test.ts` | Settings exact list `:108-113`. "thirteen" at `:116-117` and `:217-218`. Disk floor 27 `:136`. `allHrefs` 26 `:151`. The regex `[^']+` cannot read an apostrophe. | C2-6 edits (5.3). |
| `app/admin/business-os-llm/__tests__/nav.test.ts` | Needs `/admin/system-config` after business-os-llm in Settings, with no section title between them, and needs the pricing page never to contain `business-os-llm` | **Unedited.** Must stay green. |
| `app/api/admin/system-config/__tests__/dataAccess.test.ts` | Scans every file under `app/api/admin/system-config/**` for `createClient`, the raw clients, `.from('…')` and `console.*` | **Unedited.** Importing `@/lib/services/AuditTrailService` into the pricing route matches none of these patterns. |
| `lib/admin/__tests__/admin-authz-surface.guard.test.ts` | R8: every render entry under `app/admin/**` is a client component or guards itself. R3: no `route.ts` under `app/admin/**`. | **Unedited.** The new page is `'use client'` with no server props, and no route is added. |
| `app/api/admin/__tests__/adminGate.writes.test.ts` (pinned at 57) | Covers `boost-packs` and `calculator-config`. The three system-config routes are covered by their own suites (`:342`). | **Unedited.** No handler is added or removed. |
| `app/admin/components/AdminHeader.tsx` | Maps five routes. Others fall through to "Admin Console". | **Not touched** (SA §C). |
| `docs/admin/ADMIN_IDENTIFICATION_AND_ACCESS.md` | `:68` and `:95` say 26 `/admin` pages. On disk at `5061489b`: **27** (`/admin` plus 26 directories). `:95` says "The 5 added since", lists 4 names, and misses `business-os-invites`. | C2-11 (2.6). |
| Reads of the moved settings (S2-3, S2-4, S2-6, S2-7) | SA traced every reader. No Business OS code reads `payment_grace_period_days`, `pilot_credit_cost_usd` (either store), `boost_packs`, the calculator config or `free_tier_*`. | Everything moves, and the FR-PR2 exception does not apply. Dev re-runs one grep sweep in T-1 so it is on record against this commit. |

**Deprecated or non-compliant code noticed, not extended:**

- `app/api/admin/boost-packs/route.ts` and `app/api/admin/calculator-config/route.ts` build a service-role client inline (OI-9), have no Zod, use `console.*` and return raw error text. They are recorded as AgentsPilot debt under UC-6 (section 9.2).
- `app/api/pricing/config/route.ts` (22 `console.*`, inline client) is recorded as debt per SA §B.
- The two-store "pilot credit cost" drift (S2-2) and the R-21 phantom (S2-4) are AgentsPilot debt that SA has already recorded. The moved code reproduces them unchanged.

**Skills consulted:**

- `new-api-route`, for the pricing route edit (flush, non-blocking audit, `NODE_ENV` guard already in place). Its checklist line "never `await` the audit in the success path" predates WC-7. See O-6.
- `business-os-schema-check`: **not needed** (SA §C, "Schema"). No select changes, and the moved code is verbatim.
- `tenant-isolation-guard`: not triggered. There is no new service-role write, and the pricing table is platform-wide and admin-gated.
- `business-os-entitlements`: not triggered. Nothing is imported from `lib/business-os/entitlements/`, and the Plans & entitlements change is a sidebar string only.
- `durable-queue-drain`: not applicable.

---

## 2. Implementation Approach

### 2.1 Pricing page: `app/admin/system-config/page.tsx` (C2-1, C2-2, C2-4, C2-8)

The page becomes the old page with the Billing, Calculator and Advanced sections cut out. What stays:

| Kept | Detail |
|---|---|
| Imports | `useEffect`, `useState`, `motion`, and the lucide icons the pricing JSX uses: `RefreshCw`, `AlertCircle`, `CheckCircle`, `DollarSign`, `Edit`, `X`, `Check`, `Download`, `ChevronUp`, `ChevronDown`. Add `import { clientLogger } from '@/lib/logger/client'` and `const logger = clientLogger.child({ module: 'AdminModelPricingPage' })` (the slice 1 precedent, `app/admin/settings/page.tsx:27-29`). |
| Types | `ModelPricing` only. `SystemSetting` moves. |
| State | `loading`, `saving`, `error`, `success`, `pricingModels`, the three pricing edit states, `pricingExpanded`. **New:** `pricingReadFailed: boolean` (C2-4). |
| Handlers | `handleEditPricing`, `handleCancelEditPricing`, `handleSavePricing` and `handleSyncPricing`, verbatim except the logging lines. `formatCost`. |
| JSX | The loading spinner, the header, the success and error banners, the refresh button, and the AI Model Pricing `motion.div` (`:599-831`). |

**Component name:** `SystemConfigPage` becomes `ModelPricingPage`. The default export keeps the route working, and nothing imports the name.

**Header (C2-2):**
- `<h1>`: "Model pricing".
- The "System Config" badge `<span>` is removed.
- The subtitle becomes: "AI cost per token for each model. Every Business OS credit charge is computed from these prices." It says nothing about Sync.

**`fetchData` (pricing only).** It is one `try / catch / finally` around a single `GET /api/admin/system-config/pricing`:

```typescript
const fetchData = async (silent = false) => {
  try {
    if (!silent) setLoading(true);
    setError(null);
    const response = await fetch('/api/admin/system-config/pricing', { method: 'GET', cache: 'no-store' });
    if (!response.ok) {
      logger.error({ status: response.status }, 'Model prices read failed');
      markPricingReadFailed();
      return;
    }
    const result = await response.json();
    if (!result.success) {
      logger.error({ status: response.status }, 'Model prices read returned unsuccessful');
      markPricingReadFailed();
      return;
    }
    setPricingModels(result.data);
    setPricingReadFailed(false);
    logger.debug({ count: result.data.length }, 'Model prices loaded');
  } catch (err) {
    logger.error({ err }, 'Model prices read threw');
    markPricingReadFailed();
  } finally {
    if (!silent) setLoading(false);
  }
};
```

`markPricingReadFailed()` sets `pricingReadFailed = true`, clears `pricingModels` to `[]`, and sets the existing banner with `setError('Could not load model prices.')`. Clearing the list keeps a stale table from posing as fresh after a failed refresh. Because `pricingReadFailed` is set, the table is not drawn at all (next paragraph).

**C2-4 rendering.** Inside the expanded section, when `pricingReadFailed` is true, the `<table>` is replaced by one line in classes already on the page: `<p data-testid="pricing-read-failed" className="text-sm text-red-400">Model prices could not be read. Use the refresh button to try again.</p>`. The banner shows whether or not the section is expanded. A **successful** empty list keeps today's rendering, an empty `<tbody>`. That is a true answer, not a failure.

**C2-1 strings: not changed, and pinned by the source guard (5.1).** Each string below stays byte for byte. The `handleSyncPricing` body also stays the same apart from its one logging line.

| # | String or code |
|---|---|
| S-1 | `Token costs for all AI models. Sync to get latest pricing from providers.` |
| S-2 | `Sync Latest Pricing` (button label, also in the info-box `<strong>`) |
| S-3 | `Syncing...` |
| S-4 | `<strong className="text-green-300">Sync Latest Pricing:</strong> Automatically fetches current rates from OpenAI and Anthropic APIs. Keeps system aligned with provider pricing changes. Run monthly or when providers announce updates.` |
| S-5 | `// Refresh pricing data after sync since it fetches from external API` |
| S-6 | `fetch('/api/admin/system-config/pricing/sync', {` with `method: 'POST'` |
| S-7 | `'Failed to sync pricing'`, `result.message \|\| 'Pricing synced successfully!'`, `await fetchData(true);`, `setTimeout(() => setSuccess(null), 5000);` |
| S-8 | `app/api/admin/system-config/pricing/sync/route.ts` (`git diff` empty, T-9) |

Only `:356` changes: `console.error('Error syncing pricing:', error)` becomes `logger.error({ err: error }, 'Pricing sync failed')`.

`handleSyncPricing` still calls `await fetchData(true)`. That now re-reads only prices, which is all it needed. If that silent refresh fails, the C2-4 banner shows next to the Sync success banner. That is accurate.

**Not changed:** the collapse default (`pricingExpanded` starts `false`, see O-2), the info box (including "Impact on Intelligent Routing"), the table markup, and the edit controls. One `data-testid="pricing-toggle"` goes on the chevron button so the render test can expand the section without keying on an icon. No visual change (D-4).

### 2.2 Parked page: `app/admin/agentspilot-billing/page.tsx`, new (C2-3, C2-5, C2-8)

This is a `'use client'` page with no props. It inherits `requireAdminPage()` from `app/admin/layout.tsx`. It is the old page minus the pricing section:

| Part | Detail |
|---|---|
| Component | `AgentsPilotBillingPage`, default export. |
| Logger | `clientLogger.child({ module: 'AdminAgentsPilotBillingPage' })`. |
| Types | `SystemSetting` moves verbatim except `value: any` becomes `value: unknown`. Every read already casts (`setting.value as string`, `:167`, `:170`), so behaviour does not change and rule 6 is met. `BoostPack` stays an interface inside the component, as today. |
| State | `loading`, `saving`, `error`, `success`, `billingExpanded`, `calcExpanded`, `advancedExpanded`, `billingConfig`, all boost-pack state, `pilotCreditCostUsd` and `calcConfig`. **No** `pricingModels` and no pricing edit state. |
| `fetchData` | Today's `:135-271` minus the pricing block (`:191-216`): settings (throws on failure, as today), boost packs (swallowed, as today), `/api/pricing/config` (swallowed, as today). Logging is converted per section 9.1. |
| Handlers | `handleSaveCalculatorConfig`, `handleSaveBillingConfig`, `calculateBoostPackCredits` (still uses the `billing`-category `pilot_credit_cost_usd`, S2-2), `handleSaveBoostPack`, `handleDeleteBoostPack`. Verbatim except logging. |
| Header | `<h1>`: "AgentsPilot billing". Subtitle: "Parked AgentsPilot settings: payment grace period, boost packs and the Pilot Credit calculator. Business OS does not read any of them." No badge. Same refresh button, same banners. |
| Billing section | Verbatim. **One change (FR-PR5, C2-5):** the `<h3>` "Boost Pack Management" (`:991`) becomes **"AgentsPilot boost packs"**. The "Add Boost Pack" button, the add form and the "Create Boost Pack" button are unchanged. |
| Calculator section | Verbatim. |
| Advanced section (C2-3) | The `<pre>` prints `JSON.stringify({ calculator: calcConfig }, null, 2)`. `pricing_models` is dropped. Still read-only and collapsed by default. Two copy lines would become false after C2-3, so they are proposed for correction (O-1): the subtitle "Complete system configuration in JSON format. Use with caution - incorrect values may affect platform stability." becomes "The calculator configuration in JSON format, read-only."; the note "This is a read-only view of all system settings. To modify values, use the specific configuration sections above." becomes "This is a read-only view of the calculator configuration. To modify values, use the Calculator Configuration section above." |
| Imports | `useEffect`, `useState`, `motion`, and the icons the moved JSX uses. T-5 sets the exact list by running ESLint on unused imports. Today's file imports `Settings`, `Brain`, `Cpu` and `Zap` among others; anything unused on both pages is dropped, not carried over. |

### 2.3 Pricing route audit flush: `app/api/admin/system-config/pricing/route.ts` (C2-7)

- Add `import { AuditTrailService } from '@/lib/services/AuditTrailService';` and, at module scope next to `logger`, `const auditTrail = AuditTrailService.getInstance();`. This is the entitlements route precedent (`business-os/entitlements/accounts/[accountId]/route.ts:35`, `:61`).
- **PUT:** after `await reportZeroPrice(...)` (`:245`) and before the success `return`, add:
  ```typescript
  // WC-7 / C2-7: flushed BEFORE the response. `auditLog` only queues, and a
  // serverless instance can be frozen the moment it responds; a price change
  // with no audit row is the failure this prevents. Non-blocking: a failed
  // flush never turns a saved price into a 500.
  await auditTrail.flush().catch((err) => requestLogger.error({ err }, 'Audit flush failed'));
  ```
  The flush comes after `reportZeroPrice`, so one flush covers both `AI_PRICING_UPDATED` and any `AI_PRICING_ZERO_SET`.
- **POST:** the same line after `reportZeroPrice` (`:304`).
- **DELETE:** the same line after the `if (pricingToDelete) { … }` audit block (`:345-349`), before the success `return`.
- No flush on the 400, 401, 403, 404 or 500 paths. They queue no audit row.
- **Header comment:** the "Audit:" paragraph gains one sentence saying the write handlers flush the queued entries before responding (C2-7). `:25-26` changes from "`app/admin/system-config/page.tsx` needs no change" to "the Model pricing page (`app/admin/system-config/page.tsx`) needs no change". Nothing else in the file changes.
- **Sync route not touched** (C2-1). Its `logAIPricingSynced` stays queued and unflushed. This is noted in the PR body for the parked Sync session.

### 2.4 Sidebar: `app/admin/components/AdminSidebar.tsx` (C2-6, FR-PR1, FR-FT1, FR-FT2)

Data and comments only. No icon import is added.

| Entry | Before | After |
|---|---|---|
| Plans & entitlements (Businesses) | `description: 'Business OS plans, read-only'` | `description: 'Business OS plans & trial, read-only'`. The comment above it gains: "The Business OS free plan is the entitlements trial, shown here (FR-FT2)." |
| `/admin/system-config` (Settings, second) | `name: 'Model pricing & billing'`, `description: 'Pricing, grace period, boosts'` | `name: 'Model pricing'`, `description: 'AI cost per model; sets Business OS charges'`. The comment says the AgentsPilot billing settings moved to `/admin/agentspilot-billing` (ADMIN_BOS_CLEANUP slice 2). |
| `/admin/onboarding` | In Settings: `name: 'Free tier & onboarding'`, `description: 'Free-tier grant & signups'` | **Moved** to the end of the parked section. Name unchanged, `description: 'AgentsPilot free-tier grant & signups'`. Comment: the Business OS free plan is the trial on Plans & entitlements (FR-FT1). |
| `/admin/agentspilot-billing` | none | **New** last parked item: `name: 'AgentsPilot billing'`, `href: '/admin/agentspilot-billing'`, `icon: DollarSign` (already imported, and the icon is hidden with its section), `description: 'AgentsPilot boost packs, grace, calculator'`. |

The result:

- Settings is `[business-os-llm, system-config, settings]`.
- Parked has 15 items.
- No new name or description contains an apostrophe (parser constraint, S2-10).
- Names stay unique.

Comment fixes: the parked comment's "twelve always-open items" becomes a dated count ("fifteen after ADMIN_BOS_CLEANUP slice 2"). The header doc-comment gains one line naming slice 2's moves.

### 2.5 Comment in `app/api/admin/system-config/route.ts` (C2-9)

`:23-24` becomes: "Response shapes are deliberately identical to the pre-Step-0 route. Since ADMIN_BOS_CLEANUP slice 2 the only caller is `app/admin/agentspilot-billing/page.tsx` (grace period and the `billing` rows), which needed no route change." No code change. `RESERVED_KEY_PREFIX` stays untouched, because `modelSettingsPolicy.test.ts:330` reads it.

### 2.6 Docs (C2-11)

Targeted `Edit` insertions only, with `git diff --stat` after each one (truncation hazard). The expectation is insertions plus single-line replacements, never a large deletion.

**`docs/admin/ADMIN_IDENTIFICATION_AND_ACCESS.md`:**
1. Truth-table row `:95`:
   - "All 26 `/admin` pages" becomes "All 28 `/admin` pages".
   - "The 5 added since" becomes "The 7 added since", and the list gains `business-os-invites` (invite-only signup slice 0, missing from the list today) and `agentspilot-billing` (ADMIN_BOS_CLEANUP slice 2, a client page).
   - The re-count line becomes "Re-counted 2026-10-03 from disk: 27 on `5061489b`, 28 after ADMIN_BOS_CLEANUP slice 2."
2. `:68` ("26 `/admin` pages") is historical text inside a dated paragraph (2026-09-27) and stays as written. The re-count goes in the truth table and the Change History row.
3. Change History: one new row at the end, "2026-10-03 | ADMIN_BOS_CLEANUP slice 2: `/admin` pages 27 → 28". The details:
   - `agentspilot-billing` is added as a client page under the guarded layout and inherits the guard without an edit.
   - No handler, register row, census or cap changes.
   - `system-config/pricing` write handlers now flush their audit before responding.
4. `> **Last Updated**` becomes 2026-10-03.

**`docs/BOOST_PACK_ADMIN_INTERFACE.md`** (optional per C2-11, planned because it is cheap): one inserted line under the `:9` heading: "> Moved 2026-10-03 (ADMIN_BOS_CLEANUP slice 2): the boost-pack admin UI is now at `/admin/agentspilot-billing` (AgentsPilot, parked). `/admin/system-config` holds only model pricing." No other edit. The doc is historical.

The requirement is **not** edited by Dev. The main session records UC-6 there.

---

## 3. Files to Create / Modify / Delete

| File | Action | Change |
|---|---|---|
| `app/admin/agentspilot-billing/page.tsx` | **create** | Parked page (2.2): Billing (grace period, "AgentsPilot boost packs"), Calculator, Advanced (calculator only). `clientLogger`, no `console.*`. |
| `app/admin/system-config/page.tsx` | modify (about −1,400 lines) | Pricing only (2.1): header "Model pricing", pricing-only `fetchData`, C2-4 failed-read state, 9 `console.*` converted, Sync unchanged. |
| `app/admin/system-config/__tests__/source.guard.test.ts` | **create** | C2-10 source guard (5.1). |
| `app/admin/system-config/__tests__/pages.render.test.tsx` | **create** | C2-2 / C2-3 / C2-4 / C2-5 runtime proof (5.4). |
| `app/api/admin/system-config/pricing/route.ts` | modify | C2-7 flush ×3, header comment (2.3). |
| `app/api/admin/system-config/pricing/__tests__/route.test.ts` | modify | `AuditTrailService` mock and flush cases (5.2). |
| `app/api/admin/system-config/route.ts` | modify (comment only) | C2-9 (2.5). |
| `app/admin/components/AdminSidebar.tsx` | modify | C2-6 data and comments (2.4). |
| `app/admin/components/__tests__/AdminSidebar.nav.test.ts` | modify | C2-6 counts, Settings list, new pins (5.3). |
| `docs/admin/ADMIN_IDENTIFICATION_AND_ACCESS.md` | modify (targeted Edit) | C2-11 (2.6). |
| `docs/BOOST_PACK_ADMIN_INTERFACE.md` | modify (one inserted line) | Optional C2-11 pointer. |
| `docs/workplans/ADMIN_BOS_CLEANUP_SLICE_2_WORKPLAN.md` | create (this file) | Workplan. |

**Deleted:** none. No route, page or test file is removed (D-3).

**Explicitly not touched:**

- `app/api/admin/system-config/pricing/sync/route.ts` and its test (C2-1).
- `app/api/admin/boost-packs/route.ts` and `app/api/admin/calculator-config/route.ts` (**UC-6**).
- `app/api/pricing/config/route.ts` (debt, SA §B).
- `app/admin/onboarding/page.tsx` and `app/api/admin/onboarding-config/route.ts` (TA-13).
- `AdminHeader.tsx`, `app/admin/layout.tsx`, `business-os-llm/__tests__/nav.test.ts`, `dataAccess.test.ts`, `adminGate.writes.test.ts`, the authz guard.
- `docs/requirements/ADMIN_BOS_CLEANUP_REQUIREMENT.md` (main session).

---

## 4. Task List

- [x] ✅ **T-1 Baselines** on `5061489b`:
  - Run `AdminSidebar.nav`, `business-os-llm/__tests__/nav`, `system-config/pricing/__tests__/route`, `system-config/pricing/sync/__tests__/route`, `system-config/__tests__/route`, `dataAccess`, `adminGate.writes` and `admin-authz-surface.guard`. Record the pass counts.
  - `grep -c "console\."` on the page and the pricing route (expect 20 / 0).
  - Reader sweep on record: `git grep -n "payment_grace_period_days\|boost_packs\|free_tier_" -- lib/business-os app/business-os app/api/business-os` (expect no hits; this confirms S2-3 / S2-6 / S2-7 on this commit).
  - Count `/admin` pages from disk (expect 27).
- [x] ✅ **T-2** Write the source guard (5.1) and the render test (5.4) first. Confirm they fail on the current page.
- [x] ✅ **T-3 Create** `app/admin/agentspilot-billing/page.tsx` by copying the current page, then **deleting** the pricing state, handlers, fetch block and JSX from the copy (2.2). Apply the heading change (FR-PR5), the header, C2-3 and the logging conversions (9.1).
- [x] ✅ **T-4 Trim** `app/admin/system-config/page.tsx` to the pricing parts (2.1). Apply the header (C2-2), the new `fetchData`, C2-4 and the logging conversions. Sync strings S-1 to S-8 untouched.
- [x] ✅ **T-5 Imports.** Run ESLint on both pages. Drop unused imports so neither page has more warnings than its share of today's file. Re-run the source guard and the render test until green.
- [x] ✅ **T-6 Pricing route flush** (2.3) and the route test cases (5.2). Run them with `dataAccess.test.ts` unedited.
- [x] ✅ **T-7 `system-config/route.ts`** header comment (2.5).
- [x] ✅ **T-8 Sidebar** data and comments (2.4), and the nav test edits (5.3), in the same change. Run `AdminSidebar.nav` and `business-os-llm/__tests__/nav` (unedited).
- [x] ✅ **T-9 Sweeps:**
  - `git diff --exit-code 5061489b -- app/api/admin/system-config/pricing/sync app/api/admin/boost-packs app/api/admin/calculator-config app/api/pricing app/admin/onboarding app/api/admin/onboarding-config app/admin/components/AdminHeader.tsx` (expect empty).
  - `git grep -n "console\." -- app/admin/system-config app/admin/agentspilot-billing` (expect 0).
  - `git grep -n "boost-packs\|calculator-config\|/api/pricing/config\|payment_grace_period_days" -- app/admin/system-config/page.tsx` (expect 0).
- [x] ✅ **T-10 Scoped `tsc`.** Use a scratch tsconfig (`"extends": "../tsconfig.json"`, `"include": []`, `files` = the 9 code and test files) with `NODE_OPTIONS=--max-old-space-size=8192`. Judge by **exit code**, and compare with the same run on `5061489b` (with the new files removed). `npx eslint` on the touched code files: 0 errors, and no new warnings beyond today's. `npm run lint:hooks` exits 0.
- [x] ✅ **T-11 Wider regression:** `npx jest app/admin app/api/admin lib/admin lib/business-os/llm`. Record the counts and any known flake.
- [x] ✅ **T-12 Docs** (2.6). Run `git diff --stat` after each Edit.
- [x] ✅ **T-13** Fill in "Implementation Notes", tick the tasks, set the status to Code Complete. Leave everything **uncommitted**.
- [ ] **T-14** (QA / user) Manual browser check, section 6. **Owed.**

---

## 5. Test Plan

### 5.1 Source guard: `app/admin/system-config/__tests__/source.guard.test.ts` (new, C2-10)

Reads `app/admin/system-config/page.tsx` (P) and `app/admin/agentspilot-billing/page.tsx` (B). Fetch assertions use the code with comments stripped (the `codeOf` idiom from `business-os-invites/__tests__/source.guard.test.ts`). The Sync assertions use the raw source, because S-5 is itself a comment.

| # | Assertion |
|---|---|
| G-1 | P contains none of `'/api/admin/boost-packs'`, `'/api/admin/calculator-config'`, `'/api/pricing/config'`, or `'/api/admin/system-config'` with the closing quote (the settings read; the pricing path continues with `/pricing`). |
| G-2 | P does not contain `payment_grace_period_days`, `pilot_credit_cost_usd` or `boost`. The last is a lowercase check: no boost-pack state is left behind. |
| G-3 | P and B contain no `console.` |
| G-4 | B contains `AgentsPilot boost packs`. |
| G-5 | P contains each C2-1 string S-1 to S-7, verbatim (2.1). S-7 is checked as its four literal fragments. |
| G-6 | B does not contain `'/api/admin/system-config/pricing'` or `pricing_models` (C2-3). B still contains `'/api/admin/boost-packs'`, `'/api/admin/calculator-config'` and `'/api/admin/system-config'`, which proves the cut did not drop a fetch. |
| G-7 | Both files start with `'use client'` and import `clientLogger` from `@/lib/logger/client`. |
| G-8 | P's `<h1>` text is `Model pricing`. P does not contain `System Config</span>`. |

### 5.2 Pricing route: `app/api/admin/system-config/pricing/__tests__/route.test.ts` (extended, C2-7)

Add `jest.mock('@/lib/services/AuditTrailService', …)`, shaped like `business-os/entitlements/__tests__/routes.test.ts:54-66`: `getInstance()` returns `{ flush }`, where `flush` pushes `'flush'` to a shared `events` array and can be set to reject. The existing `logAIPricing*` mocks also push their names to `events`. All 27 existing cases stay as they are and must stay green.

| # | Case | Assertions |
|---|---|---|
| F-1 | PUT happy path | 200, and `events` equals `['updated', 'flush']`. The flush happens before the handler resolves. |
| F-2 | PUT with a zero input cost | `events` equals `['updated', 'zero', 'flush']`: one flush, after both audits. |
| F-3 | PUT when `flush` rejects | Still 200 with the unchanged body. The logger received `{ err }` with `'Audit flush failed'`. |
| F-4 | POST happy path | `events` ends with `'flush'` after `'created'`. |
| F-5 | DELETE happy path | `events` ends with `'flush'` after `'deleted'`. |
| F-6 | PUT 404 (no row), PUT 400, and a 403 non-admin | `flush` not called. |
| F-7 | PUT when the audit call rejects **and** flush succeeds | 200, flush still called. The existing RC-W10 case is extended. |

### 5.3 Sidebar: `app/admin/components/__tests__/AdminSidebar.nav.test.ts` (edited, C2-6)

| Edit | Detail |
|---|---|
| Settings list `:108-113` | `['/admin/business-os-llm', '/admin/system-config', '/admin/settings']` |
| `:116-119` | The title says "fifteen". `toHaveLength(15)`, and it also contains `/admin/onboarding` and `/admin/agentspilot-billing`. |
| `:217-218` | The title says "fifteen", `toHaveLength(15)`. |
| Disk floor `:136` | `toBeGreaterThanOrEqual(28)`, plus `toContain('/admin/agentspilot-billing')` and `toContain('/admin/onboarding')`. The comment gets the new count. |
| `allHrefs` `:151` | `toHaveLength(27)`. The comment gains "+ AgentsPilot billing (ADMIN_BOS_CLEANUP slice 2)". |
| New, under "labels are honest" | `/admin/system-config` is named exactly `Model pricing`, its description contains `Business OS`, and it is in Settings. The Plans & entitlements description contains `trial`. The `/admin/onboarding` entry is in the parked section and its description contains `AgentsPilot`. That last point is also covered by the existing every-parked-item test. |
| Header doc-comment | Item 7: (ADMIN_BOS_CLEANUP slice 2) Model pricing split and free tier moved to parked. |

`app/admin/business-os-llm/__tests__/nav.test.ts` runs **unedited**.

### 5.4 Pages render: `app/admin/system-config/__tests__/pages.render.test.tsx` (new)

`@jest-environment jsdom`. `@/lib/logger/client` is mocked as in `app/admin/settings/__tests__/page.render.test.tsx:19-28`. `global.fetch` is a URL router that records every URL called. Sections are expanded through `data-testid="pricing-toggle"` (and, on B, the existing chevron buttons, found by role order).

| # | Case | Assertions |
|---|---|---|
| R-1 | P, pricing returns 2 rows | `h1` is "Model pricing". After expanding, both `model_name`s render. **The only URL fetched** is `/api/admin/system-config/pricing` (C2-2). |
| R-2 | P, pricing returns 500 | The banner text is "Could not load model prices." After expanding, `pricing-read-failed` is present and no `<tbody>` row renders (C2-4). |
| R-3 | P, pricing returns 200 with `{ success: false }` | Same as R-2. |
| R-4 | P, pricing fetch throws | Same as R-2. Logger `error` received `{ err }`. |
| R-5 | P, Sync clicked, the sync route returns `{ success: true, message: 'ok' }` | POST to `/api/admin/system-config/pricing/sync`, then exactly one more pricing GET. The success banner shows "ok". Behaviour is unchanged. |
| R-6 | B loads | Fetches `/api/admin/system-config`, `/api/admin/boost-packs` and `/api/pricing/config`. **Never** `/api/admin/system-config/pricing`. The `h1` contains "AgentsPilot". After expanding Billing, the heading "AgentsPilot boost packs" and the "Add Boost Pack" button are present. |
| R-7 | B, Advanced expanded | The `<pre>` text parses as JSON with exactly the key `calculator` (C2-3). |
| R-8 | B, settings read returns 500 | The error banner shows. Behaviour is unchanged from today's page (S2-8 moves with it). |

### 5.5 Unchanged suites that must stay green

`business-os-llm/__tests__/nav.test.ts`, `system-config/__tests__/dataAccess.test.ts`, `system-config/__tests__/route.test.ts`, `system-config/pricing/sync/__tests__/route.test.ts`, `adminGate.writes.test.ts` (57), `admin-authz-surface.guard.test.ts` (R3, R8; no cap moves), `lib/business-os/llm/__tests__/modelSettingsPolicy.test.ts` (reads the system-config route source), and `lib/business-os/credits/__tests__/ownerCreditSurface.guard.test.ts`.

### 5.6 Type-check and lint

`ts-jest` does not type-check in this repo, so T-10's scoped `tsc` (exit code, compared with the baseline) is the type evidence for the split. It matters most for a cut that might leave a reference to a moved state variable. ESLint covers the touched code files.

---

## 6. Manual QA Check

As a platform admin on `npm run dev` (C2-12):

1. Sidebar, Settings: "Business OS AI", "Model pricing", "Admin users". No "Free tier & onboarding" and no "AgentsPilot billing" (the parked section is hidden). The Model pricing description "Sets every Business OS charge" shows in full, with no ellipsis (W2-9).
2. Businesses → Plans & entitlements: the description reads "Business OS plans & trial, read-only".
3. `/admin/system-config`: heading "Model pricing", with no badge and no Billing, Calculator or Advanced sections. The table is already open (W2-8), and the chevron collapses and reopens it. Edit one model's input cost, then save. The success banner shows, and **the row shows the new value straight after Save**, with no reload (W2-1). **Audit trail:** a new `AI_PRICING_UPDATED` row for that model, carrying `before` and `after`, appears **immediately**, not after a 5 s delay. Put the cost back afterwards; that writes a second row.
4. Sync: the button, its helper text and the info-box paragraph look exactly as before. **Do not press Sync on production.** On a local database only, pressing it behaves as before.
5. DevTools → Network on `/admin/system-config`: only `GET /api/admin/system-config/pricing`. Block that URL and refresh: the banner reads "Could not load model prices.", and the expanded section says the prices could not be read. No empty table.
6. `/admin/agentspilot-billing` by URL. Heading names AgentsPilot. Then:
   - Load the grace period, change it, save, reload. The value persists. Put it back.
   - Under "AgentsPilot boost packs", edit one pack and save. The computed credits match the old page's for the same price.
   - Open the Calculator, change one value, save, reload. The value persists. Put it back.
   - Advanced shows only `calculator`.
7. `/admin/onboarding` by URL still loads and behaves as before.
8. DevTools console on both pages: no raw response bodies are logged.

---

## 7. Acceptance Criteria This Slice Closes

| §9 slice 2 criterion | Proven by |
|---|---|
| `/admin/system-config` shows only the model pricing table. Editing a price still works and is audited with before and after. | G-1, G-2, R-1; existing PUT audit test; F-1 (flushed); QA step 3 |
| The four AgentsPilot sections load and save unchanged at their new URL-only page, which has one hidden sidebar entry. | R-6 to R-8, G-6; 5.3 parked count and href; QA step 6 |
| ~~Sync wording and confirmation~~ | **Out of scope** (UC-5, C2-1). Sync is unchanged: G-5, T-9. |
| The page and the moved sections contain no `console.*`. | G-3, T-9 |
| "Free tier & onboarding" is in the hidden parked group, and its route still loads. | 5.3; QA step 7 |
| The sidebar tests are updated in the same change and pass. | T-8 |
| All slices: a happy and a failure path per changed route; a QA manual check | F-1 to F-7 plus the 27 existing cases; section 6 |

---

## 8. Conditions Traceability (C2-1 to C2-12)

| Condition | Where |
|---|---|
| C2-1 Sync byte for byte; only `:356` logging changes | 2.1 (S-1 to S-8), G-5, T-9, R-5 |
| C2-2 pricing page: h1, no badge, subtitle, only pricing fetches; sidebar name and position | 2.1, 2.4, G-1, G-8, R-1, 5.3 |
| C2-3 Advanced dump moves, calculator only | 2.2, G-6, R-7, **O-1** |
| C2-4 failed pricing read is visible, never an empty list | 2.1, R-2 to R-4, QA step 5 |
| C2-5 parked page `'use client'`, verbatim, "AgentsPilot boost packs", grace and pilot credit cost move | 2.2, G-4, G-7, R-6 |
| C2-6 sidebar and tests in one change; business-os-llm nav test unedited | 2.4, 5.3, T-8 |
| C2-7 flush after audits on PUT, POST and DELETE, non-blocking; tests | 2.3, F-1 to F-7 |
| C2-8 `clientLogger`, no payloads, no `console.` (route half void under UC-6) | 9.1, G-3, QA step 8 |
| C2-9 system-config route header comment | 2.5 |
| C2-10 source guard and scoped `tsc` | 5.1, T-10 |
| C2-11 access doc re-count, page list, Change History; optional boost-pack pointer | 2.6, T-12 |
| C2-12 manual QA | Section 6 |

---

## 9. Logging Compliance (`console.*`)

Counted with `grep -c "console\."` on `5061489b`.

### 9.1 Files in this slice's diff

| File | Before | After | Plan |
|---|---|---|---|
| `app/admin/system-config/page.tsx` | **20** | 0 | 9 lines stay with the pricing page and are converted below. The other 11 lines move to the parked page. `:264` is in the shared `fetchData`, so it has a counterpart on both pages. |
| `app/admin/agentspilot-billing/page.tsx` (new) | (inherits 12) | 0 | Created already converted. |
| `app/api/admin/system-config/pricing/route.ts` | 0 | 0 | Already Pino. The flush logs with `requestLogger`. |
| `app/api/admin/system-config/route.ts` | 0 | 0 | Comment only. |
| `app/admin/components/AdminSidebar.tsx` | 0 | 0 | — |
| Test files (new or edited) | 0 | 0 | Loggers mocked. |

**Pricing page.** Each call becomes a line on `logger = clientLogger.child({ module: 'AdminModelPricingPage' })`:

| Line | Today | Becomes |
|---|---|---|
| `:199` | `console.error('Pricing API error:', status, statusText)` | `logger.error({ status }, 'Model prices read failed')` |
| `:201` | `console.error('Pricing API response:', errorText)` **(payload)** | Removed, together with the `await pricingResponse.text()` that fed it. Status only. |
| `:204` | `console.log('Pricing API result:', pricingResult)` **(payload)** | Removed. `:208` carries the count. |
| `:208` | `console.log('Loaded pricing models:', length)` | `logger.debug({ count }, 'Model prices loaded')` |
| `:210` | `console.error('Pricing API returned unsuccessful:', pricingResult.error)` | `logger.error({ status }, 'Model prices read returned unsuccessful')` |
| `:214` | `console.error('Failed to fetch pricing:', pricingError)` | `logger.error({ err }, 'Model prices read threw')` |
| `:264` | `console.error('Error fetching data:', error)` | Folded into the single catch above. The pricing `fetchData` has one `try`. |
| `:321` | `console.error('Error updating pricing:', error)` | `logger.error({ err: error, pricingId: modelId }, 'Model price save failed')` |
| `:356` | `console.error('Error syncing pricing:', error)` | `logger.error({ err: error }, 'Pricing sync failed')`. This is the C2-1 exception. |

**Parked page.** Each call becomes a line on `logger = clientLogger.child({ module: 'AdminAgentsPilotBillingPage' })`:

| Line | Today | Becomes |
|---|---|---|
| `:148` | `console.log('[SystemConfig] API response status:', status)` | `logger.debug({ status }, 'Settings response')` |
| `:152` | `console.error('[SystemConfig] API error response:', errorText)` **(payload)** | `logger.error({ status }, 'Settings read failed')`. The thrown `Error` text that feeds the banner is unchanged (behaviour). |
| `:157` | `console.log('[SystemConfig] Settings result:', settingsResult)` **(payload)** | `logger.debug({ count: settingsResult.data?.length ?? 0 }, 'Settings loaded')` |
| `:188` | `console.error('Failed to fetch boost packs:', e)` | `logger.error({ err }, 'Boost packs read failed')` |
| `:227` | `console.log('Calculator config result:', calcResult)` **(payload)** | Removed. `:256` carries the fact. |
| `:256` | `console.log('Loaded calculator config:', calcResult.config)` **(payload)** | `logger.debug('Calculator config loaded')`, with no payload. |
| `:260` | `console.error('Failed to fetch calculator config:', e)` | `logger.error({ err }, 'Calculator config read failed')` |
| `:264` | `console.error('Error fetching data:', error)` | `logger.error({ err: error }, 'Billing settings load failed')` |
| `:393` | `console.error('Error saving calculator config:', error)` | `logger.error({ err: error }, 'Calculator config save failed')` |
| `:433` | `console.error('Error saving billing configuration:', error)` | `logger.error({ err: error }, 'Grace period save failed')` |
| `:488` | `console.error('Error saving boost pack:', error)` | `logger.error({ err: error, packKey: pack.pack_key }, 'Boost pack save failed')` |
| `:526` | `console.error('Error deleting boost pack:', error)` | `logger.error({ err: error, packId }, 'Boost pack delete failed')` |

The six payload calls named in C2-8 are `:152`, `:157`, `:201`, `:204`, `:227` and `:256`. They now log status or count only, or are removed.

### 9.2 Files flagged under CLAUDE.md § Logging, not converted (UC-6 and SA §B)

The parked page still calls these routes, so Dev opens them to check the moved sections. Under CLAUDE.md § Logging they were flagged, and the conversion was proposed (SA Q-SA2-1). **The user declined on 2026-10-03 (UC-6: two AgentsPilot routes not converted in slice 2).** They stay as known AgentsPilot debt:

| File | `console.*` | Unguarded error details | Other debt | Status |
|---|---|---|---|---|
| `app/api/admin/boost-packs/route.ts` | **11** | **8** responses return `error.message` without the `NODE_ENV` guard | Inline service-role client at module scope (OI-9), no Zod on POST, PUT or DELETE, `catch (error: any)` | **Known AgentsPilot debt, UC-6.** Not edited. |
| `app/api/admin/calculator-config/route.ts` | **6**, one of which logs the whole `updates` body | **2** (`:82` inside `errors[]`, `:110`) | Inline service-role client, no Zod | **Known AgentsPilot debt, UC-6.** Not edited. |
| `app/api/pricing/config/route.ts` | **22**, no `createLogger` | — | Public non-admin route, inline client (rule 1) | **Debt per SA §B.** Not edited. |
| `app/admin/onboarding/page.tsx` | 3 | — | — | Not in the diff (TA-13: the move is a sidebar change). |
| `app/api/admin/onboarding-config/route.ts` | 3 | Returns `error.message` unguarded (TA-13) | — | Not in the diff (TA-13). |

---

## 10. Risks and Rollback

| Risk | Likelihood / impact | Mitigation |
|---|---|---|
| The cut drops or duplicates a handler, a state or a fetch, so a moved control silently stops saving | Medium / Med (AgentsPilot settings only) | Copy-then-delete, not retype (T-3). G-6 and R-6 prove all three AgentsPilot fetches are still on B and none of them on P. Scoped `tsc` catches a dangling reference (T-10). QA step 6 saves each control. |
| A Sync string is touched by accident | Low / High (it breaks UC-5) | G-5 pins S-1 to S-7. T-9 diffs the sync route empty. The code review diffs the `handleSyncPricing` hunk. |
| The pricing route gains a blocking failure from the flush | Low / High (a price save could 500) | `.catch` on the flush, F-3. `AuditTrailService.flush` also swallows its own insert error (`handleError`). |
| The flush adds latency to a price save | Certain / negligible | One `audit_trail` insert of one or two rows. The entitlements route does the same. |
| The C2-4 banner fires on a successful empty table | None by design | Only a non-OK response, `success: false` or a throw sets `pricingReadFailed`. R-1 and an empty-list case cover it. |
| An admin has `/admin/system-config` bookmarked for the grace period or boost packs and cannot find them | Low (two technical admins) / Low | The PR body names the new URL. The boost-pack doc gains a pointer (2.6). See O-3 for an optional on-page pointer. |
| Parked page: a failed settings read leaves the grace field at its default of 3, and pressing Save would write 3 | Pre-existing / Low (AgentsPilot) | Not changed (verbatim, C2-5). Recorded in O-4. |
| Doc edit truncates the 599-line access doc | Low / High | Targeted `Edit` only, with `git diff --stat` after each (T-12). |
| Deploy skew | None | No route contract changes. The old page against the new pricing route works, because the response shapes are identical. |

**Rollback:** one PR, with no migration, no data change, and no gate, guard or register change. `git revert` restores the single page and the old sidebar together. The new page and its tests leave with it. The flush is additive, so reverting it only returns the audit to queued.

---

## 11. PR Body Draft

```markdown
## fix(admin): Model pricing split from AgentsPilot billing; free tier moved to parked (ADMIN_BOS_CLEANUP slice 2)

### Why
`/admin/system-config` held the AI model price table, which every Business OS
credit charge is computed from, on the same page as four AgentsPilot settings
(payment grace period, boost packs, the Pilot Credit calculator, a JSON dump).
"Free tier & onboarding" sat in Settings, although the Business OS free plan is
the entitlements trial.

### What changes
- `/admin/system-config` is now **Model pricing**: only the price table. It
  fetches only the pricing route. A failed price read now shows "Could not load
  model prices." instead of an empty table.
- New URL-only page **`/admin/agentspilot-billing`** (hidden AgentsPilot section)
  holds the grace period, the boost packs (now headed "AgentsPilot boost packs"),
  the calculator and the read-only dump (now the calculator only). The code is
  moved, not rewritten. Every control calls the same route as before.
- Sidebar: Settings is Business OS AI, Model pricing, Admin users. "Free tier &
  onboarding" and "AgentsPilot billing" are in the hidden parked section. Plans &
  entitlements says the Business OS trial lives there.
- Price edits, creates and deletes now **flush their audit entry before the
  response**, so a frozen serverless instance cannot lose it.
- Both pages log through the client Pino logger: 20 `console.*` calls removed,
  and no response bodies are logged.

### Not changed
- **Sync is unchanged and parked.** The Sync button, its wording, its handler
  and `pricing/sync/route.ts` are byte-for-byte as before. The only edit is its
  one `console.error`, which now goes to the logger. What Sync should do, and
  where real prices come from, is a separate session (requirement §11). Sync's
  own audit entry is still queued, not flushed. That is left for the same session.
- No route added, moved or renamed. No database change. No authz guard cap, gate
  list or register change. `/admin/onboarding` is unchanged apart from its
  sidebar position.
- The AgentsPilot routes `boost-packs` and `calculator-config` are not converted
  (user decision UC-6). They stay as recorded debt.

### Tests
Source guard (no AgentsPilot fetch on the pricing page, no `console.`, Sync strings
verbatim). Render tests for both pages (fetch lists, failed price read, Sync
flow, calculator-only dump). Pricing route flush cases (order, a rejected flush
still 200, no flush on refusals). Sidebar nav test updated (Settings list,
parked 13 → 15, pages 27 → 28). Business OS AI nav test, adminGate list (57) and
the authz guard unedited and green.

### Rollback
Revert this PR. No migration.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
```

---

## 12. Effort Estimate

| Part | Estimate |
|---|---|
| Baselines and reader sweep (T-1) | 0.5 h |
| Source guard and render test written first (T-2) | 1.5 h |
| Page split, logging conversions, C2-4, imports (T-3 to T-5) | 3 to 4 h |
| Route flush and its tests (T-6, T-7) | 1 h |
| Sidebar and nav test (T-8) | 1 h |
| Sweeps, scoped `tsc`, lint, wider regression (T-9 to T-11) | 1 to 1.5 h |
| Docs and notes (T-12, T-13) | 1 h |
| **Total** | **about 9 to 10.5 h, within SA's 1 to 1.5 days.** UC-6 removes the +0.25 to 0.5 day. |

---

## 13. Open Points for SA

| # | Point | Dev proposal |
|---|---|---|
| **O-1** | **C2-3 makes two lines of copy false.** Once the dump prints only the calculator, its subtitle ("Complete system configuration in JSON format…") and its note ("This is a read-only view of all system settings…") overstate what it shows. C2-5 says "verbatim except for C2-3 and the logging". | Treat the two strings as part of C2-3 and reword them as in 2.2. Fallback: leave them verbatim. That would break the requirement's honesty NFR (§8). |
| O-2 | The pricing section is **collapsed by default** (`pricingExpanded = false`, `:61`), as all four sections were. On a single-section page, an operator lands on a header with a closed card. | Keep it collapsed. C2-2 / C2-4 say nothing else on the pricing page changes behaviour, and D-4 says the look stays. Defaulting it to open is a one-word change if SA prefers. The C2-4 banner is visible either way. |
| O-3 | Nothing on `/admin/system-config` points to where the grace period and boost packs went. | No on-page pointer by default: the page is meant to be Business OS only, and the parked section is URL-only by design. The PR body and the boost-pack doc carry the URL. |
| O-4 | **Pre-existing, moved verbatim:** on the parked page, if `GET /api/admin/system-config` fails, the grace field keeps its default of 3 under the error banner, and Save would write 3. | Out of scope (AgentsPilot, D-3, C2-5 verbatim). Recorded here only. |
| O-5 | C2-4 adds a failed-read state. Clearing `pricingModels` on a failed **refresh** (after Sync, or the refresh button) means an earlier good table is replaced by the failure line rather than left on screen as stale. | Clear it. A stale table under a "could not load" banner would invite an edit against prices that may have changed. One rule: the table shows only what the last read returned. |
| O-6 | The `new-api-route` skill checklist says "never `await` the audit log in the success path". The pricing route already awaits it (RC-W10), and C2-7 adds an awaited flush. | Follow C2-7 and the WC-7 precedent (entitlements, invites, archiving). Both are awaited and both have a `.catch`, so neither can fail the request. The skill line could be updated to name WC-7 as the exception for writes that must be audited. That is a skill change for SA to decide, not part of this PR. |
| O-7 | Access doc `:95` lists four page names under "The 5 added since". `business-os-invites` is missing. | Fix it in the same edit (2.6, item 1). This is a factual correction, not new scope. |
| O-8 | `SystemSetting.value: any` moves to the new page. | Change it to `unknown` (2.2). Every read already casts, so behaviour is unchanged and the moved file meets rule 6 without a justification comment. |

---

## Implementation Notes

**Dev, 2026-10-03.** Implemented on `fix/admin-pricing-split` in the worktree `neuronforge-admin-docs`, on `5061489b`. Everything is **uncommitted**. The requirement file was not edited.

### Baselines (T-1)

- Targeted suites on `5061489b`: 9 suites, 516 tests, all green (`AdminSidebar.nav`, both Business OS nav suites, the four `app/api/admin/system-config` suites, `adminGate.writes`, the authz guard).
- `console.*`: page 20, pricing route 0.
- Reader sweep `git grep -n "payment_grace_period_days\|boost_packs\|free_tier_" -- lib/business-os app/business-os app/api/business-os`: **no hits**. S2-3, S2-6 and S2-7 hold on this commit.
- `/admin` pages on disk: 27. SA's W2-5 fact re-checked: `8ea2c74f` has 21 `page.tsx` files under `app/admin/`, and neither `business-os-llm` nor `business-os-invites` is among them.

### SA conditions carried

| Condition | Where it landed |
|---|---|
| W2-1 saved price shows as saved | `handleSavePricing` replaces the row with `result.data` (matched by id). The false comment is deleted. R-9 proves it, with no extra GET and the other row untouched. QA step 3 updated. |
| W2-2 flush awaited, not fired | The mock `flush` records `flush:start`, waits one `setImmediate`, then records `flush:end`. F-1, F-2, F-4, F-5 and F-7 assert the full event list at the moment `await PUT/POST/DELETE()` returns. Source pin: exactly 3 `await auditTrail.flush().catch(`. |
| W2-3 Sync as whole blocks | S-9 (the whole `handleSyncPricing`, with the approved logger line substituted) and S-10 (the whole Sync `<button>`) are literal fixtures in `source.guard.test.ts`, extracted from `5061489b` lines 328-361 and 618-634. Line endings are normalised, so a CRLF checkout reads the same as CI. |
| W2-4 counts | G-6 and the P side count URL and binding occurrences exactly, on comment-stripped code. |
| W2-5 access doc | The row names all seven pages added since 2026-09-21; 21 + 7 = 28. |
| W2-6 docs | As-built `:174` cell repointed, plus a Change History row and Last Updated. One-line pointers in `STRIPE_ENV_SETUP.md` and `PLUGIN_TOKEN_PRICING_IMPLEMENTATION.md`, and the boost-pack pointer. The historical docs are listed for the PR body below. |
| W2-7 tiers nav suite | Unedited and green. No new comment writes the tiers route, and no comment inside `navigationSections` contains an href literal. |
| W2-8 expanded by default | `pricingExpanded` starts `true`. A `pricing-toggle` collapse assertion is added. B's toggles carry `billing-toggle`, `calc-toggle` and `advanced-toggle`. |
| W2-9 description | `Sets every Business OS charge` (29 characters). |
| O-1 | Both dump strings reworded as in 2.2. |
| O-5 | `markPricingReadFailed()` clears the rows, sets the flag and the banner, and resets `editingPricing`. R-10 proves that a failed re-read after Sync clears the old table. |
| O-8 | `SystemSetting.value: unknown`. |

### Proof the new tests bite

| Mutation | Result |
|---|---|
| Route with `void auditTrail.flush()` instead of `await` | F-1, F-2, F-4, F-5, F-7 and the source pin fail (6). |
| Route as on `5061489b` (no flush) | 7 fail. |
| Old page in place of P | Render: all 9 P cases fail. Guard: G-1, G-2, G-3, G-7, G-8 and S-9 fail. |
| P without the W2-1 row replacement | R-9 fails. |
| One Sync `setTimeout` value and one Sync button class changed; one `onClick={handleSaveCalculatorConfig}` dropped on B | S-5..S-7, S-9, S-10 and the B binding count fail. |
| B missing | The guard suite fails to load (ENOENT). |

### Verification

- Targeted, 13 suites (including the unedited `dataAccess`, sync route, `system-config` route, both Business OS nav suites, `adminGate.writes`, authz guard, `modelSettingsPolicy` and `ownerCreditSurface.guard`): **625 / 625**.
- Wide (`app/admin app/api/admin lib/admin lib/business-os/llm`): 113 suites, **3,034 passed, 1 failed**. The failure is the `chat/planner` snapshot in `lib/business-os/llm/__tests__/callParams.boundary.step3.test.ts` (a prompt hash). It fails the same way with this slice's changes stashed, so it is pre-existing and unrelated.
- ESLint on the 9 touched code files: 0 errors and 4 warnings, all `react/no-unescaped-entities` in copy moved verbatim (P 2, B 2). The old single page had 7 warnings. One `react-hooks/exhaustive-deps` warning surfaced on P's mount-only `useEffect`. It fires because P's `fetchData` now captures `markPricingReadFailed`, a component function (corrected per SA code review L-1). It is suppressed with a one-line reason. `npm run lint:hooks` exits 0.
- Scoped `tsc` (scratch tsconfig, `include: []`, the 9 files): **0 errors in touched files**. There are 4 errors, all in the untouched `lib/audit/admin-helpers.ts` (the `reward_config` entity type, pre-existing), reached through the pricing route's import.
- T-9: `git diff --exit-code 5061489b` is empty for the sync route, `boost-packs`, `calculator-config`, `app/api/pricing`, the onboarding page and route, `AdminHeader.tsx`, the layout, both Business OS nav folders, `app/api/admin/system-config/__tests__`, `app/api/admin/__tests__` and `lib/admin`. `console.` in either page: 0. AgentsPilot URLs or setting keys in P: 0.

### Deviations

- **R-10 added** (not in 5.4). It proves O-5 through the Sync path, because the header refresh button has no accessible name to click by.
- **Extra render cases:** a successful empty list (table shown, no failure line, no banner) and B's calculator toggle.
- **P's `useEffect`** carries an `eslint-disable-next-line react-hooks/exhaustive-deps` with its reason (see Verification).
- **G-4** asserts on the `<h3>` text (`>AgentsPilot boost packs</h3>`), because the JSX comment `{/* Boost Pack Management */}` above it is moved verbatim.
- **The new and rewritten page files are LF.** Git normalises them on commit (`core.autocrlf=true`).
- **The parked "AgentsPilot billing" description** (`AgentsPilot boost packs, grace, calculator`, 42 characters) is kept as planned in 2.4. The section is hidden, so nothing truncates.

### For the PR body (W2-6): historical docs left as written

`STRIPE_DATABASE_DRIVEN_CONFIG.md:180`, `admin/ADMIN_BILLING_UI_ADDITION.md:219`, `BOOST_PACK_ADMIN_INTERFACE.md:242` (the new pointer at `:9` covers it), `investigations/LLM_CREDIT_AND_AUDIT_TRACKING.md:148`, the `SYSTEM_CONFIG_*` and `ORCHESTRATOR_*` docs, and `MEMORY_SYSTEM_INTEGRATION.md`.

### T-14 manual QA: owed

Section 6, steps 1 to 8, on `npm run dev` as a platform admin. **Never press Sync on production.**

---

## SA Review Notes

### SA Workplan Review (2026-10-03)

**Reviewed by SA — 2026-10-03.** Checked against C2-1..C2-12 (requirement, "SA Review — slice 2"), user decision UC-6, CLAUDE.md, and the code on `fix/admin-pricing-split` @ `5061489b`.
**Status:** ✅ **Approved with conditions W2-1..W2-9.** Dev carries them into the plan and then implements. The workplan does not need a second SA review. The code review checks each W2 item against the diff.

UC-6 is carried correctly. `boost-packs` and `calculator-config` are not in the diff (§3 "Explicitly not touched", T-9 diff), and §9.2 records them as debt with the right counts (11 and 8, 6 and 2). Nothing in the plan converts or edits them.

#### A. What SA re-verified on `5061489b`

| Check | Result |
|---|---|
| §9.1 `console.*` map | ✅ **Correct.** There are 20 lines on the page. 9 belong to pricing (`:199, :201, :204, :208, :210, :214, :264, :321, :356`) and 12 to the parked page (`:148, :152, :157, :188, :227, :256, :260, :264, :393, :433, :488, :526`). `:264` is counted on both sides, so 9 + 12 − 1 = 20. The six C2-8 payload calls are correctly identified (`:152, :157, :201, :204, :227, :256`). The fields named in the new calls exist in scope: `pack.pack_key` (`handleSaveBoostPack(pack: BoostPack)`, `:447`), `packId` (`:495`) and `modelId` (`:285`). |
| Sync list S-1..S-8 | ⚠️ **The strings are correct but the list is not complete.** S-1 to S-7 match `:614, :626, :631, :668, :350, :334-335, :339/:345/:348/:353` exactly. The list leaves out the button wiring (`onClick={handleSyncPricing}`, `disabled={saving}`, the `Download` and spinner icons) and the rest of the handler body (the `setSaving / setError / setSuccess` preamble, the `catch` path, the `finally`). Fragment pins cannot prove "byte for byte". See W2-3. |
| G-1..G-8 | Meaningful, but G-6 proves only that each URL is present, not that each fetch is. See W2-4. |
| R-1..R-8 | Meaningful. B's toggles are found "by role order", which is brittle. See W2-8. |
| F-1..F-7 | ⚠️ **They prove call order, not flush-before-respond.** A mocked `flush` that pushes `'flush'` as it is *called* would also pass with `void auditTrail.flush()`, which is exactly the defect C2-7 prevents. The WC-7 precedent tests have the same gap (`entitlements/__tests__/routes.test.ts:61-64`). See W2-2. |
| Sidebar counts | ✅ **Correct.** There are 27 page files on disk: `/admin` plus 26 directories (`__tests__` and `components` have none). 26 are listed, because `/admin/exchange-rates` is deliberately unlisted (`UNLISTED`, nav test `:80`). After this slice: 28 on disk and 27 listed. Parked goes from 13 to 15, and Settings from 4 to 3. The disk floor goes from 27 to 28 and `allHrefs` from 26 to 27, as planned. |
| Flush placement (C2-7) | ✅ After `reportZeroPrice` on PUT and POST, after the audit block on DELETE, and before the success `return`. `reportZeroPrice` catches its own audit rejection (`pricing/route.ts:151-158`), so the flush line is always reached on success. `auditLog` and `AuditTrailService.getInstance()` are the same singleton (`AuditTrailService.ts:595`), so the flush drains the rows that `logAIPricing*` queued. |
| Unchanged suites | ✅ `dataAccess.test.ts` scans for `createClient`, the three client imports, `.from('` and `console.*`. Importing `@/lib/services/AuditTrailService` matches none of them. `modelSettingsPolicy.test.ts:329-334` reads only `RESERVED_KEY_PREFIX`, so C2-9's comment edit is safe. ⚠️ One suite is **missing from 5.5**. See W2-7. |
| Deep links and anchors | ✅ **None in code.** Searching `app/`, `components/`, `lib/` and `hooks/` finds no `/admin/system-config#…`, no `?…` and no `<Link>` to it. The only code hits are the sidebar entry and two tests. The docs are a different story. See W2-6. |
| O-8 `value: unknown` | ✅ The only reads are `setting.value as string` (`:167`, `:170`). `unknown as string` compiles, so behaviour does not change. |

#### B. Conditions

1. **W2-1: a saved price must show as saved (new finding, High).** `handleSavePricing` (`:285-326`) never updates `pricingModels`. After a successful PUT it closes the editor, and the row goes back to rendering `model.input_cost_per_token` from the **old** state (`:753`). The comment at `:316` ("Don't refresh data after save - local state already has updated values") is false. On the page that sets every Business OS charge, an operator who saves a price sees the old price under a "Pricing updated successfully!" banner. They may save again, or assume the save failed. §9's "Editing a price still works" does not hold as built, and the honesty NFR (§8) bans the false comment.
   - **Fix:** on success, replace that row in `pricingModels` with `result.data`. That is the row the PUT already returns, in the same shape as the GET rows. Then delete the false comment. This is about one line, and it is the one approved exception to C2-4's "nothing else changes".
   - **Test:** add R-9. After saving, the row shows the returned cost, and no extra pricing GET is made. Add QA step 3: the table shows the new value straight after Save.
2. **W2-2: F-tests must prove the flush is awaited.** Make the mocked `flush` resolve one macrotask later: push `'flush:start'`, then `await new Promise(r => setImmediate(r))`, then push `'flush:end'`. Assert that after `await PUT(...)` the `events` already end with `'flush:end'`. A `void` flush would fail that assertion. Do this for F-1, F-4 and F-5, and keep the F-2 order assertion. Also add one source pin in the route test or the guard: `pricing/route.ts` contains `await auditTrail.flush().catch(` **exactly 3 times**. F-3 is still worth having, even though the real `flush` swallows its own insert error (`handleError`): the `.catch` is the contract.
3. **W2-3: pin Sync as whole blocks, not fragments (C2-1).** In G-5, the expected `handleSyncPricing` function (`:328-361`, with the one approved logger line already substituted) and the Sync `<button>…</button>` block (`:618-634`) are each held as one literal fixture string. Assert that P contains each one **verbatim**. Keep S-4 (the info-box `<p>`) and S-1 as they are, and keep S-8 by the T-9 diff. Add the two blocks to the S-list as S-9 (handler) and S-10 (button), so the list matches what C2-1 freezes. Formatting is part of the freeze: Prettier must not reflow either block.
4. **W2-4: G-6 counts fetches and handler wiring.** "The cut did not drop a fetch" needs counts, not presence. The `boost-packs` URL alone appears 3 times (GET, save, delete). Pin these:
   - **B** contains exactly 2 `'/api/admin/system-config'`, 3 `'/api/admin/boost-packs'`, 1 `'/api/admin/calculator-config'` and 1 `'/api/pricing/config'`, plus the five bindings `onClick={handleSaveBillingConfig}`, `handleSaveBoostPack(pack)`, `handleSaveBoostPack(newBoostPack)`, `handleDeleteBoostPack(pack.id!)` and `onClick={handleSaveCalculatorConfig}`.
   - **P** contains exactly 2 `'/api/admin/system-config/pricing'` and 1 `'/api/admin/system-config/pricing/sync'`, plus `handleSavePricing(model.id)`, `handleEditPricing(model)`, `onClick={handleCancelEditPricing}` and `onClick={handleSyncPricing}`.

   `tsc` does not catch a dropped `onClick`. These pins do.
5. **W2-5: O-7's correction names the wrong page.** `business-os-invites` was added on **2026-09-28** (`fe053e63`), the day **after** the doc's "Re-counted 2026-09-27: 26" (that count is right: `e06d2de8` has 26). The fifth page missing from "The 5 added since" is **`business-os-llm`**: it is not on `8ea2c74f` (2026-09-21, 21 pages) and is on `5061489b`. The row must name **all seven** added since 2026-09-21: `business-os-tiers`, `business-os-llm`, `platform-dashboard`, `archiving`, `jobs-queues`, `business-os-invites` and `agentspilot-billing`. 21 + 7 = 28.
6. **W2-6: docs that tell an operator where the moved settings are.** No code deep link exists, but these docs send a reader to `/admin/system-config` for something that moves:
   - **Required:** `docs/requirements/BUSINESS_OS_PLAN_PAYMENTS_ASBUILT.md:174`. This is a living Business OS doc (last updated 2026-10-02), and its `system-config` billing-panel row cites `app/admin/system-config/page.tsx:848-976`. After the split it should cite `app/admin/agentspilot-billing/page.tsx` with no line range. Make it a one-cell edit plus a Change History row.
   - **Recommended:** a one-line "Moved 2026-10-03" pointer, the same pattern as the boost-pack pointer, in `docs/STRIPE_ENV_SETUP.md:239` (operator steps for the grace period) and `docs/PLUGIN_TOKEN_PRICING_IMPLEMENTATION.md:151` (operator steps for the calculator's "Tokens Per Plugin").
   - **Leave as historical,** and list them in the PR body: `STRIPE_DATABASE_DRIVEN_CONFIG.md:180`, `admin/ADMIN_BILLING_UI_ADDITION.md:219`, `BOOST_PACK_ADMIN_INTERFACE.md:242` (the pointer at `:9` covers it), `investigations/LLM_CREDIT_AND_AUDIT_TRACKING.md:148` (dated), the `SYSTEM_CONFIG_*` and `ORCHESTRATOR_*` docs, and `MEMORY_SYSTEM_INTEGRATION.md` (already stale).

   Use targeted `Edit` only, and run `git diff --stat` after each edit. This stays within UC-6: these are consequences of this slice's own move, not new AgentsPilot cleanup.
7. **W2-7: a third nav suite must stay green unedited.** `app/admin/business-os-tiers/__tests__/nav.test.ts` reads the sidebar. It requires exactly **one** occurrence of `/admin/business-os-tiers`, a `description` containing "Business OS" on the Plans & entitlements entry, a section `title:` between that entry and `href: '/admin/onboarding'`, and the onboarding page unchanged. The plan passes all of these, provided:
   - no new comment in `AdminSidebar.tsx` writes the string `/admin/business-os-tiers` (the FR-FT2 comment should say "Plans & entitlements");
   - no comment inside `navigationSections` contains `href: '` (`AdminSidebar.nav.test.ts:163` counts them).

   Add the suite to 5.5 and T-8.
8. **W2-8: O-2 is overruled. The pricing card opens expanded.** See the ruling below.
   - Set `pricingExpanded` to start as `true`. R-1 to R-5 then need no toggle click. Keep `data-testid="pricing-toggle"` and add one assertion that it collapses the card.
   - On B, give the three existing chevron buttons `data-testid`s (`billing-toggle`, `calc-toggle`, `advanced-toggle`) and use those instead of role order. Adding the attributes is not a visual change.
   - Update QA step 3 ("Expand the table") to match.
9. **W2-9: the sidebar description must fit.** `'AI cost per model; sets Business OS charges'` is 43 characters. The sidebar truncates descriptions (`AdminSidebar.tsx:388`, `truncate`). The longest visible description today is 40 characters, and the Settings entries are 27 to 29. Use a shorter description that still contains "Business OS", for example `'Sets every Business OS charge'` (29). QA step 1 confirms it shows without an ellipsis. The new 5.3 pin (`description contains Business OS`) is unchanged.

#### C. Rulings on O-1..O-8

| # | Ruling |
|---|---|
| **O-1** | **Approved as proposed.** The two strings are part of C2-3: C2-3 changes what the dump shows, so the text that describes the dump changes with it. Leaving them verbatim would break the honesty NFR. Use the wording in 2.2. |
| **O-2** | **Overruled: expanded by default** (W2-8). The collapse default existed to keep a four-section page short. On a page that **is** the table, a closed card is an extra click with nothing behind it, and it hides C2-4's in-card failure line. D-4 covers colours, fonts and components, not the initial state, and C2-4's "nothing else changes" was SA's own scope guard, so SA amends it here. The user sees the result in the diff and can ask for it collapsed. |
| **O-3** | **Approved: no on-page pointer.** The pricing page is meant to be Business OS only, and the parked section is URL-only by design (U-6 precedent). The URL goes in the PR body and the docs (W2-6). |
| **O-4** | **Approved: recorded, not fixed.** This is pre-existing AgentsPilot behaviour, moved verbatim under C2-5 and D-3. |
| **O-5** | **Approved: clear the table on a failed refresh.** After a Sync that succeeded, a failed refresh would otherwise leave **pre-Sync** prices on screen as current. That is the exact misreading C2-4 exists to stop. The rule is "the table shows only what the last read returned". Optimisation: `markPricingReadFailed()` should also reset `editingPricing` to `null`, so no editor state outlives its row. |
| **O-6** | **C2-7 stands.** The skill line conflates two things. The rule it protects is "an audit failure never fails or blocks the request", and both awaited calls keep that rule through `.catch`. Awaiting is what makes the row durable on serverless, which is the point of WC-7. **The skill needs a follow-up, not in this PR.** `.claude/skills/new-api-route/SKILL.md:189` and the `:205` anti-pattern row should say: always `.catch()` the audit; awaiting the queue call is allowed; and a write the requirement names as must-be-audited (WC-7: entitlements, admin access, invites, archiving, and now price changes) awaits `auditTrail.flush().catch(...)` before responding. TL owns opening that as a small skill/docs PR, with SA review. |
| **O-7** | **Approved in principle, corrected in fact** (W2-5). The missing page is `business-os-llm`. `business-os-invites` is one of the two added **after** the 26 count. |
| **O-8** | **Approved.** `unknown` plus the existing casts meets rule 6 with no behaviour change. |

#### D. Optimisation suggestions (non-blocking)

- **G-1:** match the settings URL with any closing quote character (`/['"\`]\/api\/admin\/system-config['"\`]/`), not only `'`.
- **`:264` on B** logs `{ err }`, and that error's message embeds the settings response body (`:153`, the thrown text that feeds the banner). This is acceptable: the route's production body carries no details (`NODE_ENV` guard), and the banner already shows the same text. It is recorded so the code review does not flag it twice.
- **framer-motion under jsdom:** no existing jsdom test renders a `motion` page. If it gets in the way, mock `framer-motion` to plain elements **inside the render test**. Do not drop the R-tests.
- **Info-box copy that is false but out of scope:** "Manual Edits: … Changes affect cost calculations immediately" (`lib/ai/pricing.ts:37` caches prices for 1 hour per instance), "Price per 1,000 input tokens" (the columns are per token), and "Impact on Intelligent Routing" (AgentsPilot). They sit in the same info box as the S-4 paragraph that C2-1 freezes, so they belong to the parked price-source session (§11). The main session should add them to that §11 row. Dev does not change them.
- **WC-7 limit, project-wide, not this slice's:** `AuditTrailService.flush()` returns at once when another flush is in flight (`isFlushing`, `:245`), so an awaited flush can come back before this request's row is written. C2-7 still closes the common case. No change here.
- **Requirement §8 Security NFR** names only entitlement and admin-access writes as WC-7 exceptions. C2-7 adds price changes. The main session can add "price changes" the next time it edits the requirement. Dev does not edit it.

#### E. Business question for the user

None. W2-1 and W2-8 are technical calls inside the approved scope. The user sees both in the diff.

#### Approval

- [x] Workplan approved, **with conditions W2-1..W2-9**. Dev updates the plan (§2.1, §2.6, §5.1-5.5, §6, §13) and implements. Nothing is committed (standing rule). SA code review follows, then QA.

### SA Code Review (2026-10-03)

**Code Review by SA — 2026-10-03**
**Status:** ✅ **Code Approved.** No blocking finding. The Low items below are optional and can ride along or be dropped.
**Reviewed:** the uncommitted diff on `fix/admin-pricing-split` against `5061489b`, the three untracked files, C2-1..C2-12, W2-1..W2-9, O-1..O-8, UC-6 and CLAUDE.md. Every claim in the Implementation Notes was re-run, not read.

#### A. Dev's claims, re-verified

| Claim | SA result |
|---|---|
| Targeted suites green | ✅ 15 suites (Dev's 13 plus `AdminHeader.render` and `ArchivedBeforeNotice.render`, which share the folder): **640 / 640**. |
| Wide: 3,034 passed, 1 failed | ✅ Re-run: 114 suites, **3,039 passed, 1 failed**. QA's `pages.edge.qa.test.tsx` adds the extra suite and 5 tests. The failure is the same one. |
| The failure is pre-existing on base | ✅ **Confirmed on `5061489b`.** SA ran the test on a `git archive 5061489b` export in the scratchpad (`lib`, `app`, `components`, `hooks`, `__mocks__`, `tests/plugins`; the worktree's `node_modules` via `modulePaths`). It fails with the **same** received hash: `chat/planner`, `sha256:539a815e… (len 31366)` against the snapshot's `sha256:3a6b5dc0… (len 31356)`, 1 failed and 19 passed. `jest --findRelatedTests` on the five changed code files does not list it, and `origin/main` (`d008fd56`) has not touched `lib/business-os/llm/__tests__` or `lib/business-os/chat` since `5061489b`. So it is still red on main today. Unrelated to this slice. |
| Scoped `tsc`: 0 errors in touched files | ✅ Scoped tsconfig over the 9 code and test files, `--max-old-space-size=8192`: exit 2, from **4 × TS2322, all in the untouched `lib/audit/admin-helpers.ts`**. None in a touched file. |
| ESLint 0 errors; `lint:hooks` 0 | ✅ 4 warnings, all `react/no-unescaped-entities` in copy moved verbatim (the old file had 7). `npm run lint:hooks` exits 0. |
| Guards bite on the old code | ✅ Accepted on reading. G-1, G-2, G-3, G-7, G-8 and S-9 cannot pass against the old page, which has the settings fetch, `boost`, 20 `console.` calls, no `clientLogger` and the old h1. The flush pin counts 3 and the base route has 0. |
| UC-6: no diff on `boost-packs`, `calculator-config`, `/api/pricing/config` | ✅ `git diff --exit-code 5061489b` is empty for those three, and also for `pricing/sync`, the onboarding page and route, `AdminHeader.tsx`, `layout.tsx`, both Business OS nav folders and all of `lib/`. |

#### B. Focus points

1. **Sync, byte for byte (C2-1, W2-3).** ✅ SA diffed the old `handleSyncPricing` (`5061489b:328-361`) against the new one (`page.tsx:179-212`): **one line differs**, the approved `logger.error({ err: error }, 'Pricing sync failed')`. SA also diffed the whole old pricing section (`:599-831`) against the new one (`:279-519`). The only differences are `data-testid="pricing-toggle"`, the C2-4 conditional around the table (`:365-370` and `:516`), and nothing else. The Sync button, the S-1 helper text and the S-4 info-box paragraph are unchanged. The S-9 and S-10 whole-block fixtures enforce this from now on.
2. **W2-1: is `result.data` ever a partial row?** ✅ **No.** On success, the PUT returns `data` from `aiModelPricingRepository.updateCosts`, which is `.update(patch).eq('id', id).select().maybeSingle()`. `.select()` with no argument returns every column, the same as `listAll`'s `select('*')`. When no row matches, the result is `null`. The route then answers 404 (`route.ts:227`), and the page throws on `!response.ok` before reaching the replacement. The row can be a **superset** of `ModelPricing` (`retired_date` etc.), which is harmless. Numeric columns arrive in the same form as the GET rows, because they come from the same PostgREST path. The functional updater keeps concurrent saves (QA E-2). The false `:316` comment is gone. Optional hardening: L-3.
3. **The audit flush (C2-7, W2-2).** ✅ There is one `await auditTrail.flush().catch(err => requestLogger.error({ err }, 'Audit flush failed'))` per write handler, after every `logAIPricing*` call. On PUT and POST it also comes after `reportZeroPrice`, which catches its own rejection, so the line is always reached. Each one comes before the success `return`. There is none on the 400, 401, 403, 404 or 500 paths. `AuditTrailService.getInstance()` at module scope adds no side effect: the service module already builds the singleton at import (`AuditTrailService.ts:595`). The F-tests prove the flush is awaited, not fired (`flush:end` is recorded before the handler resolves). The source pin counts exactly 3. The `isFlushing` early-return limit stays project-wide and is already recorded in §11 of the requirement.
4. **Nothing lost in the cut.** ✅ SA ran `git diff --no-index` between `5061489b:app/admin/system-config/page.tsx` and the parked page, and read every removed line. What was removed: the `ModelPricing` type; the pricing state and `pricingExpanded`; the pricing fetch block (`:191-216`); `handleEditPricing`, `handleCancelEditPricing`, `handleSavePricing` and `handleSyncPricing` (`:273-361`); `formatCost`; the pricing JSX (`:599-832`); `pricing_models` in the dump; the unused imports `Download` (pricing only), `Brain` and `Cpu` (unused on the old page too); and the 12 `console.*` lines. Everything else is present: the Billing section (grace period, the five boost-pack bindings, the add form), the Calculator section, the Advanced section, all three collapse states, `calculateBoostPackCredits`, and both settings fetches plus the three boost-pack calls. The changed lines are the h1 and subtitle, the `<h3>` (C2-5), three `data-testid`s, the two O-1 dump strings, the dump object (C2-3), `value: unknown` (O-8) and the logging. `errorText` is still read to feed the thrown banner text, so the behaviour is unchanged. W2-4's counts pin all of this.
5. **Free tier entry (C2-6, FR-FT1, FR-FT2).** ✅ `/admin/onboarding` is removed from Settings and appended to the parked section. The name is unchanged, the description is `AgentsPilot free-tier grant & signups`, and `UserCheck` is still used. Parked has 15 items and Settings has 3. Plans & entitlements reads `Business OS plans & trial, read-only` (36 characters, which fits). No new comment contains `/admin/business-os-tiers` or `href: '`, so W2-7 holds, and the tiers nav suite passes unedited. `Sets every Business OS charge` meets W2-9.
6. **`clientLogger`: no payloads (C2-8).** ✅ Both pages have 0 `console.`. All six payload calls are gone or reduced to status or count. Errors are logged as `{ err }`, plus `pricingId`, `packKey` or `packId`. B's settings-failure `{ err }` carries the response text inside the thrown message. That was already accepted in the workplan review (§D), and the banner shows the same text. `lib/logger/client.ts` sends nothing over the network.
7. **Doc edits (C2-11, W2-5, W2-6).** ✅ Counts were checked from git: 21 `page.tsx` on `8ea2c74f`, 27 on `5061489b` and 28 in the worktree. The seven names in the access-doc row are exactly the set difference (`agentspilot-billing`, `archiving`, `business-os-invites`, `business-os-llm`, `business-os-tiers`, `jobs-queues`, `platform-dashboard`). The as-built `:174` cell is repointed and has a Change History row. The three "Moved 2026-10-03" pointers are each a single inserted line. `git diff --numstat` shows insertions plus one- or two-line replacements on every doc, so nothing was truncated.
8. **The `eslint-disable` on P's `useEffect`.** ✅ **Justified, but the Implementation Notes give the wrong reason.** The notes say "the code is the same as before, but the rule did not report it on the old file." In fact the code differs. `react-hooks/exhaustive-deps` does not ask for a component function that captures nothing but stable setters, and the old `fetchData` (still the case on B) captured only setters. P's `fetchData` now calls `markPricingReadFailed`, which is a captured component function, so the rule fires. The suppression is still correct: the effect is mount-only by intent, and `markPricingReadFailed` touches only stable setters, so there is no stale-closure risk. The in-code reason ("Mount-only load…") is accurate. Only the workplan note should be corrected (L-1).

#### C. Code Review Comments

1. `docs/workplans/ADMIN_BOS_CLEANUP_SLICE_2_WORKPLAN.md`, Implementation Notes, "Verification" (ESLint bullet). The explanation of the `exhaustive-deps` warning is wrong (see B8). Reword it: "fires because `fetchData` now captures `markPricingReadFailed`". Priority: **Low** (record accuracy only).
2. `app/admin/agentspilot-billing/page.tsx:245-246` and `:416-417`. Two double blank lines are left where the pricing handlers were cut. Priority: **Low** (style).
3. `app/admin/system-config/page.tsx:163-164`. Optional hardening: if a future route change ever returned no `data`, `saved.id` would throw inside the `try` and show a TypeError after a save that succeeded. A guard such as `if (saved?.id)`, falling back to `fetchData(true)`, would close that off. It cannot happen with today's route (B2). Priority: **Low**, optional.

#### D. Optimisation Suggestions

- QA's note 1 (the header refresh button has no accessible name) matters slightly more now, because the C2-4 failure line says "Use the refresh button". An `aria-label="Refresh"` on both pages' refresh buttons is one attribute each and is not a visual change. Optional. It can go in this PR or a follow-up.
- No pattern is introduced. The flush follows WC-7. The `clientLogger` child follows the slice 1 precedent. The page split keeps the existing page conventions.

#### E. Process note

SA first tried the base-snapshot check with `git stash push -u -- app/`. QA was writing `app/admin/system-config/__tests__/pages.edge.qa.test.tsx` in the same worktree at that moment. The stash saved, but its cleanup step failed on that file, so no file was removed and jest did not run. The pop then failed on "already exists". SA verified that every stashed file was **byte-identical** to the working tree. The only exception was QA's file, where the working tree held QA's newer edit, which was kept. SA then unstaged (`git reset -- app/`), which restored the exact original `git status`, and dropped the temporary stash (`90a2011b`, recoverable by SHA). The base check was then redone on a `git archive` export, as reported in A. Lesson: **do not stash in a worktree another agent is writing to.** Use an archive export.

#### Code Approved for QA: **Yes**

C2-1..C2-12, W2-1..W2-9 and O-1..O-8 are met. UC-6 holds. C-1..C-3 are Low and optional: they do not block the user's diff review or the RM.

---

## QA Testing Report

### QA Report (2026-10-03)

**QA — 2026-10-03**
**Test mode:** full
**Strategy used:** A (Jest unit and source guards) and B (route tests with mocked repository and audit), plus code reading against `5061489b`. D (browser) is owed to the user: QA cannot sign in.
**Focus:** ui, api, security (audit flush)
**Skipped:** the browser check (no sign-in; checklist below). No database access.
**Input source:** prompt keywords from the main session, plus §5 of this workplan.
**Verdict:** **PASS WITH NOTES.** No bug found. Every slice 2 criterion has evidence except the browser-only steps, which are owed.

#### Test runs (re-run independently in the worktree)

| Suite | Result |
|---|---|
| `app/admin/system-config/__tests__/source.guard.test.ts` (new) | 18 / 18 |
| `app/admin/system-config/__tests__/pages.render.test.tsx` (new) | 13 / 13 |
| `app/admin/system-config/__tests__/pages.edge.qa.test.tsx` (**new, QA**) | 5 / 5 |
| `app/api/admin/system-config/pricing/__tests__/route.test.ts` | 39 / 39 (27 existing + 12 new) |
| `app/admin/components/__tests__/AdminSidebar.nav.test.ts` | 25 / 25 |
| `app/admin/business-os-llm/__tests__/nav.test.ts` (unedited) | 5 / 5 |
| `app/admin/business-os-tiers/__tests__/nav.test.ts` (unedited) | 6 / 6 |
| `app/api/admin/__tests__/adminGate.writes.test.ts` (unedited; `CASES` pinned at 57) | 288 / 288 |
| `lib/admin/__tests__/admin-authz-surface.guard.test.ts` (unedited) | 119 / 119 |
| Dev's 13-suite targeted set (adds `dataAccess`, sync route, system-config route, `modelSettingsPolicy`, `ownerCreditSurface.guard`) | 625 / 625, 13 suites |
| Wide: `app/admin app/api/admin lib/admin lib/business-os/llm` (run before the QA file existed) | 113 suites; **3,034 passed, 1 failed**; snapshots 22 passed, 1 failed |

**The one wide failure is pre-existing.** It is the `chat/planner` prompt-hash snapshot in `lib/business-os/llm/__tests__/callParams.boundary.step3.test.ts` (received `sha256:539a815e… (len 31366)`, snapshot `sha256:3a6b5dc0… (len 31356)`). QA ran it on a `git archive 5061489b` export in the scratchpad, with `--ci` so no snapshot was written. It fails there with the **same** received hash: 1 failed, 19 passed. This slice changes no file under `lib/`. It is unrelated.

Other checks:
- ESLint on both pages and the QA test file: 0 errors, and 4 `react/no-unescaped-entities` warnings in copy moved verbatim.
- `console.` count: 0 on both pages.
- `git diff --exit-code 5061489b` is empty for the sync route, `boost-packs`, `calculator-config`, `app/api/pricing`, the onboarding page and route, `AdminHeader.tsx` and `app/admin/layout.tsx`.

#### Coverage: §9 slice 2 acceptance criteria

| Acceptance criterion | Tested? | Result | Evidence |
|---|---|---|---|
| `/admin/system-config` shows only the model pricing table | ✅ | Pass | G-1, G-2, G-8. R-1: only `GET …/pricing` is fetched, the h1 is "Model pricing", and there is no badge. Diff against `5061489b`: only the pricing state, handlers and JSX remain. |
| Editing a price still works | ✅ | Pass | R-9 (W2-1): the row shows the PUT's returned value, with no extra GET, and the other row is untouched. QA E-1: a failed save keeps the old value and shows an error. QA E-2: two rows saved in sequence both keep their values. Browser step owed. |
| ...and is audited with before and after, durably | ✅ | Pass (route) | The existing PUT audit case checks `before` and `after`. F-1..F-7 use the awaited-flush mock (W2-2). A source pin requires exactly 3 `await auditTrail.flush().catch(`. The flush drains the same singleton that `logAIPricing*` queue into. The audit row itself needs the browser and DB check (owed). |
| The four AP sections load and save unchanged at their URL-only page, with one hidden sidebar entry | ✅ | Pass (code) | R-6 to R-8, and the G-6 counts and bindings (W2-4). **QA diff of B against the old page at `5061489b`:** once the pricing parts are removed, the only changed lines are the 12 logging lines, the header, the `<h3>`, three `data-testid`s, the two dump strings (O-1) and the dump object (C2-3). `handleSaveCalculatorConfig`, `handleSaveBillingConfig`, `handleSaveBoostPack` and `handleDeleteBoostPack` are byte-identical apart from their `catch` logging line. Each calls the same route with the same method and body shape. The sidebar has one parked entry, in the hidden section. Save round-trips are owed in the browser. |
| ~~Sync wording and confirmation~~ | — | Out of scope (UC-5) | Sync is unchanged: the S-9/S-10 whole-block fixtures, R-5, and an empty sync-route diff. |
| The page and the moved sections contain no `console.*` | ✅ | Pass | G-3, and `grep -c` returns 0 for both pages. |
| "Free tier & onboarding" is in the hidden parked group, and its route still loads | ✅ / ⚠️ | Pass (sidebar) / owed (route) | Sidebar nav tests: parked 15, Settings 3. The `app/admin/onboarding` diff is empty. Loading it by URL is browser step 9. |
| Sidebar tests are updated in the same change and pass | ✅ | Pass | `AdminSidebar.nav` 25/25. Both other nav suites are unedited and green. |
| All slices: a happy and a failure path per changed route, plus a manual QA check | ✅ / ⚠️ | Pass / owed | Pricing route: 39 cases, including a rejected flush (F-3) and no flush on 400, 403 or 404 (F-6). The manual check is the checklist below. |

#### Edge cases probed

| # | Edge case | Finding |
|---|---|---|
| 1 | The PUT fails on save | The row keeps its old value. The banner shows the error: `Failed to update pricing`, the route's `error` text, or the network error. The editor stays open with the edited value, as it did before the split. **It was untested, so QA added E-1** (a 500, `success:false`, and a thrown fetch). |
| 2 | Two rows edited in sequence | The functional updater (`rows.map(...)`) keeps the first save when the second one lands. **It was untested, so QA added E-2.** |
| 3 | An empty list vs a failed read | Covered by Dev. A 200 empty list draws the table with no banner. A 500, `success:false` or a throw draws the failure line and the banner (R-2..R-4). |
| 4 | A refresh failing after a good load | R-10 covers the table, via Sync. The `editingPricing` reset (SA O-5) was **untested, so QA added E-3**: open an editor, Sync, let the re-read fail, then do a good header refresh, and plain rows show. A mutation that drops the reset makes E-3 fail (the mutation was reverted, and the file was byte-checked against a backup). |
| 5 | Save and delete bodies on the parked page | Unchanged (see the diff above). |
| 6 | O-4: grace period defaults to 3 | **Unchanged**, recorded only. `useState({ paymentGracePeriodDays: 3 })` and `parseInt(...) \|\| 3` are byte-identical to `5061489b:67-69`. |
| 7 | Code that links to `/admin/system-config` for the moved settings | **None.** In `app`, `components`, `lib` and `hooks` (tests excluded), the only reference to the `/admin/system-config` page is the sidebar entry. `AdminHeader.tsx` does not map it. |

#### Issues Found

**Bugs (must fix before commit):** none.

**Performance issues:** none. The flush adds one awaited `audit_trail` insert per price write.

**Edge cases (nice to fix; all pre-existing, none caused by slice 2):**
1. **The header refresh button has no accessible name** (`app/admin/system-config/page.tsx:245-251`, and the same button on the parked page). A screen reader announces it only as "button". It is also why R-10 and E-3 find it by `header button`. Low. Adding an `aria-label` is a one-line follow-up.
2. **Opening a second row's editor while a save is in flight.** When the first save succeeds, its `setEditingPricing(null)` closes the second editor (`page.tsx:167`), because the Edit buttons are not disabled while `saving`. Pre-existing, and nothing is lost: the second edit is just closed. Low.
3. The info-box lines frozen with Sync are false: the price cache is 1 hour, the columns are per token rather than "per 1,000 tokens", and the Intelligent Routing paragraph is about AgentsPilot. These are already recorded for the §11 price-source session.

#### Browser checklist for the user (T-14, owed)

Run on `npm run dev` as a platform admin, against a **local or non-production** database where possible.

**Never press "Sync Latest Pricing" on production.** It overwrites the live prices that every Business OS charge uses.

1. In the sidebar, Settings shows exactly "Business OS AI", "Model pricing" and "Admin users". The Model pricing description "Sets every Business OS charge" fits, with no "…". Neither "Free tier & onboarding" nor "AgentsPilot billing" is visible.
2. The Businesses → Plans & entitlements description reads "Business OS plans & trial, read-only".
3. `/admin/system-config` has the heading "Model pricing", no "System Config" badge, and no Billing, Calculator or Advanced section. The table is open on arrival, and the chevron collapses and reopens it.
4. Edit one model's input cost, then Save. The green banner shows, **and the row shows the new value at once**, without a reload. Reload the page: the value persists.
5. Audit trail: a new `AI_PRICING_UPDATED` row for that model, with `before` and `after`, is there **straight away**. Put the price back, and check that a second row appears.
6. Sync: the button, the line under "AI Model Pricing" and the info-box "Sync Latest Pricing:" paragraph look as before. **Do not press it on production.** Press it only on a local database, if at all.
7. DevTools → Network on `/admin/system-config`: the only request is `GET /api/admin/system-config/pricing`. Block that URL and click the refresh icon (top right). The red banner reads "Could not load model prices.", the card shows "Model prices could not be read…", and there is no empty table. Unblock it and refresh: the table returns.
8. Open `/admin/agentspilot-billing` by typing the URL. The heading is "AgentsPilot billing".
   - Open Billing. Change the grace period, save, reload. The value persists. Put it back.
   - Under "AgentsPilot boost packs", edit one pack and save. The credits match the old page's for the same price. Optional, local only: add a pack, then delete it.
   - Open the Calculator, change one value, save, reload. The value persists. Put it back.
   - Open Advanced. The JSON has only a `calculator` key.
9. `/admin/onboarding`, opened by typing the URL, loads and works as before.
10. DevTools Console on both pages: no response bodies are printed.

#### Final Status
- [x] Every acceptance criterion that can be automated passes, and no bug was found. Ready for the user's diff review **once the browser checklist above is done**.
- [ ] Issues found that Dev must address before commit: none.

---

## Commit Info

*(RM fills this in.)*

---

## Change History

| Date | Change | Details |
|------|--------|---------|
| 2026-10-03 | Created | Dev workplan for slice 2 against C2-1 to C2-12. The user's decision UC-6 (two AgentsPilot routes not converted in slice 2) is recorded: the optional route-conversion block was dropped, and `boost-packs` (11 `console.*`, 8 unguarded error details) and `calculator-config` (6, 2) are recorded as known AgentsPilot debt (9.2). Eight open points for SA. |
| 2026-10-03 | SA workplan review | **Approved with conditions W2-1..W2-9.** New finding W2-1: a saved price leaves the old value in the table, and the comment at `:316` says otherwise. Fix it from the PUT's returned row. F-tests must prove the flush is awaited, not only called (W2-2). Sync is pinned as whole blocks (W2-3). G-6 counts fetches and handler bindings (W2-4). O-7 corrected: the missing page is `business-os-llm`, so the row names all seven (W2-5). Operator docs are pointed to the new URL, and the BOS as-built row is required (W2-6). `business-os-tiers` nav suite added to the unedited set (W2-7). O-2 overruled: the card opens expanded (W2-8). The sidebar description is shortened to fit (W2-9). O-6: C2-7 stands; the `new-api-route` skill gets a follow-up in a separate PR. UC-6 is carried correctly. No business question. |
| 2026-10-03 | Dev implementation | Code Complete, uncommitted. W2-1..W2-9 and the O-rulings carried (Implementation Notes). Targeted 625/625. Wide: 3,034 passed, 1 pre-existing unrelated snapshot failure. Scoped tsc: 0 errors in touched files. Lint: 0 errors. `lint:hooks` exit 0. T-14 manual QA owed. |
| 2026-10-03 | QA report | **PASS WITH NOTES**, no bugs. Re-ran independently: targeted 625/625; wide 3,034 passed, 1 failed. The failure is the chat/planner snapshot, which fails identically on a `5061489b` export, so it is pre-existing. QA added `pages.edge.qa.test.tsx` (5 cases: failed save, two sequential saves, editor reset on a failed re-read). Three low, pre-existing edge notes. Browser checklist owed by the user. Never press Sync on production. |
| 2026-10-03 | SA code review | **Code Approved.** All claims re-run: targeted 640/640 (15 suites); wide 3,039 passed, 1 failed; the `chat/planner` snapshot fails with the same hash on a `5061489b` archive export, so it is pre-existing and still red on `origin/main`. Scoped tsc: 0 errors in touched files (4 in the untouched `admin-helpers.ts`). Sync diffed byte for byte: one approved logger line. The W2-1 `result.data` is always a full row. The flush is awaited ×3 and non-blocking. The parked page lost only pricing parts. UC-6 diff empty. Three Low, optional comments (one is the eslint-disable explanation in the Implementation Notes). |
