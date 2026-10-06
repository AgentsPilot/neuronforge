# Workplan: Business OS Purge — Slice 3 (Purge level, internal only)

> **Last Updated**: 2026-10-05

**Developer:** Dev
**Requirement:** [BUSINESS_OS_BUSINESS_DATA_PURGE_REQUIREMENT.md](/docs/requirements/BUSINESS_OS_BUSINESS_DATA_PURGE_REQUIREMENT.md) §0.4 Slice 3, §0.8, §0.10 (the 2026-10-04 splice; that copy currently lives on the unmerged admin-delete docs branch)
**Parent workplan:** [business-os-business-data-purge.md](/docs/workplans/business-os-business-data-purge.md) (T7, T27, T28, C-28, C-32)
**Branch:** `feature/purge-slice3-purge-level` (worktree `neuronforge-purge-s3`, from `origin/main` @ `adcd908d`)
**Date:** 2026-10-05
**Status:** 3a SA code review: APPROVED WITH CONDITIONS (F-1, F-2; 2026-10-05), uncommitted · 3b not started · 3c **DROPPED** (OQ-1 decided (c), 2026-10-05)

## Overview

Slice 3 adds the **Purge** level to the internal (`/test-business-os`, admin-gated) surface. Purge also removes the `K` tables, starves the crons (FR-14), releases the subdomain and `user_code` (FR-25, AC-42), and enables the three opt-in extras (FR-4), including B6/B7 ordering. It also has to carry the four §0.10 findings: `business_profiles` in its own final band, the FK-child invariant, retiring or deriving PR #45's registry, and retiring B4.

**Binding constraint (user decision 2026-10-05).** The `service_role` key is not rotated yet, so slice 3 ships **inactive**, the same way slice 2 did. Every database function change goes to `supabase/held/`, never to `supabase/migrations/`. Nothing destructive is applied or reachable on prod, and tests prove it (§6.3).

**Size and split.** The full slice is about 5.5 days, which is more than the ~4-day limit, so it is split into three slices. Each one ships on its own (§3). **3c is dropped:** the user decided OQ-1 on 2026-10-05 as option (c) — Purge never deletes agents, the "also delete my agents" extra is removed for good, and the refusal stays (§1.3 F-S3-1, §10 OQ-1). Slice 3 is therefore 3a + 3b.

---

## Table of Contents

1. [Analysis Summary](#1-analysis-summary)
2. [Implementation Approach](#2-implementation-approach)
3. [The split: 3a / 3b / 3c](#3-the-split-3a--3b--3c)
4. [Files to Create / Modify](#4-files-to-create--modify)
5. [Task List](#5-task-list)
6. [Test Plan](#6-test-plan)
7. [AC / FR → Task Traceability](#7-ac--fr--task-traceability)
8. [Cron Register (AC-25 input)](#8-cron-register-ac-25-input)
9. [Risks](#9-risks)
10. [Open Questions for SA](#10-open-questions-for-sa)
11. [SA Review Notes](#sa-review-notes)
12. [QA Testing Report](#qa-testing-report)
13. [Commit Info](#commit-info)
14. [Change History](#change-history)

---

## 1. Analysis Summary

### 1.1 What slice 3 touches

| Area | Today (slice 2 on `main`) | Slice 3 |
|---|---|---|
| `lib/business-os/purge/descriptors.ts` | `business_profiles` at `CONFIG` (700), which sorts before 7 CONFIG siblings and before `crm_activities` (`LAST`, 9000). `TRIGGER_ORDERING` encodes B4 | New final band for `business_profiles`. Cascade-accurate bands. B4 retired with a review note. Notes corrected |
| `ResetService.ts` (`runReset`) | Hard-codes level `reset` and all options `false` | Takes `level` + `options`. A delete-graph pre-check runs before the snapshot |
| `app/api/business-os/purge/commit/route.ts` | Zod `level: z.literal('reset')` | `level: enum(['reset','purge'])` plus a strict `options` object |
| `components/business-os/purge/PurgeDangerZone.tsx` | Preview supports Purge, but the commit is Reset-only | Purge commit plus the opt-in checkboxes; FR-24/FR-25 copy on the internal result |
| `supabase/held/20260916b_purge_business_data.sql` | Controls 1–4 and the xact lock; **never applied** | Extended **in place** with two generic, server-side graph controls (5, 6) |
| `SchemaReconciler.ts` / `BusinessPurgeRepository.ts` | Classification reconcile only (AD-1a). Triggers are not parsed | Parse `triggers`. New pure delete-graph check (T7's deferred FK half) |
| `lib/business-os/businessOwnedTables.ts` + `account/accountDeletionPolicy.ts` | A second registry, pinned to the ownership migration and **not** to the descriptors | Cross-registry invariant; policy file deprecated (OQ-3) |

### 1.2 Correction to the requirement's wording

§0.10 F-SA-3 calls `accountDeletionPolicy.ts` "PR #45's 55-table list". **The list itself is `BUSINESS_OWNED_TABLES` in `lib/business-os/businessOwnedTables.ts`** (58 names: 56 live plus `websites` and `insight_outcomes`, both measured absent). `accountDeletionPolicy.ts` consumes it through `USER_OWNED_TABLES`. Its only consumers are four scripts (`test-account-deletion.ts`, `business-fixture.ts`, `verify-deletion-policy-tables.ts`, `audit-deletion-coverage.ts`) and its own test. No route or service imports it. `businessOwnedTables.ts` is also cited by `SchedulingTimeOffRepository.ts` (comment only) and by the `20261005` entitlements migration (comment only).

### 1.3 Live measurement, 2026-10-05 (read-only)

This was a read-only call to `purge_schema_introspect()` against `jgccgkyhpwirgknnceoh.supabase.co` at `generated_at 2026-10-05T12:34:33Z`. It used no DML or DDL and read no row data. The run lists were computed with `descriptorsForRun` from this branch.

| # | Finding | Consequence |
|---|---|---|
| M-1 | **56 FKs reference `business_profiles`. All are `ON DELETE CASCADE`, and all 56 children are classified `reset`/`purge`.** F-SA-3's invariant holds today | The invariant needs a test so it **stays** true (T3a-3) |
| M-2 | **B4 is gone.** `crm_contacts` has no DELETE trigger. The only DELETE-capable triggers in `public` are `trg_mce_guard` (on `marketing_consent_events`, which is `never`; it permits the SET NULL the FK produces), `recompute_transaction_refund_state_trigger` (T2, still live) and the inert `storage_usage` pair | Retire `TRIGGER_ORDERING` (T3a-2). Replace it with a reviewed allow-list that **detects** new DELETE triggers rather than encoding old ones (T3a-4) |
| M-3 | Blocking edges with the parent in the run: B1, B2, B3 (reset/purge default) and B6, B7 (agents on). **All are ordered child-first today** | No ordering change is needed for correctness |
| M-4 | **The count-zero defect is wider than `business_profiles`.** CASCADE children ordered *after* their parent report 0 rows removed. **Purge:** `business_profiles` → 7 CONFIG tables + `crm_activities`. **Both levels:** `payment_plan_subscriptions` → `payment_plan_installments` → `payment_reminders`; `crm_contacts` → `proposals`, `crm_activities`. **Agents:** `agents` → `agent_executions` | Re-band for count accuracy (T3a-1). `crm_activities` keeps its T5 exemption (OQ-4) |
| **M-5 / F-S3-1** | 🔴 **"Also delete my agents" cascades into 16 `never` tables and 3 unclassified ones.** Deleting `agents` / `agent_executions` cascades into `agent_configurations`, `agent_stats`, `agent_intensity_metrics`, `agentkit_analytics`, `automation_slas`, `calibration_history`, `calibration_sessions`, `error_patterns`, `execution_anomalies` (×2 parents), `execution_baselines`, `execution_insight_runs`, `execution_insights`, `plugin_performance`, `shadow_failure_snapshots` and `shared_agents`, all `never`. It also cascades into **`agent_group_memberships`, `execution_metrics` and `execution_routing_decisions`**, which are unclassified. They have no `user_id`, so the reconciler's union predicate cannot see them, which is the same blind spot as B7 (§4) | A `never` row deleted by cascade breaks the claim that `never` makes. **The agents option must refuse until SA/BA rule** (OQ-1). ~~This becomes slice 3c~~ **OQ-1 decided (c) 2026-10-05: refused permanently, 3c dropped** |
| M-6 | Default Reset and default Purge: **zero** CASCADE children outside the run. SET NULL children that are `never` (`email_unsubscribes`, `marketing_consent_events`, `marketing_consent_state` ← `crm_contacts`; `shared_agent_imports` ← `agents`) are retained by design | Control 6 passes for both default runs |
| M-7 | Re-seed: `ensure_user_code_on_insert` (T6) is live. `business_os_plan_on_profile` fires AFTER INSERT on `business_profiles`, but its `ON CONFLICT … WHERE profile_created_at IS NULL` **does not restart the trial**, because the `business_os_account_plans` row is `never` and survives | AC-42 can be asserted without importing entitlements code |

### 1.4 T3a-0 gate results (SA C-3), 2026-10-05

Read-only. One call to `purge_schema_introspect()` per run, through `BusinessPurgeRepository.introspectSchema()` (the reconciler's path), against `jgccgkyhpwirgknnceoh.supabase.co`. No DML, no DDL, no row data. `checkDeleteGraph` was run over `descriptorsForRun(level, options)` for all 2 × 2³ = 16 combinations. The live payload had 323 FKs and 92 triggers both times.

| Run | `generated_at` | Descriptors | Default runs (8: agents off) | Agents-on runs (8) |
|---|---|---|---|---|
| Before re-band | `2026-10-05T12:47:32Z` | `origin/main` bands, empty reviewed-trigger list | **refused**: 0 blocking, 0 unlisted, 1 unreviewed trigger (`payment_refunds.recompute_transaction_refund_state_trigger`, T2). Cascade-after-parent: 4 (Reset) / 12 (Purge) | **refused**: as default, plus **19 unlisted cascade children** |
| **After re-band (T3a-1/2/4)** | `2026-10-05T12:49:47Z` | This branch, `REVIEWED_DELETE_TRIGGERS` = [T2] | **ok** in all 8: 0 blocking-order violations, 0 unlisted cascade children, 0 unreviewed DELETE triggers. Cascade-after-parent: 1 (`crm_contacts → crm_activities`, exempt) | **refused** in all 8: 0 blocking, 0 unreviewed triggers, **19 unlisted** (identical in every agents-on run), 1 exempt cascade-after-parent |

- **Before re-band, cascade-after-parent (Purge, all options):** `business_profiles` → `channel_connections`, `crm_activities`, `crm_pipeline_stages`, `marketing_consent_settings`, `payment_processors`, `stripe_connect_accounts`, `user_capabilities`, `user_intake_settings`; `payment_plan_subscriptions` → `payment_plan_installments` → `payment_reminders`; `crm_contacts` → `proposals`, `crm_activities`; `agents` → `agent_executions`. Exactly M-4.
- **The re-band met no edge outside `BLOCKING_EDGES`.** Moving installments, reminders, proposals and agent_executions earlier produced zero blocking-order violations (the risk SA C-3 named).
- **The 19 unlisted children with agents on** are M-5 exactly: 16 `never` (`agent_configurations`, `agent_intensity_metrics`, `agent_stats`, `agentkit_analytics`, `automation_slas`, `calibration_history`, `calibration_sessions`, `error_patterns`, `execution_anomalies` (from both `agents` and `agent_executions`), `execution_baselines`, `execution_insight_runs`, `execution_insights`, `plugin_performance`, `shadow_failure_snapshots`, `shared_agents`) and 3 unclassified (`agent_group_memberships`, `execution_metrics`, `execution_routing_decisions`). This is the refusal that keeps the agents option refused **permanently** (OQ-1 decided (c), 2026-10-05).
- **`REVIEWED_DELETE_TRIGGERS`:** T2 only. The four DELETE-capable triggers in `public` are T2, `trg_mce_guard` and the `storage_usage` pair. The last three are reached by no run: `marketing_consent_events` is a SET NULL child (not deleted), and `storage_usage` is not a CASCADE child of any run table. Each is named in the descriptor review note.

---

## 2. Implementation Approach

### 2.1 Phase named, and why (no V6 code is touched)

This is the purge engine, not the V6 pipeline. The root-cause rule still applies:

- **Ordering defects** are fixed in the **descriptor bands**, the single source of truth (§10.9).
- **Cascade safety** is enforced by a **generic graph check** over the live `pg_constraint` facts, in both TypeScript and SQL. It never names a table.

### 2.2 The delete-graph check (T7's deferred FK half, generalising F-SA-3)

This is a new pure function, `checkDeleteGraph(run, foreignKeys, triggers)`, in `lib/business-os/purge/deleteGraph.ts`. It takes a resolved run (ordered tables) and the introspected FKs and triggers, and returns:

| Verdict | Rule | Blocks? |
|---|---|---|
| `blockingOrderViolations` | A RESTRICT/NO ACTION edge with **both** ends in the run where the child is ordered after the parent | **Yes** |
| `unlistedCascadeChildren` | A CASCADE child of a run table that is **not in the run**. This is F-SA-3's invariant generalised to every parent, and it catches M-5 | **Yes** |
| `unreviewedDeleteTriggers` | A DELETE-capable trigger on a run table, or on a CASCADE child, that is not in `REVIEWED_DELETE_TRIGGERS` (descriptors.ts) | **Yes**. This is what replaces B4's hand-encoding |
| `cascadeAfterParent` | A CASCADE child ordered after its parent (it reports 0). Allowed only for the T5 exemption | No. Reported, and the invariant test pins it to the exemption list |

**Where it runs:**
1. In the orchestrator **before the snapshot**, fail-closed: an unreadable schema is a refusal (R-8 semantics).
2. In the preview, so the admin sees the refusal before typing a confirmation.
3. **Again, inside the RPC, in SQL (controls 5 and 6)**. A direct PostgREST call skips the TypeScript layer, which is the threat the held file exists for. The SQL controls use `pg_constraint.confdeltype`, so the same function serves every table set.

### 2.3 Held RPC: **extend `20260916b` in place**, not a second held file

| | Extend in place | Second held file (`…_v2.sql`) |
|---|---|---|
| Release steps | One file, one apply. The README checklist is unchanged apart from one added verification step | Two applies that must happen in order. Applying only the first ships a function **without** the slice-3 controls that looks complete |
| History | The file has **never been applied anywhere**, so there is no migration history to preserve | Preserves a history that does not exist |
| Diff review | One diff shows the old and new controls together | The reader has to merge two files mentally |

**Recommendation: extend in place** (OQ-2). Signature unchanged: `(uuid, text, jsonb, jsonb)`. The new controls run **before the advisory lock and before the first DELETE**, so the existence probe's two rejections (`p_user_id` null, `p_tables` empty) still fire first. The probe contract and its pinning test are unchanged.

- **Control 5 (blocking order).** For each pair `(i < j)` of listed tables, refuse when a `pg_constraint` FK with `confdeltype IN ('r','a')` has `conrelid = table_j` and `confrelid = table_i`, meaning the child would be deleted after its parent.
- **Control 6 (cascade closure).** For each listed table, refuse when a `confdeltype = 'c'` FK child (excluding self-references) is not in `p_tables`. **This is the server-side guarantee that no `never` row is lost by cascade.**
- **No table names in SQL.** This keeps the descriptor contract (§10.9): both controls are relation-agnostic.

### 2.4 Orchestrator shape (3b)

`runReset` is generalised to `runPurgeCommit({ userId, actorEmail, correlationId, level, options })`. A thin `runReset` wrapper is kept for one release so the single-orchestrator guard test does not churn (OQ-5). The order becomes:

`capability → RPC-existence probe → delete-graph check (new) → reset guard (controls 1+2; reads plugin_connections) → verified snapshot → RPC → storage → report → audit`

- The **probe still runs first**, so on prod (function absent) nothing else executes, including the new check. This is the inactive proof (§6.3).
- **AC-33's ordering half.** Control 1 (`resolveUserConnectAccounts`) reads `plugin_connections` in phase 1. The RPC deletes them in phase 2. The order test asserts the sequence with `integrations: true`.
- **Activity-history option.** The audit row of this purge is written after the commit, so it survives (§10.3).
- **Slice 2's refusal still applies to Purge.** Any Connect account means a refusal, so in slice 3 Purge only ever runs on a business with no Stripe. `stripe_connect_accounts` is therefore normally empty at delete time, which is correct under slice 2's skip-cleanly semantics.

### 2.5 Tenant isolation (`tenant-isolation-guard`)

- **The id is never caller-supplied** (FR-2 / AC-28). The commit route's Zod schema stays `.strict()`, and `userId` in the body is a 400.
- **Cascade scope.** The 56 `business_profiles` FKs are `(user_id) → business_profiles(user_id)` (migration `20260916_business_data_ownership.sql:183`). The cascade therefore stays inside the tenant by construction, and AC-24's sweep stays in T28.
- **Control 6** closes the remaining service-role vector: a delete that is correctly scoped but spills through a cascade into another classification.

---

## 3. The split: 3a / 3b / 3c

| Slice | Scope | Days | Ships alone? | Depends on |
|---|---|---|---|---|
| **3a — Delete-graph correctness** | Final band for `business_profiles`; cascade-accurate bands; B4 retired with a review note; descriptor notes fixed; F-SA-3 invariant; cross-registry invariant + `accountDeletionPolicy` deprecation; `deleteGraph.ts` + triggers parsing; preview shows graph verdicts. **No destructive capability change; no SQL change.** | ~2 | ✅ It improves Reset's counts today and clears AD-2's B-3 precondition | — |
| **3b — Purge level, inactive** | Orchestrator generalised; commit route accepts `purge` + integrations/activityHistory options; held RPC controls 5+6 (in place) + README; FR-24/FR-25 internal copy; cron register (AC-25 input); AC-27 route tests; inactive-proof tests. Agents option **refused permanently** by the delete-graph check (OQ-1 (c)); no agents checkbox | ~2.5 | ✅ Purge works end-to-end the moment the RPC is released, with integrations/activity opt-ins | 3a |
| ~~**3c — "Delete my agents" option**~~ **DROPPED 2026-10-05 (OQ-1 = (c))** | ~~Apply the OQ-1 ruling: `via` descriptors for `agent_group_memberships`, `execution_metrics`, `execution_routing_decisions`; reclassify (with FR-32 review notes) or drop the agent-platform cascade children; enable the checkbox; AC-34, B6/B7 runtime proof~~ | — | — | Not built |

---

## 4. Files to Create / Modify

### 4.1 Slice 3a

| File | Action | Reason |
|---|---|---|
| `lib/business-os/purge/descriptors.ts` | modify | `ORDER.TENANCY_ROOT` (> `LAST`) for `business_profiles` only. A `PRE_BLOCKING` band for `payment_reminders` < `payment_plan_installments` < `payment_plan_subscriptions`. `proposals` → `LEAF`. `agent_executions` → `ROOT - 1`. **Delete `TRIGGER_ORDERING`**, with a dated review-note comment citing `20260928_contact_delete_handled_in_app.sql` and M-2. Correct the notes on `crm_contacts`, `scheduling_bookings` and `payment_plan_subscriptions` (B2 stays; B4 gone). Add `REVIEWED_DELETE_TRIGGERS` (T2 only) and `CASCADE_COUNT_EXEMPT` (`crm_activities`, T5) |
| `lib/business-os/purge/deleteGraph.ts` | **create** | Pure `checkDeleteGraph` (§2.2) + `runDeleteGraphCheck({level, options, correlationId})`, which never throws and returns `unreadable` on failure |
| `lib/repositories/BusinessPurgeRepository.ts` | modify | `SchemaIntrospectionSchema` also parses `triggers: {table_name, trigger_name, definition}[]`. Additive and Zod-validated |
| `lib/business-os/purge/PreviewService.ts` | modify | Include the delete-graph verdict for the requested level/options (read-only) |
| `components/business-os/purge/PurgeDangerZone.tsx` | modify | Render the graph verdict (blocking lists, plain text) |
| `lib/business-os/account/accountDeletionPolicy.ts` | modify | Header corrected (the list is in `businessOwnedTables.ts`); `@deprecated` pointing at the descriptors and D14. **Deletion is decided by OQ-3** |
| `lib/business-os/businessOwnedTables.ts` | modify (comment) | State that its truth is checked against the descriptors |
| `lib/business-os/purge/__tests__/descriptors.invariant.test.ts` | modify | Replace the "crm_activities last" assertion with "crm_activities last except the TENANCY_ROOT band". Remove the `TRIGGER_ORDERING` cases; add a test that `TRIGGER_ORDERING` is no longer exported. Add: `business_profiles` alone in the final band; cascade-before-parent over the fixture except the exempt list |
| `lib/business-os/__tests__/businessOwnedTables.test.ts` | modify | **F-SA-3 invariant (static half):** every `BUSINESS_OWNED_TABLES` entry has a `reset`/`purge` descriptor, except an explicit `MEASURED_ABSENT` pair (`websites`, `insight_outcomes`, both §8.9). Reverse direction: every `reset`/`purge` descriptor is in `BUSINESS_OWNED_TABLES` or `USER_OWNED_TABLES` |
| `lib/business-os/purge/__tests__/deleteGraph.test.ts` | **create** | Pure unit tests (§6.1) |
| `lib/business-os/purge/__tests__/fixtures/delete-graph.fixture.json` | **create** | **Synthetic** graph (alpha/beta names, as the existing reconciler fixture): blocking pair, cascade child in and out of the run, a `never` cascade child, a DELETE trigger. No dump-derived constants (C-1) |
| `lib/business-os/purge/__tests__/SchemaReconciler.test.ts` | modify | Triggers parse; a payload without `triggers` still parses (back-compat) |

### 4.2 Slice 3b

| File | Action | Reason |
|---|---|---|
| `lib/business-os/purge/ResetService.ts` | modify | `runPurgeCommit({level, options})`; delete-graph pre-check after the probe; audit `details.level`/`options`; result carries `notes[]` (FR-24, FR-25) on the internal surface only |
| `app/api/business-os/purge/commit/route.ts` | modify | Zod `level: z.enum(['reset','purge'])`, `options: z.object({integrations, agents, activityHistory}: boolean().default(false)).strict().default({})`. `.strict()` kept. Header updated (AC-29 still carried to slice 5) |
| `app/api/business-os/purge/commit/__tests__/route.test.ts` | modify | Purge accepted; unknown option key → 400; `userId` in body → 400; non-admin → 403 for Purge |
| `components/business-os/purge/PurgeDangerZone.tsx` | modify | Purge commit button + two checkboxes (integrations, activity history; **no agents checkbox**: OQ-1 (c), the option is refused for good); AC-32 line "channel connections are always removed by Purge"; FR-25 / AC-42 result copy; FR-24 note |
| `supabase/held/20260916b_purge_business_data.sql` | modify (**held, not applied**) | Header "Slice 3 additions"; controls 5 and 6 before the lock; `COMMENT ON FUNCTION` updated |
| `supabase/held/README.md` | modify | The held row covers slice 3. Release step 10 adds: "run a **Purge** preview and confirm the delete-graph verdict is clean". Last Updated bumped |
| `supabase/held/__tests__/purgeBusinessData.held.test.ts` | **create** | Static SQL assertions (§6.3) |
| `lib/business-os/purge/__tests__/ResetService.order.test.ts` | modify | Purge, option and delete-graph cases (§6.2) |
| `app/api/website/analytics/track/__tests__/route.test.ts`, `app/go/[code]/__tests__/route.test.ts` | create (or extend if present) | AC-27 structural: page/link not found → no insert attributable to the user |
| `docs/workplans/business-os-business-data-purge-cron-register.md` | **create** | T27: the AC-25 input. Draft in §8 |

### 4.3 Slice 3c — DROPPED (OQ-1 = (c), 2026-10-05)

Not built. Kept for the record only; none of these changes will be made.

| File | Action | Reason |
|---|---|---|
| `lib/business-os/purge/descriptors.ts` | modify | Three `via` descriptors (`agent_group_memberships` via `agents.agent_id`, `execution_metrics` via `agents.agent_id`, `execution_routing_decisions` via `agent_executions.execution_id`) plus the OQ-1 reclassification |
| `lib/business-os/purge/__tests__/classification-baseline.json` | modify | Only with review notes, if OQ-1 moves any `never` → `optional:agents` (FR-32 / AC-37c) |
| `components/business-os/purge/PurgeDangerZone.tsx` | modify | Enable the agents checkbox |

### 4.4 Explicitly NOT touched

`supabase/migrations/**` (nothing new and nothing moved) · `lib/business-os/entitlements/**` (no import, so the entitlements skill does not apply) · customer surface / D9 flag (slice 5) · Stripe gate (slice 4) · AD-2's token · `/api/user/delete-account`.

---

## 5. Task List

### Slice 3a
- [x] ✅ **T3a-0** Re-run the read-only measurement (O-2) on the branch head. Recorded in §1.4 (`generated_at` 12:47:32Z before, 12:49:47Z after re-band). SA C-3 gate met
- [x] ✅ **T3a-1** Re-band the descriptors (§4.1) — `business_profiles` → `TENANCY_ROOT` (9900); `PRE_BLOCKING` (50: `payment_reminders` 50 < `payment_plan_installments` 51); `proposals` → LEAF, `agent_executions` → ROOT − 1. No `level` changes; baseline untouched (asserted)
- [x] ✅ **T3a-2** Retire `TRIGGER_ORDERING`/B4 with the dated review note; notes corrected on `crm_contacts`, `scheduling_bookings`, `payment_plan_subscriptions` (plus notes on the four moved tables)
- [x] ✅ **T3a-3** F-SA-3 invariant (static half) in `businessOwnedTables.test.ts`; cross-registry both directions. Exceptions are named and self-checking: `MEASURED_ABSENT` (`websites`, `insight_outcomes`) and `NOT_IN_OWNERSHIP_REGISTRY` (`onboarding_prompt_ideas`, see Dev notes); `via` children are checked through their parent
- [x] ✅ **T3a-4** `deleteGraph.ts` + `REVIEWED_DELETE_TRIGGERS` + `CASCADE_COUNT_EXEMPT`; triggers parsing in the repository (optional key; absent → `unreadable` in the check)
- [x] ✅ **T3a-5** Graph verdict in the preview (read-only, `deleteGraph` field + a limitation line when not `ok`) and a Danger Zone panel. C-5 preview half: `unreadable` renders "NOT VERIFIED (treated as refused)", and a missing field defaults to `unreadable`
- [x] ✅ **T3a-6** `accountDeletionPolicy.ts` header fix + `@deprecated` (OQ-3: deletion in AD-3); one-line deprecation header on the four consuming scripts
- [x] ✅ **T3a-7** Tests §6.1; scoped `tsc` on touched files (exit 0); purge + repository + businessOwnedTables + account suites green
- [ ] **T3a-8** Splice slice-3a status into requirement §0.4 / §0.10. **Deferred per R-7:** §0.10 is not on this branch (it lives on the unmerged admin-delete docs branch). Splice once that PR merges

**Dev notes (3a):**
- **Inactive proofs.** I-1 … I-4 live in `supabase/held/__tests__/purgeBusinessData.held.test.ts`, a 3b file (§4.2), so none is assigned to 3a. C-1 (I-1 must match a `CREATE [OR REPLACE] FUNCTION … purge_business_data(` or `GRANT … purge_business_data` and not the bare string in `20260916a`'s comment) is carried into T3b-3. 3a adds nothing to `supabase/migrations/` or `supabase/held/` (I-8 holds) and no SQL.
- **C-5 split.** Preview half done here (test in `PreviewService.deleteGraph.test.ts`). The commit-refusal half needs the orchestrator change, so it lands with T3b-1.
- **Finding: `onboarding_prompt_ideas`** is a `reset` descriptor in neither ownership registry. It has no CREATE TABLE in `supabase/migrations/` and its live FK is to `auth.users`, not `business_profiles`. It is a reasoned test exception rather than a registry edit, because adding it to `USER_OWNED_TABLES` would change what the deprecated account-deletion scripts and `reset-onboarding.ts` do. SA to confirm.
- **Trigger parsing** is a test in the repository's introspect suite (where the Zod schema lives), not in `SchemaReconciler.test.ts` as §4.1 listed: the reconciler does not read triggers.
- **Plan delta (C-3 wording):** `TENANCY_ROOT` = 9900 and `PRE_BLOCKING` = 50 are the concrete values.

### Slice 3b
- [ ] **T3b-1** `runPurgeCommit` generalisation + delete-graph pre-check (after the probe, before the guard)
- [ ] **T3b-2** Commit route Zod + tests
- [ ] **T3b-3** Held RPC controls 5 + 6 in place; README; static held test
- [ ] **T3b-4** Danger Zone Purge commit + options + FR-24/FR-25/AC-32 copy
- [ ] **T3b-5** Cron register doc (§8 verified line by line against the code)
- [ ] **T3b-6** AC-27 route tests
- [ ] **T3b-7** Inactive-proof tests (§6.3); order tests (§6.2)
- [ ] **T3b-8** Read-only live check: the Danger Zone banner still reads "not applied" and a Purge preview shows a clean graph verdict for a default run and **refuses** with agents on (M-5)
- [ ] **T3b-9** Splice status into the requirement

### Slice 3c — DROPPED (OQ-1 = (c), 2026-10-05; no tasks will be done)
- ~~**T3c-1** Apply the ruling; add three `via` descriptors; baseline review notes if levels move~~
- ~~**T3c-2** Enable the agents checkbox; AC-34 tests (B6/B7 order in the agents run; graph check clean)~~
- ~~**T3c-3** Splice status into the requirement~~

### Post-rotation (not in any slice 3 PR; owned by parent T28)
- [ ] Live sweep per C-28 (twice: opt-ins off, agents on): AC-2, AC-22–25, AC-27 (+ `agent_memories`, C-32), AC-31–34, AC-42 on a **throwaway** account

---

## 6. Test Plan

All tests are pure Jest unit tests in the existing shards. They need **no DB, no network and no new CI job** (rule: no added CI time). The added runtime is milliseconds.

### 6.1 Ordering and graph without a live DB (3a)

| Test | Proves |
|---|---|
| `deleteGraph.test.ts` on the synthetic fixture | Each verdict fires on its planted case and is silent on the clean case. **Mutation checks:** swapping a blocking pair → violation; removing a cascade child from the run → `unlistedCascadeChildren`; a `never` cascade child → refusal; adding an unreviewed DELETE trigger → refusal; empty FK list with non-empty tables → `unreadable`, never `ok` |
| Invariant: `business_profiles` is the only `TENANCY_ROOT` descriptor and sorts last in every `descriptorsForRun('purge', *)` combination | F-SA-3 band |
| Invariant: every `BLOCKING_EDGES` pair holds in every run that contains both (existing; B4 rows removed) | B1–B3, B6, B7 |
| Invariant: `cascadeAfterParent` over a fixture that mirrors `BLOCKING_EDGES` + known cascade pairs ⊆ `CASCADE_COUNT_EXEMPT` | Count accuracy (M-4) |
| `businessOwnedTables.test.ts` cross-registry | Every FK child of `business_profiles` (per the migration-pinned registry) is `reset`/`purge` |
| Baseline unchanged | No FR-32 drift in 3a/3b |

### 6.2 Orchestrator order (3b), mocked repository

- Purge with probe `false` → `rpc_not_applied`; **no** graph check, guard, snapshot, commit or storage call.
- Graph check refuses (e.g. agents on) → refusal **before** the guard and snapshot (`snapshotWritten: false`).
- `integrations: true` → `evaluateResetGuard` (which reads `plugin_connections`) is called before `executePurge` (AC-33 ordering half).
- `executePurge` receives exactly `descriptorsForRun(level, options)` mapped. `business_profiles` is last for Purge and absent for Reset.
- `activityHistory: true` → audit `log()` is called after `executePurge`.
- Audit details carry `level` and `options` (FR-20).

### 6.3 Inactive proof — nothing destructive applied or runnable on prod

| # | Assertion | Where |
|---|---|---|
| I-1 | **No file under `supabase/migrations/` contains `purge_business_data`** (case-insensitive) | `purgeBusinessData.held.test.ts` |
| I-2 | The held file exists in `supabase/held/` and `README.md` lists it in "Currently held" | same |
| I-3 | Held SQL: `SECURITY DEFINER`, `SET search_path`, REVOKE from `PUBLIC`/`anon`/`authenticated`, GRANT **only** to `service_role`; `pg_try_advisory_xact_lock` (never `pg_try_advisory_lock`); controls 5 and 6 (`confdeltype`) appear **before** the lock; every parameter is `p_`-prefixed | same |
| I-4 | Held SQL body contains **no descriptor table name** (iterates `PURGE_DESCRIPTORS`) | same — extends B-2 to SQL |
| I-5 | The existence-probe defensive arguments are unchanged | existing test |
| I-6 | Single-orchestrator pins (`executePurge`, `removeStorageUnderUser`, `writeVerifiedSnapshot`) still name only the orchestrator file | existing test, updated if OQ-5 renames |
| I-7 | Read-only live: the banner reads "function not applied" | T3b-8 (manual, QA) |
| I-8 | `git diff origin/main --stat -- supabase/migrations` is empty for every slice-3 PR | QA / RM check |

### 6.4 What cannot be proven before rotation

These go to the parent T28's live sweep: real execution of controls 5/6 in Postgres, AC-2/22/23/24/25/27/42 live, and B6/B7 under real FKs. No in-process Postgres (pg-mem/pglite) is installed, and adding one is a new pattern (OQ-6).

---

## 7. AC / FR → Task Traceability

| Item | Slice-3 task(s) | Proof before rotation | Live proof |
|---|---|---|---|
| **FR-3** (Purge half) | T3b-1, T3b-2 | Order test: Purge run = reset ∪ purge descriptors | T28 |
| **FR-4** | T3b-2, T3b-4 (agents: refused, OQ-1 (c)) | Zod defaults false; order tests per option | T28 (C-28 ×2) |
| **FR-14** | T3b-5 | Cron register, each predicate mapped to a `purge`/`reset` descriptor | T28 |
| **FR-15** (B6, B7) | T3a-1, T3a-4, T3b-3 (B6/B7 runtime proof dropped with 3c) | Invariant + graph tests; held control 5 | T28 agents run |
| **FR-24** | T3b-4 | Internal result note rendered (component test or source guard) | — |
| **FR-25** | T3b-4 | Result copy: subdomain claimable, `/c/{userCode}` links stop resolving | T28 |
| **AC-2** | T3a-1, T3b-1 | Purge run covers every non-`never` descriptor, minus unticked options; K* absent from the run | T28 |
| **AC-25** | T3b-5 | Register names every scheduled cron's predicate (§8) | T28 |
| **AC-27** | T3b-6 | Route tests: no page / link → no insert | T28 (+ `agent_memories`, C-32) |
| **AC-31** | T3b-1 | Options off → `plugin_connections`, the agents set and `audit_trail`/`archived_records` are not in the run; `profiles`/`auth.users` never | T28 |
| **AC-32** | T3b-1, T3b-4 | `channel_connections` in every Purge run regardless of `integrations` | T28 |
| **AC-33** (ordering half) | T3b-1 | Guard-before-commit order test with `integrations: true` | T28 |
| **AC-34** | ~~T3c-1, T3c-2~~ **Superseded by OQ-1 (c)** | Replaced by the C-4 test: `agents: true` is refused before guard and snapshot. Requirement AC-34/FR-4 need the matching amendment (BA) | T28 sweep runs opt-ins off only; the agents-on run is a refusal check |
| **AC-42** | T3b-4 | `business_profiles` in the Purge run (so re-seed inserts and T6 fires); copy states the new `user_code`; M-7 no-fresh-trial note | T28 |
| §0.10 F-SA-3 (final band) | T3a-1 | §6.1 band test | — |
| §0.10 F-SA-3 (FK-child invariant) | T3a-3, T3a-4, T3b-3 | Static cross-registry + runtime `unlistedCascadeChildren` + held control 6 | T28 |
| §0.10 F-SA-3 (retire/derive registry) | T3a-3, T3a-6 | Cross-registry test | — |
| §0.10 F-SA-4 (retire B4) | T3a-2, T3a-4 | `TRIGGER_ORDERING` gone; reviewed-trigger detection test | — |
| AC-37c (drift) | all | Baseline unchanged in 3a/3b (3c dropped) | — |
| AC-48 (slice subset) | T3a-7, T3b-7 | B6, B7 unit tests; B4 replaced by trigger detection | — |
| AC-49 | all | No `console.*` in touched files (all four engine files are Pino already) | — |

---

## 8. Cron Register (AC-25 input)

> ⚠️ **The requirement's "six crons" is stale.** `vercel.json` schedules **13**. This is a first draft from a code read on 2026-10-05; T3b-5 verifies each line. **This is input to AC-25, not evidence for it** (SA §12.5).

| Cron | Enumerates tenants / work from | Level that starves it |
|---|---|---|
| `calendar-sync` | `business_profiles` (BusinessProfileRepository) | **Purge** only |
| `channel-metrics-sync` | `channel_connections` (ChannelMetricsSyncService) | **Purge** only |
| `insight-detect` | `payment_invoices`, `scheduling_bookings`, `crm_contacts`, `business_events` | Both |
| `insight-metrics` | `business_events` | Both |
| `insight-automations` | `insight_automations` (AutomationManager) | Both |
| `insight-actions` | `insight_actions` queue (`claimDue`) | Both |
| `payment-reminders` | `payment_invoices` / `payment_reminders` | Both |
| `payment-retry` | `payment_plan_installments`, `payment_invoices`; `payment_automation_executions` (`claimDue`) | Both |
| `intake-reminders` | `scheduling_bookings` | Both |
| `daily-briefing` | `business_profiles WHERE daily_briefing_email_enabled` + `daily_briefing_sends` queue | **Purge** only. ⚠️ After a **Reset** the briefing keeps sending, which is a FR-26 copy gap for slice 2 (raise to BA) |
| `lead-response` | `lead_responses` queue; enqueues from `business_profiles` / `scheduling_bookings` | Purge fully; Reset empties the queue but the enqueue source survives |
| `abandoned-proposal-invoices` | `proposals`, `payment_invoices` | Both |
| `credit-leak-check` | `business_os_credit_charges` (`never`) | Neither. A platform billing check that writes no business data; correct to survive |

Public INSERT paths (AC-27): `POST /api/website/analytics/track` resolves the owner through `website_pages` by subdomain (Reset-deleted). `GET /go/[code]` resolves through `smart_links` (Reset-deleted). After Purge both 404 before any insert.

---

## 9. Risks

| # | Risk | Mitigation |
|---|---|---|
| R-1 | 🔴 **The agents option silently deletes `never` rows by cascade** (M-5) | The graph check refuses it in TypeScript, and control 6 refuses it in SQL. OQ-1 decided (c): the refusal is permanent, 3c is dropped, and 3b renders no agents checkbox |
| R-2 | The held file is applied before rotation, now with Purge reach | The hold is operational, not a control (SA §12E). README updated. I-1/I-2 make a move into `migrations/` fail CI |
| R-3 | Controls 5/6 are SQL that cannot be executed before rotation | Static I-3 assertions + a TS mirror with full unit coverage; first live execution is the README's throwaway-account step; the transaction rolls back on any RAISE |
| R-4 | Control 6 is over-strict for a future legitimate cascade, which would block Reset | It fails closed with a message naming the child, and the fix is a classification decision (as intended). Today default Reset/Purge pass (M-6) |
| R-5 | Re-banding changes counts that slice 1/2 users have seen | This is intended; counts become accurate. Noted in the PR |
| R-6 | `crm_activities` (T5 exemption) still under-reports contact-cascaded rows | Snapshot counts are the truth (OQ-4) |
| R-7 | The requirement copy with §0.10 is on an unmerged docs branch | T3a-8/T3b-9 splice only after that PR merges; otherwise rebase |
| R-8 | `business_profiles` after `crm_activities`: could its cascade re-fire T5? | No. Every trigger source (`payment_refunds`) is already deleted at that point, and `crm_activities` is itself a cascade child, so the cascade clears any residue |

---

## 10. Open Questions for SA

| # | Question | Dev's recommendation |
|---|---|---|
| **OQ-1** 🔴 | **M-5:** deleting `agents`/`agent_executions` cascades into 16 `never` tables + 3 unclassified ones. FR-15 forbids altering an FK. Options: **(a)** reclassify the 16 to `optional:agents` with FR-32 review notes (the schema says they cannot outlive the agent, so `never` is false under this option); **(b)** remove `agents`/`agent_executions` from the option, keeping only memories/threads/logs; **(c)** keep `never` and refuse the agents option permanently. **A business decision (what "delete my agents" means), so BA must word it** | (a). It is the honest reading of the schema. Route it through BA → SA. **DECIDED by the user 2026-10-05: (c).** Purge never deletes agents; the "also delete my agents" extra is removed for good; slice 3c is dropped; the refusal stays |
| **OQ-2** | Extend `20260916b` in place vs a second held file | In place (§2.3) |
| **OQ-3** | `accountDeletionPolicy.ts`: delete it (with its 3 policy scripts) now, or deprecate it and leave deletion to AD-3, whose D14 closure supersedes its hard-delete design? | Deprecate in 3a; delete in AD-3 |
| **OQ-4** | Count accuracy: report RPC statement counts (miss cascaded rows) or snapshot counts as "rows removed"? | Show snapshot counts as the truth, RPC counts as diagnostics |
| **OQ-5** | Rename `ResetService.ts` → `PurgeCommitService.ts` (single-orchestrator pin churn) or keep the name with a `runReset` wrapper | Keep the name in slice 3; rename when slice 5 lands |
| **OQ-6** | Is a captured (hand-checked) FK fixture acceptable for the cascade-order invariant, or synthetic only (C-1)? Is an in-process Postgres for executing the held SQL acceptable (new pattern)? | Synthetic only; no in-process Postgres |
| **OQ-7** | Should control 6 also run for **Reset**? | Yes, same function. It protects Reset from the same class |
| **OQ-8** | `daily-briefing` keeps sending after a Reset (§8). Is that a slice-2 FR-26 copy fix, or out of scope? | Route to BA as an FR-26 amendment; not slice 3 |

---

## SA Review Notes

**Reviewed by SA — 2026-10-05 (workplan review, no code)**
**Status:** APPROVED WITH CONDITIONS (C-1 … C-5 below; 3c stays blocked on OQ-1)

Spot-verified on the branch: `vercel.json` schedules 13 crons; `TRIGGER_ORDERING` / B4 and the bands are as §1.1 says; `payment_plan_installments` / `payment_reminders` sit at `LEAF` after `payment_plan_subscriptions` (`BLOCKING_CHILD`), so M-4 is real; `proposals` and `agent_executions` sit at/after their cascade parents; `insight_actions` (reset) and `auth_handoff_codes` (never) are classified, so F-SA-2 is closed by AD-1; no touched engine file uses `console.*` (the one hit in `PurgeDangerZone.tsx` is a comment).

### Rulings

| Item | Ruling |
|---|---|
| Split 3a / 3b / 3c (~2 / 2.5 / 1 d) | **Approved.** Each is under the 4-day limit and ships alone. 3a carries no destructive change and no SQL. 3b grows to ~3 d with C-2 — still within the limit |
| OQ-2 extend `20260916b` in place | **Approved.** Never applied anywhere, so there is no history to preserve; two ordered applies is the worse failure mode. Controls 5/6 relation-agnostic (`pg_constraint.confdeltype`, no table names) keeps §10.9 |
| Inactive proofs I-1…I-8 | **Approved with C-1.** Probe-first (`rpc_not_applied` before graph check, guard, snapshot) is the right shape |
| M-4 wider count-zero finding | **Accepted**; re-band in 3a. Bands remain unverified against the live graph until C-3 runs |
| §1.2 correction (list = `BUSINESS_OWNED_TABLES`) | **Accepted.** F-SA-3's "retire or derive" is met by deprecate + the both-direction cross-registry test in 3a (mandatory, not optional). The reverse direction reads `USER_OWNED_TABLES` from the deprecated file — acceptable until AD-3 deletes it |
| OQ-3 | Deprecate in 3a, delete in AD-3. Add a one-line deprecation header to the four consuming scripts too |
| OQ-4 | Snapshot counts are the reported truth; RPC statement counts are diagnostics. Log a `warn` (Pino) on any mismatch outside `CASCADE_COUNT_EXEMPT` |
| OQ-5 | Keep `ResetService.ts` + `runReset` wrapper; rename in slice 5 |
| OQ-6 | Synthetic fixture only (C-1 of the parent plan); **no** in-process Postgres (new pattern + CI time) |
| OQ-7 | Yes — control 6 applies to Reset; M-6 shows default Reset passes |
| OQ-8 / cron register | Register of 13 accepted as AC-25 *input*. Daily-briefing-after-Reset is a BA FR-26 copy question, not slice 3. Splice the "six crons" correction into the requirement at T3b-9 |
| OQ-1 | **Not ruled by SA** — business meaning; technical options stated for the user below. Keeping the option refused until ruled is **safe**: refused in three independent layers (disabled checkbox; TS graph check before snapshot; SQL control 6), the RPC is not applied on prod, and default Reset/Purge are unaffected (M-6) |
| Tenant isolation / repos / Pino / CI | Id never caller-supplied (`.strict()`, body `userId` → 400) — good. All reads via `BusinessPurgeRepository`. `deleteGraph.ts` pure, logging only in `runDeleteGraphCheck`. Tests are ms-scale Jest in existing shards — no added CI time. **But see C-2** |

### Conditions

1. **C-1 (I-1 as written fails today).** `supabase/migrations/20260916a_purge_snapshots_bucket.sql:13` already *mentions* `purge_business_data` in a comment. I-1 must assert no migration **defines or grants** it (regex on `CREATE [OR REPLACE] FUNCTION … purge_business_data(` and `GRANT … purge_business_data`), not "contains the string".
2. **C-2 (tenant isolation — §2.5 overclaims).** "Cascade stays inside the tenant by construction" is true only for the 56 composite `(user_id) → business_profiles(user_id)` FKs. The id-keyed CASCADE edges inside the run (`crm_contacts → proposals/crm_activities`, `payment_plan_subscriptions → installments → reminders`, `agents → agent_executions`, every `via` edge) are not tenant-constrained by the schema: once children are deleted child-first by `user_id`, the parent's cascade can only remove rows owned by **someone else** (or `user_id IS NULL`). Control 6 does not see this — the child table *is* listed. Add a **control 7** to the held RPC in 3b, relation-agnostic like 5/6: for each in-run CASCADE edge whose child has a `user_id` column, refuse if any child row referencing a tenant-owned parent row has `user_id IS DISTINCT FROM p_user_id`. Static I-3 pins it before the lock; unit-test a TS mirror on the synthetic fixture. Correct §2.5's wording.
3. **C-3 (T3a-0 is a gate, not a note).** Run `checkDeleteGraph` against the live introspection payload for every level × option combination (2 × 2³), read-only, and record the verdicts here before the 3a PR: expect zero `blockingOrderViolations` after re-banding (moving installments/reminders/proposals/agent_executions earlier may meet an edge not in `BLOCKING_EDGES`), zero `unlistedCascadeChildren` except agents-on, and zero `unreviewedDeleteTriggers` for default runs. Populate `REVIEWED_DELETE_TRIGGERS` from that run, each entry with a review note (incl. the `storage_usage` pair if it sits on a run table or cascade child).
4. **C-4 (agents refusal is deterministic).** The 3b order test must prove `agents: true` refuses **before** guard and snapshot using a mocked introspection mirroring M-5 — not only the live check in T3b-8. The client-facing refusal carries a code and plain message; child-table names only under the `NODE_ENV === 'development'` details guard.
5. **C-5 (F-SA-1 fail-closed).** An unreadable or empty graph (`unreadable`) is a refusal at commit and a visible blocking state in the preview, with a test for each. The preview must never render "clean" on a failed read.

### Approval
[x] Workplan approved — proceed to 3a now; 3b with C-1, C-2, C-4 folded in; 3c only after the OQ-1 ruling (BA → SA → user).

> **Superseded 2026-10-05:** the user decided OQ-1 = (c). 3c is dropped; the agents refusal is permanent. C-4 still applies to 3b.

---

**Code Review by SA — 2026-10-05 (slice 3a, uncommitted, worktree `neuronforge-purge-s3` @ `adcd908d`)**
**Status:** APPROVED WITH CONDITIONS — fix F-1 before the 3a PR; F-2 is carried to the slice that first exposes the preview to a non-admin

Verified independently: diff = 13 modified + 5 untracked files, nothing under `supabase/`. Purge, ownership and introspect suites re-run here: 11 suites / 210 tests green. No `console.*` in any touched file (the `PurgeDangerZone.tsx` hit is a comment). All DB reads go through `BusinessPurgeRepository.introspectSchema()` (rule 1); Pino with a `correlationId` child in `runDeleteGraphCheck`; strict TS, no `any`.

**Descriptor re-band, checked mechanically against `origin/main`:** same 83 descriptors, same table set, every `level` identical; exactly five `order` values changed, all intended — `business_profiles` CONFIG → TENANCY_ROOT (9900), `payment_reminders` LEAF → PRE_BLOCKING (50), `payment_plan_installments` LEAF → PRE_BLOCKING + 1, `proposals` ROOT → LEAF, `agent_executions` ROOT + 1 → ROOT − 1 (still after `agent_scheduler_state` at 101, so B7 holds). `STORAGE_DESCRIPTORS` and `BLOCKING_EDGES` untouched. The rest of the descriptor diff is notes only. The T3a-0 live run (§1.4) shows the moves met no blocking edge.

**TRIGGER_ORDERING removal:** no remaining importer anywhere in the repo; the test asserting it is gone is the right pin. Replacing a hand-encoded trigger assertion with detection (`unreviewedDeleteTriggers`, fail-closed parse in `isDeleteCapableTrigger`) is the correct generalisation, and `REVIEWED_DELETE_TRIGGERS` = [T2] matches the live run.

**Fail-closed (C-5, preview half):** satisfied. `runDeleteGraphCheck` never throws; missing FKs, a missing `triggers` key, or an empty FK list on a non-empty run → `unreadable`; the preview adds a limitation line; the panel defaults an absent field to `unreadable` and labels it "NOT VERIFIED (treated as refused)", in red. The optional `triggers` key in the Zod schema is acceptable *because* the check, not the parser, refuses its absence (tested on both sides).

### Rulings on Dev's deviations

| Deviation | Ruling |
|---|---|
| I-1 … I-4 and the C-1 regex moved to 3b (held test file) | **Accepted.** 3a adds no SQL and no held file; the proofs belong with the file they pin. C-1 remains binding on T3b-3 |
| C-5 commit-refusal half → T3b-1 | **Accepted.** The commit orchestrator changes in 3b and the RPC is unapplied, so nothing can commit past a refused graph meanwhile. T3b-1 must carry the test |
| T3a-8 requirement splice deferred (§0.10 lives in docs PR #225) | **Accepted**, and the OQ-1 (c) decision joins that splice: requirement FR-4 / AC-34 must say the agents extra is refused for good (BA wording) |
| Trigger parsing tested in the repository introspect suite, not `SchemaReconciler.test.ts` | **Accepted.** The Zod schema lives in the repository; the reconciler does not read triggers |
| `onboarding_prompt_ideas` as a reasoned exception (`NOT_IN_OWNERSHIP_REGISTRY`) instead of joining `USER_OWNED_TABLES` | **Accepted.** `USER_OWNED_TABLES` feeds the deprecated account-deletion scripts, so adding it would change their behaviour for no purge benefit; the exception self-checks (fails if the table stops being deletable or gets registered). Follow-up outside 3a: the table has no creating migration (dashboard-only schema), so add it to the core-schema capture backlog |

### OQ-1 = (c): does 3a assume 3c?

No. No code or comment in the diff names 3c. The `optional:agents` descriptors and the `agents` key in `PurgeOptions` / the preview Zod schema stay; they are what keeps the refusal live and testable (a preview with `agents: true` shows REFUSED on the 19 M-5 children). The `agent_executions` re-band was done for 3c's counts and is now moot but harmless (that run is always refused); leave it. For 3b: no agents checkbox; the commit route keeps the `agents` key and refuses `true` with a code (C-4 unchanged); do **not** reclassify the agents descriptors to `never` (FR-32 churn for no behaviour change).

### Code Review Comments

1. **F-1** `lib/business-os/purge/deleteGraph.ts` (`runDeleteGraphCheck`: `error?.message`, `err.message`) → `PreviewService.ts` limitation line → client JSON and the Danger Zone panel. Raw PostgREST / Zod-issue text reaches the client in production, against the "never expose internal error details" rule. Return a fixed plain message in `error` (e.g. "The live schema could not be read") and keep the raw text in the Pino log, or add it only under the `NODE_ENV === 'development'` guard. One assertion in `PreviewService.deleteGraph.test.ts`. — Priority: Medium (admin-only surface today, but the rule is non-negotiable). **Fix before the 3a PR.**
   - [x] ✅ **Fixed by Dev, 2026-10-05:** `runDeleteGraphCheck` now returns the fixed `SCHEMA_UNREADABLE_MESSAGE` ("The live schema could not be read") on both read-failure paths. The raw text goes to the Pino `err` only, and is appended to `error` only when `NODE_ENV === 'development'`. Tests: `PreviewService.deleteGraph.test.ts` asserts that raw PostgREST/Zod text (message, code, Zod issue) is absent from the serialised preview payload; `deleteGraph.test.ts` asserts the fixed text in production and the raw text appended in development. Purge suites 216/216, scoped tsc exit 0, eslint exit 0. Uncommitted.
2. **F-2** `PreviewService.ts` `deleteGraph` field: the full edge and trigger lists (constraint / trigger names) go to whoever may preview. Today that is admins only (`authorizePurge`: internal surface, or customer surface with its flag off). Once the customer surface is enabled for Purge (slice 5), a non-admin would receive schema internals. Carry to slice 5: the customer surface gets the status only. — Priority: Low (not reachable today). Record it in the parent workplan's slice-5 notes.

### Optimisation Suggestions
- The graph check looks at direct cascade edges only. A transitive unlisted grandchild is still caught, because its direct parent is already an unlisted child. One line in the "Known limit" comment would stop a later reader from "fixing" it.

### Code Approved for QA: Yes — conditional on F-1 (small; SA re-checks only that fix's diff)


## QA Testing Report

**QA — 2026-10-05 (slice 3a, uncommitted, includes the F-1 fix)**
**Test mode:** full
**Strategy used:** A (Jest unit, the existing suites plus mutation checks) and C (a read-only live script through `runDeleteGraphCheck` → `BusinessPurgeRepository.introspectSchema()` → `purge_schema_introspect()`). No browser check: the UI change is a read-only panel, and a source-level guard covers its "NOT VERIFIED" default.
**Focus:** schema, security, api
**Skipped:** the browser pass on `/test-business-os`. The panel's rendering is covered by the source guard and the preview payload tests.
**Input source:** prompt keywords from TL

### Test Coverage
| Acceptance criterion / check | Tested? | Result | Notes |
|---|---|---|---|
| Purge, `lib/repositories`, businessOwnedTables and account suites | ✅ | Pass | 72 suites, 1,471 tests green (`lib/business-os/purge`, `lib/repositories`, `businessOwnedTables`, `lib/business-os/account`, `app/api/business-os/purge`) |
| Full `npm test` | ✅ | Pass (no new failures) | 894 suites passed, 12 failed, 8 skipped. 11 of the 12 failures are quarantined. The other one, `lib/geo/__tests__/addressFormat.test.ts`, has an environment cause: the shared `node_modules` junction from the main checkout has no `lib-address` package, which this branch's `package.json` declares. That suite is untouched by 3a |
| Scoped `tsc` on all 16 touched or new `.ts`/`.tsx` files | ✅ | Pass | exit 0 |
| `eslint` on the same files | ✅ | Pass | exit 0, with 0 errors and 3 warnings. All 3 warnings are on lines this diff does not touch (`exhaustive-deps` in `PurgeDangerZone.tsx:212`, two `any` in `scripts/test-account-deletion.ts`) |
| Happy path, live and read-only: 8 agents-off combinations | ✅ | Pass | `2026-10-05T13:21:06Z`. Reset and Purge × integrations × activityHistory all return **ok**: 0 blocking, 0 unlisted, 0 unreviewed triggers. Cascade-after-parent = `crm_contacts → crm_activities` (exempt) only. Matches §1.4 |
| Agents on stays refused (OQ-1 (c)), live | ✅ | Pass | All 8 agents-on combinations return **refused**: 0 blocking, 0 triggers, 19 unlisted cascade edges (18 distinct tables, `execution_anomalies` from two parents). These are exactly the M-5 set |
| C-5 / F-1: an unreadable schema → NOT VERIFIED, and no raw error text in the production payload | ✅ | Pass | Covered by `PreviewService.deleteGraph.test.ts` (limitation line, `not.toContain` on the PostgREST message, code and Zod text) and by the source guard for "NOT VERIFIED (treated as refused)". **Mutation:** reverting F-1 (raw text in every environment) turns 3 tests red in `PreviewService.deleteGraph.test.ts` and `deleteGraph.test.ts`. File restored, and `cmp` confirms it is byte-identical |
| Ordering regression is caught | ✅ | Pass | **Mutation 1:** `business_profiles` `TENANCY_ROOT` → `CONFIG` turns 3 tests red in `descriptors.invariant.test.ts`. **Mutation 2:** `payment_reminders` `PRE_BLOCKING` → `LEAF` (the M-4 shape) turns the "only CASCADE_COUNT_EXEMPT children sit after a cascade parent" invariant red. Both restored, and `cmp` confirms they are byte-identical. Purge suites re-run green afterwards: 216 of 216 |
| Nothing under `supabase/` changed | ✅ | Pass | `git status -- supabase/` is empty |
| No `console.*` added | ✅ | Pass | 0 added lines. The existing hits are a comment in `PurgeDangerZone.tsx` and CLI scripts whose only change in this diff is a header comment |
| No DB writes | ✅ | Pass | Only `purge_schema_introspect()` was called (16 reads). `.env.local` was loaded by path from the main checkout, never copied into the worktree |

### Issues Found

#### Bugs (must fix before commit)
None.

#### Performance Issues (should fix)
None. The new tests run in milliseconds, and `runDeleteGraphCheck` adds one introspection read per preview.

#### Edge Cases (nice to fix)
1. **The agents refusal is graph-derived, not declared.** Agents-on is refused because its 19 cascade children are unlisted in the live graph. If someone later classified those tables into the run, the check would pass. OQ-1 (c) makes the refusal permanent, so 3b's C-4 should refuse `agents: true` on its own terms (a code), independent of the graph. That is already planned in 3b. Low.
2. **`lib/geo/__tests__/addressFormat.test.ts` is red in shared-`node_modules` worktrees.** `lib-address` is missing because the main checkout has not installed it. This is an environment issue, not a 3a issue, but it will show in any worktree full run until the main checkout runs `npm install`. Low.

### Test Outputs / Logs
```text
Scoped:  Test Suites: 72 passed, 72 total · Tests: 1471 passed, 1471 total
Full:    Test Suites: 12 failed, 8 skipped, 894 passed (914) · Tests: 132 failed, 65 skipped, 17566 passed
         failures = 11 quarantined + lib/geo/__tests__/addressFormat.test.ts (lib-address not installed)
Live (13:21:06Z): reset/purge × integ × activity, agents=false → status ok, blocking 0, unlisted 0, triggers 0
                  same × agents=true → status refused, unlisted 19, blocking 0, triggers 0
Mutations: F-1 revert → 3 failed · business_profiles→CONFIG → 3 failed · payment_reminders→LEAF → 1 failed
Post-restore: purge + ownership + introspect 12 suites / 216 tests green; git status identical to pre-QA
```

### Final Status
- [x] All acceptance criteria pass — ready for commit
- [ ] Issues found — Dev must address before commit

## Commit Info

*(RM populates. Dev leaves all changes uncommitted until the user has seen the diff.)*

---

## Change History

| Date | Change | Details |
|------|--------|---------|
| 2026-10-05 | Created (Dev) | Workplan only, no source changes. Read-only live measurement (§1.3) confirms F-SA-3 (56 CASCADE children, all classified) and F-SA-4 (B4 gone). It also finds the count-zero defect is wider than `business_profiles`, and **the agents opt-in cascades into 16 `never` and 3 unclassified tables (OQ-1)**. Split into 3a/3b/3c. Held RPC extended in place with two relation-agnostic graph controls |
| 2026-10-05 | 3a implemented (Dev) | T3a-0 gate run read-only against the live schema for all 16 combinations (§1.4): default runs clean after the re-band, agents-on refused on the 19 M-5 children. Re-band, B4 retired, `deleteGraph.ts`, trigger parsing, preview verdict + Danger Zone panel, cross-registry test, `accountDeletionPolicy` deprecated. No SQL, nothing in `supabase/`. Uncommitted. T3a-8 deferred (R-7) |
| 2026-10-05 | OQ-1 decided by the user: (c) | Purge never deletes agents; the "also delete my agents" extra is removed for good; slice 3c dropped; the delete-graph refusal stays. Scope, §1.3/§1.4, §3, §4.2/§4.3, §5, §7, R-1 and OQ-1 updated |
| 2026-10-05 | SA code review of 3a | APPROVED WITH CONDITIONS: F-1 (no raw introspection error text to the client outside development) before the PR; F-2 (customer surface gets the graph status only) carried to slice 5. All five deviations accepted, incl. `onboarding_prompt_ideas` as a reasoned exception. Re-band verified: 5 order changes, 0 level or table changes |
| 2026-10-05 | QA of 3a (incl. F-1) | PASS. Scoped suites 72/1,471 green; full run has no new failures (11 quarantined + an environment-only `lib/geo` failure); scoped tsc and eslint exit 0. Live read-only re-check: the 8 agents-off runs ok, the 8 agents-on runs refused (19 M-5 edges). Three planted regressions (F-1 revert, `business_profiles` band, `payment_reminders` band) each turned tests red and were restored byte-exact. Nothing in `supabase/` |
