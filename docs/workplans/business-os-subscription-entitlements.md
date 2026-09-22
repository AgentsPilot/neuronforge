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
| A cohort exists but has also ended | `grace` then `paused`, measured from the **later** of the two end dates, using that cohort's grace history. Taking the later date prevents an account that was upgraded mid-trial from being pushed into grace by a date that has already passed. **Three things are decided here, and they do not all come from the same place (stated in full after QA C-2):** the **basis** is the *tier* row — grace means "look at what you had", not "have everything", and falling back to the cohort would hand a lapsed subscriber more than they paid for; the **access end date** is the later of the two; and the **grace length** is the *cohort's*, not the subscription's. That last one is deliberate: an account that is also a lapsed champion keeps the champion's 30 days rather than dropping to the subscription grace. It is generous in the customer's favour, it applies only to someone who was both, and the alternative — the shorter subscription grace — would mean that having been a champion made their lapse *worse*. |
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

**Component 2 — catalog + config + validation + CI gate** — ✅ **built 2026-09-22, uncommitted, awaiting SA review** (§4.21)
- [x] **S1-T1** `types.ts` (zero-tier safe) + `schema.ts` (catalog-derived builders, histories, zero-tier enums) ✅
- [x] **S1-T2** `config/catalog.ts`: all 37 capabilities with the `client_render` audience, lifecycle verified against the code with the evidence in each entry's `note`, B-1 placeholders marked ✅
- [x] **S1-T3** `config/tierMatrix.ts` (**empty**), `config/cohorts.ts` (`{ all: true }`, histories, explicit values, `clockStartsAt`), `config/lifecycle.ts` (overlay, send-policy defaults, **the seeded intake-request send id per R2-4**, empty overrides, subscription grace history), `config/launch.ts`. Fixture in `__fixtures__/` ✅
- [x] **S1-T4** `config/chatActionMap.ts` + `readRule` ✅ (`capabilitiesForPlan`, which needs a plan object, belongs with the shadow hook in component 4)
- [x] **S1-T5** `source.ts`: lazy `CodeTierMatrixSource`, injectable source, `validateEntitlementConfig` ✅
- [x] **S1-T14** CI: `SCOPED_DIRS` + header comment (no renames), `test:bos-entitlements` and `entitlements:snapshot` scripts, `bos-entitlements.yml` ✅ — **F-1 satisfied:** the script runs `supabase/migrations/__tests__` **and** `lib/repositories/__tests__` as well as the entitlement suites. That suite is the only CI check on M-1 and M-2 (the backfill staying out of the DDL transaction, and the reset never deleting an override row), and no other workflow runs it — component 1 shipped it, but nothing runs it until this task lands.

**Component 3 — resolver and the three-step contract** — ✅ **built 2026-09-22, uncommitted, awaiting SA review** (§4.24)
- [x] **S1-T6** ✅ `lifecycle.ts` (RC-11 + **A-1 expired-tier fallback**), `resolver.ts` (`{ all: true }`, S-7 histories), `decide.ts` (**A-2 three-step contract**), `balance.ts` (**A-2 seam + `ALWAYS_SUFFICIENT`**), all pure with an injected clock.
- [x] **S1-T6a** ✅ *(SA C-1, binding)* Extend `oneLineChange.test.ts` to **resolve a fixture Growth account and assert `chat.search` comes back entitled** after the one-line change. Component 2 proves the config accepts the edit; this is what proves the answer a customer gets changes with it, which is the half of AC-4 that matters commercially.
- [x] **S1-T10** ✅ `account.ts`, `mode.ts` (no config imports, `is…Enabled` naming, UD-2 refusal), `EntitlementService.ts` (input cache, LRU, read-through, failure policy, 100-id chunking, **`check()`** with the injected balance source).

**Component 4 — shadow mode + report** — ✅ **built 2026-09-22, uncommitted, awaiting SA review** (§4.27)
- [x] **S1-T11** ✅ `shadow.ts` (lazy imports inside the try), `planCapabilities.ts`, `report.ts` (static incl. the **A-1 no-end-date list**, observed, `asTier`, no names or reasons), the one-line chat-v4 hook. ⚠️ **The `shadow-report` ROUTE moves to component 5**, which is where `requireAdmin`, Zod and the audit trail live — `buildShadowReport()` is written and tested and waits to be called. Component 5's S1-T12 gains it.
- [x] **S1-T11a** ✅ *(SA, component 1 review)* The no-end-date list must also say, per row, **whether the account ever created a business profile**. The component 1 backfill deliberately treats "a profile **or** any onboarding message" as a tenant, so accounts that opened onboarding once and never came back are now open-ended champions too. Flagging them is what makes trimming that set before enforcement a deliberate act rather than a discovery. It is one extra field on the existing list (`profile_created_at IS NULL`), not a new query.
- [x] **S1-T15** ✅ Setup-AI-cost section of the report (B-12 sizing input; SA recommends keeping it).

**Component 5 — admin ops + docs**
- [ ] **S1-T12b** *(moved here from component 4)* The **`GET /api/admin/business-os/entitlements/shadow-report` route**: `requireAdmin` first, Zod over `from` / `to` / `asTier` / `includeSetupAi`, then one call to `buildShadowReport()`. The report builder is done (§4.27); this is the gate in front of it, and it belongs with the other admin routes so the whole admin surface lands in one reviewable PR. Add the route to `ALLOWED` in the RC-15 guard — and **not** to `NO_STATE_WRITE_REFERRERS`.
- [ ] **S1-T12** `accounts/[accountId]` GET + POST union (`ensure_plan_row` with explicit cohort per R2-2, `set_cohort`, `set_expiry` incl. `tier_expires_at`, `assign_tier` with the required `expiresAt` key per A-1, `add_override`, `end_override`, **`reset_plan_state`** per A-3, `would_leave_no_basis` per R2-3) and the **`launch` route with `dryRun`** (R2-1). **`requireAdmin` first, and no `AdminAccessService` import** (guard R1/R2). Audit events in `lib/audit/events.ts`.
- [ ] **S1-T12a** *(binding, from QA's component 1 review)* Route-level obligations the repository layer cannot own:
  - **Q-13:** the Zod schema for every op that names a cohort or tier uses `z.enum` built from config — the repository now rejects a blank cohort as a backstop, but the route is where an *unknown* value must be refused.
  - **Q-6:** `set_expiry` returns **409** when the matching assignment is absent (`tier_expires_at` with no tier, `cohort_expires_at` with no cohort), so the CHECK constraint is never how an admin hears about it. `updatePlan` now clears a paired expiry automatically, so `assign_tier { tier: null }` is safe, but the route still tests the pairing.
  - **Q-15:** the pre-check for `plan_row_missing` (409) must run before any write, because `updatePlan` returns `{ data: null, error: null }` for "no row matched" — indistinguishable from success at the call site. A route test covers it.
  - **Q-10:** add each new admin route to the `ALLOWED` list in `lib/repositories/__tests__/businessOsEntitlements.imports.guard.test.ts`. That edit is the reviewable moment where someone states who may write entitlement state. **Admin routes do NOT join `READ_ONLY_REFERRERS`** — that list is the read path, and the routes are the code that may write.
  - **C3-2** *(SA, component 3 review — binding)*: `add_override` must apply the `not_built` rule before storing anything. The config loader now refuses a tier or cohort that grants a `not_built` capability, and the resolver clamps one at layer 4 — but nothing yet stops an admin *storing* an override the resolver will silently ignore, which reads to the admin as "I granted it" and to the customer as "I still do not have it". Reuse `isGrantingValue` from `schema.ts` plus the capability's lifecycle: refuse with 400 and name the capability. The same check belongs on `removals.previousValue` if a matrix removal ever restores a capability that has since been un-built.
- [ ] **S1-T16** `docs/architecture/BUSINESS_OS_ENTITLEMENTS.md`. A CLAUDE.md Key Documentation row needs TL/user approval.

**Across components**
- [ ] **S1-T19** *(QA §14.10.5 item 5 — tracked, because a line in a PR is not a reminder)* **One week after the production apply, re-run `scripts/check-bos-entitlements-migration.sql` and search the Postgres logs for `business_os_plan_fact_`** (runbook step 8). Row 61 must have left `0`, and the log must still be empty. These two together are what replaces the probe suite we chose not to run (§4.20.2), so the week is not a formality: **this task is the evidence, and it blocks Slice 2 going to shadow**, not the merge. Owner: whoever runs the apply; date it in the PR when it lands.
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

### 4.20 Production verification, for the Supabase SQL editor (rewritten 2026-09-22)

**Why this section was rewritten.** It assumed `psql`. The operator is the user, working in the **Supabase dashboard's SQL editor**, against **production**, with no branch or throwaway database anywhere. That changes three things, and each one changes a file:

1. **No `psql` means no meta-commands.** `\set`, `\if`, `\timing`, `\echo`, `\gset` and `-v` variables are `psql` features, not SQL. Postgres parses a pasted batch before executing any of it, so a file containing them dies on the first backslash and runs nothing — and then the obvious repair is to delete the backslash lines, which is how QA's **R-1** found that deleting them re-armed the probe suite's lock probe.
2. **No `psql` means no `RAISE NOTICE`.** The SQL editor does not display `NOTICE` or `WARNING` output. A check written as a notice is a check the operator never sees. **Every check is now a result row with a `status` column** (`PASS` / `FAIL` / `WARN` / `INFO`), and row 0 is an `OVERALL` verdict. One run reports every problem instead of stopping at the first.
3. **The editor shows one result grid** (the last statement that returns rows). So each read-only script is **one `SET` plus one `SELECT`** — not a sequence of `DO` blocks whose output would be invisible anyway.

#### 4.20.1 The four scripts, after the rework

| Script | How it runs | Writes? | Safe on production |
|---|---|---|---|
| `scripts/preflight-bos-entitlements-migration.sql` | **Paste whole file → Run.** One `SET`, one `SELECT`. | No | ✅ **Enforced.** First statement is `SET default_transaction_read_only = on`, so Postgres rejects any write on that connection with `25006`. Not a promise in a comment — a property of the session. |
| `scripts/check-bos-entitlements-migration.sql` | **Paste whole file → Run.** One `SET`, one `SELECT`. | No | ✅ **Enforced**, same mechanism. |
| `scripts/verify-bos-entitlements-migration.sql` (the probe suite) | `psql -f` only, on a database you can throw away. | Yes | 🚫 **Must not be run on production.** See 4.20.2. |
| `scripts/rollback-bos-entitlements-migration.sql` | **Two pastes.** Paste 1 (read-only) says what cannot be rebuilt; paste 2 does the drop and **refuses until armed by hand**. | Paste 2 only | ⚠️ Destructive by design, disarmed by default (QA **R-7**). |

#### 4.20.2 The probe suite: the decision, and what it costs

**Decision: the probe suite is quarantined. It does not run on production, and it was not ported to the editor.** The file says so in its first three lines.

**Why, in one sentence:** proving a fact trigger fired requires inserting into **`auth.users`**, and the SQL editor gives no way to guarantee the transaction discipline that makes that reversible — a pooled connection reset, a paste that starts below the `BEGIN`, or an editor that wraps statements its own way, and fabricated logins are **committed into the production identity table**, where `on_auth_user_created` and everything downstream is waiting. A rolled-back transaction is a good property; it is not worth betting `auth.users` on for evidence obtainable another way.

**The ACCESS EXCLUSIVE lock probe is removed, not re-gated.** Old section B4 added `CHECK (false)` to the plan table to prove that a failing plan write cannot fail a product write. It was opt-in behind `\if :probe_locks` — and R-1 showed the opt-in defeated itself, because deleting the backslash lines (the natural repair for an editor paste) left it **on**. The block is gone, and the fourth probe tenant it needed with it. There is no longer a version of that file that can lock the plan table.

**What is lost, and where each piece is covered instead:**

| Behaviour the probes proved | Covered instead by | Strength |
|---|---|---|
| The fact triggers record a fact and open a trial row | **Real traffic.** `check-…` row 61 counts plan rows whose origin is a trigger. It is 0 immediately after the apply and must stop being 0 once anyone signs up (step 8 below). | **Stronger** than the probe — production's own signups, not three fabricated ones |
| A failing plan write can never fail a product write (S-8(i)) | Structure: `check-…` row 22 asserts both fact functions are `SECURITY DEFINER` with `lock_timeout=2s`; the Jest migration guard asserts the `EXCEPTION WHEN OTHERS → RAISE WARNING` handler and the absence of `RAISE EXCEPTION` from the source text. **Plus the free half (SA R-3): the handler's `WARNING` lands in the Postgres log**, so runbook steps 6b and 8 search the log for `business_os_plan_fact_` — a trigger that is failing cannot do it quietly | **Weaker — the one real gap**, but observable. The mechanism is proven present rather than proven to behave, and the log says whether it ever had to behave. It fails safe either way: the failure mode is a missing plan row, recovered by re-running the backfill |
| A trial cannot be restarted | The fact upsert's `DO UPDATE` cannot touch `cohort`, `tier` or the pins — asserted from source by the Jest guard — plus the resolver's own tests in component 3 | Adequate |
| `business_os_reset_plan_state` | Nothing calls it until the Slice-1 admin route (component 5), where its first real use is one account, by an admin who typed a confirmation | Deferred, deliberately |
| The shadow RPC's arithmetic | Shadow mode itself (Slice 2) writes real events with enforcement off; QA reads the first day's rows | Deferred to where it is free |

If a staging database ever exists (`docs/ENVIRONMENTS_AND_DEPLOYMENT_STRATEGY.md`), run the probe suite there and close the S-8(i) gap. That is why the file is kept rather than deleted.

#### 4.20.3 The runbook — eight steps, all in the SQL editor

> **📋 For the PR: [BUSINESS_OS_ENTITLEMENTS_APPLY_RUNBOOK.md](/docs/BUSINESS_OS_ENTITLEMENTS_APPLY_RUNBOOK.md)** — the same eight steps, self-contained and written **for the operator rather than for us**: no section numbers, no QA finding references, no internal vocabulary, and every file explained where it is first needed. Paste that link (or the doc itself) into the PR description. This section stays as the engineering record, and the two must be changed together — the companion doc's change history says so.

Assume the operator is the user, in the dashboard, with no terminal.

> **Only two of the eight steps change anything: step 4 (the schema) and step 5 (the backfill).** Steps 1, 2, 6, 7 and 8 read; step 3 takes a backup. Everything before step 4 can be re-run as often as you like, and stopping before step 4 leaves the database exactly as it was.
>
> **One thing will probably go wrong, and it is one line to fix.** The pre-flight makes its editor tab read-only on purpose. If step 4 runs on **that same tab** it fails with `25006` — *"cannot execute CREATE TABLE in a read-only transaction"* — immediately after the pre-flight said `PASS`, which looks much worse than it is. Run `RESET default_transaction_read_only;` (or open a new tab) and paste again. Nothing was applied.

**Step 1 — open the SQL editor as the owner.** Supabase dashboard → the project → **SQL Editor** → **New query**. The editor connects as `postgres`, which is what these scripts need: they read `auth.users` and `pg_stat_activity`, which the API roles cannot. There is no connection string to choose and no pooler question to answer — the old step about port 5432 versus 6543 applied to `psql` and no longer exists.

**Step 2 — pre-flight.** Open `scripts/preflight-bos-entitlements-migration.sql`, copy the **whole file**, paste, **Run**.

Read row 0 (`OVERALL`):

| Row 0 says | Meaning | Do |
|---|---|---|
| `PASS` | rows 1, 2, 3, 4 and 6 all passed | Go to step 3 |
| `WARN` | something needs a decision, not a stop | Read every `WARN` row's `what_to_do`, decide, record it in the PR, then step 3 |
| `FAIL` | a precondition is broken | **Stop.** Do not apply anything. The `what_to_do` column names the remedy |

What each row is for, and what a failure means:

| Row | Checks | On failure |
|---|---|---|
| 1 `clean` | None of the nine objects exists yet | **FAIL.** `CREATE TABLE IF NOT EXISTS` would silently skip an existing table with a different shape and the post-apply checks would pass over real drift. Either it is already applied (run the checker instead) or a previous attempt half-landed (roll back first) |
| 2 `roles` | `anon`, `authenticated`, `service_role` all exist (QA **R-4**) | **FAIL.** The migration's `REVOKE`/`GRANT` statements would abort — safely, but avoidably |
| 3 `orphans` | Every tenant has an `auth.users` row | **WARN.** The backfill's FK would abort the whole insert. Decide: add `AND EXISTS (SELECT 1 FROM auth.users u WHERE u.id = tenants.user_id)` to its `SELECT`, or find out why those accounts exist. Paste 2 at the bottom of the file lists the ids |
| 4 `one row per tenant` | The backfill's row count equals the tenant count (QA **R-5**) | **FAIL.** More rows than tenants means `business_profiles.user_id` is no longer unique, the backfill's `LEFT JOIN` multiplies rows, and `business_os_reset_plan_state`'s scalar sub-selects would later raise "more than one row returned by a subquery" |
| 5 `size` | Tenant count, rows to insert, table sizes | `INFO`. **Record these** for the PR. The editor's own execution time under the grid is the backfill's *read* cost |
| 6 `quiet on the parent tables` | **Nothing has held a lock on `onboarding_conversations` or `business_profiles` for more than 5 s** (QA **P-4** — scoped to those two tables, because a live Supabase project always has *something* running and a row that always warns is a row nobody reads; the database-wide numbers are still shown as context) | **WARN.** Step 4 needs an ACCESS EXCLUSIVE lock on both parent tables for the instant it creates the triggers and waits 5 s for it; while it waits it queues in front of other writers. An indicator, not a verdict: re-run in a quieter minute |
| 7 `what next` | Restates what success looks like (QA **R-6**) | — |
| 8 `read-only state` | **Reports** `transaction_read_only` and `default_transaction_read_only` as the database sees them (SA **R-2**) | — |

**Row 8 is worth reading once, and it is the answer to a question we could not settle in review.** `SET default_transaction_read_only = on` applies to transactions started *after* it; if the editor wraps a pasted batch in one transaction that had already begun, the `SELECT` in that same paste is not itself read-only. Nothing is at risk either way — neither read-only script contains a write, which is the guarantee that actually matters — but row 8 tells you which it is, on your database, the first time you run it.

What is *not* in doubt: the **connection** is read-only afterwards. If a later query of yours fails with *"cannot execute … in a read-only transaction"* — including **step 4** — that is this script's setting still in force on that tab. Run `RESET default_transaction_read_only;` or open a new tab.

**Step 3 — snapshot.** Dashboard → **Database** → **Backups**. This is the one step whose failure cannot be undone, so it does not get a judgement call:

| What the Backups page shows | Do |
|---|---|
| A backup dated **today** | Note the date and time for the PR. Go to step 4 |
| No backup from today, but a button to start one | Start it, wait for it to finish, note the time |
| No backup from today and **no** way to start one | **Stop and ask** — or, if you decide to go ahead anyway, write this in the PR *before* step 4, in these words: **"no backup taken; the undo path is the rollback script, not a restore"**. Do not pass this step silently |

The migration being additive is not a reason to skip it. It is a reason this is *unlikely* to matter — which is a different thing.

**Step 4 — apply the schema.**

**Getting the file.** You have a browser, not a checkout. Open `supabase/migrations/20261005_business_os_entitlements.sql` on GitHub (it is in this PR's *Files changed*, or browse the branch), click **Raw**, then select all (Ctrl/Cmd-A) and copy. **Use Raw, not the rendered view** — copying from the rendered file brings the line numbers with it, and the paste fails on the first one. The same applies to step 5's file.

New query tab → paste the **whole** file → Run.

*Expect:* "Success. No rows returned." The file is one transaction: it lands whole or not at all.

| If it fails with | What it means | Do |
|---|---|---|
| **`25006`** / *"cannot execute CREATE TABLE in a read-only transaction"* | **The most likely failure, and the least alarming.** You are on the tab where you ran the pre-flight, and its `default_transaction_read_only = on` is still in force on that connection. Nothing was applied. | Run `RESET default_transaction_read_only;` on that tab (or open a new one) and paste the migration again. |
| `55P03` / *"canceling statement due to lock timeout"* | Something held a lock on `onboarding_conversations` or `business_profiles`. **Nothing was applied** — the whole file is one transaction, and the bounded wait is doing its job. | Re-run step 2, wait for row 6 to say `PASS`, paste again. |
| *"role … does not exist"* | The `REVOKE`/`GRANT` statements cannot resolve. Step 2 row 2 would have told you. | Stop and read step 2 row 2. |
| **Anything else** | Unknown — and the instinct to re-run is the wrong one to act on blind. | **Stop.** Do not run step 5. Paste the whole error message into the PR and ask. **Nothing was applied:** the file is one transaction, so a failed run leaves the database exactly as it was, and re-running after the cause is understood is safe. |

**Step 5 — apply the backfill, immediately after.** Get the file the same way (GitHub → **Raw** → select all → copy). New query tab → paste the whole of `supabase/migrations/20261005b_business_os_entitlements_backfill.sql` → Run.

*Expect:* "Success. No rows returned." **Record the elapsed time the editor reports.** Back-to-back with step 4 is what keeps the Q-5 window (below) down to a minute.

| If it fails with | What it means | Do |
|---|---|---|
| **`25006`** / *"cannot execute … in a read-only transaction"* | Same trap as step 4: you are on a tab where a checking script ran. Nothing was applied. | `RESET default_transaction_read_only;` (or a new tab) and paste again |
| **`57014`** / *"canceling statement due to statement timeout"* | The backfill hit its own ten-minute cap (SA **P-2**). **The whole statement rolled back** — there is no half-filled table. | Re-run it. It is written to be re-runnable: `ON CONFLICT DO NOTHING` plus a heal step, so a second run inserts what is missing and changes nothing else |
| **`23503`** / *"violates foreign key constraint"* | A tenant has no `auth.users` row — exactly what pre-flight row 3 warns about. **Nothing was inserted.** | Stop. Go back to step 2 row 3's `what_to_do`: either guard the backfill's `SELECT` or find out why those accounts exist |
| **Anything else** | Unknown. | **Stop and ask**, pasting the message into the PR. Note the difference from step 4: **the schema from step 4 IS applied and that is fine** — it is inert until the backfill runs. Nothing is half-done, and re-running the backfill after the cause is understood is safe |

**Step 6 — post-apply checks.** Open `scripts/check-bos-entitlements-migration.sql`, paste the whole file, Run.

| Row 0 says | Meaning | Do |
|---|---|---|
| `PASS` | The apply is verified | Paste the grid into the PR. This is the evidence the merge is held for |
| `WARN` | Verified, with something to note — in practice row 54, the Q-5 window | Record the count in the PR, then treat as verified |
| `FAIL` | Something did not land | Every `FAIL` row names the property and the remedy. Most are "re-apply 20261005b", which is re-runnable — but **not on this tab**: the checker has just made it read-only, so a re-apply here hits the same `25006` as step 4. Use a new tab, or `RESET default_transaction_read_only;` first |

The rows worth understanding before you see them:

- **B1/B2/B3** — every tenant has a plan row; every backfilled row is an open-ended champion; and the backfill *actually ran*. B3 exists so that B1 and B2 cannot both pass on a database where nothing was backfilled and there is nothing to be wrong.
- **B4 `facts were healed`** — no plan row is missing a fact its own history could supply.
- **Row 54 `Q-5 migration-window rows`** — tenants who signed up *between* steps 4 and 5 are recorded as trials rather than champions. Harmless while the mode is `off`; the launch operation fixes them at switch-on. Note the number.
- **Row 61 `trigger rows since apply`** — expected to be `0` right now. See step 8.

**Step 6b — read the database log (SA R-3).** Dashboard → **Logs** → **Postgres Logs**, and search for `business_os_plan_fact_`. **Expect nothing.**

This is the cheaper half of the evidence we gave up with the probe suite. The fact triggers are written so that any failure is swallowed into a `WARNING` and the customer's own write still succeeds (S-8(i)) — which means a broken trigger is *silent by design* everywhere except the log. If entries appear here, read the message: a plan row is not being created for someone, the fix is to re-run the backfill once the cause is dealt with, and nothing the customer did was lost. Worth a glance at step 6, and again at step 8.

**Step 7 — report.** In the PR: the pre-flight grid, the two elapsed times, the checker grid, the Q-5 count, the backup date, and "no `business_os_plan_fact_` entries in the log". The merge stays held until this is in place (user decision, 2026-09-22).

**Step 8 — a week later: row 61 plus the log, together.** These two are what **replace the probe suite** (§4.20.2), and neither costs anything:

| Check | Expect | If not |
|---|---|---|
| Paste `check-…` again and read **row 61** (`trigger rows since apply`) | Greater than 0 once anyone has signed up since the apply; the status flips to `PASS` | Tenants arrived and it is still `0` → the fact triggers are not firing. Not urgent (nothing reads these tables yet) but it must be fixed before Slice 2 goes to shadow |
| Postgres Logs, search `business_os_plan_fact_` | Still nothing | Entries here are the trigger catching its own error. Read them, fix the cause, re-run `20261005b` to heal the rows that were missed |

Together they cover the property the probe proved directly: the triggers fire, and when they cannot, they fail without taking the customer's write with them. The difference is that this evidence comes from real signups rather than three fabricated logins — and the log half arrives whether anyone looks or not.

**If something looks wrong — the undo path.** The tables are additive and nothing reads them, so there is no rush and no incident. To remove the module entirely, open `scripts/rollback-bos-entitlements-migration.sql`:

1. **Paste 1** (read-only) says what cannot be rebuilt: admin-set rows, overrides, shadow events. Export those two tables via **Table Editor → Export CSV** first if the counts are non-zero.
2. **Paste 2** refuses to run as written. Arming it is a one-line edit inside the block — `v_confirm text := 'DROP-ENTITLEMENTS';` — the same standard §4.12 applies to resetting a *single* account (QA **R-7**). Everything in paste 2 is one implicit transaction: if the guard refuses, or any drop fails, nothing is dropped.
3. The final grid says `PASS` / `all nine objects are gone` (3 tables + 4 functions + 2 triggers — QA **R-9** corrected the file's "eight"). Re-applying steps 4 and 5 rebuilds every backfilled row from the tenants' own history.

#### 4.20.4 Honest limits of this rework

- **None of the four scripts has been executed.** There is no Postgres in this worktree and no database to try them against, so they are reviewed SQL, not tested SQL. Two consequences are worth stating plainly: a syntax error would surface as an editor error on the first paste (annoying, harmless, fixable in a minute), and the read-only scripts cannot damage anything even if wrong, because `default_transaction_read_only` is set before anything else runs. The rollback is the one where a mistake would matter — and it is disarmed by default and preceded by a read-only paste.
- **`SET default_transaction_read_only = on` is a session setting**, so it persists on that editor tab's connection until it is recycled. Both read-only scripts end with a row saying exactly that and giving the `RESET`. A setting that outlives the script is a better trade than a script whose safety depends on the operator remembering to wrap it.
- **`check-…` errors outright if the tables do not exist** (`relation … does not exist`). That is the correct answer to "did the migration apply?", and its header says so — but it is an error message rather than a `FAIL` row, because a single SQL statement cannot conditionally read a table that is not there.

#### 4.20.5 Consistency with §14.6 (QA)

§14.6 was written for a branch database, `psql`, and one script. Against this runbook and the four current scripts:

| §14.6 | Now |
|---|---|
| Step 0 — seed tenants into a branch database | **Does not apply.** Production has real tenants; the pre-flight counts them |
| Step 1 — apply both migrations | Runbook steps 4 and 5, preceded by two read-only steps. Same order, same files, pasted rather than piped |
| Step 2 — run the verification script | Split. The safe half is step 6 (`check-…`); the writing half **is not run at all** (4.20.2) |
| Step 3a backfill non-vacuity / 3b `service_role` + `proowner` / 3c trigger binding | All three are rows in `check-…` (B3, row 14 + row 26, row 30) |
| Step 3d — the fact-heal probe (Q-19) | Superseded: `check-…` row 53 asserts the *outcome* of the heal on real data — no plan row is missing a fact its history could supply — which is what the probe was for. The probe version stays unrun |
| Step 4 — re-run the backfill, fingerprint | Still valid, and now free: the backfill is re-runnable, and re-pasting it followed by `check-…` is the fingerprint. Not part of the required runbook |
| Step 5 — trigger-created rows stay trials; 5b the window query | 5b is `check-…` row 54. 5 is covered by step 8 (real traffic) rather than a manual insert |
| Step 6 — numbers for RM | Pre-flight grid before, checker grid after (runbook step 7) |
| Step 7 — product still works, PostgREST round trip | Unchanged. The round trip stays unproven until component 3 calls these functions through supabase-js |

### 4.21 Component 2 as built (2026-09-22) — for SA review

**Status:** implemented, **uncommitted**. Nothing imports it yet: the resolver (component 3) and the shadow hook (component 4) are the first readers, so merging this changes no behaviour at all.

**Files created**

| File | What it is |
|---|---|
| `lib/business-os/entitlements/types.ts` | Shapes only. `ValueForShape<S>` derives a capability's value type from its own shape, and `CapabilityDef` is a union that makes "an automated client send without a message class" unrepresentable (S-1). |
| `lib/business-os/entitlements/config/catalog.ts` | **All 37 capabilities.** Each carries labels (en/he/es), category, shape, lifecycle, audience, at-limit behaviour and add-on flag; every `lifecycle` was checked against the repository and the evidence is in the entry's `note`. `TierRow` is a mapped type over this file. |
| `lib/business-os/entitlements/config/tierMatrix.ts` | **Ships empty** (U-1). `TIER_ORDER = []`, `TIER_MATRIX = { version: 1, tiers: {}, removals: [] }`, with the add-a-tier procedure in the header. |
| `lib/business-os/entitlements/config/cohorts.ts` | Trial and champion, both `{ all: true }`, with explicit quantity/metered/fair-use values, `durationHistory`/`graceHistory` and `clockStartsAt`. |
| `lib/business-os/entitlements/config/lifecycle.ts` | The state × surface overlay (B-9/B-11), the seeded send registry incl. `intake.request` (R2-4), empty `sendPolicyOverrides`, and `surfaceKindForSend` so no call site picks its own surface kind. |
| `lib/business-os/entitlements/config/chatActionMap.ts` | Entity domains + action overrides + `READ_RULE` + `capabilityForOp`. |
| `lib/business-os/entitlements/config/launch.ts` | `enforceRequiresConfiguredTier: true` (UD-2). |
| `lib/business-os/entitlements/schema.ts` | Zod, **built from the catalog passed in** rather than the one compiled into the file — so a config that adds a capability has the rules applied to it. |
| `lib/business-os/entitlements/source.ts` | `TierMatrixSource`, the lazy `CodeTierMatrixSource`, `validateEntitlementConfig`, and the test-only default-source swap. |
| `lib/business-os/entitlements/snapshot.ts` | The drift comparison: value ranking per shape, and the rule that a **lowered** value needs a `removals` entry and a version bump. |
| `lib/business-os/entitlements/__fixtures__/{exampleTierMatrix,fixtureSource}.ts` | Eyal's draft matrix as a fixture. **In `__fixtures__/`, not `__tests__/fixtures/` as the plan said** — Jest's `testMatch` collects every `.ts` under a `__tests__` directory, so a fixture there fails as an empty suite. |
| `lib/business-os/entitlements/__tests__/*.test.ts` (7 suites) + `entitlements.snapshot.json` | See below. |
| `scripts/write-entitlements-snapshot.ts` | `npm run entitlements:snapshot`. |
| `.github/workflows/bos-entitlements.yml` | The one new CI job. |

**Files modified:** `scripts/typecheck-bos-llm.ts` (one entry added to `SCOPED_DIRS` + a header comment; **no rename** of script, workflow, job id or display name, per S-9) and `package.json` (two scripts).

**How the config makes adding a tier a one-line change**

Adding a capability to an existing tier is literally one line, and `oneLineChange.test.ts` measures it rather than asserting it. Taking the worked example from requirement §6.3 — moving "search via chat" from Pro to Growth:

```diff
  const growth: TierRow = {
    ...basic,
    'chat.invoice_control': true,
-   'chat.search': false,
+   'chat.search': true,
```

The test flattens both matrices to leaf paths and asserts the difference is exactly `['tiers.growth.chat.search = true']`, then re-validates the config and checks Basic was untouched. **No route, executor, cron or test changes**, because enforcement asks "is `chat.search` entitled?" and never "is this account on Pro?" — which is what the forbidden-literal test keeps true.

Adding a whole tier is three steps, and two of them are enforced rather than remembered: append the name to `TIER_ORDER`, add its row (a missing capability is a **compile error**, a Zod failure **and** 37 invariant failures), then refresh the snapshot. Removing a capability from a tier is deliberately **two** lines — the value plus a `removals` entry with a sunset date, and a version bump — because B-10 makes it a decision about existing subscribers. `tierMatrix.snapshot.test.ts` proves both directions: a lowered value with no removal fails; the same change with the ledger entry passes.

**Tests (7 suites, 325 tests)**

| Suite | What it pins |
|---|---|
| `catalog.invariant` | AC-1: all 37 capabilities present against a hand-written list (not derived — deriving it would agree with whatever the catalog says). Completeness, the client-send ⇒ message-class rule both ways, variant ordering, `not_built` entries carrying evidence, the B-1 placeholder set, and the D-12 at-limit behaviours. |
| `productionConfig` | The shipped config loads with **zero tiers**; both cohorts grant everything; every quantity/metered/fair-use capability has an explicit cohort value; the trial has a one-off total, a 14-day history and `clockStartsAt`; champions have **no** default duration (RC-4); `enforceRequiresConfiguredTier`; the B-9/B-11 overlay cells; the R2-4 intake send proving **AC-37 on production config**; and a demonstration that a new metered capability **fails the load** until champions get a number. |
| `tierMatrix.invariant` *(fixture)* | AC-2 as **111 generated cases** — every (tier × capability) deletion is rejected — plus unknown capability, wrong shape, unknown variant, unconfigured tier, missing row, negative allowance, and the WC-19 `'renewal'` rules. |
| `oneLineChange` *(fixture)* | AC-4, measured as a one-leaf diff (above). |
| `chatActionMap.invariant` | AC-3 against the **live** `SEMANTIC_CATALOG` (135 generated pairs), cross-checked against the 107 plugin actions; no unclassified entity, no stale override; a negative control proving the resolver can return `undefined`; and the read-rule flip. |
| `tierMatrix.snapshot` | The shipped config vs the committed snapshot, plus the comparison proven on the fixture: lowered boolean, variant moved down, allowance cut, capability dropped, tier dropped, addition accepted, and the cut **accepted** once recorded. Plus S-7: editing a history entry fails, appending one passes. |
| `tierLiteral.forbidden` | FR-12 across `app`/`lib`/`components`/`hooks`, with the 11 pre-existing unrelated files baselined **by equality** (so the baseline cannot drift upwards), and a stricter no-baseline rule for the entitlements module itself. |

**Verification**

| Check | Result |
|---|---|
| `npm run test:bos-entitlements` (the exact CI command) | **37 suites, 676 tests, 0 failures** — the 7 new entitlement suites plus the component 1 repository, migration, purge and ownership suites (F-1) |
| Entitlement suites alone | **325 tests** |
| `npm run test:authz-guard` | 74 passed, no new exemption |
| **`npm run typecheck:bos-llm` with the entitlements folder in scope** | **187 files in scope, 31 baseline errors, 0 new — PASSED.** It found two real type errors in my own test files first (optional properties on `as const` literals); both are fixed. |
| Hooks ESLint over the new module | exit 0 |
| `console.*` in the new module | 0 |
| `npm run entitlements:snapshot` | Reproduces the committed snapshot byte for byte |

**A note on running the scoped typecheck from a worktree.** It needs `node_modules`, which lives in the main checkout — without it the check degrades (QA Q-7). I made a temporary local copy to run it honestly and removed it afterwards; the worktree is as it was. CI has no such problem.

**For SA**

1. **`__fixtures__/` instead of `__tests__/fixtures/`** (Jest would collect the fixture as an empty suite). One directory, same contents.
2. **Schemas take the catalog as a parameter.** `validateEntitlementConfig(config)` validates the cohorts against *that config's* catalog. Without it, a config carrying a new capability would be validated against the compiled-in one — which is how the "new metered capability" test passed vacuously on my first attempt.
3. **`EntitlementConfig.cohorts` is widened** from the literal type to `Record<CohortId, CohortConfig>`, so "does this cohort have a duration?" is answered by the type rather than by which cohort you named.
4. **Lifecycle judgements to sanity-check** (each entry carries its evidence): `marketing.mass_email` and `payments.multi_currency` are marked `available` on the strength of the email-campaign/sequence tables and `currency.ts`; `marketing.posts`, both mobile/analytics add-ons, `addon.full_payment_cycle`, SMS and `addon.act_for_you` are `not_built`. The bias is deliberate and stated in the file header: a wrong `available` is inert, a wrong `not_built` blocks a real feature on day one.
5. **`team.seats` / `business.locations` are `available` with a value of 1**, not `not_built`, because a quantity of 0 would be a lie — the extra seats are what is unbuilt, not the first one.
6. **`capabilitiesForPlan` moved to component 4**, where the plan object exists. Component 2 ships `capabilityForOp`, which is what the invariant test needs.

### 4.22 SA review fixes applied (2026-09-22) — P-1 to P-3, C-1 to C-3, and the mass-email correction

Against §13.5. Code still uncommitted.

| # | What changed |
|---|---|
| **P-1** | New `scripts/preflight-bos-entitlements-migration.sql`, read-only under `SET TRANSACTION READ ONLY`, and runbook steps 1–3 built around it. It answers the three questions that make a first production run risky: **(a)** none of the nine objects already exists — and this one **raises**, because a silent skip over drift is the dangerous case; **(b)** no tenant is missing its `auth.users` row, with the offending ids listed and the `WHERE EXISTS` guard spelled out as the decision to take *before* applying; **(c)** the scan size, timed — it runs the backfill's own `SELECT`, counted instead of inserted, with `\timing on` and an `EXPLAIN`. It also reports current activity and the longest open transaction, which is what "is now a quiet moment?" actually means. |
| **P-2** | `SET LOCAL statement_timeout = '10min'` in `20261005b`, next to its `lock_timeout`, with the reasoning in place: Supabase sets role-level timeouts, so inheriting one means dying at a surprise boundary or running unbounded. A timeout rolls the whole file back, so the recovery is "run it again". |
| **P-3** | The connection and timing constraints are now **steps 1 and 2**, not asides. Step 1 explains *why* the pooler is unsafe rather than just forbidding it: `SET LOCAL` through a transaction pooler applies to whatever statement borrowed the connection, which is how a `lock_timeout` quietly stops existing. Step 2 explains that the apply's 5-second lock wait also queues in front of live onboarding writes. |
| **C-1** | Recorded as **S1-T6a**, binding on component 3: resolve a fixture Growth account after the one-line change and assert the capability comes back entitled. |
| **C-2** | Done, and then some — see the mass-email correction below. The catalog header now states the test (**"a customer gets the outcome", not "the tables exist"**), names the two entries with a known gap between feature and delivery (`marketing.mass_email`, `payments.reminders`), and sets the gate: **before the first tier is configured**, walk every `available` capability and confirm an end-to-end path. |
| **C-3** | The rollback script's leftover check now **enumerates the nine objects** instead of matching `business_os_%`, and names what is left rather than counting it. A Slice 3 table can no longer make a correct rollback report failure — mid-incident, which was the point. |

**The mass-email correction (SA's challenge, and what the code said)**

SA was right, and tracing it answered a question the pricing sheet could not — B-1's "marketing chat (mass email)" versus "mass email campaigns" are **two different things, one of which does not exist**:

| Capability | Evidence found 2026-09-22 | Lifecycle |
|---|---|---|
| **`chat.marketing`** — bulk email from chat | `contacts.send` / `invoices.send` → `lib/business-os/bizql/mutate/emailSend.ts:157` → `sendEmail()` in `lib/notifications/emailTransport.ts` (Resend/SMTP, a real transport). `ForEachExecutor` fans the same action out across many contacts, which is what "mass email from chat" means. **It sends.** | `available` |
| **`marketing.mass_email`** — the campaign/sequence builder | The tables exist (`email_campaigns`, `email_sequences`, `email_sequence_enrollments`), the CRUD exists (`EmailAutomationRepository`), the routes exist (`app/api/email/**`), and `WebsiteEmailSequenceService.triggerSequence` writes an enrollment with a `next_send_at`. **Nothing reads `next_send_at`.** No cron in `vercel.json`, no dispatcher service, and `triggerSequence` has **no caller anywhere in the repository**. An enrolled contact is never emailed. | **`not_built`** (was `available`) |

Both entries now carry that evidence in their `note`, and `catalog.invariant.test.ts` pins the pair with the reasoning, so a future edit cannot flip either back without saying what changed in the code. `not_built` is never entitled (FR-13), so the campaign builder cannot be sold until a dispatcher lands.

**Why this was worth the correction rather than a note.** The rule I had been applying — "bias to `available`, because a wrong `not_built` blocks a real feature" — is right for a capability whose delivery path merely looks thin. It is wrong when the delivery path is **absent**, because then `available` is a promise to send emails that no code will ever send. The header now says which test to apply.

**For SA to confirm at QA time:** this is the code's answer to half of B-1. The commercial question — whether the two are priced separately, and on which plans — is still Eyal's, and both entries keep their `placeholder: 'B-1'` marker.

**Re-verified after these changes**

| Check | Result |
|---|---|
| `npm run test:bos-entitlements` | **37 suites, 677 tests, 0 failures** (one new test pins the B-1 split) |
| Typecheck, the verified method | **2,030 project diagnostics, 0 × TS2688, 0 in any entitlements file**; the control still shows 3 in other `lib/repositories` files, so the tree is genuinely covered |
| `npm run test:authz-guard` | 74 passed |
| Hooks ESLint / `console.*` | clean / 0 |

---

### 4.23 User decisions of 2026-09-22 (SQL editor, `not_built`, placeholders) — as applied

Four decisions arrived together. The first three changed files; the fourth changed what the files claim.

#### 4.23.1 Decision 1 — the operator uses the Supabase SQL editor

§4.20 is rewritten end to end for it. The short version:

| File | What changed |
|---|---|
| `preflight-…` | Rewritten as **one `SET` + one `SELECT`**. No `\set`, no `\timing`, no `\if`. Eight checks as result rows with a `PASS`/`FAIL`/`WARN`/`INFO` column and an `OVERALL` row 0. Adds the role-existence check (**R-4**), the tenant-vs-backfill-row comparison (**R-5**) and a "what success looks like" row (**R-6**). Read-only is enforced by `SET default_transaction_read_only = on` rather than by `SET TRANSACTION READ ONLY`, because the latter needs a `BEGIN`/`COMMIT` pair and the editor shows only the last result — a `COMMIT` at the end would hide the report. |
| `check-…` | Same shape: one `SET`, one `SELECT`, ~16 rows covering A1–A11, B1–B4, the Q-5 window and the counts, plus **row 61** (plan rows created by a trigger), which is the real-traffic replacement for the probe suite's trigger proof. Privileges are read from `relacl`/`proacl` via `aclexplode` instead of `has_table_privilege`, so a missing role reports rather than aborting the whole report. |
| `verify-…` (probe suite) | **Quarantined** — see below. The lock probe is **deleted**, not re-gated. |
| `rollback-…` | Two pastes. Paste 1 is read-only and prints **what cannot be rebuilt** (**R-8**); paste 2 **refuses until armed by hand** (`v_confirm := 'DROP-ENTITLEMENTS'`, **R-7**) and ends in a result grid rather than a notice. "Eight objects" corrected to **nine** (**R-9**). |

**Why `RAISE NOTICE` had to go.** The Supabase SQL editor does not display `NOTICE` or `WARNING` output. Every check written that way was a check the operator would never see — which is why the two read-only scripts now report as rows, and why one run reports *every* problem instead of stopping at the first.

**The probe-suite decision, and its justification.** I chose **prohibition over an editor-safe variant**. The probes prove their point by inserting into **`auth.users`** — that is unavoidable, because the fact triggers hang off tenant tables whose plan rows carry an FK to it. In the editor there is no `psql -f`: the file arrives as one command string, and if the transaction discipline is lost anywhere (a pooled connection reset, a paste starting below the `BEGIN`, an editor that wraps statements its own way), fabricated logins are **committed into the production identity table**. A rolled-back transaction is a good safety property; it is not one worth betting `auth.users` on when the same evidence is available from production's own traffic. The file's first three lines now say so, and §4.20.2 lists what is lost against what covers it — with the honest admission that **S-8(i) (a failing plan write cannot fail a product write) is now structurally asserted rather than behaviourally proven**, and that this is the one real gap. It fails safe: the failure mode is a missing plan row, repaired by re-running the backfill.

**What is NOT claimed:** none of the four scripts has been executed. There is no Postgres in this worktree and no database to try them against. §4.20.4 says this plainly, with the two consequences (a syntax error surfaces as an editor error on the first paste; the read-only scripts cannot damage anything even if wrong).

#### 4.23.2 Decisions 2 and 3 — `not_built`, and "if a feature does not exist it cannot be allocated"

`payments.reminders` and `website.custom_domain` are now **`not_built`** (QA C2-1, C2-2), each with the trace in its `note`: the reminder sender logs "Would send payment reminder email" and returns `true; // Simulated success` (`lib/services/PaymentReminderService.ts:500-527`); the custom-domain lookup `WebsitePageRepository.findByCustomDomain` has no caller and `middleware.ts:56-69` only rewrites hosts ending in the platform base host.

The user's rule is now **enforced at config load**, not documented:

| Where | What it rejects |
|---|---|
| `schema.ts` → `tierMatrixSchema` | Any tier row value that GRANTS a `not_built` capability — `true`, a variant above the lowest, `purchasable` **or** `included` for an add-on, a non-zero quantity, allowance or ceiling. The error names the capability, the tier, the offending value and the value that would withhold it. |
| `schema.ts` → `cohortsSchema` | The same, for a cohort's explicit `values`. (`{ all: true }` already skips `not_built` by construction; quantities are hand-written, which is where a champion could be handed SMS messages nothing can send.) |

`purchasable` counts as granting on purpose: it is an offer to sell something that does not exist, which is the failure the rule is about.

**How it is proven.** `notBuiltCannotBeAllocated.test.ts` — six grant shapes rejected, three withheld values accepted, three *existing* capabilities left alone (the negative control on the rule itself), the cohort case, `isGrantingValue`'s scale, and Eyal's fixture asserted clean. **Mutation-checked:** disabling the rule in `schema.ts` fails **exactly 9** tests and nothing else, so every rejection is load-bearing rather than incidentally true.

**Eyal's fixture was a bug, and is fixed.** The sheet sold `marketing.posts`, `marketing.mass_email`, `payments.reminders`, `website.custom_domain` and four add-ons that do not exist. Every one is clamped to its withheld value, with the draft value kept in a comment so nothing is lost when the feature is built. That it was a bug is the useful part: it is the same mistake the real matrix will make the first time it is written, and now the loader catches it.

#### 4.23.3 Decision 4 — the invented numbers are marked as placeholders

Every quantity in `cohorts.ts` now carries `PLACEHOLDER` and the reason: champion `ai.actions: { perMonth: 3000 }`, trial `ai.actions: { total: 150 }`, both `email.volume` ceilings. The file states that **the 14/7/30-day histories ARE the user's decisions (D-2, D-4)** and the numbers are not, that they are harmless today because nothing meters anything until Slice 3, and that Slice 3 sets them from the shadow report's setup-AI measurement (S1-T15, B-12). Two values are explicitly **not** placeholders and say why: `sms.messages: { perMonth: 0 }` (the feature is `not_built`, and the loader now enforces that) and `team.seats` / `business.locations` at `{ included: 1 }` (invites and multi-location do not exist).

---

### 4.24 Component 3 as built (2026-09-22) — the resolver, for SA review

**Eight files, no wiring.** Nothing calls any of this yet: no enforcement, no shadow, no admin routes. That is deliberate — the component is reviewable as pure logic with injected inputs, and every surface that will use it arrives in Slice 2 through one method.

| File | What it is |
|---|---|
| `account.ts` | `resolveAccountId` (T-2), plus `EntitlementAccount`/`EntitlementOverride` and the two `fromRow` mappers. The resolver never sees a database row. |
| `mode.ts` | `off` / `shadow` / `enforce`, read fresh from the environment on every call. **Imports the logger only**; the two config values UD-2 needs are `require`d lazily *inside* the check, so `off` never loads config (RC-7). |
| `lifecycle.ts` | `deriveLifecycle` — state **and** basis together, plus `historyAt` (S-7). Pure, `now` injected. |
| `resolver.ts` | `resolveEntitlements` — layers 1, 1a, 2, 3, 4 with a per-capability trace; `lowestTierFor` (RC-1); `satisfies`; `withheldValue`. |
| `balance.ts` | The `AiActionBalanceSource` seam and `ALWAYS_SUFFICIENT`. |
| `decide.ts` | The A-2 three-step contract, the overlay lookup (with per-send exceptions, Q-B4) and the T-3 failure policy. |
| `EntitlementService.ts` | `check()`, `getSnapshot()`, `getSnapshots()`, `invalidate()`; the LRU cache; the failure and staleness policy. |
| `index.ts` | The barrel `shadow.ts` will `await import()` in one statement (RC-7). |

**Decisions worth SA's attention** — four places where the workplan left room and I chose:

1. **A tier that has expired, with a cohort that has ALSO ended, resolves from the TIER row, not the cohort.** §4.8's A-1 table fixes the *dates* for that case but not the *basis*. Falling back to the cohort would hand a lapsed Basic subscriber the champion/trial `{ all: true }` base — **more** capability in grace than they had while paying. A test pins it: a Basic account in grace is told `not_entitled` for `chat.search` (the actionable answer) and `read_only` for `crm.core`.
2. **`beta` is not reachable through a tier**, only through a cohort that opts in or an override. That is the catalog's own definition of `beta` ("exists, but is only reached through a cohort or an override"). No capability is `beta` today, so the rule is tested against a catalog with one — otherwise the test would pass by having nothing to check.
3. **An add-on cannot buy a `not_built` capability.** Layer 2 runs after the lifecycle gate, so buying is not a route around "the feature does not exist". Tested.
4. **An unknown capability is `entitlement_unavailable`, not `not_entitled`.** Treating a typo as "entitled" would make the catalog optional; treating it as `not_entitled` would show a customer an upgrade prompt for something that does not exist.

**The RC-15 import guard was widened, deliberately and narrowly.** `EntitlementService` is the module's only reader, so it now appears in the guard's ALLOWED list along with `account.ts` (types + row mapping) and the service's test. The allowance is **conditional**, and a new test states the condition: the service must name `findEntitlementInputs` and must never call `ensurePlanRow`, `updatePlan`, `createOverride`, `endOverride` or `resetPlanState`. Writes stay behind component 5's admin routes.

**SA's C-1 / S1-T6a is closed.** `oneLineChange.test.ts` now resolves a real Growth account and asserts the *entitlement* changes, not just the config: before the one-line edit the account gets `not_entitled` with `lowestTier: 'pro'`; after it, `allowed`, and `lowestTierFor` moves to `growth`; a Basic account is unaffected in both directions.

**Tests: five new suites, 445 tests in the module.**

| Suite | Covers |
|---|---|
| `lifecycle.test.ts` | Histories (including "shortening the trial does not shorten a running one"), pins, anomalies, RC-4, the A-1 fallbacks, and a **sweep of 4 tier states × 5 cohort states × 4 clocks** asserting every result is a state the overlay has a row for — with a non-vacuity assertion that the sweep actually produces all five states (it caught a missing `grace` sample) |
| `resolver.test.ts` | Each layer named; `not_built` under `{ all: true }` and under an override; `beta`; grandfathering in four directions; add-ons; override order, expiry and ended-ness (with the negative control that a live override still applies); `lowestTierFor` `null` for **every** capability on the production config |
| `decide.test.ts` | Step 0 never says `not_entitled`; public/transactional fail open; marketing defers; the B-9 and B-11 overlay tables; per-send exceptions; **the order** (entitlement before state, state before balance); `limit_reached` carrying `atLimit` |
| `entitlementService.test.ts` | One read for two calls; re-read after the TTL; **a trial expiring inside the TTL** (the reason the cache holds inputs); LRU bound; batch chunked at 100 and cache-neutral; stale served to a client surface and refused to an owner-paid one; a broken config behaving like an outage; the balance source consulted **only** after steps a and b pass |
| `mode.test.ts` | Default `off`, unrecognised values `off`, and UD-2 — `enforce` downgraded to `shadow` on the shipped config, logged at `error` (asserted through a mocked logger), **with the negative control** that it passes through once a tier exists or the gate is switched off |

**Verification**

| Check | Result |
|---|---|
| `npm run test:bos-entitlements` | **43 suites, 797 tests, 0 failures** (was 37 / 677 after component 2) |
| Full `jest` | 397 suites pass; **22 fail, all pre-existing** in `lib/agentkit/**`, `__tests__/DeclarativeCompiler*`, `lib/orchestration/**` and `lib/business-os/llm/callParams.boundary.step3` — none imports anything this component touches |
| Typecheck, the verified method | **2,030 project diagnostics — identical to the baseline — 0 × TS2688, 0 in any entitlements file** (two of my own errors were found and fixed first) |
| `npm run lint:hooks` | clean |
| `console.*` / `any` in the new source | 0 / 0 |

**One fixture change worth flagging.** `FixtureTierMatrixSource` now memoises, like the shipped `CodeTierMatrixSource`. It did not, and because the service calls `load()` on every `check()`, every service test was paying ~5 ms of Zod per call — which made the cache-eviction test take 29 seconds and, worse, meant the tests were measuring validation rather than resolution. Measured cost of a resolution itself: **0.057 ms** for 37 capabilities.

**Still open in this component, by design:** `past_due` (needs a Slice 4 billing event), the real balance source (Slice 3), and cross-instance cache invalidation (documented as a 30 s bound that every decision carries as `effectiveWithinSeconds`).

---

### 4.25 SA review fixes applied (2026-09-22) — R-1 to R-3, C3-1 to C3-3

All six from §13.6. Implementation stays uncommitted.

| # | What changed |
|---|---|
| **R-1** | §4.20.3 opens with a two-sentence orientation: **only steps 4 and 5 change anything**, and the `25006` read-only failure is called out *before* it happens, with the one-line `RESET`. Step 4's failure branch is now a table, with `25006` as the **first** row — "the most likely failure, and the least alarming" — ahead of `55P03` and the missing-role case. Step 2's read-only note now says explicitly that the APPLY step is one of the things that will fail on that tab, rather than the vaguer "a later query of yours". |
| **R-2** | The header claim is gone. Both read-only scripts now say the guarantee is that **the file is one `SET` and one `SELECT` with no DML anywhere** — which holds however the editor submits the paste — and that the `SET` is a second line of defence whose reach we cannot establish from here. In its place the last output row **reports** `current_setting('transaction_read_only')` and `current_setting('default_transaction_read_only')`, with a `what_to_do` that reads differently depending on which it finds. The operator's own grid answers the question this review could not, the first time it is run. The rollback's paste-1 session row reports the same pair. |
| **R-3** | Two free pieces of trigger evidence added. **New step 6b:** Dashboard → Logs → Postgres Logs, search `business_os_plan_fact_`, expect nothing — because the fact triggers swallow their own failures into a `WARNING` by design (S-8(i)), a broken trigger is silent *everywhere except the log*. **Step 8 is now a two-row table** pairing row 61 (`trigger rows since apply`) with the same log search, stated as "these two are what replace the probe suite", each with what to do if it fails. §4.20.2's S-8(i) row is updated: the property is weaker but **observable**, and step 7's PR report now includes "no `business_os_plan_fact_` entries in the log". |
| **C3-1** | `mode.ts` no longer uses `require()`. `config/launch.ts` and `config/tierMatrix.ts` are imported statically — both are side-effect-free data (`tierMatrix.ts`'s only imports are *types*), so neither can throw at import. The header restates the rule as SA specified it: **`mode.ts` must not import `source.ts` or `schema.ts`**, because the property RC-7 protects is "reading the mode must never run config validation", not "must import nothing". A new test in `mode.test.ts` asserts exactly that, with a non-vacuity leg (it *does* import the two data modules, so a file importing nothing would not pass by accident). |
| **C3-2** | Carried into component 5 as a binding sub-item of **S1-T12a**: `add_override` must apply `isGrantingValue` + the capability's lifecycle and refuse a `not_built` grant with 400. The reasoning is recorded there — the resolver already clamps such an override, so without the check an admin reads "I granted it" while the customer still does not have it. The `removals.previousValue` route is noted in the same item. |
| **C3-3** | The write-method check now loops over a named `READ_ONLY_REFERRERS` list (`EntitlementService.ts`, `account.ts`) rather than the service alone, so the next file added to `ALLOWED` inherits the condition. Two supporting assertions: one keeps the non-vacuity leg (the service *does* call `findEntitlementInputs`), and one asserts every read-only referrer is itself in `ALLOWED`. The Q-10 task line now says explicitly that **admin routes join `ALLOWED` but not `READ_ONLY_REFERRERS`** — they are the code that may write. |

**Re-verified after these changes**

| Check | Result |
|---|---|
| `npm run test:bos-entitlements` | **43 suites, 801 tests, 0 failures** (was 797 — four new: the RC-7 import rule, the two C3-3 supporting assertions, and the second read-only referrer) |
| Typecheck, the verified method | **2,030 project diagnostics — unchanged from the baseline**, 0 × TS2688, **0** in any entitlements file |
| `npm run lint:hooks` | clean, exit 0 |
| `console.*` in the module | 0 |

**Nothing else changed.** No resolver, decision, lifecycle, service, catalog, cohort, schema or fixture logic was touched by these six fixes: they are two SQL output rows, four blocks of runbook prose, one import style, and two test files. The only behavioural difference anywhere is that `mode.ts` now resolves two data modules at import instead of on first call.

---

### 4.26 QA fixes applied (2026-09-22) — P-1 to P-4, B-1, C-1, C-2 and the three runbook gaps

All of §14.10, including the two items QA left to the user's discretion. Implementation stays uncommitted.

| # | What changed |
|---|---|
| **P-1** | **The nine `DROP`s now live inside the guard's own `DO` block.** They used to be nine statements after it, which was safe only if the editor submits the paste as one implicit transaction — true under the simple query protocol, and not something anyone can verify about a UI. Arming and dropping are now **one statement**: if `v_confirm` is not `DROP-ENTITLEMENTS`, execution never reaches a `DROP`, however the paste was submitted. |
| **P-2** | **The rollback now works on a half-applied migration** — the case its own header calls realistic, and the one it used to break on. The two "what is lost" counts are wrapped in `IF to_regclass(…) IS NOT NULL`; PL/pgSQL resolves a statement only when it is executed, so a skipped branch never looks for a table that is not there. Every `DROP` was already `IF EXISTS`. Paste 1's header now says what is actually true: if it fails with `relation … does not exist`, that table was never created, **go straight to paste 2 and it will drop whatever does exist**. |
| **P-3** | `check-…` row 25's `what_to_do` now uses the same `count(DISTINCT proname)` as its status. A grant made by two grantors used to produce a `PASS` row carrying "The shadow writer and the admin reset would both fail" — in the grid that goes into the PR. |
| **P-4** | `preflight-…` row 6 is now **`quiet on the parent tables`**: it counts sessions holding a lock on `onboarding_conversations` or `business_profiles` (a `pg_locks` join), not every transaction in the database. The database-wide numbers stay in the finding as context, and the `what_to_do` says plainly that it is an indicator rather than a verdict. A row that warns on every healthy Supabase project is a row nobody reads. |
| **B-1** | **Two lines in `isGrantingValue`**, because it was a two-line fix and leaving a known inconsistency in a rule the user set felt worse than carrying it. `{ included: 0, purchasable: true }` ranks 0 — nothing is included — but it still offers to SELL seats that do not exist, which is the same failure `purchasable` on the add-on shape is treated as granting for. Quantity is the only other shape with an offer. **Mutation-checked: removing the two lines fails exactly 2 tests.** The new block also closes QA's **B-2** for the quantity shape, using a synthetic `not_built` catalog entry (the pattern `resolver.test.ts` already uses for `beta`), with a control asserting the real lifecycle still accepts the same values. |
| **C-1** | The import guard now asserts **every `ALLOWED` entry falls into exactly one of four categories** — `lib/repositories/**`, `READ_ONLY_REFERRERS`, `app/api/admin/**`, or a test file. The hazard QA named (a new non-route file added to `ALLOWED` but not to `READ_ONLY_REFERRERS`, inheriting no write condition) is now a failing test rather than a comment asking a human to notice. Four categories, not three, because the entitlement service's own test is none of the other three and pretending otherwise would have meant a special case. |
| **C-2** | **Stated, not changed.** The behaviour is right; it was the third rule in that branch and only two were written down. §4.8's A-1 table now names all three — **basis** = the tier row, **access end** = the later of the two dates, **grace length** = the cohort's — and says why the third is deliberate: an account that was also a lapsed champion keeps the champion's 30 days, because the alternative would mean having been a champion made their lapse *worse*. The same three lines are in `lifecycle.ts`, and a new test pins the champion's 30 days against the shorter subscription grace as its control. |
| **Runbook 1** | **How to get the migration text.** Steps 4 and 5 now say: open the file on GitHub (it is in the PR's *Files changed*), click **Raw**, select all, copy — **and why**: copying from the rendered view brings the line numbers with it and the paste fails on the first one. |
| **Runbook 2** | **Step 3's backup decision is now a table, not a judgement.** Three states, three actions; the third is "**stop and ask** — or write in the PR, before step 4, in these words: *no backup taken; the undo path is the rollback script, not a restore*". Plus one line that the migration being additive is a reason this is unlikely to matter, not a reason to skip it. |
| **Runbook 3** | **Step 4 has a catch-all branch:** any unnamed error → **stop**, do not run step 5, paste the message into the PR — and the reassurance that matters, that **nothing was applied**, because the file is one transaction. A non-engineer's instinct on an unknown error is to re-run; this says when that is safe and who to ask first. |
| **Runbook 4** (QA minor) | Step 6's "most are re-apply 20261005b" now adds that re-applying **on the checker's tab** hits the same `25006`. |
| **Runbook 5** (QA minor) | Step 8 is now a tracked task, **S1-T19**, not a line in a PR: re-run the checker and the log search one week after the apply. It is the evidence that replaces the probe suite, so it **blocks Slice 2 going to shadow** — not the merge. |

#### Walking the rollback on a half-applied database

The state QA is asking about: `20261005` failed partway, so (say) the three tables and two functions exist but the triggers were never created, or the plan table exists and the other two do not. Paste 2, statement by statement:

1. `RESET default_transaction_read_only;` — succeeds on any state. (If an editor somehow skipped it and the connection is still read-only, the `DO` block fails with `25006` and drops nothing. That is the safe direction.)
2. `SET lock_timeout = '5s';` — succeeds on any state.
3. The `DO` block:
   - **Guard first.** Unarmed → `RAISE EXCEPTION 42501`, the block ends, **nothing below it runs**. This is P-1: the drops are inside this same statement, so there is no arrangement of statement boundaries that reaches them.
   - **Counts.** `to_regclass('public.business_os_account_plans')` returns `NULL` when the table is absent, so the `SELECT count(*)` is never executed and never resolved — `v_admin_rows` keeps its `0`. Same for the overrides table. This is P-2: previously this line raised `42P01` and aborted the batch, so a half-applied database could not be cleaned up at all.
   - **Drops.** Each is `IF EXISTS`, so a missing trigger, function or table is a no-op rather than an error. The two `DROP TRIGGER … ON public.onboarding_conversations / business_profiles` statements name the **parent** tables, which always exist — the triggers are what may not. Order is unchanged: triggers → functions → tables, so nothing is dropped out from under a dependent.
4. The final `SELECT` reads only `pg_class`, `pg_proc` and `pg_trigger` through `to_regclass`/`EXISTS`, so it returns a grid on **any** state, including one where nothing existed to drop: `PASS` / "all nine objects are gone".

The case that still fails loudly, correctly: a `DROP` that cannot get its lock within 5 s raises `55P03`. Because everything is one `DO` block inside one implicit transaction, that rolls the whole thing back — no half-dropped schema — and it can simply be re-run.

**Re-verified after these changes**

| Check | Result |
|---|---|
| `npm run test:bos-entitlements` | **43 suites, 807 tests, 0 failures** (was 801: +5 for B-1/B-2, +1 for C-2, +1 for C-1, −2 folded) |
| `npm run test:authz-guard` | **74 passed**, no new exemption |
| Typecheck, the verified method | **2,030 diagnostics — identical to the baseline**, 0 × TS2688, **0** in any entitlements file; control still 3 in other `lib/repositories/*.ts` |
| `npm run lint:hooks` | clean, exit 0 |
| `console.*` / `: any` in the module | 0 / 0 |
| B-1 mutation check | Removing the two lines fails **exactly 2** tests, both the new ones |

**Source changed this round:** `schema.ts` (two lines + one import). Everything else is SQL, tests and prose — `resolver.ts`, `decide.ts`, `EntitlementService.ts`, `account.ts`, `balance.ts`, `index.ts`, `mode.ts`, the catalog, the cohorts and the fixtures are untouched. `lifecycle.ts` gained a comment block and no code.

---

### 4.27 Component 4 as built (2026-09-22) — shadow mode and the report, for SA review

**Four files, one line in chat-v4, one repository read.** Nothing is enforced and no admin route exists (component 5 owns that): `report.ts` exports `buildShadowReport()` and waits to be called.

| File | What it is |
|---|---|
| `planCapabilities.ts` | `capabilitiesForPlan(plan)` → the capabilities a chat turn would need, with surface, item count and **both readings of the read rule**. Separate from `shadow.ts` because it imports the chat map, which `shadow.ts` may not touch at module scope (RC-7). |
| `shadow.ts` | The hook. Top-level imports: the **logger and `mode.ts`, nothing else**. Everything past the flag check is in an un-awaited `try`. |
| `report.ts` | `buildShadowReport()` — static / observed / `asTier` / setup-AI. |
| `BusinessOsAccountPlanRepository.findTenantsMissingPlanRow` | The one new read (see the limitation below). |
| `app/api/business-os/chat-v4/route.ts` | One call, `shadowChatPlan({ userId, plan, correlationId })`, after the plan exists and before the write preview (~L985 on current main, verified). |

#### 4.27.1 The three ways the shadow path is kept off the request path

WC-21 asks that shadow mode cannot affect the turn it observes. One mechanism would have been a claim; three make it a property:

1. **`getEntitlementMode() === 'off'` is the first statement**, and the only module-scope imports are the logger and `mode.ts`. With the flag unset — production today — the function loads no config, reads nothing, writes nothing. A Zod error in the entitlement config **cannot** reach the chat route's cold start.
2. **Everything else runs inside `void (async () => { try { … } catch })()`.** Not awaited, so the response never waits; `await import()` *inside* the try, so even a module that throws while loading is caught.
3. **The repositories already swallow their own errors**, so a database failure arrives as `{ error }` rather than an exception.

Tested by breaking each collaborator in turn — a throwing config loader, a throwing `getSnapshot`, a throwing `recordEvents`, an unrecognisable plan — and asserting the caller is untouched and the failure is one log line. The `off` case is asserted twice: once normally, and once **with every collaborator broken**, which is what proves the flag check really is first.

#### 4.27.2 What gets recorded, and why `allowed` is most of it

Per turn, one row per `(capability, surface, outcome, rule)`, folded locally and sent in one RPC call. `allowed` outcomes are recorded too (RC-6) — **today they are nearly all of it**, because production has no tiers and every existing account is a champion. A denials-only recorder would write an empty table and the first price list would be designed on nothing. The denials come from the `asTier` replay instead, which is the right place for them: they are a question about a *hypothetical* tier, not an observation.

One read per turn, not one per capability: `getSnapshot()` once, then `decide()` per capability. Shadow mode has no balance question (nothing is metered until Slice 3), so going through `check()` would add a cache lookup per capability and answer nothing extra.

**Reads are recorded under both readings of the chat read rule** (Q-B1). A `find` on `contacts` is `crm.core` under `domain_group` and `chat.search` under `read_only_plans_need_search`; both rows are written, tagged with the rule. Everything else maps identically and is tagged `both` — so a reading's true total is `rule IN ('<that reading>', 'both')`, and the user can settle Q-B1 from the report without re-running anything.

**An unmapped entity is logged at `error`, not recorded.** FR-8 says every chat action is classified; an unclassified one would decide whether an owner can act once enforcement is on, so it is a defect rather than a data point.

#### 4.27.3 How the report answers "what would tier X cost this account?"

The `asTier` replay is the section the whole component exists for, and it is worth being precise about what makes it useful:

- It replays **recorded usage**, not the matrix. Anyone can read off that Growth excludes `chat.search`; what nobody can read off is that **37 accounts used it 412 times last month**. The output is per capability: `{ capability, surface, accounts, hits, tierValue }`, sorted by **accounts first, then volume** — a capability three accounts cannot work without matters more than one that a single account used a thousand times.
- It counts only observations that were **`allowed`** at the time. An observation already refused for another reason says nothing about the tier, and counting it would inflate every plan's apparent cost.
- It reports `accountsAffected` (distinct accounts losing at least one capability) and `wouldKeep` (capability/surface pairs the tier covers) — the second is the control that stops "everything is a loss" reading as a valid answer.
- `asTier` is validated against `TIER_ORDER`: `no_tiers_configured` on the production config (today's real answer), `unknown_tier` for a name that is not there. **The rest of the report still builds** — a replay that cannot run must not take the static and observed sections with it.

The discriminating test is the one worth keeping: the *same* usage replayed against Basic, Growth and Pro yields three different answers (`['chat.marketing','chat.search']`, `['chat.search']`, `[]`). A replay that returned the same thing for every tier would have passed every other assertion.

#### 4.27.4 A-1 and S1-T11a — the list that answers "who is getting this free, for ever?"

One list, `static.noEndDate`, covering **both** kinds of open-ended access, each row saying which it is: an open-ended cohort (`cohort_expires_at IS NULL`) and an open-ended tier assignment (`tier_expires_at IS NULL`, the reason A-1 exists). Each row carries `{ accountId, kind, name, since, origin, hasBusinessProfile }` and nothing else.

`hasBusinessProfile` is **S1-T11a**, and it costs no extra read because the plan row already records the fact. The backfill deliberately treated "a business profile **or** any onboarding message" as a tenant, so accounts that opened onboarding once and never came back are open-ended champions too. `noEndDateWithoutProfile` counts them: that number is the trim list, and having it means trimming before enforcement is a decision somebody makes rather than something they discover.

#### 4.27.5 Setup-AI cost (S1-T15 / B-12)

Distinct Layer-1 **action groups** (not calls — one user-visible action can be several model calls) in `business-os-onboarding`, `business-os-website` and `business-os-intake`, within each account's first 14 days, read through `TokenUsageRepository`. Reported as median / p90 / max over a sample of up to 200 accounts, with `withNoSetupAi` as the honesty check.

This is the number the trial allowance has to exceed with headroom: setup AI counts against the trial total (B-12), and `cohorts.ts`'s `{ total: 150 }` is a `PLACEHOLDER` nobody chose. Off by default (`includeSetupAi`) because it is a per-account ledger read and the only slow part of the report. The test proves it counts groups rather than calls, and that `business-os-chat` is excluded — chat is not setup, and letting it in would inflate the very number the allowance is sized against.

#### 4.27.6 Decisions and limitations for SA

1. **`findTenantsMissingPlanRow` scans accounts with a business profile, not the full tenant set.** An exhaustive anti-join needs SQL (`onboarding_conversations` has one row per message and PostgREST has no `DISTINCT`), and adding an RPC for a report felt like the wrong trade this slice. The gap is covered from two directions: `check-…` row B1 does the full anti-join at apply time, and the S1-T11a flag shows onboarding-only accounts from the other side. The report says so in its own output (`scope`), not only in a comment. **If SA wants it exhaustive, it is one RPC.**
2. **`analyse` maps to `owner_ai`, not `owner_read`.** It is the step that asks the model to say something, and in grace `owner_ai` is read-only while `owner_read` is allowed. Calling it a read would have made the overlay wrong in exactly the state the overlay exists for.
3. **A `for_each` asks for two capabilities** — `chat.bulk` *and* whatever the fanned-out action needs — with `items` carrying the fan-out size. Recording only `chat.bulk` would hide what the bulk operation actually did; recording only the action would lose that it was bulk at all.
4. **The RC-15 guard's `READ_ONLY_REFERRERS` is renamed `NO_STATE_WRITE_REFERRERS`.** `shadow.ts` writes — it records observations — so a list called "read only" would have been a lie the moment component 4 joined it. The invariant that actually matters is unchanged and still enforced: **none of these files may call a method that changes what an account is entitled to.** Admin routes join `ALLOWED` but never this list.
5. **The report degrades rather than failing.** A page that errors marks the section `truncated`; an unreadable shadow window yields an empty `observed`. A report that returns nothing because one query timed out is a report nobody gets.

#### 4.27.7 Verification

| Check | Result |
|---|---|
| `npm run test:bos-entitlements` + the chat-v4 route suites | **47 suites, 853 tests, 0 failures** (was 43 / 807) |
| Typecheck, the verified method | **2,030 project diagnostics — identical to the baseline**, 0 × TS2688, **0** in any entitlements file and **0** in `chat-v4/route.ts` |
| `npm run lint:hooks` | clean, exit 0 |
| `console.*` / `: any` in the new files | 0 / 0 |

New tests: `shadow.test.ts` (12), `planCapabilities.test.ts` (10), `report.test.ts` (17). Negative controls throughout — the `off` path asserted with every collaborator broken, the replay asserted to *differ* between tiers, the no-end-date list asserted to exclude an account that has an end date, and the RC-16 exposure test asserted non-vacuous (the report really did contain the account it read before we assert it contains no admin id).

#### 4.27.8 The production hand-off

`docs/BUSINESS_OS_ENTITLEMENTS_APPLY_RUNBOOK.md` — the same eight steps as §4.20.3, rewritten for the operator: no section numbers, no QA finding references, no internal vocabulary, each file explained where it is first needed, and the `25006` trap in the first screen rather than buried in step 4. It is meant to be linked (or pasted) from the PR description. §4.20.3 links to it and says the two change together.

---

### 4.28 SA review fixes applied (2026-09-22) — R4-1 to R4-3 and the two low-priority items

All of §13.7. Implementation stays uncommitted; QA is running in parallel.

| # | What changed |
|---|---|
| **R4-1** | **The replay now assumes ONE reading of the chat read rule.** `replayAsTier` skips events whose `rule` is neither `both` nor the reading being replayed, the reading defaults to `config.chatActionMap.readRule` (the world we would actually be in) and is selectable via `asTierReadRule` so the comparison the dual recording exists for is still possible, and `AsTierSection.reading` states which was used. Without this, one look-up appeared as two losses and `accountsAffected` counted accounts that would lose under **either** reading — a world that cannot exist, since only one reading is ever configured. |
| **R4-2** | `shadow.ts` resolves the account id through **`resolveAccountId`** once, and uses it for both the snapshot and the recorded row, so the two can never disagree about whose usage it was. One line, and exactly the call site that would be missed when a user stops being an account (T-2). |
| **R4-3** | `accountsAffected` → **`accountsAffectedCount`** (accounts) and `wouldKeep` → **`keptCapabilitySurfaceCount`** (capability/surface pairs). Side by side they read as a matched pair; they are different units, and the second is a control on "everything is a loss", not a count of happy accounts. |
| **Low — the fan-out count** | `items` → **`plannedItems`** through the whole path (`PlanCapabilityRequest.plannedItems`, `ObservedRow.plannedItemsTotal` / `plannedItemsMax`). `for_each.max` is the planner's cap, clamped by the catalog: the run may touch fewer rows, and in shadow mode it has not run at all. A fair-use ceiling set against "rows sent" when the number is really "rows we were willing to send" would be set too high. |
| **Low — runbook step 5** | Step 5 now has the same failure table as step 4, in **both** the workplan and the operator's copy: `25006` (same read-only tab), `57014` (the ten-minute cap; the whole statement rolled back and it is re-runnable by design), `23503` (the FK case pre-flight row 3 warns about), and a catch-all. The catch-all spells out the difference from step 4: **the schema from step 4 IS applied, and that is fine** — it is inert until the backfill runs. |
| **SA condition recorded** | `findTenantsMissingPlanRow` must become an **exhaustive SQL anti-join before enforcement is switched on**, recorded as a **blocking row in §5 (Slice 2)** and as a warning in the method's own docstring. The reasoning is in both places: the gap is harmless while nothing is enforced, but under enforcement a missing plan row resolves to the `no_plan_row` anomaly, which denies owner-paid capabilities — an invisible bookkeeping failure of ours becomes a real customer refused something they are entitled to. **It blocks the switch-on, not the Slice 2 merge**, and sits with G-1 in the pre-enforcement checklist. |

#### 4.28.1 The R4-1 test, and why the old ones could not have caught this

SA's diagnosis was exact: every existing replay test used `rule: 'both'` events, so **none of them exercised the dual recording this component introduced**. The new `describe` block feeds the recorder's real output — the same look-up written twice, once per reading — and asserts five things:

| Test | Asserts |
|---|---|
| under `domain_group`, Basic loses nothing | a contacts look-up is `crm.core`, which every tier has |
| under `read_only_plans_need_search`, the same account loses `chat.search` | the reading genuinely changes the answer |
| **never counts ONE look-up as TWO losses** | a `proposals` look-up is `chat.quotes` under one reading and `chat.search` under the other, and **Basic has neither** — so without the filter one question by one account produced two losses. Now exactly one, whichever reading is assumed |
| defaults to the configured reading **and gives that reading's answer** | asserting `reading` alone would pass for a replay that ignored it |
| `both` events survive either reading | a mutate must not vanish because a reading was selected |

**Mutation-checked:** removing the one-line filter fails **3 of the 5**, and the three are the ones that encode the bug. The third case is the one that matters — it is the only shape where the un-filtered replay produces a *number* that is wrong rather than an answer that happens to coincide.

**Re-verified after these changes**

| Check | Result |
|---|---|
| Scoped suites + chat-v4 | **47 suites, 858 tests, 0 failures** (was 853; +5 R4-1 cases, with two existing assertions renamed) |
| Typecheck, the verified method | **2,030 project diagnostics — identical to the baseline**, 0 × TS2688, **0** in any entitlements file or `chat-v4/route.ts` |
| `npm run lint:hooks` | clean, exit 0 |
| `console.*` in the module | 0 |

**Files touched this round:** `report.ts`, `shadow.ts`, `planCapabilities.ts`, `report.test.ts`, `planCapabilities.test.ts`, `BusinessOsAccountPlanRepository.ts` (a docstring warning only), the workplan and the operator runbook. No resolver, lifecycle, service, decision, catalog, cohort or schema logic was touched.

---

### 4.29 QA fixes applied (2026-09-22) — B-1 to B-5, A-1, A-2, D-1

All of §14.11, including the three QA offered to defer. Implementation stays uncommitted.

| # | What changed |
|---|---|
| **B-1** | **The setup-AI sample is now what it claims.** New repository read `findRecentOnboardedPlans` orders by **`onboarding_started_at` descending** and excludes accounts that never started onboarding. It used to be `pagePlans({ limit: 500 })` — ordered by **uuid** — then `.slice(-200)`: neither recent nor random, and above 500 plan rows most accounts could never be sampled at all. Ordering by `created_at` would have been no better: for every account the backfill touched that is the moment the backfill ran, so tens of thousands of rows share one timestamp. The output now carries `sampleBasis` in words and `sampleOnboardedBetween`, so "recent" is a fact a reader can check rather than a claim. |
| **B-2** | **The setup-area filter is pushed down to the query**, `{ featurePrefix: 'business-os-onboarding', features: ['business-os-website', 'business-os-intake'] }`. It used to read **every** Business OS call newest-first under a 1,000-row ceiling and filter in JS — so a chat-heavy account's setup calls, which sit at the *start* of the window, fell off the end and the account reported **0**. `reachedCeiling` is no longer ignored either: `accountsAtReadCeiling` and `accountsUnread` are in the output, and the note says in words that a non-zero ceiling count makes the percentiles **lower bounds**. Both defects biased the trial allowance **downwards**, which is the one direction B-12 exists to prevent — too small a number ends a customer's trial on their first day. |
| **B-3** | `AsTierSection.windowTruncated` carries the same flag its sibling `ObservedSection` already had. `findWindow` caps at 20,000 rows ordered by day *descending*, so a truncated window is biased toward recent days — and the replay is the number a price list gets built from. |
| **B-4** | `noEndDateWithoutProfile` (rows) → **`noEndDateAccountsWithoutProfile`** and **`noEndDateAccountCount`** (distinct accounts). One account can appear twice — an open-ended cohort *and* an open-ended tier — and this is the list someone acts on when trimming free access. The same units mismatch R4-3 fixed one section over. |
| **B-5** | **`findTenantsMissingPlanRow` has six repository tests**: 100-id chunking asserted from the actual `in()` calls, de-duplication of two profiles for one account, the `maxAccounts + 1` truncation probe, the error path, and the no-profiles case asserting **no plan query is sent at all**. It had zero before and was faked in all three report tests. |
| **A-1** | **`both` now means "the two readings agree"**, derived by comparing them, rather than being inferred from `op === 'find'`. A look-up fanned out inside a `for_each` was resolved under the configured reading and then tagged `both`, so R4-1's filter kept it under *either* reading — the same double-count, one level down. `mappingsFor()` is now the single place that decides, used by both branches. |
| **A-2** | **R4-2's missing half.** Two assertions: a behavioural one (the seam is mocked to return `account-for:<id>`, and both the snapshot call and every recorded row must carry that value — the only way to prove the seam is consulted, since `AccountId` is a `string` alias), and a new `accountSeam.guard.test.ts` that requires every module file handling a `userId` to either call `resolveAccountId` or be on an EXEMPT list with a stated reason. The next entry point has to classify itself. |
| **D-1 + SA's caveat** | A **`limitations` block in the report's own output**, because the person pricing a plan reads the JSON: `hookedSurfaces` (chat is the only recorded surface in Slice 1), `absentCapabilities` (absence means "not used **through chat**", not "not used"), `countingUnit` (requests, not intents — a retried turn counts twice). |

#### 4.29.1 Can the setup-AI number be trusted now?

**As a measurement of what it measures, yes — and it says what that is.** Three qualifiers remain, all now visible in the output rather than inferable:

1. **It is a sample of up to 200 recently-onboarded accounts**, not a census (`sampleBasis`, `sampleOnboardedBetween`).
2. **A ceiling-capped account makes the percentiles lower bounds** (`accountsAtReadCeiling`, and the note says so in words). With the filter pushed down this should now be rare — 1,000 *setup* calls in 14 days would be extraordinary — where before it was routine for anyone who used chat.
3. **It counts groups in the ledger.** An AI action that never reached `token_usage` is invisible to it, and `ungrouped:<call id>` counts a call with no group id as its own action — which over-counts slightly, in the safe direction for an allowance.

What is no longer wrong: the sample is now recent and reachable by every account, and a chat-heavy account no longer reports zero setup AI. **Both of the fixed defects pushed the number down**, so any allowance sized from the old output would have been too small.

**Re-verified after these changes**

| Check | Result |
|---|---|
| Scoped suites + chat-v4 | **48 suites, 880 tests, 0 failures** (was 47 / 858: +6 repository, +7 report, +2 plan, +1 shadow, +4 seam guard) |
| `npm run test:authz-guard` | 74 passed |
| Typecheck, the verified method | **2,030 project diagnostics — identical to the baseline**, 0 × TS2688, **0** in any entitlements file, `chat-v4/route.ts` or the repository |
| `npm run lint:hooks` / `console.*` | clean / 0 |

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
| **BLOCKING (SA, component 4 review): the missing-plan-row check must become exhaustive** | `BusinessOsAccountPlanRepository.findTenantsMissingPlanRow` currently scans accounts that have a **business profile**, because an anti-join across `business_profiles` and `onboarding_conversations` cannot be expressed through PostgREST (one row per message, no `DISTINCT`). That is an acceptable reporting gap **while nothing is enforced** and a missing row costs nobody anything. **From the moment `enforce` is switched on it stops being acceptable**: a tenant with no plan row resolves to the `no_plan_row` anomaly, and under enforcement an anomaly denies owner-paid capabilities — so an invisible bookkeeping failure of ours becomes a real customer being refused a feature they are entitled to. **Replace it with an RPC doing the anti-join in SQL** (`SELECT user_id FROM (… UNION …) t LEFT JOIN business_os_account_plans p USING (user_id) WHERE p.user_id IS NULL`), same shape as the `check-…` script's B1. **This blocks the switch-on, not the Slice 2 merge**, and belongs with G-1 in the pre-enforcement checklist. |
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

### 13.5 SA Code Review — production-safe verification + component 2

**Reviewed by SA — 2026-09-22** (uncommitted tree; workplan at `bbd004c6`; component 1 committed at `2bbbb2ec`)
**Status:** ✅ **APPROVED — CLEARED FOR QA**, with required fixes P-1 to P-3 on the runbook (do these **before** the production apply) and low-priority C-1 to C-3 on component 2. Nothing found that blocks QA.

#### What SA ran

| Check | Result |
|---|---|
| `npm run test:bos-entitlements` (the new CI job's command) | **37 suites, 676 tests, 0 failures.** It does include `supabase/migrations/__tests__` and `lib/repositories/__tests__` — **F-1 from §13.3 is closed.** |
| `npm run lint:hooks` | Clean. |
| `npm run typecheck:bos-llm` | Fails **in this worktree only**, and not because of this work: the worktree has no `node_modules`, so `@types/jest` resolves for nothing and every in-scope test file reports `TS2593/TS2304` — including the pre-existing `scripts/__tests__/bos-llm-settings.test.ts`. **Filtered to entitlement source files, the count is 0.** |
| `tsc` over `lib/business-os/entitlements/**` with `typeRoots` pointed at the real `node_modules` and `types: ["jest","node"]` | **Exit 0 — zero diagnostics, tests and fixtures included.** So the newly-scoped folder is genuinely clean and the gate should be green in CI. |

**Condition:** because the gate cannot be run faithfully here, **the PR's `Type check (Business OS LLM attribution)` run is the real evidence.** If it reports new errors, they are fixed — `--update-baseline` must never be used to absorb an entitlements error, which would defeat the reason the folder was added to the scope.

---

#### A. Production-safe verification

**Is "safe on production" enforced rather than promised?** For the read-only script, **yes, and by the right mechanism.** `SET TRANSACTION READ ONLY` is a transaction property enforced in the executor, not a permission, so it cannot be defeated by `SECURITY DEFINER`, by ownership, or by a function called from the script — a definer function that tried to write inside it still gets `25006`. The only escapes are things this repo does not use (`dblink`, `pg_background`, an extension that writes out of band) and temp-table writes, which are permitted and harmless. I also checked that the script calls **none** of the module's functions: it reads catalogs and counts rows. The `BEGIN … COMMIT` wrapper is closed properly.

**The probe suite's guard.** `statement_timestamp() = transaction_timestamp()` fires exactly when the statements are running in autocommit, which is the case the header warns about (someone pasting fragments). It is a known idiom and adequate. Note what it does **not** protect: a caller who wraps the file in their own transaction and then commits. That is a deliberate act, and the header, the guard and the trailing `ROLLBACK` all say otherwise, so I am satisfied.

**Making the lock probe opt-in is the right call**, and the reasoning in §4.20 is exactly right: a rollback does not undo the plan rows that were *not* created while the table was locked, because the trigger swallowed its own error. Opt-in, a quiet window and a re-run of the backfill afterwards is the correct handling.

**The rollback script** is correct in order (triggers → functions → tables) and in what it drops. It is bounded by `lock_timeout`, wrapped in a transaction, and proves its own completion. What it leaves behind is stated honestly: admin-set cohorts, expiries and overrides cannot be rebuilt, and the two `\copy` lines are the mitigation. One flaw, **C-3** below: the leftover check matches `business_os_%` by pattern, so once Slice 3 adds `business_os_ai_action_usage` this script will report "rollback incomplete" while having done its job correctly — during an incident, which is the worst moment for a misleading error.

**The runbook (§4.20)** is ordered correctly and its "cannot be proven on production" table is honest — particularly about B4 leaving the never-raise guarantee as a code-reading claim, and about not being able to time the backfill before running it. Its weakness is that it **starts at "apply"**. Everything that could go wrong is knowable beforehand, read-only, in about two minutes. Hence P-1 to P-3.

##### Residual risk of applying to production with no prior run anywhere

| Step | Risk | Why |
|---|---|---|
| Schema migration (`20261005`) | **Low** | One transaction: it either lands whole or not at all. `lock_timeout = 5s` bounds the one genuinely intrusive moment — `CREATE TRIGGER` needs an ACCESS EXCLUSIVE lock on `business_profiles` and `onboarding_conversations`, and while it waits it queues behind and in front of other traffic. Worst case is ≤5 s of blocked onboarding/profile writes, then a clean failure and a retry. |
| Triggers becoming live | **Low** | Every onboarding message insert now attempts one extra upsert, which after the first message matches nothing and writes nothing. Any error is swallowed into a `WARNING`. The realistic bad day is log noise, not a failed customer write. |
| Backfill (`20261005b`) | **Moderate — the only step worth preparing for** | Two concrete failure modes. (1) **Duration:** it scans `onboarding_conversations` in full, unions, groups, then updates the new table. Nobody knows that table's size, and the number is knowable read-only in advance. (2) **A foreign-key failure:** every inserted `user_id` must exist in `auth.users`. Both parent tables have validated FKs to `auth.users`, so an orphan should be impossible — but "should be impossible" is exactly the class of assumption that a first production run exists to test, and the failure mode is the whole backfill aborting. Both are safe failures (nothing partially applied), but both are avoidable surprises. |
| Data outcome | **Not a technical risk, a commercial one** | Every existing account becomes an open-ended champion. That is the intended decision, it is reversible by an admin, and the read-only script now reports the trim count (`open_ended_no_profile`). |
| Ordering | **Favourable** | The migration ships before any code reads these tables. If the branch never merges, three unused tables sit there. That is the safest possible order and it is worth saying out loud. |

**Overall: low-to-moderate, dominated by the backfill's two unknowns, and both are removable by read-only queries before touching anything.** Given the user's decision against a branch database, the pre-flight is the single highest-value addition left.

##### Required before the production apply

| # | Fix |
|---|---|
| **P-1** | **Add a pre-apply section to the runbook** — read-only, before step 2. (a) The three tables, four functions and two triggers do **not** already exist. This matters because `CREATE TABLE IF NOT EXISTS` would silently skip a table that exists with a different shape, and the script would then report success over drift. (b) **Orphan check:** `SELECT count(*) FROM (SELECT user_id FROM business_profiles UNION SELECT user_id FROM onboarding_conversations) t LEFT JOIN auth.users u ON u.id = t.user_id WHERE u.id IS NULL;` — if this is not 0, the backfill will abort on its FK, and the fix is a deliberate `WHERE EXISTS` guard, decided calmly beforehand rather than mid-apply. (c) **Scan size:** `SELECT count(*) FROM onboarding_conversations;` and a dry run of the backfill's own `SELECT` wrapped in `count(*)` — same scan, no write, and it gives RM the duration estimate §4.20 says cannot be had. This can be a third script or a block in the runbook; a script is better, because a script gets run. |
| **P-2** | **Bound the backfill's runtime explicitly.** Add `SET LOCAL statement_timeout = '10min'` (a deliberate value) next to its `lock_timeout`. Supabase sets role-level statement timeouts, and inheriting an unknown one means the backfill either dies at a surprise boundary or runs unbounded. Either is worse than a number someone chose. |
| **P-3** | **State the connection and timing constraints as steps, not asides.** Direct connection on 5432, never the pooler (the multi-statement transactions and `SET LOCAL` depend on it — the header says so, the runbook should too), and apply during a quiet window, because step 2's lock wait is visible to live onboarding traffic. The runbook currently reserves "quiet window" advice for the optional probe. |

---

#### B. Component 2

| Requirement | Verdict |
|---|---|
| **T-1 / RC-1 — no commercial tiers in production** | ✅ `TIER_ORDER = []`, `TIER_MATRIX = { version: 1, tiers: {}, removals: [] }`, and `productionConfig.test.ts` asserts it. Eyal's draft lives in `__fixtures__` and is served through the **same** `validateEntitlementConfig`, so the fixture proves the rules rather than proving itself. |
| **FR-12 — tier names confined to config** | ✅ `tierLiteral.forbidden.test.ts` scans the tree against a baseline, and additionally asserts the entitlements module itself names no tier outside `config/`. The `__fixtures__` exemption is narrow and correct. |
| **AC-4 — the one-line change** | ✅ as far as it can be proven now, and the test is honest about measuring **both** halves (one leaf changed **and** the result still validates). What it cannot yet assert is the part that matters most commercially — that the resolver then reports the capability as entitled — because the resolver is component 3. **C-1:** extend this test in component 3 to resolve a fixture Growth account and assert entitlement, so AC-4 is proven end to end rather than at the config boundary. |
| **Removals require a version bump** | ✅ **Genuinely enforced, and the enforcement is itself tested.** `tierMatrix.snapshot.test.ts` proves the comparison catches a boolean switched off, a variant moved down, an allowance cut, a capability dropped, a tier deleted — and then proves it **accepts** the same cut once the ledger entry and version bump are present. The "snapshots something worth snapshotting" test is the right defence against the empty-matrix trap. |
| **Invariants can actually fail** | ✅ Every suite carries negative controls: an unmapped action returns undefined, a tier missing a capability throws, a wrong-shaped value throws, `'renewal'` is rejected before billing and accepted after, a new metered capability fails the load until champions are given a number, an override for an undeclared send is rejected. This is the standard the earlier rounds were reaching for. |
| **The loader is lazy and cannot throw into a request** | ✅ Validation runs on the first `load()`, never at module import; the config modules are data with no import-time side effects; `readCodeConfig()` assembles without validating. Component 3's `shadow.ts` still has to import it lazily inside its try (RC-7) — unchanged. |
| **CI (F-1)** | ✅ Closed. `test:bos-entitlements` covers the entitlements suites, both repositories, the migration guard and the purge invariants; the workflow follows the one-guard-one-workflow convention with the shared scope step and no `paths:` filter. The job name `Business OS entitlements invariants` is the string G-2 will require. |
| **CLAUDE.md** | ✅ No `console.*`, no `any` in source, no client imports, no DB access (this component has none), Zod at the one boundary it owns (config load). `SCOPED_DIRS` was extended with comments only and **no rename** of the script, workflow or job — S-9 respected. |

##### Second opinion on Dev's judgement calls

| Call | SA view |
|---|---|
| **`marketing.mass_email` = `available`** | ⚠️ **The weakest entry in the catalog.** The evidence cited is tables and routes; I looked for the dispatcher that moves a campaign `scheduled → sending → sent` and did not find one — no cron in `vercel.json`, no service. `lifecycle` exists precisely so that nothing unbuildable can be sold, and by the rule "available means a customer gets the outcome today", this does not qualify yet. The same reasoning applies to **`payments.reminders`**, which Dev marked `available` with a note that its sender is a stub — at least there the gap is written down. **C-2:** make the gap explicit in `marketing.mass_email`'s note too ("no dispatcher found; the send path is unverified"), and treat **"every `available` capability has a demonstrated end-to-end path"** as a gate that must be re-run before the first tier is configured, not before this merges. Nothing is sold in this delivery, so this is a documentation-grade risk today and a commercial one later. |
| **`payments.multi_currency` = `available`** | ✅ Reasonable. `lib/business-os/currency.ts` and the per-currency handling in the chat catalog are real. |
| **posts / mobile / marketing-analytics / full-payment-cycle / SMS / act-for-you = `not_built`** | ✅ Correct, and correct *direction*: `not_built` is never entitled, so an error here costs a capability nobody can buy rather than a promise nobody can keep. |
| **`team.seats` / `business.locations` = `available`, quantity 1** | ✅ Agreed, and the note's reasoning ("a quantity of 0 would be a lie") is the right way round: the capability exists at one, the *add-on that raises it* does not. One thing to carry: both are `sellableAsAddon: true`, so Slice 4's purchase path must check §18 before it offers to sell a seat that cannot be invited. |
| **`capabilitiesForPlan` deferred to component 4** | ✅ Fine. What had to ship now is the *mapping* and its completeness invariant, and both did: the key space is read from the live chat catalog and cross-checked against all 107 plugin actions, with stale-entry and unknown-entity controls. The function that walks a plan belongs with the shadow recorder that calls it. |

##### Low-priority fixes (component 2)

| # | Fix |
|---|---|
| **C-1** | Extend `oneLineChange.test.ts` in component 3 to resolve a fixture account and assert the capability is entitled, completing AC-4. |
| **C-2** | Record the missing dispatcher in `marketing.mass_email`'s note, and add "every `available` capability has a demonstrated end-to-end path" to the checklist for configuring the first tier. |
| **C-3** | Make the rollback script's leftover check enumerate the eight object names instead of matching `business_os_%`, so a future Slice 3 table cannot make a correct rollback report failure. |

##### For the user

1. **The apply is low-risk, and the one step worth preparing for is the backfill.** Two minutes of read-only queries beforehand (P-1) turn its two unknowns — how long it takes, and whether any account is missing its login record — into known numbers. I have asked for those to be added to the runbook before you run anything.
2. **If anything goes wrong, nothing customer-facing breaks.** These tables are new, nothing in the product reads them, and the feature is switched off. The realistic failure is the migration refusing to start because the database is busy, which is by design — you retry when it is quiet.
3. **The one-line pricing promise is real but not yet fully proven.** Changing a plan's contents is genuinely one line, and the tests prove the config accepts it. Proving that the *answer customers get* changes with it needs the next component; I have asked for that test then.
4. **Two features are marked as built when I could not find the part that actually sends** — email campaigns, and payment reminders (whose sender is a known stub). Nothing is sold today, so nothing is wrong yet. Before you set what each plan includes, those two need a real check, or a customer could pay for something that does not happen.

### 13.6 SA Code Review — SQL-editor rework, the not_built rule, component 3

**Reviewed by SA — 2026-09-22** (uncommitted tree; workplan at `cb76cbd7`; component 2 committed at `e5f5d163`)
**Status:** ✅ **APPROVED — CLEARED FOR QA.** Three required fixes to the runbook and the read-only scripts (**R-1 to R-3**, before the production apply); three low-priority (**C3-1 to C3-3**). Dev's four judgement calls in §4.24 are **all endorsed**, and call 1 is now the record.

**What SA ran:** `npm run test:bos-entitlements` — **43 suites, 797 tests, 0 failures**; `npm run lint:hooks` — clean. I also read the new suites looking for assertions that cannot fail and did not find any; the lifecycle sweep's "did this actually produce all five states" check and the `findEntitlementInputs` non-vacuity line in the widened guard are the pattern I was looking for.

---

#### A. The SQL-editor rework

**Is editor-safety enforced?** For the two read-only scripts, **effectively yes, but by a different mechanism than the header claims** — and the difference is worth writing down.

- **The design carries the safety, more than the `SET` does.** Each script is *one `SET` plus one `SELECT`*. A fragment paste — the failure mode that motivated the guard in the `psql` version — can now only omit the `SET` and run a `SELECT`, which is harmless. That is a better property than the old `BEGIN … ROLLBACK` discipline, because it does not depend on the operator getting the boundaries right.
- **`SET default_transaction_read_only = on` may not cover the statements in the same submission.** It sets the default for transactions *started after* it; a transaction already in progress keeps the read-only status it began with. If the Supabase editor wraps a pasted batch in one implicit transaction — which is plausible and cannot be established from here — then the `SELECT` in that same paste is **not** running read-only, and the header's promise that "Postgres itself rejects any INSERT … and it survives any future edit to this file" does not hold for an edit made to *that* file. Nothing is at risk today, because neither file contains a write. **R-2** makes this observable instead of assumed.
- **The setting outliving the script is the real operational hazard**, and it is the opposite of a safety problem: if it persists on the editor's connection, **step 4's `CREATE TABLE` fails with `25006` "cannot execute … in a read-only transaction"**. Dev clearly knows the shape of this — rollback paste 2 opens with `RESET default_transaction_read_only;` — but the runbook's step 4 lists only `55P03`. For a non-engineer mid-apply, an unexplained error after the *pre-flight said PASS* is the worst moment to improvise. **R-1.**

**Prohibiting the probe suite on production: agreed, and it is the right call, not a retreat.** The suite must insert into `auth.users`; the editor gives no way to guarantee the transaction boundary that makes that reversible; and the downside is fabricated logins committed into the production identity table with `on_auth_user_created` waiting behind them. That is not a proportionate risk for evidence obtainable another way. **Deleting the ACCESS EXCLUSIVE lock probe rather than re-gating it is also right** — QA's finding that removing the backslash lines (the natural repair for an editor paste) silently re-armed it is exactly the kind of latent trap that should not survive review.

**Is §4.20.2's "what is lost" honest?** Yes. It states plainly that S-8(i) — a failing plan write can never fail a product write — is now **structurally asserted** (the Jest guard proves the handler exists and that the body cannot `RAISE EXCEPTION`) rather than behaviourally demonstrated. I accept that trade. One thing it misses: the property is *observable in production for free*. If the triggers were failing, Postgres would be logging `business_os_plan_fact_*` warnings, and step 8's row 61 would stay at zero. **R-3** turns that into a step.

**Is the runbook executable by a non-engineer, end to end?** With R-1 and R-3, yes. It names the grid rows to read, says what each status means, gives a decision at every branch, and puts the one unrecoverable step (the backup) before anything that writes. The step-8 "come back in a week and read row 61" is a genuinely good substitute for the probe we gave up.

| # | Required fix |
|---|---|
| **R-1** | **Add `25006` to step 4 and step 5's failure list**, with the fix inline: `RESET default_transaction_read_only;` then re-run the paste. It is the most likely thing to stop the run, it looks alarming, and it is one line to clear. While there: say once, near the top of the runbook, that **only steps 4 and 5 change anything** — every other paste is read-only. That one sentence is most of a non-engineer's mental model. |
| **R-2** | **Report the read-only state instead of asserting it.** Add an INFO row to both read-only scripts carrying `current_setting('transaction_read_only')` and `current_setting('default_transaction_read_only')`, and soften the header to match what that row will show. The operator's own grid then answers the question this review could not — whether the editor runs a pasted batch inside one transaction — and the answer arrives the first time it is run, for free. |
| **R-3** | **Add the two free pieces of trigger evidence** to step 6/8: check the Postgres logs for `business_os_plan_fact_` warnings (none expected), and re-read row 61 a week later (already step 8 — tie the two together as "this is what replaces the probe"). This is the cheapest available evidence for the one property we stopped proving. |

---

#### B. The `not_built` rule

**Complete across every shape, and fail-closed.** `isGrantingValue` ranks against the capability's own scale, so `true`, any variant above the first, `purchasable`, `included`, and any non-zero quantity / allowance / ceiling all count as granting — and an **unrankable** value is treated as granting, which is the right direction for a rule about not handing out what does not exist. Counting `purchasable` as granting is the important call and the reasoning is exactly right: an offer to sell is where the customer loses, not the moment of delivery. It is applied to tier rows *and* to the hand-written cohort numbers, which is where a champion could otherwise have been given 500 SMS messages nothing can send, and `includeLifecycle: ['not_built']` was already refused.

**Can it be evaded?** Two routes remain, both acceptable today and both closed by the resolver's own `not_built` clamp: a per-account **override** could name a `not_built` capability, and a `removals.previousValue` could restore one. Neither is reachable yet. **C3-2** carries the first into component 5.

**Clamping Eyal's fixture was right.** It was granting eight capabilities that do not exist — a fixture bug, and precisely the mistake the real matrix will make the first time someone writes it, which is the best argument for the rule existing. The fixture still proves what it must: three tiers that differ across booleans, variants, quantities and allowances, and the one-line test still moves `chat.search`, which is `available`. Keeping each sheet value in a trailing comment means nothing is lost when the features are built.

**`payments.reminders` and `website.custom_domain` → `not_built`: both correct**, and both go further than my C-2 asked. The reminder sender is a verified stub, and the custom-domain evidence ("middleware only rewrites `*.baseHost`; the lookup has no caller") is specific enough to re-check later. The invented cohort numbers are marked as placeholders with the measurement that will replace them. **The business consequence belongs to the user** — see below.

---

#### C. Component 3

Checked against §4.8/§4.9 and my own T-3, T-4, T-5, S-6, S-7, RC-11 and A-1 decisions:

| Property | Verdict |
|---|---|
| Three-step contract, `entitlement_unavailable` kept separate | ✅ Step 0 can never answer `not_entitled`; the order is entitlement → state → balance and is tested as an order, not as three independent facts. |
| `{ all: true }` derivation | ✅ Booleans and variants derived, numbers explicit, `not_built` excluded by construction. |
| History semantics (S-7) | ✅ `historyAt` picks the entry in force at the clock, and "shortening the trial does not shorten a running one" is tested. |
| Caching (S-6 / T-5) | ✅ **Raw inputs cached, resolution re-run against the current clock** — and the test that proves *why* (a trial expiring inside the 30 s TTL still resolves as expired) is the one I most wanted to see. LRU bound, batch chunked at 100 and cache-neutral, `invalidate` local with the bound documented and carried on every decision as `effectiveWithinSeconds`. |
| Failure policy (T-3) | ✅ By audience: client render/transactional fail open (stale permitted), marketing defers, owner-paid never sees stale data and gets `entitlement_unavailable`. A balance source that throws does not refuse the call — correct: the failure is ours. |
| The balance seam | ✅ A true no-op: consulted only for metered capabilities, and only after steps (a) and (b) pass, so Slice 3 swaps one object and no call site changes. |

**Dev's four judgement calls — all endorsed.**

1. **An expired tier whose cohort has also ended resolves from the TIER row.** **Agreed, and this is now the record.** §4.8 fixed the dates for that case and left the basis open; the resolution is right and the reasoning is the important part — grace means "look at what you had", not "have everything". The alternative would hand a lapsed Basic subscriber the `{ all: true }` cohort base, i.e. **more capability after they stopped paying than while they paid**, which would make lapsing a rational way to get more. The "later of the two end dates" rule I specified is preserved.
2. **`beta` is unreachable through a tier.** Agreed — it is the catalog's own definition, and testing it against a synthetic beta capability is the only honest way while none exists.
3. **An add-on cannot buy a `not_built` capability.** Agreed. It is the user's rule applied at the one layer where money appears.
4. **An unknown capability is `entitlement_unavailable`, not `not_entitled`.** Agreed. A typo must never render as an upgrade prompt for a product that does not exist, and treating it as entitled would make the catalog optional.

**The RC-15 widening is approved.** Adding the service to the allowed list rather than weakening the guard is the right shape, and the condition is pinned by a test that is itself non-vacuous (it asserts the service *does* read before asserting it never writes).

| # | Low-priority |
|---|---|
| **C3-1** | `mode.ts` uses `require()` to stay off the config at import. It works under webpack and Jest, but it is a bundler-dependent construct in the one file that must never break. **My original condition was broader than its reason:** RC-7 exists to keep *load-time Zod validation* out of the import path, and `config/launch.ts` / `config/tierMatrix.ts` are side-effect-free data that cannot throw. Either keep `require` or switch to static imports of those two modules — and if you switch, restate the guard as "`mode.ts` must not import `source.ts` or `schema.ts`", which is the property that actually matters. |
| **C3-2** | Component 5's `add_override` must apply `isGrantingValue` + the `not_built` rule, so an admin cannot store an override the resolver will silently refuse. |
| **C3-3** | The write-method check in the import guard runs over `EntitlementService.ts` only. Loop it over every allowed non-admin file, so the next addition to that list inherits the condition. |

---

#### For the user

1. **Your rule has its first real cost, and it is worth knowing before you set prices.** Payment reminders and custom domains are now marked "not built" — the reminder sender was never finished, and nothing serves a custom domain yet. Under your rule they cannot be included in any plan until they work. The sheet currently sells both. Nothing is wrong today (no plan exists), but the first price list cannot contain them until someone builds them.
2. **The scripts you will run are safe, and one of them may need an extra line.** The two checking scripts cannot change anything. If the apply step fails with a message about a "read-only transaction", it is the checking script's safety still switched on for that tab — one command clears it, and I have asked for that to be written into the runbook so it is not a surprise mid-run.
3. **We decided not to run the write-tests against production.** Proving one of them needs fake user logins inserted into the real identity table, which is not worth the risk for evidence we can get another way. One property — that a problem creating a plan record can never break a customer's signup — is now argued from the code rather than demonstrated. The week-later check in step 8 is how you would notice if that were wrong, and nothing reads these records in the meantime.

### 13.7 SA Code Review — component 4 (shadow mode + report) and the apply runbook

**Reviewed by SA — 2026-09-22** (uncommitted tree; workplan at `5d7771cc`; component 3 committed at `d0995daa`)
**Status:** 🔄 **APPROVED FOR QA WITH REQUIRED FIXES.** Three required (**R4-1 to R4-3**), two low (**R4-4, R4-5**). None of them affects the request path or the production apply; all three required ones are about **the report being right before anyone prices a plan from it**, so they must land before component 5 exposes it. QA can proceed in parallel.

**What SA ran:** `npm run test:bos-entitlements` — **46 suites, 848 tests, 0 failures**; `npm run lint:hooks` — clean.

---

#### 1. The request path — is it airtight?

**With the flag off: yes, verified rather than accepted.** `shadow.ts`'s only module-scope imports are the logger and `mode.ts`; `getEntitlementMode()` returns `'off'` on the first statement for an unset variable, before any `import()` is reached. No config load, no repository, no DB. That is WC-21 and RC-7 held at the one place that matters.

**With the flag on:** I went looking for each escape route and did not find one.

| Failure | Outcome |
|---|---|
| Config loader throws (Zod) | `await import('./source')` and `getEntitlementConfig()` are both inside the `try` → one `logger.error`. |
| Repository throws | It cannot: component 1 returns `{ error }`. Even if it did, it is inside the `try`. |
| Slow DB | The promise is never awaited by the route, and `shadowChatPlan` returns `void` — a caller cannot `await` it by accident. That return type is doing real work. |
| Rejected promise after the response | The `catch` is the last thing in the IIFE, so there is no path to an unhandled rejection. |
| A throw in the `catch` itself | Only `logger.error` runs there; pino handles circular structures. |

Two honest residuals, neither a defect: **(a)** un-awaited work can be cut short when a serverless function freezes after responding — the cost is a lost observation, never a failed turn; **(b)** under webpack an `import()` of an already-bundled module can evaluate the module body synchronously, so the *first* shadow turn after a cold start pays module evaluation on the request stack. Milliseconds, once per process, only when the flag is on.

**Hook placement (L985) is right and cheap:** after the clarification and no-plan early returns, so it only fires when a real plan exists, and before the write preview, so it records what the turn *needed* rather than what survived confirmation. Consistent with §4.10 leaving the confirm turn and saved-plan runs unhooked in this slice.

---

#### 2. The report's honesty — one real problem

**The `asTier` replay does not discriminate by read rule, and that is the number the first price list will be built from.** By design (S-2, Q-B1) every `find` is recorded **twice**, once under each reading. `replayAsTier` iterates all `allowed` events without filtering on `rule`, so:

- the same underlying read is replayed as two different capabilities (`chat.scheduling` under `domain_group`, `chat.search` under the other reading) and **both appear in `wouldLose`**;
- `accountsAffected` counts an account that would lose something under **either** reading — a world that cannot exist, since only one reading will ever be configured.

The `asTier` tests use only `rule: 'both'` events, so they pass while never exercising the dual-reading recording the same component introduced. **R4-1.** Dev's three-tier test does discriminate in the sense that Basic/Growth/Pro give three different answers — that part is sound — but it discriminates on a data shape the real recorder will rarely produce.

**`wouldKeep` is not the control it reads as.** It counts distinct `capability|surface` keys, while `accountsAffected` counts accounts. Side by side they invite "X accounts lose something, Y accounts keep everything", which is not what the second number means. **R4-3.**

**Can the report mislead in the two ways asked?**
- *Capabilities never exercised:* yes, unavoidably — a capability absent from the data may be unused, or used through a surface not yet hooked (only chat is). The report should not be read as "nobody needs this". Worth one line in the report's own header when the route ships; the `scope` precedent below shows Dev already writes these well.
- *`for_each` double-count:* no double count within a capability — `chat.bulk` and the fanned-out action are different capabilities, and `hits` stays 1 per step with `items` carrying the fan-out. But `items` comes from `step.max ?? 1`, which is the **planned cap, not the rows actually processed**. As an input to "what does bulk usage look like" that is an upper bound, and should be labelled one. **R4-4.**

**RC-16 holds.** The output carries account ids, cohort/tier names and counts; the test asserts that `reason`, `ended_reason`, `business_name`, `email` and both actor columns appear nowhere, and pins the exact key set of a row. **RC-12 holds:** `pagePlans` keyset walk at 500 with a `truncated` flag, and the missing-plan-row read capped at 2,000.

---

#### 3. The mapping judgement calls — all five endorsed

| Call | Verdict |
|---|---|
| `analyse` → `owner_ai`, not `owner_read` | **Right.** The overlay treats them differently in grace, and `analyse` asks the model to produce prose — it is AI consumption, not a lookup. `compute` staying `owner_read` is the correct other half of that line: an aggregation is the database working, not the model. |
| `for_each` records both `chat.bulk` and the inner action, with items | **Right.** Fanning out is itself sellable and the underlying action is still the underlying action; recording one without the other would misprice either bulk or the action. See R4-4 on what `items` actually measures. |
| Every `find` recorded under both readings | **Right, and the whole point of Q-B1 being config** — but it is precisely what R4-1 must account for when replaying. |
| Unmapped entity → `error`-level log as an FR-8 defect | **Right.** Once enforcement is on, an unmapped action decides whether an owner may act; that is a defect, not a data point. |
| `getSnapshot()` + `decide()` rather than `check()` per capability | **Right.** One read per turn, one instant, and shadow has no balance question to ask. |

---

#### 4. `findTenantsMissingPlanRow` is not exhaustive — acceptable for this slice

**Accepted, with one condition.** The gap is real (an onboarding-only tenant with no plan row is invisible to the *report*), but it is covered three ways at the moment it matters: the apply-time `check-` script's B1 uses the full union, the triggers cover new tenants from the first message, and the backfill covered the existing ones. The report also **states its own limitation in its output** (`scope: 'accounts with a business profile …'`), which is the thing that makes a partial answer safe to publish.

**Condition:** it must become exhaustive **before the Slice 2 enforcement flip**, not before this merges. From that moment a missing plan row is an anomaly that denies a real customer, and "we would have seen it in a different script, months ago" stops being good enough. An RPC anti-join now would be premature; a tracked item for Slice 2 is right.

---

#### 5. The rename and deferring the route

**Both approved.** `NO_STATE_WRITE_REFERRERS` is the more accurate name — these files read state and record observations; what they must never do is *change* plan state, which is what the check enforces. It also picks up my C3-3 (the condition now applies to every file in the list, not just the service).

**Moving the shadow-report route to component 5 is the better sequencing:** the whole admin surface then lands behind `requireAdmin` in one PR, reviewed against the authz guard once. `buildShadowReport()` being written, tested and uncalled for one component is acceptable — it is exercised by its own suite, and the import guard will show it the moment it is wired.

---

#### Required fixes

| # | Fix | When |
|---|---|---|
| **R4-1** | **Filter the `asTier` replay by read rule.** Take the reading as a parameter (defaulting to the configured `READ_RULE`), keep events where `rule === 'both' || rule === reading`, and name the reading in the section it returns. Add a test with events under **both** readings proving the two give different answers — the current tests use `rule: 'both'` only and cannot see this. | Before the report is exposed (component 5) |
| **R4-2** | **Route `shadow.ts` through `resolveAccountId`.** It passes the raw `userId` to `getSnapshot()` and records it as `user_id`; `AccountId` is a `string` alias, so the compiler cannot see it. Identity today, so no behaviour changes — but this is the first consumer of the T-2 seam and exactly the call site that would be missed when seats arrive. One line, plus an assertion in the guard that consumers use the seam. | Component 4 |
| **R4-3** | **Make the control mean what it looks like.** Either rename `wouldKeep` to `capabilitiesKept`, or (better) replace it with `accountsFullyCovered` — accounts with zero losses — which is the number a reader actually wants next to `accountsAffected`. | With R4-1 |

| # | Low | |
|---|---|---|
| **R4-4** | Label `items` as an upper bound (`step.max`, the planned cap) rather than rows processed, in the type and in the report. Slice 2 can record the executed count when the executor is hooked. | |
| **R4-5** | Give step 5 of the runbook the same failure table as step 4 (lock timeout, ten-minute stop, foreign-key error, anything else → nothing applied, re-run or ask). It is the step with the two genuine unknowns and currently the thinnest guidance. | |

---

#### 6. The apply runbook, as the artefact the user will follow

**It is complete, safe, and stands alone in a PR description.** All three of my §13.6 required fixes are in it, and in better shape than I asked: the `25006` trap is called out *before* the steps as "one thing will probably go wrong, and it is one line to fix", the "only steps 4 and 5 change anything" sentence is in the opening, and the log check is its own step tied to the property we stopped proving. It also does three things I did not ask for and should have: it says to copy from **Raw** (the rendered view brings line numbers and the paste fails), it refuses to let the backup step pass silently, and its "anything else → stop, nothing was applied, the file is one transaction" row is the right instruction for a non-engineer facing an unknown error.

With R4-5 it is as good as this can be without a rehearsal. Nothing in it misstates what is proven and what is argued.

---

#### For the user

1. **Nothing here changes what customers see.** Shadow mode is off in production, and with it off this code reads nothing and writes nothing — I checked that specifically rather than taking it on trust.
2. **One fix matters to you rather than to the code.** The report that will tell you what to put in each plan currently counts some chat activity twice, because we deliberately record every lookup under both possible readings of the "search" question. Left as is, it would overstate how many customers a given plan would affect. It is being fixed before the report is switched on, so the first numbers you see are the real ones.
3. **The apply instructions are ready to follow as written.** I reviewed them as the thing you will actually use, not as a design document, and the one place I would still improve is more detail if the second apply step fails.

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

### 14.6 Part B — the database runbook — **SUPERSEDED on 2026-09-22 by §4.20**

**Do not follow this section. The runbook is §4.20.** It was written on 2026-09-21 for a premise that no longer holds — a branch or throwaway database, seeded by QA, with one verification script. The user has since decided there will be **no branch database**: the migrations and the checks run against **production**, from the PR. Keeping two runbooks would guarantee that someone follows the wrong one, so this one is retired rather than patched, and its content was re-verified into §4.20 instead.

> **Dev note, 2026-09-22 (after the SQL-editor rework).** §4.20 was rewritten again for the Supabase SQL editor and now has **eight** steps, not seven, so the step numbers in the table below are one behind: apply = steps 4 and 5, checker = step 6, report = step 7, trigger re-check = step 8. The mapping itself is unchanged except for the probe suite, which is no longer optional-on-production but **prohibited** (§4.20.2), and step 3d, which `check-…` row 53 now covers on real data. The current mapping is §4.20.5.

**Where each part went** (QA re-verified this mapping on 2026-09-22, §14.9.3):

| §14.6 step | Where it lives now |
|---|---|
| 0 — seed tenants so the backfill is provable | **Withdrawn.** Production has real tenants: the pre-flight counts them, `check-…`'s `B3` refuses to pass when tenants exist and nothing was backfilled, and the probe suite's `C0` makes the statement non-vacuous without seeding anything. |
| 1 — apply both migrations | §4.20 steps 5 and 6, preceded by three read-only steps. Same files, renamed to `20261005` / `20261005b`. |
| 2 — the verification script | Split in three. The unconditionally-safe checks are `scripts/check-bos-entitlements-migration.sql` (§4.20 step 7); ~~the writing probes stay in `scripts/verify-…` and are optional~~ → **corrected 2026-09-22: the probe suite is PROHIBITED on production** (§4.20.2), not optional; the pre-apply questions are `scripts/preflight-…` (§4.20 step 3). |
| 3a backfill non-vacuity / 3b `service_role` + `proowner` / 3c trigger binding | All three are **inside** `check-…` now (`B3`, `A10` + the owner `NOTICE`, `A9`). Run it instead. |
| **3d — the fact-heal probe** | **Still homeless. Specified as `C4` in §14.9.4** — it writes, so it belongs in the probe suite, not the read-only checker. |
| 4 — re-run the backfill and fingerprint | Kept: §14.9.4 restates it as the only real proof of re-run inertness, which matters more now that the file carries the heal `UPDATE`. |
| 5 — trigger-created rows stay trials; 5b the window query | 5b is `check-…`'s `Q-5` warning. 5 is still a manual insert and is **not** in §4.20 — recorded in §14.9.4 as optional. |
| 6 — numbers for RM | Split: the pre-flight gives the estimate **before**, `check-…` gives the outcome **after**. Both lists are in §4.20. |
| 7 — product still works; the PostgREST round trip | Unchanged, and still unproven until component 3 calls these functions. |

Stale items in the retired text, for anyone reading the diff: step 2's "expect B8 to fail with `ON CONFLICT DO UPDATE command cannot affect row a second time`" was Q-1 and is **fixed**; every `20260921…` filename is now `20261005…`; and the seeded `seed1/2/3` ids never existed, because seeding production is not something this project will do.

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

### 14.9 QA — production-safe verification + component 2 (2026-09-22)

**Test mode:** full, across two scopes — the four verification scripts + the §4.20 runbook, and component 2 (catalog, config, loader, CI).
**Strategy used:** **A + B + E.** Jest suites run independently (A), the config/loader exercised through their own tests and read line by line (B), and adversarial review of SQL and of a runbook that cannot be executed here (E). No database, and production remains out of bounds for QA.
**Input source:** the coordinator's brief + §4.19–§4.22 + §13.5 (P-1..P-3, C-1..C-3).
**Reviewed against:** workplan `67dd9935`; component 1 committed at `2bbbb2ec`; everything else uncommitted.

**Verdict: ✅ PASS — ready for the user's code review and for RM to commit.**
- **Component 2:** no defects. Every number Dev reports reproduces exactly, the invariant suites carry real negative controls, and the two vacuity traps I went looking for (the empty production matrix, the derived-capability list) are both explicitly defended.
- **The production-safety story holds.** For the two read-only scripts it is **enforced, not promised** (`SET TRANSACTION READ ONLY`), and every script fails *closed* in the most likely wrong environment.
- **Nine findings, none blocking a commit.** Three are worth doing before the production apply (**R-1**, **R-4**, **R-7**), and two are judgement calls on the catalog that belong to the C-2 gate (**C2-1**, **C2-2**) — one of which contradicts a decision taken hours earlier.

#### 14.9.1 What QA ran

| Command | Result |
|---|---|
| `npm run test:bos-entitlements` (the exact CI command, run as `jest … --ci`) | ✅ **37 suites, 677 tests, 0 failures** — Dev's number to the digit |
| `npm run test:authz-guard` | ✅ **74 passed**, no new exemption |
| Hooks ESLint over `lib/business-os/entitlements` + `scripts/write-entitlements-snapshot.ts` | ✅ exit 0 |
| `console.*` / `: any` in the module's source | ✅ **0** / **0** |
| Typecheck, the method §4.18 describes (`--max-old-space-size=8192`, `--typeRoots` at the main checkout) | ✅ **2,030 project diagnostics, 0 × TS2688, 0 in any entitlements file**; control: **3** errors in other `lib/repositories/*.ts` and **6** under `supabase/`, so the trees are genuinely in the program |
| `npm run entitlements:snapshot` reproducibility | ✅ **byte-identical** — verified by backing the file up, running the writer through `tsx`, `diff`, then restoring. See **C2-9** for the one way this claim expires |
| **F-1** — does the CI job really run both suites? | ✅ **Genuinely closed.** `package.json:20` lists `lib/business-os/entitlements`, `lib/repositories/__tests__`, `supabase/migrations/__tests__`, the purge descriptor suite and the ownership suite; the run above collected all of them. I also checked the way it could still be defeated: `.github/ci/non-deploying-change.sh` sends `supabase/**` to the catch-all (**BUILD**), so a migration-only PR runs this job; `scripts/**` is skippable, which is right because no Jest suite reads the four SQL scripts. The job's own caveat stands: a green workflow gates nothing until `main` requires it (G-2). |

#### 14.9.2 Part A — can any of this write to production?

**The short answer: no, and in the two cases that matter it is the database refusing rather than the script promising.**

| Script | QA verdict |
|---|---|
| `preflight-…` | ✅ **Safe unconditionally.** `BEGIN; SET TRANSACTION READ ONLY;` is a transaction property enforced in the executor — a `SECURITY DEFINER` function called from inside it would still get `25006`. `EXPLAIN` without `ANALYZE` executes nothing. `\set ON_ERROR_STOP on` is **inside the file**, so the protection survives an operator who forgets the `-v` flag. |
| `check-…` | ✅ **Safe unconditionally**, same mechanism. |
| `verify-…` | ⚠️ **Writes, and is honest about it.** Header, guard and trailing `ROLLBACK` all agree. See R-1 to R-3. |
| `rollback-…` | ⚠️ **Destructive by design**, correct in order and bounded — but the only script with no confirmation (R-7). |

**Is the pre-flight's "raises if any of the nine objects exists" real?** Yes. It accumulates into `present[]` and `RAISE EXCEPTION`s with the remedy in the message (`preflight-…:77-89`); it is not a `NOTICE` that scrolls past. This is the check that stops `CREATE TABLE IF NOT EXISTS` skipping over a drifted table.

**Does the read-only checker have checks that pass vacuously on a database with real data?** I went looking for the opposite of last round's problem and **found none**. `B1` (missing plan rows), `B2` (backfill shape) and `B4` (unhealed facts) are all *stronger* on production than on any throwaway database, because the tenant set is real; `B3` is an explicit non-vacuity gate (`tenants > 0 AND backfilled = 0` raises); `A1`–`A11` are catalog reads that cannot be satisfied by data. The Q-5 window check is a `WARNING` with a count, which is the right level for a fact rather than a failure.

**Deviations a real operator might plausibly make**

| # | Sev | Finding |
|---|---|---|
| **R-1** | **Medium** | **Every script is psql-only, and the plausible workaround is the dangerous one.** All four use meta-commands (`\set`, `\timing`, `\if`, `\echo`, and `\copy` in a comment). Pasted into the Supabase SQL editor — the obvious tool for "apply it myself from a PR" — PostgreSQL parses the whole batch before executing any of it, so the file dies on the first `\` and **executes nothing**: a good failure. The risk is the next thing a person does, which is to delete the backslash lines. For `preflight-…` and `check-…` that is harmless, because their protection (`SET TRANSACTION READ ONLY`) is real SQL that survives the edit. For `verify-…` it is **not**: the lines that make the lock probe opt-in are `\if :probe_locks` / `\else` / `\echo` / `\endif` (`:381-404`), and deleting them leaves the B4 `DO` block **enabled** — the ACCESS EXCLUSIVE lock on the plan table that §4.20 deliberately made opt-in, now running on production. **Fix: one line in §4.20 and one in the probe header — "if you cannot run `psql -f`, run the pre-flight and the checker only, and never the probe suite."** |
| **R-2** | Low | **The transaction guard is a statement, not a policy.** It catches "pasted from the top without `BEGIN`". It cannot catch "pasted from the middle", because a guard that was not pasted does not run. A second line of defence already exists **by accident**: every writing block reads the `_bos_probe` TEMP table created in the header, so a fragment pasted alone fails with `relation "_bos_probe" does not exist` before it writes anything. That is worth one sentence in the header, so it is deliberate rather than lucky. |
| **R-3** | Low | **The guard will usually fire even when the file *is* wrapped, if the whole file arrives as one command.** `statement_timestamp()` is the receipt time of the *command message*, so every statement of a multi-statement simple query shares it, and an explicit `BEGIN` inside that batch adopts it as the transaction start. So `psql -c "$(cat …)"` or an editor paste tends to raise `25P01` despite a `BEGIN` being present. That is the safe direction and needs no code change — but the header's explanation ("in autocommit … the two are identical") should add "…or when the whole file arrives as a single command", so the next person does not debug a refusal that is working as intended. |
| **R-4** | **Medium** | **The pre-flight never checks that the three Supabase roles exist.** `20261005` does `REVOKE … FROM anon, authenticated` and `GRANT … TO service_role`. If any is absent the apply fails — safely, since the file is one transaction — but this is exactly the class of avoidable surprise the pre-flight was added for, and it is one query: `SELECT rolname FROM pg_roles WHERE rolname IN ('anon','authenticated','service_role');` expecting three rows. |
| **R-5** | Low | **The pre-flight prints the two numbers that would reveal a duplicate-tenant problem but never compares them.** `rows_the_backfill_would_insert` can only exceed the tenant count if `business_profiles.user_id` stopped being `UNIQUE` (it is today) — in which case the backfill's `LEFT JOIN` multiplies rows and `business_os_reset_plan_state`'s scalar sub-select would raise "more than one row returned by a subquery". One `IF … RAISE WARNING` turns two printed numbers into a check. |
| **R-6** | Low | **The orphan check warns rather than raises** (`preflight-…:111`) — the right call, because it needs a decision and not a stop. But with `ON_ERROR_STOP=1` a `WARNING` scrolls past in a wall of `NOTICE`s. §4.20 step 3 should say what success *looks like*: "you are looking for two notices, `1. clean:` and `2. no orphans:`; anything else, stop and read it." |
| **R-7** | **Medium** | **The rollback script has no confirmation.** It drops three production tables the moment it is invoked. This module requires a `confirm` literal **and** an echoed account id before resetting **one** account's plan state (§4.12) — so the asymmetry is the module's own standard applied everywhere except the one script that destroys everything. `\if :{?confirm_drop} \else \echo 'REFUSING — re-run with -v confirm_drop=yes' \quit \endif` at the top. |
| **R-8** | Low | **The rollback drops without saying what cannot be rebuilt.** The header tells you to export first; the script could count it, before the drops: admin-set rows (`origin IN ('admin','admin_reset','launch') OR updated_by_admin_id IS NOT NULL`) and override rows, as a `WARNING`. Mid-incident, a number gets read and a comment does not. |
| **R-9** | Trivial | `rollback-…:57` says "none of THESE EIGHT OBJECTS"; it is **nine** (3 tables + 4 functions + 2 triggers), as the array immediately below it enumerates and as every other document says. |

**Is the rollback correct, ordered and honest?** Yes to all three. Triggers → functions → tables is right (the triggers are the only objects on tables the product uses, and they come off first); it is bounded by `lock_timeout`; it proves its own completion against an enumerated list rather than a `business_os_%` pattern (SA C-3, correctly applied); and it states plainly that admin-set cohorts, expiries and overrides cannot be rebuilt. R-7 and R-8 are about the moment before it runs, not about what it does.

**What can only fail AFTER the migration is applied** — the honest list, after the pre-flight removes everything it can:

| Still discovered late | Why it cannot be checked earlier | Damage if it happens |
|---|---|---|
| The three Supabase roles (**R-4**) | Only because nobody asked — this one is removable today | Apply fails whole; nothing partially applied |
| `service_role` reaching the RPCs **through PostgREST** | Needs the service-role key and an HTTP call, not `psql` as `postgres`; `check-…`'s A10 proves the grant, not the round trip | Component 3 discovers it, weeks later. Mitigated: A10 + the schema-cache note |
| The PostgREST schema-cache reload (`NOTIFY pgrst, 'reload schema'`) | Same | Same |
| The **write** cost of the backfill | The pre-flight times the read; the insert is on top | Bounded by `statement_timeout = '10min'` (P-2), and a timeout rolls back cleanly |
| The never-raise guarantee (B4) with the lock probe off | The only way to make the plan table reject every write is a table-level constraint | Stays a code-reading claim. Correctly documented in §4.20 |

**Is §4.20 executable by someone who is not us?** Largely yes — seven ordered steps, each with a command, an expected output and a failure branch, and an undo path at the end. Three gaps: **R-1** (it never says the scripts need `psql`), **R-6** (step 3 has no "what success looks like"), and step 4 — "take a Supabase backup, or confirm today's automatic one" — gives no way to *confirm* one, which on a first production apply is the step whose failure is unrecoverable. §4.20 also never states **which role** to connect as; every script assumes enough privilege to read `auth.users` and `pg_stat_activity`, which `postgres` has and a restricted role does not.

#### 14.9.3 Part B — §14.6 reconciled

Done, and §14.6 is now **a pointer, not a second runbook**: its body has been replaced with the mapping table and a note that every stale item (the `20260921…` filenames, the seeded tenants, the "expect B8 to fail" caveat) is gone with it. §4.20 is the single production runbook. Dev's mapping in §4.20 was correct in every row; the only piece with nowhere to live was step 3d, specified below.

#### 14.9.4 The two pieces of §14.6 that must survive

**(1) `C4` — the fact heal, specified.** Dev is right that it belongs in the probe suite: it writes. Drop this in after `C0`, before the `C1/C2/C3` block. It needs no new probe account — `tenant3` already has a transcript **and** a profile, and C0 leaves it with a backfilled plan row:

```sql
-- C4 — the heal step of 20261005b (QA Q-19). C0 proves the backfill's INSERT;
-- this proves the UPDATE that fills a fact the INSERT skipped, and proves it is
-- inert on a second pass — which it is only because of the two EXISTS guards.
-- ⚠️ Keep the UPDATE below in step with the one in 20261005b.
DO $$
DECLARE
  v_user uuid := (SELECT user_id FROM _bos_probe WHERE kind = 'tenant3');
  before_updated timestamptz;
  after_updated  timestamptz;
  p public.business_os_account_plans;
BEGIN
  -- Make tenant3 look like a gap row: a trigger-created trial carrying only the
  -- profile fact, which the backfill's INSERT then skipped on conflict.
  UPDATE public.business_os_account_plans
     SET onboarding_started_at = NULL, cohort = 'trial', origin = 'profile_trigger',
         updated_at = now() - interval '1 hour'
   WHERE user_id = v_user;

  SELECT updated_at INTO before_updated FROM public.business_os_account_plans WHERE user_id = v_user;

  -- The heal statement, narrowed to this account.
  UPDATE public.business_os_account_plans AS p
     SET onboarding_started_at = COALESCE(p.onboarding_started_at,
           (SELECT min(oc.created_at) FROM public.onboarding_conversations oc WHERE oc.user_id = p.user_id)),
         profile_created_at = COALESCE(p.profile_created_at,
           (SELECT bp.created_at FROM public.business_profiles bp WHERE bp.user_id = p.user_id)),
         updated_at = now()
   WHERE p.user_id = v_user
     AND ((p.onboarding_started_at IS NULL
           AND EXISTS (SELECT 1 FROM public.onboarding_conversations oc WHERE oc.user_id = p.user_id))
       OR (p.profile_created_at IS NULL
           AND EXISTS (SELECT 1 FROM public.business_profiles bp WHERE bp.user_id = p.user_id)));

  SELECT * INTO p FROM public.business_os_account_plans WHERE user_id = v_user;

  -- It healed the fact, from history and not from now().
  IF p.onboarding_started_at IS DISTINCT FROM timestamptz '2024-05-06 07:08:09+00' THEN
    RAISE EXCEPTION 'C4 the heal did not recover the fact from history (got %)', p.onboarding_started_at;
  END IF;
  -- …and healed NOTHING ELSE. A heal that promoted a gap row to champion would
  -- be doing the launch operation's job, months early.
  IF p.cohort <> 'trial' OR p.origin <> 'profile_trigger' THEN
    RAISE EXCEPTION 'C4 the heal changed the cohort or the provenance (% / %)', p.cohort, p.origin;
  END IF;
  IF p.tier IS NOT NULL OR p.trial_started_at IS NOT NULL OR p.trial_ends_at IS NOT NULL THEN
    RAISE EXCEPTION 'C4 the heal touched a tier or a pin';
  END IF;

  -- Inert on a second pass: the WHERE now matches nothing, so updated_at holds.
  after_updated := p.updated_at;
  IF after_updated <= before_updated THEN
    RAISE EXCEPTION 'C4 the heal did not run at all (updated_at did not move)';
  END IF;

  UPDATE public.business_os_account_plans AS p
     SET onboarding_started_at = COALESCE(p.onboarding_started_at,
           (SELECT min(oc.created_at) FROM public.onboarding_conversations oc WHERE oc.user_id = p.user_id)),
         updated_at = now()
   WHERE p.user_id = v_user
     AND p.onboarding_started_at IS NULL
     AND EXISTS (SELECT 1 FROM public.onboarding_conversations oc WHERE oc.user_id = p.user_id);

  SELECT updated_at INTO after_updated FROM public.business_os_account_plans WHERE user_id = v_user;
  IF after_updated <> p.updated_at THEN
    RAISE EXCEPTION 'C4 the second pass rewrote the row: the migration is not inert on a re-run';
  END IF;
END $$;
```

Note for whoever lands it: `updated_at` is backdated by an hour first, for the same reason B1 backdates its fact — `now()` is the transaction timestamp, so "did it move?" compares a value with itself otherwise.

**(2) The re-run fingerprint.** §4.20 does not repeat §14.6's step 4, and it should, because the backfill file now carries the heal `UPDATE` as well as the insert: run `20261005b` a **second** time and confirm `INSERT 0 0`, `UPDATE 0`, and an unchanged fingerprint over `(user_id, cohort, origin, cohort_expires_at, updated_at)`. That is the only end-to-end proof of re-run inertness, and it is a property rather than an accident. *(Optional, and cheap: after the apply, insert one onboarding message for a fresh auth user and confirm the row comes out `trial` / `onboarding_trigger` — the §14.6 step 5 manual check.)*

#### 14.9.5 Part C — component 2 findings

| # | Sev | Finding |
|---|---|---|
| **C2-1** | **Medium (judgement)** | **`payments.reminders` is `available`, and by the catalog's own stated test it is not.** `lib/services/PaymentReminderService.ts:500-527` — `sendEmailReminder` logs `'Would send payment reminder email'` and ends `return true; // Simulated success`. `catalog.ts:162` acknowledges it ("still a stub, tracked separately"), but `lifecycle` is the field that gates, and `available` means it can be sold. This is the **same evidence class** that moved `marketing.mass_email` to `not_built` hours earlier, and it is worse in one respect: the stub **reports success**, so the reminder is recorded as sent while no client receives anything. Recommend `not_built` for consistency, or an explicit TL/user decision written into the entry. Not urgent — `TIER_ORDER` is empty, so nothing is sold — but it is the one entry the new rule does not cover, and the rule is a day old. |
| **C2-2** | **Medium (judgement)** | **`website.custom_domain` is `available` on storage evidence only.** Its note cites `WebsitePageRepository` and the chat catalog. But `middleware.ts:56-69` rewrites to `/site/[subdomain]` **only** when `host.endsWith(baseHost)`, so a real custom domain never matches; and `WebsitePageRepository.findByCustomDomain` (`lib/repositories/WebsitePageRepository.ts:330`) **has no caller anywhere in the repository**. Column, verified flag, repository method, no path to the outcome — `marketing.mass_email`'s exact shape, and the exact evidence class ("tables and routes") SA rejected. |
| **C2-3** | Low | **The complete set of `available` entries that code cannot demonstrate**, for the C-2 gate: `payments.reminders` and `website.custom_domain` (above), plus `support.level` (its own note: "no enforcement surface — it is a commercial promise"), `team.seats` and `business.locations` (both real at a value of 1; SA and I agree the reasoning holds). I spot-checked the remaining `available` entries against their notes and found no further gaps — `intake.reminders` in particular is real (`IntakeReminderService.sendDue` → `BookingEmailService.sendIntakeFormRequest`). |
| **C2-4** | Low | `lib/business-os/entitlements/__tests__/catalog.invariant.test.ts:142` is titled "marks the **five** rows that are still with Eyal" and asserts **seven** ids. B-1 is "five ambiguous sheet rows" everywhere else in this workplan. Either the mass-email/marketing-chat split legitimately made it seven — in which case say so where B-1 is defined — or the list has drifted. |
| **C2-5** | Low | `…/__tests__/tierLiteral.forbidden.test.ts:77` builds `PATTERN` with the `g` flag and uses it with `.test()` at `:121`. A global regex is **stateful** across `.test()` calls, so once one offender matches, the next file's scan resumes at a stale `lastIndex` and can miss a second. Harmless today (the assertion fails on the first offender anyway) — but this is a guard, and the fix is one character. |
| **C2-6** | Low | `…/__tests__/productionConfig.test.ts:132-143`, "lets one override flip that decision without touching code", asserts that the config **validates** and then that `withOverride.sendPolicyOverrides['intake.request'].paused === 'allow'` — the object literal three lines above. What is not asserted is that the override changes the *resolved* answer, because the resolver is component 3. Same shape as SA's **C-1**; recommend folding it into **S1-T6a** so AC-37 is proven end to end and not at the config boundary. |
| **C2-7** | Low | `…/__tests__/oneLineChange.test.ts:39` computes a **one-directional** diff (leaves in `after` absent from `before`), so a change that also *deleted* five leaves would still report one entry. The companion test catches that (a deleted capability fails validation), so the pair is sound — but the assertion that carries the "it really is one leaf" claim does not, on its own. A symmetric difference is one line. |
| **C2-8** | Low | The 111 generated AC-2 cases (`tierMatrix.invariant.test.ts:45-52`) assert only `toThrow(/tier matrix/)`. Since each starts from a valid fixture and makes exactly one deletion the error can hardly be anything else, but matching the deleted capability id would make each case prove it failed *for its own reason*. |
| **C2-9** | Note | "Reproduces the committed snapshot byte for byte" is true **today and only today**: `scripts/write-entitlements-snapshot.ts:25` stamps `generated: new Date()…`, so running it on any later day produces a one-line diff with no config change. `findDrift` ignores `generated`, so this is cosmetic — one line in the script header stops the next person reading it as drift. |

**What I checked and found genuinely sound** (the vacuity hunt): the 37-capability list is **hand-written, not derived**, with a "is 37" guard on top of it; `chatActionMap.invariant` reads the **live** `SEMANTIC_CATALOG`, cross-checks all **107** plugin actions both ways, and carries a negative control proving `capabilityForOp` can return `undefined`; `tierMatrix.snapshot` proves the removals rule in **both** directions (a cut is caught, and the same cut is accepted once recorded and version-bumped) and defends the empty-matrix trap with "snapshots something worth snapshotting"; `tierLiteral.forbidden` ratchets its baseline **by equality in both directions**, so a cleaned-up file must lower the baseline in the same change; `findDrift`'s ranking, removal and history rules are sound and I could not construct a downgrade that slips past them; the loader validates on first `load()` and never at import; and `productionConfig` proves the config survives **having no tiers at all**, which is the state production will be in.

#### 14.9.6 Needs a decision

1. **C2-1 — `payments.reminders`.** The mass-email correction set a rule yesterday ("available means a customer gets the outcome today"); this entry fails it on stronger evidence (the sender returns simulated success). Business call: mark it `not_built`, or record why it is an exception. Nothing is sold today either way.
2. **C2-2 — `website.custom_domain`.** Same question, same evidence class.
3. **R-1 — how will the operator actually run these?** If the answer is the Supabase SQL editor rather than `psql`, then the pre-flight and the checker need their two backslash lines removed *by us*, in the file, and the probe suite must not be run at all. This is the one Part A finding that changes what the user does.
4. **R-4 / R-7** — a five-minute addition each (role check in the pre-flight, confirmation flag on the rollback), both before the production apply.
5. The database phase stays as §14.8.4 recorded it, minus what `check-…` now covers: **nothing has been run against any database**, and the trial-restart guarantee (B2) is still unproven.

#### 14.9.7 Final Status

- [x] **Component 2 passes. The verification rework passes. Both are ready for the user's code review and for RM to commit.**
- [x] **Nine findings, none blocking a commit.** R-1, R-4, R-7 before the production apply; C2-1 and C2-2 are decisions for TL/the user; the rest are test- and doc-quality items that can land with component 3.
- [x] **§14.6 is retired in favour of §4.20**, with `C4` and the re-run fingerprint specified in §14.9.4 as the two pieces that had nowhere else to live.
- [x] **Still true: no script has been run against any database.**

### 14.10 QA — SQL-editor scripts, the `not_built` rule, component 3 (2026-09-22)

**Test mode:** full, across three scopes.
**Strategy used:** **A + B + E** — Jest suites run independently (A) including a **mutation test I performed myself** (B), and adversarial review of SQL and of a runbook that cannot be executed here (E). No database; production out of bounds for QA.
**Reviewed against:** workplan `6a642241`; components 1 and 2 committed at `2bbbb2ec` / `e5f5d163`; §4.20, §4.23, §4.24, §4.25, §13.6.

**Verdict: ✅ PASS — ready for the user's code review and for RM to commit.**
- **Component 3:** no defects. Every number reproduces, the cache holds *raw inputs* so a trial can expire inside the TTL (proven, not asserted), the three-step order and `entitlement_unavailable` are exactly as specified, and both vacuity patterns SA flagged turn out to be sound.
- **The `not_built` rule:** correct and load-bearing. Dev's mutation claim **reproduces exactly — 9 failures, confined to one suite**. One latent gap (**B-1**).
- **The SQL-editor rework:** the two read-only scripts are safe by *structure* (one `SET`, one `SELECT`), the probe-suite prohibition is unmissable and structurally enforced, and no check passes vacuously on real data. **Two Medium findings, both in the rollback script** — the one destructive file.
- **Can the user run §4.20.3 unaided? Yes, with three additions** (§14.10.5). This is the first runbook in this cycle I would hand to a non-engineer.

#### 14.10.1 What QA ran

| Command | Result |
|---|---|
| `npm run test:bos-entitlements` (the CI command) | ✅ **43 suites, 801 tests, 0 failures** — exactly as reported |
| `npm run test:authz-guard` | ✅ **74 passed**, no new exemption |
| Hooks ESLint over `lib/business-os/entitlements` | ✅ exit 0 |
| `console.*` / `: any` in the new source | ✅ **0** / **0** |
| Typecheck, the verified method | ✅ **2,030 diagnostics — identical to the baseline — 0 × TS2688, 0 in any entitlements file**; control: 3 errors in other `lib/repositories/*.ts`, so the tree is genuinely covered |
| **Mutation test of the `not_built` rule, run by QA** | ✅ **exactly 9 failures, in 1 suite; 12 other suites still green.** Method: back up `schema.ts`, disable **both** `addNotBuiltGrantIssues` call sites (tier matrix + cohorts), run `jest lib/business-os/entitlements`, restore, `diff` to confirm the file is byte-identical. A first attempt that disabled `isGrantingValue` itself produced **11** — the extra two are the function's own unit assertions, which is the right difference and confirms the 9 are the *rule's* rejections rather than the helper's |
| Scope check | ✅ **Exactly the files named:** 7 modified (`exampleTierMatrix`, `fixtureSource`, `oneLineChange.test`, `catalog`, `cohorts`, `schema`, `imports.guard.test`) + the 4 SQL scripts + the 8 new component-3 sources, 5 new test suites and 1 new fixture. `package.json`, the workflow, `jest.config.js` and `typecheck-bos-llm.ts` are untouched this round |

#### 14.10.2 Part A — the SQL-editor scripts

**Can any of them write?** The two read-only scripts: **no, by structure** — one `SET` and one `SELECT` each, no DML anywhere, which holds however the editor submits the paste. That is the right guarantee to lead with, and §4.23.1 leads with it instead of over-claiming for `SET default_transaction_read_only`, which is what R-2 asked for. Row 8 / row 70 *measuring* the setting rather than asserting it is the correct resolution of a question neither review could settle.

**Is the probe-suite prohibition unmissable?** Yes, and it is enforced by more than prose. The banner is the first three lines; §4.20.1's table marks it 🚫; §4.20.2 gives the decision and its cost; **the lock probe is deleted, not re-gated** (QA confirmed: no `ALTER TABLE`/`CHECK (false)` statement survives, and `tenant4` is gone); and the file still contains a `\set` on line 103, so pasting it into the editor **fails at parse time and executes nothing**. The runbook's eight steps contain no probe step at all — the old "Optional — the probe suite" is gone. The one place that still called it "optional" was **my own §14.6 mapping**, which I have corrected in this pass (**P-6**).

**Vacuity hunt against a PRODUCTION database.** No row passes vacuously. Two subtleties Dev got right and that are worth recording, because they are the kind of thing that is wrong by default:

- `aclexplode(proacl)` returns **no rows** when `proacl IS NULL`, and for a *function* a NULL ACL means the default `EXECUTE TO PUBLIC`. Row 24 therefore adds `AND (SELECT count(*) FROM fns WHERE proacl IS NULL) = 0` — without it, "no client role can execute any of the four" would PASS on exactly the databases where every client role *can*.
- For a *table*, a NULL `relacl` means owner-only, so A4's silence is correct there. Getting these two opposite defaults right in one file is the difference between a privilege check and a decoration.
- Row 21 and rows 22/23 each carry their own `count(*) = 4` / `= 2` so they cannot pass with zero functions; B3 (row 52) is an explicit non-vacuity gate; row 61 is `PASS`/`INFO` and never `FAIL`, so it cannot fail the apply on day one.

**Findings**

| # | Sev | Finding |
|---|---|---|
| **P-1** | **Medium** | **The rollback's hand-armed guard protects only if the editor submits paste 2 as ONE implicit transaction** — which the file asserts ("Everything below is a single implicit transaction") but which cannot be verified from here. Under PostgreSQL's simple-query protocol a multi-statement string is one implicit transaction, so the claim is probably right; but if the editor ever splits statements client-side, the `RAISE EXCEPTION` in the `DO` block aborts **only that statement** and the nine `DROP`s run anyway. The safety of the one destructive script should not rest on an unverified property of a UI. **Fix, and it is strictly better: put the drops inside the same `DO` block as the guard** (`EXECUTE 'DROP TABLE …'`), so arming and dropping are inseparable regardless of how the paste is submitted. File: `scripts/rollback-bos-entitlements-migration.sql:95-118` (guard) and `:120-136` (the drops). |
| **P-2** | **Medium** | **The rollback cannot roll back a half-applied migration — the exact case its own header calls the realistic one.** The guard block runs `SELECT count(*) INTO v_admin_rows FROM public.business_os_account_plans` (`:109`) unconditionally. If the first migration half-landed and that table does not exist, the statement raises `42P01` and the whole batch aborts, so **nothing is dropped and no grid appears** — while paste 1's header says "If it fails with `relation … does not exist` … you can go straight to PASTE 2" (`:27-28`). Paste 2 then fails the same way. **Fix:** wrap the two counts in `IF to_regclass('public.business_os_account_plans') IS NOT NULL THEN … END IF;`. |
| **P-3** | Low | `scripts/check-bos-entitlements-migration.sql:265` — row 25's **status** uses `count(DISTINCT proname) = 2` (correct: the same grant from two grantors is two ACL rows and one permission) but its **`what_to_do`** uses `count(*) = 2`. On a database where either EXECUTE was granted twice, the row reads `PASS` while carrying "The shadow writer and the admin reset would both fail." In a grid the operator is told to paste into the PR, a PASS row with a failure message is worse than either alone. |
| **P-4** | Low | `scripts/preflight-bos-entitlements-migration.sql:214` — row 6 (`quiet`) WARNs on **any** transaction in the database older than 5 s, including ones that never touch `onboarding_conversations` or `business_profiles`. On a live Supabase project (replication, dashboard sessions, background jobs) this can WARN habitually, and a row that always warns stops being read. It is an indicator, not a verdict — worth saying so in `what_to_do`, or narrowing to transactions holding a lock on the two parent tables (`pg_locks` join). |
| **P-6** | Low (QA's own) | §14.6's mapping row still described the probe suite as "optional". Corrected in this pass to **PROHIBITED**, pointing at §4.20.2. Recorded because the coordinator's question — "could anything lead someone to run it anyway?" — found its one true answer in my own section. |

**Deviation matrix** (the coordinator's list, answered):

| Deviation | Outcome |
|---|---|
| Paste a fragment of a read-only script | Cannot write: there is no DML in the file to reach |
| Run one statement only | Same |
| Editor wraps the paste in its own transaction | Read-only scripts: irrelevant (no writes). Rollback: this is **P-1** |
| Pooled connection | `SET default_transaction_read_only` may not persist to the next query. Consequence is only that step 4 *won't* hit 25006 — the benign direction. No write path opens |
| Paste 2 of the rollback without paste 1 | Handled: paste 2 opens with its own `RESET` and is self-contained, and the guard still refuses. ✅ |
| Paste the probe suite into the editor | Fails at parse on line 103's `\set`, executes nothing ✅ |
| Delete the backslash line to make it run | Now harmless: the lock probe no longer exists. The remaining writes still need `auth.users` inserts, and the header's first three lines forbid the whole file on production |

#### 14.10.3 Part B — the `not_built` rule

**Completeness by shape.** `isGrantingValue` delegates to `rankValue`, and every shape ranks correctly: boolean/group (`true` grants), variant (any index > 0), add-on (`purchasable` **and** `included` grant — the right call, and the reasoning is in the file), metered, quantity, fair-use (any non-zero), and an unrankable value grants (fails closed). The `{ perMonth: 0, total: 500 }` evasion I went looking for is closed upstream: `valueSchemaFor`'s metered union is `.strict()`, so a value carrying both keys is rejected before the rule sees it.

| # | Sev | Finding |
|---|---|---|
| **B-1** | Low (latent) | **`isGrantingValue` ignores `purchasable: true` on the *quantity* shape.** `valueSchemaFor` allows `{ included: 0, purchasable: true }`, which ranks 0 and passes the rule — while `'purchasable'` on the *add-on* shape is treated as granting for the stated reason that "an offer to sell something that does not exist is the failure this rule is about". The same sentence applies here. **No exposure today** (`team.seats` and `business.locations` are the only quantity capabilities and both are `available`), so this is a latent inconsistency, not a hole in the shipped config. File: `lib/business-os/entitlements/schema.ts:54-57` with `snapshot.ts:66-67`. |
| **B-2** | Note | Through the **schema path** the rule is exercised for boolean, add-on and metered. Variant, quantity and fair-use grants are covered only by `isGrantingValue`'s unit assertions, because no `not_built` capability has those shapes today. Reasonable — and closable with the pattern `productionConfig.test.ts` already uses for the metered case (a synthetic catalog entry), which is also how `resolver.test.ts` tests `beta`. |

**Does the clamped fixture still prove what the fixture exists for?** Yes. Its job is the tier *mechanism*, and every mechanism test uses `available` capabilities: AC-2's 111 deletion cases still cover all 37 × 3 (the suite passes), AC-4 moves `chat.search`, and the drift tests use `insights.checks` / `website.branding` / `ai.actions` / `chat.bulk`. What the clamp costs is fidelity to Eyal's commercial draft — and that is preserved in per-line comments plus a header summary, with `withholds every not_built capability in every tier` pinning the clamp so it cannot silently drift back. Finding it was a *fixture bug* is the useful part, exactly as §4.23.2 says.

#### 14.10.4 Part C — component 3

**Both vacuity patterns SA flagged are sound.**

- The lifecycle sweep's non-vacuity line is `expect([...states].sort()).toEqual(['active','champion','grace','paused','trial'])` — an **equality**, so it fails if the sweep stops producing a state *and* if it starts producing an unexpected one. It already earned its keep once (the missing `grace` clock). `lifecycle.test.ts`.
- The guard's "it does read" line asserts `EntitlementService.ts` matches `/findEntitlementInputs\b/`, which is what stops "never writes" passing because the file never touches the repository at all. Adequate.

**Verified against the contract:**

| Claim | QA verdict |
|---|---|
| Three-step order, and step 0 never says `not_entitled` | ✅ `decide.ts:167-233`. `failurePolicyFor` can only return `entitlement_unavailable` or `allowed`; an unknown capability is `entitlement_unavailable` with reason `unknown_capability`, kept distinct from `not_entitled` (T-3) |
| The balance seam is a genuine no-op that needs no call-site change | ✅ `ALWAYS_SUFFICIENT` returns `{ sufficient: true }`; step c only fires for `shape.kind === 'metered'` **and** a supplied balance; `EntitlementService.check` runs a provisional `decide` first and **returns early if it is not allowed**, so the source is consulted only after (a) and (b) pass — and a throwing source is caught and treated as sufficient. Slice 3 swaps one object |
| T-5 caching: raw inputs, 30 s, LRU, batch read-through, a trial expiring inside the window | ✅ The cache stores `inputs` and calls `this.resolve(config, cached.inputs)` on **every** hit, so the derived state is recomputed against the current clock — the property is structural, not just tested. The test asserts `calls === 1` **and** `state` flipping `trial → grace` with `outcome: read_only` inside the TTL. LRU asserted by `cacheSize === CACHE_MAX_ENTRIES`; batch chunking asserted as `[100, 100, 50]` and cache-neutral |
| T-3 failure policy by audience | ✅ public and transactional sends fail open, marketing defers, owner/mixed get `entitlement_unavailable`; stale inputs are refused for owner/mixed and served to client surfaces |
| `{ all: true }` derivation and `not_built` unreachable | ✅ Refused at four points: reachability (`resolver.ts:139`), layer 3 quantities, overrides (`:302`, recorded as `ignoredOverrides … reason: 'not_built'`), and `lowestTierFor` returning `null` (`:400`) so no upgrade prompt is ever shown for a feature that does not exist |
| A-1: expired tier + ended cohort resolves from the TIER row | ✅ `lifecycle.ts:220-228`, with the reasoning written down (falling back to the cohort would hand a lapsed subscriber *more* than they paid for). See **C-2** for one unstated consequence |
| RC-7: reading the mode never runs config validation | ✅ `mode.ts` imports only the logger and two data modules; it does not import `source.ts` or `schema.ts`, which is the property SA restated, and the new test has a non-vacuity leg |
| History semantics | ✅ `historyAt` + the "shortening the trial does not shorten a running one" case |

| # | Sev | Finding |
|---|---|---|
| **C-1** | Low | **The widened import guard has one hazard it names but does not enforce.** `every read-only referrer is itself on the allowed list` catches `READ_ONLY_REFERRERS \ ALLOWED`; the real hazard is the reverse — a new **non-route** file added to `ALLOWED` without being added to `READ_ONLY_REFERRERS`, which inherits no write condition. The comment says so explicitly and leaves it to a human. Cheap tightening: assert every `ALLOWED` entry falls into exactly one of three buckets — `lib/repositories/**`, `READ_ONLY_REFERRERS`, or `app/api/admin/**` — so adding a file forces a deliberate classification. File: `lib/repositories/__tests__/businessOsEntitlements.imports.guard.test.ts:137-143`. |
| **C-2** | Low (question) | When a tier has expired **and** the cohort has ended, the basis is the tier (correct, and SA-endorsed) but the **grace length** is taken from the *cohort's* `graceHistory`, not the subscription grace (`lifecycle.ts:214-216`). So a lapsed Basic subscriber who is also a lapsed champion gets the champion's 30-day grace rather than the subscription grace. It is generous in the customer's favour and probably intended — but it is a third rule that §4.8's A-1 table does not state, and the one place someone would look. One sentence in the comment or the table settles it. |

#### 14.10.5 Can the user run §4.20.3 unaided?

**Yes — with three additions.** I read it as the operator would. What makes it work: the orientation box ("only steps 4 and 5 change anything"), the `25006` trap called out *before* it can happen with its one-line fix, a per-step "what success looks like", row 0 as a single verdict, step 4's failure table with the most likely failure first, and an undo path that starts with a read-only paste. That is a genuinely usable document.

| # | Gap | Suggested line |
|---|---|---|
| **1** | **Steps 4 and 5 say "paste the whole of `supabase/migrations/…`" but never say how to get it.** The operator is in a browser; the file is in a git repo. Copying from GitHub's *rendered* view can bring line numbers with it. | "Open the file on GitHub, click **Raw**, select all, copy." |
| **2** | **Step 3 leaves an unrecoverable decision to judgement.** "Confirm a backup dated today… otherwise accept that the undo path is the rollback script" — a non-engineer cannot easily tell what their plan offers, and may not realise they are accepting anything. | "If the Backups page shows no backup from today and offers no button to start one: **stop and ask**, or write in the PR: 'no backup; undo path is the rollback script'. Do not skip this silently." |
| **3** | **Step 4 has no catch-all failure branch.** Three named errors are covered; anything else leaves a non-engineer to guess, and the instinct is to re-run. | "Any other error: **stop**, paste the message into the PR, do not run step 5. Nothing was applied — the file is one transaction." |
| 4 | Minor: step 6's "most are re-apply `20261005b`" does not re-mention that re-applying on the checker's tab hits the same `25006`. One cross-reference. |
| 5 | Minor: step 8 ("a week later") has no mechanism to remember it. Worth a tracked task rather than a line in a PR. |

#### 14.10.6 Needs the user

1. **P-1 and P-2 — the rollback script.** Neither blocks a commit (nothing runs it unless something has gone wrong), but P-2 breaks the exact recovery path the runbook advertises, and P-1 is the one place where safety rests on unverified UI behaviour. Both are small edits.
2. **The three runbook additions (§14.10.5).** These are the difference between "can follow it" and "can follow it alone at 9pm".
3. **B-1 / C-1 / C-2** can land with component 4 or 5; none affects shipped behaviour.
4. **Unchanged and still true:** nothing has been run against any database. The apply itself remains the first execution of any of this, which is why the pre-flight and the read-only checker matter more than usual.

#### 14.10.7 Final Status

- [x] **Component 3, the `not_built` rule and the SQL-editor rework all pass — ready for the user's code review and for RM to commit.** 43 suites / 801 tests, authz guard 74, lint clean, 0 `console.*`/`any`, typecheck at the unchanged 2,030 baseline with 0 in this module, and the rule's mutation claim independently reproduced at exactly 9.
- [x] **Six findings. Two Medium (P-1, P-2), both in the rollback script**; four Low. None blocks a commit.
- [x] **The runbook is executable by a non-engineer**, subject to the three additions in §14.10.5.
- [x] **The probe suite's prohibition is stated unmissably and enforced structurally**, and the one remaining "optional" reference — in QA's own §14.6 — is corrected.

### 14.11 QA — component 4: shadow mode and the report (2026-09-22)

**Test mode:** full. **Strategy:** **A + B + E** — suites run independently, the request path traced through the route, and adversarial review of a report nobody can run against real data yet.
**Reviewed against:** workplan `5d7771cc` + §13.7 (R4-1..R4-5); components 1–3 committed at `2bbbb2ec`, `e5f5d163`, `d0995daa`.
**Timing note (important for reading this):** Dev applied SA's fixes while I reviewed. I re-read every file after it settled and **this report describes the tree as of 18:27**, with `report.ts` at 18:26:29, `shadow.ts` at 18:24:27 and the runbook at 18:26:55. **R4-1, R4-2, R4-3, R4-4 and R4-5 are all in.** Nothing looked mid-edit at that point; the workplan itself was still being written, which is why my findings cite code and not §4.28.

**Verdict: ✅ PASS — component 4 is ready for the user's code review and for RM to commit.**
- **The request path is airtight**, and I confirmed SA's two residuals are the only ones.
- **R4-1's fix is real and its new tests are the discriminating kind** — the bug is stated as a test that would fail without the filter.
- **Five findings. Two Medium, both in the setup-AI measurement** — the number that will size the trial allowance is sampled and read in ways that do not match what it claims.
- **Runbook: yes. He can run it alone.**

#### 14.11.1 What QA ran

| Command | Result |
|---|---|
| `npm run test:bos-entitlements` | ✅ **46 suites, 853 tests, 0 failures** (SA saw 848 before the fixes) |
| `jest app/api/business-os/chat-v4` + `test:authz-guard` | ✅ **2 suites, 79 tests** — the route's audit suite still passes with the hook in it; guard 74, no new exemption |
| Hooks ESLint over `lib/business-os/entitlements` + `app/api/business-os/chat-v4` | ✅ exit 0 |
| `console.*` / `: any` in `shadow.ts`, `report.ts`, `planCapabilities.ts` | ✅ **0** / **0** |
| Typecheck, the verified method | ✅ **2,030 — the unchanged baseline — 0 × TS2688, 0 in any entitlements file, 0 in chat-v4**; control 3 elsewhere |
| Scope | ✅ Only the named files: the three new sources + three new suites, the one-line hook, `findTenantsMissingPlanRow` on the plan repository, the guard rename, and the runbook |

#### 14.11.2 Part A — the request path

**With the flag off, verified independently rather than re-read:** `shadow.ts`'s only module-scope imports are the logger and `mode.ts`; `getEntitlementMode() === 'off'` is statement one. The suite's negative control is the right one — *"does nothing even when every collaborator is broken"* loads a harness where the config, the snapshot **and** the recorder all throw, and asserts zero calls and zero errors. A source-level test separately pins the top-level import list, so the property is held from both directions.

**Can it delay a turn, reject unhandled, or double-record?**

| Question | Answer |
|---|---|
| Delay the response | No. `shadowChatPlan` returns `void`, so it cannot be awaited by accident, and the hook is one statement. |
| Unhandled rejection | No. The `catch` is the last thing in the IIFE and contains only `logger.error`. |
| Double-record **within** a request | No, and I checked the three ways it could: `POST` → `runAiAction` → `handleChatTurn` is a **single** invocation, not a retry wrapper (`route.ts:340-357`); the confirm branch returns its own response at ~`:718`, well before the hook at `:998`; and the clarification and no-plan early returns are above it. So a plan-then-confirm pair records **once**, at plan time, which is what §4.10 intends. |
| StrictMode | Not applicable — this is an API route, not a component. |

**SA's two residuals are the only ones** (work cut short when a serverless function freezes after responding → a lost observation; first-shadow-turn module evaluation on the request stack → milliseconds, once per process, flag on). Neither can surface to a customer: the first costs a row in an observability table, the second is bounded and only reachable when the flag is on, which it is not in production. **One thing to add to the list, as a report property rather than a request-path defect — D-1 below.**

**R4-2 landed in the code** (`shadow.ts:68,83,109,159` — `resolveAccountId` imported lazily and used for both the snapshot and the recorded `user_id`). **The guard assertion SA asked for in the same fix did not:** there is no reference to `resolveAccountId` or the seam anywhere in `businessOsEntitlements.imports.guard.test.ts` or `shadow.test.ts`. Since `AccountId` is a `string` alias, nothing but that assertion will notice the next consumer passing a raw `userId` — which is the whole reason R4-2 exists. **Finding A-2.**

#### 14.11.3 Part B — the report's honesty

**R4-1 is fixed, and the tests are the discriminating kind.** `report.ts:458` — `if (event.rule !== 'both' && event.rule !== reading) continue;`. The new suite (`report.test.ts:284-368`) uses genuinely dual-recorded events, and the case that matters is the third one: a `proposals` look-up recorded as `chat.quotes` under one reading and `chat.search` under the other, on a tier that has **neither** — so without the filter `wouldLose` would have two entries and one account would be double-counted. The default-reading test is chosen so that asserting `reading` alone would not catch a replay that ignored it, and a fifth case proves `both` events survive either reading. This is the standard the earlier rounds were reaching for. **R4-3** (`accountsAffectedCount` vs `keptCapabilitySurfaceCount`, units spelled out at `:149-157`) and **R4-4** (`plannedItemsTotal`/`plannedItemsMax`, "an upper bound, not rows processed") are also in.

**RC-16 holds** with a real non-vacuity leg (the serialised report *does* contain the account it read). **`for_each` does not double-count** within a capability. **`asTier` cannot silently return a flattering empty answer** for the two obvious reasons — `no_tiers_configured` and `unknown_tier` are explicit error codes — but it can for a third, **B-3**.

| # | Sev | Finding |
|---|---|---|
| **B-1** | **Medium** | **The setup-AI sample is not the sample it says it is.** `report.ts:530-538` reads `pagePlans({ limit: 500 })` — which orders by **`user_id`**, a uuid — and then takes `.slice(-200)`. The comment says *"The sample is the most recent accounts, because they used the current product."* It is neither recent nor random: it is the tail of the **first uuid page**, and on a database with more than 500 plan rows most accounts can never be sampled at all. The number this feeds is the one that sizes the trial allowance. Either order by `created_at` for a genuine recency sample, or drop the recency claim and say it is an arbitrary 200. |
| **B-2** | **Medium** | **The same measurement can silently under-count.** `report.ts:546-551` passes `{ featurePrefix: 'business-os-', features: [] }` with `ceiling: 1000`, so it reads **every** Business OS call — chat included, which is by far the highest volume — ordered `created_at DESC`, and filters to the three setup areas in JavaScript. A chat-heavy account can fill the ceiling with chat and lose the setup calls, which sit at the **start** of the window: the account then reports **0** setup groups and is counted in `withNoSetupAi`. Worse, `listCallsInWindow` returns `reachedCeiling` and its own doc says *"the result may be incomplete and a caller must not report it as proven"* — `report.ts:553` checks only `calls.error`. Both effects bias the number **down**, and an under-sized trial allowance ends a customer's trial on their first day, which is the failure B-12 exists to prevent. Fix: pass `features: [...SETUP_AREAS]` so the filter happens in SQL, and surface `reachedCeiling` in `SetupAiSection`. |
| **B-3** | Low | **`asTier` inherits truncation without saying so.** `readEvents` caps at 20,000 rows and reports `truncated` on `ObservedSection` — but `replayAsTier` is handed `events.rows` and `AsTierSection` has no such flag (`report.ts:227-241`). `findWindow` orders by `day` descending, so a truncated window is silently biased toward recent days. The replay is the number a price list is built from; it should carry the same warning its sibling does. |
| **B-4** | Low | **`noEndDateWithoutProfile` counts rows, not accounts.** `report.ts:322` filters the `noEndDate` **list**, and `:67` documents that "an account can have both" kinds of open-ended access — so an account with an open-ended cohort *and* an open-ended tier is two rows and counts twice. The field's own doc (`:95-96`) reads as accounts ("the ones that never created a business profile"), and this is the trim list someone will act on. The same units mismatch R4-3 has just been fixed for, one field away. |
| **B-5** | Low | **`findTenantsMissingPlanRow` has no repository test.** It is faked in all three report tests (`report.test.ts:69,156,175`) and appears **zero** times in `BusinessOsAccountPlanRepository.test.ts`. Its real logic is not trivial — de-duplication, the `maxAccounts + 1` truncation probe, and 100-id chunking — and CLAUDE.md asks for a unit test per repository method. |
| **D-1** | Note | **The report counts requests, not intents.** One POST records at most once (verified above), but a client retry or a double-fired request is two POSTs and is counted twice; there is no idempotency key, and `sample_correlation_id` is not used for de-duplication. Correct for "what did the product have to serve", worth one line wherever the report is read. |
| **A-1** | Low | **A read fanned out inside `for_each` is recorded under the configured reading only, and tagged `both`** (`planCapabilities.ts:111-117`). Everything else obeys "a `find` emits one observation per reading"; this path resolves the inner capability with the default rule and then labels it as agreeing under both. Niche today — `for_each` actions are writes in practice — but it is the one place the tag is not true, and R4-1's filter keeps such an event under *either* reading. |
| **A-2** | Low | The R4-2 guard assertion is missing (§14.11.2). |

**SA's "capabilities never exercised" caveat is still not in the output.** SA asked for one line in the report's own header when the route ships; the only scope statement today is the `scope` string on `tenantsWithoutPlanRow`. Absence of a capability means "not used **through chat**, which is the only hooked surface", and a reader pricing a plan will not supply that qualifier themselves. Carry it as a component-5 obligation.

#### 14.11.4 Part C — the numbers behind the two lists

| Claim | Verdict |
|---|---|
| Setup AI counts **distinct action groups**, not calls | ✅ `session_id` set, with `ungrouped:${id}` as its own group — conservative, and the test proves it with two calls in one group. |
| …in the **first 14 days** | ✅ `days` comes from `cohorts.trial.durationHistory[0].days`, and the window is clamped at `now`. |
| …with **chat excluded** | ✅ in the result, and proven by a fixture that includes a chat call with its own group id. ⚠️ But only *after* the read — see **B-2**, which is where chat does the damage. |
| `hasBusinessProfile` distinguishes onboarding-only champions | ✅ genuinely — `profile_created_at` is a recorded fact, set by the profile trigger, the backfill and the heal step, so `null` means no profile. **It depends on the heal having run:** `check-…` row B4 ("no plan row is missing a fact its own history could supply") is what makes this number trustworthy, and it should be green before anyone trims the list. |

#### 14.11.5 Part D — the apply runbook

**Yes. He can run it alone against production.** All three of my previous additions are in (Raw-copy instruction at `:27`, the stop-or-record backup rule at `:55-61`, the catch-all failure row at `:74`), and step 6's FAIL row even picks up the "not on this tab, it is read-only now" cross-reference I asked for.

**R4-5 landed and is the right table.** Step 5 now covers the read-only trap, the ten-minute self-stop ("nothing is half-done… just run it again"), the foreign-key error tied back to step 2 row 3, and a catch-all that correctly distinguishes itself from step 4: *"Unlike step 4, the tables from step 4 **are** there now — that is fine, they do nothing until this step succeeds."* That is exactly the sentence a non-engineer needs at the one step where "nothing was applied" stops being true.

One note for RM: my P-1/P-2 fixes to the rollback script from the last round are confirmed in place — the drops now live **inside** the guard's own `DO` block (`rollback-…:145-165`), so arming and dropping are one statement, and the pre-drop counts are wrapped in `to_regclass` guards (`:132,136`) so a half-applied migration can still be rolled back.

#### 14.11.6 Needs the user

1. **B-1 and B-2 — the setup-AI number.** It is the only output of this component that becomes a business decision (the size of the trial allowance), and today it is sampled from an arbitrary slice and read through a ceiling that chat can fill. Both fixes are small. Nothing depends on the number until Slice 3, so this is not urgent — but it should not be read as measured until they land.
2. **B-3 / B-4 / B-5 / A-1 / A-2** can land with component 5, where the report gets its route and the admin surface gets its tests.
3. **Nothing here changes what a customer sees**, and I verified the `off` path rather than accepting it.
4. **Still true: no script has been run against any database.**

#### 14.11.7 Final Status

- [x] **Component 4 passes — ready for the user's code review and for RM to commit.** 46 suites / 853 tests, chat-v4 suite green with the hook in place, authz guard 74, lint clean, 0 `console.*`/`any`, typecheck at the unchanged 2,030 baseline with 0 in this module **and** 0 in chat-v4.
- [x] **R4-1 to R4-5 all verified applied**, with R4-1's new tests exercising genuinely dual-recorded events. **R4-2's guard assertion is the one piece missing (A-2).**
- [x] **Seven findings: two Medium (B-1, B-2, both in the setup-AI measurement), five Low.** None blocks a commit.
- [x] **The apply runbook is ready to hand over** (Dev committed the step-5 table as `25773906` during this review).

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
| 2026-09-22 | Production-safe verification + component 2 built (Dev) | **Verification** (user decision: no branch database; the migration will be run against production): split into a read-only post-apply checker that runs under `SET TRANSACTION READ ONLY` and is unconditionally safe, the probe suite hardened with a refuse-outside-a-transaction guard and an opt-in lock probe (`-v probe_locks=on`), and a rollback script. §4.20 adds the ordered production runbook, what cannot be proven safely on production (the never-raise proof, backfill timing, the PostgREST round trip) and an undo path; QA asked to re-verify §14.6 against it. **Component 2**: the 37-capability catalog with lifecycle evidence, an EMPTY production tier matrix, trial/champion cohorts granting everything with explicit quantities and dated histories, the lifecycle overlay + seeded send registry, the chat map with a configurable read rule, catalog-derived Zod schemas, the lazy `TierMatrixSource` seam, the drift-snapshot comparison, Eyal's matrix as a fixture, 7 suites / 325 tests (incl. 111 generated AC-2 cases and AC-4 measured as a one-leaf diff), the `SCOPED_DIRS` extension and the `Business OS entitlements invariants` CI job running the migration and repository suites too (F-1). 37 suites / 676 tests green; scoped typecheck passed with 0 new errors. Code uncommitted. |
| 2026-09-22 | SA code review of the production-safe verification + component 2: APPROVED for QA (SA) | Added §13.5. Ran `test:bos-entitlements` (37 suites / 676 tests, green — F-1 closed), `lint:hooks` (clean) and a scoped `tsc` over `lib/business-os/entitlements/**` with resolved jest types (0 diagnostics; the local `typecheck:bos-llm` failure is a worktree artefact — no `node_modules`, so every in-scope test file loses `@types/jest`, including pre-existing ones). Read-only script: safety is genuinely enforced by `SET TRANSACTION READ ONLY` (a transaction property, so `SECURITY DEFINER` cannot defeat it) and it calls none of the module functions. Probe guard, opt-in lock probe and rollback order all correct. Production-apply risk: low overall, moderate only at the backfill (unknown scan duration; FK dependency on `auth.users`), both removable read-only beforehand — hence required P-1 pre-flight section, P-2 explicit `statement_timeout`, P-3 direct-connection and quiet-window steps. Component 2: T-1/RC-1, FR-12, lazy loader, removal-needs-a-version-bump and the negative controls all verified non-vacuous. Second opinion: `marketing.mass_email` = `available` is the weakest entry (no dispatcher found — same class as the known `payments.reminders` stub); the `not_built` set, multi-currency, seats/locations and deferring `capabilitiesForPlan` are all endorsed. Low-priority C-1 (finish AC-4 in component 3), C-2 (record the dispatcher gap; gate `available` before the first tier is configured), C-3 (rollback leftover check should enumerate names, not match `business_os_%`). |
| 2026-09-22 | SA review fixes: runbook pre-flight + mass-email correction (Dev) | P-1 added `scripts/preflight-bos-entitlements-migration.sql` (read-only) and runbook steps 1-3: the nine objects must not already exist (raises, because a silent skip over drift is the dangerous case), no tenant may be missing its `auth.users` row, and the backfill's own scan is timed in advance. P-2 bounded the backfill with `statement_timeout = '10min'`. P-3 promoted the direct-connection and quiet-window constraints to numbered steps with their reasons. C-3 made the rollback script enumerate its nine objects instead of matching `business_os_%`. C-1 recorded as binding component 3 task S1-T6a. **C-2 / mass email:** SA's challenge was right — tracing it answered half of B-1. `chat.marketing` SENDS (contacts.send -> emailSend.ts -> sendEmail via Resend/SMTP, fanned out by ForEachExecutor) and stays `available`; `marketing.mass_email` is the builder with **no dispatcher** (nothing reads `next_send_at`, no cron, `triggerSequence` has no caller) and is now **`not_built`**. Both carry the evidence, a test pins the pair, and the catalog header sets the gate: before the first tier is configured, every `available` capability needs a demonstrated end-to-end path. §4.20 now also maps this runbook against QA's §14.6 step by step. 37 suites / 677 tests green; 0 typecheck diagnostics in the module. Code uncommitted. |
| 2026-09-22 | QA of the production-safe verification + component 2: PASS (QA) | Added §14.9; retired §14.6 in favour of §4.20 so there is one runbook. Ran it all: **37 suites / 677 tests**, authz guard 74, hooks lint clean, 0 `console.*`, 0 `any` in source, and the typecheck reproduced to the digit (2,030 project diagnostics, 0 TS2688, **0** in any entitlements file, control 3 + 6 elsewhere). Snapshot writer verified byte-identical by backup/diff/restore. **F-1 confirmed genuinely closed** — `test:bos-entitlements` lists both required paths, and `supabase/**` is a deploying change so a migration-only PR still runs the job. **Part A:** the two read-only scripts are safe by enforcement (`SET TRANSACTION READ ONLY`), the pre-flight's clean check really raises, the checker has no vacuous checks on real data, and the rollback is correctly ordered and honest. Nine findings, none blocking: **R-1** every script is psql-only and the plausible workaround (deleting the `\` lines) silently re-enables the opt-in lock probe on production; **R-4** the pre-flight never checks that `anon`/`authenticated`/`service_role` exist; **R-7** the rollback drops three production tables with no confirmation, in a module that demands a confirm literal to reset one account; plus R-2/R-3/R-5/R-6/R-8/R-9. **Part C:** no defects in component 2; **C2-1** `payments.reminders` is `available` while its sender returns `true; // Simulated success`, which fails the rule the mass-email correction set a day earlier, and **C2-2** `website.custom_domain` is `available` although `findByCustomDomain` has no caller and middleware only rewrites `*.baseHost` — both for the C-2 gate; C2-4..C2-9 are test/doc quality. §14.9.4 specifies the `C4` fact-heal probe and the re-run fingerprint, the two pieces of §14.6 with nowhere else to live. |
| 2026-09-22 | SQL-editor rework, the not_built rule, and component 3 (Dev) | **Decision 1 — the operator uses the Supabase SQL editor.** `preflight-` and `check-` rewritten as one `SET default_transaction_read_only = on` plus **one `SELECT`** each, reporting every check as a result row with a `PASS`/`FAIL`/`WARN`/`INFO` column and an `OVERALL` row 0 — because the editor displays no `NOTICE`/`WARNING` output and only the last result grid. Adds QA's R-4 (the three Supabase roles exist), R-5 (backfill rows vs tenants), R-6 (what success looks like); privileges now read from `relacl`/`proacl` so a missing role reports instead of aborting. `rollback-` split into a read-only "what is lost" paste (R-8) and a drop that **refuses until armed by hand** (`v_confirm := 'DROP-ENTITLEMENTS'`, R-7), ending in a grid; "eight objects" → **nine** (R-9). **The probe suite is quarantined, not ported**: it inserts into `auth.users`, and the editor cannot guarantee the transaction discipline that makes that reversible — the ACCESS EXCLUSIVE lock probe is **deleted** rather than re-gated (R-1 showed the opt-in defeated itself). §4.20 rewritten end to end as an eight-step editor runbook, with §4.20.2 listing what is lost and what covers it (S-8(i) is now structurally asserted, the one real gap) and §4.20.4 stating plainly that **no script has been executed**. **Decision 2:** `payments.reminders` and `website.custom_domain` → `not_built`, with the trace per entry. **Decision 3 — "if a feature does not exist it cannot be allocated" is now enforced at load**: a tier row or cohort value that grants a `not_built` capability (boolean `true`, a variant above the lowest, `purchasable`/`included`, a non-zero quantity, allowance or ceiling) is rejected by Zod, naming the capability, the tier and the withheld value. Proven by `notBuiltCannotBeAllocated.test.ts` with negative controls, and **mutation-checked** — disabling the rule fails exactly 9 tests. Eyal's fixture was granting eight of them; that was a fixture bug and is fixed, with every draft value kept in a comment. **Decision 4:** every invented number in `cohorts.ts` marked `PLACEHOLDER` with its reason, distinguished from the user's 14/7/30-day histories and from the two values that are deliberate zeros/ones. **Component 3 — the resolver**: `account.ts`, `mode.ts` (imports the logger only; UD-2 downgrades `enforce` to `shadow` and logs at error), `lifecycle.ts` (state + basis together, RC-11/A-1, S-7 histories), `resolver.ts` (five layers with a per-capability trace, `lowestTierFor`, `satisfies`), `balance.ts` (the seam + `ALWAYS_SUFFICIENT`), `decide.ts` (the A-2 three-step contract and the T-3 failure policy), `EntitlementService.ts` (`check`/`getSnapshot`/`getSnapshots`/`invalidate`, inputs cached for 30 s in a 5,000-entry LRU, batch read-through, stale never served to an owner-paid answer), `index.ts`. Four judgement calls recorded for SA in §4.24 (expired-tier-plus-ended-cohort resolves from the **tier**; `beta` is not reachable through a tier; an add-on cannot buy a `not_built` capability; an unknown capability is `unavailable`, not `not_entitled`). SA's C-1/S1-T6a closed: the one-line change is now asserted on a resolved account, not just on the config. The RC-15 import guard was widened for the service, **conditionally** — a new test forbids it calling any write method. **43 suites / 797 tests green** (was 37 / 677); typecheck **2,030 diagnostics, identical to the baseline, 0 in any entitlements file**; hooks lint clean; 0 `console.*`, 0 `any`. Full Jest: 22 pre-existing failures in `agentkit`/`orchestration`/`llm`, none importing anything this component touches. Code uncommitted. |
| 2026-09-22 | SA code review of the SQL-editor rework, the not_built rule and component 3: APPROVED for QA (SA) | Added §13.6. Ran `test:bos-entitlements` (43 suites / 797 tests, green) and `lint:hooks` (clean); hunted vacuous assertions and found none. Editor safety: the one-SET-one-SELECT shape carries more of it than the `SET` does (a fragment paste can now only run a SELECT), but `default_transaction_read_only` may not cover statements in the same submission, so R-2 makes the state an observable INFO row instead of a header claim; R-1 adds `25006` and its one-line fix to runbook steps 4/5 (the lingering setting would otherwise stop the apply with an unexplained error); R-3 adds the two free pieces of trigger evidence (log warnings + row 61). Prohibiting the probe suite and deleting the lock probe: endorsed. §4.20.2 judged honest about S-8(i) now being structurally asserted. not_built rule: complete across every shape, fail-closed on unrankable values, `purchasable` correctly counted as granting; the fixture clamp was a real fixture bug; `payments.reminders` and `website.custom_domain` → not_built accepted with evidence. Component 3: three-step contract, `{ all: true }`, histories, input-caching with the TTL-boundary proof, audience-based failure policy and the balance no-op all verified. All four §4.24 judgement calls endorsed — most consequentially that an expired tier with an ended cohort resolves from the TIER row, so lapsing can never grant more than paying did; that is now the record. RC-15 widening approved (conditional, non-vacuous). Low: C3-1 `require` → static imports of the two data-only config modules (restating the guard as "must not import source/schema"), C3-2 apply the rule to component 5 overrides, C3-3 loop the write-method check over every allowed file. |
| 2026-09-22 | SA review fixes R-1 to R-3, C3-1 to C3-3 (Dev) | §4.25. **R-1:** the runbook now says up front that **only steps 4 and 5 change anything**, and `25006` ("cannot execute CREATE TABLE in a read-only transaction" — the pre-flight's own setting still live on that tab) is the first row of step 4's failure table with the one-line `RESET`, instead of appearing as a surprise right after the pre-flight said PASS. **R-2:** both read-only scripts stop *claiming* Postgres will reject a future write — a claim that only holds if the editor does not wrap the paste in its own transaction, which cannot be established from here — and instead **report** `transaction_read_only` and `default_transaction_read_only` as an output row, so the operator's grid answers it the first time. The stated guarantee is now the one that always holds: the file is one `SET` and one `SELECT` with no DML. **R-3:** the two free pieces of trigger evidence are now steps — a new step 6b searches the Postgres log for `business_os_plan_fact_` warnings (the fact triggers swallow failures by design, so the log is the only place a broken one is visible), and step 8 pairs that search with row 61 as "what replaces the probe suite". **C3-1:** `mode.ts` drops `require()` for static imports of the two data modules, and the rule is restated as the property it actually protects — *`mode.ts` must not import `source.ts` or `schema.ts`* — with a test asserting it, including a non-vacuity leg. **C3-2:** recorded as binding on component 5's S1-T12a (`add_override` must refuse a `not_built` grant, or an admin reads "granted" while the customer still has nothing). **C3-3:** the write-method check loops over a named `READ_ONLY_REFERRERS` list so the next file added to `ALLOWED` inherits the condition, with admin routes explicitly excluded from that list. **43 suites / 801 tests green**; typecheck 2,030 diagnostics (unchanged baseline, 0 in the module); hooks lint clean. No resolver, decision, lifecycle, service, catalog, cohort, schema or fixture logic was touched. Code uncommitted. |
| 2026-09-22 | QA of the SQL-editor scripts, the not_built rule and component 3: PASS (QA) | Added §14.10; corrected §14.6's last "optional" reference to the probe suite (it is prohibited). Ran it all: **43 suites / 801 tests**, authz guard 74, hooks lint clean, 0 `console.*`/`any`, typecheck at the unchanged **2,030** baseline with **0** in any entitlements file (control 3 elsewhere), and the scope confirmed as exactly the seven modified files + four scripts + the new component-3 files. **Independently reproduced Dev's mutation test:** disabling both rule call sites fails **exactly 9** tests in **one** suite (disabling `isGrantingValue` itself gives 11 — the extra two are the helper's own unit assertions). **Part A:** the two read-only scripts are safe by structure (one `SET`, one `SELECT`); the probe-suite prohibition is unmissable and structurally enforced (the lock probe is deleted, and line 103's `\set` makes an editor paste fail at parse); no check passes vacuously on real data — and the two opposite ACL defaults (function NULL `proacl` = EXECUTE to PUBLIC, table NULL `relacl` = owner-only) are both handled correctly. **P-1 (Med):** the rollback's hand-armed guard protects only if the editor submits paste 2 as one implicit transaction — put the drops inside the guard's own `DO` block. **P-2 (Med):** the rollback cannot roll back a *half-applied* migration, the case its own header calls realistic, because the guard counts rows in a table that may not exist. P-3/P-4/P-6 low. **Part B:** the rule is complete across every shape and the `{perMonth:0,total:500}` evasion is closed by `.strict()`; **B-1 (low, latent)** `isGrantingValue` ignores `purchasable: true` on the *quantity* shape while treating `'purchasable'` on an add-on as granting. The clamped fixture still proves the mechanism, with the draft values preserved in comments. **Part C:** no defects. Both vacuity patterns SA flagged are sound (the sweep asserts the five states by equality; the guard's "it does read" line is real). The cache holds raw inputs and re-resolves on every hit, so a trial expiring inside the TTL is structural, not just tested; the balance source is consulted only after steps a and b pass. **C-1** the import guard does not enforce its own stated hazard (a non-route file added to ALLOWED without the read-only condition); **C-2** an expired tier with an ended cohort takes the *cohort's* grace length while the basis is the tier — worth one sentence. **Runbook verdict: a non-engineer can execute §4.20.3 unaided, with three additions** — how to copy the migration file, a stop-or-record rule when there is no backup, and a catch-all failure branch for step 4. |
| 2026-09-22 | QA fixes P-1 to P-4, B-1, C-1, C-2 + the three runbook gaps (Dev) | §4.26. **P-1:** the nine `DROP`s moved **inside the guard's own `DO` block**, so arming and dropping are one statement and the safety no longer rests on an unverified property of the editor's transaction handling. **P-2:** the rollback now works on a **half-applied** migration — the two "what is lost" counts are wrapped in `to_regclass` checks (PL/pgSQL resolves a statement only when it runs), where previously a missing plan table raised `42P01` and aborted the batch, leaving the exact recovery path the header advertises unusable. **P-3:** `check-…` row 25's `what_to_do` uses the same `DISTINCT` count as its status, so a doubly-granted EXECUTE can no longer produce a PASS row carrying a failure message in the grid that goes into the PR. **P-4:** pre-flight row 6 is scoped to sessions holding a lock on the two parent tables (a `pg_locks` join) instead of any transaction anywhere, with the database-wide numbers kept as context — a row that warns on every healthy project is a row nobody reads. **B-1 fixed now, not deferred:** `isGrantingValue` treats `{ included: 0, purchasable: true }` as granting, because an offer to sell seats that do not exist is the same failure `purchasable` on the add-on shape already covers; mutation-checked at exactly 2 failures, and the new block closes B-2 for the quantity shape via a synthetic catalog entry. **C-1:** the import guard asserts every `ALLOWED` entry falls into exactly one of four categories, so a new non-route file cannot inherit no write condition by omission. **C-2:** stated rather than changed — §4.8's A-1 table and `lifecycle.ts` now name all three decisions in that branch (basis = the tier, access end = the later date, grace length = the **cohort's**) and why the third is deliberate, with a test pinning the champion's 30 days against the shorter subscription grace. **Runbook:** how to obtain the migration text (GitHub → **Raw** → select all, and why not the rendered view), step 3's backup decision as a three-state table ending in "stop and ask, or record *no backup taken* in the PR", a **catch-all failure branch** on step 4 ("stop, do not run step 5, nothing was applied"), the `25006` cross-reference on step 6, and step 8 promoted to tracked task **S1-T19** because a line in a PR is not a reminder. **43 suites / 807 tests green**; authz guard 74; typecheck 2,030 (unchanged baseline, 0 in the module); hooks lint clean. Source changed this round: `schema.ts` only (two lines + an import). Code uncommitted. |
| 2026-09-22 | Component 4 built: shadow mode + the report (Dev) | §4.27. **`shadow.ts`** — the hook, with the logger and `mode.ts` as its only module-scope imports and everything else behind `await import()` inside an un-awaited `try` (RC-7/WC-21). Three mechanisms keep it off the request path, and each is tested by breaking a collaborator: a throwing config loader, a throwing snapshot, a throwing recorder, an unrecognisable plan — the caller is untouched every time, and the `off` path is asserted **with every collaborator broken**, which is what proves the flag check really is first. **`planCapabilities.ts`** maps a chat plan to capabilities: a `for_each` asks for `chat.bulk` **and** the fanned-out action (with the item count), `analyse` is `owner_ai` rather than `owner_read` because grace treats them differently, an unmapped entity is an `error`-level FR-8 defect rather than a silent skip, and **every read is recorded under both readings of the chat read rule** so Q-B1 can be settled from data (`rule IN ('<reading>', 'both')`). `allowed` outcomes are recorded too (RC-6) — with no tiers and everyone a champion they are nearly all of it, and a denials-only recorder would have produced an empty report. **`report.ts`** — static (states, cohorts, anomalies, tenants with no plan row), observed (capability × surface × outcome × rule, distinct accounts), **`asTier` replay** and the setup-AI measurement. The replay answers "what would tier X cost this account" from **recorded usage**: per capability, how many accounts used it and how often, sorted by accounts then volume, counting only observations that were `allowed`; the discriminating test replays the same usage against Basic/Growth/Pro and gets three different answers. **A-1 + S1-T11a:** one no-end-date list covering open-ended cohorts *and* open-ended tier assignments, each row flagging whether the account ever created a business profile — the onboarding-only champions are the set to trim before enforcement, and now counting them is a decision rather than a discovery. **S1-T15:** distinct Layer-1 action groups in the three setup areas within each account's first 14 days (median/p90/max), read through `TokenUsageRepository`, with chat excluded so the number the trial allowance is sized against is not inflated. One new repository read (`findTenantsMissingPlanRow`), whose limitation — it scans accounts with a business profile, not the full tenant set — is stated in the report's own output, not just in a comment. The RC-15 guard's `READ_ONLY_REFERRERS` is renamed **`NO_STATE_WRITE_REFERRERS`**, because `shadow.ts` writes observations and a list called "read only" would have been a lie; the invariant it enforces is unchanged. The **shadow-report route moves to component 5** (S1-T12b), where `requireAdmin` and the audit trail live. Also added **`docs/BUSINESS_OS_ENTITLEMENTS_APPLY_RUNBOOK.md`**, the self-contained production hand-off for the PR, written for the operator rather than for us. **47 suites / 853 tests green** (was 43 / 807); typecheck 2,030 — identical to the baseline, 0 in any entitlements file and 0 in `chat-v4/route.ts`; hooks lint clean; 0 `console.*`, 0 `any`. Code uncommitted. |
| 2026-09-22 | SA code review of component 4 + the apply runbook: APPROVED for QA with required fixes (SA) | Added §13.7. Ran `test:bos-entitlements` (46 suites / 848 tests, green) and `lint:hooks` (clean). Request path verified airtight: with the flag off the mode check returns before any import (only the logger and `mode.ts` are module-scope), and with it on every await sits inside the IIFE try — the two honest residuals (lost observations if the function freezes; first-turn module evaluation on the request stack) are noted. Hook placement at L985 endorsed. All five mapping calls endorsed (`analyse` → `owner_ai`, `for_each` recording both capabilities, both readings per `find`, unmapped = FR-8 defect, `getSnapshot` + `decide` over `check()`), as are the guard rename and deferring the report route to component 5. `findTenantsMissingPlanRow` accepted as non-exhaustive for this slice — the output states its own scope — on condition it becomes exhaustive before the Slice 2 flip. Three required fixes, all about the report being right before anyone prices from it: R4-1 the `asTier` replay does not filter by read rule, so every `find` is replayed under two capabilities and `accountsAffected` counts a world that cannot exist (the tests use `rule: `both`` only and cannot see it); R4-2 `shadow.ts` bypasses `resolveAccountId`, the first consumer of the T-2 seam; R4-3 `wouldKeep` counts capability keys while `accountsAffected` counts accounts. Low: R4-4 `items` is the planned cap not rows processed; R4-5 give runbook step 5 step 4's failure table. The runbook was reviewed as the artefact the user will follow and judged complete and safe standing alone. |
| 2026-09-22 | SA review fixes R4-1 to R4-3 + two low-priority items (Dev) | §4.28. **R4-1 (the one that mattered):** the `asTier` replay now assumes **one** reading of the chat read rule — events tagged with the other reading are skipped, the reading defaults to the configured one and is selectable via `asTierReadRule`, and the output states which was used. Before this, a look-up recorded twice by design appeared as **two** losses and `accountsAffected` counted accounts that would lose under *either* reading, a world that cannot exist. The missing test now exists: five cases over the recorder's real dual output, including the discriminating one (a `proposals` look-up is `chat.quotes` under one reading and `chat.search` under the other, and Basic has neither, so the un-filtered replay turned one question by one account into two losses). **Mutation-checked: removing the filter fails 3 of the 5.** **R4-2:** `shadow.ts` goes through `resolveAccountId` once and uses the result for both the snapshot and the recorded row. **R4-3:** `accountsAffectedCount` (accounts) and `keptCapabilitySurfaceCount` (capability/surface pairs) — different units, now named as such. **Low:** the fan-out count is `plannedItems` / `plannedItemsTotal` / `plannedItemsMax` throughout, because `for_each.max` is the planner's cap rather than rows processed, and a ceiling set against the wrong one would be set too high; and runbook step 5 gained the same failure table as step 4 in both the workplan and the operator's copy (`25006`, `57014`, `23503`, catch-all — the catch-all spelling out that the step-4 schema IS applied and is inert until the backfill runs). **SA's condition recorded:** `findTenantsMissingPlanRow` must become an exhaustive SQL anti-join **before enforcement is switched on** — blocking row in §5 plus a warning in the method's docstring, because under enforcement a missing plan row resolves to the `no_plan_row` anomaly and denies owner-paid capabilities. **47 suites / 858 tests green**; typecheck 2,030 — unchanged baseline, 0 in the module and 0 in `chat-v4/route.ts`; hooks lint clean; 0 `console.*`. Code uncommitted. |
| 2026-09-22 | QA of component 4 (shadow mode + report): PASS (QA) | Added §14.11. Ran it all: **46 suites / 853 tests**, the chat-v4 audit suite green with the hook in place, authz guard 74, hooks lint clean, 0 `console.*`/`any`, typecheck at the unchanged **2,030** baseline with **0** in any entitlements file and **0** in chat-v4. Verified **R4-1 to R4-5 all applied** (re-read after Dev's parallel edits settled): the `asTier` replay now filters by reading, and its new tests use genuinely dual-recorded events including the case where both capabilities are absent from the tier — the bug stated as a test. **Request path confirmed airtight**: the `off` path does nothing even with every collaborator throwing, one POST records at most once (`runAiAction` is a single invocation, the confirm branch returns before the hook), and SA's two residuals are the only ones. Seven findings, none blocking: **B-1 (Med)** the setup-AI sample claims to be "the most recent accounts" but is the tail of the first page ordered by *uuid*; **B-2 (Med)** the same measurement reads all Business OS calls through a 1,000-row ceiling ordered newest-first and filters chat out in JS, so a chat-heavy account can lose its setup calls and report zero — and `reachedCeiling` is ignored despite the repository's own doc forbidding it; both bias the trial allowance **downwards**. **B-3** `asTier` inherits the 20,000-row truncation without a flag; **B-4** `noEndDateWithoutProfile` counts rows, not accounts; **B-5** `findTenantsMissingPlanRow` has no repository test; **A-1** a read fanned out inside `for_each` is tagged `both` but resolved under one reading; **A-2** R4-2's code landed but its guard assertion did not. **Runbook: yes — he can run it alone.** R4-5's step-5 table is the right one, and the rollback's P-1/P-2 fixes are confirmed in place. The runbook's step-5 edit was committed by Dev as `25773906` while this review was being written. |
| 2026-09-22 | QA fixes B-1 to B-5, A-1, A-2, D-1 (Dev) | §4.29. All of §14.11, including the three QA offered to defer. **B-1 + B-2 — the setup-AI measurement, which is the one output of this component that becomes a business decision.** The sample was `pagePlans({limit:500})` ordered by **uuid** then `.slice(-200)` — neither recent nor random, and above 500 plan rows most accounts could never be sampled; it now uses a new repository read ordered by `onboarding_started_at` descending, and the output states the basis and the date span. The ledger read fetched **every** Business OS call newest-first under a 1,000-row ceiling and filtered the three setup areas in JS, so a chat-heavy account's setup calls fell off the end and it reported **0**; the filter is now pushed down to the query, and `reachedCeiling` is surfaced as `accountsAtReadCeiling` with the note saying in words that the percentiles are then **lower bounds**. Both defects biased the trial allowance **downwards** — the one direction B-12 exists to prevent. **B-3:** the replay carries the `windowTruncated` flag its sibling already had. **B-4:** the no-end-date counts are distinct **accounts** (`noEndDateAccountCount`, `noEndDateAccountsWithoutProfile`), not rows — one account can appear twice, and this is the list someone acts on. **B-5:** six repository tests for `findTenantsMissingPlanRow` (chunking asserted from the real `in()` calls, de-duplication, the truncation probe, the error path, and the no-profiles case asserting no plan query is sent). **A-1:** `both` now means "the two readings agree", derived by comparing them rather than inferred from `op === 'find'` — a look-up fanned out inside a `for_each` was resolved under one reading and tagged `both`, which is R4-1's double-count one level down. **A-2:** R4-2's missing assertion — the seam is mocked to return a different id and both the snapshot call and every recorded row must carry it, plus a new `accountSeam.guard.test.ts` requiring every module file that handles a `userId` to call `resolveAccountId` or be on an EXEMPT list with a reason. **D-1 + SA's caveat:** a `limitations` block **in the report's own output** — chat is the only hooked surface, absence means "not used through chat", and counts are requests rather than intents. **48 suites / 880 tests green** (was 47 / 858); authz guard 74; typecheck 2,030 — unchanged baseline, 0 in the module; hooks lint clean; 0 `console.*`. Code uncommitted. |
