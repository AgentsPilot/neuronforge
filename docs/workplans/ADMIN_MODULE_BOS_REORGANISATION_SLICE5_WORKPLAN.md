# Workplan: Admin Module BOS Reorganisation, Slice 5 (Scheduled jobs & queues, Health fixes, AgentsPilot cron retirement)

> **Last Updated**: 2026-09-27

**Developer:** Dev
**Requirement:** [ADMIN_MODULE_BOS_REORGANISATION_REQUIREMENT.md](/docs/requirements/ADMIN_MODULE_BOS_REORGANISATION_REQUIREMENT.md) §7 Slice 5 (S5.1 to S5.14, parts A to E), §9, §11 (OQ-6 to OQ-9 answered 2026-09-27)
**Branch:** `feature/admin-bos-jobs-queues` (worktree `neuronforge-admin-bos-reorg`, cut from `main` @ `546f6110`)
**Process:** full cycle. The slice adds a production migration, a new `/api/admin/*` route, new cross-account reads and changes to twelve production cron routes. Order: Dev workplan → **SA workplan review (including the C-10 re-ruling, §8.1)** → user answers (§13) → Dev implements → SA code review → QA → user reviews the diff → user approval → RM.
**Standing user rule:** **nothing is committed**, now or during implementation. Every change stays uncommitted in the worktree until the user has reviewed the code. The requirement's uncommitted edits in this worktree are left as they are.
**Status:** ✅ **PR-1 merged (PR #122) and PR-2 merged (PR #123, `03f5402f`), 2026-09-27.** Migration `20261011_bos_cron_runs` applied in production and verified (L-5.7). L-5.1 to L-5.7 and L-5.11 recorded. **Still owed:** L-5.8 (+2 h: 9 jobs; the next day after 09:00 UTC: all 12), L-5.9, L-5.12, M-3 to M-7, and L-5.10 (Offir; no longer a gate). See [§20](#20-post-merge-record-and-follow-ups).

## Overview

Slice 5 makes the two "Not measured yet" Health tiles real. Today no Business OS cron records its runs anywhere a page can read, so a job that has stopped and a job with nothing to do look the same. This slice:
- **A.** retires the three AgentsPilot cron schedules (`vercel.json` 15 → 12). No code is deleted;
- **B.** adds a small run record (one hand-applied production migration) and one shared recording step that all 12 Business OS crons use;
- **C.** adds a read-only page, **Scheduled jobs & queues**, under Monitor. It covers the 12 jobs and the five §8.1 queues;
- **D.** turns Health tiles 6 and 7 into measured tiles with ordered rules, computed by the same code as the page;
- **E.** fixes Health: green for "measured, exact and clear" (a re-ruling of slice 4's C-10), a clearer entitlements tile, and docs that now say production runs entitlements in **shadow** mode on purpose.

This document records what was verified in the code, the design of each part, the migration and its runbook, the live checks the user owes, the forks SA must rule on, the tests and the task list.

---

## Table of Contents

1. [Verification Log](#1-verification-log)
2. [Analysis Summary](#2-analysis-summary)
3. [Delivery and Deployment Order](#3-delivery-and-deployment-order)
4. [Part A: Retire the AgentsPilot Crons](#4-part-a-retire-the-agentspilot-crons)
5. [Part B: The Run Record](#5-part-b-the-run-record)
6. [Part C: The Page, Its Route and the Queue Reads](#6-part-c-the-page-its-route-and-the-queue-reads)
7. [Part D: Health Tiles 6 and 7](#7-part-d-health-tiles-6-and-7)
8. [Part E: Health Fixes](#8-part-e-health-fixes)
9. [Files to Create / Modify](#9-files-to-create--modify)
10. [Live Checks Owed by the User (read-only SQL)](#10-live-checks-owed-by-the-user-read-only-sql)
11. [Technical Forks for SA](#11-technical-forks-for-sa)
12. [Risks](#12-risks)
13. [Business Questions for the User](#13-business-questions-for-the-user)
14. [Test Plan](#14-test-plan)
15. [Non-Compliant Files and Flags](#15-non-compliant-files-and-flags)
16. [Task List](#16-task-list)
17. [Implementation Record: PR-1 (Dev, 2026-09-27)](#17-implementation-record-pr-1-dev-2026-09-27)
18. [Deferred CLAUDE.md Updates](#18-deferred-claudemd-updates)
19. [Implementation Record: PR-2 (Dev, 2026-09-27)](#19-implementation-record-pr-2-dev-2026-09-27)
20. [SA Review Notes](#sa-review-notes)
21. [QA Testing Report](#qa-testing-report)
22. [Commit Info](#commit-info)
23. [Change History](#change-history)

---

## 1. Verification Log

Measured on `feature/admin-bos-jobs-queues` @ `546f6110`. **No production query was run by Dev.** Anything that depends on the live database is a check owed by the user (§10).

| # | Finding | Evidence | Effect on the plan |
|---|---|---|---|
| V-1 | `vercel.json` has 15 crons: 3 AgentsPilot (`/api/run-scheduled-agents` `*/5 * * * *`, `/api/cron/update-template-scores` `0 3 * * *`, `/api/cron/memory-consolidation` `0 4 * * 0`) and 12 Business OS, as listed in the requirement | `vercel.json` | Part A removes exactly those three entries |
| V-2 | **Ten of the 12 BOS routes check auth with a `verifyCronSecret(request)` boolean that returns `true` in `NODE_ENV=development` and otherwise fails closed.** `calendar-sync` and `channel-metrics-sync` check inline and only `if (CRON_SECRET && …)`, so they run unauthenticated when the secret is missing (R-19) | `app/api/cron/*/route.ts`; e.g. `lead-response/route.ts:32-46`, `calendar-sync/route.ts:25-44` | The recording step must **not** trust the routes' own checks to decide whether to write (FR-R3). It applies its own strict test (§5.4, F-3) |
| V-3 | Every one of the 12 routes returns a `NextResponse.json` whose body carries its counts. Shapes differ: flat (`lead-response`: `reaped, enqueued, claimed, sent, skipped`), nested under `data` (`insight-detect`: `data.usersProcessed … data.usersRemaining`), doubly nested (`payment-reminders`: `data.reminders.failed`, `data.overdue.remindersScheduled`) | route bodies, service result types (`DispatchResult`, `DrainResult`, `DispatchSummary`, `IntakeReminderResult`, `processDueReminders`, `processDueRetries`) | Counts can be taken from the response body with a per-job allow-list of numeric paths, so **the job bodies need no edit** (F-4) |
| V-4 | One response carries a money figure: `insight-automations` → `data.totalValueImpact` | `insight-automations/route.ts:86-121` | Excluded from the allow-list. A test pins that no money path is recorded (NFR Money) |
| V-5 | `maxDuration` is exported by 7 routes (60 s: `insight-actions`, `payment-reminders`, `intake-reminders`, `payment-retry`, `daily-briefing`, `lead-response`; 300 s: `insight-detect`). Five export none: `calendar-sync`, `insight-metrics`, `insight-automations`, `channel-metrics-sync`, `abandoned-proposal-invoices` | `grep maxDuration` | "Did not finish" needs a time limit per job. The five without one use an assumed 300 s, recorded as a live check (L-5.10) and fork F-9 |
| V-6 | Five routes also export a `POST` that returns 405 outside development and otherwise calls `GET(request)` | `insight-metrics`, `insight-detect`, `insight-automations`, `payment-reminders`, `payment-retry` | Wrapping `GET` keeps these working unchanged |
| V-7 | All 12 routes already log with Pino. **0 `console.*`** in any file this slice touches | `grep -c console.` over every touched file (§15) | No Pino conversion needed (requirement A-12 holds) |
| V-8 | **Four routes query `supabaseServer` directly** (deprecated pattern): `insight-detect` (12), `insight-metrics` (3), `abandoned-proposal-invoices` (3), `insight-automations` (2) | `grep supabaseServer app/api/cron/*/route.ts` | Flagged, not fixed (§15). This slice only renames their `GET` |
| V-9 | **The five queue tables and their vocabularies** (read from the migration bodies, not filenames): | | |
| | `payment_reminders`: statuses `pending / processing / sent / failed / cancelled`, **no CHECK** on `status`; has `scheduled_at NOT NULL`, `claimed_at`, `attempts`, `next_attempt_at`, `error_message`, `sent_at`, `created_at`; **no `updated_at`**. Dead-letter = `failed` + `error_message = 'dead-letter: max attempts'` | `20260723_enhance_payments.sql:293-316`; `2026-08-14_payment_reminders_claim.sql`; `PaymentReminderRepository.ts:8-9` | |
| | `payment_automation_executions`: `pending / running / completed / failed / cancelled / dead_letter`, **no CHECK**; `scheduled_at` **nullable**, `executed_at` set on complete **and** fail, not on dead-letter. Guardrail skips are `failed` with the fixed messages `'max executions reached'` and `'cooldown active'`; `'rule/event not found'` is a real failure. "No live producer today" | `20260723_enhance_payments.sql:260-280`; `2026-08-14_payment_automation_executions_claim.sql`; `PaymentAutomationEngine.ts:325-360`; `PaymentAutomationRepository.ts:383, 404` | Guardrail skips **can** be separated from failures (requirement S5.7 asked) |
| | `daily_briefing_sends`: `pending / processing / sent / skipped / failed` (CHECK); no `scheduled_at`, no `updated_at`; marker dead-letter | `20260911_daily_briefing.sql` | |
| | `lead_responses`: same vocabulary (CHECK); `next_attempt_at` is the due time set at enqueue (`dueAt`, the 15-minute delay or the 2-day chase); marker dead-letter | `20260914_lead_responses.sql`; `LeadResponseRepository.ts:18-52` | |
| | `insight_actions`: same vocabulary (CHECK); marker dead-letter; a retryable failure goes back to `pending` with `next_attempt_at` +5 min | `20260917_insight_actions.sql`; `InsightActionRepository.ts:184-196` | |
| V-10 | All five reapers set `next_attempt_at = NULL` and `claimed_at = NULL` on dead-letter. **None of the five tables records when a row failed or was dead-lettered** (only `payment_automation_executions.executed_at` on a service-path failure) | the five reaper RPCs | "Failed / dead-lettered in the last 24 h" cannot be measured by failure time. The plan windows by due or queue time and labels it (F-8) |
| V-11 | All five leases are 90 s. Max attempts: 5 (`payment_reminders`, `payment_automation_executions`, `insight_actions`), 3 (`daily_briefing_sends`, `lead_responses`) | `LEASE_SECONDS` / `MAX_ATTEMPTS` constants in the five services | "Stuck" = in progress with `claimed_at` older than 90 s + 10 min |
| V-12 | Repo-declared partial indexes only cover `status = 'pending'` | V-9 migrations | Counts by other statuses may scan. The tables are small today (L-5.3, L-5.4) |
| V-13 | `/admin` Health evaluator: `TileStatus` has no `'green'` (C-10); no-match → `neutral` "Normal"; `LOWER_BOUND_TILES` makes an inexact spend tile amber (C-18); tiles 6/7 are built by `notMeasuredTile()` with no rule list | `lib/admin/health/healthTypes.ts:17`, `evaluateHealth.ts:356-420, 590-605` | Part D gives tiles 6/7 inputs and rules; Part E adds green (§8.1) |
| V-14 | **The entitlements tile emits exactly one figure, "Mode", whose value is a word.** `HealthTile.tsx` renders only `headline`, `figures`, `footnote` and the rule list. **No digit comes from this tile** | `evaluateHealth.ts:556-584` (`entitlementsMeasurement`); `HealthTile.tsx` | RC-5.2: the "0" is elsewhere (§8.3) |
| V-15 | The linked page `/admin/business-os-tiers` shows these numbers: plan prices ("Free" for $0), "Includes (N)", "Withholds (N)", "Cannot be sold (N)", "Matrix version 1", withheld capability values (e.g. `sms.messages` "0 per month", collapsed), and, after an account lookup, **"Capabilities in force (N of M)"**, which reads **"0 of M"** for an account with no plan row (`anomaly: no_plan_row`, every capability `false`) | `business-os-tiers/page.tsx`, `PlanCard.tsx`, `EntitlementSnapshot.tsx:72-75`, fixture `recordedAccountBodyNoPlanRow.json` | Candidates for the "0" (§8.3, Q-U1) |
| V-16 | Production mode: `getEntitlementModeSetting()` returns `{ effective, requested, refused }`; a refused `enforce` becomes `shadow` | `lib/business-os/entitlements/mode.ts` | RC-5.3 caveat text |
| V-17 | **Docs that say the mode is unset:** `CLAUDE.md:799`, `docs/architecture/BUSINESS_OS_ENTITLEMENTS.md:9`, `docs/BUSINESS_OS_ENTITLEMENTS_APPLY_RUNBOOK.md:9`, `docs/requirements/BUSINESS_OS_TIER_BILLING_REUSE_PLAN.md:128` (F-24). Historical records (not rewritten): `docs/workplans/business-os-subscription-entitlements.md:1752, 1776` | `grep -rn "unset"` | §8.4 |
| V-18 | `CLAUDE.md:799` also says "**no commercial tier is configured**", but `TIER_MATRIX` configures `basic` (Essentials, $79) and `pro` (Autopilot, $129), version 1 | `lib/business-os/entitlements/config/tierMatrix.ts:193-231` | Possibly stale. Asked, not changed (Q-U3) |
| V-19 | Admin census today: **82 handlers / 53 route files, 76 via `requireAdmin` + 6 inline; 25 `/admin` pages** | `find app/api/admin -name route.ts` (53); exported handlers (82); `find app/admin -name page.tsx` (25); matches `ADMIN_IDENTIFICATION_AND_ACCESS.md:43, 69` | After this slice: 83 / 54 / 77 + 6; 26 pages. **Re-measured at implementation**, because Admin Archiving slice 2b may land first (§9.3) |
| V-20 | Sidebar: Monitor = `/admin`, `/admin/analytics`, `/admin/audit-trail`, `/admin/archiving` (Archiving is already on `main`); 24 entries; on-disk floor 25; parked 13, hidden | `AdminSidebar.tsx`, `AdminSidebar.nav.test.ts` | New entry between AI cost & usage and Audit trail (§6.6) |
| V-21 | Existing cron test: `app/api/cron/insight-detect/__tests__/route.audit.test.ts` calls the route's `GET` | file | Must pass unedited (the wrapper does not record under test) |
| V-22 | Missing-table handling precedent: `error.code === '42P01' \|\| /does not exist\|schema cache/i` | `lib/business-os/bizql/cache/PlanCache.ts:102`; PostgREST codes `PGRST205` (table), `PGRST202` (function), used in `BusinessPurgeRepository.ts:391` | The recorder and the admin read tolerate the migration being absent (FR-R8) |
| V-23 | The house style for a hand-applied migration: header with apply order, runbook SQL in one block comment (pre-check → apply → access check → dry run that always rolls back → "nothing kept" → rollback), plain `CREATE TABLE` in one transaction, RLS on with no policy, `REVOKE ALL` from `PUBLIC, anon, authenticated, service_role` then explicit grants, `SECURITY INVOKER` + `search_path = ''`, and a static migration test | `supabase/migrations/20261010_admin_archiving_runs.sql`; `supabase/migrations/__tests__/admin-archiving.migration.test.ts` | Copied (§5.2) |
| V-24 | The `business-os-insights` skill's Rule 7 says the insight crons fail open. The code now fails closed (`insight-metrics/route.ts:46-53`). Two route comments (`lead-response:26-31`, `insight-actions:29-35`) still say insight-metrics "returns true" | files | Stale docs. Flagged to TL (§15), not edited |
| V-25 | The AgentsPilot scheduled-agent query: `agents` where `mode = 'scheduled'`, `status = 'active'`, `schedule_enabled = true`, `schedule_cron IS NOT NULL` | `app/api/run-scheduled-agents/route.ts:67-72` | L-5.6 uses the same predicate |

---

## 2. Analysis Summary

| Area | What this slice touches |
|---|---|
| **Config** | `vercel.json`: 3 entries removed (Part A) |
| **Database** | **One migration** (Part B): table `bos_cron_runs`, one-row table `bos_cron_run_recording`, read function `admin_bos_cron_run_summary`. The five queue tables are **read only**; nothing about them changes |
| **Cron routes** | The 12 BOS routes: `GET` renamed to `runJob`, plus `export const GET = withCronRunRecord('<job>', runJob)` and one import. No job body, auth check or response is edited |
| **New server code** | `lib/cron/bosCronJobs.ts` (the job registry, pure data), `lib/cron/cronRunRecorder.ts` (the shared step), `lib/repositories/BosCronRunRepository.ts` (writes), `lib/repositories/AdminJobsQueuesRepository.ts` (admin-only cross-account reads) |
| **Pure logic** | `lib/admin/jobs/` (job status, queue figures, the read orchestrator with injected readers). `lib/admin/health/` gains two input tiles, their rules and the green state |
| **API routes** | **New** `GET /api/admin/jobs-queues`. **Modified** `GET /api/admin/health-summary` (two more reads, same computation) |
| **Pages** | **New** `/admin/jobs-queues` (client). Health tile and grid wording. Sidebar and header entries |
| **Entitlements** | No new import of the module, so no `KNOWN_NON_GATE_IMPORTERS` change (the Health route's existing entry is unchanged). Verified by `npm run test:bos-entitlements` |
| **Providers / LLM** | None. The Health route and `insight-detect` are in the `typecheck:bos-llm` scope; no model or temperature literal is added |
| **Docs** | `CLAUDE.md` (mode line, admin counts), three entitlements docs, the admin access register, two AgentsPilot docs (Part A) |

---

## 3. Delivery and Deployment Order

**Two PRs** (the requirement's suggestion; F-16):

| PR | Parts | Needs the migration? | Can merge |
|---|---|---|---|
| **PR-1** | **A + E** (cron retirement, green, entitlements tile, docs) | No | After SA re-rules C-10, QA, the user's diff review, and **L-5.6 recorded** |
| **PR-2** | **B + C + D** (run record, page, tiles 6/7) | Yes | After the user has applied the migration and recorded its checks (L-5.7). Code tolerates the reverse order |

Both stay uncommitted until the user approves each diff. Part E's green state is written so that tiles 6/7 simply become eligible for green once PR-2 lands.

**Deployment order for PR-2 (recommended):**
1. The user runs the migration's **pre-check** (read-only). Any STOP: do not apply.
2. The user applies the migration (one paste, one transaction).
3. The user runs the **access check** and the **dry run**, then "nothing kept" (§5.2 runbook). Results recorded as L-5.7.
4. RM merges PR-2; Vercel deploys.
5. L-5.8 at +2 h and at 09:00 UTC the next day; L-5.12 timings.

**If the order is reversed** (code deployed before the table exists): every cron runs exactly as before. The recorder's first write fails with `PGRST205`/`42P01`, logs one `warn` per run (`{ job, reason: 'run_table_missing' }`) and skips the finish and prune. The page and tile 6 show **"Could not check: run recording is not installed yet"**. The queue half works, because it reads existing tables only.

**Rollback:** revert PR-2 (optional: the code tolerates a missing table), then run the rollback block. Losing run history is acceptable, because it is monitoring data. Part A is reversed by re-adding one `vercel.json` entry per job (the exact lines are in §4).

---

## 4. Part A: Retire the AgentsPilot Crons

| Item | Detail |
|---|---|
| Change | Delete exactly these three objects from `vercel.json` `crons`. The other 12 entries stay byte-identical, in the same order |
| Removed | `{ "path": "/api/run-scheduled-agents", "schedule": "*/5 * * * *" }`, `{ "path": "/api/cron/update-template-scores", "schedule": "0 3 * * *" }`, `{ "path": "/api/cron/memory-consolidation", "schedule": "0 4 * * 0" }` |
| Code | **Untouched:** `app/api/run-scheduled-agents/route.ts` (still has `console.*`, not touched, so the Pino rule does not apply), `app/api/cron/update-template-scores/route.ts`, `app/api/cron/memory-consolidation/route.ts` |
| Reverse | Re-add the object above to `crons`. One line per job, no code change |
| Pre-merge gate | **L-5.6** (the user records how many scheduled, active and enabled AgentsPilot agents stop running on a schedule). SQL in §10 |
| After deploy | **L-5.9**: the Vercel dashboard's Cron Jobs list shows 12 jobs, none AgentsPilot |
| Test | `lib/cron/__tests__/vercelCrons.test.ts`: exactly 12 crons; none of the three AP paths; every entry is under `/api/cron/`; the set of `{path, schedule}` equals the job registry (FR-R9, §5.3); the three AP route files still exist |
| Docs (FR-A3) | `docs/AGENT_EXECUTION_FLOW.md` (the scheduled path, line 36 / 380) and `docs/VERCEL_ENV_SETUP.md` (line 237): a dated note "schedule retired 2026-09-xx (admin reorganisation slice 5); code kept; re-enable by re-adding the `vercel.json` entry", plus a Change History entry (added if the doc has none). `docs/architecture/BUSINESS_OS_MONOREPO_ARCHITECTURE.md:304` is a plan, not a description, and is left alone. The requirement amendment goes to BA via TL |

---

## 5. Part B: The Run Record

### 5.1 Table design

**`public.bos_cron_runs`**: one row per authorised run of a Business OS cron.

| Column | Type | Rule | Why |
|---|---|---|---|
| `id` | `uuid` PK, `gen_random_uuid()` | | |
| `job` | `text NOT NULL` | `CHECK (job ~ '^[a-z][a-z0-9-]{0,63}$')` | The registry id, e.g. `lead-response`. A regex rather than a list, so adding a job needs no migration; the registry test pins the ids |
| `source` | `text NOT NULL` | `CHECK (source IN ('vercel_cron','other'))` | `vercel_cron` when the `User-Agent` starts with `vercel-cron/`. Only these runs reset "late" (F-7), so a manual authorised call cannot mask a stopped schedule |
| `started_at` | `timestamptz NOT NULL` | | Set by the recorder when the authorised run starts |
| `deadline_at` | `timestamptz NOT NULL` | `CHECK (deadline_at > started_at)` | `started_at + time limit + 60 s`. A `running` row past this **did not finish** (FR-R2). Storing it keeps the read uniform: no per-job parameter is needed |
| `finished_at` | `timestamptz NULL` | `CHECK ((outcome = 'running') = (finished_at IS NULL))`, `CHECK (finished_at IS NULL OR finished_at >= started_at)` | |
| `outcome` | `text NOT NULL DEFAULT 'running'` | `CHECK (outcome IN ('running','succeeded','partial','failed'))` | "Did not finish" is derived, never stored |
| `duration_ms` | `integer NULL` | `CHECK (duration_ms >= 0)` | |
| `http_status` | `smallint NULL` | `CHECK (http_status BETWEEN 100 AND 599)` | |
| `error_class` | `text NULL` | `CHECK (error_class IN ('http_error','exception','timeout'))`, `CHECK (error_class IS NULL OR outcome = 'failed')` | FR-R5: a class, never a message. A closed list in the database (F-13) |
| `counts` | `jsonb NOT NULL DEFAULT '{}'` | object; ≤ 1,024 bytes; **every value a number** (`NOT jsonb_path_exists(counts, '$.* ? (@.type() != "number")')`); keys `^[a-zA-Z][a-zA-Z0-9]{0,39}$` | FR-R1/FR-R5 enforced by the database, not only by code: a string (and so any owner text or message) cannot be stored |
| `recorded_at` | `timestamptz NOT NULL DEFAULT now()` | | The database clock, for diagnosing clock skew |

Indexes: `bos_cron_runs_job_started_idx (job, started_at DESC)` for the per-job reads; `bos_cron_runs_started_idx (started_at)` for pruning.

**No business id, no user id** (A-13). There is no owner text in any column. The table is therefore not tenant data, and `.eq('user_id')` does not apply. That is documented in the repository header (CLAUDE.md rule 4).

**`public.bos_cron_run_recording`**: one row, `id smallint PK CHECK (id = 1)`, `installed_at timestamptz NOT NULL DEFAULT now()`. The migration inserts it. It exists so that "when recording began" is known **even if no job ever records** (F-6). Without it, if `CRON_SECRET` were wrong everywhere, no job would write, every job would stay "No run recorded yet" (grey) forever, and the slice would fail at the one thing it exists to check (OQ-2).

**Baseline for a job with no run yet** = `COALESCE(first run of any job, installed_at)`. The first run of any job tracks the deploy, so a gap between applying the migration and deploying does not raise false alarms. `installed_at` catches "nothing ever records".

**`public.admin_bos_cron_run_summary(p_jobs text[], p_now timestamptz, p_recent integer)`**: `LANGUAGE sql STABLE SECURITY INVOKER SET search_path = ''`. It returns one row per requested job:
- `runs_24h`, `runs_7d`, `bad_24h`, `bad_7d`. "Bad" = `outcome = 'failed' OR (outcome = 'running' AND deadline_at < p_now)`;
- `recent`: the last `p_recent` runs, as a `jsonb` array;
- `recent_bad`: the last `p_recent` bad runs, as a `jsonb` array;
- `first_run_at` (global) and `installed_at`.

`p_recent` is clamped to 1..20 and `p_jobs` to 50 entries. Each sub-select is an index range scan on `(job, started_at DESC)`. It is **one round trip** instead of about 72 PostgREST calls (F-1). It reads only the table this migration creates, so it cannot drift from a table we do not own.

### 5.2 The migration (outline)

**File:** `supabase/migrations/20261011_bos_cron_runs.sql`. The date prefix is re-checked against `main` at implementation, because Admin Archiving slice 2b may take `20261011`.

```sql
-- Business OS cron run record (admin reorganisation slice 5, part B).
-- ── WHAT THIS IS ── two tables, one read function; the only writer is
--    lib/cron/cronRunRecorder.ts (service role); the only reader is the admin
--    jobs & queues read (service role, behind requireAdmin).
-- ── APPLY ORDER (by hand, PROD, Supabase SQL editor) ── pre-check → apply →
--    access check → dry run → nothing kept. BEFORE PR-2 deploys (it tolerates
--    the reverse). Rollback only if the access check or the dry run fails.
-- ── DESIGN ── (the §5.1 reasons, briefly)
/* ═════ RUNBOOK SQL ═════
-- STEP 1 PRE-CHECK (read-only; one SELECT; rows PASS / STOP):
--   P01 names free: to_regclass('public.bos_cron_runs'),
--       to_regclass('public.bos_cron_run_recording') and
--       to_regprocedure('public.admin_bos_cron_run_summary(text[],timestamptz,integer)')
--       are all NULL. Otherwise "STOP: already applied, do not apply again".
--   P02 current_setting('server_version_num')::int >= 120000 (jsonb_path_exists).
--   P03 gen_random_uuid() resolves.
--   P04 the role service_role exists.
-- STEP 3 ACCESS CHECK (one row, every column must be true): anon and
--   authenticated have no privilege on either table and cannot EXECUTE the
--   function; the function is not SECURITY DEFINER; RLS is enabled on both
--   tables; service_role has no TRUNCATE / REFERENCES / TRIGGER; exactly one
--   bos_cron_run_recording row.
-- STEP 4 DRY RUN (DO block, SET LOCAL ROLE service_role, always ends in an error
--   ON PURPOSE so nothing is kept; the text must start "DRY RUN PASS"):
--   D-1 insert a running row, finish it (succeeded, counts {"sent": 2}) → ok
--   D-2 counts {"note": "x"} → check_violation raised      (numbers only)
--   D-3 error_class 'Timeout while sending to a@b.c' → raised (no messages)
--   D-4 outcome 'running' with finished_at set → raised     (consistency)
--   D-5 admin_bos_cron_run_summary(ARRAY['dry-run-job','lead-response'], now(), 10)
--       returns 2 rows; dry-run-job has runs_24h = 1, bad_24h = 0
--   D-6 a running row with deadline_at in the past counts in bad_24h
--   D-7 a row back-dated 31 days is removed by the prune statement the
--       recorder issues; a 29-day row is not
-- STEP 4 then NOTHING KEPT: SELECT count(*) FROM public.bos_cron_runs → 0;
--   SELECT count(*) FROM public.bos_cron_run_recording → 1
-- ROLLBACK: DROP FUNCTION IF EXISTS public.admin_bos_cron_run_summary(text[],timestamptz,integer);
--   DROP TABLE IF EXISTS public.bos_cron_runs; DROP TABLE IF EXISTS public.bos_cron_run_recording;
═════ */
BEGIN;
CREATE TABLE public.bos_cron_runs ( … §5.1 … );
CREATE INDEX … ; CREATE INDEX … ;
CREATE TABLE public.bos_cron_run_recording ( … );
INSERT INTO public.bos_cron_run_recording DEFAULT VALUES;
ALTER TABLE … ENABLE ROW LEVEL SECURITY;           -- both; NO policy
REVOKE ALL ON TABLE public.bos_cron_runs, public.bos_cron_run_recording
  FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.bos_cron_runs TO service_role;
GRANT SELECT ON TABLE public.bos_cron_run_recording TO service_role;
CREATE FUNCTION public.admin_bos_cron_run_summary( … ) … SECURITY INVOKER SET search_path = '' …;
REVOKE ALL ON FUNCTION … FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION … TO service_role;
COMMIT;
```

**"Safe to run twice" (FR-R8)**, in the house style of `20261010` (F-15): plain `CREATE TABLE` inside one transaction, so a second paste fails at the first `CREATE`, rolls back and changes nothing. P01 also tells the user beforehand that it is already applied. `IF NOT EXISTS` is rejected, because it would silently skip over a drifted table.

**Server-write-only (FR-R7):** RLS is on with no policy, and `anon`/`authenticated` hold no privilege, so an ordinary signed-in user can neither read nor write. That is L-5.7, the access check.

**Static test:** `supabase/migrations/__tests__/bos-cron-runs.migration.test.ts`, in the style of `admin-archiving.migration.test.ts`. It pins: one `BEGIN … COMMIT`; plain `CREATE TABLE`; RLS enabled on both tables; no `CREATE POLICY`; `REVOKE ALL … FROM PUBLIC, anon, authenticated, service_role`; the exact grants; `SECURITY INVOKER`; `search_path = ''`; the counts CHECK; the `error_class` list; and that the runbook block contains the pre-check, access check, dry run, "nothing kept" and rollback. It runs in `test:bos-entitlements`, which includes `supabase/migrations/__tests__`.

### 5.3 The job registry (single source for jobs, schedules and thresholds)

**File:** `lib/cron/bosCronJobs.ts`. It is pure data and types, with no server import, so both the recorder and the pure admin evaluator can import it.

```typescript
export interface BosCronJob {
  id: 'calendar-sync' | 'lead-response' | /* … the 12 … */;
  path: `/api/cron/${string}`;        // must equal vercel.json
  schedule: string;                    // must equal vercel.json, byte for byte
  intervalMinutes: number;             // 5 | 15 | 60 | 1440, derived-and-checked in the test
  graceMinutes: number;                // 10 (≤ hourly) | 60 (daily)   — requirement S5.7
  keepsFailingAfter: number;           // 3 | 2 (daily)
  timeLimitSeconds: number;            // the route's maxDuration, or 300 when it exports none (F-9)
  label: string; description: string; // plain words for the page
  drainsQueue: QueueId | null;
  counts: ReadonlyArray<{ key: string; path: readonly string[]; label: string }>; // numbers only
  partlyDoneWhen: ReadonlyArray<{ kind: 'atLeast'; key: string; value: number }
                              | { kind: 'exceeds'; key: string; other: string }>;
}
export const BOS_CRON_JOBS: readonly BosCronJob[];
```

- **Late** = more than `interval + grace` since the last `vercel_cron` run started. **Stopped** = more than `2 × interval + grace`. These give 15/20 min, 25/40 min, 70/130 min and 25/49 h, exactly the requirement table. They are data here. A test derives them and compares them with the requirement's numbers.
- **Counts and "partly done"** per job, taken from the response body (V-3). Only finite numbers are kept; a `true`/`false` flag becomes 1/0 (`hitLimit`). **Money paths are never listed** (V-4).

| Job | Counts kept (response path → key) | Partly done when |
|---|---|---|
| calendar-sync | `total`, `synced`, `failed` | `failed ≥ 1` |
| insight-metrics | `data.usersProcessed`, `data.metricsComputed`, `data.errors` | `errors ≥ 1` |
| insight-detect | `data.usersProcessed`, `data.insightsCreated`, `data.insightsResolved`, `data.errors`, `data.usersRemaining` | `errors ≥ 1` or `usersRemaining ≥ 1` |
| insight-automations | `data.automationsChecked`, `…Executed`, `…Skipped`, `…Failed`, `data.totalItemsProcessed` (**not** `totalValueImpact`) | `automationsFailed ≥ 1` |
| insight-actions | `reaped`, `claimed`, `sent`, `skipped`, `failed` | `failed ≥ 1` |
| channel-metrics-sync | `processed`, `failed`, `hitLimit` | `failed ≥ 1` or `hitLimit ≥ 1` |
| payment-reminders | `data.reminders.processed/sent/failed`, `data.overdue.remindersScheduled`, `data.invoicesMarkedOverdue` | `remindersFailed ≥ 1` |
| intake-reminders | `considered`, `sent`, `skipped`, `failed` | `failed ≥ 1` |
| payment-retry | `data.retryStats.processedInvoices`, `processedInstallments`, `successCount`, `failureCount` | **none**: a declined card is a business outcome, not a job fault (**Q-U2**) |
| daily-briefing | `data.enqueued`, `data.sent`, `data.skipped`, `data.failed` | `failed ≥ 1` |
| lead-response | `reaped`, `enqueued`, `claimed`, `sent`, `skipped` | none (the result has no failure count) |
| abandoned-proposal-invoices | `considered`, `sent` | `considered > sent` |

**FR-R9 test** (`lib/cron/__tests__/bosCronJobs.test.ts`): the registry's `{path, schedule}` set equals `vercel.json`'s; each schedule's interval, computed by a tiny parser that supports only the four shapes in use (`*/N * * * *`, `M * * * *`, `M H * * *`) and fails on anything else, equals `intervalMinutes`; each `timeLimitSeconds` equals the route file's `export const maxDuration`, or is 300 when the file has none; each route file contains `withCronRunRecord('<its id>', runJob)`; no key is a money field. **A job added to `vercel.json` and not to the registry fails this test.**

### 5.4 The shared step: `withCronRunRecord`

**File:** `lib/cron/cronRunRecorder.ts` (server-only).

```typescript
export function withCronRunRecord(
  jobId: BosCronJobId,
  handler: (request: NextRequest) => Promise<Response>
): (request: NextRequest) => Promise<Response>;
```

**Per request:**
1. **Record only a proven Vercel cron call (FR-R3, F-3).** The recorder applies its own strict test and does not rely on the route's check (V-2). All three must hold:
   - `process.env.VERCEL_ENV === 'production'`;
   - `CRON_SECRET` is non-empty;
   - `Authorization` equals `Bearer <secret>`, compared with `crypto.timingSafeEqual`.

   Otherwise it calls `handler(request)` and returns its response **untouched**, and nothing is written. Consequences:
   - a stranger or a refused Vercel call writes nothing;
   - local development (which shares the production database) and preview deployments never write;
   - if `CRON_SECRET` went missing in production, the two fail-open routes (`calendar-sync`, `channel-metrics-sync`) would keep running **but stop recording**, so they turn Late, then Stopped. That surfaces R-19 instead of hiding it.
2. **Start:** `repository.startRun({ job, source, startedAt, deadlineAt })`, under a **1,500 ms** deadline. On any error or timeout it logs one `warn` (`{ job, reason }`, where `reason` is `run_table_missing`, `write_failed` or `write_timeout`), and the run continues **unrecorded**.
3. **Run the job:** `const response = await handler(request)`. If the handler **throws**, the recorder finishes with `failed` / `exception` (or `timeout` for an `AbortError`/`TimeoutError` name) and **rethrows the same error**. Behaviour is unchanged.
4. **Outcome:**
   - status ≥ 400 → `failed`, `http_error`, `http_status`;
   - otherwise, read `response.clone().json()` (inside a `try`) and extract the registry's counts. Then `partial` if a `partlyDoneWhen` condition holds, else `succeeded`;
   - a 2xx with an unreadable body → `succeeded`, `counts {}`, one `warn`.
5. **Finish:** `repository.finishRun(id, …)`, under 1,500 ms, never throws.
6. **Prune:** `repository.deleteRunsStartedBefore(startedAt − 30 days)`, under 1,500 ms, never throws (§5.6).
7. **Return the handler's original `response` object**, unmodified.

**Failure isolation (FR-R4), by construction:**
- every repository call is wrapped, bounded by a deadline and never throws;
- the job's own work runs whatever happened at step 2;
- the response is the handler's own object;
- the recorder adds at most ~4.5 s of wall time in the worst case (three deadlines) and ~30–90 ms normally. The risk that this pushes a near-limit run over `maxDuration` is R-4.

**Logging:** `createLogger({ module: 'CronRunRecorder' })`, carrying `{ job, runId, outcome, durationMs, reason }`. Never a body, count values beyond the allow-list, or an error message (it logs `err.name` only).

**Why a wrapper and not calls inside each body (F-4):** each of the 12 routes changes by three lines and one import:

```diff
+import { withCronRunRecord } from '@/lib/cron/cronRunRecorder';
 …
-export async function GET(request: NextRequest) {
+async function runJob(request: NextRequest) {
   … unchanged …
 }
+
+export const GET = withCronRunRecord('lead-response', runJob);
```

The job bodies, their auth checks, their early returns and their responses are untouched, so there is no per-exit-point bookkeeping to get wrong. The dev-only `POST` handlers keep calling `GET(request)`.

### 5.5 `BosCronRunRepository` (writes)

**File:** `lib/repositories/BosCronRunRepository.ts`. It follows the `new-repository` skill: constructor-injected client, `{ data, error }`, Pino `service` logger, singleton, and exports from `index.ts`.

| Method | Query | Notes |
|---|---|---|
| `startRun(input, { signal })` | `insert` of an **explicit field allow-list** (`job, source, started_at, deadline_at`), then `.select('id').single()` | No caller-supplied field is forwarded (tenant-isolation-guard, step 3) |
| `finishRun(id, input, { signal })` | `update({ finished_at, outcome, duration_ms, http_status, error_class, counts }).eq('id', id).eq('outcome', 'running')` | The `eq('outcome','running')` stops a finish from overwriting a finished row |
| `deleteRunsStartedBefore(cutoff, { signal })` | `delete().lt('started_at', cutoff)` | Pruning (§5.6) |
| `isMissingTable(error)` | `42P01` / `PGRST205` / "schema cache" | V-22 precedent |

- **Service role, documented:** the table has no `user_id`, holds no tenant data, and is written only by the recorder after the strict authorisation above.
- **Guard:** only `lib/cron/cronRunRecorder.ts` may import this repository (a source test, like `adminReadMethods.guard.test.ts`). The table does not exist until the migration is applied, which the `new-repository` skill would normally treat as "stop". Tolerating a missing table is the deliberate FR-R8 exception, recorded here for SA.

### 5.6 Retention and pruning (30 days, OQ-6)

**Mechanism (recommended, F-5):** every recorded run, after its finish, issues `DELETE FROM bos_cron_runs WHERE started_at < started_at_of_this_run − 30 days`, through the repository.
- **Why:** it is uniform (no special job) and self-healing: any job that runs prunes, so history stays bounded while anything runs at all. It needs no new schedule (`vercel.json` stays at exactly 12), no `pg_cron` (out of scope, §10 of the requirement) and no SQL function.
- **Cost:** rows expire at about 45 an hour, so each call deletes 0–5 rows through `bos_cron_runs_started_idx`. Concurrent prunes delete the same rows harmlessly.
- **Size:** about 1,080 runs a day × 30 ≈ 32,400 rows, each under ~300 bytes plus indexes: single-digit MB.
- **`bos_cron_run_recording` is never pruned.**

Alternatives in F-5: a designated hourly job prunes; a 13th cron; `pg_cron`.

---

## 6. Part C: The Page, Its Route and the Queue Reads

### 6.1 Queue reads (per table, PostgREST head counts, F-2)

**File:** `lib/repositories/AdminJobsQueuesRepository.ts`. It is admin-only and cross-account, in the `AdminTokenUsageAnalyticsRepository` template:
- an `AdminReadContext` is the first, required argument;
- "AllAccounts" is in the method names;
- the service role is used, documented;
- `.abortSignal()` is used;
- methods never throw;
- a source guard allows only `app/api/admin/**` to name it.

The table knowledge (names, status words, markers) lives here, as `ADMIN_QUEUE_SPECS`.

| Queue id | Table | Waiting | In progress | Done | Failed (not dead) | Dead-lettered | Other end states | "Due" column(s) | Window column for failed / dead (F-8) |
|---|---|---|---|---|---|---|---|---|---|
| `payment_reminders` | `payment_reminders` | `pending` | `processing` | `sent` | `failed` and marker ≠ | `failed` + `error_message = 'dead-letter: max attempts'` | `cancelled` | `scheduled_at ≤ now` and (`next_attempt_at` null or ≤ now) | `scheduled_at` (**due time**) |
| `payment_automations` | `payment_automation_executions` | `pending` | `running` | `completed` | `failed`, excluding the guardrail markers | `dead_letter` | `cancelled`; **guardrail skips** = `failed` + `'max executions reached'` / `'cooldown active'` | same as above; `scheduled_at IS NULL` is "no due time, never picked up" (information) | `scheduled_at` |
| `daily_briefing_sends` | `daily_briefing_sends` | `pending` | `processing` | `sent` | `failed` and marker ≠ | `failed` + marker | `skipped` | `next_attempt_at` null or ≤ now | `created_at` (**queue time**) |
| `lead_responses` | `lead_responses` | `pending` | `processing` | `sent` | as above | as above | `skipped` | `next_attempt_at` null or ≤ now | `created_at` |
| `insight_actions` | `insight_actions` | `pending` | `processing` | `sent` | as above | as above | `skipped` | `next_attempt_at` null or ≤ now | `created_at` |

**Figures per queue.** Each is one `select('id', { count: 'exact', head: true })` unless stated. All run in parallel inside one per-queue deadline.

| Figure | Filter |
|---|---|
| **Due now** | waiting **and** due (as the claim RPC's own predicate) |
| **Scheduled for later** | waiting **and** a due column in the future. Counted directly, not as a subtraction, so there is no race |
| No due time (automations only) | `pending` and `scheduled_at IS NULL` |
| **In progress** | the in-progress word |
| **Stuck** | in progress and (`claimed_at IS NULL` or `claimed_at < now − (90 s + 10 min)`) |
| **Failed**, 24 h / 7 d | failed-not-dead, window column ≥ start. The marker comparison is null-safe: `error_message IS NULL OR error_message <> marker` |
| **Dead-lettered**, 24 h / 7 d | the dead-letter predicate, window column ≥ start |
| **Skipped** 7 d (three tables) / **Guardrail skips** 7 d (automations) | information only |
| **Unrecognised status** | `status NOT IN (the table's known words)`. Information: it is the honest answer to "no CHECK constraint" on the two payment tables (L-5.2). It never colours anything |
| **Oldest due item** | two `limit(1)` reads. (a) Due rows with `next_attempt_at IS NULL`, ordered by the base column (`scheduled_at`, or `created_at`); (b) due rows with `next_attempt_at` set, ordered by `next_attempt_at`. The effective due time is `max(scheduled_at, next_attempt_at)` for the payment tables and `coalesce(next_attempt_at, created_at)` otherwise; the oldest is the minimum of the two candidates. The select list is **only** those timestamp columns |

That is about 13 small requests per queue, about 63 in total.

**What the repository never selects:** `payload`, `recommendation`, `error_message`, `skip_reason`, `metadata`, `result`, and any contact, invoice, booking or user column. `error_message` appears **only inside filters**, compared with the fixed markers. A repository test inspects every recorded `select(...)` argument against an allow-list of `id` and the due/claim timestamp columns (§14).

**Payment automations context:** the page shows one fixed line: "No live producer today, so zeros are expected here".

**The window label (F-8), on the page and in the tile:** "Failed / dead-lettered among items **due** in the last 24 h" for the payment tables, and "… **queued** in the last 24 h" for the other three. The tables record no failure time (V-10), so this is the honest measure. The known consequence: a lead chase is queued two days before it is due, so a chase that dead-letters shows in the 7-day figure (amber) rather than the 24-hour one (red). Recorded as R-6.

### 6.2 Job status (pure, one computation for page and tile, A-8)

**Files:** `lib/admin/jobs/jobStatus.ts` and `lib/admin/jobs/queueFigures.ts`. They are pure: no I/O, no clock (`now` is passed in), no `app/**` import.

Per job, from the summary row, the registry and `now`:
1. **Could not check** (grey): the summary read failed or is missing. When the function is absent (`PGRST202`) the reason is "Run recording is not installed yet".
2. Let `lastCron` = the newest `recent` run with `source = 'vercel_cron'`, and `since` = `now − (lastCron?.started_at ?? baseline)`.
3. **Stopped** (red): `since > 2 × interval + grace`.
4. **Keeps failing** (red): the last `keepsFailingAfter` runs that are finished or past their deadline are all bad. In-progress runs inside their deadline are skipped.
5. **Late** (amber): `since > interval + grace`.
6. **Last run failed** (amber): the newest finished-or-dead run is bad.
7. **Partly done** (amber): the newest finished run is `partial`.
8. **No run recorded yet** (grey): no `vercel_cron` run at all, and `since` ≤ the late threshold. (Past it, rules 3 and 5 already matched.)
9. Otherwise **Healthy** (green).

Rules 3 and 5 also apply to a job with **no** run, measured from the baseline. That is exactly how a job whose calls are refused becomes Late, then Stopped (FR-R3, OQ-2).

**Row content:**
- the job's label, description and schedule in words (UTC);
- the status word;
- the last run: start, finish or "did not finish", duration and outcome word;
- "Expected by" = last start + interval, with the late and stopped times;
- 24 h and 7 d runs / bad;
- the last run's counts, with their registry labels;
- up to 10 recent failures: time, outcome word and error class (`http_error 500`, `exception`, `timeout`, "did not finish").

**Queue status** (for the tile and the page's per-queue word), using the drain interval of the job that drains it and the same grace:
- **Stuck** (red) if stuck ≥ 1;
- **Stopped draining** (red) if the oldest due > 2 × interval + grace;
- **Behind** (amber) if > interval + grace;
- **Dead-letter 24 h** (red), **dead-letter 7 d** (amber), **failures 24 h** (amber);
- otherwise **Clear** (green) when the read succeeded;
- **Could not check** (grey) when it did not.

Scheduled-for-later items **never** colour anything.

### 6.3 The read orchestrator (dependency-injected, F-10)

**File:** `lib/admin/jobs/readJobsQueues.ts`.

```typescript
export interface JobsQueuesReaders {                       // structural, satisfied by the repository singleton
  summariseCronRunsAllJobs(jobs: string[], now: Date, recent: number, opts: { signal: AbortSignal }): Promise<RepoResult<CronRunSummaryRow[]>>;
  readQueueFiguresAllAccounts(queue: QueueId, now: Date, opts: { signal: AbortSignal }): Promise<RepoResult<RawQueueFigures>>;
}
export async function readJobsQueues(readers, now, deadlineMs, timings): Promise<JobsQueuesInputs>;
```

- It runs six groups under `Promise.allSettled`: runs, plus one per queue. Each group has its own 5 s deadline and `AbortController`, using the `underDeadline` shape from slice 4 (C-4: stops the work, clears the timer, swallows a late settle).
- It validates the RPC rows with **Zod**: the function's output is external data.
- It returns per-group `HealthRead`-style results.
- The routes pass the repository singleton (with the context bound), so `lib/admin/**` never names an admin repository (slice 4's C-6 isolation rule).
- The route-level `underDeadline` helper moves here from `health-summary/route.ts`, so both routes share one copy. That route's tests pin the behaviour unchanged.

### 6.4 The route: `GET /api/admin/jobs-queues`

**File:** `app/api/admin/jobs-queues/route.ts`, per the `new-api-route` skill (admin-only variation) and the slice 4 route.

1. `const gate = await requireAdmin(requestLogger)` is the **first statement**.
2. Zod: `z.object({}).strict()` over `searchParams`. Any parameter → 400 with a fixed message (details in development only). 401/403 always win over 400.
3. One clock reading; `readJobsQueues(...)`; pure `buildJobsQueuesView(inputs, BOS_CRON_JOBS, now)`.
4. One `info` line: `{ adminUserId, totalMs, reads: [{ read, ms, ok, failure? }] }`. The failure is an error **name/code**, never a message.
5. `{ success: true, data: JobsQueuesView }`. An unexpected throw → 500 `{ success: false, error: 'Could not build the jobs and queues view' }`, with `details` only in development.
6. `runtime = 'nodejs'`, `dynamic = 'force-dynamic'`.

The response carries only: job ids, labels and descriptions (platform text), timestamps, outcome words, error classes, numeric counts, queue figures and fixed sentences. **No payload, recommendation, error message, skip reason, id of any business row, or owner text.**

### 6.5 The page: `/admin/jobs-queues`

**Files:**
- `app/admin/jobs-queues/page.tsx` (`'use client'`; rule R8; it inherits `requireAdminPage` from the layout);
- `app/admin/components/jobs/JobsQueuesView.tsx`;
- `JobsTable.tsx`, `QueuesTable.tsx`;
- `jobsStatusStyles.ts`.

Details:
- It imports only `import type` from `lib/admin/jobs/jobsQueuesTypes.ts`, which is runtime-free (slice 4's C-21 pattern).
- Header: "Scheduled jobs & queues", one line on what grey, amber, red and green mean, "As of HH:mm UTC", and a **Refresh** button (`cache: 'no-store'`, no query parameter, `aria-busy`). No auto-refresh (A-11).
- Anchored sections `#jobs` and `#queues`. Each status has its text label as well as its colour (C-16); icons are `aria-hidden`.
- **No retry, requeue, cancel or drain button** (R-18 is out of scope). A source guard forbids those words on any `button` and forbids any `method: 'POST'` in these files.
- It reuses the existing classes (`bg-slate-800 border rounded-xl`), with no new UI library.

### 6.6 Sidebar and header

- `AdminSidebar.tsx`, Monitor: Health, AI cost & usage, **Scheduled jobs & queues** (`/admin/jobs-queues`, icon `Clock`, description "Business OS job runs and send queues"), Audit trail, Archiving. This is the §4.2 order, with Archiving kept directly under Audit trail (its own condition C-2).
- `AdminSidebar.nav.test.ts`:
  - Monitor becomes the five hrefs above;
  - total entries 24 → **25**, and the comment gains "+ Scheduled jobs & queues (slice 5)";
  - the on-disk floor goes 25 → **26**, and `onDisk` must contain `'/admin/jobs-queues'`;
  - parked stays 13; the "no `OK`" regex still applies.
- `AdminHeader.tsx`: `case '/admin/jobs-queues': return 'Scheduled jobs & queues';`.
- **Merge note:** Archiving is already on `main`. If Admin Archiving slice 2b changes the sidebar or its test before this lands, resolve by **keeping both sides** (their entries and ours) and re-deriving the counts.

---

## 7. Part D: Health Tiles 6 and 7

`health-summary/route.ts` calls the **same** `readJobsQueues()` and the **same** pure computation, and hands the evaluator numbers (A-8). The tile's numbers are the page's numbers by construction. A test builds both views from one fixture and asserts that every tile figure equals the corresponding page value.

**Tile vocabularies (`rules.ts`, C-19):**
- `JobsMetric = 'jobsStopped' | 'jobsKeepFailing' | 'jobsLate' | 'jobsLastRunFailed' | 'jobsPartlyDone'` (counts of jobs);
- `QueuesMetric = 'queueItemsStuck' | 'queuesStoppedDraining' | 'queueDeadLettered24h' | 'queuesBehind' | 'queueDeadLettered7d' | 'queueFailed24h'`.

They use the **existing** `atLeast` kind, so no new condition kind is needed: the per-job and per-queue thresholds are applied in the shared computation from the registry data, and the tile rules count the results.

**Tile 6: Scheduled jobs** (`HEALTH_RULES.scheduled_jobs`, first match wins):

| P | Colour | Description | Condition |
|---|---|---|---|
| 1 | red | "A job has stopped" | `atLeast jobsStopped 1` |
| 2 | red | "A job keeps failing" | `atLeast jobsKeepFailing 1` |
| 3 | amber | "A job is late" | `atLeast jobsLate 1` |
| 4 | amber | "A job's last run failed" | `atLeast jobsLastRunFailed 1` |
| 5 | amber | "A job finished with work left or partly failed" | `atLeast jobsPartlyDone 1` |

- **Figures** (→ `/admin/jobs-queues#jobs`): "Jobs healthy: N of 12", "Late: N", "Stopped: N", "Failing: N" (last run failed or keeps failing), "Worst job: <label>".
- **Exactness:** every metric is exact unless some job is "No run recorded yet". Then the counts are lower bounds (`exact: false`). A rule can still fire on them, because `atLeast` is monotone (a stopped job is proven). With no match, the tile is **grey "Not measured yet"** (§8.1), never green.
- **Read failed:** the tile is `unavailable`, "Could not check just now", with the "not installed yet" footnote when that is the cause.

**Tile 7: Queues** (`HEALTH_RULES.queues`):

| P | Colour | Description | Condition |
|---|---|---|---|
| 1 | red | "Items stuck in progress" | `atLeast queueItemsStuck 1` |
| 2 | red | "A queue has stopped draining" | `atLeast queuesStoppedDraining 1` |
| 3 | red | "A message was dead-lettered in the last 24 hours" | `atLeast queueDeadLettered24h 1` (OQ-7: red) |
| 4 | amber | "A queue is behind" | `atLeast queuesBehind 1` |
| 5 | amber | "Dead-lettered items this week" | `atLeast queueDeadLettered7d 1` |
| 6 | amber | "Failures in the last 24 hours" | `atLeast queueFailed24h 1` |

- **Figures** (→ `/admin/jobs-queues#queues`): "Due now, all queues: N", "Stuck in progress: N", "Dead-lettered (due or queued in last 24 h): N", "Failed (due or queued in last 24 h): N", "Oldest due item: 3 h 10 min (Lead responses)".
- **Partial reads:** if one queue's read failed, the other queues' counts are lower bounds. Rules may fire on them; with no match the tile is **`unavailable` "Could not check"**, never green.

**Links:** tiles 6 and 7 gain a tile-level link "Open Scheduled jobs & queues" (the new `pageLink`, §8.2). **Slice 4's documented link exception S4-c(1) is removed.**

**Timing:** the Health route gains 1 RPC and ~63 head counts, all in parallel under deadlines. Its log line gains the new reads. **L-5.12** (after deploy) records `totalMs` for both routes, against the ~3 s budget. If it misses, the slice 4 §7.4 step 1 fallback applies: split tiles 6/7 into their own request (UI-only).

---

## 8. Part E: Health Fixes

### 8.1 RC-5.1: green for healthy (C-10 re-ruling proposal, **F-11**)

**Proposed replacement for C-10: "Green only when measured, exact and clear", enforced four ways.**

**(i) Types.** `TileStatus = 'red' | 'amber' | 'green' | 'neutral' | 'not_measured' | 'unavailable'`. `HealthRule['colour']` **stays** `'red' | 'amber'`: no rule, and so no data edit, can produce green. Green is only the evaluator's no-match outcome.

**(ii) The evaluator (`colourTile`), in order:**

```text
1. rule list invalid                        → unavailable       (C-20, unchanged)
2. read failed (measurement = null)         → unavailable       ("Could not check just now")
3. first matching rule                      → its red / amber   (unchanged)
4. no match, some metric or figure inexact:
     tile in LOWER_BOUND_TILES (spend)      → amber, LOWER_BOUND_HEADLINE   (C-18, unchanged)
     measurement.completeness = 'not_measured' → not_measured   ("Not measured yet")
     otherwise                              → unavailable       ("Could not check")
5. no match, everything exact and complete:
     tile ∈ GREEN_ELIGIBLE                  → green  "All clear"   (label "Healthy")
     otherwise (entitlements only)          → neutral            (label "For information")
```

- `GREEN_ELIGIBLE` is a **code constant in `evaluateHealth.ts`, not data in `rules.ts`**, so a data edit cannot make a tile green (the same reasoning as C-18). It holds: `bos_ai_settings`, `bos_ai_failures`, `bos_ai_spend`, `critical_audit`, `scheduled_jobs`, `queues`.
- **`entitlements_mode` may never be green** (OQ-9).
- `Measurement` gains `completeness: 'complete' | 'not_measured' | 'partial'`. The existing tiles are always `complete` when their read succeeded. Spend's inexact figures still route to amber through C-18, which is **not weakened** (a lower bound is never green).

**(iii) Tests.**
- The fuzz from slice 4 (random valid rule lists × random inputs) now asserts the invariant: `status === 'green'` ⇒ the tile is in `GREEN_ELIGIBLE`, the read succeeded, `matchedRuleId === null`, every metric and figure is exact, and `completeness === 'complete'`.
- Plus: `entitlements_mode` is never green; a failed read, a lower bound or a not-measured tile is never green; `neutral` appears only on a tile outside `GREEN_ELIGIBLE`.
- `rules.config.test.ts` still asserts every rule colour ∈ {red, amber}.

**(iv) Source guard (`health.source.guard.test.ts`, re-ruled, not deleted).** `green-`/`emerald-` classes may appear **only inside the `green:` entry of `STATUS_STYLES`** in `HealthTile.tsx`: the guard extracts that object literal and asserts no green class anywhere else in the Health files (including `RULE_CHIP`, which stays red/amber). `/\bOK\b/` stays forbidden. A render test asserts the green tile shows the text label "Healthy" and the headline "All clear" (C-16).

**Which tiles can be green:**

| Tile | Green when | Never green when |
|---|---|---|
| Business OS AI settings | 0 settings ignored and 0 areas/calls configured off | read failed |
| Failed AI actions | no rule matched (0 failures in 24 h) | read failed |
| AI spend | no rule matched and all four sums exact | any sum is a lower bound (then amber, C-18) |
| Critical audit events | 0 in 24 h | read failed |
| Scheduled jobs | no rule matched **and** all 12 jobs have a recorded `vercel_cron` run **and** the read succeeded | any job "No run recorded yet" (grey), read failed |
| Queues | no rule matched **and** all five queue reads succeeded | any queue read failed (grey) |
| Entitlements mode | **never** (OQ-9) | always `neutral` "For information" unless its amber rule matches |

**Wording changes:**
- The intro line becomes: "Is anything wrong in Business OS? Red needs action, amber needs a look, green means checked and clear. Grey means not measured yet, could not check, or for information only."
- The `otherwise` lines become:
  - "Otherwise: green, All clear.";
  - spend: "Otherwise: green, unless a figure is only a minimum; then amber: …";
  - jobs: "Otherwise: green once every job has a recorded run; grey until then.";
  - queues: "Otherwise: green when every queue was read; grey if one could not be.";
  - entitlements: "Otherwise: shown for information only (never green)."
- `STATUS_STYLES.green` = `border-emerald-500/40`, `text-emerald-300`, icon `CheckCircle2`, label "Healthy".
- `neutral` is relabelled **"For information"**, since only the entitlements tile can reach it (F-12).

### 8.2 RC-5.2: the entitlements tile

| # | Change |
|---|---|
| FR-E1 | `MODE_WORDS` meanings: **Off** "Plans are not checked." **Shadow** "Plans are checked and logged; nothing is blocked." **Enforce** "Plan limits are applied to customers." On no match, the headline is `"<Word> mode: <meaning>"` (e.g. "Shadow mode: Plans are checked and logged; nothing is blocked."), status `neutral` "For information". The refused case keeps its amber rule and its existing note |
| FR-E2 | `HealthTile` gains an optional **`pageLink: { href: string; text: string } \| null`**, rendered as a visible link at the foot of the tile. Entitlements: "Open Plans & entitlements (plans and account lookup)" → `/admin/business-os-tiers`. The "Mode" figure is no longer itself a link (it had no visible destination). Tiles 6/7 use the same field (§7) |
| FR-E3 | The figure label becomes **"Mode in effect"**. A render test asserts that the entitlements tile's rendered text contains **no digit** outside a labelled figure, and that every figure on every tile has a non-empty label. The "0" is identified in §8.3 |
| FR-E4 | Shadow is never green (§8.1) |

### 8.3 What is the "0" the user saw? (RC-5.2)

**It is not produced by the entitlements tile.** The evaluator gives that tile one figure whose value is a word, and the tile component renders nothing else (V-14). The candidates, most likely first:

1. **On Plans & entitlements after an account lookup: "Capabilities in force (0 of N)".** An account with no plan row (`anomaly: no_plan_row`) resolves every capability to `false`, so the header reads "0 of N". The label exists, but nothing says **why** it is zero. In shadow mode, with accounts not yet given plan rows, this is the likeliest unexplained "0" (V-15).
2. **A neighbouring Health tile.** In the 3-column layout, the entitlements tile sits next to "Critical audit events", whose figures are labelled only "Last 24 h: 0" and "Last 7 days: 0" (the noun is in the tile title, not the figure label).
3. **The collapsed "Withholds" list on a plan card**, where `sms.messages` reads "0 per month".

**Proposed fixes, conditional on the user's answer (Q-U1):**
- (1) In `EntitlementSnapshot.tsx`, when `anomaly === 'no_plan_row'`, add one line under the header: "0 because this account has no plan row yet, so nothing resolves for it (shadow mode records this; nothing is blocked)." That file's own render and source tests are extended.
- (2) Make every Health figure label self-describing ("Critical events, last 24 h", "Failed AI actions, last 24 h"). This is a wording edit in `evaluateHealth.ts`, and it satisfies "every number is labelled" wherever the "0" was.

Dev will do **(2) in any case** (cheap, and it closes FR-E3 on Health), and (1) or (3) according to the answer.

### 8.4 RC-5.3: docs on the entitlements mode (OQ-8: shadow is deliberate)

| Doc | Change |
|---|---|
| `CLAUDE.md:799` | "`BOS_ENTITLEMENTS_MODE` is unset in production" → "**production runs in `shadow` on purpose (collect data first, 2026-09-27): plans are resolved and logged, nothing is refused.** A refused `enforce` also becomes `shadow`; the Health tile then shows the amber 'Enforcement requested but not active'." Keep "Nothing is enforced yet". The "no commercial tier is configured" clause waits on **Q-U3**. Change History row |
| `docs/architecture/BUSINESS_OS_ENTITLEMENTS.md:9` | The same correction, the refused-enforce caveat, and a Change History row |
| `docs/BUSINESS_OS_ENTITLEMENTS_APPLY_RUNBOOK.md:9` | Keep the apply-time statement (true when it was applied); add "Since then production has been set to `shadow` deliberately (2026-09-27)"; Change History row |
| `docs/requirements/BUSINESS_OS_TIER_BILLING_REUSE_PLAN.md:128` (F-24) | A dated note beside F-24, and a Change History row |
| `docs/workplans/business-os-subscription-entitlements.md:1752, 1776` | **Not edited**: they are historical records of what was true then |

**`CLAUDE.md` admin row and `ADMIN_IDENTIFICATION_AND_ACCESS.md` (re-measured at implementation, not assumed):**
- add register row 83, `jobs-queues#GET`, gated from birth;
- the census becomes 83 handlers / 54 route files = 77 `requireAdmin` + 6 inline + 0 open; `/admin` pages 26;
- a Change History row in both;
- no guard cap moves.

These numbers change if Admin Archiving slice 2b lands first.

### 8.5 Entitlements guard registration

No new file imports `lib/business-os/entitlements/**`. The Health route's existing `KNOWN_NON_GATE_IMPORTERS` entry (`['getEntitlementModeSetting']`) is unchanged, because the route's imports from that module do not change. `npm run test:bos-entitlements` is in the local run to prove it (slice 2's CI break). **If implementation adds any such import, it is registered with exact symbols in the same change.**

---

## 9. Files to Create / Modify

### 9.1 PR-1 (A + E)

| File | Action | Reason |
|---|---|---|
| `vercel.json` | modify | Remove 3 AP crons (§4) |
| `lib/cron/bosCronJobs.ts` | create | The registry (needed by the `vercel.json` test; pure data) |
| `lib/cron/__tests__/vercelCrons.test.ts`, `bosCronJobs.test.ts` | create | Part A + FR-R9 (the adoption assertion lands with PR-2) |
| `lib/admin/health/healthTypes.ts` | modify | `'green'`, `pageLink` |
| `lib/admin/health/evaluateHealth.ts` | modify | `GREEN_ELIGIBLE`, completeness, the colouring order, entitlements wording, self-describing labels |
| `app/admin/components/health/HealthTile.tsx`, `HealthGrid.tsx` | modify | Green style, "For information", `pageLink`, intro line |
| `lib/admin/health/__tests__/*.test.ts`, `app/admin/__tests__/health.*.test.ts(x)`, `app/api/admin/health-summary/__tests__/*.test.ts` | modify | Re-ruled guard, fuzz invariant, new wording |
| `app/admin/business-os-tiers/components/EntitlementSnapshot.tsx` (+ its tests) | modify **only if Q-U1 = (1)** | The "0 of N" explanation |
| `CLAUDE.md`, `docs/architecture/BUSINESS_OS_ENTITLEMENTS.md`, `docs/BUSINESS_OS_ENTITLEMENTS_APPLY_RUNBOOK.md`, `docs/requirements/BUSINESS_OS_TIER_BILLING_REUSE_PLAN.md` | modify | RC-5.3 |
| `docs/AGENT_EXECUTION_FLOW.md`, `docs/VERCEL_ENV_SETUP.md` | modify | FR-A3 |

### 9.2 PR-2 (B + C + D)

| File | Action | Reason |
|---|---|---|
| `supabase/migrations/20261011_bos_cron_runs.sql` | create | §5.2 (date re-checked) |
| `supabase/migrations/__tests__/bos-cron-runs.migration.test.ts` | create | Static pins |
| `lib/cron/cronRunRecorder.ts` + `__tests__/cronRunRecorder.test.ts` | create | §5.4 |
| `lib/repositories/BosCronRunRepository.ts` + test + import guard | create | §5.5 |
| `lib/repositories/AdminJobsQueuesRepository.ts` + test + isolation guard | create | §6.1 |
| `lib/repositories/index.ts` | modify | Exports (skill step 4) |
| `app/api/cron/{12 BOS routes}/route.ts` | modify | Rename to `runJob`; `export const GET = withCronRunRecord(...)` |
| `app/api/cron/__tests__/runRecord.adoption.test.ts` | create | Per-job adoption (source + behaviour) |
| `lib/admin/jobs/{jobsQueuesTypes,jobStatus,queueFigures,readJobsQueues,buildJobsQueuesView}.ts` + tests | create | §6.2, §6.3 |
| `lib/admin/health/{rules,evaluateHealth,healthTypes}.ts` | modify | Tiles 6/7 vocabularies, rules, measurements |
| `app/api/admin/jobs-queues/route.ts` + `__tests__/route.test.ts` | create | §6.4 |
| `app/api/admin/health-summary/route.ts` + tests | modify | Two more read groups; `underDeadline` moved to the shared orchestrator |
| `app/admin/jobs-queues/page.tsx`, `app/admin/components/jobs/*.tsx` + render/source tests | create | §6.5 |
| `app/admin/components/AdminSidebar.tsx`, `AdminHeader.tsx`, `__tests__/AdminSidebar.nav.test.ts` | modify | §6.6 |
| `docs/admin/ADMIN_IDENTIFICATION_AND_ACCESS.md`, `CLAUDE.md` (admin row) | modify | §8.4 counts |

### 9.3 Coordination

Admin Archiving slice 2b is uncommitted in another worktree (`agent-ae8876d4ecf0cdc04`). If it merges first, it may add admin handlers (changing §8.4's counts), a migration dated `20261011`, or sidebar changes. Resolution: keep both sides and re-measure. Nothing in this slice edits an archiving file.

---

## 10. Live Checks Owed by the User (read-only SQL)

**Dev runs none of these.** Paste each block into the Supabase SQL editor on its own. None writes.

| # | When | Pass |
|---|---|---|
| L-5.1 | Before PR-2 merges | Each of the 5 tables lists `status, claimed_at, attempts, next_attempt_at, created_at, error_message`; the two payment tables also `scheduled_at`; automations also `executed_at`. ✅ **Recorded 2026-09-27:** every column the page reads exists with the expected types. `payment_automation_executions.scheduled_at` and both payment tables' `created_at` are nullable; `payment_reminders.scheduled_at` is NOT NULL |
| L-5.2 | Before PR-2 merges | Record every status value and count. **Any value outside the §6.1 vocabulary → tell Dev before merge** (it will show as "unrecognised status"). ✅ **Recorded 2026-09-27:** `daily_briefing_sends` sent 20, skipped 25; `lead_responses` sent 1, skipped 2; `payment_reminders` cancelled 2, pending 3, sent 7; `insight_actions` and `payment_automation_executions` no rows. All within each queue's known list in `AdminJobsQueuesRepository` |
| L-5.3 | Before PR-2 merges | Recorded (do not assert a count; slice 4 §15.8 found indexes the repo lacks). ✅ **Recorded 2026-09-27:** each queue has a partial "pending" index on its due column |
| L-5.4 | Before PR-2 merges | Recorded. Any table above ~100k rows → Dev re-plans the counts before merge. ✅ **Recorded 2026-09-27:** approximate rows 45 / 0 / 3 / 0 / 12 (`daily_briefing_sends` / `insight_actions` / `lead_responses` / `payment_automation_executions` / `payment_reminders`), all ≤ 160 kB, far below the ~100k gate |
| L-5.5 | Before PR-2 merges | Dead-letter rows (if any) carry exactly the marker; automations' failed rows fall into the known labels. ✅ **Recorded 2026-09-27:** no failed or dead-lettered rows |
| L-5.6 | **Before PR-1 merges** | Recorded: the number of AP agents that stop running on a schedule. ✅ **Recorded 2026-09-27:** `scheduled_active_enabled_agents = 0`, `owners = 0`, `most_recent_scheduled_run = null`. Retiring the AgentsPilot crons stops no one's scheduled agents |
| L-5.7 | After applying the migration | The migration's Step 3 row: all true; Step 4 text starts `DRY RUN PASS`; nothing kept = 0 / 1 ✅ **Recorded 2026-09-27 (after apply in PROD):** Step 3 access check: one row, all 15 columns true. Step 4 dry run: `DRY RUN PASS` with D-1 to D-20 and D-2a/b/c all PASS. Nothing kept: 0 rows named `dry-run-job`. The file was applied and PR #123 merged first; Steps 3 and 4 were run straight after. |
| L-5.8 | After PR-2 deploys: +2 h, and the next day after 09:00 UTC | +2 h: the 9 sub-daily jobs each have ≥ 1 `vercel_cron` run and none is late. Next day: all 12. **This is the OQ-2 verification** |
| L-5.9 | After PR-1 deploys | Vercel → Project → Settings → Cron Jobs lists exactly the 12 BOS paths |
| L-5.10 | Before PR-2 merges (Offir or the user, Vercel dashboard) | Project → Settings → Functions: is Fluid compute on, and what is the default max duration? Confirms the 300 s assumed for the 5 routes with no `maxDuration` (F-9) ⏳ **Still open (Offir emailed 2026-09-27, no reply yet). No longer a merge gate:** Vercel's docs state the Fluid compute default is 300 s (our assumption) and a project default can be raised to at most 800 s; above that needs a per-function `maxDuration`, which none of the 5 routes has. So the migration's 20-minute bound (1,140 s threshold) cannot be exceeded. Only the 5 assumed values in `bosCronJobs.ts` could need a small code change if Offir reports a non-default value. |
| L-5.11 | After PR-2 is implemented, before merge | `npm run schema:check` (read-only zero-row selects) is clean for the new reads ✅ **Recorded 2026-09-27 (against main `03f5402f`):** 32 of 605 selects BROKEN, **all pre-existing and none from slice 5**; the new run-record and queue selects pass. Classified in §20.3. |
| L-5.12 | After PR-2 deploys | Vercel logs: `Health summary served` and `Jobs and queues served` `totalMs` ≤ ~1.5 s p50, ≤ 3 s worst |

```sql
-- L-5.1: the columns the page reads, on the five queue tables
SELECT table_name, column_name, data_type, is_nullable
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name IN ('payment_reminders', 'payment_automation_executions',
                     'daily_briefing_sends', 'lead_responses', 'insight_actions')
  AND column_name IN ('id', 'status', 'claimed_at', 'attempts', 'next_attempt_at',
                      'created_at', 'scheduled_at', 'error_message', 'executed_at')
ORDER BY table_name, column_name;
```

```sql
-- L-5.2: status values actually present, with counts
SELECT 'payment_reminders' AS queue, status, count(*) FROM public.payment_reminders GROUP BY status
UNION ALL SELECT 'payment_automation_executions', status, count(*) FROM public.payment_automation_executions GROUP BY status
UNION ALL SELECT 'daily_briefing_sends', status, count(*) FROM public.daily_briefing_sends GROUP BY status
UNION ALL SELECT 'lead_responses', status, count(*) FROM public.lead_responses GROUP BY status
UNION ALL SELECT 'insight_actions', status, count(*) FROM public.insight_actions GROUP BY status
ORDER BY 1, 2;
```

```sql
-- L-5.3: live indexes (record; do not assert a count)
SELECT tablename, indexname, indexdef
FROM pg_indexes
WHERE schemaname = 'public'
  AND tablename IN ('payment_reminders', 'payment_automation_executions',
                    'daily_briefing_sends', 'lead_responses', 'insight_actions')
ORDER BY tablename, indexname;
```

```sql
-- L-5.4: rows and size per queue table
SELECT relname AS table_name,
       n_live_tup AS approx_rows,
       pg_size_pretty(pg_total_relation_size(relid)) AS total_size
FROM pg_stat_user_tables
WHERE schemaname = 'public'
  AND relname IN ('payment_reminders', 'payment_automation_executions',
                  'daily_briefing_sends', 'lead_responses', 'insight_actions')
ORDER BY relname;
```

```sql
-- L-5.5: failed / dead-letter rows by FIXED label only (never shows a message)
SELECT queue, status, label, count(*) FROM (
  SELECT 'payment_reminders' AS queue, status,
         CASE WHEN error_message = 'dead-letter: max attempts' THEN 'dead-letter marker'
              WHEN error_message IS NULL THEN 'no message' ELSE 'other message' END AS label
  FROM public.payment_reminders WHERE status = 'failed'
  UNION ALL
  SELECT 'payment_automation_executions', status,
         CASE WHEN error_message = 'dead-letter: max attempts' THEN 'dead-letter marker'
              WHEN error_message IN ('max executions reached', 'cooldown active') THEN 'guardrail skip'
              WHEN error_message IS NULL THEN 'no message' ELSE 'other message' END
  FROM public.payment_automation_executions WHERE status IN ('failed', 'dead_letter')
  UNION ALL
  SELECT 'daily_briefing_sends', status,
         CASE WHEN error_message = 'dead-letter: max attempts' THEN 'dead-letter marker'
              WHEN error_message IS NULL THEN 'no message' ELSE 'other message' END
  FROM public.daily_briefing_sends WHERE status = 'failed'
  UNION ALL
  SELECT 'lead_responses', status,
         CASE WHEN error_message = 'dead-letter: max attempts' THEN 'dead-letter marker'
              WHEN error_message IS NULL THEN 'no message' ELSE 'other message' END
  FROM public.lead_responses WHERE status = 'failed'
  UNION ALL
  SELECT 'insight_actions', status,
         CASE WHEN error_message = 'dead-letter: max attempts' THEN 'dead-letter marker'
              WHEN error_message IS NULL THEN 'no message' ELSE 'other message' END
  FROM public.insight_actions WHERE status = 'failed'
) t
GROUP BY queue, status, label
ORDER BY 1, 2, 3;
```

```sql
-- L-5.6 (before PR-1): AgentsPilot agents that stop running on a schedule
SELECT count(*)                AS scheduled_active_enabled_agents,
       count(DISTINCT user_id) AS owners,
       max(last_run)           AS most_recent_scheduled_run
FROM public.agents
WHERE mode = 'scheduled'
  AND status = 'active'
  AND schedule_enabled = true
  AND schedule_cron IS NOT NULL;
```

```sql
-- L-5.8 (after PR-2 deploys): one row per job that has recorded a run
SELECT job,
       count(*) FILTER (WHERE source = 'vercel_cron')                         AS cron_runs,
       max(started_at) FILTER (WHERE source = 'vercel_cron')                  AS last_cron_start,
       count(*) FILTER (WHERE outcome = 'failed'
                           OR (outcome = 'running' AND deadline_at < now()))  AS bad_runs
FROM public.bos_cron_runs
GROUP BY job
ORDER BY job;
-- Expect 9 rows at +2 h (all but insight-metrics, insight-detect, payment-reminders),
-- and 12 rows the next day after 09:00 UTC. A missing job = its calls are refused or it is not scheduled.
```

L-5.7 is the migration's own Step 3 and Step 4 (§5.2). The SQL lives only in the migration file, following the archiving precedent (SA R-5 there).

---

## 11. Technical Forks for SA

| # | Fork | Options | Recommendation |
|---|---|---|---|
| **F-1** | Reading run history | (a) one read-only SQL function in the same migration, over the table it creates; (b) ~72 PostgREST calls (6 per job); (c) a paged 7-day read (~7.5k rows) summarised in TS | **(a)**: one round trip, exact, index-backed, and it reads only a table we own and create in the same file |
| **F-2** | Reading the five queues | (a) PostgREST head counts through an admin repository (~63 small parallel requests), as A-6 assumes; (b) a second SQL function in the migration | **(a)**: we do not own those tables, their live shape is unverified (L-5.1/5.2), and a drifted column makes only its queue "Could not check". (b) is the escalation if L-5.12 misses the budget |
| **F-3** | When to write a record | (a) the recorder's own strict test (production + secret present + timing-safe header match); (b) reuse each route's verifier | **(a)**: two routes fail open (V-2), and every verifier returns `true` in development, which shares the production database. (a) makes FR-R3 true for all 12 and turns a lost secret into a visible Stopped |
| **F-4** | How 12 routes adopt it | (a) a wrapper around the renamed handler, with counts taken from the response body through a per-job allow-list; (b) explicit start/finish calls inside each body | **(a)**: three lines per route, no edit to any job body or exit path. The cost: counts depend on the response shape, which the registry test pins per job |
| **F-5** | Retention mechanism | (a) prune on every recorded run (a PostgREST delete, bounded by an index); (b) one designated job prunes; (c) a 13th cron; (d) `pg_cron` | **(a)**: uniform and self-healing. (c) breaks "exactly 12 crons"; (d) is out of scope |
| **F-6** | "Recording began" baseline | (a) a one-row `bos_cron_run_recording` table written by the migration; (b) a marker row in `bos_cron_runs`; (c) no baseline | **(a)**. (c) leaves every job grey forever if nothing ever records, which is exactly the OQ-2 failure. (b) mixes a fact about the install with run rows |
| **F-7** | Manual authorised calls | (a) record `source`; only `vercel_cron` runs reset "late"; (b) any recorded run counts | **(a)**: a manual call with the secret must not hide a dead schedule. `User-Agent` is spoofable, but only by a caller who already holds the secret |
| **F-8** | "Failed / dead-lettered in 24 h" with no failure timestamp (V-10) | (a) window by due time (payment tables) or queue time (others), labelled; (b) add `finished_at` to the 5 queue tables (a change to tables this slice must not change, A-6); (c) sum the jobs' own failure counts from run records (not all jobs report one; the reaper's dead-letters are invisible to them) | **(a)**, with the R-6 limitation stated on the page. (b) is a candidate follow-up |
| **F-9** | Time limit for the 5 routes with no `maxDuration` | (a) assume 300 s (+60 s margin) in the registry, confirmed by L-5.10; (b) add explicit `maxDuration` exports | **(a)**: (b) changes job configuration, which is out of scope for a monitoring slice. A wrong assumption only delays "did not finish"; lateness still catches a dead job |
| **F-10** | Where the shared read orchestration lives | (a) `lib/admin/jobs/readJobsQueues.ts` with injected readers; (b) a private `app/api/admin/_shared/` module importing the repository | **(a)**: `lib/admin/**` keeps its "never names an admin repository" rule, and there is no new non-route file under `app/api/admin` |
| **F-11** | **C-10 re-ruling** | as §8.1 | Approve the four-part replacement. `GREEN_ELIGIBLE` is code, not data |
| **F-12** | The old grey "Normal" | (a) keep `neutral` only for the entitlements tile, relabelled "For information"; (b) remove `neutral` | **(a)**: entitlements must not be green (OQ-9) and is not "not measured" |
| **F-13** | `error_class` constraint | (a) a closed `CHECK IN` list; (b) a regex | **(a)**: the strongest FR-R5 guarantee. A new class is a small migration, and rare |
| **F-14** | Recorder timing | (a) awaited writes, each under a 1.5 s deadline; (b) `waitUntil` / `after()` | **(a)**: (b) is a new pattern (and experimental in Next 14). R-4 bounds (a) |
| **F-15** | Idempotency of the migration | (a) plain `CREATE` in one transaction (fails cleanly the second time; the P01 pre-check says "already applied"), as `20261010`; (b) `IF NOT EXISTS` | **(a)** |
| **F-16** | PR split | (a) PR-1 = A + E, PR-2 = B + C + D; (b) one PR | **(a)**, as the requirement suggests |

---

## 12. Risks

| # | Risk | Severity | Mitigation |
|---|---|---|---|
| R-1 | Twelve production jobs change, four of which send email to real clients | Med | The wrapper never edits bodies; recording is gated, deadline-bound and never throws (FR-R4); per-job adoption tests; the existing `insight-detect` route test passes unedited; the response object is returned as is |
| R-2 | A hand-applied migration | Med | House-style runbook (pre-check, access check, a dry run that always rolls back, nothing kept, rollback); code tolerates either order |
| R-3 | The recorder's gate makes local and preview runs invisible | Low | Intended: one database is shared. Tests exercise the recorder with the env set |
| R-4 | A job that runs close to its limit is killed during the finish write and shows "did not finish" although its work completed | Low | Deadlines of 1.5 s; the start adds ~30–90 ms; the 60 s jobs are drains with small batches. The per-job log still says "completed" |
| R-5 | Count extraction drifts from a response shape | Low–Med | Per-job paths pinned by the adoption test with each route's real response; a missing path just omits that count |
| R-6 | Failure windows use due or queue time (F-8): a lead chase that dead-letters two days after being queued shows amber (7 d), not red (24 h) | Med | Labelled on the page and tile; recorded for R-18 / a follow-up (`finished_at` on the queues) |
| R-7 | ~63 parallel queue reads plus an RPC added to the Health route | Med | Deadlines, `allSettled` isolation, timing logs (L-5.12); fallback is splitting tiles 6/7 into their own request (UI-only), then F-2(b) |
| R-8 | The C-10 reversal lets green return where it should not | Med | `GREEN_ELIGIBLE` is code; rule colours stay red/amber; fuzz invariant; source guard pins green to one style entry; C-18 untouched |
| R-9 | A lost `CRON_SECRET` makes all jobs go red at once | Low (desired) | That is the signal OQ-2 asked for. The page says what "Stopped" means |
| R-10 | Merge conflicts with Admin Archiving slice 2b (sidebar, counts, migration date) | Low | §9.3: keep both sides, re-measure |
| R-11 | Part A stops AgentsPilot scheduled agents | Accepted (OQ-4) | L-5.6 recorded before merge; reversible by one line |
| R-12 | Entitlements-guard CI break | Low | No new import; `npm run test:bos-entitlements` run locally |

---

## 13. Business Questions for the User

Only genuine business choices. The technical forks go to SA.

| # | Question | Why it matters | Suggested |
|---|---|---|---|
| **Q-U1** | Where exactly was the "0"? (a) On Plans & entitlements after looking up an account: "Capabilities in force (0 of …)"; (b) on the Health page, a tile next to the entitlements one (for example "Critical audit events: Last 24 h 0"); (c) somewhere else. A screenshot settles it | The entitlements tile itself shows no number. The fix goes where the number is | If you do not remember: Dev relabels every Health figure (planned anyway) **and** adds the one-line explanation to "0 of …" on the lookup |
| **Q-U2** | When the payment-retry job retries a failed card payment and the card is declined again, should the job show "Partly done" (amber)? | A decline is a normal business outcome, not a broken job. Amber for it would fire often and teach you to ignore amber | **No.** Show the number of declines on the page, without colouring |
| **Q-U3** | `CLAUDE.md` says "no commercial tier is configured", but the plan configuration has Essentials ($79) and Autopilot ($129). Is that sentence out of date? | Slice 5 already edits that line for the shadow-mode correction | If yes, Dev rewrites it to "Essentials and Autopilot are configured; nothing is enforced" |

---

## 14. Test Plan

### 14.1 Unit

**Registry and `vercel.json`** (`lib/cron/__tests__/`):
- exactly 12 crons, none AgentsPilot, the three AP route files still on disk;
- registry ↔ `vercel.json` equality;
- the interval parser (four supported shapes; anything else throws);
- derived late/stopped thresholds equal the requirement table (15/20, 25/40, 70/130 min; 25/49 h);
- `timeLimitSeconds` ↔ `export const maxDuration`;
- no money key;
- ids match the migration's `job` regex.

**Recorder** (`cronRunRecorder.test.ts`, mocked repository):

| Case | Expectation |
|---|---|
| Not production / no secret / wrong header / development | Handler called once; **no** repository call; the response is the same object |
| Authorised, "nothing to do" body | start → handler → finish(`succeeded`, counts) → prune; `source` from the User-Agent |
| Partly done condition met | `partial` |
| Handler returns 500 | `failed`, `http_error`, `http_status 500`; response unchanged |
| Handler throws | `failed`, `exception`; the **same error** is rethrown; finish called before the rethrow |
| `AbortError` thrown | `timeout` |
| Start fails with `PGRST205` / generic error / exceeds 1.5 s | Handler still runs; response identical; no finish, no prune; one `warn` with `reason` only |
| Finish or prune fails or times out | Response identical; nothing thrown |
| Counts extraction | Only allow-listed finite numbers; strings, arrays and nested objects dropped; booleans → 1/0; `totalValueImpact` never present |
| Body not JSON | `succeeded`, `counts {}`, one `warn` |
| Log arguments | Never contain the body, a header value or an error message |

**Repositories:**
- `BosCronRunRepository`: the insert allow-list, `finishRun`'s `eq('outcome','running')`, the delete cutoff, `isMissingTable`, and the `{ data, error }` shape on error.
- `AdminJobsQueuesRepository`:
  - context required;
  - per queue, the exact filters of §6.1, including the null-safe marker comparisons and PostgREST quoting of the marker (it contains a colon and a space);
  - every `select()` argument ⊆ `{id, scheduled_at, next_attempt_at, created_at}`;
  - the RPC call parameters;
  - the abort signal is attached;
  - errors surface as `{ data: null, error }`.
- **Source guards:** only `cronRunRecorder.ts` imports `BosCronRunRepository`; only `app/api/admin/**` names `AdminJobsQueuesRepository`.

**Pure logic** (`lib/admin/jobs/__tests__/`):
- Job status with a simulated clock, **one job of each schedule type** (5 min, 15 min, hourly, daily): Healthy → Late at interval + grace + 1 min → Stopped at 2 × interval + grace + 1 min. This is the acceptance "amber then red on the first load after …";
- no run: grey until the late threshold from the baseline, then Late, then Stopped;
- the baseline is `COALESCE(first run, installed_at)`;
- manual runs do not reset lateness;
- keeps failing (3; daily 2), skipping an in-progress run;
- a run past its deadline counts as "did not finish" and as bad;
- partly done;
- could not check.
- Queue status: stuck; stopped draining vs behind per drain interval; dead-letter 24 h red / 7 d amber; failures amber; a due item in the future never colours; one queue failing → others still measured.

**Health** (`evaluateHealth.test.ts`, `rules.config.test.ts`, `qa-edge.test.ts`):
- tiles 6/7 rules are non-empty, use only their own vocabularies, are ordered, and never say OK;
- the §8.1 order;
- the green invariant fuzz (rule lists × inputs);
- entitlements never green; `neutral` only on entitlements;
- C-18 unchanged (an empty spend rule list plus a lower bound → amber);
- entitlements wording (FR-E1), `pageLink` (FR-E2), every figure labelled (FR-E3);
- **A-8:** the tile figures equal the page view for one shared fixture.

### 14.2 Routes

`app/api/admin/jobs-queues/__tests__/route.test.ts`, and the updated `health-summary` tests (mocked repository and gate):

| Case | Expectation |
|---|---|
| Signed out; the auth lookup throws | 401; no read |
| Not an admin; the admin check throws | 403; no read |
| Any query parameter | 400, fixed message; 401/403 win over 400 |
| Happy path | 200; 12 jobs in registry order, 5 queues, statuses from the fixture |
| Run summary missing (`PGRST202`) | 200; jobs "Could not check", "not installed yet"; queues measured |
| One queue read fails | 200; only that queue "Could not check" |
| Deadline passes | Aborted, the tile or section is `unavailable`, no unhandled rejection |
| Unexpected throw | 500; `details` only in development |
| **Leak check** | The serialised body and every logger argument contain none of: `payload`, `recommendation`, `error_message`, `skip_reason`, `dead-letter: max attempts`, `cooldown active`, an email, or any marker string planted in the mocks |

### 14.3 Cron adoption (per job)

`app/api/cron/__tests__/runRecord.adoption.test.ts`:
- **Source:** each of the 12 route files contains exactly one `export const GET = withCronRunRecord('<registry id for this path>', runJob)` and no other `export … GET`.
- **Behaviour:** `describe.each` over the 12, with each route's services mocked to "nothing to do", and the environment set to production with a matching secret and a `vercel-cron/1.0` User-Agent. Each asserts one `startRun(job)`, the handler's own response status, and one `finishRun` with outcome `succeeded` and the expected count keys. Then the unauthorised variant: **no** repository call and the route's own 401.

### 14.4 Migration

`supabase/migrations/__tests__/bos-cron-runs.migration.test.ts` (static, §5.2), in `npm run test:bos-entitlements`. The live proof is the runbook's pre-check, access check and dry run (L-5.7).

### 14.5 Render and source guards

- **Health render:** green shows "Healthy" and "All clear"; "For information"; `pageLink` is visible with its text; the class sets for green, neutral, not_measured and unavailable are all distinct.
- **Health source guard:** green classes only in `STATUS_STYLES.green`; no OK; no runtime import of the rules or evaluator (C-21); no legacy-dashboard link.
- **Jobs page:** a render test with a fixture; no action buttons; no `POST`; no forbidden field names in the rendered text; "Due now" and "Scheduled for later" are separate; the automations "no live producer" line.
- **Sidebar nav test** (25 / 26 / Monitor 5), and the `business-os-llm` and `business-os-tiers` nav tests pass unedited.
- `admin-authz-surface.guard.test.ts`: the new handler is found and gated (no cap change). `enforcementPoints.test.ts` is unchanged and green.

### 14.6 Local commands (all run; real output pasted in the Implementation Record)

```bash
npx jest app/admin lib/admin app/api/admin app/api/cron lib/audit lib/repositories lib/business-os/usage lib/business-os/entitlements lib/business-os/llm lib/cron supabase/migrations/__tests__
npm run test:bos-entitlements
npm run test:authz-guard
npm run typecheck:bos-llm
npm run check:bos-llm-literals
npm run lint:hooks
npx eslint vercel.json lib/cron lib/admin app/admin/jobs-queues app/admin/components app/api/admin/jobs-queues app/api/admin/health-summary app/api/cron lib/repositories/BosCronRunRepository.ts lib/repositories/AdminJobsQueuesRepository.ts lib/repositories/index.ts
# next build with the CI placeholder env from .github/workflows/build.yml (https://ci.invalid, no real key)
npm run build
```

The only accepted pre-existing failure is the parked baseline, named by its test name: "TokenUsageRepository account contract › pins every public method and its arity; no account filter became optional". Any other failure is new. The ESLint line drops `vercel.json` if the config does not lint JSON.

### 14.7 Manual checks for QA and the user (as a platform admin)

- **After PR-1:**
  - M-1: Health shows green "Healthy · All clear" on a clear, measured tile (e.g. Business OS AI settings with 0 off); entitlements is grey "For information" with the plain sentence and a visible "Open Plans & entitlements (plans and account lookup)" link;
  - M-2: L-5.9.
- **After the migration:** L-5.7.
- **After PR-2:**
  - M-3: `/admin/jobs-queues` is under Monitor, third; a non-admin is refused (page redirect; API 403, 401 signed out);
  - M-4: all 12 jobs and 5 queues are listed; no buttons besides Refresh;
  - M-5: tiles 6/7 show the same numbers as the page and link to it;
  - M-6: L-5.8 at +2 h and the next day;
  - M-7: L-5.12.

---

## 15. Non-Compliant Files and Flags

| File | Finding | Action |
|---|---|---|
| Every file this slice modifies | **0 `console.*`** (counted per file) | None needed |
| `app/api/run-scheduled-agents/route.ts` | Uses `console.*` | **Not touched** (only `vercel.json` changes), so the rule does not apply |
| `app/api/cron/{insight-detect, insight-metrics, abandoned-proposal-invoices, insight-automations}/route.ts` | Direct `supabaseServer` queries (12 / 3 / 3 / 2), a deprecated pattern (CLAUDE.md) | **Flagged, not fixed.** This slice renames only `GET`. A repository conversion of production send paths is its own cycle |
| `.claude/skills/business-os-insights/SKILL.md` Rule 7; comments in `lead-response/route.ts:26-31`, `insight-actions/route.ts:29-35` | Say the insight crons fail open; the code fails closed (V-24) | Flagged to TL; not edited (the comments are in lines this slice does not change) |
| `CLAUDE.md:799` "no commercial tier is configured" | Possibly stale (V-18) | Q-U3 |

---

## 16. Task List

**Before code**
- [x] T0a: SA workplan review, **including the written C-10 re-ruling (F-11)**: approved with SC-1 to SC-12 and C-10R (2026-09-27)
- [x] T0b: The user answered (2026-09-27): **Q-U1** leave the "0" as is (no change to the Plans & entitlements page; the Health relabelling still applies); **Q-U2** no colour for payment-retry declines (count shown in PR-2); **Q-U3** PARKED, and **CLAUDE.md is not edited in this slice at all** (§18)
- [ ] T0c: The user records **L-5.6** (before PR-1 can merge) and L-5.1 to L-5.5, L-5.10 (before PR-2 can merge). ✅ **L-5.6 recorded 2026-09-27:** `scheduled_active_enabled_agents = 0`, `owners = 0`, `most_recent_scheduled_run = null` ✅ **L-5.1 to L-5.5 recorded 2026-09-27** (see §15). **L-5.10 (Offir) still owed** for PR-2

**PR-1 (A + E), uncommitted**
- [x] T1: `lib/cron/__tests__/vercelCrons.test.ts`. **Deviation D-1:** the registry (`bosCronJobs.ts`) and `bosCronJobs.test.ts` move to PR-2; PR-1 pins the 12 entries literally
- [x] T2: `vercel.json`: remove the 3 AP entries (§4)
- [x] T3: `healthTypes.ts` (`green`, `pageLink`), `evaluateHealth.ts` (`GREEN_ELIGIBLE`, completeness, the §8.1 order, entitlements wording, self-describing labels) + tests (fuzz invariant, C-18 unchanged)
- [x] T4: `HealthTile.tsx` / `HealthGrid.tsx` (green style, "For information", `pageLink`, intro) + re-ruled source guard + render tests
- [x] T5: The "0": per Q-U1, **no change** to `EntitlementSnapshot.tsx` or the Plans & entitlements page; every Health figure relabelled to describe itself (done in T3)
- [x] T6: Docs: RC-5.3 on three docs (`CLAUDE.md` deferred, §18; the admin access doc needs no PR-1 edit, D-7), FR-A3 (two AP docs)
- [x] T7: Run §14.6; paste output (§17.3); implementation record; notify TL. **No commit**

**PR-2 (B + C + D), uncommitted, after PR-1 review**
- [x] T8: The migration + static test (§5.2); the date prefix re-checked on `main`
- [x] T9: `BosCronRunRepository` + tests + import guard; `index.ts`
- [x] T10: `cronRunRecorder.ts` + tests (§5.4)
- [x] T11: Adopt in the 12 routes (three lines each) + `runRecord.adoption.test.ts`; `bosCronJobs.test.ts` gains the adoption assertion; `insight-detect/__tests__/route.audit.test.ts` passes unedited
- [x] T12: `AdminJobsQueuesRepository` (queue specs, RPC) + tests + isolation guard
- [x] T13: `lib/admin/jobs/*` (types, job status, queue figures, orchestrator with Zod on RPC rows, view builder) + tests with a simulated clock
- [x] T14: `GET /api/admin/jobs-queues` + route tests
- [x] T15: `health-summary`: tiles 6/7 via the shared computation; `HEALTH_RULES` for both; `underDeadline` moved into the orchestrator; tests (A-8 equality)
- [x] T16: Page + components + render/source tests; sidebar + header + nav test
- [x] T17: `ADMIN_IDENTIFICATION_AND_ACCESS.md` register row 84 + census re-measured from disk (84 / 78 + 6 / 55 files; 26 pages); Change History. **`CLAUDE.md` not edited** (§18: its admin row no longer carries counts)
- [x] T18: Run §14.6; paste output; implementation record (deviations, "what SA should look at first"); notify TL. **No commit**
- [ ] T19 (user): apply the migration per the runbook; record L-5.7; then L-5.8, L-5.9, L-5.11, L-5.12 at their times. ✅ Migration applied, L-5.7 and L-5.11 recorded 2026-09-27; L-5.8, L-5.9 and L-5.12 still owed (§20)

---

## 17. Implementation Record: PR-1 (Dev, 2026-09-27)

**Nothing is committed** (standing user rule). Everything below is uncommitted in the worktree `neuronforge-admin-bos-reorg`, on `feature/admin-bos-jobs-queues` @ `546f6110`.

### 17.1 What was built

| Part | Change | Where |
|---|---|---|
| A | The 3 AgentsPilot crons removed; the 12 Business OS entries byte-identical and in order; the 3 route files untouched | `vercel.json` |
| A | Pin test: exactly 12, all under `/api/cron/`, equal to the literal list, none of the 3 AP paths, their route files still on disk, no duplicates | `lib/cron/__tests__/vercelCrons.test.ts` (new) |
| A | Retirement and how to reverse it recorded (FR-A3) | `docs/AGENT_EXECUTION_FLOW.md`, `docs/VERCEL_ENV_SETUP.md` (note + new Change History) |
| E / C-10R | `TileStatus` gains `'green'`; `HealthTile.pageLink` added. `HealthRule['colour']` unchanged (red / amber) and `validateRuleList` still rejects `'green'` | `lib/admin/health/healthTypes.ts` |
| E / C-10R | `GREEN_ELIGIBLE` (a `ReadonlySet`, code): settings, failures, spend, critical, scheduled_jobs, queues; **not** `entitlements_mode`. One predicate, `isProvenClearMeasurement` (complete ∧ every metric exact ∧ **every figure** exact). `colourTile` order exactly per C-10R.2. `completeness` on every measurement. `neutral` only for a non-eligible tile, headline supplied by the measurement | `lib/admin/health/evaluateHealth.ts` |
| E / C-18 | Strengthened: the lower-bound amber now fires on an inexact **figure** as well as an inexact metric | same |
| E / wording | `GREEN_HEADLINE = 'All clear'`; `OTHERWISE_GREEN`, `OTHERWISE_GREEN_UNLESS_LOWER_BOUND`, `OTHERWISE_INFORMATION` replace the "Normal" lines | same |
| RC-5.2 | Entitlements: headline `"<Word> mode: <meaning>"` with the FR-E1 sentences; figure **"Mode in effect"**; a visible `pageLink` "Open Plans & entitlements (plans and account lookup)" → `/admin/business-os-tiers`; the refused note unchanged | same |
| RC-5.2 | Every figure self-describing: "Failed AI actions, last 24 h / 7 days", "AI spend, last 24 h / 7 days (USD)", "Critical events, last 24 h / 7 days". The settings labels already were | same |
| E / UI | `GREEN_STYLE` is the one green constant (label "Healthy", `CheckCircle2`, emerald); `STATUS_STYLES.green` references it; `neutral` relabelled "For information" (`Info` icon); the tile renders `pageLink`; the intro line rewritten | `app/admin/components/health/HealthTile.tsx`, `HealthGrid.tsx` |
| E | Comments that said "never green" corrected | `lib/admin/health/rules.ts` (header only), `app/api/admin/health-summary/route.ts` (header only) |
| RC-5.3 | Production mode `shadow`, on purpose, to collect data first, plus the refused-`enforce` caveat; Change History rows | `docs/architecture/BUSINESS_OS_ENTITLEMENTS.md` (Overview + mode table), `docs/BUSINESS_OS_ENTITLEMENTS_APPLY_RUNBOOK.md` (a dated note; the apply-time sentence kept), `docs/requirements/BUSINESS_OS_TIER_BILLING_REUSE_PLAN.md` (F-24) |

**Tiles 6 and 7** are still built by `notMeasuredTile()`: "Not measured yet", no rules, no link, `pageLink: null` (SC-7(f), pinned).

**Tests** (new or re-ruled):
- `evaluateHealth.test.ts`:
  - quiet eligible tiles are green;
  - entitlements is `neutral` with the mode sentence for all three modes;
  - `GREEN_ELIGIBLE` membership;
  - the PR-1 pin for tiles 6/7;
  - labels self-describing;
  - the entitlements `pageLink` and "no digit";
  - no other tile has a `pageLink`;
  - the end-to-end fuzz is now the biconditional (green ⇔ eligible ∧ read ok ∧ no match ∧ every figure exact), with `neutral` only on entitlements;
  - **a new tile-level fuzz over `colourTile`** (4,000 cases), with completeness, figure exactness and metric exactness varied independently;
  - direct cases SC-7(e);
  - a source test that `rules.ts` holds no eligibility and no green (SC-7(c)).
- `health.source.guard.test.ts`, re-ruled:
  - green classes only inside the one `GREEN_STYLE` declaration;
  - `STATUS_STYLES.green` is its only reference;
  - `RULE_CHIP` red/amber only;
  - no green at all in `page.tsx` or `HealthGrid.tsx`;
  - a no-dead-regex self-test; "OK" still forbidden.
- `health.render.test.tsx`:
  - green only on the tile sent as green (checked on every rendered region, count pinned);
  - no green when none is sent;
  - four distinct looks;
  - "Healthy" / "For information" labels;
  - the entitlements link text and href, with no digit on that tile.
- `vercelCrons.test.ts`: new.

### 17.2 Deviations (for SA code review)

| # | Deviation | Why |
|---|---|---|
| D-1 | **The job registry (`lib/cron/bosCronJobs.ts`) and `bosCronJobs.test.ts` are not in PR-1.** `vercelCrons.test.ts` pins the 12 entries as a literal list instead | The registry's time limits depend on L-5.10 (SC-6), and its only consumer is PR-2. Shipping it now would put unreviewed data into `main` a PR early. PR-2 replaces the literal list with the registry (FR-R9) |
| D-2 | New exports from `evaluateHealth.ts`: `colourTile`, `TileMeasurement`, `Completeness`, `isProvenClearMeasurement`, `GREEN_ELIGIBLE`, `MODE_WORDS`, `ENTITLEMENTS_PAGE_LINK` | `colourTile` is the test seam for the SC-7(d) biconditional: the five slice 4 reads cannot yet produce an incomplete measurement or an inexact figure over exact metrics. PR-2 adds the path through the tiles 6/7 inputs |
| D-3 | `NORMAL_HEADLINE`, `OTHERWISE_NORMAL` and `OTHERWISE_NORMAL_UNLESS_LOWER_BOUND` were removed (replaced) | No production caller; only tests used them |
| D-4 | Slice 4 assertions that expected `neutral` / "Normal" for a quiet tile now expect `green` / "All clear" (`evaluateHealth.test.ts`, `qa-edge.test.ts` (2 lines, QA's file), `route.test.ts` (5), `route.qa-edge.test.ts` (3)). Label assertions follow the relabelling (`evaluateHealth.test.ts` "at least" test, `route.qa-edge.test.ts`, render fixtures) | The behaviour change C-10R asks for; SA foresaw the label edits (Q-U1 implications). **Unedited, as SA required:** the negative "a green colour" rule-list cases (`evaluateHealth.test.ts`, `qa-edge.test.ts:43`) and the empty-spend-list C-18 test. `rules.config.test.ts` is untouched |
| D-5 | The entitlements "Mode in effect" figure is no longer itself a link (`href: null`, `linkLabel: null`); the tile's visible `pageLink` carries the navigation. In the non-refused case the figure note is empty, because the headline now carries the meaning | FR-E2: the link must say where it goes, which a word-as-link did not. No duplicate sentence |
| D-6 | Whether an inexact non-spend tile ends as `unavailable` or `not_measured` is decided by `completeness`, exactly per C-10R.2. None of today's five reads can produce that case; it is covered by the tile-level seam tests | C-10R.2 as written |
| D-7 | **`docs/admin/ADMIN_IDENTIFICATION_AND_ACCESS.md` is not edited in PR-1** | It makes no claim about the entitlements mode (grep), and PR-1 adds no handler or page (still 53 route files / 82 handlers / 25 pages in this worktree). Its census moves in PR-2 (SC-12) |
| D-8 | `CLAUDE.md` is not edited at all | User instruction (Q-U3 parked; the user is editing `CLAUDE.md` in another session). Every change it needs is in §18 |
| D-9 | The Jest run also includes `lib/cron` (the new test's home) | Beyond the requested path list, so the new test is covered |

**Branch vs `main`:** `main` moved to `cb644f88` (PR #118, Archiving slice 2b, merged). It changed 25 files, of which only `CLAUDE.md` and `docs/admin/ADMIN_IDENTIFICATION_AND_ACCESS.md` are near this work, and **PR-1 edits neither**. **No file overlap** (checked with `comm` against `git diff --name-only 546f6110 origin/main`). PR-1 touches no sidebar, adds no route and no page. RM merges `main` into the branch; no conflict is expected.

### 17.3 Verification (real output, 2026-09-27)

| Command | Result |
|---|---|
| `npx jest app/admin lib/admin app/api/admin lib/audit lib/repositories lib/business-os/usage lib/business-os/entitlements lib/business-os/llm lib/cron --ci` | **140 suites: 139 passed, 1 failed; 3,129 tests: 3,128 passed, 1 failed.** The one failure is the parked baseline: `lib/business-os/usage/__tests__/tokenUsageRepository.contract.test.ts` › "TokenUsageRepository account contract › pins every public method and its arity; no account filter became optional" (`TokenUsageRepository.ts` untouched) |
| `npm run test:bos-entitlements` | 60 suites / 1,161 tests, all passed |
| `npm run test:authz-guard` | 1 suite / 119 tests, passed |
| `npm run typecheck:bos-llm` | First run: **1 new** error, `route.test.ts(169)`, where the local body type lacked `pageLink`. Fixed (the type gained the field). Re-run: **252 files in scope, 28 errors, 0 new, passed**. It also reports the pre-existing "1 baseline entry is fixed" in `app/api/onboarding/build/route.ts` (not touched; left for the baseline owner) |
| `npm run check:bos-llm-literals` | 46 files in scope, 2 exempt, **0 violations**, passed |
| `npm run lint:hooks` | exit 0 |
| `npx eslint lib/admin/health app/admin/components/health app/admin/page.tsx app/admin/__tests__ app/api/admin/health-summary lib/cron` | exit 0, **0 errors, 0 warnings** |
| Full `tsc --noEmit` (8 GB heap) | 2,863 lines of pre-existing diagnostics; **0 in any touched file** (`lib/admin/health`, `app/admin/components/health`, `app/admin/__tests__/health*`, `app/api/admin/health-summary`, `lib/cron`) |
| `next build` with the CI placeholder env from `.github/workflows/build.yml` (`https://ci.invalid`, no real key, `NODE_OPTIONS=--max-old-space-size=6144`) | **exit 0**, `✓ Compiled successfully`, `✓ Generating static pages (304/304)`. `ƒ /admin` 6.43 kB; `ƒ /api/admin/health-summary`. The `DYNAMIC_SERVER_USAGE` log lines during page-data collection are pre-existing (routes that read cookies or headers), not failures |

Suites run on their own while building: `lib/admin/health` 4 suites / 163 tests; the Health page render 14 and source guard 26; `app/api/admin/health-summary` 2 suites / 46; `lib/cron` 1 suite / 6.

### 17.4 What SA should look at first

1. `evaluateHealth.ts` `colourTile`, the no-match branch: `isProvenClearMeasurement` → LOWER_BOUND amber / not_measured / unavailable → `GREEN_ELIGIBLE` green → neutral. The C-18 strengthening is the `figures.some((f) => !f.exact)` term.
2. `GREEN_ELIGIBLE`: the set, and that `rules.ts` names none of it (source test).
3. `health.source.guard.test.ts`: how `GREEN_STYLE` is isolated (the declaration block is removed before the green-class scan; the reference count is pinned at 2).
4. The two fuzz tests in `evaluateHealth.test.ts`: the end-to-end biconditional over `evaluateHealth`, and the tile-level one over `colourTile` with independent completeness and figure exactness.
5. `entitlementsMeasurement`: the headline, the `pageLink`, and the non-link figure (D-5).

### 17.5 Owed before PR-1 merges

**L-5.6** (the user, read-only SQL in §10): the number of AgentsPilot agents that stop running on a schedule. After deploy: **L-5.9** (Vercel's Cron Jobs list shows the 12) and **M-1** (Health shows green "Healthy · All clear" on clear tiles; entitlements grey "For information" with the plain sentence and the visible link).

### 17.6 Review follow-ups (Dev, 2026-09-27, uncommitted)

SA approved PR-1 with nits and QA passed it. Every fix below is uncommitted. QA's two probe files, `lib/admin/health/__tests__/qa-slice5.test.ts` and `app/admin/__tests__/health.qa-slice5.render.test.tsx`, are kept in the tree uncommitted for the PR, and they pass.

| Finding | Fix |
|---|---|
| **SA-1** (Medium) | §18 rewritten. PR #119 removed the `CLAUDE.md` text, so U-A/U-B/U-C are moot for `CLAUDE.md`. Each item is mapped to where it belongs now; Q-U3 stays parked; a warning not to reintroduce the text is added |
| **QA-1** | "Production runs off/unset" corrected to "production runs `shadow` on purpose, to collect data first". Changed: the comment in `lib/business-os/entitlements/shadow.ts:14-20` and the describe title in `__tests__/shadow.test.ts:153` (test logic unchanged). **Also found by the grep and fixed:** a comment in `app/api/business-os/chat-v4/route.ts:1609-1614` ("unset — which it is in production"). That was a comment-only edit, and the file has 0 `console.*`. Remaining grep hits are deliberate: the requirement quoting the old claim, F-24 (original text with its inline correction), this workplan quoting old text, and the historical `business-os-subscription-entitlements.md` records |
| **SA-2 / QA-2** | `HealthTile.tsx` header: now "slices 4 and 5", and it lists the real headlines ("All clear", the entitlements mode sentence, the fixed not-measured / could-not-check texts) and the page link. The "Normal" reference is gone |
| **SA-3** | The leftover `describe('the Health client files, continued')` is folded back into `describe('the Health client files')` |
| **SA-4** | `GREEN_CLASS` now covers 13 prefixes (`bg text border from to via shadow outline decoration divide ring fill stroke`), with a lookbehind so a prefix must be whole. It is self-tested per prefix: `green-`, `emerald-` and a `hover:`-variant match; `slate-` does not. Two negatives (`into-green-500`, `x-bg-green-500`) also do not match |
| **QA-3** (SA optional) | The entitlements tile's "Open Plans & entitlements" link is now a static fact about the tile (`tilePageLink`), not about its read. It stays when the read fails **or** the rule list is invalid. Tests: both cases keep the link, and with every read failed no other tile gains a link |

**Verification (real output, 2026-09-27):**

| Command | Result |
|---|---|
| `npx jest app/admin lib/admin app/api/admin lib/audit lib/repositories lib/business-os/usage lib/business-os/entitlements lib/business-os/llm lib/cron --ci --maxWorkers=50%` | **142 suites: 141 passed, 1 failed; 3,189 tests: 3,188 passed, 1 failed.** The failure is the parked baseline: "TokenUsageRepository account contract › pins every public method and its arity; no account filter became optional" |
| `npm run test:bos-entitlements` | 60 suites / 1,161 tests, all passed |
| `npm run test:authz-guard` | 119 / 119 passed |
| `npm run typecheck:bos-llm` | 252 files in scope, 28 errors, **0 new**, passed (the same pre-existing "1 baseline entry is fixed" note) |
| ESLint on the touched files (health, tests, `lib/cron`, `shadow.ts`, `shadow.test.ts`, `chat-v4/route.ts`) | exit 0, **0 errors**. 1 warning, pre-existing and not on a changed line: `chat-v4/route.ts:82` unused import `resolveEmailBranding` (present at `HEAD`) |
| `next build`, CI placeholder env | **exit 0**, `✓ Compiled successfully`, `✓ Generating static pages (304/304)` |

---

## 18. Deferred CLAUDE.md Updates

> ⛔ **DO NOT REINTRODUCE THIS TEXT INTO `CLAUDE.md`.** PR #119 (the `CLAUDE.md` slim-down, on `main` @ `94128b5b`) removed the detailed Key Documentation rows. The entitlements row and the admin-access row are now a single line each that **links** to the detailed doc. Neither states the entitlements mode nor any admin handler count, **by design**: a count or a mode in `CLAUDE.md` is a second copy that goes stale. Slice 5 therefore makes **no** `CLAUDE.md` change, now or with PR-2. (Revised 2026-09-27 after SA-1 on the PR-1 code review; the earlier version of this section proposed edits to text that no longer exists.)

| # | Was (proposed for `CLAUDE.md`) | Status for `CLAUDE.md` | Where it belongs now |
|---|---|---|---|
| U-A | Replace "`BOS_ENTITLEMENTS_MODE` is unset in production" in the entitlements row | **Moot.** The sentence is gone from `CLAUDE.md` on `main` (verified: `git show origin/main:CLAUDE.md` has no "is unset in production"); the row is now "`BUSINESS_OS_ENTITLEMENTS.md` — `lib/business-os/entitlements/**` or what a plan includes" | **Already covered by this PR:** `docs/architecture/BUSINESS_OS_ENTITLEMENTS.md` (Overview + mode table: production runs `shadow` on purpose, to collect data first, with the refused-`enforce` caveat). Also the apply runbook note, `TIER_BILLING_REUSE_PLAN.md` F-24, and the comments in `lib/business-os/entitlements/shadow.ts` and `app/api/business-os/chat-v4/route.ts` (QA-1) |
| U-B | The admin handler census in the admin row (83 → 84 with PR-2) | **Moot.** The admin row on `main` only links to `ADMIN_IDENTIFICATION_AND_ACCESS.md` ("includes current coverage and what is not yet true") and carries no count | **`docs/admin/ADMIN_IDENTIFICATION_AND_ACCESS.md`, in PR-2 (SC-12):** the register row for `jobs-queues#GET`, the census and the `/admin` page count, **re-measured from disk at that time** (expected 84 handlers / 55 route files = 78 `requireAdmin` + 6 inline; 26 pages, if nothing else lands first; on `main` today the doc says 83 / 54 / 77 + 6), plus its Change History row |
| U-C | Two `CLAUDE.md` Change History rows (mode corrected; handler count) | **Moot.** Nothing in `CLAUDE.md` changes | The Change History rows of the docs above: `BUSINESS_OS_ENTITLEMENTS.md`, the runbook and `TIER_BILLING_REUSE_PLAN.md` already have theirs in this PR; `ADMIN_IDENTIFICATION_AND_ACCESS.md` gets its row in PR-2 |

**Q-U3 ("no commercial tier is configured") stays PARKED, per the user.** Its only text was the `CLAUDE.md` sentence, which PR #119 removed. It now belongs to `docs/architecture/BUSINESS_OS_ENTITLEMENTS.md`, and nothing there is changed for it in this slice. Checked 2026-09-27: that doc already states, at the `enforce` paragraph, that "since 2026-09-23 two tiers are configured", and it carries no "no commercial tier is configured" sentence. So there is nothing stale to leave or fix there today. For whoever unparks Q-U3, one related stale comment was found and left alone: `lib/repositories/BusinessOsEntitlementShadowRepository.ts:14` ("ships with NO commercial tiers").

---

## 19. Implementation Record: PR-2 (Dev, 2026-09-27)

**Nothing is committed** (standing user rule). Branch `feature/admin-bos-jobs-queues-pr2`, stacked on PR-1 (`63d385c1`). Before any code, `git merge --no-commit --no-ff origin/main` was run to pick up Admin Archiving slice 3 (#121): **"Automatic merge went well; stopped before committing as requested"**. It had **no conflicts and no file changes to stage**: `origin/main` @ `609635ff` is the merge of PR #122 (this slice's PR-1) on top of `1f1420d6` (#121), both already in `63d385c1`. `MERGE_HEAD` is left in place for RM.

### 19.1 What was built

| Part | File(s) | What |
|---|---|---|
| B | `supabase/migrations/20261011_bos_cron_runs.sql` | `bos_cron_runs`, `bos_cron_run_recording` (one row), `admin_bos_cron_run_summary`. SC-3 CHECKs, RLS with no policy, `REVOKE ALL` then exact grants, `SECURITY INVOKER` + `search_path = ''`, limits clamped inside. The runbook in the header: pre-check, single-transaction apply, access check, a dry run that always rolls back and prints `DRY RUN PASS`, "nothing kept". Date `20261011` checked against `origin/main`, whose latest migration is `20261010` |
| B | `supabase/SQL Scripts/20261011_bos_cron_runs_rollback.sql` | The rollback, **a separate file** outside `supabase/migrations/` so no migration run can apply it |
| B | `lib/cron/bosCronJobs.ts` | The registry: 12 jobs and 5 queues, **no imports** (SC-8). Time limits: `maxDuration` where exported; **300 s "assumed_pending_L-5.10"** for the 5 routes without one (SC-6) |
| B | `lib/cron/cronRunRecorder.ts` | `withCronRunRecord`: SC-1 gate (NODE_ENV and VERCEL_ENV both production, secret present, SHA-256 of both sides compared with `timingSafeEqual`, any exception means unrecorded); SC-2 recorder-generated id and finish unless the table is definitively missing; each write bounded at 1.5 s; the same response object returned and the same error rethrown; 30-day prune after a successful finish; a 5-minute per-instance backoff when the table is missing |
| B | `lib/repositories/BosCronRunRepository.ts`, `supabaseErrorCodes.ts` | Writes with an explicit field allow-list; finish only updates a row still `running`; prune by start time. `isMissingRelationError` sits in a pure module (D-12) |
| B | The 12 `app/api/cron/*/route.ts` | `GET` renamed `runJob`, plus one import and `export const GET = withCronRunRecord('<id>', runJob)`. Bodies, auth checks and responses are untouched |
| B | `lib/business-os/purge/descriptors.ts`, `__tests__/classification-baseline.json` | SC-4: both tables `never` (global); baseline 126 → 128, updated deliberately |
| C | `lib/repositories/AdminJobsQueuesRepository.ts` | SC-9 in full (see the item-by-item list below this table) |
| C | `lib/admin/jobs/jobsQueuesTypes.ts`, `buildJobsQueuesView.ts`, `readJobsQueues.ts`; `lib/admin/readUnderDeadline.ts` | The shared read (injected readers, Zod over every RPC row, per-group deadlines) and the one pure computation behind both the page and the tiles (A-8) |
| C | `app/api/admin/jobs-queues/route.ts` | SC-10: `requireAdmin` first, strict empty Zod, isolated groups, counts and timings only in the log |
| C | `app/admin/jobs-queues/page.tsx`, `app/admin/components/jobs/JobsQueuesView.tsx` | Read-only page: Refresh only, "Due now" separate from "Scheduled for later", green only in one `GREEN_STYLE` (Healthy / Clear) |
| C | `AdminSidebar.tsx`, `AdminHeader.tsx` | "Scheduled jobs & queues" third under Monitor; header title |
| D | `lib/admin/health/rules.ts`, `evaluateHealth.ts`, `app/api/admin/health-summary/route.ts` | Tiles 6 and 7 measured through the SAME orchestrator and computation. Their rules are data (§7, OQ-7: a dead-letter in 24 h is red). Green per C-10R, only when all 12 jobs have a recorded Vercel cron run / all 5 queue reads succeeded. Q-U2: payment-retry declines are a count, never a colour |
| — | `docs/admin/ADMIN_IDENTIFICATION_AND_ACCESS.md` | SC-12: register row 84 `jobs-queues#GET`; census re-measured **from disk after the merge**: **84 handlers / 55 route files = 78 `requireAdmin` + 6 inline + 0 open; 26 `/admin` pages**. `CLAUDE.md` untouched (§18) |

What `AdminJobsQueuesRepository` does for SC-9:
- the read context comes first and is required;
- every select is a head count on `id`, or one of `scheduled_at`, `next_attempt_at`, `created_at`;
- `error_message` appears only inside filters, and the marker is double-quoted for PostgREST;
- each "due now" filter cites its claim function by file and line, and a test re-reads those lines;
- the retry-time assumption (`next_attempt_at >= scheduled_at`) is stated in code and pinned by two fixtures;
- a source guard allows only `app/api/admin/**` to use it, including through the barrel.

**Tests added or changed:**

| Test file | Count | What it pins |
|---|---|---|
| `lib/cron/__tests__/bosCronJobs.test.ts` | 74 | FR-R9 against `vercel.json`, thresholds against the requirement table, time limits against `maxDuration`, SC-11 money and key rules, SC-8 no imports, source adoption per route |
| `cronRunRecorder.test.ts` | 27 | SC-1(d) every gate case, happy path, partial, Q-U2, 500, throw and rethrow, timeout class, missing table plus backoff, SC-2(b), start past its deadline, sync throws, non-JSON body, count extraction |
| `app/api/cron/__tests__/runRecord.adoption.test.ts` | 36 | Per job, 12 × 3: an authorised "nothing to do" run is recorded, an unauthorised call records nothing, and a failing record write leaves the response identical to an unrecorded run |
| `BosCronRunRepository.test.ts` (16) and `AdminJobsQueuesRepository.test.ts` (35) | 51 | Both repositories, including the two isolation guards |
| `lib/admin/jobs/__tests__/*` | 46 | Simulated clock for one job of each schedule type (Healthy, then Late one minute past `interval + grace`, then Stopped one minute past `2 × interval + grace`); every rule; queue statuses; A-8 equality; C-10R on tiles 6/7; SC-5 Zod refusals; isolation; purity |
| `app/api/admin/jobs-queues/__tests__/route.test.ts` | 11 | 401/403/400 ordering, happy path, not installed, one queue failing, the leak test with planted markers on the body and every log argument, 500 without details |
| `supabase/migrations/__tests__/bos-cron-runs.migration.test.ts` | 23 | Every CHECK, the privileges, the function header, the runbook steps, the separate rollback |
| `app/admin/__tests__/jobsQueues.render.test.tsx` (9) and `jobsQueues.source.guard.test.ts` (7) | 16 | The page: read-only, the green rule, no forbidden fields, C-21 imports |
| Updated: Health tests, sidebar nav test, purge baseline | — | Listed in D-10 |

### 19.2 Deviations (for SA code review)

| # | Deviation | Why |
|---|---|---|
| D-10 | **The two Health route test files were edited**: each gains a mock of `AdminJobsQueuesRepository` in its `quiet()` setup, and the happy path now expects tiles 6/7 `green`. `evaluateHealth.test.ts` and `rules.config.test.ts` were updated for measured tiles 6/7: quiet inputs carry jobs/queues facts, the fuzz generates them, and the rule-set test lists 7 tiles. **Unedited, as required:** every existing cron route test (`insight-detect/__tests__/route.audit.test.ts` passes) and QA's `qa-slice5.test.ts` / `health.qa-slice5.render.test.tsx` | Without the mock, the Health route would reach the real service-role client in tests. The status changes are the intended behaviour of PR-2 |
| D-11 | `underDeadline` / `asRepoResult` moved to `lib/admin/readUnderDeadline.ts` (SA optimisation note). A failed read now also carries its `error` object, for classification only; it is never shown or logged as text | One copy for both routes. The Health route's deadline tests pass unedited |
| D-12 | `isMissingRelationError` lives in the pure `lib/repositories/supabaseErrorCodes.ts`, re-exported by `BosCronRunRepository` | So `lib/admin/jobs` never imports a database client (F-10) |
| D-13 | The rollback is a separate file (`supabase/SQL Scripts/…_rollback.sql`), referenced from the migration header, rather than a block inside the header as in `20261010` | Coordinator instruction. The file cannot be applied by a migration run |
| D-14 | `HealthInputs.jobs` / `.queues` are **optional**. When a call does not supply them, the tile says "Not measured yet" with no link. Both routes always supply them | Keeps QA's PR-1 file and every existing `HealthInputs` fixture valid, and "absent" has an honest meaning |
| D-15 | **Found by the SC-10 leak test and fixed:** the queue view had spread the reader's figures object, so a stray field would have reached the response. It now copies an explicit field list | Defence in depth: the repository already selects no such field |
| D-16 | Tile 6 metrics are marked inexact (lower bounds) while any job has no run yet; its figures stay exact counts; completeness `'not_measured'` keeps it grey. Tile 7 is inexact and `'partial'` when any queue read failed | C-10R: a rule may still fire on a proven problem; no-match can never be green |
| D-17 | Both routes floor the clock to the minute (`windows.end` / the same floor) | Tile and page agree when loaded in the same minute (A-8) |
| D-18 | FR-R3 ordering: the start row is written **before** the route's own auth check runs | SA F-3 ruling: the recorder's gate is strictly stronger than every route's check, so "recorded only after the caller is proven to be Vercel" holds in substance |
| D-19 | **For BA via TL (SC-2(c)).** A record write that fails cannot show that job as "Could not check", because nothing was written. It shows as "did not finish (or its finish could not be recorded)", or as Late | That meets FR-R4's intent: it is **never Healthy** |
| D-20 | The two new repositories are exported from `lib/repositories/index.ts` (the new-repository skill, step 4); both isolation guards allow the barrel and catch symbol use through it | House pattern (`AdminTokenUsageAnalyticsRepository`) |

### 19.3 Verification (real output, 2026-09-27)

| Command | Result |
|---|---|
| `npx jest app/admin lib/admin app/api/admin app/api/cron lib/audit lib/repositories lib/business-os/usage lib/business-os/entitlements lib/business-os/llm lib/business-os/purge lib/cron --ci --maxWorkers=50%` | **161 suites: 160 passed, 1 failed; 3,684 tests: 3,683 passed, 1 failed.** The failure is the parked baseline: "TokenUsageRepository account contract › pins every public method and its arity; no account filter became optional" |
| `npm run test:bos-entitlements` | 66 suites / 1,308 tests, all passed (includes `supabase/migrations/__tests__` and the purge invariants) |
| `npm run test:authz-guard` | 119 / 119 passed (the new handler is gated; no cap moved) |
| `npm run typecheck:bos-llm` | 253 files in scope, 28 errors, **0 new**, passed (the same pre-existing "1 baseline entry is fixed" note) |
| `npm run check:bos-llm-literals` | 46 files in scope, 2 exempt, **0 violations**, passed |
| `npm run lint:hooks` | exit 0 |
| ESLint on the touched files | exit 0, **0 errors**. 3 warnings, all in `app/api/cron/process-queue/route.ts`, which is untouched and was included only because the whole `app/api/cron` directory was linted |
| Full `tsc --noEmit` (8 GB) | 2,863 lines of pre-existing diagnostics (unchanged from PR-1); **0 in any touched or new file** |
| `next build`, CI placeholder env | **exit 0**, `✓ Compiled successfully`, `✓ Generating static pages (305/305)`. `ƒ /admin/jobs-queues` 7.18 kB; `ƒ /api/admin/jobs-queues`; every cron route builds with `export const GET = withCronRunRecord(...)` |

### 19.4 What SA should look at first

1. `lib/cron/cronRunRecorder.ts`: the gate (SC-1), `canFinish` (SC-2(b)), the rethrow path, and that `response` is returned untouched.
2. `supabase/migrations/20261011_bos_cron_runs.sql`: the CHECKs (SC-3), the function (SC-5), and the dry run.
3. `AdminJobsQueuesRepository.readQueueFiguresAllAccounts`: the filters per queue and the oldest-due pair (SC-9(e), (f)).
4. `buildJobsQueuesView.ts`: `jobStatus` (the first-match order, `last_cron_started_at` only), `queueView`'s explicit copy (D-15).
5. `evaluateHealth.ts`: `jobsMeasurement` / `queuesMeasurement` completeness (D-16).

### 19.6 Review follow-ups (Dev, 2026-09-27, uncommitted)

SA approved PR-2 with nits and QA passed it, both conditional on the Medium. `MERGE_HEAD` is kept, nothing is committed, and QA's 5 probe files (`qa-slice5-pr2.*`) stay in the tree and pass.

| Finding | Fix |
|---|---|
| **SA-1 / QA bug 1 (Medium)** | The numbers-only CHECK is now `'strict $.* ? (@.type() != "number")'`. In lax mode `$.*` unwraps arrays, so `{"a":[1]}` and `{"a":[]}` passed. The dry run gains D-2a (`{"a": [1]}`), D-2b (`{"a": []}`) and D-2c (a nested object), each of which must be refused. The static test pins `strict`, and that the lax form is gone |
| **SA-2 / QA-L1** | `isMissingRelationError`: any code other than `42P01` / `PGRST205` / `PGRST202` is **not** a missing relation. The message fallback matches only `relation "…" does not exist` or "Could not find the table / function". Tests: `42703` and `PGRST204` (missing column), with and without a code, are false |
| **SA-3 / QA-L6** | The recorder decides whether to record inside its guard, but calls the handler **exactly once, outside it**. Tests: a synchronously throwing handler runs once and its same error is rethrown, on the unrecorded path, the recorded path (the failure is recorded) and the backoff path |
| **SA-4** | `finishRun` returns the number of rows updated (`.select('id')`). With 0 rows the recorder logs a distinct `info`, "Cron run finish matched no running row; the run is not recorded" (`rowsUpdated: 0`), and never "Cron run recorded". Tested both ways |
| **SA-5** | `OTHERWISE_JOBS` / `OTHERWISE_QUEUES` use `GREEN_HEADLINE` |
| **SA-6** | `CREATE FUNCTION` (no `OR REPLACE`, house style F-15): a second paste fails and changes nothing. Pinned |
| **SA-7** | The "nothing kept" step now says that once PR-2 is live, `runs_kept` counts real runs, and gives the check that matters then: `WHERE job = 'dry-run-job'` → 0. Pinned |
| **QA-L4** | An unfinished last run shows its outcome words once (no "Finished" line, one outcome line). Tested |
| **QA-L2** | `formatUtc` converts through `Date` → `toISOString()`, never slices text. Tests: a `+02:00` timestamp (including one that crosses midnight) shows the UTC wall clock, and the page renders it as UTC |
| **QA-L5** (optional, done) | The dry run gains D-12 to D-20: job rule, source list, outcome list, HTTP status range, negative duration, class on a success, finish before start, deadline not after start, counts over 1,024 bytes. **The dry run's expected text is unchanged: `DRY RUN PASS`** (pinned) |

**Verification (real output):**

| Command | Result |
|---|---|
| Jest on the 11 paths, `--maxWorkers=50%` | **166 suites: 165 passed, 1 failed; 4,005 tests: 4,004 passed, 1 failed.** The failure is the parked baseline "TokenUsageRepository account contract › pins every public method and its arity; no account filter became optional" |
| `npm run test:bos-entitlements` | 67 suites / 1,321 tests, all passed |
| `npx jest supabase/migrations/__tests__` | 5 suites / 132 tests, all passed |
| `npm run test:authz-guard` | 119 / 119 passed |
| `npm run typecheck:bos-llm` | 253 in scope, 28 errors, 0 new, passed |
| `npm run check:bos-llm-literals` | 0 violations, passed |
| `npm run lint:hooks` | exit 0 |
| ESLint, touched files | exit 0, 0 errors, 0 warnings |
| `next build`, CI placeholder env | exit 0, `✓ Compiled successfully`, 305/305 pages |

### 19.5 What the user must do, in order

**Before PR-2 can merge:**
1. **L-5.10** (Offir, Vercel → Project → Settings → Functions): is Fluid compute on, and what is the default max duration? If it is **above 300 s**, tell Dev: the 5 assumed limits in `lib/cron/bosCronJobs.ts` change to that value (CHECK bound permitting), before merge.
2. **L-5.1 to L-5.5** (read-only SQL, §10): columns, status values, indexes, sizes, markers. Any status outside the §6.1 vocabulary, or any table above ~100k rows: tell Dev before merge.
3. **Apply the migration** (Supabase SQL editor, PROD), following its header:
   - (a) Step 1 pre-check. Four rows, all `PASS`; any `STOP`: do not apply.
   - (b) Paste and run the whole `supabase/migrations/20261011_bos_cron_runs.sql` once.
   - (c) Step 3 access check. One row; every column `true`.
   - (d) Step 4 dry run. The error text must start with `DRY RUN PASS`.
   - (e) "Nothing kept". Expect `runs_kept = 0`, `recording_rows = 1`.
   - Any failure in (c) to (e): run `supabase/SQL Scripts/20261011_bos_cron_runs_rollback.sql`, and send the output to Dev.
   - Record the results as **L-5.7**.
4. **L-5.11**: `npm run schema:check` (read-only zero-row selects against the live database), and confirm the new reads are clean.

**After PR-2 merges and deploys:**

5. **L-5.8, at +2 h**: the SQL in §10. Expect 9 jobs with a `vercel_cron` run (all but `insight-metrics`, `insight-detect`, `payment-reminders`), and on `/admin/jobs-queues` no job Late or Stopped.
6. **L-5.8, the next day after 09:00 UTC**: all 12 jobs recorded. **This is the OQ-2 proof that `CRON_SECRET` works.** A job missing here is being refused or is not scheduled.
7. **L-5.12**: the Vercel logs `Health summary served` and `Jobs and queues served` show `totalMs` ≤ ~1.5 s p50 and ≤ 3 s worst.
8. The QA manual checks M-3 to M-7 (§14.7).

**If anything goes wrong after deploy:** the crons keep working whatever the state of the run record. Rolling back the table only makes the page say "not installed yet".

---

## SA Review Notes

**Reviewed by SA — 2026-09-27 (workplan review)**
**Status:** ✅ Approved with conditions (SC-1 to SC-12 below). Part E may start once T0b is answered; C-10 is re-ruled in writing here (C-10R).

**Read for this review:** this workplan; the requirement §7 S5.1–S5.14 and §11 OQ-6..OQ-9; `CLAUDE.md`; the slice 4 workplan (C-1..C-23, C-10 and C-18 in particular); `BUSINESS_OS_EVENT_DRIVEN_MIGRATION_PLAN.md` §8.1 (and R11: lease > `maxDuration`); all 12 BOS cron routes (auth, `maxDuration`, the dev `POST → GET` handlers); `evaluateHealth.ts`, `healthTypes.ts`, `rules.ts`, `HealthTile.tsx`, `health.source.guard.test.ts`, `health-summary/route.ts`; `20261010_admin_archiving_runs.sql` (house style); `adminReadMethods.guard.test.ts`; `admin-authz-surface.guard.test.ts` (`CAPS` cover only parked lists, so a gated new route moves no cap: confirmed); the purge descriptors and their baseline; `tierMatrix.ts`; and the Archiving slice 2b branch (`feature/admin-archiving-s2b`, worktree `agent-ae8876d4ecf0cdc04`).

**Verification spot-checks (all confirmed):** V-2 (calendar-sync's `if (CRON_SECRET && …)`), V-5 (`maxDuration` per route), V-6 (the five `POST → GET` routes), V-13 (C-18 branch at `evaluateHealth.ts` checks **metrics only**, not figures; see SC-7(b)), V-14 (the entitlements tile emits one word figure), V-18 (`TIER_MATRIX` v1 has `basic` $79 and `pro` $129).

### Fork rulings

| # | Ruling | Notes |
|---|---|---|
| F-1 | **(a) APPROVED**, with SC-3 and SC-5 | One `SECURITY INVOKER`, `search_path = ''`, `STABLE` function over a table the same migration creates is the right trade. It cannot drift from a table we do not own. Zod on the rows at the orchestrator (external data), as planned |
| F-2 | **(a) APPROVED**, with SC-9 | ~63 head counts per load is a lot of requests, but each is an index-or-small-table count on tables of unmeasured-but-small size, all under `allSettled` + deadlines. L-5.4 (>100k rows → re-plan) and L-5.12 are the gates; F-2(b) stays the escalation, **before** merge if L-5.4 fails. We do not add a function over tables we do not own on an unverified live shape |
| F-3 | **(a) APPROVED**, with SC-1 | Correct to not trust the routes' verifiers (two fail open, ten return `true` in development, and development shares the production database). The recorder's check is strictly stronger than every route's, so "recorded only after the caller is proven to be Vercel" (FR-R3) holds in substance even though the start row is written before the route's own check runs. Record that ordering as a stated deviation-with-rationale in the implementation record |
| F-4 | **(a) APPROVED**, with SC-2 and SC-11 | Transparent to Vercel and Next 14: `export const GET = withCronRunRecord(...)` is a supported route export; `maxDuration`, `runtime` and `dynamic` are separate literal exports read statically and are untouched; `runJob` is not exported, so no invalid route-export field is introduced. The five dev `POST` handlers call `GET(request)` at request time (after module init, so no TDZ issue) and pass through the wrapper unrecorded, because the gate requires production. `insight-detect/__tests__/route.audit.test.ts` runs without `VERCEL_ENV`/matching secret, so it passes through: it must pass **unedited** (T11 already says so). Rethrow of the same error and returning the handler's own `Response` object are required and pinned by tests |
| F-5 | **(a) APPROVED** | Delete-on-write is fine at ~45 expiring rows/hour through `bos_cron_runs_started_idx`. Concurrent prunes contend only on the same few expired rows: the second waits for the first's commit, re-checks, and deletes nothing; there is no lock on live rows (a prune never targets a row younger than 30 days, and `finishRun` only targets the current run). No 13th cron, no `pg_cron`. See the optimisation note on noise |
| F-6 | **(a) APPROVED** | The one-row install baseline is what makes "nothing ever records" visible (OQ-2). Baseline = `COALESCE(first run of any job, installed_at)` is sound; after 30 days the "first run" slides forward with pruning, which only matters for a job that has never run, and that job is already Stopped either way |
| F-7 | **(a) APPROVED**, with SC-5 | `User-Agent` is spoofable only by someone who already holds the secret. Manual authorised runs are recorded as `other` and never reset lateness |
| F-8 | **(a) APPROVED** | No failure timestamp exists on any of the five tables (V-10), and this slice must not change them (A-6). Due/queue-time windows, labelled on page and tile, with R-6 stated. Adding `finished_at`/`failed_at` to the five queues is a follow-up for the queue owners (log it against R-18, not here). Rejecting (c): run counts cannot see reaper dead-letters |
| F-9 | **(a) APPROVED**, with SC-6 | 300 s is a safe **upper** bound only if the platform's effective default for those five routes is ≤ 300 s. If it is lower, the only cost is a later "did not finish" (≤ ~6 min). If it is **higher** (a project-level default raised in the dashboard), a live run would falsely show "did not finish" until its finish lands. So L-5.10 is a **pre-merge gate for PR-2**, not a nice-to-have |
| F-10 | **(a) APPROVED** | `lib/admin/**` keeps "never names an admin repository" (C-6). See the optimisation note on where `underDeadline` lives |
| F-11 | **APPROVED as C-10R**, with SC-7 | See "C-10 re-ruled" below |
| F-12 | **(a) APPROVED** | `neutral` stays, relabelled "For information", reachable only by `entitlements_mode` (tested). This implements OQ-9 exactly |
| F-13 | **(a) APPROVED** | A closed `CHECK IN` list is the strongest FR-R5 guarantee; a new class is a small migration |
| F-14 | **(a) APPROVED** | `after()`/`waitUntil` would be a new pattern and is not stable in Next 14. Awaited, deadline-bounded writes, with R-4 accepted |
| F-15 | **(a) APPROVED** | Plain `CREATE` in one transaction, P01 pre-check, exactly the `20261010` precedent |
| F-16 | **(a) APPROVED** | PR-1 (A + E, no DB) merges after L-5.6 is recorded; PR-2 (B + C + D) merges after the migration is applied, L-5.7 recorded, and L-5.1–L-5.5 + L-5.10 recorded. PR-1 adds the registry (pure data) without its consumer. That is fine, because `vercelCrons.test.ts` uses it |

### C-10 re-ruled (C-10R): "green only when proven clear"

C-10 existed so that nothing unchecked could look well. That goal stands; what it forbade was the colour, and the colour is not the risk. **C-10 is replaced by C-10R**, and SC-7 is its enforcement. C-18 is **not weakened**: a lower bound is still never Normal, and never green.

1. **Types.** `TileStatus` gains `'green'`. `HealthRule['colour']` **stays** `'red' | 'amber'`, and `validateRuleList` keeps rejecting a `'green'` colour. The existing negative cases in `evaluateHealth.test.ts:386` and `qa-edge.test.ts:43` pass **unedited**. No data edit can produce green.
2. **Evaluator order.** Exactly §8.1(ii): invalid list → `unavailable`; failed read → `unavailable`; first match → its colour; then **no match** falls to one predicate. The predicate is `provenClear = GREEN_ELIGIBLE.has(id) && measurement.completeness === 'complete' && every metric exact && every figure exact`. If it fails because of inexactness: `LOWER_BOUND_TILES` → amber `LOWER_BOUND_HEADLINE` (C-18); `completeness === 'not_measured'` → `not_measured`; otherwise `unavailable`. If it holds → `green` "All clear". A tile outside `GREEN_ELIGIBLE` → `neutral` "For information". **Inexact or incomplete can never reach `neutral` or `green`.**
3. **Eligibility is code.** `GREEN_ELIGIBLE` is a `ReadonlySet` constant in `evaluateHealth.ts` (the same reasoning as C-18). `rules.ts` holds no eligibility and no green.
4. **Entitlements is never green** (OQ-9). It is not in the set, and that is tested directly and by the fuzz.
5. **Honesty NFR.** "Green" means measured, complete, exact and no rule matched: nothing else.

### Conditions (must be met in the implementation; SA checks each at code review)

1. **SC-1 (F-3) The recorder's gate.**
   - (a) Compare the secret in constant time **without** a length throw: hash both `Authorization` and `` `Bearer ${secret}` `` (e.g. SHA-256) and `timingSafeEqual` the digests. Never call `timingSafeEqual` on raw buffers of different lengths (it throws `RangeError`).
   - (b) Add a **fourth** condition, `process.env.NODE_ENV === 'production'`. `next dev` always sets `development`, so a laptop with pulled production env vars (`VERCEL_ENV=production`, real secret) still cannot write to the shared database.
   - (c) The whole gate evaluation sits in a `try`: any exception → pass through, unrecorded.
   - (d) Tests: a missing header, a length-mismatched header, `Bearer ` with an empty secret, correct secret but `NODE_ENV=development`, and correct secret but `VERCEL_ENV=preview`. Each → no repository call, and the same response object.
2. **SC-2 (FR-R4, R-4) No phantom "did not finish" from the recorder itself.**
   - (a) The recorder generates the run id (`crypto.randomUUID()`) and inserts it inside the explicit field allow-list. That makes it server-generated, not caller-supplied (tenant-isolation-guard step 3 still holds).
   - (b) `finishRun` is attempted with that id whenever the start did not fail with a **definitive** missing-table error. A start that timed out on the client but committed in the database is still finished; one that never committed matches 0 rows, which is harmless.
   - (c) Record the FR-R4 deviation in the implementation record for BA, via TL: a failed record write cannot be shown as "Could not check" for that job, because by definition nothing was written. What shows is "did not finish" or Late, and **never Healthy**, which is FR-R4's intent.
   - (d) The page's "did not finish" wording therefore reads "did not finish (or its finish could not be recorded)".
3. **SC-3 (F-1, FR-R5) Migration constraints, correctly expressed.**
   - (a) Postgres refuses subqueries in `CHECK`, so the counts rules use only immutable expressions:
     - `jsonb_typeof(counts) = 'object'`;
     - `octet_length(counts::text) <= 1024`;
     - `NOT jsonb_path_exists(counts, '$.* ? (@.type() != "number")')`;
     - keys via jsonpath: `NOT jsonb_path_exists(counts, '$.keyvalue() ? (!(@.key like_regex "^[a-zA-Z][a-zA-Z0-9]{0,39}$"))')`.
   - (b) Add these checks:
     - `CHECK (outcome <> 'failed' OR error_class IS NOT NULL)`: a failure always carries a class;
     - `CHECK (outcome <> 'running' OR (duration_ms IS NULL AND http_status IS NULL AND error_class IS NULL))`;
     - an upper bound `CHECK (deadline_at <= started_at + interval '20 minutes')`, so that a registry bug cannot write a far-future deadline that hides "did not finish" forever. Raise the bound only if L-5.10 requires it.
   - (c) The dry run gains a bad-key case (`{"a b": 1}` → `check_violation`) and a deadline-bound case. The static test pins every CHECK.
   - (d) Everything else as §5.2:
     - RLS on, with no policy;
     - `REVOKE ALL … FROM PUBLIC, anon, authenticated, service_role`, then the exact grants (no `TRUNCATE`/`REFERENCES`/`TRIGGER`, which the access check asserts);
     - the function `SECURITY INVOKER`, `SET search_path = ''`, every name schema-qualified, `EXECUTE` revoked from `PUBLIC` and granted to `service_role` only;
     - pre-check → apply → access check → a dry run that always rolls back → nothing kept → rollback;
     - the date prefix re-checked on `main`. The Archiving 2b branch adds **no** migration today, so `20261011` is free unless something else lands.
4. **SC-4 (missed step) Purge classification.** Classify `bos_cron_runs` and `bos_cron_run_recording` as `never` (global scope, like `archive_runs`, Archiving slice 2 C-4) in `lib/business-os/purge/descriptors.ts`. Update `classification-baseline.json` deliberately, in the same diff. Neither table has `user_id`, so `businessOwnedTables.test.ts` will not force it, but the purge engine must never be able to include platform monitoring data, and the precedent is explicit.
5. **SC-5 (F-1/F-7) The summary returns the facts directly.** `admin_bos_cron_run_summary` returns, per job, `last_cron_started_at` (newest `source = 'vercel_cron'` start) as its own column. `jobStatus` uses that column and does **not** derive `lastCron` from `recent`: ten manual runs would otherwise push the last cron run out of the window and fake a Stopped. `p_recent` is clamped to 1..20 and `p_jobs` to ≤ 50 **inside** the function. Zod validates every row (timestamps parse, counts are numbers, arrays are bounded).
6. **SC-6 (F-9) Time limits.** The registry rule is `timeLimitSeconds ≥ the effective platform limit for that route`. It is the route's `maxDuration` where exported. For the five routes without one, it is the dashboard default recorded in L-5.10, and 300 is used only if L-5.10 confirms a default ≤ 300. The registry comment cites L-5.10. L-5.10 is a **pre-merge gate for PR-2**.
7. **SC-7 (F-11, C-10R) Enforcement of green.**
   - (a) **Types:** as C-10R.1.
   - (b) **Evaluator:** the single `provenClear` predicate. Note that the current C-18 branch checks **metrics only**; the new predicate checks metrics **and** figures, which strengthens C-18.
   - (c) **Eligibility is code:** `GREEN_ELIGIBLE` lives in `evaluateHealth.ts`. A source test asserts that `rules.ts` contains no eligibility list, and that the set excludes `entitlements_mode`.
   - (d) **Fuzz, as a biconditional:** `status === 'green'` ⇔ (eligible ∧ valid list ∧ read ok ∧ no match ∧ `completeness === 'complete'` ∧ every metric and figure exact). The generator must vary `completeness` and figure exactness **independently** of metric exactness (at minimum through the tiles 6/7 inputs), and the existing C-20 random-rule-list generation stays.
   - (e) **Direct cases:**
     - exact metrics but an inexact figure → not green;
     - `completeness: 'partial'` with all exact → `unavailable`;
     - `not_measured` with no match → `not_measured`;
     - an empty spend list plus a lower bound → amber (the existing C-18 test, **unedited**);
     - `neutral` appears only on `entitlements_mode`.
   - (f) **PR-1 pin:** in PR-1, tiles 6/7 are still `not_measured`, although they are in `GREEN_ELIGIBLE`.
   - (g) **Source guard, re-ruled:**
     - green/emerald classes appear in exactly one named constant (e.g. `GREEN_STYLE`), which `STATUS_STYLES.green` references. That is more robust than parsing an object literal;
     - `RULE_CHIP` stays red/amber;
     - `page.tsx` and `HealthGrid.tsx` carry no green;
     - `/\bOK\b/` is still forbidden;
     - the jobs page files get the same guard (green only in the Healthy/Clear style entry).
   - (h) **The page's per-job "Healthy" and per-queue "Clear"** obey the same proof. A job is Healthy only with a `vercel_cron` run and a successful read; a queue is Clear only on a successful read.
8. **SC-8 Registry purity.** `lib/cron/bosCronJobs.ts` has **no imports**; a source test pins it. It is imported by the pure `lib/admin/jobs/**`, and the client imports only `import type` from `jobsQueuesTypes.ts` (C-21 pattern, tested).
9. **SC-9 (F-2) The admin queue repository.**
   - (a) **Accountability and callers:** every method takes `AdminReadContext` first and required; logs `info` with `adminUserId` and counts only; and is registered in the admin-read guard (the `adminReadMethods.guard.test.ts` pattern, or its own isolation test), so that **only** `app/api/admin/**` calls it.
   - (b) **Selected columns:** the select allow-list test covers **every** `select()` argument, which must be ⊆ {`id`, `scheduled_at`, `next_attempt_at`, `created_at`}.
   - (c) **Head counts:** every count uses `head: true`.
   - (d) **The dead-letter marker:** `error_message` appears only in filters. The marker quoting in `.or()` is tested.
   - (e) **"Due now":** each queue's predicate cites the claim RPC it mirrors (file:line) in a comment and a test.
   - (f) **Payment "oldest due item":** the two-candidate read assumes `next_attempt_at ≥ scheduled_at` whenever `next_attempt_at` is set. That is true of the retry path, but PostgREST cannot compare columns. State the assumption in the code, and add a test fixture that documents it. If L-5.2/L-5.5 show otherwise, read a small `limit(20)` of timestamps and take the minimum of `max()` in TypeScript.
10. **SC-10 Route.** `/api/admin/jobs-queues` per the `new-api-route` skill, admin variation:
    - `requireAdmin` is the first statement, with no other admin check in the file;
    - `z.object({}).strict()`, with 401/403 winning over 400;
    - the leak test on the serialised body and every logger argument, including the planted marker strings;
    - `details` only in development.
    
    There is no audit entry for this read-only GET, consistent with `health-summary`. The shared orchestrator is used by **both** routes, so a tile figure equals the page by construction (A-8 equality test).
11. **SC-11 (V-4, NFR Money) Counts allow-list.** Only finite numbers; booleans → 1/0; anything else is dropped. A registry test asserts that no count key or path segment matches `/value|amount|usd|price|revenue|cost|impact|total(Value|Amount)/i`, and that every key satisfies the DB key regex (SC-3a). `payment-retry` and `lead-response` have no `partlyDoneWhen` unless Q-U2 changes it.
12. **SC-12 Merge coordination: re-measure, never assume.** `feature/admin-archiving-s2b` (committed, not merged) already claims:
    - register row **83**;
    - the census **83 / 54 / 77 + 6**;
    - edits to the **same** `CLAUDE.md` admin line and to `lib/repositories/index.ts`.
    
    It adds no migration and no sidebar change today. If it merges first, this slice becomes **84 / 55 / 78 + 6**, register row 84. T17 re-derives the numbers from disk at implementation time; §8.4 must not ship "83".

### Comments

1. §5.4 step 1 / FR-R3 — the start row precedes the route's own check; acceptable because the recorder's check is strictly stronger (F-3 ruling). — SA: resolved (state in the implementation record)
2. §5.1 `counts` — the key-regex check as written would need a subquery; see SC-3(a). — SA: pending (SC-3)
3. §6.1 oldest-due for payment tables — the column-comparison approximation; see SC-9(f). — SA: pending
4. §9 files — the purge classification is missing; see SC-4. — SA: pending
5. §8.4 / §9.3 — counts collide with Archiving 2b; see SC-12. — SA: pending
6. V-24 stale `business-os-insights` Rule 7 and two route comments — correct to flag to TL, not edit here. — SA: resolved

### Optimisation suggestions (non-blocking)

- Move `underDeadline` to a neutral module (e.g. `lib/admin/readUnderDeadline.ts`), not `lib/admin/jobs/`, since Health is its first user. The orchestrator measures timings with a clock, so exclude it by name from any "pure, no `Date.now()`" guard over `lib/admin/jobs/**` (or inject the clock).
- If the migration is not yet applied, the recorder warns on every run (~1,080 a day). Memoise "table missing" per instance for a few minutes to cut noise (still one warn per cold start).
- Consider skipping the prune when the finish write failed (the database is likely unhealthy); it saves up to 1.5 s on a bad run.
- An authorised run that exits early with a "disabled"/"nothing to do" 2xx is recorded as `succeeded`. That is correct, but a job disabled by its own flag will show Healthy. If any route has such a flag, expose it as a count (e.g. `disabled: 1`) in the allow-list.

### Pending user questions: technical implications only

- **Q-U1 (the "0").** Answer (1) adds `app/admin/business-os-tiers/components/EntitlementSnapshot.tsx` and its render/source tests to PR-1. Answer (2) is already planned; it changes Health figure labels and `linkLabel`s, so slice 4's label assertions are edited, while the C-16 accessible-name rule still applies. Neither needs a new data read or an entitlements import (no `KNOWN_NON_GATE_IMPORTERS` change).
- **Q-U2 (payment-retry declines).** The route's result carries a single `failureCount` that does not separate a card decline from a system error. So "amber on real errors only" cannot be done without editing the job body, which is out of scope for this slice (the wrapper rule). "No" = no `partlyDoneWhen` (as planned); "Yes" = `atLeast failureCount 1`, which will fire on ordinary declines. Either way the count is recorded and shown on the page.
- **Q-U3 ("no commercial tier is configured").** `TIER_MATRIX` v1 does configure Essentials ($79) and Autopilot ($129), but the file itself says "Stripe becomes the source of truth in Slice 4; nothing here charges anyone", and nothing is enforced (shadow). If the user says stale, the precise replacement is: "Essentials and Autopilot are configured (matrix v1, display prices only; no Stripe price is wired yet); nothing is enforced." It is a docs-only edit, with no guard or test pinned to that sentence (none found).

### Approval

[x] Workplan approved — proceed to implementation once T0b (Q-U1..Q-U3) is answered, with SC-1 to SC-12 applied. PR-1 merge gate: L-5.6. PR-2 merge gate: migration applied + L-5.7, and L-5.1–L-5.5 + L-5.10 recorded. **No commit** (standing user rule).

---

**Code Review by SA — 2026-09-27 (PR-1: parts A + E)**
**Status:** ✅ Code Approved with nits (no blocking finding)

**Scope reviewed:** the uncommitted diff in the `neuronforge-admin-bos-reorg` worktree on `feature/admin-bos-jobs-queues` @ `546f6110`: 19 modified files plus the untracked `lib/cron/__tests__/vercelCrons.test.ts` and this workplan. `git diff --stat` first: 1,065 insertions, 194 deletions. The only deletion-only file is `vercel.json` (0 / 12), which is the intended removal of exactly three 4-line cron entries. Every other deletion is a rewritten line with a matching insertion (the requirement doc's 34 deletions are all single-line rewrites). No truncation. `CLAUDE.md` is untouched (`git diff --quiet -- CLAUDE.md`).

**Not reviewed (appeared during this review, QA's work in progress):** `app/admin/__tests__/health.qa-slice5.render.test.tsx` and `lib/admin/health/__tests__/qa-slice5.test.ts` (created 11:01–11:02, untracked). They were not in the Dev's hand-off and are not covered by this approval.

### Verification (SA re-ran, real output)

| Command | Result |
|---|---|
| `npx jest app/admin lib/admin app/api/admin lib/audit lib/repositories lib/business-os/usage lib/business-os/entitlements lib/business-os/llm lib/cron --ci` | 140 suites: 137 passed, 3 failed; 3,129 tests: 3,126 passed, 3 failed. (1) the parked `tokenUsageRepository.contract.test.ts` › "pins every public method and its arity…" (accepted); (2) `app/admin/archiving/__tests__/page.render.test.tsx` P-7 and (3) `app/admin/analytics/__tests__/linkedWindow.render.test.tsx`: both **"Exceeded timeout of 5000 ms"**, in files PR-1 does not touch, while QA was running tests in the same worktree. Re-run on their own: **2 suites / 31 tests, all passed**. So: load-induced timeouts, not regressions. Only the parked failure is real |
| `npm run test:bos-entitlements` | 60 suites / 1,161 tests, all passed |
| `npm run test:authz-guard` | 1 suite / 119 tests, passed |
| `npm run typecheck:bos-llm` | 252 files in scope, 28 errors, **0 new**, passed (plus the pre-existing "1 baseline entry is fixed" in `app/api/onboarding/build/route.ts`, not touched) |

### Condition check

| Item | Verdict | Evidence |
|---|---|---|
| Part A: `vercel.json` 15 → 12 | ✅ | Only the three AgentsPilot entries removed; the 12 BOS entries byte-identical and in order |
| Part A: `vercelCrons.test.ts` | ✅ | Pins length 12, deep-equals the literal list in order, all under `/api/cron/`, none of the three retired paths, their `route.ts` files still exist (FR-A2), no duplicates. The header documents the re-enable lines |
| Part A: docs | ✅ | `AGENT_EXECUTION_FLOW.md` (note + retired trigger + new Change History) and `VERCEL_ENV_SETUP.md` (table note + new Change History) both say the code is kept and how to reverse it |
| C-10R.1 rule colours red/amber only | ✅ | `HealthRule['colour']` unchanged; `validateRuleList` still rejects green; the negative rule-list cases and `rules.config.test.ts` unedited (D-4) |
| C-10R.3 `GREEN_ELIGIBLE` is a code constant | ✅ | `evaluateHealth.ts:88`, a `ReadonlySet`; source test asserts `rules.ts` has no `ELIGIBLE` and no `green` in code |
| C-10R.4 entitlements never green | ✅ | Absent from the set; direct test, both fuzzes, and the route happy path assert `neutral` |
| C-10R.2 evaluator order | ✅ | `colourTile` (`:426`): invalid list → unavailable; no measurement → unavailable; match → rule colour; no match → `isProvenClearMeasurement` (`:409`, complete ∧ metrics exact ∧ figures exact). On failure: lower-bound tile + inexact → amber; `not_measured` → not_measured; else unavailable. Then eligible → green, else neutral. Splitting eligibility out of the predicate is equivalent to C-10R.2 as written, because a non-eligible, inexact tile still falls to amber/unavailable and never to `neutral` |
| SC-7(b) C-18 over figures | ✅ | `:478` adds `measurement.figures.some((f) => !f.exact)`; direct test "an inexact figure on the spend tile → amber"; the empty-spend-list C-18 test unedited |
| SC-7(d) two-way fuzz | ✅ | End-to-end (2,000 cases, random rule lists kept): `status === 'green'` ⇔ eligible ∧ read ok ∧ no match ∧ every figure exact, with `neutral` only on entitlements. Tile-level over `colourTile` (4,000 cases, seed 20260927): metric exactness, figure exactness and completeness drawn independently, 10 % failed reads; asserts the biconditional and that inexact/incomplete never reaches green or neutral. The expected value is re-derived in the test, not taken from the exported predicate, so it is not tautological |
| SC-7(e) direct cases | ✅ | Inexact figure → unavailable; `partial` → unavailable; `not_measured` → not_measured; a matching rule still wins over an incomplete measurement; green only on an eligible tile |
| SC-7(f) tiles 6/7 pinned | ✅ | Eligible, still `notMeasuredTile()` with `pageLink: null`; pinned test |
| SC-7(g) exactly one `GREEN_STYLE` | ✅ | Declared once, green, referenced exactly once by `STATUS_STYLES.green` (count pinned at 2); the block is removed before the green-class scan across `page.tsx`, `HealthTile.tsx`, `HealthGrid.tsx`; `RULE_CHIP` red/amber only; no-dead-regex self-test; "OK" still forbidden. The render test checks each region: green iff `data-status="green"` |
| RC-5.2 headline / label / link | ✅ | Headline `"<Word> mode: <meaning>"` with the FR-E1 sentences verbatim; figure "Mode in effect"; a visible `pageLink` "Open Plans & entitlements (plans and account lookup)" → `/admin/business-os-tiers`; no digit on the tile (evaluator and render tests). Every other figure label says what it counts; a test forbids the bare "Last 24 h" / "Last 7 days" / "Mode" |
| D-5 value no longer a link | ✅ Accepted | Removing the word-as-link removes the only unclear link on the tile, and the visible `pageLink` meets FR-E2. The refused note is unchanged |
| RC-5.3 docs, no CLAUDE.md | ✅ | `BUSINESS_OS_ENTITLEMENTS.md` (Overview + mode table), the apply runbook (a dated note; the apply-time sentence kept, which is correct history), `BUSINESS_OS_TIER_BILLING_REUSE_PLAN.md` F-24 (correction appended, not rewritten); Change History rows on all three. `CLAUDE.md` unchanged (D-8, per the user) |
| D-1 registry deferred to PR-2 | ✅ Accepted | Supersedes my F-16 note that PR-1 would carry the registry. A literal pin is the right size until the registry's consumer and L-5.10 exist |
| D-2 new exports | ✅ Accepted | `colourTile`, `TileMeasurement`, `Completeness`, `isProvenClearMeasurement`, `GREEN_ELIGIBLE`, `MODE_WORDS`, `ENTITLEMENTS_PAGE_LINK` are exported from a pure server-side lib that the C-21 source guard already keeps out of the client at runtime. `colourTile` is a legitimate test seam: no slice 4 read can yet produce an incomplete or figure-inexact measurement |
| D-3 removed Normal constants | ✅ | No remaining importer (grep) |
| D-4 / D-6 Slice 4 expectations grey "Normal" → green "All clear" | ✅ Accepted | Every edited assertion is a quiet, exact, eligible tile, exactly the case C-10R turns green. Includes "spend: only the count failing" → green: the figures are exact by natural completion (slice 4 C-4), so green is honest. No assertion about a lower bound, a failed read or an invalid list was loosened; the only edits there tighten the wording ("never green") and add `not.toBe('green')` |
| D-7 / D-9 | ✅ | No handler or page added; `lib/cron` added to the run |
| Standards | ✅ | No `console.*` in any touched code file; no new `any`; no DB access; the route change is a header comment only |

### Main has moved: overlap check

`origin/main` is now at **`94128b5b`** (PR #119, "docs: slim CLAUDE.md…", merged after PR #118 `cb644f88`). `comm -12` of `git diff --name-only 546f6110 origin/main` against PR-1's modified + untracked files: **empty, no file overlap** with either #118 or #119. RM merges `main` in; no conflict expected.

### Code Review Comments

1. `docs/workplans/ADMIN_MODULE_BOS_REORGANISATION_SLICE5_WORKPLAN.md` §18 (U-A, U-B, U-C) — **stale since PR #119.** `CLAUDE.md` on `main` @ `94128b5b` no longer contains the entitlements "Nothing is enforced yet — `BOS_ENTITLEMENTS_MODE` is unset" sentence, nor the admin handler census: both rows now just point at `BUSINESS_OS_ENTITLEMENTS.md` and `ADMIN_IDENTIFICATION_AND_ACCESS.md`. The "Old:" anchors do not exist, so U-A and U-B cannot be applied as written, and they are no longer needed: RC-5.3 is fully met by the `BUSINESS_OS_ENTITLEMENTS.md` edit in this PR, and the PR-2 census belongs in `ADMIN_IDENTIFICATION_AND_ACCESS.md` (SC-12 still applies there). Dev should rewrite §18 to say so, so that nobody later re-adds removed text to `CLAUDE.md`. Q-U3 (the tier clause) now applies to `BUSINESS_OS_ENTITLEMENTS.md`, not `CLAUDE.md`. Docs only, not blocking for QA. — Priority: Medium
2. `app/admin/components/health/HealthTile.tsx:4-7` — the header still says "slice 4" and that the headline is the rule's description 'or "Normal"'. "Normal" no longer exists. Update to "All clear" / "the mode in words". — Priority: Low
3. `app/admin/__tests__/health.source.guard.test.ts:116` — `describe('the Health client files, continued')` exists only because the new blocks were inserted in the middle of the original `describe`, and it opens with a blank line. Move the U-6 test back into the first `describe`, or put the green blocks after it. Cosmetic. — Priority: Low
4. `app/admin/__tests__/health.source.guard.test.ts:68` — `GREEN_CLASS` covers `bg|text|border|ring|fill|stroke` but not `from-|via-|to-|shadow-|outline-|decoration-|divide-`. A future `decoration-emerald-400` outside `GREEN_STYLE` would pass. Widen the prefix list (or match `-(?:green|emerald)-\d`). This is a hardening, not a current leak. — Priority: Low

### Optimisation Suggestions

- `evaluateHealth.ts:432`: when the entitlements read fails, `measurement` is null, so the tile loses its `pageLink`. The link is static and still useful on a "Could not check" tile. Consider passing the static link for that tile independently of the read. Non-blocking; today the read is an env lookup that practically never fails.
- `evaluateHealth.ts:496`: the fallback `?? TITLES[id]` is unreachable today (only entitlements is non-eligible, and it always supplies `informationHeadline`). This is fine as a defensive default. Alternatively, make `informationHeadline` required when the id is not in `GREEN_ELIGIBLE`, so a future non-eligible tile cannot silently show its title as its headline.

### Owed (unchanged)

- **PR-1 merge gate:** L-5.6 (the user's read-only count of AgentsPilot agents that stop running on a schedule).
- **After deploy:** L-5.9 (Vercel's cron list shows 12) and M-1 (green "Healthy · All clear" on clear tiles; entitlements grey "For information" with the sentence and the link).
- **QA:** the two new QA files above, plus the manual checks in §14.7.

### Code Approved for QA: Yes

Comments 1–4 may be fixed in the same uncommitted change before RM; none requires SA re-review, except that comment 1's §18 rewrite should be read back by TL. **No commit** (standing user rule).

---

**Code Review by SA — 2026-09-27 (PR-2: parts B + C + D)**
**Status:** ✅ Code Approved with nits — **one Medium (comment 1) must be fixed before the user applies the migration**

**Scope reviewed:** the uncommitted diff in the `neuronforge-admin-bos-reorg` worktree on `feature/admin-bos-jobs-queues-pr2`, with the `git merge --no-commit` of `origin/main` @ `609635ff` in progress (`MERGE_HEAD` present, merge-base = `HEAD` `63d385c1`, and `git diff HEAD MERGE_HEAD` is empty, as §19 says). `git diff --stat HEAD` first: 28 modified files, 773 insertions, 170 deletions, plus 23 untracked paths. **No deletion without a matching insertion.** The largest deletion is `health-summary/route.ts` (34 / 86), which is exactly the `underDeadline` / `asRepoResult` / `ReadTiming` block moved to `lib/admin/readUnderDeadline.ts` (D-11; compared line by line: same logic, plus the `error` carried for classification). Every other deletion is a rewritten line. `CLAUDE.md` untouched (`git diff --quiet HEAD -- CLAUDE.md`).

### Verification (SA re-ran, real output)

| Command | Result |
|---|---|
| `npx jest app/admin lib/admin app/api/admin app/api/cron lib/cron lib/repositories lib/business-os/purge lib/business-os/entitlements --ci --maxWorkers=50%` | **132 suites / 3,064 tests, all passed** (94.9 s). The parked `tokenUsageRepository` contract test lives outside these paths, so no failure appears in this list |
| `npm run test:bos-entitlements` | 66 suites / 1,308 tests, all passed |
| `npm run test:authz-guard` | 1 suite / 119 tests, passed |
| `npm run typecheck:bos-llm` | 253 files in scope, 28 errors, **0 new**, passed (the pre-existing "1 baseline entry is fixed" in `app/api/onboarding/build/route.ts`, not touched) |
| **The migration, executed** (SA, PGlite 0.5.8 = PostgreSQL 18.3 in a scratch directory; roles `anon`/`authenticated`/`service_role` created with Supabase-style default privileges; nothing near the repo or any database) | Step 1 pre-check: four `PASS`. The **whole file pasted as-is** (runbook comment included) applies. Pre-check again: P01 `STOP: already applied`. A second paste fails at `relation "bos_cron_runs" already exists` and changes nothing. Step 3 access check: **one row, all 15 columns `true`**. Step 4 dry run: `DRY RUN PASS: D-1 … D-11 PASS`. Nothing kept: `runs_kept = 0`, `recording_rows = 1`. As `anon`: `permission denied for table bos_cron_runs`; as `authenticated`: `permission denied for function admin_bos_cron_run_summary`. Clamp: 80 jobs + `p_recent = 999` returns 50 rows. The rollback runs twice cleanly and leaves three nulls. **One gap found: comment 1** |

### Condition check

| Item | Verdict | Evidence |
|---|---|---|
| SC-1 gate | ✅ | `cronRunRecorder.ts:84-97`: `NODE_ENV` and `VERCEL_ENV` both `production`, non-empty secret, SHA-256 of both sides then `timingSafeEqual` (no length throw), whole gate in `try` → `false`. Tests cover all five SC-1(d) cases plus a same-length wrong secret, no `VERCEL_ENV`, and a throwing `headers.get`; each asserts no repository call and the same response object |
| SC-1(c) gate exception → unrecorded | ✅ | `:199-209`: any throw in gate, registry lookup or backoff check → `handler(request)` unrecorded. See comment 3 (a theoretical double call) |
| SC-2 | ✅ | `randomUUID()` server-side (`:211`) inside the explicit insert allow-list; `canFinish = start.ok \|\| !start.missingTable` (`:226`); tested for a failed-but-maybe-committed start and a start slower than its deadline. D-19 recorded for BA; `DID_NOT_FINISH_WORDS` carries "(or its finish could not be recorded)" |
| 1.5 s write deadline, never throws | ✅ | `bounded()` (`:137-168`): abort + resolve at 1,500 ms, sync throw captured, timer always cleared, late settle swallowed. Prune skipped when the finish failed (SA optimisation note taken) |
| Job exception rethrown; original response returned | ✅ | `:246-255` records `failed`/`exception` (or `timeout` for `AbortError`/`TimeoutError`) and rethrows the **same** error, the finish itself wrapped so it can never mask it; `:262` returns the handler's own object. `response.clone().json()` leaves the body readable (tested) |
| The 12 routes | ✅ | Each diff is exactly: one import, `export async function GET` → `async function runJob`, and `export const GET = withCronRunRecord('<id>', runJob)` with a comment. **No job body, auth check, early return or response edited.** `maxDuration`/`runtime`/`dynamic` literals untouched. The five dev `POST → GET(request)` handlers pass through (the gate needs `NODE_ENV=production`) |
| SC-6 time limits | ✅ (gate owed) | `bosCronJobs.ts:81-86, 115-127`: `timeLimitSource: 'assumed_pending_L-5.10'` on the 5 routes with no `maxDuration`; test pins each against the route file and pins every deadline inside the 20-minute CHECK bound. The page shows `TIME_LIMIT_ASSUMED_NOTE`. **L-5.10 is still a pre-merge gate** |
| D-18 (start row before the route's own auth) | ✅ Accepted | As ruled in F-3; stated in the recorder header |
| SC-3 constraints | ⚠️ one gap | `like_regex` key rule, `failure_has_class`, `running_is_bare`, `deadline_bounded` (≤ start + 20 min), closed `error_class` list, `(outcome = 'running') = (finished_at IS NULL)`: all present and each refused in the dry run. **But the numbers-only rule accepts an array of numbers** (comment 1) |
| RLS / grants | ✅ | RLS on both, no policy; `REVOKE ALL … FROM PUBLIC, anon, authenticated, service_role`, then exactly `S/I/U/D` on runs and `SELECT` on recording; proven by the executed access check |
| SC-5 function | ✅ | `LANGUAGE sql STABLE SECURITY INVOKER SET search_path = ''`, every name `public.`-qualified, `p_jobs` sliced to 50, `p_recent` clamped 1..20 **inside**, `last_cron_started_at` its own column (vercel_cron only), `EXECUTE` for `service_role` only. `jobStatus` measures from `last_cron_started_at`, never from `recent`. Zod validates every row (`readJobsQueues.ts:172-204`), `.strip()` drops unknown keys, arrays bounded |
| Runbook | ✅ | Pre-check → single `BEGIN … COMMIT` → access check (one privilege per `has_table_privilege` call where "all" is needed, correctly) → a `DO` block that always raises and prints `DRY RUN PASS` → nothing kept. `SET LOCAL ROLE service_role` follows the applied-and-verified `20261010` precedent. No nested `/*` inside the runbook comment (a Postgres block comment nests, so that was checked) |
| Rollback | ✅ | Separate file outside `supabase/migrations/` (D-13). Drops the function, then both tables (indexes go with them); `IF EXISTS`, one transaction, idempotent (ran twice); nothing else depends on these objects |
| SC-4 purge | ✅ | Both tables `never`, global, with reasons; baseline 126 → 128 deliberately in the same diff |
| SC-8 | ✅ | `bosCronJobs.ts` has no `import`/`require` (pinned); the client imports `import type` only from the runtime-free `jobsQueuesTypes.ts` |
| SC-9 repository | ✅ | Context first and required, checked before any request; selects only `id` (head counts) and `scheduled_at` / `next_attempt_at` / `created_at` (allow-list test over every `select()`); `error_message` only in filters, marker double-quoted in `.or()`; stuck = in progress and (`claimed_at` null or older than 90 s + 10 min). **Every "due now" predicate re-verified against its claim function** (`2026-08-14_payment_reminders_claim.sql:58-60`, `2026-08-14_payment_automation_executions_claim.sql:73-75`, `20260911_daily_briefing.sql:141-142`, `20260914_lead_responses.sql:132-133`, `20260917_insight_actions.sql:167-168`; none is redefined in a later migration). "Scheduled for later" is the exact complement over pending rows. The SC-9(f) assumption is stated in code and pinned by two fixtures. At most one `.or()` per request. Isolation guard catches the symbol anywhere, the barrel included |
| SC-10 route | ✅ | `requireAdmin` is the first statement; `z.object({}).strict()` after the gate (401/403 win); 500 carries `details` only in development; no audit (read-only, as Health). The leak test plants markers in the RPC rows, the run rows and the queue figures, and asserts none reaches the body or **any** logger argument |
| D-15 completeness | ✅ | `queueView` copies an explicit list; `runView` and `jobView` build every field explicitly; job counts are keyed by the registry's specs, not the stored object; Zod strips unknown run fields. No remaining spread of reader data into the response |
| Shared orchestrator / A-8 / D-17 | ✅ | Both routes call `readJobsQueues` + `buildJobsQueuesView`; tile facts are derived from the same view. Both floor the clock to the minute (`windows.end`, and the same floor in the jobs route), so a page and a tile loaded in the same minute agree |
| SC-11 counts | ✅ | Finite numbers kept, booleans → 1/0, all else dropped; `totalValueImpact` not listed (pinned); money regex over keys **and** path segments with a no-dead-regex self-test; every key satisfies the DB key rule |
| Tiles 6/7 | ✅ | Rules are data in `rules.ts` (red/amber only, `atLeast`). Green per C-10R: tile 6 is `complete` only when `noRunYet === 0` and the run read succeeded, and "Healthy" itself requires a `vercel_cron` run, so green ⇔ all 12 healthy; tile 7 is `complete` only when all 5 queue reads succeeded. D-16: metrics inexact while a job has no run, so a proven Stopped still fires but no-match is grey. Q-U2: `payment-retry` has no `partlyDoneWhen`. OQ-7: `queues.deadLettered24h` is red |
| Missing-table path | ✅ | Recorder: `42P01`/`PGRST205` → job runs unrecorded, 5-minute per-instance backoff. Page/tile: `PGRST202` → `not_installed` → "Could not check: run recording is not installed yet." |
| SC-12 census | ✅ | Re-counted from disk: 55 route files; 81 exported `GET/POST/PUT/PATCH/DELETE` + 3 `HEAD` = **84**; the 6 files without `requireAdmin` are the 6 inline rows → **78 + 6 + 0**; **26** `page.tsx` under `app/admin/`. Register row 84 and a Change History row added; no cap moved. Sidebar: Monitor = Health, AI cost & usage, Scheduled jobs & queues, Audit trail, Archiving; nav test 24 → 25 entries, on-disk floor 26 |
| Isolation (tenant-isolation-guard) | ✅ | The only new service-role **write** path is `BosCronRunRepository`: reached only after the SC-1 proof, explicit field allow-list, server-generated id, job id from the typed registry, `source` a two-value enum, finish keyed by that id and `outcome = 'running'`, prune by time only. No tenant column exists to defeat. The admin reads are read-only and gated |
| Standards | ✅ | No `console.*` in any touched or new code file; Pino everywhere (the client view follows the `HealthGrid.tsx` precedent); no new `any`; the new repositories are in the barrel |

### Code Review Comments

1. `supabase/migrations/20261011_bos_cron_runs.sql:264` — **the numbers-only CHECK accepts an array of numbers.** `jsonb_path_exists` runs in `lax` mode by default, and a lax filter unwraps an array before testing it, so `'$.* ? (@.type() != "number")'` finds nothing in `{"a": [1, 2]}`. SA proved it on PostgreSQL 18.3: that insert, as `service_role`, is **accepted**, while `strict $.* ? (…)` refuses it. No text can get through (a string inside the array is still caught), and the recorder never writes an array. But a stored array would fail `readJobsQueues`' Zod (`z.number().finite()`), turning the whole run summary into "Could not check" for all 12 jobs. SC-3 promised "every value a number", and this migration is applied by hand in production, so fix it **before the user applies it**. Fix: `'strict $.* ? (@.type() != "number")'`; add a dry-run case (`{"a": [1]}` → `check_violation`); pin `strict` in `bos-cron-runs.migration.test.ts`. No SA re-review is needed; TL reads back the diff. — Priority: **Medium**
2. `lib/repositories/supabaseErrorCodes.ts:174` — the message fallback `/does not exist/` also matches a **missing column** (`42703`). A schema drift would show as "not installed yet" rather than "could not be read", and would switch the recorder into its 5-minute backoff. Both outcomes are grey or unrecorded, never Healthy, so it is safe; only the label misleads. Narrow the fallback to `relation … does not exist` / `function … does not exist`, or rely on the codes. — Priority: Low
3. `lib/cron/cronRunRecorder.ts:199-209` — `return handler(request)` sits inside the `try` whose `catch` calls `handler(request)` again. A handler that threw **synchronously** would run twice. Unreachable today (every `runJob` is `async`, so it returns a rejected promise instead), but it is a trap for a future non-async handler. Decide `proven`/`job` inside the `try`, and call the handler once, outside it. — Priority: Low
4. `lib/cron/cronRunRecorder.ts:242` with `BosCronRunRepository.ts:112-132` — `finishRun` reports success when it updates **0 rows** (for example, a start that never committed), so "Cron run recorded" is logged for a run that has no row. Diagnostic only. Optionally `.select('id')` and log `finished: 0`. — Priority: Low
5. `lib/admin/health/evaluateHealth.ts:79, 81` — `${'All clear'}` is a literal inside a template; use `GREEN_HEADLINE` (`:60`) so the three "Otherwise" lines cannot drift from the headline. — Priority: Low
6. `supabase/migrations/20261011_bos_cron_runs.sql:307` — `CREATE OR REPLACE FUNCTION`, where F-15's house style is plain `CREATE`. Harmless: a second paste fails at the first `CREATE TABLE`, and P01 checks the function name. Make it plain `CREATE` for consistency. — Priority: Low
7. `supabase/migrations/20261011_bos_cron_runs.sql:225-228` — "nothing kept: expect 0" is true only while PR-2 has **not** deployed (§19.5 applies it first). Add "(if PR-2 is already live, `runs_kept` is the real runs, and the dry run still kept nothing)", so a later re-check does not alarm the user. — Priority: Low

### Optimisation Suggestions

- The Health route now awaits ~64 extra requests on every load. L-5.12 is the right gate; if it misses, the slice 4 §7.4 fallback (tiles 6/7 in their own request) is UI-only.
- `tests/helpers/jobs-queues-fixtures.ts` is a new top-level helper location. It is fine, but check it is inside the Jest roots CI will run once the test-tiering work lands.

### Owed before PR-2 merges (unchanged from §19.5)

- Comment 1 fixed, then the migration applied by the user: pre-check, apply, access check, dry run, nothing kept (**L-5.7**).
- **L-5.10** (Offir): the platform default max duration. It decides the 5 assumed 300 s limits. Above 1,140 s, the 20-minute CHECK bound must also be raised.
- **L-5.1 to L-5.5** (read-only SQL) and **L-5.11** (`schema:check`).

### Code Approved for QA: Yes

Approved for QA **once comment 1 is applied** (one word, one dry-run case, one test pin). Comments 2 to 7 may go in the same uncommitted change and need no SA re-review. **No commit** (standing user rule).

---

## QA Testing Report

**QA — 2026-09-27 (PR-1: parts A + E)**
**Test mode:** full, scoped to PR-1 (parts B, C and D are PR-2 and are not tested here)
**Strategy used:**
- A: Jest unit tests for the evaluator and the `vercel.json` pin.
- B-lite: the existing route tests, with the reads mocked.
- A render check: the real evaluator's output rendered through the real `HealthTile`.
- Static gates: `typecheck:bos-llm`, `check:bos-llm-literals`, ESLint and `lint:hooks`.
- `next build` with the CI placeholder env.
- A semantic comparison of `vercel.json` against base `546f6110`.

No database and no production reads.
**Focus:** schema, ui and api (Health); the cron config; docs
**Skipped:**
- E2E: not set up in this repo. Manual checks are listed below.
- L-5.6: the user's production SQL. QA runs no production queries.

**Input source:** TL prompt (items 1 to 8)

### Command results (real output, 2026-09-27, worktree `neuronforge-admin-bos-reorg`, uncommitted)

| Command | Result |
|---|---|
| `npx jest app/admin lib/admin app/api/admin lib/audit lib/repositories lib/business-os/usage lib/business-os/entitlements lib/business-os/llm lib/cron --ci`, run 1 (Dev's files only) | **140 suites: 137 passed, 3 failed. 3,129 tests: 3,125 passed, 4 failed.**<br>- 1 failure is the parked `tokenUsageRepository.contract.test.ts`.<br>- 3 failures are 5 s timeouts: `app/admin/archiving/__tests__/page.render.test.tsx` (P-7 and P-3) and `app/admin/analytics/__tests__/linkedWindow.render.test.tsx`.<br>PR-1 touches neither file, and both pass on their own (2 suites, 31 tests). SA saw the same timeouts while the two reviews shared the machine |
| The same command, run 2 (including QA's 2 new suites) | **142 suites: 141 passed, 1 failed. 3,173 tests: 3,172 passed, 1 failed.** The only failure is the parked contract test |
| The parked contract test on base `546f6110` (in a temporary worktree outside the repo, since deleted) | **Identical failure:** 1 failed, 4 passed, and the same single extra method, `summariseFeatureAllAccountsInWindow` |
| `npm run test:bos-entitlements` | 60 suites / 1,161 tests passed |
| `npm run test:authz-guard` | 1 suite / 119 tests passed |
| `npm run typecheck:bos-llm` | 252 files in scope, 28 errors, **0 new**: passed. It also reports the pre-existing "1 baseline entry is fixed" in `app/api/onboarding/build/route.ts`, which PR-1 does not touch |
| `npm run check:bos-llm-literals` | 46 files in scope, 2 exempt, 0 violations: passed |
| `npm run lint:hooks` | exit 0 |
| `npx eslint lib/admin/health app/admin/components/health app/admin/page.tsx app/admin/__tests__ app/api/admin/health-summary lib/cron` (including QA's new files) | exit 0, no output |
| `next build` with the CI placeholder env from `build.yml` | **exit 0.** `✓ Compiled successfully`, `✓ Generating static pages (304/304)`, `ƒ /admin` 6.43 kB, `ƒ /api/admin/health-summary`. The `DYNAMIC_SERVER_USAGE` lines were there before this change |

### Test Coverage

| Acceptance criterion / check | Tested? | Result | Notes |
|---|---|---|---|
| A: `vercel.json` has exactly 12 crons, all BOS | ✅ | Pass | Compared with base: the 15 base crons minus the 3 AgentsPilot paths equal the current 12, in the **same order with the same schedules**. The git diff only deletes lines |
| A: the rest of `vercel.json` is untouched | ✅ | Pass | The keys are `ignoreCommand`, `crons` and `rewrites`. `ignoreCommand` (`bash .github/ci/non-deploying-change.sh`) and the subdomain rewrite match base exactly |
| A: the 3 AgentsPilot route files exist and are unchanged | ✅ | Pass | `git diff 546f6110` over the three routes is empty, and git status lists none of them |
| A: the retirement and how to reverse it are recorded (FR-A3) | ✅ | Pass | `docs/AGENT_EXECUTION_FLOW.md` and `docs/VERCEL_ENV_SETUP.md` each have a dated note, the exact line to re-add, and a Change History |
| A: L-5.6 recorded before merge | ✅ | Pass (the user, 2026-09-27) | `scheduled_active_enabled_agents = 0`, `owners = 0`, `most_recent_scheduled_run = null`. No one's scheduled agents stop. The SQL is in §10 |
| E: a measured, exact tile that matches no rule is green with a text label (including settings with 0 areas off) | ✅ | Pass | QA probe: on a quiet day the settings, failures, spend and critical tiles are green "All clear", and the render shows the label "Healthy" |
| E: green only when the tile is measured, eligible, matches no rule, and every metric **and** figure is exact | ✅ | Pass | Checked:<br>- a matching rule wins over green;<br>- an empty, valid rule list on an eligible tile gives green, not neutral;<br>- `colourTile`: partial → unavailable, not_measured → not_measured, inexact metric → unavailable, null → unavailable.<br>Dev's two-way fuzz passes |
| E: entitlements is never green (off, shadow, enforce, refused) | ✅ | Pass | Every mode, refused and not, **also with the entitlements rule list emptied**: never green. `colourTile('entitlements_mode', [], clean)` → neutral |
| E: a lower-bound spend is amber, never green | ✅ | Pass | Checked:<br>- each of the 4 spend sums inexact → amber;<br>- every spend rule deleted plus a lower bound → amber `LOWER_BOUND_HEADLINE`;<br>- an inexact figure over exact metrics → amber.<br>Rendered: "Needs a look", with no emerald class |
| E: tiles 6 and 7 stay "Not measured yet" | ✅ | Pass | On a quiet day and with every read failed: `not_measured`, no rules, `pageLink: null` |
| E: a failed read shows "Could not check" | ✅ | Pass | Each of the 5 reads failed on its own → `unavailable`, rendered as "Could not check", with no green anywhere |
| E: an invalid rule list shows "Could not check" | ✅ | Pass | On each of the 5 tiles, each of these → `unavailable`: a value that is not a list, a rule with `colour: 'green'`, a description containing "OK" |
| E: a green class appears only in `GREEN_STYLE` | ✅ | Pass | grep finds `emerald-`/`green-` only at `HealthTile.tsx:39-40`, inside `GREEN_STYLE`. Dev's source guard passes. In QA's render test, emerald classes appear on exactly the tiles the evaluator made green |
| E: the entitlements headline matches each mode (FR-E1) | ✅ | Pass | Off: "Off mode: Plans are not checked."<br>Shadow: "Shadow mode: Plans are checked and logged; nothing is blocked."<br>Enforce: "Enforce mode: Plan limits are applied to customers."<br>Refused: amber "Enforcement requested but not active" |
| E: the "Mode in effect" label | ✅ | Pass | Present in all 4 cases; the value is the mode word |
| E: the visible link to `/admin/business-os-tiers` has a descriptive accessible name (FR-E2) | ✅ | Pass | `getByRole('link', { name: 'Open Plans & entitlements (plans and account lookup)' })` finds it, the href is correct, and it is the tile's **only** link |
| E: refused enforce is amber and carries its note | ✅ | Pass | The note "…asks for enforce, but the launch gate refused it…" is rendered |
| E: no unlabelled number on the entitlements tile (FR-E3) | ✅ | Pass | The rendered tile text contains no digit, in all 4 modes |
| E: every Health figure label describes itself | ✅ | Pass | No label is a bare window ("Last 24 h") or just "Mode". The labels are:<br>- "Failed AI actions, last 24 h / 7 days"<br>- "AI spend, last 24 h / 7 days (USD)"<br>- "Critical events, last 24 h / 7 days"<br>- "Areas configured off", "Calls configured off"<br>- "Settings not being applied"<br>- "Adjusted by a model rule (information)"<br>- "Mode in effect" |
| E: the "0" is identified in the workplan | ✅ | Pass | §8.3 |
| E: `CLAUDE.md` untouched (this PR) | ✅ | Pass | `git diff 546f6110 -- CLAUDE.md` is empty (D-8). Since PR #119, `CLAUDE.md` on `main` no longer holds the "unset" sentence (SA comment 1), so requirement §S5.13's `CLAUDE.md` correction is moot. RC-5.3 is met through `BUSINESS_OS_ENTITLEMENTS.md` |
| E: the entitlements docs say production runs shadow on purpose | ✅ | Pass | `BUSINESS_OS_ENTITLEMENTS.md` (Overview and the mode table), `BUSINESS_OS_ENTITLEMENTS_APPLY_RUNBOOK.md` (a dated note; the apply-time sentence is kept) and `BUSINESS_OS_TIER_BILLING_REUSE_PLAN.md` F-24. Each has the refused-enforce caveat and a Change History row. Two stale mentions remain in code (edge case 1 below) |
| E: SA re-ruled C-10 before implementation | ✅ | Pass | C-10R, in the SA Review Notes |
| Entitlements guard registration (§8.5) | ✅ | Pass | `test:bos-entitlements` is green, and there is no new entitlements import |

### Issues Found

#### Bugs (must fix before commit)
None.

#### Performance Issues (should fix)
None. `/admin` is 6.43 kB, the same size Dev recorded.

#### Edge Cases (nice to fix)
1. **Two places in code still say production runs `off`.** RC-5.3 asks for this claim to be corrected wherever it appears. Severity: Low (a comment and a test title; no behaviour).
   - `lib/business-os/entitlements/shadow.ts:17`: "`BOS_ENTITLEMENTS_MODE` unset — the default, and production today —"
   - `lib/business-os/entitlements/__tests__/shadow.test.ts:153`: `describe('mode \`off\` — the default, and what production runs', …)`
   - Expected: say only "the default", because production runs `shadow`. If Dev would rather not touch an entitlements module file in PR-1, record that as a deviation in §17.2.
2. **A stale header comment** at `app/admin/components/health/HealthTile.tsx:7` still says the headline is the rule's description 'or "Normal"'. Same as SA comment 2. Severity: Low.
3. **The entitlements tile loses its visible link when its read fails.** `lib/admin/health/evaluateHealth.ts:432` takes `pageLink` from the measurement, so a failed mode read shows no "Open Plans & entitlements" link. The link never changes, so it would still help on that tile. Same as SA's first optimisation note. Severity: Low.
4. **Flaky tests that PR-1 did not cause.** Under the full parallel run, these hit Jest's 5 s default timeout in 1 of 2 runs:
   - `app/admin/archiving/__tests__/page.render.test.tsx` (P-7, P-3)
   - `app/admin/analytics/__tests__/linkedWindow.render.test.tsx`

   They pass on their own and in the second run. Their owners could raise the timeout. This does not block PR-1.

### QA tests added (uncommitted; Dev or RM can keep or drop them)
- `lib/admin/health/__tests__/qa-slice5.test.ts`, 37 tests. It covers:
  - the conditions for green;
  - failed reads and invalid rule lists;
  - the lower bound;
  - entitlements in every mode;
  - tiles 6 and 7;
  - the `colourTile` seams;
  - self-describing labels.
- `app/admin/__tests__/health.qa-slice5.render.test.tsx`, 7 tests. It renders the real evaluator's output through the real `HealthTile` and checks:
  - green classes appear only on green tiles;
  - the labels;
  - the entitlements link's accessible name;
  - no digit on the entitlements tile.

Both files pass, and ESLint is clean on them. SA did not review them (see the SA code review).

### Manual checks owed by the user

**Before merge**
- **L-5.6** (production, read-only, §10): record `scheduled_active_enabled_agents`, `owners` and `most_recent_scheduled_run` for the AgentsPilot agents that stop running on a schedule. **This is the PR-1 merge gate.**

**After deploy (as a platform admin, on `/admin`)**
- **M-1a:** the Business OS AI settings tile (0 areas off, 0 ignored) is green, labelled "Healthy", with the headline "All clear". Failed AI actions, AI spend and Critical audit events look the same on a quiet day. AI spend is green only if no figure reads "at least".
- **M-1b:** the Entitlements mode tile:
  - is grey "For information", and **not** green;
  - has the headline "Shadow mode: Plans are checked and logged; nothing is blocked.";
  - shows the figure "Mode in effect: Shadow";
  - has a visible link, "Open Plans & entitlements (plans and account lookup)", that opens `/admin/business-os-tiers`.
- **M-1c:** Scheduled jobs and Queues are grey "Not measured yet", with no link.
- **M-1d:** the intro line says green means checked and clear, and no figure on any tile is labelled just "Last 24 h".
- **M-1e:** on the spend tile, open "How this tile is coloured". The last line reads "Otherwise: green, … unless a figure is only a minimum; then amber …".
- **M-2 (L-5.9):** Vercel → Project → Settings → Cron Jobs lists exactly the 12 `/api/cron/*` Business OS paths. It lists none of `/api/run-scheduled-agents`, `/api/cron/update-template-scores` or `/api/cron/memory-consolidation`.

### Final Status
- [x] Every PR-1 acceptance criterion that QA can test passes. **Ready for the user's diff review.** No High or Medium issue; the four Low edge cases above are optional.
- [x] Merge gate **L-5.6** recorded by the user 2026-09-27: 0 agents, 0 owners, never run. SA's code review approved PR-1 with nits; its comment 1 (§18 is stale since PR #119) is a docs follow-up for Dev.

**Verdict: PASS**

---

**QA — 2026-09-27 (PR-2: parts B + C + D)**
**Test mode:** full, scoped to PR-2 (the run record, the Scheduled jobs & queues page and its route, Health tiles 6 and 7)
**Strategy used:**
- A: Jest unit probes for the recorder, the registry, the status computation and the tiles.
- B-lite: route tests with the reads mocked, and a repository probe that runs the recorded PostgREST filters against synthetic rows through a small in-memory interpreter.
- A base comparison: one version-agnostic probe run on base `609635ff` (a temporary worktree outside the repo, since deleted) and on the PR-2 tree, and the two outputs diffed.
- **A throwaway local Postgres:** PGlite 0.5.8 (PostgreSQL 18.3 compiled to WASM), installed in the QA scratchpad only. The migration, the runbook's four steps and the rollback were run there, with roles `anon`, `authenticated` and `service_role` (`BYPASSRLS`, as on Supabase). **No production or Supabase database was touched.**
- Static gates and `next build` with the CI placeholder env.

**Focus:** api, schema, security, ui (the page), and the 12 crons
**Skipped:**
- E2E: not set up in this repo. Manual checks are listed below.
- L-5.x: the user's production checks. QA runs no production queries.

**Input source:** TL prompt (items 1 to 9)

### Command results (real output, 2026-09-27, worktree `neuronforge-admin-bos-reorg`, uncommitted, `MERGE_HEAD` = `609635ff` left in place)

| Command | Result |
|---|---|
| `npx jest app/admin lib/admin app/api/admin app/api/cron lib/audit lib/repositories lib/business-os/usage lib/business-os/entitlements lib/business-os/llm lib/business-os/purge lib/cron --ci --maxWorkers=50%` (Dev's files only) | **161 suites: 160 passed, 1 failed. 3,684 tests: 3,683 passed, 1 failed.** Same as Dev's §19.3 |
| The same command, including QA's 5 probe suites | **166 suites: 165 passed, 1 failed. 3,990 tests: 3,989 passed, 1 failed** |
| The one failure | The parked "TokenUsageRepository account contract › pins every public method and its arity; no account filter became optional". **Identical on base `609635ff`:** 1 failed, 4 passed, with the same single extra method, `summariseFeatureAllAccountsInWindow`. (SA's 132-suite list omits `lib/business-os/usage`, which is why it shows no failure) |
| `npm run test:bos-entitlements` | 66 suites / 1,308 tests passed (includes `bos-cron-runs.migration.test.ts`) |
| `npm run test:authz-guard` | 1 suite / 119 tests passed |
| `npm run typecheck:bos-llm` | 253 files in scope, 28 errors, **0 new**: passed. It also reports the pre-existing "1 baseline entry is fixed" in `app/api/onboarding/build/route.ts`, not touched |
| `npm run check:bos-llm-literals` | 46 files in scope, 2 exempt, 0 violations: passed |
| `npm run lint:hooks` | exit 0 |
| `npx eslint lib/cron lib/admin app/admin/jobs-queues app/admin/components app/admin/__tests__ app/api/admin/jobs-queues app/api/admin/health-summary app/api/cron` + the new repositories, `index.ts`, `descriptors.ts`, the migration test, the fixtures and the QA files | exit 0, **0 errors**. 3 warnings, all in the untouched `app/api/cron/process-queue/route.ts` |
| `next build` with the CI placeholder env from `build.yml` (no `.env*` file in the worktree) | **exit 0.** `✓ Compiled successfully`, `✓ Generating static pages (305/305)`, `ƒ /admin/jobs-queues` 7.18 kB, `ƒ /api/admin/jobs-queues`. The `DYNAMIC_SERVER_USAGE` lines were there before |

### Local Postgres run (PGlite; throwaway; nothing real)

| Step | Result |
|---|---|
| Pre-check, before applying | 4 rows, all `PASS` |
| Apply (the whole file, runbook comment block included) | OK; 1 `bos_cron_run_recording` row |
| Pre-check, after applying | P01 = `STOP: already applied, do not apply again` |
| Access check | **One row; all 15 columns `true`** |
| Dry run | `DRY RUN PASS: D-1 PASS \| D-2 PASS (numbers only) \| D-3 PASS (key rule) \| D-4 PASS (class list) \| D-5 PASS (running consistency) \| D-6 PASS (failure has a class) \| D-7 PASS (deadline bound) \| D-9 PASS (summary) \| D-10 PASS (a job with no runs still gets a row) \| D-11 PASS (30-day prune) \| (this error is expected: it rolls everything back)` |
| Nothing kept | `runs_kept = 0`, `recording_rows = 1` |
| A second paste | Fails at `relation "bos_cron_runs" already exists`, and nothing changes (0 / 1) |
| Role probes | `anon` and `authenticated` get `permission denied` on both tables and on the function. `service_role` can run the function, but `TRUNCATE` and any write to `bos_cron_run_recording` are denied |
| The function's clamps | 60 jobs in → 50 rows. `p_recent` 999 → 20, 0 → 1. NULL arguments → 0 rows. Duplicate and NULL job names are dropped. Rows started after `p_now` are excluded |
| Rollback, then rollback again | Three NULLs; the second run is a no-op. The pre-check then passes again, and a re-apply plus access check is all `true` |
| The CHECKs not exercised by the dry run | Each is refused: an upper-case `job`, `source = 'manual'`, a running row with `duration_ms`, `succeeded` with an `error_class`, `deadline_at = started_at`, a second recording row, a 41-character key, a key starting with a digit, a key with `_`, over 1,024 bytes, `null`, `true`, a nested object, a top-level array, an array of strings. A 40-character key and negative or fractional numbers are accepted |
| **Not refused** | `{"a": [1, 2]}` and `{"a": []}`: bug 1 below. `'strict $.* ? (@.type() != "number")'` refuses both (checked in PGlite) |

### Test Coverage

| Acceptance criterion / check | Tested? | Result | Notes |
|---|---|---|---|
| B: every one of the 12 jobs records every authorised run, including "nothing to do" | ✅ | Pass | Dev's adoption test (12 × 3), plus QA's base comparison (scenarios A and A2): exactly one start with the right job id, and one finish |
| B: the job's response is identical, recorded or not | ✅ | Pass | **QA base comparison: 12 routes × 17 scenarios = 204 outcomes (status + body, timings stripped), identical on base `609635ff` and PR-2: 0 differences** |
| B: an unauthorised call writes nothing, and the route's own auth outcome is unchanged | ✅ | Pass | Checked on all 12 routes: a wrong secret (same length, different length, with a suffix, lower-case `bearer`), no header, an unset secret (including a literal `Bearer undefined`), an empty secret with `Bearer `, `NODE_ENV` development or test, `VERCEL_ENV` preview or unset. No write in any of them. Statuses equal base: 401 everywhere, except that with no secret the two fail-open routes (`calendar-sync`, `channel-metrics-sync`) still run (200), as on base, **and record nothing**, so they will turn Late, then Stopped (R-19 surfaces) |
| B: the dev-only POST handlers are unaffected | ✅ | Pass | Development POST with or without a header: 200 on the 5 routes that have one (405 means the route has no POST), same as base, never recorded. A production POST gives 405 on all 12, same as base |
| B: a job that throws still throws the same error | ✅ | Pass | The same object (`rejects.toBe`), recorded as `failed/exception` first. `TimeoutError` is classed `timeout`. Unrecorded: the same error, with no write |
| B: a hung or failing record write never delays the response by more than 1.5 s, and never changes it | ✅ | Pass (see edge case 3) | Measured on the same response object: start hung **1,561 ms**, finish hung **1,521 ms**, prune hung **1,518 ms**. A rejected or synchronously thrown start, finish or prune adds <15 ms. Finish hung while the job throws: the same error in about 1.5 s. **Start and finish both hung (a dead database): 3,024 ms**, which is two deadlines, by design (SC-2(b)) |
| B: the counts allow-list drops money and bad keys | ✅ | Pass | A poisoned body (`totalValueImpact`, `amount`, `revenue`, `totalAmount`, strings, NaN, Infinity, arrays, objects, owner text), run through all 12 jobs' specs: only each job's registry keys survive, as finite numbers; no money value and no text. Every key and path segment passes the money regex and the DB key regex. The 12 count paths were also checked by hand against the real response shapes of each route and its service |
| B: every one of the 12 routes is wired to the right job id | ✅ | Pass | `git diff`: each route changes only by the import, `GET` → `runJob`, and `export const GET = withCronRunRecord('<its own folder name>', runJob)`. The id equals the path in every case. The base comparison confirms the id at runtime (`start.job === id`) |
| B: "did not finish" once the limit plus margin has passed | ✅ | Pass | Dev's tests, and the dry run's D-8/D-9 (a running row past its deadline counts as bad) |
| B: no owner text or error message is stored | ✅ | Pass | The DB refuses strings, messages and bad keys (PGlite); the recorder logs a `reason` only (probe: a rejected write whose message holds an email never reaches a log). Bug 1 is the one gap; it can carry numbers only |
| B: retention | ✅ | Pass | D-11 in PGlite: a 31-day row is pruned and a 29-day one kept |
| B: the migration is safe to run twice, has a written undo, and the code is safe before it | ✅ | Pass | PGlite: a second paste changes nothing; the rollback is idempotent. The not-installed paths are in the route and status probes below |
| B: FR-R9, a job in `vercel.json` must appear on the page | ✅ | Pass | Dev's `bosCronJobs.test.ts` (74 tests) |
| Migration vs SC-3 | ✅ | Pass, 1 gap | Every CHECK in SC-3(a)(b) is present **verbatim**, and the static test pins them. SC-3(c): the bad-key (D-3) and deadline-bound (D-7) cases are in the dry run. SC-3(d): RLS on with no policy; `REVOKE ALL` from PUBLIC, anon, authenticated and service_role, then the exact grants; the function is `SECURITY INVOKER` with `search_path = ''`, every name schema-qualified; the clamps are inside. **Gap:** SC-3(a)'s own expression is lax jsonpath (bug 1) |
| Runbook steps complete and in order | ✅ | Pass | Pre-check → apply (header item 2) → access check → dry run → nothing kept; the rollback is a separate file. Matches §19.5 step 3 (a) to (e) |
| C: due-now filters match each queue's claim function | ✅ | Pass | Read against `2026-08-14_payment_reminders_claim.sql:58-60`, `…_payment_automation_executions_claim.sql:73-75`, `20260911_daily_briefing.sql:141-142`, `20260914_lead_responses.sql:132-133` and `20260917_insight_actions.sql:167-168`. No later migration redefines them (only comments in `20261004`) |
| C: status mapping, stuck detection, oldest due | ✅ | Pass | **QA semantic probe** (the recorded filters run against synthetic rows):<br>- due exactly at `now` counts, as in the claim's `<=`;<br>- stuck at exactly 690 s is not stuck (strict `<`);<br>- `dead_letter` status is the automations dead-letter, while a `failed` row with the marker counts as a failure there (only the reaper writes `dead_letter`; checked in the code);<br>- on the other four queues, `failed` + marker is the dead-letter, and a NULL `error_message` is still a failure (null-safe);<br>- guardrail skips are counted apart;<br>- unrecognised statuses are counted;<br>- the oldest due item is the minimum of the two candidates.<br>All 5 queues give the hand-worked figures |
| C: no payload, `error_message` or owner text in any response or log | ✅ | Pass | Every select is `id` or a due/claim timestamp. The semantic probe plants owner text, a message and the marker in the rows: none reaches the figures or any log argument. The route probe's generic failure (an email in the message) never reaches a log. Plus Dev's SC-10 leak test |
| C: the page is under Monitor, third, and a non-admin is refused | ✅ | Pass (code and API) | Sidebar Monitor = Health, AI cost & usage, **Scheduled jobs & queues**, Audit trail, Archiving. The nav test counts are updated (25 entries, 26 pages on disk, `onDisk` contains `/admin/jobs-queues`). The API gives 401/403 with no read (Dev), and **403 comes back in <1 s with hung reads and parameters present** (QA). The page redirect is the layout's `requireAdminPage`, and the authz guard (119/119) sees 26 pages |
| C: all 12 jobs and 5 queues with the §S5.7 figures; Due now and Scheduled for later separate; nothing coloured by later items | ✅ | Pass | Render test (Dev), plus the QA probe: 500 later items and 9 with no due time on every queue still leave the Queues tile green |
| C: read-only, with no retry, requeue, cancel or drain button | ✅ | Pass | Refresh is the only `<button>`; the source guard forbids the rest and any POST |
| D: late and stopped at exact boundaries, per schedule | ✅ | Pass | All 12 jobs: exactly at `interval + grace` → Healthy; +1 ms → Late; exactly at `2 × interval + grace` → Late; +1 ms → Stopped. The thresholds equal the requirement table (15/20, 25/40, 70/130 min, 25/49 h). The same on the queues' drain thresholds |
| D: manual runs don't reset "late" | ✅ | Pass | All 12: a fresh successful manual run with an old cron start stays Late. Ten fresh manual runs cannot push the last cron start out (SC-5). Manual runs alone are "No run recorded yet", never Healthy |
| D: a job with no run yet | ✅ | Pass | All 12: grey up to and at the late threshold from the baseline; +1 ms Late; past stopped, Stopped. The baseline is the first run of any job, else `installed_at`. With no run at all and a 40-day-old install, every job is Stopped and tile 6 is red |
| D: missing table → "run recording is not installed yet" | ✅ | Pass | View: every job "Could not check", with that sentence. Tile 6 is `unavailable` with the footnote; tile 7 is still measured (green). A generic failure says "could not be read just now" instead. Invalid RPC rows refuse the whole summary |
| D: tiles 6 and 7 green only when fully measured | ✅ | Pass | Quiet → both green. One job with no run → `not_measured`. One queue unread, or a queue missing from the inputs → never green |
| D: a dead-letter in the last 24 h is red | ✅ | Pass | Each of the 5 queues on its own: tile 7 red, queue status `dead_lettered_24h` |
| D: declines are never coloured | ✅ | Pass | Payment-retry with 5 declines on three runs in a row: the job is Healthy, "retries declined or failed: 5" is shown, and tile 6 is green |
| D: tile numbers equal page numbers | ✅ | Pass | A mixed fixture (stopped, late, last run failed, partly done, stuck, failures, a 3 h 10 min oldest due): every tile 6 and 7 figure is re-derived from the page view and matches, including "Worst job: Calendar sync" and "3 h 10 min (Lead replies)". Both routes floor `now` to the minute (D-17) |
| Route: 401/403 before any read; 400 on any parameter | ✅ | Pass | Dev (4 gate cases, 401/403 beat 400), plus QA: `?a=`, `?a`, `?=1`, `?%20=1` and `?success=true&data=1` → 400 with no read; a bare `?` → 200 |
| Route: one failed read makes only its own section unavailable | ✅ | Pass | A queue read hung past the deadline → 200 in about 5.0 s, only that queue "Could not check", the jobs still Healthy. A hung run summary → jobs "Could not check", the queues still measured |
| SC-4 purge classification | ✅ | Pass | `test:bos-entitlements` includes the purge invariants; baseline 126 → 128 |
| Happy path + failure path for each new route, repository method and the recorder | ✅ | Pass | Dev's tests plus the QA probes |
| QA manual check of the page as a platform admin | ⚠️ | Owed | No E2E and no running deploy here. M-3 to M-7 below |

### Issues Found

#### Bugs (must fix before the migration is applied)
1. **The counts "numbers only" CHECK accepts arrays.** File: `supabase/migrations/20261011_bos_cron_runs.sql:264`. Severity: **Medium**. This is the same finding as SA code-review comment 1, which QA reproduced independently.
   - Steps to reproduce: in a throwaway Postgres, as `service_role`, insert a row with `counts = '{"a":[1,2]}'` (or `'{"a":[]}'`).
   - Expected: `check_violation`, per SC-3 ("every value a number").
   - Actual: accepted. Lax-mode jsonpath unwraps arrays before the filter runs.
   - Impact: the recorder never writes an array, and an array cannot carry text, so FR-R5 holds. But one stored array would fail `readJobsQueues`' Zod (`z.number().finite()`), and **all 12 jobs** would show "Could not check".
   - Fix (SA's): use `'strict $.* ? (@.type() != "number")'`, which refuses both in PGlite and still accepts every valid object. Add a dry-run case, and pin `strict` in `bos-cron-runs.migration.test.ts`.
   - **Must land before the user applies the migration.** After that, it needs a second hand-applied migration.

#### Performance Issues (should fix)
None measured. The live budget is L-5.12, after deploy.

#### Edge Cases (nice to fix)
1. **"Not installed" is matched too broadly.** `lib/repositories/supabaseErrorCodes.ts:21` (SA comment 2 cites `:174`, but the file has 22 lines): `/does not exist/` also matches Postgres `42703` (`column … does not exist`). A drifted column would read "run recording is not installed yet", and the recorder would skip the finish and back off for 5 minutes. It is never Healthy, only mislabelled. Severity: Low.
2. **Times are labelled UTC by slicing the string.** `app/admin/components/jobs/JobsQueuesView.tsx:66-68`: `utc()` takes characters 0–10 and 11–16. The run times inside `recent` come from `to_jsonb(timestamptz)`, which uses the database session's time zone (PGlite in local time gave `…+02:00`). Supabase defaults to UTC, so this is fine today, but a non-UTC database would show local times labelled "UTC". Fix: `new Date(iso).toISOString()` before slicing. Severity: Low.
3. **A dead database adds about 3 s, not 1.5 s.** When both the start and the finish hang, each waits out its own deadline (measured 3,024 ms), because SC-2(b) finishes after a timed-out start. That is within R-4's accepted ~4.5 s worst case, and a single hung write stays at about 1.5 s. Informational.
4. **An unfinished last run shows its outcome twice.** `JobsQueuesView.tsx:119` and `:121` both render `runWords(lastRun)` when `finishedAt` is null. Cosmetic.
5. **The dry run does not exercise 8 of the CHECKs.** Those are the `job` regex, `source`, deadline after start, finish after start, error only on failure, "running is bare", the 1,024-byte size, and the duration/HTTP ranges. QA proved each in PGlite, and the static test pins each, so this is optional runbook hardening.
6. **A synchronously throwing handler would run twice.** `lib/cron/cronRunRecorder.ts:199-209`, SA comment 3, which QA noticed too. Unreachable today, because all 12 `runJob`s are `async`. Low.
7. **`CREATE OR REPLACE FUNCTION`** at `20261011_bos_cron_runs.sql:307`, SA comment 6. Harmless. Informational.

### QA tests added (uncommitted; Dev or RM can keep or drop them)

| File | Tests | What it covers |
|---|---|---|
| `app/api/cron/__tests__/qa-slice5-pr2.baseCompare.test.ts` | 204 | 12 routes × 17 auth/env/method scenarios. Version-agnostic: it wrote `QA_OUT` on base and on PR-2, and the diff was 0. It asserts "recorded only when proven" on PR-2 |
| `lib/cron/__tests__/qa-slice5-pr2.recorder.test.ts` | 33 | Measured hang, reject and throw timings, the same response object, the same error, the gate cases, the poisoned-body counts across all 12 jobs |
| `lib/admin/jobs/__tests__/qa-slice5-pr2.status.test.ts` | 53 | Exact boundaries for all 12 jobs and the 5 drain thresholds, manual runs, no-run baselines, not installed and failed reads, tile colours, declines, A-8 over a mixed fixture |
| `lib/repositories/__tests__/qa-slice5-pr2.queueSemantics.test.ts` | 5 | The in-memory PostgREST interpreter: hand-worked figures for all 5 queues, with owner text planted and never leaked |
| `app/api/admin/jobs-queues/__tests__/qa-slice5-pr2.route.test.ts` | 11 | Hung and failed reads isolated, invalid RPC rows, parameter edge cases, 403 before any read |

### Manual and live checks owed by the user, in order

**Before PR-2 merges**
1. **L-5.10** (Offir, Vercel → Project → Settings → Functions): is Fluid compute on, and what is the default max duration? If it is above 300 s, Dev changes the 5 assumed limits before merge; above 1,140 s, the 20-minute CHECK bound too. **Pre-merge gate (SC-6).**
2. **L-5.1 to L-5.5** (read-only SQL, §10): columns, status values, indexes, row counts, marker labels. Any status outside §6.1, or any table over ~100k rows: tell Dev before merge.
3. **Apply the migration (L-5.7)**, in the Supabase SQL editor on PROD, per its header, **only after bug 1 is fixed**:
   - (a) Pre-check: 4 rows, all `PASS`.
   - (b) Paste and run the whole file once.
   - (c) Access check: 1 row, all `true`.
   - (d) Dry run: the text starts `DRY RUN PASS`.
   - (e) Nothing kept: `0` / `1`.
   - Any failure in (c) to (e): run `supabase/SQL Scripts/20261011_bos_cron_runs_rollback.sql` and send the output to Dev.
4. **L-5.11:** `npm run schema:check` is clean for the new reads.

**After PR-2 merges and deploys**
5. **L-5.8 at +2 h:** the §10 SQL shows 9 jobs with a `vercel_cron` run (all but `insight-metrics`, `insight-detect`, `payment-reminders`), and no job is Late or Stopped on `/admin/jobs-queues`.
6. **L-5.8 the next day after 09:00 UTC:** all 12 jobs recorded. This is the OQ-2 proof that `CRON_SECRET` works.
7. **L-5.12:** in the Vercel logs, `Health summary served` and `Jobs and queues served` show `totalMs` ≤ ~1.5 s p50 and ≤ 3 s worst.
8. **M-3:** "Scheduled jobs & queues" is third under Monitor. A non-admin is redirected from the page; the API gives 403, or 401 signed out.
9. **M-4:** all 12 jobs and 5 queues are listed; Refresh is the only button; "As of HH:mm UTC" is shown.
10. **M-5:** tiles 6 and 7 show the same numbers as the page, and each links to it ("Open Scheduled jobs & queues").
11. **M-6:** the same as L-5.8, checked on the page (+2 h and the next day).
12. **M-7:** the same as L-5.12.

### Final Status
- [x] Every PR-2 acceptance criterion that QA can test passes. There is no High issue. **One Medium (bug 1 = SA comment 1) must be fixed before the user applies the migration;** the fix is one word, one dry-run case and one test pin. QA does not need to re-run anything beyond the migration test and the PGlite dry run, which the fix's own test pin covers. 7 Low or informational edge cases.
- [ ] Merge gates still open: bug 1, L-5.10, L-5.1 to L-5.5, the migration and L-5.7, L-5.11.

**Verdict: PASS**, on the condition that bug 1 is fixed before the migration is applied.

---

## 20. Post-merge record and follow-ups

### 20.1 What shipped

| PR | Parts | Commits | Merged |
|---|---|---|---|
| #122 | A + E (AgentsPilot crons retired, green for healthy tiles, entitlements tile, shadow-mode docs) | `b2197361`, `3cdb11be`, `454ead41`, `eb9a1fa2`, merge `63d385c1` | `609635ff`, 2026-09-27 |
| #123 | B + C + D (run record, jobs & queues page, measured tiles 6 and 7) | merge `ff2c5544`, `78520ed1`, `e802176f`, `bf54be79`, `5768ca41`, `3ce33874` | `03f5402f`, 2026-09-27 |

### 20.2 Production state

- Migration `20261011_bos_cron_runs.sql` was applied by the user, then PR #123 was merged; the access check, dry run and "nothing kept" were run straight after (L-5.7 ✅). The page's missing-table fallback covered any gap.
- `BOS_ENTITLEMENTS_MODE` is `shadow` on purpose (OQ-8).
- 12 Business OS crons are scheduled; the 3 AgentsPilot schedules are retired (L-5.6: no scheduled agents affected).

### 20.3 Schema check findings (L-5.11, main `03f5402f`)

32 of 605 selects cannot run. None come from this slice. Split by owner:

| Group | Selects | Effect today | Where it goes |
|---|---|---|---|
| **Admin screens** | `app/api/admin/audit-trail/route.ts`: `users` (relation missing). `app/api/admin/token-usage/drill-down/route.ts`: `workflow_executions.input_data` (column missing). `app/api/admin/users/[id]/stats/route.ts`: `agent_executions.total_tokens_used` and `user_subscriptions.plan_name` (columns missing) | Audit trail user names are empty (OI-18); the execution-level drill-down likely fails; the Businesses detail "all-products stats" block is likely empty | **Next admin slice** (requirement roadmap R-20) |
| **Business OS / Stripe** | `app/api/stripe/create-checkout/route.ts`: `profiles.display_name`. `app/api/stripe/invoices/route.ts` and `app/api/stripe/webhook/route.ts`: `ais_system_config.pilot_credit_cost_usd`. `lib/payments/contactStatement.ts`: `payment_invoices.description`. `lib/business-os/bizql/mutate/MutateExecutor.ts`: `scheduling_services.name`. `app/api/website/landing-pages/generate/route.ts`: `business_profiles.target_audience` | Each whole select is rejected, so the code may silently fall back to defaults. The Stripe webhook may be crediting with a fallback rate | **Separate fix**, suggested as its own task on 2026-09-27; money paths first (requirement roadmap R-21) |
| **Parked AgentsPilot** | About 20 others (agents, memory, workflows, API keys, pilot insight) | AgentsPilot is parked | Left as they are |

The check's blind spots (star selects, embedded joins, template literals, insert/update payloads) mean 32 is a floor.

### 20.4 Still owed by the user

| Check | When | Expect |
|---|---|---|
| L-5.8 | About 2 h after the PR #123 deploy | 9 jobs with a `vercel_cron` run (all but `insight-metrics`, `insight-detect`, `payment-reminders`), `bad_runs` = 0, none late on `/admin/jobs-queues` |
| L-5.8 | The next day after 09:00 UTC | All 12 jobs recorded. **This is the OQ-2 proof that `CRON_SECRET` works** |
| L-5.9 | After the PR #122 deploy | Vercel → Cron Jobs lists exactly the 12 BOS paths |
| L-5.12 | After deploy | `totalMs` ≤ ~1.5 s p50 and ≤ 3 s worst, for both routes |
| M-3 to M-7 | After deploy | Page third under Monitor; 12 jobs and 5 queues; tiles match the page; timings |
| L-5.10 | When Offir replies | Fluid compute on or off, and the default max duration. Only affects the 5 assumed limits; not a gate (see the L-5.10 row) |

### 20.5 Expected first-day behaviour

The Scheduled jobs tile stays grey on the first day. It can only turn green once all 12 jobs have a recorded run, and three of them run daily, so it should turn green after the next 09:00 UTC run if every job is accepted. The Queues tile can be green straight away (the tables are small, and L-5.5 found no failures).

---

## Commit Info

See [§20.1](#201-what-shipped): PR #122 (`609635ff`) and PR #123 (`03f5402f`), both merged 2026-09-27.

---

## Change History

| Date | Change | Details |
|------|--------|---------|
| 2026-09-27 | Created (Dev, planning) | Workplan for slice 5 after the user's answers to OQ-6 to OQ-9. Verified the 12 cron routes, the five queue migrations (no failure timestamps; guardrail skips separable by fixed messages), the Health evaluator, the entitlements tile (it emits no digit) and the docs that call the mode unset. Proposes: one migration (`bos_cron_runs`, `bos_cron_run_recording`, `admin_bos_cron_run_summary`) with a house-style runbook; a wrapper-based shared recording step with its own strict authorisation gate; prune-on-every-run retention; PostgREST queue counts; a four-part replacement for C-10 (green only when measured, exact and clear; entitlements never green); two PRs (A + E, then B + C + D). 16 forks for SA, 3 business questions |
| 2026-09-27 | SA workplan review | Approved with conditions SC-1 to SC-12. All 16 forks ruled (all recommended options approved). C-10 re-ruled as C-10R ("green only when proven clear", with eligibility as a code constant, entitlements never green and C-18 unchanged). Missed step added: purge classification of the two new tables (SC-4). Technical implications of Q-U1..Q-U3 noted |
| 2026-09-27 | PR-1 implemented (Dev), uncommitted | Parts A + E per C-10R and SC-7: `vercel.json` 15 → 12 with a pin test; green only when proven clear (`GREEN_ELIGIBLE` in code, one predicate over metrics **and** figures, entitlements never green, "For information"); a two-level biconditional fuzz; the source guard re-ruled to one `GREEN_STYLE`; the entitlements tile in plain words with a visible link; self-describing figure labels; RC-5.3 in three docs. User answers Q-U1..Q-U3 recorded (T0b); `CLAUDE.md` untouched, its changes listed in §18. Real verification output in §17.3 (only the parked contract test fails). Deviations D-1..D-9 |
| 2026-09-27 | SA code review, PR-1 | ✅ Code Approved with nits; approved for QA. Every C-10R / SC-7 item verified in code and tests; D-1..D-9 accepted. SA re-ran Jest (only the parked contract test is a real failure; two untouched render suites timed out under concurrent load and pass alone), `test:bos-entitlements`, `test:authz-guard` and `typecheck:bos-llm`. No file overlap with `main` @ `94128b5b` (#118, #119). One Medium: §18 is stale, because PR #119 removed the `CLAUDE.md` text it would edit. Three Low items |
| 2026-09-27 | QA, PR-1 | **PASS.** Full Jest list run twice: the second run is 142 suites / 3,173 tests, and the only failure is the parked contract test (identical on base `546f6110`). The first run also hit three 5 s timeouts in untouched suites, which passed on their own. The entitlements tests, the authz guard, both BOS LLM gates, ESLint, `lint:hooks` and `next build` are all green. `vercel.json` compared with base (12 BOS crons, same order and schedules, the rest identical; the 3 AgentsPilot routes unchanged). 44 QA probe tests added, uncommitted. 4 Low edge cases, no bugs. L-5.6 is still owed before merge |
| 2026-09-27 | PR-1 review follow-ups (Dev) | SA-1: §18 rewritten; PR #119 removed the `CLAUDE.md` text, so U-A/U-B/U-C are moot for `CLAUDE.md`, with a warning not to reintroduce it; each item mapped to its doc; Q-U3 stays parked. QA-1: remaining "production runs off/unset" wording corrected in `shadow.ts`, the `shadow.test.ts` title and a `chat-v4/route.ts` comment. SA-2/QA-2: `HealthTile.tsx` header. SA-3: the leftover "continued" describe folded back. SA-4: the green-class pattern covers 13 colour prefixes, each self-tested. QA-3: the entitlements page link stays when its read fails or its rule list is invalid (tested). See §17.6 |
| 2026-09-27 | L-5.6 recorded (PR-1 merge gate) | The user's read-only production check: `scheduled_active_enabled_agents = 0`, `owners = 0`, `most_recent_scheduled_run = null`. Retiring the three AgentsPilot crons stops no one's scheduled agents. L-5.6 marked ✅ in §15 and the task list (T0c); PR-1's merge gate is met |
| 2026-09-27 | PR-2 implemented (Dev), uncommitted | Parts B + C + D on `feature/admin-bos-jobs-queues-pr2` after `git merge --no-commit --no-ff origin/main` (clean, nothing to stage). Migration `20261011_bos_cron_runs.sql` plus a separate rollback; the registry, the recorder across all 12 routes, the two repositories, the shared read and computation, `/api/admin/jobs-queues`, the page, tiles 6/7 measured, the purge classification (SC-4), and the admin census re-measured (84 / 78 + 6 / 55; 26 pages). SC-1 to SC-12 and C-10R applied. The SC-10 leak test found and closed a spread of queue figures (D-15). Real verification output in §19.3 (only the parked contract test fails). Deviations D-10 to D-20; the user's ordered steps in §19.5 |
| 2026-09-27 | SA code review, PR-2 | ✅ Code Approved with nits. Approved for QA once comment 1 is applied. SC-1 to SC-12, C-10R and D-10 to D-20 verified in code and tests. The census was re-counted from disk (84 = 81 + 3 `HEAD`; 78 + 6; 55 files; 26 pages). SA ran the migration itself (PGlite, PostgreSQL 18.3): pre-check, apply, access check (all true), `DRY RUN PASS`, nothing kept 0/1, rollback twice. That run found one Medium: the lax-mode numbers-only CHECK accepts `{"a":[1,2]}` (fix: `strict`, before the user applies). Six Low items. Jest (132 suites / 3,064 tests), `test:bos-entitlements`, `test:authz-guard` and `typecheck:bos-llm` all green |
| 2026-09-27 | QA, PR-2 | **PASS, on the condition that bug 1 is fixed before the migration is applied.** Full Jest list: 166 suites / 3,990 tests, including QA's 5 probe suites (306 tests). The only failure is the parked contract test, identical on base `609635ff`. The entitlements tests, the authz guard, both BOS LLM gates, `lint:hooks`, ESLint and `next build` are all green. The base comparison of 12 routes × 17 auth scenarios showed 0 differences. Hung record writes each cost about 1.5 s; the same response object comes back and the same error is rethrown. The migration, runbook and rollback were run on a throwaway PGlite database: `DRY RUN PASS`, access check all true. **Bug 1 (Medium; SA comment 1, reproduced independently): the lax-jsonpath counts CHECK accepts arrays.** 7 Low or informational edge cases. No production database was touched |
| 2026-09-27 | PR-2 review follow-ups (Dev) | SA-1 (Medium): the numbers-only CHECK is strict jsonpath, and the dry run refuses `{"a":[1]}`, `{"a":[]}` and nested objects. SA-2: a missing column is never "not installed". SA-3: the handler is called exactly once. SA-4: a finish of 0 rows is not "recorded". SA-5 `GREEN_HEADLINE`; SA-6 plain `CREATE FUNCTION`; SA-7 the "nothing kept" note. QA-L2 UTC conversion, QA-L4 outcome words once, QA-L5 dry-run cases D-12 to D-20. See §19.6 |
| 2026-09-27 | L-5.1 to L-5.5 recorded (PR-2 merge gates) | The user's read-only production checks: all columns the page reads exist with the expected types (nullability noted); statuses present are all within each queue's known list; each queue has a partial pending index on its due column; approximate rows 45 / 0 / 3 / 0 / 12, all ≤ 160 kB; no failed or dead-lettered rows. Marked ✅ in §15 and T0c. **L-5.10 (Offir) still open**; L-5.7 and L-5.11 follow the migration |
| 2026-09-27 | Post-merge record (§20) | PR #122 and PR #123 merged. Migration applied in PROD; L-5.7 recorded (access all true, DRY RUN PASS, nothing kept). L-5.11 schema check: 32 pre-existing broken selects, none from this slice, split into admin (next slice, R-20), Business OS / Stripe (separate fix, R-21) and parked AgentsPilot. L-5.10 is no longer a gate per Vercel's docs (default 300 s, project max 800 s). Commit Info filled. Still owed: L-5.8, L-5.9, L-5.12, M-3 to M-7 |
