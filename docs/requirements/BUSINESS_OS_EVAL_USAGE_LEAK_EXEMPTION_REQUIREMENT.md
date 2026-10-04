# Requirement: Business OS Chat Eval — Leak-Check Exemption for Test Runs

> **Last Updated**: 2026-10-04

**Created by:** BA
**Date:** 2026-10-04
**Status:** ⏸️ PARKED by the user on 2026-10-04. Requirement approved with conditions (SA, 2026-10-04); no workplan or code yet. Resume at: answer BQ-1 and BQ-2 (both still open), then Dev writes the slice 1 workplan against SA conditions C-1 to C-14.

## Overview

The Business OS chat golden set (`npm run eval:chat`, `tests/business-os-chat/run-eval.ts`) makes real AI calls on a real prod account without a chat turn, so the nightly credit leak check reports that account as a **leak**. The user decided on 2026-10-04 to **exempt test runs**. Eval calls must be recognisable as internal test traffic. The leak check must list them as an accepted known path, still recorded and visible. No one's credits are charged. The non-negotiable condition is that **real traffic cannot carry the exemption**.

## Table of Contents

- [Background (verified 2026-10-04)](#background-verified-2026-10-04)
- [User Stories](#user-stories)
- [Functional Requirements](#functional-requirements)
- [Non-Functional Requirements](#non-functional-requirements)
- [Acceptance Criteria](#acceptance-criteria)
- [Slices](#slices)
- [Out of Scope / Future Roadmap](#out-of-scope--future-roadmap)
- [Open Questions](#open-questions)
- [Notes on Integration Points](#notes-on-integration-points)
- [SA Review](#sa-review)
- [Change History](#change-history)

---

## Background (verified 2026-10-04)

| # | Fact | Source |
|---|---|---|
| B-1 | The leak check matches `token_usage` rows to charge rows per (account, group id ↔ `session_id`). A Business OS call with no group id counts as `ungroupedCalls`. A group with usage but no charge counts as `uncharged`. Either one makes the account `leak`. | `lib/business-os/credits/creditLeakCheck.ts` ~line 662 (credit deduction slice 4b); [slice 4 workplan](/docs/workplans/BUSINESS_OS_CREDIT_DEDUCTION_SLICE_4_WORKPLAN.md); [deduction requirement](/docs/requirements/BUSINESS_OS_LLM_DEDUCTION_LAYER_REQUIREMENT.md) |
| B-2 | The only exemption today is `KNOWN_PATH_KEYS`. It is built from `BOS_KNOWN_NON_CATALOG_COMPONENTS` entries with `exemptFrom: 'missing_group_id'` and keyed by `feature\|component` (e.g. `IntentParser`). | `lib/business-os/llm/callCatalog.ts` |
| B-3 | The eval calls `getBizQLPlanner().plan({ message, userId, language, timezone, skipCache })` directly with **no turnId**. The resulting `planner`, `verified_question_embedding` and `plan_cache_store_embedding` rows have NULL `session_id`. | `tests/business-os-chat/run-eval.ts` |
| B-4 | Multi-turn (`turns`) scenarios POST to the real chat-v4 route. That route mints a turn id and charges normally, so these are correct and not in scope. | same |
| B-5 | Account `b509258d-0f79-43df-9ac0-0942086b0b58`, eval runs on 2026-10-03/04: 473 Business OS usage rows ($0.2391), of which 389 are ungrouped ($0.1927). All are `business-os-chat`: `planner` 216, `verified_question_embedding` 108, `plan_cache_store_embedding` 65. The 23 charge rows in the same window are route turns and are billed correctly. | prod measurement |
| B-6 | The nightly leak check covers only the **previous UTC day** (`previousUtcDay`, cron route line 77). The 31 days is `PERIOD_LOOKBACK_DAYS`, which only controls which accounts are listed. So b509258d is reported as `leak` on the nights covering 2026-10-03 and 2026-10-04. It is also reported by any on-demand run (max 7 days) whose window includes an eval day, and on the night after **every eval run until slice 2 is deployed**. **That interim is explained and accepted** (corrected per SA C-11). The rows are the usage record and **must not be deleted**. | SA-1 fact check |
| B-7 | Just passing a turnId from the eval does **not** fix it. The ungrouped calls would become `uncharged` groups, which is still a leak. | creditLeakCheck.ts classification |
| B-8 | By default the eval uses whichever prod account has the most `crm_contacts` (`pickUser`); `--user=<uuid>` overrides that. There is only one database (prod). | `run-eval.ts` |
| B-9 | Slice 4 workplan note N-9 said 2,830 NULL-session chat rows from 2026-09-22..28 "look like golden-set runs". The eval is now **confirmed** as their source. | slice 4 workplan N-9 |

---

## User Stories

- As the **platform owner**, I want eval runs to stop showing up as credit leaks, so that a `leak` status always means a real billing gap.
- As the **platform owner**, I want eval spend to stay recorded and visible, so that test cost is never hidden.
- As the **platform owner**, I want a guarantee that no customer request can use the test exemption to get free AI calls.

---

## Functional Requirements

| # | Requirement |
|---|---|
| FR-1 | **Safety property (hard).** Real production traffic must not be able to carry the eval exemption marker, whether that traffic is an HTTP request to any route or a cron/background job. This must be enforced by construction, not by convention. A client-supplied field, header, query param or body value **must not** be able to select it. |
| FR-2 | Every AI call the eval makes outside the chat route records a `token_usage` row as it does today: `callWithTracking`, attributed to the account it ran for, with real tokens and USD. |
| FR-3 | Eval calls carry a **run-scoped grouping id** (one per run, or per scenario, SA to choose), so one run's spend can be traced as a unit. NULL `session_id` is no longer produced by the eval. |
| FR-4 | The leak check classifies eval traffic as a **known path**, not `ungroupedCalls`/`uncharged`/`undercharged`. An account whose only gap is eval traffic reports `clean`, with known-path lines. |
| FR-5 | The leak check result and the admin leak tab show eval traffic as **its own known-path line** (call count, USD), separate from other known paths such as `IntentParser`. Eval spend never disappears from view. |
| FR-6 | The leak check stays **read-only**. It writes nothing and charges nothing. |
| FR-7 | Eval traffic is **not charged**. No charge rows, no credit movement. |
| FR-8 | The existing rows (B-5, B-9) are left untouched. They will not be reclassified retroactively unless SA shows that can be done read-only and without editing rows. The b509258d finding is accepted as-is (B-6). |
| FR-9 | Every other leak-check rule is unchanged. Real ungrouped or uncharged calls on any feature/component still produce `leak`. |

### Mechanism (SA ruling 2026-10-04: M-C chosen)

| Option | Idea | Ruling |
|---|---|---|
| **M-C (CHOSEN)** | An eval-traffic `AsyncLocalStorage` scope in `lib/ai/`, beside `usageScope.ts`. Only the eval can open it. The opener throws if the run id is not a UUID, if inside a charged usage scope, or if `NEXT_RUNTIME` is set. The stamp (run id) is written to `token_usage.metadata` **only** in `AIAnalyticsService.trackAICall`, which always strips a caller-supplied key and never stamps inside a charged action. The leak check reads that one key and classifies stamped rows **first**, as their own known-path line. Full detail: SA-2, C-1..C-10. | Approved with conditions |
| M-A | A distinct catalogued eval-only call name or component. | **Rejected:** eval-only call names would resolve different model settings from production and need test-only planner plumbing. A known-path component label exempts any row that carries it, which is enforcement by convention. |
| M-B (env-var form) | A marker set only outside the server, switched by an env var. | **Rejected:** an env var that *enables* the exemption could be set on Vercel, which is the loophole FR-1 forbids. (M-C is M-B done by construction: env can only disable it.) |
| Other | Internal-account allow-list; a marker in `session_id`. | **Rejected:** an allow-list masks real leaks on that account. `session_id` is client-controlled via `x-correlation-id`, so a marker there can be forged. |

**Constraints from the `bos-llm-call-standards` skill, which apply to every option:** call names come from the catalog and are never renamed; no hand-typed `feature`/`component` strings; cost is still tracked through `callWithTracking`; DB-resolved model settings still apply; the leak check stays read-only.

---

## Non-Functional Requirements

- **Security:** FR-1 is a billing-path control. A loophole there means free AI usage for anyone who can reach it. SA review is mandatory, and the tenant-isolation and identity rules in CLAUDE.md apply.
- **Performance:** no added work on the chat request path. Any new CI guard must finish inside the existing critical path (no added CI time).
- **Observability:** eval spend can be queried per account and per run id.

---

## Acceptance Criteria

- [ ] **AC-1 (FR-1):** per C-8. Tracker-level tests show that no request-derived input and no charged action can produce a stamped row: (a) caller-supplied `metadata[key]` is stripped when there is no scope; (b) eval scope + active usage scope gives no stamp; (c) eval scope alone stamps the run id; (d) the opener throws with `NEXT_RUNTIME` set, inside a usage scope, and for a non-UUID id; (e) a fire-and-forget call started inside the scope is still stamped after `fn` settles. Plus one chat-v4 spoof test (spoofed headers/body such as `x-eval-run-id`, `evalRunId`) asserting that no tracked call carries the key.
- [ ] **AC-2 (FR-1):** A guard (test or CI check) fails if production code under `app/` or `lib/` (outside the agreed eval entry point) references the eval exemption marker.
- [ ] **AC-3 (FR-2/3):** After one run, every single-turn eval row has the account's `user_id`, real USD, a non-NULL `session_id` (the scenario's turn id), and the run id under the eval key. Zero-token `BizQLPlanCache` rows on cache hits are expected.
- [ ] **AC-4 (FR-4/5):** A unit test feeds the leak check synthetic eval rows. The account comes back `clean`, with a separate eval known-path line showing the correct call count and USD. The eval line is also separate from `IntentParser` in both the account finding and the run-level `knownPaths` aggregate.
- [ ] **AC-5 (FR-9):** Unit tests confirm that ungrouped and uncharged non-eval rows on the same account still produce `leak`.
- [ ] **AC-6 (FR-6/7):** No charge or ledger rows are written for eval calls, and the leak check performs no writes.
- [ ] **AC-7:** A live check after merge: one `npm run eval:chat` run, then a leak-check dry read on that account shows a `clean` status for the run window with an eval known-path line.

---

## Slices

Each slice is small (a few days) and reuses existing infra: the `usageScope.ts` pattern, `trackAICall`, the known-path classification, and the admin leak tab.

| Slice | Scope title | Contents | Done when |
|---|---|---|---|
| **1** | Eval scope, stamp + leak-check known path | M-C per C-1..C-8, C-10, C-14. Eval scope module in `lib/ai/`; stamp in `trackAICall`; the leak check reads the one key and puts stamped rows first on their own known-path line; source guard (AC-2, C-7). Tests: tracker + chat-v4 spoof (AC-1, moved here per C-13), leak check (AC-4, AC-5 incl. C-6, AC-6). QA includes a screenshot of the admin leak tab showing the eval line (closes slice 3). | AC-1, AC-2, AC-4, AC-5, AC-6 green; SA code review passed |
| **2** | Eval wiring + run-scoped grouping | Per C-9: wrap only the single-turn `plan()` path in `withEvalTraffic`; pass `turnId: newBosGroupId()` per scenario execution; one run id per invocation; print both ids; bounded drain of pending cache stores before exit. No change to the route path. **Gated on BQ-1/BQ-2 (C-12).** | AC-3 green; live check AC-7 passed |
| **3** | Admin visibility | Expected to be a **no-op** (C-13): `LeakCheckPanel` already renders known paths generically, so the reserved label shows as its own row. It is closed by the screenshot in slice 1 QA. It only becomes a separate cycle if the user wants a different label or styling. | FR-5 verified in the slice 1 QA screenshot |

---

## Out of Scope / Future Roadmap

- **Billing the eval.** The decision is not to charge it.
- **Dedicated billed test account.** Considered and deferred. Prerequisites if it is revisited: (1) create the account, (2) give it a plan and credits, (3) seed its data (incl. Hebrew-named contacts, via `tests/business-os-chat/seed-fixture.ts`), (4) make it the eval's default instead of `pickUser`.
- Changing any other leak-check rule.
- The 6 known planner defects found by the golden set.
- Other eval-tooling issues (cache behaviour, noise band, flakiness reporting).
- Deleting or rewriting historical `token_usage` rows (FR-8).

---

## Open Questions

- [ ] **BQ-1 (business, for user):** Whose account is `b509258d-0f79-43df-9ac0-0942086b0b58`? If it belongs to a real customer, test runs have been charging AI time to their record and should stop using it. *Suggested resolution:* the user confirms the owner. If it is a customer, BQ-2 becomes mandatory now. (raised by: BA | status: pending; user unsure on 2026-10-04, open at park)
- [ ] **BQ-2 (business, for user):** Should the eval keep picking "the account with the most contacts" by default, or always run on one named internal account? *Suggested resolution:* always run on a named internal account, failing with a clear message if none is given. This avoids ever landing on a customer account by accident, and is independent of the deferred billed test account. (raised by: BA | status: pending; no preference given 2026-10-04, SA recommends the suggested resolution)
  - **SA C-12: BQ-1 and BQ-2 must be answered before slice 2 merges.** After slice 2 ships, an eval run on a customer's account will no longer show as a leak, which removes the last automatic signal that tests are running on someone else's data. Multi-turn scenarios also spend **real credits** on whichever account runs them, because they call chat-v4 in-process (B-4). SA recommends BQ-2's suggested resolution: an explicit internal account, failing closed.
- [x] **SQ-1 (SA):** Which mechanism (M-A / M-B / M-C) satisfies FR-1 by construction, and what is the guard for AC-2? **Answered (SA-2, C-7):** M-C (eval scope + tracker stamp). The guard is a Jest source scan in `lib/business-os/llm/__tests__/`, inside the required CI job. (raised by: BA | status: answered)
- [x] **SQ-2 (SA):** Group id granularity: one per run or one per scenario? **Answered (SA-3):** one group per scenario execution (`session_id`) and one run id per invocation (the stamp). Both are printed. (raised by: BA | status: answered)
- [x] **SQ-3 (SA):** Can the historical NULL-session eval rows (B-5, B-9) be recognised read-only, or does the exemption only apply from deploy onward? **Answered (SA-4):** deploy onward only. Any heuristic would also match real ungrouped calls. Old findings are accepted (B-6). (raised by: BA | status: answered)

---

## Notes on Integration Points

| Area | Location | Impact |
|---|---|---|
| Call catalog / known paths | `lib/business-os/llm/callCatalog.ts` (`BOS_KNOWN_NON_CATALOG_COMPONENTS`) | Only the reserved known-path label constant (SA C-5). NOT the marker: no catalog, call-name or `KNOWN_PATH_KEYS` change (SA C-3) |
| Leak check | `lib/business-os/credits/creditLeakCheck.ts` (`KNOWN_PATH_KEYS`, classification) | New known-path line; status rule unchanged otherwise |
| Planner | `getBizQLPlanner().plan()` | Receives group id and marker from the eval; must not accept them from routes |
| Eval harness | `tests/business-os-chat/run-eval.ts` (`pickUser`, single-turn path) | Slice 2 wiring |
| Admin leak tab | admin credit-leak view (slice 4b) | Slice 3 display |
| Table | `token_usage` | Rows still written; no schema change expected (SA to confirm) |

---

## SA Review

**Reviewed by SA, 2026-10-04**
**Verdict:** APPROVED WITH CONDITIONS (C-1 to C-14 below). The business decision and FR-1 to FR-9 stand. The mechanism is ruled below (SQ-1). Slice 1 may go to a Dev workplan once the conditions are folded in. Slice 2 may not merge until BQ-1/BQ-2 are answered (C-12).

### SA-1. Fact check (B-1 to B-9)

| # | Verdict | Notes (verified in code 2026-10-04) |
|---|---|---|
| B-1 | ✅ Correct | `classifyLeakGroups`: a row with NULL/empty `session_id` and spend is `ungroupedCalls` (line ~322). A group with spend and no charge is `uncharged` (line ~398). Status rule at ~line 662: `uncharged + undercharged + ungroupedCalls > 0` gives `leak`. |
| B-2 | ✅ Correct | `KNOWN_PATH_KEYS` (line ~169) holds only entries with `missing_group_id`, which today means `business-os-chat\|IntentParser`. `BizQLPlanCache` is exempt only from `unknown_call_name`. The known-path branch runs **before** the `session_id` test and matches on `feature\|component` only. It reads nothing else from the row. |
| B-3 | ✅ Correct, one addition | `run-eval.ts:528` calls `plan()` with no `turnId`. `Planner.ts` passes `request.turnId` as the group to the planner call (`buildBosCallContext`, line ~614-619), to `VerifiedQuestions.similar` (line ~449, then `buildBosCallContext` at `VerifiedQuestions.ts:90`), to the cache lookup (line ~260) and to the fire-and-forget cache store (line ~792). The embeddings reach `EmbeddingService` through `toEmbeddingAttribution`, which sets `sessionId: turnId` (`EmbeddingService.ts:127`). So **one existing parameter groups all of them**, and the planner needs no plumbing. Addition: without `--no-cache`, `plan_cache_lookup_embedding` also occurs. With a `turnId`, a cache hit also writes the zero-token `BizQLPlanCache` row (`recordCachedTurn`, which today is skipped because there is no `turnId`). |
| B-4 | ✅ Correct, with a sharper reading | Multi-turn scenarios do not go over HTTP. They import the chat-v4 `POST` in-process (`run-eval.ts:792`) and call it. It still runs `runAiAction` with its own turn id, so these turns **are charged in real credits** to the eval account. That is correct for the leak check, but it bears on BQ-1. |
| B-5 | Not re-measured | Prod measurement. It is consistent with the code path above. |
| B-6 | ⚠️ **Inaccurate detail** | The nightly window is the **previous UTC day** (`previousUtcDay`, cron route line 77). 31 days is `PERIOD_LOOKBACK_DAYS`, which only affects how accounts are listed. b509258d is therefore reported as `leak` by the nightly runs that cover 2026-10-03 and 2026-10-04, by any on-demand run (max 7 days) whose window includes an eval day, and by **every future night after an eval run until slice 2 is deployed**. The acceptance (B-6) should cover that interim too. |
| B-7 | ✅ Correct | With a `turnId` but no charge, the group is `uncharged`, which is still a leak. |
| B-8 | ✅ Correct | `pickUser()` ranks by `crm_contacts` count, and `--user=` overrides it. |
| B-9 | Accepted | Consistent with B-3. Not re-measured. |

**Extra facts the mechanism depends on:**

- **The client chooses the group id.** chat-v4 uses `x-correlation-id` as the turn id whenever it is a UUID (`route.ts:391-392`). So `session_id` is caller-controlled on the main chat route, and **any marker encoded in the group id is forgeable**. That covers a reserved UUID namespace, a UUIDv5 under a constant from the (public) repo, and a prefix. Every such design is rejected. (This is pre-existing and already covered by the `sub_microdollar_reused_group` blind spot. It is not a new finding to fix here.)
- **`token_usage.metadata` (JSONB) is written in exactly one place,** `AIAnalyticsService.trackAICall` (`lib/analytics/aiAnalytics.ts` ~line 185). The caller's `metadata` is spread last there. Both `callWithTracking` and the sanctioned hand-written `recordCachedTurn` row go through it.
- **The leak check reads none of `metadata`, `activity_type`, `request_type` or `category`.** `TOKEN_USAGE_COLUMNS.call` is `id, created_at, feature, component, session_id, input_tokens, output_tokens, cost_usd, success, error_code`, and the repository header says metadata is never read. A marker therefore needs a deliberate, narrow read change. No schema change is needed.
- **The provider layer already has the scope infrastructure needed.** `lib/ai/usageScope.ts` is an `AsyncLocalStorage` scope that the provider tracker consults, and it exports `hasActiveUsageScope()`. Every charged Business OS action (`runAiAction`, including chat-v4) runs inside such a usage scope.
- **CI runs only `lib/business-os/llm/__tests__`** (`npm run test:bos-llm`, inside the required job `Type check (Business OS LLM attribution)`). The full Jest suite, including `lib/business-os/credits/__tests__`, is not run by CI. That job skips its work for changes confined to `docs/`, `scripts/`, `.claude/` or root `*.md`.
- **Only chat-v4 calls `getBizQLPlanner()`** in `app/` and `lib/`. "Every other Business OS route that calls the planner" (AC-1) is an empty set today.

### SA-2. SQ-1 ruling: the mechanism

**Rejected: M-A (eval-only call names or an eval component).**
- Call names are Layer 2 config keys. An eval-only name would resolve **different model settings** from the real `planner`, so the golden set would stop testing the production configuration. That defeats the point of the eval.
- It also needs a call-name override threaded through `PlanRequest`, `PlanCache`, `VerifiedQuestions` and `EmbeddingService`. That is production plumbing that exists only for tests, and an override parameter on the planner is exactly what a route could one day pass.
- Registering a component in `BOS_KNOWN_NON_CATALOG_COMPONENTS` with `missing_group_id` makes **every** row with that label exempt, and any code path can write a label. That is enforcement by convention.

**Rejected: M-B as an env-var switch.** An env var that *enables* the exemption could be set on Vercel. That is the very loophole FR-1 forbids.

**Rejected: an internal-account allow-list** (the leak check treats every row on listed accounts as known path). It blanket-masks real leaks on that account, including the owner's own chat traffic. It collides with the deferred dedicated-account decision and BQ-2, and with one prod DB it cannot be scoped to tests.

**Rejected: any marker in `session_id`.** It is client-forgeable (see above).

**APPROVED: M-C, an eval-traffic scope stamped by the tracker.** This is M-B done by construction, with no env switch:

1. **The scope.** A new, product-agnostic module in `lib/ai/` (beside `usageScope.ts`, same shape and same Node-only note). It holds an `AsyncLocalStorage<{ runId }>` and exports an opener, `withEvalTraffic(runId, fn)`, a reader, `currentEvalRunId()`, and the metadata key constant. The opener **throws** in any of these cases: `runId` is not a UUID; `hasActiveUsageScope()` is true; or `process.env.NEXT_RUNTIME` is set (Next sets it in every server runtime). That env check can only **disable** the scope. No env value can enable it.
2. **The stamp.** This is the only change in the write path. `AIAnalyticsService.trackAICall` builds `metadata` as today, then **always deletes** the eval key from the merged object. It writes the key back as `currentEvalRunId()` **only when** an eval scope is active **and** `hasActiveUsageScope()` is false. Consequences, by construction:
   - A caller-supplied metadata key can never survive.
   - Nothing reachable from a request can open the scope (guard, C-7).
   - A call inside a charged action (`runAiAction`) is **never** stamped, even if it is nested in an eval scope. That property covers the in-process multi-turn chat-v4 calls automatically.
3. **No change to the planner, the catalog, call names, `PlanCache`, `VerifiedQuestions`, `EmbeddingService` or `callWithTracking`.** Model settings resolve exactly as in production. The eval supplies the group through the **existing** `PlanRequest.turnId`.
4. **The leak check reads the one key** (C-4). A stamped row goes to its own known-path line, ahead of every other rule (C-5).

Why this meets FR-1 "by construction": the stamp's only source is an in-process async context. Routes, crons and background jobs never open it (C-7 guard; the opener also refuses inside a Next runtime and inside a charged action). No header, query, body field, metadata or group id is read when deciding the stamp. An infrastructure change can only switch it off. The remaining trust is the import-graph guard, which is the same kind of guarantee as the existing `serviceColumn.guard.test.ts` and the admin-authz guard. The scope reuses the `usageScope.ts` pattern (CLAUDE.md rule 7: justified, as it is the existing pattern applied a second time).

### SA-3. SQ-2 ruling: group granularity

**One group per scenario, one run id per invocation.**
- The eval mints a turn id per single-turn scenario execution, with `newBosGroupId()`, the catalog helper (Standard 3). With `--runs=N`, each repetition gets a fresh id.
- The **run id** (one UUID per `npm run eval:chat` invocation) is the stamp value, so a run is `metadata->>key = runId` and a scenario is `session_id`.
- Both ids are printed in the human output and the `--json` output, per scenario (Standard 3: log the id where it is minted).

### SA-4. SQ-3 ruling: old rows

**From deploy onward only.** Recognising the historical rows read-only would take a heuristic such as account + time window + component set. That heuristic would equally match a real ungrouped call on the same account, which violates FR-1 and FR-9. The historical rows stay as they are (FR-8). The b509258d findings for 2026-09-22..28 and 2026-10-03/04, and for any eval day before slice 2 deploys, are accepted (B-6 as corrected in SA-1).

### SA-5. Conditions

| # | Condition | Slice |
|---|---|---|
| C-1 | Implement the mechanism exactly as in SA-2: a scope module in `lib/ai/` with the three refusals (non-UUID run id, active usage scope, `NEXT_RUNTIME` set). No env var, header, request field or catalog entry may enable it. | 1 |
| C-2 | The stamp is written **only** in `AIAnalyticsService.trackAICall`, **after** the caller's metadata spread. The key is always deleted from caller-supplied metadata, and set only when the scope is active and no usage scope is. The key exists as one exported constant in the scope module, and no other file spells the literal. | 1 |
| C-3 | No change to `callCatalog.ts` call names or `BOS_KNOWN_NON_CATALOG_COMPONENTS`. Eval must **not** be added to `KNOWN_PATH_KEYS`. No new parameter on `PlanRequest`. Planner, `PlanCache`, `VerifiedQuestions`, `EmbeddingService` and `callWithTracking` stay untouched. | 1, 2 |
| C-4 | The leak check reads the key through `TokenUsageRepository`. Add one aliased JSON path to the `call` column set (e.g. `eval_run_id:metadata->>…`), add `eval_run_id: string \| null` to `LedgerCallRow`, and change the repository header from "metadata never read" to "metadata never read except this one key". Before relying on it, Dev verifies `token_usage.metadata` against the live schema (`business-os-schema-check`) and proves that the aliased select works through PostgREST with one live read. The wire-type and column tests are updated in the same slice. | 1 |
| C-5 | Classifier: the stamped-row branch is checked **first**, before `isKnownUnchargedPath` and before the `session_id` test. In-window only. Stamped rows go to a **separate** known-path line: same `feature`, and a reserved display label as `component` exported from the catalog, e.g. `'(eval traffic)'`. Parentheses and a space cannot be a snake_case catalog name. They also count in `knownPathCalls`/`usd.knownPath`, so the account shows `clean` and `hasFinding` stays true (visible). **Classification is by stamp only, never by that label**: a real row that carries the label text must not be exempt, and a test must show it. Stamped rows never join a group. | 1 |
| C-6 | Tests (AC-5 extended): (a) a group with both stamped and unstamped spend leaves the unstamped part to classify exactly as today; (b) an ungrouped unstamped row on the same account as eval rows is still `leak`; (c) a row whose `component` equals the reserved label but has no stamp is classified normally. | 1 |
| C-7 | **AC-2 guard.** It must be a Jest source guard in `lib/business-os/llm/__tests__/` so that it runs in the **required** job, with no new job and no added CI time (a file scan; state the measured runtime in the workplan). It fails if the opener is imported anywhere outside `tests/business-os-chat/**` and the scope module's own unit test, scanning `app/`, `lib/`, `components/` and `scripts/`. It also fails if the key literal appears outside the scope module. A guard in `lib/business-os/credits/__tests__` would **not** run in CI. | 1 |
| C-8 | **AC-1 is reworded** to what proves FR-1. These tracker-level tests cover it: (a) caller-supplied `metadata[key]` is stripped when there is no scope; (b) eval scope + active usage scope gives no stamp; (c) eval scope alone stamps the run id; (d) the opener throws with `NEXT_RUNTIME` set, inside a usage scope, and for a non-UUID id; (e) a fire-and-forget call started inside the scope, after `fn` settles, is still stamped (that is the cache-store path). One chat-v4 test, using the existing `route.audit.test.ts` / `route.choice.test.ts` harness, posts spoof headers/body (e.g. `x-eval-run-id`, `evalRunId`) and asserts that no tracked call carries the key. Drop "every other Business OS route that calls the planner". | 1 |
| C-9 | Eval wiring: wrap **only** the direct single-turn `plan()` path in `withEvalTraffic`. Do **not** wrap the in-process multi-turn chat-v4 calls; C-2 would refuse to stamp them anyway, and the wiring should not rely on that. Pass `turnId: newBosGroupId()` per scenario execution (SA-3). Before the process exits, give pending fire-and-forget cache stores a short, bounded drain so the stamped store embedding is written. That is existing behaviour, so a lost store row is no regression, but record it as a known limit. | 2 |
| C-10 | Keep FR-6/7: the leak check stays read-only (pure classifier, read-only deps; the existing test pattern covers it). The eval opens no `runAiAction`, so no charge rows exist. AC-6 is proven by C-8(b) plus a test that the classifier result for stamped rows writes nothing. | 1 |
| C-11 | Correct B-6 as in SA-1: nightly = previous UTC day. The accepted interim covers every eval day until slice 2 is deployed. | doc |
| C-12 | **BQ-1 and BQ-2 must be answered before slice 2 merges.** Once this ships, an eval run on a customer's account no longer shows up as a leak. That removes the last automatic signal that tests are running on someone else's data. Multi-turn scenarios also spend real credits on whichever account runs them (B-4). SA recommends BQ-2's suggested resolution: an explicit internal account, failing closed. | 2 |
| C-13 | Slices. AC-1 moves into slice 1, with the stamp, which must exist before any wiring. Slice 3 is expected to be a no-op: `LeakCheckPanel` already renders known paths generically by `feature\|component`, so the reserved label appears as its own row. Close slice 3 with a screenshot in slice 1's QA instead of a separate cycle, unless the user wants a different label or styling. | all |
| C-14 | Standards. `npm run typecheck:bos-llm` (0 new, baseline unchanged), `npm run check:bos-llm-literals` and `npm run test:bos-llm` pass. The credits leak-check suites (`lib/business-os/credits/__tests__/creditLeakCheck*.test.ts`) and the admin `leakPanel.render.test.tsx` are not in CI, so they are **run by hand** and their results recorded in the QA report. No `console.*` is introduced; none of the touched lib files has one today. | 1, 2 |

### SA-6. Revised AC wording (for BA to fold in)

- **AC-1 (FR-1):** per C-8. Tracker-level tests (a) to (e), plus one chat-v4 spoof test, show that no request-derived input and no charged action can produce a stamped row.
- **AC-3 (FR-2/3):** after one run, every single-turn eval row has the account's `user_id`, real USD, a non-NULL `session_id` (the scenario's turn id) and the run id under the eval key. Zero-token `BizQLPlanCache` rows on cache hits are expected.
- **AC-4 (FR-4/5):** as written, plus: the eval line is separate from `IntentParser` in both the account finding and the run-level `knownPaths` aggregate.

### SA-7. Optimisation suggestions (non-blocking)

- Count only stamped rows **with spend** in the eval line's `calls`, matching the ungrouped rule's `!hasSpend` skip. The zero-token cache-hit rows would otherwise inflate "calls" without cost. If counted, label them.
- Add `evalRunId` as an optional field on the `bos_credit_leak_known_path` warn log only if it stays an id. Never add scenario text (Standard 5).

### SA Approval

[x] Requirement approved with conditions C-1 to C-14. Proceed to the slice 1 workplan once BA folds in C-11 and SA-6. Slice 2 is gated on C-12.

---

## Change History

| Date | Change | Details |
|---|---|---|
| 2026-10-04 | Created | BA draft after user decision "exempt test runs"; facts B-1..B-9 verified same day; mechanism pending SA |
| 2026-10-04 | SA review | APPROVED WITH CONDITIONS (C-1..C-14). Mechanism M-C: eval-traffic AsyncLocalStorage scope opened only by the eval, stamped into `token_usage.metadata` solely by `AIAnalyticsService.trackAICall` and never inside a charged usage scope. M-A, env-var M-B, account allow-list and group-id markers rejected. SQ-2: per-scenario group + per-run stamp. SQ-3: deploy-onward only. B-6 corrected (nightly = previous UTC day). Slice 2 gated on BQ-1/BQ-2 |
| 2026-10-04 | BA folded in SA conditions | Status → Approved with conditions (SA, 2026-10-04). B-6 corrected per C-11 (nightly = previous UTC day; interim leak findings until slice 2 deploys accepted). Mechanism section records M-C as chosen, M-A/M-B/others rejected with SA reasons. AC-1/AC-3/AC-4 replaced with SA-6 wording; AC-1 moved to slice 1 and slice 3 marked likely no-op closed by slice 1 QA screenshot (C-13). C-12 gate added under BQ-1/BQ-2. SQ-1..SQ-3 marked answered. SA Review section added to ToC |
| 2026-10-04 | Parked | User parked the work. Interim accepted: every eval run makes the next nightly leak check flag that account (explained, not chased). Integration-points row aligned with SA C-3/C-5. BQ-1 (whose account) and BQ-2 (eval default) still open |
