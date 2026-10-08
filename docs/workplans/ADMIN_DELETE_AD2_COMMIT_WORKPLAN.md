# Workplan: Admin delete AD-2 — admin-targeted business delete (Purge level), shipped INACTIVE

> **Last Updated**: 2026-10-06

**Developer:** Dev
**Requirement:** [ADMIN_DELETE_USER_BUSINESS_REQUIREMENT.md](/docs/requirements/ADMIN_DELETE_USER_BUSINESS_REQUIREMENT.md) §5 AD-2, FR-A4…FR-A9, FR-A11…FR-A13, R-1…R-8, AC-A6…AC-A11 (+ AC-A13's ledger half), D13, UD-1…UD-10, SA-3, SA Review Notes "Notes for AD-2"
**Engine:** [BUSINESS_OS_BUSINESS_DATA_PURGE_REQUIREMENT.md](/docs/requirements/BUSINESS_OS_BUSINESS_DATA_PURGE_REQUIREMENT.md) (AC-29, FR-28, D4, D7) · [PURGE_SLICE3_PURGE_LEVEL_WORKPLAN.md](/docs/workplans/PURGE_SLICE3_PURGE_LEVEL_WORKPLAN.md) (3b orchestrator `runPurgeCommit`, controls 5–7, OQ-1 (c)) · parent [business-os-business-data-purge.md](/docs/workplans/business-os-business-data-purge.md) §2.5 (token conditions C-6…C-12)
**Previous slice:** [ADMIN_DELETE_AD1_PREVIEW_WORKPLAN.md](/docs/workplans/ADMIN_DELETE_AD1_PREVIEW_WORKPLAN.md) (D-3 `checkAdminStatus`, Risk 5, SA note on AD-2 audit placement)
**Branch:** `feature/admin-delete-ad2-commit` (worktree `neuronforge-purge-s3`, from `origin/main` @ `4c1b630a`, which contains purge 3b PR #231). AD-2b: `feature/admin-delete-ad2b-dialog`, branched from the AD-2a branch (PR #236, open); its PR targets `main` after #236 merges
**Date:** 2026-10-06
**Status:** **AD-2a Code Complete (Dev, 2026-10-06)** — uncommitted on the branch, awaiting SA code review. **AD-2b Code Complete (Dev, 2026-10-06)** on `feature/admin-delete-ad2b-dialog`, uncommitted, awaiting SA code review + QA. SA workplan review: APPROVED WITH CONDITIONS (below).

## Overview

AD-2 lets an admin on `/admin/users` actually delete one business at the **Purge** level, through the existing purge engine. It adds a signed preview → commit token (AC-29, reusable by purge slice 5), a server-checked typed confirmation, a second full refusal check right before the RPC, admin-owned audit rows, revoking the pending invites the target sent, and a result screen.

**Binding constraint (user decision 2026-10-06).** It ships **INACTIVE**, like purge 3b. The `service_role` key is not rotated, so `purge_business_data` stays in `supabase/held/` and every commit refuses `rpc_not_applied` before anything is snapshotted or deleted. Nothing in `supabase/migrations/` defines or grants it (the I-1 test enforces this). **AD-2 needs no other new database object** (§2.8). One open technical question (T-1, option B) would need one, and it is not recommended.

---

## Table of Contents

1. [Analysis Summary](#1-analysis-summary)
2. [Implementation Approach](#2-implementation-approach)
3. [The split: AD-2a / AD-2b](#3-the-split-ad-2a--ad-2b)
4. [Files to Create / Modify](#4-files-to-create--modify)
5. [Task List](#5-task-list)
6. [Test Plan](#6-test-plan)
7. [AC / FR → Task Traceability](#7-ac--fr--task-traceability)
8. [Risks](#8-risks)
9. [Open Questions](#9-open-questions)
10. [SA Review Notes](#sa-review-notes)
11. [QA Testing Report](#qa-testing-report)
12. [Commit Info](#commit-info)
13. [Change History](#change-history)

---

## 1. Analysis Summary

### 1.1 What is on `main` today (read 2026-10-06)

| Piece | State | What AD-2 does with it |
|---|---|---|
| `lib/business-os/purge/ResetService.ts` `runPurgeCommit` | 3b orchestrator: capability → probe → agents refusal → delete-graph → guard (Connect, C1–C3) → verified snapshot → RPC → storage → audit. **It assumes actor = target**: its audit rows are written with `userId = actorId = target`, `surface: 'internal'`, non-awaited `log()` | Reused, **not forked**. Gains an `actor`, a `surface`, a delegated-audit mode, and a `preCommitGate` hook (§2.4) |
| `lib/business-os/purge/AdminDeletionPreview.ts` | AD-1b read-only composition. **`ADMIN_DELETION_OPTIONS.agents = true`** (SC-2 / D15). The 3b orchestrator now refuses `agents: true` permanently (OQ-1 (c), 2026-10-05), so every admin commit at these options would refuse | `agents` → **false** (§2.6). Its read helpers are extracted so the commit re-evaluates with the **same** code |
| `adminDeletionRefusals.ts` | Pure R-1…R-8, every refusal returned. R-7 `deferred`. R-8 = reconciler only, **does not include the delete-graph verdict** | R-8 also covers the delete-graph status. R-7 becomes real at commit |
| `AdminAccessService.checkAdminStatus` | Tri-state, read-only, **shares the 60 s cache (`CACHE_TTL_MS = 60_000`; corrected per SA) and falls back to a stale cache on a read error** (AD-1 Risk 5, QA Low-2) | Add a fresh, uncached, no-stale-fallback read (§2.5) |
| `app/api/admin/users/[id]/deletion/preview/route.ts` | Mints no token (SA-3: "AD-1 mints no token") | Mints the token when deletion is offerable |
| `app/api/business-os/purge/commit/route.ts` | Internal self-only commit. `resolveConfirmationTarget` lives inside the route. **Logs `email`** in its `warn` before the destructive sequence (against ids-only) | The confirmation lookup is moved into the engine and shared. The email log is removed while the file is open |
| `BusinessOsInviteRepository` | `revokeForAdmin` (one id) and `revokeForIssuerAccount` (one id, inviter-scoped). No bulk revoke by issuer | New `revokePendingForIssuerAccountByAdmin` (§2.7) |
| Audit | `BUSINESS_DATA_PURGED`, `BUSINESS_DATA_PURGE_BLOCKED`, `BUSINESS_DELETION_PREVIEWED` registered. `logAndFlush` is bounded and **never reports whether the row landed** | One new event, admin-owned placement (§2.3) |
| `app/admin/users/components/DeleteBusinessDialog.tsx` | Read-only; the confirm button is always `disabled` | Typed input, commit, progress, result screen (AD-2b) |

### 1.2 Schema facts relied on (`business-os-schema-check`, repo read, no DB access)

| Fact | Source |
|---|---|
| `business_os_invites` has `issuer_kind`, `issuer_account_id`, `revoked_at`, `revoked_by_admin_id`, `revoke_reason`, `redeemed_at`, `claimed_at` | Used by the live repository methods today; `20261012_business_os_invites.sql:24-25` |
| CHECK `business_os_invites_revocation_complete`: a revoked row needs `revoke_reason` of at least 3 characters | `20261012_business_os_invites.sql:61` |
| `business_os_invites`, `business_os_account_lineage`, the billing and credit tables are `never` | SA-6; `descriptors.ts` |
| The RPC lock is `pg_try_advisory_xact_lock(hashtextextended(p_user_id::text, 0))`, so the internal self-purge and the admin purge of the same target **share one lock** | `supabase/held/20260916b_purge_business_data.sql:331-333` |
| The owner reads `audit_trail` only where `auth.uid() = user_id` (minus hidden entity types) | SA's AD-1b code review (policy `20261035`; the base `CREATE POLICY` is dashboard-only, so "no other SELECT policy" is assumed) |

A live read-only re-check of the invite columns is offered to QA (T-QA-1). Nothing in this plan writes to the database.

---

## 2. Implementation Approach

### 2.1 Phase named, and why

This is the purge engine and an admin surface, not the V6 pipeline. The root-cause rule still applies: **deletion logic stays in one orchestrator** (`runPurgeCommit`). The admin surface adds only the things the self surface does not need: a different actor, a token, a fresh admin check and admin-owned audit rows. Nothing is copied from the orchestrator. The slice-0 `no-deletion-paths` guard and the single-orchestrator pins (I-6) must stay green unchanged.

### 2.2 The signed preview token (SA-3, AC-29; built for purge slice 5)

**File:** `lib/business-os/purge/previewToken.ts`, plus `canonicalJson.ts` (C-9). It is surface-agnostic, so slice 5 calls the same `mintPreviewToken` / `verifyPreviewToken` with `surface: 'customer'` and `actorId = targetId`.

| Element | Design | Condition |
|---|---|---|
| Payload | `{ v: 1, surface: 'admin' \| 'customer' \| 'internal', actorId, targetId, level, options (canonical), gateVersion, schemaFingerprint, correlationId, iat, exp }` | SA-3 binding list |
| Key | HKDF-SHA256 from `SUPABASE_SERVICE_ROLE_KEY` with a fixed `info` string (`agentpilot/purge-preview-token/v1`). **No new env var** | C-6 (as approved for the parent plan) |
| Missing or short key | `mint` and `verify` throw `PreviewTokenKeyError`. The commit route answers **500** `token_key_unavailable` with an `error` log; the preview returns `commitToken: null` and the dialog shows "Deletion unavailable: the server cannot sign a confirmation". Never "no token needed" | C-7 |
| Compare | `crypto.timingSafeEqual` with a length guard | C-8 |
| Wire format | `base64url(payload).base64url(hmac)`; `iat`, `exp`, `gateVersion` readable before verifying | C-10 |
| TTL | **10 minutes** (`exp - iat`), checked with a 30 s clock-skew allowance at most | SA-3 (≤ 10 min) |
| `gateVersion` | Compile-time constant `ADMIN_DELETION_GATE_VERSION`, with a comment: bump whenever R-1…R-8, the level or the fixed options change. Bumping voids outstanding tokens | C-11 |
| Fingerprint | `SchemaReconciler`'s fingerprint (AD-1a), recomputed at commit and compared, so a schema change between preview and commit voids the token | SA-3 |
| Logging | Never the token. A short sha256 prefix only | C-12 |
| Verified at commit | signature → `exp` → `v` / `gateVersion` → `surface === 'admin'` → `actorId === gate.user.id` (a token minted for another admin is useless) → `targetId === path id` → `level` and `options` equal the server's fixed values. Each mismatch is a distinct 400/409 code, and a blocked audit row | AC-A6 |

**Honest limits (stated, not glossed):**
- The token binds actor + target + parameters + time, **not a session**. That is the same widening the parent plan recorded for AC-29.
- It is **not single-use**. A replay within 10 minutes re-runs every check and takes the advisory lock. After a completed purge, a replay finds nothing to delete, but it would write a second snapshot. Single-use needs a nonce table, which is a new DB object, so it is not proposed (T-5).
- **The token is only as secret as the `service_role` key.** Today that key is public, so anyone can forge a token. That person can also call the RPC directly, which is why the feature ships inactive. After rotation, the derived key rotates too, and outstanding tokens die (harmless at a 10-minute TTL).

### 2.3 Where the audit rows land (the SA AD-1b question)

The target account's business data is deleted, and in AD-3 its audit rows are anonymised. So rows that record the deletion must not depend on the target account.

| Option | Placement | DB object? | Owner can read? | Survives AD-3 erasure? |
|---|---|---|---|---|
| **A (recommended)** | `user_id = actor_id = admin`, `entity_type = 'user'`, `entity_id = target`, details carry `targetId` | **None** | No: `user_id` is not the owner (same as `BUSINESS_DELETION_PREVIEWED`, the `archive_run` and `bos_queue` precedent, accepted by SA at AD-1b) | Yes, by construction: erasure selects the target's `user_id` |
| B | `user_id = target`, a new `operator`-class entity type `business_deletion` | `ALTER POLICY` migration + `ownerVisibility` registry + pin | No | Only if AD-3's erasure excludes it (AC-A14 work) |

FR-A12 / AC-A10 say "`operator` class". Option A gives the same guarantee (the owner cannot read the row on any path) by placement, with no migration. **BA must reword FR-A12 / AC-A10** to "admin-owned (operator-only by placement)" if SA accepts A (T-1).

**Rows (all admin-owned, `entity_id = target`):**

| When | Event | Severity | Written by |
|---|---|---|---|
| Any refusal at the commit route or composition (token, confirmation, fresh admin, refusal re-check, flag) | `BUSINESS_DATA_PURGE_BLOCKED`, `details.surface: 'admin'` | `warning` | composition |
| Refusal inside the orchestrator (`rpc_not_applied`, graph, guard, snapshot, `already_running` → R-7, `commit_failed`) | `BUSINESS_DATA_PURGE_BLOCKED` | `warning` | composition, from the returned outcome |
| **Write-ahead**: after the pre-commit re-check passes, immediately before the RPC | **new** `BUSINESS_DELETION_STARTED` | `critical` | composition, inside `preCommitGate` |
| Outcome: success, success with storage or invite residue | `BUSINESS_DATA_PURGED`, `details.surface: 'admin'` | `critical` | composition |

Every row carries: actor admin id, target id, business name (in `resourceName` and details; **never in Pino**), level, options, refusal code or gate outcome, both evaluations' refusal codes, counts, snapshot path, timestamps, the preview's correlation id (from the token) and the commit's correlation id (FR-A11).

**Awaited and flushed (WC-7).** Each row goes through `logAndFlush` and is awaited before the response. The write-ahead row is different: it must be **confirmed**, because "we cannot record that we are about to delete" should stop the delete. `logAndFlush` cannot say whether the row landed. **T-2** proposes `AuditTrailService.writeNow(input): Promise<{ written: boolean }>`: the same entry builder and hash, one direct insert, no queue. If it is not written, the gate refuses `audit_unavailable` and nothing is deleted (the snapshot exists and is reported). If SA rejects a new service method, the fallback is `logAndFlush`, documented as unconfirmed.

### 2.4 Orchestrator generalisation (3b `runPurgeCommit`, not forked)

New parameters, each with a default that keeps the internal surface byte-for-byte the same:

```typescript
// sketch only
runPurgeCommit({
  userId,                    // the TARGET; every delete, snapshot and storage call uses it
  actor: { id, email },      // default: { id: userId, email: actorEmail } (internal)
  surface: 'internal' | 'admin',
  level, options, correlationId,
  audit: 'self' | 'delegated',   // 'delegated': write NO rows, return the outcome
  preCommitGate?: () => Promise<{ ok: true } | { ok: false; reason: string; message: string; detail?: unknown }>,
})
```

- **`preCommitGate`** runs after the verified snapshot and **immediately before `executePurge`**. That is where FR-A7's "immediately before the RPC" re-check and the write-ahead row go. If it refuses, the outcome is `precommit_refused` with `snapshotWritten: true`. The snapshot remains; it expires on the 7-day rule. Because it runs after the probe, it **never runs on prod today**, so no write-ahead row is written for a run that cannot happen.
- **`audit: 'delegated'`** lets the admin composition own every admin row (one place, awaited, admin-owned). The internal surface stays `'self'`, unchanged.
- **Snapshot context** becomes `{ surface, actorId }`. The actor's email is no longer put into the admin snapshot.
- New refusal codes: `precommit_refused`, `audit_unavailable`.
- A new hook parameter is a small pattern addition. Rule 7: SA to rule (T-4). The alternative is to rerun the checks before calling the orchestrator, which leaves the snapshot's duration (seconds) between the check and the RPC.

### 2.5 Order of the commit (route + composition)

`POST /api/admin/users/[id]/deletion/commit`, body `z.object({ token: z.string().min(1).max(4096), confirmText: z.string().trim().min(1).max(500) }).strict()`.

| # | Step | Refusal → HTTP, audit |
|---|---|---|
| 1 | `requireAdmin` — **first statement** | 401 / 403, nothing read |
| 2 | Path id: Zod `uuid()`, lower-cased | 400 `invalid_user_id`, before any lookup |
| 3 | Body: text → JSON → strict schema (`userId`, `level`, `options`, any extra key → 400) | 400 `invalid_body` |
| 4 | Token verify (§2.2) | 500 `token_key_unavailable` · 400/409 per mismatch · blocked row |
| 5 | Kill switch `isAdminBusinessDeleteEnabled()` (BQ-1, if adopted) | 409 `admin_delete_disabled` · blocked row |
| 6 | Target identity (`findUserIdentity`) | 404 / 500 |
| 7 | **Fresh** admin re-check, no cache, no stale fallback: the **actor** is still an admin (else 403 `actor_not_admin`), and **R-2** on the target | blocked row |
| 8 | Typed confirmation vs the server's value (business name, else account email; shared `resolveConfirmationTarget`) | 400 `confirmation_mismatch`, zero rows |
| 9 | **Evaluation 1**: every refusal (shared `gatherAdminDeletionFacts` + `evaluateAdminDeletionRefusals`) + fingerprint equals the token's | 409 `refused` with the refusal list · or 409 `schema_changed` |
| 10 | `runPurgeCommit({ userId: target, actor: admin, surface: 'admin', level: 'purge', options: ADMIN_DELETION_OPTIONS, audit: 'delegated', preCommitGate })`: capability → **probe (prod: `rpc_not_applied`, stop)** → agents → delete-graph → guard → snapshot → **gate** → RPC → storage | 409 with the reason · blocked row |
| 10a | `preCommitGate`: **evaluation 2** (fresh R-2, R-3…R-6, R-8, delete-graph, fingerprint) → write-ahead row (confirmed) | `precommit_refused` / `audit_unavailable` |
| 11 | Revoke the target's pending invites (§2.7). Non-fatal: a failure is residue | — |
| 12 | Outcome row (awaited) → 200 `{ success: true, data: result }` | — |

Both evaluations are logged with refusal codes and ids only (FR-A7). R-7 is real at commit: the RPC's `already_running` maps to R-7 `applies` in the blocked row (AC-A11).

**Fresh admin read.** `checkAdminStatus({ id, email }, { fresh: true })` goes through the same private `resolveAdminMatch` with a cache-bypassing loader. A read error returns `null` (→ R-2 `unverified` → refuse), never the stale cache. `isAdmin` and `requireAdmin` are unchanged; their tests pass unmodified (the AD-1 D-3 precedent).

### 2.6 Fixed level and options (SC-2, amended by OQ-1 (c))

`ADMIN_DELETION_OPTIONS = { integrations: true, agents: false, activityHistory: false }`. The user decided on 2026-10-05 that a purge **never** deletes agents. That overrides D15 / UD-7's "delete AgentsPilot agents" on the admin surface. The preview's kept list gains "AgentsPilot agents (a purge never deletes agents)". BA amends D15 / UD-7 / §2 (BQ-2). The AD-1 preview currently previews `agents: true`. Its graph verdict would show REFUSED once wired into R-8, so the fix lands in AD-2a together with the R-8 wiring.

The stale preview limitation "The Purge level counted here is preview-only: its deletion step is not built yet (purge slice 3)" is replaced with the honest live/not-applied line (G-1 precedent).

### 2.7 Revoking the target's pending invites

New `BusinessOsInviteRepository.revokePendingForIssuerAccountByAdmin({ issuerAccountId, adminId, reason, now, claimLeaseCutoff }): RepositoryResult<number>`:
- `UPDATE … SET revoked_at, revoked_by_admin_id = adminId, revoke_reason = <reason>, updated_at` (the composition passes the constant `ADMIN_DELETE_INVITE_REVOKE_REASON` = 'Issuer business deleted by an admin'; the repository refuses a reason under 3 characters; corrected per SA) `WHERE issuer_kind = 'account' AND issuer_account_id = target AND redeemed_at IS NULL AND revoked_at IS NULL AND <noLiveClaim>`. Uses `{ count: 'exact' }` and **no `.select()`**, because UPDATE + `.or()` + `.select()` returns 42703 in prod (memory: PostgREST bug; `mutationOrSelect.guard`).
- An **UPDATE to a status, never a DELETE** (SA-6). The slice-0 guard keeps passing.
- `revoked_by_admin_id` is set, so the admin list reads it as "revoked by an admin", not "by the inviter".
- Invites in a **live signup claim** are skipped and counted. The result says "N invites were mid-signup and were not revoked" (BQ-3).
- Placement: **after** the committed RPC (step 11), so a refused or failed delete leaves invites alone. A revoke failure is reported as residue and recorded in the outcome row (T-3).
- Accepted invites (friends who already joined) are not touched. They are separate logins, and lineage is `never`.

### 2.8 New database objects

**None.** No migration, no new function, no table, no policy:
- the token is stateless (no nonce table, T-5);
- audit placement A needs no policy change (T-1);
- the invite revoke uses existing columns;
- the kill switch is an env flag.

`purge_business_data` stays in `supabase/held/`. **If SA chooses T-1 option B**, it needs one non-destructive migration (`ALTER POLICY "Users can view their own audit logs"` adding `business_deletion` to the `NOT IN` list, plus the registry and pin). That migration is safe to ship active in `supabase/migrations/`, because it only hides rows, and I-1 is unaffected.

### 2.9 Tenant isolation (`tenant-isolation-guard`)

The engine scopes every delete to one id. The new risk is **a wrong id**. The controls:
- the target comes only from the path (Zod `uuid`). The body is strict and carries no id;
- the token binds the target **and** the actor;
- the typed name is compared server-side against the target's own value;
- the identity is re-read at commit;
- R-1 and a fresh R-2 run at both the entry and the gate.

Every engine call takes `userId: target`, and a test pins that `adminId` reaches no repository write. The invite revoke is equality-scoped to `issuer_account_id = target`. Service-role use is documented at each repository call site. Logs carry ids, codes and counts only. The email and business name appear in the response and the audit row, never in Pino.

---

## 3. The split: AD-2a / AD-2b

The full slice is about **4.5 days**, above the ~4-day limit. Each half ships alone and inactive.

| Slice | Scope | Days | Ships alone and inactive? |
|---|---|---|---|
| **AD-2a — Server commit path** | `canonicalJson` + `previewToken`; preview mints the token; options `agents: false`; delete-graph in R-8; shared facts gatherer; shared confirmation lookup; fresh `checkAdminStatus`; orchestrator `actor` / `surface` / `audit: 'delegated'` / `preCommitGate`; `AuditTrailService.writeNow` (if T-2 = yes); `BUSINESS_DELETION_STARTED`; invite bulk revoke; `AdminDeletionCommit.ts` + commit route; kill-switch flag; census row + `adminGate.writes`; tests | ~3 | ✅ The dialog still shows the confirm button disabled (AD-1c is unchanged). The route refuses `rpc_not_applied` (and `admin_delete_disabled` with BQ-1) |
| **AD-2b — Dialog commit + result screen** | Typed-name input (only when no blocking refusal and a token is present, FR-A3), commit call, progress state (NFR), "the server will refuse" line while the function is not applied (G-1 precedent), result screen (FR-A9), row refresh, copy, a11y, source guards | ~1.5 | ✅ Against prod today every attempt ends in a clear, audited "not applied" refusal |

---

## 4. Files to Create / Modify

### 4.1 AD-2a

| File | Action | Reason |
|---|---|---|
| `lib/business-os/purge/canonicalJson.ts` (+ test) | create | C-9 |
| `lib/business-os/purge/previewToken.ts` (+ test) | create | §2.2. Surface-agnostic, for slice 5 |
| `lib/business-os/purge/AdminDeletionCommit.ts` (+ test) | create | Composition §2.5 steps 5–12; admin audit rows |
| `lib/business-os/purge/adminDeletionFacts.ts` | create | Read helpers extracted from `AdminDeletionPreview.ts`, so preview, evaluation 1 and evaluation 2 share one code path |
| `lib/business-os/purge/confirmation.ts` (+ test) | create | `resolveConfirmationTarget` + `normalise`, moved from the internal commit route |
| `lib/business-os/purge/AdminDeletionPreview.ts` | modify | Use `adminDeletionFacts`; `agents: false`; mint the token; `deletionAvailable: boolean`; `confirmKind`; honest limitation lines; `ADMIN_DELETION_GATE_VERSION` |
| `lib/business-os/purge/adminDeletionRefusals.ts` | modify | R-8 includes the delete-graph status; R-7 has an `applies` form for the commit |
| `lib/business-os/purge/ResetService.ts` | modify | §2.4 parameters, defaults unchanged; `precommit_refused`, `audit_unavailable` |
| `lib/business-os/purge/SnapshotWriter.ts` | modify (if needed) | Context `{ surface, actorId }` |
| `app/api/admin/users/[id]/deletion/commit/route.ts` (+ `__tests__/route.test.ts`) | create | `new-api-route` skill; `runtime = 'nodejs'`, `dynamic = 'force-dynamic'`, `maxDuration = 60` |
| `app/api/admin/users/[id]/deletion/preview/route.ts` (+ test) | modify | Returns `commitToken`; the audit row records whether a token was minted (never the token) |
| `app/api/business-os/purge/commit/route.ts` | modify | Import the shared confirmation helper; drop `email` from the Pino `warn` (ids only). No behaviour change; its tests stay green |
| `lib/services/AdminAccessService.ts` (+ test) | modify | `checkAdminStatus(user, { fresh: true })` |
| `lib/services/AuditTrailService.ts` (+ test) | modify (only if T-2 = yes) | `writeNow` |
| `lib/repositories/BusinessOsInviteRepository.ts` (+ test) | modify | `revokePendingForIssuerAccountByAdmin` |
| `lib/audit/events.ts`, `lib/audit/eventAudience.ts` | modify | `BUSINESS_DELETION_STARTED` (`critical`); audience pins +1 |
| `lib/utils/featureFlags.ts`, `docs/feature_flags.md` | modify (if BQ-1 = yes) | `isAdminBusinessDeleteEnabled()`, server-only, default off. Not `use…` (lint:hooks) |
| `app/api/admin/__tests__/adminGate.writes.test.ts` | modify | Add `POST …/deletion/commit` (count +1) |
| `docs/admin/ADMIN_IDENTIFICATION_AND_ACCESS.md` | modify | Register the row; census re-measured with the guard's `scanHandlers`; change history |
| `lib/admin/__tests__/admin-authz-surface.guard.test.ts` | modify only if a cap needs moving | Gated from birth: expected to be a count change, not an exemption |
| `lib/business-os/purge/__tests__/ResetService.order.test.ts` | modify | Admin-surface cases (§6.2) |
| `lib/business-os/purge/__tests__/AdminDeletionPreview.test.ts`, `adminDeletionRefusals.test.ts`, `adminDeletionPreview.wireTypes.test.ts` | modify | Options, R-8 graph, token field, wire types |

### 4.2 AD-2b

| File | Action | Reason |
|---|---|---|
| `app/admin/users/components/DeleteBusinessDialog.tsx` | modify | Input, commit, progress, result screen |
| `app/admin/users/deletionCopy.ts`, `app/admin/users/types.ts` | modify | Copy (result, refusal codes, not-applied line, agents kept); commit wire types |
| `app/admin/users/page.tsx` | modify | Refresh the row after a completed delete ("No Business OS business") |
| `app/admin/users/__tests__/source.guard.test.ts` (+ a dialog guard) | modify | Input only with a token and no blocking refusal; the not-applied line; no `console.*` |

### 4.3 Explicitly NOT touched

`supabase/migrations/**` · `supabase/held/**` (the RPC is unchanged) · `lib/business-os/entitlements/**` (no import, so the entitlements skill does not apply; checked at review) · `components/business-os/purge/DangerZonePanel.tsx` and the customer surface (UD-11) · `auth.users` / `profiles` (AD-3) · Stripe (AD-4).

---

## 5. Task List

### AD-2a
- [x] ✅ **T1** `canonicalJson` + `previewToken` (HKDF key, mint, verify, distinct mismatch codes, key error), unit tests
- [x] ✅ **T2** Extract `adminDeletionFacts.ts` from `AdminDeletionPreview.ts`, with no behaviour change (existing tests green before any other edit)
- [x] ✅ **T3** Preview: `agents: false`; delete-graph verdict into R-8; `ADMIN_DELETION_GATE_VERSION`; mint the token when `counted`, no blocking refusal, a non-null fingerprint and a readable key (and the kill switch on, BQ-1); `confirmKind`; honest limitation lines
- [x] ✅ **T4** `checkAdminStatus(…, { fresh: true })` via `resolveAdminMatch`; `isAdmin` tests unmodified
- [x] ✅ **T5** `confirmation.ts` extracted; internal commit route imports it; email removed from that route's Pino `warn`
- [x] ✅ **T6** `runPurgeCommit`: `actor`, `surface`, `audit: 'delegated'`, `preCommitGate`; internal-surface defaults pinned by the existing order tests (unchanged)
- [x] ✅ **T7** `AuditTrailService.writeNow` (T-2) and `BUSINESS_DELETION_STARTED` registration (+ audience pins)
- [x] ✅ **T8** `revokePendingForIssuerAccountByAdmin` + repository tests (scope, count, no `.select()`, live-claim skipped)
- [x] ✅ **T9** `AdminDeletionCommit.ts` (§2.5 steps 5–12; evaluation 1 and 2; admin-owned awaited rows)
- [x] ✅ **T10** Commit route (`new-api-route` skill) + route tests; kill switch (BQ-1)
- [x] ✅ **T11** Census row + `adminGate.writes` + authz guard green (`npm run test:authz-guard`)
- [x] ✅ **T12** Inactive proofs (§6.3), scoped `tsc`, `eslint`, purge + held + admin suites; `git diff origin/main --stat -- supabase/` empty
- [x] ✅ **T13** Requirement splice (insert-only): AD-2a status in §0 / §5; D15 / UD-7 agents note (BQ-2); FR-A12 / AC-A10 wording (T-1); Change History

### AD-2b
- [x] ✅ **T14** Dialog: typed input (label names the business or email; compared server-side), commit, progress, keyboard and screen-reader states
- [x] ✅ **T15** Not-applied line and unknown-state line (G-1 precedent); refusal code → plain message map
- [x] ✅ **T16** Result screen (FR-A9): rows per area (from snapshot counts, grouped as the preview groups them), storage removed or failed, invites revoked or skipped, what was kept, snapshot reference; row refresh
- [x] ✅ **T17** Source guards; requirement splice for AD-2b

### Post-rotation (not in either PR; owned by the purge T28 sweep plus QA)
- [ ] **AD-3 scope (SA-2, added 2026-10-06):** when AD-3 closes the login, switch `DELETION_KEPT_CATEGORIES` (preferences, activity history, the login) and `DELETION_RESULT_KEPT`'s login line in `app/admin/users/deletionCopy.ts` back to "closed" wording
- [ ] Live on a **throwaway** account after B-1 + B-2: AC-A6…AC-A11, AC-A9's purge AC-2/4/22/23/24, AC-A13 ledger half, invites revoked, write-ahead + outcome rows readable by an admin and not by the owner

---

## 6. Test Plan

All tests are Jest, inside the existing sharded gate. They use no DB, no network and no new workflow, so they add no CI time (milliseconds).

### 6.1 Unit

| Test | Proves |
|---|---|
| `canonicalJson.test.ts` | Key-order independence, nested objects, stable numbers (C-9) |
| `previewToken.test.ts` | Round trip; each field tampered → its own mismatch code; expired; `gateVersion` bump voids; another `actorId`; another `surface`; missing or short key → throws, never verifies (C-7); `timingSafeEqual` length guard (C-8); the token is never in a log call (C-12) |
| `adminDeletionRefusals.test.ts` | R-8 refuses on a graph `refused` / `unreadable`; R-7 `applies` form |
| `AdminDeletionPreview.test.ts` | Options = `agents: false`; token minted only when offerable; none when refused, uncounted, fingerprint null, key missing or flag off |
| `AdminAccessService` test | `fresh: true` bypasses the cache; a read error → `null` even with a stale cache present; `isAdmin` tests unmodified |
| Invite repository test | Equality-scoped to the issuer; `{ count: 'exact' }` and no `.select`; claimed rows excluded; reason ≥ 3 characters (the CHECK) |
| `confirmation.test.ts` | Name, email fallback, whitespace and case normalisation, null when neither exists |

### 6.2 Orchestration (mocked repositories)

| Test | Proves |
|---|---|
| Internal surface unchanged | The existing `ResetService.order.test.ts` passes unmodified (defaults) |
| Admin surface, probe false | `rpc_not_applied`; no snapshot; `preCommitGate`, write-ahead, `executePurge`, storage and invite revoke **never called**; one blocked row, admin-owned |
| Gate placement | Order: snapshot → `preCommitGate` → `executePurge`. Gate refuses → `precommit_refused`, `snapshotWritten: true`, `executePurge` not called |
| AC-A8 | A fact flips between evaluation 1 and evaluation 2 (e.g. a billing row turns `active`) → refused, `executePurge` not called |
| Fingerprint drift | A different fingerprint at evaluation 1 or 2 → `schema_changed`, zero deletes |
| Write-ahead unconfirmed | `writeNow` → `written: false` → `audit_unavailable`, `executePurge` not called |
| AC-A11 | `executePurge` returns `ok: false` → R-7 applies, blocked row |
| Tenant pin | Every `executePurge`, snapshot, storage and invite call receives the target id; the admin id reaches no repository write |
| Audit placement | Every row has `userId = actorId = admin`, `entityId = target`; none has `userId = target`; rows are awaited before the composition returns |
| Invite revoke | Called only after a completed RPC; a failure → residue, outcome still `completed` |

### 6.3 Route (`deletion/commit/__tests__/route.test.ts`)

Covers 401, 403 (with nothing read), 400 (non-UUID, `userId` / `level` / `options` / extra key in the body, malformed JSON), 500 for a missing key (C-7, never a bypass), and a token for another target, another admin, other options or expired (AC-A6). Also: wrong typed name → 400 with zero orchestrator calls (AC-A7); kill switch off → 409; refusal at evaluation 1 → 409 with the list; the happy path (mocked orchestrator `completed`) → 200 with the result shape; and the `development`-only `details` guard.

### 6.4 Inactive proof

| # | Assertion | Where |
|---|---|---|
| I-1 | No migration defines or grants `purge_business_data` | existing `purgeBusinessData.held.test.ts` |
| I-8 | `git diff origin/main --stat -- supabase/` is empty | QA / RM |
| I-9 | Probe false → admin commit reaches no snapshot, write-ahead, RPC, storage or invite call | §6.2 |
| I-10 | `no-deletion-paths` guard and the single-orchestrator pins are unchanged and green | existing |
| I-11 | Kill switch default off → no token minted, commit 409 (if BQ-1) | §6.1, §6.3 |

### 6.5 Manual (QA)

- **AD-2a:** call the commit route on prod as an admin against a throwaway account. Expect a blocked `rpc_not_applied` row (admin-owned), and identical before/after row counts on the target (AC-A2 style).
- **AD-2b:** dialog click-through on prod: the input appears only when no refusal applies; the not-applied line shows; the refusal result renders; keyboard only.
- **T-QA-1:** read-only live check of the invite columns used by T8.

---

## 7. AC / FR → Task Traceability

| Item | Task(s) | Proof before rotation | Live proof |
|---|---|---|---|
| FR-A4 target from path only | T10 | Route 400 tests; tenant pin | — |
| FR-A5 / AC-A6 / purge AC-29 | T1, T3, T10 | `previewToken.test.ts`, route mismatch tests | Post-rotation sweep |
| FR-A6 / AC-A7 | T5, T9, T14 | Route test: wrong name → 400, zero orchestrator calls | Sweep |
| FR-A7 / AC-A8 | T2, T6, T9 | Evaluation 1 and 2 tests; both logged | Sweep |
| FR-A8 (one engine) | T6 | I-10; internal order tests unchanged | — |
| FR-A9 | T16 | Source guard + rendering of a mocked `completed` result | QA click-through |
| FR-A11 | T7, T9 | Audit placement, write-ahead and outcome tests | Sweep: rows exist |
| FR-A12 / AC-A10 | T7, T9 (+ T13 wording) | Every row `userId = admin` (option A) | Sweep: owner session reads none |
| FR-A13 (no email) | T9 | No mail call on the path (source guard) | — |
| AC-A9 (purge AC-2/4/22/23/24) | T6 (engine, 3b) | Tenant pin; run = `descriptorsForRun('purge', ADMIN_DELETION_OPTIONS)` | Sweep (second business untouched) |
| AC-A11 | T6, T9 | `already_running` → R-7 | Sweep: double submit |
| AC-A13 (ledger half) | T3 | Billing / credit / ledger descriptors `never` and absent from the run (existing invariant) | Sweep: totals unchanged |
| R-1, R-2 (fresh) | T4, T9 | Fresh read; actor re-check | — |
| R-3…R-6, R-8 | T2, T3, T9 | Shared facts, both evaluations | — |
| R-7 | T9 | Mapped from `already_running` | Sweep |
| Invites revoked | T8, T9 | Repository + orchestration tests | Sweep |
| OQ-1 (c) on the admin surface | T3 | Options test; kept list | — |
| SA AD-2 notes (WC-7, fingerprint, fresh admin, audit placement) | T7, T9, T4, T1 | As above | — |
| Census / CI guard | T11 | `npm run test:authz-guard` | — |

---

## 8. Risks

| # | Risk | Mitigation |
|---|---|---|
| R-1 | 🔴 Applying the RPC (B-2) also unlocks admin delete of **real** customers before AD-3 (login still works) and before the data export (DX-12) | Kill switch default off (BQ-1), independent of the RPC. Released only by an explicit decision |
| R-2 | The token derives from a key that is public today | Feature inactive. Rotation rotates the derived key. Stated in §2.2 |
| R-3 | A double submit writes two snapshots, because the lock lives in the RPC | One RPC wins (AC-A11). The dialog disables the button in flight. Both snapshots expire after 7 days |
| R-4 | `preCommitGate` failure after a snapshot leaves a snapshot with no delete | Reported (`snapshotWritten: true`), audited, 7-day expiry. This is the same state as slice 2's `commit_failed` |
| R-5 | 60 s budget: snapshot + RPC + storage + two evaluations + invites | Evaluations read no counts (facts only). Measure in the sweep. Storage residue is already non-fatal |
| R-6 | A changed orchestrator signature breaks the internal surface | Defaults. The existing order tests stay unmodified (a test-diff check at review: no `-` lines) |
| R-7 | `writeNow` touches a shared service (the audit hash is **per-entry**, not a chain; corrected per SA) | Same entry builder (`buildLogEntry`). A unit test checks the entry and hash match the queued path. Fallback: `logAndFlush` (T-2) |
| R-8 | A stale AD-1 preview tab predates the token | The commit requires a token, so a stale tab cannot commit. The dialog re-previews each time it opens (AD-1c behaviour) |
| R-9 | Invite revoke races a signup claim | Live claims are skipped and counted (BQ-3). The CAS predicate is in the UPDATE |

---

## 9. Open Questions

### 9.1 Business questions (owner, through BA)

| # | Question | Recommendation |
|---|---|---|
| **BQ-1** | When the key is rotated and the delete function is installed, should admin delete switch on **immediately**, or stay behind its own switch until "close the login" (AD-3) and the data export ship? Otherwise a deleted customer can still sign in, and nothing can be exported first | **Own switch, off**, turned on deliberately. Until then it is test accounts only · ✅ **Answered 2026-10-06: own off switch** (`isAdminBusinessDeleteEnabled()`, server-only, default off, checked before token verify; requirement UD-12) |
| **BQ-2** | The requirement says an admin delete also deletes the business's AgentsPilot agents (D15 / UD-7). On 2026-10-05 the owner decided a purge **never** deletes agents. Confirm the admin delete keeps agents too (they appear in "what is kept") | Keep agents. BA amends D15 / UD-7 · ✅ **Answered 2026-10-06: keep agents** (requirement UD-14, D15 amended) |
| **BQ-3** | Invites the deleted business sent and nobody has accepted are cancelled. What about an invite someone is **in the middle of signing up with**? Friends who already joined are not affected either way | Leave mid-signup ones alone and say how many in the result. Do not touch accepted invites · ✅ **Answered 2026-10-06: leave mid-signup invites alone and report the count; never touch accepted invites** (requirement UD-13) |
| **BQ-4** | FR-A12 asks that the owner cannot read the admin's deletion record. Recording it on the **admin's** account rather than the deleted one gives exactly that and survives "close the login". Acceptable wording change? | Yes (T-1, option A) · ✅ **Answered 2026-10-06: yes, admin-owned rows (T-1 A)** (requirement UD-15; FR-A12 / AC-A10 amended) |

### 9.2 Technical questions (SA)

| # | Question | Dev's recommendation |
|---|---|---|
| **T-1** | Audit placement: A (admin-owned, no DB object) or B (target-owned `operator` entity type + `ALTER POLICY` migration) | A |
| **T-2** | Confirmed write-ahead: add `AuditTrailService.writeNow` (fail closed), or accept `logAndFlush` (WC-7, unconfirmed)? | `writeNow` |
| **T-3** | Invite revoke after the RPC (non-fatal residue) or before it (revoked even if the delete fails)? | After |
| **T-4** | `preCommitGate` hook in `runPurgeCommit` (rule 7, small) vs re-checking before calling it (leaves the snapshot's duration between check and RPC) | Hook |
| **T-5** | Token not single-use (stateless). Accept, given a 10-minute TTL, a full re-check and the advisory lock? A nonce table would be a new DB object | Accept |
| **T-6** | Key: C-6 HKDF from `SUPABASE_SERVICE_ROLE_KEY` (no new env var) still preferred, knowing that key is public until rotation? | Yes. The feature is inactive until rotation |
| **T-7** | `audit: 'delegated'` mode in the orchestrator vs parametrising its own rows with the admin as user | Delegated: one owner of admin rows |
| **T-8** | `checkAdminStatus(…, { fresh: true })` vs `invalidateCache()` + read (shared singleton; another request can refill in between) | `fresh` option |
| **T-9** | Fixing the internal commit route's email-in-Pino while extracting the confirmation helper: acceptable scope? | Yes. One line, ids-only rule |
| **T-10** | Mint the token when the function is **not** applied (so the audited refusal path can be exercised, G-1 precedent), with the kill switch as the real lock? | Yes, if BQ-1 = own switch; otherwise no |

### AD-2a implementation notes (Dev, 2026-10-06)

Order followed: T4 → T2 → T3 → T5 → T1 → T6 → T7 → T8 → T9 → T10 → T11 → T12 → T13 (the preview fixes and shared helpers first, per SA). Nothing was written to any database. Nothing is committed.

| Condition | Where it is met |
|---|---|
| AC2-1 discriminated union, gate required on the admin arm, audit derived | `ResetService.ts` `PurgeCommitParams` (`surface` omitted = internal, unchanged). `ResetService.order.test.ts` has **zero** changed lines; the admin arm is tested in the new `ResetService.adminSurface.test.ts` |
| AC2-2 verdict-only gate, wrapped, `executePurge` once | The gate takes no arguments. A throw or anything but `{ ok: true }` → `precommit_refused`; `reason: 'audit_unavailable'` is honoured. Source pin on `buildPreCommitGate` in `AdminDeletionCommit.test.ts` (only `writeNow`, no repository write) |
| AC2-3 `writeNow` | `AuditTrailService.writeNow` reuses `buildLogEntry`, does one insert on the existing client, never throws, is bounded by `AUDIT_FLUSH_TIMEOUT_MS`, and returns `false` on an error, a timeout or a disabled service. The constant moved to the zero-import `lib/audit/auditTimeouts.ts` (re-exported by `boundedAuditFlush.ts`) so the two modules do not import each other. The event comment says STARTED without PURGED is never "deleted" |
| AC2-4 rows | STARTED and PURGED via `writeNow` (`auditRecorded: false` is surfaced, with an `error` log). Blocked rows via awaited `logAndFlush`. Audience pins 37 → 38 Business OS, 182 → 183 registered |
| AC2-5 token | `previewToken.ts`: HKDF (fixed salt, versioned info); the raw key is never the HMAC key (unit pin); under 32 characters → `PreviewTokenKeyError` → 500. Binds `confirmKind`; `gateVersion` per surface; never logged (`tokenDigest` only). The held README and its copy in the parent workplan carry the rotation line |
| AC2-6 switch before token | `commitAdminDeletion` step 5 precedes step 4. A test proves a missing key still answers 409 `admin_delete_disabled` |
| AC2-7 fresh re-check | `checkAdminStatus(user, { fresh: true })` bypasses the cache AND the stale fallback, and never refills the cache. Actor and target at step 7, and again in the gate. `isAdmin` tests unmodified |
| AC2-8 confirmation fails closed | `confirmation.ts` returns `unverified` on a returned or thrown read error. **Picked and pinned: 500 on both surfaces** (a test was added to the internal route suite) |
| AC2-9 invite revoke | `revokePendingForIssuerAccountByAdmin`: one count-only UPDATE, equality on `issuer_kind` + `issuer_account_id`, `redeemed_at` / `revoked_at` null, `.or(noLiveClaim)`, UUID-checked before any query, sets `revoked_by_admin_id`, no `.select` / `.in` / DELETE. `countPendingForIssuerAccountByAdmin`: a head-only exact count with the same predicate minus the claim filter, read after the revoke |
| AC2-10 preview | `agents: false`; R-8 includes the delete graph; `commitToken` + `confirmKind` on the wire type (`app/admin/users/types.ts` updated so the wire-type check still compiles; the dialog is unchanged and its confirm stays disabled); the audit row gets `tokenMinted` only |
| AC2-11 route | `app/api/admin/users/[id]/deletion/commit/route.ts`. The route test covers 401, 403, every 400, the 500 dev-only guard, 200, refusal mapping, and the REAL composition with the switch in its default state (409, nothing read) |
| AC2-12 census | Row 98. Census re-measured with the guard's own `scanHandlers`: **95 / 89 + 6 + 0 open / 66 files**. `adminGate.writes` 60 → 61. `npm run test:authz-guard` green, no cap moved, no exemption |
| AC2-13 inactive | `git diff -- supabase/migrations` is empty; the `supabase/held` diff is the one README line |
| AC2-14 | Jest only; no DB, network or workflow |

**Choices made where the plan left room (for SA to rule on at code review):**
- Token mismatch status: stale (`token_expired`, `token_version`, `token_gate_version`) → **409**; wrong for this request (`malformed`, `signature`, `surface`, `actor`, `target`, `level`, `options`) → **400**. Also `confirmation_kind_changed` (409) and `confirmation_unverified` (500).
- The kill switch lives in `lib/utils/featureFlags.ts`, as instructed, although that module had no server importers (see `parseBooleanFlag.ts`'s note). Its failure direction is safe: if the module ever stopped being importable on the server, the commit route would answer 500, not delete. Say if it should move to a zero-import server module instead.
- Kept list: one `{ table: 'agents', notes: AGENTS_KEPT_NOTE }` entry (the area, not its 13 tables).
- The orchestrator's refused outcome gains an optional `auditDetail` on the admin arm only. The composition strips it before the response (a test pins this).
- `adminDeletionFacts.readAdminStatus` serves both the target (R-2) and the actor re-check.
- The completed result reuses `commitResultNotes`, which was written for the internal surface. AD-2b may want admin-specific copy.

**Pre-existing, not from this slice:** `lib/utils/__tests__/oneAddressPolicy.guard.test.ts` fails on this Windows checkout (backslash paths against its allow-list; none of the 7 files it lists is touched here). Full `tsc` shows the repo's existing errors and **none in any touched file**; `npm run typecheck:bos-llm` passes (0 new).

---

### AD-2b implementation notes (Dev, 2026-10-06)

| Item | What was built |
|---|---|
| Offered only with a token (FR-A3) | `confirmableValue(preview)`: a `commitToken`, no `applies` / `unverified` refusal, and a non-empty value to type (`confirmKind` → `target.businessName` or `target.email`). Otherwise the AD-1c footer is unchanged: the confirm is hard-`disabled`, described by "Deletion not yet available: <server reason>" (the switched-off reason is already plain words) |
| Typed match | Mirrors the server's `normaliseConfirmation` (trim, collapse spaces, lower-case) in `deletionCopy.ts` (`lib/business-os` is forbidden here). Convenience only: the server compares again. Enter cannot bypass it: `onSubmit` returns early unless `canSubmit` |
| Body | `{ token, confirmText }`. The route is `.strict()` on `confirmText` (AC2-11), so the field is `confirmText`, not `confirmation` |
| Token | Read from the preview held in component state, sent only in the POST body. Source guard: no storage, cookie, URL params, router or logger in the dialog; no URL template mentions a token |
| Progress | Button "Deleting…", input and Close disabled, `aria-busy`, status region announces it; Esc / overlay close are ignored while the request runs |
| Outcomes | **completed** (rows per area grouped by the preview's table → area map, unmapped tables as "Other tables"; storage removed / still stored; invites revoked or "could not be revoked", mid-signup count or "unknown"; a client-side kept list incl. agents; audit yes, or a `role="alert"` NO; snapshot path + correlation id). **refused**: one sentence per code from an exhaustive `Record<DeletionCommitCodeView, string>`, blocking refusal *titles* only, a snapshot-written line, "Reopen the preview" for stale / mismatch / changed codes. **unknown** (a 500, an unknown code, a network failure): "not known whether anything was deleted" — never "nothing was deleted" |
| Never server text | The server's `message`, `details`, `residue`, `kept` and `notes` are not rendered (source guard + render tests with planted raw strings) |
| Row refresh | The page passes `onDeleted={() => void fetchUsers()}`, called when the dialog closes after a completed or unknown outcome. Not on success itself: `fetchUsers` sets `loading`, which unmounts the table and would take the result screen with it |
| Focus | The title receives focus when an outcome renders; the input is labelled (`<Label htmlFor>`) and described by the hint |
| Wire types | `DeletionCommitCodeView`, `DeletionCommitResultView`, `DeletionCommitRefusalView` in `app/admin/users/types.ts`; the existing `adminDeletionPreview.wireTypes.test.ts` (already in `typecheck:bos-llm` SCOPED_DIRS) now also pins the result and the code union both ways. No new SCOPED_DIRS entry, no added CI time |
| Preview copy | The kept categories gain "AgentsPilot agents" (UD-14), so the preview shows it too |

**For SA / follow-ups (not changed here, outside AD-2b's files):**
- `PLATFORM_UNAVAILABLE_REASON` in `AdminDeletionPreview.ts` still says "the confirmation step is not built". With a token the dialog no longer shows it, but it is the reason sent whenever a token is minted. Reword in #236 or a follow-up.
- `DELETION_KEPT_CATEGORIES` (AD-1c) still says the login is "Closed, not deleted". That is AD-3's behaviour; AD-2 keeps the login open (the result screen says so). Consider rewording the preview line before the switch is flipped.

## SA Review Notes

**Reviewed by SA — 2026-10-06**
**Status:** ✅ **APPROVED WITH CONDITIONS** (AC2-1 … AC2-14 below). AD-2a may start once the conditions are folded into §2 / §5. AD-2b follows AD-2a. Both ship inactive.

**Evidence.** Repo read on the branch @ `4c1b630a`: `ResetService.ts` (`runPurgeCommit`, the 3b order and its non-awaited `refuse` audit), `AuditTrailService.ts` (`log` / `flush`, per-entry hash), `lib/audit/boundedAuditFlush.ts` (its C-3 scope note), `AdminAccessService.ts` (`checkAdminStatus`, `resolveAdminMatch`, `getCache`'s stale fallback), `app/api/business-os/purge/commit/route.ts` (`resolveConfirmationTarget`, the `warn` with `email`), `BusinessOsInviteRepository.ts` (`revokeForIssuerAccount`, `noLiveClaim`), `adminGate.writes.test.ts`, the census doc, and the parent plan's C-6…C-12. Nothing was written to any database.

**Factual corrections to the plan (fix in the text, no design change).**
- §1.1 / §2.5: the admin cache TTL is **60 s** (`CACHE_TTL_MS = 60_000`), not 5 minutes. The stale fallback is real (`getCache`, "prefer a stale cache over throwing").
- R-7 (risk table): the audit hash is **per-entry**, not a chain. `writeNow` only has to reuse `buildLogEntry` to get the same hash.
- §2.7: the method signature takes `reason` but the text hardcodes it. Pick one: the composition passes the constant, and the repository asserts it is ≥ 3 characters.

### Rulings on T-1 … T-10

| # | Ruling |
|---|---|
| **T-1** | **A accepted.** Admin-owned rows (`user_id = actor_id = admin`, `entity_type 'user'`, `entity_id = target`) are owner-unreadable on every as-built read path (`20261035` policy, `listOwnerEntries`, the export reader all key on `user_id`), and they survive AD-3's erasure by construction. This **supersedes the "operator class" wording** in my AD-2 note on the requirement: the guarantee is what was asked for, and A delivers it with no migration. BA rewords FR-A12 / AC-A10 (T13). Accepted side effect, Low: an admin who also owns a business sees these rows in their *own* activity feed, as with `BUSINESS_DELETION_PREVIEWED` today. **If BQ-4 is answered "no":** option B becomes mandatory. That adds one `ALTER POLICY` migration in `supabase/migrations/` (hide-only, safe to ship active, I-1 unaffected), the `ownerVisibility` registry and pin, and moves AC-A14's erasure exclusion into AD-3. About +0.5 d on AD-2a, plus a prod migration the user applies by hand |
| **T-2** | **`writeNow` approved. It is a new pattern under rule 7, and this is the sign-off.** WC-7 / `logAndFlush` cannot be the gate for a destructive step. It never reports whether the row landed, and its own header (C-3) documents that it can still lose the row when any other `flush()` is in flight (the `isFlushing` early return). That is acceptable for a refusal record and not for "we are about to delete". Conditions are in AC2-3 |
| **T-3** | **After the RPC** (non-fatal residue) accepted. Revoking before would cancel invites for a delete that then refused |
| **T-4** | **Hook approved.** It keeps the 3b order exactly: capability → probe → agents → delete-graph → guard → verified snapshot → **gate** → RPC → storage. Everything that can refuse for free still runs before the snapshot, and the gate only adds a refusal point between the snapshot and the RPC. It must stay a **verdict-only** hook (AC2-2) |
| **T-5** | **Accepted, stateless.** The 10-minute TTL, the full re-check and the RPC's advisory lock bound a replay. It also limits itself: after a completed purge, `resolveConfirmationTarget` falls back to the email, so a replayed business name fails step 8 |
| **T-6** | **C-6 stands: HKDF-derived from `SUPABASE_SERVICE_ROLE_KEY`, never the raw key as the HMAC key.** A separate secret is not safer while the feature is inactive. Anyone holding today's public key can call the RPC directly anyway. A new env var also brings back E4 (an unowned Vercel secret). Conditions are in AC2-5 |
| **T-7** | **Delegated mode accepted, but not as a free parameter.** It is derived from the surface (AC2-1) |
| **T-8** | **`{ fresh: true }` accepted.** `invalidateCache()` + read is racy on the shared singleton, and it degrades every concurrent `isAdmin` caller. The fresh path must bypass **both** the cache and the stale fallback: a read error returns `null`, which is R-2 `unverified`, which refuses |
| **T-9** | **In scope.** Drop `email` from the internal route's `warn` (ids only, CLAUDE.md § Logging). No behaviour change; its tests stay green |
| **T-10** | **Depends on BQ-1** (see below). With a kill switch: mint only when the switch is on. Without one: mint while the RPC is held (the G-1 precedent), so the audited `rpc_not_applied` path can be exercised |

### How the business answers change the design

- **BQ-1 ↔ T-10 / QA §6.5.** With a switch defaulting to off, prod refuses at step 5 with `admin_delete_disabled`, **before the probe**. So the AD-2a prod QA check proves `admin_delete_disabled` + zero writes, not `rpc_not_applied`. The `rpc_not_applied` path is then proved by route and orchestration tests only. **Do not flip the switch on in prod to test it.** That makes the rotation day depend on remembering to flip it back before B-2. Recommended: the switch (R-1 is 🔴). Without it, nothing else in the design changes.
- **BQ-4 ↔ T-1.** See T-1: "no" means option B plus one migration.
- **BQ-2 does not change the design.** `agents: true` is already impossible: the 3b orchestrator refuses it permanently (OQ-1 (c)). It is a wording confirmation. The AD-1 requirement's **SC-2 is amended by SA here** to `integrations: true, agents: false, activityHistory: false`.
- **BQ-3 does not change the design.** Both answers fit inside the same CAS UPDATE. Skipping live claims (the recommendation) is what `noLiveClaim` already does.

### Conditions (mandatory)

| # | Condition |
|---|---|
| **AC2-1** | **The orchestrator signature is a discriminated union, not free flags:** `{ surface: 'internal', actorEmail }` \| `{ surface: 'admin', actor: { id }, preCommitGate }`. `audit` is derived from it: internal = self, admin = delegated. On the admin arm, `preCommitGate` is **required**. No call can run delegated (writing no rows) without a gate, and no internal call can turn its own audit off. The existing order tests pass with **zero `-` lines** (R-6) |
| **AC2-2** | **`preCommitGate` is verdict-only.** It takes no arguments, so it cannot change `userId`, the tables or the options. The orchestrator wraps it in `try/catch`: a throw or a non-`{ ok: true }` value means `precommit_refused`. A test pins `executePurge` called exactly once, after `{ ok: true }`. The composition's gate imports only the shared read helpers plus `writeNow`. A source pin asserts it calls no repository write except the write-ahead audit row. The slice-0 `no-deletion-paths` guard and the single-orchestrator pins stay unchanged |
| **AC2-3** | **`writeNow` contract.** Additive only: `log()`, `flush()`, the queue and `isFlushing` are untouched (in the spirit of `boundedAuditFlush`'s D-4). Rules: reuse `buildLogEntry`; insert exactly that one entry through the service's existing client (the audit service's pre-existing direct write, not a new one); **never throw**; bounded by a timeout (reuse `AUDIT_FLUSH_TIMEOUT_MS`); return `{ written: false }` on an error, on a timeout, **and when `config.enabled` is false** (fail closed). JSDoc limits it to confirmed write-ahead and destructive outcome rows. Tests: hash parity with the queued path, the queue untouched, and all three `false` cases. A timeout can leave a `STARTED` row with no delete. That is safe: `STARTED` without `PURGED` must never be read as "deleted", so say so in the event's registration comment |
| **AC2-4** | **Audit rows.** The write-ahead `BUSINESS_DELETION_STARTED` row is written by `writeNow`, and if it is not written there is no RPC. The **outcome `BUSINESS_DATA_PURGED` row also uses `writeNow`**. It cannot undo a delete, so a `false` there is reported in the response (`auditRecorded: false`) and logged at `error`. The admin must not see a clean success with no record. Blocked rows use `logAndFlush` (WC-7). All rows are awaited before the response. Severities are as in §2.3 and the audience pins move by +1 |
| **AC2-5** | **Token key (C-6 … C-12 + SA-3).** Use `crypto.hkdfSync('sha256', ikm, salt, info, 32)` with a fixed salt and a versioned `info`. The raw env value never reaches `createHmac` (unit pin). An IKM under 32 characters, or absent, throws `PreviewTokenKeyError`, which is a **500, never "no token needed"** (C-7). Bind `confirmKind` as well, so a business-name ↔ email flip between preview and commit voids the token. `gateVersion` is per surface (slice 5 passes its own). The token is never logged (C-12) **and never persisted client-side**: no URL, no `localStorage`, held in component state only (AD-2b source guard). Add one line to `supabase/held/README.md`'s rotation checklist: if B-1 moves to Supabase's new secret-key format and the env var name changes, `previewToken.ts` must follow. Otherwise every commit 500s, which fails closed but needs a code change |
| **AC2-6** | **Order fix in §2.5:** check the kill switch (step 5) **before** token verify (step 4). It is cheap and needs no crypto, and a switched-off feature should not answer 500 `token_key_unavailable`. Both steps still write a blocked row |
| **AC2-7** | **Fresh admin re-check (step 7 and evaluation 2):** the actor is re-checked with `{ fresh: true }`, and R-1 and R-2 run on the target with `{ fresh: true }`. `null` refuses. `isAdmin` / `requireAdmin` tests pass unmodified |
| **AC2-8** | **Shared `confirmation.ts` must not fail open.** Today `resolveConfirmationTarget` ignores `findByUserId`'s `error`, so a read error silently becomes the email fallback. The shared helper returns `unverified` on a repository error, which refuses (500 on admin, and unchanged-or-500 on internal: pick one and pin it). Not-found still falls back to the email. Comparison stays server-side |
| **AC2-9** | **Invite bulk revoke (`new-repository` + `tenant-isolation-guard`):** one UPDATE, equality on `issuer_kind = 'account'` and `issuer_account_id = target`, plus `redeemed_at IS NULL`, `revoked_at IS NULL` and `.or(noLiveClaim(cutoff))`. Use `{ count: 'exact' }` with **no `.select()`** (`mutationOrSelect.guard` keeps its single exemption). The repository rejects a missing or non-UUID `issuerAccountId` before any query. It sets `revoked_by_admin_id`, uses no `.in()`, never DELETEs, and documents the service role at the call site. The skipped live-claim count comes from a separate read-only count with the same predicate minus the claim filter. Do not infer it |
| **AC2-10** | **Preview changes (T3) are live behaviour on prod's read-only screen:** `agents: false`, R-8 including the delete-graph verdict, and the token field. QA re-runs the AD-1 click-through for them. The `commitToken` is added to the wire type and never to the audit row (only `tokenMinted: boolean`) |
| **AC2-11** | **Route (`new-api-route`):** `requireAdmin` is the first statement. The path is Zod `uuid()`, lower-cased, and a bad id is a 400 before any lookup. The body is `.strict()` with `{ token, confirmText }`, so `userId`, `level`, `options` or any other key is a 400. Use the dev-only `details` guard, `runtime = 'nodejs'`, `maxDuration = 60`, and a child logger with `correlationId`. Pino carries ids, codes and counts only: no email, no business name, no token |
| **AC2-12** | **Census:** add the `adminGate.writes` row for `POST …/deletion/commit`, the census doc row (re-measured with the guard's `scanHandlers`) and its change history, all in AD-2a. `npm run test:authz-guard` must be green, with any cap move stated explicitly and no exemption |
| **AC2-13** | **Inactive / held:** `git diff origin/main --stat -- supabase/migrations supabase/held` must be empty. I-1 stays green. Nothing defines or grants `purge_business_data` outside `supabase/held/`. The one permitted `supabase/` edit is the README line in AC2-5 |
| **AC2-14** | **CI time:** Jest only, inside the existing shards, with no DB, no network and no new workflow. Nothing to rule: it adds no CI time |

### Split

**AD-2a (~3 d) / AD-2b (~1.5 d): accepted.** Each half ships alone and inactive. AD-2a is at the upper bound (13 tasks), so order its commits as T2 → T3 → T4 → T5 (preview fixes and helpers, which are live-visible corrections) before T6 onward. If T6 runs over, split the PR there rather than squeezing it.

### Notes and follow-ups (not conditions)

- The internal surface keeps its non-awaited `refuse` audit (a WC-7 gap). It is inactive and out of scope here. Carry it to purge slice 5, where `runReset` is renamed.
- R-5 (60 s budget): evaluation 2 re-runs the reconciler (the whole catalogue) and the delete-graph read seconds after step 3. Measure both in the post-rotation sweep. If the time is tight, the gate may reuse the step-3 graph verdict, but **never** the fingerprint.
- No `lib/business-os/entitlements/` import is planned. Re-check this at code review.

### Approval
[x] Workplan approved with conditions AC2-1 … AC2-14. Proceed to AD-2a after folding them into §2 / §5. AD-2b after AD-2a. BQ-1 and BQ-4 must be answered before T3 / T10 (BQ-1) and T7 / T9 (BQ-4) are coded.

---

**Code Review by SA (AD-2a): 2026-10-06**
**Status:** ✅ Code Approved (one Low fix recommended before QA, not blocking)

Reviewed the uncommitted worktree `neuronforge-purge-s3` (`feature/admin-delete-ad2-commit`, base `4c1b630a`): 29 modified files (+1123 / −202) and the untracked route, helpers and tests. Re-ran 50 touched suites (1,385 tests) and `test:authz-guard` (119): all green.

#### Conditions AC2-1 … AC2-14 (all met)

| # | Verdict | Evidence |
|---|---|---|
| AC2-1 | ✅ | `PurgeCommitParams` is a union. `preCommitGate` is required on the `surface: 'admin'` arm. Audit is derived (`admin ? delegated : self`). `ResetService.order.test.ts` is not in the diff |
| AC2-2 | ✅ | `PreCommitGate = () => Promise<…>`, wrapped in try/catch, and anything but `ok === true` refuses. It runs after the verified snapshot and before `descriptorsForRun` / the RPC. The 3b order is unchanged. A source pin covers `buildPreCommitGate`, and its only write is `writeNow` |
| AC2-3 | ✅ | `writeNow` is additive (`log`/`flush`/queue/`isFlushing` untouched). It reuses `buildLogEntry` and inserts once. `config.enabled` false, an error, a throw and a timeout all give `false`. The insert promise never rejects, so there is no unhandled rejection after a timeout. `auditTimeouts.ts` removes the import cycle |
| AC2-4 | ✅ | STARTED and PURGED go through `writeNow`. Blocked rows use awaited `logAndFlush`. `auditRecorded: false` is surfaced and logged at `error`. The registration comment says STARTED alone is never "deleted" |
| AC2-5 | ✅ | `hkdfSync('sha256', ikm, fixed salt, versioned info, 32)`, and the raw key never reaches `createHmac`. IKM under 32 characters gives `PreviewTokenKeyError`, which is a 500. The token binds surface, actor, target, level, options (canonical), `confirmKind`, `gateVersion`, fingerprint, `iat`/`exp` (lifetime ≤ TTL, ±30 s skew). Comparison is `timingSafeEqual` with a length guard. It is never logged (`tokenDigest` only). The README line is present |
| AC2-6 | ✅ | `commitAdminDeletion` checks the switch before `verifyPreviewToken`. A test proves a missing key still answers 409 `admin_delete_disabled` |
| AC2-7 | ✅ | `{ fresh: true }` → `readAdminSetFresh()`: no cache read, no stale fallback, no refill, and a throw becomes `null`, which refuses. Actor and target are re-checked at step 7 and again in the gate |
| AC2-8 | ✅ | `confirmation.ts` returns `unverified` on a returned or thrown error. `findByUserId` maps PGRST116 to `{data:null,error:null}`, so not-found still falls back to the email. 500 on both surfaces |
| AC2-9 | ✅ | One UPDATE with `{ count: 'exact' }` and no `.select()`/`.in()`/DELETE. It filters on equality of `issuer_kind`/`issuer_account_id`, `redeemed_at`/`revoked_at` null and `.or(noLiveClaim)`. Both ids are checked as UUIDs before any query, and the reason must be ≥ 3 characters (it matches the CHECK). The count is a separate head-only read |
| AC2-10 | ✅ | `agents: false`; R-8 includes the delete graph (anything not `ok` fails closed); the token is on the wire type; the audit row carries `tokenMinted` only. The dialog's confirm stays hard `disabled` (`DeleteBusinessDialog.tsx:337`), and nothing reads `commitToken` |
| AC2-11 | ✅ | `requireAdmin` is the first statement. The path id is Zod uuid and lower-cased, and a bad id is a 400 before any lookup. The body is read as text and then a `.strict()` schema is applied. `nodejs`, `maxDuration = 60`, a child logger with `correlationId`, and dev-only `details` |
| AC2-12 | ✅ | Row 98, 95 = 89 + 6 + 0 / 66 files. `adminGate.writes` 60 → 61 with the arithmetic comment. The guard is green, no cap moved, no exemption |
| AC2-13 | ✅ | `git diff -- supabase/migrations` is empty. The `supabase/held` diff is the one README line |
| AC2-14 | ✅ | Jest only |

#### Rulings on Dev's choices
- **Stale token 409 / wrong token 400:** accepted. Expired, version or gate-version mismatch means "re-open the preview" (a conflict with current state). Signature, actor, target, level or options mismatch is a bad request.
- **Profile read error → 500 on both surfaces:** accepted. It is a server fault, not a user-correctable conflict, and it is pinned in both route suites.
- **Flag in `featureFlags.ts`:** accepted. It is server-only (no `NEXT_PUBLIC_`) and defaults off. An import failure makes the route 500 rather than delete. Note that `featureFlags.ts` imports `clientLogger`, which is harmless here.
- **Internal `auditDetail` on the admin arm:** accepted. Only the admin-owned audit row receives it (`refuse()` destructures it away), and `detail` sent to the client holds only `snapshotPath` and gate codes. Raw DB and snapshot errors stay in `auditDetail` or behind `withDevDetail`.

#### Checks requested by TL
- **The 202 deleted lines:** nothing was dropped unintentionally. The four read helpers moved verbatim from `AdminDeletionPreview.ts` to `adminDeletionFacts.ts` (the log module name changed). The route-local `normalise` and `resolveConfirmationTarget` moved to `confirmation.ts`, and the only behaviour change is fail-closed (AC2-8). The `checkAdminStatus` cache-build was refactored into `toCache`. The AD-1 "preview-only" limitation was replaced as planned (§2.6). The `email` was removed from the internal `warn` (T-9).
- **Tenant isolation:** the target comes only from the path. Every engine, read and revoke call takes `targetId`. The admin id reaches only audit rows, the snapshot context and `revoked_by_admin_id`. All repositories are service-role and documented.
- **Pino:** ids, codes and counts only. There is no email, business name or token in any new log line. The `console.` hits in `adminDeletionRefusals.ts` are the English word "admin console." in message strings, not calls. There are no `lib/business-os/entitlements/` imports.
- **`oneAddressPolicy.guard` failure is environment-only.** The guard's `relative()` strips `ROOT + '/'`, which never matches Windows `\` paths. Every offender listed (`platformBranding.ts`, the plugin strategies, `UniversalOAuthHandler.ts`, `origins.ts`, the OAuth callback) is untouched by this diff, and the allowlisted files fail only because their path is not relativised. Linux CI is unaffected.

#### Code Review Comments
1. `lib/business-os/purge/AdminDeletionCommit.ts:489-493`: when the revoke fails, `countPendingForIssuerAccountByAdmin` still runs and reports every still-pending invite as `skippedMidSignup`. The AD-2b dialog would say "N invites were mid-signup" when they simply were not revoked. Set `skippedMidSignup: null` (or skip the count) when `revoked.error` is set. **Priority: Low** (inactive, and residue already states the failure). One line; fix before QA.

#### Optimisation Suggestions
- `writeNow` awaits `buildLogEntry` outside the timeout race. That is fine today (pure, plus a `crypto.subtle` hash), but if the builder ever gains I/O, move it inside the bound.
- R-5 budget: the commit path now reads the delete graph three times (evaluation 1, the orchestrator, the gate) plus the reconciler twice. Measure this in the post-rotation sweep as already noted. The gate may reuse the graph verdict, never the fingerprint.
- `refuse()` on the switch-off path writes a blocked row per request. That is intended (AC2-6), and noted only so QA expects one row per click.

### Code Approved for QA: Yes (fix comment 1 first, recommended, Low)

---

**Code Review by SA (AD-2b): 2026-10-06**
**Status:** ✅ Code Approved, on condition that the two copy fixes (comments 1 and 2) land in AD-2b before the user sees the diff

Reviewed the uncommitted worktree `neuronforge-purge-s3` on `feature/admin-delete-ad2b-dialog`, diffed against `feature/admin-delete-ad2-commit` (PR #236). That is 9 files, +1122 / −78. Re-ran `jest app/admin/users`: 10 suites and 278 tests, all green. A first run done in parallel with tsc had load timeouts, and the rerun was clean. Ran `typecheck:bos-llm`: 429 files, 28 baseline errors, **0 new**, passed.

#### Rulings on Dev's choices
- **Body `{ token, confirmText }`:** accepted. It matches the AD-2a route's `.strict()` schema (AC2-11), and the source guard pins the exact `JSON.stringify`.
- **List reload when the dialog closes, not when the delete succeeds:** accepted. `fetchUsers` sets `loading`, which unmounts the table along with the result screen. Reloading on close is the only order that lets the admin read the result. Reloading after `unknown` as well is correct.
- **Client-side match using the server's normalisation:** accepted. `normaliseConfirmText` is identical to `normaliseConfirmation` (trim, collapse whitespace, lower-case). It only enables a button. The server compares again against its own value and is authoritative. The copy is required because the page guard forbids `lib/business-os` imports.
- **500, unknown code, network failure or unreadable body → "not known whether anything was deleted":** accepted, and it is the right default for a destructive call. `commitRefusalSentence` returns `null` for anything that is neither a commit code nor a route code, and `postCommit` maps that to `unknown`. A 500's `'Internal server error'` is in neither map, so it falls through to `unknown`, as it should.

#### Checks requested by TL (all pass)
| Check | Verdict | Evidence |
|---|---|---|
| No raw server text on the commit path | ✅ | `RefusedBody` renders the copy sentence, refusal *titles*, a fixed snapshot line and the correlation id. `CompletedBody` builds every line from numbers. `message`, `details`, `residue`, `kept` and `notes` are never read (source guard, plus render tests with planted strings). The preview's own `refusal.message` / `clearingAction` remain the AD-1c-approved server wording |
| Input only with a token and no refusals | ✅ | `confirmableValue` requires `commitToken`, no `applies`/`unverified`, and a non-empty value. `isConfirmable` also requires no outcome. The one `<Input>` sits in the confirmable branch, and the guard pins it |
| Delete disabled until a match; Enter cannot submit | ✅ | `disabled={!canSubmit}`, and `submit` calls `preventDefault()` then returns unless `canSubmit && commitToken`. The no-token footer is a hard `disabled` with no `onClick` |
| "Deleting…" blocks close | ✅ | `handleOpenChange` ignores `false` while submitting, which covers Esc, the overlay and the primitive's corner X. Close, the input and the button are disabled, `aria-busy` is set, and the status region announces it |
| Focus and labels | ✅ | `<Label htmlFor>` names the input, including the value to type, and the hint is linked through `aria-describedby`. Both confirm buttons are described by the single `role="status"` region. The outcome title (`tabIndex=-1`) receives focus. Failures use `role="alert"` |
| Page source guard (no `lib/business-os` imports) | ✅ | The dialog and `deletionCopy.ts` stay in `SCREEN_FILES`, and the only `lib/business-os` mentions are comments. The guard passes |
| `'use client'` boundary | ✅ | The dialog's first line, pinned. `deletionCopy.ts` and `types.ts` import types only |
| Wire-type pin | ✅ | `AdminDeletionCommitCompleted['result']` ↔ `DeletionCommitResultView` and `AdminDeletionCommitCode` ↔ `DeletionCommitCodeView`, checked both ways, in the existing `adminDeletionPreview.wireTypes.test.ts`, which is already in `typecheck:bos-llm` scope. No new scope entry, so **no added CI time**. `Record<DeletionCommitCodeView, string>` makes the copy exhaustive |
| Token handling (AC2-5) | ✅ | The token is held in component state and the POST body only. The guard bans storage, cookies, URL params, the router and loggers |

#### Code Review Comments
1. **`lib/business-os/purge/AdminDeletionPreview.ts:84-85, 366-368`: stale reason. Fix in AD-2b (no objection). Priority: Medium (copy is false).** This branch is reached only when a token **was** minted. Prod never reaches it while the switch is off. Replace as follows:
   - Rename `PLATFORM_UNAVAILABLE_REASON` to `CONFIRMATION_PENDING_REASON`, value `'the typed confirmation below has not been entered yet'`. JSDoc: "The reason sent when a token was minted: only the admin's typed confirmation is missing."
   - Line 367 (`resetLive === false`): replace the whole template, not just the appended part, with `'the delete function is not installed on this server, so a confirmed deletion will be refused and nothing will be deleted'`. This matches `notAppliedLine`.
   - Update the render-test fixture (`deleteBusinessDialog.render.test.tsx:332`) and its `not.toHaveTextContent` assertion (`:425`) to the new string. Add one `AdminDeletionPreview.test.ts` pin: token minted → reason `=== CONFIRMATION_PENDING_REASON`.
2. **`app/admin/users/deletionCopy.ts:71-101` (`DELETION_KEPT_CATEGORIES`): "Closed" login. Fix in AD-2b. Priority: Medium (states AD-3 behaviour under AD-2).** It should read:
   - Account preferences: `'Language, time zone and notification settings belong to the login, which this deletion leaves in place.'`
   - Activity history: `'The activity record is kept, with the name on it. Removing the name is part of closing the login, a later step.'`
   - The login itself: `'Stays open: this deletion does not close the login, so the person can still sign in (to an account with no business) and the email stays taken. Closing the login is a later step.'`
   - In the doc comment on line 72-73, change "the closed login" to "the login (kept open by AD-2; AD-3 closes it)". AD-3 must flip these lines back, so add a one-line note to that effect in the requirement's AD-3 scope. Update any render assertion on the old text.
3. `deletionCopy.ts:252` (`commit_failed`): "rolled it back. Nothing was deleted" is certain only when the database itself errored. `!result` also covers a transport failure after the commit. A retry is harmless, so the impact is small. Recommended wording: `'The delete did not report success. A failed delete is rolled back, so nothing should have been deleted. Reload this page to confirm.'`, plus calling `onDeleted` on close for this code. **Priority: Low**, not blocking.
4. `DeleteBusinessDialog.tsx:460`: `DELETION_REFUSAL_TITLES[r.id] ?? r.id`. The fallback is unreachable under the pinned union. Harmless. **Priority: Low**, optional.

#### Optimisation Suggestions
- `CompletedBody` trusts the shape of `record.data` on a 200. This is acceptable because it is our route and the type is pinned. A guard such as `Array.isArray(data.storage) && data.rows` would turn a malformed 200 into `unknown` instead of a render crash.

### Code Approved for QA: Yes (comments 1 and 2 to be applied in AD-2b; 3 and 4 optional)

#### Dev fixes for the AD-2b review and QA edges (2026-10-06)
- [x] ✅ **Comment 1 (SA-1).** Fixed by Dev: `PLATFORM_UNAVAILABLE_REASON` renamed `CONFIRMATION_PENDING_REASON` = 'the typed confirmation below has not been entered yet'; the `resetLive === false` branch now uses a new constant `DELETE_FUNCTION_NOT_INSTALLED_REASON`. **One wording deviation:** it reads "…so a confirmed deletion will be refused before any data is removed", not "…and nothing will be deleted". `descriptors.invariant.test.ts`'s FALSE_REASSURANCE scan forbids "nothing will be deleted" anywhere on the purge surface, and the exact wording failed it. Render fixture and assertion updated. Two new pins in `AdminDeletionPreview.test.ts`: a minted token gets the not-installed reason (probe false) or the pending one (probe true), never "later release / not built".
- [x] ✅ **Comment 2 (SA-2).** Fixed by Dev: SA's exact wording for preferences, activity history and the login; doc comment now says "the login (kept open by AD-2; AD-3 closes it)". The AD-3 flip-back is noted in AD-3's scope (§5 Post-rotation, and the requirement's AD-3 row, insert-only). Render test pins the "stays open" wording.
- [x] ✅ **Comment 3 (SA-3).** Fixed by Dev: `commit_failed` copy hedges ("not known whether anything was deleted… Reload this page") and maps to the unknown outcome, so closing reloads the list.
- [x] ✅ **Comment 4.** Fixed by Dev: unreachable `?? r.id` removed.
- [x] ✅ **QA: a malformed 200.** Fixed by Dev: `isCommitResult` checks every field the result screen reads before it renders. Anything else is "not known whether anything was deleted" and reloads the list on close. Six malformed shapes are tested.
- [x] ✅ **QA: double submit.** Fixed by Dev: an `inFlight` ref blocks a second POST in the same tick. Tested with two submits in one `act`, plus a source pin.
- [x] ✅ **QA: raw-message guard.** Fixed by Dev: the source guard now finds every `message` read (`x.message`, `x?.message`, `(x as T)?.message`, `x['message']`, a destructured `{ message }`), and the only one allowed is the preview's `refusal.message`. Planted samples pin each spelling. A `details` read is caught in the same ways. `residue`, `kept` and `notes` are allowed only as the preview's `t.notes`. `postCommit` must not mention any of them. The preview error state's field is renamed `sentence`.
- Re-run: `app/admin/users` + `lib/business-os/purge` + `app/api/admin/users` (incl. the commit and preview routes): 31 suites / 710 tests pass. `typecheck:bos-llm` passes (exit 0). Scoped tsc over the 9 touched source and test files: exit 0, 0 errors. eslint exit 0, 0 errors (the 9 pre-existing `page.tsx` warnings).

---

## QA Testing Report

**QA: 2026-10-06 (AD-2a)**
**Test mode:** full
**Strategy used:** A + B. Jest unit and orchestration tests with mocked repositories, plus route tests. Also reading the source against §2.5 and AC2-1 … AC2-14, and the inactive proof in §6.4. The manual prod check in §6.5 was **not** run, because the brief allowed no live calls.
**Focus:** api, security, schema
**Skipped:** the §6.5 manual prod call (brief: no live calls, read-only) and the AD-1 click-through re-run that AC2-10 asks for (needs a browser on prod). Both are still owed.
**Input source:** prompt keywords (coordinator brief) + workplan §6

### Test Coverage

| Criterion | Tested? | Result | Notes |
|---|---|---|---|
| Happy path: switch on, valid token and name, orchestrator called once, write-ahead before the RPC, outcome row, invites revoked | ✅ | Pass | `AdminDeletionCommit.test.ts`, "order" test: snapshot → `writeNow:STARTED` → executePurge → revoke → `writeNow:PURGED`. Both rows are admin-owned and critical. Route returns 200 with `data` |
| Auth: signed out → 401, non-admin → 403, before anything runs | ✅ | Pass | Route test. The 403 also fires with a bad id and a bad body, so the gate comes first |
| Invalid input: non-UUID id, extra body key, missing token → 400 | ✅ | Pass | Covers `userId`, `level`, `options`, any other key, malformed JSON, an empty body, a missing token, whitespace-only text and a token over 4096 characters. The orchestrator is never called |
| Switch off → `admin_delete_disabled`, before token verify; no token minted in the preview | ✅ | Pass | Missing key plus switch off still gives 409 `admin_delete_disabled`, not 500. An unset switch is off. Preview: "switch off: no token". The route test runs the REAL composition with the default env and gets 409, nothing read, one admin-owned blocked row |
| Expired, tampered, other-target, other-admin, other-options or other-surface token → 409 / 400 | ✅ | Pass | expired / gate version → 409; target / actor / options / surface / malformed → 400. The missing-key case is a 500, never a bypass |
| Wrong typed name → refused, zero deletes | ✅ | Pass | 400 `confirmation_mismatch`, orchestrator never runs, one blocked row. Case and whitespace are normalised. A kind flip (name → email) gives 409 |
| Self or admin target refused | ✅ | Pass | Composition: an admin target refuses 409 (R-2, fresh). Self (R-1) is proven in `adminDeletionRefusals.test.ts`. The composition has no self-target case of its own (Edge Case 1) |
| Agents never deleted | ✅ | Pass | `ADMIN_DELETION_OPTIONS.agents === false`, pinned in the preview test. The orchestrator's admin arm refuses `agents: true` before any read. Agents appear in the kept list |
| RPC not applied → `rpc_not_applied` before any snapshot | ✅ | Pass | `ResetService.adminSurface.test.ts` I-9: calls are only `purgeFunctionExists`, no gate, no audit. The composition maps it to 409: no write-ahead, no revoke, and `auditDetail` is stripped from the response |
| writeNow failure → no RPC | ✅ | Pass | `audit_unavailable`, `snapshotWritten: true`, `executePurge` not called. This holds in both the composition and the orchestrator suites. `writeNow` returns false on an error, a reject, a timeout or a disabled service |
| Profile read error → 500, never the email fallback | ✅ | Pass | 500 `confirmation_unverified` even when the email is typed. Pinned on the internal route too |
| No raw error in production responses | ✅ | Pass | The route's 500 has `details` undefined in production and only in development. 400 `details` is dev-only |
| Logs carry ids only | ✅ | Pass | Composition and route tests: no email, business name or token in any logger argument (`tokenDigest` only) |
| SA comment 1: revoke failed → `skippedMidSignup: null`, count skipped | ✅ | Pass | **QA added** assertions to the existing revoke-failure test, plus 2 cases: `data: null` with no error, and a count error after a good revoke. Mutation check: forcing the count to run makes 2 tests go red; the source was restored byte-exact (`cmp`) |
| Inactive proof: `supabase/migrations` untouched, I-1 … I-4 green, a planted GRANT goes red | ✅ | Pass | Branch vs its base `4c1b630a`: the `supabase/migrations` diff is empty; `supabase/` holds only the README line. (vs `origin/main` the diff shows boost `20261030` only because main moved ahead after the branch was cut. That is not this slice.) Held suite 18/18. A planted `29991231_qa_plant_grant.sql` with a GRANT gave 1 failed; after removing it, 18/18 again |

### Issues Found

#### Bugs (must fix before commit)
1. **Two required source guards go red because the allow-lists were not updated for the moved and new files.** Severity: **Medium**. These suites are not quarantined, so the Linux `Gate tests (jest)` check will fail. Behaviour is unaffected.
   - `lib/repositories/__tests__/authAccountRepository.callers.guard.test.ts`, "only the allow-listed files name it". Offenders: `lib/business-os/purge/AdminDeletionCommit.ts`, `lib/business-os/purge/__tests__/AdminDeletionCommit.test.ts`, `app/api/admin/users/[id]/deletion/commit/__tests__/route.test.ts`. The guard uses `path.sep`, so this is not the Windows-path issue.
   - `lib/repositories/__tests__/BusinessOsBillingAccountRepository.test.ts`, "source guards › only the listed files name the repository". Expected `lib/business-os/purge/AdminDeletionPreview.ts`, received `lib/business-os/purge/adminDeletionFacts.ts`. This comes from the helper move.
   - Steps to reproduce: `npx jest lib/repositories/__tests__/authAccountRepository.callers.guard.test.ts lib/repositories/__tests__/BusinessOsBillingAccountRepository.test.ts`
   - Expected: green (both pass on an `origin/main` export).
   - Actual: 1 failure each on the branch.
   - Fix (Dev): add the new callers to the R-4 allow-list with a reason, and rename the billing entry to `adminDeletionFacts.ts`. SA said it re-ran the 50 touched suites; these two guards sit outside the touched set.

#### Performance Issues (should fix)
- None new. SA's R-5 note stands: the delete graph is read three times and the reconciler runs twice. Measure this in the post-rotation sweep.

#### Edge Cases (nice to fix)
1. There is no composition-level test for an admin targeting themselves (R-1). The refusal unit test covers it, and in practice R-2 also trips because the target is an admin.
2. The two invite edge cases above (`data: null` without an error, and a count error after a good revoke) were not covered before. QA added them; Dev should keep them.

### Test Outputs / Logs

| Run | Result |
|---|---|
| Affected suites (purge, admin users routes + page, admin gate, internal purge route, audit, AuditTrailService, AdminAccessService, invite repository, featureFlags, held) | 53 suites, 1,425 tests. 1 failure: `creditsBlock.render` timed out under parallel load and passes alone (66/66) |
| `AdminDeletionCommit.test.ts` after the QA additions | 39/39 |
| `npm run test:authz-guard` | 119/119, exit 0 |
| `npm run typecheck:bos-llm` | passed, 28 baseline, **0 new** (one baseline entry fixed elsewhere: `onboarding/build`) |
| `npm run lint:hooks` | exit 0 |
| `npx tsc --noEmit -p .` | exit 2 (1,940 pre-existing repo errors); **0 errors in any of the 40 changed or new `.ts`/`.tsx` files** |
| eslint, changed files | 45 errors / 9 warnings, **all pre-existing**: identical per-file counts on the `origin/main` export (`featureFlags.test.ts` `require()` ×45). New files are clean |
| `npm run test:bos-entitlements` | not required: no import from `lib/business-os/entitlements/` (one comment mention in `adminDeletionRefusals.ts`) |
| Full `npm test` | Failures outside `jest-quarantine.json`: the two guards in Bug 1 (**caused by this slice**), plus `oneAddressPolicy.guard`, `lib/geo/addressFormat`, `AdminAreaField.render` and `AdminAreaField.search`. The last four **fail the same way on an `origin/main` export** on this Windows machine (22 vs 24 failed across the same 6 suites; the difference is Bug 1), so they are environment or base-branch failures, not from AD-2a |

No live call was made to any route, and nothing was written to any DB. The temp migration and the scratch `origin/main` export were removed (the node_modules junction was unlinked first, and the shared node_modules is intact).

### Final Status
- [ ] All acceptance criteria pass, ready for commit
- [x] Issues found: Dev must fix Bug 1 (two guard allow-lists, Medium; it blocks the CI gate) before commit. All functional and security criteria pass. The §6.5 prod check (`admin_delete_disabled` + zero writes) and the AC2-10 preview click-through are still owed after deploy.

---

**QA: 2026-10-06 (AD-2b)**
**Test mode:** full
**Strategy used:** A + D-substitute. Jest render tests (jsdom + RTL) and the source guard, plus a temporary QA-only render suite (deleted afterwards) and a mutation check. I also read the dialog, the copy and the route's status mapping. **No browser and no live calls**: they need an admin session, and the switch is off in prod. The manual checks are listed below.
**Focus:** ui, security (token handling, no server text)
**Skipped:** the browser click-through (§6.5 AD-2b), which is owed by the user. No call was made to any route and nothing was written to any DB.
**Input source:** prompt keywords (coordinator brief) + workplan §6
**Code under test:** the tree **before** SA AD-2b comments 1 and 2 were applied. `DELETION_KEPT_CATEGORIES` still says the login is "Closed, not deleted", and `PLATFORM_UNAVAILABLE_REASON` is still the old value. Once those fixes land, re-run `app/admin/users` + `lib/business-os/purge`.

### Test Coverage

| Criterion | Tested? | Result | Notes |
|---|---|---|---|
| No input without a token, or with any blocking refusal | ✅ | Pass | Render tests "no token (switched off)" and "a token with a blocking refusal" check that there is no input and no form. The source guard pins `confirmableValue`, which requires a token, no `applies`/`unverified` refusal and a non-empty value |
| The switched-off reason is plain words | ✅ | Pass | Status reads "Deletion not yet available: admin delete is switched off on this server (it stays off until …)". A commit-time `admin_delete_disabled` reads "Admin delete is switched off on this server. Nothing was deleted." |
| Delete disabled until the normalised match | ✅ | Pass | `Acme`, `Acme Therapy Ltd` and whitespace keep it disabled. `'  acme   THERAPY '` enables it. `normaliseConfirmText` is identical to the server's `normaliseConfirmation` |
| Enter blocked while disabled | ✅ | Pass | `fireEvent.submit` on a mismatch posts nothing. `submit` returns early unless `canSubmit && commitToken` |
| POST body is exactly `{ token, confirmText }` to `/api/admin/users/{id}/deletion/commit`, once; no token in any URL | ✅ | Pass | Render test plus source guard. **QA extra:** a double click and an extra submit post once when React flushes between events, as browsers do |
| Each refusal code → one plain sentence | ✅ | Pass | 11 codes are rendered (`it.each`). **QA extra:** every key of `DELETION_COMMIT_REFUSAL_COPY` and every route code returns a sentence. `Record<DeletionCommitCodeView, string>` plus the both-ways wire pin keeps the map exhaustive |
| 500, unknown code or network error → "not known whether anything was deleted", and close refreshes | ✅ | Pass | Three render cases. **QA extra:** a 200 with `success:false` and no code, and a 502 with an unparseable body, also give `unknown` |
| No raw server text | ✅ | Pass | Planted `message`, `details`, `residue`, `kept` and `notes` are absent from the body. The preview's `refusal.message`, `clearingAction` and `limitations` are still rendered: that is server wording approved in AD-1c, not commit text |
| "Deleting…" blocks Esc, the overlay, the corner X and Close | ✅ | Pass | Esc is in the render test. **QA extra:** overlay pointer-down/click, the primitive's corner "Close" and "Close preview" during a pending commit: `onOpenChange(false)` is never called |
| Result screen: counts per area, kept list (incl. agents), invites revoked + mid-signup (or unknown), residue, audit recorded | ✅ | Pass | Rows per area plus "Other tables", storage "7 files removed; 2 could not be removed", invites 3 / 1 or "could not be revoked" / "unknown", kept list including AgentsPilot agents, audit "yes" or a `role="alert"` "NO", snapshot path and correlation id. Focus moves to the title |
| Reopen re-fetches the preview | ✅ | Pass | "Reopen the preview" fetches the preview a second time and clears the input. **QA extra:** closing the dialog and opening it again after a refusal also re-fetches; the stale refusal was gone by the first act-flushed render |
| The list reloads on close | ✅ | Pass | `onDeleted` fires once on close after success or `unknown`. **QA extra:** it does not fire after a refusal. `page.tsx` passes `() => void fetchUsers()` |
| Mutation: render the raw server error | ✅ | Pass | In `postCommit` I planted `record.message ?? commitRefusalSentence(...)`. Render suite: **13 failed / 80 passed**. Restored from a backup copy, and `cmp` confirms the file is byte-identical. Note: the **source guard stayed green** on this plant, because its regex `record\.message` does not match `(record as …)?.message`. The render tests are the real net |

### Issues Found

#### Bugs (must fix before commit)
- None in AD-2b's code. SA comments 1 and 2 are still pending. They are SA conditions rather than QA findings, but until they land the preview kept list ("The login itself: Closed, not deleted") contradicts the result screen ("The login: it stays open") **inside the same dialog**. Re-run QA's suites after they land.

#### Performance Issues (should fix)
- None. One preview POST per open or reopen, and one commit POST per confirm.

#### Edge Cases (nice to fix)
1. **`commit_failed` claims certainty** (= SA comment 3, Low). `BusinessPurgeRepository.executePurge` returns `result: null` on *any* RPC error, including a transport failure after a server-side commit. The dialog then says "rolled it back. Nothing was deleted" and does not refresh the list on close. Take SA's hedged wording, and add `commit_failed` to the codes that call `onDeleted`.
2. **A malformed 200 crashes the render** (= SA optimisation). `CompletedBody` reads `result.rows.byTable` and `result.storage` without checking them. A shape guard → `unknown` would be safer.
3. **Double submit relies on the re-render.** There is no ref or in-flight guard in `submit`. A real browser flushes between clicks, so this is not reproducible there, but two submits batched in one React task do post twice (shown in a QA test that wrapped both clicks in one `act`). The server's R-7 lock and the single-use flow bound the damage. Optional: a `useRef` in-flight flag.
4. **The source guard's no-server-text regex is shape-sensitive** (see the mutation row). Optional: also ban `\.message\b` reads outside `PreviewBody`, or rely on the render tests by design.

### Manual checks left for the user (browser, admin session; switch ON only on a non-prod or throwaway setup)
1. Switch off (prod today): open Delete… on a business. There is no input, the confirm is disabled, and the status reads "Deletion not yet available: admin delete is switched off…".
2. Switch on, nothing blocking: the input appears, labelled with the business name (or the email if there is no name), and the "delete function is not installed" line shows. Delete enables only on a match. Enter does nothing on a mismatch.
3. Confirm against an environment where the RPC is not applied: "Deleting…" shows and Esc / overlay / X do nothing. Then "Nothing was deleted" with the not-installed sentence. Close: the row is unchanged.
4. Keyboard only: Tab order is input → Close → Delete; focus lands on the outcome title; a screen reader announces the status region.
5. Dark styling of the input, the rose confirm box and the result screen on the admin shell (no light fallback).
6. Post-rotation (throwaway account): the real result screen counts, invites and audit line, and the row reads "No Business OS business" after close.

### Test Outputs / Logs

| Run | Result |
|---|---|
| `jest app/admin/users lib/business-os/purge app/api/admin/users/[id]/deletion` | **27 suites / 638 tests, all green** (incl. `deleteBusinessDialog.render`, `source.guard`, `adminDeletionPreview.wireTypes`, commit + preview route tests) |
| QA temporary suite (`zz.qa-ad2b.test.tsx`, deleted) | 7/7 after the double-click case was corrected to per-event flushing; the batched variant posts twice (Edge Case 3) |
| Mutation (raw server message) | render 13 failed / source guard green; restored, `cmp` identical |
| `npm run typecheck:bos-llm` | passed: 429 files, 28 baseline, **0 new** (the `onboarding/build` baseline entry is fixed, as before) |
| `npm run test:authz-guard` | 119/119 |
| `npx tsc --noEmit -p .` (8 GB heap; the default heap OOMs with exit 134) | exit 2, 1,938 pre-existing errors, **0 in any changed file** |
| eslint, the 7 changed source and test files | exit 0, 0 errors. 9 warnings in `page.tsx`, all on lines outside the AD-2b hunk (pre-existing) |
| `npm run test:bos-entitlements` | not required: no import from `lib/business-os/entitlements/` |
| Full `npm test` | 17 failed suites. 11 are in `jest-quarantine.json`. Of the 6 outside it: `oneAddressPolicy.guard`, `addressFormat` and `AdminAreaField.render`/`.search` are the known Windows-environment failures. `app/admin/archiving/page.render` and `jobs-queues/qa-slice5-pr2.route` failed under load and **pass alone** (39/39). None come from AD-2b |

`git status` is unchanged apart from this report. No commit, no stash, no DB writes.

### Final Status
- [x] All acceptance criteria tested in Jest pass. AD-2b is ready for the user's diff view **once SA comments 1 and 2 land and the `app/admin/users` + `lib/business-os/purge` suites are re-run green**. Edge Cases 1–4 are optional (1 = SA Low 3). The browser checks above are owed by the user.
- [ ] Issues found: Dev must address before commit

---

## Commit Info

*(RM populates. Dev leaves all changes uncommitted until the user has seen the diff.)*

---

## Change History

| Date | Change | Details |
|------|--------|---------|
| 2026-10-06 | Created (Dev) | Workplan only, no source changes, branch `feature/admin-delete-ad2-commit` from `origin/main` @ `4c1b630a`. Findings: the AD-1 preview's fixed options still carry `agents: true`, which 3b now refuses permanently (OQ-1 (c)); the delete-graph verdict is not in R-8; the 3b orchestrator assumes actor = target and audits non-awaited; `checkAdminStatus` can fall back to a stale cache; the internal commit route logs an email. Design: HKDF-signed preview token (C-6…C-12 + SA-3 fingerprint, surface-agnostic for slice 5), commit route with two refusal evaluations (entry, and a `preCommitGate` immediately before the RPC), admin-owned audit rows (no migration), post-commit invite revoke. No new DB object. Split AD-2a (server, ~3 d) / AD-2b (dialog, ~1.5 d), both inactive. 4 business and 10 technical questions |
| 2026-10-06 | **SA workplan review: APPROVED WITH CONDITIONS** | T-1 A (supersedes "operator class" wording; BQ-4 "no" → option B + migration); T-2 `writeNow` signed off under rule 7 (fail closed incl. audit disabled; outcome row too); T-4 hook verdict-only, 3b order kept, required on the admin arm of a discriminated union (T-7 derived, not a flag); T-5/T-6 accepted (HKDF, never raw key; README rotation line); T-8 fresh read, no stale fallback; T-9 in scope; T-10 per BQ-1 (switch → prod QA proves `admin_delete_disabled`, don't flip it). Conditions AC2-1…AC2-14 incl. kill switch before token verify, `confirmation.ts` must not fail open on a read error, bound `confirmKind`. Corrections: cache TTL is 60 s, audit hash is per-entry. SC-2 amended to `agents: false`. Split accepted |
| 2026-10-06 | **AD-2a code complete (Dev)** | BQ-1…BQ-4 answered by the user and recorded (requirement UD-12…UD-15). T1–T13 done, uncommitted: preview token + canonical JSON, shared facts, preview mints the token (switch on only), `agents: false`, R-8 delete graph, fresh admin read, shared fail-closed confirmation (internal route's email log removed), orchestrator admin arm with the required gate, `writeNow`, `BUSINESS_DELETION_STARTED`, invite bulk revoke + skipped count, commit composition + route, off switch, census row 98 (95 / 89 + 6 / 66). Inactive: switch default off, RPC held; `supabase/migrations` untouched |
| 2026-10-06 | **SA code review AD-2a: ✅ Code Approved** | All AC2-1…AC2-14 met. Dev rulings accepted (stale token 409 / wrong 400; profile read error 500 on both surfaces; flag in `featureFlags.ts`; `auditDetail` stripped on the admin arm). The 202 deleted lines are verified as moves (helpers to `adminDeletionFacts.ts`, confirmation to `confirmation.ts`) plus planned replacements. `oneAddressPolicy.guard` failure confirmed environment-only (Windows path separator in the guard's `relative()`). 1 Low: `skippedMidSignup` should be null when the revoke failed |
| 2026-10-06 | QA Medium fixed (coordinator) | The two repository allow-list guards updated: `authAccountRepository.callers.guard` adds `AdminDeletionCommit.ts`, its test and the commit route test; the billing guard names `adminDeletionFacts.ts` (the read moved there verbatim) in sorted position. `lib/repositories` + purge + admin users = 83 suites / 1,723 tests green; `test:authz-guard` 119/119; eslint exit 0. SA Low (`skippedMidSignup` null on revoke failure) applied by the coordinator, test added by QA |
| 2026-10-06 | **AD-2b code complete (Dev)** | T14–T17 on `feature/admin-delete-ad2b-dialog` (from the AD-2a branch), uncommitted, no PR. Typed confirmation only with a token and no blocking refusal; `{ token, confirmText }` to the commit route; progress, completed / refused / unknown outcomes, every code a plain sentence, no server text rendered; row refresh on close; commit wire types pinned in the existing wire-type test. Render tests +27, source guard rewritten for AD-2b. Follow-ups noted for SA (stale `PLATFORM_UNAVAILABLE_REASON`, preview's "login closed" kept line) |
| 2026-10-06 | **SA code review AD-2b: ✅ Code Approved (conditional)** | Rulings accepted: `{ token, confirmText }`, reload on close, client match on the server's normalisation (server authoritative), 500/unknown/network → "not known". All TL checks pass; 278/278 admin users tests; `typecheck:bos-llm` 0 new. Conditions, both to land IN AD-2b: (1) `PLATFORM_UNAVAILABLE_REASON` becomes `CONFIRMATION_PENDING_REASON` = "the typed confirmation below has not been entered yet", and the not-installed variant is reworded; (2) the preview kept list says the login stays open under AD-2. Low: hedge the `commit_failed` copy |
| 2026-10-06 | **QA AD-2b: pass (pending SA comments 1–2)** | 27 suites / 638 tests green; QA extras (overlay/X/Close blocked while deleting, refused close does not reload, every code has a sentence, 200-no-code and unparseable 502 → unknown, close+reopen re-fetches); mutation (raw message) → 13 render failures, restored byte-exact; `typecheck:bos-llm` 0 new; authz 119/119; tsc 0 in changed files; eslint 0 errors; full `npm test` nothing new outside quarantine. Edge: `commit_failed` certainty (= SA 3), malformed-200 crash, no in-flight ref, guard regex shape-sensitive. Browser checks owed by user |
| 2026-10-06 | **AD-2b review fixes (Dev)** | SA comments 1–4 and QA edges applied, uncommitted: confirmation-pending / not-installed preview reasons (one wording deviation, forced by the FALSE_REASSURANCE invariant), "login stays open" kept lines (AD-3 flip-back noted), hedged `commit_failed`, malformed-200 guard, in-flight ref, stricter raw-message source guard. 31 suites / 710 tests, `typecheck:bos-llm`, scoped tsc and eslint all exit 0 |
