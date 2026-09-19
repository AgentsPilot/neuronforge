# Workplan: Business OS Subscription & Entitlements Module

> **Last Updated**: 2026-09-19

**Developer:** Dev
**Requirement:** [BUSINESS_OS_SUBSCRIPTION_ENTITLEMENTS_REQUIREMENT.md](/docs/requirements/BUSINESS_OS_SUBSCRIPTION_ENTITLEMENTS_REQUIREMENT.md). This workplan was written against the uncommitted copy in the main working tree on 2026-09-19, which includes §21 SA Review and conditions WC-1 to WC-22. The user's scope change of 2026-09-19 (§1.1) supersedes parts of that requirement, and TL is routing the requirement update to BA (§12.4).
**Date:** 2026-09-19
**Status:** Revised (rev 2) for the user's scope change, RC-1 to RC-17 and the S-1 to S-12 decisions from the SA workplan review (§13, APPROVED WITH CONDITIONS). **Waiting for the SA delta re-check** of the sections listed in §0. No code has been written.
**Branch:** `feature/business-os-entitlements`, created from `origin/main` at `94f9cfcd` (WC-1). Dev created it on TL's instruction. The Dev role normally leaves branch creation to RM, and this deviation is recorded here for RM.

## Overview

Business OS has no commercial gating today. This workplan builds the **infrastructure** for subscriptions and entitlements in the four slices of the requirement (§16): a capability catalog, a tier-matrix *mechanism*, cohorts, a pure resolver, per-account plan rows, admin operations, and a shadow-mode usage and "what would be gated" report. Under the user's scope change, **production config ships with no commercial tiers**. Eyal's example matrix exists only as a test fixture. Champions get every capability, and every existing account becomes a champion at rollout. Slice 1 is planned in full, sits behind a server-only flag, and changes nothing customers see. Slices 2 to 4 (enforcement, metering, billing) are outlined, and each gets an SA-reviewed addendum that restates its WCs as tasks and tests (G-3). Every WC and RC is traced in §9.

---

## Table of Contents

0. [Revision 2: What Changed and What SA Re-checks](#0-revision-2-what-changed-and-what-sa-re-checks)
1. [Inputs and Decisions Honoured](#1-inputs-and-decisions-honoured)
2. [Analysis Summary (verified on origin/main)](#2-analysis-summary-verified-on-originmain)
3. [Module Architecture](#3-module-architecture)
4. [Slice 1: Catalog, Config, Resolver, Plan Row, Admin Ops, Shadow Report (full detail)](#4-slice-1-catalog-config-resolver-plan-row-admin-ops-shadow-report-full-detail)
5. [Slice 2: Enforcement (outline)](#5-slice-2-enforcement-outline)
6. [Slice 3: Metering (outline)](#6-slice-3-metering-outline)
7. [Slice 4: Billing (outline)](#7-slice-4-billing-outline)
8. [Rollout, Flag Plan and Gates](#8-rollout-flag-plan-and-gates)
9. [Traceability (WC and RC)](#9-traceability-wc-and-rc)
10. [console.* Files in the Touch Set](#10-console-files-in-the-touch-set)
11. [Risks](#11-risks)
12. [Config Defaults, SA Decisions, Separate Changes, BA Follow-ups](#12-config-defaults-sa-decisions-separate-changes-ba-follow-ups)
13. [SA Review Notes](#13-sa-review-notes)
14. [QA Testing Report](#14-qa-testing-report)
15. [Commit Info](#15-commit-info)

---

## 0. Revision 2: What Changed and What SA Re-checks

| Section | Change | Driven by |
|---|---|---|
| §1 | Scope change U-1 to U-3, user defaults UD-1 to UD-4, gates G-1 to G-3 | U-1..3, RC-17 |
| §3 | Fixtures folder. `shadow.ts` imports only `mode.ts`. Account route moved to `accounts/[accountId]`. | RC-1, RC-7, S-10 |
| **§4.3** | **Migration SQL rewritten:** no user policies + `REVOKE ALL`; actor columns without FK; `plan_version DEFAULT 0` + CHECK; fact columns; hardened trigger (a)–(i); single-transaction order; champion backfill; shadow table records all outcomes + rule + item count | RC-3, RC-6, RC-8, RC-9, RC-14, S-4, S-7, S-8 |
| §4.4 | `client_render` audience for branding. Sends are declared in the Slice 2 send registry with `initiator`. | S-1 |
| §4.5 | `readRule` is a config value, and the recorder captures `for_each` item counts | RC-5, S-2 |
| **§4.6** | **Production config has zero tiers.** Example matrix moved to a fixture. Cohort base `{ tier } \| { all: true }`. Explicit champion/trial values for quantity/metered/fair-use. `durationHistory`/`graceHistory`. `trial.clockStartsAt`. Send policy keyed by send id. Enforce precondition. | RC-1, RC-2, RC-5, S-7, UD-1, UD-2 |
| §4.7 | Injectable source, zero-tier Zod handling, history validation | RC-1, S-7 |
| **§4.8** | **Resolver:** `{ all: true }` derivation, tier wins over cohort (RC-11), open-ended champion is active with no fallback, trial clock from facts + history, `lowestTier` nullable | RC-2, RC-4, RC-11, S-5, S-7 |
| §4.9 | Input cache with LRU cap, read-through for report/batch, stale data only for fail-open audiences, batch cap of 100 ids, paged report | RC-12, RC-13, S-6 |
| §4.10 | Lazy config load inside `shadow.ts`. Record all outcomes including `allowed`. `asTier` retroactive report. No names or reasons. | RC-6, RC-7, RC-16 |
| **§4.11** | **Provisioning:** fact-only trigger upsert, trial reset impossible, champion backfill | RC-3, RC-14, S-7, S-8 |
| **§4.12** | **Admin ops:** tenant pre-check through existing repos, `ensure_plan_row`, champion `expiresAt` required key (date or `null`), `assign_tier` 400 `no_tiers_configured`, route path | RC-4, RC-10, S-5, S-10 |
| §4.13–§4.16 | Tests moved to fixtures, plus tests for RC-7/11/15/16, S-7 and S-8. CI names unchanged. Tasks and exit criteria updated. | RC-1, RC-7, RC-11, RC-15, RC-16, S-9 |
| **§5 (B-3 row)** | **`launch_champion_existing` replaces `launch_reset_trials`**, on its own route, evaluated at switch-on (UD-3). S-11 statuses. Preconditions G-1, G-2, UD-2. | RC-3, S-11, G-1, G-2, UD-2, UD-3 |
| §8, §9, §11, §12 | Gates, full RC traceability, updated risks, config defaults in place of open questions, S-12 listed as a separate change | RC-5, RC-17, G-1..3 |

**SA re-check list:** **§4.3, §4.6, §4.8, §4.11, §4.12 and the §5 B-3 row** (the ones SA named). Also, briefly, **§4.9 and §4.10**, because RC-6, RC-7, RC-12, RC-13 and RC-16 changed them materially, and **§8** for the gate placement.

---

## 1. Inputs and Decisions Honoured

| Source | Treated as |
|---|---|
| D-1 to D-14, B-2 to B-10 | Fixed business inputs (requirement §3, §19), **except where the scope change below supersedes them** (D-2 "Growth-level trial", B-3 "fresh trial for everyone else", FR-3 "every tier (Basic, Growth, Pro)"). |
| B-1 (five ambiguous sheet rows) | The capabilities stay in the catalog as placeholders (`placeholder: 'B-1'`). Their tier values exist only in the test fixture. |
| B-11 | In `paused`, invoice pay links, receipts and booking cancel/reschedule stay live. New bookings, the website and reminders stop. Suppressed sends are never sent later. |
| B-12 | Setup AI counts against the trial allowance, which must cover a typical setup with headroom. The owner is warned before setup regenerations use it up. |
| T-1 to T-12, WC-1 to WC-22 | SA decisions and conditions (requirement §21). |
| S-1 to S-12, RC-1 to RC-17, G-1 to G-3 | SA workplan review (§13). All applied in this revision, except S-12, which is a separate change needing user approval (§12.3). |

### 1.1 User scope change (2026-09-19)

| # | Direction | Where applied |
|---|---|---|
| U-1 | **Infrastructure only.** Production config ships **no commercial tiers**. Eyal's matrix is only a test fixture. The user adds tiers as config later. | §4.6 (`TIER_ORDER = []`), §4.13 (fixture tests) |
| U-2 | **Champions get all capabilities**: every catalog capability at its highest variant/quantity, including beta. `not_built` stays off. **All existing accounts become champions at rollout.** New signups follow the trial lifecycle. | §4.6 (`{ all: true }`), §4.8, §4.11 backfill, §5 launch op |
| U-3 | **The four business questions become config values**, with Dev's defaults. | §12.1 |

### 1.2 User defaults for SA's open questions (the user will confirm; each one is a single config or launch-step value)

| # | Default | Single place it lives |
|---|---|---|
| UD-1 | A new signup's trial includes **all capabilities**. | `COHORTS.trial.base = { all: true }` |
| UD-2 | Enforcement is **not switched on until at least one plan and a path onto it exist**. Until then, admins can make late signups champions. | `LAUNCH.enforceRequiresConfiguredTier = true`. `mode.ts` refuses `enforce` (logs `error`, behaves as `shadow`) while `TIER_ORDER` is empty. The "path onto it" (payment or admin assignment) is a §8 launch checklist item. |
| UD-3 | "Existing accounts become champions" is **evaluated as of the enforcement switch-on date**. | The `launch_champion_existing` op runs at switch-on (§5, §8 step 6). Its cutoff is the time it runs. |
| UD-4 | Migrated champions are **open-ended** (explicit "no end date") until an admin sets a date per account. The admin report lists them. | `cohort_expires_at = NULL` written by backfill/launch. Report count "open-ended champions" (§4.10). |

### 1.3 Gates on later slices (recorded, not Slice 1 blockers)

| # | Gate |
|---|---|
| **G-1** | **The Slice 2 `enforce` switch-on and all of Slice 4 are blocked** until the Supabase service-role key is **rotated**, the **old key revoked** (not just replaced), and the rotation **verified**. Every guarantee here (no user write policies, service-role-only RPCs, the `admin_users` gate) assumes the key is private. Slice 1 adds no new exposure and may merge and run in shadow. |
| **G-2** | Before `enforce`, the Business OS type-check job and the `bos-entitlements` Jest job must be **required status checks** on `main`. This is a repository setting, done by the user or a repository admin. `main` has no required checks today. |
| **G-3** | Every later-slice addendum restates its WCs as **concrete tasks and tests**. An outline row is not enough at addendum stage. |

---

## 2. Analysis Summary (verified on origin/main)

| Area | Finding on `origin/main` (94f9cfcd) | Impact on the plan |
|---|---|---|
| Entitlement code | None. No table uses a `business_os_` prefix. | Greenfield folder and tables. |
| Chat action surface | `business-os-plugin-v2.json` has **107** actions (`find_*`/`aggregate_*` per entity plus the `SEMANTIC_CATALOG` actions). Plan ops are `find`, `compute`, `mutate`, `for_each`, `analyse`. | The FR-6 map covers read/compute/analyse/for_each as well as mutate actions (§4.5). |
| Chat execution | `chat-v4/route.ts` gets the plan from `getBizQLPlanner().plan(...)` (~L777) and runs `executeMutate` in several places and `executeForEach` (~L1043). `saved-plans/[id]/run` also runs plans. | Slice 1: one shadow hook after planning. Slice 2: gate at execution time, including the confirm turn. |
| Tenant provisioning | `business_profiles` is inserted from **five** paths. `onboarding_conversations` is written **before** the profile. **Both parent tables have a user INSERT RLS policy** (`WITH CHECK (auth.uid() = user_id)`), so a signed-in user can fire the triggers through PostgREST (SA-verified). | DB triggers, hardened per S-8 (§4.11). |
| Purge classification | Descriptors + `classification-baseline.json`. `businessOwnedTables` test parses every migration. `purge_schema_introspect` enumerates every `public` table with a `user_id`. | All three new tables are classified `never` / person-owned in the **same PR** as the migration (WC-3). |
| Admin pattern | `app/api/admin/business-os/llm-usage/route.ts` (fail-closed `AdminAccessService`). Not `admin/boost-packs` (no auth). | Copied for T-7. |
| Skill drift | `.claude/skills/new-api-route/SKILL.md:118` tells admin routes to use `app_metadata.role`. | Not followed. Fixing it is a separate change needing user approval (S-12, §12.3). |
| Tenant check repos | `BusinessProfileRepository.findByUserId` and `OnboardingConversationRepository.getLatestMessageAt` exist. | RC-10 pre-check reuses them. `ensure_plan_row` needs the first-message time: add a small `getFirstMessageAt(userId)` to the existing repository, following the skill, with a unit test. |
| Audit | `AuditTrailService.flush()` exists. `AUDIT_EVENTS` + registry live in `lib/audit/events.ts`. | New `BOS_ENTITLEMENT_*` events. WC-7 log-then-flush. |
| CI | `plugin-tests.yml` (path-filtered) and `bos-llm-typecheck.yml` only. No CI runs `lib/**/__tests__`. **`main` has no required status checks.** | New `bos-entitlements.yml` job. G-2 makes it required before `enforce`. |
| Service-role RPC convention | `20260929_usage_summary.sql`: INVOKER + REVOKE + GRANT service_role. | Shadow RPC follows it. Trigger functions are the only DEFINER code. |
| Tier-name literals | 13 unrelated existing hits. | Forbidden-literal test with a baseline. Deny list = `{'basic','growth','pro'} ∪ TIER_ORDER` (RC-1). |
| Legacy chat (T-8) | `ChatCommandPanel.tsx:1247` calls `chat-v2`. `chat` and `chat-command` have no caller. | Retired in the first Slice 2 PR. |
| LLM foundations | `callCatalog.ts` (`BOS_LLM_CALLS`), `aiActionAudit.ts` (`runAiAction`), and the investigation doc are all present. | Slice 3 (WC-18). S1-T15 setup-cost estimate. |

---

## 3. Module Architecture

```
lib/business-os/entitlements/
  config/                      ← the ONLY place tier names may appear (FR-12)
    catalog.ts                 data-only capability catalog (engineering-owned)
    tierMatrix.ts              TIER_ORDER = [] ; TIER_MATRIX = { version: 1, tiers: {}, removals: [] }  (U-1)
    cohorts.ts                 trial / champion: base, histories, explicit values, clockStartsAt
    lifecycle.ts               grace histories + state overlay table + send policy defaults/overrides
    chatActionMap.ts           chat op/action → capability map + readRule (config value)
    launch.ts                  LAUNCH = { enforceRequiresConfiguredTier: true }  (UD-2)
  types.ts                     shapes, mapped types (CapabilityId, ValueFor<C>, TierId…) — zero-tier safe
  schema.ts                    Zod builders (catalog-derived; zero-tier safe)
  source.ts                    TierMatrixSource interface + CodeTierMatrixSource (lazy, Zod at first load)
  account.ts                   resolveAccountId(userId) — the single seam (T-2)
  lifecycle.ts                 deriveLifecycle(plan, config, now) — pure
  resolver.ts                  resolveEntitlements(...) — pure, layered, explained
  decide.ts                    check(snapshot, capability, request) → EntitlementDecision
  mode.ts                      BOS_ENTITLEMENTS_MODE reader; imports NOTHING from config/schema (RC-7)
  shadow.ts                    imports ONLY mode.ts at top level; lazy-imports the rest inside try (RC-7)
  EntitlementService.ts        getSnapshot / getSnapshots (memo, 30 s input cache, LRU cap, failure policy)
  report.ts                    static + observed + asTier-retroactive report builder
  index.ts                     server-only barrel (NOT imported by chat-v4)
  __tests__/
    fixtures/exampleTierMatrix.ts   Eyal's example matrix (basic/growth/pro) — test only (U-1, RC-1)
    fixtures/fixtureSource.ts       injectable TierMatrixSource over the fixture
lib/repositories/
  BusinessOsAccountPlanRepository.ts          plan row + overrides (service role, documented)
  BusinessOsEntitlementShadowRepository.ts    shadow counters (service role, documented)
  OnboardingConversationRepository.ts         + getFirstMessageAt(userId)   (RC-10 ensure_plan_row facts)
app/api/admin/business-os/entitlements/
  accounts/[accountId]/route.ts   GET inspect + POST single-account ops (S-10)
  shadow-report/route.ts          GET report
  launch/route.ts                 Slice 2: launch_champion_existing (multi-account, own route — S-10, RC-3)
supabase/migrations/2026MMDD_business_os_entitlements.sql
scripts/typecheck-bos-llm.ts   (SCOPED_DIRS extended; names unchanged — S-9)
.github/workflows/bos-entitlements.yml
```

Dependency rules (import test S1-T13, RC-15):
- `config/*` imports only `types.ts`: data only, no I/O.
- `resolver.ts`, `lifecycle.ts` and `decide.ts` are pure, with `now` injected.
- `mode.ts` imports nothing from `config/`, `schema.ts` or `source.ts`. `shadow.ts` has **only** `mode.ts` and the logger as top-level imports.
- Nothing under `entitlements/` imports billing (`lib/stripe/**`, `CreditService`).
- No `'use client'` file imports anything under `entitlements/` except `types.ts`.
- The repository **write-method symbols** (`BusinessOsAccountPlanRepository` write methods, the class, and its singleton, including through the `lib/repositories/index.ts` barrel) are referenced only by the admin routes and the repository's own test (RC-15).

---

## 4. Slice 1: Catalog, Config, Resolver, Plan Row, Admin Ops, Shadow Report (full detail)

### 4.1 Scope and non-goals

**In scope:** FR-1, FR-2, FR-5 to FR-13 as **mechanism**; FR-3/FR-4 as mechanism proven on the fixture (U-1); FR-22; FR-31/32 (Slice-1 admin ops); FR-34 to FR-39 as config and resolver semantics; AC-1 to AC-7, with AC-2/4/7 proven on the fixture (RC-1, RC-6); the Slice-1 parts of WC-21.

**Not in Slice 1:** commercial tier contents (U-1); blocking anything; route, cron and public-page hooks (Slice 2); `launch_champion_existing` (Slice 2, at switch-on); the add-ons table (Slice 4, S-3); the grants/usage tables (Slice 3); `license_tier` (Slice 2); usage card and `monthly_ai_allowance_usd` (Slice 3); T-8 retirement (Slice 2).

**Zero-behaviour guarantee (WC-21, SA-accepted).** With `BOS_ENTITLEMENTS_MODE=off`, the only production effects are:
1. The migration and backfill.
2. The two AFTER INSERT triggers, which never raise and are bounded by `lock_timeout`.

In addition:
- There are no entitlement reads or shadow writes, and a test proves it.
- The chat-v4 hook returns synchronously, and config is never loaded (RC-7).
- The shadow path cannot throw.
- No customer-visible route, page or cron changes.

### 4.2 Files to create / modify

| File | Action | Reason |
|---|---|---|
| `lib/business-os/entitlements/config/{catalog,tierMatrix,cohorts,lifecycle,chatActionMap,launch}.ts` | create | §4.4–§4.6 |
| `lib/business-os/entitlements/{types,schema,source,account,lifecycle,resolver,decide,mode,EntitlementService,shadow,report,index}.ts` | create | §4.7–§4.10 |
| `lib/business-os/entitlements/__tests__/fixtures/{exampleTierMatrix,fixtureSource}.ts` | create | U-1, RC-1 |
| `lib/business-os/entitlements/__tests__/*.test.ts`, `tierMatrix.snapshot.json`, `tierLiteral.baseline.json` | create | §4.13 |
| `lib/repositories/BusinessOsAccountPlanRepository.ts`, `BusinessOsEntitlementShadowRepository.ts` + unit tests | create | WC-4, `new-repository` skill |
| `lib/repositories/OnboardingConversationRepository.ts` + test | modify | Add `getFirstMessageAt(userId)` (RC-10 `ensure_plan_row`) |
| `lib/repositories/types.ts`, `lib/repositories/index.ts` | modify | Skill steps 2 and 4 |
| `supabase/migrations/2026MMDD_business_os_entitlements.sql` + `scripts/verify-bos-entitlements-migration.sql` | create | §4.3. **SA approves the SQL before it is written to the repo (S1-T0).** |
| `lib/business-os/purge/descriptors.ts`, `purge/__tests__/classification-baseline.json`, `lib/business-os/businessOwnedTables.ts` | modify | Three `never` / person-owned tables (WC-3) |
| `app/api/admin/business-os/entitlements/accounts/[accountId]/route.ts` + `__tests__/route.test.ts` | create | T-7, AC-6, S-10 |
| `app/api/admin/business-os/entitlements/shadow-report/route.ts` + `__tests__/route.test.ts` | create | AC-7, RC-6, RC-16 |
| `lib/audit/events.ts` | modify | `BOS_ENTITLEMENT_*` events + registry |
| `app/api/business-os/chat-v4/route.ts` | modify | **One** `shadowChatPlan(...)` call. Imports `@/lib/business-os/entitlements/shadow` only (RC-7). |
| `scripts/typecheck-bos-llm.ts` (+ baseline if needed) | modify | Add `lib/business-os/entitlements/` to `SCOPED_DIRS`. Header comments only; **no rename** of script, workflow, job id or display name (S-9). |
| `.github/workflows/bos-entitlements.yml` | create | Jest CI for entitlements (G-2 makes it required before `enforce`) |
| `docs/architecture/BUSINESS_OS_ENTITLEMENTS.md` | create | Adding a tier, the removal + ledger procedure, history entries, staleness bound, flag, launch preconditions, ops checks |
| `.env.example` (if present) | modify | Document `BOS_ENTITLEMENTS_MODE` |

### 4.3 Data model and migration

Three tables named `business_os_*` (C-8 namespace). Each is keyed by owner `user_id`, with an FK to `auth.users(id)` and **not** to `business_profiles`, so a Business OS Reset/Purge cannot cascade them (WC-3). **Everything runs in one transaction**, in this order: tables → RLS/revokes → functions → triggers → backfill (S-8 g). There is no window where a new tenant gets neither the trigger nor the backfill.

**File:** `supabase/migrations/2026MMDD_business_os_entitlements.sql` (sketch)

```sql
BEGIN;

-- ── 1. Tables ──────────────────────────────────────────────────────────────
-- One row per Business OS account. Lifecycle is DERIVED from these columns at
-- resolution time (T-9(5)); nothing here is moved by a cron.
CREATE TABLE public.business_os_account_plans (
  user_id               uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  tier                  text NULL,          -- validated in app against config; no CHECK naming tiers (FR-12)
  cohort                text NULL,          -- 'trial' | 'champion'; validated in app (same reason)
  plan_version          integer NOT NULL DEFAULT 0,       -- S-4: 0 ⇒ current version, only while tier IS NULL
  period_anchor         timestamptz NOT NULL DEFAULT now(),
  -- FACTS (S-7): set once by the triggers via COALESCE, never overwritten, never reset.
  onboarding_started_at timestamptz NULL,
  profile_created_at    timestamptz NULL,
  -- PINS (admin-only; NULL ⇒ derived from facts + config history):
  trial_started_at      timestamptz NULL,
  trial_ends_at         timestamptz NULL,
  cohort_expires_at     timestamptz NULL,   -- champion: NULL = OPEN-ENDED (S-5/RC-4/UD-4)
  access_ends_at        timestamptz NULL,   -- admin-assigned tier end; Stripe period end in Slice 4
  grace_ends_at         timestamptz NULL,   -- admin override of the derived grace end
  origin                text NOT NULL,      -- 'onboarding_trigger' | 'profile_trigger' | 'backfill_slice1' | 'admin' | 'launch'
  updated_by_admin_id   uuid NULL,          -- RC-9: plain uuid, NO FK (durable record; never blocks auth-user deletion)
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT business_os_account_plans_tier_versioned CHECK (tier IS NULL OR plan_version > 0)   -- S-4
);

-- Per-account admin overrides. Never deleted; ended via ended_at (§8 "never deleted silently").
CREATE TABLE public.business_os_entitlement_overrides (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id            uuid NOT NULL REFERENCES public.business_os_account_plans(user_id) ON DELETE CASCADE,
                     -- FK to the plan row so PostgREST can embed: ONE round trip for plan + overrides (T-5)
  capability         text NOT NULL,       -- validated against the catalog in app (Zod)
  op                 text NOT NULL CHECK (op IN ('set','add','revoke')),   -- T-4 ops: schema, not pricing
  value              jsonb NULL,          -- per-capability shape-validated in app; NULL for revoke
  reason             text NOT NULL CHECK (length(btrim(reason)) >= 3),
  expires_at         timestamptz NULL,
  actor_admin_id     uuid NOT NULL,       -- RC-9: no FK
  created_at         timestamptz NOT NULL DEFAULT now(),
  ended_at           timestamptz NULL,
  ended_by_admin_id  uuid NULL,           -- RC-9: no FK
  ended_reason       text NULL
);
CREATE INDEX business_os_entitlement_overrides_active_idx
  ON public.business_os_entitlement_overrides (user_id) WHERE ended_at IS NULL;

-- Shadow observations (RC-6): EVERY outcome incl. 'allowed', per rule, with for_each item totals.
CREATE TABLE public.business_os_entitlement_shadow_events (
  user_id               uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  capability            text NOT NULL,
  surface               text NOT NULL,      -- e.g. 'chat:mutate:invoices.create', 'chat:plan.for_each'
  outcome               text NOT NULL,      -- outcome for the account's ACTUAL entitlements
  rule                  text NOT NULL,      -- readRule the capability set was computed under ('domain_group' | 'read_only_plans_need_search' | 'n/a')
  day                   date NOT NULL,
  hits                  integer NOT NULL DEFAULT 0,
  items_total           bigint  NOT NULL DEFAULT 0,   -- sum of for_each item counts (S-2)
  items_max             integer NOT NULL DEFAULT 0,
  last_seen_at          timestamptz NOT NULL DEFAULT now(),
  sample_correlation_id text NULL,
  PRIMARY KEY (user_id, capability, surface, outcome, rule, day)
);

-- ── 2. RLS + revokes (RC-8): NO user policies on any table in Slice 1 ────────
ALTER TABLE public.business_os_account_plans             ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.business_os_entitlement_overrides     ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.business_os_entitlement_shadow_events ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.business_os_account_plans             FROM anon, authenticated;
REVOKE ALL ON TABLE public.business_os_entitlement_overrides     FROM anon, authenticated;
REVOKE ALL ON TABLE public.business_os_entitlement_shadow_events FROM anon, authenticated;

-- ── 3. Functions ─────────────────────────────────────────────────────────────
-- Shadow counter upsert: INVOKER + REVOKE (20260929_usage_summary.sql convention).
CREATE FUNCTION public.business_os_record_shadow_events(p_rows jsonb) RETURNS void
  LANGUAGE sql SECURITY INVOKER SET search_path = '' AS $$
  INSERT INTO public.business_os_entitlement_shadow_events AS e (…)
  SELECT … FROM jsonb_to_recordset(p_rows) AS r(…)
  ON CONFLICT (user_id, capability, surface, outcome, rule, day) DO UPDATE
     SET hits = e.hits + EXCLUDED.hits,
         items_total = e.items_total + EXCLUDED.items_total,
         items_max = GREATEST(e.items_max, EXCLUDED.items_max),
         last_seen_at = EXCLUDED.last_seen_at,
         sample_correlation_id = EXCLUDED.sample_correlation_id;
$$;
REVOKE EXECUTE ON FUNCTION public.business_os_record_shadow_events(jsonb) FROM public, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.business_os_record_shadow_events(jsonb) TO service_role;

-- Provisioning trigger (S-8 a–i). DEFINER because both parent tables accept user INSERTs
-- (WITH CHECK auth.uid() = user_id) while the plan table has no user write policy.
-- One function per fact (static SQL — no dynamic column names).
CREATE FUNCTION public.business_os_plan_fact_onboarding() RETURNS trigger
  LANGUAGE plpgsql SECURITY DEFINER
  SET search_path = ''                          -- (b) every name schema-qualified
  SET lock_timeout = '2s'                       -- (c) never stall an onboarding insert
AS $$
BEGIN
  BEGIN
    -- (a) reads ONLY NEW.user_id; constants + now(); never copies any other parent column.
    INSERT INTO public.business_os_account_plans AS p (user_id, cohort, origin, onboarding_started_at)
    VALUES (NEW.user_id, 'trial', 'onboarding_trigger', now())
    -- (e) fact-only idempotency: never touches cohort/tier/pins/trial fields, so an
    --     onboarding reset or business Reset cannot restart a trial. (h) no write after first.
    ON CONFLICT (user_id) DO UPDATE
       SET onboarding_started_at = COALESCE(p.onboarding_started_at, EXCLUDED.onboarding_started_at)
     WHERE p.onboarding_started_at IS NULL;
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'business_os_plan_fact_onboarding failed for %: %', NEW.user_id, SQLERRM;   -- (d)
  END;
  RETURN NEW;
END $$;
-- business_os_plan_fact_profile(): identical, with profile_created_at and origin 'profile_trigger'.
REVOKE EXECUTE ON FUNCTION public.business_os_plan_fact_onboarding() FROM public, anon, authenticated;  -- (f)
REVOKE EXECUTE ON FUNCTION public.business_os_plan_fact_profile()    FROM public, anon, authenticated;

-- ── 4. Triggers ──────────────────────────────────────────────────────────────
CREATE TRIGGER business_os_plan_on_onboarding AFTER INSERT ON public.onboarding_conversations
  FOR EACH ROW EXECUTE FUNCTION public.business_os_plan_fact_onboarding();
CREATE TRIGGER business_os_plan_on_profile AFTER INSERT ON public.business_profiles
  FOR EACH ROW EXECUTE FUNCTION public.business_os_plan_fact_profile();

-- ── 5. Backfill (RC-3, U-2, UD-4): every EXISTING Business OS user → open-ended champion ─
INSERT INTO public.business_os_account_plans
  (user_id, cohort, cohort_expires_at, origin, onboarding_started_at, profile_created_at)
SELECT u.user_id, 'champion', NULL, 'backfill_slice1', oc.first_at, bp.created_at
FROM (SELECT user_id FROM public.business_profiles
      UNION SELECT user_id FROM public.onboarding_conversations) u
LEFT JOIN (SELECT user_id, MIN(created_at) AS first_at
           FROM public.onboarding_conversations GROUP BY user_id) oc USING (user_id)
LEFT JOIN public.business_profiles bp USING (user_id)
ON CONFLICT (user_id) DO NOTHING;

COMMIT;
```

Notes:
- **No `plan_version` literal anywhere in SQL** (S-4). Tierless rows keep `0`, which resolves to the current version. `assign_tier` writes the real version. The CHECK makes "tier with version 0" impossible to store.
- **Trial dates are derived, not stored** (S-7). The trigger records facts only. Trial start = `trial_started_at` if pinned, otherwise the fact named by `COHORTS.trial.clockStartsAt`. Trial end = `trial_ends_at` if pinned, otherwise start + the `durationHistory` entry in force at the start (§4.8).
- **Why there are no owner SELECT policies (RC-8):** `reason`, `ended_reason` and the actor ids are admin-internal. Nothing reads these tables client-side, and a future plan UI would read through a server route.
- **The purge live-schema check** enumerates every `public` table with a `user_id`. The descriptor and `USER_OWNED_TABLES` edits therefore ship **in the same PR** as this migration (R-3).
- **`scripts/verify-bos-entitlements-migration.sql`** (QA runs it on a branch DB, all inside `BEGIN … ROLLBACK`). It checks:
  - RLS is on for all three tables, `pg_policies` has **zero** rows for them, and `anon`/`authenticated` have no table privileges.
  - `has_function_privilege('authenticated', …)` is false for all three functions, and each function's `proconfig` contains `search_path=` and `lock_timeout=2s`.
  - **Never-raise (S-8 i):** `ALTER TABLE public.business_os_account_plans ADD CONSTRAINT tmp_fail CHECK (false) NOT VALID`, then insert a `business_profiles` row and an `onboarding_conversations` row. Assert both parent rows exist, then `ROLLBACK`.
  - **Trial cannot restart:** create a trial row, delete the account's onboarding rows (what `/api/onboarding/chat/reset` does), insert a new message. Assert `onboarding_started_at`, `cohort` and the pins are unchanged.
  - Backfill count = distinct Business OS users, all `champion` with `cohort_expires_at IS NULL`.
  - Inserting a tier with `plan_version = 0` fails the CHECK.

### 4.4 Capability catalog

**Shape (types, sketch).** **File:** `lib/business-os/entitlements/types.ts`

```typescript
export type CapabilityShape =
  | { kind: 'boolean' }
  | { kind: 'variant'; variants: readonly string[] }        // ORDERED low → high (T-4); top = `{ all: true }` value
  | { kind: 'metered'; unit: 'ai_action' | 'sms'; period: 'month' }
  | { kind: 'quantity'; unit: 'seat' | 'location' }
  | { kind: 'fair_use'; unit: 'email'; period: 'month' }    // alert-only (B-7)
  | { kind: 'group' }                                        // boolean-valued; members via chatActionMap
  | { kind: 'addon' };                                       // value: 'unavailable' | 'purchasable' | 'included'

export type Audience = 'owner' | 'client' | 'client_render' | 'mixed';   // S-1: client_render = visible, not a send
export type MessageClass = 'transactional' | 'marketing';

export interface CapabilityDef {
  labels: { en: string; he: string; es: string };
  category: 'crm' | 'website_intake' | 'payments' | 'ai_chat' | 'marketing' | 'insights' | 'support' | 'platform' | 'addon';
  shape: CapabilityShape;
  lifecycle: 'available' | 'beta' | 'not_built';
  audience: Audience;
  messageClass: MessageClass | null;   // required iff audience === 'client' (a gated automated send); null for client_render
  atLimit: 'none' | 'degrade_to_template' | 'pause' | 'block' | 'alert_only' | 'by_call_site_audience';
  sellableAsAddon: boolean;
  placeholder?: 'B-1';
}
export const CAPABILITIES = { /* … */ } as const satisfies Record<string, CapabilityDef>;
export type CapabilityId = keyof typeof CAPABILITIES;
```

**Full capability list (from §5.3).** The lifecycle column is verified against the code in S1-T2, with the evidence recorded in a comment beside each entry. Tier values are **not** in production config (U-1). Under `{ all: true }`, the value is derived from the shape, except where the last column says an explicit cohort value is needed (RC-2).

| ID | Category | Shape | Lifecycle (verify) | Audience | Msg class | At limit | Add-on | `{ all: true }` value |
|---|---|---|---|---|---|---|---|---|
| `crm.core` | crm | boolean | available | owner | — | none | no | on |
| `crm.documents` | crm | boolean | available | owner | — | none | no | on |
| `booking.calendar_sync` | crm | boolean | available | owner | — | none | no | on |
| `website.ai_site` | website_intake | boolean | available | owner | — | none | no | on |
| `website.branding` | website_intake | variant `['branded','unbranded']` | available | **client_render** | — | none | no | `unbranded` |
| `intake.forms` | website_intake | variant `['manual','ai']` | available | owner | — | none | no | `ai` |
| `intake.reminders` | website_intake | boolean | available | client | transactional | none | no | on |
| `payments.invoices` | payments | boolean | available | owner | — | none | no | on (B-1) |
| `payments.card` | payments | boolean | available | owner | — | none | no | on (B-1) |
| `payments.reminders` | payments | boolean | available | client | transactional | none | no | on |
| `payments.multi_currency` | payments | boolean | available (verify) | owner | — | none | no | on |
| `chat.marketing` | ai_chat | group | available (verify) | owner | — | none | no | on (B-1) |
| `chat.invoice_control` | ai_chat | group | available | owner | — | none | no | on |
| `chat.email` | ai_chat | group | available | owner | — | none | no | on |
| `chat.search` | ai_chat | group | available | owner | — | none | no | on |
| `chat.scheduling` | ai_chat | group | available | owner | — | none | no | on |
| `chat.quotes` | ai_chat | group | available | owner | — | none | no | on |
| `chat.reporting` | ai_chat | group | available | owner | — | none | no | on |
| `chat.bulk` | ai_chat | group | available | owner | — | none | no | on |
| `ai.actions` | ai_chat | metered ai_action/month | available | mixed | — | by_call_site_audience | no | **explicit** (champion per month; trial one-off total) |
| `marketing.mass_email` | marketing | boolean | not_built (verify) | client | marketing | none | no | off while not_built (B-1) |
| `marketing.lead_response` | marketing | boolean | available | client | marketing | degrade_to_template | no | on |
| `marketing.posts` | marketing | boolean | not_built (verify) | owner | — | none | no | off while not_built |
| `insights.checks` | insights | boolean | available | owner | — | none | no | on |
| `insights.channels` | insights | boolean | available | owner | — | none | no | on |
| `insights.daily_briefing` | insights | boolean | available | owner | — | pause | no | on |
| `support.level` | support | variant `['standard','priority']` | available | owner | — | none | no | `priority` |
| `email.volume` | platform | fair_use email/month | available | client | transactional | alert_only | no | **explicit** ceiling |
| `addon.marketing_analytics` | addon | addon | not_built (verify) | owner | — | none | yes | off while not_built (B-1) |
| `addon.mobile` | addon | addon | not_built | owner | — | none | yes | off while not_built (B-1) |
| `addon.full_payment_cycle` | addon | addon | not_built (verify) | owner | — | none | yes | off while not_built (B-1) |
| `addon.sms` | addon | addon | not_built | client | transactional | none | yes | off while not_built |
| `sms.messages` | addon | metered sms/month | not_built | client | transactional | block | yes | **explicit** (0 while not_built) |
| `team.seats` | addon | quantity seat | available | owner | — | none | yes | **explicit** |
| `business.locations` | addon | quantity location | available | owner | — | none | yes | **explicit** |
| `website.custom_domain` | addon | addon | available (verify) | client_render | — | none | yes | `included` |
| `addon.act_for_you` | addon | addon | not_built (verify) | owner | — | none | yes | off while not_built |

Rows with `client` audience are the ones whose capability *is* an automated client send, or is metered on such sends. `email.volume` is classed transactional as its default. Per-send classification lives in the Slice 2 send registry. **Send registry (S-1, Slice 2):** every automated client send, gated or not, is declared once by **send id**, with `messageClass` and `initiator: 'client' | 'system'`. The overlay surface kind for a send is **derived from that entry**, so a call site never picks it. FR-8 then reads: every automated client send declares a class and an initiator.

### 4.5 Chat action → capability map (FR-6, S-2)

**File:** `config/chatActionMap.ts` (engineering-owned).
- **Key space:** `` `${entity}.${op}` `` for every `SEMANTIC_CATALOG` entity × (`find`, `compute`, every `ActionDef` key), plus `plan.for_each` and `plan.analyse`. The invariant test cross-checks this against the 107 plugin actions.
- **Values:** a `CapabilityId`, or `{ ungated: reason }`. `agents.*` and `agent_runs.*` map to `{ ungated: 'agent platform, B-8' }` (S-2 confirmed).
- **`readRule` (RC-5, Q-B1) is a config value.** Default `'domain_group'` (R-A): a read step needs its entity's domain capability, `chat.search` covers reads of entities without a domain group, and `compute`/`analyse` need `chat.reporting`. The alternative is `'read_only_plans_need_search'` (R-B).
- **`capabilitiesForPlan(plan, rule)`** is pure. Mutate steps contribute their action's capability. `for_each` adds `chat.bulk` and reports its item count.
- The shadow recorder evaluates **both** rules and records them with the `rule` column. A test flips the config value and asserts the required capability set changes.
- The provisional mapping table by entity is unchanged from rev 1:

| Entity | Mutate actions → capability | Reads (`domain_group`) |
|---|---|---|
| contacts | create/update/delete → `crm.core`; `statement` → `chat.invoice_control`; `send` → `chat.email` | `crm.core` |
| invoices, installments, plans, plan_subscriptions (`cancel`), refunds, transactions (`create/update/refund`) | → `chat.invoice_control` | `chat.invoice_control` |
| proposals | → `chat.quotes` | `chat.quotes` |
| bookings, services, business_profile (`set/clear_availability`, `open_time`) | → `chat.scheduling` | `chat.scheduling` |
| business_profile `export_ledger` | → `chat.reporting` | — |
| tasks, activities, pipeline_stages | → `crm.core` | `crm.core` |
| pages, sections, page_views, links, link_clicks | → `website.ai_site` | `website.ai_site` |
| insights | — | `insights.checks` |
| channel_metrics, channel_connections (`disconnect/sync`) | → `insights.channels` | `insights.channels` |
| emails | — | `chat.email` |
| agents, agent_runs | — | `{ ungated: 'agent platform, B-8' }` |

### 4.6 Config: tiers, cohorts, lifecycle, launch

**Production tier matrix (U-1, RC-1).** **File:** `config/tierMatrix.ts`

```typescript
export const TIER_ORDER = [] as const;                       // no commercial tiers yet — the user adds them as config
export const TIER_MATRIX = { version: 1, tiers: {}, removals: [] } as const satisfies TierMatrix;
```

The types stay zero-tier safe. `TierId` is `(typeof TIER_ORDER)[number]`, which is `never` today. `tiers` is `Record<TierId, …>`, which is `{}` today. The mapped type `{ [C in CapabilityId]: ValueFor<C> }` still forces **every** capability into a tier as soon as one is added.

**Adding a tier later** means three things: append its name to `TIER_ORDER`, add its full row to `tiers` (a missing key is a type error, a Zod load error, and an invariant failure), and refresh the snapshot. This is documented in `BUSINESS_OS_ENTITLEMENTS.md`.

**Test fixture (U-1).** **File:** `__tests__/fixtures/exampleTierMatrix.ts` holds Eyal's example `basic`/`growth`/`pro` matrix, with rev 1's example values and a 2-entry `removals` example. It is served through `fixtureSource.ts` (an injectable `TierMatrixSource`) and validated by the **same** schema builder. All tier-semantics tests run on it (§4.13).

**Cohorts (RC-2, S-7, UD-1).** **File:** `config/cohorts.ts`

```typescript
export const COHORTS = {
  trial: {
    base: { all: true },                                  // UD-1 — one-line switch to { tier: '<name>' } once a tier exists
    clockStartsAt: 'first_onboarding_message',            // RC-5 / Q-B3 — or 'profile_created'
    durationHistory: [{ effectiveFrom: '2026-09-19T00:00:00Z', days: 14 }],   // S-7 append-only
    graceHistory:    [{ effectiveFrom: '2026-09-19T00:00:00Z', days: 7 }],
    values: {                                             // RC-2: explicit for quantity/metered/fair_use (Zod-required)
      'ai.actions': { total: 150 },                       // one-off trial total; sized from S1-T15 data (B-12)
      'sms.messages': { perMonth: 0 }, 'email.volume': { ceilingPerMonth: 2000 },
      'team.seats': { included: 1 }, 'business.locations': { included: 1 },
    },
    includeLifecycle: ['beta'],                           // follows UD-1 "all capabilities"; see note
  },
  champion: {
    base: { all: true },                                  // U-2
    graceHistory: [{ effectiveFrom: '2026-09-19T00:00:00Z', days: 30 }],
    values: {
      'ai.actions': { perMonth: 3000 }, 'sms.messages': { perMonth: 0 }, 'email.volume': { ceilingPerMonth: 10000 },
      'team.seats': { included: 1 }, 'business.locations': { included: 1 },
    },
    includeLifecycle: ['beta'],
  },
} as const satisfies CohortConfig;
```

(All numbers are placeholders.) There is no `defaultDurationDays` for champions (RC-4). A champion has an admin-set end date or none. **Note for SA:** I read UD-1 ("all capabilities") as including beta for the trial, the same as champions. Setting `includeLifecycle: []` would keep beta for champions only, and it is a one-value change.

**Lifecycle.** **File:** `config/lifecycle.ts`
- `subscription.graceHistory` (placeholder 7 days, for tier accounts after `access_ends_at`).
- The **state overlay table** (below).
- **Send policy (RC-5, Q-B4):** defaults by `(messageClass, initiator)` plus `sendPolicyOverrides: Record<SendId, Partial<Record<State, 'allow' | 'suppress'>>>`, empty in Slice 1. The intake request is a **system-initiated transactional** send, so the default already **suppresses it in `paused`**. Changing Q-B4 is one override entry keyed by its send id once the Slice 2 registry exists. A test proves an override flips the outcome for a fixture send id.

| Surface kind | trial / champion / active | past_due (S4) | grace | paused |
|---|---|---|---|---|
| `owner_read` (view/export) | allow | allow | allow | allow |
| `owner_write` (incl. chat mutate) | allow | allow | read_only | read_only |
| `owner_ai` | allow | allow | read_only | read_only |
| `public_business` (website, new booking, contact, proposals) | allow | allow | allow + warning | paused_public (B-11) |
| `public_self_service` (invoice pay, booking cancel/reschedule) | allow | allow | allow + warning | allow (B-11) |
| send: transactional + client-initiated (receipts, cancel/reschedule confirmations) | allow | allow | allow | allow (B-11) |
| send: transactional + system-initiated (reminders, intake requests, existing-booking confirmations) | allow | allow | allow (B-9) | suppress (B-11, Q-B4) |
| send: marketing | allow | allow | suppress (B-9) | suppress |

**Launch (UD-2).** **File:** `config/launch.ts`: `LAUNCH = { enforceRequiresConfiguredTier: true }`.

### 4.7 Loader seam and Zod validation (T-1, FR-7, FR-34, WC-5, RC-1)

```typescript
export interface TierMatrixSource { load(): EntitlementConfig }   // catalog, matrix, cohorts, lifecycle, chatActionMap, launch
export class CodeTierMatrixSource implements TierMatrixSource { … } // lazy: validates on FIRST load() call, memoises
export function getEntitlementConfig(source?: TierMatrixSource): EntitlementConfig;   // injectable for tests (fixture)
```

- **Zero-tier safe (RC-1):** tier enums are built as `TIER_ORDER.length ? z.enum(TIER_ORDER as [string, ...string[]]) : z.never()`. `tiers` must have exactly the keys in `TIER_ORDER`, which is `{}` when there are none.
- **The schema rejects:**
  - a tier missing a capability, or unknown capability IDs;
  - wrong shapes, variants outside the list, or negative quantities;
  - a cohort `base.tier` not in `TIER_ORDER`;
  - a cohort missing an explicit value for **any** quantity/metered/fair-use capability (RC-2), so a new catalog entry fails CI until champions get a value;
  - `removals` referencing an unknown tier or capability, a version above `matrix.version`, or `grandfatherUntil: 'renewal'` (WC-19, until Slice 4);
  - a `durationHistory`/`graceHistory` that is empty, unsorted, or has duplicate `effectiveFrom`;
  - a client-audience capability without `messageClass`, or a `client_render` capability with one;
  - `chatActionMap` values that are not capabilities or reasoned `ungated`;
  - an unknown `readRule` or `clockStartsAt`.
- **When validation runs (RC-7):** at first `load()`, which only happens inside the shadow try, the service, or admin routes, **never at chat-v4 module import**. CI catches bad config through the invariant tests (G-2 makes that binding before `enforce`).

### 4.8 Resolver semantics (FR-9, FR-10, FR-13, T-4, T-11, RC-2, RC-4, RC-11, S-7)

`resolveEntitlements({ config, account, overrides, addons, now }) → EntitlementSnapshot` is pure. `addons` is always `[]` in Slice 1 and fixture-tested (S-3).

**Basis (RC-11: the tier wins).** If `account.tier` is set, the basis is that tier's matrix row, and **cohort layers and cohort lifecycle fields are ignored while the tier is present**. Otherwise the basis is the cohort's `base`: `{ tier }` gives that tier's row, and `{ all: true }` gives the **catalog-derived maximum**:
- boolean/group on, variant = top of its list, addon = `included`;
- quantity/metered/fair-use from the cohort's explicit `values`.

A row with neither tier nor cohort, or with an unknown tier/cohort, is an **anomaly**.

**Layer order and per-shape merge (T-4):**

| Layer | boolean / group / variant / addon | quantity | metered / fair_use |
|---|---|---|---|
| 1 Basis (tier row, or cohort base) | base | base | base |
| 1a Grandfathered (removals, tier accounts only) | restore `previousValue` if higher | restore if higher | restore if higher |
| 2 Add-ons (Slice 4 data) | `addon` → `included` | add | add |
| 3 Cohort adjustments (tierless accounts only; `{ all: true }` already applied as the base) | replace unless `additive` | replace / additive | replace / additive |
| 4 Overrides (`op`) | `set` replaces, `revoke` → off/lowest | `set` / `add` / `revoke` → 0 | `set` / `add` / `revoke` → 0 |
| 5 State overlay | caps only, applied per surface kind in `decide` | — | — |

**Rules (each one tested):**
- **`not_built` is always off**, including under `{ all: true }` and overrides (FR-13).
- **`beta`** is off in the base unless the cohort's `includeLifecycle` contains `'beta'`, or a layer-4 override grants it. `{ all: true }` does not bypass this: champions get beta because their `includeLifecycle` says so.
- **Grandfather (1a)** applies only to tier accounts, when `removal.version > effectivePlanVersion`, `removal.tier === account.tier`, and `now < grandfatherUntil`. `plan_version = 0` resolves to the current version (only possible while tierless, per S-4).
- **Overrides:** expired or ended ones are ignored and shown in the trace, never deleted. Several on one capability apply in `created_at` order.
- **Explain (FR-10):** per capability `{ value, decidedBy, trace[] }`.
- **`lowestTierFor(capability, request)`** returns `TierId | null`. It is `null` when there are no tiers or no tier satisfies the request (RC-1).
- **Anomalies:** a missing row, unknown tier/cohort, or neither set gives `snapshot.anomaly` and state `unknown`. Owner-paid capabilities are denied, and `decide` applies T-3 by audience. A champion with `cohort_expires_at IS NULL` is **not** an anomaly (RC-4).

**Lifecycle derivation (`deriveLifecycle`, pure, `now` injected; RC-11 precedence):**

```
if tier:                                                    // tier wins; cohort ignored
    if access_ends_at == null || now < access_ends_at  → active          (past_due: Slice 4)
    accessEnd = access_ends_at ; graceDays = subscription.graceHistory@accessEnd
elif cohort == 'champion':
    if cohort_expires_at == null                       → champion (open-ended, UD-4)
    if now < cohort_expires_at                         → champion
    accessEnd = cohort_expires_at ; graceDays = champion.graceHistory@accessEnd
elif cohort == 'trial':
    start = trial_started_at ?? fact(clockStartsAt)                              // S-7 / Q-B3
    if start == null → anomaly 'trial_without_start'                             // cannot happen via triggers; ensure_plan_row fixes
    end   = trial_ends_at ?? start + trial.durationHistory@start.days            // history: shortening never shortens running trials
    if now < end (&& !trialAllowanceExhausted — Slice 3) → trial
    accessEnd = end ; graceDays = trial.graceHistory@end
graceEnd = grace_ends_at ?? accessEnd + graceDays
now < graceEnd → grace ; else → paused
```

`history@t` means the entry with the greatest `effectiveFrom ≤ t`. If `clockStartsAt` names a fact that isn't set yet (for example `'profile_created'` before profile creation), the trial is `trial` with `end = null`, meaning setup is still in progress. That is tested. An RC-11 matrix test covers {tier, no tier} × {no cohort, trial, champion open-ended, champion dated} × {before end, in grace, after grace}.

### 4.9 Account seam, service, caching, failure policy (T-2, T-3, T-5, S-6, RC-12, RC-13)

- **`resolveAccountId(userId)`:** returns the user id. It is the only mapping.
- **Repository `BusinessOsAccountPlanRepository`:**
  - `findEntitlementInputs(accountId)` is one embedded select (plan + overrides), `.eq('user_id', accountId).maybeSingle()`.
  - `findEntitlementInputsBatch(accountIds)` **throws on more than 100 ids** (RC-12). `EntitlementService` chunks by 100.
  - `pagePlans({ afterUserId?, limit })` does `.order('user_id').range(...)`, which the report uses (RC-12).
  - Admin write methods scope by `.eq('user_id', accountId)` and build payloads from explicit allow-lists.
  - `supabaseServer` is used, with a comment giving the reason: admin/cron/report cross-account context, where the account id always comes from server context.
- **Cache (S-6, RC-13, approved pattern 3):**
  - It holds the **inputs** (plan row + overrides) per account for **30 s**, in an **LRU capped at 5,000** entries. Every call resolves with the current `now`, and the resolved snapshot is memoised per request/turn.
  - **Report and batch paths read through without populating** the cache.
  - `invalidate(accountId)` runs after every admin write, on the local instance only.
  - Cross-instance staleness is ≤ 30 s. This is documented in the module header, and responses carry `effectiveWithinSeconds: 30`.
  - Counters are never cached.
- **Failure policy (T-3, WC-10, S-6):**
  - If the repository errors, return `unavailable: true` and log `error` with account, surface and correlationId.
  - Stale inputs (retained for up to 10 minutes after TTL) are used **only for fail-open audiences**: client render/transactional allow on stale-or-open, marketing crons defer, metered pre-check allows.
  - **Owner-paid capabilities never get stale data.** They return `entitlement_unavailable`, which is never `not_entitled`.

### 4.10 Mode flag, shadow mode and report (FR-22, AC-7, WC-21, RC-6, RC-7, RC-16)

- **`mode.ts`** reads `BOS_ENTITLEMENTS_MODE` on every call: `off` (default) or `shadow`. `enforce` exists from Slice 2 and is refused while `LAUNCH.enforceRequiresConfiguredTier` holds and `TIER_ORDER` is empty (UD-2): it logs `error` and behaves as `shadow`. In Slice 1, `enforce` always behaves as `shadow`. **It imports nothing from config** (RC-7).
- **`shadow.ts` (RC-7).** Top-level imports are `mode.ts` and the logger only.
  - `shadowChatPlan({ userId, plan, correlationId })` returns synchronously when mode is `off`: no config load, no read, no write.
  - Otherwise: `void (async () => { try { const { getEntitlementService, capabilitiesForPlan, … } = await import('./index'); … } catch (err) { logger.error(…) } })()`. Config load, Zod, resolution and recording **all happen inside the try**.
  - Tests: a throwing loader leaves chat-v4 unaffected in `off` (loader never called) and in `shadow` (swallowed and logged).
- **What is recorded (RC-6):** for the account's **actual** snapshot, **every** `(capability, surface, outcome, rule)`, **including `allowed`**, plus `for_each` item counts. It is deduplicated and summed per request, sent as one RPC call, with Pino `debug` for `allowed` and `info` for anything else.
- **Chat-v4 hook:** one un-awaited call after planning. Confirm-turn and saved-plan runs are not hooked in Slice 1.
- **Report `GET /api/admin/business-os/entitlements/shadow-report`:**
  1. **Static:** pages all plan rows (RC-12). Counts by lifecycle state and cohort. **Open-ended champions** (count + ids, UD-4/RC-4). Anomalies. **Business OS tenants with no plan row** (count + sample ids).
  2. **Observed usage:** `shadow_events` by capability × surface × outcome × rule for a date window, with distinct accounts, hits and item stats.
  3. **`asTier=<name>` (RC-6):** re-evaluates recorded usage **retroactively** as if each account were on that configured tier, giving would-be denials by capability and surface. `asTier` is Zod-validated against `TIER_ORDER`. It returns 400 `no_tiers_configured` today, and is proven on the fixture in tests (AC-7).
  4. **Setup AI cost (S1-T15, B-12):** median, p90 and max distinct Layer-1 action groups for the onboarding, website and intake areas in each account's first 14 days, read through a repository.
- **Data exposure (RC-16):** account ids and aggregates only. No business names, no override `reason`/`ended_reason`, no actor ids. A test asserts this. Reasons appear only in the per-account inspect response.

### 4.11 Plan-row provisioning and backfill (WC-21, RC-3, RC-14, S-7, S-8)

- **Triggers:** `AFTER INSERT` on `onboarding_conversations` and on `business_profiles`. Each records **only its fact** through the fact-only COALESCE upsert. A new signup gets a `trial` row on first contact, and **nothing a user can do (onboarding reset, business Reset) can restart a trial**, because cohort, tier, pins and facts are never overwritten.
- **Conditions S-8 (a) to (i):** implemented as written in §4.3 (a–h) and proven by the verification script (i).
- **The trial clock (Q-B3)** is `COHORTS.trial.clockStartsAt`, derived at resolution time from the recorded facts. Setup AI falls inside the trial under the default (B-12).
- **Backfill (RC-3, U-2, UD-4):** every existing Business OS user becomes an **open-ended champion** (`cohort_expires_at = NULL`, `origin = 'backfill_slice1'`), with facts from `MIN(onboarding_conversations.created_at)` and `business_profiles.created_at`.
- **Slice-1-era signups** stay trials in shadow. At switch-on, `launch_champion_existing` (§5) makes every account with no tier that isn't already a champion into an open-ended champion, evaluated at that moment (UD-3).
- **This approval covers this module's provisioning only.** It is not a general provisioning-trigger pattern (S-8).

### 4.12 Admin operations (T-7, FR-31/32, AC-6, WC-7, RC-4, RC-10, S-10)

**`GET /api/admin/business-os/entitlements/accounts/[accountId]`:** inspect. Returns the snapshot + full trace (FR-10), the derived lifecycle with dates and which pin/fact/history entry produced each, all overrides **including reasons** (admin-only view), and `effectiveWithinSeconds`.

**`POST /api/admin/business-os/entitlements/accounts/[accountId]`:** a Zod discriminated union on `op`. Every variant is `.strict()` and needs a `reason`:

| `op` | Body | Effect (explicit allow-list) |
|---|---|---|
| `ensure_plan_row` | `{ reason }` | **Idempotent (RC-10).** If there is no row, insert `cohort='trial'`, `origin='admin'`, with facts from `OnboardingConversationRepository.getFirstMessageAt` and `BusinessProfileRepository.findByUserId().created_at`. If a row exists, no-op, return 200 `{ created: false }`. |
| `set_cohort` | `{ cohort: 'trial' \| 'champion' \| null, expiresAt?: ISO \| null, reason }` | **champion:** `expiresAt` is a **required key** (a future ISO date, or explicit `null` = open-ended). Omitting it returns 400 (RC-4). Writes `cohort`, `cohort_expires_at`, `period_anchor = now`. **trial:** pins `trial_started_at = now`, optional `trial_ends_at`. **null:** clears cohort. |
| `set_expiry` | `{ field: 'trial_ends_at' \| 'cohort_expires_at' \| 'access_ends_at' \| 'grace_ends_at', value: ISO \| null, reason }` | That one column |
| `assign_tier` | `{ tier: string \| null, accessEndsAt?: ISO, reason }` | **400 `no_tiers_configured` while `TIER_ORDER` is empty** (RC-1). Otherwise `tier` (validated against config), `plan_version = TIER_MATRIX.version`, `period_anchor = now`, `access_ends_at`. `null` clears the tier. |
| `add_override` | `{ capability, op: 'set' \| 'add' \| 'revoke', value?, expiresAt?, reason }` | Insert. `value` is validated with that capability's shape schema. Also used for comped add-ons before billing (S-3), email abuse blocking (B-7), and a per-account grandfather extension. |
| `end_override` | `{ overrideId: uuid, reason }` | Sets `ended_at`, `ended_by_admin_id`, `ended_reason`. The override must belong to `accountId`. |

**Order of checks (copies llm-usage):**
1. 401 if signed out.
2. 403 if `AdminAccessService.isAdmin` is false or throws (fail closed). `profiles.role` is never read, and a test shows `profiles.role = 'admin'` still gets 403.
3. 400 for a bad UUID or body.
4. **Tenant pre-check (RC-10):** the target is a Business OS tenant if `BusinessProfileRepository.findByUserId` returns a row **or** `OnboardingConversationRepository.getLatestMessageAt` is non-null. Otherwise 404 `not_a_business_os_account`. For ops other than `ensure_plan_row`, a missing plan row returns 409 `plan_row_missing` with a hint to run `ensure_plan_row`. For `end_override`, the override must be owned by the account.
5. Write through the repository.
6. `invalidate(accountId)`.
7. Audit: `auditTrail.log({ action: AUDIT_EVENTS.BOS_ENTITLEMENT_<OP>, userId: adminId, entityType: 'business_os_account', entityId: accountId, changes: { before, after }, severity: 'warning', details: { reason }, request }).catch(...)`, then `await auditTrail.flush().catch(...)` before responding. Rows also store the actor, reason and timestamps (WC-7, with no FK per RC-9).

**Self-service impossible (WC-8, FR-32, RC-8, RC-15):**
1. There are no user policies and `REVOKE ALL` from `anon`/`authenticated`.
2. The write-method and class symbols are referenced only by the admin routes and the repository test. The symbol-level import test covers the barrel.
3. A route test sends `{ tier, cohort, plan_version, cohort_expires_at }` to `PUT /api/business-os/business-profile` and to `app/api/business-os/profile`, and asserts no entitlement repository call happens.

### 4.13 Tests (WC-22, FR-8, AC-1 to AC-7, RC-1, RC-7, RC-11, RC-15, RC-16, S-7, S-8)

| Test file | Asserts |
|---|---|
| `catalog.invariant.test.ts` | AC-1 all capabilities + attributes. `client` ⇒ `messageClass`, `client_render` ⇒ none. Variant lists are non-empty and unique. |
| `productionConfig.test.ts` | **Production config loads** with zero tiers (RC-1). `TIER_ORDER` is empty. The trial and champion `{ all: true }` bases resolve. Every quantity/metered/fair-use capability has an explicit cohort value. |
| `tierMatrix.invariant.test.ts` *(fixture)* | AC-2: deleting any single tier × capability value is rejected by the loader. Unknown IDs and wrong shapes are rejected. Adding a catalog quantity/metered capability without cohort values is rejected. |
| `chatActionMap.invariant.test.ts` | AC-3 key space vs `SEMANTIC_CATALOG` + 107 plugin actions. No stale keys. An injected unmapped action fails. **`readRule` flip** changes the required capabilities (RC-5). |
| `tierMatrix.snapshot.test.ts` + snapshot | T-11/WC-19 lowered value without removal + version bump fails. `'renewal'` is rejected. **S-7:** a changed trial/champion/subscription duration or grace without a new history entry fails, and an edited or removed existing history entry fails. Runs on production config **and** the fixture. |
| `tierLiteral.forbidden.test.ts` + baseline | FR-12: deny list = `{'basic','growth','pro'} ∪ TIER_ORDER` outside `entitlements/config/` and `__tests__/fixtures/`. The 13 existing hits are baselined. |
| `oneLineChange.test.ts` *(fixture)* | AC-4: fixture growth `chat.search` false→true is a one-leaf diff, and a Growth fixture account then resolves it as entitled. |
| `resolver.test.ts` *(fixture + prod config, injected clock)* | AC-5: every layer overriding the previous one. `{ all: true }` derivation per shape. `not_built` never (including under `all` and overrides). `beta` only via `includeLifecycle`/override. Expiring override. `set`/`add`/`revoke` per shape. Grandfather before/after sunset, tier accounts only. `plan_version 0`. `lowestTierFor` null with no tiers, correct on the fixture. Anomalies. Trace. Purity. |
| `lifecycle.test.ts` *(injected clock)* | **RC-11 matrix**: {tier, none} × {no cohort, trial, champion open-ended, champion dated} × {before, grace, after}. Tier wins. `clockStartsAt` flip (RC-5). Pending-fact trial. **Shortening `durationHistory` does not shorten a running trial** (S-7). Pins beat facts. `grace_ends_at` override. |
| `decide.test.ts` | Overlay cells (B-9/B-11). Send-policy defaults by (class, initiator). **An override for a fixture send id flips paused suppress→allow** (RC-5, Q-B4). T-3 per audience. Stale inputs never used for owner-paid (S-6). `entitlement_unavailable` ≠ `not_entitled`. |
| `mode.test.ts` | `off` by default. `enforce` refused (acts as `shadow`, logs `error`) while no tier exists (UD-2), and always in Slice 1. `mode.ts` does not import config (static import check, RC-7). |
| `EntitlementService.test.ts` | Memo. 30 s TTL (fake timers). LRU cap evicts. Report/batch read-through does not populate. `invalidate`. Batch chunking at 100. **Mode `off` means the repository is never called.** |
| `shadow.test.ts` | **A throwing config loader, repository, resolver or RPC never escapes** (RC-7, WC-21). `off` means the loader is never called. Records `allowed` + both rules + item counts (RC-6). One RPC per request. |
| `imports.test.ts` | §3 dependency rules. **Symbol-level** references to repository write methods/class/singleton, including via the barrel, only from the admin routes and the repository test (RC-15). chat-v4 imports only `entitlements/shadow`. |
| `report.test.ts` + route test | Static counts incl. open-ended champions and missing plan rows. Observed aggregates. `asTier` on the fixture yields would-be denials by capability × surface (AC-7). `asTier` returns 400 with production config. **No names, reasons or actor ids in the output** (RC-16). Paging. |
| Repository tests (`BusinessOsAccountPlan`, `…Shadow`, `OnboardingConversation.getFirstMessageAt`) | One test per method. Wrong user returns null. Allow-lists drop extra fields. `>100` ids throws. Error path returns `{ data: null, error }`. |
| `accounts/[accountId]/__tests__/route.test.ts` | AC-6: 401; 403 non-admin; **403 when `profiles.role='admin'` but not in `admin_users`**; 403 when the check throws; 400 bad body/UUID/shape; **400 champion without `expiresAt` key**; accepts explicit `null`; **400 `no_tiers_configured`**; 404 non-tenant; 409 `plan_row_missing`; `ensure_plan_row` idempotent; foreign override 404. Happy path per op: allow-listed write → `invalidate` → `log` with before/after/reason → **awaited `flush`**. |
| `business-profile` / `profile` `entitlementFields.test.ts` | WC-8. |
| Existing purge `descriptors.invariant` + `businessOwnedTables` tests | Pass with the three new tables. |
| `scripts/verify-bos-entitlements-migration.sql` | §4.3 list: no policies, revokes, function config, **tmp_fail never-raise**, **trial cannot restart**, backfill = open-ended champions, CHECK. |

### 4.14 CI typecheck gate and test job (WC-2, S-9, G-2)

- **Typecheck:** add `'lib/business-os/entitlements/'` to `SCOPED_DIRS` in `scripts/typecheck-bos-llm.ts`, and update **header comments only**. The npm script `typecheck:bos-llm`, the workflow `name`, the job id and the job display name are **unchanged** (they are cited by the `bos-llm-call-standards` skill and CLAUDE.md). The direct-callers step brings in the admin routes and chat-v4.
- **Tests:** a new `.github/workflows/bos-entitlements.yml` runs on PRs to main, with no path filter. It runs `npx jest lib/business-os/entitlements lib/repositories/__tests__/BusinessOs lib/repositories/__tests__/OnboardingConversationRepository app/api/admin/business-os/entitlements app/api/business-os/business-profile app/api/business-os/profile lib/business-os/purge/__tests__/descriptors.invariant.test.ts lib/business-os/__tests__/businessOwnedTables.test.ts --ci`. `tests/plugins/jest-setup.ts` already stubs the Supabase env.
- **G-2:** both jobs become **required status checks** on `main` before `enforce`. This is a user or repository-admin action, listed in §8.

### 4.15 Slice 1 task list

- [ ] **S1-T0** SA delta re-check of this revision. SA approves the final migration SQL before it is written.
- [ ] **S1-T1** `types.ts` (zero-tier safe) + `schema.ts` (catalog-derived builders, histories, zero-tier enums).
- [ ] **S1-T2** `config/catalog.ts`: full §4.4 list with the `client_render` audience. Verify each `lifecycle` against the code and record the evidence. B-1 placeholders.
- [ ] **S1-T3** `config/tierMatrix.ts` (**empty**), `config/cohorts.ts` (`{ all: true }`, histories, explicit values, `clockStartsAt`), `config/lifecycle.ts` (overlay, send-policy defaults + empty overrides, subscription grace history), `config/launch.ts`. Fixture `exampleTierMatrix.ts` + `fixtureSource.ts`.
- [ ] **S1-T4** `config/chatActionMap.ts` + `readRule` + `capabilitiesForPlan` (item counts).
- [ ] **S1-T5** `source.ts`: lazy `CodeTierMatrixSource`, injectable source.
- [ ] **S1-T6** `lifecycle.ts`, `resolver.ts`, `decide.ts` (pure; RC-11 precedence; `{ all: true }`; S-7 histories).
- [ ] **S1-T7** Migration (§4.3) + verification script. Applied to a branch/local DB only. Prod apply is RM/user-gated.
- [ ] **S1-T8** Purge descriptors (three `never` rows with notes), `classification-baseline.json`, `USER_OWNED_TABLES` entries with reasons. Same PR as S1-T7.
- [ ] **S1-T9** Repositories + `OnboardingConversationRepository.getFirstMessageAt` + unit tests (skill). `supabaseServer` rationale comments.
- [ ] **S1-T10** `account.ts`, `mode.ts` (no config imports; UD-2 refusal), `EntitlementService.ts` (input cache, LRU, read-through, failure policy, 100-id chunking).
- [ ] **S1-T11** `shadow.ts` (lazy imports inside the try), `report.ts` (static/observed/`asTier`/setup cost; no names or reasons), the one-line chat-v4 hook.
- [ ] **S1-T12** Admin routes: `accounts/[accountId]` (GET + POST union incl. `ensure_plan_row`), `shadow-report`. `AdminAccessService` gate (**not** the skill's `app_metadata.role` line). Audit events. Route tests.
- [ ] **S1-T13** All §4.13 tests.
- [ ] **S1-T14** CI: `SCOPED_DIRS` + header comments, `bos-entitlements.yml`.
- [ ] **S1-T15** Setup-AI-cost section of the report (B-12 sizing input). SA recommends keeping it.
- [ ] **S1-T16** `docs/architecture/BUSINESS_OS_ENTITLEMENTS.md` (adding a tier, removal + ledger, history entries, staleness, flag, launch preconditions G-1/G-2/UD-2, ops checks). CLAUDE.md Key Documentation row needs TL/user approval.
- [ ] **S1-T17** Hand to SA for code review, then QA.

### 4.16 Slice 1 exit criteria

1. AC-1, AC-3, AC-5 and AC-6 pass on production config. AC-2, AC-4 and AC-7 pass on the fixture (RC-1, RC-6). The production-config load test passes.
2. With the flag `off`: a test proves there are no entitlement reads or writes, and chat-v4 never loads config (WC-21, RC-7).
3. A test proves the shadow path cannot throw, including with a throwing config loader.
4. The verification script proves the triggers never raise (tmp_fail), a trial cannot restart, there are no user policies and the revokes are in effect.
5. After the migration on prod: missing-plan-row count = 0, every pre-existing tenant is an open-ended champion, and the report lists them.
6. With `shadow` on for about a week: the observed-usage report is populated (including `allowed`), and the setup-AI-cost section returns data for sizing the trial allowance.
7. The CI typecheck and entitlement test job are green on the PR.

---

## 5. Slice 2: Enforcement (outline; G-3: the addendum restates each WC as tasks + tests)

| Area | Plan |
|---|---|
| **Prerequisites** | (1) **T-8 (WC-17)**, as the first PR: `chat` and `chat-command` return 410; the `chat-v2` toggle is removed and the route returns 410 (or becomes admin-only server-side). It is never mapped through the catalog. (2) **S-12** skill fix landed (user-approved separate change, §12.3) before the addendum. (3) Addendum SA-reviewed (G-3). |
| Mode | `enforce` becomes selectable. `mode.ts` refuses it while `TIER_ORDER` is empty (UD-2). Every surface is wired in `shadow` first. |
| Route wrapper | `withEntitlement(capability \| { ungated: reason }, handler, { surfaceKind })`. **S-11 statuses:** `not_entitled` → **403**; `read_only` → **409**; `entitlement_unavailable` → **503** + `Retry-After`. Clients branch on the body `error` code. The addendum checks that no global fetch wrapper treats 403 as signed-out. Route-declaration test over §10.2 + C-5 + C-6 (WC-22c). |
| Chat | Gate at execution in `MutateExecutor`/`ForEachExecutor`, including the confirm turn and `saved-plans/[id]/run`. The per-turn snapshot is passed down. Enforcement calls are **awaited** (unlike shadow). |
| Crons (WC-13) | `durable-queue-drain` skill. Batch resolve (≤100 per chunk). A suppressed row gets a terminal `suppressed` status + `suppressed_reason` and is never re-sent (B-11). A lookup failure defers. Per-cron declarations. |
| **Send registry (S-1)** | Every automated client send is declared by **send id** with `messageClass` + `initiator`. The surface kind is derived from the entry, and `sendPolicyOverrides` is keyed by send id (Q-B4). Unclassified sends fail FR-8. |
| Payment reminders (WC-14) | Schedule-time check (`scheduleInvoiceReminders` callers) + send-time check (`PaymentReminderService`). Send time is authoritative. |
| Branding (WC-15) | `FooterBlock`, template `Footer`, booking page, and every `PublicFooter`/`PublicShell` consumer. `branded` forces the footer on at server render. The owner toggle is disabled in the UI. |
| Public / paused (WC-16, B-11) | `public_business` shows the paused page (reusing `app/go/unavailable` / `PublicErrorScreen`). `public_self_service` stays live. Grace shows a warning. |
| T-12 (WC-20) | The `license_tier` case goes through the resolver. `access-strategy.test.ts:82` is updated. |
| **B-3 row: `launch_champion_existing` (RC-3, UD-3, UD-4)** | **Replaces `launch_reset_trials`.** It is on its **own** admin route, `POST /api/admin/business-os/entitlements/launch`, because it is multi-account (S-10). **Evaluated at the enforcement switch-on moment (UD-3):** every plan row with `tier IS NULL AND cohort IS DISTINCT FROM 'champion'` (trials, including Slice-1-era signups, and cleared cohorts) becomes `cohort='champion'`, `cohort_expires_at = NULL` (open-ended, UD-4), `origin='launch'`. Existing champions and tier accounts are untouched. It runs `ensure_plan_row` semantics first for any tenant without a row (from the report's missing-row list). **Idempotent** through a launch marker (a single audited marker row or config-keyed audit check, decided in the addendum). A second run is a no-op returning the marker. Zod body `{ confirm: 'launch_champion_existing', reason, dryRun?: boolean }`. `dryRun` returns counts only. **One audit entry per account + one summary entry**, then flush. AdminAccessService gate + the same test matrix as §4.12. Accounts that sign up **after** switch-on get a normal trial. Before a tier exists, admins can make them champions one by one (UD-2). |
| Tests | Per surface type: happy path, not entitled (on the fixture tier set), read-only, lookup failure. AC-8 to AC-16, AC-26 (restated for champions), AC-27 to AC-29. |

## 6. Slice 3: Metering (outline; G-3 applies)

| Area | Plan |
|---|---|
| Inventory (FR-30, WC-18) | From `BOS_LLM_CALLS`: counts-as-AI-action, audience, class/initiator, template fallback. Embeddings don't count. **B-12:** onboarding, first website generation and services/intake generation **count**. |
| Hook | `runAiAction`. Read pre-check fails open. Post-action increment is non-blocking. |
| Tables | `business_os_ai_action_usage`, `business_os_ai_action_grants`. FK `auth.users`, `never` descriptors, **no user policies + REVOKE ALL** (as RC-8), actor columns without FK (as RC-9). |
| RPC (WC-9) | Atomic `business_os_consume_ai_action`, soonest-expiring first. INVOKER + REVOKE preferred. If DEFINER, `search_path=''` + REVOKE + service_role. |
| Periods (T-6) | From `period_anchor` with clamping. Trial = one period with the one-off total. No reset cron. |
| Degrade / pause (D-12) | Template fallback for client-facing calls. Owner-facing: `limit_reached` + pause, with chat explaining. **HTTP status is decided in the addendum and must not be 429** (S-11). |
| Trial ends on allowance | `trial_allowance_exhausted_at` fact joins `deriveLifecycle`. |
| B-12 warnings | 80%/100% once per period. **Setup-regeneration warning** before a regeneration when the remaining trial allowance is below a configured multiple of its cost. The trial total is sized from S1-T15 data. |
| Admin | `grant_ai_actions` op, audited, grant ledger. |
| Retire | `monthly_ai_allowance_usd` display. The usage card moves to AI actions. `pricingConfig.ts` is only touched if needed (6 `console.*`). |
| Email fair use (B-7) | Count + alert. Never block. Block only by admin override. |

## 7. Slice 4: Billing (outline; **gated by G-1**; G-3 applies)

**It cannot start until G-1 is met:** service-role key rotated, old key revoked, rotation verified.
- **Prices:** Stripe prices by `lookup_key` in config (T-10). Subscription metadata `product: business_os`, and the credit webhook ignores those events.
- **Webhooks** write only `tier`, `plan_version`, `period_anchor`, `access_ends_at`.
- **Also in this slice:** the founder coupon, boosts with auto top-up capped by the customer, and add-on purchase, which creates the add-ons table (S-3).
- **Renewal** bumps `plan_version`, which ends `'renewal'` grandfathering. The loader then accepts `'renewal'`.
- **Logging to convert when touched:** `StripeService` (2 `console.*`) and `app/api/stripe/webhook/route.ts` (168). I will propose a separate PR for the webhook.

---

## 8. Rollout, Flag Plan and Gates

| Step | Env | `BOS_ENTITLEMENTS_MODE` | Gate / action |
|---|---|---|---|
| 1. Slice 1 merged | all | `off` (default) | SA ✅, QA ✅, user approval. RM/user applies the migration, which **backfills all existing tenants as open-ended champions**. |
| 2. Verify provisioning | prod | `off` | Report: missing plan rows = 0. Open-ended champion count = pre-existing tenant count. DB logs show 0 trigger WARNINGs. |
| 3. Shadow on | preview → prod | `shadow` | Env change + redeploy. `shadow.ts` error rate 0. No chat-v4 latency change. |
| 4. Usage review | prod | `shadow` | About one week or more. The user designs tiers from observed usage (`allowed` included) and `readRule` comparisons. S1-T15 sizes the trial allowance. |
| 5. Tiers added as config | all | `shadow` | Normal release (B-2). `asTier` report shows retroactive would-be denials per tier. |
| 6. Slice 2 merged | all | `shadow` | All surfaces wired in shadow. T-8 retired. S-12 landed. |
| 7. **Switch-on** | prod | `enforce` | **Preconditions, all required:** **G-1** key rotated + old key revoked + verified. **G-2** both CI jobs are required checks on `main`. **UD-2** at least one configured tier **and** a path onto it (admin `assign_tier` or Slice 4 checkout). The report shows no unexplained denials. User approval in session. **Then** `launch_champion_existing` (dry-run, then run) **at switch-on (UD-3)**, then set `enforce` + redeploy. |
| 8. Ongoing | prod | `enforce` | Admins set end dates per open-ended champion (report list, UD-4). Late signups before billing can be made champions by an admin (UD-2). |
| Rollback | any | `off` + redeploy | No data reversal needed. Tables are never purged. |

---

## 9. Traceability (WC and RC)

### 9.1 WC-1 to WC-22

| WC | How it is met | Task(s) / section |
|---|---|---|
| WC-1 | Branch from `origin/main` 94f9cfcd | Header |
| WC-2 | T-1 typed modules + mapped types (zero-tier safe) + lazy `TierMatrixSource` + Zod. `SCOPED_DIRS` extended (names unchanged). Jest CI job. G-2 required checks. | S1-T1..T5, S1-T14, §4.14 |
| WC-3 | `resolveAccountId`. `business_os_*` tables FK `auth.users`. `never` descriptors + `USER_OWNED_TABLES` in the same PR. | S1-T7, S1-T8, §4.3 |
| WC-4 | New repositories. The tenant pre-check reuses existing repositories (RC-10). The report pages through a repository (RC-12). `supabaseServer` documented. | S1-T9, §4.9, §4.12 |
| WC-5 | Zod: admin unions (`.strict()`), config at first load, report params (`asTier`, window). Slice 2 cron/public inputs. | S1-T5, S1-T12 |
| WC-6 | Pino everywhere. Correlation IDs. All outcomes logged. §10 flags. | S1-T10..T12 |
| WC-7 | AdminAccessService gate + `profiles.role` 403 test, allow-lists, pre-check, log + awaited flush. Durable actor/reason columns (no FK, RC-9). | S1-T12, §4.12 |
| WC-8 | **No user policies + REVOKE ALL** (RC-8). User-facing profile route test. Symbol-level import test. | S1-T7, S1-T13 |
| WC-9 | Trigger functions: DEFINER, `search_path=''`, `lock_timeout`, REVOKE. Shadow RPC: INVOKER + REVOKE. Slice 3 consume RPC follows the same rules. | S1-T7, §4.3 |
| WC-10 | `decide` by audience. Stale inputs never for owner-paid. `entitlement_unavailable` separate. | S1-T6, S1-T10 |
| WC-11 | Input cache 30 s + LRU + read-through. Bound documented and in responses. | S1-T10, S1-T12 |
| WC-12 | `deriveLifecycle` from pins, facts and histories. No state cron. `check-free-tier-expiration` untouched. | S1-T6 |
| WC-13 | Cron suppression/defer/batch/declarations | §5 (addendum per G-3) |
| WC-14 | Schedule + send checks | §5 |
| WC-15 | All footer consumers, server override | §5 |
| WC-16 | C-5 list, paused page, B-11 self-service live | §4.6 overlay, §5 |
| WC-17 | T-8 retirement before switch-on | §5 prerequisites, §8 step 6 |
| WC-18 | `runAiAction`, `BOS_LLM_CALLS` inventory, atomic consumption | §6 |
| WC-19 | Version + removals + snapshot. `'renewal'` rejected. Extended to duration/grace histories (S-7). | S1-T3, S1-T5, S1-T13 |
| WC-20 | `license_tier` via resolver | §5 |
| WC-21 | Flag-off no reads (test). **No config load in chat-v4 when off** (RC-7). Shadow never throws (test with throwing loader). Trigger never raises (tmp_fail) + `lock_timeout` (RC-14). Launch op at switch-on (RC-3). | S1-T7, S1-T10, S1-T11, S1-T13, §5, §8 |
| WC-22 | FR-8 invariants, forbidden literal, snapshot, resolver/lifecycle with injected clock (fixture + prod config). Route-declaration + per-surface in Slice 2. Admin route matrix. | S1-T13, §5 |

### 9.2 RC-1 to RC-17

| RC | Where addressed | Task(s) |
|---|---|---|
| RC-1 No production tiers, fixture tests, zero-tier types/Zod, `no_tiers_configured`, nullable `lowestTier`, deny list ∪ `TIER_ORDER` | §4.6, §4.7, §4.8, §4.12, §4.13 | S1-T1, T3, T5, T6, T12, T13 |
| RC-2 Cohort base `{ tier } \| { all: true }` + explicit values + `not_built` never | §4.4 (last column), §4.6, §4.8 | S1-T3, T6 |
| RC-3 Champion backfill + `launch_champion_existing` | §4.3 step 5, §4.11, §5 B-3 row, §8 step 7, §11 | S1-T7 (Slice 2 for the op) |
| RC-4 Champion `expiresAt` required key, no default-duration fallback, open-ended count | §4.8, §4.10, §4.12 | S1-T6, T11, T12 |
| RC-5 Business questions as config (`readRule`, `clockStartsAt`, send-policy overrides) + flip tests | §4.5, §4.6, §4.13, §12.1 | S1-T3, T4, T13 |
| RC-6 Record all outcomes + item counts + `asTier` retroactive | §4.3 (table), §4.10 | S1-T7, T11 |
| RC-7 Module-load safety | §3, §4.7, §4.10, §4.13 | S1-T10, T11, T13 |
| RC-8 No user policies + REVOKE ALL | §4.3 step 2 | S1-T7 |
| RC-9 Actor columns without FK | §4.3 | S1-T7 |
| RC-10 Tenant pre-check via existing repos + `ensure_plan_row` | §4.12, §2 | S1-T9, T12 |
| RC-11 Tier-over-cohort precedence + combination tests | §4.8, §4.13 | S1-T6, T13 |
| RC-12 Paged report + 100-id batch cap | §4.9, §4.10 | S1-T9, T10 |
| RC-13 LRU cap + read-through | §4.9 | S1-T10 |
| RC-14 Trigger conditions (a)–(i) | §4.3, §4.11 | S1-T7 |
| RC-15 Symbol-level import test | §3, §4.12, §4.13 | S1-T13 |
| RC-16 Report exposure (no names/reasons) + test | §4.10, §4.13 | S1-T11, T13 |
| RC-17 Scope change in §1 + re-traced | §1, §9 | — |

---

## 10. console.* Files in the Touch Set

Counted on `origin/main` 94f9cfcd. Each touched file with `console.*` is flagged and, with user approval, converted in the same slice.

| File | `console.*` | Slice | Proposal |
|---|---|---|---|
| Slice 1 modified files (`chat-v4/route.ts`, `lib/audit/events.ts`, `lib/repositories/{types,index}.ts`, `OnboardingConversationRepository.ts`, `purge/descriptors.ts`, `businessOwnedTables.ts`) | 0 | 1 | Nothing to convert. `OnboardingConversationRepository.ts` is re-counted when opened. |
| `scripts/typecheck-bos-llm.ts` | CLI `console.error` | 1 | Out of scope (CLI script outside `lib/`/`app/`/`components/`) |
| `app/site/[subdomain]/book/page.tsx` | 1 | 2 | Convert when touched |
| `lib/utils/pricingConfig.ts` | 6 | 3 (if touched) | Convert when touched |
| `lib/stripe/StripeService.ts` | 2 | 4 | Convert when touched |
| `app/api/stripe/webhook/route.ts` | 168 | 4 (if touched) | Separate conversion PR |
| `lib/services/CreditService.ts` | 20 | Not planned | Only if touched |

All other Slice 2 candidates checked have 0.

---

## 11. Risks

| # | Risk | Likelihood / impact | Mitigation |
|---|---|---|---|
| R-1 | Shadow hook adds latency or errors to chat-v4 | Low / Med | Not awaited. Config loaded lazily inside the try (RC-7). No-op when `off`. |
| R-2 | Trigger breaks onboarding | Low / High | DEFINER, `search_path=''`, `lock_timeout 2s`, `EXCEPTION → WARNING`, fact-only upsert. The tmp_fail check proves it. |
| R-3 | Purge live-schema check sees unclassified tables | Med / Low | Same-PR ordering. Invariant tests. |
| R-4 | A config trial-length change moves running trials | **Closed by S-7.** Histories apply at trial start. The snapshot test blocks history edits. | — |
| R-5 | Chat read rule makes Basic chat weak or `chat.search` meaningless | Med / Med | `readRule` is config. Both rules are recorded in shadow. The user picks with data. |
| R-6 | CI failures are advisory (no required checks) | Certain / High before `enforce` | **G-2.** |
| R-7 | Next build ignores type errors | Certain / Med | Zod at first load + invariants + scoped typecheck. |
| R-8 | Cross-instance staleness | Certain / Low | 30 s bound documented. |
| R-9 | **Open-ended champions keep free access indefinitely** (UD-4, U-2) | Certain / Med (revenue, not customer harm) | The report lists open-ended champions. Admins set per-account dates. Access never lapses by surprise. |
| R-10 | **Trials of new signups end before any plan or payment path exists**, leaving no way to pay (UD-2) | High if enforced early / High | `enforce` is refused while there are no tiers (mode check). The §8 step 7 checklist requires a path onto a plan. Admins can make late signups champions. In shadow, lifecycle is only reported. |
| R-11 | `new-api-route` skill admin line misleads future work | Med / Med (security) | Not followed here. S-12 separate change, user approval via TL, must land before the Slice 2 addendum. |
| R-12 | Stub reminder sender makes `payments.reminders` meaningless | Certain / Med | Dependency (§16). Raised again before switch-on. |
| R-13 | **Service-role key is public** | — / High | **G-1** blocks `enforce` and Slice 4 until rotated, revoked and verified. Slice 1 adds no new exposure. |
| R-14 | `launch_champion_existing` runs twice, or runs too early | Low / Med | Launch marker makes it idempotent. Dry-run first. Only in §8 step 7 after the preconditions. Audited per account. |
| R-15 | `shadow_events` grows because `allowed` is recorded | Med / Low | One row per (account, capability, surface, outcome, rule, day). After the launch decision, stop recording `allowed` or add a date-window purge (SA suggestion). |

---

## 12. Config Defaults, SA Decisions, Separate Changes, BA Follow-ups

### 12.1 Business questions now resolved as config values (RC-5; the user will confirm the defaults)

| # | Question (business terms) | Config value | Default |
|---|---|---|---|
| Q-B1 | Can a lower-plan owner ask chat questions about the areas their plan includes, or does any look-up question need the search feature? | `chatActionMap.readRule` | `'domain_group'`: questions about included areas are allowed |
| Q-B2 | What do design partners get? | `COHORTS.champion.base` | **Decided by the user:** everything (`{ all: true }`) |
| Q-B3 | Does the trial clock start at the first onboarding message or at setup completion? | `COHORTS.trial.clockStartsAt` | `'first_onboarding_message'` |
| Q-B4 | When paused, do clients still get the intake questionnaire for an existing booking? | Send-policy default for system-initiated transactional sends + `sendPolicyOverrides[sendId]` | Stop (suppress in `paused`) |
| UD-1 | What does a new signup's trial include before plans exist? | `COHORTS.trial.base` | Everything |
| UD-2 | When may enforcement be switched on? | `LAUNCH.enforceRequiresConfiguredTier` + §8 checklist | Not until at least one plan and a path onto it exist |
| UD-3 | "Existing accounts" as of when? | `launch_champion_existing` run time | The enforcement switch-on date |
| UD-4 | When does a migrated champion's free access end? | `cohort_expires_at = NULL` from backfill/launch | No end date until an admin sets one per account. The report lists these accounts. |

### 12.2 SA decisions applied

| # | Decision | Applied in |
|---|---|---|
| S-1 | `client_render` audience. Send registry with `initiator`. Surface kind derived from the registry. | §4.4, §4.6, §5 |
| S-2 | Key space confirmed. Agents ungated. `readRule` config. Item counts. | §4.5 |
| S-3 | Add-ons table deferred. Comps via overrides. | §4.8, §4.12, §7 |
| S-4 | `plan_version DEFAULT 0` + CHECK | §4.3 |
| S-5 | Champion `expiresAt` required key (date or `null`). No fallback. | §4.8, §4.12 |
| S-6 | Input cache + LRU + read-through. Stale data only for fail-open audiences. | §4.9 |
| S-7 | Facts + pins + histories. No write on read. | §4.3, §4.6, §4.8, §4.13 |
| S-8 | Trigger conditions (a)–(i). Scoped approval. | §4.3, §4.11 |
| S-9 | Extend `SCOPED_DIRS`. No renames. | §4.14 |
| S-10 | Single POST union at `accounts/[accountId]`. Launch on its own route. | §3, §4.12, §5 |
| S-11 | 403 / 409 / 503 + `Retry-After`. `limit_reached` is not 429. | §5, §6 |
| S-12 | Skill fix is a separate change. | §12.3 |

### 12.3 Separate change requiring user approval (listed, not done)

| Change | Detail | Owner / timing |
|---|---|---|
| **S-12: fix `.claude/skills/new-api-route/SKILL.md:118`** | Replace the "Admin-only" variation (`user.app_metadata?.role === 'admin'`) with `AdminAccessService.getInstance().isAdmin(...)`, fail closed on throw, pointing to `app/api/admin/business-os/llm-usage/route.ts`. Deliver as a separate `chore(skills)` change. | `.claude/skills` is project configuration, so **TL obtains user approval**. Not done in this workplan. Not blocking Slice 1. Must land before the Slice 2 addendum. |

### 12.4 BA follow-ups (routed by TL)

The requirement must be updated for the scope change: FR-3 ("every tier (Basic, Growth, Pro)"), D-2 ("Growth-level trial"), B-3 / FR-14 / AC-26 (champions in place of fresh trials, evaluated at switch-on), AC-4 and AC-7 (fixture-based), plus B-11, B-12 and UD-1 to UD-4.

---

## 13. SA Review Notes

### SA Workplan Review

**Reviewed by SA — 2026-09-19** (worktree at `fbe151ac`, based on `origin/main` `94f9cfcd`; code facts checked against that tree)
**Status:** 🔄 **APPROVED WITH CONDITIONS**

The architecture is sound and is approved: config kept apart from the resolver, a pure resolver with an injected clock, lifecycle derived from timestamps, `business_os_*` tables keyed to `auth.users`, the admin route pattern copied from `llm-usage`, and a Jest CI job. Most of the plan's analysis checks out against the code: five `business_profiles` insert paths, `onboarding_conversations` written before the profile exists, the `USER_OWNED_TABLES` and descriptor invariants, the skill drift, and the absence of CI for `lib/**` Jest.

**Condition to proceed.** Dev revises this workplan for the **user's scope change (2026-09-19, below)** and for RC-1 to RC-17. SA then re-checks the revised §4.3 (migration SQL), §4.6, §4.8, §4.11, §4.12 and §5 B-3 row. That re-check is a short delta review, not a new full review. After it, implementation starts at S1-T1. S1-T0 already requires SA approval of the migration SQL before it is written, and that still applies.

#### User scope change (2026-09-19), which supersedes parts of the plan and requirement

| # | User direction | Effect on this workplan |
|---|---|---|
| U-1 | Build the **infrastructure only**. Do not encode Eyal's tier contents. The user adds tiers as configuration later. | Production config ships **no** commercial tiers. The §4.6 example matrix becomes a **test fixture**. See RC-1. |
| U-2 | Champions get **all** capabilities: every catalog capability at its highest variant/quantity, including beta. **All existing accounts become champions at rollout.** New signups still follow the trial lifecycle. | The cohort base is generalised to `{ all: true }` (RC-2). Backfill and launch go to champion instead of trial (RC-3). S-5 is revised (RC-4). B-3's "fresh trial for everyone else" is superseded. |
| U-3 | Dev's four business questions become **configuration**, not code decisions. Keep Dev's defaults where the trial lifecycle needs one. | Q-B1, Q-B3 and Q-B4 become config values with Dev's defaults (RC-5). The user answered Q-B2 directly (champions get everything). |

The requirement doc (owned by BA) must be updated to match: FR-3 ("every tier (Basic, Growth, Pro)"), D-2 "Growth-level trial", B-3, FR-14, AC-4 (becomes fixture-based), AC-7 and AC-26. **TL should route that to BA.** SA does not edit the requirement here.

#### WC-1 to WC-22 verification (tasks, not just the §9 table)

| WC | Verdict | Notes |
|---|---|---|
| WC-1 | ✅ | Branch from `origin/main` `94f9cfcd`. The branch-creation deviation is recorded for RM. |
| WC-2 | ✅ with S-9 | S1-T1..T5 and S1-T14. Keep the existing check names (see S-9). |
| WC-3 | ✅ | `resolveAccountId`, FKs to `auth.users`, `never` descriptors, `USER_OWNED_TABLES`, and the same-PR ordering (R-3) are all correct. The purge live-schema check really does enumerate every `public` table with a `user_id` column (`purge_schema_introspect`), so all three tables must be classified. |
| WC-4 | ✅ with RC-10, RC-12, RC-15 | Repositories and documented `supabaseServer`. The admin pre-check and the report must read tenant tables through their existing repositories. |
| WC-5 | ✅ | Admin union `.strict()`, load-time Zod, and report params. |
| WC-6 | ✅ | Every Slice 1 file in the touch set has 0 `console.*`. Later slices are flagged in §10. |
| WC-7 | ✅ with RC-9 | Gate order, fail-closed on throw, the `profiles.role` 403 test, and `log().catch()` then `await flush().catch()` are all correct. The actor-column FKs must change (RC-9). |
| WC-8 | 🔄 RC-8 | An owner SELECT policy on overrides would expose admin `reason` text through PostgREST. |
| WC-9 | ✅ with S-8 conditions | See S-8. |
| WC-10 | ✅ | Audience-driven `decide` mapping, and `entitlement_unavailable` is kept separate from `not_entitled`. |
| WC-11 | ✅ with S-6 | `effectiveWithinSeconds: 30` in responses, and the bound documented in the module header. |
| WC-12 | ✅ | `deriveLifecycle` is pure. `check-free-tier-expiration` is untouched. RC-11 fixes a precedence gap. |
| WC-13 to WC-18, WC-20 | ✅ at outline level | Acceptable because each later slice gets an SA-reviewed addendum. **Each addendum must restate its WCs as concrete tasks and tests.** An outline row is not enough at that stage. |
| WC-19 | ✅ | Version, removals and snapshot test, with `'renewal'` rejected. Extended to cohort durations by S-7. |
| WC-21 | 🔄 RC-7, RC-14 | The flag-off no-read test, the shadow no-throw test and the trigger never-raise design are right. Two gaps: (1) `chat-v4` importing the entitlements module would run load-time Zod at cold start **even with the flag off**, so a bad config could take chat down (RC-7). (2) The trigger needs a lock timeout and a concrete failure-injection test (RC-14). The launch migration is re-scoped by RC-3. |
| WC-22 | ✅ | S1 tests are complete. Under U-1, the tier-semantics tests run against fixtures (RC-1). Route-declaration and per-surface integration tests are in Slice 2. |

**Slice 1 zero-behaviour check.** With `BOS_ENTITLEMENTS_MODE=off`, the only production effects once RC-7 and RC-14 are in are: (a) the migration and backfill, and (b) the two AFTER INSERT triggers on `onboarding_conversations` and `business_profiles`. Both triggers never raise and are bounded by `lock_timeout`. There are no entitlement reads and no shadow writes, the chat-v4 hook returns synchronously, and no customer-visible route, page or cron changes. **Accepted.**

#### Decisions on S-1 to S-12

| # | Decision |
|---|---|
| **S-1** | **Approved.** Add audience `client_render` (branding), which needs no `messageClass`. FR-8 becomes: every automated client **send** declares `messageClass` **and** `initiator: 'client' \| 'system'` in the Slice 2 send registry. The overlay surface kind for a send is **derived from its registry entry**. A call site never chooses it, so it cannot pick the wrong one. Paused/grace behaviour is a config table keyed by **send id**, with defaults from (class, initiator). That is what makes Q-B4 a config value (RC-5). |
| **S-2** | **Approved.** The key space is `entity.op` for `find` / `compute` / every `ActionDef`, plus `plan.for_each` and `plan.analyse`, cross-checked against the 107 plugin actions. `agents` / `agent_runs` → `{ ungated: 'agent platform, B-8' }` is confirmed: gating them would couple the two products, which B-8 forbids. The R-A/R-B read rule is a **config value** (`readRule`, default `'domain_group'` = R-A) (RC-5). The shadow recorder also records the `for_each` item count, so a bulk threshold can become config later without new instrumentation. |
| **S-3** | **Approved.** The add-ons table is deferred to Slice 4. The resolver keeps an `addons` input, tested with fixtures. Comped add-ons before billing go through overrides (`add` on quantity, `set 'included'` on an addon). |
| **S-4** | **Approved with changes.** Column is `plan_version integer NOT NULL DEFAULT 0`, so the trigger and backfill never name a version. Add `CHECK (tier IS NULL OR plan_version > 0)`: it names no tier, and it makes "tier with version 0" unrepresentable. `0` resolves to the current version only when `tier IS NULL`. |
| **S-5** | **Revised under U-2.** On `set_cohort` for a champion, `expiresAt` is a **required key**. Its value is either an ISO date in the future or an **explicit `null`, meaning open-ended**. Both need a reason. Omitting the key returns 400. The resolver treats a champion with `cohort_expires_at IS NULL` as an **active champion**, with no anomaly and **no `defaultDurationDays` fallback**. Remove that fallback: it counts from `created_at`/anchor and would expire every migrated account on the same day. The report lists open-ended champions as an ops count. **For the all-existing-accounts rollout, open-ended is the safer choice**: nothing can lapse by accident for a live customer. The trade-off, free access until someone sets a date, is visible in the report and is a revenue risk rather than a customer-harm risk. An admin sets per-account dates later. |
| **S-6** | **Approved as a refinement of T-5, within approved pattern 3.** Cache the **inputs** (plan row + overrides) for 30 s, resolve on every call with an injected `now`, and memoise the resolved snapshot per request/turn. Add a **size cap** (LRU, for example 5,000 entries), because the report and crons touch many accounts. The report and batch paths **read through without populating** the cache. Keep stale inputs for up to 10 minutes, and **only** as the T-3 fallback for fail-open audiences. Owner-paid capabilities never get stale data and return `entitlement_unavailable`. |
| **S-7** | **Derived, not materialised on read.** The read path must never write: that would break resolver purity and T-5. Record **facts** on the plan row: `onboarding_started_at` and `profile_created_at`, both set by the triggers with COALESCE and never overwritten. Trial start = `trial_started_at` if pinned (admin), otherwise the fact selected by config `trial.clockStartsAt` (default `'first_onboarding_message'`, per Q-B3). Trial end = `trial_ends_at` if pinned, otherwise start + duration. **Shortening the trial length must not shorten trials already running.** Model the duration as an append-only `durationHistory: [{ effectiveFrom, days }]`, where a trial uses the entry in force at its start (pure, same idea as `removals`). Extend the snapshot test so that any change to `trial.durationDays` / `graceDays` without a history entry fails. AC-14 then holds for new signups. |
| **S-8** | **Approved, with these mandatory conditions.** Verified: both parent tables have **user INSERT RLS policies** (`WITH CHECK (auth.uid() = user_id)`), so a signed-in user can fire these triggers directly through PostgREST. The plan table has no user write policy, which is why DEFINER is justified. (a) The function reads **only `NEW.user_id`** plus constants and `now()`. It must never copy `NEW.metadata` or any other parent column into plan fields. (b) `SET search_path = ''` with every name schema-qualified. (c) `SET lock_timeout = '2s'` on the function, so a lock on the plan table cannot stall an onboarding insert. (d) `EXCEPTION WHEN OTHERS → RAISE WARNING` (as planned). (e) Idempotency: `ON CONFLICT (user_id) DO UPDATE SET <fact> = COALESCE(plans.<fact>, EXCLUDED.<fact>) WHERE plans.<fact> IS NULL`. This never touches cohort, tier or trial fields, so an onboarding reset (`/api/onboarding/chat/reset` deletes conversation rows) or a business Reset **cannot restart a trial**, and it is tested. (f) REVOKE EXECUTE as planned. Firing a trigger does not check EXECUTE, so this is harmless. (g) Migration order in **one transaction**: tables → RLS/revokes → functions → triggers → backfill. There must be no window where a new tenant gets neither the trigger nor the backfill. (h) The trigger fires on every onboarding message, which is acceptable with the `WHERE … IS NULL` guard (no row write after the first). (i) The verification script proves never-raise with a concrete method inside a rolled-back transaction: `ALTER TABLE public.business_os_account_plans ADD CONSTRAINT tmp_fail CHECK (false) NOT VALID`, insert a parent row, assert the parent row exists, then `ROLLBACK`. This approval covers **this module's provisioning only**. It is not a general "provisioning trigger" pattern for other modules. |
| **S-9** | **Extend `scripts/typecheck-bos-llm.ts` `SCOPED_DIRS`.** Do **not** rename the npm script (`typecheck:bos-llm`, cited by the `bos-llm-call-standards` skill and CLAUDE.md), the workflow `name`, the job id or the job display name. Only update the header comments. The new `bos-entitlements.yml` Jest workflow is approved. `tests/plugins/jest-setup.ts` already stubs Supabase env, so repository imports load in CI. **Verified:** `main` branch protection currently has **no required status checks**, so "fails in CI" is advisory today. See condition G-2. |
| **S-10** | **Approved: one POST route with a Zod discriminated union** (one audit path, one allow-list per op). Recommendation: place it at `entitlements/accounts/[accountId]/route.ts` so the dynamic segment does not sit beside `shadow-report`. Multi-account ops (the RC-3 launch op) go on a **separate** route, not under `[accountId]`. |
| **S-11** | **Slice 2:** `not_entitled` → **403** (not 402, which is reserved and handled inconsistently by clients and proxies). `read_only` → **409**. `entitlement_unavailable` → **503** with `Retry-After`. `limit_reached` (Slice 3) must **not** be 429, because clients auto-retry 429. It is decided in the Slice 3 addendum. Clients branch on the body `error` code, never on the status alone. The Slice 2 addendum checks that no global fetch wrapper treats 403 as "signed out". |
| **S-12** | **Agreed, and it is a security hazard.** `.claude/skills/new-api-route/SKILL.md:118` tells admin routes to check `user.app_metadata?.role === 'admin'`, which contradicts CLAUDE.md. Fix: replace it with `AdminAccessService.getInstance().isAdmin(...)`, fail closed on throw, pointing to `app/api/admin/business-os/llm-usage/route.ts`. Deliver it as a separate `chore(skills)` change. `.claude/skills` is project configuration, so **TL gets user approval**. SA does not edit it here. It is not blocking for Slice 1, but it must land before the Slice 2 addendum. SA code review will confirm that S1-T12 did not follow the skill's variation. |

#### Required changes before implementation (RC)

**From the user's scope change:**

| # | Required change |
|---|---|
| **RC-1** | **No commercial tiers in production config.** `TIER_ORDER = []` and `TIER_MATRIX = { version: 1, tiers: {}, removals: [] }`. The §4.6 example matrix moves to `entitlements/__tests__/fixtures/` and is validated by the **same** schema builder through an injectable `TierMatrixSource`. The mapped types and the Zod builder must accept zero tiers (`z.enum` needs a non-empty tuple, so handle the empty case). Every tier-semantics test runs on a fixture with at least 2 tiers: AC-2's deletion loop, AC-4's one-line change, grandfathering, `lowestTierFor`, and the variant/quantity/allowance merges. A separate test proves the production config loads. Drop "(S) rows exact" from S1-T3. `assign_tier` returns 400 `no_tiers_configured` when the tier list is empty. `lowestTier` may be `null`. The forbidden-literal deny list is `{'basic','growth','pro'} ∪ TIER_ORDER`. |
| **RC-2** | **Generalise the cohort base:** `base: { tier: TierId } \| { all: true }`. `{ all: true }` is **derived from the catalog**: boolean/group on, variant = the top of its ordered list, addon = `included`. Quantity, metered and fair-use values have no natural maximum, so they are **explicit cohort config values**. Zod requires one for every such capability, so a new catalog entry fails CI until champions get a value. `beta` comes in via `includeLifecycle: ['beta']`. **`not_built` stays never** (FR-13 unchanged). Champion = `{ all: true }` (U-2). The trial's config default is also `{ all: true }` until a tier exists, because there is no Growth tier to point at. Switching it to a tier later is a one-line change. This default is listed for the user below. |
| **RC-3** | **Rollout to champion.** The Slice 1 backfill writes existing Business OS users as `cohort = 'champion'`, `cohort_expires_at = NULL` (open-ended), `origin = 'backfill_slice1'`, with facts from `MIN(onboarding_conversations.created_at)` and `business_profiles.created_at`. New signups get a trial through the triggers. The Slice 2 `launch_reset_trials` op is **replaced** by `launch_champion_existing`. It sets every account that has no tier and is not already a champion to open-ended champion, including Slice-1-era signups, per the default below. It is idempotent (launch marker), writes one audit entry per account plus a summary, and lives on its own admin route. Update §4.3, §4.11, §5 (B-3 row), §8 step 6 and the §11 risks. |
| **RC-4** | **S-5 as revised:** `expiresAt` is a required key (date or explicit `null`). Remove the `defaultDurationDays` champion fallback and its anomaly. The report counts open-ended champions. |
| **RC-5** | **Business questions become config**, each with a test that flips the value. Q-B1: `chatActionMap.readRule` (default `'domain_group'`). Q-B2: closed by the user (RC-2). Q-B3: `trial.clockStartsAt` (default `'first_onboarding_message'`), backed by the recorded facts in S-7. Q-B4: the paused/grace send policy is keyed by send id, and the default for the intake request is **suppress in paused**. Remove §12.1 as open questions and restate the four items as config defaults. |
| **RC-6** | **Record usage in shadow, not only denials.** With no tiers and every existing account a champion, a denials-only log would be nearly empty and would lose the data the user needs to design tiers. Record every (capability, surface, outcome, rule), **including `allowed`**, plus the `for_each` item count. The report accepts `asTier=<configured tier>` and computes would-be denials **retroactively** from recorded usage once tiers exist. AC-7 is proven in tests with the fixture matrix. |

**Technical:**

| # | Required change |
|---|---|
| **RC-7** | **Module-load safety (WC-21).** `chat-v4` imports only a thin `shadow.ts`, which imports only `mode.ts`. Config loading and Zod run **lazily inside `shadow.ts`'s try**, and `mode.ts` must not import config. Test: a config loader that throws does not affect chat-v4 in `off` (not called) or in `shadow` (swallowed and logged). Slice 2 relies on the CI gate (G-2) for bad config, not on runtime. |
| **RC-8** | **RLS.** No user policy on `business_os_entitlement_overrides`: `reason`, `ended_reason` and actor ids are admin-internal and would otherwise be readable by the account owner through PostgREST. For Slice 1, define **no user policies on any of the three tables**. WC-8 allows "or none", and nothing reads them client-side. A future plan UI reads through a server route. Add `REVOKE ALL ON TABLE … FROM anon, authenticated` on all three. The verification script asserts both. |
| **RC-9** | **Actor columns** (`actor_admin_id`, `ended_by_admin_id`, `updated_by_admin_id`) become plain `uuid` with **no FK** to `auth.users`. An FK with no ON DELETE blocks deleting an admin's auth user. `ON DELETE SET NULL` conflicts with NOT NULL and erases the durable record WC-7 requires. |
| **RC-10** | **The admin target pre-check means "is a Business OS tenant"**: a `business_profiles` or `onboarding_conversations` row exists, read through their repositories. It does **not** mean "a plan row exists", because that would make the ops check's "tenant with no plan row" impossible to fix through the sanctioned path. Add an idempotent `ensure_plan_row` op. Return 404 only for non-tenants. |
| **RC-11** | **Lifecycle precedence.** Define `accessEnd` and the grace basis deterministically when an account has both a tier and a cohort: the tier wins, cohort fields are ignored while it is present, and after `access_ends_at` the grace uses the subscription grace. Test every combination of tier and cohort. |
| **RC-12** | **Batch reads.** The report pages the plan table with `.order('user_id').range(...)`. `findEntitlementInputsBatch` is capped at **100 ids** per `.in()` because of the PostgREST URL length. |
| **RC-13** | S-6 cache size cap and read-through for the report and batch paths. |
| **RC-14** | S-8 conditions (a) to (i), including `lock_timeout` and the rolled-back failure-injection check. |
| **RC-15** | **Import-graph test.** Repositories are also exported from the `lib/repositories/index.ts` barrel (per the `new-repository` skill), so the test must detect **references to the write methods / class symbol**, not only direct module paths. Allowed referrers: the admin routes and the repository's own test. |
| **RC-16** | **Report data exposure.** The shadow report returns account ids and aggregates only, never business names or override `reason` text. Override reasons appear only in the per-account inspect response. Add a report test that asserts this. |
| **RC-17** | Record the scope change in §1 (inputs), and re-run the §9 traceability for the RC changes. |

#### Gates on later slices (conditions, not Slice 1 blockers)

| # | Gate |
|---|---|
| **G-1** | **Service-role key rotation gates the Slice 2 `enforce` flip (and all of Slice 4).** Every guarantee in this module (no user write policies, service-role-only RPCs, the admin gate on `admin_users`) assumes the service-role key is private. With the key public, anyone can make themselves a champion, give themselves any tier, or add themselves to `admin_users`, which makes enforcement meaningless and billing state untrustworthy. Slice 1 adds **no new exposure**: the leaked key already grants everything, and the new tables have no user policies. So Slice 1 may merge and run in shadow. **Before `BOS_ENTITLEMENTS_MODE=enforce`:** the key must be rotated, the old key revoked (not just replaced), and the rotation verified. This matches the purge Reset precedent. |
| **G-2** | Before the Slice 2 flip, the Business OS type check and `bos-entitlements` jobs must be **required status checks** on `main`. This is a repository setting, so a user or repository-admin action. |
| **G-3** | Each later slice addendum restates its WCs as concrete tasks and tests (see the WC table). |

#### Items for the user (business terms; none of them blocks Slice 1)

| # | Question | SA default (built as config) |
|---|---|---|
| U-Q1 | Until you define your plans, what should a **new signup's 14-day trial** include? | Everything, the same as design partners. When you define a plan, pointing the trial at it is a one-line change. |
| U-Q2 | New signups' trials will run out before plans and payment exist. They would become read-only and then paused, with **no way to pay**. How should that be handled? | Don't switch enforcement on until at least one plan and a way to get onto it exist (payment, or an admin assigning it). Until then an admin can make individual late signups champions. |
| U-Q3 | "All existing accounts become champions": existing as of **when**? | As of the day enforcement is switched on. Nobody who signed up in between is cut off. |
| U-Q4 | When does a migrated champion's free access end? | **No end date** until an admin sets one per account. This is safer for customers, because nothing lapses by surprise. The cost is that free access continues until someone acts. The admin report lists these accounts. The alternative is one fixed end date for everyone, which risks every account lapsing on the same day. |

#### Optimisation suggestions (non-blocking)

- The chat-v4 shadow call is not awaited in a JSON (non-streaming) route. Because it starts at planning and the turn continues for seconds, it will almost always finish. Accept the rare loss for shadow data. Slice 2 enforcement must be awaited.
- `shadow_events` retention: after the Slice 2 launch decision, either stop recording `allowed` or add a date-window purge. Not needed in Slice 1.
- S1-T15 (setup-AI cost) is worth keeping. With U-2 it is the main real input for sizing the trial allowance.

### Approval

[x] Workplan approved with conditions. Dev addresses the scope change and RC-1 to RC-17 in this document. SA re-checks the revised sections (short delta review), and then implementation proceeds. G-1 to G-3 gate later slices.

### 13.1 SA Re-check of Revision 2

**Re-checked by SA — 2026-09-19** (commit `dffea8e2`)
**Status:** ✅ **CLEARED FOR SLICE 1 IMPLEMENTATION**, with four small conditions (R2-1 to R2-4). Dev applies them during implementation. SA verifies them at code review, and they need no further workplan round.

**Migration SQL (S1-T0): approved as sketched in §4.3.** Dev may write it to the repo as specified, and QA runs the verification script on a branch DB. Checked:
- RLS on, with zero user policies and `REVOKE ALL` from `anon`/`authenticated` on all three tables.
- Actor columns without FK. `plan_version DEFAULT 0` with the tier CHECK.
- The trigger reads only `NEW.user_id`, with `search_path=''`, `lock_timeout 2s`, EXCEPTION→WARNING, and a fact-only `ON CONFLICT … DO UPDATE … WHERE … IS NULL` that cannot touch cohort, tier or pins.
- One transaction in the order tables → RLS → functions → triggers → backfill.
- The champion backfill uses `ON CONFLICT DO NOTHING`. The shadow RPC is INVOKER + REVOKE + service_role.

The definer function is owned by the migration role, which owns the plan table and therefore bypasses its RLS. That is intended.

| Section | Result |
|---|---|
| §4.3 | ✅ Approved (above). |
| §4.6 | ✅ Zero production tiers, with the fixture served through an injectable source. The `{ all: true }` base has explicit quantity/metered/fair-use values. `durationHistory`/`graceHistory`. `clockStartsAt`. The send policy is keyed by send id. See R2-4 for AC-37. |
| §4.7 | ✅ Zero-tier Zod handled with `z.never()`. Lazy first `load()`. The history and `client_render` rules are right. |
| §4.8 | ✅ The tier wins over the cohort. Open-ended champions are active with no fallback. The trial clock comes from pins, then facts, then config history. `not_built` is never on. Beta comes only via `includeLifecycle` or an override. `lowestTier` is nullable. The combination test matrix is sufficient. See R2-3. |
| §4.9 | ✅ Input cache, LRU 5,000, read-through for report/batch, a 100-id cap with chunking, and stale data only for fail-open audiences. |
| §4.10 | ✅ `mode.ts` has no config import. `shadow.ts` loads config through a dynamic import inside the try. All outcomes are recorded, including `allowed`. `asTier` is fixture-proven. The report exposure is tested. |
| §4.11 | ✅ Matches S-8 and RC-3. |
| §4.12 | ✅ with R2-2 and R2-3. The gate order, the tenant pre-check through existing repositories, 409 `plan_row_missing`, and the champion `expiresAt` required key are all right. |
| §5 B-3 row | ✅ Design approved: its own route, a dry run, idempotent, audited per account plus a summary, and it leaves tier accounts and existing champions alone. See R2-1 for timing. |
| §8 | ✅ Gates are placed correctly. G-1, G-2 and UD-2 are preconditions at step 7, and the launch op runs before `enforce`. |

**Requirement changes (BA).** B-13 to B-15, FR-43 to FR-45 and AC-36/AC-37 are consistent with the workplan, apart from R2-1 and R2-4. On AC-36 "quantities at their highest declared value": for quantity, metered and fair-use capabilities, the "highest declared value" **is** the champion cohort's explicit config value (RC-2). There is no catalog maximum. BA should word it that way at the next edit.

**§21.3 trial-reset step: re-confirmed.** If P-2 is confirmed, the launch op makes every account that exists at switch-on and has no tier an open-ended champion, including trials from the Slice 1 era. The §21.3 "reset `trial_ends_at` at flag-flip" step then **applies to no existing account**, and only signups after switch-on are trials. If the user does not confirm P-2, the reset applies as written to whatever accounts are left as trials, and the launch op's selection is where that would change. The rest of the design is unaffected either way.

**Trial beta (pending with the user):** confirmed as a **single config value**, `COHORTS.trial.includeLifecycle` (`['beta']` = yes, `[]` = no). No code or schema depends on it. The resolver tests must cover both values with a fixture beta capability. Keep Dev's current default until the user answers.

#### Conditions (apply during implementation, verified at SA code review)

| # | Condition |
|---|---|
| **R2-1** | **Build `launch_champion_existing` in Slice 1**, with `dryRun`. The updated requirement (FR-14, AC-26 dry-run part, §16) makes the dry run a Slice 1 deliverable, but §4.1 currently defers the op to Slice 2. A non-dry run returns 409 `launch_preconditions_unmet` while `TIER_ORDER` is empty (same condition as UD-2), so it cannot be executed early by accident. Add the route and its tests (auth matrix, dry run changes nothing, dry run is idempotent, non-dry run refused) to S1-T12/T13 and §4.2. |
| **R2-2** | **`ensure_plan_row` must not silently create a trial for a pre-rollout tenant.** A tenant with no row after the backfill is a trigger failure, and under U-2 an existing tenant should be a champion. Make `cohort` an explicit required body field (`'trial' \| 'champion'`, where champion also needs the `expiresAt` key). The inspect/report response shows the tenant's facts so the admin can choose. |
| **R2-3** | **No admin op may leave an account with neither a tier nor a cohort.** `set_cohort { cohort: null }` on a tierless account, and `assign_tier { tier: null }` on a cohort-less account, return 409 `would_leave_no_basis`. Otherwise an admin action creates the "anomaly: deny owner-paid" state. Add tests. |
| **R2-4** | **AC-37 must be provable on the production config, not only a fixture.** Declare the intake-request send id (and any other send ids the Slice 1 tests need) in `config/lifecycle.ts` now, as a minimal seed of the Slice 2 send registry with `messageClass` and `initiator`. A test then asserts that the production config's `paused` view suppresses it, and that one override entry flips it. |

**Items for the user:** no new ones. P-1 (trial contents, including whether the trial gets beta features) and P-2 (existing accounts become open-ended champions at switch-on) are still pending with the user. Both are config or launch-step values, so either answer needs no rework.

## 14. QA Testing Report

_QA to populate._

## 15. Commit Info

_RM to populate._

---

## Change History

| Date | Change | Details |
|------|--------|---------|
| 2026-09-19 | Initial workplan (Dev) | Branch `feature/business-os-entitlements` from `origin/main` 94f9cfcd. Slice 1 in full detail (catalog, matrix, cohorts, lifecycle overlay, chat action map, loader, pure resolver, plan rows + triggers + backfill, admin routes, shadow report, tests, CI gate). Slices 2 to 4 outlined. B-11 and B-12 treated as authoritative. WC-1 to WC-22 traced. 4 business questions, 12 SA items. |
| 2026-09-19 | SA workplan review: APPROVED WITH CONDITIONS (SA) | Added the §13 SA Workplan Review. Folded in the user's scope change (infrastructure only with no tier contents; champions get all capabilities and every existing account becomes a champion at rollout; the four business questions become config). Checked WC-1 to WC-22 against the tasks. Decided S-1 to S-12. Required changes RC-1 to RC-17. Most significant: no production tiers, with fixtures for the tests; a catalog-derived `{ all: true }` cohort base; open-ended champion backfill in place of the trial reset; lazy config load so chat-v4 cannot break with the flag off; no user RLS policies (override reasons would leak); actor columns without an FK; trigger hardening (`search_path=''`, `lock_timeout`, fact-only COALESCE upsert, single-transaction ordering). Later-slice gates: service-role key rotation before `enforce` (G-1), required CI checks (G-2), WCs restated in each addendum (G-3). SA re-checks the revised sections before code. |
| 2026-09-19 | Rev 2: scope change + RC-1 to RC-17 applied (Dev) | Infrastructure only: production `TIER_ORDER = []` and an empty matrix. Eyal's matrix moved to a test fixture, and the tier-semantics tests run on it. Cohort base `{ tier } \| { all: true }` with explicit quantity/metered values. Champions get everything, and the backfill makes every existing tenant an open-ended champion. `launch_champion_existing` replaces `launch_reset_trials` on its own route, run at switch-on. Business questions Q-B1/B3/B4 and user defaults UD-1 to UD-4 became config/launch values. Migration: no user policies + REVOKE ALL, actor ids without FK, `plan_version DEFAULT 0` + CHECK, fact columns, hardened fact-only triggers (S-8 a–i), single transaction. Lazy config load in `shadow.ts` (RC-7). Shadow records all outcomes + `asTier` retroactive report with no names or reasons. Input cache with LRU + read-through + 100-id batches. RC-11 precedence. Duration/grace histories (S-7). `ensure_plan_row` + tenant pre-check through existing repos. S-11 statuses. Gates G-1 (key rotation before `enforce` and Slice 4), G-2 (required CI checks), G-3 (addenda restate WCs). S-12 skill fix listed as a separate change needing user approval. Added §0 (what changed, SA re-check list) and §9.2 RC traceability. |
| 2026-09-19 | SA re-check of rev 2: CLEARED FOR SLICE 1 IMPLEMENTATION (SA) | Added §13.1. Migration SQL approved (S1-T0). Re-checked §4.3, §4.6 to §4.12, the §5 B-3 row and §8. Re-confirmed that the §21.3 trial-reset step applies to no existing account under P-2. Confirmed trial beta is the single value `COHORTS.trial.includeLifecycle`. Four implementation-time conditions: R2-1 build the `launch_champion_existing` dry run in Slice 1 (AC-26), with a non-dry run refused while no tier exists; R2-2 `ensure_plan_row` requires an explicit cohort; R2-3 no admin op may leave an account with no tier and no cohort; R2-4 seed the intake-request send id so AC-37 is provable on production config. |
