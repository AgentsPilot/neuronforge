# Workplan: Business OS Subscription & Entitlements Module

> **Last Updated**: 2026-09-22

**Developer:** Dev
**Requirement:** [BUSINESS_OS_SUBSCRIPTION_ENTITLEMENTS_REQUIREMENT.md](/docs/requirements/BUSINESS_OS_SUBSCRIPTION_ENTITLEMENTS_REQUIREMENT.md), committed on this branch (`df5cc116`), including B-13 to B-15, FR-43 to FR-45, AC-36/AC-37, the pending items P-1/P-2, and §21 SA Review with WC-1 to WC-22.
**Date:** 2026-09-19, revised 2026-09-21
**Status:** **Rev 3** — revised for the merge of `main` into this branch (`92580639`), the **user-approved component breakdown** (§4.0), and **three user-confirmed additions** (§1.5: tier expiry, the three-step decision contract, the plan-state reset op). Rev 2 was **SA-cleared for Slice 1 implementation** with conditions R2-1 to R2-4 (§13.1), which are folded into the tasks here. **Waiting for the SA re-check listed in §0** before implementation starts. No implementation code has been written.
**Branch:** `feature/business-os-entitlements`, created from `origin/main` at `94f9cfcd` (WC-1), with `main` merged in at `92580639` (2026-09-21). Dev created the branch on TL's instruction. The Dev role normally leaves branch creation to RM, and this deviation is recorded here for RM.

## Overview

Business OS has no commercial gating today. This workplan builds the **infrastructure** for subscriptions and entitlements in the four slices of the requirement (§16): a capability catalog, a tier-matrix *mechanism*, cohorts, a pure resolver with a three-step decision contract, per-account plan rows, admin operations, and a shadow-mode usage and "what would be gated" report. Under the user's scope change, **production config ships with no commercial tiers**. Eyal's example matrix exists only as a test fixture. Champions get every capability, and every existing account becomes a champion at rollout. Slice 1 is planned in full, ships as **five separate PRs** (§4.0), sits behind a server-only flag, and changes nothing customers see. Slices 2 to 4 (enforcement, metering, billing) are outlined, and each gets an SA-reviewed addendum that restates its WCs as tasks and tests (G-3). Every WC, RC and addition is traced in §9.

---

## Table of Contents

0. [Revisions: What Changed and What SA Re-checks](#0-revisions-what-changed-and-what-sa-re-checks)
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

## 0. Revisions: What Changed and What SA Re-checks

### 0.1 Revision 3 (2026-09-21) — merge of `main`, component breakdown, three additions

| Section | Change | Driven by |
|---|---|---|
| §1.5, §9.3 | Three user-confirmed additions: **A-1** tier expiry, **A-2** three-step decision contract, **A-3** plan-state reset op | User, 2026-09-21 |
| **§4.0 (new)** | **The user-approved component breakdown: five PRs for Slice 1**, and the per-component delivery flow (Dev → SA → QA → **user reviews the code** → RM commits) | User |
| §2 | Re-verified against the **new main**: `requireAdmin` is the canonical admin gate; the admin-authz guard (R1–R6) is a **required status check**; CI now has build / admin-authz-guard / react-hooks-guard / plugin-tests / bos-llm-typecheck; `boost-packs` is fixed; the `new-api-route` skill is fixed; `npm test` exists; flag readers must be named `is…Enabled` | Merge `92580639` |
| §3, §4.2, §4.12 | Admin routes use **`requireAdmin` as the first statement** and never import `AdminAccessService` (guard R2). Balance seam file added. Launch route is in Slice 1 (R2-1). | New main, R2-1 |
| **§4.3** | `access_ends_at` renamed **`tier_expires_at`** (NULL = no end date) — A-1. `REVOKE` follows the `20260920a` named-privilege convention. New `business_os_reset_plan_state` RPC — A-3. | A-1, A-3, new main |
| **§4.8** | **Explicit expired-tier fallback semantics** (A-1) and the **three-step decision contract** with a stubbed balance seam (A-2) | A-1, A-2 |
| §4.9 | `EntitlementService.check()` is the one call that runs the three steps in order, with the balance seam injected | A-2 |
| §4.10 | The report's "no end date" list covers **both** open-ended champions **and** open-ended tier assignments | A-1 |
| **§4.12** | `assign_tier` takes a required `expiresAt` key (date or explicit `null`); `set_expiry` field list updated; new **`reset_plan_state`** op; `ensure_plan_row` requires an explicit cohort (R2-2); `would_leave_no_basis` 409 (R2-3); `launch_champion_existing` dry run (R2-1) | A-1, A-3, R2-1..R2-3 |
| §4.13–§4.16 | Tests and tasks for A-1 to A-3 and R2-1 to R2-4. Send-id seed in production config (R2-4). | A-1..3, R2-1..4 |
| §4.14, §8, §1.3 | CI re-checked against the new workflows: **reuse** build / admin-authz-guard / bos-llm-typecheck; one new Jest job. **G-2 rewritten**: `main` now requires `Admin authz surface guard`; the others must be added before `enforce`. | New main |
| §11, §12 | New risks for the reset op and the guard. **S-12 is closed** (fixed on main, `a2a145ae`). | New main, A-3 |

**SA re-check list for rev 3:** **§4.0** (component split), **§4.3** (the renamed column and the reset RPC), **§4.8** (expired-tier fallback + the three-step contract), **§4.9** (the `check()` API and balance seam), **§4.12** (the new op and the changed op signatures), **§4.14/§1.3 G-2** (CI reuse and required checks), and **§2** (the re-verified facts). Everything else is unchanged from the rev 2 that SA cleared in §13.1.

### 0.2 Revision 2 (2026-09-19) — scope change and RC-1 to RC-17

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
| B-13 to B-15, FR-43 to FR-45, AC-36/AC-37, P-1, P-2 | The BA's requirement update for the scope change. P-1 (trial contents, including beta) and P-2 (open-ended champions at switch-on) are still pending with the user, and both are single config or launch-step values. |
| S-1 to S-12, RC-1 to RC-17, G-1 to G-3 | SA workplan review (§13). All applied. **S-12 is now closed:** the `new-api-route` skill was fixed on `main` (`a2a145ae`). |
| R2-1 to R2-4 | SA re-check conditions (§13.1), applied during implementation and folded into the §4.15 tasks. |
| A-1 to A-3 (§1.5) | Three user-confirmed additions of 2026-09-21. |

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
| **G-2** | **Re-checked 2026-09-21 against the live setting.** `main` now has branch protection with `enforce_admins: true` and exactly **one** required status check: **`Admin authz surface guard`**. Our admin routes are therefore gated by a real merge blocker from day one. Before `enforce`, these must also be required checks: **`Build (next build)`**, **`Type check (Business OS LLM attribution)`** (which will then cover the entitlements folder, §4.14) and the new **`Business OS entitlements invariants`**. Adding them is a repository setting, done by the user or a repository admin, and each check must have run at least once before GitHub offers its name. |
| **G-3** | Every later-slice addendum restates its WCs as **concrete tasks and tests**. An outline row is not enough at addendum stage. |

### 1.4 Delivery flow (set by the user, 2026-09-21)

Slice 1 ships as the **five components in §4.0**, each its own PR that the user approves. For **every** component: **Dev implements → SA code review → QA → the user reviews the code → RM commits.**

**Dev does not commit implementation code.** Implementation is left in the working tree for review, and RM commits it after the user's approval. Workplan and documentation commits are the exception and are made by Dev as usual.

### 1.5 User-confirmed additions (2026-09-21)

| # | Addition | Where applied |
|---|---|---|
| **A-1** | **A tier assignment gets its own expiry**, `tier_expires_at`, mirroring `cohort_expires_at`. `NULL` means "no end date", that is, forever. An expired tier assignment falls back explicitly (§4.8). The admin and shadow reports list **every** account with no end date — open-ended champions **and** open-ended tier assignments — so free access is always visible. | Component 1 (§4.3) + component 3 (§4.8), report §4.10, admin ops §4.12 |
| **A-2** | **A three-step decision contract in the resolver.** One call answers, in this order: (a) the capability is not in the account's entitlements → `not_entitled`; (b) the account's state is not active (trial expired, grace, paused) → `read_only`; (c) the AI-action balance is insufficient → `limit_reached`, carrying the B-9/B-11 degrade semantics (client-facing sends fall back to template text, owner-facing AI pauses). The balance check is a **seam that always answers "sufficient"** until Slice 3 metering implements it, so **no call site changes when Slice 3 lands**. `entitlement_unavailable` stays distinct per T-3. | Component 3 (§4.8, §4.9) |
| **A-3** | **A new admin op that wipes and recreates an account's plan state:** delete the plan row and its override/history rows, then recreate the plan row with an **explicitly chosen** cohort — never a silent default. It exists because the customer-facing Reset and Purge must never touch these tables (the trial-reset loophole), yet an admin still needs a genuine start-over. It satisfies R2-3 (never leaves an account with neither plan nor cohort), is audited with actor and reason, and is guarded. | Component 5 (§4.12), with its RPC in component 1 (§4.3) |

---

## 2. Analysis Summary (re-verified 2026-09-21 on the merged branch)

Every row below was re-checked against the tree after `main` was merged in (`92580639`). Rows whose finding **changed** are marked **NEW**.

| Area | Finding | Impact on the plan |
|---|---|---|
| Entitlement code | Still none. `lib/business-os/entitlements/` does not exist, and no table uses a `business_os_` prefix. | Greenfield folder and tables. |
| Chat action surface | `business-os-plugin-v2.json` still has **107** actions. Plan ops are `find`, `compute`, `mutate`, `for_each`, `analyse`. | The FR-6 map covers read/compute/analyse/for_each as well as mutate actions (§4.5). |
| Chat execution | **NEW line numbers:** `chat-v4/route.ts` gets the plan from `getBizQLPlanner().plan(...)` at **~L860** (was ~L777) and runs `executeForEach` at ~L1126. Cite the call, not the line. | Slice 1: one shadow hook after planning. Slice 2: gate at execution time, including the confirm turn. |
| Tenant provisioning | `business_profiles` is inserted or upserted from **six sites across five modules** (`BusinessProfileRepository.create`/`.upsert`, `setup-status` route, `scheduling/availability` route, `AvailabilityService`, `ChatCommandExecutor`). `onboarding_conversations` is still written before the profile. Both parent tables still have a user INSERT RLS policy. | DB triggers, hardened per S-8 (§4.11). A code hook would still miss paths. |
| Purge classification | Unchanged: descriptors + `classification-baseline.json`, the `businessOwnedTables` migration-parsing test, and `purge_schema_introspect`. | All three new tables classified `never` / person-owned in the **same PR** as the migration (WC-3). |
| **Admin gate** | **NEW and binding.** `lib/admin/requireAdminRoute.ts` now exists. **`requireAdmin(requestLogger)` is the canonical gate and must be the first statement in every `/api/admin` handler**, before any body parse, DB read or outbound call. It owns the 401/403 split and fails closed. | §4.12 rewritten: our routes call `requireAdmin` and **must not** import `AdminAccessService`. The inline llm-usage precedent is no longer the pattern to copy. |
| **Admin authz CI guard** | **NEW.** `lib/admin/__tests__/admin-authz-surface.guard.test.ts` + `.github/workflows/admin-authz-guard.yml` enforce R1 (every `/api/admin` handler calls `requireAdmin`), R2 (**no `route.ts` imports `AdminAccessService`**), R3, R4 (no access decision keyed on a `role` value), R5 (**no migration adds an RLS policy referencing `profiles.role`**), R6. Exemption caps are asserted by equality, so we must add **zero** exemptions. | Our routes satisfy R1/R2 by using `requireAdmin`; our resolver decides on capabilities and cohorts, never a `role` value (R4); our migration adds **no policy at all**, so R5 is satisfied (§4.3). A task verifies `npm run test:authz-guard` is green. |
| **`boost-packs`** | **NEW: fixed on main** — it now uses `requireAdmin` in all four handlers. The rev 2 note calling it an unauthenticated example is withdrawn. | No longer cited as a counter-example. |
| **`new-api-route` skill** | **NEW: fixed on main** (`a2a145ae`). It now documents `requireAdmin`, says never to check a role field, and requires the gate to be the first statement. The merge conflict on this file was resolved to main's version. | The skill is now safe to follow as written. **S-12 is closed** (§12.3). |
| Tenant check repos | `BusinessProfileRepository.findByUserId` and `OnboardingConversationRepository.getLatestMessageAt` exist. | RC-10 pre-check reuses them. `ensure_plan_row` still needs `getFirstMessageAt(userId)` added to the existing repository, with a unit test. |
| Audit | `AuditTrailService.flush()` exists. `AUDIT_EVENTS` + registry live in `lib/audit/events.ts`. | New `BOS_ENTITLEMENT_*` events. WC-7 log-then-flush. |
| **CI** | **NEW:** five workflows — `build.yml` (**Build (next build)**), `admin-authz-guard.yml` (**Admin authz surface guard**), `react-hooks-guard.yml` (**React hooks rules guard**), `plugin-tests.yml`, `bos-llm-typecheck.yml` (**Type check (Business OS LLM attribution)**). `npm test` now runs the full Jest suite. **Still no workflow runs our `lib/**/__tests__` suites**, and the repo convention is one guard = one workflow with a shared `non-deploying-change.sh` scope step. | §4.14 rewritten: **reuse** build (module-scope crashes), the admin guard and the bos-llm typecheck (extended to our folder). Add **one** new Jest job for the entitlement invariants — not a duplicate of anything existing. |
| **Branch protection** | **NEW:** `main` has protection with `enforce_admins: true` and exactly one required check, **`Admin authz surface guard`**. | G-2 rewritten (§1.3). Our admin routes are gated by a real merge blocker immediately. |
| **SQL admin predicate + grant convention** | **NEW:** `supabase/migrations/20260920a_lock_system_settings_and_pricing_rls.sql` adds `public.is_platform_admin()` (SECURITY DEFINER over `admin_users`, pinned `search_path`) and uses **named-privilege** revokes (`REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER … FROM anon, authenticated`) plus an optional admin SELECT policy. | §4.3 follows the named-privilege revoke convention. We still add **no** policies (RC-8); `is_platform_admin()` is noted as the option if SA ever wants direct admin reads. |
| Service-role RPC convention | `20260929_usage_summary.sql`: INVOKER + REVOKE + GRANT service_role. | The shadow RPC and the A-3 reset RPC follow it. Trigger functions are the only DEFINER code. |
| Tier-name literals | Still **13** unrelated existing hits in `lib`/`app`/`components`/`hooks`. | Forbidden-literal test with a baseline. Deny list = `{'basic','growth','pro'} ∪ TIER_ORDER` (RC-1). |
| **Feature-flag naming** | **NEW convention on main:** flag readers must be named `is…Enabled`, never `use…`, and `npm run lint:hooks` enforces it. | `mode.ts` exports `getEntitlementsMode()` / `isEntitlementsShadowEnabled()`. No `use` prefix anywhere in this module. |
| Legacy chat (T-8) | `ChatCommandPanel.tsx` still calls `/api/business-os/chat-v2`. `chat` and `chat-command` still have no in-repo caller. | Retired in the first Slice 2 PR. |
| LLM foundations | `callCatalog.ts`, `aiActionAudit.ts` (`runAiAction`) and the investigation doc are present. | Slice 3 (WC-18). S1-T15 setup-cost estimate. |
| `console.*` counts | Re-counted: `pricingConfig.ts` 6, `app/site/[subdomain]/book/page.tsx` 1, `stripe/webhook/route.ts` 168, `StripeService.ts` 2. Every Slice 1 file in the touch set is still 0. | §10 unchanged. |
| Testing tooling | **NEW:** CLAUDE.md now records that **E2E/Playwright is not set up**. | The NFR's "Playwright journey" becomes a QA manual check in the Slice 2/4 addenda, with Jest guards where they fit. |

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
  decide.ts                    decide(snapshot, capability, request, balance) — the 3-step contract (A-2), pure
  balance.ts                   AiActionBalanceSource seam + AlwaysSufficientBalance (stub until Slice 3) (A-2)
  mode.ts                      getEntitlementsMode() / isEntitlementsShadowEnabled(); imports NOTHING from config/schema (RC-7)
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
app/api/admin/business-os/entitlements/     ← every handler: requireAdmin(...) as the FIRST statement
  accounts/[accountId]/route.ts   GET inspect + POST single-account ops incl. reset_plan_state (S-10, A-3)
  shadow-report/route.ts          GET report
  launch/route.ts                 launch_champion_existing: built + dry-runnable in Slice 1 (R2-1), executed at switch-on
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
- **No `route.ts` in this module imports `AdminAccessService`** (admin-authz guard R2). The gate is `requireAdmin` from `lib/admin/requireAdminRoute`.
- No exported function in this module is named `use…` (the repo's flag-naming rule, enforced by `npm run lint:hooks`).

---

## 4. Slice 1: Catalog, Config, Resolver, Plan Row, Admin Ops, Shadow Report (full detail)

### 4.0 Component breakdown — the PR sequence the user approved

Slice 1 ships as five components. **Each is its own PR that the user approves**, and each follows §1.4's flow: Dev implements → SA code review → QA → **the user reviews the code** → RM commits. Dev leaves implementation in the working tree and does not commit it.

| # | Component | Contents | Depends on | Detail |
|---|---|---|---|---|
| **1** | **Plan records + migration** | The three `business_os_*` tables (incl. `tier_expires_at`, A-1), RLS and revokes, the fact-recording triggers, the champion backfill, the shadow RPC, the A-3 reset RPC, the two repositories, purge descriptors + `USER_OWNED_TABLES` + baseline, `getFirstMessageAt`, the migration verification script | — | §4.3, §4.9 repo part, §4.11 |
| **2** | **Capability catalog + config + validation + CI gate** | `types.ts`, `schema.ts`, `config/*` (catalog, empty tier matrix, cohorts, lifecycle + send-id seed, chat action map, launch), the fixture matrix and fixture source, `source.ts`, every invariant test (catalog, matrix, chat map, snapshot, forbidden literal, production-config load), the `SCOPED_DIRS` extension and the new Jest workflow | 1 (only for types it shares; can be reviewed in parallel) | §4.4–§4.7, §4.13, §4.14 |
| **3** | **Resolver incl. the three-step contract** | `account.ts`, `lifecycle.ts`, `resolver.ts`, `decide.ts` (A-2), `balance.ts` (stub seam), `mode.ts`, `EntitlementService.ts` (memo, TTL, LRU, failure policy, batching, `check()`), plus their tests with an injected clock | 1, 2 | §4.8, §4.9 |
| **4** | **Shadow mode + report** | `shadow.ts` (lazy imports), `report.ts` (static, observed, `asTier`, no-end-date list, setup-AI cost), the one-line chat-v4 hook, the `shadow-report` admin route | 1, 2, 3 | §4.10 |
| **5** | **Admin ops + docs** | `accounts/[accountId]` GET/POST (all ops incl. `ensure_plan_row`, `reset_plan_state`), the `launch` route with `dryRun` (R2-1), audit events, route tests, `BUSINESS_OS_ENTITLEMENTS.md`, `.env.example` | 1, 2, 3 (4 for the report link) | §4.12, S1-T16 |

Each component PR is self-contained: it compiles, its tests pass, and it changes no customer behaviour. Components 1 to 3 are invisible at runtime because nothing calls them until component 4 adds the (flag-gated) hook.

### 4.1 Scope and non-goals

**In scope:** FR-1, FR-2, FR-5 to FR-13 as **mechanism**; FR-3/FR-4 as mechanism proven on the fixture (U-1); FR-14's build-and-dry-run part (R2-1); FR-22; FR-31/32 (Slice-1 admin ops); FR-34 to FR-39, FR-43 to FR-45 as config and resolver semantics; AC-1 to AC-7, AC-36/AC-37, with AC-2/4/7 proven on the fixture (RC-1, RC-6); the Slice-1 parts of WC-21; **additions A-1, A-2 and A-3** (§1.5).

**Not in Slice 1:** commercial tier contents (U-1); blocking anything; route, cron and public-page hooks (Slice 2); **executing** `launch_champion_existing` (built and dry-runnable now per R2-1, executed at switch-on); the add-ons table (Slice 4, S-3); the grants/usage tables and the real balance source (Slice 3 — the A-2 seam always answers "sufficient" until then); `license_tier` (Slice 2); usage card and `monthly_ai_allowance_usd` (Slice 3); T-8 retirement (Slice 2).

**Zero-behaviour guarantee (WC-21, SA-accepted).** With `BOS_ENTITLEMENTS_MODE=off`, the only production effects are:
1. The migration and backfill.
2. The two AFTER INSERT triggers, which never raise and are bounded by `lock_timeout`.

In addition:
- There are no entitlement reads or shadow writes, and a test proves it.
- The chat-v4 hook returns synchronously, and config is never loaded (RC-7).
- The shadow path cannot throw.
- No customer-visible route, page or cron changes.

### 4.2 Files to create / modify

| File | Action | Component | Reason |
|---|---|---|---|
| `lib/business-os/entitlements/config/{catalog,tierMatrix,cohorts,lifecycle,chatActionMap,launch}.ts` | create | 2 | §4.4–§4.6 |
| `lib/business-os/entitlements/{types,schema,source}.ts` | create | 2 | §4.7 |
| `lib/business-os/entitlements/{account,lifecycle,resolver,decide,balance,mode,EntitlementService,index}.ts` | create | 3 | §4.8, §4.9. `balance.ts` is the A-2 seam. |
| `lib/business-os/entitlements/{shadow,report}.ts` | create | 4 | §4.10 |
| `lib/business-os/entitlements/__tests__/fixtures/{exampleTierMatrix,fixtureSource}.ts` | create | 2 | U-1, RC-1 |
| `lib/business-os/entitlements/__tests__/*.test.ts`, `tierMatrix.snapshot.json`, `tierLiteral.baseline.json` | create | 2–4 (with the code they cover) | §4.13 |
| `lib/repositories/BusinessOsAccountPlanRepository.ts`, `BusinessOsEntitlementShadowRepository.ts` + unit tests | create | 1 | WC-4, `new-repository` skill |
| `lib/repositories/OnboardingConversationRepository.ts` + test | modify | 1 | Add `getFirstMessageAt(userId)` (RC-10 `ensure_plan_row`) |
| `lib/repositories/types.ts`, `lib/repositories/index.ts` | modify | 1 | Skill steps 2 and 4 |
| `supabase/migrations/2026MMDD_business_os_entitlements.sql` + `scripts/verify-bos-entitlements-migration.sql` | create | 1 | §4.3. SA approved the rev 2 sketch (§13.1); the A-1 rename and the A-3 RPC are **new and need the SA re-check** before the file is written. |
| `lib/business-os/purge/descriptors.ts`, `purge/__tests__/classification-baseline.json`, `lib/business-os/businessOwnedTables.ts` | modify | 1 (same PR as the migration) | Three `never` / person-owned tables (WC-3) |
| `app/api/admin/business-os/entitlements/accounts/[accountId]/route.ts` + `__tests__/route.test.ts` | create | 5 | T-7, AC-6, S-10, A-3 |
| `app/api/admin/business-os/entitlements/launch/route.ts` + `__tests__/route.test.ts` | create | 5 | R2-1: built with `dryRun` in Slice 1, executed at switch-on |
| `app/api/admin/business-os/entitlements/shadow-report/route.ts` + `__tests__/route.test.ts` | create | 4 | AC-7, RC-6, RC-16 |
| `lib/audit/events.ts` | modify | 5 | `BOS_ENTITLEMENT_*` events + registry |
| `app/api/business-os/chat-v4/route.ts` | modify | 4 | **One** `shadowChatPlan(...)` call after the plan is obtained (~L860 on the merged tree; cite the call, not the line). Imports `@/lib/business-os/entitlements/shadow` only (RC-7). |
| `scripts/typecheck-bos-llm.ts` (+ baseline if needed) | modify | 2 | Add `lib/business-os/entitlements/` to `SCOPED_DIRS`. Header comments only; **no rename** of the npm script, workflow, job id or display name (S-9) — a rename would silently un-gate anything requiring that check. |
| `.github/workflows/bos-entitlements.yml` + `package.json` (`test:bos-entitlements`) | create/modify | 2 | Jest CI for the entitlement invariants (§4.14). Not a duplicate: no existing workflow runs `lib/**/__tests__`. |
| `docs/architecture/BUSINESS_OS_ENTITLEMENTS.md` | create | 5 | Adding a tier, the removal + ledger procedure, history entries, staleness bound, flag, launch preconditions, the admin ops incl. `reset_plan_state`, ops checks |
| `.env.example` (if present) | modify | 5 | Document `BOS_ENTITLEMENTS_MODE` |

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
  -- A-1: the tier assignment has its OWN expiry, mirroring cohort_expires_at.
  -- NULL = no end date (forever). Renamed from rev 2's `access_ends_at` so the two
  -- expiries read as the pair they are. In Slice 4 this is the Stripe period end.
  tier_expires_at       timestamptz NULL,
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
-- No policy is created at all, which also satisfies the admin-authz guard's R5
-- (no RLS policy may reference profiles.role). If direct admin reads are ever
-- wanted, the sanctioned predicate is public.is_platform_admin() (20260920a) —
-- but every read here goes through the service role, so none is added.
ALTER TABLE public.business_os_account_plans             ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.business_os_entitlement_overrides     ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.business_os_entitlement_shadow_events ENABLE ROW LEVEL SECURITY;
-- Named privileges, following 20260920a (service_role has BYPASSRLS and is not named).
REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER, SELECT
  ON TABLE public.business_os_account_plans,
           public.business_os_entitlement_overrides,
           public.business_os_entitlement_shadow_events
  FROM anon, authenticated;

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

-- A-3: wipe and recreate ONE account's plan state, atomically.
--
-- WHY A FUNCTION. Delete-then-insert from the application is two statements: a
-- crash between them leaves the account with no plan row at all, which is exactly
-- the state R2-3 forbids. A function body is one transaction, so the account
-- always ends this call with a plan row carrying the cohort the ADMIN CHOSE.
--
-- The cohort is a REQUIRED parameter with no default on purpose: "start this
-- account over" must never silently decide what it starts over AS.
--
-- Customer-facing Reset and Purge still never touch these tables (they are
-- `never` descriptors). This is the sanctioned admin-only equivalent, and unlike
-- Reset it is audited with an actor and a reason by its calling route.
CREATE FUNCTION public.business_os_reset_plan_state(
  p_user_id      uuid,
  p_cohort       text,           -- REQUIRED. 'trial' | 'champion' — validated in app against config.
  p_expires_at   timestamptz,    -- champion: NULL = open-ended (the admin said so explicitly)
  p_trial_started_at timestamptz,-- NULL ⇒ derive from facts (§4.8); set ⇒ the clock restarts here
  p_admin_id     uuid,
  p_origin       text            -- 'admin_reset'
) RETURNS public.business_os_account_plans
  LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE
  v_facts  record;
  v_result public.business_os_account_plans;
BEGIN
  IF p_cohort IS NULL THEN
    RAISE EXCEPTION 'business_os_reset_plan_state requires an explicit cohort';   -- R2-3
  END IF;

  -- Keep the recorded FACTS: they describe what the tenant did, not what the plan
  -- granted, and re-deriving them from the parent tables would be the same values.
  SELECT onboarding_started_at, profile_created_at INTO v_facts
  FROM public.business_os_account_plans WHERE user_id = p_user_id;

  DELETE FROM public.business_os_entitlement_overrides WHERE user_id = p_user_id;
  DELETE FROM public.business_os_account_plans         WHERE user_id = p_user_id;

  INSERT INTO public.business_os_account_plans
    (user_id, cohort, cohort_expires_at, trial_started_at, origin,
     onboarding_started_at, profile_created_at, updated_by_admin_id)
  VALUES
    (p_user_id, p_cohort,
     CASE WHEN p_cohort = 'champion' THEN p_expires_at END,
     CASE WHEN p_cohort = 'trial'    THEN p_trial_started_at END,
     p_origin,
     COALESCE(v_facts.onboarding_started_at,
              (SELECT min(created_at) FROM public.onboarding_conversations WHERE user_id = p_user_id)),
     COALESCE(v_facts.profile_created_at,
              (SELECT created_at FROM public.business_profiles WHERE user_id = p_user_id)),
     p_admin_id)
  RETURNING * INTO v_result;

  RETURN v_result;   -- the route audits before/after from this
END $$;
REVOKE EXECUTE ON FUNCTION public.business_os_reset_plan_state(uuid, text, timestamptz, timestamptz, uuid, text)
  FROM public, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.business_os_reset_plan_state(uuid, text, timestamptz, timestamptz, uuid, text)
  TO service_role;

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
  - `has_function_privilege('authenticated', …)` is false for **all four** functions (three plus the A-3 reset), and each function's `proconfig` contains `search_path=`; the two trigger functions also carry `lock_timeout=2s`.
  - **Never-raise (S-8 i):** `ALTER TABLE public.business_os_account_plans ADD CONSTRAINT tmp_fail CHECK (false) NOT VALID`, then insert a `business_profiles` row and an `onboarding_conversations` row. Assert both parent rows exist, then `ROLLBACK`.
  - **Trial cannot restart:** create a trial row, delete the account's onboarding rows (what `/api/onboarding/chat/reset` does), insert a new message. Assert `onboarding_started_at`, `cohort` and the pins are unchanged.
  - Backfill count = distinct Business OS users, all `champion` with `cohort_expires_at IS NULL`.
  - Inserting a tier with `plan_version = 0` fails the CHECK.
  - **A-3 reset:** with overrides present, `business_os_reset_plan_state(...,'champion',NULL,...)` leaves exactly one plan row, zero overrides, the chosen cohort, `cohort_expires_at IS NULL`, and the facts preserved. Calling it with `p_cohort = NULL` raises. The account **never** has zero plan rows when the call returns (R2-3).
- **Migration naming and application.** The file is named `2026MMDD_business_os_entitlements.sql` on the day it is written, and it is applied by RM or the user. Dev applies it only to a branch or local database.

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
- `subscription.graceHistory` (placeholder 7 days, for tier accounts after `tier_expires_at`, A-1).
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

### 4.8 Resolver semantics (FR-9, FR-10, FR-13, T-4, T-11, RC-2, RC-4, RC-11, S-7, **A-1**, **A-2**)

`resolveEntitlements({ config, account, overrides, addons, now }) → EntitlementSnapshot` is pure. `addons` is always `[]` in Slice 1 and fixture-tested (S-3).

**Basis (RC-11: the tier wins **while it is in force** — A-1).** A tier assignment is **in force** when `account.tier` is set and (`tier_expires_at IS NULL` — no end date, forever — or `now < tier_expires_at`). While in force, the basis is that tier's matrix row and **cohort layers and cohort lifecycle fields are ignored**. Otherwise the basis is the cohort's `base`: `{ tier }` gives that tier's row, and `{ all: true }` gives the **catalog-derived maximum**:
- boolean/group on, variant = top of its list, addon = `included`;
- quantity/metered/fair-use from the cohort's explicit `values`.

A row with neither tier nor cohort, or with an unknown tier/cohort, is an **anomaly**. R2-3 makes that state unreachable through any admin op.

**A-1: what an expired tier assignment falls back to.** The tier row is **not** deleted when it expires — the assignment stays on the row as history, and the resolver simply stops treating it as in force. The fallback is explicit, in this order:

| Account state when `now >= tier_expires_at` | Basis and lifecycle |
|---|---|
| A live cohort exists (`champion` with no expiry or not yet expired; `trial` not yet ended) | The **cohort** becomes the basis, exactly as for a tierless account, and the lifecycle is `champion` / `trial`. The expired tier contributes nothing, and no grandfathering applies (layer 1a is tier-account-only). |
| A cohort exists but has also ended | `grace` then `paused`, measured from the **later** of the two end dates, using that cohort's grace history. Taking the later date prevents an account that was upgraded mid-trial from being pushed into grace by a date that has already passed. |
| No cohort at all | `grace` then `paused`, measured from `tier_expires_at` with the **subscription** grace history. |

Because the cohort is still recorded, a champion who was given a tier for a while returns to being a champion when that tier lapses, rather than falling off a cliff. This is also what makes `tier_expires_at = NULL` safe: "no end date" is the default an admin gets only by saying so (§4.12).

**A-2: the three-step decision contract.** `decide(snapshot, capability, request, balance)` is pure and answers **one** question in a fixed order, so no call site has to remember to make three checks:

| Step | Question | Outcome when it fails |
|---|---|---|
| **0** | Is the snapshot usable at all? (T-3) | `entitlement_unavailable` for owner-paid audiences; fail-open audiences continue with stale or open values. **Never** `not_entitled`, so an outage never shows an upgrade prompt. |
| **a** | Does the account's **entitlement** cover this capability (at the requested variant/quantity)? | `not_entitled`, carrying `capability` and `lowestTier` (`null` while no tiers are configured). |
| **b** | Is the account's **state** active? (trial expired, `grace`, `paused`) | `read_only`, or `paused_public` / `suppressed` for the public and send surface kinds, from the §4.6 overlay table. |
| **c** | Is the **AI-action balance** sufficient for this call? | `limit_reached`, carrying the capability's at-limit behaviour: `degrade_to_template` for client-facing sends (the send goes out with template text, B-9/B-11) and `pause` for owner-facing AI (chat explains, it is not an error). |

- The steps run in that order and **stop at the first failure**, so a Basic account in grace is told the truthful, most actionable thing (`not_entitled` before `read_only`), and an account that is entitled and active but out of allowance gets `limit_reached`.
- **The balance step is a seam** (`balance.ts`):
  ```typescript
  export interface AiActionBalanceSource {
    /** Slice 3 implements this against the usage + grants ledger. */
    check(input: { accountId: string; capability: CapabilityId; cost: number }):
      Promise<{ sufficient: boolean; remaining?: number }>;
  }
  /** Slice 1 default: metering does not exist yet, so nothing is ever short. */
  export const ALWAYS_SUFFICIENT: AiActionBalanceSource = { async check() { return { sufficient: true }; } };
  ```
  `EntitlementService` holds the source and passes its answer into `decide`. **Slice 3 swaps the implementation in one place and no call site changes** — that is the point of shipping the seam now. Slice 1 tests inject a stub that returns `sufficient: false` to prove step (c) and its degrade/pause semantics.
- The decision always carries `{ outcome, capability, lowestTier, reason, atLimit?, surfaceKind }`, so logs and structured API errors are built from one object (FR-16, NFR Observability).

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
if tier && (tier_expires_at == null || now < tier_expires_at):   // A-1: in force; cohort ignored
    → active                                                     (past_due: Slice 4)
if tier && now >= tier_expires_at:                               // A-1 fallback, in this order:
    if cohort is live (champion open-ended/not expired, or trial not ended)
        → fall through to the cohort branches below (basis = cohort, lifecycle = champion/trial)
    elif cohort exists but ended
        accessEnd = max(tier_expires_at, cohortEnd) ; graceDays = that cohort's graceHistory@accessEnd
    else
        accessEnd = tier_expires_at ; graceDays = subscription.graceHistory@accessEnd
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

`history@t` means the entry with the greatest `effectiveFrom ≤ t`. If `clockStartsAt` names a fact that isn't set yet (for example `'profile_created'` before profile creation), the trial is `trial` with `end = null`, meaning setup is still in progress. That is tested. The RC-11/A-1 matrix test covers {no tier, tier open-ended, tier not yet expired, **tier expired**} × {no cohort, trial live, trial ended, champion open-ended, champion dated and expired} × {before end, in grace, after grace}.

### 4.9 Account seam, service, caching, failure policy (T-2, T-3, T-5, S-6, RC-12, RC-13, **A-2**)

- **`resolveAccountId(userId)`:** returns the user id. It is the only mapping.
- **`EntitlementService.check(accountId, capability, request)` is the one call every future call site makes (A-2).** It resolves the snapshot (memo + cache), asks the balance source, and returns the single `EntitlementDecision` from the three-step contract. `getSnapshot` / `getSnapshots` stay available for batch and report paths. Slice 2 wires surfaces to `check()`, and Slice 3 only replaces the balance source.
- **The balance source is injected**, defaulting to `ALWAYS_SUFFICIENT`, and is never consulted when step (a) or (b) has already failed — so the stub costs nothing and Slice 3's real query will not run for a request that was going to be refused anyway.
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
  1. **Static:** pages all plan rows (RC-12). Counts by lifecycle state and cohort. **Free access with no end date (A-1):** one list covering **open-ended champions** (`cohort_expires_at IS NULL`) **and open-ended tier assignments** (`tier_expires_at IS NULL`), each row saying which kind it is, when it started, who set it, and **whether the account ever created a business profile** (S1-T11a: onboarding-only accounts were made champions by the backfill and are the set to trim before enforcement). That single list is the answer to "who is not paying and has nothing stopping them", and it is the reason A-1 exists. Also: anomalies, and **Business OS tenants with no plan row** (count + sample ids).
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
| `ensure_plan_row` | `{ cohort: 'trial' \| 'champion', expiresAt?: ISO \| null, reason }` | **R2-2: the cohort is explicit and required** — a tenant with no row after the backfill is a trigger failure, and under U-2 an existing tenant should usually be a champion, so no silent trial. Champion also needs the `expiresAt` key. Facts come from `OnboardingConversationRepository.getFirstMessageAt` and `BusinessProfileRepository.findByUserId().created_at`. Idempotent: if a row exists it is a no-op returning `{ created: false }`. The GET inspect and the report show the tenant's facts so the admin can choose. |
| `set_cohort` | `{ cohort: 'trial' \| 'champion' \| null, expiresAt?: ISO \| null, reason }` | **champion:** `expiresAt` is a **required key** (a future ISO date, or explicit `null` = open-ended). Omitting it returns 400 (RC-4). Writes `cohort`, `cohort_expires_at`, `period_anchor = now`. **trial:** pins `trial_started_at = now`, optional `trial_ends_at`. **null:** clears the cohort, but **409 `would_leave_no_basis`** if the account has no in-force tier (R2-3). |
| `set_expiry` | `{ field: 'trial_ends_at' \| 'cohort_expires_at' \| 'tier_expires_at' \| 'grace_ends_at', value: ISO \| null, reason }` | That one column. `tier_expires_at` replaces rev 2's `access_ends_at` (A-1), and setting it to `null` means "no end date" and is reported as open-ended. |
| `assign_tier` | `{ tier: string \| null, expiresAt: ISO \| null, reason }` | **400 `no_tiers_configured` while `TIER_ORDER` is empty** (RC-1). **A-1: `expiresAt` is a required key**, exactly like champion — an ISO date, or an explicit `null` meaning no end date. Silence is never read as "forever". Writes `tier`, `tier_expires_at`, `plan_version = TIER_MATRIX.version`, `period_anchor = now`. `tier: null` clears the tier and its expiry, but **409 `would_leave_no_basis`** if the account has no cohort (R2-3). |
| `add_override` | `{ capability, op: 'set' \| 'add' \| 'revoke', value?, expiresAt?, reason }` | Insert. `value` is validated with that capability's shape schema. Also used for comped add-ons before billing (S-3), email abuse blocking (B-7), and a per-account grandfather extension. |
| `end_override` | `{ overrideId: uuid, reason }` | Sets `ended_at`, `ended_by_admin_id`, `ended_reason`. The override must belong to `accountId`. |
| **`reset_plan_state`** (A-3) | `{ confirm: 'reset_plan_state', accountId: <echo of the path id>, cohort: 'trial' \| 'champion', expiresAt?: ISO \| null, trialClock?: 'restart_now' \| 'from_facts', reason }` | **Wipe and recreate.** Deletes the plan row and **all** its overrides, then recreates the plan row with the **explicitly chosen** cohort, through the single-transaction `business_os_reset_plan_state` RPC (§4.3). Champion needs the `expiresAt` key; trial needs `trialClock` (`restart_now` pins `trial_started_at = now`, `from_facts` re-derives it, §4.8). Recorded facts are preserved. Guards: (1) the `confirm` literal **and** the echoed account id must both match, so it cannot be fired by a mistyped id; (2) **409 `tier_assigned`** if a tier is assigned, unless `confirmTierLoss: true` is also sent, because wiping a paying account's plan state is not something to do by accident; (3) it can never return with the account having no plan row (R2-3), which the RPC guarantees; (4) the audit entry carries the **full before state**, including the deleted overrides, since those rows are gone afterwards and the audit record is the only remaining trace. Slice 3 extends it to the usage and grant ledgers behind an explicit flag. |

**Why this op exists, and why it is not "Reset".** The customer-facing Reset and Purge must never touch these tables — that is what stops a customer from resetting their way into a fresh trial (§4.11), and it is enforced by the `never` purge descriptors. An admin still needs a genuine start-over for a test tenant or a support case, so the capability exists exactly once, behind the admin gate, with an actor, a reason and a full before-state in the audit trail.

**Order of checks (the new-main pattern, not the old inline one):**
1. **`const gate = await requireAdmin(requestLogger); if (gate instanceof NextResponse) return gate;`** — the **first statement** in the handler. It owns 401 (signed out, including an auth lookup that throws) and 403 (not an admin, including an admin check that throws). **Nothing above it** parses a body, reads the DB or calls out. The route **must not import `AdminAccessService`** (guard R2). A test still asserts that a user whose `profiles.role = 'admin'` gets 403 (AC-6).
2. 400 for a bad UUID or body (Zod, `.strict()`).
3. **Tenant pre-check (RC-10):** the target is a Business OS tenant if `BusinessProfileRepository.findByUserId` returns a row **or** `OnboardingConversationRepository.getLatestMessageAt` is non-null. Otherwise 404 `not_a_business_os_account`. For ops other than `ensure_plan_row`, a missing plan row returns 409 `plan_row_missing`. For `end_override`, the override must be owned by the account.
4. **Invariant pre-check (R2-3):** refuse with 409 `would_leave_no_basis` anything that would leave the account with neither an in-force tier nor a cohort.
5. Write through the repository.
6. `invalidate(accountId)`.
7. Audit: `auditTrail.log({ action: AUDIT_EVENTS.BOS_ENTITLEMENT_<OP>, userId: gate.user.id, entityType: 'business_os_account', entityId: accountId, changes: { before, after }, severity: 'warning', details: { reason }, request }).catch(...)`, then `await auditTrail.flush().catch(...)` before responding. Rows also store the actor, reason and timestamps (WC-7, no FK per RC-9).

**`POST /api/admin/business-os/entitlements/launch` (R2-1).** `launch_champion_existing`, built now and dry-runnable in shadow: `{ confirm: 'launch_champion_existing', reason, dryRun?: boolean }`. A **dry run** reports what it would change and writes nothing. A **non-dry run returns 409 `launch_preconditions_unmet`** while `TIER_ORDER` is empty (the same condition as UD-2), so it cannot be executed early by accident. Same gate order. See §5 for its semantics at switch-on.

**Self-service impossible (WC-8, FR-32, RC-8, RC-15):**
1. There are no user policies, and the named privileges are revoked from `anon`/`authenticated`.
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
| `lifecycle.test.ts` *(injected clock)* | **RC-11/A-1 matrix**: {no tier, tier open-ended, tier live, **tier expired**} × {no cohort, trial live, trial ended, champion open-ended, champion expired} × {before, grace, after}. A tier in force wins. **A-1 fallback:** an expired tier with a live champion resolves to `champion` with the champion basis; with a live trial to `trial`; with an ended cohort, grace runs from the **later** end date; with no cohort, from `tier_expires_at` on the subscription grace. `clockStartsAt` flip (RC-5). Pending-fact trial. **Shortening `durationHistory` does not shorten a running trial** (S-7). Pins beat facts. `grace_ends_at` override. |
| `decide.test.ts` | **A-2 contract order:** entitled+active+short balance → `limit_reached`; not entitled + in grace → `not_entitled` (step a wins); entitled + paused + short balance → `read_only` (step b wins); unavailable snapshot + owner-paid → `entitlement_unavailable` (step 0 wins, never `not_entitled`). **Degrade semantics:** a client-facing send at the limit returns `atLimit: 'degrade_to_template'`, owner-facing AI returns `atLimit: 'pause'`. **The default balance source never reports short**, and the balance source is not consulted when step (a) or (b) already failed. Overlay cells (B-9/B-11). Send-policy defaults by (class, initiator), and **an override for the seeded intake-request send id flips paused suppress→allow on production config** (RC-5/R2-4). T-3 per audience. Stale inputs never used for owner-paid (S-6). |
| `mode.test.ts` | `off` by default. `enforce` refused (acts as `shadow`, logs `error`) while no tier exists (UD-2), and always in Slice 1. `mode.ts` does not import config (static import check, RC-7). |
| `EntitlementService.test.ts` | Memo. 30 s TTL (fake timers). LRU cap evicts. Report/batch read-through does not populate. `invalidate`. Batch chunking at 100. **Mode `off` means the repository is never called.** |
| `shadow.test.ts` | **A throwing config loader, repository, resolver or RPC never escapes** (RC-7, WC-21). `off` means the loader is never called. Records `allowed` + both rules + item counts (RC-6). One RPC per request. |
| `imports.test.ts` | §3 dependency rules. **Symbol-level** references to repository write methods/class/singleton, including via the barrel, only from the admin routes and the repository test (RC-15). chat-v4 imports only `entitlements/shadow`. |
| `report.test.ts` + route test | Static counts. **The single "no end date" list covers open-ended champions and open-ended tier assignments, each labelled** (A-1). Missing plan rows. Observed aggregates. `asTier` on the fixture yields would-be denials by capability × surface (AC-7). `asTier` returns 400 with production config. **No names, reasons or actor ids in the output** (RC-16). Paging. |
| Repository tests (`BusinessOsAccountPlan`, `…Shadow`, `OnboardingConversation.getFirstMessageAt`) | One test per method. Wrong user returns null. Allow-lists drop extra fields. `>100` ids throws. Error path returns `{ data: null, error }`. `resetPlanState` calls the RPC with the explicit cohort and never with a null cohort (A-3). |
| `accounts/[accountId]/__tests__/route.test.ts` | AC-6: 401 (signed out, and auth throwing); 403 non-admin; **403 when `profiles.role='admin'` but not in `admin_users`**; 403 when the admin check throws; 400 bad body/UUID/shape; **400 champion without `expiresAt` key**, and explicit `null` accepted; **400 `assign_tier` without the `expiresAt` key** (A-1); **400 `no_tiers_configured`**; 404 non-tenant; 409 `plan_row_missing`; **409 `would_leave_no_basis`** for `set_cohort:null` on a tierless account and `assign_tier:null` on a cohort-less account (R2-3); **`ensure_plan_row` requires an explicit cohort** and is idempotent (R2-2); foreign override 404. **A-3:** `reset_plan_state` needs the `confirm` literal and the echoed id; 409 `tier_assigned` without `confirmTierLoss`; it deletes overrides, recreates with the chosen cohort, and the audit `before` holds the deleted overrides. Happy path per op: allow-listed write → `invalidate` → `log` with before/after/reason → **awaited `flush`**. |
| `launch/__tests__/route.test.ts` (R2-1) | Same auth matrix. **Dry run changes nothing** (no write call) and is repeatable. **Non-dry run returns 409 `launch_preconditions_unmet`** while no tier is configured. The selection covers tierless non-champions only and leaves tier accounts and existing champions untouched. |
| `business-profile` / `profile` `entitlementFields.test.ts` | WC-8. |
| Existing purge `descriptors.invariant` + `businessOwnedTables` tests | Pass with the three new tables. |
| Existing `admin-authz-surface.guard.test.ts` (`npm run test:authz-guard`) | Green with the new routes, and **with no new exemption** (caps are equality-asserted). This is a required status check on `main`, so it gates the PR. |
| `scripts/verify-bos-entitlements-migration.sql` | §4.3 list: no policies, revokes, function config, **tmp_fail never-raise**, **trial cannot restart**, backfill = open-ended champions, CHECK, **A-3 reset atomicity and its null-cohort refusal**. |

### 4.14 CI (WC-2, S-9, G-2) — re-checked against the five workflows on the new main

**Reuse first. Only one new job is added, and it duplicates nothing.**

| Existing workflow | Covers us how | Change needed |
|---|---|---|
| **`admin-authz-guard.yml`** (`Admin authz surface guard`) | R1/R2 on our three admin routes, R4 on any role-keyed decision, R5 on our migration. It is **already a required status check on `main`**, so an ungated or `AdminAccessService`-importing route cannot merge. | None. Our code must simply pass it, with **no new exemption**. |
| **`build.yml`** (`Build (next build)`) | Module-scope crashes and missing modules — the main risk from a new server-only module imported by a route and by chat-v4. | None. |
| **`bos-llm-typecheck.yml`** (`Type check (Business OS LLM attribution)`) | Types. Extend its `SCOPED_DIRS` with `'lib/business-os/entitlements/'`; its caller step then also covers the admin routes and chat-v4. | Edit `scripts/typecheck-bos-llm.ts` **header comments and `SCOPED_DIRS` only**. **No rename** of the npm script, workflow name, job id or job display name — a rename silently un-gates anything that requires that check (S-9). |
| **`react-hooks-guard.yml`** | Enforces the `is…Enabled` naming rule that `mode.ts` follows. | None. |
| **`plugin-tests.yml`** | Not applicable (path-filtered to the plugin suites). | None. |

**The one gap, and the one new job.** No workflow runs our Jest suites: `plugin-tests.yml` is path-filtered to the plugin directories, the admin guard runs a single guard file, and the typecheck runs `tsc`. So the FR-7/§10.6 promise that bad config "fails in CI" still needs a job. Add `.github/workflows/bos-entitlements.yml`, following the repo's one-guard-one-workflow convention:
- job name **`Business OS entitlements invariants`** (the string G-2 will require; renaming it later un-gates it);
- no `paths:` filter, with the shared `.github/ci/non-deploying-change.sh` scope step, the same choice the other two guards document;
- runs `npm run test:bos-entitlements` → `jest lib/business-os/entitlements lib/repositories/__tests__/BusinessOs lib/repositories/__tests__/OnboardingConversationRepository app/api/admin/business-os/entitlements app/api/business-os/business-profile app/api/business-os/profile lib/business-os/purge/__tests__/descriptors.invariant.test.ts lib/business-os/__tests__/businessOwnedTables.test.ts --ci`;
- `tests/plugins/jest-setup.ts` already stubs the Supabase env, so repository imports load.

**G-2 (updated, see §1.3).** `main` currently requires exactly one check, `Admin authz surface guard`. Before `enforce`, add `Build (next build)`, `Type check (Business OS LLM attribution)` and `Business OS entitlements invariants`. Each must have run once before GitHub offers its name, which the component PRs take care of.

### 4.15 Slice 1 task list, by component

Component boundaries are §4.0. Each component is one PR, reviewed by SA → QA → the user, and committed by RM (§1.4). **Dev leaves implementation uncommitted.**

**Before anything:**
- [ ] **S1-T0** SA re-check of the rev 3 sections listed in §0.1. SA approves the **final** migration SQL (the A-1 rename and the A-3 RPC are new since the §13.1 approval) before the file is written.

**Component 1 — plan records + migration** — ✅ **built 2026-09-21, uncommitted, awaiting SA code review** (§4.17 records how M-1 to M-6 were applied)
- [x] **S1-T7** Migration (§4.3) ✅ — **split in two per M-1**: `20261005_business_os_entitlements.sql` (tables incl. `tier_expires_at`, the M-3 CHECKs, RLS + named revokes + service_role grants, shadow RPC, **A-3 `business_os_reset_plan_state`** with M-2/M-4/M-5 applied, fact triggers) and `20261005b_business_os_entitlements_backfill.sql` (champion backfill + fact heal, own transaction). Plus `scripts/verify-bos-entitlements-migration.sql` (M-6). **Not applied to any database** — see §4.17.
- [x] **S1-T8** Purge descriptors (three `never` rows with notes), `classification-baseline.json` (121 → 124), `USER_OWNED_TABLES` entries with reasons ✅. Same change as S1-T7; both existing guard suites pass.
- [x] **S1-T9** `BusinessOsAccountPlanRepository` (reads, admin writes, `resetPlanState`, keyset paging, 100-id cap), `BusinessOsEntitlementShadowRepository`, `OnboardingConversationRepository.getFirstMessageAt`, `index.ts` exports, unit tests, `supabaseServer` rationale comments ✅.
- [x] **S1-T7a** Migration guard test (`supabase/migrations/__tests__/business-os-entitlements.migration.test.ts`) ✅ — the file-level half of M-1 to M-5, which SQL cannot check and CI can.

**Component 2 — catalog + config + validation + CI gate**
- [ ] **S1-T1** `types.ts` (zero-tier safe) + `schema.ts` (catalog-derived builders, histories, zero-tier enums).
- [ ] **S1-T2** `config/catalog.ts`: full §4.4 list with the `client_render` audience. Verify each `lifecycle` against the code and record the evidence. B-1 placeholders.
- [ ] **S1-T3** `config/tierMatrix.ts` (**empty**), `config/cohorts.ts` (`{ all: true }`, histories, explicit values, `clockStartsAt`), `config/lifecycle.ts` (overlay, send-policy defaults, **the seeded intake-request send id per R2-4**, empty overrides, subscription grace history), `config/launch.ts`. Fixture `exampleTierMatrix.ts` + `fixtureSource.ts`.
- [ ] **S1-T4** `config/chatActionMap.ts` + `readRule` + `capabilitiesForPlan` (item counts).
- [ ] **S1-T5** `source.ts`: lazy `CodeTierMatrixSource`, injectable source.
- [ ] **S1-T14** CI: `SCOPED_DIRS` + header comments (no renames), `test:bos-entitlements` script, `bos-entitlements.yml`. **F-1 (binding, confirmed by QA as Q-12):** the script's path list **must include `supabase/migrations/__tests__` *and* `lib/repositories/__tests__`**. That suite is the only CI check on M-1 and M-2 (the backfill staying out of the DDL transaction, and the reset never deleting an override row), and no other workflow runs it — component 1 shipped it, but nothing runs it until this task lands.

**Component 3 — resolver and the three-step contract**
- [ ] **S1-T6** `lifecycle.ts` (RC-11 + **A-1 expired-tier fallback**), `resolver.ts` (`{ all: true }`, S-7 histories), `decide.ts` (**A-2 three-step contract**), `balance.ts` (**A-2 seam + `ALWAYS_SUFFICIENT`**), all pure with an injected clock.
- [ ] **S1-T10** `account.ts`, `mode.ts` (no config imports, `is…Enabled` naming, UD-2 refusal), `EntitlementService.ts` (input cache, LRU, read-through, failure policy, 100-id chunking, **`check()`** with the injected balance source).

**Component 4 — shadow mode + report**
- [ ] **S1-T11** `shadow.ts` (lazy imports inside the try), `report.ts` (static incl. the **A-1 no-end-date list**, observed, `asTier`, no names or reasons), the one-line chat-v4 hook, the `shadow-report` route.
- [ ] **S1-T11a** *(SA, component 1 review)* The no-end-date list must also say, per row, **whether the account ever created a business profile**. The component 1 backfill deliberately treats "a profile **or** any onboarding message" as a tenant, so accounts that opened onboarding once and never came back are now open-ended champions too. Flagging them is what makes trimming that set before enforcement a deliberate act rather than a discovery. It is one extra field on the existing list (`profile_created_at IS NULL`), not a new query.
- [ ] **S1-T15** Setup-AI-cost section of the report (B-12 sizing input; SA recommends keeping it).

**Component 5 — admin ops + docs**
- [ ] **S1-T12** `accounts/[accountId]` GET + POST union (`ensure_plan_row` with explicit cohort per R2-2, `set_cohort`, `set_expiry` incl. `tier_expires_at`, `assign_tier` with the required `expiresAt` key per A-1, `add_override`, `end_override`, **`reset_plan_state`** per A-3, `would_leave_no_basis` per R2-3) and the **`launch` route with `dryRun`** (R2-1). **`requireAdmin` first, and no `AdminAccessService` import** (guard R1/R2). Audit events in `lib/audit/events.ts`.
- [ ] **S1-T12a** *(binding, from QA's component 1 review)* Route-level obligations the repository layer cannot own:
  - **Q-13:** the Zod schema for every op that names a cohort or tier uses `z.enum` built from config — the repository now rejects a blank cohort as a backstop, but the route is where an *unknown* value must be refused.
  - **Q-6:** `set_expiry` returns **409** when the matching assignment is absent (`tier_expires_at` with no tier, `cohort_expires_at` with no cohort), so the CHECK constraint is never how an admin hears about it. `updatePlan` now clears a paired expiry automatically, so `assign_tier { tier: null }` is safe, but the route still tests the pairing.
  - **Q-15:** the pre-check for `plan_row_missing` (409) must run before any write, because `updatePlan` returns `{ data: null, error: null }` for "no row matched" — indistinguishable from success at the call site. A route test covers it.
  - **Q-10:** add each new admin route to the `ALLOWED` list in `lib/repositories/__tests__/businessOsEntitlements.imports.guard.test.ts`. That edit is the reviewable moment where someone states who may write entitlement state.
- [ ] **S1-T16** `docs/architecture/BUSINESS_OS_ENTITLEMENTS.md`. A CLAUDE.md Key Documentation row needs TL/user approval.

**Across components**
- [ ] **S1-T13** The §4.13 tests, each landing in the PR of the code it covers.
- [ ] **S1-T18** Per component: `npm run test:authz-guard`, `npm run lint:hooks` and the scoped typecheck green locally before handing over.
- [ ] **S1-T17** Per component: hand to SA for code review, then QA, then the user's code review, then RM commits.

### 4.16 Slice 1 exit criteria

1. AC-1, AC-3, AC-5, AC-6 and AC-36/AC-37 pass on production config. AC-2, AC-4 and AC-7 pass on the fixture (RC-1, RC-6). The production-config load test passes.
2. With the flag `off`: a test proves there are no entitlement reads or writes, and chat-v4 never loads config (WC-21, RC-7).
3. A test proves the shadow path cannot throw, including with a throwing config loader.
4. The verification script proves the triggers never raise (tmp_fail), a trial cannot restart, there are no user policies, the revokes are in effect, and the A-3 reset is atomic and refuses a null cohort.
5. **A-1:** the resolver tests cover every expired-tier fallback, and the report's no-end-date list shows both open-ended champions and open-ended tier assignments.
6. **A-2:** the three-step contract is proven in order, with a stub balance source that reports short, and `check()` is the only call a future surface needs.
7. **A-3:** the reset op wipes and recreates with an explicit cohort, is refused without its confirmations, and never leaves an account with no basis (R2-3).
8. After the migration on production: missing-plan-row count = 0, every pre-existing tenant is an open-ended champion, and the report lists them.
9. With `shadow` on for about a week: the observed-usage report is populated (including `allowed`), and the setup-AI-cost section returns data for sizing the trial allowance.
10. Every CI job is green on each component PR, including the required `Admin authz surface guard` with **no new exemption**.

### 4.17 Component 1 as built (2026-09-21) — for SA code review

**Status:** implemented, **uncommitted** (per the delivery flow in §1.4, RM commits after the user approves). Nothing is wired to a call site: no route, service or cron imports any of it yet.

**Files**

| File | Action |
|---|---|
| `supabase/migrations/20261005_business_os_entitlements.sql` | create — schema, RLS, revokes + service_role grants, 4 functions, 2 triggers. **Renamed from `20260921` (QA Q-9)** so it sorts after `20261004`, the highest migration already applied. |
| `supabase/migrations/20261005b_business_os_entitlements_backfill.sql` | create — the backfill + fact heal, separate transaction (M-1, Q-5) |
| `scripts/verify-bos-entitlements-migration.sql` | create — 20 database-side checks (M-6) |
| `supabase/migrations/__tests__/business-os-entitlements.migration.test.ts` | create — file-level guard, runs in CI |
| `lib/repositories/BusinessOsAccountPlanRepository.ts` | create |
| `lib/repositories/BusinessOsEntitlementShadowRepository.ts` | create |
| `lib/repositories/OnboardingConversationRepository.ts` | modify — `getFirstMessageAt` |
| `lib/repositories/index.ts` | modify — exports |
| `lib/repositories/__tests__/BusinessOsAccountPlanRepository.test.ts`, `…ShadowRepository.test.ts`, `OnboardingConversationRepository.getFirstMessageAt.test.ts` | create |
| `lib/business-os/purge/descriptors.ts`, `purge/__tests__/classification-baseline.json`, `lib/business-os/businessOwnedTables.ts` | modify — never-purged / person-owned |

**How each SA change was applied**

| # | As built |
|---|---|
| **M-1** | Two migrations. The DDL one opens with `SET LOCAL lock_timeout = '5s'` and contains no scan of either parent table (the guard test asserts there is no `FROM public.business_profiles` / `onboarding_conversations` in it). The backfill is its own transaction, also lock-bounded, and creates no schema. |
| **M-2** | `business_os_reset_plan_state` **ends** active overrides (`ended_at`, `ended_by_admin_id`, `ended_reason = 'plan_state_reset: <reason>'`) and **upserts the plan row in place**, clearing `tier`, `tier_expires_at`, `trial_ends_at`, `grace_ends_at` and resetting `plan_version`/`period_anchor`/`origin`. `created_at` and both recorded facts are untouched. The function contains no `DELETE`, which the guard test asserts. |
| **M-3** | `CHECK (tier IS NOT NULL OR tier_expires_at IS NULL)` and `CHECK (cohort IS NOT NULL OR cohort_expires_at IS NULL)`, both named. The 409 that keeps a user from ever seeing them is component 5's `set_expiry`; the constraint is the backstop, not the message. |
| **M-4** | `v_cohort := btrim(COALESCE(p_cohort, ''))` then `IF v_cohort = '' THEN RAISE EXCEPTION … ERRCODE 22023`. The same treatment for a missing admin id and a blank reason. |
| **M-5** | `updated_at` is written by every writer: `updatePlan` and `ensurePlanRow` in the repository, the reset RPC, and the fact triggers' conflict branch. No `BEFORE UPDATE` trigger was added — one more trigger on this table is one more thing that can fail inside someone else's transaction. |
| **M-6** | The verification script now covers: RLS on / zero policies / no client privileges / function EXECUTE revoked / `search_path` and `lock_timeout` in `proconfig` / both triggers present / the three CHECKs by name (A-section); then, on a throwaway tenant, the trigger path, "a trial cannot restart", the `tmp_fail` never-raise proof, the M-3 and S-4 constraints behaviourally, the full M-2/M-4/M-5 reset semantics, the reset as a repair for a missing row, and the shadow RPC's arithmetic; then the backfill checks against real data. |
| **F-2 to F-4** (SA code review, applied 2026-09-21 before QA) | **F-2:** the `findEntitlementInputsBatch` comment now says the oversized batch is *refused and returned as an error*, matching the code — the comment was wrong, not the behaviour. **F-3:** each of the three test builder stubs now carries the CLAUDE.md rule 6 reason for its `any`. **F-4: done** — `ensurePlanRow` keeps its pre-read as a fast path but writes through `upsert(..., { onConflict: 'user_id', ignoreDuplicates: true })` and reads back when the insert is skipped, so a racing trigger or second admin yields `created: false` instead of a unique-violation 500. The contract is unchanged (`{ created, plan }`, never overwrites an existing row), the diff is about ten lines, and a new unit test covers the race. **F-1** is not applied here: it is a component 2 task (S1-T14), because that is where the CI job is created. |
| **Guard R1–R6** | No route is added in this component. The migration creates no policy, so R5 holds; nothing keys on a `role` value, so R4 holds. `npm run test:authz-guard` passes with **no new exemption**. When the routes land in component 5, each exported handler will contain its own `requireAdmin(` call — the guard reads handler bodies, so a shared helper would fail it. |

**Verification performed**

| Check | Result |
|---|---|
| `jest` over the four new suites + `descriptors.invariant` + `businessOwnedTables`, **after the F-2/F-3/F-4 fixes** | **6 suites, 97 tests, all passing** (was 56 + 58 before; F-4 added one) |
| `jest` over `admin-authz-surface.guard` | **74 passed**, no new exemption |
| ~~`tsc --noEmit` over the whole project, filtered to the new/changed files~~ | ❌ **This claim was wrong — see §4.18 (QA Q-7).** The command aborted with two `TS2688` errors and produced no file diagnostics at all. Superseded by the numbers in §4.18. |
| `eslint --config eslint.hooks.config.mjs` over the new/changed files | **clean** |
| **The migration against a database** | ❌ **not run — no database available to this environment.** There is no local Postgres, no Supabase CLI and no Docker here, and the only credentials present are production, which is out of bounds. The SQL has been reviewed statement by statement and its file-level properties are asserted by the guard test, but **`scripts/verify-bos-entitlements-migration.sql` has never been executed**. It must be run on a Supabase branch database before this migration is applied anywhere. |

### 4.18 QA findings fixed (2026-09-22) — component 1, still uncommitted

Against the QA report in §14 (`3544622f`). Everything below is in the working tree; the migrations were **renamed**, so QA's §14.6 commands need `20261005` / `20261005b` in place of `20260921` / `20260921b`.

| # | What changed |
|---|---|
| **Q-1** (High) | The shadow RPC now **aggregates before inserting** — `GROUP BY … , 6` with `SUM`/`MAX` and a `FILTER`ed `array_agg` for the sample id — so a payload carrying the same key twice is folded instead of raising `21000` and losing the batch. The `ON CONFLICT` arithmetic is unchanged, so a *second call* still sums onto the stored row. B8 now proves three things: duplicate keys folded within one call (5 / 6 / 9), a second call summing onto them (9 / 8 / 9, with a NULL sample not overwriting a stored one), and two different surfaces staying two rows. The repository comment claiming a caller-side de-duplication that does not exist is replaced by what is actually true: the RPC folds duplicates, so a caller may send them. A guard test asserts the `GROUP BY` cannot be removed. |
| **Q-2** (Medium) | The reset's **repair branch now recovers the facts** with the `COALESCE` sub-selects from §4.3, so a repaired account has a derivable trial clock. The root cause was mine: the M-1 guard regex was file-wide, so it forbade a parent-table read inside a *function body* — which never runs under the migration's trigger locks. The guard now strips `$$ … $$` bodies before the M-1 assertions (`stripFunctionBodies`), keeps a targeted assertion that a backfill-shaped `INSERT … SELECT` cannot return to the top level, and adds a **meta-assertion** that the stripping is not hiding everything (the un-stripped text must still contain the reads). B7 asserts the recovered fact equals the first message and that no profile fact is invented. **For SA at re-review: this narrows a guard that SA approved as written.** |
| **Q-3** (Medium) | The verification script no longer proves the backfill against an empty set. A new **C0** makes a synthetic pre-existing tenant (history written, plan row deleted), runs a copy of the backfill statement over it, and asserts an open-ended champion with facts taken from history — then re-runs it to show it is inert. **C3** fails if no backfilled row exists at all. C1 now **excludes the probe accounts**, which removes the hidden dependency on B7 having repaired tenant2. The C0 statement is a copy of the migration's, marked "keep in step". |
| **Q-4** (Medium) | The migration now **states the grant** (`GRANT SELECT, INSERT, UPDATE … TO service_role`) instead of inheriting it from whichever role applies the DDL, and a new **A10** asserts `service_role` can read/write all three tables and execute both callable functions. DELETE is deliberately not granted: nothing in this module deletes a plan row or an override. |
| **Q-5** (Medium) | Fixed as well as documented. The backfill now **heals NULL facts** for rows it skipped, filling each from the tenant's own history, guarded by `EXISTS` clauses so it touches nothing when the fact is legitimately absent — which keeps a re-run inert (the property the runbook fingerprints). It heals facts only: never a cohort, tier or pin, so it cannot restart a trial. §8 step 1 now carries the **RM ordering requirement** (apply both back to back) and points at the window query. The cohort of a gap row is still the launch operation's job at switch-on. |
| **Q-8** (Low) | A9 now matches on `tgrelid`, `tgtype` (AFTER / INSERT / ROW) and `tgfoid`, so a trigger of the right name on the wrong table fails. The CHECK assertions compare `pg_get_constraintdef` against the expression each constraint claims to enforce, so `CHECK (true)` under the same name fails. The guard test asserts the full `CREATE TRIGGER … ON … EXECUTE FUNCTION` binding. The `expect(builder.delete).toBeUndefined()` stub assertion is replaced: the stub now **defines** `delete`, and the test asserts it was never called. |
| **Q-7** (Note) | Fixed (`as unknown as`), and — more importantly — **my typecheck method was wrong**. See "How the typecheck is run" below. |
| **Q-9** (Note) | Both migrations renamed to `20261005` / `20261005b`. Every in-repo reference updated. |
| **Q-10** (Note) | Added `lib/repositories/__tests__/businessOsEntitlements.imports.guard.test.ts`: a **symbol-level** scan of `app/`, `lib/`, `components/`, `hooks/`, `scripts/` with an **empty** allowed-referrer set beyond the repositories, the barrel and their tests. Symbol-level rather than path-level because a barrel import names no file. Component 5 adds its routes to `ALLOWED` (S1-T12a). |
| **Q-11** (Note) | Both repository headers now say what is true: per-account paths are `user_id`-scoped, and the two account-wide reads (`findEntitlementInputsBatch`, `pagePlans`, `findWindow`) are deliberate report/cron reads whose ids come from server context. |
| **Q-13 / Q-6 / Q-15** | Repository-level hardening now, route contract recorded as **S1-T12a** (binding on component 5). `ensurePlanRow` refuses a blank cohort before touching the database; `updatePlan` clears a paired expiry when its assignment is cleared, so the CHECK cannot surface as a 500; `updatePlan` logs a `warn` when no row matched, so "no such account" is at least observable. |
| **Q-12 / F-1** | Restated in S1-T14: the component 2 CI job must run **both** `supabase/migrations/__tests__` and `lib/repositories/__tests__`. |
| **Q-14** (Note) | No change: function ownership is a deployment property, not a file property. The runbook already records `proowner` (§14.6 step 3b). |

**How the typecheck is run (correcting §4.17)**

QA was right, and the reason matters for anyone else working in a worktree. `node_modules` lives in the **main checkout**, not in the worktree, so `tsc -p tsconfig.json` from here fails to resolve `types: ["jest","node"]`, emits two `TS2688` errors and **stops before producing any file diagnostics** — which is why I reported "0 diagnostics" over a check that had examined nothing. The working command is:

```bash
NODE_OPTIONS="--max-old-space-size=8192" \
  node ../../../node_modules/typescript/bin/tsc --noEmit -p tsconfig.json \
  --typeRoots "<repo-root>/node_modules/@types"
```

(The heap flag is needed: the default limit aborts the run with exit 134 on this project.)

| Measurement | Value |
|---|---|
| `TS2688` errors (the degradation QA identified) | **0** — the program now type-checks for real |
| Total project diagnostics | **2,030** — the known pre-existing baseline (`next.config.js` ignores build errors) |
| Diagnostics in the component 1 files | **0** |
| Proof the check covers my files | The same run reports errors in three other `lib/repositories/*.ts` files and six under `supabase/`, so the directories are in the program and would have reported mine. |

**Tests after the fixes**

| Run | Result |
|---|---|
| `jest lib/repositories/__tests__ supabase/migrations/__tests__ lib/business-os/purge/__tests__ lib/business-os/__tests__/businessOwnedTables lib/admin/__tests__` | **35 suites, 462 tests, all passing** |
| Component 1's own five suites within that | **74 tests** (was 97 across six suites before the entitlement tests were split out from the purge/ownership ones; the component now adds 8 tests for Q-6/Q-8/Q-13/Q-15 and the import guard) |
| `admin-authz-surface.guard` | passing, **no new exemption** |
| Hooks ESLint over the touch set | clean; **0 `console.*`** |

**Still needs a database** (unchanged, and now with more to prove): everything in §14.5's BLOCKED list, plus the four checks these fixes added — B8's three-part arithmetic, B7's recovered facts, A10's `service_role` privileges, and C0/C3's non-vacuous backfill proof. The **fact heal** added for Q-5 has no in-script check; QA covers it with **§14.6 step 3d** (Q-19), which is the authoritative place for it until a `C4` folds it into the script. **`scripts/verify-bos-entitlements-migration.sql` has still never been executed.**

### 4.19 QA re-verification findings closed (2026-09-22) — component 1, still uncommitted

Against §14.8 (`8fef3ee4`) and SA's §13.4. All six were Low and none blocked, but they are closed before the user's code review so the code being reviewed is the final state.

| # | What changed |
|---|---|
| **Q-18** (the guard hole) | **Implemented as QA proposed, and it holds for this file.** The M-1 check is now "**this migration contains no top-level DML at all**": every statement, after comments and `$$ … $$` bodies are stripped, must begin with `BEGIN`/`COMMIT`/`SET`/`CREATE`/`ALTER`/`DROP`/`REVOKE`/`GRANT`/`COMMENT`. The current file passes with 34 statements. That closes the hole QA found — a scanning function *defined* and then *called* at the top level (`SELECT public.business_os_backfill();`) is caught, because a call is not on the list — and it states the real rule instead of enumerating shapes. The earlier "no `INSERT … SELECT`" check is now redundant and was removed. Two things were needed to make it work: the statement splitter ignores semicolons **inside single-quoted strings** (three `COMMENT ON … IS '…'` bodies contain them, and a naive split tore them into fragments that looked like unknown statements), and a **negative control test** feeds it both regression shapes to prove the rule can fail. |
| **Q-19** | No code change, as QA said. §4.18's "still needs a database" paragraph now points at **§14.6 step 3d** as the authoritative check on the fact heal until a `C4` folds it into the script. |
| **Q-20** | B7's fact assertion is now discriminating. tenant2's transcript starts with a message **backdated to `2021-03-04 05:06:07+00`**, and B7 compares the recovered fact with that literal rather than with `min(created_at)` — so a repair that wrote `now()`, or compared a query with itself, fails. The backdated message is inserted in **B4**, while the plan table is refusing writes: inserting it in B7 would fire the trigger, create a plan row, and send the reset down its `DO UPDATE` branch instead of the repair branch under test. B4's own count assertion moved 1 → 2. |
| **Q-21** | C1's probe exclusion is now `NOT EXISTS (SELECT 1 FROM _bos_probe b WHERE b.user_id = tenants.user_id)`. The `NOT IN` version was correct only because of a `WHERE user_id IS NOT NULL` that a later edit could drop, after which the count would be 0 forever and C1 could never fail. The comment says so. |
| **Q-23** | A Jest assertion now compares **C0's copy of the backfill statement with the real one in `20261005b`**, whitespace-normalised, with the one documented difference (`WHERE tenants.user_id IS NOT NULL` vs `= v_user`) replaced by a placeholder on both sides. If the migration's `SELECT` changes and the copy does not, the suite goes red instead of C0 quietly proving the old statement. Both extractions are asserted non-empty, so the comparison cannot pass by comparing nothing. Also: C0's "a second pass duplicated the row" check is **removed** — `user_id` is the primary key, so it could not fail; the comment points at §14.6 step 4, where re-run safety is actually proven. And `stripFunctionBodies` now uses a replacer **function**, so the placeholder is the literal `$$…$$` it was meant to be (in a replacement *string*, `$$` means an escaped `$`). |
| **Q-22 / SA F-5** | Both repository headers now cite `20261005_business_os_entitlements.sql`, and §4.15 S1-T7 names both current files. §4.18's "every in-repo reference updated" was wrong when written — corrected below. |

**Correction to §4.18.** Its Q-9 row said "Every in-repo reference updated". That was not true: the two repository headers and the S1-T7 task line still named the deleted `20260921_…` file. They are fixed now. The remaining `20260921…` strings in this document are inside §13.3 and §14.1–§14.5, which are dated records of what was reviewed and are left as written (§14.7a says the same).

**Verification after this round**

| Check | Result |
|---|---|
| `jest lib/repositories/__tests__ supabase/migrations/__tests__ lib/business-os/purge/__tests__ lib/business-os/__tests__/businessOwnedTables lib/admin/__tests__` | **35 suites, 464 tests, 0 failures** (was 462; Q-18's negative control and Q-23's drift check are the two new ones) |
| Migration guard suite alone | **37 tests** (was 35) |
| Typecheck, the verified method (`--typeRoots` + 8 GB heap) | **2,030 diagnostics, 0 × TS2688, 0 in component 1 files**; the same run still reports 3 in other `lib/repositories/*.ts` files, so the tree is genuinely covered |
| Hooks ESLint over the nine changed/created `lib` files | exit 0 |
| `console.*` in the touch set | **0** |
| The migration against a database | ❌ still never run — unchanged, and §14.8.4's sixteen properties still stand |

**Nothing else changed.** No production code path was touched in this round beyond the two header comment lines: the fixes are in the verification script, the Jest guard and the workplan. The migrations' behaviour is byte-identical to what SA approved in §13.4.

---

## 5. Slice 2: Enforcement (outline; G-3: the addendum restates each WC as tasks + tests)

| Area | Plan |
|---|---|
| **Prerequisites** | (1) **T-8 (WC-17)**, as the first PR: `chat` and `chat-command` return 410; the `chat-v2` toggle is removed and the route returns 410 (or becomes admin-only server-side). It is never mapped through the catalog. (2) Addendum SA-reviewed (G-3). (S-12 is already closed: the skill was fixed on `main`.) |
| Mode | `enforce` becomes selectable. `mode.ts` refuses it while `TIER_ORDER` is empty (UD-2). Every surface is wired in `shadow` first. |
| Route wrapper | `withEntitlement(capability \| { ungated: reason }, handler, { surfaceKind })`. **S-11 statuses:** `not_entitled` → **403**; `read_only` → **409**; `entitlement_unavailable` → **503** + `Retry-After`. Clients branch on the body `error` code. The addendum checks that no global fetch wrapper treats 403 as signed-out. Route-declaration test over §10.2 + C-5 + C-6 (WC-22c). |
| Chat | Gate at execution in `MutateExecutor`/`ForEachExecutor`, including the confirm turn and `saved-plans/[id]/run`. The per-turn snapshot is passed down. Enforcement calls are **awaited** (unlike shadow). |
| Crons (WC-13) | `durable-queue-drain` skill. Batch resolve (≤100 per chunk). A suppressed row gets a terminal `suppressed` status + `suppressed_reason` and is never re-sent (B-11). A lookup failure defers. Per-cron declarations. |
| **Send registry (S-1)** | Every automated client send is declared by **send id** with `messageClass` + `initiator`. The surface kind is derived from the entry, and `sendPolicyOverrides` is keyed by send id (Q-B4). Unclassified sends fail FR-8. |
| Payment reminders (WC-14) | Schedule-time check (`scheduleInvoiceReminders` callers) + send-time check (`PaymentReminderService`). Send time is authoritative. |
| Branding (WC-15) | `FooterBlock`, template `Footer`, booking page, and every `PublicFooter`/`PublicShell` consumer. `branded` forces the footer on at server render. The owner toggle is disabled in the UI. |
| Public / paused (WC-16, B-11) | `public_business` shows the paused page (reusing `app/go/unavailable` / `PublicErrorScreen`). `public_self_service` stays live. Grace shows a warning. |
| T-12 (WC-20) | The `license_tier` case goes through the resolver. `access-strategy.test.ts:82` is updated. |
| **B-3 row: `launch_champion_existing` (RC-3, UD-3, UD-4; BUILT IN SLICE 1 per R2-1)** | **Replaces `launch_reset_trials`.** The route and its dry run are **built in Slice 1** (§4.12, FR-14, AC-26); only its **execution** belongs to switch-on. Its own admin route, `POST /api/admin/business-os/entitlements/launch`, because it is multi-account (S-10). **Evaluated at the enforcement switch-on moment (UD-3):** every plan row with **no in-force tier** (`tier IS NULL OR tier_expires_at <= now()`, A-1) and `cohort IS DISTINCT FROM 'champion'` becomes `cohort='champion'`, `cohort_expires_at = NULL` (open-ended, UD-4), `origin='launch'`. Accounts with a tier in force and existing champions are untouched. It applies `ensure_plan_row` semantics first for any tenant with no row. **Idempotent** through a launch marker (a single audited marker row or a config-keyed audit check, decided in the addendum); a second run is a no-op returning the marker. Zod body `{ confirm: 'launch_champion_existing', reason, dryRun?: boolean }`; `dryRun` returns counts only and writes nothing; a non-dry run is refused with 409 `launch_preconditions_unmet` while no tier is configured. **One audit entry per account plus a summary**, then flush. **`requireAdmin` gate** and the same test matrix as §4.12. Accounts that sign up **after** switch-on get a normal trial; before a tier exists, an admin can make them champions one by one (UD-2). |
| Tests | Per surface type: happy path, not entitled (on the fixture tier set), read-only, lookup failure. AC-8 to AC-16, AC-26 (restated for champions), AC-27 to AC-29. |

## 6. Slice 3: Metering (outline; G-3 applies)

| Area | Plan |
|---|---|
| Inventory (FR-30, WC-18) | From `BOS_LLM_CALLS`: counts-as-AI-action, audience, class/initiator, template fallback. Embeddings don't count. **B-12:** onboarding, first website generation and services/intake generation **count**. |
| Hook | `runAiAction`. Read pre-check fails open. Post-action increment is non-blocking. **The A-2 seam is where the pre-check lands:** Slice 3 replaces `ALWAYS_SUFFICIENT` with a ledger-backed `AiActionBalanceSource`, and **no call site changes** — step (c) starts reporting `limit_reached` on its own. |
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
- **Webhooks** write only `tier`, `plan_version`, `period_anchor`, `tier_expires_at` (A-1: the Stripe current-period end; a cancelled-at-period-end subscription is exactly "tier with an end date", which the resolver already handles, and an open-ended comped tier stays `NULL`).
- **Also in this slice:** the founder coupon, boosts with auto top-up capped by the customer, and add-on purchase, which creates the add-ons table (S-3).
- **Renewal** bumps `plan_version`, which ends `'renewal'` grandfathering. The loader then accepts `'renewal'`.
- **Logging to convert when touched:** `StripeService` (2 `console.*`) and `app/api/stripe/webhook/route.ts` (168). I will propose a separate PR for the webhook.

---

## 8. Rollout, Flag Plan and Gates

| Step | Env | `BOS_ENTITLEMENTS_MODE` | Gate / action |
|---|---|---|---|
| 1. Slice 1 merged, **component by component** | all | `off` (default) | Per component (§4.0): Dev → SA ✅ → QA ✅ → **user reviews the code** → RM commits (§1.4). After component 1 lands, RM/user applies the migrations, which **backfill all existing tenants as open-ended champions**. **Apply `20261005` and `20261005b` back to back, in that order (QA Q-5)** — the triggers are live from the first COMMIT, so a pre-existing tenant who writes in the gap gets a `trial` row the backfill then skips. The gap is minutes if they are applied together. Afterwards run the window query (§14.6 step 5b) and record the count; the backfill's heal step fills any missing fact, and the launch operation fixes the cohort at switch-on. |
| 2. Verify provisioning | prod | `off` | Report: missing plan rows = 0. Open-ended champion count = pre-existing tenant count. DB logs show 0 trigger WARNINGs. |
| 3. Shadow on | preview → prod | `shadow` | Env change + redeploy. `shadow.ts` error rate 0. No chat-v4 latency change. |
| 4. Usage review | prod | `shadow` | About one week or more. The user designs tiers from observed usage (`allowed` included) and `readRule` comparisons. S1-T15 sizes the trial allowance. |
| 5. Tiers added as config | all | `shadow` | Normal release (B-2). `asTier` report shows retroactive would-be denials per tier. |
| 6. Slice 2 merged | all | `shadow` | All surfaces wired in shadow. T-8 retired. |
| 7. **Switch-on** | prod | `enforce` | **Preconditions, all required:** **G-1** key rotated + old key revoked + verified. **G-2** `Build (next build)`, `Type check (Business OS LLM attribution)` and `Business OS entitlements invariants` added to the required checks on `main` (which already requires `Admin authz surface guard`). **UD-2** at least one configured tier **and** a path onto it (admin `assign_tier` or Slice 4 checkout). The report shows no unexplained denials. User approval in session. **Then** `launch_champion_existing` (dry run, then run) **at switch-on (UD-3)**, then set `enforce` + redeploy. |
| 8. Ongoing | prod | `enforce` | Admins set end dates from the **no-end-date list** — both open-ended champions and open-ended tier assignments (A-1, UD-4). Late signups before billing can be made champions by an admin (UD-2). |
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
| WC-7 | **`requireAdmin` as the first statement** (the canonical gate on the new main; the route never imports `AdminAccessService`, guard R2) + the `profiles.role` 403 test, allow-lists, tenant pre-check, log + awaited flush. Durable actor/reason columns (no FK, RC-9). | S1-T12, §4.12 |
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
| RC-3 Champion backfill + `launch_champion_existing` | §4.3 step 5, §4.11, §4.12, §5 B-3 row, §8 step 7, §11 | S1-T7 + S1-T12 (**built in Slice 1 per R2-1**; executed at switch-on) |
| RC-4 Champion `expiresAt` required key, no default-duration fallback, open-ended count | §4.8, §4.10, §4.12 | S1-T6, T11, T12 |
| RC-5 Business questions as config (`readRule`, `clockStartsAt`, send-policy overrides) + flip tests | §4.5, §4.6, §4.13, §12.1 | S1-T3, T4, T13 |
| RC-6 Record all outcomes + item counts + `asTier` retroactive | §4.3 (table), §4.10 | S1-T7, T11 |
| RC-7 Module-load safety | §3, §4.7, §4.10, §4.13 | S1-T10, T11, T13 |
| RC-8 No user policies + revokes (named privileges, per the `20260920a` convention) | §4.3 step 2 | S1-T7 |
| RC-9 Actor columns without FK | §4.3 | S1-T7 |
| RC-10 Tenant pre-check via existing repos + `ensure_plan_row` | §4.12, §2 | S1-T9, T12 |
| RC-11 Tier-over-cohort precedence + combination tests | §4.8, §4.13 | S1-T6, T13 |
| RC-12 Paged report + 100-id batch cap | §4.9, §4.10 | S1-T9, T10 |
| RC-13 LRU cap + read-through | §4.9 | S1-T10 |
| RC-14 Trigger conditions (a)–(i) | §4.3, §4.11 | S1-T7 |
| RC-15 Symbol-level import test | §3, §4.12, §4.13 | S1-T13 |
| RC-16 Report exposure (no names/reasons) + test | §4.10, §4.13 | S1-T11, T13 |
| RC-17 Scope change in §1 + re-traced | §1, §9 | — |

### 9.3 SA re-check conditions (R2-1 to R2-4) and user additions (A-1 to A-3)

| # | Where addressed | Task(s) |
|---|---|---|
| **R2-1** Build `launch_champion_existing` with `dryRun` in Slice 1; a non-dry run is refused while no tier exists | §4.12 (launch route), §5 B-3 row, §4.13 launch tests, §4.2 | S1-T12, S1-T13 |
| **R2-2** `ensure_plan_row` takes an explicit cohort; the inspect/report shows the facts | §4.12 ops table, §4.10 | S1-T12, S1-T11 |
| **R2-3** No admin op may leave an account with neither a tier nor a cohort (409 `would_leave_no_basis`); the A-3 RPC cannot either | §4.12 check 4 + ops table, §4.3 RPC | S1-T7, S1-T12, S1-T13 |
| **R2-4** Seed the intake-request send id in production config so AC-37 is provable there | §4.6 lifecycle config, §4.13 `decide.test.ts` | S1-T3, S1-T13 |
| **A-1** `tier_expires_at` (NULL = no end date), explicit expired-tier fallback, one "no end date" report list, `assign_tier`/`set_expiry` signatures, Slice 4 webhook field | §4.3, §4.8, §4.10, §4.12, §7 | S1-T7, S1-T6, S1-T11, S1-T12 |
| **A-2** Three-step decision contract, stubbed balance seam, `check()` as the single call site API, degrade/pause semantics | §4.8, §4.9, §6 hook row | S1-T6, S1-T10, S1-T13 |
| **A-3** `reset_plan_state` op + its single-transaction RPC, explicit cohort, guards, full before-state audit | §4.3, §4.12 | S1-T7, S1-T12, S1-T13 |

---

## 10. console.* Files in the Touch Set

Re-counted on the merged branch (2026-09-21). Each touched file with `console.*` is flagged and, with user approval, converted in the same slice.

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
| R-6 | CI failures are advisory for everything except the admin guard | Partly closed | `Admin authz surface guard` **is** a required check on `main` with `enforce_admins`, so admin-gate regressions already block a merge. Build, typecheck and the entitlement invariants are still advisory until **G-2**. |
| R-7 | Next build ignores type errors | Certain / Med | Zod at first load + invariants + scoped typecheck. |
| R-8 | Cross-instance staleness | Certain / Low | 30 s bound documented. |
| R-9 | **Open-ended free access accumulates unseen** — champions with no expiry (UD-4, U-2) **and now tier assignments with no expiry (A-1)** | Certain / Med (revenue, not customer harm) | A-1 is the mitigation: both kinds are one required key away from being deliberate, and the report's single no-end-date list shows all of them with who set them and when. Access never lapses by surprise. |
| R-10 | **Trials of new signups end before any plan or payment path exists**, leaving no way to pay (UD-2) | High if enforced early / High | `enforce` is refused while there are no tiers (mode check). The §8 step 7 checklist requires a path onto a plan. Admins can make late signups champions. In shadow, lifecycle is only reported. |
| R-11 | `new-api-route` skill admin line misleads future work | **Closed.** Fixed on `main` (`a2a145ae`), and the CI guard now enforces the rule regardless of the skill. | — |
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
| A-1 | When does an **assigned plan** end? | `tier_expires_at` (`NULL` = no end date), set through a **required key** on `assign_tier` | An admin must say either a date or "no end date" — it is never implied. Both kinds of open-ended access appear in one report list. |

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
| S-12 | **Closed.** Fixed on `main` (`a2a145ae`) before this revision: the skill now documents `requireAdmin` as the first statement and forbids role checks. | §12.3 |
| R2-1 | `launch_champion_existing` + `dryRun` built in Slice 1; a non-dry run is refused while no tier exists. | §4.12, §5, §4.13 |
| R2-2 | `ensure_plan_row` requires an explicit cohort; facts are shown for the choice. | §4.12, §4.10 |
| R2-3 | 409 `would_leave_no_basis`, and the A-3 RPC refuses a null cohort. | §4.3, §4.12 |
| R2-4 | Intake-request send id seeded in production config. | §4.6, §4.13 |

### 12.3 Separate changes (none outstanding for Dev)

| Change | Status |
|---|---|
| **S-12: `.claude/skills/new-api-route/SKILL.md` admin variation** | **Done on `main` (`a2a145ae`), outside this workplan.** The skill now points at `requireAdmin` and forbids role checks, and the merge conflict on this file was resolved to main's version. No Dev action remains. Nothing else in this workplan needs a change to project configuration: the one item still requiring user approval is the CLAUDE.md Key Documentation row for `BUSINESS_OS_ENTITLEMENTS.md` (S1-T16), which TL routes. |

### 12.4 BA follow-ups (routed by TL)

The requirement was largely updated for the scope change (B-13 to B-15, FR-43 to FR-45, AC-36/AC-37, P-1, P-2). Remaining wording for BA:
- **AC-36:** "quantities at their highest declared value" should say that for quantity, metered and fair-use capabilities the highest declared value **is** the cohort's explicit config value (RC-2); there is no catalog maximum (SA note in §13.1).
- **A-1:** record that an assigned tier carries its own expiry, `NULL` meaning no end date, and that the reports list every account with no end date.
- **A-2:** record the three-step decision contract as the shape of an entitlement answer (it refines §10.3's outcome list rather than changing it).
- **A-3:** record the admin wipe-and-recreate operation in §12 Admin Operations, and note that customer-facing Reset/Purge still never touch these tables.
- Confirm P-1 and P-2 once the user answers; both are single config or launch-step values.

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

### 13.2 SA Re-check of Revision 3

**Re-checked by SA — 2026-09-21** (commit `238b043a`, on the branch after `main` was merged in at `92580639`)
**Status:** ✅ **CLEARED TO IMPLEMENT COMPONENT 1 (plan records + migration)**, with the migration changes M-1 to M-6 below. Components 2 to 5 stay cleared on the same terms as §13.1 plus the notes here. **The final migration SQL is approved at code review, not in another pre-round** — Dev writes it with M-1 to M-6 applied, and SA checks it against this list in the component 1 review.

#### Facts re-verified independently against the merged tree

| Claim in §2 | SA verification |
|---|---|
| `requireAdmin` is the canonical gate | ✅ `lib/admin/requireAdminRoute.ts` — `getUser()` wrapped in try (a throw is treated as signed out → 401), `AdminAccessService.isAdmin` fail-closed on throw → 403, returns `{ user }` or a `NextResponse`. |
| The admin guard is a **required** status check | ✅ `gh api …/branches/main/protection`: `enforce_admins: true`, required contexts `["Admin authz surface guard"]`. (It is **not** `strict`; the CLAUDE.md row that says "strict" is slightly off. A doc nit for TL/BA, not a workplan issue.) |
| R1–R6 and equality-asserted caps | ✅ `lib/admin/__tests__/admin-authz-surface.guard.test.ts` via `npm run test:authz-guard`. Caps today: R1 7/0, R2 7/1, R3 0/0, R4 2/0, R5 0/0, R6 0/0, asserted by equality — **any** new exemption fails the check. |
| CI is the five workflows, none running `lib/**/__tests__` | ✅ `admin-authz-guard`, `bos-llm-typecheck`, `build`, `plugin-tests`, `react-hooks-guard`. |

**Do our planned routes and migration pass R1 to R6?** Yes, on these conditions, which are now part of the plan:

| Rule | Our position |
|---|---|
| **R1** — every `app/api/admin/**` handler calls `requireAdmin` | The three new route files (`accounts/[accountId]`, `launch`, `shadow-report`) each call it as the first statement. **Each exported handler must contain the literal `requireAdmin(` call in its own body.** The guard scans per handler body, so factoring the gate into a shared `handle()` helper that both GET and POST call would **fail** R1 even though the behaviour is correct. Write it out in each handler. |
| **R2** — no `route.ts` imports `AdminAccessService` | Our routes import `requireAdmin` only. §4.12 says so. |
| **R3** — no `route.ts` under `app/admin/**` | We add none. |
| **R4** — no access decision keyed on a `role` value | The resolver decides on capabilities, cohorts and lifecycle. No `role` identifier anywhere in the module. |
| **R5** — no RLS policy referencing `profiles.role` | The migration creates **no policy at all**. |
| **R6** — the `/admin` page tree | We add no admin pages. |
| Caps | We add **zero** exemptions to any list. `npm run test:authz-guard` green is a per-component handover gate (S1-T18). |

The guard parses `export async function GET(request, { params })` correctly (documented in `extractBracedBody`), so the dynamic `[accountId]` route is fine.

#### Section verdicts

| Section | Result |
|---|---|
| **§4.0** component split | ✅ Approved. The dependency order is right, and each component is independently reviewable. Note for component 1: the RC-15 import test must assert the **allowed-referrer set** (empty until component 5 adds the routes), not that a referrer exists, or it will fail in its own PR. |
| **§4.3** migration | 🔄 Approved **with M-1 to M-6**. The A-1 rename is clean; the A-3 RPC needs the changes below. |
| **§4.8** A-1 + A-2 | ✅ Approved. The expired-tier fallback is explicit and safe: a champion given a tier returns to champion when it lapses, and grace runs from the later of the two ends. The three-step order (unavailable → not entitled → state → balance) is correct: telling a Basic account "not on your plan" before "read-only" is the more actionable truth, and `entitlement_unavailable` stays distinct from `not_entitled` (T-3). |
| **§4.9** `check()` + balance seam | ✅ Approved. One call site API, the balance source injected and never consulted after step (a) or (b) fails, `ALWAYS_SUFFICIENT` as the Slice 1 default. This is the right shape for Slice 3 to swap in one place. It stays within approved pattern 3; no new pattern. |
| **§4.12** admin ops | ✅ Approved, subject to M-2 (the reset's effect on the override record) and M-3 (`set_expiry` on a field with no matching assignment). The gate order, the `confirm` + echoed-id guard, the `tier_assigned` refusal and the `would_leave_no_basis` invariant are all right. |
| **§4.14 / §1.3 G-2** | ✅ Approved. Reusing build, the admin guard and the scoped typecheck, and adding exactly one Jest job, is the correct call — and it is honest that `Business OS entitlements invariants` is the string G-2 will require later. Keeping the existing script, workflow, job id and display names unchanged is mandatory (S-9). |
| **§2** | ✅ Verified (table above). |

#### Required changes to the component 1 migration (M-1 to M-6)

| # | Change |
|---|---|
| **M-1** | **Take the backfill out of the DDL transaction, and bound the DDL's lock wait.** `CREATE TRIGGER` takes an ACCESS EXCLUSIVE lock on `onboarding_conversations` and `business_profiles`, held until COMMIT. With the backfill inside the same transaction, every onboarding message and profile write in the product blocks for as long as that scan takes, and the deploy can hang behind any query already holding a lock. Do: transaction 1 = tables, RLS, revokes, functions, triggers, opening with `SET LOCAL lock_timeout = '5s'`; **then** transaction 2 = the backfill, with `ON CONFLICT DO NOTHING`. S-8(g)'s "no window" still holds, because the triggers are live before the backfill runs, so a tenant created in between is covered by the trigger and the backfill is a no-op for it. |
| **M-2** | **The reset must not erase the admin record.** As drafted, `business_os_reset_plan_state` deletes the override rows, which are the durable record WC-7 requires precisely so that history does not depend on the audit queue, and §8 says overrides are "never deleted silently". Change the RPC to: (a) **end** every active override (`ended_at = now()`, `ended_by_admin_id`, `ended_reason = 'plan_state_reset'`) instead of deleting it; (b) **update the plan row in place** (upsert on `user_id`) to the reset state — chosen cohort, its expiry, chosen trial clock, `tier`/`tier_expires_at`/pins cleared, `plan_version` back to 0, `period_anchor = now()`, `origin = 'admin_reset'`, facts preserved — instead of delete-then-recreate. The account still "starts over" with the admin's explicit cohort, and this is strictly better: `created_at` survives, R2-3 holds by construction (there is never an instant with no row), and the delete/insert race against a concurrent provisioning trigger disappears. If the user specifically wants the override rows physically gone, the alternative is an archive table written in the same transaction — but that is a fourth table, and ending the rows gives the same operational result. Update §4.12 guard (4), the §4.13 route test and the verification script to the new semantics: after a reset there are **zero active** overrides, the ended ones carry the reset reason, and the plan row's `created_at` is unchanged. |
| **M-3** | **Two cheap CHECK constraints**, neither naming a tier: `CHECK (tier IS NOT NULL OR tier_expires_at IS NULL)` and `CHECK (cohort IS NOT NULL OR cohort_expires_at IS NULL)`. An expiry with nothing to expire is unreachable for the resolver's A-1 fallback and would only ever be a bug. Consequence for §4.12: `set_expiry` returns **409** when the matching assignment is absent (`tier_expires_at` with no tier, `cohort_expires_at` with no cohort), so the constraint is never the thing that reports the error. |
| **M-4** | **RPC input hygiene:** raise on a cohort that is NULL **or blank**, not only NULL. App-side Zod against config stays the primary validation. |
| **M-5** | **`updated_at` is currently never maintained.** Have the repository write allow-lists and the reset RPC set it explicitly (preferred over adding a third trigger). The verification script asserts it moves on an admin write. |
| **M-6** | Fold M-1 to M-5 into `scripts/verify-bos-entitlements-migration.sql`, and keep the §13.1 checks (no policies, revokes in effect, `search_path`/`lock_timeout` in `proconfig`, the `tmp_fail` never-raise proof, "a trial cannot restart", backfill = open-ended champions, the `plan_version` CHECK). |

Everything else in §4.3 — the three tables, `tier_expires_at`, the actor columns without FKs, the named-privilege revokes, the fact-recording triggers, the shadow RPC, and the champion backfill — is approved as written.

#### Items for the user

1. **The reset op keeps a record of what it removed** (M-2). The account still starts over with the cohort an admin picks, but the overrides an admin had previously granted are marked "ended by reset" rather than erased, so support can still see what the account once had. Flagging it because it is a small change to what "wipe" means.
2. **Required CI checks (G-2)** still need a repository-settings change before enforcement is switched on. Today only the admin guard blocks a merge.
3. **P-1 and P-2 remain open** (trial contents including beta; open-ended champions at switch-on). Both are single config or launch-step values.
4. **When component 1's migration is applied to production, every existing account becomes a champion in the data.** Nothing changes in behaviour — nothing reads these tables until the flag is switched on — but that is the moment the record is created.

### 13.3 SA Code Review — Component 1 (plan records + migration)

**Reviewed by SA — 2026-09-21** (uncommitted working tree; workplan at `3ee40a2d`)
**Status:** ✅ **CODE APPROVED — CLEARED FOR QA**, with four small fixes (F-1 to F-4), none of them blocking QA.
**Migration SQL: APPROVED.** This is the final approval deferred from §13.2. `20260921_business_os_entitlements.sql` and `20260921b_business_os_entitlements_backfill.sql` may go to QA and then to RM as written, with F-2 applied alongside them if convenient.

#### What SA ran (not just read)

| Check | Result |
|---|---|
| `npx jest supabase/migrations/__tests__ lib/repositories/__tests__/BusinessOs lib/repositories/__tests__/OnboardingConversationRepository lib/business-os/purge/__tests__/descriptors.invariant lib/business-os/__tests__/businessOwnedTables` | **6 suites, 96 tests, all passing.** |
| `npm run test:authz-guard` | 74 passing. No new exemption, caps unchanged (component 1 adds no route). |
| `npm run lint:hooks` | Clean. |
| Purge baseline | `count` 121 → 124, with the three tables at `never`. The descriptor invariant and `businessOwnedTables` suites pass, which is the real gate. |

#### M-1 to M-6 — verified in the files, not taken on trust

| # | Verdict | Evidence |
|---|---|---|
| **M-1** | ✅ Met | The DDL migration contains no `SELECT` over either parent table — I checked the file, and the Jest guard asserts `not.toMatch(/FROM\s+public\.(business_profiles\|onboarding_conversations)/i)` so a later edit cannot quietly put the scan back under the trigger locks. The backfill is a separate file and transaction. Both open with `SET LOCAL lock_timeout`, so neither can queue behind a long-running statement while holding locks. The "no window" argument holds: triggers are live at the first COMMIT, so a tenant created between the two migrations is covered by the trigger and the backfill skips it. |
| **M-2** | ✅ Met, and better than specified | `business_os_reset_plan_state` contains **no `DELETE`** at all. It ends active overrides (`ended_at`, `ended_by_admin_id`, `ended_reason = 'plan_state_reset: <reason>'`) and rewrites the plan row through `INSERT … ON CONFLICT (user_id) DO UPDATE`, which also repairs an account that has no row. `created_at`, `onboarding_started_at` and `profile_created_at` are absent from the `DO UPDATE` list, so history survives. The Jest guard asserts the absence of `DELETE FROM` and of assignments to `created_at` and the two facts. |
| **M-3** | ✅ Met | Both CHECKs are present and named, and the verification script proves each one rejects the bad state. |
| **M-4** | ✅ Met | `btrim(COALESCE(p_cohort, ''))` with an explicit empty-string refusal, plus NULL target/admin and a minimum-length reason — more than asked for. |
| **M-5** | ✅ Met | `updated_at` is written by `updatePlan` (always, alongside `updated_by_admin_id`), by `ensurePlanRow`, by the reset RPC and by both fact triggers. Deliberately no `BEFORE UPDATE` trigger, with the reason written down: one less thing that can fail inside someone else's transaction. Agreed. |
| **M-6** | ✅ Met | The verification script covers A1–A9 (tables, RLS, zero policies, no client privileges, function privileges, pinned `search_path`/`lock_timeout`, both triggers, three named CHECKs), B1–B8 (fact recording, the trial-restart loophole, `tmp_fail` never-raise, the CHECKs, the reset's guards and its effect, the repair path, the shadow upsert arithmetic) and C1–C2 (backfill completeness and shape). |

#### Standards and security

| Area | Verdict |
|---|---|
| Repository pattern | ✅ All access via `lib/repositories/`. No direct Supabase calls outside them. Both classes take an injectable client and are exported from the barrel with a server-only note. |
| `user_id` scoping | ✅ Every read and write is scoped by `.eq('user_id', accountId)`; `findOverrideById` and `endOverride` are scoped by **both** id and account, so a foreign override id cannot be touched. `endOverride` also filters `.is('ended_at', null)`, so ending twice cannot overwrite who ended it first. |
| `supabaseServer` rationale | ✅ Both file headers explain the intentional RLS bypass and state that the account id always comes from server context, never a request body. |
| Tenant isolation (the scope-defeating three) | ✅ **Unscoped trigger:** the two fact triggers read only `NEW.user_id` and can only fill a NULL fact. **Upsert conflict + spread:** `updatePlan` builds its payload field by field from `PATCH_FIELDS` — `user_id`, `created_at` and the facts are not in the list, so a caller-supplied object cannot reach them. **Payload injection:** no spread of any request object anywhere in either repository. |
| RLS / privileges | ✅ RLS on for all three tables, **zero policies**, named privileges revoked from `anon` and `authenticated`. The verification script's A4 uses `has_table_privilege`, which also catches a privilege inherited from `PUBLIC`, so the narrower REVOKE list is safe. |
| SECURITY DEFINER hardening | ✅ Only the two trigger functions are DEFINER, each with `search_path = ''`, `lock_timeout = '2s'`, `EXCEPTION WHEN OTHERS → RAISE WARNING` and revoked EXECUTE. Both callable functions are INVOKER, revoked from the client roles and granted to `service_role` only. |
| Pino, no `console.*` | ✅ `createLogger({ service })` in both repositories, `{ err }` on every error path, child loggers per method. Zero `console.*` in the touch set. |
| TypeScript | ✅ No `any` in production code; `value: unknown` rather than `any` on the override payload. |
| Zod | ✅ N/A for component 1 — there is no request boundary yet. Validation of `tier`/`cohort` against config is the admin route's job in component 5, which is where the Zod union lives. |
| FR-12 | ✅ No tier name anywhere in SQL, asserted by the guard. |
| Purge registration | ✅ Three `never` descriptors with reasons that explain the *commercial* rationale (deleting them would hand out a fresh trial), three `USER_OWNED_TABLES` entries, baseline 121 → 124. Correct: these tables are keyed to `auth.users`, so neither Reset nor Purge can reach them by cascade either. |

#### Dev's three flagged items

| Item | SA position |
|---|---|
| **Reset semantics** (clears pins and `plan_version`, keeps facts and `created_at`) | **Correct as built.** Clearing `plan_version` to 0 is required by the `tier_versioned` CHECK once the tier is cleared, and resetting `period_anchor` is right for a genuine start-over. One consequence worth knowing: `origin` is overwritten with `admin_reset`, so after a reset the row no longer says it was originally a backfill. That is acceptable — the audit entry carries the full before state — and it is the only provenance the operation loses. |
| **Backfill scope** (a profile **or** any onboarding message) | **Correct, and the alternative is worse.** Narrowing it to `business_profiles` would leave every onboarding-only account with no plan row, which is exactly the "missing plan row" anomaly the ops check exists to drive to zero. The cost is that dormant accounts who opened onboarding once also become open-ended champions. Follow-up for component 4, not a change here: **the report's no-end-date list should say whether each account has a business profile**, so these can be trimmed before enforcement is switched on. Recorded in §14/§4.10 scope for component 4. |
| **`now()` in one transaction** (the verify script backdates values) | **Legitimate.** `now()` is the transaction timestamp, so a "did it move?" assertion inside one transaction would compare a value with itself; backdating to a value the trigger could not have produced is the right workaround, and the script says so. `clock_timestamp()` is the alternative, but the code under test deliberately uses `now()`, so backdating tests the real thing. No change. |

#### Fixes (none blocking QA)

| # | Fix | Priority |
|---|---|---|
| **F-1** | **The migration guard must be in the component 2 CI job.** `test:bos-entitlements` (§4.14) does not list `supabase/migrations/__tests__`, and no other workflow runs it, so the M-1/M-2 guard would never run in CI. Add that path to the script when component 2 creates it. Binding on component 2. | High |
| **F-2** | `BusinessOsAccountPlanRepository.findEntitlementInputsBatch`'s doc comment says it "throws on an oversized batch"; it returns `{ data: null, error }`, which is the correct repository behaviour. Fix the comment, not the code. | Low |
| **F-3** | The three test mock builders use `builder: any` with no reason comment (CLAUDE.md rule 6). One line each explaining that the stub models a chainable PostgREST builder. | Low |
| **F-4** | `ensurePlanRow` is check-then-insert, so a provisioning trigger or a second admin firing in between surfaces a unique-violation as a 500. Consider an upsert with `ignoreDuplicates` and a re-read, or treating `23505` as `created: false`. Optional; no data can be damaged either way. | Low |

#### The migration has not been run against any database

No local Postgres, Supabase CLI or Docker is available here, and the only credentials present are production, which are out of bounds. So **every claim above about runtime behaviour is a claim about the SQL text, not an observation.** What has actually been executed is the Jest layer: the file-level guard, the repository unit tests, the purge invariants, the admin guard and the hooks lint.

**QA must run, on a branch or local database (never production):**

1. Apply `20260921_business_os_entitlements.sql`, then `20260921b_business_os_entitlements_backfill.sql`. Use a **clean** branch database: the DDL uses `CREATE TABLE IF NOT EXISTS`, so a half-applied earlier attempt would be skipped silently rather than corrected.
2. `psql "<branch url>" -v ON_ERROR_STOP=1 -f scripts/verify-bos-entitlements-migration.sql` — expect the single row `business_os entitlements migration: all checks passed`. Any failure names the property that broke.
3. If the script's `auth.users` insert is rejected (Supabase versions differ in that schema), follow the fallback in its header: substitute an existing non-Business-OS auth user id and keep the rest.
4. **Run the backfill a second time** and confirm it inserts nothing and changes nothing. The script checks the resulting state; it does not prove re-run safety.
5. Confirm that any plan rows created by the triggers between the two migrations are still `cohort = 'trial'` — the backfill must not convert them (that is the launch operation's job at switch-on).
6. Record roughly how long the backfill takes. It scans `onboarding_conversations` in full, and that number is what RM needs before applying it to production.
7. Sanity check that a normal onboarding message and a profile creation still succeed with the triggers live, and that the database log shows no `business_os_plan_fact_*` WARNINGs.

Everything else that can be checked without a database has been checked and is green.

#### For the user

1. **Nothing has touched a database yet.** Applying these two migrations to production is a separate, gated decision, and it is the moment every existing account becomes a design partner (champion) in the record. Behaviour does not change: nothing reads these tables until enforcement is switched on.
2. **The reset operation keeps history**, as agreed in §13.2: what an admin previously granted is marked "ended by reset" rather than erased.
3. **Dormant accounts get free access too.** Anyone who ever opened onboarding, even once, and never built a business becomes an open-ended champion. That is the right call for now (it avoids leaving accounts in an unknown state), but before enforcement is switched on you will want to trim that list. The report will show which of them never created a business, so this can be a deliberate cleanup rather than a surprise.

### 13.4 SA Confirmation — QA-driven changes to component 1

**Confirmed by SA — 2026-09-22** (uncommitted tree; workplan at `0cc87014`)
**Status:** ✅ **All three changes confirmed. My approval of the migration SQL stands**, now covering `20261005_business_os_entitlements.sql` and `20261005b_business_os_entitlements_backfill.sql`. One trivial fix, F-5. Re-ran the suites: **7 suites, 114 tests, all passing.**

| Change | SA verdict |
|---|---|
| **Narrowing the M-1 guard** (strip `$$ … $$` bodies, keep a targeted top-level `INSERT … SELECT` check, add a meta-assertion) | **Confirmed — the narrowing is a correction, not a weakening, and QA was right.** I approved that assertion as written and it was wrong: M-1 is about a scan held under the trigger locks in a **top-level DDL statement**. A sub-select inside a function body runs when the function is called, long after that transaction committed, so forbidding it enforced nothing real while silently deleting approved behaviour. That is the failure mode a guard is supposed to prevent, so it earns the stricter replacement: the targeted `INSERT … SELECT` check now names the actual regression, and the meta-assertion ("the un-stripped text contains what the stripped text does not") stops the stripping from ever passing vacuously — which is the risk any stripper introduces. Two small notes, neither needing a change: the body stripper only recognises `$$` quoting, so a future `$tag$`-quoted body would simply not be stripped and the M-1 check would fail, which is the safe direction; and `'$$…$$'` in the replacement string resolves to a single `$` per JS `replace` semantics, which nothing depends on. |
| **Restoring the facts in the reset's repair branch** | **Confirmed, and it is better than my §13.2 wording.** I specified preserving the facts from the existing row; the repair branch has no existing row, and the triggers are AFTER INSERT, so a fact left NULL there could never be filled — and the trial clock derives from it. Reading `min(created_at)` and the profile's `created_at` from the tenant's own history is the right recovery. The `DO UPDATE` branch still omits both columns, so an existing row's facts remain untouched: recovery happens only where there is nothing to protect. |
| **Explicit `GRANT SELECT, INSERT, UPDATE … TO service_role`, with DELETE withheld** | **Confirmed.** Stating the positive side rather than inheriting it from whichever role applies the DDL is correct, and the failure it prevents is a nasty one — "permission denied" on every repository call, discovered weeks later, because nothing reads these tables until components 3 and 4. Withholding DELETE matches the design: the reset ends rows, the module never removes one. **Consequence to carry forward:** if a later component needs to delete (shadow-event retention is the likely one), it must add the grant deliberately — which is exactly the conversation that privilege should trigger. The verification script's A10 already asserts the positive side, so a dropped grant fails loudly. |
| **Backfill heals NULL facts (EXISTS-guarded, facts only)** | **Confirmed.** It closes a real window: between the two migrations a live trigger can create a row carrying one fact, the insert then skips it on conflict, and an AFTER INSERT trigger can never supply the other. The `EXISTS` guards are what keep a re-run genuinely inert — without them every account with no profile yet would have `updated_at` rewritten on each run. It touches facts only, never cohort, tier or pins, and the guard test asserts that. |
| **Rename to `20261005` / `20261005b`** | **Confirmed.** They now sort after `20261004_payment_tables_write_lockdown.sql`, which is what matters. Order between the pair is preserved (`20261005b` > `20261005`). |

**F-5 (trivial).** Both repository headers still cite `supabase/migrations/20260921_business_os_entitlements.sql`. Update the two comments to `20261005_…` so the code points at the file that exists.

F-1 to F-4 from §13.3 stand as written. Nothing here changes the QA steps in §13.3 — except that step 1 now applies `20261005` then `20261005b`, and step 4 (run the backfill twice) is more valuable than before, because the heal statement is the part whose re-run inertness is a property rather than an accident.

## 14. QA Testing Report

### 14.1 Component 1 (plan records + migration) — QA, 2026-09-21

**Test mode:** full (component 1 scope only)
**Strategy used:** **A + B + E** — Jest unit/invariant suites run independently (A), repository behaviour read and exercised through injected clients (B), and statement-by-statement review of SQL that cannot be executed here (E). **Option C/D not applicable:** there is no database in this environment and Playwright is not installed.
**Focus:** api-adjacent data layer, schema, security (RLS/privileges/tenant isolation), migration safety
**Skipped:** nothing was skipped by choice. Everything that needs a database is **BLOCKED** and listed in §14.5, with a runnable script in §14.6.
**Input source:** prompt keywords + §13.3 (SA's seven database steps) + §4.17 (Dev's as-built claims)

**Environment constraint (binding).** No local Postgres, no Supabase CLI, no Docker. The only credentials present are **production**, which are out of bounds. **Nothing in this report was executed against any database.** QA did not connect to, apply migrations to, or query any database.

**Verdict for the non-database scope: PASS WITH FINDINGS.** Every Jest suite is green and reproduces Dev's numbers, the standards checks hold, and M-1 to M-5 are present in the SQL text as SA describes them. But review found **one High defect that will stop the database run at its first behavioural check** (Q-1), plus one behavioural gap against §4.3 (Q-2) and two checks in the verification script that cannot detect their own failure (Q-3, Q-4). **Not ready for commit until Q-1 is fixed**, because Q-1 makes §13.3 step 2 — the gate SA defined — impossible to pass.

---

### 14.2 What QA ran (independently, not re-reported from Dev)

Jest was run from the worktree using the main checkout's `node_modules` (`node <main>/node_modules/jest/bin/jest.js --config jest.config.js …`).

| Command | Result |
|---|---|
| `jest supabase/migrations/__tests__ lib/repositories/__tests__/BusinessOs lib/repositories/__tests__/OnboardingConversationRepository lib/business-os/purge/__tests__/descriptors.invariant lib/business-os/__tests__/businessOwnedTables` | ✅ **6 suites, 97 tests, 0 failures** (matches §4.17) |
| `jest lib/admin/__tests__/admin-authz-surface.guard.test.ts lib/business-os/purge/__tests__ --ci` | ✅ **4 suites, 132 tests, 0 failures** (authz guard 74 + `descriptors.invariant` + `no-deletion-paths.guard` + `ResetService.order`). **No new exemption**; component 1 adds no route. |
| `jest lib/repositories/__tests__ --ci` (whole folder — regression on the `index.ts` barrel change) | ✅ **26 suites, 263 tests, 0 failures** |
| `eslint --config eslint.hooks.config.mjs` over the six changed/created `lib` files | ✅ clean, exit 0 |
| `console.*` count in the touch set | ✅ **0** in all six files |
| Scoped typecheck over the 10 new/changed files (TS program built from `tsconfig.json`, diagnostics filtered to those files) | ⚠️ **1 diagnostic** — see **Q-7**. A full `tsc -p` is not a usable gate here (the repo carries ~2,000 pre-existing errors per `scripts/typecheck-bos-llm.ts`, and a full run OOMs at 4 GB in this environment), so QA built a program rooted at the changed files with the same compiler options. |

**Note on the environment:** `tsconfig.json` pins `typeRoots: ["./types", "./node_modules/@types"]`, and a worktree has no `node_modules`, so a naive `tsc -p tsconfig.json` here reports only `TS2688 Cannot find type definition file for 'jest'/'node'` and nothing else. Anyone repeating Dev's "0 diagnostics filtered to the changed files" from a worktree should check they were not reading that degraded run.

---

### 14.3 Coverage against SA's conditions and §4.3

| Item | Tested? | Result | How |
|---|---|---|---|
| **M-1** backfill out of the DDL transaction; no scan under the trigger locks | ✅ | **Pass** | Read both files: the DDL contains no `SELECT` over either parent table and opens with `SET LOCAL lock_timeout = '5s'`; the backfill is a separate file/transaction with its own `lock_timeout` and `ON CONFLICT DO NOTHING`. The Jest guard asserts both. See **Q-2** for a side effect of the guard's regex. |
| **M-2** reset rewrites in place, no `DELETE`, keeps `created_at` + facts, ends overrides | ✅ | **Pass (text)** | `business_os_reset_plan_state` contains no `DELETE`; `INSERT … ON CONFLICT (user_id) DO UPDATE` with `created_at`, `onboarding_started_at`, `profile_created_at` absent from the update list; overrides are `UPDATE`d to ended with `'plan_state_reset: ' \|\| reason`. Behavioural proof is BLOCKED (B6). |
| **M-3** both named CHECKs | ✅ | **Pass** | `business_os_account_plans_tier_expiry_needs_tier`, `…_cohort_expiry_needs_cohort`, plus `…_tier_versioned` (S-4). Named, present, and behaviourally probed by the script's B5 (BLOCKED). |
| **M-4** blank cohort / blank reason / missing admin refusals | ✅ | **Pass (text)** | `btrim(COALESCE(p_cohort,''))` + `ERRCODE 22023`; `p_user_id IS NULL OR p_admin_id IS NULL`; `length(v_reason) < 3`. All three are probed by B6 (BLOCKED). See **Q-13**: the same hygiene is absent on the repository write paths. |
| **M-5** `updated_at` written by every writer | ✅ | **Pass** | `updatePlan` (always), `ensurePlanRow` (upsert payload), the reset RPC (both branches), both fact triggers' conflict branch. Asserted in the repository unit tests. |
| **M-6** verification script folds M-1..M-5 in | ⚠️ | **Partial** | 20 checks present and mostly sharp, but **Q-1** aborts the run, and **Q-3/Q-4/Q-8** are checks that cannot detect their own failure. |
| No RLS policies; client privileges revoked | ✅ | **Pass** | `ENABLE ROW LEVEL SECURITY` on all three, zero `CREATE POLICY`, named-privilege `REVOKE … FROM anon, authenticated` (follows `20260920a`). R5 of the admin guard holds by construction. |
| SECURITY DEFINER hardening | ✅ | **Pass, with Q-14** | Only the two trigger functions are DEFINER; each pins `search_path = ''`, `lock_timeout = '2s'`, catches `WHEN OTHERS → RAISE WARNING`, and has EXECUTE revoked. Both callable functions are INVOKER + revoked + granted to `service_role`. **Function ownership is never set or asserted** (Q-14). |
| Account scoping on every read/write | ✅ | **Pass, with Q-11** | `findEntitlementInputs`, `findOverrideById`, `endOverride`, `updatePlan`, `ensurePlanRow` all `.eq('user_id', …)`; `findOverrideById`/`endOverride` scope by **both** id and account, and `endOverride` adds `.is('ended_at', null)`. `pagePlans` and `findWindow` are deliberately unscoped report reads — correct, but the file header and §13.3 both say "every read and write is scoped" (Q-11). |
| Field allow-list on updates | ✅ | **Pass** | `PATCH_FIELDS`, built key by key; the unit test sends `user_id`, `created_at` and a fact in the patch and asserts they never reach the payload. No spread of any caller object anywhere in either repository. |
| F-4 upsert race path (`ensurePlanRow`) | ✅ | **Pass** | `upsert(..., { onConflict: 'user_id', ignoreDuplicates: true })` → `[]` on conflict → read-back → `{ created: false }` with the *other* writer's cohort preserved. Covered by a dedicated test. |
| Error paths return errors, never throw | ✅ | **Pass** | Every method is `try/catch → { data: null, error }`. Proven for `findEntitlementInputs`, `findEntitlementInputsBatch` (oversized), `getFirstMessageAt`, `recordEvents` (oversized + RPC error), `resetPlanState` (database refusal). |
| Structured logging, no `console.*` | ✅ | **Pass** | `createLogger({ service })`, child loggers per method, `{ err }` on every error path. 0 `console.*`. |
| Zod / validation | ✅ | **N/A for this component** | No request boundary exists yet; tier/cohort validation is component 5's. But see **Q-13** — nothing below component 5 refuses a blank cohort on the non-RPC paths. |
| Purge + ownership registration | ✅ | **Pass** | Three `never` descriptors with commercial reasons, three `USER_OWNED_TABLES` entries, baseline `121 → 124`. QA confirmed the `businessOwnedTables` guard really does parse the new migration (its `CREATE TABLE … user_id` scan matches all three tables), so the classification is enforced, not merely declared. |
| FR-12 (no tier name in SQL) | ✅ | **Pass** | Asserted by the guard; QA re-read both files. |

---

### 14.4 Issues found

#### Bugs (must fix before commit)

**Q-1 — `business_os_record_shadow_events` raises on two rows with the same key in one call, and the verification script's B8 does exactly that. Severity: High.**
- Files: `supabase/migrations/20260921_business_os_entitlements.sql:226-249` (the RPC), `scripts/verify-bos-entitlements-migration.sql:416-439` (B8), `lib/repositories/BusinessOsEntitlementShadowRepository.ts:79-110` (the caller).
- The RPC is `INSERT … SELECT … FROM jsonb_to_recordset(p_rows) … ON CONFLICT (…) DO UPDATE`. PostgreSQL refuses to let one command update the same row twice: two proposed rows with identical `(user_id, capability, surface, outcome, rule, day)` raise `ERROR: ON CONFLICT DO UPDATE command cannot affect row a second time` (SQLSTATE 21000), with the hint *"Ensure that no rows proposed for insertion within the same command have duplicate constrained values."*
- B8 passes **two rows with an identical key** in a single call and asserts they are summed (`hits = 5`, `items_max = 9`). That expectation is not reachable: the call raises, `ON_ERROR_STOP=1` stops the script, and §13.3 step 2 can never print `all checks passed`. **This is the first thing the database run will hit**, so it would otherwise be mistaken for a migration defect discovered at deploy time.
- It is also a real contract defect, not only a test defect. `BusinessOsEntitlementShadowRepository.recordEvents` forwards the array untouched; the only de-duplication claimed anywhere is a comment (`BusinessOsEntitlementShadowRepository.ts:64-66`, "The recorder de-duplicates within a request before calling") describing code that does not exist yet (component 4). If component 4's recorder ever emits the same key twice — the same capability denied twice on one surface in one request is the *normal* case — the whole batch is lost. Shadow errors are swallowed by design, so the loss is silent.
- **Root-cause fix (in the RPC, where it scales):** aggregate before inserting, so the function is correct for any payload —
  ```sql
  SELECT r.user_id, r.capability, r.surface, r.outcome, r.rule,
         COALESCE(r.day, (now() AT TIME ZONE 'utc')::date)  AS day,
         SUM(GREATEST(COALESCE(r.hits, 1), 0))::int         AS hits,
         SUM(GREATEST(COALESCE(r.items_total, 0), 0))::bigint AS items_total,
         MAX(GREATEST(COALESCE(r.items_max, 0), 0))::int     AS items_max,
         now(), (array_agg(r.sample_correlation_id) FILTER (WHERE r.sample_correlation_id IS NOT NULL))[1]
  FROM jsonb_to_recordset(p_rows) AS r(…)
  GROUP BY r.user_id, r.capability, r.surface, r.outcome, r.rule, 6
  ```
  B8's assertions then hold as written, and component 4 cannot lose a batch by emitting a repeated key.
- Expected: B8 asserts the summing behaviour the migration's comment promises. Actual: the call raises `21000` and the verification run dies at its eighth behavioural check.

#### Behaviour gaps (should fix before the migration is applied)

**Q-2 — the reset-as-repair path creates a plan row with NULL facts, and the migration guard prevents fixing it in place. Severity: Medium.**
- Files: `supabase/migrations/20260921_business_os_entitlements.sql:391-401`, `supabase/migrations/__tests__/business-os-entitlements.migration.test.ts:46-52`, workplan §4.3 (the approved sketch), `scripts/verify-bos-entitlements-migration.sql:396-413` (B7).
- §4.3's approved RPC populated the facts with `COALESCE(v_facts…, (SELECT min(created_at) FROM public.onboarding_conversations …), (SELECT created_at FROM public.business_profiles …))`. As built, the INSERT branch supplies **no** `onboarding_started_at` / `profile_created_at` at all. On the DO UPDATE branch that is right (the facts survive). On the **INSERT** branch — the repair path SA praised, and the one B7 exercises — the row is created with both facts NULL.
- Those facts can never be filled afterwards: the triggers fire on `AFTER INSERT` only, and a repaired account's onboarding and profile rows already exist. So a repaired trial has no derivable clock start, and component 3's `clockStartsAt` has nothing to read.
- The cause is worth recording: the guard's `not.toMatch(/FROM\s+public\.(business_profiles|onboarding_conversations)/i)` is written for M-1 but applies to the **whole file**, so it also forbids a parent-table read inside a function body — which does not run under the migration's trigger locks at all. The guard is broader than its stated intent and has already removed approved behaviour.
- **Fix options:** (a) narrow the guard to the DDL statements outside function bodies and restore the `COALESCE` sub-selects; or (b) keep the SQL as is and make the repair path exclusively `ensure_plan_row` (which does recover the facts, via `getFirstMessageAt` + `BusinessProfileRepository`), then **remove the "it also repairs a missing row" claim** from §4.17/§13.3 and have the reset RPC refuse a missing row. Either is fine; what is not fine is a documented repair path that silently loses the trial clock. B7 must then assert the facts, not just the cohort.

**Q-5 — the window between the two migrations can leave a pre-existing tenant as a trial with a missing fact. Severity: Medium (operational).**
- Files: `supabase/migrations/20260921_business_os_entitlements.sql` (triggers live at COMMIT), `20260921b_business_os_entitlements_backfill.sql:36-59` (`ON CONFLICT DO NOTHING`).
- Splitting the migrations is right (M-1), but between them the triggers are live and the backfill has not run. An **existing** tenant who writes an onboarding message or creates a profile in that window gets a trigger-created row with `cohort = 'trial'`, `origin = '…_trigger'`, and only the one fact the trigger recorded. The backfill then skips them (`DO NOTHING`), so a paying-era account is recorded as a trial and, if the trigger was the profile one, `onboarding_started_at` stays NULL forever even though a transcript exists.
- Self-healing at switch-on (`launch_champion_existing` makes every non-champion with no tier a champion), so this is not a data-loss bug — but the missing fact is not healed, and between now and switch-on the ops "missing plan row" count reads clean while the cohort is wrong.
- **Mitigation for RM (add to the §8 apply checklist):** apply `20260921b` immediately after `20260921`, then run the window query in §14.6 step 6b and heal any rows it returns.

**Q-13 — only the reset RPC refuses a blank cohort; the repository write paths do not. Severity: Low (becomes Medium if component 5 misses it).**
- Files: `lib/repositories/BusinessOsAccountPlanRepository.ts:317-386` (`ensurePlanRow`), `:397-428` (`updatePlan`).
- `cohort: string` with no trimming or emptiness check, and the table deliberately has no value CHECK (FR-12). `''` therefore satisfies `cohort IS NOT NULL` and passes M-3, producing a row the resolver cannot interpret. The RPC hardens against exactly this (M-4); the two non-RPC writers do not. Component 5's Zod enum is the intended guard — record it as binding there, and consider a `btrim`/reject in `ensurePlanRow` so the invariant does not depend on one caller.

**Q-6 — clearing one half of an expiry pair will hit the M-3 constraint as a 500. Severity: Low (binding note for component 5).**
- Files: `lib/repositories/BusinessOsAccountPlanRepository.ts:405-411` (patch applied field by field, no pairing rule).
- `updatePlan({ tier: null })` without `tier_expires_at: null` violates `business_os_account_plans_tier_expiry_needs_tier`, and the caller sees a generic repository error. §4.12 says `assign_tier` with `tier: null` "clears the tier and its expiry", so the route is expected to send both keys — but nothing enforces it. Either normalise in `updatePlan` (when `tier === null`, force `tier_expires_at = null`; same for cohort) or add the pairing test to component 5's route tests.

#### Verification-script weaknesses (checks that cannot detect their own failure)

**Q-3 — C1 and C2 pass vacuously on a clean branch database, which is exactly the database SA tells QA to use. Severity: Medium.**
- File: `scripts/verify-bos-entitlements-migration.sql:445-473`.
- C1 counts tenants with no plan row; C2 counts rows `WHERE origin = 'backfill'` that are not open-ended champions. On a **clean** branch database there are no pre-existing tenants and no backfilled rows, so both counts are 0 and both checks pass **whether or not `20260921b` was ever run**. The script then prints `all checks passed`, and the one thing the backfill migration exists to do has been asserted against an empty set.
- There is also a hidden ordering dependency: C1 passes only because B7's repair created tenant2's plan row (B4 deliberately prevented the trigger from creating it). Remove or reorder B7 and C1 fails for a reason that has nothing to do with the backfill.
- **Fix:** seed tenants **before** applying the migrations (§14.6 step 0 does this) and add a non-vacuity assertion, e.g. `IF (SELECT count(*) FROM public.business_os_account_plans WHERE origin = 'backfill') = 0 THEN RAISE EXCEPTION 'C0 the backfill produced no rows: this database proves nothing about it'`. Until then, **C1/C2 are not evidence** and QA records the seeded counts by hand.

**Q-4 — nothing asserts that `service_role` can still use these tables. Severity: Medium.**
- File: `scripts/verify-bos-entitlements-migration.sql:59-70` (A4 checks only the negative).
- The migration never `GRANT`s table privileges to `service_role`; it relies entirely on Supabase's `ALTER DEFAULT PRIVILEGES` for whichever role applies the DDL. If the migration is applied by a role whose default privileges differ, `service_role` ends up with **no** access and every repository call fails with `permission denied for table business_os_account_plans` — and because nothing reads these tables until component 3/4, that failure surfaces weeks later.
- The same gap exists on the positive side of the function grants: A5 proves `anon`/`authenticated` cannot execute, but nothing proves `service_role` can.
- **Fix:** add an A10 to the script (SQL given in §14.6 step 3b), and consider explicit `GRANT SELECT, INSERT, UPDATE ON … TO service_role;` in the migration so the privilege is stated rather than inherited.

**Q-8 — three checks assert less than they appear to. Severity: Low.**
- `scripts/verify-bos-entitlements-migration.sql:120-128` (A9): counts triggers by **name only** (`pg_trigger … tgname IN (…)`), with no check of `tgrelid`, `tgtype` (AFTER/INSERT/ROW) or the function they call. A trigger of the right name on the wrong table would pass. B1/B3 cover the real behaviour, so this is redundancy rather than exposure — but as written A9 cannot fail for the reason it names.
- `…:131-145` (M-3/S-4): asserts the three CHECK constraints **by name**. `CHECK (true)` under the same name passes. Mitigated by B5, which probes all three behaviourally.
- `lib/repositories/__tests__/BusinessOsAccountPlanRepository.test.ts:374`: `expect(builder.delete).toBeUndefined()` asserts a property of the **stub**, not of the repository — it is true no matter what `endOverride` does. (A `.delete()` call would still fail the test, by throwing.) Assert on `calls.update`/the absence of a `delete` call on a stub that defines one.

#### Edge cases checked by review

| Case | Finding |
|---|---|
| User with **no onboarding row and no business profile** | No plan row, correctly: triggers fire on INSERT only and the backfill's tenant set is `business_profiles ∪ onboarding_conversations`. `findEntitlementInputs` returns `plan: null`, which the repository documents as an anomaly the caller reports rather than papers over. ✅ |
| **Auth row deleted** (FK cascade) | `business_os_account_plans` and `…_shadow_events` cascade from `auth.users`; overrides cascade from the plan row. No orphans, and the actor columns have no FK so deleting an **admin's** auth user is never blocked (RC-9). ⚠️ Worth knowing: deleting a tenant's auth user also erases the override rows WC-7 keeps as the durable record. That is consistent with "never purged by the product, removed with the person", but it is the one path that destroys them. |
| **Repeated backfill** | Idempotent: `ON CONFLICT (user_id) DO NOTHING`, no schema, no updates. Re-running after new signups leaves their trigger-created trial rows alone, which is the documented intent. ✅ (Proof is BLOCKED — §14.6 step 4.) |
| **Tier set with cohort NULL, and vice versa** | Both are legal in the schema by design; M-3 constrains only the *expiry* pairing, and the R2-3 "never neither" invariant lives in component 5. Correct per plan; recorded here so it is not rediscovered as a bug. The reset RPC always writes a cohort, so it cannot produce the empty state. ✅ |
| **Expiry paired with its assignment** | Both CHECKs present; the reset clears `tier` and `tier_expires_at` together. The clearing hazard on partial patches is **Q-6**. ⚠️ |
| **`business_profiles` upsert that updates** rather than inserts | Does not fire `AFTER INSERT`, so it cannot re-record a fact. Correct — and it is why the fact columns are safe against the six provisioning sites in §2. ✅ |
| **Onboarding replay / business Reset** | The conflict branch writes only while the fact `IS NULL`, and touches no cohort/tier/pin. The trial-restart loophole is closed in the SQL text; behavioural proof is B2 (BLOCKED). ✅ |

#### Notes, not defects

| # | Note |
|---|---|
| **Q-7** | `lib/repositories/__tests__/BusinessOsAccountPlanRepository.test.ts:131` produces `TS2352` (`BusinessOsAccountPlan` → `Record<string, unknown>` needs `as unknown as`). Test-only, no CI gate today, but it contradicts §4.17's "0 diagnostics" and would light up the scoped typecheck once component 2 extends `SCOPED_DIRS`. |
| **Q-9** | Filename ordering: the two new migrations are numbered `20260921`/`20260921b`, but the highest already in the tree is `20261004` (committed today). They therefore sort **~40 files before** migrations that are already applied. Harmless for a replay (they depend only on `auth.users`, `business_profiles`, `onboarding_conversations` from `20260721`), but an RM applying "everything new at the bottom of the list" will not see them. Worth renaming to `20261005`/`20261005b`, or calling it out explicitly in §15. |
| **Q-10** | The RC-15 import guard does not exist in this component, although `lib/repositories/index.ts` now exports the **write** symbols through the barrel. §13.2 specifically told component 1 to add it asserting an *empty* allowed-referrer set. Until it lands, nothing stops a non-admin module importing `businessOsAccountPlanRepository.updatePlan`. |
| **Q-11** | `BusinessOsAccountPlanRepository.ts:20-21` and §13.3 both state that *every* read and write is `user_id`-scoped. `pagePlans` (`:255-277`) and `BusinessOsEntitlementShadowRepository.findWindow` (`:118-142`) are deliberately account-wide report reads. Correct behaviour, inaccurate sentence — fix the sentence so the next reviewer does not read an exception as a bug. |
| **Q-12** | **F-1 confirmed by QA.** The five workflows are `admin-authz-guard`, `bos-llm-typecheck`, `build`, `plugin-tests`, `react-hooks-guard`; only `test:authz-guard` and `test:plugins` run Jest. **Nothing runs `supabase/migrations/__tests__` or `lib/repositories/__tests__`.** If component 1 merges before component 2, its guard test and both repository suites are dead weight in CI. Already binding on S1-T14; restated because it is an exposure window, not a preference. |
| **Q-14** | No `ALTER FUNCTION … OWNER TO` anywhere, so the two SECURITY DEFINER functions run as whichever role applies the migration (`postgres` in the Supabase SQL editor). Mitigated by `search_path = ''`, full schema-qualification, a body that reads only `NEW.user_id`, and revoked EXECUTE — so this is a note, not a finding. The verification script does not record `proowner`; §14.6 step 3b adds it so the value is at least observed once. |
| **Q-15** | `updatePlan` returns `{ data: null, error: null }` when no row matched, so "account has no plan row" is indistinguishable from success. §4.12 step 3 pre-checks `plan_row_missing`, so this is component 5's contract to honour — worth a route test. |

---

### 14.5 Status split

**PASSED (no database needed)**
1. All six component-1 Jest suites: 97 tests. Plus the whole `lib/repositories/__tests__` folder (263) and the purge + authz guards (132). No regressions from the `index.ts` barrel change.
2. `npm run lint:hooks` scope: clean. Zero `console.*` in the touch set. Pino `createLogger({ service })` with `{ err }` on every error path.
3. M-1, M-3, M-4, M-5 verified in the SQL text. M-2 verified in the text (no `DELETE`; `created_at` and both facts absent from the update list).
4. RLS on, zero policies, named revokes; DEFINER functions pinned and revoked; both callable functions INVOKER + granted to `service_role` only.
5. Tenant isolation: field allow-list, no object spread, both-key scoping on override writes, `ignoreDuplicates` race path.
6. Purge/ownership registration is genuinely enforced (the ownership guard parses the new migration), baseline 121 → 124.
7. FR-12: no tier literal in SQL.

**FAILED**
1. **Q-1** — the shadow RPC cannot accept a duplicate key in one payload, and B8 sends one. High; blocks §13.3 step 2.
2. **Q-2** — the reset's repair branch creates a row with NULL facts, against §4.3.
3. **Q-3 / Q-4** — the backfill checks pass vacuously on the prescribed database, and `service_role` access is never asserted.
4. **Q-7** — one TypeScript diagnostic in a new test file (contradicts §4.17's "0").

**BLOCKED — pending a throwaway/branch database** (every runtime claim in §4.17 and §13.3 is still a claim about SQL text)
1. Both migrations apply cleanly, in order, in one attempt.
2. A1–A9: RLS on, zero policies, no client privileges, function EXECUTE revoked, `search_path`/`lock_timeout` in `proconfig`, both triggers present, three named CHECKs.
3. B1/B3: the fact triggers record their fact, on one row, without overwriting `origin`.
4. B2: a trial cannot be restarted by deleting the transcript and replaying it — **the single most important behavioural claim in this component.**
5. B4: `tmp_fail` — a failing plan write never fails the product write.
6. B5: M-3 and S-4 reject the bad states.
7. B6: the reset ends overrides, rewrites in place, keeps `created_at` and the facts, moves `updated_at`, refuses blank cohort / NULL cohort / blank reason.
8. B7: the repair path (and, per Q-2, whether it should exist at all).
9. B8: the shadow upsert arithmetic (currently unreachable — Q-1).
10. C1/C2: the backfill's completeness and shape, on a database that actually has tenants (Q-3).
11. Re-run safety of the backfill, and its duration/row counts for RM.
12. `service_role` privileges and the PostgREST RPC round trip (`resetPlanState`, `recordEvents`) through supabase-js, including the schema-cache reload.
13. That a normal onboarding message and profile creation still succeed with the triggers live, with no `business_os_plan_fact_*` WARNINGs in the log.

---

### 14.6 Part B — the runnable database script (execute the moment a branch database exists)

**Never against production.** Use a Supabase **branch** database (or a throwaway project restored from a snapshot). Everything below is copy-pasteable. Use the **direct** connection string (port 5432), not the transaction pooler: the verification script uses a temp table and one long transaction.

```bash
export BOS_DB="postgresql://postgres:<pw>@db.<branch-ref>.supabase.co:5432/postgres"
# Refuse to continue if this is production.
psql "$BOS_DB" -Atc "select current_database(), inet_server_addr(), version();"
```

**Step 0 — make the backfill provable (fixes Q-3).** If the branch database has **no** pre-existing Business OS tenants, seed three before applying anything. Without this, C1/C2 prove nothing.

```sql
-- seed-tenants.sql  (run BEFORE either migration; keep the ids)
INSERT INTO auth.users (id, email, aud, role, created_at, updated_at)
VALUES ('00000000-0000-4000-8000-000000000001','seed1@example.invalid','authenticated','authenticated', now() - interval '90 days', now()),
       ('00000000-0000-4000-8000-000000000002','seed2@example.invalid','authenticated','authenticated', now() - interval '60 days', now()),
       ('00000000-0000-4000-8000-000000000003','seed3@example.invalid','authenticated','authenticated', now() - interval '30 days', now());
-- profile + transcript
INSERT INTO public.business_profiles (user_id, vertical) VALUES ('00000000-0000-4000-8000-000000000001','coach');
INSERT INTO public.onboarding_conversations (user_id, message_sequence, role, content, created_at)
VALUES ('00000000-0000-4000-8000-000000000001', 1, 'user', 'seed', now() - interval '89 days');
-- transcript only (the dormant-account case, S1-T11a)
INSERT INTO public.onboarding_conversations (user_id, message_sequence, role, content, created_at)
VALUES ('00000000-0000-4000-8000-000000000002', 1, 'user', 'seed', now() - interval '59 days');
-- profile only
INSERT INTO public.business_profiles (user_id, vertical) VALUES ('00000000-0000-4000-8000-000000000003','lawyer');
```
*If the `auth.users` insert is rejected* (the Supabase auth schema differs between versions — extra NOT NULL columns, or a `handle_new_user` trigger that fails): **substitute three existing auth user ids that are not Business OS tenants** —
```sql
SELECT u.id FROM auth.users u
LEFT JOIN public.business_profiles bp ON bp.user_id = u.id
LEFT JOIN public.onboarding_conversations oc ON oc.user_id = u.id
WHERE bp.user_id IS NULL AND oc.user_id IS NULL LIMIT 3;
```
and use those ids in the `business_profiles` / `onboarding_conversations` inserts above. **The same substitution applies to `scripts/verify-bos-entitlements-migration.sql`** — replace the `INSERT INTO auth.users` block in its `DO $$` at `:156-167` with two such ids written into `_bos_probe`, and keep everything else. *Pass/fail:* three tenant rows exist and none has a plan row yet.

**Step 1 — apply the two migrations, in order, and time them.**
```bash
time psql "$BOS_DB" -v ON_ERROR_STOP=1 -f supabase/migrations/20261005_business_os_entitlements.sql
time psql "$BOS_DB" -v ON_ERROR_STOP=1 -f supabase/migrations/20261005b_business_os_entitlements_backfill.sql
```
*Use a clean branch database:* the DDL uses `CREATE TABLE IF NOT EXISTS`, so a half-applied earlier attempt is skipped silently rather than corrected (the constraints would be missing and only A-section checks would notice).
*Pass:* both exit 0. *Fail:* any error; `lock_timeout` (`55P03`) means something held a lock on a parent table — retry when idle, and **record it**, because it is the failure mode M-1 is designed around.
*Record:* wall-clock duration of **each** file, especially `20261005b` (it scans `onboarding_conversations` in full — this is the number RM needs before production).

**Step 2 — run the verification script.**
```bash
psql "$BOS_DB" -v ON_ERROR_STOP=1 -f scripts/verify-bos-entitlements-migration.sql
```
*Expected:* the single row `business_os entitlements migration: all checks passed`, then `ROLLBACK`, preceded by the `NOTICE` from C3 reporting how many backfilled rows were checked. **Record that number.**
*Pass/fail:* every exception names the property that broke (`A1`…`A10`, `B1`…`B8c`, `M-2`…`M-5`, `R2-3`, `C0`…`C3`) — treat the name as the finding and stop.
*Superseded (2026-09-22):* the earlier expectation that this run would die at B8 with `ON CONFLICT DO UPDATE command cannot affect row a second time` no longer applies — that was **Q-1**, fixed by the RPC's `GROUP BY`. If it still happens, the fix has been lost.
*Checks added since the first QA pass, which this run is now also proving:* **A10** (`service_role` privileges), **B7**'s recovered facts, **B8/B8b/B8c**'s three-part arithmetic, and **C0/C3**'s non-vacuous backfill proof.

**Step 3 — the checks the script does not make.**
> ⚠️ **Run every query in step 3 in a separate psql session, outside the verification script.** The script's C0 creates a synthetic `origin = 'backfill'` row and then rolls the whole transaction back; counting from inside it would count that probe, and counting after it sees only what the real `20261005b` produced. That separation is what makes 3a evidence about the migration rather than about the script.

3a. **Backfill non-vacuity (Q-3).**
```sql
SELECT count(*) FILTER (WHERE origin = 'backfill')                                   AS backfilled,
       count(*) FILTER (WHERE origin = 'backfill' AND cohort = 'champion'
                             AND cohort_expires_at IS NULL AND tier IS NULL)         AS open_ended_champions,
       count(*)                                                                      AS total_plan_rows
FROM public.business_os_account_plans;
```
*Pass:* `backfilled >= 3` (the seeds), `open_ended_champions = backfilled`. *Fail:* `backfilled = 0` — the backfill did nothing and C1/C2 proved nothing.
3b. **`service_role` can still use the tables and the functions (Q-4), and who owns the DEFINER functions (Q-14).**
```sql
SELECT t AS table_name,
       has_table_privilege('service_role','public.'||t,'SELECT') AS sel,
       has_table_privilege('service_role','public.'||t,'INSERT') AS ins,
       has_table_privilege('service_role','public.'||t,'UPDATE') AS upd
FROM unnest(ARRAY['business_os_account_plans','business_os_entitlement_overrides','business_os_entitlement_shadow_events']) AS t;

SELECT p.proname, pg_get_userbyid(p.proowner) AS owner, p.prosecdef AS is_definer,
       has_function_privilege('service_role', p.oid, 'EXECUTE') AS service_role_can_execute
FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public' AND p.proname LIKE 'business_os_%';
```
*Pass:* all three tables `true/true/true`; `business_os_record_shadow_events` and `business_os_reset_plan_state` executable by `service_role`. *Fail:* any `false` → the migration must `GRANT` explicitly instead of relying on default privileges. *Record:* the owner of the two `…_plan_fact_…` functions.
3c. **Trigger binding (Q-8/A9).**
```sql
SELECT t.tgname, c.relname AS on_table, p.proname AS calls,
       (t.tgtype & 4)::boolean AS on_insert, (t.tgtype & 1)::boolean AS for_each_row, (t.tgtype & 2) = 0 AS is_after
FROM pg_trigger t JOIN pg_class c ON c.oid = t.tgrelid JOIN pg_proc p ON p.oid = t.tgfoid
WHERE NOT t.tgisinternal AND t.tgname LIKE 'business_os_plan_on_%';
```
*Pass:* exactly two rows — `…_on_onboarding` on `onboarding_conversations`, `…_on_profile` on `business_profiles`, both AFTER INSERT FOR EACH ROW.

3d. **The fact heal (QA Q-5's fix, and the one statement no database-side check exercises — QA Q-19).** The verification script proves the backfill's `INSERT` (C0) but never runs the `UPDATE … COALESCE` that fills a gap row's missing fact. Prove it directly, in its own transaction, and roll back:
```sql
BEGIN;
-- A gap row: the profile trigger fired between the two migrations, so the row
-- exists with ONE fact, and the backfill's INSERT skipped it on conflict.
-- (Use a seeded tenant that has BOTH a transcript and a profile.)
UPDATE public.business_os_account_plans
   SET onboarding_started_at = NULL, cohort = 'trial', origin = 'profile_trigger',
       updated_at = now() - interval '1 hour'
 WHERE user_id = '<seed1>';

-- …now run ONLY the heal statement from 20261005b (copy it verbatim from the file).
-- Then:
SELECT onboarding_started_at =
         (SELECT min(created_at) FROM public.onboarding_conversations WHERE user_id = '<seed1>') AS fact_healed,
       cohort   AS cohort_must_still_be_trial,
       origin   AS origin_must_be_unchanged,
       tier IS NULL AND trial_started_at IS NULL AND trial_ends_at IS NULL AS pins_untouched
FROM public.business_os_account_plans WHERE user_id = '<seed1>';

-- Inertness: run the same heal statement a second time and confirm updated_at
-- does not move.
ROLLBACK;
```
*Pass:* `fact_healed = true`, `cohort = 'trial'` (the heal must **not** promote a gap row to champion — that is the launch operation's job), `origin` unchanged, `pins_untouched = true`, and the second pass leaves `updated_at` where the first pass put it.
*Fail:* a moved `updated_at` on the second pass means the `EXISTS` guards are not doing their job and the migration is not inert; a changed cohort means the heal is doing more than healing.

**Step 4 — re-run the backfill and prove it is inert.**
```sql
SELECT md5(string_agg(user_id::text || coalesce(cohort,'') || coalesce(origin,'') ||
     coalesce(cohort_expires_at::text,'') || updated_at::text, '|' ORDER BY user_id)) AS fingerprint,
     count(*) FROM public.business_os_account_plans;   -- before
```
```bash
time psql "$BOS_DB" -v ON_ERROR_STOP=1 -f supabase/migrations/20261005b_business_os_entitlements_backfill.sql
```
Re-run the fingerprint query. *Pass:* identical fingerprint and count; `INSERT 0 0` in the output. *Fail:* any change — the backfill is not idempotent.
*Why this step matters more than it did:* the file now contains the fact-heal `UPDATE` as well as the insert, and SA's §13.4 is right that its inertness is a **property, not an accident** — it holds only because of the two `EXISTS` guards. The fingerprint includes `updated_at`, so a heal that rewrites rows on every run shows up here as a changed fingerprint with an unchanged row count. Record `UPDATE 0` from the second run as well as `INSERT 0 0`.

**Step 5 — trigger-created rows stay trials, and the window hazard is measured (Q-5).**
```sql
-- a signup arriving after the migrations must stay a trial
INSERT INTO public.onboarding_conversations (user_id, message_sequence, role, content)
VALUES ('<a fresh seeded auth user id>', 1, 'user', 'post-migration signup');
SELECT cohort, origin, onboarding_started_at IS NOT NULL AS fact_recorded
FROM public.business_os_account_plans WHERE user_id = '<that id>';
```
*Pass:* `trial` / `onboarding_trigger` / `true`. Converting it to a champion is the launch operation's job at switch-on, not the backfill's.
5b. **The window query** — run on production right after the real apply, and here to confirm it returns what you expect:
```sql
SELECT p.user_id, p.origin, p.cohort, p.onboarding_started_at, p.profile_created_at
FROM public.business_os_account_plans p
WHERE p.origin IN ('onboarding_trigger','profile_trigger')
  AND (EXISTS (SELECT 1 FROM public.onboarding_conversations o
               WHERE o.user_id = p.user_id AND o.created_at < p.created_at)
       OR EXISTS (SELECT 1 FROM public.business_profiles b
                  WHERE b.user_id = p.user_id AND b.created_at < p.created_at));
```
*Meaning:* every row returned is a **pre-existing** tenant that the trigger caught in the gap between the two migrations and the backfill then skipped. *Pass:* zero rows. *If non-zero:* heal each one to `cohort = 'champion'`, `cohort_expires_at = NULL`, and set the missing fact from its own history. **Record the count.**

**Step 6 — numbers to write down for RM.**

| Measurement | Query / source |
|---|---|
| `20261005` duration | `time` output, step 1 |
| **`20261005b` duration** | `time` output, step 1 — the number RM needs before production |
| Rows created by the backfill | `SELECT count(*) FROM business_os_account_plans WHERE origin = 'backfill';` |
| Tenants total | `SELECT count(*) FROM (SELECT user_id FROM business_profiles UNION SELECT user_id FROM onboarding_conversations) t;` |
| Missing plan rows (must be 0) | the C1 query in the verification script |
| Open-ended champions with **no business profile** (the S1-T11a trim list) | `SELECT count(*) FROM business_os_account_plans WHERE cohort='champion' AND cohort_expires_at IS NULL AND profile_created_at IS NULL;` |
| Rows caught in the migration window | step 5b |
| `onboarding_conversations` row count (explains the scan time) | `SELECT count(*) FROM onboarding_conversations;` |

**Step 7 — the product still works with the triggers live.**
1. Insert an onboarding message and create a business profile for a fresh user (as in step 5), through the app if the branch is wired to one, otherwise by SQL. *Pass:* both writes succeed with no perceptible delay.
2. `select * from pg_stat_statements where query ilike '%business_os_account_plans%'` (if available), and scan the database log for `business_os_plan_fact_`. *Pass:* **no WARNING lines.** A WARNING means the plan write failed silently — the product is fine, but the row is missing and the cause must be found before production.
3. **PostgREST round trip** (the repositories talk through supabase-js, not psql). With the branch's service-role key:
   ```bash
   curl -sS -X POST "$SUPABASE_URL/rest/v1/rpc/business_os_reset_plan_state" \
     -H "apikey: $SERVICE_KEY" -H "Authorization: Bearer $SERVICE_KEY" -H "Content-Type: application/json" \
     -d '{"p_user_id":"<seed1>","p_cohort":"champion","p_cohort_expires_at":null,"p_trial_started_at":null,"p_admin_id":"<any uuid>","p_reason":"qa round trip"}'
   ```
   *Pass:* the plan row comes back as JSON. *If* `Could not find the function … in the schema cache`: run `NOTIFY pgrst, 'reload schema';` and retry — and note it, because RM must do the same in production.
   Then the negative: the same call with the **anon** key must return `42883`/permission denied.

**Exit criteria for the database phase:** steps 1–7 all pass, B8/B8b/B8c prove the fold-and-sum arithmetic, C3's `NOTICE` count is non-zero, step 3a's count (measured **outside** the script) is non-zero, step 3b is all `true`, step 3d heals the fact without touching the cohort and is inert on a second pass, step 5b returns zero rows (or the healed rows are recorded), and the `20261005b` duration is written into §15 for RM.

---

### 14.7 Needs a decision from the user / TL

1. **Q-1 must be fixed before this component is committed.** It is a ten-line change to one SQL function plus the B8 expectation. Shipping without it means the migration's own verification script cannot be run to completion, and component 4 can silently lose shadow batches.
2. **Q-2 is a small product decision:** should the admin reset be able to **repair** an account that has no plan row (and therefore re-derive its facts), or should repair be `ensure_plan_row`'s job only? The code currently does the first badly. Either answer is fine; the docs and the script then need to match it.
3. **A branch database is still required.** Thirteen properties — including "a customer cannot reset their way into a fresh trial", the single most important guarantee in this component — remain unproven. §14.6 is written to be run unattended the moment one exists.
4. **Q-9, the migration numbering**, is worth a decision before RM applies anything: the files sort ~40 positions before migrations that are already live.

### Final Status (2026-09-21 — superseded by §14.8.6)
- [ ] All acceptance criteria pass — ready for commit
- [x] **Issues found — Dev must address Q-1 (High) before commit; Q-2/Q-3/Q-4/Q-5 before the migration is applied anywhere.**
- [x] **13 database-dependent checks remain BLOCKED.** Component 1 must not be applied to any database until §14.6 has been run on a branch database.

### 14.7a Note on the file:line citations above

§14.1 to §14.5 are the dated record of the 2026-09-21 pass and are left as written. The two migrations were **renamed** afterwards (Q-9), so every `20260921…` path in §14.4 refers to what is now `20261005_business_os_entitlements.sql` / `20261005b_business_os_entitlements_backfill.sql`, and the line numbers are pre-fix. §14.6 has been rewritten against the current tree and is the runnable one.

### 14.8 Re-verification after Dev's fixes — QA, 2026-09-22

Against Dev's §4.18 (workplan `0cc87014`) and SA's §13.4. Implementation still uncommitted. **Same constraint: no database in this environment, and production is out of bounds.** Everything below was re-run or re-read by QA; nothing is taken from Dev's report.

**Verdict: ✅ READY FOR USER REVIEW AND COMMIT.** Every prior finding is fixed, and the fixes are real rather than cosmetic — three of them are checks that would now *fail* if the behaviour regressed. Four small things remain (§14.8.3), none blocking: one is SA's own F-5, two are further vacuity trims to the verification script, one is a guard hole this narrowing opened. **The database phase is unchanged in status and larger in scope** (§14.8.4).

#### 14.8.1 What QA re-ran

| Command | Result |
|---|---|
| `jest lib/repositories/__tests__ supabase/migrations/__tests__ lib/business-os/purge/__tests__ lib/business-os/__tests__/businessOwnedTables lib/admin/__tests__ --ci` | ✅ **35 suites, 462 tests, 0 failures** — Dev's number confirmed exactly |
| `jest` over component 1's five suites only | ✅ **5 suites, 74 tests** — confirmed |
| `jest lib/admin/__tests__/admin-authz-surface.guard.test.ts --ci` | ✅ **74 tests**, no new exemption (component 1 still adds no route) |
| `eslint --config eslint.hooks.config.mjs --no-config-lookup --no-inline-config --max-warnings 0` over the seven changed/created `lib` files | ✅ exit 0 |
| `console.*` in the touch set | ✅ **0**, including the new import guard |
| **Typecheck, Dev's method, verified rather than accepted:** `NODE_OPTIONS=--max-old-space-size=8192 tsc --noEmit -p tsconfig.json --typeRoots <main>/node_modules/@types` | ✅ **exit 1, 2,030 diagnostics, 0 × TS2688** — Dev's numbers reproduced to the digit. **It genuinely examines the component's files:** the same run reports **3** errors in other `lib/repositories/*.ts` files (`CRMContactRepository`, `CalibrationSessionRepository`, `WebsiteContentRepository`) and **6** under `supabase/`, so those trees are in the program; **0** diagnostics fall in any component 1 file. Cross-checked against an independent TS program rooted only at the 11 changed files: **0 diagnostics**. Q-7 is genuinely fixed, and so is the method. |

#### 14.8.2 Prior findings — re-verified one by one

| # | Prior severity | Verdict | Evidence QA checked (not Dev's claim) |
|---|---|---|---|
| **Q-1** | High | ✅ **FIXED** | The RPC now aggregates before inserting. `GROUP BY r.user_id, r.capability, r.surface, r.outcome, r.rule, 6` — the `6` is the ordinal of the `COALESCE(r.day, …)` output column, which is valid and also folds a NULL `day` together with an explicit today. `now()` in the select list is legal ungrouped (it references no column). `(array_agg(x) FILTER (WHERE x IS NOT NULL))[1]` is valid subscripting of a parenthesised expression and yields NULL, not an error, when every sample is NULL. The `ON CONFLICT` arithmetic is untouched, so cross-call summing still works. **B8 is now three discriminating checks:** fold-within-call (5/6/9), sum-across-calls with a NULL sample not overwriting a stored one (9/8/9, `c1`), and two surfaces staying two rows — each with a number that a broken `GROUP BY` would miss. A guard test pins the `GROUP BY` and the `SUM`/`MAX` expressions. |
| **Q-2** | Medium | ✅ **FIXED** | The reset's INSERT branch now carries `onboarding_started_at, profile_created_at` from `min(oc.created_at)` and the profile's `created_at`; the `DO UPDATE` branch still omits both, so an existing row's facts stay untouched. `business_profiles.user_id` is UNIQUE, so the scalar sub-select cannot raise "more than one row". B7 asserts the fact is recovered and that no profile fact is invented for an account with none — **but see Q-20: B7 cannot tell `min(created_at)` from `now()` on its own data.** |
| **Q-3** | Medium | ✅ **FIXED (with one residue)** | C0 makes a genuine pre-existing tenant — history written with a **backdated** `created_at`, plan row deleted — runs the backfill statement over it, and asserts open-ended champion + facts from history + no tier. It cannot pass vacuously: an insert of nothing trips `C0 the backfill statement created no row`, and the backdated `2024-05-06` fact would not survive a `now()` implementation. C1's probe exclusion is correct, and the `WHERE user_id IS NOT NULL` inside it is load-bearing (see Q-21). **Residue:** C3 can only fail if C0 already failed, and neither says anything about the real `20261005b` having been applied to *this* database — that is what §14.6 step 3a, run outside the script, is for. The runbook now says so explicitly. |
| **Q-4** | Medium | ✅ **FIXED** | The migration states `GRANT SELECT, INSERT, UPDATE … TO service_role` instead of inheriting it, and A10 asserts all three tables read/write plus EXECUTE on both callable functions, with an `n <> 2` non-vacuity count. Withholding DELETE matches the design (the module never deletes); SA's note that a future retention job must add it deliberately is the right consequence. |
| **Q-5** | Medium | ✅ **FIXED, and fixed properly** | The heal fills only NULL facts, from the tenant's own history, and touches nothing else. QA traced the inertness claim: the `SET` writes both facts and `updated_at`, so inertness rests entirely on the `WHERE (fact IS NULL AND EXISTS …) OR …` — after one pass no row satisfies it, and a row whose fact is legitimately absent (no profile yet) never satisfies it at all. It cannot promote a gap row's cohort, so the trial-restart guarantee is untouched. Interaction with the live triggers is safe: a concurrent trigger contending for the same row waits at most its own `lock_timeout = 2s`, then raises into its `EXCEPTION WHEN OTHERS` and becomes a WARNING — the product write still succeeds. **No database-side check exercises it** (Q-19); §14.6 step 3d now does. |
| **Q-6** | Low | ✅ **FIXED** | `updatePlan` clears the paired expiry when an assignment is cleared, and deliberately does not overrule an expiry the caller set explicitly. Two tests, both discriminating. Route obligation kept as S1-T12a. |
| **Q-7** | Note | ✅ **FIXED** | `as unknown as`; 0 diagnostics over all 11 files. Dev also corrected §4.17's false "0 diagnostics" claim rather than quietly replacing it — that is the right handling of a wrong measurement. |
| **Q-8** | Low | ✅ **FIXED** | A9 now joins `tgrelid`/`tgfoid` and masks `tgtype` for AFTER/INSERT/ROW (bit math verified: 1 = ROW, 2 = BEFORE, 4 = INSERT). The CHECK assertions compare `pg_get_constraintdef` against the expression each claims to enforce, so `CHECK (true)` under the same name now fails. The test stub **defines** `delete` and asserts it was never called, so the assertion is about the repository again. |
| **Q-9** | Note | ✅ **FIXED** (one straggler) | Both files renamed; they now sort after `20261004`, and `20261005b` still sorts after `20261005`. **Not every in-repo reference was updated** — see Q-22. |
| **Q-10** | Note | ✅ **FIXED** | The new import guard is symbol-level (correct: a barrel import names no file), scans five trees, has an **empty** application-code allow-list, and carries two meta-assertions — "more than 500 files scanned" (a broken walk would pass everything) and "every ALLOWED entry names a file that exists" (a stale entry would silently widen it). Both are the right guards on a guard. |
| **Q-11** | Note | ✅ **FIXED** | The header now states the exception instead of a false universal, and names which reads are account-wide and why. |
| **Q-12 / F-1** | Info | ✅ **RECORDED** | S1-T14 now requires **both** `supabase/migrations/__tests__` and `lib/repositories/__tests__` in the component 2 CI job. Still true today that no workflow runs either — confirmed again against the five workflows. |
| **Q-13** | Low | ✅ **FIXED** | `ensurePlanRow` trims and refuses a blank cohort before touching the database, returning an error rather than throwing. Route-level `z.enum` kept as S1-T12a, which is the right split: the repository can refuse *blank*, only config can refuse *unknown*. |
| **Q-14** | Note | ➖ **UNCHANGED, correctly** | Ownership is a deployment property; §14.6 step 3b records `proowner`. Agreed — no file change was available. |
| **Q-15** | Low | ✅ **FIXED** | `updatePlan` logs a `warn` on a no-row update and documents that the route pre-checks; a test pins the contract. |

**On the narrowed M-1 guard (the change SA and the coordinator both flagged for scrutiny).** QA re-derived it rather than trusting either. Two mental regressions:

1. **A top-level backfill scan re-introduced into the DDL migration** — `INSERT INTO public.business_os_account_plans … SELECT … FROM public.business_profiles …`. **Still caught, twice:** `ddlTopLevel` (bodies stripped) matches `FROM public.business_profiles`, and the targeted check finds a top-level `INSERT … SELECT` into the plan table. ✅
2. **A scan inside a function body** — the reset's fact recovery. **Correctly allowed:** it runs when the function is called, not inside the migration's transaction, so it never holds a trigger lock. The meta-assertion ("the un-stripped text contains what the stripped text does not") means the stripper cannot start hiding everything without the suite going red. ✅

The narrowing is right. **But it opened one hole — Q-18 below.**

#### 14.8.3 Remaining findings (none blocking; all Low)

**Q-18 — the narrowed M-1 guard no longer catches a backfill hidden behind a top-level function *call*. Severity: Low.**
- File: `supabase/migrations/__tests__/business-os-entitlements.migration.test.ts:49-51, 71-87`.
- Stripping `$$ … $$` is right for a function *definition*. But a future edit could add `CREATE FUNCTION public.business_os_backfill() … $$ SELECT … FROM public.onboarding_conversations … $$;` **and then call it** — `SELECT public.business_os_backfill();` — at the top level of the same migration. The scan then runs inside the DDL transaction, while `CREATE TRIGGER` holds ACCESS EXCLUSIVE on both parent tables: the exact M-1 harm. The body is stripped, so `:76` passes; it is not an `INSERT … SELECT`, so `:83` passes. The old file-wide guard would have caught it by accident.
- **Fix (cheap and strictly better than either version):** assert the schema migration contains **no top-level DML at all** — after stripping comments and bodies, every statement should start with `BEGIN`/`COMMIT`/`SET`/`CREATE`/`ALTER`/`REVOKE`/`GRANT`/`COMMENT`/`DROP TRIGGER`. Anything else (`INSERT`, `UPDATE`, `DELETE`, `SELECT`, `DO`, `CALL`) fails. That catches both regressions and states the actual rule: *this migration changes schema and nothing else.*

**Q-19 — the fact heal has no database-side check. Severity: Low (was the highest-risk new SQL in this round).**
- Files: `supabase/migrations/20261005b_business_os_entitlements_backfill.sql:79-96`; `scripts/verify-bos-entitlements-migration.sql` (no coverage).
- C0 proves the backfill's `INSERT`; nothing runs the `UPDATE … COALESCE`. Its healing behaviour, its "never touches a cohort" property and its inertness are asserted only by regex in the Jest guard. SA is right that the inertness is a property rather than an accident, which is exactly why it deserves a behavioural check.
- **Covered for now by §14.6 step 3d** (QA added it), and worth folding into the script as a `C4` so it runs with everything else.

**Q-20 — B7's "is it the *first* message?" assertion cannot fail. Severity: Low.**
- File: `scripts/verify-bos-entitlements-migration.sql:503-505`.
- tenant2's only onboarding row is inserted in B4 with the default `created_at = now()`, and the whole script is one transaction, so `min(created_at)`, `now()` and the transaction timestamp are the same value. A repair that wrote `now()` instead of reading history would satisfy the comparison. The **first** assertion (`onboarding_started_at IS NULL`) still has teeth and is the one that catches the actual Q-2 bug, so the fix is proven — the *correctness of the recovered value* is not.
- This is the same `now()`-inside-one-transaction trap B1 documents and works around by backdating, and C0 gets right.
- **Fix:** before the reset in B7, insert an **older** message with an explicit `created_at` (e.g. `timestamptz '2021-03-04 05:06:07+00'`) and assert the recovered fact equals that literal.

**Q-21 — C1's probe exclusion is one edit away from being permanently vacuous. Severity: Low (advisory).**
- File: `scripts/verify-bos-entitlements-migration.sql:667`.
- `NOT IN (SELECT user_id FROM _bos_probe WHERE user_id IS NOT NULL)` is correct **because** of that `WHERE`. `_bos_probe` does contain a row with a NULL `user_id` (`first_fact`), and `NOT IN` over a set containing NULL evaluates to NULL for every row — `missing` would be 0 forever and C1 would never fail again. Dev got it right; the point is that the correctness is invisible to the next reader.
- **Fix:** use `NOT EXISTS (SELECT 1 FROM _bos_probe b WHERE b.user_id = tenants.user_id)`, which has no NULL trap to get wrong.

**Q-22 — three in-repo references still name the deleted migration. Severity: Trivial.**
- `lib/repositories/BusinessOsAccountPlanRepository.ts:7` and `lib/repositories/BusinessOsEntitlementShadowRepository.ts:7` — this is SA's **F-5**, still open in the working tree.
- Additionally `docs/workplans/…§4.15 S1-T7` still names `20260921…`, so §4.18's "Every in-repo reference updated" is not quite true. §13.3's copies are a dated record and should stay.

**Q-23 — two smaller notes.**
- `scripts/verify-bos-entitlements-migration.sql:641-647`: C0's "a second backfill pass duplicated the row" cannot fail — `user_id` is the primary key, so `ON CONFLICT DO NOTHING` could not duplicate it however broken the statement were. Harmless, but it is not evidence; the real idempotency evidence is §14.6 step 4.
- `…:590-620`: C0's INSERT is a hand-kept **copy** of the migration's statement (Dev says so in the comment). If `20261005b`'s `SELECT` changes and the copy does not, C0 keeps proving the old statement and keeps passing — the vacuity class this whole review is about. Worth a Jest assertion that the two statements match modulo the `WHERE` clause and whitespace. Not a blocker: the properties C0 asserts are the ones that matter, and the comment names the obligation.
- Cosmetic: `stripFunctionBodies`'s replacement string `'$$<<function body omitted>>$$'` resolves to a single `$` on each side (JS `replace` treats `$$` as an escaped `$`). Nothing depends on it. Also noted by SA, along with the fact that a future `$tag$`-quoted body simply would not be stripped — which fails safe.

#### 14.8.4 BLOCKED on a database — the current list

Unchanged in status, larger in scope: the fixes added four more properties that only a database can prove. **`scripts/verify-bos-entitlements-migration.sql` has still never been executed.**

| # | Property | Where it is proven |
|---|---|---|
| 1 | Both migrations apply cleanly, in order, on a clean branch database | §14.6 step 1 |
| 2 | A1–A9: RLS on, zero policies, no client privileges, EXECUTE revoked, `search_path`/`lock_timeout` pinned, both triggers bound to the right table/event/function, three named CHECKs that check what they claim | script, step 2 |
| 3 | **A10 (new): `service_role` can read/write all three tables and execute both functions** | script, step 2 + §14.6 step 3b |
| 4 | B1/B3: the fact triggers record their fact, on one row, without overwriting `origin` | script |
| 5 | **B2: a trial cannot be restarted by deleting the transcript and replaying it** — still the single most important claim in this component | script |
| 6 | B4: a failing plan write never fails the product write | script |
| 7 | B5: M-3 and S-4 reject the bad states | script |
| 8 | B6: the reset ends overrides, rewrites in place, keeps `created_at` and the facts, moves `updated_at`, refuses blank cohort / NULL cohort / blank reason | script |
| 9 | **B7 (extended): the repair recovers the facts** — with Q-20's caveat that "the *right* fact" is not yet proven | script |
| 10 | **B8/B8b/B8c (new): duplicate keys folded in one call, summed across calls, distinct surfaces kept apart** | script |
| 11 | **C0/C3 (new): the backfill statement proved against a real pre-existing tenant, non-vacuously** | script |
| 12 | C1/C2 on data that actually has tenants, measured **outside** the script | §14.6 step 0 + 3a |
| 13 | **The fact heal fills a gap row, touches no cohort/tier/pin, and is inert on a second pass** | §14.6 step 3d (Q-19) |
| 14 | Backfill re-run safety, and its duration + row counts for RM | §14.6 step 4 + 6 |
| 15 | The PostgREST round trip through supabase-js (`resetPlanState`, `recordEvents`), including a schema-cache reload, and the anon-key refusal | §14.6 step 7.3 |
| 16 | A normal onboarding message and profile creation still succeed with the triggers live, with no `business_os_plan_fact_*` WARNINGs | §14.6 step 7 |

#### 14.8.5 For the user

1. **Component 1 is ready for your code review and for RM to commit.** Every QA finding is fixed, and the fixes are backed by checks that can fail.
2. **It must still not be applied to any database until §14.6 has been run on a branch database.** Sixteen properties are unproven, including the trial-restart guarantee this whole component exists to provide.
3. **One trivial fix is outstanding** — SA's F-5, two stale file references in the repository headers (Q-22). It changes no behaviour; RM can take it with the commit or Dev can fold it in first.
4. Q-18 to Q-21 are **improvements to the tests, not to the product.** They can land with component 2 alongside the CI job that will finally run these suites (F-1). None of them changes what the migration does.

#### 14.8.6 Final Status (supersedes the 2026-09-21 block above)

- [x] **All findings from the first QA pass are fixed and independently re-verified — component 1 is ready for the user's code review and for RM to commit.** 35 suites / 462 tests green, component 1's own 74 green, admin authz guard green with no new exemption, hooks lint clean, 0 `console.*`, 0 typecheck diagnostics in the component's files under a typecheck that provably covers them.
- [x] **Four Low findings remain open (Q-18 to Q-23), none blocking.** One is SA's F-5 (two stale file references); the rest are test-quality items best landed with component 2's CI job.
- [x] **16 properties remain BLOCKED on a branch database** (§14.8.4). **Do not apply either migration anywhere until §14.6 has been run.** Committing the code and applying the migration are separate decisions, and only the first is unblocked.

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
| 2026-09-21 | Rev 3: merge of `main`, component breakdown, three user additions (Dev) | Re-verified §2 against the merged tree (`92580639`): `requireAdmin` is now the canonical admin gate with a repo-wide CI guard (R1–R6) that is a **required status check** on `main`; five workflows exist; `boost-packs` and the `new-api-route` skill are fixed (**S-12 closed**); chat-v4's plan call moved to ~L860; the `is…Enabled` flag-naming rule and the named-privilege revoke convention apply. Added **§4.0**, the user-approved five-component PR sequence, and **§1.4**, the per-component flow (Dev → SA → QA → user code review → RM commits; Dev does not commit implementation). Folded in **A-1** `tier_expires_at` with explicit expired-tier fallback semantics and one "no end date" report list covering champions and tier assignments; **A-2** the three-step decision contract (`not_entitled` → `read_only` → `limit_reached`) with a stubbed balance seam so Slice 3 changes no call site, `entitlement_unavailable` kept distinct; **A-3** the `reset_plan_state` admin op with a single-transaction RPC, an explicitly chosen cohort, confirmation guards and a full before-state audit. Folded SA's R2-1 to R2-4 into the tasks. Rewrote §4.14 to reuse the existing workflows and add only the entitlement Jest job, and rewrote G-2 against the live branch protection. |
| 2026-09-21 | SA re-check of rev 3: CLEARED TO IMPLEMENT COMPONENT 1 (SA) | Added §13.2. Independently verified the new-main facts (`requireAdmin`, the guard's R1–R6 with equality-asserted caps, the single required check on `main`). Confirmed our three admin routes and the policy-free migration pass R1–R6 with zero new exemptions, provided each exported handler contains its own literal `requireAdmin(` call. Approved §4.0, §4.8 (A-1 fallback, A-2 three-step contract), §4.9 (`check()` + balance seam), §4.12, §4.14/G-2. Migration approved with M-1 to M-6: split the backfill out of the DDL transaction and bound its lock wait (CREATE TRIGGER holds ACCESS EXCLUSIVE on both parent tables); the A-3 reset ends overrides and updates the plan row in place instead of deleting and recreating, so the durable admin record survives (WC-7); two CHECKs pairing each expiry with its assignment, plus a 409 on `set_expiry`; blank-cohort refusal; `updated_at` maintained; verification script extended. Final SQL is approved at component 1 code review. |
| 2026-09-21 | Component 1 built (Dev) | Implemented plan records + migration against SA's §13.2 clearance and M-1 to M-6: the backfill moved into its own migration with bounded lock waits (M-1); the reset RPC now ends overrides and rewrites the plan row in place (M-2); paired end-date CHECK constraints added (M-3); the reset refuses a blank cohort, a missing admin and a blank reason (M-4); `updated_at` maintained by every writer (M-5); the verification script extended to cover all of it (M-6). Added two repositories, `getFirstMessageAt`, the purge/ownership registrations, three unit suites and a migration guard test. §4.15 ticked, §4.17 records the as-built detail, the verification performed, and the fact that the SQL has not been run against any database. Implementation left uncommitted for review per §1.4. |
| 2026-09-21 | SA code review of component 1: APPROVED, cleared for QA (SA) | Added §13.3. Final approval of the migration SQL deferred from §13.2. Verified M-1 to M-6 in the files (no parent-table scan under the trigger locks, backfill in its own transaction, reset with no DELETE that ends overrides and rewrites in place keeping created_at and the facts, both expiry CHECKs, blank-cohort refusal, `updated_at` written by every writer, verification script extended). Ran the suites: 96 tests across the migration guard, both repositories, `getFirstMessageAt`, the purge invariants and `businessOwnedTables`, plus `test:authz-guard` (74) and `lint:hooks` — all green; purge baseline 121 → 124. Standards, tenant isolation, RLS/revokes and DEFINER hardening all pass. Four non-blocking fixes: F-1 add `supabase/migrations/__tests__` to the component 2 CI script (binding, or the guard never runs in CI), F-2 comment/behaviour mismatch on the batch limit, F-3 reason comments on the `any` test stubs, F-4 optional upsert for `ensurePlanRow`. The migration has NOT been run against any database; §13.3 lists the seven steps QA must run on a branch database. |
| 2026-09-21 | Component 1: SA review fixes applied (Dev) | F-2 corrected the batch-method comment (the code was right). F-3 gave each test builder stub the rule 6 reason for its `any`. F-4 made `ensurePlanRow` race-safe with `upsert(..., { ignoreDuplicates: true })` plus a read-back, so a racing provisioning trigger reports `created: false` instead of a 500 — contract unchanged, one new test. F-1 recorded as a binding component 2 task (the migration guard must be in the `test:bos-entitlements` path list, or nothing runs it in CI). Added S1-T11a: the report's no-end-date list must flag accounts with no business profile, so the pre-enforcement trim of onboarding-only champions is deliberate. Code remains uncommitted for QA. |
| 2026-09-21 | QA of component 1: PASS WITH FINDINGS, database phase BLOCKED (QA) | Added §14. Ran independently: the six component-1 suites (97 tests), the whole `lib/repositories/__tests__` folder (263) as a regression on the barrel change, the admin-authz guard + purge suites (132), `lint:hooks` and a scoped typecheck built from the changed files. M-1 to M-5 verified in the SQL text; RLS/revokes, DEFINER hardening, field allow-list, both-key override scoping and the F-4 race path all pass. **Q-1 (High): the shadow RPC raises `ON CONFLICT DO UPDATE command cannot affect row a second time` on two rows with the same key in one call, and the verification script's B8 sends exactly that — so §13.3 step 2 cannot complete, and component 4 can silently lose a batch; fix is to aggregate in the RPC.** Q-2: the reset's repair branch creates a row with NULL facts (against §4.3), and the M-1 guard regex is broad enough to forbid the fix. Q-3: C1/C2 pass vacuously on the clean branch database SA prescribes. Q-4: nothing asserts `service_role` still has access. Q-5: the gap between the two migrations can leave a pre-existing tenant as a trial with a missing fact. Plus Q-6..Q-15 (notes, weak assertions, TS2352 in a new test, F-1 confirmed, migration filename sorts ~40 files early). §14.6 is the exact runnable database script for SA's seven steps plus the four checks they do not cover. |
| 2026-09-22 | Component 1: QA findings fixed (Dev) | Q-1 the shadow RPC folds duplicate keys (`GROUP BY`) instead of raising 21000 and losing the batch; the repository comment now matches the code. Q-2 the reset's repair branch recovers the facts again, and the M-1 guard was narrowed to top-level DDL (it had been forbidding a read inside a function body) with a meta-assertion that the narrowing hides nothing — **SA to confirm at re-review**. Q-3 the verification script proves the backfill non-vacuously (new C0/C3) and no longer depends on B7's ordering. Q-4 explicit `service_role` grants plus an A10 assertion. Q-5 the backfill heals facts the trigger could not fill, and §8 carries the RM ordering requirement. Q-9 migrations renamed to 20261005/20261005b. Q-8 trigger and constraint checks assert binding and definition, and the stub assertion is real. Q-7 fixed, and the typecheck method corrected: the worktree run had been aborting on TS2688 and checking nothing (2,030 baseline diagnostics, 0 in these files). Q-10 RC-15 import guard added. Q-11 scoping comments corrected. Q-13/Q-6/Q-15 hardened in the repository and recorded as binding route work in S1-T12a. F-1/Q-12 restated for component 2. Code still uncommitted. |
| 2026-09-22 | SA confirmation of the QA-driven changes to component 1 (SA) | Added §13.4. Confirmed all three: narrowing the M-1 guard (a correction, not a weakening — the assertion SA approved forbade a function-body read that never runs under the trigger locks, and had silently removed approved behaviour; the meta-assertion stops the stripper passing vacuously), restoring the reset repair branch fact recovery (better than SA's §13.2 wording, since the repair branch has no row to preserve facts from and AFTER INSERT triggers could never fill them later), and the explicit `service_role` GRANT with DELETE withheld (plus the EXISTS-guarded backfill fact heal and the 20261005/20261005b rename). Approval of the migration SQL stands for the renamed files. Re-ran the suites: 7 suites, 114 tests, all green. One trivial fix F-5: the two repository headers still cite the old migration filename. |
| 2026-09-22 | QA re-verification of component 1: READY FOR REVIEW AND COMMIT (QA) | Added §14.7a and §14.8; §14.6 updated for the renamed migrations and the four new database checks. Re-ran everything independently: 35 suites / 462 tests, component 1's own 74, the admin authz guard's 74 with no new exemption, hooks lint clean, 0 `console.*`. Reproduced Dev's corrected typecheck to the digit (2,030 project diagnostics, **0** TS2688, 0 in the component's files) and proved it really covers them (3 errors in other `lib/repositories` files, 6 under `supabase/`). Q-1 to Q-15 all verified fixed against the files, not the claims: the RPC's `GROUP BY` (ordinal 6 is the COALESCE'd day; `now()` is legally ungrouped; the FILTERed `array_agg` subscript is safe), the reset's recovered facts with the `DO UPDATE` branch still untouched, C0's backdated synthetic tenant, A10's positive privilege check, and the heal's inertness traced to its two `EXISTS` guards. Re-derived the narrowed M-1 guard both ways: a top-level backfill scan is still caught twice, a function-body scan is correctly allowed. Four Low findings remain, none blocking: **Q-18** the narrowing lets a backfill hidden behind a top-level function *call* through (fix: forbid top-level DML outright), **Q-19** no database-side check exercises the new fact heal (added as §14.6 step 3d), **Q-20** B7's "is it the first message" assertion cannot fail because `now()` and `min(created_at)` are the same value inside one transaction, **Q-21/Q-23** C1's probe exclusion is one edit from permanent vacuity and C0's copy of the backfill can drift. **Q-22: SA's F-5 is still open** — two repository headers cite the deleted `20260921…` file. BLOCKED list grew from 13 to 16 properties; the migration must still not be applied anywhere until §14.6 is run. |
| 2026-09-22 | Component 1: QA re-verification findings closed (Dev) | Q-18 the M-1 guard now asserts the schema migration contains **no top-level DML at all** (statement whitelist + a negative control that feeds it both regression shapes), which closes the hole a stripped function body plus a top-level call left open; the splitter ignores semicolons inside quoted strings. Q-20 B7's fact assertion compares a backdated literal, inserted in B4 while the plan table refuses writes, so a `now()` repair would fail it. Q-21 C1 uses `NOT EXISTS` instead of a `NOT IN` whose correctness hung on one `WHERE`. Q-23 a Jest assertion pins C0's copy of the backfill statement to the real one, the un-failable duplicate check is removed, and `stripFunctionBodies` uses a replacer function. Q-22/F-5 both repository headers and S1-T7 now cite 20261005; §4.18's "every reference updated" claim corrected. Q-19 needed no code change and now points at §14.6 step 3d. 35 suites / 464 tests green; typecheck 2,030 baseline, 0 in these files. Code still uncommitted. |
