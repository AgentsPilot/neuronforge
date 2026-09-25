# Workplan: Admin Module BOS Reorganisation, Slice 2 (a BOS lens on the shared screens)

> **Last Updated**: 2026-09-25

**Developer:** Dev
**Requirement:** [ADMIN_MODULE_BOS_REORGANISATION_REQUIREMENT.md](/docs/requirements/ADMIN_MODULE_BOS_REORGANISATION_REQUIREMENT.md) §7 Slice 2 (2a, 2b, 2c), §9, §12, assumptions A-4 and A-5, OQ-3 (answered: one login = one business)
**Branch:** `feature/admin-bos-step2` (worktree `neuronforge-admin-bos-reorg`, based on latest `main` plus requirement commit `ddcbb43d`)
**Delivery:** one PR covering 2a, 2b and 2c (user's instruction)
**Process:** full cycle, not the UI-only short path. The slice adds cross-account admin reads and changes three `/api/admin/*` routes. Order: Dev workplan, then SA workplan review, then Dev implements, then SA code review, then QA, then user approval, then RM.
**Status:** Code Complete (2026-09-25). Committed locally on `feature/admin-bos-step2` as four ordered commits (2c, 2a, 2b, docs); not pushed, no PR. Awaiting SA code review and QA

## Overview

Slice 2 gives three existing admin screens a Business OS view without building new pages. **2a:** AI cost & usage gets a "Business OS only" preset, built on the platform's own definition of a Business OS ledger row (`bosRowFilter()`). **2b:** each row on the Users screen gets a Business OS panel: business name and vertical, the entitlement snapshot, 30-day AI spend, and recent AI failures linked to the audit trail. **2c:** the audit trail gets a one-click "BOS AI failures" view, and its Action Type dropdown lists only Business OS and shared events. That dropdown is driven by an explicit, test-enforced classification of every audit event. This document plans the work, records what was verified in the code, and lists the forks that SA decides and the questions only the user can answer.

---

## Table of Contents

1. [Verification Log (what the code actually says)](#1-verification-log-what-the-code-actually-says)
2. [Analysis Summary](#2-analysis-summary)
3. [Implementation Approach](#3-implementation-approach)
4. [Data Sources and Exact Reads](#4-data-sources-and-exact-reads)
5. [Files to Create / Modify](#5-files-to-create--modify)
6. [Test Plan](#6-test-plan)
7. [Risks](#7-risks)
8. [Technical Forks for SA](#8-technical-forks-for-sa)
9. [Questions for the User](#9-questions-for-the-user)
10. [Non-Compliant Files (CLAUDE.md rule 3)](#10-non-compliant-files-claudemd-rule-3)
11. [Task List](#11-task-list)
12. [Implementation Record (Dev, 2026-09-25)](#12-implementation-record-dev-2026-09-25)
13. [Open Issues (PARKED)](#13-open-issues-parked)
14. [SA Review Notes](#sa-review-notes)
15. [QA Testing Report](#qa-testing-report)
16. [Commit Info](#commit-info)
17. [Change History](#change-history)

---

## 1. Verification Log (what the code actually says)

Measured on `feature/admin-bos-step2` @ `ddcbb43d`. The live schema has **not** been queried yet. `npm run schema:check` is task T0 and must pass before T7 is written (see R-4).

| # | Finding | Evidence | Effect on the plan |
|---|---|---|---|
| V-1 | The Business OS row definition is `feature LIKE 'business-os%'` (no trailing hyphen) **OR** `feature IN` five legacy values (`insight-generation`, `correlated-insight-generation`, `health-summary-generation`, `landing-page-generation`, `lead-reply`) | `lib/business-os/llm/callCatalog.ts:100-141` (`BOS_LEGACY_FEATURES`, `BOS_FEATURE_FILTER_PREFIX`, `bosRowFilter()`); B0 workplan V-6 | 2a uses `bosRowFilter()` as data. No `business-os-%` literal is written anywhere |
| V-2 | The PostgREST expression for that filter is built in exactly one place: `TokenUsageRepository.orExpression`, which is **private static**, and its guard is `assertFilter` | `lib/repositories/TokenUsageRepository.ts:180-240` | A second copy would drift. It is promoted to a module-level export (T6). The class keeps using it |
| V-3 | **The "existing BOS LLM usage report" is per account and capped at 7 days.** `GET /api/admin/business-os/llm-usage` requires `accountId`. `MAX_WINDOW_MS = 7 days`. Totals come from `computeAreaTotals(classifyCallRow(rows))`: tokens = input + output, cost = `cost_usd` | `app/api/admin/business-os/llm-usage/route.ts`; `lib/business-os/usage/llmUsageVerification.ts:52-63, 186-243, 550-580` | "Totals match" can only be checked per account, over a window of 7 days or less. The cross-account figure is checked as the sum of per-account reports (§6.4) |
| V-4 | **Cost Analytics silently truncates at 1,000 rows.** `/api/admin/token-usage/drill-down` runs `select('*')` over `token_usage` with no `.range()` and no count, so PostgREST's 1,000-row cap applies. The same is true of the previous-period comparison read | `app/api/admin/token-usage/drill-down/route.ts:211-250, 340-363`; the 1,000-row cap is recorded in `docs/workplans/business-os-business-data-purge.md` and `docs/investigations/LLM_CREDIT_AND_AUDIT_TRACKING.md:461` | The 2a acceptance criterion ("totals match") cannot hold beyond 1,000 rows. The rewritten read pages to a ceiling and reports `incomplete` (F-2) |
| V-5 | **The comparison read ignores four filters.** It applies provider, model, activity, user and agent, but not `feature`, `component`, `request_type` or `endpoint`. Filter by feature and "vs previous period" compares a feature with *everything* | `drill-down/route.ts:340-363` | A scope added to the main read only would repeat the bug. One filter object now feeds both reads, which fixes the four as a side effect (F-9, a behaviour change) |
| V-6 | The drill-down route has **no Zod validation**, reads through an **inline service-role client** (not a repository), selects `*` (payload columns included), and already calls `requireAdmin` first. It has no `console.*` and no `error.message` leak | `drill-down/route.ts:9-12, 95-150` | "Changed route" rules apply: Zod added (T8), and the reads this slice changes move to a repository (F-1) |
| V-7 | The admin audit-trail route has Zod (`AdminAuditTrailQuerySchema`) but **no account filter**, and it is one of the **7 inline admin checks** (R1 and R2 parked lists, caps 7 and 7) | `app/api/admin/audit-trail/route.ts:24-44`; `lib/audit/requestSchemas.ts:145-154`; `lib/admin/__tests__/admin-authz-surface.guard.test.ts:251-273, 373-381` | Linking "this business's failures" needs `user_id`. Changing the route means converting it to `requireAdmin`, which removes two parked entries and lowers both caps 7 → 6 in the same commit (ratchet) |
| V-8 | `AUDIT_EVENTS` has **157** events, and `EVENT_METADATA` covers **122** of them | `lib/audit/events.ts:20-278, 286-960` | A classification stored on `EventMetadata` could not cover 35 events without adding metadata for them. That would change the severity those events are written with (the WC-12 hazard). A separate exhaustive map is proposed instead (F-4) |
| V-9 | `filterOptions.ts` documents, as a design decision, that "NOTHING IS EXCLUDED, and no exclusion mechanism exists" | `lib/audit/filterOptions.ts:22-30` | 2c(ii) reverses that on the user's instruction (requirement change history, 2026-09-25). The header is rewritten to say why, and SA signs the reversal (R-5) |
| V-10 | Proposed classification of the 157 events: **15 BOS, 58 shared, 84 AgentsPilot** | Prefix count over `AUDIT_EVENTS`; full list in §3.3 | About 54% of the dropdown disappears. Borderline items are in Q-2 |
| V-11 | `AUDIT_ENTITY_TYPES` has **26** values. Only **3** are AgentsPilot-only: `agent`, `shared_agent`, `execution` | `lib/audit/types.ts:21-75` | 2c(iii): recommend no change (F-8) |
| V-12 | BOS AI audit entries: `action` is `BUSINESS_AI_ACTION_FAILED` or `_COMPLETED`, `entity_type = 'ai_action'`, `entity_id = groupId`, `user_id = accountId`. `details` is built from a fixed list of fields (area, areas, actionType, groupId, trigger, callCount, failedCallCount, tokens, estimatedCostUsd, callNames, models, outcome, errorCode, correlationId) | `lib/business-os/llm/aiActionAudit.ts:180-217` | The failures list reads `details` and projects a smaller allow-list. No prompt or message text exists in these rows |
| V-13 | `audit_trail` columns in use: `id, user_id, actor_id, action, entity_type, entity_id, resource_name, changes, details, ip_address, user_agent, session_id, severity, compliance_flags, created_at`. Index `(user_id, created_at DESC)` exists | `lib/repositories/AuditTrailRepository.ts:27-31`; `supabase/SQL Scripts/create_audit_trail.sql:39-47` | The per-account failures read is indexed |
| V-14 | `business_profiles` has `user_id`, `company_name`, `vertical` (NOT NULL), `sub_vertical` | `supabase/migrations/20260721_create_business_profiles.sql:10-14`; `BusinessProfileRepository.ts:124-135` | 2b reads exactly these four columns. `findByUserId` selects `*` (owner text included), so a narrow method is added |
| V-15 | `token_usage` has index `(user_id, created_at DESC)` and **no index on `created_at` alone**. Its DDL is not in the repo | `supabase/migrations/20260929_usage_summary.sql:98-99`; B0 V-3, V-16 | The 2b per-account read is indexed. The 2a cross-account read is a sequential scan today, **as it already is**. The explicit column list must be verified live (T0) |
| V-16 | "Is this a Business OS account?" has one implementation: `isBusinessOsTenant` (profile row, else any onboarding message). The entitlements GET returns **404 `not_a_business_os_account`** for AgentsPilot-only ids | `lib/business-os/entitlements/adminOps.ts:270-282`; `app/api/admin/business-os/entitlements/accounts/[accountId]/route.ts:60-100` | 2b calls the same function. It does not re-implement the rule |
| V-17 | The entitlement snapshot is already rendered by `AccountLookup` (tier, cohort, expiries, state, basis, matrix version, anomaly, and a capability table with `display` and `decidedBy`). A contract test pins its error copy against every error the route returns | `app/admin/business-os-tiers/components/AccountLookup.tsx`; `__tests__/accountLookup.contract.test.tsx:198` | 2b reuses that rendering by extracting it (F-6). It does not write a second one |
| V-18 | `TokenUsageRepository`'s contract test is **already red on `main`**: `summariseFeatureAllAccountsInWindow` is not pinned. This is a user-parked finding (2026-09-24) | `lib/business-os/usage/__tests__/tokenUsageRepository.contract.test.ts:84`, run on this branch | This plan adds **no** method to `TokenUsageRepository`, so it neither fixes nor worsens that test (F-1) |
| V-19 | `typecheck:bos-llm` brings into scope any file that imports `callCatalog`, and any file importing such a file. Its CI job is a required check on `main` | `scripts/typecheck-bos-llm.ts:46-60` | The drill-down route and the new summary route enter the scoped type check (R-1) |
| V-20 | `/admin` has no `useSearchParams` today | grep over `app/admin` | Deep links (`?scope=bos`, `?user_id=`) introduce it on two pages. `next build` must stay green (R-7) |
| V-21 | The Plans & entitlements render test pins a link named "Users" | `app/admin/business-os-tiers/__tests__/page.render.test.tsx:250` | A rename touches that copy and its test (T16) |
| V-22 | `app/api/admin/users/route.ts` has 7 `console.*` calls and 2 `error.message` leaks (lines 56, 147). `app/api/admin/users/[id]/stats/route.ts` has 1 `console.*` call and 1 leak (line 179) | grep | Not touched under the recommended plan (§10) |

---

## 2. Analysis Summary

| Part | Screen | Touches | New data read? |
|---|---|---|---|
| 2a | `/admin/analytics` (AI cost & usage) | Page (toggle and banners), drill-down route (Zod, scope, repository reads), new admin analytics repository | No new table. The same `token_usage` read, with an explicit column list and paging |
| 2b | `/admin/users` | Page (panel first, agent facts collapsed), new BOS panel component, extracted entitlement component, new summary route, two narrow repository methods | Yes, cross-account for one selected account: `business_profiles` (4 columns), `token_usage` (per account, indexed), `audit_trail` (per account, indexed) |
| 2c | `/admin/audit-trail` | New audience classification module, `filterOptions` option, page (preset button, deep link, filtered dropdown), audit route (`user_id` filter, `requireAdmin`) | One new filter (`user_id`) on an existing read |

No migration. No change to the provider factory, to any LLM call, or to owner-facing screens.

---

## 3. Implementation Approach

### 3.1 2a: "Business OS only" on AI cost & usage

1. **One definition, passed as data.** The route imports `bosRowFilter()` from the call catalogue. The request carries only `scope=bos|all` (Zod enum). The filter is never built from request input.
2. **The expression is built once.** `TokenUsageRepository.orExpression` and its guard become a module-level export, `buildFeatureFilterOrExpression(filter)`, which throws `TokenUsageGuardError` on a bad prefix or value. The class calls the export. No prototype method changes, so the contract test is unaffected (V-18).
3. **The reads this slice changes move to a repository (F-1).** A new `AdminTokenUsageAnalyticsRepository` has one method, `listRowsAllAccountsInWindow(window, filters, { pageSize, ceiling })`:
   - It is cross-account **by name**, following the convention in `TokenUsageRepository`'s header ("all accounts is reached by calling a differently NAMED method").
   - It selects an explicit column allow-list (§4.1), never `*`.
   - It pages with `created_at DESC, id DESC` and de-duplicates by `id`, as `listCallsInWindow` does.
   - It returns `reachedCeiling`.
   - `filters` is a typed object (provider, model, activity, request_type, feature, component, endpoint, user or `system`, agent or `no-agent`, `executionOnly`, and an optional `featureFilter: TokenUsageFeatureFilter`).
4. **Both drill-down reads use it.** The main read and the previous-period read pass the **same** filter object, which fixes V-5. The execution detail path (`getExecutionCalls`) and the label lookups (profiles, agents, `auth.admin.listUsers`) keep their existing inline reads. Moving them is out of scope and recorded as debt.
5. **Honest totals.** The response gains `incomplete: boolean` (the main read reached its ceiling) and `scope`. The page shows a banner when `incomplete` is true: "More than N calls in this window; totals are a lower bound. Narrow the window." Ceiling: see F-2.
6. **Page.** A "Business OS only" toggle sits beside the period selector. When it is on, the page sends `scope=bos`, shows a chip reading "Business OS only (includes legacy-tagged rows)", and labels cost as "USD, estimated from the pricing table". "Clear all" leaves the scope alone, because it is a lens, not a drill filter. The page reads `?scope=bos` and `?user=<uuid>` on first load, so the 2b panel and a later Health page can link to it.
7. **Zod on the drill-down query.** `breakdownBy` and `category` are enums matching exactly what the page sends. Free-text dimensions use a bounded identifier pattern (max 200 characters). `user` is a UUID or `system`, `agent` is a UUID or `no-agent`, `execution` is a UUID or `single-<uuid>`, `period` is an integer from 1 to 365, `dateFrom` and `dateTo` are ISO datetimes, and `scope` is an enum. An invalid query returns 400, with details in development only.

### 3.2 2b: Business OS panel on Users

1. **Entitlement snapshot: reuse the existing API unchanged.** The panel calls `GET /api/admin/business-os/entitlements/accounts/[id]` directly from the browser. The rendering that `AccountLookup` already does moves into `app/admin/business-os-tiers/components/EntitlementSnapshot.tsx`, along with its `ERROR_COPY`, and `AccountLookup` becomes form plus `<EntitlementSnapshot>`. The Users panel renders the same component, which makes "exactly as the entitlements API returns it, including which layer decided" true by construction (F-6).
2. **Everything else comes from one new admin route:** `GET /api/admin/business-os/accounts/[accountId]/summary`. It is built to the `new-api-route` skill (§4.2), in this order:
   - `requireAdmin` is the first statement.
   - Zod checks `accountId` (UUID).
   - `isBusinessOsTenant`, the same function the entitlements route uses: `null` returns 500 `tenant_check_failed`, `false` returns 404 `not_a_business_os_account`.
   - A platform account returns 409 `platform_account` (its rows are not one business's spend).
   - Then three reads run in parallel, and each fails independently: `business` (name, vertical, sub-vertical), `aiSpend30d` (per-area lines, total, `incomplete`, `currency: 'USD'`), and `recentAiFailures` (the last 10 within 30 days, projected to an allow-list). One failed read returns `{ status: 'error' }` for that block and a 200 overall, so a spend outage does not hide the failures list.
3. **Spend uses the report's own functions:** `tokenUsageRepository.listCallsInWindow(accountId, window, bosRowFilter(), { pageSize: LLM_USAGE_LIMITS.PAGE_SIZE, ceiling: LLM_USAGE_LIMITS.READ_CEILING })`, then `classifyCallRow`, then `computeAreaTotals`. Same calls, same arithmetic, so the panel equals the report for any window of 7 days or less by construction.
4. **Money:** AI cost is USD by definition of the pricing table. It is labelled "USD (estimated)". It is never converted, never summed with any other currency, and never read from `business_profiles.currency` or `LanguageContext.currencyCode`. A source guard pins this (§6.3).
5. **No owner text:**
   - The profile read selects four columns.
   - The failures read selects `id, created_at, entity_id, details`.
   - The route projects `details` to `{ area, actionType, trigger, errorCode, callCount, failedCallCount }`.
   - A test injects extra keys, `prompt` among them, and asserts they never reach the response.
6. **Layout of the expanded row:**
   - The **Business OS** panel comes first: business, plan, spend and failures.
   - It is followed by the existing login, subscription, plugins and audit blocks, unchanged.
   - Token consumption is relabelled "AI spend, all products (30 days)", because it covers every feature.
   - **Agents** and **agent executions** move into a disclosure, "AgentsPilot details", closed by default. The code stays and nothing is deleted.
   - For an AgentsPilot-only login, the panel shows the existing copy for `not_a_business_os_account` and skips spend and failures.
7. **Links:**
   - "View in audit trail" goes to `/admin/audit-trail?action=BUSINESS_AI_ACTION_FAILED&user_id=<id>`.
   - Each failure row adds `&search=<groupId>`, which matches `entity_id`, a field the route already searches.
   - "Open in AI cost & usage" goes to `/admin/analytics?scope=bos&user=<id>`.
   - The event value comes from `AUDIT_EVENTS`, never a string literal.
8. **Rename:** see Q-1. Nothing is renamed until the user answers.

### 3.3 2c: audit trail

**(i) One-click "BOS AI failures".** A button above the filters sets `action = AUDIT_EVENTS.BUSINESS_AI_ACTION_FAILED` and resets page to 1. On first load, the page also reads `action`, `entity_type`, `severity`, `user_id`, `search`, `date_from` and `date_to` from the URL, so the 2b links land on a filtered view. When `user_id` is present, a dismissible chip shows "Account <short id>". The filter state gains `userId`, and "Clear filters" resets it.

**Route change:** `AdminAuditTrailQuerySchema` gains `user_id: optional uuid`, and the route adds `.eq('user_id', user_id)` when it is set. Because the route changes, its inline `AdminAccessService` check is replaced by `requireAdmin` as the first statement. This removes the R1 and R2 parked entries and lowers both caps from 7 to 6 in the same commit. The existing `auditAdminGate.test.ts` already mocks both `getUser` and `AdminAccessService`, and `requireAdmin` returns the same 401 and 403 bodies, so the test carries over unchanged (V-7).

**(ii) Business OS-only Action Type dropdown, through an explicit classification.**

- **New module `lib/audit/eventAudience.ts`.** It is pure and safe in the client bundle:
  - `type AuditAudience = 'bos' | 'shared' | 'agentspilot'`.
  - `AUDIT_EVENT_AUDIENCE`: one entry **per event**, written `[AUDIT_EVENTS.X]: '…'`, and `satisfies Record<AuditEvent, AuditAudience>`.
  - `OPERATOR_AUDIENCES = ['bos', 'shared']`.
  - `isVisibleTo(event, audiences)`.
- **Per event, not per prefix (F-4).** A prefix rule such as `USER_ → shared` would silently classify a new `USER_MEMORY_*` (AgentsPilot) event as shared. That is the "disappears (or appears) without a decision" defect the requirement forbids.
- **An unclassified event stays visible.** `isVisibleTo` returns `true` for an event with no entry, so a newly registered event can never vanish from the dropdown. The exhaustiveness test fails CI-locally until someone classifies it.
- **`buildActionFilterGroups(options?: { audiences?: readonly AuditAudience[] })`.** With no argument it behaves exactly as it does today, so every existing test holds. The page calls it with `{ audiences: OPERATOR_AUDIENCES }`.
- **Nothing is removed from the catalogue, and the route filters nothing by audience.** "All Actions" still sends no `action` filter and returns every row.
- **A hidden event can still be selected by URL.** If `?action=` names a hidden event, the page renders it as one extra, labelled option ("<label> (AgentsPilot, hidden from list)"), so the select never shows blank beside filtered results.
- **One cosmetic rule is added to `GROUP_RULES`: `BOS_ENTITLEMENT_` → "Business OS entitlements".** It is also pinned after "Business OS". Without it those 8 events fall back to a group called "Bos".

**Proposed classification** (V-10; borderline items in Q-2):

| Audience | Count | Events |
|---|---|---|
| **bos** | 15 | `BUSINESS_DATA_PURGED`, `BUSINESS_DATA_PURGE_BLOCKED`, `BUSINESS_AI_ACTION_COMPLETED`, `BUSINESS_AI_ACTION_FAILED`, `BOS_ENTITLEMENT_*` (8), `PAYMENT_REFUNDED`, `PAYMENT_BLOCK_EXECUTED`, `INVOICE_MARKED_PAID` |
| **shared** | 58 | `USER_CREATED`, `USER_LOGIN`, `USER_LOGOUT`, `USER_LOGIN_FAILED`, `USER_PASSWORD_CHANGED`, `USER_EMAIL_CHANGED`, `USER_TERMINATED`, `USER_SUSPENDED`, `USER_REACTIVATED`, `USER_ONBOARDING_COMPLETED`, `USER_ONBOARDING_FAILED`, `PROFILE_*` (2), `SETTINGS_*` (9), `PLUGIN_*` (8), `DATA_*` and `USER_DATA_EXPORTED` (5), `CONSENT_*` (2), `ADMIN_*` (3), `SYSTEM_*` (3), `AI_PRICING_*` (5), `SUBSCRIPTION_CHECKOUT_INITIATED`, `BOOST_PACK_CHECKOUT_INITIATED`, `SUBSCRIPTION_CANCELED`, `SUBSCRIPTION_REACTIVATED`, `CUSTOMER_PORTAL_ACCESSED`, `FREE_TIER_ALLOCATED`, `SECURITY_*` (4) |
| **agentspilot** | 84 | `AGENT_*` (incl. generation, 19 with `EFFORT_ESTIMATE_GENERATED`), `AGENTKIT_*` (11), `MODEL_ROUTING_DECISION`, `AIS_*` (8), `REWARD_CONFIG_*` (4), `ROUTING_CONFIG_UPDATED`, `MEMORY_*` (12), `USER_MEMORY_*` (4), `PILOT_*` (16, incl. routing), `WORKFLOW_*` (2), `APPROVAL_*` (6) |

**Rule for borderline items: when in doubt, shared.** Hiding is the costlier mistake in an investigation tool. A wrongly shown event costs one line in a dropdown, while a wrongly hidden one can be missed.

**(iii) Entity Type dropdown: recommend no change (F-8).** Only 3 of 26 types are AgentsPilot-only (V-11), against 84 of 157 events. Hiding 3 entries does not justify a second classification to keep up to date. The recommendation is recorded here, and SA decides.

---

## 4. Data Sources and Exact Reads

### 4.1 2a: `AdminTokenUsageAnalyticsRepository.listRowsAllAccountsInWindow`

**Table:** `token_usage`, service role. The read is cross-account by design and admin-gated by the calling route.

**Columns (allow-list, verified live in T0):** `id, created_at, user_id, agent_id, execution_id, provider, model_name, activity_type, activity_name, category, request_type, feature, component, endpoint, input_tokens, output_tokens, cost_usd`. These are exactly the fields the aggregation reads (grep over `drill-down/route.ts:196-836`). Request payloads, response payloads, metadata and error text are no longer read.

```typescript
supabase.from('token_usage')
  .select(ADMIN_ANALYTICS_COLUMNS)
  .gte('created_at', window.start).lte('created_at', window.end)
  // each present dimension: .eq('provider', …) .eq('model_name', …) .eq('activity_type', …)
  //   .eq('request_type', …) .eq('feature', …) .eq('component', …) .eq('endpoint', …)
  // user: 'system' → .is('user_id', null), else .eq('user_id', uuid)
  // agent: 'no-agent' → .is('agent_id', null), else .eq('agent_id', uuid)
  // executionOnly → .not('execution_id', 'is', null)
  // featureFilter → .or(buildFeatureFilterOrExpression(bosRowFilter()))
  //   = "feature.like.business-os*,feature.in.(\"insight-generation\",…,\"lead-reply\")"
  .order('created_at', { ascending: false }).order('id', { ascending: false })
  .range(from, to)   // paged to the ceiling
```

**Previous-period read:** the same method, the same filters, and the previous window.

**Check for "totals match":** for account X and a window W of 7 days or less, `drill-down?scope=bos&user=X&dateFrom=W.start&dateTo=W.end` totals `{calls, tokens, cost}` must equal `llm-usage?accountId=X&since=W.start` → `areaTotals.total`. Both read `cost_usd`, both count tokens as input + output, and both use `gte`/`lte` on `created_at`.

### 4.2 2b: `GET /api/admin/business-os/accounts/[accountId]/summary`

| Block | Call | Exact read |
|---|---|---|
| Tenancy | `isBusinessOsTenant({ accountId, profileRepository, onboardingRepository })` | Existing: `business_profiles` by `user_id`, then onboarding latest message |
| Business | new `businessProfileRepository.findAdminIdentity(accountId)` | `from('business_profiles').select('user_id, company_name, vertical, sub_vertical').eq('user_id', accountId).maybeSingle()` |
| Spend (30 d) | `tokenUsageRepository.listCallsInWindow(accountId, {start: now-30d, end: now}, bosRowFilter(), {pageSize: 1000, ceiling: 5000})` → `classifyCallRow` → `computeAreaTotals` | Existing method, indexed `(user_id, created_at DESC)` |
| Failures | new `auditTrailRepository.listAdminAiFailures(accountId, { since: now-30d, limit: 10 })` | `from('audit_trail').select('id, created_at, entity_id, details').eq('user_id', accountId).eq('action', AUDIT_EVENTS.BUSINESS_AI_ACTION_FAILED).gte('created_at', since).order('created_at', {ascending:false}).limit(10)`, indexed `(user_id, created_at DESC)` |
| Entitlements | browser → existing `GET /api/admin/business-os/entitlements/accounts/[id]` | Unchanged |

**Response shape** (all fields named; nothing passes through generically):

```typescript
{ success: true, data: {
  accountId: string,
  business: { status: 'ok', companyName: string | null, vertical: string, subVertical: string | null } | { status: 'none' } | { status: 'error' },
  aiSpend30d: { status: 'complete' | 'incomplete' | 'error', currency: 'USD', window: { start, end },
                total: { calls, tokens, estimatedCostUsd }, lines: AreaTotalsLine[] },
  recentAiFailures: { status: 'ok' | 'error', window: { start, end }, limit: 10,
                      items: Array<{ id, createdAt, groupId, area, actionType, trigger, errorCode, callCount, failedCallCount }> }
} }
```

Pino: an `info` line per request with `{ adminUserId, accountId, spendStatus, failuresCount }`. It never includes a business name.

### 4.3 2c: `GET /api/admin/audit-trail`

The query is unchanged, except that `user_id` (a UUID) adds `.eq('user_id', user_id)`. "All Actions" (`action=all`) still becomes `undefined` in the schema, so no action filter is applied.

---

## 5. Files to Create / Modify

| File | Action | Part | Reason |
|------|--------|------|--------|
| `lib/repositories/TokenUsageRepository.ts` | modify | 2a | Promote `orExpression` and its guard to the exported `buildFeatureFilterOrExpression`. No method changes |
| `lib/repositories/AdminTokenUsageAnalyticsRepository.ts` | create | 2a | Cross-account, allow-listed, paged read for the drill-down (F-1). Built to the `new-repository` skill |
| `lib/repositories/index.ts` | modify | 2a | Export the singleton, if the barrel lists repositories (check at T7) |
| `app/api/admin/token-usage/drill-down/route.ts` | modify | 2a | Zod, `scope`, the main and comparison reads through the repository, `incomplete` in the response |
| `app/admin/analytics/page.tsx` | modify | 2a | Toggle, chip, USD label, incomplete banner, `?scope` and `?user` deep link (inside `<Suspense>`) |
| `lib/repositories/BusinessProfileRepository.ts` | modify | 2b | `findAdminIdentity(userId)`: 4 columns |
| `lib/repositories/AuditTrailRepository.ts` | modify | 2b | `listAdminAiFailures(accountId, { since, limit })`. Header updated: the first admin method, scoped by an admin-selected account |
| `app/api/admin/business-os/accounts/[accountId]/summary/route.ts` | create | 2b | The summary route (§4.2) |
| `app/admin/business-os-tiers/components/EntitlementSnapshot.tsx` | create | 2b | Rendering and `ERROR_COPY` extracted from `AccountLookup` |
| `app/admin/business-os-tiers/components/AccountLookup.tsx` | modify | 2b | Uses `EntitlementSnapshot`. Behaviour unchanged |
| `app/admin/business-os-tiers/__tests__/accountLookup.contract.test.tsx` | modify | 2b | Points the `ERROR_COPY` completeness check at the new module |
| `app/admin/users/components/BusinessOsPanel.tsx` | create | 2b | The panel |
| `app/admin/users/types.ts` | create | 2b | Summary payload type (client-side, no server imports) |
| `app/admin/users/page.tsx` | modify | 2b | Panel first. Agents and executions inside an "AgentsPilot details" disclosure. Token block relabelled |
| `app/admin/components/AdminSidebar.tsx` + `__tests__/AdminSidebar.nav.test.ts` | modify | 2b | Only if Q-1 approves a rename |
| `app/admin/business-os-tiers/__tests__/page.render.test.tsx` | modify | 2b | Only if renamed (V-21) |
| `lib/audit/eventAudience.ts` | create | 2c | The classification |
| `lib/audit/filterOptions.ts` | modify | 2c | `audiences` option, `BOS_ENTITLEMENT_` group rule, header rewritten (V-9) |
| `lib/audit/requestSchemas.ts` | modify | 2c | `user_id` on `AdminAuditTrailQuerySchema` |
| `app/api/admin/audit-trail/route.ts` | modify | 2c | `requireAdmin` first, `user_id` filter |
| `lib/admin/__tests__/admin-authz-surface.guard.test.ts` | modify | 2c | Remove the audit-trail R1 and R2 parked entries, caps 7 → 6 (ratchet) |
| `app/admin/audit-trail/page.tsx` | modify | 2c | Operator dropdown, preset button, URL-driven initial state, account chip, hidden-selected option |
| `docs/admin/ADMIN_IDENTIFICATION_AND_ACCESS.md` | modify | all | Counts (handlers 72 → 73, files 44 → 45, `requireAdmin` 65 → 67, inline 7 → 6), register rows, change history |
| `docs/workplans/admin-authz-unification.md` | modify | 2c | Parked slice 4 list: audit-trail done |
| `scripts/typecheck-bos-llm.baseline.json` | modify only if needed | 2a/2b | Only for **pre-existing** errors that come into scope with the drill-down route (R-1). Never for new ones |

**Not touched:** `app/api/admin/users/route.ts`, `app/api/admin/users/[id]/stats/route.ts`, `…/audit-logs`, `…/login-stats`, the entitlements routes, `callCatalog.ts`, `events.ts` (no event added or changed), and `CLAUDE.md` (see R-10).

---

## 6. Test Plan

Jest only. E2E is not set up. No CI job runs the full Jest suite (a parked finding), so QA runs every suite below locally. The authz guard, `typecheck:bos-llm` and the literal gate do run in CI.

### 6.1 Unit

| Test file | Happy path | Failure path |
|---|---|---|
| `lib/audit/__tests__/eventAudience.test.ts` (new) | Every `AUDIT_EVENTS` value has exactly one audience. Counts pinned (15 / 58 / 84), so any reclassification is a visible diff. Pins: both `BUSINESS_AI_ACTION_*` are `bos`, `USER_LOGIN` and `ADMIN_ACTION` are `shared`, `SUBSCRIPTION_CANCELED` is `shared`, `AGENT_CREATED` is `agentspilot` | **Fails on an unclassified event** (keys ⊇ catalogue) and on a stale key (keys ⊆ catalogue). `isVisibleTo('ZZZ_UNREGISTERED', OPERATOR_AUDIENCES)` is `true` (a new event is never hidden) |
| `lib/audit/__tests__/filterOptions.test.ts` (extend) | With no argument: unchanged, every existing assertion holds. With `OPERATOR_AUDIENCES`: the option set equals the catalogue minus the `agentspilot` events, exactly. `BOS_ENTITLEMENT_*` groups under "Business OS entitlements" | No `agentspilot` event appears in the operator list. The partition property still holds (each event appears once, no empty group) |
| `lib/repositories/__tests__/AdminTokenUsageAnalyticsRepository.test.ts` (new) | The select string equals the allow-list, never `*`. Every dimension maps to the right operator (`system` → `is null`, `no-agent` → `is null`). `featureFilter` becomes the exact `.or()` string from `bosRowFilter()`. Paging across 3 pages, de-duplicated | Stops at the ceiling with `reachedCeiling: true`. A bad prefix is refused by the guard (returns `{ error }`, never throws). A Supabase error returns `{ data: null, error }` |
| `lib/repositories/__tests__/TokenUsageRepository.orExpression.test.ts` (new) | The export produces the same string the class used before, with and without legacy values | A prefix or value with a comma, parenthesis or quote throws `TokenUsageGuardError` |
| `BusinessProfileRepository` / `AuditTrailRepository` method tests (new cases) | `findAdminIdentity` selects exactly `user_id, company_name, vertical, sub_vertical` with `.eq('user_id')`. `listAdminAiFailures` pins its select, `.eq('user_id')`, `.eq('action', AUDIT_EVENTS.BUSINESS_AI_ACTION_FAILED)`, `gte`, `order` and `limit` | No row returns `data: null` without an error. A DB error returns `{ data: null, error }` |

### 6.2 Integration (route handlers, mocked repositories)

| Test file | Happy path | Failure paths |
|---|---|---|
| `app/api/admin/token-usage/drill-down/__tests__/route.test.ts` (new) | `scope=bos` passes `bosRowFilter()`'s exact object to the repository **for both reads**. **Totals equal `computeAreaTotals(classifyCallRow(rows)).total`** over a fixture that includes a current-area row, a **legacy** row (`lead-reply`), the bare `business-os` briefing tag and a `business-osx` typo row. `scope=all` passes no feature filter | 401 and 403 before any repository call. 400 for `scope=nope`, `period=0`, and `user=not-a-uuid`. `incomplete: true` when the repository reports the ceiling. Repository error returns 500 with no detail in production |
| `app/api/admin/business-os/accounts/[accountId]/summary/__tests__/route.test.ts` (new) | 200 with all three blocks. Spend equals `computeAreaTotals` on the same rows. `currency: 'USD'` | 401, 403, 400 (bad UUID), 404 (`not_a_business_os_account`), 500 (`tenant_check_failed`), 409 (platform account). The spend read fails while failures still return (`aiSpend30d.status: 'error'`). **Details fixture with `prompt`, `message` and `callNames` produces a response containing none of them.** No business name in any log call |
| `app/api/admin/audit-trail/__tests__/route.validation.test.ts` (extend) | `user_id=<uuid>` produces `.eq('user_id', …)`. `action=AGENT_CREATED` (a hidden event) is still accepted and filtered (the route knows nothing of audiences). `action=all` produces no action filter | `user_id=abc` returns 400. 401 and 403 still precede validation |
| `app/api/admin/__tests__/auditAdminGate.test.ts` | Unchanged and must still pass after the `requireAdmin` conversion | Same |
| `app/api/admin/__tests__/adminGate.writes.test.ts` | The drill-down case still passes (it accepts any non-401/403 status for an admin) | Same |

### 6.3 Render and source guards

| Test file | Asserts |
|---|---|
| `app/admin/audit-trail/__tests__/filterOptions.guard.test.ts` (extend) | The page calls `buildActionFilterGroups({ audiences: OPERATOR_AUDIENCES })`. It still has no `<option>` literal for an event. The preset uses `AUDIT_EVENTS.BUSINESS_AI_ACTION_FAILED`, never a string literal |
| `app/admin/audit-trail/__tests__/presetAndDeepLink.render.test.tsx` (new, jsdom) | **Happy:** clicking "BOS AI failures" fetches with `action=BUSINESS_AI_ACTION_FAILED`. `?user_id=X` fetches with `user_id=X` and shows the chip. The dropdown has no AgentsPilot option. **Failure:** `?action=AGENT_CREATED` renders the extra "hidden" option rather than a blank select. A 500 from the API shows the existing error state |
| `app/admin/users/__tests__/businessOsPanel.render.test.tsx` (new, jsdom) | **Happy:** name, vertical, tier, cohort, a `decidedBy` cell, "USD (estimated)", failure rows linking to `/admin/audit-trail?action=BUSINESS_AI_ACTION_FAILED&user_id=…`. **Failures:** entitlements 404 shows the not-a-Business-OS copy and hides spend and failures. A summary 500 shows an error while the entitlement block still renders. `incomplete` spend shows "lower bound" |
| `app/admin/users/__tests__/source.guard.test.ts` (new) | `app/admin/layout.tsx` still awaits `requireAdminPage()` as its **first statement** (the pattern from ADMIN_IDENTIFICATION_AND_ACCESS.md). The panel imports nothing from `lib/business-os/**`, `callCatalog` or `LanguageContext`, and no `currency` other than the literal `'USD'` label. No `console.` |
| `app/admin/business-os-tiers/__tests__/*` | All existing suites pass after the extraction, including `accountLookup.contract` and `source.guard` (the new component imports only `../types`) |
| `app/admin/analytics/__tests__/scope.render.test.tsx` (new, jsdom) | **Happy:** the toggle adds `scope=bos` to the fetch, and `?scope=bos&user=X` on load does the same. **Failure:** `incomplete: true` shows the banner. A non-OK response shows the existing error |

### 6.4 Gates and live checks (QA)

| Check | Command or procedure |
|---|---|
| Admin authz guard (CI, required) | `npm run test:authz-guard`, with caps lowered to 6 |
| BOS LLM type check and literal gate (CI, required) | `npm run typecheck:bos-llm`, `npm run check:bos-llm-literals` |
| Schema | `npm run schema:check` (branch and SHA stated). Plus a one-off zero-row select of the §4.1 allow-list against `token_usage` |
| Build | `next build` (the `useSearchParams` and Suspense check) |
| Lint | `npx eslint` over every touched file, clean |
| Live "totals match" (2a) | For one real Business OS account and a window of 7 days or less: `llm-usage` `areaTotals.total` equals the drill-down totals with `scope=bos&user=X` and the same dates. Repeat for a second account. The cross-account total equals the sum of per-account totals over the same window |
| Live 2b | Open one business: its plan matches `/admin/business-os-tiers` lookup for the same id; its 30-day spend matches `drill-down?scope=bos&user=X` over the same fixed, past 30-day window (transitive to `llm-usage`, per C-10; compare at display precision); a failure link lands on a filtered audit trail. Open one AgentsPilot-only login: the not-a-Business-OS copy appears. **Holds only below 1,000 BOS calls in the window (OI-P1)** |
| Live 2c | "All Actions" row count equals the unfiltered count before the change (same window) |

---

## 7. Risks

| # | Risk | Severity | Mitigation |
|---|---|---|---|
| R-1 | Importing `callCatalog` pulls `drill-down/route.ts` (1,300 lines, loosely typed) into the `typecheck:bos-llm` scope, a **required** check. Its pre-existing errors turn the gate red | High | T10 runs `npm run typecheck:bos-llm -- --list` first, then fixes new errors. Pre-existing errors on untouched lines may be baselined; the script's own rule allows exactly this case. SA confirms any baseline entry. Fallback: F-1 option C does not avoid it (any importer is in scope), so this cost is accepted |
| R-2 | Totals do not match because of the 1,000-row cap (V-4) | High | Paging with a ceiling, and `incomplete` surfaced (F-2) |
| R-3 | A 30-day cross-account read has no `created_at` index (B0 V-3). Paging past 1,000 rows makes the all-products view slower than today | Med | Measure row counts first (T0). The ceiling bounds it. B0's planned index or RPC can replace the read later without a UI change |
| R-4 | A phantom column in the new explicit select fails the whole query. `token_usage` DDL is not in the repo | Med | T0 zero-row select of the allow-list against live, **before** T7. Today's `select('*')` would hide a missing column as `undefined` → "unknown" |
| R-5 | 2c reverses a documented design decision (V-9) | Med | SA signs it. The header records the user's decision and why the map is safe (exhaustive, fails visible) |
| R-6 | A deep link names a hidden event and the select renders blank | Low | Extra "hidden" option (§3.3), tested |
| R-7 | `useSearchParams` in a client page breaks `next build` (Next 14.2's Suspense requirement) | Low | Wrap in `<Suspense>`. `next build` is a QA gate |
| R-8 | The users panel, the analytics toggle and the audit filter are UI changes that no CI job exercises (no Jest in CI) | Med | QA runs the listed suites. The authz guard, the type check and the build do run in CI |
| R-9 | V-5's fix changes numbers on the existing all-products view (previous period now honours feature, component, request type and endpoint) | Low | Called out in the PR body as a correction. SA confirms (F-9) |
| R-10 | `CLAUDE.md` says "7 handlers still hand-roll", which becomes 6 | Low | Dev does not edit `CLAUDE.md`. Flagged to TL and the user for a decision |
| R-11 | The extraction breaks the Plans & entitlements screen | Low | All five of its suites must pass unchanged, except the one path change in the contract test |
| R-12 | `TokenUsageRepository` contract test is red on `main` (V-18, parked) | Info | Untouched by this plan. Stated so QA does not attribute it to this PR |

---

## 8. Technical Forks for SA

Each fork has a recommendation. SA decides.

| # | Fork | Options | Recommendation |
|---|---|---|---|
| F-1 | Where the changed drill-down reads live | **A.** New `AdminTokenUsageAnalyticsRepository` (cross-account by name, allow-listed columns, paged). **B.** New method on `TokenUsageRepository` (its contract test is red and parked, and its header allows exactly one all-accounts method). **C.** Keep the inline client and add the predicate (breaks the "changed route uses the repository pattern" constraint) | **A.** It honours the constraint and keeps `TokenUsageRepository`'s account-required invariant intact, without touching a parked red test. The remaining inline reads in the file (label lookups, execution detail) are recorded as debt |
| F-2 | Ceiling for the drill-down read | 5,000 (the report's `READ_CEILING`) vs 10,000 (the chat report's) vs unbounded paging | **10,000**, with `incomplete` shown, for both scopes. Final number after T0 measures the 30-day row count |
| F-3 | Zod strictness on the drill-down | Strict enums and patterns vs permissive strings | Strict for `breakdownBy`, `category`, `scope`, `user`, `agent`, `execution`, `period` and the dates (the page sends only these shapes). A bounded identifier pattern for dimension values |
| F-4 | Where the classification lives | **A.** Separate exhaustive per-event map. **B.** A field on `EventMetadata` (covers 122 of 157; adding the rest changes their stored severity). **C.** Prefix rules | **A.** |
| F-5 | 2b data path | **A.** One summary route plus the browser calling the existing entitlements route. **B.** One route that also re-serves the entitlement snapshot | **A.** "Exactly as the entitlements API returns it" is guaranteed only if it *is* that API. B would be a second serialiser |
| F-6 | Entitlement rendering | Extract into the tiers screen directory and import from Users, vs duplicate in Users | **Extract.** The tiers source guard (no imports from outside the screen) still holds, because the new component imports only `../types` |
| F-7 | Route path for the summary | `app/api/admin/business-os/accounts/[accountId]/summary` vs `app/api/admin/users/[id]/business-os` | **The first.** It sits beside the entitlements account route, is reusable by R-3 (Business 360), and keeps the new route out of a folder whose files carry `console.*` debt |
| F-8 | Entity Type dropdown (2c iii) | Apply the same classification vs leave it | **Leave it.** 3 of 26 |
| F-9 | Comparison read now honours all filters (V-5) | Accept as a side effect vs preserve the old behaviour | **Accept.** Preserving it would mean deliberately keeping a wrong number |
| F-10 | Admin audit read method | Add `listAdminAiFailures` to `AuditTrailRepository` (header updated) vs a new admin repository | **Add to the existing one.** One method, still `.eq('user_id')`-scoped, explicitly named |
| F-11 | Audit route | Convert to `requireAdmin` now (required because the route changes) | **Convert**, with the ratchet caps 7 → 6 in the same commit |

---

## 9. Questions for the User

These are business questions only. Technical forks are in §8.

**Q-1. Should "Users" be renamed "Businesses"?** The panel makes each row show its business. The list itself, however, still contains **every login**, including AgentsPilot-only ones.
- **(a)** Rename the menu item and page title to "Businesses" now. The list is unchanged, and an AgentsPilot-only login says "not a Business OS account" when opened. Smallest change.
- **(b)** Rename, and also mark each row in the list as Business OS or not. This touches the list's server code, which also means cleaning up its logging (see §10). A slightly bigger PR.
- **(c)** Keep "Users" until the full Business 360 view (R-3).

*Dev suggests (a).*

**Q-2. Please confirm these borderline event classifications.** Everything else follows the prefix of the event name (§3.3).

| Event(s) | Proposed | Why it is borderline |
|---|---|---|
| `PLUGIN_CONNECTED` / `DISCONNECTED` / `AUTH_FAILED` and the other `PLUGIN_*` | shared | Business OS integrations (e.g. calendar) use plugin connections, but so did agents |
| `PLUGIN_TESTER_EXECUTE` | shared | A developer test harness, used for both products |
| `USER_ONBOARDING_COMPLETED` / `_FAILED` | shared | Today they are written by the AgentsPilot onboarding flow, but they describe an account's sign-up |
| `BOOST_PACK_CHECKOUT_INITIATED` | shared | Credit purchase. Billing is shared by your instruction |
| `EFFORT_ESTIMATE_GENERATED` | AgentsPilot | Estimates savings for an *agent* |

The default rule is: when unsure, keep it visible.

**Q-3. Which facts count as "agent facts" to fold away?** The proposal:
- **Folded:** agents list and agent executions.
- **Still open:** login activity, subscription/credits, connected plugins, the audit log, and the all-products token spend, relabelled as such.

---

## 10. Non-Compliant Files (CLAUDE.md rule 3)

| File | `console.*` | `error.message` leaks | Touched by this plan? |
|---|---|---|---|
| `app/api/admin/users/route.ts` | **7** (lines 33, 53, 60, 89, 92, 130, 144) | **2** (line 56 `details: profilesError.message`; line 147 `message: error.message`) | **No**, unless Q-1 (b). If (b): convert the whole file to `createLogger` + `requestLogger` with `{ err }`, replace both leaks with the `NODE_ENV === 'development'` guard, and Zod-validate `search` / `status` / `sortBy` / `sortOrder`. Two further findings in that file are recorded, not fixed unless touched: `search` is interpolated into an `.or()` filter string (PostgREST filter injection), and `sortBy` is a caller-chosen column |
| `app/api/admin/users/[id]/stats/route.ts` | **1** (line 176) | **1** (line 179) | **No.** The 2b panel does not call it differently |
| Every file this plan does modify | 0 | 0 in production paths | Checked: `app/admin/{users,analytics,audit-trail}/page.tsx`, `drill-down/route.ts`, `audit-trail/route.ts`, `filterOptions.ts`, `events.ts`, `AdminSidebar.tsx` |

In line with CLAUDE.md ("don't reformat files you aren't working on"), untouched files are not converted. Past conversions of touched files were approved. This list asks for the same approval only for the case where Q-1 (b) is chosen.

---

## 11. Task List

**Stage 0: Verify (read-only, before any code)**

- [x] T0a: ✅ (live, read-only, `ddcbb43d`): zero-row selects of the §4.1 token_usage allow-list, `business_profiles (user_id, company_name, vertical, sub_vertical)`, `audit_trail (id, created_at, entity_id, details, user_id, action)`, `profiles (id, full_name, company, created_at, updated_at)`, `onboarding_conversations (user_id, created_at)` all OK. The last 200 `token_usage.execution_id` / `agent_id` values are all UUIDs (Zod shape). The repo-wide `npm run schema:check` was NOT run: the worktree has no `.env.local` and the check was done with a scratch script reading the main checkout's env read-only. Original text: `npm run schema:check` on this branch (state the SHA). One-off zero-row select of the §4.1 column list against `token_usage`
- [x] T0b: ✅ measured: **7,658** token_usage rows in the last 30 days, **3,015** of them Business OS. Both exceed the 1,000-row cap (see OI-P1); the paging/ceiling work that would have used this number was waived by the user. Original text: read-only counts of `token_usage` rows in the last 30 days (all, and matching `bosRowFilter()`) to set F-2's ceiling. Needs environment access. If it is not available, SA sets the ceiling
- [x] T0c: ✅ drill-down route went from 8 pre-existing diagnostics to 0; `typecheck:bos-llm` 247 files in scope, 0 new, no baseline change. Original text: `npm run typecheck:bos-llm -- --list` and a scoped diagnostic of `drill-down/route.ts`, so R-1's size is known before T8

**Stage 1: 2c (independent, smallest)**

- [x] T1: `lib/audit/eventAudience.ts` and `eventAudience.test.ts`
- [x] T2: `filterOptions.ts` `audiences` option, `BOS_ENTITLEMENT_` group, header rewrite, extended tests
- [x] T3: `requestSchemas.ts` `user_id`. Audit route: `requireAdmin` first and `user_id` filter. Authz guard: remove 2 entries and set caps 7 → 6. Extended route tests
- [x] T4: Audit page: operator dropdown, "BOS AI failures" button, URL initial state (Suspense), account chip, hidden-selected option. Guard and render tests
- [x] T5: 2c(iii): no code. The recommendation stays in this workplan

**Stage 2: 2a**

- [x] T6: `buildFeatureFilterOrExpression` export, and its test
- [x] T7: (unpaged, per the user's waiver of C-2) `AdminTokenUsageAnalyticsRepository` and its tests (after T0a)
- [x] T8: (Zod and `scope` only; paging, ceilings and the previous-period change WAIVED by the user, see OI-P1/OI-P2; `possiblyIncomplete` flag instead of `incomplete`) Drill-down: Zod, `scope`, both reads through the repository, `incomplete`. Route tests incl. the totals-equality fixture
- [x] T9: (toggle ON by default, per the user) Analytics page: toggle, chip, USD label, banner, `?scope` / `?user`. Render test
- [x] T10: `typecheck:bos-llm` and `check:bos-llm-literals` green (baseline only pre-existing, SA-approved)

**Stage 3: 2b**

- [x] T11: (plus the batched `findAdminIdentitiesByUserIds` for the list) `BusinessProfileRepository.findAdminIdentity` and test
- [x] T12: `AuditTrailRepository.listAdminAiFailures` and test
- [x] T13: Summary route and tests
- [x] T14: Extract `EntitlementSnapshot`. All Plans & entitlements suites green
- [x] T15: `BusinessOsPanel`, Users page integration (panel first, agent facts folded), render test and source guard
- [x] T16: (option (a) plus business and user name together; the list route was touched, see D-1) Rename per Q-1 (sidebar, page title, tiers link copy, and their tests). Skip if (c)

**Stage 4: Docs and hand-off**

- [x] T17: ADMIN_IDENTIFICATION_AND_ACCESS.md (counts, register, change history). `admin-authz-unification.md` parked list. Flag to TL: CLAUDE.md's "7 handlers" figure, and the requirement's change history (BA)
- [x] T18: (results in §12.4) Full local verification: every suite in §6, authz guard, both BOS LLM gates, eslint on touched files, `next build`, `git diff --stat` reviewed for any deletion without insertion
- [x] T19: Status → Code Complete. Notify TL for SA code review and QA

---

## 12. Implementation Record (Dev, 2026-09-25)

### 12.1 User decisions (binding, 2026-09-25)

| # | Decision | Effect |
|---|---|---|
| U-1 | Q-1: option (a), **plus** the business name and the user name shown together, on every list row and in the panel header | The list route had to return the business name → D-1 |
| U-2 | Q-2: borderline tags approved as proposed | Map unchanged: 15 / 58 / 84 |
| U-3 | Q-3: only the agents list and agent executions fold | Plugins, subscription, login activity, audit log and all-products spend stay open |
| U-4 | "Business OS only" is **ON by default** on AI cost & usage | Page default `scope=bos`; the route's own default stays `all` |
| U-5 | PARK the 1,000-row cutoff and the previous-period filter mismatch | **C-1 and C-2 WAIVED by the user.** Recorded as OI-P1 / OI-P2 in §13. Kept: Zod (C-4), zero new baseline entries (C-8), the admin repository (C-3), C-9's honest label, and a visible "may be incomplete above 1,000" note on Cost Analytics |

### 12.2 Deviations (for SA code review)

| # | Deviation | Why | Where |
|---|---|---|---|
| **D-1** | **`app/api/admin/users/route.ts` was touched** (the plan's option (a) said it would not be). It now returns `business: { companyName, vertical } \| null` per row | U-1 needs the business name on every row. Doing so required everything SA listed for Q-1 (b): **7 `console.*` → Pino with a correlation id; 2 error-text leaks removed (development-only `details`); Zod on `search`/`status`/`sortBy`/`sortOrder`; the search → `.or()` PostgREST filter-injection closed.** Names come from ONE batched read (`findAdminIdentitiesByUserIds`, chunked 200 per `.in()`), never one per row. The profiles read moved to `UserProfileRepository.listForAdmin` (explicit columns, not `select('*')`) | commit 2b |
| D-2 | The injection fix does NOT escape into an `.or()` string: `listForAdmin` runs separate single-operator reads (`ilike` on `full_name`, `ilike` on `company`, `eq` on `id` when the search is a UUID, `in` on ids whose **business name** matched) and merges them | Parameters cannot inject filter syntax; an escaped `.or()` string would still be a string built from input. Searching by business name is new behaviour, added because the rows now lead with it | `lib/repositories/UserProfileRepository.ts` |
| D-3 | A row with no business says **"No Business OS business"** (not "not a Business OS account"). `business: undefined` (lookup failed) says "Business unknown" | The list checks the profile only. An account mid-onboarding is a Business OS tenant without a profile, so "not a Business OS account" would be false for it. The panel, which runs the real `isBusinessOsTenant`, does say "Not a Business OS account" when that is true. Onboarding transcripts were not batched into the list to avoid reading every message row | `app/admin/users/page.tsx` |
| D-4 | The drill-down's ledger reads moved to the new repository with the explicit 17-column allow-list **but stay unpaged** (one request each, as before) | U-5 waived C-1/C-2. The response carries `possiblyIncomplete` (rows returned = 1,000) and `scope`; the page always shows "may be incomplete above 1,000 calls" and a stronger banner when the flag is set | commit 2a |
| D-5 | The comparison read is BOS-scoped under `scope=bos` but otherwise keeps its old, incomplete filter set (provider, model, activity, user, agent) | Needed for the lens (a BOS total must be compared with BOS spend); the rest of the mismatch is OI-P2, parked. A route test pins the parked behaviour so a fix is a deliberate diff | `drill-down/route.ts` |
| D-6 | Authz counts differ from C-6(d)'s "73 = 67 + 6 / 45 files" | Measured: the register was already 7 handlers behind before this PR (entitlements + LLM settings routes, gated but unlisted). Real figures: base **79 / 72 + 7 / 50 files**, now **80 = 74 + 6 + 0 / 51 files**. Guard header, admin doc register (rows 73–80 added) and counts updated to the measured numbers | guard, ADMIN_IDENTIFICATION_AND_ACCESS.md |
| D-7 | `AdminCostAnalytics` and `AuditTrailPage` are now thin `<Suspense>` wrappers around `…Content` components | `useSearchParams` for the deep links (R-7) | both pages |
| D-8 | Small incidental fixes in touched files: `let metadata` → `const` (a pre-existing `prefer-const` lint **error** in the drill-down), the "Total Spend" badge says "Business OS" under the lens, and the drill-down logs through the request's child logger | Lint must be clean on touched files | drill-down, analytics page |
| D-9 | The audit-trail route's `.from('users')` (admin-authz OI-18: the table does not exist, names are always null) is **not** fixed | Out of scope; recorded in the admin unification workplan. Worth knowing because the Businesses panel now deep-links into that screen | — |

### 12.3 What SA should look at first

1. **`app/api/admin/users/route.ts` + `UserProfileRepository.listForAdmin`** (D-1, D-2): the injection fix and the batched lookup. A touched route that is new to this slice's scope.
2. **`AdminTokenUsageAnalyticsRepository`** (C-3): the first admin-only cross-account repository. It is unpaged by the user's decision; confirm the header and guard wording are right for a template.
3. **`filterOptions.ts` header** (R-5): the "nothing is excluded" reversal and the recorded rejection of the EventMetadata route.
4. **`app/api/admin/business-os/accounts/[accountId]/summary/route.ts`** (C-5): order of checks, the typed allow-list projection, error blocks.
5. **The counts** (D-6) in the guard header and the admin access doc.

### 12.4 Verification (real output, 2026-09-25)

| Check | Result |
|---|---|
| `npx jest app/admin lib/audit app/api/admin lib/repositories lib/admin lib/business-os/usage` | **81 suites: 80 passed, 1 failed; 1,593 tests: 1,592 passed, 1 failed.** The one failure is `tokenUsageRepository.contract.test.ts` › "pins every public method and its arity", missing `summariseFeatureAllAccountsInWindow` — the parked red test (C-13). It failed on exactly that one assertion before this work (base `ddcbb43d`) and still does; no second reason was added |
| New or extended suites | eventAudience (new), filterOptions (+4), audit route validation (+4), audit page presetAndDeepLink (new, 6), audit page guard (+2), AdminTokenUsageAnalyticsRepository (new, 12), drill-down route (new, 19), analytics scope render (new, 5), summary route (new, 11), users route (new, 13), adminReadMethods guard (new), users businessOsPanel render (new, 7), users source guard (new), sidebar nav (+1) |
| Admin authz guard (`npm run test:authz-guard`, the command the `Admin authz surface guard` job runs) | **106 / 106 passed**, caps R1 6 / R2 6 |
| `npm run typecheck:bos-llm` | **passed**: 247 files in scope, 28 errors, **0 new**, no baseline change (it reports one pre-existing baseline entry as fixed, unrelated: `app/api/onboarding/build/route.ts`) |
| `npm run check:bos-llm-literals` | **passed**: 45 files in scope, 0 violations |
| Scoped `tsc` (tsconfig, per file) | 0 diagnostics in every new or changed file except `app/admin/analytics/page.tsx`, which has **24 pre-existing** diagnostics, identical in number before and after (measured on a stash of the change) |
| ESLint on every touched file | **0 errors**; remaining warnings are pre-existing (`any`, unused vars) |
| `next build` (the CI job's placeholder env) | **exit 0**, "Compiled successfully". `/admin/analytics`, `/admin/audit-trail` and `/admin/users` build as dynamic (ƒ); the `useSearchParams` + `<Suspense>` wrappers raise no error. The `DYNAMIC_SERVER_USAGE` lines it logs come from `requireAdminPage` in the admin layout during static probing, for every admin page, and are pre-existing |
| `git diff --stat` per commit | checked for deletion without insertion; none |

### 12.6 Review follow-ups (Dev, 2026-09-25)

After SA (approved with nits) and QA (PASS). Not re-reviewed yet.

| # | Finding | Fix |
|---|---|---|
| N-1 | Stale "65 gated handlers" prose | Guard comment and the admin access doc (the As-Built table, Known gaps twice, OI-8) now say 74 gated as of 2026-09-25, and that only the 65 counted on 2026-09-21 were verified by hand and oracle; the 9 since are covered by their own route tests. The 2026-09-21 history rows are left as history |
| N-2 | The template repository's log line could not be joined to the request | `listRowsAllAccountsInWindow` now takes a **required** `AdminReadContext { correlationId, adminId }` as its first argument; every log line of the read carries both, and a read without it is refused before any query. The drill-down passes the request's correlation id and `gate.user.id` to both reads |
| N-3a / E-4 | Business-name matches silently capped at 50 | The route reports `search: { businessSearch, businessMatchesCapped, businessMatchLimit }`; the page shows "More than 50 businesses match this search … Refine the search" when capped, and "Business names could not be searched just now" when that search failed |
| N-3b | Merged search sorted nulls differently from the unsearched list | `compareForAdminList` matches Postgres: missing values last ascending, first descending |
| N-4 | "Unnamed business" above a summary error | The header is "Business OS" while loading, when the summary failed or the profile does not exist yet; "Unnamed business" only for an existing business with no name. The user name stays beside it |
| N-6 | Panel error copy not tied to route codes; "5,000" duplicated | `SUMMARY_ERROR_COPY` is exported and a contract test (`summaryErrors.contract.test.ts`) reads the summary route's source and fails on a code without a sentence. The route sends `aiSpend30d.readCeiling` (= `LLM_USAGE_LIMITS.READ_CEILING`) and the panel quotes it |
| E-1 | `*` matched every account | PostgREST rewrites every `*` in a like operand to `%` and it cannot be escaped, so `ilikeContainsPattern` sends a `*` as `_` (one character, which includes a literal `*`) and `matchesLiterally` drops the extra rows. Applied to the Businesses search and to `BusinessProfileRepository.searchForAdmin` (which also serves the LLM usage business picker). QA's wire test `escaped()` helper was updated to expect `_` for `*` |
| E-3 | Reversed custom range showed "Failed to fetch data" | The page refuses it before sending ("The start date is after the end date…"), and any 400 now reads "The selected filters or dates are not valid" |
| E-2 / N-5, E-5 | — | Left as they are, per the coordinator (manual check M-8; the 200-character cap is accepted) |

Verification after the follow-ups: Jest over `app/admin lib/audit app/api/admin lib/repositories lib/admin lib/business-os/usage` **85 suites, 84 passed, 1 failed; 1,646 tests, 1,645 passed, 1 failed** (the parked C-13 assertion, unchanged). Authz guard 106/106. `typecheck:bos-llm` passed, 249 files, 0 new. Literal gate passed, 0 violations. ESLint 0 errors on touched files. Scoped `tsc`: 0 new diagnostics (the 24 in `app/admin/analytics/page.tsx` are the pre-existing ones).

### 12.5 For TL (not done by Dev)

- `CLAUDE.md` says "7 handlers still hand-roll"; after merge it is **6** (and 80 handlers, not 72). Dev does not edit `CLAUDE.md` (C-6e): raise with the user before merge.
- The requirement's change history (BA) should record: U-1 to U-5, and that "totals match" (C-10) holds only below 1,000 rows (OI-P1).

---

## 13. Open Issues (PARKED)

### OI-P1 — Silent 1,000-row cutoff on ledger reads (Cost Analytics and Users stats) — **PARKED (user, 2026-09-25)**

| Field | Detail |
|---|---|
| **Diagnosis** | `GET /api/admin/token-usage/drill-down` reads `token_usage` for the window in **one unpaged request** (before this slice via an inline `select('*')`; now via `AdminTokenUsageAnalyticsRepository.listRowsAllAccountsInWindow`, same shape). PostgREST returns at most **1,000 rows**, unordered, with no error, so every total, breakdown and "vs previous period" percentage is computed over an arbitrary subset once a window holds more. The previous-period read has the same cap. `GET /api/admin/users/[id]/stats` has the same defect for one account's 30-day `token_usage` (`stats/route.ts:64-67`, unpaged and unordered), which feeds the Users "all products" spend block |
| **Evidence** | Measured live 2026-09-25: **7,658** rows in the last 30 days, **3,015** of them Business OS. The default 30-day view is therefore already truncated in both scopes |
| **Consequence** | Totals are understated by an unknown amount; the slice-2 criterion "BOS preset totals match the LLM usage report" (C-10) holds **only below 1,000 rows in the window** — e.g. one account, or a short window |
| **What ships instead** | Cost Analytics always states "Totals may be incomplete above 1,000 calls in the selected period" and shows a stronger banner when a read returns exactly 1,000 rows (`possiblyIncomplete`). The Users all-products block is labelled "may be incomplete above 1,000 calls" (C-9). The Business OS panel's own 30-day figure is NOT affected: it pages (the LLM usage report's `listCallsInWindow`, ceiling 5,000, with an explicit lower-bound note) |
| **Fix shape** | Page both drill-down reads with `created_at DESC, id DESC`, de-duplicate by `id`, stop at a named ceiling (SA ruled 10,000) and return `reachedCeiling`; show "lower bound" and suppress percentages when either read reached it (SA C-1/C-2 as written). Beyond ~10,000 rows or ~3 s per page, stop: the answer is B0's `created_at` index or aggregation RPC, not a bigger loop. For `stats`, move its read to `TokenUsageRepository` with paging |
| **Why parked** | User decision: keep this PR to the Business OS lens and avoid scope creep. No live customers yet |

### OI-P2 — "vs previous period" ignores most filters — **PARKED (user, 2026-09-25)**

| Field | Detail |
|---|---|
| **Diagnosis** | The drill-down's previous-period read applies provider, model, activity, user and agent only. It ignores **request type, feature, component and endpoint**, and it ignores the **category post-filter** (creation / memory / system, applied in memory to the current period only) and the `execution` category's `execution_id IS NOT NULL` filter. Filtering by any of those compares a filtered current period with an unfiltered previous one, so the percentage is wrong |
| **What ships instead** | Under `scope=bos` the comparison IS scoped to Business OS rows (otherwise the lens would compare BOS with everything). Everything else is unchanged, and a route test pins it (`keeps the parked comparison behaviour`) so a fix is a deliberate diff |
| **Fix shape** | One filter object and one shared category post-filter function for both reads (SA C-1); both reads concurrent; no percentages when either read is truncated |
| **Why parked** | User decision, same as OI-P1. It changes numbers on the existing all-products view, which the user wants reviewed separately |

---

## SA Review Notes

**Reviewed by SA — 2026-09-25** (workplan review, against `feature/admin-bos-step2`; no code exists yet)
**Status:** ✅ Approved with conditions. Dev may start at T0. Conditions C-1 to C-13 below are binding and are re-checked at code review.

### What SA re-measured (not taken from the plan)

| Claim | SA check | Result |
|---|---|---|
| V-4, V-5 | Read `drill-down/route.ts:196-380` | Confirmed. Unpaged `select('*')`. The comparison read skips `request_type`, `feature`, `component` and `endpoint`. **It also skips the in-memory `category` filter** (creation / memory / system), which the plan does not mention (see C-1) |
| V-8, V-10 | Loaded `AUDIT_EVENTS` with `tsx` | 157 events, 122 with metadata. Prefix buckets add up to exactly 15 / 58 / 84 |
| R-1 size | Ran the checker over `drill-down/route.ts` with the repo's tsconfig | **8 pre-existing errors, all TS2339 on lines 220-223.** They all come from the untyped `filters` parameter, which T8 replaces. `audit-trail/route.ts` has 0. **R-1 goes from High to Low** (C-8) |
| Column allow-list (§4.1) | Every `record.*` / `r.*` field read by the aggregation | Matches the 17 columns exactly. No payload, metadata or error column is read |
| V-18 | Read the contract test | It is red only because `summariseFeatureAllAccountsInWindow` is missing from `EXPECTED_ARITY`. Moving a `private static` to module scope does not change the prototype. The RC-7 "no business-os import" assertion still holds |
| V-7 | Guard `CAPS`, R1/R2 parked lists, `requireAdmin` body | Confirmed. `requireAdmin` uses the same `getUser` + `AdminAccessService` and returns the same 401/403 bodies, so `auditAdminGate.test.ts` carries over unchanged |
| Page params | `analytics/page.tsx:238-257` | The page sends `category` ∈ {creation, execution, memory, system}. The route comment says `other`, which is wrong. Dimension values are raw column values (model ids with `/ . :`, endpoint paths) |
| Adjacent number | `users/[id]/stats/route.ts:64-67` | The per-user 30-day `token_usage` read is **also unpaged and unordered**, so it is capped at 1,000 rows (see C-9) |

### Rulings on the 11 forks

| # | Ruling | Notes |
|---|---|---|
| F-1 | **A: new `AdminTokenUsageAnalyticsRepository`** | Keeps `TokenUsageRepository`'s account-required contract intact and leaves the parked red test alone. This is the **first admin-only cross-account repository**, i.e. the design decision ADMIN_IDENTIFICATION_AND_ACCESS.md OI-9 says is blocking the admin repository migration. It is therefore a new pattern (CLAUDE.md rule 7), and it must follow the template in C-3 so it can be reused. (Correction to the F-1 text: `TokenUsageRepository` already has **two** named all-accounts methods, not one. That does not change the ruling.) |
| F-2 | **Page 1,000. Ceiling 10,000 for both drill-down reads. 5,000 for the 2b per-account spend** | See C-2 for the stop rule and for how a truncated comparison is displayed |
| F-3 | **Strict, with one correction** | Enums and UUID shapes as planned. **Dimension values must not use a restrictive identifier regex** (C-4) |
| F-4 | **A: separate, exhaustive per-event map** | B would change stored severity for 35 events (WC-12). C is the silent-reclassification defect the requirement forbids |
| F-5 | **A** | Only the entitlements route can guarantee "exactly as the entitlements API returns it" |
| F-6 | **Extract into the tiers directory** | The tiers source guard still holds because the new file imports only `../types`. Users importing *into* that directory is allowed. The component must stay read-only (the tiers guard already forbids write methods) |
| F-7 | **`app/api/admin/business-os/accounts/[accountId]/summary`** | Agreed. It sits beside the entitlements account route, is reusable by R-3, and keeps the new file out of the `users/` folder with its `console.*` debt |
| F-8 | **Leave the Entity Type dropdown as it is** | 3 of 26 types does not justify a second map |
| F-9 | **Accept, in this PR** | See C-1: "same filter" must include the category post-filter, or the comparison is still wrong |
| F-10 | **Add to the existing repositories**, under C-7 | `BusinessProfileRepository.searchForAdmin` is the precedent |
| F-11 | **Convert now, in scope** | Requirement §10 explicitly lists "the 7 inline admin checks" as debt that is fixed when a slice touches the file. See C-6 |

### Rulings on the specific questions

1. **Paging and the "lower bound" banner.** Sound. A silent 1,000-row cap is the worse defect: today's totals are an arbitrary, unordered subset. Paging with `created_at DESC, id DESC`, de-duplicating by `id` and returning `reachedCeiling` is the proven `listCallsInWindow` shape, and it is accepted. Offset paging over a table with no `created_at` index means up to 10 sequential scans per read. That is acceptable at today's volume (no live customers) **only** with the C-2 stop rule.
2. **Changing the "vs previous period" numbers.** Acceptable in this PR. It corrects a wrong number, and keeping it would mean deliberately shipping a known-wrong comparison next to a new BOS lens. Conditions: C-1, and the PR body and this workplan's change history name the behaviour change.
3. **The new admin data-access file.** Justified as admin-only. It is service-role by necessity: the read is cross-account by design and admin-gated at the route, and RLS has no "platform admin reads all ledger rows" policy to use. The reason must be written in the file header (C-3).
4. **The new summary route.** The plan's order is correct. C-5 adds precedence evidence, the platform-account order and the read-side projection.
5. **The audit-trail route change.** In scope. **Both** `CAPS.R1.parked` and `CAPS.R2.parked` go from 7 to 6 in the **same commit** that removes the two entries. The caps are asserted by equality, so a slack cap turns the required `Admin authz surface guard` check red. That is the ratchet working, not an obstacle (C-6).
6. **BOS LLM typecheck risk.** Low, because it was measured (C-8). Zero baseline entries are allowed for the drill-down route.
7. **Event tagging vs FR-A3.** The design satisfies the invariant. "An untagged event stays visible, and a test fails on it" is the right rule: fail-open on visibility, fail-loud on classification. A missed classification costs one extra dropdown line, never a hidden event. One honesty correction: the test fails the **Jest suite**, and no CI job runs Jest (a parked finding). The `satisfies Record<AuditEvent, …>` check is not CI-enforced either, because `lib/audit/` is outside the `typecheck:bos-llm` scope. The runtime default of "visible" is what actually protects production. The workplan and the new module header must say that, not "fails CI". **SA signs the R-5 reversal** of `filterOptions.ts`'s "nothing is excluded" decision. The old header's escape hatch ("flag it on EventMetadata") is rejected for the V-8 reason, and the rewritten header must record that rejection.
8. **Currency.** Approved as planned. AI cost is USD by definition of the pricing table and is labelled "USD (estimated)". It is never converted, never summed with business currency, and never read from `business_profiles.currency` or `LanguageContext`. The existing `formatCost` (Intl, `currency: 'USD'`) is the right formatter. The source guard in §6.3 stays.
9. **The red `TokenUsageRepository` contract test.** Do **not** fix it. It is user-parked, and fixing it here is scope creep. Do not add any prototype method to that class (C-13).
10. **Scope.** One PR is still reviewable, **if** it is built as ordered stage commits (C-12). It must not absorb Q-1 (b).

### Conditions (binding)

| # | Condition |
|---|---|
| **C-1** | **The comparison applies exactly the predicate the main totals apply.** That means the same repository filter object **and** the same in-memory category post-filter (one shared function, not a copy). Both reads run concurrently (`Promise.all`). The comparison read reports its own `reachedCeiling`. **If either read reached its ceiling, the response carries no `changes` percentages.** The page then shows "Comparison unavailable: more than N calls in a period" instead of a percentage, because two truncated counts at 10,000 read as "0% change". The Zod `category` enum is exactly `all \| creation \| execution \| memory \| system`, and the stale `'other'` route comment is corrected. A route test pins the category post-filter being applied to both reads |
| **C-2** | **Ceilings:** `pageSize` 1,000. Drill-down `ceiling` 10,000 for both reads, held in a named constant in the new repository (e.g. `ADMIN_ANALYTICS_READ_LIMITS`) and asserted by guard, as `TokenUsageRepository` does. Summary route: `LLM_USAGE_LIMITS.PAGE_SIZE` / `READ_CEILING` (5,000). **Stop rule for T0b:** if the live 30-day all-products count is above 10,000, **or** any single page takes more than ~3 s, stop and escalate to SA. Do not raise the ceiling. The answer at that point is B0's index or RPC, not a bigger loop. If T0b has no environment access, 10,000 stands and QA measures the page time live |
| **C-3** | **Admin repository template** (the first instance of OI-9, so it has to be right): (a) the header states the service-role client, why RLS cannot serve the read, that the only permitted caller is `app/api/admin/token-usage/drill-down/route.ts`, and that the caller must be `requireAdmin`-gated. (b) The method name says `AllAccounts`. (c) It imports **nothing** from `lib/business-os/**`. The feature filter arrives as data (the same RC-7 rule as `TokenUsageRepository`, with the same regex test). (d) A source guard asserts that no file outside `app/api/admin/**` (tests excepted) imports it. (e) It logs at `info` per read with `{ rows, pages, reachedCeiling }`, the cross-tenant convention. (f) It returns `{ data, error }` and never throws. It uses the exported `buildFeatureFilterOrExpression`, with the guard inside the builder. (g) Singleton, plus the barrel export per the `new-repository` skill. T17 adds a line to ADMIN_IDENTIFICATION_AND_ACCESS.md OI-9 naming this file as the agreed template |
| **C-4** | **Drill-down Zod:** `provider`, `model`, `activity`, `request_type`, `feature`, `component` and `endpoint` are `z.string().min(1).max(200)` with control characters refused. **They get no identifier regex.** Real values include model ids with `/`, `.` and `:`, and endpoint paths, so a regex would turn a legitimate drill-in into a 400. They only ever reach `.eq()`, never an `.or()` string, and the one `.or()` input (`bosRowFilter()`) never comes from the request. `user` is a UUID or `system`. `agent` is a UUID or `no-agent`. `execution` is a UUID or `single-<uuid>`. `period` is an integer from 1 to 365. The dates are `datetime()`, refined so that `dateFrom <= dateTo`. `scope` is `bos \| all`, defaulting to `all`. A 400 carries details in development only. Validation runs after `requireAdmin` and before any read |
| **C-5** | **Summary route:** (a) `requireAdmin` is the first statement, and the tests for 401 and 403 assert **zero repository calls**. The guard proves the gate is present, not that it runs first (OI-20), so the test is the evidence. (b) The `isPlatformAccount(accountId)` → 409 check runs **before** `isBusinessOsTenant`, because it is pure and needs no DB read. (c) The `details` projection goes through a narrow typed pick with string length caps, so rows written by older code cannot pass arbitrary shapes. The test with injected `prompt`, `message` and `callNames` stays. (d) Pino child logger with `correlationId` and `adminId`. The business name is never logged. (e) An error block is `{ status: 'error' }` with no message. The top-level 500 follows the development-only details rule. (f) `runtime = 'nodejs'`, `dynamic = 'force-dynamic'`, as the sibling entitlements route has |
| **C-6** | **Audit route conversion:** (a) remove the `getUser` and `AdminAccessService` imports entirely, because R2 flags the import, not the call. (b) Add a `correlationId` child logger (CLAUDE.md API pattern). (c) Remove the R1 and R2 audit-trail entries **and** set both caps from 7 to 6 in the same commit. Update the guard header prose that says "7" / "65". (d) Re-derive ADMIN_IDENTIFICATION_AND_ACCESS.md: 73 handlers = 67 `requireAdmin` + 6 inline + 0 open, and **45** route files. That also changes the "26 of 44" (OI-7) and "38 of 44" (OI-9) denominators. (e) **CLAUDE.md says "7 handlers still hand-roll"** and becomes wrong on merge. Dev does not edit CLAUDE.md. TL raises it with the user **before merge**. If the user declines, the PR body records the drift. The audit read stays inline in this PR (a single added predicate). It is recorded as an OI-9 candidate, not waived silently |
| **C-7** | **Admin methods on owner repositories:** the `AuditTrailRepository` header currently states "`userId` always the authenticated caller (never a client-supplied value)". It must be rewritten to name the one admin exception and its only caller. `listAdminAiFailures` and `findAdminIdentity` keep "Admin" in their names. A source guard asserts that both are called only from `app/api/admin/**`, the same isolation discipline as C-3(d). Both keep `.eq('user_id', accountId)` |
| **C-8** | **`typecheck:bos-llm`:** **zero** new baseline entries for `drill-down/route.ts`. The 8 measured errors disappear with the typed filter object. The new route tests import in-scope routes, which makes them "callers" and therefore in scope, so they must be type-clean too. Any baseline change at all needs SA sign-off at code review. `check:bos-llm-literals` excludes tests, and the drill-down route has no model literals today, so it must stay that way |
| **C-9** | **The all-products spend on Users is capped at 1,000 rows** (`stats` route, unpaged and unordered). The relabel must not make it look authoritative next to a paged BOS figure: a heavy account could show all-products *below* its BOS-only spend. Label it honestly, e.g. "AI spend, all products (30 days; may be incomplete above 1,000 calls)", and record the truncation as debt. **Do not** touch the `stats` route in this PR |
| **C-10** | **Live verification:** every "totals match" comparison uses an identical, fixed, **past** start and end. `llm-usage` otherwise ends at request time, so the windows drift. Compare at display precision, because the float sums are only order-identical. The 2b panel is 30 days and `llm-usage` allows at most 7, so verify the panel against `drill-down?scope=bos&user=X` over the same 30-day window. That comparison is transitive, since the drill-down is itself verified against `llm-usage` in 2a. Fix §6.4's "spend matches llm-usage over the last 7 days" wording accordingly |
| **C-11** | **Event audience:** the test pins the 15 / 58 / 84 counts, checks keys ⊇ catalogue and keys ⊆ catalogue, and checks that a synthetic unregistered value is visible. The **existing** no-argument FR-A3 partition tests stay byte-for-byte unchanged. The new operator-list test asserts equality with "catalogue minus the events explicitly classified `agentspilot`". The module is pure and client-safe (no zod), like `filterOptions.ts`. Wording per ruling 7 |
| **C-12** | **Reviewability:** one PR, built as ordered commits (Stage 0 notes, then 2c, 2a, 2b, docs). Each commit keeps the authz guard and both BOS LLM gates green, so SA code review can go commit by commit. `git diff --stat` is checked for deletion without insertion before hand-off (T18). If the user picks Q-1 (b), that is a **separate PR** |
| **C-13** | **The parked red test:** QA records, before and after, that `tokenUsageRepository.contract.test.ts` fails on **exactly one** assertion: the missing `summariseFeatureAllAccountsInWindow` arity pin. The diff must not add a second reason. Not fixing it is the user's parking decision, not an SA waiver |

### Technical implications of the 3 user questions (SA does not decide these)

| Question | Option | Technical implication |
|---|---|---|
| **Q-1** rename | (a) | Labels only (A-5). Touches `AdminSidebar.tsx`, its nav test, `business-os-llm/__tests__/nav.test.ts` if the description changes, and the tiers render test's "Users" link (V-21). No server change. Low risk |
| | (b) | Touches `app/api/admin/users/route.ts`, which triggers the mandatory Pino conversion (7 `console.*`), 2 error-message leaks, Zod, and a **fix to the `search` → `.or()` PostgREST filter injection**. Once the file is touched that last one is a security fix, not an optional tidy-up. A per-row Business OS marker also needs a **batched** tenancy read (`user_id IN (…)` over profiles plus onboarding). Calling `isBusinessOsTenant` per row would be N+1 with 2 reads each. SA requires this to be its own PR (C-12) |
| | (c) | No code. The Plans & entitlements link keeps its label |
| **Q-2** borderline tags | any | Each change is one map line plus an updated count pin. There is no data or route effect, because the route never filters by audience. Facts that may help: `PLUGIN_*` are written for connections that Business OS integrations (e.g. the calendar) also use, so `PLUGIN_AUTH_FAILED` can be a real BOS signal. `PLUGIN_ACT_AS` is written by `lib/server/route-identity.ts` (identity hardening). Today's only writer of `USER_ONBOARDING_*` is the AgentsPilot onboarding hook, so BOS rows would never appear under it, but showing it is harmless. The only writer of `EFFORT_ESTIMATE_GENERATED` is `lib/effort-estimator` |
| **Q-3** what folds | any | A pure client-side disclosure. The `/stats` call returns agents, executions and tokens in one response, so folding saves no request unless the fetch is split, and SA does not ask for that. Whatever stays open, C-9 applies to the token block |

### Adjusted items (marked by SA)
- R-1: severity High → **Low** (measured: 8 errors, all removed by T8).
- F-1 text: "its header allows exactly one all-accounts method" → there are already two. The ruling is unchanged.
- §6.4 "Live 2b … spend matches llm-usage over the last 7 days" → replaced by C-10.
- T3: add C-6 (a) to (d). T8: add C-1, C-4. T13: add C-5. T17: add C-3(g), C-6(d) and (e).

### Optimisation Suggestions (non-blocking)
- Under `scope=bos` the category tiles (creation / execution / memory / system) are AgentsPilot-shaped, and BOS rows will mostly land in "system". Consider hiding or captioning them under the BOS lens.
- Pre-existing, record as debt only: `getAvailableFilters` calls `auth.admin.listUsers()` with its default page size, so users beyond the first page are labelled by id. Larger pages also grow the `.in('id', …)` URL.
- `isBusinessOsTenant` already reads the profile (`select *`), and `findAdminIdentity` reads it again. Two indexed single-row reads are acceptable. A future tenancy helper could return the projection.

### Approval
[x] Workplan approved, subject to C-1 to C-13. Proceed to implementation, starting at T0. The three user questions do not block Stages 0 to 2. T16 waits for Q-1, and the §3.3 map is finalised once Q-2 is answered (the default is shared).

---

**Code Review by SA — 2026-09-25**
**Status:** ✅ Code Approved, with nits (APPROVED WITH NITS)

Reviewed `ddcbb43d..f44fec53` on `feature/admin-bos-step2` (4 local commits, not pushed), in the worktree only. U-1 to U-5 are treated as binding. **C-1 and C-2 were waived by the user (U-5)**, not by SA; they are checked only against the replacement promised in U-5 (OI-P1/OI-P2 recorded, notes on screen).

#### What SA re-ran (real output)

| Check | Result |
|---|---|
| `git diff --stat ddcbb43d..HEAD` | 40 files, +4,376 / −428. The only file with more deletions than insertions is `AccountLookup.tsx` (+5 / −100). SA compared it line by line: every removed line is in `EntitlementSnapshot.tsx`, apart from 3 renamed lines (`ERROR_COPY` → `ENTITLEMENT_ERROR_COPY`, and the "Users" → "Businesses" link copy). **No deletion without a matching insertion** |
| `npx jest app/admin lib/audit app/api/admin lib/repositories lib/admin lib/business-os/usage` | **81 suites: 80 passed, 1 failed. 1,593 tests: 1,592 passed, 1 failed.** The failure is `tokenUsageRepository.contract.test.ts:84` › "pins every public method and its arity". Its diff is exactly one extra name, `summariseFeatureAllAccountsInWindow`. This is the same single parked assertion (C-13). `TokenUsageRepository`'s only change is at module level (`buildFeatureFilterOrExpression`), so no method or arity that the failing expect masks has changed |
| `npm run test:authz-guard` | **106 / 106 passed** |
| `npm run typecheck:bos-llm` | **passed**: 247 files in scope, 28 errors, **0 new**. The baseline file is not in the diff (C-8). It reports one unrelated baseline entry as fixed (`app/api/onboarding/build/route.ts`) |
| `npm run check:bos-llm-literals` | **passed**: 45 files, 0 violations |
| D-6 census (SA's own count) | **51** route files under `app/api/admin`, **80** exported handlers. **6** handlers have no `requireAdmin(` call: `agents`, `business-os/llm-usage`, `business-os/llm-usage/businesses`, `chat-usage`, `users/[id]/audit-logs`, `users/[id]/login-stats`. That gives **80 = 74 + 6 + 0**, matching the guard caps (R1 6/0, R2 6/1), the guard header, and the access doc's table and register rows 73–80 |
| `console.*` in touched non-test files | 0 (the only match is a comment in `users/route.ts:7`) |
| `.message` in touched routes | All 5 are behind `NODE_ENV === 'development'` |

Not re-run by SA: `next build` and ESLint. Dev reports both green (§12.4), and QA re-runs them.

#### Priority review items (Dev's §12.3 order)

1. **`app/api/admin/users/route.ts` + `UserProfileRepository.listForAdmin` (D-1, D-2): approved.**
   - `requireAdmin` is the first statement.
   - Zod enums on `status` / `sortBy` / `sortOrder`. `search` is limited to 100 characters with control characters refused. The 400 carries details in development only.
   - All 7 `console.*` calls are gone, and both leaks are closed.
   - **Injection fix:** there is no `.or()` string anywhere. The search runs as separate `.ilike` reads, escaped by the existing `escapeIlikePattern`, plus `.eq('id')` for a full UUID and `.in('id', extraIds)`, where `extraIds` is UUID-filtered. Every value is a PostgREST parameter. The hostile-string test (`x%),id.neq.(y`) pins that no `.or` is ever called.
   - The profile read is now an explicit 5-column allow-list. Every field the page's `User` type reads is still supplied (profile columns + auth enrichment).
   - **Batched lookup:** it is `findAdminIdentitiesByUserIds`, with one `.in()` per 200 ids (at most 5 requests for 1,000 rows), never one per row. It is tested at 201 ids → 2 queries. A failed lookup gives `business: undefined`, shown as "Business unknown", and the list still loads.
   - **D-2:** a search also matches business names through the existing `searchForAdmin` (escaped `ilike`). Accepted as a behaviour change.
   - The logs carry counts only, never names or search text.
   - Nits: N-3.
2. **`AdminTokenUsageAnalyticsRepository` against C-3: approved as the OI-9 template.**
   - (a) The header states the service role, why RLS cannot serve the read, the only permitted caller, and the `requireAdmin` requirement.
   - (b) `AllAccounts` is in the method name.
   - (c) No `lib/business-os` import, asserted by test.
   - (d) An isolation guard scans for the symbol names, not the path, so a barrel import is caught.
   - (e) An `info` log per read. It now carries `possiblyTruncated` instead of `pages` / `reachedCeiling`, which is consistent with the waiver.
   - (f) Returns `{ data, error }` and never throws. The shared builder carries the guard.
   - (g) Singleton + barrel export. The OI-9 line is added to the access doc.
   - The unpaged read is stated in the header as parked (OI-P1).
   - Nit: N-2.
3. **`filterOptions.ts` header + `eventAudience.ts` (R-5, C-11): approved. SA's R-5 sign-off stands.**
   - The header records the reversal, the reason, and why the EventMetadata route was rejected (122 of 157; WC-12).
   - The module header states honestly that Jest is not run in CI and that `satisfies` is not CI-enforced.
   - One entry per event, `as const satisfies Record<AuditEvent, AuditAudience>`.
   - An untagged event stays visible.
   - The 15 / 58 / 84 split is pinned, with ⊇ / ⊆ checks and a synthetic unregistered event.
   - `lib/audit/__tests__/filterOptions.test.ts` has 0 deleted lines, so the existing FR-A3 partition tests are byte-for-byte unchanged.
   - The one changed page-guard assertion (`buildActionFilterGroups()` → the `audiences` call) is the intended change.
4. **Summary route (C-5): approved.**
   - (a) `requireAdmin` runs before the `try` block and before any read, and the 401/403 tests assert zero repository calls.
   - (b) 400 → 409 (`isPlatformAccount`, pure) → `isBusinessOsTenant` (500 / 404) → three reads in parallel.
   - (c) `projectAiFailure` picks named fields, each type-checked, with strings capped at 80 characters. The injected `prompt` / `message` / `callNames` test passes.
   - (d) Child logger with `correlationId` + `adminId`. The info line holds only id, statuses and counts, and a test asserts the business name is never logged.
   - (e) Error blocks are `{ status: 'error' }`; the top-level 500 carries details in development only.
   - (f) `runtime = 'nodejs'`, `dynamic = 'force-dynamic'`.
   - Spend reuses `listCallsInWindow` → `classifyCallRow` → `computeAreaTotals` with `LLM_USAGE_LIMITS`, labelled USD.
5. **D-6 counts: approved.** They match SA's independent census, above. Nit: N-1 (stale "65" prose).

#### Remaining conditions

| # | Verdict | Evidence |
|---|---|---|
| C-1 | **Waived by the user (U-5)** | The replacement is delivered. OI-P2 is recorded with a fix shape. `scope=bos` is applied to the comparison read. A route test pins the parked behaviour (`keeps the parked comparison behaviour`). The `category` enum is exactly `all \| creation \| execution \| memory \| system`, and the stale `'other'` comment is fixed |
| C-2 | **Waived by the user (U-5)** | OI-P1 is recorded with the measured 7,658 / 3,015 rows. The notes are always on screen, with a stronger banner on `possiblyIncomplete`. The panel's own spend is still paged at 5,000 |
| C-3 | ✅ | See item 2 |
| C-4 | ✅ | Dimensions are `min(1).max(200)` with control characters refused and **no identifier regex**, tested with `/ . :` values. `user` / `agent` / `execution` shapes, `period` 1–365, `datetime({ offset: true })` with the `dateFrom <= dateTo` refinement, and `scope` defaulting to `all` all match the condition. Validation runs after `requireAdmin` and before any read. The 400 carries details in development only |
| C-5 | ✅ | See item 4 |
| C-6 | ✅ with N-1 | (a) the `getUser` / `AdminAccessService` imports are gone. (b) There is a `correlationId` child logger. (c) The R1 and R2 entries are removed and both caps went 7 → 6 in the 2c commit. (d) The counts are re-derived (D-6 supersedes "73/67/45"). (e) The CLAUDE.md figure is flagged to TL in §12.5 and is **still owed before merge** |
| C-7 | ✅ | `AuditTrailRepository`'s header names the one admin exception and its caller. All four admin methods carry "Admin" in their names. `adminReadMethods.guard.test.ts` confirms each has at least one caller, and that every caller is under `app/api/admin/**`. `findAdminIdentity*` / `listAdminAiFailures` keep `.eq('user_id')` / `.in('user_id')`. `listForAdmin` is all-accounts by design and documented as such |
| C-8 | ✅ | 0 new errors. Baseline untouched |
| C-9 | ✅ | The label reads "AI spend, all products (30 days; may be incomplete above 1,000 calls)". The `stats` route is untouched |
| C-10 | ✅ | §6.4 wording is fixed. The live check is QA's job, and it is known to hold only below 1,000 rows (OI-P1) |
| C-11 | ✅ | See item 3 |
| C-12 | ✅ | The 4 ordered commits are reviewable one at a time. The Q-1 (b)-style list change ships in this PR by **user** decision (U-1), which overrides SA's "separate PR" preference. It is confined to the 2b commit, and SA accepts it |
| C-13 | ✅ | Same single assertion, re-run by SA (above) |

**Deviations D-1 to D-9:** all accepted. D-1 and D-2 are reviewed above. D-3's "No Business OS business" versus the panel's real tenancy verdict is the honest split. D-4 and D-5 follow U-5. D-6 is verified. D-7 is the required Suspense wrap. D-8 is a lint fix plus copy. D-9 (OI-18, `.from('users')`) stays recorded.

**CLAUDE.md standards:**
- Repository pattern: new reads go through repositories. The remaining inline reads (audit read, drill-down labels and execution detail, auth `listUsers`) are recorded under OI-9.
- `user_id` scoping or a documented service-role use: yes.
- Zod on every changed route: yes.
- Pino with no `console.*`: yes.
- No leaked error details: yes.
- Currency: AI cost is labelled "USD, estimated". Nothing reads `business_profiles.currency` or `LanguageContext`, and nothing is summed across currencies (source guard in `app/admin/users/__tests__/source.guard.test.ts`).
- No owner text or prompts are displayed: the profile read is 4 columns, the failures read is 4 columns projected to 6 named fields, and the ledger reads are allow-listed.

#### Code Review Comments

| # | Location | Issue | Priority |
|---|---|---|---|
| N-1 | `lib/admin/__tests__/admin-authz-surface.guard.test.ts:106`; `docs/admin/ADMIN_IDENTIFICATION_AND_ACCESS.md:80, 211 (twice), 474` | The prose still says "65 gated handlers" (C-6(c) residue; the OI-25 prose-drift class). Do **not** simply write 74: "all 65 are correct … verified by hand and by the oracle" is a measurement, and the 9 newer handlers were not part of it. Reword to "74 gated; the 65 measured on 2026-09-21 were verified by hand and oracle, the 9 since by their own route tests", or re-measure. Comment and doc only, fix before the PR opens | Low |
| N-2 | `lib/repositories/AdminTokenUsageAnalyticsRepository.ts:167-178` | The comment says the `info` line is "the accountability trail … who read how much", but the line carries no `correlationId` or admin id, so it cannot be joined to the route's `adminUserId` line. Because this is the OI-9 **template**, the next admin repository will copy it. Either soften the comment, or (preferred, can be a follow-up) accept an optional parent logger in the method options so the line inherits the request's `correlationId` | Low |
| N-3 | `app/api/admin/users/route.ts:111`; `lib/repositories/UserProfileRepository.ts:131-136` | (a) Business-name matches are silently capped at 50 (`BUSINESS_SEARCH_MAX_LIMIT`), so a broad term can miss accounts. (b) Merged search results are sorted in memory with null names first on ascending order, while the unsearched path sorts in the database (nulls last on ascending). Neither is a security issue. Record them, or fix them cheaply | Low |
| N-4 | `app/admin/users/components/BusinessOsPanel.tsx:114` | When the summary fails (`platform_account`, `tenant_check_failed`, 500), the header reads "Unnamed business" above an error sentence. Show a neutral title (e.g. "Business OS") in that case | Low |
| N-5 | `app/api/admin/token-usage/drill-down/route.ts:58-62` | `execution=single-<uuid>` depends on `token_usage.id` being a UUID. The repo has no DDL, but the evidence says it is (`credit_transactions.token_usage_id UUID REFERENCES token_usage(id)`). No test covers the `single-` shape. **QA:** open one single-call execution row live and confirm there is no 400 | Low |
| N-6 | `BusinessOsPanel.tsx:33-39, 184` | `SUMMARY_ERROR_COPY` is not pinned to the summary route's codes the way `accountLookup.contract` pins the entitlements codes. The "5,000 calls" copy duplicates `LLM_USAGE_LIMITS.READ_CEILING`, which the panel cannot import under its source guard. A future tidy-up could return the ceiling in the payload | Info |

#### Optimisation Suggestions (non-blocking)
- The drill-down still shows "vs previous period" percentages when either read may be truncated. This is accepted under U-5; OI-P2's fix shape already covers it.
- `supabase.auth.admin.listUsers()` in `users/route.ts:157` uses the default page size, so emails beyond the first page show "N/A". This is pre-existing and was already recorded as debt in the workplan review.
- The per-row `<details>` block in `users/page.tsx` has inconsistent JSX indentation. Style only.

#### Owed before merge (not code)
- **TL:** CLAUDE.md still says "7 handlers still hand-roll" and "72 admin handlers" (C-6(e)). The user decides before merge, or the PR body records the drift.
- **BA:** the requirement's change history should record U-1 to U-5, and that C-10 holds only below 1,000 rows.

### Code Approved for QA: **Yes.** N-1 should be fixed before the PR opens (comment and doc only; it does not need SA re-review). N-2 to N-6 may be fixed or recorded at Dev's discretion. N-5 is added to QA's live checks.

---

## QA Testing Report

**QA — 2026-09-25**
**Test mode:** full
**Strategy used:** A (unit: event audience, repositories) and B (route integration). B used mocked repositories and, new with this report, the real repositories and the real supabase-js client over a stubbed `fetch`, so the exact PostgREST request is asserted. There were no live checks: this session had no sanctioned read-only script, so nothing touched production. Every live check is listed below as owed by the user
**Focus:** api, security, schema, ui (render tests only)
**Skipped:** E2E (not set up in this repo); the live "totals match" and browser checks (production, owed by the user, M-1 to M-14); `npm run schema:check` (the worktree has no `.env.local`; Dev's T0a zero-row selects stand)
**Input source:** prompt keywords (TL brief), plus workplan §6 and the SA conditions
**Where:** worktree `neuronforge-admin-bos-reorg`, branch `feature/admin-bos-step2` @ `f44fec53` (4 local commits). The main checkout was not touched. No database writes and no production reads

### Gate results (real output)

| Check | Result |
|---|---|
| `npx jest app/admin lib/audit app/api/admin lib/repositories lib/admin lib/business-os/usage` (as delivered) | **81 suites: 80 passed, 1 failed. 1,593 tests: 1,592 passed, 1 failed.** Matches Dev §12.4 |
| Same command, with QA's 3 new suites | **84 suites: 83 passed, 1 failed. 1,629 tests: 1,628 passed, 1 failed** (+36 QA tests, all green) |
| C-13 parked red test | `tokenUsageRepository.contract.test.ts:84` › "pins every public method and its arity". On **this branch**: 1 failed / 4 passed, and the diff is one extra name, `summariseFeatureAllAccountsInWindow`. On the **base `ddcbb43d`**: **1 failed / 4 passed, with the identical one-line diff**. The base run used a temporary detached worktree in the session scratchpad, removed afterwards; the branch worktree was never modified. Same single assertion, no second reason ✅ |
| `npm run test:authz-guard` | **106 / 106 passed** |
| `npm run typecheck:bos-llm` | **passed**: 247 files, 28 errors, 0 new. Re-run with QA's tests: **249 files** (two QA tests import in-scope routes), **0 new**. Baseline untouched |
| `npm run check:bos-llm-literals` | **passed**: 45 files, 2 exempt, 0 violations |
| ESLint, every `.ts`/`.tsx` file in `ddcbb43d..HEAD` | **0 errors**, 35 warnings (pre-existing `any` / unused). QA's 3 new files: clean |
| `next build` (CI placeholder env from `build.yml`) | **exit 0**, "Compiled successfully". `/admin/analytics`, `/admin/audit-trail`, `/admin/users` and the new summary route build as dynamic (ƒ). The 56 `DYNAMIC_SERVER_USAGE` log lines come from static probing and are pre-existing |

### Test Coverage

| Acceptance criterion (requirement §7 Slice 2) | Tested? | Result | Notes |
|---|---|---|---|
| BOS preset totals match the LLM usage report for the same window | ⚠️ | Partial | At code level, the route test proves that totals = `computeAreaTotals(classifyCallRow(rows))`, over a fixture with current, legacy, bare `business-os` and typo rows. The live comparison is **owed (M-9, M-10)**, and it holds **only below 1,000 rows** (OI-P1, parked; Dev measured 7,658 / 3,015 rows in the last 30 days) |
| Legacy-tagged BOS rows are included | ✅ | Pass | QA wire test: **both** ledger reads send `or=(feature.like.business-os*,feature.in.("insight-generation","correlated-insight-generation","health-summary-generation","business-os","landing-page-generation","lead-reply"))`. It is built from `bosRowFilter()`, never from the request |
| The panel shows plan/cohort and "which layer decided" exactly as the entitlements API returns them | ✅ | Pass (render) | The panel renders the extracted `EntitlementSnapshot` from the unchanged entitlements route (F-5/F-6). The render test checks tier, cohort and `decidedBy`. Live cross-check owed (M-4) |
| No prompt, message body or owner text is displayed | ✅ | Pass | The route test injects `prompt`, `message` and `callNames`. **QA added:** a `details` value stored as a string (older rows) is dropped entirely; owner text in an allow-listed key is capped at 80 characters; wrong types become null; unlisted keys (`outcome`, `models`) never appear. The reads are allow-listed: 4 + 4 columns, plus the 17-column ledger list. The QA wire test confirms no `*` in the select and no payload, metadata or error column |
| Non-admin access is refused | ✅ | Pass | All four routes return 401 when signed out and 403 for a non-admin, with **zero reads before the gate**. Summary: zero repository calls. Users: **QA added** zero requests of any kind, even with a hostile search. Audit trail: `auditAdminGate.test.ts` plus the ordering tests. Drill-down: no ledger read. Pages: `app/admin/layout.tsx` calls `requireAdminPage()` first (source guard). Authz guard 106/106 |
| The Action Type dropdown shows no AgentsPilot-only events | ✅ | Pass | QA's independent count via `tsx`: the operator list has **73 options** (15 + 58) and **0** `agentspilot` events; the no-argument list still has 157. The render test confirms the DOM |
| "All Actions" still returns every row | ✅ | Pass (code) | The page sends no `action` when "all" is selected. Route test: `action=all` → no `.eq`. The route never filters by audience: the hidden `AGENT_CREATED` still filters. The live row-count comparison is owed (M-12) |
| Every catalogue event is classified; the test fails on an unclassified one | ✅ | Pass | 157 events → **15 bos / 58 shared / 84 agentspilot**, 0 untagged (QA's own count). **Negative test:** QA temporarily added `QA_TEMP_UNTAGGED_EVENT` to `AUDIT_EVENTS`. `eventAudience.test.ts` then **failed** on "tags every registered event" and on the 15/58/84 pin (2 failed / 62 passed across the 5 audit suites). The event **stayed visible** in the operator dropdown (74 options, the temporary event included). Reverted with `git checkout`; the SHA-1 of `events.ts` was identical before and after (`83c7c910…`) |
| Happy path plus one failure path tested | ✅ | Pass | Every new or changed route has happy, 401, 403, 400 and 500-without-detail tests (see the per-route table) |

**Per-route matrix** (✅ = asserted by a test; *QA* = test added by QA)

| Route | Happy | 401 | 403 | Nothing read before the gate | 400 (Zod) | No detail outside development |
|---|---|---|---|---|---|---|
| `GET /api/admin/users` | ✅ | ✅ | ✅ | ✅ (+*QA*: no request at all, hostile search) | ✅ status, sortBy, sortOrder, length, control character (+*QA*: newline) | ✅ 500 in production and development |
| `GET /api/admin/audit-trail` | ✅ incl. `user_id` | ✅ | ✅ | ✅ | ✅ `user_id=abc`, page, dates, action shape, severity, page size; 401/403 beat 400 | ✅ 500 and 400 |
| `GET /api/admin/token-usage/drill-down` | ✅ (+*QA* wire) | ✅ | ✅ (403 beats 400) | ✅ | ✅ scope, period, user, agent, category, breakdownBy, date order, control character | ✅ fixed 500 body; 400 without details |
| `GET /api/admin/business-os/accounts/[accountId]/summary` | ✅ | ✅ (+*QA*: beats 400) | ✅ (+*QA*: beats 400) | ✅ zero repository calls | ✅ (+*QA*: `' OR 1=1`, `../`, UUID with a suffix) | **Gap closed by QA:** the top-level `catch` (a *thrown* error) was untested. *QA:* production returns only `{ success:false, error:'Internal server error' }`; development adds the details |

**Search injection (task 3).** The new suite `app/api/admin/users/__tests__/searchInjection.qa.test.ts` drives the real route through the real `UserProfileRepository` and `BusinessProfileRepository` and the real supabase-js client, capturing each PostgREST URL. It tries 14 hostile terms: `acme,id.neq.0`, `acme)`, `(acme`, `or=(id.neq.0)`, `acme%),id.neq.(x`, `x,and(id.gt.0,id.lt.z)`, `%`, `_`, `a\b`, `*`, `x&or=(id.gt.0)&id=eq.1`, `"acme","x"`, `acme%2Cid.neq.0` and `full_name.eq.x`. For every one:
- exactly 3 GETs are sent (business name, `full_name`, `company`);
- there is **no `or` or `and` parameter**, and no parameter outside the allow-list;
- no `id` filter is added;
- the term arrives byte-for-byte as one escaped `ilike.%…%` operand.

A full UUID adds exactly one `id=eq.<uuid>`; a UUID followed by `,id.neq.0` does not. **The injection is closed.** There is one behaviour edge (E-1, `*`).

**2a.** The toggle defaults on: in `scope.render.test`, the first request carries `scope=bos`. The route's own default stays `all` (QA wire test). `bosRowFilter()` is used, and legacy rows are included (see above). The note "Totals may be incomplete above 1,000 calls" is always shown, and a stronger banner appears when `possiblyIncomplete` is set (render test). Cost is labelled "USD, estimated".

**2b.**
- No prompts or owner text (see above).
- The "USD (estimated)" label is shown, and the source guard shows no read of `business_profiles.currency` or `LanguageContext`.
- A row with `business: null` says "No Business OS business", and one whose lookup failed says "Business unknown" (route and render tests).
- **Batched lookup:** `findAdminIdentitiesByUserIds` is called once for the whole list (route test: called once, with every id). The repository makes one `.in()` per 200 ids (201 ids → 2 queries).
- The panel makes 2 requests per **expanded** row and none per listed row.

### Issues Found

#### Bugs (must fix before commit)
None. No High or Medium defect found.

#### Performance Issues (should fix)
None new. OI-P1 (the 1,000-row cutoff) is parked by the user; the on-screen notes are present and tested.

#### Edge Cases (nice to fix)
1. **E-1: `*` acts as a wildcard in the Businesses search.** `lib/repositories/UserProfileRepository.ts:111`: `escapeIlikePattern` cannot escape `*`, and PostgREST turns `*` into `%` inside `like`/`ilike`. Searching `*` lists every account, and `a*b` matches `a…b`. This is not an injection (the operand stays one parameter, and the route is admin-only), but the result is surprising. Severity: Low. Fix shape: strip `*`, or refuse it in the Zod schema (`app/api/admin/users/route.ts:40`)
2. **E-2: `execution=single-<id>` assumes `token_usage.id` is a UUID.** `app/api/admin/token-usage/drill-down/route.ts:61` (SA N-5). Not verified live. If the assumption is wrong, opening a single-call row returns 400 and the page shows its generic error. Severity: Low (the evidence says UUID). Owed: M-8
3. **E-3: a reversed custom date range now returns 400**, shown as the generic "Failed to fetch data" instead of an empty result. `drill-down/route.ts:72` + `app/admin/analytics/page.tsx:283-285`. Severity: Low
4. **E-4: business-name matches are capped at 50.** `app/api/admin/users/route.ts:111` (SA N-3a). Severity: Low
5. **E-5: a dimension value longer than 200 characters** (e.g. a long endpoint path) returns 400 on drill-in. `drill-down/route.ts:40`. Severity: Low
6. Already raised by SA, confirmed by QA, not repeated here: N-3b (null sort order), N-4 ("Unnamed business" header above an error), N-6

Pre-existing and outside this slice, recorded only:
- The drill-down's execution-detail path (`drill-down/route.ts:990-999`) still selects agent `user_prompt`, `system_prompt` and `input_data` (AgentsPilot view, unchanged).
- The audit route's `.from('users')` join always yields null names (D-9 / OI-18).

### QA test files added (in the worktree, uncommitted, for Dev/RM to include)

| File | Tests | Covers |
|---|---|---|
| `app/api/admin/users/__tests__/searchInjection.qa.test.ts` | 21 | Wire-level injection probes (14 terms + 2 id cases); 400s before any request; 401/403 with zero requests |
| `app/api/admin/token-usage/drill-down/__tests__/wire.qa.test.ts` | 4 | The `or=` group on both reads, with every legacy value; explicit select; a hostile `feature` value stays on `.eq`; `scope=all` and the default send no predicate |
| `app/api/admin/business-os/accounts/[accountId]/summary/__tests__/route.qa.test.ts` | 11 | Thrown-error 500 (production and development); 401/403 beat 400; hostile ids; the projection against string `details`, wrong types, oversized values and unlisted keys; the spend error block carries no text |

### Manual checks owed by the user (after deploy, signed in as a platform admin)

1. **M-1** The sidebar and page title say **Businesses**. Each row shows the business name and the user name. An AgentsPilot-only login says "No Business OS business"
2. **M-2** Search for a known business name and for a person's name: both are found. Then search for `acme,id.neq.0`, then for `%`: no error, and no unrelated rows. (`*` returns everyone, see E-1)
3. **M-3** Expand a Business OS row. The **Business OS** panel comes first, showing the business, vertical, plan, 30-day spend "USD (estimated)" and recent failures. "AgentsPilot details (agents and agent executions)" is **closed**. Plugins, subscription, login activity, the audit log and "AI spend, all products (30 days; may be incomplete above 1,000 calls)" are open. **No prompt or message text appears anywhere in the panel**
4. **M-4** For the same account, open `/admin/business-os-tiers`, look the account up, and compare tier, cohort, state and each capability's "decided by" with the panel. They must be identical
5. **M-5** Expand an AgentsPilot-only login. It shows "Not a Business OS account…", with no spend and no failures
6. **M-6** In the panel, click "View in audit trail", then one failure row's link. The audit trail opens filtered to `BUSINESS_AI_ACTION_FAILED`, with an "Account xxxxxxxx…" chip (and the group id in the search box). Clicking × on the chip shows every account again
7. **M-7** Click "Open in AI cost & usage". `/admin/analytics?scope=bos&user=…` opens with the toggle on and scoped to that account
8. **M-8** On `/admin/analytics`, drill Provider → Model → Activity → Agent → Execution, then open one **single-call** execution row (`single-…`). It must not error (E-2 / SA N-5). Also apply a custom date range
9. **M-9** Totals match (C-10). Pick a Business OS account with fewer than 1,000 calls, and a **fixed past** window of 7 days or less. The totals {calls, tokens, cost} from `drill-down?scope=bos&user=<id>&dateFrom=<start>&dateTo=<end>` must equal `areaTotals.total` from `/api/admin/business-os/llm-usage?accountId=<id>&since=<start>`, compared at display precision. Repeat for a second account
10. **M-10** The panel's 30-day spend equals `drill-down?scope=bos&user=<id>` over the same 30-day window (transitive to M-9; holds only below 1,000 calls)
11. **M-11** A fresh `/admin/analytics` opens with **Business OS only ON**. It shows "Includes legacy-tagged Business OS rows…" and "Totals may be incomplete above 1,000 calls…". With the default 30 days, the stronger "reached 1,000 calls" banner is expected (7,658 / 3,015 rows). Turning the toggle off shows "Both products", with totals at least as large as the Business OS totals
12. **M-12** On `/admin/audit-trail`, the Action Type list has no Agent, AgentKit, Pilot, Memory, Workflow or Approval groups, and has "Business OS AI" and "Business OS Entitlements". "BOS AI failures" filters in one click. With **All Actions** over a fixed window, `pagination.total` equals the count before deploy for the same window
13. **M-13** Open `/admin/audit-trail?action=AGENT_CREATED`. The select shows "… (hidden from this list)" rather than a blank, and the rows are filtered
14. **M-14** Sign in as a **non-admin** (or use a private window). `/admin/users` is refused, and `GET /api/admin/business-os/accounts/<any-uuid>/summary` returns 403 (401 when signed out)

### Final Status
- [x] All acceptance criteria pass at code level. The two live criteria ("totals match" and the "All Actions" row count) are owed by the user as M-9, M-10 and M-12. **Verdict: PASS.** Ready for commit, with the three QA test files included
- [ ] Issues found — Dev must address before commit (none blocking; E-1 to E-5 are Low)
- Owed before merge, not QA's to close: SA N-1 (the stale "65" prose), the CLAUDE.md "7 handlers / 72" drift (C-6e, TL and the user), and the requirement change history (BA)

---

## Commit Info

*(RM to populate)*

---

## Change History

| Date | Change | Details |
|------|--------|---------|
| 2026-09-25 | Created (Dev) | Slice 2 (2a, 2b, 2c) planned as one PR against `ddcbb43d`. 22-point verification log, including: the drill-down's silent 1,000-row cap (V-4), its comparison read ignoring four filters (V-5), the LLM usage report being per account and at most 7 days (V-3), the audit route being one of the 7 inline admin checks (V-7), and 157 events of which 122 have metadata (V-8). Proposes an exhaustive per-event audience map (15 BOS / 58 shared / 84 AgentsPilot), a cross-account admin analytics repository, and one summary route for the Business OS panel. 11 SA forks, 3 user questions |
| 2026-09-25 | Implemented (Dev) | Four local commits on `feature/admin-bos-step2` (2c, 2a, 2b, docs), not pushed. User decisions U-1 to U-5 applied: rename with business + user name (touching the users list route: Pino, leaks, Zod, injection fix, batched lookup), BOS lens on by default, C-1/C-2 waived and recorded as OI-P1/OI-P2 (PARKED). Deviations D-1 to D-9. Measured authz counts 80 = 74 + 6 + 0 over 51 files (the register had fallen 7 handlers behind before this PR). Verification in §12.4 |
| 2026-09-25 | Review follow-ups (Dev) | N-1, N-2, N-3 (a and b), N-4, N-6, E-1, E-3 and E-4 fixed as listed in §12.6; E-2/N-5 and E-5 left as agreed. QA's three test suites committed; their `escaped()` helper now expects `*` as `_`. Jest 84/85 suites, 1,645/1,646 tests (only the parked C-13 failure) |
| 2026-09-25 | QA | **PASS.** Jest 83/84 suites and 1,628/1,629 tests, with 36 new QA tests in 3 suites. The one failure is the parked C-13 assertion, identical on base `ddcbb43d`. Authz guard 106/106; `typecheck:bos-llm` 0 new (249 files); literal gate 0; ESLint 0 errors; `next build` exit 0. Wire-level injection probes (14 terms) confirm the search is closed. 157 events split 15/58/84; a temporary untagged event failed the test and stayed visible (reverted). No bugs; edge cases E-1 to E-5 (Low). Live checks M-1 to M-14 owed by the user |
| 2026-09-25 | SA code review | **Approved with nits.** SA re-ran the suites: Jest 80/81 suites and 1,592/1,593 tests, the one failure being the parked contract assertion, unchanged (C-13). Authz guard 106/106. `typecheck:bos-llm` 0 new. Literal gate 0 violations. SA's own census gives 80 handlers = 74 + 6 + 0 over 51 files. C-1 and C-2 were waived by the user (U-5); C-3 to C-13 pass. D-1 to D-9 are accepted, including the users-list rewrite (parameterised search, batched name lookup). Nits N-1 to N-6: N-1 (stale "65" prose) is to be fixed before the PR opens; N-5 is added to QA's live checks |
| 2026-09-25 | SA workplan review | Approved with conditions C-1 to C-13. All 11 forks ruled, following Dev's recommendations with corrections: F-3 has no identifier regex on dimension values, and F-9 also shares the category post-filter. R-1 was measured at 8 errors, all removed by T8, so it drops from High to Low. New findings: the comparison read also skips the category filter; the Users all-products spend is capped at 1,000 rows (C-9); CLAUDE.md's "7 handlers" figure goes stale on merge (C-6e). Technical implications of Q-1 to Q-3 recorded; the questions themselves were left to the user |
