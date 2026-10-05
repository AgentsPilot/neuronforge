# Workplan: Admin Delete, slice AD-1: read-only deletion preview from `/admin/users`

> **Last Updated**: 2026-10-05

**Developer:** Dev
**Requirement:** [ADMIN_DELETE_USER_BUSINESS_REQUIREMENT.md](/docs/requirements/ADMIN_DELETE_USER_BUSINESS_REQUIREMENT.md) §5 (AD-1), §6.1, §6.3, §8 (AC-A1…AC-A5), SA Review Notes (SC-1…SC-12)
**Date:** 2026-10-04
**Status:** AD-1a merged (PR #216, `0db9da62`). **AD-1b Code Complete (2026-10-04)** on `feature/admin-delete-ad1b-preview-route` (cut from `origin/main` `0db9da62`), SA-approved and QA-passed; PR #220 open. **AD-1c Code Complete (2026-10-05)**, uncommitted on `feature/admin-delete-ad1c-dialog` (stacked on `feature/admin-delete-ad1b-preview-route`; it needs AD-1b's route), waiting for SA code review.
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
- [x] ✅ **T7** `AdminAccessService.checkAdminStatus` (D-3). Tests: bound id → true, email match → true **with no `bindUserId` call**, env list → true, none → false, cache error → `null`, the email never logged.
- [x] ✅ **T8** `AuthAccountRepository.findUserIdentity` (D-1). Tests: found, 404 → null, error → error, no email in logs. Update the surface and callers guards.
- [x] ✅ **T9** `adminDeletionRefusals.ts`: pure, returns **all** refusals (SC-4). `R3_LIVE_STATUSES` is typed against `BusinessOsSubscriptionStatus`. R-4 `not_applicable` with the SA-7 comment. R-7 `deferred` (D-4). When R-1 or R-2 applies, R-3…R-8 are `not_evaluated`.
- [x] ✅ **T10** `AdminDeletionPreview.ts`: target lookup → `not_found`. R-1 / R-2 short-circuit with **no** `buildPurgePreview` call. Then the preview, the reconciler, billing (both modes), Connect, and local blocking, run sequentially (they are cheap). Group by `area`, derive `keptTables`, build the limitations (`missingNever`, unknown or truncated counts, "Purge commit not built"). The disabled reason. Logs carry ids only.
- [x] ✅ **T11** Route `app/api/admin/users/[id]/deletion/preview/route.ts`, following the `new-api-route` admin template:
  - `requireAdmin(requestLogger)` is the first statement.
  - `params.id` is checked with `z.string().uuid()` before any lookup. The id is lower-cased.
  - The body is read as text: empty → `{}`, malformed JSON → 400, then `z.object({}).strict()`.
  - `runtime = 'nodejs'`, `dynamic = 'force-dynamic'`, `maxDuration = 60`.
  - 404 on `not_found`. Errors use the dev-only `details` guard. `correlationId` comes from the `x-correlation-id` header or is a random UUID.
- [x] ✅ **T12** Route test and the `adminGate.writes` entry (D-6). Extend the B-1 scan in `descriptors.invariant.test.ts` to the new route directory.
- [x] ✅ **T13** Add the billing repository caller to its `ALLOWED` list (SC-5) and confirm there is no entitlements import. Run `npm run test:bos-entitlements` and `npm run test:authz-guard`.
- [x] ✅ **T14** Docs: register row 96, re-measure the census from disk (method in As-Built State), Change History.

**AD-1b implementation notes (Dev, 2026-10-04)**

| Item | As built |
|---|---|
| T7 | `AdminAccessService` now has ONE private resolver, `resolveAdminMatch(id, email)` (cache → bound id → DB email → env email; returns the matched source, `null`, or throws). `isAdmin` keeps its self-heal, env-fallback log and fail-closed `false` on top of it; its 6 existing tests pass **unmodified** (no `-` lines in the test diff). `checkAdminStatus` maps match → `true`, none → `false`, throw or no id → `null`; no write, ids-only log; `email: null` is still decided by the bound id. 7 new tests (incl. no `bindUserId` call, and "email never logged" on the env path) |
| T8 | `AuthAccountRepository.findUserIdentity(id)` → `{ id, email, createdAt }` or `null`. `null` only on a definite 404 / `user_not_found`; any other error, a throw, or a reply with no user and no error is an error. Surface test 4 → 5 methods; callers guard + `AdminDeletionPreview.ts` and its test. 5 new tests |
| T9 | `adminDeletionRefusals.ts`, pure. Always R-1…R-8, in order; `applies` / `unverified` block. R-2 `null` → `unverified` **and** stops counting (an account that may be an admin is not enumerated). Clear R-1/R-2 with no later facts → R-3/R-5/R-6/R-8 `unverified` (fail closed). R-3: `R3_LIVE_STATUSES` typed against `BusinessOsSubscriptionStatus`; live = status in the list, or a subscription id with `ended_at` null; both modes; an error on either → `unverified`; clearing action = the Stripe dashboard in the mode shown + "In-app cancel arrives with plan payments P-7a". R-4 `not_applicable` with the SA-7 "wire R-4 in the same PR" comment. R-6 takes `decideLocalPrecondition`'s result (no status literal, source-checked). R-7 `deferred`, "Checked at the moment of deletion." R-8: `drift` → applies; `unreadable` / `ambiguous` → unverified |
| T10 | `AdminDeletionPreview.ts`: identity (`identity_error` / `not_found`) → `checkAdminStatus` → R-1/R-2 short-circuit (no `buildPurgePreview`, no reconciler, no billing read) → `buildPurgePreview` unchanged at `purge` + `{integrations: true, agents: true, activityHistory: false}` → reconciler → billing (test, live) → Connect → local blocking, sequential. Areas grouped by descriptor `area`; `keptTables` = `never` descriptors with a tenant scope; its own limitations (unknown counts, caps, missing `never`, Purge preview-only, delete function not installed). Business name from `BusinessProfileRepository.findByUserId` (`company_name`), display only: an unreadable profile is a limitation, never a refusal. Logs: ids, statuses, counts |
| T11 | Route as planned. `requireAdmin` is the literal **first statement** (before the correlation id, as the `business-os/credits/accounts/[accountId]` precedent), so the gate's own log lines carry no correlation id |
| T12 | Route test, 17 cases. `adminGate.writes` 59 → 60 with the "read-only POST (body must be `{}`); listed for the gate oracle" comment. B-1 scan extended to `app/api/admin/users/[id]/deletion/**`, with a non-vacuity check by name |
| T13 | Billing callers allow-list + `AdminDeletionPreview.ts`, `adminDeletionRefusals.ts` (type import) and their tests. No entitlements import (source-checked). `npm run test:bos-entitlements`: 181 suites / 4,623 green. `npm run test:authz-guard`: 119 green |
| T14 | Census re-measured with the guard's own `scanHandlers` + `stripComments`: **94 / 88 + 6 + 0 open / 65 files**. The base already held 93: `business-os/ai-activity/drill-down#GET` (B2a, `5457e520`) was gated but unregistered, so it took row **96** (doc only) and this route is row **97**, not 96 |
| User-added audit row | `BUSINESS_DELETION_PREVIEWED` registered in `lib/audit/events.ts` (`info`, SOC2) and `eventAudience.ts` (`bos`; pin 33 → 34, 178 → 179). Written through `logAndFlush` (bounded, never rejects, plus a `.catch`) on 200, 404 and 500 after a valid request; never on 401 / 403 / 400. Details: `correlationId`, `outcome`, `targetId`, `counted`, refusal `id:status` codes, `deletionAvailable`; no email or name. **Deviation:** written with the admin as `user_id` and `actor_id` (entity `user`, id = the target), the `archive_run` / `bos_queue` precedent, **not** as an `operator`-class row. A true `operator` row needs a new owner-hidden entity type plus an `ALTER POLICY` migration (the `ownerVisibility` guard pins the policy's list to the registry), and this slice may not add a migration without SA approval. The row never lands on the owner's account, so the owner cannot read it. Upgrade path: AD-2's deletion entity type and migration |
| AD-1a follow-ups | Reconciler `{data: null, error: null}` → `unreadable` test added. Baseline `generated` 2026-09-16 → 2026-10-04 |
| Not done here | `app/admin/users/types.ts` untouched: the dialog payload types are AD-1c's T16 (a structural copy of `AdminDeletionPreview`) |

**AD-1b test run:** `npx jest lib/business-os/purge lib/repositories/__tests__ lib/services app/api/admin app/admin/users lib/admin/__tests__ lib/audit` → 167 suites / 3,748 tests green. Scoped `tsc` over the 16 touched TS files: 0 errors in them (35 pre-existing errors in transitively loaded files, none touched). ESLint on the touched files: 0 errors (the warnings are pre-existing `any`s in the AdminAccessService test and one in `events.ts`).

### AD-1c: Dialog
- [x] **T16** ✅ `types.ts` payload types and `deletionCopy.ts`: area labels, kept categories with reasons, a clearing action per refusal. The R-3 action points to the plan cancel (see Risk 3), R-5 to "Disconnect Stripe (available with AD-4)", R-6 to the C1/C2/C3 items to resolve, R-8 to "platform problem, not this business: contact engineering".
- [x] **T17** ✅ `DeleteBusinessDialog.tsx`:
  - Header: business name, email, user id, joined date.
  - Area counts, with "unknown" shown as unknown and never as 0. Storage counts.
  - The kept list. The refusals list (every status shown, R-4 "Not applicable").
  - A technical `<details>` expander. `aria-live` blocked state. No input. The disabled confirm with "Deletion not yet available: [reason]".
  - Loading and error states. An error shows a sentence, never a raw message.
- [x] **T18** ✅ `page.tsx`: a separated danger area (border plus a heading) at the bottom of the expanded row, holding a "Delete…" button that opens the dialog. It is not in the collapsed row (FR-A1).
- [x] **T19** ✅ Source guard additions and the render test.
- [x] **T20** ✅ ESLint on the touched files, the touched suites, scoped `tsc`. Hand to SA, then to QA for the manual prod check (AC-A2).

| Task | Implementation note (AD-1c, 2026-10-05) |
|---|---|
| T16 | `DeletionPreviewPayload` and friends appended to `types.ts` (no import). **Added** `lib/business-os/purge/__tests__/adminDeletionPreview.wireTypes.test.ts`, the `adminCreditPosition.wireTypes` precedent: the payload and the area union are assignable both ways. Verified to fail with `TS2344` on a planted drift. Jest does not type-check, and `lib/business-os/purge/` is **not** in `typecheck:bos-llm`'s SCOPED_DIRS, so in CI only the full type-check job enforces it. `deletionCopy.ts`: area labels, refusal titles, status labels (text, not colour alone), the five fixed kept categories, error sentences, count formatting |
| T16 deviation | Clearing actions are **not** duplicated in `deletionCopy.ts`. The server already sends one per refusal (`adminDeletionRefusals.ts`), including the SA-ruled R-3 Stripe-dashboard wording, so the dialog renders `clearingAction` as sent. A second copy could drift from it. A clearing line is shown for blocking statuses (`applies`, `unverified`) only |
| T17 | Radix `Dialog` with the `CreditFormDialog` dark overrides. Fetches only while open, aborts on close, and refetches on every open and on "Try again". One `role="status" aria-live="polite"` region is mounted for the dialog's whole life: it says loading, then "Deletion not yet available: <reason>". The confirm `Button` is literally `disabled` with no `onClick`, and its `aria-describedby` points at that region. Errors use `role="alert"` and a sentence keyed by the route's error code; `details`, raw messages and a table's count `error` are never rendered. Section order: target, refusals, removed, kept, limitations, technical `<details>` (tables, kept tables with notes, schema status, correlation id) |
| T18 | Danger area (rose border, heading, one sentence, "Delete…" button) is the last block of the expanded row, after the audit trail. `deleteDialogUserId` state on the page, so only one dialog is open. The terminate-removal comment now points at this flow. The page is not localised (English only), so no RTL work was needed |
| T19 | Render test: 13 cases (POST `{}` once, nothing while closed, loading, target, counts with unknown, technical and kept, every refusal with clearing action and R-4 not applicable, disabled confirm described by the status region, no input, R-1 not counted, 500 / 404 / network errors, retry). Source guard: both new files in `SCREEN_FILES`, plus a dialog block (one URL = the preview route, one `fetch`, POST `{}`, no `commit` or `token`, no input element, confirm `disabled` without `onClick`, no `dangerouslySetInnerHTML`, the dialog only inside the expanded row's danger area) |
| AD-1b follow-ups | `readLocalBlocking` returns the fixed reason "the read failed" and logs the error (ids only) instead of putting `err.message` in R-6 (QA Low-1), with a new composition test. Comment moved above `.catch` in the route. One-line comment: the business name is read before R-1 / R-2 on purpose, for the dialog header |

**AD-1c SA/QA fixes (Dev, 2026-10-05):**
- [x] ✅ SA Medium: `lib/business-os/purge/__tests__/adminDeletionPreview.wireTypes.test.ts` (that one file, not the purge directory) added to `SCOPED_DIRS` in `scripts/typecheck-bos-llm.ts`; the test's header now names `typecheck:bos-llm` as the enforcer. Proven: planted `resetLive: boolean` in `app/admin/users/types.ts` → the gate reports `TS2344` on the pin; restored (`cmp` byte-identical) → `passed`, 0 new. Runtime 114.4 s / 1m59 wall before → 112.5 s / 1m57 wall after (419 → 420 files in scope; inside noise, no added time)
- [x] ✅ SA/QA Low: the disabled confirm's reason is never empty. Loading: "Loading the deletion preview… Deletion not yet available: the preview has not loaded yet." Error: "Deletion not yet available: the preview could not be loaded." Both tested
- [x] ✅ QA Low: R-2 `unverified` render case added
- [x] ✅ QA Low: distinct close names. The footer button is now "Close preview". The corner "Close" belongs to the shared `components/ui/dialog.tsx` primitive and is unchanged, because renaming it there would change every dialog in the app. Tested: exactly one "Close" and one "Close preview"
- [x] ✅ QA Low: limitations use an index-qualified key
- Re-run: affected suites 23 / 783 green; `typecheck:bos-llm` passed; ESLint 0 errors (one pre-existing unused-import warning in `typecheck-bos-llm.ts`)

**AD-1c test run:** `npx jest app/admin/users app/api/admin/users lib/business-os/purge app/api/admin/__tests__/adminGate` → 23 suites / 781 tests green. Scoped `tsc` over the 10 touched or new TS files: 0 errors. ESLint on them: 0 errors; the 9 warnings are pre-existing in `page.tsx`. No `console.*` in any touched file. `npm run test:bos-entitlements` not run: no file touched imports the entitlements module.

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

**Code Review by SA, 2026-10-04 (AD-1b)** (uncommitted diff in worktree `neuronforge-admin-delete`, branch `feature/admin-delete-ad1b-preview-route`, base `0db9da62`)
**Status:** ✅ Code Approved

### Code Review Comments
1. Deviation 1, the audit row is not operator-class: **accepted for AD-1b.** I checked the owner read paths as built. The latest owner policy (`20261035`, `ALTER POLICY "Users can view their own audit logs"`) is `auth.uid() = user_id AND entity_type NOT IN (...)`. `AuditTrailRepository.listOwnerEntries` and the data-export reader are both `.eq('user_id', …)`. The row's `user_id` is the admin, so the target owner cannot read it on any path. The entity type `entity_type='user'`/`entity_id=target` hides nothing, and it does not need to. This is the same as the `archive_run` / `bos_queue` precedent. The details carry ids, statuses and refusal codes only, with no email or name. **AD-2 does not need a new entity type or migration for this event.** AD-2 must rule separately on where its *destructive* rows land, because the target account is gone after the delete. Caveat: the base `CREATE POLICY` is not in the migrations folder (it was created in the dashboard), so "no other SELECT policy on audit_trail" is assumed, not proven from the repo. Priority: none (accepted)
2. Deviation 2, register rows 96 and 97: **accepted.** Row 96 (`ai-activity/drill-down#GET`, gated on main but unregistered) is a doc-only correction. The census 94 = 88 + 6 + 0 open across 65 files is consistent in the headline, "What is true", the register heading, the summary line and Change History. The SA re-ran `npm run test:authz-guard`'s suite and it is green. The CI job runs only that suite, so the required check stays green. No cap moved and no exemption was added. `adminGate.writes` went 59 → 60. Priority: none
3. Deviation 3: when `checkAdminStatus` returns `null`, R-2 is `unverified`. That status is blocking, so `identityRefused` is set and R-3…R-8 are `not_evaluated`, with no purge preview and no reconciler. This is correct fail-closed behaviour under SC-3 (do not enumerate an account that may be an admin). It is tested. Priority: none
4. Deviation 4, `types.ts` untouched: accepted. AD-1c owns it. Priority: none
5. `route.ts:60`: `requireAdmin` is the first statement. After it, the order is uuid (400, lower-cased), then the text body (empty → `{}`, malformed → 400), then `z.object({}).strict()`, then the composition. A 401 or 403 comes before any validation, read or audit (route tests plus `adminGate.writes`). Identity read error → 500 `identity_read_failed`, never a 404. Priority: none
6. `AdminAccessService`: there is one private resolver, `resolveAdminMatch`, behind both `isAdmin` and `checkAdminStatus`. `isAdmin` keeps its self-heal, its env warn and its fail-closed `false`. `checkAdminStatus` never writes and logs ids only. The existing tests have **0 deleted lines** against `0db9da62` (82 lines added only). Priority: none
7. SC-9: `AdminDeletionPreview.test.ts` spies on every destructive repository method, plus `writeVerifiedSnapshot`, `evaluateResetGuard` and `executeReset`, and asserts that none is reached. It also scans the source for advisory locks. The only RPC is the preview's existing null-id probe (D-2). Condition 3 is tested: with an unreadable reconciler, R-8 is `unverified` and the counts and other refusals still render. Conditions 1 and 2 are met. Priority: none
8. SC-10 and logging: the route, the composition, the repository and the service log ids, statuses and counts only. Each has a test asserting that no logger argument contains the email or business name. The audit uses bounded `logAndFlush` with a defensive `.catch`, and a test proves an audit failure does not fail the preview. Pino throughout. No `console.*` in any touched file (the grep hits in `adminDeletionRefusals.ts` are the words "admin console." inside strings). Priority: none
9. Event registration is consistent: `AUDIT_EVENTS`, `EVENT_METADATA` (`info`, SOC2) and `AUDIT_EVENT_AUDIENCE` (`bos`), with the pin moved to 179 / 34 bos. Further condition 6 ("no audit row in AD-1") is superseded by the user-added scope, which is correct. Priority: none
10. Verified by SA: `npx jest` over the authz guard, the deletion route, `lib/business-os/purge`, `AdminAccessService`, `lib/audit`, `adminGate.writes`, `AuthAccountRepository` and its callers guard gives 25 suites, 818/818. The SA did not re-run tsc or eslint, so Dev's scoped passes stand and the required type-check job is the gate. Priority: Low

### Optimisation Suggestions
- `AdminDeletionPreview.ts`: `readBusinessName` runs before the R-1/R-2 short-circuit, so it also reads an admin target's profile. It is display only and harmless. Moving it after the check, or keeping it deliberately for the dialog header, are both fine. Add a one-line comment saying which was intended.
- `route.ts:115`: the `// logAndFlush never rejects…` comment sits inside the argument list. Move it above the `.catch` for readability.
- For AD-2: when it adds the destructive event, pick its `user_id` placement (admin, like this row, or an operator-hidden entity type plus an `ALTER POLICY` migration) in the workplan, before code is written.

### Code Approved for QA: Yes
Do not commit until the user has seen the diff.

**Code Review by SA, 2026-10-05 (AD-1c)** (uncommitted diff in worktree `neuronforge-admin-delete`, branch `feature/admin-delete-ad1c-dialog`, stacked on AD-1b / PR #220)
**Status:** 🔄 Fix Required (one Medium; approved for QA in parallel, merge waits on the fix)

### Code Review Comments
1. Deviation 1, the dialog renders the server's `clearingAction`: **accepted.** `adminDeletionRefusals.ts` stays the single source of the SA-ruled R-3 wording, so the copy cannot drift between API and UI. The render test pins the R-3 text. It is shown only for blocking statuses, which is correct. Priority: none
2. Deviation 2, the wire-type pin: **not accepted as stated.** There is **no full-project type-check job in CI.** `build.yml` runs `next build` with `typescript.ignoreBuildErrors: true`, and the only `tsc` gate, `Type check (Business OS LLM attribution)` (required), checks only `scripts/typecheck-bos-llm.ts`'s scope: `SCOPED_DIRS` (llm, usage, entitlements, credits), catalog importers, attribution tests, barrels, and one level of callers. `adminDeletionPreview.wireTypes.test.ts` is in none of these, so a drift between `app/admin/users/types.ts` and `AdminDeletionPreview` is caught by **nothing** in CI. The test's header comment ("the CI type-check job's full-project pass") is wrong. **Fix:** add the file path (`'lib/business-os/purge/__tests__/adminDeletionPreview.wireTypes.test.ts'`) to `SCOPED_DIRS` with a comment, following the `credits/` / `creditReport.wireTypes` precedent (`startsWith` matches a file path). Do not add all of `lib/business-os/purge/`, which would pull unrelated baseline into the gate. Correct the test's header comment. Prove it: plant a one-field drift in `types.ts`, run `npm run typecheck:bos-llm`, see `TS2344`, revert. The gate already runs on every non-docs PR, so this adds no CI time. Priority: **Medium** (blocks merge)
3. Deviation 3, R-6 thrown read → fixed "the read failed": **accepted.** `err` goes to Pino with ids only. The test asserts the raw message is absent from the whole serialized preview. The `decideLocalPrecondition` "unreadable" reason lists table names only, which the technical expander shows anyway. Priority: none
4. SC-9 and FR-A3: no destructive path exists. One `fetch`, to the preview route only, POST `{}`. No input, textarea, select or checkbox. The confirm button has a bare `disabled`, no `onClick`, and `aria-describedby` the status region. All of this is pinned by the source guard. No `commit` or `token` appears in either new file. Priority: none
5. Error handling: an error shows only `deletionErrorSentence(code)`, mapped from the known codes, with a generic fallback. `details` and per-table `error` are never rendered. Network failures and non-JSON responses are caught. Server text is rendered as text only, with no `dangerouslySetInnerHTML` (guarded). Priority: none
6. Boundaries: `DeleteBusinessDialog.tsx` is `'use client'` (guarded). Both new files are in `SCREEN_FILES`, so the guard against `lib/business-os` and repository imports and the `console.*` guard apply. They import only `components/ui` and local `types`/`deletionCopy`. The page imports only the component. Priority: none
7. `DeleteBusinessDialog.tsx`: in the **error** state the `role="status"` region is empty, so the always-disabled confirm button points at an empty description. "Confirm always disabled with a reason" is only half true there. Give the error and loading states a reason too (for example `unavailablePrefix` + "the preview could not be loaded"), or keep the region's text non-empty in every state. Priority: Low
8. Accessibility (SC-12): Radix traps focus, closes on Esc and restores focus to the "Delete…" button. Title and description are wired. One persistent polite live region, plus `role="alert"` for errors. Status is shown as text, not colour alone. A stale response is dropped through `AbortController`, and the request is aborted on close. Tokens: the `!`-overrides on the dark slate palette follow the `CreditFormDialog` precedent, because the admin shell lacks `--v2-*`. The danger area matches the page's rose/slate panels. Priority: none
9. AD-1b carry-overs are closed: the `readBusinessName` intent comment is present, and the `logAndFlush` comment was moved (a whitespace-only change to the route). Priority: none
10. Verified by SA: `npx jest app/admin/users` plus `AdminDeletionPreview` and the wire-types test give 12 suites, 265/265. ESLint on the 3 new or changed screen files is clean. SA did not run tsc. Priority: Low

### Optimisation Suggestions
- `schema.missingNever` is in the payload but not in the technical expander, while `unclassified` and `missingDeletable` are. Either show it or say in a comment why it is left out.
- `deletionPreviewUrl` is exported only to be called internally. If no test imports it, make it module-private.

### Code Approved for QA: Yes (in parallel). Merge is conditional on comment 2, and comment 7 is recommended. Do not commit until the user has seen the diff.

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

---

**QA — 2026-10-04 (AD-1b)**
**Test mode:** full (for the AD-1b scope)
**Strategy used:** A + B (Jest). The unit suites cover the evaluator, `checkAdminStatus` and `findUserIdentity`. The composition suite runs the real `buildPurgePreview`, reconciler, `decideLocalPrecondition` and evaluator over spied repositories. The route suite and the shared `adminGate.writes` oracle cover the route. QA also read the route, composition, evaluator, service and repository diffs against each check below.
**Focus:** api, security (gate order, tenant isolation, no destructive call, no PII in logs or audit)
**Skipped:** the live smoke (Option C/D). An admin-cookie call to the local dev server is not trivially possible from this session, and the brief forbids hitting prod or writing to any DB. AD-1c's UI criteria (rendered AC-A2/A3) are not in this slice
**Input source:** prompt from TL

### Test Coverage
| Acceptance Criterion / check | Tested? | Result | Notes |
|---|---|---|---|
| AC-A1: 401 when signed out, 403 for a non-admin, before any work | ✅ | Pass | Route test: 401/403 with nothing built and no audit row. 403 even with an invalid id, so the gate answers before validation. `adminGate.writes` (60 cases) proves nothing is touched before the gate. `requireAdmin` is the first statement (`route.ts:62`) |
| AC-A2 (code half): counts + kept list, deletes nothing | ✅ | Pass (code half) | Composition happy path: `counted: true`, areas grouped with no `unassigned`, an uncounted table shown as unknown (never zero), `keptTables` includes `email_unsubscribes` / `user_preferences`. `executePurge`, `removeStorageUnderUser`, `writeSnapshot`, `readAllRows` and `writeVerifiedSnapshot` are spied to throw, and none is reached. A source scan also covers `evaluateResetGuard`, `executeReset` and advisory locks. The only RPCs on the path are the existing null-id probe (D-2) and `purge_schema_introspect` (read-only). **Live half (a seeded business, row counts identical before and after) is owed** with AD-1c's manual check |
| AC-A3 (API half): R-1, R-2, R-3, R-5, R-6, R-8 each `applies` with a clearing action; R-4 always `not_applicable` | ✅ | Pass | Evaluator suite: one case per refusal, all returned together in order (SC-4). R-4 has the fixed message and the SA-7 comment. R-7 `deferred` ("Checked at the moment of deletion"). Confirm-input absence is AD-1c |
| AC-A4: non-UUID id → 400 before any lookup; body with `userId` → 400 | ✅ | Pass | Route test: non-UUID, `{"userId":…}`, malformed JSON and a non-object body all give 400 with no build call and no audit. An empty body and `{}` are accepted. The id is lower-cased |
| Happy path: non-admin target → 200 with counts, kept list, refusals | ✅ | Pass | Route 200 (built for the lower-cased path id and the gate's admin) + the composition happy path above |
| Target = self → R-1 | ✅ | Pass | R-1 applies case-insensitively, `counted: false`, no purge preview and no reconciler. Route returns 200 |
| Target = admin → R-2 | ✅ | Pass | `counted: false`, nothing enumerated |
| Admin status unknown → R-2 `unverified`, no counting | ✅ | Pass | `checkAdminStatus` returns `null` on a cache read error (unit test). Composition: R-2 `unverified`, R-3…R-8 `not_evaluated`, `buildPurgePreview` not called. With `email: null`, the bound id still decides |
| Identity read error → 500, never 404 | ✅ | Pass | Repository: only a 404 or `user_not_found` gives `null`. Any other error, a throw, or "no user and no error" is an error. Composition returns `identity_error`, and the route answers 500 `identity_read_failed` |
| Reconciler unreadable → R-8 `unverified`, preview still returns | ✅ | Pass | Both the unreadable case and the throwing case are tested. Counts and the other refusals still render |
| Other failed reads fail closed | ✅ | Pass | A billing error in either mode, a Connect throw and a null local count each give `unverified`. A live subscription in either mode gives R-3 `applies` and becomes the disabled reason. An unreadable business profile is a limitation, not a refusal |
| No destructive method or RPC | ✅ | Pass | See AC-A2. `checkAdminStatus` never calls `bindUserId` (unit test). `isAdmin`'s existing tests pass unmodified |
| Audit failure doesn't fail the request | ✅ | Pass | A rejected `logAndFlush` still gives 200. One `BUSINESS_DELETION_PREVIEWED` row on 200, 404 and 500, none on 401, 403 or 400. The admin is `user_id` and actor, so the row never lands on the owner's account |
| No email or name in logs or audit | ✅ | Pass | Planted email and business name are absent from every logger argument (route, composition, repository, service env path) and from the audit details |
| Tenant isolation: target only from the path | ✅ | Pass | `z.object({}).strict()` body. Billing read for `[TARGET,false]`, `[TARGET,true]` only |
| `new-api-route` skill minimum (happy + 401 + 400) | ✅ | Pass | Present, plus 403, 404 and 500 |
| `new-repository` skill (a unit test per new method) | ✅ | Pass | `findUserIdentity`: found, 404, error, throw, no-user, no email in logs |
| Entitlements registration | n/a | — | The diff imports nothing from `lib/business-os/entitlements/` (the only hit is a comment in `adminDeletionRefusals.ts`), so `test:bos-entitlements` was not required. Dev ran it green |
| No `console.*` | ✅ | Pass | 0 in every touched source file (the two grep hits are the words "admin console" inside strings) |

### Issues Found

#### Bugs (must fix before commit)
None.

#### Performance Issues (should fix)
None. The read path is sequential, but each read is cheap and runs only when the dialog opens.

#### Edge Cases (nice to fix)
1. **R-6 could echo a raw error message to the client** — File: `lib/business-os/purge/AdminDeletionPreview.ts` (`readLocalBlocking`) — Severity: Low. If `countLocalBlockingState` threw, `err.message` would go into the R-6 refusal `message` in the 200 response with no dev-only guard. Today that path cannot be reached: the repository catches per condition and returns `count: null`, and `decideLocalPrecondition`'s reason holds table names only. The surface is also admin-only. A fixed string would make it robust.
2. **`checkAdminStatus` falls back to a stale cache when the reload fails** (pre-existing `getCache` behaviour). When a stale cache exists, a read error gives `false` and not `null`. This is acceptable for a read-only preview. Workplan Risk 5 already requires AD-2 to use a fresh, uncached read before commit. Severity: Low, already tracked.
3. SA's optimisation notes still stand (the `readBusinessName` ordering comment and the comment position at `route.ts:117`). Both are cosmetic.

### Test Outputs / Logs
```text
npx jest lib/business-os/purge lib/services/__tests__/AdminAccessService lib/repositories/__tests__/AuthAccountRepository
  lib/repositories/__tests__/authAccountRepository.callers lib/repositories/__tests__/BusinessOsBillingAccountRepository
  lib/audit app/api/admin/__tests__/adminGate.writes app/api/admin/users
Test Suites: 29 passed, 29 total
Tests:       779 passed, 779 total

npm run test:authz-guard
Test Suites: 1 passed, 1 total
Tests:       119 passed, 119 total

npm test (full, worktree)
Test Suites: 11 failed, 8 skipped, 831 passed, 842 of 850 total
Tests:       122 failed, 65 skipped, 16639 passed, 16826 total
All 11 failing suites are in .github/ci/jest-quarantine.json (v4-generator, LogicalIRCompiler, v6 validation,
IRToNaturalLanguageTranslator, IntentClassifier, TokenBudgetManager, ConditionalEvaluator x2, StructuredTransforms x3).
0 non-quarantined failures.
```

Hygiene: no DB was written and prod was not called. `git status --porcelain`, the hash of the code diff and the hashes of the untracked files are identical before and after QA, apart from this report section. No stash, no commit.

### Final Status
- [x] All acceptance criteria pass — ready for commit (AD-1b scope: AC-A1, AC-A2 code half, AC-A3 API half, AC-A4. The live half of AC-A2 and the rendered AC-A3 are owed with AD-1c. The AC-A5 prod re-run is still owed before merge)
- [ ] Issues found — Dev must address before commit

---

**QA — 2026-10-05 (AD-1c)**
**Test mode:** full (for the AD-1c scope)
**Strategy used:** A (Jest: the render test, the source guard, the wire-type pin, and the purge and preview-route suites), plus scoped `tsc` with two planted drifts, plus a **temporary** behaviour test. That test was written to the scratchpad, copied into `app/admin/users/__tests__/` for one run, then deleted. It covers close, reopen, Esc, outside pointer, the corner X and focus. QA also read the dialog, copy, page and route diffs against each check.
**Focus:** ui, security (read-only, no raw errors), schema (wire types)
**Skipped:** D (browser). It needs an admin session, and the brief forbids calling prod or writing to any DB. The visual checks still owed are listed below
**Input source:** prompt from TL

### Test Coverage
| Acceptance Criterion / check | Tested? | Result | Notes |
|---|---|---|---|
| FR-A1: the "Delete…" button is in the expanded row only | ✅ | Pass | Source guard: one `<DeleteBusinessDialog`, inside `data-testid="danger-area"`, after `{isExpanded && (`. The open button is inside the danger area too. QA read the page: the danger area is the last block of the expanded `<tr>`, which has no `onClick` of its own, so clicks inside the portalled dialog cannot bubble into a row toggle. The open button calls `stopPropagation` |
| Loading state | ✅ | Pass | The status region says "Loading the deletion preview…", the confirm button is disabled, and no body renders (render test) |
| Error state: generic sentence only | ✅ | Pass | 500 with `details` → the generic sentence. Neither the raw `error` nor `details` is rendered. 404 → "no longer exists". A network throw → generic. `role="alert"`. QA's temp test: `identity_read_failed` + a `details` string → generic sentence, neither string in the DOM. Every error code the gate and route emit is mapped or falls back to the generic sentence (`Unauthorized`, `Forbidden`, `invalid_user_id`, `user_not_found`, and the rest go to generic) |
| Refusals list: all 8, R-4 "Not applicable", R-2/R-8 unverified, clearing actions from the server | ⚠️ | Pass, with one gap | Render test: 8 items, R-3/R-5/R-6/R-8 clearing lines, R-8 `unverified` label, R-4 "Not applicable", R-7 deferred, no clearing line on a clear refusal. **R-2 `unverified` has no render case.** By reading, it takes the same generic path as R-8 (`DELETION_STATUS_LABELS.unverified`, blocking style, clearing line), so it is low risk |
| Counts: unknown is never 0; storage; the server's count error is never shown | ✅ | Pass | `area-scheduling` reads "unknown", not "0 rows". The "permission denied" count error is absent from the DOM |
| Confirm is always disabled, with the reason | ✅ | Pass | Literal `disabled`, no `onClick` (source guard). `aria-describedby` points at the `role="status"` region, which reads "Deletion not yet available: <reason>" (render test). It is disabled in the loading, error, ready and R-1 states. See Edge Case 1 for the error state |
| No typed-confirmation input | ✅ | Pass | No textbox and no `input/textarea/select` in the rendered dialog. The source guard forbids those tags |
| No call to any non-preview endpoint | ✅ | Pass | Source guard: exactly one `/api/` literal (the preview URL), one `fetch(`, POST `JSON.stringify({})`, and no `commit` or `token` in either new file. Render test: one call, to the preview URL, body `{}` |
| Reopen refetches | ✅ | Pass (QA temp test) | A stateful harness: close, then reopen, gives 2 fetch calls, and the first request's signal is aborted on close. "Try again" refetches (render test) |
| Esc, outside pointer (overlay), Close all close it | ✅ | Pass (QA temp test) | Each calls `onOpenChange(false)` and the dialog unmounts. There are **two** buttons named "Close": the footer button and the primitive's corner X (`sr-only` "Close"). Both close the dialog (see Edge Case 3) |
| The disabled confirm is not focus-trapped | ✅ | Pass (QA temp test) | `focus()` on it does not move `activeElement`. It has no `tabindex`, and it is not in the dialog's tabbable set. The other controls (the Close buttons and the `<summary>`) are reachable |
| No `dangerouslySetInnerHTML`; server text rendered as text | ✅ | Pass | Source guard, for both new files |
| Wire types pinned both ways (T16) | ✅ | Pass under scoped `tsc` | Scoped `tsc` over the 10 touched files plus the wire-type test: 0 errors. **Planted drift 1** (area `'activity_history'` renamed in `types.ts`): 4× `TS2344` in the wire-type test, plus `TS2561` in `deletionCopy.ts`. **Planted drift 2** (an extra client field `qaExtra`): `TS2344` in the wire-type test, plus `TS2322` in the render test's payload fixture. Both were restored from a byte copy, and `cmp` shows the file identical. CI coverage of this pin is SA's Medium finding (not re-litigated here) |
| AD-1b follow-ups | ✅ | Pass | R-6 now gives the fixed reason "the read failed" and logs `{ err, targetId }` (new composition test). The route comment has moved. The `readBusinessName` ordering comment is present |
| AC-A2 live half / AC-A3 rendered on a real business | ⬜ | Owed | Manual pass, see below |

### Issues Found

#### Bugs (must fix before commit)
None found by QA. SA's open Medium (the wire-type pin is not covered by any CI type-check) stands on its own and is not duplicated here.

#### Performance Issues (should fix)
None. One fetch per open. An in-flight request is aborted on close.

#### Edge Cases (nice to fix)
1. **In the error state, the confirm's `aria-describedby` points at an empty status region** — File: `app/admin/users/components/DeleteBusinessDialog.tsx` (`statusText` is `''` when `state.kind === 'error'`) — Severity: Low. A screen reader user on the disabled confirm hears no reason. This is the same as SA's Low. A fallback such as "Deletion not yet available: the preview could not be loaded" would close it.
2. **No render case for R-2 `unverified`** — File: `app/admin/users/__tests__/deleteBusinessDialog.render.test.tsx` — Severity: Low. The brief names it explicitly. The code path is shared with R-8, so this is a coverage gap, not a defect. One more `refusals({ 'R-2': { status: 'unverified', … } })` case would close it.
3. **Two buttons with the accessible name "Close"** (the footer button and the primitive's corner X) — Severity: Low / cosmetic. Both work. A screen reader lists "Close" twice.
4. `limitations` items use the line text as the React `key`. Two identical lines would warn. Today every limitation string is distinct. Severity: Low.

### Visual checks owed (manual pass, admin session, a non-production or seeded business; no DB write)
1. Expand a row: the rose-bordered "Danger area" is the last block, after the audit trail, and **no** "Delete…" appears in the collapsed row.
2. Click "Delete…": the row stays expanded, and the dark dialog renders legibly on the admin shell (the `!` overrides, with no light-theme fallback).
3. The loading line appears, then the amber "Deletion not yet available: …" box.
4. The header shows the business name, email, user id and joined date (UTC date).
5. Refusal badges: blocking ones in rose with text, clear ones in emerald, the rest in slate. R-4 reads "Not applicable" and R-7 reads "Checked at the moment of deletion". Clearing lines appear on blocking refusals only.
6. Area counts are readable. An unknown table reads "unknown". The storage line shows.
7. The technical `<details>` expander opens and lists the tables, the kept tables with notes, the schema status and the correlation id.
8. Long content scrolls inside the dialog at desktop height (about 1366×768). The footer stays reachable. This is not checked anywhere in Jest.
9. The "Delete business" button looks disabled and cannot be clicked or tabbed to. Tab cycles inside the dialog only.
10. Esc, a click outside, the footer Close and the corner X each close it. Reopening shows the loading state again (a fresh fetch in Network, one POST to `/deletion/preview` and nothing else).
11. Open it on your own account: R-1 blocks and "Not counted" shows. Open it on an admin account: R-2 blocks.
12. AC-A2 live half: the row counts for the seeded business are identical before and after opening the dialog.

### Test Outputs / Logs
```text
npx jest app/admin/users app/api/admin/users lib/business-os/purge app/api/admin/__tests__/adminGate
Test Suites: 23 passed, 23 total
Tests:       781 passed, 781 total

npm run test:authz-guard
Test Suites: 1 passed, 1 total
Tests:       119 passed, 119 total

npm test (full, worktree)                    (270 s)
Test Suites: 11 failed, 8 skipped, 833 passed, 844 of 852 total
Tests:       122 failed, 65 skipped, 16668 passed, 16855 total
All 11 failing suites are in .github/ci/jest-quarantine.json (v4-generator, LogicalIRCompiler,
v6 validation, IRToNaturalLanguageTranslator, IntentClassifier, TokenBudgetManager,
ConditionalEvaluator x2, StructuredTransforms x3). 0 non-quarantined failures.

scoped tsc (10 touched files + adminDeletionPreview.wireTypes.test.ts)      exit 0
  planted area rename  -> TS2344 x4 (wireTypes) + TS2561 (deletionCopy.ts)   restored, cmp identical, exit 0
  planted extra field  -> TS2344 (wireTypes) + TS2322 (render fixture)       restored, cmp identical

QA temp behaviour test (copied in, run once, deleted)
Tests: 6 passed, 6 total   (Close+reopen+abort, Esc, outside pointer, corner X, focus, error sanitising)
```

Hygiene: no DB was written and prod was not called. `git status --porcelain`, the sha256 of the code diff (excluding this workplan) and the sha256 of each untracked file are identical before and after QA. The temp test file is gone. No stash, no commit.

### Final Status
- [x] All acceptance criteria pass — ready for commit, as far as QA is concerned (AD-1c scope, Jest-verifiable half). Commit still waits for SA's open Medium (CI coverage of the wire-type pin), the manual visual pass above, the live half of AC-A2, and the AC-A5 prod re-run before merge
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

| 2026-10-04 | AD-1b implemented (Dev) | T7–T14 on `feature/admin-delete-ad1b-preview-route` (base `0db9da62`), uncommitted. `checkAdminStatus` on one shared resolver, `findUserIdentity`, the pure evaluator R-1…R-8, the `AdminDeletionPreview` composition, `POST /api/admin/users/[id]/deletion/preview`, gate oracle 59 → 60, register rows 96 (drill-down, doc only) and 97 (this route), census 94 / 88 + 6 / 65. The user-added preview audit row is written admin-scoped (operator class needs a migration, flagged). AD-1a follow-ups closed |
| 2026-10-04 | QA (AD-1b) | Pass. Affected suites 29 / 779, authz guard 119 / 119, full npm test 0 non-quarantined failures (11 quarantined red). AC-A1, AC-A2 code half, AC-A3 API half and AC-A4 verified, including fail-closed R-2/R-8, identity error → 500, no destructive call, audit non-blocking and no PII. 2 Low edge cases (R-6 raw error echo, unreachable today; stale-cache `false` already tracked as Risk 5). Live smoke skipped |
| 2026-10-05 | AD-1c code complete (Dev) | Dialog, copy, payload types with a two-way wire-type pin, danger area on the page, render test and source-guard additions. AD-1b follow-ups (QA Low-1, two SA comments) carried. Uncommitted on `feature/admin-delete-ad1c-dialog`, stacked on AD-1b |
| 2026-10-05 | SA code review (AD-1c) | Fix Required (one Medium). Deviations 1 and 3 accepted. Deviation 2 rejected as stated: no CI job type-checks the wire-type pin, so it must be added to `typecheck:bos-llm` scope and the drift proven. SC-9 read-only, no raw errors, client boundaries and a11y verified. Low: confirm's reason is empty in the error state. 265/265 |
| 2026-10-05 | QA (AD-1c) | Pass (Jest half). Affected suites 23 / 781, authz guard 119 / 119, full npm test 0 non-quarantined failures. Wire-type pin fails on two planted drifts and was restored byte-identical. A temp test (deleted) verified reopen refetch, Esc / outside / both Close buttons, and that the disabled confirm takes no focus. 4 Low edge cases (empty reason in the error state = SA Low, no R-2 unverified render case, duplicate "Close" name, limitation keys). Manual visual pass owed |
| 2026-10-05 | AD-1c SA/QA fixes (Dev) | Wire-type pin scoped into `typecheck:bos-llm` (single file) and proven by a planted drift; the confirm's reason is never empty; R-2 unverified render case; footer button renamed to "Close preview"; index-qualified limitation keys. 23 / 783 green, gate passed, runtime unchanged |
