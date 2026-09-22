# Workplan: Business OS LLM Usage Verification — Layer 1.1

> **Last Updated**: 2026-09-17

**Developer:** Dev
**Requirement:** [BUSINESS_OS_LLM_USAGE_VERIFICATION_LAYER1_1_REQUIREMENT.md](/docs/requirements/BUSINESS_OS_LLM_USAGE_VERIFICATION_LAYER1_1_REQUIREMENT.md) (24 FRs / 24 ACs, SA approved with RC-1 to RC-14 applied, D-1 to D-4)
**Layer 1 context:** [BUSINESS_OS_LLM_CALL_ATTRIBUTION_LAYER1_WORKPLAN.md](/docs/workplans/BUSINESS_OS_LLM_CALL_ATTRIBUTION_LAYER1_WORKPLAN.md) (§6.4 QA SQL, §12.2 T46 gate, §13 SA, §14 QA)
**Branch:** `feature/business-os-llm-usage-layer1-1` (worktree `neuronforge-llm-attribution`, off `main` @ `56fb7dbd`, Layer 1 PR #47 merged)
**Date:** 2026-09-17
**Status:** QA complete — **PASS WITH ISSUES** (§13, 2026-09-17): no bugs; T39 browser smoke handed off to TL. Previously: SA Code Approved (§12), CR-1 applied. Not committed; RM commits after the T39 smoke and user approval.

## Overview

Layer 1.1 adds an admin-only, read-only **LLM Usage** tab to `/test-business-os`, backed by two new admin API routes: a report for one business and a business list. The report runs five attribution checks over one business account and one time window, plus area totals. It has exact Pass/Fail, capped display and an Incomplete status. To serve it, the workplan adds:
- a read-only `TokenUsageRepository`;
- a `searchForAdmin` method on `BusinessProfileRepository`;
- shared constants in `callCatalog.ts`;
- the owner usage card's totals, extracted into `lib/business-os/usage/usageSummary.ts` with no behaviour change.

There is no migration, no LLM call, no audit event and no write, other than `AdminAccessService`'s own admin binding.

This workplan maps each FR and AC to tasks and tests, and checks every cited file and line against the worktree (§2). It sets out the design (§3), the typecheck-gate impact (§4.2), the tests (§5), risks (§6), SA questions (§7) and an ordered, independently testable implementation sequence (§9, §10).

---

## Table of Contents

1. [Analysis Summary](#1-analysis-summary)
2. [Code-Reality Check](#2-code-reality-check)
3. [Design](#3-design)
4. [Files to Create / Modify](#4-files-to-create--modify)
5. [Test Plan](#5-test-plan)
6. [Risks, Rollout and Follow-ups](#6-risks-rollout-and-follow-ups)
7. [Questions and Decisions for SA](#7-questions-and-decisions-for-sa)
8. [Traceability Matrix](#8-traceability-matrix)
9. [Implementation Sequence](#9-implementation-sequence)
10. [Task Checklist](#10-task-checklist)
11. [Implementation Notes](#11-implementation-notes)
12. [SA Review Notes](#12-sa-review-notes)
13. [QA Testing Report](#13-qa-testing-report)
14. [Commit Info](#14-commit-info)
15. [Change History](#change-history)

---

## 1. Analysis Summary

| Area | What 1.1 touches |
|---|---|
| **DB (reads only)** | `token_usage` (window reads, exact head counts, capped reads, the existing `business_os_usage_summary` RPC); `business_profiles` (`user_id, company_name` search; the selected business's name); `ais_system_config` (`tokens_per_pilot_credit`); `admin_users` (via `AdminAccessService`). No migration, no index |
| **Repositories** | New `TokenUsageRepository` (read-only, required account filter, column allow-list, does not import the catalog). New `BusinessProfileRepository.searchForAdmin`. Reused `ConfigRepository.getSystemConfig` (injected with `supabaseServer`) |
| **Catalog** (`lib/business-os/llm/callCatalog.ts`) | Export `isPlatformAccount`; add `platformAccountIds()`, `BOS_LEGACY_FEATURES` (+ flat list), `BOS_FEATURE_FILTER_PREFIX`, `bosRowFilter()`, `isBusinessOsFeature()`, `BOS_KNOWN_NON_CATALOG_COMPONENTS`, `BOS_LEGACY_HELPER_LABEL` |
| **Usage modules** (`lib/business-os/usage/`) | `usageCategories.ts` switches its Business OS categories to the constants (same mapping). New: `usageSummary.ts` (card totals, extracted); `llmUsageReportTypes.ts` (runtime-free response types); `llmUsageVerification.ts` (pure: request schema, window, row classification, the five checks, area totals); `llmUsageReport.ts` (orchestrates the reads) |
| **API routes** | New `GET /api/admin/business-os/llm-usage` and `GET /api/admin/business-os/llm-usage/businesses`. Changed `app/api/business-os/usage/route.ts` (calls `usageSummary.ts`, response byte-identical) |
| **Telemetry** | `lib/business-os/bizql/telemetry/turnUsage.ts`: the `'BizQLPlanCache'` literal becomes the constant |
| **UI** | New tab in `app/test-business-os/page.tsx`. New components under `components/test-business-os/llm-usage/`. New hook `hooks/useLlmUsageAutoRefresh.ts` with a pure reducer |
| **Docs** | `docs/BUSINESS_OS_TEST_PAGE_SCOPE.md` (new LLM Usage section). FR-22 check and fill of the Layer 1 requirement and investigation doc |
| **CI** | `npm run typecheck:bos-llm`: scope grows by new files only; baseline JSON unchanged (§4.2) |
| **Provider factory / V6** | Not touched. No LLM call. No V6 pipeline code |

**Pino conversion:** none is needed. Every code file this plan modifies has **0** `console.*` calls today: `callCatalog.ts`, `usageCategories.ts`, `turnUsage.ts`, `app/api/business-os/usage/route.ts`, `BusinessProfileRepository.ts`, `lib/repositories/index.ts`, `app/test-business-os/page.tsx` and `providerFactory.complete.test.ts`. All new files use `createLogger`, or no logging on the client.

**Deprecated / non-compliant code seen but not touched (flagged, out of scope):**
- `lib/analytics/aiAnalytics.ts` uses `console.warn` / `console.log`.
- `app/api/admin/token-usage/**` has no auth gate and uses `createClient` directly (investigation §I.3; separate security fix).
- `usageReport.ts` has two silent failures (F-1).

---

## 2. Code-Reality Check

Every file and line cited by the requirement and its SA review was checked against the worktree at `56fb7dbd`. The two gate commands were run during planning.

### 2.1 Verified references (match)

| Citation | Verified content |
|---|---|
| `callCatalog.ts:10` | "This module is the one place those names exist." |
| `callCatalog.ts:28-30` | `import { createHash, randomUUID } from 'crypto'`, `CallContext` type, `createLogger` |
| `callCatalog.ts:125-129`, `:144` | Private `isPlatformAccount` (all-zero UUID, or `process.env.SYSTEM_ADMIN_USER_ID` read at call time); used in `buildBosCallContext` at `:144` |
| `usageCategories.ts:25`, `:48-61` | Imports `bosFeature`; website `:48`, insights `:49-57`, briefing `:59`, intake `:60`, leads `:61` |
| `app/api/business-os/usage/route.ts` `:49-51`, `:91-98`, `:103-107`, `:113-116`, `:139-142`, `:177-209`, `:180-186`, `:215-228`, `:246-266`, `:313` | Range enum; `UsageSummary`; null-means-not-migrated comment; RPC; BIGINT coercion; paging loop; paged select; `readTokensPerCredit`; `readAllowanceCredits`; `toCredits` |
| `app/api/admin/chat-usage/route.ts:37-62`, `:67-70`, `:73-76` | 401 → admin → Zod 400; info log; outer catch → 500 |
| `lib/services/AdminAccessService.ts:98-133`, `:109-113`, `:129-133` | `isAdmin`; `bindUserId` self-heal write; catch returns `false` |
| `lib/repositories/ConfigRepository.ts:25-38` | `getSystemConfig(configKey)` |
| `lib/repositories/BusinessPurgeRepository.ts:117`, `:143` | `.select('*', { count: 'exact', head: true })` |
| `lib/repositories/BusinessProfileRepository.ts:344-348` | `findByUserId`: `.select('*').eq('user_id', …).single()` |
| `supabase/migrations/20260721_create_business_profiles.sql:14` | `company_name TEXT` (nullable) |
| `supabase/migrations/20260929_usage_summary.sql:10`, `:24-27`, `:49-54`, `:98-99` | 1,991-row measurement; PGRST123; `RETURNS TABLE (bucket, key, tokens, calls)`; `idx_token_usage_user_created` |
| `lib/ai/providerFactory.ts:340-344` | `context ?? { userId: 'system', feature: 'onboarding', component: 'simple-complete' }` |
| `lib/analytics/aiAnalytics.ts:121-126` | `SYSTEM_USER_ID = process.env.SYSTEM_ADMIN_USER_ID \|\| all-zero`; invalid/missing `user_id` → that id |
| `lib/ai/providers/baseProvider.ts:8-9` | `feature: string; component: string` required in `CallContext` |
| `lib/business-os/bizql/telemetry/usageReport.ts:176-203` | Optional `userId` (`:194`); `.limit(10000)` (`:192`); error → zeroed report (`:198-201`) |
| `lib/audit/events.ts:119` | `DATA_ACCESSED` |
| `app/api/admin/token-usage/drill-down/route.ts:2-11` | `createClient` with the service-role key, no gate |
| `.claude/skills/new-api-route/SKILL.md:118` | `user.app_metadata?.role === 'admin'` (stale; F-4) |
| `.claude/skills/new-repository/SKILL.md:261-262` | Export from `index.ts` checklist items |
| `docs/BUSINESS_OS_TEST_PAGE_SCOPE.md:43-48` | Account Model: session-based, no impersonation |
| `scripts/typecheck-bos-llm.ts:37-49` | Core / barrels / callers scope rules |
| `npm run typecheck:bos-llm -- --list` | **96 files in scope** (run 2026-09-17 on `56fb7dbd`); `lib/repositories/index.ts` **not** in scope |
| `npm run typecheck:bos-llm` | **96 files, 30 errors, 0 new (71.7 s), passed** |
| Baseline JSON | 23 keys; git blob `8cff995bebebae238587d7a03886c7851a0e2146`. None of the files this plan modifies has a baseline entry |
| Files importing `@/lib/repositories` (barrel) | **19** (matches RC-7) |

### 2.2 Mismatches and findings

| # | Citation / assumption | Reality in the worktree | Impact on the plan |
|---|---|---|---|
| **M-1** | FR-9 / AC-13: "all reads use the same fixed window end"; FR-16: Check 5 uses `business_os_usage_summary` first | **The RPC has no end bound.** Its signature is `(p_user_id UUID, p_since TIMESTAMPTZ)` and both branches filter only `created_at >= p_since` (`20260929_usage_summary.sql:45-48`, `:68`, `:83`). The row fallback also has no end bound (`route.ts:184`). There is only one version of the function in migrations | Check 5 can't honour the fixed end without a migration, which is out of scope. **Proposal (Q-1):** Check 5's window is `[start, time of the read]`, marked as "open end" in the response and in the tab. The difference from the fixed end is the milliseconds between request receipt and the RPC read. This doesn't change Check 5's Pass/Fail rule, which depends only on how feature values map. AC-13 and FR-9 need a one-line carve-out (BA) |
| **M-2** | FR-23: tokens-per-credit through `ConfigRepository.getSystemConfig` | `ConfigRepository`'s **default client is the browser client** (`@/lib/supabaseClient`, `ConfigRepository.ts:5`, `:18`). The route today uses the service-role client and `.maybeSingle()`. `getSystemConfig` uses `.single()`. No server code constructs `ConfigRepository` today; the singleton at `:98` is unused outside the file | `usageSummary.ts` builds `new ConfigRepository(supabaseServer)`, so the same table is read with the same privileges. Equivalence: no row gives `.maybeSingle()` → `data: null` → 10, and `.single()` → PGRST116 error → `data: null` → 10. An empty value gives `'' \|\| null` → 10 on both paths. More than one row is an error on both → 10. A thrown error is caught → 10 on both. **Same result for every case.** Importing `@/lib/supabaseClient` server-side is already done by API routes (e.g. `app/api/agents/route.ts`), so the import is safe. The characterization test (T1) covers each case |
| **M-3** | RC-6b / FR-20: "select only allowed columns"; FR-12 order `created_at DESC, id DESC` | Offset paging over a window that is still being written could shift a row across a page boundary. The fixed end prevents most shifts, but the app clock and the DB `now()` can differ slightly | The paged read also selects `id` (not sensitive, and not in the forbidden list) and de-duplicates on it. `id` is not returned to the client |
| **M-4** | FR-2 / RC-6d: escape `%`, `_`, `\` | PostgREST also treats `*` in `like`/`ilike` values as `%`, and it can't be escaped through the filter | A literal `*` in a name search acts as a wildcard. This only widens an admin-only name search that is capped at 50. It is documented in code and in the scope doc (Q-4). No `.or()` is built from input |
| **M-5** | Definitions: `platformAccountIds()` = all-zero + `SYSTEM_ADMIN_USER_ID` | If `SYSTEM_ADMIN_USER_ID` is set but isn't a UUID, putting it in `.in('user_id', …)` makes PostgREST error with `22P02`, which would fail Checks 2 and 3 on every refresh. The tracker couldn't write such a row anyway (`user_id` is a UUID column). Case: `isPlatformAccount` compares strings exactly, and Zod's `uuid()` accepts upper case | `platformAccountIds()` includes the env value only if it is a UUID, lower-cased and de-duplicated. `isPlatformAccount` becomes case-insensitive. The routes lower-case the account id after Zod. For the builder this only adds an error log for an upper-case variant of the system id (Q-2) |
| **M-6** | FR-8: "My account" warns when it is a platform account | The client can't know `SYSTEM_ADMIN_USER_ID`, and RC-8 forbids importing the catalog at runtime | **Proposal (Q-3):** the business-list response adds top-level `platformAccountIds` (ids only, admin-gated, the same list the report shows under FR-11), so the tab can warn when "My account" or a pasted id is selected. Without this, the warning appears only as the report's 400 message |
| **M-7** | FR-11: show "the selected business (name and account id)" | No narrow read exists. `findByUserId` selects `*` | **Proposal (Q-5):** reuse `findByUserId(accountId)` and return only `company_name`. If the profile read fails, the report still returns: `companyName: null`, `profileLookup: 'failed'`, and a warn log. The name is display data, not a check |
| **M-8** | SA Testability: "the repo has no React test harness for `/test-business-os`" | Jest has `jest-environment-jsdom` and `@testing-library/react`. There are component tests (`components/test-plugins/tester/__tests__/*.test.tsx` with `@jest-environment jsdom`) and a hook test (`hooks/useSideConsole.test.tsx`) | AC-17 to AC-20 get **component and hook tests** (§5.4), plus a short QA smoke in the browser |
| **M-9** | `new-repository` skill Step 2: types go in `lib/repositories/types.ts` | `types.ts:230` already exports an unrelated `TokenUsage` interface (execution token usage) | New row types live in `TokenUsageRepository.ts` and are re-exported from `index.ts` with `export type`, following `UserProfileRepository` and `OrganizationRepository` (`index.ts:20-32`). This avoids the name clash (Q-9) |
| **M-10** | `turnUsage.ts:106-111` | `session_id` is at `:105`, `component: 'BizQLPlanCache'` at `:108` | Line drift only |
| **M-11** | FR-22: Layer 1 requirement records D-4 | The **Layer 1 requirement** shows Layer 1.1 (`:389`, `:416`) and removes the report from Layer 1.5 (`:417`), but **doesn't record D-4 (one business at a time)**. The investigation doc records it (`:236-238`, `:349`, `:358`) | T37 adds one clause to the Layer 1 requirement's roadmap row `:416` and a Change History row. Nothing else is rewritten. Historical SA-review text (e.g. `:596`, "Layer 1.5 system-user count") is left as the record of that review |
| **M-12** | `docs/BUSINESS_OS_TEST_PAGE_SCOPE.md` structure | The doc is stale in two places outside 1.1: it doesn't document the existing **Danger Zone** tab, and it still calls Overview "the only tab wired up today" (`:101`) | Not fixed beyond the new section. It is flagged for the user or TL (Q-12). T36 adds only the LLM Usage section, its ToC entry and a Change History row |
| **M-13** | `app/test-business-os/page.tsx` `callApi` | `callApi` logs **every** call to Debug Logs and replaces Last API Response | The tab doesn't use `callApi` for report requests (that would flood the log on auto-refresh, FR-11). It takes `onLog` / `onResponse` props like `PurgeDangerZone` (`PurgeDangerZone.tsx:84-97`). It pushes to Last API Response on manual refreshes only |
| **M-14** | AC-5 "a unit test calling `complete()` with no context" | `lib/ai/__tests__/providerFactory.complete.test.ts` already asserts the literal default; it is already a catalog importer | T8 extends that test to compare with `BOS_LEGACY_HELPER_LABEL`. No new file |

---

## 3. Design

### 3.1 Route location

**Chosen:** `app/api/admin/business-os/llm-usage/route.ts` and `app/api/admin/business-os/llm-usage/businesses/route.ts`.

| Option | Verdict |
|---|---|
| `app/api/admin/business-os/llm-usage[/businesses]` | **Chosen** (SA "Route location"). This is the Layer 1.5 report delivered early (D-1). It is an admin data API that a later admin UI will reuse (F-3), so it belongs with the admin APIs, next to the `chat-usage` precedent. Each route gates itself, because middleware skips `/api` |
| `app/api/test-business-os/...` | Rejected. It would tie a reusable admin report to an internal harness. No such namespace exists: the test page calls product routes only (the Modules tab added none). A test-page path also suggests a weaker gate than the report needs |
| Extend `app/api/admin/token-usage/**` | Forbidden (FR-1): those routes have no auth and use a direct `createClient` |

Next.js App Router allows `route.ts` in both a segment and its child segment. `__tests__` folders without `route.ts` create no route (precedent: `app/api/admin/agents/__tests__`).

### 3.2 Request validation (Zod) and gate order

Both routes follow one sequence, based on `chat-usage/route.ts:32-62` with an explicit admin `try/catch` (RC-3):

```typescript
// Pseudocode shared by both routes (each route inlines it; no new shared helper, see Q-10)
const receivedAt = new Date();                                   // fixed window end (FR-9)
const correlationId = request.headers.get('x-correlation-id') || crypto.randomUUID();
const requestLogger = logger.child({ correlationId });
try {
  const user = await getUser();
  if (!user) return 401;                                          // 1
  let isAdmin = false;
  try {
    isAdmin = await AdminAccessService.getInstance().isAdmin({ id: user.id, email: user.email });
  } catch (err) {
    requestLogger.error({ err, userId: user.id }, 'Admin check threw; denying access');
  }
  if (!isAdmin) { requestLogger.warn({ userId: user.id }, '...'); return 403; }  // 2 (fail closed)
  const parsed = schema.safeParse(query);                         // 3
  if (!parsed.success) return 400 { error: firstIssueMessage };
  ... reads ...
} catch (error) { requestLogger.error({ err: error }, '...'); return 500; }
```

**File:** `lib/business-os/usage/llmUsageVerification.ts` (route modules may export only handlers, so the schemas live here and are unit-tested)

```typescript
export const LLM_USAGE_LIMITS = {
  PAGE_SIZE: 1000,
  READ_CEILING: 5000,
  DISPLAY_ROWS: 500,
  DISPLAY_GROUPS: 500,
  PLATFORM_BREAKDOWN_ROWS: 500,
  HELPER_TIMESTAMPS: 50,
  BUSINESS_LIST: 50,
  SEARCH_MAX_CHARS: 100,
  MAX_WINDOW_MS: 7 * 24 * 60 * 60 * 1000,
  CLOCK_SKEW_MS: 60 * 1000,
} as const;

export const PLATFORM_ACCOUNT_MESSAGE =
  'This is the platform account; its Business OS rows are shown in Check 2';

/** Built per request, so the 60 s skew and 7-day bound use the request's own receivedAt. */
export function buildReportQuerySchema(receivedAt: Date) {
  return z.object({
    accountId: z
      .string({ required_error: 'Account id is required' })
      .uuid('Account id must be a UUID')
      .transform((id) => id.toLowerCase())
      .refine((id) => !isPlatformAccount(id), PLATFORM_ACCOUNT_MESSAGE),
    since: z
      .string({ required_error: 'Start time is required' })
      .datetime({ offset: true, message: 'Start time must be an ISO 8601 timestamp' })
      .superRefine((iso, ctx) => {
        const ms = Date.parse(iso);
        if (ms > receivedAt.getTime() + LLM_USAGE_LIMITS.CLOCK_SKEW_MS)
          ctx.addIssue({ code: 'custom', message: 'Start time is in the future' });
        if (ms < receivedAt.getTime() - LLM_USAGE_LIMITS.MAX_WINDOW_MS - LLM_USAGE_LIMITS.CLOCK_SKEW_MS)
          ctx.addIssue({ code: 'custom', message: 'Start time is more than 7 days ago; the maximum window is 7 days' });
      }),
    trigger: z.enum(['manual', 'auto']).default('manual'),
  });
}

export const BusinessListQuerySchema = z.object({
  search: z
    .string()
    .max(LLM_USAGE_LIMITS.SEARCH_MAX_CHARS, 'Search must be at most 100 characters')
    .transform((s) => s.trim())
    .optional()
    .transform((s) => (s ? s : undefined)),
});

/** start = min(since, receivedAt) (clamps up to +60 s); end = receivedAt. */
export function resolveReportWindow(sinceIso: string, receivedAt: Date): ReportWindow;
```

- Zod `3.25.76` is installed, so `.datetime({ offset: true })` is available.
- The 400 body is `{ success: false, error: <first issue message>, details: dev-only flatten }`. Messages are fixed strings and never echo input.
- `trigger` sets the log level only (§3.7).

### 3.3 Response types (runtime-free)

**File:** `lib/business-os/usage/llmUsageReportTypes.ts`. It contains only `export type` / `export interface`, with no value exports and no runtime imports. The client imports it with `import type` (RC-8).

```typescript
export type CheckStatus = 'pass' | 'fail' | 'incomplete' | 'info';     // 'not_checked' is client-only
export type RowFlag = 'legacy_feature' | 'unknown_area' | 'unknown_call_name' | 'missing_group_id';
export type AreaKind = 'current' | 'legacy' | 'unknown';

export interface LlmUsageCallRow {
  createdAt: string;
  feature: string;
  areaKind: AreaKind;
  area: string | null;          // catalog area (for legacy values, the area they belong to); null when unknown
  areaLabel: string;            // server-derived: area name, 'legacy' or 'unknown'
  component: string | null;
  sessionId: string | null;
  inputTokens: number;
  outputTokens: number;
  tokens: number;               // input + output (FR-12)
  estimatedCostUsd: number;
  success: boolean;
  errorCode: string | null;     // only when success === false; never error_message (FR-20)
  flags: RowFlag[];
  knownComponent: { component: string; reason: string } | null; // shown as "expected" when exempt
}

interface CheckBase { status: CheckStatus; error: string | null }   // safe message only

export interface CallsCheck extends CheckBase {
  rowsRead: number; incomplete: boolean;
  flaggedRows: number; flagCounts: Record<RowFlag, number>;
  rows: LlmUsageCallRow[]; rowsTruncated: boolean; displayCap: number;
}
export interface PlatformAccountCheck extends CheckBase {
  count: number | null;
  breakdown: Array<{ feature: string; component: string | null; calls: number }>;
  breakdownRowsRead: number; breakdownTruncated: boolean; breakdownCap: number;
}
export interface LegacyLabelsCheck extends CheckBase {
  legacyOnSelected: { count: number; byFeature: Array<{ feature: string; calls: number }>; incomplete: boolean } | null;
  legacyOnPlatform: { count: number } | null;
  helperLabelOnSelected: { count: number } | null;                  // (b) Fail if > 0
  helperLabelOnPlatform: {                                          // (c) Info only
    count: number; timestamps: string[]; timestampsTruncated: boolean; timestampCap: number;
  } | null;
  helperLabel: { feature: string; component: string };
}
export interface ActionGroup {
  sessionId: string; areaLabel: string;                             // area label or 'mixed'
  callCount: number; calls: Array<{ component: string; count: number }>;
  callSummary: string;                                              // e.g. 'planner ×2, analysis'
  tokens: number; estimatedCostUsd: number; firstAt: string; lastAt: string;
}
export interface GroupsCheck extends CheckBase {
  incomplete: boolean;
  groups: ActionGroup[]; groupsTotal: number; groupsTruncated: boolean; displayCap: number;
  ungrouped: Array<LlmUsageCallRow & { expected: boolean }>;
  ungroupedTotal: number; ungroupedFlagged: number; ungroupedTruncated: boolean;
}
export interface UsageCardCheck extends CheckBase {
  summedBy: 'database' | 'rows' | null; tokensPerCredit: number | null;
  windowEnd: 'open';                                                // M-1 / Q-1
  totals: { tokens: number; calls: number; credits: number } | null;
  categories: Array<{ key: string; tokens: number; calls: number; credits: number; shownOnCard: boolean }>;
  otherFeatures: Array<{ feature: string; tokens: number; calls: number; isBusinessOs: boolean }>;
}
export interface AreaTotals {
  status: 'complete' | 'incomplete' | 'error'; error: string | null;
  lines: Array<{ key: string; kind: 'area' | 'legacy' | 'unknown'; calls: number; tokens: number; estimatedCostUsd: number }>;
  total: { calls: number; tokens: number; estimatedCostUsd: number };
}
export interface LlmUsageReport {
  account: { userId: string; companyName: string | null; profileLookup: 'found' | 'none' | 'failed' };
  window: { start: string; end: string; startClamped: boolean };
  platformAccountIdsChecked: string[];
  incomplete: boolean;
  limits: { pageSize: number; readCeiling: number; displayRows: number; displayGroups: number;
            platformBreakdownRows: number; helperTimestamps: number };
  checks: { calls: CallsCheck; platformAccount: PlatformAccountCheck; legacyLabels: LegacyLabelsCheck;
            groups: GroupsCheck; usageCard: UsageCardCheck };
  areaTotals: AreaTotals;
}
export interface BusinessListEntry { userId: string; companyName: string | null }
export interface BusinessListResponse { businesses: BusinessListEntry[]; limit: number; platformAccountIds: string[] } // Q-3
export type ApiEnvelope<T> = { success: true; data: T } | { success: false; error: string };
```

The response is built on the server from typed values. It isn't Zod-parsed at runtime, and the client can't import a Zod schema (RC-8). Instead, AC-14's route test checks the JSON for forbidden keys (§5.3).

### 3.4 Catalog constants

**File:** `lib/business-os/llm/callCatalog.ts` (additions; nothing existing is renamed)

```typescript
/** Exported (FR-5). Case-insensitive (M-5). Body otherwise unchanged. */
export function isPlatformAccount(userId: string): boolean;

/** The ids the repository queries for platform-account rows: all-zero UUID, plus SYSTEM_ADMIN_USER_ID
 *  when it is set AND a UUID; lower-cased, de-duplicated, read at call time. */
export function platformAccountIds(): string[];

export const BOS_LEGACY_FEATURES = {
  chat: [],
  insights: ['insight-generation', 'correlated-insight-generation', 'health-summary-generation'],
  briefing: ['business-os'],
  website: ['landing-page-generation'],
  intake: [],
  leads: ['lead-reply'],
} as const satisfies Record<BosLlmArea, readonly string[]>;

export const BOS_LEGACY_FEATURES_FLAT: readonly string[] = BOS_LLM_AREAS.flatMap((a) => BOS_LEGACY_FEATURES[a]);

/** The LIKE prefix of the Business OS row filter. Covers every bosFeature(area) and the legacy 'business-os'. */
export const BOS_FEATURE_FILTER_PREFIX = 'business-os';

/** RC-4: prefix OR legacy list, built only from constants. Passed to the repository as data. */
export function bosRowFilter(): { featurePrefix: string; features: readonly string[] };
export function isBusinessOsFeature(feature: string): boolean;   // startsWith(prefix) || legacy flat includes

export type BosRowFlagExemption = 'unknown_call_name' | 'missing_group_id';
export const BOS_KNOWN_NON_CATALOG_COMPONENTS = {
  BizQLPlanCache: {
    component: 'BizQLPlanCache', area: 'chat', exemptFrom: ['unknown_call_name'],
    reason: 'Zero-token chat cache-hit row; not an LLM call; carries the turn id',
  },
  IntentParser: {
    component: 'IntentParser', area: 'chat', exemptFrom: ['unknown_call_name', 'missing_group_id'],
    reason: 'Excluded chat v1 intent parser; records no grouping id',
  },
} as const satisfies Record<string, { component: string; area: BosLlmArea;
  exemptFrom: readonly BosRowFlagExemption[]; reason: string }>;

/** The shared helper's default labels (providerFactory.ts:340-344 keeps its literal; T8 asserts agreement). */
export const BOS_LEGACY_HELPER_LABEL = { feature: 'onboarding', component: 'simple-complete' } as const;
```

- **`usageCategories.ts`:** a local helper `bosCategoryFeatures(area) = [bosFeature(area), ...BOS_LEGACY_FEATURES[area]]`. Chat stays `[...bosCategoryFeatures('chat'), 'chat-v3']`. The category keys, the category order and every feature→category mapping are unchanged. The order of legacy values *within* the insights array changes, which has no effect on mapping or totals. `usageCategories.test.ts` runs unedited.
- **`turnUsage.ts:108`:** `component: BOS_KNOWN_NON_CATALOG_COMPONENTS.BizQLPlanCache.component`. The value is byte-identical, so there is no behaviour change.
- **`IntentParser.ts`:** not touched.

### 3.5 `TokenUsageRepository`

**File:** `lib/repositories/TokenUsageRepository.ts`. It imports only `@supabase/supabase-js` types, `@/lib/supabaseServer`, `@/lib/logger` and `./types`. **It imports nothing from `lib/business-os/**`** (RC-7), so it can never become core, barrel or caller for the gate.

```typescript
// Intentionally service-role (RLS bypass). Rule 4 is enforced by signature instead: every method REQUIRES
// an account id or a non-empty id list; no method reads "all accounts". Cross-account callers
// (the admin LLM usage report) are admin-gated in their routes; the owner usage route passes the session id.

export interface TokenUsageWindow { start: Date; end: Date }
export interface TokenUsageFeatureFilter { featurePrefix: string; features: readonly string[] }
export type TokenUsageMatch =
  | { kind: 'row_filter'; filter: TokenUsageFeatureFilter }         // prefix OR list (Check 2)
  | { kind: 'features'; features: readonly string[] }               // IN list (Check 3a)
  | { kind: 'label'; feature: string; component: string };          // exact pair (Check 3b/3c)

export interface LedgerCallRow { id: string | number; created_at: string; feature: string | null;
  component: string | null; session_id: string | null; input_tokens: number | null;
  output_tokens: number | null; cost_usd: number | string | null; success: boolean | null; error_code: string | null }
export interface LedgerLabelRow { created_at: string; feature: string | null; component: string | null }
export interface LedgerSummaryRow { feature: string | null; total_tokens: number | null; created_at: string }
export interface UsageSummaryRpcRow { bucket: string; key: string; tokens: number | string; calls: number | string }

/** Exported for the AC-24 test. */
export const TOKEN_USAGE_COLUMNS = {
  call: 'id, created_at, feature, component, session_id, input_tokens, output_tokens, cost_usd, success, error_code',
  label: 'created_at, feature, component',
  summary: 'feature, total_tokens, created_at',
  count: 'id',
} as const;

export class TokenUsageRepository {
  constructor(supabaseClient: SupabaseClient = supabaseServer);

  /** FR-23: the card's RPC. No end bound (M-1). */
  usageSummaryByFeatureAndDay(userId: string, since: Date): Promise<AgentRepositoryResult<UsageSummaryRpcRow[]>>;

  /** FR-23: one page of the card's fallback. The paging loop stays in usageSummary.ts (behaviour identical). */
  listSummaryRowsPage(userId: string, since: Date, from: number, to: number): Promise<AgentRepositoryResult<LedgerSummaryRow[]>>;

  /** FR-12: bounded paged read; created_at DESC, id DESC; pageSize ≤ 1000; ceiling ≤ 5000; de-duped by id.
   *  reachedCeiling = rows.length >= ceiling. */
  listCallsInWindow(userId: string, window: TokenUsageWindow, filter: TokenUsageFeatureFilter,
    opts: { pageSize: number; ceiling: number }): Promise<AgentRepositoryResult<{ rows: LedgerCallRow[]; reachedCeiling: boolean }>>;

  /** FR-13/14: exact head count. */
  countInWindow(userIds: readonly string[], window: TokenUsageWindow, match: TokenUsageMatch): Promise<AgentRepositoryResult<number>>;

  /** FR-13/14: capped newest-first label read (breakdown ≤ 500, timestamps ≤ 50). limit ≤ 500. */
  listLabelsInWindow(userIds: readonly string[], window: TokenUsageWindow, match: TokenUsageMatch,
    limit: number): Promise<AgentRepositoryResult<LedgerLabelRow[]>>;
}
export const tokenUsageRepository = new TokenUsageRepository();
```

**Guards.** Every method checks these before any query. A failed guard returns `{ data: null, error }` without calling Supabase:
- the account id or ids are required;
- an empty `userIds` is rejected;
- every id must match a local UUID regex (this also keeps `.in()` safe);
- filter prefix and feature strings must match `^[a-z0-9-]+$` (RC-4 defence in depth, so the `.or()` string can't be injected even by a future caller);
- `pageSize`, `ceiling` and `limit` must be in range;
- `window.start <= window.end`.

**Query shapes:**

| Method | Query |
|---|---|
| Single account | `.eq('user_id', userId)` |
| Id list | `.in('user_id', userIds)` |
| Window | `.gte('created_at', start.toISOString()).lte('created_at', end.toISOString())` |
| `row_filter` | `.or(\`feature.like.${prefix}*,feature.in.(${features.map(quote).join(',')})\`)` (only the like clause when `features` is empty) |
| `features` | `.in('feature', features)` |
| `label` | `.eq('feature', f).eq('component', c)` |
| `countInWindow` | `.select(TOKEN_USAGE_COLUMNS.count, { count: 'exact', head: true })` |

- **Errors:** methods return `{ data, error }` and never throw. Errors are logged with `this.logger.warn({ err, method })` and never include ids beyond counts.
- **Barrel:** `lib/repositories/index.ts` gains `export { TokenUsageRepository, tokenUsageRepository } from './TokenUsageRepository'` and `export type { … } from './TokenUsageRepository'`.
- **Imports by consumers:** they import the file path directly, as `chat-usage` does, not the barrel.

### 3.6 `BusinessProfileRepository.searchForAdmin`

```typescript
/** Escapes \ % _ for ILIKE. Exported for the AC-15 test. `*` is a PostgREST wildcard and cannot be escaped (M-4). */
export function escapeIlikePattern(text: string): string;

/**
 * Admin business picker (Layer 1.1 FR-2).
 * INTENTIONAL CROSS-ACCOUNT READ (CLAUDE.md Rule 4): no user_id filter by design. Only caller:
 * GET /api/admin/business-os/llm-usage/businesses, which is admin-gated (AdminAccessService) before this runs.
 * Selects ONLY user_id, company_name. Never builds an .or() string from input.
 */
async searchForAdmin(search: string | undefined, limit: number):
  Promise<BusinessProfileRepositoryResult<Array<{ user_id: string; company_name: string | null }>>>;
// .select('user_id, company_name')
// [.ilike('company_name', `%${escapeIlikePattern(search)}%`)]
// .order('company_name', { ascending: true, nullsFirst: false })
// .limit(clamp(limit, 1, 50))
```

### 3.7 Routes

**`GET /api/admin/business-os/llm-usage?accountId=<uuid>&since=<ISO>&trigger=manual|auto`**
1. Gate and validate (§3.2).
2. Window from `resolveReportWindow(since, receivedAt)`.
3. `const report = await buildLlmUsageReport({ accountId, window }, requestLogger)`.
4. Log with `requestLogger[trigger === 'auto' ? 'debug' : 'info']`:
   - fields `{ adminUserId, accountId, windowStart, windowEnd, rowsRead, incomplete, rowsTruncated, groupsTruncated, breakdownTruncated, timestampsTruncated, statuses: { calls, platformAccount, legacyLabels, groups, usageCard, areaTotals } }`;
   - message `'LLM usage report served'`;
   - **no company name**.
5. Return `{ success: true, data: report }`.
6. Denied access: `warn` with `{ userId }`. The route writes no audit event and imports no provider.

**`GET /api/admin/business-os/llm-usage/businesses?search=<text>`**
1. Gate and validate (§3.2).
2. `businessProfileRepository.searchForAdmin(search, 50)`. On a repository error: 500 with `'Could not load businesses'` and an error log.
3. Log `info` with `{ adminUserId, searchLength, resultCount }`. The search text and names are never logged, because a search is often a business name.
4. Return `{ success: true, data: { businesses: [{ userId, companyName }], limit: 50, platformAccountIds } }` (Q-3).

### 3.8 Report orchestration and the check algorithms

**File:** `lib/business-os/usage/llmUsageReport.ts`, with dependencies injected for tests: `{ tokenUsage, profiles, readUsageSummary, readTokensPerCredit }`.

All reads run in parallel under `Promise.allSettled`, so one failure never hides another check (FR-18):

| Read | Call | Feeds |
|---|---|---|
| R1 paged | `listCallsInWindow(accountId, window, bosRowFilter(), { 1000, 5000 })` | Check 1, Check 3(a) selected part, Check 4, area totals |
| R2 count | `countInWindow(platformAccountIds(), window, { row_filter })` | Check 2 |
| R3 capped | `listLabelsInWindow(platformIds, window, { row_filter }, 500)` | Check 2 breakdown |
| R4 count | `countInWindow(platformIds, window, { features: BOS_LEGACY_FEATURES_FLAT })` | Check 3(a) platform part |
| R5 count | `countInWindow([accountId], window, { label: BOS_LEGACY_HELPER_LABEL })` | Check 3(b) |
| R6 count | `countInWindow(platformIds, window, { label })` | Check 3(c) |
| R7 capped | `listLabelsInWindow(platformIds, window, { label }, 50)` | Check 3(c) timestamps |
| R8 | `readUsageSummary(accountId, window.start)` + `readTokensPerCredit()` | Check 5 |
| R9 | `profiles.findByUserId(accountId)` → `company_name` only | Header (M-7) |

- `platformAccountIds()` is read **once** per request, and that same array is returned as `platformAccountIdsChecked`.
- A failed read is logged with `{ err, read: 'R2' }` and becomes `error: 'Could not read the usage ledger for this check'` on its check. Raw error text is never returned.

**Status precedence (every check):** `error → fail`; else `any failure finding → fail`; else `incomplete → incomplete`; else `no data → info`; else `pass`.

**Row classification** (`classifyCallRow`, pure):

```
feature = row.feature ?? ''
if feature === bosFeature(a) for some a in BOS_LLM_AREAS  → areaKind 'current', area a, areaLabel a
else if feature ∈ BOS_LEGACY_FEATURES[a]                   → areaKind 'legacy',  area a, areaLabel 'legacy', flag legacy_feature
else                                                        → areaKind 'unknown', area null, areaLabel 'unknown', flag unknown_area
     (the row passed the Business OS row filter, so it is a business-os* value that isn't current or legacy)

known = areaKind === 'current' && KNOWN[row.component]?.area === area ? KNOWN[row.component] : null   (Q-7)

if areaKind === 'current'
   and component ∉ BOS_LLM_CALLS[area]
   and !(known?.exemptFrom includes 'unknown_call_name')     → flag unknown_call_name
     (legacy / unknown rows are already flagged; their call names aren't judged against the catalog, Q-7)
if !session_id and !(known?.exemptFrom includes 'missing_group_id') → flag missing_group_id
tokens = (input_tokens ?? 0) + (output_tokens ?? 0); estimatedCostUsd = Number(cost_usd) || 0
errorCode = success === false ? error_code : null
knownComponent = known ? { component, reason } : null
```

Exemption results:

| Row | Result |
|---|---|
| `BizQLPlanCache` with a session id | No flags |
| `BizQLPlanCache` with no session id | `missing_group_id` |
| `IntentParser` with no session id | No flags; shown as expected |
| `IntentParser` under a non-chat feature | Not exempt |

**Check 1: Calls** (`evaluateCallsCheck(classified, { incomplete })`)
- `flaggedRows` and `flagCounts` are computed over **all** rows read.
- `status`: fail if `flaggedRows > 0`; incomplete if `incomplete`; info if 0 rows; pass otherwise.
- `rows` = classified rows sorted `createdAt DESC` (the read order), sliced to 500. `rowsTruncated = rowsRead > 500`.

**Check 2: Nothing on the platform account**
- `status`: fail if `count > 0`; pass if `count === 0`; fail with error if R2 failed.
- `breakdown` groups R3 rows by `(feature, component)` with counts, sorted by calls DESC.
- `breakdownTruncated = breakdownRowsRead < count`. If R3 fails, the check fails with an error, because the breakdown would otherwise be silently empty.
- Tab note: "platform-wide, not limited to the selected business".

**Check 3: No legacy labels**
- (a) selected part = R1 rows with `areaKind === 'legacy'`, as a count plus by-feature totals, with `incomplete` from R1. (a) platform part = R4.
- (b) = R5. (c) = R6 count plus R7 timestamps (`timestampsTruncated = R6 > timestamps.length`).
- `status`: fail if any read R1/R4/R5/R6/R7 errored (Q-6); fail if (a) selected > 0, (a) platform > 0 or (b) > 0; incomplete if R1 incomplete; otherwise **pass**. (c) never changes the status; it is Info alongside. FR-14 has no Info-for-no-data case, so a window with no rows is Pass: no legacy labels were found.
- Tab text for (c): "A website or intake call that lost its context would also appear here; this tab can't prove it is absent."

**Check 4: Grouped by action**
- Grouped rows: rows with `sessionId`, grouped by it.
  - Area label: the common `areaLabel`, or `'mixed'`.
  - `calls`: components by first occurrence in ascending time, counts aggregated (so `planner, analysis, planner` → `planner ×2, analysis`); a null component shows as `(none)`.
  - Tokens and cost are summed; `firstAt` and `lastAt` are min and max.
- Groups are sorted by `lastAt DESC` and sliced to 500. `groupsTruncated = groupsTotal > 500`.
- Ungrouped rows: rows with no `sessionId`. `expected = !flags.includes('missing_group_id')`. `ungroupedFlagged` counts the rows that aren't expected. The ungrouped list is also capped at 500, with `ungroupedTruncated`.
- `status`: fail if `ungroupedFlagged > 0`; incomplete if R1 incomplete; info if 0 rows; pass otherwise.
- Tab notes: shared insight run ids (Layer 1 FR-16) and KI-2 (a missing plan-cache store embedding isn't a failure).

**Check 5: Usage card view** (`evaluateUsageCardCheck(summaryResult, tokensPerCredit)`)
- `categories` = `summariseUsageByCategory(summary.byFeature)`, each with `credits = toCredits(tokens, tokensPerCredit)` and `shownOnCard = tokens > 0`. The card rows themselves come from `buildCardBreakdown`, the same function the card uses (§3.9).
- `otherFeatures` = the byFeature entries whose `usageCategoryForFeature(f) === 'other'`, with `isBusinessOs = isBusinessOsFeature(f)`.
- `status`: fail if R8 errored; fail if any `otherFeatures[].isBusinessOs`; info if `totals.calls === 0` (Q-5b); pass otherwise.
- `windowEnd: 'open'` (M-1). Tab caveats: RC-10 (the owner's card uses fixed ranges) and the open end.

**Area totals** (`computeAreaTotals(classified, { incomplete })`)
- One line per area in `BOS_LLM_AREAS` (always present, including zeros), one `legacy` line, and an `unknown` line only when present.
- `total` is the sum of all rows read, and the lines add up to it (AC-11).
- `status`: `error` if R1 failed (shown as Fail), `incomplete` if R1 incomplete, else `complete`.

**`incomplete`** (top level) = R1 `reachedCeiling`. The tab message is "more than 5,000 Business OS calls in this window; narrow the start time". An exact 5,000 rows counts as incomplete (literal reading of FR-18; never a false green; Q-8).

### 3.9 `usageSummary.ts` extraction (FR-23)

**File:** `lib/business-os/usage/usageSummary.ts`. The code is moved verbatim where possible, and only the reads go through the repositories.

```typescript
export interface UsageSummary { totalTokens: number; totalCalls: number;
  byFeature: Map<string, { tokens: number; calls: number }>; byDay: Map<string, number> }

/** Pure; from RPC rows. BIGINT-as-string coercion; totals from 'feature' rows only (no day double count). */
export function summaryFromRpcRows(rows: readonly UsageSummaryRpcRow[]): UsageSummary;

/** DB first (null-means-not-migrated → warn + fall back); fallback pages 1,000 at a time, throws on error (as today). */
export async function readUsageSummary(userId: string, since: Date, log: WarnLogger,
  deps?: { tokenUsage: Pick<TokenUsageRepository, 'usageSummaryByFeatureAndDay' | 'listSummaryRowsPage'> }
): Promise<{ summary: UsageSummary; summedBy: 'database' | 'rows' }>;

/** Pure: positive integer, else 10 (parseInt(String(value ?? ''), 10)). */
export function parseTokensPerCredit(value: unknown): number;

/** ConfigRepository(supabaseServer).getSystemConfig('tokens_per_pilot_credit'); any error → 10 (M-2). */
export async function readTokensPerCredit(deps?: { config: Pick<ConfigRepository, 'getSystemConfig'> }): Promise<number>;

export function toCredits(tokens: number, tokensPerCredit: number): number;          // Math.round(tokens / tpc)

/** The card's breakdown, moved verbatim from route.ts:315-325 (filter tokens > 0 → map → sort by credits DESC). */
export function buildCardBreakdown(usage: UsageSummary, tokensPerCredit: number):
  Array<{ key: string; credits: number; calls: number; share: number }>;
```

**The owner usage route after the change:**
- It keeps `QuerySchema`, `RANGE_DAYS`, `fillGaps`, `readAllowanceCredits` and the response literal.
- `Promise.all([readUsageSummary(user.id, since, requestLogger), readTokensPerCredit(), readAllowanceCredits()])`.
- `summedBy` is logged from the result. `credits`, `remaining` and `daily` use `toCredits`. `breakdown` uses `buildCardBreakdown`.
- **Log order:** the fallback now starts as soon as the RPC returns, instead of after all three promises settle. The warn log and the response are unchanged.
- The route no longer imports `supabaseServer` for `token_usage`. `readAllowanceCredits` keeps its own `ais_system_config` read, as FR-23 says; moving it is out of scope.

**AC-23 regression guard:** two tests.
1. **T1: a characterization test of the route**, written **before** the refactor and run unedited after it. It mocks `@/lib/supabaseServer` at the client level, so the same mocks serve the old direct calls and the new repositories, which both use `supabaseServer` by default. With fake timers it asserts the exact `JSON.stringify` of the response for:
   - the database path;
   - the fallback path;
   - BIGINT strings;
   - each tokens-per-credit case;
   - null / positive allowance;
   - 401 / 400;
   - plus the `summedBy` log field.

   A before/after pass of this test is the documented byte-for-byte proof.
2. **T14: a unit test of `usageSummary.ts`** covering each FR-23 rule.

### 3.10 Client: components and refresh state machine

**Structure** (all `'use client'`; the only imports from server modules are `import type` from `@/lib/business-os/usage/llmUsageReportTypes`):

| File | Role |
|---|---|
| `components/test-business-os/llm-usage/LlmUsageVerification.tsx` | Tab root. Props `{ sessionUserId: string \| null; authLoading: boolean; onLog: (type, msg) => void; onResponse: (payload: unknown) => void }`. Renders sign-in / "Admins only" / controls + summary + panels. States the test-page exception (FR-8) |
| `llm-usage/BusinessPicker.tsx` | Debounced (300 ms) search → businesses route; list shows company name or "(no name)" + short id; "My account"; paste-id field (local UUID regex); platform warning from `platformAccountIds` (Q-3) |
| `llm-usage/WindowControls.tsx` | `datetime-local` (step 1 s) showing the local zone name; "Start now"; Refresh; auto-refresh toggle + interval select (10/30/60) + auto status text |
| `llm-usage/StatusSummary.tsx` | Business, window (start → server end, and Check 5 open end), platform ids checked, one `StatusBadge` per check + area totals |
| `llm-usage/StatusBadge.tsx` | Colour **and** text: Pass / Fail / Incomplete / Info / Not checked |
| `llm-usage/CheckPanels.tsx` | `CallsPanel`, `PlatformAccountPanel`, `LegacyLabelsPanel`, `GroupsPanel`, `UsageCardPanel`, `AreaTotalsPanel`; each shows its error, truncation warning and incomplete message |
| `llm-usage/formatters.ts` | Pure: local time with zone, short id, cost (`$0.000123 (estimated)`), tokens |
| `llm-usage/refreshMachine.ts` | Pure reducer (below) |
| `hooks/useLlmUsageAutoRefresh.ts` | Timers, `visibilitychange`, fetch with `AbortController`, request-id stale guard; drives the reducer (follows the `hooks/useSideConsole.ts` location) |

- **Mount behaviour:** on mount (signed in), the tab calls the business list with no search. That call is also the admin probe: `403` → "Admins only" and nothing else rendered; `401` → the page's sign-in text.
- **Tab switch:** the page renders tabs conditionally, so leaving the tab unmounts the component. The hook's cleanup clears timers and aborts the in-flight fetch, which satisfies "stops when the admin leaves the tab". Control state is not kept across tab switches (R-9).

**Reducer state:**

```typescript
type AutoStatus = 'off' | 'running' | 'paused_hidden' | 'stopped_input_change';
interface RefreshState {
  selection: { accountId: string; startIso: string } | null;
  phase: 'not_checked' | 'loading' | 'ready' | 'error' | 'forbidden' | 'unauthenticated';
  report: LlmUsageReport | null;
  error: string | null;
  inFlight: { requestId: number; trigger: 'manual' | 'auto' } | null;
  auto: { status: AutoStatus; intervalSec: 10 | 30 | 60 };
  nextRequestId: number;
}
```

**Transitions:**

| Event | Guard | Effect |
|---|---|---|
| `SELECT_ACCOUNT(id)` / `SET_START(iso)` | value changed | `selection` updated; `report = null`, `phase = 'not_checked'`; if `auto.status ∈ {running, paused_hidden}` → `stopped_input_change` (FR-10: until the next manual refresh) |
| `REFRESH_MANUAL` | `selection` set, `inFlight === null` | `inFlight = { id, 'manual' }`, `phase = 'loading'`; log `info` "Refreshing LLM usage…" |
| `AUTO_TICK` | `auto.status === 'running'` | if `document.visibilityState === 'hidden'` → `paused_hidden`, no request; else if `inFlight` → skip (no overlap); else `inFlight = { id, 'auto' }` |
| `REQUEST_OK(id, report)` | `id === inFlight.requestId` (else ignored as stale) | `report`, `phase = 'ready'`, `inFlight = null`. **Manual:** log `success`, `onResponse(json)`, and if `auto.status ∈ {paused_hidden, stopped_input_change}` → `running`. **Auto:** no log |
| `REQUEST_FAIL(id, status, message)` | matching id | `inFlight = null`; `403` → `phase 'forbidden'`; `401` → `'unauthenticated'`; else `'error'`. Always log `error`. **Any failure → `auto.status = 'off'`** (toggle turned off; re-enable explicitly, Q-13) |
| `TOGGLE_AUTO(on)` | on requires `selection` | `running` / `off` |
| `SET_INTERVAL(sec)` | — | interval updated; a running timer is re-armed |
| `VISIBILITY_HIDDEN` | `running` | `paused_hidden` (timer cleared). `VISIBILITY_VISIBLE` does **not** resume (FR-10) |
| `UNMOUNT` | — | timers cleared, fetch aborted, late results ignored |

- **Timer:** the hook re-arms a `setTimeout(intervalSec * 1000)` **after** each auto request completes and whenever the status becomes `running`. It never uses `setInterval`, so requests can't overlap even if one is slower than the interval. Refresh is disabled while `inFlight`.
- **Request:** `GET /api/admin/business-os/llm-usage?accountId=…&since=<startIso>&trigger=<manual|auto>` with `x-correlation-id`.
- **Start time:** default `now − 1 h`. "Start now" sets `startIso = new Date().toISOString()` exactly; the input shows the local value, and changing the input converts local → UTC ISO.

### 3.11 Page wiring

`app/test-business-os/page.tsx`:
- add `{ id: 'llm-usage', label: 'LLM Usage' }` to `TABS`;
- add a block `{activeTab === 'llm-usage' && (<div style={panelStyle}>… <LlmUsageVerification sessionUserId={user?.id ?? null} authLoading={authLoading} onLog={addDebugLog} onResponse={setLastResponse} /></div>)}`.

No other page change.

---

## 4. Files to Create / Modify

### 4.1 File list

| File | Action | Reason (FR) |
|---|---|---|
| `lib/business-os/llm/callCatalog.ts` | modify | Export/extend `isPlatformAccount`; new constants and helpers (FR-4, FR-5, FR-6) |
| `lib/business-os/llm/__tests__/callCatalog.test.ts` | modify | AC-4, AC-5 constants tests |
| `lib/business-os/usage/usageCategories.ts` | modify | Build Business OS categories from constants (FR-4) |
| `lib/business-os/usage/__tests__/usageCategories.catalog.test.ts` | create | AC-10 static rules and AC-4 derivation; the existing test stays unedited |
| `lib/business-os/bizql/telemetry/turnUsage.ts` | modify | Component constant (FR-6) |
| `lib/ai/__tests__/providerFactory.complete.test.ts` | modify | AC-5 helper label agreement |
| `lib/repositories/TokenUsageRepository.ts` | create | FR-24 |
| `lib/repositories/__tests__/TokenUsageRepository.test.ts` | create | AC-24 |
| `lib/repositories/index.ts` | modify | Export class, singleton and types (FR-24) |
| `lib/repositories/BusinessProfileRepository.ts` | modify | `searchForAdmin`, `escapeIlikePattern` (FR-2) |
| `lib/repositories/__tests__/BusinessProfileRepository.searchForAdmin.test.ts` | create | AC-15 |
| `lib/business-os/usage/usageSummary.ts` | create | FR-23 |
| `lib/business-os/usage/__tests__/usageSummary.test.ts` | create | AC-23 |
| `app/api/business-os/usage/route.ts` | modify | Call `usageSummary.ts`; response unchanged (FR-23) |
| `app/api/business-os/usage/__tests__/route.test.ts` | create | AC-23 characterization (before/after) |
| `lib/business-os/usage/llmUsageReportTypes.ts` | create | Runtime-free response types (FR-7, RC-8) |
| `lib/business-os/usage/llmUsageVerification.ts` | create | Schemas, window, classification, checks, area totals (FR-3, FR-12–FR-18) |
| `lib/business-os/usage/__tests__/llmUsageVerification.test.ts` | create | AC-3 (schema/window), AC-6–AC-12 |
| `lib/business-os/usage/llmUsageReport.ts` | create | Read orchestration (FR-12–FR-20) |
| `lib/business-os/usage/__tests__/llmUsageReport.test.ts` | create | AC-12(d), AC-13, AC-14 |
| `app/api/admin/business-os/llm-usage/route.ts` | create | FR-1, FR-3 |
| `app/api/admin/business-os/llm-usage/__tests__/route.test.ts` | create | AC-1, AC-2, AC-3, AC-13, AC-14, AC-19 (server logs) |
| `app/api/admin/business-os/llm-usage/businesses/route.ts` | create | FR-2, FR-3 |
| `app/api/admin/business-os/llm-usage/businesses/__tests__/route.test.ts` | create | AC-1, AC-2, AC-3, AC-15 |
| `components/test-business-os/llm-usage/LlmUsageVerification.tsx` | create | FR-7–FR-11 |
| `components/test-business-os/llm-usage/BusinessPicker.tsx` | create | FR-8 |
| `components/test-business-os/llm-usage/WindowControls.tsx` | create | FR-9, FR-10 |
| `components/test-business-os/llm-usage/StatusSummary.tsx` | create | FR-11 |
| `components/test-business-os/llm-usage/StatusBadge.tsx` | create | FR-11, NFR Usability |
| `components/test-business-os/llm-usage/CheckPanels.tsx` | create | FR-12–FR-18 display |
| `components/test-business-os/llm-usage/formatters.ts` | create | Display helpers |
| `components/test-business-os/llm-usage/refreshMachine.ts` | create | FR-10 reducer |
| `components/test-business-os/llm-usage/__tests__/refreshMachine.test.ts` | create | AC-18 (logic) |
| `components/test-business-os/llm-usage/__tests__/LlmUsageVerification.test.tsx` | create | AC-17, AC-19, AC-20 |
| `components/test-business-os/llm-usage/__tests__/boundaries.static.test.ts` | create | AC-4 and AC-16 static checks |
| `hooks/useLlmUsageAutoRefresh.ts` | create | FR-10 timers, visibility, fetch |
| `hooks/useLlmUsageAutoRefresh.test.tsx` | create | AC-18 (timers, overlap, visibility, trigger) |
| `app/test-business-os/page.tsx` | modify | Tab entry and block (FR-7) |
| `docs/BUSINESS_OS_TEST_PAGE_SCOPE.md` | modify | LLM Usage section, ToC, Change History (FR-21) |
| `docs/requirements/BUSINESS_OS_LLM_CALL_ATTRIBUTION_LAYER1_REQUIREMENT.md` | modify | FR-22 gap: record D-4 (M-11) |
| `docs/investigations/LLM_CREDIT_AND_AUDIT_TRACKING.md` | verify only | FR-22 already complete (§2.2 M-11) |
| `docs/workplans/BUSINESS_OS_LLM_USAGE_VERIFICATION_LAYER1_1_WORKPLAN.md` | create/maintain | This workplan |

**Not touched:**
- `lib/business-os/IntentParser.ts`
- `lib/business-os/bizql/telemetry/usageReport.ts` (F-1)
- `app/api/admin/chat-usage/route.ts`
- `app/api/admin/token-usage/**`
- `lib/analytics/aiAnalytics.ts`
- `lib/ai/providerFactory.ts`
- `lib/services/AdminAccessService.ts`
- `scripts/typecheck-bos-llm.ts` and its baseline JSON
- no migrations

### 4.2 Effect on `npm run typecheck:bos-llm`

**Before (measured, `56fb7dbd`):** 96 files in scope; 30 errors, 0 new; baseline blob `8cff995b…`.

**Predicted after**, derived from the script's rules (`typecheck-bos-llm.ts:161-194`). T38 confirms it with `--list` and records the actual delta in §11.

| New or changed file | Scope layer | Why |
|---|---|---|
| `lib/business-os/usage/usageSummary.ts`, `llmUsageVerification.ts`, `llmUsageReport.ts`, `llmUsageReportTypes.ts` | core | Under `SCOPED_DIRS` |
| `lib/business-os/usage/__tests__/usageSummary.test.ts`, `llmUsageVerification.test.ts`, `llmUsageReport.test.ts`, `usageCategories.catalog.test.ts` | core | Under `SCOPED_DIRS` |
| `app/api/admin/business-os/llm-usage/route.ts` | catalog-importer | Imports `platformAccountIds` (and the verification module) |
| `app/api/admin/business-os/llm-usage/businesses/route.ts` | catalog-importer | Imports `platformAccountIds` (Q-3; if Q-3 is rejected it imports `llmUsageVerification.ts` for the schema and becomes a **caller**, still in scope) |
| `components/test-business-os/llm-usage/*.tsx`, `refreshMachine.ts`, `hooks/useLlmUsageAutoRefresh.ts` that `import type` from `llmUsageReportTypes.ts` | caller | Type-only imports are followed by the script. **This is an addition SA's RC-7 list didn't name.** These new files are type-checked against the response contract, which is a benefit. They must compile clean |
| `app/api/admin/business-os/llm-usage/__tests__/route.test.ts`, `businesses/__tests__/route.test.ts` | catalog-importer only if they import the catalog (they will, for `platformAccountIds`/constants); otherwise out of scope | Importing a *caller* (the route) doesn't bring a file into scope |
| `app/api/business-os/usage/route.ts`, `turnUsage.ts`, `callCatalog.ts`, `usageCategories.ts`, `callCatalog.test.ts`, `providerFactory.complete.test.ts` | already in scope | No change |
| `lib/repositories/TokenUsageRepository.ts` | **not in scope** | Imports nothing from `lib/business-os/**` (RC-7) |
| `lib/repositories/index.ts` | **not in scope** | Re-exports only non-scoped files. Step 2 (barrels) runs before step 3 (callers), so a barrel is added only if it re-exports a core or barrel file |
| `lib/repositories/BusinessProfileRepository.ts`, its tests, `TokenUsageRepository.test.ts` | not in scope | No catalog import, not re-exporting scoped files |
| `app/test-business-os/page.tsx`, `app/api/business-os/usage/__tests__/route.test.ts`, component and hook tests | not in scope | They import callers only, one level (unless a test imports the catalog directly) |

- **Predicted delta:** about +18 to +22 files, all new code. **No existing file joins the scope, and none of the 19 barrel importers joins.**
- **Baseline JSON:** must stay byte-identical (blob `8cff995bebebae238587d7a03886c7851a0e2146`). Any new error is fixed in code, never baselined. If the `--list` output shows `lib/repositories/index.ts` or any pre-existing file joining the scope, the Dev stops and escalates to SA before continuing.

---

## 5. Test Plan

### 5.1 Unit tests: constants, repositories, usage summary

| Test file | Cases | AC |
|---|---|---|
| `callCatalog.test.ts` (extend) | `platformAccountIds()` with env unset → `[all-zero]`; set to UUID → both; upper-case env → lower-cased; env === all-zero → de-duplicated; non-UUID env → excluded while `isPlatformAccount(env)` is still true (documented); every id in the list satisfies `isPlatformAccount`; `isPlatformAccount` is case-insensitive; `BOS_LEGACY_FEATURES_FLAT` equals the flattened per-area lists; every `bosFeature(area)` and every legacy `business-os` value starts with `BOS_FEATURE_FILTER_PREFIX`; `isBusinessOsFeature` true for current, legacy and `business-os-webiste`, false for `onboarding` / `chat-v3`; `BOS_KNOWN_NON_CATALOG_COMPONENTS` key === `component`, area ∈ `BOS_LLM_AREAS`, `BizQLPlanCache.exemptFrom = ['unknown_call_name']`, `IntentParser.exemptFrom` has both; known components aren't catalog call names | AC-4, AC-5 |
| `providerFactory.complete.test.ts` (extend) | No-context call → recorded `feature` / `component` `toStrictEqual` `BOS_LEGACY_HELPER_LABEL` fields | AC-5 |
| `usageCategories.test.ts` (unchanged) | Must pass unedited after T6 | AC-4 |
| `usageCategories.catalog.test.ts` (new) | For every area: `usageCategoryForFeature(bosFeature(area)) === area` and every `BOS_LEGACY_FEATURES[area]` value maps to `area`; `onboarding` → `help`; the category map derived from a synthetic extra area (via the derived-list helper) includes it | AC-4, AC-10 |
| `TokenUsageRepository.test.ts` | Mock `SupabaseClient` chain recording every call. For **each** method: account filter applied (`eq('user_id', id)` or `in('user_id', ids)`); `in` list equals the input; an empty `userIds` → error, no `from` call; a non-UUID id → error, no query; a bad prefix/feature (`'x),user_id.neq.('`) → error, no query; window `gte` / `lte` with ISO strings; `listCallsInWindow` pages 1,000 at a time, stops on a short page, stops at the ceiling with `reachedCeiling: true`, de-duplicates ids, orders `created_at DESC` then `id DESC`; `countInWindow` uses `{ count: 'exact', head: true }` and returns `count ?? 0`; a Supabase error → `{ data: null, error }`, never throws; **every `select` string** (from `TOKEN_USAGE_COLUMNS` and from recorded calls) excludes `request_payload`, `response_metadata`, `metadata`, `error_message` and `*`. Types: `// @ts-expect-error` for a call with no account argument (checked by `tsc`; the file isn't in gate scope, so SA may ask for this case to move into a scoped test, Q-11) | AC-24 |
| `BusinessProfileRepository.searchForAdmin.test.ts` | Selects exactly `user_id, company_name`; no `.or(` call; `escapeIlikePattern('50%_off\\x')` → `50\%\_off\\\\x`; `ilike('company_name', '%…%')` only when search is set; limit clamped to ≤ 50; order by `company_name`; an error → `{ data: null, error }` | AC-15 |
| `usageSummary.test.ts` | `summaryFromRpcRows`: BIGINT strings coerced; day rows don't add to totals; feature rows total. `readUsageSummary`: RPC ok → `summedBy: 'database'`, fallback not called; RPC error → warn + fallback pages (2 pages then a short page) → `'rows'`; a fallback page error throws; feature null → `'unknown'`. `parseTokensPerCredit`: `'25'` → 25, `'0'` / `'-3'` / `'abc'` / `null` / `''` → 10. `readTokensPerCredit`: repository error → 10; thrown → 10. `toCredits` rounding; `buildCardBreakdown` filters zero tokens, sorts by credits, `share` to 4 dp | AC-23 |
| `app/api/business-os/usage/__tests__/route.test.ts` | Characterization (T1): exact response string for DB path, fallback path, tokens-per-credit cases, allowance null/positive; 401; 400 bad range; `summedBy` present in the info log. **Run on the original route first, then unedited after T13** | AC-23 |

### 5.2 Unit tests: check logic

**File:** `lib/business-os/usage/__tests__/llmUsageVerification.test.ts` (pure functions, fixtures built from catalog constants, no database)

| Group | Cases | AC |
|---|---|---|
| Schema / window | Non-UUID → "Account id must be a UUID"; all-zero and `SYSTEM_ADMIN_USER_ID` (env set, upper-case input) → platform message; malformed `since`; `since = receivedAt + 61 s` → future; `+59 s` → accepted and clamped (`startClamped: true`, start = end); `receivedAt − 7 d − 61 s` → too old; `− 7 d − 59 s` → accepted; `trigger` default `manual`, `bogus` rejected; search 101 chars → rejected, 100 accepted, whitespace-only → undefined | AC-3 |
| Classification | Current + catalog name + session → no flags; legacy value → `legacy_feature`, area resolved; `business-os-webiste` → `unknown_area`; current area + wrong call name → `unknown_call_name`; null session → `missing_group_id`; `BizQLPlanCache` with session → none; `BizQLPlanCache` null session → `missing_group_id` only; `IntentParser` null session → none, `knownComponent` set; `IntentParser` under `business-os-website` → flagged; `errorCode` only when `success === false`; tokens = input + output; cost string coerced. **Derived coverage:** every `(area, callName)` in `BOS_LLM_CALLS` with a session → no flags | AC-4, AC-6 |
| Check 1 | Pass / Fail / Info; 700 clean rows with one flagged row at index 650 → **Fail**, `rowsTruncated`, displayed 500 newest first; `incomplete` with no flags → Incomplete; `incomplete` with a flag → Fail | AC-6, AC-12(a)(b) |
| Check 2 | Count 0 → Pass; 3 → Fail; breakdown sums to the count when not truncated; rows read < count → `breakdownTruncated`; count error → Fail with error; breakdown error → Fail | AC-7, AC-12(d) |
| Check 3 | Legacy on selected → Fail; legacy on platform count > 0 → Fail; helper label on selected > 0 → Fail; helper label on platform only → Pass with (c) count and ≤ 50 timestamps, `timestampsTruncated` when count > 50; R1 incomplete and nothing failing → Incomplete; any sub-read error → Fail | AC-8, AC-12 |
| Check 4 | Groups by session id; area or `mixed`; `planner, analysis, planner` → `planner ×2, analysis`; tokens and cost totals; first/last; groups newest first; 600 groups → 500 displayed + `groupsTruncated`; flagged ungrouped row beyond the display cap → Fail; ungrouped `IntentParser` → expected, Pass; ungrouped `BizQLPlanCache` → Fail; incomplete → Incomplete; no rows → Info | AC-9, AC-12(a)(b) |
| Check 5 | Categories equal `summariseUsageByCategory` output for the same map; an injected `business-os-unmapped` → Fail and listed in `otherFeatures` with `isBusinessOs`; a non-Business OS value in `other` → still Pass; all mapped → Pass; zero calls → Info; `shownOnCard` false for a zero-token category; credits equal `toCredits`; R8 error → Fail | AC-10, AC-12(c) |
| Area totals | Lines for every area (zeros included), `legacy`, `unknown` only when present; lines sum to total calls, tokens and cost; incomplete → `incomplete` | AC-11, AC-12(b) |

### 5.3 Integration tests: orchestrator and routes

| Test file | Cases | AC |
|---|---|---|
| `llmUsageReport.test.ts` | Injected mocks. **Scoping:** R1 receives `accountId` only; R2/R3/R4/R6/R7 receive exactly `platformAccountIds()`; R5 receives `[accountId]`; every windowed read gets the **same** `end` Date instance value; R8 gets `accountId` and `start`. **One read rejects** (each of R1…R8 in turn) → only the dependent checks Fail with the safe message; others return normally; nothing zeroed. **Profile lookup failure** → `profileLookup: 'failed'`, report still returned. `platformAccountIdsChecked` equals the queried list | AC-12(d), AC-13 |
| `app/api/admin/business-os/llm-usage/__tests__/route.test.ts` | Mocks: `@/lib/auth`, `AdminAccessService`, `@/lib/repositories/TokenUsageRepository`, `@/lib/repositories/BusinessProfileRepository`, `usageSummary` reads, `@/lib/logger` (capturing child logger), `@/lib/services/AuditTrailService` (spy), `@/lib/ai/providerFactory` (spy). Cases: **401** no session, no repository call. **403** non-admin + warn log with userId. **403** for a `profiles.role = 'admin'` user not in `admin_users` (`isAdmin` → false; route never reads profiles for authz). **403** when `isAdmin` rejects (AC-2), not 500. **403 not 400** for a non-admin with invalid params. **400** for each AC-3 case with no repository call; platform message text. **200** admin happy path: all five checks, area totals, `platformAccountIdsChecked`; clamp +59 s → 200. **Logs:** `trigger=manual` → `info`, `trigger=auto` → `debug`; fields present; the fixture company name appears in **no** log argument. **AC-14:** no insert/update/delete/upsert method exists on the mocks and none is called; AuditTrailService and provider factory spies never called; `JSON.stringify(body)` contains none of `request_payload`, `response_metadata`, `"metadata"`, `error_message`, `email`, `prompt` | AC-1, AC-2, AC-3, AC-13, AC-14, AC-19 (server) |
| `.../businesses/__tests__/route.test.ts` | 401; 403 non-admin (warn); 403 when admin check throws; 403 not 400 for a non-admin with a 101-char search; 400 search > 100 with no repository call; 200 returns ≤ 50 entries `{ userId, companyName }` + `platformAccountIds` (Q-3); `searchForAdmin` called with the trimmed search; response contains no `email`; log has `searchLength`, not the text; repository error → 500 generic | AC-1, AC-2, AC-3, AC-15 |

### 5.4 Component and hook tests (jsdom)

The repo has a pattern for these (M-8): `@jest-environment jsdom` + `@testing-library/react`, with `fetch` mocked.

| Test file | Cases | AC |
|---|---|---|
| `refreshMachine.test.ts` | Every transition in §3.10: stale response ignored; manual resumes `paused_hidden` and `stopped_input_change`; tick while hidden → `paused_hidden` with no request; tick while in flight → no request; selection change clears report and stops auto; any failure → auto `off`; 403 → forbidden; visible doesn't resume | AC-18 |
| `hooks/useLlmUsageAutoRefresh.test.tsx` | Fake timers. Auto off by default (no fetch after 60 s). Enable at 10 s → first request after 10 s with `trigger=auto`. A slow request (resolves at 25 s) → no second request until 10 s after it resolves (no overlap). Manual → `trigger=manual`. `visibilityState = 'hidden'` + tick → no fetch. Fetch 500 → auto off, `onLog('error')`. Successful auto → **no** `onLog` call; manual → `onLog` info + success. Unmount → timer cleared, `AbortController.abort` called | AC-18, AC-19 (debug log) |
| `LlmUsageVerification.test.tsx` | Not signed in → sign-in text, no fetch. Businesses 403 → "Admins only", no controls, no data. Admin: search types → debounced list call with `search`; select result; "My account" selects the session id; pasted invalid id → inline error; pasted valid id selected; session id in `platformAccountIds` → platform warning. The test-page exception note is present. Initial statuses all "Not checked". Report fixture → each check shows its text label (Pass / Fail / Incomplete / Info); platform ids shown; `rowsTruncated` / `groupsTruncated` / `breakdownTruncated` / `timestampsTruncated` fixtures → warning text per list; `incomplete` → "narrow the start time" on Checks 1, 3, 4 and area totals; Check 5 window caveat and open-end text present; "Start now" sets the start to the mocked `Date.now()` | AC-17, AC-18, AC-19, AC-20 |
| `boundaries.static.test.ts` | Reads source text. (1) Every file under `components/test-business-os/llm-usage/` and `hooks/useLlmUsageAutoRefresh.ts`: any import from `@/lib/business-os/llm`, `@/lib/business-os/usage` or `@/lib/repositories` is `import type`. (2) The new routes, `usageSummary.ts`, `llmUsageReport.ts`, `llmUsageVerification.ts`, the usage route and the components contain no `supabaseServer.from(`, `.rpc(` or `createClient(`. (3) The same new non-test files contain no `'business-os-` / `"business-os-` literal and no `BizQLPlanCache`, `IntentParser` or `simple-complete` literal outside comments. (4) `TokenUsageRepository.ts` has no import containing `business-os` | AC-4, AC-16 |

AC-16's last item (the `--list` delta recorded, baseline unchanged) is verified by T38 and recorded in §11.

### 5.5 Regression runs

| Run | Expect |
|---|---|
| `npx jest lib/business-os lib/repositories lib/ai app/api/business-os app/api/admin components/test-business-os hooks/useLlmUsageAutoRefresh.test.tsx` | All green; counts recorded in §11 against the T0 baseline |
| Layer 1 suites unedited: `usageCategories.test.ts`, `llm-attribution.test.ts`, `usage-report.test.ts`, `chat-budget.test.ts`, `callCatalog.test.ts` (existing cases) | Green |
| `npm run typecheck:bos-llm -- --list` | Delta as in §4.2; no pre-existing file added |
| `npm run typecheck:bos-llm` | 0 new; baseline blob unchanged (`git hash-object`) |
| `npx eslint` on new and modified files | No new errors |
| `grep -n "console\." <new and modified code files>` | 0 |

### 5.6 QA manual steps for AC-21 (non-production environment only)

**Preconditions:**
- A non-production environment. The insight run spends LLM tokens for **every** active business (RC-13, `insight-detect/route.ts:164-205`), so confirm the target Supabase project is non-production first (Q-14).
- Two accounts:
  - **ADMIN**, present in `admin_users`;
  - **TEST**, a test business with a profile, CRM contacts, a published website with a bookable service, and not a platform account.
- `SYSTEM_ADMIN_USER_ID` known.
- A dev server with this branch.

| Step | Actor | Action | Expected |
|---|---|---|---|
| 1 | Non-admin | Open `/test-business-os` → **LLM Usage** | "Admins only"; no data; Debug Logs shows the 403 |
| 2 | ADMIN | Open **LLM Usage**; search TEST's company name; select it | The list shows name + short id; statuses "Not checked" |
| 3 | ADMIN | Click **Start now**; note the start time; turn on auto-refresh at 30 s | Auto status "running"; no Debug Logs line per successful auto refresh |
| 4 | TEST (other browser) | Run Layer 1 §6.4 steps: chat question twice (miss, then hit); daily briefing; full website generation; landing page; testimonial enhance; intake form generation + question inference; submit a public enquiry (lead); insight run (`/api/cron/insight-detect` with `CRON_SECRET`) | — |
| 5 | ADMIN | Watch auto refreshes, then click **Refresh** | Check 1 lists the calls with correct areas and call names, no flags (a `BizQLPlanCache` row appears for the hit); Check 2 **Pass**; Check 3 **Pass** with (c) Info, count and timestamps matching any onboarding sessions; Check 4 one group per action (chat turn, website generation, landing page, testimonial, intake form, question, lead, insight run); Check 5 **Pass**; area totals equal Check 1 |
| 6 | ADMIN | Hide the browser tab for more than 30 s, then return | No requests while hidden (server logs); auto status "paused"; resumes after the next manual Refresh |
| 7 | ADMIN | Change the start time | The report clears to "Not checked"; auto stops until the next manual Refresh |
| 8 | ADMIN | Select "My account" with ADMIN = `SYSTEM_ADMIN_USER_ID` (if applicable), or paste the all-zero UUID | Warning in the tab; Refresh → 400 platform message |
| 9 | ADMIN | Copy the window **start and end** shown in the status summary; run Layer 1 §6.4 AC-18 and AC-19 SQL with `created_at >= :start and created_at <= :end` | Row counts, components, session ids and platform-account rows match Checks 1, 2 and 4 exactly (Check 5 uses an open end, M-1) |
| 10 | ADMIN | Server log (`npm run dev:pretty`) | Manual report lines at `info`, auto lines at `debug`; the admin id, account id, window and statuses present; **no company name** |

Known caveats that are not failures of this tab: KI-2 (plan-cache store embedding absent) and KI-6 (intake falls back). If `bizchat_plan_semantic_cache_enabled` is off, no embedding rows appear (Layer 1 §14.6).

---

## 6. Risks, Rollout and Follow-ups

### 6.1 Risks

| # | Risk | Likelihood / impact | Mitigation |
|---|---|---|---|
| R-1 | Check 5 can't use the fixed end (M-1) | Certain / Low | Open end marked in the response and the tab; Pass/Fail rule is mapping-only; Q-1 |
| R-2 | Refactor changes the owner card's output | Low / High | T1 characterization test before and after; `buildCardBreakdown` moved verbatim; `ConfigRepository` equivalence cases (M-2) |
| R-3 | Typecheck scope pulls in pre-existing files (barrel) | Low / Medium | Repository imports nothing from `lib/business-os/**`; `--list` diff at T38 with a stop-and-escalate rule |
| R-4 | Offset paging duplicates or skips a row during concurrent writes | Low / Low | Fixed end; de-dupe on `id`; the AC-21 comparison uses the same start/end |
| R-5 | App server clock vs DB `now()` skew moves rows across the window end | Low / Low | The same end is shown in the tab and used by the QA SQL; documented |
| R-6 | 5,000-row read latency above the 1.5 s target | Low / Low | Narrow columns; measured busiest account 1,991 rows over 30 days all features; Incomplete status beyond the ceiling |
| R-7 | Response size at 500 rows + 500 groups on 10 s auto | Low / Low | ~200 KB worst case; Last API Response is updated on manual refresh only |
| R-8 | Name search `*` acts as a wildcard (M-4) | Certain / Negligible | Admin-only, capped at 50; documented |
| R-9 | Leaving the tab loses controls state | Certain / Low | Accepted for an internal harness; documented in the scope doc |
| R-10 | `SYSTEM_ADMIN_USER_ID` differs between the writing and reporting environments | Medium / Medium | Checked platform ids shown (FR-11) |
| R-11 | Admin gate bypass via a future refactor | Low / High | Route tests pin 401 → 403 → 400 ordering, and no repository call before the gate |
| R-12 | Case-insensitive `isPlatformAccount` changes builder logging | Low / Negligible | Only adds an error log for an upper-case variant of a platform id; covered by the existing builder tests plus a new case |

### 6.2 Rollout

- **No migration, no new env var, no feature flag.** Both routes are admin-only through `AdminAccessService`. The tab is on the internal test page.
- `business_os_usage_summary` already exists on `main` environments. If it's missing, Check 5 uses the row fallback, the same as the card.
- CI: `bos-llm-typecheck.yml` (the gate) and Jest run on the PR. The baseline stays unchanged.
- Production data is never written. Running AC-21 in production is forbidden (§5.6).
- Deploying is safe: the owner usage card's output is proven unchanged by T1.

### 6.3 Follow-ups (out of scope, tracked in the requirement)

| # | Item |
|---|---|
| F-1 | Move `usageReport.ts` onto `TokenUsageRepository`; fix its unflagged 10,000 cap and the zeroed report on error; explicit all-accounts filter |
| F-2 | DB function for per-area cost totals, only if the 5,000 ceiling is hit in practice or an all-businesses view is requested (D-4). A `p_until` parameter on `business_os_usage_summary` would also close M-1 |
| F-3 | `DATA_ACCESSED` audit event per (admin, account, window) when usage viewing moves to a real admin UI |
| F-4 | Update `.claude/skills/new-api-route/SKILL.md:118` to `AdminAccessService` |

Also noted, not tracked by this cycle: the `docs/BUSINESS_OS_TEST_PAGE_SCOPE.md` staleness outside 1.1 (M-12), and `aiAnalytics.ts` `console.*` (untouched).

---

## 7. Questions and Decisions for SA

| # | Question | Dev proposal |
|---|---|---|
| **Q-1** | `business_os_usage_summary` has no end bound (M-1). How should Check 5 treat the window end? | Accept an open end for Check 5 only (`windowEnd: 'open'`, stated in the tab). BA amends FR-9 and AC-13 ("…except Check 5, which uses the card's function and has no end bound"). No migration (F-2 could add `p_until` later) |
| **Q-2** | `platformAccountIds()` with a non-UUID or upper-case `SYSTEM_ADMIN_USER_ID` (M-5) | Include the env id only if it is a UUID; lower-case and de-duplicate; make `isPlatformAccount` case-insensitive; lower-case the route's account id |
| **Q-3** | How does the tab know to warn for "My account" (FR-8, M-6)? | Add top-level `platformAccountIds` (ids only) to the business-list response |
| **Q-4** | The PostgREST `*` wildcard in the name search can't be escaped (M-4) | Accept and document |
| **Q-5** | (a) Where does the selected business's name come from (M-7)? (b) Check 5 status with zero calls | (a) Reuse `findByUserId`, return `company_name` only, and don't fail the report if the lookup fails. (b) Info (Definitions: "Info … no data"), not Pass |
| **Q-6** | Check 3: does a read error in the Info-only part (c) fail the check? | Yes: any Check 3 read error → Fail (FR-18 "never zero or Pass") |
| **Q-7** | Exemption scope and legacy/unknown call names | Exemptions apply only when the known component appears in its declared area (chat). Legacy and unknown-area rows aren't additionally judged for `unknown_call_name` (they are already flagged) |
| **Q-8** | Exactly 5,000 rows read | Incomplete (literal FR-18; never a false green). The alternative is a one-row probe at offset 5,000 |
| **Q-9** | Repository row types in `types.ts` (skill Step 2) vs the repository file | Repository file + `export type` from `index.ts`: `types.ts` already has an unrelated `TokenUsage` (M-9) |
| **Q-10** | Shared admin-gate helper for the two routes? | No: inline in each route, as in `chat-usage` (a shared `requireAdmin` would be a new pattern; possible later with F-4) |
| **Q-11** | Compile-time "account parameter required" proof (AC-24) | A `@ts-expect-error` case in a file the gate checks. Because `TokenUsageRepository.test.ts` is out of gate scope, put that single type case in `lib/business-os/usage/__tests__/usageSummary.test.ts` (core), calling the repository without an account |
| **Q-12** | Scope doc staleness outside 1.1 (Danger Zone undocumented, "only tab" text, M-12) | Out of scope; only the new section, ToC and Change History. TL to decide whether to route a docs fix |
| **Q-13** | Auto-refresh after a failed request | Turn the toggle off; the admin re-enables it. Hidden and input-change pauses resume on the next manual Refresh (FR-10) |
| **Q-14** (for user, via TL) | AC-21 needs a non-production environment. Layer 1 QA used the current Supabase project, described then as "future staging; no real customers". Is that still acceptable as non-production for AC-21? | User or TL confirmation before QA |

---

## 8. Traceability Matrix

### 8.1 FR → tasks → tests

| FR | Tasks | Tests |
|---|---|---|
| FR-1 Admin report API, gate order | T28 | admin `llm-usage` route test |
| FR-2 Business list API, `searchForAdmin` | T15, T26 | `searchForAdmin` test; businesses route test |
| FR-3 Input validation, platform rejection, skew, trigger | T2, T18, T26, T28 | `llmUsageVerification` schema/window; both route tests |
| FR-4 Feature values defined once | T3, T6 | `callCatalog.test`; `usageCategories.test` (unchanged); `usageCategories.catalog.test`; boundaries static |
| FR-5 Platform account defined once | T2 | `callCatalog.test`; orchestrator scoping |
| FR-6 Catalog as call-name reference, exemptions, helper label | T4, T7, T8, T19 | `callCatalog.test`; `providerFactory.complete.test`; classification cases |
| FR-7 New tab, client boundary | T17, T32, T35 | component test; boundaries static |
| FR-8 Business selector | T26, T32 | component test; businesses route test |
| FR-9 Start time and window | T18, T30, T32 | schema/window; component test ("Start now") |
| FR-10 Refresh and auto-refresh | T30, T31, T32 | `refreshMachine.test`; hook test |
| FR-11 Status summary, platform ids, Debug Logs | T24, T31, T32 | orchestrator; hook test (logs); component test |
| FR-12 Check 1 | T9, T19, T24 | repository paging; Check 1 cases |
| FR-13 Check 2 | T9, T20, T24 | repository counts; Check 2 cases |
| FR-14 Check 3 | T9, T20, T24 | Check 3 cases |
| FR-15 Check 4 | T21 | Check 4 cases |
| FR-16 Check 5 | T12, T22, T24 | `usageSummary.test`; Check 5 cases |
| FR-17 Area totals | T19 | area totals cases |
| FR-18 Exact checks, caps, no silent failures | T9, T19–T24 | AC-12 cases; orchestrator failure injection |
| FR-19 Read-only, no audit | T24, T28 | admin route AC-14 case |
| FR-20 Minimal data | T9, T19, T28 | repository select test; route forbidden-keys case |
| FR-21 Scope doc | T36 | doc review (AC-22) |
| FR-22 Roadmap verify and finish | T37 | doc review (AC-22) |
| FR-23 Usage summary extracted | T1, T12, T13, T14 | usage route characterization; `usageSummary.test` |
| FR-24 `TokenUsageRepository` | T9, T10, T11 | `TokenUsageRepository.test`; boundaries static; T38 `--list` |

### 8.2 AC → tasks → tests

| AC | Tasks | Test(s) / verification |
|---|---|---|
| AC-1 | T26–T29 | both route tests (401, 403 + warn, `profiles.role` case, 403-not-400, 200) |
| AC-2 | T26–T29 | both route tests (`isAdmin` rejects → 403) |
| AC-3 | T18, T26–T29 | schema/window unit cases; route 400 cases with no repository call; clamp → 200 |
| AC-4 | T3, T6, T19, T34 | `callCatalog.test`; `usageCategories.test` unchanged; `usageCategories.catalog.test`; derived classification; boundaries static (literals) |
| AC-5 | T2, T8 | `callCatalog.test` (agreement, env set/unset); `providerFactory.complete.test` |
| AC-6 | T19, T23 | classification + Check 1 cases |
| AC-7 | T20, T23, T25 | Check 2 cases; orchestrator `platformAccountIdsChecked` |
| AC-8 | T20, T23 | Check 3 cases |
| AC-9 | T21, T23 | Check 4 cases |
| AC-10 | T6, T22, T23 | Check 5 cases; `usageCategories.catalog.test` |
| AC-11 | T19, T23 | area totals cases |
| AC-12 | T9, T19–T25 | Check 1/4 beyond-cap; ceiling → Incomplete; exact counts unaffected; orchestrator one-read failure |
| AC-13 | T24, T25, T29 | orchestrator scoping (same end; Check 5 carve-out per Q-1); admin route happy path; QA step 9 |
| AC-14 | T24, T28, T29 | admin route test (no writes, no audit, no provider, forbidden keys) |
| AC-15 | T15, T16, T26, T27 | `searchForAdmin` test; businesses route test; code review of the bypass comment |
| AC-16 | T9, T34, T38 | boundaries static; `--list` delta + baseline hash in §11 |
| AC-17 | T32, T33, T35 | component test; QA steps 1–2, 8 |
| AC-18 | T30, T31, T33 | `refreshMachine.test`; hook test; component test ("Start now"); QA steps 3, 6, 7 |
| AC-19 | T28, T29, T31, T33 | component statuses; hook log rules; admin route log-level and no-name cases; QA step 10 |
| AC-20 | T32, T33 | component truncation and incomplete fixtures |
| AC-21 | T39 (Dev smoke), QA | §5.6 (non-production only, Q-14) |
| AC-22 | T36, T37 | doc diff review |
| AC-23 | T1, T12–T14 | usage route characterization before/after; `usageSummary.test` |
| AC-24 | T9, T10 | `TokenUsageRepository.test` (+ type case per Q-11) |

---

## 9. Implementation Sequence

Each step ends with a runnable, green state and can be reviewed on its own.

| Step | Tasks | Deliverable | Verify before moving on |
|---|---|---|---|
| S0 Pre-flight | T0 | Branch confirmed; baselines recorded | `git branch --show-current`; `--list` = 96; gate 0 new (done 2026-09-17); Jest baseline counts for §5.5 paths |
| S1 Characterize the card | T1 | Route characterization test on the **unchanged** route | Test green on original code |
| S2 Catalog constants | T2–T8 | Constants, `usageCategories` + `turnUsage` switched, tests | `usageCategories.test` unedited green; catalog + provider tests green; gate 0 new |
| S3 Repository | T9–T11 | `TokenUsageRepository` + tests + barrel | Repository test green; `--list` shows the repository and barrel **not** in scope |
| S4 Extract usage summary | T12–T14 | `usageSummary.ts`; route switched | **T1 test unedited green**; `usageSummary.test` green; gate 0 new |
| S5 Profile search | T15–T16 | `searchForAdmin` + escape + tests | Test green |
| S6 Pure checks | T17–T23 | Types, schema/window, classification, Checks 1–5, area totals | Verification tests green; gate 0 new |
| S7 Orchestrator | T24–T25 | `llmUsageReport.ts` + tests | Tests green |
| S8 Business list route | T26–T27 | Route + tests | Route tests green |
| S9 Report route | T28–T29 | Route + tests | Route tests green; gate 0 new |
| S10 Refresh logic | T30–T31 | Reducer + hook + tests | Tests green |
| S11 UI | T32–T34 | Components + component tests + static boundary test | Tests green; gate 0 new |
| S12 Page wiring | T35 | Tab visible | Dev server: tab renders |
| S13 Docs | T36–T37 | Scope doc section; FR-22 fill | Doc review |
| S14 Verification | T38–T40 | Full §5.5 runs; `--list` delta and baseline hash recorded; local smoke; workplan → Code Complete | All green; §11 filled |

---

## 10. Task Checklist

**S0: Pre-flight**
- [x] T0: ✅ Confirm branch `feature/business-os-llm-usage-layer1-1` @ `56fb7dbd`. Record `--list` (96 ✔ measured), the gate (30 errors, 0 new ✔ measured), the baseline blob `8cff995b…` ✔, and Jest counts for the §5.5 paths.

**S1: Usage card characterization**
- [x] T1: ✅ `app/api/business-os/usage/__tests__/route.test.ts` against the current route (DB path, fallback, BIGINT, tokens-per-credit cases, allowance, 401, 400, `summedBy`); green before any refactor.

**S2: Catalog constants**
- [x] T2: ✅ Export `isPlatformAccount` (case-insensitive); add `platformAccountIds()`.
- [x] T3: ✅ `BOS_LEGACY_FEATURES`, `BOS_LEGACY_FEATURES_FLAT`, `BOS_FEATURE_FILTER_PREFIX`, `bosRowFilter()`, `isBusinessOsFeature()`.
- [x] T4: ✅ `BOS_KNOWN_NON_CATALOG_COMPONENTS`, `BosRowFlagExemption`, `BOS_LEGACY_HELPER_LABEL`.
- [x] T5: ✅ Extend `callCatalog.test.ts` (§5.1).
- [x] T6: ✅ `usageCategories.ts` builds Business OS categories from the constants; new `usageCategories.catalog.test.ts`; the existing test runs unedited.
- [x] T7: ✅ `turnUsage.ts` uses `BOS_KNOWN_NON_CATALOG_COMPONENTS.BizQLPlanCache.component`; existing bizql tests green.
- [x] T8: ✅ `providerFactory.complete.test.ts` asserts the default equals `BOS_LEGACY_HELPER_LABEL`.

**S3: Repository**
- [x] T9: ✅ `lib/repositories/TokenUsageRepository.ts` (§3.5), with the documented-bypass header comment and no `lib/business-os` import.
- [x] T10: ✅ `lib/repositories/__tests__/TokenUsageRepository.test.ts` (§5.1).
- [x] T11: ✅ Export class, singleton and types from `lib/repositories/index.ts`; confirm with `--list` that neither file is in scope.

**S4: Usage summary extraction**
- [x] T12: ✅ `lib/business-os/usage/usageSummary.ts` (§3.9); `ConfigRepository(supabaseServer)`.
- [x] T13: ✅ `app/api/business-os/usage/route.ts` calls the module; `readAllowanceCredits` stays; T1 test green **unedited**.
- [x] T14: ✅ `lib/business-os/usage/__tests__/usageSummary.test.ts` (§5.1, + Q-11 type case).

**S5: Business profile search**
- [x] T15: ✅ `BusinessProfileRepository.searchForAdmin` + `escapeIlikePattern`, with the bypass comment.
- [x] T16: ✅ `BusinessProfileRepository.searchForAdmin.test.ts`.

**S6: Pure check logic**
- [x] T17: ✅ `lib/business-os/usage/llmUsageReportTypes.ts` (types only).
- [x] T18: ✅ `LLM_USAGE_LIMITS`, `buildReportQuerySchema`, `BusinessListQuerySchema`, `resolveReportWindow`.
- [x] T19: ✅ `classifyCallRow`, `evaluateCallsCheck`, `computeAreaTotals`.
- [x] T20: ✅ `evaluatePlatformAccountCheck`, `evaluateLegacyLabelsCheck`.
- [x] T21: ✅ `evaluateGroupsCheck`.
- [x] T22: ✅ `evaluateUsageCardCheck`.
- [x] T23: ✅ `lib/business-os/usage/__tests__/llmUsageVerification.test.ts` (§5.2).

**S7: Orchestrator**
- [x] T24: ✅ `lib/business-os/usage/llmUsageReport.ts` (§3.8; `Promise.allSettled`, safe errors, one `platformAccountIds()` read).
- [x] T25: ✅ `lib/business-os/usage/__tests__/llmUsageReport.test.ts` (§5.3).

**S8: Business list route**
- [x] T26: ✅ `app/api/admin/business-os/llm-usage/businesses/route.ts` (§3.7).
- [x] T27: ✅ Its route test (§5.3).

**S9: Report route**
- [x] T28: ✅ `app/api/admin/business-os/llm-usage/route.ts` (§3.7; log level by trigger; no names in logs).
- [x] T29: ✅ Its route test (§5.3).

**S10: Refresh logic**
- [x] T30: ✅ `hooks/llmUsageRefreshMachine.ts` + `hooks/llmUsageRefreshMachine.test.ts` (moved to `hooks/`, §11.4 D1).
- [x] T31: ✅ `hooks/useLlmUsageAutoRefresh.ts` + `hooks/useLlmUsageAutoRefresh.test.tsx`.

**S11: UI**
- [x] T32: ✅ `LlmUsageVerification.tsx`, `BusinessPicker.tsx`, `WindowControls.tsx`, `StatusSummary.tsx`, `StatusBadge.tsx`, `CheckPanels.tsx`, `formatters.ts` (type-only server imports).
- [x] T33: ✅ `__tests__/LlmUsageVerification.test.tsx` (§5.4).
- [x] T34: ✅ `__tests__/boundaries.static.test.ts` (§5.4).

**S12: Page**
- [x] T35: ✅ `app/test-business-os/page.tsx`: `TABS` entry + tab block.

**S13: Docs**
- [x] T36: ✅ `docs/BUSINESS_OS_TEST_PAGE_SCOPE.md`: **Tab: LLM Usage** (Purpose / Features / API Endpoints Used / Use Cases). It covers admin-only access, the business-selection exception, the checks and statuses including Incomplete, caps and the 5,000 ceiling, the Check 5 window caveat and open end, and the non-production "verify a test session" use case. Plus the ToC entry, a Change History row and Last Updated.
- [x] T37: ✅ FR-22: add D-4 (one business at a time; all-businesses view would need F-2) to the Layer 1 requirement roadmap row 1.1 + a Change History row; confirm the investigation doc needs no change (M-11).

**S14: Verification and handover**
- [x] T38: ✅ §5.5 runs. Record in §11: Jest counts; `--list` before/after file lists and delta; gate result; baseline blob unchanged; eslint; `console.` grep = 0.
- [ ] T39: **Not run — moved to QA (§11.4 D12).** Local dev smoke (non-production): non-admin → "Admins only"; admin → select business, Refresh, auto-refresh on/off, hidden-tab pause; the owner usage card still renders the same numbers for the same account.
- [x] T40: ✅ Update this workplan: tasks ✅, §11 notes, Status → Code Complete; notify TL for SA code review.

---

## 11. Implementation Notes

**Dev — 2026-09-17.** All WC-1 to WC-10 were applied. WC-1 and WC-2 were in place before S1 and S4, and WC-4 before S9. Nothing is committed.

### 11.1 Verification results

| Item | Before (S0, `56fb7dbd`) | After (S14) |
|---|---|---|
| Jest, touched areas (`lib/business-os lib/repositories lib/ai app/api/business-os app/api/admin components/test-business-os hooks`) | 97 suites; 1,493 passed; 28 skipped | **111 suites; 1,761 passed; 28 skipped; 0 failed**; 2 snapshots passed |
| `npm run typecheck:bos-llm` | 96 files; 30 errors; 0 new | **119 files; 30 errors; 0 new; passed** (run after S2, S3, S4, S7, S9 and S12) |
| Baseline JSON blob | `8cff995bebebae238587d7a03886c7851a0e2146` | **unchanged** (`git hash-object` after every gate run) |
| Full `tsc --noEmit -p .` | 2,045 errors | **2,045 errors** (run after S3, S9 and S12). Per-file counts are identical; the only textual difference is the known union-order noise. There are no errors in any new or touched file |
| ESLint (flat config `eslint.config.mjs`) on every new and modified code file | — | 0 problems |
| `console.` in new and modified code files | — | 0 |

**Proof for the WC-3 gate:**
- I temporarily changed `countInWindow` so that a call without the account list type-checks.
- The gate then reported `31 errors, 1 new`: TS2578 `Unused '@ts-expect-error' directive` at `tokenUsageRepository.contract.test.ts(40,3)`, exit 1.
- I restored the file from a backup copy (`cmp` identical).

**Before/after proof for the usage card (AC-23):**
- `app/api/business-os/usage/__tests__/route.test.ts` was written and passed against the **unchanged** route (S1). Its snapshot file was written then.
- After T13 both files are byte-identical and the test passes with `--ci`:
  - test blob: `3f5e96f76d3ef2c589220e5d74a0a98a36d0eec0`;
  - snapshot blob: `96821cf7d58cae9c31717981849127d98fe0e7a4`.
- Snapshots pin the exact response string for the database path and the fallback path (2,050 rows, 3 pages, one row from another account and one from before the window, both excluded).
- Explicit cases cover:
  - tokens per credit: `'25'`, `25`, `'0'`, `''`, `null`, `'abc'`, `'-3'`, no row, two rows, and a thrown client error;
  - allowance, default range, 401 and 400;
  - the `summedBy` log field.

### 11.2 `typecheck:bos-llm` scope delta (AC-16)

The scope grows from 96 to 119 files, **+23, all of them new files**. No existing file joined. `lib/repositories/index.ts`, `TokenUsageRepository.ts`, `BusinessProfileRepository.ts` and the 19 barrel importers are **not** in scope.

| Layer | Added files |
|---|---|
| core (9) | `lib/business-os/usage/usageSummary.ts`, `llmUsageVerification.ts`, `llmUsageReport.ts`, `llmUsageReportTypes.ts`; tests `usageSummary.test.ts`, `llmUsageVerification.test.ts`, `llmUsageReport.test.ts`, `tokenUsageRepository.contract.test.ts`, `usageCategories.catalog.test.ts` |
| catalog-importer (1) | `app/api/admin/business-os/llm-usage/businesses/route.ts` |
| caller (13) | `app/api/admin/business-os/llm-usage/route.ts` and both route tests; `components/test-business-os/llm-usage/BusinessPicker.tsx`, `CheckPanels.tsx`, `LlmUsageVerification.tsx`, `StatusSummary.tsx`, `formatters.ts`, `__tests__/LlmUsageVerification.test.tsx`; `hooks/llmUsageRefreshMachine.ts` (+ test), `hooks/useLlmUsageAutoRefresh.ts` (+ test) |

`StatusBadge.tsx`, `WindowControls.tsx`, the static boundary test and `tests/helpers/fakePostgrest.ts` import nothing in scope, so they are not listed.

### 11.3 WC-10: `token_usage` columns and the `id` type

**The live read-only check couldn't be run from this session:**
- this worktree has no `.env.local`;
- I did not take credentials from the main checkout;
- a read-only `select … limit 1` probe was refused by the session's permission policy.

**Verified from the code instead:**
- The tracker's insert (`lib/analytics/aiAnalytics.ts:141-185`) writes `cost_usd`, `success` and `error_code`. Inserts with those keys would fail on every LLM call if the columns were missing.
- `total_tokens` is read by the migrated `business_os_usage_summary` function (`20260929_usage_summary.sql:64`, `:79`) and by the card's fallback.
- For `id`: `docs/PRICING_SYSTEM_IMPLEMENTATION_PLAN.md:340` references `token_usage(id)` as `UUID`, and `lib/repositories/types.ts:231` types it as `string`.

**Decision:** `LedgerCallRow.id` is typed `string`. De-duplication uses `String(row.id)`, and the tiebreak `order('id', desc)` only needs a stable order, so a bigint `id` would also work unchanged.

**QA to confirm during AC-21:** run `select id, error_code, cost_usd, success, total_tokens from token_usage limit 1` read-only.

### 11.4 Deviations from the workplan (with reasons)

| # | Planned | Done | Why |
|---|---|---|---|
| D1 | `components/test-business-os/llm-usage/refreshMachine.ts` (+ test under `__tests__`) | `hooks/llmUsageRefreshMachine.ts` + `hooks/llmUsageRefreshMachine.test.ts` | SA optimisation note: keeps `hooks/` from importing `components/`. The hook test is co-located (`hooks/useLlmUsageAutoRefresh.test.tsx`), as in `hooks/useSideConsole.test.tsx` |
| D2 | — | New test helper `tests/helpers/fakePostgrest.ts` | WC-1 needs real PostgREST semantics (`.single()`/`.maybeSingle()` for 0/1/many rows, filters, order, range, `or`, `ilike` escapes, head counts). It is shared by the characterization, repository, `searchForAdmin` and contract tests. It lives outside `__tests__` so Jest doesn't collect it. **A new test pattern for SA to accept or reject** |
| D3 | Repository logs every read error at `warn` (§3.5) | `usageSummaryByFeatureAndDay` logs an RPC error at `debug`; everything else is unchanged | The card already logs the missing-function case once at `warn`, with the fix. A second warn per card load would change the card's log output, which the characterization test caught (FR-23 "no behaviour change") |
| D4 | Refresh reducer state `selection` | `accountId` + `startIso` fields, plus `settledRequests` | The start time exists before a business is chosen. `settledRequests` fixes a real bug found by the hook test: a response fast enough to be batched with its own start left `inFlight` looking unchanged, so the auto-refresh timer never re-armed |
| D5 | Q-11 type case inside `usageSummary.test.ts` | Dedicated `lib/business-os/usage/__tests__/tokenUsageRepository.contract.test.ts` | WC-3 |
| D6 | — | New exports: `isPlatformAccountEnvIgnored()` (catalog), `bosCategoryFeatures()` (usageCategories), `BUSINESS_SEARCH_MAX_LIMIT` (BusinessProfileRepository), `TOKEN_USAGE_READ_LIMITS` (repository) | WC-9 flag without exposing the env value; one derivation shared by the category map and its static test; the caps asserted by tests |
| D7 | `BusinessListResponse` = `{ businesses, limit, platformAccountIds }` | + `platformAccountEnvIgnored` | WC-9 visibility on the tab before any report is run |
| D8 | Report response per §3.3 | + `trigger`, and `account.profileLookup: 'skipped'` | WC-6; the client keeps the name from the last manual report |
| D9 | Static boundary test: "the usage route contains no `supabaseServer.from(`" (AC-16) | The usage route test asserts **no `token_usage` read, no `.rpc(`, no `createClient(`**, and that the only remaining direct read is `.from('ais_system_config'` | FR-23 keeps `readAllowanceCredits` in the route, and it still reads `ais_system_config` directly. AC-16's literal wording and FR-23 conflict here; **SA to confirm** (moving it is out of 1.1 scope) |
| D10 | Route header comments said "never `profiles.role`" | Reworded to "never the user-writable profile role field" | WC-8's static test asserts that the routes contain no `profiles.role` text at all |
| D11 | Skill Step 2: row types in `lib/repositories/types.ts` | `TokenUsageRepository` row types live in the repository file and are re-exported from `index.ts` with `export type` (Q-9) | Recorded as SA required: `TokenUsage` in `types.ts` is an unrelated execution type |
| D12 | T39 local dev smoke | **Not run** | No `.env.local` in the worktree, and the main checkout is off-limits. The tab's behaviour is covered by jsdom component and hook tests. The browser smoke (including SA's `%` search note) moves to QA |

### 11.5 Points for SA to examine closely

1. **D9:** the AC-16 wording against `readAllowanceCredits` staying in the usage route.
2. **D3:** the repository's `debug` level for an unavailable usage-summary function.
3. **D2:** the new `tests/helpers/fakePostgrest.ts` helper; its semantics are what WC-1's equivalence proof rests on.
4. **The admin gate in both routes:**
   - `isAdmin` runs in its own `try/catch` before Zod;
   - the report route fixes `receivedAt` before `getUser()`, so the window end is the receipt time;
   - no read runs before 401/403/400 (route tests count every repository call).
5. **Check 2 when the breakdown read fails:** the check is Fail even with a count of 0 (a silent empty breakdown would otherwise read as Pass). SA's Q-6 covered Check 3 only.
6. **`listCallsInWindow` paging with the ceiling:** each page is `min(pageSize, ceiling - from)` rows. `reachedCeiling` is `rows.length >= ceiling`, so exactly 5,000 counts as Incomplete (Q-8).
7. **`summedBy` and the fallback now start inside `Promise.all`:** the fallback begins as soon as the RPC fails, instead of after all three reads settle. The response and log lines are unchanged.

---

## 12. SA Review Notes

**Reviewed by SA — 2026-09-17**
**Status:** 🔄 **APPROVED WITH CHANGES.** Apply WC-1 to WC-10 while implementing (no second workplan review needed). WC-1, WC-2 and WC-4 must be applied before their steps start (S1, S4, S9). Q-14 needs the user's answer before QA, not before implementation.

### 1. Requirement check: RC-1 to RC-14

All 14 were applied correctly and are marked in the requirement's SA Review. Evidence: Definitions (Status, Window, Business OS row filter, Known non-catalog components), FR-1 to FR-3, FR-12 to FR-18, FR-23, FR-24, NFR Type safety, AC-3, AC-6, AC-12, AC-16, AC-23, AC-24.

One gap came from SA's own RC-1 wording, not from the BA: "the same end for every read" can't hold for Check 5 (M-1). This, and the wording that follows from Q-2, Q-3, Q-5 and Q-12, **was aligned by SA directly** as wording only (requirement Change History row "SA wording alignment…"):
- Definitions (Platform account, Window);
- FR-2, FR-9, FR-11, FR-16, FR-21;
- AC-13, AC-15, AC-21.

SA's earlier Testability note ("no React test harness") was wrong and has been corrected (see M-8 below).

**BA to-dos:** none blocking. Optionally, the BA can re-read the aligned lines for tone.

### 2. Workplan review summary

| Area | Verdict | Evidence / note |
|---|---|---|
| Traceability | ✅ Every FR and AC maps to tasks and tests (§8) | AC-21 depends on Q-14 |
| Code-reality check | ✅ Spot-checked M-1, M-2, M-5, M-8, M-9, M-12, M-13; all confirmed | `20260929_usage_summary.sql:45-48`; `ConfigRepository.ts:5`, `:18`; `jest.config.js:6-8`, `package.json` (`jest-environment-jsdom`, `@testing-library/react`); `hooks/useSideConsole.test.tsx:1-2`; `docs/BUSINESS_OS_TEST_PAGE_SCOPE.md:101`; `app/test-business-os/page.tsx:43-47`. Minor: the `PurgeDangerZone.tsx:84-97` path is `components/business-os/purge/`, not `components/test-business-os/` |
| Route design and admin gate | ✅ Inline `AdminAccessService` gate with an explicit catch, order 401 → 403 → 400, schema outside the route module (§3.2). Needs WC-4 (route segment config) | `chat-usage/route.ts:37-62`; `AdminAccessService.ts:98-133` |
| Tenant isolation | ✅ Required account on every repository method, UUID and label guards before any query, one `platformAccountIds()` read per request, and a test that the same end value reaches every windowed read. The unscoped profile read is documented and admin-gated. No writes, so skill Steps 2–4 don't apply | `tenant-isolation-guard` Step 1 |
| Repository design | ✅ Read-only, column allow-list constant, never throws, imports nothing from `lib/business-os/**`. Guard regex `^[a-z0-9-]+$` on the `.or()` inputs is sound defence in depth | §3.5 |
| `usageSummary.ts` extraction | ✅ The characterization test first (S1) is the right order. The `ConfigRepository` equivalence table (M-2) is correct case by case: `'0'`/`''` → `'' \|\| null` → 10, same as `parseInt` → not > 0 → 10. Needs WC-1 so the test actually proves it. Server use of `ConfigRepository` has a precedent: `lib/business-os/leads/LeadReplyRecommender.ts`. The browser client module loads on the server with env set (`tests/plugins/jest-setup.ts:12-14`) | §3.9 |
| Check algorithms | ✅ The classification pseudocode matches Definitions and RC-2: `BizQLPlanCache` exempt from unknown call name only; `IntentParser` exempt from both; the legacy `business-os` value falls through to the legacy branch, not unknown. Status precedence (error → fail → incomplete → info → pass) matches FR-18. Check 3 with no rows is Pass, per FR-14 | §3.8 |
| Offset paging | ✅ Rows are inserted with the DB's `now()` and only at the newest end, so a boundary shift can only **duplicate** a row (removed by the `id` de-duplication), never skip one. Deletes don't occur in this window. Accepted | M-3 |
| Client and refresh state machine | ✅ A pure reducer plus a hook; `setTimeout` re-armed after completion (no overlap); request-id stale guard; `AbortController` on unmount; visibility pause without resuming automatically; no log line per successful auto refresh; `onLog`/`onResponse` props instead of `callApi` (M-13). Needs WC-7 | §3.10 |
| Test plan | ✅ Strong. Pure checks, repository guards, orchestrator failure injection, route gate order, and jsdom component and hook tests. Needs WC-1, WC-3, WC-8 | §5 |
| Step sequencing | ✅ Each step ends green. S1 before S2/S4; the repository (S3) before the extraction (S4); pure logic before the orchestrator and routes; page wiring last. The `--list` checks at S3 and S14 and the stop-and-escalate rule are correct | §9 |
| Pino / `console.*` | ✅ None of the modified files use `console.*` (verified list §1). `aiAnalytics.ts` is untouched, so no conversion is due | CLAUDE.md § Logging |

### 3. Type-check gate impact (task 3)

**Accepted.** Verified against `scripts/typecheck-bos-llm.ts:161-194`:
- `ts.preProcessFile` collects `import type`, so the client component, `refreshMachine.ts` and the hook become **callers** of the core `llmUsageReportTypes.ts`. That is acceptable, and useful: they are all new code, and it type-checks the client against the response contract.
- `page.tsx` imports only the component (a caller), so it stays out, as do the component and hook tests unless they import a core file directly.
- The barrels step runs before the callers step, and `TokenUsageRepository.ts` imports nothing in scope. So `lib/repositories/index.ts` and its 19 importers stay out, as RC-7 intended.
- About +18 to +22 files of new code, with the baseline byte-identical (blob `8cff995b…`). The "stop and escalate if any pre-existing file joins" rule stands.
- Test fixtures that `import type` from `llmUsageReportTypes.ts` will also join. That is fine: they're new files.

### 4. Rulings on §7 questions

- **Q-1 (M-1): Approved.** Check 5 uses an open end (`windowEnd: 'open'`), shown in the tab and the scope doc. There is no migration, and `p_until` goes to F-2.
  - Confirmed: `business_os_usage_summary(p_user_id, p_since)` filters only `created_at >= p_since` (`20260929_usage_summary.sql:45-48`, `:68`, `:83`), and the fallback has no upper bound either (`route.ts:184`).
  - Check 5's Pass/Fail depends only on feature mapping, so the difference of a few milliseconds can't change a status.
  - The requirement wording was aligned by SA (Window, FR-9, FR-11, AC-13, AC-21). No BA action.
- **Q-2 (M-5): Approved.**
  - `platformAccountIds()` includes the env value only if it is a UUID, lower-cased and de-duplicated. That is also correct because the tracker couldn't write a non-UUID `user_id` into the uuid column (`aiAnalytics.ts:121-126`).
  - `isPlatformAccount` becomes case-insensitive. PostgreSQL `uuid` comparison is case-insensitive, so an upper-case variant really is the platform account. The extra builder error log is correct behaviour.
  - Add WC-9 (make an ignored env value visible).
- **Q-3 (M-6): Approved.** Add top-level `platformAccountIds` to the business-list response: ids only, admin-gated, the same list the report shows. The requirement was aligned (FR-2, AC-15).
- **Q-4 (M-4): Approved.** PostgREST treats `*` as `%` in `like`/`ilike` and it can't be escaped. The only effect is a wider admin-only name search capped at 50, so accept and document it. `.ilike()` (not `.or()`) sends the value as a single operator argument, so commas and parentheses in the search are harmless.
- **Q-5a: Approved with WC-6.** Reuse `findByUserId` and return only `company_name`. A lookup failure doesn't fail the report (`profileLookup: 'failed'`); the requirement FR-11 was aligned.
- **Q-5b: Approved.** Check 5 is Info with zero calls, consistent with Definitions ("Info … no data"). The requirement FR-16 was aligned.
- **Q-6: Approved with a condition.** Any Check 3 read error → Fail (FR-18: never zero or Pass), including the Info-only (c) reads. The check's `error` must **name the part** that failed (e.g. "(c) platform helper-label timestamps could not be read"), so an admin doesn't read a (c) read failure as a legacy-label finding. Fold this into T20.
- **Q-7: Approved.** Exemptions apply only in their declared area (chat). This matches the Layer 1 §6.4 pass rule, which exempts `business-os-chat` / `BizQLPlanCache` and chat v1 `IntentParser` rows (Layer 1 workplan `:461-469`). Legacy and unknown-area rows are already flagged and aren't judged against the catalog again.
- **Q-8: Approved.** Exactly 5,000 rows → Incomplete. This is the literal reading of FR-18 and can never be a false green. The probe alternative isn't worth the extra query.
- **Q-9 (M-9): Approved.** Row types live in `TokenUsageRepository.ts` and are re-exported with `export type`, following `UserProfileRepository`/`OrganizationRepository` (`index.ts:20-32`). This is a justified deviation from the `new-repository` skill's Step 2, because of the existing unrelated `TokenUsage` in `types.ts:230`. Record the deviation in §11.
- **Q-10: Approved.** The admin check is inlined in both routes, matching `chat-usage` and avoiding a new pattern. A shared helper can come with F-4 or the `/api/admin/**` auth fix.
- **Q-11: Approved with WC-3.** The compile-time "account required" proof must live in a gate-covered file, and must cover **every** `TokenUsageRepository` method, not one.
- **Q-12: TL ruling (already decided), reflected in WC-5 and requirement FR-21.** T36 adds the LLM Usage section, its ToC entry and a Change History row. It also corrects **only** the stale tab statements: "The only tab wired up today" (`docs/BUSINESS_OS_TEST_PAGE_SCOPE.md:101`) and any tab list, so they name Overview, Modules, Danger Zone and LLM Usage. It does **not** document the Danger Zone tab in depth; that is logged as a follow-up (F-5 below).
- **Q-13: Approved.** A failed request turns auto-refresh **off**, as FR-10 says ("stops … a request fails"). Hidden and input-change pauses resume on the next manual Refresh.
- **M-2 (injected `supabaseServer` into `ConfigRepository`): Approved with WC-1.**
- **M-8: Confirmed. SA's earlier note was wrong.** A jsdom and Testing Library setup exists (`package.json` devDependencies; `hooks/useSideConsole.test.tsx` starts with `@jest-environment jsdom`). AC-17 to AC-20 get component and hook tests, plus the QA browser smoke.
- **`*` wildcard and `id` de-duplication:** approved (Q-4, and "Offset paging" in §2 above). Add WC-10 to confirm `id` exists and how it sorts.
- **Q-14 (user):** see §6 below.

### 5. Required workplan changes

1. **WC-1 (T1, M-2, AC-23): make the characterization mock faithful to PostgREST.** The route uses `.maybeSingle()` today; after the refactor `ConfigRepository.getSystemConfig` uses `.single()`.
   - **Problem:** a hand-set mock return value would "pass unedited" without proving equivalence.
   - **Change:** T1's `supabaseServer` mock drives both methods from **row fixtures with real semantics**:
     - 0 rows: `.single()` gives PGRST116 with `data: null`; `.maybeSingle()` gives `data: null` with no error;
     - 1 row: both return the row;
     - more than 1 row: both return an error.
   - Cover `config_value` of `'25'`, `'0'`, `''`, `null`, number `25` and a thrown client error.
   - Write it in S1 against the original route.
2. **WC-2 (S4 ordering):** write T14 (`usageSummary.test.ts`) **before** T13 switches the route, so the module is proven on its own before the route depends on it. T1 must still pass unedited after T13.
3. **WC-3 (Q-11, AC-24): put the type-level contract test in its own core-scope file.** Use `lib/business-os/usage/__tests__/tokenUsageRepository.contract.test.ts` instead of mixing it into `usageSummary.test.ts`.
   - Add one `// @ts-expect-error` per method: `usageSummaryByFeatureAndDay`, `listSummaryRowsPage`, `listCallsInWindow`, `countInWindow`, `listLabelsInWindow`, each called without its account argument.
   - Add one runtime assertion that an empty `userIds` returns an error.
   - The gate reports TS2578 if a signature ever makes the account optional.
4. **WC-4 (T26, T28): add route segment config to both new routes.** Use `export const runtime = 'nodejs'` and `export const dynamic = 'force-dynamic'`, following `app/api/business-os/purge/access/route.ts`.
   - `runtime`: `callCatalog.ts` imports Node `crypto` (`:28`) and Pino, so the Edge runtime must never be chosen.
   - `dynamic`: an admin- and cookie-dependent GET must never be cached.
5. **WC-5 (T36, Q-12 TL ruling):** T36 also corrects `docs/BUSINESS_OS_TEST_PAGE_SCOPE.md:101` ("The only tab wired up today…") and any tab list so they are true: Overview, Modules, Danger Zone, LLM Usage. It adds the Check 5 open-end caveat and the `*` wildcard note. It does **not** add a Danger Zone section. Record follow-up F-5 in §6.3.
6. **WC-6 (Q-5a, RC-11 intent): look up the business name on manual refreshes only.**
   - **Problem:** `BusinessProfileRepository.findByUserId` logs at **info** twice per call (`BusinessProfileRepository.ts:342`, `:359`). On a 10 s auto-refresh that is about 720 info lines an hour, which defeats RC-11's "debug for auto".
   - **Change:** run R9 only when `trigger=manual`. For `auto`, return `profileLookup: 'skipped'`, and the client keeps the name from the last manual report (the reducer already holds the previous report). Add `'skipped'` to the type and a reducer or hook test case.
   - Also: `TokenUsageRepository` logs successes at `debug` only, and warnings or errors as §3.5 says.
7. **WC-7 (§3.10): make the transition when an auto-refresh selection is invalid explicit.** If an auto request returns `400` (e.g. the 7-day bound is crossed during a long session), it follows `REQUEST_FAIL`: auto off, error shown with the server message. Add this case to `refreshMachine.test.ts`. No other change.
8. **WC-8 (T34, AC-1): extend the static boundary test.** Assert that the two new routes contain no `profiles.role`, `UserProfileRepository` or `app_metadata` reference. The AC-1 `profiles.role` route case mocks `isAdmin` to false, so on its own it is tautological; the static assertion makes it real.
9. **WC-9 (Q-2, R-10): make an ignored env value visible.** When `SYSTEM_ADMIN_USER_ID` is set but isn't a UUID, the report adds `platformAccountEnvIgnored: true`, and the tab shows "SYSTEM_ADMIN_USER_ID is set but is not a UUID; only the all-zero id was checked". The route also logs `warn` once per request. It's a boolean only; the env value is never returned. Add unit and component cases.
10. **WC-10 (T0/T9, M-3): verify the columns before writing the repository.** In S0, confirm on the target project that `token_usage` has `id`, `error_code`, `cost_usd`, `success` and `total_tokens`, and record `id`'s type (uuid or bigint) in §11. The `id DESC` tiebreak only needs to be stable, not meaningful, so either type works. But the `LedgerCallRow.id: string | number` type should be narrowed to the real one. Use a one-off read-only `select … limit 1` or the schema dump; no code.

### 6. Q-14: technical constraints for the user decision (not decided by SA)

Whatever the user decides, QA must know:
1. The insight run step (`/api/cron/insight-detect`) spends LLM tokens for **every active business in that Supabase project**, not just the test business. It also permanently adds usage rows, so those businesses' "credits remaining" goes down (Layer 1 OI-1).
2. Check 2 is **platform-wide**. Any other activity in the same project during the window (other developers, crons) that mis-attributes a Business OS call shows as a Fail. That is a real finding, but QA shouldn't assume it came from the test session.
3. The dev server's `SYSTEM_ADMIN_USER_ID` and `CRON_SECRET` must match the project being tested. Otherwise Check 2 looks at the wrong platform id (WC-9 makes a malformed value visible, but not a *different* valid one).
4. Nothing in 1.1 writes. The only data change comes from running the flows themselves.

### 7. Follow-ups added

| # | Item |
|---|---|
| F-5 | `docs/BUSINESS_OS_TEST_PAGE_SCOPE.md`: document the Danger Zone tab (Purpose / Features / API endpoints / Use Cases). Out of 1.1 per TL ruling 2026-09-17 |

### Optimisation suggestions (non-blocking)

- `hooks/useLlmUsageAutoRefresh.ts` imports the reducer from `components/test-business-os/llm-usage/`. That dependency points from `hooks/` into `components/`. Consider moving `refreshMachine.ts` to `hooks/` next to the hook. Not required.
- `escapeIlikePattern` is unit-tested, but the database's handling of `\` as the ILIKE escape is not. Add a search for a name containing `%` to T39's local smoke.

### Approval

- [x] Workplan approved. Proceed to implementation, applying WC-1 to WC-10. Record the Q-9 deviation, the WC-10 findings and the `--list` delta in §11.

---

### SA Code Review

**Code Review by SA — 2026-09-17**
**Status:** ✅ **Code Approved with one required fix (CR-1).** CR-1 is a one-line mechanical change. The Dev applies it and re-runs the two checks listed under CR-1; no second SA review is needed. QA may start once CR-1 is in. O-1 to O-6 are optional.

#### A. Independent verification (SA re-ran, not taken from §11)

| Claim | SA result |
|---|---|
| Jest, touched areas | ✅ 111 suites, 1,761 passed, 28 skipped, 2 snapshots passed (`--ci`) |
| `npm run typecheck:bos-llm` | ✅ 119 files, 30 errors, 0 new, passed; `scripts/typecheck-bos-llm.baseline.json` not modified (`git status`) |
| Full `tsc --noEmit -p .` | ✅ 2,045 errors; none in any new or touched file |
| ESLint (`-c eslint.config.mjs`) and `console.*` | ✅ 0 problems, 0 `console.*`. Note: the default `npx eslint <files>` picks `eslint.config.js` and **ignores** every one of these files, so "0 problems" is only true with `-c eslint.config.mjs` |
| AC-23: the card's response is unchanged | ✅ **Proven by SA independently.** The unchanged characterization test and snapshot were run with `--ci` against the **original** route (`git show HEAD:app/api/business-os/usage/route.ts`, mapped in through a scratch Jest config): 19/19 pass, 2 snapshots match. A mutation in that copy (default 10 → 11) fails 8 tests, so the test really exercises the route it loads |
| D4: the fast-response re-arm fix | ✅ **Proven by mutation.** With `settledRequests` removed from the timer effect's dependencies, `runs at the chosen interval with trigger=auto…` fails (1 of 9). The fix is correct and is covered by that test |
| WC-3 contract test | ✅ All five methods carry an `@ts-expect-error` line, in a core-scope file. The Dev's TS2578 mutation proof (§11.1) is accepted |

#### B. Findings (ranked)

**Required**

1. **CR-1 — `lib/business-os/usage/llmUsageVerification.ts:316` — a literal NUL byte (0x00) in the source.** Priority: **Medium**. The breakdown map key is built as `` `${feature}<NUL>${row.component ?? ''}` `` with a raw NUL character typed into the template literal, not an escape sequence.
   - **Effect:** `file` reports the module as `data`, `grep` reports "Binary file matches", and ripgrep (VS Code search and the agents' own code search) **skips binary files by default**. The definitions of every check would silently disappear from code search. Git only treats it as text because the byte sits past offset 8,000; an edit above it that shortens the file enough would flip the diff to "Binary files differ".
   - **Fix:** use a visible separator or escape, e.g. `'\u0000'` written as an escape sequence, or `JSON.stringify([feature, row.component])` as the key. No behaviour change.
   - **Caution:** some edit tools turn an escape typed in the replacement text into the raw byte, which is the likely origin of this bug (SA hit exactly that while writing this note). Check the file bytes after editing, not the editor view.
   - **Verify:** `tr -d -c '\000' < lib/business-os/usage/llmUsageVerification.ts | wc -c` prints `0`; `file` reports text; the Jest suite for `llmUsageVerification.test.ts` still passes.

**Optional (Low; not blocking QA)**

- **O-1 — `lib/repositories/TokenUsageRepository.ts:318-322` — `reachedCeiling` counts unique rows, not rows read.** If de-duplication drops a repeated row, the last page ends at slot 5,000 but `rows.length` is 4,999, so `reachedCeiling` is false even though an older row was pushed past the ceiling. In practice this needs a row inserted *inside* the fixed window during paging (the `lte(end)` bound excludes new `now()` rows unless the app and DB clocks disagree), so it is near-impossible. It would still be a false "complete", so the cheap fix is: treat the read as at the ceiling when the last requested slot (`ceiling - 1`) came back full, regardless of de-duplication.
- **O-2 — `llmUsageVerification.ts:450`, `:471` — timestamps are ordered with `localeCompare`.** ICU collation isn't code-point order: SA confirmed `'…10:00:00+00:00'.localeCompare('…10:00:00.5+00:00')` returns 1, so a row on an exact whole second sorts after a fractional one. PostgREST prints whole seconds without a fraction. `created_at` is a microsecond `now()`, so this is about a 1-in-a-million misordering of "call names in the order they ran" and first/last. Compare `Date.parse` values, or plain `<`/`>`.
- **O-3 — `llmUsageVerification.ts:332` — when Check 2's breakdown read fails and the count is > 0, `breakdownTruncated` is true,** so the tab shows a truncation warning next to the read error. Set it to false when the breakdown wasn't read.
- **O-4 — `components/test-business-os/llm-usage/LlmUsageVerification.tsx:138-144` — if the first business-list request fails (500 or network), the whole tab shows only the error,** and the "paste an account id" path (FR-8) is unreachable, although the report route itself may work. Consider rendering the picker (paste field enabled) with the list error inline once the failure is not 401/403.
- **O-5 — `tests/helpers/fakePostgrest.ts:114-117` — `gte`/`lte` compare timestamps as strings.** That's correct only when fixtures use the same ISO format as `toISOString()` (all current fixtures do). Add one sentence to the header saying fixtures must use `toISOString()` format.
- **O-6 — `hooks/useLlmUsageAutoRefresh.ts:209`, `LlmUsageVerification.tsx:62` — `crypto.randomUUID()` needs a secure context.** It works on localhost and HTTPS, but on a plain-HTTP LAN host every request fails with a JS error, which does show in the tab. Not worth changing for an internal page; noted for QA.

#### C. Security review (highest priority): no findings

| Item | Result | Evidence |
|---|---|---|
| Gate order 401 → 403 → 400, fail closed | ✅ | Both routes: `getUser()` (server-validated `auth.getUser()`, `lib/auth.ts:29-31`), then `isAdmin` in its own `try/catch` defaulting to `false`, then Zod. Report route `:49-83`, list route `:186-218`. Tests count every repository call and assert zero before the gate passes, including a throwing admin check and a non-admin sending invalid parameters |
| No `profiles.role` / `app_metadata` / `UserProfileRepository` (WC-8) | ✅ | Static test `boundaries.static.test.ts:110-119` |
| `runtime = 'nodejs'`, `dynamic = 'force-dynamic'` (WC-4) | ✅ | Report route `:39-40`, list route `:178-179`; static-tested |
| Zod on every input | ✅ | `buildReportQuerySchema` (UUID → lower-case → platform-account refine; ISO datetime with offset; ±60 s skew; 7-day bound; `trigger` enum) and `BusinessListQuerySchema` (max 100, trimmed) |
| Platform account rejected as the selected business | ✅ | `llmUsageVerification.ts:88`; route tests for the all-zero id and an env id in any case |
| No emails, payloads, error messages in responses | ✅ | Column allow-list `TOKEN_USAGE_COLUMNS` (`TokenUsageRepository.ts:80-85`) never names `request_payload`, `response_metadata`, `metadata` or `error_message`; `searchForAdmin` selects `user_id, company_name`; `findByUserId`'s row is reduced to `company_name` before it leaves the orchestrator. The route test asserts the serialized response contains none of those strings nor `@example.com` |
| Error details | ✅ | 400 messages are fixed schema strings; 500 details only under `NODE_ENV === 'development'`; per-check errors are fixed strings, and raw errors are only logged |
| Search escaping (Q-4) | ✅ | `escapeIlikePattern` escapes `\` first, then `%` and `_`; `.ilike()` only, never `.or()`; the `*` wildcard is documented in code and in the scope doc. The DB-side `\` escape is still for QA's browser smoke (D12) |
| `.or()` injection | ✅ | The only `.or()` string is built from `LABEL_PATTERN`-guarded constants (`TokenUsageRepository.ts:97`, `:184-188`) |
| Repository requires the account (RC-6a) | ✅ | Required parameters on all five methods, runtime UUID guards, empty list rejected; WC-3 type contract |
| Cross-tenant reads only behind the gate (`tenant-isolation-guard`) | ✅ | Step 1: service-role reads by a caller-supplied id, so the guard applies. The gate precedes every read, the id is validated and non-platform, and each read is scoped to that one id or to `platformAccountIds()` (read once, returned as checked). Steps 2–4 (writes, allow-listed payloads, the trigger/upsert/injection trio) don't apply: there are no writes, and the static test forbids `insert`/`update`/`upsert`/`delete` in the routes, the modules and the repository. Step 7: the invariant tests are the route gate tests |
| `searchForAdmin` documented bypass | ✅ | `BusinessProfileRepository.ts:519-532` |
| Client bundle boundary (RC-8) | ✅ | Every client file imports server modules with `import type` only (static-tested, dynamic `import()`/`require` also forbidden). `llmUsageReportTypes.ts` exports types only |
| Logs | ✅ | Manual refreshes at info, auto at debug; no business names or search text; denied access at warn with the user id; the name lookup (whose repository logs at info) is skipped on auto (WC-6) |

#### D. Correctness of the checks: matches the requirement

- **Exemptions (RC-2, Q-7):** `classifyCallRow` applies a known component only when the row's area is current **and** equals the component's declared area (`:192-195`). `BizQLPlanCache` is exempt from the unknown call name flag only; `IntentParser` from both. Legacy and unknown-area rows aren't judged against the catalog again. ✅
- **Incomplete at 5,000:** `reachedCeiling = rows.length >= ceiling` (exactly 5,000 counts, Q-8). The ceiling propagates to Checks 1, 3(a) and 4 and to the area totals; status precedence is error/fail → incomplete → info → pass. ✅ (see O-1 for the de-duplication corner)
- **Pass/Fail from all rows, display capped:** status and flag counts use the full array, and only `slice(0, 500)` is returned. Tested with a flagged row at position 501+ for Checks 1 and 4. ✅
- **`business-os%` + unknown area:** `bosRowFilter()` builds the `LIKE 'business-os*'` or legacy-list filter from the constants; `business-os-webiste` → `unknown_area`; the legacy `business-os` → legacy (briefing). ✅
- **Legacy helper label (FR-14):** (b), selected account → Fail; (c), platform → Info only, with an exact count and at most 50 timestamps; a read failure in any part → Fail, naming the part (Q-6). ✅
- **Check 5 open end:** `readUsageSummary(accountId, window.start)`; `windowEnd: 'open'` in the response and the caveat in the tab. Fail only for an observed `isBusinessOsFeature` value in `other`. ✅
- **`platformAccountIds()`:** UUID-only env value, lower-cased and de-duplicated. `isPlatformAccount` is case-insensitive (approved Q-2; it also makes the Layer 1 builder reject an upper-case system id, which is tested). `isPlatformAccountEnvIgnored` is a boolean only, and the route warns once (WC-9). ✅
- **Paging de-duplication:** keyed by `String(row.id)`, first copy kept; `created_at DESC, id DESC`. ✅
- **Fixed window end:** `receivedAt` is taken before `getUser()`; the orchestrator test asserts the same `end` reaches every windowed read. ✅

#### E. Owner usage card: no behaviour change (verified)

- The extraction in `usageSummary.ts` is line-for-line equivalent: RPC first with null meaning "not migrated", BIGINT coercion, feature-row totals only, the same paging fallback, `Math.round(tokens / tokensPerCredit)` and the same breakdown sort.
- **`ConfigRepository` with `supabaseServer` injected (M-2):** `.single()` plus `data?.config_value || null` then `parseTokensPerCredit` gives the same result as the old `.maybeSingle()` read for every case: `'25'`, `25`, `'0'`, `''`, `null`, `'abc'`, `'-3'`, no row, two rows, and a thrown error. The characterization test covers them all, and it passes against both the old and the new route (§A).
- **Snapshot strength:** strong. It pins the exact serialized body for the database path and for a 3-page fallback (2,050 rows, with one other-account row and one out-of-window row excluded), plus `summedBy` and the single warn line (which caught D3).
- **Starting the fallback inside `Promise.all` (§11.5 item 7):** the response is identical. A fallback page error still becomes a 500 (tested).

**`tests/helpers/fakePostgrest.ts` (D2 in §11.4; Dev item b): accepted as a test pattern.** Its semantics match PostgREST for what it claims to support:
- `.single()`: 0 or >1 rows → PGRST116 with `data: null`;
- `.maybeSingle()`: 0 rows → `null` with no error; >1 rows → PGRST116;
- the exact count is taken before `range`/`limit`; `head: true` returns `data: null`;
- default null ordering is ASC NULLS LAST and DESC NULLS FIRST;
- `like`/`ilike` handle `%`, `_`, `*` and `\` escapes;
- the `or` parser throws on unsupported operators, and unsupported builder methods are simply absent, so they fail loudly.

It lives outside `__tests__` and is shared by four suites. **Conditions for reuse:**
- extend it only with real PostgREST semantics;
- keep it test-only;
- note the string timestamp comparison (O-5).

It doesn't replace a live smoke: DB-side ILIKE escaping and column existence stay with QA.

#### F. Dev's flagged items

- **(a) AC-16 vs FR-23: `readAllowanceCredits` reading `ais_system_config` directly.** **Accepted for 1.1.**
  - FR-23 explicitly keeps `readAllowanceCredits` in the route. The read is pre-existing, not new code, and `ConfigRepository` has no multi-key read.
  - The static test pins it as the **only** direct read left, so it can't grow.
  - AC-16 is read as "no *new* direct Supabase call, and no `token_usage` read, in the usage route".
  - **Follow-up F-6 added:** move `readAllowanceCredits` behind a `ConfigRepository.getSystemConfigs(keys[])` method (one round trip), then tighten the static test to zero direct reads.
- **(b) `fakePostgrest`:** accepted; see §E.
- **(c) Check 2 is Fail when its breakdown can't be read, even with count = 0.** **Accepted.** It is consistent with FR-18 ("a read that fails … shown as Fail … never as zero or Pass") and with the Q-6 ruling for Check 3. The error names the part ("Platform-account breakdown could not be read"), so an admin won't read it as a finding. See O-3 for the truncation flag in that state.

#### G. WC-1 to WC-10

| WC | Implemented | Evidence |
|---|---|---|
| WC-1 | ✅ | Fixture-driven fake with real `.single()`/`.maybeSingle()` semantics; all six config cases plus no row, two rows and a throw; proven against the original route by SA (§A) |
| WC-2 | ✅ (process) | `usageSummary.test.ts` exists and covers the module standalone; the ordering itself is process evidence from §11 |
| WC-3 | ✅ | `tokenUsageRepository.contract.test.ts`: five `@ts-expect-error` lines plus a runtime empty-list check, in core scope |
| WC-4 | ✅ | Both routes; static-tested |
| WC-5 | ✅ | Scope doc lines 21 and 100 list all four tabs and point to F-5; Check 5 open-end caveat and `*` wildcard note present; non-production use case present; ToC and Change History updated |
| WC-6 | ✅ | Name lookup only on manual; `profileLookup: 'skipped'`; the reducer keeps the last manual name (orchestrator, route and reducer tests) |
| WC-7 | ✅ | `REQUEST_FAIL` sets auto `off` for any status, including 400 (reducer and hook tests) |
| WC-8 | ✅ | Static test |
| WC-9 | ✅ | Catalog, orchestrator, both routes (warn once, value never returned or logged), and the tab banner; unit, route and component tests |
| WC-10 | ⚠️ Partial, fail-safe; **QA entry condition** | The code evidence is sound for `cost_usd`, `success`, `error_code`, `input_tokens`, `output_tokens`, `session_id`, `feature` and `component`: the live tracker insert writes them (`aiAnalytics.ts`), so a missing column would already break every LLM call. `total_tokens` is read by the migrated function. The `id` type evidence is weaker (a plan doc), but the design doesn't depend on it: `String(row.id)` de-duplicates either type, and `id DESC` only needs a stable order. If `id` were missing, the paged read would error and Checks 1, 3, 4 and the totals would show **Fail**, never a false Pass. QA runs the read-only `select id, error_code, cost_usd, success, total_tokens from token_usage limit 1` probe before AC-21 |

#### H. Deviation judgements (§11.4)

| # | Judgement | Note |
|---|---|---|
| D1 | ✅ Accepted | This was SA's own optimisation note; `hooks/` no longer imports `components/` |
| D2 | ✅ Accepted | See §E; reuse conditions stated there |
| D3 | ✅ Accepted | The caller still warns once with `err` and the fix; the repository's `debug` avoids a doubled warn. Guard refusals still warn |
| D4 | ✅ Accepted | A real bug fix, proven by SA mutation (§A) |
| D5 | ✅ Accepted | Required by WC-3 |
| D6 | ✅ Accepted | All four exports are used by code or tests; no env value is exposed |
| D7 | ✅ Accepted | WC-9 visibility before the first report |
| D8 | ✅ Accepted | WC-6 |
| D9 | ✅ Accepted with follow-up F-6 | See §F(a) |
| D10 | ✅ Accepted | Needed for the WC-8 static assertion; the meaning is unchanged |
| D11 | ✅ Accepted | Pre-approved Q-9 deviation from the `new-repository` skill (Step 2) |
| D12 | ✅ Accepted, moved to QA | QA's browser smoke must include: a `%` / `_` search, "My account", a pasted id, a 10 s auto-refresh with the tab hidden and shown, and the WC-10 probe |

#### I. Skill checklists and CLAUDE.md compliance

- **`new-api-route`:** ✅ route files, `requestLogger` only, no direct Supabase, Zod before logic, dev-only details, 401/403/400/200 tests. The account filter is the validated target id, not `user.id`, by design (admin cross-account read, documented). There is no audit event, by design (OQ-5). Lint per §A.
- **`new-repository`:** ✅ optional client, `{ data, error }` never thrown, `createLogger({ service })`, a singleton, class and types re-exported from `index.ts` (types in the repository file per Q-9), per-method tests with error paths, no `'use client'` importer. The `.in('user_id', ids)` scope for platform ids is documented.
- **Scope:**
  - no Layer 1 attribution behaviour change other than the approved Q-2 case-insensitivity;
  - no F-1 to F-5 work;
  - no migration;
  - no new direct Supabase call outside repositories (the one pre-existing read is pinned, F-6).
- **`turnUsage.ts`:** a trivial literal → constant swap with the same value. ✅
- **`providerFactory.complete.test.ts`:** one added AC-5 case, correct. ✅
- **Pino:** ✅ no `console.*` in new or touched code. (`aiAnalytics.ts` still has `console.warn`, but it isn't touched by this diff, so no conversion is due.)

#### J. Test quality against the ACs

| AC | Proven by | Verdict |
|---|---|---|
| AC-1, AC-2, AC-3 | Route tests (both routes), schema unit tests | ✅ |
| AC-4 | Static literal scan, catalog derivation tests, `usageCategories.test.ts` unedited | ✅ |
| AC-5 | `callCatalog.test.ts` agreement cases, `providerFactory.complete.test.ts` | ✅ |
| AC-6 to AC-12 | `llmUsageVerification.test.ts`, `llmUsageReport.test.ts` (failure isolation per read) | ✅ |
| AC-13 | Orchestrator scoping and fixed-end tests, plus repository tests against the fake applying `user_id`/window filters | ✅ |
| AC-14 | Route test: no audit, provider or direct-DB call; forbidden strings absent; static no-write scan | ✅ |
| AC-15 | `searchForAdmin` tests (escapes, 50 cap, columns, no `or`), list route test | ✅ (DB-side escaping: QA smoke) |
| AC-16 | Static boundary test; scope delta in §11.2 | ✅ (with §F(a)) |
| AC-17 to AC-20 | jsdom component, hook and reducer tests | ✅ (browser smoke: QA) |
| AC-21, AC-22 | QA run; scope doc verified by SA | AC-22 ✅; AC-21 pending QA |
| AC-23 | Characterization test, independently re-run by SA against the original route | ✅ |
| AC-24 | Repository tests, contract test | ✅ |

#### Follow-ups added

| # | Item |
|---|---|
| F-6 | Move `readAllowanceCredits` (`app/api/business-os/usage/route.ts`) behind a `ConfigRepository` multi-key read, then tighten the static test to zero direct reads in the usage route |

### Code Approved for QA: Yes, conditional on CR-1

**QA entry conditions:**
- CR-1 applied and its two checks run;
- the WC-10 read-only column probe;
- AC-21 in a **non-production** environment only.

---

## 13. QA Testing Report

### QA Report — 2026-09-17

**Test mode:** full (automated verification + live run)
**Strategy used:** A/B (Jest on the touched areas, the scoped gate and full `tsc` against a clean `main` archive), C (`tsx` driver scripts that call the real flows, the real report orchestrator and the real owner usage route against the live Supabase project with real OpenAI calls), plus independent read-only ledger queries as the oracle
**Focus:** all (api, security, schema, ui by component tests; browser smoke handed off)
**Skipped / handed off:** the T39 browser smoke (needs an admin browser session; handed to TL). Admin routes were **not** called live: no admin session, and auth was not forged. See §13.7
**Input source:** TL trigger prompt (Part 1 / Part 2 instructions), workplan §5.6 and §12 QA entry conditions

#### 13.1 Environment

| Item | Value |
|---|---|
| Code | Worktree `neuronforge-llm-attribution`, branch `feature/business-os-llm-usage-layer1-1`, uncommitted on `65d0283f` (CR-1 applied) |
| Database | Current Supabase project (future staging; 4 business profiles). User approved, including an all-business insight run (not needed, see §13.4) |
| LLM | Real OpenAI calls through the provider factory |
| Env | `.env.local` copied from the main checkout for the run (gitignored) and deleted afterwards. No secret values were printed or written. `SYSTEM_ADMIN_USER_ID` is set and is a valid UUID |
| Drivers | Temporary scripts in the session scratchpad (deleted afterwards), run with `npx tsx --import ./scripts/env-preload.ts` from the worktree root. A preload stubbed `server-only` (unresolvable outside Next) and, **for the Business OS flow routes only**, `@/lib/auth` returning the test account. No admin route was called |
| **Test account** | **`2f734ed5-3681-4049-880d-3de7b096bea3`** (same as Layer 1): has a business profile, 2 CRM contacts, 3 bookings, 1 invoice; not in `admin_users`; not `SYSTEM_ADMIN_USER_ID`; not the all-zero UUID |
| Window | **Start `2026-09-17T17:29:37.606Z`**, recorded immediately before the first flow. Final report fixed end `2026-09-17T17:35:18.010Z` (server receipt time) |

#### 13.2 Part 1: automated verification

| Check | Expected | Result |
|---|---|---|
| Jest, touched areas (`lib/business-os lib/repositories lib/ai app/api/business-os app/api/admin components/test-business-os hooks`, `--ci`) | ~111 suites / 1,761 passed | ✅ **111 suites passed; 1,761 passed, 28 skipped, 0 failed; 2 snapshots passed** (27.1 s) |
| `npm run typecheck:bos-llm` | 119 files, 30 known, 0 new | ✅ **119 files in scope, 30 errors, 0 new (103.2 s), passed, exit 0** |
| Baseline JSON | unchanged | ✅ Not in `git diff`; blob still `8cff995bebebae238587d7a03886c7851a0e2146` |
| Full `tsc --noEmit -p .` (worktree) | 2,045, 0 new | ✅ **2,045 errors; none in any new or modified file** |
| Full `tsc` on a clean `git archive 56fb7dbd` (node_modules junctioned; needed `--max-old-space-size=8192`) | compare | ✅ **2,045 errors; per-file counts identical.** A line-free set diff leaves 8 pairs that differ only by union member order or a "Did you mean" suggestion. **0 new errors** |
| NUL bytes in new and modified files (44 files, including untracked directories) | 0 | ✅ **0 files contain a NUL byte** (CR-1 holds) |

**AC → test spot-check (assertion strength):**

| AC | Test | Real assertion? | Notes |
|---|---|---|---|
| AC-1 | both route tests | ✅ 401 with no admin check and zero reads (report route counts 5 read mocks); 403 + warn with `userId`; 403-not-400 for a non-admin with invalid input | W-2, W-3 below |
| AC-2 | both route tests | ✅ `isAdmin` rejects → 403 with zero reads (not 500) | — |
| AC-3 | report route `it.each` + `llmUsageVerification.test.ts` | ✅ Exact messages for non-UUID, missing id, all-zero id, `SYSTEM_ADMIN_USER_ID`, malformed/+61 s/−7 d −61 s start, bad trigger; each asserts zero reads; +59 s → 200 with `startClamped: true` and start = end | Also verified live (§13.5) |
| AC-4 / AC-16 | `boundaries.static.test.ts` | ✅ Source scans: client files import server modules `import type` only (dynamic `import()`/`require` also forbidden); no `supabaseServer.from(`/`.rpc(`/`createClient(`; no hand-typed feature/component/helper literals; repository imports nothing from `business-os`; no writes | Regex-based, comment-stripped; acceptable |
| WC-8 | `boundaries.static.test.ts:110-119` | ✅ Routes contain `AdminAccessService.getInstance().isAdmin(` and no `profiles.role`, `UserProfileRepository`, `app_metadata`, `from('profiles'`; `runtime`/`dynamic` exports | Text-level only (W-3) |
| AC-13 | `llmUsageReport.test.ts` + report route happy path | ✅ Every read's account scope asserted (selected id vs exactly `platformAccountIds()`); same `end` for every windowed read; upper-case id lower-cased | Proven live (§13.4) |
| AC-14 | report route test | ✅ Audit/provider/direct-DB spies never called; serialized body has none of `request_payload`, `response_metadata`, `"metadata"`, `error_message`, `email`, `prompt`, `@example.com` (the profile mock *does* carry an email, so the reduction to `company_name` is really tested); error code kept | — |
| AC-15 | `searchForAdmin` test + list route test | ✅ Columns exactly `user_id, company_name`; `%`, `_`, `\` literal against the fake PostgREST; no `.or()`; cap 50 | W-1; DB-side escaping proven live (§13.6) |
| AC-23 | `app/api/business-os/usage/__tests__/route.test.ts` (+ snapshot) | ✅ Exact response strings for DB and 3-page fallback paths, 10 tokens-per-credit cases, allowance, 401/400, `summedBy` | **Also proven live:** the owner usage route from this branch and from the clean `56fb7dbd` archive returned **byte-identical** bodies (7,417 bytes) for the test account for `last_24h`, `last_7d`, `last_30d`, `last_90d`; a second branch run was also identical |
| AC-24 | `TokenUsageRepository.test.ts` + `tokenUsageRepository.contract.test.ts` | ✅ Per-method account filter, empty list / bad id / bad label refused before any query, select strings exclude forbidden columns; five `@ts-expect-error` lines in gate scope | — |

#### 13.3 WC-10: `token_usage` columns (read-only, before any flow)

Read from the project's PostgREST OpenAPI description plus a `select id, error_code, cost_usd, success, total_tokens from token_usage limit 1` probe (no error).

| Column | Type | Column | Type |
|---|---|---|---|
| `id` | **uuid, primary key** (JS `string`) | `session_id` | uuid |
| `created_at` | timestamptz | `input_tokens` | integer |
| `user_id` | uuid | `output_tokens` | integer |
| `feature` | character varying | `total_tokens` | integer |
| `component` | character varying | `cost_usd` | numeric (JS `number`) |
| `success` | boolean | `error_code` | character varying |

✅ **All 12 columns present.** `id` is `uuid`, so `LedgerCallRow.id: string` is correct and `String(row.id)` de-duplication and the `id DESC` tiebreak are sound. WC-10 is closed.

#### 13.4 Part 2: live flows run for the test account

| Area | Call exercised (how) | Ledger rows in window | Group (`session_id`) |
|---|---|---|---|
| chat | `POST chat-v4` route handler, "Compare my bookings this month with last month…" ×2 (turns `c04b8b8e…`, `591d5126…`) | 8: `verified_question_embedding` + `planner` ×3 per turn (plan + 2 repairs) | each turn's 4 rows share its turn id |
| chat | `POST chat-v4` "How many bookings did I have this month compared with last month…" (turn `42c18eb4…`); the planner emitted no `analyse` step, so `analyse()` was then called directly **with the same turn id** (as Layer 1 QA did) | 4: `verified_question_embedding`, `planner` ×2, `analysis` | all 4 share turn `42c18eb4…` (**planner + analysis in one group**) |
| briefing | `buildBriefingFacts` + `narrateBriefing()` directly (non-quiet day; no cache write, no dispatch) | 1 `daily_narration` | `e2786667…` = `bosBriefingGroupId(test, 2026-09-17)` |
| leads | `recommendLeadReply()` directly with a fresh `newBosGroupId()` (never `LeadAlertService`) | 1 `reply_recommendation` | `2f897386…` = the minted id (answer fell back `empty_response`: known parked bug P-2) |
| intake | `POST /api/intake/form/infer-question` route handler | 1 `question_inference` | `d3cd8194…` |
| website | `POST /api/website/enhance-testimonial` route handler | 1 `testimonial_enhance` | `5107109a…` |
| insights | Per-user replica of the `insight-detect` loop for the test account only (real `DetectorEngine`, `InsightPrioritizer`, `InsightRepository`), run id `c1c40514…` | 1 `health_summary` (2 detections updated existing insights, so no `insight_content`) | `c1c40514…` = run id |

17 rows, all `success = true`, all on the test account. The per-user path was enough for Check 4 (the insight row carries the run id), so **the all-business insight cron was not run** and no other business was charged.

#### 13.5 Report vs SQL (orchestrator `buildLlmUsageReport`, `trigger=manual`)

The report was built through the same path the route uses (`buildReportQuerySchema(receivedAt)` → `resolveReportWindow` → `buildLlmUsageReport`), with the real repositories and a real Pino logger. The oracle queries used a raw service client (not `TokenUsageRepository`), hand-typed constants, and **the report's own fixed start and end**. Server time for the report: 658 ms (844 ms before the extra chat turn); 899 ms for a 7-day window of 43 rows.

**Header:** `profileLookup: 'found'`; `startClamped: false`; `incomplete: false`; `platformAccountIdsChecked` = the all-zero UUID and the `SYSTEM_ADMIN_USER_ID` value (equal to the oracle's list); `platformAccountEnvIgnored: false`.

| Check | Expected (SQL) | Report | Result |
|---|---|---|---|
| **1. Calls** | 17 Business OS rows; 0 flagged (every pair in the catalog, no null `session_id`) | `rowsRead` 17, displayed 17, `flaggedRows` 0, all flag counts 0, `incomplete` false, status **pass**. Row order and content (newest first) identical to SQL | ✅ Pass |
| **1. Area totals** | chat 12 / 62,267 tok · website 1 / 106 · intake 1 / 254 · leads 1 / 288 · briefing 1 / 1,239 · insights 1 / 720; cost per area | Every line equal in calls, tokens (input + output) and estimated cost; total 17 calls / 64,874 tok / $0.010623; no legacy or unknown line; status `complete` | ✅ Pass |
| **2. Platform account** | 0 Business OS rows on the platform ids in the window (0 rows of **any** feature) | `count` 0, breakdown empty, status **pass** | ✅ Pass (no concurrent mis-attribution) |
| **3. Legacy labels** | (a) selected 0, platform 0; (b) helper label on selected 0; (c) helper label on platform 0, no timestamps | (a) 0 / 0; (b) 0; (c) count 0, `timestamps: []`; status **pass**; `error` null | ✅ Pass ((c) Info: no onboarding sessions in the window) |
| **4. Groups** | 8 `session_id` groups, 0 ungrouped | `groupsTotal` 8, `ungroupedTotal` 0, status **pass**. Every group's call count and tokens equal SQL. Summaries: `verified_question_embedding, planner ×3` (×2 turns); `verified_question_embedding, planner ×2, analysis`; `daily_narration`; `reply_recommendation`; `question_inference`; `testimonial_enhance`; `health_summary` (run id) | ✅ Pass |
| **5. Usage card** | `summariseUsageByCategory` over the account's rows since start (open end, `total_tokens`, all features): chat 62,267 / 12 · briefing 1,239 / 1 · leads 288 / 1 · intake 254 / 1 · website 106 / 1 · insights 720 / 1; no Business OS feature in `other` | Same six categories with equal tokens and calls; credits at 10 tokens per credit (e.g. chat 4,582); `otherFeatures` empty; `summedBy: 'database'`; `windowEnd: 'open'`; status **pass** | ✅ Pass |

**Extra live comparisons (non-zero paths), 7-day window ending 2026-09-17T17:37:14Z, `trigger=auto`:**

| Item | SQL | Report | Result |
|---|---|---|---|
| Check 1 rows / legacy / null `session_id` | 43 / 1 / 1 | `rowsRead` 43; `legacy_feature` 1, `missing_group_id` 1 (a pre-Layer-1 `health-summary-generation` row from 2026-09-16); status fail | ✅ Correct Fail |
| Check 2 platform count | 9 | `count` 9; breakdown `insight-generation / InsightRepository` 9 (sums to the count, not truncated); status fail | ✅ Correct Fail (pre-Layer-1 rows, all before this session's start) |
| Check 3 (a) platform / (b) / (c) | 9 / 0 / 59, newest 50 timestamps | 9 / 0 / count 59, 50 timestamps, `timestampsTruncated: true`; timestamps **identical, same order** | ✅ |
| Check 4 | 1 ungrouped | `ungroupedTotal` 1, `ungroupedFlagged` 1; fail | ✅ |
| Check 5 | no Business OS feature in `other` | pass | ✅ |

**Negative control (another business, read-only):** account `b509258d…` over the last 6 hours had 18 Business OS rows, 16 of them legacy (`business-os` ×15, `lead-reply` ×1, no `session_id`). The report read 18 rows, flagged `legacy_feature` 16 and `missing_group_id` 16, and returned Check 1 **fail**, Check 3 **fail** (`business-os` 15, `lead-reply` 1), Check 4 **fail**, Checks 2 and 5 pass. So the tab really catches mis-labelled calls (see E-1).

**SQL used** (read-only; run through the Supabase service client with the equivalent filters; `:start`/`:end` = the report's `window.start`/`window.end`):

```sql
-- Business OS row filter (oracle, hand-typed)
--   feature like 'business-os%' or feature in ('insight-generation','correlated-insight-generation',
--   'health-summary-generation','business-os','landing-page-generation','lead-reply')

-- Check 1 / area totals / Check 3(a) selected / Check 4
select id, created_at, feature, component, session_id, input_tokens, output_tokens, total_tokens, cost_usd, success
from token_usage
where user_id = '2f734ed5-3681-4049-880d-3de7b096bea3'
  and created_at >= :start and created_at <= :end
  and (feature like 'business-os%' or feature in (/* legacy list */))
order by created_at desc;            -- paged 1,000 at a time; grouped/summed in the driver

-- Check 2 (count) and "any feature" on the platform accounts
select count(*) from token_usage
where user_id in ('00000000-0000-0000-0000-000000000000', :system_admin_user_id)
  and created_at >= :start and created_at <= :end
  and (feature like 'business-os%' or feature in (/* legacy list */));
select created_at, user_id, feature, component from token_usage
where user_id in ('00000000-0000-0000-0000-000000000000', :system_admin_user_id)
  and created_at >= :start and created_at <= :end;

-- Check 3
select count(*) from token_usage where user_id in (/* platform ids */)
  and created_at >= :start and created_at <= :end and feature in (/* legacy list */);                 -- (a) platform
select count(*) from token_usage where user_id = :test_user_id
  and created_at >= :start and created_at <= :end and feature = 'onboarding' and component = 'simple-complete';   -- (b)
select count(*) from token_usage where user_id in (/* platform ids */)
  and created_at >= :start and created_at <= :end and feature = 'onboarding' and component = 'simple-complete';   -- (c)
select created_at from token_usage where user_id in (/* platform ids */)
  and created_at >= :start and created_at <= :end and feature = 'onboarding' and component = 'simple-complete'
order by created_at desc limit 50;                                                                    -- (c) timestamps

-- Check 5 (open end, all features, then summariseUsageByCategory in the driver)
select feature, total_tokens from token_usage
where user_id = :test_user_id and created_at >= :start
order by created_at;
```

#### 13.6 Edge cases and business list (live, through the schema, orchestrator and repository)

| Case | Expected | Result |
|---|---|---|
| All-zero UUID as `accountId` | rejected with the platform message | ✅ "This is the platform account; its Business OS rows are shown in Check 2" |
| `SYSTEM_ADMIN_USER_ID` (upper-cased) as `accountId` | rejected | ✅ same message |
| Start 7 d + 61 s ago | rejected | ✅ "Start time is more than 7 days ago; the maximum window is 7 days" |
| Start 7 d + 59 s ago | accepted | ✅ |
| Start 30 s in the future | accepted and clamped | ✅ `startClamped: true`, start = end = receipt time |
| Start 61 s in the future | rejected | ✅ "Start time is in the future" |
| No `trigger` | defaults to `manual` | ✅ |
| `trigger=auto` | `profileLookup: 'skipped'` | ✅ `skipped`, `companyName: null`, all five statuses still computed (pass) |
| Search by a 10-character substring of the test business's name | returns it | ✅ 1 result, the test account |
| Search `%` | literal: no name contains `%` → 0 (unescaped it would match all 4) | ✅ 0, no error |
| Search `_` | literal → 0 | ✅ 0, no error |
| Search `<2 chars>_<5 chars>` built from the name (would match if `_` were a wildcard) | no match | ✅ test account **not** returned: `_` is literal in the database |
| Search `\` | literal, no error | ✅ 0, no error |
| Search `*` | documented PostgREST wildcard (M-4) | ⚠️ 4 (all) — as documented, not a defect |
| No search | ≤ 50, sorted by name | ✅ 4, sorted |
| Response data | only `user_id`, `company_name`; no email | ✅ keys seen: `user_id`, `company_name`; no `@` anywhere |
| `platformAccountIds()` / `isPlatformAccountEnvIgnored()` (the list route's top-level fields) | two ids / `false` | ✅ `[all-zero, SYSTEM_ADMIN_USER_ID]` / `false` |

**Logs (Pino, run with `NODE_ENV=production`, i.e. info level as in production):** the manual report wrote exactly two info lines (`BusinessProfileRepository` "Finding business profile by user ID" / "Business profile found", ids only); the auto report wrote **none**. This confirms WC-6 live: auto-refresh can't flood info logs. **No business name appeared in any log line.** The route's own "LLM usage report served" line (info for manual, debug for auto, with statuses) was not exercised live because the route wasn't called (no admin session); it is covered by the report route test (`logs a manual refresh at info…`, `logs an automatic refresh at debug…`).

#### 13.7 Issues Found

**Bugs in Layer 1.1 (must fix before commit):** none.

**Test-strength notes (Low, non-blocking):**

- **W-1:** `app/api/admin/business-os/llm-usage/businesses/__tests__/route.test.ts:115` asserts "no email" against a `searchForAdmin` mock that never returns one. The real guard is the repository column test plus the route's explicit `{ userId, companyName }` mapping (`businesses/route.ts:95`). Now also proven live (§13.6).
- **W-2:** the "403, not 400, for a non-admin with invalid input" cases (report route test `:202-206`, list route test `:82-86`) assert the status only, not zero reads. The other 403 cases do assert zero reads, so the risk is low.
- **W-3:** the AC-1 `profiles.role` case is tautological on its own (`isAdmin` mocked false). Its strength comes from the WC-8 text scan, which forbids `profiles.role`, `app_metadata`, `UserProfileRepository` and `from('profiles'` but wouldn't catch a role read through another repository. Acceptable with SA's review.

**Environment observations (for TL to route; not Layer 1.1 defects):**

- **E-1: pre-Layer-1 code is writing into this Supabase project.** Account `b509258d…` wrote `business-os / daily-briefing` ×15 and `lead-reply / LeadReplyRecommender` ×1, with no `session_id`, on 2026-09-17 between 14:28Z and 16:22Z. This branch no longer contains those labels. The main checkout is at `5cdc5521` (`feature/business-os-purge-slice-2`), which does **not** include Layer 1 (`56fb7dbd`), so a dev server running from it is the likely writer. Effects: (1) the tab correctly reports those rows as Fail (negative control, §13.5); (2) during the T39 smoke, a dev server on a pre-Layer-1 branch will make Checks 1, 3 and 4 fail for the business it serves, and could make Check 2 fail for pre-Layer-1 insight rows. **Run T39 against a server built from this branch and use "Start now".**
- **E-2 (known, parked):** the lead reply recommender fell back with `empty_response` again (Layer 1 P-2), and the repeated chat question was again not served from the plan cache (Layer 1 P-3), so no `BizQLPlanCache` row appeared live. The `BizQLPlanCache` exemption is covered by unit tests only.

#### 13.8 Handed off and skipped

| Item | Status / reason |
|---|---|
| **T39 browser smoke** (non-admin → "Admins only"; admin: search incl. `%`/`_`, "My account", pasted id, Refresh, 10 s auto-refresh with the browser tab hidden and shown, auto-refresh stopping on input change, Debug Logs behaviour, owner card renders) | **Handed off to TL** with the user signed in as an admin. Needs an admin browser session, which QA can't get without forging auth. Components and hook are covered by jsdom tests; the server side is verified live above. See E-1 |
| Admin routes live (401/403/400 ordering, served log level by trigger) | Not called live (no admin session; auth not forged). Covered by the two route test suites; the report and list payloads were verified live through the orchestrator and repository they call |
| All-business `insight-detect` cron | Not run: the per-user replica produced a run-id-grouped insight row, which is all Check 4 needs. No other business was charged |
| Full website generation, landing page, intake form generation, public enquiry form, `field_regenerate` | Out of this run's minimal set (one call per area as instructed). Their attribution was verified live in Layer 1 QA. Website and intake were each covered by one route-level call here. The enquiry form path would notify the owner, so it was not used |
| `BizQLPlanCache` / `IntentParser` rows live | Not produced (cache miss, E-2; chat v1 not used). Unit-tested exemptions |
| `incomplete` (5,000-row ceiling) live | Not reachable with this data (busiest 7-day window: 43 rows). Unit and repository tests cover it |

**Data left on the test account (test data only):** 17 `token_usage` rows (about 64.9k tokens, about $0.011 estimated), 2 existing insights updated plus the health summary refreshed (run `c1c40514…`), and whatever chat-v4 stores per turn. There was no briefing cache write, no intake form write and no testimonial persistence. **No emails, WhatsApp, SMS or notifications were sent. No payments, purge or deletes. No other business was written to.**

#### 13.9 Final Status

- [x] All acceptance criteria that can be verified without an admin browser session pass: ready for commit once TL's T39 browser smoke passes (and with user approval)
- [ ] Issues found: Dev must address before commit

**Verdict: PASS WITH ISSUES.** No defects found in Layer 1.1. Part 1: Jest 111/1,761 green; the scoped gate has 0 new errors and an unchanged baseline; full `tsc` matches `main` per file; 0 NUL bytes; the security ACs are backed by real assertions. Part 2: WC-10 is closed (all columns present, `id` is uuid). Checks 1 to 5 and the area totals match independent SQL exactly for the test session: Pass on all five, with 0 platform-account rows and no concurrent mis-attribution. The non-zero and Fail paths (platform count, helper-label timestamps with truncation, legacy and ungrouped flags) also match SQL on a 7-day window and on a negative-control account. The owner usage card is byte-identical to `main` live. All edge cases behave as specified, and `%`/`_`/`\` are literal in the database. The "issues" are three low test-strength notes (W-1 to W-3), two environment observations (E-1 stale pre-Layer-1 writer, E-2 known parked bugs) and the T39 browser smoke, which is handed off.

---

## 14. Commit Info

*(RM populates this section.)*

---

## Change History

| Date | Change | Details |
|------|--------|---------|
| 2026-09-17 | Created (Planning) | Dev workplan for Layer 1.1 from the SA-approved requirement (24 FRs / 24 ACs). Code-reality check at `56fb7dbd`: all cited references verified; 14 findings (M-1 to M-14), including no end bound on `business_os_usage_summary` (M-1), `ConfigRepository`'s browser-client default (M-2), a non-UUID `SYSTEM_ADMIN_USER_ID` in `.in()` (M-5), and an existing jsdom component-test pattern (M-8). Design: admin routes under `app/api/admin/business-os/llm-usage`, Zod schemas, runtime-free response types, `TokenUsageRepository` signatures and guards, check algorithms with one exemption rule and Incomplete precedence, `usageSummary.ts` extraction with a before/after characterization test, client reducer + hook. Typecheck gate: measured 96 files / 0 new; predicted about +18 to +22 new files only, repository and barrel out of scope, baseline unchanged. 15 steps / 41 tasks. 13 SA questions, 1 user question (Q-14) |
| 2026-09-17 | SA workplan review — approved with changes | SA confirmed the BA applied RC-1 to RC-14 and aligned the requirement's wording for Q-1/Q-2/Q-3/Q-5/Q-12 (logged in the requirement). Rulings: Q-1 Check 5 open end; Q-2 UUID-only env id and case-insensitive `isPlatformAccount`; Q-3 `platformAccountIds` in the business list; Q-4 `*` accepted; Q-5a name lookup (manual only, WC-6); Q-5b Info; Q-6 Fail with the part named; Q-7 chat-only exemptions; Q-8 5,000 → Incomplete; Q-9 types in the repository file; Q-10 inline gate; Q-11 dedicated contract test; Q-12 per TL ruling (fix the stale tab text only, F-5); Q-13 auto off on failure; M-2 approved; M-8 confirmed (SA's earlier note corrected). Type-check gate impact accepted. WC-1 to WC-10 to apply during implementation; Q-14 constraints listed for the user |
| 2026-09-17 | Implementation — Code Complete | S0 to S14 implemented with WC-1 to WC-10. Jest touched areas 111 suites / 1,761 passed (was 97 / 1,493); `typecheck:bos-llm` 119 files, 0 new, baseline unchanged; full `tsc` 2,045 (unchanged). Scope +23 new files only. Deviations D1 to D12 and SA focus points in §11.4 and §11.5; T39 local smoke moved to QA |
| 2026-09-17 | SA code review — approved with one required fix | SA re-ran Jest (111 suites / 1,761 passed), `typecheck:bos-llm` (119 files, 0 new, baseline unchanged) and full `tsc` (2,045, none in touched files). SA independently proved AC-23 by running the unchanged characterization test and snapshot against the original route (19/19, plus a mutation check), and proved the D4 re-arm fix by mutation. Required: CR-1, a raw NUL byte in `llmUsageVerification.ts:316` (hides the module from code search). Optional: O-1 to O-6. Security review: no findings. All WC-1 to WC-9 implemented; WC-10 partial but fail-safe (QA probe is an entry condition). D1–D12 accepted, D9 with new follow-up F-6 (`readAllowanceCredits` to `ConfigRepository`). `fakePostgrest` accepted as a test pattern with reuse conditions |
| 2026-09-17 | CR-1 applied (TL) | `llmUsageVerification.ts:316`: the raw NUL byte in the Check 2 breakdown key replaced with `JSON.stringify([feature, row.component ?? null])`. File now has 0 NUL bytes (no other new/modified file has any); `lib/business-os/usage` Jest 6 suites / 120 pass; `typecheck:bos-llm` re-run. Ready for QA |
| 2026-09-17 | QA — PASS WITH ISSUES | §13 QA Report. Part 1: Jest 111 suites / 1,761 passed; `typecheck:bos-llm` 119 files, 0 new, baseline blob unchanged; full `tsc` 2,045, per-file identical to a clean `56fb7dbd` archive; 0 NUL bytes in 44 new/modified files; AC→test spot-check (W-1 to W-3, Low). WC-10 closed live: all 12 `token_usage` columns present, `id` uuid PK. Part 2 on test account `2f734ed5…`: 17 real LLM calls across all six areas (chat planner + analysis in one turn group, briefing, leads, intake, website, per-user insight run; no all-business cron). The orchestrator report matched independent SQL for Checks 1–5 and area totals (all Pass, Check 2 count 0); non-zero/Fail paths matched on a 7-day window and a negative-control account; owner usage route byte-identical to `main` for 4 ranges; all edge cases and literal `%`/`_`/`\` search verified; auto trigger skips the profile lookup and writes no info logs. No bugs. E-1: a pre-Layer-1 dev server is writing legacy labels into this project. T39 browser smoke handed off to TL. No external messages sent |
