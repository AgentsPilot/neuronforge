# Workplan: Per-Business AI Group Id in `insight-detect` (F-13)

> **Last Updated**: 2026-09-25

**Developer:** Dev
**Requirement / origin:** Finding **F-13** and **SA-1** in [BUSINESS_OS_ADMIN_AI_ACTIVITY_VIEW_REQUIREMENT.md](/docs/requirements/BUSINESS_OS_ADMIN_AI_ACTIVITY_VIEW_REQUIREMENT.md) (spun out to the roadmap as *"The shared insight `runId` (F-13) — a finding for the Layer 3 / insights owners"*)
**Branch:** `fix/insight-run-group-id-per-business` — created by RM from `main` @ `b613bb97` (PR #106 merged). Investigation for this plan was done on `main` (`52b43e6a`).
**Status:** **Fix pass complete 2026-09-25 — SA's C-1 to C-4 and QA's QA-1 to QA-5 all addressed; awaiting SA one-pass confirmation, then RM.** No production code changed in this pass: one test-file type fix, one new test, one sharpened assertion, one type annotation and two markdown rows. See [§13.9](#139-the-fix-pass-c-1-to-c-4-and-qa-1-to-qa-5). Previously: SA code-reviewed 🔄 Fix Required on C-1/C-2, all production code approved; QA pass with one Medium blocking. See [§10.8 Code Review Comments](#108-code-review-comments) and [§11](#11-qa-testing-report). Previously: Code Complete — A-1 to A-6 applied to this document and implemented; A-7 to A-10 addressed (A-7 with a **factual correction**, A-8 found already half-satisfied). See [§13 Implementation Notes](#13-implementation-notes-dev) for the six things that turned out differently in the code.
**Skills loaded:** `tenant-isolation-guard`, `business-os-insights`, `bos-llm-call-standards` (by reference — every change here is a Business OS LLM call site)

## Overview

`app/api/cron/insight-detect/route.ts` mints one `runId` per cron run and uses it as the **AI usage grouping id for every business in that run**. One `token_usage.session_id` — and one `audit_trail.entity_id` — therefore spans N businesses. Any consumer that groups AI spend by the grouping id alone merges several tenants' cost into one group; any join on the audit entry's `entity_id` alone can attribute one business's cost to another. This is a cross-tenant **cost/attribution** leak, in the same class as a cross-tenant content leak (requirement NFR-2, SA-13).

This workplan fixes the id at its source while preserving the deliberate design that a business's insight-content, correlated-insight and health-summary calls **share one group and become ONE audit entry**. The fix makes the group **unique per business**, not per call.

---

## Table of Contents

1. [Analysis Summary](#1-analysis-summary)
2. [Consumer Sweep — full result](#2-consumer-sweep--full-result)
3. [Implementation Approach](#3-implementation-approach)
4. [Historical Data](#4-historical-data)
5. [Verification](#5-verification)
6. [Proposed Guard (RULED: G3, tests only)](#6-proposed-guard-ruled-g3-tests-only)
7. [Files to Create / Modify](#7-files-to-create--modify)
8. [Task List](#8-task-list)
9. [Risks, Non-Goals and Open Questions for SA (all answered)](#9-risks-non-goals-and-open-questions-for-sa-all-answered)
10. [SA Review Notes](#10-sa-review-notes)
11. [QA Testing Report](#11-qa-testing-report)
12. [Commit Info](#12-commit-info)
13. [Implementation Notes (Dev)](#13-implementation-notes-dev)
14. [Change History](#change-history)

---

## 1. Analysis Summary

### 1.1 The defect, precisely

**File:** `app/api/cron/insight-detect/route.ts` (verified on `main` @ `52b43e6a`)

| Line | Code | Role |
|------|------|------|
| `:145` | `const runId = crypto.randomUUID();` | Minted **once per run**, outside the loop |
| `:148` | `requestLogger.info({ runId }, 'Starting insight detection cron job')` | Run-level log correlation — **a legitimate second need** |
| `:209` | `for (const userId of userIds) {` | The per-business loop |
| `:227-228` | `await runAiAction({ area: 'insights', actionType: 'insight_run', groupId: runId, trigger: 'scheduled', accountId: userId, correlationId }, …)` | **The defect.** Same `groupId`, different `accountId`, N times |
| `:256`, `:269`, `:286` | `repository.createBatch(userId, prioritized, runId)` / `saveCorrelationResults(…, runId)` / `createOrUpdateHealthSummary(…, runId)` | The same value travels into the repository |

Inside the repository that one value is used for **two different things**:

- as the LLM grouping id — `buildBosCallContext({ userId, area: 'insights', callName, groupId: runId })` at `InsightRepository.ts:824`, `:2119`, `:2521`;
- as a **database column** — `detection_run_id: runId` at `InsightRepository.ts:493`, `:532`, `:1903`, `:1956`, `:2309`.

That conflation is the reason this is not a one-line fix, and it is the main implementation hazard (§3.3).

### 1.2 Why the sharing itself must be preserved

The comment block at `:210-224` documents the intent explicitly (Layer 3, FR-10, D-3, WC-8):

> *One AI action per business per run … its insight, correlated-insight and health-summary calls share the run's group and become ONE entry.*

`withUsageScope` (`lib/ai/usageScope.ts`) enforces that by **dropping any call whose `sessionId` differs from the open scope's `groupId`** (`notifyUsage`, `:113-121` — increments `excluded`, logs at `warn`, does not throw). So:

- if we change the `runAiAction` scope id but not the `buildBosCallContext` id (or vice versa), **every insight LLM call is silently excluded from its scope**, every entry is written with `callCount: 0` and zero cost, and the only symptom is a `warn` line. That is a *worse* failure than the bug we are fixing, and it is why §3.2 proposes a signature change the type system can police;
- fragmenting the group (one group per call) would produce three audit entries per business per run instead of one — the explicit anti-goal in the brief.

The correct statement of the invariant is therefore:

> **One grouping id ⇔ exactly one (business, AI action). One business's calls within one run share it; two businesses never do.**

### 1.3 Blast radius beyond the ledger

F-13 is written about `token_usage.session_id`. The audit side is affected identically and is **not** in F-13's citation list: `groupId` becomes the audit entry's `entityId` (`lib/business-os/llm/aiActionAudit.ts:212`), so today **every `ai_action` entry produced by one insight run carries the same `entity_id` across different `user_id`s**. `audit_trail` is therefore non-unique on `(entity_type, entity_id)` across tenants for this area.

`validateIdentities` (`aiActionAudit.ts:249-255`) is not a safety net here: it only refuses non-UUID ids and the platform account. A shared-but-valid UUID passes it silently.

---

## 2. Consumer Sweep — full result

Method: every read of `token_usage` (38 sites), every use of `session_id` in `lib/` / `app/` / `components/`, every reference to the `ai_action` entity type, every `runAiAction` call site (16), every route under `app/api/cron/` (16), and every reader of `insights.detection_run_id`.

### 2.1 Everything that groups by a grouping id

| Consumer | Groups by | Cross-tenant today? | Why / action |
|---|---|---|---|
| `lib/business-os/entitlements/report.ts:663` — `groups.add(call.session_id ?? 'ungrouped:' + call.id)` | `session_id` **alone** | **No** — two independent reasons | Rows come from `listCallsInWindow(row.user_id, …)` **inside a per-account loop**, so the row set is already one tenant; and it filters to `SETUP_AREAS = ['business-os-onboarding','business-os-website','business-os-intake']` (`:82`, `:662`), which **excludes `business-os-insights`**. No change needed. Worth recording that its correctness rests on the *caller's* scoping, not on the key |
| `lib/business-os/bizql/telemetry/ChatBudget.ts:98` — `new Set(rows.map(r => r.session_id))` | `session_id` alone | **No** | The query is `.eq('feature', BOS_CHAT_FEATURE).eq('user_id', userId)` (`:160-164`) — scoped to one account **and** to chat. No change needed |
| `lib/business-os/bizql/telemetry/usageReport.ts:137-167, :363` — `summarise()` turn grouping | `session_id` alone | **No, but this is the one genuinely cross-account grouping in the tree** | `getChatUsage` can read **all accounts** (`listChatCallsAllAccountsInWindow`, `:240`) and `summarise(rows, …)` then groups `turnIds` across that mixed set. It is correct only because the read is pinned to `BOS_CHAT_FEATURE` and a chat turn id is minted per turn per user. Insight rows can never enter it. **No change needed**, but it is the shape that breaks first if any future area shares a group across accounts — cite it to SA as the argument for the guard in §6 |
| `lib/hooks/useAnalyticsData.ts:49` | selects `session_id`; does **not** group by it | No | Browser client, `.eq('user_id', user.id)`, RLS-scoped. No change |
| `lib/repositories/TokenUsageRepository.ts:106, :115` | exposes `session_id` in two column sets | n/a | Read contract only. The Gap-B RPC will consume it; the requirement already pins `(session_id, user_id)` |
| `app/admin/audit-trail/page.tsx:721` | renders `details` of `ai_action` entries | No | **Nothing in the tree joins `entity_id` to `session_id` today.** The Gap A view (merged, PR #100) only renders the entry. Gap B is the first such join and is not built yet |
| `lib/analytics/aiAnalytics.ts:140-146` | — | n/a | **Write path.** Nulls a non-UUID `session_id` and logs a warn. This is the hard constraint on §3: whatever we mint must be a valid UUID, or the ledger silently loses its group |

**Net:** no production consumer is currently mis-attributing cost. The leak is **latent in the stored data** and goes live the moment Gap B (or anything else) joins on the id. That is a reprieve, not a reason to defer — the wrong id is being written every night at 03:30.

### 2.2 Other crons / batch paths that could repeat the pattern

Checked all 16 routes under `app/api/cron/` plus all 16 `runAiAction` call sites.

| Path | Verdict |
|---|---|
| `app/api/cron/insight-detect` | ❌ **The offender. The only one** |
| `app/api/cron/daily-briefing` → `BriefingStore.ts:72` / `BriefingNarrator.ts:106` | ✅ Safe by construction — `bosBriefingGroupId(userId, facts.day.date)` contains the `userId`, so a group can never span businesses |
| `lib/services/LeadAlertService.ts:344` | ✅ `newBosGroupId()` minted per enquiry inside the single-owner path (`:338`, with a comment saying why) |
| `lib/services/WebsiteBlockEnrichmentService.ts:272`, `WebsiteSectionService.ts:529`, `MutateExecutor.ts:831` | ✅ Single-user request scope; an inherited group belongs to the caller's own action |
| `app/api/business-os/chat-v4`, `intake/*`, `onboarding/*`, `website/*` (9 routes) | ✅ Request-scoped, one authenticated user each |
| `cron/insight-automations`, `insight-actions`, `insight-metrics`, `lead-response`, `payment-reminders`, `payment-retry`, `intake-reminders`, `memory-consolidation`, `channel-metrics-sync`, `calendar-sync`, `process-queue`, `abandoned-proposal-invoices`, `check-free-tier-expiration`, `update-template-scores` | ✅ Their only `crypto.randomUUID()` is the **`correlationId`**, which is correctly run-level and is never used as a `groupId` |

**`insight-detect` is the only instance.** The pattern is not endemic — which materially reduces the scope the F-13 wording implies.

### 2.3 `insights.detection_run_id`

Written at five sites in `InsightRepository.ts`; **read by nothing** in the tree (only `catalog.generated.ts:3529` lists the column, and two migrations declare it). Its declared meaning — *"Links to the cron run that detected this"* (`supabase/migrations/20260801_create_insights.sql:11`) — is run-level. §3.2 keeps that meaning rather than quietly redefining an unread column.

### 2.4 Tests that currently encode the bug

| Test | What it asserts today |
|---|---|
| `app/api/cron/insight-detect/__tests__/route.audit.test.ts:152-157` | `const runId = mockCreateBatch.mock.calls[0][2]`, then **for both businesses A and B**, `expect(entry).toMatchObject({ entityId: runId })` — i.e. it asserts that two tenants share one `entity_id` |
| `lib/business-os/insight/__tests__/insight-llm-attribution.test.ts:158, :173` | Passes a single `R1` to `createBatch` / `saveCorrelationResults` and asserts the calls carry it as their group |

The first test **must change** — it is a green assertion on the defect. Worth stating plainly to SA: as it stands, the suite would protect this bug indefinitely.

---

## 3. Implementation Approach

### 3.1 Choice of id shape — recommendation

Both candidates satisfy the hard constraint (must be a valid UUID, per `aiAnalytics.ts:140`).

| | **A. Fresh `crypto.randomUUID()` per business** | **B. Deterministic UUID v5 from `(runId, userId)`** ✅ recommended |
|---|---|---|
| Simplicity | Simplest; no new exported helper, no namespace constant | One new helper + one namespace constant in `callCatalog.ts` |
| Run-level correlation | Only via a log line pairing `runId` with the group id | The pair is **verifiable from the id**: given `runId` + `userId` from the logs, recompute and match. (v5 is one-way — you can *verify*, not *invert*. Stated precisely so SA is not sold a stronger property than exists) |
| Idempotence | Two computations give two different ids — a latent trap if the route ever recomputes | Recomputing anywhere yields the same value, so the scope id and the call-context id **cannot drift** |
| Reuse wrinkle | None | **None here** — see below |
| Long-term burden | None | The namespace + name format become a compatibility surface |

> ### ✅ RESOLVED — SA ruled **Option A** (A-1). Implemented.
>
> A fresh `crypto.randomUUID()` minted inside the per-business loop. `bosInsightRunGroupId`,
> `BOS_INSIGHT_RUN_GROUP_NAMESPACE`, Task 2, T4 and both `callCatalog` rows in §7 are **dropped** —
> `lib/business-os/llm/callCatalog.ts` is not in the diff at all.
>
> SA accepted my argument that the briefing wrinkle does not transfer, but ruled against B on a ground
> I had not weighed: once `InsightRunIds` exists, idempotence insures against nothing (both paths get
> the same *field*, not the same recomputation), and the one capability v5 would buy — deriving a
> business's insight rows from a Gap B admin row — is something NFR-2 does not want. The forensic value
> is replaced by the mandatory per-business log line (A-2), which is now the **only** record tying a run
> to its groups.

**Original recommendation (superseded): B** — `uuidV5(` + "`${runId}:${userId}`" + `, BOS_INSIGHT_RUN_GROUP_NAMESPACE)`, exposed from `callCatalog.ts` as `bosInsightRunGroupId(runId, userId)`, reusing the existing `uuidV5` helper (`callCatalog.ts:339`).

**On the `bosBriefingGroupId` wrinkle.** The precedent (`callCatalog.ts:362`) derives from `(userId, briefingDate)`. Its known defect is that a **same-day re-narration reuses the group**, so two audit entries share one `entity_id` (F-13's second half). **That wrinkle does not transfer**, and the reason is structural: briefing's variable part (`briefingDate`) repeats by design, whereas `runId` is freshly minted per invocation (`:145`) — a Vercel retry, or the dev-only `POST` re-trigger, produces a new one. The derived id is unique per (run, business) because its input already is.

The compatibility burden is also lighter than briefing's. Briefing must re-derive a historical id in order to *find* a day's group; here the id is computed once and written, and re-derivation is only ever a debugging convenience. I will still carry a `NEVER CHANGE` comment in the same style, scoped honestly to what it actually protects.

If SA prefers **A** for its smaller surface, the rest of this plan is unchanged apart from Task 2 — say so in review and I will take A.

### 3.2 Keeping the two identifiers apart

Two distinct needs, therefore two identifiers, named so they cannot be confused:

| Identifier | Scope | Used for |
|---|---|---|
| `runId` | one cron invocation | structured logging (`:148`, the loop's catch at `:330`, the completion log at `:335`), the HTTP response body, and `insights.detection_run_id` |
| `businessGroupId` | one business within that run | `runAiAction({ groupId })` and every `buildBosCallContext({ groupId })` underneath it |

Because the repository uses its single `runId` parameter for *both* (§1.1), the five repository entry points must be able to receive both. To make the §1.2 silent-exclusion failure **impossible to introduce**, I propose replacing the bare `runId: string` parameter with a small object type:

```typescript
/**
 * The two ids one detection run carries for one business.
 *
 * Passing a bare string no longer compiles, which is the point: mixing these
 * two up silently empties every usage scope (usageScope.notifyUsage drops a
 * call whose sessionId differs from the open scope's groupId, and only warns).
 */
export interface InsightRunIds {
  /** The cron invocation. Stored as `insights.detection_run_id`. */
  runId: string;
  /** This business's AI usage group. One per (run, business). */
  groupId: string;
}
```

**File:** `lib/business-os/insight/repository/InsightRepository.ts`

Affected signatures — **as found on the branch** (`main` @ `b613bb97`), not on `52b43e6a`. ⚠️ `InsightRepository.ts` grew from ~2,750 to **3,764 lines** between the two commits, so every number in the original plan had drifted by hundreds of lines, not the 3–4 SA noted (A-10). The reliable way to find them is `grep -n "runId\|detection_run_id\|buildBosCallContext"`, which is what was used:

| # | Signature | Line (at `b613bb97`) |
|---|---|---|
| 1 | `CreateInsightParams` | `:392` |
| 2 | `restateIfChanged` | `:517` |
| 3 | `generateLocalizedContent` | `:819` |
| 4 | `createBatch` | `:1013` |
| 5 | `createCorrelatedInsight` | `:2056` |
| 6 | `generateCorrelatedContent` | `:2210` |
| 7 | `createOrUpdateHealthSummary` | `:2414` |
| 8 | `generateHealthNarrative` (health-narrative helper) | `:2691` |
| 9 | `saveCorrelationResults` | `:3168` |

Nine signatures, one mechanical change each. ⚠️ **The plan's claim that `insight-detect` is the only caller was wrong** — `scripts/verify-insights.ts` calls `createBatch` and `saveCorrelationResults` too (§13.1).

This is a **type-shape change to an existing repository**, not a new pattern, and it is the cheapest available way to convert a silent runtime failure into a compile error. Flagged for SA under CLAUDE.md rule 7 in case SA reads it as new.

### 3.3 The hazard to state out loud

If the `runAiAction` scope id and the `buildBosCallContext` id diverge by even one call site, `notifyUsage` excludes every call, each entry is written with `callCount: 0`, and **nothing fails** — one `warn` per call. Test T2 (§5.1) asserts a non-zero `callCount` per business precisely to catch this; §3.2's type change is what stops it being reachable at all.

### 3.4 Root-cause placement

The defect is in the **cron route's loop scoping** — where the id is minted relative to the loop. That is where it is fixed. Nothing is compensated for downstream: no consumer gains a workaround, and `aiActionAudit` / `usageScope` are untouched except for the optional guard in §6.

### 3.5 Out of scope

- Fixing `bosBriefingGroupId`'s same-day re-narration wrinkle (F-13's second half). Separate defect, separate area, different fix shape. The Gap B requirement already handles it (newest wins, all entries listed, row marked).
- `insight-detect`'s **fail-open `verifyCronSecret`** (`business-os-insights` skill, Rule 7) — a real and arguably more urgent defect in the same file, but a different bug with its own security review. **Flagging it here; recommend a separate `fix/` cycle** rather than smuggling it into this diff.
- The serial-LLM-calls-in-a-loop timeout risk (same skill, Rule 7). This change adds no per-user work.

---

## 4. Historical Data

**Rows already written cannot be split, and must not be rewritten.**

- **No discriminator exists.** Every `token_usage` row from one run carries the same `session_id`; the only thing separating tenants is `user_id`. That is exactly why `(session_id, user_id)` is the key — there is nothing else to key on.
- **A backfill would make things worse, not better.** Re-minting `session_id` on historical ledger rows would break their correspondence with the `audit_trail` entries whose `entity_id` is the old shared value. Fixing both means rewriting append-only audit evidence — the one table whose value is that it was not edited. **Recommendation: no backfill, ever. Record the cut-over date instead.** SA **confirmed this as permanent** (A-7).
- ⚠️ **A-7's strengthening argument does NOT hold — correction.** SA asked for a sentence saying that rewriting `entity_id` would invalidate `audit_trail`'s `hash` tamper-detection column, converting "we would rather not" into "we must not". The column does exist (`supabase/SQL Scripts/create_audit_trail.sql:32`, not `:31`), **but it is never populated**: `AuditTrailService` writes it only when `enableTamperDetection` is true, that defaults to **`false`** (`lib/services/AuditTrailService.ts:51`), and **nothing in the tree sets it**. So every `audit_trail.hash` is NULL and there is no hash to invalidate. The sentence was therefore **not** written into the requirement or the module doc as fact; the no-backfill conclusion rests on the two reasons above, which are sufficient. **The dormant `hash` column is itself worth flagging**: it reads as tamper protection and currently provides none. Recorded in `BUSINESS_OS_INSIGHTS_MODULE.md` under the H11 cut-over note.
- **Consequence for consumers — the sentence that matters:**

  > **`(session_id, user_id)` remains the correct row key permanently, not as a stopgap.** After the fix, post-cut-over rows would also be unique on `session_id` alone, but historical rows never will be, and a query cannot distinguish the two populations except by date — which is fragile and would silently regress. **The Gap B requirement's key (SA-1; FR-B1, FR-B2, FR-B4; AC-B5) does not change and should not be revisited when this ships.**

- **What does change for Gap B:** after the cut-over, an insight run stops producing N rows that *look* like one action, so its per-row figures become honest without the composite key having to rescue them. AC-B5 (the cross-tenant regression test) stays exactly as specified — it is then testing a property the data also has, rather than one only the query provides.
- **Documentation:** the fix date goes into the requirement's F-13 row and into [BUSINESS_OS_INSIGHTS_MODULE.md](/docs/architecture/BUSINESS_OS_INSIGHTS_MODULE.md)'s hazard table, so a future reader of old rows knows where the boundary is.

---

## 5. Verification

### 5.1 New / changed automated tests

All five tests below are **implemented and verified by mutation** — each was re-run against a deliberately reintroduced bug to prove it can fail (§13.5). ✅

**T1 — cross-tenant distinctness (the regression test).** `route.audit.test.ts`, which already simulates one run over three businesses (A and B with detections, C without):

- `entityId` for A `!==` `entityId` for B; ✅
- each is a valid UUID (`isUuid`), so `validateIdentities` and the `aiAnalytics` write guard both accept it; ✅
- `details.groupId === entityId`, so the two stay in step if either moves; ✅
- **replaced** the `expect(entry).toMatchObject({ entityId: runId })` assertion, which asserted the defect. ✅

**T2 — intra-business sharing still holds (the anti-fragmentation test).** Business A now makes **two** tracked calls — one via `createBatch`, one via `saveCorrelationResults`. To make the route reach the second, the `getCorrelationEngine` mock had to start returning one matched pattern (`patternsMatched: 1`), which the original plan did not anticipate. Asserted:

- exactly **one** audit entry for A; ✅
- `details.callCount` is **2** and `callNames` lists both; ✅
- **`callCount > 0` and `estimatedCostUsd > 0` on EVERY entry, not just A's (A-5)**; ✅
- the mock **receives an object with both keys** — enforced by an `asRunIds()` type guard that throws on anything else, so a mock silently reverting to a bare string fails the suite rather than the ledger (A-5). ✅

**T3 — the FAILED path is unchanged.** The existing WC-8 test still passes with per-business ids. ✅

**T4 — ~~the derivation (option B only)~~. DROPPED** per A-1: Option A has nothing to derive, and `callCatalog.ts` is not in the diff.

**T5 — `detection_run_id` is still run-level.** Asserts A and B receive the **same** `runId` and **different** `groupId`s, and that `runId !== groupId` — the mirror image of T1, proving the two identifiers were separated rather than swapped. ✅ Its response-body assertion was `toBeDefined()`, which would also have passed for a body reporting some *other* id; it is now `toBe(idsA.runId)` (QA-4), and mutation **M6** proves the difference. ✅

**T6 — existing attribution tests updated.** `insight-llm-attribution.test.ts` moved to `InsightRunIds`. ⚠️ Its `grouping across a run` block **also asserted the defect** ("two businesses in one run **share** the group") — a second green assertion on the bug that the plan did not find. Split into three tests: one business's calls share its group; two businesses in one run never do; one business across two runs gets two groups. ✅

**T8 — the A-2 log line (added in the fix pass, QA-3).** Under Option A the group id is random, so that one `info` line is the **only** record tying a run to the groups it produced — and nothing asserted it: deleting it left the suite green (measured, mutation **M5**). The new test captures the logger's `info` calls and asserts **three** lines (A, B **and** C — the id is minted before the route knows whether a business will make a call, so a business with no detections still gets one; this is the §10.9 trap, now pinned rather than explained), all three ids on **one** record, each a UUID, `businessGroupId !== runId`, one shared `runId`, three distinct `businessGroupId`s, and — the part that makes it forensic rather than decorative — that the logged group id **is** the `entity_id` of that business's audit entry. ✅

**T7 — three further callers the plan missed (added).** `modelSettings.wiring.nonchat.test.ts`, `modelSettings.off.nonchat.test.ts` and `callParams.boundary.step2.test.ts` all call the private generators through an `as never as` cast that re-declares the signature and so **defeats the compiler entirely** (§13.2). Their hand-written signatures now import the real `InsightRunIds`, and three pinned snapshots that recorded `sessionId: '<run>'` were updated to `'<insight-group>'` — the snapshot was pinning the defect. ✅

### 5.2 Checks

All run on `b613bb97` + this diff. **Real numbers, not estimates.**

| Command | Why | Result |
|---|---|---|
| `npx jest app/api/cron/insight-detect lib/business-os/insight lib/business-os/llm lib/business-os/bizql lib/business-os/usage lib/business-os/entitlements lib/repositories lib/ai app/api/admin/chat-usage` | The affected areas **plus** every consumer that groups by a grouping id (§2.1) | **152 of 153 suites pass, 2,367 of 2,368 tests** (fix pass; 2,366/2,367 before T8 was added — QA reproduced that figure exactly). The one failure is **pre-existing on `main`** and unrelated — see §13.6 |
| `npm run typecheck:bos-llm` | This touches Business OS LLM call sites | **242 files in scope, 28 errors, 0 new — passed.** It is the gate that caught all of §13.2; the 28 are the baseline. **It now also *fails* on the C-1 shape**: with a bare `'run-1'` put back at `restateIfChanged.test.ts:88` it reports **29 errors, 1 new** — `TS2345: Argument of type 'string' is not assignable to parameter of type 'InsightRunIds'` (§13.9, mutation M8). Before the fix that same line was invisible to it |
| `npm run check:bos-llm-literals` | Required status check on `main` | **43 files, 2 exempt, 0 violations — passed** |
| `npm run schema:check` | No schema change — no-regression check (`business-os-insights` skill, Rule 3) | **32 of 608 selects fail, identical before and after.** No regression; all 32 are pre-existing, none in a touched file (the `insight_*` hits are `lib/pilot/insight/**` — the *other* insight system, skill Rule 1) |
| `npx eslint` on the 11 touched code files, vs the same files at `HEAD` | `npm run lint` is not a CI gate; this is the measured comparison | **0 errors / 5 warnings, identical before and after.** 3 pre-existing `no-unused-vars` in `InsightRepository.ts`, 1 unused-disable in `modelSettings.off.nonchat.test.ts`, and 1 pre-existing unused `overrides` in `restateIfChanged.test.ts` (verified at `HEAD` by stashing the file: same warning, only the line number moved from `:41` to `:59`). It was 4 warnings over 10 files before the fix pass, because that eleventh file was not yet in the diff |

⚠️ **Correction to a figure that was reported and is not in this table.** The hand-off to SA/QA quoted **165 of 166 suites and 2,892 of 2,893 tests**. No command recorded in this document produces those counts, I cannot reproduce them, and they should be treated as **wrong** — they came from an unrecorded ad-hoc glob run during implementation, not from §5.2's command. The authoritative figures are the ones in this table (and QA reproduced the pre-T8 pair to the test). For whole-tree context, `npm test` is **521 suites / 8,299 tests** with an identical 24-suite failing set on both sides of this diff (QA, §11).
| ⚠️ `npx tsc --noEmit -p tsconfig.json` | — | **Cannot be used: it dies with a V8 heap OOM** (`FATAL ERROR: Ineffective mark-compacts near heap limit`, exit 134) after ~200s. It prints nothing, so a naive `grep -c "error TS"` reads **0** and looks like a pass. There is no whole-project `typecheck` script; `typecheck:bos-llm` is the real gate for this diff |

**A-4 — mechanical post-change checks.** Both clean: ✅

```bash
# 1. Nothing passes a run id as a group id anywhere.
grep -rn "groupId: runId\|groupId: params.runId\|groupId: ids.runId" lib/ app/   # → no matches

# 2. Every buildBosCallContext in InsightRepository is fed from .groupId.
grep -n -A5 "buildBosCallContext({" lib/business-os/insight/repository/InsightRepository.ts | grep groupId
#   1008:            groupId: ids.groupId,
#   2344:            groupId: ids.groupId,
#   2974:            groupId: ids.groupId,
```

### 5.3 Manual check for QA

> **A-6 — this check is DEVELOPMENT-ONLY.** `POST` returns **405** outside development
> (`route.ts`, the `process.env.NODE_ENV !== 'development'` guard on the `POST` export), so QA
> **cannot** trigger a run on production. Use the read-only alternative below there.

**In development** — trigger the dev-only `POST /api/cron/insight-detect` against two seeded businesses, then confirm in the database:

1. the two `audit_trail` `ai_action` entries have **different** `entity_id`s;
2. each business's `token_usage` rows all carry **that** business's `session_id`, and no row carries the other's;
3. the `insights` rows for both businesses share one `detection_run_id`;
4. each entry's `details.callCount` is non-zero. ⚠️ **Correction to the plan's §3.3:** a `callCount: 0` entry is **impossible** — `emitAiAuditEntry` returns early on `calls.length === 0`, so an action whose every call was excluded writes **no entry at all**. The symptom to look for is therefore a **missing** entry, or — worse because it looks plausible — an entry whose `callCount` is **lower than the number of calls the business actually made** (a partially mismatched action). Both were observed under mutation, §13.5.
5. one `info` log line per business carrying `{ runId, userId, businessGroupId }` (A-2). Under Option A this is the only record linking the run to its groups, so its absence is itself a defect.

### 5.3.1 Production check (read-only) — A-6

`POST` is 405 in production, so wait for the first post-deploy scheduled run (03:30) and then run a read:

```sql
-- Expect ZERO rows. Any row is one entity_id shared by two tenants.
select entity_id, count(distinct user_id) as tenants
from audit_trail
where entity_type = 'ai_action'
  and created_at > now() - interval '24 hours'
group by entity_id
having count(distinct user_id) > 1;
```

Two caveats for whoever runs it:

- **Scope it to the last 24h, as written.** Without the date bound it returns every pre-cut-over insight run and looks like a failure. The cut-over date is recorded in `BUSINESS_OS_INSIGHTS_MODULE.md` (H11).
- It is a check on **all** areas, not just insights, which is deliberate — it is the cheapest available detector for this defect class anywhere in Business OS.

---

## 6. Proposed Guard (RULED: G3, tests only)

> ### ✅ RESOLVED — SA ruled **G3, tests only** (A-3). G1 is **not built**.
>
> `lib/business-os/llm/aiActionAudit.ts` and its test are **out of the diff**; Task 7 is dropped. SA's four
> grounds: G1 polices a class with zero remaining instances; it puts process-lifetime mutable state into the
> module whose contract is "accounting must never fail the call"; the real enforcement (`(session_id, user_id)`
> as the permanent key, plus T1) already fails the build on a regression; and G1 sits on the **write** side of
> a hazard that is on the **read** side. A DB-level unique index on `audit_trail (entity_id, user_id)` was
> **pre-rejected** by SA so it is not re-proposed: pre-fix rows already violate it, and the briefing same-day
> wrinkle legitimately produces two entries for one `(group, account)`.
>
> **A-8 replaces it** — the precondition comment on `usageReport.summarise()`, which covers the one live
> cross-account grouping in the tree. ⚠️ A-8's *test* half turned out to **already exist** — see §13.4.

**Proposed, not assumed** — a new runtime invariant is a new pattern under CLAUDE.md rule 7.

**The invariant worth guarding:** *one grouping id maps to exactly one account.* It holds for every area — there is no legitimate case in the tree where one group spans two accounts (chat, briefing, website, intake, onboarding and leads are each single-owner; §2.2).

| Option | Shape | Assessment |
|---|---|---|
| **G1 — runtime conflict detector** ✅ proposed | A bounded LRU `Map<groupId, accountId>` in `aiActionAudit.ts`; on conflict, `logger.error({ groupId, accountId, previousAccountId }, …)` and **write the entry anyway** | Catches the pattern **generically**, in every area including ones not yet written, at the exact moment it matters. Cheap (one map lookup per action). Must never throw and never block — consistent with the module's "accounting must never fail the call" posture. Limit: per-process, so on Vercel it catches a within-instance loop — which is precisely the shape of this bug |
| **G2 — static / source guard** ❌ not proposed | Extend `scripts/typecheck-bos-llm.ts` to flag a `groupId` identifier declared outside the nearest enclosing loop | Heuristic and false-positive-prone: a group legitimately declared above a loop **over one user's entities** is correct, and telling the two apart needs real scope analysis. Not worth it for a one-instance pattern |
| **G3 — tests only** | T1/T2 and nothing else | Defensible given the sweep found exactly one instance and no consumer currently mis-attributes. The honest minimum |

**Recommendation: G1, as a separate second commit** so SA (and RM) can take the fix without the guard if SA rules against it. If SA prefers G3, drop Task 7 and nothing else changes.

---

## 7. Files to Create / Modify

**As built.** 16 files, no migration, no schema change, no new table or column.

| File | Action | Reason |
|------|--------|---------|
| `app/api/cron/insight-detect/route.ts` | modify | Mint `businessGroupId` per business — declared just **outside** the `try` so the catch can name it; pass it as `runAiAction`'s `groupId`; pass `{ runId, groupId }` to the three repository calls; the mandatory `{ runId, userId, businessGroupId }` `info` line (A-2); `businessGroupId` added to the per-business error log; the intent comment rewritten to say the group is per business and why |
| `lib/business-os/insight/repository/InsightRepository.ts` | modify | `InsightRunIds` introduced; nine signatures changed (§3.2); `.groupId` to the three `buildBosCallContext` sites, `.runId` to the five `detection_run_id` writes |
| `lib/business-os/insight/repository/index.ts` | modify | Export `InsightRunIds` (the barrel already exported `CreateInsightParams`) |
| `app/api/cron/insight-detect/__tests__/route.audit.test.ts` | modify | T1, T2, T3, T5 — including **removing** the assertion that encoded the bug, and the A-5 mock rewrite with an `asRunIds()` guard |
| `lib/business-os/insight/__tests__/insight-llm-attribution.test.ts` | modify | T6 — new parameter shape, **and** the `grouping across a run` block that also asserted the defect |
| `lib/business-os/insight/repository/__tests__/restateIfChanged.test.ts` | modify | ⚠️ **Not in the plan, and missed by the first sweep.** The **fifth** hand-written re-declaration of a changed signature — SA C-1 / QA-1. Two sites, now typed with the real `InsightRunIds` (§13.9) |
| `lib/business-os/bizql/telemetry/usageReport.ts` | modify | **A-8** — the precondition comment on `summarise()`. Its test half already exists (§13.4) |
| `scripts/verify-insights.ts` | modify | ⚠️ **Not in the plan.** A second caller of `createBatch` / `saveCorrelationResults` (§13.1) |
| `lib/business-os/llm/__tests__/modelSettings.wiring.nonchat.test.ts` | modify | ⚠️ **Not in the plan.** §13.2 — hand-written signature + `session_id` assertion |
| `lib/business-os/llm/__tests__/modelSettings.off.nonchat.test.ts` | modify | ⚠️ **Not in the plan.** §13.2 |
| `lib/business-os/llm/__tests__/callParams.boundary.step2.test.ts` | modify | ⚠️ **Not in the plan.** §13.2 — three hand-written signatures |
| `lib/business-os/llm/__tests__/__snapshots__/callParams.boundary.step2.test.ts.snap` | modify | ⚠️ **Not in the plan.** Three snapshots pinned `sessionId: '<run>'` — the defect. Now `'<insight-group>'`; the diff is exactly 3 lines |
| `docs/requirements/BUSINESS_OS_ADMIN_AI_ACTIVITY_VIEW_REQUIREMENT.md` | modify | F-13 marked fixed + the permanence of `(session_id, user_id)` + SA's X-2 note. **Exactly 2 lines (`:73`, `:490`)**, deliberately avoiding `:254` and `:560` per X-3 (§13.3) |
| `docs/architecture/BUSINESS_OS_INSIGHTS_MODULE.md` | modify | New hazard **H11** (closed) + the cut-over note + a Change History entry (required by the `business-os-insights` skill) |
| `docs/workplans/insight-run-group-id-per-business-workplan.md` | modify | This document: A-1 to A-10 applied, §13 added |
| ~~`lib/business-os/llm/callCatalog.ts`~~ + ~~its test~~ | **DROPPED** | A-1 (Option A) — no derivation helper, and `callCatalog.ts` stays out of a required-check surface |
| ~~`lib/business-os/llm/aiActionAudit.ts`~~ + ~~its test~~ | **DROPPED** | A-3 (G3) — G1 not built |

### Standards check on touched files

- **`console.*` in files this diff modifies: none.** All code files use `createLogger`. ⚠️ `scripts/verify-insights.ts` (newly in the diff) has **43 `console.*` calls** — but it is a standalone CLI script, not `lib/`, `app/` or `components/`, which is the scope CLAUDE.md § Logging names, and console output is the point of a CLI. **Flagged, not converted**; converting it is a judgement call for the user, not something to smuggle into this diff. Noted separately: `lib/hooks/useAnalyticsData.ts` (read during the sweep, **not** modified) also contains several `console.*`.
- **Repository pattern:** all DB access stays behind `InsightRepository`; no new queries.
- **Zod:** no API input surface changes (the cron route takes no body).
- **TypeScript strict:** no new `any`. The one cast added is `c[2] as RunIds` in a test, against a `jest.fn()` whose args are `unknown[]`.
- **Tenant isolation (`tenant-isolation-guard` skill, Step 6):** this is the queue-runner/cron case — a service-role loop that must scope **every** effect to the row's `user_id`. The DB effects already were (`.eq('user_id', userId)` throughout `InsightRepository`); the **attribution** effect was the one that was not, and that is exactly what this fixes. No new caller-supplied ids are introduced, so Steps 2 and 3 (ownership pre-check, field allow-list) do not apply — `userId` comes from the platform's own enumeration, never from caller data.

---

## 8. Task List

- [x] ✅ **1.** RM created `fix/insight-run-group-id-per-business` from `main` @ `b613bb97`; confirmed with `git branch --show-current` before the first edit
- [x] ~~**2.** Add `bosInsightRunGroupId` + namespace to `callCatalog.ts`~~ — **DROPPED per A-1** (SA ruled Option A)
- [x] ✅ **3.** `InsightRunIds` introduced and threaded through the nine `InsightRepository` signatures, splitting `.groupId` (3 call contexts) from `.runId` (5 `detection_run_id` writes); exported from the barrel
- [x] ✅ **4.** `insight-detect`: `businessGroupId` minted inside the loop, wired to `runAiAction` and the three repository calls, with the **mandatory** `{ runId, userId, businessGroupId }` `info` line (A-2) and `businessGroupId` added to the per-business error log
- [x] ✅ **5.** Intent comment rewritten: the group is per business; the sharing it protects is *within* a business; the F-13 history and the invariant stated in the file
- [x] ✅ **6.** Tests T1, T2, T3, T5 in `route.audit.test.ts` (incl. the A-5 mock rewrite + `asRunIds()` guard); T6 in `insight-llm-attribution.test.ts`; ~~T4~~ dropped; **T7 added** — three further test files and three snapshots the plan missed (§13.2)
- [x] ~~**7.** G1 group↔account conflict detector~~ — **DROPPED per A-3** (SA ruled G3). A-8's comment added to `usageReport.summarise()` instead
- [x] ✅ **8.** Every check in §5.2 run, with real numbers recorded there, plus the A-4 greps
- [x] ✅ **9.** Requirement F-13 rows updated (2 lines only, per X-3) and `BUSINESS_OS_INSIGHTS_MODULE.md` given hazard **H11**, the cut-over note and a Change History entry
- [x] ✅ **10.** Mutation-verified every new assertion can fail (§13.5) — three mutations, each caught
- [x] ✅ **11.** Handed to SA for code review and to QA. SA: 🔄 Fix Required on C-1/C-2 (all production code approved). QA: pass with one Medium blocking (QA-1) + three Low
- [x] ✅ **12.** Fix pass — C-1/QA-1 (the fifth signature, plus a re-sweep **by method name** rather than by cast spelling), C-2/QA-2 (the unrenderable X-2 note and the stale present-tense prose), QA-3 (a test for the A-2 log line), QA-4 (T5's response-body assertion) and C-4/QA-5 (the `InsightRunIds` annotation in `verify-insights.ts`). Every check in §5.2 re-run with real numbers, plus **eight** mutations including QA's fourth (§13.9)
- [ ] **13.** SA one-pass confirmation of C-1/C-2, then TL, then RM. **No commit made by Dev.**

### Follow-ups this cycle created or inherited (A-9)

| Item | State |
|---|---|
| **The cron fail-open (NG-2)** | ⚠️ **Already fixed on `main`** — H4 in `BUSINESS_OS_INSIGHTS_MODULE.md` is marked closed 2026-09-23, and `insight-detect`'s `verifyCronSecret` now fails closed with a comment. **SA's §10.5 ruling is moot**: there is no `fix/` cycle to cut, no dormancy trade-off for TL to put to the user, and no ordering constraint. The plan and SA both read a stale tree |
| **`bosBriefingGroupId`'s same-day wrinkle (NG-1, F-13's second half)** | **Open.** Still deliberately out of scope. Needs a line wherever open items are tracked; the F-13 row in the requirement now says "the briefing half is still open" |
| **`audit_trail.hash` is dormant** | **Open, newly found.** A tamper-detection column that is never written (§4, A-7 correction). Reads as protection, provides none |
| **`tokenUsageRepository.contract.test.ts` is red on `main`** | **Open, pre-existing, not mine** (§13.6) |
| **No whole-project typecheck** | **Open, pre-existing.** `tsc -p tsconfig.json` OOMs and there is no `npm run typecheck` (§5.2) |
| **`as never as` casts defeat repository signature changes** | **Open, newly found** (§13.2). The pattern is used in at least 4 Business OS LLM test files and silently survives a parameter-type change |

---

## 9. Risks, Non-Goals and Open Questions for SA (all answered)

| # | Item |
|---|---|
| **R-1** | **Silent-exclusion failure mode** (§3.3): a partial wiring change empties every usage scope with only a `warn`, producing `callCount: 0` entries. Mitigated by the `InsightRunIds` type change and T2's `callCount` assertion. **This is the risk to review hardest** |
| **R-2** | Nine signature changes in a ~2,750-line repository. Purely mechanical, one production caller, compiler-checked |
| **R-3** | `insights.detection_run_id` keeps its run-level meaning. If SA would rather it became per-business (nothing reads it either way), the repository change collapses to a rename and Task 3 shrinks — but then the column contradicts its own migration comment. I recommend against |
| **NG-1** | Not fixing `bosBriefingGroupId`'s same-day wrinkle (F-13's second half) |
| **NG-2** | Not fixing `insight-detect`'s fail-open cron auth in this diff — **separate `fix/` cycle recommended, and it should be prioritised** |
| **NG-3** | No historical backfill, by design (§4) |
| **Q-1** | **Option A (fresh UUID) or B (deterministic v5)?** Recommendation and reasoning in §3.1 |
| **Q-2** | **Guard G1, or tests only (G3)?** §6. G1 is a new runtime pattern and needs an explicit ruling |
| **Q-3** | Is `InsightRunIds` acceptable as a repository signature change, or does SA want the two ids passed as two positional strings (smaller diff, loses the compile-time protection)? |

---

## 10. SA Review Notes

**Reviewed by SA — 2026-09-24**
**Status:** 🔄 **Approve with changes** — the analysis is sound and the root-cause placement is right. Ten changes below, six of which are required before implementation (A-1 to A-6). Reviewed jointly with [BUSINESS_OS_ADMIN_AI_ACTIVITY_SLICE_B0_WORKPLAN.md](/docs/workplans/BUSINESS_OS_ADMIN_AI_ACTIVITY_SLICE_B0_WORKPLAN.md); the cross-plan rulings are in §10.4.

### 10.1 Verified independently

Everything load-bearing in this plan was re-checked against `main` @ `52b43e6a`, not taken on trust.

| Claim | Verdict |
|---|---|
| `runId` minted at `:145`, loop at `:209`, passed as `groupId` at `:228` | ✅ Exact |
| `detection_run_id` written at `:493`, `:532`, `:1903`, `:1956`, `:2309`; `groupId: runId` at `:824`, `:2119`, `:2521` | ✅ Exact |
| `detection_run_id` is read by nothing | ✅ Only `catalog.generated.ts:3529` and the two migrations |
| `route.audit.test.ts` asserts `entityId: runId` for both A and B | ✅ At `:152-157`. The suite does encode the defect |
| `notifyUsage` drops a mismatched `sessionId`, increments `excluded`, warns, never throws | ✅ `usageScope.ts:113-121` |
| `runAiAction` opens the scope with `spec.groupId`; `buildBosCallContext` sets the call's `sessionId` | ✅ `aiActionAudit.ts:279`, `callCatalog.ts:279-299`. **R-1 is real and is the right thing to engineer against** |
| `entityId = spec.groupId` on the audit entry | ✅ `aiActionAudit.ts:215`. §1.3's blast-radius finding is correct and belongs in F-13 |
| `validateIdentities` passes a shared-but-valid UUID | ✅ `aiActionAudit.ts:255` |
| `aiAnalytics.ts:139-145` nulls a non-UUID `session_id` | ✅ The UUID constraint on §3 holds |
| `insight-detect` is the only offender across 16 cron routes and 16 `runAiAction` sites | ✅ Re-swept. Confirmed |
| `usageReport.summarise` is the one genuinely cross-account grouping | ✅ `:136-138` groups `turnIds` over a set that `getChatUsage:239-241` may read across all accounts; correct only because both branches pin `BOS_CHAT_FEATURE` |
| No `console.*` in any file this plan modifies | ✅ All seven are clean. No Pino conversion owed |

Two minor drifts, non-blocking: the signature line numbers in §3.2 are 3–4 lines earlier than the declarations (actual: `396`, `469`, `682`, `871`, `1875`, `2029`, `2233`, `2419`, `2688`); and `verifyCronSecret`'s fail-open `return true` is `:112`, not `:110`. Correct them when you edit.

### 10.2 Rulings on Q-1, Q-2, Q-3

**Q-1 — Option A: a fresh `crypto.randomUUID()` per business. Do not add `bosInsightRunGroupId`.**

Your reasoning against the briefing wrinkle is correct and I verified it (`:145` is inside `GET`, so `runId` is per invocation). I am ruling for A anyway, on a ground the plan does not weigh:

- **The determinism is not load-bearing anywhere.** §3.1 concedes re-derivation is "only ever a debugging convenience", and §3.2's `InsightRunIds` object removes the only failure idempotence would insure against — the two paths receive the same value because they are handed the same field, not because the value is recomputable. You cannot claim both the type-level fix and a need for idempotence; the first makes the second redundant.
- **The one real capability B would buy is a capability we should not want.** Option B makes `insights.detection_run_id` → group id recomputable, i.e. a path from a Gap-B admin row to a business's insight rows. Insight rows are owner content; NFR-2 keeps owner text off that screen. Building a derivation that makes a content join trivially available, in order to support debugging, is the wrong direction.
- **A `NEVER CHANGE` namespace is a permanent compatibility surface.** The existing one (`BOS_BRIEFING_GROUP_NAMESPACE`) has a functional reason to exist, and its determinism is itself F-13's second half. Minting a second one for a value nothing re-derives adds a permanent constraint and buys a log line.
- **It keeps `callCatalog.ts` out of the diff entirely** — a file in `typecheck:bos-llm`'s core scope and on `check:bos-llm-literals`' path. Smaller blast radius on a required-check surface.

**Reversal condition, stated so this is not dogma:** if you or TL can name a *concrete consumer* that must go from `(runId, userId)` to the group id without a log — a feature, not a debugging convenience — take Option B unchanged. Nothing else in the plan moves.

Consequences: **drop Task 2 and T4**; remove `lib/business-os/llm/callCatalog.ts` and `lib/business-os/llm/__tests__/callCatalog.test.ts` from §7. See A-2 for what replaces the forensic value.

**Q-2 — G3 (tests only). G1 is not approved for this cycle.**

G1 is cheap and low-risk, and I agree it would catch this exact shape. It is still the wrong thing to build now:

1. **It polices a class with zero remaining instances.** Your own sweep is the argument against it: one offender, fixed here, every other area single-owner by construction. A new global runtime pattern (CLAUDE.md rule 7) for a population of zero is disproportionate.
2. **The placement works against the module's posture.** `aiActionAudit.ts` is deliberately stateless apart from the memoised `platformActor`. Adding process-lifetime mutable state to the module whose stated contract is "accounting must never fail the call", for a detector that only ever logs, increases that module's risk surface and enforces nothing.
3. **The real enforcement is already in the plan.** `(session_id, user_id)` as the permanent key (§4) plus T1 means a regression in `insight-detect` fails the build. That is stronger than a log line an operator has to be looking for.
4. **G1 sits on the wrong side of the hazard it is justified by.** §2.1 cites `usageReport.summarise` as "the shape that breaks first". That is a **read**-side grouping. G1 is a **write**-side detector; it would not have caught `summarise` and will not catch its successor. See A-8 for the guard that covers the named risk, at a fraction of the cost.

For completeness, so it is not re-proposed later: a database-level guard (a unique index on `audit_trail (entity_id, user_id)` where `entity_type='ai_action'`) is **also** rejected — pre-fix rows already violate it, and the briefing same-day wrinkle legitimately produces two entries for one `(group, account)`.

Consequences: **drop Task 7**; remove `aiActionAudit.ts` and `aiActionAudit.test.ts` from §7.

**Q-3 — `InsightRunIds` approved. Use the object, not two positional strings.**

This is not a new pattern under rule 7 — it is a parameter object, and `CreateInsightParams` (`:396`) already is one. Two positional `string`s are type-identical, so a transposition compiles and lands in the silent-exclusion failure mode; the object is the cheapest thing that makes it a compile error. Nine mechanical signatures with one production caller is a proportionate price.

Implementation note: for `CreateInsightParams` (`:396`) fold the two fields in directly (`runId` + `groupId`) rather than nesting an `InsightRunIds` inside it — one shape per call site, not two.

### 10.3 Changes required and requested

| # | Item | Priority |
|---|---|---|
| **A-1** | Apply the Q-1 ruling: Option A. Drop Task 2, T4 and the two `callCatalog` rows from §7 | **Required** |
| **A-2** | Task 4's log context becomes a **mandatory, explicit** one-line `info` per business carrying `{ runId, userId, businessGroupId }` together. Under Option A this is the *only* record linking a run to its groups, so it is load-bearing, not a convenience — say so in the code comment | **Required** |
| **A-3** | Apply the Q-2 ruling: G3. Drop Task 7 and the two `aiActionAudit` rows from §7 | **Required** |
| **A-4** | Add to §5.2 a mechanical post-change check: `grep -rn "groupId: runId\|groupId: params.runId" lib/ app/` returns **nothing**, and every `buildBosCallContext` in `InsightRepository.ts` is fed from `.groupId`. Cheap, and it is the exact shape of R-1 | **Required** |
| **A-5** | **`route.audit.test.ts`'s mock is part of the hazard, not just a test to update.** `mockCreateBatch` at `:124-126` takes the third positional argument and feeds it straight to `buildBosCallContext` as `groupId`. Under `InsightRunIds` that argument becomes an object; if the mock is not updated it passes an object where a string is expected, `isUuid` fails, `buildBosCallContext` warns, `sessionId` is dropped, `notifyUsage` excludes the call, and **every entry is written with `callCount: 0` — the §3.3 failure, manufactured by the test harness itself**. T2 must assert the mock received an object with **both** keys, and must assert `callCount > 0` on **every** entry, not only that A's is 2 | **Required** |
| **A-6** | §5.3 must state that the manual check is **development-only**. `POST` returns 405 outside development (`route.ts:370-376`), so QA cannot trigger a run on production. Add the production read-only alternative: after the first post-deploy scheduled run, query `audit_trail` for `entity_type='ai_action'` rows in the last 24h having one `entity_id` across two `user_id`s — expect zero | **Required** |
| **A-7** | §4's no-backfill conclusion is **confirmed as permanent**, and it is stronger than the plan argues: `audit_trail` carries a `hash` column for tamper detection (`create_audit_trail.sql:31`). Rewriting `entity_id` would invalidate it on exactly the rows whose value is that they were not edited. Add that sentence — it converts "we would rather not" into "we must not" | Requested |
| **A-8** | The targeted replacement for G1, covering the risk §2.1 actually names. In `lib/business-os/bizql/telemetry/usageReport.ts`, add a comment at `summarise()` stating its precondition — *its rows must be pinned to a feature whose grouping id is minted per account; it groups `turnIds` across whatever it is given* — and one test asserting `getChatUsage` passes `BOS_CHAT_FEATURE` on **both** branches (`:239-241`). Two lines of guard for the one live cross-account grouping in the tree | Requested (may be a follow-up item) |
| **A-9** | NG-1 and NG-2 must become **recorded follow-up items**, not prose. The cron fail-open is already tracked as **H4** in [BUSINESS_OS_INSIGHTS_MODULE.md](/docs/architecture/BUSINESS_OS_INSIGHTS_MODULE.md) `:332` — cite it rather than re-describing it. F-13's briefing half needs its own line wherever open items are tracked | Requested |
| **A-10** | Correct the drifted line numbers noted in §10.1 when editing | Low |

### 10.4 Cross-plan: A ↔ B0

**They agree.** B0 groups on `(user_id, session_id)`, which is correct for both populations, and nothing in B0 assumes this fix has landed (its Analysis Summary and R-10 both say so explicitly). Nothing here assumes B0. **No ordering constraint between the two branches.** Three additions:

- **X-1 — the cut-over date is a cross-plan artefact.** Task 9 records it in the requirement and the insights doc; B0's live cross-tenant probe (its L-1) *depends on finding pre-cut-over shared-id rows*. Publish the date in a form B0 can cite, and tell B0's Dev. Neither plan currently states this dependency.
- **X-2** — B0's audit sub-query includes `a.user_id = g.user_id`, which is what makes its `audit_entry_count` equal 1 rather than N for historical shared-id groups. Your §1.3 finding is why that predicate is load-bearing; it is worth one line in the F-13 update so the next person does not "simplify" it away.
- **X-3 — trivial merge risk.** Both branches edit `BUSINESS_OS_ADMIN_AI_ACTIVITY_VIEW_REQUIREMENT.md` (you: the F-13 row; B0: BA's OQ-1 correction at `:254` and `:560`). Have BA land the OQ-1 correction first, on its own, before either branch edits the file.

### 10.5 Ruling on the cron-secret sequencing (NG-2)

**Keeping it out of this diff is correct.** It is a different defect, a different review, and it has an operational precondition this change does not.

**Scope correction:** it is not one route. `insight-detect:112`, `insight-automations:36` and `insight-metrics:41` all `return true` on a missing `CRON_SECRET` in production; the other thirteen cron routes fail closed. This is already tracked as **H4**, with the prescribed fix ("copy the `payment-reminders` pattern"). The `fix/` cycle must cover **all three**, not only the one in your file.

**Sequencing: cut the `fix/` cycle first in calendar order, but do not block this work on it.** Severity favours it going first — an unauthenticated caller can today trigger a platform-wide detection run that makes LLM calls across every business, which is a cost-amplification and unauthorised-write vector, whereas F-13 is a latent attribution defect with (per your own §2.1) no currently mis-attributing consumer. Doing it first also means the small diff rebases over nothing.

But it must not become a blocker, because **it is not Dev-completable.** Failing closed while `CRON_SECRET` is unset on Vercel turns all three crons dormant — the exact state the payment queue-drain has been in since 2026-08-16, on an environment dependency the user does not own. **TL must put that trade-off to the user before the fix merges** (insights stop running until the secret is set, versus the endpoints stay open): that is a business decision, not Dev's. If the answer is not immediate, this workplan proceeds and the `fix/` cycle rebases on top.

### Approval

- [x] **Workplan approved to proceed to implementation, conditional on A-1 to A-6 being applied to the document first.** A-7 to A-10 are requested, not blocking. Re-submit the amended document for a one-pass SA confirmation — no second full review.
- [x] Q-1 → **Option A**. Q-2 → **G3**. Q-3 → **`InsightRunIds`, approved**.
- [x] Cron fail-open → **separate `fix/` cycle covering all three routes, cut first, not a blocker on this one.** TL owns the user conversation about the dormancy trade-off.

---

---

**Code Review by SA — 2026-09-25**
**Status:** 🔄 **Fix Required** — **two items, C-1 and C-2, both mechanical.** Every line of production code in this diff is approved: the fix is at the right phase, the invariant is stated correctly and held, and the separation of `runId` from `groupId` is complete and verified. C-1 is a fifth instance of §13.2's own finding that the fix missed; C-2 is a markdown table cell that silently drops the X-2 note. **Neither changes runtime behaviour, so QA's concurrent run stands and does not need re-running.** On C-1 and C-2 landing: one-pass confirmation, no second full review.

Reviewed the working tree against `main` @ `b613bb97`. Everything load-bearing below was re-checked against the tree, not taken from §13. **SA changed no source file.**

### 10.6 Verified independently

| Claim | Verdict |
|---|---|
| `businessGroupId = crypto.randomUUID()` minted **inside** the loop, after the budget `break`, **outside** the `try` so the catch can name it | ✅ `route.ts:337`, loop at `:293`, budget break at `:303-309`, `try` at `:372` |
| It feeds `runAiAction({ groupId })` and all three repository calls as `{ runId, groupId: businessGroupId }` | ✅ `:371`, `:400`, `:417`, `:434` |
| `runId` still drives run-level logging, the response body and `detection_run_id` | ✅ `:285`, `:304`, the completion log, and the T5 assertion on the response body |
| The mandatory A-2 line carries all three ids on **one** record | ✅ `:352-355`, `{ runId, userId, businessGroupId }`, `info`, with the load-bearing-not-a-convenience comment A-2 asked for |
| `businessGroupId` added to the per-business error log | ✅ `:470-473` |
| **All three** `buildBosCallContext` sites fed from `.groupId` | ✅ `InsightRepository.ts:1008`, `:2344`, `:2974`. No fourth site exists |
| **All five** `detection_run_id` writes fed from the run id | ✅ `:672`, `:711` (from `params.runId`, flattened per Q-3), `:2128`, `:2181`, `:2585`. Zero use `groupId` |
| `InsightRunIds` threaded through nine signatures, exported from the barrel | ✅ `:404-420` (the type), the nine at `:517`/`:556`/`:858`/`:1052`/`:2097`/`:2251`/`:2455`/`:2743`/`:3209`; `index.ts` exports the type |
| `CreateInsightParams` folds the two fields in flat rather than nesting | ✅ `:424-438`, as ruled in Q-3 |
| A-4 grep 1 — nothing passes a run id as a group id | ✅ Re-ran over `lib/ app/ scripts/` including `groupId: ids.runId` — **no matches** |
| The route's intent comment now says the group is per business and why | ✅ `:312-343`. It states the invariant, the F-13 history and the both-sides consequence (`session_id` **and** `entity_id`). This is the best-documented change in the diff |
| `route.audit.test.ts` no longer asserts the defect | ✅ `expect(entry).toMatchObject({ entityId: runId })` is gone; `forA.entityId !== forB.entityId` replaces it, plus `isUuid` and `details.groupId === entityId` |
| T2 pins the **exact** count and both call names | ✅ `callCount` is `2` and `callNames.sort()` is `['correlated_insight', 'insight_content']`; `callCount > 0` **and** `estimatedCostUsd > 0` on **every** entry; `asRunIds()` throws on a bare string |
| T5 proves separation, not a swap | ✅ `idsA.runId === idsB.runId`, `idsA.groupId !== idsB.groupId`, `idsA.runId !== idsA.groupId`, all three `isUuid` |
| `insight-llm-attribution.test.ts`'s second green assertion on the bug is gone | ✅ `expect(first.sessionId).toBe(second.sessionId)` became `.not.toBe(...)`, split into three tests, each carrying `expect(contexts()[0].sessionId).not.toBe(R1)` |
| Mandatory rules | ✅ No `console.*` in any modified `lib/`/`app/`/`components/` file (measured: 0 in all six); no new `any` in the diff; no new DB access, all of it still behind `InsightRepository`; no API input surface, so no Zod boundary; `userId` still comes from the platform's own enumeration, never from caller data |
| Nothing unsanctioned in the code | ✅ No new dependency, no migration, no schema change, no new pattern beyond the `InsightRunIds` parameter object already ruled on in Q-3 |
| The ten test suites in the blast radius | ✅ Re-ran: **10 suites, 238 tests, 19 snapshots — all pass** (`insight-detect`, `insight-llm-attribution`, `restateIfChanged`, the four `modelSettings*`, `callParams.boundary.step2`, `modelSettingsSeed`) |

### 10.7 Rulings on the five things Dev put back to me

**1 · A-5's symptom — Dev is right and I was wrong. Confirmed.**

`emitAiAuditEntry` returns at `aiActionAudit.ts:304` — `if (calls.length === 0) return; // FR-7: no LLM call, no entry.` — **before** the entry is built. A `callCount: 0` entry cannot exist, so the symptom I wrote into A-5 was unobservable. The two real symptoms are Dev's: a **missing** entry (all calls mismatched) and an **under-counting** entry (some mismatched), and the second is the dangerous one precisely because `callCount: 1` on a business that made 2 calls reads as normal. **A `callCount > 0` assertion does not catch it.** T2's exact-count-and-both-names assertion is the correct fix and is what the test now does. §13.3 supersedes A-5's wording; A-5's *mechanism* (the mock is part of the hazard) stands, and `asRunIds()` is a better answer than the one I asked for.

**2 · A-7's strengthening argument — withdrawn. Dev is right not to have written it in.**

Verified: the column exists (`create_audit_trail.sql:32`, with the comment at `:104`), `AuditTrailService` writes it only under `if (this.config.enableTamperDetection)` (`:153-154`), that resolves to `config.enableTamperDetection ?? false` (`:51`), and **nothing in the tree sets it** — the only other hit is the same file inside a `.claude/worktrees/` copy. Every `audit_trail.hash` is NULL. There is no hash to invalidate, so A-7's sentence would have been a false claim in a requirement doc, which is worse than a weaker argument. **Declining to write an SA-supplied sentence that does not survive checking is the correct behaviour, and the correction note in the H11 block is the right place for it.** No-backfill stands on the two reasons §4 already gives; they are sufficient.

**Ruling on the dormant column: yes, it deserves its own finding — and not in this cycle.** It is not a tidy-up. `audit_trail` is the table the platform points at when it needs to say "this was not edited", the column is publicly commented *"Cryptographic hash for tamper detection"*, and the capability has been advertised-but-off for its whole life. That is a **security-posture** claim the codebase does not honour, and the decision to turn it on is not Dev's: writing a hash on every entry changes the cost and the failure surface of a batched, non-blocking, must-never-fail write path, and a hash that is neither *chained* nor *verified by anything* would be theatre rather than protection. It needs a BA line ("do we claim tamper-evidence, and who verifies it?") before any code. **Recorded in §10.10 as a follow-up, owner TL to route to BA. Do not add it here.**

**3 · The `as never as` re-declarations — the most important thing in the diff, and Dev's fix is right in kind but incomplete.**

I confirmed the mechanism empirically rather than reasoning about it. A minimal case under `--strict`:

```typescript
r['gen']('x', 'not-an-object');                                              // error TS2345 ✅ caught
(r as never as { gen(a: string, ids: string): string }).gen('x', 'not-...');  // no error    ❌ defeated
```

So: **element access on a private member (`repo['method'](…)`) preserves the real declared signature and is checked; a cast onto a hand-written object type is not.** That is the whole finding, and it means the project's strongest gate — `typecheck:bos-llm`, a required status check — has a systematic blind spot exactly where a test reaches into a class.

**Dev's fix (importing the real `InsightRunIds` into each hand-written declaration) is correct but not sufficient**, for two reasons:

- it **missed a fifth instance** — see **C-1**. The likely cause is a search for `as never as`; this one is `as unknown as`. That is itself the lesson: the pattern has more than one spelling, so an enumeration of it drifts — the same two-list failure that produced §13.2 in the first place;
- importing the real type *fixes the instances* but *preserves the shape*. A declaration that has to be manually kept in step with a source of truth is the defect; pinning today's copy of it does not remove the need to remember next time.

**Ruling on a guard: justified, and NOT in this diff. Sequenced, in its own cycle, in this order.**

| Step | What | Why this order |
|---|---|---|
| 1 | **Migrate the ~18 sites from `as never as {…}` / `as unknown as {…}` to `repo['method'](…)`** element access | Mechanical, removes the hole rather than documenting it, introduces **no new pattern** (the idiom is already used in this very diff — `insight-llm-attribution.test.ts` calls `repository()['generateLocalizedContent']`, which is why that file *did* have to be updated while the other four silently did not), and the compiler then polices every one of them for free |
| 2 | **Then** a grep in `scripts/typecheck-bos-llm.ts` rejecting a cast onto an object-literal signature under `lib/business-os/**/__tests__/**` | Existing script, existing CI job, no new pattern, and — critically — **an empty allow-list**. Adding the guard *before* step 1 means grandfathering ~18 exceptions, i.e. building a second list to drift against the first |

I am **not** approving a new guard script, a new lint plugin, or a new CI job for this. The population is ~18 known sites in test files; step 1 is the fix and step 2 is two lines in a script that already runs. Scope it as one small `chore/` cycle and it is done.

**4 · §10.5 is moot. Confirmed — my ruling read a stale tree.**

All four insight crons fail closed on the branch: `insight-detect:192-195`, plus `insight-automations`, `insight-metrics` and `insight-actions`, each `logger.error(...)` + `return false` on a missing `CRON_SECRET`, with the comment citing `payment-reminders`. **There is no `fix/` cycle to cut, no ordering constraint, and no dormancy trade-off for TL to put to the user.** §10.5 is struck; H4 is the record. My error was reviewing a plan investigated at `52b43e6a` without re-checking the branch it would land on — the same class of error as the drifted line numbers in A-10, and the more expensive one, because it invented work for TL and the user.

**5 · Judgement calls.**

| Call | Ruling |
|---|---|
| `scripts/verify-insights.ts` minting its group **separately** rather than reusing `runId` | ✅ **Right, and for the right reason.** A single-user CLI could have passed `{ runId, groupId: runId }` and been correct forever; leaving that shape in a copyable script is how the bug returns. It also keeps A-4's grep honest instead of requiring an exception. One nit in C-4 |
| Its **43 `console.*`**, flagged and not converted | ✅ **Correct call.** CLAUDE.md § Logging scopes the rule to `lib/`, `app/`, `components/`; `scripts/` is outside it, console output is the deliverable of a CLI, and a 43-call rewrite inside an attribution fix is exactly the unrelated churn this reviewer would have asked to be taken out. **Flagging it and leaving the decision to the user is the standard behaviour, not an evasion.** Recorded in §10.10 so it is not lost |
| Splitting `insight-llm-attribution.test.ts`'s second green assertion of the bug into three tests | ✅ **Right, and better than deleting it.** The three tests now name the three distinct properties (intra-business sharing, inter-business distinctness, cross-run distinctness) that were previously entangled in one ambiguous assertion. Finding a *second* test asserting the defect, in a file the plan had already listed, is the kind of thing a plan gets no credit for and should |
| Leaving `tokenUsageRepository.contract.test.ts` red | ✅ **Right.** Repairing another owner's arity pin inside this diff would hide a real signal and would make this diff's "165/166" unverifiable against `main`. Confirmed pre-existing. It belongs to whoever added `summariseFeatureAllAccountsInWindow`; recorded in §10.10 |
| The requirement doc edited in exactly 2 lines, avoiding `:254`/`:560` | ⚠️ **It narrows X-3; it does not resolve it, and the edit has a defect — see C-2.** Narrowing is genuinely valuable: a two-line, non-adjacent edit will very likely merge clean against B0's. But X-3's instruction was about *ordering* (BA lands OQ-1 first), and ordering is unchanged — both branches still hold uncommitted edits to one file. **Ruling: acceptable as-is, no further action on the branch.** The residual risk is a trivial textual conflict, a 30-second RM resolution, not a correctness risk. TL should still tell B0's Dev that this branch touches `:73` and `:490` |

**6 · The `tsc` verification trap — confirmed, and it is worse than reported. It needs a durable home.**

I reproduced it and then went one step further:

| Run | Result |
|---|---|
| `npx tsc --noEmit -p tsconfig.json` | **exit 134**, 1,206 bytes of V8 crash trace, **`grep -c "error TS"` → 0.** Reproduced exactly as §5.2 describes |
| The same with `NODE_OPTIONS=--max-old-space-size=8192` | **Completes.** exit 2, **2,081 `error TS`**, >10 minutes |

So the trap is real **and** the figure the crashed run appears to report is not merely unverified, it is wrong by ~2,081. Two consequences worth recording:

- the failure is **silent, not loud** — it exits non-zero but prints nothing matching the pattern anyone greps for, so every naive `tsc | grep -c "error TS"` reads a clean pass. This has already happened in at least one prior cycle (there is a `tsc --noEmit … | grep -E "error TS" | sort > /tmp/tsc_base.txt` invocation in the local settings history), so it is a repo-wide hazard, not a one-off slip;
- a whole-project `npm run typecheck` is **not adoptable as a gate today** — it would be red on day one with ~2,081 errors (some in generated `.next/types/**`). The adoptable shape is the one `typecheck:bos-llm` already implements: scoped, with a recorded baseline and a new-errors-only failure. That is an argument *for* the existing design, and it should be written down before someone proposes a naive project-wide gate.

**Ruling: yes, this must be recorded durably, and NOT in this workplan** (a workplan is archived the moment RM commits; this outlives it). **Owner: TL.** Two places, one line each:

1. **CLAUDE.md § Common Gotchas & Anti-Patterns → Build table** — one row: project-wide `tsc --noEmit` OOMs (exit 134, no output, so a `grep -c "error TS"` reads 0 and looks like a pass); use `npm run typecheck:bos-llm`, or pass `--max-old-space-size=8192` and expect a ~2,081-error baseline. That table already warns that `next.config.js` ignores TS errors, so it is the natural home;
2. **the test-strategy / CI-tiering workplan** — as an item: *"there is no whole-project typecheck, and the measured baseline is ~2,081 errors"*, with the scoped-plus-baseline model named as the shape any future gate should take.

Dev catching its own false "zero errors project-wide" before reporting it is the behaviour this process wants; the finding is that the tool makes that mistake easy, not that the mistake was made.

### 10.8 Code Review Comments

| # | Item | Priority |
|---|---|---|
| **C-1** | 🔄 **`lib/business-os/insight/repository/__tests__/restateIfChanged.test.ts:69` and `:158` — a FIFTH `as`-cast re-declaration of a changed signature, missed by §13.2's fix.** Both declare `restateIfChanged: (s: unknown, d: DetectionResult, u: string, r: string) => …` and both call it with the bare string `'run-1'` (`:70`, `:159`). The real fourth parameter is now `InsightRunIds`. The file **is in `typecheck:bos-llm`'s scope** — confirmed with `--list`, reason `caller` — and the gate cannot see it for exactly the reason §13.2 gives: the cast asserts the wrong signature is right. It is **behaviourally inert today** (the test stubs `generateLocalizedContent`, so `ids` is never dereferenced; all 9 tests pass), which is precisely why it must not be left: it is a declaration in the repository's own test directory telling the next reader the parameter is a `string`, and it will not warn them when `InsightRunIds` next changes. Two spellings of one pattern is also the finding — §13.2 searched for `as never as`, this one is `as unknown as`. **Fix:** import `InsightRunIds` and use it in both declarations, exactly as the other four files now do — or, better and equally small, drop both casts for the `repo['restateIfChanged'](…)` element-access form, which the compiler checks (§10.7.3). No other change needed | **High** |
| **C-2** | 🔄 **`docs/requirements/BUSINESS_OS_ADMIN_AI_ACTIVITY_VIEW_REQUIREMENT.md:73` — the X-2 note sits in a fourth cell of a three-column table, so it will not render.** The findings table header is three columns. The edited F-13 row ends `… (written as \`session_id\`) \| **Post-fix note for B0:** …` with no closing pipe — a fourth cell that GFM **drops silently**. The X-2 note (why B0's `a.user_id = g.user_id` predicate is load-bearing) is therefore invisible in the rendered doc, which defeats the entire purpose of writing it: it exists to stop B0's Dev simplifying that predicate away. **Fix:** fold it into the finding cell (cell 2) and restore the trailing pipe. Zero risk, and it keeps the 2-line X-3 footprint | **Medium** |
| **C-3** | ℹ️ **Same row, presentation only:** it now opens `✅ Insights half FIXED 2026-09-25` and then continues in the **present tense** — *"`insight-detect` mints `runId` … once per cron run … and passes that same value as `groupId` for every business"* — with an Evidence cell still citing `route.ts:143`/`:217` and `InsightRepository.ts:757, 1783, 2185`, none of which are current lines. It is readable as history, but the house convention for a corrected claim here is `~~strikethrough~~` on the stale prose (see `BUSINESS_OS_INSIGHTS_MODULE.md` H1, H2, H8 — and this diff's own H11). Worth doing **while C-2 is being fixed, in the same two lines** — not worth a separate edit | **Low** |
| **C-4** | ℹ️ **`scripts/verify-insights.ts:64` — `const ids = { runId, groupId: crypto.randomUUID() };` is untyped.** It infers the right shape and compiles, but it is the one new construction of this object *not* pinned to the source of truth — the same hand-written-shape habit C-1 is about. `const ids: InsightRunIds = { … }` costs one import and makes the script fail loudly if the type ever gains a field. Optional | **Low** |

### 10.9 Optimisation Suggestions

- **The A-2 log line fires for every business, including ones that make no LLM call.** Business C gets a logged `businessGroupId` that will never appear in `token_usage` or `audit_trail`, because it had no detections. That is correct behaviour (the id is minted before we know whether a call will happen) and moving the line would weaken it. **But it is a trap for whoever runs §5.3:** three log lines and two audit entries is the *expected* result, not a missing entry. Worth one clause in §5.3 item 5 so QA does not chase it. Not a code change.
- **`route.audit.test.ts`'s `asRunIds()` is the right shape and deserves reuse.** It is a runtime contract on a `jest.fn()` that TypeScript cannot type — the correct answer where mocks are `(...a: unknown[])`. If a second cron grows the same mock shape, lift it rather than copy it.
- The `usageReport.summarise()` precondition comment (A-8) is better than what I asked for: it names `usage-report.reads.test.ts` as the thing holding the pin in place, so the guard is discoverable *from the function* rather than only from the test. That is the pattern to reuse for any other precondition-on-the-caller.

### 10.10 Follow-ups this review adds or confirms

| Item | Owner | State |
|---|---|---|
| **`audit_trail.hash` is dormant** — a publicly commented tamper-detection column that is never written (`enableTamperDetection ?? false`, no setter in the tree) | TL → BA | **Open, newly found.** Needs a requirement line ("do we claim tamper-evidence, and who verifies it?") before any code. **Not a tidy-up** — §10.7.2 |
| **`as`-cast re-declarations defeat every signature change** — ~18 sites, at least 2 spellings, inside a required check's scope | TL | **Open, newly found.** Own `chore/` cycle: **step 1 migrate to element access, step 2 then guard** — §10.7.3. Do not build the guard first |
| **No whole-project typecheck, and the tool's failure is silent** — exit 134 with no output reads as a pass; measured baseline with an 8 GB heap is **~2,081 errors** | TL | **Open, pre-existing.** Record in CLAUDE.md § Build gotchas **and** the test-strategy workplan — §10.7.6 |
| **`tokenUsageRepository.contract.test.ts` red on `main`** — `EXPECTED_ARITY` missing `summariseFeatureAllAccountsInWindow` | TL → the owner of that change | **Open, pre-existing, correctly not fixed here** |
| **`bosBriefingGroupId`'s same-day wrinkle** (F-13's second half) | TL | **Open.** Unchanged by this cycle; the F-13 row now says so |
| **`scripts/verify-insights.ts` has 43 `console.*`** | User | **Open, flagged not converted.** Correctly a user decision, not a smuggled rewrite |
| **The cron fail-open (NG-2 / §10.5)** | — | ✅ **Closed on `main` 2026-09-23 (H4).** §10.5 struck; no cycle, no user conversation |
| **`.claude/settings.local.json` and `.gitignore` are modified in the working tree** and are **not** in §7's file list | RM | Session ambience (a permissions list and a `.claude/launch.json` ignore line), not part of this change. **RM must not fold them into this commit** — commit by pathspec |
| **`docs/requirements/ADMIN_MODULE_BOS_REORGANISATION_REQUIREMENT.md` missing from disk** (§13.8) | — | ✅ **Stale — the file is on disk now** (45,905 bytes, dated 2026-09-25, still untracked), so it was almost certainly held by a concurrent session rather than lost. §13.8 can be struck. The durable lesson is the one it illustrates: **an untracked doc has no recovery path**, so a long-lived requirement should be committed early rather than carried in the working tree |

### Code Approved for QA

**Yes — QA proceeds now, and its current concurrent run is valid.** C-1 is a test-file declaration with no runtime effect; C-2 and C-3 are markdown. None of them changes anything QA is exercising. **C-1 and C-2 must land before RM commits.** No re-review of the rest of the diff.

**On the shape of the work overall, for the record:** the production change is small, correct, placed at the root cause, and better documented than the plan required. Two of the three most valuable findings this cycle came from Dev checking the reviewer rather than applying the review — A-7's argument does not survive contact with the tree, and A-5's predicted symptom was unobservable. Both corrections are right, both are recorded in the tree rather than only in conversation, and the second one changed a test assertion for the better. That is the behaviour this gate exists to produce.

## 11. QA Testing Report

**QA — 2026-09-25**
**Test mode:** full (all acceptance criteria + error/edge paths + a mutation audit)
**Strategy used:** **A + B + E** — Jest unit/integration (the diff is entirely repository/route logic with mocked providers and no DB), plus **mutation testing** (the only way to tell a real assertion from a decorative one), plus **log/source analysis** for the parts no test can reach. **Option D (Playwright) does not exist in this repo** (CLAUDE.md § Testing) and there is no UI in this diff.
**Focus:** security (tenant isolation) + api + schema — in that order, because F-13 is an attribution-isolation defect
**Skipped:** the §5.3 manual DB check and the §5.3.1 production read — see *Could not verify*. Nothing else.
**Input source:** prompt keywords (tenant-isolation framing, the four `as never as` files, under-counting, mutation re-run, the bug-asserting tests, cron regression) + the workplan's §5 verification block
**Reviewed independently of SA**, who was reviewing concurrently. No source file was modified to make anything pass; the mutations below were reverted and proved byte-identical by SHA-256.

---

### Verdict summary

**The tenant-isolation property genuinely holds.** Two businesses in one run provably get distinct group ids; each business's two calls provably still share one group and produce one audit entry with `callCount: 2`; and `runId` provably stays run-level. All three are enforced by assertions I proved can fail.

**But the `as never as` sweep is incomplete.** A fifth file re-declares one of the nine changed signatures as `r: string` and is green only because it mocks the method that would have read `groupId`. §13.2's claim that the fix is complete is not accurate. One Medium bug, plus Low-severity items.

---

### Dev's numbers — independently reproduced

| Claim (workplan §5.2 / §13) | QA measured | Verdict |
|---|---|---|
| Scoped suite: **152/153 suites, 2,366/2,367 tests** | `152 passed, 1 failed, 153 total` / `2,366 passed, 1 failed, 2,367 total`, 23/23 snapshots | ✅ **Exact** |
| The one failure is **pre-existing on `main`**, `tokenUsageRepository.contract.test.ts` | ✅ **Confirmed, by a stronger argument than a worktree run.** Both the test and its subject (`lib/repositories/TokenUsageRepository.ts`) are **byte-identical to `b613bb97`** (`git diff b613bb97` on both paths is empty; neither is in the diff), and the method its `EXPECTED_ARITY` map omits — `summariseFeatureAllAccountsInWindow` — **is present in the committed source at `b613bb97`** (`git grep b613bb97` → `TokenUsageRepository.ts:455`). The failure is independent of this diff by construction. A detached worktree at `b613bb97` reproduced it as well (below) | ✅ **Confirmed, not Dev's** |
| `typecheck:bos-llm`: **242 files, 28 errors, 0 new** | `242 files in scope, 28 errors, 0 new (234.6s)` → `passed` | ✅ **Exact.** Extra observation: it also reports *"1 baseline entry is fixed"* (`app/api/onboarding/build/route.ts` / TS18047) — unrelated pre-existing baseline drift, not this diff's |
| `check:bos-llm-literals`: **43 files, 2 exempt, 0 violations** | `43 files in scope, 2 exempt, 0 violations (85.3s)` → `passed` | ✅ **Exact** |
| `schema:check`: **32 of 608 identical** | `FAIL — 32 of 608 selects cannot run` | ✅ **Exact** |
| ESLint on the touched files: **0 errors / 4 warnings** | `4 problems (0 errors, 4 warnings)` — 3 `no-unused-vars` in `InsightRepository.ts` (`:2613 _omitted`, `:2816 trendText`, `:3627 darkCount`) + 1 unused-disable in `modelSettings.off.nonchat.test.ts:423` | ✅ **Exact** |
| A-4 grep 1: no `groupId: runId` / `groupId: ids.runId` anywhere | `grep -rn` over `lib/ app/ scripts/` → no matches (exit 1) | ✅ **Clean** |
| A-4 grep 2: every `buildBosCallContext` fed from `.groupId` | All **3** sites (`:1008`, `:2344`, `:2974`) read `ids.groupId`; all **5** `detection_run_id` writes (`:672`, `:711`, `:2128`, `:2181`, `:2585`) read `runId` / `ids.runId`. No crossover | ✅ **Clean** |
| `tsc --noEmit -p tsconfig.json` OOMs and silently reads as a pass | Not re-run — accepted as recorded, and **the trap was not repeated**: every type claim here rests on `typecheck:bos-llm` | ✅ Accepted |

**⚠️ One figure in the QA brief does not match this workplan.** The brief quoted **165/166 suites, 2,892/2,893 tests**. No command recorded anywhere in this document produces those counts; §5.2's recorded command produces **152/153 and 2,366/2,367**, which is what I reproduced to the test. Treat 152/153 as the real scoped figure.

#### Whole-suite regression, both sides of the change

Run because the brief asks that nothing else regressed, and because the scoped glob does not cover `app/api/business-os/**`.

| | Suites | Tests |
|---|---|---|
| **Branch** (`npm test`, 215s) | 24 failed, 8 skipped, **489 passed**, 521 total | 143 failed, 64 skipped, **8,092 passed**, 8,299 total |
| **Baseline** — detached worktree at `b613bb97` (`node_modules` junctioned in) | 24 failed, 8 skipped, **489 passed**, 521 total | 143 failed, 65 skipped, **8,086 passed**, 8,294 total |

**The set of 24 failing suites is identical between the two** (`diff` of the sorted `FAIL` lists → no difference). They are the known-red-on-`main` population: 6 × V6/DeclarativeCompiler, 5 × pilot, 5 × agentkit, 2 × website-builder, 2 × orchestration, `featureFlags`, `v4-generator`, the `tokenUsageRepository` pin, and `chat-v4/route.audit.test.ts`. The last is the only Business OS one; it crashes its own worker from a deliberate throw in its own fixture (`profile read failed for OWNER-TEXT-MARKER-c1 cancel`), is untouched since `b613bb97`, and imports nothing in this diff.

The deltas are all accounted for: **+5 tests** are the five new/split tests (route.audit 2→5, attribution's `grouping across a run` 1→3), and **+6 passed / −1 skipped** because the worktree has no `.env.local` (untracked, so not carried into a worktree), which makes `enum-drift.test.ts`'s `describeIfConnected` skip at baseline and run in the real repo. Not a regression.

---

### Mutation audit — Dev's three re-run, plus one of mine

The sandbox **did** permit a test-only write, so these are measured, not accepted. `route.ts` and `route.audit.test.ts` were copied to the scratchpad first and restored after each mutation; `sha256sum -c` returned `OK` for both after every revert, `grep -rn "QA-MUTATION"` returns nothing, and `git diff --stat` on the two files is back to `182 +` / `70 +`.

| # | Mutation | Dev claimed | QA measured |
|---|---|---|---|
| **1** | `const businessGroupId = runId` — reintroduce F-13 exactly | 2 of 5 fail | ✅ **2 of 5.** `two businesses … get DIFFERENT entity ids (F-13)` and `the run id stays run-level (T5)`, both verbatim `expect(received).not.toBe(expected)` |
| **2** | `createBatch` mock feeds `ids.runId` (valid UUID, wrong group) | 4 of 5 fail; entries 2→1; A shows `callCount: 1, callNames: ['correlated_insight']` | ✅ **4 of 5**, and the under-count was observed **verbatim in the received entry**: `"callCount": 1, "callNames": ["correlated_insight"]`, one entry instead of two. T5 survives, by design |
| **3** | `createBatch` mock feeds the whole `ids` object (A-5 literal) | 4 of 5 fail; entries 2→1→0 | ✅ **4 of 5.** Entries 2→1, and B's FAILED entry →0 |
| **4** | **QA's own: mismatch ONLY the second call** (`saveCorrelationResults` → `ids.runId`), so the entry survives and merely under-counts | — | **1 of 5 fails.** This is the brief's exact worry, isolated: both entries present, both valid UUIDs, distinct, `callCount > 0` ✅ and `estimatedCostUsd > 0` ✅ **both green**. The only thing that catches it in the entire suite is `expect(forA[0].details.callCount).toBe(2)` |

**Conclusion on under-counting: the risk is real, it is caught, and it is caught by exactly one assertion.** §13.3's correction of A-5 is right — `callCount: 0` cannot be written (`emitAiAuditEntry` returns early at zero calls) and the true symptoms are a *missing* entry or a *plausible-looking under-count*. A `> 0` assertion is demonstrably insufficient; the exact `toBe(2)` is what does the work. See Edge Cases for the one-line margin.

---

### The `as never as` sweep — QA's result

Dev's sweep keyed on the literal string `as never as`. I swept that **and** the wider shape (`as unknown as {` / `as any as {` onto an inline object type declaring methods) across `lib/ app/ components/ scripts/ types/ hooks/`.

| Site | Method re-declared | Status |
|---|---|---|
| `callParams.boundary.step2.test.ts:437, :444, :451` | `generateLocalizedContent`, `generateCorrelatedContent`, `generateHealthNarrative` | ✅ **Fixed** — imports the real `InsightRunIds` |
| `modelSettings.off.nonchat.test.ts:254` | all three generators | ✅ **Fixed** |
| `modelSettings.wiring.nonchat.test.ts:156` | `generateLocalizedContent` | ✅ **Fixed**, and its `session_id` assertion now pins `INSIGHT_GROUP` |
| `callParams.boundary.step2.test.ts:470, :528, :540, :547, :554, :561` / `modelSettings.off.nonchat.test.ts:451` | `WebsiteGenerationService.callLLM`, `IntakeGenerationService.callLLM`, `OnboardingConversationManager.extract{BusinessStory,ClientWorkflow,ClientTracking,AdjustmentIntent}` | ✅ **Not drifted today** — checked each against the real declaration (`WebsiteGenerationService.ts:590`, `IntakeGenerationService.ts:292`, `OnboardingConversationManager.ts:1062`, `:1116`, …). Arities and shapes line up (Website declares 4 of 5 params, the 5th being optional `focus?`). Correctly out of scope here; they remain the latent hazard §13.2 records |
| **`lib/business-os/insight/repository/__tests__/restateIfChanged.test.ts:68, :157`** | **`restateIfChanged` — one of the nine signatures this diff changed** | ❌ **MISSED. See Bug QA-1** |
| `runningAutomations.test.ts:52`, `OpsUtilizationLow*.test.ts`, `deduplicate.test.ts`, `date-anchors`/`prompt-scope`, `serviceActivation`, `business-os-plugin-e2e.ts` | methods not touched by this diff | ✅ Not affected |

`insight-llm-attribution.test.ts` deserves a note the workplan does not make: it reaches the same private generators through **`repo['generateLocalizedContent'](…)`**, which TypeScript *does* type-check against the real class. That is why it is a genuine guard and the four `as never as` files were not — worth saying out loud, because it is the pattern the others should have used.

---

### Test Coverage

| Acceptance criterion | Tested? | Result | Notes |
|---|---|---|---|
| **The property: two businesses in one run get DISTINCT group ids** | ✅ | **Pass** | `route.audit.test.ts` — `forA.entityId !== forB.entityId`, both `isUuid`, `details.groupId === entityId`. Mutation 1 proves it fails against the old code |
| **Each business's own calls still share ONE group → ONE entry with the right count** | ✅ | **Pass** | One entry for A, `callCount: 2`, `callNames: ['correlated_insight','insight_content']`, both calls provably in one group. Mutations 2/3/4 all break it |
| **Under-counting (not zero-counting) is detected** | ✅ | **Pass — with a one-line margin** | QA mutation 4: caught by `toBe(2)` alone; `> 0` and `estimatedCostUsd > 0` both stay green |
| **`runId` stays run-level and was not merely renamed** | ✅ | **Pass** | T5: `idsA.runId === idsB.runId`, `idsA.groupId !== idsB.groupId`, `runId !== groupId`, all three `isUuid` |
| **The test that asserted the bug now asserts the fix** | ✅ | **Pass** | `route.audit.test.ts:152-157`'s `entityId: runId` is gone; replaced by `not.toBe`. `insight-llm-attribution.test.ts`'s second green-on-the-bug assertion (`first.sessionId).toBe(second.sessionId)`) is now `not.toBe`, split into three tests (one business shares; two never do; two runs differ). Both would fail against the old code |
| **The repository honours `.groupId`, never `.runId`** | ✅ | **Pass** | Rows 7/8/9 each additionally assert `sessionId !== R1`; `createBatch`/`saveCorrelationResults` assert both ids forwarded and distinct |
| **The FAILED path (WC-8) is unchanged** | ✅ | **Pass** | Still one FAILED entry for B, loop continues. Note it is no longer a pure regression test — the mock now makes two calls — but it passes, and mutations 2/3 show it still bites |
| **`runId` still reaches logging, the response body and all 5 `detection_run_id` writes** | ✅ | **Pass** | Logging at `route.ts:230, 286, 306, 358, 473, 484`; response body `:494`; the 5 writes verified above. The response-body assertion is weak — see Edge Cases |
| **No other consumer of a grouping id regressed** | ✅ | **Pass** | `entitlements/report`, `ChatBudget`, `usageReport`, `useAnalyticsData`, `TokenUsageRepository`, `aiAnalytics` all in the scoped run; `usage-report.reads.test.ts` green (the A-8 test half §13.4 says already exists — confirmed present and passing) |
| **Nothing else in the tree regressed** | ✅ | **Pass** | Full suite, both sides: identical 24-suite failing set |
| **A-2: one mandatory `info` line per business with all three ids** | ⚠️ | **Present, unguarded** | Code is correct (`route.ts:357-360`) and fires for every business, including one with no detections. **No test asserts it** — Bug QA-3 |
| **§5.3 manual DB check (dev-only)** | ❌ | **Not run** | Needs `NODE_ENV=development`, a local DB and two seeded businesses. See *Could not verify* |
| **§5.3.1 production read-only check** | ❌ | **Not run** | Needs a post-deploy 03:30 run |

---

### Issues Found

#### Bugs (must fix before commit)

**1. QA-1 — The `as never as` sweep missed `restateIfChanged.test.ts`, which still re-declares a changed signature as `string`.** — File: `lib/business-os/insight/repository/__tests__/restateIfChanged.test.ts` — **Severity: Medium**

`restateIfChanged` is signature #2 of the nine this diff changed (`InsightRepository.ts:556`, now `ids: InsightRunIds`). This test reaches it through a hand-written re-declaration at **two** sites:

```typescript
(repository as unknown as {
  restateIfChanged: (s: unknown, d: DetectionResult, u: string, r: string) => Promise<Record<string, unknown>>;
}).restateIfChanged(stored, fresh, 'user-1', 'run-1');
```

`r: string`, and the argument is the literal `'run-1'` — not even a UUID. The real parameter is an object. This is precisely the defect §13.2 describes, in the same module, for a method in the same change.

- **Steps to reproduce:** `grep -n "restateIfChanged:" lib/business-os/insight/repository/__tests__/restateIfChanged.test.ts` → `:68` and `:157`.
- **Expected:** `r: InsightRunIds` (imported, not re-typed) and a `{ runId, groupId }` argument, as the four sibling files now do.
- **Actual:** `r: string`, argument `'run-1'`. The suite is **green — 9/9 passed** — because `repo()` replaces `generateLocalizedContent` with a `jest.fn()`, so nothing ever reads `ids.groupId`. The broken path is exercised and masked.
- **Why it matters, concretely:** (a) §13.2's *"Fixed by importing the real `InsightRunIds` into each hand-written signature"* is **not true of the whole tree**; (b) the file now documents a signature that does not exist, which is the exact trap Dev set out to close; (c) `restateIfChanged` is a real LLM-calling path (a rewrite is a tracked call) and it is the **one** such path none of the new tests cover, so it has no protection against a future `groupId`→`runId` regression.
- **Root cause of the miss:** the sweep keyed on the string `as never as`; this file uses `as unknown as`. The fix and the sweep pattern should both widen.
- **Fix:** two lines — import `InsightRunIds` and pass `{ runId: 'run-1', groupId: '<a distinct uuid>' }` at `:68` and `:157`. QA has not applied it.

#### Performance Issues (should fix)

**None found.** The change adds one `crypto.randomUUID()` per business per run and no queries, no LLM calls and no round trips. The `RUN_BUDGET_MS` / `maxDuration` reasoning is unaffected. §3.5's "adds no per-user work" holds.

#### Edge Cases (nice to fix)

**2. QA-2 — SA's X-2 note will not render, and the F-13 row now reads as both fixed and broken.** — File: `docs/requirements/BUSINESS_OS_ADMIN_AI_ACTIVITY_VIEW_REQUIREMENT.md` `:73`, `:490` — **Severity: Low**

Line 73 carries **4** pipe-delimited cells with **no trailing pipe**, in a table whose header (`|---|---|---|`) declares **3** columns; every neighbouring row has 3 and ends with a pipe. Markdown renderers drop the surplus cell, so the entire *"**Post-fix note for B0:** the audit sub-query's `a.user_id = g.user_id` predicate is load-bearing … Do not 'simplify' it away (SA X-2)"* text is **invisible where B0's Dev would read it** — while §7 records X-2 as delivered. Separately, both `:73` and `:490` prepend the fixed status to the original present-tense prose, so the row now says "✅ FIXED" and then *"`insight-detect` mints `runId` … once per cron run, outside the per-business loop"* as if current, with citations that were already stale (`route.ts:143`, `:217`, `:206`; `InsightRepository.ts:757, 1783, 2185` — the real sites are `:1008/:2344/:2974` and `:672/:711/:2128/:2181/:2585`). Fix: close the row at 3 cells and fold the X-2 note into the cell that will render; past-tense the superseded sentences.

**3. QA-3 — the A-2 log line SA called mandatory and load-bearing is the one thing in this diff no test guards.** — File: `app/api/cron/insight-detect/route.ts:357-360` — **Severity: Low**

Under Option A the group id is random, so this `info` line is the **only** record tying a run to its groups — SA's words, and the code comment says so at length ("Load-bearing, not a convenience… Without it a run cannot be reconstructed from the ledger or the audit trail at all"). Nothing asserts it: `grep` for `Business AI usage group` in any test returns only a comment. Delete the line and the suite stays green, while the forensic capability SA accepted in exchange for dropping Option B disappears silently. A `pino` spy asserting one `info` per business carrying all three ids is a handful of lines, and §5.3 step 5 already says "its absence is itself a defect".

**4. T5's response-body assertion is weaker than it reads.** — `route.audit.test.ts` — **Severity: Low**
`expect(JSON.parse(JSON.stringify(body)).data.runId).toBeDefined()` only proves *a* `runId` is present. A change that reported a different value in the response body than the one handed to the repository would pass. `toBe(idsA.runId)` costs nothing and closes it.

**5. `scripts/verify-insights.ts` mints the object without annotating it.** — `:58` — **Severity: Low**
`const ids = { runId, groupId: crypto.randomUUID() };` type-checks structurally. `const ids: InsightRunIds = …` would pin it to the source of truth, which is the whole point of the object; the comment above it is good and should stay.

#### Observations, not defects

- **§13.8's missing document is back.** `docs/requirements/ADMIN_MODULE_BOS_REORGANISATION_REQUIREMENT.md` was **absent** from `git status` at the start of this QA session and is **present as untracked now** (45,905 bytes, mtime 2026-09-25 15:14). QA did not create it; a concurrently running session is the likely source. §13.8 can probably be closed — but confirm the content before trusting it.
- **QA's own environment incident, disclosed for completeness.** Removing the baseline worktree deleted `node_modules/.bin` through the junction I had created (git walked the link). Repaired with `npm install`: `.bin` restored to 165 entries, `package.json` and `package-lock.json` **unmodified** (`git status` clean on both), and the scoped suite re-run green (31/31 suites, 268/268 tests) to confirm the toolchain. **No source file was affected**; the final `git diff --stat` is identical to the pre-QA state (15 files, 505 insertions, 108 deletions). Anyone repeating the baseline comparison should delete the junction *before* `git worktree remove`.
- The `usageReport.summarise()` A-8 comment is accurate and names `usage-report.reads.test.ts`, which exists and passes.
- `scripts/verify-insights.ts`'s 43 `console.*` calls are correctly flagged-not-converted (a CLI script, outside CLAUDE.md § Logging's stated scope). No Pino debt is owed by this diff; no `console.*` in any other touched file.

---

### Test Outputs / Logs

Scoped suite (§5.2's recorded command), branch:

```
Summary of all failing tests
FAIL lib/business-os/usage/__tests__/tokenUsageRepository.contract.test.ts (5.436 s)
  ● TokenUsageRepository account contract › pins every public method and its arity; no account filter became optional

    expect(received).toEqual(expected) // deep equality

    - Expected  - 0
    + Received  + 1

    +   "summariseFeatureAllAccountsInWindow",

      at Object.<anonymous> (lib/business-os/usage/__tests__/tokenUsageRepository.contract.test.ts:84:34)

Test Suites: 1 failed, 152 passed, 153 total
Tests:       1 failed, 2366 passed, 2367 total
Snapshots:   23 passed, 23 total
```

Mutation 2 — the under-count observed directly (one entry where there should be two, `callCount: 1` where the truth is 2):

```
● writes one entry per business that made a call, on the platform actor, each counting its calls
  expect(received).toHaveLength(expected)
  Expected length: 2
  Received length: 1
  Received array:  [{... "callCount": 1, "callNames": ["correlated_insight"], "estimatedCostUsd": 0.0004,
                     "groupId": "bac9c553-3f3a-446f-84ac-07cd8e0d5572", "outcome": "succeeded" ...}]
Tests: 4 failed, 1 passed, 5 total
```

QA mutation 4 — only the *second* call mismatched; the entry survives and under-counts, and four of five tests stay green:

```
  √ writes one entry per business that made a call, on the platform actor, each counting its calls
  √ two businesses in one run get DIFFERENT entity ids, each a UUID (F-13)
  × one business's calls still SHARE its group: two calls, one entry, callCount 2
  √ the run id stays run-level and is NOT the group: A and B share it (T5)
  √ a business that throws after its call gets exactly one FAILED entry, and the loop continues (WC-8)
Tests: 1 failed, 4 passed, 5 total
```

Gates:

```
typecheck-bos-llm: 242 files in scope, 28 errors, 0 new (234.6s) — passed
check-bos-llm-literals: 43 files in scope, 2 exempt, 0 violations (85.3s) — passed
schema:check: FAIL — 32 of 608 selects cannot run   (identical to baseline; none in a touched file)
eslint (10 touched code files): 4 problems (0 errors, 4 warnings)
```

Full suite, branch vs. detached worktree at `b613bb97`:

```
branch    Test Suites: 24 failed, 8 skipped, 489 passed, 521 total
          Tests:       143 failed, 64 skipped, 8092 passed, 8299 total
baseline  Test Suites: 24 failed, 8 skipped, 489 passed, 521 total
          Tests:       143 failed, 65 skipped, 8086 passed, 8294 total
diff of the sorted FAIL lists: IDENTICAL FAILING SETS
```

Restoration proof after the mutations:

```
app/api/cron/insight-detect/route.ts: OK
app/api/cron/insight-detect/__tests__/route.audit.test.ts: OK
grep -rn "QA-MUTATION" app/ lib/ scripts/  → no matches
git diff --stat → 15 files changed, 505 insertions(+), 108 deletions(-)
```

---

### Could not verify, and why

| Item | Why |
|---|---|
| **§5.3 manual DB check** (two `ai_action` entries with different `entity_id`; each business's `token_usage` rows carrying only its own `session_id`; both businesses sharing one `detection_run_id`; non-zero `callCount`; the A-2 log line) | Needs `NODE_ENV=development`, a local database and **two seeded businesses**. Not available in this session, and seeding two tenants into a shared database to satisfy a check is not something QA should do unasked. **The equivalent properties are all covered by automated tests** (rows 1–4 and 8 of the coverage table) at the route/repository boundary with the real `usageScope` and entry builder running — what the manual check adds is the real DB write, not the logic. It should still be run before deploy |
| **§5.3.1 production read** (`audit_trail` `ai_action` rows in the last 24h with one `entity_id` across two `user_id`s) | `POST` is 405 outside development; it requires the first post-deploy 03:30 run. Belongs to RM/TL after merge, and the cut-over date it depends on is now recorded in `BUSINESS_OS_INSIGHTS_MODULE.md` H11 |
| **Whole-project type safety** | `tsc --noEmit -p tsconfig.json` OOMs (exit 134) and prints nothing, so it cannot be used — the trap was **not** repeated here. `typecheck:bos-llm` (242 files, 0 new) is the real gate and it covers every file in this diff except `route.audit.test.ts`, `insight-llm-attribution.test.ts` and `verify-insights.ts`; those three are compiled and executed by Jest instead |
| **The brief's 165/166 suites / 2,892/2,893 tests** | No command in this workplan produces those figures. §5.2's recorded command reproduces 152/153 and 2,366/2,367, and `npm test` gives 521 suites / 8,299 tests. The brief's number appears to come from a run that was not recorded |
| **Whether the reappeared `ADMIN_MODULE_BOS_REORGANISATION_REQUIREMENT.md` is the original** | Untracked, so there is no git object to compare it against |

---

### Final Status

- [ ] All acceptance criteria pass — ready for commit
- [x] **Issues found — Dev must address before commit**

**Verdict: the fix is correct and the tenant-isolation property genuinely holds; one Medium bug should be closed first.**

What is settled: the root cause is fixed in the right place (the loop's minting scope), the two identifiers are genuinely separated rather than swapped, the intra-business sharing is preserved at `callCount: 2`, the two tests that asserted the defect now assert the fix and would fail against the old code, the under-counting risk Dev identified is real and is caught, nothing else in the tree regressed, and every number in §5.2 reproduces exactly.

**Blocking:** **QA-1** — widen the sweep from `as never as` to the `as unknown as {` shape, and fix `restateIfChanged.test.ts:68, :157`. It is two lines, but it is the same defect class as §13.2, in the same module, for one of the same nine signatures — and leaving it means the workplan's most important finding is recorded as closed while an instance of it survives inside the diff's own blast radius.

**Recommended in the same pass** (cheap, and all in files already open): **QA-2** (SA's X-2 note is currently unrenderable), **QA-3** (a test for the A-2 log line SA called mandatory), and edge cases 4 and 5.

No High-severity bug is open. Re-run after QA-1: `npx jest lib/business-os/insight app/api/cron/insight-detect` plus `npm run typecheck:bos-llm`.

---

## 12. Commit Info

*(RM populates this section.)*

---

## 13. Implementation Notes (Dev)

Written after the code. Eight things were different in the tree from what the plan or the review assumed; the
first two are the ones SA should look at hardest, because both are cases where the type-level protection this
whole design rests on **did not** reach a caller.

### 13.1 The plan was wrong that `insight-detect` is the only caller

§3.2 said "the only production caller is `insight-detect`". `scripts/verify-insights.ts` also calls
`createBatch` (`:98`) and `saveCorrelationResults` (`:114`). It is a single-user CLI (`userId` from `argv`), so
it never had the cross-tenant bug — but it had to be updated to compile.

It now mints its group id **separately** from `runId` rather than reusing it, with a comment saying why: reusing
`runId` is harmless for one user, but it is the exact shape of F-13, and leaving that shape in a script is an
invitation to copy it into something that loops. It also keeps A-4's grep clean.

### 13.2 ⚠️ The most important finding: `as never as` casts defeat the signature change entirely

This is the same hazard as A-5, in a form neither the plan nor the review found, and it is worse because it is
**inside the compiler's own scope and still invisible to it**.

Four Business OS LLM test files reach the repository's private generators like this:

```typescript
new InsightRepository({} as unknown as SupabaseClient) as never as {
  generateLocalizedContent(d: unknown, u: string, c: unknown, r: string): Promise<Record<string, string>>;
}
```

The cast goes through `never` onto a **hand-written re-declaration** of the method signature. When
`r: string` became `r: InsightRunIds`, those declarations did not change and **every call site kept
compiling** — passing a string where an object was expected. `ids.groupId` then reads `undefined`, and
`buildBosCallContext` sets `sessionId: undefined`, so the ledger row records **no group at all**.

`npm run typecheck:bos-llm` did **not** catch it, even though all four files are in its `lib/business-os/llm/`
core scope, because there is no type error to catch — the cast asserts that the wrong signature is right.

What caught it: `modelSettings.wiring.nonchat.test.ts` happens to assert `session_id: R1` on the ledger row, so
it failed with `session_id: undefined`. Had that one assertion not existed, all four files would have gone
green while silently exercising the broken path.

**Fixed** by importing the real `InsightRunIds` into each hand-written signature, so the declaration is pinned
to the source of truth rather than re-typed. Three pinned snapshots in `callParams.boundary.step2.test.ts` had
recorded `sessionId: '<run>'` — i.e. **the snapshot was pinning the defect** — and now read
`'<insight-group>'`. The snapshot diff is exactly those 3 lines and nothing else.

> ### ⚠️ CORRECTION (fix pass, 2026-09-25) — this section claimed the fix was complete. It was not.
>
> **There were five instances, not four**, and SA (C-1) and QA (QA-1) found the fifth independently:
> `lib/business-os/insight/repository/__tests__/restateIfChanged.test.ts:69` and `:158` re-declared
> `restateIfChanged` — signature #2 of the nine — as `r: string` and passed the literal `'run-1'`.
>
> **Why it was missed is the lesson, and it is the same two-list failure this section is about:** the sweep keyed
> on the literal string **`as never as`**, and this file spells the identical defeat **`as unknown as`**. An
> enumeration of a pattern drifts from the pattern. The file is in `typecheck:bos-llm`'s scope (`--list`, reason
> `caller`) and the gate could not see it, exactly as described above, and its 9 tests passed because `repo()`
> replaces `generateLocalizedContent` with a `jest.fn()` — so the broken path was **exercised and masked**.
>
> Fixed in the fix pass, and re-swept **by method name instead of by cast spelling** — see §13.9 for the method,
> the result and what the gate now does with that file.

**Worth a general note for SA:** a parameter-type change to a repository is only as safe as the absence of
`as never as` re-declarations of its methods. There are more of these in the tree (the website, intake and
onboarding services, in the same two files). A guard that flags a hand-written signature for a method that
exists on the real class would be a genuine improvement — but it is a new pattern and out of scope here, so it
is recorded rather than built.

### 13.3 A-5's mechanism is right; its predicted symptom is not

A-5 says an un-updated mock makes "every audit entry write `callCount: 0` and zero cost". A `callCount: 0`
entry cannot be written: `emitAiAuditEntry` returns early on `calls.length === 0` (FR-7, "no LLM call, no
entry"). Verified under mutation (§13.5), the two real symptoms are:

1. an action **all** of whose calls are mismatched writes **no entry at all** — so the count of entries drops;
2. an action **some** of whose calls are mismatched writes an entry that **under-reports**: business A kept its
   `correlated_insight` call and lost its `insight_content` call, giving `callCount: 1` where the truth is 2.

(2) is the dangerous one, and it is the one a `callCount > 0` assertion alone would *not* catch — which is why
T2 also asserts A's exact `callCount` of 2 and both `callNames`. A-5's instruction was right for a reason
slightly different from the one given; the assertion it asked for is necessary but not sufficient on its own.

### 13.4 A-8's test half already exists

A-8 asked for "one test asserting `getChatUsage` passes `BOS_CHAT_FEATURE` on **both** branches". That test is
already in the tree: `lib/business-os/bizql/__tests__/usage-report.reads.test.ts`, *"reads one account through
the per-account method, everyone through the named all-accounts method"* — it asserts `BOS_CHAT_FEATURE` on
each branch **and** that the other branch was not called. So A-8 reduced to its comment half, which is done.
The comment names that test as the thing holding the precondition in place, so the link is discoverable from
the function.

### 13.5 Mutation verification — every new assertion was proved able to fail

A green test proves nothing until it has been seen to go red. Three mutations, each reverted afterwards:

| Mutation | Result |
|---|---|
| `const businessGroupId = runId` (reintroduce F-13 exactly) | **2 of 5 fail**: the F-13 distinctness test and T5. Verbatim: `expect(received).not.toBe(expected)` on `forA.entityId` and on `idsA.groupId` |
| Mock feeds `ids.runId` (a valid UUID, wrong group) to `buildBosCallContext` | **4 of 5 fail.** Entries drop from 2 to 1; A's entry shows `callCount: 1, callNames: ['correlated_insight']` — the §13.3 under-reporting symptom, observed directly |
| Mock feeds the whole `ids` object as `groupId` (A-5 literal) | **4 of 5 fail.** Entries drop to 1, then to 0 |

T5 survives mutations 2 and 3 by design: it inspects what the *route* passed, not what the mock did with it.

### 13.6 The one failing test is pre-existing on `main`

`lib/business-os/usage/__tests__/tokenUsageRepository.contract.test.ts` → *"pins every public method and its
arity; no account filter became optional"*. `TokenUsageRepository` gained
`summariseFeatureAllAccountsInWindow` and the test's `EXPECTED_ARITY` map was not updated:

```
- Expected  - 0
+ Received  + 1
+   "summariseFeatureAllAccountsInWindow",
```

Confirmed pre-existing by stashing this diff and re-running: it fails identically at `b613bb97`. **Not fixed
here** — different owner, and quietly repairing another team's contract pin inside this diff would hide a real
signal.

### 13.7 The cron fail-open is already fixed, so §10.5 is moot

SA's §10.5 ruled that a separate `fix/` cycle should cover the fail-open `verifyCronSecret` in
`insight-detect`, `insight-automations` and `insight-metrics`, that it be cut first, and that **TL must put the
dormancy trade-off to the user**. On the branch, `insight-detect`'s `verifyCronSecret` already fails closed with
a comment explaining why, and H4 in `BUSINESS_OS_INSIGHTS_MODULE.md` records all four insight crons as closed on
2026-09-23. Both the plan (investigated at `52b43e6a`) and the review read a stale tree. **No `fix/` cycle is
needed and there is no user conversation owed.**

### 13.8 An untracked document went missing during the session

`docs/requirements/ADMIN_MODULE_BOS_REORGANISATION_REQUIREMENT.md` was listed as untracked at the start of this
session and **is not on disk now**. It was never in any stash this work created — the two pathspec-limited
stashes contained only code files, verified with `git show --stat` — and nothing in this work deletes files.
Being untracked, git cannot recover it. **Flagged for the user**; it is not this branch's change and is not
being recreated here.

> ### ⚠️ Both SA and QA inferred this was resolved. It is not. (fix pass, 2026-09-25)
>
> A file of that name **is** on disk again (untracked, dated today), and both reviewers read that as a concurrent
> session having restored the original — SA struck the item, QA suggested closing it. **It is a BA rewrite
> authored today, not the original.** The original is still lost, and being untracked there is no git object to
> diff it against, which is why neither reviewer could tell.
>
> The durable lesson stands and is the only thing worth carrying forward: **an untracked doc has no recovery
> path**, so a long-lived requirement should be committed early rather than carried in a working tree. Nothing
> for this branch to do; the file remains untracked and out of §7.

### 13.9 The fix pass (C-1 to C-4 and QA-1 to QA-5)

**No production code changed in this pass.** One test-file type fix, one new test, one sharpened assertion, one
type annotation, two markdown table rows. SA's "one-pass confirmation, no second full review" therefore still
applies, and QA's concurrent run stands.

| Item | What changed |
|---|---|
| **C-1 / QA-1** (Medium, blocking) | `restateIfChanged.test.ts` now imports the real `InsightRunIds` and both declarations (`:87`, `:176`) take `r: InsightRunIds`. The literal `'run-1'` is replaced at both call sites by one `const RUN_IDS: InsightRunIds` whose `groupId` is deliberately **not** its `runId`, with a comment naming the two spellings so the next reader does not repeat the sweep's mistake. `'run-1'` no longer appears in the file |
| **C-2 / QA-2** (Medium) | The F-13 findings row is back to **three** cells with a closing pipe, and the X-2 note ("`a.user_id = g.user_id` is load-bearing — do not simplify it away") is folded into cell 2, where it renders. Verified structurally, not by eye: a parser over the whole document reports **no row without a leading/trailing pipe and no table with inconsistent column counts** |
| **C-3 / QA-2** (Low) | Same row: the superseded insights prose is now `~~struck~~` (the house convention — `BUSINESS_OS_INSIGHTS_MODULE.md` H1/H2/H8 and this diff's own H11) with a **Fixed for insights** sentence after it, and the briefing half kept live and present-tense because it is still open. Stale citations replaced with measured ones: `route.ts:343` (the mint, inside the loop at `:294`), `:372`, `:227`; `InsightRepository.ts:1008`, `:2344`, `:2974`. Line `:490` lost the duplicated present-tense tail it had grown |
| **QA-3** (Low) | New test **T8** for the A-2 log line (§5.1). It was the only load-bearing thing in the change that nothing asserted |
| **QA-4** (Low) | T5's `expect(body.data.runId).toBeDefined()` became `toBe(idsA.runId)` |
| **C-4 / QA-5** (Low) | `scripts/verify-insights.ts` — `const ids: InsightRunIds = { ... }`, with a type-only import (erased at compile time, so the file's dynamic `await import('../lib/...')` pattern is untouched). Relative path, matching this script's own convention for `lib/` |

**X-3 footprint is unchanged: the requirement doc is still exactly 2 changed lines** (`:73`, `:490`), so the
30-second RM conflict risk against B0's branch has not grown.

#### The re-sweep — what was searched, and why this pattern

The first sweep searched for a **string** (`as never as`) and so missed a synonym. This one searched for the
**thing at risk** instead, which cannot drift:

| # | Search | Result |
|---|---|---|
| 1 | **By method name — the authoritative one.** Every textual mention of all nine changed names (`restateIfChanged`, `generateLocalizedContent`, `generateCorrelatedContent`, `generateHealthNarrative`, `createBatch`, `createCorrelatedInsight`, `createOrUpdateHealthSummary`, `saveCorrelationResults`, `CreateInsightParams`) across `lib/ app/ components/ scripts/ types/ hooks/`, excluding `InsightRepository.ts` itself, then every hit read | **Zero remaining hand-written or bare-string sites.** Every insight caller either passes an `InsightRunIds`-typed value or reaches the method through `repo['method'](...)` element access. This search is independent of how a cast is spelled, which is the point |
| 2 | **By the wider cast shape**, not the literal string: a cast onto an **inline object type** (`as never as {`, `as unknown as {`, `as any as {`) over the same six roots | **90 sites.** Six touch `InsightRepository`: the four already fixed, `restateIfChanged.test.ts` (now fixed), and `runningAutomations.test.ts:52`, which re-declares `countOperationalAutomations` — **not** one of the nine and not touched by this diff. The remaining 84 are other classes (bizql plan steps, detectors, Stripe shapes, `globalThis`), unaffected |
| 3 | QA's independent result | Matches: the four `as never as` sites correctly fixed, the Website/Intake/Onboarding re-declarations **not drifted today** (arities and shapes re-checked against `WebsiteGenerationService.ts:590`, `IntakeGenerationService.ts:292`, `OnboardingConversationManager.ts:1062`/`:1116`), one miss — `restateIfChanged.test.ts`. **Confirmed independently, both directions** |

So the remaining hazard is unchanged in size and is **not** in this diff's blast radius: ~18 latent sites for
classes this change does not touch. SA's sequencing stands and is not pre-empted here — **step 1** migrate them
to `repo['method'](...)`, **step 2** *then* grep in `typecheck-bos-llm.ts` with an empty allow-list. That is also
why C-1 was fixed by importing the type rather than by converting this one file to element access: converting a
single file would take one site out of step 1's population and leave 17 behind, which is how a migration acquires
an exception list.

#### Mutations — all eight, re-measured

`route.ts`, `route.audit.test.ts` and `restateIfChanged.test.ts` were copied out first and `sha256sum -c`
returned `OK` for all three after every revert; `grep -rn "QA-MUTATION"` returns nothing.

| # | Mutation | Result |
|---|---|---|
| **M1** | `const businessGroupId = runId` — reintroduce F-13 exactly | **3 of 6 fail** (was 2 of 5). T8 catches it too, because a logged `businessGroupId` that equals `runId` is the defect on the record |
| **M2** | `createBatch` mock feeds `ids.runId` (valid UUID, wrong group) | **5 of 6 fail** (was 4 of 5). T8 also fails: the logged group is no longer the entry's `entity_id` |
| **M3** | `createBatch` mock feeds the whole `ids` object | **5 of 6 fail** (was 4 of 5) |
| **M4** | **QA's** — mismatch ONLY the second call, so the entry survives and merely under-counts | **1 of 6 fails**, exactly as QA measured. Still caught by `expect(forA[0].details.callCount).toBe(2)` **alone**; `callCount > 0` and `estimatedCostUsd > 0` both stay green, and T8 cannot help (the log line is upstream of the mock). **The margin is still one line — T2 is the assertion not to touch** |
| **M5** | **Delete the A-2 log line** | **1 of 6 fails.** Before T8 existed this was **0 of 5** — the measured proof of QA-3 |
| **M6** | The response body reports a fresh id instead of the run id | **1 of 6 fails** (T5). Under `toBeDefined()` this passed — the measured proof of QA-4 |
| **M7** | The log line drops `businessGroupId`, keeping two ids | **1 of 6 fails.** Two ids on a record cannot correlate a run to a group |
| **M8** | Put `'run-1'` back at `restateIfChanged.test.ts:88` — i.e. reintroduce C-1 | **`npm run typecheck:bos-llm` FAILS: 29 errors, 1 new** — `restateIfChanged.test.ts(88,50): error TS2345: Argument of type 'string' is not assignable to parameter of type 'InsightRunIds'`. **This is the important one:** before the fix that exact line compiled silently, so M8 measures that the project's strongest gate can now see a file it was blind to |

#### Disagreements and judgement calls in this pass

1. **The "165/166" figure is wrong, and §5.2 now says so and where it came from** — an unrecorded ad-hoc glob, not §5.2's command. QA is right that nothing in the document produces it. It should not have been reported.
2. **One SA suggestion deliberately not taken here:** C-1 offers element access as the better fix, and it is — but taking it in one file undercuts step 1 of SA's own sequencing (above). Flagged rather than silently chosen.
3. **QA's "close §13.8" and SA's "§13.8 is stale" are both wrong** — the reappeared document is a **BA rewrite authored today**, not the original, which is still lost. Recorded at §13.8 rather than accepted, because the inference was reasonable and the fact is checkable only from outside the tree.

---

## Change History

| Date | Change | Details |
|------|--------|---------|
| 2026-09-25 | **Fix pass — SA C-1 to C-4 and QA-1 to QA-5 all addressed; no production code changed** (§13.9) | **C-1 / QA-1 (the blocking item):** `restateIfChanged.test.ts:87` and `:176` now declare `r: InsightRunIds` from the real type and pass a typed `RUN_IDS` constant instead of the bare `'run-1'` — the **fifth** instance of §13.2's own finding, missed by the first sweep because it searched for the string `as never as` while this file spells it `as unknown as`. §13.2 is **corrected** rather than left claiming completeness. **Re-swept by method name instead of by cast spelling** — all nine changed names across `lib/ app/ components/ scripts/ types/ hooks/`: **zero remaining hand-written or bare-string sites**; a second sweep on the wider shape (a cast onto an inline object type) found 90 sites, of which the only `InsightRepository` one left is `runningAutomations.test.ts:52` re-declaring `countOperationalAutomations`, not one of the nine. QA's result matches in both directions. **Mutation M8 is the proof the hole is closed:** putting `'run-1'` back makes `typecheck:bos-llm` report **29 errors, 1 new — `TS2345 ... 'string' is not assignable to parameter of type 'InsightRunIds'`**, on a line that compiled silently before. **C-2 / QA-2:** the F-13 row is back to three cells with a closing pipe and the X-2 note folded into the rendering cell, verified by parsing every table in the document (no malformed row, no inconsistent column count); **C-3** struck the superseded present-tense prose and replaced the stale citations, keeping the still-open briefing half live; `:490` lost its duplicated tail; **the X-3 footprint is still exactly 2 lines.** **QA-3:** new test **T8** pins the A-2 log line — three lines (C included, the §10.9 trap), all three ids on one record, and the logged group id **is** that business's `entity_id`; mutation **M5** (delete the line) now fails 1 of 6 where it previously failed 0 of 5. **QA-4:** T5's response-body assertion is `toBe(idsA.runId)`, proved by **M6**. **C-4 / QA-5:** `verify-insights.ts` annotates `const ids: InsightRunIds` via a type-only import. Re-verified: **152/153 suites, 2,367/2,368 tests** (the extra test is T8; the one failure is the pre-existing `TokenUsageRepository` pin), `typecheck:bos-llm` 242 files / 28 errors / **0 new**, `check:bos-llm-literals` 0 violations, `schema:check` unchanged at 32/608, ESLint **0 errors / 5 warnings over 11 files, all pre-existing** (the fifth is `restateIfChanged.test.ts`'s own, verified at `HEAD` by stashing the file), and **eight** mutations all caught. QA's mutation 4 reproduced: the pure under-count is still caught by `callCount).toBe(2)` **alone** — margin unchanged at one line. **Two reviewer inferences corrected:** the reappeared `ADMIN_MODULE_BOS_REORGANISATION_REQUIREMENT.md` is a **BA rewrite authored today**, not the restored original (§13.8 amended, not struck); and the reported "165/166 suites / 2,892/2,893 tests" was **wrong** — an unrecorded ad-hoc glob — now corrected in §5.2 with the authoritative figures |
| 2026-09-25 | **SA code review — 🔄 Fix Required (two items), all production code approved** | Reviewed the working tree against `main` @ `b613bb97`; **SA changed no source file**. The fix is at the correct phase and complete: `businessGroupId` minted inside the loop, all three `buildBosCallContext` sites on `.groupId`, all five `detection_run_id` writes on `.runId`, nine signatures threaded, A-4's greps clean, and 10 suites / 238 tests / 19 snapshots re-run green. **Two fixes owed before RM: C-1** — a **fifth** `as`-cast re-declaration of the changed signature that §13.2's fix missed, `restateIfChanged.test.ts:69` and `:158`, still declaring `r: string` and passing `'run-1'`; it is inside `typecheck:bos-llm`'s scope (verified with `--list`) and invisible to it, and the miss is explained by the pattern having two spellings (`as never as` **and** `as unknown as`); **C-2** — the X-2 note was written as a **fourth cell of a three-column table** in the requirement, so GFM drops it silently and the note that exists to stop B0 simplifying `a.user_id = g.user_id` does not render. **All five of Dev's challenges to the Phase 1 review were checked and all five are upheld:** A-5's predicted `callCount: 0` symptom is unobservable (`aiActionAudit.ts:304` returns before writing) and Dev's under-counting symptom plus the exact-count assertion are the correct answer; **A-7 is withdrawn** — `audit_trail.hash` is never populated (`enableTamperDetection ?? false`, no setter in the tree), so declining to write it in as fact was right, and the dormant column is now its own TL→BA follow-up rather than an argument; §10.5 **is struck** — all four insight crons fail closed on the branch, so there is no `fix/` cycle and no user conversation owed; the `tsc` trap reproduced exactly (**exit 134, no output, `grep -c "error TS"` reads 0**) and measured further — with `--max-old-space-size=8192` it completes at **exit 2 with ~2,081 errors**, so the crashed run's apparent "zero" is wrong by ~2,081 and a naive project-wide gate is not adoptable; it needs recording in CLAUDE.md § Build gotchas + the test-strategy workplan. **Guard ruling on the `as`-cast pattern: justified but sequenced** — step 1 migrate the ~18 sites to `repo['method'](…)` element access (proven by a minimal `--strict` case to be compiler-checked where the cast is not, and already the idiom in `insight-llm-attribution.test.ts`), step 2 *then* a two-line grep in the existing `typecheck-bos-llm.ts` with an empty allow-list. Not in this diff, own `chore/` cycle. Judgement calls all upheld: the separate group in `verify-insights.ts`, its 43 `console.*` flagged-not-converted (`scripts/` is outside CLAUDE.md § Logging's scope — a user decision), the three-way split of the second green assertion of the bug, and leaving the pre-existing `TokenUsageRepository` pin red. X-3 is **narrowed, not resolved** — acceptable, no branch action. RM: `.claude/settings.local.json` and `.gitignore` are session ambience and must not be folded into this commit |
| 2026-09-25 | **QA pass — Issues found, one Medium blocking** (§11) | **The tenant-isolation property genuinely holds** and every number in §5.2 reproduces exactly: 152/153 suites and 2,366/2,367 tests, `typecheck:bos-llm` 242 files / 28 errors / 0 new, `check:bos-llm-literals` 0 violations, `schema:check` 32 of 608, ESLint 0 errors / 4 warnings, both A-4 greps clean. The one failing suite is **provably pre-existing**: its test and `TokenUsageRepository.ts` are byte-identical to `b613bb97` and the method its arity map omits is in the committed source there. A whole-suite run on **both** sides (branch vs. a detached worktree at `b613bb97`) produced an **identical 24-suite failing set**, so nothing else regressed. Dev’s three mutations were **re-run and all three reproduced exactly**, including the `callCount: 1, callNames: [correlated_insight]` under-count verbatim; QA added a fourth that mismatches only the second call and showed the pure under-count leaves **4 of 5 tests green** — caught by the single assertion `callCount).toBe(2)`, not by `> 0`. **The `as never as` sweep is incomplete (QA-1, Medium):** `restateIfChanged.test.ts:68, :157` still re-declares `restateIfChanged` — one of the nine changed signatures — as `r: string` and passes `run-1`, and is green only because it mocks the method that would read `groupId`. Dev’s sweep keyed on `as never as`; this file uses `as unknown as`. Three Low items: SA’s **X-2 note sits in a 4th cell of a 3-column table and will not render**; the **A-2 log line SA called mandatory has no test**; and T5’s response-body assertion is `toBeDefined()` rather than `toBe(runId)`. No source file was modified to make anything pass; the mutated files were restored and proved byte-identical by SHA-256 |
| 2026-09-25 | **Implemented on `fix/insight-run-group-id-per-business`** (cut from `main` @ `b613bb97`). Code complete; no commit made by Dev | A fresh `crypto.randomUUID()` per business, minted inside the loop and declared just outside the `try` so the catch can name it; `InsightRunIds { runId, groupId }` threaded through nine `InsightRepository` signatures, `.groupId` to all three `buildBosCallContext` sites and `.runId` to all five `detection_run_id` writes. **A-1 to A-6 applied and implemented; A-7 to A-10 addressed.** Two of SA's items needed correcting rather than applying: **A-7's** `audit_trail.hash` argument does not hold (the column is never populated — `enableTamperDetection` defaults to `false` and nothing sets it), so it was not written in as fact; **A-8's** test half already exists in `usage-report.reads.test.ts`, leaving only the comment. **A-5 was the most valuable item in the review and was right about the mechanism**, though the symptom is a missing or under-counting entry rather than `callCount: 0`, which cannot be written. Six things differed from the plan (§13): a second caller in `scripts/verify-insights.ts`; **four test files whose `as never as` casts re-declare the signature and so defeated the type change completely** (the single most important finding — `typecheck:bos-llm` could not see it, and one incidental `session_id` assertion is all that caught it); three snapshots that pinned `sessionId: '<run>'`, i.e. the defect; a second green assertion on the bug in `insight-llm-attribution.test.ts`; `InsightRepository.ts` having grown to 3,764 lines so every line number had drifted by hundreds; and the cron fail-open **already being fixed on `main`**, making SA's §10.5 ruling and its TL/user conversation moot. Verified: 152/153 suites and 2,366/2,367 tests pass (the one failure pre-existing on `main`), `typecheck:bos-llm` 0 new errors, `check:bos-llm-literals` 0 violations, `schema:check` unchanged at 32/608, ESLint identical at 0 errors / 4 warnings. Every new assertion was **mutation-verified** able to fail (§13.5). Docs: F-13 marked fixed in the requirement in exactly 2 lines, deliberately avoiding the lines B0 will edit (X-3); hazard **H11** + a cut-over note + a Change History entry added to `BUSINESS_OS_INSIGHTS_MODULE.md` |
| 2026-09-24 | SA review | **Approve with changes.** Q-1 ruled **Option A** (fresh UUID; the determinism is not load-bearing and the derivation it would enable is a content join we do not want) — Task 2 and T4 dropped. Q-2 ruled **G3** (G1 polices a class with zero remaining instances and sits on the write side of a read-side hazard) — Task 7 dropped; a narrow `usageReport.summarise` guard proposed instead (A-8). Q-3 **`InsightRunIds` approved**. Six required changes A-1 to A-6, the load-bearing one being A-5: the existing test mock feeds the third positional argument straight to `buildBosCallContext`, so leaving it unchanged manufactures the §3.3 `callCount: 0` failure. No-backfill confirmed permanent (strengthened by `audit_trail.hash`). Cron fail-open: separate `fix/` cycle covering **all three** fail-open routes (H4), cut first, not a blocker; TL owns the dormancy trade-off with the user |
| 2026-09-24 | Workplan created | Investigation of F-13 / SA-1 on `main` @ `52b43e6a`. Full consumer sweep (§2): `insight-detect` is the only offending path; no production consumer currently mis-attributes cost; `detection_run_id` is written by five sites and read by none; the existing `route.audit.test.ts` asserts the defect. Fix shape recommended (§3), historical-data position stated (§4), verification defined (§5), guard proposed for SA ruling (§6). No implementation code written |
