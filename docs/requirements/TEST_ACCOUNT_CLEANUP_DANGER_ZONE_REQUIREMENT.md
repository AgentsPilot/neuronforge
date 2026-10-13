# Requirement: Test-Account Cleanup from the Danger Zone (admin only)

> **Last Updated**: 2026-10-07

**Created by:** BA
**Date:** 2026-10-07
**Status:** Draft. Waiting on business questions BQ-1 to BQ-6 and an SA ruling on the technical path (§3).
**Status update (2026-10-07):** BQ-1 to BQ-6 decided by the user (§8.1). SA **approved with conditions**, option (c), two slices (§12). Ready for the Dev workplan.

## Overview

Today a test account is removed by pasting two generated SQL files into the Supabase SQL editor (operator exception **OX-1**, PR #244, [runbook](/docs/runbooks/TEST_ACCOUNT_CLEANUP_RUNBOOK.md)). The owner wants the same tool in the **Danger Zone** tab of `/test-business-os`, for platform admins only, so no SQL has to be pasted. The flow stays the same as the manual one: **check first, then run, then show the report**. Every guard (G-1 to G-18), the email-contains-tag rule, the typed confirmation and the per-table report are kept. The difference is that a signed-in admin runs it, so the audit row can say who did.

> **Depends on PR #244** (`feature/test-account-cleanup-script`) being merged. Its generator (`scripts/generate-test-account-cleanup-sql.ts`) is the single source of the cleanup logic for this feature too.

## Table of Contents

1. [What exists today](#1-what-exists-today)
2. [User stories](#2-user-stories)
3. [The key constraint: how the app can run this (for SA)](#3-the-key-constraint-how-the-app-can-run-this-for-sa)
4. [Functional requirements](#4-functional-requirements)
5. [Non-functional requirements](#5-non-functional-requirements)
6. [Acceptance criteria](#6-acceptance-criteria)
7. [Delivery slices](#7-delivery-slices)
8. [Business questions](#8-business-questions)
9. [Technical questions (for SA)](#9-technical-questions-for-sa)
10. [Out of scope](#10-out-of-scope)
11. [Integration points](#11-integration-points)
12. [Change History](#change-history)

---

## 1. What exists today

| Fact | Source |
|---|---|
| **The page `/test-business-os` is open to every signed-in account.** `app/test-business-os/layout.tsx` only runs the payment-hold gate; middleware skips the onboarding check; the page is a `'use client'` component gating on `useAuth()`. It is **not** behind `requireAdminPage` | `layout.tsx`, `purgeAuthz.ts` header |
| **The Danger Zone tab is admin-only, by asking the server.** `PurgeDangerZone.tsx` calls `GET /api/business-os/purge/access`, which answers from `AdminAccessService.isAdmin` (the `admin_users` table). Hiding the tab is cosmetic | `purge/access/route.ts` |
| **The Danger Zone routes are admin-gated, but not with `requireAdmin`.** `preview` and `commit` live under `/api/business-os/purge/`, not `/api/admin/`, and gate through `authorizePurge()` → `AdminAccessService.isAdmin`. So they sit outside the `requireAdmin` convention and (❓ SA to confirm) outside the required CI admin-authz guard | `purgeAuthz.ts` |
| The pasted SQL runs as `postgres`, so row security protects nothing. The guards inside the SQL are the only safety | Runbook |
| The pasted delete writes `BUSINESS_TEST_ACCOUNT_REMOVED` with `actor_id = NULL`: pasted SQL has no signed-in operator | Workplan §2.6 |
| **SA ruling TQ-1 (a) on OX-1:** "It runs only as pasted SQL by the operator. No route, no TS, no service-role path may ever call it." **This requirement asks to reverse that ruling.** OX-1 and its splices into the purge and admin-delete requirements (next to D3, D14, UD-1) must be revised by SA | Workplan, SA Review Notes |
| Storage files are never deleted by the SQL (SA ruling C-4). G-12 blocks while files remain under the account folder in the three purge buckets | Runbook §3 |
| 🔴 The `service_role` key is published in public git history and **not yet rotated**. That is why `purge_business_data` sits in `supabase/held/` and the admin delete (AD-2) ships inactive | `supabase/held/README.md` |

---

## 2. User stories

- As a platform admin, I want to remove a test account from the Danger Zone, so that I never paste SQL to free an email for re-signup.
- As a platform admin, I want to see a check result (OK or BLOCKED, every blocker, rows per table) before anything is removed, so that I know exactly what will go.
- As a platform admin, I want a per-table report with a TOTAL and CLEAN after the removal, so that I can trust the email is free.
- As the owner, I want every removal recorded with the admin who ran it, so that the audit trail answers "who deleted this account".
- As the owner, I want a non-admin to see nothing and be refused by the server, even with a hand-made request.

---

## 3. The key constraint: how the app can run this (for SA)

The SQL editor runs as the database owner. The app cannot. From a server route there are three ways, and SA decides which:

| Option | What it means | Business trade-off |
|---|---|---|
| **(a) A database function (RPC)**, applied by migration, generated from the same generator | The exact guards and deletes, in one all-or-nothing transaction, called by the server | Same safety as the pasted SQL, and one source of logic. **But** any function the server can call, anyone holding the leaked key can call too, with **any email and any tag**. That is a ready-made "fully delete an account" endpoint. So it must ship **held and inactive** until the key is rotated, exactly like the purge function and AD-2 |
| **(b) App code deleting table by table** with the service-role client | No new database function | 🔴 **Not all-or-nothing.** A failure halfway leaves a half-deleted account, which is the failure the old "delete my account" shipped. Several guards (G-10, G-17, G-18) read the database catalog, which the app cannot read without a database function anyway. It would also be a second, hand-written copy of the logic. The leaked key already lets an attacker delete rows directly, so (b) adds no new hole by itself. But a working "wipe an account" path in the app still lowers the bar |
| **(c) A direct database connection string** stored as a new server secret | The server runs the same SQL as the editor does, in one transaction, without a public function | All-or-nothing, and no endpoint is exposed through the leaked key. But it adds a **new secret with owner-level power** to the hosting environment, and a new way of reaching the database. Both need SA review (CLAUDE.md rule 7). If the database password was ever exposed alongside the key, it needs rotating too |

**BA reading, for SA to rule:** (a) fits best. It keeps one transaction and one source of logic, and it reuses the held-function and off-switch pattern this project already uses. It should be **built now and shipped inactive**: the function stays in `supabase/held/`, the server off switch defaults OFF, and both are released after the key rotation (BQ-1).

---

## 4. Functional requirements

**Access**

1. **FR-1** The cleanup section is shown only to platform admins, decided by the server from `admin_users`. Never `profiles.role` or `app_metadata.role`.
2. **FR-2** Every new route gates with `requireAdmin` as its **first statement**. Recommended home: `/api/admin/...`, so the required CI admin-authz guard covers it (TQ-2).
3. **FR-3** Inputs are validated with Zod (`.strict()`) before any logic: target email, tag (per BQ-2), and for the delete the typed confirmation.
4. **FR-4** A server off switch, default **OFF**, refuses the delete before anything runs. The section shows plainly whether the delete is live, from a server probe, like the Reset banner does today.

**Flow**

5. **FR-5 Check.** The admin enters the email (and the tag, per BQ-2) and runs the check. The page shows OK or BLOCKED, **every** blocker with its guard id and how to clear it, the rows per table, the storage paths (G-12), the triggers report and what is kept. The check reads only.
6. **FR-6 Confirm.** The delete is offered only after an OK check for the same email and tag. Editing either clears the result. The admin types the email again; the server compares it to the resolved email, never to a value it echoed.
7. **FR-7 Delete.** The delete re-runs every guard inside the same transaction (the current SQL already does). Any guard that fails, or any survivor found by the in-block scan, rolls everything back and is shown as "BLOCKED, nothing was removed" with the reason.
8. **FR-8 Report.** After the delete the page shows one row per table (rows removed), then a TOTAL row with the result (CLEAN), rows, tables, removed login id and time. It comes from the delete's own return, not a 15-minute read-back.

**Single source, audit, storage**

9. **FR-9** The generator stays the **only** place the cleanup logic is written. If (a) is chosen, it also emits the function body, and the existing drift test covers it. No second hand-written copy, in TypeScript or SQL.
10. **FR-10** Each delete run writes `BUSINESS_TEST_ACCOUNT_REMOVED` with the admin's id as actor and a source marking the page (e.g. `admin_page`), counts only, no email. A refused or failed delete is also recorded (BQ-5). Audit is non-blocking where it sits outside the transaction, with the flush rule from the `new-api-route` skill.
11. **FR-11** Storage, per BQ-3: either the page lists the files and the admin empties them in the Supabase dashboard (as today), or an explicit "empty storage folders" step with its own confirmation runs before the delete. Either way the delete still blocks on G-12.
12. **FR-12** The pasted SQL stays available as a fallback (BQ-6). It is generated from the same source, so this costs nothing extra.

---

## 5. Non-functional requirements

- **Security:** all guards G-1 to G-18 unchanged. Admins can never be removed (G-4), so an admin cannot remove themselves. No email in logs or audit details. No internal error details in production responses.
- **Performance:** one check or delete must finish inside the route's time limit on a typical test account (SA to set `maxDuration`).
- **CI:** no added CI time. New tests run inside the existing Jest gate.
- **Logging:** Pino with `correlationId`. No `console.*`.
- **Data access:** through a repository (CLAUDE.md rule 1). A service-role call is documented in code.

---

## 6. Acceptance criteria

- [ ] A non-admin does not see the section, and a direct request to each route returns 403 (signed out: 401).
- [ ] Invalid input returns 400 before any database call.
- [ ] With the off switch OFF, the delete is refused and nothing is removed; the page says the delete is not live.
- [ ] Check on a test account shows OK with rows per table; check on a non-matching email shows BLOCKED with G-2.
- [ ] Delete is not offered until an OK check; a changed email or tag clears it; a wrong confirmation is refused.
- [ ] A delete that hits a guard removes nothing, and the page names the guard.
- [ ] A successful delete shows the per-table report and TOTAL = CLEAN, and the email can be invited and signed up again.
- [ ] The audit row names the admin as actor and contains no email.
- [ ] The drift test fails if the generated function and the generator disagree.
- [ ] No new CI step, and no added time on the critical path.

---

## 7. Delivery slices

Each slice is a few days at most, with its own guardrails.

| Slice | Scope | Ships |
|---|---|---|
| **1. Generated function (held)** | The generator also emits the check and delete as database functions (per SA, option (a)), written to `supabase/held/` with a release checklist. Drift test extended | Nothing callable. Inert |
| **2. Admin routes, off switch OFF** | `check` and `delete` routes: `requireAdmin` first, Zod, repository, off switch, audit with actor, Pino | Routes that refuse the delete; check live or held per BQ-1 |
| **3. Danger Zone section** | Email + tag inputs, check result, typed confirmation, delete, per-table report, "delete is not live" banner from the probe | UI, inert until activation |
| **4. Storage step** (only if BQ-3 = in-app) | Explicit "empty storage folders" step with its own confirmation | Inert until activation |
| **Activation (ops, not a slice)** | Rotate the key, apply the held function, reload the schema cache, flip the off switch, one live run on a test account | Live |

---

## 8. Business questions

- [ ] **BQ-1 Wait for the key rotation, or not?** (raised by: BA | status: pending user input)
  Recommendation: **build now, keep the delete inactive until the key is rotated**, as with the admin delete. The read-only check could go live sooner if SA agrees: the leaked key can already read every table, so a check adds no new exposure.
- [ ] **BQ-2 Can the admin type the tag on the page, or is it fixed in server settings?** (raised by: BA | status: pending user input)
  A tag typed on the page can be a full email, which makes the tag rule a formality on a one-click tool. A fixed tag would stop you cleaning a test account like a plain `@walla.co.il` address.
  Recommendation: **a short list of allowed tags in server settings (not in the public repo), picked from a dropdown.** The free-text tag stays in the pasted SQL for the rare one-off.
- [ ] **BQ-3 Delete storage files in the app, or keep listing them?** (raised by: BA | status: pending user input)
  The server can delete files, but not in the same all-or-nothing step as the data. If the delete is then blocked, the files are already gone and the account remains. For a test account, that is usually harmless.
  Recommendation: **keep listing them in slices 1 to 3.** Add the in-app step (slice 4) only if emptying folders by hand turns out to be a real chore.
- [ ] **BQ-4 Make the whole test page admin-only?** (raised by: BA | status: pending user input)
  Today any signed-in account can open `/test-business-os`; only the Danger Zone is admin-only.
  Recommendation: **no, not in this requirement.** The section and its routes are admin-only, which meets the request. Locking the whole page is a separate decision.
- [ ] **BQ-5 Record refused and failed delete attempts in the audit trail too?** (raised by: BA | status: pending user input)
  Recommendation: **yes for delete attempts, no for checks.** A refused delete aimed at a real customer is worth seeing. Checks are frequent and change nothing.
- [ ] **BQ-6 Keep the pasted SQL once the page works?** (raised by: BA | status: pending user input)
  Recommendation: **keep it as a fallback.** It is generated from the same source, so it costs nothing and works if the app is down.

---

## 9. Technical questions (for SA)

- [ ] **TQ-1** Choose (a), (b) or (c) from §3. BA reads (a), held and inactive. (raised by: BA | status: open)
- [ ] **TQ-2** Route home: `/api/admin/...` with `requireAdmin` (covered by the required CI guard) rather than next to the purge routes, which use `authorizePurge`. Confirm whether the CI guard covers `/api/business-os/purge/*` today. (raised by: BA | status: open)
- [ ] **TQ-3** Revise OX-1: TQ-1 (a) forbade any route or service-role path. Update the OX-1 splices next to D3, D14 and UD-1. Check that the `no-deletion-paths` guard allows the new route only through a reviewed entry. (raised by: BA | status: open)
- [ ] **TQ-4** If (a): the actor id is passed into the function by the route. The function cannot verify it, so a leaked-key caller could forge it. Acceptable once inactive-until-rotation holds? (raised by: BA | status: open)
- [ ] **TQ-5** If (a): the check as a function exposes "does this email exist, and what does it own" to a leaked-key holder. The key can already read every table, so it adds nothing new. Can the check ship live before rotation (BQ-1)? (raised by: BA | status: open)
- [ ] **TQ-6** Off switch: a server-only env flag (`is…Enabled`, no `NEXT_PUBLIC_`) or a database flag, in line with AD-2. (raised by: BA | status: open)
- [ ] **TQ-7** `maxDuration` for the delete (G-10 and G-18 scan 189+ reviewed links) and for the check. (raised by: BA | status: open)

---

## 10. Out of scope

- Removing a real customer, or any account not matching the tag rule. The admin delete (AD-1/AD-2) covers that and keeps the login (UD-1).
- *Amended 2026-10-08 (AU-1):* on `/admin/users` only, an admin may run this same delete on **any account**, with the email locked and the tag pre-filled to that email. All guards still apply. See [TEST_ACCOUNT_CLEANUP_ADMIN_USERS_AMENDMENT.md](/docs/requirements/TEST_ACCOUNT_CLEANUP_ADMIN_USERS_AMENDMENT.md).
- Removing more than one account at a time.
- Asking Stripe directly. The guards read local rows only, as today.
- Making the whole `/test-business-os` page admin-only (BQ-4).
- Documenting the existing Danger Zone in `BUSINESS_OS_TEST_PAGE_SCOPE.md` (open follow-up F-5). The new section is documented there when it ships.

---

## 11. Integration points

| Area | Affected |
|---|---|
| Generator | `scripts/generate-test-account-cleanup-sql.ts` (PR #244), its drift test `scripts/__tests__/testAccountCleanupSql.test.ts` |
| Database | New held functions in `supabase/held/` (option (a)); every table in the cleanup plan; `auth.users`; `audit_trail` |
| Routes | New admin routes (TQ-2); `lib/admin/requireAdminRoute.ts` |
| UI | `components/business-os/purge/PurgeDangerZone.tsx` or a sibling section in the Danger Zone tab of `app/test-business-os/page.tsx` |
| Audit | `BUSINESS_TEST_ACCOUNT_REMOVED` in `lib/audit/events.ts` / `eventAudience.ts` (actor now set) |
| Docs | OX-1 splices in the purge and admin-delete requirements; the runbook; `supabase/held/README.md`; `BUSINESS_OS_TEST_PAGE_SCOPE.md` |

---

## 8.1 User decisions (2026-10-07)

These answer §8. They override the BA recommendations there wherever the two differ. §8 is kept as written.

| BQ | Decision |
|---|---|
| **BQ-1** | **Build it all now and use it straight away. Do not wait for the `service_role` key rotation.** Check and delete both go live when shipped |
| **BQ-2** | **The tag is free text, exactly like the SQL.** Only an empty tag is refused. No allow-list, no dropdown |
| **BQ-3** | **The page deletes the storage files too**, server-side, through the Storage API |
| **BQ-4** | BA recommendation accepted: only the Danger Zone section and its routes are admin-only, not the whole page |
| **BQ-5** | BA recommendation accepted: audit refused and failed delete attempts, not checks |
| **BQ-6** | BA recommendation accepted: keep the pasted SQL as the fallback |
| **Path** | **Option (c), a direct Postgres connection.** A new server-only secret (the Supabase database connection string, `SUPABASE_DB_URL`) set on Vercel, never `NEXT_PUBLIC_`, never in the repo, plus a standard Postgres client package. The server runs the **same** generated check and delete SQL, in one transaction, as `postgres`. **No new database function, no migration**, so the leaked key gains nothing |
| **Path (revised, later on 2026-10-07, supersedes the row above)** | **Option A: no certificate, no direct Postgres connection.** One database function, called through the normal Supabase API (`.rpc()`, service-role client), locked by a second secret (`TEST_CLEANUP_SECRET`) whose hash only the database holds. Ruled in §12 "SA re-ruling" R-1 to R-9 |

---

## 12. SA Review Notes

**Reviewed by SA, 2026-10-07**
**Status:** ✅ Approved with conditions. Option (c) is signed off as a new pattern under CLAUDE.md rule 7 on conditions SA-1 to SA-12. The Dev workplan must show each one.

### Why (c) holds up

- No new callable surface. The leaked key reaches PostgREST and Storage, not the Postgres wire protocol with the DB password. An RPC (option (a)) would have handed the key holder a one-call account wipe. (c) does not.
- One source of logic. The DO block already reads its inputs through `current_setting('cleanup.*')`. So the server sends the values as **bound parameters to `set_config`** in the same transaction, and then runs the generated body unchanged. No string is ever concatenated into SQL.
- All-or-nothing is unchanged: the guards, the survivor scan and the audit insert all stay inside the one DO block.
- Checked: git history holds only placeholder connection strings (`[YOUR-PASSWORD]`, `<pw>`), so the DB password itself is not known to be leaked.

### Conditions

- **SA-1 Secret.** `SUPABASE_DB_URL` is set in Vercel for **Production only**, never Preview or Development. The repo is public and preview builds run branch code against the same database, so a Preview-scoped secret could be read by any branch. Exactly one module reads it (`lib/server/operatorPostgres.ts`, `import 'server-only'`). A Jest assertion checks that no other file under `app/ lib/ components/ hooks/` names it. `.env.example` gets a placeholder only. Recommended, but it does not block: set a fresh database password when you create the string.
- **SA-2 Connection.** Use `pg` (node-postgres) and **one `Client` per request**, with no pool. Vercel functions do not keep a pool between invocations, and this tool runs a few times a day. Connect to the **Supavisor session pooler, port 5432** (`aws-0-<region>.pooler.supabase.com`). The direct `db.<ref>` host is IPv6-only, which Vercel cannot reach. Do not use the transaction pooler on 6543: its prepared-statement limits are not worth the trouble here. SSL is required. `connectionTimeoutMillis` ≈ 10 s. Call `client.end()` in `finally` on every path. Both route files declare `export const runtime = 'nodejs'`.
- **SA-3 Transaction shape.** The check runs `BEGIN READ ONLY`, so the database itself enforces "the check reads only". The delete runs `BEGIN`. Both then run `SET LOCAL statement_timeout = '45s'` and `SET LOCAL lock_timeout = '5s'`, then `SELECT set_config('cleanup.<name>', $1, true)` for each value, then the body. The delete also runs the generated report SELECT **inside the same transaction, before `COMMIT`**: there `created_at = now()` matches only this run's audit row, which satisfies FR-8. Any error means `ROLLBACK`. `maxDuration = 60` on both routes (TQ-7).
- **SA-4 Generator emits the server form (FR-9).** Refactor the generator into exported pure builders that produce the edit lines and the body separately. It writes the two `.sql` files exactly as today, **plus** `lib/business-os/test-account-cleanup/cleanupSql.generated.ts`, which exports `CHECK_BODY`, `DELETE_BODY` and `DELETE_REPORT` as string constants with no edit lines. The drift test is extended to the TS file. Nothing at runtime reads `scripts/` or computes SQL. The generated file must pass the Tailwind CSS-escape guard from PR #180.
- **SA-5 Audit (FR-10).** The success row stays **inside** the transaction, so it is atomic with the delete. The generator changes the insert to `actor_id = NULLIF(current_setting('cleanup.actor_id', true), '')::uuid` and `source = coalesce(NULLIF(current_setting('cleanup.source', true), ''), 'operator_sql')`, so the pasted SQL behaves exactly as before. The route binds the admin id that `requireAdmin` returns, never a body field, and `source = 'admin_page'`. TQ-4 is moot because no public function exists: the connection string is the trust boundary. Refused or failed deletes write a new registered event, `BUSINESS_TEST_ACCOUNT_REMOVAL_REFUSED` (in `events.ts` and `eventAudience.ts`, severity matching), from the route through `AuditTrailService`. It is non-blocking, uses the `new-api-route` flush rule, and records guard ids, the resolved user id if there is one, and the `correlationId`. **No email and no tag**: the tag is free text and can itself be an email.
- **SA-6 Storage ordering (BQ-3). Storage goes first, and only after a clean check.** The delete route (1) runs the check, and goes on only if **every blocker is G-12**, or there are none. (2) It removes exactly the object paths the check returned in its `storage` rows. Those are full `bucket/name` paths read from `storage.objects`, so no listing and no recursion are needed. Batches are ≤ 1000, through `supabaseServer` storage, with the service-role use documented. (3) It runs the delete transaction, whose own G-12 re-check proves the folders are empty. Doing the SQL first was rejected: it would need G-12 switched off in server mode (a fork of the logic), and a storage failure afterwards would leave unreported files under a login id that no longer exists. Residue case: if step 3 then blocks on a new guard (a race), the report says "files removed, account kept: <guard>". The user accepted that for test accounts (BQ-3). The bucket list comes from `STORAGE_DESCRIPTORS`, never a hand list.
- **SA-7 OX-1 revised (TQ-3).** It becomes **OX-1r**: "operator-only hard delete of `auth.users` for accounts whose email contains the test tag, run either as pasted SQL or by the admin-only `/api/admin/test-account-cleanup/*` routes, both executing the same generated SQL over a direct Postgres connection. No RPC, no service-role database path, no other caller." This replaces my earlier "no route may ever call it" ruling. Insert-only splices with Change History rows go next to D3 (purge requirement), D14 and UD-1 (admin delete requirement), in the generator header comment, and in the runbook.
- **SA-8 No-deletion-paths guard.** Today it scans for `auth.admin.deleteUser` and the Supabase-client delete shapes, so raw SQL text slips through. Add **assertion family 4**: a string containing `DELETE FROM auth.users`, case-insensitive, anywhere in the scan roots. Allow-list exactly one entry, `cleanupSql.generated.ts`, with its reason, and add a negative fixture to "the guard can actually fail". Any storage `remove(` in the repository goes on the allow-list only if the guard trips on it.
- **SA-9 Routes and authz (FR-2, TQ-2).** Add `POST /api/admin/test-account-cleanup/check` and `POST /api/admin/test-account-cleanup/delete`. `requireAdmin` is the **first statement**. Then Zod `.strict()`: the email is trimmed, a valid email and ≤ 254 characters; the tag is trimmed, non-empty and ≤ 254 characters, and nothing else is restricted (BQ-2); the confirmation is a string. Validation runs before any connection. Both handlers go in `adminGate.writes.test.ts`, covering the 4 denial cases, with "no pg client constructed and no storage call" as the nothing-happened assertion. Update the authz census or caps in the same commit if they count gated handlers. If `SUPABASE_DB_URL` is unset, both routes return 503 "not configured", and that is the off switch (TQ-6, see SA-11). The access probe the section uses comes from the same route family, for example `GET .../check` or a `status` handler under `requireAdmin`, and not from the `purge/access` route. Whether the CI guard covers `/api/business-os/purge/*` is a separate follow-up, not this requirement.
- **SA-10 Repository (rule 1).** Add `lib/repositories/TestAccountCleanupRepository.ts`, server-only. It takes an injected `connect()` factory from `operatorPostgres.ts` and returns `RepositoryResult`, with methods `check(input)`, `remove(input, actorId)` and `emptyStorage(paths)` (Storage client injected). Document in code that the `user_id` filter rule and `tenant-isolation-guard` do not apply: this is an operator tool that resolves its target by email, and the SQL guards G-1 to G-18 are its isolation. The routes never touch `pg` directly.
- **SA-11 Off switch (TQ-6).** Per BQ-1 the tool is live, so **no separate flag**. The presence of the Production-only secret arms it. Removing the env var and redeploying disarms it. The section banner shows "not configured" from the probe. TQ-5 is moot.
- **SA-12 Logging, errors, CI.** Pino `child({ correlationId })` logging `adminId`, the resolved `targetUserId`, guard ids, row and table counts and elapsed ms. Never the email, the tag, the confirmation or the connection config. Log `{ err }` with only pg `code`/`message` and never the client object. Production responses return guard ids and the plain reason only, with pg detail behind the `NODE_ENV === 'development'` guard. All new tests use mocked `pg` and Storage inside the existing Jest gate. They must assert: values appear only as bound params and never in SQL text; `READ ONLY` on the check; `ROLLBACK` plus `end()` on error; 503 when the secret is unset; storage only after a check where every blocker is G-12. **No new CI step, no added critical-path time.**

### Slices (replaces §7)

| Slice | Scope | Ships |
|---|---|---|
| **1. Server path** | Generator server form + drift (SA-4, SA-5), `operatorPostgres.ts` + `pg` dependency (SA-1 to SA-3), repository (SA-10), the two routes plus a probe (SA-9), storage step (SA-6), the refused-attempt event, guard family 4 (SA-8), writes-gate and census, OX-1r splices and runbook (SA-7) | Live once `SUPABASE_DB_URL` is set in Production |
| **2. Danger Zone section** | Email + tag, check result (blockers with guard id and how to clear each, rows per table, storage paths, triggers, what is kept), typed confirmation, delete, per-table report with TOTAL = CLEAN, "not configured" banner; a `BUSINESS_OS_TEST_PAGE_SCOPE.md` entry. UI path, so SA review and QA run in parallel | Live |
| **Ops** | Set `SUPABASE_DB_URL` (Production only, session pooler), redeploy, run once on a `+test` account, re-invite it | n/a |

### Approval

[x] Requirement approved with conditions SA-1 to SA-12. Proceed to the Dev workplan for slice 1.

### SA re-ruling: execution path option A, secret-gated RPC (2026-10-07)

**Status:** ✅ Approved with conditions R-1 to R-9. Replaces option (c): SA-1 (secret name only, Production-only scope stands), SA-2, SA-3, the server form of SA-4, the SA-7 wording, the SA-8 allow-list, SA-11 and the TLS ruling. SA-5, SA-6, SA-9, SA-10 and SA-12 stand, read with "rpc" for "pg".

- **R-1 Migration, generated.** The generator emits `supabase/migrations/<next free number on origin/main>_operator_test_account_cleanup.sql` and `supabase/SQL Scripts/<same>_rollback.sql` (drop function, table, schema) from the SAME builders: they return the plpgsql block without the `DO $cleanup$` wrapper and the SELECTs without the trailing `;`, and `renderDeleteSql` wraps them, so the pasted SQL behaves as today. The drift test covers both files and the paste-safety rule (only `INSERT INTO` keywords). The migration ends with `NOTIFY pgrst, 'reload schema';`. Never edit it once applied: a changed plan goes to a new dated file (generator constant `FUNCTION_MIGRATION`).
- **R-2 Function.** `public.operator_test_account_cleanup(p_mode text, p_email text, p_tag text, p_confirm text, p_actor uuid, p_secret text) RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = ''`, owned by postgres. Order: (a) the secret check (R-3); (b) `p_mode` is `'check'` or `'delete'`, otherwise raise; (c) check mode runs `PERFORM pg_catalog.set_config('transaction_read_only', 'on', true)`, which is legal mid-transaction and makes the database itself enforce the read-only check; (d) set **all five** `cleanup.*` values from the parameters every time, with `set_config(..., true)`: confirm and actor are `''` in check mode, source is the literal `'admin_page'` and there is no `p_source`, and delete mode raises if `p_actor` is null; (e) `set_config('lock_timeout', '5s', true)`, and drop `statement_timeout` because setting it inside a running statement does nothing; (f) run the generated body unchanged as a nested block; (g) return `{version, rows}` with `jsonb_agg(... ORDER BY <explicit keys>)`, the check rows or, in delete mode, the generated report from the same transaction (FR-8). Every error raises, and PostgREST rolls back its single transaction. Qualify every name (search_path is empty). Use `pg_catalog.sha256`, not pgcrypto. Never put `p_secret` or `p_email` in a RAISE.
- **R-3 Second-secret lock.** Create a new schema `operator_private` with plain `CREATE SCHEMA`, no `IF NOT EXISTS`, so a schema that already exists fails loudly. Add `operator_private.secrets(name text PRIMARY KEY, secret_sha256 bytea NOT NULL, created_at timestamptz DEFAULT now())` with RLS on and no policies. `REVOKE ALL` on the schema and the table `FROM PUBLIC, anon, authenticated, service_role`. The function raises `'not authorised'` with `ERRCODE '42501'` unless `length(p_secret) >= 32` and a row named `test_account_cleanup` has `secret_sha256 = pg_catalog.sha256(pg_catalog.convert_to(p_secret, 'UTF8'))`. SHA-256 is enough, with no bcrypt or constant-time compare, because the secret is 32 random bytes (`openssl rand -hex 32`), not a password. The user hashes it locally (Git Bash `printf %s "$S" | sha256sum`), then runs once: `INSERT INTO operator_private.secrets (name, secret_sha256) VALUES ('test_account_cleanup', decode('<64-hex>', 'hex'));`. The raw secret never reaches the database, the editor history or the logs. To rotate, UPDATE the row. To disarm instantly on the database side, DELETE the row.
- **R-4 Grants (confirmed).** `REVOKE ALL ON FUNCTION ... FROM PUBLIC, anon, authenticated; GRANT EXECUTE ... TO service_role`. The REVOKE is mandatory because Supabase's default privileges give anon and authenticated EXECUTE on new public functions. `service_role` has BYPASSRLS, so the grants and the schema not being exposed to PostgREST are the boundary, not RLS. It is not a member of `postgres`, so the leaked key cannot read the hash, cannot ALTER or REPLACE the function, and cannot run DDL through PostgREST. The repo migrations define no exec-SQL helper (checked). The function source is readable in `pg_proc` and the public repo, which is fine because it holds no secret. A migration test pins these grants, `SECURITY DEFINER`, `search_path = ''`, the schema without `IF NOT EXISTS`, and no hash or secret literal.
- **R-5 App changes.** Remove `pg`/`@types/pg` (restore the lockfile entries from main), `operatorPostgres.ts`, `supabaseRootCa.ts`, their tests, `SUPABASE_DB_URL`, the port-6543 rule and `cleanupSql.generated.ts`, so no SQL exists at runtime. The generator writes a small generated TS that exports only `CLEANUP_FUNCTION_VERSION`, a hash of the function SQL. One `server-only` module reads `TEST_CLEANUP_SECRET`, and a Jest test checks no other file names it. The secret is set in Vercel **Production only**, and unset means 503 "not configured", which is the off switch. The repository calls `supabaseServer.rpc(...)` (client and secret injected, service-role use documented) and parses the jsonb with Zod. `P0001` means blocked. `42501` means 503 "not configured", logged as an error, and on the delete route also written as a refused audit row. Never log rpc arguments. Tests use a fake rpc: "no rpc call" is the nothing-happened assertion, and the tests check that the secret is sent but never logged or returned.
- **R-6 Version check.** The delete route refuses with 503 "database function out of date" **before the storage step** if the returned `version` is not `CLEANUP_FUNCTION_VERSION`. A stale function would still fail closed through the survivor scan, but this check makes it visible.
- **R-7 Guards and OX-1r.** No-deletion-paths family 4 adds `supabase/migrations` and `supabase/held` to its scan roots. Its allow-list becomes exactly the generated migration (the TS entry goes away). A new assertion: under `app lib components hooks`, the name `operator_test_account_cleanup` appears only in the repository (allow-list of 1). OX-1r becomes: "…run either as pasted SQL or by the admin-only `/api/admin/test-account-cleanup/*` routes through the single secret-gated RPC `public.operator_test_account_cleanup`, both generated from the same builders. No other RPC, no other caller." Insert-only splices go beside the earlier OX-1r ones.
- *Widened 2026-10-08 (AU-1, SA-ruled wording per the amendment's SQ-1, insert-only):* OX-1r: operator-only hard delete of `auth.users` for accounts whose email contains the test tag, **or an account an admin chooses on `/admin/users` (tag = that email; every other guard applies)**, run either as pasted SQL or by the admin-only `/api/admin/test-account-cleanup/*` routes through the single secret-gated RPC `public.operator_test_account_cleanup`, both generated from the same builders. No other RPC, no other caller. Same routes, same SQL. See [TEST_ACCOUNT_CLEANUP_ADMIN_USERS_AMENDMENT.md](/docs/requirements/TEST_ACCOUNT_CLEANUP_ADMIN_USERS_AMENDMENT.md).
- **R-8 Held purge RPC unchanged.** It stays held. Its guards sit in TypeScript above it. This function's guards (the secret and G-1 to G-18) sit inside it, and that is the difference. Reuse of this pattern needs SA. TQ-4: forging `p_actor` needs the secret, which already allows the delete, so this is accepted.
- **R-9 Ops and rollback.** The user applies the migration in the SQL editor, inserts the hash, sets the env var and redeploys. Then check: `has_function_privilege('anon', ...)` and `has_table_privilege('service_role', 'operator_private.secrets', 'SELECT')` are both false; `operator_private` is not in the exposed API schemas; and the `rolconfig` statement_timeout of `service_role`/`authenticator` is at least the measured run time. Then run one check and one delete on a `+test` account. To roll back, run the rollback file and remove the env var.


### Open items (Dev, 2026-10-07, insert-only)

- [ ] **OI-1 G-17 reviews DELETE triggers only.** UPDATE triggers reached through the reviewed recomputes or through `ON DELETE SET NULL` are not reviewed, for example `log_payment_activity` and `update_invoice_on_payment` on `payment_transactions`, reached by the refund recompute's UPDATE. Follow-up, not slice 1. (raised by: SA code review | status: open)
---

## Change History

| Date | Change | Details |
|---|---|---|
| 2026-10-07 | Created (BA) | User request: run the PR #244 test-account cleanup from the Danger Zone, admins only, check, then run, then report. Records how the page and routes are gated today, the three technical paths for SA, BQ-1 to BQ-6 and TQ-1 to TQ-7 |
| 2026-10-07 | User decisions recorded (§8.1) | BQ-1 build and use now without waiting for key rotation; BQ-2 free-text tag; BQ-3 in-app storage delete; BQ-4..6 BA recommendations; execution path option (c), direct Postgres connection, no function or migration |
| 2026-10-07 | SA review (§12) | Approved with conditions SA-1..SA-12: Production-only secret, one pg Client per request on the session pooler, READ ONLY check, bound set_config params, generated TS body + drift, actor via set_config, storage first after a check where every blocker is G-12, OX-1 revised to OX-1r, no-deletion-paths family 4, requireAdmin + writes gate + census, no separate flag. Slices reduced to 2 |
| 2026-10-07 | Slice 1 code complete (Dev, uncommitted) | Server path per SA-1..SA-12: operatorPostgres, generated server bodies, repository, check/probe and delete routes, refused event, guard family 4, writes gate 61 -> 64, OX-1r splices. Workplan: [TEST_ACCOUNT_CLEANUP_DANGER_ZONE_WORKPLAN.md](/docs/workplans/TEST_ACCOUNT_CLEANUP_DANGER_ZONE_WORKPLAN.md). Awaiting SA code review |
| 2026-10-07 | User decision + SA re-ruling (§8.1 row, §12 R-1..R-9) | Path changed from (c) to option A: one generated secret-gated SECURITY DEFINER RPC (`public.operator_test_account_cleanup`) applied as a migration, sha256 of `TEST_CLEANUP_SECRET` in a non-exposed `operator_private` schema, EXECUTE to service_role only; `pg`, TLS CA and `SUPABASE_DB_URL` removed; version check; guard family 4 + rpc-name assertion; OX-1r reworded |
| 2026-10-07 | Slice 1 reworked to option A (Dev, uncommitted) | R-1..R-9 implemented: generated migration 20261041 + rollback, version stamp, rpc repository, 503 paths, guards, runbook §6. Awaiting SA delta review |
| 2026-10-07 | SA code review fixes (Dev, uncommitted) | Function search_path pg_catalog, public, pg_temp; CREATE-privilege abort guard; runbook §6.6 introspection; open item OI-1 (G-17 UPDATE triggers) |
| 2026-10-07 | Slice 2 code complete (Dev, uncommitted) | Danger Zone section `components/business-os/purge/TestAccountCleanupPanel.tsx` (client-safe types in `lib/business-os/test-account-cleanup/cleanupApiTypes.ts`), mounted in `PurgeDangerZone` for admins; render tests and a no-server-import guard; `BUSINESS_OS_TEST_PAGE_SCOPE.md` section. Branch `feature/test-account-cleanup-danger-zone-ui`, on top of slice 1 (PR #249). Awaiting SA review and QA |
| 2026-10-09 | AU-1 / AU-2 amendment (insert-only) | Same hard delete mounted on `/admin/users` for any account (email locked, tag = email); OX-1r widened (bullets after §10 first bullet and after §12 R-7); AD-1 Delete… hidden. See TEST_ACCOUNT_CLEANUP_ADMIN_USERS_AMENDMENT.md |
