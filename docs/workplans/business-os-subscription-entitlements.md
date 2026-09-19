# Workplan: Business OS Subscription & Entitlements Module

> **Last Updated**: 2026-09-19

**Developer:** Dev
**Requirement:** [BUSINESS_OS_SUBSCRIPTION_ENTITLEMENTS_REQUIREMENT.md](/docs/requirements/BUSINESS_OS_SUBSCRIPTION_ENTITLEMENTS_REQUIREMENT.md). This workplan was written against the uncommitted copy in the main working tree on 2026-09-19, which includes §21 SA Review and conditions WC-1 to WC-22.
**Date:** 2026-09-19
**Status:** Planning. Waiting for the SA workplan review. No code has been written.
**Branch:** `feature/business-os-entitlements`, created from `origin/main` at `94f9cfcd` (WC-1). Dev created it on TL's instruction. The Dev role normally leaves branch creation to RM, and this deviation is recorded here for RM.

## Overview

Business OS has no commercial gating today. This workplan delivers the subscription and entitlements module in the four slices set out in the requirement (§16). Slice 1 is planned in full. It ships the capability catalog, the tier matrix and cohort config, a Zod-validated loader, the pure resolver, the per-account plan row, admin operations, and a shadow-mode "what would be gated" report. All of it sits behind a server-only flag and changes nothing customers see. Slices 2 to 4 (enforcement, metering, billing) are planned at outline level and each gets a detailed workplan addendum before it starts. Every SA condition (WC-1 to WC-22) is mapped to a task in [§9](#9-wc-traceability).

---

## Table of Contents

1. [Inputs and Decisions Honoured](#1-inputs-and-decisions-honoured)
2. [Analysis Summary (verified on origin/main)](#2-analysis-summary-verified-on-originmain)
3. [Module Architecture](#3-module-architecture)
4. [Slice 1: Catalog, Config, Resolver, Plan Row, Admin Ops, Shadow Report (full detail)](#4-slice-1-catalog-config-resolver-plan-row-admin-ops-shadow-report-full-detail)
5. [Slice 2: Enforcement (outline)](#5-slice-2-enforcement-outline)
6. [Slice 3: Metering (outline)](#6-slice-3-metering-outline)
7. [Slice 4: Billing (outline)](#7-slice-4-billing-outline)
8. [Rollout and Flag Plan](#8-rollout-and-flag-plan)
9. [WC Traceability](#9-wc-traceability)
10. [console.* Files in the Touch Set](#10-console-files-in-the-touch-set)
11. [Risks](#11-risks)
12. [Open Questions](#12-open-questions)
13. [SA Review Notes](#13-sa-review-notes)
14. [QA Testing Report](#14-qa-testing-report)
15. [Commit Info](#15-commit-info)

---

## 1. Inputs and Decisions Honoured

| Source | Treated as |
|---|---|
| D-1 to D-14, B-2 to B-10 | Fixed business inputs (requirement §3, §19). |
| B-1 (five ambiguous sheet rows) | Still open. These rows ship as catalog **placeholders** (`placeholder: 'B-1'`) with example tier values. The engine does not depend on how they are resolved. |
| **B-11** (user, after SA review; the BA is recording it in parallel) | **Authoritative now.** In `paused`, invoice payment links, payment receipts and booking cancel/reschedule links **keep working** for clients. New bookings, the public website and reminder messages **stop**. Messages suppressed while paused are **never sent retroactively** on reactivation. This replaces the §9 footnote assumption. It shapes the lifecycle overlay in Slice 1 (data only) and enforcement in Slice 2. |
| **B-12** (user, after SA review) | **Authoritative now.** Setup AI (onboarding, first website generation, services/intake generation) **counts** against the trial AI allowance. The trial allowance must cover a typical full setup with meaningful headroom, and the account is warned before setup regenerations use it up. This affects the Slice 1 report (it measures typical setup cost, see S1-T15), the Slice 3 inventory and the warning path, and where the trial clock starts (Q-B3). |
| T-1 to T-12 | SA decisions (§21.1). They are implemented as decided. The few places where this plan refines a detail are listed under SA items in §12.2. |
| WC-1 to WC-22 | Conditions on this workplan. See §9. |

---

## 2. Analysis Summary (verified on origin/main)

| Area | Finding on `origin/main` (94f9cfcd) | Impact on the plan |
|---|---|---|
| Entitlement code | None. `lib/business-os/entitlements/` does not exist, and no table uses a `bos_`/`business_os_` prefix. | Greenfield folder and tables. |
| Chat action surface | `business-os-plugin-v2.json` has **107** actions. These are `find_*`/`aggregate_*` for each entity plus the `SEMANTIC_CATALOG` actions (`lib/business-os/catalog/catalog.ts`, `ActionDef` in `catalog.schema.ts`). A plan's steps use the ops `find`, `compute`, `mutate`, `for_each`, `analyse` (`lib/business-os/bizql/types.ts`). | The FR-6 map must cover mutate actions **and** read/compute/analyse/for_each ops, not only `ActionDef`s. See §4.5. |
| Chat execution | `app/api/business-os/chat-v4/route.ts` gets the plan from `getBizQLPlanner().plan(...)` (~L777) and runs `executeMutate` in several places (confirm, dry run, direct) and `executeForEach` (~L1043). `saved-plans/[id]/run` also runs plans. | Slice 1 adds one shadow hook after planning. Slice 2 gates at execution, including confirm-time. |
| Provisioning of a Business OS tenant | `business_profiles` is inserted from **five** paths: `BusinessProfileRepository.create/upsert` (onboarding build), `setup-status` route, `scheduling/availability` route, `AvailabilityService`, `ChatCommandExecutor`. `onboarding_conversations` rows are written **before** the profile exists. | A code hook at "the" creation path would miss paths. Plan: DB triggers, see §4.11. |
| Purge classification | `lib/business-os/purge/descriptors.ts` (`never(...)` helper, `EXCLUDED` list) plus `classification-baseline.json` (SA-S3 frozen levels). `lib/business-os/businessOwnedTables.ts` plus its test parse **every migration** and fail when a new `user_id` table is in neither `BUSINESS_OWNED_TABLES` nor `USER_OWNED_TABLES`. | New tables are registered in **both** places, as person-owned and `never` (WC-3). |
| Admin pattern | `app/api/admin/business-os/llm-usage/route.ts`: `getUser` → `AdminAccessService.getInstance().isAdmin(...)`, which fails closed on throw → Zod → work. It has tests. | Copied for T-7. Not copied: `app/api/admin/boost-packs/route.ts`, which has no auth. |
| Skill drift | `.claude/skills/new-api-route/SKILL.md` "Admin-only" variation says to check `user.app_metadata?.role === 'admin'`. That contradicts CLAUDE.md (AdminAccessService only). | This plan follows CLAUDE.md and T-7. **Flagged to TL/SA** to fix the skill (not in scope here). |
| Audit | `AuditTrailService.flush()` exists (L218). `AUDIT_EVENTS` plus a metadata registry live in `lib/audit/events.ts`. | New event constants go in both places. WC-7 log-then-flush. |
| CI | Only two workflows: `plugin-tests.yml` (path-filtered, `tests/plugins/**`) and `bos-llm-typecheck.yml` (`scripts/typecheck-bos-llm.ts`, `SCOPED_DIRS` + baseline). **No workflow runs the `lib/**/__tests__` Jest suites.** | WC-2 extends the typecheck scope, **and** a new CI job runs the entitlement Jest suites. Without that, the FR-8 invariants would not be a CI gate. See §4.14. |
| Service-role RPC convention | `20260929_usage_summary.sql` prefers **SECURITY INVOKER + REVOKE from public/anon/authenticated + GRANT service_role**, and records why definer rights were not used. | Slice 1 needs no RPC (single embedded select, §4.9). The shadow counter RPC uses INVOKER + REVOKE. The trigger functions are the only DEFINER code (WC-9). |
| Tier-name literals | 13 existing `'basic' \| 'growth' \| 'pro'` literals in `lib/`, `app/`, `components/`, all unrelated (analytics, V6, website stats). | The forbidden-literal test uses a committed baseline, the same way the typecheck gate does. |
| Server flags | Business OS has no server-only feature flags. `lib/utils/featureFlags.ts` holds `NEXT_PUBLIC_*` rendering hints. | A new server-only env var `BOS_ENTITLEMENTS_MODE`, read in one place (§4.10). |
| Legacy chat (T-8) | `ChatCommandPanel.tsx:1247` still calls `/api/business-os/chat-v2`. `chat` and `chat-command` have no in-repo caller. | Retirement is in Slice 2 and is a prerequisite for the flag flip (§5). |
| LLM foundations | `lib/business-os/llm/callCatalog.ts` (`BOS_LLM_CALLS`, 8 areas) and `aiActionAudit.ts` (`runAiAction`) are present. `docs/investigations/LLM_CREDIT_AND_AUDIT_TRACKING.md` is present. | Slice 3 builds on these (WC-18). Slice 1 adds an optional read-only setup-cost estimate (S1-T15). |

---

## 3. Module Architecture

```
lib/business-os/entitlements/
  config/                      ← the ONLY place tier names may appear (FR-12)
    catalog.ts                 data-only capability catalog (engineering-owned)
    tierMatrix.ts              data-only matrix + version + removals ledger (pricing-owned)
    cohorts.ts                 trial / champion cohort config
    lifecycle.ts               grace lengths + state overlay policy table (B-9, B-11)
    chatActionMap.ts           chat op/action → capability map (FR-6)
  types.ts                     shapes, mapped types (CapabilityId, ValueFor<C>, TierId…)
  schema.ts                    Zod schemas for matrix/cohorts/lifecycle/override values
  source.ts                    TierMatrixSource interface + CodeTierMatrixSource (Zod at load)
  account.ts                   resolveAccountId(userId) – the single seam (T-2)
  lifecycle.ts                 deriveLifecycle(plan, config, now) – pure, time-derived (T-9(5))
  resolver.ts                  resolveEntitlements(...) – pure, layered, explained (FR-9/10)
  decide.ts                    check(snapshot, capability, request) → EntitlementDecision
  mode.ts                      BOS_ENTITLEMENTS_MODE reader (off | shadow; enforce in Slice 2)
  EntitlementService.ts        getSnapshot / getSnapshots (memo + 30 s TTL + failure policy)
  shadow.ts                    shadow recorder (never throws, flag-gated)
  report.ts                    static + observed shadow report builder
  index.ts                     server-only barrel
  __tests__/…
lib/repositories/
  BusinessOsAccountPlanRepository.ts     plan row + overrides reads/writes (service role, documented)
  BusinessOsEntitlementShadowRepository.ts  shadow counters (service role, documented)
app/api/admin/business-os/entitlements/
  [accountId]/route.ts         GET inspect (FR-10) + POST admin ops (discriminated union)
  shadow-report/route.ts       GET report (AC-7)
supabase/migrations/2026MMDD_business_os_entitlements.sql
scripts/typecheck-bos-entitlements.ts (or extension of typecheck-bos-llm, see §4.14)
.github/workflows/bos-entitlements.yml
```

Dependency rules, enforced by an import test (S1-T12):
- `config/*` imports only `types.ts`. There is no I/O, no logger and no Node APIs, so it stays data-only (T-1).
- `resolver.ts`, `lifecycle.ts` and `decide.ts` are **pure**: no I/O, no `Date.now()`, and `now` is injected (WC-22d).
- Nothing under `entitlements/` imports billing (`lib/stripe/**`, `CreditService`) (§13 recommendation, B-8).
- No `'use client'` file imports anything under `entitlements/` except `types.ts` (repositories are server-only).

---

## 4. Slice 1: Catalog, Config, Resolver, Plan Row, Admin Ops, Shadow Report (full detail)

### 4.1 Scope and non-goals

**In scope:** FR-1 to FR-13, FR-22, FR-31/32 (the Slice-1 admin ops), FR-34 to FR-39 as config and resolver semantics, AC-1 to AC-7, and the Slice-1 parts of WC-21.

**Explicitly not in Slice 1:** blocking anything; route, cron and public-page hooks (Slice 2); the B-3 launch migration (Slice 2, at flag flip, per §21.3); add-on and grant tables (Slice 3/4, see SA item S-3); `license_tier` (Slice 2); any change to the usage card or `monthly_ai_allowance_usd` (Slice 3); T-8 retirement (Slice 2).

**Zero-behaviour guarantee (WC-21):**
1. `BOS_ENTITLEMENTS_MODE` unset or `off` (the default) means **no entitlement DB read and no shadow write** anywhere. A test asserts the repository is never called.
2. Every shadow call site goes through `shadow.ts`, which wraps everything in `try/catch` and returns `void`. A test proves a throwing repository or resolver cannot reach the request.
3. Creating the plan row can never fail signup or onboarding. The trigger function catches all errors and raises only a `WARNING` (§4.11), and a test inserts a `business_profiles` row with the plans table made unwritable.
4. Customer-visible routes, pages and crons are not modified in Slice 1, apart from one `void shadowChatPlan(...)` line in chat-v4.

### 4.2 Files to create / modify

| File | Action | Reason |
|---|---|---|
| `lib/business-os/entitlements/config/catalog.ts` | create | FR-1/2, §4.4 |
| `lib/business-os/entitlements/config/tierMatrix.ts` | create | FR-3/4, T-1, T-11 |
| `lib/business-os/entitlements/config/cohorts.ts` | create | FR-5, D-2/D-4 |
| `lib/business-os/entitlements/config/lifecycle.ts` | create | §9, B-9, B-11 (overlay as data) |
| `lib/business-os/entitlements/config/chatActionMap.ts` | create | FR-6, §4.5 |
| `lib/business-os/entitlements/{types,schema,source,account,lifecycle,resolver,decide,mode,EntitlementService,shadow,report,index}.ts` | create | §4.7 to §4.10 |
| `lib/business-os/entitlements/__tests__/*.test.ts` + `tierMatrix.snapshot.json` + `tierLiteral.baseline.json` | create | §4.13 |
| `lib/repositories/BusinessOsAccountPlanRepository.ts` | create | WC-4, `new-repository` skill |
| `lib/repositories/BusinessOsEntitlementShadowRepository.ts` | create | Shadow counters |
| `lib/repositories/types.ts`, `lib/repositories/index.ts` | modify | Skill steps 2 and 4 |
| `lib/repositories/__tests__/BusinessOsAccountPlanRepository.test.ts`, `…ShadowRepository.test.ts` | create | One unit test per method |
| `supabase/migrations/2026MMDD_business_os_entitlements.sql` | create | §4.3. **Needs SA approval (Dev rule: no migration changes without SA).** |
| `lib/business-os/purge/descriptors.ts` | modify | Three `never(...)` rows (WC-3) |
| `lib/business-os/purge/__tests__/classification-baseline.json` | modify | Add the three new tables as `never`. This is a deliberate addition with a reason, not a level change. |
| `lib/business-os/businessOwnedTables.ts` | modify | Add to `USER_OWNED_TABLES` with reasons (its test forces this) |
| `app/api/admin/business-os/entitlements/[accountId]/route.ts` + `__tests__/route.test.ts` | create | T-7, AC-6 |
| `app/api/admin/business-os/entitlements/shadow-report/route.ts` + `__tests__/route.test.ts` | create | AC-7 |
| `lib/audit/events.ts` | modify | New `BOS_ENTITLEMENT_*` event constants + registry metadata |
| `app/api/business-os/chat-v4/route.ts` | modify | **One** fire-and-forget `shadowChatPlan(...)` call after the plan is obtained (§4.10) |
| `scripts/typecheck-bos-llm.ts` **or** new `scripts/typecheck-bos-entitlements.ts` + baseline, and `package.json` | modify/create | WC-2 (§4.14) |
| `.github/workflows/bos-entitlements.yml` | create | Runs the scoped typecheck + entitlement Jest suites in CI |
| `docs/architecture/BUSINESS_OS_ENTITLEMENTS.md` | create | Module doc: config-change procedure (the one-line change, the removal + ledger procedure), the 30 s staleness bound, ops check for missing plan rows |
| `.env.example` (if present) | modify | Document `BOS_ENTITLEMENTS_MODE` |

### 4.3 Data model and migration

Three tables, all named `business_os_*` so they cannot be mistaken for the agent platform's `user_subscriptions`/`plans` or for client `payment_plan_subscriptions` (C-8). All are keyed by owner `user_id` with **FK to `auth.users(id)`**, and **not** to `business_profiles` (WC-3). A Business OS Reset/Purge therefore cannot cascade them, which closes the trial-reset loophole.

**File:** `supabase/migrations/2026MMDD_business_os_entitlements.sql` (sketch)

```sql
-- 1. One row per Business OS account. Lifecycle is DERIVED from these timestamps at
--    resolution time (T-9(5)); no state column is moved by a cron.
CREATE TABLE public.business_os_account_plans (
  user_id              uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  tier                 text NULL,          -- validated in app (Zod vs config); NO CHECK listing tier names (FR-12: names live in config only)
  cohort               text NULL,          -- 'trial' | 'champion' — validated in app (Zod), same reason
  plan_version         integer NOT NULL,   -- matrix version the account subscribed/started at (T-11)
  period_anchor        timestamptz NOT NULL DEFAULT now(),   -- T-6
  trial_started_at     timestamptz NULL,
  trial_ends_at        timestamptz NULL,   -- NULL ⇒ trial_started_at + config trial length (see §4.11)
  cohort_expires_at    timestamptz NULL,   -- champion expiry (admin-set)
  access_ends_at       timestamptz NULL,   -- admin-assigned tier end (comped/pre-billing); Stripe period end in Slice 4
  grace_ends_at        timestamptz NULL,   -- admin override of the derived grace end
  origin               text NOT NULL,      -- 'onboarding_trigger' | 'profile_trigger' | 'backfill_slice1' | 'admin'
  updated_by_admin_id  uuid NULL REFERENCES auth.users(id),
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now()
);

-- 2. Per-account admin overrides. Never deleted; ended by setting ended_at (§8 "never deleted silently").
CREATE TABLE public.business_os_entitlement_overrides (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id            uuid NOT NULL REFERENCES public.business_os_account_plans(user_id) ON DELETE CASCADE,
                     -- FK to the plan row (itself FK'd to auth.users) so PostgREST can embed it:
                     -- ONE round trip for plan + overrides (T-5), no RPC needed.
  capability         text NOT NULL,       -- validated against the catalog in app (Zod)
  op                 text NOT NULL CHECK (op IN ('set','add','revoke')),   -- T-4 ops are schema, not pricing
  value              jsonb NULL,          -- shape-validated per capability in app; NULL for revoke
  reason             text NOT NULL CHECK (length(btrim(reason)) >= 3),
  expires_at         timestamptz NULL,
  actor_admin_id     uuid NOT NULL REFERENCES auth.users(id),             -- WC-7 durable record
  created_at         timestamptz NOT NULL DEFAULT now(),
  ended_at           timestamptz NULL,
  ended_by_admin_id  uuid NULL REFERENCES auth.users(id),
  ended_reason       text NULL
);
CREATE INDEX ON public.business_os_entitlement_overrides (user_id) WHERE ended_at IS NULL;

-- 3. Shadow-mode observed would-be decisions, aggregated per day (AC-7). Bounded: one row per
--    (account, capability, surface, outcome, day).
CREATE TABLE public.business_os_entitlement_shadow_events (
  user_id            uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  capability         text NOT NULL,
  surface            text NOT NULL,       -- e.g. 'chat:mutate:invoices.create'
  outcome            text NOT NULL,       -- would-be outcome
  day                date NOT NULL,
  hits               integer NOT NULL DEFAULT 0,
  last_seen_at       timestamptz NOT NULL DEFAULT now(),
  sample_correlation_id text NULL,
  PRIMARY KEY (user_id, capability, surface, outcome, day)
);

-- RLS (WC-8): owner SELECT on plans + overrides (lets a future plan/usage UI read own state);
-- NO insert/update/delete policy for anon/authenticated. Shadow table: RLS on, NO policies at all.
ALTER TABLE … ENABLE ROW LEVEL SECURITY;  -- all three
CREATE POLICY business_os_account_plans_owner_select ON public.business_os_account_plans
  FOR SELECT TO authenticated USING (user_id = auth.uid());
CREATE POLICY business_os_entitlement_overrides_owner_select ON public.business_os_entitlement_overrides
  FOR SELECT TO authenticated USING (user_id = auth.uid());

-- Shadow counter increment (atomic upsert). SECURITY INVOKER + REVOKE, following the
-- 20260929_usage_summary.sql convention: the only caller is the service role.
CREATE FUNCTION public.business_os_record_shadow_events(p_rows jsonb) RETURNS void
  LANGUAGE sql SECURITY INVOKER SET search_path = public, pg_temp AS $$ … INSERT … ON CONFLICT … DO UPDATE SET hits = hits + EXCLUDED.hits … $$;
REVOKE EXECUTE ON FUNCTION public.business_os_record_shadow_events(jsonb) FROM public, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.business_os_record_shadow_events(jsonb) TO service_role;

-- Provisioning triggers (§4.11): SECURITY DEFINER (they must insert regardless of which client
-- inserted the parent row), search_path pinned, EXECUTE revoked (WC-9), and they never raise.
CREATE FUNCTION public.business_os_ensure_account_plan() RETURNS trigger
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  BEGIN
    INSERT INTO public.business_os_account_plans (user_id, cohort, plan_version, trial_started_at, origin)
    VALUES (NEW.user_id, 'trial', <current matrix version — see note>, now(), TG_ARGV[0])
    ON CONFLICT (user_id) DO NOTHING;
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'business_os_ensure_account_plan failed for %: %', NEW.user_id, SQLERRM;  -- never fail onboarding (WC-21)
  END;
  RETURN NEW;
END $$;
REVOKE EXECUTE ON FUNCTION public.business_os_ensure_account_plan() FROM public, anon, authenticated;
CREATE TRIGGER business_os_plan_on_onboarding AFTER INSERT ON public.onboarding_conversations
  FOR EACH ROW EXECUTE FUNCTION public.business_os_ensure_account_plan('onboarding_trigger');
CREATE TRIGGER business_os_plan_on_profile AFTER INSERT ON public.business_profiles
  FOR EACH ROW EXECUTE FUNCTION public.business_os_ensure_account_plan('profile_trigger');

-- Backfill (Slice 1): every existing Business OS user without a row. The B-3 launch migration
-- (Slice 2) later re-sets trial windows / champions at flag-flip time (§21.3).
INSERT INTO public.business_os_account_plans (user_id, cohort, plan_version, trial_started_at, origin)
SELECT DISTINCT u.user_id, 'trial', <v>, now(), 'backfill_slice1'
FROM (SELECT user_id FROM business_profiles UNION SELECT user_id FROM onboarding_conversations) u
ON CONFLICT (user_id) DO NOTHING;
```

Notes:
- **`plan_version` in SQL.** The matrix version lives in TS. The trigger inserts `plan_version = 0`, meaning "unversioned; treat as the version current at trial start". The resolver maps `0` to the current `TIER_MATRIX.version` when the account holds no tier, which is always true for trials. When an admin assigns a tier (Slice 1) or billing subscribes (Slice 4), a real version is written. This keeps pricing numbers out of SQL. SA item S-4.
- **Cohort and tier stored as text with no CHECK.** A CHECK constraint would duplicate tier names into SQL and break FR-12's single source. Writes only happen through the admin route and repository, which Zod-validate against config. The resolver treats an unknown value as an anomaly (log `error`, T-3 policy).
- **Grandfathering needs no per-account table.** Under T-11 it is derived from the matrix `removals` ledger plus `plan_version`. A per-account sunset exception is an override with `expires_at` (§12 "set a sunset date" op, see §4.12).
- **The purge RPC's live-schema check must know the new tables.** The migration and the descriptor/`businessOwnedTables` edits ship **in the same PR**. Reset is inert today, so the exposure is small, but the order still matters.

### 4.4 Capability catalog

**Shape (types, sketch).** **File:** `lib/business-os/entitlements/types.ts`

```typescript
export type CapabilityShape =
  | { kind: 'boolean' }
  | { kind: 'variant'; variants: readonly string[] }            // ORDERED low → high (T-4)
  | { kind: 'metered'; unit: 'ai_action' | 'sms'; period: 'month' }
  | { kind: 'quantity'; unit: 'seat' | 'location' }
  | { kind: 'fair_use'; unit: 'email'; period: 'month' }        // alert-only, never blocks (B-7)
  | { kind: 'group' }                                            // boolean-valued; members via chatActionMap
  | { kind: 'addon' };                                           // tier value: 'unavailable' | 'purchasable' | 'included'

export type Audience = 'owner' | 'client' | 'mixed';             // mixed = ai.actions: decided per call site (D-12)
export type MessageClass = 'transactional' | 'marketing';
export type AtLimit = 'none' | 'degrade_to_template' | 'pause' | 'block' | 'alert_only' | 'by_call_site_audience';

export interface CapabilityDef {
  labels: { en: string; he: string; es: string };  // customer-facing name, same Labels convention as the chat catalog
  category: 'crm' | 'website_intake' | 'payments' | 'ai_chat' | 'marketing' | 'insights' | 'support' | 'platform' | 'addon';
  shape: CapabilityShape;
  lifecycle: 'available' | 'beta' | 'not_built';
  audience: Audience;
  messageClass: MessageClass | null;   // REQUIRED non-null when audience === 'client' (type-level + FR-8 test)
  atLimit: AtLimit;
  sellableAsAddon: boolean;
  placeholder?: 'B-1';                  // ambiguous row still with Eyal
}

// config/catalog.ts
export const CAPABILITIES = { /* … */ } as const satisfies Record<string, CapabilityDef>;
export type CapabilityId = keyof typeof CAPABILITIES;
```

**Full capability list (from §5.3).** "Lifecycle" is Dev's first reading. Task S1-T2 verifies each against the code and records the evidence in a comment beside the entry, because `not_built` means never entitled (FR-13).

| ID | Category | Shape | Lifecycle (verify) | Audience | Msg class | At limit | Add-on | Notes |
|---|---|---|---|---|---|---|---|---|
| `crm.core` | crm | boolean | available | owner | — | none | no | |
| `crm.documents` | crm | boolean | available | owner | — | none | no | |
| `booking.calendar_sync` | crm | boolean | available | owner | — | none | no | `calendar-sync` cron |
| `website.ai_site` | website_intake | boolean | available | owner | — | none | no | |
| `website.branding` | website_intake | variant `['branded','unbranded']` | available | client | transactional* | none | no | *Not a send. Class is N/A. It is a render policy (see the note below this table). |
| `intake.forms` | website_intake | variant `['manual','ai']` | available | owner | — | none | no | |
| `intake.reminders` | website_intake | boolean | available | client | transactional | none | no | System-initiated (stops in `paused`, B-11) |
| `payments.invoices` | payments | boolean | available | owner | — | none | no | **B-1 placeholder** |
| `payments.card` | payments | boolean | available | owner | — | none | no | **B-1 placeholder** |
| `payments.reminders` | payments | boolean | available | client | transactional | none | no | Sender is a stub (dependency, §16) |
| `payments.multi_currency` | payments | boolean | available (verify) | owner | — | none | no | |
| `chat.marketing` | ai_chat | group | available (verify) | owner | — | none | no | **B-1 placeholder** |
| `chat.invoice_control` | ai_chat | group | available | owner | — | none | no | |
| `chat.email` | ai_chat | group | available | owner | — | none | no | |
| `chat.search` | ai_chat | group | available | owner | — | none | no | Meaning is open, see Q-B1 |
| `chat.scheduling` | ai_chat | group | available | owner | — | none | no | |
| `chat.quotes` | ai_chat | group | available | owner | — | none | no | |
| `chat.reporting` | ai_chat | group | available | owner | — | none | no | |
| `chat.bulk` | ai_chat | group | available | owner | — | none | no | = `for_each` steps |
| `ai.actions` | ai_chat | metered ai_action/month | available | mixed | — | by_call_site_audience | no | Allowance **value** only in Slice 1. Counting is Slice 3. |
| `marketing.mass_email` | marketing | boolean | not_built (verify) | client | marketing | none | no | **B-1 placeholder** |
| `marketing.lead_response` | marketing | boolean | available | client | marketing | degrade_to_template | no | `lead-response` cron, `LeadReplyRecommender` |
| `marketing.posts` | marketing | boolean | not_built (verify) | owner | — | none | no | |
| `insights.checks` | insights | boolean | available | owner | — | none | no | All 34 detectors. New ones are covered automatically (FR-35) |
| `insights.channels` | insights | boolean | available | owner | — | none | no | `channel-metrics-sync` |
| `insights.daily_briefing` | insights | boolean | available | owner | — | pause | no | |
| `support.level` | support | variant `['standard','priority']` | available | owner | — | none | no | No enforcement surface. Informational. |
| `email.volume` | platform | fair_use email/month | available | client | — | alert_only | no | Never shown, never blocks (B-7) |
| `addon.marketing_analytics` | addon | addon | not_built (verify) | owner | — | none | yes | **B-1 placeholder** |
| `addon.mobile` | addon | addon | not_built | owner | — | none | yes | **B-1 placeholder** |
| `addon.full_payment_cycle` | addon | addon | not_built (verify) | owner | — | none | yes | **B-1 placeholder** |
| `addon.sms` | addon | addon | not_built | client | transactional | none | yes | SMS delivery out of scope |
| `sms.messages` | addon | metered sms/month | not_built | client | transactional | block | yes | Hooks only |
| `team.seats` | addon | quantity seat | available | owner | — | none | yes | Owner seat = 1. Invites not built (§18). |
| `business.locations` | addon | quantity location | available | owner | — | none | yes | Modelled only |
| `website.custom_domain` | addon | addon | available (verify) | client | — | none | yes | |
| `addon.act_for_you` | addon | addon | not_built (verify) | owner | — | none | yes | |

**Refinement flagged for SA (S-1):** `website.branding` is client-*visible* but it is not a *send*, so "message class" does not fit it. I will add a third audience value, `'client_render'`, which does not need a `messageClass`. The FR-8 rule then reads "every client **send** has a class". Automated client sends that are **not** gated capabilities (booking confirmations, receipts, cancel/reschedule confirmations) are declared in Slice 2's **send registry** (§5), not in this catalog. B-11 needs one more attribute on each send, `initiator: 'client' | 'system'`: client-initiated transactional sends continue in `paused`, and system-initiated ones stop.

### 4.5 Chat action → capability map (FR-6)

**File:** `lib/business-os/entitlements/config/chatActionMap.ts`. Engineering-owned, beside the catalog.

- **Key space:** `` `${entity}.${op}` `` for every entity in `SEMANTIC_CATALOG`. `op` is `find`, `compute` (the plugin's `aggregate_*`), or any `ActionDef` key. Plan-level ops add `plan.for_each` and `plan.analyse`. The invariant test derives the expected key set from `SEMANTIC_CATALOG` **and** cross-checks it against the 107 plugin actions in `business-os-plugin-v2.json`, so an action added to either one without a mapping fails (AC-3).
- **Value:** a `CapabilityId`, or `{ ungated: '<reason>' }`, which must carry a reason (same pattern as the §10.2 route declarations).
- **`capabilitiesForPlan(plan)`** (pure): the set of capabilities a plan needs. A mutate step contributes its action's capability. A `for_each` step adds `chat.bulk`. `analyse` maps to `chat.reporting`. **Read steps** (`find`/`compute`) follow a rule that is **provisional until Q-B1 is answered**.
  - Rule R-A (proposed default): a read step needs the capability of its entity's domain group. For example, `bookings.find` needs `chat.scheduling` and `invoices.compute` needs `chat.invoice_control`. `chat.search` then covers only reads of entities that have no domain group, and `chat.reporting` covers `compute` and `analyse`.
  - Rule R-B (alternative): a read-only plan needs `chat.search` for `find` and `chat.reporting` for `compute`, while reads inside a write plan are covered by the write's capability.
  - Both rules are expressed in the map module as data plus a single rule switch. The shadow report counts would-be denials under **both**, so the business can decide with numbers.

Provisional mapping by entity (placeholders except where the capability is obvious):

| Entity | Mutate actions → capability | Reads (R-A) |
|---|---|---|
| contacts | create/update/delete → `crm.core`; `statement` → `chat.invoice_control`; `send` → `chat.email` | `crm.core` |
| invoices, installments, plans, plan_subscriptions (`cancel`), refunds, transactions (`create/update/refund`) | → `chat.invoice_control` | `chat.invoice_control` |
| proposals | create/create_and_send/send/withdraw → `chat.quotes` | `chat.quotes` |
| bookings, services, business_profile (`set/clear_availability`, `open_time`) | → `chat.scheduling` | `chat.scheduling` |
| business_profile `export_ledger` | → `chat.reporting` | — |
| tasks, activities, pipeline_stages | → `crm.core` | `crm.core` |
| pages, sections, page_views, links, link_clicks | → `website.ai_site` | `website.ai_site` |
| insights | — | `insights.checks` |
| channel_metrics, channel_connections (`disconnect/sync`) | → `insights.channels` | `insights.channels` |
| emails | — | `chat.email` |
| agents, agent_runs | — | `{ ungated: 'agent platform, B-8' }` (SA to confirm, S-2) |

Engineering owns this map, and pricing never edits it (§6.1). Moving `chat.search` between tiers is still a one-line matrix change (AC-4).

### 4.6 Tier matrix, cohorts, lifecycle config (example config; all numbers are placeholders)

**File:** `lib/business-os/entitlements/config/tierMatrix.ts`

```typescript
export const TIER_ORDER = ['basic', 'growth', 'pro'] as const;   // T-4 tier order; ONLY place tier names are defined

export const TIER_MATRIX = {
  version: 1,
  tiers: {
    basic: {
      'crm.core': true, 'crm.documents': true, 'booking.calendar_sync': true,
      'website.ai_site': true, 'website.branding': 'branded',                 // (S)
      'intake.forms': 'manual', 'intake.reminders': false,                    // (S)
      'payments.invoices': true, 'payments.card': true,                       // B-1
      'payments.reminders': false,                                            // (S)
      'payments.multi_currency': false,
      'chat.marketing': false, 'chat.invoice_control': false, 'chat.email': true, 'chat.search': false,
      'chat.scheduling': true, 'chat.quotes': false, 'chat.reporting': false, 'chat.bulk': false,
      'ai.actions': { perMonth: 100 },
      'marketing.mass_email': false, 'marketing.lead_response': false, 'marketing.posts': false,
      'insights.checks': false, 'insights.channels': false, 'insights.daily_briefing': false,   // checks (S)
      'support.level': 'standard',
      'email.volume': { ceilingPerMonth: 2000 },
      'addon.marketing_analytics': 'purchasable', 'addon.mobile': 'purchasable',
      'addon.full_payment_cycle': 'purchasable', 'addon.sms': 'purchasable', 'sms.messages': { perMonth: 0 },
      'team.seats': { included: 1, purchasable: false }, 'business.locations': { included: 1, purchasable: false },
      'website.custom_domain': 'purchasable', 'addon.act_for_you': 'purchasable',
    },
    growth: { /* every key again — mapped type makes a missing key a type error */ },
    pro:    { /* … */ },
  },
  // T-11: append-only. Each entry is written in the same PR that lowers a tier value.
  removals: [
    // { version: 2, tier: 'growth', capability: 'chat.reporting', previousValue: true, grandfatherUntil: '2027-03-01' },
  ],
} as const satisfies TierMatrix;
```

`TierMatrix` is a mapped type: `tiers: Record<TierId, { [C in CapabilityId]: ValueFor<C> }>`, where `ValueFor<C>` is derived from `CAPABILITIES[C].shape`. For a variant, the value must be one of that capability's variants. A missing capability, an unknown ID or a wrongly-shaped value is a **type error** (T-1). The Zod schema (§4.7) repeats every one of these checks at load, because the Next build ignores TS errors.

**File:** `config/cohorts.ts`

```typescript
export const COHORTS = {
  trial: {
    baseTier: 'growth', durationDays: 14, graceDays: 7,
    adjustments: { 'ai.actions': { op: 'set', value: { total: 150 } } },   // one-off total (D-2); size per B-12, see S1-T15
    includeLifecycle: [],
  },
  champion: {
    baseTier: 'growth',               // PLACEHOLDER — Q-B2
    defaultDurationDays: 183, graceDays: 30,
    adjustments: { 'ai.actions': { op: 'set', value: { perMonth: 3000 } } },
    includeLifecycle: ['beta'],
  },
} as const satisfies CohortConfig;
```

**File:** `config/lifecycle.ts`. Subscription grace length (placeholder 7 days) plus the **overlay policy table**. The overlay is data, not branches, so a later B-9/B-11 change is a config edit.

| Surface kind | trial / champion / active | past_due (S4) | grace | paused |
|---|---|---|---|---|
| `owner_read` (view/export) | allow | allow | allow | allow |
| `owner_write` (incl. chat mutate) | allow | allow | **read_only** | **read_only** |
| `owner_ai` (chat, briefing, insight write-ups) | allow | allow | **read_only** | **read_only** |
| `public_business` (website, new booking, contact form, proposals) | allow | allow | allow + warning | **paused_public** (B-11) |
| `public_self_service` (invoice pay link, booking cancel/reschedule) | allow | allow | allow + warning | **allow** (B-11) |
| `send_transactional_client` (receipts, cancel/reschedule confirmations) | allow | allow | allow | **allow** (B-11) |
| `send_transactional_system` (reminders, intake requests, confirmations of existing bookings) | allow | allow | allow (B-9) | **suppress** (B-11, never retro-sent) |
| `send_marketing` | allow | allow | **suppress** (B-9) | **suppress** |

### 4.7 Loader seam and Zod validation (T-1, FR-7, FR-34, WC-5)

```typescript
export interface TierMatrixSource {
  load(): EntitlementConfig;          // { catalog, matrix, cohorts, lifecycle, chatActionMap } — validated
}
export class CodeTierMatrixSource implements TierMatrixSource { … }   // imports config/*, runs Zod once, memoises
export function getEntitlementConfig(): EntitlementConfig;           // module-level singleton via the active source
```

The Zod schema is **built from the catalog**, one schema per capability derived from its `shape`. It rejects:
- a tier missing any capability, or an unknown capability ID (strict objects);
- a wrongly-shaped value, or a variant outside the catalog list;
- negative quantities;
- a cohort or override naming an unknown capability;
- a `baseTier` not in `TIER_ORDER`;
- a `removals` entry with an unknown tier or capability, a `version` greater than `matrix.version`, or `grandfatherUntil: 'renewal'` (**rejected until Slice 4**, WC-19);
- a client-audience capability without a `messageClass`;
- a `chatActionMap` value that is not a capability or an `ungated` with a reason.

Validation runs **at module load**. An invalid config throws at load and fails in CI through the invariant tests. It never fails at request time, because the load happens at cold start before any request is answered (T-3(e)). A future DB-backed source (FR-34) implements the same interface and goes through the same schema.

### 4.8 Resolver semantics (FR-9, FR-10, FR-13, T-4, T-11)

`resolveEntitlements({ config, account, overrides, addons, now }) → EntitlementSnapshot` is **pure**. `addons` is always `[]` in Slice 1 (S-3).

**Layer order (§8) and per-shape merge (T-4):**

| Layer | boolean / group / variant / addon | quantity | metered / fair_use |
|---|---|---|---|
| 1 Tier defaults (`account.tier`, or the cohort's `baseTier` when there is no tier) | base | base | base |
| 1a Grandfathered (removals ledger) | restore `previousValue` if **higher** | restore if higher | restore if higher |
| 2 Add-ons (Slice 4 data) | `addon` → `included` | **add** | **add** |
| 3 Cohort adjustments | **replace** (unless `additive: true`) | replace / additive | replace / additive |
| 4 Overrides (`op`) | `set` replaces, `revoke` → off/lowest | `set` / `add` / `revoke` → 0 | `set` / `add` / `revoke` → 0 |
| 5 State overlay | **caps only** (never raises); applied per surface kind in `decide` | — | — |

**Rules and edge cases (each has a test):**
- **Grandfather (1a):** a removal applies when `removal.version > effectivePlanVersion(account)`, `removal.tier === basisTier`, and `now < grandfatherUntil`. Trials and champions have no paid tier, so they are never grandfathered (FR-38: "new subscribers and trials get the updated matrix"). `plan_version = 0` resolves to the current version.
- **Lifecycle filter (FR-13):** `not_built` is always off, whatever any layer says, including overrides. `beta` is **off at layers 1 to 2**, and can be turned on only by a layer-3 cohort whose `includeLifecycle` contains `'beta'`, or by a layer-4 override.
- **Expiry:** an override with `expires_at <= now` or `ended_at` set is ignored and appears in the trace as `expired`/`ended`. It is never deleted.
- **Multiple overrides on one capability:** apply them in `created_at` order, so the last one wins for `set`. `add` values accumulate.
- **Explain (FR-10):** each capability carries `value`, `decidedBy: LayerId`, and `trace: Array<{ layer, value, note }>`.
- **Anomalies:** a missing plan row, an unknown `tier`/`cohort`, or a row with neither tier nor cohort produces `snapshot.anomaly = '<code>'`, `state: 'unknown'`, and a **full-deny basis for owner-paid capabilities**. `decide` then applies T-3 by audience. It never silently means "full access forever" (§21.3).
- **Lifecycle derivation** (`deriveLifecycle`, pure, `now` injected). T-9(5) says no cron and no stored state:
  ```
  if tier && (access_ends_at == null || now < access_ends_at)      → active   (past_due: Slice 4)
  elif cohort == 'champion' && (cohort_expires_at == null || now < cohort_expires_at) → champion
  elif cohort == 'trial' && now < trialEnd(row)                    → trial    // trialEnd = trial_ends_at ?? trial_started_at + trial.durationDays
                                                                               // Slice 3 adds: && !trialAllowanceExhausted
  else accessEnd = the relevant end above; graceEnd = grace_ends_at ?? accessEnd + graceDays(cohort|subscription)
       now < graceEnd → grace, else → paused
  ```
  A champion with no `cohort_expires_at` is treated as an anomaly-warning. It gets `defaultDurationDays` from `created_at` and is logged. SA item S-5: should the admin route require an expiry when setting champion? My proposal is yes.
- **`lowestTierFor(capability, requested?)`:** the first tier in `TIER_ORDER` whose matrix value satisfies the request (FR-16). Slice 1 computes it only for the report.
- **`decide(snapshot, capability, { surfaceKind, variant?, quantity? })`** returns `{ outcome: 'allowed' | 'not_entitled' | 'read_only' | 'paused_public' | 'suppressed' | 'entitlement_unavailable', capability, lowestTier?, reason }`. `limit_reached` is added in Slice 3.

### 4.9 Account seam, service, caching, failure policy

- **`resolveAccountId(userId)` (T-2):** returns `userId` today. It is the **only** mapping, and callers never pass a raw user id to the service.
- **Repository:** `BusinessOsAccountPlanRepository`
  - `findEntitlementInputs(accountId)`: one query, `from('business_os_account_plans').select('*, business_os_entitlement_overrides(*)').eq('user_id', accountId).maybeSingle()`. That is **one round trip** with no RPC (T-5).
  - `findEntitlementInputsBatch(accountIds[])`: the same query with `.in('user_id', ids)`. Used by crons (Slice 2) and the report.
  - Write methods for admin ops. Each one scopes by `.eq('user_id', accountId)` and builds its payload from an **explicit field allow-list**.
  - `supabaseServer` is used, with a code comment giving the reason: an admin/cron cross-account context in which the account id always comes from server context and never from client input (WC-4).
- **Caching (T-5, WC-11):** `EntitlementService` caches the **inputs** (plan row plus overrides) per `accountId` for **30 s** in-process, and resolves on each call with the current `now`. Resolution is pure and cheap. Caching inputs rather than the resolved snapshot means a cached entry can never go stale across a trial or grace boundary. It is otherwise identical to T-5 (SA item S-6). Counters are never cached. Callers resolve **once per request/turn** and pass the snapshot down. `invalidate(accountId)` is called after every admin write, which affects the local instance only. **Staleness bound: 30 s cross-instance.** This is documented in the module header, and the admin route response carries `effectiveWithinSeconds: 30`.
- **Failure policy (T-3, WC-10):** if the repository errors, the service keeps the **last-known inputs**. Expired cache entries are retained for up to 10 minutes as a fallback only, and are never served as fresh. It returns a snapshot with `unavailable: true` (plus the stale inputs if any), and logs at `error` with `accountId`, `surface` and `correlationId`. `decide` maps it by audience:
  - client render/transactional: **allow**, using stale inputs if present;
  - owner-paid: `entitlement_unavailable` (503 shape, never `not_entitled`);
  - marketing cron: **defer**;
  - metered pre-check: **allow**.
  Slice 1 implements and tests this mapping. Nothing consumes it until Slice 2, apart from the shadow recorder, which records `entitlement_unavailable` as a would-be outcome.

### 4.10 Mode flag and shadow mode (FR-22, AC-7, WC-21)

- **`BOS_ENTITLEMENTS_MODE`:** a server-only env var, read in `mode.ts` only. Values: `off` (default) or `shadow`. `enforce` is accepted by the schema **only from Slice 2**. In Slice 1 it logs `error` once and behaves as `shadow`, so a mistaken setting can never block anything. The value is read per call (no module-level caching), so a Vercel env change plus redeploy flips it without a code change.
- **`shadow.ts`:**
  - `shadowChatPlan({ userId, plan, correlationId })` does nothing when mode is `off`: no read, no write, returns synchronously. Otherwise it is `void (async () => { try { … } catch (err) { logger.error(…) } })()`. It resolves the snapshot, computes `capabilitiesForPlan` under **R-A and R-B**, runs `decide` for each, and records every non-`allowed` outcome.
  - Recording: one aggregated `business_os_record_shadow_events` RPC call per request, deduplicated per (capability, surface, outcome) inside the request, plus a Pino `info` log per would-be denial with `{ accountId, capability, surface, outcome, rule, correlationId }` (NFR Observability).
- **Chat-v4 hook:** one line after the plan is obtained (~L777). It is not awaited. The confirm-turn and saved-plan paths are **not** hooked in Slice 1: the planning turn already sees the same plan, and Slice 2 gates both.
- **Report, part 1 (static, no traffic needed):** for every account with a plan row (batched in pages of 500), resolve the snapshot. It lists the account's lifecycle state and would-be state at a configurable "as if enforced at" date, the anomalies (missing row, unknown tier, champion with no expiry), and for each capability whether it would be denied, with `lowestTier`. It also returns aggregate counts by capability and state, and an **ops check: Business OS tenants with no plan row** (count plus sample ids). That check covers AC-26 prep and the §21.3 "missing plan row" risk.
- **Report, part 2 (observed):** `business_os_entitlement_shadow_events` grouped by capability × surface × outcome × rule, with distinct accounts and hits, for a date window.
- Both parts are served by `GET /api/admin/business-os/entitlements/shadow-report`. The response holds account ids only and no business names, matching the llm-usage route's PII posture.

### 4.11 Plan-row provisioning and backfill (WC-21, §21.3 missing plan row)

- **Where:** DB triggers `AFTER INSERT` on `onboarding_conversations` **and** `business_profiles`, whichever comes first. Both use `ON CONFLICT DO NOTHING`. They cover all five profile-insert paths and any future ones without touching route code. Starting at the first onboarding message also means setup AI falls **inside** the trial window, which B-12 needs (see Q-B3).
- **Never fails onboarding:** the trigger body is wrapped in `EXCEPTION WHEN OTHERS → RAISE WARNING`. It is DEFINER with a pinned `search_path` and revoked EXECUTE (WC-9). A trigger function cannot be called through PostgREST RPC, but EXECUTE is revoked anyway.
- **Trial length stays in config:** the trigger writes `trial_started_at` only (`trial_ends_at` NULL). The resolver derives the end from `COHORTS.trial.durationDays` (AC-14). Side effect: changing the config trial length also moves the end date of **in-flight** derived trials. The B-3 launch migration writes explicit `trial_ends_at` values, which pins those accounts. SA item S-7: accept this, or materialise `trial_ends_at` on first resolve.
- **Backfill:** in the same migration. Rows are `origin = 'backfill_slice1'`. Slice 2's launch migration re-sets all non-champion trial windows at flag-flip time (§21.3, WC-21).
- **New pattern note:** Business OS already uses DB triggers widely (payments, purge analysis). A provisioning trigger that inserts into a table the user cannot write is covered by approved pattern 1 (the entitlements module). It is listed here for explicit SA acknowledgement (S-8).

### 4.12 Admin operations (T-7, FR-31/32, AC-6, WC-7)

**`GET /api/admin/business-os/entitlements/[accountId]`:** inspect. Returns the snapshot with the full trace (FR-10), the derived lifecycle with its dates, all overrides (including expired/ended), and `effectiveWithinSeconds`.

**`POST /api/admin/business-os/entitlements/[accountId]`:** one route with a Zod **discriminated union** on `op`. There is one audit path and no spreading of the body into writes:

| `op` | Body (Zod, all `.strict()`) | Effect (explicit allow-list) |
|---|---|---|
| `set_cohort` | `{ cohort: 'trial' \| 'champion' \| null, expiresAt?: ISO, reason }` | champion: `cohort`, `cohort_expires_at` (required, S-5), `period_anchor = now`. trial: `cohort`, `trial_started_at = now`, `trial_ends_at` optional |
| `set_expiry` | `{ field: 'trial_ends_at' \| 'cohort_expires_at' \| 'access_ends_at' \| 'grace_ends_at', value: ISO \| null, reason }` | That one column |
| `assign_tier` | `{ tier: TierId \| null, accessEndsAt?: ISO, reason }` | `tier`, `plan_version = TIER_MATRIX.version`, `period_anchor = now`, `access_ends_at` |
| `add_override` | `{ capability, op: 'set' \| 'add' \| 'revoke', value?, expiresAt?, reason }` | Insert. `value` is validated with **that capability's** shape schema. This also covers email blocking (B-7) and a per-account grandfather sunset. |
| `end_override` | `{ overrideId: uuid, reason }` | Sets `ended_at`, `ended_by_admin_id`, `ended_reason`. The override must belong to `accountId` (ownership pre-check). |

- `grant_ai_actions` is added in Slice 3.
- `TierId` and the cohort enums are **derived from config** (`z.enum(TIER_ORDER)`), so the route contains no tier literals.

**Order of checks** (copies llm-usage):
1. 401 if signed out.
2. 403 if `AdminAccessService.isAdmin` is false **or throws** (fail closed). `profiles.role` is never consulted, and a test shows `profiles.role = 'admin'` still gets 403.
3. 400 for a bad `accountId` UUID or body.
4. **Target pre-check** (tenant-isolation-guard): the plan row for `accountId` must exist, otherwise 404 `not_a_business_os_account`. For `end_override`, the override must be owned by that account.
5. Write through the repository.
6. `invalidate(accountId)`.
7. Audit.

**Audit (WC-7):** `auditTrail.log({ action: AUDIT_EVENTS.BOS_ENTITLEMENT_<OP>, userId: adminId, entityType: 'business_os_account', entityId: accountId, changes: { before, after }, severity: 'warning', request, details: { reason } }).catch(...)`, then `await auditTrail.flush().catch(...)` before responding. The override and plan rows also store `actor_admin_id`/`updated_by_admin_id`, `reason` and the timestamps, so the durable record does not depend on the audit queue.

**Self-service impossible (WC-8, FR-32):**
1. RLS gives users no write policy.
2. The repository write methods are imported **only** by the admin route. An import-graph test fails if any non-admin route or `'use client'` file imports them.
3. A route test sends `{ tier: 'pro', cohort: 'champion', plan_version: 99 }` to `PUT /api/business-os/business-profile` and `app/api/business-os/profile`, and asserts no entitlement repository call happens and no field changes.

The plan data lives in its own tables, so the fields cannot be reached by construction. The test keeps it that way.

### 4.13 Tests (WC-22, FR-8, AC-1 to AC-7)

| Test file | Asserts |
|---|---|
| `entitlements/__tests__/catalog.invariant.test.ts` | AC-1: every §5.3 capability is present with all §5.2 attributes. A client-send capability has a `messageClass`. Variant lists are non-empty and unique. |
| `…/tierMatrix.invariant.test.ts` | AC-2: every capability is assigned in every tier. Deleting **any single** value (generated loop over tier × capability, run against the Zod loader) is rejected. Unknown IDs and wrong shapes are rejected. Cohort/override capability IDs exist. |
| `…/chatActionMap.invariant.test.ts` | AC-3: every `SEMANTIC_CATALOG` entity × (find, compute, ActionDef key), plus `plan.for_each`/`plan.analyse`, is mapped. The map has no stale keys. It cross-checks the 107 plugin actions. Injecting an unmapped action fails. |
| `…/tierMatrix.snapshot.test.ts` + `tierMatrix.snapshot.json` | T-11/WC-19: fails if any value was **lowered** (by the variant/tier/number/addon order) with no `removals` entry at `version > snapshot.version`, or if `version` changed without the snapshot being updated. `grandfatherUntil: 'renewal'` is rejected. Update procedure: `npm run entitlements:snapshot` rewrites the snapshot, and the diff is reviewed in the PR. |
| `…/tierLiteral.forbidden.test.ts` + baseline | FR-12: no `'basic' \| 'growth' \| 'pro'` string literal in `lib/`, `app/`, `components/`, `hooks/` outside `lib/business-os/entitlements/config/`. The 13 existing unrelated hits are baselined per file with a count. A new hit fails. |
| `…/oneLineChange.test.ts` | AC-4: in a cloned config with growth `chat.search = true`, a Growth account resolves it as entitled. A structural diff of the two configs has exactly one leaf difference. |
| `…/resolver.test.ts` (injected clock) | AC-5: each layer overrides the one before it (1→1a→2→3→4). Overlay caps never raise. Override with expiry: active before, ignored after, shown in trace. `set`/`add`/`revoke` across all shapes. `beta` only via champion cohort or override. `not_built` never, even with an override. Grandfather active before sunset, gone after, ignored for trials. `plan_version = 0` handling. Anomalies deny owner-paid. Trace completeness. Purity: the same inputs give deep-equal output, and a spy shows no `Date` use. |
| `…/lifecycle.test.ts` (injected clock) | Every state and boundary: trial → grace → paused; champion expiry → 30-day grace; active with/without `access_ends_at`; `grace_ends_at` override; derived vs explicit `trial_ends_at`; a config trial-length change moves derived trials (AC-14). |
| `…/decide.test.ts` | Overlay table × surface kind (B-9/B-11 cells). T-3 mapping per audience on `unavailable`. `entitlement_unavailable` ≠ `not_entitled`. `lowestTier` correct. |
| `…/EntitlementService.test.ts` | Memo per call. 30 s TTL (fake timers). `invalidate`. Stale fallback used only on error. **Mode `off` means the repository is never called (WC-21).** Batch uses one call. |
| `…/shadow.test.ts` | A throwing repository, resolver or RPC never escapes (WC-21). Records both R-A and R-B. Deduplicates per request. No-op when `off`. |
| `…/imports.test.ts` | Dependency rules in §3. Admin-write repository methods imported only by admin routes. |
| `lib/repositories/__tests__/BusinessOsAccountPlanRepository.test.ts`, `…Shadow…` | One test per method (skill). Wrong user returns null. Allow-list: extra fields are dropped. Error path returns `{ data: null, error }`. |
| `app/api/admin/business-os/entitlements/[accountId]/__tests__/route.test.ts` | AC-6: 401, 403 (non-admin), **403 when `profiles.role = 'admin'` but not in `admin_users`**, 403 when the admin check throws, 400 bad UUID/body/capability shape, 404 non-Business-OS target, 404 foreign override on `end_override`. Happy path for each op writes allow-listed fields, then calls `invalidate`, `log` with before/after/reason, and **`flush` awaited**. Response has `effectiveWithinSeconds`. |
| `…/shadow-report/__tests__/route.test.ts` | Auth matrix as above. The report lists would-be denials by capability and surface (AC-7). The missing-plan-row count is present. |
| `app/api/business-os/{business-profile,profile}/__tests__/entitlementFields.test.ts` | WC-8: entitlement fields cannot be written through user-facing routes. |
| `lib/business-os/purge/__tests__/descriptors.invariant.test.ts` (existing) + `businessOwnedTables.test.ts` (existing) | Pass with the new tables classified `never` / person-owned. |
| SQL verification script `scripts/verify-bos-entitlements-migration.sql` (run by QA on a branch DB) | RLS on for all three tables. No user write policies. REVOKE in effect: `has_function_privilege('authenticated', …)` is false. A trigger failure does not fail the parent insert. Backfill count matches distinct Business OS users. |

The Slice 2 route-declaration test (WC-22c) and per-surface integration tests are planned in §5.

### 4.14 CI typecheck gate and test job (WC-2)

- **Option chosen:** extend the existing gate by adding `'lib/business-os/entitlements/'` to `SCOPED_DIRS` in `scripts/typecheck-bos-llm.ts`, rather than cloning a second 300-line script. The catalog-importer rule stays specific to the LLM catalog. For entitlements, the "direct callers" step (step 3) already brings in every file that imports the entitlements module, so admin routes and chat-v4 are covered. The script header and workflow name are renamed to "Business OS scoped type check". **SA item S-9:** if SA prefers `typecheck:bos-entitlements` as a separate script, the same `SCOPED_DIRS` logic is factored into a shared helper instead.
- **New workflow `.github/workflows/bos-entitlements.yml`:** runs on PRs to main, with no path filter, for the same reason as the llm gate. It runs `npx jest lib/business-os/entitlements lib/repositories/__tests__/BusinessOs app/api/admin/business-os/entitlements lib/business-os/purge/__tests__/descriptors.invariant.test.ts lib/business-os/__tests__/businessOwnedTables.test.ts --ci`. **Without this job, "fail in CI" (FR-7, §10.6) is not true today**, because no workflow runs `lib/**/__tests__`.

### 4.15 Slice 1 task list

- [ ] **S1-T0** SA reviews this workplan. Address its notes. Migration SQL approved by SA before it is written to the repo.
- [ ] **S1-T1** `types.ts`, plus `schema.ts` (shape-derived Zod builder).
- [ ] **S1-T2** `config/catalog.ts` with the full §4.4 list. Verify each `lifecycle` against the code and record the evidence in a comment. Mark B-1 placeholders.
- [ ] **S1-T3** `config/tierMatrix.ts` (example values from §5.3, (S) rows exact), `config/cohorts.ts`, `config/lifecycle.ts` (overlay table incl. B-11).
- [ ] **S1-T4** `config/chatActionMap.ts` + `capabilitiesForPlan` (R-A/R-B switch).
- [ ] **S1-T5** `source.ts` (`TierMatrixSource`, `CodeTierMatrixSource`, load-time Zod).
- [ ] **S1-T6** `lifecycle.ts`, `resolver.ts`, `decide.ts` (pure, injected clock).
- [ ] **S1-T7** Migration (§4.3): tables, RLS, shadow RPC, triggers, backfill. Plus `scripts/verify-bos-entitlements-migration.sql`. Apply to a branch or local DB only. Applying to prod is RM/user-gated.
- [ ] **S1-T8** Purge descriptors (three `never` rows with notes), `classification-baseline.json`, and `USER_OWNED_TABLES` entries with reasons.
- [ ] **S1-T9** Repositories (per the `new-repository` skill) and their unit tests. `supabaseServer` rationale comments.
- [ ] **S1-T10** `account.ts`, `mode.ts`, `EntitlementService.ts` (memo, TTL, failure policy, batch).
- [ ] **S1-T11** `shadow.ts`, `report.ts`, the one-line chat-v4 hook.
- [ ] **S1-T12** Admin routes (per the `new-api-route` skill, **admin gate via AdminAccessService, not the skill's `app_metadata.role` variation**), audit events in `lib/audit/events.ts`, route tests.
- [ ] **S1-T13** All §4.13 tests, including the forbidden-literal baseline and the matrix snapshot.
- [ ] **S1-T14** CI: extend the typecheck scope (and baseline if needed), plus the `bos-entitlements.yml` workflow.
- [ ] **S1-T15** *(B-12 input, read-only, can be cut if SA objects)* Add a "setup AI cost" section to the shadow report. For each account created in the last N days, count distinct Layer-1 action groups (`session_id`) in `token_usage` for the `business-os-onboarding`, `-website`, `-intake` areas during the first 14 days (median, p90, max). This gives real data to size the trial allowance with headroom before Slice 3. It reads through an existing or new usage repository method, not raw queries.
- [ ] **S1-T16** `docs/architecture/BUSINESS_OS_ENTITLEMENTS.md`: config-change procedure, removal procedure, staleness bound, flag, ops checks. Add a Key Documentation row in CLAUDE.md (TL/user approval, since CLAUDE.md is project config).
- [ ] **S1-T17** Hand to SA for code review, then QA.

### 4.16 Slice 1 exit criteria

1. AC-1 to AC-7 pass.
2. With `BOS_ENTITLEMENTS_MODE=off`, a test proves there are no entitlement reads or writes. **(WC-21)**
3. A test proves the shadow path cannot throw into a request. **(WC-21)**
4. A trigger-failure test proves onboarding and profile creation cannot fail because of plan-row creation. **(WC-21)**
5. On preview/prod with `shadow` on for about a week, the report shows real accounts' would-be denials, and the "tenants without a plan row" count is **0**.
6. Eyal's revised matrix, when it arrives, loads and validates. If it only changes values, it is a one-file PR.
7. The CI typecheck and entitlement test job are green on the PR.

---

## 5. Slice 2: Enforcement (outline)

A detailed addendum will be added to this workplan before Slice 2 starts.

| Area | Plan |
|---|---|
| **Prerequisite: T-8 (WC-17)** | **First PR of Slice 2, and it must merge before the flag flips.** `app/api/business-os/chat` and `chat-command` return 410 (and are deleted in a follow-up). The ungated V2/V4 comparison toggle in `ChatCommandPanel.tsx` is removed, and `chat-v2` returns 410. If comparison is still wanted, it is gated server-side by `AdminAccessService`. `chat-v2` is never mapped through the catalog. |
| Mode | `BOS_ENTITLEMENTS_MODE` gains `enforce`. Every surface is wired in `shadow` first. The flag flips only when the report shows no unexplained denials (§16 exit). |
| Route wrapper | `withEntitlement(capability \| { ungated: reason }, handler, { surfaceKind })` (approved pattern 2). It returns the structured `not_entitled` error `{ success:false, error:'not_entitled', capability, lowestTier }` (403), `entitlement_unavailable` (503), or `read_only` (409/423, SA to pick). The **route-declaration test** globs §10.2 + C-5 + C-6 (`app/api/business-os/**`, `crm`, `payments`, `website`, `intake`, `scheduling`, `email/sequences`, `email/enrollments`, `insights`, `smart-links`, `onboarding`, public APIs) and requires a declaration on every route (WC-22c). |
| Chat | Gate at **execution** time in `MutateExecutor`/`ForEachExecutor`, including the confirm turn and `saved-plans/[id]/run`. The per-turn snapshot is passed down, not re-resolved. Chat explains the refusal and runs no mutation (AC-9). |
| Crons (WC-13, `durable-queue-drain` skill) | Resolve once per claimed batch with `getSnapshots`. A suppressed row gets a terminal `suppressed` status plus `suppressed_reason`. It is never re-sent (B-11). A lookup failure **defers** (no status change). Each cron is declared gated (capability + message class + initiator) or `ungated`. Crons: payment-reminders, payment-retry, intake-reminders, lead-response, daily-briefing, insight-metrics/detect/automations, channel-metrics-sync, calendar-sync, abandoned-proposal-invoices. Status-column migrations are SA-gated. |
| Send registry | Every automated client send (gated or not: confirmations, receipts, intake requests, reminders) is declared with `messageClass` and `initiator` (B-9/B-11). An invariant test fails on an unclassified send (FR-8, FR-39). |
| Payment reminders (WC-14) | Check at schedule time in `BookingLifecycleService.scheduleInvoiceReminders` callers (cited by function, C-2) **and** at send time in `PaymentReminderService`. Send time is authoritative. |
| Branding (WC-15) | `FooterBlock`, template `Footer`, site booking page (`book/page.tsx` label), and every `PublicFooter`/`PublicShell` consumer (`app/book/manage/[token]/**`, `app/c/[userCode]/**`, `app/proposal/[token]`). A `branded` variant forces the footer on at **server render**, whatever `show_powered_by` says. The owner toggle is disabled in the website editor UI. |
| Public / paused (WC-16, B-11) | Owner resolved from subdomain/token server-side. `public_business` surfaces (site, new booking, `c/[userCode]`, contact, proposals, `go/[code]`) show the paused page, reusing `app/go/unavailable` / `PublicErrorScreen`. `public_self_service` surfaces (`app/invoice/[id]`, `api/public/invoice/[id]/pay`, `book/manage/[token]/**` cancel/reschedule) **stay live** in `paused`. Grace shows a warning banner. |
| Read-only | `owner_write` routes return `read_only` in grace/paused. Export stays allowed. |
| Grandfathering | Already resolved in Slice 1. Slice 2 adds the AC-28 integration test. |
| T-12 (WC-20) | `lib/server/access-strategy.ts` `license_tier` case: `db_active` precondition **and** `resolver` check of `definition.accessStrategy.capability`. `access-strategy.test.ts:82` is updated in the same change. No tier logic in the plugin manager. |
| **B-3 launch migration** | At flag-flip time, not at deploy (§21.3, WC-21). An admin sets champions first through the route. Then a one-off admin **route** op (not a script, per T-7), `launch_reset_trials`, sets `trial_started_at = now`, `trial_ends_at = now + config length`, `cohort='trial'` for every non-champion account without a tier, **including Slice-1-era signups**. It is audited, idempotent (guarded by a launch marker), and AC-26 is verified by the report's missing/anomaly counts. |
| Tests | Integration per surface type: happy path, not entitled, read-only, lookup failure (AC-8 to AC-16, AC-26 to AC-29). |

## 6. Slice 3: Metering (outline)

| Area | Plan |
|---|---|
| Inventory (FR-30, WC-18) | Build it from `BOS_LLM_CALLS` (8 areas). For each call name record: counts-as-AI-action (yes/no), audience, message class/initiator if it sends, template fallback. Embedding calls do not count. **B-12:** `onboarding`, first `website` generation and `intake`/services generation calls **count**. |
| Hook | `runAiAction` (one scope = one candidate AI action). Pre-check is a read (fail open, T-3(d)). The increment happens **after** the action and is non-blocking. A small overshoot is accepted (D-14). |
| Tables | `business_os_ai_action_usage (user_id, period_start, used)` and `business_os_ai_action_grants (source, qty, remaining, expires_at, actor_admin_id, reason)`. Both FK `auth.users`, registered `never` in purge descriptors, RLS owner-select only. |
| RPC (WC-9) | `business_os_consume_ai_action`: atomic; order is period allowance, then grants/boosts soonest-expiring first. SECURITY DEFINER only if INVOKER can't do it, and then REVOKE + service_role + pinned `search_path`. |
| Periods (T-6) | Derived from `period_anchor` with day clamping. The trial is one period holding the one-off total. No reset cron. |
| Degrade / pause (D-12) | Client-facing calls (mainly `LeadReplyRecommender`) use the template fallback. Owner-facing calls return `limit_reached` + pause, and chat explains. |
| Trial ends on allowance (FR-27) | Adds `trial_allowance_exhausted_at` (set by the consume RPC) to the lifecycle derivation. |
| **B-12 warnings** | Warnings at 80%/100% once per threshold per period (FR-26). **Plus a setup-specific warning:** before a setup regeneration (website regenerate, services/intake regenerate) runs, if the remaining trial allowance is below a configured multiple of that action's cost, the owner is warned first. Trial total is sized from S1-T15 data (typical setup plus headroom), and it is a config value. |
| Admin | `grant_ai_actions` op (D-7), audited, grant-ledger row. |
| Retire | `monthly_ai_allowance_usd` display. The usage card switches to AI actions (T-9(4)). `pricingConfig.ts` is only touched if needed (6 `console.*` calls, see §10). |
| Email fair use (B-7) | Count sends and alert the platform team (Pino `warn` + admin notification). Never block. Blocking only through an admin `revoke` override. |

## 7. Slice 4: Billing (outline)

Stripe prices by `lookup_key` in config (`bos_<tier>_<interval>_v<n>`, resolved and cached) (T-10). Subscription metadata `product: business_os`, and the existing credit webhook ignores those events. Webhooks write account state only: `tier`, `plan_version`, `period_anchor` = the Stripe cycle anchor, `access_ends_at`. Founder coupon at champion conversion. Boost checkout and optional auto top-up with a customer cap. Add-on purchase (creates the add-ons table, S-3). Renewal bumps `plan_version`, which ends `'renewal'` grandfathering. The loader then accepts `'renewal'`. `StripeService` has 2 `console.*` calls and `app/api/stripe/webhook/route.ts` has 168. If either is touched, flag it and convert it. The 168-call webhook conversion is large enough to ask the user whether to do it as a separate PR.

---

## 8. Rollout and Flag Plan

| Step | Env | `BOS_ENTITLEMENTS_MODE` | Gate |
|---|---|---|---|
| 1. Slice 1 merged | all | `off` (default) | SA ✅, QA ✅, user approval. Migration applied by RM/user (it includes the backfill). |
| 2. Verify provisioning | prod | `off` | Report ops check: tenants without a plan row = 0. The trigger WARNING count in DB logs = 0. |
| 3. Shadow on | preview, then prod | `shadow` | Env change + redeploy. Watch the Pino error rate from `shadow.ts` (should be 0) and the latency of chat-v4 (hook is not awaited). |
| 4. Report review | prod | `shadow` | About one week of data. Business decides Q-B1 (chat reads) using the R-A vs R-B numbers. S1-T15 data sizes the trial allowance. |
| 5. Slice 2 merged | all | `shadow` | All surfaces wired in shadow. T-8 retirement merged. |
| 6. Launch | prod | admin sets champions, then `launch_reset_trials`, then `enforce` | The report shows no unexplained denials. User approval in session. |
| Rollback | any | set `off` + redeploy | No data migration needs to be reversed. The tables stay (never purged). |

---

## 9. WC Traceability

| WC | How it is met | Task(s) |
|---|---|---|
| WC-1 | Branch `feature/business-os-entitlements` from `origin/main` 94f9cfcd | Header |
| WC-2 | T-1 typed data-only modules + mapped types + `TierMatrixSource` + Zod at load. Entitlements folder added to the scoped typecheck gate. New CI job runs the invariants. | S1-T1..T5, S1-T14, §4.14 |
| WC-3 | Owner `user_id` behind `resolveAccountId`. `business_os_*` tables FK `auth.users(id)`, not `business_profiles`. `never` purge descriptors + `USER_OWNED_TABLES`. | S1-T7, S1-T8, S1-T10, §4.3 |
| WC-4 | New repositories only, `.eq('user_id', …)`, documented `supabaseServer` | S1-T9 |
| WC-5 | Zod on admin inputs, matrix/cohort/lifecycle at load, and the report query. Slice 2 public/cron inputs. | S1-T5, S1-T12, §5 |
| WC-6 | `createLogger` everywhere. Correlation IDs on routes. Structured logs for every would-be/actual outcome. `console.*` files flagged (§10). | S1-T10..T12, §10 |
| WC-7 | AdminAccessService gate (profiles.role → 403 test), Zod, allow-list, target pre-check, `log().catch()` + `await flush().catch()`. Rows store actor/reason/timestamps. | S1-T12, §4.12 |
| WC-8 | RLS owner-select only (none on shadow). No user write policies. User-facing profile route test. | S1-T7, S1-T13 |
| WC-9 | Trigger functions: DEFINER, pinned `search_path`, REVOKE. Shadow RPC: INVOKER + REVOKE + service_role. Slice 3 consume RPC follows the same rules. | S1-T7, §6 |
| WC-10 | `decide` maps failure by catalog audience/class. `entitlement_unavailable` ≠ `not_entitled`. | S1-T6, S1-T10 |
| WC-11 | Per-request memo + 30 s TTL. Counters never cached. Bound documented in the module header + admin response. | S1-T10, S1-T12, S1-T16 |
| WC-12 | `deriveLifecycle` from timestamps. No state cron. `check-free-tier-expiration` untouched and unscheduled. | S1-T6 |
| WC-13 | Cron suppression terminal status, defer on failure, batch resolve, per-cron declarations | §5 (Slice 2) |
| WC-14 | Schedule-time + send-time checks, send-time authoritative | §5 (Slice 2) |
| WC-15 | All footer consumers incl. PublicFooter/PublicShell. Server-side override at render. | §5 (Slice 2) |
| WC-16 | C-5 surface list. Paused page reuses `app/go/unavailable`. B-11 self-service stays live. | §4.6 overlay (S1), §5 |
| WC-17 | Retire `chat`, `chat-command`, remove `chat-v2` toggle + route before flag flip | §5 prerequisite, §8 step 5 |
| WC-18 | Metering via `runAiAction`. Inventory from `BOS_LLM_CALLS`. Embeddings excluded. Atomic soonest-expiring consumption. | §6 (Slice 3) |
| WC-19 | Matrix `version` + `removals` + snapshot test. `'renewal'` rejected at load. | S1-T3, S1-T5, S1-T13 |
| WC-20 | `license_tier` via resolver, `access-strategy.test.ts` updated | §5 (Slice 2) |
| WC-21 | Flag off = no reads (test). Shadow cannot throw (test). Trigger cannot fail onboarding (test). Launch migration resets trials at flip time. | S1-T10, S1-T11, S1-T7, S1-T13, §5, §8 |
| WC-22 | FR-8 invariants, forbidden literal, snapshot, resolver with injected clock (S1). Route-declaration + per-surface integration (S2). Admin route 401/403 (incl. profiles.role)/400. | S1-T13, §5 |

---

## 10. console.* Files in the Touch Set

Counted on `origin/main` 94f9cfcd. Per CLAUDE.md, each touched file with `console.*` is flagged and, with user approval, converted in the same slice.

| File | `console.*` count | Slice that touches it | Proposal |
|---|---|---|---|
| All Slice 1 modified files (`chat-v4/route.ts`, `lib/audit/events.ts`, `lib/repositories/{types,index}.ts`, `purge/descriptors.ts`, `businessOwnedTables.ts`) | 0 | 1 | Nothing to convert |
| `scripts/typecheck-bos-llm.ts` | uses `console.error` for CLI output | 1 | Out of scope. It is a CLI script outside `lib/`/`app/`/`components/`, where stdout is the interface. |
| `app/site/[subdomain]/book/page.tsx` | 1 | 2 | Convert when touched for branding |
| `lib/utils/pricingConfig.ts` | 6 | 3 (only if touched) | Convert when touched |
| `lib/stripe/StripeService.ts` | 2 | 4 | Convert when touched |
| `app/api/stripe/webhook/route.ts` | 168 | 4 (only if namespacing touches it) | Propose a separate conversion PR (size) |
| `lib/services/CreditService.ts` | 20 | Not planned (B-8 keeps it separate) | Only if touched |
| `QuotaAllocationService.ts`, `check-free-tier-expiration` | non-compliant (C-9, C-11) | Not planned | Not touched (T-9) |

All other Slice 2 candidates checked (the cron routes, `BookingLifecycleService`, `PaymentReminderService`, `ChatCommandPanel`, footers, public pages, legacy chat routes, profile routes) have 0.

---

## 11. Risks

| # | Risk | Likelihood / impact | Mitigation |
|---|---|---|---|
| R-1 | The shadow hook adds latency or errors to chat-v4 | Low / Med | Not awaited. No-op when `off`. Try/catch. One memoised read. Watch p95 in step 3. |
| R-2 | The trigger breaks onboarding (e.g. RLS/privilege or FK race) | Low / High | DEFINER, `EXCEPTION → WARNING`. Tested with an unwritable target. `ON CONFLICT DO NOTHING`. `auth.users` FK always holds for a signed-in user. |
| R-3 | A new table isn't recognised by the purge RPC's live-schema check, so Reset fails closed | Med / Low (Reset inert today) | Migration + descriptors + `USER_OWNED_TABLES` in one PR. The invariant tests force it. |
| R-4 | Config trial length change silently moves in-flight trials | Med / Low | Documented (S-7). The launch migration writes explicit dates. |
| R-5 | The chat read rule (Q-B1) cuts Basic chat to near-useless, or makes `chat.search` meaningless | Med / Med (commercial) | Report both rules in shadow. Business decides with numbers before Slice 2. |
| R-6 | "Fails in CI" is untrue today (no Jest CI for `lib/`) | Certain unless fixed / High | New `bos-entitlements.yml` job (S1-T14). |
| R-7 | Type-level exhaustiveness is ignored by the Next build | Certain / Med | Zod at load + invariant tests + scoped typecheck gate. |
| R-8 | Cross-instance staleness after an admin write | Certain / Low | 30 s bound, documented, stated in the response. Local invalidation. |
| R-9 | Backfill picks up users who only ever opened onboarding once | Med / Low | Harmless. They get a trial row. `origin` records it. The launch migration re-sets anyway. |
| R-10 | `new-api-route` skill admin variation (`app_metadata.role`) misleads future work | Med / Med (security) | Not followed here. Flagged to TL/SA to fix the skill. |
| R-11 | `PaymentReminderService.sendEmailReminder` is a stub, so `payments.reminders` is commercially meaningless | Certain / Med | Out of scope (§16 dependency). Called out again before Slice 2 launch. |
| R-12 | The live Supabase service-role key is exposed (see memory: environments P0) | — / High | Not this module's fix, but every "service-role only" guarantee here assumes the key is private. Flagged to TL as a precondition for enforcement launch. |

---

## 12. Open Questions

### 12.1 Business decisions (for the user, in business terms)

| # | Question | Why it matters | Dev default until decided |
|---|---|---|---|
| **Q-B1** | What does "search via chat" (Pro-only in the sheet) mean? (a) Basic owners can still ask chat about the areas their plan includes, e.g. "what's on my calendar tomorrow?", and "search" means only broader lookups. (b) Any chat question that just looks something up (not a change) needs the search feature, so Basic chat can mostly only *do* things, not *answer* things. | Decides how useful chat is on Basic. We will show you the numbers for both from the shadow report before anything is enforced. | (a) |
| **Q-B2** | Should design partners (champions) get Growth-level features plus beta, or everything in Pro plus beta? | Sets what champions have during their free period. Conversion still lands them on Growth with the founder coupon. | Growth + beta |
| **Q-B3** | Does the 14-day trial clock start when someone begins setting up their business (first onboarding message), or when setup finishes? | Setup AI counts against the trial (B-12). If the clock starts at setup completion, slow setups get extra days. If it starts at the first message, the trial covers setup. | First onboarding message |
| **Q-B4** | When an account is paused after grace, should clients who already booked still receive the intake questionnaire for that booking? B-11 keeps payment and cancel/reschedule working and stops reminders, but it doesn't mention intake requests. | A client may turn up without the business having their intake answers. | Stop (treated like a reminder) |

B-1 (the five ambiguous rows) stays with Eyal. It does not block Slice 1.

### 12.2 Items for SA (technical, decided at workplan review)

| # | Item |
|---|---|
| S-1 | Add audience `'client_render'` (branding) so message class applies only to sends. Per-send `initiator` attribute in the Slice 2 send registry for B-11. |
| S-2 | Chat action map key space includes read/compute/analyse/for_each ops. `agents`/`agent_runs` reads are `ungated` (B-8). Confirm. |
| S-3 | Defer the add-ons table to Slice 4 (the resolver takes `addons: []` input and is tested with fixtures). |
| S-4 | `plan_version = 0` sentinel from the SQL trigger resolves to the current version for tierless accounts, keeping the matrix version out of SQL. |
| S-5 | Require `expiresAt` when setting the champion cohort. A champion with no expiry is an anomaly-warning using `defaultDurationDays`. |
| S-6 | Cache the **inputs** for 30 s and resolve per call with `now` (refines T-5, avoids stale lifecycle across boundaries). Stale inputs kept up to 10 min **only** as the T-3 fallback. |
| S-7 | Derived `trial_ends_at` (from config) vs materialising it on first resolve. |
| S-8 | Provisioning triggers on `onboarding_conversations` + `business_profiles` (DEFINER, never raises) instead of code hooks on the five profile-insert paths. Acknowledge as within approved pattern 1. |
| S-9 | Extend `typecheck:bos-llm`'s `SCOPED_DIRS` (renamed "Business OS scoped type check") vs a separate `typecheck:bos-entitlements`. New Jest CI workflow for the invariants. |
| S-10 | Single POST admin route with a discriminated `op` union vs one route per op. |
| S-11 | Slice 2 HTTP status for `read_only` (409 vs 423) and whether `not_entitled` is 403 or 402. |
| S-12 | `new-api-route` skill's `app_metadata.role` admin variation contradicts CLAUDE.md. Fix the skill (outside this feature). |

---

## 13. SA Review Notes

_SA to populate._

## 14. QA Testing Report

_QA to populate._

## 15. Commit Info

_RM to populate._

---

## Change History

| Date | Change | Details |
|------|--------|---------|
| 2026-09-19 | Initial workplan (Dev) | Branch `feature/business-os-entitlements` from `origin/main` 94f9cfcd. Slice 1 in full detail (catalog, matrix, cohorts, lifecycle overlay, chat action map, loader, pure resolver, plan rows + triggers + backfill, admin routes, shadow report, tests, CI gate). Slices 2 to 4 outlined. B-11 and B-12 treated as authoritative. WC-1 to WC-22 traced. 4 business questions, 12 SA items. |
