# Workplan: Business OS data export, DE-2: classification, CI check and skill rule

> **Last Updated**: 2026-10-15

## Overview

DE-2 makes the data export impossible to fall behind. Every purge descriptor (every live tenant table, and every bucket) gains a **required `export` field** that says whether that table goes into the "Download my data" file: `include` (a section and an explicit column list), `exclude` (a written reason), or `planned` (the slice that will add it). A Jest test fails CI when a descriptor has no classification, when an included table could leak a secret column, or when the export's section registry and the descriptors disagree. The live schema check gains a **report-only** list of columns on included tables that nobody has classified. The three scaffolding skills gain the export-classification rule. DE-2 changes **nothing** a Reset, Purge or admin delete removes, and **nothing** in today's export file: no DB change, no migration, no new route, no new dependency.

| Field | Value |
|---|---|
| **Developer** | Dev |
| **Requirement** | `docs/requirements/BUSINESS_OS_DATA_EXPORT_REQUIREMENT.md` §0.3.1 (scope rulings), §0.3.3 (DE-8a registrations, for reference), **§0.3.6 (the binding design)**, §0.4 / §0.4.1 B and D (DE-2 row; agents and agent settings `exclude`, reason "not Business OS data (user 2026-10-14)"), §0.5 (DE-1 notes: disconnected plugin connections are a status), §6.4 (FR-E17…FR-E21), Appendix A (skill text) |
| **Carried from DE-1 review** | SA S-1: the "export reads no audit rows" guard scans `lib/business-os/data-export/**`, not only the route |
| **Branch** | `feature/data-export-de2` (worktree `neuronforge-de2`, from origin/main `a772e4ae`, which includes DE-1 / PR #393) |
| **Date** | 2026-10-15 |
| **Status** | **Code Complete** (2026-10-15, uncommitted). SA workplan review: approved with C-1…C-9. C-3 met (TL live read 2026-10-15, drift 0, missing 0). SA code approved and QA passed 2026-10-15 |
| **Depends on** | DE-1 (merged, PR #393) |
| **Effort** | 🟡 ~2 d (SA estimate 1.5 d; +0.5 d for the type-check gap in §1.3 and the 155-row classification pass) |

---

## Table of Contents

1. [Analysis Summary](#1-analysis-summary)
2. [Implementation Approach](#2-implementation-approach)
3. [The classification value set](#3-the-classification-value-set)
4. [Every table's proposed classification](#4-every-tables-proposed-classification)
5. [Business calls (for the user, via TL)](#5-business-calls-for-the-user-via-tl)
6. [Files to Create / Modify](#6-files-to-create--modify)
7. [Task List](#7-task-list)
8. [Tests (incl. negative controls)](#8-tests-incl-negative-controls)
9. [CI placement and runtime](#9-ci-placement-and-runtime)
10. [Risks](#10-risks)
11. [Open questions for SA](#11-open-questions-for-sa)
12. [Dev Implementation Notes](#dev-implementation-notes)
13. [SA Review Notes](#sa-review-notes)
14. [QA Testing Report](#qa-testing-report)
15. [Commit Info](#commit-info)

---

## 1. Analysis Summary

### 1.1 What DE-2 touches

| Area | As built on origin/main `a772e4ae` (read in this workplan) |
|---|---|
| `lib/business-os/purge/types.ts` | `PurgeDescriptor { table, level, scope, order, snapshot, notes?, area? }`, `StorageDescriptor { bucket, level, pathPrefix, purpose }`. No export field |
| `lib/business-os/purge/descriptors.ts` | **154 table descriptors** (57 `reset`, 11 `purge`, 72 `never`, 1 `optional:integrations`, 11 `optional:agents`, 2 `optional:activityHistory`) and **3 storage descriptors**. Most `never` rows are built by a `never(table, scope, notes)` helper |
| `lib/business-os/businessOwnedTables.ts` | 61 business-owned tables, 46 user-owned tables with reasons. Measured with a scratch script: every business-owned table has a descriptor except `websites` and `insight_outcomes` (not live, reasoned exceptions in the test); every user-owned table has one **except `intent_examples`** (§0.3.6 gap confirmed) |
| `lib/business-os/__tests__/businessOwnedTables.test.ts` | Migration-reading test (`CREATE TABLE … user_id` must be in a list), TS list = SQL array, direction 1 (business-owned → `reset`/`purge` descriptor), direction 2 (deletable descriptor → a list). **No test asserts that every USER_OWNED table has a descriptor**, so the FR-E18 chain has a hole today |
| `lib/business-os/purge/__tests__/descriptors.invariant.test.ts` | Banding, B-1 / B-2 scans, the frozen `classification-baseline.json` (`count: 154`, `levels`, dated `reviewNotes`) |
| `lib/business-os/purge/SchemaReconciler.ts` | Pure `reconcileSchema(snapshot, descriptors)` over `purge_schema_introspect()` (`columns[]` with every public column, `foreign_keys[]`); result `{ status, unclassified, missingDeletable, missingNever, tenantTables, fingerprint }`. The fingerprint hashes `(table, level)` pairs only. Run by `scripts/purge-schema-reconcile.ts` (read-only) and by the admin delete preview / commit |
| `lib/business-os/data-export/sections.ts` (DE-1) | `ExportSectionId = 'account_identity' \| 'user_profile' \| 'plugin_connections'`; `EXPORT_SECTIONS` registry. `account_identity` comes from the session (no table) |
| Column lists today | `PROFILE_DATA_EXPORT_COLUMNS` in `UserProfileRepository.ts` (17 columns, no `plan`), `USER_DATA_EXPORT_COLUMNS` in `PluginConnectionRepository.ts` (13 columns, no token). Pinned literally by `userDataExportReads.test.ts` and the route characterization test |
| `lib/audit/__tests__/ownerAuditReads.guard.test.ts` | BD-26 guard; `routeReadsNoAuditRows` applies to `app/api/user/data-export/route.ts` only (S-1 gap) |
| Skills | `.claude/skills/new-repository`, `new-api-route`, `new-plugin`, `durable-queue-drain`: no export rule yet |

### 1.2 Purge level and export classification are independent axes

A table that is never purged can still be exported, and the other way round: `profiles` is `never` and `include`; `email_unsubscribes` and the consent tables are `never` and will be `include` (DE-6); `onboarding_conversations` is `reset` and `exclude`. Nothing in DE-2 derives one from the other, and the purge engine never reads `export` (§2.5).

### 1.3 Finding: a required field does not fail CI through `tsc` today

§0.3.6 says a descriptor without `export` "fails `tsc`, the existing type-check job". Measured on this branch:

- **Jest does not type-check.** `tsconfig.json` sets `isolatedModules: true` and ts-jest runs transpile-only. A probe test that assigned an object missing a required property to its interface **passed** (2026-10-15, then deleted).
- **The only `tsc` gate is `npm run typecheck:bos-llm`** (required job `bos-llm-typecheck.yml`). Its scope (`scripts/typecheck-bos-llm.ts` `SCOPED_DIRS` + importers + callers) does **not** include `descriptors.ts` or `types.ts`. `--list` shows one purge file in scope: `__tests__/adminDeletionPreview.wireTypes.test.ts`.
- `next build` ignores type errors (`ignoreBuildErrors: true`).

So the type alone is editor feedback only. DE-2 enforces the field with **a runtime Jest check** (every descriptor object has a valid `export`, §8 T-1), which needs no type checker. To also make the `tsc` half real, DE-2 proposes adding **two paths** to `SCOPED_DIRS`, with the same one-file precedent the purge wireTypes test already uses: `lib/business-os/purge/descriptors.ts` and `lib/business-os/data-export/`. SA rules (SA-Q1).

---

## 2. Implementation Approach

### 2.1 Types (one source, no fourth list)

**File:** `lib/business-os/data-export/classificationTypes.ts` (new, pure: no imports with side effects, no `server-only`)

```typescript
export type ExportSectionId = 'account_identity' | 'user_profile' | 'plugin_connections';
export type PlannedTableSlice = 'DE-3' | 'DE-4' | 'DE-5' | 'DE-6' | 'DE-7';
export type PlannedFilesSlice = 'DE-8b';

export type TableExportClassification =
  | { kind: 'include'; section: ExportSectionId; columns: readonly string[]; excludedColumns?: Readonly<Record<string, string>> }
  | { kind: 'exclude'; reason: string }
  | { kind: 'planned'; slice: PlannedTableSlice };

export type StorageExportClassification =
  | { kind: 'include'; folder: string }          // the folder inside "Your files" (DE-8b uses it)
  | { kind: 'exclude'; reason: string }
  | { kind: 'planned'; slice: PlannedFilesSlice };
```

`ExportSectionId` moves here from `sections.ts` (which re-exports it), so `purge/types.ts` imports a type from a pure file, never from a `server-only` module. `PurgeDescriptor` gains `export: TableExportClassification` and `StorageDescriptor` gains `export: StorageExportClassification`, both **required**. The bucket shape differs from the table shape because a bucket has no columns or section (SA-Q2).

### 2.2 descriptors.ts

- Each row gets an `export` value (§4). Repeated reasons are named constants at the top of the file (`EXPORT_REASON.BILLING = 'DX-1: billing and credits are not exported'`, `EXPORT_REASON.AGENTS = 'not Business OS data (user 2026-10-14)'`, …), and two tiny builders `exclude(reason)` / `planned(slice)` keep each row one line. The `never(table, scope, notes)` helper gains a fourth required parameter `exportAs`.
- `profiles` and `plugin_connections` get `include` with the **exact column lists today's repositories read, in the same order**, so `columns.join(', ')` is byte-identical to the existing select strings and the characterization pins do not change.
- `excludedColumns` for the two included tables: every other live column with its reason. Known now: `profiles.plan` ("DX-1a / Q-3: no plan or billing data"); `plugin_connections.access_token`, `refresh_token` ("credential, never read"), `expires_at`, `last_refreshed_at` ("token plumbing"), `settings` ("free-form; a secret could land there unseen"), `id` ("internal row id"). The complete list comes from the live read in T-2 (§7), not from migration files (`business-os-schema-check`).
- `plugin_connections` notes gain: "Disconnected rows are a **status**, not a soft delete (DE-1 SA Q-7): they stay in the export. `profile_data` is read but only its allow-listed keys reach the file (`ACCOUNT_PROFILE_KEYS`)."
- **New descriptor** `intent_examples`, `level: 'never'`, export `exclude` (agent platform). Scope per the live read: its only `CREATE TABLE` (`20260629_intent_examples_table.sql`) has **no `user_id`** (a PII-stripped few-shot catalog), so the scope is `global` unless the live schema says otherwise (SA-Q9). It joins no run (`never`), so no delete changes; the baseline gains it (count 154 → 155, dated review note).

### 2.3 One pure classification module

**File:** `lib/business-os/data-export/classification.ts` (new, pure)

- `exportClassificationOf(table)`, `exportColumnsOf(table): readonly string[]` (throws a typed error if the table is not `include`, or if a column is on the deny list; see below).
- `SECRET_COLUMN_DENY`: exact names (`access_token`, `refresh_token`, `token`, `credentials`, `secret`, `api_key`, `password`, `password_hash`, `account_token`, `cost_usd`, `provider_cost_usd`) and patterns (`*_token`, `*_secret`, `*_key`, `*_credentials`, `*_hash`, `*cost_usd`). `*_key` also matches harmless identifiers (`plugin_key`, `dedupe_key`), so `DENY_EXCEPTIONS` is a `Record<'table.column', reason>`. In DE-2 it holds exactly one entry: `plugin_connections.plugin_key`, "the plugin's name (e.g. google-mail), not a credential". An exception is a review decision (SA-Q6).
- `columnDrift(snapshotColumns, descriptors)` and `columnsMissing(…)`: the pure halves of the report-only drift (§2.6).

The same deny check runs at **two** points: in the Jest test (CI) and inside `exportColumnsOf` at request time. A column that slips past review then fails the section closed (`failed`, FR-E12) instead of being sent.

### 2.4 Readers take their columns from the descriptor

`UserProfileRepository.findForUserDataExport` and `PluginConnectionRepository.listForUserDataExport` replace their string constants with `exportColumnsOf('profiles').join(', ')` / `exportColumnsOf('plugin_connections').join(', ')`, resolved **inside the method's `try`**. A bad descriptor then returns `{ data: null, error }` and the section is `failed`. It never breaks module load for the many routes that import `UserProfileRepository`. Precedent for a repository importing the descriptors: `TestAccountCleanupRepository` imports `STORAGE_DESCRIPTORS`. The constants' privacy comments move onto the descriptor rows. Because the string is identical, `userDataExportReads.test.ts` and the route characterization test keep their literal pins. They also gain one assertion each: the select equals `exportColumnsOf(table).join(', ')`. Alternative (SA-Q7): the reader passes the columns into the repository method.

### 2.5 Purge stays blind to `export`

No file under `lib/business-os/purge/` other than `descriptors.ts` and `types.ts` reads `.export`. The reconciler does not read it either: it calls the pure `columnDrift` / `columnsMissing` from `lib/business-os/data-export/classification.ts`, which do. The fingerprint stays `(table, level)` only, so the `export` field never changes it. **But** the new `intent_examples` descriptor adds one `(table, level)` pair, so the fingerprint changes once at deploy (QA DE-2 finding 1): an admin-delete preview issued before the deploy is refused at commit after it, and the admin previews again. Fail-closed, harmless. A test proves `status`, `unclassified`, `missingDeletable` and `fingerprint` do not change when every descriptor's `export` is swapped (§8 T-12).

### 2.6 Column drift (FR-E19), report-only

`SchemaReconcileResult` gains two **additive** fields:

- `exportColumnDrift: Array<{ table; column }>`: a live column on an `include` table that is in neither `columns` nor `excludedColumns`.
- `exportColumnsMissing: Array<{ table; column }>`: a column in `columns` that is not live. A declared column that does not exist makes PostgREST reject the whole select, so the section would always be `failed`. And because descriptor-driven selects are no longer string literals, `npm run schema:check`'s extractor cannot see them any more (its documented blind spot), so this list replaces that coverage (SA-Q5).

Neither field affects `status`, so neither ever blocks a delete or fails an export. `scripts/purge-schema-reconcile.ts` logs both (counts + table.column names: schema, not data). They are **not** added to the admin preview's wire payload in DE-2: that payload is re-declared by the admin page and pinned by a wireTypes test, and nothing on that screen needs it (SA-Q3). Where the developer runs it: SA-Q4.

### 2.7 Section registry ↔ descriptors

Each `include` descriptor names a section in `EXPORT_SECTIONS`. Each section in `EXPORT_SECTIONS` has exactly one `include` descriptor, except `NON_TABLE_SECTIONS = { account_identity: 'from the signed-in session (auth user), not a table' }`. One table per section is the DE-2 rule. A later slice that needs two tables in one section asks SA (SA-Q8).

### 2.8 `planned` has an expiry

`PLANNED_TABLES_ALLOWED = true` in the test (DE-7 flips it to `false`). Buckets get their own `PLANNED_FILES_ALLOWED = true`, which DE-8b flips, because files arrive in DE-8b, after DE-7 (SA-Q2). The check is a pure function taking the flag, so the "flag is false" behaviour is tested now (negative control), not first at DE-7.

### 2.9 Audit guard (DE-1 SA S-1)

`ownerAuditReads.guard.test.ts` applies `routeReadsNoAuditRows` to **every non-test file under `lib/business-os/data-export/`** as well as the route. It is widened to also refuse the archived audit history (`'archived_records'` literal, `archiveRepository`), since archived rows are the same owner activity history (DX-1d, BD-26). Non-vacuity: `sections.ts`, `payload.ts` and `classification.ts` must be in the scan. Plus a descriptor pin: `audit_trail` and `archived_records` are `exclude` (§8 T-8).

### 2.10 Skill rule

Appendix A goes into `new-repository` (Step 6 checklist + anti-pattern row), `new-api-route` (Step 4 checklist) and `new-plugin` (Step 4 non-negotiables, for plugins that add their own table, e.g. internal Business OS plugins). It is adjusted per §0.3.6: it points at **`lib/business-os/purge/descriptors.ts` (the `export` field)** as the place, not at the requirement's §6.4. It also names buckets (a new bucket is a `STORAGE_DESCRIPTORS` row with `export`), and it names the drift command decided in SA-Q4 instead of `schema:check`. `durable-queue-drain` gets the one line from §0.3.6: "a new queue table is a tenant table: descriptor + export `exclude`". Proposed text:

> **Data export classification (mandatory).** If your change adds a table or a storage bucket that stores customer or business data, or adds a column to a table the export includes, classify it in the same PR, in its descriptor in `lib/business-os/purge/descriptors.ts` (the required `export` field). Either **include** it with an explicit column list (never `*`), or **exclude** it with a written reason (secret, cache, platform-only, our cost, activity…). Token, secret and key columns are always excluded and must never be granted to `anon` / `authenticated`. An unclassified new table fails CI (`exportClassification.test.ts`). A new column on an included table goes into its `columns` or its `excludedColumns`, with a reason. Check the live schema with `<SA-Q4 command>`, which reports unclassified and missing columns.

---

## 3. The classification value set

| Kind | Applies to | Required data | Meaning | Enforced by |
|---|---|---|---|---|
| `include` | tables | `section` (an `ExportSectionId`), `columns` (non-empty, explicit, no `*`, no deny-list column), optional `excludedColumns` (column → reason) | The table is a section of the file, with exactly these columns | T-1…T-6, runtime deny check in `exportColumnsOf` |
| `include` | buckets | `folder` | The bucket's `{user_id}/` objects go into "Your files" under this folder | T-1, T-7 (none in DE-2) |
| `exclude` | both | `reason` (non-empty) | Never in the file. The reason is what a reviewer reads | T-1, T-2 |
| `planned` | tables | `slice` ∈ DE-3…DE-7 | In scope, not built yet. Allowed until DE-7 | T-7 (`PLANNED_TABLES_ALLOWED`) |
| `planned` | buckets | `slice` = DE-8b | Files, not built yet. Allowed until DE-8b | T-7 (`PLANNED_FILES_ALLOWED`) |

Reasons used below (named constants in `descriptors.ts`):

| Key | Reason text |
|---|---|
| `BILLING` | DX-1: billing and credits are not exported |
| `AGENTS` | not Business OS data (user 2026-10-14) |
| `ACTIVITY` | DX-1d: activity (assistant chats, briefings, insights, emails sent) is not exported |
| `VISITOR` | DX-1d / SQ-E7: visitor tracking, not exported |
| `AUDIT` | DX-1d: the owner's activity history is not exported; BD-26 hidden types never |
| `PLATFORM` | platform data, not this account's data |
| `ACTOR_REF` | platform data; the account appears only as who changed a row |
| `SECRET` | secrets and credentials are never exported (§3.2) |
| `CACHE` | cache or derived data, not the owner's data |

---

## 4. Every table's proposed classification

Every row follows §0.2, §0.3.1, §0.4 and §3.1 unless marked **(BC)** (a business call, §5) or **(SA)** (a technical judgment SA confirms). "Slice" is the DE slice that adds the section.

### 4.1 Account and profile (DX-1a)

| Table | Purge level | Export | Section / slice / reason |
|---|---|---|---|
| `profiles` | never | **include** | `user_profile`: today's 17 columns (no `plan`). DE-3 decides `hourly_rate_usd`, `role`, `org_id` (§0.5) |
| `plugin_connections` | optional:integrations | **include** | `plugin_connections`: today's 13 columns, no token. Disconnected = status (§0.5) |
| `user_preferences` | never | planned | DE-3 |
| `notification_settings` | never | planned | DE-3 |
| `business_profiles` | purge | planned | DE-3 |
| `business_addresses` | purge | planned | DE-3 |
| `security_settings` | never | exclude | `SECRET`: security configuration; not in the §0.3.1 DX-1a set |
| `api_keys` | never | exclude | `SECRET` |
| `auth_handoff_codes` | never | exclude | `SECRET`: short-lived sign-in codes (§3.2) |
| `admin_users` | never | exclude | `PLATFORM`: platform authorization |
| `organizations` | never | exclude **(BC)** | `PLATFORM`: an agent-platform organisation row every user gets; not in the DX-1a set |
| `organization_members` | never | exclude **(BC)** | as `organizations` |
| `user_capabilities` | purge | exclude **(BC)** | `PLATFORM`: which Business OS modules the account switched on; set up again by switching them on, not data the owner entered |
| `user_capability_blocks` | purge (via) | exclude **(BC)** | as `user_capabilities` |

### 4.2 Billing, plan and credits (DX-1a: out)

| Table | Purge level | Export | Reason |
|---|---|---|---|
| `business_os_account_plans`, `business_os_billing_accounts`, `business_os_billing_events`, `business_os_credit_charges`, `business_os_credit_totals`, `business_os_credit_lots`, `business_os_credit_lot_draws`, `business_os_boost_purchases`, `business_os_boost_cap_overrides`, `business_os_entitlement_overrides` | never | exclude | `BILLING` |
| `business_os_entitlement_shadow_events` | never | exclude | `CACHE`: platform counters (§3.2) |
| `business_os_invites` | never | exclude | `BILLING` (§0.3.1 names it) |
| `business_os_account_lineage` | never | exclude | `PLATFORM`: who invited whom |
| `user_subscriptions`, `subscriptions`, `subscription_invoices`, `billing_events`, `credit_transactions`, `boost_pack_purchases`, `user_rewards` | never | exclude | `BILLING` |
| `storage_usage` | never | exclude | `PLATFORM`: quota accounting |
| `token_usage` | never | exclude | `BILLING`: usage and our cost (§3.2) |
| `processed_webhook_events` | never | exclude | `PLATFORM`: webhook idempotency |

### 4.3 Client records (DX-1b)

| Table | Purge level | Export | Slice / reason |
|---|---|---|---|
| `crm_contacts`, `crm_activities`, `crm_tasks`, `crm_pipeline_stages`, `contact_documents` (metadata) | reset / purge | planned | DE-4 |
| `scheduling_services`, `scheduling_bookings`, `scheduling_availability_exceptions`, `external_calendar_events` | reset | planned | DE-4 |
| `payment_transactions`, `payment_refunds`, `payment_invoices`, `payment_plans`, `payment_plan_subscriptions`, `payment_plan_installments`, `payment_reminders`, `payment_events`, `payment_automation_rules`, `payment_automation_executions`, `saved_payment_methods`, `payment_methods`, `stripe_connect_accounts`, `payment_processors`, `proposals` | reset / purge | planned | DE-5 (§3.1 B3; processors: name and status only, `credentials` will be hit by the deny list) |
| `business_intake_forms`, `user_intake_settings`, `lead_responses`, `business_subscribers`, `marketing_consent_settings`, `marketing_consent_events`, `marketing_consent_state`, `email_unsubscribes`, `email_campaigns`, `email_sequences`, `email_sequence_steps`, `email_sequence_enrollments` | reset / purge / never | planned | DE-6 (§3.1 B4; consent kept as the owner's legal record, §0.3.1) |
| `email_sends` | reset | exclude | `ACTIVITY` (§0.3.1: an email sent is activity) |

### 4.4 Content (DX-1c)

| Table | Purge level | Export | Slice / reason |
|---|---|---|---|
| `website_pages`, `website_content`, `smart_links`, `user_media` (metadata) | reset | planned | DE-7 |
| `website_blocks` | reset (via `website_pages`) | planned **(SA)** | DE-7. Not named in §0.3.1, but it holds the pages' content blocks; a page export without it is empty. Read through its parent (no `user_id`) |
| `website_page_views` | reset | exclude | `VISITOR` |
| `smart_link_clicks` | reset (via) | exclude | `VISITOR` |

### 4.5 Activity, assistant and insights (DX-1d: out)

| Table | Purge level | Export | Reason |
|---|---|---|---|
| `onboarding_conversations`, `business_chat_conversation`, `business_chat_saved_plans`, `business_chat_verified_questions`, `business_chat_action_log`, `command_sessions` | reset | exclude | `ACTIVITY` (assistant chat and its records) |
| `onboarding_prompt_ideas` | reset | exclude **(SA)** | `ACTIVITY`: suggestions the onboarding assistant generated |
| `business_chat_plan_cache` | reset | exclude | `CACHE` |
| `daily_briefings`, `daily_briefing_sends` | reset | exclude | `ACTIVITY` |
| `insights`, `insight_actions`, `insight_automations`, `insight_hypotheses`, `insight_measurements`, `owner_insight_history`, `business_health_summaries`, `business_events` | reset | exclude | `ACTIVITY` (§3.1 group D; hypotheses / measurements are also operator-only) |
| `derived_metrics` | reset | exclude | `CACHE` (SQ-E7) |
| `kernel_executions`, `kernel_action_log` | reset | exclude | `ACTIVITY`: runs the insights engine triggered |
| `channel_connections` | purge | exclude | `ACTIVITY` (group D) and it holds `account_token` |
| `channel_metrics_daily` | reset | exclude | `ACTIVITY` (group D) |
| `audit_trail` | optional:activityHistory | exclude | `AUDIT` |
| `archived_records` | optional:activityHistory | exclude | `AUDIT` (archived `audit_trail` rows) |
| `audit_logs` | never | exclude | `AUDIT` (left in DE-1) |

### 4.6 Agent platform (BQ-SA-1: out)

| Table | Purge level | Export | Reason |
|---|---|---|---|
| `agents` | optional:agents | exclude | `AGENTS`, the user's own wording (§0.4) |
| `agent_configurations` | never | exclude | `AGENTS`, the user's own wording (§0.4) |
| `agent_executions`, `agent_logs`, `agent_scheduler_state`, `agent_memory`, `agent_memories`, `run_memories`, `user_memory`, `agent_prompt_threads`, `agent_prompt_workflow_generation_sessions`, `data_decision_requests` | optional:agents | exclude | `AGENTS` |
| `agent_execution_logs`, `agent_templates`, `agentkit_analytics`, `calibration_sessions`, `calibration_history`, `workflow_executions`, `pilot_step_routing_history`, `shadow_failure_snapshots`, `shared_agents`, `execution_insight_runs`, `execution_insights`, `agent_stats`, `agent_intensity_metrics`, `error_patterns`, `execution_anomalies`, `execution_baselines`, `plugin_performance`, `advisor_reports`, `automation_slas`, `metric_baselines`, `group_metrics_rollup` | never | exclude | `AGENTS` |
| `intent_examples` (new descriptor) | never | exclude | `AGENTS` (a V6 few-shot catalog) |

### 4.7 Platform catalogs and actor references

| Table | Purge level | Export | Reason |
|---|---|---|---|
| `capabilities`, `capability_building_blocks`, `website_templates`, `intake_form_templates`, `archive_runs`, `bos_cron_runs`, `bos_cron_run_recording` | never | exclude | `PLATFORM` |
| `ais_scoring_weights`, `ais_system_config`, `shared_agent_imports`, `exchange_rates`, `exchange_rate_history`, `system_settings_config`, `sla_events` | never | exclude | `ACTOR_REF` |

### 4.8 Buckets

| Bucket | Purge level | Export | Slice / reason |
|---|---|---|---|
| `contact-documents` | reset | planned | DE-8b ("Your files", DX-1c) |
| `website-images` | reset | planned | DE-8b (also backs `user_media`) |
| `business-purge-snapshots` | never | exclude | "an internal copy taken before a purge, not the live data" |
| `business-data-exports` (DE-8a adds it) | — | (exclude, in DE-8a) | "the export itself" (§0.3.3) |

**Totals after DE-2:** 155 table descriptors = 2 `include` + 45 `planned` (DE-3: 4, DE-4: 9, DE-5: 15, DE-6: 12, DE-7: 5) + 108 `exclude`; a scratch script confirmed every one of the 154 existing descriptors is named in §4; 3 buckets = 2 `planned` + 1 `exclude`. Dev re-counts in T-5 and records the measured figures here.

---

## 5. Business calls (for the user, via TL)

Two tables are not settled by the user's decisions so far. DE-2 can ship with the proposed answer, and changing it later is a one-line edit.

| # | Question, in business terms | Proposed | Why |
|---|---|---|---|
| **BC-1** | Should the download list **which Business OS modules the owner switched on** (e.g. scheduling, payments, website)? | **No** | It is setup, not something the owner wrote or collected. The modules' own data (bookings, payments, pages) is in the file anyway, and switching the modules on in a new account rebuilds it |
| **BC-2** | Should the download include the account's **organisation and team-membership record**? | **No** | Today it is an agent-platform record every account gets automatically. It holds no client or business content. The owner's own details are in "Your account" |

---

## 6. Files to Create / Modify

| File | Action | Reason |
|---|---|---|
| `lib/business-os/data-export/classificationTypes.ts` | create | The export classification types and `ExportSectionId` (pure) |
| `lib/business-os/data-export/classification.ts` | create | `exportClassificationOf`, `exportColumnsOf`, deny list + exceptions, pure drift helpers |
| `lib/business-os/data-export/sections.ts` | modify | Re-export `ExportSectionId` from the new types file; no behaviour change |
| `lib/business-os/purge/types.ts` | modify | Required `export` on both descriptor types (type-only import) |
| `lib/business-os/purge/descriptors.ts` | modify | `export` on 154 + 1 rows and 3 buckets; reason constants and builders; `never()` signature; `intent_examples` descriptor; `plugin_connections` note |
| `lib/business-os/purge/__tests__/classification-baseline.json` | modify | + `intent_examples: never`, count 155, dated review note |
| `lib/business-os/purge/__tests__/descriptors.invariant.test.ts` | modify | Baseline count literal 154 → 155 and its comment |
| `lib/business-os/purge/SchemaReconciler.ts` | modify | Additive `exportColumnDrift` / `exportColumnsMissing` through the pure helpers |
| `lib/business-os/purge/__tests__/SchemaReconciler.test.ts` | modify | Drift cases, invariance (T-12); its local `d()` builder gains `export` |
| `scripts/purge-schema-reconcile.ts` | modify | Log both new lists (exit code unchanged) |
| `lib/repositories/UserProfileRepository.ts`, `lib/repositories/PluginConnectionRepository.ts` | modify | Columns from `exportColumnsOf` inside the method's `try`; comments move to the descriptor |
| `lib/repositories/__tests__/userDataExportReads.test.ts` | modify | Select equals the descriptor's columns; bad-descriptor path returns `{ error }` |
| `lib/business-os/data-export/__tests__/exportClassification.test.ts` | create | T-1…T-11 (§8) |
| `lib/business-os/__tests__/businessOwnedTables.test.ts` | modify | Direction 3: every USER_OWNED table has a descriptor (FR-E18 chain) |
| `lib/audit/__tests__/ownerAuditReads.guard.test.ts` | modify | S-1: scan `lib/business-os/data-export/**`; refuse `archived_records` / `archiveRepository` too |
| ~~`scripts/typecheck-bos-llm.ts`~~ | not touched | SA-Q1 declined (C-1) |
| `package.json` | modify | `schema:reconcile` alias (SA-Q4) |
| Other test files that build `PurgeDescriptor` / `StorageDescriptor` literals | modify | Add `export` to fixtures. Dev lists them with `grep -rn "snapshot: '" lib/**/__tests__` in T-1 |
| `.claude/skills/new-repository/SKILL.md`, `new-api-route/SKILL.md`, `new-plugin/SKILL.md`, `durable-queue-drain/SKILL.md` | modify | §2.10 |
| `docs/requirements/BUSINESS_OS_DATA_EXPORT_REQUIREMENT.md` | modify | DE-2 status in §0 + Change History (standing rule: every slice stage goes into the main requirement) |
| This workplan | modify | Status, measured counts, live-read results |

No migration, no route, no UI, no dependency. `accountDeletionPolicy.ts` is not touched (§0.3.6).

---

## 7. Task List

- ✅ **T-0** Confirm branch `feature/data-export-de2`; `git diff --stat` empty before starting.
- ✅ **T-1** Types: `classificationTypes.ts`; required `export` on `PurgeDescriptor` / `StorageDescriptor`; `sections.ts` re-export. List every test fixture that builds a descriptor literal.
- 🟡 **T-2** ✅ (live read done by TL, C-3) Live read (read-only, `business-os-schema-check`): run `scripts/purge-schema-reconcile.ts` against prod. Record (a) every live column of `profiles` and `plugin_connections` → `excludedColumns` with reasons; (b) whether `intent_examples` is live and has `user_id` → its scope; (c) the git SHA it ran from. Nothing is written. If no env is available in the worktree, ask TL to have the user run it.
- ✅ **T-3** `classification.ts`: deny list, exceptions, `exportColumnsOf`, drift helpers.
- ✅ **T-4** `descriptors.ts`: reason constants, builders, `never()` fourth parameter, every row per §4, bucket rows, `intent_examples`, `plugin_connections` note. **Edit in place, never rewrite the file.** Then `git diff --numstat`: deletions must equal changed lines only (truncation hazard).
- ✅ **T-5** Baseline + invariant literal (155). Run `descriptors.invariant.test.ts` and `businessOwnedTables.test.ts`: zero level changes and an identical `descriptorsForRun` for all 16 combinations. Record the measured totals in §4.
- ✅ **T-6** Repositories read columns from the descriptor; update `userDataExportReads.test.ts`; route characterization test still green unchanged.
- ✅ **T-7** `exportClassification.test.ts` (T-1…T-11 in §8), each with its negative control.
- ✅ **T-8** businessOwnedTables direction 3.
- 🟡 **T-9** ✅ (live read done by TL, C-3) Reconciler drift fields + tests + script output; re-run T-2's script and record `exportColumnDrift` = 0 and `exportColumnsMissing` = 0 for the two included tables.
- ✅ **T-10** Audit guard extension (S-1).
- ~~**T-11**~~ dropped (SA-Q1 declined, C-1). (if SA-Q1 = yes) `SCOPED_DIRS` + `npm run typecheck:bos-llm` green; measure its wall time before and after on this machine and record it here.
- ✅ **T-12** Skills (four files).
- ✅ **T-13** Full checks: `npm test -- lib/business-os lib/audit lib/repositories app/api/user/data-export`, `npm run test:bos-entitlements` (the `business-os-entitlements` skill's handover rule; DE-2 imports nothing from `entitlements/`, but that suite runs the purge invariant and ownership tests DE-2 edits), `npm run lint`. Record runtimes.
- ✅ **T-14** Requirement §0 status + Change History; workplan status → Code Complete. Leave all changes uncommitted.

---

## 8. Tests (incl. negative controls)

Every rule is a pure function in the test (or in `classification.ts`) so that the negative control calls the same function on a planted bad input. That is the pattern `descriptors.invariant.test.ts` already uses.

| # | Asserts | Negative control |
|---|---|---|
| T-1 | Every table and storage descriptor has `export` with a known `kind` and the kind's required data. **This is the CI enforcement**: Jest does not type-check (§1.3) | A descriptor object without `export`, one with `kind: 'maybe'`, and a bucket with `columns` are each flagged |
| T-2 | `exclude.reason` is non-empty after trim | `{ kind: 'exclude', reason: '  ' }` flagged |
| T-3 | `include.columns` is non-empty, unique, has no `*`, no comma, no whitespace, matches `^[a-z_][a-z0-9_]*$` | `[]`, `['*']`, `['a, b']`, `['id','id']` each flagged |
| T-4 | No `include` column hits `SECRET_COLUMN_DENY` unless in `DENY_EXCEPTIONS`; every exception still names a real included column (no stale entry) | `access_token`, `stripe_secret_key`, `credentials`, `provider_cost_usd` planted → flagged; `plugin_key` passes only through its exception; a stale exception is flagged |
| T-5 | `excludedColumns` keys are disjoint from `columns`, and each has a non-empty reason | Overlap and empty reason flagged |
| T-6 | Section registry: every `include.section` ∈ `EXPORT_SECTIONS` ids; every `EXPORT_SECTIONS` id outside `NON_TABLE_SECTIONS` has exactly one `include` descriptor; every `NON_TABLE_SECTIONS` id is still a registered section | A section with no descriptor, a descriptor naming an unknown section, and two descriptors on one section are each flagged |
| T-7 | `planned` only while its flag is true (`PLANNED_TABLES_ALLOWED` for tables, `PLANNED_FILES_ALLOWED` for buckets); the slice is in the allowed set | With the flag set to `false`, the current descriptors report every `planned` row (proves DE-7's / DE-8b's flip will bite) |
| T-8 | Ruled pins: `agents` and `agent_configurations` are `exclude` with the literal reason "not Business OS data (user 2026-10-14)"; `audit_trail`, `archived_records`, `audit_logs`, `email_sends`, `website_page_views`, `smart_link_clicks`, `onboarding_conversations`, `user_subscriptions`, `credit_transactions`, `business_os_invites` and every `business_os_credit_*` / `business_os_billing_*` table are `exclude`; `profiles` → `user_profile` and `plugin_connections` → `plugin_connections` are `include` | Flipping one pinned row in a copy fails the pin |
| T-9 | `plugin_connections`: `access_token` and `refresh_token` are in `excludedColumns`, not in `columns`; its notes say disconnected rows are a status | — (covered by T-4's planted cases) |
| T-10 | `exportColumnsOf` throws for an `exclude` / `planned` / unknown table and for a deny-list column; the repository returns `{ data: null, error }` and the section is `failed` | Exactly these cases |
| T-11 | The readers select exactly `exportColumnsOf(table).join(', ')`, and the literal pins still hold (byte-identical) | A recorded select with one extra column is flagged by the same comparison |
| T-12 | Reconciler: `exportColumnDrift` lists a live unlisted column on an `include` table, ignores `exclude` / `planned` tables, and is suppressed by `excludedColumns`; `exportColumnsMissing` lists a declared non-live column. Swapping every descriptor's `export` leaves `status`, `unclassified`, `missingDeletable`, `missingNever` and `fingerprint` unchanged | A drift-only fixture keeps `status: 'ok'` |
| T-13 | Purge blind: no non-test file under `lib/business-os/purge/` except `descriptors.ts` / `types.ts` matches `.export`, `['export']` or `export:` in code (comments stripped); non-vacuity by file name | A planted `if (d.export.kind === 'include')` in a fake `ResetService.ts` source is flagged |
| T-14 | businessOwnedTables direction 3: every `USER_OWNED_TABLES` key has a descriptor (so, through T-1, a classification). Closes FR-E18: migration → list → descriptor → `export` | Removing `intent_examples` from a copy of the descriptors is flagged |
| T-15 | Audit guard (S-1): no non-test file under `lib/business-os/data-export/` names `audit_trail` / `archived_records` or calls `auditTrailRepository` / `archiveRepository`; the scan found `sections.ts`, `payload.ts`, `classification.ts` | A planted `archiveRepository.list(…)` and a planted `'audit_trail'` in a data-export path are flagged; a comment mentioning either is not |
| T-16 | Purge unchanged: classification baseline (155, zero level changes), all existing invariant, banding and delete-graph tests green; `descriptorsForRun` output for all 16 combinations unchanged except that nothing new appears | Existing negative controls in that suite |

---

## 9. CI placement and runtime

No new workflow, job or step. Every check runs inside a job that already runs on every PR.

| Check | Where it runs | Added cost (estimate; T-11 / T-13 measure and record) |
|---|---|---|
| `exportClassification.test.ts` (T-1…T-11, T-13) | `tests.yml` Jest gate (sharded), as one more suite | One suite of pure checks over ~160 objects: ~1–3 s of ts-jest compile plus <1 s run, spread over the shards. The Jest gate runs in parallel with `next build`, so the critical path does not grow |
| businessOwnedTables direction 3, invariant baseline edits, reconciler tests, guard extension, repository read tests | Existing suites, in the Jest gate; the purge invariant, ownership, `lib/audit` and data-export route suites also run in `bos-entitlements.yml` via `test:bos-entitlements` (unchanged list) | A few more `it` blocks in already-loaded files: <1 s. The guard re-uses its existing file walk (no second walk) |
| Required `export` as a type error | Not added (SA DE-2 review, SA-Q1 declined; C-1) | 0 |
| Column drift (`exportColumnDrift`, `exportColumnsMissing`) | **Not in CI** (no DB in CI). Dev and SA run the reconcile command before each DE-3…DE-7 merge and record the result in that slice's workplan | 0 CI time |

---

## 10. Risks

| Risk | Mitigation |
|---|---|
| Editing 155 descriptor rows changes a purge `level`, `order` or `scope` by accident | The frozen baseline fails on any level change; the banding and delete-graph suites fail on order. T-16 also compares `descriptorsForRun` for all 16 combinations. Rows are edited in place, one field added |
| A file write truncates `descriptors.ts` (agent file-write hazard) | Edit tool only, no whole-file rewrite; `git diff --numstat` after T-4: deletions equal changed lines, and a deletion without an insertion is a stop |
| Merge conflict with a parallel branch that adds a descriptor (DE-8a, purge slices, any new table) | The required field makes the conflict visible: the other branch's new row fails T-1 until it is classified. Rebase on origin/main before review; note it in the handover |
| `exportColumnsOf` throws inside a widely imported repository | Resolved lazily inside the method's `try`, never at module load; T-10 |
| Descriptor-driven selects drop out of `schema:check`'s literal extractor | `exportColumnsMissing` (report-only) replaces that coverage; the literal pins in the read tests stay |
| The deny list blocks a harmless column in DE-3…DE-7 (e.g. `dedupe_key`) | A reasoned `DENY_EXCEPTIONS` entry, reviewed by SA in that slice. Failing toward "excluded" is the safe direction |
| Adding the `SchemaReconcileResult` fields changes a consumer's wire type | Fields are additive, and the admin preview payload is not changed (SA-Q3); the wireTypes test stays green |
| `intent_examples` turns out to be live with a `user_id` and cascade edges | T-2 reads it first; `never` emits no delete, and the delete-graph check already reports any unlisted cascade child |
| The type-check scope expansion (SA-Q1) brings pre-existing errors into scope | Measured in T-11; baselined with a note if they are pre-existing; the scope is dropped if SA prefers Jest-only |

---

## 11. Open questions for SA

| # | Question | Dev proposal |
|---|---|---|
| **SA-Q1** | §0.3.6 assumes `tsc` fails on a missing `export`. It does not today: Jest is transpile-only and `typecheck:bos-llm` does not scope `descriptors.ts` (§1.3). Add `lib/business-os/purge/descriptors.ts` and `lib/business-os/data-export/` to its `SCOPED_DIRS` (one-file precedent: the purge wireTypes test), or rely on the Jest runtime check alone? | Add both; T-1 is the enforcement either way. Runtime measured in T-11 |
| **SA-Q2** | Buckets: a separate `StorageExportClassification` (`include { folder }` / `exclude` / `planned 'DE-8b'`), and a separate `PLANNED_FILES_ALLOWED` that DE-8b flips (DE-7 flips the table flag first, before files exist)? | Yes to both |
| **SA-Q3** | The reconciler gets drift through pure helpers in `data-export/classification.ts`, so no purge file reads `.export` (T-13 stays strict, with no allow-listed reconciler), and drift is not added to the admin preview payload in DE-2. Agree? | Yes |
| **SA-Q4** | Where is drift surfaced? `npm run schema:check` is a different script (literal-select replay, its own client, dotenv after imports), which does not call the reconciler. Proposal: report it from `scripts/purge-schema-reconcile.ts` and add an npm alias `schema:reconcile` for it, then name that in the skill text. Or wire the reconciler into `schema:check`? | Alias + reconcile script; leave `schema:check` alone |
| **SA-Q5** | Add `exportColumnsMissing` (declared but not live), report-only, beside `exportColumnDrift`? | Yes (§2.6) |
| **SA-Q6** | Deny list: SA's `*_key` pattern also hits `plugin_key`. A `table.column → reason` exception map, checked for stale entries, and the same deny check at request time inside `exportColumnsOf` (fail closed to a `failed` section)? | Yes |
| **SA-Q7** | Readers take columns from the descriptor: the repository resolves `exportColumnsOf(table)` inside the method (precedent `TestAccountCleanupRepository`), or the section reader passes `columns` into the repository method? | Repository resolves it: the repository stays the one place that decides what is selected, and the call sites do not change |
| **SA-Q8** | One table per section in DE-2, with `NON_TABLE_SECTIONS = { account_identity }` as the only exception? | Yes; a later slice asks if it needs two tables in one section |
| **SA-Q9** | `intent_examples` has no `user_id` in its only migration, yet it is in `USER_OWNED_TABLES`. DE-2 adds the `never` descriptor (scope from the live read) and leaves the ownership entry alone (out of scope; flagged here)? | Yes |
| **SA-Q10** | The S-1 guard also refuses `archived_records` / `archiveRepository` in `lib/business-os/data-export/**` (archived owner history, same DX-1d / BD-26 reasoning)? | Yes |
| **SA-Q11** | Confirm the two **(SA)** rows in §4: `website_blocks` planned for DE-7 (page content, read via its parent), and `onboarding_prompt_ideas` excluded as assistant activity | As proposed |
| **SA-Q12** | Appendix A text adjusted as in §2.10 (points at `descriptors.ts`, names buckets, names the SA-Q4 command). OK to diverge from the requirement's Appendix A wording? | Yes; the requirement's change history records it |

---

## Dev Implementation Notes

Branch `feature/data-export-de2`, fast-forwarded to origin/main `3d4122a9` (PR #394) before the first edit (a fast-forward, so no merge commit; C-9 merge-not-rebase rule). Still level with origin/main at hand-over. Nothing committed.

### DI-1 C-3 live read: done by TL 2026-10-15 (see the C-3 block below)

This worktree has no `.env.local` and Dev has no database tool, so neither `npm run schema:reconcile` nor a SQL read was run. Nothing was written anywhere. TL: run **one** of these, read-only.

Option A (preferred: it measures the code that ships). From this worktree, with `.env.local` copied in (do not commit it): `npm run schema:reconcile`. Record `exportColumnDrift`, `exportColumnsMissing` (both must be empty), the `sha` and the Supabase host it logs.

Option B (SQL editor, read-only; avoids the word that breaks the editor):

```sql
-- (a) every live column of the two exported tables
select table_name, column_name, ordinal_position
from information_schema.columns
where table_schema = 'public' and table_name in ('profiles', 'plugin_connections')
order by table_name, ordinal_position;

-- (b) intent_examples: live, and does it have a tenancy column?
select column_name
from information_schema.columns
where table_schema = 'public' and table_name = 'intent_examples'
order by ordinal_position;

-- (c) intent_examples foreign keys (an FK to auth.users would make it a tenant table)
select conname, confrelid::regclass as references_table
from pg_constraint
where conrelid = 'public.intent_examples'::regclass and contype = 'f';
```

What the result must show (from the descriptors as built). `profiles`: exactly the 17 `columns` plus `plan` (18). `plugin_connections`: exactly the 13 `columns` plus `id`, `access_token`, `refresh_token`, `expires_at`, `last_refreshed_at`, `settings` (19). Any other live column is drift: add it to `columns` or `excludedColumns` with a reason. A listed column missing from (a) is `exportColumnsMissing`. `intent_examples`: no `user_id` / `owner_user_id` column and no FK to `users`, or its scope `global` is wrong. These expectations come from earlier measurements (DATA_EXPORT_FOLLOWUPS_WORKPLAN §4.1 / §4.5, the 2026-09-15 purge schema dump), not from today's database.

### DI-2 Measured

| Item | Result |
|---|---|
| Totals (T-5) | 155 table descriptors = 2 include + 45 planned (DE-3 4, DE-4 9, DE-5 15, DE-6 12, DE-7 5) + 108 exclude; 3 buckets = 2 planned + 1 exclude. Same as §4 |
| `descriptorsForRun`, before vs after (C-7) | Captured before T-4 and after. All 16 combinations **identical** (tables, order, level, scope, snapshot, area). Whole set: only `plugin_connections` changed (its notes, planned), plus the added `intent_examples`. Buckets: identical apart from the new field |
| `descriptors.ts` numstat (C-7) | +263 / −161. The 161 deletions are all edited lines: 154 rows (one line each, `export` added on the row's first line), 3 bucket lines, the 3 lines of the old `never()` helper, 1 `plugin_connections` notes line. No deletion without a matching insertion |
| Scoped type check | `tsc` over the changed files and everything they import (scratch tsconfig, not in CI): **0 errors** |

### DI-3 Tests and runtimes (C-8, this machine)

Jest's own per-suite times from the broad run below. All run in the existing Jest gate (`tests.yml`, parallel to `next build`); no new job, step or workflow; `test:bos-entitlements` list unchanged.

| Suite | Result | Time |
|---|---|---|
| `exportClassification.test.ts` (new) | 47 / 47 | 3.6 s |
| `descriptors.invariant.test.ts` | pass | 35.6 s (24.4 s in the bos-entitlements run), its walk-heavy scans dominate, as before |
| `SchemaReconciler.test.ts` | pass (+8 cases) | 3.9 s |
| `businessOwnedTables.test.ts` | pass (+2 cases) | 2.5 s |
| `userDataExportReads.test.ts` | pass (+6 cases) | 3.5 s |
| `ownerAuditReads.guard.test.ts` | 13 / 13 (+2 cases) | 16.4 s (11.7 s), reuses its existing file walk |
| data-export route + characterization, `sections.test.ts` | pass, literal pins unchanged | 4.3 s, 6.1 s, 2.5 s |

| Command | Result | Wall time |
|---|---|---|
| `npx jest lib/business-os lib/audit lib/repositories app/api/user/data-export` (includes the whole purge folder) | 507 / 508 suites, 14,925 / 14,955 tests, 2 failed, 28 skipped | 8 m 34 s |
| `npm run test:bos-entitlements` | 268 / 268 suites, 7,979 / 7,979 | 6 m 45 s |
| `npm run test:authz-guard` | 2 / 2 suites, 203 / 203 | 2 m 07 s |
| `eslint` on every changed file | clean | — |

The two failures in the broad run are **not DE-2's** and do not occur on CI's LF checkout. (1) `lib/business-os/finance/__tests__/finance.source.guard.test.ts` (2 tests) looks for `'\n}\n'` in source, which a CRLF Windows checkout does not have. It fails the same way when run alone, and DE-2 touches no finance file. It is the same class as PR #394. (2) `lib/business-os/catalog/__tests__/enum-drift.test.ts` failed only under the full parallel run and passed alone (its data-backed cases skip without a DB). `npm run lint` over the whole repo was not run; `eslint` over the changed files is clean.

### DI-4 Deviations from the workplan

| # | Deviation | Why |
|---|---|---|
| D-1 | `never()` takes `exportAs` as its **third** parameter, before `notes`, not the fourth | Every edit then stays on the call's first line, so the diff is one changed line per row. Several `notes` strings span lines and contain escaped quotes, which would make a trailing parameter a multi-line edit (truncation hazard, C-7) |
| D-2 | `descriptors.ts` was edited by a scratch script with line-level replacements, not by 155 Edit calls | Same file, edited in place: each replacement asserted exactly one match per row and every table in §4 was used exactly once. C-7's numstat and `descriptorsForRun` checks in DI-2 are the proof |
| D-3 | The rule functions (`tableExportProblems`, `storageExportProblems`, `sectionRegistryProblems`, `staleDenyExceptions`) are exported from `classification.ts`, not written in the test | One place for the rules; the test feeds them the real set and the planted bad inputs. `sectionRegistryProblems` takes the section ids as an argument, so `classification.ts` still imports nothing from `sections.ts` (C-2, pinned) |
| D-4 | `NON_TABLE_SECTIONS` is in `classificationTypes.ts` | Allowed by C-2; keeps it next to `ExportSectionId` |
| D-5 | SA's two wording notes taken: `security_settings` reason is "SECRET; security configuration, not in the DX-1a set (may hold second-factor material)"; `shared_agent_imports` is `AGENTS`, not `ACTOR_REF` | SA §4 spot-check, "Dev's choice" |
| D-6 | The `exclude(reason, detail?)` builder joins a table-specific detail to a shared reason with `; ` (e.g. `token_usage`: "DX-1: billing and credits are not exported; usage and our provider cost") | Keeps one named reason per group and the table's specific fact |
| D-7 | `AdminDeletionCommit.test.ts`'s schema fixture was not given the two new fields | It is an untyped mock return, not a `SchemaReconcileResult`; nothing reads the fields on that path |

### DI-5 Items for SA code review

1. C-3 closed by the TL live read (drift 0, missing 0).
2. `exportColumnsOf` runs per request inside the two repository methods (a `find` over 155 rows plus a regex per column). That is negligible next to the query, but it is a new import from `lib/repositories/` into `lib/business-os/data-export/` (precedent: `TestAccountCleanupRepository` imports `STORAGE_DESCRIPTORS`).
3. The deny patterns are applied to `include.columns` only, never to `excludedColumns` (excluding a secret is the point). `cost_usd$` also catches `total_cost_usd`, which the old read test listed.
4. `exportColumnDrift` is computed for `include` tables only, as ruled. The admin preview wire payload is unchanged (SA-Q3); the two fields reach only the reconciler's result, its log line (counts only) and the script.
5. D-1 (parameter position) is the only deviation from the approved shape.

---

## SA Review Notes

_SA populates this section._

### SA workplan review DE-2 — 2026-10-15

**Reviewed by SA — 2026-10-15**, against `feature/data-export-de2` (origin/main `a772e4ae`, workplan uncommitted).
**Status:** ✅ **Approved with conditions** (C-1…C-9 below). Dev may start T-0.

#### User decisions recorded (via TL, 2026-10-15)

| # | Decision | Effect |
|---|---|---|
| **BC-1** | **No.** The download does not list which Business OS modules the owner switched on | `user_capabilities` and `user_capability_blocks` are `exclude`. Drop the **(BC)** marks; reason text: "PLATFORM: module setup, not data the owner entered (user 2026-10-15)" |
| **BC-2** | **No.** The download does not include the organisation / team-membership record | `organizations` and `organization_members` are `exclude`. Drop the **(BC)** marks; reason text: "PLATFORM: agent-platform organisation record (user 2026-10-15)" |

Both go into the requirement's §0 status and Change History in T-14 (standing rule: every slice stage goes into the main requirement).

#### Finding §1.3: confirmed, and §0.3.6 is corrected

SA's §0.3.6 sentence "a descriptor without `export` fails `tsc`, the existing type-check job" was **wrong**. Jest is transpile-only, `next build` ignores type errors, and `typecheck:bos-llm` does not scope `descriptors.ts`. **The enforcement is the runtime Jest check T-1.** The required TS field stays: it gives editor feedback and documents the shape, but it is not the gate. Dev records this correction in the requirement's §0 DE-2 status line ("§0.3.6 tsc clause superseded by SA DE-2 review: T-1 Jest runtime check is the enforcement").

#### Rulings on SA-Q1…SA-Q12

| # | Ruling |
|---|---|
| **SA-Q1** | **Declined. Do not widen `SCOPED_DIRS`; T-11 is dropped.** SA measured it on this worktree (temporary copy of the script, deleted after; same machine, same run): today's scope 532 files, **251.8 s** of check; with `purge/descriptors.ts` + `data-export/` added, 554 files, **407.3 s** (+22 files, about +62%). Local timings are noisy (the BOS-LLM tests workplan §3.3 already found them unusable as absolutes), but the direction is clear: the added callers (the purge services, their tests, the route, and, after T-6, both repositories) are not "a few seconds of diagnostics". The job is **required**, its paired headroom against Build is about 62 s at the median and already **near zero or negative on a fast Build** (BOS_LLM_TESTS_IN_CI_WORKPLAN §3.2, one run in five). An unbounded +25 s-class addition there breaks the no-added-CI-time rule. T-1 already enforces the field at no critical-path cost, so the type gate buys nothing that is missing. If a type gate on the descriptors is ever wanted, it needs a paired per-SHA CI measurement first (the BOS-LLM tests precedent), as its own slice |
| **SA-Q2** | **Yes to both.** Separate `StorageExportClassification` and a separate `PLANNED_FILES_ALLOWED` that DE-8b flips |
| **SA-Q3** | **Yes.** Pure helpers in `data-export/classification.ts`; no purge file reads `.export`; no change to the admin preview wire payload; fingerprint stays `(table, level)` |
| **SA-Q4** | **Yes.** Report from `scripts/purge-schema-reconcile.ts` with an npm alias `schema:reconcile`; leave `schema:check` alone. This supersedes "surfaced by `npm run schema:check`" in §0.3.6 and FR-E19; record it in T-14. The skill text names `npm run schema:reconcile` |
| **SA-Q5** | **Yes.** `exportColumnsMissing` report-only, beside `exportColumnDrift`. It replaces the literal-select coverage that `schema:check` loses (C-6) |
| **SA-Q6** | **Yes.** `DENY_EXCEPTIONS` as `'table.column' → reason`, stale-entry check, and the same deny check at request time in `exportColumnsOf` (fail closed to a `failed` section). One entry in DE-2 (`plugin_connections.plugin_key`). Every later exception is an SA review item in its slice |
| **SA-Q7** | **Repository resolves it**, inside the method's `try`, as proposed. Condition C-2 (no import cycle) applies |
| **SA-Q8** | **Yes.** One table per section, `NON_TABLE_SECTIONS = { account_identity }` the only exception. A slice needing two tables in one section asks SA |
| **SA-Q9** | **Yes.** `never` descriptor, scope from the live read (`global` if it has no `user_id`, which the only migration says). Leave the `USER_OWNED_TABLES` entry alone in DE-2 and record it as a follow-up in the requirement ("`intent_examples` is listed user-owned but has no `user_id`; decide in the next ownership pass") |
| **SA-Q10** | **Yes.** Refuse `archived_records` / `archiveRepository` too in `lib/business-os/data-export/**` |
| **SA-Q11** | **Confirmed both.** `website_blocks` → `planned` DE-7: it is the page content, so DE-7 must read it **through an owner-scoped parent** (`website_pages` rows already filtered by `user_id`; never by a caller-supplied page id alone, `tenant-isolation-guard`). `onboarding_prompt_ideas` → `exclude` `ACTIVITY` |
| **SA-Q12** | **Yes.** Diverge from Appendix A as in §2.10 (points at `descriptors.ts`, names buckets, names `npm run schema:reconcile`); record the divergence in the requirement's Change History |

#### §4 classification spot-check

SA compared every `table:` / `never('…')` name in `descriptors.ts` (154) with the names in §4: **all 154 are classified, none twice, no extra table names** (the only §4 names not in descriptors are `intent_examples`, which DE-2 adds, and column / section names). Totals 2 include + 45 planned + 108 exclude = 155 add up (planned: DE-3 4, DE-4 9, DE-5 15, DE-6 12, DE-7 5).

Against §0.2 / §0.3.1 / §0.4: **no misclassification found.**

| Check | Result |
|---|---|
| Profile only, no credits / billing / plan | ✅ `profiles` without `plan`; every `business_os_credit_*`, `business_os_billing_*`, `business_os_account_plans`, `business_os_invites`, `user_subscriptions`, `credit_transactions`, `token_usage`, boosts, entitlement overrides `exclude` |
| Client records in (B1–B4) | ✅ planned DE-4 / DE-5 / DE-6, incl. consent tables, `email_sequence_enrollments`, `external_calendar_events` (SQ-E7 in) |
| Content in | ✅ `website_pages`, `website_content`, `smart_links`, `user_media`, `website_blocks` → DE-7; buckets → DE-8b |
| Activity out | ✅ `email_sends`, assistant chats, briefings (+ sends), insights, `channel_connections` / `channel_metrics_daily`, visitor tracking (`website_page_views`, `smart_link_clicks`) |
| Agents out (BQ-SA-1) | ✅ `agents`, `agent_configurations` with the literal user reason; the rest of the agent platform `exclude` |
| Audit / archive out | ✅ `audit_trail`, `archived_records`, `audit_logs` |

Two low-priority wording notes (not misclassifications): `security_settings` is better reasoned "security configuration; not in the DX-1a set (may hold second-factor material)" than a bare `SECRET`; `shared_agent_imports` reads more naturally as `AGENTS` than `ACTOR_REF`. Dev's choice.

#### Conditions

| # | Condition |
|---|---|
| **C-1** | SA-Q1 declined: T-11 and the `scripts/typecheck-bos-llm.ts` row in §6 are removed. §9's third row reads "not added (SA DE-2 review)". No change to any workflow file |
| **C-2** | **No import cycle.** `sections.ts` imports the repositories, and the repositories will import `classification.ts`. So `classification.ts` imports **only** `descriptors.ts` and `classificationTypes.ts`, never `sections.ts`. The T-6 registry check (which needs `EXPORT_SECTIONS`) lives in the test file, and `NON_TABLE_SECTIONS` lives in the test or in `classificationTypes.ts`. Add one guard assertion in `exportClassification.test.ts`: `classification.ts`'s source imports nothing from `sections` / `@/lib/repositories` |
| **C-3** | T-2 live read is done **before code review**, and the measured `excludedColumns` for `profiles` and `plugin_connections` are recorded here with the git SHA. T-9's `exportColumnDrift = 0` and `exportColumnsMissing = 0` for both tables is a code-review entry condition. If the worktree has no env, TL asks the user to run `npm run schema:reconcile` (read-only) |
| **C-4** | `plugin_connections.profile_data` (jsonb) is in `columns` but the deny list cannot see inside it. Its descriptor note must name the allow-list (`ACCOUNT_PROFILE_KEYS`) as the control, and T-9 asserts the note is present. No new behaviour |
| **C-5** | T-13's matcher must not flag ordinary `export const` / `export function` / `export type` in purge files: match property access (`.export`, `['export']`) and an object key `export:` only, comments and strings stripped; its negative controls include a plain `export const X` that is **not** flagged |
| **C-6** | The literal select pins in `userDataExportReads.test.ts` and the route characterization test **stay literal** (byte-identical), plus the new equality with `exportColumnsOf(...)`. Removing a literal pin is not allowed in DE-2 |
| **C-7** | T-4 truncation discipline as written: Edit in place, then `git diff --numstat` on `descriptors.ts`; deletions only on edited lines. Also re-run T-16's `descriptorsForRun` comparison against a capture taken **before** T-4 (record both) |
| **C-8** | Runtime: record in T-13 the wall time of `exportClassification.test.ts` and the changed suites. All of them run in the Jest gate (`tests.yml`), parallel to `next build`; no new job, step or workflow. `test:bos-entitlements` list unchanged |
| **C-9** | T-14 records in the requirement: BC-1 / BC-2 user decisions, the §0.3.6 tsc correction, the SA-Q4 command change, the SA-Q9 follow-up and the Appendix A divergence. Rebase on origin/main before code review (a parallel branch adding a descriptor will now fail T-1 until classified; that is intended) |

#### Approval

[x] Workplan approved, proceed to implementation under C-1…C-9

---

## QA Testing Report

_QA populates this section._

### QA — DE-2 — 2026-10-15

**Test mode:** full
**Strategy used:** A (Jest unit / source guards) + C (scratch scripts: `descriptorsForRun` and fingerprint dumps, origin/main vs DE-2) + planted negative controls. Pure classification code with no UI and no DB writes, so unit tests and scripts cover it.
**Focus:** schema, security, pipeline-adjacent purge invariants, performance (C-8)
**Skipped:** E2E / manual browser check. DE-2 changes no UI. Live DB: not re-run by QA (no DB tool in this session). The TL C-3 read above was used, and its column lists were fed offline through `exportColumnDrift` / `exportColumnsMissing`: drift [], missing [].
**Input source:** prompt (TL trigger) + workplan §8 / SA conditions

**How it was run.** All negative controls were planted in a **scratch copy** of the worktree (`scratchpad/de2qa/neg`, a `node_modules` junction, never deleted recursively). None was planted in `neuronforge-de2`. Each plant was restored, and the restore checked byte-identical by md5 against the worktree file. For the baseline, origin/main `3d4122a9` was exported with `git archive` to `scratchpad/de2qa/base`. No stash, no commit. Worktree check after the run: `git diff --numstat` is identical to before QA. All QA-tracked file md5s match except `docs/requirements/BUSINESS_OS_DATA_EXPORT_REQUIREMENT.md`, which was rewritten at 12:29 by the parallel SA pass (same numstat), not by QA.

#### Test Coverage

| Acceptance criterion / test | Tested? | Result | Notes |
|---|---|---|---|
| T-1 every descriptor has `export` (CI enforcement) | ✅ | Pass | NC (a): `export` removed from `crm_tasks` → `crm_tasks: no export classification`. NC (b): a new `qa_new_table` row without `export` → `qa_new_table: no export classification`. Each makes 4 tests red (T-1, and T-4 / T-7, which hit `d.export.kind` on undefined) |
| T-2…T-5 reason, column shape, deny list, `excludedColumns` | ✅ | Pass | NC (c) in descriptors.ts: `access_token` on `plugin_connections` → deny + "both included and excluded" (5 tests red, incl. T-9). `stripe_secret` (`*_secret`) and `signing_key` (`*_key`, not `plugin_key`) on `profiles` → deny (4 red each) |
| Request-time deny (fail closed, FR-E12) | ✅ | Pass | Same three plants through a scratch test that runs the real `runExportSections` and the real repositories over a recording Supabase mock. The planted table's section is `failed`, **no `from()` / `select` is issued for that table at all**, and the other sections stay `ok`. Unplanted baseline: all three `ok`, selects identical to the DE-1 literals |
| T-6 section registry ↔ descriptors | ✅ | Pass | Suite negative controls |
| T-7 `planned` expiry flags | ✅ | Pass | Suite negative controls |
| T-8 / T-9 ruled pins, BC-1 / BC-2 reasons, tokens excluded, C-4 note | ✅ | Pass | |
| T-10 / T-11 `exportColumnsOf` fails closed; readers select exactly the descriptor columns; literal pins (C-6) | ✅ | Pass | `route.characterization.test.ts` and the route are **unchanged vs origin/main** (`git diff --quiet origin/main -- app/api/user/data-export`) and green |
| T-12 reconciler drift report-only | ✅ | Pass | Suite green. Offline, TL's live column list → drift 0 / missing 0. A planted `profiles.qa_new` is reported, and a column on an `exclude` table is ignored |
| T-13 purge blind to `.export` (C-5) | ✅ | Pass | NC (f): `d.export.kind` and `d['export']` planted in `ResetService.ts` → flagged. A plain `export const` / `export function` (and a string `'export: x'`) → **not** flagged |
| T-14 direction 3 (USER_OWNED → descriptor) | ✅ | Pass | NC (d): `qa_owned_table` added to `USER_OWNED_TABLES` → `businessOwnedTables` direction-3 test red |
| T-15 audit guard over `lib/business-os/data-export/**` (S-1, SA-Q10) | ✅ | Pass | NC (e): a new file with `from('audit_trail')` → red (2 tests: the BD-26 allow-list and the module scan). `archiveRepository.listArchived` appended to `payload.ts` → red. `'archived_records'` in a **subfolder** `data-export/sub/qa.ts` → red (the walk is recursive). A comment-only mention → green |
| C-2 no import cycle | ✅ | Pass, with SA's Low gap confirmed | NC (g): `import { EXPORT_SECTIONS } from '…/sections'` in `classification.ts` → red. A bare `import 'server-only';` → **not** caught (3/3 green), as SA code-review comment 2 says |
| T-16 / step 4: purge unchanged | ✅ | Pass | QA's own dump (scratch tsx, origin/main export vs DE-2): `descriptorsForRun` for all 16 combinations has identical tables, order, level, scope, snapshot and area. The only difference is the `plugin_connections` `notes` text (in the 8 integrations-on combos). `STORAGE_DESCRIPTORS` is identical without `export`. 154 → 155: the one addition is `intent_examples` (`never`, `global`, order 300, `ids`). Table order is identical. Purge folder 16/16 suites, 364/364 tests |
| C-8 no added CI time | ✅ | Pass | `git status` / `git diff origin/main -- .github` is empty: no new workflow, job or step. The `test:bos-entitlements` list is unchanged. The new suite is collected by the existing `tests.yml` gate (`jest.gate.config.js` spreads `jest.config.js`, and the suite is not quarantined) |
| Entitlements registration | ✅ | Pass | The diff imports nothing from `entitlements/`; `npm run test:bos-entitlements` was run anyway: 268/268 |
| Manual browser check | n/a | — | No UI change. Confirmed: no file under `app/` other than tests, and no `components/` file, is touched |

#### Issues Found

**Bugs (must fix before commit):** none.

**Performance issues:** none. Each test in the new suite takes ≤ 25 ms. The suite's wall time is all ts-jest transform plus loading `descriptors.ts` (see runtimes).

**Edge cases (nice to fix / note):**
1. **The schema fingerprint changes vs main. This is expected, but §2.5 implies it does not.** `intent_examples` adds one `(table, level)` pair. With the same synthetic snapshot, `computeSchemaFingerprint` gives `d1e0a87b…` on origin/main and `ab086d41…` on DE-2. DE-2 minus `intent_examples` gives `d1e0a87b…` again, so the change comes from the one new descriptor, not from `export` (T-12 still holds). Effect: an AD-2 admin-delete preview token issued before the deploy is refused at commit after it, and the admin previews again. That is fail-closed and harmless. But SA's QA focus line, "same `schemaFingerprint` as on main", will **not** hold on a live preview. Note it in the handover. Low, docs only.
2. SA comment 2 confirmed: the C-2 import regex misses a bare side-effect `import '…';`. It also misses `require()` and dynamic `import()`. Low.
3. T-13 reads `lib/business-os/purge/` **non-recursively**. A future `purge/<sub>/` file that reads `.export` would not be scanned. Low.
4. The deny list matches suffixes only. Names like `encrypted_password`, `secret_value`, `token_encrypted` or `apikey` would pass it. Mitigated by explicit include lists plus review. Low.
5. The skill text says "an unclassified new table fails CI". That is true only through the migration → ownership-list → descriptor chain, i.e. a `CREATE TABLE … user_id`. A new tenant table keyed some other way is caught only by the live `schema:reconcile` (`unclassified`). This is a pre-existing design limit, not a DE-2 regression. Low.

#### Test Outputs / Runtimes (this machine; under load from a parallel SA pass, so the times are noisy)

| Run | Result | Time |
|---|---|---|
| New suite `exportClassification.test.ts` alone | 47 / 47 | 18.7 s – 33.7 s suite (cold / loaded); each test ≤ 25 ms |
| 9 new / edited suites (data-export ×2, SchemaReconciler, descriptors.invariant, businessOwnedTables, userDataExportReads, ownerAuditReads.guard, route, route.characterization) | 9 / 9 suites, 245 / 245 | 63.4 s Jest, 95 s wall |
| `npx jest lib/business-os/purge` | 16 / 16, 364 / 364 | 73 s Jest, 94 s wall |
| `npm run test:bos-entitlements` | 268 / 268, 7,979 / 7,979 | 304.7 s Jest, 322 s wall |
| `npm run test:authz-guard` | 2 / 2, 203 / 203 | 107.4 s Jest, 134 s wall |
| Full `npx jest --ci` | 1,356 passed / 23 failed / 8 skipped suites (1,387). Tests: 33,772 passed / 137 failed / 65 skipped | 1,623.6 s Jest, 1,667 s wall |

The 23 failed suites, compared with origin/main `3d4122a9`:
- 11 are in `.github/ci/jest-quarantine.json` (agentkit v4 / v6, pilot, orchestration).
- 7 timed out under full-run load. They **pass alone on both** origin/main and DE-2: `jobsQueues.drain.render`, `jobsQueues.items.render`, `analytics.table.render`, `archiving/page.render`, `auditTrail.table.render`, `AdminAreaField.search`, `stripePlanPriceScripts`.
- 5 fail deterministically, **identically on origin/main** (same 8 failing tests, 1,036 passing): `finance.source.guard` (CRLF), `oneAddressPolicy.guard`, `publicEndpointsAreThrottled.guard`, `bookingsSearchAndPaging.guard`, `supabaseFetch`. All are Windows-checkout or pre-existing; DE-2 touches none of their files.

**New failures caused by DE-2: 0.**

#### Final Status
- [x] All acceptance criteria pass — ready for commit (once SA's two Low doc / guard comments are handled as SA decides; neither blocks)
- [ ] Issues found — Dev must address before commit

---

## Commit Info

_RM populates this section._

---

## Change History

| Date | Change | Details |
|---|---|---|
| 2026-10-15 | Created (Dev, workplan only) | On `feature/data-export-de2` from origin/main `a772e4ae`. Classification of all 154 + 1 descriptors and 3 buckets, value set, tests T-1…T-16 with negative controls, CI placement. Finding §1.3: Jest is transpile-only and no type gate covers the descriptors, so the runtime Jest check is the enforcement (SA-Q1). Two business calls (BC-1 modules switched on, BC-2 organisation record). SA-Q1…SA-Q12 |
| 2026-10-15 | SA workplan review | Approved with conditions C-1…C-9. SA-Q1 declined (measured +22 files, 252 s → 407 s locally on a required job with thin headroom); T-1 Jest check is the enforcement. SA-Q2…Q12 as proposed (Q4: `schema:reconcile`). §4 spot-check: all 154 classified, no misclassification. User decisions BC-1 = No, BC-2 = No recorded |
| 2026-10-15 | Code complete (Dev) | All tasks done except the C-3 live read (no env / DB tool in the worktree; SQL in DI-1 for TL). T-11 dropped (C-1). 155 + 3 descriptors classified, `descriptorsForRun` identical for all 16 combinations, `descriptors.ts` +263 / −161 with no unplanned deletion. New suite 47 tests, 3.6 s; `test:bos-entitlements` 268/268, `test:authz-guard` 203/203. Deviations D-1…D-7. Requirement §0.6 + Change History written (C-9). Uncommitted |

**C-3 live read — 2026-10-15 (TL, read-only, Supabase MCP, prod `jgccgkyhpwirgknnceoh`, information_schema + pg_constraint only).**
| Table | Live columns | Declared include + excluded | Drift | Missing |
|---|---|---|---|---|
| `profiles` | 18: id, full_name, avatar_url, plan, company, job_title, timezone, language, created_at, updated_at, role, domain, onboarding, onboarding_goal, onboarding_mode, onboarding_data, hourly_rate_usd, org_id | 17 include + `plan` excluded = 18 | 0 | 0 |
| `plugin_connections` | 19: id, user_id, plugin_key, plugin_name, access_token, refresh_token, expires_at, scope, username, email, profile_data, settings, status, last_used, connected_at, created_at, updated_at, disconnected_at, last_refreshed_at | 13 include + 6 excluded = 19 | 0 | 0 |
| `intent_examples` | 18 columns; no `user_id` / `owner_user_id`; **no foreign keys** | `never`, scope global | — | — |

C-3 entry condition **met**: drift = 0 and missing = 0 on both tables; `intent_examples` global scope confirmed. T-2 and T-9 live read done.

### SA code review DE-2 — 2026-10-15

**Code Review by SA — 2026-10-15**, uncommitted diff on `feature/data-export-de2` (level with origin/main `3d4122a9`), 19 modified + 4 new files.
**Status:** ✅ **Code Approved for QA** (two Low doc fixes below, not blocking).

#### How it was checked

| Check | Result |
|---|---|
| `descriptors.ts` +263 / −161, truncation (C-7) | SA loaded HEAD and working-tree `descriptors.ts` (transpiled, side by side) and compared every descriptor with `export` removed: 154 old rows all present, **same list order**, the only field change is the `plugin_connections` `notes` append; `intent_examples` is the one addition (`never`, `global`, LEAF, `ids`). The other exports (`BLOCKING_EDGES`, `CASCADE_COUNT_EXEMPT`, `NOT_NULL_OVERWRITE_EDGES`, `REVIEWED_DELETE_TRIGGERS`) are identical. `STORAGE_DESCRIPTORS` identical apart from `export`. `descriptorsForRun` for all 16 combinations: identical except the 8 with `integrations` on, whose only difference is that `notes` text. No deletion without a matched edit; line endings consistent (CRLF throughout, autocrlf) |
| Suites (SA re-run) | `exportClassification`, `sections`, `userDataExportReads`, `SchemaReconciler`, `businessOwnedTables`, `ownerAuditReads.guard`, `descriptors.invariant`, `adminDeletionPreview.wireTypes`, data-export `route` + `route.characterization`: **10/10 suites, 246/246** |
| Logging | No `console.*` in any touched file |
| Entitlements | No import from `lib/business-os/entitlements/` |

#### Conditions C-1…C-9

| # | Verdict |
|---|---|
| C-1 | ✅ `scripts/typecheck-bos-llm.ts` and workflows untouched; §9 row reads "not added" |
| C-2 | ✅ `classification.ts` imports only `purge/descriptors`, `purge/types` (type) and `classificationTypes` (type); `classificationTypes.ts` imports nothing; `descriptors.ts` and `types.ts` import the types file type-only. The chain repo → classification → descriptors has no way back (descriptors imports no runtime module). `SchemaReconciler` → classification → descriptors is also acyclic. Pinned by the C-2 test |
| C-3 | ✅ Met by the TL live read above (prod; profiles 18 = 17 + `plan`; plugin_connections 19 = 13 + 6; drift 0, missing 0; `intent_examples` no `user_id`, no FKs → `global` correct) |
| C-4 | ✅ `plugin_connections` notes and the `PLUGIN_CONNECTIONS_EXPORT` comment name `ACCOUNT_PROFILE_KEYS`; T-9 asserts it |
| C-5 | ✅ T-13 matches `.export`, `['export']` and an `export:` key on comment- and string-stripped source; negative controls prove `export const / function / type / { a }`, comments, strings and `exportColumnDrift` are not flagged. `SchemaReconciler.ts` (which now reads `result.exportColumnDrift`) passes |
| C-6 | ✅ Literal pins byte-identical: `route.characterization.test.ts` unchanged (both strings present), `userDataExportReads.test.ts` keeps the plugin_connections literal and gains a profiles literal, plus the `exportColumnsOf(table).join(', ')` equality per read |
| C-7 | ✅ See above (SA's own semantic comparison, independent of Dev's capture) |
| C-8 | ✅ Runtimes recorded in DI-3; everything in existing Jest suites, no new job / step / workflow, `test:bos-entitlements` list unchanged |
| C-9 | ✅ Requirement §0.6 + Change History record BC-1 / BC-2, the tsc correction, SA-Q4 command, SA-Q9 follow-up, Appendix A divergence. Branch is level with origin/main |

#### Rulings on Dev's DI-5 items

| # | Ruling |
|---|---|
| 1 | Closed by the TL C-3 read |
| 2 | **Accepted.** Repositories importing the pure `classification.ts` is the SA-Q7 decision; resolved inside the `try`, so a bad descriptor is `{ data: null, error }` (tested for both reads, with no query issued) and module load can never fail. Cost per request is a `find` over 155 rows: negligible. Side effect noted, not blocking: every importer of `UserProfileRepository` now loads `descriptors.ts` (static data, server-only path) |
| 3 | **Accepted.** The deny list runs over `include.columns` only; applying it to `excludedColumns` would forbid the point of excluding a secret. `cost_usd$` catching `total_cost_usd` is the intended direction (fail toward excluded); a later slice that wants it asks for a `DENY_EXCEPTIONS` entry, reviewed by SA |
| 4 | **Accepted.** `AdminDeletionPreview` builds its wire `schema` object field by field (`status`, `unclassified`, `missingDeletable`, `missingNever`, `fingerprint`), and `adminDeletionFacts` does the same for its log, so the two new fields never reach the wire; the wireTypes test is green. Fingerprint code is untouched |
| 5 | **D-1…D-7 accepted.** D-1 (third parameter) keeps one changed line per row, which is what made C-7 checkable. D-2 (scripted line replacement) is acceptable because the semantic comparison above proves the result. D-7: the `AdminDeletionCommit.test.ts` mock is untyped and nothing on that path reads the fields |

#### Code Review Comments

1. `docs/workplans/BUSINESS_OS_DATA_EXPORT_DE2_WORKPLAN.md` header Status and DI-1 still say C-3 is open; and requirement §0.6 status line says "awaiting the C-3 live read (TL), then SA code review". Update both to "C-3 met (TL, 2026-10-15), SA code approved" — Priority: Low (docs only; do it before RM commits)
2. `exportClassification.test.ts` C-2 guard: the import regex `^import[\s\S]*?from …` does not see a bare side-effect import (`import 'server-only';` has no `from`, so the lazy match runs on to the next import's module). A `server-only` import added to `classification.ts` would therefore pass the `server-only` filter. The set-equality assertion still catches any new *named* import. Optional hardening: also match `^import\s+['"]([^'"]+)['"]` and `require(` — Priority: Low

#### Optimisation Suggestions

- The `planned` flags live in the test file; when DE-7 flips `PLANNED_TABLES_ALLOWED`, the reviewer should check the flip is the only change to that test's T-7 block.
- The pre-existing failures DI-3 names are not DE-2's: `finance.source.guard.test.ts` searches for `'\n}\n'` and fails on a CRLF Windows checkout only (same class as PR #394; CI checks out LF), and `catalog/__tests__/enum-drift.test.ts` fails only under the full parallel run and passes alone. Neither file is touched by DE-2.

#### Code Approved for QA: **Yes**

QA focus: T-1…T-16 negative controls fire; export file byte-identical to DE-1 for a real account (same two sections, same columns, `plan` and tokens absent); a Reset / Purge preview on a test account shows the same counts and the same `schemaFingerprint` as on main.
