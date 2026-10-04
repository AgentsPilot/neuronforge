# Workplan: Admin Delete, slice AD-1: read-only deletion preview from `/admin/users`

> **Last Updated**: 2026-10-04

**Developer:** Dev
**Requirement:** [ADMIN_DELETE_USER_BUSINESS_REQUIREMENT.md](/docs/requirements/ADMIN_DELETE_USER_BUSINESS_REQUIREMENT.md) §5 (AD-1), §6.1, §6.3, §8 (AC-A1…AC-A5), SA Review Notes (SC-1…SC-12)
**Date:** 2026-10-04
**Status:** AD-1a Code Complete (2026-10-04), uncommitted, waiting for SA code review. AD-1b and AD-1c not started.
**Branch (AD-1a):** `feature/admin-delete-ad1a-reconciler`, cut from `origin/main` `1a9944a5` in worktree `neuronforge-admin-delete`. Original proposal for the whole slice: `feature/admin-delete-ad1-preview`. ⚠️ **It does not exist yet.** The working tree is on `main`, and local `main` is behind `origin/main`, which has 3,000+ lines of `app/admin/users` changes: the credits block, the dialog precedent and the source guard. RM must create the branch from **`origin/main`**. This plan was written against `origin/main` (`1a9944a5`), not the stale local tree.

## Overview

AD-1 adds a **Delete…** button to the expanded row on the Businesses page. The button opens a dialog with a **read-only** preview of what deleting that business would remove and keep, and every reason the deletion would be refused. The slice also builds the purge engine's missing runtime schema check (purge T7 `SchemaReconciler`) and runs the classification pass SA measured. With that in place the preview stops silently under-counting (B-4). Nothing in this slice deletes anything, mints a token, or adds a commit route.

---

## Table of Contents

1. [Analysis Summary](#analysis-summary)
2. [Implementation Approach](#implementation-approach)
3. [Decisions needing SA ruling](#decisions-needing-sa-ruling)
4. [Proposed split](#proposed-split)
5. [Files to Create / Modify](#files-to-create--modify)
6. [Task List](#task-list)
7. [Test Plan](#test-plan)
8. [SC → task traceability](#sc--task-traceability)
9. [AC → test traceability](#ac--test-traceability)
10. [Risks and notes](#risks-and-notes)
11. [SA Review Notes](#sa-review-notes)
12. [QA Testing Report](#qa-testing-report)
13. [Commit Info](#commit-info)
14. [Change History](#change-history)

---

## Analysis Summary

| Area | What exists (read on `origin/main`, 2026-10-04) | What AD-1 needs |
|---|---|---|
| `lib/business-os/purge/PreviewService.ts` | `buildPurgePreview({ userId, level, options, correlationId })` already takes the target as a parameter (SA-3). It counts descriptors and storage, evaluates the no-Stripe gate, and calls the existing **existence probe** `purgeFunctionExists()` (an RPC to `purge_business_data` with a null id and an empty table list). Its `limitations` strings are written for the internal Reset surface ("the Reset button below…") | Reuse it **unchanged**. The admin composition uses its `tables` / `storage` / `totals` / `resetLive` and writes its own limitations |
| `ResetGuard.ts` | `evaluateResetGuard` stops at the first refusal | **Not reused as the evaluator** (SC-4). Its repository reads are reused instead: `resolveConnectAccounts`, `countLocalBlockingState`, and `decideLocalPrecondition` over `LOCAL_BLOCKING_CONDITIONS` |
| `descriptors.ts` + `__tests__/classification-baseline.json` | 135 baseline entries. `insight_actions`, `auth_handoff_codes` and the 7 actor-column tables are in **neither** | SC-8 classification pass, review notes, plus a plain-language `area` per deletable descriptor (D-5) |
| `BusinessPurgeRepository` | Service role. **No method calls `purge_schema_introspect()`** | One new read-only method `introspectSchema()` |
| `purge_schema_introspect()` (migration `20260915a`) | Applied, service-role only, read-only. Returns `columns`, `user_scoped_tables`, `foreign_keys` (`references` = target **relname**, without its schema, so `auth.users` appears as `users`), triggers and policies | Consumed by the reconciler. The union predicate is applied in TypeScript (SC-7) |
| `BusinessOsBillingAccountRepository.findByUser(userId, livemode)` | Never throws. An unknown status is an error. **A caller allow-list is pinned** in `lib/repositories/__tests__/BusinessOsBillingAccountRepository.test.ts`. The repository imports nothing from entitlements | R-3, reading both `livemode` rows. The new caller is added to the allow-list |
| `AuthAccountRepository` | The one door to `auth.users`. Its methods and its callers are both pinned by guards. Only `findUserExists` reads by id, and it returns a boolean | Needs the target's email and `created_at` (FR-A2, and R-2 by email). See D-1 |
| `AdminAccessService.isAdmin({id,email})` | ⚠️ Returns **`false` on any error** (fail-closed **for a gate**, but **fail-open for a refusal**). It **writes** (`bindUserId` self-heal when the email matches an unbound row). In the env-fallback branch it **logs the email** | R-2. See D-3: used literally, it breaks SC-4 ("a failed read is a refusal") and SC-10 (ids only in logs), and it puts a write into a read-only preview |
| `BusinessProfileRepository.findByUserId` | Service role, scoped by `user_id` | Business name for the dialog header. A missing profile is fine (an account with no Business OS business) |
| `app/admin/users/page.tsx` | `'use client'`, 0 `console.*`. The expanded row renders `<BusinessOsPanel>` and then the info grid. The terminate button was removed on purpose (comment at about line 398) | A separated danger area at the bottom of the expanded row, with the button and the dialog |
| `app/admin/users/__tests__/source.guard.test.ts` | `SCREEN_FILES` may import **nothing** from `lib/business-os` (except the pinned band module) and no repository, and have no `console.*` | The new dialog and copy files are added to `SCREEN_FILES`. Preview response types live in `app/admin/users/types.ts`, not imported from `lib/` |
| Admin authz | `lib/admin/__tests__/admin-authz-surface.guard.test.ts` (required check, `npm run test:authz-guard`). A route gated from birth moves no cap. The register is `docs/admin/ADMIN_IDENTIFICATION_AND_ACCESS.md`, last row **95** | Register row **96** and re-measure the census in the same PR (SC-1) |
| `console.*` in files this plan touches | **0 in every one** (page, types, descriptors, PreviewService, BusinessPurgeRepository, AuthAccountRepository, BusinessProfileRepository, BusinessOsBillingAccountRepository, AdminAccessService, localPrecondition, ResetGuard) | Nothing to flag |
| Entitlements | No planned file imports `lib/business-os/entitlements/` | None. The dialog does **not** show the tier (SC-5). `npm run test:bos-entitlements` runs before hand-over anyway |

**Schema facts used** (business-os-schema-check): the only columns read are those selected by existing repositories (billing: `BILLING_ACCOUNT_COLUMNS`; profile: `findByUserId`), plus `auth.users` id / email / created_at through the Auth admin API. `insight_actions`' FKs were read from `20260917_insight_actions.sql`: `user_id → auth.users` CASCADE, `insight_id → insights` SET NULL, and `contact_id` / `invoice_id` / `booking_id` CASCADE, with no inbound FKs. So LEAF is correct by intent. **T3 re-confirms this live** from the reconciler's own `foreign_keys` output. Migration text is not evidence.

---

## Implementation Approach

### Shape

```
POST /api/admin/users/[id]/deletion/preview
  requireAdmin (first statement) → Zod uuid(id) → body {} .strict() → target lookup (404)
  → buildAdminDeletionPreview({ adminId, targetId, correlationId })
       ├─ R-1 (target === admin), R-2 (target is an admin)  → if either applies: return, NO counting (SC-3)
       ├─ buildPurgePreview({ userId: target, level:'purge', options: FIXED, correlationId })   (unchanged service)
       ├─ runSchemaReconciler()                               → R-8
       ├─ billing rows (livemode true + false)                → R-3
       ├─ resolveConnectAccounts                              → R-5
       ├─ countLocalBlockingState + decideLocalPrecondition   → R-6
       └─ evaluateAdminDeletionRefusals(facts)  (pure, returns EVERY refusal; R-4 = not_applicable; R-7 = deferred)
```

- **Composition** lives in `lib/business-os/purge/AdminDeletionPreview.ts`. It is the only new file that does I/O, and it does all of it through repositories or `AdminAccessService`. It imports no Supabase client (B-1) and has no `.from(` (B-2).
- **The evaluator is pure** (`adminDeletionRefusals.ts`): facts in, refusals out. Each fact is tri-state (`value | 'unreadable'`), so a failed read becomes the refusal status `unverified` ("Could not verify… refusing") and never a pass (SC-4). Statuses are **never re-typed**. R-6 uses `LOCAL_BLOCKING_CONDITIONS` through `decideLocalPrecondition`. R-3 uses one exported constant, `R3_LIVE_STATUSES`, typed `readonly BusinessOsSubscriptionStatus[]` against the repository's type. A test proves every member is a member of the repository's status set.
- **R-3 "live"** = status ∈ {active, trialing, past_due, unpaid, paused} **or** (`stripeSubscriptionId` set **and** `endedAt` null), checked on **both** `livemode` rows (SC-5).
- **R-4** always returns `not_applicable` with "No cross-account payment relationship exists", and a code comment cites SA-7 and the "wire R-4 in the same PR" rule.
- **SchemaReconciler** (`SchemaReconciler.ts`) has two parts:
  - `reconcileSchema(snapshot, descriptors)` is pure. A **tenant table** is any base table that has a `user_id` **or** `owner_user_id` column, **or** any FK whose `references === 'users'`. If a `public.users` table exists, the result is `ambiguous`, which is R-8 (SC-7: "assert that").
  - Outputs: `unclassified` (a tenant table with no descriptor), `missingDeletable` (a `reset` / `purge` / `optional:*` descriptor whose table is not live), `missingNever` (listed under limitations, **non-blocking**), and `fingerprint`. The fingerprint is a sha256 over canonical JSON of the sorted tenant-table set, the sorted FK triples `(table, references, on_delete)` and the sorted descriptor `(table, level)` pairs. It is exposed for AD-2's token and **not compared** to anything in AD-1.
  - `runSchemaReconciler()` calls `businessPurgeRepository.introspectSchema()`. A read failure gives `status: 'unreadable'`, which is R-8 `unverified`.
  - It is called **only when the dialog opens** (SA optimisation note), never on page load. Purge T7's **C-2 FK-fingerprint fail-closed comparison** against T3 is **out of scope** (slice 3 / AD-2). The fingerprint is the hook for it.
- **Level and options are constants** in the composition: `purge` and `{ integrations: true, agents: true, activityHistory: false }` (SC-2). The route has no way to pass them.
- **Response** (`data`):
  - `target {userId, email, businessName|null, joinedAt}`
  - `counted: boolean`. False when R-1 or R-2 short-circuited.
  - `areas[] {area, rows, tablesUnknown, tables[]}`, grouped by the new descriptor `area`
  - `storage[]`, `totals`
  - `keptTables[]`: `never` descriptors with `user_id` / `via` scope
  - `refusals[] {id, status: 'applies'|'clear'|'unverified'|'not_applicable'|'not_evaluated'|'deferred', message, clearingAction?}`
  - `schema {status, unclassified, missingDeletable, missingNever, fingerprint}`
  - `limitations[]`, `deletionAvailable: false`, `deletionUnavailableReason`, `correlationId`, `generatedAt`

  Plain-language labels and the fixed "kept and why" categories (money ledger, unsubscribes, preferences, activity history kept per D15, the login closed in AD-3 with its email kept) live in UI copy. The server sends facts.
- **Disabled-confirm reason.** "Deletion not yet available: [reason]". The reason is the first refusal that applies. Otherwise it is the platform reason: "deleting a business ships in a later release (the Purge level and the key rotation are not done)". That reason is reinforced by `resetLive === false` ("the delete function is not installed").
- **Logging.** `createLogger({ module: 'AdminDeletionPreviewAPI' })` and `{ module: 'AdminDeletionPreview' }`, each `.child({ correlationId })`, with ids only (`adminId`, `targetId`, refusal ids, counts). The email and business name go in the response only (SC-10). A test plants both and asserts that no logger argument contains them.
- **No audit row** in AD-1. SA marked the "preview opened" info row as optional. Leaving it out keeps the slice read-only end to end.
- **UI.** `DeleteBusinessDialog.tsx` follows `CreditFormDialog`'s pattern (Radix `Dialog` from `components/ui`, dark admin colours). It fetches `POST …/deletion/preview` with `{}` only when it opens. The blocked state renders in a `role="status" aria-live="polite"` region with text, not colour alone. There is **no confirmation input at all** in AD-1 (FR-A3), and the confirm `Button` is `disabled` with its reason, linked through `aria-describedby`. A technical `<details>` expander lists the tables.

---

## Decisions needing SA ruling

| # | Question | Dev recommendation |
|---|---|---|
| **D-1** | The target's email and `created_at` need an `auth.users` read by id. `AuthAccountRepository` is "the one door" but invite-scoped, and its surface and callers are pinned | Add **one** read method, `findUserIdentity(id) → { id, email, createdAt } | null` (null on 404, error otherwise, no email logged). Update the surface test (4 → 5 methods) and the callers guard (+ `AdminDeletionPreview.ts`). The alternative is a new `AdminAuthUserRepository`, which would be a second door to `auth.users` |
| **D-2** | SC-9 says "no RPC call". `buildPurgePreview` always runs the existing existence probe `purgeFunctionExists()`, which calls `purge_business_data` with `p_user_id: null` and `p_tables: []` (both pinned by the invariant suite) | **Accept** it as the existing non-destructive probe, so SA-3's "no service change" holds, and use its answer in the disabled reason. Add an AD-1 test asserting the admin path never reaches `executePurge`, `removeStorageUnderUser`, `writeVerifiedSnapshot`, `writeSnapshot` or `readAllRows`. If SA reads SC-9 literally, the fallback is an optional `probeResetLive = true` parameter on `buildPurgePreview`, which leaves the existing route's contract unchanged |
| **D-3** | SC-3 names `isAdmin({id,email})`. Used for R-2 it returns `false` on error (R-2 would **pass** on a failed read, against SC-4), self-heals with a **write** to `admin_users`, and logs the email in the env-fallback branch (against SC-10) | Add a read-only, tri-state `AdminAccessService.checkAdminStatus({id,email}): Promise<boolean | null>`. It uses the same cache and the same three sources in the same order, with no `bindUserId`, `null` on error, and ids-only logs. The rule stays one rule in one module. `requireAdmin` and `isAdmin` are unchanged. Unit-tested against `createForTest` |
| **D-4** | R-7 (a run already in progress) can only be known by taking the advisory lock, which a read-only preview must not do | Render R-7 as `deferred`: "Checked at the moment of deletion." It is non-blocking in AD-1, where nothing can be deleted anyway. AD-2 evaluates it for real |
| **D-5** | FR-A2 asks for per-area plain-language counts. Descriptors carry no area | Add an optional `area: PurgeArea` field to `PurgeDescriptor`, required (by an invariant test) on every non-`never` descriptor. It is a mechanical edit in `descriptors.ts` along its existing § comments. **No level changes**, so the baseline is untouched. The alternative, a table→area map outside `descriptors.ts`, would break "table names live only in descriptors.ts" |
| **D-6** | The route is a `POST` under `/api/admin` | Add it to `app/api/admin/__tests__/adminGate.writes.test.ts` (`CASES` 59 → 60) so the four denial cases and "nothing touched before the gate" are proven by the shared oracle, in addition to its own route test |
| **D-7** | Size (see below) | Split into AD-1a / AD-1b / AD-1c |

---

## Proposed split

The whole slice is about **3.5–4 days**, which is over the 2–3 day estimate. The reconciler, the evaluator, the route and the dialog are each real work. The plan below splits it into three numbered slices. Each ships alone and has its own PR and SA/QA pass.

| Slice | Delivers | ACs | Size |
|---|---|---|---|
| **AD-1a: Schema reconciler + classification pass** | `introspectSchema()`, `SchemaReconciler`, the SC-8 descriptors and baseline notes, the `area` field (D-5), a read-only prod measurement script. **This closes B-4 on its own:** it is the fail-closed oracle every later slice needs | AC-A5 | 🟡 ~1.25 d |
| **AD-1b: Refusal evaluator + admin preview route** | `checkAdminStatus` (D-3), `findUserIdentity` (D-1), the evaluator, `AdminDeletionPreview`, the route, the census row, the `adminGate.writes` entry | AC-A1, AC-A2 (code half), AC-A3 (API), AC-A4 | 🟡 ~1.5 d |
| **AD-1c: Businesses page dialog** | The danger area, `DeleteBusinessDialog`, copy, a render test, source-guard additions | AC-A2 / AC-A3 (rendered), QA's manual prod check | 🟢 ~1 d |

If SA prefers one PR, the task list below runs in the same order without change.

---

## Files to Create / Modify

| File | Action | Slice | Reason |
|---|---|---|---|
| `lib/repositories/BusinessPurgeRepository.ts` | modify | a | `introspectSchema()`: `rpc('purge_schema_introspect')`, a Zod-parsed subset (`columns`, `foreign_keys`), `{ data, error }`, never throws. Service-role use documented at the call site |
| `lib/repositories/__tests__/BusinessPurgeRepository.introspect.test.ts` | create | a | Repository unit test |
| `lib/business-os/purge/SchemaReconciler.ts` | create | a | T7, read-only (SC-7) |
| `lib/business-os/purge/__tests__/SchemaReconciler.test.ts` + `__tests__/fixtures/schema-introspect.fixture.json` | create | a | SC-12 reconciler tests |
| `lib/business-os/purge/types.ts` | modify | a | `PurgeArea` union, optional `area` on `PurgeDescriptor` |
| `lib/business-os/purge/descriptors.ts` | modify | a | 9 new descriptors (SC-8) and `area` on deletable rows |
| `lib/business-os/purge/__tests__/classification-baseline.json` | modify | a | +9 levels (count 135 → 144) and a new `reviewNotes` map |
| `lib/business-os/purge/__tests__/descriptors.invariant.test.ts` | modify | a, b | SC-8 assertions, review-note presence, the `area` invariant. B-1 scan extended to `app/api/admin/users/[id]/deletion` |
| `scripts/purge-schema-reconcile.ts` | create | a | Read-only, imports `runSchemaReconciler`, prints the result and the ref/SHA. Used for AC-A5's pre-merge prod re-measure |
| `lib/services/AdminAccessService.ts` (+ its test) | modify | b | `checkAdminStatus` (D-3) |
| `lib/repositories/AuthAccountRepository.ts` + `__tests__/AuthAccountRepository.test.ts` + `__tests__/authAccountRepository.callers.guard.test.ts` | modify | b | `findUserIdentity` (D-1), surface and callers guards |
| `lib/repositories/__tests__/BusinessOsBillingAccountRepository.test.ts` | modify | b | Add `AdminDeletionPreview.ts` (and its test) to the callers `ALLOWED` list, with the reason |
| `lib/business-os/purge/adminDeletionRefusals.ts` | create | b | Pure evaluator, R-1…R-8 |
| `lib/business-os/purge/AdminDeletionPreview.ts` | create | b | Composition (SC-2, SC-3, SC-10) |
| `lib/business-os/purge/__tests__/adminDeletionRefusals.test.ts`, `__tests__/AdminDeletionPreview.test.ts` | create | b | SC-12 evaluator and composition tests |
| `app/api/admin/users/[id]/deletion/preview/route.ts` | create | b | SC-1 |
| `app/api/admin/users/[id]/deletion/preview/__tests__/route.test.ts` | create | b | 401, 403, 400, 404, 200 |
| `app/api/admin/__tests__/adminGate.writes.test.ts` | modify | b | D-6 (59 → 60) |
| `docs/admin/ADMIN_IDENTIFICATION_AND_ACCESS.md` | modify | b | Register row 96, census re-measured from disk, Change History |
| `app/admin/users/types.ts` | modify | c | `DeletionPreviewPayload` types, local, with no `lib/` import |
| `app/admin/users/deletionCopy.ts` | create | c | Area labels, kept categories, refusal clearing actions, the disabled reason |
| `app/admin/users/components/DeleteBusinessDialog.tsx` | create | c | The dialog |
| `app/admin/users/page.tsx` | modify | c | Danger area at the bottom of the expanded row. The removal comment for the old terminate button is updated to point at the new, gated, read-only flow |
| `app/admin/users/__tests__/source.guard.test.ts` | modify | c | Add the new files to `SCREEN_FILES`, plus assertions specific to the dialog |
| `app/admin/users/__tests__/deleteBusinessDialog.render.test.tsx` | create | c | Render test |
| `docs/requirements/ADMIN_DELETE_USER_BUSINESS_REQUIREMENT.md` | modify | a, b, c | Status and Change History per slice (standing preference: update the main requirement) |
| `docs/workplans/business-os-business-data-purge.md` | modify | a | T7 row: "read-only reconciler built in AD-1a; C-2 FK comparison still ⬜" |

---

## Task List

### AD-1a: Schema reconciler + classification pass
- [x] ✅ **T1** `BusinessPurgeRepository.introspectSchema()`: no args, Zod schema for the subset, `{ data, error }`, ids-free logs. Test: RPC name, parse success, RPC error → error, malformed payload → error.
- [x] ✅ **T2** `SchemaReconciler.ts`: `reconcileSchema` (pure) and `runSchemaReconciler`. Union predicate, `ambiguous` on a `public.users` table, `unclassified` / `missingDeletable` / `missingNever`, `fingerprint` (node `crypto`, canonical sorted JSON). Status `ok | drift | ambiguous | unreadable`.
- [x] ✅ **T3** Classification pass (SC-8). First run T15's script against prod to confirm the 9 tables and that `insight_actions` has no inbound blocking FK. Then:
  - `insight_actions`: `reset`, LEAF, `user_id`, `rows`, with a note on the `business_profiles` CASCADE (SA-1).
  - `auth_handoff_codes`: `never` (ephemeral sign-in handoff, identity-level).
  - `ais_scoring_weights`, `ais_system_config`, `exchange_rates`, `exchange_rate_history`, `system_settings_config`, `sla_events`, `shared_agent_imports`: `never`, each noted as an actor reference on platform data. The 4 with **NO ACTION** FKs to `auth.users` (`exchange_rates`, `exchange_rate_history`, `system_settings_config`, `sla_events`) carry the FU-9 note.
- [x] ✅ **T4** Baseline: add the 9 levels, set `count` to 144, add `reviewNotes: { <table>: "2026-10-xx AD-1a SC-8: <evidence>" }`. The invariant test asserts that each of the 9 has a note and that `count` matches.
- [x] ✅ **T5** `area` (D-5): add the `PurgeArea` type and populate it on every `reset` / `purge` / `optional:*` descriptor. Invariant: every non-`never` descriptor has an area. The SA-S1 mirror test still passes, because level semantics are untouched.
- [x] ✅ **T6** Run `npm test -- lib/business-os/purge lib/repositories/__tests__/BusinessPurgeRepository` (invariant suite, `no-deletion-paths`, `ResetService.order` all green). Record that adding `insight_actions` puts it in the (inert) Reset list.
- [x] ✅ **T15** `scripts/purge-schema-reconcile.ts`: a read-only prod run that prints status, the three lists, the fingerprint and the git ref/SHA (schema-check Rule 2). Its output goes into this workplan for AC-A5. It is re-run just before merge.


**AD-1a implementation notes (Dev, 2026-10-04)**

| Item | As built |
|---|---|
| T1 | `introspectSchema()` returns `AgentRepositoryResult<PurgeSchemaSnapshot>` (`{ data, error }`), Zod-parses `columns` + `foreign_keys` only, never throws. A malformed payload is an error ("unexpected shape"), never an empty schema. Service-role use documented at the method (EXECUTE is granted to `service_role` only) |
| T2 | `reconcileSchema` (pure) + `runSchemaReconciler` (never throws; any failure → `unreadable`, fingerprint `null`). Status precedence: `ambiguous` > `drift` > `ok`. The fingerprint is `computeSchemaFingerprint`, one small pure function, sha256 over canonical JSON `{v:1, tenant, fks, descriptors}` sorted in code-unit order (not `localeCompare`, which can tie on the separator). It is compared to nothing. No Supabase import, no `.from(` (B-1/B-2 scans unchanged and green) |
| T3 | Prod measured with T15's script **before** editing (a temporary `--explain` mode printed each table's tenant columns and FKs — schema only; removed before hand-over so the script imports only the reconciler, not `BusinessPurgeRepository`, per purge bound B-3). Result matched SA's 18:03 UTC figures exactly: 9 unclassified, 0 missing deletable, 3 missing `never`. `insight_actions`: no inbound FK; outbound `business_profiles` CASCADE, `insights` SET NULL, contact/booking/invoice CASCADE → LEAF is correct. The 7 actor tables have **no** tenancy column (scope `global`, documentation only); NO ACTION to `auth.users` on exactly `exchange_rates.updated_by`, `exchange_rate_history.changed_by`, `system_settings_config.updated_by`, `sla_events.acknowledged_by` (FU-9 notes); SET NULL on the other three |
| T4 | Baseline 135 → 144, new `reviewNotes` map (dated `2026-10-04 AD-1a SC-8: <evidence>`). Invariant: each SC-8 table at its level, note present, no orphan note, `count` matches |
| T5 | `PurgeArea` closed union (16 ids) on 78 deletable descriptors. Grouping choices worth a look: `proposals` and `lead_responses` → `crm`; `user_media` → `website` (it backs `website-images`); `kernel_*` → `insights`; `marketing_consent_settings` → `email_marketing`; `daily_briefings*` → `briefings`. Opt-in rows map to their option (`agents`, `integrations`, `activity_history`, asserted). Labels belong to AD-1c's copy |
| T6 | `npm test -- lib/business-os/purge lib/repositories/__tests__/BusinessPurgeRepository`: 6 suites, 120 tests, all green (invariant, `no-deletion-paths`, `ResetService.order`, storage, the new introspect + reconciler suites). **Recorded:** `insight_actions` is now in the Reset list (`descriptorsForRun('reset', …)`), which is inert while `purge_business_data` is held |
| T15 | `scripts/purge-schema-reconcile.ts`: Pino output, logs the Supabase host, git branch/SHA, status, the three lists, counts and the fingerprint. Reads no rows, logs no emails. Exit 0 only on `ok`, 2 on any argument. Imports only `runSchemaReconciler` (B-3). Not wired into CI |

**AC-A5 prod measurement (read-only, `purge_schema_introspect()` only, nothing written):**

| Run | Ref | Status | Tenant tables | Unclassified | Missing deletable | Missing `never` (listed, non-blocking) | Fingerprint |
|---|---|---|---|---|---|---|---|
| Before SC-8 (2026-10-04) | `1a9944a5` + AD-1a code | `drift` | 134 | 9 (SA's list) | 0 | `intake_form_templates`, `subscriptions`, `website_templates` | `87640ba3…` |
| After SC-8 (2026-10-04) | `1a9944a5` + AD-1a code | **`ok`** | 134 | **0** | **0** | same 3 | `97dd8ce6…f5338` |

Re-run just before merge: `npx tsx --import ./scripts/env-preload.ts scripts/purge-schema-reconcile.ts` from the repo root (expects exit 0).

### AD-1b: Evaluator + route
- [ ] **T7** `AdminAccessService.checkAdminStatus` (D-3). Tests: bound id → true, email match → true **with no `bindUserId` call**, env list → true, none → false, cache error → `null`, the email never logged.
- [ ] **T8** `AuthAccountRepository.findUserIdentity` (D-1). Tests: found, 404 → null, error → error, no email in logs. Update the surface and callers guards.
- [ ] **T9** `adminDeletionRefusals.ts`: pure, returns **all** refusals (SC-4). `R3_LIVE_STATUSES` is typed against `BusinessOsSubscriptionStatus`. R-4 `not_applicable` with the SA-7 comment. R-7 `deferred` (D-4). When R-1 or R-2 applies, R-3…R-8 are `not_evaluated`.
- [ ] **T10** `AdminDeletionPreview.ts`: target lookup → `not_found`. R-1 / R-2 short-circuit with **no** `buildPurgePreview` call. Then the preview, the reconciler, billing (both modes), Connect, and local blocking, run sequentially (they are cheap). Group by `area`, derive `keptTables`, build the limitations (`missingNever`, unknown or truncated counts, "Purge commit not built"). The disabled reason. Logs carry ids only.
- [ ] **T11** Route `app/api/admin/users/[id]/deletion/preview/route.ts`, following the `new-api-route` admin template:
  - `requireAdmin(requestLogger)` is the first statement.
  - `params.id` is checked with `z.string().uuid()` before any lookup. The id is lower-cased.
  - The body is read as text: empty → `{}`, malformed JSON → 400, then `z.object({}).strict()`.
  - `runtime = 'nodejs'`, `dynamic = 'force-dynamic'`, `maxDuration = 60`.
  - 404 on `not_found`. Errors use the dev-only `details` guard. `correlationId` comes from the `x-correlation-id` header or is a random UUID.
- [ ] **T12** Route test and the `adminGate.writes` entry (D-6). Extend the B-1 scan in `descriptors.invariant.test.ts` to the new route directory.
- [ ] **T13** Add the billing repository caller to its `ALLOWED` list (SC-5) and confirm there is no entitlements import. Run `npm run test:bos-entitlements` and `npm run test:authz-guard`.
- [ ] **T14** Docs: register row 96, re-measure the census from disk (method in As-Built State), Change History.

### AD-1c: Dialog
- [ ] **T16** `types.ts` payload types and `deletionCopy.ts`: area labels, kept categories with reasons, a clearing action per refusal. The R-3 action points to the plan cancel (see Risk 3), R-5 to "Disconnect Stripe (available with AD-4)", R-6 to the C1/C2/C3 items to resolve, R-8 to "platform problem, not this business: contact engineering".
- [ ] **T17** `DeleteBusinessDialog.tsx`:
  - Header: business name, email, user id, joined date.
  - Area counts, with "unknown" shown as unknown and never as 0. Storage counts.
  - The kept list. The refusals list (every status shown, R-4 "Not applicable").
  - A technical `<details>` expander. `aria-live` blocked state. No input. The disabled confirm with "Deletion not yet available: [reason]".
  - Loading and error states. An error shows a sentence, never a raw message.
- [ ] **T18** `page.tsx`: a separated danger area (border plus a heading) at the bottom of the expanded row, holding a "Delete…" button that opens the dialog. It is not in the collapsed row (FR-A1).
- [ ] **T19** Source guard additions and the render test.
- [ ] **T20** `npm run lint`. Run the touched suites. Hand to SA, then to QA for the manual prod check (AC-A2).

---

## Test Plan

All tests are Jest, inside the existing sharded `Gate tests (jest)` run. There is no new workflow, no DB in CI and no network. They are unit tests with mocked repositories, which add seconds of shard time at most and stay inside the existing critical path (SC-12, the no-added-CI-time preference). The quarantine list and floors are unchanged.

| Suite | Cases |
|---|---|
| `SchemaReconciler.test.ts` (fixture JSON) | Unclassified via `user_id`. Unclassified via `owner_user_id` only. Unclassified via an FK to `users` only. A table with none of the three is ignored. A missing `reset` / `purge` / `optional:*` descriptor → `drift`. A missing `never` descriptor → listed and **not** drift. A `public.users` table → `ambiguous`. The fingerprint does not change with input order and changes when an FK action changes. Repository error → `unreadable`. The real `PURGE_DESCRIPTORS` against a fixture of their own tables → `ok` (non-vacuity) |
| `BusinessPurgeRepository.introspect.test.ts` | RPC name with no args. Parse. RPC error. Malformed payload |
| `adminDeletionRefusals.test.ts` | One applies-case and one clear-case per R. **Several refusals returned together.** Read failure → `unverified` for R-2 (`null`), R-3 (an error in **either** mode), R-5 (throw), R-6 (`null` count), R-8 (`unreadable` / `ambiguous`). R-3 live through `ended_at` null plus a subscription id while the status is `canceled`. R-3 not live once `ended_at` is set. R-4 always `not_applicable`. R-7 `deferred`. R-1 or R-2 → the rest `not_evaluated`. Source check: no status string literal for C1–C3 in the evaluator (uses `LOCAL_BLOCKING_CONDITIONS`) |
| `AdminDeletionPreview.test.ts` | Self → no `buildPurgePreview`, no counts. Admin target → same. Happy path → `buildPurgePreview` called with `level: 'purge'` and the fixed options (SC-2). **No destructive method is called** (`executePurge`, `removeStorageUnderUser`, `writeVerifiedSnapshot`, `writeSnapshot`, `readAllRows` are jest-spied and expected not to be called), so nothing is deleted (AC-A2, code half). The planted email and business name appear in no logger argument (SC-10). `deletionAvailable` is always false |
| `route.test.ts` | 401 with no user. 403 for a non-admin. Both with **no** repository touched. 400 for a non-UUID id, with no lookup. 400 for a body `{ "userId": "…" }`. 400 for malformed JSON. Empty body accepted. 404 for an unknown target. 200 happy path (shape). 200 for self with R-1 applying and `counted: false`. 500 with `details` only in development |
| `adminGate.writes.test.ts` | The new case through the four shared denial cases |
| `AdminAccessService` / `AuthAccountRepository` tests | T7 / T8 cases. Surface and callers guards updated |
| `descriptors.invariant.test.ts` | The 9 SC-8 tables are present at their levels. Review notes exist. Baseline `count` matches. `area` is on every non-`never` descriptor. The B-1 scan covers the new route. The existing B-2, SA-S1/S2/S3 and C-4 suites unchanged and green |
| `deleteBusinessDialog.render.test.tsx` | Counts rendered, unknown shown as "unknown". Kept list. Every refusal with its clearing action. R-4 "Not applicable". **No text input present.** Confirm button `disabled` with the reason text. A `role="status"` region announces the blocked state. Opening calls `fetch` once with `POST` and body `{}` |
| `source.guard.test.ts` | The new files in `SCREEN_FILES` (no `lib/business-os` or repository import, no `console.*`). The dialog posts only to `/deletion/preview` and contains no `commit` URL and no `token` |

**Manual (QA, AC-A2 / AC-A5):** on prod, against a **throwaway account** with seeded data, check that the preview shows non-zero counts and the kept list. Row counts for that account are identical before and after (a read-only SQL count, without the word "into" in pasted SQL). Check self → R-1, another admin → R-2, and a test account with a billing row → R-3. Run `scripts/purge-schema-reconcile.ts` just before merge, expecting zero unclassified and zero missing deletable.

**Commands before hand-over:** `npm test -- lib/business-os/purge lib/repositories/__tests__ lib/services app/api/admin app/admin/users lib/admin/__tests__`, `npm run test:authz-guard`, `npm run test:bos-entitlements`, `npm run lint`.

---

## SC → task traceability

| SC | Requirement | Tasks | Proof |
|---|---|---|---|
| SC-1 | Route path, `requireAdmin` first, Zod uuid, strict `{}`, nodejs / 60 s, census in the same PR | T11, T12, T14 | route test, `test:authz-guard`, `adminGate.writes`, register row 96 |
| SC-2 | Level and options fixed server-side | T10 | `AdminDeletionPreview.test` |
| SC-3 | Order: target exists → R-1, R-2 → no counting → preview → R-3…R-6, R-8 | T8, T10 | composition test (no `buildPurgePreview` on R-1/R-2). **D-3 asks SA to accept `checkAdminStatus` in place of `isAdmin`** |
| SC-4 | Every refusal returned. Reuse the reads, not `evaluateResetGuard`. A failed read is a refusal | T9 | evaluator tests (multi-refusal, `unverified` cases, no re-typed statuses) |
| SC-5 | R-3 through the billing repository, both modes, the "live" rule, no entitlements import | T9, T10, T13 | evaluator tests, callers allow-list, `test:bos-entitlements` |
| SC-6 | No `.from()` in the purge folder. Repositories only. Service role documented. No Supabase client import | T1, T2, T10, T12 | B-1 and B-2 invariant suites (B-1 extended to the new route) |
| SC-7 | Reconciler, read-only. Union predicate in TS. `users` asserted. Missing `never` non-blocking. Fingerprint | T1, T2 | reconciler tests |
| SC-8 | Classification pass with notes. Baseline extended. Zero unclassified on prod | T3, T4, T15 | invariant test, prod script output in this workplan |
| SC-9 | No commit route, no token, no destructive call. Confirm disabled. Guards green | T10, T17, T19 | composition "no destructive method" test, `no-deletion-paths`, source guard (no commit / token), render test. **D-2 asks SA about the existence probe** |
| SC-10 | Target only from the path. Equality-scoped counts. Ids-only logs. Dev-only details | T10, T11 | route test (body `userId` → 400), log-content test. Counts reuse `BusinessPurgeRepository`'s existing `user_id` / `via` scoping unchanged |
| SC-11 | BA doc fixes before the workplan | (done by BA, 2026-10-04) | requirement Change History |
| SC-12 | Jest only, no added CI time, the listed suites, the keyboard and live-region dialog | all test tasks, T17, T19 | Test Plan above |

## AC → test traceability

| AC | Proven by |
|---|---|
| AC-A1 (403 / 401) | `route.test.ts`, `adminGate.writes.test.ts` |
| AC-A2 (non-zero counts and kept list, nothing deleted) | `AdminDeletionPreview.test.ts` (no destructive call), render test, QA manual before/after counts on prod |
| AC-A3 (each refusal with its clearing action, no input, R-4 not applicable) | `adminDeletionRefusals.test.ts`, render test |
| AC-A4 (non-UUID → 400 before lookup, body `userId` → 400) | `route.test.ts` |
| AC-A5 (zero unclassified and zero missing deletable on prod, missing `never` listed) | `SchemaReconciler.test.ts`, the invariant suite, and the output of `scripts/purge-schema-reconcile.ts` recorded here and re-run before merge |

---

## Risks and notes

1. **Adding `insight_actions` as `reset` changes what a future Reset deletes.** Reset is inert, because the RPC is held. The held SQL has no table allow-list (it checks that a table exists and is scoped to the user at run time), so no SQL change is needed. This is the intended correction (SA-1(a)).
2. **SA's prod figures date from 18:03 UTC on 2026-10-04.** T3 re-measures before editing descriptors, and T15 re-runs just before merge. Any new table found then is classified in the same PR, or the merge waits.
3. **The target of R-3's clearing action is not settled.** It is unclear whether a Business OS plan cancel surface exists yet: `app/api/stripe/cancel-subscription` looks like the AgentsPilot one, and plan payments P-x may not have shipped a cancel. T16 confirms. If none exists, the copy says "Cancel the subscription in the Stripe dashboard (test mode)" and BA is told.
4. **The existing internal preview is not changed.** Wiring the reconciler into it is allowed (SC-7) but left out, to keep the slice small. It is noted as a follow-up.
5. **Cache staleness in `checkAdminStatus`.** It shares `isAdmin`'s cache, so a newly added admin may not be protected by R-2 until the cache expires. That is acceptable for AD-1, which is read-only. AD-2 must re-check without the cache, or invalidate it, right before commit.
6. **Local `main` is stale.** Do not branch from it, and never use `git stash` here, because the stash list is shared across worktrees.

---

## SA Review Notes

**Reviewed by SA, 2026-10-04** (against `origin/main` `1a9944a5`, read through `git show`)
**Status:** ✅ Approved with conditions

### Rulings on D-1…D-7

| # | Ruling | Conditions |
|---|---|---|
| D-1 | ✅ **Accepted.** Add `findUserIdentity` to `AuthAccountRepository`. A second door to `auth.users` would be worse than widening the pinned surface by one read | Update the surface guard (4 → 5) and the callers guard in the same PR. Return `{ data: null }` only on a real 404. **Any other error must become a 500 from the route, never a 404 and never "not an admin".** No email in logs |
| D-2 | ✅ **Accepted. SC-9 is clarified, not waived.** SC-9 is about destructive calls. `purgeFunctionExists()` calls with `p_user_id: null` and `p_tables: []`, both pinned by the invariant suite, and the function is held, so today it returns PGRST202. It cannot delete anything. SC-9 should read "no **destructive** RPC call; the existing null-id existence probe is permitted" | Keep `buildPurgePreview` unchanged and do **not** add the `probeResetLive` parameter. The "no destructive method" spy test is mandatory. BA is asked to update SC-9's wording in the requirement Change History (a wording change only) |
| D-3 | ✅ **Accepted. This is a correct finding against my own SC-3.** On origin/main, `isAdmin` returns `false` in its `catch` (lines 121–124), calls `bindUserId` on an email match (line 105), and logs `{ userId, email }` in the env fallback (line 114). Used for R-2, it fails open, writes during a read-only preview, and breaks SC-10. SC-3 is amended: R-2 uses `checkAdminStatus` | **(a)** Do not copy the three-source logic. Extract one private resolver (cache → bound id → DB email → env email) that returns the matched source or throws. `isAdmin` keeps its self-heal, its log and its fail-closed `false` on top of it. `checkAdminStatus` maps a match to `true`, no match to `false`, and a throw to `null`, with no write and an ids-only log. **(b)** `isAdmin`'s existing tests pass **unmodified**, which proves no behaviour change for `requireAdmin`. **(c)** Risk 5 (cache staleness) stands as written. AD-2 must use a fresh, uncached read before commit, and this is carried into AD-2's workplan |
| D-4 | ✅ **Accepted.** R-7 `deferred`, non-blocking. Taking an advisory lock in a preview would make the preview a writer | The copy must say "Checked at the moment of deletion", not "clear" |
| D-5 | ✅ **Accepted.** `area` belongs in `descriptors.ts`, so table names stay in one file. No level changes means no baseline churn beyond SC-8 | Enforce it with an invariant test: every non-`never` descriptor has an `area`. `PurgeArea` is a closed union, not a string |
| D-6 | ✅ **Accepted.** The shared oracle proves "nothing touched before the gate", and that applies to a POST whether it reads or writes | Add a one-line comment on the `CASES` entry: "read-only POST (body must be `{}`); listed for the gate oracle". Bump the cap 59 → 60 in the same PR |
| D-7 | ✅ **Split approved**, three PRs in order a → b → c | See below |

### Split ruling (AD-1a / AD-1b / AD-1c)

None of the three PRs leaves dead code:
- **AD-1a** has live consumers in the same PR: `scripts/purge-schema-reconcile.ts` (the AC-A5 prod measurement), the invariant suite, and the corrected descriptors (B-4 closed for Reset as well). The fingerprint stays, because SC-7 requires it, but it must stay one small pure function. Do not add a comparison, storage or a token field before AD-2.
- **AD-1b** ships a gated, tested and registered route before any UI exists. That is acceptable: it is the API half of AC-A1/A3/A4, and a census row counts it.
- **AD-1c** is the UI only.

Each PR updates the main requirement (status and Change History), per standing preference. AD-1b's PR must not merge before AD-1a's, because R-8 depends on `runSchemaReconciler`.

### Open question: is there a Business OS plan cancel action for R-3's clearing message?

**No, not on origin/main.** In-app cancel is plan-payments **P-7a** ("card, invoices, cancel and reactivate"), which is not built. Neither existing cancel route is the right target:
- `app/api/stripe/cancel-subscription` reads `user_subscriptions`, so it cancels the **agent-platform** subscription.
- `app/api/payments/plans/[id]/cancel` cancels a business's **client payment plan** (instalments).

Pointing R-3 at either one would send the admin to the wrong subscription. **Condition:** the R-3 clearing copy reads "Cancel the subscription in the Stripe dashboard (in the mode shown: test or live). In-app cancel arrives with plan payments P-7a." The dialog shows which `livemode` row is live. Tell BA, so §R-3 and the plan-payments go-live checklist (PF-14 / C-11) are cross-referenced: P-7a's cancel becomes R-3's clearing action when it ships.

### Further conditions

1. **R-3 status set.** `R3_LIVE_STATUSES` is typed `readonly BusinessOsSubscriptionStatus[]`. All five members (`active`, `trialing`, `past_due`, `unpaid`, `paused`) are in the repository's union on origin/main. Keep the planned membership test. An error on **either** `livemode` read gives `unverified`.
2. **Target-lookup ordering (SC-3).** If the identity read fails, there is no R-1/R-2 evaluation and no counting. The route returns a 500 with the dev-only details guard. If the email is null, R-2 still runs on the id, so `checkAdminStatus` must handle `email: null`.
3. **Reconciler failure isolation.** If the reconciler throws or is unreadable, R-8 is `unverified`. It must **not** make the whole preview fail. The counts and the other refusals still render. Test this.
4. **Prod script (T15).** It is read-only and prints table names, counts of lists, the fingerprint and the git SHA. It prints **no** row data and no emails. It loads its env from `.env.local` and is never wired into CI.
5. **B-1 scope.** Extending the B-1 scan to `app/api/admin/users/[id]/deletion/**` is required, not optional. `AdminDeletionPreview.ts` must pass the existing B-1/B-2 scans unchanged (no Supabase client import, no `.from(`).
6. **No audit row in AD-1.** Accepted. The preview is read-only end to end.

### Approval
[x] Workplan approved with the conditions above. Proceed with **AD-1a** first, from a branch cut from `origin/main`. The conditions for D-1 and D-3 and conditions 1–3 are checked at AD-1b's code review. The R-3 copy is checked at AD-1c's code review.

**Code Review by SA, 2026-10-04 (AD-1a)** (uncommitted diff in worktree `neuronforge-admin-delete`, branch `feature/admin-delete-ad1a-reconciler`, base `1a9944a5`)
**Status:** ✅ Code Approved

### Code Review Comments
1. `lib/business-os/purge/descriptors.ts`: the 84 removed lines are **only** the old forms of rows that gained `area:`. With `area: '…',` stripped, the file differs from `1a9944a5` only by the 9 SC-8 additions. Table set: 82 → 83 object rows (`+insight_actions`) and 8 new `never(...)` rows. Nothing was dropped and no level, scope, order, snapshot or note changed. Every non-`never` row has an area (invariant test). Priority: none (verified)
2. Deviations (1)–(4) are **accepted.** (1) `global` scope on the 7 actor-reference tables is correct: none has a tenancy column, the scope is there as documentation, and `never` rows are never deleted. `auth_handoff_codes` keeps `user_id`, which is its real column. (2) The area choices are reasonable. They are only grouping keys, and AD-1c's copy can relabel them without changing a level. (3) `insight_actions` in the Reset list is the intended SA-1(a) correction. It stays inert while the RPC is held. (4) Removing `--explain` was required by B-3. Priority: none
3. B-3 / B-1 / B-2: the script imports only `runSchemaReconciler`. `SchemaReconciler.ts` has no Supabase import and no `.from(`. Its only I/O is the repository's `introspectSchema()`. The existing B-1/B-2 scans stay green unchanged. Priority: none
4. Failure isolation: `introspectSchema()` never throws, and a Zod parse failure is an error, never an empty schema. `runSchemaReconciler` maps an error, a null result or a throw to `unreadable` with a null fingerprint, and all three cases are tested. `ambiguous` outranks `drift`, and both block. AD-1b must still prove condition 3 (an unreadable result → R-8 `unverified`, and the preview still renders). Priority: carried to AD-1b
5. Script (condition 4): Pino only, no `console.*` in any touched file. It reads no rows and logs only table names, counts, the fingerprint, the host and the git ref. Exit 0 only on `ok`. It is not wired into CI. Priority: none
6. Baseline 135 → 144 matches 9 additions. Each addition has a dated `reviewNotes` entry, enforced along with "no orphan notes" and "count = levels". The `business_events` / `business_health_summaries` / `business_intake_forms` block moved only to restore sort order. Priority: none
7. Verified by SA: `npx jest lib/business-os/purge lib/repositories/__tests__/BusinessPurgeRepository` gives 6 suites, 120/120. ESLint on the 5 changed source files is clean. I did not re-run tsc, so Dev's scoped pass stands. The full `tsc --noEmit` OOM is a machine limit. The required CI type-check job is the gate. Priority: Low

### Optimisation Suggestions
- `classification-baseline.json` `generated` still reads `2026-09-16`. Bump it to `2026-10-04`, or say in a note that `reviewNotes` carries the dates. This is cosmetic.
- `PurgeArea` is optional in the type and enforced by a test, which matches the D-5 ruling. If more descriptors are added, a discriminated type (area required when the level is not `never`) would move the check to compile time. Not needed now.

### Code Approved for QA: Yes
Before merge: re-run `scripts/purge-schema-reconcile.ts` against prod and expect exit 0 (AC-A5, Risk 2). Do not commit until the user has seen the diff.

## QA Testing Report

**QA — 2026-10-04 (AD-1a only)**
**Test mode:** full (for the AD-1a scope)
**Strategy used:** A (Jest unit: reconciler, introspect, invariant suites) + C (the read-only prod script `scripts/purge-schema-reconcile.ts`) + a drift demonstration (one descriptor commented out, script and Jest re-run, file restored byte-for-byte)
**Focus:** schema, security (read-only, no PII in logs)
**Skipped:** AD-1b/AD-1c criteria (AC-A1…A4). They are not part of this slice. D (browser) is not applicable because AD-1a has no UI
**Input source:** prompt from TL

### Test Coverage
| Acceptance Criterion / check | Tested? | Result | Notes |
|---|---|---|---|
| AC-A5: prod reconciler reports 0 unclassified, 0 missing deletable, missing `never` listed | ✅ | Pass | Live run on 2026-10-04 against `jgccgkyhpwirgknnceoh.supabase.co`, ref `feature/admin-delete-ad1a-reconciler` @ `1a9944a5` + uncommitted AD-1a. Exit 0, `status: ok`, 134 tenant tables, 0 / 0, missing `never` = `intake_form_templates`, `subscriptions`, `website_templates`. Fingerprint `97dd8ce6…f5338`, identical to Dev's recorded value |
| SC-7: union predicate (`user_id` / `owner_user_id` / FK to `users`), `ambiguous` on `public.users`, missing `never` does not block | ✅ | Pass | `SchemaReconciler.test.ts`: one case for each predicate leg, ignore case, ambiguous, ambiguous beats drift, fingerprint order-independence / FK-action / level / boundary cases, non-vacuity against the real `PURGE_DESCRIPTORS` |
| Failure path: unreadable (error / null / throw) | ✅ | Pass | Reconciler: a repository error and a throw both give `unreadable` with fingerprint `null` and never reject. Repository: RPC error, client reject, and 5 malformed payloads (incl. `null`) give an error, never an empty schema |
| Failure path: drift | ✅ | Pass | Demonstrated live. With `insight_actions` commented out, the prod script gave `status: drift`, `unclassified: ["insight_actions"]`, **exit 1**, and `jest lib/business-os/purge` went red (4 failed / 108, in 2 suites: invariant + reconciler non-vacuity). Restored from a byte copy. `cmp` of the file and of the full `git diff` both identical to before |
| SC-8: 9 classifications + baseline 144 + `reviewNotes` | ✅ | Pass | Invariant suite green |
| D-5: `area` on every deletable descriptor | ✅ | Pass | Invariant suite green |
| Read-only: nothing writes to the DB | ✅ | Pass | The only I/O is `rpc('purge_schema_introspect')`, a plpgsql SECURITY DEFINER function returning a `jsonb_build_object` over catalog views, with EXECUTE granted to `service_role` only (migration `20260915a`). The reconciler and script contain no `.insert/.update/.upsert/.delete` calls. The two grep hits are `Set.delete` and `hash.update`, so they are not writes |
| No row data / emails in output | ✅ | Pass | Prod output holds only host, branch/SHA, table names, counts and the fingerprint. The only `@` in the output is the dotenv banner |
| No `console.*` | ✅ | Pass | 0 in `SchemaReconciler.ts`, the script, `BusinessPurgeRepository.ts`, `descriptors.ts` and `types.ts`. Pino throughout |
| Skill minimum (`new-repository`: unit test per new method) | ✅ | Pass | `introspectSchema` has its own suite |

### Issues Found

#### Bugs (must fix before commit)
None.

#### Performance Issues (should fix)
None. The prod reconcile takes about 3 s (one RPC).

#### Edge Cases (nice to fix)
1. **`runSchemaReconciler` with `{ data: null, error: null }` is not tested directly** — File: `lib/business-os/purge/__tests__/SchemaReconciler.test.ts` — Severity: Low. The code handles it (`error || !data` → `unreadable`, "schema introspection returned no data"), and the repository's null-payload case is tested, but the reconciler's own null branch has no test. A one-line `it` would close it.
2. Cosmetic, already raised by SA: `classification-baseline.json` `generated` still reads `2026-09-16`.

### Test Outputs / Logs
```text
npx jest lib/business-os/purge lib/repositories/__tests__/BusinessPurgeRepository
Test Suites: 6 passed, 6 total
Tests:       120 passed, 120 total        (8.8 s)

npm test (full, worktree)                  (5 m 24 s wall)
Test Suites: 11 failed, 8 skipped, 828 passed, 839 of 847 total
Tests:       122 failed, 64 skipped, 16562 passed, 16748 total
All 11 failing suites are in .github/ci/jest-quarantine.json (v4-generator, LogicalIRCompiler,
v6 validation, IRToNaturalLanguageTranslator, IntentClassifier, TokenBudgetManager,
ConditionalEvaluator x2, StructuredTransforms x3). None touch purge/repositories. 0 non-quarantined failures.

prod (read-only) — exit 0
{"supabaseHost":"jgccgkyhpwirgknnceoh.supabase.co","branch":"feature/admin-delete-ad1a-reconciler","sha":"1a9944a5…","msg":"Purge schema reconcile (read-only)"}
{"status":"ok","tenantTableCount":134,"unclassifiedCount":0,"missingDeletableCount":0,"missingNeverCount":3,
 "missingNever":["intake_form_templates","subscriptions","website_templates"],
 "fingerprint":"97dd8ce67914266702b3c531b562af69d82b29e5958ed22c925cc2b7a80f5338"}

drift demo (insight_actions commented out, then restored) — exit 1
{"status":"drift","unclassifiedCount":1,"unclassified":["insight_actions"],"missingDeletableCount":0,...}
```

Hygiene: `.env.local` was copied in for the prod run and deleted straight after (it is git-ignored). `git status --porcelain` and `git diff` are identical before and after QA, apart from this report section. No stash, no commit.

### Final Status
- [x] All acceptance criteria pass — ready for commit (AD-1a scope; AC-A5 must still be re-run just before merge, per Risk 2)
- [ ] Issues found — Dev must address before commit

## Commit Info

_(RM populates)_

---

## Change History

| Date | Change | Details |
|------|--------|---------|
| 2026-10-04 | Workplan created (Dev) | AD-1 plan against `origin/main` `1a9944a5`. SC-1…SC-12 traced to tasks, AC-A1…AC-A5 to tests. Seven decisions for SA (D-1…D-7), including the D-3 finding that `isAdmin()` fails open as a refusal and writes. Split into AD-1a / AD-1b / AD-1c proposed (about 3.5–4 days in total). No code written |
| 2026-10-04 | SA workplan review | Approved with conditions. D-1 through D-7 accepted. D-3 amends SC-3: R-2 uses `checkAdminStatus`, built on one shared private resolver. D-2 clarifies SC-9 to mean "no destructive RPC". The a/b/c split is approved. No Business OS plan cancel exists yet (P-7a), so R-3 points to the Stripe dashboard |
| 2026-10-04 | AD-1a implemented (Dev) | T1–T6 and T15 done on `feature/admin-delete-ad1a-reconciler`, uncommitted. Reconciler + `introspectSchema()`, SC-8 pass (9 tables, baseline 144 with review notes), `area` on every deletable descriptor, read-only prod script. Prod reconcile after SC-8: `ok`, 0 unclassified, 0 missing deletable, 3 missing `never` listed |
| 2026-10-04 | SA code review (AD-1a) | Code approved for QA. Descriptors verified lossless against `1a9944a5` (only the `area` additions plus the 9 SC-8 rows). Deviations 1–4 accepted. B-1/B-2/B-3 hold. Reconciler failure → `unreadable` tested. Script is Pino-only and logs no row data. Baseline 144 with review notes. Prod re-run owed before merge |
| 2026-10-04 | QA (AD-1a) | Pass. Purge suites 120/120; full npm test 0 non-quarantined failures (11 quarantined red). Prod reconciler exit 0, `ok`, 0 unclassified / 0 missing deletable, fingerprint matches Dev. Drift demonstrated and restored byte-identical. One Low edge case (reconciler null-data branch untested) |
