# Workplan: Test-Account Cleanup from the Danger Zone, slice 1 (server path)

> **Last Updated**: 2026-10-07

**Developer:** Dev
**Requirement:** [TEST_ACCOUNT_CLEANUP_DANGER_ZONE_REQUIREMENT.md](/docs/requirements/TEST_ACCOUNT_CLEANUP_DANGER_ZONE_REQUIREMENT.md) (§8.1 user decisions and §12 SA-1 to SA-12 are binding)
**Branch:** `feature/test-account-cleanup-danger-zone`
**Date:** 2026-10-07
**Status:** Slice 1 merged (PR #249). First-live-run fix code complete on `fix/test-account-cleanup-insight-links` (uncommitted, SA approved for QA with C-1 to C-3, C-2/C-3 done). Slice 2 UI merged (PR #253)

## Overview

Slice 1 of the requirement: the whole server path for running the generated test-account cleanup from admin-only routes over a direct Postgres connection (option (c)). The design is already ruled in detail by SA, so this workplan is a short task list mapped to the SA conditions. Slice 2 (the Danger Zone UI) is not part of it.

## Task List

| # | Task | SA | Status |
|---|---|---|---|
| 1 | `pg` + `@types/pg` dependency (lockfile: only the pg packages added) | SA-2 | ✅ |
| 2 | `lib/server/operatorPostgres.ts`: the only reader of `SUPABASE_DB_URL`, `server-only`, one `Client` per request, SSL on, URL `ssl*` params stripped, 10 s connect timeout, `end()` on a failed connect; unset = not configured | SA-1, SA-2, SA-11 | ✅ |
| 3 | Generator split into exported builders (`buildCheckBody`, `buildDeleteBody`, `buildDeleteReport`); also writes `lib/business-os/test-account-cleanup/cleanupSql.generated.ts`; the audit insert reads `cleanup.actor_id` / `cleanup.source` (pasted SQL unchanged in behaviour); drift test covers the TS file; OX-1r header | SA-4, SA-5, SA-7 | ✅ |
| 4 | `lib/repositories/TestAccountCleanupRepository.ts`: `check` (`BEGIN READ ONLY`), `remove` (`BEGIN`, block, report before `COMMIT`), both with `SET LOCAL statement_timeout = '45s'` / `lock_timeout = '5s'`, values only via bound `set_config($n)`, `ROLLBACK` + `end()` on every failure, `P0001` = blocked; `emptyStorage` (exact check paths, descriptor buckets, target folder only, batches of 1000, service-role storage documented) | SA-3, SA-6, SA-10 | ✅ |
| 5 | `lib/business-os/test-account-cleanup/runCleanupDelete.ts`: G-3 first, check, storage only when every blocker is G-12, then the delete (its own G-12 re-check); residue case "files removed, account kept" | SA-6 | ✅ |
| 6 | Routes `GET`/`POST /api/admin/test-account-cleanup/check` (GET = the "configured" probe) and `POST .../delete`: `requireAdmin` first, Zod `.strict()` (free-text tag, only empty refused), 503 when unset, `runtime = 'nodejs'`, `maxDuration = 60`, pg detail only behind the development guard | SA-9, SA-11, SA-12 | ✅ |
| 7 | New event `BUSINESS_TEST_ACCOUNT_REMOVAL_REFUSED` (warning, SOC2, `bos`), written by the delete route via `logAndFlush` on every refused / failed attempt; guard ids, target id, correlationId; no email, no tag; pinned counts 184 → 185, bos 39 → 40 | SA-5 | ✅ |
| 8 | `adminGate.writes.test.ts`: 3 handlers added (61 → 64), `pg.Client` and storage removals recorded as touches. Authz census: no count to update (floor only) | SA-9 | ✅ |
| 9 | `no-deletion-paths` guard family 4 (`DELETE FROM auth.users`, any case), own allow-list of exactly `cleanupSql.generated.ts`, plus a negative fixture | SA-8 | ✅ |
| 10 | OX-1r splices (insert-only) next to D3, D14, UD-1; runbook; generator header | SA-7 | ✅ |
| 11 | `.env.example` with a placeholder and "Production only, never Preview" | SA-1 | ✅ |
| 12 | Jest only, no DB: fake `pg` and Storage; new + affected suites, authz guard, `typecheck:bos-llm`, scoped tsc, eslint | SA-12 | ✅ |

## Deviations and notes for SA

- **`.env.example` did not exist** and `.gitignore` ignores `.env*`. Created it and added `!.env.example` to `.gitignore`.
- **SSL verification:** `ssl: { rejectUnauthorized: false }`. The connection is encrypted, but the certificate chain is not verified, because the Supabase pooler certificate comes from Supabase's own CA, which is not in Node's trust store. Verifying it would need the CA certificate as one more setting. SA to rule whether that is needed.
- **G-3 is checked by the route as well, before the storage step**, so a wrong confirmation can never remove files. The SQL block still checks it too.
- **Partial storage failures do not stop the run.** The delete's own G-12 re-check decides, as SA-6 describes. Only an exception from the storage step stops it.
- **A delete attempt refused with 503 (not configured) is audited too**, under the same refused event (BQ-5). Checks are never audited.

## SA Review Notes

**Code Review by SA — 2026-10-07 (slice 1, server path)**
**Status:** 🔄 Fix Required (one High; approve on fix, no re-review of the rest)

### Rulings on Dev's flagged items

1. **TLS: verification is required.** `rejectUnauthorized: false` on a database-owner connection is MITM-able (anyone on the path can present any certificate and read the password plus every row). Implement:
   - Download the Supabase root CA (Dashboard > Database > SSL Configuration > Download certificate, `prod-ca-2021.crt`). It is public, not a secret.
   - Commit it as `lib/server/supabaseRootCa.ts`, `export const SUPABASE_ROOT_CA_PEM` as a template literal with **real newlines, no `\n` escapes** (backslash escapes in Tailwind-scanned files have broken `next build` before). Put the cert's SHA-256 fingerprint and download date in the header comment. A `.ts` constant, not a `.crt` read with `fs`, so Vercel file tracing cannot drop it.
   - `ssl: { ca: SUPABASE_ROOT_CA_PEM, rejectUnauthorized: true }`. Do not pass `checkServerIdentity`: Node's default hostname check must stay on. Keep the `sslmode`-stripping.
   - Test: the constructed config has `rejectUnauthorized === true` and a `ca` containing `BEGIN CERTIFICATE`; and `rejectUnauthorized: false` appears nowhere under `lib/server/`.
   - Runbook line: the first prod check must connect. If the pooler certificate does not chain to that CA, stop and escalate to SA. Never fall back to `false`.
2. **package-lock.json:** verified. 151 lines added, 0 removed. Only `pg`, `@types/pg` and their deps (`pg-*`, `pgpass`, `postgres-*`, `xtend`). Nothing else touched. No regeneration needed.
3. **Shared node_modules:** add-only copy accepted. Every CI workflow runs `npm ci` from the lockfile, so the shared folder has no effect on CI.
4. **`.env.example`:** placeholders only (`<project-ref>`, `<password>`, `<region>`). `!.env.example` re-includes that one file only: `.env`, `.env.local` and `.env.production` are still ignored (checked with `git check-ignore`).
5. **Behaviour:** all as SA-6 / BQ-5 require. G-3 runs before the check and the storage step. Partial storage failures continue and the delete's G-12 decides. A 503 delete is audited. Check and probe are never audited.

### Verified against SA-1..SA-12

`SUPABASE_DB_URL` read only in `operatorPostgres.ts` (guard test, assembled name). One `Client` per request, `end()` in `finally` on every path, ROLLBACK on error. `BEGIN READ ONLY` for the check, then `SET LOCAL` 45 s statement / 5 s lock. Values only via bound `set_config($n)`; the generated bodies have no `set_config`, no comments, no placeholder (drift test). Report is read before COMMIT. `requireAdmin` first, Zod `.strict()` before connect. Writes gate 61 -> 64, no-deletion-paths family 4 with its own allow-list + staleness check, audit pin 185/40. OX-1r splices in the two requirements are insert-only. Pino logs only ids, guard ids, counts, elapsed and `{code,message}`. No error details outside the dev guard. No new CI job. The 6 affected suites pass (440 tests).

### Code Review Comments

1. `lib/server/operatorPostgres.ts` (ssl option): see ruling 1. Priority: **High**
2. `app/api/admin/test-account-cleanup/delete/route.ts` outer `catch`: an unexpected throw (for example from `runCleanupDelete` after files were removed) is logged but not audited, and has no `correlationId`. Call `auditRefused` with `reason: 'unexpected_failed'` and return `correlationId`. Priority: Low (fix with item 1)

### Optimisation Suggestions

- `connectOperatorPostgres`: refuse a URL on port 6543 (transaction pooler) with `OperatorPostgresNotConfiguredError`, so SA-2's session-pooler rule is enforced, not only documented.

### Code Approved for QA: No. Yes once item 1 is done (item 2 alongside). SA only needs the `operatorPostgres` diff and its test.

### Dev response to SA review (2026-10-07)

1. TLS: `lib/server/supabaseRootCa.ts` (`SUPABASE_ROOT_CA_PEM`, real newlines, no backslashes); `ssl: { ca, rejectUnauthorized: true }`, no `checkServerIdentity`; tests pin `rejectUnauthorized === true`, a `ca` with `BEGIN CERTIFICATE`, no `rejectUnauthorized: false` under `lib/server/`, and no backslash in the CA file; runbook line added. ⬜ **The PEM is still a PLACEHOLDER**: `prod-ca-2021.crt` has not arrived yet. Fingerprint and download date go in the header when it does. Until then every connection fails verification (the safe failure).
2. Delete route outer catch: writes the refused row (`unexpected_failed`, through `logAndFlush`) and returns `correlationId`. Test added. ✅
3. Port 6543 (transaction pooler) counts as not configured: `isOperatorPostgresConfigured()` is false, `connectOperatorPostgres` throws `OperatorPostgresNotConfiguredError`, the routes answer 503. Tests added. ✅

### SA re-ruling: option A, secret-gated RPC (2026-10-07)

**Status:** 🔄 Revision Required. The user replaced option (c) (2026-10-07). Rework slice 1 to requirement §12 "SA re-ruling" R-1 to R-9, which is binding. Do not commit. After the rework, SA code review covers only the delta.
1. Delete: `pg`/`@types/pg` (lockfile back to main for them), `lib/server/operatorPostgres.ts`, `lib/server/supabaseRootCa.ts`, `lib/server/__tests__/operatorPostgres.test.ts`, `SUPABASE_DB_URL` (`.env.example`, runbook), the 6543 rule, `cleanupSql.generated.ts`. The earlier TLS ruling and the placeholder PEM are moot (R-5).
2. Generator: builders without the `DO` wrapper or trailing `;`. They emit the migration and rollback (R-1 to R-4) and a generated `CLEANUP_FUNCTION_VERSION`. The drift and paste-safety tests cover the migration and rollback, and a migration test pins the grants, `SECURITY DEFINER`, `search_path = ''` and the absence of any secret literal.
3. Repository: `supabaseServer.rpc` with the client and secret injected, the jsonb parsed with Zod, `P0001` as blocked and `42501` as 503. `runCleanupDelete` checks the version before storage (R-6). SA-6 ordering is unchanged.
4. Routes: 503 when `TEST_CLEANUP_SECRET` is unset. One server-only reader with its Jest guard. `adminGate.writes`: "no rpc call and no storage call" is the nothing-happened assertion. The secret is never logged or returned (R-5).
5. Guards and docs: family 4 roots plus the rpc-name assertion (R-7). OX-1r reworded in the generator header, runbook, D3, D14 and UD-1 splices (insert-only). The runbook gets the R-3 hash steps and the R-9 ops and rollback steps, including the timeout check.

### Dev response to the option A re-ruling (2026-10-07)

| Item | Done |
|---|---|
| 1. Removed `pg`/`@types/pg` (package.json and lockfile identical to the branch base), `operatorPostgres.ts`, `supabaseRootCa.ts`, their test, `SUPABASE_DB_URL`, the 6543 rule, `cleanupSql.generated.ts`. The 14 pg folders copied into the shared node_modules were removed (none is in main's lockfile; `split2` was already there and stays) | ✅ |
| 2. Generator builders without the `DO` wrapper or trailing `;`; the pasted files wrap them (byte-identical apart from the earlier audit line). Emits `supabase/migrations/20261041_operator_test_account_cleanup.sql` (`FUNCTION_MIGRATION`; origin/main's latest is 20261040), its rollback in `supabase/SQL Scripts/`, and `cleanupFunctionVersion.generated.ts` (only `CLEANUP_FUNCTION_VERSION`, the first 16 hex of the sha256 of the function SQL). Drift, paste-safety and function pins (definer, `search_path = pg_catalog, public, pg_temp` with `pg_temp` last (SA review), the opening guard that aborts when anon or authenticated may CREATE in schema public, plain `CREATE SCHEMA`, grants, secret first by sha256, 42501, read-only check, five settings, `admin_page`, null actor refused, `lock_timeout`, no `statement_timeout`, no hex literal, `NOTIFY` last) | ✅ |
| 3. Repository: `supabaseServer.rpc` (client and secret injected), jsonb parsed with Zod, P0001 = blocked, 42501 = `not_authorised`, PGRST202 = `function_missing`. `runCleanupDelete` refuses `function_out_of_date` before storage (R-6) | ✅ |
| 4. Routes: 503 when `TEST_CLEANUP_SECRET` is unset, refused (42501) or the function is missing (delete: audited as refused). `lib/server/testCleanupSecret.ts` is the only reader (Jest guard). Writes gate: "no rpc call and no storage call" | ✅ |
| 5. Family 4 also scans `.sql` under `supabase/migrations` and `supabase/held` (not their `__tests__`, which plant the shape as fixtures); allow-list = the migration. Function name only in the repository (guard). OX-1r reworded (my uncommitted splices rewritten, still insert-only vs main), runbook §6 (migration, PowerShell secret + hash, hash-only insert, Vercel Production only, privilege, schema and timeout checks, live run, rollback) | ✅ |

Notes for SA:
- `business-os-credit-lots.migration.test.ts` L8 had to be re-pinned on purpose: the new migration names `business_os_credit_charges`/`_totals` (deletes by user_id only, no charge function, column or grant).

**Code Review by SA, 2026-10-07 (option A rework, secret-gated RPC)**
**Status:** Fix Required (one High item, mechanical)

### Ruling on the flagged risk: `search_path = ''` (measured, repo-only, no prod access needed)

G-17 blocks every non-allow-listed DELETE trigger on plan tables, on tables with an FK to `auth.users`, and on inbound child tables. So the DELETE triggers that can fire are bounded to the four allow-listed ones, plus anything on `auth.users` (reported as info only, never blocked):

| Trigger (table) | Function | Own search_path? | Unqualified names | Under `''` |
|---|---|---|---|---|
| `recompute_transaction_refund_state_trigger` (payment_refunds, AFTER DELETE, plan step 6) | `recompute_transaction_refund_state()` (20260903b) | No (INVOKER) | `payment_transactions`, `payment_refunds` | **Fails** for any account with a refund row |
| `trigger_update_storage_used` (storage_usage) | `update_user_storage_used()` (SQL Scripts/20251117) | No (SECURITY DEFINER does not change the path) | `user_subscriptions`, `storage_usage` | **Fails** for any account with a quota row |
| `trigger_update_storage_on_delete` (storage_usage) | dashboard-only, not in the repo | Unknown | Unknown | Treat as unsafe |
| `trg_mce_guard` (marketing_consent_events) | `marketing_consent_events_guard()` | No | none relevant | Never fires (G-14) |
| Second order: the refund trigger's `UPDATE payment_transactions` fires its UPDATE triggers (`log_payment_activity`, `update_invoice_on_payment`, INVOKER per 20261004 notes); the storage trigger updates `user_subscriptions` | n/a | No | Likely | Not covered by G-17 (DELETE bit only) |
| `auth.users` DELETE triggers | prod-only, if any | Unknown | Unknown | Reported, not guarded |

"Fails closed" is true, but it means the tool cannot remove any test account that ever recorded a refund or a file upload, which is the normal test account. That is a functional defect, not an edge case.

**Decision: do not keep `''`, and do not edit the live trigger functions in this slice.** Use a fixed path that matches the SQL-editor session in which the pasted operator script (the reviewed baseline) runs:

`SET search_path = pg_catalog, public, pg_temp`. `pg_temp` must be named **last**: if left out, it is searched first for relations.

Shadowing risk, assessed: built-ins cannot be shadowed (pg_catalog first), temp objects cannot shadow (pg_temp last), and every table the function itself names stays schema-qualified. Unqualified names inside the trigger functions resolve to `public`, which is exactly how they resolve for every normal caller today. So this adds no exposure beyond the existing baseline. anon/authenticated reach the database only through PostgREST, which cannot run DDL. To make that measured rather than assumed, the migration must start with a guard that aborts if `has_schema_privilege('anon', 'public', 'CREATE')` or the same for `authenticated` is true. Write the abort message without the word "into" (SQL editor bug).

### Code Review Comments
1. `scripts/generate-test-account-cleanup-sql.ts:1139`: change to `SET search_path = pg_catalog, public, pg_temp`, add the CREATE-privilege abort guard at the top of the migration, regenerate (the version stamp changes; the drift test pins it), and update the pin at `scripts/__tests__/testAccountCleanupSql.test.ts:475-477` plus workplan item 2 and runbook §6. Delete the "stop and escalate" risk note once it is fixed. Priority: **High**
2. Runbook §6 live run: before the first live delete, run one read-only introspection and paste the result here: `SELECT tgname, tgtype, tgfoid::regproc FROM pg_trigger WHERE tgrelid = 'auth.users'::regclass AND NOT tgisinternal`, plus the `proconfig`/`prosrc` of `trigger_update_storage_on_delete`'s function. Pick the first live target with at least one `payment_refunds` row and one `storage_usage` row, so the trigger path is exercised deliberately and not by accident. Priority: Medium
3. Follow-up, not this slice: G-17 checks only the DELETE bit, so UPDATE triggers reached through the refund/quota recomputes or `ON DELETE SET NULL` are not reviewed. Record this as an open item in the requirement. Priority: Low

### Verified (no change needed)
- package.json / lockfile byte-identical to origin/main. No `pg` / `@types/pg` / `pg-*` in the shared node_modules (worktree uses the junction). No `pg` import anywhere.
- L8 re-pin in `business-os-credit-lots.migration.test.ts`: justified. It is an exact-file allow-list entry for the one generated migration, with the reason in a comment, and the pinned charge function, columns and grants are untouched.
- Grants: function REVOKE PUBLIC/anon/authenticated, GRANT service_role, OWNER postgres. `operator_private` schema and table REVOKE ALL incl. service_role, RLS on, not a PostgREST-exposed schema. Secret check is first: sha256 compare, length ≥ 32, 42501. Mode validated. Null actor refused on delete. Check sets `transaction_read_only`. Settings are set only from parameters, `source = admin_page`, `lock_timeout` 5s, no statement_timeout. No secret, hash or hex literal in the migration. `NOTIFY pgrst` last in both files. "into" appears only as the `INSERT INTO` keyword.
- `TEST_CLEANUP_SECRET` is read only in `lib/server/testCleanupSecret.ts`, and the function name appears only in the repository (both guarded). The rpc args are never logged, and audit/log fields carry ids, guards and counts only.
- Routes: `requireAdmin` first, Zod `.strict()`, 503 before any DB call when unset, 42501/PGRST202 become 503 (delete audited as refused via `logAndFlush`). The version check refuses before `emptyStorage` (R-6). Error format and dev-only details are correct. The adminGate.writes fake now records storage touches.
- 8 affected suites green locally (573 tests). All are Jest in the existing shards, so no added CI time.

### Code Approved for QA: No. Yes once item 1 is done and the regenerated drift and pin tests pass. SA needs only the generator diff, the migration head and the test pin. Item 2 is a pre-live-run gate for the runbook, not a QA blocker.

**SA re-check, 2026-10-07: Code Approved for QA.**
- Item 1 is done:
  - The function has `SET search_path = pg_catalog, public, pg_temp`, with `pg_temp` last.
  - `DO $create_guard$` is first, before `CREATE SCHEMA`, and its message does not contain "into".
  - The regenerated stamp `99c4c83979a96efc` matches the TS constant.
  - The pins at L475+ cover the path, the guard order and the schema-qualified names. The suite passes (84 tests).
- Item 2 is in runbook §6.6 as a step before the first live delete.
- Item 3 is open item OI-1 in the requirement.
- Line 83 above still reads `search_path = ''`. It is the original re-ruling text, kept as history.

### Dev response to the SA code review (search_path)

1. `SET search_path = pg_catalog, public, pg_temp` (pg_temp last); every table the function names stays schema-qualified (pinned by test). Regenerated: the version stamp changed, pinned by the drift test. ✅
2. The migration opens with a `DO $create_guard$` block that aborts when `anon` or `authenticated` holds CREATE on schema public (no "into" in its message). Pinned. ✅
3. Runbook §6.6 gained the required read-only introspection before the first delete, and the advice to pick a first target with a refund row and a storage-quota row. The "relation does not exist, escalate" note is gone. ✅
4. G-17 open item recorded in the requirement (insert-only). ✅

---

**Code Review by SA, 2026-10-07 (slice 2, Danger Zone panel, UI short path)**
**Status:** 🔄 Fix Required (small; QA may run in parallel, SA re-check needs only items 1 and 2)

Scope: `components/business-os/purge/TestAccountCleanupPanel.tsx`, `lib/business-os/test-account-cleanup/cleanupApiTypes.ts`, `components/business-os/purge/__tests__/TestAccountCleanupPanel.render.test.tsx` (31 tests, passing locally), the 4-line mount in `PurgeDangerZone.tsx`, `docs/BUSINESS_OS_TEST_PAGE_SCOPE.md`, requirement change-history row.

### Ruling on Dev's flag (hand-copied client types)

A wire-type pin is required, and the pin is leaner than a shared types file. A shared file would make the client import from the repository module (`server-only`) or move the repository's types out of it. The precedent is `lib/business-os/purge/__tests__/adminDeletionPreview.wireTypes.test.ts`: add **one file**, `lib/business-os/test-account-cleanup/__tests__/cleanupApiTypes.wireTypes.test.ts`, and list that single path in `SCOPED_DIRS` in `scripts/typecheck-bos-llm.ts`. That puts it in the required type-check job, which already runs, so CI time does not grow. `cleanupApiTypes.ts` keeps importing nothing. The pin is a test that the client never imports, and it imports the repository with `import type` only.

### Code Review Comments

1. `cleanupApiTypes.ts` — add the wire-type pin above, assignable in both directions (`Satisfies<A, B>` both ways), for:
   - `CleanupCheckView` ⇔ `CleanupCheckResult & { functionUpToDate: boolean }`
   - `CleanupCheckRowView` ⇔ `CleanupCheckRow`
   - `CleanupBlockerView` ⇔ `CleanupBlocker`
   - `CleanupStorageObjectView` ⇔ `StorageObjectRef`
   - `CleanupReportView` ⇔ `CleanupReport`
   - `CleanupDeleteView` ⇔ `Omit<Extract<CleanupDeleteOutcome, { kind: 'removed' }>, 'kind'>`

   Also export a `CleanupDeleteErrorCode` union from the client file (`confirmation_mismatch | blocked | not_configured | not_authorised | function_missing | function_out_of_date | check_failed | storage_failed | delete_failed | invalid_body`). Pin it both ways against the server's `refused['reason'] | CleanupUnavailableReason | \`${failed['stage']}_failed\`` plus the route's `invalid_body` / `not_configured`. Without that pin, a new server code falls through to the generic sentence and nothing tells anyone. — Priority: **High** (Dev flag)
2. `TestAccountCleanupPanel.tsx:53-56` `canOfferDelete`: `every()` is true on an empty list, so a BLOCKED verdict with zero blockers would offer Delete. The server still refuses, but this does not meet the rule "OK, or BLOCKED with only G-12". Change it to `verdict === 'OK' || (blockers.length > 0 && blockers.every(G-12))`, and add one render test for BLOCKED with no blockers. — Priority: Medium
3. Dependency on `fix/test-account-cleanup-insight-links` (its worktree has no diff vs main yet, so judged from the description). The panel renders rows **by section name**: `remove`, `trigger` (shows only `row.item`) and `kept`. Storage comes from `storageObjects` and guards come from `blockers`. Any other section is **dropped without notice**. So:
   - (a) Changed trigger-event wording flows through if it stays in `item`. It disappears if it moves to `detail`, so render `detail` for trigger rows too.
   - (b) "New reviewed links" will not show if they arrive under a new `section` value. Add a generic fallback list for unrecognised sections now, or the fix branch must add its section to the panel.
   - (c) The new migration/version needs nothing from the client, because `functionUpToDate` is computed on the server. Between that merge and the migration apply, Delete is not offered and the out-of-date note shows. That is expected and the runbook should say so.
   - Whichever branch merges second should re-run this render test, because its fixtures copy the current row shapes. — Priority: Medium

### Verified (no change needed)
- **Admin only.** The mount is inside the `access.allowed` branch, and `allowed` comes from `AdminAccessService.isAdmin` (`admin_users`). Non-admins return earlier, so no probe is sent (tested). The panel's own 401/403 probe returns `null`. Every route gates with `requireAdmin` first.
- **Not configured.** The note points at runbook §6, and the inputs and Check are disabled. If the probe fails, the panel shows "unknown" and stays disabled.
- **Tag.** Free text; only an empty or whitespace-only tag is refused, on the client and in the Zod `min(1)`.
- **Delete gating.** Delete needs a current check, `functionUpToDate`, and a non-null `targetUserId`. Editing the email or the tag discards the check. The confirmation must equal the email after trimming and lower-casing. A shared `useRef` in-flight guard covers both Check and Delete, and the button shows "Deleting…".
- **Server text.** Errors are one sentence chosen from the error code. `message` and `details` are never rendered (pinned by a source test). `clears` and `detail` are rendered, but they are check content from the generated function, not error text.
- **No email leaks.** `onLog` carries only codes and counts. `onResponse` is not passed, so nothing reaches the shared viewer.
- **No server imports.** Guarded by a source test: the only `@/` import is the types file.
- **Accessibility.** Inputs sit inside their labels, the section has `aria-labelledby`, and outcomes use `role="alert"` / `role="status"`.
- **Styling** matches the Danger Zone: the same `box`, the `#dc3545` border and the same palette. There are no `console.*` calls in either touched component.

### Optimisation Suggestions
- `PurgeDangerZone.tsx:212` (existing code, outside this diff) logs the **admin's own** email to the debug console on access. It is not the target's email, so no action is needed for this slice.

### Code Approved for QA: Yes, in parallel. Not approved for commit until items 1 and 2 are done. Item 3 can be done here (recommended: the fallback and trigger `detail`) or handed to the fix branch, but the decision must be written down.

**SA re-check, 2026-10-07 (slice 2): Code Approved.**
- Item 1 is done. `__tests__/cleanupApiTypes.wireTypes.test.ts` pins seven pairs in both directions: check, blocker, row, storage, report, delete and the delete error codes. That is 14 `Satisfies`. It is listed as a single path in `SCOPED_DIRS`, and a planted drift failed with TS2344. The panel's sentences are now `Record<CleanupDeleteErrorCode, …>`, so the compiler rejects a missing code.
- Item 2 is done on the client (`verdict==='OK' || (≥1 blocker && all G-12)`). It is also done on the server in `runCleanupDelete.ts`, using the same predicate, and this only makes the server stricter. The new route test asserts a 409 and that only the check RPC runs: storage is not called and the delete does not run.
- Item 3 is done here. `KNOWN_SECTIONS` sends every unrecognised section to "Other rows", and trigger rows now show `detail`. The fix branch no longer needs to change the panel; it only re-runs the render test.

---

**Code Review by SA — 2026-10-07 (first-live-run fix, branch `fix/test-account-cleanup-insight-links`, content only; migration 20261043 provisional)**
**Status:** Code Approved for QA, with conditions C-1 to C-3

1. **Classification.** `insight_hypotheses` and `insight_measurements` as `reset` / insights / LEAF is right: business-derived data, siblings of `insight_actions` and `owner_insight_history` (reset), and `insights` itself is reset. LEAF (300) before `insights` (ROOT 500) is required for measurements, so its own count is reported instead of a silent cascade. Hypotheses has no blocking edge either way. Baseline 149 and dated `TAC-1` review notes: accepted.
2. **LIVE_ONLY exception, no capture migration here.** A `CREATE TABLE IF NOT EXISTS` written without the measured DDL (columns, defaults, indexes, RLS, policies, grants) is a no-op on prod and a divergent invention on any fresh database, which is worse than no file. Capture belongs to the core-schema-capture backlog, from a measured dump. The self-expiring test (fails once a CREATE TABLE appears) is the correct guard. **C-1:** add both tables to that backlog item, and record their `relrowsecurity` and policy list from one read-only introspect in the descriptor notes. Prod-only tables with `user_id` and no known writer are an RLS unknown; not blocking this fix.
3. **G-18 skip 1, `owner_is_target`. Provably zero.** It applies only when the parent is a direct plan table (`parent_table IS NULL`), the FK references the parent key column (`parent_column = key_column`), and the child FK column is the owner column. Then every referenced value is in `{p.key_column : p.key_column = target}` = `{target}`, so `child.owner = child.fk = target`, and `IS DISTINCT FROM target` is false. NULL FK values never pass `IN`. Another owner's rows cannot match, because their FK value would have to equal target. `insight_measurements_insight_id_fkey` (id, not key_column) is correctly not skipped.
4. **G-18 skip 2, parent probe `found = 0`. Provably zero.** It runs the same table and the same `parent_predicate` as the count's `IN` subquery, so an empty probe means an empty `IN` set. A missing probe row gives NULL, `NULL = 0` is not true, and the full count runs (fails closed). The probe and count are separate SPI snapshots, but that is the same point-in-time window every G-18 count already has. Not a new weakening. **Survivor dedup:** the excluded FK columns are exactly `(public, table, key_column)` pairs already counted with the identical predicate, and a table that has an FK exists, so `to_regclass` cannot drop it. Equivalent. Only the item label changes.
5. **Timeout. Keep 8 s, no role change.** A timeout in either mode rolls back the single PostgREST transaction, so it fails safe: nothing is removed. `ALTER ROLE service_role SET statement_timeout` is **not approved**. It widens every cron, webhook and repository call on the service role, just for a tool used a few times a day. The fallback is already shipped: the pasted operator files in the SQL editor run the same generated guards with no 8 s cap (runbook §1 to §5). **C-2:** return the server-side duration (`clock_timestamp() - statement_timestamp()`, ms) in the function's jsonb and log it next to `elapsedMs` in both routes. `elapsedMs` includes network and cold start. **C-3:** the delete does more than the check (deletes, survivor scan, report). Runbook §6.6: if the server-side check time is above 3 s, or any delete times out, use the pasted path for that account and bring the numbers to SA. Do not change role settings.
6. **Trigger wording.** Accepted. The `tgtype` bits are correct (4 INSERT, 8 DELETE, 16 UPDATE, 32 TRUNCATE), and showing "Does not fire on this delete" for the INSERT-only signup trigger removes the false alarm. Optional: it reports row and statement triggers alike, which is fine for `auth.users`.
7. **Migration.** Shape not reviewed (provisional). On regeneration over plan-payments 20261042, `APPLIED_FUNCTION_MIGRATIONS` must list 20261041 and 20261042 (if 20261042 replaces the function), and the rollback must restore the newest one.

### Code Approved for QA: Yes, with C-2 and C-3 done before the first live delete. C-1 is a tracked follow-up.

### Dev response to the first-live-run SA review (2026-10-07)

- **C-2 done.** The function returns `server_ms` (`clock_timestamp() - statement_timestamp()`, ms) in both modes. The repository reads it (optional, so the 20261041 function gives `null`). The check route logs `serverMs` next to `elapsedMs` and returns it as `data.serverMs` (number or null). The delete route logs and returns `data.serverMs = { check, delete }`, and the refused log carries it too. **Wire field for the slice-2 panel types (`cleanupApiTypes.ts`, not edited here):** check `data.serverMs: number | null`; delete success `data.serverMs: { check: number | null; delete: number | null }`. Executed on the PGlite replica: check and delete both return it. Tests: repository (with and without), route (logged and returned), generator (one RETURN, both modes).
- **C-3 done.** Runbook §6.6: over 3000 ms on a check, or any delete timeout, means the pasted path for that account and the numbers to SA. No role timeout change.
- **C-1 recorded** in both descriptor notes. Read-only: `pg_policies` lists no policy on either table. `insight_hypotheses`: RLS on, inferred (anon has SELECT, sees 0 of 12 rows). `insight_measurements`: RLS flag unknown (empty table, so the probe cannot tell). Neither read `relrowsecurity` directly.
- **Follow-up, core-schema-capture backlog:** add `insight_hypotheses` and `insight_measurements` (prod-only, no CREATE TABLE in the repo, no known writer on any branch). Capture their measured DDL: columns, defaults, indexes, `relrowsecurity`, policies, grants, and the two `_business_fk` constraints plus `insight_measurements_insight_id_fkey`. Then remove the LIVE_ONLY exception in `businessOwnedTables.test.ts` (it fails by itself once a CREATE TABLE appears). Find who writes them (12 rows exist).
- **Migration stays provisional** (20261043). It will be regenerated on the plan-payments generator after their 20261042 merges.

**SA re-check — 2026-10-07 (rebuilt on main after #251; stamp 6793b7e11d0ea391)**
- (a) Rollback test accepting `CREATE OR REPLACE` in the previous file: not a weakening. The expected text still comes from the previous file, whose bytes are pinned by sha256. Both sides are normalised the same way, and the rollback must still contain the generated `CREATE OR REPLACE` text exactly.
- (b) The new "never TRUNCATE" regex `TRUNCATE\s+(TABLE\s+)?[a-z_]` **does weaken the guard**. It still catches `TRUNCATE x`, `TRUNCATE ONLY x` and `TRUNCATE public.x`, but it misses a dynamic `format('TRUNCATE %I', ...)` and a quoted `TRUNCATE "x"`. **Fix (Low, cheap):** strip the exact label literal `'TRUNCATE' END` from the text first, then keep the original bare `TRUNCATE` ban.
- Order guard: correct. The insight tables appear only as data in the plan and review VALUES lists, and their deletes and counts are dynamic and gated by `to_regclass`. Nothing in static SQL names them, so they do not belong in `FUNCTION_REQUIRED_TABLES`. They also have no migration to name. `business_os_billing_events` (static, G-5) stays the only entry.
- Wire order with PR #253: land this branch first, because it unblocks every live check. #253 then rebases and adds `serverMs: number | null` (check) and `serverMs: { check, delete }` (delete outcome) to `cleanupApiTypes.ts`, so its two-way pin passes. If #253 lands first, this branch adds them instead.
- Code Approved for QA: Yes, with the (b) fix.

## QA Testing Report

**QA — 2026-10-07**
**Test mode:** full
**Strategy used:** A (Jest: new and affected suites, guards, full suite) + C (the migration and the function **executed** on a local PGlite 0.5.8 / PG 18 replica rebuilt from the existing read-only prod schema dump, in session scratch space outside the repo) + B-lite (a scratch Jest contract test feeding the replica's real jsonb into the real repository and `runCleanupDelete`). Nothing ran against prod, not even introspection.
**Focus:** security, schema, api
**Skipped:** D (no UI in slice 1). The live prod run stays with the user (runbook §6, incl. the §6.6 introspection gate)
**Input source:** prompt keywords

### Replica setup

Roles `anon`, `authenticated`, `service_role` (BYPASSRLS) with Supabase's shape: USAGE on public, ALL on tables, and **default privileges granting anon/authenticated/service_role EXECUTE on new public functions**, so the migration's REVOKE is actually tested. The harness no-op triggers on `payment_refunds` and `storage_usage` were replaced by the **real, unqualified** `recompute_transaction_refund_state()` (20260903b) and `update_user_storage_used()` (SQL Scripts/20251117). `trigger_update_storage_on_delete` stays a no-op (dashboard-only, source not in the repo). Calls are PostgREST-shaped: one transaction, `SET LOCAL ROLE service_role`, ROLLBACK on any error. The secret is 32 random bytes, hashed client-side, only the hash inserted.

### Test Coverage

| Acceptance Criterion | Tested? | Result | Notes |
|---|---|---|---|
| Create guard aborts when anon/authenticated may CREATE on public | ✅ | Pass | Granted CREATE to `anon`, to `authenticated`, and to `PUBLIC` in turn: each aborts with "Revoke that first", and neither `operator_private` nor the function exists afterwards. Message has no "into" |
| Grants (R-4) | ✅ | Pass | `has_function_privilege` false for anon and authenticated (despite default privileges), true for service_role; an anon/authenticated call is refused 42501. `prosecdef` true, `proconfig` = `search_path=pg_catalog, public, pg_temp`, owner postgres |
| service_role cannot read or change the secret | ✅ | Pass | No USAGE on `operator_private`; SELECT and UPDATE on `operator_private.secrets` refused 42501; `ALTER FUNCTION ... SECURITY INVOKER` as service_role refused 42501; RLS on |
| Wrong or missing secret = 42501, nothing changed | ✅ | Pass | null, empty, 31 chars, wrong 64-hex, trailing space, upper-cased, wrong secret in delete mode: all `42501 not authorised`. No secret or email in any error text. Fingerprint (row count + md5 of every table in public/auth/storage) unchanged |
| Mode and actor checks | ✅ | Pass | unknown mode and null mode 22023; **null actor on delete refused 22023**, zero rows changed |
| Check mode cannot write | ✅ | Pass | After the check, `transaction_read_only` = on and an INSERT in the same transaction fails 25006; the next transaction is read-write again. Check changed zero rows |
| Happy path, account with a `payment_refunds` row and a `storage_usage` row | ✅ | Pass | Check OK (lists both tables). Delete (confirmation `'  NAME+test1@gmail.com '`, normalised) returns `version` + per-table report: 130 tables summing to 141 = TOTAL, `CLEAN`, `same_run` true, `removed_login` = target. The **real** refund and storage-quota triggers fired and resolved their tables. Audit row: `actor_id` = admin, `source` = `admin_page`. Other account's `payment_transactions`, quota and login untouched. A second delete is refused G-1 with zero rows changed |
| The search_path fix is what makes it work (control) | ✅ | Pass | Same migration with `search_path = ''`: the delete fails `42P01 relation "payment_transactions" does not exist` and rolls back fully. With the shipped path it is CLEAN |
| Every blocked path changes zero rows | ✅ | Pass (10/10) | Via the RPC, check then delete, fingerprint before/after: G-2 non-test email, empty tag, blank tag; G-3 wrong and empty confirmation (check OK by design, delete refused); G-1 unknown email; G-4 admin; G-6 active test-mode subscription; G-9 pending payment; G-12 storage object (check returns the full `bucket/name` path). Every delete refusal is `P0001` naming the guard |
| Version stamp = `CLEANUP_FUNCTION_VERSION` | ✅ | Pass | Check and delete both return `99c4c83979a96efc`; recomputed independently as sha256 of the migration's function SQL with the token substituted (matches); stamp occurs once in the migration |
| Rollback removes everything cleanly | ✅ | Pass | Function and `operator_private` (schema + table) gone; no public/auth/storage row changed; rollback re-runs (IF EXISTS); migration re-applies after it; a second apply without rollback fails loudly (`schema "operator_private" already exists`) |
| Pasted SQL unchanged in behaviour | ✅ | Pass | Regenerated `scripts/test-account-cleanup-*.sql` on the replica: check OK, delete CLEAN 141/130, audit `actor_id` NULL, `source` `operator_sql`. Diff vs main is the audit line only |
| Real function output vs real parser (contract) | ✅ | Pass (6/6) | Replica jsonb fed to the real repository + `runCleanupDelete`: OK check parses login id, no blockers; delete report parses CLEAN with per-table sum = TOTAL; G-12-only check removes `website-images` and `contact-documents` paths **before** the delete (`check, storage, storage, delete`); G-12 + G-4 refuses with no storage call and no delete; a real P0001 after files went says "Files removed, account kept"; a real 42501 is `not_authorised` with no storage call |
| Routes: 401/403 first, Zod 400, 503 paths, ordering, refused audit, no secret/email/tag in logs or audit | ✅ | Pass | `route.test.ts` (gate first, Zod `.strict()` 400 incl. missing `confirmEmail`, free-text tag, 503 unset with no rpc call, 42501 and PGRST202 = 503 with delete audited and no storage call, version mismatch 503 before storage or delete, G-12-only storage first, other blockers 409 no storage, G-3 400 audited, residue 409, delete_failed and unexpected_failed 500 with correlationId, secret/email/tag never logged, audited or returned); `adminGate.writes` 401/403 x4 with "no rpc and no storage call" |
| Single readers (secret, function name) | ✅ | Pass | `testCleanupSecret.test.ts` |
| New-api-route minimum cases (happy, 401, 400) | ✅ | Pass | Present for both routes |
| Entitlements registration | ⬜ | n/a | No import from `lib/business-os/entitlements/` in the diff |

### Issues Found

#### Bugs (must fix before commit)
None.

#### Performance Issues (should fix)
None found. Not measurable here: the prod run time of the delete (G-10/G-18 scan the full FK catalog) against `maxDuration = 60` and the `service_role`/`authenticator` statement_timeout. Runbook §6 already makes that a check before the first live delete.

#### Edge Cases (nice to fix)
1. **"Nothing was removed" can be wrong in one race** — File: `app/api/admin/test-account-cleanup/delete/route.ts` (unavailable branch) — Severity: Low. If the check succeeds and files are removed, and then the delete call returns 42501 / PGRST202 (secret row rotated or function dropped mid-run), the 503 message says "Nothing was removed" while `filesRemoved` > 0 is in the same body. The `refused` and `failed` branches already say "Files removed, account kept". Same wording would fit here.
2. **Replica fidelity** (carried from the script QA): loose column types, no CHECK/NOT NULL, minimal `auth`. Not modelled: the dashboard-only `trigger_update_storage_on_delete` body, any `auth.users` triggers, and the second-order UPDATE triggers on `payment_transactions` reached by the refund recompute (OI-1). The runbook §6.6 introspection and a first target with a refund and a quota row cover them on the live run, and the function is atomic, so a failure there rolls back.
3. **Create guard on prod is unmeasured.** If prod grants CREATE on public to anon/authenticated (or PUBLIC), the migration aborts by design. That is safe, but the user then needs the REVOKE first; the abort message says so.

### Test Outputs / Logs

```text
Targeted Jest (41 suites: route, repository, secret guard, testAccountCleanupSql drift + pins, adminGate.writes,
  lib/audit/__tests__, no-deletion-paths, supabase/migrations/__tests__)   41 passed, 1436 tests passed
Tailwind CSS-escape guard                                                 6 passed
npm run test:authz-guard                                                   119 passed
npm run typecheck:bos-llm                                                  passed (28 baseline, 0 new)
tsc --noEmit (full project) filtered to the changed files                  0 errors
eslint on the 14 changed/new TS files                                      0 errors, 1 pre-existing warning (lib/audit/events.ts:1373, not in the diff)
Generator re-run (accidental, by QA)                                       all 5 outputs byte-identical (md5), git status unchanged
Full npm test                                                              968 passed / 15 failed suites; 11 = quarantine list;
  4 outside it, all Windows-env and untouched by this diff: oneAddressPolicy.guard (backslash paths),
  geo/addressFormat, AdminAreaField.render, AdminAreaField.search (Intl/ICU region data)
Replica qa-rpc.mjs                                                         104 PASS, FAILURES: 0
Replica pasted files                                                       check OK, delete CLEAN 141/130, actor NULL, source operator_sql
Scratch contract test (real repo + runCleanupDelete on replica jsonb)     6 passed
```

### Final Status
- [x] Slice 1: all acceptance criteria passed, merged as PR #249 (2026-10-07). The user applied 20261041 and stored the secret hash on prod.
- [x] First live check on prod (2026-10-07) found three issues: G-18 blocked every account (two live-only insight tables), the run time sits close to the 8 s limit, and the trigger section wording was wrong. Fixed on `fix/test-account-cleanup-insight-links` as migration **20261043** (stamp `6793b7e11d0ea391`), chained after 20261042 (plan payments PR #251, applied on prod; its bytes are pinned). SA approved for QA. Re-QA is owed before commit.
- [ ] Owed by the user before the first live delete: apply 20261043 next to the deploy that pins its stamp, then follow runbook §6.6 (server time over 3 s, or a timeout, means the pasted path).

### Re-QA: first-live-run fix (`fix/test-account-cleanup-insight-links`, migration 20261043)

**QA — 2026-10-07**
**Test mode:** full
**Strategy used:** A (Jest: the cleanup suites, guards, full suite) + C (20261041, 20261042 and 20261043 **executed** on a local PGlite 0.5.8 replica rebuilt from the read-only prod schema dump of 2026-10-07 13:12 UTC, which has both insight tables and all three of their FKs, in session scratch space outside the repo). Nothing connected to prod.
**Focus:** schema, security, performance (the two G-18 skips and the survivor dedup)
**Skipped:** D (no UI in this fix). The live prod apply and runbook §6.6 timing stay with the user
**Input source:** prompt keywords

**Replica setup.** The same Supabase-shaped roles and default privileges as the slice-1 QA, plus:
- the real refund and storage-quota trigger functions
- `business_os_billing_events` with its `auth.users` FK
- `REVOKE CREATE ON SCHEMA public FROM PUBLIC`
- an **insert-only** `AFTER INSERT` trigger `on_auth_user_created` on `auth.users`

The insight `_business_fk` links are built as `user_id -> business_profiles(user_id)`, and `insight_measurements_insight_id_fkey` as `insight_id -> insights(id)`. There are two accounts. Each has 2 `insight_hypotheses` rows, 3 `insight_measurements` rows (two of them linked to the account's own insight), a refund and a `storage_usage` row. The migrations are applied as LF text, which is what the SQL editor submits.

| Criterion | Tested? | Result | Notes |
|---|---|---|---|
| Control: 20261042 reproduces the prod block | ✅ | Pass | With the insight tables present, 20261042's check is BLOCKED on G-18 for all three insight links, as seen on prod |
| Order guard | ✅ | Pass | Without 20261041: refused ("Apply 20261041 ... first"), no function created. With 20261041 but no `business_os_billing_events`: refused ("Apply 20261027 ... first"), and the function stays 20261041's. 20261042 refuses on the same condition. See Edge Case 1 |
| Apply after 20261041 + 20261042 | ✅ | Pass | Function replaced; `SECURITY DEFINER`, owner postgres, `search_path=pg_catalog, public, pg_temp`. anon and authenticated have no EXECUTE (despite the default privileges); service_role has it |
| Version stamp | ✅ | Pass | Check and delete both return `6793b7e11d0ea391`. That equals `CLEANUP_FUNCTION_VERSION` in the generated TS, and an independent sha256 of the migration's function SQL (with the token put back). The stamp occurs once |
| Check on a test account with insight rows, a refund and `storage_usage` | ✅ | Pass | OK, no BLOCKED rows; both insight tables are listed to remove; zero rows changed |
| Trigger wording | ✅ | Pass | `auth.users.on_auth_user_created`: "Does not fire on this delete. Events: INSERT." A planted AFTER DELETE trigger reads "Fires when the login is deleted. Events: DELETE." |
| Delete | ✅ | Pass | CLEAN, `same_run`, 146 rows over 132 tables, and the per-table lines sum to TOTAL. The report counts `insight_hypotheses` 2 and `insight_measurements` 3, and both are emptied for the target. Refund and storage lines are present. Audit row: `actor_id` = admin, `source` = `admin_page` |
| Other account untouched | ✅ | Pass | Its hypotheses and measurements keep the same counts and the same md5; its login is kept |
| `server_ms` | ✅ | Pass | A number in both modes: check 321 ms, delete 397 ms on PGlite, which says nothing about prod. Jest covers how the repository and routes handle it |
| Every previously blocked path still blocks, zero rows changed | ✅ | Pass (11/11) | Check, then delete, with a full fingerprint before and after: G-2 (non-test email, empty tag, blank tag), G-3 (wrong and empty confirmation; the check is OK by design), G-1, G-4, G-5 (a live billing event, from 20261042), G-6, G-9, G-12. Each delete refusal is `P0001` and names the guard |
| Perf skip 2 (parent probe `found = 0`) is safe | ✅ | Pass | The target had no insights, so the probe was empty. Add a new target insight plus another account's measurement pointing at it: BLOCKED G-18 `insight_measurements.insight_id to insights`, delete P0001, zero rows changed |
| Non-skipped link still counted | ✅ | Pass | Another account's measurement on the target's existing insight gives the same BLOCKED G-18, P0001, zero rows changed |
| Perf skip 1 (`owner_is_target`) is safe | ✅ | Pass (by construction + count) | On the two `_business_fk` links the FK column is the owner column. So a row pointing at the target's profile is owned by the target, and another account's rows on those links point at their own profile. The full count without the skip, done by hand, is 0, and the check is OK (no false block) |
| Survivor scan after the dedup | ✅ | Pass | A planted `auth.users` AFTER DELETE trigger re-creates an `agent_memories` row for the target. The delete fails `P0001 Rows still name the login after the delete ... agent_memories 1`, zero rows changed |
| Rollback restores 20261042 exactly | ✅ | Pass | `pg_get_functiondef`, ACL, `proconfig`, `prosecdef` and owner match the 20261042 apply exactly. The secret row is kept, and the function returns 20261042's stamp `8169e372b7dfc636`. Re-applying 20261043 gives the same definition and ACL as the first apply and returns `6793b7e11d0ea391`. 20261043 can be re-run (CREATE OR REPLACE). See Edge Case 2 |
| Pasted SQL files | ✅ | Pass | `npx tsx scripts/generate-test-account-cleanup-sql.ts` rewrote all 5 outputs byte-identical (md5), and `git status` is unchanged. On the replica: check OK; delete CLEAN, 144 rows over 132 tables, incl. `insight_hypotheses` 1 and `insight_measurements` 2. The other account kept its rows. Audit row: `actor_id` NULL, `source` `operator_sql` |
| Entitlements registration | ⬜ | n/a | No import from `lib/business-os/entitlements/` in the diff |

#### Bugs (must fix before commit)
1. **SA re-check condition (b) is still open: the "never TRUNCATE" pin misses dynamic and quoted forms.** File: `scripts/__tests__/testAccountCleanupSql.test.ts:513`. Severity: Medium. This is a test guard, not runtime: the migration has no TRUNCATE statement today, only the `'TRUNCATE'` label. Confirmed: `/TRUNCATE\s+(TABLE\s+)?[a-z_]/i` does not match `EXECUTE format('TRUNCATE %I', t)` or `TRUNCATE "x"`. SA approved for QA only with this fix, and it is not yet in the worktree.

#### Performance Issues (should fix)
None found. Prod timing cannot be measured here; runbook §6.6 (3 s on a check) covers it.

#### Edge Cases (nice to fix)
1. **The order guard checks 20261042's prerequisites, not that 20261042 was applied.** File: `supabase/migrations/20261043_…` (generator `order_guard`). Severity: Low. With 20261041 and the billing-events table present but 20261042 not applied, 20261043 applies and works, because it contains everything 20261042 adds. Its rollback would then install a 20261042 function that database never had. That is harmless, but it is not the same as "refuses before 20261042". Prod already has 20261042, so this rollout needs no action.
2. **CRLF in Windows checkouts of the applied migrations.** Pre-existing, Low. `20261041` and `20261042` are LF in git but CRLF in this worktree: `core.autocrlf=true`, and `.gitattributes` forces LF only on `scripts/test-account-cleanup-*.sql`. If one of them were applied from CRLF bytes (for example psql from a Windows checkout), the stored body would differ from the LF rollback by `\r` only. `pg_get_functiondef` would then not be byte-equal, though behaviour is the same. Suggest extending the `eol=lf` rule to the generated `supabase/migrations/*_operator_test_account_cleanup*.sql` files and their rollbacks.
3. **The nested-parent form of skip 2 was not run.** That is the parent predicate through `parent_table`, for example `website_blocks` via `website_pages`. The replica has no reviewed inbound link of that form. SA's proof covers it: the probe and the count use the same predicate.
4. ESLint shows 1 warning: unused import `PREVIOUS_FUNCTION_MIGRATION`, `scripts/__tests__/testAccountCleanupSql.test.ts:40`. It is already on main, not added by this diff.

#### Test Outputs / Logs

```text
Targeted Jest (57 suites: cleanup routes, TestAccountCleanupRepository, testAccountCleanupSql drift + applied pins,
  lib/business-os/purge (descriptors, invariant, no-deletion-paths, ...), businessOwnedTables, lib/audit/__tests__,
  supabase/migrations/__tests__ (all), adminGate.writes)                    57 passed, 1617 tests passed
npm run test:authz-guard                                                   119 passed
npm run typecheck:bos-llm                                                  passed (28 baseline, 0 new; 1 baseline entry now fixed)
eslint on the 15 changed TS files                                          0 errors, 1 warning (already on main)
Generator re-run                                                           5 outputs byte-identical (md5), git status unchanged
Full npm test                                                              991 passed / 15 failed suites, 20,183 tests; 11 = quarantine list;
  4 outside it, the known Windows-env ones untouched by this diff: oneAddressPolicy.guard,
  geo/addressFormat, AdminAreaField.render, AdminAreaField.search
Replica qa43.mjs (order guard, control, apply, check, delete, rollback, 11 blocked paths, skips, survivors)   82 PASS, FAILURES: 0
Replica pasted files                                                       check OK, delete CLEAN 144/132, actor NULL, source operator_sql
```

#### Final Status
- [ ] Issues found. Everything in scope passes on the replica, but SA condition (b) (Bug 1) must be fixed before commit. Once it is, the branch is ready for commit with no new replica run, since the fix only touches a test regex (re-run `scripts/__tests__/testAccountCleanupSql.test.ts`).

## QA Testing Report, slice 2 (Danger Zone UI)

**QA — 2026-10-07**
**Test mode:** full
**Strategy used:** A (Jest + RTL, jsdom, mocked `fetch`: the Dev render suite, a QA scratch probe suite of 23 extra cases deleted after the run, affected suites, guards, full suite). D (browser check) not run, see below
**Focus:** ui, security
**Skipped:** D, by instruction (no browser, no live calls). The visual checks are listed under Final Status for the user
**Input source:** prompt keywords
**Scope:** branch `feature/test-account-cleanup-danger-zone-ui`, uncommitted: `TestAccountCleanupPanel.tsx`, `cleanupApiTypes.ts`, the render test, the mount in `PurgeDangerZone.tsx`, docs. Run in parallel with the SA review; SA items 1 to 3 were not yet fixed when QA ran

### Test Coverage

| Acceptance Criterion | Tested? | Result | Notes |
|---|---|---|---|
| Nothing renders for a non-admin | ✅ | Pass | `PurgeDangerZone` with `allowed: false` (Dev) and with a 403 access response (QA): no section, and **no request** to `test-account-cleanup/*`. Mount sits after the `!access.allowed` early return |
| Panel renders nothing when its own probe answers 401 / 403 | ✅ | Pass | Empty container (Dev) |
| Probe says not configured | ✅ | Pass | "Not set up on this deployment" + runbook §6 pointer; email input and Check disabled (Dev). Probe network failure: "Could not tell whether this is set up", actions disabled (QA) |
| OK check renders verdict, per-table counts (`unknown`, never 0), triggers, kept items; confirm appears | ✅ | Pass | Dev. The VERDICT row's pasted-SQL instruction is not shown |
| BLOCKED renders every blocker with its clearing action | ✅ | Pass | Two blockers, each `G-n item (found) — to clear: …` (Dev) |
| Storage paths listed (`bucket/path`) | ✅ | Pass | G-12-only fixture (Dev) |
| Any non-empty tag accepted, empty refused | ✅ | Pass | Cleared tag disables Check; `@walla.co.il` posted as-is (Dev). Body is `{ email, tag }`, trimmed |
| Editing the email clears the check | ✅ | Pass | Dev; editing the **tag** also clears the check and the confirm (QA) |
| Delete hidden unless OK or BLOCKED-with-only-G-12 | ⚠️ | **Partial** | Hidden for hard blockers, G-12 + another guard (QA), `targetUserId` null (QA), out-of-date function (Dev). **Offered for BLOCKED with zero blockers** — Bug 1 (QA probe red) |
| Confirm needs the exact normalised email | ✅ | Pass | Trimmed + case-insensitive enables (Dev, and QA with upper case); one char short, a trailing `.`, whitespace only all stay disabled (QA) |
| Double-submit blocked | ✅ | Pass | dblClick on Delete posts once (Dev); dblClick on Check posts once (QA). Shared `useRef` guard |
| "Deleting…" / "Checking…" states | ✅ | Pass | Both shown and disabled while in flight (Dev / QA) |
| Result: per-table rows + TOTAL / CLEAN + files removed + login | ✅ | Pass | Dev; the stale check is cleared after success |
| Every refusal is one plain sentence, no raw server text | ✅ | Pass | Dev: check 503 not_configured / function_missing, 400, 500; delete blocked (0 / >0 files), confirmation_mismatch, 503 not_configured, function_out_of_date, 42501 (`not_authorised`) with files, storage_failed, delete_failed, unexpected 500. QA added: check 42501, 401, 403, unexpected 500, network; delete not_authorised and function_missing with 0 files, function_out_of_date **with files** ("Files removed, account kept"), check_failed, 400, 401, 403, unexpected 500, network. Each asserted as the **exact** sentence, no blocker list, and the planted server `message`/`details` absent from the page |
| No email in the debug console / Last API Response viewer | ✅ | Pass | QA: `onLog` across success, refusal and network error never contains the target email or any `@`. `onResponse` is not passed to the panel, so nothing reaches the shared viewer (read) |
| No server module in the client bundle | ✅ | Pass | Dev source guard: only `@/` import is the types file; types file imports nothing |
| Regression proof (planted) | ✅ | Pass | Check error changed to render `json.message` first: **5 tests red** (4 check-refusal cases + the source guard). Restored; `cmp` byte-identical |
| Entitlements registration | ⬜ | n/a | No import from `lib/business-os/entitlements/` |

### Issues Found

#### Bugs (must fix before commit)
1. **Delete offered on a BLOCKED check with no blockers** (= SA item 2, independently confirmed) — File: `components/business-os/purge/TestAccountCleanupPanel.tsx:53-56` — Severity: Medium
   - Steps to reproduce: check returns `verdict: 'BLOCKED'`, `blockers: []`, `functionUpToDate: true`, a login id.
   - Expected: no confirm field, no Delete.
   - Actual: confirm + Delete render (`every()` on an empty list is true). The SQL function's own guards would still refuse, but the UI breaks the "OK, or BLOCKED by G-12 only" rule. The route's `runCleanupDelete` has the same shape (hard-blocker count, not the verdict), so the database is the only stop there.

#### Performance Issues (should fix)
None in the component. The render suite takes 80 to 90 s on this Windows machine (largest in the purge set); not a CI blocker, noted only.

#### Edge Cases (nice to fix)
1. **Dev suite does not pin several refusal paths** that QA verified with a scratch probe: network error (check and delete), check 42501 / 401 / 403, delete with 0 files for not_authorised / function_missing, function_out_of_date with files, and "onLog never carries the email". Adding the network and onLog cases would keep the last two requirements pinned after QA's probe is gone. Severity: Low.
2. **`ready()` in the render test swallows its timeout** (`.catch(() => undefined)`), so a probe that never configures shows up as a later, misleading failure. Severity: Low.
3. **Unrecognised check sections are dropped** (= SA item 3): only `remove`, `trigger` (item only) and `kept` rows render. Needs the decision SA asked for. Severity: Low now, Medium once the insight-links fix branch lands.
4. **After a failed delete the check and typed confirmation stay**, so Delete can be pressed again without a fresh check. The server re-runs the check each time, so it is safe; just noting the UX. Severity: Low.

### Test Outputs / Logs

```text
Panel + Danger Zone / purge + slice-1 route, repository, pasted-SQL suites   24 suites, 536 passed
QA scratch probe (23 cases, deleted after)                                    22 passed, 1 failed = Bug 1
Planted regression (render json.message on a check refusal)                   5 failed (expected red); restored, cmp identical
Tailwind CSS-escape guard                                                     6 passed
npm run test:authz-guard                                                      119 passed, exit 0
eslint on the 4 changed/new TS files                                          exit 0; 0 errors, 1 pre-existing warning
                                                                              (PurgeDangerZone.tsx:224 exhaustive-deps, not in the diff)
tsc scoped to the 4 files (temp tsconfig extending the project's)             exit 0 (full-project tsc ran out of memory here)
Full npm test                                                                 986 passed / 15 failed / 8 skipped suites; 11 = quarantine list;
  4 outside it, the same Windows-env set as slice 1: oneAddressPolicy.guard, geo/addressFormat,
  AdminAreaField.render, AdminAreaField.search. None touched by this diff
```

### Final Status
- [ ] All acceptance criteria pass — ready for commit
- [x] Issues found — Dev must address before commit: Bug 1 (Medium, already SA item 2) plus SA items 1 and 3. No High bug. Re-run the render suite after the fix

**Manual visual checks for the user** (on `/test-business-os` → Danger Zone, signed in as a platform admin; no live delete needed for 1 to 4):
1. Signed in as a non-admin: no "Remove a test account" section anywhere.
2. On a deployment without `TEST_CLEANUP_SECRET`: "Not set up on this deployment" note, inputs and Check greyed out.
3. Configured: Check a non-test email → BLOCKED in red, each guard on its own line with "to clear", no confirm box. Check a `+test` account → OK in green, rows table readable, `unknown` where a count failed, files list, kept list; the red border box sits below the existing Danger Zone without layout breakage.
4. Type a different email in the confirm box: Delete stays grey; edit the main email: the result disappears.
5. Only when you choose to run a real delete on a throwaway `+test` account: "Deleting…" then the green report with TOTAL · CLEAN and files removed; the debug console and Last API Response show no email.

### Dev fixes (slice 2, 2026-10-07)
- SA 1: Fixed by Dev: `lib/business-os/test-account-cleanup/__tests__/cleanupApiTypes.wireTypes.test.ts` pins check, blocker, row, storage, report, delete and the new exported `CleanupDeleteErrorCode` both ways (server codes built from `runCleanupDelete`'s types plus the route's two literals); listed in `SCOPED_DIRS`. Planted drift (extra field + dropped `check_failed`) gave two TS2344s; restored. The panel's code-to-sentence map is now a `Record<CleanupDeleteErrorCode, …>`.
- SA 2 / QA Bug 1: Fixed by Dev: `canOfferDelete` requires `verdict === 'OK'` or at least one blocker, all G-12. Same gap closed in `runCleanupDelete` (storage only on OK or non-empty all-G-12), route test "BLOCKED with no parsed blocker: storage never called".
- SA 3 / QA Edge 3: Fixed by Dev: unrecognised sections go to an "Other rows" list; trigger rows show `detail`.
- QA Edges 1-2: Fixed by Dev: tests for network errors (probe, check, delete) and no email or tag in `onLog`; `ready()` now fails on its own timeout.

## Commit Info

| PR | Branch | Merge | What |
|---|---|---|---|
| #249 | `feature/test-account-cleanup-danger-zone` | `5becd7cc`, 2026-10-07 12:58 UTC | Slice 1: the server path, the generated secret-gated function (migration 20261041) and its routes |
| #253 | `feature/test-account-cleanup-danger-zone-ui` | `98dae9a7`, 2026-10-07 | Slice 2: the Danger Zone UI and `cleanupApiTypes.ts` with a two-way wire pin. `serverMs` added to the wire types on `fix/test-account-cleanup-insight-links` (landed second): check `serverMs: number \| null`; delete success `serverMs: { check: number \| null; delete: number \| null }`; the panel shows a small "Server time" line |
| (pending) | `fix/test-account-cleanup-insight-links` | not committed | First-live-run fixes, migration 20261043 (after #251's 20261042) |

## Change History

| Date | Change | Details |
|---|---|---|
| 2026-10-07 | Created, slice 1 code complete (Dev) | Tasks 1 to 12 done, uncommitted |
| 2026-10-07 | SA re-ruling (option A) | User replaced option (c) with a secret-gated RPC; rework items 1-5 against requirement §12 R-1..R-9; pg/TLS path removed |
| 2026-10-07 | SA code review (option A) | Fix Required: `search_path = ''` breaks the refund and storage-quota triggers; switch to `pg_catalog, public, pg_temp` + public-CREATE abort guard |
| 2026-10-07 | SA re-check | Fixes verified (search_path, CREATE guard, stamp 99c4c83979a96efc, runbook §6.6, OI-1); Code Approved for QA |
| 2026-10-07 | QA | Full pass: Jest (targeted 1436, guards, full suite no new failures), migration + function executed on a PGlite replica (create guard, grants, 42501 paths, null actor, read-only check, CLEAN with real refund/quota triggers, 10 blocked paths zero rows, version stamp, rollback), contract test on real jsonb. No bugs; one Low edge case |
| 2026-10-07 | SA code review (slice 2) | Fix Required: wire-type pin (scoped tsc, adminDeletionPreview precedent) + error-code union pin; canOfferDelete empty-blockers edge; unrecognised check sections dropped (fix-branch dependency). QA may proceed in parallel |
| 2026-10-07 | SA re-check (slice 2) | Items 1-3 verified (wire pin in scoped tsc, Record-typed sentences, G-12-only predicate client + server with route test, Other-rows fallback + trigger detail); Code Approved |
| 2026-10-07 | QA (slice 2) | Full Jest pass of the panel (Dev suite + 23-case QA probe), purge and slice-1 suites, guards, scoped tsc, eslint, full suite (no new failures); planted raw-message regression went red, restored byte-exact. One Medium bug (Delete offered on BLOCKED with zero blockers, = SA item 2); Low test-gap edge cases; manual visual checks listed for the user |
| 2026-10-07 | Dev fixes (slice 2) | SA items 1-3 and QA bug 1 / edges 1-3: wire-type pin in the bos-llm gate, empty-blockers gap in the panel and in runCleanupDelete, unknown-section fallback + trigger detail, extra tests |
| 2026-10-07 | SA code review (first-live-run fix) | Insight tables reset/LEAF + LIVE_ONLY accepted (no capture migration; C-1 backlog + RLS note); both G-18 skips and the survivor dedup proven zero-preserving; keep 8 s, no service_role widening, the pasted path is the fallback; C-2 server-side duration, C-3 runbook threshold |
| 2026-10-07 | SA re-check (rebuilt on main) | (a) rollback test OK; (b) TRUNCATE regex misses `%I`/quoted, mask the label instead; required-tables guard correct; land before #253, which then adds serverMs to cleanupApiTypes |
| 2026-10-07 | QA re-run (first-live-run fix) | Jest 57 suites / 1617 tests, guards, full suite with no new failures. 20261043 executed on a PGlite replica that has the insight tables: order guard, control (20261042 blocks), stamp, check OK, delete CLEAN with both insight tables emptied and counted, other account untouched, server_ms, trigger events wording, 11 blocked paths with zero rows changed, both G-18 skips and the survivor dedup safe, exact rollback to 20261042, pasted files. Open: SA condition (b) TRUNCATE regex (Medium). 2 Low edge cases |
